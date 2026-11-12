// Lo que la app ya sabe de un cargo del banco antes de preguntar: qué clasificación le dio siempre a ese RUT, y a qué cliente
// nombra el mensaje de la transferencia. Funciones puras (sin red ni base): las usa la bandeja de Conciliación.

const norm = (/** @type {any} */ s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const rutNorm = (/** @type {any} */ r) => String(r || '').replace(/[^0-9kK]/g, '').toLowerCase()

/**
 * ¿La glosa del banco no dice nada de a quién se pagó? «Transferencia de LIBERONA ESCALA… desde Banco BICE a <persona>…»: sus primeras
 * palabras son siempre las mismas, así que la clave de glosa es una sola para todas esas transferencias y no sirve para aprender.
 * @param {any} desc
 */
export const glosaGenerica = desc => /^transferencia de (liberona|quad ases)/.test(norm(desc)) || esPagoTGR(desc)

/**
 * Pago a la Tesorería General de la República desde la cuenta («Cargo por Pago TGR Nro. Oper. …», «Cargo por Pago de Impuesto (TGR)»).
 * La glosa no trae RUT ni nombre: por cuenta de un cliente, el cliente hay que elegirlo; su clave de glosa sería la misma para todos.
 * @param {any} desc
 */
export function esPagoTGR(desc) { return /^cargo por pago (de impuesto )?tgr\b/.test(norm(desc)) }

/**
 * Clasificación aprendida por RUT: lo que siempre se hizo con los cargos a ese RUT (gasto de oficina ya registrado).
 * Si el mismo RUT tuvo clasificaciones distintas, es ambiguo y no se sugiere.
 * @param {{ rut?: any, category?: any, subcategory?: any }[]} historial un registro por cargo ya clasificado como gasto de oficina
 * @returns {Map<string, { category: string, sub: string | null, n: number }>}
 */
export function clasificacionPorRut(historial) {
  /** @type {Map<string, { category: string, sub: string | null, n: number, ambiguo: boolean }>} */
  const m = new Map()
  for (const h of historial || []) {
    const k = rutNorm(h?.rut), cat = String(h?.category || '').trim()
    if (!k || !cat) continue
    const sub = String(h?.subcategory || '').trim() || null
    const x = m.get(k)
    if (!x) m.set(k, { category: cat, sub, n: 1, ambiguo: false })
    else if (x.category === cat && x.sub === sub) x.n++
    else x.ambiguo = true
  }
  /** @type {Map<string, { category: string, sub: string | null, n: number }>} */
  const out = new Map()
  for (const [k, x] of m) if (!x.ambiguo) out.set(k, { category: x.category, sub: x.sub, n: x.n })
  return out
}

// Palabras que no identifican a un cliente en el nombre de una sociedad.
const SOCIEDAD = new Set(['spa', 'ltda', 'limitada', 'sociedad', 'inversiones', 'inversion', 'asesorias', 'asesoria', 'servicios', 'comercial', 'inmobiliaria', 'constructora', 'empresa', 'empresas', 'grupo', 'compania', 'chile', 'chilena', 'abogados', 'anonima', 'eirl', 'de', 'del', 'los', 'las', 'y'])
const claves = (/** @type {any} */ nombre) => norm(nombre).split(' ').filter(w => w.length >= 4 && !SOCIEDAD.has(w))

/**
 * Cliente nombrado en el mensaje de la transferencia («Inscripción a nombre de Sirka SpA»): el nombre de un cliente o de una de sus
 * razones sociales, sin las palabras de sociedad, aparece completo en el texto. Solo si es UN cliente; con dos o más, no adivina.
 * @param {any} texto
 * @param {{ id: any, nombres: any[] }[]} candidatos un cliente con su nombre y los de sus razones sociales
 * @returns {string | null} id del cliente
 */
export function clientePorMensaje(texto, candidatos) {
  const t = new Set(norm(texto).split(' ').filter(Boolean))
  if (!t.size) return null
  const hallados = new Set()
  for (const c of candidatos || []) {
    for (const nom of c?.nombres || []) {
      const ks = claves(nom)
      if (ks.length && ks.every(w => t.has(w))) { hallados.add(String(c.id)); break }
    }
  }
  return hallados.size === 1 ? [...hallados][0] : null
}

/**
 * Gastos de cliente ya cargados a mano (un abogado los registró) que pueden ser este cargo: mismo monto al peso, fecha del gasto
 * dentro de la ventana del cargo, de un cliente (no la oficina), sin banco ligado y no borrados. Más cercano en fecha primero.
 * Con más de uno por el mismo monto no hay cómo elegir: la bandeja los muestra pero no propone uno.
 * @param {{ monto?: any, fecha?: any }} mov
 * @param {{ id: any, amount?: any, date?: any, client_id?: any, type?: any, deleted_at?: any }[]} gastos
 * @param {Set<string>} ligados ids de gasto que ya tienen un movimiento del banco
 * @param {any} idInterno id del cliente interno (la oficina), que no cuenta
 * @param {number} [dias] ventana en días
 */
export function gastosCandidatosCargo(mov, gastos, ligados, idInterno, dias = 10) {
  const M = Math.round(Math.abs(Number(mov?.monto) || 0)), t = Date.parse(String(mov?.fecha || '').slice(0, 10) + 'T12:00:00Z')
  if (!(M > 0) || !Number.isFinite(t)) return []
  return (gastos || [])
    .filter(g => g && !g.deleted_at && g.type === 'gasto' && g.client_id != null && String(g.client_id) !== String(idInterno) && !ligados?.has(String(g.id)) && Math.round(Number(g.amount) || 0) === M)
    .map(g => ({ g, d: Math.abs(Date.parse(String(g.date || '').slice(0, 10) + 'T12:00:00Z') - t) / 864e5 }))
    .filter(x => Number.isFinite(x.d) && x.d <= dias)
    .sort((a, b) => a.d - b.d)
    .map(x => x.g)
}
