import type { Pool } from 'mysql2/promise';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

export interface BusinessSettings {
  nome_perfil: string;
  email_contato: string;
  fuso_horario: string;
  numero_conta: string | null;
}

interface SettingsRow extends RowDataPacket, BusinessSettings {}

function validTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export class SettingsService {
  constructor(
    private readonly db: Pool,
    private readonly configuredAccountNumber: string | null = null,
  ) {}

  async get(): Promise<BusinessSettings> {
    const [rows] = await this.db.execute<SettingsRow[]>(
      `SELECT nome_perfil, email_contato, fuso_horario, numero_conta
       FROM CONFIGURACAO WHERE id_configuracao = 1 LIMIT 1`,
    );
    if (rows[0]) return rows[0];
    return {
      nome_perfil: '',
      email_contato: '',
      fuso_horario: 'America/Sao_Paulo',
      numero_conta: this.configuredAccountNumber,
    };
  }

  async update(input: Partial<BusinessSettings>): Promise<BusinessSettings> {
    if (input.nome_perfil !== undefined
      && (!input.nome_perfil.trim() || [...input.nome_perfil].length > 255)) {
      throw new Error('nome_perfil deve ser informado e ter até 255 caracteres.');
    }
    if (input.email_contato !== undefined
      && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email_contato.trim())
        || [...input.email_contato].length > 255)) {
      throw new Error('email_contato inválido.');
    }
    if (input.fuso_horario !== undefined && !validTimezone(input.fuso_horario)) {
      throw new Error('fuso_horario deve ser um identificador IANA válido.');
    }

    const current = await this.get();
    const next = { ...current, ...input };
    await this.db.execute<ResultSetHeader>(
      `INSERT INTO CONFIGURACAO
       (id_configuracao, nome_perfil, email_contato, fuso_horario, numero_conta)
       VALUES (1, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE nome_perfil = VALUES(nome_perfil),
         email_contato = VALUES(email_contato), fuso_horario = VALUES(fuso_horario),
         numero_conta = VALUES(numero_conta)`,
      [next.nome_perfil.trim(), next.email_contato.trim().toLowerCase(), next.fuso_horario, next.numero_conta],
    );
    return next;
  }
}
