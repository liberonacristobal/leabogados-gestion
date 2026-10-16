-- Aplicado en producción el 15-10-2026 (migración aprender_rs_al_conciliar + _fix).
-- Al conciliar un abono con un cliente, la app aprende sus razones sociales (client_entities) sin preguntar:
--  (a) si es una factura: el receptor de la factura (RUT al que se facturó);
--  (b) el RUT del pagador, solo si es empresa (RUT >= 50.000.000), no es el RUT propio del estudio ni de un miembro del equipo.
-- Nunca duplica: si ese RUT ya es razón social de cualquier cliente, no hace nada. Bitácora: clientes.rs_aprendida.
create or replace function public.aprender_rs_al_conciliar() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  mv record; cid uuid; v_internal boolean; v_new uuid;
  f_rut text; f_nom text; k text; cand record;
begin
  if new.movimiento_id is null then return new; end if;
  select * into mv from cartola_movimientos where id = new.movimiento_id;
  if not found or mv.tipo <> 'abono' or coalesce(mv.es_interno,false) then return new; end if;
  if new.factura_id is not null then
    select client_id, receptor_rut, receptor_name into cid, f_rut, f_nom from billing where id = new.factura_id;
  elsif new.gasto_id is not null then
    select client_id into cid from expenses where id = new.gasto_id;
  elsif new.anticipo_id is not null then
    select client_id into cid from anticipos where id = new.anticipo_id;
  end if;
  if cid is null then return new; end if;
  select coalesce(is_internal,false) into v_internal from clients where id = cid;
  if v_internal then return new; end if;
  for cand in
    select x.rut, x.nombre, x.origen from (
      select f_rut as rut, f_nom as nombre, 'factura'::text as origen
      union all
      select mv.rut_contraparte, mv.nombre_contraparte, 'pagador'::text
    ) x where x.rut is not null
  loop
    k := regexp_replace(upper(cand.rut), '[^0-9K]', '', 'g');
    continue when length(k) < 2 or k = '777003879';
    continue when cand.origen = 'pagador' and (left(k, length(k)-1))::bigint < 50000000;
    continue when exists (select 1 from client_entities where regexp_replace(upper(coalesce(rut,'')), '[^0-9K]', '', 'g') = k);
    continue when exists (select 1 from miembros where regexp_replace(upper(coalesce(rut,'')), '[^0-9K]', '', 'g') = k);
    insert into client_entities (client_id, name, rut, notes, estudio_id)
    values (cid, nullif(trim(cand.nombre),''), cand.rut,
            'Aprendida al conciliar el abono del ' || to_char(mv.fecha, 'DD-MM-YYYY') || ' (' || cand.origen || ')', mv.estudio_id)
    returning id into v_new;
    insert into activity_log (user_email, action, table_name, record_id, detail)
    values ('sistema', 'clientes.rs_aprendida', 'client_entities', v_new,
            json_build_object('name', cand.nombre, 'rut', cand.rut, 'client_id', cid, 'origen', cand.origen, 'movimiento_id', mv.id)::text);
  end loop;
  return new;
exception when others then
  raise warning 'aprender_rs_al_conciliar: %', sqlerrm;
  return new;
end $$;

drop trigger if exists conciliacion_aprende_rs on public.conciliacion;
create trigger conciliacion_aprende_rs after insert on public.conciliacion
for each row execute function public.aprender_rs_al_conciliar();
