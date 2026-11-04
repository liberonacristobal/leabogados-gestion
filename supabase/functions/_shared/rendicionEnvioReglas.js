// Rendiciones a clientes enviadas FUERA de la app: ¿un correo enviado por una persona corresponde al envío de una rendición?
// Misma regla estricta que las facturas (facturaEnvioReglas.js): el correo debe ir a un contacto del MISMO cliente de la rendición y nombrar
// «Rendición N° <correlativo>» (en el asunto, el nombre de un adjunto o el comienzo del texto). Nunca cuenta: correos solo internos, de dos o
// más clientes, anteriores a la rendición o más de VENTANA_DIAS después, respuestas sin adjunto, ni un número que sea parte de otro
// (Rendición 140 no es la 14). Puras (sin red ni base); las usa gmail-lectura. Pruebas en tests/rendiciones-envio.test.mjs.
import { clientesDeDestinatarios, emailsDe } from './facturaEnvioReglas.js'

export const VENTANA_DIAS = 60
const KW = '(?:rendici[oó]n(?:es)?|rend\\.?)'
/** @param {any} s */
const nrm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** ¿El texto menciona la «Rendición N° n»? La palabra va a menos de 40 caracteres del número, sin pasar por «|», rayas ni saltos de línea. @param {any} texto @param {any} n */
export function mencionaRendicion(texto, n) {
  const k = String(n == null ? '' : n).replace(/\D/g, '').replace(/^0+(?=\d)/, '')
  if (!k) return false
  return new RegExp(`${KW.replace('ó', '[oó]')}[^\\n|—–\\-]{0,40}?(?<![\\d.,])0*${k}(?![\\d]|[.,]\\d)`, 'i').test(nrm(texto).replace(/rendicion/g, 'rendición'))
}

/** ¿El nombre de un adjunto es de esta rendición? «Rendición 14.pdf», «Rendicion N°14 Cliente.pdf». @param {any} nombre @param {any} n */
export function adjuntoEsDeRendicion(nombre, n) {
  const k = String(n == null ? '' : n).replace(/\D/g, '').replace(/^0+(?=\d)/, '')
  const f = nrm(nombre)
  if (!k || !/\.(pdf|docx?|xlsx?)$/.test(f)) return false
  return new RegExp(`rendicion(?:es)?[^0-9]{0,14}(?<![\\d.,])0*${k}(?!\\d)`).test(f.replace(/\.[a-z]+$/, ''))
}

/** @param {string|undefined} fecha @param {number} dias @returns {string} */
const masDias = (fecha, dias) => { const d = new Date(String(fecha || '').slice(0, 10) + 'T12:00:00'); d.setDate(d.getDate() + dias); return d.toISOString().slice(0, 10) }

/**
 * @param {{correo:any, rendicion:{id:any, client_id:any, correlativo:any, created_at?:string}, mapa:Map<string, Set<string>|string[]>, dominio?:string}} p
 * @returns {{motivo:string}|null}
 */
export function envioDeRendicion({ correo, rendicion, mapa, dominio = '' }) {
  if (!correo || !rendicion || rendicion.correlativo == null) return null
  const dom = String(dominio || '').toLowerCase().replace(/^@/, '')
  const dest = [...new Set([...emailsDe(correo.para), ...emailsDe(correo.cc)])]
  const externos = dest.filter(e => !dom || !e.endsWith('@' + dom))
  if (!externos.length) return null
  const cids = clientesDeDestinatarios(externos, mapa)
  if (cids.size !== 1 || !cids.has(String(rendicion.client_id))) return null
  const fecha = String(correo.fecha || '').slice(0, 10), desde = String(rendicion.created_at || '').slice(0, 10)
  if (!fecha || !desde || fecha < desde || fecha > masDias(desde, VENTANA_DIAS)) return null
  const adj = (correo.adjuntos || []).filter(/** @param {any} a */ a => a && a.nombre)
  if (/^\s*(re|rv)\s*:/i.test(correo.asunto || '') && !adj.length) return null
  const n = rendicion.correlativo
  if (mencionaRendicion(correo.asunto, n)) return { motivo: 'N° en el asunto' }
  if (adj.some(/** @param {any} a */ a => adjuntoEsDeRendicion(a.nombre, n))) return { motivo: 'N° en el adjunto' }
  if (mencionaRendicion(String(correo.fragmento || '').slice(0, 300), n)) return { motivo: 'N° en el texto' }
  return null
}

/**
 * Qué completar en rendiciones a clientes aún sin envío registrado cuando un correo enviado las contiene: la fecha REAL del correo y el
 * estado «externa» (enviada fuera de la app). Una rendición que ya tiene fecha de envío no se toca.
 * @param {{rendiciones:any[], correos:any[], mapa:Map<string, Set<string>|string[]>, dominio?:string}} p
 */
export function planRendiciones({ rendiciones, correos, mapa, dominio = '' }) {
  /** @type {{id:any, sent_at:string, estado_envio:string, dirigido_email:string|null, correo_id:string, fecha_real:string, motivo:string}[]} */
  const out = []
  const vistas = new Set()
  for (const r of rendiciones || []) {
    if (r.sent_at || r.anulada_at || r.tipo !== 'cliente' || vistas.has(String(r.id))) continue
    for (const c of correos || []) {
      const m = envioDeRendicion({ correo: c, rendicion: r, mapa, dominio })
      if (!m) continue
      vistas.add(String(r.id))
      const dest = emailsDe(c.para)[0] || emailsDe(c.cc)[0] || null
      out.push({ id: r.id, sent_at: new Date(c.fecha + 'T15:00:00Z').toISOString(), estado_envio: 'externa', dirigido_email: r.dirigido_email ? null : dest, correo_id: String(c.id), fecha_real: c.fecha, motivo: m.motivo })
      break
    }
  }
  return out
}
