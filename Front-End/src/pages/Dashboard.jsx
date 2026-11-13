import { useEffect, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { getConversations } from '../api.ts';

function formatDate(value) {
  if (!value) return 'Sem mensagens';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR');
}

export default function Dashboard({ onOpenConversations }) {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    getConversations()
      .then((result) => active && setConversations(result.data))
      .catch((requestError) => active && setError(requestError.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  return (
    <>
      <div className="welcome">
        <div>
          <span className="eyebrow">VISÃO GERAL</span>
          <h2>Atendimento em um só lugar</h2>
          <p>Consulte as conversas carregadas da sua conta.</p>
        </div>
        <button className="primary" onClick={onOpenConversations}>
          <MessageCircle size={18} /> Abrir conversas
        </button>
      </div>
      {error && <p className="api-error" role="alert">{error}</p>}
      <article className="card recent-card">
        <div className="card-head">
          <div>
            <h3>Conversas recentes</h3>
            <p>{loading ? 'Carregando...' : `${conversations.length} conversa(s) nesta página`}</p>
          </div>
        </div>
        {loading && <p className="empty-state">Carregando conversas...</p>}
        {!loading && !error && conversations.length === 0 && <p className="empty-state">Ainda não há conversas.</p>}
        {conversations.map((conversation) => (
          <div className="recent-row" key={conversation.id_conversa}>
            <div className="avatar pale">{(conversation.nome || conversation.telefone).charAt(0)}</div>
            <div className="grow">
              <strong>{conversation.nome || conversation.telefone}</strong>
              <small>{conversation.telefone}</small>
            </div>
            <span className="tag">{conversation.atendimento_aberto?.status || 'Sem atendimento'}</span>
            <small>{formatDate(conversation.ultima_mensagem_em)}</small>
          </div>
        ))}
      </article>
    </>
  );
}
