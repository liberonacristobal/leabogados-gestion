-- Boletas de honorarios electrónicas RECIBIDAS por el estudio (informe mensual del SII, cargado desde Conciliación › Cargar).
-- Una fila por boleta (emisor + folio). Sirve para reconocer de qué es un cargo del banco (conservador, notaría, profesional) por monto y fecha.
-- Solo administradores: team_all por estudio + solo_admin RESTRICTIVE. Requiere public.mi_estudio() y public.es_admin_estudio().

CREATE TABLE IF NOT EXISTS public.sii_boletas_recibidas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estudio_id    text        NOT NULL DEFAULT public.mi_estudio(),
  folio         text        NOT NULL,
  fecha         date        NOT NULL,
  emisor_rut    text        NOT NULL,
  emisor_nombre text,
  estado        text,
  bruto         bigint      NOT NULL DEFAULT 0,
  retencion     bigint      NOT NULL DEFAULT 0,
  pagado        bigint      NOT NULL DEFAULT 0,
  periodo       text,
  movimiento_id uuid,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (estudio_id, emisor_rut, folio)
);
CREATE INDEX IF NOT EXISTS sii_boletas_recibidas_fecha_idx ON public.sii_boletas_recibidas (estudio_id, fecha);

GRANT ALL ON TABLE public.sii_boletas_recibidas TO authenticated, service_role;
REVOKE ALL ON TABLE public.sii_boletas_recibidas FROM anon;

ALTER TABLE public.sii_boletas_recibidas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_all ON public.sii_boletas_recibidas;
CREATE POLICY team_all ON public.sii_boletas_recibidas
  FOR ALL TO authenticated
  USING (estudio_id = public.mi_estudio())
  WITH CHECK (estudio_id = public.mi_estudio());

DROP POLICY IF EXISTS solo_admin ON public.sii_boletas_recibidas;
CREATE POLICY solo_admin ON public.sii_boletas_recibidas
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.es_admin_estudio()))
  WITH CHECK ((SELECT public.es_admin_estudio()));

NOTIFY pgrst, 'reload schema';
