-- Presupuesto anual: un borrador por estudio y año (se guarda solo) y las versiones con nombre (foto de supuestos, costos y notas), una de ellas «oficial».
-- RLS por estudio (mi_estudio()), como annual_targets; sin acceso para anon.
create table if not exists public.presupuestos (
  id uuid primary key default gen_random_uuid(),
  estudio_id text not null default coalesce(mi_estudio(), 'lea'),
  anio integer not null,
  tipo text not null check (tipo in ('borrador', 'version')),
  nombre text,
  nota text,
  estado jsonb not null,
  resumen jsonb,
  oficial boolean not null default false,
  creado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint presupuestos_oficial_solo_version check (not oficial or tipo = 'version')
);
create unique index if not exists presupuestos_borrador_uq on public.presupuestos (estudio_id, anio) where tipo = 'borrador';
create unique index if not exists presupuestos_oficial_uq on public.presupuestos (estudio_id, anio) where oficial;
create index if not exists presupuestos_anio_idx on public.presupuestos (estudio_id, anio, created_at desc);

grant all on table public.presupuestos to authenticated, service_role;
revoke all on table public.presupuestos from anon;
alter table public.presupuestos enable row level security;
drop policy if exists team_all on public.presupuestos;
create policy team_all on public.presupuestos for all to authenticated
  using ((estudio_id is null) or (estudio_id = mi_estudio()))
  with check ((estudio_id is null) or (estudio_id = mi_estudio()));
notify pgrst, 'reload schema';
