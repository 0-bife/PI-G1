# Relatórios, dashboard e alertas de atendimento

Todas as rotas abaixo exigem `Authorization: Bearer <token>` e retornam JSON.

## Relatório

`GET /api/relatorios/atendimentos?dataInicial=YYYY-MM-DD&dataFinal=YYYY-MM-DD&usuarioId=45`

`dataInicial` e `dataFinal` são obrigatórias; a data final é inclusiva. `usuarioId` é opcional para administradores. Atendentes sempre ficam limitados ao próprio usuário, mesmo que informem outro ID.

Cada item de `data` contém:

```json
{
  "id_usuario": 45,
  "nome": "Ana",
  "atendimentos_realizados": 12,
  "atendimentos_pendentes": 3,
  "tempo_medio_resposta_segundos": 42.5,
  "tempo_medio_atendimento_segundos": 600,
  "taxa_conclusao": 80,
  "sla": 75
}
```

O tempo médio de resposta usa a primeira mensagem do contato e a primeira resposta do atendente no atendimento. A taxa de conclusão e o SLA são percentuais; atendimentos sem `prazo_retorno` contam como dentro do SLA.

## Dashboard

`GET /api/dashboard/atendimentos?usuarioId=45`

Retorna `totais` e `ranking`. O ranking é ordenado pela quantidade de atendimentos realizados e inclui realizados, pendentes, taxa de conclusão e tempo médio de resposta. Administradores podem filtrar por atendente; atendentes recebem somente os próprios dados.

## Alertas

`GET /api/alertas/atendimentos?minutos=30`

Lista atendimentos abertos sem resposta quando a última mensagem é do contato (ou quando ainda não existe mensagem) há pelo menos o limite informado. `minutos` é opcional, inteiro entre 1 e 10080, e o padrão vem de `ATTENDANCE_ALERT_MINUTES` (30).
