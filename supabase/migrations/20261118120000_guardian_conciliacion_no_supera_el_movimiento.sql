-- Lo conciliado de un movimiento del banco nunca supera su monto. El guardián existente solo miraba caja chica + conciliación;
-- dos conciliaciones entre sí (el agente y una persona con la pantalla abierta) pasaban. Caso real: aseo de $276.000, 12-11-2026.
-- La segunda operación espera a la primera (bloqueo del movimiento) y ya ve lo que esta dejó.
create or replace function public._guard_mov_no_doble() returns trigger language plpgsql as $f$
declare mid uuid; mto numeric; conc numeric; pc numeric; nuevo numeric; viejo numeric;
  f text := 'FM999G999G999';
begin
  mid := new.movimiento_id;
  if mid is null then return new; end if;
  if tg_op='UPDATE' and new.movimiento_id is not distinct from old.movimiento_id then
    if tg_table_name='conciliacion' then nuevo := coalesce(new.monto_aplicado,0); viejo := coalesce(old.monto_aplicado,0);
    else nuevo := abs(coalesce(new.amount,0)); viejo := abs(coalesce(old.amount,0)); end if;
    if nuevo <= viejo then return new; end if;
  end if;
  perform 1 from cartola_movimientos where id = mid for update;
  select monto into mto from cartola_movimientos where id = mid;
  if not found then return new; end if;
  conc := coalesce((select sum(monto_aplicado) from conciliacion where movimiento_id = mid),0);
  pc := coalesce((select sum(abs(amount)) from petty_cash where movimiento_id = mid),0);
  if pc > 0 and conc + pc > coalesce(mto,0) + 1 then
    raise exception 'Esta transferencia ya está registrada: conciliada por $% y como caja chica por $% (el movimiento es de $%). No se puede contar dos veces; deshaz uno de los dos registros.',
      replace(to_char(round(conc),f),',','.'), replace(to_char(round(pc),f),',','.'), replace(to_char(round(coalesce(mto,0)),f),',','.')
      using errcode='23514';
  end if;
  if tg_table_name = 'conciliacion' and conc > abs(coalesce(mto,0)) + 1 then
    raise exception 'Este movimiento del banco ya está conciliado por $% (el movimiento es de $%). No se puede conciliar dos veces; actualiza la pantalla.',
      replace(to_char(round(conc - coalesce(new.monto_aplicado,0)),f),',','.'), replace(to_char(round(abs(coalesce(mto,0))),f),',','.')
      using errcode='23514';
  end if;
  return new;
end $f$;
