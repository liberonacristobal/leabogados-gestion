-- Plazos y obligaciones (extraídos de contratos con IA, o agregados a mano). Correr una vez.
CREATE TABLE plazos (
  id          bigint generated always as identity primary key,
  client_id   text,
  titulo      text,
  descripcion text,
  tipo        text,                        -- plazo | obligación | hito
  fecha       date,
  estado      text default 'pendiente',    -- pendiente | cumplido
  fuente      text,                         -- nombre del documento de origen
  file_id     text,
  created_at  timestamptz default now()
);
GRANT ALL ON TABLE plazos TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE plazos_id_seq TO authenticated, service_role;
ALTER TABLE plazos ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_all ON plazos FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'email') LIKE '%@leabogados.cl')
  WITH CHECK ((auth.jwt() ->> 'email') LIKE '%@leabogados.cl');
NOTIFY pgrst, 'reload schema';
