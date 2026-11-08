// Liquidaciones de sueldo leídas del correo de la contadora: de cada (período, persona) manda la versión MÁS RECIENTE del correo, porque ella reenvía
// corregidas. Función pura: no lee ni escribe la base.

/**
 * @param {{periodo:string, persona:string, _t?:number}[]} filas liquidaciones leídas, en cualquier orden; _t = fecha del correo (ms)
 * @returns {Record<string, any>[]} una por (período, persona), ordenadas por período, sin el campo _t
 */
export function liquidacionesVigentes(filas) {
  const unico = new Map()
  for (const f of [...(filas || [])].sort((a, b) => (a._t || 0) - (b._t || 0))) unico.set(`${f.periodo}|${f.persona}`, f)   // la más reciente pisa a la anterior
  return [...unico.values()].map(({ _t, ...f }) => f).sort((a, b) => String(a.periodo).localeCompare(String(b.periodo)) || String(a.persona).localeCompare(String(b.persona)))
}

/**
 * Cotizaciones provisorias de un mes, mientras la contadora no manda sus valores: cotizaciones del trabajador de las liquidaciones del mes más la parte
 * del empleador del último mes con valores reales (cotización real − la del trabajador), proporcional al imponible.
 * @param {{mes:{imponible:number, cotizaciones:number}[], previo:{imponible:number, cotizaciones:number}[], cotizPrevReal:number}} p
 * @returns {{cotizaciones:number, tasaEmpleador:number, trabajador:number, empleador:number}|null} null si falta algún dato (no se inventa)
 */
export function cotizacionesProvisorias({ mes, previo, cotizPrevReal }) {
  const suma = (/** @type {any[]} */ a, /** @type {string} */ k) => (a || []).reduce((s, x) => s + (Number(x && x[k]) || 0), 0)
  const impMes = suma(mes, 'imponible'), trabMes = suma(mes, 'cotizaciones'), impPrev = suma(previo, 'imponible'), trabPrev = suma(previo, 'cotizaciones')
  if (!(impMes > 0) || !(trabMes > 0) || !(impPrev > 0) || !(Number(cotizPrevReal) > 0)) return null
  const empPrev = Number(cotizPrevReal) - trabPrev
  if (!(empPrev >= 0)) return null
  const tasaEmpleador = empPrev / impPrev, empleador = tasaEmpleador * impMes
  return { cotizaciones: Math.round(trabMes + empleador), tasaEmpleador, trabajador: trabMes, empleador: Math.round(empleador) }
}
