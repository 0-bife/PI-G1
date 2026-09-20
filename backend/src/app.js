import express from 'express';

const resources = {
  contatos: { table: 'CONTATO', id: 'id_contato', fields: ['nome', 'telefone', 'email'], required: ['nome', 'telefone'] },
  etiquetas: { table: 'ETIQUETA', id: 'id_etiqueta', fields: ['nome', 'cor'], required: ['nome'] },
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
    if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > 255) {
      throw fail(`${key} must be a non-empty string with at most 255 characters.`);
    }
    result[key] = value.trim();
    if (key === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result[key])) throw fail('Invalid email.');
  }
  if (!partial && resource.required.some((key) => !result[key])) throw fail(`Required fields: ${resource.required.join(', ')}.`);
  if (!Object.keys(result).length) throw fail('At least one field is required.');
  return result;
}

export function createApp(db, logger = console) {
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

  for (const [path, resource] of Object.entries(resources)) {
    const { table, id } = resource;
    const route = `/api/${path}`;
    app.get(route, async (req, res) => {
      const limit = positiveInteger(req.query.limit ?? 20, 'limit', 100);
      const page = positiveInteger(req.query.page ?? 1, 'page', 1000000);
      // Identifiers come only from the static resource definitions; numbers are validated above.
      const [rows] = await db.execute(`SELECT * FROM ${table} ORDER BY ${id} DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`);
      res.json({ data: rows, page, limit });
    });
    app.get(`${route}/:id`, async (req, res) => {
      const value = positiveInteger(req.params.id, 'id');
      const [rows] = await db.execute(`SELECT * FROM ${table} WHERE ${id} = ?`, [value]);
      if (!rows.length) return res.status(404).json({ error: 'Resource not found.' });
      res.json({ data: rows[0] });
    });
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
