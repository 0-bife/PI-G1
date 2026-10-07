import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { SignJWT } from 'jose';
import { afterEach, test } from 'vitest';
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
  const request = await fixture(async (sql, values) => {
    assert.match(sql, /^INSERT INTO CONTATO/);
    assert.match(sql, /CURRENT_DATE\(\)/);
    assert.ok(!sql.includes(name));
    assert.deepEqual(values, [name, '5511999999999']);
    return [{ insertId: 7 }];
  });
  const response = await request('/api/contatos', json({ nome: name, telefone: '5511999999999' }));
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('location'), '/api/contatos/7');
  assert.equal((await response.json() as { data: { id_contato: number } }).data.id_contato, 7);
});

test('invalid bodies, IDs and pagination never reach the database', async () => {
  let calls = 0;
  const request = await fixture(async () => { calls++; return [[]]; });
  for (const body of [{ nome: 'Maria' }, { nome: 'M', telefone: '1', admin: true }, { nome: null, telefone: '1' }]) {
    assert.equal((await request('/api/contatos', json(body))).status, 400);
  }
  assert.equal((await request('/api/contatos/1abc')).status, 400);
  assert.equal((await request('/api/contatos?limit=101')).status, 400);
  assert.equal((await request('/api/etiquetas/1', json({}, 'PATCH'))).status, 400);
  assert.equal(calls, 0);
});

test('lists use bounded pagination and missing rows return 404', async () => {
  const request = await fixture(async (sql) => {
    if (sql.includes('LIMIT')) assert.match(sql, /LIMIT 10 OFFSET 10$/);
    return [[]];
  });
  const response = await request('/api/etiquetas?page=2&limit=10');
  assert.deepEqual(await response.json(), { data: [], page: 2, limit: 10 });
  assert.equal((await request('/api/contatos/99')).status, 404);
});

test('patch accepts optional null and delete reports missing rows', async () => {
  const request = await fixture(async (sql, values) => {
    if (sql.startsWith('UPDATE')) {
      assert.deepEqual(values, [null, 2]);
      return [{ affectedRows: 1 }];
    }
    return [{ affectedRows: 0 }];
  });
  assert.equal((await request('/api/contatos/2', json({ email: null }, 'PATCH'))).status, 204);
  assert.equal((await request('/api/etiquetas/99', { method: 'DELETE' })).status, 404);
});

test('database errors do not expose SQL or credentials', async () => {
  const request = await fixture(async () => { throw new Error('secret credentials'); });
  const response = await request('/api/contatos');
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Internal server error.' });
});
