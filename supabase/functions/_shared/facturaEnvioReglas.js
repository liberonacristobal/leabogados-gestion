// Facturas enviadas FUERA de la app: ¿un correo enviado por un socio corresponde al envío de una factura?
// Regla estricta («solo los correos que correspondan»): el correo debe ir a un contacto del MISMO cliente de la factura y nombrarla.
// Pura (sin red ni base): la lectura de Gmail vive en src/lib/enviosCorreo.jsx.
//
// Dos niveles:
//   · 'coincide'  — destinatario del cliente + el N° de la factura aparece como folio (asunto, nombre del adjunto o inicio del texto).
//   · 'probable'  — destinatario del cliente + PDF/XML adjunto que habla de «factura» + sin folio, pero con UNA sola factura
//                   pendiente de ese cliente en la ventana. Nunca se marca sola: la persona confirma.
// Nunca cuenta: correos solo internos, correos con destinatarios de dos o más clientes, correos anteriores a la emisión o más de
// VENTANA_DIAS después, respuestas sin adjunto, ni un número que sea parte de otro (OT 424 no es la factura 424).

export const VENTANA_DIAS = 60
export const VENTANA_PROBABLE_DIAS = 45

/** @param {any} s */
const nrm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Correos (en minúscula) de un encabezado To/Cc, o de una lista. @param {any} h @returns {string[]} */
export function emailsDe(h) {
  const t = Array.isArray(h) ? h.join(',') : String(h || '')
  return [...t.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)].map(m => m[0].toLowerCase())
}

/** N° de factura limpio: «Factura 322» → «322», «0480» → «480». @param {any} f */
export function folioNum(f) {
  return String(f || '').replace(/^\s*factura\s*/i, '').replace(/\D/g, '').replace(/^0+(?=\d)/, '')
}

const KW = '(?:facturas?|fact\\.?|fac\\.?|folio|dte)'

/**
 * ¿El texto menciona la factura N° `folio`? Exige la palabra factura/folio/DTE a menos de 40 caracteres, sin pasar por «|», rayas ni
 * saltos de línea (así «Factura 461 | … OT 424» no cuenta como factura 424) y el número completo (no parte de otro).
 * @param {any} texto @param {any} folio
 */
export function mencionaFolio(texto, folio) {
  const n = folioNum(folio)
  if (!n) return false
  const re = new RegExp(`${KW}[^\\n|—–\\-]{0,40}?(?<![\\d.,])0*${n}(?![\\d]|[.,]\\d)`, 'i')
  return re.test(String(texto || ''))
}

/** ¿El nombre de un adjunto (PDF/XML) es de esta factura? «Factura 464.pdf», «Fact 1170_LE.pdf», «464.pdf». @param {any} nombre @param {any} folio */
export function adjuntoEsDeFolio(nombre, folio) {
  const n = folioNum(folio)
  const f = nrm(nombre)
  if (!n || !/\.(pdf|xml)$/.test(f)) return false
  const base = f.replace(/\.(pdf|xml)$/, '')
  if (new RegExp(`^0*${n}$`).test(base.trim())) return true
  return new RegExp(`(?:factura|fact|fac|folio|dte)[^0-9]{0,12}(?<![\\d.,])0*${n}(?!\\d)`).test(base)
}

/** @typedef {{id:string, de?:string, para?:any, cc?:any, asunto?:string, fecha?:string, adjuntos?:{nombre?:string, mime?:string}[], fragmento?:string}} Correo */
/** @typedef {{id:any, invoice_no?:any, folio?:any, client_id?:any, issued_at?:string}} FacturaEnv */

/** Clave de comparación de una dirección: sin puntos en la parte local («n.apellido@x.cl» = «napellido@x.cl»), como Gmail. @param {string} e */
const claveCorreo = e => { const [l, d] = String(e || '').toLowerCase().split('@'); return d ? l.replace(/\./g, '') + '@' + d : String(e || '').toLowerCase() }

/** @type {WeakMap<object, Map<string, Set<string>>>} */
const _cache = new WeakMap()
/** @param {Map<string, Set<string>|string[]>} mapa */
const mapaClaves = mapa => {
  let m = _cache.get(mapa)
  if (!m) { m = new Map(); for (const [e, ids] of mapa) { const k = claveCorreo(e), s = m.get(k) || new Set(); [...ids].forEach(id => s.add(String(id))); m.set(k, s) } _cache.set(mapa, m) }
  return m
}

/** Clientes a los que pertenecen los destinatarios (según el mapa correo → ids de cliente; tolera los puntos del nombre). @param {string[]} dest @param {Map<string, Set<string>|string[]>} mapa */
export function clientesDeDestinatarios(dest, mapa) {
  const ids = new Set(), m = mapaClaves(mapa)
  dest.forEach(e => { const s = m.get(claveCorreo(e)); if (s) [...s].forEach(id => ids.add(String(id))) })
  return ids
}

/** @param {string|undefined} fecha @param {number} dias @returns {string} */
const masDias = (fecha, dias) => { const d = new Date(String(fecha || '').slice(0, 10) + 'T12:00:00'); d.setDate(d.getDate() + dias); return d.toISOString().slice(0, 10) }

/**
 * ¿Este correo es el envío de esta factura? Devuelve null o {nivel, motivo}. No evalúa la ambigüedad entre facturas: eso lo hace
 * `enviosDetectados` (nivel 'probable').
 * @param {{correo: Correo, factura: FacturaEnv, mapa: Map<string, Set<string>|string[]>, dominio?: string}} p
 * @returns {{nivel:'coincide', motivo:string}|null}
 */
export function envioDeFactura({ correo, factura, mapa, dominio = '' }) {
  if (!correo || !factura) return null
  const dom = String(dominio || '').toLowerCase().replace(/^@/, '')
  const dest = [...new Set([...emailsDe(correo.para), ...emailsDe(correo.cc)])]
  const externos = dest.filter(e => !dom || !e.endsWith('@' + dom))
  if (!externos.length) return null                                   // solo interno: no salió al cliente
  const cids = clientesDeDestinatarios(externos, mapa)
  if (cids.size !== 1 || !cids.has(String(factura.client_id))) return null   // otro cliente, ninguno conocido o dos clientes
  const fecha = String(correo.fecha || '').slice(0, 10), emis = String(factura.issued_at || '').slice(0, 10)
  if (!fecha || !emis || fecha < emis || fecha > masDias(emis, VENTANA_DIAS)) return null
  const adj = (correo.adjuntos || []).filter(a => a && a.nombre)
  const folio = factura.invoice_no || factura.folio
  if (/^\s*(re|rv)\s*:/i.test(correo.asunto || '') && !adj.length) return null   // respuesta sin adjunto
  if (mencionaFolio(correo.asunto, folio)) return { nivel: 'coincide', motivo: 'N° en el asunto' }
  if (adj.some(a => adjuntoEsDeFolio(a.nombre, folio))) return { nivel: 'coincide', motivo: 'N° en el adjunto' }
  if (mencionaFolio(String(correo.fragmento || '').slice(0, 300), folio)) return { nivel: 'coincide', motivo: 'N° en el texto' }
  return null
}

/**
 * Detecta, para una lista de correos y de facturas SIN ENVIAR, cuáles correos corresponden a cuáles facturas.
 * Un correo puede cubrir varias facturas del mismo cliente (envío en lote). `vistos` = ids de correo ya decididos (marcados o
 * descartados): no vuelven. Cada par (correo, factura) sale una vez.
 * @param {{correos: Correo[], facturas: FacturaEnv[], mapa: Map<string, Set<string>|string[]>, dominio?: string, vistos?: Set<string>}} p
 * @returns {{correo_id:string, factura_id:any, nivel:'coincide'|'probable', motivo:string}[]}
 */
export function enviosDetectados({ correos, facturas, mapa, dominio = '', vistos = new Set() }) {
  /** @type {{correo_id:string, factura_id:any, nivel:'coincide'|'probable', motivo:string}[]} */
  const out = []
  const dom = String(dominio || '').toLowerCase().replace(/^@/, '')
  for (const c of correos || []) {
    if (!c || vistos.has(String(c.id))) continue
    /** @type {{correo_id:string, factura_id:any, nivel:'coincide'|'probable', motivo:string}[]} */
    const hit = []
    for (const f of facturas || []) {
      const r = envioDeFactura({ correo: c, factura: f, mapa, dominio: dom })
      if (r) hit.push({ correo_id: String(c.id), factura_id: f.id, nivel: r.nivel, motivo: r.motivo })
    }
    if (hit.length) { out.push(...hit); continue }
    // Sin folio: solo 'probable', y solo si no hay ambigüedad (una única factura pendiente del cliente en la ventana).
    const dest = [...new Set([...emailsDe(c.para), ...emailsDe(c.cc)])].filter(e => !dom || !e.endsWith('@' + dom))
    const cids = clientesDeDestinatarios(dest, mapa)
    if (cids.size !== 1) continue
    const cid = [...cids][0], fecha = String(c.fecha || '').slice(0, 10)
    const adj = (c.adjuntos || []).filter(a => a && a.nombre && /\.(pdf|xml)$/i.test(String(a.nombre)))
    if (!adj.length || /^\s*(re|rv)\s*:/i.test(c.asunto || '')) continue
    const habla = /factura/i.test(`${c.asunto || ''} ${adj.map(a => a.nombre).join(' ')}`)
    if (!habla) continue
    const cand = (facturas || []).filter(f => String(f.client_id) === cid && fecha >= String(f.issued_at || '').slice(0, 10) && fecha <= masDias(f.issued_at, VENTANA_PROBABLE_DIAS))
    if (cand.length === 1) out.push({ correo_id: String(c.id), factura_id: cand[0].id, nivel: 'probable', motivo: 'Una sola factura pendiente del cliente' })
  }
  return out
}
