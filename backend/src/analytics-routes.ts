import { Router, type Request } from 'express';
import type { Pool } from 'mysql2/promise';
import {
  AuthenticationError,
  AuthorizationError,
  RequestValidationError,
} from './auth.js';
import { AnalyticsService } from './analytics-service.js';

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
const MAX_MINUTES = 10080;

function queryValue(req: Request, key: string): string | undefined {
  const value = req.query[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new RequestValidationError(`${key} must be provided once as a string.`);
  }
  return value;
}

function allowQueryKeys(req: Request, allowed: string[]): void {
  if (Object.keys(req.query).some((key) => !allowed.includes(key))) {
    throw new RequestValidationError('Unexpected query parameter.');
  }
}

function parsePositiveId(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(value) || Number(value) > 2147483647) {
    throw new RequestValidationError(`${name} must be a positive integer.`);
  }
  return Number(value);
}

function parseUserId(value: string | undefined): number | undefined {
  return parsePositiveId(value, 'usuarioId');
}

function parseDate(value: string | undefined, name: string): string {
  if (value === undefined || !DATE_FORMAT.test(value)) {
    throw new RequestValidationError(`${name} is required and must use YYYY-MM-DD.`);
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day) {
    throw new RequestValidationError(`${name} must be a valid calendar date.`);
  }
  return value;
}

function parseOptionalDate(value: string | undefined, name: string): string | undefined {
  if (value === undefined) return undefined;
  return parseDate(value, name);
}

function authenticatedUser(req: Request) {
  if (!req.authenticatedUser) throw new AuthenticationError();
  return req.authenticatedUser;
}

/**
 * Analytics API. The /api authentication middleware validates the JWT and
 * resolves the current profile before this router is reached.
 *
 * GET /api/relatorios/atendimentos?dataInicial=YYYY-MM-DD&dataFinal=YYYY-MM-DD&usuarioId=45
 * GET /api/dashboard/atendimentos?usuarioId=45
 * GET /api/alertas/atendimentos?minutos=30
 */
export function createAnalyticsRouter(db: Pool): Router {
  const router = Router();
  const analytics = new AnalyticsService(db);

  router.get('/relatorios/atendimentos', async (req, res) => {
    allowQueryKeys(req, ['dataInicial', 'dataFinal', 'usuarioId']);
    const user = authenticatedUser(req);
    const dataInicial = parseDate(queryValue(req, 'dataInicial'), 'dataInicial');
    const dataFinal = parseDate(queryValue(req, 'dataFinal'), 'dataFinal');
    if (dataInicial > dataFinal) {
      throw new RequestValidationError('dataInicial must be on or before dataFinal.');
    }
    const requestedUserId = parseUserId(queryValue(req, 'usuarioId'));
    const usuarioId = user.perfil === 'admin' ? requestedUserId : user.id_usuario;
    return res.json({
      data: await analytics.attendanceReport(dataInicial, dataFinal, usuarioId),
    });
  });

  router.get('/dashboard/atendimentos', async (req, res) => {
    allowQueryKeys(req, ['usuarioId', 'dataInicial', 'dataFinal', 'etiquetaId']);
    const user = authenticatedUser(req);
    if (user.perfil !== 'admin') throw new AuthorizationError();

    const usuarioId = parseUserId(queryValue(req, 'usuarioId'));
    const dataInicial = parseOptionalDate(queryValue(req, 'dataInicial'), 'dataInicial');
    const dataFinal = parseOptionalDate(queryValue(req, 'dataFinal'), 'dataFinal');
    if (dataInicial && dataFinal && dataInicial > dataFinal) {
      throw new RequestValidationError('dataInicial must be on or before dataFinal.');
    }
    const etiquetaId = parsePositiveId(queryValue(req, 'etiquetaId'), 'etiquetaId');

    return res.json({
      data: await analytics.attendanceDashboard({
        usuarioId,
        dataInicial,
        dataFinal,
        etiquetaId,
      }),
    });
  });

  router.get('/alertas/atendimentos', async (req, res) => {
    allowQueryKeys(req, ['minutos']);
    const user = authenticatedUser(req);
    const value = queryValue(req, 'minutos');
    const minutos = value === undefined ? 30 : Number(value);
    if (value !== undefined
      && (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(minutos) || minutos > MAX_MINUTES)) {
      throw new RequestValidationError(`minutos must be an integer between 1 and ${MAX_MINUTES}.`);
    }
    const usuarioId = user.perfil === 'admin' ? undefined : user.id_usuario;
    return res.json({ data: await analytics.attendanceAlerts(minutos, usuarioId) });
  });

  return router;
}
