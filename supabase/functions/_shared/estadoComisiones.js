// «Estado de comisiones» de un proveedor (PDF carta e imagen): tres secciones (pagadas por mes de pago, por pagar y sujetas a cobro).
// Recibe las comisiones ya clasificadas por la vista (estado y monto salen de los mismos helpers de la ficha); aquí solo se agrupa y se recorta. Funciones puras.

/** @typedef {{estado:'pagada'|'por_pagar'|'por_devengar', cliente:string, concepto:string, fecha?:string|null, monto:number, detalle?:string}} ItemComision */

const MES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const n = (/** @type {any} */ x) => Number(x) || 0
/** @param {number} x */
export const pesos = x => '$' + Math.round(n(x)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
/** @param {any} iso */
export const dmy = iso => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : '' }

/** Agrupa pagadas por mes de pago (más nuevo primero; dentro del mes, por fecha descendente); por pagar y sujetas, de la más antigua a la más nueva.
 *  @param {ItemComision[]} items */
export function armarEstadoComisiones(items) {
  const por = (/** @type {string} */ e) => items.filter(i => i.estado === e)
  const suma = (/** @type {ItemComision[]} */ a) => a.reduce((s, i) => s + n(i.monto), 0)
  const pag = por('pagada'), g = /** @type {Map<string, ItemComision[]>} */ (new Map())
  for (const i of pag) { const ym = String(i.fecha || '').slice(0, 7) || 'sin-fecha'; (g.get(ym) || g.set(ym, []).get(ym))?.push(i) }
  const meses = [...g.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([ym, filas]) => ({
    ym, total: suma(filas), filas: filas.slice().sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')) || a.cliente.localeCompare(b.cliente)) }))
  const orden = (/** @type {ItemComision[]} */ a) => a.slice().sort((x, y) => String(x.fecha || '9').localeCompare(String(y.fecha || '9')) || x.cliente.localeCompare(y.cliente))
  const porPagar = orden(por('por_pagar')), sujeto = orden(por('por_devengar'))
  const fechas = pag.map(i => String(i.fecha || '')).filter(Boolean).sort()
  return { meses, porPagar, sujeto, totales: { pagado: suma(pag), porPagar: suma(porPagar), sujeto: suma(sujeto) }, desde: fechas[0] || null, hasta: fechas[fechas.length - 1] || null }
}

/** Etiqueta de mes («Octubre 2026») desde AAAA-MM. @param {string} ym */
export const mesTitulo = ym => { const [a, m] = ym.split('-'); return MES[Number(m) - 1] ? `${MES[Number(m) - 1]} ${a}` : 'Sin fecha de pago' }

/** Resumen corto para la imagen: las últimas `n` pagadas (por fecha de pago) y todas las por pagar. No incluye «sujeto a cobro».
 *  @param {ItemComision[]} items @param {number} [n] */
export function resumenReciente(items, n = 6) {
  const pagadas = items.filter(i => i.estado === 'pagada').sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || ''))).slice(0, n)
  const porPagar = items.filter(i => i.estado === 'por_pagar').sort((a, b) => String(a.fecha || '9').localeCompare(String(b.fecha || '9')))
  const suma = (/** @type {ItemComision[]} */ a) => a.reduce((s, i) => s + n_(i.monto), 0)
  return { pagadas, porPagar, totalPagadas: suma(pagadas), totalPorPagar: suma(porPagar) }
}
const n_ = n
