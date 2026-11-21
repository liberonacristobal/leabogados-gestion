-- 2026-11-21 · Cron de la edge function cierre-mes, versionado (existía solo creado a mano en la consola).
-- Día 6 de cada mes, 12:00 UTC: correo a los socios con los pendientes del mes anterior.
-- El secreto va por Vault ('@vault:cron_secret'), nunca escrito en el comando. Si el trabajo ya existe, se reemplaza con el mismo nombre.
select cron.unschedule('cierre-mes-dia6') where exists (select 1 from cron.job where jobname = 'cierre-mes-dia6');
select cron.schedule(
  'cierre-mes-dia6',
  '0 12 6 * *',
  $$
  select public.lanzar_proceso(
    job := 'cierre-mes-dia6',
    url := 'https://kibuwhtpoxrnfowfdolu.supabase.co/functions/v1/cierre-mes',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{"secret":"@vault:cron_secret"}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
