import type { Pool } from 'mysql2/promise';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import type { MetaBusinessProfile, WhatsAppClient } from './whatsapp.js';

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
    private readonly whatsappClient?: WhatsAppClient,
  ) {}

  async get(): Promise<BusinessSettings> {
    let metaProfile: MetaBusinessProfile | null = null;
    if (this.whatsappClient?.isConfigured()) {
      try {
        metaProfile = await this.whatsappClient.getBusinessProfile();
      } catch {
        // Se a Meta API falhar, seguimos com fallback
      }
    }

    let dbRow: SettingsRow | undefined;
    try {
      const [rows] = await this.db.execute<SettingsRow[]>(
        `SELECT nome_perfil, email_contato, fuso_horario, numero_conta
         FROM CONFIGURACAO WHERE id_configuracao = 1 LIMIT 1`,
      );
      dbRow = rows[0];
    } catch {
      // Se a tabela CONFIGURACAO não existir, ignoramos para evitar erro 500
    }

    const numeroConta = dbRow?.numero_conta
      || metaProfile?.display_phone_number
      || this.configuredAccountNumber
      || null;

    const nomePerfil = dbRow?.nome_perfil
      || metaProfile?.verified_name
      || metaProfile?.about
      || '';

    const emailContato = dbRow?.email_contato
      || metaProfile?.email
      || '';

    const fusoHorario = dbRow?.fuso_horario
      || 'America/Sao_Paulo';

    return {
      nome_perfil: nomePerfil,
      email_contato: emailContato,
      fuso_horario: fusoHorario,
      numero_conta: numeroConta,
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

    if (this.whatsappClient?.isConfigured()) {
      const metaUpdate: { about?: string; email?: string } = {};
      if (input.nome_perfil !== undefined) metaUpdate.about = input.nome_perfil.trim();
      if (input.email_contato !== undefined) metaUpdate.email = input.email_contato.trim().toLowerCase();

      if (Object.keys(metaUpdate).length > 0) {
        await this.whatsappClient.updateBusinessProfile(metaUpdate);
      }
    }

    const current = await this.get();
    const next = { ...current, ...input };
    try {
      await this.db.execute<ResultSetHeader>(
        `INSERT INTO CONFIGURACAO
         (id_configuracao, nome_perfil, email_contato, fuso_horario, numero_conta)
         VALUES (1, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE nome_perfil = VALUES(nome_perfil),
           email_contato = VALUES(email_contato), fuso_horario = VALUES(fuso_horario),
           numero_conta = VALUES(numero_conta)`,
        [next.nome_perfil.trim(), next.email_contato.trim().toLowerCase(), next.fuso_horario, next.numero_conta],
      );
    } catch {
      // Se a tabela não existir no banco, não quebra com 500
    }
    return next;
  }
}
