import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { Pool, PoolConnection } from 'mysql2/promise';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { hashPassword, validatePassword, verifyPassword } from './password.js';

export type UserRole = 'admin' | 'atendente';

export interface PublicUser {
  id_usuario: number;
  nome: string;
  email: string;
  perfil: UserRole;
  ativo: boolean;
}

export interface AuthenticatedUser extends PublicUser {
  jti: string;
}

interface UserRecord extends RowDataPacket {
  id_usuario: number;
  nome: string;
  email: string;
  hash_senha: string;
  perfil: string;
  ativo: boolean | number;
}

export class AuthenticationError extends Error {
  readonly status = 401;

  constructor() {
    super('Authentication required.');
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends Error {
  readonly status = 403;

  constructor() {
    super('Insufficient permissions.');
    this.name = 'AuthorizationError';
  }
}

export class RequestValidationError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = 'RequestValidationError';
  }
}

const TOKEN_LIFETIME_SECONDS = 12 * 60 * 60;
const JWT_ISSUER = 'inablink-api';
const JWT_AUDIENCE = 'inablink-frontend';
const DUMMY_HASH = `scrypt$16384$8$1$${Buffer.alloc(16).toString('base64url')}$${Buffer.alloc(64).toString('base64url')}`;

function isUserRole(value: string): value is UserRole {
  return value === 'admin' || value === 'atendente';
}

function publicUser(row: UserRecord): PublicUser {
  if (!isUserRole(row.perfil)) throw new Error('Database contains an unsupported user profile.');
  return {
    id_usuario: Number(row.id_usuario),
    nome: row.nome,
    email: row.email,
    perfil: row.perfil,
    ativo: Boolean(row.ativo),
  };
}

function validateIdentity(
  name: unknown,
  email: unknown,
  role: unknown,
): { name: string; email: string; role: UserRole } {
  if (typeof name !== 'string' || !name.trim() || [...name.trim()].length > 255) {
    throw new RequestValidationError('nome must be a non-empty string of at most 255 characters.');
  }
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw new RequestValidationError('A valid email is required.');
  }
  if (role !== 'admin' && role !== 'atendente') {
    throw new RequestValidationError('perfil must be "admin" or "atendente".');
  }
  return { name: name.trim(), email: email.trim().toLowerCase(), role };
}

export class AuthService {
  private readonly jwtKey: Uint8Array;

  constructor(
    private readonly db: Pool,
    secret: string,
  ) {
    if (Buffer.byteLength(secret, 'utf8') < 32) {
      throw new Error('JWT_SECRET must contain at least 32 UTF-8 bytes.');
    }
    this.jwtKey = new TextEncoder().encode(secret);
  }

  async login(email: string, password: string): Promise<{
    accessToken: string;
    tokenType: 'Bearer';
    expiresIn: number;
    user: PublicUser;
  }> {
    const [rows] = await this.db.execute<UserRecord[]>(
      `SELECT id_usuario, nome, email, hash_senha, perfil, ativo
       FROM USUARIO WHERE email = ? LIMIT 1`,
      [email.trim().toLowerCase()],
    );
    const user = rows[0];
    const passwordHash = user && validatePassword(password) ? user.hash_senha : DUMMY_HASH;
    const passwordValid = await verifyPassword(password.slice(0, 128), passwordHash);
    if (!user || !Boolean(user.ativo) || !passwordValid) throw new AuthenticationError();

    const principal = publicUser(user);
    const jti = randomUUID();
    const issuedAt = Math.floor(Date.now() / 1000);
    const accessToken = await new SignJWT({ jti })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(String(principal.id_usuario))
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + TOKEN_LIFETIME_SECONDS)
      .sign(this.jwtKey);

    await this.db.execute(
      `INSERT INTO AUTH_SESSAO (jti, criada_em, expira_em, FK_USUARIO_id_usuario)
       VALUES (?, UTC_TIMESTAMP(), DATE_ADD(UTC_TIMESTAMP(), INTERVAL 12 HOUR), ?)`,
      [jti, principal.id_usuario],
    );
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: TOKEN_LIFETIME_SECONDS,
      user: principal,
    };
  }

  async authenticate(authorization: string | undefined): Promise<AuthenticatedUser> {
    const match = /^Bearer\s+([^\s]+)$/i.exec(authorization ?? '');
    if (!match) throw new AuthenticationError();

    let subject: string;
    let jti: string;
    try {
      const { payload } = await jwtVerify(match[1], this.jwtKey, {
        algorithms: ['HS256'],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });
      if (typeof payload.sub !== 'string'
        || typeof payload.jti !== 'string'
        || typeof payload.iat !== 'number'
        || typeof payload.exp !== 'number'
        || payload.exp - payload.iat > TOKEN_LIFETIME_SECONDS
        || payload.iat > Math.floor(Date.now() / 1000) + 60) {
        throw new AuthenticationError();
      }
      subject = payload.sub;
      jti = payload.jti;
    } catch {
      throw new AuthenticationError();
    }

    const userId = Number(subject);
    if (!Number.isSafeInteger(userId) || userId < 1) throw new AuthenticationError();
    const [rows] = await this.db.execute<UserRecord[]>(
      `SELECT u.id_usuario, u.nome, u.email, u.perfil, u.ativo
       FROM AUTH_SESSAO s
       JOIN USUARIO u ON u.id_usuario = s.FK_USUARIO_id_usuario
       WHERE s.jti = ? AND u.id_usuario = ? AND s.revogada_em IS NULL
         AND s.expira_em > UTC_TIMESTAMP() AND u.ativo = TRUE
       LIMIT 1`,
      [jti, userId],
    );
    if (!rows.length) throw new AuthenticationError();
    return { ...publicUser(rows[0]), jti };
  }

  async logout(jti: string): Promise<void> {
    await this.db.execute(
      'UPDATE AUTH_SESSAO SET revogada_em = UTC_TIMESTAMP() WHERE jti = ? AND revogada_em IS NULL',
      [jti],
    );
  }

  async changePassword(userId: number, currentPassword: string, newPassword: string): Promise<void> {
    if (!validatePassword(currentPassword)) throw new AuthenticationError();
    if (!validatePassword(newPassword)) {
      throw new RequestValidationError('A senha nova deve ter entre 12 e 128 caracteres.');
    }
    if (currentPassword === newPassword) {
      throw new RequestValidationError('A senha nova deve ser diferente da senha atual.');
    }

    const [users] = await this.db.execute<UserRecord[]>(
      'SELECT id_usuario, nome, email, hash_senha, perfil, ativo FROM USUARIO WHERE id_usuario = ? LIMIT 1',
      [userId],
    );
    const user = users[0];
    if (!user || !Boolean(user.ativo) || !(await verifyPassword(currentPassword, user.hash_senha))) {
      throw new AuthenticationError();
    }

    const newHash = await hashPassword(newPassword);
    const connection = await this.db.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        'UPDATE USUARIO SET hash_senha = ? WHERE id_usuario = ? AND ativo = TRUE',
        [newHash, userId],
      );
      await connection.execute(
        `UPDATE AUTH_SESSAO SET revogada_em = UTC_TIMESTAMP()
         WHERE FK_USUARIO_id_usuario = ? AND revogada_em IS NULL`,
        [userId],
      );
      await connection.commit();
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        if (error instanceof Error) Object.assign(error, { rollbackFailed: true });
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  async listUsers(page: number, limit: number): Promise<{ data: PublicUser[]; page: number; limit: number }> {
    const offset = (page - 1) * limit;
    const [rows] = await this.db.execute<UserRecord[]>(
      `SELECT id_usuario, nome, email, perfil, ativo
       FROM USUARIO ORDER BY id_usuario DESC LIMIT ${limit} OFFSET ${offset}`,
    );
    return { data: rows.map(publicUser), page, limit };
  }

  async getUser(id: number): Promise<PublicUser | null> {
    const [rows] = await this.db.execute<UserRecord[]>(
      'SELECT id_usuario, nome, email, perfil, ativo FROM USUARIO WHERE id_usuario = ? LIMIT 1',
      [id],
    );
    return rows[0] ? publicUser(rows[0]) : null;
  }

  async createUser(input: {
    nome: unknown;
    email: unknown;
    senha: unknown;
    perfil: unknown;
  }): Promise<PublicUser> {
    const identity = validateIdentity(input.nome, input.email, input.perfil);
    if (!validatePassword(input.senha)) {
      throw new RequestValidationError('A senha deve ter entre 12 e 128 caracteres.');
    }
    const name = identity.name;
    const email = identity.email;
    const passwordHash = await hashPassword(input.senha);
    const [result] = await this.db.execute<ResultSetHeader>(
      `INSERT INTO USUARIO (nome, email, hash_senha, perfil, ativo)
       VALUES (?, ?, ?, ?, TRUE)`,
      [name, email, passwordHash, identity.role],
    );
    return {
      id_usuario: result.insertId,
      nome: name,
      email,
      perfil: identity.role,
      ativo: true,
    };
  }

  async updateUser(
    id: number,
    input: { nome?: unknown; email?: unknown; perfil?: unknown; ativo?: unknown },
  ): Promise<boolean> {
    if (!(await this.getUser(id))) return false;
    const allowed = ['nome', 'email', 'perfil', 'ativo'];
    const fields = Object.keys(input);
    if (!fields.length || fields.some((field) => !allowed.includes(field))) {
      throw new RequestValidationError('Provide one or more supported user fields.');
    }

    const updates: Record<string, string | boolean> = {};
    if (input.nome !== undefined) {
      if (typeof input.nome !== 'string' || !input.nome.trim() || [...input.nome.trim()].length > 255) {
        throw new RequestValidationError('nome must be a non-empty string of at most 255 characters.');
      }
      updates.nome = input.nome.trim();
    }
    if (input.email !== undefined) {
      if (typeof input.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
        throw new RequestValidationError('A valid email is required.');
      }
      updates.email = input.email.trim().toLowerCase();
    }
    if (input.perfil !== undefined) {
      if (input.perfil !== 'admin' && input.perfil !== 'atendente') {
        throw new RequestValidationError('perfil must be "admin" or "atendente".');
      }
      updates.perfil = input.perfil;
    }
    if (input.ativo !== undefined) {
      if (typeof input.ativo !== 'boolean') throw new RequestValidationError('ativo must be a boolean.');
      updates.ativo = input.ativo;
    }

    const [result] = await this.db.execute<ResultSetHeader>(
      `UPDATE USUARIO SET ${Object.keys(updates).map((field) => `${field} = ?`).join(', ')} WHERE id_usuario = ?`,
      [...Object.values(updates), id],
    );
    return result.affectedRows > 0 || Boolean(await this.getUser(id));
  }
}

export { TOKEN_LIFETIME_SECONDS };
