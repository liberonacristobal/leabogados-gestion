# Backlog de pendientes — leabogados-gestion

Revisión detallada al 2026-07-03. Fuente: memoria del proyecto + código. Marcado por área y prioridad.
(⚠ = riesgo cifras/seguridad · 🔨 = build · 📄 = doc/datos · ✅ = hecho reciente)

---

## A. En curso / prioridad de esta tanda

- ✅ **Depurar "ya cobradas sin marcar"** — alerta + marcar Pagadas en lote (reversible). HECHO hoy.
- ✅ **Badge Facturación = solo vencidas reales con saldo**. HECHO hoy.
- 🔨 **Costos de Oficina** — sacar costos reales de la firma (sueldos/arriendo) de Gastos a un módulo propio (cliente interno). Pieza 1 (categorías que aprenden) hecha; falta **panel mensual** + depurar lo ya cargado en Gastos.
- 🔨 **Bandeja de envío masivo** — mandar todas las facturas del mes juntas, con destinatario recordado (la "etapa 2"). Avanzar para el próximo mes.
- 📄 **Documentación facturación SII** — ya existen `checklist_certificacion_sii_dte.md`, `runbook_emision_dte.md`, `migracion_sii_software_propio_runbook.md`, `presentacion_sii_emision_dte.md`. Falta consolidar en una guía única accionable (Parte A contador/SII = postular + set de pruebas + CAF; Parte B motor ya está).
- ⚠ **Cerrar el relay `notify-task`** — `verify_jwt=false` y sin auth → cualquiera con la URL manda correos desde la oficina. Requiere: verificar JWT de usuario @leabogados.cl (o CRON_SECRET para crons) + que el front mande el token del usuario, no la anon key. Deploy de edge fn (riesgo: rompe el envío que ya funciona → probar tras deploy).

## B. Cifras / datos (cero tolerancia a errores)

- ⚠📄 **Descuadres pendientes** — facturas "Sin año" (no entran a totales por año); el Dashboard cuenta "Propuesta" en bruto. Analizados, NO ejecutados. Auditar por SQL (RLS bloquea anon).
- ⚠📄 **Gastos landing / auditoría** — 21 facturas duplicadas + 8 programadas fantasma detectadas (SQL de limpieza pendiente).
- ⚠ **Auditoría profunda 2026-06-14** — total "stale" en algunas vistas, saldo divergente en clientes multi-RS, huérfanos al anular, dudas con `paid_by_client`. Verificar y cerrar.
- 📄 **Caja chica Martina** — liquidación 12667241 incluye históricos ajenos; ajustar tras cargar el 269 (pendiente datos de Martina).
- 📄 **Carga Notaría Martina (Opción B)** — 93 gastos sin OT borrados (soft); pendiente que Martina recargue la planilla + 2 liquidaciones.
- ⚠ **Conciliar cobradas (stock 2026)** — las 42 "cobradas no conciliadas" son mayormente duplicados (pagos ya conciliados en otro lado). Pausado: decidir retirar vs revisar caso a caso.

## C. Módulos / features nuevos

- 🔨 **Proyección de ingresos a fin de año** — por cobrar + programadas hasta 31-dic, por año/abogado. Render aprobado; falta construir (drill del Cash flow).
- 🔨 **Panel de Cartera — Fase 2** — para usuarios limited, strip de estado, auto-crear proyectos. (Fase 1 admin hecha; tabla `proyectos_cartera` SQL pendiente.)
- 🔨 **Inteligencia de Negocios** — módulo que perfila clientes/precios/oportunidades con datos + IA. Construir por etapas.
- 🔨 **Calendario de plazos** — v1 (PlazosModal extrae plazos de contrato con IA) hecha; falta [TÚ] correr el SQL de la tabla `plazos` + integrarlo al Dashboard.
- 🔨 **Rediseño Facturación global** — plan ERP (tabs por estado, aging semáforo, FAB). Render aprobado, NO construido.
- 🔨 **Rediseño facturas cockpit en la ficha** — lista con filtros en Ficha→Financiero + reconciliación mensual. Plan 3 fases, sin construir.
- 🔨 **Clientes ocasionales** — falta "crear como ocasional" en la carga.

## D. UX / docs / deuda

- 📄 **Guía de uso del equipo** — V1 en `docs/guia_de_uso.md`; pendiente revisión del usuario + mantenerla al día.
- 🔨 **Carga conciliar (rediseño)** — backlog: mostrar razón del match, nivel de confianza, editar inline.
- 🔨 **Dashboard interactivo** — pendiente utilidad de los KPIs + detalle de tareas.
- 🔨 **Pipeline temas 2026-06-15** — #3 admin sin caja chica, #4 KPIs de Tareas, #6 liquidación = rendición.
- 📄 **Plan nueva versión / Design system** — `docs/plan_nueva_version.md` + `docs/design_system.md`: generar la próxima versión desde el conocimiento acumulado.
- 🔨 **Gastos** — aprendizaje glosa→cliente/categoría; cerrar la duda de `paid_by_client`.

## E. Verificar en producción (recién construido, sin probar en demo)

- Correo de factura: cuentas (honorarios 1403834 / gastos 1383922), glosa desde el DTE (proyecto + Pago X), asunto con "|", fondo por rendir, envío desde tu correo. (Usuario confirmó: **facturas enviadas OK** — validar el resto al usar.)
- Herencia de `sale_id` al reemplazar programada; "Vincular a venta" en Por enviar.
- Reembolso conciliación (cifras) — probar con cartola real.
