-- 2026-11-03 · Foto mensual de cartera y por pagar (edge function foto-mes).
-- Día 1 de cada mes, 11:00 UTC: guarda en learnings (kind foto_mes, key = mes que cierra) la cartera por cobrar, el vencido, los más de 60 días,
-- las comisiones por pagar y los gastos por cobrar a clientes. El Informe del mes compara las dos últimas fotos.
-- El secreto va por Vault ('@vault:cron_secret'), nunca escrito en el comando.
select cron.schedule(
  'foto-mes-dia-1',
  '0 11 1 * *',
  $$
  select public.lanzar_proceso(
    job := 'foto-mes-dia-1',
    url := 'https://kibuwhtpoxrnfowfdolu.supabase.co/functions/v1/foto-mes',
    body := '{"secret":"@vault:cron_secret"}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
