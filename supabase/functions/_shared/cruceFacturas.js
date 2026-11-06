// Veto del cruce factura emitida ↔ cuota programada. El cruce por RUT, monto y fecha propone pares; este veto descarta los que no
// pueden ser: la factura ya pertenece a OTRA venta, o su glosa nombra otro trabajo del mismo cliente. Solo descarta, nunca agrega pares:
// ante la duda no se afirma nada (conservador). Funciones puras: no leen ni escriben la base.

const _norm = (/** @type {any} */ s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
// Palabras que no identifican un trabajo (genéricas, de cuota o de calendario).
const _STOP = new Set(['servicios', 'servicio', 'asesoria', 'legales', 'legal', 'honorarios', 'cuota', 'cobro', 'pago', 'equivalente', 'mensual', 'permanente', 'inicial', 'final', 'proyecto',
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'])
/** Palabras de 5 letras o más que identifican un trabajo. @param {any} s @returns {Set<string>} */
export const palabrasDeGlosa = s => new Set(_norm(s).split(/[^a-z0-9]+/).filter(w => w.length >= 5 && !_STOP.has(w)))

/**
 * Índice de ventas para el veto por glosa.
 * @param {any[]} sales @returns {{porId: Map<string, any>, porCliente: Map<string, any[]>}}
 */
export function indexVentas(sales) {
  const porId = new Map(), porCliente = new Map()
  ;(sales || []).forEach(s => { if (!s || s.deleted_at) return; porId.set(String(s.id), s); const k = String(s.client_id); porCliente.set(k, [...(porCliente.get(k) || []), s]) })
  return { porId, porCliente }
}

/**
 * ¿Este par no puede ser? 'otra_venta' = ambas filas tienen venta y es distinta · 'otra_glosa' = la glosa de la factura comparte palabras con
 * otra venta del mismo cliente y ninguna con la venta ni el concepto de la cuota. null = el par sigue en pie.
 * @param {any} prog cuota Programada @param {any} emitida factura emitida
 * @param {{porId: Map<string, any>, porCliente: Map<string, any[]>}} [idx] sin índice solo vale el veto por venta
 * @returns {'otra_venta'|'otra_glosa'|null}
 */
export function vetoCruce(prog, emitida, idx) {
  if (prog && emitida && prog.sale_id && emitida.sale_id && String(prog.sale_id) !== String(emitida.sale_id)) return 'otra_venta'
  if (!idx || !prog || !emitida) return null
  const glosa = palabrasDeGlosa(emitida.concept); if (!glosa.size) return null
  const suya = idx.porId.get(String(prog.sale_id))
  const propias = new Set([...palabrasDeGlosa(suya && suya.title), ...palabrasDeGlosa(prog.concept)])
  if ([...glosa].some(w => propias.has(w))) return null
  const otras = (idx.porCliente.get(String(prog.client_id)) || []).filter(s => String(s.id) !== String(prog.sale_id))
  return otras.some(s => { const t = palabrasDeGlosa(s.title); return [...glosa].some(w => t.has(w)) }) ? 'otra_glosa' : null
}
