-- Cuadre de cartolas contra BICE (auditoría 2026-10-13).
-- 1) cartola_cargas sabe de QUÉ cuenta es cada carga y con qué saldos: así la alerta detecta una cuenta que dejó de llegar
--    (la de gastos no viene en la carga diaria) y huecos intermedios (faltó la cartola del 29-09 → cargo $60.000 perdido).
alter table cartola_cargas add column if not exists cuenta text;
alter table cartola_cargas add column if not exists rol_cuenta text;
alter table cartola_cargas add column if not exists saldo_inicial numeric;
alter table cartola_cargas add column if not exists saldo_final numeric;
alter table cartola_cargas add column if not exists total_cargos numeric;
alter table cartola_cargas add column if not exists total_abonos numeric;
-- Las cargas diarias registradas hasta hoy son todas de la cuenta de honorarios (la de gastos solo entró a mano).
update cartola_cargas set cuenta='01-40383-4', rol_cuenta='honorarios' where origen='diaria' and cuenta is null;

-- 2) Traspasos entre las dos cuentas propias: interno SOLO si existe el movimiento ESPEJO en la otra cuenta
--    (mismo monto, tipo contrario, ±1 día) y la glosa es de las que BICE usa para traspasos propios.
--    Nunca por el RUT solo (BICE enmascara pagos de terceros con nuestro RUT). Idempotente; no toca lo ya conciliado.
create or replace function emparejar_traspasos_propios(desde date default current_date - 60)
returns integer language plpgsql as $$
declare n integer := 0; c record; aid uuid; usados uuid[] := '{}';
begin
  for c in
    select * from cartola_movimientos
    where tipo='cargo' and rol_cuenta in ('gastos','honorarios') and fecha>=desde
      and coalesce(monto_conciliado,0)=0 and estado in ('pendiente','interno')
      and (descripcion ~* 'cuentas propias' or (descripcion ~* 'CLIENTE Rut 77\.?700\.?387' and descripcion ~* 'BENEFICIARIO Rut 77\.?700\.?387'))
    order by fecha, monto
  loop
    select a.id into aid from cartola_movimientos a
    where a.tipo='abono' and a.cuenta<>c.cuenta and a.rol_cuenta in ('gastos','honorarios')
      and abs(a.monto)=abs(c.monto) and abs(a.fecha-c.fecha)<=1
      and coalesce(a.monto_conciliado,0)=0 and a.estado in ('pendiente','interno')
      and (a.descripcion ~* 'cuentas propias' or (a.descripcion ~* 'CLIENTE Rut 77\.?700\.?387' and a.descripcion ~* 'BENEFICIARIO Rut 77\.?700\.?387'))
      and not (a.id = any(usados))
    order by abs(a.fecha-c.fecha), a.fecha limit 1;
    if aid is null then continue; end if;
    usados := usados || aid;
    update cartola_movimientos set es_interno=true, estado='interno', cliente_id=null
      where id in (c.id, aid) and not (es_interno and estado='interno');
    n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function emparejar_traspasos_propios(date) to authenticated, service_role;
revoke execute on function emparejar_traspasos_propios(date) from anon;
notify pgrst, 'reload schema';
