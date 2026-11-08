import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, X } from 'lucide-react';
import { getAttendanceAlerts } from '../api.ts';
import { getAttendanceAlertMinutes } from '../attendanceAlertConfig.js';

const POLLING_INTERVAL = 60 * 1000;
const DISMISS_COOLDOWN = 5 * 60 * 1000;
const MAX_VISIBLE_ALERTS = 4;

export default function AttendanceAlert({ onOpenConversations }) {
  const [alerts, setAlerts] = useState([]);
  const [dismissedAt, setDismissedAt] = useState({});
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    async function loadAlerts() {
      try {
        const result = await getAttendanceAlerts(getAttendanceAlertMinutes());
        if (active) {
          setAlerts(result.data);
          setError('');
        }
      } catch (requestError) {
        if (active) setError(requestError.message);
      }
    }

    loadAlerts();
    const intervalId = window.setInterval(loadAlerts, POLLING_INTERVAL);
    const handleConfigurationChange = () => loadAlerts();
    window.addEventListener('inablink:attendance-alert-config-changed', handleConfigurationChange);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener('inablink:attendance-alert-config-changed', handleConfigurationChange);
    };
  }, []);

  const visibleAlerts = alerts.filter((alert) => {
    const dismissedTime = dismissedAt[alert.id_atendimento];
    return !dismissedTime || Date.now() - dismissedTime >= DISMISS_COOLDOWN;
  });
  if (!visibleAlerts.length) return null;

  function dismiss(id) {
    setDismissedAt((current) => ({
      ...current,
      [id]: Date.now(),
    }));
  }

  const displayedAlerts = visibleAlerts.slice(0, MAX_VISIBLE_ALERTS);
  const remainingCount = visibleAlerts.length - displayedAlerts.length;

  return (
    <div className="attendance-alert-stack">
      {displayedAlerts.map((alert) => (
        <aside className="attendance-alert" key={alert.id_atendimento} role="alert" aria-live="polite">
          <button
            className="attendance-alert-close"
            type="button"
            aria-label="Fechar alerta"
            onClick={() => dismiss(alert.id_atendimento)}
          >
            <X size={18} />
          </button>
          <div className="attendance-alert-icon">
            <AlertTriangle size={21} />
          </div>
          <div className="attendance-alert-content">
            <strong>Atendimento em aberto sem resposta</strong>
            <p>{alert.contato.nome || alert.contato.telefone}</p>
            <button className="attendance-alert-action" type="button" onClick={onOpenConversations}>
              Ver conversas <ArrowRight size={15} />
            </button>
          </div>
        </aside>
      ))}
      {remainingCount > 0 && (
        <aside className="attendance-alert attendance-alert-overflow" role="status">
          <div className="attendance-alert-icon">
            <AlertTriangle size={21} />
          </div>
          <div className="attendance-alert-content">
            <strong>Mais atendimentos aguardando resposta</strong>
            <p>{remainingCount} alerta(s) além do limite de {MAX_VISIBLE_ALERTS} exibidos.</p>
            <button className="attendance-alert-action" type="button" onClick={onOpenConversations}>
              Ver conversas <ArrowRight size={15} />
            </button>
          </div>
        </aside>
      )}
      {error && <span className="attendance-alert-error">{error}</span>}
    </div>
  );
}
