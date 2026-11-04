// Lectura de los correos enviados de cada persona (conexión «Mi Gmail»): reglas puras (sin red ni base). Las usan la función del
// servidor gmail-lectura y la lectura en la app (enviosCorreo.jsx), para que ambas entiendan igual un correo y decidan igual qué
// completar. Pruebas en tests/gmail-lectura.test.mjs.
import { emailsDe } from './facturaEnvioReglas.js'

export const TZ = 'America/Santiago'

/** Día del mes y hora en Chile de un instante. @param {Date} ahora @returns {{dia:number, hora:number}} */
export function fechaHoraChile(ahora) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(ahora)
  const g = t => Number((p.find(x => x.type === t) || { value: '0' }).value)
  return { dia: g('day'), hora: g('hour') }
}

/** Lectura programada: todos los días a las 07:00 (hora de Chile) y, del 1 al 8 de cada mes, también a las 13:00 y 18:00. @param {Date} [ahora] */
export function debeLeerAhora(ahora = new Date()) {
  const { dia, hora } = fechaHoraChile(ahora)
  return hora === 7 || (dia >= 1 && dia <= 8 && (hora === 13 || hora === 18))
}

/** Horas sin lectura a partir de las cuales el estado pasa a «Atrasado»: 20 del 1 al 8 (tres lecturas al día), 36 el resto. @param {Date} [ahora] */
export function umbralHoras(ahora = new Date()) {
  const { dia } = fechaHoraChile(ahora)
  return dia >= 1 && dia <= 8 ? 20 : 36
}

/**
 * Estado de la conexión de una persona, calculado con la hora de su última lectura buena (no depende de que la tarea del servidor corra:
 * si deja de leer, el estado sale solo).
 * 'sin' no conectó · 'ok' al día (o recién conectada, sin primera lectura) · 'atrasada' pasó el umbral · 'fallo' pasó el doble ·
 * 'reconectar' Google rechazó el permiso.
 * @param {{estado?:string, ultimo_ok?:string|null}|null|undefined} c @param {Date} [ahora]
 * @returns {{k:'sin'|'ok'|'atrasada'|'fallo'|'reconectar'}}
 */
export function estadoConexion(c, ahora = new Date()) {
  if (!c) return { k: 'sin' }
  if (c.estado === 'revocada') return { k: 'reconectar' }
  if (!c.ultimo_ok) return { k: 'ok' }
  const h = (+ahora - +new Date(c.ultimo_ok)) / 3600000
  if (!Number.isFinite(h)) return { k: 'ok' }
  const u = umbralHoras(ahora)
  return { k: h <= u ? 'ok' : h <= u * 2 ? 'atrasada' : 'fallo' }
}

/** Nombres de los adjuntos de un mensaje de Gmail (recorre las partes anidadas). @param {any} payload @returns {{nombre:string, mime:string}[]} */
export function adjuntosDe(payload) {
  /** @type {{nombre:string, mime:string}[]} */
  const out = []
  /** @param {any} x */
  const rec = x => { if (!x) return; if (x.filename) out.push({ nombre: x.filename, mime: x.mimeType }); (x.parts || []).forEach(rec) }
  rec(payload)
  return out
}

/**
 * Mensaje de la API de Gmail → el correo que entienden las reglas (solo encabezados, adjuntos y el comienzo del texto; nunca el cuerpo).
 * La fecha es el día en Chile.
 * @param {any} j
 */
export function correoDeMensaje(j) {
  if (!j || !j.id) return null
  /** @type {Record<string,string>} */
  const H = {}
  ;(j.payload?.headers || []).forEach((/** @type {any} */ h) => { H[String(h.name).toLowerCase()] = h.value })
  const d = new Date(Number(j.internalDate))
  return {
    id: String(j.id), de: emailsDe(H.from)[0] || '', para: emailsDe(H.to), cc: emailsDe(H.cc), asunto: String(H.subject || ''),
    fecha: Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-CA', { timeZone: TZ }) : '', adjuntos: adjuntosDe(j.payload), fragmento: String(j.snippet || ''),
  }
}

/**
 * Qué completar en facturas que figuran enviadas SIN prueba (sin destinatario registrado) cuando un correo enviado las contiene
 * (solo nivel «coincide»): quién envió, a quién y la fecha real del correo (una marca a mano llevaba la fecha en que se marcó).
 * No cambia el estado de envío. Una factura con destinatario ya registrado no se toca.
 * @param {{facturas:any[], hallazgos:{correo_id:string, factura_id:any, nivel:string}[], correos:any[], quien:string}} p
 */
export function planAtribucion({ facturas, hallazgos, correos, quien }) {
  const porCorreo = new Map((correos || []).map(c => [String(c.id), c]))
  const porFac = new Map((facturas || []).map(f => [String(f.id), f]))
  const vistas = new Set()
  /** @type {{id:any, email_sent_at:string, sent_by:string, sent_to:string|null, fecha_marcada:string, fecha_real:string, correo_id:string}[]} */
  const out = []
  for (const h of hallazgos || []) {
    if (h.nivel !== 'coincide') continue
    const f = porFac.get(String(h.factura_id)), c = porCorreo.get(String(h.correo_id))
    if (!f || !c || !f.email_sent_at || f.sent_to || vistas.has(String(f.id))) continue
    vistas.add(String(f.id))
    const dest = [...(c.para || []), ...(c.cc || [])].join(', ')
    const mismoDia = String(f.email_sent_at).slice(0, 10) === c.fecha
    const at = mismoDia || !c.fecha ? f.email_sent_at : new Date(c.fecha + 'T15:00:00Z').toISOString()   // 15:00 UTC = mediodía en Chile: el mismo día en cualquier zona del servidor
    out.push({ id: f.id, email_sent_at: at, sent_by: quien, sent_to: dest || null, fecha_marcada: String(f.email_sent_at).slice(0, 10), fecha_real: c.fecha, correo_id: String(c.id) })
  }
  return out
}

/**
 * Saludo con que empieza un correo enviado («Estimada Carolina,»), para aprender el trato de esa persona. Solo si el correo va a UNA dirección
 * de afuera (sin contar la copia) y el saludo es singular con un nombre: «Estimados,» o dos destinatarios no enseñan nada. Toma el comienzo del
 * texto (snippet de Gmail); nunca el cuerpo.
 * @param {{para?:any, fragmento?:string}} correo @param {string} [dominio]
 * @returns {{email:string, saludo:string}|null}
 */
export function saludoDeCorreo(correo, dominio = '') {
  const m = String(correo?.fragmento || '').match(/^\s*(Estimad[oa])\s+([A-ZÁÉÍÓÚÑ][\p{L}'-]+)\s*[,:]/u)
  if (!m) return null
  const dom = String(dominio || '').toLowerCase().replace(/^@/, '')
  const dest = [...new Set(emailsDe(correo?.para))].filter(e => !dom || !e.endsWith('@' + dom))
  return dest.length === 1 ? { email: dest[0], saludo: `${m[1]} ${m[2]},` } : null
}
