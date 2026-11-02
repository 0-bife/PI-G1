import type { Pool } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';

export interface AttendanceFilters {
  start: string;
  end: string;
  userId?: number;
}

interface ReportRow extends RowDataPacket {
  id_usuario: number | null;
  nome: string | null;
  atendimentos_realizados: number;
  atendimentos_pendentes: number;
  tempo_medio_resposta_segundos: number | null;
  tempo_medio_atendimento_segundos: number | null;
  taxa_conclusao: number | null;
  sla: number | null;
}

interface RankingRow extends RowDataPacket {
  id_usuario: number;
  nome: string;
  atendimentos_realizados: number;
  atendimentos_pendentes: number;
  taxa_conclusao: number | null;
  tempo_medio_resposta_segundos: number | null;
}

interface AlertRow extends RowDataPacket {
  id_atendimento: number;
  id_conversa: number;
  id_usuario: number;
  nome: string;
  telefone: string;
  iniciado_em: string;
  ultima_mensagem_em: string | null;
  prazo_retorno: string | null;
  minutos_sem_resposta: number;
}

function metric(value: number | null): number | null {
  return value === null ? null : Number(value);
}

export class AnalyticsService {
  constructor(private readonly db: Pool) {}

  async attendanceReport(filters: AttendanceFilters) {
    const userClause = filters.userId === undefined ? '' : 'AND u.id_usuario = ?';
    const values = filters.userId === undefined
      ? [filters.start, filters.end]
      : [filters.start, filters.end, filters.userId];
    const [rows] = await this.db.execute<ReportRow[]>(
      `SELECT u.id_usuario, u.nome,
              SUM(CASE WHEN a.encerrado_em IS NOT NULL THEN 1 ELSE 0 END) AS atendimentos_realizados,
              SUM(CASE WHEN a.encerrado_em IS NULL THEN 1 ELSE 0 END) AS atendimentos_pendentes,
              AVG(CASE WHEN first_in.recebida_em IS NOT NULL AND first_out.respondida_em IS NOT NULL
                       THEN TIMESTAMPDIFF(SECOND, first_in.recebida_em, first_out.respondida_em) END)
                AS tempo_medio_resposta_segundos,
              AVG(CASE WHEN a.encerrado_em IS NOT NULL
                       THEN TIMESTAMPDIFF(SECOND, a.iniciado_em, a.encerrado_em) END)
                AS tempo_medio_atendimento_segundos,
              100 * SUM(CASE WHEN a.encerrado_em IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*) AS taxa_conclusao,
              100 * SUM(CASE WHEN a.encerrado_em IS NOT NULL
                              AND (a.prazo_retorno IS NULL OR a.encerrado_em <= a.prazo_retorno)
                             THEN 1 ELSE 0 END)
                / NULLIF(SUM(CASE WHEN a.encerrado_em IS NOT NULL THEN 1 ELSE 0 END), 0) AS sla
       FROM ATENDIMENTO a
       JOIN ATRIBUICAO ass ON ass.FK_ATENDIMENTO_id_atendimento = a.id_atendimento
         AND ass.encerrada_em IS NULL
       JOIN USUARIO u ON u.id_usuario = ass.FK_USUARIO_id_usuario
       LEFT JOIN (
         SELECT a1.id_atendimento, MIN(m.data_hora) AS recebida_em
         FROM ATENDIMENTO a1
         JOIN MENSAGEM m ON m.FK_CONVERSA_id_conversa = a1.FK_CONVERSA_id_conversa
           AND m.origem = 'contato' AND m.data_hora >= a1.iniciado_em
         GROUP BY a1.id_atendimento
       ) first_in ON first_in.id_atendimento = a.id_atendimento
       LEFT JOIN (
         SELECT a2.id_atendimento, MIN(m2.data_hora) AS respondida_em
         FROM ATENDIMENTO a2
         JOIN MENSAGEM m2 ON m2.FK_CONVERSA_id_conversa = a2.FK_CONVERSA_id_conversa
           AND m2.origem = 'usuario' AND m2.data_hora >= a2.iniciado_em
         GROUP BY a2.id_atendimento
       ) first_out ON first_out.id_atendimento = a.id_atendimento
       WHERE a.iniciado_em >= ? AND a.iniciado_em < ? ${userClause}
       GROUP BY u.id_usuario, u.nome
       ORDER BY u.nome`,
      values,
    );
    return rows.map((row) => ({
      id_usuario: row.id_usuario,
      nome: row.nome,
      atendimentos_realizados: Number(row.atendimentos_realizados),
      atendimentos_pendentes: Number(row.atendimentos_pendentes),
      tempo_medio_resposta_segundos: metric(row.tempo_medio_resposta_segundos),
      tempo_medio_atendimento_segundos: metric(row.tempo_medio_atendimento_segundos),
      taxa_conclusao: metric(row.taxa_conclusao),
      sla: metric(row.sla),
    }));
  }

  async dashboard(userId?: number) {
    const userClause = userId === undefined ? '' : 'WHERE u.id_usuario = ?';
    const [ranking] = await this.db.execute<RankingRow[]>(
      `SELECT u.id_usuario, u.nome,
              SUM(CASE WHEN a.encerrado_em IS NOT NULL THEN 1 ELSE 0 END) AS atendimentos_realizados,
              SUM(CASE WHEN a.encerrado_em IS NULL THEN 1 ELSE 0 END) AS atendimentos_pendentes,
              100 * SUM(CASE WHEN a.encerrado_em IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*) AS taxa_conclusao,
              AVG(CASE WHEN first_in.recebida_em IS NOT NULL AND first_out.respondida_em IS NOT NULL
                       THEN TIMESTAMPDIFF(SECOND, first_in.recebida_em, first_out.respondida_em) END)
                AS tempo_medio_resposta_segundos
       FROM USUARIO u
       LEFT JOIN ATRIBUICAO ass ON ass.FK_USUARIO_id_usuario = u.id_usuario
       LEFT JOIN ATENDIMENTO a ON a.id_atendimento = ass.FK_ATENDIMENTO_id_atendimento
       LEFT JOIN (
         SELECT a1.id_atendimento, MIN(m.data_hora) AS recebida_em
         FROM ATENDIMENTO a1 JOIN MENSAGEM m
           ON m.FK_CONVERSA_id_conversa = a1.FK_CONVERSA_id_conversa AND m.origem = 'contato'
         GROUP BY a1.id_atendimento
       ) first_in ON first_in.id_atendimento = a.id_atendimento
       LEFT JOIN (
         SELECT a2.id_atendimento, MIN(m2.data_hora) AS respondida_em
         FROM ATENDIMENTO a2 JOIN MENSAGEM m2
           ON m2.FK_CONVERSA_id_conversa = a2.FK_CONVERSA_id_conversa AND m2.origem = 'usuario'
         GROUP BY a2.id_atendimento
       ) first_out ON first_out.id_atendimento = a.id_atendimento
       ${userClause}
       GROUP BY u.id_usuario, u.nome
       ORDER BY atendimentos_realizados DESC, u.nome`,
      userId === undefined ? [] : [userId],
    );
    const [totals] = await this.db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total_atendimentos,
              SUM(CASE WHEN encerrado_em IS NULL THEN 1 ELSE 0 END) AS atendimentos_pendentes
       FROM ATENDIMENTO`,
    );
    return {
      totais: {
        total_atendimentos: Number(totals[0]?.total_atendimentos ?? 0),
        atendimentos_pendentes: Number(totals[0]?.atendimentos_pendentes ?? 0),
      },
      ranking: ranking.map((row) => ({
        ...row,
        atendimentos_realizados: Number(row.atendimentos_realizados ?? 0),
        atendimentos_pendentes: Number(row.atendimentos_pendentes ?? 0),
        taxa_conclusao: metric(row.taxa_conclusao),
        tempo_medio_resposta_segundos: metric(row.tempo_medio_resposta_segundos),
      })),
    };
  }

  async alerts(minutes: number, userId?: number) {
    const userClause = userId === undefined ? '' : 'AND u.id_usuario = ?';
    const [rows] = await this.db.execute<AlertRow[]>(
      `SELECT a.id_atendimento, v.id_conversa, u.id_usuario, u.nome, c.telefone,
              a.iniciado_em, ultima.data_hora AS ultima_mensagem_em, a.prazo_retorno,
              TIMESTAMPDIFF(MINUTE, COALESCE(ultima.data_hora, a.iniciado_em), UTC_TIMESTAMP())
                AS minutos_sem_resposta
       FROM ATENDIMENTO a
       JOIN CONVERSA v ON v.id_conversa = a.FK_CONVERSA_id_conversa
       JOIN CONTATO c ON c.id_contato = v.FK_CONTATO_id_contato
       JOIN ATRIBUICAO ass ON ass.FK_ATENDIMENTO_id_atendimento = a.id_atendimento
         AND ass.encerrada_em IS NULL
       JOIN USUARIO u ON u.id_usuario = ass.FK_USUARIO_id_usuario
       LEFT JOIN MENSAGEM ultima ON ultima.id_mensagem = (
         SELECT m.id_mensagem FROM MENSAGEM m
         WHERE m.FK_CONVERSA_id_conversa = v.id_conversa
         ORDER BY m.data_hora DESC, m.id_mensagem DESC LIMIT 1
       )
       WHERE a.encerrado_em IS NULL
         AND (ultima.id_mensagem IS NULL OR ultima.origem = 'contato')
         AND TIMESTAMPDIFF(MINUTE, COALESCE(ultima.data_hora, a.iniciado_em), UTC_TIMESTAMP()) >= ?
         ${userClause}
       ORDER BY minutos_sem_resposta DESC, a.id_atendimento`,
      userId === undefined ? [minutes] : [minutes, userId],
    );
    return rows.map((row) => ({ ...row, minutos_sem_resposta: Number(row.minutos_sem_resposta) }));
  }
}
