// Boletas de honorarios electrónicas RECIBIDAS (informe mensual del SII): lectura del informe y cruce con los cargos del banco.
// Funciones puras (sin red ni base). El informe sale de «Informes de boletas recibidas» del SII (texto de la página o planilla electrónica).

const n = (/** @type {any} */ x) => Number(x) || 0
/** RUT con guion y sin puntos: «60.306.045-8» → «60306045-8». @param {any} r */
export const rutBoleta = r => { const c = String(r || '').replace(/[^0-9kK]/g, '').toUpperCase(); return c.length > 1 ? `${c.slice(0, -1)}-${c.slice(-1)}` : c }
/** Monto del informe («264.400», 264400, «$ 1.372.000») en pesos enteros. @param {any} x */
const monto = x => (typeof x === 'number' ? Math.round(x) : Math.round(Number(String(x ?? '').replace(/[^\d-]/g, '')) || 0))
/** «09/11/2026» o «2026-11-09» → «2026-11-09»; null si no es una fecha. @param {any} f */
const fechaISO = f => {
  const s = String(f ?? '').trim()
  let m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}
const normTxt = (/** @type {any} */ s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

/** @typedef {{ folio: string, fecha: string, emisor_rut: string, emisor_nombre: string, estado: string, bruto: number, retencion: number, pagado: number }} Boleta */

/**
 * Lee el informe mensual: texto pegado desde la página del SII o las filas (matriz) de la planilla electrónica.
 * @param {any} entrada texto (string) o filas [[celda, …], …]
 * @returns {{ filas: Boleta[], descartadas: number }}
 */
export function leerInformeBoletas(entrada) {
  /** @type {Boleta[]} */
  const filas = []
  let descartadas = 0
  if (typeof entrada === 'string') {
    const t = entrada.replace(/\s+/g, ' ')
    const re = /(\d+) (VIG|ANU\w*|NUL\w*) (\d{2}\/\d{2}\/\d{4}) (\d[\d.]*-[\dkK]) (.+?) (SI|NO) ([\d.]+) ([\d.]+) ([\d.]+)/g
    for (const m of t.matchAll(re)) {
      filas.push({ folio: m[1], estado: m[2], fecha: /** @type {string} */ (fechaISO(m[3])), emisor_rut: rutBoleta(m[4]), emisor_nombre: m[5].trim(), bruto: monto(m[7]), retencion: monto(m[8]), pagado: monto(m[9]) })
    }
    return { filas, descartadas }
  }
  // Planilla: la fila de títulos se reconoce por sus nombres, en cualquier orden.
  const aoa = Array.isArray(entrada) ? entrada : []
  const hi = aoa.findIndex(r => Array.isArray(r) && r.filter(c => /bolet|folio|n[°ºo]\b|fecha|rut|bruto|retenid|pagado|liquido/i.test(String(c))).length >= 4)
  if (hi < 0) return { filas, descartadas: aoa.length }
  const cols = aoa[hi].map(c => normTxt(c))
  const idx = (/** @type {RegExp} */ re) => cols.findIndex(c => re.test(c))
  const iF = idx(/^(n|numero|n boleta|folio|boleta|nro)( |$)|^n$|numero|folio/), iE = idx(/estado/), iD = idx(/fecha/), iR = idx(/\brut\b|rut emisor/), iN = idx(/nombre|razon/), iB = idx(/bruto/), iRet = idx(/retenid|retencion/), iP = idx(/pagado|liquido/)
  for (const r of aoa.slice(hi + 1)) {
    if (!Array.isArray(r)) continue
    const fecha = fechaISO(r[iD]), rut = rutBoleta(r[iR]), folio = String(r[iF] ?? '').replace(/\D/g, '')
    if (!fecha || !rut || !folio) { if (r.some(c => String(c).trim())) descartadas++; continue }
    filas.push({ folio, estado: String(r[iE] ?? '').trim() || 'VIG', fecha, emisor_rut: rut, emisor_nombre: String(r[iN] ?? '').trim(), bruto: monto(r[iB]), retencion: monto(r[iRet]), pagado: iP >= 0 ? monto(r[iP]) : monto(r[iB]) - monto(r[iRet]) })
  }
  return { filas, descartadas }
}

const dias = (/** @type {string} */ a, /** @type {string} */ b) => Math.round((Date.parse(a.slice(0, 10) + 'T12:00:00Z') - Date.parse(b.slice(0, 10) + 'T12:00:00Z')) / 864e5)

/**
 * Boletas que pueden ser el pago de un cargo del banco: del mismo emisor y con la misma suma exacta, dentro de ±ventana días.
 * Con RUT del cargo (transferencia a una persona): una boleta de ese emisor por el monto pagado.
 * Sin RUT (pago a la TGR u otro sin nombre): una boleta, o varias del MISMO emisor y del MISMO día, que sumen el monto (varios certificados en un pago).
 * Una boleta ya ligada a otro movimiento no cuenta. Más cercano en fecha primero.
 * @param {{ monto?: any, fecha?: any, rut?: any, id?: any }} cargo
 * @param {(Boleta & { movimiento_id?: any })[]} boletas
 * @param {number} [ventana]
 * @returns {{ emisor_rut: string, emisor_nombre: string, fecha: string, total: number, boletas: Boleta[], dias: number }[]}
 */
export function boletasDeCargo(cargo, boletas, ventana = 10) {
  const M = Math.round(Math.abs(n(cargo?.monto))), f = String(cargo?.fecha || '').slice(0, 10), rut = rutBoleta(cargo?.rut)
  if (!(M > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(f)) return []
  const libres = (boletas || []).filter(b => b && !/^(ANU|NUL)/i.test(String(b.estado)) && (b.movimiento_id == null || String(b.movimiento_id) === String(cargo?.id)) && Math.abs(dias(b.fecha, f)) <= ventana)
  /** @type {{ emisor_rut: string, emisor_nombre: string, fecha: string, total: number, boletas: Boleta[], dias: number }[]} */
  const out = []
  const pagado = (/** @type {Boleta} */ b) => (n(b.pagado) || n(b.bruto) - n(b.retencion))
  if (rut) {
    for (const b of libres) if (b.emisor_rut === rut && pagado(b) === M) out.push({ emisor_rut: b.emisor_rut, emisor_nombre: b.emisor_nombre, fecha: b.fecha, total: M, boletas: [b], dias: Math.abs(dias(b.fecha, f)) })
  } else {
    /** @type {Map<string, Boleta[]>} */
    const grupos = new Map()
    for (const b of libres) { const k = `${b.emisor_rut}|${b.fecha}`; (grupos.get(k) || grupos.set(k, []).get(k))?.push(b) }
    for (const g of grupos.values()) {
      const un = g.filter(b => pagado(b) === M)
      for (const b of un) out.push({ emisor_rut: b.emisor_rut, emisor_nombre: b.emisor_nombre, fecha: b.fecha, total: M, boletas: [b], dias: Math.abs(dias(b.fecha, f)) })
      if (!un.length && g.length > 1 && g.length <= 12 && g.reduce((s, b) => s + pagado(b), 0) === M) out.push({ emisor_rut: g[0].emisor_rut, emisor_nombre: g[0].emisor_nombre, fecha: g[0].fecha, total: M, boletas: g, dias: Math.abs(dias(g[0].fecha, f)) })
    }
  }
  return out.sort((a, b) => a.dias - b.dias)
}
