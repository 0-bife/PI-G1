# Frontend InAblink

## Configuração

O frontend usa o cliente centralizado [`src/api.ts`](src/api.ts). Configure a origem da API no ambiente do Vite usando `VITE_API_BASE_URL` (sem incluir `/api`):

```env
VITE_API_BASE_URL=http://localhost:3000
```

Se o frontend e a API estiverem em origens diferentes, configure `CORS_ORIGINS` no backend com a origem exata do frontend, por exemplo `http://localhost:5173`.

Execute o frontend dentro de `Front-End/`:

```sh
npm install
npm run dev
```

O token de acesso é guardado somente em `sessionStorage` com a chave `inablink.accessToken`. O cliente envia o Bearer Token nas rotas `/api/*`, interpreta `204 No Content` sem ler JSON e, em `401`, remove o token e retorna à tela de login.

## Uso na interface

Importe o cliente da tela React. Por exemplo, para carregar a primeira página de conversas e atualizar estado:

```jsx
import { useEffect, useState } from 'react';
import { getConversations } from './api.ts';

function ConversationList() {
  const [conversations, setConversations] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    getConversations(1, 20)
      .then((result) => setConversations(result.data))
      .catch((requestError) => setError(requestError.message));
  }, []);

  return (
    <>
      {error && <p role="alert">{error}</p>}
      {conversations.map((conversation) => (
        <button key={conversation.id_conversa}>
          {conversation.nome || conversation.telefone}
        </button>
      ))}
    </>
  );
}
```

Operações disponíveis:

- `login(email, senha)` e `logout()`; `checkMe()` valida a sessão no carregamento.
- `getConversations(page, limit)`, `searchConversations(query, limit)` e `createConversation(telefone)`.
- `getConversationMessages(id, page, limit)` e `sendMessage(id, conteudo)`.
- `getMessage(id)` carrega a mensagem específica para navegação a partir da busca.
- `getConversationAnnotations(id, page, limit)` e `createAnnotation(id, texto)`.
- `getContacts(page, limit)` e `createContact({ telefone, nome, email })`.
- `getLabels()`, `getConversationLabels(id)` e `addConversationLabel(id, etiquetaId)`.

Todas as funções rejeitam com `ApiError` em falhas HTTP; o `message` contém a mensagem apropriada para exibição na interface e `status` mantém o status HTTP original.

Na página de conversas, a busca consulta `GET /api/busca/conversas` e exibe resultados de contatos/conversas e mensagens. Ao selecionar uma conversa, o chat é aberto; ao selecionar uma mensagem, a conversa é aberta, a mensagem é carregada caso esteja fora da página atual e o elemento recebe destaque com rolagem suave.
