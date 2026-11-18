const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

export const ROUTES = {
  Dashboard: '/dashboard',
  Conversas: '/conversas',
  Contatos: '/contatos',
  'Relatórios': '/relatorios',
  'Configurações': '/configuracoes',
  Login: '/login',
};

export function pageFromPath(pathname) {
  const path = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname;
  const clean = path.replace(/\/+$/, '') || '/';
  return Object.keys(ROUTES).find((name) => ROUTES[name] === clean) ?? null;
}

export function pathFromPage(page) {
  return BASE + ROUTES[page];
}