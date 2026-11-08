// Reglas ÚNICAS de «Por facturar»: de la cifra de la tarjeta a lo realmente cobrable, siempre del lado conservador (lo dudoso queda
// fuera de lo vigente, nunca dentro). Las leen Facturación › Por facturar, el flujo de caja y los avisos. Funciones puras: no leen ni
// escriben la base. Cada cuota cae en UNA sola partida y las partidas suman exactamente el total (una cuota cubierta en parte se parte).
import { cuotasCubiertasVenta, coberturaVenta, cuotasSinEmitir, cuotaDeLaApp } from './ventasReglas.js'
import { montoFactura } from './saludDatos.js'

export const POR_CONFIRMAR_DIAS = 90

// Cuatro partidas, nada más. Vigente = se factura y se cobra (Vencidas por emitir + Por vencer); Por confirmar = espera una respuesta del abogado;
// Fuera = ya explicado. El motivo (cubierta por factura o anticipo, «No corresponde», pausada, saldo de una cuota, recurrente…) es una etiqueta de cada
// fila, no otra partida: así hay pocas cosas que calificar.
export const GRUPOS = /** @type {const} */ ({
  vigente: ['vencida', 'porVencer'],
  porConfirmar: ['porConfirmar'],
  fuera: ['fuera'],
})

const _t = (/** @type {any} */ s) => new Date(String(s || '').slice(0, 10) + 'T12:00:00').getTime()
const _sinFolio = (/** @type {any} */ b) => !b.invoice_no

/**
 * Anticipos disponibles (plata ya recibida sin factura) sobre las cuotas Programadas más antiguas de su venta (o del cliente, si el
 * anticipo no tiene venta). El subarriendo es mensual: un pago cubre solo la cuota de SU mes (entre 15 días antes y 20 después del
 * vencimiento). `excluir` deja fuera las cuotas que no son plata por facturar (venta no activa, «No corresponde», ya cubiertas).
 * Es el mismo cálculo del flujo de caja: ahí se llama con las mismas cuotas, así que las dos vistas coinciden.
 * @param {{cuotas:any[], anticipos:any[], excluir?:(b:any)=>boolean}} p
 * @returns {{cubierto:Record<string,number>, total:number}}
 */
export function anticiposSobreCuotas({ cuotas, anticipos, excluir = () => false }) {
  /** @type {Record<string,number>} */ const cubierto = {}
  let total = 0
  ;(anticipos || []).filter(a => a && a.estado === 'disponible' && !a.billing_id && Number(a.monto) > 0)
    .sort((x, y) => String(x.fecha || '').localeCompare(String(y.fecha || ''))).forEach(a => {
      let r = Number(a.monto)
      const fa = _t(a.fecha)
      const mesOk = (/** @type {any} */ b) => { const d = _t(b.due); return !isNaN(fa) && !isNaN(d) && fa >= d - 15 * 86400000 && fa <= d + 20 * 86400000 }
      ;(cuotas || []).filter(b => b.status === 'Programada' && _sinFolio(b) && !excluir(b)
        && (a.sale_id ? String(b.sale_id) === String(a.sale_id) : String(b.client_id) === String(a.client_id)) && (b.billing_type === 'subarriendo' ? mesOk(b) : true))
        .sort((x, y) => String(x.due || '').localeCompare(String(y.due || ''))).forEach(b => {
          if (r < 1) return
          const m = (montoFactura(b) || Number(b.amount) || 0) - (cubierto[b.id] || 0); if (!(m > 0)) return
          const u = Math.min(m, r); cubierto[b.id] = (cubierto[b.id] || 0) + u; r -= u; total += u })
    })
  return { cubierto, total }
}

/**
 * Cuadre de una venta contra su plan, en la moneda del honorario y con la UF del día de cada documento (no la congelada).
 * Cuadra hasta 3 % de diferencia · Exceso (cuotas + facturado superan el honorario pactado) · Saldo (el honorario no está cubierto por cuotas ni facturas).
 * null = no aplica (recurrente o sin plan) o falta la UF de alguna fecha: no se infiere nada.
 * @param {any} s @param {any[]} bs facturas y cuotas de la venta @param {Record<string,number>} uf
 * @returns {{estado:'Cuadra'|'Exceso'|'Saldo', plan:number, facturado:number, enCuotas:number, diferencia:number, enUF:boolean}|null}
 */
export function cuadreVenta(s, bs, uf) {
  const cv = coberturaVenta(s, bs || [], uf || {}); if (!cv || !cv.ok) return null
  const enCuotas = cv.prog.reduce((a, x) => a + x.uu, 0), dif = cv.usado + enCuotas - cv.plan, p = Math.abs(dif) / cv.plan
  const estado = p <= 0.03 ? 'Cuadra' : dif > 0 ? 'Exceso' : 'Saldo'
  return { estado, plan: cv.plan, facturado: cv.usado, enCuotas, diferencia: dif, enUF: cv.enUF }
}

/**
 * Clasifica las cuotas de la tarjeta «Por facturar» (sin folio, no pagadas, anuladas ni anticipadas, no ya facturadas según el cruce, sin
 * reembolsos de gastos) en cuatro partidas que suman el total. Orden de prioridad, de lo más a lo menos explicado:
 *  fuera (pausada · cubierta por factura · «No corresponde» · cubierta por anticipo) → por confirmar (saldo de una cuota cubierta en parte; vence hace más
 *  de `dias` y su venta no se movió en ese plazo) → vencida (la del radar «Cuotas vencidas sin facturar»; si venció pero el radar no la cuenta —anterior a la app, trabajo sin iniciar, venta no activa— queda por confirmar) → por vencer (el mes en curso y lo que viene, recurrentes incluidas).
 * `anio` y `mesAnio` ('01'..'12') limitan la tarjeta al año y mes de vencimiento, igual que los filtros de Facturación (la cobertura de cada venta sigue mirando todas sus facturas).
 * @param {{billing:any[], sales:any[], anticipos:any[], uf:Record<string,number>, noEmitir:Set<string>, yaFacturadas?:Set<string>, hoy:string, dias?:number, socioDe?:(b:any)=>string, anio?:string, mesAnio?:string, hasta?:string}} p
 */
export function clasificarPorFacturar({ billing, sales, anticipos, uf, noEmitir, yaFacturadas = new Set(), hoy, dias = POR_CONFIRMAR_DIAS, socioDe, anio = '', mesAnio = '', hasta = '' }) {
  const vivas = (billing || []).filter(b => b && !b.deleted_at)
  const venta = new Map((sales || []).filter(s => s && !s.deleted_at).map(s => [String(s.id), s]))
  const lim = new Date(_t(hoy) - dias * 86400000).toISOString().slice(0, 10), mes = hoy.slice(0, 7)
  const cub = cuotasCubiertasVenta(vivas, sales, uf)
  // «Vencida» = exactamente el radar «Cuotas vencidas sin facturar» (cuotasSinEmitir): una sola regla para Facturación, flujo, Inicio y correos.
  const radar = new Set(cuotasSinEmitir({ billing: /** @type {any} */ (vivas), sales: /** @type {any} */ (sales || []), anticipos: /** @type {any} */ (anticipos || []), uf: uf || {}, noEmitir: noEmitir || new Set(), hasta: hasta || mes + '-01' }).map(b => String(b.id)))
  const tarjeta = vivas.filter(b => (b.billing_type || '') !== 'reembolso' && !b.invoice_no && !['Pagado', 'Anulada', 'Anticipada'].includes(b.status) && !yaFacturadas.has(String(b.id)) && (!anio || String(b.due || '').slice(0, 4) === String(anio)) && (!mesAnio || String(b.due || '').slice(5, 7) === String(mesAnio)))
  const { cubierto } = anticiposSobreCuotas({ cuotas: tarjeta.filter(b => b.status === 'Programada'), anticipos,
    excluir: b => !!(noEmitir && noEmitir.has(String(b.id))) || !!(cub.get(String(b.id)) || {}).total })
  /** ¿Se movió la venta (factura emitida o pagada, o anticipo) en el plazo? Si sí, una cuota vieja es un olvido por emitir, no algo por confirmar. */
  const recurrente = (/** @type {any} */ b) => b.billing_type === 'subarriendo' || (venta.get(String(b.sale_id)) || {}).cobro_type === 'mensual' || /mensual|permanente/i.test(b.concept || '')
  const movio = (/** @type {any} */ saleId) => !!saleId && (vivas.some(b => String(b.sale_id) === String(saleId) && b.invoice_no && ((b.issued_at || '') >= lim || (b.paid_at || '') >= lim))
    || (anticipos || []).some(a => a && String(a.sale_id) === String(saleId) && String(a.fecha || '') >= lim))
  /** @type {Record<string,{n:number,m:number}>} */ const partes = {}
  /** @type {{k:string, motivo:string|null, id:string, b:any, monto:number, socio:string|null}[]} */ const filas = []
  const add = (/** @type {string} */ k, /** @type {string|null} */ motivo, /** @type {any} */ b, /** @type {number} */ m) => { filas.push({ k, motivo, id: String(b.id), b, monto: m, socio: socioDe ? socioDe(b) : null }); const x = partes[k] || (partes[k] = { n: 0, m: 0 }); x.n++; x.m += m }
  for (const b of tarjeta) {
    const amt = Number(b.amount) || 0
    if (b.status === 'Pausada') { add('fuera', 'pausada', b, amt); continue }
    let resto = amt
    const cv = cub.get(String(b.id))
    if (cv) {
      // Cubierta por lo facturado. Con ≥ 80 % facturado la cuota se da por cubierta, pero el saldo no se pierde ni se cuenta: queda por confirmar.
      const saldo = Math.min(Number(cv.saldo) || 0, cv.m)
      const m = Math.min(cv.m, resto) - saldo
      if (m > 0) add('fuera', 'cubFactura', b, m)
      if (saldo > 0) add('porConfirmar', 'saldoCuota', b, saldo)
      resto -= Math.min(cv.m, resto); if (resto < 1) continue
    }
    if (noEmitir && noEmitir.has(String(b.id))) { add('fuera', 'noCorresponde', b, resto); continue }
    if (cubierto[b.id]) { const m = Math.min(cubierto[b.id], resto); add('fuera', 'cubAnticipo', b, m); resto -= m; if (resto < 1) continue }
    const viejo = !!b.due && b.due < lim
    if (viejo && !movio(b.sale_id)) { add('porConfirmar', 'sinMovimiento', b, resto); continue }
    const motivo = recurrente(b) ? 'recurrente' : null
    if (radar.has(String(b.id))) add('vencida', motivo, b, resto)
    else if (!b.due || String(b.due).slice(0, 7) < mes || viejo) {
      // Vencida pero fuera del radar «Cuotas vencidas sin facturar»: no cuenta como vencida, queda por confirmar con su motivo.
      const vt = venta.get(String(b.sale_id))
      add('porConfirmar', !cuotaDeLaApp(b) ? 'anteriorApp' : vt && vt.status === 'Activo' ? 'sinIniciar' : 'ventaInactiva', b, resto)
    } else add('porVencer', motivo, b, resto)
  }
  const suma = (/** @type {readonly string[]} */ ks) => ks.reduce((a, k) => a + (partes[k] ? partes[k].m : 0), 0)
  const cuenta = (/** @type {readonly string[]} */ ks) => ks.reduce((a, k) => a + (partes[k] ? partes[k].n : 0), 0)
  const grupos = {
    vigente: { n: cuenta(GRUPOS.vigente), m: suma(GRUPOS.vigente) },
    porConfirmar: { n: cuenta(GRUPOS.porConfirmar), m: suma(GRUPOS.porConfirmar) },
    fuera: { n: cuenta(GRUPOS.fuera), m: suma(GRUPOS.fuera) },
  }
  return { total: grupos.vigente.m + grupos.porConfirmar.m + grupos.fuera.m, tarjeta: tarjeta.reduce((a, b) => a + (Number(b.amount) || 0), 0), partes, grupos, filas }
}

/**
 * «Cuotas vencidas sin facturar»: la partida Vencidas de Por facturar, como cuotas. Fuente ÚNICA del radar de Facturación, el cierre del mes,
 * Inicio, el flujo y los correos. `hasta` = primer día del mes desde el que las cuotas ya no cuentan (el radar mira lo anterior); `hoy` fija el plazo de «sin movimiento».
 * @param {{billing:any[], sales:any[], anticipos?:any[], uf?:Record<string,number>, noEmitir?:Set<string>, hasta:string, hoy?:string}} p
 * @returns {any[]}
 */
export function cuotasVencidasSinFacturar({ billing, sales, anticipos = [], uf = {}, noEmitir = new Set(), hasta, hoy }) {
  const r = clasificarPorFacturar({ billing, sales, anticipos, uf, noEmitir, yaFacturadas: /** @type {any} */ (noEmitir).facturadas || new Set(), hoy: hoy || hasta, hasta })
  const ids = new Set(r.filas.filter(f => f.k === 'vencida').map(f => f.id))
  return (billing || []).filter(b => b && ids.has(String(b.id)))
}
