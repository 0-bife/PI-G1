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

async function fixture(
  execute: (sql: string, values?: unknown[]) => Promise<unknown>,
  corsOrigins = '',
  perfil: 'admin' | 'atendente' = 'admin',
) {
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
          nome: 'Usuário',
          email: 'user@example.com',
          perfil,
          ativo: true,
        }], []];
      }
      return execute(sql, values);
    },
    getConnection: async () => ({
      execute: async (sql: string, values?: unknown[]) => execute(sql, values),
      beginTransaction: async () => {},
      commit: async () => {},
      rollback: async () => {},
      release: () => {},
    }),
  };
  const server = createApp(
    db as unknown as Pool,
    { error() {}, warn() {} },
    undefined,
    { JWT_SECRET: jwtSecret, CORS_ORIGINS: corsOrigins },
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

test('CORS preflight allows only explicitly configured frontend origins', async () => {
  const request = await fixture(async () => { throw new Error('CORS must finish before database access.'); }, 'https://front.example.com');
  const allowed = await request('/api/auth/login', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://front.example.com',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://front.example.com');
  assert.match(allowed.headers.get('access-control-allow-headers') ?? '', /Authorization/);

  const blocked = await request('/api/auth/login', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://untrusted.example.com',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  });
  assert.equal(blocked.status, 204);
  assert.equal(blocked.headers.get('access-control-allow-origin'), null);
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

test('conversation list returns latest message, open attendance and active responsible users', async () => {
  const phone = '+15551234567';
  const request = await fixture(async (sql, values) => {
    if (sql.includes('FROM CONVERSA v')) {
      assert.deepEqual(values, [phone]);
      assert.match(sql, /LIMIT 10 OFFSET 10$/);
      return [[{
        id_conversa: 12,
        criada_em: '2026-01-01',
        id_contato: 9,
        telefone: phone,
        nome: 'Maria',
        email: null,
        id_atendimento_aberto: 23,
        status_atendimento: 'open',
        iniciado_em: '2026-01-02 10:00:00',
        prazo_retorno: null,
        ultima_mensagem_em: '2026-01-02 11:00:00',
      }], []];
    }
    if (sql.includes('FROM ATRIBUICAO a')) {
      return [[{
        id_atribuicao: 31,
        iniciada_em: '2026-01-02 10:30:00',
        encerrada_em: null,
        FK_USUARIO_id_usuario: 5,
        nome: 'Ana',
        email: 'ana@example.com',
        perfil: 'atendente',
        FK_ATENDIMENTO_id_atendimento: 23,
      }], []];
    }
    throw new Error(`Unexpected test SQL: ${sql}`);
  });

  const response = await request(`/api/conversas?page=2&limit=10&telefone=${encodeURIComponent(phone)}`);
  assert.equal(response.status, 200);
  const result = await response.json() as { data: Array<Record<string, unknown>>; page: number; limit: number };
  assert.equal(result.page, 2);
  assert.equal(result.data[0].ultima_mensagem_em, '2026-01-02 11:00:00');
  assert.deepEqual(result.data[0].atendimento_aberto, {
    id_atendimento: 23,
    status: 'open',
    iniciado_em: '2026-01-02 10:00:00',
    prazo_retorno: null,
  });
  assert.equal((result.data[0].responsaveis_ativos as unknown[]).length, 1);
});

test('conversation search returns contact and message targets', async () => {
  const request = await fixture(async (sql, values) => {
    if (sql.includes('FROM CONVERSA v')) {
      assert.deepEqual(values, ['%pedido%', '%pedido%']);
      return [[{
        id_conversa: 12,
        criada_em: '2026-01-01',
        id_contato: 9,
        telefone: '+15551234567',
        nome: 'Maria',
        email: null,
        id_atendimento_aberto: null,
        status_atendimento: null,
        iniciado_em: null,
        prazo_retorno: null,
        ultima_mensagem_em: '2026-01-02 11:00:00',
      }], []];
    }
    if (sql.includes('FROM MENSAGEM m')) {
      assert.deepEqual(values, ['%pedido%']);
      return [[{
        id_mensagem: 88,
        data_hora: '2026-01-02 11:00:00',
        conteudo: 'Pedido confirmado',
        origem: 'contato',
        status: 'received',
        tipo: 'text',
        FK_CONVERSA_id_conversa: 12,
        nome_usuario: null,
        id_conversa: 12,
        contato_nome: 'Maria',
        contato_telefone: '+15551234567',
      }], []];
    }
    throw new Error(`Unexpected test SQL: ${sql}`);
  });

  const response = await request('/api/busca/conversas?q=pedido');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    data: {
      conversas: [{
        id_conversa: 12,
        criada_em: '2026-01-01',
        id_contato: 9,
        telefone: '+15551234567',
        nome: 'Maria',
        email: null,
        ultima_mensagem_em: '2026-01-02 11:00:00',
        atendimento_aberto: null,
      }],
      mensagens: [{
        id_mensagem: 88,
        data_hora: '2026-01-02 11:00:00',
        conteudo: 'Pedido confirmado',
        origem: 'contato',
        status: 'received',
        tipo: 'text',
        FK_CONVERSA_id_conversa: 12,
        nome_usuario: null,
        conversa: {
          id_conversa: 12,
          nome: 'Maria',
          telefone: '+15551234567',
        },
      }],
    },
  });
});

test('conversation creation reuses the unique contact and conversation', async () => {
  const phone = '+15551234567';
  let conversationCreated = false;
  const request = await fixture(async (sql, values) => {
    if (sql.startsWith('INSERT INTO CONTATO')) {
      assert.deepEqual(values, [phone]);
      return [{ affectedRows: 1 }, []];
    }
    if (sql === 'SELECT id_contato FROM CONTATO WHERE telefone = ? FOR UPDATE') return [[{ id_contato: 9 }], []];
    if (sql.startsWith('INSERT INTO CONVERSA')) {
      conversationCreated = true;
      return [{ insertId: 12 }, []];
    }
    if (sql === 'SELECT id_conversa FROM CONVERSA WHERE FK_CONTATO_id_contato = ? FOR UPDATE') {
      assert.deepEqual(values, [9]);
      return [conversationCreated ? [{ id_conversa: 12 }] : [], []];
    }
    if (sql.includes('FROM CONVERSA v') && sql.includes('WHERE v.id_conversa = ?')) {
      return [[{
        id_conversa: 12,
        criada_em: '2026-01-01',
        id_contato: 9,
        telefone: phone,
        nome: null,
        email: null,
        id_atendimento_aberto: null,
        status_atendimento: null,
        iniciado_em: null,
        prazo_retorno: null,
        ultima_mensagem_em: null,
      }], []];
    }
    throw new Error(`Unexpected test SQL: ${sql}`);
  });

  const first = await request('/api/conversas', json({ telefone: phone }));
  const repeated = await request('/api/conversas', json({ telefone: phone }));
  assert.equal(first.status, 201);
  assert.equal(repeated.status, 200);
  assert.equal(((await repeated.json()) as { data: { id_conversa: number } }).data.id_conversa, 12);
});

test('conversation and attendance routes reject invalid identifiers and fields before database work', async () => {
  let calls = 0;
  const request = await fixture(async () => { calls++; return [[], []]; });
  assert.equal((await request('/api/conversas?telefone=12345')).status, 400);
  assert.equal((await request('/api/conversas', json({ telefone: '12345' }))).status, 400);
  assert.equal((await request('/api/conversas/nope/atendimentos', json({}))).status, 400);
  assert.equal((await request('/api/atendimentos/22', json({ status: 'waiting' }, 'PATCH'))).status, 400);
  assert.equal(calls, 0);
});

test('opening an attendance creates a cycle and rejects a second open cycle', async () => {
  let open = false;
  const request = await fixture(async (sql) => {
    if (sql.includes('SELECT id_conversa FROM CONVERSA')) return [[{ id_conversa: 12 }], []];
    if (sql.startsWith('SELECT id_atendimento FROM ATENDIMENTO')) {
      return [open ? [{ id_atendimento: 22 }] : [], []];
    }
    if (sql.startsWith('INSERT INTO ATENDIMENTO')) {
      open = true;
      return [{ insertId: 22 }, []];
    }
    if (sql.includes('SELECT id_atendimento, status, iniciado_em')) {
      return [[{
        id_atendimento: 22,
        status: 'open',
        iniciado_em: '2026-01-02 10:00:00',
        encerrado_em: null,
        prazo_retorno: null,
        FK_CONVERSA_id_conversa: 12,
      }], []];
    }
    if (sql.includes('FROM ATRIBUICAO a')) return [[], []];
    throw new Error(`Unexpected test SQL: ${sql}`);
  });
  const opened = await request('/api/conversas/12/atendimentos', json({}));
  assert.equal(opened.status, 201);
  assert.equal(((await opened.json()) as { data: { id_atendimento: number } }).data.id_atendimento, 22);
  const duplicate = await request('/api/conversas/12/atendimentos', json({}));
  assert.equal(duplicate.status, 409);
});

test('attendance close is persisted and a closed cycle cannot be reopened', async () => {
  let closed = false;
  const request = await fixture(async (sql, values) => {
    if (sql.includes('SELECT id_atendimento, status, iniciado_em')) {
      return [[{
        id_atendimento: 22,
        status: closed ? 'closed' : 'open',
        iniciado_em: '2026-01-02 10:00:00',
        encerrado_em: closed ? '2026-01-02 11:00:00' : null,
        prazo_retorno: null,
        FK_CONVERSA_id_conversa: 12,
      }], []];
    }
    if (sql.startsWith('UPDATE ATENDIMENTO')) {
      assert.match(sql, /status = 'closed'/);
      assert.deepEqual(values, [22]);
      closed = true;
      return [{ affectedRows: 1 }, []];
    }
    throw new Error(`Unexpected test SQL: ${sql}`);
  });
  assert.equal((await request('/api/atendimentos/22', json({ status: 'closed' }, 'PATCH'))).status, 204);
  assert.equal((await request('/api/atendimentos/22', json({ status: 'open' }, 'PATCH'))).status, 409);
});

test('attendance deadlines reject invalid calendar dates before querying the database', async () => {
  let calls = 0;
  const request = await fixture(async () => { calls++; return [[], []]; });
  const response = await request(
    '/api/atendimentos/22',
    json({ prazo_retorno: '2026-02-30T10:00:00Z' }, 'PATCH'),
  );
  assert.equal(response.status, 400);
  assert.equal(calls, 0);
});

test('multiple attendance responsible users are allowed and duplicate active assignment is idempotent', async () => {
  const activeUsers = new Set<number>();
  const request = await fixture(async (sql, values) => {
    if (sql.includes('SELECT id_atendimento, status, iniciado_em') && sql.includes('FOR UPDATE')) {
      return [[{
        id_atendimento: 22,
        status: 'open',
        iniciado_em: '2026-01-02 10:00:00',
        encerrado_em: null,
        prazo_retorno: null,
        FK_CONVERSA_id_conversa: 12,
      }], []];
    }
    if (sql.startsWith('SELECT id_usuario FROM USUARIO')) return [[{ id_usuario: Number(values?.[0]) }], []];
    if (sql.includes('FROM ATRIBUICAO') && sql.includes('encerrada_em IS NULL')) {
      return [activeUsers.has(Number(values?.[1])) ? [{ id_atribuicao: Number(values?.[1]) }] : [], []];
    }
    if (sql.startsWith('INSERT INTO ATRIBUICAO')) {
      const userId = Number(values?.[0]);
      activeUsers.add(userId);
      return [{ insertId: userId + 100 }, []];
    }
    if (sql.includes('FROM ATRIBUICAO a JOIN USUARIO')) {
      const id = Number(values?.[0]);
      return [[{
        id_atribuicao: id,
        iniciada_em: '2026-01-02 10:30:00',
        encerrada_em: null,
        FK_USUARIO_id_usuario: id - 100,
        nome: `User ${id - 100}`,
        email: `user${id - 100}@example.com`,
        perfil: 'atendente',
        FK_ATENDIMENTO_id_atendimento: 22,
      }], []];
    }
    throw new Error(`Unexpected test SQL: ${sql}`);
  });
  const first = await request('/api/atendimentos/22/atribuicoes', json({ usuarioId: 5 }));
  const second = await request('/api/atendimentos/22/atribuicoes', json({ usuarioId: 6 }));
  const duplicate = await request('/api/atendimentos/22/atribuicoes', json({ usuarioId: 5 }));
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(duplicate.status, 204);
  assert.equal(activeUsers.size, 2);
});

test('conversation labels can be added repeatedly and removed without deleting the label', async () => {
  let associated = false;
  const request = await fixture(async (sql) => {
    if (sql.startsWith('SELECT id_conversa FROM CONVERSA')) return [[{ id_conversa: 12 }], []];
    if (sql.startsWith('SELECT id_etiqueta FROM ETIQUETA')) return [[{ id_etiqueta: 4 }], []];
    if (sql.includes('FROM ETIQUETA e')) {
      return [associated ? [{ id_etiqueta: 4, nome: 'VIP', cor: '#123456' }] : [], []];
    }
    if (sql.startsWith('INSERT INTO marca')) {
      assert.match(sql, /ON DUPLICATE KEY UPDATE/);
      associated = true;
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith('DELETE FROM marca')) {
      const affectedRows = associated ? 1 : 0;
      associated = false;
      return [{ affectedRows }, []];
    }
    throw new Error(`Unexpected test SQL: ${sql}`);
  });
  assert.equal((await request('/api/conversas/12/etiquetas/4', { method: 'PUT' })).status, 204);
  assert.equal((await request('/api/conversas/12/etiquetas/4', { method: 'PUT' })).status, 204);
  assert.equal((await request('/api/conversas/12/etiquetas')).status, 200);
  assert.equal((await request('/api/conversas/12/etiquetas/4', { method: 'DELETE' })).status, 204);
});

test('removing an assignment closes its interval without deleting its history', async () => {
  let closed = false;
  const request = await fixture(async (sql, values) => {
    if (sql.startsWith('SELECT id_atribuicao FROM ATRIBUICAO')) {
      assert.deepEqual(values, [105]);
      return [[{ id_atribuicao: 105 }], []];
    }
    if (sql.startsWith('UPDATE ATRIBUICAO')) {
      assert.match(sql, /COALESCE\(encerrada_em, UTC_TIMESTAMP\(\)\)/);
      assert.deepEqual(values, [105]);
      closed = true;
      return [{ affectedRows: 1 }, []];
    }
    throw new Error(`Unexpected test SQL: ${sql}`);
  });
  assert.equal((await request('/api/atribuicoes/105', { method: 'DELETE' })).status, 204);
  assert.equal(closed, true);
});

test('message list and detail expose stored message data and chronological status history', async () => {
  const request = await fixture(async (sql, values) => {
    if (sql.startsWith('SELECT id_conversa FROM CONVERSA')) return [[{ id_conversa: 12 }], []];
    if (sql.includes('FROM MENSAGEM m') && sql.includes('WHERE m.FK_CONVERSA_id_conversa')) {
      assert.deepEqual(values, [12]);
      assert.match(sql, /ORDER BY m\.data_hora ASC, m\.id_mensagem ASC\s+LIMIT 10 OFFSET 10$/);
      return [[{
        id_mensagem: 2,
        data_hora: '2026-01-02 10:00:00',
        conteudo: 'hello',
        origem: 'contato',
        status: 'read',
        tipo: 'text',
        FK_CONVERSA_id_conversa: 12,
        FK_USUARIO_id_usuario: null,
      }], []];
    }
    if (sql.includes('FROM MENSAGEM m') && sql.includes('WHERE m.id_mensagem')) {
      assert.deepEqual(values, [2]);
      return [[{
        id_mensagem: 2,
        data_hora: '2026-01-02 10:00:00',
        conteudo: 'hello',
        origem: 'contato',
        status: 'read',
        tipo: 'text',
        id_externo: 'wamid.test',
        FK_CONVERSA_id_conversa: 12,
        FK_USUARIO_id_usuario: null,
        conversa_criada_em: '2026-01-01',
        telefone: '+15551234567',
        nome_contato: 'Maria',
        nome_usuario: null,
      }], []];
    }
    if (sql.includes('FROM MENSAGEM_STATUS_HISTORICO')) {
      assert.deepEqual(values, [2]);
      assert.match(sql, /ORDER BY ocorrido_em ASC, id_historico ASC/);
      return [[
        { id_historico: 1, status: 'received', ocorrido_em: '2026-01-02 10:00:00', detalhe_erro: null },
        { id_historico: 2, status: 'read', ocorrido_em: '2026-01-02 10:01:00', detalhe_erro: null },
      ], []];
    }
    throw new Error(`Unexpected test SQL: ${sql}`);
  });

  const list = await request('/api/conversas/12/mensagens?page=2&limit=10');
  assert.equal(list.status, 200);
  assert.equal(((await list.json()) as { data: Array<{ id_mensagem: number }> }).data[0].id_mensagem, 2);
  const detail = await request('/api/mensagens/2');
  assert.equal(detail.status, 200);
  assert.equal(((await detail.json()) as { data: { telefone: string } }).data.telefone, '+15551234567');
  const status = await request('/api/mensagens/2/status');
  const statusData = (await status.json() as { data: { status: string; historico: unknown[] } }).data;
  assert.equal(statusData.status, 'read');
  assert.equal(statusData.historico.length, 2);
});

test('annotations are authored by the token user, paginated and never sent to WhatsApp', async () => {
  const request = await fixture(async (sql, values) => {
    if (sql.startsWith('SELECT id_conversa FROM CONVERSA')) return [[{ id_conversa: 12 }], []];
    if (sql.includes('FROM ANOTACAO_INTERNA a') && sql.includes('WHERE a.FK_CONVERSA_id_conversa')) {
      assert.deepEqual(values, [12]);
      assert.match(sql, /ORDER BY a\.criada_em ASC, a\.id_anotacao ASC/);
      return [[{ id_anotacao: 4, texto: 'Follow up', FK_USUARIO_id_usuario: 1, autor_nome: 'Admin' }], []];
    }
    if (sql.startsWith('INSERT INTO ANOTACAO_INTERNA')) {
      assert.deepEqual(values, ['Follow up', 1, 12]);
      return [{ insertId: 4, affectedRows: 1 }, []];
    }
    if (sql.includes('WHERE a.id_anotacao = ?')) {
      assert.deepEqual(values, [4]);
      return [[{
        id_anotacao: 4,
        texto: 'Follow up',
        FK_CONVERSA_id_conversa: 12,
        FK_USUARIO_id_usuario: 1,
        autor_nome: 'Admin',
      }], []];
    }
    throw new Error(`Unexpected test SQL: ${sql}`);
  });

  const listed = await request('/api/conversas/12/anotacoes?page=1&limit=10');
  assert.equal(listed.status, 200);
  const created = await request('/api/conversas/12/anotacoes', json({ texto: 'Follow up' }));
  assert.equal(created.status, 201);
  assert.equal(((await created.json()) as { data: { FK_USUARIO_id_usuario: number } }).data.FK_USUARIO_id_usuario, 1);
  assert.equal((await request('/api/conversas/12/anotacoes', json({ texto: 'x'.repeat(256) }))).status, 400);
});

test('database errors do not expose SQL or credentials', async () => {
  const request = await fixture(async () => { throw new Error('secret credentials'); });
  const response = await request('/api/contatos');
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Internal server error.' });
});

test('atendente não pode iniciar conversa nem enviar para número novo', async () => {
  let calls = 0;
  const request = await fixture(async () => { calls++; return [[], []]; }, '', 'atendente');
  const conversation = await request('/api/conversas', json({ telefone: '+15551234567' }));
  expect(conversation.status).toBe(403);
  const send = await request('/api/mensagens/enviar', json({
    telefone: '+15551234567', tipo: 'text', conteudo: 'oi',
  }));
  expect(send.status).toBe(403);
  expect(calls).toBe(0);
});