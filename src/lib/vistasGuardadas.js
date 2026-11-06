// Vistas guardadas: una combinación de filtros de una lista con nombre (por ejemplo «Erasmo · con pendientes»), guardada por usuario.
// Aquí vive lo que no depende de la pantalla: orden estable de la combinación, comparación, nombre único y tope.
export const TOPE_VISTAS = 12

// Forma canónica de una combinación: mismas claves en el mismo orden y listas ordenadas, para poder compararlas.
export const canonica = f => {
  const o = {}
  Object.keys(f || {}).sort().forEach(k => {
    const v = f[k]
    if (v == null || v === '' || v === false || (Array.isArray(v) && v.length === 0)) return   // lo vacío no cuenta
    o[k] = Array.isArray(v) ? [...v].map(String).sort() : v
  })
  return o
}
export const mismaVista = (a, b) => JSON.stringify(canonica(a)) === JSON.stringify(canonica(b))
export const hayFiltro = (f, porDefecto = {}) => !mismaVista(f, porDefecto)

// Agrega una vista: nombre sin espacios sobrantes; si el nombre ya existe la reemplaza; no pasa del tope. Devuelve {lista, error}.
export function agregarVista(lista, nombre, filtros, { id = String(Date.now()) } = {}) {
  const n = String(nombre || '').replace(/\s+/g, ' ').trim().slice(0, 40)
  if (!n) return { lista, error: 'Escribe un nombre' }
  const sin = (lista || []).filter(v => v.nombre.toLowerCase() !== n.toLowerCase())
  if (sin.length >= TOPE_VISTAS) return { lista, error: `Máximo ${TOPE_VISTAS} vistas: borra una` }
  return { lista: [...sin, { id, nombre: n, f: canonica(filtros) }], error: null }
}
export const quitarVista = (lista, id) => (lista || []).filter(v => v.id !== id)

// El valor se guarda como texto en una sola fila por usuario y lista (learnings, kind vista_guardada); un texto dañado no rompe la lista.
export const leerVistas = texto => {
  try { const a = JSON.parse(texto || '[]'); return Array.isArray(a) ? a.filter(v => v && v.id && v.nombre && v.f && typeof v.f === 'object') : [] } catch (_) { return [] }
}
export const claveVistas = (email, lista) => `${String(email || '').toLowerCase()}|${lista}`
