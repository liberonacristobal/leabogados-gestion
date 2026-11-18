// Excel de gastos de UN cliente: cada gasto con su OT, todas sus glosas sin resumir, su estado de pago y la fecha de pago.
// Funciones puras: la app las usa para armar el libro y las pruebas verifican que las cifras salgan de la misma regla del saldo (fgCliente).
import { fgCliente, cuentaEnSaldo } from './gastosReglas.js'

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
const cel = (/** @type {number|null} */ n, /** @type {string} */ z) => n == null ? '' : { v: n, z }
const fecha = (/** @type {any} */ v, /** @type {string} */ zona) => { const n = fechaExcel(v, zona); return n == null ? '' : { v: n, z: FECHA } }
const monto = (/** @type {any} */ v) => ({ v: Number(v) || 0, z: PESOS })
const txt = (/** @type {any} */ v) => v == null ? '' : String(v).trim()

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
 * Las tres hojas del libro de un cliente. Cada hoja es una tabla (primera fila = encabezado; la fila «Total» va en negrita).
 * @param {{ cliente: any, expenses: any[], entidades?: any[], ventas?: any[], pagadoPor?: (e:any)=>string, zona?: string }} p
 */
export function hojasGastosCliente({ cliente, expenses, entidades = [], ventas = [], pagadoPor = () => '', zona = 'America/Santiago' }) {
  const cid = cliente?.id
  const propios = (expenses || []).filter(e => !e.deleted_at && String(e.client_id) === String(cid))
  const ck = (/** @type {any} */ e) => `${String(e.date || '')}|${String(e.created_at || '')}|${String(e.id || '')}`
  const orden = (/** @type {any} */ a, /** @type {any} */ b) => ck(a).localeCompare(ck(b))
  const gastos = propios.filter(e => e.type !== 'fondo').sort(orden)
  const fondos = propios.filter(e => e.type === 'fondo').sort(orden)
  const rs = (/** @type {any} */ id) => txt((entidades.find(x => String(x.id) === String(id)) || {}).name)
  const venta = (/** @type {any} */ id) => txt((ventas.find(x => String(x.id) === String(id)) || {}).title)

  const encG = ['Fecha del gasto', 'OT', 'Concepto', 'Monto', 'Estado de pago', 'Fecha de pago', 'Pagado por', 'Medio de pago', 'Categoría', 'Subcategoría', 'Subconcepto', 'Descripción', 'Asunto', 'Materia', 'Requirente', 'Nota', 'Razón social', 'Trabajo', 'Subtrabajo', 'Venta', 'Rendido al cliente', 'Saldado por el cliente', 'Descuenta saldo', 'Cargado por', 'Cargado el']
  const filasG = gastos.map(e => {
    const p = pagoDeGasto(e)
    return [fecha(e.date, zona), txt(e.ot_number), txt(e.concept), monto(e.amount), p.pagado ? 'Pagado' : 'Sin pago', fecha(p.fecha, zona), txt(pagadoPor(e)), p.medio,
      txt(e.category), txt(e.subcategory), txt(e.subconcept), txt(e.description), txt(e.matter), txt(e.materia), txt(e.requirente), txt(e.notas), rs(e.entity_id), txt(e.project), txt(e.subproject), venta(e.sale_id),
      fecha(e.client_rendered_at, zona), fecha(e.pagado_cliente_at, zona), e.incobrable_at ? 'Incobrable' : descuentaSaldo(e), txt(e.created_by), fecha(e.created_at, zona)]
  })
  const totG = gastos.reduce((a, e) => a + (Number(e.amount) || 0), 0)
  const gastosHoja = [encG, ...filasG, ['Total', '', '', monto(totG), ...Array(encG.length - 4).fill('')]]

  const encF = ['Fecha', 'Concepto', 'Descripción', 'Nota', 'Monto', 'Razón social', 'Trabajo', 'Cargado por']
  const filasF = fondos.map(e => [fecha(e.date, zona), txt(e.concept), txt(e.description), txt(e.notas), monto(e.amount), rs(e.entity_id), txt(e.project), txt(e.created_by)])
  const totF = fondos.reduce((a, e) => a + (Number(e.amount) || 0), 0)
  const fondosHoja = [encF, ...filasF, ['Total', '', '', '', monto(totF), '', '', '']]

  // Resumen: el saldo sale de fgCliente (misma regla que la ficha); el resto agrupa los mismos gastos de la hoja «Gastos».
  const fg = fgCliente(propios, cid)
  const nFuera = gastos.filter(e => cuentaEnSaldo(e) && e.no_descuenta_saldo)
  const suma = (/** @type {any[]} */ xs) => xs.reduce((a, e) => a + (Number(e.amount) || 0), 0)
  /** @type {any[][]} */
  const res = [['Grupo', 'Partida', 'Gastos', 'Monto']]
  const fila = (/** @type {string} */ g, /** @type {string} */ p, /** @type {any} */ n, /** @type {number} */ m) => res.push([g, p, n, monto(m)])
  fila('Saldo', 'Fondos recibidos', fondos.filter(cuentaEnSaldo).length, fg.fondos)
  fila('Saldo', 'Gastos que descuentan saldo', gastos.filter(e => cuentaEnSaldo(e) && !e.no_descuenta_saldo).length, fg.gastos)
  fila('Saldo', 'Saldo', '', fg.saldo)
  if (nFuera.length) fila('Saldo', 'Gastos saldados fuera de la app (no descuentan)', nFuera.length, suma(nFuera))
  const grupo = (/** @type {string} */ g, /** @type {(e:any)=>string} */ clave, /** @type {string[]} */ fijas = []) => {
    /** @type {Map<string, any[]>} */
    const m = new Map(); fijas.forEach(k => m.set(k, []))
    gastos.forEach(e => { const k = clave(e) || 'Sin dato'; if (!m.has(k)) m.set(k, []); /** @type {any[]} */ (m.get(k)).push(e) })
    ;[...m.entries()].filter(([, xs]) => xs.length).sort((a, b) => suma(b[1]) - suma(a[1])).forEach(([k, xs]) => fila(g, k, xs.length, suma(xs)))
  }
  grupo('Estado de pago', e => pagoDeGasto(e).pagado ? 'Pagado' : 'Sin pago', ['Pagado', 'Sin pago'])
  grupo('Pagado por', e => txt(pagadoPor(e)))
  grupo('Categoría', e => txt(e.category))
  res.push(['Total gastos cargados', '', gastos.length, monto(totG)])

  return { resumen: res, gastos: gastosHoja, fondos: fondosHoja, totales: { gastos: totG, fondos: totF, saldo: fg.saldo, nGastos: gastos.length, nFondos: fondos.length } }
}
