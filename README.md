# PI-G1 - InAblink
Projeto Interdisciplinar ADS2 FatecID - Grupo 1 - Plataforma de WhatsApp Business

## Pequenas empresas utilizam o WhatsApp como principal meio de comunicação com clientes, porém possuem dificuldade para organizar atendimentos realizados por múltiplos funcionários. A plataforma proposta centraliza contatos, mensagens e atendimentos utilizando a API oficial do WhatsApp Business

## Backend

API inicial em Node.js, Express e MySQL na pasta [`backend`](backend/README.md). Consulte o guia para configurar o banco, executar a API e usar as rotas de contatos e etiquetas.

## Alerta global de atendimentos sem resposta

Após o login, o frontend consulta periodicamente a rota autenticada
`/api/alertas/atendimentos` e exibe um pop-up sobreposto à tela atual quando
existem atendimentos abertos cuja última mensagem veio do contato e está sem
resposta há mais tempo que o limite configurado.

O limite pode ser ajustado em **Configurações > Alertas de atendimento**, em
minutos, entre 1 e 10080 (7 dias). A preferência é salva no `localStorage` do
navegador e o valor padrão é 30 minutos. Os alertas são empilhados, com no
máximo quatro cards visíveis; quando houver mais atendimentos, um aviso
informará a quantidade restante. Cada alerta fechado reaparece após cinco
minutos e pode ser usado para abrir a tela de conversas.
