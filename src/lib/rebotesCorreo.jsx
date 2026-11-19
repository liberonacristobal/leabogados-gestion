// Rebotes de correo («No entregado»). Gmail acepta el mensaje y el rechazo llega después, como un correo del servidor
// (mailer-daemon) a la bandeja de quien envió. Aquí se leen esos correos (solo encabezados y el inicio del texto), se cruzan con los
// envíos de la app con la regla de _shared/direccionesReglas.js y el resultado queda guardado (learnings 'envio_rebotado').
// Una vez por sesión y solo con acceso a Gmail; sin acceso no pasa nada. Cada rebote se lee con el Gmail de quien envió.
import { useEffect, useState } from 'react'
import { supabase, DEMO } from '../supabase'
import { driveToken, registrarError, setLearningKV } from './compartido.jsx'
import { emailsDe } from '../../supabase/functions/_shared/facturaEnvioReglas.js'
import { motivoDeRebote, rebotesDe } from '../../supabase/functions/_shared/direccionesReglas.js'

const KIND = 'envio_rebotado'   // key = «tipo:id del envío», value = JSON {dir, motivo, en}
const DIAS = 14

let _mapa = new Map()
let _cargado = false
const _enviados = new Set()   // envíos ya cruzados en esta sesión
const _subs = new Set()
const _emitir = () => _subs.forEach(f => f(_mapa))

// Mapa «tipo:id» → {dir, motivo, en}. Se muestra solo si el rebote es posterior al último envío (un reenvío bueno lo apaga solo).
async function cargarMapa() {
  const { data } = await supabase.from('learnings').select('key,value').eq('kind', KIND)
  const m = new Map()
  ;(data || []).forEach(l => { try { m.set(String(l.key), JSON.parse(l.value)) } catch (_) { /* fila ilegible: se ignora */ } })
  _mapa = m; _cargado = true; _emitir()
}

// Los correos de rebote se leen una sola vez por sesión; cada pantalla que declara envíos (rendiciones, facturas) los cruza con los suyos.
let _correosP = null
const leerCorreos = () => (_correosP ||= leerRebotesGmail().catch(e => { _correosP = null; throw e }))

async function leerRebotesGmail() {
  const token = await driveToken(); if (!token) return []
  const q = encodeURIComponent(`(from:mailer-daemon OR from:postmaster) newer_than:${DIAS}d`)
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=40`, { headers: { Authorization: 'Bearer ' + token } })
  if (!r.ok) return []
  const ids = ((await r.json()).messages || []).map(m => m.id)
  const correos = []
  for (const id of ids) {
    try {
      const x = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=X-Failed-Recipients&fields=id,internalDate,snippet,payload(headers)`, { headers: { Authorization: 'Bearer ' + token } })
      if (!x.ok) continue
      const j = await x.json(), H = {}
      ;(j.payload?.headers || []).forEach(h => { H[h.name.toLowerCase()] = h.value })
      const fallidos = emailsDe(H['x-failed-recipients'] || '')
      const snip = String(j.snippet || '')
      correos.push({ id, fecha_ms: Number(j.internalDate), fallidos: fallidos.length ? fallidos : emailsDe(snip), motivo: motivoDeRebote(snip) })
    } catch (_) { /* un correo ilegible no frena el resto */ }
  }
  return correos
}

async function detectar(envios) {
  if (!envios.length) return
  const correos = await leerCorreos()
  for (const h of rebotesDe({ correos, envios })) {
    const key = `${h.tipo}:${h.envio_id}`
    const previo = _mapa.get(key)
    if (previo && new Date(previo.en).getTime() >= h.fecha_ms) continue
    const val = { dir: h.direccion, motivo: h.motivo, en: new Date(h.fecha_ms).toISOString() }
    try { await setLearningKV(KIND, key, JSON.stringify(val)); _mapa = new Map(_mapa).set(key, val) } catch (e) { registrarError({ origen: 'accion', vista: 'rebote', err: e }) }
  }
  _emitir()
}

/** Destinatarios (Para y Cc) de lo enviado en los últimos días: rendiciones del cliente y facturas. */
export function enviosRecientes({ rendiciones = [], facturas = [] }) {
  const desde = Date.now() - DIAS * 86400000
  const lista = a => (Array.isArray(a) ? a : String(a || '').split(/[,;]/)).map(s => String(s).trim()).filter(Boolean)
  const out = []
  rendiciones.forEach(r => { const ms = Date.parse(r.sent_at || ''); if (r.tipo === 'cliente' && ms >= desde && r.estado_envio !== 'externa') out.push({ id: String(r.id), tipo: 'rendicion', enviado_ms: ms, destinatarios: [...lista(r.correo?.para), ...lista(r.correo?.cc), ...lista(r.dirigido_email)] }) })
  facturas.forEach(b => { const ms = Date.parse(b.email_sent_at || ''); if (ms >= desde && b.sent_to) out.push({ id: String(b.id), tipo: 'factura', enviado_ms: ms, destinatarios: lista(b.sent_to) }) })
  return out.filter(e => e.destinatarios.length)
}

/** Mapa de rebotes vigentes. `envios` (opcional) dispara una sola lectura de Gmail por sesión. Devuelve una función `rebotado(tipo, id, sentAt)` → {dir, motivo} | null. */
export function useRebotes(envios) {
  const [m, setM] = useState(_mapa)
  useEffect(() => {
    if (DEMO) return
    _subs.add(setM)
    if (!_cargado) cargarMapa().catch(e => registrarError({ origen: 'carga', vista: 'rebotes', err: e }))
    else setM(_mapa)
    return () => { _subs.delete(setM) }
  }, [])
  useEffect(() => {
    const nuevos = (envios || []).filter(e => !_enviados.has(`${e.tipo}:${e.id}`))
    if (DEMO || !nuevos.length) return
    nuevos.forEach(e => _enviados.add(`${e.tipo}:${e.id}`))
    ;(async () => { try { if (!_cargado) await cargarMapa(); await detectar(nuevos) } catch (e) { registrarError({ origen: 'carga', vista: 'rebotes', err: e }) } })()
  }, [envios?.length])   // eslint-disable-line react-hooks/exhaustive-deps
  return (tipo, id, sentAt) => { const v = m.get(`${tipo}:${id}`); return v && (!sentAt || new Date(v.en).getTime() >= new Date(sentAt).getTime() - 60000) ? v : null }
}
