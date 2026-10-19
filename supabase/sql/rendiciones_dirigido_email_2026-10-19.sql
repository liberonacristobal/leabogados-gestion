-- 2026-10-19: el envío de rendiciones grababa dirigido_email (commit 47da3f6f, 24-06) pero la columna no existía: la base rechazaba la marca y la rendición quedaba como borrador aunque el correo saliera.
alter table public.rendiciones add column if not exists dirigido_email text;
notify pgrst, 'reload schema';
