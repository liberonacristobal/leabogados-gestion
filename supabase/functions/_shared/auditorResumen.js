// Resumen de lo que sigue abierto para el correo del auditor nocturno: por tipo de caso, cuántos son y hace cuántos días
// está abierto el más antiguo. Pura (sin red ni base): la usa la edge auditor-datos y se prueba en tests/auditor-resumen.test.mjs.

const DIA = 864e5

/**
 * Casos vigentes que ya estaban abiertos de antes (no los nuevos), agrupados por tipo, del más numeroso al menor.
 * @param {{detector:string, clave:string}[]} casos lo que encontró la corrida de hoy
 * @param {{clave:string, primera_vez?:string|null}[]} previos casos abiertos antes de esta corrida
 * @param {number} ahoraMs
 * @returns {{detector:string, n:number, dias:number}[]}
 */
export function siguenAbiertos(casos, previos, ahoraMs) {
  const antes = new Map((previos || []).map(p => [p.clave, p]))
  /** @type {Record<string, {detector:string, n:number, dias:number}>} */
  const por = {}
  for (const c of casos || []) {
    const p = antes.get(c.clave); if (!p) continue
    const t = Date.parse(String(p.primera_vez || '')), d = isFinite(t) ? Math.max(0, Math.floor((ahoraMs - t) / DIA)) : 0
    const g = por[c.detector] || (por[c.detector] = { detector: c.detector, n: 0, dias: 0 })
    g.n++; if (d > g.dias) g.dias = d
  }
  return Object.values(por).sort((a, b) => b.n - a.n || b.dias - a.dias)
}

/** ¿Es lunes en Chile? (AAAA-MM-DD de hoy en Chile) @param {string} isoCL */
export function esLunes(isoCL) { return /^\d{4}-\d{2}-\d{2}$/.test(String(isoCL || '')) && new Date(String(isoCL) + 'T12:00:00Z').getUTCDay() === 1 }

/**
 * ¿Sale correo esta mañana? Con casos nuevos, siempre; sin nuevos, solo el lunes y si algo sigue abierto (así no se repite a diario lo mismo).
 * @param {number} nuevos @param {number} siguen @param {string} hoyCL
 */
export function correoDelDia(nuevos, siguen, hoyCL) { return nuevos > 0 || (siguen > 0 && esLunes(hoyCL)) }
