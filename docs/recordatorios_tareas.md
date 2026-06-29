# Recordatorios de tareas (lunes · miércoles · viernes)

Edge function `task-reminders` (cron-only, gateada con `TASK_REMINDERS_SECRET`). Por persona, junta sus tareas
**vencidas** + las que **vencen en los próximos 3 días** (la ventana de 3 días cubre el hueco viernes→lunes)
y le manda UN correo resumen. Si una persona no tiene nada, no recibe correo.

- Responsable = `delegated_to` si está delegada; si no `assignees`; si no (tareas antiguas), `who`.
- Activa = `status != 'Terminado'` (se filtra en JS: el status NULL no pasa un `.neq` en SQL).
- Asunto en ASCII (igual que `notify-task`, para no llegar "con crush").
- Secreto dedicado: `TASK_REMINDERS_SECRET` (set como secret en Supabase). El valor NO se guarda en el repo.

## Paso 0 — permiso de lectura (una vez, SQL Editor)

La función lee `tasks` como `service_role`. Esa tabla quedó sin el GRANT a `service_role` (daba
`permission denied for table tasks`). Correr una vez:

```sql
GRANT ALL ON TABLE tasks TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
```

## Paso 1 — agendar el cron (SQL Editor)

Sin verify_jwt (protegida por el secreto), así que NO necesita anon key. Reemplaza `<TASK_REMINDERS_SECRET>`
por el valor del secreto. 12:00 UTC ≈ 8:00 Chile (9:00 en horario de verano).

```sql
select cron.schedule(
  'task-reminders-lmv',
  '0 12 * * 1,3,5',          -- min hora * * día-semana (1=lun, 3=mié, 5=vie)
  $$
  select net.http_post(
    url := 'https://kibuwhtpoxrnfowfdolu.supabase.co/functions/v1/task-reminders',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{"secret":"<TASK_REMINDERS_SECRET>"}'::jsonb
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
  -d '{"secret":"<TASK_REMINDERS_SECRET>","dryRun":true}'
```

Devuelve `{ ok, dryRun:true, sent:[...], count, escaneadas, conVencimiento, tareasError }`.
- `escaneadas` = tareas activas leídas. Si es 0 con `tareasError: "permission denied for table tasks"`, falta el Paso 0.
- Para un envío real de prueba: el mismo curl sin `"dryRun":true`.
