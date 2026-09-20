# InAblink API

Backend inicial em Node.js 22+, Express e MySQL. Compatível com as tabelas de `../BD/fisiico.sql`.

## Preparação

1. No MySQL Workbench, crie um schema (por exemplo, `CREATE DATABASE inablink CHARACTER SET utf8mb4;`), selecione-o com `USE inablink;` e execute `BD/fisiico.sql` **uma única vez em um banco vazio**. Se as tabelas já existem, use o schema existente. `BD/banco-1-sql` é um modelo lógico, não o script de instalação MySQL.
2. No terminal, na pasta `backend`:

   ```powershell
   npm ci
   Copy-Item .env.example .env
   ```

3. Edite `.env` com as credenciais de um usuário MySQL com acesso ao schema. O arquivo de exemplo não cria esse usuário. Não versione credenciais.
4. Execute `npm run dev` (reinício automático) ou `npm start`.

A API escuta em `http://127.0.0.1:3000` por padrão. Esta base é para desenvolvimento local: autenticação e autorização ainda não foram implementadas. Antes de disponibilizar acesso externo, implemente o controle de acesso.

## Rotas

| Método | Rota | Resultado |
| --- | --- | --- |
| GET | `/health` | Processo ativo |
| GET | `/health/ready` | Conexão MySQL; 503 se indisponível |
| GET | `/api/contatos?page=1&limit=20` | Lista paginada (limite máximo 100) |
| GET | `/api/contatos/:id` | Contato por ID |
| POST | `/api/contatos` | Cria contato; exige `nome` e `telefone`; aceita `email` |
| PATCH | `/api/contatos/:id` | Atualiza os campos enviados |
| DELETE | `/api/contatos/:id` | Exclui contato |
| GET/POST | `/api/etiquetas` | Lista/cria etiquetas; exige `nome`; aceita `cor` |
| GET/PATCH/DELETE | `/api/etiquetas/:id` | Consulta/atualiza/exclui etiqueta |

POST retorna 201 e o cabeçalho `Location`; PATCH e DELETE retornam 204. Campos opcionais podem ser limpos com `null`. Campos desconhecidos são rejeitados. Erros usam `{ "error": "..." }` e consultas retornam `{ "data": ... }`.

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health/ready
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3000/api/contatos -ContentType 'application/json' -Body '{"nome":"Maria","telefone":"5511999999999","email":"maria@example.com"}'
Invoke-RestMethod http://127.0.0.1:3000/api/contatos
```

## Validação e próximos passos

`npm test` executa testes HTTP com banco simulado, incluindo validação, parâmetros SQL e falhas de conexão. Eles não substituem testes de integração com uma instância MySQL real. A aplicação não cria nem altera tabelas automaticamente.

O SQL atual não representa todas as cardinalidades de `BD/detalhes_bd`: por exemplo, CONVERSA aponta para uma única MENSAGEM, enquanto o documento descreve várias mensagens por conversa. As regras de responsáveis também diferem entre os documentos. Revisar esses pontos antes de implementar conversas, mensagens e atribuições. Integração com WhatsApp, autenticação, cadastro de usuários e associação de etiquetas ficam para as próximas etapas. As exclusões existentes seguem as ações de chave estrangeira definidas no SQL, inclusive `SET NULL` nas associações de etiquetas.
