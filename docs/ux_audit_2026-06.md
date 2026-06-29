# Auditoría UX — leabogados-gestion (2026-06-28)

Rol: experto en experiencia de usuario. Método: recorrido de las vistas principales en modo demo + heurísticas de usabilidad (Nielsen) cruzadas con las reglas del propio proyecto (canon de la foto, navegación lógica, "la herramienta APRENDE", menos es más, todo clickeable, mobile iPhone). Foco: insumo para la próxima versión.

## Fortalezas (no romper)
- **Canon de la foto** aplicado y consistente: un protagonista + partes anidadas en Dashboard, Facturación (Etapas del cobro), Ventas, Costos de oficina.
- **Color/ícono por estado y por persona** canónico (estado de cobro, chips de persona Cristóbal/Erasmo/…).
- **Agrupación por entidad natural + colapsable** ya en conciliación, costos de oficina y "Por recordar" (cliente), con índice A-Z en Clientes.
- **Capa de aprendizaje** real y creciente (glosa→cliente, glosa→costo de oficina, subcategorías, RUT→cliente, costos fijos "Repetir").
- **Reversibilidad** en aumento (Deshacer en conciliación, Repetir, mover gastos).

## Hallazgos priorizados

### P0 — consistencia de cifras (rigor + confianza) — ✅ HECHO (commit pendiente)
- **Formato de monto mezclado en una misma foto**: en Facturación, "Etapas del cobro" mostraba `$65M` (abreviado) arriba y `$65.000.000` (completo) en el vencido/al-día anidado. → **Resuelto**: el anidado pasa a `fmtShort` (alineado con el resto de la app, ej. mini Cobranza). **Regla única que emergió**: *fotos/KPIs resumen → `fmtShort`; listas/filas de detalle → `fmt` (completo, exacto)*. Las demás `fmt` que quedan son filas de listas (correcto). Pendiente-si-se-pide: consistencia CROSS-foto (algunas fotos usan `fmt`/`fmtMon`, otras `fmtShort`) — es un sweep mayor, no un bug dentro de una foto.

### P1 — claridad y feedback
- **Empty states pobres**: "Pipeline · 0 propuestas · —" (Ventas). → ✅ HECHO: el tile vacío muestra "+ Crear la primera" y el toque abre directo "Nueva propuesta" (antes filtraba a una lista vacía).
- ~~Íconos del header sin etiqueta~~ → **YA estaba resuelto**: los botones del header tienen `title` + `aria-label` ("Conciliación bancaria…", "Inteligencia de negocios", "Buscar o ir a ⌘K"). (Hallazgo de auditoría corregido al revisar el código — leer la captura no bastaba.)
- ~~Ícono inerte al final de filas de Clientes~~ → **NO es inerte**: es el botón Archivar/Reactivar con su `title`. (Hallazgo corregido.)
- *Aprendizaje: varias "fallas" de UX vistas solo en captura no eran tales al mirar el código — verificar siempre contra el código antes de afirmar.*

### P2 — densidad y targets mobile
- ~~"Ventas por mes" — tocar barra → detalle~~ → **YA estaba**: las barras son clickeables (tap → detalle del mes) y el mes actual ya va en accent+bold. Lo único marginal son las etiquetas a 8px (no se tocó: subirlas arriesga overflow en 12 barras). (Hallazgo de captura corregido contra código.)
- **Índice A-Z (Clientes)** — target táctil estrecho (~13px) → ✅ HECHO: font 10→11 y padding `0 1px`→`3px 6px`; target ~20px. Aplicado a las dos versiones (admin + limited).

### Oportunidades de "la herramienta APRENDE" (loops que aún quedan)
- **Sugerir responsable/área al crear venta** desde el patrón del cliente (quién suele atenderlo).
- **Proactividad de cobranza**: un resumen "hoy: N por recordar / N vencen esta semana" empujado al inicio del día (ya hay recordatorios; falta el empujón diario consolidado).
- **Transparencia del aprendizaje**: una vista "qué aprendió la app" (alias RUT→cliente, glosa→categoría, costos fijos) editable — construye confianza y permite corregir en un lugar.
- **Auto-clasificación de cargos del banco** más allá de costo de oficina (proveedores recurrentes, impuestos) con el mismo patrón ✦.

## Temas grandes para la próxima versión
1. **Una sola regla de formato de cifras** (helper único por contexto) — cierra la deuda de inconsistencia de una vez.
2. **Centro de aprendizaje** (lo que la app sabe, editable) — hace visible y corregible la memoria que venimos construyendo.
3. **Inicio del día proactivo**: el Dashboard abre con "qué atender hoy" consolidado (cobranza + tareas + conciliación pendiente) en vez de que el usuario lo busque.
4. **Onboarding mínimo** para un integrante nuevo del equipo (tour de 4 pantallas de las vistas y sus reglas).
5. **Búsqueda/paleta de comandos más visible** (ya existe "Buscar o ir a") como punto de entrada universal.

## Cómo se usa este documento
Backlog vivo para la nueva versión. Cada vez que se cierra un hallazgo, marcarlo y anotar el commit. El objetivo final (visión del usuario): que la app aprenda lo suficiente para que la próxima versión se genere desde este conocimiento acumulado.
