import mysql from 'mysql2/promise';

export function createDatabase(env = process.env) {
  for (const key of ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']) {
    if (!env[key]) throw new Error(`Missing environment variable: ${key}`);
  }
  return mysql.createPool({
    host: env.DB_HOST,
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 50,
    connectTimeout: 5000,
    dateStrings: true,
    charset: 'utf8mb4',
  });
}
