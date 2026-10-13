import mysql from 'mysql2/promise';
import fs from 'node:fs';
import path from 'node:path';

export function createDatabase(env: NodeJS.ProcessEnv = process.env) {
  for (const key of ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']) {
    if (!env[key]) throw new Error(`Missing environment variable: ${key}`);
  }

  const sslConfig = env.DB_SSL_CA && fs.existsSync(env.DB_SSL_CA)
    ? { ca: fs.readFileSync(path.resolve(env.DB_SSL_CA)) }
    : env.DB_SSL === 'true' || env.DB_SSL === '1'
    ? { rejectUnauthorized: true }
    : undefined;

  return mysql.createPool({
    host: env.DB_HOST,
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    ssl: sslConfig,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 50,
    connectTimeout: 5000,
    timezone: 'Z',
    dateStrings: true,
    charset: 'utf8mb4',
  });
}
