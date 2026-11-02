import { once } from 'node:events';
import type { Server } from 'node:http';
import type { Pool, PoolConnection } from 'mysql2/promise';
import { SignJWT } from 'jose';
import { afterEach, expect, test } from 'vitest';
import { AnalyticsService } from '../src/analytics-service.js';
import { createApp } from '../src/app.js';
import { assignRoundRobin } from '../src/round-robin.js';

const jwtSecret = 'analytics-test-secret-with-at-least-thirty-two-bytes';
const servers = new Set<Server>();

function token(subject = '1') {
  return new SignJWT({ jti: 'analytics-session' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(subject)
    .setIssuer('inablink-api')
    .setAudience('inablink-frontend')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(jwtSecret));
}

afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  servers.clear();
});

test('round-robin chooses the least loaded active attendant and ignores admins', async () => {
  const calls: string[] = [];
  const connection = {
    execute: async (sql: string) => {
      calls.push(sql);
      if (sql.includes("perfil = 'atendente'") && sql.includes('ORDER BY id_usuario')) {
        return [[{ id_usuario: 2 }, { id_usuario: 3 }], []];
      }
      if (sql.includes('GROUP BY u.id_usuario')) return [[{ id_usuario: 3 }], []];
      return [{ affectedRows: 1, insertId: 99 }, []];
    },
  } as unknown as PoolConnection;

  await expect(assignRoundRobin(connection, 44)).resolves.toBe(3);
  expect(calls.at(-1)).toContain('INSERT INTO ATRIBUICAO');
});

test('attendance report maps aggregate metrics and binds date/user filters', async () => {
  let receivedValues: unknown[] | undefined;
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
      receivedValues = values;
      expect(sql).toContain('GROUP BY u.id_usuario');
      return [[{
        id_usuario: 7,
        nome: 'Ana',
        atendimentos_realizados: 4,
        atendimentos_pendentes: 1,
        tempo_medio_resposta_segundos: '12.5',
        tempo_medio_atendimento_segundos: 90,
        taxa_conclusao: 80,
        sla: 75,
      }], []];
    },
  } as unknown as Pool;

  await expect(new AnalyticsService(db).attendanceReport({
    start: '2026-01-01 00:00:00',
    end: '2026-02-01 00:00:00',
    userId: 7,
  })).resolves.toEqual([{
    id_usuario: 7,
    nome: 'Ana',
    atendimentos_realizados: 4,
    atendimentos_pendentes: 1,
    tempo_medio_resposta_segundos: 12.5,
    tempo_medio_atendimento_segundos: 90,
    taxa_conclusao: 80,
    sla: 75,
  }]);
  expect(receivedValues).toEqual(['2026-01-01 00:00:00', '2026-02-01 00:00:00', 7]);
});

test('report endpoint rejects inverted date ranges before accessing the database', async () => {
  let reportCalls = 0;
  const db = {
    execute: async (sql: string) => {
      if (sql.includes('FROM AUTH_SESSAO')) {
        return [[{
          id_usuario: 1,
          nome: 'Admin',
          email: 'admin@example.com',
          perfil: 'admin',
          ativo: true,
        }], []];
      }
      reportCalls++;
      return [[], []];
    },
  } as unknown as Pool;
  const server = createApp(db, { error() {}, warn() {} }, undefined, {
    JWT_SECRET: jwtSecret,
    ROUND_ROBIN_ENABLED: 'false',
  }).listen(0, '127.0.0.1');
  servers.add(server);
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Server did not start.');
  const response = await fetch(`http://127.0.0.1:${address.port}/api/relatorios/atendimentos?dataInicial=2026-02-01&dataFinal=2026-01-01`, {
    headers: { Authorization: `Bearer ${await token()}` },
  });
  expect(response.status).toBe(400);
  expect(reportCalls).toBe(0);
});
