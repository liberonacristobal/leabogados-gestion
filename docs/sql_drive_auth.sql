-- Conexión permanente de Drive (plan B, sin llave de cuenta de servicio).
-- Guarda el refresh_token (una sola fila, id=1) que la edge function `drive` usa para
-- renovar el acceso. Correr una vez en Supabase → SQL Editor.
CREATE TABLE drive_auth (
  id            int primary key,
  refresh_token text,
  email         text,
  updated_at    timestamptz default now()
);
GRANT ALL ON TABLE drive_auth TO authenticated, service_role;
ALTER TABLE drive_auth ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_all ON drive_auth FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'email') LIKE '%@leabogados.cl')
  WITH CHECK ((auth.jwt() ->> 'email') LIKE '%@leabogados.cl');
NOTIFY pgrst, 'reload schema';
