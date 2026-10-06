-- Mis Proyectos · Fase 2b (aplicado en prod 2026-10-05 vía MCP) — entregables + hitos. RLS estándar.
CREATE TABLE IF NOT EXISTS proyecto_entregables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proyecto_id uuid NOT NULL REFERENCES proyectos_cartera(id) ON DELETE CASCADE,
  texto text NOT NULL, hecho boolean DEFAULT false, orden int DEFAULT 0,
  estudio_id text DEFAULT COALESCE(mi_estudio(), 'lea'), created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS proyecto_hitos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proyecto_id uuid NOT NULL REFERENCES proyectos_cartera(id) ON DELETE CASCADE,
  titulo text NOT NULL, fecha date, hecho boolean DEFAULT false, responsable text,
  estudio_id text DEFAULT COALESCE(mi_estudio(), 'lea'), created_at timestamptz DEFAULT now()
);
GRANT ALL ON TABLE proyecto_entregables TO authenticated, service_role; REVOKE ALL ON TABLE proyecto_entregables FROM anon;
ALTER TABLE proyecto_entregables ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_all ON proyecto_entregables;
CREATE POLICY team_all ON proyecto_entregables FOR ALL TO authenticated USING ((auth.jwt() ->> 'email') LIKE '%@leabogados.cl') WITH CHECK ((auth.jwt() ->> 'email') LIKE '%@leabogados.cl');
GRANT ALL ON TABLE proyecto_hitos TO authenticated, service_role; REVOKE ALL ON TABLE proyecto_hitos FROM anon;
ALTER TABLE proyecto_hitos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_all ON proyecto_hitos;
CREATE POLICY team_all ON proyecto_hitos FOR ALL TO authenticated USING ((auth.jwt() ->> 'email') LIKE '%@leabogados.cl') WITH CHECK ((auth.jwt() ->> 'email') LIKE '%@leabogados.cl');
NOTIFY pgrst, 'reload schema';
