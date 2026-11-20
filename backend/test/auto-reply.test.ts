import { once } from 'node:events';
import type { Server } from 'node:http';
import { SignJWT } from 'jose';
import { afterEach, expect, test } from 'vitest';
import type { Pool } from 'mysql2/promise';
import {
  AutoReplyConfigService,
  DEFAULT_UNAVAILABLE_MESSAGE,
  DEFAULT_WELCOME_MESSAGE,
  isWithinBusinessHours,
} from '../src/auto-reply-config.js';
import {
  MessageService,
  linkMatchingLabel,
  normalizeLabelText,
} from '../src/message-service.js';
import { createApp } from '../src/app.js';
import type { WhatsAppClient } from '../src/whatsapp.js';

const servers = new Set<Server>();
const jwtSecret = 'test-jwt-secret-with-at-least-thirty-two-bytes';

afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise((resolve) => {
    server.close(resolve);
  })));
  servers.clear();
});

function webhookPayload(messageId: string, from: string, body: string, timestamp = '1763650800') {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: 'phone-123' },
          contacts: [{ wa_id: from, profile: { name: 'Cliente' } }],
          messages: [{
            id: messageId,
            from,
            timestamp,
            type: 'text',
            text: { body },
          }],
        },
      }],
    }],
  };
}

interface StoredMessage {
  id: number;
  conversationId: number;
  origem: string;
  conteudo: string | null;
  idExterno: string | null;
}

function createWebhookHarness(options: {
  onlineAttendants: number[];
  labels?: Array<{ id_etiqueta: number; nome: string }>;
  now?: Date;
}) {
  const state = {
    nextMessageId: 1,
    nextAssignmentId: 1,
    attendanceOpen: false,
    attendanceId: 100,
    startedAt: '2026-11-20 15:00:00',
    messages: [] as StoredMessage[],
    assignments: [] as Array<{ id: number; userId: number; attendanceId: number }>,
    linkedLabels: [] as Array<{ labelId: number; conversationId: number }>,
    sentWhatsApp: [] as Array<{ to: string; text: string }>,
    onlineAttendants: [...options.onlineAttendants],
    labels: options.labels ?? [
      { id_etiqueta: 1, nome: 'Informações Gerais' },
      { id_etiqueta: 2, nome: 'Pedidos Online' },
    ],
  };

  const execute = async (sql: string, values: unknown[] = []) => {
    const trimmed = sql.trim();

    if (trimmed.startsWith('INSERT INTO CONTATO')) return [{ insertId: 1 }, []];
    if (trimmed.includes('SELECT id_contato FROM CONTATO')) return [[{ id_contato: 1 }], []];
    if (trimmed.startsWith('INSERT INTO CONVERSA')) return [{ insertId: 10 }, []];
    if (trimmed.includes('SELECT id_conversa FROM CONVERSA')) return [[{ id_conversa: 10 }], []];

    if (trimmed.includes('SELECT id_atendimento, iniciado_em FROM ATENDIMENTO')) {
      if (!state.attendanceOpen) return [[], []];
      return [[{ id_atendimento: state.attendanceId, iniciado_em: state.startedAt }], []];
    }
    if (trimmed.startsWith('INSERT INTO ATENDIMENTO')) {
      state.attendanceOpen = true;
      return [{ insertId: state.attendanceId }, []];
    }
    if (trimmed.includes('SELECT id_atendimento FROM ATENDIMENTO')) {
      return state.attendanceOpen ? [[{ id_atendimento: state.attendanceId }], []] : [[], []];
    }

    if (trimmed.includes('SELECT id_mensagem FROM MENSAGEM WHERE id_externo')) {
      const found = state.messages.filter((m) => m.idExterno === values[0]);
      return [found.map((m) => ({ id_mensagem: m.id })), []];
    }
    if (trimmed.startsWith('INSERT INTO MENSAGEM_STATUS_HISTORICO')) return [{ affectedRows: 1 }, []];
    if (trimmed.startsWith('INSERT INTO MENSAGEM')) {
      const id = state.nextMessageId++;
      if (trimmed.includes("'contato'")) {
        state.messages.push({
          id,
          conversationId: Number(values[5]),
          origem: 'contato',
          conteudo: values[1] === null ? null : String(values[1]),
          idExterno: String(values[4]),
        });
      } else if (trimmed.includes("'chatbot'")) {
        state.messages.push({
          id,
          conversationId: Number(values[1]),
          origem: 'chatbot',
          conteudo: String(values[0]),
          idExterno: null,
        });
      }
      return [{ insertId: id }, []];
    }
    if (trimmed.startsWith('UPDATE MENSAGEM SET id_externo')) {
      const msg = state.messages.find((m) => m.id === Number(values[1]));
      if (msg) msg.idExterno = String(values[0]);
      return [{ affectedRows: 1 }, []];
    }
    if (trimmed.includes('FROM WHATSAPP_STATUS_PENDENTE')) return [[], []];

    if (trimmed.includes('JOIN USUARIO u ON u.id_usuario = r.FK_USUARIO_id_usuario')) {
      const has = state.assignments.some((a) => a.attendanceId === Number(values[0]));
      return [has ? [{ 1: 1 }] : [], []];
    }
    if (trimmed.includes("origem IN ('usuario', 'chatbot')")) {
      const rows = state.messages
        .filter((m) => m.conversationId === Number(values[0]) && (m.origem === 'usuario' || m.origem === 'chatbot'))
        .map((m) => ({ origem: m.origem, conteudo: m.conteudo }));
      return [rows, []];
    }
    if (trimmed.includes('SELECT id_etiqueta, nome FROM ETIQUETA')) {
      return [state.labels, []];
    }
    if (trimmed.startsWith('INSERT INTO marca')) {
      state.linkedLabels.push({ labelId: Number(values[0]), conversationId: Number(values[1]) });
      return [{ affectedRows: 1 }, []];
    }
    if (trimmed.includes('MAX(a.id_atribuicao)')) {
      const last = (userId: number) => Math.max(
        0,
        ...state.assignments.filter((a) => a.userId === userId).map((a) => a.id),
      );
      const next = [...state.onlineAttendants].sort((a, b) => last(a) - last(b) || a - b)[0];
      return [next !== undefined ? [{ id_usuario: next }] : [], []];
    }
    if (trimmed.startsWith('SELECT u.id_usuario FROM USUARIO u')) {
      return [state.onlineAttendants.map((id) => ({ id_usuario: id })), []];
    }
    if (trimmed.startsWith('INSERT INTO ATRIBUICAO')) {
      const id = state.nextAssignmentId++;
      state.assignments.push({ id, userId: Number(values[0]), attendanceId: Number(values[1]) });
      return [{ insertId: id }, []];
    }

    throw new Error(`Unexpected SQL in test: ${trimmed}`);
  };

  const db = {
    execute,
    getConnection: async () => ({
      execute,
      beginTransaction: async () => {},
      commit: async () => {},
      rollback: async () => {},
      release: () => {},
    }),
  } as unknown as Pool;

  const whatsappClient = {
    accessToken: 'token',
    phoneNumberId: 'phone-123',
    graphApiVersion: 'v21.0',
    sendTextMessage: async (to: string, text: string) => {
      state.sentWhatsApp.push({ to, text });
      return `wamid.bot.${state.sentWhatsApp.length}`;
    },
  } as unknown as WhatsAppClient;

  const configService = new AutoReplyConfigService({}, null);
  const service = new MessageService(
    db,
    whatsappClient,
    { error() {}, warn() {} },
    configService,
    { get: async () => ({ fuso_horario: 'America/Sao_Paulo' }) },
    () => options.now ?? new Date('2026-11-20T15:00:00Z'), // 12:00 America/Sao_Paulo
  );

  return { service, state };
}

test('isWithinBusinessHours valida janela padrão 10:00–22:00 no fuso configurado', () => {
  const config = { horario_ativo: true, horario_inicio: '10:00', horario_fim: '22:00' };
  // 13:00 UTC = 10:00 America/Sao_Paulo
  expect(isWithinBusinessHours(config, 'America/Sao_Paulo', new Date('2026-11-20T13:00:00Z'))).toBe(true);
  // 00:59 UTC = 21:59 America/Sao_Paulo
  expect(isWithinBusinessHours(config, 'America/Sao_Paulo', new Date('2026-11-21T00:59:00Z'))).toBe(true);
  // 01:00 UTC = 22:00 America/Sao_Paulo (fora)
  expect(isWithinBusinessHours(config, 'America/Sao_Paulo', new Date('2026-11-21T01:00:00Z'))).toBe(false);
  // 12:59 UTC = 09:59 America/Sao_Paulo (fora)
  expect(isWithinBusinessHours(config, 'America/Sao_Paulo', new Date('2026-11-20T12:59:00Z'))).toBe(false);
  // Desativado = sempre permitido
  expect(isWithinBusinessHours({ ...config, horario_ativo: false }, 'America/Sao_Paulo', new Date('2026-11-20T05:00:00Z'))).toBe(true);
});

test('AutoReplyConfigService valida horários e mensagens', async () => {
  const service = new AutoReplyConfigService({}, null);
  const initial = await service.get();
  expect(initial.horario_inicio).toBe('10:00');
  expect(initial.horario_fim).toBe('22:00');
  expect(initial.mensagem_boas_vindas).toBe(DEFAULT_WELCOME_MESSAGE);
  expect(initial.mensagem_indisponivel).toBe(DEFAULT_UNAVAILABLE_MESSAGE);

  await expect(service.update({ horario_inicio: '25:00' })).rejects.toThrow('HH:MM');
  await expect(service.update({ horario_inicio: '10:00', horario_fim: '10:00' })).rejects.toThrow('diferentes');

  const updated = await service.update({ horario_inicio: '08:30', horario_fim: '18:00' });
  expect(updated.horario_inicio).toBe('08:30');
  expect(updated.horario_fim).toBe('18:00');
});

test('normalizeLabelText e linkMatchingLabel vinculam etiqueta de mesmo nome ignorando acentos e prefixos', async () => {
  expect(normalizeLabelText(' - Informações Gerais ')).toBe('informacoes gerais');
  expect(normalizeLabelText('-Pedidos Online')).toBe('pedidos online');

  const linked: unknown[][] = [];
  const db = {
    execute: async (sql: string, values: unknown[] = []) => {
      if (sql.includes('FROM ETIQUETA')) {
        return [[
          { id_etiqueta: 1, nome: 'Informações Gerais' },
          { id_etiqueta: 2, nome: 'Pedidos Online' },
        ], []];
      }
      if (sql.includes('INSERT INTO marca')) {
        linked.push(values);
        return [{ affectedRows: 1 }, []];
      }
      return [[], []];
    },
  } as unknown as Pool;

  expect(await linkMatchingLabel(db, 42, 'pedidos online')).toBe(2);
  expect(linked).toEqual([[2, 42]]);
  expect(await linkMatchingLabel(db, 42, 'outro assunto')).toBeNull();
});

test('fluxo completo: 1a msg envia menu sem atribuir; 2a msg vincula etiqueta e atribui no rodízio; 3a msg não reenvia menu', async () => {
  const { service, state } = createWebhookHarness({
    onlineAttendants: [7, 8],
    now: new Date('2026-11-20T15:00:00Z'), // 12:00 BRT (horário comercial)
  });

  // 1a mensagem: envia boas-vindas e aguarda escolha
  const first = await service.processWebhook(webhookPayload('wamid.1', '5511999999999', 'Oi'));
  expect(first.assignedAttendances).toEqual([
    { attendanceId: 100, userId: null, autoReply: 'welcome', linkedLabelId: null },
  ]);
  expect(state.sentWhatsApp).toEqual([
    { to: '+5511999999999', text: DEFAULT_WELCOME_MESSAGE },
  ]);
  expect(state.assignments).toHaveLength(0);

  // 2a mensagem: cliente escolhe "Informações Gerais" -> vincula etiqueta e atribui no rodízio
  const second = await service.processWebhook(
    webhookPayload('wamid.2', '5511999999999', 'informacoes gerais', '1763650860'),
  );
  expect(second.assignedAttendances).toEqual([
    { attendanceId: 100, userId: 7, autoReply: null, linkedLabelId: 1 },
  ]);
  expect(state.linkedLabels).toEqual([{ labelId: 1, conversationId: 10 }]);
  expect(state.assignments).toEqual([{ id: 1, userId: 7, attendanceId: 100 }]);
  expect(state.sentWhatsApp).toHaveLength(1); // não reenviou o menu

  // 3a mensagem: conversa em andamento -> não dispara auto-resposta nem muda atribuição
  const third = await service.processWebhook(
    webhookPayload('wamid.3', '5511999999999', 'Qual o endereço?', '1763650920'),
  );
  expect(third.assignedAttendances).toEqual([
    { attendanceId: 100, userId: null, autoReply: null, linkedLabelId: null },
  ]);
  expect(state.assignments).toHaveLength(1);
  expect(state.sentWhatsApp).toHaveLength(1);
});

test('fora do horário comercial ou sem atendentes online envia mensagem de indisponibilidade uma vez e não atribui', async () => {
  // Caso 1: fora do horário comercial (02:00 UTC = 23:00 BRT)
  const outOfHours = createWebhookHarness({
    onlineAttendants: [7],
    now: new Date('2026-11-21T02:00:00Z'),
  });
  const res1 = await outOfHours.service.processWebhook(webhookPayload('wamid.10', '5511988887777', 'Boa noite'));
  expect(res1.assignedAttendances[0]).toEqual({
    attendanceId: 100,
    userId: null,
    autoReply: 'unavailable',
    linkedLabelId: null,
  });
  expect(outOfHours.state.sentWhatsApp).toEqual([
    { to: '+5511988887777', text: DEFAULT_UNAVAILABLE_MESSAGE },
  ]);
  expect(outOfHours.state.assignments).toHaveLength(0);

  // Mensagem repetida em seguida fora do horário não faz spam
  const res2 = await outOfHours.service.processWebhook(webhookPayload('wamid.11', '5511988887777', 'Tem alguém aí?', '1763650900'));
  expect(res2.assignedAttendances[0].autoReply).toBeNull();
  expect(outOfHours.state.sentWhatsApp).toHaveLength(1);

  // Caso 2: dentro do horário comercial, mas sem atendentes online
  const noOnline = createWebhookHarness({
    onlineAttendants: [],
    now: new Date('2026-11-20T15:00:00Z'),
  });
  const res3 = await noOnline.service.processWebhook(webhookPayload('wamid.12', '5511977776666', 'Olá'));
  expect(res3.assignedAttendances[0].autoReply).toBe('unavailable');
  expect(noOnline.state.assignments).toHaveLength(0);
});

test('rotas /api/configuracoes/atendimento restringem PATCH a admin e admin responde conversa de outro atendente sem alterar atribuição', async () => {
  const assignmentWrites: string[] = [];

  async function makeRequest(perfil: 'admin' | 'atendente', userId: number) {
    const token = await new SignJWT({ jti: `session-${userId}` })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(String(userId))
      .setIssuer('inablink-api')
      .setAudience('inablink-frontend')
      .setIssuedAt()
      .setExpirationTime('12h')
      .sign(new TextEncoder().encode(jwtSecret));

    const execute = async (sql: string) => {
      if (sql.includes('FROM AUTH_SESSAO')) {
        return [[{
          id_usuario: userId,
          nome: perfil === 'admin' ? 'Admin' : 'Atendente',
          email: `${perfil}@example.com`,
          perfil,
          ativo: true,
        }], []];
      }
      if (sql.includes('INSERT INTO ATRIBUICAO') || sql.includes('UPDATE ATRIBUICAO')) {
        assignmentWrites.push(sql);
      }
      if (sql.includes('SELECT v.id_conversa, c.telefone')) {
        return [[{ id_conversa: 10, telefone: '+5511999999999' }], []];
      }
      if (sql.includes('SELECT id_atendimento, iniciado_em FROM ATENDIMENTO')) {
        return [[{ id_atendimento: 100, iniciado_em: '2026-11-20 15:00:00' }], []];
      }
      if (sql.includes('INSERT INTO MENSAGEM_STATUS_HISTORICO')) return [{ affectedRows: 1 }, []];
      if (sql.includes('INSERT INTO MENSAGEM')) return [{ insertId: 55 }, []];
      if (sql.includes('UPDATE MENSAGEM')) return [{ affectedRows: 1 }, []];
      if (sql.includes('FROM WHATSAPP_STATUS_PENDENTE')) return [[], []];
      return [[], []];
    };

    const db = {
      execute,
      getConnection: async () => ({
        execute,
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => {},
        release: () => {},
      }),
    } as unknown as Pool;

    const whatsappClient = {
      accessToken: 'token',
      phoneNumberId: 'phone-123',
      graphApiVersion: 'v21.0',
      sendTextMessage: async () => 'wamid.admin.1',
    } as unknown as WhatsAppClient;

    const server = createApp(
      db,
      { error() {}, warn() {} },
      whatsappClient,
      { JWT_SECRET: jwtSecret },
    ).listen(0, '127.0.0.1');
    servers.add(server);
    await once(server, 'listening');
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('No address');

    return (path: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${addr.port}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  }

  const attendantReq = await makeRequest('atendente', 2);
  expect((await attendantReq('/api/configuracoes/atendimento')).status).toBe(200);
  expect((await attendantReq('/api/configuracoes/atendimento', {
    method: 'PATCH',
    body: JSON.stringify({ horario_inicio: '09:00' }),
  })).status).toBe(403);

  const adminReq = await makeRequest('admin', 1);
  const patchRes = await adminReq('/api/configuracoes/atendimento', {
    method: 'PATCH',
    body: JSON.stringify({ horario_inicio: '09:00', horario_fim: '21:00' }),
  });
  expect(patchRes.status).toBe(200);
  const patchJson = await patchRes.json() as { data: { horario_inicio: string; horario_fim: string } };
  expect(patchJson.data.horario_inicio).toBe('09:00');
  expect(patchJson.data.horario_fim).toBe('21:00');

  // Admin responde conversa atribuída a outro atendente: não grava nem altera ATRIBUICAO
  const sendRes = await adminReq('/api/conversas/10/mensagens', {
    method: 'POST',
    body: JSON.stringify({ tipo: 'text', conteudo: 'Olá, aqui é o administrador ajudando!' }),
  });
  expect(sendRes.status).toBe(202);
  expect(assignmentWrites).toHaveLength(0);
});
