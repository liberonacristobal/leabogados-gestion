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

// Cuotas programadas que YA están cubiertas por su propia venta (fuente única para el flujo y el radar «sin facturar»).
// Por venta activa: lo facturado (DTE emitidos de la venta) + cuotas anticipadas + programadas abiertas no puede superar el
// total acordado. Si lo supera, el exceso cubre las programadas más antiguas (FIFO): ya se facturaron con otro texto,
// otra fecha u otro plan. Cubierta ≥ 80% de la cuota → cubierta entera (diferencia de UF o de plan). uf = {fecha: valor}:
// sin UF de alguna fecha no se infiere nada (no se esconde plata).
export function cuotasCubiertasVenta(billing = [], sales = [], uf = {}) {
  const out = new Map(), porVenta = {}
  ;(billing || []).forEach(b => { if (b && !b.deleted_at && b.sale_id && b.status !== 'Anulada' && !['reembolso', 'nota_credito'].includes(b.billing_type)) (porVenta[String(b.sale_id)] = porVenta[String(b.sale_id)] || []).push(b) })
  ;(sales || []).forEach(s => { if (!s || s.deleted_at || s.status !== 'Activo') return; const bs = porVenta[String(s.id)]; if (!bs) return
    // Recurrentes (mensual / asesoría permanente): el monto de la venta es la cuota del mes, no el total → no aplica.
    const cv = coberturaVenta(s, bs, uf); if (!cv) return
    const { plan, usado, prog, ok } = cv
    if (!ok || !prog.length) return
    let exceso = usado + prog.reduce((a, x) => a + x.uu, 0) - plan
    if (!(exceso > plan * 0.03)) return
    prog.sort((x, y) => String(x.b.due || '').localeCompare(String(y.b.due || ''))).forEach(({ b, uu }) => { if (exceso <= 0 || !(uu > 0)) return; const t = Math.min(exceso, uu)
      out.set(String(b.id), t >= uu * 0.8 ? { total: true, m: Number(b.amount) || 0 } : { total: false, m: (Number(b.amount) || 0) * t / uu }); exceso -= uu }) })
  return out
}

// Radar «Cuotas vencidas sin facturar» (fuente única: Facturación, resumen del lunes y cierre de mes): programadas que vencieron
// antes de `hasta` (1º del mes en curso = meses cerrados) y dentro de la vida de la app, de ventas Activas que ya facturan, que no
// están cubiertas por lo ya facturado y que nadie marcó «No corresponde» (learnings cuota_no_emitir). Candidatas por revisar.
export const APP_DESDE = '2026-06-06'
export function cuotasSinEmitir({ billing = [], sales = [], uf = {}, noEmitir = new Set(), hasta, appDesde = APP_DESDE }) {
  const venta = new Map((sales || []).filter(s => s && !s.deleted_at).map(s => [String(s.id), s]))
  const cub = cuotasCubiertasVenta(billing, sales, uf), fact = ventasFacturando(billing)
  return (billing || []).filter(b => b && !b.deleted_at && b.status === 'Programada' && b.sale_id && venta.get(String(b.sale_id))?.status === 'Activo'
    && fact.has(String(b.sale_id)) && b.due && b.due >= appDesde && b.due < hasta && !noEmitir.has(String(b.id)) && !cub.get(String(b.id))?.total)
}

// Saldo a favor ya recibido a cuenta de las cuotas por emitir: los anticipos disponibles del MISMO trabajo se reparten por orden de
// vencimiento (FIFO). La factura se emite igual por el total; lo recibido se imputa después. El subarriendo queda fuera: cada pago
// es de su mes (anticiposSubarriendo). Devuelve Map id de la cuota → monto recibido.
export function recibidoACuenta(cuotas = [], anticipos = [], sales = []) {
  const sub = new Set((sales || []).filter(s => s && (s.cobro_config?.subarriendo === true || s.area === 'Subarriendo')).map(s => String(s.id)))
  const disp = {}
  ;(anticipos || []).forEach(a => { if (a && a.estado === 'disponible' && a.sale_id && !sub.has(String(a.sale_id)) && Number(a.monto) > 0) disp[String(a.sale_id)] = (disp[String(a.sale_id)] || 0) + Number(a.monto) })
  const out = new Map()
  ;[...(cuotas || [])].sort((x, y) => String(x.due || '').localeCompare(String(y.due || ''))).forEach(b => {
    const k = String(b.sale_id || ''), r = Math.min(disp[k] || 0, Number(b.amount) || 0)
    if (r >= 1) { out.set(String(b.id), r); disp[k] -= r }
  })
  return out
}

export const DETENIDO_DIAS = 90
// Trabajos ACTIVOS sin movimiento en `dias`: ni factura del trabajo, ni gasto, tarea u horas del cliente (la actividad del cliente
// cuenta para todos sus trabajos: así no se marca de más). Dos casos:
//   · 'terminado' — sin cuotas por facturar, sin saldo por cobrar y con el plan facturado → «Cerrar trabajo».
//   · 'con_saldo' — con facturas impagas → trabajo detenido con saldo (cobranza).
// Con cuotas programadas o plan por facturar no entra: eso lo ven el radar y «Trabajos sin facturar». La app no ve el trabajo que va
// solo por correo: son candidatos con compuerta. decididos = { sale_id: fecha «Sigue activo» } (vuelve a evaluarse pasados `dias`).
export function trabajosDetenidos({ sales = [], billing = [], expenses = [], tasks = [], horas = [], pagos = [], uf = {}, hoy, dias = DETENIDO_DIAS, decididos = {} }) {
  const lim = new Date(new Date(String(hoy).slice(0, 10) + 'T12:00:00').getTime() - dias * 864e5).toISOString().slice(0, 10)
  const max = (m, k, v) => { const d = String(v || '').slice(0, 10); if (d && (!m[k] || d > m[k])) m[k] = d }
  const actCli = {}
  ;(expenses || []).forEach(e => e && !e.deleted_at && max(actCli, String(e.client_id), e.date))
  ;(tasks || []).forEach(t => { if (!t) return; max(actCli, String(t.client_id), t.created_at); max(actCli, String(t.client_id), t.completed_at) })
  ;(horas || []).forEach(h => h && max(actCli, String(h.client_id), h.fecha))
  // Pagos recibidos (abonos del banco asignados al cliente): cuentan solo para el trabajo con saldo por cobrar (cuánto lleva sin
  // moverse la cobranza). Para «parece terminado» no: un pago reciente suele ser el pago final.
  const pagoCli = {}; (pagos || []).forEach(p => p && max(pagoCli, String(p.client_id), p.fecha))
  const porVenta = {}; (billing || []).forEach(b => { if (b && !b.deleted_at && b.sale_id) (porVenta[String(b.sale_id)] = porVenta[String(b.sale_id)] || []).push(b) })
  const out = []
  for (const s of sales || []) {
    if (!s || s.deleted_at || s.status !== 'Activo' || s.cobro_config?.subarriendo === true || s.area === 'Subarriendo') continue
    const bs = porVenta[String(s.id)] || []
    const emit = bs.filter(b => b.invoice_no && b.status !== 'Anulada' && b.billing_type !== 'reembolso')
    const ultFac = emit.map(b => String(b.issued_at || '').slice(0, 10)).filter(Boolean).sort().pop() || ''
    // Una venta creada hace menos de `dias` no se evalúa; su fecha de creación no cuenta como movimiento (las importadas la tienen falsa).
    if (String(s.created_at || '').slice(0, 10) > lim) continue
    const ult = [ultFac, actCli[String(s.client_id)] || ''].sort().pop()
    if (!ult || ult > lim) continue
    if (decididos[String(s.id)] && String(decididos[String(s.id)]).slice(0, 10) > lim) continue
    const progs = bs.filter(b => b.status === 'Programada' && !b.invoice_no)
    const porCobrar = emit.filter(b => ['Pendiente', 'Vencido'].includes(b.status)).reduce((a, b) => a + Math.max(0, montoFactura(b) - (Number(b.paid_amount) || 0)), 0)
    const dias_ = Math.round((new Date(String(hoy).slice(0, 10) + 'T12:00:00') - new Date(ult + 'T12:00:00')) / 864e5)
    if (porCobrar >= 1) { const ultS = [ult, pagoCli[String(s.client_id)] || ''].sort().pop(); if (ultS > lim) continue
      out.push({ s, tipo: 'con_saldo', ult: ultS, dias: Math.round((new Date(String(hoy).slice(0, 10) + 'T12:00:00') - new Date(ultS + 'T12:00:00')) / 864e5), porCobrar, facturas: emit.filter(b => ['Pendiente', 'Vencido'].includes(b.status)).length }); continue }
    if (progs.length) continue
    const cv = coberturaVenta(s, bs, uf)
    if (cv && (!cv.ok || cv.plan - cv.usado > Math.max(cv.enUF ? 1 : 10000, cv.plan * 0.03))) continue   // sin UF no se afirma que esté facturado
    out.push({ s, tipo: 'terminado', ult, dias: dias_, porCobrar: 0, facturas: emit.length })
  }
  return out.sort((a, b) => a.ult.localeCompare(b.ult))
}
