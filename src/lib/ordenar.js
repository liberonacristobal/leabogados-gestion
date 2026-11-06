// Orden de columnas de una tabla: un toque ordena de menor a mayor, otro de mayor a menor, un tercero vuelve al orden original.
// Lo vacío va siempre al final; los números se comparan como números, el texto sin tildes ni mayúsculas y con los números dentro del texto en orden natural (N° 2 antes de N° 10).
export const compararValores = (a, b) => {
  const va = a == null || a === '' || (typeof a === 'number' && Number.isNaN(a)), vb = b == null || b === '' || (typeof b === 'number' && Number.isNaN(b))
  if (va || vb) return va === vb ? 0 : va ? 1 : -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), 'es', { sensitivity: 'base', numeric: true })
}
export const siguienteOrden = (actual, clave) => (!actual || actual.k !== clave) ? { k: clave, d: 1 } : actual.d === 1 ? { k: clave, d: -1 } : null
export const ordenarFilas = (filas, orden, accesores) => {
  const f = orden && accesores && accesores[orden.k]
  if (!f) return filas
  // El vacío queda al final también al invertir: se invierte solo la comparación de lo que tiene valor.
  return filas.map((x, i) => [x, i, f(x)]).sort((p, q) => {
    const vp = p[2] == null || p[2] === '', vq = q[2] == null || q[2] === ''
    if (vp || vq) return vp === vq ? p[1] - q[1] : vp ? 1 : -1
    return compararValores(p[2], q[2]) * orden.d || p[1] - q[1]
  }).map(p => p[0])
}

// Selección por rango (Shift): los ids entre el último marcado y el actual, en el orden en que se ven en la lista; incluye ambos extremos.
export const rangoIds = (ids, desde, hasta) => {
  const a = ids.indexOf(desde), b = ids.indexOf(hasta)
  if (a < 0 || b < 0) return [hasta]
  return ids.slice(Math.min(a, b), Math.max(a, b) + 1)
}

// Aplica un rango a una selección. marcar = lo contrario del estado de la fila tocada. Al marcar, las filas con tope (fondo disponible de un cliente)
// se agregan en orden mientras el total del grupo no lo pase; info: Map id -> { tope, usado, monto } (tope y usado iguales = mismo grupo).
export const aplicarRango = (prev, rango, id, info) => {
  const n = new Set(prev), marcar = !prev.has(id), usado = {}
  rango.forEach(x => {
    if (!marcar) { n.delete(x); return }
    if (n.has(x)) return
    const f = info && info.get(x)
    if (f && f.tope != null) {
      const k = f.tope + '|' + f.usado
      if (usado[k] == null) usado[k] = f.usado || 0
      if (usado[k] + (f.monto || 0) > f.tope) return
      usado[k] += f.monto || 0
    }
    n.add(x)
  })
  if (marcar) n.add(id)
  return n
}
