import type { RowDataPacket } from 'mysql2';
import { createDatabase } from './db.js';
import { hashPassword, validatePassword } from './password.js';

async function createInitialAdministrator(): Promise<void> {
  const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim();
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!name || !email || !password) {
    throw new Error('Set BOOTSTRAP_ADMIN_NAME, BOOTSTRAP_ADMIN_EMAIL, and BOOTSTRAP_ADMIN_PASSWORD for this command.');
  }
  if (name.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !validatePassword(password)) {
    throw new Error('Administrator name, email, or password does not meet the required format.');
  }

  const db = createDatabase();
  try {
    const [rows] = await db.execute<RowDataPacket[]>('SELECT COUNT(*) AS total FROM USUARIO');
    if (Number(rows[0]?.total) !== 0) {
      throw new Error('Bootstrap is allowed only when the USUARIO table is empty.');
    }
    const passwordHash = await hashPassword(password);
    await db.execute(
      `INSERT INTO USUARIO (nome, email, hash_senha, perfil, ativo)
       VALUES (?, ?, ?, 'admin', TRUE)`,
      [name, email, passwordHash],
    );
    console.info('Initial administrator created. Remove the bootstrap values from the process environment.');
  } finally {
    delete process.env.BOOTSTRAP_ADMIN_NAME;
    delete process.env.BOOTSTRAP_ADMIN_EMAIL;
    delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
    await db.end();
  }
}

createInitialAdministrator().catch((error: unknown) => {
  const code = typeof error === 'object' && error !== null && 'code' in error
    && typeof error.code === 'string'
    ? error.code
    : 'BOOTSTRAP_FAILED';
  console.error('Initial administrator was not created.', { code });
  process.exitCode = 1;
});
