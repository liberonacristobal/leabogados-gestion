import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from '../supabase'
import { BRAND, C, Gl, SEC_LBL, Spin, appAlert, diaGrande, fmt, fmtN, fmtRutCL, fmtFechaDMY, isoLocal, useIsDesktop } from '../lib/base.jsx'
import { ActBtn, Buscador, CUENTA_GASTOS_DEFAULT, Modal, chipBtn, depositoDeSolicitud, enviarComoUsuario, equipoPorNombre, esCorreoOficina, esPersona, estadoSolicitud, facturaCorreoShell, logActividad, registrarError, setLearningKV, txtEnviado } from '../lib/compartido.jsx'
import { entregarArchivo } from '../lib/archivos.js'

// Solicitar fondos al cliente: el FONDO INICIAL de un cliente nuevo (lo que se pide a un cliente antiguo va dentro de la rendición y se ve en Rendiciones).
// Dos pestañas: «Por solicitar» (clientes nuevos, desde la tarea «Solicitar fondos al cliente») e «Historial» (desde la app o registradas con «Ya la pedí»),
// y «+ Nueva solicitud» para cualquier cliente. El correo es auto-redactado: PARA = contactos del cliente, CC = abogado responsable (y la casilla de la oficina),
// con los correos ingresados APRENDIDOS (factura_to/cc + contacts) para todo correo futuro al cliente. El correo enviado queda guardado (fund_requests.correo).
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const MEDIOS = ['Correo', 'WhatsApp', 'Teléfono', 'Reunión', 'Otro']
const RE_TAREA = /^solicitar fondos al cliente/i
const hoyISO = () => isoLocal(Date.now())
const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function SolicitarFondosModal({ client: clientProp, clients = [], sale, montoInicial, responsable, user, expenses = [], tasks = [], sales = [], setTasks = null, onClose, asPage = false }) {
  const EMAIL_BY_NAME = equipoPorNombre()
  const isDesktop = useIsDesktop()
  const [tab, setTab] = useState(clientProp ? 'nueva' : 'porsol')   // 'porsol' | 'historial' | 'nueva'
  const [client, setClient] = useState(clientProp || null)
  const [ventaSel, setVentaSel] = useState(sale || null)
  const [cq, setCq] = useState('')
  const resp = responsable || client?.abogado_responsable || null
  const respEmail = resp ? EMAIL_BY_NAME[resp] : null
  const proyecto = ventaSel?.title || ''
  const [para, setPara] = useState(clientProp?.email || '')
  const [cc, setCc] = useState([respEmail, BRAND.casillaAgente].filter(Boolean)); const [ccInput, setCcInput] = useState('')
  const [contacts, setContacts] = useState([])
  const [monto, setMonto] = useState(montoInicial ? String(montoInicial) : '')
  const [asunto, setAsunto] = useState(`Solicitud de provisión de fondos${proyecto ? ` — ${proyecto}` : ''}`)
  const [saludo, setSaludo] = useState(esPersona(clientProp?.name) ? `Estimado/a ${(clientProp?.name || '').trim().split(/\s+/)[0]},` : 'Estimados,')
  const [cta, setCta] = useState(CUENTA_GASTOS_DEFAULT)
  const [msg, setMsg] = useState('')
  const [sending, setSending] = useState(false)
  const [desde, setDesde] = useState('usuario')   // de quién sale: tu cuenta o la de la oficina
  const [mas, setMas] = useState(false)           // «Más opciones»: copia, asunto, saludo, cuenta, adjuntos, de quién sale
  const [enviada, setEnviada] = useState(null)    // confirmación en la misma página
  const bodyTocado = useRef(false)
  const [extras, setExtras] = useState([])
  const [prevOpen, setPrevOpen] = useState(false)
  const MAX_ADJ = 18 * 1024 * 1024
  const fmtBytes = n => n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1024 / 1024).toFixed(1) + ' MB'
  const onExtras = fileList => { const files = Array.from(fileList || []); files.forEach(f => { const r = new FileReader(); r.onload = () => { const b = String(r.result || '').split(',')[1] || ''; setExtras(p => { if (p.some(x => x.name === f.name && x.size === f.size)) return p; if (p.reduce((a, x) => a + x.size, 0) + f.size > MAX_ADJ) { appAlert('Los adjuntos no pueden superar 18 MB en total.'); return p } return [...p, { name: f.name, size: f.size, mime: f.type || 'application/octet-stream', base64: b }] }) }; r.readAsDataURL(f) }) }
  const removeExtra = (name, size) => setExtras(p => p.filter(x => !(x.name === name && x.size === size)))

  // Solicitudes (fund_requests): historial y cruce con el depósito.
  const [reqs, setReqs] = useState(null)
  const cargarReqs = () => { supabase.from('fund_requests').select('*').order('enviada_at', { ascending: false }).limit(300).then(({ data }) => setReqs(data || []), () => setReqs([])) }
  useEffect(() => { cargarReqs() }, [])   // eslint-disable-line
  const cnReq = id => clients.find(c => String(c.id) === String(id))?.name || 'Cliente'
  const reqEstado = r => { const st = estadoSolicitud(r, expenses); return st.k === 'rec' && !st.dep ? { ...st, dep: depositoDeSolicitud(r, expenses) } : st }
  const persona = esPersona(client?.name)
  const genMsg = () => `Espero que ${persona ? 'estés' : 'estén'} muy bien. ${proyecto ? `En el marco del encargo ${proyecto}, solicitamos` : 'Solicitamos'} la provisión de un fondo por rendir${monto ? ` por ${fmtN(+monto || 0)}` : ''}, destinado a gastos notariales, inscripciones y otros trámites asociados, el cual será debidamente rendido.\n\nPuede transferir a la cuenta que se indica a continuación. Quedamos atentos a su confirmación.`
  useEffect(() => { if (!bodyTocado.current) setMsg(genMsg()) }, [monto, proyecto, client?.id])   // eslint-disable-line
  useEffect(() => { if (!bodyTocado.current || true) setAsunto(`Solicitud de provisión de fondos${proyecto ? ` — ${proyecto}` : ''}`) }, [proyecto])
  useEffect(() => {
    if (!client?.id) return; let alive = true
    supabase.from('contacts').select('nombre,email,principal').eq('client_id', client.id).then(({ data }) => { if (alive) setContacts((data || []).filter(c => c.email)) }, () => {})
    supabase.from('learnings').select('value').eq('kind', 'factura_to').eq('key', String(client.id)).maybeSingle().then(({ data }) => { if (alive && data?.value && !client?.email) setPara(String(data.value).trim()) }, () => {})
    supabase.from('learnings').select('value').eq('kind', 'factura_cc').eq('key', String(client.id)).maybeSingle().then(({ data }) => { if (alive && data?.value) { const ems = String(data.value).split(/[,;]/).map(s => s.trim().toLowerCase()).filter(Boolean); setCc(p => [...new Set([...p, ...ems])]) } }, () => {})
    supabase.from('learnings').select('value').eq('kind', 'cuenta_gastos').eq('key', 'estudio').order('updated_at', { ascending: false }).limit(1).maybeSingle().then(({ data }) => { if (alive && data?.value) { try { setCta(p => ({ ...p, ...JSON.parse(data.value) })) } catch (_) { /* cuenta guardada ilegible: queda la de siempre */ } } }, () => {})
    return () => { alive = false }
  }, [client?.id])   // eslint-disable-line
  const addCc = em => { const e = String(em || '').trim().toLowerCase(); if (e && e.includes('@') && !cc.includes(e) && e !== (para || '').toLowerCase()) setCc(p => [...p, e]); setCcInput('') }
  const removeCc = em => setCc(p => p.filter(x => x !== em))
  const pickClient = (c, venta = null) => {
    setClient(c); setCq(''); setPara(c?.email || ''); setSaludo(esPersona(c?.name) ? `Estimado/a ${(c?.name || '').trim().split(/\s+/)[0]},` : 'Estimados,')
    const re = c?.abogado_responsable ? EMAIL_BY_NAME[c.abogado_responsable] : null; if (re) setCc(p => [...new Set([...p, re])])
    const ventas = (sales || []).filter(s => String(s.client_id) === String(c?.id) && s.status === 'Activo')
    setVentaSel(venta || (ventas.length === 1 ? ventas[0] : null))
    // Monto sugerido: el de la tarea de fondos de su venta; si no hay, el último que se le pidió.
    if (!monto) { const ult = (reqs || []).find(r => String(r.client_id) === String(c?.id) && r.origen !== 'rendicion' && r.monto); if (ult) setMonto(String(ult.monto)) }
    setTab('nueva')
  }
  const buildHtml = () => {
    const ctaBox = `<div style="margin:14px 0;padding:12px 16px;background:#F7F9FA;border:1px solid #E4E8EB;border-radius:8px;font-size:13px;line-height:1.7"><div style="color:#537281;font-weight:600;margin-bottom:3px">Cuenta destinada a gastos</div><div>${esc(cta.razon)}</div><div><span style="color:#537281">RUT:</span> <b>${esc(cta.rut)}</b></div><div><span style="color:#537281">${esc(cta.banco)} · Cuenta corriente:</span> <b>${esc(cta.cuenta)}</b></div>${cta.email ? `<div><span style="color:#537281">Confirmación a:</span> ${esc(cta.email)}</div>` : ''}</div>`
    // Mismo cascarón que los correos de facturas (header navy con logo + pie de firma con logo/dirección/web), pero lo firma Administración.
    const inner = `${esc(saludo)}<br><br>${esc(msg).replace(/\n/g, '<br>')}${ctaBox}<div style="margin-top:16px">Saludos cordiales,</div>`
    return facturaCorreoShell(inner, { nombre: 'Administración', cargo: BRAND.nombre, telefono: '' }, 'es')
  }

  // La tarea «Solicitar fondos al cliente» queda hecha cuando la solicitud sale o se registra.
  const marcarTareasHechas = async (clientId, saleId, soloId = null) => {
    const ts = (tasks || []).filter(t => RE_TAREA.test(t.title || '') && t.status !== 'Terminado' && (soloId ? String(t.id) === String(soloId) : String(t.client_id) === String(clientId) && (!saleId || !t.sale_id || String(t.sale_id) === String(saleId))))
    if (!ts.length) return 0
    try { const { error } = await supabase.from('tasks').update({ status: 'Terminado' }).in('id', ts.map(t => t.id)); if (error) throw error; if (setTasks) setTasks(p => p.map(t => ts.some(x => x.id === t.id) ? { ...t, status: 'Terminado' } : t)); return ts.length } catch (e) { registrarError({ origen: 'accion', vista: 'solicitar_fondos_tarea', err: e }); return 0 }
  }

  const enviar = async () => {
    if (!client?.id) { appAlert('Elige el cliente.'); return }
    if (!para.trim()) { appAlert('Falta el destinatario.'); return }
    if (!(+monto > 0)) { appAlert('Falta el monto del fondo.'); return }
    if (sending) return
    setSending(true)
    try {
      const text = `${saludo}\n\n${msg}\n\nCuenta destinada a gastos: ${cta.banco} · ${cta.cuenta} · ${cta.razon} · ${fmtRutCL(cta.rut)}\n\n${BRAND.dominio}`
      const html = buildHtml()
      const adjuntos = extras.map(a => ({ base64: a.base64, name: a.name, mime: a.mime }))
      const via = await enviarComoUsuario({ to: para.trim(), cc: cc.join(','), subject: asunto, html, text, attachments: adjuntos, soloUsuario: true, que: 'La solicitud de fondos' }, desde === 'oficina' ? 'oficina' : undefined)
      if (via === 'reauth' || via === null) { setSending(false); return }   // el aviso «NO se envió» + reingreso lo da enviarComoUsuario
      try { await setLearningKV('factura_to', String(client.id), para.trim()) } catch (e) { registrarError({ origen: 'accion', vista: 'factura_to', err: e }) }
      if (cc.length) try { await setLearningKV('factura_cc', String(client.id), cc.join(',')) } catch (e) { registrarError({ origen: 'accion', vista: 'factura_cc', err: e }) }
      try { await supabase.from('learnings').delete().eq('kind', 'cuenta_gastos').eq('key', 'estudio'); await supabase.from('learnings').insert({ kind: 'cuenta_gastos', key: 'estudio', value: JSON.stringify(cta) }) } catch (e) { registrarError({ origen: 'accion', vista: 'learnings', err: e }) }
      try { const ya = new Set(contacts.map(c => (c.email || '').toLowerCase())); const nuevos = [...new Set([para.trim(), ...cc].map(e => String(e).trim().toLowerCase()).filter(e => e && e.includes('@') && !esCorreoOficina(e) && !ya.has(e)))]; if (nuevos.length) await supabase.from('contacts').insert(nuevos.map(e => ({ client_id: client.id, nombre: e.split('@')[0], email: e }))) } catch (e) { registrarError({ origen: 'accion', vista: 'contacts', err: e }) }
      // Registro permanente: la solicitud con su correo completo (se ve y se descarga desde el historial) y su cruce con el depósito.
      let guardada = false
      try {
        const { error: frErr } = await supabase.from('fund_requests').insert({ client_id: client.id, sale_id: ventaSel?.id || null, monto: +monto || 0, asunto, para: para.trim(), cc: cc.join(','), enviada_por: user?.name || null, n_adjuntos: extras.length, origen: 'inicial', correo: { asunto, para: para.trim(), cc: cc.join(','), html, texto: text, de: via === 'oficina' ? 'Oficina' : (user?.name || 'Tu cuenta'), enviado_at: new Date().toISOString(), adjuntos: extras.map(a => a.name) } })
        if (frErr) console.error('fund_requests', frErr.message); else { guardada = true; logActividad('fondos.solicitud_enviada', { tabla: 'clients', id: client.id, detalle: { cliente: client.name, title: 'Solicitud de fondos enviada', monto: +monto || 0 } }) }
      } catch (e) { registrarError({ origen: 'accion', vista: 'fund_requests', err: e }) }
      const tareas = await marcarTareasHechas(client.id, ventaSel?.id)
      cargarReqs()
      setEnviada({ tipo: 'enviada', via, cliente: client.name, para: para.trim(), cc: cc.join(', '), monto: +monto || 0, tareas, guardada })
    } catch (e) { appAlert('Error al enviar: ' + (e.message || e)) }
    setSending(false)
  }

  // «Ya la pedí»: la solicitud salió por otro medio (correo propio, WhatsApp, teléfono): se registra con su fecha y queda esperando el depósito.
  const [yp, setYp] = useState(null)   // { id, cliente, sale, monto, fecha, medio, tarea }
  const registrarPedida = async () => {
    if (!yp || sending) return
    if (!(+yp.monto > 0)) { appAlert('Falta el monto.'); return }
    setSending(true)
    try {
      const { error } = await supabase.from('fund_requests').insert({ client_id: yp.cliente.id, sale_id: yp.sale?.id || null, monto: +yp.monto, asunto: `Fondo inicial${yp.sale?.title ? ` — ${yp.sale.title}` : ''}`, enviada_por: user?.name || null, enviada_at: `${yp.fecha}T12:00:00Z`, origen: 'inicial', correo: { registrada: true, medio: yp.medio } })
      if (error) throw error
      logActividad('fondos.solicitud_registrada', { tabla: 'clients', id: yp.cliente.id, detalle: { cliente: yp.cliente.name, title: `Solicitud de fondos registrada: pedida por ${yp.medio} el ${fmtFechaDMY(yp.fecha)}`, monto: +yp.monto } })
      const tareas = await marcarTareasHechas(yp.cliente.id, yp.sale?.id, yp.tarea?.id)
      cargarReqs()
      setEnviada({ tipo: 'registrada', cliente: yp.cliente.name, fecha: yp.fecha, medio: yp.medio, monto: +yp.monto, tareas })
      setYp(null)
    } catch (e) { appAlert('No se pudo registrar: ' + (e.message || e)) }
    setSending(false)
  }

  // Por solicitar: clientes nuevos con la tarea «Solicitar fondos al cliente» sin hacer. El monto sale de las tareas de la misma venta («… por rendir de $400.000»).
  const [q, setQ] = useState('')
  const nq = q.trim().toLowerCase(), nd = q.replace(/\D/g, '')
  const coincide = (nombre, m) => !nq || nombre.toLowerCase().includes(nq) || (nd.length >= 3 && String(m || '').includes(nd))
  const porSolicitar = useMemo(() => {
    const ts = (tasks || []).filter(t => RE_TAREA.test(t.title || '') && t.status !== 'Terminado' && !t.archived && t.client_id)
    return ts.map(t => {
      let m = 0
      for (const x of (tasks || []).filter(x => x.sale_id && String(x.sale_id) === String(t.sale_id))) { const mm = /\$\s?(\d{1,3}(?:\.\d{3})+|\d{4,})/.exec(`${x.title || ''} ${x.note || ''}`); if (mm) { m = Number(mm[1].replace(/\./g, '')) || 0; if (m) break } }
      return { t, cli: clients.find(c => String(c.id) === String(t.client_id)) || null, sale: (sales || []).find(s => String(s.id) === String(t.sale_id)) || (sales || []).find(s => String(s.client_id) === String(t.client_id) && s.status === 'Activo' && t.project && s.title === t.project) || null, monto: m }
    }).filter(x => x.cli && !(reqs || []).some(r => r.origen === 'inicial' && String(r.client_id) === String(x.cli.id) && String(r.enviada_at || '').slice(0, 10) >= String(x.t.created_at || '').slice(0, 10)))
      .filter(x => coincide(x.cli.name, x.monto))
  }, [tasks, clients, sales, reqs, q])   // eslint-disable-line

  // Historial: solo fondos iniciales (lo de las rendiciones se ve en Rendiciones). Ordenar y agrupar.
  const [orden, setOrden] = useState('fecha'), [agrupa, setAgrupa] = useState('nada'), [filtro, setFiltro] = useState('todas'), [abierta, setAbierta] = useState(null), [plegados, setPlegados] = useState(() => new Set())
  const histBase = (reqs || []).filter(r => r.origen !== 'rendicion')
  const lista = useMemo(() => {
    const xs = histBase.filter(r => { const k = reqEstado(r).k; return (filtro === 'todas' || (filtro === 'rec' ? k === 'rec' : k !== 'rec')) && coincide(cnReq(r.client_id), r.monto) })
    const key = { fecha: r => String(r.enviada_at || ''), monto: r => r.monto || 0, cliente: r => cnReq(r.client_id).toLowerCase(), estado: r => reqEstado(r).k }[orden]
    return xs.slice().sort((a, b) => { const x = key(a), y = key(b); const c = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'es'); return orden === 'fecha' || orden === 'monto' ? -c : c })
  }, [reqs, q, filtro, orden, expenses])   // eslint-disable-line
  const grupos = useMemo(() => {
    if (agrupa === 'nada') return null
    const m = new Map()
    lista.forEach(r => { const k = agrupa === 'cliente' ? cnReq(r.client_id) : (r.enviada_at ? `${MESES[new Date(r.enviada_at).getMonth()]} ${new Date(r.enviada_at).getFullYear()}` : 'Sin fecha'); if (!m.has(k)) m.set(k, []); m.get(k).push(r) })
    return [...m.entries()]
  }, [lista, agrupa])   // eslint-disable-line
  const nSin = histBase.filter(r => reqEstado(r).k === 'sin').length

  const htmlDe = r => r.correo?.html || `<div style="font-family:Arial,sans-serif;max-width:640px;margin:24px auto;color:#3D3D3D"><h3 style="color:#003C50">${esc(r.asunto || 'Solicitud de fondos')}</h3><p>${r.correo?.registrada ? `Registrada como pedida por ${esc(r.correo.medio || 'otro medio')} el ${esc(fmtFechaDMY(isoLocal(r.enviada_at)))}.` : `Enviada el ${esc(fmtFechaDMY(isoLocal(r.enviada_at)))} por ${esc(r.enviada_por || '')}.`}</p>${r.para ? `<p>Para: ${esc(r.para)}</p>` : ''}${r.cc ? `<p>Con copia: ${esc(r.cc)}</p>` : ''}<p>Monto: ${esc(fmt(r.monto))}</p><p style="color:#537281;font-size:12px">El texto completo de este correo no se guardó (solicitud anterior).</p></div>`
  const verCorreo = r => { const w = window.open('', '_blank'); if (!w) { appAlert('El navegador bloqueó la ventana. Permite ventanas emergentes para esta página.'); return } w.document.write(htmlDe(r)); w.document.close() }
  const descargarCorreo = async r => { try { await entregarArchivo(new Blob([htmlDe(r)], { type: 'text/html' }), `Solicitud de fondos ${cnReq(r.client_id)} ${isoLocal(r.enviada_at)}.html`.replace(/[^\w .-]/g, '')) } catch (e) { appAlert('No se pudo descargar: ' + (e.message || e)) } }
  const volverAPedir = r => { const c = clients.find(x => String(x.id) === String(r.client_id)); if (c) { setMonto(r.monto ? String(r.monto) : ''); pickClient(c) } }

  // ── Presentación ──
  const fInp = { width: '100%', padding: '9px 11px', borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, boxSizing: 'border-box' }
  const lbl = { fontSize: 10, color: C.muted, fontWeight: 600, marginBottom: 3 }
  const dz = { display: 'block', border: `1.5px dashed ${C.border}`, borderRadius: 10, padding: '10px', textAlign: 'center', cursor: 'pointer' }
  const tabBtn = on => ({ fontSize: 13, fontWeight: 700, color: on ? C.accent : C.muted, background: 'none', border: 'none', borderBottom: `2px solid ${on ? C.accent : 'transparent'}`, padding: '7px 4px', marginBottom: -1, cursor: 'pointer' })
  const montoCol = { fontSize: 14, fontWeight: 800, color: C.accent, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', minWidth: 84, textAlign: 'right', flexShrink: 0 }
  const pill = (txt, k) => <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 20, padding: '2px 8px', whiteSpace: 'nowrap', flexShrink: 0, color: k === 'rec' ? C.greenText : k === 'sin' ? C.overdueText : C.soonText, background: k === 'rec' ? C.greenBg : k === 'sin' ? C.overdueBg : C.soonBg }}>{txt}</span>
  const txtEstado = (r, est) => est.k === 'rec' ? `Fondo recibido ${fmtFechaDMY(est.dep?.date || isoLocal(r.recibido_at))}` : est.k === 'sin' ? `Sin depósito, ${est.dias ?? 0} días` : (r.correo?.registrada ? 'Pedida' : 'Enviada')
  const sel = (v, set, opts) => <select value={v} onChange={e => set(e.target.value)} style={{ fontSize: 11.5, fontWeight: 600, color: C.accent, border: `1px solid ${C.border}`, background: '#fff', borderRadius: 8, padding: '4px 7px', cursor: 'pointer' }}>{opts.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>

  const filaSol = ({ t, cli, sale: vn, monto: m }) => (
    <div key={t.id} style={{ borderTop: `1px solid ${C.border}`, padding: '10px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 160px', minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{cli.name} <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 20, padding: '2px 8px', background: C.azulBg, color: C.accent }}>Fondo inicial</span></div>
          <div style={{ fontSize: 11, color: C.muted }}>{[vn?.title || t.project, t.created_at ? `tarea del ${fmtFechaDMY(isoLocal(t.created_at))}` : '', t.who].filter(Boolean).join(', ')}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button type='button' onClick={() => { setMonto(m ? String(m) : ''); pickClient(cli, vn) }} style={chipBtn('primary')}>Redactar correo</button>
          <button type='button' onClick={() => setYp({ id: t.id, cliente: cli, sale: vn, monto: m ? String(m) : '', fecha: hoyISO(), medio: 'Correo', tarea: t })} style={chipBtn()}>Ya la pedí</button>
        </div>
        <span style={montoCol}>{m ? fmt(m) : '—'}</span>
      </div>
      {yp && yp.id === t.id && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', background: C.bgSoft, border: `1px solid ${C.border}`, borderRadius: 10, padding: '9px 11px', marginTop: 8 }}>
        <div><div style={lbl}>CUÁNDO</div><input type='date' value={yp.fecha} onChange={e => setYp(p => ({ ...p, fecha: e.target.value }))} style={{ ...fInp, width: 'auto' }} /></div>
        <div><div style={lbl}>MEDIO</div><select value={yp.medio} onChange={e => setYp(p => ({ ...p, medio: e.target.value }))} style={{ ...fInp, width: 'auto' }}>{MEDIOS.map(x => <option key={x}>{x}</option>)}</select></div>
        <div><div style={lbl}>MONTO</div><input value={yp.monto} onChange={e => setYp(p => ({ ...p, monto: e.target.value.replace(/[^\d]/g, '') }))} style={{ ...fInp, width: 110, textAlign: 'right' }} /></div>
        <ActBtn variant='primary' onClick={registrarPedida} disabled={sending}>Registrar</ActBtn>
        <ActBtn onClick={() => setYp(null)}>Cancelar</ActBtn>
      </div>}
    </div>)

  const filaHist = (r, conCliente) => {
    const est = reqEstado(r), abre = abierta === r.id, conCorreo = !r.correo?.registrada
    return (
      <div key={r.id} style={{ borderTop: `0.5px solid ${C.border}` }}>
        <div onClick={() => setAbierta(abre ? null : r.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', flexWrap: 'wrap', cursor: 'pointer' }}>
          {diaGrande(isoLocal(r.enviada_at))}
          <div style={{ flex: '1 1 160px', minWidth: 0 }}>
            {conCliente && <div style={{ fontSize: 13, fontWeight: 700, color: C.accent }}>{cnReq(r.client_id)}</div>}
            <div style={{ fontSize: 12.5, fontWeight: 600, color: C.text, lineHeight: 1.25 }}>{r.asunto || 'Solicitud de fondos'}</div>
            <div style={{ fontSize: 11, color: C.muted }}>{[r.enviada_por, r.correo?.registrada ? `registrada, ${r.correo.medio}` : 'desde la app', r.para].filter(Boolean).join(', ')}</div>
          </div>
          {pill(txtEstado(r, est), est.k)}
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
            {conCorreo && <button type='button' onClick={() => verCorreo(r)} style={chipBtn()}>Ver correo</button>}
            {conCorreo && <button type='button' onClick={() => descargarCorreo(r)} style={chipBtn()}>Descargar</button>}
            {est.k !== 'rec' && <button type='button' onClick={() => volverAPedir(r)} style={{ ...chipBtn(), background: '#fff', color: C.accent, border: `1px solid ${C.accent}` }}>Volver a pedir</button>}
          </div>
          <span style={montoCol}>{fmt(r.monto)}</span>
        </div>
        {abre && <div style={{ padding: '0 12px 9px 64px', display: 'grid', gap: 3, fontSize: 11.5, color: C.text }}>
          <div>{r.correo?.registrada ? `Registrada el ${fmtFechaDMY(isoLocal(r.enviada_at))} por ${r.enviada_por || '—'}, pedida por ${r.correo.medio}` : `Enviada el ${fmtFechaDMY(isoLocal(r.enviada_at))} por ${r.enviada_por || '—'}${r.correo?.de ? `, desde ${r.correo.de}` : ''}`}</div>
          {r.para && <div>Para: {r.para}{r.cc ? `. Con copia: ${r.cc}` : ''}</div>}
          <div style={{ color: est.k === 'rec' ? C.greenText : C.muted }}>{est.k === 'rec' ? `Depósito recibido el ${fmtFechaDMY(est.dep?.date || isoLocal(r.recibido_at))}` : `Sin depósito, ${est.dias ?? 0} días`}</div>
        </div>}
      </div>)
  }

  const bloqueLista = (() => {
    if (reqs === null) return <div style={{ textAlign: 'center', padding: 30, color: C.muted, fontSize: 13 }}><Spin /> Cargando…</div>
    const cab = <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
      <span style={{ fontSize: 11, color: C.muted }}>Ordenar por</span>{sel(orden, setOrden, [['fecha', 'Fecha'], ['cliente', 'Cliente'], ['monto', 'Monto'], ['estado', 'Estado']])}
      <span style={{ fontSize: 11, color: C.muted }}>Agrupar por</span>{sel(agrupa, setAgrupa, [['nada', 'Nada'], ['cliente', 'Cliente'], ['mes', 'Mes']])}
      <span style={{ flex: 1 }} />
      {[['todas', 'Todas'], ['sin', 'Sin depósito'], ['rec', 'Recibidas']].map(([k, t]) => <button key={k} type='button' onClick={() => setFiltro(k)} style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '3px 10px', cursor: 'pointer', border: `1px solid ${filtro === k ? C.accent : C.border}`, background: filtro === k ? C.accent : C.bgSoft, color: filtro === k ? '#fff' : C.muted, fontFamily: 'inherit' }}>{t}</button>)}
    </div>
    if (!histBase.length) return <div style={{ textAlign: 'center', padding: 30, color: C.muted, fontSize: 13, background: C.bgSoft, borderRadius: 12 }}>Aún no hay solicitudes de fondos iniciales.</div>
    const resumen = <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>{histBase.length} solicitud{histBase.length !== 1 ? 'es' : ''}, {histBase.filter(r => reqEstado(r).k === 'rec').length} con fondo recibido{nSin > 0 && <>, <b style={{ color: C.overdueText }}>{nSin} sin depósito +7 días</b></>}</div>
    const caja = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }
    if (!lista.length) return <div>{resumen}{cab}<div style={{ textAlign: 'center', padding: 24, fontSize: 13, color: C.muted }}>Sin solicitudes con ese filtro.</div></div>
    if (!grupos) return <div>{resumen}{cab}<div style={caja}>{lista.map(r => filaHist(r, true))}</div></div>
    return <div>{resumen}{cab}<div style={caja}>{grupos.map(([k, rs]) => { const cerr = plegados.has(k), tot = rs.reduce((a, r) => a + (r.monto || 0), 0)
      return <div key={k}>
        <div onClick={() => setPlegados(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n })} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, padding: '11px 12px 4px', borderTop: `1px solid ${C.border}`, cursor: 'pointer' }}>
          <span style={{ minWidth: 0 }}><span style={{ color: C.muted, fontSize: 11, marginRight: 6 }}>{cerr ? '▸' : '▾'}</span><b style={{ fontSize: 14, color: agrupa === 'mes' ? C.muted : C.accent, textTransform: agrupa === 'mes' ? 'capitalize' : 'none' }}>{k}</b> <span style={{ fontSize: 11, color: C.muted }}>{rs.length} solicitud{rs.length !== 1 ? 'es' : ''}</span></span>
          <span style={{ ...montoCol, fontSize: 13 }}>{fmt(tot)}</span>
        </div>
        {!cerr && rs.map(r => filaHist(r, agrupa !== 'cliente'))}
      </div> })}</div></div>
  })()

  const bloqueForm = (() => {
    if (!client) return (
      <div><div style={lbl}>ELIGE EL CLIENTE</div>
        <Buscador value={cq} onChange={setCq} placeholder='Buscar cliente por nombre, RUT o razón social…' autoFocus />
        {cq.trim() && <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, marginTop: 6, overflow: 'hidden', maxHeight: 260, overflowY: 'auto', background: '#fff' }}>{(clients || []).filter(c => !c.is_internal && (`${c.name || ''} ${c.rut || ''}`).toLowerCase().includes(cq.trim().toLowerCase())).slice(0, 12).map(c => <div key={c.id} onClick={() => pickClient(c)} style={{ padding: '9px 12px', fontSize: 13, color: C.text, cursor: 'pointer', borderTop: `1px solid ${C.border}` }}>{c.name}</div>)}</div>}
      </div>)
    const ventas = (sales || []).filter(s => String(s.client_id) === String(client.id) && s.status === 'Activo')
    const formEl = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
        <div><div style={lbl}>CLIENTE</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 700, background: C.azulBg, color: C.accent, borderRadius: 20, padding: '3px 6px 3px 11px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>{client.name}{proyecto ? `, ${proyecto}` : ''}<button type='button' onClick={() => { setClient(null); setVentaSel(null); setPara('') }} title='Cambiar cliente' style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted, fontWeight: 700, padding: '0 4px' }}><Gl n='x' /></button></span>
            {ventas.length > 1 && <select value={ventaSel?.id || ''} onChange={e => setVentaSel(ventas.find(v => String(v.id) === e.target.value) || null)} style={{ ...fInp, width: 'auto', padding: '4px 8px', fontSize: 12 }}><option value=''>Sin trabajo</option>{ventas.map(v => <option key={v.id} value={v.id}>{v.title}</option>)}</select>}
          </div></div>
        <div><div style={lbl}>MONTO DEL FONDO</div><span style={{ display: 'flex', alignItems: 'center', border: `1px solid ${C.border}`, borderRadius: 8, background: '#fff' }}><span style={{ fontSize: 13, color: C.muted, padding: '0 2px 0 10px' }}>$</span><input value={monto ? Number(monto).toLocaleString('es-CL') : ''} onChange={e => setMonto(e.target.value.replace(/[^\d]/g, ''))} placeholder='0' style={{ flex: 1, border: 'none', outline: 'none', padding: '9px 10px', fontSize: 14, fontWeight: 700, textAlign: 'right', background: 'none', fontVariantNumeric: 'tabular-nums' }} /></span></div>
        <div><div style={lbl}>PARA</div><input value={para} onChange={e => setPara(e.target.value)} placeholder='correo@cliente.cl' style={fInp} />
          {contacts.length > 0 && <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 5 }}>{contacts.map(c => { const isTo = (c.email || '').toLowerCase() === (para || '').toLowerCase(); return <button key={c.email} type='button' title={c.email} onClick={() => { if (isTo) return; if (!para.trim()) setPara(c.email); else addCc(c.email) }} style={{ fontSize: 10, border: `0.5px solid ${isTo ? C.accent : C.border}`, background: isTo ? C.azulBg : '#fff', color: isTo ? C.accent : C.muted, borderRadius: 20, padding: '2px 9px', cursor: 'pointer' }}>{c.nombre || c.email}</button> })}</div>}
        </div>
        <div><div style={lbl}>MENSAJE</div><textarea value={msg} onChange={e => { bodyTocado.current = true; setMsg(e.target.value) }} rows={7} style={{ ...fInp, minHeight: isDesktop ? 150 : 130, lineHeight: 1.6, resize: 'vertical', fontFamily: 'inherit' }} /></div>
        <button type='button' onClick={() => setMas(v => !v)} style={{ fontSize: 12, fontWeight: 700, color: C.azulInfo, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}>{mas ? 'Ocultar más opciones' : 'Más opciones'} <span style={{ fontWeight: 400, color: C.muted }}>{mas ? '' : 'de quién sale, copia, asunto, cuenta y adjuntos'}</span></button>
        {mas && <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          <div><div style={lbl}>ENVIAR DESDE</div>{sel(desde, setDesde, [['usuario', `Tu cuenta${user?.email ? ` (${user.email})` : ''}`], ['oficina', `Cuenta de la oficina${BRAND.casillaAgente ? ` (${BRAND.casillaAgente})` : ''}`]])}</div>
          <div><div style={lbl}>CON COPIA {resp && <span style={{ fontWeight: 400, textTransform: 'none', color: C.textSoft }}>abogado responsable ({resp})</span>}</div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>{cc.map(e => <span key={e} style={{ fontSize: 10, background: C.greenBg, color: C.greenText, borderRadius: 20, padding: '2px 4px 2px 9px', display: 'inline-flex', alignItems: 'center' }}>{e}<button type='button' onClick={() => removeCc(e)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted, fontWeight: 700, padding: '0 4px' }}><Gl n='x' /></button></span>)}
              <input value={ccInput} onChange={e => setCcInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addCc(ccInput) } }} onBlur={() => addCc(ccInput)} placeholder='+ correo' style={{ flex: 1, minWidth: 90, padding: '6px 8px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }} /></div></div>
          <div><div style={lbl}>ASUNTO</div><input value={asunto} onChange={e => setAsunto(e.target.value)} style={fInp} /></div>
          <div><div style={lbl}>SALUDO</div><input value={saludo} onChange={e => setSaludo(e.target.value)} style={fInp} /></div>
          <div style={{ background: C.soonBg, border: '1px solid #F0E4B8', borderRadius: 10, padding: '9px 11px' }}>
            <div style={{ fontSize: 10, color: C.soonText, fontWeight: 700, marginBottom: 6 }}>Cuenta destinada a gastos (se recuerda)</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}><input value={cta.banco} onChange={e => setCta(p => ({ ...p, banco: e.target.value }))} placeholder='Banco' style={{ ...fInp, padding: '6px 8px', fontSize: 12, flex: 1 }} /><input value={cta.cuenta} onChange={e => setCta(p => ({ ...p, cuenta: e.target.value }))} placeholder='N° cuenta' style={{ ...fInp, padding: '6px 8px', fontSize: 12, flex: 1 }} /></div>
            <div style={{ display: 'flex', gap: 6 }}><input value={cta.razon} onChange={e => setCta(p => ({ ...p, razon: e.target.value }))} placeholder='Razón social' style={{ ...fInp, padding: '6px 8px', fontSize: 12, flex: 2 }} /><input value={cta.rut} onChange={e => setCta(p => ({ ...p, rut: e.target.value }))} placeholder='RUT' style={{ ...fInp, padding: '6px 8px', fontSize: 12, flex: 1 }} /></div>
          </div>
          <div><div style={lbl}>ADJUNTOS <span style={{ fontWeight: 400, textTransform: 'none', color: C.textSoft }}>opcional (presupuesto, cotización)</span></div>
            <label style={dz}><input type='file' multiple onChange={e => { onExtras(e.target.files); e.target.value = '' }} style={{ display: 'none' }} /><span style={{ fontSize: 12, color: C.muted }}>Agregar archivos</span></label>
            {extras.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>{extras.map(a => <span key={a.name + a.size} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.accent, background: C.azulBg, borderRadius: 8, padding: '5px 9px' }}>{a.name}<span style={{ color: C.muted }}>{fmtBytes(a.size)}</span><button type='button' onClick={() => removeExtra(a.name, a.size)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted, fontWeight: 700, padding: 0 }}><Gl n='x' /></button></span>)}</div>}
          </div>
        </div>}
      </div>)
    const previewEl = (
      <div>
        <div style={{ ...SEC_LBL, marginBottom: 6 }}>Vista previa del correo</div>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 7, lineHeight: 1.5 }}><b style={{ color: C.text }}>Para:</b> {para || '—'}{cc.length ? <>. <b style={{ color: C.text }}>Con copia:</b> {cc.join(', ')}</> : ''}{extras.length ? <>. {extras.length} adjunto{extras.length !== 1 ? 's' : ''}</> : ''}</div>
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden', background: '#fff', maxHeight: isDesktop ? '60vh' : 420, overflowY: 'auto' }}><div style={{ padding: 12 }} dangerouslySetInnerHTML={{ __html: buildHtml() }} /></div>
      </div>)
    const ok = !!para.trim() && +monto > 0
    const sendBtn = <button disabled={sending || !ok} onClick={enviar} style={{ marginTop: 6, width: '100%', padding: 12, borderRadius: 10, border: 'none', background: !ok ? C.done : C.accent, color: '#fff', fontSize: 13, fontWeight: 700, cursor: !ok ? 'default' : 'pointer' }}>{sending ? 'Enviando…' : 'Enviar solicitud'}</button>
    const pedidaBtn = <ActBtn onClick={() => setYp({ id: '__form', cliente: client, sale: ventaSel, monto: monto, fecha: hoyISO(), medio: 'Correo', tarea: null })} style={{ marginTop: 6 }}>Ya la pedí por separado</ActBtn>
    const ypBox = yp && yp.id === '__form' && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', background: C.bgSoft, border: `1px solid ${C.border}`, borderRadius: 10, padding: '9px 11px', marginTop: 8 }}>
      <div><div style={lbl}>CUÁNDO</div><input type='date' value={yp.fecha} onChange={e => setYp(p => ({ ...p, fecha: e.target.value }))} style={{ ...fInp, width: 'auto' }} /></div>
      <div><div style={lbl}>MEDIO</div><select value={yp.medio} onChange={e => setYp(p => ({ ...p, medio: e.target.value }))} style={{ ...fInp, width: 'auto' }}>{MEDIOS.map(x => <option key={x}>{x}</option>)}</select></div>
      <ActBtn variant='primary' onClick={registrarPedida} disabled={sending}>Registrar</ActBtn><ActBtn onClick={() => setYp(null)}>Cancelar</ActBtn></div>
    return isDesktop
      ? <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 16, alignItems: 'start' }}><div>{formEl}{sendBtn}<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{pedidaBtn}<ActBtn onClick={() => setTab('porsol')} style={{ marginTop: 6 }}>Volver</ActBtn></div>{ypBox}</div><div>{previewEl}</div></div>
      : <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>{formEl}<div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 9 }}><button type='button' onClick={() => setPrevOpen(o => !o)} style={{ fontSize: 12, fontWeight: 700, color: C.azulInfo, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>{prevOpen ? 'Ocultar vista previa' : 'Ver cómo se verá el correo'}</button>{prevOpen && <div style={{ marginTop: 8 }}>{previewEl}</div>}</div>{sendBtn}<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{pedidaBtn}<ActBtn onClick={() => setTab('porsol')} style={{ marginTop: 6 }}>Volver</ActBtn></div>{ypBox}</div>
  })()

  const volverALista = () => { setEnviada(null); setClient(null); setVentaSel(null); setPara(''); setMonto(''); bodyTocado.current = false; setExtras([]); setTab('porsol') }
  const bloqueEnviada = enviada && (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', maxWidth: 620 }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: enviada.tipo === 'enviada' ? C.greenText : C.accent, marginBottom: 6 }}>{enviada.tipo === 'enviada' ? 'Solicitud enviada' : 'Registrada, pedida por otro medio'}</div>
      {[
        enviada.tipo === 'enviada' ? ['Correo', txtEnviado(enviada.via, { que: 'Solicitud de fondos', g: 'a', para: [enviada.para, enviada.cc].filter(Boolean).join(', ') })] : ['Cuándo y medio', `${fmtFechaDMY(enviada.fecha)}, ${enviada.medio}`],
        ['Cliente', enviada.cliente],
        ...(enviada.tareas > 0 ? [['Tarea', '«Solicitar fondos al cliente» marcada como hecha']] : []),
        ...(enviada.tipo === 'enviada' && !enviada.guardada ? [['Registro', 'El correo salió, pero la solicitud no quedó guardada en el historial. Avisa a soporte.']] : []),
        ['Estado', 'Pedida, esperando el depósito'],
      ].map(([k, v]) => <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderTop: `1px solid ${C.border}`, fontSize: 12.5 }}><span style={{ color: C.muted }}>{k}</span><span style={{ textAlign: 'right', color: C.text, whiteSpace: 'pre-line' }}>{v}</span></div>)}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderTop: `1px solid ${C.border}`, fontSize: 12.5 }}><span style={{ color: C.muted }}>Monto</span><span style={{ fontWeight: 800, color: C.accent, fontVariantNumeric: 'tabular-nums' }}>{fmt(enviada.monto)}</span></div>
      <div style={{ marginTop: 12 }}><ActBtn variant='primary' onClick={volverALista}>Volver a Solicitar fondos</ActBtn></div>
    </div>)

  const _body = (<>
    {enviada ? bloqueEnviada : <>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12, borderBottom: `1px solid ${C.border}` }}>
        <button onClick={() => setTab('porsol')} style={tabBtn(tab === 'porsol')}>Por solicitar{porSolicitar.length ? ` · ${porSolicitar.length}` : ''}</button>
        <button onClick={() => setTab('historial')} style={tabBtn(tab === 'historial')}>Historial{histBase.length ? ` · ${histBase.length}` : ''}</button>
        <span style={{ flex: 1 }} />
        {tab !== 'nueva' && <button type='button' onClick={() => { setClient(null); setVentaSel(null); setPara(''); setMonto(''); bodyTocado.current = false; setTab('nueva') }} style={{ ...chipBtn('primary'), marginBottom: 6 }}>+ Nueva solicitud</button>}
      </div>
      {tab === 'nueva' ? bloqueForm : <>
        <div style={{ marginBottom: 10 }}><Buscador value={q} onChange={setQ} placeholder='Buscar cliente o monto…' /></div>
        {tab === 'historial' ? bloqueLista
          : <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '10px 14px' }}>
            <div style={{ ...SEC_LBL, marginBottom: 2 }}>Clientes nuevos</div>
            {porSolicitar.length === 0
              ? <div style={{ fontSize: 12.5, color: C.muted, padding: '10px 0' }}>{q.trim() ? 'Sin clientes con ese filtro.' : 'No hay fondos por solicitar. Aparecen aquí cuando se activa una venta y se crean sus primeras tareas.'}</div>
              : porSolicitar.map(filaSol)}
            {porSolicitar.length > 0 && <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>El monto es el de la tarea de fondos de las primeras tareas. Se puede cambiar en el borrador.</div>}
          </div>}
      </>}
    </>}
  </>)
  const _page = _body
  return asPage ? _page : (<Modal fullscreen fsMaxWidth={(tab === 'historial' || (client && isDesktop)) ? 980 : 640} title={<><span style={{ color: C.accent }}>Solicitar fondos</span>{tab === 'nueva' && client?.name && <><span style={{ color: C.textSoft, fontWeight: 400, margin: '0 7px' }}>|</span><span style={{ color: C.muted }}>{client.name}</span></>}</>} onClose={onClose}>{_page}</Modal>)
}
