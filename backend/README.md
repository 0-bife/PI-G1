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

## Histórico da primeira fatia WhatsApp

O bloco abaixo registra a primeira fatia WhatsApp, anterior à implementação de login:

- `GET /api/webhook/whatsapp` valida `WHATSAPP_VERIFY_TOKEN` e devolve o challenge da Meta.
- `POST /api/webhook/whatsapp` valida `X-Hub-Signature-256` com `WHATSAPP_APP_SECRET`, percorre eventos `messages` e `statuses`, cria/reutiliza contato e conversa pelo telefone, abre atendimento se necessário e grava mensagens/status no MySQL. IDs de mensagem e eventos repetidos são deduplicados.
- `POST /api/mensagens/enviar` recebe `{ "telefone": "+15551234567", "tipo": "text", "conteudo": "..." }`, cria contato/conversa/atendimento se necessário, persiste o estado `pending`, envia pela Graph API e atualiza o estado com o ID retornado. Retorna `202` quando a Meta aceita a mensagem.
- Rotas `/api/*` fora do webhook exigem `Authorization: Bearer <API_ACCESS_TOKEN>`. Este token compartilhado é uma proteção provisória para integração/teste, não autenticação individual nem autorização por perfil; não publicar a API para usuários finais com esse mecanismo.
- Como ainda não há login, o token compartilhado não identifica um funcionário específico; mensagens de saída ficam com `origem = 'usuario'` e FK de usuário nula. Implementar autenticação individual para preencher a autoria real antes do uso por vários atendentes.

O restante das rotas descritas neste contrato continua como especificação futura. O webhook responde `200` somente após commit; estados que chegarem antes do ID de saída ser salvo ficam temporariamente em `WHATSAPP_STATUS_PENDENTE` e são aplicados ao correlacionar o ID. Falhas reais da Meta e do MySQL ainda devem ser validadas em homologação; a suíte não envia mensagens externas.

## Autenticação JWT atual

`POST /api/auth/login` emite JWT Bearer assinado com HS256 e validade de 12 horas para usuário ativo. Todas as rotas `/api/*`, exceto login e webhook Meta, exigem `Authorization: Bearer <accessToken>`. Cada requisição valida assinatura/expiração e consulta `AUTH_SESSAO` junto ao estado e perfil atuais do usuário.

`POST /api/auth/logout` revoga a sessão imediatamente; `PATCH /api/auth/password` exige senha atual, troca o hash scrypt e revoga todas as sessões da conta. Desativar um usuário bloqueia todos os seus tokens. Senhas devem ter de 12 a 128 caracteres, são armazenadas com salt aleatório e nunca aparecem em resposta/log.

No navegador, guardar o JWT em `sessionStorage`, não em `localStorage`; enviar o bearer token em cada chamada e limpar o armazenamento após logout ou `401`. Fechar a aba remove o token daquela sessão do navegador, mas não garante aviso ao servidor: a sessão remota permanece até o logout explícito, troca de senha, desativação da conta ou expiração de 12 horas.

Configure `JWT_SECRET` com pelo menos 32 bytes aleatórios e mantenha-o fora do repositório. Para provisionar o primeiro administrador em um banco vazio, compile com `npm run build`, defina temporariamente `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_EMAIL` e `BOOTSTRAP_ADMIN_PASSWORD` apenas no ambiente do processo e execute `npm run admin:create`. O comando recusa banco `USUARIO` não vazio e armazena somente hash; remova as variáveis após a execução.

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

O teste focado pode selecionar um arquivo ou usar `-t` com o nome/subtexto do teste. Os testes atuais cobrem o webhook simulado, assinatura, deduplicação, envio Graph API simulado, persistência simulada e rotas existentes; não conectam ao MySQL da Azure nem enviam mensagens reais. Ainda é necessário validar a instalação do schema na Azure e fazer smoke test manual com um destinatário de teste autorizado. O type-check/build não substituem a suíte Vitest.

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

### Exemplo legado de smoke test (token compartilhado; não usar)

Depois de configurar a callback Meta para o endereço HTTPS do serviço, usar um telefone de teste permitido pela configuração Meta:

```powershell
$headers = @{ Authorization = "Bearer $env:API_ACCESS_TOKEN" }
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

O telefone acima é ilustrativo: substitua-o por um número de teste que possa receber mensagens do número Meta configurado e que tenha consentido. Confirme o recebimento no WhatsApp e confira `CONTATO`, `CONVERSA`, `ATENDIMENTO`, `MENSAGEM` e `MENSAGEM_STATUS_HISTORICO` no MySQL. Para o fluxo de entrada, envie uma mensagem do telefone de teste ao número WhatsApp da empresa e confirme que o webhook criou/reutilizou contato/conversa e persistiu a mensagem. Não faça esses smoke tests apontando para produção.
