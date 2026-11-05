import { useEffect, useMemo, useState } from 'react';
import { MoreHorizontal, Search, X } from 'lucide-react';
import { createContact, getContacts } from '../api.ts';
import PageHeading from '../components/PageHeading.jsx';

export default function Contatos() {
  const [contacts, setContacts] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ telefone: '', nome: '', email: '' });

  async function loadContacts() {
    setLoading(true);
    setError('');
    try {
      setContacts((await getContacts()).data);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadContacts();
  }, []);

  const visibleContacts = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase();
    return contacts.filter((contact) =>
      `${contact.nome ?? ''} ${contact.telefone} ${contact.email ?? ''}`
        .toLocaleLowerCase()
        .includes(query),
    );
  }, [contacts, searchTerm]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await createContact({ ...form, email: form.email || null });
      setForm({ telefone: '', nome: '', email: '' });
      setShowForm(false);
      await loadContacts();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeading
        title="Contatos"
        text="Organize clientes, leads e oportunidades."
      />

      <div className="toolbar card">
        <div className="search-box wide">
          <Search size={17} />
          <input
            aria-label="Buscar contatos"
            placeholder="Buscar por nome, telefone ou e-mail..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>
        <button
          className="primary"
          type="button"
          onClick={() => setShowForm(true)}
        >
          Novo contato
        </button>
      </div>

      {error && <p className="api-error" role="alert">{error}</p>}

      {showForm && (
        <form className="card contact-form" onSubmit={handleSubmit}>
          <div className="form-title">
            <h3>Novo contato</h3>
            <button
              type="button"
              aria-label="Fechar formulário"
              onClick={() => setShowForm(false)}
            >
              <X size={18} />
            </button>
          </div>
          <label>
            Telefone (E.164)
            <input
              required
              type="tel"
              placeholder="+5511999999999"
              value={form.telefone}
              onChange={(event) => setForm({ ...form, telefone: event.target.value })}
            />
          </label>
          <label>
            Nome
            <input
              required
              value={form.nome}
              onChange={(event) => setForm({ ...form, nome: event.target.value })}
            />
          </label>
          <label>
            E-mail
            <input
              type="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
          </label>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Salvando...' : 'Salvar contato'}
          </button>
        </form>
      )}

      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Telefone</th>
              <th>E-mail</th>
              <th>Cadastrado em</th>
              <th aria-label="Ações" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5}>Carregando contatos...</td>
              </tr>
            )}
            {!loading && visibleContacts.length === 0 && (
              <tr>
                <td colSpan={5}>Nenhum contato encontrado.</td>
              </tr>
            )}
            {!loading && visibleContacts.map((contact) => {
              const displayName = contact.nome || 'Sem nome';
              const initials = (contact.nome || contact.telefone)
                .split(' ')
                .map((part) => part[0])
                .join('')
                .slice(0, 2);

              return (
                <tr key={contact.id_contato}>
                  <td>
                    <div className="name-cell">
                      <div className="avatar pale">{initials}</div>
                      <strong>{displayName}</strong>
                    </div>
                  </td>
                  <td>{contact.telefone}</td>
                  <td>{contact.email || '—'}</td>
                  <td>{contact.cadastrado_em || '—'}</td>
                  <td>
                    <MoreHorizontal size={18} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
