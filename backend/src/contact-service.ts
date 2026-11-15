import type { Pool } from 'mysql2/promise';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

export interface ContactRecord extends RowDataPacket {
  id_contato: number;
  cadastrado_em: string;
  nome: string | null;
  telefone: string;
  email: string | null;
}

export interface LabelRecord extends RowDataPacket {
  id_etiqueta: number;
  nome: string;
  cor: string | null;
}

export class ContactService {
  constructor(private readonly db: Pool) {}

  async listContacts(page: number, limit: number): Promise<{ data: ContactRecord[]; page: number; limit: number }> {
    const offset = (page - 1) * limit;
    const [rows] = await this.db.execute<ContactRecord[]>(
      `SELECT id_contato, cadastrado_em, nome, telefone, email
       FROM CONTATO ORDER BY id_contato DESC LIMIT ${limit} OFFSET ${offset}`,
    );
    return { data: rows, page, limit };
  }

  async getContact(phone: string): Promise<ContactRecord | null> {
    const [rows] = await this.db.execute<ContactRecord[]>(
      `SELECT id_contato, cadastrado_em, nome, telefone, email
       FROM CONTATO WHERE telefone = ? LIMIT 1`,
      [phone],
    );
    return rows[0] ?? null;
  }

  async createContact(input: { phone: string; name: string | null; email: string | null }): Promise<ContactRecord> {
    await this.db.execute(
      `INSERT INTO CONTATO (telefone, nome, email, cadastrado_em)
       VALUES (?, ?, ?, CURRENT_DATE())`,
      [input.phone, input.name, input.email],
    );
    const contact = await this.getContact(input.phone);
    if (!contact) throw new Error('Contact insert did not return a row.');
    return contact;
  }

  async updateContact(phone: string, input: { nome?: string | null; email?: string | null }): Promise<boolean> {
    if (!(await this.getContact(phone))) return false;
    const entries = Object.entries(input);
    const [result] = await this.db.execute<ResultSetHeader>(
      `UPDATE CONTATO SET ${entries.map(([field]) => `${field} = ?`).join(', ')} WHERE telefone = ?`,
      [...entries.map(([, value]) => value), phone],
    );
    return result.affectedRows > 0 || Boolean(await this.getContact(phone));
  }

  async deleteContact(phone: string): Promise<'deleted' | 'not-found' | 'has-history'> {
    if (!(await this.getContact(phone))) return 'not-found';
    const [result] = await this.db.execute<ResultSetHeader>(
      `DELETE c FROM CONTATO c
       WHERE c.telefone = ?
         AND NOT EXISTS (
           SELECT 1 FROM CONVERSA v
           WHERE v.FK_CONTATO_id_contato = c.id_contato
         )`,
      [phone],
    );
    if (result.affectedRows) return 'deleted';
    return (await this.getContact(phone)) ? 'has-history' : 'not-found';
  }

  async listLabels(page: number, limit: number): Promise<{ data: LabelRecord[]; page: number; limit: number }> {
    const offset = (page - 1) * limit;
    const [rows] = await this.db.execute<LabelRecord[]>(
      `SELECT id_etiqueta, nome, cor FROM ETIQUETA
       ORDER BY id_etiqueta DESC LIMIT ${limit} OFFSET ${offset}`,
    );
    return { data: rows, page, limit };
  }

  async getLabel(id: number): Promise<LabelRecord | null> {
    const [rows] = await this.db.execute<LabelRecord[]>(
      'SELECT id_etiqueta, nome, cor FROM ETIQUETA WHERE id_etiqueta = ? LIMIT 1',
      [id],
    );
    return rows[0] ?? null;
  }

  async createLabel(input: { nome: string; cor: string | null }): Promise<LabelRecord> {
    const [result] = await this.db.execute<ResultSetHeader>(
      'INSERT INTO ETIQUETA (nome, cor) VALUES (?, ?)',
      [input.nome, input.cor],
    );
    const label = await this.getLabel(result.insertId);
    if (!label) throw new Error('Label insert did not return a row.');
    return label;
  }

  async updateLabel(
    id: number,
    input: { nome?: string; cor?: string | null },
  ): Promise<boolean> {
    if (!(await this.getLabel(id))) return false;
    const entries = Object.entries(input);
    const [result] = await this.db.execute<ResultSetHeader>(
      `UPDATE ETIQUETA SET ${entries.map(([field]) => `${field} = ?`).join(', ')} WHERE id_etiqueta = ?`,
      [...entries.map(([, value]) => value), id],
    );
    return result.affectedRows > 0 || Boolean(await this.getLabel(id));
  }

  async deleteLabel(id: number): Promise<boolean> {
    const connection = await this.db.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute('DELETE FROM classifica WHERE fk_ETIQUETA_id_etiqueta = ?', [id]);
      await connection.execute('DELETE FROM marca WHERE fk_ETIQUETA_id_etiqueta = ?', [id]);
      const [result] = await connection.execute<ResultSetHeader>(
        'DELETE FROM ETIQUETA WHERE id_etiqueta = ?',
        [id],
      );
      await connection.commit();
      return result.affectedRows > 0;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async listContactLabels(phone: string): Promise<LabelRecord[] | null> {
    if (!(await this.getContact(phone))) return null;
    const [rows] = await this.db.execute<LabelRecord[]>(
      `SELECT e.id_etiqueta, e.nome, e.cor
       FROM ETIQUETA e
       JOIN classifica x ON x.fk_ETIQUETA_id_etiqueta = e.id_etiqueta
       JOIN CONTATO c ON c.id_contato = x.fk_CONTATO_id_contato
       WHERE c.telefone = ? ORDER BY e.id_etiqueta`,
      [phone],
    );
    return rows;
  }

  async addContactLabel(phone: string, labelId: number): Promise<'added' | 'missing-contact' | 'missing-label'> {
    const contact = await this.getContact(phone);
    if (!contact) return 'missing-contact';
    const label = await this.getLabel(labelId);
    if (!label) return 'missing-label';
    await this.db.execute(
      `INSERT INTO classifica (fk_CONTATO_id_contato, fk_ETIQUETA_id_etiqueta)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE fk_ETIQUETA_id_etiqueta = VALUES(fk_ETIQUETA_id_etiqueta)`,
      [contact.id_contato, labelId],
    );
    return 'added';
  }

  async removeContactLabel(
    phone: string,
    labelId: number,
  ): Promise<'removed' | 'missing-contact' | 'missing-association'> {
    const contact = await this.getContact(phone);
    if (!contact) return 'missing-contact';
    const [result] = await this.db.execute<ResultSetHeader>(
      `DELETE FROM classifica
       WHERE fk_CONTATO_id_contato = ? AND fk_ETIQUETA_id_etiqueta = ?`,
      [contact.id_contato, labelId],
    );
    return result.affectedRows ? 'removed' : 'missing-association';
  }
}
