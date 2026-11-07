// Control de la proyección del flujo de caja: cada semana se guarda lo que se esperaba cobrar esa semana (una sola cifra) y, cerrada la semana,
// se compara con lo realmente cobrado (por fecha del depósito, el mismo «Cobrado» del Panel de socios). Sirve para saber si la regla conservadora
// acierta y cuánto. Funciones puras: no leen ni escriben la base. La proyección se guarda en learnings (kind flujo_proyeccion, key = lunes de la semana).

export const KIND_PROYECCION = 'flujo_proyeccion'
const _d = (/** @type {string} */ iso) => new Date(String(iso).slice(0, 10) + 'T12:00:00')
const _iso = (/** @type {Date} */ d) => d.toISOString().slice(0, 10)

/** Lunes de la semana de una fecha AAAA-MM-DD. @param {string} iso @returns {string} */
export function lunesDe(iso) { const d = _d(iso); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return _iso(d) }
/** Domingo de la semana que empieza el lunes `ini`. @param {string} ini @returns {string} */
export function domingoDe(ini) { const d = _d(ini); d.setDate(d.getDate() + 6); return _iso(d) }

/** Lo que se guarda de una proyección: el día en que se hizo y lo que se esperaba cobrar en la semana desde ese día. @param {string} hoy @param {number} entra */
export const instantanea = (hoy, entra) => ({ d: String(hoy).slice(0, 10), entra: Math.round(Number(entra) || 0) })

/**
 * Compara cada semana cerrada con lo cobrado. De cada semana solo cuenta lo cobrado desde el día en que se guardó la proyección (lo anterior no estaba
 * en lo que se proyectó).
 * @param {{snaps:{key:string, value:any}[], cobros:{fecha:string, monto:number}[], hoy:string, ultimas?:number}} p
 * @returns {{filas:{ini:string, proyectado:number, cobrado:number, dif:number, pct:number|null}[], error:number|null}}
 */
export function controlProyeccion({ snaps, cobros, hoy, ultimas = 4 }) {
  const filas = []
  const unicos = new Map(); for (const s of snaps || []) { const k = String(s && s.key); if (!unicos.has(k)) unicos.set(k, s) }   // una instantánea por semana aunque dos sesiones la hayan guardado
  for (const s of unicos.values()) {
    let v = s.value; if (typeof v === 'string') { try { v = JSON.parse(v) } catch (_) { v = null } }
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(String(s.key)) || isNaN(_d(s.key).getTime()) || !(Number(v.entra) >= 0)) continue   // clave o valor dañados: se saltan
    const fin = domingoDe(s.key)
    if (!(fin < hoy)) continue                                      // la semana aún no cierra
    const desde = String(v.d || s.key).slice(0, 10)
    const cobrado = (cobros || []).filter(c => c.fecha >= desde && c.fecha <= fin).reduce((a, c) => a + (Number(c.monto) || 0), 0)
    const proyectado = Number(v.entra) || 0, dif = cobrado - proyectado
    filas.push({ ini: s.key, proyectado, cobrado, dif, pct: proyectado > 0 ? dif / proyectado : null })
  }
  filas.sort((a, b) => b.ini.localeCompare(a.ini))
  const tomadas = filas.slice(0, ultimas), base = tomadas.reduce((a, f) => a + f.proyectado, 0)
  return { filas: tomadas, error: base > 0 ? tomadas.reduce((a, f) => a + f.dif, 0) / base : null }
}
