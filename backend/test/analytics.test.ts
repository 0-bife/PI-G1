import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { SignJWT } from 'jose';
import type { Pool } from 'mysql2/promise';
import { afterEach, test } from 'vitest';
import { createApp } from '../src/app.js';

const jwtSecret = 'analytics-test-secret-with-at-least-thirty-two-bytes';
const servers = new Set<Server>();

interface Principal {
  id_usuario: number;
  perfil: 'admin' | 'atendente';
}

interface SqlCall {
  sql: string;
  values: unknown[];
}

type RequestAuth = 'valid' | 'missing' | 'invalid';

function portOf(server: Server): number {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server has no TCP address.');
  return address.port;
}

afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
  })));
  servers.clear();
});

async function fixture(
  principal: Principal,
  execute: (sql: string, values: unknown[]) => Promise<unknown>,
) {
  const token = await new SignJWT({ jti: 'analytics-test-session' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(String(principal.id_usuario))
    .setIssuer('inablink-api')
    .setAudience('inablink-frontend')
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(new TextEncoder().encode(jwtSecret));
  const db = {
    execute: async (sql: string, values: unknown[] = []) => {
      if (sql.includes('FROM AUTH_SESSAO')) {
        return [[{
          id_usuario: principal.id_usuario,
          nome: principal.perfil === 'admin' ? 'Admin' : 'Atendente',
          email: 'user@example.com',
          perfil: principal.perfil,
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
  return async (path: string, auth: RequestAuth = 'valid') => {
    const headers: Record<string, string> = {};
    if (auth === 'valid') headers.Authorization = `Bearer ${token}`;
    if (auth === 'invalid') headers.Authorization = 'Bearer invalid-token';
    return fetch(`http://127.0.0.1:${portOf(server)}${path}`, { headers });
  };
}

test('reports validate required inclusive dates before accessing analytics data', async () => {
  const calls: SqlCall[] = [];
  const request = await fixture(
    { id_usuario: 1, perfil: 'admin' },
    async (sql, values) => { calls.push({ sql, values }); return [[]]; },
  );

  for (const path of [
    '/api/relatorios/atendimentos',
    '/api/relatorios/atendimentos?dataInicial=2026-02-30&dataFinal=2026-03-01',
    '/api/relatorios/atendimentos?dataInicial=2026-03-02&dataFinal=2026-03-01',
  ]) {
    assert.equal((await request(path)).status, 400);
  }
  assert.equal((await request('/api/relatorios/atendimentos?dataInicial=2026-03-01&dataFinal=2026-03-31')).status, 200);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].values, ['2026-03-01', '2026-03-31', '2026-03-01', '2026-03-31']);
});

test('attendants cannot expand report or dashboard scope with usuarioId', async () => {
  const calls: SqlCall[] = [];
  const request = await fixture(
    { id_usuario: 7, perfil: 'atendente' },
    async (sql, values) => {
      calls.push({ sql, values });
      if (sql.includes('taxa_conclusao_percentual')) {
        return [[{
          id: 7,
          nome: 'Atendente',
          atendimentos_realizados: 2,
          pendentes: 1,
          tempo_medio_resposta_segundos: 120,
          tempo_medio_atendimento_segundos: 300,
          taxa_conclusao_percentual: 66.67,
          sla_percentual: 100,
        }], []];
      }
      if (sql.includes('AS total')) {
        return [[{ total: 3, atendimentos_realizados: 2, pendentes: 1 }], []];
      }
      return [[{ id: 7, nome: 'Atendente', atendimentos_realizados: 2 }], []];
    },
  );

  const report = await request(
    '/api/relatorios/atendimentos?dataInicial=2026-03-01&dataFinal=2026-03-31&usuarioId=99',
  );
  assert.equal(report.status, 200);
  assert.deepEqual((await report.json() as { data: { id: number }[] }).data.map((row) => row.id), [7]);
  const dashboard = await request('/api/dashboard/atendimentos?usuarioId=99');
  assert.equal(dashboard.status, 200);
  const payload = (await dashboard.json() as {
    data: { totais: { total: number }; ranking: { id: number }[] };
  }).data;
  assert.equal(payload.totais.total, 3);
  assert.deepEqual(payload.ranking.map((row) => row.id), [7]);

  assert.deepEqual(calls[0].values, ['2026-03-01', '2026-03-31', 7, '2026-03-01', '2026-03-31', 7]);
  assert.deepEqual(calls[1].values, [7]);
  assert.deepEqual(calls[2].values, [7]);
});

test('alerts default to 30 minutes and restrict attendants to active own assignments', async () => {
  const calls: SqlCall[] = [];
  const request = await fixture(
    { id_usuario: 7, perfil: 'atendente' },
    async (sql, values) => {
      calls.push({ sql, values });
      return [[{
        id_atendimento: 5,
        id_conversa: 4,
        id_contato: 3,
        nome: 'Cliente',
        telefone: '+5511999999999',
        ultima_mensagem_em: null,
        minutos_sem_resposta: 31,
      }], []];
    },
  );
  assert.equal((await request('/api/alertas/atendimentos')).status, 200);
  assert.deepEqual(calls[0].values, [30, 7]);
  assert.match(calls[0].sql, /propria\.encerrada_em IS NULL/);
  assert.match(calls[0].sql, /ultima\.origem = 'contato'/);

  assert.equal((await request('/api/alertas/atendimentos?minutos=0')).status, 400);
  assert.equal((await request('/api/alertas/atendimentos?minutos=30&minutos=60')).status, 400);
  assert.equal(calls.length, 1);
});

test('administrator can apply a validated report filter and access the dashboard and alerts', async () => {
  const calls: SqlCall[] = [];
  const request = await fixture(
    { id_usuario: 1, perfil: 'admin' },
    async (sql, values) => {
      calls.push({ sql, values });
      if (sql.includes('taxa_conclusao_percentual')) {
        return [[{
          id: 45,
          nome: 'Atendente',
          atendimentos_realizados: 3,
          pendentes: 1,
          tempo_medio_resposta_segundos: 100,
          tempo_medio_atendimento_segundos: 400,
          taxa_conclusao_percentual: 75,
          sla_percentual: 100,
        }], []];
      }
      if (sql.includes('AS total')) {
        return [[{ total: 4, atendimentos_realizados: 3, pendentes: 1 }], []];
      }
      if (sql.includes('FROM USUARIO u')) {
        return [[{ id: 45, nome: 'Atendente', atendimentos_realizados: 3 }], []];
      }
      if (sql.includes('FROM ATENDIMENTO a') && sql.includes('TIMESTAMPDIFF(MINUTE')) {
        return [[{
          id_atendimento: 5,
          id_conversa: 4,
          id_contato: 3,
          nome: 'Cliente',
          telefone: '+5511999999999',
          ultima_mensagem_em: '2026-03-01 10:00:00',
          minutos_sem_resposta: 31,
        }], []];
      }
      return [[]];
    },
  );
  assert.equal((await request('/api/relatorios/atendimentos?dataInicial=2026-03-01&dataFinal=2026-03-31&usuarioId=45')).status, 200);
  assert.deepEqual(calls[0].values, ['2026-03-01', '2026-03-31', 45, '2026-03-01', '2026-03-31', 45]);
  const dashboard = await request('/api/dashboard/atendimentos?usuarioId=45');
  assert.equal(dashboard.status, 200);
  assert.deepEqual(calls[1].values, [45]);
  assert.deepEqual(calls[2].values, [45]);
  const alerts = await request('/api/alertas/atendimentos?minutos=30');
  assert.equal(alerts.status, 200);
  assert.deepEqual(calls[3].values, [30]);
  assert.deepEqual((await alerts.json() as { data: { id_atendimento: number }[] }).data, [{
    id_atendimento: 5,
    id_conversa: 4,
    contato: { id: 3, nome: 'Cliente', telefone: '+5511999999999' },
    ultimaMensagemEm: '2026-03-01 10:00:00',
    minutosSemResposta: 31,
  }]);
});

test('report SLA compares first response with its deadline and excludes null deadlines', async () => {
  const calls: SqlCall[] = [];
  const request = await fixture(
    { id_usuario: 1, perfil: 'admin' },
    async (sql, values) => {
      calls.push({ sql, values });
      return [[{
        id: 7,
        nome: 'Atendente',
        atendimentos_realizados: 2,
        pendentes: 0,
        tempo_medio_resposta_segundos: 100,
        tempo_medio_atendimento_segundos: 300,
        taxa_conclusao_percentual: 100,
        sla_percentual: calls.length === 1 ? '50.00' : 0,
      }], []];
    },
  );
  const response = await request(
    '/api/relatorios/atendimentos?dataInicial=2026-03-01&dataFinal=2026-03-31',
  );
  assert.equal(response.status, 200);
  const rows = (await response.json() as {
    data: { slaPercentual: number }[];
  }).data;
  assert.deepEqual(rows.map((row) => row.slaPercentual), [50]);

  const slaQuery = calls[0].sql;
  assert.match(slaQuery, /respostas\.primeira_resposta_atendente <= a\.prazo_retorno/);
  assert.match(slaQuery, /a\.prazo_retorno IS NOT NULL\s+AND respostas\.primeira_resposta_atendente IS NOT NULL/);
  assert.match(slaQuery, /a\.prazo_retorno IS NOT NULL\s+AND \(respostas\.primeira_resposta_atendente IS NOT NULL/);
  assert.match(slaQuery, /OR a\.prazo_retorno <= UTC_TIMESTAMP\(\)/);
  assert.match(slaQuery, /COALESCE\(ROUND\([\s\S]*?AS sla_percentual/);

  const noDeadlineResponse = await request(
    '/api/relatorios/atendimentos?dataInicial=2026-04-01&dataFinal=2026-04-30',
  );
  assert.equal(noDeadlineResponse.status, 200);
  assert.deepEqual(
    (await noDeadlineResponse.json() as { data: { slaPercentual: number }[] })
      .data.map((row) => row.slaPercentual),
    [0],
  );
});

test('analytics endpoints reject missing and invalid tokens with 401', async () => {
  const request = await fixture(
    { id_usuario: 1, perfil: 'admin' },
    async () => { throw new Error('Analytics data must not be queried without valid authentication.'); },
  );
  const paths = [
    '/api/relatorios/atendimentos?dataInicial=2026-03-01&dataFinal=2026-03-31',
    '/api/dashboard/atendimentos',
    '/api/alertas/atendimentos',
  ];

  for (const path of paths) {
    assert.equal((await request(path, 'missing')).status, 401);
    assert.equal((await request(path, 'invalid')).status, 401);
  }
});
