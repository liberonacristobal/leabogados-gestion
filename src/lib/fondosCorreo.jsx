// Solicitudes de fondos pedidas desde el correo de cada socio. Se reconocen en los enviados de quien abre la app (solo asunto y
// fragmento de los correos que mencionan «fondos» o «provisión») y se registran con un toque en fund_requests. Con la solicitud
// registrada, conciliacion-auto propone el fondo cuando llega el depósito y el aviso diario deja de insistir con ese cliente.
import { useState, useEffect } from 'react'
import { supabase, DEMO } from '../supabase'
import { C, fmt, fmtFechaDMY, isoLocal } from './base.jsx'
import { clienteDeCorreo, montoDeTexto } from '../../supabase/functions/_shared/fondosReglas.js'
import { chipBtn, driveToken, logActividad, okDB, registrarError, setLearningKV } from './compartido.jsx'

const DIAS = 14
const CLAVE = 'fondos_correo'   // learnings: key = id del correo, value = 'registrada' | 'descartada' (no vuelve a proponerse)

const emailsDe = h => [...String(h || '').matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)].map(m => m[0].toLowerCase())

export async function detectarSolicitudesFondos(clients) {
  const token = await driveToken(); if (!token) return []
  const q = encodeURIComponent(`in:sent newer_than:${DIAS}d (fondos OR provisión OR provision) -in:trash`)
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=40`, { headers: { Authorization: 'Bearer ' + token } })
  if (!r.ok) return []
  const ids = ((await r.json()).messages || []).map(m => m.id)
  if (!ids.length) return []
  const hace30 = new Date(Date.now() - 30 * 86400000).toISOString()
  const [{ data: ctc }, { data: lrn }, { data: vistos }, { data: frs }] = await Promise.all([
    supabase.from('contacts').select('client_id,email'),
    supabase.from('learnings').select('key,value').in('kind', ['factura_to', 'factura_cc']),
    supabase.from('learnings').select('key').eq('kind', CLAVE),
    supabase.from('fund_requests').select('client_id,monto,enviada_at').gte('enviada_at', hace30),
  ])
  const mapa = new Map()
  const agrega = (email, cid) => { const e = String(email || '').trim().toLowerCase(); if (!e.includes('@') || !cid) return; const s = mapa.get(e) || new Set(); s.add(String(cid)); mapa.set(e, s) }
  ;(ctc || []).forEach(c => agrega(c.email, c.client_id))
  ;(lrn || []).forEach(l => emailsDe(l.value).forEach(e => agrega(e, l.key)))
  const ya = new Set((vistos || []).map(v => String(v.key)))
  const nuevos = ids.filter(id => !ya.has(id))
  const out = []
  const meta = async id => {
    try {
      const rr = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject`, { headers: { Authorization: 'Bearer ' + token } })
      if (!rr.ok) return
      const j = await rr.json(), H = {}
      ;(j.payload?.headers || []).forEach(h => { H[h.name.toLowerCase()] = h.value })
      const asunto = String(H.subject || ''), texto = `${asunto} ${j.snippet || ''}`
      if (!/fondos?|provisi[oó]n/i.test(texto)) return
      const monto = montoDeTexto(texto); if (!monto) return
      const para = emailsDe(H.to), cc = emailsDe(H.cc)
      const client_id = clienteDeCorreo([...para, ...cc], texto, clients, mapa); if (!client_id) return
      const fecha = isoLocal(Number(j.internalDate)) || new Date().toISOString().slice(0, 10)
      // Ya registrada por otra vía (el módulo «Solicitar fondos» o la rendición): mismo cliente y monto dentro de 2 días.
      const t0 = new Date(fecha + 'T12:00').getTime()
      if ((frs || []).some(f => String(f.client_id) === client_id && Number(f.monto) === monto && Math.abs(new Date(f.enviada_at).getTime() - t0) <= 2 * 86400000)) return
      out.push({ id, asunto, fecha, para: para.join(','), cc: cc.join(','), client_id, monto })
    } catch (_) { /* un correo ilegible no frena a los demás */ }
  }
  for (let i = 0; i < nuevos.length; i += 8) await Promise.all(nuevos.slice(i, i + 8).map(meta))
  return out.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
}

// Aviso con las solicitudes detectadas: «Registrar» (compuerta) o «No es solicitud» (se aprende y no vuelve a salir).
export function SolicitudesFondosDetectadas({ clients = [], user, onOpenClientFicha }) {
  const [items, setItems] = useState(null)
  const [busy, setBusy] = useState(null)
  const cacheKey = `fd_fondos_correo_${user?.email || ''}`
  useEffect(() => {
    let vivo = true
    if (DEMO) {
      const cs = (clients || []).filter(c => !c.is_internal).slice(0, 2)
      setItems(cs.map((c, i) => ({ id: 'demo' + i, asunto: i ? 'Provisión de fondos' : 'Solicitud de fondos', fecha: i ? '2026-10-28' : '2026-10-27', para: '', cc: '', client_id: String(c.id), monto: i ? 300000 : 1200000 })))
      return
    }
    ;(async () => {
      try {
        const c = JSON.parse(sessionStorage.getItem(cacheKey) || 'null')
        if (c && Date.now() - c.t < 20 * 60000) { if (vivo) setItems(c.items); return }
      } catch (_) { /* sin almacenamiento: se escanea */ }
      try {
        const r = await detectarSolicitudesFondos(clients)
        if (vivo) setItems(r)
        try { sessionStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), items: r })) } catch (_) { /* sin almacenamiento */ }
      } catch (e) { if (vivo) setItems([]); if (e?.code !== 401) registrarError({ origen: 'accion', vista: 'fondos_correo', err: e }) }
    })()
    return () => { vivo = false }
  }, [cacheKey])   // eslint-disable-line react-hooks/exhaustive-deps
  if (!items?.length) return null
  const quita = id => setItems(p => {
    const n = (p || []).filter(x => x.id !== id)
    try { sessionStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), items: n })) } catch (_) { /* sin almacenamiento */ }
    return n
  })
  const nombre = id => (clients || []).find(c => String(c.id) === String(id))?.name || 'Cliente'
  const registrar = async it => {
    setBusy(it.id)
    try {
      if (DEMO) { quita(it.id); return }
      const fila = { client_id: it.client_id, monto: it.monto, asunto: it.asunto, para: it.para, cc: it.cc, enviada_por: user?.name || null, enviada_at: `${it.fecha}T12:00:00Z` }
      if (!okDB(await supabase.from('fund_requests').insert(fila), 'registrar la solicitud de fondos')) return
      try { await setLearningKV(CLAVE, it.id, 'registrada') } catch (e) { registrarError({ origen: 'accion', vista: CLAVE, err: e }) }
      logActividad('fondos.solicitud_enviada', { tabla: 'clients', id: it.client_id, detalle: { cliente: nombre(it.client_id), title: 'Solicitud detectada en el correo', monto: it.monto } })
      quita(it.id)
    } finally { setBusy(null) }
  }
  const descartar = async it => {
    setBusy(it.id)
    try { if (!DEMO) await setLearningKV(CLAVE, it.id, 'descartada') } catch (e) { registrarError({ origen: 'accion', vista: CLAVE, err: e }) }
    quita(it.id); setBusy(null)
  }
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '10px 14px', marginBottom: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: C.accent, marginBottom: 4 }}>Solicitudes de fondos detectadas en tus enviados · {items.length}</div>
      {items.map((it, i) => (
        <div key={it.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', padding: '8px 0', borderTop: i ? `1px solid ${C.border}` : 'none' }}>
          <div style={{ minWidth: 0, flex: '1 1 180px' }}>
            <div onClick={onOpenClientFicha ? () => onOpenClientFicha(it.client_id) : undefined} style={{ fontSize: 13, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: onOpenClientFicha ? 'pointer' : 'default' }}>{nombre(it.client_id)}</div>
            <div style={{ fontSize: 11, color: C.textSoft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fmtFechaDMY(it.fecha)} · {it.asunto}</div>
          </div>
          <span style={{ fontWeight: 700, color: C.accent, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmt(it.monto)}</span>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button type='button' disabled={busy === it.id} onClick={() => registrar(it)} style={chipBtn('primary')}>Registrar</button>
            <button type='button' disabled={busy === it.id} onClick={() => descartar(it)} style={chipBtn()}>No es solicitud</button>
          </div>
        </div>
      ))}
    </div>
  )
}
