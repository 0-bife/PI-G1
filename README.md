# InAblink

**PI-G1 · Projeto Interdisciplinar ADS2 · FatecID · Grupo 1 · Clara Madeira, Flávia Lopes, Isabely da Silva e Rubens Maglio**

Plataforma de atendimento via **WhatsApp Business** para pequenas e médias empresas que têm atendimento ao público.

## O problema

Pequenas empresas usam o WhatsApp como principal canal de comunicação com os clientes, mas têm dificuldade para organizar atendimentos feitos por vários funcionários. O InAblink centraliza contatos, conversas, mensagens e atendimentos usando a **API oficial do WhatsApp Business (Meta)**.

## Funcionalidades

- **Autenticação** com JWT (12 horas) e sessões revogáveis: logout, troca de senha e desativação do usuário invalidam o token imediatamente.
- **Perfis de acesso:** `admin` (gerencia usuários) e `atendente`.
- **Conversas e mensagens** integradas ao WhatsApp: recebimento por webhook e envio de texto pela Graph API.
- **Atendimentos** com ciclos (abrir, encerramento manual por admin ou atendente atribuído e reabertura reversível em até 24h desde a primeira mensagem do cliente), prazo de retorno, **rodízio automático entre atendentes online em horário comercial configurável** (padrão `10:00`–`22:00`) e gestão manual de responsáveis por administradores (incluindo assumir, atribuir a terceiros e responder sem alterar a atribuição).
- **Respostas automáticas contextuais** no webhook do WhatsApp: menu de boas-vindas para novas conversas em horário comercial com atendentes online, aviso de indisponibilidade fora do horário ou sem atendentes online, e vínculo automático de etiquetas cujo nome corresponda à opção respondida pelo cliente.
- **Contatos e etiquetas**, com identificação do contato pelo telefone (E.164).
- **Notas internas** por conversa, nunca enviadas ao WhatsApp.
- **Histórico de status das mensagens:** enviada, entregue, lida ou falha.
- **Relatórios, dashboard (admin) e alertas:** tempo médio de resposta (após mensagem automática inicial), tempo médio de atendimento, conversas totais e ativas com filtros por usuário, período e etiqueta, gráficos de seção de círculo, taxa de conclusão, SLA, ranking de atendentes e conversas sem resposta.

## Tecnologias

| Camada   | Tecnologias                                         |
| -------- | --------------------------------------------------- |
| Backend  | Node.js 22+, TypeScript, Express 5, MySQL (`mysql2`), `jose` (JWT) |
| Frontend | React 18, Vite 6, `lucide-react`                    |
| Testes   | Vitest                                              |
| Banco    | MySQL                                               |

## Estrutura do repositório

```
BD/          Script SQL do banco (inablink_criacao.sql)
backend/     API Node.js + Express (guia detalhado em backend/README.md)
Front-End/   Aplicação React + Vite
doc/         Documentação e requisitos
```

## Pré-requisitos

- Node.js **22 ou superior**
- MySQL
- Para a integração real com o WhatsApp: conta Meta for Developers com um app do WhatsApp Business

## Variáveis de ambiente (backend)

Copie `backend/.env.example` para `backend/.env`. Nunca versione o `.env`.

| Variável | Descrição |
| --- | --- |
| `HOST`, `PORT` | Endereço e porta da API (padrão `127.0.0.1:3000`). |
| `DB_HOST`, `DB_PORT` | Servidor e porta do MySQL (padrão 3306). |
| `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Credenciais e nome do banco. |
| `DB_SSL` | `true` exige TLS na conexão. **Use `false` em MySQL local** sem SSL; use `true` em produção. |
| `DB_SSL_CA` | Caminho opcional de um certificado CA, caso o provedor exija. |
| `JWT_SECRET` | Chave de assinatura dos tokens, com **pelo menos 32 bytes aleatórios**. |
| `CORS_ORIGINS` | Origens do frontend permitidas, separadas por vírgula. Não aceita `*`. |
| `WHATSAPP_ACCESS_TOKEN` | Token de acesso da API do WhatsApp. |
| `WHATSAPP_PHONE_NUMBER_ID` | ID do número de telefone no WhatsApp Business. |
| `WHATSAPP_VERIFY_TOKEN` | Token que você define para a verificação do webhook. |
| `WHATSAPP_APP_SECRET` | Segredo do app Meta, usado para validar a assinatura do webhook. |
| `WHATSAPP_API_VERSION` | Versão da Graph API suportada pelo seu app (ex.: `v21.0`; confira no painel Meta). |
| `BUSINESS_HOURS_START`, `BUSINESS_HOURS_END` | Início e fim padrão do horário comercial no formato `HH:MM` (padrão `10:00` e `22:00`). |
| `AUTO_REPLY_CONFIG_PATH` | Caminho opcional do arquivo JSON onde o backend persiste a configuração de horário comercial e mensagens automáticas (padrão `backend/data/auto-reply-config.json`). |

`JWT_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET` e `WHATSAPP_VERIFY_TOKEN` são segredos: nunca os coloque no repositório, em logs ou no frontend.

## Scripts

**Backend** (`backend/`)

| Script | Função |
| --- | --- |
| `npm run dev` | Executa os fontes TypeScript com watch. |
| `npm run build` | Compila para `dist/` (a pasta não é versionada). |
| `npm start` | Inicia a versão compilada. |
| `npm run typecheck` | Verifica tipos sem gerar arquivos. |
| `npm test` | Executa os testes com Vitest. |
| `npm run admin:create` | Cria o primeiro administrador (exige `npm run build` antes). |

**Frontend** (`Front-End/`)

| Script | Função |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento do Vite. |
| `npm run build` | Gera a versão de produção em `dist/`. |
| `npm run preview` | Serve localmente a versão gerada. |

## Integração com o WhatsApp

A API recebe mensagens e status de entrega pelo webhook `/api/webhook/whatsapp`.

1. No painel [Meta for Developers](https://developers.facebook.com/), abra seu app e a configuração de **WhatsApp > Webhooks**.
2. Em **URL de retorno de chamada**, informe `https://<seu-backend>/api/webhook/whatsapp`. O endereço precisa ser **HTTPS e público**.
3. Em **Token de verificação**, use o mesmo valor de `WHATSAPP_VERIFY_TOKEN`.
4. Assine o campo **`messages`**.
5. Copie o segredo do app para `WHATSAPP_APP_SECRET`. Toda requisição é validada pela assinatura `X-Hub-Signature-256`.

O webhook é idempotente: eventos repetidos pela Meta não duplicam mensagens nem histórico. Em ambiente de homologação, use somente números de teste autorizados.

## Visão geral da API

Todas as rotas `/api/*` exigem `Authorization: Bearer <token>`, exceto `POST /api/auth/login` e o webhook. Listas aceitam `page` (padrão 1) e `limit` (padrão 20, máximo 100).

| Grupo | Rotas principais |
| --- | --- |
| Saúde | `GET /health`, `GET /health/ready` |
| Autenticação | `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`, `PATCH /api/auth/password` |
| Usuários (admin) | `GET/POST /api/usuarios`, `GET/PATCH /api/usuarios/:id` |
| Configurações | `GET/PATCH /api/configuracoes/perfil`, `GET/PATCH /api/configuracoes/atendimento` |
| Contatos | `GET/POST /api/contatos`, `GET/PATCH/DELETE /api/contatos/:telefone`, etiquetas do contato |
| Etiquetas | `GET/POST /api/etiquetas`, `GET/PATCH/DELETE /api/etiquetas/:id` |
| Conversas | `GET/POST /api/conversas`, `GET /api/conversas/:id`, etiquetas da conversa |
| Atendimentos | `GET/POST /api/conversas/:id/atendimentos`, `PATCH /api/atendimentos/:id` |
| Responsáveis | `GET/POST /api/atendimentos/:id/atribuicoes`, `DELETE /api/atribuicoes/:id` |
| Mensagens | `GET/POST /api/conversas/:id/mensagens`, `POST /api/mensagens/enviar`, `GET /api/mensagens/:id/status` |
| Notas internas | `GET/POST /api/conversas/:id/anotacoes` |
| Análises | `GET /api/relatorios/atendimentos`, `GET /api/dashboard/atendimentos`, `GET /api/alertas/atendimentos` |
| Webhook | `GET/POST /api/webhook/whatsapp` |

Contratos completos, regras de negócio, códigos de erro e exemplos estão em [`backend/README.md`](backend/README.md).

## Segurança

- Senhas têm de 12 a 128 caracteres e são salvas com hash `scrypt` e salt aleatório.
- O token fica em `sessionStorage` no navegador e é validado a cada requisição contra a sessão no banco.
- O perfil e a identidade do usuário vêm sempre do banco, nunca de parâmetros enviados pelo cliente.
- Mensagens e notas formam histórico e não podem ser apagadas pela API.
- Nunca versione `.env`, tokens ou senhas. Se um segredo vazar, troque-o imediatamente.

## Licença

Distribuído sob a **GNU General Public License**. Veja o arquivo [`LICENSE`](LICENSE).
