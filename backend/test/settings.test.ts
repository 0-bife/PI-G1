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

test('settings get falls back gracefully when CONFIGURACAO table does not exist', async () => {
  const db = {
    execute: async () => {
      const error = new Error("Table 'inablink.CONFIGURACAO' doesn't exist");
      Object.assign(error, { code: 'ER_NO_SUCH_TABLE' });
      throw error;
    },
  } as unknown as Pool;

  const mockWhatsAppClient = {
    isConfigured: () => true,
    getBusinessProfile: async () => ({
      display_phone_number: '+55 11 98888-7777',
      verified_name: 'InAblink Suporte',
      about: 'Atendimento oficial',
      email: 'suporte@inablink.com',
    }),
    updateBusinessProfile: async () => {},
  };

  const service = new SettingsService(db, null, mockWhatsAppClient as any);
  const result = await service.get();

  expect(result).toEqual({
    nome_perfil: 'InAblink Suporte',
    email_contato: 'suporte@inablink.com',
    fuso_horario: 'America/Sao_Paulo',
    numero_conta: '+55 11 98888-7777',
  });
});

test('settings update syncs with Meta WhatsApp Business Profile', async () => {
  const updatedMeta: Array<Record<string, unknown>> = [];
  const db = {
    execute: async () => {
      // Simula banco sem a tabela para testar se update não falha
      const error = new Error("Table doesn't exist");
      Object.assign(error, { code: 'ER_NO_SUCH_TABLE' });
      throw error;
    },
  } as unknown as Pool;

  const mockWhatsAppClient = {
    isConfigured: () => true,
    getBusinessProfile: async () => ({
      display_phone_number: '+55 11 98888-7777',
      verified_name: 'InAblink',
      email: 'old@inablink.com',
    }),
    updateBusinessProfile: async (input: Record<string, unknown>) => {
      updatedMeta.push(input);
    },
  };

  const service = new SettingsService(db, null, mockWhatsAppClient as any);
  const next = await service.update({
    nome_perfil: 'InAblink Oficial',
    email_contato: 'contato@inablink.com',
  });

  expect(updatedMeta).toEqual([{
    about: 'InAblink Oficial',
    email: 'contato@inablink.com',
  }]);
  expect(next.nome_perfil).toBe('InAblink Oficial');
  expect(next.email_contato).toBe('contato@inablink.com');
  expect(next.numero_conta).toBe('+55 11 98888-7777');
});

test('WhatsAppClient getBusinessProfile and updateBusinessProfile call Graph API correctly', async () => {
  const { WhatsAppClient } = await import('../src/whatsapp.js');
  const calls: Array<{ url: string; options?: RequestInit }> = [];
  const fetchImpl = (async (url: string, options?: RequestInit) => {
    calls.push({ url, options });
    if (url.includes('fields=display_phone_number')) {
      return {
        ok: true,
        json: async () => ({ display_phone_number: '+55 11 91234-5678', verified_name: 'Minha Empresa' }),
      };
    }
    if (url.endsWith('/whatsapp_business_profile') && options?.method === 'POST') {
      return { ok: true, json: async () => ({ success: true }) };
    }
    if (url.includes('/whatsapp_business_profile?fields=')) {
      return {
        ok: true,
        json: async () => ({
          data: [{
            about: 'Bio da empresa',
            email: 'contato@empresa.com',
            description: 'Descrição completa',
          }],
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }) as unknown as typeof fetch;

  const client = new WhatsAppClient({
    WHATSAPP_ACCESS_TOKEN: 'token-xyz',
    WHATSAPP_PHONE_NUMBER_ID: 'phone-123',
    WHATSAPP_API_VERSION: 'v25.0',
  }, fetchImpl);

  const profile = await client.getBusinessProfile();
  expect(profile).toEqual({
    display_phone_number: '+55 11 91234-5678',
    verified_name: 'Minha Empresa',
    about: 'Bio da empresa',
    email: 'contato@empresa.com',
    description: 'Descrição completa',
  });

  await client.updateBusinessProfile({
    about: 'Nova Bio',
    email: 'novo@empresa.com',
  });

  const postCall = calls.find((c) => c.options?.method === 'POST');
  expect(postCall).toBeDefined();
  expect(postCall?.url).toBe('https://graph.facebook.com/v25.0/phone-123/whatsapp_business_profile');
  expect(JSON.parse(postCall?.options?.body as string)).toEqual({
    messaging_product: 'whatsapp',
    about: 'Nova Bio',
    email: 'novo@empresa.com',
  });
});
