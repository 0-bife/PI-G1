import { useState } from 'react';
import AppShell from './components/AppShell.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Conversas from './pages/Conversas.jsx';
import Contatos from './pages/Contatos.jsx';
import Relatorios from './pages/Relatorios.jsx';
import Configuracoes from './pages/Configuracoes.jsx';

// App controla qual tela está aberta no protótipo navegável.
export default function App() {
  const [page, setPage] = useState('Login');
  if (page === 'Login') return <Login onEnter={() => setPage('Dashboard')} />;

  const screens = {
    Dashboard: <Dashboard />,
    Conversas: <Conversas />,
    Contatos: <Contatos />,
    Relatórios: <Relatorios />,
    Configurações: <Configuracoes />,
  };

  return <AppShell page={page} setPage={setPage}>{screens[page]}</AppShell>;
}
