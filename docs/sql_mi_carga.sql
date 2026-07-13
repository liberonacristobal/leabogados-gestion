-- "Mi carga": vacaciones por usuario + peso manual del proyecto (para ponderar la carga).
CREATE TABLE IF NOT EXISTS vacaciones (
  id uuid primary key default gen_random_uuid(),
  user_name text,
  desde date,
  hasta date,
  nota text,
  created_at timestamptz default now()
);
GRANT ALL ON TABLE vacaciones TO authenticated, service_role;
ALTER TABLE vacaciones ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_all ON vacaciones FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'email') LIKE '%@leabogados.cl')
  WITH CHECK ((auth.jwt() ->> 'email') LIKE '%@leabogados.cl');
-- Peso mixto: override manual del peso del proyecto (null = automático por estado).
ALTER TABLE proyectos_cartera ADD COLUMN IF NOT EXISTS peso text;
NOTIFY pgrst, 'reload schema';
