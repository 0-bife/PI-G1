import { expect, test } from 'vitest';
import type { Pool } from 'mysql2/promise';
import { assignByRotation } from '../src/message-service.js';

interface Assignment { id: number; user: number; attendance: number }

function fakePool(activeUsers: number[], assignments: Assignment[] = []) {
  const state = { assignments, nextId: assignments.length + 1, inserts: 0 };
  const execute = async (sql: string, values: unknown[] = []) => {
    if (sql.includes('JOIN USUARIO u ON u.id_usuario = r.FK_USUARIO_id_usuario')) {
      const has = state.assignments.some(
        (a) => a.attendance === values[0] && activeUsers.includes(a.user),
      );
      return [has ? [{ 1: 1 }] : [], []];
    }
    if (sql.includes('FROM ATENDIMENTO')) return [[{ id_atendimento: values[0] }], []];
    if (sql.includes('MAX(a.id_atribuicao)')) {
      const last = (user: number) => Math.max(0, ...state.assignments
        .filter((a) => a.user === user).map((a) => a.id));
      const next = [...activeUsers].sort((x, y) => last(x) - last(y) || x - y)[0];
      return [[{ id_usuario: next }], []];
    }
    if (sql.trim().startsWith('SELECT id_usuario FROM USUARIO')) {
      return [activeUsers.map((id) => ({ id_usuario: id })), []];
    }
    if (sql.includes('INSERT INTO ATRIBUICAO')) {
      state.assignments.push({ id: state.nextId++, user: Number(values[0]), attendance: Number(values[1]) });
      state.inserts++;
      return [{ insertId: state.nextId - 1 }, []];
    }
    throw new Error(`Unexpected test SQL: ${sql}`);
  };
  const pool = {
    execute,
    getConnection: async () => ({
      execute,
      beginTransaction: async () => {},
      commit: async () => {},
      rollback: async () => {},
      release: () => {},
    }),
  };
  return { pool: pool as unknown as Pool, state };
}

test('rodízio alterna entre os atendentes ativos', async () => {
  const { pool } = fakePool([1, 2, 3]);
  const chosen: Array<number | null> = [];
  for (const attendance of [10, 11, 12, 13, 14, 15]) {
    chosen.push(await assignByRotation(pool, attendance));
  }
  expect(chosen).toEqual([1, 2, 3, 1, 2, 3]);
});

test('não troca o responsável de um atendimento que já tem um', async () => {
  const { pool, state } = fakePool([1, 2], [{ id: 1, user: 2, attendance: 10 }]);
  expect(await assignByRotation(pool, 10)).toBeNull();
  expect(state.inserts).toBe(0);
});

test('sem atendente ativo, o atendimento fica sem responsável', async () => {
  const { pool, state } = fakePool([]);
  expect(await assignByRotation(pool, 10)).toBeNull();
  expect(state.inserts).toBe(0);
});

test('quem entra na equipe depois recebe a próxima conversa', async () => {
  const active = [1, 2];
  const { pool, state } = fakePool(active);
  await assignByRotation(pool, 10); // 1
  await assignByRotation(pool, 11); // 2
  active.push(3);
  expect(await assignByRotation(pool, 12)).toBe(3);
  expect(state.assignments.map((a) => a.user)).toEqual([1, 2, 3]);
});