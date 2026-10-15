-- Boletas de honorarios (2026-10-15). Aplicado vía migración `boletas_honorarios_bruto_retencion`.
-- Quien emite boleta: costo = bruto (terceros_pagos.monto); retención al F29; se le transfiere el líquido.
alter table proveedores add column if not exists documento text check (documento in ('boleta','factura'));
alter table terceros_pagos add column if not exists liquido numeric, add column if not exists retencion numeric, add column if not exists bhe_id uuid;
create table if not exists boletas_honorarios (
  id uuid primary key default gen_random_uuid(), estudio_id text default coalesce(mi_estudio(), 'lea'::text),
  proveedor_id uuid references proveedores(id) on delete set null, emisor_rut text not null, emisor_nombre text,
  folio integer not null, fecha date not null, bruto numeric not null, retencion numeric not null default 0, liquido numeric not null,
  tasa numeric, glosa text, estado text not null default 'vigente', storage_path text, movimiento_id uuid, created_by text,
  created_at timestamptz default now(), unique (emisor_rut, folio));
alter table terceros_pagos add constraint terceros_pagos_bhe_fk foreign key (bhe_id) references boletas_honorarios(id) on delete set null;
grant all on table boletas_honorarios to authenticated, service_role; revoke all on table boletas_honorarios from anon;
alter table boletas_honorarios enable row level security;
create policy team_all on boletas_honorarios for all to authenticated using ((auth.jwt() ->> 'email') like '%@leabogados.cl') with check ((auth.jwt() ->> 'email') like '%@leabogados.cl');
-- Bucket privado `documentos` (PDF de boletas en bhe/<rut>/BHE_<rut>_N<folio>.pdf), lectura/escritura solo @leabogados.cl.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types) values ('documentos','documentos',false,15728640,array['application/pdf','image/png','image/jpeg','application/xml','text/xml']) on conflict (id) do nothing;
create policy documentos_team_read on storage.objects for select to authenticated using (bucket_id='documentos' and (auth.jwt() ->> 'email') like '%@leabogados.cl');
create policy documentos_team_write on storage.objects for insert to authenticated with check (bucket_id='documentos' and (auth.jwt() ->> 'email') like '%@leabogados.cl');
notify pgrst, 'reload schema';
