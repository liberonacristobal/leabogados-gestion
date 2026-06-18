# Fase 2 — Motor de conciliación (especificación completa y endurecida)

> **Para Claude Code.** Esta fase mueve plata: una conciliación mal hecha ensucia la
> contabilidad del estudio. Audita lo ya construido contra CADA punto de este documento y
> completa lo que falte. Por cada ítem, repórtame ✓ cumple / ✗ no cumple, con evidencia
> (archivo:línea). Donde no cumpla, corrige. Donde se pueda, escribe pruebas automatizadas
> para los casos de la sección 8. **No avances a Fase 3** hasta que: (a) todas las
> invariantes (sección 7) se cumplan, (b) todos los casos TC-01..TC-25 pasen, (c) yo
> confirme los números con una cartola/lote real. Trabaja modular y muéstrame el plan antes
> de tocar nada. Este documento reemplaza al cross-check y sus addendums anteriores.

---

## 1. Objetivo y contexto

Conciliar las **transferencias entrantes de clientes** contra las **facturas por cobrar** y
los **fondos de gastos** de la app. Recordatorios del diseño ya acordado:

- Los **candidatos a conciliación son los abonos de clientes de AMBAS cuentas** (honorarios
  01-40383-4 y gastos 01-38392-2), porque los honorarios a veces entran en la cuenta de gastos.
- Los **traspasos internos** (`es_interno`) NO se concilian: son plomería de saldo, contarlos
  duplica. El pago real es el abono con RUT de cliente, caiga en la cuenta que caiga.
- Conciliación **por saldo, no por igualdad de montos**.

---

## 2. Modelo mental (sin ambigüedad)

- Un **abono** tiene `monto` y `monto_conciliado` (cuánto ya se asignó). Estado: `pendiente`
  (0 asignado), `parcial` (algo, pero queda), `conciliado` (asignado completo), `interno`.
- Una **factura** tiene **saldo pendiente** = monto original − aplicado.
- La tabla `conciliacion` es el puente: cada fila dice "del abono X apliqué $Y a la
  factura/gasto/fondo Z". Un abono puede tener varias filas; una factura puede recibir varias.
- **Dos ejes independientes:** un abono puede quedar `conciliado` (se usó completo) aunque la
  factura quede `parcial` (le falta), y viceversa. No confundirlos.

---

## 3. Resolución del cliente (el RUT que paga NO siempre es el del cliente)

Orden de resolución para cada abono:
1. RUT del abono **==** RUT de un cliente → ese cliente.
2. RUT del abono encontrado en `cliente_alias` → el cliente mapeado.
3. Si no → **"sin identificar"**.

Casos reales que esto cubre:
- **Persona natural paga la factura de su sociedad** (RUT personal ≠ RUT de la empresa facturada).
- **Sociedad relacionada paga por otra** (holdings, inversiones del mismo grupo).

Mecanismo de alias:
- Un abono "sin identificar" ofrece la acción **"Asociar este RUT a un cliente"** → crea fila
  en `cliente_alias` (`rut_pagador` → `cliente_id`), guardando también `nombre_pagador` del banco.
- Al crear el alias, **re-evaluar de inmediato ese abono y TODOS los abonos pasados y futuros**
  con ese mismo RUT pagador.

Reglas de seguridad del alias:
- Un `rut_pagador` mapea a **un solo** cliente (unique). Reasignarlo a otro **avisa y pide
  confirmación**; nunca cambia en silencio.
- El RUT propio `77.700.387-9` **nunca** se mapea como cliente: es interno.
- Resolver por alias cambia QUIÉN es el cliente, **no** relaja el cruce: las facturas
  candidatas siguen siendo solo las del cliente resuelto (ver INV-12).
- En pantalla mostrar SIEMPRE **ambos datos**: nombre/RUT que vino del banco Y el cliente al
  que se resolvió, para detectar un alias mal hecho.

---

## 4. Clasificación AUTO vs CONFIRMAR (especificación exacta)

### Se AUTO-aplica solo si se cumplen TODAS:
1. El movimiento es un **abono**, no interno.
2. El cliente fue resuelto **por RUT** (directo o alias por RUT), no por nombre.
3. Existe **exactamente UNA** factura por cobrar del cliente con **saldo == monto** del abono.
4. **No hay otra** factura del cliente con saldo == monto (sin empates).
5. **No hay otros abonos pendientes** del mismo cliente que también calcen con esa factura.

Cumpliéndose todo → aplica el total, factura a pagada, `origen='auto'`. **Ante la menor duda,
NO auto: va a CONFIRMAR.** Mantener un contador visible: auto-aplicados vs a confirmar.

### Va a CONFIRMAR (bandeja), con sugerencia rankeada, en todos los demás casos:
- **Parcial:** `monto < saldo` de la única factura candidata.
- **Acumulado:** `monto` + otros abonos pendientes del cliente suman el saldo de una factura.
- **Sobrepago / fondo:** `monto >` saldo de toda factura, o sin facturas → "fondo de gastos",
  o "paga factura X (saldo S) + resto (monto−S) a fondo".
- **Múltiples candidatos:** varias facturas con saldo == monto → lista para elegir.
- **Cliente solo por nombre o sin RUT:** identificar primero (crear alias). No aplicar nada.

La bandeja **propone**; **nada se escribe en la base hasta que yo confirmo**.

---

## 5. División de un abono en varios destinos (caso frecuente)

Un cliente paga más que una factura porque en la misma transferencia **también abona gastos**,
o **paga dos o más facturas de una vez**. Por eso:

- Un mismo abono debe poder **dividirse libremente en N partes** sobre varios destinos
  (una o varias facturas + fondo de gastos), no solo "factura + un resto".
- La suma de las partes **nunca** supera el monto del abono. Lo no asignado queda **pendiente**
  (no se pierde), y el abono queda `parcial`.
- La división completa se aplica en **una sola transacción**: todas las partes juntas o ninguna.

En la UI de confirmación:
- Asignar montos a **varias facturas** del cliente y/o a **fondo**, en una sola pantalla.
- Contador en vivo: "asignado X de Y — quedan Z por asignar". No deja confirmar si la suma
  supera el monto.
- Si queda un resto, ofrecer mandarlo a **fondo** o dejarlo **pendiente** (avisar, no obligar
  a cuadrar a cero).
- Previsualización del saldo resultante de cada factura tocada, antes de confirmar.

---

## 6. Honorarios pagados en la cuenta de GASTOS

- Un abono de cliente que cae en la cuenta de gastos (`rol_cuenta='gastos'`) es **conciliable
  igual** contra facturas de honorarios: la cuenta es metadato, no un filtro.
- Marcar/filtrar esos abonos como "honorario caído en cuenta de gastos" (son los que suelen
  gatillar el traspaso interno).
- El traspaso interno asociado (`es_interno`) **no** se cuenta como pago.

---

## 7. Invariantes — NUNCA se pueden violar

- **INV-1.** La suma de todas las partes aplicadas de un abono nunca supera su `monto`
  (validar la suma TOTAL de la división antes de escribir).
- **INV-2.** La suma de `monto_aplicado` sobre una factura nunca excede su saldo original.
- **INV-3.** Para un abono: `monto_conciliado` == suma de `monto_aplicado` de sus filas.
- **INV-4.** `estado` del abono se DERIVA de los montos (0→pendiente; parcial; ==monto→conciliado).
- **INV-5.** Un `es_interno=true` nunca genera filas en `conciliacion` ni es candidato.
- **INV-6.** Cada fila apunta a un solo destino coherente con `tipo_destino` (factura XOR gasto XOR fondo).
- **INV-7.** `monto_aplicado > 0` siempre.
- **INV-8. (Reversibilidad)** Aplicar y deshacer es simétrico: round-trip exacto.
- **INV-9. (Idempotencia)** Re-importar la misma cartola no crea ni altera nada (dedup por hash).
- **INV-10. (Atomicidad)** Aplicar (incluida una división de N partes) es una transacción: todo o nada.
- **INV-11.** Todo CLP **entero**. Sin floats ni redondeos.
- **INV-12.** Un abono solo se aplica a facturas del **mismo cliente** resuelto. Nunca cruza clientes.
- **INV-13. (Cuadre global)** Para clientes: suma(aplicado a facturas) + suma(aplicado a fondos)
  + suma(pendiente sin aplicar) == suma(montos de abonos de clientes no internos).

Entrega una consulta que verifique INV-1, INV-2, INV-3 e INV-13 sobre los datos actuales y dame el resultado.

---

## 8. Casos de prueba (montos en CLP, resultado esperado exacto)

| # | Setup | Acción | Resultado esperado |
|---|-------|--------|--------------------|
| **TC-01** | Cliente A (por RUT), 1 factura saldo 1.000.000 | Abono 1.000.000 | **AUTO.** Factura→pagada. Abono→conciliado. 1 fila (factura, origen 'auto'). |
| **TC-02** | Cliente B, 2 facturas saldo 500.000 c/u | Abono 500.000 | **NO auto.** Bandeja: elegir cuál factura. Nada escrito. |
| **TC-03** | Cliente C, 1 factura saldo 1.200.000 | Abono 400.000 | Confirmar→parcial. Factura→800.000. Abono→conciliado. 1 fila 400.000. |
| **TC-04** | Cliente D, factura saldo 1.000.000; abono1 600.000 pendiente | Llega abono2 400.000 | Confirmar→acumulado. Factura→pagada. Ambos abonos conciliados. 2 filas. |
| **TC-05** | Cliente E, factura saldo 300.000 | Abono 500.000 | Confirmar→factura 300.000 + fondo 200.000. Factura→pagada. Abono→conciliado. 2 filas. |
| **TC-06** | Cliente F, 0 facturas | Abono 250.000 | Confirmar→fondo. 1 fila fondo 250.000. Abono→conciliado. |
| **TC-07** | Cliente G, factura saldo 700.000; abono cae en cuenta GASTOS | Abono 700.000 | Conciliable igual. AUTO si calce exacto. Marcado "honorario en cuenta de gastos". |
| **TC-08** | Movimiento `es_interno` 700.000 | — | Estado 'interno'. No candidato. 0 filas. |
| **TC-09** | Abono con `rut_contraparte`=77.700.387-9 | — | `es_interno=true`. Como TC-08. |
| **TC-10** | Abono de RUT no mapeado | — | "Sin identificar". No aplica. Ofrece crear alias. Tras alias→re-evalúa. |
| **TC-11** | Abono ya conciliado (TC-01) | Aplicarlo otra vez | Rechazado. No supera monto. Sin fila duplicada. (INV-1) |
| **TC-12** | TC-01 aplicado | Deshacer | Factura→1.000.000 por cobrar. Abono→pendiente, 0. Fila eliminada. Idéntico al previo. (INV-8) |
| **TC-13** | Cartola ya importada | Re-subir mismo archivo | 0 movimientos nuevos. Conciliaciones intactas. (INV-9) |
| **TC-14** | Aplicación que falla a mitad | — | Rollback total. Nada a medias. (INV-10) |
| **TC-15** | Abono de Cliente A con monto == saldo de factura de Cliente B | — | Esa factura no se ofrece. Solo del mismo cliente. (INV-12) |
| **TC-16** | Montos sin decimales | Sumas/restas | Todo CLP entero, sin floats. (INV-11) |
| **TC-17** | Cliente, factura saldo 300.000 | Abono 500.000 dividido: 300.000 factura + 200.000 fondo | Factura→pagada. Abono→conciliado. 2 filas. |
| **TC-18** | Cliente, 2 facturas saldo 200.000 y 150.000 | Abono 500.000: 200.000 + 150.000 + 150.000 fondo | Ambas facturas→pagadas. Abono→conciliado. 3 filas. |
| **TC-19** | Cliente, factura saldo 300.000 | Abono 500.000; asigno 300.000 a factura, dejo 200.000 SIN asignar | Factura→pagada. Abono→**parcial** (300.000). Quedan 200.000 visibles para asignar después. |
| **TC-20** | Cliente, factura saldo 300.000 | Dividir 300.000 + 250.000 (suma 550.000 > 500.000) | Rechazado. Suma de partes no supera el monto. (INV-1) |
| **TC-21** | "Sociedad X" (RUT 76.xxx). Abono con RUT personal 15.xxx no mapeado | — | "Sin identificar". Ofrece asociar 15.xxx → Sociedad X. |
| **TC-22** | Tras crear alias de TC-21 | Mismo y otros abonos con RUT 15.xxx | Todos se re-asocian a Sociedad X (pasados y futuros). Entran a conciliación. |
| **TC-23** | RUT 15.xxx ya mapeado a Sociedad X | Intentar mapearlo a Sociedad Y | Avisa conflicto, pide confirmación. No cambia en silencio. |
| **TC-24** | Abono de RUT personal mapeado a Sociedad X; X tiene 2 facturas | — | Se ofrecen SOLO facturas de Sociedad X. No cruza. (INV-12) |
| **TC-25** | Abono con RUT propio 77.700.387-9 | — | Interno; nunca ofrece crear alias de cliente. |

Reporta tabla TC-01..TC-25 → PASA/FALLA con detalle de cualquier falla.

---

## 9. Integridad en base de datos (recomendado)

- **Constraints** (dame el SQL para correr a mano si las agregas): `monto_aplicado > 0`;
  `tipo_destino in ('factura','gasto','fondo')`; coherencia destino (factura⇒factura_id not
  null & gasto_id null; etc.).
- **Aplicación atómica vía RPC de Postgres** (en vez de 3 escrituras sueltas desde el front),
  que **re-verifique el saldo dentro de la transacción** antes de aplicar (evita carreras,
  doble clic, dos pestañas). Para una división de N partes, una sola llamada que recibe la
  lista de partes y valida la suma total contra el monto del abono antes de escribir nada.
  Esqueleto a adaptar a tus tablas reales:

```sql
-- adaptar nombres de factura/saldo a tu esquema real
create or replace function aplicar_conciliacion(
  p_movimiento uuid, p_partes jsonb, p_origen text
) returns void language plpgsql as $$
declare v_monto bigint; v_conc bigint; v_suma bigint;
begin
  select monto, monto_conciliado into v_monto, v_conc
    from cartola_movimientos where id = p_movimiento for update;
  select coalesce(sum((x->>'monto')::bigint),0) into v_suma
    from jsonb_array_elements(p_partes) x;
  if v_conc + v_suma > v_monto then
    raise exception 'Sobre-aplicación del abono'; end if;          -- INV-1
  -- por cada parte: validar saldo de factura (for update), descontar, insertar fila
  -- (recorrer p_partes; INV-2 por factura)
  update cartola_movimientos
     set monto_conciliado = v_conc + v_suma,
         estado = case when v_conc + v_suma >= v_monto then 'conciliado'
                       when v_conc + v_suma > 0 then 'parcial' else 'pendiente' end
   where id = p_movimiento;
end $$;
```

- Una función gemela `deshacer_conciliacion(p_conciliacion uuid)` que revierta todo en una
  transacción (elimina fila, devuelve saldo, recalcula estado del abono).

---

## 10. Reversibilidad (deshacer)

- Cada conciliación (auto o manual) tiene botón **Deshacer** en la UI.
- Deshacer revierte: elimina fila(s), devuelve saldo a factura/gasto/fondo, recalcula
  `monto_conciliado` y `estado` del abono, y **vuelve a proponer** ese abono.
- Probar round-trip: aplicar → deshacer → estado idéntico al previo (INV-8).

---

## 11. Trazabilidad / auditoría

- Detalle **por factura**: qué abonos la pagaron, cuándo, monto, y si fue 'auto' o 'manual'.
- Detalle **por abono**: a qué facturas/fondos se aplicó y cuánto quedó sin aplicar.
- Cada fila ya guarda `origen` y `created_at`. Más auditoría (quién/cuándo deshizo) solo si
  no agrega complejidad innecesaria.

---

## 12. Bandeja de confirmación — qué DEBE mostrar

Por cada abono a confirmar:
- Nombre/RUT **del banco** Y cliente **resuelto** (ambos), + monto + fecha + cuenta/rol.
- Facturas candidatas del cliente con su saldo actual.
- Sugerencia rankeada (parcial / acumulado / fondo / dividir / elegir) en una línea.
- Editor de **división en N partes** con contador "asignado X de Y, quedan Z".
- Previsualización del saldo resultante de cada factura antes de confirmar.
- Acciones: confirmar / mandar resto a fondo / dejar pendiente / ignorar.
- Los **auto-aplicados** también visibles, revisables y reversibles (lista aparte).

---

## 13. Compuerta de aceptación (gate a Fase 3)

No pasamos a Fase 3 hasta marcar TODO:

- [ ] Invariantes INV-1..INV-13 verificadas, con consulta de chequeo para las de datos.
- [ ] Casos TC-01..TC-25 todos PASAN (tabla de resultados).
- [ ] Aplicación atómica (RPC) con re-verificación de saldo dentro de la transacción, incl. división N partes.
- [ ] Deshacer simétrico probado (round-trip).
- [ ] Re-importación idempotente probada.
- [ ] Cuadre global (INV-13) exacto sobre datos reales.
- [ ] Auto-aplicado conservador, con contador auto vs confirmar visible.
- [ ] Resolución por alias funcionando (re-asocia pasados y futuros) con sus seguros.
- [ ] Trazabilidad por factura y por abono.
- [ ] Yo confirmé los números con una cartola/lote real.

---

## 14. Qué reportarme al terminar

1. Tabla de invariantes: ✓/✗ + evidencia (archivo:línea).
2. Tabla TC-01..TC-25: PASA/FALLA + detalle de fallas.
3. SQL para correr a mano (constraints, funciones RPC).
4. Archivos tocados y resumen de cambios.
5. Sobre datos reales: auto-aplicados, a confirmar, sin identificar, y resultado del cuadre global.
6. Tu recomendación: ¿listo para Fase 3, sí o no, y por qué?
