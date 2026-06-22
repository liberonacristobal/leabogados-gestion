Tengo todo confirmado. Aquí está el plan.

---

# PLAN DE CONSTRUCCIÓN — Módulo "Inteligencia de Negocios" (BI)

App leabogados-gestion · solo admin (Cristóbal, Erasmo) · mobile-first · paleta `C` · cifras siempre desde helpers fuente única.

## 1. Dónde vive y navegación

**Vista propia "Inteligencia"** (no un widget perdido en el Dashboard), accesible desde el menú admin. Razón: son 6 dimensiones densas, no caben como tarjeta. Pero **una tarjeta-puente "Resumen IA" sí va en el Dashboard** (lo primero que ves al entrar), con el párrafo ejecutivo + 2-3 alertas tappables que llevan a la vista completa.

Estructura interna de `IntelligenceView` (un solo scroll vertical, secciones colapsables, sin pestañas profundas):
```
[Header: Vendido YTD · Margen s/terceros · Tasa cobro]  ← 3 KPIs, toggle UF|CLP
[Resumen IA]            ← párrafo + destacados + alertas (claudeCall)
[Pregúntale al negocio] ← input NL, bottom sheet
[Oportunidades]         ← 6 tarjetas accionables
[Cartera de clientes]   ← segmentos + concentración
[Servicios / Margen]    ← área × abogado, margen
[Precios y ticket]      ← mediana, dispersión, revisar precio
[Tendencias]            ← 3 series + proyección
```
Cada sección reusa helpers existentes; ninguna duplica fórmulas. Filtros globales arriba (año, abogado, área) colapsables.

## 2. Secciones priorizadas (lo más valioso primero)

| # | Sección | Por qué primero | Esfuerzo |
|---|---|---|---|
| 1 | **Resumen IA + Oportunidades** | Acción inmediata: dormidos, cobranza grande, cross-sell. Es plata sobre la mesa, cero dato nuevo. | Medio |
| 2 | **Cartera de clientes** | Concentración/riesgo de fuga; ordena la cartera por valor real. | Medio |
| 3 | **Servicios / Margen** | Margen s/terceros por área y abogado — `costoVentaUF` ya existe. | Bajo |
| 4 | **Tendencias** | Vendido/Facturado/Cobrado + proyección de cierre. | Alto (devengado mensual tiene gaps) |
| 5 | **Precios y ticket** | Sub/sobre-precio, dispersión — refinamiento, no urgencia. | Medio |
| 6 | **Pregúntale al negocio** | Potente pero depende de que el brief esté maduro. | Medio |

## 3. Métricas exactas con su fuente única

Universo base ventas: `sales.filter(s => ['Activo','Terminado'].includes(s.status) && !s.deleted_at)`.

**Oportunidades** (helpers existentes, sin inventar):
- `ventaHistoricaUF(c)` = `Σ ventaUF(s,ufRef)` ventas Activo/Terminado del cliente.
- `ultimaActividad(c)` = `max(sales.activated_at/created_at, billing.issued_at no anulada, expenses.date)`.
- Dormido: `status==='Activo' && !is_occasional && mesesDormido≥9 && ventaHistoricaUF≥20`.
- Cross-sell: `areasDe(c).length===1 && ventaHistoricaUF≥umbral`.
- Cobranza grande: `Σ saldoBill(b)` Pendiente/Vencido sin reembolso, con tramo +60d de `computeAgingCartera`.
- Win-back: `status==='Terminado' && ventaHistoricaUF≥umbral && ultimaActividad≥hoy−18m`.
- Proveedor=cliente: match por RUT normalizado `proveedores ∩ clients/client_entities`.

**Cartera:** segmento RFM-lite de recencia (`ultimaActividad`) + morosidad (`computeAgingCartera`) + estado. Concentración: Top-5 y HHI sobre `ventaHistoricaUF`. Score de fuga = heurístico (rotular).

**Servicios/Margen** (`ventaUF`, `costoVentaUF` línea 12109, `byArea` 1981):
- Ingreso por área/abogado = `Σ ventaUF` agrupado. Neto = `ventaUF(s) − costoVentaUF(s)`. %margen = `Σneto/ΣventaUF` (borde: ventaUF==0 → "—"). Tasa externalización = `ΣcostoVentaUF/ΣventaUF`.
- MRR = `Σ amount_uf` de `esRecurrente(s)` sin ×12 (separar capacidad recurrente del cobro único).

**Precios** (helper nuevo `precioUF(s)`, extraer de línea 1755):
- `precioUF(s) = moneda==='CLP' ? (uf_value>0 ? amount_clp/uf_value : null) : amount_uf`. **Nunca reconvertir con UF de hoy.**
- `pricingStats(grupo)` → `{mediana, prom, p25, p75, cv, n}`. Outlier: `z=(precioUF−mediana)/IQR`, solo grupos n≥5. Reusar `descuentoProm` por abogado.

**Tendencias** (`ventaUF`/`ventaCLP`, `esFacturada`, `saldoBill`, `computeAgingCartera`):
- 3 series: Vendido (`sales.month/year`), Facturado (`issued_at`+`esFacturada`), Cobrado (`paid_at`+`paid_amount`). **UF por defecto** (inmune a inflación).
- YoY mismo tramo del año (borde: denom 0 → "nuevo"). Media móvil 3M. Proyección = banda de 3 métodos (run-rate, estacional, comprometido+pipeline×conversión). `tasaFacturacion`, `tasaCobro`.
- **Devengado mensual** (helper nuevo `devengadoMensual`): marcar "estimación" hasta cubrir gap de fechas de inicio/fin.

Regla transversal: redondear solo al mostrar; UF nominal congelada; verificar que subtotales sumen el total antes de mostrar agregados.

## 4. Capa de IA

**Arquitectura:** el front pre-agrega un **brief <2KB** (`buildBriefNegocio()`) con métricas ya calculadas por los helpers. La IA **narra/prioriza/conversa, nunca suma**. Todo por `claudeCall()` (key en servidor). Prompt blindado: *"Usa SOLO los números del brief; si falta un dato, di 'no disponible', jamás lo estimes."*

**Parallel por dimensión:** una llamada por sección (oportunidades, cartera, servicios, tendencias) en paralelo desde el front, cada una con su sub-brief. Resumen ejecutivo = 1 llamada agregada cacheada por día. Modelo barato (Sonnet/Haiku, no Opus). Devuelve JSON con `ref:{tipo,id}` → el front linkea a la ficha.

**Pregúntale al negocio:** modo simple (responde sobre el brief) + round-trip determinista: si la IA pide un corte que no está, devuelve `necesitaCorte:{dimension,valor,metrica}`, el **front lo calcula con los helpers** (lista blanca: area, responsible, type, status, cobro_type, moneda, year, is_occasional) y reinyecta el número. La IA solo redacta. Dimensiones fuera de la lista (industria, horas) → "ese dato no existe".

**Compuerta humana (no negociable):** insights read-only. Toda acción (recordar cobro, crear tarea de reactivación) abre el flujo existente con confirm/undo. Aceptar/descartar se guarda en `learnings` (kind `ia_insight`/`segmento_cliente`/`pricing_anchor`) → no repite. Preguntas → `usage_events` (mejora chips sugeridos).

## 5. Plan por etapas

**MVP (Etapa 1) — "Acción esta semana", cero dato nuevo, cero riesgo:**
- Tarjeta "Resumen IA" en el Dashboard + `IntelligenceView` con header tri-KPI y sección **Oportunidades** (6 tarjetas: dormidos, cross-sell, top sin recurrencia, cobranza grande, win-back, proveedor=cliente).
- `buildBriefNegocio()` + 1 prompt de insights/alertas. Acciones via flujos existentes.
- Solo admin. No toca `billing`/`sales`/`expenses`. `npm run build` verde antes de publicar.

**Etapa 2 — Cartera + Servicios/Margen:** segmentos RFM-lite, concentración/HHI, score de fuga heurístico; margen área×abogado con `costoVentaUF`. IA parallel por sección.

**Etapa 3 — Tendencias:** 3 series en UF (eje "mes de firma", 100% disponible) + YoY + pipeline. Proyección y devengado mensual marcados "estimación".

**Etapa 4 — Precios + Pregúntale al negocio:** `precioUF`/`pricingStats`, lista "revisar precio", round-trip NL.

Cada etapa: render antes/después + OK del usuario, build verde, línea en CHANGELOG, sin romper mobile.

## 6. Gaps de datos a cubrir

| Gap | Impacto | Mitigación |
|---|---|---|
| `ended_at` no se lee (churn por `status==='Terminado'` sin fecha) | win-back/antigüedad aproximados | setear timestamp al pasar a Terminado (cambio chico) |
| Sin fecha inicio/fin de devengo por venta | devengado mensual y proyección recurrentes aproximados | usar `activated_at`→`month/year`; rotular "estimación" |
| `n_cuotas` no consta en `sales` | cuotas caen como pago único en la serie | verificar columna; si falta, agregar |
| Área solo en `sales` | cobranza/precio por área cubre solo facturas con `sale_id` | mostrar % cobertura; no extender a otras entidades |
| `due` sintético (issued+30d) | aging respecto a emisión, no a vencimiento pactado | hablar en tramos, no días exactos |
| Sin horas/costo de abogado | "margen" = solo terceros, no utilidad real | rotular **"Margen s/terceros"** siempre |
| `responsible`/`area` texto libre | grupos fragmentados por tildes | normalizar contra `WHO_MAP` / lista de áreas |
| `proveedores` `nombre`/`name`, a veces sin RUT | match proveedor=cliente débil por nombre | match fuerte por RUT, fuzzy con compuerta IA |

---

**En una frase:** una vista "Inteligencia" admin-only que consume solo los helpers fuente única (`ventaUF`, `saldoBill`, `computeAgingCartera`, `costoVentaUF`, + `precioUF`/`devengadoMensual` nuevos), arranca con un MVP de Oportunidades accionables + Resumen IA sobre un brief <2KB (la IA narra, el código calcula), y crece por etapas a Cartera, Margen, Tendencias y Precios — con compuerta humana, todo guardado en `learnings`, y los gaps (churn fechado, horas, devengado) marcados explícitos en la UI.

Archivo: `/Users/cristobal.liberona/Downloads/leabogados-gestion/src/App.jsx` (helpers ~60-232 y ~1833-1847; aging ~1897; pipeline ~2857; `costoVentaUF` ~12109).