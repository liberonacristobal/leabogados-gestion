# Plan — Conciliación como PROPUESTA con trazabilidad (2026-06-28)

## Principio rector (decisión del usuario)
La conciliación bancaria **propone, nunca decide sola**. El motor de calce sugiere; el humano aprueba.
Cada propuesta debe ser una **superficie de decisión completa**: con la factura y el pago a la vista
(la fuente de la verdad), uno tiene que poder decidir SIN ir a buscar información a otro lado.
TOL=0 (calce exacto en pesos) se mantiene intacto.

## Diseño de referencia de la tarjeta de propuesta
Cada match propuesto muestra:

**Cliente (razón social)** como título + chips de estado (vencida N días / cuadra exacto).

**PAGO RECIBIDO · BANCO** (de `cartola_movimientos`):
- monto, fecha, cuenta (Honorarios/Gastos), N° operación
- pagador: nombre + RUT
- glosa textual del banco
- vínculo: "RUT ya vinculado a este cliente (confirmado antes)" o "RUT nuevo → se aprende al aprobar"

**SE APLICA A** (de `billing`; un pago puede llevar varios destinos):
- una o varias **facturas**: folio, monto, **razón social + RUT del receptor**, **glosa/descripción**,
  **proyecto + abogado responsable**, emisión, vencimiento, **abonos previos** (si hay), **saldo**.
- y/o **reembolso de fondos** (cuando el pago = factura + gastos pendientes del cliente; `facturaMasGastos`).

**Por qué calza** (chips de trazabilidad, por nivel de confianza):
- Alta: "Banco nombra F°X en la glosa", "Calce exacto · mismo RUT".
- Media: "Calce exacto · mismo monto", "Recurrente (mes del pago → mes de la factura)".
- Combina: "2 pagos suman exacto", "2 facturas suman el pago", "Factura + fondos = exacto".

**Anti-error · "¿Por qué esta?"**: si hay otra factura del mismo monto, mostrar la **competidora** y el
criterio de desempate, con **"Cambiar a F°Y"**. Además **"Buscar otra factura"** (abre el estado de
cuenta del cliente con buscador para imputar a CUALQUIER factura). Y **"Otras pendientes del cliente"** (N · $).

**Consecuencia de aprobar**: "F°X queda Pagada · se ofrece acuse al cliente · queda registrado quién y
cuándo concilió" (traza permanente).

## Eje 1 — De auto-aplicar a proponer (fases)
- **Fase 1**: `construirPropuesta()` (pura, reusa `mejorCandidato`/`comboExacto`/`comboExacto3`/`grupoPago`/
  `facturaMasGastos`/`clientePorMonto`) → estructura de propuestas con destinos + razones + confianza +
  alternativa + otras pendientes. Panel modal que renderiza las tarjetas detalladas, agrupadas por confianza.
  El botón "Conciliar auto" pasa a **"Revisar propuesta"** (ya no aplica solo). Aprobar por tarjeta/grupo →
  llama a los `reconciliar*` existentes (probados).
- **Fase 2**: anti-error (competidora + "Cambiar a" + "Buscar otra factura" + otras pendientes), reembolso de
  fondos en la propuesta, registro de conciliación auditable (cómo/quién/cuándo en cada calce).
- **Fase 3 (señales que suben confianza y trazabilidad, sin aflojar TOL)**:
  - A. Leer "Factura N°…" de la glosa del banco → candidato premium por folio (`cartola.js` + campo `folio_ref`).
  - B. Aprender el pagador (nombre del banco → cliente) al conciliar, no solo al identificar.
  - C. Preservar correcciones manuales de RUT/nombre al recargar la cartola.
  - D. Validar que la cartola cuadre al cargar (avisar parseo malo antes de proponer).

## Eje 1 · Fase 4 — Bandeja de conciliación diaria (punto de entrada) [NUEVO, pedido 2026-06-28]
El usuario quiere que el flujo diario lo avise: cuando llegan transferencias nuevas sin conciliar, dejar un
indicador y poder conciliar de un toque (como sugerencia, nunca solo).
- **Icono de banco en el landing del dashboard, al lado del de tareas, con una burbuja** = cantidad de abonos
  sin conciliar (cuenta `resumenConc.pend` o equivalente; aparece tras importar la cartola del día/mes).
- Al tocarlo, **resumen de "Nuevos depósitos"** agrupado por **fecha + cuenta** (Honorarios/Gastos), cada pago
  con los datos de siempre (pagador + RUT, N° operación, glosa, monto). Total arriba.
- CTA **"Revisar propuesta de conciliación"** → abre el panel de propuesta de la Fase 1/2 (sugiere, el humano
  aprueba). Cierra el círculo: el banco avisa → ves el resumen → apruebas las sugerencias.
- Solo admin (la conciliación es admin). La burbuja desaparece cuando todo queda conciliado.

## Eje 2 — Barrido de canon de la foto (vistas admin)
Dashboard "Proveedores" (por-pagar + pendiente → total con desglose anidado) y revisar las demás "fotos"
admin que marcó la auditoría, con antes/después de cada una antes de tocar.

## Eje 3 — UX del equipo limited
Quick-add de tarea inline en la ficha (1 clic, sin modal). ("Tu semana" ya existe = PRÓXIMAS SEMANAS.)

## Eje 4 — Herramientas para limited + trazabilidad del admin
- Para el equipo (menos carga): recordatorio de rendir cuando acumulan gastos sin liquidar hace X días;
  quick-add / plantillas de gasto recurrente.
- Para el admin (trazabilidad): **Bitácora del equipo** (qué hizo cada uno: gastos cargados, liquidaciones,
  tareas terminadas — quién/cuándo); **Estado de caja chica del equipo** (cuánto tiene cada uno, sin liquidar,
  hace cuánto no rinde); **aviso al admin** cuando un limited liquida/rinde.
