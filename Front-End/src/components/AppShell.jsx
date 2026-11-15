import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  MessageCircle,
  Users,
  BarChart3,
  Settings,
  Search,
  Bell,
  MoreHorizontal,
  LogOut,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import Logo from "./Logo.jsx";

const SIDEBAR_STORAGE_KEY = "in-a-blink-sidebar-pinned";
const MOBILE_BREAKPOINT = "(max-width: 767px)";

const navItems = [
  ["Dashboard", LayoutDashboard],
  ["Conversas", MessageCircle],
  ["Contatos", Users],
  ["Relatórios", BarChart3],
  ["Configurações", Settings],
];

// Estrutura fixa compartilhada pelas páginas: sidebar + topbar + conteúdo.
export default function AppShell({ page, setPage, user, onLogout, children }) {
  const [isPinned, setIsPinned] = useState(() => {
    try {
      return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true";
    } catch (error) {
      console.error("Não foi possível ler a preferência da sidebar.", error);
      return false;
    }
  });
  const [isHovered, setIsHovered] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const isExpanded = isPinned || isHovered;

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(isPinned));
    } catch (error) {
      console.error("Não foi possível salvar a preferência da sidebar.", error);
    }
  }, [isPinned]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") setIsMobileOpen(false);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function handleMouseEnter() {
    if (!window.matchMedia(MOBILE_BREAKPOINT).matches && !isPinned) {
      setIsHovered(true);
    }
  }

  function handleMouseLeave() {
    setIsHovered(false);
  }

  function handleNavigation(label) {
    setPage(label);
    setIsMobileOpen(false);
  }

  return (
    <div className={`app-shell ${isExpanded ? "sidebar-expanded" : "sidebar-collapsed"}`}>
      <aside
        className={`sidebar ${isMobileOpen ? "drawer-open" : ""}`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div className="sidebar-header">
          <Logo />
          <button
            className="sidebar-toggle"
            type="button"
            aria-label={isPinned ? "Desafixar sidebar" : "Fixar sidebar expandida"}
            aria-pressed={isPinned}
            title={isPinned ? "Desafixar sidebar" : "Fixar sidebar expandida"}
            onClick={() => setIsPinned((pinned) => !pinned)}
          >
            {isPinned ? <PanelLeftClose size={19} /> : <PanelLeftOpen size={19} />}
          </button>
        </div>
        <nav>
          {navItems.map(([label, Icon]) => (
            <button
              key={label}
              className={`nav-item ${page === label ? "active" : ""}`}
              type="button"
              data-tooltip={label}
              aria-label={label}
              title={label}
              onClick={() => handleNavigation(label)}
            >
              <Icon size={19} />
              <span>{label}</span>
              {label === "Conversas" && <b className="nav-badge">3</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="mini-profile">
            <div className="avatar">{user?.nome?.slice(0, 2).toUpperCase()}</div>
            <div className="profile-label">
              <strong>{user?.nome ?? "Usuário"}</strong>
              <small>{user?.perfil === "admin" ? "Administradora" : "Atendente"}</small>
            </div>
            <MoreHorizontal size={18} />
          </div>
          <button
            className="logout"
            type="button"
            data-tooltip="Sair"
            aria-label="Sair"
            title="Sair"
            onClick={onLogout}
          >
            <LogOut size={18} /> <span>Sair</span>
          </button>
        </div>
      </aside>
      {isMobileOpen && (
        <button
          className="drawer-backdrop"
          type="button"
          aria-label="Fechar menu"
          onClick={() => setIsMobileOpen(false)}
        />
      )}
      <main className="main-area">
        <header className="topbar">
          <div>
            <button
              className="mobile-menu-toggle"
              type="button"
              aria-label={isMobileOpen ? "Fechar menu" : "Abrir menu"}
              aria-expanded={isMobileOpen}
              onClick={() => setIsMobileOpen((open) => !open)}
            >
              {isMobileOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <div className="topbar-heading">
              <h1>{page}</h1>
              <p>Gerencie sua operação de atendimento.</p>
            </div>
          </div>
          <div className="top-actions">
            <button className="icon-btn notification">
              <Bell size={19} />
              <i />
            </button>
          </div>
        </header>
        <section className="page-content">{children}</section>
      </main>
    </div>
  );
}
