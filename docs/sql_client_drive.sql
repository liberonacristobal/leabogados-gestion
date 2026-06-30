-- Mapeo cliente → carpeta de Drive (pieza 2). La app la llena sola al auto-vincular
-- (nombre del cliente = nombre de la carpeta), o el usuario elige la carpeta. Correr una vez.
CREATE TABLE client_drive (
  client_id   text primary key,
  folder_id   text,
  folder_name text,
  updated_at  timestamptz default now()
);
GRANT ALL ON TABLE client_drive TO authenticated, service_role;
ALTER TABLE client_drive ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_all ON client_drive FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'email') LIKE '%@leabogados.cl')
  WITH CHECK ((auth.jwt() ->> 'email') LIKE '%@leabogados.cl');
NOTIFY pgrst, 'reload schema';
