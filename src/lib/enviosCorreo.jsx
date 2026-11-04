// Facturas enviadas FUERA de la app. Se reconocen en los enviados de quien abre la app (solo encabezados, nombres de adjuntos y el
// inicio del texto) con la regla estricta de _shared/facturaEnvioReglas.js: el correo debe ir a un contacto del MISMO cliente de la
// factura y nombrarla. Se propone y se marca con un toque; nada se marca solo. Misma mecánica que fondosCorreo.jsx.
import { supabase, DEMO } from '../supabase'
import { BRAND } from './base.jsx'
import { driveToken, logActividad, okDB, registrarError, setLearningKV } from './compartido.jsx'
import { emailsDe, enviosDetectados } from '../../supabase/functions/_shared/facturaEnvioReglas.js'

const CLAVE = 'factura_envio_correo'   // learnings: key = «id del correo|id de la factura», value = 'marcada' | 'descartada' (no vuelve a proponerse)
const DIAS = 60

// Nombres de adjuntos de un mensaje de Gmail (recorre las partes anidadas).
const adjuntosDe = p => {
  const out = []
  const rec = x => { if (!x) return; if (x.filename) out.push({ nombre: x.filename, mime: x.mimeType }); (x.parts || []).forEach(rec) }
  rec(p)
  return out
}

export async function detectarEnviosFacturas({ facturas }) {
  if (DEMO || !facturas?.length) return []
  const token = await driveToken(); if (!token) return []
  const q = encodeURIComponent(`in:sent newer_than:${DIAS}d (factura OR fact OR dte OR folio) -in:trash`)
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=120`, { headers: { Authorization: 'Bearer ' + token } })
  if (!r.ok) return []
  const ids = ((await r.json()).messages || []).map(m => m.id)
  if (!ids.length) return []
  const [{ data: ctc }, { data: lrn }, { data: vistos }, { data: cli }] = await Promise.all([
    supabase.from('contacts').select('client_id,email'),
    supabase.from('learnings').select('key,value').in('kind', ['factura_to', 'factura_cc', 'fondos_contacto']),
    supabase.from('learnings').select('key').eq('kind', CLAVE),
    supabase.from('clients').select('id,email'),
  ])
  const mapa = new Map()
  const agrega = (email, cid) => { const e = String(email || '').trim().toLowerCase(); if (!e.includes('@') || !cid) return; const s = mapa.get(e) || new Set(); s.add(String(cid)); mapa.set(e, s) }
  ;(ctc || []).forEach(c => agrega(c.email, c.client_id))
  ;(cli || []).forEach(c => emailsDe(c.email).forEach(e => agrega(e, c.id)))
  ;(lrn || []).forEach(l => { if (/^[0-9a-f-]{36}$/i.test(String(l.key))) emailsDe(l.value).forEach(e => agrega(e, l.key)); else agrega(l.key, l.value) })
  const ya = new Set((vistos || []).map(v => String(v.key)))
  const correos = []
  for (const id of ids) {
    try {
      const rr = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full&fields=id,internalDate,snippet,payload(headers,filename,mimeType,parts(filename,mimeType,parts(filename,mimeType,parts(filename,mimeType))))`, { headers: { Authorization: 'Bearer ' + token } })
      if (!rr.ok) continue
      const j = await rr.json(), H = {}
      ;(j.payload?.headers || []).forEach(h => { H[h.name.toLowerCase()] = h.value })
      const d = new Date(Number(j.internalDate))
      correos.push({ id, de: emailsDe(H.from)[0] || '', para: emailsDe(H.to), cc: emailsDe(H.cc), asunto: String(H.subject || ''), fecha: Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-CA') : '', adjuntos: adjuntosDe(j.payload), fragmento: String(j.snippet || '') })
    } catch (_) { /* un correo ilegible no frena el resto */ }
  }
  const hallazgos = enviosDetectados({ correos, facturas, mapa, dominio: BRAND.emailDominio || '' })
    .filter(h => !ya.has(`${h.correo_id}|${h.factura_id}`))
  const porId = new Map(correos.map(c => [c.id, c]))
  const fPorId = new Map(facturas.map(f => [String(f.id), f]))
  return hallazgos.map(h => ({ ...h, correo: porId.get(h.correo_id), factura: fPorId.get(String(h.factura_id)) }))
    .filter(h => h.correo && h.factura)
    .sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === 'coincide' ? -1 : 1))
}

// Marca la factura como enviada (con la fecha real del correo) y recuerda la decisión para no volver a proponerla.
export async function marcarEnviadaDesdeCorreo(h, quien) {
  const at = h.correo.fecha ? new Date(h.correo.fecha + 'T12:00:00').toISOString() : new Date().toISOString()
  const dest = [...h.correo.para, ...h.correo.cc].join(', ')
  okDB(await supabase.from('billing').update({ email_sent_at: at, sent_to: dest || null, sent_by: quien || null }).eq('id', h.factura.id), 'marcar la factura como enviada')
  try { await setLearningKV(CLAVE, `${h.correo_id}|${h.factura_id}`, 'marcada') } catch (e) { registrarError({ origen: 'accion', vista: 'factura_envio_correo', err: e }) }
  return at
}
export async function descartarEnvioCorreo(h) {
  try { await setLearningKV(CLAVE, `${h.correo_id}|${h.factura_id}`, 'descartada') } catch (e) { registrarError({ origen: 'accion', vista: 'factura_envio_correo', err: e }) }
}
// Marca manual («Ya enviada»): sin correo que lo pruebe; queda con la fecha real que se indique y quién envió.
export async function marcarEnviadaManual(b, quien, fecha) {
  const at = fecha ? new Date(String(fecha).slice(0, 10) + 'T12:00:00').toISOString() : new Date().toISOString()   // fecha real del envío; sin ella, hoy
  okDB(await supabase.from('billing').update({ email_sent_at: at, sent_by: quien || null }).eq('id', b.id), 'marcar la factura como enviada')
  return at
}

// Facturas que figuran enviadas SIN prueba (sin destinatario registrado: marcadas a mano, o enviadas antes de que se registrara quién y a
// quién). Se leen los enviados de quien abre la app con la regla estricta («coincide»: destinatario del cliente + folio) y, si el correo
// está, se completa quién lo envió, a quién y la fecha REAL del correo (una marca a mano llevaba la fecha en que se marcó). No cambia
// el estado de envío ni cifras; cada corrección queda en la bitácora. Solo alcanza los últimos 60 días de quien abre la app.
let _atribuido = false
export async function atribuirEnvios({ facturas, quien }) {
  if (DEMO || _atribuido || !quien || !facturas?.length) return []
  const sinPrueba = facturas.filter(f => f.email_sent_at && !f.sent_to && f.issued_at)
  if (!sinPrueba.length) return []
  _atribuido = true
  const hall = (await detectarEnviosFacturas({ facturas: sinPrueba })).filter(h => h.nivel === 'coincide')
  const hechos = []
  for (const h of hall) {
    const f = h.factura
    if (hechos.some(x => x.factura.id === f.id)) continue
    const dest = [...h.correo.para, ...h.correo.cc].join(', ')
    const mismoDia = String(f.email_sent_at).slice(0, 10) === h.correo.fecha
    const at = mismoDia || !h.correo.fecha ? f.email_sent_at : new Date(h.correo.fecha + 'T12:00:00').toISOString()
    try {
      okDB(await supabase.from('billing').update({ email_sent_at: at, sent_by: quien, sent_to: dest || null }).eq('id', f.id).is('sent_to', null), 'registrar el envío de la factura')
      logActividad('facturacion.remitente_detectado', { tabla: 'billing', id: f.id, detalle: { por: quien, para: dest, correo: h.correo_id, fecha_marcada: String(f.email_sent_at).slice(0, 10), fecha_real: h.correo.fecha } })
      hechos.push({ factura: f, sent_by: quien, sent_to: dest, email_sent_at: at })
    } catch (e) { registrarError({ origen: 'accion', vista: 'envios_remitente', err: e }) }
  }
  return hechos
}
