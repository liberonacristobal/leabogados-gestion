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

-- ── Agenda del cron (opcional, requiere extensiones pg_cron + pg_net) ─────────────────────────
-- El interruptor vive en learnings(kind='config', key='clientes_drive_sync'); default 'off'.
-- Recién cuando lo pongas en 'on' el cron aplicará (hasta entonces salta). Haz primero una corrida
-- MANUAL supervisada desde la app, revisa el resultado, y después activa el cron.
--
-- select cron.schedule('clientes-drive-sync', '17 */2 * * *', $$
--   select net.http_post(
--     url    := 'https://kibuwhtpoxrnfowfdolu.supabase.co/functions/v1/clientes-drive-sync',
--     headers:= '{"Content-Type":"application/json"}'::jsonb,
--     body   := json_build_object('secret', '<CLIENTES_DRIVE_SECRET>')::jsonb
--   );
-- $$);
