# Conciliación — SQL de integridad (correr a mano en Supabase)

Basado en `prompt_fase2_completo.md` (secciones 7 y 9). Correr en el SQL Editor.

## 0. Columna requerida (correr SÍ o SÍ antes de conciliar)

`marco_pago` distingue, por fila, si esa conciliación fue la que marcó la factura como pagada (para revertir bien al deshacer). Sin ella, conciliar falla.

```sql
alter table conciliacion add column if not exists marco_pago boolean default false;
notify pgrst,'reload schema';
```

## A. Constraints (blindaje en la base)

```sql
-- INV-7: monto siempre positivo
alter table conciliacion add constraint chk_aplicado_pos check (monto_aplicado > 0) not valid;
-- INV-6: destino coherente (incluye 'anticipo', que usamos para saldo a favor)
alter table conciliacion add constraint chk_tipo_destino
  check (tipo_destino in ('factura','gasto','fondo','anticipo')) not valid;
alter table conciliacion add constraint chk_destino_coherente check (
  (tipo_destino='factura'  and factura_id  is not null) or
  (tipo_destino='anticipo' and anticipo_id is not null) or
  (tipo_destino in ('gasto','fondo'))
) not valid;
-- validar (si alguna falla, revisar datos antes de validar)
alter table conciliacion validate constraint chk_aplicado_pos;
alter table conciliacion validate constraint chk_tipo_destino;
alter table conciliacion validate constraint chk_destino_coherente;
notify pgrst,'reload schema';
```

## B. Chequeos de invariantes (correr DESPUÉS de conciliar; 0 filas = OK)

```sql
-- INV-3: monto_conciliado del abono == suma de monto_aplicado de sus filas
select m.id, m.monto_conciliado, coalesce(sum(c.monto_aplicado),0) suma
from cartola_movimientos m left join conciliacion c on c.movimiento_id=m.id
group by m.id, m.monto_conciliado
having m.monto_conciliado <> coalesce(sum(c.monto_aplicado),0);

-- INV-2: aplicado sobre una factura nunca excede su monto
select b.id, b.invoice_no, b.amount, sum(c.monto_aplicado) aplicado
from billing b join conciliacion c on c.factura_id=b.id
group by b.id, b.invoice_no, b.amount
having sum(c.monto_aplicado) > b.amount;

-- INV-1: ningún abono aplica más que su monto
select m.id, m.monto, sum(c.monto_aplicado) aplicado
from cartola_movimientos m join conciliacion c on c.movimiento_id=m.id
group by m.id, m.monto
having sum(c.monto_aplicado) > m.monto;
```

## C. Cuadre global (INV-13)

```sql
-- total_abonos debe ser igual a aplicado + pendiente
select
  sum(monto)                       as total_abonos,
  sum(monto_conciliado)            as aplicado,
  sum(monto - monto_conciliado)    as pendiente
from cartola_movimientos
where tipo='abono' and es_interno=false and cliente_id is not null;
```
