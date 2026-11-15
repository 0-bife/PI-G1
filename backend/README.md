# InAblink API

Implementação do backend Node.js 22+, TypeScript, Express e MySQL. O fluxo WhatsApp, autenticação, contatos, etiquetas, conversas, atendimentos, responsáveis, mensagens e anotações estão implementados. O SQL de instalação é `../BD/modelo_fisico_corrigido.sql`.

## Executar localmente

Crie o schema MySQL, aplique o SQL físico atualizado e execute na pasta `backend`:

```powershell
npm ci
Copy-Item .env.example .env
npm run typecheck
npm run build
npm run dev
```

Configure `.env` com credenciais locais, incluindo `JWT_SECRET` com pelo menos 32 bytes aleatórios. `npm start` inicia sem watch. O servidor não executa migrações automaticamente. Disponibilize somente atrás de HTTPS.

O backend e seus testes são escritos em TypeScript. `npm run dev` executa os fontes com watch; `npm run build` compila os módulos ESM para `dist/`; `npm start` inicia essa compilação. A pasta `dist/` é gerada e não deve ser versionada.

## Autenticação JWT atual

`POST /api/auth/login` emite JWT Bearer assinado com HS256 e validade de 12 horas para usuário ativo. Todas as rotas `/api/*`, exceto login e webhook Meta, exigem `Authorization: Bearer <accessToken>`. Cada requisição valida assinatura/expiração e consulta `AUTH_SESSAO` junto ao estado e perfil atuais do usuário.

`POST /api/auth/logout` revoga a sessão imediatamente; `PATCH /api/auth/password` exige senha atual, troca o hash scrypt e revoga todas as sessões da conta. Desativar um usuário bloqueia todos os seus tokens. Senhas devem ter de 12 a 128 caracteres, são armazenadas com salt aleatório e nunca aparecem em resposta/log.

No navegador, guardar o JWT em `sessionStorage`, não em `localStorage`; enviar o bearer token em cada chamada e limpar o armazenamento após logout ou `401`. Fechar a aba remove o token daquela sessão do navegador, mas não garante aviso ao servidor: a sessão remota permanece até o logout explícito, troca de senha, desativação da conta ou expiração de 12 horas.

Configure `JWT_SECRET` com pelo menos 32 bytes aleatórios e mantenha-o fora do repositório. Para provisionar o primeiro administrador em um banco vazio, compile com `npm run build`, defina temporariamente `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_EMAIL` e `BOOTSTRAP_ADMIN_PASSWORD` apenas no ambiente do processo e execute `npm run admin:create`. O comando recusa banco `USUARIO` não vazio e armazena somente hash; remova as variáveis após a execução.

### Integração com o frontend

Defina `VITE_API_BASE_URL` como a origem da API (`https://api.example.com`) no ambiente do Vite; não embuta tokens, senhas ou segredos no bundle. Se a interface estiver em outra origem, configure `CORS_ORIGINS` no backend com origens exatas separadas por vírgula, incluindo protocolo e porta quando necessário (por exemplo, `http://localhost:5173,https://front.example.com`). Não use `*`; o backend não usa cookies nem `Access-Control-Allow-Credentials`.

Centralize autenticação, respostas `204` e erros `401` num cliente HTTP. Exemplo TypeScript independente de framework (a origem deve ser injetada na inicialização da aplicação):

```ts
declare global {
  interface Window {
    INABLINK_CONFIG?: { API_BASE_URL: string };
  }
}

const API_BASE_URL = window.INABLINK_CONFIG?.API_BASE_URL.replace(/\/$/, '');
if (!API_BASE_URL) throw new Error('API_BASE_URL não configurada.');

const TOKEN_KEY = 'inablink.accessToken';

async function api<T>(
  path: string,
  options: RequestInit = {},
  authenticated = true,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (authenticated) {
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  if (response.status === 401) {
    sessionStorage.removeItem(TOKEN_KEY);
    window.location.assign('/login');
    throw new Error('Sessão expirada ou revogada.');
  }
  let payload: { data?: T; error?: string } = {};
  if (response.status !== 204) {
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }
  }
  if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
  return payload.data as T;
}
```

O login envia `{ email, senha }` a `POST /api/auth/login` sem Bearer e grava `data.accessToken` em `sessionStorage`; use `data.user` para nome/perfil da interface. Exemplo:

```ts
interface LoginResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: { id_usuario: number; nome: string; email: string; perfil: 'admin' | 'atendente' };
}

const session = await api<LoginResponse>(
  '/api/auth/login',
  { method: 'POST', body: JSON.stringify({ email, senha }) },
  false,
);
sessionStorage.setItem(TOKEN_KEY, session.accessToken);
```

Na inicialização/reload, consulte `GET /api/auth/me`. O token dura 12 horas e deve ser tratado como opaco; a validação final e o perfil vêm sempre do backend.

No logout, envie `POST /api/auth/logout` enquanto o token ainda está disponível e remova-o localmente mesmo se a chamada falhar:

```ts
async function logout(): Promise<void> {
  try {
    await api<void>('/api/auth/logout', { method: 'POST' });
  } finally {
    sessionStorage.removeItem(TOKEN_KEY);
    window.location.assign('/login');
  }
}
```

Se a rede falhar, o cliente limpou o token, mas a sessão do servidor não foi revogada e expirará em até 12 horas. Fechar a aba não garante chamada ao servidor; não tente usar `beforeunload` para revogação. A troca de senha envia `{ senha_atual, nova_senha }` a `PATCH /api/auth/password`; após `204`, a API revogou todas as sessões, então limpe a cópia local e volte ao login.

Fluxo sugerido de telas: `/login` valida credenciais e guarda o token; a área autenticada carrega `/api/conversas?page=1&limit=20`; a seleção de conversa carrega `/api/conversas/:id/mensagens?page=1&limit=20`, responsáveis e etiquetas; envio de texto usa `POST /api/conversas/:id/mensagens`; histórico de entrega usa `/api/mensagens/:id/status`. Exiba anotações de `/api/conversas/:id/anotacoes` em área interna distinta das mensagens WhatsApp. Uma tela de troca de senha autenticada deve exigir senha atual e nova senha. O frontend não deve permitir editar/apagar mensagens nem atribuir autoria via body.

### Busca de conversas e mensagens

`GET /api/busca/conversas?q=<termo>&limit=50` pesquisa contatos pelo nome/telefone e mensagens pelo conteúdo. A resposta separa os resultados para que a interface possa abrir uma conversa ou navegar diretamente até a mensagem encontrada:

```json
{
  "data": {
    "conversas": [{ "id_conversa": 12, "nome": "Maria", "telefone": "+15551234567" }],
    "mensagens": [{
      "id_mensagem": 88,
      "conteudo": "Pedido confirmado",
      "conversa": { "id_conversa": 12, "nome": "Maria", "telefone": "+15551234567" }
    }]
  }
}
```

O termo `q` é obrigatório e aceita até 255 caracteres. O `limit` aceita de 1 a 100 resultados em cada grupo.

Trate `400` como validação, `401` limpando token e retornando ao login, `403` como perfil sem permissão, `404` como recurso ausente, `409` como conflito de atendimento/associação, `413` como corpo acima do limite, `502` como rejeição Meta e `503` como configuração/dependência indisponível. Origens fora de `CORS_ORIGINS` não recebem permissão CORS no navegador. O backend expõe `Location` por CORS; evite registrar tokens, senhas e conteúdo privado em logs. A implementação das telas e do cliente HTTP está em `Front-End/`; consulte `Front-End/README.md` para configuração e exemplos.

## Relatórios, dashboard e alertas

As três rotas abaixo exigem `Authorization: Bearer <token>`. O middleware valida assinatura, validade e sessão JWT em cada requisição; a identidade e o perfil usados no escopo vêm do banco, nunca de parâmetros enviados pelo cliente. Parâmetros desconhecidos ou repetidos são rejeitados com `400`. Respostas e logs não incluem tokens, hashes de senha ou conteúdo de mensagens.

### `GET /api/relatorios/atendimentos`

Parâmetros obrigatórios `dataInicial` e `dataFinal`, no formato `YYYY-MM-DD`; as duas datas são inclusivas e o intervalo é aplicado à data de início do atendimento. `usuarioId` é opcional para administradores. Para atendentes, um `usuarioId` informado é validado, mas ignorado como escopo: a consulta sempre usa o ID autenticado.

```http
GET /api/relatorios/atendimentos?dataInicial=2026-10-01&dataFinal=2026-10-31&usuarioId=45
Authorization: Bearer <token>
```

Resposta `200` (`data` contém estatísticas por atendente):

```json
{
  "data": [
    {
      "id": 45,
      "nome": "Ana",
      "atendimentosRealizados": 18,
      "pendentes": 3,
      "tempoMedioRespostaSegundos": 245.5,
      "tempoMedioAtendimentoSegundos": 1840,
      "taxaConclusaoPercentual": 85.71,
      "slaPercentual": 92.31
    }
  ]
}
```

O tempo médio de resposta é calculado entre a primeira mensagem do contato e a primeira resposta do atendente no atendimento; o tempo médio de atendimento considera apenas atendimentos encerrados. A taxa de conclusão é a proporção encerrada sobre o total atribuído no intervalo. O SLA considera a primeira resposta até `prazo_retorno`; prazos ainda não vencidos e sem resposta não entram no denominador. Métricas sem amostras retornam `0`.

### `GET /api/dashboard/atendimentos`

Administradores podem filtrar por `usuarioId`; atendentes sempre veem somente os atendimentos atribuídos ao próprio ID, mesmo se tentarem informar outro. Sem filtro de data, os totais e o ranking consideram todo o histórico.

```http
GET /api/dashboard/atendimentos?usuarioId=45
Authorization: Bearer <token>
```

Resposta `200`:

```json
{
  "data": {
    "totais": {
      "total": 21,
      "atendimentosRealizados": 18,
      "pendentes": 3
    },
    "ranking": [
      { "id": 45, "nome": "Ana", "atendimentosRealizados": 18 }
    ]
  }
}
```

O ranking é ordenado por atendimentos realizados em ordem decrescente, com desempate pelo nome e ID. Totais são contagens distintas de atendimentos; no filtro individual contam atendimentos atribuídos ao usuário.

### `GET /api/alertas/atendimentos`

`minutos` é opcional, padrão `30`, e aceita inteiros de `1` a `10080`. A resposta lista atendimentos abertos cuja última mensagem seja do contato (ou que ainda não tenham mensagens) e esteja há pelo menos esse número de minutos sem resposta. Administradores veem todos; atendentes veem apenas atendimentos com atribuição ativa para si.

```http
GET /api/alertas/atendimentos?minutos=30
Authorization: Bearer <token>
```

Resposta `200`:

```json
{
  "data": [
    {
      "id_atendimento": 123,
      "id_conversa": 88,
      "contato": { "id": 9, "nome": "Cliente", "telefone": "+5511999999999" },
      "ultimaMensagemEm": "2026-11-04 13:15:00",
      "minutosSemResposta": 32
    }
  ]
}
```

`400` indica parâmetros ausentes, inválidos ou adicionais; `401`, token ausente/inválido/revogado; `403`, perfil sem permissão em rotas restritas. Erros internos retornam mensagem genérica e são registrados sem valores de entrada sensíveis.

## Regras do domínio

- **Identidade do contato:** o número de telefone normalizado em formato internacional E.164 é a chave de negócio do contato e deve ser único. `id_contato` pode continuar como identificador numérico interno para FKs, mas a busca/upsert de contatos usa o telefone. Nas respostas, expor ambos; não tratar o ID interno como identidade externa.
- **Contato/conversa automáticos:** ao receber mensagem de telefone ainda desconhecido, criar contato com esse número e, em seguida, sua conversa. Se o perfil da Meta trouxer nome, armazená-lo; se não trouxer, o contato pode ficar somente com o telefone. Ao enviar mensagem para número sem contato, fazer o mesmo antes de enviar. Reutilizar sempre o contato/conversa existentes para aquele telefone; nunca criar duplicatas.
- Cada contato tem no máximo uma conversa persistente; cada conversa pertence a exatamente um contato. Uma conversa contém várias mensagens, cada uma pertencente a exatamente uma conversa.
- Uma conversa pode ter vários ciclos de atendimento. Mensagem recebida inicia novo atendimento se não houver atendimento aberto; atendimento encerrado não é reaberto.
- **Responsáveis:** vários usuários podem estar ativos simultaneamente no mesmo atendimento. A atribuição ativa com `iniciada_em` mais recente tem prioridade; adicionar um responsável não encerra os outros. Remover acompanhamento preenche `encerrada_em`, preservando histórico. Esta regra segue `BD/detalhes_bd` e conflita com RN02 de `doc/requisitos.md` (um responsável por conversa); o requisito deve ser atualizado para refletir esta decisão.
- Etiquetas comuns associam contatos ou conversas a `ETIQUETA`. Acompanhar como funcionário é uma `ATRIBUICAO`, não uma etiqueta.
- Anotações pertencem à conversa, têm autor funcionário e nunca são enviadas ao WhatsApp.
- `MENSAGEM.status` representa o estado atual; cada mudança de status recebida da Meta também é gravada em `MENSAGEM_STATUS_HISTORICO`.
- Mensagens e anotações são histórico: não oferecer exclusão por atendentes. Contatos/conversas com histórico não podem ser excluídos por cascata.

## Convenções HTTP e erros

- Usar JSON UTF-8, exceto o GET de verificação Meta, que responde com o challenge em texto puro.
- Listas aceitam `page` (padrão 1) e `limit` (padrão 20, máximo 100) e retornam `{ "data": [], "page": 1, "limit": 20 }`. Item retorna `{ "data": { ... } }`.
- POST de recurso retorna `201`, corpo `{ "data": { ... } }` e `Location`; PATCH/PUT/DELETE bem-sucedido retorna `204`. Uma operação idempotente de criação que reutilize registro existente retorna `200`.
- Campos desconhecidos/formato inválido: `400`; não autenticado: `401`; sem permissão: `403`; não encontrado: `404`; unicidade/estado conflitante: `409`; corpo acima do limite: `413`; falha temporária da Meta: `502`; dependência indisponível: `503`; erro inesperado: `500` sem revelar SQL, tokens ou credenciais.
- Datas/hora em ISO 8601 com fuso na API; armazenar timestamps em UTC. Nunca confiar em `usuarioId` fornecido pelo cliente: autoria e perfil vêm do token.
- Todas as rotas `/api/*`, exceto login e webhook Meta, exigem `Authorization: Bearer <token>`. Perfil `admin` gerencia usuários e configurações; `atendente` opera contatos, conversas, mensagens, notas, etiquetas e atribuições conforme este contrato.

## Rotas

### Saúde e autenticação

| Método e rota | Acesso | Contrato |
| --- | --- | --- |
| `GET /health` | Público | Liveness; `200 { "status": "ok" }`; não consulta MySQL. |
| `GET /health/ready` | Público | `SELECT 1`; `200` se MySQL responde, `503` caso contrário. |
| `POST /api/auth/login` | Público | Body `{ "email": "...", "senha": "..." }`; valida hash e retorna `{ "data": { "accessToken", "tokenType": "Bearer", "expiresIn": 43200, "user": { ... } } }`; credenciais inválidas retornam `401`. |
| `GET /api/auth/me` | Autenticado | Retorna usuário da sessão sem `hash_senha` ou `jti`. |
| `POST /api/auth/logout` | Autenticado | Revoga imediatamente a sessão JWT; sucesso `204`; token revogado retorna `401` nas próximas chamadas. |
| `PATCH /api/auth/password` | Autenticado | Body `{ "senha_atual": "...", "nova_senha": "..." }`; exige senha atual, salva novo hash e revoga todas as sessões; sucesso `204`. |
| `GET /api/usuarios` | Admin | Lista usuários sem hashes. |
| `POST /api/usuarios` | Admin | Cria usuário com `nome`, `email`, `senha`, perfil; persiste somente hash. |
| `GET /api/usuarios/:id` | Admin | Consulta usuário sem hash. |
| `PATCH /api/usuarios/:id` | Admin | Altera nome, email, perfil ou `ativo`; desativar em vez de apagar. |

`USUARIO` armazena perfil (`admin` ou `atendente`) e hash scrypt com salt aleatório; a API não retorna hashes. JWT HS256 dura 12 horas e cada chamada autenticada também verifica a sessão no banco, permitindo logout, troca de senha e desativação imediata.

### Contatos e etiquetas

`:telefone` nas rotas de contato representa o número E.164, codificado para URL quando necessário. A API localiza o contato pelo telefone, não pelo `id_contato`.

| Método e rota | Acesso | Contrato |
| --- | --- | --- |
| `GET /api/contatos?page=1&limit=20` | Autenticado | Lista contatos; cada item expõe `id_contato` interno e `telefone` identificador de negócio. |
| `POST /api/contatos` | Atendente/admin | Body `{ "telefone": "+5511999999999", "nome": "Maria", "email": null }`; telefone obrigatório e único; nome pode faltar para contato criado automaticamente. |
| `GET /api/contatos/:telefone` | Autenticado | Consulta pelo telefone. |
| `PATCH /api/contatos/:telefone` | Atendente/admin | Altera nome/email; telefone não é editável depois de associado a conversa. |
| `DELETE /api/contatos/:telefone` | Admin | Só permite excluir contato sem conversa/histórico; caso contrário `409`. |
| `GET/POST /api/etiquetas` | Atendente/admin | Lista ou cria `{ "nome": "...", "cor": "..." }`. |
| `GET/PATCH/DELETE /api/etiquetas/:id` | Atendente/admin | Consulta, altera nome/cor ou exclui etiqueta. |
| `GET /api/contatos/:telefone/etiquetas` | Autenticado | Lista etiquetas do contato. |
| `PUT /api/contatos/:telefone/etiquetas/:etiquetaId` | Atendente/admin | Associa etiqueta; idempotente. |
| `DELETE /api/contatos/:telefone/etiquetas/:etiquetaId` | Atendente/admin | Remove a associação, não o contato nem a etiqueta. |

### Conversas, atendimentos e responsáveis

| Método e rota | Acesso | Contrato |
| --- | --- | --- |
| `GET /api/conversas?page=1&limit=20&telefone=...` | Autenticado | Lista conversas, contato, atendimento aberto, responsáveis ativos e timestamp da mensagem mais recente. Codifique o `+` do telefone como `%2B` na query string. |
| `POST /api/conversas` | Atendente/admin | Body `{ "telefone": "+5511999999999" }`; cria contato somente com telefone se necessário e cria/reutiliza sua conversa. Retorna `201` para nova conversa ou `200` quando ela já existe. |
| `GET /api/conversas/:id` | Autenticado | Consulta conversa com contato e resumo do atendimento. |
| `GET /api/conversas/:id/mensagens?page=1&limit=20` | Autenticado | Lista mensagens cronologicamente por `data_hora`. |
| `GET /api/conversas/:id/atendimentos` | Autenticado | Lista ciclos, mais recente primeiro, e suas atribuições. |
| `POST /api/conversas/:id/atendimentos` | Atendente/admin | Body vazio; abre ciclo (`status: "open"`, `iniciado_em` atual); conflito se já houver um aberto. O bloqueio transacional da conversa serializa aberturas concorrentes. |
| `PATCH /api/atendimentos/:id` | Atendente/admin | Altera status (`open`/`closed`) e/ou `prazo_retorno` RFC 3339 (ou `null`); encerrar grava `encerrado_em` atual. Ciclo encerrado não é reaberto; cria-se outro. |
| `GET /api/atendimentos/:id/atribuicoes` | Autenticado | Lista atribuições ativas e encerradas; prioridade é a ativa mais recente. |
| `POST /api/atendimentos/:id/atribuicoes` | Atendente/admin | Body `{ "usuarioId": 45 }`; cria acompanhamento para usuário ativo. Retorna `201` ao criar e `204` se a atribuição já estiver ativa, sem duplicar nem mudar prioridade. Vários responsáveis podem permanecer ativos simultaneamente. |
| `DELETE /api/atribuicoes/:id` | Atendente/admin | Encerra atribuição preenchendo `encerrada_em`, não apaga a linha. |
| `GET /api/conversas/:id/etiquetas` | Autenticado | Lista etiquetas comuns da conversa. |
| `PUT /api/conversas/:id/etiquetas/:etiquetaId` | Atendente/admin | Associa etiqueta comum; idempotente. |
| `DELETE /api/conversas/:id/etiquetas/:etiquetaId` | Atendente/admin | Remove a associação. |

Mensagem recebida reabre o fluxo criando novo atendimento se o anterior estiver encerrado. Não reabrir o mesmo registro. Listagens mostram todos os responsáveis ativos; destaque visual usa maior `iniciada_em` e, em empate, maior `id_atribuicao`.

### Mensagens e anotações

| Método e rota | Acesso | Contrato |
| --- | --- | --- |
| `GET /api/mensagens/:id` | Autenticado | Consulta mensagem, conversa e contato. |
| `GET /api/mensagens/:id/status` | Autenticado | Retorna status atual e histórico cronológico. |
| `GET /api/conversas/:id/mensagens?page=1&limit=20` | Autenticado | Lista mensagens em ordem cronológica, incluindo autor quando enviada por funcionário. |
| `POST /api/conversas/:id/mensagens` | Atendente/admin | Envia texto da conversa: `{ "tipo": "text", "conteudo": "..." }`; usa o telefone da conversa e registra como autor o usuário autenticado. |
| `POST /api/mensagens/enviar` | Atendente/admin | Envia para número E.164: `{ "telefone": "+5511999999999", "tipo": "text", "conteudo": "..." }`; cria contato somente com telefone e conversa se ainda não existirem, e então envia. |
| `GET /api/conversas/:id/anotacoes` | Autenticado | Lista notas cronologicamente com autor. |
| `POST /api/conversas/:id/anotacoes` | Atendente/admin | Body `{ "texto": "..." }` (1–255 caracteres); autor vem do token; nunca chama a Meta. |

Não oferecer POST genérico de `/api/mensagens`: novas mensagens devem sempre estar vinculadas a conversa e passar pelo envio para Meta ou pelo webhook. Não oferecer PATCH/DELETE de mensagens nem DELETE de anotações; preservar histórico conforme RN05/RN06. Conteúdo textual tem limite de 2048 caracteres. Mensagem de mídia recebida pode ter `conteudo: null`, mas mantém `referencia_midia` e `tipo`; a primeira versão de envio suporta somente texto.

**Envio de saída:** localizar ou criar contato por telefone e conversa única; garantir atendimento aberto; criar mensagem local `pending`; chamar Graph API para o telefone do contato; após aceite, persistir `wamid`, status `sent` e evento do histórico, e responder `202` com a mensagem. Em falha da Meta, gravar `failed` e evento sanitizado, responder `502`. Se o banco falhar após aceite externo, não repetir cegamente o envio: registrar/reconciliar pelo `wamid`. Para recuperação garantida após reinícios, planejar uma outbox e chave de idempotência.

### Webhooks do WhatsApp

Configurar callback HTTPS `/api/webhook/whatsapp` no painel Meta e assinar `messages`. Mensagens requerem permissão `whatsapp_business_messaging`; outros campos podem requerer `whatsapp_business_management`.

| Método e rota | Comportamento |
| --- | --- |
| `GET /api/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...` | Comparar token com `WHATSAPP_VERIFY_TOKEN`; quando modo/token forem válidos, responder `200` com challenge em texto puro; caso contrário `403`. |
| `POST /api/webhook/whatsapp` | Validar assinatura, persistir todos os eventos conhecidos e responder `200` só após commit. Falha transitória de banco responde `500` para permitir retry Meta. |

Validar `X-Hub-Signature-256` com HMAC-SHA256 do corpo bruto HTTP e `WHATSAPP_APP_SECRET`, comparação em tempo constante. O parser JSON do webhook aceita até 3 MB e mantém bytes brutos para validar assinatura; outras rotas continuam limitadas a 32 KB.

Para todas as entradas `entry[]`, mudanças `changes[]` e mensagens `messages[]`: validar `object`, `field`, `metadata.phone_number_id` e conteúdo; normalizar `messages[].from` como E.164; localizar/criar contato por telefone (nome do perfil se recebido, caso contrário somente telefone); criar/reutilizar conversa única e abrir atendimento se não houver um aberto; persistir mensagem com origem `contato`, ID externo, timestamp Meta convertido de Unix para UTC, tipo, conteúdo ou referência de mídia e status `received`. `id_externo UNIQUE` torna retry idempotente: mensagem já persistida é reconhecida e não duplicada.

Para todos os itens `statuses[]`: localizar mensagem pelo ID externo, atualizar status e inserir histórico na mesma transação, usando timestamp Meta; estados previstos: `sent`, `delivered`, `read`, `failed`. Repetição de evento não duplica histórico. Status sem mensagem local correspondente deve ser registrado para diagnóstico e confirmado com `200`, sem alterar outra mensagem. Payload reconhecido mas inválido: `400`; erro transitório de persistência: `500`. A Meta pode reenviar até sete dias e duplicar eventos; confirmar somente após persistência durável.

## Banco de dados

`../BD/modelo_fisico_corrigido.sql` contém o esquema completo esperado para instalação em banco vazio, incluindo os ajustes abaixo. O backend não cria nem altera tabelas automaticamente. Em banco existente, aplique uma migração revisada que crie `AUTH_SESSAO` e verifique os demais requisitos; **não reaplique o script inteiro** sobre dados existentes.

| Tabela/coluna | Requisito de esquema |
| --- | --- |
| `CONTATO.telefone` | `NOT NULL UNIQUE`, normalizado em E.164. `id_contato` pode permanecer como PK interna; telefone é identificador natural/de negócio para busca e upsert. |
| `CONVERSA.FK_CONTATO_id_contato` | `NOT NULL UNIQUE` para garantir no máximo uma conversa persistente por contato. |
| `ATENDIMENTO` | Remover `CONVERSA.FK_ATENDIMENTO_id_atendimento`; adicionar `ATENDIMENTO.FK_CONVERSA_id_conversa NOT NULL` indexada, permitindo vários ciclos por conversa. Garantir um atendimento aberto por conversa via transação/bloqueio na aplicação. |
| `MENSAGEM.FK_CONVERSA_id_conversa` | `NOT NULL` e FK; permite várias mensagens em cada conversa. |
| `MENSAGEM.conteudo` | Alterar o atual `VARCHAR(255)` para `VARCHAR(2048) NULL`; a API aceita mídia sem texto e valida conteúdo/referência conforme o tipo. |
| `MENSAGEM.id_externo` | `VARCHAR(255) NULL UNIQUE`; compatível com `wamid` e deduplicação de mensagens. |
| `MENSAGEM.FK_USUARIO_id_usuario` | Opcional: nulo para contato/chatbot, funcionário autenticado para envio manual. Origem: `contato`, `usuario` ou `chatbot`. |
| `MENSAGEM_STATUS_HISTORICO` | Manter FK obrigatória e índice por mensagem/data. Registrar estado inicial e cada transição juntamente com atualização do estado atual. |
| `WHATSAPP_STATUS_PENDENTE` | Guardar temporariamente status Meta recebido antes de persistir o ID da mensagem enviada; chave única por ID externo, status e timestamp. |
| `AUTH_SESSAO` | Guardar `jti` único, usuário, criação, expiração de 12h e revogação para invalidar tokens no logout/troca de senha. |
| `ANOTACAO_INTERNA` | FK de conversa obrigatória e FK de autor `FK_USUARIO_id_usuario NOT NULL`; indexar conversa/data. |
| `ATRIBUICAO` | Manter FKs obrigatórias para usuário e atendimento; várias atribuições ativas são válidas. Impedir duplicata ativa do mesmo usuário/atendimento em transação. |
| `USUARIO` | Guardar `hash_senha`, perfil (`admin`, `atendente`) e estado ativo; desativar usuários em vez de excluí-los. |

Criar contato, conversa e atendimento de forma concorrente-segura (índices únicos e transações); ambas as origens de mensagens devem usar o mesmo serviço de upsert por telefone. Registrar criação de mensagem e histórico/status em transações. Não permitir cascata que apague mensagens/anotações da API.

## Ambiente

```dotenv
HOST=127.0.0.1
PORT=3000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=inablink
DB_PASSWORD=change-me
DB_NAME=inablink
JWT_SECRET=
CORS_ORIGINS=
DB_SSL=false
DB_SSL_CA=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_APP_SECRET=
WHATSAPP_API_VERSION=
```

Gere `JWT_SECRET` com pelo menos 32 bytes aleatórios e configure-o em armazenamento de segredos na Azure. Defina `WHATSAPP_API_VERSION` para uma versão Graph ainda suportada pela aplicação Meta. `JWT_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET` e `WHATSAPP_VERIFY_TOKEN` são segredos; nunca os versione nem registre em logs ou respostas.

## Testes

Usar **Vitest** como runner dos testes do backend; não usar o test runner embutido do Node.js. O script `test` executa `vitest run`.

Com esse script, executar na pasta `backend`:

```powershell
npm test
npm test -- test/app.test.ts
npm test -- test/app.test.ts -t "webhook"
npm run typecheck
npm run build
```

O teste focado pode selecionar um arquivo ou usar `-t` com o nome/subtexto do teste. Os testes atuais cobrem autenticação, APIs de contatos/conversas/mensagens/anotações, CORS, webhook simulado, assinatura, deduplicação e envio Graph API simulado; não conectam ao MySQL da Azure nem enviam mensagens reais. Ainda é necessário validar a instalação do schema na Azure e fazer smoke test manual com um destinatário de teste autorizado. O type-check/build não substituem a suíte Vitest.

### Smoke test manual com JWT

Depois de provisionar um usuário ativo, autentique-se e use o token retornado no envio:

```powershell
$login = Invoke-RestMethod -Method Post `
  -Uri "https://<host-azure>/api/auth/login" `
  -ContentType "application/json" `
  -Body (@{ email = "<email>"; senha = "<senha>" } | ConvertTo-Json)
$headers = @{ Authorization = "Bearer $($login.data.accessToken)" }
$body = @{
  telefone = "+15551234567"
  tipo = "text"
  conteudo = "Teste de integração InAblink"
} | ConvertTo-Json
Invoke-RestMethod -Method Post `
  -Uri "https://<host-azure>/api/mensagens/enviar" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $body
```

Use um número de teste permitido pela configuração Meta e que tenha consentido. Essa chamada não deve apontar para produção durante homologação.
