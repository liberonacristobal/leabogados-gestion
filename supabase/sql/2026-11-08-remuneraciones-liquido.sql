-- Líquido a pagar y salud adicional tal como vienen en cada liquidación (lectura del correo de la contadora).
alter table public.remuneraciones_tributables add column if not exists liquido numeric, add column if not exists salud_adicional numeric;
notify pgrst, 'reload schema';
