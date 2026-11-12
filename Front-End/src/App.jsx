import { useCallback, useEffect, useRef, useState } from 'react';
import AppShell from './components/AppShell.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Conversas from './pages/Conversas.jsx';
import Contatos from './pages/Contatos.jsx';
import Relatorios from './pages/Relatorios.jsx';
import Configuracoes from './pages/Configuracoes.jsx';
import { checkMe, getNotificationSummary, logout } from './api.ts';
import { playNotificationSound } from './notification-sound.js';

const SETTINGS_STORAGE_KEY = 'inablink.settings';

function createDefaultPreferences() {
  return {
    profile: { displayName: '', status: '', avatar: '' },
    company: {
      name: 'in a blink Demo',
      email: 'contato@inablink.com',
      phone: '+55 (19) 99999-0000',
      timezone: 'America/Sao_Paulo',
    },
    notifications: { platform: true, messageSounds: true, desktop: true, preview: true },
    privacy: {
      readReceipts: true,
      lastSeen: 'everyone',
      online: 'everyone',
      profilePhoto: 'everyone',
    },
    appearance: { theme: 'system', enterToSend: true },
  };
}

function loadPreferences() {
  try {
    const saved = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!saved) return createDefaultPreferences();

    const parsed = JSON.parse(saved);
    const defaults = createDefaultPreferences();
    return Object.fromEntries(
      Object.entries(defaults).map(([group, values]) => [
        group,
        { ...values, ...(parsed?.[group] && typeof parsed[group] === 'object' ? parsed[group] : {}) },
      ]),
    );
  } catch (error) {
    console.error('Não foi possível carregar as configurações salvas.', error);
    return createDefaultPreferences();
  }
}

export default function App() {
  const [page, setPage] = useState(null);
  const [user, setUser] = useState(null);
  const [authError, setAuthError] = useState('');
  const [conversationSearch, setConversationSearch] = useState('');
  const [preferences, setPreferences] = useState(loadPreferences);
  const [notificationSummary, setNotificationSummary] = useState({
    unread_count: 0,
    latest_incoming_message_id: 0,
  });
  const [notificationError, setNotificationError] = useState('');
  const notificationUserId = useRef(null);
  const lastIncomingMessageId = useRef(null);
  const notificationBaselineInitialized = useRef(false);

  const refreshNotificationSummary = useCallback(async () => {
    const summary = await getNotificationSummary();
    setNotificationSummary(summary);
    setNotificationError('');
    return summary;
  }, []);

  useEffect(() => {
    if (!user?.id_usuario) {
      notificationUserId.current = null;
      lastIncomingMessageId.current = null;
      notificationBaselineInitialized.current = false;
      setNotificationSummary({ unread_count: 0, latest_incoming_message_id: 0 });
      setNotificationError('');
      return undefined;
    }

    if (notificationUserId.current !== user.id_usuario) {
      notificationUserId.current = user.id_usuario;
      lastIncomingMessageId.current = null;
      notificationBaselineInitialized.current = false;
    }

    let active = true;
    let inFlight = false;

    async function pollNotifications() {
      if (!active || inFlight) return;
      inFlight = true;
      try {
        const summary = await refreshNotificationSummary();
        if (!active) return;

        const latestId = summary.latest_incoming_message_id;
        if (notificationBaselineInitialized.current
          && lastIncomingMessageId.current !== null
          && latestId > lastIncomingMessageId.current
          && preferences.notifications.messageSounds) {
          void playNotificationSound();
        }
        lastIncomingMessageId.current = latestId;
        notificationBaselineInitialized.current = true;
      } catch (error) {
        if (active) {
          setNotificationError(error instanceof Error ? error.message : 'Não foi possível atualizar as notificações.');
          console.error('Não foi possível atualizar as notificações.', error);
        }
      } finally {
        inFlight = false;
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') void pollNotifications();
    }

    void pollNotifications();
    const intervalId = window.setInterval(pollNotifications, 5000);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      active = false;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [user?.id_usuario, preferences.notifications.messageSounds, refreshNotificationSummary]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const theme = preferences.appearance.theme === 'system'
        ? (mediaQuery.matches ? 'dark' : 'light')
        : preferences.appearance.theme;
      document.documentElement.dataset.theme = theme;
    };

    applyTheme();
    mediaQuery.addEventListener('change', applyTheme);
    return () => mediaQuery.removeEventListener('change', applyTheme);
  }, [preferences.appearance.theme]);

  useEffect(() => {
    const handleUnauthorized = () => {
      setUser(null);
      setAuthError('');
      setPage('Login');
      setNotificationSummary({ unread_count: 0, latest_incoming_message_id: 0 });
    };
    window.addEventListener('inablink:unauthorized', handleUnauthorized);
    if (sessionStorage.getItem('inablink.accessToken')) {
      checkMe()
        .then((currentUser) => {
          setUser(currentUser);
          setPage('Dashboard');
        })
        .catch(() => setPage('Login'));
    } else {
      setPage('Login');
    }
    return () => window.removeEventListener('inablink:unauthorized', handleUnauthorized);
  }, []);

  const handleLogin = (authenticatedUser) => {
    setAuthError('');
    setUser(authenticatedUser);
    setPage('Dashboard');
  };

  function savePreferences(nextPreferences) {
    try {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(nextPreferences));
    } catch (error) {
      console.error('Não foi possível salvar as configurações.', error);
      throw new Error('Não foi possível salvar neste navegador. Verifique o espaço disponível e tente novamente.');
    }
    setPreferences(nextPreferences);
  }

  function updateProfilePreview(profile) {
    setPreferences((current) => ({ ...current, profile }));
  }

  function resetPreferences() {
    const defaults = createDefaultPreferences();
    savePreferences(defaults);
    return defaults;
  }

  if (!page) return null;
  if (page === 'Login') return <Login onLogin={handleLogin} initialError={authError} />;

  async function handleLogout() {
    try {
      await logout();
    } catch (error) {
      setAuthError(error.message);
    } finally {
      setUser(null);
      setPage('Login');
    }
  }

  const screens = {
    Dashboard: <Dashboard onOpenConversations={() => setPage('Conversas')} />,
    Conversas: (
      <Conversas
        searchTerm={conversationSearch}
        onSearchTermChange={setConversationSearch}
        enterToSend={preferences.appearance.enterToSend}
        onConversationRead={refreshNotificationSummary}
      />
    ),
    Contatos: <Contatos />,
    Relatórios: <Relatorios />,
    Configurações: (
      <Configuracoes
        user={user}
        preferences={preferences}
        onSave={savePreferences}
        onReset={resetPreferences}
        onProfileChange={updateProfilePreview}
      />
    ),
  };

  return (
    <AppShell
      page={page}
      setPage={setPage}
      user={user}
      profileName={preferences.profile.displayName}
      profileStatus={preferences.profile.status}
      profileAvatar={preferences.profile.avatar}
      notificationCount={notificationSummary.unread_count}
      notificationError={notificationError}
      onOpenNotifications={() => setPage('Conversas')}
      onLogout={handleLogout}
      searchTerm={conversationSearch}
      onSearchTermChange={setConversationSearch}
    >
      {screens[page]}
    </AppShell>
  );
}
