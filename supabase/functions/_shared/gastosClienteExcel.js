// Cartola y Excel de gastos de UN cliente: cada gasto con su OT, todas sus glosas sin resumir, su estado de pago y la fecha de pago.
// Funciones puras: la página Cartola, el Excel y las pruebas usan las mismas; el saldo sale de fgCliente (la misma regla de la ficha).
import { fgCliente, cuentaEnSaldo, repartoFondos, rendicionDeGasto } from './gastosReglas.js'

const PESOS = '#,##0', FECHA = 'dd-mm-yyyy'
const DIA = 86400000

/** Serie de fecha de Excel desde 'aaaa-mm-dd' (o un timestamp ISO: se toma la fecha en la zona indicada). @param {any} v @param {string} [zona] */
export function fechaExcel(v, zona = 'America/Santiago') {
  if (!v) return null
  let iso = String(v)
  if (iso.length > 10) { const d = new Date(iso); if (isNaN(d.getTime())) return null; iso = new Intl.DateTimeFormat('en-CA', { timeZone: zona }).format(d) }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); if (!m) return null
  return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / DIA)
}
/** 'aaaa-mm-dd' de una fecha o timestamp, en la zona indicada. @param {any} v @param {string} [zona] */
export function diaISO(v, zona = 'America/Santiago') {
  if (!v) return ''
  const s = String(v); if (s.length <= 10) return s.slice(0, 10)
  const d = new Date(s); return isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: zona }).format(d)
}
const fecha = (/** @type {any} */ v, /** @type {string} */ zona) => { const n = fechaExcel(v, zona); return n == null ? '' : { v: n, z: FECHA } }
const monto = (/** @type {any} */ v) => ({ v: Number(v) || 0, z: PESOS })
const txt = (/** @type {any} */ v) => v == null ? '' : String(v).trim()
const dmy = (/** @type {string} */ iso) => iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : ''
const suma = (/** @type {any[]} */ xs) => xs.reduce((a, e) => a + (Number(e.amount) || 0), 0)
const plural = (/** @type {number} */ n, /** @type {string} */ u = 'gasto') => `${n} ${u}${n === 1 ? '' : 's'}`

/** Estado de pago de un gasto: pagado si está en una liquidación a la notaría o en una rendición de caja chica (la fecha es la de esa liquidación o rendición). @param {any} e */
export function pagoDeGasto(e) {
  if (e?.notaria_liquidado_at) return { pagado: true, fecha: e.notaria_liquidado_at, medio: 'Liquidación a la notaría' }
  if (e?.rendered_at) return { pagado: true, fecha: e.rendered_at, medio: 'Rendición de caja chica' }
  return { pagado: false, fecha: null, medio: '' }
}

/** Si el gasto descuenta del saldo del cliente, o por qué no. @param {any} e */
export function descuentaSaldo(e) {
  if (!cuentaEnSaldo(e)) return 'No, resumido en el saldo de apertura'
  if (e.no_descuenta_saldo) return 'No, saldado fuera de la app'
  return 'Sí'
}

/**
 * Cartola de un cliente: fondos, gastos y pagos en orden cronológico, con tres saldos corridos.
 *  caja = fondos − pagado · por = incurrido − pagado · cli = caja − por (= fondos − gastos, el saldo de la ficha).
 * Un pago (liquidación a la notaría o rendición de caja chica) agrupa los gastos que pagó ese día.
 * @param {{ expenses: any[], clientId: any, zona?: string }} p
 */
export function cartolaCliente({ expenses, clientId, zona = 'America/Santiago' }) {
  const propios = (expenses || []).filter(e => !e.deleted_at && String(e.client_id) === String(clientId) && cuentaEnSaldo(e))
  const fondos = propios.filter(e => e.type === 'fondo'), gastos = propios.filter(e => e.type !== 'fondo' && !e.no_descuenta_saldo)
  /** @type {any[]} */
  const ev = []
  const glosa = (/** @type {any} */ e) => `${e.ot_number ? `OT ${e.ot_number} · ` : ''}${txt(e.concept).replace(/^Gastos notariales — /, '')}`
  fondos.forEach(e => ev.push({ f: diaISO(e.date, zona) || diaISO(e.created_at, zona), o: 1, k: 'Fondo', det: txt(e.concept) || 'Fondo', abono: Number(e.amount) || 0, cargo: 0, inc: 0, ref: { tipo: 'fondo', id: e.id, ids: [e.id] } }))
  gastos.forEach(e => ev.push({ f: diaISO(e.date, zona) || diaISO(e.created_at, zona), o: 0, k: 'Gasto', det: glosa(e), abono: 0, cargo: 0, inc: Number(e.amount) || 0, ref: { tipo: 'gasto', id: e.id, ids: [e.id] } }))
  /** @type {Map<string, any>} */
  const pagos = new Map()
  gastos.forEach(e => { const p = pagoDeGasto(e); if (!p.pagado) return; const f = diaISO(p.fecha, zona), k = `${f}|${p.medio}`; if (!pagos.has(k)) pagos.set(k, { f, medio: p.medio, xs: [] }); pagos.get(k).xs.push(e) })
  pagos.forEach(g => {
    const ots = [...new Set(g.xs.map((/** @type {any} */ e) => txt(e.ot_number)).filter(Boolean))]
    ev.push({ f: g.f, o: 2, k: 'Pago', det: `${g.medio} · ${ots.length ? plural(ots.length, 'OT') : plural(g.xs.length)}`, ots: ots.join(', '), abono: 0, cargo: suma(g.xs), inc: 0, ref: { tipo: 'pago', id: `${g.f}|${g.medio}`, ids: g.xs.map((/** @type {any} */ e) => e.id) } })
  })
  ev.sort((a, b) => String(a.f).localeCompare(String(b.f)) || a.o - b.o || String(a.det).localeCompare(String(b.det)))
  let caja = 0, por = 0
  ev.forEach(e => { caja += e.abono - e.cargo; por += e.inc - e.cargo; e.caja = caja; e.por = por; e.cli = caja - por })
  const fg = fgCliente(propios, clientId), fin = ev.length ? ev[ev.length - 1] : { caja: 0, por: 0, cli: 0 }
  return { eventos: ev, caja: fin.caja, por: fin.por, saldo: fin.cli, fg }
}

/**
 * Las hojas del libro de un cliente (cada hoja es una tabla; la fila «Total…» va en negrita):
 *  Cartola · Pagos (qué se pagó, cuándo y por quién) · Fondos (qué cubrió cada fondo) · Gastos (el detalle completo, sin resumir).
 * @param {{ cliente: any, expenses: any[], entidades?: any[], ventas?: any[], rendiciones?: any[], pagadoPor?: (e:any)=>string, zona?: string }} p
 */
export function hojasGastosCliente({ cliente, expenses, entidades = [], ventas = [], rendiciones = [], pagadoPor = () => '', zona = 'America/Santiago' }) {
  const cid = cliente?.id
  const propios = (expenses || []).filter(e => !e.deleted_at && String(e.client_id) === String(cid))
  const ck = (/** @type {any} */ e) => `${String(e.date || '')}|${String(e.created_at || '')}|${String(e.id || '')}`
  const orden = (/** @type {any} */ a, /** @type {any} */ b) => ck(a).localeCompare(ck(b))
  const gastos = propios.filter(e => e.type !== 'fondo').sort(orden)
  const fondos = propios.filter(e => e.type === 'fondo').sort(orden)
  const rs = (/** @type {any} */ id) => txt((entidades.find(x => String(x.id) === String(id)) || {}).name)
  const venta = (/** @type {any} */ id) => txt((ventas.find(x => String(x.id) === String(id)) || {}).title)
  const reparto = repartoFondos(propios.filter(cuentaEnSaldo), cid)
  const fondoDe = (/** @type {any} */ e) => { const d = reparto.deGasto[e.id]; if (d === undefined) return ''; if (d == null) return 'Sin fondo'; const f = fondos.find(x => x.id === d); return f ? `Fondo del ${dmy(diaISO(f.date, zona))}` : '' }

  const rendidoAlCliente = (/** @type {any} */ e) => { const r = rendicionDeGasto(e, rendiciones); return !r ? '' : r.borrador ? 'En borrador, sin enviar' : fecha(r.fecha, zona) }
  // Gastos: el detalle completo, una fila por gasto.
  const encG = ['Fecha del gasto', 'OT', 'Concepto', 'Monto', 'Estado de pago', 'Fecha de pago', 'Pagado por', 'Medio de pago', 'Fondo', 'Categoría', 'Subcategoría', 'Subconcepto', 'Descripción', 'Asunto', 'Materia', 'Requirente', 'Nota', 'Razón social', 'Trabajo', 'Subtrabajo', 'Venta', 'Rendido al cliente', 'Saldado por el cliente', 'Descuenta saldo', 'Cargado por', 'Cargado el']
  const filasG = gastos.map(e => {
    const p = pagoDeGasto(e)
    return [fecha(e.date, zona), txt(e.ot_number), txt(e.concept), monto(e.amount), p.pagado ? 'Pagado' : 'Sin pago', fecha(p.fecha, zona), txt(pagadoPor(e)), p.medio, fondoDe(e),
      txt(e.category), txt(e.subcategory), txt(e.subconcept), txt(e.description), txt(e.matter), txt(e.materia), txt(e.requirente), txt(e.notas), rs(e.entity_id), txt(e.project), txt(e.subproject), venta(e.sale_id),
      rendidoAlCliente(e), fecha(e.pagado_cliente_at, zona), e.incobrable_at ? 'Incobrable' : descuentaSaldo(e), txt(e.created_by), fecha(e.created_at, zona)]
  })
  const totG = suma(gastos)
  const gastosHoja = [encG, ...filasG, ['Total', '', '', monto(totG), ...Array(encG.length - 4).fill('')]]

  // Pagos: lo sin pago primero (por categoría) y luego lo pagado, agrupado por cada pago con su fecha, medio y quién pagó.
  const encP = ['Estado', 'Fecha de pago', 'Pagó', 'Medio de pago', 'Fondo', 'Fecha del gasto', 'OT', 'Concepto', 'Categoría', 'Monto']
  /** @type {any[][]} */
  const pagosHoja = [encP]
  const filaP = (/** @type {any} */ e) => { const p = pagoDeGasto(e); pagosHoja.push([p.pagado ? 'Pagado' : 'Sin pago', fecha(p.fecha, zona), p.pagado ? txt(pagadoPor(e)) : '', p.medio, fondoDe(e), fecha(e.date, zona), txt(e.ot_number), txt(e.concept), txt(e.category), monto(e.amount)]) }
  const subP = (/** @type {string} */ r, /** @type {any[]} */ xs) => pagosHoja.push([r, '', '', '', '', '', '', plural(xs.length), '', monto(suma(xs))])
  const sinPago = gastos.filter(e => !pagoDeGasto(e).pagado), pagados = gastos.filter(e => pagoDeGasto(e).pagado)
  /** @type {Map<string, any[]>} */
  const cats = new Map(); sinPago.forEach(e => { const k = txt(e.category) || 'Sin categoría'; if (!cats.has(k)) cats.set(k, []); /** @type {any[]} */ (cats.get(k)).push(e) })
  ;[...cats.entries()].sort((a, b) => (a[0] === 'Notaria' ? -1 : b[0] === 'Notaria' ? 1 : suma(b[1]) - suma(a[1]))).forEach(([k, xs]) => { xs.forEach(filaP); subP(`Total sin pago, ${k === 'Notaria' ? 'notaría' : k}`, xs) })
  if (sinPago.length) subP('Total sin pago', sinPago)
  /** @type {Map<string, any>} */
  const porPago = new Map(); pagados.forEach(e => { const p = pagoDeGasto(e), f = diaISO(p.fecha, zona), k = `${f}|${p.medio}`; if (!porPago.has(k)) porPago.set(k, { f, medio: p.medio, xs: [] }); porPago.get(k).xs.push(e) })
  ;[...porPago.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([, g]) => { g.xs.forEach(filaP); subP(`Total pagado el ${dmy(g.f)}, ${g.medio.toLowerCase()}`, g.xs) })
  if (pagados.length) subP('Total pagado', pagados)
  subP('Total gastos cargados', gastos)

  // Fondos: cada fondo con los gastos que cubrió y lo que queda; al final lo que ningún fondo cubrió (a pedir al cliente).
  const encF = ['Fondo', 'Fecha del gasto', 'OT', 'Concepto', 'Estado de pago', 'Fecha de pago', 'Monto']
  /** @type {any[][]} */
  const fondosHoja = [encF]
  reparto.fondos.forEach(x => {
    const f = x.f, et = `Fondo del ${dmy(diaISO(f.date, zona))}${txt(f.project) ? `, ${txt(f.project)}` : ''}`
    fondosHoja.push([et, fecha(f.date, zona), '', txt(f.concept) || 'Fondo', '', '', monto(f.amount)])
    ;[...x.gastos].sort(orden).forEach((/** @type {any} */ e) => { const p = pagoDeGasto(e); fondosHoja.push([et, fecha(e.date, zona), txt(e.ot_number), txt(e.concept), p.pagado ? 'Pagado' : 'Sin pago', fecha(p.fecha, zona), monto(-(Number(e.amount) || 0))]) })
    fondosHoja.push([`Total fondo del ${dmy(diaISO(f.date, zona))}, cubrió ${Math.round(suma(x.gastos)).toLocaleString('es-CL')}`, '', '', plural(x.gastos.length), '', '', monto(x.quedan)])
  })
  const sinF = reparto.sinFondo.filter((/** @type {any} */ e) => e.type === 'gasto')
  if (sinF.length) {
    sinF.sort(orden).forEach((/** @type {any} */ e) => { const p = pagoDeGasto(e); fondosHoja.push(['Sin fondo, a pedir al cliente', fecha(e.date, zona), txt(e.ot_number), txt(e.concept), p.pagado ? 'Pagado' : 'Sin pago', fecha(p.fecha, zona), monto(-(Number(e.amount) || 0))]) })
    fondosHoja.push(['Total sin fondo', '', '', plural(sinF.length), '', '', monto(-suma(sinF))])
  }

  // Cartola: la misma que la página de la app.
  const cart = cartolaCliente({ expenses: propios, clientId: cid, zona })
  const encC = ['Fecha', 'Movimiento', 'Detalle', 'Abono', 'Pago', 'Gasto', 'Saldo en caja', 'Por pagar', 'Saldo del cliente']
  const cartolaHoja = [encC, ...cart.eventos.map((/** @type {any} */ e) => [fecha(e.f, zona), e.k, e.ots ? `${e.det}: ${e.ots}` : e.det, e.abono ? monto(e.abono) : '', e.cargo ? monto(-e.cargo) : '', e.inc ? monto(-e.inc) : '', monto(e.caja), monto(e.por), monto(e.cli)]),
    ['Total al cierre', '', '', '', '', '', monto(cart.caja), monto(cart.por), monto(cart.saldo)]]

  return { cartola: cartolaHoja, pagos: pagosHoja, fondos: fondosHoja, gastos: gastosHoja, totales: { gastos: totG, fondos: suma(fondos), saldo: cart.fg.saldo, caja: cart.caja, por: cart.por, nGastos: gastos.length, nFondos: fondos.length } }
}
