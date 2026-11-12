import express, { type Request, type Response } from 'express';
import type { Pool } from 'mysql2/promise';
import {
  AuthService,
  AuthenticationError,
  AuthorizationError,
  RequestValidationError,
} from './auth.js';
import { ContactService } from './contact-service.js';
import { ConversationService } from './conversation-service.js';
import { createAnalyticsRouter } from './analytics-routes.js';
import {
  MessageConversationNotFoundError,
  MessageService,
  WhatsAppDeliveryError,
} from './message-service.js';
import { WhatsAppClient } from './whatsapp.js';

function fail(message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status: 400 });
}

function positiveInteger(value: unknown, name: string, max = 2147483647): number {
  if (!/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > max) {
    throw fail(`${name} must be a positive integer up to ${max}.`);
  }
  return Number(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function e164(value: unknown): value is string {
  return typeof value === 'string' && /^\+[1-9]\d{7,14}$/.test(value);
}

function mysqlDateTimeFromRfc3339(value: string): string | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!parts) return null;
  const [, yearPart, monthPart, dayPart, hourPart, minutePart, secondPart, , offsetHour, offsetMinute] = parts;
  const year = Number(yearPart);
  const month = Number(monthPart);
  const day = Number(dayPart);
  const hour = Number(hourPart);
  const minute = Number(minutePart);
  const second = Number(secondPart);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth
    || hour > 23 || minute > 59 || second > 59
    || (offsetHour !== undefined && Number(offsetHour) > 23)
    || (offsetMinute !== undefined && Number(offsetMinute) > 59)) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function errorInfo(error: unknown): { status?: number; code?: string; message?: string; type?: string } {
  if (!isRecord(error)) return {};
  return {
    status: typeof error.status === 'number' ? error.status : undefined,
    code: typeof error.code === 'string' ? error.code : undefined,
    message: typeof error.message === 'string' ? error.message : undefined,
    type: typeof error.type === 'string' ? error.type : undefined,
  };
}

export function createApp(
  db: Pool,
  logger: Pick<Console, 'error' | 'warn'> = console,
  whatsappClient: WhatsAppClient = new WhatsAppClient(),
  config: NodeJS.ProcessEnv = process.env,
) {
  const app = express();
  app.disable('x-powered-by');
  const messages = new MessageService(db, whatsappClient, logger);
  const contacts = new ContactService(db);
  const conversations = new ConversationService(db);
  const auth = new AuthService(db, config.JWT_SECRET ?? '');
  const corsOrigins = new Set(
    (config.CORS_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean),
  );
  if (corsOrigins.has('*')) throw new Error('CORS_ORIGINS must contain explicit origins, not a wildcard.');

  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && corsOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PATCH, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Expose-Headers', 'Location');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    return next();
  });

  app.use('/api', async (req, res, next) => {
    if (req.path === '/webhook/whatsapp'
      || (req.path === '/auth/login' && req.method === 'POST')) return next();
    try {
      req.authenticatedUser = await auth.authenticate(req.get('authorization'));
      return next();
    } catch (error) {
      if (error instanceof AuthenticationError) {
        return res.status(401).json({ error: 'Authentication required.' });
      }
      return next(error);
    }
  });
  app.use('/api/webhook/whatsapp', express.raw({ type: 'application/json', limit: '3mb' }));
  app.use(express.json({ limit: '32kb' }));

  app.get('/health', (_req: Request, res: Response) => res.json({ status: 'ok' }));
  app.get('/health/ready', async (_req: Request, res: Response) => {
    try {
      await db.execute('SELECT 1');
      res.json({ status: 'ok', database: 'connected' });
    } catch {
      res.status(503).json({ status: 'unavailable', database: 'disconnected' });
    }
  });

  app.post('/api/auth/login', async (req: Request, res: Response) => {
    const body = isRecord(req.body) ? req.body : {};
    if (Object.keys(body).some((key) => !['email', 'senha'].includes(key))
      || typeof body.email !== 'string'
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())
      || typeof body.senha !== 'string'
      || !body.senha) {
      return res.status(400).json({ error: 'Informe email e senha válidos.' });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ data: await auth.login(body.email, body.senha) });
  });
  app.get('/api/auth/me', (req: Request, res: Response) => {
    if (!req.authenticatedUser) throw new AuthenticationError();
    const { jti: _jti, ...user } = req.authenticatedUser;
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ data: user });
  });
  app.post('/api/auth/logout', async (req: Request, res: Response) => {
    if (!req.authenticatedUser) throw new AuthenticationError();
    await auth.logout(req.authenticatedUser.jti);
    return res.status(204).end();
  });
  app.patch('/api/auth/password', async (req: Request, res: Response) => {
    const body = isRecord(req.body) ? req.body : {};
    if (!req.authenticatedUser) throw new AuthenticationError();
    if (Object.keys(body).some((key) => !['senha_atual', 'nova_senha'].includes(key))
      || typeof body.senha_atual !== 'string'
      || typeof body.nova_senha !== 'string') {
      throw new RequestValidationError('Informe senha_atual e nova_senha.');
    }
    await auth.changePassword(req.authenticatedUser.id_usuario, body.senha_atual, body.nova_senha);
    return res.status(204).end();
  });

  app.get('/api/usuarios', async (req: Request, res: Response) => {
    if (req.authenticatedUser?.perfil !== 'admin') throw new AuthorizationError();
    const limit = positiveInteger(req.query.limit ?? 20, 'limit', 100);
    const page = positiveInteger(req.query.page ?? 1, 'page', 1000000);
    return res.json(await auth.listUsers(page, limit));
  });
  app.post('/api/usuarios', async (req: Request, res: Response) => {
    if (req.authenticatedUser?.perfil !== 'admin') throw new AuthorizationError();
    const body = isRecord(req.body) ? req.body : {};
    if (Object.keys(body).some((key) => !['nome', 'email', 'senha', 'perfil'].includes(key))
      || !['nome', 'email', 'senha', 'perfil'].every((key) => key in body)) {
      throw new RequestValidationError('Informe somente nome, email, senha e perfil.');
    }
    const data = await auth.createUser({
      nome: body.nome,
      email: body.email,
      senha: body.senha,
      perfil: body.perfil,
    });
    return res.location(`/api/usuarios/${data.id_usuario}`).status(201).json({ data });
  });
  app.get('/api/usuarios/:id', async (req: Request, res: Response) => {
    if (req.authenticatedUser?.perfil !== 'admin') throw new AuthorizationError();
    const id = positiveInteger(req.params.id, 'id');
    const data = await auth.getUser(id);
    if (!data) return res.status(404).json({ error: 'User not found.' });
    return res.json({ data });
  });
  app.patch('/api/usuarios/:id', async (req: Request, res: Response) => {
    if (req.authenticatedUser?.perfil !== 'admin') throw new AuthorizationError();
    const id = positiveInteger(req.params.id, 'id');
    const body = isRecord(req.body) ? req.body : {};
    if (Object.keys(body).some((key) => !['nome', 'email', 'perfil', 'ativo'].includes(key))) {
      throw new RequestValidationError('Campos de usuário inválidos.');
    }
    const updated = await auth.updateUser(id, {
      nome: body.nome,
      email: body.email,
      perfil: body.perfil,
      ativo: body.ativo,
    });
    if (!updated) return res.status(404).json({ error: 'User not found.' });
    return res.status(204).end();
  });

  app.get('/api/contatos', async (req: Request, res: Response) => {
    const limit = positiveInteger(req.query.limit ?? 20, 'limit', 100);
    const page = positiveInteger(req.query.page ?? 1, 'page', 1000000);
    return res.json(await contacts.listContacts(page, limit));
  });
  app.post('/api/contatos', async (req: Request, res: Response) => {
    const body = isRecord(req.body) ? req.body : {};
    if (Object.keys(body).some((key) => !['telefone', 'nome', 'email'].includes(key))
      || !e164(body.telefone)) {
      throw new RequestValidationError('telefone E.164 é obrigatório; campos permitidos: telefone, nome, email.');
    }
    const name = body.nome ?? null;
    const email = body.email ?? null;
    if (name !== null && (typeof name !== 'string' || !name.trim() || [...name.trim()].length > 255)) {
      throw new RequestValidationError('nome deve ter até 255 caracteres.');
    }
    if (email !== null && (typeof email !== 'string'
      || email.trim().length > 255
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))) {
      throw new RequestValidationError('email inválido.');
    }
    const data = await contacts.createContact({
      phone: body.telefone,
      name: typeof name === 'string' ? name.trim() : null,
      email: typeof email === 'string' ? email.trim() : null,
    });
    return res.location(`/api/contatos/${encodeURIComponent(data.telefone)}`).status(201).json({ data });
  });
  app.get('/api/contatos/:telefone/etiquetas', async (req: Request, res: Response) => {
    if (!e164(req.params.telefone)) throw new RequestValidationError('telefone E.164 inválido.');
    const data = await contacts.listContactLabels(req.params.telefone);
    if (data === null) return res.status(404).json({ error: 'Contact not found.' });
    return res.json({ data });
  });
  app.put('/api/contatos/:telefone/etiquetas/:etiquetaId', async (req: Request, res: Response) => {
    if (!e164(req.params.telefone)) throw new RequestValidationError('telefone E.164 inválido.');
    const labelId = positiveInteger(req.params.etiquetaId, 'etiquetaId');
    const result = await contacts.addContactLabel(req.params.telefone, labelId);
    if (result === 'missing-contact') return res.status(404).json({ error: 'Contact not found.' });
    if (result === 'missing-label') return res.status(404).json({ error: 'Label not found.' });
    return res.status(204).end();
  });
  app.delete('/api/contatos/:telefone/etiquetas/:etiquetaId', async (req: Request, res: Response) => {
    if (!e164(req.params.telefone)) throw new RequestValidationError('telefone E.164 inválido.');
    const labelId = positiveInteger(req.params.etiquetaId, 'etiquetaId');
    const result = await contacts.removeContactLabel(req.params.telefone, labelId);
    if (result === 'missing-contact') return res.status(404).json({ error: 'Contact not found.' });
    if (result === 'missing-association') return res.status(404).json({ error: 'Contact label not found.' });
    return res.status(204).end();
  });
  app.get('/api/contatos/:telefone', async (req: Request, res: Response) => {
    if (!e164(req.params.telefone)) throw new RequestValidationError('telefone E.164 inválido.');
    const data = await contacts.getContact(req.params.telefone);
    if (!data) return res.status(404).json({ error: 'Contact not found.' });
    return res.json({ data });
  });
  app.patch('/api/contatos/:telefone', async (req: Request, res: Response) => {
    if (!e164(req.params.telefone)) throw new RequestValidationError('telefone E.164 inválido.');
    const body = isRecord(req.body) ? req.body : {};
    if (!Object.keys(body).length || Object.keys(body).some((key) => !['nome', 'email'].includes(key))) {
      throw new RequestValidationError('Informe nome e/ou email; telefone não pode ser alterado.');
    }
    const name = body.nome;
    const email = body.email;
    if (name !== undefined && name !== null
      && (typeof name !== 'string' || !name.trim() || [...name.trim()].length > 255)) {
      throw new RequestValidationError('nome deve ter até 255 caracteres.');
    }
    if (email !== undefined && email !== null
      && (typeof email !== 'string'
        || email.trim().length > 255
        || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))) {
      throw new RequestValidationError('email inválido.');
    }
    const updated = await contacts.updateContact(req.params.telefone, {
      ...(name !== undefined ? { nome: typeof name === 'string' ? name.trim() : null } : {}),
      ...(email !== undefined ? { email: typeof email === 'string' ? email.trim() : null } : {}),
    });
    if (!updated) return res.status(404).json({ error: 'Contact not found.' });
    return res.status(204).end();
  });
  app.delete('/api/contatos/:telefone', async (req: Request, res: Response) => {
    if (req.authenticatedUser?.perfil !== 'admin') throw new AuthorizationError();
    if (!e164(req.params.telefone)) throw new RequestValidationError('telefone E.164 inválido.');
    const result = await contacts.deleteContact(req.params.telefone);
    if (result === 'not-found') return res.status(404).json({ error: 'Contact not found.' });
    if (result === 'has-history') return res.status(409).json({ error: 'Contact has conversation history.' });
    return res.status(204).end();
  });

  app.get('/api/etiquetas', async (req: Request, res: Response) => {
    const limit = positiveInteger(req.query.limit ?? 20, 'limit', 100);
    const page = positiveInteger(req.query.page ?? 1, 'page', 1000000);
    return res.json(await contacts.listLabels(page, limit));
  });
  app.post('/api/etiquetas', async (req: Request, res: Response) => {
    const body = isRecord(req.body) ? req.body : {};
    if (Object.keys(body).some((key) => !['nome', 'cor'].includes(key))
      || typeof body.nome !== 'string' || !body.nome.trim() || [...body.nome.trim()].length > 255) {
      throw new RequestValidationError('nome é obrigatório e deve ter até 255 caracteres.');
    }
    if (body.cor !== undefined && body.cor !== null
      && (typeof body.cor !== 'string' || [...body.cor.trim()].length > 255)) {
      throw new RequestValidationError('cor deve ter até 255 caracteres ou ser null.');
    }
    const data = await contacts.createLabel({
      nome: body.nome.trim(),
      cor: typeof body.cor === 'string' ? body.cor.trim() || null : null,
    });
    return res.location(`/api/etiquetas/${data.id_etiqueta}`).status(201).json({ data });
  });
  app.get('/api/etiquetas/:id', async (req: Request, res: Response) => {
    const id = positiveInteger(req.params.id, 'id');
    const data = await contacts.getLabel(id);
    if (!data) return res.status(404).json({ error: 'Label not found.' });
    return res.json({ data });
  });
  app.patch('/api/etiquetas/:id', async (req: Request, res: Response) => {
    const id = positiveInteger(req.params.id, 'id');
    const body = isRecord(req.body) ? req.body : {};
    if (!Object.keys(body).length || Object.keys(body).some((key) => !['nome', 'cor'].includes(key))) {
      throw new RequestValidationError('Informe nome e/ou cor.');
    }
    if (body.nome !== undefined
      && (typeof body.nome !== 'string' || !body.nome.trim() || [...body.nome.trim()].length > 255)) {
      throw new RequestValidationError('nome é obrigatório e deve ter até 255 caracteres.');
    }
    if (body.cor !== undefined && body.cor !== null
      && (typeof body.cor !== 'string' || [...body.cor.trim()].length > 255)) {
      throw new RequestValidationError('cor deve ter até 255 caracteres ou ser null.');
    }
    const updated = await contacts.updateLabel(id, {
      ...(typeof body.nome === 'string' ? { nome: body.nome.trim() } : {}),
      ...(body.cor !== undefined ? { cor: typeof body.cor === 'string' ? body.cor.trim() || null : null } : {}),
    });
    if (!updated) return res.status(404).json({ error: 'Label not found.' });
    return res.status(204).end();
  });
  app.delete('/api/etiquetas/:id', async (req: Request, res: Response) => {
    const id = positiveInteger(req.params.id, 'id');
    if (!(await contacts.deleteLabel(id))) return res.status(404).json({ error: 'Label not found.' });
    return res.status(204).end();
  });

  app.get('/api/notificacoes/resumo', async (req: Request, res: Response) => {
    const userId = req.authenticatedUser?.id_usuario;
    if (!userId) throw new AuthenticationError();
    res.setHeader('Cache-Control', 'no-store');
    return res.json(await conversations.getNotificationSummary(userId));
  });

  app.get('/api/conversas', async (req: Request, res: Response) => {
    const limit = positiveInteger(req.query.limit ?? 20, 'limit', 100);
    const page = positiveInteger(req.query.page ?? 1, 'page', 1000000);
    const phone = req.query.telefone;
    let phoneFilter: string | undefined;
    if (phone !== undefined) {
      if (!e164(phone)) throw new RequestValidationError('telefone E.164 inválido.');
      phoneFilter = phone;
    }
    return res.json(await conversations.listConversations(page, limit, phoneFilter));
  });
  app.post('/api/conversas', async (req: Request, res: Response) => {
    if (req.authenticatedUser?.perfil !== 'admin' && req.authenticatedUser?.perfil !== 'atendente') {
      throw new AuthorizationError();
    }
    const body = isRecord(req.body) ? req.body : {};
    if (Object.keys(body).length !== 1 || !e164(body.telefone)) {
      throw new RequestValidationError('Informe somente telefone no formato E.164.');
    }
    const { conversation, created } = await conversations.createConversation(body.telefone);
    if (!created) return res.status(200).json({ data: conversation });
    return res.location(`/api/conversas/${conversation.id_conversa}`).status(201).json({ data: conversation });
  });
  app.get('/api/conversas/:id', async (req: Request, res: Response) => {
    const id = positiveInteger(req.params.id, 'id');
    const data = await conversations.getConversation(id);
    if (!data) return res.status(404).json({ error: 'Conversation not found.' });
    return res.json({ data });
  });
  app.get('/api/conversas/:id/atendimentos', async (req: Request, res: Response) => {
    const id = positiveInteger(req.params.id, 'id');
    const limit = positiveInteger(req.query.limit ?? 20, 'limit', 100);
    const page = positiveInteger(req.query.page ?? 1, 'page', 1000000);
    const data = await conversations.listAttendances(id, page, limit);
    if (!data) return res.status(404).json({ error: 'Conversation not found.' });
    return res.json(data);
  });
  app.post('/api/conversas/:id/atendimentos', async (req: Request, res: Response) => {
    if (!req.authenticatedUser) throw new AuthenticationError();
    const id = positiveInteger(req.params.id, 'id');
    const body = isRecord(req.body) ? req.body : {};
    if (Object.keys(body).length) throw new RequestValidationError('A abertura do atendimento não recebe campos.');
    const result = await conversations.openAttendance(id);
    if (result === 'not-found') return res.status(404).json({ error: 'Conversation not found.' });
    if (result === 'already-open') return res.status(409).json({ error: 'Conversation already has an open attendance.' });
    const data = await conversations.getAttendance(result);
    if (!data) throw new Error('New attendance could not be read.');
    return res.location(`/api/atendimentos/${result}`).status(201).json({ data });
  });
  app.patch('/api/atendimentos/:id', async (req: Request, res: Response) => {
    if (!req.authenticatedUser) throw new AuthenticationError();
    const id = positiveInteger(req.params.id, 'id');
    const body = isRecord(req.body) ? req.body : {};
    if (!Object.keys(body).length || Object.keys(body).some((key) => !['status', 'prazo_retorno'].includes(key))) {
      throw new RequestValidationError('Informe status e/ou prazo_retorno.');
    }
    if (body.status !== undefined && body.status !== 'open' && body.status !== 'closed') {
      throw new RequestValidationError('status deve ser "open" ou "closed".');
    }
    let deadline: string | null | undefined;
    if (body.prazo_retorno === null) {
      deadline = null;
    } else if (body.prazo_retorno !== undefined) {
      if (typeof body.prazo_retorno !== 'string') {
        throw new RequestValidationError('prazo_retorno deve ser uma data RFC 3339 válida ou null.');
      }
      deadline = mysqlDateTimeFromRfc3339(body.prazo_retorno) ?? undefined;
      if (!deadline) throw new RequestValidationError('prazo_retorno deve ser uma data RFC 3339 válida ou null.');
    }
    const result = await conversations.updateAttendance(id, {
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(deadline !== undefined ? { prazo_retorno: deadline } : {}),
    });
    if (result === 'not-found') return res.status(404).json({ error: 'Attendance not found.' });
    if (result === 'closed') return res.status(409).json({ error: 'A closed attendance cannot be reopened.' });
    return res.status(204).end();
  });
  app.get('/api/atendimentos/:id/atribuicoes', async (req: Request, res: Response) => {
    const id = positiveInteger(req.params.id, 'id');
    const data = await conversations.listAssignments(id);
    if (!data) return res.status(404).json({ error: 'Attendance not found.' });
    return res.json({ data });
  });
  app.post('/api/atendimentos/:id/atribuicoes', async (req: Request, res: Response) => {
    if (!req.authenticatedUser) throw new AuthenticationError();
    const id = positiveInteger(req.params.id, 'id');
    const body = isRecord(req.body) ? req.body : {};
    if (Object.keys(body).length !== 1) throw new RequestValidationError('Informe somente usuarioId.');
    const userId = positiveInteger(body.usuarioId, 'usuarioId');
    const result = await conversations.addAssignment(id, userId);
    if (result.kind === 'not-found') return res.status(404).json({ error: 'Attendance not found.' });
    if (result.kind === 'closed') return res.status(409).json({ error: 'Cannot assign a closed attendance.' });
    if (result.kind === 'inactive-user') return res.status(404).json({ error: 'Active user not found.' });
    if (result.kind === 'exists') return res.status(204).end();
    return res.location(`/api/atribuicoes/${result.assignment.id_atribuicao}`)
      .status(201).json({ data: result.assignment });
  });
  app.delete('/api/atribuicoes/:id', async (req: Request, res: Response) => {
    if (!req.authenticatedUser) throw new AuthenticationError();
    const id = positiveInteger(req.params.id, 'id');
    if ((await conversations.closeAssignment(id)) === 'not-found') {
      return res.status(404).json({ error: 'Assignment not found.' });
    }
    return res.status(204).end();
  });
  app.get('/api/conversas/:id/etiquetas', async (req: Request, res: Response) => {
    const id = positiveInteger(req.params.id, 'id');
    const data = await conversations.listConversationLabels(id);
    if (!data) return res.status(404).json({ error: 'Conversation not found.' });
    return res.json({ data });
  });
  app.put('/api/conversas/:id/etiquetas/:etiquetaId', async (req: Request, res: Response) => {
    if (!req.authenticatedUser) throw new AuthenticationError();
    const conversationId = positiveInteger(req.params.id, 'id');
    const labelId = positiveInteger(req.params.etiquetaId, 'etiquetaId');
    const result = await conversations.addConversationLabel(conversationId, labelId);
    if (result === 'missing-conversation') return res.status(404).json({ error: 'Conversation not found.' });
    if (result === 'missing-label') return res.status(404).json({ error: 'Label not found.' });
    return res.status(204).end();
  });
  app.delete('/api/conversas/:id/etiquetas/:etiquetaId', async (req: Request, res: Response) => {
    if (!req.authenticatedUser) throw new AuthenticationError();
    const conversationId = positiveInteger(req.params.id, 'id');
    const labelId = positiveInteger(req.params.etiquetaId, 'etiquetaId');
    const result = await conversations.removeConversationLabel(conversationId, labelId);
    if (result === 'missing-conversation') return res.status(404).json({ error: 'Conversation not found.' });
    if (result === 'missing-association') return res.status(404).json({ error: 'Conversation label not found.' });
    return res.status(204).end();
  });

  app.get('/api/webhook/whatsapp', (req: Request, res: Response) => {
    if (!whatsappClient.verifyToken) {
      return res.status(503).json({ error: 'Webhook verification is not configured.' });
    }
    try {
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];
      return res.status(200).type('text/plain').send(whatsappClient.verifyWebhook(mode, token, challenge));
    } catch {
      return res.status(403).json({ error: 'Webhook verification failed.' });
    }
  });
  app.post('/api/webhook/whatsapp', async (req: Request, res: Response) => {
    if (!whatsappClient.appSecret) {
      return res.status(503).json({ error: 'Webhook signature validation is not configured.' });
    }
    if (!Buffer.isBuffer(req.body)
      || !whatsappClient.verifyWebhookSignature(req.body, req.get('x-hub-signature-256'))) {
      return res.status(401).json({ error: 'Invalid webhook signature.' });
    }
    try {
      let payload: unknown;
      try {
        payload = JSON.parse(req.body.toString('utf8'));
      } catch {
        return res.status(400).json({ error: 'Invalid webhook JSON.' });
      }
      const result = await messages.processWebhook(payload);
      return res.status(200).json({ status: 'received', ...result });
    } catch (error) {
      const details = errorInfo(error);
      if (details.status === 400) return res.status(400).json({ error: details.message });
      logger.error('WhatsApp webhook processing failed.', { code: details.code || 'INTERNAL_ERROR' });
      return res.status(500).json({ error: 'Failed to process webhook.' });
    }
  });

  app.get('/api/conversas/:id/mensagens', async (req: Request, res: Response) => {
    const conversationId = positiveInteger(req.params.id, 'id');
    const limit = positiveInteger(req.query.limit ?? 20, 'limit', 100);
    const page = positiveInteger(req.query.page ?? 1, 'page', 1000000);
    const result = await messages.listConversationMessages(conversationId, page, limit);
    if (!result) return res.status(404).json({ error: 'Conversation not found.' });
    return res.json(result);
  });
  app.post('/api/conversas/:id/mensagens', async (req: Request, res: Response) => {
    const conversationId = positiveInteger(req.params.id, 'id');
    const body = isRecord(req.body) ? req.body : {};
    if (Object.keys(body).some((key) => !['tipo', 'conteudo'].includes(key))
      || body.tipo !== 'text'
      || typeof body.conteudo !== 'string'
      || !body.conteudo.trim()
      || [...body.conteudo.trim()].length > 2048) {
      throw new RequestValidationError('Informe tipo "text" e conteúdo de 1 a 2048 caracteres.');
    }
    if (!whatsappClient.accessToken || !whatsappClient.phoneNumberId || !whatsappClient.graphApiVersion) {
      return res.status(503).json({ error: 'WhatsApp sending is not configured.' });
    }
    const userId = req.authenticatedUser?.id_usuario;
    if (!userId) throw new AuthenticationError();
    try {
      const data = await messages.sendText({
        conversationId,
        userId,
        text: body.conteudo.trim(),
      });
      return res.status(202).json({ data });
    } catch (error) {
      if (error instanceof MessageConversationNotFoundError) {
        return res.status(404).json({ error: 'Conversation not found.' });
      }
      if (error instanceof WhatsAppDeliveryError) {
        return res.status(502).json({ error: 'WhatsApp provider rejected the message.' });
      }
      logger.error('WhatsApp message processing failed.', { code: errorInfo(error).code || 'INTERNAL_ERROR' });
      return res.status(500).json({ error: 'Failed to send message.' });
    }
  });
  app.get('/api/mensagens/:id/status', async (req: Request, res: Response) => {
    const id = positiveInteger(req.params.id, 'id');
    const data = await messages.getMessageStatus(id);
    if (!data) return res.status(404).json({ error: 'Message not found.' });
    return res.json({ data });
  });
  app.get('/api/mensagens/:id', async (req: Request, res: Response) => {
    const id = positiveInteger(req.params.id, 'id');
    const data = await messages.getMessage(id);
    if (!data) return res.status(404).json({ error: 'Message not found.' });
    return res.json({ data });
  });
  app.get('/api/conversas/:id/anotacoes', async (req: Request, res: Response) => {
    const conversationId = positiveInteger(req.params.id, 'id');
    const limit = positiveInteger(req.query.limit ?? 20, 'limit', 100);
    const page = positiveInteger(req.query.page ?? 1, 'page', 1000000);
    const data = await messages.listAnnotations(conversationId, page, limit);
    if (!data) return res.status(404).json({ error: 'Conversation not found.' });
    return res.json(data);
  });
  app.post('/api/conversas/:id/anotacoes', async (req: Request, res: Response) => {
    const conversationId = positiveInteger(req.params.id, 'id');
    const body = isRecord(req.body) ? req.body : {};
    if (Object.keys(body).length !== 1 || typeof body.texto !== 'string'
      || !body.texto.trim() || [...body.texto.trim()].length > 255) {
      throw new RequestValidationError('texto é obrigatório e deve ter até 255 caracteres.');
    }
    const userId = req.authenticatedUser?.id_usuario;
    if (!userId) throw new AuthenticationError();
    const data = await messages.createAnnotation(conversationId, userId, body.texto.trim());
    if (!data) return res.status(404).json({ error: 'Conversation not found.' });
    return res.status(201).json({ data });
  });

  app.post('/api/mensagens/enviar', async (req: Request, res: Response) => {
    const body = isRecord(req.body) ? req.body : {};
    const { telefone, tipo, conteudo } = body;
    if (Object.keys(body).some((key) => !['telefone', 'tipo', 'conteudo'].includes(key))
      || !e164(telefone)
      || tipo !== 'text'
      || typeof conteudo !== 'string'
      || !conteudo.trim()
      || [...conteudo.trim()].length > 2048) {
      return res.status(400).json({ error: 'Provide an E.164 phone, type "text", and non-empty text up to 2048 characters.' });
    }
    if (!whatsappClient.accessToken || !whatsappClient.phoneNumberId || !whatsappClient.graphApiVersion) {
      return res.status(503).json({ error: 'WhatsApp sending is not configured.' });
    }
    const userId = req.authenticatedUser?.id_usuario;
    if (!userId) throw new AuthenticationError();
    try {
      const data = await messages.sendText({ phone: telefone, text: conteudo.trim(), userId });
      return res.status(202).json({ data });
    } catch (error) {
      if (error instanceof WhatsAppDeliveryError) {
        return res.status(502).json({ error: 'WhatsApp provider rejected the message.' });
      }
      logger.error('WhatsApp message processing failed.', { code: errorInfo(error).code || 'INTERNAL_ERROR' });
      return res.status(500).json({ error: 'Failed to send message.' });
    }
  });

  app.use('/api', createAnalyticsRouter(db));

  app.use((_req: Request, res: Response) => res.status(404).json({ error: 'Route not found.' }));
  app.use((error: unknown, _req: Request, res: Response, _next: (error?: unknown) => void) => {
    const requestError = errorInfo(error);
    if (requestError.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
    if (requestError.type === 'entity.too.large' || requestError.status === 413) {
      return res.status(413).json({ error: 'Request body too large.' });
    }
    if (requestError.status === 400) return res.status(400).json({ error: requestError.message });
    if (requestError.status === 401) return res.status(401).json({ error: 'Authentication required.' });
    if (requestError.status === 403) return res.status(403).json({ error: 'Insufficient permissions.' });
    if (['ER_DUP_ENTRY', 'ER_ROW_IS_REFERENCED_2', 'ER_NO_REFERENCED_ROW_2'].includes(requestError.code ?? '')) {
      return res.status(409).json({ error: 'Database constraint conflict.' });
    }
    logger.error('Request failed', { code: requestError.code || 'INTERNAL_ERROR' });
    return res.status(500).json({ error: 'Internal server error.' });
  });
  return app;
}
