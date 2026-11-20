import type { RowDataPacket } from 'mysql2';
import type { Pool } from 'mysql2/promise';

interface ReportRow extends RowDataPacket {
  id: number;
  nome: string;
  perfil?: 'admin' | 'atendente';
  conversas_totais?: number | string;
  conversas_ativas?: number | string;
  atendimentos_realizados: number | string;
  pendentes: number | string;
  tempo_medio_resposta_segundos: number | string | null;
  tempo_medio_atendimento_segundos: number | string | null;
  taxa_conclusao_percentual: number | string;
  sla_percentual: number | string;
}

interface DashboardRow extends RowDataPacket {
  id: number;
  nome: string;
  atendimentos_realizados: number | string;
}

interface TotalsRow extends RowDataPacket {
  total: number | string;
  conversas_totais?: number | string;
  conversas_ativas?: number | string;
  atendimentos_realizados: number | string;
  pendentes: number | string;
  tempo_medio_atendimento_segundos?: number | string | null;
  tempo_medio_resposta_segundos?: number | string | null;
}

export interface DashboardFilters {
  usuarioId?: number;
  dataInicial?: string;
  dataFinal?: string;
  etiquetaId?: number;
}

interface AlertRow extends RowDataPacket {
  id_atendimento: number;
  id_conversa: number;
  id_contato: number;
  nome: string | null;
  telefone: string;
  ultima_mensagem_em: string | null;
  minutos_sem_resposta: number | string;
}

function numberValue(value: number | string | null): number {
  return value === null ? 0 : Number(value);
}

const responseMetricsJoin = `
  LEFT JOIN (
    SELECT cliente_pos_bot.id_atendimento,
           cliente_pos_bot.msg_cliente_apos_bot AS primeira_mensagem_contato,
           MIN(resposta.data_hora) AS primeira_resposta_atendente
    FROM (
      SELECT bot_inicial.id_atendimento,
             bot_inicial.FK_CONVERSA_id_conversa,
             bot_inicial.iniciado_em,
             bot_inicial.encerrado_em,
             MIN(CASE
               WHEN mc.origem = 'contato'
                AND (bot_inicial.primeira_bot IS NULL OR mc.data_hora >= bot_inicial.primeira_bot)
               THEN mc.data_hora
             END) AS msg_cliente_apos_bot
      FROM (
        SELECT a2.id_atendimento, a2.FK_CONVERSA_id_conversa,
               a2.iniciado_em, a2.encerrado_em,
               MIN(CASE WHEN mb.origem = 'chatbot' THEN mb.data_hora END) AS primeira_bot
        FROM ATENDIMENTO a2
        LEFT JOIN MENSAGEM mb
          ON mb.FK_CONVERSA_id_conversa = a2.FK_CONVERSA_id_conversa
         AND mb.data_hora >= a2.iniciado_em
         AND (a2.encerrado_em IS NULL OR mb.data_hora <= a2.encerrado_em)
        WHERE a2.iniciado_em >= ?
          AND a2.iniciado_em < DATE_ADD(?, INTERVAL 1 DAY)
        GROUP BY a2.id_atendimento, a2.FK_CONVERSA_id_conversa,
                 a2.iniciado_em, a2.encerrado_em
      ) bot_inicial
      LEFT JOIN MENSAGEM mc
        ON mc.FK_CONVERSA_id_conversa = bot_inicial.FK_CONVERSA_id_conversa
       AND mc.data_hora >= bot_inicial.iniciado_em
       AND (bot_inicial.encerrado_em IS NULL OR mc.data_hora <= bot_inicial.encerrado_em)
      GROUP BY bot_inicial.id_atendimento, bot_inicial.FK_CONVERSA_id_conversa,
               bot_inicial.iniciado_em, bot_inicial.encerrado_em
    ) cliente_pos_bot
    LEFT JOIN MENSAGEM resposta
      ON resposta.FK_CONVERSA_id_conversa = cliente_pos_bot.FK_CONVERSA_id_conversa
     AND resposta.origem = 'usuario'
     AND resposta.data_hora >= cliente_pos_bot.msg_cliente_apos_bot
     AND resposta.data_hora >= cliente_pos_bot.iniciado_em
     AND (cliente_pos_bot.encerrado_em IS NULL
          OR resposta.data_hora <= cliente_pos_bot.encerrado_em)
    GROUP BY cliente_pos_bot.id_atendimento,
             cliente_pos_bot.msg_cliente_apos_bot
  ) respostas ON respostas.id_atendimento = a.id_atendimento`;

export class AnalyticsService {
  constructor(private readonly db: Pool) {}

  async attendanceReport(
    dataInicial: string,
    dataFinal: string,
    usuarioId?: number,
    etiquetaId?: number,
  ) {
    const userFilter = usuarioId === undefined ? '' : 'AND u.id_usuario = ?';
    const assignmentFilter = usuarioId === undefined ? '' : 'AND atr.FK_USUARIO_id_usuario = ?';
    const labelFilter = etiquetaId === undefined
      ? ''
      : `AND EXISTS (
           SELECT 1 FROM marca m_etq
           WHERE m_etq.fk_CONVERSA_id_conversa = a.FK_CONVERSA_id_conversa
             AND m_etq.fk_ETIQUETA_id_etiqueta = ?
         )`;
    const values: (string | number)[] = [dataInicial, dataFinal];
    if (usuarioId !== undefined) values.push(usuarioId);
    if (etiquetaId !== undefined) values.push(etiquetaId);
    values.push(dataInicial, dataFinal);
    if (usuarioId !== undefined) values.push(usuarioId);

    const [rows] = await this.db.execute<ReportRow[]>(
      `SELECT u.id_usuario AS id, u.nome, u.perfil,
              COUNT(DISTINCT a.FK_CONVERSA_id_conversa) AS conversas_totais,
              COUNT(DISTINCT CASE WHEN a.id_atendimento IS NOT NULL
                                    AND a.encerrado_em IS NULL
                                  THEN a.FK_CONVERSA_id_conversa END) AS conversas_ativas,
              COUNT(DISTINCT CASE WHEN a.encerrado_em IS NOT NULL
                                  THEN a.id_atendimento END) AS atendimentos_realizados,
              COUNT(DISTINCT CASE WHEN a.id_atendimento IS NOT NULL
                                    AND a.encerrado_em IS NULL
                                  THEN a.id_atendimento END) AS pendentes,
              ROUND(AVG(CASE
                WHEN respostas.primeira_mensagem_contato IS NOT NULL
                 AND respostas.primeira_resposta_atendente IS NOT NULL
                THEN TIMESTAMPDIFF(SECOND, respostas.primeira_mensagem_contato,
                                   respostas.primeira_resposta_atendente)
              END), 2) AS tempo_medio_resposta_segundos,
              ROUND(AVG(CASE WHEN a.encerrado_em IS NOT NULL
                THEN TIMESTAMPDIFF(SECOND, a.iniciado_em, a.encerrado_em)
              END), 2) AS tempo_medio_atendimento_segundos,
              COALESCE(ROUND(
                100 * COUNT(DISTINCT CASE WHEN a.encerrado_em IS NOT NULL
                                          THEN a.id_atendimento END)
                / NULLIF(COUNT(DISTINCT a.id_atendimento), 0), 2
              ), 0) AS taxa_conclusao_percentual,
              COALESCE(ROUND(
                100 * SUM(CASE
                  WHEN a.prazo_retorno IS NOT NULL
                   AND respostas.primeira_resposta_atendente IS NOT NULL
                   AND respostas.primeira_resposta_atendente <= a.prazo_retorno
                  THEN 1 ELSE 0 END)
                / NULLIF(SUM(CASE
                  WHEN a.prazo_retorno IS NOT NULL
                   AND (respostas.primeira_resposta_atendente IS NOT NULL
                        OR a.prazo_retorno <= UTC_TIMESTAMP())
                  THEN 1 ELSE 0 END), 0), 2
              ), 0) AS sla_percentual
       FROM USUARIO u
       LEFT JOIN (
         SELECT DISTINCT a.id_atendimento, a.FK_CONVERSA_id_conversa,
                a.iniciado_em, a.encerrado_em,
                a.prazo_retorno, atr.FK_USUARIO_id_usuario
         FROM ATENDIMENTO a
         JOIN ATRIBUICAO atr
           ON atr.FK_ATENDIMENTO_id_atendimento = a.id_atendimento
         WHERE a.iniciado_em >= ?
           AND a.iniciado_em < DATE_ADD(?, INTERVAL 1 DAY)
           ${assignmentFilter}
           ${labelFilter}
       ) a ON a.FK_USUARIO_id_usuario = u.id_usuario
       ${responseMetricsJoin}
       WHERE u.perfil IN ('atendente', 'admin') ${userFilter}
       GROUP BY u.id_usuario, u.nome, u.perfil
       ORDER BY atendimentos_realizados DESC,
                conversas_totais DESC,
                COALESCE(tempo_medio_resposta_segundos, 999999999) ASC,
                u.nome ASC,
                u.id_usuario ASC`,
      values,
    );

    return rows.map((row, index) => {
      const atendimentosRealizados = numberValue(row.atendimentos_realizados);
      const pendentes = numberValue(row.pendentes);
      return {
        posicao: index + 1,
        id: Number(row.id),
        nome: row.nome,
        perfil: row.perfil === 'admin' ? 'admin' : 'atendente',
        conversasTotais: row.conversas_totais !== undefined
          ? numberValue(row.conversas_totais)
          : atendimentosRealizados + pendentes,
        conversasAtivas: row.conversas_ativas !== undefined
          ? numberValue(row.conversas_ativas)
          : pendentes,
        atendimentosRealizados,
        pendentes,
        tempoMedioRespostaSegundos: numberValue(row.tempo_medio_resposta_segundos),
        tempoMedioAtendimentoSegundos: numberValue(row.tempo_medio_atendimento_segundos),
        taxaConclusaoPercentual: numberValue(row.taxa_conclusao_percentual),
        slaPercentual: numberValue(row.sla_percentual),
      };
    });
  }

  async attendanceDashboard(filters: DashboardFilters = {}) {
    const { usuarioId, dataInicial, dataFinal, etiquetaId } = filters;

    const attendanceConditions: string[] = [];
    const totalsValues: (string | number)[] = [];

    if (usuarioId !== undefined) {
      attendanceConditions.push(`EXISTS (
        SELECT 1 FROM ATRIBUICAO filtro
        WHERE filtro.FK_ATENDIMENTO_id_atendimento = a.id_atendimento
          AND filtro.FK_USUARIO_id_usuario = ?
      )`);
      totalsValues.push(usuarioId);
    }
    if (dataInicial !== undefined) {
      attendanceConditions.push('a.iniciado_em >= ?');
      totalsValues.push(dataInicial);
    }
    if (dataFinal !== undefined) {
      attendanceConditions.push('a.iniciado_em < DATE_ADD(?, INTERVAL 1 DAY)');
      totalsValues.push(dataFinal);
    }
    if (etiquetaId !== undefined) {
      attendanceConditions.push(`EXISTS (
        SELECT 1 FROM marca m_etq
        WHERE m_etq.fk_CONVERSA_id_conversa = a.FK_CONVERSA_id_conversa
          AND m_etq.fk_ETIQUETA_id_etiqueta = ?
      )`);
      totalsValues.push(etiquetaId);
    }

    const attendanceWhere = attendanceConditions.length
      ? `WHERE ${attendanceConditions.join(' AND ')}`
      : '';

    const rankingAttendanceConditions: string[] = [];
    const rankingValues: (string | number)[] = [];
    if (dataInicial !== undefined) {
      rankingAttendanceConditions.push('a.iniciado_em >= ?');
      rankingValues.push(dataInicial);
    }
    if (dataFinal !== undefined) {
      rankingAttendanceConditions.push('a.iniciado_em < DATE_ADD(?, INTERVAL 1 DAY)');
      rankingValues.push(dataFinal);
    }
    if (etiquetaId !== undefined) {
      rankingAttendanceConditions.push(`EXISTS (
        SELECT 1 FROM marca m_etq
        WHERE m_etq.fk_CONVERSA_id_conversa = a.FK_CONVERSA_id_conversa
          AND m_etq.fk_ETIQUETA_id_etiqueta = ?
      )`);
      rankingValues.push(etiquetaId);
    }
    const rankingJoinFilter = rankingAttendanceConditions.length
      ? `AND ${rankingAttendanceConditions.join(' AND ')}`
      : '';
    const rankingUserFilter = usuarioId === undefined ? '' : 'AND u.id_usuario = ?';
    if (usuarioId !== undefined) rankingValues.push(usuarioId);

    const [[totalsRows], [rankingRows]] = await Promise.all([
      this.db.execute<TotalsRow[]>(
        `SELECT COUNT(DISTINCT a.id_atendimento) AS total,
                COUNT(DISTINCT a.FK_CONVERSA_id_conversa) AS conversas_totais,
                COUNT(DISTINCT CASE WHEN a.encerrado_em IS NULL
                                    THEN a.FK_CONVERSA_id_conversa END) AS conversas_ativas,
                COUNT(DISTINCT CASE WHEN a.encerrado_em IS NOT NULL
                                    THEN a.id_atendimento END) AS atendimentos_realizados,
                COUNT(DISTINCT CASE WHEN a.encerrado_em IS NULL
                                    THEN a.id_atendimento END) AS pendentes,
                COALESCE(ROUND(AVG(CASE WHEN a.encerrado_em IS NOT NULL
                  THEN TIMESTAMPDIFF(SECOND, a.iniciado_em, a.encerrado_em)
                END), 2), 0) AS tempo_medio_atendimento_segundos,
                COALESCE(ROUND(AVG(CASE
                  WHEN respostas.msg_cliente_apos_bot IS NOT NULL
                   AND respostas.primeira_resposta_atendente IS NOT NULL
                  THEN TIMESTAMPDIFF(SECOND, respostas.msg_cliente_apos_bot,
                                     respostas.primeira_resposta_atendente)
                END), 2), 0) AS tempo_medio_resposta_segundos
         FROM ATENDIMENTO a
         LEFT JOIN (
           SELECT cliente_pos_bot.id_atendimento,
                  cliente_pos_bot.msg_cliente_apos_bot,
                  MIN(resposta.data_hora) AS primeira_resposta_atendente
           FROM (
             SELECT bot_inicial.id_atendimento,
                    bot_inicial.FK_CONVERSA_id_conversa,
                    bot_inicial.iniciado_em,
                    bot_inicial.encerrado_em,
                    MIN(CASE
                      WHEN mc.origem = 'contato'
                       AND (bot_inicial.primeira_bot IS NULL OR mc.data_hora >= bot_inicial.primeira_bot)
                      THEN mc.data_hora
                    END) AS msg_cliente_apos_bot
             FROM (
               SELECT a2.id_atendimento,
                      a2.FK_CONVERSA_id_conversa,
                      a2.iniciado_em,
                      a2.encerrado_em,
                      MIN(CASE WHEN mb.origem = 'chatbot' THEN mb.data_hora END) AS primeira_bot
               FROM ATENDIMENTO a2
               LEFT JOIN MENSAGEM mb
                 ON mb.FK_CONVERSA_id_conversa = a2.FK_CONVERSA_id_conversa
                AND mb.data_hora >= a2.iniciado_em
                AND (a2.encerrado_em IS NULL OR mb.data_hora <= a2.encerrado_em)
               GROUP BY a2.id_atendimento, a2.FK_CONVERSA_id_conversa,
                        a2.iniciado_em, a2.encerrado_em
             ) bot_inicial
             LEFT JOIN MENSAGEM mc
               ON mc.FK_CONVERSA_id_conversa = bot_inicial.FK_CONVERSA_id_conversa
              AND mc.data_hora >= bot_inicial.iniciado_em
              AND (bot_inicial.encerrado_em IS NULL OR mc.data_hora <= bot_inicial.encerrado_em)
             GROUP BY bot_inicial.id_atendimento, bot_inicial.FK_CONVERSA_id_conversa,
                      bot_inicial.iniciado_em, bot_inicial.encerrado_em
           ) cliente_pos_bot
           LEFT JOIN MENSAGEM resposta
             ON resposta.FK_CONVERSA_id_conversa = cliente_pos_bot.FK_CONVERSA_id_conversa
            AND resposta.origem = 'usuario'
            AND resposta.data_hora >= cliente_pos_bot.msg_cliente_apos_bot
            AND resposta.data_hora >= cliente_pos_bot.iniciado_em
            AND (cliente_pos_bot.encerrado_em IS NULL
                 OR resposta.data_hora <= cliente_pos_bot.encerrado_em)
           GROUP BY cliente_pos_bot.id_atendimento, cliente_pos_bot.msg_cliente_apos_bot
         ) respostas ON respostas.id_atendimento = a.id_atendimento
         ${attendanceWhere}`,
        totalsValues,
      ),
      this.db.execute<DashboardRow[]>(
        `SELECT u.id_usuario AS id, u.nome,
                COUNT(DISTINCT CASE WHEN a.encerrado_em IS NOT NULL
                                    THEN a.id_atendimento END) AS atendimentos_realizados
         FROM USUARIO u
         LEFT JOIN ATRIBUICAO atr
           ON atr.FK_USUARIO_id_usuario = u.id_usuario
         LEFT JOIN ATENDIMENTO a
           ON a.id_atendimento = atr.FK_ATENDIMENTO_id_atendimento
           ${rankingJoinFilter}
         WHERE u.perfil = 'atendente' ${rankingUserFilter}
         GROUP BY u.id_usuario, u.nome
         ORDER BY atendimentos_realizados DESC, u.nome, u.id_usuario`,
        rankingValues,
      ),
    ]);

    const totals = totalsRows[0];
    const total = numberValue(totals?.total ?? 0);
    const pendentes = numberValue(totals?.pendentes ?? 0);
    return {
      totais: {
        total,
        conversasTotais: totals?.conversas_totais !== undefined
          ? numberValue(totals.conversas_totais)
          : total,
        conversasAtivas: totals?.conversas_ativas !== undefined
          ? numberValue(totals.conversas_ativas)
          : pendentes,
        atendimentosRealizados: numberValue(totals?.atendimentos_realizados ?? 0),
        pendentes,
        tempoMedioAtendimentoSegundos: numberValue(totals?.tempo_medio_atendimento_segundos ?? 0),
        tempoMedioRespostaSegundos: numberValue(totals?.tempo_medio_resposta_segundos ?? 0),
      },
      ranking: rankingRows.map((row) => ({
        id: Number(row.id),
        nome: row.nome,
        atendimentosRealizados: numberValue(row.atendimentos_realizados),
      })),
    };
  }

  async attendanceAlerts(minutos: number, usuarioId?: number) {
    const assignmentFilter = usuarioId === undefined
      ? ''
      : `AND EXISTS (
           SELECT 1 FROM ATRIBUICAO propria
           WHERE propria.FK_ATENDIMENTO_id_atendimento = a.id_atendimento
             AND propria.FK_USUARIO_id_usuario = ?
             AND propria.encerrada_em IS NULL
         )`;
    const values: number[] = usuarioId === undefined ? [minutos] : [minutos, usuarioId];
    const [rows] = await this.db.execute<AlertRow[]>(
      `SELECT a.id_atendimento, v.id_conversa, c.id_contato, c.nome, c.telefone,
              ultima.data_hora AS ultima_mensagem_em,
              TIMESTAMPDIFF(MINUTE, COALESCE(ultima.data_hora, a.iniciado_em),
                           UTC_TIMESTAMP()) AS minutos_sem_resposta
       FROM ATENDIMENTO a
       JOIN CONVERSA v ON v.id_conversa = a.FK_CONVERSA_id_conversa
       JOIN CONTATO c ON c.id_contato = v.FK_CONTATO_id_contato
       LEFT JOIN MENSAGEM ultima ON ultima.id_mensagem = (
         SELECT recente.id_mensagem
         FROM MENSAGEM recente
         WHERE recente.FK_CONVERSA_id_conversa = v.id_conversa
         ORDER BY recente.data_hora DESC, recente.id_mensagem DESC
         LIMIT 1
       )
       WHERE a.encerrado_em IS NULL
         AND (ultima.id_mensagem IS NULL OR ultima.origem = 'contato')
         AND COALESCE(ultima.data_hora, a.iniciado_em)
             <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE)
         ${assignmentFilter}
       ORDER BY COALESCE(ultima.data_hora, a.iniciado_em), a.id_atendimento`,
      values,
    );
    return rows.map((row) => ({
      id_atendimento: Number(row.id_atendimento),
      id_conversa: Number(row.id_conversa),
      contato: {
        id: Number(row.id_contato),
        nome: row.nome,
        telefone: row.telefone,
      },
      ultimaMensagemEm: row.ultima_mensagem_em,
      minutosSemResposta: numberValue(row.minutos_sem_resposta),
    }));
  }
}
