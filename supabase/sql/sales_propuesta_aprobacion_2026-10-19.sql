-- 2026-10-19: propuestas que arma un abogado (limitado) y aprueba un socio. Aplicada en prod.
alter table public.sales add column if not exists propuesta_de text;       -- nombre de quien la propuso (miembro)
alter table public.sales add column if not exists aprobacion text;         -- 'pendiente' | 'aprobada' | 'devuelta'
alter table public.sales add column if not exists aprobacion_at timestamptz;
alter table public.sales add column if not exists aprobacion_por text;
alter table public.sales add column if not exists aprobacion_nota text;
notify pgrst, 'reload schema';
