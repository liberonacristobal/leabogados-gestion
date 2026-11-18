-- estado y monto_conciliado de un movimiento del banco: fuente única en la base. Sube y baja según conciliaciones + caja chica;
-- no rebaja un movimiento respaldado por una rendición de notaría (esa no tiene fila de conciliación).
create or replace function public._sync_mov_conciliado(p_mid uuid) returns void language plpgsql as $f$
declare m record; s numeric; nuevo numeric; est text;
begin
  if p_mid is null then return; end if;
  select id, monto, estado, monto_conciliado, es_interno into m from cartola_movimientos where id = p_mid;
  if not found or coalesce(m.es_interno,false) or m.estado = 'interno' then return; end if;
  s := coalesce((select sum(monto_aplicado) from conciliacion where movimiento_id = p_mid),0)
     + coalesce((select sum(abs(amount)) from petty_cash where movimiento_id = p_mid),0);
  if s <= 0 then nuevo := 0; est := 'pendiente';
  else nuevo := least(s, m.monto); est := case when s >= m.monto then 'conciliado' else 'parcial' end;
  end if;
  if nuevo < coalesce(m.monto_conciliado,0) and exists (select 1 from rendiciones where movimiento_id = p_mid) then return; end if;
  if coalesce(m.monto_conciliado,0) <> nuevo or m.estado is distinct from est then
    update cartola_movimientos set monto_conciliado = nuevo, estado = est where id = p_mid;
  end if;
end $f$;

-- La caja chica también mantiene el movimiento (antes solo la conciliación).
create or replace function public.trg_petty_cash_sync_mov() returns trigger language plpgsql as $f$
begin
  if tg_op in ('INSERT','UPDATE') then perform public._sync_mov_conciliado(new.movimiento_id); end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.movimiento_id is distinct from new.movimiento_id) then
    perform public._sync_mov_conciliado(old.movimiento_id);
  end if;
  return null;
end $f$;
drop trigger if exists petty_cash_sync_mov on public.petty_cash;
create trigger petty_cash_sync_mov after insert or delete or update of movimiento_id, amount on public.petty_cash for each row execute function public.trg_petty_cash_sync_mov();
