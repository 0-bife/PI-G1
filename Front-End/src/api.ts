const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');
export const ACCESS_TOKEN_KEY = 'inablink.accessToken';

export interface User {
  id_usuario: number;
  nome: string;
  email: string;
  perfil: 'admin' | 'atendente';
  ativo: boolean;
}

export interface Assignment {
  id_atribuicao: number;
  iniciada_em: string;
  encerrada_em: string | null;
  FK_USUARIO_id_usuario: number;
  nome: string;
  email: string;
  perfil: 'admin' | 'atendente';
  FK_ATENDIMENTO_id_atendimento: number;
}

export interface Attendance {
  id_atendimento: number;
  status: string;
  iniciado_em: string;
  encerrado_em: string | null;
  prazo_retorno: string | null;
  FK_CONVERSA_id_conversa: number;
  responsaveis_ativos?: Assignment[];
}

export interface Conversation {
  id_conversa: number;
  telefone: string;
  nome: string | null;
  email?: string | null;
  criada_em: string;
  ultima_mensagem_em: string | null;
  atendimento_aberto?: {
    id_atendimento?: number;
    status: string | null;
    iniciado_em?: string | null;
    prazo_retorno?: string | null;
  } | null;
  responsaveis_ativos?: Assignment[];
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

export interface AttendanceSettings {
  horario_ativo: boolean;
  horario_inicio: string;
  horario_fim: string;
  mensagem_boas_vindas: string;
  mensagem_indisponivel: string;
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
      409: payload?.error ?? 'Conflito no atendimento. Atualize a conversa e tente novamente.',
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

export function getConversation(id: number): Promise<{ data: Conversation }> {
  return request<{ data: Conversation }>(`/api/conversas/${id}`);
}

export function openAttendance(conversationId: number): Promise<{ data: { id_atendimento: number; status: string } }> {
  return request<{ data: { id_atendimento: number; status: string } }>(
    `/api/conversas/${conversationId}/atendimentos`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}

export function getConversationAttendances(conversationId: number, page = 1, limit = 5): Promise<Page<Attendance>> {
  return request<Page<Attendance>>(`/api/conversas/${conversationId}/atendimentos?${queryPage(page, limit)}`);
}

export function updateAttendanceStatus(attendanceId: number, status: 'open' | 'closed'): Promise<void> {
  return request<void>(`/api/atendimentos/${attendanceId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function addAssignment(attendanceId: number, usuarioId: number): Promise<{ data: Assignment } | undefined> {
  return request<{ data: Assignment } | undefined>(
    `/api/atendimentos/${attendanceId}/atribuicoes`,
    { method: 'POST', body: JSON.stringify({ usuarioId }) },
  );
}

export function closeAssignment(assignmentId: number): Promise<void> {
  return request<void>(`/api/atribuicoes/${assignmentId}`, { method: 'DELETE' });
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

export function getAttendanceSettings(): Promise<{ data: AttendanceSettings }> {
  return request<{ data: AttendanceSettings }>('/api/configuracoes/atendimento');
}

export function updateAttendanceSettings(
  input: Partial<AttendanceSettings>,
): Promise<{ data: AttendanceSettings }> {
  return request<{ data: AttendanceSettings }>('/api/configuracoes/atendimento', {
    method: 'PATCH',
    body: JSON.stringify(input),
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

export interface PendingAlert {
  id_atendimento: number;
  id_conversa: number;
  contato: { id: number; nome: string | null; telefone: string };
  ultimaMensagemEm: string | null;
  minutosSemResposta: number;
}

export function getPendingAlerts(minutos = 1): Promise<{ data: PendingAlert[] }> {
  return request<{ data: PendingAlert[] }>(`/api/alertas/atendimentos?minutos=${minutos}`);
}

export interface DashboardFilters {
  usuarioId?: number;
  dataInicial?: string;
  dataFinal?: string;
  etiquetaId?: number;
}

export interface DashboardMetrics {
  totais: {
    total: number;
    conversasTotais: number;
    conversasAtivas: number;
    atendimentosRealizados: number;
    pendentes: number;
    tempoMedioAtendimentoSegundos: number;
    tempoMedioRespostaSegundos: number;
  };
  ranking: Array<{
    id: number;
    nome: string;
    atendimentosRealizados: number;
  }>;
}

export function getDashboardMetrics(filters: DashboardFilters = {}): Promise<{ data: DashboardMetrics }> {
  const params = new URLSearchParams();
  if (filters.usuarioId) params.set('usuarioId', String(filters.usuarioId));
  if (filters.dataInicial) params.set('dataInicial', filters.dataInicial);
  if (filters.dataFinal) params.set('dataFinal', filters.dataFinal);
  if (filters.etiquetaId) params.set('etiquetaId', String(filters.etiquetaId));
  const qs = params.toString();
  return request<{ data: DashboardMetrics }>(`/api/dashboard/atendimentos${qs ? `?${qs}` : ''}`);
}