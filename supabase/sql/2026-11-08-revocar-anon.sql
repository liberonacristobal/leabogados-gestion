-- Permisos sobrantes de anon (REFERENCES, TRIGGER, TRUNCATE; ninguno permitía leer ni escribir): hallazgos «permiso_sin_sesion» del auditor.
-- circulares_consulta_texto queda con lectura pública a propósito (política lectura_publica).
REVOKE ALL ON TABLE public.boletin_tramites, public.boletines_vigilados, public.casos_division, public.opiniones_juridicas, public.plazos_catalogo, public.plazos_historial, public.v_plazos_panel FROM anon;
NOTIFY pgrst, 'reload schema';
