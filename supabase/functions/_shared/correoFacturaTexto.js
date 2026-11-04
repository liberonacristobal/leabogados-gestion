// Texto del correo de factura: redacción de VARIAS facturas, trato (tú / ustedes) y saludo. Reglas puras (sin red ni base): las usa el envío de
// facturas (BillingView) y se prueban en tests/correo-factura-texto.test.mjs con las facturas reales que fallaron (4-11-2026).
// El trabajo de cada factura sale de su glosa (la que ve el cliente en el PDF: NmbItem/DscItem), con el proyecto de la venta como respaldo
// cuando el ítem es genérico («Servicios legales»): lo resuelve facturaGlosaPartes (compartido.jsx). Aquí solo se redacta; nunca se omite un trabajo.

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** @param {any} s */
const nrm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

/** «Octubre 2026» si algún texto nombra mes y año completos (glosa del DTE o concepto); si no, ''. @param {...any} textos @returns {string} */
export function periodoDe(...textos) {
  for (const t of textos) {
    const m = String(t || '').match(new RegExp(`\\b(${MESES.join('|')})\\s+(?:de\\s+)?(20\\d{2})\\b`, 'i'))
    if (m) return m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase() + ' ' + m[2]
  }
  return ''
}

/** «Estimado Agustín,» / «Estimada Carolina,» → true. «Estimados,», «Estimadas,», «Hola» → false. @param {any} saludo */
export const esSaludoSingular = saludo => /^\s*estimad[oa]\b/i.test(String(saludo || ''))

/**
 * Trato que usa el texto con UNA persona: «Espero que esté muy bien» → 'usted', «Espero que estés muy bien» → 'tu'; otro texto (o «estén») → null.
 * Es por persona, no se deduce del saludo: «Estimada Gabriela» con «esté», «Estimado Juan Pablo» con «estés» (correos reales de 4-11-2026).
 * @param {any} texto @returns {'usted'|'tu'|null}
 */
export function tratoDeTexto(texto) {
  const m = String(texto || '').match(/Espero que (est[eé]s?)\s+muy bien/i)
  if (!m) return null
  const v = m[1].toLowerCase().replace('é', 'e')
  return v === 'estes' ? 'tu' : v === 'este' ? 'usted' : null
}

/**
 * Pasa las frases de trato entre «ustedes», «tú» y «usted» (solo esas): «Espero que estén muy bien» ↔ «estés» ↔ «esté» y «sus comentarios» ↔ «tus comentarios».
 * Con una sola persona manda el trato aprendido de ella; sin él, «tú». Sirve también sobre un cuerpo ya editado. No toca el inglés.
 * @param {any} texto @param {boolean} singular @param {'usted'|'tu'|null} [trato]
 */
export function ajustarTrato(texto, singular, trato = null) {
  let s = String(texto == null ? '' : texto)
  if (singular && trato === 'usted') return s.replace(/Espero que est[eé]n?s? muy bien/g, 'Espero que esté muy bien').replace(/\btus comentarios\b/g, 'sus comentarios')
  if (singular) return s.replace(/Espero que est[eé]n?(?=\s+muy bien)/g, 'Espero que estés').replace(/\bsus comentarios\b/g, 'tus comentarios')
  return s.replace(/Espero que est[eé]s?(?=\s+muy bien)/g, 'Espero que estén').replace(/\btus comentarios\b/g, 'sus comentarios')
}

/**
 * Agrupa las facturas por TRABAJO (la venta; si no tiene, el nombre del servicio), en el orden en que vienen.
 * @param {{folio:string, relacion?:string, detalle?:string, periodo?:string, key?:string}[]} items
 */
export function agruparTrabajos(items) {
  /** @type {Map<string, {relacion:string, items:any[]}>} */
  const m = new Map()
  for (const it of items || []) {
    const k = String(it.key || '') || 'n:' + nrm(it.relacion)
    if (!m.has(k)) m.set(k, { relacion: String(it.relacion || '').trim(), items: [] })
    const g = /** @type {{relacion:string, items:any[]}} */ (m.get(k)); if (!g.relacion && it.relacion) g.relacion = String(it.relacion).trim(); g.items.push(it)
  }
  return [...m.values()]
}

const unir = (/** @type {string[]} */ a, /** @type {string} */ y) => a.length <= 1 ? (a[0] || '') : a.slice(0, -1).join(', ') + ` ${y} ` + a[a.length - 1]

/** @param {string} t @param {'es'|'en'} lang */
const enDetalle = (t, lang) => lang !== 'en' ? t : String(t).replace(/^pago\s+(\d+)\s+de\s+(\d+)$/i, 'Payment $1 of $2').replace(/^cuota\s+(\d+)\s*\/\s*(\d+)$/i, 'Installment $1 of $2').replace(new RegExp(`^(${MESES.join('|')})\\s+(\\d{4})$`, 'i'), (_m, mes, y) => `${MONTHS_EN[MESES.indexOf(mes.toLowerCase())]} ${y}`)

/**
 * Cuerpo para VARIAS facturas (2 o más) en un correo: «Adjuntamos las facturas N° A y B, correspondientes a los siguientes trabajos:» y una línea
 * por trabajo con su cuota o período y el N° de factura. Sin total. Un trabajo con varias facturas junta las suyas en su línea. Con un solo
 * trabajo dice «al siguiente trabajo». Sin cierre (lo agrega el envío).
 * @param {{items:{folio:string, relacion?:string, detalle?:string, periodo?:string, key?:string}[], lang?:'es'|'en'}} p
 */
export function cuerpoVariasFacturas({ items, lang = 'es' }) {
  const y = lang === 'en' ? 'and' : 'y'
  const folios = unir((items || []).map(i => i.folio), y)
  const gs = agruparTrabajos(items)
  const lineas = gs.map(g => {
    const partes = g.items.map(i => { const d = enDetalle(i.detalle || i.periodo || '', lang); const n = `${lang === 'en' ? 'No.' : 'N°'} ${i.folio}`; return d ? `${d} (${n})` : n })
    const nombre = g.relacion || (lang === 'en' ? 'Professional services' : 'Servicios profesionales')
    return `– ${nombre}: ${unir(partes, y)}.`
  })
  if (lang === 'en') return `We attach invoices No. ${folios}, corresponding to the following ${gs.length === 1 ? 'work' : 'works'}:\n${lineas.join('\n')}`
  return `Espero que estén muy bien. Adjuntamos las facturas N° ${folios}, correspondientes ${gs.length === 1 ? 'al siguiente trabajo' : 'a los siguientes trabajos'}:\n${lineas.join('\n')}`
}

/**
 * Saludo según a QUIÉN va el correo («Para»), no según quién va en copia: una sola dirección con nombre conocido → «Estimado Agustín,»; si no,
 * «Estimados,». Lo aprendido de un saludo escrito a mano para esa dirección manda sobre el nombre del contacto.
 * @param {{para:string[], contactos:{email?:string, nombre?:string}[], aprendido?:string|null, generoF:(n:string)=>boolean, esPersona:(n:string)=>boolean}} p
 */
export function saludoPara({ para, contactos, aprendido, generoF, esPersona }) {
  const dirs = [...new Set((para || []).map(e => String(e || '').trim().toLowerCase()).filter(Boolean))]
  if (dirs.length !== 1) return 'Estimados,'
  if (aprendido && /^\s*estimad[oa]s?\b/i.test(aprendido)) return String(aprendido).trim()
  const c = (contactos || []).find(x => String(x.email || '').toLowerCase() === dirs[0])
  const local = dirs[0].split('@')[0]
  const nombre = String(c?.nombre || '').trim()
  if (!nombre || nrm(nombre) === nrm(local) || !esPersona(nombre)) return 'Estimados,'   // sin nombre conocido (o el «nombre» es el propio correo)
  return `${generoF(nombre) ? 'Estimada' : 'Estimado'} ${nombre.split(/\s+/)[0]},`
}
