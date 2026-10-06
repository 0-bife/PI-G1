# InAblink API

Especificação-alvo do backend Node.js 22+, Express e MySQL. Este contrato orienta a próxima etapa de implementação; as rotas descritas ainda não estão todas implementadas. O SQL-base é `../BD/modelo_fisico_corrigido.sql`, sujeito aos ajustes documentados em [Banco de dados](#banco-de-dados).

## Executar localmente

Crie o schema MySQL, aplique o SQL físico atualizado e execute na pasta `backend`:

```powershell
npm ci
Copy-Item .env.example .env
npm run dev
```

Configure `.env` com credenciais locais. `npm start` inicia sem watch. O servidor não executa migrações automaticamente. Não disponibilize externamente antes de configurar autenticação, autorização e HTTPS.

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
| `POST /api/auth/login` | Público | Body `{ "email": "...", "senha": "..." }`; valida hash e retorna token e dados públicos; credenciais inválidas retornam `401`. |
| `GET /api/auth/me` | Autenticado | Retorna usuário do token sem `hash_senha`. |
| `GET /api/usuarios` | Admin | Lista usuários sem hashes. |
| `POST /api/usuarios` | Admin | Cria usuário com `nome`, `email`, `senha`, perfil; persiste somente hash. |
| `GET /api/usuarios/:id` | Admin | Consulta usuário sem hash. |
| `PATCH /api/usuarios/:id` | Admin | Altera nome, email, perfil ou `ativo`; desativar em vez de apagar. |

O SQL precisa armazenar perfil/role (`admin` ou `atendente`). A implementação do token e sua expiração também devem ser definidas. Senhas nunca são retornadas nem armazenadas em texto puro.

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
| `GET /api/conversas?page=1&limit=20&telefone=...` | Autenticado | Lista conversas, contato, atendimento aberto, responsáveis ativos e timestamp da mensagem mais recente. |
| `POST /api/conversas` | Atendente/admin | Body `{ "telefone": "+5511999999999" }`; cria contato somente com telefone se necessário e cria/reutiliza sua conversa. |
| `GET /api/conversas/:id` | Autenticado | Consulta conversa com contato e resumo do atendimento. |
| `GET /api/conversas/:id/mensagens?page=1&limit=20` | Autenticado | Lista mensagens cronologicamente por `data_hora`. |
| `GET /api/conversas/:id/atendimentos` | Autenticado | Lista ciclos, mais recente primeiro, e suas atribuições. |
| `POST /api/conversas/:id/atendimentos` | Atendente/admin | Abre ciclo (`status: "open"`, `iniciado_em` atual); conflito se já houver um aberto. |
| `PATCH /api/atendimentos/:id` | Atendente/admin | Altera status/prazo ou encerra com `status: "closed"` e `encerrado_em` atual. Ciclo encerrado não é reaberto; cria-se outro. |
| `GET /api/atendimentos/:id/atribuicoes` | Autenticado | Lista atribuições ativas e encerradas; prioridade é a ativa mais recente. |
| `POST /api/atendimentos/:id/atribuicoes` | Atendente/admin | Body `{ "usuarioId": 45 }`; cria acompanhamento para esse funcionário. Se já ativo, retorna sucesso sem duplicar nem mudar prioridade. |
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
| `POST /api/conversas/:id/mensagens` | Atendente/admin | Envia texto da conversa: `{ "tipo": "text", "conteudo": "..." }`; remetente é o usuário autenticado. |
| `POST /api/mensagens/enviar` | Atendente/admin | Envia para número E.164: `{ "telefone": "+5511999999999", "tipo": "text", "conteudo": "..." }`; cria contato somente com telefone e conversa se ainda não existirem, e então envia. |
| `GET /api/conversas/:id/anotacoes` | Autenticado | Lista notas cronologicamente com autor. |
| `POST /api/conversas/:id/anotacoes` | Atendente/admin | Body `{ "texto": "..." }`; autor vem do token; nunca chama a Meta. |

Não oferecer POST genérico de `/api/mensagens`: novas mensagens devem sempre estar vinculadas a conversa e passar pelo envio para Meta ou pelo webhook. Não oferecer PATCH/DELETE de mensagens nem DELETE de anotações; preservar histórico conforme RN05/RN06. Conteúdo textual tem limite de 2048 caracteres. Mensagem de mídia pode ter `conteudo: null`, mas exige `referencia_midia` e `tipo` compatíveis. A primeira versão de envio suporta texto; mídia recebida deve preservar tipo e ID/referência Meta sem alegar que o arquivo foi baixado.

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

Usar `../BD/modelo_fisico_corrigido.sql` como base e consolidar as alterações abaixo nesse arquivo antes de depender dele. O backend não cria nem altera tabelas automaticamente.

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
| `ANOTACAO_INTERNA` | FK de conversa obrigatória e FK de autor `FK_USUARIO_id_usuario NOT NULL`; indexar conversa/data. |
| `ATRIBUICAO` | Manter FKs obrigatórias para usuário e atendimento; várias atribuições ativas são válidas. Impedir duplicata ativa do mesmo usuário/atendimento em transação. |
| `USUARIO` | Adicionar perfil/role (`admin`, `atendente`) para autorização definida por RN01. Desativar usuários em vez de excluí-los. |

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
DB_SSL=false
DB_SSL_CA=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_APP_SECRET=
WHATSAPP_API_VERSION=v19.0
```

Não usar token padrão em produção. Nunca registrar segredos nos logs ou respostas.

## Testes

Usar **Vitest** como runner dos testes do backend; não usar o test runner embutido do Node.js. A etapa de implementação deve adicionar Vitest às dependências de desenvolvimento do `backend/package.json` e configurar o script `test` para executar `vitest run`.

Com esse script, executar na pasta `backend`:

```powershell
npm test
npm test -- test/app.test.js
npm test -- test/app.test.js -t "webhook"
```

O teste focado pode selecionar um arquivo ou usar `-t` com o nome/subtexto do teste. Criar testes para rotas, perfis de acesso, transações/FKs, upsert por telefone nos dois sentidos, webhook com múltiplos eventos, assinatura, deduplicação, status, reabertura de atendimento e falhas da Meta/banco. Atualizar o conjunto atual, escrito para `node:test`, para Vitest. Não existem scripts de build ou lint configurados.
