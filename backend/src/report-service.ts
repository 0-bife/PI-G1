
import type { RowDataPacket } from 'mysql2';
import type { Pool } from 'mysql2/promise';

interface MessageReportRow extends RowDataPacket {
  data: string;
  recebidas: number | string;
  enviadas: number | string;
}

interface AttendanceReportRow extends RowDataPacket {
  total_atendimentos: number | string;
  atendimentos_encerrados: number | string;
  tempo_medio_segundos: number | string | null;
}

interface EmployeeReportRow extends RowDataPacket {
  id_usuario: number;
  nome: string;
  atendimentos_atribuidos: number | string;
}

export class ReportService {
  constructor(private readonly db: Pool) {}

  async getReport(days = 30) {
    if (!Number.isInteger(days) || days < 1 || days > 90) {
      throw new Error('Invalid report period.');
    }

    // Mensagens recebidas e enviadas agrupadas por dia.
    const [messageRows] = await this.db.execute<MessageReportRow[]>(
      `SELECT
         DATE_FORMAT(data_hora, '%Y-%m-%d') AS data,
         SUM(CASE WHEN origem = 'contato' THEN 1 ELSE 0 END) AS recebidas,
         SUM(CASE WHEN origem = 'usuario' THEN 1 ELSE 0 END) AS enviadas
       FROM MENSAGEM
       WHERE data_hora >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)
         AND data_hora <= UTC_TIMESTAMP()
       GROUP BY DATE(data_hora)
       ORDER BY DATE(data_hora) ASC`,
      [days],
    );

    // Quantidade de atendimentos e duração média dos encerrados.
    const [attendanceRows] = await this.db.execute<AttendanceReportRow[]>(
      `SELECT
         COUNT(*) AS total_atendimentos,
         SUM(CASE WHEN encerrado_em IS NOT NULL THEN 1 ELSE 0 END)
           AS atendimentos_encerrados,
         AVG(
           CASE
             WHEN encerrado_em IS NOT NULL
             THEN TIMESTAMPDIFF(SECOND, iniciado_em, encerrado_em)
             ELSE NULL
           END
         ) AS tempo_medio_segundos
       FROM ATENDIMENTO
       WHERE iniciado_em >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)
         AND iniciado_em <= UTC_TIMESTAMP()`,
      [days],
    );

    // Atendimentos atribuídos a cada funcionário no período.
    const [employeeRows] = await this.db.execute<EmployeeReportRow[]>(
      `SELECT
         u.id_usuario,
         u.nome,
         COUNT(DISTINCT a.id_atendimento) AS atendimentos_atribuidos
       FROM ATRIBUICAO atr
       JOIN USUARIO u
         ON u.id_usuario = atr.FK_USUARIO_id_usuario
       JOIN ATENDIMENTO a
         ON a.id_atendimento = atr.FK_ATENDIMENTO_id_atendimento
       WHERE a.iniciado_em >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)
         AND a.iniciado_em <= UTC_TIMESTAMP()
       GROUP BY u.id_usuario, u.nome
       ORDER BY atendimentos_atribuidos DESC, u.nome ASC
       LIMIT 10`,
      [days],
    );

    const attendance = attendanceRows[0];
    const totalAttendances = Number(attendance?.total_atendimentos ?? 0);
    const closedAttendances = Number(attendance?.atendimentos_encerrados ?? 0);

    const receivedMessages = messageRows.reduce(
      (total, row) => total + Number(row.recebidas),
      0,
    );

    const sentMessages = messageRows.reduce(
      (total, row) => total + Number(row.enviadas),
      0,
    );

    return {
      periodo_dias: days,

      mensagens: {
        total: receivedMessages + sentMessages,
        recebidas: receivedMessages,
        enviadas: sentMessages,
        por_dia: messageRows.map((row) => ({
          data: row.data,
          recebidas: Number(row.recebidas),
          enviadas: Number(row.enviadas),
        })),
      },

      atendimentos: {
        total: totalAttendances,
        encerrados: closedAttendances,
        taxa_resolucao: totalAttendances > 0
          ? Number(((closedAttendances / totalAttendances) * 100).toFixed(1))
          : 0,
        tempo_medio_segundos: attendance?.tempo_medio_segundos == null
          ? null
          : Math.round(Number(attendance.tempo_medio_segundos)),
      },

      desempenho: employeeRows.map((row) => ({
        id_usuario: row.id_usuario,
        nome: row.nome,
        atendimentos_atribuidos: Number(row.atendimentos_atribuidos),
      })),
    };
  }
}
