import { expect, test } from 'vitest';
import type { Pool } from 'mysql2/promise';
import { ConversationService } from '../src/conversation-service.js';

function capture() {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const db = {
    execute: async (sql: string, values: unknown[] = []) => {
      calls.push({ sql, values });
      return [[], []];
    },
  };
  return { calls, service: new ConversationService(db as unknown as Pool) };
}

test('atendente lista só conversas com atribuição ativa dele', async () => {
  const { calls, service } = capture();
  await service.listConversations(1, 20, undefined, 7);
  expect(calls[0].sql).toMatch(/ATRIBUICAO vis/);
  expect(calls[0].values).toEqual([7]);
});

test('administrador lista sem filtro de atribuição', async () => {
  const { calls, service } = capture();
  await service.listConversations(1, 20);
  expect(calls[0].sql).not.toMatch(/ATRIBUICAO vis/);
  expect(calls[0].values).toEqual([]);
});

test('busca de mensagens aplica escopo de atribuição para atendente e não para admin', async () => {
  const attendant = capture();
  await attendant.service.searchConversations('pedido', 20, 7);
  expect(attendant.calls[1].sql).toMatch(/ATRIBUICAO ar/);
  expect(attendant.calls[1].values).toEqual(['%pedido%', 7]);

  const admin = capture();
  await admin.service.searchConversations('pedido', 20);
  expect(admin.calls[1].sql).not.toMatch(/ATRIBUICAO ar/);
  expect(admin.calls[1].values).toEqual(['%pedido%']);
});