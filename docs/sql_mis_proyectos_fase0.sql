-- Mis Proyectos · Fase 0 (aplicado en prod 2026-10-05 vía MCP)
-- Opt-in por abogado + tipología. Additivo, reversible. RLS estándar.

ALTER TABLE proyectos_cartera ADD COLUMN IF NOT EXISTS tipo text;        -- puntual | permanente | proyecto
ALTER TABLE proyectos_cartera ADD COLUMN IF NOT EXISTS template text;    -- reorg | sucesorio | compraventa | juicio | informe | null

CREATE TABLE IF NOT EXISTS proyecto_equipo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proyecto_id uuid NOT NULL REFERENCES proyectos_cartera(id) ON DELETE CASCADE,
  miembro text NOT NULL,                 -- inicial del miembro (CL/EE/MC/MP/RD)
  rol text DEFAULT 'apoyo',              -- responsable | apoyo | revisa | tramites
  estudio_id text DEFAULT COALESCE(mi_estudio(), 'lea'),
  created_at timestamptz DEFAULT now(),
  UNIQUE(proyecto_id, miembro)
);
CREATE TABLE IF NOT EXISTS proyecto_seguidores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proyecto_id uuid NOT NULL REFERENCES proyectos_cartera(id) ON DELETE CASCADE,
  miembro text NOT NULL,
  estudio_id text DEFAULT COALESCE(mi_estudio(), 'lea'),
  created_at timestamptz DEFAULT now(),
  UNIQUE(proyecto_id, miembro)
);

GRANT ALL ON TABLE proyecto_equipo TO authenticated, service_role; REVOKE ALL ON TABLE proyecto_equipo FROM anon;
ALTER TABLE proyecto_equipo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_all ON proyecto_equipo;
CREATE POLICY team_all ON proyecto_equipo FOR ALL TO authenticated USING ((auth.jwt() ->> 'email') LIKE '%@leabogados.cl') WITH CHECK ((auth.jwt() ->> 'email') LIKE '%@leabogados.cl');

GRANT ALL ON TABLE proyecto_seguidores TO authenticated, service_role; REVOKE ALL ON TABLE proyecto_seguidores FROM anon;
ALTER TABLE proyecto_seguidores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_all ON proyecto_seguidores;
CREATE POLICY team_all ON proyecto_seguidores FOR ALL TO authenticated USING ((auth.jwt() ->> 'email') LIKE '%@leabogados.cl') WITH CHECK ((auth.jwt() ->> 'email') LIKE '%@leabogados.cl');

NOTIFY pgrst, 'reload schema';

-- Backfill (soft defaults, cambiables por UI):
UPDATE proyectos_cartera pc SET tipo = CASE WHEN s.cobro_type='mensual' THEN 'permanente' ELSE 'proyecto' END
FROM sales s WHERE s.id::text = pc.sale_id AND pc.tipo IS NULL;
UPDATE proyectos_cartera SET tipo='proyecto' WHERE tipo IS NULL;

INSERT INTO proyecto_equipo (proyecto_id, miembro, rol)
SELECT id, responsable, 'responsable' FROM proyectos_cartera WHERE COALESCE(responsable,'')<>''
ON CONFLICT (proyecto_id, miembro) DO NOTHING;
INSERT INTO proyecto_seguidores (proyecto_id, miembro)
SELECT id, responsable FROM proyectos_cartera WHERE COALESCE(responsable,'')<>''
ON CONFLICT (proyecto_id, miembro) DO NOTHING;
