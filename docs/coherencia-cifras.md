# Coherencia de cifras: concepto → nombre → fuente única

Referencia de la revisión automática de coherencia (auditoría del 07-11-2026). Una cifra, una fuente, un nombre: toda vista, correo y exportación que muestre uno de estos conceptos debe leer el helper de la tercera columna y usar el nombre de la segunda.

| Concepto | Nombre | Helper único | Pendiente de alinear (07-11-2026) |
|---|---|---|---|
| Por cobrar | «Por cobrar» (facturas con saldo; el vencido es parte de él) | `porCobrarBills` | —  (el resumen semanal de `sii-sync` se eliminó) |
| Saldo de factura | «Saldo de la factura» | `saldoBill` / `saldoFactura` | —  (`cierre-mes` y `tu-semana` leen `respaldoPorFactura`) |
| Vencido | «Vencido» = `esVencidaB` con saldo (emisión + 30 días) | `resumenCartera` / `esVencidaB` | —  (aging «Más de 60 días»; `tu-semana` y Por cobrar esta semana usan emisión + 30) |
| Cartera morosa | «Morosa» (atraso sobre el ritmo de pago del cliente) | `flujoCajaProyectado().duda` | Sin definición escrita en la pantalla |
| Facturado | «Facturado propio» (SII − notas de crédito) y «Emitido bruto» | `resultadoMes().fac` / `facturadoYr` | — («Facturado propio» $331,3M en Inicio/Resultado; «Honorarios» en Oficina = facturación propia + comisión de externos; «Emitido bruto» es el emitido con folio del mes) |
| Cobrado / caja | «Cobrado propio» por fecha del depósito; «Total a caja» aparte | `ingresosPorAnioVenta` | Facturación (KPI y hub «Pagado») usa `paid_at`/`issued_at` y se llama «Pagado»; Inteligencia, Socios (caja del año) y el correo del lunes ya leen el cobrado propio (el correo aún no resta la parte de externos ni los fondos); Counsel AI ya no calcula «cobrado» |
| Pagada (estado) | «Pagada» solo para el estado de la factura | `cobradoBill` | —  («Pagado» = facturas pagadas; «Cobrado» = caja) |
| Vendido | «Vendido» (Activo + Terminado, sin subarriendo) | `metricasAnio` / `ventaCuentaEnAnio` | —  (`ventaVendidaEnAnio` en Inicio, Ventas, Por socio, Inteligencia y resultado del año) |
| Por facturar | «Por facturar» = vigente de `clasificarPorFacturar` | `clasificarPorFacturar` | — (el KPI del hub ya lee `clasificarPorFacturar().total`) |
| Cuotas vencidas sin facturar | «Cuotas vencidas sin facturar» | `cuotasVencidasSinFacturar` (= Vencidas de `clasificarPorFacturar`) | Los totales por monto de la cuota difieren de Inicio en lo cubierto en parte por anticipo (Inicio lo descuenta) |
| Flujo de caja neto 8 semanas | «Flujo de caja (8 semanas)» + escenario | `useFlujoCaja` | —  (escenario como preferencia del estudio) |
| Proyección al 31-12 | «Cobranza proyectada al 31-12» + escenario | `proyeccionCobranza` | —  (rotula el escenario) |
| Comisiones por pagar | «Comisiones por pagar» | `saldoComisiones.porPagar` | — |
| Comisiones proyectadas | «Comisiones proyectadas 8 sem.» (flujo) | `flujoCajaProyectado().C` | — |
| Comisiones pagadas | «Comisiones pagadas» (sin traspasos a externos) | `comisPagadasAnioVenta.total` | — |
| Resultado del mes | «Resultado del mes» (devengado) | `resultadoMes` | — |
| Ingreso real | «Ingreso real» (caja propia − comisiones pagadas + percibidas) | cascada de Inicio / `kpisPorSocio` | «Ingresos» del Informe del mes es el devengado del Resultado del mes (otro plano); se rotula en su grupo «Resultado» |
| Anticipos disponibles | «Anticipos disponibles» | `anticiposDisponibles` | — |
| Deuda de clientes por gastos | «Gastos por cobrar a clientes» | `fgCliente` / `totalesFondos` | Umbral único `UMBRAL_DEUDA` (−$1.000); «Fondos por solicitar» es la acción de pedirlos |
| Fondos a favor (gastos) | «Fondos a favor del cliente» | `fgCliente.saldo > 0` | —  (anticipos de honorarios: «recibidos sin factura») |
| Caja chica por liquidar | «Caja chica por liquidar» | `gastosPorLiquidarCaja` | — |

Reglas de nombre: «Saldo» siempre con su objeto («Saldo de la factura», «Saldo de gastos del cliente», «Saldo de caja chica»); «Por pagar» siempre con su objeto («Comisiones por pagar», «Compras por pagar»).
