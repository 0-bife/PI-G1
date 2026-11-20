import { useCallback, useEffect, useRef, useState } from 'react';
import AppShell from './components/AppShell.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Conversas from './pages/Conversas.jsx';
import Contatos from './pages/Contatos.jsx';
import Relatorios from './pages/Relatorios.jsx';
import Configuracoes from './pages/Configuracoes.jsx';
import { checkMe, logout } from './api.ts';
import { pageFromPath, pathFromPage } from './routes.js';

const TOKEN_KEY = 'inablink.accessToken';

// Mantém a barra de endereços igual à tela atual.
function syncUrl(page, replace = false) {
  const path = pathFromPage(page);
  if (window.location.pathname === path) return;
  window.history[replace ? 'replaceState' : 'pushState'](null, '', path);
}

// Login não é destino válido para quem já está autenticado.
// Dashboard é exclusivo para administradores; atendentes caem em Conversas.
function authenticatedTarget(requested, currentUser) {
  const isAdmin = currentUser?.perfil === 'admin';
  const fallback = isAdmin ? 'Dashboard' : 'Conversas';
  if (!requested || requested === 'Login') return fallback;
  if (requested === 'Dashboard' && !isAdmin) return 'Conversas';
  return requested;
}

export default function App() {
  const [page, setPage] = useState(null);
  const [user, setUser] = useState(null);
  const [authError, setAuthError] = useState('');
  const [focusConversationId, setFocusConversationId] = useState(null);
  const userRef = useRef(null);
  userRef.current = user;

  const navigate = useCallback((next, replace = false) => {
    const target = next === 'Dashboard' && userRef.current && userRef.current.perfil !== 'admin'
      ? 'Conversas'
      : next;
    setPage(target);
    syncUrl(target, replace);
  }, []);

  const openConversation = useCallback((id) => {
    setFocusConversationId(id);
    navigate('Conversas');
  }, [navigate]);

  useEffect(() => {
    const handleUnauthorized = () => {
      setUser(null);
      setAuthError('');
      navigate('Login', true);
    };

    // Botões Voltar e Avançar do navegador.
    const handlePopState = () => {
      if (!sessionStorage.getItem(TOKEN_KEY)) {
        navigate('Login', true);
        return;
      }
      navigate(authenticatedTarget(pageFromPath(window.location.pathname), userRef.current), true);
    };

    window.addEventListener('inablink:unauthorized', handleUnauthorized);
    window.addEventListener('popstate', handlePopState);

    // Ao abrir ou atualizar, respeita a página que está na URL.
    const requested = pageFromPath(window.location.pathname);
    if (sessionStorage.getItem(TOKEN_KEY)) {
      checkMe()
        .then((currentUser) => {
          userRef.current = currentUser;
          setUser(currentUser);
          navigate(authenticatedTarget(requested, currentUser), true);
        })
        .catch(() => navigate('Login', true));
    } else {
      navigate('Login', true);
    }

    return () => {
      window.removeEventListener('inablink:unauthorized', handleUnauthorized);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [navigate]);

  const handleLogin = (authenticatedUser) => {
    setAuthError('');
    userRef.current = authenticatedUser;
    setUser(authenticatedUser);
    navigate(authenticatedUser.perfil === 'admin' ? 'Dashboard' : 'Conversas');
  };

  async function handleLogout() {
    try {
      await logout();
    } catch {
      // O token local já foi removido; a sessão expira sozinha no servidor.
    } finally {
      setAuthError('');
      setUser(null);
      navigate('Login', true);
    }
  }

  if (!page) return null;
  if (page === 'Login') return <Login onLogin={handleLogin} initialError={authError} />;

  const screens = {
    Dashboard: <Dashboard user={user} onOpenConversations={() => navigate('Conversas')} />,
    Conversas: <Conversas user={user} focusId={focusConversationId} onFocusHandled={() => setFocusConversationId(null)} />,
    Contatos: <Contatos />,
    Relatórios: <Relatorios />,
    Configurações: <Configuracoes user={user} />,
  };

  return (
    <AppShell 
      page={page} 
      setPage={navigate} 
      user={user} 
      onLogout={handleLogout}
      onOpenConversation={openConversation}>
      {screens[page]}
    </AppShell>
  );
}