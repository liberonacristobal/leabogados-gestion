-- Índice de precedentes del Drive (Fase 2). Correr una vez en Supabase → SQL Editor.
-- Estándar RLS ON del proyecto: solo usuarios autenticados @leabogados.cl.
CREATE TABLE precedentes_index (
  id            bigint generated always as identity primary key,
  file_id       text unique not null,
  title         text,
  tipo          text,
  mime_type     text,
  modified_time timestamptz,
  usos          int default 0,
  updated_at    timestamptz default now()
);
GRANT ALL ON TABLE precedentes_index TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE precedentes_index_id_seq TO authenticated, service_role;
ALTER TABLE precedentes_index ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_all ON precedentes_index FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'email') LIKE '%@leabogados.cl')
  WITH CHECK ((auth.jwt() ->> 'email') LIKE '%@leabogados.cl');
NOTIFY pgrst, 'reload schema';
