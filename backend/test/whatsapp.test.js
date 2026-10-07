import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { afterEach, expect, test, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { WhatsAppClient } from '../src/whatsapp.js';

const apiToken = 'test-api-token';
const appSecret = 'test-app-secret';
const servers = new Set();

class MemoryDatabase {
  constructor() {
    this.contacts = [];
    this.conversations = [];
    this.attendances = [];
    this.messages = [];
    this.statusHistory = [];
    this.pendingStatuses = [];
    this.ids = { contact: 1, conversation: 1, attendance: 1, message: 1, status: 1 };
  }

  async getConnection() {
    const db = this;
    return {
      async beginTransaction() {},
      async commit() {},
      async rollback() {},
      release() {},
      async execute(rawSql, values = []) {
        const sql = rawSql.replace(/\s+/g, ' ').trim();

        if (sql.startsWith('INSERT INTO CONTATO')) {
          let contact = db.contacts.find((row) => row.telefone === values[0]);
          if (!contact) {
            contact = {
              id_contato: db.ids.contact++,
              telefone: values[0],
              nome: values[1],
            };
            db.contacts.push(contact);
          } else if (values[1]) {
            contact.nome = values[1];
          }
          return [{ insertId: contact.id_contato }, []];
        }
        if (sql.startsWith('SELECT id_contato FROM CONTATO')) {
          const contact = db.contacts.find((row) => row.telefone === values[0]);
          return [contact ? [{ id_contato: contact.id_contato }] : [], []];
        }
        if (sql.startsWith('INSERT INTO CONVERSA')) {
          let conversation = db.conversations.find((row) => row.contactId === values[0]);
          if (!conversation) {
            conversation = {
              id_conversa: db.ids.conversation++,
              contactId: values[0],
            };
            db.conversations.push(conversation);
          }
          return [{ insertId: conversation.id_conversa }, []];
        }
        if (sql.startsWith('SELECT id_conversa FROM CONVERSA')) {
          const conversation = db.conversations.find((row) => row.contactId === values[0]);
          return [conversation ? [{ id_conversa: conversation.id_conversa }] : [], []];
        }
        if (sql.startsWith('SELECT id_atendimento FROM ATENDIMENTO')) {
          const attendance = db.attendances.find(
            (row) => row.conversationId === values[0] && !row.closed,
          );
          return [attendance ? [{ id_atendimento: attendance.id_atendimento }] : [], []];
        }
        if (sql.startsWith('INSERT INTO ATENDIMENTO')) {
          const attendance = {
            id_atendimento: db.ids.attendance++,
            conversationId: values[0],
            closed: false,
          };
          db.attendances.push(attendance);
          return [{ insertId: attendance.id_atendimento }, []];
        }
        if (sql.startsWith('SELECT id_mensagem FROM MENSAGEM WHERE id_externo')) {
          const message = db.messages.find((row) => row.id_externo === values[0]);
          return [message ? [{ id_mensagem: message.id_mensagem }] : [], []];
        }
        if (sql.startsWith('SELECT id_mensagem, status FROM MENSAGEM')) {
          const message = db.messages.find((row) => row.id_externo === values[0]);
          return [message ? [{ id_mensagem: message.id_mensagem, status: message.status }] : [], []];
        }
        if (sql.startsWith('SELECT status, ocorrido_em, detalhe_erro FROM WHATSAPP_STATUS_PENDENTE')) {
          return [
            db.pendingStatuses
              .filter((row) => row.externalId === values[0])
              .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
              .map((row) => ({
                status: row.status,
                ocorrido_em: row.occurredAt,
                detalhe_erro: row.detail,
              })),
            [],
          ];
        }
        if (sql.startsWith('INSERT INTO WHATSAPP_STATUS_PENDENTE')) {
          const [externalId, status, occurredAt, detail] = values;
          const exists = db.pendingStatuses.some(
            (row) => row.externalId === externalId
              && row.status === status
              && row.occurredAt === occurredAt,
          );
          if (!exists) db.pendingStatuses.push({ externalId, status, occurredAt, detail });
          return [{ affectedRows: exists ? 0 : 1 }, []];
        }
        if (sql.startsWith('DELETE FROM WHATSAPP_STATUS_PENDENTE')) {
          db.pendingStatuses = db.pendingStatuses.filter((row) => row.externalId !== values[0]);
          return [{ affectedRows: 1 }, []];
        }
        if (sql.startsWith('INSERT INTO MENSAGEM_STATUS_HISTORICO')) {
          const [status, occurredAt, detail, messageId] = values;
          const exists = db.statusHistory.some(
            (row) => row.messageId === messageId && row.status === status && row.occurredAt === occurredAt,
          );
          if (!exists) {
            db.statusHistory.push({
              id_historico: db.ids.status++,
              status,
              occurredAt,
              detail,
              messageId,
            });
          }
          return [{ affectedRows: exists ? 0 : 1 }, []];
        }
        if (sql.startsWith('INSERT INTO MENSAGEM')) {
          const id_mensagem = db.ids.message++;
          let row;
          if (sql.includes("'usuario', 'pending'")) {
            row = {
              id_mensagem,
              conteudo: values[0],
              status: 'pending',
              conversationId: values[1],
            };
          } else {
            const [occurredAt, content, mediaReference, type, externalId, conversationId] = values;
            if (db.messages.some((message) => message.id_externo === externalId)) {
              const error = new Error('Duplicate external ID');
              error.code = 'ER_DUP_ENTRY';
              throw error;
            }
            row = {
              id_mensagem,
              data_hora: occurredAt,
              conteudo: content,
              referencia_midia: mediaReference,
              tipo: type,
              id_externo: externalId,
              status: 'received',
              conversationId,
            };
          }
          db.messages.push(row);
          return [{ insertId: id_mensagem }, []];
        }
        if (sql.startsWith('UPDATE MENSAGEM SET id_externo')) {
          const [externalId, messageId] = values;
          const row = db.messages.find((message) => message.id_mensagem === messageId);
          row.id_externo = externalId;
          row.status = 'sent';
          return [{ affectedRows: 1 }, []];
        }
        if (sql.startsWith('UPDATE MENSAGEM SET status')) {
          const [status, messageId] = values;
          const row = db.messages.find((message) => message.id_mensagem === messageId);
          row.status = status;
          return [{ affectedRows: 1 }, []];
        }
        throw new Error(`Unexpected SQL in test fake: ${sql}`);
      },
    };
  }
}

async function fixture(database = new MemoryDatabase(), sendTextMessage = vi.fn().mockResolvedValue('wamid.outgoing')) {
  const client = new WhatsAppClient({
    WHATSAPP_ACCESS_TOKEN: 'test-meta-token',
    WHATSAPP_PHONE_NUMBER_ID: 'test-phone-id',
    WHATSAPP_VERIFY_TOKEN: 'test-verify-token',
    WHATSAPP_APP_SECRET: appSecret,
    WHATSAPP_API_VERSION: 'v99.0',
  });
  client.sendTextMessage = sendTextMessage;
  const logger = { error: vi.fn(), warn: vi.fn() };
  const server = createApp(
    database,
    logger,
    client,
    { API_ACCESS_TOKEN: apiToken },
  ).listen(0, '127.0.0.1');
  servers.add(server);
  await once(server, 'listening');

  return {
    database,
    logger,
    client,
    sendTextMessage,
    request: (path, options = {}) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      ...options,
      headers: {
        ...(path !== '/api/webhook/whatsapp' ? { Authorization: `Bearer ${apiToken}` } : {}),
        ...options.headers,
      },
    }),
  };
}

function signedRequest(payload) {
  const body = JSON.stringify(payload);
  const signature = `sha256=${createHmac('sha256', appSecret).update(body).digest('hex')}`;
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': signature,
    },
    body,
  };
}

function incomingPayload(messages, contacts = []) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: 'test-phone-id' },
          contacts,
          messages,
        },
      }],
    }],
  };
}

afterEach(() => vi.restoreAllMocks());

afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise((resolve) => {
    server.close(resolve);
  })));
  servers.clear();
});

test('webhook GET returns the Meta challenge only for the configured verify token', async () => {
  const { request } = await fixture();
  const valid = await request(
    '/api/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=challenge-value',
  );
  expect(valid.status).toBe(200);
  expect(valid.headers.get('content-type')).toMatch(/text\/plain/);
  expect(await valid.text()).toBe('challenge-value');

  const invalid = await request(
    '/api/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge-value',
  );
  expect(invalid.status).toBe(403);
});

test('webhook validates the Meta signature and persists unknown senders idempotently', async () => {
  const { request, database } = await fixture();
  const payload = incomingPayload(
    [
      { id: 'wamid.incoming-1', from: '15551234567', timestamp: '1749416383', type: 'text', text: { body: 'Hello' } },
      { id: 'wamid.incoming-2', from: '15551234567', timestamp: '1749416384', type: 'image', image: { id: 'media-1', caption: 'Photo' } },
    ],
    [{ wa_id: '15551234567', profile: { name: 'Test Contact' } }],
  );

  const response = await request('/api/webhook/whatsapp', signedRequest(payload));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    status: 'received',
    messagesProcessed: 2,
    statusesProcessed: 0,
  });
  expect(database.contacts).toHaveLength(1);
  expect(database.contacts[0]).toMatchObject({ telefone: '+15551234567', nome: 'Test Contact' });
  expect(database.conversations).toHaveLength(1);
  expect(database.attendances).toHaveLength(1);
  expect(database.messages).toHaveLength(2);
  expect(database.messages[0]).toMatchObject({
    id_externo: 'wamid.incoming-1',
    status: 'received',
    tipo: 'text',
    conteudo: 'Hello',
  });
  expect(database.messages[1]).toMatchObject({
    id_externo: 'wamid.incoming-2',
    tipo: 'image',
    conteudo: 'Photo',
    referencia_midia: 'media-1',
  });

  const duplicate = await request('/api/webhook/whatsapp', signedRequest(payload));
  expect(duplicate.status).toBe(200);
  expect((await duplicate.json()).messagesProcessed).toBe(0);
  expect(database.contacts).toHaveLength(1);
  expect(database.conversations).toHaveLength(1);
  expect(database.attendances).toHaveLength(1);
  expect(database.messages).toHaveLength(2);
  expect(database.statusHistory).toHaveLength(2);
});

test('webhook rejects requests with an invalid Meta signature', async () => {
  const { request, database } = await fixture();
  const response = await request('/api/webhook/whatsapp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': 'sha256=invalid',
    },
    body: JSON.stringify(incomingPayload([])),
  });
  expect(response.status).toBe(401);
  expect(database.contacts).toHaveLength(0);
});

test('outgoing message creates a contact and conversation when the phone is new', async () => {
  const sendTextMessage = vi.fn().mockResolvedValue('wamid.outgoing');
  const { request, database } = await fixture(new MemoryDatabase(), sendTextMessage);
  const response = await request('/api/mensagens/enviar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      telefone: '+15557654321',
      tipo: 'text',
      conteudo: 'Outbound test',
    }),
  });

  expect(response.status).toBe(202);
  expect(await response.json()).toMatchObject({
    data: {
      id_externo: 'wamid.outgoing',
      conteudo: 'Outbound test',
      status: 'sent',
      origem: 'usuario',
    },
  });
  expect(sendTextMessage).toHaveBeenCalledWith('+15557654321', 'Outbound test');
  expect(database.contacts).toMatchObject([{ telefone: '+15557654321', nome: null }]);
  expect(database.conversations).toHaveLength(1);
  expect(database.attendances).toHaveLength(1);
  expect(database.messages).toMatchObject([
    { id_externo: 'wamid.outgoing', status: 'sent', conteudo: 'Outbound test' },
  ]);
  expect(database.statusHistory.map((event) => event.status)).toEqual(['pending', 'sent']);
});

test('Meta status events update current state and record duplicate-safe history', async () => {
  const { request, database } = await fixture();
  const sendResponse = await request('/api/mensagens/enviar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      telefone: '+15557654321',
      tipo: 'text',
      conteudo: 'Track status',
    }),
  });
  expect(sendResponse.status).toBe(202);

  const payload = incomingPayload([]);
  payload.entry[0].changes[0].value.statuses = [
    { id: 'wamid.outgoing', status: 'delivered', timestamp: '1749416385' },
    { id: 'wamid.outgoing', status: 'read', timestamp: '1749416386' },
  ];
  const response = await request('/api/webhook/whatsapp', signedRequest(payload));
  expect(response.status).toBe(200);
  expect((await response.json()).statusesProcessed).toBe(2);
  expect(database.messages[0].status).toBe('read');
  expect(database.statusHistory.map((event) => event.status)).toEqual([
    'pending',
    'sent',
    'delivered',
    'read',
  ]);

  const duplicate = await request('/api/webhook/whatsapp', signedRequest(payload));
  expect(duplicate.status).toBe(200);
  expect(database.statusHistory).toHaveLength(4);
});

test('status webhook arriving before the send response is applied when the message ID is saved', async () => {
  const { request, database } = await fixture();
  const earlyStatusPayload = incomingPayload([]);
  earlyStatusPayload.entry[0].changes[0].value.statuses = [
    { id: 'wamid.outgoing', status: 'delivered', timestamp: '1749416385' },
  ];
  const earlyStatus = await request('/api/webhook/whatsapp', signedRequest(earlyStatusPayload));
  expect(earlyStatus.status).toBe(200);
  expect(database.pendingStatuses).toHaveLength(1);

  const sent = await request('/api/mensagens/enviar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      telefone: '+15557654321',
      tipo: 'text',
      conteudo: 'Race-safe status',
    }),
  });
  expect(sent.status).toBe(202);
  expect((await sent.json()).data.status).toBe('delivered');
  expect(database.pendingStatuses).toHaveLength(0);
  expect(database.statusHistory.map((event) => event.status)).toEqual([
    'pending',
    'sent',
    'delivered',
  ]);
});

test('Meta send failures persist a failed state and return a sanitized gateway error', async () => {
  const sendTextMessage = vi.fn().mockRejectedValue(new Error('provider response contains a secret'));
  const { request, database } = await fixture(new MemoryDatabase(), sendTextMessage);
  const response = await request('/api/mensagens/enviar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      telefone: '+15557654321',
      tipo: 'text',
      conteudo: 'Failure case',
    }),
  });

  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: 'WhatsApp provider rejected the message.' });
  expect(database.messages[0].status).toBe('failed');
  expect(database.statusHistory.map((event) => event.status)).toEqual(['pending', 'failed']);
});

test('outgoing route requires API auth and rejects invalid input', async () => {
  const { request } = await fixture();
  const noAuth = await request('/api/mensagens/enviar', {
    method: 'POST',
    headers: { Authorization: '', 'Content-Type': 'application/json' },
    body: JSON.stringify({ telefone: '+15557654321', tipo: 'text', conteudo: 'Hi' }),
  });
  expect(noAuth.status).toBe(401);

  const badPhone = await request('/api/mensagens/enviar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ telefone: '555-123', tipo: 'text', conteudo: 'Hi' }),
  });
  expect(badPhone.status).toBe(400);
});

test('WhatsApp client signs only the exact raw webhook body', () => {
  const client = new WhatsAppClient({ WHATSAPP_APP_SECRET: appSecret });
  const body = Buffer.from('{"object":"whatsapp_business_account"}');
  const signature = `sha256=${createHmac('sha256', appSecret).update(body).digest('hex')}`;
  expect(client.verifyWebhookSignature(body, signature)).toBe(true);
  expect(client.verifyWebhookSignature(Buffer.from(`${body} `), signature)).toBe(false);
});

test('WhatsApp client sends text through the configured Graph API version', async () => {
  const fetchImpl = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ messages: [{ id: 'wamid.provider' }] }),
  });
  const client = new WhatsAppClient({
    WHATSAPP_ACCESS_TOKEN: 'secret-token',
    WHATSAPP_PHONE_NUMBER_ID: 'phone-id',
    WHATSAPP_API_VERSION: 'v99.0',
  }, fetchImpl);

  await expect(client.sendTextMessage('+15551234567', 'Hello')).resolves.toBe('wamid.provider');
  expect(fetchImpl).toHaveBeenCalledWith(
    'https://graph.facebook.com/v99.0/phone-id/messages',
    expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer secret-token' }),
      body: expect.stringContaining('"to":"15551234567"'),
    }),
  );
});
