# InAblink

**PI-G1 · Projeto Interdisciplinar ADS2 · FatecID · Grupo 1**

Plataforma de atendimento via **WhatsApp Business** para pequenas e médias empresas que têm atendimento ao público.

## O problema

Pequenas empresas usam o WhatsApp como principal canal de comunicação com os clientes, mas têm dificuldade para organizar atendimentos feitos por vários funcionários. O InAblink centraliza contatos, conversas, mensagens e atendimentos usando a **API oficial do WhatsApp Business (Meta)**.

## Funcionalidades

- **Autenticação** com JWT (12 horas) e sessões revogáveis: logout, troca de senha e desativação do usuário invalidam o token imediatamente.
- **Perfis de acesso:** `admin` (gerencia usuários) e `atendente`.
- **Conversas e mensagens** integradas ao WhatsApp: recebimento por webhook e envio de texto pela Graph API.
- **Atendimentos** com ciclos (abrir e encerrar), prazo de retorno e vários responsáveis simultâneos.
- **Contatos e etiquetas**, com identificação do contato pelo telefone (E.164).
- **Notas internas** por conversa, nunca enviadas ao WhatsApp.
- **Histórico de status das mensagens:** enviada, entregue, lida ou falha.
- **Relatórios, dashboard e alertas:** tempo de resposta, taxa de conclusão, SLA, ranking de atendentes e conversas sem resposta.

## Tecnologias

| Camada   | Tecnologias                                         |
| -------- | --------------------------------------------------- |
| Backend  | Node.js 22+, TypeScript, Express 5, MySQL (`mysql2`), `jose` (JWT) |
| Frontend | React 18, Vite 6, `lucide-react`                    |
| Testes   | Vitest                                              |
| Banco    | MySQL                                               |

## Estrutura do repositório

```
BD/          Script SQL do banco (modelo_fisico_corrigido.sql)
backend/     API Node.js + Express (guia detalhado em backend/README.md)
Front-End/   Aplicação React + Vite
doc/         Documentação e requisitos
```

## Pré-requisitos

- Node.js **22 ou superior**
- MySQL
- Para a integração real com o WhatsApp: conta Meta for Developers com um app do WhatsApp Business

## Como executar localmente

### 1. Banco de dados

Crie o banco e aplique o schema em um banco **vazio**:

```sql
CREATE DATABASE inablink CHARACTER SET utf8mb4;
USE inablink;
SOURCE BD/modelo_fisico_corrigido.sql;
```

> O script instala um schema vazio e **não migra** bancos existentes. Não o reaplique sobre dados. O backend também não cria nem altera tabelas sozinho.

### 2. Backend

```bash
cd backend
npm ci
cp .env.example .env      # no PowerShell: Copy-Item .env.example .env
```

Edite o `.env` (veja a tabela de variáveis abaixo) e crie o primeiro administrador:

```bash
npm run build

# Linux/macOS (bash)
BOOTSTRAP_ADMIN_NAME="Admin" \
BOOTSTRAP_ADMIN_EMAIL="admin@exemplo.com" \
BOOTSTRAP_ADMIN_PASSWORD="uma-senha-com-12-a-128-caracteres" \
npm run admin:create

# Windows (PowerShell)
$env:BOOTSTRAP_ADMIN_NAME="Admin"
$env:BOOTSTRAP_ADMIN_EMAIL="admin@exemplo.com"
$env:BOOTSTRAP_ADMIN_PASSWORD="uma-senha-com-12-a-128-caracteres"
npm run admin:create
```

O comando só funciona com a tabela `USUARIO` vazia e grava apenas o hash da senha. Depois de executar, remova essas variáveis do ambiente (no PowerShell: `Remove-Item Env:BOOTSTRAP_ADMIN_*`).

Inicie a API:

```bash
npm run dev      # com watch, em http://127.0.0.1:3000
```

Verifique: `GET http://127.0.0.1:3000/health` deve responder `{ "status": "ok" }`, e `GET /health/ready` confirma a conexão com o MySQL.

### 3. Frontend

```bash
cd Front-End
npm install
```

Crie `Front-End/.env.development` apontando para a API:

```env
VITE_API_BASE_URL=http://127.0.0.1:3000
```

E no `backend/.env` libere a origem do frontend:

```env
CORS_ORIGINS=http://localhost:5173
```

Inicie o Vite:

```bash
npm run dev      # http://localhost:5173
```

Reinicie o `npm run dev` sempre que alterar arquivos `.env`.

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

Para gerar um `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

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

**Exemplo de login:**

```bash
curl -X POST http://127.0.0.1:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@exemplo.com","senha":"sua-senha"}'
```

O token retornado em `data.accessToken` é enviado nas demais chamadas como `Authorization: Bearer <token>`.

## Testes

```bash
cd backend
npm test                                   # todos os testes
npm test -- test/app.test.ts -t "webhook"  # um arquivo ou nome específico
npm run typecheck
```

Os testes usam simulações: não conectam ao MySQL real nem enviam mensagens pelo WhatsApp. Antes de uma entrega, valide o schema no banco real e faça um teste manual com um número autorizado.

## Deploy

O projeto tem duas partes com hospedagens diferentes.

> **O GitHub Pages hospeda apenas arquivos estáticos.** Ele serve o frontend, mas **não executa a API Node.js nem o MySQL**. O backend precisa rodar em outro serviço com HTTPS (o `backend/README.md` cita a Azure), pois o webhook da Meta também exige um endereço público.

### Frontend no GitHub Pages

1. Em `Front-End/vite.config.ts`, defina o `base` com o nome do repositório:

   ```ts
   import { defineConfig } from 'vite';
   import react from '@vitejs/plugin-react';

   export default defineConfig({
     plugins: [react()],
     base: '/<nome-do-repositorio>/',
   });
   ```

2. Em **Settings > Pages**, escolha **GitHub Actions** como fonte.
3. Em **Settings > Secrets and variables > Actions > Variables**, crie `VITE_API_BASE_URL` com a URL HTTPS do backend. Essa variável é embutida no bundle no momento do build, então nunca coloque segredos nela.
4. Crie `.github/workflows/deploy.yml`:

   ```yaml
   name: Deploy frontend
   on:
     push:
       branches: [main]
   permissions:
     contents: read
     pages: write
     id-token: write
   jobs:
     build:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with:
             node-version: 22
             cache: npm
             cache-dependency-path: Front-End/package-lock.json
         - run: npm ci
           working-directory: Front-End
         - run: npm run build
           working-directory: Front-End
           env:
             VITE_API_BASE_URL: ${{ vars.VITE_API_BASE_URL }}
         - uses: actions/upload-pages-artifact@v3
           with:
             path: Front-End/dist
     deploy:
       needs: build
       runs-on: ubuntu-latest
       environment:
         name: github-pages
         url: ${{ steps.deployment.outputs.page_url }}
       steps:
         - id: deployment
           uses: actions/deploy-pages@v4
   ```

5. No backend, libere a origem do site publicado. Use só a origem, sem o caminho do repositório:

   ```env
   CORS_ORIGINS=https://<usuario>.github.io
   ```

### Backend

Publique em um serviço que rode Node.js 22+ com HTTPS e MySQL acessível. Configure as variáveis de ambiente no armazenamento de segredos do serviço (não em arquivo versionado), use `DB_SSL=true`, rode `npm run build` e inicie com `npm start`. O servidor não executa migrações automaticamente.

## Segurança

- Senhas têm de 12 a 128 caracteres e são salvas com hash `scrypt` e salt aleatório.
- O token fica em `sessionStorage` no navegador e é validado a cada requisição contra a sessão no banco.
- O perfil e a identidade do usuário vêm sempre do banco, nunca de parâmetros enviados pelo cliente.
- Mensagens e notas formam histórico e não podem ser apagadas pela API.
- Nunca versione `.env`, tokens ou senhas. Se um segredo vazar, troque-o imediatamente.

## Problemas comuns

| Sintoma | Causa provável |
| --- | --- |
| `ER_NO_SUCH_TABLE` | O banco foi criado com um schema antigo ou incompleto. Compare `SHOW TABLES;` com o script em `BD/`. |
| `404` em `/api/...` no navegador | A requisição foi para o servidor do Vite. Defina `VITE_API_BASE_URL` e reinicie o Vite. |
| `ERR_CONNECTION_REFUSED` / `ECONNREFUSED` | O backend não está rodando na porta configurada. |
| Erro de CORS | A origem do frontend não está em `CORS_ORIGINS` (inclua protocolo e porta). |
| `ETIMEDOUT` ou falha ao conectar no MySQL | Host, porta ou firewall incorretos; ou `DB_SSL=true` em um MySQL sem TLS. |
| `500` genérico | A resposta esconde o erro de propósito; veja o `code` no terminal do backend. |
| `JWT_SECRET must contain at least 32 UTF-8 bytes` | A chave está vazia ou curta demais. |
| `admin:create` falha | Rode `npm run build` antes, confira as três variáveis `BOOTSTRAP_ADMIN_*` e use um banco com `USUARIO` vazia. |

## Licença

Distribuído sob a **GNU General Public License**. Veja o arquivo [`LICENSE`](LICENSE).