import type { PoolConnection } from 'mysql2/promise';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

interface AgentRow extends RowDataPacket {
  id_usuario: number;
}

/**
 * Selects the active attendant with the fewest open assignments.
 * The user rows are locked by the surrounding transaction so concurrent
 * attendance creation cannot select the same queue position indefinitely.
 */
export async function assignRoundRobin(
  connection: PoolConnection,
  attendanceId: number,
): Promise<number | null> {
  const [agents] = await connection.execute<AgentRow[]>(
    `SELECT id_usuario
     FROM USUARIO
     WHERE ativo = TRUE AND perfil = 'atendente'
     ORDER BY id_usuario
     FOR UPDATE`,
  );
  if (!agents.length) return null;

  const [candidates] = await connection.execute<AgentRow[]>(
    `SELECT u.id_usuario
     FROM USUARIO u
     LEFT JOIN ATRIBUICAO a
       ON a.FK_USUARIO_id_usuario = u.id_usuario AND a.encerrada_em IS NULL
     WHERE u.ativo = TRUE AND u.perfil = 'atendente'
     GROUP BY u.id_usuario
     ORDER BY COUNT(a.id_atribuicao) ASC,
              COALESCE(MAX(a.iniciada_em), '1000-01-01') ASC,
              u.id_usuario ASC
     LIMIT 1`,
  );
  const selected = candidates[0] ?? agents[0];
  const [result] = await connection.execute<ResultSetHeader>(
    `INSERT INTO ATRIBUICAO
       (iniciada_em, encerrada_em, FK_USUARIO_id_usuario, FK_ATENDIMENTO_id_atendimento)
     VALUES (UTC_TIMESTAMP(), NULL, ?, ?)`,
    [selected.id_usuario, attendanceId],
  );
  if (!result.affectedRows) throw new Error('Round-robin assignment was not created.');
  return selected.id_usuario;
}
