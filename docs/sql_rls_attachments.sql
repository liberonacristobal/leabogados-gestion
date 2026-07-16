-- Cerrar hueco de seguridad: 3 tablas quedaron con RLS APAGADO (advisor Supabase).
-- Con RLS off, cualquiera con la anon key (pública) puede leer/escribir esas filas.
-- Se les pone el estándar del proyecto (RLS ON + política team_all @leabogados.cl).
-- La app usa sesión autenticada @leabogados.cl → sigue funcionando; se bloquea anon.

-- task_attachments (adjuntos de tareas — tiene datos: links de Drive)
GRANT ALL ON TABLE public.task_attachments TO authenticated, service_role;
ALTER TABLE public.task_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_all ON public.task_attachments FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'email') LIKE '%@leabogados.cl')
  WITH CHECK ((auth.jwt() ->> 'email') LIKE '%@leabogados.cl');

-- terceros_attachments (adjuntos de pagos a terceros)
GRANT ALL ON TABLE public.terceros_attachments TO authenticated, service_role;
ALTER TABLE public.terceros_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_all ON public.terceros_attachments FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'email') LIKE '%@leabogados.cl')
  WITH CHECK ((auth.jwt() ->> 'email') LIKE '%@leabogados.cl');

-- activity_log (log legacy, vacío)
GRANT ALL ON TABLE public.activity_log TO authenticated, service_role;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_all ON public.activity_log FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'email') LIKE '%@leabogados.cl')
  WITH CHECK ((auth.jwt() ->> 'email') LIKE '%@leabogados.cl');

NOTIFY pgrst, 'reload schema';
