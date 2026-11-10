-- APLICADO en producción (2026-11-10). Versionado aquí para que otro estudio pueda reproducirlo; es idempotente: correrlo de nuevo no cambia nada.
-- El Presupuesto es información financiera: solo los administradores del estudio leen y escriben `presupuestos` (borrador y versiones).
-- Política RESTRICTIVE: se suma (AND) a la política team_all existente, así un miembro «limited» no ve ninguna fila aunque team_all lo deje pasar.
-- Requiere la función public.es_admin_estudio() (supabase/sql/honorarios_por_rol_2026-10-19.sql).

ALTER TABLE public.presupuestos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS solo_admin ON public.presupuestos;
CREATE POLICY solo_admin ON public.presupuestos
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING ((SELECT public.es_admin_estudio()))
  WITH CHECK ((SELECT public.es_admin_estudio()));

NOTIFY pgrst, 'reload schema';

-- Prueba (como un miembro que NO es administrador, con su sesión): debe devolver 0 filas y fallar al insertar.
--   select count(*) from public.presupuestos;                                   -- 0
--   insert into public.presupuestos (anio, tipo, estado) values (2099,'borrador','{}'); -- error de política
