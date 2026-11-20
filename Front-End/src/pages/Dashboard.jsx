import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Clock,
  Filter,
  MessageCircle,
  MessageSquare,
  Timer,
} from 'lucide-react';
import MetricCard from '../components/MetricCard.jsx';
import {
  getConversations,
  getDashboardMetrics,
  getLabels,
  getUsers,
} from '../api.ts';

const CHART_COLORS = [
  '#3b7a57',
  '#d9822b',
  '#3f6699',
  '#9c4d7a',
  '#2f8f9d',
  '#b55342',
  '#6c757d',
];

function formatDate(value) {
  if (!value) return 'Sem mensagens';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR');
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (total === 0) return '0s';
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}min`;
  if (minutes > 0) return `${minutes}min ${String(secs).padStart(2, '0')}s`;
  return `${secs}s`;
}

function isoDateOffset(daysAgo) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

/**
 * Gráfico de seção de círculo (donut chart) em SVG puro.
 */
function DonutChart({ title, subtitle, centerValue, centerLabel, segments }) {
  const size = 180;
  const strokeWidth = 28;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const positiveSegments = segments.filter((segment) => segment.value > 0);
  const total = positiveSegments.reduce((sum, segment) => sum + segment.value, 0);

  let cumulativeOffset = 0;

  return (
    <article className="card donut-card">
      <div className="donut-head">
        <h3>{title}</h3>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="donut-body">
        <div className="donut-visual">
          <svg
            viewBox={`0 0 ${size} ${size}`}
            className="donut-svg"
            role="img"
            aria-label={`${title}: ${centerValue} ${centerLabel}`}
          >
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="#e7e4d8"
              strokeWidth={strokeWidth}
            />
            {total > 0 && positiveSegments.map((segment) => {
              const fraction = segment.value / total;
              const dashLength = fraction * circumference;
              const dashOffset = -cumulativeOffset;
              cumulativeOffset += dashLength;
              return (
                <circle
                  key={segment.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={segment.color}
                  strokeWidth={strokeWidth}
                  strokeDasharray={`${dashLength} ${circumference}`}
                  strokeDashoffset={dashOffset}
                  transform={`rotate(-90 ${size / 2} ${size / 2})`}
                />
              );
            })}
          </svg>
          <div className="donut-center">
            <strong>{centerValue}</strong>
            <span>{centerLabel}</span>
          </div>
        </div>
        <ul className="donut-legend">
          {segments.map((segment) => {
            const percent = total > 0 ? Math.round((segment.value / total) * 100) : 0;
            return (
              <li key={segment.label}>
                <span className="legend-dot" style={{ background: segment.color }} />
                <span className="legend-name">{segment.label}</span>
                <strong>{segment.displayValue ?? segment.value}</strong>
                <small>{total > 0 ? `${percent}%` : '0%'}</small>
              </li>
            );
          })}
        </ul>
      </div>
    </article>
  );
}

export default function Dashboard({ user, onOpenConversations }) {
  const isAdmin = user?.perfil === 'admin';

  const [users, setUsers] = useState([]);
  const [labels, setLabels] = useState([]);
  const [usuarioId, setUsuarioId] = useState('');
  const [etiquetaId, setEtiquetaId] = useState('');
  const [periodPreset, setPeriodPreset] = useState('all');
  const [dataInicial, setDataInicial] = useState('');
  const [dataFinal, setDataFinal] = useState('');

  const [metrics, setMetrics] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isAdmin) return undefined;
    let active = true;
    Promise.all([getUsers(1, 100), getLabels(), getConversations(1, 10)])
      .then(([userPage, labelPage, conversationPage]) => {
        if (!active) return;
        setUsers(userPage.data);
        setLabels(labelPage.data);
        setConversations(conversationPage.data);
      })
      .catch((requestError) => {
        if (active) setError(requestError.message);
      });
    return () => { active = false; };
  }, [isAdmin]);

  function handlePresetChange(preset) {
    setPeriodPreset(preset);
    if (preset === 'all') {
      setDataInicial('');
      setDataFinal('');
    } else if (preset === '7d') {
      setDataInicial(isoDateOffset(7));
      setDataFinal(isoDateOffset(0));
    } else if (preset === '30d') {
      setDataInicial(isoDateOffset(30));
      setDataFinal(isoDateOffset(0));
    }
  }

  function clearFilters() {
    setUsuarioId('');
    setEtiquetaId('');
    setPeriodPreset('all');
    setDataInicial('');
    setDataFinal('');
  }

  useEffect(() => {
    if (!isAdmin) return undefined;
    if (dataInicial && dataFinal && dataInicial > dataFinal) {
      setError('A data inicial deve ser anterior ou igual à data final.');
      return undefined;
    }

    let active = true;
    setLoading(true);
    setError('');
    getDashboardMetrics({
      ...(usuarioId ? { usuarioId: Number(usuarioId) } : {}),
      ...(dataInicial ? { dataInicial } : {}),
      ...(dataFinal ? { dataFinal } : {}),
      ...(etiquetaId ? { etiquetaId: Number(etiquetaId) } : {}),
    })
      .then(({ data }) => {
        if (active) setMetrics(data);
      })
      .catch((requestError) => {
        if (active) setError(requestError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [isAdmin, usuarioId, dataInicial, dataFinal, etiquetaId]);

  const totais = metrics?.totais ?? {
    total: 0,
    conversasTotais: 0,
    conversasAtivas: 0,
    atendimentosRealizados: 0,
    pendentes: 0,
    tempoMedioAtendimentoSegundos: 0,
    tempoMedioRespostaSegundos: 0,
  };

  const conversationSegments = useMemo(() => {
    const encerradas = Math.max(0, totais.conversasTotais - totais.conversasAtivas);
    return [
      { label: 'Ativas (abertas)', value: totais.conversasAtivas, color: '#3b7a57' },
      { label: 'Encerradas', value: encerradas, color: '#3f6699' },
    ];
  }, [totais.conversasAtivas, totais.conversasTotais]);

  const timeSegments = useMemo(() => {
    const resp = Math.max(0, totais.tempoMedioRespostaSegundos);
    const atend = Math.max(0, totais.tempoMedioAtendimentoSegundos);
    const conducao = Math.max(0, atend - resp);
    return [
      {
        label: 'Tempo médio de resposta',
        value: resp,
        displayValue: formatDuration(resp),
        color: '#d9822b',
      },
      {
        label: 'Condução após 1ª resposta',
        value: conducao,
        displayValue: formatDuration(conducao),
        color: '#2f8f9d',
      },
    ];
  }, [totais.tempoMedioAtendimentoSegundos, totais.tempoMedioRespostaSegundos]);

  const rankingSegments = useMemo(() => {
    const ranking = metrics?.ranking ?? [];
    if (!ranking.length) {
      return [{ label: 'Sem atendimentos encerrados', value: 0, color: '#c8c4b4' }];
    }
    return ranking.slice(0, 7).map((item, index) => ({
      label: item.nome,
      value: item.atendimentosRealizados,
      color: CHART_COLORS[index % CHART_COLORS.length],
    }));
  }, [metrics?.ranking]);

  if (!isAdmin) {
    return (
      <article className="card empty-settings">
        <strong>Acesso restrito</strong>
        <p>O dashboard está disponível apenas para usuários administradores.</p>
      </article>
    );
  }

  const hasActiveFilters = Boolean(usuarioId || etiquetaId || dataInicial || dataFinal);

  return (
    <>
      <div className="welcome">
        <div>
          <span className="eyebrow">VISÃO GERAL · ADMIN</span>
          <h2>Dashboard de atendimentos</h2>
          <p>Acompanhe conversas, tempos médios e desempenho da equipe em tempo real.</p>
        </div>
        <button className="primary" onClick={onOpenConversations}>
          <MessageCircle size={18} /> Abrir conversas
        </button>
      </div>

      <section className="card dashboard-filters" aria-label="Filtros do dashboard">
        <div className="filters-title">
          <Filter size={16} />
          <strong>Filtros</strong>
          {hasActiveFilters && (
            <button type="button" className="link-btn" onClick={clearFilters}>
              Limpar filtros
            </button>
          )}
        </div>
        <div className="filters-grid">
          <label>
            Usuário / Atendente
            <select value={usuarioId} onChange={(e) => setUsuarioId(e.target.value)}>
              <option value="">Todos os usuários</option>
              {users.map((item) => (
                <option key={item.id_usuario} value={item.id_usuario}>
                  {item.nome} ({item.perfil})
                </option>
              ))}
            </select>
          </label>
          <label>
            Período
            <select value={periodPreset} onChange={(e) => handlePresetChange(e.target.value)}>
              <option value="all">Todo o período</option>
              <option value="7d">Últimos 7 dias</option>
              <option value="30d">Últimos 30 dias</option>
              <option value="custom">Personalizado</option>
            </select>
          </label>
          <label>
            Etiqueta
            <select value={etiquetaId} onChange={(e) => setEtiquetaId(e.target.value)}>
              <option value="">Todas as etiquetas</option>
              {labels.map((label) => (
                <option key={label.id_etiqueta} value={label.id_etiqueta}>
                  {label.nome}
                </option>
              ))}
            </select>
          </label>
          {periodPreset === 'custom' && (
            <>
              <label>
                Data inicial
                <input
                  type="date"
                  value={dataInicial}
                  onChange={(e) => setDataInicial(e.target.value)}
                />
              </label>
              <label>
                Data final
                <input
                  type="date"
                  value={dataFinal}
                  onChange={(e) => setDataFinal(e.target.value)}
                />
              </label>
            </>
          )}
        </div>
      </section>

      {error && <p className="api-error" role="alert">{error}</p>}

      <section className="dashboard-metrics-grid" aria-label="Indicadores principais">
        <MetricCard
          title="Conversas totais"
          value={loading ? '...' : totais.conversasTotais}
          detail={`${totais.total} atendimento(s) no filtro`}
          Icon={MessageSquare}
        />
        <MetricCard
          title="Conversas ativas"
          value={loading ? '...' : totais.conversasAtivas}
          detail="Atendimentos em aberto agora"
          Icon={Activity}
        />
        <MetricCard
          title="Tempo médio de atendimento"
          value={loading ? '...' : formatDuration(totais.tempoMedioAtendimentoSegundos)}
          detail={`${totais.atendimentosRealizados} atendimento(s) encerrado(s)`}
          Icon={Clock}
        />
        <MetricCard
          title="Tempo médio de resposta"
          value={loading ? '...' : formatDuration(totais.tempoMedioRespostaSegundos)}
          detail="Cliente → atendente (após msg inicial)"
          Icon={Timer}
        />
      </section>

      <section className="dashboard-charts-grid" aria-label="Gráficos de seção de círculo">
        <DonutChart
          title="Conversas ativas vs. encerradas"
          subtitle="Proporção sobre o total de conversas no filtro"
          centerValue={loading ? '...' : totais.conversasTotais}
          centerLabel="conversas"
          segments={conversationSegments}
        />
        <DonutChart
          title="Composição do tempo médio"
          subtitle="Tempo de resposta inicial vs. condução do atendimento"
          centerValue={loading ? '...' : formatDuration(totais.tempoMedioAtendimentoSegundos)}
          centerLabel="atendimento"
          segments={timeSegments}
        />
        <DonutChart
          title="Atendimentos por atendente"
          subtitle="Distribuição de atendimentos encerrados"
          centerValue={loading ? '...' : totais.atendimentosRealizados}
          centerLabel="realizados"
          segments={rankingSegments}
        />
      </section>

      <article className="card recent-card">
        <div className="card-head">
          <div>
            <h3>Conversas recentes</h3>
            <p>{`${conversations.length} conversa(s) recente(s)`}</p>
          </div>
        </div>
        {conversations.length === 0 && <p className="empty-state">Ainda não há conversas.</p>}
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
