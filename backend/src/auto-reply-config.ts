import fs from 'node:fs/promises';
import path from 'node:path';

export interface AutoReplyConfig {
  horario_ativo: boolean;
  horario_inicio: string;
  horario_fim: string;
  mensagem_boas_vindas: string;
  mensagem_indisponivel: string;
}

export const DEFAULT_WELCOME_MESSAGE =
  'Olá, como podemos ajudar? \n - Informações Gerais \n -Pedidos Online';

export const DEFAULT_UNAVAILABLE_MESSAGE =
  'Olá, estamos indísponíveis no momento, em breve lhe atenderemos';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTime(value: unknown): value is string {
  return typeof value === 'string' && TIME_PATTERN.test(value);
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function getTimeInZone(date: Date, timeZone: string): { hour: number; minute: number } {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  }
  const parts = formatter.formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return { hour: hour === 24 ? 0 : hour, minute };
}

/**
 * Verifica se o instante `now` está dentro do horário comercial configurado
 * no fuso horário informado. Quando `horario_ativo` é `false`, não há restrição
 * de horário (retorna `true`).
 */
export function isWithinBusinessHours(
  config: Pick<AutoReplyConfig, 'horario_ativo' | 'horario_inicio' | 'horario_fim'>,
  timeZone = 'America/Sao_Paulo',
  now: Date = new Date(),
): boolean {
  if (!config.horario_ativo) return true;
  if (!isValidTime(config.horario_inicio) || !isValidTime(config.horario_fim)) return false;

  const start = toMinutes(config.horario_inicio);
  const end = toMinutes(config.horario_fim);
  if (start === end) return false;

  const { hour, minute } = getTimeInZone(now, timeZone);
  const current = hour * 60 + minute;

  if (start < end) {
    return current >= start && current < end;
  }
  // Faixa que cruza a meia-noite (ex.: 22:00 às 06:00)
  return current >= start || current < end;
}

function defaultConfigFromEnv(env: NodeJS.ProcessEnv): AutoReplyConfig {
  const envStart = env.BUSINESS_HOURS_START?.trim();
  const envEnd = env.BUSINESS_HOURS_END?.trim();
  const envActive = env.BUSINESS_HOURS_ENABLED?.trim().toLowerCase();

  return {
    horario_ativo: envActive === 'false' || envActive === '0' ? false : true,
    horario_inicio: isValidTime(envStart) ? envStart : '10:00',
    horario_fim: isValidTime(envEnd) ? envEnd : '22:00',
    mensagem_boas_vindas: DEFAULT_WELCOME_MESSAGE,
    mensagem_indisponivel: DEFAULT_UNAVAILABLE_MESSAGE,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class AutoReplyConfigService {
  private readonly defaults: AutoReplyConfig;
  private readonly storagePath: string | null;
  private cached: AutoReplyConfig | null = null;

  constructor(
    env: NodeJS.ProcessEnv = process.env,
    storagePath?: string | null,
  ) {
    this.defaults = defaultConfigFromEnv(env);
    if (storagePath !== undefined) {
      this.storagePath = storagePath;
    } else if (env.AUTO_REPLY_CONFIG_PATH !== undefined) {
      this.storagePath = env.AUTO_REPLY_CONFIG_PATH.trim() || null;
    } else {
      this.storagePath = path.resolve(process.cwd(), 'data', 'auto-reply-config.json');
    }
  }

  async get(): Promise<AutoReplyConfig> {
    if (this.cached) return { ...this.cached };

    if (this.storagePath) {
      try {
        const raw = await fs.readFile(this.storagePath, 'utf8');
        const parsed: unknown = JSON.parse(raw);
        if (isRecord(parsed)) {
          this.cached = {
            horario_ativo: typeof parsed.horario_ativo === 'boolean'
              ? parsed.horario_ativo
              : this.defaults.horario_ativo,
            horario_inicio: isValidTime(parsed.horario_inicio)
              ? parsed.horario_inicio
              : this.defaults.horario_inicio,
            horario_fim: isValidTime(parsed.horario_fim)
              ? parsed.horario_fim
              : this.defaults.horario_fim,
            mensagem_boas_vindas: typeof parsed.mensagem_boas_vindas === 'string' && parsed.mensagem_boas_vindas.trim()
              ? parsed.mensagem_boas_vindas
              : this.defaults.mensagem_boas_vindas,
            mensagem_indisponivel: typeof parsed.mensagem_indisponivel === 'string' && parsed.mensagem_indisponivel.trim()
              ? parsed.mensagem_indisponivel
              : this.defaults.mensagem_indisponivel,
          };
          return { ...this.cached };
        }
      } catch {
        // Arquivo ainda não existe ou não pôde ser lido: usa valores padrão.
      }
    }

    this.cached = { ...this.defaults };
    return { ...this.cached };
  }

  async update(input: Partial<Record<keyof AutoReplyConfig, unknown>>): Promise<AutoReplyConfig> {
    const current = await this.get();
    const next: AutoReplyConfig = { ...current };

    if (input.horario_ativo !== undefined) {
      if (typeof input.horario_ativo !== 'boolean') {
        throw new Error('horario_ativo deve ser um booleano.');
      }
      next.horario_ativo = input.horario_ativo;
    }

    if (input.horario_inicio !== undefined) {
      if (!isValidTime(input.horario_inicio)) {
        throw new Error('horario_inicio deve estar no formato HH:MM (00:00 a 23:59).');
      }
      next.horario_inicio = input.horario_inicio;
    }

    if (input.horario_fim !== undefined) {
      if (!isValidTime(input.horario_fim)) {
        throw new Error('horario_fim deve estar no formato HH:MM (00:00 a 23:59).');
      }
      next.horario_fim = input.horario_fim;
    }

    if (next.horario_inicio === next.horario_fim) {
      throw new Error('horario_inicio e horario_fim devem ser diferentes.');
    }

    if (input.mensagem_boas_vindas !== undefined) {
      if (typeof input.mensagem_boas_vindas !== 'string'
        || !input.mensagem_boas_vindas.trim()
        || [...input.mensagem_boas_vindas].length > 2048) {
        throw new Error('mensagem_boas_vindas deve ter entre 1 e 2048 caracteres.');
      }
      next.mensagem_boas_vindas = input.mensagem_boas_vindas;
    }

    if (input.mensagem_indisponivel !== undefined) {
      if (typeof input.mensagem_indisponivel !== 'string'
        || !input.mensagem_indisponivel.trim()
        || [...input.mensagem_indisponivel].length > 2048) {
        throw new Error('mensagem_indisponivel deve ter entre 1 e 2048 caracteres.');
      }
      next.mensagem_indisponivel = input.mensagem_indisponivel;
    }

    this.cached = next;

    if (this.storagePath) {
      try {
        await fs.mkdir(path.dirname(this.storagePath), { recursive: true });
        const tmpPath = `${this.storagePath}.${process.pid}.tmp`;
        await fs.writeFile(tmpPath, JSON.stringify(next, null, 2), 'utf8');
        await fs.rename(tmpPath, this.storagePath);
      } catch {
        // Fallback em memória caso o sistema de arquivos não permita escrita.
      }
    }

    return { ...next };
  }
}
