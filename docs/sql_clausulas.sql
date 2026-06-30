-- Biblioteca de cláusulas (extraídas de tus documentos). Correr una vez en Supabase → SQL Editor.
-- Estándar RLS ON del proyecto: solo usuarios autenticados @leabogados.cl.
CREATE TABLE clausulas (
  id         bigint generated always as identity primary key,
  clave      text unique not null,   -- "categoria::titulo" en minúsculas, para deduplicar al re-extraer
  titulo     text,
  categoria  text,
  texto      text,
  fuente     text,                    -- nombre del documento de origen
  file_id    text,
  usos       int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
GRANT ALL ON TABLE clausulas TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE clausulas_id_seq TO authenticated, service_role;
ALTER TABLE clausulas ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_all ON clausulas FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'email') LIKE '%@leabogados.cl')
  WITH CHECK ((auth.jwt() ->> 'email') LIKE '%@leabogados.cl');
NOTIFY pgrst, 'reload schema';
