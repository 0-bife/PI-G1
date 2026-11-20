import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Award,
  Clock,
  Filter,
  MessageSquare,
  Timer,
} from 'lucide-react';
import PageHeading from '../components/PageHeading.jsx';
import MetricCard from '../components/MetricCard.jsx';
import { getAttendanceReport, getLabels } from '../api.ts';

function isoDateOffset(daysAgo) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().slice(0, 10);
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

const SORT_OPTIONS = [
  { value: 'atendimentosRealizados', label: 'Atendimentos realizados' },
  { value: 'conversasTotais', label: 'Conversas totais' },
  { value: 'tempoMedioRespostaSegundos', label: 'Menor tempo médio de resposta' },
  { value: 'tempoMedioAtendimentoSegundos', label: 'Menor tempo médio de atendimento' },
  { value: 'taxaConclusaoPercentual', label: 'Taxa de conclusão' },
];

export default function Relatorios({ user }) {
  const isAdmin = user?.perfil === 'admin';

  const [periodPreset, setPeriodPreset] = useState('30d');
  const [dataInicial, setDataInicial] = useState(() => isoDateOffset(30));
  const [dataFinal, setDataFinal] = useState(() => isoDateOffset(0));
  const [etiquetaId, setEtiquetaId] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [sortBy, setSortBy] = useState('atendimentosRealizados');

  const [labels, setLabels] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isAdmin) return undefined;
    let active = true;
    getLabels()
      .then((page) => { if (active) setLabels(page.data); })
      .catch((requestError) => { if (active) setError(requestError.message); });
    return () => { active = false; };
  }, [isAdmin]);

  function handlePresetChange(preset) {
    setPeriodPreset(preset);
    if (preset === '7d') {
      setDataInicial(isoDateOffset(7));
      setDataFinal(isoDateOffset(0));
    } else if (preset === '30d') {
      setDataInicial(isoDateOffset(30));
      setDataFinal(isoDateOffset(0));
    } else if (preset === '90d') {
      setDataInicial(isoDateOffset(90));
      setDataFinal(isoDateOffset(0));
    }
  }

  useEffect(() => {
    if (!isAdmin) return undefined;
    if (!dataInicial || !dataFinal) return undefined;
    if (dataInicial > dataFinal) {
      setError('A data inicial deve ser anterior ou igual à data final.');
      return undefined;
    }

    let active = true;
    setLoading(true);
    setError('');
    getAttendanceReport({
      dataInicial,
      dataFinal,
      ...(etiquetaId ? { etiquetaId: Number(etiquetaId) } : {}),
    })
      .then(({ data }) => {
        if (active) setRows(data);
      })
      .catch((requestError) => {
        if (active) setError(requestError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [isAdmin, dataInicial, dataFinal, etiquetaId]);

  const rankedRows = useMemo(() => {
    const filtered = roleFilter === 'all'
      ? rows
      : rows.filter((item) => item.perfil === roleFilter);

    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === 'tempoMedioRespostaSegundos' || sortBy === 'tempoMedioAtendimentoSegundos') {
        const aVal = a[sortBy] > 0 ? a[sortBy] : Number.POSITIVE_INFINITY;
        const bVal = b[sortBy] > 0 ? b[sortBy] : Number.POSITIVE_INFINITY;
        if (aVal !== bVal) return aVal - bVal;
      } else if (b[sortBy] !== a[sortBy]) {
        return b[sortBy] - a[sortBy];
      }
      if (b.atendimentosRealizados !== a.atendimentosRealizados) {
        return b.atendimentosRealizados - a.atendimentosRealizados;
      }
      return a.nome.localeCompare(b.nome, 'pt-BR');
    });

    return sorted.map((item, index) => ({ ...item, rankPosition: index + 1 }));
  }, [rows, roleFilter, sortBy]);

  const summary = useMemo(() => {
    const conversasTotais = rankedRows.reduce((acc, row) => acc + row.conversasTotais, 0);
    const conversasAtivas = rankedRows.reduce((acc, row) => acc + row.conversasAtivas, 0);
    const atendimentosRealizados = rankedRows.reduce((acc, row) => acc + row.atendimentosRealizados, 0);
    const responseSamples = rankedRows.filter((row) => row.tempoMedioRespostaSegundos > 0);
    const attendanceSamples = rankedRows.filter((row) => row.tempoMedioAtendimentoSegundos > 0);
    const tempoMedioResposta = responseSamples.length
      ? responseSamples.reduce((acc, row) => acc + row.tempoMedioRespostaSegundos, 0) / responseSamples.length
      : 0;
    const tempoMedioAtendimento = attendanceSamples.length
      ? attendanceSamples.reduce((acc, row) => acc + row.tempoMedioAtendimentoSegundos, 0) / attendanceSamples.length
      : 0;
    return {
      conversasTotais,
      conversasAtivas,
      atendimentosRealizados,
      tempoMedioResposta,
      tempoMedioAtendimento,
    };
  }, [rankedRows]);

  const maxBarValue = useMemo(() => {
    if (!rankedRows.length) return 1;
    if (sortBy === 'taxaConclusaoPercentual') return 100;
    if (sortBy === 'tempoMedioRespostaSegundos' || sortBy === 'tempoMedioAtendimentoSegundos') {
      return Math.max(1, ...rankedRows.map((row) => row[sortBy]));
    }
    return Math.max(1, ...rankedRows.map((row) => row[sortBy]));
  }, [rankedRows, sortBy]);

  function barWidth(row) {
    const val = Number(row[sortBy]) || 0;
    if (val <= 0) return '0%';
    if (sortBy === 'tempoMedioRespostaSegundos' || sortBy === 'tempoMedioAtendimentoSegundos') {
      // Menor tempo = barra maior
      const ratio = 1 - (val / (maxBarValue * 1.15));
      return `${Math.max(12, Math.round(ratio * 100))}%`;
    }
    return `${Math.min(100, Math.round((val / maxBarValue) * 100))}%`;
  }

  function highlightValue(row) {
    if (sortBy === 'tempoMedioRespostaSegundos' || sortBy === 'tempoMedioAtendimentoSegundos') {
      return formatDuration(row[sortBy]);
    }
    if (sortBy === 'taxaConclusaoPercentual') {
      return `${row.taxaConclusaoPercentual}%`;
    }
    return String(row[sortBy]);
  }

  if (!isAdmin) {
    return (
      <article className="card empty-settings">
        <strong>Acesso restrito</strong>
        <p>Os relatórios de desempenho estão disponíveis apenas para administradores.</p>
      </article>
    );
  }

  return (
    <>
      <PageHeading
        title="Relatórios"
        text="Ranking de desempenho de atendentes e usuários baseado nas métricas do dashboard."
      />

      <section className="card dashboard-filters" aria-label="Filtros do relatório">
        <div className="filters-title">
          <Filter size={16} />
          <strong>Filtros e ordenação do ranking</strong>
        </div>
        <div className="filters-grid">
          <label>
            Período
            <select value={periodPreset} onChange={(e) => handlePresetChange(e.target.value)}>
              <option value="7d">Últimos 7 dias</option>
              <option value="30d">Últimos 30 dias</option>
              <option value="90d">Últimos 90 dias</option>
              <option value="custom">Personalizado</option>
            </select>
          </label>
          <label>
            Perfil
            <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
              <option value="all">Atendentes e admins</option>
              <option value="atendente">Somente atendentes</option>
              <option value="admin">Somente administradores</option>
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
          <label>
            Ordenar ranking por
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
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

      <section className="dashboard-metrics-grid" aria-label="Resumo do período">
        <MetricCard
          title="Conversas totais"
          value={loading ? '...' : summary.conversasTotais}
          detail={`${summary.atendimentosRealizados} atendimento(s) encerrado(s)`}
          Icon={MessageSquare}
        />
        <MetricCard
          title="Conversas ativas"
          value={loading ? '...' : summary.conversasAtivas}
          detail="Atendimentos em aberto no período"
          Icon={Activity}
        />
        <MetricCard
          title="Tempo médio de atendimento"
          value={loading ? '...' : formatDuration(summary.tempoMedioAtendimento)}
          detail="Média dos usuários no ranking"
          Icon={Clock}
        />
        <MetricCard
          title="Tempo médio de resposta"
          value={loading ? '...' : formatDuration(summary.tempoMedioResposta)}
          detail="Cliente → atendente (após msg inicial)"
          Icon={Timer}
        />
      </section>

      <article className="card ranking-panel">
        <div className="card-head">
          <div>
            <h3><Award size={18} /> Ranking de atendentes e usuários</h3>
            <p>
              {loading
                ? 'Carregando dados da API...'
                : `${rankedRows.length} usuário(s) · Período de ${dataInicial} até ${dataFinal}`}
            </p>
          </div>
        </div>

        {!loading && !error && rankedRows.length === 0 && (
          <p className="empty-state">Nenhum dado encontrado para os filtros selecionados.</p>
        )}

        {!loading && rankedRows.length > 0 && (
          <>
            <div className="ranking-bars">
              {rankedRows.map((row) => (
                <div className="rank" key={row.id}>
                  <b className={row.rankPosition <= 3 ? `podium podium-${row.rankPosition}` : ''}>
                    #{row.rankPosition}
                  </b>
                  <span className="rank-user">
                    {row.nome}
                    <small className="role-pill">{row.perfil === 'admin' ? 'Admin' : 'Atendente'}</small>
                  </span>
                  <div className="progress">
                    <i style={{ width: barWidth(row) }} />
                  </div>
                  <strong>{highlightValue(row)}</strong>
                </div>
              ))}
            </div>

            <div className="ranking-table-wrap">
              <table className="ranking-table">
                <thead>
                  <tr>
                    <th>Pos.</th>
                    <th>Usuário</th>
                    <th>Perfil</th>
                    <th>Conversas totais</th>
                    <th>Conversas ativas</th>
                    <th>Realizados</th>
                    <th>Tempo médio resp.</th>
                    <th>Tempo médio atend.</th>
                    <th>Conclusão</th>
                  </tr>
                </thead>
                <tbody>
                  {rankedRows.map((row) => (
                    <tr key={row.id}>
                      <td><strong>#{row.rankPosition}</strong></td>
                      <td>{row.nome}</td>
                      <td>
                        <span className="role-pill">{row.perfil === 'admin' ? 'Admin' : 'Atendente'}</span>
                      </td>
                      <td>{row.conversasTotais}</td>
                      <td>{row.conversasAtivas}</td>
                      <td>{row.atendimentosRealizados}</td>
                      <td>{formatDuration(row.tempoMedioRespostaSegundos)}</td>
                      <td>{formatDuration(row.tempoMedioAtendimentoSegundos)}</td>
                      <td>{row.taxaConclusaoPercentual}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </article>
    </>
  );
}
