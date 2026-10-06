import express from 'express';
import { WhatsAppClient } from './whatsapp.js';

const resources = {
  contatos: { table: 'CONTATO', id: 'id_contato', fields: ['nome', 'telefone', 'email'], required: ['nome', 'telefone'] },
  etiquetas: { table: 'ETIQUETA', id: 'id_etiqueta', fields: ['nome', 'cor'], required: ['nome'] },
  conversas: { table: 'CONVERSA', id: 'id_conversa', fields: [], required: [] },
  mensagens: { table: 'MENSAGEM', id: 'id_mensagem', fields: ['conteudo', 'origem', 'status', 'tipo', 'referencia_midia'], required: ['conteudo', 'origem', 'tipo'] },
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
  return result;
}

export function createApp(db, logger = console, whatsappClient = new WhatsAppClient()) {
  const app = express();
  app.disable('x-powered-by');
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

  // WhatsApp Webhook Endpoints
  app.get('/api/webhook/whatsapp', (req, res) => {
    try {
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];
      const challengeResponse = whatsappClient.verifyWebhook(mode, token, challenge);
      res.status(200).send(challengeResponse);
    } catch (err) {
      res.status(403).json({ error: err.message });
    }
  });

  app.post('/api/webhook/whatsapp', async (req, res) => {
    try {
      const parsed = whatsappClient.parseIncomingWebhook(req.body);
      if (parsed) {
        // Automatically store incoming message in DB
        await db.execute(
          'INSERT INTO MENSAGEM (conteudo, origem, status, tipo, data_hora) VALUES (?, ?, ?, ?, NOW())',
          [parsed.text, 'whatsapp', 'received', parsed.type]
        );
      }
      res.status(200).json({ status: 'received' });
    } catch (err) {
      logger.error('Webhook error:', err);
      res.status(500).json({ error: 'Failed to process webhook' });
    }
  });

  // Send message endpoint
  app.post('/api/messages/send', async (req, res) => {
    try {
      const { to, text } = req.body;
      if (!to || !text) return res.status(400).json({ error: 'Recipient "to" and "text" are required.' });
      const result = await whatsappClient.sendMessage(to, text);
      await db.execute(
        'INSERT INTO MENSAGEM (conteudo, origem, status, tipo, data_hora) VALUES (?, ?, ?, ?, NOW())',
        [text, 'api', 'sent', 'text']
      );
      res.json({ status: 'sent', data: result });
    } catch (err) {
      res.status(500).json({ error: err.message });
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
    app.delete(`${route}/:id`, async (req, res) => {
      const value = positiveInteger(req.params.id, 'id');
      const [result] = await db.execute(`DELETE FROM ${table} WHERE ${id} = ?`, [value]);
      if (!result.affectedRows) return res.status(404).json({ error: 'Resource not found.' });
      res.status(204).end();
    });
  }
  app.use((_req, res) => res.status(404).json({ error: 'Route not found.' }));
  app.use((error, _req, res, _next) => {
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large.' });
    if (error.status === 400) return res.status(400).json({ error: error.message });
    if (['ER_DUP_ENTRY', 'ER_ROW_IS_REFERENCED_2', 'ER_NO_REFERENCED_ROW_2'].includes(error.code)) {
      return res.status(409).json({ error: 'Database constraint conflict.' });
    }
    logger.error('Request failed', { code: error.code || 'INTERNAL_ERROR' });
    res.status(500).json({ error: 'Internal server error.' });
  });
  return app;
}
