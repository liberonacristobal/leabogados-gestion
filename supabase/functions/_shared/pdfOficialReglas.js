// PDF oficial del SII de cada factura emitida: qué facturas faltan, cuándo reintentar y dónde se guarda en Drive.
// Reglas puras (sin red ni base): las usa la acción 'pdf-oficial' de sii-sync (cron) y se prueban en tests/pdf-oficial.test.mjs.
// Calendario de intentos: el primero apenas la factura existe; si falla, otro 6 horas después; si vuelve a fallar, uno por día.
// A la tercera falla seguida se avisa (una vez) y se sigue intentando hasta el tope; la lista de «sin PDF oficial» se calcula viva,
// así que una factura que por fin se guarda sale sola del aviso.

// Carpeta raíz «Facturación» del Drive compartido del estudio (la app y el servidor leen el mismo id).
export const FACTURACION_ROOT = '1GtcDmnq2FpGQlaZRETyOU4Zwf5MfCi7V'

export const HORAS_REINTENTO = 6
export const INTENTOS_AVISO = 3
export const INTENTOS_MAX = 6
const HORA_MS = 3600 * 1000

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

/**
 * Carpetas de Drive de una factura: «Facturación 2026» → «08. Agosto 2026». Se factura el MES VENCIDO: la carpeta es la del mes
 * anterior a la emisión (enero cae en diciembre del año anterior). Misma regla que driveCarpetaFacturacion de la app.
 * @param {any} iso fecha de emisión AAAA-MM-DD @returns {{anio:string, mes:string}}
 */
export function carpetaFacturacion(iso) {
  const s = String(iso || '')
  if (!/^\d{4}-\d{2}/.test(s)) return { anio: 'Facturación Sin fecha', mes: 'Sin fecha' }
  let y = +s.slice(0, 4), m = +s.slice(5, 7) - 1
  if (m < 1) { m = 12; y -= 1 }
  return { anio: `Facturación ${y}`, mes: `${String(m).padStart(2, '0')}. ${MESES[m - 1]} ${y}` }
}

/** «Factura 1340 - Razón social.pdf» (45 letras de la razón, sin caracteres que Drive no admite). @param {any} folio @param {any} razon @param {boolean} [oficial] */
export function nombrePdf(folio, razon, oficial = false) {
  const rs = String(razon || '').replace(/[\/\\:*?"<>|]/g, '').trim().slice(0, 45).trim()
  return `Factura ${String(folio || '').trim()}${rs ? ' - ' + rs : ''}${oficial ? ' (oficial SII)' : ''}.pdf`
}

/**
 * Momento (ms) desde el cual se puede volver a intentar. Sin intentos: ya. Tras la primera falla: 6 horas. Desde la segunda: al día siguiente
 * (de Chile) a la misma hora o después, nunca antes de 18 horas desde el último intento.
 * @param {{n:number, ultimoMs:number}} est
 */
export function proximoIntentoMs(est) {
  const n = Number(est?.n) || 0, ult = Number(est?.ultimoMs) || 0
  if (n <= 0 || !ult) return 0
  if (n === 1) return ult + HORAS_REINTENTO * HORA_MS
  return ult + 18 * HORA_MS
}

/**
 * Qué hacer con cada factura emitida.
 * @param {{facturas:{id:string, invoice_no?:string, status?:string, issued_at?:string, deleted_at?:string|null}[],
 *   conPdf:Set<string>|string[], intentos:Map<string,{n:number, ultimoMs:number, ultimo?:string}>|Record<string,{n:number, ultimoMs:number, ultimo?:string}>,
 *   ahoraMs:number, desde:string, limite?:number}} p
 * @returns {{aBuscar:any[], sinPdf:number, fallidas:{id:string, folio:string, n:number, ultimo:string}[], aMano:{id:string, folio:string}[]}}
 */
export function planPdfOficial({ facturas, conPdf, intentos, ahoraMs, desde, limite = 6 }) {
  const tiene = conPdf instanceof Set ? conPdf : new Set(conPdf || [])
  const intent = (id) => (intentos instanceof Map ? intentos.get(id) : intentos?.[id]) || { n: 0, ultimoMs: 0 }
  const vivas = (facturas || []).filter(f => !f.deleted_at && /^\d+$/.test(String(f.invoice_no || '').replace(/\D/g, '') || 'x') && f.status !== 'Anulada' && String(f.issued_at || '') >= String(desde || '') && !tiene.has(f.id))
  const aBuscar = [], fallidas = [], aMano = []
  for (const f of vivas) {
    const folio = String(f.invoice_no || '').replace(/\D/g, '')
    const e = intent(f.id)
    if (e.n >= INTENTOS_MAX) { aMano.push({ id: f.id, folio }); fallidas.push({ id: f.id, folio, n: e.n, ultimo: e.ultimo || '' }); continue }
    if (e.n >= INTENTOS_AVISO) fallidas.push({ id: f.id, folio, n: e.n, ultimo: e.ultimo || '' })
    if (ahoraMs >= proximoIntentoMs(e)) aBuscar.push({ ...f, folio, n: e.n })
  }
  aBuscar.sort((a, b) => a.n - b.n || String(b.issued_at || '').localeCompare(String(a.issued_at || '')))   // primero las que nunca se intentaron y las más recientes
  return { aBuscar: aBuscar.slice(0, limite), sinPdf: vivas.length, fallidas, aMano }
}
