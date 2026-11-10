import { useEffect, useState } from 'react';
import AppShell from './components/AppShell.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Conversas from './pages/Conversas.jsx';
import Contatos from './pages/Contatos.jsx';
import Relatorios from './pages/Relatorios.jsx';
import Configuracoes from './pages/Configuracoes.jsx';
import { checkMe, logout } from './api.ts';

export default function App() {
  const [page, setPage] = useState(null);
  const [user, setUser] = useState(null);
  const [authError, setAuthError] = useState('');
  const [conversationSearch, setConversationSearch] = useState('');

  useEffect(() => {
    const handleUnauthorized = () => {
      setUser(null);
      setAuthError('');
      setPage('Login');
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
      />
    ),
    Contatos: <Contatos />,
    Relatórios: <Relatorios />,
    Configurações: <Configuracoes />,
  };

  return (
    <AppShell
      page={page}
      setPage={setPage}
      user={user}
      onLogout={handleLogout}
      searchTerm={conversationSearch}
      onSearchTermChange={setConversationSearch}
    >
      {screens[page]}
    </AppShell>
  );
}
