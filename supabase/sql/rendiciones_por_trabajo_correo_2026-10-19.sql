-- 2026-10-19: rendición por trabajo (fondos y saldo acotados al proyecto) y borrador/registro del correo.
alter table public.rendiciones add column if not exists por_trabajo boolean not null default false;
alter table public.rendiciones add column if not exists correo jsonb;
notify pgrst, 'reload schema';
