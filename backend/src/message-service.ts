import type { Pool, PoolConnection } from 'mysql2/promise';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import {
  AutoReplyConfigService,
  isWithinBusinessHours,
} from './auto-reply-config.js';
import type { WhatsAppClient } from './whatsapp.js';

const DUPLICATE_ENTRY = 'ER_DUP_ENTRY';
const STATUS_RANK: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3, failed: 4 };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDuplicateEntry(error: unknown): boolean {
  return isRecord(error) && error.code === DUPLICATE_ENTRY;
}

function mysqlDateTime(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw Object.assign(new Error('Invalid event timestamp.'), { status: 400 });
  }
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function fromMetaTimestamp(value: unknown): Date {
  if (!/^\d+$/.test(String(value))) {
    throw Object.assign(new Error('Invalid WhatsApp event timestamp.'), { status: 400 });
  }
  return new Date(Number(value) * 1000);
}

function normalizeMetaPhone(value: unknown): string {
  const digits = String(value).replace(/\D/g, '');
  if (!/^[1-9]\d{7,14}$/.test(digits)) {
    throw Object.assign(new Error('Invalid WhatsApp sender phone.'), { status: 400 });
  }
  return `+${digits}`;
}

async function inTransaction<T>(db: Pool, work: (connection: PoolConnection) => Promise<T>): Promise<T> {
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
      if (error instanceof Error) Object.assign(error, { rollbackFailed: true });
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function ensureContactConversation(connection: PoolConnection, phone: string, profileName: string | null = null) {
  await connection.execute(
    `INSERT INTO CONTATO (telefone, nome, cadastrado_em)
     VALUES (?, ?, CURRENT_DATE())
     ON DUPLICATE KEY UPDATE
       id_contato = LAST_INSERT_ID(id_contato),
       nome = COALESCE(VALUES(nome), nome)`,
    [phone, profileName],
  );
  const [contacts] = await connection.execute<RowDataPacket[]>(
    'SELECT id_contato FROM CONTATO WHERE telefone = ? FOR UPDATE',
    [phone],
  );
  if (!contacts.length) throw new Error('Contact upsert did not return a row.');
  const contactId = Number(contacts[0].id_contato);

  await connection.execute(
    `INSERT INTO CONVERSA (criada_em, FK_CONTATO_id_contato)
     VALUES (CURRENT_DATE(), ?)
     ON DUPLICATE KEY UPDATE id_conversa = LAST_INSERT_ID(id_conversa)`,
    [contactId],
  );
  const [conversations] = await connection.execute<RowDataPacket[]>(
    'SELECT id_conversa FROM CONVERSA WHERE FK_CONTATO_id_contato = ? FOR UPDATE',
    [contactId],
  );
  if (!conversations.length) throw new Error('Conversation upsert did not return a row.');
  return {
    contactId,
    conversationId: conversations[0].id_conversa,
  };
}

async function ensureOpenAttendance(
  connection: PoolConnection,
  conversationId: number,
): Promise<{ attendanceId: number; startedAt: string; isNew: boolean }> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT id_atendimento, iniciado_em FROM ATENDIMENTO
     WHERE FK_CONVERSA_id_conversa = ? AND encerrado_em IS NULL
     ORDER BY id_atendimento DESC LIMIT 1 FOR UPDATE`,
    [conversationId],
  );
  if (rows.length) {
    return {
      attendanceId: Number(rows[0].id_atendimento),
      startedAt: String(rows[0].iniciado_em ?? mysqlDateTime(new Date())),
      isNew: false,
    };
  }

  const startedAt = mysqlDateTime(new Date());
  const [result] = await connection.execute<ResultSetHeader>(
    `INSERT INTO ATENDIMENTO (status, iniciado_em, encerrado_em, FK_CONVERSA_id_conversa)
     VALUES ('open', UTC_TIMESTAMP(), NULL, ?)`,
    [conversationId],
  );
  return {
    attendanceId: Number(result.insertId),
    startedAt,
    isNew: true,
  };
}

// Responsável ativo = atribuição aberta de um usuário que ainda está ativo.
const ACTIVE_RESPONSIBLE_SQL = `
  SELECT 1 FROM ATRIBUICAO r
  JOIN USUARIO u ON u.id_usuario = r.FK_USUARIO_id_usuario
  WHERE r.FK_ATENDIMENTO_id_atendimento = ?
    AND r.encerrada_em IS NULL AND u.ativo = TRUE
  LIMIT 1`;

// Atendente online = usuário com perfil 'atendente', ativo e sessão JWT válida em AUTH_SESSAO.
const ONLINE_ATTENDANT_CONDITION = `
  u.perfil = 'atendente'
  AND u.ativo = TRUE
  AND EXISTS (
    SELECT 1 FROM AUTH_SESSAO s
    WHERE s.FK_USUARIO_id_usuario = u.id_usuario
      AND s.revogada_em IS NULL
      AND s.expira_em > UTC_TIMESTAMP()
  )`;

export async function hasOnlineAttendants(db: Pool): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT u.id_usuario FROM USUARIO u
     WHERE ${ONLINE_ATTENDANT_CONDITION}
     LIMIT 1`,
  );
  return rows.length > 0;
}

export function normalizeLabelText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^[\s\-•*]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('pt-BR');
}

/**
 * Vincula automaticamente à conversa uma etiqueta já cadastrada cujo nome
 * corresponda ao texto enviado pelo cliente (comparação sem acentos/maiúsculas).
 */
export async function linkMatchingLabel(
  db: Pool,
  conversationId: number,
  messageText: string | null,
): Promise<number | null> {
  if (!messageText) return null;
  const normalized = normalizeLabelText(messageText);
  if (!normalized) return null;

  const [labels] = await db.execute<RowDataPacket[]>(
    'SELECT id_etiqueta, nome FROM ETIQUETA ORDER BY id_etiqueta ASC',
  );
  const match = labels.find((label) => normalizeLabelText(String(label.nome)) === normalized);
  if (!match) return null;

  const labelId = Number(match.id_etiqueta);
  await db.execute(
    `INSERT INTO marca (fk_ETIQUETA_id_etiqueta, fk_CONVERSA_id_conversa)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE fk_CONVERSA_id_conversa = VALUES(fk_CONVERSA_id_conversa)`,
    [labelId, conversationId],
  );
  return labelId;
}

export interface RotationOptions {
  isBusinessHours?: boolean;
}

/**
 * Rodízio automático: atribui o atendimento ao atendente ativo e online
 * (sessão válida em AUTH_SESSAO) cuja última atribuição é a mais antiga
 * (ou que nunca recebeu), somente em horário comercial ativo.
 * Retorna o id do usuário escolhido, ou null se não havia nada a fazer.
 */
export async function assignByRotation(
  db: Pool,
  attendanceId: number,
  options: RotationOptions = {},
): Promise<number | null> {
  if (options.isBusinessHours === false) return null;

  // Verificação barata fora da transação: o caso comum é já haver responsável.
  const [quick] = await db.execute<RowDataPacket[]>(ACTIVE_RESPONSIBLE_SQL, [attendanceId]);
  if (quick.length) return null;

  return inTransaction(db, async (connection) => {
    // Todas as leituras abaixo, até a escolha, são com bloqueio (FOR UPDATE),
    // então leem o estado mais recente e o snapshot só nasce depois do bloqueio.
    const [attendance] = await connection.execute<RowDataPacket[]>(
      `SELECT id_atendimento FROM ATENDIMENTO
       WHERE id_atendimento = ? AND encerrado_em IS NULL FOR UPDATE`,
      [attendanceId],
    );
    if (!attendance.length) return null;

    const [alreadyAssigned] = await connection.execute<RowDataPacket[]>(
      `${ACTIVE_RESPONSIBLE_SQL} FOR UPDATE`,
      [attendanceId],
    );
    if (alreadyAssigned.length) return null;

    // Bloqueia os elegíveis (atendentes ativos e online) em ordem fixa: só um rodízio decide por vez.
    const [eligible] = await connection.execute<RowDataPacket[]>(
      `SELECT u.id_usuario FROM USUARIO u
       WHERE ${ONLINE_ATTENDANT_CONDITION}
       ORDER BY u.id_usuario FOR UPDATE`,
    );
    if (!eligible.length) return null;

    // O id da atribuição só cresce e não empata, ao contrário do timestamp.
    const [next] = await connection.execute<RowDataPacket[]>(
      `SELECT u.id_usuario,
              (SELECT MAX(a.id_atribuicao) FROM ATRIBUICAO a
               WHERE a.FK_USUARIO_id_usuario = u.id_usuario) AS ultima
       FROM USUARIO u
       WHERE ${ONLINE_ATTENDANT_CONDITION}
       ORDER BY COALESCE(ultima, 0) ASC, u.id_usuario ASC
       LIMIT 1`,
    );
    if (!next.length) return null;
    const userId = Number(next[0].id_usuario);
    await connection.execute(
      `INSERT INTO ATRIBUICAO
         (iniciada_em, encerrada_em, FK_USUARIO_id_usuario, FK_ATENDIMENTO_id_atendimento)
       VALUES (UTC_TIMESTAMP(), NULL, ?, ?)`,
      [userId, attendanceId],
    );
    return userId;
  });
}

async function insertStatusHistory(
  connection: PoolConnection,
  messageId: number,
  status: string,
  occurredAt: string,
  detail: string | null = null,
): Promise<void> {
  await connection.execute(
    `INSERT INTO MENSAGEM_STATUS_HISTORICO
       (status, ocorrido_em, detalhe_erro, FK_MENSAGEM_id_mensagem)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id_historico = id_historico`,
    [status, occurredAt, detail?.slice(0, 255) ?? null, messageId],
  );
}

function extractMessageContent(message: Record<string, unknown>): { content: string | null; mediaReference: string | null } {
  if (message.type === 'text') {
    const content = isRecord(message.text) ? message.text.body : undefined;
    if (typeof content !== 'string' || !content.length || [...content].length > 2048) {
      throw Object.assign(new Error('Invalid WhatsApp text message body.'), { status: 400 });
    }
    return { content, mediaReference: null };
  }

  const messageType = message.type;
  if (typeof messageType !== 'string') {
    throw Object.assign(new Error('Invalid WhatsApp message type.'), { status: 400 });
  }
  const contentObject = message[messageType];
  if (!isRecord(contentObject)) {
    throw Object.assign(new Error('Invalid WhatsApp message content.'), { status: 400 });
  }
  const caption = contentObject.caption ?? null;
  if (caption !== null && (typeof caption !== 'string' || [...caption].length > 2048)) {
    throw Object.assign(new Error('Invalid WhatsApp media caption.'), { status: 400 });
  }
  const mediaId = contentObject.id;
  if (mediaId !== undefined && typeof mediaId !== 'string') {
    throw Object.assign(new Error('Invalid WhatsApp media ID.'), { status: 400 });
  }
  const mediaReference = mediaId ?? null;
  if (['image', 'audio', 'document', 'sticker', 'video'].includes(messageType) && !mediaReference) {
    throw Object.assign(new Error('WhatsApp media message has no media ID.'), { status: 400 });
  }
  const serialized = caption ?? (mediaReference ? null : JSON.stringify(contentObject) ?? null);
  if (serialized !== null && [...serialized].length > 2048) {
    throw Object.assign(new Error('WhatsApp message content exceeds 2048 characters.'), { status: 400 });
  }
  return { content: serialized, mediaReference };
}

interface StatusEvent {
  status: string;
  occurredAt: string;
  detail: string | null;
}

async function applyStatusEvent(
  connection: PoolConnection,
  messageId: number,
  currentStatus: string,
  event: StatusEvent,
): Promise<string> {
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

function statusCanAdvance(current: string, incoming: string): boolean {
  const currentRank = STATUS_RANK[current] ?? -1;
  const incomingRank = STATUS_RANK[incoming] ?? -1;
  if (incoming === 'failed') return current !== 'read' && current !== 'delivered';
  return incomingRank > currentRank;
}

interface MessageRow extends RowDataPacket {
  id_mensagem: number;
  data_hora: string;
  conteudo: string | null;
  origem: string;
  status: string;
  referencia_midia: string | null;
  tipo: string;
  id_externo: string | null;
  FK_CONVERSA_id_conversa: number;
  FK_USUARIO_id_usuario: number | null;
  conversa_criada_em: string;
  telefone: string;
  nome_contato: string | null;
  nome_usuario: string | null;
}

interface StatusHistoryRow extends RowDataPacket {
  id_historico: number;
  status: string;
  ocorrido_em: string;
  detalhe_erro: string | null;
}

interface AnnotationRow extends RowDataPacket {
  id_anotacao: number;
  texto: string;
  criada_em: string;
  FK_CONVERSA_id_conversa: number;
  FK_USUARIO_id_usuario: number;
  autor_nome: string;
}

export class MessageConversationNotFoundError extends Error {
  constructor() {
    super('Conversation not found.');
    this.name = 'MessageConversationNotFoundError';
  }
}

export class WhatsAppDeliveryError extends Error {
  constructor() {
    super('WhatsApp provider rejected the message.');
    this.name = 'WhatsAppDeliveryError';
  }
}

export class MessageService {
  constructor(
    private readonly db: Pool,
    private readonly whatsappClient: WhatsAppClient,
    private readonly logger: Pick<Console, 'error' | 'warn'> = console,
    private readonly autoReplyConfig: AutoReplyConfigService = new AutoReplyConfigService(process.env, null),
    private readonly timezoneProvider: { get(): Promise<{ fuso_horario: string }> } = {
      get: async () => ({ fuso_horario: 'America/Sao_Paulo' }),
    },
    private readonly nowProvider: () => Date = () => new Date(),
  ) {
  }

  async sendText({
    phone,
    text,
    userId,
    conversationId,
  }: { phone?: string; text: string; userId: number; conversationId?: number }) {
    if ((phone === undefined) === (conversationId === undefined)) {
      throw new Error('Exactly one of phone or conversationId is required.');
    }
    const pending = await inTransaction(this.db, async (connection) => {
      let targetPhone = phone;
      let targetConversationId: number;
      if (conversationId !== undefined) {
        const [conversations] = await connection.execute<RowDataPacket[]>(
          `SELECT v.id_conversa, c.telefone
           FROM CONVERSA v JOIN CONTATO c ON c.id_contato = v.FK_CONTATO_id_contato
           WHERE v.id_conversa = ? FOR UPDATE`,
          [conversationId],
        );
        if (!conversations.length) throw new MessageConversationNotFoundError();
        targetConversationId = Number(conversations[0].id_conversa);
        targetPhone = String(conversations[0].telefone);
      } else {
        if (!targetPhone) throw new Error('A phone number is required.');
        ({ conversationId: targetConversationId } = await ensureContactConversation(connection, targetPhone));
      }
      if (!targetPhone) throw new Error('The conversation has no contact phone number.');
      const { attendanceId } = await ensureOpenAttendance(connection, targetConversationId);
      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO MENSAGEM
           (data_hora, conteudo, origem, status, tipo, FK_CONVERSA_id_conversa, FK_USUARIO_id_usuario)
         VALUES (UTC_TIMESTAMP(), ?, 'usuario', 'pending', 'text', ?, ?)`,
        [text, targetConversationId, userId],
      );
      await insertStatusHistory(
        connection,
        result.insertId,
        'pending',
        mysqlDateTime(new Date()),
      );
      return {
        messageId: result.insertId,
        conversationId: targetConversationId,
        attendanceId,
        phone: targetPhone,
      };
    });

    let providerMessageId;
    try {
      providerMessageId = await this.whatsappClient.sendTextMessage(pending.phone, text);
    } catch (error) {
      const details = isRecord(error) ? error : {};
      this.logger.error('WhatsApp provider rejected outgoing message.', {
        httpStatus: Number.isInteger(details.statusCode) ? details.statusCode : null,
        providerCode: Number.isInteger(details.providerCode) ? details.providerCode : null,
        providerSubcode: Number.isInteger(details.providerSubcode) ? details.providerSubcode : null,
        networkCode: typeof details.code === 'string' ? details.code : null,
      });
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
      const [pendingStatuses] = await connection.execute<RowDataPacket[]>(
        `SELECT status, ocorrido_em, detalhe_erro FROM WHATSAPP_STATUS_PENDENTE
         WHERE id_externo = ? ORDER BY ocorrido_em, id_pendente FOR UPDATE`,
        [providerMessageId],
      );
      for (const event of pendingStatuses) {
        currentStatus = await applyStatusEvent(connection, pending.messageId, currentStatus, {
          status: String(event.status),
          occurredAt: String(event.ocorrido_em),
          detail: typeof event.detalhe_erro === 'string' ? event.detalhe_erro : null,
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
      FK_USUARIO_id_usuario: userId,
      conteudo: text,
      tipo: 'text',
      origem: 'usuario',
      status: finalStatus,
    };
  }

  async listConversationMessages(
    conversationId: number,
    page: number,
    limit: number,
  ): Promise<{ data: MessageRow[]; page: number; limit: number } | null> {
    const [conversations] = await this.db.execute<RowDataPacket[]>(
      'SELECT id_conversa FROM CONVERSA WHERE id_conversa = ? LIMIT 1',
      [conversationId],
    );
    if (!conversations.length) return null;
    const offset = (page - 1) * limit;
    const [rows] = await this.db.execute<MessageRow[]>(
      `SELECT m.id_mensagem, m.data_hora, m.conteudo, m.origem, m.status,
              m.referencia_midia, m.tipo, m.id_externo,
              m.FK_CONVERSA_id_conversa, m.FK_USUARIO_id_usuario,
              u.nome AS nome_usuario
       FROM MENSAGEM m
       LEFT JOIN USUARIO u ON u.id_usuario = m.FK_USUARIO_id_usuario
       WHERE m.FK_CONVERSA_id_conversa = ?
       ORDER BY m.data_hora ASC, m.id_mensagem ASC
       LIMIT ${limit} OFFSET ${offset}`,
      [conversationId],
    );
    return { data: rows, page, limit };
  }

  async getMessage(id: number): Promise<MessageRow | null> {
    const [rows] = await this.db.execute<MessageRow[]>(
      `SELECT m.id_mensagem, m.data_hora, m.conteudo, m.origem, m.status,
              m.referencia_midia, m.tipo, m.id_externo,
              m.FK_CONVERSA_id_conversa, m.FK_USUARIO_id_usuario,
              v.criada_em AS conversa_criada_em, c.telefone, c.nome AS nome_contato,
              u.nome AS nome_usuario
       FROM MENSAGEM m
       JOIN CONVERSA v ON v.id_conversa = m.FK_CONVERSA_id_conversa
       JOIN CONTATO c ON c.id_contato = v.FK_CONTATO_id_contato
       LEFT JOIN USUARIO u ON u.id_usuario = m.FK_USUARIO_id_usuario
       WHERE m.id_mensagem = ? LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async getMessageStatus(id: number): Promise<{
    id_mensagem: number;
    status: string;
    historico: StatusHistoryRow[];
  } | null> {
    const message = await this.getMessage(id);
    if (!message) return null;
    const [history] = await this.db.execute<StatusHistoryRow[]>(
      `SELECT id_historico, status, ocorrido_em, detalhe_erro
       FROM MENSAGEM_STATUS_HISTORICO
       WHERE FK_MENSAGEM_id_mensagem = ?
       ORDER BY ocorrido_em ASC, id_historico ASC`,
      [id],
    );
    return { id_mensagem: id, status: message.status, historico: history };
  }

  async listAnnotations(
    conversationId: number,
    page: number,
    limit: number,
  ): Promise<{ data: AnnotationRow[]; page: number; limit: number } | null> {
    const [conversations] = await this.db.execute<RowDataPacket[]>(
      'SELECT id_conversa FROM CONVERSA WHERE id_conversa = ? LIMIT 1',
      [conversationId],
    );
    if (!conversations.length) return null;
    const offset = (page - 1) * limit;
    const [rows] = await this.db.execute<AnnotationRow[]>(
      `SELECT a.id_anotacao, a.texto, a.criada_em,
              a.FK_CONVERSA_id_conversa, a.FK_USUARIO_id_usuario,
              u.nome AS autor_nome
       FROM ANOTACAO_INTERNA a
       JOIN USUARIO u ON u.id_usuario = a.FK_USUARIO_id_usuario
       WHERE a.FK_CONVERSA_id_conversa = ?
       ORDER BY a.criada_em ASC, a.id_anotacao ASC
       LIMIT ${limit} OFFSET ${offset}`,
      [conversationId],
    );
    return { data: rows, page, limit };
  }

  async createAnnotation(conversationId: number, userId: number, text: string): Promise<AnnotationRow | null> {
    const [result] = await this.db.execute<ResultSetHeader>(
      `INSERT INTO ANOTACAO_INTERNA
         (texto, criada_em, FK_CONVERSA_id_conversa, FK_USUARIO_id_usuario)
       SELECT ?, UTC_TIMESTAMP(), v.id_conversa, ?
       FROM CONVERSA v WHERE v.id_conversa = ?`,
      [text, userId, conversationId],
    );
    if (!result.affectedRows) return null;
    const [rows] = await this.db.execute<AnnotationRow[]>(
      `SELECT a.id_anotacao, a.texto, a.criada_em,
              a.FK_CONVERSA_id_conversa, a.FK_USUARIO_id_usuario,
              u.nome AS autor_nome
       FROM ANOTACAO_INTERNA a
       JOIN USUARIO u ON u.id_usuario = a.FK_USUARIO_id_usuario
       WHERE a.id_anotacao = ? LIMIT 1`,
      [result.insertId],
    );
    if (!rows.length) throw new Error('Annotation insert did not return a row.');
    return rows[0];
  }

  async sendAutoReply({
    conversationId,
    phone,
    text,
  }: { conversationId: number; phone: string; text: string }): Promise<{
    id_mensagem: number;
    status: string;
  }> {
    const messageId = await inTransaction(this.db, async (connection) => {
      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO MENSAGEM
           (data_hora, conteudo, origem, status, tipo, FK_CONVERSA_id_conversa, FK_USUARIO_id_usuario)
         VALUES (UTC_TIMESTAMP(), ?, 'chatbot', 'pending', 'text', ?, NULL)`,
        [text, conversationId],
      );
      await insertStatusHistory(
        connection,
        result.insertId,
        'pending',
        mysqlDateTime(new Date()),
      );
      return Number(result.insertId);
    });

    if (!this.whatsappClient.accessToken || !this.whatsappClient.phoneNumberId || !this.whatsappClient.graphApiVersion) {
      this.logger.warn('WhatsApp sending is not configured; automatic reply saved locally as pending.');
      return { id_mensagem: messageId, status: 'pending' };
    }

    let providerMessageId: string;
    try {
      providerMessageId = await this.whatsappClient.sendTextMessage(phone, text);
    } catch (error) {
      const details = isRecord(error) ? error : {};
      this.logger.error('WhatsApp provider rejected automatic reply.', {
        httpStatus: Number.isInteger(details.statusCode) ? details.statusCode : null,
        providerCode: Number.isInteger(details.providerCode) ? details.providerCode : null,
        providerSubcode: Number.isInteger(details.providerSubcode) ? details.providerSubcode : null,
        networkCode: typeof details.code === 'string' ? details.code : null,
      });
      await inTransaction(this.db, async (connection) => {
        await connection.execute(
          'UPDATE MENSAGEM SET status = ? WHERE id_mensagem = ?',
          ['failed', messageId],
        );
        await insertStatusHistory(
          connection,
          messageId,
          'failed',
          mysqlDateTime(new Date()),
          'WhatsApp auto-reply send failed.',
        );
      });
      return { id_mensagem: messageId, status: 'failed' };
    }

    const finalStatus = await inTransaction(this.db, async (connection) => {
      await connection.execute(
        `UPDATE MENSAGEM SET id_externo = ?, status = 'sent' WHERE id_mensagem = ?`,
        [providerMessageId, messageId],
      );
      let currentStatus = 'sent';
      await insertStatusHistory(
        connection,
        messageId,
        'sent',
        mysqlDateTime(new Date()),
      );
      const [pendingStatuses] = await connection.execute<RowDataPacket[]>(
        `SELECT status, ocorrido_em, detalhe_erro FROM WHATSAPP_STATUS_PENDENTE
         WHERE id_externo = ? ORDER BY ocorrido_em, id_pendente FOR UPDATE`,
        [providerMessageId],
      );
      for (const event of pendingStatuses) {
        currentStatus = await applyStatusEvent(connection, messageId, currentStatus, {
          status: String(event.status),
          occurredAt: String(event.ocorrido_em),
          detail: typeof event.detalhe_erro === 'string' ? event.detalhe_erro : null,
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

    return { id_mensagem: messageId, status: finalStatus };
  }

  async processWebhook(payload: unknown) {
    if (!isRecord(payload) || payload.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) {
      throw Object.assign(new Error('Invalid WhatsApp webhook payload.'), { status: 400 });
    }
    const entries: unknown[] = payload.entry;
    const incomingAttendances = new Map<number, {
      attendanceId: number;
      conversationId: number;
      phone: string;
      startedAt: string;
      lastMessageText: string | null;
    }>();

    const result = await inTransaction(this.db, async (connection) => {
      let messagesProcessed = 0;
      let statusesProcessed = 0;

      for (const entry of entries) {
        if (!isRecord(entry) || !Array.isArray(entry.changes)) {
          throw Object.assign(new Error('Invalid WhatsApp webhook entry.'), { status: 400 });
        }
        for (const change of entry.changes) {
          if (!isRecord(change) || change.field !== 'messages') continue;
          const value = change.value;
          if (!isRecord(value)) {
            throw Object.assign(new Error('Invalid WhatsApp webhook change.'), { status: 400 });
          }
          const phoneNumberId = isRecord(value.metadata) ? value.metadata.phone_number_id : undefined;
          if (typeof phoneNumberId !== 'string'
            || (this.whatsappClient.phoneNumberId && phoneNumberId !== this.whatsappClient.phoneNumberId)) {
            throw Object.assign(new Error('Invalid WhatsApp phone number metadata.'), { status: 400 });
          }
          for (const field of ['contacts', 'messages', 'statuses']) {
            if (value[field] !== undefined && !Array.isArray(value[field])) {
              throw Object.assign(new Error(`Invalid WhatsApp ${field} field.`), { status: 400 });
            }
          }
          const contacts = Array.isArray(value.contacts) ? value.contacts : [];
          const messages = Array.isArray(value.messages) ? value.messages : [];
          const statusEvents = Array.isArray(value.statuses) ? value.statuses : [];

          const profiles = new Map<string, string | null>();
          for (const contact of contacts) {
            if (!isRecord(contact) || typeof contact.wa_id !== 'string') continue;
            const profileName = isRecord(contact.profile) ? contact.profile.name : undefined;
            profiles.set(
              contact.wa_id,
              typeof profileName === 'string' ? profileName.trim() || null : null,
            );
          }

          for (const message of messages) {
            if (!isRecord(message)
              || typeof message.id !== 'string' || !message.id
              || typeof message.from !== 'string' || !message.from
              || (typeof message.timestamp !== 'string' && typeof message.timestamp !== 'number')
              || !message.timestamp
              || typeof message.type !== 'string' || !message.type) {
              throw Object.assign(new Error('Invalid WhatsApp message event.'), { status: 400 });
            }
            const [alreadyStored] = await connection.execute<RowDataPacket[]>(
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

            const [existing] = await connection.execute<RowDataPacket[]>(
              'SELECT id_mensagem FROM MENSAGEM WHERE id_externo = ? FOR UPDATE',
              [message.id],
            );
            if (existing.length) continue;

            const attendance = await ensureOpenAttendance(connection, conversationId);
            const { content, mediaReference } = extractMessageContent(message);
            const occurredAt = mysqlDateTime(fromMetaTimestamp(message.timestamp));
            try {
              const [insertResult] = await connection.execute<ResultSetHeader>(
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
              await insertStatusHistory(connection, insertResult.insertId, 'received', occurredAt);
              messagesProcessed++;
              incomingAttendances.set(attendance.attendanceId, {
                attendanceId: attendance.attendanceId,
                conversationId: Number(conversationId),
                phone,
                startedAt: attendance.startedAt,
                lastMessageText: message.type === 'text' ? content : null,
              });
            } catch (error) {
              if (!isDuplicateEntry(error)) throw error;
            }
          }

          for (const statusEvent of statusEvents) {
            if (!isRecord(statusEvent)
              || typeof statusEvent.id !== 'string' || !statusEvent.id
              || typeof statusEvent.status !== 'string' || !statusEvent.status
              || (typeof statusEvent.timestamp !== 'string' && typeof statusEvent.timestamp !== 'number')
              || !statusEvent.timestamp) {
              throw Object.assign(new Error('Invalid WhatsApp status event.'), { status: 400 });
            }
            if (!['sent', 'delivered', 'read', 'failed'].includes(statusEvent.status)) {
              this.logger.warn('WhatsApp status event has an unsupported state.');
              continue;
            }
            const eventTime = mysqlDateTime(fromMetaTimestamp(statusEvent.timestamp));
            const [rows] = await connection.execute<RowDataPacket[]>(
              `SELECT id_mensagem, status FROM MENSAGEM
               WHERE id_externo = ? FOR UPDATE`,
              [statusEvent.id],
            );
            const errors = Array.isArray(statusEvent.errors) ? statusEvent.errors : [];
            const firstError = isRecord(errors[0]) ? errors[0] : {};
            const errorTitle = typeof firstError.title === 'string' ? firstError.title : null;
            if (!rows.length) {
              await connection.execute(
                `INSERT INTO WHATSAPP_STATUS_PENDENTE (id_externo, status, ocorrido_em, detalhe_erro)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE id_pendente = id_pendente`,
                [
                  statusEvent.id,
                  statusEvent.status,
                  eventTime,
                  errorTitle?.slice(0, 255) ?? null,
                ],
              );
              continue;
            }

            const messageId = rows[0].id_mensagem;
            await applyStatusEvent(connection, messageId, rows[0].status, {
              status: statusEvent.status,
              occurredAt: eventTime,
              detail: errorTitle,
            });
            statusesProcessed++;
          }
        }
      }

      return { messagesProcessed, statusesProcessed };
    });

    const assignedAttendances: Array<{
      attendanceId: number;
      userId: number | null;
      autoReply?: 'welcome' | 'unavailable' | null;
      linkedLabelId?: number | null;
    }> = [];

    if (incomingAttendances.size > 0) {
      const config = await this.autoReplyConfig.get();
      let timeZone = 'America/Sao_Paulo';
      try {
        const tzSettings = await this.timezoneProvider.get();
        if (tzSettings?.fuso_horario) timeZone = tzSettings.fuso_horario;
      } catch {
        // Fallback para fuso padrão
      }

      for (const item of incomingAttendances.values()) {
        try {
          // 1. Se já existe responsável ativo no atendimento, conversa está em andamento.
          const [activeResponsible] = await this.db.execute<RowDataPacket[]>(
            ACTIVE_RESPONSIBLE_SQL,
            [item.attendanceId],
          );
          if (activeResponsible.length) {
            assignedAttendances.push({
              attendanceId: item.attendanceId,
              userId: null,
              autoReply: null,
              linkedLabelId: null,
            });
            continue;
          }

          // 2. Verifica histórico de respostas (humano ou chatbot) neste ciclo de atendimento.
          const [contextRows] = await this.db.execute<RowDataPacket[]>(
            `SELECT origem, conteudo FROM MENSAGEM
             WHERE FK_CONVERSA_id_conversa = ?
               AND data_hora >= ?
               AND origem IN ('usuario', 'chatbot')
             ORDER BY data_hora ASC, id_mensagem ASC`,
            [item.conversationId, item.startedAt],
          );

          const hasHumanReply = contextRows.some((row) => row.origem === 'usuario');
          if (hasHumanReply) {
            // Conversa já respondida por humano (ex.: admin) — não reenvia menu automático.
            assignedAttendances.push({
              attendanceId: item.attendanceId,
              userId: null,
              autoReply: null,
              linkedLabelId: null,
            });
            continue;
          }

          const inBusinessHours = isWithinBusinessHours(config, timeZone, this.nowProvider());
          const onlineAttendants = await hasOnlineAttendants(this.db);
          const botMessages = contextRows.filter((row) => row.origem === 'chatbot');
          const welcomeAlreadySent = botMessages.some(
            (row) => String(row.conteudo ?? '') === config.mensagem_boas_vindas,
          );
          const unavailableAlreadySent = botMessages.some(
            (row) => String(row.conteudo ?? '') === config.mensagem_indisponivel,
          );

          if (!inBusinessHours || !onlineAttendants) {
            let autoReply: 'unavailable' | null = null;
            if (!unavailableAlreadySent && !welcomeAlreadySent) {
              await this.sendAutoReply({
                conversationId: item.conversationId,
                phone: item.phone,
                text: config.mensagem_indisponivel,
              });
              autoReply = 'unavailable';
            }
            assignedAttendances.push({
              attendanceId: item.attendanceId,
              userId: null,
              autoReply,
              linkedLabelId: null,
            });
            continue;
          }

          if (!welcomeAlreadySent) {
            // Primeira mensagem nova em horário comercial com atendente online:
            // envia menu e aguarda a escolha do cliente antes de rodar o rodízio.
            await this.sendAutoReply({
              conversationId: item.conversationId,
              phone: item.phone,
              text: config.mensagem_boas_vindas,
            });
            assignedAttendances.push({
              attendanceId: item.attendanceId,
              userId: null,
              autoReply: 'welcome',
              linkedLabelId: null,
            });
            continue;
          }

          // Cliente respondeu após receber o menu: vincula etiqueta correspondente (se existir)
          // e executa o rodízio automático entre os atendentes online.
          const linkedLabelId = await linkMatchingLabel(
            this.db,
            item.conversationId,
            item.lastMessageText,
          );
          const assignedUserId = await assignByRotation(this.db, item.attendanceId, {
            isBusinessHours: true,
          });
          console.info('[rodizio]', {
            attendanceId: item.attendanceId,
            assignedUserId,
            linkedLabelId,
          });
          assignedAttendances.push({
            attendanceId: item.attendanceId,
            userId: assignedUserId,
            autoReply: null,
            linkedLabelId,
          });
        } catch (error) {
          this.logger.error('Automatic reply or assignment failed.', {
            attendanceId: item.attendanceId,
            code: isRecord(error) && typeof error.code === 'string' ? error.code : 'INTERNAL_ERROR',
          });
        }
      }
    }

    return {
      ...result,
      assignedAttendances,
    };
  }
}
