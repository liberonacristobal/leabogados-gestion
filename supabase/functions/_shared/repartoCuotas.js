// Reparto de comisiones de una venta entre sus cuotas (cobros). Una fila del reparto (proveedor + tipo + valor)
// se aplica a TODAS las cuotas, o solo desde un mes (`desde`), o solo a cuotas elegidas (`solo`: ids de cuota).
// `solo` sirve cuando la comisión es de un ítem de la venta (ej. solo el término de giro) y no de todo el honorario.

/** @typedef {{id:string|number, due?:string|null}} CuotaReparto */
/** @typedef {{desde?:string|null, solo?:(string|number)[]|null}} FilaReparto */

/** ¿La cuota entra en la fila? Con `solo` manda esa lista; sin ella, `desde` (mes, «en adelante»); sin ninguna, todas.
 * @param {FilaReparto} fila @param {CuotaReparto} cuota */
export function cuotaEntra(fila, cuota) {
  const solo = Array.isArray(fila?.solo) ? fila.solo.map(String) : []
  if (solo.length) return solo.includes(String(cuota.id))
  if (fila?.desde && String(cuota.due || '').slice(0, 7) < String(fila.desde)) return false
  return true
}

/** Cuotas de la venta a las que se aplica la fila, ya sin las que ese proveedor tiene pagadas.
 * @param {FilaReparto & {proveedor_id?:string|number}} fila @param {CuotaReparto[]} cuotas @param {Set<string>} [pagadas] claves `proveedor|cuota`
 * @returns {CuotaReparto[]} */
export function cuotasLibres(fila, cuotas, pagadas = new Set()) {
  return (cuotas || []).filter(c => !pagadas.has(`${fila?.proveedor_id}|${c.id}`) && cuotaEntra(fila, c))
}

/** Al reabrir la venta se reconstruye la fila desde sus comisiones: si cubren las cuotas desde la más antigua en adelante
 * sin saltos, basta `desde` (mes); si no (cuotas salteadas o un ítem suelto), se guarda `solo` con las cuotas exactas.
 * @param {string[]} idsConComision cuotas con comisión de esa fila @param {CuotaReparto[]} cuotas todas las de la venta
 * @returns {{desde:string, solo:string[]}} */
export function inferirAlcance(idsConComision, cuotas) {
  const ids = new Set((idsConComision || []).map(String))
  const ord = [...(cuotas || [])].sort((a, b) => String(a.due || '').localeCompare(String(b.due || '')) || String(a.id).localeCompare(String(b.id)))
  const cubiertas = ord.filter(c => ids.has(String(c.id)))
  if (!cubiertas.length || cubiertas.length >= ord.length) return { desde: '', solo: [] }
  const primera = ord.indexOf(cubiertas[0])
  const sufijo = ord.slice(primera).every(c => ids.has(String(c.id)))   // desde la primera hasta el final, sin saltos
  const mesDup = ord.some((c, i) => i !== primera && String(c.due || '').slice(0, 7) === String(ord[primera].due || '').slice(0, 7) && !ids.has(String(c.id)) && ord.indexOf(c) < primera)
  return sufijo && !mesDup ? { desde: String(ord[primera].due || '').slice(0, 7), solo: [] } : { desde: '', solo: cubiertas.map(c => String(c.id)) }
}
