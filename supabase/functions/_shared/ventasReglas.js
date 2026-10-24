// Reglas ÚNICAS de lo facturado de una venta frente a su plan. Las usan la app (Facturación › Por revisar, flujo, radar) y el
// servidor (pendientes-semanal). Funciones puras: no leen ni escriben la base.
import { montoFactura } from './saludDatos.js'

const _noCuenta = b => !b || b.deleted_at || b.status === 'Anulada' || ['reembolso', 'nota_credito'].includes(b.billing_type)

// Ventas que YA empezaron a facturar (al menos una factura emitida, no anulada ni de reembolso). Solo en ellas una cuota vencida
// sin emitir es un olvido: un trabajo activo sin ninguna factura puede no haber empezado su facturación a propósito (usuario 24-10).
export const ventasFacturando = billing => new Set((billing || []).filter(b => b && !b.deleted_at && b.invoice_no && b.status !== 'Anulada' && (b.billing_type || '') !== 'reembolso' && b.sale_id).map(b => String(b.sale_id)))

// Lo facturado de UNA venta medido en la moneda de su honorario (UF con la UF del día de cada documento). Fuente única para
// «cuotas cubiertas» (flujo/radar), «cuotas sin generar» (Revisión) y «trabajos sin facturar»: comparan MONTOS contra el plan,
// nunca cuántas filas hay. null = no aplica (recurrente, sin plan) · ok:false = falta la UF de alguna fecha (no se infiere nada).
export function coberturaVenta(s, bs = [], uf = {}) {
  if (!s || s.cobro_type === 'mensual' || bs.some(b => /mensual|permanente/i.test(String(b.concept || '')))) return null
  const enUF = s.moneda === 'UF' || (!s.amount_clp && Number(s.amount_uf) > 0), plan = enUF ? Number(s.amount_uf) || 0 : Number(s.amount_clp) || 0; if (!(plan > 0)) return null
  const ufDe = d => { const k = String(d || '').slice(0, 10); if (!k) return null; if (uf[k]) return uf[k]; const ks = Object.keys(uf).filter(x => /^\d{4}-\d\d-\d\d$/.test(x) && x <= k).sort(); return ks.length ? uf[ks[ks.length - 1]] : null }
  let ok = true; const u = (m, d) => { if (!enUF) return m; const v = ufDe(d); if (!v) { ok = false; return 0 } return m / v }
  let usado = 0; const prog = []
  bs.forEach(b => { if (_noCuenta(b)) return
    if (b.invoice_no) usado += u(montoFactura(b), b.issued_at || b.due); else if (b.status === 'Anticipada') usado += u(Number(b.amount) || 0, b.issued_at || b.due); else if (b.status === 'Programada') prog.push({ b, uu: u(Number(b.amount) || 0, b.issued_at || b.created_at || b.due) }) })
  return { plan, usado, prog, ok, enUF }
}

export const SIN_FACTURAR_DIAS = 60
// Trabajos sin facturar: venta Activa que ya factura, cuya última factura tiene más de 60 días y a la que le falta facturar parte
// del plan SIN que una cuota lo explique. Lo explican: cuota programada que vence desde que existe la app (futura, o vencida y ya en
// el radar «Cuotas vencidas sin facturar») y cuota marcada «No corresponde». Quedan: cuotas que vencieron ANTES de la app (el radar
// no las ve) y saldo sin ninguna cuota (hitos sin fecha). decididos = ventas con respuesta guardada (learnings trabajo_sin_facturar).
// monto en pesos: cuotas en su monto y el saldo sin cuota a la UF de hoy (ufHoy). Los gastos son reembolsos: no son condición.
export function trabajosSinFacturar({ sales = [], billing = [], uf = {}, ufHoy = 0, hoy, noEmitir = new Set(), decididos = new Set(), appDesde = '2026-06-06', dias = SIN_FACTURAR_DIAS }) {
  const t = s => new Date(String(s).slice(0, 10) + 'T12:00:00').getTime()
  const hoyT = t(hoy), lim = new Date(hoyT - dias * 864e5).toISOString().slice(0, 10)
  const porVenta = {}; (billing || []).forEach(b => { if (b && !b.deleted_at && b.sale_id) (porVenta[String(b.sale_id)] = porVenta[String(b.sale_id)] || []).push(b) })
  const out = []
  for (const s of sales || []) {
    if (!s || s.deleted_at || s.status !== 'Activo' || s.cobro_config?.subarriendo === true || s.area === 'Subarriendo' || decididos.has(String(s.id))) continue
    const bs = porVenta[String(s.id)] || [], emit = bs.filter(b => !_noCuenta(b) && b.invoice_no)
    if (!emit.length) continue
    const ult = emit.map(b => String(b.issued_at || b.due || '').slice(0, 10)).filter(Boolean).sort().pop()
    if (!ult || ult > lim) continue
    const cv = coberturaVenta(s, bs, uf); if (!cv || !cv.ok) continue
    const silenciada = x => noEmitir.has(String(x.b.id)), previa = x => String(x.b.due || '') < appDesde
    const explica = cv.prog.filter(x => silenciada(x) || !previa(x)).reduce((a, x) => a + x.uu, 0)
    const falta = cv.plan - cv.usado - explica
    const tol = Math.max(cv.enUF ? 1 : 10000, cv.plan * 0.03)
    if (!(falta > tol)) continue
    const viejas = cv.prog.filter(x => !silenciada(x) && previa(x)).sort((a, b) => String(a.b.due).localeCompare(String(b.b.due)))
    const enCuotas = viejas.reduce((a, x) => a + x.uu, 0), sinCuota = Math.max(0, falta - enCuotas)
    if (sinCuota > tol && cv.enUF && !(ufHoy > 0)) continue   // sin UF de hoy no se inventa el monto
    const monto = Math.round(viejas.reduce((a, x) => a + (Number(x.b.amount) || 0), 0) + (sinCuota > tol ? (cv.enUF ? sinCuota * ufHoy : sinCuota) : 0))
    out.push({ s, ult, dias: Math.round((hoyT - t(ult)) / 864e5), viejas: viejas.map(x => x.b), sinCuota: sinCuota > tol ? sinCuota : 0, enUF: cv.enUF, monto })
  }
  return out.sort((a, b) => b.monto - a.monto)
}
