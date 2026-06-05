-- ═══════════════════════════════════════════════════════════════
-- LIBERONA ESCALA ABOGADOS — Schema Supabase
-- Ejecutar en: supabase.com → tu proyecto → SQL Editor → New query
-- ═══════════════════════════════════════════════════════════════

-- ─── EXTENSIONES ────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ─── CLIENTES ────────────────────────────────────────────────────
create table if not exists clients (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  type        text,
  email       text,
  phone       text,
  contact     text,
  erasmo      boolean default false,
  status      text not null default 'Activo',  -- 'Activo' | 'Terminado'
  ended_at    date,                            -- fecha en que terminó la relación
  notes       text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  constraint clients_status_check check (status in ('Activo','Terminado'))
);

-- ─── ASUNTOS ─────────────────────────────────────────────────────
create table if not exists matters (
  id          uuid primary key default uuid_generate_v4(),
  client_id   uuid references clients(id) on delete cascade,
  title       text not null,
  area        text,
  status      text default 'Activo',
  who         text default 'Cristóbal',
  priority    text default 'Media',
  due         date,
  note        text,
  source      text,   -- 'Gmail', 'Drive', 'Manual'
  thread_id   text,   -- ID del thread de Gmail si aplica
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ─── COBROS ──────────────────────────────────────────────────────
create table if not exists billing (
  id          uuid primary key default uuid_generate_v4(),
  client_id   uuid references clients(id) on delete cascade,
  matter_id   uuid references matters(id) on delete set null,
  concept     text not null,
  amount      bigint default 0,
  status      text default 'Pendiente',
  due         date,
  issued_at   date default current_date,
  invoice_no  text,
  erasmo      boolean default false,
  notes       text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ─── ENTIDADES FACTURABLES (razones sociales por cliente) ────────
create table if not exists client_entities (
  id          uuid primary key default uuid_generate_v4(),
  client_id   uuid not null references clients(id) on delete cascade,
  name        text not null,   -- razón social
  rut         text,
  notes       text,
  created_at  timestamptz default now()
);

-- Cobro puede asociarse a una entidad facturable concreta (opcional)
alter table billing
  add column if not exists entity_id uuid references client_entities(id) on delete set null;

-- ─── ACTIVIDAD / LOG ─────────────────────────────────────────────
create table if not exists activity_log (
  id          uuid primary key default uuid_generate_v4(),
  user_email  text,
  action      text,
  table_name  text,
  record_id   uuid,
  detail      text,
  created_at  timestamptz default now()
);

-- ─── UPDATED_AT AUTOMÁTICO ───────────────────────────────────────
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger clients_updated_at before update on clients
  for each row execute function update_updated_at();
create trigger matters_updated_at before update on matters
  for each row execute function update_updated_at();
create trigger billing_updated_at before update on billing
  for each row execute function update_updated_at();

-- ─── ROW LEVEL SECURITY (RLS) ────────────────────────────────────
-- Solo usuarios autenticados con email @leabogados.cl pueden leer/escribir
alter table clients  enable row level security;
alter table matters  enable row level security;
alter table billing  enable row level security;
alter table activity_log enable row level security;
alter table client_entities enable row level security;

create policy "Solo equipo LE" on clients
  for all using (auth.jwt() ->> 'email' like '%@leabogados.cl');
create policy "Solo equipo LE" on matters
  for all using (auth.jwt() ->> 'email' like '%@leabogados.cl');
create policy "Solo equipo LE" on billing
  for all using (auth.jwt() ->> 'email' like '%@leabogados.cl');
create policy "Solo equipo LE" on activity_log
  for all using (auth.jwt() ->> 'email' like '%@leabogados.cl');
create policy "Solo equipo LE" on client_entities
  for all using (auth.jwt() ->> 'email' like '%@leabogados.cl');

-- ─── ÍNDICES ─────────────────────────────────────────────────────
create index if not exists clients_status_idx    on clients(status);
create index if not exists matters_client_id_idx on matters(client_id);
create index if not exists matters_status_idx    on matters(status);
create index if not exists matters_due_idx       on matters(due);
create index if not exists billing_client_id_idx on billing(client_id);
create index if not exists billing_status_idx    on billing(status);
create index if not exists billing_due_idx       on billing(due);
create index if not exists billing_entity_id_idx on billing(entity_id);
create index if not exists client_entities_client_id_idx on client_entities(client_id);

-- ═══════════════════════════════════════════════════════════════
-- DATOS INICIALES — Clientes reales del estudio
-- ═══════════════════════════════════════════════════════════════
insert into clients (name, type, email, erasmo) values
  ('David Midgley & Carla Vega',         'Tributario Internacional',   'djmidgley7@gmail.com',          false),
  ('Ludipek / Juan Pablo Martínez',       'Corporativo',                'juanpablo.martinez@ludipek.com', false),
  ('Familia del Fierro Prohens',          'Sucesorio / Patrimonial',    'gabdelfie@gmail.com',            false),
  ('Tarragona SA / Holding Patagonia',    'Corporativo / Litigación',   'amolinari@tarragona.cl',         false),
  ('Pamela & Hugo Figueroa',              'Sucesorio / Litigación',     'psfiguer@uc.cl',                 false),
  ('MU Mercadito Urbano (Mi Market)',     'Corporativo / Tributario',   'benjamindelsante@mi-market.cl',  false),
  ('Comercial Aroha SpA (Happy Mom)',     'Corporativo / M&A',          'carla.i.vega@gmail.com',         true),
  ('VKH Ltda. (Schroeder y Hanke)',       'Tributario / Patrimonial',   'L.silva@vkh.cl',                 false),
  ('Bastro Ltda.',                        'Corporativo / Inmobiliario', 'Eduardo@bastro.cl',              true),
  ('Inversiones Génova SpA',             'Corporativo',                'pcostaros@outlook.com',          true),
  ('Andrés Errázuriz / AE Golf Venture', 'Corporativo / Deportivo',    'aep@errazurizconsultores.cl',    false),
  ('Bioelements Group SpA',              'Tributario',                 'drasilva@bhi.cl',                false),
  ('Barbara & Francisco Quezada',        'Tributario Internacional',   'byf@hotmail.be',                 true),
  ('Electrodata',                        'Corporativo',                'rjaramillo@edata.cl',            true);
