# Coherencia de cifras: concepto → nombre → fuente única

Referencia de la revisión automática de coherencia (auditoría del 07-11-2026). Una cifra, una fuente, un nombre: toda vista, correo y exportación que muestre uno de estos conceptos debe leer el helper de la tercera columna y usar el nombre de la segunda.

| Concepto | Nombre | Helper único | Pendiente de alinear (07-11-2026) |
|---|---|---|---|
| Por cobrar | «Por cobrar» (facturas con saldo; el vencido es parte de él) | `porCobrarBills` | Inteligencia; correos `sii-sync` (resumen-semanal) y `pendientes-semanal` (contexto por cliente) |
| Saldo de factura | «Saldo de la factura» | `saldoBill` / `saldoFactura` | `cierre-mes`, `tu-semana` (sin respaldo por anticipo consumido) |
| Vencido | «Vencido» = `esVencidaB` con saldo (emisión + 30 días) | `resumenCartera` / `esVencidaB` | Cierre del mes y «Por cobrar esta semana» (`due` crudo); aging «Vencido +60» → «Más de 60 días» |
| Cartera morosa | «Morosa» (atraso sobre el ritmo de pago del cliente) | `flujoCajaProyectado().duda` | Sin definición escrita en la pantalla |
| Facturado | «Facturado propio» (SII − notas de crédito) y «Emitido bruto» | `resultadoMes().fac` / `facturadoYr` | Tres planos sin rótulo (Inicio, Oficina, Emitido del mes) |
| Cobrado / caja | «Cobrado propio» por fecha del depósito; «Total a caja» aparte | `ingresosPorAnioVenta` | Facturación (KPI y hub «Pagado») usa `paid_at`/`issued_at` y se llama «Pagado»; Inteligencia, Socios (caja del año) y el correo del lunes ya leen el cobrado propio (el correo aún no resta la parte de externos ni los fondos); Counsel AI ya no calcula «cobrado» |
| Pagada (estado) | «Pagada» solo para el estado de la factura | `cobradoBill` | Unificar «Pagado/Cobrado» |
| Vendido | «Vendido» (Activo + Terminado, sin subarriendo) | `metricasAnio` / `ventaCuentaEnAnio` | Reporte y ficha cuentan ventas pausadas; copia del filtro en Inteligencia |
| Por facturar | «Por facturar» = vigente de `clasificarPorFacturar` | `clasificarPorFacturar` | Hub y KPI de Facturación, flujo, alerta de Inicio |
| Cuotas vencidas sin facturar | «Cuotas vencidas sin facturar» | `cuotasSinEmitir` | Flujo y página Por facturar aplican otra regla |
| Flujo de caja neto 8 semanas | «Flujo de caja (8 semanas)» + escenario | `useFlujoCaja` | Escenario por navegador (pasar a preferencia del estudio) |
| Proyección al 31-12 | «Cobranza proyectada al 31-12» + escenario | `proyeccionCobranza` | Sin rótulo del escenario |
| Comisiones por pagar | «Comisiones por pagar» | `saldoComisiones.porPagar` | — |
| Comisiones proyectadas | «Comisiones proyectadas 8 sem.» (flujo) | `flujoCajaProyectado().C` | — |
| Comisiones pagadas | «Comisiones pagadas» (sin traspasos a externos) | `comisPagadasAnioVenta.total` | — |
| Resultado del mes | «Resultado del mes» (devengado) | `resultadoMes` | Counsel AI calcula otro «Resultado del año» |
| Ingreso real | «Ingreso real» (caja propia − comisiones pagadas + percibidas) | cascada de Inicio / `kpisPorSocio` | Informe del mes lo llama «Ingresos» |
| Anticipos disponibles | «Anticipos disponibles» | por crear `anticiposDisponibles` | Suma repetida en 4 lugares |
| Deuda de clientes por gastos | «Gastos por cobrar a clientes» | `fgCliente` / `totalesFondos` | Seis nombres y umbral distinto en `aviso-fondos` |
| Fondos a favor (gastos) | «Fondos a favor del cliente» | `fgCliente.saldo > 0` | Misma frase que anticipos de honorarios |
| Caja chica por liquidar | «Caja chica por liquidar» | `gastosPorLiquidarCaja` | — |

Reglas de nombre: «Saldo» siempre con su objeto («Saldo de la factura», «Saldo de gastos del cliente», «Saldo de caja chica»); «Por pagar» siempre con su objeto («Comisiones por pagar», «Compras por pagar»).
