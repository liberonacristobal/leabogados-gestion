// Solicitudes de fondos pedidas desde el correo de cada socio. Se reconocen en los enviados de quien abre la app (solo asunto y
// fragmento de los correos que mencionan «fondos» o «provisión») y se registran con un toque en fund_requests. Con la solicitud
// registrada, conciliacion-auto propone el fondo cuando llega el depósito y el aviso diario deja de insistir con ese cliente.
import { useState, useEffect } from 'react'
import { supabase, DEMO } from '../supabase'
import { C, fmt, fmtFechaDMY, isoLocal } from './base.jsx'
import { clienteDeCorreo, montoSolicitado } from '../../supabase/functions/_shared/fondosReglas.js'
import { chipBtn, driveToken, estadoSolicitud, logActividad, okDB, registrarError, setLearningKV } from './compartido.jsx'

const DIAS = 14
const CLAVE = 'fondos_correo'   // learnings: key = id del correo, value = 'registrada' | 'descartada' (no vuelve a proponerse)

// Texto plano del cuerpo, sin la parte citada de correos anteriores (ahí vienen montos que no son de esta solicitud).
const b64 = d => { try { return decodeURIComponent(escape(atob(String(d).replace(/-/g, '+').replace(/_/g, '/')))) } catch (_) { return '' } }
const textoPlano = p => {
  if (!p) return ''
  if (p.mimeType === 'text/plain' && p.body?.data) return b64(p.body.data)
  return (p.parts || []).map(textoPlano).find(Boolean) || ''
}
const sinCita = t => String(t || '').split(/\n(?:El .{5,80} escribi[oó]:|On .{5,80} wrote:|>)/)[0]

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
      const rr = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, { headers: { Authorization: 'Bearer ' + token } })
      if (!rr.ok) return
      const j = await rr.json(), H = {}
      ;(j.payload?.headers || []).forEach(h => { H[h.name.toLowerCase()] = h.value })
      const asunto = String(H.subject || ''), cuerpo = sinCita(textoPlano(j.payload)) || String(j.snippet || ''), texto = `${asunto} ${cuerpo}`
      if (!/fondos?|provisi[oó]n/i.test(texto)) return
      const monto = montoSolicitado(texto); if (!monto) return
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

// Solicitudes de fondos en un solo lugar: por registrar (detectadas en tus enviados), esperando depósito y recibidas, con el responsable
// (enviada_por) y la historia de cada una dentro de la fila. «Registrar» y «No es solicitud» son la compuerta: se aprende y no vuelve a salir.
const COLS = 'id,client_id,monto,asunto,enviada_por,enviada_at,recibido_at,movimiento_id'
const PILL = {
  det: { t: 'Detectada', bg: C.soonBg, c: C.soonText },
  env: { t: 'Pedida', bg: C.azulBg, c: C.azulInfo },
  sin: { t: 'Sin respuesta', bg: C.soonBg, c: C.soonText },
  rec: { t: 'Recibida', bg: C.greenBg, c: C.greenText },
}
const TABS = [['reg', 'Por registrar'], ['esp', 'Esperando'], ['rec', 'Recibidas']]
const segBtn = on => ({ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '3px 10px', cursor: 'pointer', whiteSpace: 'nowrap', border: `1px solid ${on ? C.accent : C.border}`, background: on ? C.accent : C.bgSoft, color: on ? '#fff' : C.muted, fontFamily: 'inherit' })

export function SolicitudesFondos({ clients = [], expenses = [], user, onOpenClientFicha }) {
  const [det, setDet] = useState(null)
  const [reqs, setReqs] = useState(null)
  const [tab, setTab] = useState(null)
  const [quien, setQuien] = useState(null)
  const [abierta, setAbierta] = useState(null)
  const [busy, setBusy] = useState(null)
  const cacheKey = `fd_fondos_correo_${user?.email || ''}`
  useEffect(() => {
    let vivo = true
    if (DEMO) return
    ;(async () => {
      try {
        const c = JSON.parse(sessionStorage.getItem(cacheKey) || 'null')
        if (c && Date.now() - c.t < 20 * 60000) { if (vivo) setDet(c.items); return }
      } catch (_) { /* sin almacenamiento: se escanea */ }
      try {
        const r = await detectarSolicitudesFondos(clients)
        if (vivo) setDet(r)
        try { sessionStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), items: r })) } catch (_) { /* sin almacenamiento */ }
      } catch (e) { if (vivo) setDet([]); if (e?.code !== 401) registrarError({ origen: 'accion', vista: 'fondos_correo', err: e }) }
    })()
    return () => { vivo = false }
  }, [cacheKey])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!DEMO) return
    const cs = (clients || []).filter(c => !c.is_internal).slice(0, 4)
    setDet(cs.slice(0, 2).map((c, i) => ({ id: 'demo' + i, asunto: i ? 'Provisión de fondos' : 'Solicitud de fondos', fecha: i ? '2026-10-28' : '2026-10-27', para: '', cc: '', client_id: String(c.id), monto: i ? 300000 : 1200000 })))
    setReqs(cs.slice(2).map((c, i) => ({ id: 'dr' + i, client_id: String(c.id), monto: i ? 700000 : 800000, asunto: 'Solicitud de fondos por rendir', enviada_por: i ? 'Cristóbal' : 'Erasmo', enviada_at: i ? '2026-10-15T12:00:00Z' : '2026-10-22T12:00:00Z', recibido_at: null })))
  }, [clients.length])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (DEMO) return
    let vivo = true
    const desde = new Date(Date.now() - 90 * 86400000).toISOString()
    supabase.from('fund_requests').select(COLS).gte('enviada_at', desde).order('enviada_at', { ascending: false }).limit(300)
      .then(({ data }) => { if (vivo) setReqs(data || []) }, () => { if (vivo) setReqs([]) })
    return () => { vivo = false }
  }, [])
  const nombre = id => (clients || []).find(c => String(c.id) === String(id))?.name || 'Cliente'
  const quita = id => setDet(p => {
    const n = (p || []).filter(x => x.id !== id)
    try { sessionStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), items: n })) } catch (_) { /* sin almacenamiento */ }
    return n
  })
  const filas = [
    ...(det || []).map(it => ({ k: 'det', tab: 'reg', id: it.id, it, client_id: it.client_id, monto: it.monto, asunto: it.asunto, fecha: it.fecha, por: user?.name || '' })),
    ...(reqs || []).map(r => {
      const st = estadoSolicitud(r, expenses)
      return { k: st.k, tab: st.k === 'rec' ? 'rec' : 'esp', id: 'r' + r.id, r, st, client_id: r.client_id, monto: r.monto, asunto: r.asunto, fecha: String(r.enviada_at || '').slice(0, 10), por: r.enviada_por || '' }
    }),
  ]
  if (!filas.length) return null
  const personas = [...new Set(filas.map(f => f.por).filter(Boolean))]
  const cuenta = t => filas.filter(f => f.tab === t).length
  const tabAct = tab || (cuenta('reg') ? 'reg' : cuenta('esp') ? 'esp' : 'rec')
  const lista = filas.filter(f => f.tab === tabAct && (!quien || f.por === quien))
    .sort((a, b) => tabAct === 'esp' ? String(a.fecha).localeCompare(String(b.fecha)) : String(b.fecha).localeCompare(String(a.fecha)))
    .slice(0, tabAct === 'rec' ? 15 : 60)
  const registrar = async it => {
    setBusy(it.id)
    try {
      if (DEMO) { quita(it.id); return }
      const fila = { client_id: it.client_id, monto: it.monto, asunto: it.asunto, para: it.para, cc: it.cc, enviada_por: user?.name || null, enviada_at: `${it.fecha}T12:00:00Z` }
      const res = await supabase.from('fund_requests').insert(fila).select(COLS).single()
      if (!okDB(res, 'registrar la solicitud de fondos')) return
      setReqs(p => [res.data, ...(p || [])])
      try { await setLearningKV(CLAVE, it.id, 'registrada') } catch (e) { registrarError({ origen: 'accion', vista: CLAVE, err: e }) }
      logActividad('fondos.solicitud_enviada', { tabla: 'clients', id: it.client_id, detalle: { cliente: nombre(it.client_id), title: 'Solicitud detectada en el correo', monto: it.monto } })
      quita(it.id)
    } finally { setBusy(null) }
  }
  const descartar = async it => {
    setBusy(it.id)
    try {
      if (!DEMO) {
        await setLearningKV(CLAVE, it.id, 'descartada')
        logActividad('fondos.solicitud_descartada', { tabla: 'clients', id: it.client_id, detalle: { cliente: nombre(it.client_id), title: 'Detectada en el correo y descartada', monto: it.monto } })
      }
    } catch (e) { registrarError({ origen: 'accion', vista: CLAVE, err: e }) }
    quita(it.id); setBusy(null)
  }
  const historia = f => {
    const pasos = [{ ok: true, t: 'Solicitud enviada', d: fmtFechaDMY(f.fecha), q: f.por }]
    if (f.k === 'det') pasos.push({ ok: false, t: 'Aún no registrada en la app' })
    else if (f.k === 'rec') pasos.push({ ok: true, t: 'Depósito recibido', d: fmtFechaDMY(f.st?.dep?.date || String(f.r?.recibido_at || '').slice(0, 10)) })
    else pasos.push({ ok: false, t: `Sin depósito · ${f.st?.dias ?? 0} días` })
    return pasos
  }
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '10px 14px', marginBottom: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: C.accent, marginBottom: 6 }}>Solicitudes de fondos</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        {TABS.map(([k, t]) => <button key={k} type='button' onClick={() => setTab(k)} style={segBtn(tabAct === k)}>{t} · {cuenta(k)}</button>)}
      </div>
      {personas.length > 1 && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
        <button type='button' onClick={() => setQuien(null)} style={segBtn(!quien)}>Todos</button>
        {personas.map(p => <button key={p} type='button' onClick={() => setQuien(p)} style={segBtn(quien === p)}>{p}</button>)}
      </div>}
      {!lista.length && <div style={{ fontSize: 12, color: C.textSoft, padding: '8px 0' }}>Sin solicitudes en esta pestaña.</div>}
      {lista.map((f, i) => {
        const pl = PILL[f.k === 'det' ? 'det' : f.k], abre = abierta === f.id
        return (
          <div key={f.id} style={{ borderTop: i ? `1px solid ${C.border}` : 'none' }}>
            <div onClick={() => setAbierta(abre ? null : f.id)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', padding: '8px 0', cursor: 'pointer' }}>
              <div style={{ minWidth: 0, flex: '1 1 110px' }}>
                <div onClick={onOpenClientFicha ? e => { e.stopPropagation(); onOpenClientFicha(f.client_id) } : undefined} style={{ fontSize: 13, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: onOpenClientFicha ? 'pointer' : 'default' }}>{nombre(f.client_id)}</div>
                <div style={{ fontSize: 11, color: C.textSoft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fmtFechaDMY(f.fecha)}{f.por ? ` · ${f.por}` : ''}{f.asunto ? ` · ${f.asunto}` : ''}</div>
              </div>
              <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 6, padding: '2px 7px', background: pl.bg, color: pl.c, whiteSpace: 'nowrap' }}>{pl.t}</span>
              <span style={{ fontWeight: 700, color: C.accent, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmt(f.monto)}</span>
              {f.k === 'det' && <div style={{ display: 'flex', gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                <button type='button' disabled={busy === f.id} onClick={() => registrar(f.it)} style={chipBtn('primary')}>Registrar</button>
                <button type='button' disabled={busy === f.id} onClick={() => descartar(f.it)} style={chipBtn()}>No es solicitud</button>
              </div>}
            </div>
            {abre && <div style={{ display: 'grid', gap: 3, padding: '0 0 8px 8px' }}>
              {historia(f).map((p, j) => <div key={j} style={{ fontSize: 11.5, color: p.ok ? C.text : C.textSoft }}>{p.t}{p.d ? ` · ${p.d}` : ''}{p.q ? ` · ${p.q}` : ''}</div>)}
            </div>}
          </div>
        )
      })}
    </div>
  )
}
