import { useEffect, useState } from 'react';
import { PRESET_COLORS, labelStyle, safeColor } from '../labelColors.js';
import { ChevronRight, Bot, Plug, Shield, Tags, UserRound, Users } from 'lucide-react';
import PageHeading from '../components/PageHeading.jsx';
import {
  changePassword,
  createLabel,
  createUser,
  deactivateUser,
  deleteLabel,
  getBusinessSettings,
  getLabels,
  getUsers,
  resetUserPassword,
  updateBusinessSettings,
  updateLabel,
  updateUser,
} from '../api.ts';

const sections = [
  ['Perfil', UserRound],
  ['Equipe', Users],
  ['Integrações', Plug],
  ['Mensagens automáticas', Bot],
  ['Etiquetas', Tags],
  ['Segurança', Shield],
];
const timezones = ['America/Sao_Paulo', 'America/Fortaleza', 'America/Manaus', 'UTC'];

function ActionMessage({ message }) {
  return message ? <p className="settings-message" role="status">{message}</p> : null;
}

function ColorPicker({ value, onChange }) {
  return (
    <div className="color-picker">
      <div className="swatches">
        {PRESET_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className={`swatch ${value === color ? 'selected' : ''}`}
            style={{ background: color }}
            aria-label={`Cor ${color}`}
            onClick={() => onChange(color)}
          />
        ))}
      </div>
      <label className="color-custom">
        <input
          type="color"
          value={safeColor(value) ?? PRESET_COLORS[0]}
          onChange={(event) => onChange(event.target.value)}
        />
        <span>Personalizada</span>
      </label>
    </div>
  );
}

export default function Configuracoes({ user }) {
  const [tab, setTab] = useState('Perfil');
  const [message, setMessage] = useState('');
  const [settings, setSettings] = useState(null);
  const [users, setUsers] = useState([]);
  const [labels, setLabels] = useState([]);
  const [editingLabel, setEditingLabel] = useState(null);
  const [newLabel, setNewLabel] = useState({ nome: '', cor: PRESET_COLORS[0] });
  const [passwords, setPasswords] = useState({ atual: '', nova: '' });
  const [savingProfile, setSavingProfile] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(true);

  useEffect(() => {
    setLoadingProfile(true);
    getBusinessSettings()
      .then(({ data }) => setSettings(data))
      .catch((error) => setMessage(error.message))
      .finally(() => setLoadingProfile(false));
  }, []);

  useEffect(() => {
    if (tab === 'Equipe' && user?.perfil === 'admin' || tab === 'Segurança') {
      getUsers().then(({ data }) => setUsers(data)).catch((error) => setMessage(error.message));
    }
    if (tab === 'Etiquetas') {
      getLabels().then(({ data }) => setLabels(data)).catch((error) => setMessage(error.message));
    }
  }, [tab, user]);

  async function saveProfile(event) {
    event.preventDefault();
    setSavingProfile(true);
    setMessage('');
    try {
      const result = await updateBusinessSettings(settings);
      setSettings(result.data);
      setMessage('Perfil do WhatsApp salvo com sucesso.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSavingProfile(false);
    }
  }

  async function savePassword(event) {
    event.preventDefault();
    try {
      await changePassword(passwords.atual, passwords.nova);
      setPasswords({ atual: '', nova: '' });
      setMessage('Senha alterada. Entre novamente com a nova senha.');
    } catch (error) { setMessage(error.message); }
  }

  async function saveLabel(event) {
    event.preventDefault();
    try {
      const payload = { nome: newLabel.nome.trim(), cor: safeColor(newLabel.cor) };
      if (editingLabel) await updateLabel(editingLabel.id_etiqueta, payload);
      else await createLabel(payload);
      setLabels((await getLabels()).data);
      cancelEdit();
      setMessage('Etiqueta salva.');
    } catch (error) { setMessage(error.message); }
  }

  function cancelEdit() {
    setEditingLabel(null);
    setNewLabel({ nome: '', cor: PRESET_COLORS[0] });
  }

  function startEdit(label) {
    setEditingLabel(label);
    setNewLabel({ nome: label.nome, cor: safeColor(label.cor) ?? PRESET_COLORS[0] });
  }

  async function removeLabel(id) {
    if (!window.confirm('Excluir esta etiqueta? As conversas serão preservadas.')) return;
    try {
      await deleteLabel(id);
      setLabels((await getLabels()).data);
      setMessage('Etiqueta excluída.');
    } catch (error) { setMessage(error.message); }
  }

  async function saveUser(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await createUser({
        nome: String(form.get('nome')),
        email: String(form.get('email')),
        senha: String(form.get('senha')),
        perfil: String(form.get('perfil')),
      });
      event.currentTarget.reset();
      setUsers((await getUsers()).data);
      setMessage('Usuário adicionado.');
    } catch (error) { setMessage(error.message); }
  }

  async function editUser(current) {
    const nome = window.prompt('Nome', current.nome);
    const email = window.prompt('E-mail', current.email);
    const perfil = window.prompt('Função (admin ou atendente)', current.perfil);
    if (!nome || !email || !['admin', 'atendente'].includes(perfil)) return;
    try {
      await updateUser(current.id_usuario, { nome, email, perfil });
      setUsers((await getUsers()).data);
      setMessage('Usuário alterado.');
    } catch (error) { setMessage(error.message); }
  }

  async function resetPassword(target) {
    const nova = window.prompt(`Nova senha para ${target.nome} (mínimo 12 caracteres)`);
    if (!nova) return;
    try {
      await resetUserPassword(target.id_usuario, nova);
      setMessage('Senha alterada e sessões revogadas.');
    } catch (error) { setMessage(error.message); }
  }

  async function removeUser(target) {
    if (!window.confirm(`Desativar ${target.nome}? O histórico será preservado.`)) return;
    try {
      await deactivateUser(target.id_usuario);
      setUsers((await getUsers()).data);
      setMessage('Usuário desativado.');
    } catch (error) { setMessage(error.message); }
  }

  const admin = user?.perfil === 'admin';
  return (
    <>
      <PageHeading title="Configurações" text="Gerencie perfil, equipe, etiquetas e segurança." />
      <div className="settings-layout">
        <aside className="card settings-nav">
          {sections.map(([section, Icon]) => (
            <button type="button" className={tab === section ? 'active' : ''} onClick={() => { setTab(section); setMessage(''); }} key={section}>
              <Icon size={18} />{section}<ChevronRight size={16} />
            </button>
          ))}
        </aside>
        <article className="card settings-form">
          <span className="eyebrow">CONFIGURAÇÕES</span>
          <h3>{tab}</h3>
          <ActionMessage message={message} />

          {tab === 'Perfil' && loadingProfile && !settings && (
            <p>Carregando dados do perfil do WhatsApp...</p>
          )}

          {tab === 'Perfil' && settings && (
            <form onSubmit={saveProfile}>
              <div className="form-grid settings-fields">
                <label>Nome do perfil<input value={settings.nome_perfil} onChange={(e) => setSettings({ ...settings, nome_perfil: e.target.value })} disabled={!admin} /></label>
                <label>E-mail de contato<input type="email" value={settings.email_contato} onChange={(e) => setSettings({ ...settings, email_contato: e.target.value })} disabled={!admin} /></label>
                <label>Fuso horário<select value={settings.fuso_horario} onChange={(e) => setSettings({ ...settings, fuso_horario: e.target.value })} disabled={!admin}>{timezones.map((zone) => <option key={zone}>{zone}</option>)}</select></label>
                <label>Número da conta<input value={settings.numero_conta ?? 'Não informado'} readOnly /></label>
              </div>
              {admin && <button className="primary" type="submit" disabled={savingProfile}>{savingProfile ? 'Salvando na Meta...' : 'Salvar alterações'}</button>}
            </form>
          )}

          {(tab === 'Integrações' || tab === 'Mensagens automáticas') && <div className="empty-settings"><strong>Em breve!</strong><p>Este recurso estará disponível em uma próxima versão.</p></div>}

          {tab === 'Etiquetas' && (
            <div className="settings-stack">
              <form className="inline-form label-form" onSubmit={saveLabel}>
                <input
                  required
                  placeholder="Nome da etiqueta"
                  value={newLabel.nome}
                  onChange={(e) => setNewLabel({ ...newLabel, nome: e.target.value })}
                />
                <ColorPicker
                  value={newLabel.cor}
                  onChange={(cor) => setNewLabel({ ...newLabel, cor })}
                />
                <span className="tag preview" style={labelStyle(newLabel.cor)}>
                  {newLabel.nome || 'Prévia'}
                </span>
                <button className="primary" type="submit">{editingLabel ? 'Salvar' : 'Adicionar'}</button>
                {editingLabel && (
                  <button className="link-btn" type="button" onClick={cancelEdit}>Cancelar</button>
                )}
              </form>
              <div className="settings-list">
                {labels.map((label) => (
                  <div className="settings-row" key={label.id_etiqueta}>
                    <span className="tag" style={labelStyle(label.cor)}>{label.nome}</span>
                    <span>
                      <button className="link-btn" type="button" onClick={() => startEdit(label)}>Alterar</button>
                      <button className="link-btn danger" type="button" onClick={() => removeLabel(label.id_etiqueta)}>Excluir</button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'Equipe' && admin && (
            <div className="settings-stack">
              <form className="inline-form user-form" onSubmit={saveUser}>
                <input name="nome" required placeholder="Nome" /><input name="email" required type="email" placeholder="E-mail" /><select name="perfil" defaultValue="atendente"><option value="atendente">Atendente</option><option value="admin">Admin</option></select><input name="senha" required minLength="12" placeholder="Senha inicial" type="password" /><button className="primary" type="submit">Adicionar</button>
              </form>
              <div className="settings-list">
                {users.map((item) => 
                <div className="settings-row" key={item.id_usuario}>
                  <span><strong>{item.nome}</strong><small>{item.email} · {item.perfil} · {item.ativo ? 'ativo' : 'inativo'}</small></span><span><button className="link-btn" type="button" onClick={() => editUser(item)}>Alterar</button>{item.id_usuario !== user.id_usuario && item.ativo && <button className="link-btn danger" type="button" onClick={() => removeUser(item)}>Desativar</button>}</span></div>)}
              </div>
            </div>
          )}

          {tab === 'Equipe' && !admin && <div className="empty-settings"><strong>Acesso restrito</strong><p>Apenas administradores gerenciam a equipe.</p></div>}

          {tab === 'Segurança' && (
            <div className="settings-stack">
              <form className="password-form" onSubmit={savePassword}><h4>Alterar minha senha</h4><input required type="password" placeholder="Senha atual" value={passwords.atual} onChange={(e) => setPasswords({ ...passwords, atual: e.target.value })} /><input required minLength="12" type="password" placeholder="Nova senha" value={passwords.nova} onChange={(e) => setPasswords({ ...passwords, nova: e.target.value })} /><button className="primary" type="submit">Alterar senha</button></form>
              {admin && <> <h4>Senhas dos usuários</h4>
              <div className="settings-list">
                {users.map((item) => <div className="settings-row" key={item.id_usuario}><span>{item.nome}<small>{item.email}</small></span>{(item.perfil !== 'admin' || item.id_usuario === user.id_usuario) && <button className="link-btn" type="button" onClick={() => resetPassword(item)}>Alterar senha</button>}</div>)}
              </div></>}
            </div>
          )}
        </article>
      </div>
    </>
  );
}