import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Building2,
  MoreHorizontal,
  Paperclip,
  Phone,
  Plus,
  Search,
  Send,
  Tag,
} from 'lucide-react';
import {
  addConversationLabel,
  createAnnotation,
  createConversation,
  getConversationAnnotations,
  getConversationLabels,
  getConversationMessages,
  getConversations,
  getLabels,
  sendMessage,
} from '../api.ts';

function displayDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR');
}

export default function Conversations() {
  const [conversations, setConversations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [mobileView, setMobileView] = useState('list');
  const [messages, setMessages] = useState([]);
  const [annotations, setAnnotations] = useState([]);
  const [labels, setLabels] = useState([]);
  const [conversationLabels, setConversationLabels] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [messageText, setMessageText] = useState('');
  const [annotationText, setAnnotationText] = useState('');
  const [phone, setPhone] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([getConversations(), getLabels()])
      .then(([conversationPage, labelPage]) => {
        if (!active) return;
        setConversations(conversationPage.data);
        setLabels(labelPage.data);
        setSelected(conversationPage.data[0] ?? null);
      })
      .catch((requestError) => {
        if (active) setError(requestError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const selectedId = selected?.id_conversa;

  useEffect(() => {
    if (selectedId === undefined) {
      setMessages([]);
      setAnnotations([]);
      setConversationLabels([]);
      return undefined;
    }

    setMessages([]);
    setAnnotations([]);
    setConversationLabels([]);
    setError('');
    let active = true;

    Promise.all([
      getConversationMessages(selectedId),
      getConversationAnnotations(selectedId),
      getConversationLabels(selectedId),
    ])
      .then(([messagePage, annotationPage, labelResult]) => {
        if (!active) return;
        setMessages(messagePage.data);
        setAnnotations(annotationPage.data);
        setConversationLabels(labelResult.data);
      })
      .catch((requestError) => {
        if (active) setError(requestError.message);
      });

    return () => {
      active = false;
    };
  }, [selectedId]);

  const filteredConversations = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase();
    return conversations.filter((conversation) =>
      `${conversation.nome ?? ''} ${conversation.telefone}`
        .toLocaleLowerCase()
        .includes(query),
    );
  }, [conversations, searchTerm]);

  async function handleSendMessage(event) {
    event.preventDefault();
    if (!selected || !messageText.trim()) return;

    setBusy(true);
    setError('');
    try {
      const result = await sendMessage(selected.id_conversa, messageText.trim());
      setMessageText('');
      setMessages((current) => [...current, {
        ...result.data,
        data_hora: new Date().toISOString(),
        nome_usuario: null,
      }]);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateAnnotation(event) {
    event.preventDefault();
    if (!selected || !annotationText.trim()) return;

    setBusy(true);
    setError('');
    try {
      const result = await createAnnotation(selected.id_conversa, annotationText.trim());
      setAnnotations((current) => [...current, result.data]);
      setAnnotationText('');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateConversation(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const requestedPhone = phone.trim();
      await createConversation(requestedPhone);
      const result = await getConversations();
      setConversations(result.data);
      const created = result.data.find((conversation) => conversation.telefone === requestedPhone);
      setSelected(created ?? result.data[0] ?? null);
      setMobileView('chat');
      setPhone('');
      setShowCreate(false);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleAddLabel(event) {
    const select = event.currentTarget;
    const labelId = Number(select.value);
    if (!selected || !labelId) return;

    setBusy(true);
    setError('');
    try {
      await addConversationLabel(selected.id_conversa, labelId);
      setConversationLabels((await getConversationLabels(selected.id_conversa)).data);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
      select.value = '';
    }
  }

  return (
    <>
      {error && <p className="api-error" role="alert">{error}</p>}
      <div className={`conversation-layout ${mobileView === 'chat' ? 'mobile-chat-view' : 'mobile-list-view'}`}>
        <section className="conversation-list">
          <div className="search-box">
            <Search size={17} />
            <input
              type="text"
              placeholder="Buscar conversa..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </div>
          <button
            className="new-conversation"
            type="button"
            onClick={() => setShowCreate((shown) => !shown)}
            disabled={busy}
          >
            <Plus size={16} /> Nova conversa
          </button>
          {showCreate && (
            <form className="new-conversation-form" onSubmit={handleCreateConversation}>
              <input
                required
                type="tel"
                placeholder="Telefone E.164 (+5511999999999)"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
              <button type="submit" disabled={busy}>Criar</button>
            </form>
          )}
          <div className="conversation-items">
            {loading && <p className="empty-state">Carregando conversas...</p>}
            {!loading && filteredConversations.length === 0 && (
              <p className="empty-state">Nenhuma conversa encontrada.</p>
            )}
            {filteredConversations.map((conversation) => (
              <button
                key={conversation.id_conversa}
                type="button"
                onClick={() => {
                  setSelected(conversation);
                  setMobileView('chat');
                }}
                disabled={busy}
                className={`conversation-item ${selectedId === conversation.id_conversa ? 'selected' : ''}`}
              >
                <div className="avatar">
                  {(conversation.nome ?? conversation.telefone).charAt(0)}
                </div>
                <div className="conv-copy">
                  <div>
                    <strong>{conversation.nome || conversation.telefone}</strong>
                    <span>{conversation.ultima_mensagem_em
                      ? new Date(conversation.ultima_mensagem_em).toLocaleDateString('pt-BR')
                      : ''}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>

        {selected ? (
          <>
            <section className="chat">
              <div className="chat-head">
                <button
                  className="mobile-back-button"
                  type="button"
                  aria-label="Voltar para a lista de conversas"
                  onClick={() => setMobileView('list')}
                >
                  <ArrowLeft size={19} />
                </button>
                <div className="customer-top">
                  <div className="avatar">
                    {(selected.nome ?? selected.telefone).charAt(0)}
                  </div>
                  <div>
                    <strong>{selected.nome || selected.telefone}</strong>
                    <p>{selected.telefone}</p>
                  </div>
                </div>
                <div className="chat-actions">
                  <button type="button" aria-label="Telefone">
                    <Phone size={19} />
                  </button>
                  <button type="button" aria-label="Mais opções">
                    <MoreHorizontal size={19} />
                  </button>
                </div>
              </div>
              <div className="messages">
                {messages.length === 0 && (
                  <p className="empty-state">Nenhuma mensagem nesta conversa.</p>
                )}
                {messages.map((message) => (
                  <div
                    key={message.id_mensagem}
                    className={`message ${message.origem === 'contato' ? 'received' : 'sent'}`}
                  >
                    {message.conteudo || `[${message.tipo}]`}
                    <small>{displayDate(message.data_hora)}</small>
                  </div>
                ))}
              </div>
              <form className="message-box" onSubmit={handleSendMessage}>
                <button type="button" aria-label="Anexar arquivo" disabled>
                  <Paperclip size={20} />
                </button>
                <input
                  type="text"
                  placeholder="Digite uma mensagem..."
                  value={messageText}
                  onChange={(event) => setMessageText(event.target.value)}
                />
                <button
                  className="send-button"
                  type="submit"
                  aria-label="Enviar mensagem"
                  disabled={busy || !messageText.trim()}
                >
                  <Send size={19} />
                </button>
              </form>
            </section>

            <aside className="customer-panel">
              <div className="customer-profile">
                <div className="avatar large">
                  {(selected.nome ?? selected.telefone).charAt(0)}
                </div>
                <h3>{selected.nome || selected.telefone}</h3>
                <span className="status-badge">
                  {selected.atendimento_aberto?.status || 'Sem atendimento ativo'}
                </span>
              </div>
              <div className="customer-details">
                <div>
                  <span>Telefone</span>
                  <strong>{selected.telefone}</strong>
                </div>
                <div>
                  <span>Contato</span>
                  <strong>
                    <Building2 size={15} />
                    {selected.nome || selected.telefone}
                  </strong>
                </div>
                <div>
                  <span>E-mail</span>
                  <strong>{selected.email || 'Não informado'}</strong>
                </div>
              </div>
              <div className="customer-section">
                <h4>Etiquetas</h4>
                <div className="tags">
                  {conversationLabels.map((label) => (
                    <span className="tag" key={label.id_etiqueta}>{label.nome}</span>
                  ))}
                </div>
                <label className="label-select">
                  <Tag size={15} />
                  <select defaultValue="" onChange={handleAddLabel} disabled={busy}>
                    <option value="">Associar etiqueta...</option>
                    {labels
                      .filter((label) => !conversationLabels.some(
                        (current) => current.id_etiqueta === label.id_etiqueta,
                      ))
                      .map((label) => (
                        <option value={label.id_etiqueta} key={label.id_etiqueta}>
                          {label.nome}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <div className="customer-section">
                <h4>Notas internas</h4>
                <form onSubmit={handleCreateAnnotation}>
                  <textarea
                    placeholder="Adicione uma observação sobre este atendimento..."
                    value={annotationText}
                    onChange={(event) => setAnnotationText(event.target.value)}
                  />
                  <button
                    className="primary note-button"
                    type="submit"
                    disabled={busy || !annotationText.trim()}
                  >
                    Salvar nota
                  </button>
                </form>
                <div className="annotation-list">
                  {annotations.map((annotation) => (
                    <article key={annotation.id_anotacao}>
                      <p>{annotation.texto}</p>
                      <small>
                        {annotation.autor_nome} · {displayDate(annotation.criada_em)}
                      </small>
                    </article>
                  ))}
                </div>
              </div>
            </aside>
          </>
        ) : (
          <section className="chat empty-chat">
            <p>{loading ? 'Carregando conversa...' : 'Selecione uma conversa ou crie uma nova.'}</p>
          </section>
        )}
      </div>
    </>
  );
}
