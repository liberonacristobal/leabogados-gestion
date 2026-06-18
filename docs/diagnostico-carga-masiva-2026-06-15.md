# Diagnóstico — Carga masiva de gastos del 15-06-2026

> Para revisar con **Martina** (realizó la carga). Generado el 18-06-2026.

## Resumen

Se detectaron **2 cargas masivas** del **15-06-2026** que ingresaron gastos **sin fecha** y, en el gasto, **sin autor** (`created_by` null — esto último es **intencional** del sistema: la masiva no se imputa a la caja chica de nadie; el autor de la carga sí queda en `bulk_imports.created_by`).

| Import (bulk_import_id) | Gastos **sin fecha** | Monto sin fecha |
|---|---|---|
| `23ef40ba-4484-442b-bbba-7371e0ee2ea5` | 27 | $953.405 |
| `5970d04b-dce0-4f4f-824a-028e18bc0b31` | 19 | $305.558 |
| **Total sin fecha** | **46** | **$1.258.963** |

En total, las dos cargas ingresaron **128 gastos** (notaría, CBR, Diario Oficial, Registro Civil, Otro). De esos, **46 quedaron sin fecha** y **47 son de Notaría** (ver listado abajo).

## Qué se verificó (en el código)

- **El sistema NO descartó filas por falta de fecha.** Las importó igual, con fecha en null, y solo las contó. Lo único que el importador omite son **duplicados** (misma combinación cliente+monto+fecha+concepto+OT, o una OT ya existente).
- **Conclusión:** el archivo original **no traía fecha** en esas 46 filas (no es que el sistema las haya perdido). → **Acción pendiente: buscar el Excel original con las fechas del gasto** para hacer el backfill.
- **Los gastos son reales** (trámites concretos de notaría/CBR/etc.), no basura → no corresponde borrarlos.
- Hoy cada gasto **descuenta el saldo de su cliente** (el cliente debe ese trámite). Eso es correcto salvo que un trámite ya esté saldado.

## Contenido completo del import (todas las categorías)

El archivo cargado el 15-06 (las dos importaciones) tenía **128 gastos por $6.792.280**:

| Categoría | N° | Total |
|---|---|---|
| Notaría | 47 | $3.879.000 |
| CBR (Conservador) | 59 | $1.924.262 |
| Diario Oficial | 9 | $464.777 |
| Registro Civil | 3 | $328.641 |
| Otro | 10 | $195.600 |
| **TOTAL** | **128** | **$6.792.280** |

Fuera de Notaría hay **81 gastos por $2.913.280** (la mayoría CBR). Casi todos los no-notaría figuran `liq_caja=true` (pagados desde caja chica). **Todos descuentan el saldo del cliente** → el criterio "Saldado" debe decidirse para el conjunto, no solo los 47 de notaría.

## Cruce con archivos de notaría (18-06) — ¿están pagados?

Se cruzaron los **47 gastos de Notaría** del import contra dos archivos en Downloads:
- `Notaria_por_pagar_con_OT.xlsx` (51 filas) = lo **pendiente de pagar** a la notaría.
- `Consolidado_Gastos_Notaria_Liberona_ Enriquecido v3.xlsx` (80 notaría) = consolidado enriquecido (con OT + fecha).

**Resultado (cruce aproximado por cliente + monto, porque el import entró SIN OT):**
- De los 47, solo **1** aparece en "por pagar": David Midgley · *Mandato Especial* · $10.000.
- Los clientes del import (Andro Sekul, Familia Schroder, Ivan Rivas, J.P. Martinez/Merello…) **casi no aparecen** en "por pagar" (solo 3 de 16 clientes).
- Contra el Consolidado v3, solo **2** líneas calzan por cliente+monto (aunque 7 clientes se comparten por nombre).

**Lectura:** es un **indicio fuerte de que estos 47 son un lote histórico ya pagado** (no están en la cola de pendientes a la notaría). **PERO no es confirmación gasto-por-gasto** — sin OT el cruce es por cliente+monto y no es fiable al 100%.

**Consecuencias para la reunión:**
1. El **Consolidado v3 NO es la versión enriquecida de este import** (solo 2 líneas coinciden) → **no sirve para rellenar las fechas** de estos 47. Hay que ubicar **el Excel original que usó Martina** para esta carga del 15-06.
2. Para confirmar "pagado" con certeza, lo ideal es que el archivo original traiga **OT**; con OT se cruza exacto contra "por pagar" y el ledger de la notaría (`LIBERONA ESCALA ABOGADOS.xlsx`).

## Preguntas para Martina

1. ¿Tiene el **Excel original** con las **fechas** de cada gasto? (para rellenar las 46 sin fecha).
2. ¿Estos gastos ya fueron **pagados/saldados** por los clientes, o son **deudas vigentes**?
3. ¿Los 47 de **Notaría** ya se **pagaron a la notaría** (María Soledad Lascar / Álvaro González), o están pendientes de liquidar?

## Próximos pasos (según respuestas)

- Si aparece el Excel con fechas → backfill de fecha (no cambia saldos).
- Si están saldados → marcarlos "Solo registro · no descuenta" (no inflan saldo).
- Si están vigentes → se dejan contando.
- Los 47 de Notaría pendientes → liquidar a la notaría desde Gastos → "Liquidar notaría".
- **Prevención:** agregar aviso en el preview de la carga masiva cuando una fila venga **sin fecha** (hoy entra en silencio).

## SQL para marcar "Saldado" (no descuenta saldo · reversible)

> Marca `excluye_saldo=true` → el gasto deja de descontar el saldo del cliente, queda a la vista en la sección "Saldados" y se puede **reponer** (botón Reponer en la app, o el UPDATE de "Reponer" de abajo). Elige UNA de las opciones según lo que confirmes con Martina.

```sql
-- 0) PREVIEW antes de marcar: cuántos y cuánto por categoría
select category, count(*) n, sum(amount) total
from expenses
where bulk_import_id in ('23ef40ba-4484-442b-bbba-7371e0ee2ea5','5970d04b-dce0-4f4f-824a-028e18bc0b31')
group by category order by total desc;

-- A) SOLO Notaría (47 · $3.879.000)
update expenses set excluye_saldo=true
where bulk_import_id in ('23ef40ba-4484-442b-bbba-7371e0ee2ea5','5970d04b-dce0-4f4f-824a-028e18bc0b31')
  and category='Notaria';

-- B) Notaría + CBR
update expenses set excluye_saldo=true
where bulk_import_id in ('23ef40ba-4484-442b-bbba-7371e0ee2ea5','5970d04b-dce0-4f4f-824a-028e18bc0b31')
  and category in ('Notaria','CBR');

-- C) TODO el import (128 · $6.792.280)
update expenses set excluye_saldo=true
where bulk_import_id in ('23ef40ba-4484-442b-bbba-7371e0ee2ea5','5970d04b-dce0-4f4f-824a-028e18bc0b31');

-- D) Categorías específicas (edita la lista)
update expenses set excluye_saldo=true
where bulk_import_id in ('23ef40ba-4484-442b-bbba-7371e0ee2ea5','5970d04b-dce0-4f4f-824a-028e18bc0b31')
  and category in ('Notaria','CBR','Diario Oficial','Registro Civil','Otro');

-- REPONER (deshacer): vuelve a contar todo lo marcado de estas cargas
update expenses set excluye_saldo=false
where bulk_import_id in ('23ef40ba-4484-442b-bbba-7371e0ee2ea5','5970d04b-dce0-4f4f-824a-028e18bc0b31');

-- (correr al final de cualquier UPDATE)
notify pgrst, 'reload schema';
```

## SQL de referencia (correr en Supabase)

```sql
-- Quién cargó cada import
select id, created_by, created_at, filename, row_count, status
from bulk_imports
where id in ('23ef40ba-4484-442b-bbba-7371e0ee2ea5','5970d04b-dce0-4f4f-824a-028e18bc0b31');

-- Desglose por categoría (incluye el conteo de Notaría)
select category, count(*) n, sum(amount) total
from expenses
where bulk_import_id in ('23ef40ba-4484-442b-bbba-7371e0ee2ea5','5970d04b-dce0-4f4f-824a-028e18bc0b31')
group by category order by n desc;
```

---

## Listado de gastos de NOTARÍA (47 · $3.879.000)

| Cliente | Concepto | Monto |
|---|---|---|
| Andro Sekul | Escritura constitución Longhorn SpA | $90.000 |
| Andro Sekul | Escritura de delegación facultades | $60.000 |
| Andro Sekul | Legalización Poder para Inapi | $10.000 |
| BM Soluciones | EP división — Maria Soledad Lascar | $370.000 |
| BM Soluciones | Escritura modificación BM Inversiones | $90.000 |
| Catherine Cordomi | EP modificación Hotelera — Maria Soledad Lascar | $100.000 |
| Daniel Abragan | EP Modificación DAH — Maria Soledad Lascar | $80.000 |
| David Midgley | Escritura de constitución Midgley CL — Maria Soledad Lascar | $90.000 |
| David Midgley | Certificación de documentos nacionales — Maria Soledad Lascar | $20.000 |
| David Midgley | Mandato Especial — Maria Soledad Lascar | $10.000 |
| Egon Buchwald | Mandato judicial notaría | $40.000 |
| Egon Buchwald | Revocación de mandato en notaría | $30.000 |
| Familia Schroder | Donación Irrevocable (Dinero) — Maria Soledad Lascar | $180.000 |
| Familia Schroder | Donación Irrevocable (Francisca) — Maria Soledad Lascar | $120.000 |
| Familia Schroder | Donación Irrevocable (Andrea) — Maria Soledad Lascar | $120.000 |
| Familia Schroder | Protocolización mandato Andrea — Maria Soledad Lascar | $50.000 |
| Familia Schroder | Copias legalizadas — Maria Soledad Lascar | $40.000 |
| Familia Schroder | Testamento — Maria Soledad Lascar | $40.000 |
| Familia Schroder | Autorización uso domicilio comercial — Maria Soledad Lascar | $10.000 |
| Geslog | Actuación migración | $15.000 |
| Ivan Rivas | Compraventa nuda propiedad y reserva — Álvaro González | $400.000 |
| Ivan Rivas | Compraventa Inmueble Ivan Rivas y Lilian Rivas — Álvaro González | $400.000 |
| Ivan Rivas | Novación - Cancelación de Finiquito — Álvaro González | $50.000 |
| Ivan Rivas | Anexo contrato arrendamiento, Lilian Rivas a Jardín | $20.000 |
| José Miguel Delgado | Autorización de uso — Maria Soledad Lascar | $5.000 |
| Juan Pablo Martinez | Escritura modificación Southernking — Álvaro González | $180.000 |
| Juan Pablo Martinez | Escritura constitución ECVC SpA — Álvaro González | $90.000 |
| Juan Pablo Martinez | Legalización de 2 pagarés en notaría — Álvaro González | $60.000 |
| Juan Pablo Martinez | Escritura Delegación de Facultades ECVC — Álvaro González | $60.000 |
| Juan Pablo Martinez | Modificación Empresa en un Día — Álvaro González | $30.000 |
| Juan Pablo Martinez | Autorización de uso de ECVC — Álvaro González | $10.000 |
| Juan Pablo Martinez | Autorización de cédulas de identidad — Álvaro González | $4.000 |
| Juan Pablo Merello | Escritura Modificación CMP SpA — Maria Soledad Lascar | $90.000 |
| Juan Pablo Merello | Escritura Modificación WOW Auto SpA — Maria Soledad Lascar | $90.000 |
| Juan Pablo Merello | Escritura Modificación Rocketcar — Maria Soledad Lascar | $90.000 |
| Juan Pablo Merello | Escritura de Constitución de Achiras SpA — Álvaro González | $90.000 |
| Juan Pablo Merello | Autorización de uso — Álvaro González | $5.000 |
| Pablo Liberona | Constitución Constructora El Cedro SpA — Álvaro González | $90.000 |
| Pablo Liberona | Legalización fotocopias Lydia Ávalos — Álvaro González | $10.000 |
| SSIAL | Escritura de dación en pago terreno notaría | $200.000 |
| SSIAL | Escritura de saneamiento notaría | $40.000 |
| TryCloud | Transformación a SpA | $90.000 |
| TryCloud | Protocolización acuerdo de migración | $40.000 |
| TryCloud | Acuerdo de migración sociedad | $25.000 |
| Vittorio Stacchetti | Escritura de saneamiento Notaría — Álvaro González | $85.000 |
| Vittorio Stacchetti | Protocolización declaración migración de sociedad | $40.000 |
| Vittorio Stacchetti | Migración en Notaría de la Dehesa | $20.000 |
| **TOTAL** | **47 gastos** | **$3.879.000** |
