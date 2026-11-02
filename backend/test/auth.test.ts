import { once } from 'node:events';
import { SignJWT } from 'jose';
import type { Server } from 'node:http';
import type { Pool } from 'mysql2/promise';
import { afterEach, expect, test } from 'vitest';
import { AuthService, AuthenticationError } from '../src/auth.js';
import { createApp } from '../src/app.js';
import { hashPassword, verifyPassword } from '../src/password.js';

const jwtSecret = 'auth-test-secret-with-at-least-thirty-two-bytes';
const adminPassword = 'Correct-Horse-Battery-9';
const agentPassword = 'Another-Strong-Password-8';

interface TestUser {
  id_usuario: number;
  nome: string;
  email: string;
  hash_senha: string;
  perfil: 'admin' | 'atendente';
  ativo: boolean;
}

interface TestSession {
  jti: string;
  userId: number;
  revoked: boolean;
}

class AuthMemoryDatabase {
  users: TestUser[] = [];
  sessions: TestSession[] = [];
  private nextUserId = 1;

  static async create(): Promise<AuthMemoryDatabase> {
    const db = new AuthMemoryDatabase();
    db.users.push({
      id_usuario: db.nextUserId++,
      nome: 'Admin',
      email: 'admin@example.com',
      hash_senha: await hashPassword(adminPassword),
      perfil: 'admin',
      ativo: true,
    });
    db.users.push({
      id_usuario: db.nextUserId++,
      nome: 'Agent',
      email: 'agent@example.com',
      hash_senha: await hashPassword(agentPassword),
      perfil: 'atendente',
      ativo: true,
    });
    return db;
  }

  async execute(sqlText: string, values: unknown[] = []): Promise<[unknown, unknown[]]> {
    const sql = sqlText.replace(/\s+/g, ' ').trim();
    if (sql.startsWith('SELECT id_usuario, nome, email, hash_senha, perfil, ativo FROM USUARIO WHERE email')) {
      const user = this.users.find((row) => row.email === values[0]);
      return [user ? [user] : [], []];
    }
    if (sql.includes('FROM AUTH_SESSAO s JOIN USUARIO u')) {
      const [jti, userId] = values;
      const session = this.sessions.find((row) => row.jti === jti && row.userId === userId && !row.revoked);
      const user = session && this.users.find((row) => row.id_usuario === userId && row.ativo);
      return [user ? [user] : [], []];
    }
    if (sql.startsWith('INSERT INTO AUTH_SESSAO')) {
      const [jti, userId] = values;
      this.sessions.push({ jti: String(jti), userId: Number(userId), revoked: false });
      return [{ insertId: this.sessions.length }, []];
    }
    if (sql.startsWith('UPDATE AUTH_SESSAO SET revogada_em = UTC_TIMESTAMP() WHERE jti')) {
      const session = this.sessions.find((row) => row.jti === values[0] && !row.revoked);
      if (session) session.revoked = true;
      return [{ affectedRows: session ? 1 : 0 }, []];
    }
    if (sql.startsWith('SELECT id_usuario, nome, email, hash_senha, perfil, ativo FROM USUARIO WHERE id_usuario')) {
      const user = this.users.find((row) => row.id_usuario === values[0]);
      return [user ? [user] : [], []];
    }
    if (sql.startsWith('UPDATE USUARIO SET hash_senha')) {
      const user = this.users.find((row) => row.id_usuario === values[1]);
      if (user) user.hash_senha = String(values[0]);
      return [{ affectedRows: user ? 1 : 0 }, []];
    }
    if (sql.startsWith('UPDATE AUTH_SESSAO SET revogada_em = UTC_TIMESTAMP() WHERE FK_USUARIO_id_usuario')) {
      const active = this.sessions.filter((row) => row.userId === values[0] && !row.revoked);
      active.forEach((row) => { row.revoked = true; });
      return [{ affectedRows: active.length }, []];
    }
    if (sql.startsWith('SELECT id_usuario, nome, email, perfil, ativo FROM USUARIO ORDER BY')) {
      const limit = Number(sql.match(/LIMIT (\d+)/)?.[1]);
      const offset = Number(sql.match(/OFFSET (\d+)/)?.[1]);
      return [this.users.slice(offset, offset + limit), []];
    }
    if (sql.startsWith('SELECT id_usuario, nome, email, perfil, ativo FROM USUARIO WHERE id_usuario')) {
      const user = this.users.find((row) => row.id_usuario === values[0]);
      return [user ? [user] : [], []];
    }
    if (sql.startsWith('INSERT INTO USUARIO')) {
      const [nome, email, hash, perfil] = values;
      const user: TestUser = {
        id_usuario: this.nextUserId++,
        nome: String(nome),
        email: String(email),
        hash_senha: String(hash),
        perfil: perfil === 'admin' ? 'admin' : 'atendente',
        ativo: true,
      };
      this.users.push(user);
      return [{ insertId: user.id_usuario }, []];
    }
    if (sql.startsWith('UPDATE USUARIO SET')) {
      const assignment = sql.slice('UPDATE USUARIO SET '.length).split(' WHERE ')[0];
      const userId = Number(values.at(-1));
      const user = this.users.find((row) => row.id_usuario === userId);
      if (!user) return [{ affectedRows: 0 }, []];
      const fields = assignment.split(', ').map((part) => part.split(' = ')[0]);
      fields.forEach((field, index) => {
        const value = values[index];
        if (field === 'nome') user.nome = String(value);
        if (field === 'email') user.email = String(value);
        if (field === 'perfil' && (value === 'admin' || value === 'atendente')) user.perfil = value;
        if (field === 'ativo' && typeof value === 'boolean') user.ativo = value;
      });
      return [{ affectedRows: 1 }, []];
    }
    if (sql === 'SELECT 1') return [[{ 1: 1 }], []];
    throw new Error(`Unexpected auth SQL in test fake: ${sql}`);
  }

  async getConnection() {
    return {
      beginTransaction: async () => {},
      commit: async () => {},
      rollback: async () => {},
      release: () => {},
      execute: this.execute.bind(this),
    };
  }
}

function service(db: AuthMemoryDatabase): AuthService {
  return new AuthService(db as unknown as Pool, jwtSecret);
}

const servers = new Set<Server>();

function portOf(server: Server): number {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server has no TCP address.');
  return address.port;
}

afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
  })));
  servers.clear();
});

test('password hashes use salted scrypt and reject malformed or incorrect passwords', async () => {
  const first = await hashPassword(adminPassword);
  const second = await hashPassword(adminPassword);
  expect(first).not.toBe(second);
  await expect(verifyPassword(adminPassword, first)).resolves.toBe(true);
  await expect(verifyPassword('wrong-password', first)).resolves.toBe(false);
  await expect(verifyPassword(adminPassword, 'invalid-hash')).resolves.toBe(false);
});

test('login issues a signed 12-hour JWT and does not expose password hashes', async () => {
  const db = await AuthMemoryDatabase.create();
  const result = await service(db).login('ADMIN@example.com', adminPassword);
  expect(result).toMatchObject({
    tokenType: 'Bearer',
    expiresIn: 43200,
    user: { id_usuario: 1, email: 'admin@example.com', perfil: 'admin' },
  });
  expect(result.user).not.toHaveProperty('hash_senha');
  expect(result.accessToken).not.toContain(db.users[0].hash_senha);
  expect(db.sessions).toHaveLength(1);
});

test('invalid credentials and inactive accounts return the same authentication error', async () => {
  const db = await AuthMemoryDatabase.create();
  const auth = service(db);
  await expect(auth.login('missing@example.com', adminPassword)).rejects.toBeInstanceOf(AuthenticationError);
  await expect(auth.login('admin@example.com', 'incorrect-password')).rejects.toBeInstanceOf(AuthenticationError);
  db.users[0].ativo = false;
  await expect(auth.login('admin@example.com', adminPassword)).rejects.toBeInstanceOf(AuthenticationError);
});

test('logout revokes a JWT session immediately', async () => {
  const db = await AuthMemoryDatabase.create();
  const auth = service(db);
  const login = await auth.login('admin@example.com', adminPassword);
  const user = await auth.authenticate(`Bearer ${login.accessToken}`);
  await auth.logout(user.jti);
  await expect(auth.authenticate(`Bearer ${login.accessToken}`)).rejects.toBeInstanceOf(AuthenticationError);
});

test('expired or tampered JWTs are rejected', async () => {
  const db = await AuthMemoryDatabase.create();
  const auth = service(db);
  const now = Math.floor(Date.now() / 1000);
  const expired = await new SignJWT({ jti: 'expired-session' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject('1')
    .setIssuer('inablink-api')
    .setAudience('inablink-frontend')
    .setIssuedAt(now - 7200)
    .setExpirationTime(now - 3600)
    .sign(new TextEncoder().encode(jwtSecret));
  await expect(auth.authenticate(`Bearer ${expired}`)).rejects.toBeInstanceOf(AuthenticationError);
  await expect(auth.authenticate('Bearer invalid.token.value')).rejects.toBeInstanceOf(AuthenticationError);
});

test('password change requires the current password and revokes all existing sessions', async () => {
  const db = await AuthMemoryDatabase.create();
  const auth = service(db);
  const login = await auth.login('admin@example.com', adminPassword);
  await expect(auth.changePassword(1, 'wrong-password', 'New-Strong-Password-9'))
    .rejects.toBeInstanceOf(AuthenticationError);
  await auth.changePassword(1, adminPassword, 'New-Strong-Password-9');
  await expect(auth.authenticate(`Bearer ${login.accessToken}`)).rejects.toBeInstanceOf(AuthenticationError);
  await expect(auth.login('admin@example.com', adminPassword)).rejects.toBeInstanceOf(AuthenticationError);
  await expect(auth.login('admin@example.com', 'New-Strong-Password-9')).resolves.toMatchObject({
    user: { id_usuario: 1 },
  });
});

test('admin user creation persists a hash and updates never expose it', async () => {
  const db = await AuthMemoryDatabase.create();
  const auth = service(db);
  const created = await auth.createUser({
    nome: 'New Agent',
    email: 'new@example.com',
    senha: 'Safe-Initial-Password-9',
    perfil: 'atendente',
  });
  expect(created).toMatchObject({ id_usuario: 3, email: 'new@example.com', ativo: true });
  expect(db.users[2].hash_senha).not.toBe('Safe-Initial-Password-9');
  await expect(verifyPassword('Safe-Initial-Password-9', db.users[2].hash_senha)).resolves.toBe(true);
  await expect(auth.updateUser(3, { ativo: false })).resolves.toBe(true);
  await expect(auth.getUser(3)).resolves.toMatchObject({ ativo: false });
  await expect(auth.getUser(99)).resolves.toBeNull();
});

test('login, current-user, logout and role checks are exposed as HTTP routes', async () => {
  const db = await AuthMemoryDatabase.create();
  const server = createApp(
    db as unknown as Pool,
    { error: () => {}, warn: () => {} },
    undefined,
    { JWT_SECRET: jwtSecret, ROUND_ROBIN_ENABLED: 'false' },
  ).listen(0, '127.0.0.1');
  servers.add(server);
  await once(server, 'listening');
  const request = (path: string, options: RequestInit = {}) => fetch(
    `http://127.0.0.1:${portOf(server)}${path}`,
    options,
  );

  const loginResponse = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'agent@example.com', senha: agentPassword }),
  });
  expect(loginResponse.status).toBe(200);
  const login = await loginResponse.json() as {
    data: { accessToken: string; user: { perfil: string } };
  };
  expect(login.data.user.perfil).toBe('atendente');

  const me = await request('/api/auth/me', {
    headers: { Authorization: `Bearer ${login.data.accessToken}` },
  });
  expect(me.status).toBe(200);
  expect(await me.json()).toMatchObject({
    data: { id_usuario: 2, email: 'agent@example.com', perfil: 'atendente' },
  });
  const denied = await request('/api/usuarios', {
    headers: { Authorization: `Bearer ${login.data.accessToken}` },
  });
  expect(denied.status).toBe(403);

  const passwordChange = await request('/api/auth/password', {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${login.data.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      senha_atual: agentPassword,
      nova_senha: 'Changed-Agent-Password-6',
    }),
  });
  expect(passwordChange.status).toBe(204);
  const revokedAfterPasswordChange = await request('/api/auth/me', {
    headers: { Authorization: `Bearer ${login.data.accessToken}` },
  });
  expect(revokedAfterPasswordChange.status).toBe(401);

  const adminLogin = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', senha: adminPassword }),
  });
  const admin = await adminLogin.json() as { data: { accessToken: string } };
  const userList = await request('/api/usuarios', {
    headers: { Authorization: `Bearer ${admin.data.accessToken}` },
  });
  expect(userList.status).toBe(200);
  const listed = await userList.json() as { data: Array<Record<string, unknown>> };
  expect(listed.data).toHaveLength(2);
  expect(listed.data[0]).not.toHaveProperty('hash_senha');
  const created = await request('/api/usuarios', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${admin.data.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      nome: 'New Agent',
      email: 'new-agent@example.com',
      senha: 'Safe-Initial-Password-9',
      perfil: 'atendente',
    }),
  });
  expect(created.status).toBe(201);
  expect(await created.json()).toMatchObject({
    data: { id_usuario: 3, email: 'new-agent@example.com', perfil: 'atendente' },
  });

  const loggedOut = await request('/api/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.data.accessToken}` },
  });
  expect(loggedOut.status).toBe(204);
  const afterLogout = await request('/api/auth/me', {
    headers: { Authorization: `Bearer ${admin.data.accessToken}` },
  });
  expect(afterLogout.status).toBe(401);
});
