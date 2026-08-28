-- clientes_drive_sync — cola de "bajas pendientes" detectadas por el cron clientes-drive-sync.
-- Cuando una carpeta de cliente vinculada deja de estar bajo CLIENTES_ROOT (se movió a Terminados
-- o fuera), el cron encola aquí una fila 'pendiente'; un humano la confirma (Terminar) o descarta
-- en la app. El cron NUNCA cambia el status del cliente por sí solo.

CREATE TABLE IF NOT EXISTS clientes_drive_sync (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid REFERENCES clients(id) ON DELETE CASCADE,
  folder_id    text,
  folder_name  text,
  motivo       text,                                   -- 'movido_terminados' | 'movido_fuera'
  status       text NOT NULL DEFAULT 'pendiente',      -- 'pendiente' | 'aplicado' | 'descartado'
  detected_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz
);
CREATE INDEX IF NOT EXISTS clientes_drive_sync_status_idx ON clientes_drive_sync(status);

GRANT ALL ON TABLE clientes_drive_sync TO authenticated, service_role;
ALTER TABLE clientes_drive_sync ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_all ON clientes_drive_sync;
CREATE POLICY team_all ON clientes_drive_sync FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'email') LIKE '%@leabogados.cl')
  WITH CHECK ((auth.jwt() ->> 'email') LIKE '%@leabogados.cl');
NOTIFY pgrst, 'reload schema';

-- ── Agenda del cron ───────────────────────────────────────────────────────────────────────────
-- YA AGENDADO en producción (2026-08-28, cron.job jobid 7): 'clientes-drive-sync' cada 2h ('17 */2 * * *').
-- Reusa el CRON_SECRET compartido del proyecto (el mismo de cartera-semanal / horas-recordatorio) por
-- fallback en la fn → no hubo que crear ni exponer ningún secreto. Verificado: responde 200 y, con el
-- interruptor OFF, {"ok":true,"skipped":"apagado"} (no hace nada).
--
-- El interruptor vive en learnings(kind='config', key='clientes_drive_sync'); default 'off'. El cron
-- SALTA hasta que se ponga 'on' (toggle "Sincronización automática" del modal de Drive en la app).
-- Secuencia segura: 1) corrida MANUAL supervisada ("Sincronizar ahora"), revisar duplicados por nombre;
-- 2) recién ahí prender el toggle → el cron toma el relevo cada 2h.
--
-- Cómo se agendó (extrae el secreto server-side, no lo escribe a mano):
-- select cron.schedule('clientes-drive-sync', '17 */2 * * *', format(
--   $f$select net.http_post(url := 'https://kibuwhtpoxrnfowfdolu.supabase.co/functions/v1/clientes-drive-sync',
--     headers := '{"Content-Type":"application/json"}'::jsonb, body := jsonb_build_object('secret', %L));$f$,
--   (regexp_match((select command from cron.job where jobname='cartera-semanal-lunes'), '"secret":"([^"]+)"'))[1]));
