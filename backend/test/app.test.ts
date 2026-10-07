import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { SignJWT } from 'jose';
import { afterEach, expect, test } from 'vitest';
import type { Pool } from 'mysql2/promise';
import { createApp } from '../src/app.js';

const servers = new Set<Server>();
const jwtSecret = 'test-jwt-secret-with-at-least-thirty-two-bytes';

function portOf(server: Server): number {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server has no TCP address.');
  return address.port;
}

afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise((resolve) => {
    server.close(resolve);
  })));
  servers.clear();
});

interface TestRequestOptions extends Omit<RequestInit, 'headers'> {
  headers?: Record<string, string>;
}

async function fixture(execute: (sql: string, values?: unknown[]) => Promise<unknown>) {
  const token = await new SignJWT({ jti: 'test-session-id' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject('1')
    .setIssuer('inablink-api')
    .setAudience('inablink-frontend')
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(new TextEncoder().encode(jwtSecret));
  const db = {
    execute: async (sql: string, values?: unknown[]) => {
      if (sql.includes('FROM AUTH_SESSAO')) {
        return [[{
          id_usuario: 1,
          nome: 'Admin',
          email: 'admin@example.com',
          perfil: 'admin',
          ativo: true,
        }], []];
      }
      return execute(sql, values);
    },
  };
  const server = createApp(
    db as unknown as Pool,
    { error() {}, warn() {} },
    undefined,
    { JWT_SECRET: jwtSecret },
  ).listen(0, '127.0.0.1');
  servers.add(server);
  await once(server, 'listening');
  return (path: string, options: TestRequestOptions = {}) => fetch(`http://127.0.0.1:${portOf(server)}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
}
const json = (body: unknown, method = 'POST'): TestRequestOptions => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('liveness does not need MySQL; readiness reports failure', async () => {
  const request = await fixture(async () => { throw new Error('offline'); });
  assert.equal((await request('/health')).status, 200);
  assert.equal((await request('/health/ready')).status, 503);
});

test('contact creation binds input as SQL parameters', async () => {
  const name = "Maria'); DROP TABLE CONTATO; --";
  const phone = '+15551234567';
  const request = await fixture(async (sql, values) => {
    if (sql.startsWith('INSERT INTO CONTATO')) {
      assert.match(sql, /CURRENT_DATE\(\)/);
      assert.ok(!sql.includes(name));
      assert.deepEqual(values, [phone, name, null]);
      return [{ insertId: 7 }, []];
    }
    assert.match(sql, /FROM CONTATO WHERE telefone = \?/);
    return [[{
      id_contato: 7,
      telefone: phone,
      nome: name,
      email: null,
    }], []];
  });
  const response = await request('/api/contatos', json({ nome: name, telefone: phone }));
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('location'), `/api/contatos/${encodeURIComponent(phone)}`);
  assert.equal((await response.json() as { data: { id_contato: number } }).data.id_contato, 7);
});

test('contact creation permits a phone-only profile', async () => {
  const phone = '+15557654321';
  const request = await fixture(async (sql, values) => {
    if (sql.startsWith('INSERT INTO CONTATO')) {
      assert.deepEqual(values, [phone, null, null]);
      return [{ insertId: 8 }, []];
    }
    return [[{
      id_contato: 8,
      telefone: phone,
      nome: null,
      email: null,
    }], []];
  });
  const response = await request('/api/contatos', json({ telefone: phone }));
  assert.equal(response.status, 201);
  assert.deepEqual((await response.json() as { data: Record<string, unknown> }).data, {
    id_contato: 8,
    telefone: phone,
    nome: null,
    email: null,
  });
});

test('invalid bodies, IDs and pagination never reach the database', async () => {
  let calls = 0;
  const request = await fixture(async () => { calls++; return [[]]; });
  for (const body of [
    { nome: 'Maria' },
    { telefone: '+15551234567', admin: true },
    { telefone: '1' },
  ]) {
    assert.equal((await request('/api/contatos', json(body))).status, 400);
  }
  assert.equal((await request('/api/contatos/1abc')).status, 400);
  assert.equal((await request('/api/contatos?limit=101')).status, 400);
  assert.equal((await request('/api/etiquetas/1', json({}, 'PATCH'))).status, 400);
  assert.equal(calls, 0);
});

test('lists use bounded pagination and missing rows return 404', async () => {
  const request = await fixture(async (sql) => {
    if (sql.includes('ORDER BY id_etiqueta')) assert.match(sql, /LIMIT 10 OFFSET 10$/);
    return [[]];
  });
  const response = await request('/api/etiquetas?page=2&limit=10');
  assert.deepEqual(await response.json(), { data: [], page: 2, limit: 10 });
  assert.equal((await request('/api/contatos/+15551234567')).status, 404);
});

test('patch accepts optional null and delete reports missing rows', async () => {
  const phone = '+15551234567';
  const request = await fixture(async (sql, values) => {
    if (sql.includes('FROM CONTATO WHERE telefone')) {
      return [[{ id_contato: 2, telefone: phone, nome: 'Maria', email: null }], []];
    }
    if (sql.startsWith('UPDATE')) {
      assert.match(sql, /^UPDATE CONTATO SET email = \? WHERE telefone = \?$/);
      assert.deepEqual(values, [null, phone]);
      return [{ affectedRows: 1 }, []];
    }
    return [{ affectedRows: 0 }, []];
  });
  assert.equal((await request(`/api/contatos/${phone}`, json({ email: null }, 'PATCH'))).status, 204);
  assert.equal((await request('/api/etiquetas/99', { method: 'DELETE' })).status, 404);
});

test('contact label associations are idempotent and query by E.164 phone', async () => {
  const phone = '+15551234567';
  let associationCount = 0;
  const request = await fixture(async (sql, values) => {
    if (sql.includes('FROM CONTATO WHERE telefone')) {
      return [[{ id_contato: 9, telefone: phone, nome: null, email: null }], []];
    }
    if (sql.includes('FROM ETIQUETA WHERE id_etiqueta')) {
      return [[{ id_etiqueta: 4, nome: 'VIP', cor: '#123456' }], []];
    }
    if (sql.includes('JOIN classifica x')) {
      assert.deepEqual(values, [phone]);
      return [[{ id_etiqueta: 4, nome: 'VIP', cor: '#123456' }], []];
    }
    if (sql.startsWith('INSERT INTO classifica')) {
      assert.deepEqual(values, [9, 4]);
      associationCount = 1;
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith('DELETE FROM classifica')) {
      assert.deepEqual(values, [9, 4]);
      const affectedRows = associationCount;
      associationCount = 0;
      return [{ affectedRows }, []];
    }
    throw new Error(`Unexpected test SQL: ${sql}`);
  });

  const added = await request(`/api/contatos/${encodeURIComponent(phone)}/etiquetas/4`, { method: 'PUT' });
  expect(added.status).toBe(204);
  const repeated = await request(`/api/contatos/${encodeURIComponent(phone)}/etiquetas/4`, { method: 'PUT' });
  expect(repeated.status).toBe(204);
  expect(associationCount).toBe(1);
  const listed = await request(`/api/contatos/${encodeURIComponent(phone)}/etiquetas`);
  expect(await listed.json()).toMatchObject({ data: [{ id_etiqueta: 4, nome: 'VIP' }] });
  const removed = await request(`/api/contatos/${encodeURIComponent(phone)}/etiquetas/4`, { method: 'DELETE' });
  expect(removed.status).toBe(204);
  const removedAgain = await request(`/api/contatos/${encodeURIComponent(phone)}/etiquetas/4`, { method: 'DELETE' });
  expect(removedAgain.status).toBe(404);
});

test('contact deletion refuses records with conversation history', async () => {
  const phone = '+15551234567';
  const request = await fixture(async (sql) => {
    if (sql.includes('FROM CONTATO WHERE telefone')) {
      return [[{ id_contato: 9, telefone: phone, nome: null, email: null }], []];
    }
    if (sql.startsWith('DELETE c FROM CONTATO')) return [{ affectedRows: 0 }, []];
    throw new Error(`Unexpected test SQL: ${sql}`);
  });
  const response = await request(`/api/contatos/${encodeURIComponent(phone)}`, { method: 'DELETE' });
  assert.equal(response.status, 409);
});

test('label create and update bind user values as SQL parameters', async () => {
  const name = "VIP'); DROP TABLE ETIQUETA; --";
  const request = await fixture(async (sql, values) => {
    if (sql.startsWith('INSERT INTO ETIQUETA')) {
      assert.ok(!sql.includes(name));
      assert.deepEqual(values, [name, '#123456']);
      return [{ insertId: 5 }, []];
    }
    if (sql.includes('FROM ETIQUETA WHERE id_etiqueta')) {
      return [[{ id_etiqueta: 5, nome: name, cor: '#123456' }], []];
    }
    if (sql.startsWith('UPDATE ETIQUETA')) {
      assert.ok(!sql.includes(name));
      assert.deepEqual(values, [name, 5]);
      return [{ affectedRows: 1 }, []];
    }
    throw new Error(`Unexpected test SQL: ${sql}`);
  });
  const created = await request('/api/etiquetas', json({ nome: name, cor: '#123456' }));
  assert.equal(created.status, 201);
  const updated = await request('/api/etiquetas/5', json({ nome: name }, 'PATCH'));
  assert.equal(updated.status, 204);
});

test('database errors do not expose SQL or credentials', async () => {
  const request = await fixture(async () => { throw new Error('secret credentials'); });
  const response = await request('/api/contatos');
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Internal server error.' });
});
