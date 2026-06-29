# Recordatorios de tareas (lunes · miércoles · viernes)

Edge function `task-reminders` (cron-only, gateada con `CRON_SECRET`). Por persona, junta sus tareas
**vencidas** + las que **vencen en los próximos 3 días** (la ventana de 3 días cubre el hueco viernes→lunes)
y le manda UN correo resumen. Si una persona no tiene nada, no recibe correo.

- Responsable = `delegated_to` si la tarea está delegada, si no `assignees`.
- Solo tareas con `status != 'Terminado'` y con `due`.
- Asunto en ASCII (igual que `notify-task`, para no llegar "con crush").

## Agendar el cron (Supabase → SQL Editor)

La función va SIN verify_jwt (protegida por `CRON_SECRET`), así que NO necesita anon key — solo el secreto.
`<CRON_SECRET>` = el mismo que ya usan los crons del SII. Para verlo: `select jobname, command from cron.job;`
y cópialo del body de un job existente. 12:00 UTC ≈ 8:00 Chile (9:00 en horario de verano).

```sql
select cron.schedule(
  'task-reminders-lmv',
  '0 12 * * 1,3,5',          -- min hora * * día-semana (1=lun, 3=mié, 5=vie)
  $$
  select net.http_post(
    url := 'https://kibuwhtpoxrnfowfdolu.supabase.co/functions/v1/task-reminders',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{"secret":"<CRON_SECRET>"}'::jsonb
  );
  $$
);
```

Para cambiar el horario: `select cron.unschedule('task-reminders-lmv');` y volver a agendar.
Ver agendados: `select * from cron.job;`

## Probar sin spamear (dryRun: calcula a quién le tocaría, NO envía)

```bash
curl -s -X POST 'https://kibuwhtpoxrnfowfdolu.supabase.co/functions/v1/task-reminders' \
  -H 'Content-Type: application/json' \
  -d '{"secret":"<CRON_SECRET>","dryRun":true}'
```

Devuelve `{ ok, dryRun:true, sent:[{name,to,vencidas,porVencer}], count }`.
Para un envío real de prueba: el mismo curl sin `"dryRun":true`.
