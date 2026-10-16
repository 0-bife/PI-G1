import {
  LayoutDashboard,
  MessageCircle,
  Users,
  BarChart3,
  Bot,
  Settings,
  Search,
  Bell,
  MoreHorizontal,
  LogOut,
} from "lucide-react";
import Logo from "./Logo.jsx";

const navItems = [
  ["Dashboard", LayoutDashboard],
  ["Conversas", MessageCircle],
  ["Contatos", Users],
  ["Relatórios", BarChart3],
  ["Automações", Bot],
  ["Configurações", Settings],
];

// Estrutura fixa compartilhada pelas páginas: sidebar + topbar + conteúdo.
export default function AppShell({ page, setPage, user, onLogout, children }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Logo />
        <nav>
          {navItems.map(([label, Icon]) => (
            <button
              key={label}
              className={`nav-item ${page === label ? "active" : ""}`}
              onClick={() => setPage(label)}
            >
              <Icon size={19} />
              <span>{label}</span>
              {label === "Conversas" && <b className="nav-badge">3</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="mini-profile">
            <div className="avatar">IB</div>
            <div>
              <strong>{user?.nome ?? 'Usuário'}</strong>
              <small>{user?.perfil === 'admin' ? 'Administradora' : 'Atendente'}</small>
            </div>
            <MoreHorizontal size={18} />
          </div>
          <button className="logout" onClick={onLogout}>
            <LogOut size={18} /> Sair
          </button>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div>
            <h1>{page}</h1>
            <p>Gerencie sua operação de atendimento.</p>
          </div>
          <div className="top-actions">
            <button className="icon-btn">
              <Search size={19} />
            </button>
            <button className="icon-btn notification">
              <Bell size={19} />
              <i />
            </button>
            <div className="avatar">{user?.nome?.charAt(0) ?? 'IB'}</div>
          </div>
        </header>
        <section className="page-content">{children}</section>
      </main>
    </div>
  );
}
