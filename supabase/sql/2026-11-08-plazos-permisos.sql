-- La tabla plazos (registro_plazos_v1, 06-11-2026) quedó sin permisos para el servidor y con permisos de más para anon: el calendario diario fallaba con 42501.
GRANT ALL ON TABLE public.plazos TO authenticated, service_role;
REVOKE ALL ON TABLE public.plazos FROM anon;
NOTIFY pgrst, 'reload schema';
