// costoIA.js — gasto de la IA del mes contra su tope. Fuente única de la tarjeta «Consumo de IA» (Procesos automáticos) y del aviso del resumen del lunes.
// Estimación: llamadas registradas en ia_uso_diario por el precio de lista de cada modelo; la consola de Anthropic es la cifra de cobro y puede mostrar más.
// Función pura, con prueba en tests/costo-ia.test.mjs.

/**
 * USD por millón de tokens. Fuente: https://platform.claude.com/docs/en/about-claude/pricing (consultada el 08-11-2026).
 * Un modelo que no está aquí no se valora: se informa en `sinPrecio` en vez de inventarle un precio.
 * @type {Record<string, {entrada:number, salida:number, cacheEscritura:number, cacheLectura:number}>}
 */
export const PRECIOS_IA = {
  'claude-opus-5-5': { entrada: 4, salida: 20, cacheEscritura: 5, cacheLectura: 0.2 },
  'claude-opus-5': { entrada: 5, salida: 25, cacheEscritura: 6.25, cacheLectura: 0.5 },
  'claude-opus-4-8': { entrada: 5, salida: 25, cacheEscritura: 6.25, cacheLectura: 0.5 },
  'claude-sonnet-5-5': { entrada: 2, salida: 10, cacheEscritura: 2.5, cacheLectura: 0.1 },
  'claude-sonnet-4-6': { entrada: 3, salida: 15, cacheEscritura: 3.75, cacheLectura: 0.3 },
}

const num = (/** @type {any} */ x) => { const n = Number(x); return Number.isFinite(n) && n > 0 ? n : 0 }

/** Precio del modelo (acepta el id con sufijo de fecha, p. ej. «claude-sonnet-4-6-20260101»), o null si no está en la tabla. @param {string} modelo */
export function precioDe(modelo) {
  const m = String(modelo || '')
  if (PRECIOS_IA[m]) return PRECIOS_IA[m]
  const k = Object.keys(PRECIOS_IA).filter((x) => m.startsWith(x + '-')).sort((a, b) => b.length - a.length)[0]
  return k ? PRECIOS_IA[k] : null
}

/** Costo en USD de una fila (llamada o día agrupado), o null si el modelo no tiene precio. @param {{modelo:string, entrada?:number, salida?:number, cache_lectura?:number, cache_escritura?:number}} f */
export function costoUSD(f) {
  const p = precioDe(f.modelo)
  if (!p) return null
  return (num(f.entrada) * p.entrada + num(f.salida) * p.salida + num(f.cache_lectura) * p.cacheLectura + num(f.cache_escritura) * p.cacheEscritura) / 1e6
}

/** Redondea a centavos repartiendo el resto para que las partes sumen el total redondeado. @param {number[]} partes @returns {number[]} USD con 2 decimales */
export function centavos(partes) {
  const v = partes.map((x) => (Number(x) || 0) * 100), tot = Math.round(v.reduce((a, x) => a + x, 0))
  const out = v.map((x) => Math.floor(x)); let falta = tot - out.reduce((a, x) => a + x, 0)
  const ord = v.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0])
  for (let k = 0; falta > 0 && ord.length; k = (k + 1) % ord.length, falta--) out[ord[k][1]]++
  return out.map((x) => x / 100)
}

/**
 * Gasto de un mes. Las filas de funciones se ordenan por costo y suman el total al centavo.
 * @param {{dia:string, funcion:string, modelo:string, llamadas?:number, fallas?:number, entrada?:number, salida?:number, cache_lectura?:number, cache_escritura?:number}[]} filas ia_uso_diario
 * @param {string} mes «AAAA-MM»
 * @returns {{usd:number, llamadas:number, tokens:number, porFuncion:{funcion:string, usd:number, llamadas:number, fallas:number, tokens:number, modelos:string[]}[], sinPrecio:string[]}}
 */
export function gastoDelMes(filas, mes) {
  /** @type {Map<string, {funcion:string, usd:number, llamadas:number, fallas:number, tokens:number, modelos:Set<string>}>} */
  const por = new Map(), sinPrecio = new Set()
  let llamadas = 0, tokens = 0
  for (const f of filas || []) {
    if (!String(f.dia || '').startsWith(mes)) continue
    const c = costoUSD(f)
    if (c == null) sinPrecio.add(String(f.modelo))
    const g = por.get(f.funcion) || { funcion: f.funcion, usd: 0, llamadas: 0, fallas: 0, tokens: 0, modelos: new Set() }
    g.usd += c || 0; g.llamadas += num(f.llamadas); g.fallas += num(f.fallas); g.tokens += num(f.entrada) + num(f.salida)
    g.modelos.add(String(f.modelo)); por.set(f.funcion, g)
    llamadas += num(f.llamadas); tokens += num(f.entrada) + num(f.salida)
  }
  const lista = [...por.values()].sort((a, b) => b.usd - a.usd)
  const cents = centavos(lista.map((g) => g.usd))
  return {
    usd: Math.round(cents.reduce((a, x) => a + x, 0) * 100) / 100, llamadas, tokens,
    porFuncion: lista.map((g, i) => ({ funcion: g.funcion, usd: cents[i], llamadas: g.llamadas, fallas: g.fallas, tokens: g.tokens, modelos: [...g.modelos].sort() })),
    sinPrecio: [...sinPrecio].sort(),
  }
}

/**
 * Cuánto queda del tope y en qué nivel está: «sobre» desde el 100 %, «cerca» desde el 80 %.
 * @param {number} usd gasto del mes @param {number} tope tope mensual en USD (0 o inválido = sin tope)
 * @returns {{tope:number, queda:number, pct:number, nivel:'ok'|'cerca'|'sobre'}|null} null si no hay tope
 */
export function estadoTope(usd, tope) {
  const t = Number(tope)
  if (!(t > 0)) return null
  const pct = (Number(usd) || 0) / t
  return { tope: t, queda: Math.max(0, Math.round((t - (Number(usd) || 0)) * 100) / 100), pct, nivel: pct >= 1 ? 'sobre' : pct >= 0.8 ? 'cerca' : 'ok' }
}
