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
- **Empty states pobres**: "Pipeline · 0 propuestas · —" (Ventas) y similares son cajas vacías sin guía. → Empty state que oriente la acción ("Sin propuestas — crea una con + Nueva propuesta").
- **Íconos del header sin etiqueta** (banco=conciliación, gráfico=inteligencia): dependen de recordar. Para equipo chico es tolerable, pero un tooltip/label corto en el primer uso ayuda (reconocer > recordar).
- **El ícono al final de cada fila de Clientes** (documento) no comunica su función → etiquetar o quitar.

### P2 — densidad y targets mobile
- **"Ventas por mes" (Dashboard)**: barras y etiquetas muy pequeñas en iPhone; el dato (`188`, `3.7k`) cuesta leerse. → Subir contraste/tamaño de la barra del mes actual y de su etiqueta; considerar tocar una barra → su detalle (todo clickeable).
- **Índice A-Z (Clientes)**: target táctil estrecho. → Engrosar la zona tocable.

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
