-- Registro de consumo de la IA (1-11-2026): una fila por llamada a Claude con sus tokens, para medir el gasto por función, vista y modelo.
-- Sin contenido de los mensajes: solo cuántos tokens, qué modelo, desde dónde y si falló (p. ej. tope de gasto alcanzado).
create table if not exists public.ia_uso (
  id bigint generated always as identity primary key,
  estudio_id text not null default 'lea',
  created_at timestamptz not null default now(),
  funcion text not null,
  origen text,
  modelo text not null,
  entrada integer not null default 0,
  salida integer not null default 0,
  cache_lectura integer not null default 0,
  cache_escritura integer not null default 0,
  pensamiento integer not null default 0,
  max_tokens integer,
  usuario text,
  ok boolean not null default true,
  error text
);
create index if not exists ia_uso_fecha_idx on public.ia_uso (created_at desc);
create index if not exists ia_uso_funcion_idx on public.ia_uso (funcion, created_at desc);

grant all on table public.ia_uso to authenticated, service_role;
revoke all on table public.ia_uso from anon;
alter table public.ia_uso enable row level security;
drop policy if exists team_all on public.ia_uso;
create policy team_all on public.ia_uso for all to authenticated
  using ((auth.jwt() ->> 'email') like '%@leabogados.cl') with check ((auth.jwt() ->> 'email') like '%@leabogados.cl');

-- Resumen por día (hora de Chile), función, origen y modelo. «salida» incluye los tokens de pensamiento.
create or replace view public.ia_uso_diario with (security_invoker = true) as
select (created_at at time zone 'America/Santiago')::date as dia, estudio_id, funcion, origen, modelo,
       count(*) as llamadas, count(*) filter (where not ok) as fallas,
       sum(entrada) as entrada, sum(salida) as salida, sum(cache_lectura) as cache_lectura, sum(pensamiento) as pensamiento
from public.ia_uso group by 1, 2, 3, 4, 5;
grant select on public.ia_uso_diario to authenticated, service_role;
revoke all on public.ia_uso_diario from anon;

notify pgrst, 'reload schema';
