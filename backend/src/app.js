import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { MessageService, WhatsAppDeliveryError } from './message-service.js';
import { WhatsAppClient } from './whatsapp.js';

const resources = {
  contatos: { table: 'CONTATO', id: 'id_contato', fields: ['nome', 'telefone', 'email'], required: ['nome', 'telefone'] },
  etiquetas: { table: 'ETIQUETA', id: 'id_etiqueta', fields: ['nome', 'cor'], required: ['nome'] },
  conversas: { table: 'CONVERSA', id: 'id_conversa', fields: [], required: [], deletable: false },
};

function fail(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function positiveInteger(value, name, max = 2147483647) {
  if (!/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > max) {
    throw fail(`${name} must be a positive integer up to ${max}.`);
  }
  return Number(value);
}

function validate(body, resource, partial) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('A JSON object is required.');
  if (Object.keys(body).some((key) => !resource.fields.includes(key))) throw fail('Unknown field.');
  const result = {};
  for (const [key, value] of Object.entries(body)) {
    if (value === null && !resource.required.includes(key)) {
      result[key] = null;
      continue;
    }
    if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > 2048) {
      throw fail(`${key} must be a non-empty string with at most 2048 characters.`);
    }
    result[key] = value.trim();
    if (key === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result[key])) throw fail('Invalid email.');
  }
  if (!partial && resource.required.some((key) => !result[key])) throw fail(`Required fields: ${resource.required.join(', ')}.`);
  if (!partial && resource.fields.length && !Object.keys(result).length) throw fail('At least one field is required.');
  if (partial && !Object.keys(result).length) throw fail('At least one field is required.');
  return result;
}

function matchesToken(actual, expected) {
  if (!actual || !expected) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function e164(value) {
  return typeof value === 'string' && /^\+[1-9]\d{7,14}$/.test(value);
}

export function createApp(db, logger = console, whatsappClient = new WhatsAppClient(), config = process.env) {
  const app = express();
  app.disable('x-powered-by');
  const messages = new MessageService(db, whatsappClient, logger);
  app.use('/api', (req, res, next) => {
    if (req.path === '/webhook/whatsapp') return next();
    if (!config.API_ACCESS_TOKEN) {
      return res.status(503).json({ error: 'API authentication is not configured.' });
    }
    const match = /^Bearer (.+)$/.exec(req.get('authorization') || '');
    if (!matchesToken(match?.[1], config.API_ACCESS_TOKEN)) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    return next();
  });
  app.use('/api/webhook/whatsapp', express.raw({ type: 'application/json', limit: '3mb' }));
  app.use(express.json({ limit: '32kb' }));
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/health/ready', async (_req, res) => {
    try {
      await db.execute('SELECT 1');
      res.json({ status: 'ok', database: 'connected' });
    } catch {
      res.status(503).json({ status: 'unavailable', database: 'disconnected' });
    }
  });

  app.get('/api/webhook/whatsapp', (req, res) => {
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

  app.post('/api/webhook/whatsapp', async (req, res) => {
    if (!whatsappClient.appSecret) {
      return res.status(503).json({ error: 'Webhook signature validation is not configured.' });
    }
    if (!whatsappClient.verifyWebhookSignature(req.body, req.get('x-hub-signature-256'))) {
      return res.status(401).json({ error: 'Invalid webhook signature.' });
    }
    try {
      let payload;
      try {
        payload = JSON.parse(req.body.toString('utf8'));
      } catch {
        return res.status(400).json({ error: 'Invalid webhook JSON.' });
      }
      const result = await messages.processWebhook(payload);
      return res.status(200).json({ status: 'received', ...result });
    } catch (error) {
      if (error.status === 400) return res.status(400).json({ error: error.message });
      logger.error('WhatsApp webhook processing failed.', { code: error.code || 'INTERNAL_ERROR' });
      return res.status(500).json({ error: 'Failed to process webhook.' });
    }
  });

  app.post('/api/mensagens/enviar', async (req, res) => {
    const { telefone, tipo, conteudo } = req.body ?? {};
    if (Object.keys(req.body ?? {}).some((key) => !['telefone', 'tipo', 'conteudo'].includes(key))
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
    try {
      const data = await messages.sendText({ phone: telefone, text: conteudo.trim() });
      return res.status(202).json({ data });
    } catch (error) {
      if (error instanceof WhatsAppDeliveryError) {
        return res.status(502).json({ error: 'WhatsApp provider rejected the message.' });
      }
      logger.error('WhatsApp message processing failed.', { code: error.code || 'INTERNAL_ERROR' });
      return res.status(500).json({ error: 'Failed to send message.' });
    }
  });

  for (const [path, resource] of Object.entries(resources)) {
    const { table, id } = resource;
    const route = `/api/${path}`;
    app.get(route, async (req, res) => {
      const limit = positiveInteger(req.query.limit ?? 20, 'limit', 100);
      const page = positiveInteger(req.query.page ?? 1, 'page', 1000000);
      const [rows] = await db.execute(`SELECT * FROM ${table} ORDER BY ${id} DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`);
      res.json({ data: rows, page, limit });
    });
    app.get(`${route}/:id`, async (req, res) => {
      const value = positiveInteger(req.params.id, 'id');
      const [rows] = await db.execute(`SELECT * FROM ${table} WHERE ${id} = ?`, [value]);
      if (!rows.length) return res.status(404).json({ error: 'Resource not found.' });
      res.json({ data: rows[0] });
    });
    if (resource.fields.length > 0) {
      app.post(route, async (req, res) => {
        const body = validate(req.body, resource, false);
        const fields = Object.keys(body);
        const dateField = path === 'contatos' ? ', cadastrado_em' : '';
        const dateValue = path === 'contatos' ? ', CURRENT_DATE()' : '';
        const [result] = await db.execute(
          `INSERT INTO ${table} (${fields.join(', ')}${dateField}) VALUES (${fields.map(() => '?').join(', ')}${dateValue})`,
          Object.values(body),
        );
        res.location(`${route}/${result.insertId}`).status(201).json({ data: { [id]: result.insertId, ...body } });
      });
      app.patch(`${route}/:id`, async (req, res) => {
        const value = positiveInteger(req.params.id, 'id');
        const body = validate(req.body, resource, true);
        const [result] = await db.execute(
          `UPDATE ${table} SET ${Object.keys(body).map((field) => `${field} = ?`).join(', ')} WHERE ${id} = ?`,
          [...Object.values(body), value],
        );
        if (!result.affectedRows) return res.status(404).json({ error: 'Resource not found.' });
        res.status(204).end();
      });
    }
    if (resource.deletable !== false) {
      app.delete(`${route}/:id`, async (req, res) => {
        const value = positiveInteger(req.params.id, 'id');
        const [result] = await db.execute(`DELETE FROM ${table} WHERE ${id} = ?`, [value]);
        if (!result.affectedRows) return res.status(404).json({ error: 'Resource not found.' });
        res.status(204).end();
      });
    }
  }
  app.use((_req, res) => res.status(404).json({ error: 'Route not found.' }));
  app.use((error, _req, res, _next) => {
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large.' });
    if (error.status === 413) return res.status(413).json({ error: 'Request body too large.' });
    if (error.status === 400) return res.status(400).json({ error: error.message });
    if (['ER_DUP_ENTRY', 'ER_ROW_IS_REFERENCED_2', 'ER_NO_REFERENCED_ROW_2'].includes(error.code)) {
      return res.status(409).json({ error: 'Database constraint conflict.' });
    }
    logger.error('Request failed', { code: error.code || 'INTERNAL_ERROR' });
    res.status(500).json({ error: 'Internal server error.' });
  });
  return app;
}
