import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import type { Pool, PoolConnection } from 'mysql2/promise';

interface ConversationRow extends RowDataPacket {
  id_conversa: number;
  criada_em: string;
  id_contato: number;
  telefone: string;
  nome: string | null;
  email: string | null;
  id_atendimento_aberto: number | null;
  status_atendimento: string | null;
  iniciado_em: string | null;
  prazo_retorno: string | null;
  ultima_mensagem_em: string | null;
}

interface AttendanceRow extends RowDataPacket {
  id_atendimento: number;
  status: string;
  iniciado_em: string;
  encerrado_em: string | null;
  prazo_retorno: string | null;
  FK_CONVERSA_id_conversa: number;
}

interface AssignmentRow extends RowDataPacket {
  id_atribuicao: number;
  iniciada_em: string;
  encerrada_em: string | null;
  FK_USUARIO_id_usuario: number;
  nome: string;
  email: string;
  perfil: string;
  FK_ATENDIMENTO_id_atendimento: number;
}

interface LabelRow extends RowDataPacket {
  id_etiqueta: number;
  nome: string;
  cor: string | null;
}

export interface ConversationView {
  id_conversa: number;
  criada_em: string;
  id_contato: number;
  telefone: string;
  nome: string | null;
  email: string | null;
  ultima_mensagem_em: string | null;
  atendimento_aberto: {
    id_atendimento: number;
    status: string | null;
    iniciado_em: string | null;
    prazo_retorno: string | null;
  } | null;
  responsaveis_ativos: AssignmentRow[];
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

function assignmentQuery(ids: number[]): string {
  return `SELECT a.id_atribuicao, a.iniciada_em, a.encerrada_em,
                 a.FK_USUARIO_id_usuario, u.nome, u.email, u.perfil,
                 a.FK_ATENDIMENTO_id_atendimento
          FROM ATRIBUICAO a
          JOIN USUARIO u ON u.id_usuario = a.FK_USUARIO_id_usuario
          WHERE a.FK_ATENDIMENTO_id_atendimento IN (${ids.map(() => '?').join(', ')})
          ORDER BY a.iniciada_em DESC, a.id_atribuicao DESC`;
}

const conversationSelect = `
  SELECT v.id_conversa, v.criada_em,
         c.id_contato, c.telefone, c.nome, c.email,
         a.id_atendimento AS id_atendimento_aberto,
         a.status AS status_atendimento,
         a.iniciado_em, a.prazo_retorno,
         ultima.data_hora AS ultima_mensagem_em
  FROM CONVERSA v
  JOIN CONTATO c ON c.id_contato = v.FK_CONTATO_id_contato
  LEFT JOIN ATENDIMENTO a ON a.id_atendimento = (
    SELECT aberto.id_atendimento FROM ATENDIMENTO aberto
    WHERE aberto.FK_CONVERSA_id_conversa = v.id_conversa AND aberto.encerrado_em IS NULL
    ORDER BY aberto.id_atendimento DESC LIMIT 1
  )
  LEFT JOIN MENSAGEM ultima ON ultima.id_mensagem = (
    SELECT recente.id_mensagem FROM MENSAGEM recente
    WHERE recente.FK_CONVERSA_id_conversa = v.id_conversa
    ORDER BY recente.data_hora DESC, recente.id_mensagem DESC LIMIT 1
  )`;

// Conversa visível ao atendente: atribuição ativa no atendimento aberto (alias "a").
const VISIBLE_TO_USER = `EXISTS (
  SELECT 1 FROM ATRIBUICAO vis
  WHERE vis.FK_ATENDIMENTO_id_atendimento = a.id_atendimento
    AND vis.FK_USUARIO_id_usuario = ? AND vis.encerrada_em IS NULL)`;

// Mesma regra para consultas que partem da conversa (alias "v").
const CONVERSATION_VISIBLE_TO_USER = `EXISTS (
  SELECT 1 FROM ATENDIMENTO ab
  JOIN ATRIBUICAO ar ON ar.FK_ATENDIMENTO_id_atendimento = ab.id_atendimento
  WHERE ab.FK_CONVERSA_id_conversa = v.id_conversa AND ab.encerrado_em IS NULL
    AND ar.FK_USUARIO_id_usuario = ? AND ar.encerrada_em IS NULL)`;

function withAssignments<T extends ConversationRow | AttendanceRow>(
  rows: T[],
  assignments: AssignmentRow[],
  idField: 'id_atendimento_aberto' | 'id_atendimento',
) {
  const byAttendance = new Map<number, AssignmentRow[]>();
  for (const assignment of assignments) {
    const list = byAttendance.get(assignment.FK_ATENDIMENTO_id_atendimento) ?? [];
    list.push(assignment);
    byAttendance.set(assignment.FK_ATENDIMENTO_id_atendimento, list);
  }
  return rows.map((row) => {
    const attendanceId = row[idField];
    const responsaveisAtivos = attendanceId === null
      ? []
      : (byAttendance.get(attendanceId) ?? []).filter((item) => item.encerrada_em === null);
    if (idField === 'id_atendimento_aberto') {
      const {
        id_atendimento_aberto: _id,
        status_atendimento: _status,
        iniciado_em,
        prazo_retorno,
        ...conversation
      } = row as ConversationRow;
      return {
        ...conversation,
        atendimento_aberto: attendanceId === null ? null : {
          id_atendimento: attendanceId,
          status: _status,
          iniciado_em,
          prazo_retorno,
        },
        responsaveis_ativos: responsaveisAtivos,
      };
    }
    return {
      ...row,
      atribuicoes: (byAttendance.get(Number(attendanceId)) ?? []),
      responsaveis_ativos: responsaveisAtivos,
    };
  });
}

export type AttendanceUpdate = { status?: 'open' | 'closed'; prazo_retorno?: string | null };
export type AddAssignmentResult =
  | { kind: 'created'; assignment: AssignmentRow }
  | { kind: 'exists' }
  | { kind: 'not-found' }
  | { kind: 'closed' }
  | { kind: 'inactive-user' };

export class ConversationService {
  constructor(private readonly db: Pool) {}

  async listConversations(
    page: number,
    limit: number,
    phone?: string,
    userId?: number,
  ): Promise<{ data: object[]; page: number; limit: number }> {
    const offset = (page - 1) * limit;
    const conditions: string[] = [];
    const values: (string | number)[] = [];
    if (phone) { conditions.push('c.telefone = ?'); values.push(phone); }
    if (userId !== undefined) { conditions.push(VISIBLE_TO_USER); values.push(userId); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await this.db.execute<ConversationRow[]>(
      `${conversationSelect} ${where}
      ORDER BY COALESCE(ultima.data_hora, v.criada_em) DESC, v.id_conversa DESC
      LIMIT ${limit} OFFSET ${offset}`,
      values,
    );
    const attendanceIds = rows
      .map((row) => row.id_atendimento_aberto)
      .filter((id): id is number => id !== null);
    const assignments = attendanceIds.length
      ? (await this.db.execute<AssignmentRow[]>(assignmentQuery(attendanceIds), attendanceIds))[0]
      : [];
    return { data: withAssignments(rows, assignments, 'id_atendimento_aberto'), page, limit };
  }

  async searchConversations(query: string, limit: number, userId?: number): Promise<{
    conversas: object[];
    mensagens: object[];
  }> {
    const term = `%${query}%`;
    const scope = userId === undefined ? '' : `AND ${VISIBLE_TO_USER}`;
    const messageScope = userId === undefined ? '' : `AND ${CONVERSATION_VISIBLE_TO_USER}`;
    const extra = userId === undefined ? [] : [userId];
    const [conversationRows] = await this.db.execute<ConversationRow[]>(
      `${conversationSelect}
       WHERE c.nome LIKE ? OR c.telefone LIKE ?
       ${scope}
       ORDER BY COALESCE(ultima.data_hora, v.criada_em) DESC, v.id_conversa DESC
       LIMIT ${limit}`,
      [term, term, ...extra],
    );
    const [messageRows] = await this.db.execute<RowDataPacket[]>(
      `SELECT m.id_mensagem, m.data_hora, m.conteudo, m.origem, m.status, m.tipo,
              m.FK_CONVERSA_id_conversa, u.nome AS nome_usuario,
              v.id_conversa, c.nome AS contato_nome, c.telefone AS contato_telefone
       FROM MENSAGEM m
       JOIN CONVERSA v ON v.id_conversa = m.FK_CONVERSA_id_conversa
       JOIN CONTATO c ON c.id_contato = v.FK_CONTATO_id_contato
       LEFT JOIN USUARIO u ON u.id_usuario = m.FK_USUARIO_id_usuario
       WHERE m.conteudo LIKE ?
       ORDER BY m.data_hora DESC, m.id_mensagem DESC
       LIMIT ${limit}`,
      [term, ...extra],
    );

    return {
      conversas: conversationRows.map((row) => ({
        id_conversa: row.id_conversa,
        criada_em: row.criada_em,
        id_contato: row.id_contato,
        telefone: row.telefone,
        nome: row.nome,
        email: row.email,
        ultima_mensagem_em: row.ultima_mensagem_em,
        atendimento_aberto: row.id_atendimento_aberto === null ? null : {
          id_atendimento: row.id_atendimento_aberto,
          status: row.status_atendimento,
          iniciado_em: row.iniciado_em,
          prazo_retorno: row.prazo_retorno,
        },
      })),
      mensagens: messageRows.map((row) => ({
        id_mensagem: row.id_mensagem,
        data_hora: row.data_hora,
        conteudo: row.conteudo,
        origem: row.origem,
        status: row.status,
        tipo: row.tipo,
        FK_CONVERSA_id_conversa: row.FK_CONVERSA_id_conversa,
        nome_usuario: row.nome_usuario ?? null,
        conversa: {
          id_conversa: row.id_conversa,
          nome: row.contato_nome,
          telefone: row.contato_telefone,
        },
      })),
    };
  }

  async getConversation(id: number): Promise<ConversationView | null> {
    const [rows] = await this.db.execute<ConversationRow[]>(
      `${conversationSelect} WHERE v.id_conversa = ? LIMIT 1`,
      [id],
    );
    if (!rows.length) return null;
    const row = rows[0];
    const assignments = row.id_atendimento_aberto === null
      ? []
      : (await this.db.execute<AssignmentRow[]>(
        assignmentQuery([row.id_atendimento_aberto]),
        [row.id_atendimento_aberto],
      ))[0];
    return {
      id_conversa: row.id_conversa,
      criada_em: row.criada_em,
      id_contato: row.id_contato,
      telefone: row.telefone,
      nome: row.nome,
      email: row.email,
      ultima_mensagem_em: row.ultima_mensagem_em,
      atendimento_aberto: row.id_atendimento_aberto === null ? null : {
        id_atendimento: row.id_atendimento_aberto,
        status: row.status_atendimento,
        iniciado_em: row.iniciado_em,
        prazo_retorno: row.prazo_retorno,
      },
      responsaveis_ativos: assignments.filter((assignment) => assignment.encerrada_em === null),
    };
  }

  async createConversation(phone: string): Promise<{ conversation: ConversationView; created: boolean }> {
    const { conversationId, created } = await inTransaction(this.db, async (connection) => {
      await connection.execute(
        `INSERT INTO CONTATO (telefone, nome, cadastrado_em)
         VALUES (?, NULL, CURRENT_DATE())
         ON DUPLICATE KEY UPDATE id_contato = LAST_INSERT_ID(id_contato)`,
        [phone],
      );
      const [contacts] = await connection.execute<RowDataPacket[]>(
        'SELECT id_contato FROM CONTATO WHERE telefone = ? FOR UPDATE',
        [phone],
      );
      if (!contacts.length) throw new Error('Contact upsert did not return a row.');
      const contactId = Number(contacts[0].id_contato);
      const [existing] = await connection.execute<RowDataPacket[]>(
        'SELECT id_conversa FROM CONVERSA WHERE FK_CONTATO_id_contato = ? FOR UPDATE',
        [contactId],
      );
      if (existing.length) {
        return { conversationId: Number(existing[0].id_conversa), created: false };
      }
      const [insertResult] = await connection.execute<ResultSetHeader>(
        `INSERT INTO CONVERSA (criada_em, FK_CONTATO_id_contato)
         VALUES (CURRENT_DATE(), ?)`,
        [contactId],
      );
      if (!insertResult.insertId) throw new Error('Conversation insert did not return an identifier.');
      const [conversations] = await connection.execute<RowDataPacket[]>(
        'SELECT id_conversa FROM CONVERSA WHERE FK_CONTATO_id_contato = ? FOR UPDATE',
        [contactId],
      );
      if (!conversations.length) throw new Error('Conversation upsert did not return a row.');
      return {
        conversationId: Number(conversations[0].id_conversa),
        created: true,
      };
    });
    const conversation = await this.getConversation(conversationId);
    if (!conversation) throw new Error('Conversation creation did not return a row.');
    return { conversation, created };
  }

  async listAttendances(
    conversationId: number,
    page: number,
    limit: number,
  ): Promise<{ data: object[]; page: number; limit: number } | null> {
    const [conversations] = await this.db.execute<RowDataPacket[]>(
      'SELECT id_conversa FROM CONVERSA WHERE id_conversa = ? LIMIT 1',
      [conversationId],
    );
    if (!conversations.length) return null;
    const offset = (page - 1) * limit;
    const [rows] = await this.db.execute<AttendanceRow[]>(
      `SELECT id_atendimento, status, iniciado_em, encerrado_em, prazo_retorno,
              FK_CONVERSA_id_conversa
       FROM ATENDIMENTO WHERE FK_CONVERSA_id_conversa = ?
       ORDER BY iniciado_em DESC, id_atendimento DESC LIMIT ${limit} OFFSET ${offset}`,
      [conversationId],
    );
    const assignments = rows.length
      ? (await this.db.execute<AssignmentRow[]>(assignmentQuery(rows.map((row) => row.id_atendimento)), rows.map((row) => row.id_atendimento)))[0]
      : [];
    return { data: withAssignments(rows, assignments, 'id_atendimento'), page, limit };
  }

  async openAttendance(conversationId: number): Promise<'not-found' | 'already-open' | number> {
    return inTransaction(this.db, async (connection) => {
      const [conversations] = await connection.execute<RowDataPacket[]>(
        'SELECT id_conversa FROM CONVERSA WHERE id_conversa = ? FOR UPDATE',
        [conversationId],
      );
      if (!conversations.length) return 'not-found';
      const [openRows] = await connection.execute<RowDataPacket[]>(
        `SELECT id_atendimento FROM ATENDIMENTO
         WHERE FK_CONVERSA_id_conversa = ? AND encerrado_em IS NULL
         ORDER BY id_atendimento DESC LIMIT 1 FOR UPDATE`,
        [conversationId],
      );
      if (openRows.length) return 'already-open';
      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO ATENDIMENTO (status, encerrado_em, iniciado_em, FK_CONVERSA_id_conversa)
         VALUES ('open', NULL, UTC_TIMESTAMP(), ?)`,
        [conversationId],
      );
      return result.insertId;
    });
  }

  async updateAttendance(id: number, input: AttendanceUpdate): Promise<'not-found' | 'closed' | boolean> {
    return inTransaction(this.db, async (connection) => {
      const [rows] = await connection.execute<AttendanceRow[]>(
        `SELECT id_atendimento, status, iniciado_em, encerrado_em, prazo_retorno,
                FK_CONVERSA_id_conversa
         FROM ATENDIMENTO WHERE id_atendimento = ? FOR UPDATE`,
        [id],
      );
      const attendance = rows[0];
      if (!attendance) return 'not-found';
      if (attendance.encerrado_em !== null && input.status === 'open') return 'closed';
      const changes: string[] = [];
      const values: (string | null)[] = [];
      if (input.status === 'closed') {
        changes.push("status = 'closed'", 'encerrado_em = COALESCE(encerrado_em, UTC_TIMESTAMP())');
      } else if (input.status === 'open') {
        changes.push("status = 'open'");
      }
      if (input.prazo_retorno !== undefined) {
        changes.push('prazo_retorno = ?');
        values.push(input.prazo_retorno);
      }
      if (changes.length) {
        await connection.execute(
          `UPDATE ATENDIMENTO SET ${changes.join(', ')} WHERE id_atendimento = ?`,
          [...values, id],
        );
      }
      return true;
    });
  }

  async listAssignments(attendanceId: number): Promise<AssignmentRow[] | null> {
    const [attendance] = await this.db.execute<AttendanceRow[]>(
      'SELECT id_atendimento, status, iniciado_em, encerrado_em, prazo_retorno, FK_CONVERSA_id_conversa FROM ATENDIMENTO WHERE id_atendimento = ? LIMIT 1',
      [attendanceId],
    );
    if (!attendance.length) return null;
    const [assignments] = await this.db.execute<AssignmentRow[]>(
      `SELECT a.id_atribuicao, a.iniciada_em, a.encerrada_em,
              a.FK_USUARIO_id_usuario, u.nome, u.email, u.perfil,
              a.FK_ATENDIMENTO_id_atendimento
       FROM ATRIBUICAO a
       JOIN USUARIO u ON u.id_usuario = a.FK_USUARIO_id_usuario
       WHERE a.FK_ATENDIMENTO_id_atendimento = ?
       ORDER BY a.iniciada_em DESC, a.id_atribuicao DESC`,
      [attendanceId],
    );
    return assignments;
  }

  async getAttendance(id: number): Promise<object | null> {
    const [rows] = await this.db.execute<AttendanceRow[]>(
      `SELECT id_atendimento, status, iniciado_em, encerrado_em, prazo_retorno,
              FK_CONVERSA_id_conversa
       FROM ATENDIMENTO WHERE id_atendimento = ? LIMIT 1`,
      [id],
    );
    if (!rows.length) return null;
    const assignments = await this.listAssignments(id);
    return {
      ...rows[0],
      atribuicoes: assignments ?? [],
      responsaveis_ativos: (assignments ?? []).filter((assignment) => assignment.encerrada_em === null),
    };
  }

  async addAssignment(attendanceId: number, userId: number): Promise<AddAssignmentResult> {
    return inTransaction(this.db, async (connection) => {
      const [attendances] = await connection.execute<AttendanceRow[]>(
        `SELECT id_atendimento, status, iniciado_em, encerrado_em, prazo_retorno,
                FK_CONVERSA_id_conversa
         FROM ATENDIMENTO WHERE id_atendimento = ? FOR UPDATE`,
        [attendanceId],
      );
      const attendance = attendances[0];
      if (!attendance) return { kind: 'not-found' };
      if (attendance.encerrado_em !== null) return { kind: 'closed' };
      const [users] = await connection.execute<RowDataPacket[]>(
        'SELECT id_usuario FROM USUARIO WHERE id_usuario = ? AND ativo = TRUE LIMIT 1 FOR UPDATE',
        [userId],
      );
      if (!users.length) return { kind: 'inactive-user' };
      const [existing] = await connection.execute<RowDataPacket[]>(
        `SELECT id_atribuicao FROM ATRIBUICAO
         WHERE FK_ATENDIMENTO_id_atendimento = ?
           AND FK_USUARIO_id_usuario = ? AND encerrada_em IS NULL
         LIMIT 1 FOR UPDATE`,
        [attendanceId, userId],
      );
      if (existing.length) return { kind: 'exists' };
      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO ATRIBUICAO
           (iniciada_em, encerrada_em, FK_USUARIO_id_usuario, FK_ATENDIMENTO_id_atendimento)
         VALUES (UTC_TIMESTAMP(), NULL, ?, ?)`,
        [userId, attendanceId],
      );
      const [rows] = await connection.execute<AssignmentRow[]>(
        `SELECT a.id_atribuicao, a.iniciada_em, a.encerrada_em,
                a.FK_USUARIO_id_usuario, u.nome, u.email, u.perfil,
                a.FK_ATENDIMENTO_id_atendimento
         FROM ATRIBUICAO a JOIN USUARIO u ON u.id_usuario = a.FK_USUARIO_id_usuario
         WHERE a.id_atribuicao = ?`,
        [result.insertId],
      );
      if (!rows.length) throw new Error('Assignment creation did not return a row.');
      return { kind: 'created', assignment: rows[0] };
    });
  }

  async closeAssignment(id: number): Promise<'not-found' | 'closed'> {
    return inTransaction(this.db, async (connection) => {
      const [rows] = await connection.execute<RowDataPacket[]>(
        'SELECT id_atribuicao FROM ATRIBUICAO WHERE id_atribuicao = ? FOR UPDATE',
        [id],
      );
      if (!rows.length) return 'not-found';
      await connection.execute(
        `UPDATE ATRIBUICAO SET encerrada_em = COALESCE(encerrada_em, UTC_TIMESTAMP())
         WHERE id_atribuicao = ?`,
        [id],
      );
      return 'closed';
    });
  }

  async listConversationLabels(conversationId: number): Promise<LabelRow[] | null> {
    const [conversations] = await this.db.execute<RowDataPacket[]>(
      'SELECT id_conversa FROM CONVERSA WHERE id_conversa = ? LIMIT 1',
      [conversationId],
    );
    if (!conversations.length) return null;
    const [labels] = await this.db.execute<LabelRow[]>(
      `SELECT e.id_etiqueta, e.nome, e.cor FROM ETIQUETA e
       JOIN marca m ON m.fk_ETIQUETA_id_etiqueta = e.id_etiqueta
       WHERE m.fk_CONVERSA_id_conversa = ? ORDER BY e.id_etiqueta`,
      [conversationId],
    );
    return labels;
  }

  async addConversationLabel(conversationId: number, labelId: number): Promise<'added' | 'missing-conversation' | 'missing-label'> {
    const [conversations] = await this.db.execute<RowDataPacket[]>(
      'SELECT id_conversa FROM CONVERSA WHERE id_conversa = ? LIMIT 1',
      [conversationId],
    );
    if (!conversations.length) return 'missing-conversation';
    const [labels] = await this.db.execute<RowDataPacket[]>(
      'SELECT id_etiqueta FROM ETIQUETA WHERE id_etiqueta = ? LIMIT 1',
      [labelId],
    );
    if (!labels.length) return 'missing-label';
    await this.db.execute(
      `INSERT INTO marca (fk_ETIQUETA_id_etiqueta, fk_CONVERSA_id_conversa)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE fk_CONVERSA_id_conversa = VALUES(fk_CONVERSA_id_conversa)`,
      [labelId, conversationId],
    );
    return 'added';
  }

  async removeConversationLabel(conversationId: number, labelId: number): Promise<'removed' | 'missing-conversation' | 'missing-association'> {
    const [result] = await this.db.execute<ResultSetHeader>(
      `DELETE FROM marca
       WHERE fk_CONVERSA_id_conversa = ? AND fk_ETIQUETA_id_etiqueta = ?`,
      [conversationId, labelId],
    );
    if (result.affectedRows) return 'removed';
    const [conversations] = await this.db.execute<RowDataPacket[]>(
      'SELECT id_conversa FROM CONVERSA WHERE id_conversa = ? LIMIT 1',
      [conversationId],
    );
    return conversations.length ? 'missing-association' : 'missing-conversation';
  }

  async userCanAccessConversation(userId: number, conversationId: number): Promise<boolean> {
    const [rows] = await this.db.execute<RowDataPacket[]>(
      `SELECT 1 FROM ATENDIMENTO a
      JOIN ATRIBUICAO r ON r.FK_ATENDIMENTO_id_atendimento = a.id_atendimento
      WHERE a.FK_CONVERSA_id_conversa = ? AND a.encerrado_em IS NULL
        AND r.FK_USUARIO_id_usuario = ? AND r.encerrada_em IS NULL
      LIMIT 1`,
      [conversationId, userId],
    );
    return rows.length > 0;
  }

  async conversationIdOfAttendance(attendanceId: number): Promise<number | null> {
    const [rows] = await this.db.execute<RowDataPacket[]>(
      'SELECT FK_CONVERSA_id_conversa AS id FROM ATENDIMENTO WHERE id_atendimento = ? LIMIT 1',
      [attendanceId],
    );
    return rows.length ? Number(rows[0].id) : null;
  }

  async conversationIdOfAssignment(assignmentId: number): Promise<number | null> {
    const [rows] = await this.db.execute<RowDataPacket[]>(
      `SELECT a.FK_CONVERSA_id_conversa AS id
      FROM ATRIBUICAO r JOIN ATENDIMENTO a ON a.id_atendimento = r.FK_ATENDIMENTO_id_atendimento
      WHERE r.id_atribuicao = ? LIMIT 1`,
      [assignmentId],
    );
    return rows.length ? Number(rows[0].id) : null;
  }

  /**
   * Garante um atendimento aberto e, se ninguém é responsável, atribui ao usuário.
   * Retorna false se outro atendente já é o responsável.
   */
  async claimConversation(conversationId: number, userId: number): Promise<boolean> {
    return inTransaction(this.db, async (connection) => {
      await connection.execute(
        'SELECT id_conversa FROM CONVERSA WHERE id_conversa = ? FOR UPDATE',
        [conversationId],
      );
      const [open] = await connection.execute<RowDataPacket[]>(
        `SELECT id_atendimento FROM ATENDIMENTO
        WHERE FK_CONVERSA_id_conversa = ? AND encerrado_em IS NULL
        ORDER BY id_atendimento DESC LIMIT 1 FOR UPDATE`,
        [conversationId],
      );
      let attendanceId: number;
      if (open.length) {
        attendanceId = Number(open[0].id_atendimento);
      } else {
        const [created] = await connection.execute<ResultSetHeader>(
          `INSERT INTO ATENDIMENTO (status, encerrado_em, iniciado_em, FK_CONVERSA_id_conversa)
          VALUES ('open', NULL, UTC_TIMESTAMP(), ?)`,
          [conversationId],
        );
        attendanceId = created.insertId;
      }
      const [active] = await connection.execute<RowDataPacket[]>(
        `SELECT r.FK_USUARIO_id_usuario FROM ATRIBUICAO r
        JOIN USUARIO u ON u.id_usuario = r.FK_USUARIO_id_usuario
        WHERE r.FK_ATENDIMENTO_id_atendimento = ? AND r.encerrada_em IS NULL AND u.ativo = TRUE
        FOR UPDATE`,
        [attendanceId],
      );
      if (active.some((row) => Number(row.FK_USUARIO_id_usuario) === userId)) return true;
      if (active.length) return false;
      await connection.execute(
        `INSERT INTO ATRIBUICAO
          (iniciada_em, encerrada_em, FK_USUARIO_id_usuario, FK_ATENDIMENTO_id_atendimento)
        VALUES (UTC_TIMESTAMP(), NULL, ?, ?)`,
        [userId, attendanceId],
      );
      return true;
    });
  }
}