import { expect, test } from 'vitest';
import type { Pool } from 'mysql2/promise';
import { SettingsService } from '../src/settings-service.js';
import { ContactService } from '../src/contact-service.js';

test('settings update validates IANA timezone and never accepts account number changes', async () => {
  const statements: Array<{ sql: string; values?: unknown[] }> = [];
  const db = {
    execute: async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values });
      if (sql.includes('FROM CONFIGURACAO')) {
        return [[{
          nome_perfil: 'InAblink',
          email_contato: 'contato@example.com',
          fuso_horario: 'America/Sao_Paulo',
          numero_conta: '5511999999999',
        }], []];
      }
      return [{ affectedRows: 1 }, []];
    },
  } as unknown as Pool;
  const service = new SettingsService(db, '5511888888888');

  await expect(service.update({ fuso_horario: 'not/a-timezone' })).rejects.toThrow('identificador IANA');
  const updated = await service.update({
    nome_perfil: 'Novo perfil',
    email_contato: 'novo@example.com',
    fuso_horario: 'UTC',
  });
  expect(updated).toEqual({
    nome_perfil: 'Novo perfil',
    email_contato: 'novo@example.com',
    fuso_horario: 'UTC',
    numero_conta: '5511999999999',
  });
  expect(statements.at(-1)?.values).toEqual([
    'Novo perfil', 'novo@example.com', 'UTC', '5511999999999',
  ]);
});

test('label deletion clears only associations before deleting the label', async () => {
  const statements: string[] = [];
  const connection = {
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
    execute: async (sql: string) => {
      statements.push(sql);
      if (sql.startsWith('DELETE FROM ETIQUETA')) return [{ affectedRows: 1 }, []];
      return [{ affectedRows: 1 }, []];
    },
  };
  const db = {
    getConnection: async () => connection,
  } as unknown as Pool;
  await expect(new ContactService(db).deleteLabel(7)).resolves.toBe(true);
  expect(statements).toEqual([
    'DELETE FROM classifica WHERE fk_ETIQUETA_id_etiqueta = ?',
    'DELETE FROM marca WHERE fk_ETIQUETA_id_etiqueta = ?',
    'DELETE FROM ETIQUETA WHERE id_etiqueta = ?',
  ]);
});
