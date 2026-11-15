const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');
export const ACCESS_TOKEN_KEY = 'inablink.accessToken';

export interface User {
  id_usuario: number;
  nome: string;
  email: string;
  perfil: 'admin' | 'atendente';
  ativo: boolean;
}

export interface Conversation {
  id_conversa: number;
  telefone: string;
  nome: string | null;
  email?: string | null;
  criada_em: string;
  ultima_mensagem_em: string | null;
  atendimento_aberto?: { status: string | null } | null;
}

export interface Message {
  id_mensagem: number;
  data_hora: string;
  conteudo: string | null;
  origem: string;
  status: string;
  tipo: string;
  FK_CONVERSA_id_conversa: number;
  nome_usuario: string | null;
}

export interface ConversationSearchMessage extends Message {
  conversa: Pick<Conversation, 'id_conversa' | 'nome' | 'telefone'>;
}

export interface ConversationSearchResult {
  conversas: Conversation[];
  mensagens: ConversationSearchMessage[];
}

export interface Annotation {
  id_anotacao: number;
  texto: string;
  criada_em: string;
  autor_nome: string;
}

export interface Contact {
  id_contato: number;
  cadastrado_em: string;
  nome: string | null;
  telefone: string;
  email: string | null;
}

export interface Label {
  id_etiqueta: number;
  nome: string;
  cor: string | null;
}

export interface BusinessSettings {
  nome_perfil: string;
  email_contato: string;
  fuso_horario: string;
  numero_conta: string | null;
}

interface UserPage {
  data: User[];
  page: number;
  limit: number;
}

interface Page<T> {
  data: T[];
  page: number;
  limit: number;
}

interface ApiErrorBody {
  error?: string;
  message?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function handleUnauthorized(): void {
  sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  if (window.location.pathname !== '/login') {
    window.history.replaceState(null, '', '/login');
  }
  window.dispatchEvent(new Event('inablink:unauthorized'));
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');

  const token = sessionStorage.getItem(ACCESS_TOKEN_KEY);
  if (token && path.startsWith('/api/')) headers.set('Authorization', `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  } catch {
    throw new ApiError('Não foi possível conectar à API. Verifique sua conexão e tente novamente.', 0);
  }

  if (response.status === 204) return undefined as T;

  const responseText = await response.text();
  let body: unknown;
  let invalidJson = false;
  if (responseText) {
    try {
      body = JSON.parse(responseText);
    } catch {
      invalidJson = true;
    }
  }

  if (response.ok && responseText && invalidJson) {
    throw new ApiError('A API retornou uma resposta inválida.', response.status);
  }

  if (!response.ok) {
    if (response.status === 401) handleUnauthorized();
    const payload = body as ApiErrorBody | undefined;
    const messages: Record<number, string> = {
      400: payload?.error ?? payload?.message ?? 'Verifique os dados informados.',
      401: 'Sua sessão expirou. Entre novamente.',
      403: 'Seu perfil não tem permissão para realizar esta ação (admin ou atendente).',
      404: 'O recurso ou a conversa não foi encontrado.',
      409: 'Conflito no atendimento. Atualize a conversa e tente novamente.',
      502: 'A integração com o WhatsApp/Meta está indisponível no momento.',
      503: 'A integração com o WhatsApp/Meta está indisponível no momento.',
    };
    throw new ApiError(messages[response.status] ?? payload?.error ?? `Erro na requisição (${response.status}).`, response.status);
  }

  return body as T;
}

function queryPage(page = 1, limit = 20): string {
  return `page=${page}&limit=${limit}`;
}

export async function login(email: string, senha: string): Promise<{ accessToken: string; user: User }> {
  const result = await request<{ data: { accessToken: string; user: User } }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, senha }),
  });
  sessionStorage.setItem(ACCESS_TOKEN_KEY, result.data.accessToken);
  return result.data;
}

export async function logout(): Promise<void> {
  try {
    await request<void>('/api/auth/logout', { method: 'POST' });
  } finally {
    sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  }
}

export async function checkMe(): Promise<User> {
  const result = await request<{ data: User }>('/api/auth/me');
  return result.data;
}

export function getConversations(page = 1, limit = 20): Promise<Page<Conversation>> {
  return request<Page<Conversation>>(`/api/conversas?${queryPage(page, limit)}`);
}

export function searchConversations(query: string, limit = 50): Promise<{ data: ConversationSearchResult }> {
  const params = new URLSearchParams({ q: query.trim(), limit: String(limit) });
  return request<{ data: ConversationSearchResult }>(`/api/busca/conversas?${params.toString()}`);
}

export function createConversation(telefone: string): Promise<{ data: Conversation }> {
  return request<{ data: Conversation }>('/api/conversas', { method: 'POST', body: JSON.stringify({ telefone }) });
}

export function getConversationMessages(id: number, page = 1, limit = 20): Promise<Page<Message>> {
  return request<Page<Message>>(`/api/conversas/${id}/mensagens?${queryPage(page, limit)}`);
}

export function getMessage(id: number): Promise<{ data: Message }> {
  return request<{ data: Message }>(`/api/mensagens/${id}`);
}

export function sendMessage(id: number, conteudo: string): Promise<{ data: Message }> {
  return request<{ data: Message }>(`/api/conversas/${id}/mensagens`, {
    method: 'POST',
    body: JSON.stringify({ tipo: 'text', conteudo }),
  });
}

export function getConversationAnnotations(id: number, page = 1, limit = 20): Promise<Page<Annotation>> {
  return request<Page<Annotation>>(`/api/conversas/${id}/anotacoes?${queryPage(page, limit)}`);
}

export function createAnnotation(id: number, texto: string): Promise<{ data: Annotation }> {
  return request<{ data: Annotation }>(`/api/conversas/${id}/anotacoes`, {
    method: 'POST',
    body: JSON.stringify({ texto }),
  });
}

export function getContacts(page = 1, limit = 20): Promise<Page<Contact>> {
  return request<Page<Contact>>(`/api/contatos?${queryPage(page, limit)}`);
}

export function createContact(input: { telefone: string; nome: string; email: string | null }): Promise<{ data: Contact }> {
  return request<{ data: Contact }>('/api/contatos', {
    method: 'POST',
    body: JSON.stringify({ ...input, email: input.email || null }),
  });
}

export function getLabels(): Promise<Page<Label>> {
  return request<Page<Label>>(`/api/etiquetas?${queryPage()}`);
}

export function getConversationLabels(id: number): Promise<{ data: Label[] }> {
  return request<{ data: Label[] }>(`/api/conversas/${id}/etiquetas`);
}

export function addConversationLabel(id: number, etiquetaId: number): Promise<void> {
  return request<void>(`/api/conversas/${id}/etiquetas/${etiquetaId}`, { method: 'PUT' });
}

export function getBusinessSettings(): Promise<{ data: BusinessSettings }> {
  return request<{ data: BusinessSettings }>('/api/configuracoes/perfil');
}

export function updateBusinessSettings(input: Pick<BusinessSettings, 'nome_perfil' | 'email_contato' | 'fuso_horario'>): Promise<{ data: BusinessSettings }> {
  return request<{ data: BusinessSettings }>('/api/configuracoes/perfil', {
    method: 'PATCH',
    body: JSON.stringify({
      nome_perfil: input.nome_perfil,
      email_contato: input.email_contato,
      fuso_horario: input.fuso_horario,
    }),
  });
}

export function getUsers(page = 1, limit = 100): Promise<UserPage> {
  return request<UserPage>(`/api/usuarios?${queryPage(page, limit)}`);
}

export function createUser(input: { nome: string; email: string; senha: string; perfil: User['perfil'] }): Promise<{ data: User }> {
  return request<{ data: User }>('/api/usuarios', { method: 'POST', body: JSON.stringify(input) });
}

export function updateUser(id: number, input: Partial<Pick<User, 'nome' | 'email' | 'perfil' | 'ativo'>>): Promise<void> {
  return request<void>(`/api/usuarios/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deactivateUser(id: number): Promise<void> {
  return request<void>(`/api/usuarios/${id}`, { method: 'DELETE' });
}

export function resetUserPassword(id: number, nova_senha: string): Promise<void> {
  return request<void>(`/api/usuarios/${id}/password`, { method: 'PATCH', body: JSON.stringify({ nova_senha }) });
}

export function changePassword(senha_atual: string, nova_senha: string): Promise<void> {
  return request<void>('/api/auth/password', {
    method: 'PATCH',
    body: JSON.stringify({ senha_atual, nova_senha }),
  });
}

export function createLabel(input: { nome: string; cor?: string }): Promise<{ data: Label }> {
  return request<{ data: Label }>('/api/etiquetas', { method: 'POST', body: JSON.stringify(input) });
}

export function updateLabel(id: number, input: { nome?: string; cor?: string | null }): Promise<void> {
  return request<void>(`/api/etiquetas/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deleteLabel(id: number): Promise<void> {
  return request<void>(`/api/etiquetas/${id}`, { method: 'DELETE' });
}
