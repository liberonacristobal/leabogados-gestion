// Solicitudes de fondos pedidas desde el correo de cada socio. Se reconocen en los enviados de quien abre la app (solo asunto y
// fragmento de los correos que mencionan «fondos» o «provisión») y se registran con un toque en fund_requests. Con la solicitud
// registrada, conciliacion-auto propone el fondo cuando llega el depósito y el aviso diario deja de insistir con ese cliente.
import { useState, useEffect } from 'react'
import { supabase, DEMO } from '../supabase'
import { BRAND, C, fmt, fmtFechaDMY, isoLocal } from './base.jsx'
import { clienteDeCorreo, clienteDePedido, confirmaPago, esFormularioFondos, montoSolicitado, pedidoDeSolicitud, pedidosInternos } from '../../supabase/functions/_shared/fondosReglas.js'
import { chipBtn, driveToken, estadoSolicitud, logActividad, nombresMiembros, okDB, registrarError, setLearningKV } from './compartido.jsx'

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

const MSG = 'fondos_msg'         // learnings: key = id de la solicitud (fund_requests), value = Message-ID del correo enviado (para leer la respuesta del cliente)
const CONF = 'fondos_confirma'   // learnings: key = id de la solicitud, value = JSON {estado: 'confirmo'|'no', fecha, texto, msg} (decisión sobre la respuesta del cliente)
const PEDIDO = 'fondos_pedido'   // learnings: key = «Message-ID del correo|n° de línea» (igual en todas las casillas), value = JSON {estado, client_id, monto, concepto, de, para, fecha}

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
      out.push({ id, asunto, fecha, para: para.join(','), cc: cc.join(','), client_id, monto, mid: String(H['message-id'] || '').trim() })
    } catch (_) { /* un correo ilegible no frena a los demás */ }
  }
  for (let i = 0; i < nuevos.length; i += 8) await Promise.all(nuevos.slice(i, i + 8).map(meta))
  return out.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
}

const adjuntos = p => !p ? [] : [...(p.filename ? [p.filename] : []), ...(p.parts || []).flatMap(adjuntos)]

// Formulario de fondos por rendir en el hilo del pedido: respuesta de una persona del equipo con el Word adjunto. El hilo se busca por el
// Message-ID del pedido (igual en todas las casillas), así lo encuentra quien reciba el pedido en copia o en directo.
async function buscarFormulario(token, mid, dom) {
  const h = { Authorization: 'Bearer ' + token }
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent('rfc822msgid:' + mid.replace(/[<>]/g, ''))}&maxResults=1`, { headers: h })
  if (!r.ok) return null
  const m = ((await r.json()).messages || [])[0]; if (!m) return null
  const t = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${m.threadId}?format=full`, { headers: h })
  if (!t.ok) return null
  for (const msg of (await t.json()).messages || []) {
    const H = {}
    ;(msg.payload?.headers || []).forEach(x => { H[x.name.toLowerCase()] = x.value })
    const de = emailsDe(H.from)[0] || ''
    if (de.endsWith(dom) && adjuntos(msg.payload).some(esFormularioFondos)) return { fecha: isoLocal(Number(msg.internalDate)), por: de }
  }
  return null
}

// Respuesta del cliente en el hilo de la solicitud: el mensaje más reciente de alguien de fuera del equipo, posterior al envío, que dice que ya
// pagó o trae un comprobante. Se devuelve solo para que una persona la confirme.
async function buscarRespuesta(token, mid, dom, desdeMs) {
  const h = { Authorization: 'Bearer ' + token }
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent('rfc822msgid:' + mid.replace(/[<>]/g, ''))}&maxResults=1`, { headers: h })
  if (!r.ok) return null
  const m = ((await r.json()).messages || [])[0]; if (!m) return null
  const t = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${m.threadId}?format=full`, { headers: h })
  if (!t.ok) return null
  let mejor = null
  for (const msg of (await t.json()).messages || []) {
    const H = {}
    ;(msg.payload?.headers || []).forEach(x => { H[x.name.toLowerCase()] = x.value })
    const de = emailsDe(H.from)[0] || '', ms = Number(msg.internalDate)
    if (!de || de.endsWith(dom) || !(ms > desdeMs)) continue
    const texto = sinCita(textoPlano(msg.payload)) || String(msg.snippet || '')
    if (!confirmaPago(texto, adjuntos(msg.payload))) continue
    if (!mejor || ms > mejor.ms) mejor = { ms, fecha: isoLocal(ms), msg: String(H['message-id'] || msg.id).trim(), texto: texto.replace(/\s+/g, ' ').trim().slice(0, 90) }
  }
  return mejor
}

// Pedido interno: un correo entre el equipo («FxR», «fondos por rendir») con una lista «cliente: concepto: monto». Una fila por línea.
// Solo correos de personas del equipo hacia el equipo (no la casilla de la oficina ni nada que salga a un cliente).
export async function detectarPedidosInternos(clients) {
  const token = await driveToken(); if (!token) return []
  const q = encodeURIComponent(`(fxr OR "fondos por rendir" OR "solicitud de fondos" OR "solicitudes de fondos") newer_than:${DIAS}d -in:trash`)
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=30`, { headers: { Authorization: 'Bearer ' + token } })
  if (!r.ok) return []
  const ids = ((await r.json()).messages || []).map(m => m.id)
  if (!ids.length) return []
  const hace30 = new Date(Date.now() - 30 * 86400000).toISOString()
  const [{ data: vistos }, { data: frs }] = await Promise.all([
    supabase.from('learnings').select('key').eq('kind', PEDIDO),
    supabase.from('fund_requests').select('client_id,monto,enviada_at').gte('enviada_at', hace30),
  ])
  const ya = new Set((vistos || []).map(v => String(v.key)))
  const dom = '@' + String(BRAND.emailDominio || '').toLowerCase(), oficina = String(BRAND.casillaAgente || '').toLowerCase()
  const out = []
  const leer = async id => {
    try {
      const rr = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, { headers: { Authorization: 'Bearer ' + token } })
      if (!rr.ok) return
      const j = await rr.json(), H = {}
      ;(j.payload?.headers || []).forEach(h => { H[h.name.toLowerCase()] = h.value })
      const de = emailsDe(H.from)[0] || '', dest = [...emailsDe(H.to), ...emailsDe(H.cc)]
      if (!de.endsWith(dom) || de === oficina || !dest.length || !dest.every(e => e.endsWith(dom))) return
      const ped = pedidosInternos(sinCita(textoPlano(j.payload))); if (!ped.length) return
      const mid = String(H['message-id'] || id).trim(), fecha = isoLocal(Number(j.internalDate)) || new Date().toISOString().slice(0, 10)
      ped.forEach((p, i) => {
        const key = `${mid}|${i}`; if (ya.has(key)) return
        const client_id = clienteDePedido(p.cliente, clients)
        // Ya pedida al cliente: misma solicitud (cliente y monto) desde la fecha del pedido.
        if (client_id && (frs || []).some(f => String(f.client_id) === client_id && Number(f.monto) === p.monto && String(f.enviada_at || '').slice(0, 10) >= fecha)) return
        out.push({ id: key, ...p, client_id, fecha, de, para: emailsDe(H.to).join(',') })
      })
    } catch (_) { /* un correo ilegible no frena a los demás */ }
  }
  for (let i = 0; i < ids.length; i += 8) await Promise.all(ids.slice(i, i + 8).map(leer))
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
  ped: { t: 'Pedido interno', bg: C.soonBg, c: C.soonText },
  por: { t: 'Por solicitar', bg: C.soonBg, c: C.soonText },
  frm: { t: 'Formulario listo', bg: C.azulBg, c: C.azulInfo },
  cnf: { t: 'Cliente confirmó', bg: C.azulBg, c: C.azulInfo },
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
  const [ped, setPed] = useState(null)         // pedidos internos detectados (compuerta)
  const [pedReg, setPedReg] = useState([])     // pedidos registrados que aún no se piden al cliente
  const [eleg, setEleg] = useState({})         // cliente elegido a mano por pedido
  const [nombres, setNombres] = useState({})
  const [msgs, setMsgs] = useState({})         // id de solicitud → Message-ID del correo enviado
  const [confs, setConfs] = useState({})       // id de solicitud → decisión sobre la respuesta del cliente
  const [sug, setSug] = useState({})           // id de solicitud → respuesta del cliente por confirmar
  const cacheKey = `fd_fondos_correo_v2_${user?.email || ''}`
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
    setPed([{ id: 'dp0', cliente: cs[0]?.name || 'Cliente', concepto: 'Puesta en marcha', monto: 2000000, client_id: cs[0] ? String(cs[0].id) : null, fecha: '2026-10-13', de: 'erasmo@demo', para: 'martina@demo' }, { id: 'dp1', cliente: 'Zeta', concepto: 'Reorganización', monto: 1500000, client_id: null, fecha: '2026-10-13', de: 'erasmo@demo', para: 'martina@demo' }])
    setPedReg([{ id: 'dq0', client_id: cs[1] ? String(cs[1].id) : null, concepto: 'Inscripción', monto: 2000000, fecha: '2026-10-13', de: 'erasmo@demo', para: 'martina@demo', formulario: { fecha: '2026-10-13', por: 'martina@demo' } }])
    setSug({ dr0: { fecha: '2026-10-23', texto: 'Ya transferido. Muchas gracias', msg: 'demo' } })
    setReqs(cs.slice(2).map((c, i) => ({ id: 'dr' + i, client_id: String(c.id), monto: i ? 700000 : 800000, asunto: 'Solicitud de fondos por rendir', enviada_por: i ? 'Cristóbal' : 'Erasmo', enviada_at: i ? '2026-10-15T12:00:00Z' : '2026-10-22T12:00:00Z', recibido_at: null })))
  }, [clients.length])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (DEMO) return
    let vivo = true
    nombresMiembros().then(m => { if (vivo) setNombres(m || {}) })
    supabase.from('learnings').select('kind,key,value').in('kind', [MSG, CONF]).then(({ data }) => {
      if (!vivo) return
      const m = {}, c = {}
      ;(data || []).forEach(l => { if (l.kind === MSG) m[String(l.key)] = l.value; else { try { c[String(l.key)] = JSON.parse(l.value) } catch (_) { /* decisión ilegible: se vuelve a preguntar */ } } })
      setMsgs(m); setConfs(c)
    }, () => {})
    supabase.from('learnings').select('key,value').eq('kind', PEDIDO).then(({ data }) => {
      if (!vivo) return
      setPedReg((data || []).map(l => { try { return { id: l.key, ...JSON.parse(l.value) } } catch (_) { return null } }).filter(x => x && x.estado === 'por_solicitar'))
    }, () => {})
    ;(async () => {
      try {
        const c = JSON.parse(sessionStorage.getItem(cacheKey + '_ped') || 'null')
        if (c && Date.now() - c.t < 20 * 60000) { if (vivo) setPed(c.items); return }
      } catch (_) { /* sin almacenamiento: se escanea */ }
      try {
        const r = await detectarPedidosInternos(clients)
        if (vivo) setPed(r)
        try { sessionStorage.setItem(cacheKey + '_ped', JSON.stringify({ t: Date.now(), items: r })) } catch (_) { /* sin almacenamiento */ }
      } catch (e) { if (vivo) setPed([]); if (e?.code !== 401) registrarError({ origen: 'accion', vista: PEDIDO, err: e }) }
    })()
    return () => { vivo = false }
  }, [cacheKey])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (DEMO || !pedReg.length) return
    let vivo = true
    ;(async () => {
      const token = await driveToken(); if (!token) return
      const dom = '@' + String(BRAND.emailDominio || '').toLowerCase(), hace45 = isoLocal(Date.now() - 45 * 86400000)
      for (const p of pedReg.filter(x => !x.formulario && String(x.fecha) >= hace45).slice(0, 15)) {
        const ck = 'fd_form_' + p.id
        try { const c = sessionStorage.getItem(ck); if (c && Date.now() - Number(c) < 20 * 60000) continue } catch (_) { /* sin almacenamiento */ }
        const f = await buscarFormulario(token, String(p.id).split('|')[0], dom)
        try { sessionStorage.setItem(ck, String(Date.now())) } catch (_) { /* sin almacenamiento */ }
        if (!f || !vivo) continue
        const { id, ...resto } = p
        await setLearningKV(PEDIDO, id, JSON.stringify({ ...resto, formulario: f }))
        setPedReg(a => a.map(x => x.id === id ? { ...x, formulario: f } : x))
      }
    })().catch(e => { if (e?.code !== 401) registrarError({ origen: 'accion', vista: PEDIDO, err: e }) })
    return () => { vivo = false }
  }, [pedReg.length])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (DEMO || !reqs || !Object.keys(msgs).length) return
    let vivo = true
    ;(async () => {
      const token = await driveToken(); if (!token) return
      const dom = '@' + String(BRAND.emailDominio || '').toLowerCase()
      const pend = reqs.filter(r => msgs[String(r.id)] && confs[String(r.id)]?.estado !== 'confirmo' && estadoSolicitud(r, expenses).k !== 'rec').slice(0, 15)
      for (const r of pend) {
        const ck = 'fd_resp_' + r.id
        try { const c = sessionStorage.getItem(ck); if (c && Date.now() - Number(c) < 20 * 60000) continue } catch (_) { /* sin almacenamiento */ }
        const f = await buscarRespuesta(token, msgs[String(r.id)], dom, new Date(r.enviada_at).getTime())
        try { sessionStorage.setItem(ck, String(Date.now())) } catch (_) { /* sin almacenamiento */ }
        if (!f || !vivo || confs[String(r.id)]?.msg === f.msg) continue   // ya decidida esa misma respuesta
        setSug(a => ({ ...a, [String(r.id)]: f }))
      }
    })().catch(e => { if (e?.code !== 401) registrarError({ origen: 'accion', vista: CONF, err: e }) })
    return () => { vivo = false }
  }, [reqs, msgs])   // eslint-disable-line react-hooks/exhaustive-deps
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
  const quienEs = e => { const x = String(e || '').toLowerCase(); return nombres[x] || (x.split('@')[0] ? x.split('@')[0][0].toUpperCase() + x.split('@')[0].slice(1) : '') }
  const ruta = it => `${quienEs(it.de)} → ${quienEs(String(it.para || '').split(',')[0])}`
  const ped0 = (r, fecha) => (reqs || []).some(x => String(x.client_id) === String(r.client_id) && Number(x.monto) === Number(r.monto) && String(x.enviada_at || '').slice(0, 10) >= fecha)
  const filas = [
    ...(ped || []).map(it => ({ k: 'ped', tab: 'reg', id: 'p' + it.id, it, client_id: eleg[it.id] || it.client_id, monto: it.monto, asunto: it.concepto, fecha: it.fecha, por: quienEs(it.de), ruta: ruta(it) })),
    ...(pedReg || []).filter(r => !ped0(r, r.fecha)).map(it => ({ k: it.formulario ? 'frm' : 'por', tab: 'esp', id: 'q' + it.id, it, client_id: it.client_id, monto: it.monto, asunto: it.concepto, fecha: it.fecha, por: quienEs(it.de), ruta: ruta(it) })),
    ...(det || []).map(it => ({ k: 'det', tab: 'reg', id: it.id, it, client_id: it.client_id, monto: it.monto, asunto: it.asunto, fecha: it.fecha, por: user?.name || '' })),
    ...(reqs || []).map(r => {
      const st = estadoSolicitud(r, expenses)
      return { k: st.k !== 'rec' && confs[String(r.id)]?.estado === 'confirmo' ? 'cnf' : st.k, tab: st.k === 'rec' ? 'rec' : 'esp', id: 'r' + r.id, r, st, client_id: r.client_id, monto: r.monto, asunto: r.asunto, fecha: String(r.enviada_at || '').slice(0, 10), por: r.enviada_por || '' }
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
      if (it.mid && res.data?.id) { try { await setLearningKV(MSG, res.data.id, it.mid); setMsgs(a => ({ ...a, [String(res.data.id)]: it.mid })) } catch (e) { registrarError({ origen: 'accion', vista: MSG, err: e }) } }
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
  const quitaPed = id => { setPed(p => { const n = (p || []).filter(x => x.id !== id); try { sessionStorage.setItem(cacheKey + '_ped', JSON.stringify({ t: Date.now(), items: n })) } catch (_) { /* sin almacenamiento */ } return n }) }
  const registrarPedido = async f => {
    const it = f.it, cid = f.client_id; if (!cid) return
    setBusy(f.id)
    try {
      const v = { estado: 'por_solicitar', client_id: String(cid), monto: it.monto, concepto: it.concepto, de: it.de, para: it.para, fecha: it.fecha }
      if (!DEMO) {
        await setLearningKV(PEDIDO, it.id, JSON.stringify(v))
        logActividad('fondos.pedido_registrado', { tabla: 'clients', id: cid, detalle: { cliente: nombre(cid), title: 'Pedido interno de fondos', monto: it.monto } })
      }
      setPedReg(p => [...(p || []), { id: it.id, ...v }]); quitaPed(it.id)
    } catch (e) { registrarError({ origen: 'accion', vista: PEDIDO, err: e }) } finally { setBusy(null) }
  }
  const descartarPedido = async f => {
    setBusy(f.id)
    try {
      if (!DEMO) {
        await setLearningKV(PEDIDO, f.it.id, JSON.stringify({ estado: 'descartado' }))
        logActividad('fondos.pedido_descartado', { tabla: 'clients', id: f.client_id || null, detalle: { cliente: f.client_id ? nombre(f.client_id) : f.it.cliente, title: 'Pedido interno descartado', monto: f.it.monto } })
      }
    } catch (e) { registrarError({ origen: 'accion', vista: PEDIDO, err: e }) }
    quitaPed(f.it.id); setBusy(null)
  }
  const decidir = async (f, estado) => {
    const r = f.r, c = sug[String(r.id)]; if (!c) return
    setBusy(f.id)
    try {
      const v = { estado, fecha: c.fecha, texto: c.texto, msg: c.msg }
      if (!DEMO) {
        await setLearningKV(CONF, r.id, JSON.stringify(v))
        if (estado === 'confirmo') logActividad('fondos.cliente_confirmo', { tabla: 'fund_requests', id: r.id, detalle: { cliente: nombre(r.client_id), title: 'El cliente confirmó el pago', monto: r.monto } })
      }
      setConfs(a => ({ ...a, [String(r.id)]: v })); setSug(a => { const n = { ...a }; delete n[String(r.id)]; return n })
    } catch (e) { registrarError({ origen: 'accion', vista: CONF, err: e }) } finally { setBusy(null) }
  }
  const historia = f => {
    const frmPaso = fr => fr ? { ok: true, t: 'Formulario preparado', d: fmtFechaDMY(fr.fecha), q: quienEs(fr.por) } : { ok: false, t: 'Formulario aún sin preparar' }
    if (f.k === 'ped') return [{ ok: true, t: 'Pedido interno', d: fmtFechaDMY(f.fecha), q: f.ruta }, { ok: false, t: 'Aún no registrado en la app' }]
    if (f.k === 'por' || f.k === 'frm') return [{ ok: true, t: 'Pedido interno', d: fmtFechaDMY(f.fecha), q: f.ruta }, frmPaso(f.it.formulario), { ok: false, t: 'Aún sin solicitud al cliente' }]
    const pd = pedidoDeSolicitud(pedReg, { client_id: f.client_id, monto: f.monto, fecha: f.fecha })
    const pasos = pd ? [{ ok: true, t: 'Pedido interno', d: fmtFechaDMY(pd.fecha), q: ruta(pd) }, ...(pd.formulario ? [frmPaso(pd.formulario)] : [])] : []
    pasos.push({ ok: true, t: 'Solicitud enviada', d: fmtFechaDMY(f.fecha), q: f.por })
    const cf = f.r && confs[String(f.r.id)]
    if (cf?.estado === 'confirmo') pasos.push({ ok: true, t: 'Cliente confirmó', d: fmtFechaDMY(cf.fecha), q: cf.texto ? `«${cf.texto}»` : '' })
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
        const pl = PILL[f.k], abre = abierta === f.id, sinCli = f.k === 'ped' && !f.client_id
        return (
          <div key={f.id} style={{ borderTop: i ? `1px solid ${C.border}` : 'none' }}>
            <div onClick={() => setAbierta(abre ? null : f.id)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', padding: '8px 0', cursor: 'pointer' }}>
              <div style={{ minWidth: 0, flex: '1 1 110px' }}>
                <div onClick={onOpenClientFicha && f.client_id ? e => { e.stopPropagation(); onOpenClientFicha(f.client_id) } : undefined} style={{ fontSize: 13, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: onOpenClientFicha && f.client_id ? 'pointer' : 'default' }}>{sinCli ? f.it.cliente : nombre(f.client_id)}</div>
                <div style={{ fontSize: 11, color: C.textSoft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fmtFechaDMY(f.fecha)}{f.ruta ? ` · ${f.ruta}` : f.por ? ` · ${f.por}` : ''}{f.asunto ? ` · ${f.asunto}` : ''}</div>
              </div>
              <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 6, padding: '2px 7px', background: pl.bg, color: pl.c, whiteSpace: 'nowrap' }}>{pl.t}</span>
              <span style={{ fontWeight: 700, color: C.accent, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmt(f.monto)}</span>
              {f.k === 'ped' && <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
                {sinCli && <select value='' onChange={e => e.target.value && setEleg(p => ({ ...p, [f.it.id]: e.target.value }))} style={{ fontSize: 11, border: `1px solid ${C.border}`, borderRadius: 6, padding: '2px 6px', background: C.card, color: C.accent, maxWidth: 170 }}>
                  <option value=''>¿Qué cliente?</option>
                  {(clients || []).filter(c => !c.is_internal && c.status !== 'Terminado').sort((a, b) => String(a.name).localeCompare(String(b.name))).map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                </select>}
                {!sinCli && <button type='button' disabled={busy === f.id} onClick={() => registrarPedido(f)} style={chipBtn('primary')}>Registrar pedido</button>}
                <button type='button' disabled={busy === f.id} onClick={() => descartarPedido(f)} style={chipBtn()}>No es pedido</button>
              </div>}
              {f.k === 'det' && <div style={{ display: 'flex', gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                <button type='button' disabled={busy === f.id} onClick={() => registrar(f.it)} style={chipBtn('primary')}>Registrar</button>
                <button type='button' disabled={busy === f.id} onClick={() => descartar(f.it)} style={chipBtn()}>No es solicitud</button>
              </div>}
            </div>
            {f.r && sug[String(f.r.id)] && f.k !== 'rec' && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', background: C.bgSoft, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 10px', margin: '0 0 8px 8px', fontSize: 11.5 }}>
              <span style={{ minWidth: 0, flex: '1 1 160px', color: C.text }}><b>El cliente respondió:</b> «{sug[String(f.r.id)].texto}» · {fmtFechaDMY(sug[String(f.r.id)].fecha)}</span>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button type='button' disabled={busy === f.id} onClick={() => decidir(f, 'confirmo')} style={chipBtn('primary')}>Confirmó</button>
                <button type='button' disabled={busy === f.id} onClick={() => decidir(f, 'no')} style={chipBtn()}>No</button>
              </div>
            </div>}
            {abre && <div style={{ display: 'grid', gap: 3, padding: '0 0 8px 8px' }}>
              {historia(f).map((p, j) => <div key={j} style={{ fontSize: 11.5, color: p.ok ? C.text : C.textSoft }}>{p.t}{p.d ? ` · ${p.d}` : ''}{p.q ? ` · ${p.q}` : ''}</div>)}
            </div>}
          </div>
        )
      })}
    </div>
  )
}
