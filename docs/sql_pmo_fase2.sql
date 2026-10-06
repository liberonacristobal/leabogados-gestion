-- PMO · Fase 2 — vínculo gasto→proyecto + bandeja de sugerencias del Agente (RLS estándar).
-- Correr en el SQL Editor de Supabase cuando lleguemos a la automatización gastos→hitos.

-- 1) Vínculo firme de un gasto a un proyecto (hoy expenses.project es texto; esto es el FK real).
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS proyecto_id uuid REFERENCES proyectos_cartera(id) ON DELETE SET NULL;

-- 2) Bandeja de sugerencias del Agente PMO (lo que "se refleja solo", con compuerta).
CREATE TABLE IF NOT EXISTS pmo_sugerencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proyecto_id uuid REFERENCES proyectos_cartera(id) ON DELETE CASCADE,
  origen text NOT NULL,              -- gasto | correo | calendario | drive | cobro | sii
  origen_id text,                    -- id del gasto/correo/evento/factura que la originó
  tipo text NOT NULL,                -- hito | documento | enganche | nota
  payload jsonb DEFAULT '{}'::jsonb, -- {concepto, monto, hito_sugerido, fecha, ...}
  estado text DEFAULT 'pendiente',   -- pendiente | aceptada | descartada
  created_at timestamptz DEFAULT now(),
  resolved_at timestamptz,
  estudio_id text DEFAULT COALESCE(mi_estudio(), 'lea')
);
GRANT ALL ON TABLE pmo_sugerencias TO authenticated, service_role; REVOKE ALL ON TABLE pmo_sugerencias FROM anon;
ALTER TABLE pmo_sugerencias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_all ON pmo_sugerencias;
CREATE POLICY team_all ON pmo_sugerencias FOR ALL TO authenticated USING ((auth.jwt() ->> 'email') LIKE '%@leabogados.cl') WITH CHECK ((auth.jwt() ->> 'email') LIKE '%@leabogados.cl');

NOTIFY pgrst, 'reload schema';
