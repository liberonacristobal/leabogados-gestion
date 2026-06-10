# Auditoría de la pestaña "Gastos" (Fondos y Gastos)

**Fecha:** 2026-06-10
**Alcance:** flujo completo de Gastos/Fondos en vista admin y limited. Componentes auditados en `src/App.jsx`:
`ExpensesView` (L2629), `GastosForm`, `FondoForm` (L2846), `CajaChicaView` (L380), `RendicionModal` (L2286), helper `saldoCajaChica` (L34), `ClientsViewLimited` (ficha, L135), `ClientFicha` (admin), panel "Gestión · Gastos y Caja Chica" del Dashboard, y `handleSaveExpense`/`handleDeleteExpense`.
**Método:** lectura directa del código. NO se modificó nada.

> Convención de severidad: **CRÍTICO** (muestra cifra incorrecta o causa pérdida/daño de datos hoy) · **MEJORA** (riesgo real o fricción importante, conviene corregir) · **MENOR** (pulido / deuda técnica).

---

## Resumen ejecutivo

- **No se detectaron errores de cálculo que muestren cifras incorrectas con los datos actuales.** Los montos se guardan con `parseInt(...)||0`, así que las sumas cuadran. El riesgo es de borde (un `amount` null/undefined heredado produciría `NaN` en los puntos que **no** usan `||0`).
- **El hallazgo de fondo es de CONSISTENCIA:** la fórmula "saldo del cliente = fondos − gastos" está **duplicada en ~6 lugares** con guardas distintas, y conviven **2 nociones de "saldo"** (saldo de caja del cliente vs. saldo de rendición) bajo la misma etiqueta. No hay un único helper `saldoCliente()` equivalente al que sí existe para caja chica.
- **Riesgo operativo:** la **liquidación de caja chica es irreversible** (no hay "Anular" como sí lo hay en la rendición al cliente), y **solo se puede liquidar abriendo el correo** ("Liquidar y enviar"). Ambas cosas pueden llevar a estados que el usuario no puede deshacer solo.
- **Pulido:** 5+ formateadores de dinero distintos, 3 formatos de fecha, plantilla de PDF triplicada, y un azul de selección (`#185FA5`) fuera de la paleta corporativa en Caja Chica.

### Tabla de hallazgos

| # | Hallazgo | Sección | Severidad |
|---|----------|---------|-----------|
| C1 | Fórmula "fondos − gastos" duplicada en ~6 lugares con guardas inconsistentes | Cálculos / Consistencia | MEJORA |
| C2 | Sumas sin `||0` → riesgo de NaN con `amount` null/undefined | Cálculos | MENOR |
| C3 | Dos nociones de "saldo" del cliente bajo la misma etiqueta | Cálculos / Consistencia | MEJORA |
| F1 | Liquidación de caja chica **irreversible** (no hay Anular) | Flujos | MEJORA |
| F2 | Solo se puede liquidar vía "Liquidar y enviar" (correo forzado) | Flujos | MEJORA |
| F3 | `GastosForm` "Guardar todo": fallo parcial silencioso (`console.error`) | Flujos | MEJORA |
| F4 | Liquidar marca gastos en loop sin atomicidad | Flujos | MENOR |
| F5 | Eliminar un gasto ya rendido deja la rendición descuadrada | Flujos | MENOR |
| K1 | `petty_cash.rendered_at` nunca se setea → indicador "(rendido)" muerto | Consistencia | MENOR |
| K2 | Azul de selección `#185FA5`/`#E6F1FB` fuera de paleta en Caja Chica | Consistencia | MEJORA |
| K3 | 5+ formateadores de dinero distintos (`fmt`, `fmtCLP`, `fmtN`…) | Consistencia | MENOR |
| K4 | 3 formatos de fecha conviviendo (`fmtDate`, ISO crudo, `fmtD`) | Consistencia | MENOR |
| K5 | `C.muted` (#8A8A8A) ≠ paleta CLAUDE.md (#537281); literales `#888` sueltos | Consistencia | MENOR |
| S1 | Plantilla HTML de PDF triplicada | Simplicidad | MEJORA |
| S2 | Flujos "Liquidar" y "Rendir" casi idénticos sin componente común | Simplicidad | MENOR |

---

## 1. Cálculos

### C1 — Fórmula "saldo = fondos − gastos" duplicada (sin fuente única) · **MEJORA**
La misma cuenta se reimplementa en al menos 6 puntos, cada uno con pequeñas diferencias (algunos con `||0`, otros no):

1. `ExpensesView.balances` (L2647–2656) + `saldo` (L2684) → **sin** `||0` (`m[id].fondos += e.amount`).
2. `ExpensesView` lista de clientes: `const sal=b.fondos-b.gastos` (L2741).
3. `FondoForm.balance` (L2856) → inline `b += e.type==='fondo'?e.amount:-e.amount`, **sin** `||0`.
4. `GastosForm.balance` (≈L2890) → idéntico inline al de FondoForm.
5. `ClientsViewLimited` ficha (L137–139) → `fondos`/`gastos`/`saldo`, **sin** `||0`.
6. `ClientFicha` (admin) → `saldoFondos = fondos − gastos`.

Contraste: para caja chica **sí** existe la fuente única `saldoCajaChica()` (L34–41). Para el saldo de cliente no.
**Recomendación:** crear un helper de módulo `saldoCliente(expenses, clientId)` con `||0`, y usarlo en los 6 lugares. Elimina divergencias y el riesgo de C2.

### C2 — Riesgo de NaN con datos vacíos/null · **MENOR**
Los reduce que **no** protegen `amount` propagan `NaN` si algún registro trae `amount` undefined (`0 + undefined === NaN`):
- `ExpensesView.balances` (L2651–2652), `FondoForm`/`GastosForm` balance (L2856 y ≈L2890), `ClientsViewLimited` (L137–138).
- Caja chica: total de pendientes `pendientes.reduce((a,e)=>a+e.amount,0)` (L603) y `totalSel` (L412) tampoco usan `||0`.
- `RendicionModal`: `fondosDisp`/`gastosYaRend` (L2293–2294) tampoco.

Hoy el riesgo es bajo porque al **insertar** se usa `amount: parseInt(...)||0` (`handleSaveExpense`, GastosForm L2897, FondoForm L2901). Pero `fmt(NaN)` devuelve "$0" (por `n||0` dentro de `fmt`, L19), así que un NaN se **ocultaría** mostrando $0 en vez de avisar. El helper `saldoCajaChica` ya hace bien `(e.amount||0)` (L38–39) — replicar ese criterio en todos lados.
**Recomendación:** `+(e.amount||0)` en todos los reduce de montos (queda resuelto si se adopta C1).

### C3 — Dos "saldos" distintos del cliente bajo la misma palabra · **MEJORA**
- En `ExpensesView` (cabecera y lista) "SALDO" = **fondos − TODOS los gastos** (L2684, L2741).
- En `RendicionModal` "Saldo actual" = **fondos − gastos YA rendidos** (`saldoActual = fondosDisp − gastosYaRend`, L2295), y "Saldo tras rendición" = `saldoActual − seleccionados` (L2306).

Ambas son correctas para su propósito (posición de caja vs. estado de rendición), pero un mismo cliente puede mostrar dos números "saldo" diferentes en dos pantallas, lo que confunde. La lógica de la rendición en sí es correcta y cuadra (los gastos seleccionados pasan a `client_rendered_at` y la próxima vez ya cuentan como "rendidos").
**Recomendación:** etiquetar explícitamente ("Saldo de fondos" vs "Pendiente de rendir") o mostrar ambos en la ficha para que el usuario entienda de dónde sale cada cifra (cifras auditables).

### ✓ Lo que está correcto
- **Totales cuadran con las filas:** el total de pendientes (L603) suma la misma lista mostrada; en los PDF, la suma de los subtotales por cliente equivale a `totalSel` porque `porCliente` particiona el set (L493–498, L533–539). No hay doble conteo.
- **Sin divisiones** en todo el flujo de gastos → sin riesgo de división por cero.
- **Fechas inválidas** toleradas en orden (`new Date(e.date||0)`, L2678) y en display (`fmtDate` retorna "—" si null, L21).
- `saldoCajaChica` (L34–41): correcto y con guardas; es la fuente única para caja chica (usada en CajaChicaView L406, panel admin del Dashboard y KPI de Tareas).

---

## 2. Lógica de flujos

### Ingresar gasto (`GastosForm`)
Cliente (buscador) → tabla multi-fila (tipo/fecha/descripción/monto) + Proyecto + Razón social → "Guardar todo". Intuitivo y rápido. Da feedback ("✓ N gastos guardados", L2939) y resetea filas.

- **F3 · Fallo parcial silencioso · MEJORA:** en `saveAll` cada fila se guarda en un loop; si una falla, se hace `console.error(e)` y se continúa (L2895–2900). El usuario ve "✓ X guardados" con X menor a lo intentado y **sin aviso** de que algunas fallaron. → Acumular errores y mostrarlos.
- **Menor:** el modal **no se cierra** tras guardar (a propósito, para carga en lote), pero puede leerse como "no pasó nada". Un toast + opción de cerrar ayudaría.

### Ingresar fondo (`FondoForm`)
Cliente → monto/fecha/descripción → "Guardar fondo". Simple; el modal sí cierra (vía `handleSaveExpense → setModal(null)`). Sin observaciones de fondo.

### Liquidar caja chica (`CajaChicaView`, tab Liquidar)
Filtros (período/cliente/tipo) → checkboxes → barra flotante con total → "PDF" / "Liquidar y enviar". `handleLiquidar` marca `rendered_at`/`render_id`/`rendered_by`, inserta en `rendiciones` y abre PDF + mailto (L417–467).

- **F1 · Liquidación irreversible · MEJORA:** el tab Historial (L649–712) muestra cada liquidación con "Descargar PDF" y "Enviar por correo" pero **no tiene "Anular"**. En cambio la rendición al cliente sí se puede anular (`handleAnularRendicion`, L2636 y L3606). Asimetría: un error de liquidación de caja chica solo se arregla tocando la base de datos. → Agregar "Anular liquidación" que revierta `rendered_at/render_id/rendered_by` y borre la `rendicion`.
- **F2 · No se puede liquidar sin enviar correo · MEJORA:** el único botón que liquida es "Liquidar y enviar" (L640); "PDF" (L639) solo abre el PDF, no liquida. Si alguien quiere dejar registrada la liquidación sin abrir el mail, no puede. → Separar "Liquidar" de "Liquidar y enviar", o no forzar el mailto.
- **F4 · Sin atomicidad · MENOR:** marca los gastos en un loop de `await` secuenciales (L425–431) y luego inserta la rendición (L434). Si una actualización falla a mitad, quedan gastos marcados como rendidos sin rendición asociada. Probabilidad baja, pero no hay rollback.
- **Menor:** confirmación previa inexistente; dado que es irreversible (F1), un `confirm()` sería prudente.

### Rendir al cliente (`RendicionModal`)
Selección de gastos → preview de saldos (correcto, ver C3) → genera PDF + mailto + marca `client_rendered_at`. Tiene "seleccionar todo" (L2308) y anulación posterior. Flujo sólido.
- **Menor:** el botón "↓ Rendir" (ExpensesView L2700) aparece para cualquier cliente seleccionado aunque no tenga gastos por rendir; abre un modal potencialmente vacío.

### F5 — Eliminar un gasto ya rendido descuadra la rendición · **MENOR**
`handleDeleteExpense` borra el gasto sin verificar si está asociado a una rendición (`render_id`/`client_render_id`). Si se borra, la `rendicion` conserva su `total`/`n_gastos` original pero al expandir el detalle faltará esa fila. → Avisar/impedir borrar gastos ya rendidos, o recalcular la rendición.

---

## 3. Consistencia

### K1 — `petty_cash.rendered_at` nunca se setea · **MENOR**
No existe ningún `supabase.from('petty_cash').update(...)` en el código (solo `insert`, L473). Por lo tanto:
- El indicador "(rendido)" del historial de entregas (L749–750) **nunca aparece**.
- `saldoCajaChica` correctamente no depende de ese campo (usa fondos entregados − gastos del usuario). El campo y el indicador son **lógica muerta** que confunde. → Quitar el indicador o documentar que el modelo no "rinde" entregas individuales.

### K2 — Azul fuera de paleta en Caja Chica · **MEJORA**
La selección de gastos en el tab Liquidar usa `#185FA5` (borde/checkbox) y `#E6F1FB` (fondo) (L613–618), un azul genérico que **no** es el corporativo `#003C50`. CLAUDE.md: "NUNCA azules genéricos". El resto de la app usa `#003C50` + `#E6EEF1`. → Reemplazar por los tokens corporativos.

### K3 — Múltiples formateadores de dinero · **MENOR**
Coexisten: `fmt` (Intl currency, módulo L19), `fmtCLP` (L414, con `Math.abs`), `fmtN` (L490, L692, L2314, L5146, todos `'$'+Math.abs(n||0)`), `fmtN` con `Math.round` sin abs (L1141), `fmtN` Intl (L4596), y formateo inline `${x.toLocaleString('es-CL')}` en `ClientsViewLimited` (L182–190). Diferencias reales: los `Math.abs` **pierden el signo** (el negativo se comunica por color/prefijo manual), mientras `fmt` muestra el "−". → Unificar en uno o dos helpers de módulo.

### K4 — Formatos de fecha inconsistentes · **MENOR**
- `fmtDate` → "09 jun" (ExpensesView movimientos, L2796).
- ISO crudo "2026-06-09" → lista de Liquidar (L625) e historial de entregas de caja (L746).
- `fmtD` → "09/06/2026" (historial de liquidaciones, L655/682).
Tres formatos en la misma pestaña. → Unificar (preferible `fmtDate` del módulo).

### K5 — `C.muted` vs paleta documentada · **MENOR**
`C.muted = '#8A8A8A'` (L16), pero CLAUDE.md define muted/AZUL2 = `#537281`. Además, `CajaChicaView` usa literales `#888`, `#3D3D3D`, `#537281`, `#003C50`, `#E24B4A` en vez de los tokens `C.*` (p. ej. L549–554, L603–628, L717–719). Resultado: conviven dos grises "muted" (#8A8A8A y #537281) y se pierde la fuente única de color. → Alinear `C.muted` con la paleta y usar `C.*` en vez de literales.

### ✓ Idioma
Todo en español de Chile con forma "tú" ("Sube un Excel", "Verifica que no sea un duplicado", "Quedo a disposición"). **No se detectó voseo.**

### ✓ Single source of truth (caja chica)
El saldo de caja chica **sí** usa una sola función (`saldoCajaChica`) en los 3 lugares (CajaChicaView, panel admin, KPI Tareas). Correcto. El problema de duplicación es solo con el saldo **de cliente** (C1).

---

## 4. Simplicidad (menos es más)

### S1 — Plantilla de PDF triplicada · **MEJORA**
El mismo HTML+CSS de documento (header firma, `.kpi-row`, tabla, footer "CONFIDENCIAL", botón imprimir) está escrito 3 veces casi idéntico:
- `CajaChicaView.generatePDF` (L487–544).
- `CajaChicaView` historial, PDF inline dentro del `onClick` (L690–700).
- `RendicionModal.generatePDFContent` (L2319–2366).
→ Extraer un `buildPDF({titulo, kpis, secciones})` de módulo. Reduce ~150 líneas y unifica el diseño de los documentos.

### S2 — "Liquidar" y "Rendir" son casi el mismo componente · **MENOR**
Ambos: lista con checkboxes, barra/lectura de total, PDF + mailto, marca de "rendido". Semánticamente distintos (caja chica interna vs. cliente), pero la UI podría compartir un componente de "selección + total + acción". Refactor opcional.

### Menor — `CajaChicaView` (~380 líneas) con los PDF inline
Partir el componente y sacar los templates (ver S1) lo haría mucho más legible.

---

## Apéndice · Mapa de la fórmula "fondos − gastos" (para C1)

| Lugar | Línea | ¿Usa `||0`? | Definición de "gastos" |
|---|---|---|---|
| `ExpensesView.balances` | 2647–2656 | No | todos |
| `ExpensesView` lista | 2741 | No | todos |
| `FondoForm.balance` | 2856 | No | todos |
| `GastosForm.balance` | ≈2890 | No | todos |
| `ClientsViewLimited` ficha | 137–139 | No | todos (`type!=='fondo'`) |
| `ClientFicha` admin | (sección fondos) | No | todos |
| `RendicionModal.saldoActual` | 2295 | No | **solo rendidos** |
| `saldoCajaChica` (referencia OK) | 34–41 | **Sí** | gastos del usuario |

**Conclusión:** el flujo de Gastos es funcionalmente correcto y las cifras cuadran con los datos actuales; las prioridades de mejora son (1) unificar el saldo de cliente en un helper con guardas [C1/C2], (2) dar reversibilidad y opción sin-correo a la liquidación de caja chica [F1/F2], y (3) limpiar paleta/formatos/PDF duplicado [K2/K3/K4/S1].
