import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { labelStyle } from '../labelColors.js';
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  MoreHorizontal,
  Paperclip,
  Phone,
  Plus,
  RotateCcw,
  Search,
  Send,
  Tag,
  UserCheck,
  X,
} from 'lucide-react';
import {
  addAssignment,
  addConversationLabel,
  closeAssignment,
  createAnnotation,
  createConversation,
  getConversation,
  getConversationAnnotations,
  getConversationAttendances,
  getConversationLabels,
  getConversationMessages,
  getConversations,
  getMessage,
  getLabels,
  getUsers,
  openAttendance,
  searchConversations,
  sendMessage,
  updateAttendanceStatus,
} from '../api.ts';

import { ALERTS_REFRESH_EVENT } from '../components/NotificationBell.jsx';

const POLL_INTERVAL_MS = 5_000;

function notifyAlertsRefresh() {
  window.dispatchEvent(new Event(ALERTS_REFRESH_EVENT));
}

function displayDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR');
}

export default function Conversations({ user, focusId, onFocusHandled }) {
  const [conversations, setConversations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [mobileView, setMobileView] = useState('list');
  const [messages, setMessages] = useState([]);
  const [annotations, setAnnotations] = useState([]);
  const [labels, setLabels] = useState([]);
  const [teamUsers, setTeamUsers] = useState([]);
  const [latestAttendance, setLatestAttendance] = useState(null);
  const [conversationLabels, setConversationLabels] = useState([]);
  const [searchResults, setSearchResults] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [pendingMessageId, setPendingMessageId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [messageText, setMessageText] = useState('');
  const [annotationText, setAnnotationText] = useState('');
  const [phone, setPhone] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const messagesRef = useRef(null);
  const isAdmin = user?.perfil === 'admin';
  const canCreate = isAdmin;

  useEffect(() => {
    let active = true;
    const requests = [getConversations(1, 100), getLabels()];
    if (isAdmin) requests.push(getUsers(1, 100));
    Promise.all(requests)
      .then(([conversationPage, labelPage, userPage]) => {
        if (!active) return;
        setConversations(conversationPage.data);
        setLabels(labelPage.data);
        if (userPage) {
          setTeamUsers(userPage.data.filter((item) => item.ativo));
        }
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
  }, [isAdmin]);

  const selectedId = selected?.id_conversa;

  useEffect(() => {
    if (!focusId || loading) return;
    const found = conversations.find((conversation) => conversation.id_conversa === focusId);
    if (found) setSelected(found);
    onFocusHandled?.();
  }, [focusId, loading, conversations, onFocusHandled]);

  useEffect(() => {
    const query = searchTerm.trim();
    if (!query) {
      setSearchResults(null);
      setSearchLoading(false);
      return undefined;
    }

    let active = true;
    const timer = setTimeout(() => {
      setSearchLoading(true);
      searchConversations(query)
        .then((result) => {
          if (active) setSearchResults(result.data);
        })
        .catch((requestError) => {
          if (active) setError(requestError.message);
        })
        .finally(() => {
          if (active) setSearchLoading(false);
        });
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [searchTerm]);

  useEffect(() => {
    if (selectedId === undefined) {
      setMessages([]);
      setAnnotations([]);
      setConversationLabels([]);
      setLatestAttendance(null);
      return undefined;
    }

    setMessages([]);
    setAnnotations([]);
    setConversationLabels([]);
    setLatestAttendance(null);
    setError('');
    let active = true;

    Promise.all([
      getConversation(selectedId),
      getConversationMessages(selectedId, 1, 100),
      getConversationAnnotations(selectedId),
      getConversationLabels(selectedId),
      getConversationAttendances(selectedId, 1, 5),
    ])
      .then(async ([conversationResult, messagePage, annotationPage, labelResult, attendancePage]) => {
        if (!active) return;
        const freshConversation = conversationResult.data;
        setSelected((current) => (current?.id_conversa === freshConversation.id_conversa ? freshConversation : current));
        setConversations((list) => list.map((item) => (
          item.id_conversa === freshConversation.id_conversa ? freshConversation : item
        )));
        setLatestAttendance(attendancePage.data[0] ?? null);
        let loadedMessages = messagePage.data;
        if (pendingMessageId !== null && !loadedMessages.some(
          (message) => String(message.id_mensagem) === String(pendingMessageId),
        )) {
          const targetMessage = (await getMessage(pendingMessageId)).data;
          if (!active) return;
          loadedMessages = [...loadedMessages, targetMessage]
            .sort((left, right) => new Date(left.data_hora) - new Date(right.data_hora));
        }
        setMessages(loadedMessages);
        setAnnotations(annotationPage.data);
        setConversationLabels(labelResult.data);
      })
      .catch((requestError) => {
        if (active) setError(requestError.message);
      });

    return () => {
      active = false;
    };
  }, [selectedId, pendingMessageId]);

  // Polling silencioso para atualizar conversas, mensagens recebidas pelo webhook,
  // etiquetas automáticas e status do atendimento sem recarregar a página.
  useEffect(() => {
    let active = true;
    let inFlight = false;

    async function syncLiveUpdates() {
      if (!active || inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;
      try {
        const conversationPage = await getConversations(1, 100);
        if (!active) return;

        setConversations((prev) => {
          const prevTop = prev[0]?.ultima_mensagem_em;
          const nextTop = conversationPage.data[0]?.ultima_mensagem_em;
          if (prev.length !== conversationPage.data.length || prevTop !== nextTop) {
            notifyAlertsRefresh();
          }
          return conversationPage.data;
        });

        if (selectedId !== undefined) {
          const matched = conversationPage.data.find((item) => item.id_conversa === selectedId);
          if (matched) setSelected(matched);

          const [messagePage, labelResult, attendancePage] = await Promise.all([
            getConversationMessages(selectedId, 1, 100),
            getConversationLabels(selectedId),
            getConversationAttendances(selectedId, 1, 5),
          ]);
          if (!active) return;

          setConversationLabels(labelResult.data);
          setLatestAttendance(attendancePage.data[0] ?? null);
          setMessages((prev) => {
            const next = messagePage.data;
            const prevLastId = prev.at(-1)?.id_mensagem;
            const nextLastId = next.at(-1)?.id_mensagem;
            const hasNewMessages = next.length !== prev.length || nextLastId !== prevLastId;
            if (hasNewMessages) {
              notifyAlertsRefresh();
              requestAnimationFrame(() => {
                const container = messagesRef.current;
                if (container) {
                  container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
                }
              });
            }
            return next;
          });
        }
      } catch {
        // Falha transitória no polling silencioso não interrompe o uso da tela.
      } finally {
        inFlight = false;
      }
    }

    const intervalId = window.setInterval(syncLiveUpdates, POLL_INTERVAL_MS);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') syncLiveUpdates();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [selectedId]);

  const filteredConversations = useMemo(() => {
    if (searchTerm.trim()) return searchResults?.conversas ?? [];
    const query = searchTerm.trim().toLocaleLowerCase();
    return conversations.filter((conversation) =>
      `${conversation.nome ?? ''} ${conversation.telefone}`
        .toLocaleLowerCase()
        .includes(query),
    );
  }, [conversations, searchResults, searchTerm]);

  const focusMessage = useCallback((element) => {
    if (
      !element
      || pendingMessageId === null
      || String(element.dataset.messageId) !== String(pendingMessageId)
    ) return;

    requestAnimationFrame(() => {
      const container = messagesRef.current;
      if (!container || !element.isConnected) return;
      const targetTop = element.offsetTop - (container.clientHeight - element.offsetHeight) / 2;
      container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
      element.classList.add('message-highlight');
      window.setTimeout(() => element.classList.remove('message-highlight'), 1400);
      setPendingMessageId(null);
    });
  }, [pendingMessageId]);

  function openConversation(conversation, messageId = null) {
    setSelected(conversation);
    setPendingMessageId(messageId);
    setMobileView('chat');
  }

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
        nome_usuario: user?.nome ?? null,
      }]);
      notifyAlertsRefresh();
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

  async function refreshSelectedConversation(conversationId) {
    const [conversationResult, attendancePage] = await Promise.all([
      getConversation(conversationId),
      getConversationAttendances(conversationId, 1, 5),
    ]);
    const updated = conversationResult.data;
    setSelected(updated);
    setLatestAttendance(attendancePage.data[0] ?? null);
    setConversations((list) => list.map((item) => (
      item.id_conversa === updated.id_conversa ? updated : item
    )));
  }

  async function handleCloseAttendance() {
    const attendanceId = selected?.atendimento_aberto?.id_atendimento;
    if (!selected || !attendanceId) return;
    if (!window.confirm('Deseja encerrar este atendimento? Ele poderá ser reaberto em até 24h desde a primeira mensagem do cliente.')) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      await updateAttendanceStatus(attendanceId, 'closed');
      await refreshSelectedConversation(selected.id_conversa);
      notifyAlertsRefresh();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleReopenAttendance() {
    const attendanceId = latestAttendance?.id_atendimento;
    if (!selected || !attendanceId) return;
    setBusy(true);
    setError('');
    try {
      await updateAttendanceStatus(attendanceId, 'open');
      await refreshSelectedConversation(selected.id_conversa);
      notifyAlertsRefresh();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleAssignUser(targetUserId) {
    if (!selected || !targetUserId) return;
    setBusy(true);
    setError('');
    try {
      let attendanceId = selected.atendimento_aberto?.id_atendimento;
      if (!attendanceId) {
        const opened = await openAttendance(selected.id_conversa);
        attendanceId = opened.data.id_atendimento;
      }
      await addAssignment(attendanceId, Number(targetUserId));
      await refreshSelectedConversation(selected.id_conversa);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveAssignment(assignmentId) {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      await closeAssignment(assignmentId);
      await refreshSelectedConversation(selected.id_conversa);
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
              placeholder="Buscar contato ou mensagem..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </div>
          {canCreate && (
            <button
              className="new-conversation"
              type="button"
              onClick={() => setShowCreate((shown) => !shown)}
              disabled={busy}
            >
              <Plus size={16} /> Nova conversa
            </button>
          )}
          {canCreate && showCreate && (
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
            {searchTerm.trim() && searchLoading && (
              <p className="empty-state">Buscando...</p>
            )}
            {searchTerm.trim() && !searchLoading && searchResults && (
              <>
                {searchResults.conversas.map((conversation) => (
                  <button
                    key={`conversation-${conversation.id_conversa}`}
                    type="button"
                    className="conversation-item search-result"
                    onClick={() => openConversation(conversation)}
                    disabled={busy}
                  >
                    <div className="avatar">
                      {(conversation.nome ?? conversation.telefone).charAt(0)}
                    </div>
                    <div className="conv-copy">
                      <strong>{conversation.nome || conversation.telefone}</strong>
                      <span>Conversa</span>
                    </div>
                  </button>
                ))}
                {searchResults.mensagens.map((message) => (
                  <button
                    key={`message-${message.id_mensagem}`}
                    type="button"
                    className="conversation-item search-result"
                    onClick={() => openConversation(message.conversa, message.id_mensagem)}
                    disabled={busy}
                  >
                    <div className="avatar">
                      {(message.conversa.nome ?? message.conversa.telefone).charAt(0)}
                    </div>
                    <div className="conv-copy">
                      <strong>{message.conversa.nome || message.conversa.telefone}</strong>
                      <span>{message.conteudo || `[${message.tipo}]`}</span>
                    </div>
                  </button>
                ))}
              </>
            )}
            {searchTerm.trim() && !searchLoading && searchResults
              && !searchResults.conversas.length && !searchResults.mensagens.length && (
              <p className="empty-state">Nenhum resultado encontrado.</p>
            )}
            {!searchTerm.trim() && loading && <p className="empty-state">Carregando conversas...</p>}
            {!searchTerm.trim() && !loading && filteredConversations.length === 0 && (
              <p className="empty-state">{canCreate ? 'Nenhuma conversa encontrada.' : 'Nenhuma conversa atribuída a você.'}</p>
            )}
            {!searchTerm.trim() && filteredConversations.map((conversation) => (
              <button
                key={conversation.id_conversa}
                type="button"
                onClick={() => openConversation(conversation)}
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
                  {isAdmin && (
                    <em className="conv-assignee">
                      {conversation.responsaveis_ativos?.length
                        ? `Atendente: ${conversation.responsaveis_ativos.map((r) => r.nome).join(', ')}`
                        : 'Sem atendente atribuído'}
                    </em>
                  )}
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
                  {/*<button type="button" aria-label="Telefone">
                    <Phone size={19} />
                  </button>*/}
                  {/*<button type="button" aria-label="Mais opções">
                    <MoreHorizontal size={19} />
                  </button>*/}
                </div>
              </div>
              <div className="messages" ref={messagesRef}>
                {messages.length === 0 && (
                  <p className="empty-state">Nenhuma mensagem nesta conversa.</p>
                )}
                {messages.map((message) => (
                  <div
                    key={message.id_mensagem}
                    ref={focusMessage}
                    data-message-id={message.id_mensagem}
                    className={`message ${message.origem === 'contato' ? 'received' : 'sent'} ${message.origem === 'chatbot' ? 'chatbot' : ''}`}
                  >
                    <span className="message-body">{message.conteudo || `[${message.tipo}]`}</span>
                    <small>
                      {message.origem === 'chatbot'
                        ? 'Automática · '
                        : message.nome_usuario
                          ? `${message.nome_usuario} · `
                          : ''}
                      {displayDate(message.data_hora)}
                    </small>
                  </div>
                ))}
              </div>
              <form className="message-box" onSubmit={handleSendMessage}>
                {/*}button type="button" aria-label="Anexar arquivo" disabled>
                  <Paperclip size={20} />
                </button>*/}
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
                  {selected.atendimento_aberto?.status === 'open'
                    ? 'Em atendimento'
                    : latestAttendance?.status === 'closed'
                      ? 'Atendimento encerrado'
                      : 'Sem atendimento ativo'}
                </span>
                {selected.atendimento_aberto?.id_atendimento && (
                  isAdmin || selected.responsaveis_ativos?.some(
                    (assignment) => assignment.FK_USUARIO_id_usuario === user?.id_usuario,
                  )
                ) && (
                  <button
                    type="button"
                    className="attendance-action close"
                    disabled={busy}
                    onClick={handleCloseAttendance}
                  >
                    <CheckCircle2 size={15} /> Encerrar atendimento
                  </button>
                )}
                {!selected.atendimento_aberto && latestAttendance?.status === 'closed' && (
                  <div className="reopen-block">
                    <button
                      type="button"
                      className="attendance-action reopen"
                      disabled={busy}
                      onClick={handleReopenAttendance}
                    >
                      <RotateCcw size={15} /> Reabrir atendimento
                    </button>
                    <small className="empty-inline">
                      Reversível em até 24h da 1ª mensagem do cliente.
                    </small>
                  </div>
                )}
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
                <h4>Responsáveis</h4>
                <div className="assignees-list">
                  {selected.responsaveis_ativos?.length ? (
                    selected.responsaveis_ativos.map((assignment) => (
                      <span className="assignee-chip" key={assignment.id_atribuicao}>
                        <UserCheck size={14} />
                        <span>{assignment.nome}</span>
                        {isAdmin && (
                          <button
                            type="button"
                            className="chip-remove"
                            aria-label={`Remover atribuição de ${assignment.nome}`}
                            disabled={busy}
                            onClick={() => handleRemoveAssignment(assignment.id_atribuicao)}
                          >
                            <X size={13} />
                          </button>
                        )}
                      </span>
                    ))
                  ) : (
                    <p className="empty-inline">Nenhum atendente atribuído.</p>
                  )}
                </div>
                {isAdmin && (
                  <div className="assignee-controls">
                    {user && !selected.responsaveis_ativos?.some(
                      (assignment) => assignment.FK_USUARIO_id_usuario === user.id_usuario,
                    ) && (
                      <button
                        type="button"
                        className="secondary-btn"
                        disabled={busy}
                        onClick={() => handleAssignUser(user.id_usuario)}
                      >
                        Assumir conversa
                      </button>
                    )}
                    <label className="label-select">
                      <UserCheck size={15} />
                      <select
                        defaultValue=""
                        disabled={busy}
                        onChange={(event) => {
                          const targetId = Number(event.currentTarget.value);
                          event.currentTarget.value = '';
                          if (targetId) handleAssignUser(targetId);
                        }}
                      >
                        <option value="">Atribuir para...</option>
                        {teamUsers
                          .filter((member) => !selected.responsaveis_ativos?.some(
                            (assignment) => assignment.FK_USUARIO_id_usuario === member.id_usuario,
                          ))
                          .map((member) => (
                            <option value={member.id_usuario} key={member.id_usuario}>
                              {member.nome} ({member.perfil})
                            </option>
                          ))}
                      </select>
                    </label>
                  </div>
                )}
              </div>
              <div className="customer-section">
                <h4>Etiquetas</h4>
                <div className="tags">
                  {conversationLabels.map((label) => (
                    <span className="tag" key={label.id_etiqueta} style={labelStyle(label.cor)}>{label.nome}</span>
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
            <p>{loading ? 'Carregando conversa...' : canCreate
                ? 'Selecione uma conversa ou crie uma nova.'
                : 'Selecione uma conversa.'}
            </p>
          </section>
        )}
      </div>
    </>
  );
}
