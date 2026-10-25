// paginar.js — lectura completa de tablas grandes. Fuente única para la app (src/supabase.js) y las funciones del servidor.
// Supabase corta cada consulta en 1.000 filas sin avisar: una tabla que crece (facturas, gastos, conciliación) deja de leerse
// entera y la cifra queda corta en silencio. Toda lectura de una tabla que puede pasar de 1.000 filas va por aquí.
// Las páginas necesitan un orden estable; sin él, Postgres puede repetir o saltarse filas entre una página y la siguiente.

export const PAGINA = 1000
const MAX_PAGINAS = 100

// Cliente supabase-js. `build` arma la consulta desde cero en cada página y trae su orden (desempatar por id).
export async function selectAll(build, size = PAGINA) {
  let all = [], from = 0
  for (let i = 0; i < MAX_PAGINAS; i++) {
    const qb = build()
    if (typeof qb.range !== 'function') return await qb   // demo: el cliente simulado no pagina
    const { data, error } = await qb.range(from, from + size - 1)
    if (error) return { data: null, error }
    all = all.concat(data || [])
    if (!data || data.length < size) break
    from += size
  }
  return { data: all, error: null }
}

// Tablas sin columna id: se ordenan por su llave primaria.
const ORDEN_PK = { miembros: 'email.asc', indicadores: 'codigo.asc,fecha.asc', tgr_remates: 'sk.asc' }

// Agrega el orden estable a una ruta REST si no lo trae (las rpc/ no se ordenan).
export function conOrden(path) {
  if (/[?&]order=/.test(path) || /^rpc\//.test(path)) return path
  const tabla = path.split('?')[0]
  return `${path}${path.includes('?') ? '&' : '?'}order=${ORDEN_PK[tabla] || 'id.asc'}`
}

// API REST (fetch) con la clave de servicio. Lanza error si una página falla: mejor no correr que correr con datos cortos.
export async function todasRest(sbUrl, headers, path, size = PAGINA) {
  const p = conOrden(path), out = []
  for (let i = 0; i < MAX_PAGINAS; i++) {
    const r = await fetch(`${sbUrl}/rest/v1/${p}`, { headers: { ...headers, Range: `${i * size}-${i * size + size - 1}` } })
    if (!r.ok) throw new Error(`${path.split('?')[0]}: ${r.status}`)
    const filas = await r.json(); out.push(...filas)
    if (filas.length < size) break
  }
  return out
}
