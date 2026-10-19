-- APLICADO en producción 2026-10-19 (migración honorarios_solo_admin_o_responsable).
-- Usuarios limitados: no ven honorarios (ventas, facturas, anticipos, comisiones), salvo los de las ventas de las que son
-- responsables (venta.responsible → abogado del cliente). Las facturas de reembolso de gastos se ven (son gastos).
-- Solo LECTURA (restrictive FOR SELECT). Edge functions con service_role no se ven afectadas.
-- Verificado: admins ven todo; Martín 6 ventas / 64 facturas (26 suyas + 38 reembolso) / 12 anticipos / 19 comisiones;
-- Martina y Rodrigo solo las 38 facturas de reembolso.
-- Para revertir: drop policy honorarios_por_rol on public.sales; (idem billing, anticipos, terceros_pagos).

create or replace function public._norm_nom(t text) returns text language sql immutable as
$$ select lower(translate(trim(coalesce(t,'')),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')) $$;

create or replace function public.es_admin_estudio() returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from public.miembros m where lower(m.email)=lower(auth.jwt()->>'email') and m.rol='admin') $$;

create or replace function public.mi_nombre() returns text language sql stable security definer set search_path=public as
$$ select m.nombre from public.miembros m where lower(m.email)=lower(auth.jwt()->>'email') limit 1 $$;

create or replace function public.venta_mia(p uuid) returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from public.sales s left join public.clients c on c.id=s.client_id
    where s.id=p and public._norm_nom(public.mi_nombre())<>''
      and public._norm_nom(coalesce(nullif(trim(s.responsible),''),c.abogado_responsable))=public._norm_nom(public.mi_nombre())) $$;

create or replace function public.cliente_mio(p uuid) returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from public.clients c where c.id=p and public._norm_nom(public.mi_nombre())<>''
      and public._norm_nom(c.abogado_responsable)=public._norm_nom(public.mi_nombre())) $$;

create or replace function public.factura_mia(p uuid) returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from public.billing b where b.id=p and (b.billing_type='reembolso'
      or (b.sale_id is not null and public.venta_mia(b.sale_id))
      or (b.sale_id is null and public.cliente_mio(b.client_id)))) $$;

grant execute on function public._norm_nom(text), public.es_admin_estudio(), public.mi_nombre(), public.venta_mia(uuid), public.cliente_mio(uuid), public.factura_mia(uuid) to authenticated, service_role;
revoke execute on function public.es_admin_estudio(), public.mi_nombre(), public.venta_mia(uuid), public.cliente_mio(uuid), public.factura_mia(uuid) from anon;

create policy honorarios_por_rol on public.sales as restrictive for select to authenticated
  using ((select public.es_admin_estudio()) or public.venta_mia(id));
create policy honorarios_por_rol on public.billing as restrictive for select to authenticated
  using ((select public.es_admin_estudio()) or billing_type='reembolso'
         or (sale_id is not null and public.venta_mia(sale_id)) or (sale_id is null and public.cliente_mio(client_id)));
create policy honorarios_por_rol on public.anticipos as restrictive for select to authenticated
  using ((select public.es_admin_estudio()) or (sale_id is not null and public.venta_mia(sale_id)) or (sale_id is null and public.cliente_mio(client_id)));
create policy honorarios_por_rol on public.terceros_pagos as restrictive for select to authenticated
  using ((select public.es_admin_estudio()) or (sale_id is not null and public.venta_mia(sale_id))
         or (sale_id is null and billing_id is not null and public.factura_mia(billing_id)));
notify pgrst, 'reload schema';
