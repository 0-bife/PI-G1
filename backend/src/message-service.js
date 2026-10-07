const DUPLICATE_ENTRY = 'ER_DUP_ENTRY';
const STATUS_RANK = { pending: 0, sent: 1, delivered: 2, read: 3, failed: 4 };

function mysqlDateTime(date) {
  if (Number.isNaN(date.getTime())) {
    throw Object.assign(new Error('Invalid event timestamp.'), { status: 400 });
  }
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function fromMetaTimestamp(value) {
  if (!/^\d+$/.test(String(value))) {
    throw Object.assign(new Error('Invalid WhatsApp event timestamp.'), { status: 400 });
  }
  return new Date(Number(value) * 1000);
}

function normalizeMetaPhone(value) {
  const digits = String(value).replace(/\D/g, '');
  if (!/^[1-9]\d{7,14}$/.test(digits)) {
    throw Object.assign(new Error('Invalid WhatsApp sender phone.'), { status: 400 });
  }
  return `+${digits}`;
}

async function inTransaction(db, work) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      error.rollbackFailed = true;
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function ensureContactConversation(connection, phone, profileName = null) {
  await connection.execute(
    `INSERT INTO CONTATO (telefone, nome, cadastrado_em)
     VALUES (?, ?, CURRENT_DATE())
     ON DUPLICATE KEY UPDATE
       id_contato = LAST_INSERT_ID(id_contato),
       nome = COALESCE(VALUES(nome), nome)`,
    [phone, profileName],
  );
  const [contacts] = await connection.execute(
    'SELECT id_contato FROM CONTATO WHERE telefone = ? FOR UPDATE',
    [phone],
  );
  if (!contacts.length) throw new Error('Contact upsert did not return a row.');

  await connection.execute(
    `INSERT INTO CONVERSA (criada_em, FK_CONTATO_id_contato)
     VALUES (CURRENT_DATE(), ?)
     ON DUPLICATE KEY UPDATE id_conversa = LAST_INSERT_ID(id_conversa)`,
    [contacts[0].id_contato],
  );
  const [conversations] = await connection.execute(
    'SELECT id_conversa FROM CONVERSA WHERE FK_CONTATO_id_contato = ? FOR UPDATE',
    [contacts[0].id_contato],
  );
  if (!conversations.length) throw new Error('Conversation upsert did not return a row.');
  return {
    contactId: contacts[0].id_contato,
    conversationId: conversations[0].id_conversa,
  };
}

async function ensureOpenAttendance(connection, conversationId) {
  const [rows] = await connection.execute(
    `SELECT id_atendimento FROM ATENDIMENTO
     WHERE FK_CONVERSA_id_conversa = ? AND encerrado_em IS NULL
     ORDER BY id_atendimento DESC LIMIT 1 FOR UPDATE`,
    [conversationId],
  );
  if (rows.length) return rows[0].id_atendimento;

  const [result] = await connection.execute(
    `INSERT INTO ATENDIMENTO (status, iniciado_em, encerrado_em, FK_CONVERSA_id_conversa)
     VALUES ('open', UTC_TIMESTAMP(), NULL, ?)`,
    [conversationId],
  );
  return result.insertId;
}

async function insertStatusHistory(connection, messageId, status, occurredAt, detail = null) {
  await connection.execute(
    `INSERT INTO MENSAGEM_STATUS_HISTORICO
       (status, ocorrido_em, detalhe_erro, FK_MENSAGEM_id_mensagem)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id_historico = id_historico`,
    [status, occurredAt, detail?.slice(0, 255) ?? null, messageId],
  );
}

function extractMessageContent(message) {
  if (message.type === 'text') {
    const content = message.text?.body;
    if (typeof content !== 'string' || !content.length || [...content].length > 2048) {
      throw Object.assign(new Error('Invalid WhatsApp text message body.'), { status: 400 });
    }
    return { content, mediaReference: null };
  }

  const contentObject = message[message.type];
  if (!contentObject || typeof contentObject !== 'object') {
    throw Object.assign(new Error('Invalid WhatsApp message content.'), { status: 400 });
  }
  if (Array.isArray(contentObject)) {
    throw Object.assign(new Error('Invalid WhatsApp message content.'), { status: 400 });
  }
  const caption = contentObject.caption ?? null;
  if (caption !== null && (typeof caption !== 'string' || [...caption].length > 2048)) {
    throw Object.assign(new Error('Invalid WhatsApp media caption.'), { status: 400 });
  }
  const mediaReference = contentObject.id ?? null;
  if (['image', 'audio', 'document', 'sticker', 'video'].includes(message.type) && !mediaReference) {
    throw Object.assign(new Error('WhatsApp media message has no media ID.'), { status: 400 });
  }
  const serialized = caption ?? (mediaReference ? null : JSON.stringify(contentObject));
  if (serialized !== null && [...serialized].length > 2048) {
    throw Object.assign(new Error('WhatsApp message content exceeds 2048 characters.'), { status: 400 });
  }
  return { content: serialized, mediaReference };
}

async function applyStatusEvent(connection, messageId, currentStatus, event) {
  if (statusCanAdvance(currentStatus, event.status)) {
    await connection.execute(
      'UPDATE MENSAGEM SET status = ? WHERE id_mensagem = ?',
      [event.status, messageId],
    );
  }
  await insertStatusHistory(
    connection,
    messageId,
    event.status,
    event.occurredAt,
    event.detail,
  );
  return statusCanAdvance(currentStatus, event.status) ? event.status : currentStatus;
}

function statusCanAdvance(current, incoming) {
  const currentRank = STATUS_RANK[current] ?? -1;
  const incomingRank = STATUS_RANK[incoming] ?? -1;
  if (incoming === 'failed') return current !== 'read' && current !== 'delivered';
  return incomingRank > currentRank;
}

export class WhatsAppDeliveryError extends Error {
  constructor() {
    super('WhatsApp provider rejected the message.');
    this.name = 'WhatsAppDeliveryError';
  }
}

export class MessageService {
  constructor(db, whatsappClient, logger = console) {
    this.db = db;
    this.whatsappClient = whatsappClient;
    this.logger = logger;
  }

  async sendText({ phone, text }) {
    const pending = await inTransaction(this.db, async (connection) => {
      const { conversationId } = await ensureContactConversation(connection, phone);
      const attendanceId = await ensureOpenAttendance(connection, conversationId);
      const [result] = await connection.execute(
        `INSERT INTO MENSAGEM
           (data_hora, conteudo, origem, status, tipo, FK_CONVERSA_id_conversa)
         VALUES (UTC_TIMESTAMP(), ?, 'usuario', 'pending', 'text', ?)`,
        [text, conversationId],
      );
      await insertStatusHistory(
        connection,
        result.insertId,
        'pending',
        mysqlDateTime(new Date()),
      );
      return { messageId: result.insertId, conversationId, attendanceId };
    });

    let providerMessageId;
    try {
      providerMessageId = await this.whatsappClient.sendTextMessage(phone, text);
    } catch {
      await inTransaction(this.db, async (connection) => {
        await connection.execute(
          'UPDATE MENSAGEM SET status = ? WHERE id_mensagem = ?',
          ['failed', pending.messageId],
        );
        await insertStatusHistory(
          connection,
          pending.messageId,
          'failed',
          mysqlDateTime(new Date()),
          'WhatsApp send failed.',
        );
      });
      throw new WhatsAppDeliveryError();
    }

    const finalStatus = await inTransaction(this.db, async (connection) => {
      await connection.execute(
        `UPDATE MENSAGEM SET id_externo = ?, status = 'sent' WHERE id_mensagem = ?`,
        [providerMessageId, pending.messageId],
      );
      let currentStatus = 'sent';
      await insertStatusHistory(
        connection,
        pending.messageId,
        'sent',
        mysqlDateTime(new Date()),
      );
      const [pendingStatuses] = await connection.execute(
        `SELECT status, ocorrido_em, detalhe_erro FROM WHATSAPP_STATUS_PENDENTE
         WHERE id_externo = ? ORDER BY ocorrido_em, id_pendente FOR UPDATE`,
        [providerMessageId],
      );
      for (const event of pendingStatuses) {
        currentStatus = await applyStatusEvent(connection, pending.messageId, currentStatus, {
          status: event.status,
          occurredAt: event.ocorrido_em,
          detail: event.detalhe_erro,
        });
      }
      if (pendingStatuses.length) {
        await connection.execute(
          'DELETE FROM WHATSAPP_STATUS_PENDENTE WHERE id_externo = ?',
          [providerMessageId],
        );
      }
      return currentStatus;
    });

    return {
      id_mensagem: pending.messageId,
      id_externo: providerMessageId,
      FK_CONVERSA_id_conversa: pending.conversationId,
      FK_ATENDIMENTO_id_atendimento: pending.attendanceId,
      conteudo: text,
      tipo: 'text',
      origem: 'usuario',
      status: finalStatus,
    };
  }

  async processWebhook(payload) {
    if (payload?.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) {
      throw Object.assign(new Error('Invalid WhatsApp webhook payload.'), { status: 400 });
    }

    return inTransaction(this.db, async (connection) => {
      let messagesProcessed = 0;
      let statusesProcessed = 0;

      for (const entry of payload.entry) {
        if (!entry || !Array.isArray(entry.changes)) {
          throw Object.assign(new Error('Invalid WhatsApp webhook entry.'), { status: 400 });
        }
        for (const change of entry?.changes ?? []) {
          if (change?.field !== 'messages') continue;
          const value = change.value;
          if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw Object.assign(new Error('Invalid WhatsApp webhook change.'), { status: 400 });
          }
          const phoneNumberId = value.metadata?.phone_number_id;
          if (typeof phoneNumberId !== 'string'
            || (this.whatsappClient.phoneNumberId && phoneNumberId !== this.whatsappClient.phoneNumberId)) {
            throw Object.assign(new Error('Invalid WhatsApp phone number metadata.'), { status: 400 });
          }
          for (const field of ['contacts', 'messages', 'statuses']) {
            if (value[field] !== undefined && !Array.isArray(value[field])) {
              throw Object.assign(new Error(`Invalid WhatsApp ${field} field.`), { status: 400 });
            }
          }

          const profiles = new Map(
            (value.contacts ?? []).map((contact) => [
              contact.wa_id,
              typeof contact.profile?.name === 'string' ? contact.profile.name.trim() || null : null,
            ]),
          );

          for (const message of value.messages ?? []) {
            if (!message?.id || !message.from || !message.timestamp || !message.type) {
              throw Object.assign(new Error('Invalid WhatsApp message event.'), { status: 400 });
            }
            const [alreadyStored] = await connection.execute(
              'SELECT id_mensagem FROM MENSAGEM WHERE id_externo = ? FOR UPDATE',
              [message.id],
            );
            if (alreadyStored.length) continue;

            const phone = normalizeMetaPhone(message.from);
            const { conversationId } = await ensureContactConversation(
              connection,
              phone,
              profiles.get(message.from) ?? null,
            );

            const [existing] = await connection.execute(
              'SELECT id_mensagem FROM MENSAGEM WHERE id_externo = ? FOR UPDATE',
              [message.id],
            );
            if (existing.length) continue;

            await ensureOpenAttendance(connection, conversationId);
            const { content, mediaReference } = extractMessageContent(message);
            const occurredAt = mysqlDateTime(fromMetaTimestamp(message.timestamp));
            try {
              const [result] = await connection.execute(
                `INSERT INTO MENSAGEM
                   (data_hora, conteudo, origem, status, referencia_midia, tipo,
                    id_externo, FK_CONVERSA_id_conversa)
                 VALUES (?, ?, 'contato', 'received', ?, ?, ?, ?)`,
                [
                  occurredAt,
                  content,
                  mediaReference,
                  message.type,
                  message.id,
                  conversationId,
                ],
              );
              await insertStatusHistory(connection, result.insertId, 'received', occurredAt);
              messagesProcessed++;
            } catch (error) {
              if (error.code !== DUPLICATE_ENTRY) throw error;
            }
          }

          for (const statusEvent of value.statuses ?? []) {
            if (!statusEvent?.id || !statusEvent.status || !statusEvent.timestamp) {
              throw Object.assign(new Error('Invalid WhatsApp status event.'), { status: 400 });
            }
            if (!['sent', 'delivered', 'read', 'failed'].includes(statusEvent.status)) {
              this.logger.warn('WhatsApp status event has an unsupported state.');
              continue;
            }
            const eventTime = mysqlDateTime(fromMetaTimestamp(statusEvent.timestamp));
            const [rows] = await connection.execute(
              `SELECT id_mensagem, status FROM MENSAGEM
               WHERE id_externo = ? FOR UPDATE`,
              [statusEvent.id],
            );
            if (!rows.length) {
              await connection.execute(
                `INSERT INTO WHATSAPP_STATUS_PENDENTE (id_externo, status, ocorrido_em, detalhe_erro)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE id_pendente = id_pendente`,
                [
                  statusEvent.id,
                  statusEvent.status,
                  eventTime,
                  statusEvent.errors?.[0]?.title?.slice(0, 255) ?? null,
                ],
              );
              continue;
            }

            const messageId = rows[0].id_mensagem;
            await applyStatusEvent(connection, messageId, rows[0].status, {
              status: statusEvent.status,
              occurredAt: eventTime,
              detail: statusEvent.errors?.[0]?.title ?? null,
            });
            statusesProcessed++;
          }
        }
      }

      return { messagesProcessed, statusesProcessed };
    });
  }
}
