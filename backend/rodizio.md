# Rodízio de atendentes

Ao abrir um novo atendimento, a API seleciona automaticamente um usuário com `ativo = TRUE` e `perfil = 'atendente'`. A seleção usa, nesta ordem:

1. menor quantidade de atribuições ativas;
2. menor data da última atribuição;
3. menor `id_usuario`.

A seleção e a criação da linha em `ATRIBUICAO` acontecem na mesma transação do atendimento. Usuários administradores e inativos nunca entram no rodízio. Se não houver atendente ativo, o atendimento é criado sem atribuição para permitir tratamento posterior.

O mesmo fluxo é executado quando uma mensagem recebida pelo webhook cria um novo atendimento. A atribuição existente é preservada quando o atendimento já está aberto.

## Visibilidade

- `GET /api/conversas`: atendentes veem somente conversas com atendimento aberto atribuído a eles; administradores veem todas.
- Os alertas em `GET /api/alertas/atendimentos` seguem a mesma regra de visibilidade.
- `ATTENDANCE_ALERT_MINUTES` define o limite padrão de minutos sem resposta; pode ser sobrescrito por `?minutos=` na consulta.
