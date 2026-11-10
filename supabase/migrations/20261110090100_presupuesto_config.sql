-- APLICADO en producción (2026-11-10). Versionado aquí para que otro estudio pueda reproducirlo; es idempotente.
-- Configuración del Presupuesto por estudio: guarda SOLO las diferencias respecto de los valores por defecto del código (supabase/functions/_shared/presupuestoConfig.js).
-- Una fila por estudio. Solo administradores: team_all por estudio (qué filas son del estudio) + solo_admin RESTRICTIVE (quién puede tocarlas).
-- Requiere las funciones public.mi_estudio() y public.es_admin_estudio().

CREATE TABLE IF NOT EXISTS public.presupuesto_config (
  estudio_id text PRIMARY KEY,
  config     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON TABLE public.presupuesto_config TO authenticated, service_role;
REVOKE ALL ON TABLE public.presupuesto_config FROM anon;

ALTER TABLE public.presupuesto_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_all ON public.presupuesto_config;
CREATE POLICY team_all ON public.presupuesto_config
  FOR ALL
  TO authenticated
  USING (estudio_id = public.mi_estudio())
  WITH CHECK (estudio_id = public.mi_estudio());

DROP POLICY IF EXISTS solo_admin ON public.presupuesto_config;
CREATE POLICY solo_admin ON public.presupuesto_config
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING ((SELECT public.es_admin_estudio()))
  WITH CHECK ((SELECT public.es_admin_estudio()));

NOTIFY pgrst, 'reload schema';

-- Prueba (como un miembro que NO es administrador): select count(*) from public.presupuesto_config;  -- 0, y el upsert falla.
