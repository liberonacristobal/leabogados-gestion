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
