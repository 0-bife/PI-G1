import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { getPendingAlerts } from '../api.ts';

const REFRESH_MS = 15_000;
const MAX_BACKOFF_MS = 5 * 60_000;
export const ALERTS_REFRESH_EVENT = 'inablink:alerts-refresh';

function waitingLabel(minutes) {
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  return `há ${Math.floor(hours / 24)} d`;
}

export default function NotificationBell({ onOpenConversation, onCountChange }) {
  const [alerts, setAlerts] = useState([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const rootRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const result = await getPendingAlerts();
      setAlerts(result.data);
      setError(false);
      return true;
    } catch {
      setError(true);
      return false;
    } finally {
      setLoaded(true);
    }
  }, []);

  // Atualiza periodicamente e imediatamente quando ocorrer resposta/encerramento ou retorno à aba.
  useEffect(() => {
    let active = true;
    let timer;
    let delay = REFRESH_MS;

    async function tick() {
      if (document.visibilityState === 'visible') {
        const ok = await load();
        delay = ok ? REFRESH_MS : Math.min(delay * 2, MAX_BACKOFF_MS);
      }
      if (active) timer = setTimeout(tick, delay);
    }
    tick();

    const handleRefresh = () => {
      if (active) load();
    };
    const handleVisibility = () => {
      if (active && document.visibilityState === 'visible') load();
    };

    window.addEventListener(ALERTS_REFRESH_EVENT, handleRefresh);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener(ALERTS_REFRESH_EVENT, handleRefresh);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [load]);

  useEffect(() => {
    onCountChange?.(alerts.length);
  }, [alerts, onCountChange]);

  // Fecha ao clicar fora ou apertar Esc.
  useEffect(() => {
    if (!open) return undefined;
    const handleClick = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const handleKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  function toggle() {
    if (!open) load();
    setOpen((current) => !current);
  }

  function openAlert(alert) {
    setOpen(false);
    onOpenConversation(alert.id_conversa);
  }

  const count = alerts.length;

  return (
    <div className="notification-wrap" ref={rootRef}>
      <button
        type="button"
        className="icon-btn notification"
        aria-label={count ? `${count} conversa(s) aguardando resposta` : 'Notificações'}
        aria-expanded={open}
        onClick={toggle}
      >
        <Bell size={19} />
        {count > 0 && <span className="notification-count">{count > 99 ? '99+' : count}</span>}
      </button>

      {open && (
        <div className="notification-panel" role="dialog" aria-label="Conversas aguardando resposta">
          <header>
            <strong>Aguardando resposta</strong>
            {count > 0 && <span>{count}</span>}
          </header>

          <div className="notification-list">
            {!loaded && <p className="empty-state">Carregando...</p>}
            {loaded && error && count === 0 && (
              <p className="empty-state">Não foi possível carregar as notificações.</p>
            )}
            {loaded && !error && count === 0 && (
              <p className="empty-state">Nenhuma conversa aguardando resposta.</p>
            )}
            {alerts.map((alert) => {
              const name = alert.contato.nome || alert.contato.telefone;
              return (
                <button
                  type="button"
                  className="notification-item"
                  key={alert.id_atendimento}
                  onClick={() => openAlert(alert)}
                >
                  <span className="avatar">{name.charAt(0)}</span>
                  <span className="notification-text">
                    <strong>{name}</strong>
                    <small>
                      {alert.contato.nome ? `${alert.contato.telefone} · ` : ''}
                      sem resposta {waitingLabel(alert.minutosSemResposta)}
                    </small>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}