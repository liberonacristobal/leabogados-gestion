// Ciclo del mes de Facturación — FUENTE ÚNICA de las cifras del «Cierre de mes» y de los pasos del ciclo (Vencidas, Emitir, Enviar, Cobrar) de la pantalla
// Facturación y del Panel de socios. Extraído de BillingView SIN cambiar ninguna fórmula; usa las mismas reglas de ventasReglas.js.
import { cuotasPorEmitirMes, cuotasSinEmitir, facturaSinEnviar } from './ventasReglas.js'
import { montoFactura } from './saludDatos.js'

/**
 * @param {any} p billing, sales, anticipos, fantasmaIds (Set), noEmitir (Set), respaldoMap (id factura → abonado en banco), uf (UF por fecha), now (Date)
 */
export function cicloFacturacionMes(p) {
  const { billing = [], sales = [], anticipos = [], fantasmaIds = new Set(), noEmitir = new Set(), respaldoMap = {}, uf = {}, now = new Date() } = p
  const bb = (billing || []).filter(b => b.billing_type !== 'reembolso')   // Facturación excluye reembolsos de gastos
  const _pm = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const cmK = `${_pm.getFullYear()}-${String(_pm.getMonth() + 1).padStart(2, '0')}`
  const emi = bb.filter(b => !b.deleted_at && (b.invoice_no || b.folio) && b.status !== 'Anulada' && b.billing_type !== 'reembolso' && String(b.issued_at || b.date || '').slice(0, 7) === cmK)
  const mo = b => montoFactura(b); const ab = b => Math.max(Number(b.paid_amount) || 0, Number(respaldoMap[b.id]) || 0); const sa = b => b.status === 'Pagado' ? 0 : Math.max(0, mo(b) - ab(b))
  const tEmi = emi.reduce((a, b) => a + mo(b), 0), tCob = emi.reduce((a, b) => a + Math.max(0, mo(b) - sa(b)), 0), tasa = tEmi > 0 ? Math.round(tCob / tEmi * 100) : 0
  const mesAct = now.toISOString().slice(0, 7)
  // Mismas cuotas que el checklist (ventasReglas): las del mes, sin lo atrasado (eso es el paso «Vencidas»).
  const pemMes = cuotasPorEmitirMes({ billing, sales, anticipos, fantasmaIds, noEmitir: noEmitir || new Set(), mesKey: mesAct, uf: uf || {} }).filter(b => String(b.due || b.issued_at || '').slice(0, 10) >= `${mesAct}-01`)
  const pemN = pemMes.length, pemTot = pemMes.reduce((a, b) => a + (b.amount || 0), 0)
  const porEnviar = (billing || []).filter(b => !b.deleted_at && facturaSinEnviar(b))
  // Radar «Cuotas vencidas sin facturar»: programadas de meses cerrados (antes del actual), dentro de la vida de la app, de ventas Activas, sin «no corresponde».
  const _m1 = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const sinEmitirCands = cuotasSinEmitir({ billing, sales, anticipos, uf: uf || {}, noEmitir, hasta: _m1 })
  const sinEmitirN = sinEmitirCands.length
  const sumM = a => a.reduce((t, b) => t + (b.amount || 0), 0)
  const cobPend = emi.filter(b => sa(b) > 0), porEnvTot = porEnviar.reduce((t, b) => t + mo(b), 0)
  return { cmK, emi, mo, ab, sa, tEmi, tCob, tasa, mesAct, pemMes, pemN, pemTot, porEnviar, sinEmitirCands, sinEmitirN, sumM, cobPend, porEnvTot }
}
