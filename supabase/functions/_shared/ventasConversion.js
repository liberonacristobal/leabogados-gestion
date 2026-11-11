// Conversión de propuestas: aceptadas / (aceptadas + rechazadas) dentro de una VENTANA honesta. Función pura, fuente única (Presupuesto, Panel de socios).
// Por qué ventana: la app existe desde 06-06-2026 y casi todas las ventas Activo/Terminado se cargaron como historia (nunca fueron propuesta); contarlas daría ~97 % engañoso.
// Evidencia en la base: las rechazadas se registran desde la primera con status 'Rechazada' (su fecha de decisión es `updated_at`); una venta ACEPTADA como propuesta es la que se
// activó (`activated_at`) más de HORAS_MIN_PROPUESTA después de crearse: las creadas ya Activas se activan segundos o minutos después de crearse y no pasaron por «Propuesta».
// La ventana parte en la primera rechazada registrada y llega hasta la última decisión. Sin rechazadas registradas no hay ventana y no hay cifra.
// Decisión guardada: una propuesta marcada «duplicada: no cuenta» (`noCuentan`, ids) sale del cálculo (una propuesta, un resultado) pero sigue en la lista de decisiones para poder volver a contarla.

export const HORAS_MIN_PROPUESTA = 24

const _dia = (/** @type {any} */ x) => { const s = String(x || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '' }
const _ms = (/** @type {any} */ x) => { const t = new Date(String(x || '')).getTime(); return Number.isFinite(t) ? t : null }

/**
 * @param {{ sales:any[], excluir?:(s:any)=>boolean, noCuentan?:Set<string>|string[] }} o  `excluir`: ventas que no cuentan (p. ej. subarriendos); `noCuentan`: ids de propuestas marcadas «duplicada: no cuenta».
 * @returns {{ pct:number|null, aceptadas:number, rechazadas:number, desde:string|null, hasta:string|null, decisiones:{ id:string, titulo:string, cid:string, fecha:string, resultado:'aceptada'|'rechazada', cuenta:boolean }[] }}
 */
export function conversionPropuestas({ sales, excluir, noCuentan }) {
  const dup = new Set([...(noCuentan || [])].map(String))
  const todas = (sales || []).filter((s) => s && !s.deleted_at && !(excluir && excluir(s)))
  const vivas = todas.filter((s) => !dup.has(String(s.id)))
  const rech = vivas.filter((s) => s.status === 'Rechazada' && _dia(s.updated_at))
  const desde = rech.map((s) => _dia(s.updated_at)).sort()[0] || null
  const esAcept = (/** @type {any} */ s) => {
    if (!desde || !['Activo', 'Terminado'].includes(s.status) || !s.activated_at || _dia(s.activated_at) < desde) return false
    const a = _ms(s.activated_at), c = _ms(s.created_at)
    return a != null && c != null && (a - c) / 3600000 >= HORAS_MIN_PROPUESTA
  }
  const acept = vivas.filter(esAcept)
  const n = acept.length + rech.length
  const fechas = [...acept.map((s) => _dia(s.activated_at)), ...rech.map((s) => _dia(s.updated_at))].sort()
  // Lista de decisiones (más reciente primero): las contadas y las marcadas duplicadas (estas con cuenta = false).
  /** @type {{ id:string, titulo:string, cid:string, fecha:string, resultado:'aceptada'|'rechazada', cuenta:boolean }[]} */
  const decisiones = []
  for (const s of todas) {
    const marcada = dup.has(String(s.id))
    const fechaR = s.status === 'Rechazada' ? _dia(s.updated_at) : ''
    if (fechaR) { decisiones.push({ id: String(s.id), titulo: String(s.title || s.name || '').trim(), cid: String(s.client_id == null ? '' : s.client_id), fecha: fechaR, resultado: 'rechazada', cuenta: !marcada }); continue }
    if (marcada ? (desde && ['Activo', 'Terminado'].includes(s.status) && s.activated_at && _dia(s.activated_at) >= desde && (_ms(s.activated_at) ?? 0) - (_ms(s.created_at) ?? 0) >= HORAS_MIN_PROPUESTA * 3600000) : esAcept(s)) decisiones.push({ id: String(s.id), titulo: String(s.title || s.name || '').trim(), cid: String(s.client_id == null ? '' : s.client_id), fecha: _dia(s.activated_at), resultado: 'aceptada', cuenta: !marcada })
  }
  decisiones.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0))
  return { pct: n ? (acept.length / n) * 100 : null, aceptadas: acept.length, rechazadas: rech.length, desde, hasta: fechas.slice(-1)[0] || null, decisiones }
}
