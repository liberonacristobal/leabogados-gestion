-- Costos de Oficina (presupuesto editable de la firma).
-- Cada fila = un ítem (subcategoría) con su monto mensual actual. Soporta aumentos a mitad de año
-- guardando el monto anterior + desde qué mes rige el nuevo (monto_prev / desde). Multi-tenant: estudio_id.
-- Correr en el SQL Editor de Supabase.

create table if not exists costos_oficina (
  id          uuid primary key default gen_random_uuid(),
  estudio_id  text not null default coalesce(mi_estudio(),'lea'),
  categoria   text not null,                 -- una de las 9 categorías (CATS_OFICINA_NUEVAS)
  item        text not null,                 -- subcategoría / desglose
  monto       bigint not null default 0,     -- monto mensual actual (CLP, siempre positivo)
  es_ingreso  boolean not null default false,-- true = resta al costo (ej. subarriendo)
  desde       date,                          -- primer día del mes desde el que rige "monto" (para aumentos); null = siempre
  monto_prev  bigint,                        -- monto que regía antes de "desde"
  activo      boolean not null default true,
  orden       int default 0,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

grant all on table costos_oficina to authenticated, service_role;
alter table costos_oficina enable row level security;
drop policy if exists team_all on costos_oficina;
create policy team_all on costos_oficina for all to authenticated
  using ((auth.jwt() ->> 'email') like '%@leabogados.cl')
  with check ((auth.jwt() ->> 'email') like '%@leabogados.cl');

notify pgrst, 'reload schema';
