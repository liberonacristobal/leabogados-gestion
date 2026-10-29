// Movido de compartido.jsx por scripts/dividir-compartido.py. Sin cambios de comportamiento.
import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase, DEMO } from '../supabase'
import { fgCliente } from '../../supabase/functions/_shared/gastosReglas.js'
import { BRAND, C, Gl, SEC_LBL, SIcon, appAlert, appConfirm, fmt, fmtFechaDMY, fmtN, fmtRutCL, isoLocal, useIsDesktop } from './base.jsx'
import { Fragment } from 'react'
import logoBlanco from '../le-logo-blanco.png'
import { Spin } from './base.jsx'
import { CAT_COLORS, Lbl, MAIL_OFICINA_CONFIRM, Modal, PasosRend, RENDCAT, Switch, TXT_REINGRESO, avisoNoEnviado, chipBtn, claudeCall, corrSiguiente, cuentaEnRecuadro, driveToken, equipoPorNombre, esPersona, estadoSolicitud, firmaCorreoHtml, firmaDefault, fmtSaldoG, fondoDeRend, fondosSinTrabajo, gastosDeRend, glosaCliente, gmailParticipantesCliente, imputarSaldosTrabajos, logActividad, logEvent, logoColor, okDB, posiblesDuplicadosGastos, registrarError, rendGruposProyecto, rendicionDocHtml, rendicionFondo, rendicionPdfHtml, repartoFondos, saldoCliente, saludoCli, sendGmailWithPdf, sendMailServer, setLearningKV, txtEnviado } from './compartido.jsx'

// ─── EXPENSES VIEW ────────────────────────────────────────────────────────────
export function RendicionModal({client, entityIds, expenses, clientEntities, sales=[], rendiciones=[], onClose, onRendicionComplete, setExpenses, currentUserName, onEnviar, editRend=null, setRendiciones, billing=[], setBilling, asPage=false, preSel=false, navBorr=null, onRevisada=null}) {
  const esEdicion = !!editRend
  const isDesktop = useIsDesktop()
  // Lo que se está armando se guarda en el equipo a cada cambio: si se sale (Volver, otra pestaña, se cierra la app) se recupera al volver.
  const wipKey = `fd_rend_wip_${client.id}__${currentUserName||'x'}`   // por persona: en un equipo compartido cada uno ve solo lo suyo
  const wip0 = useMemo(()=>{ if(editRend||preSel) return null; try{ const w=JSON.parse(localStorage.getItem(wipKey)||localStorage.getItem(`fd_rend_wip_${client.id}`)||'null'); if(!w||Date.now()-(w.at||0)>14*86400000) return null
      const pend=new Set((expenses||[]).filter(e=>e.client_id===client.id&&e.type==='gasto'&&!e.client_rendered_at&&!e.deleted_at).map(e=>String(e.id)))
      const ids=(w.sel||[]).filter(id=>pend.has(String(id))); return ids.length?{...w,sel:ids}:null }catch(_){ return null } },[])   // eslint-disable-line react-hooks/exhaustive-deps
  const [selected, setSelected] = useState(()=> editRend ? new Set((expenses||[]).filter(e=>String(e.client_render_id)===String(editRend.id)).map(e=>e.id)) : new Set(wip0?wip0.sel:[]))
  const [wipRec, setWipRec] = useState(!!wip0)   // se recuperó una selección sin guardar
  const [saving, setSaving] = useState(false)
  const [fDesde, setFDesde] = useState('')
  const [fHasta, setFHasta] = useState('')
  const [contacts, setContacts] = useState([])
  const [atencion, setAtencion] = useState(editRend?.dirigido_a||wip0?.atencion||'')
  const [prefilled, setPrefilled] = useState(false)   // "Dirigido a" precargado de rendición anterior
  const [limpiandoIA, setLimpiandoIA] = useState(false)
  const [editDet, setEditDet] = useState(null)   // detalle de un gasto en edición {id, v}: tocar el texto lo corrige a mano (mismo campo que «Mejorar descripciones con IA»)
  const [atencionEmail, setAtencionEmail] = useState(editRend?.dirigido_email||'')
  const [showSub, setShowSub] = useState(!!(editRend&&editRend.subproject))
  const [showFiltroFecha, setShowFiltroFecha] = useState(false)
  // «Ya la rendí por fuera»: registra una rendición hecha por correo o Drive (no envía nada) para que esos gastos dejen de figurar por rendir.
  const [extOpen,setExtOpen] = useState(false)
  const [extFecha,setExtFecha] = useState(()=>isoLocal(Date.now()))
  const [extLink,setExtLink] = useState('')

  // Movimientos del cliente, acotados a la(s) razón(es) social(es) seleccionada(s).
  // Con 1 RS todo pertenece a esa RS (incl. sin entity_id); sin selección/sin RS, todos.
  const entsCli = (clientEntities||[]).filter(e=>e.client_id===client.id)
  const singleRS = entsCli.length<=1
  // RS de la rendición: 1 RS → automática; varias → la elige el emisor (acota los gastos a esa RS).
  const [selEnt,setSelEnt] = useState(()=> { if(editRend?.entity_id) return editRend.entity_id; if(entsCli.length===1) return entsCli[0].id; if(entityIds&&entityIds[0]) return entityIds[0]
    // Varias RS: abre en la que tiene más gastos por rendir (no en la primera de la lista, que puede no tener ninguno).
    const n={}; (expenses||[]).forEach(e=>{ if(e.client_id===client.id&&e.type==='gasto'&&!e.client_rendered_at&&e.entity_id) n[e.entity_id]=(n[e.entity_id]||0)+1 })
    const top=Object.keys(n).sort((a,b)=>n[b]-n[a])[0]; return top || (entsCli[0]&&entsCli[0].id) || null })
  // Proyecto y subproyecto de la rendición (el emisor elige; el proyecto FILTRA los gastos al crear; al editar es solo metadata).
  // Proyectos que se muestran (desplegable con varios a la vez; vacío = todos). `proyecto` = el único elegido, con la semántica de antes
  // (filtra, y a los gastos sin proyecto les asigna ese al rendir).
  const [proyF,setProyF] = useState(()=>{ const p=editRend?.project||wip0?.proyecto||''; return new Set(p?[p]:[]) })
  const proyecto = proyF.size===1&&!proyF.has('__sin__') ? [...proyF][0] : ''
  const setProyecto = p => setProyF(new Set(p?[p]:[]))
  const [proyOpen,setProyOpen] = useState(false)   // desplegable de proyectos abierto
  const [subproyecto,setSubproyecto] = useState(editRend?.subproject||wip0?.subproyecto||'')
  useEffect(()=>{ if(esEdicion) return; try{ localStorage.removeItem(`fd_rend_wip_${client.id}`); if(selected.size) localStorage.setItem(wipKey,JSON.stringify({sel:[...selected],proyecto,subproyecto,atencion,at:Date.now()})); else localStorage.removeItem(wipKey) }catch(_){} },[selected,proyecto,subproyecto,atencion])   // eslint-disable-line react-hooks/exhaustive-deps
  const headEnt = entsCli.length===1 ? entsCli[0] : (entsCli.find(e=>e.id===selEnt)||null)
  // Multi-RS: al elegir una RS se incluyen sus gastos Y los SIN razón social (ej. notaría sin RS) — no deben quedar fuera de la rendición.
  const inScope = e => singleRS ? true : (selEnt ? (e.entity_id===selEnt || !e.entity_id) : true)
  const allMovs = expenses.filter(e=>e.client_id===client.id && inScope(e))
  // Comprobantes de respaldo: qué gastos del cliente tienen adjuntos (para referenciarlos en el PDF).
  const [conRespaldo,setConRespaldo] = useState(new Set())
  useEffect(()=>{
    const ids=allMovs.filter(e=>e.type==='gasto').map(e=>e.id); if(!ids.length){ setConRespaldo(new Set()); return }
    let alive=true
    supabase.from('expense_attachments').select('expense_id').in('expense_id',ids).then(({data})=>{ if(alive) setConRespaldo(new Set((data||[]).map(r=>String(r.expense_id)))) },()=>{})
    return ()=>{alive=false}
  },[client.id,selEnt])
  // Rendir un fondo: con 2+ fondos se elige primero qué se rinde (gastos o un fondo). El reparto dice qué gastos cubrió cada fondo.
  const repF = useMemo(()=>repartoFondos(expenses, client.id),[expenses,client.id])
  const fondosRS = repF.fondos.filter(x=>inScope(x.f))
  const verModoFondo = !esEdicion && !navBorr && fondosRS.length>=2
  const [modoR,setModoR] = useState(editRend?.fondo_id?'fondo':'gastos')
  const [fondoSel,setFondoSel] = useState(editRend?.fondo_id||null)
  const [addSinFondo,setAddSinFondo] = useState(false)
  const enFondo = !!fondoSel && modoR==='fondo' && (esEdicion?!!editRend?.fondo_id:verModoFondo)
  const fondoObj = enFondo ? ((expenses||[]).find(e=>String(e.id)===String(fondoSel))||null) : null
  const _fondoRend = rendicionFondo(expenses, client.id, singleRS?null:selEnt, esEdicion?editRend.id:null, null, enFondo?fondoSel:null)
  const fondosDisp = _fondoRend.totFondos
  const saldoActual = _fondoRend.saldo
  // Correlativo por cliente: se cuenta solo sobre las rendiciones ENVIADAS (correlativo grabado). Tentativo = max + 1.
  const rendsCliEnv = (rendiciones||[]).filter(r=>String(r.client_id)===String(client.id) && r.correlativo && !r.anulada_at)
  const nextCorr = corrSiguiente(rendiciones, client.id)
  const previasN = rendsCliEnv.length

  // Proyecto = VENTA: los proyectos del cliente vienen de sus ventas/propuestas (sales.title) y de los
  // proyectos ya escritos en gastos pendientes. Se combinan; sugerido = el de más gastos, o si no hay, la venta.
  const gastosPend = allMovs.filter(e=>e.type==='gasto' && !e.client_rendered_at)
  const proyConteo = {}; gastosPend.forEach(e=>{ const p=e.project||''; if(p) proyConteo[p]=(proyConteo[p]||0)+1 })
  const ventasProy = (sales||[]).filter(s=>String(s.client_id)===String(client.id) && s.title && !['Rechazada','Borrador'].includes(s.status) && (singleRS || !s.entity_id || String(s.entity_id)===String(selEnt)))
  const proyToSale = {}; ventasProy.forEach(s=>{ if(!(s.title in proyToSale)) proyToSale[s.title]=s.id })
  const proyVentas = [...new Set(ventasProy.map(s=>s.title))]
  const proyectosDisp = [...new Set([...Object.keys(proyConteo), ...proyVentas])].sort((a,b)=>(proyConteo[b]||0)-(proyConteo[a]||0))
  const cntProy = {}; gastosPend.filter(e=>!e.no_descuenta_saldo&&!e.apertura_id&&e.category!=='Apertura').forEach(e=>{ const k=e.project||(sales||[]).find(s=>String(s.id)===String(e.sale_id))?.title||''; const c=cntProy[k]||(cntProy[k]={n:0,m:0}); c.n++; c.m+=Number(e.amount)||0; const t=cntProy.__todos||(cntProy.__todos={n:0,m:0}); t.n++; t.m+=Number(e.amount)||0 })
  const proyectoSugerido = Object.keys(proyConteo).sort((a,b)=>proyConteo[b]-proyConteo[a])[0] || proyVentas[0] || ''
  // Default automático: SOLO un proyecto que tenga gastos disponibles; nunca un título de venta sin gastos (ocultaría todo). Si no hay, "Todos".
  // Un solo proyecto con gastos → ese (los sin proyecto lo toman al rendir); varios → «Todos», agrupados por proyecto.
  const proyectoDefault = Object.keys(proyConteo).length===1 ? Object.keys(proyConteo)[0] : ''
  // Al cambiar de RS (o al abrir), preseleccionar solo si hay un proyecto con gastos; si no, dejar "Todos" para no esconder nada.
  useEffect(()=>{ if(esEdicion) return; setProyecto(proyectosDisp.includes(proyecto)?proyecto:(preSel?'':proyectoDefault)) }, [selEnt])   // borrador preparado: todos sus gastos de la RS, sin acotar a un trabajo

  // Gastos disponibles para rendir (no rendidos aun), acotados al proyecto elegido.
  // Un gasto pertenece al proyecto si tiene esa glosa de proyecto O está vinculado a su venta (sale_id).
  // Posibles duplicados del cliente (misma regla que caja chica): se comparan con todos sus gastos, también los ya rendidos.
  const dupRend = posiblesDuplicadosGastos(allMovs.filter(e=>e.type==='gasto'))
  const keyP = e => e.project || (sales||[]).find(s=>String(s.id)===String(e.sale_id))?.title || ''
  // Chips del gasto (proyecto y fondo): se corrigen tocándolos, sin marcar ni desmarcar el gasto.
  const chipSty = warn => ({fontSize:9.5,fontWeight:700,color:warn?C.soonText:C.accent,background:warn?C.soonBg:C.bgSoft,border:`1px dashed ${warn?C.soonText:C.done}`,borderRadius:20,padding:'1px 6px',maxWidth:'100%',cursor:'pointer',fontFamily:'inherit'})
  const _stop = ev => ev.stopPropagation()
  const disponibles = allMovs.filter(e=>{
    if(e.type!=='gasto') return false
    const mine = esEdicion && String(e.client_render_id)===String(editRend.id)   // gasto que YA está en esta rendición: siempre visible (pre-marcado)
    if(e.no_descuenta_saldo && !mine) return false   // gasto histórico no se rinde
    if((e.apertura_id || e.category==='Apertura') && !mine) return false   // resumido en el saldo de apertura: no se rinde
    if(e.client_rendered_at && !mine) return false   // gastos de OTRA rendición no entran
    if(!mine && enFondo){   // rendir un fondo: los gastos que le tocan en el reparto (+ los sin fondo, si se pidió agregarlos)
      const d=repF.deGasto[e.id]; if(!(d&&String(d)===String(fondoSel)) && !(addSinFondo&&d==null)) return false }
    else if(!mine){   // los filtros de proyecto/fecha solo acotan los candidatos a AGREGAR, nunca esconden los propios
      if(proyecto){ const sid=proyToSale[proyecto]; const ok=!e.project || (e.project||'')===proyecto || (sid && String(e.sale_id)===String(sid)); if(!ok) return false }
      else if(proyF.size){ const k=keyP(e); if(k ? !proyF.has(k) : !proyF.has('__sin__')) return false }
      if(fDesde && e.date && e.date < fDesde) return false
      if(fHasta && e.date && e.date > fHasta) return false
    }
    return true
  }).sort((a,b)=>(a.date||'')>(b.date||'')?1:-1)

  const totalSel = disponibles.filter(e=>selected.has(e.id)).reduce((a,e)=>a+(e.amount||0),0)
  const saldoTrasRendicion = saldoActual - totalSel
  const fondosList = _fondoRend.fondos

  // "Dirigido a": precargar del valor guardado de rendiciones anteriores del cliente (tabla contacts)
  useEffect(()=>{
    let alive=true
    supabase.from('contacts').select('*').eq('client_id',client.id).order('created_at').then(({data})=>{
      if(!alive||!data) return
      setContacts(data)
      if(!esEdicion && data[0]?.nombre){ setAtencion(data[0].nombre); setPrefilled(true) }
      if(!esEdicion && data[0]?.email){ setAtencionEmail(data[0].email) }
    })
    return ()=>{alive=false}
  },[client.id])
  // Guarda el "Dirigido a" para reutilizarlo (insert si no hay contacto, update si cambió)
  const guardarDirigido = async()=>{
    const v=(atencion||'').trim(); if(!v) return
    if(contacts[0]){ if(contacts[0].nombre!==v){ const {error}=await supabase.from('contacts').update({nombre:v}).eq('id',contacts[0].id); if(error){ appAlert('No se pudo guardar el contacto: '+error.message); return } setContacts(p=>p.map((c,i)=>i===0?{...c,nombre:v}:c)) } }
    else { const {data}=await supabase.from('contacts').insert({client_id:client.id,nombre:v}).select().single(); if(data) setContacts([data]) }
  }

  const toggleAll = () => {
    if(gastosSel.length===disponibles.length) setSelected(new Set())
    else setSelected(new Set(disponibles.map(e=>e.id)))
  }
  const toggleOne = id => setSelected(p=>{ const n=new Set(p); n.has(id)?n.delete(id):n.add(id); return n })
  const CATS = CAT_COLORS

  const gastosSel = disponibles.filter(e=>selected.has(e.id))
  // Rendir cuentas exige proyecto: si algún gasto marcado no lo tiene, hay que elegirlo (se le asigna al rendir, con su venta).
  const nSinProyR = gastosSel.filter(e=>!e.sale_id&&!e.project).length
  // Rendir un fondo: los gastos sin proyecto toman el del fondo; si el fondo tampoco tiene, se le asigna arriba.
  const proyFondo = enFondo ? (fondoObj?.project||'') : ''
  const faltaProyR = enFondo ? (nSinProyR>0 && !proyFondo) : (!proyecto && nSinProyR>0)
  const puedeRendir = gastosSel.length>0 && !faltaProyR
  // Borrador preparado (Rendir a cliente › Borradores): abre con todos sus gastos disponibles ya marcados, una sola vez.
  const _preHecho = useRef(false)
  useEffect(()=>{ if(!preSel||esEdicion||_preHecho.current||!disponibles.length) return; _preHecho.current=true; setSelected(new Set(disponibles.map(e=>e.id))) },[preSel,disponibles.length])   // eslint-disable-line react-hooks/exhaustive-deps
  const proyPatch = e => { const pr=enFondo?proyFondo:proyecto, sid=proyToSale[pr]; return pr ? {...(!e.project?{project:pr}:{}), ...(sid&&!e.sale_id?{sale_id:sid}:{})} : {} }

  // IA: profesionaliza las descripciones de los gastos seleccionados (expande abreviaciones legales, corrige tildes). Guarda el resultado.
  const guardarDetalle = async()=>{ const d=editDet; if(!d) return; setEditDet(null)
    const e=(expenses||[]).find(x=>x.id===d.id); const v=String(d.v||'').trim(); if(!e||!v||v===(e.concept||'')) return
    if(setExpenses) setExpenses(p=>p.map(x=>x.id===e.id?{...x,concept:v}:x))
    if(DEMO) return
    const {error}=await supabase.from('expenses').update({concept:v}).eq('id',e.id)
    if(error){ if(setExpenses) setExpenses(p=>p.map(x=>x.id===e.id?{...x,concept:e.concept}:x)); appAlert('No se pudo guardar el detalle: '+error.message); return }
    logActividad('gastos.detalle_editado',{tabla:'expenses',id:e.id,detalle:{cliente:client?.name,title:'Detalle del gasto corregido en la rendición',antes:e.concept||'',despues:v}}) }
  // Correcciones en la misma página (quedan en el gasto o fondo y en la bitácora): proyecto de un gasto, fondo de un gasto, proyecto de un fondo.
  const _patchMov = async(e, patch, accion, title, antes, despues) => {
    if(setExpenses) setExpenses(p=>p.map(x=>x.id===e.id?{...x,...patch}:x))
    if(DEMO) return true
    const {error}=await supabase.from('expenses').update(patch).eq('id',e.id)
    if(error){ const back={}; Object.keys(patch).forEach(k=>{ back[k]=e[k]??null }); if(setExpenses) setExpenses(p=>p.map(x=>x.id===e.id?{...x,...back}:x)); appAlert('No se pudo guardar: '+error.message); return false }
    logActividad(accion,{tabla:'expenses',id:e.id,detalle:{cliente:client?.name,title,antes,despues,monto:Math.round(Number(e.amount)||0)}}); return true }
  const asignarProyGasto = (e,p) => { if((e.project||'')===(p||'')) return; const sid=p?(proyToSale[p]||null):null
    return _patchMov(e,{project:p||null, sale_id:sid}, 'gastos.proyecto_editado', 'Proyecto del gasto corregido en la rendición', keyP(e)||'Sin proyecto', p||'Sin proyecto') }
  const asignarProyFondo = (f,p) => { if(!f||(f.project||'')===(p||'')) return; const sid=p?(proyToSale[p]||null):null
    return _patchMov(f,{project:p||null, sale_id:sid}, 'fondos.proyecto_asignado', 'Proyecto del fondo asignado en la rendición', f.project||'Sin proyecto', p||'Sin proyecto') }
  const fondoTxt = f => f ? `Fondo ${fmtFechaDMY(f.date)}${f.project?` · ${f.project}`:''}` : 'Sin fondo'
  const moverAFondo = (e,fid) => { const prev=repF.deGasto[e.id]||null; if(String(prev||'')===String(fid||'')&&String(e.reembolso_fondo_id||'')===String(fid||'')) return
    const fA=(expenses||[]).find(x=>String(x.id)===String(prev)), fB=(expenses||[]).find(x=>String(x.id)===String(fid))
    if(enFondo&&String(fid||'')!==String(fondoSel)) setSelected(p=>{ const n=new Set(p); n.delete(e.id); return n })
    return _patchMov(e,{reembolso_fondo_id:fid||null}, 'gastos.fondo_movido', fid?'Gasto movido a otro fondo':'Gasto vuelve al reparto automático de fondos', fondoTxt(fA), fid?fondoTxt(fB):'Según la regla') }
  const mejorarDescripcionesIA = async()=>{
    const sel = disponibles.filter(e=>selected.has(e.id))
    if(!sel.length) return
    setLimpiandoIA(true)
    const lista = sel.map((e,i)=>`${i+1}. "${e.concept||''}"`).join('\n')
    const prompt = `Eres asistente de una firma de abogados chilena. Profesionaliza estas descripciones de GASTOS para una rendición al cliente: corrige ortografía y tildes ("notaria"→"Notaría", "inscripcion"→"Inscripción"), capitaliza bien y EXPANDE abreviaciones legales chilenas ("EP"→"Escritura Pública", "CV"→"Compraventa", "CCV"→"Copia con Vigencia", "GP"→"Gravámenes y Prohibiciones", "D.O."→"Diario Oficial", "+K"→"Empresa en un Día", "CBR"→"Conservador de Bienes Raíces", "CBRS"→"Conservador de Bienes Raíces de Santiago"). Mantén el significado; si ya está correcta, devuélvela igual. NO inventes datos. Responde SOLO un array JSON sin markdown: [{"i":1,"concepto":"..."}]\n\nDESCRIPCIONES:\n${lista}`
    try{
      const data = await claudeCall({model:'claude-opus-4-8',max_tokens:1500,messages:[{role:'user',content:prompt}]})
      const raw = (data.content?.[0]?.text||'[]').replace(/^```(?:json)?\s*/i,'').replace(/```\s*$/,'').trim()
      const arr = JSON.parse(raw)
      const updates = []
      ;(Array.isArray(arr)?arr:[]).forEach(o=>{ const e=sel[(o.i||0)-1]; if(e && o.concepto && o.concepto.trim() && o.concepto!==e.concept){ updates.push({id:e.id, concepto:o.concepto.trim()}) } })
      if(!updates.length){ appAlert('Las descripciones ya estaban claras.'); setLimpiandoIA(false); return }
      for(const u of updates){ await supabase.from('expenses').update({concept:u.concepto}).eq('id',u.id) }
      if(setExpenses) setExpenses(p=>p.map(e=>{ const u=updates.find(x=>x.id===e.id); return u?{...e,concept:u.concepto}:e }))
      logEvent('rendicion','limpiar_descripciones',{n:updates.length},currentUserName)
      appAlert(`${updates.length} descripción(es) mejorada(s).`)
    }catch(e){ appAlert('Error al mejorar con IA: '+(e?.message||e)) }
    setLimpiandoIA(false)
  }
  const generatePDFContent = (atencionVal) => {
    const ent = headEnt
    const razon = ent?.name || client.name || '\u2014'
    const rut = ent?.rut || client.rut || ''
    const fechaEmision = new Date().toLocaleDateString('es-CL',{day:'2-digit',month:'long',year:'numeric'})
    const fechas = [...gastosSel, ...fondosList].map(e=>e.date).filter(Boolean).sort()
    const mesAno = d => new Date(d+'T12:00').toLocaleDateString('es-CL',{month:'long',year:'numeric'})
    const dia = d => new Date(d+'T12:00').toLocaleDateString('es-CL')
    let periodo='\u2014'
    if(fechas.length){ const ini=fechas[0], fin=fechas[fechas.length-1]; periodo = mesAno(ini)===mesAno(fin) ? mesAno(ini) : `${dia(ini)} \u2013 ${dia(fin)}` }
    // Rendiciones anteriores de este fondo (la tanda actual a\u00fan no est\u00e1 rendida \u2192 queda fuera).
    const {previas, rendidoAntes} = _fondoRend
    return rendicionDocHtml({ razon, rut, periodo, fechaEmision, dirigidoA: atencionVal||null, gastos: gastosSel.map(e=>({...e,respaldo:conRespaldo.has(String(e.id))})), fondos: fondosList, totGastos: totalSel, totFondos: fondosDisp, rendidoAntes, rendicionesPrevias: previas, correlativo: nextCorr, project: proyecto||null, subproject: (subproyecto||'').trim()||null, grupos: rendGruposProyecto({expenses, clientId:client.id, scopeEntId:singleRS?null:selEnt, gastos:gastosSel.map(e=>({...e,...proyPatch(e)})), sales, clientEntities}) })
  }

  // ── Trabajos (= proyectos) de la rendición. Separar por trabajo solo si TODO fondo del cliente tiene trabajo asignado
  // (si no, no hay cómo saber a cuál va cada peso sin inventarlo).
  const keyT = e => e.project || (sales||[]).find(s=>String(s.id)===String(e.sale_id))?.title || ''
  const proyPatchT = (e,t) => t ? {...(!e.project?{project:t}:{}), ...(proyToSale[t]&&!e.sale_id?{sale_id:proyToSale[t]}:{})} : {}
  const scopeEnt = singleRS?null:selEnt
  const fSinT = fondosSinTrabajo(expenses, client.id, scopeEnt)
  const trabajosSel = [...new Set(gastosSel.map(e=>keyT({...e,...proyPatch(e)})).filter(Boolean))]
  const multiT = !esEdicion && !enFondo && trabajosSel.length>=2
  const puedeSeparar = multiT && fSinT===0
  const trabajosCli = new Set(allMovs.map(e=>e.project||'').filter(Boolean))
  // Un solo trabajo de un cliente que tiene varios: los fondos y el saldo son los de ESE trabajo (no los del cliente completo).
  const porTrabajoUno = !esEdicion && !enFondo && trabajosSel.length===1 && fSinT===0 && trabajosCli.size>=2
  const [modo,setModo] = useState('junto')   // 'junto' | 'sep1' (separadas, un correo) | 'sepN' (un correo cada una)
  useEffect(()=>{ if(DEMO) return; let on=true; supabase.from('learnings').select('value').eq('kind','rendicion_modo').eq('key',String(client.id)).order('updated_at',{ascending:false}).limit(1).maybeSingle().then(({data})=>{ if(on&&['junto','sep1','sepN'].includes(data?.value)) setModo(data.value) },()=>{}); return ()=>{on=false} },[client.id])
  const elegirModo = m => { setModo(m); if(!DEMO) setLearningKV('rendicion_modo',String(client.id),m).catch(()=>{}) }
  const modoEf = puedeSeparar ? modo : 'junto'
  const cifrasT = t => { const f=rendicionFondo(expenses, client.id, scopeEnt, esEdicion?editRend.id:null, t); const gs=gastosSel.filter(e=>keyT({...e,...proyPatch(e)})===t); const tg=gs.reduce((a,e)=>a+(e.amount||0),0); return {t, f, gs, tg, saldo:f.totFondos-f.rendido-tg} }
  const porT = (multiT||porTrabajoUno) ? trabajosSel.map(cifrasT) : []
  const periodoDe = gs => { const _fs=gs.map(e=>e.date).filter(Boolean).sort(); const _ma=d=>new Date(d+'T12:00').toLocaleDateString('es-CL',{month:'long',year:'numeric'}); const _di=d=>fmtFechaDMY(d); return _fs.length ? (_ma(_fs[0])===_ma(_fs[_fs.length-1]) ? _ma(_fs[0]) : `${_di(_fs[0])} – ${_di(_fs[_fs.length-1])}`) : new Date().toLocaleDateString('es-CL',{month:'long',year:'numeric'}) }
  // Una sola forma de crear la rendición (borrador, vista previa del correo, separadas): registra la fila, marca los gastos y la devuelve con sus gastos.
  const crearRendicion = async(gs, {proyectoR, porTrabajo, fondoId=null, proyFila}) => {
    const renderId = crypto.randomUUID(), now = new Date().toISOString()
    const tot = gs.reduce((a,e)=>a+(e.amount||0),0)
    const otNums = [...new Set(gs.map(e=>e.ot_number).filter(Boolean))].join(', ')
    const fila = { id:renderId, user_name:currentUserName||'admin', client_id:client.id, periodo:periodoDe(gs), total:tot, n_gastos:gs.length, n_clientes:1, tipo:'cliente',
      entity_id:selEnt||null, project:(proyFila!==undefined?proyFila:proyectoR)||null, subproject:(subproyecto||'').trim()||null, dirigido_a:(atencion||'').trim()||null, dirigido_email:atencionEmail||null, ot_numbers:otNums||null, por_trabajo:!!porTrabajo, ...(fondoId?{fondo_id:fondoId}:{}) }
    const {error:rendErr} = await supabase.from('rendiciones').insert(fila)
    if(rendErr) throw new Error('No se pudo registrar la rendición: '+rendErr.message)
    let falloMarca = 0; const marcados=[]
    // Rendición de un fondo: cada gasto queda ligado a ese fondo (el reparto ya no lo mueve aunque entren fondos nuevos).
    for(const e of gs){ const patch={client_rendered_at:now, client_render_id:renderId, ...(proyectoR?proyPatchT(e,proyectoR):proyPatch(e)), ...(fondoId?{reembolso_fondo_id:fondoId}:{})}; const {data:upd,error}=await supabase.from('expenses').update(patch).eq('id',e.id).is('client_rendered_at',null).select('id'); if(error||(!DEMO&&!(upd||[]).length)){ falloMarca++; continue } marcados.push({...e,...patch}) }
    if(!marcados.length){ await supabase.from('rendiciones').delete().eq('id',renderId); throw new Error('ningún gasto quedó en la rendición (ya estaban en otra). No se guardó nada.') }   // nunca una rendición vacía
    if(falloMarca>0){ appAlert(`Atención: ${falloMarca} de ${gs.length} gasto(s) no se marcaron: ya estaban en otra rendición o no se pudieron guardar. Quedan fuera de esta.`); const tot2=marcados.reduce((a,e)=>a+(e.amount||0),0); await supabase.from('rendiciones').update({total:tot2,n_gastos:marcados.length}).eq('id',renderId); fila.total=tot2; fila.n_gastos=marcados.length }
    if(setExpenses) setExpenses(p=>p.map(e=>{ const m=marcados.find(x=>x.id===e.id); return m?{...e,...m}:e }))
    const rendObj = {...fila, created_at:now, correlativo:null}
    if(onRendicionComplete) onRendicionComplete(rendObj)
    return {...rendObj, _gastos:marcados}
  }
  // Rendición(es) en vista previa: nada se registra hasta «Guardar borrador» o «Enviar» (ahí corre _crear).
  const virtuales = () => {
    const base = {id:null, _virtual:true, client_id:client.id, tipo:'cliente', entity_id:selEnt||null, fondo_id:enFondo?fondoSel:null, subproject:(subproyecto||'').trim()||null, dirigido_a:(atencion||'').trim()||null, dirigido_email:atencionEmail||null, user_name:currentUserName||'admin', created_at:new Date().toISOString()}
    if(enFondo){ const gs=gastosSel.map(e=>({...e,...proyPatch(e),reembolso_fondo_id:fondoSel})); const pf=proyFondo||(trabajosSel.length===1?trabajosSel[0]:null)||null; return [{...base, _gastos:gs, project:pf, por_trabajo:false, periodo:periodoDe(gs), total:totalSel, n_gastos:gs.length, correlativo:nextCorr, _crear:()=>crearRendicion(gastosSel,{proyectoR:null, porTrabajo:false, fondoId:fondoSel, proyFila:pf})}] }
    if(modoEf==='junto'){ const gs=gastosSel.map(e=>({...e,...proyPatch(e)})); const pt=porTrabajoUno; const pj=proyecto||(pt||trabajosSel.length===1?trabajosSel[0]:null)||null; return [{...base, _gastos:gs, project:pj, por_trabajo:pt, periodo:periodoDe(gs), total:totalSel, n_gastos:gs.length, correlativo:nextCorr, _crear:()=>crearRendicion(gastosSel,{proyectoR:proyecto||(pt?trabajosSel[0]:null), porTrabajo:pt, proyFila:pj})}] }
    return porT.map((o,i)=>{ const gs=o.gs.map(e=>({...e,...proyPatchT(e,o.t)})); return {...base, _gastos:gs, project:o.t, por_trabajo:true, periodo:periodoDe(gs), total:o.tg, n_gastos:gs.length, correlativo:nextCorr+i, _crear:()=>crearRendicion(o.gs,{proyectoR:o.t, porTrabajo:true})} })
  }
  // «Una por proyecto en un correo» (sep1): el grupo queda en rendiciones.correo para que Borradores y el envío conjunto las manden en un solo correo.
  const agruparSep1 = async hechas => {
    if(enFondo||modoEf!=='sep1'||hechas.length<2) return
    const correo={modo:'sep1', grupo:hechas.map(x=>x.id), agrupado_at:new Date().toISOString()}
    const {error}=await supabase.from('rendiciones').update({correo}).in('id',correo.grupo)
    if(error) throw new Error('las rendiciones quedaron guardadas, pero no como un solo correo: '+error.message)
    if(setRendiciones) setRendiciones(p=>p.map(x=>correo.grupo.includes(x.id)?{...x,correo}:x))
  }
  const verPdfVirtual = v => { const w=window.open('','_blank'); if(!w){ appAlert('El navegador bloqueó la ventana del PDF. Permite ventanas emergentes para esta página.'); return } w.document.write(rendicionPdfHtml(v, client, expenses, clientEntities, conRespaldo)); w.document.close() }
  const handleGenerar = async(accion='pdf') => {
    if(!gastosSel.length||faltaProyR) return
    const vs = virtuales()
    // Ver PDF es solo revisar: no registra nada.
    if(accion==='pdf'){ verPdfVirtual(vs[0]); return }
    // Eligió separar por proyecto pero hay un fondo sin proyecto: no guardar en silencio como una sola rendición.
    if(!enFondo&&multiT&&modo!=='junto'&&!puedeSeparar){ appAlert('Para separar por proyecto, primero elige el proyecto del fondo en «Antes de separar», o elige «Una rendición».'); return }
    if(accion==='correo'){   // paso 2: el correo, todavía sin registrar nada
      await guardarDirigido()
      if(!onEnviar) return
      _salida.current=true   // va al correo: no es salir sin guardar
      if(modoEf==='sep1') onEnviar({...vs[0], _hermanas:vs.slice(1)})
      else if(modoEf==='sepN') onEnviar({...vs[0], _cola:vs.slice(1)})
      else onEnviar(vs[0])
      return
    }
    // Guardar borrador: registra la(s) rendición(es) sin enviar nada.
    setSaving(true)
    try{
      const hechas=[]; for(const v of vs) hechas.push(await v._crear())
      await agruparSep1(hechas)
      _salida.current=true
      await guardarDirigido()
      logActividad('rendicion.borrador_guardado',{tabla:'rendiciones',id:hechas[0]?.id,detalle:{cliente:client.name,title:`Borrador guardado${hechas.length>1?` (${hechas.length} rendiciones por trabajo)`:''}`,monto:Math.round(hechas.reduce((a,x)=>a+(x.total||0),0))}})
      setSelected(new Set())
      if(onRevisada) onRevisada()
      else { appAlert(hechas.length>1?`${hechas.length} borradores guardados. Los encuentras en Rendir a cliente › Borradores.`:'Borrador guardado. Lo encuentras en Rendir a cliente › Borradores.'); onClose&&onClose() }
    }catch(e){ appAlert('Error: '+e.message) }
    setSaving(false)
  }
  // Salir con gastos marcados sin guardar (Volver, otra pestaña, siguiente cliente): queda guardada sola como borrador,
  // a nombre de quien la armaba, para no perder el trabajo. Ir al correo o guardar/registrar no cuenta como salir.
  const _salida = useRef(false)
  const _autoBorr = useRef(null)
  _autoBorr.current = (!esEdicion && gastosSel.length>0 && !faltaProyR && !saving && !(!enFondo&&multiT&&modo!=='junto'&&!puedeSeparar)) ? async()=>{
    try{ const vs=virtuales(); const hechas=[]; for(const v of vs) hechas.push(await v._crear())
      await agruparSep1(hechas)
      try{ localStorage.removeItem(wipKey); localStorage.removeItem(`fd_rend_wip_${client.id}`) }catch(_){}
      logActividad('rendicion.borrador_guardado',{tabla:'rendiciones',id:hechas[0]?.id,detalle:{cliente:client.name,title:'Borrador guardado al salir de la rendición',monto:Math.round(hechas.reduce((a,x)=>a+(x.total||0),0))}})
    }catch(_){ /* queda la selección guardada en el equipo y se recupera al volver */ } } : null
  // Solo en un desmontaje real: el doble montaje de prueba de React (desarrollo) vuelve a montar antes del setTimeout.
  const _montado = useRef(false)
  useEffect(()=>{ _montado.current=true; return ()=>{ _montado.current=false; const f=_autoBorr.current; setTimeout(()=>{ if(!_montado.current&&!_salida.current&&f) f() },0) } },[])   // eslint-disable-line react-hooks/exhaustive-deps
  const handleExterna = async() => {
    if(!gastosSel.length||faltaProyR||!extFecha) return
    setSaving(true)
    try {
      const renderId = crypto.randomUUID()
      const enviadaAt = new Date(extFecha+'T12:00:00').toISOString()
      const _fs = gastosSel.map(e=>e.date).filter(Boolean).sort()
      const periodoSel = _fs.length ? `${fmtFechaDMY(_fs[0])} – ${fmtFechaDMY(_fs[_fs.length-1])}` : fmtFechaDMY(extFecha)
      const {data:mx}=await supabase.from('rendiciones').select('correlativo').eq('client_id',client.id).is('anulada_at',null).not('correlativo','is',null).order('correlativo',{ascending:false}).limit(1).maybeSingle()   // misma regla que corrSiguiente: las anuladas no cuentan
      const corr=((mx&&mx.correlativo)||0)+1
      const row={id:renderId,user_name:currentUserName||'admin',client_id:client.id,periodo:periodoSel,total:totalSel,n_gastos:gastosSel.length,n_clientes:1,tipo:'cliente',
        entity_id:selEnt||null,project:proyecto||null,subproject:(subproyecto||'').trim()||null,dirigido_a:(atencion||'').trim()||null,
        created_at:enviadaAt,sent_at:enviadaAt,correlativo:corr,estado_envio:'externa',comprobante_url:(extLink||'').trim()||null}
      const {error:rErr}=await supabase.from('rendiciones').insert(row)
      if(rErr) throw new Error('No se pudo registrar la rendición: '+rErr.message)
      // Solo cuentan los gastos que de verdad quedaron marcados (uno ya rendido en otra rendición no se toca): la fila guarda ese total.
      const marcados=[]
      for(const e of gastosSel){ const {data:upd,error}=await supabase.from('expenses').update({client_rendered_at:enviadaAt,client_render_id:renderId,...proyPatch(e)}).eq('id',e.id).is('client_rendered_at',null).select('id'); if(!error&&(DEMO||(upd||[]).length)) marcados.push(e) }
      const falla=gastosSel.length-marcados.length
      if(!marcados.length){ await supabase.from('rendiciones').delete().eq('id',renderId); throw new Error('ningún gasto quedó marcado (ya estaban en otra rendición). No se registró nada.') }
      if(falla>0){ const tot2=marcados.reduce((a,e)=>a+(e.amount||0),0); row.total=tot2; row.n_gastos=marcados.length; await supabase.from('rendiciones').update({total:tot2,n_gastos:marcados.length}).eq('id',renderId); appAlert(`Atención: ${falla} de ${gastosSel.length} gasto(s) ya estaban en otra rendición y no se incluyeron.`) }
      if(setExpenses) setExpenses(p=>p.map(e=>marcados.find(g=>g.id===e.id)?{...e,client_rendered_at:enviadaAt,client_render_id:renderId,...proyPatch(e)}:e))
      if(setRendiciones) setRendiciones(p=>[row,...(p||[])])
      logActividad('rendicion.externa_registrada',{tabla:'rendiciones',id:renderId,detalle:{cliente:client.name,title:`Rendición N° ${corr} hecha fuera de la app (${fmtFechaDMY(extFecha)})`,monto:Math.round(totalSel),n_gastos:gastosSel.length}})
      setSelected(new Set()); setExtOpen(false); setExtLink('')
      appAlert(`Rendición N° ${corr} registrada como hecha fuera de la app (${row.n_gastos} gasto${row.n_gastos!==1?'s':''}, ${fmt(row.total)}). No se envió nada.`)
      onClose&&onClose()
    } catch(e) { appAlert('Error: '+e.message) }
    setSaving(false)
  }

  // EDITAR en sitio: actualiza la MISMA rendición (mismo id/correlativo/fecha), agrega/quita gastos, re-marca y ajusta el reembolso. No la anula ni crea otra.
  const handleGuardarEdicion = async() => {
    if(!esEdicion || !gastosSel.length || faltaProyR) return
    setSaving(true)
    try {
      const now = new Date().toISOString()
      const prevIds = new Set((expenses||[]).filter(e=>String(e.client_render_id)===String(editRend.id)).map(e=>String(e.id)))
      const selIds = new Set(gastosSel.map(e=>String(e.id)))
      const toAdd = gastosSel.filter(e=>!prevIds.has(String(e.id)))
      const toRemove = (expenses||[]).filter(e=>prevIds.has(String(e.id)) && !selIds.has(String(e.id)))
      const otNums = [...new Set(gastosSel.map(e=>e.ot_number).filter(Boolean))].join(', ')
      const patch = {total:totalSel, n_gastos:gastosSel.length, entity_id:selEnt||null, project:proyecto||null, subproject:(subproyecto||'').trim()||null, dirigido_a:(atencion||'').trim()||null, ot_numbers:otNums||null}
      // El texto del correo guardado nombra el saldo y lo rendido de antes: se borra para que se vuelva a armar con las cifras nuevas (los destinatarios quedan).
      if(!editRend.sent_at&&(editRend.correo?.cuerpo||editRend.correo?.asunto)){ const {asunto:_a,cuerpo:_c,...resto}=editRend.correo; patch.correo={...resto, texto_borrado_at:now} }
      const {error:re} = await supabase.from('rendiciones').update(patch).eq('id',editRend.id)
      if(re) throw new Error('No se pudo actualizar la rendición: '+re.message)
      const _lig = editRend.fondo_id ? {reembolso_fondo_id:editRend.fondo_id} : {}
      logActividad(editRend.sent_at?'rendicion.editada':'rendicion.borrador_editado',{tabla:'rendiciones',id:editRend.id,detalle:{cliente:client.name,title:editRend.sent_at?`Rendición N° ${editRend.correlativo||'—'} editada`:'Borrador de rendición editado',monto:Math.round(totalSel),antes:{total:editRend.total,n_gastos:editRend.n_gastos},despues:{total:totalSel,n_gastos:gastosSel.length},agregados:toAdd.map(e=>({id:e.id,concepto:e.concept,monto:e.amount})),quitados:toRemove.map(e=>({id:e.id,concepto:e.concept,monto:e.amount}))},completo:true})
      for(const e of toAdd){ await supabase.from('expenses').update({client_rendered_at:now, client_render_id:editRend.id, ...proyPatch(e), ..._lig}).eq('id',e.id) }
      for(const e of toRemove){ await supabase.from('expenses').update({client_rendered_at:null, client_render_id:null}).eq('id',e.id) }
      // Ajustar el cobro de reembolso vinculado (si existe y no está anulado) al nuevo total
      let reembAjust=null
      const reemb=(billing||[]).find(b=>b.billing_type==='reembolso'&&b.status!=='Anulada'&&(b.notes||'').includes('Rendición ID '+editRend.id))
      if(reemb && reemb.amount!==totalSel){ const {error:be}=await supabase.from('billing').update({amount:totalSel}).eq('id',reemb.id); if(!be) reembAjust={id:reemb.id} }
      if(setExpenses) setExpenses(p=>p.map(e=>{
        if(toAdd.find(x=>x.id===e.id)) return {...e,client_rendered_at:now,client_render_id:editRend.id,...proyPatch(e),..._lig}
        if(toRemove.find(x=>x.id===e.id)) return {...e,client_rendered_at:null,client_render_id:null}
        return e
      }))
      if(setRendiciones) setRendiciones(p=>p.map(r=>r.id===editRend.id?{...r,...patch}:r))
      if(reembAjust&&setBilling) setBilling(p=>p.map(b=>b.id===reembAjust.id?{...b,amount:totalSel}:b))
      await guardarDirigido()
      onClose&&onClose()
    } catch(e){ appAlert('Error: '+e.message) }
    setSaving(false)
  }

  const lblG = {fontSize:9,color:C.textSoft,textTransform:'uppercase',letterSpacing:.5,marginBottom:2}
  const fK = fondosDisp>0?{c:C.normal,bg:C.greenBg}:fondosDisp===0?{c:C.soon,bg:'#FEF6EE'}:{c:C.overdue,bg:C.overdueBg}
  const sK = saldoActual>0?{c:C.normal,bg:C.greenBg}:{c:C.overdue,bg:C.overdueBg}

  // ── Cada bloque se define UNA vez (misma lógica/estado); solo cambia el ARREGLO por isDesktop.
  // Desktop = maestro-detalle: izquierda la lista de gastos (el trabajo), derecha el "documento" que se arma
  // (continuidad + razón social + proyecto + KPIs + resumen + acciones). Móvil = apilado en el orden de hoy.
  const bContinuidad = (
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:8,marginBottom:12,paddingBottom:10,borderBottom:`1px solid ${C.border}`}}>
        <span style={{fontSize:13,fontWeight:700,color:C.accent}}>{esEdicion?<>Editando rendición{editRend.correlativo?` N° ${editRend.correlativo}`:''}<span style={{fontSize:10,fontWeight:500,color:C.textSoft}}> · no la anula</span></>:<>{modoEf!=='junto'&&porT.length>1?`Serán la ${porT.map((o,i)=>`N° ${nextCorr+i}`).join(' y ')}`:`Será la N° ${nextCorr}`}<span style={{fontSize:10,fontWeight:500,color:C.textSoft}}> · se confirma al enviar</span></>}</span>
        <span style={{fontSize:11,color:C.muted,textAlign:'right'}}>{previasN>0?`${previasN} enviada${previasN!==1?'s':''} · saldo actual ${fmtN(saldoActual)}`:'Primera rendición de este cliente'}</span>
      </div>
  )
  {/* Razón social: 1 → fija; varias → la elige el emisor (acota los gastos) */}
  const bRS = entsCli.length>0&&(()=>{
        const flBox = {background:C.bgSoft,border:`0.5px solid ${C.border}`,borderRadius:8,padding:'6px 11px',marginBottom:8}
        const flLbl = {fontSize:8,color:C.textSoft,textTransform:'uppercase',letterSpacing:.5}
        const flInp = {width:'100%',border:'none',background:'none',outline:'none',fontSize:13,color:C.accent,fontWeight:600,padding:0,height:22,appearance:'none'}
        return (
        <div style={flBox}>
          <div style={flLbl}>Razón social</div>
          {entsCli.length===1
            ? <div style={{fontSize:13,fontWeight:600,color:C.text}}>{entsCli[0].name}{entsCli[0].rut?<span style={{fontSize:11,fontWeight:400,color:C.textSoft}}> · {entsCli[0].rut}</span>:''}</div>
            : <select value={selEnt||''} onChange={e=>setSelEnt(e.target.value||null)} style={flInp}>{entsCli.map(en=><option key={en.id} value={en.id}>{en.name}{en.rut?` · ${fmtRutCL(en.rut)}`:''}</option>)}</select>}
        </div>
        )
      })()
  {/* Proyecto + Dirigido a + Subproyecto */}
  const bProyecto = (()=>{
        const flBox = on => ({background:C.bgSoft,border:`0.5px solid ${on?C.accent:C.border}`,borderRadius:8,padding:'6px 11px'})
        const flLbl = {fontSize:8,color:C.textSoft,textTransform:'uppercase',letterSpacing:.5}
        const flInp = {width:'100%',border:'none',background:'none',outline:'none',fontSize:13,color:C.text,padding:0,height:22}
        const sug = contacts.filter(c=>c.email)
        return (<>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:6}}>
          {enFondo
            ? <div style={flBox(false)}><div style={flLbl}>Proyecto del fondo{faltaProyR?' *':''}</div><div style={{fontSize:13,color:proyFondo?C.text:C.soonText,minHeight:22,display:'flex',alignItems:'center'}}>{proyFondo||'Sin proyecto'}</div></div>
            : proyectosDisp.length>0
            ? <div onClick={()=>setProyOpen(v=>!v)} style={{...flBox(proyF.size>0),...(faltaProyR?{border:`0.5px solid ${C.overdue}`}:{}),position:'relative',cursor:'pointer'}}>
                <div style={flLbl}>Proyectos{faltaProyR?' *':''}</div>
                <div style={{fontSize:13,color:C.text,minHeight:22,display:'flex',alignItems:'center',gap:6}}><span style={{flex:1,minWidth:0}}>{proyF.size===0?'Todos':proyF.size===1?(proyF.has('__sin__')?'Sin proyecto':[...proyF][0]):`${proyF.size} proyectos`}</span><Gl n={proyOpen?'chevU':'chevD'}/></div>
                {proyOpen&&<>
                  <div onClick={ev=>{ev.stopPropagation();setProyOpen(false)}} style={{position:'fixed',inset:0,zIndex:29}}/>
                  <div onClick={ev=>ev.stopPropagation()} style={{position:'absolute',top:'calc(100% + 4px)',left:0,zIndex:30,width:isDesktop?340:'calc(200% + 8px)',maxWidth:'calc(100vw - 32px)',background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,boxShadow:'0 8px 22px rgba(0,60,80,.14)',padding:5}}>
                    {[{k:'',t:'Todos los proyectos'},...proyectosDisp.map(p=>({k:p,t:p})),...(cntProy['']?[{k:'__sin__',t:'Sin proyecto'}]:[])].map(o=>{ const on=o.k?proyF.has(o.k):proyF.size===0, c=o.k==='__sin__'?cntProy['']:o.k?cntProy[o.k]:cntProy.__todos
                      return <div key={o.k||'todos'} onClick={()=>{ if(!o.k){ setProyF(new Set()); return } setProyF(p=>{ const n=new Set(p); n.has(o.k)?n.delete(o.k):n.add(o.k); return n }) }} style={{display:'flex',alignItems:'center',gap:8,padding:'7px 8px',borderRadius:7,cursor:'pointer',background:on?C.azulBg:'transparent'}}>
                        <span style={{width:15,height:15,borderRadius:4,border:`1.5px solid ${on?C.accent:C.done}`,background:on?C.accent:C.surface,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{on&&<SIcon n='check' s={10} c='#fff'/>}</span>
                        <span style={{flex:1,minWidth:0,fontSize:12.5,fontWeight:on?700:500,color:o.k==='__sin__'?C.soonText:C.accent}}>{o.t}</span>
                        <span style={{fontSize:11,color:C.textSoft,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{c?`${c.n} · ${fmtN(c.m)}`:'0'}</span>
                      </div> })}
                  </div>
                </>}
              </div>
            : <div style={{...flBox(!!proyecto),...(faltaProyR?{border:`0.5px solid ${C.overdue}`}:{})}}><div style={flLbl}>Proyecto{faltaProyR?' *':''}</div><input value={proyecto} onChange={e=>setProyecto(e.target.value)} placeholder={faltaProyR?'Escribe el trabajo':'Opcional'} style={flInp}/></div>}
          <div style={flBox(false)}>
            <div style={flLbl}>Dirigido a</div>
            <input value={atencion} onChange={e=>{setAtencion(e.target.value);setAtencionEmail('');setPrefilled(false)}} placeholder='Persona (opcional)' style={flInp}/>
          </div>
        </div>
        {!enFondo&&proyF.size===0&&nSinProyR>0&&proyectoSugerido&&<div style={{marginBottom:6}}><button onClick={()=>setProyecto(proyectoSugerido)} style={{fontSize:10,fontWeight:600,color:C.greenText,background:C.greenBg,border:'none',borderRadius:20,padding:'2px 9px',cursor:'pointer'}}>Sugerido: {proyectoSugerido}</button></div>}
        {sug.length>0&&<div style={{display:'flex',flexWrap:'wrap',gap:6,alignItems:'center',marginBottom:8}}><span style={{fontSize:9,color:C.textSoft}}>Sugeridos:</span>{sug.map(c=><button key={c.id} onClick={()=>{setAtencion(c.nombre||c.email);setAtencionEmail(c.email||'');setPrefilled(false)}} style={{fontSize:10,border:`0.5px solid ${C.border}`,color:C.muted,background:'none',borderRadius:14,padding:'2px 9px',cursor:'pointer'}}>{c.nombre?c.nombre+' · ':''}{c.email}</button>)}</div>}
        {gastosPend.length===0 && <div style={{fontSize:10,color:C.soon,marginBottom:8}}>Esta razón social aún no tiene gastos por rendir{proyVentas.length>0?` (el proyecto viene de la venta)`:'. Cambia de razón social o ingresa gastos primero'}.</div>}
        {!showSub && !subproyecto && <div onClick={()=>setShowSub(true)} style={{fontSize:11,color:C.azulInfo,cursor:'pointer',marginBottom:12,width:'fit-content'}}>+ Subproyecto</div>}
        {(showSub||subproyecto)&&<div style={{...flBox(false),marginBottom:12}}>
          <div style={flLbl}>Subproyecto <span style={{textTransform:'none',fontWeight:400}}>(opcional)</span></div>
          <input value={subproyecto} onChange={e=>setSubproyecto(e.target.value)} placeholder='—' list='rend-subproy' style={flInp}/>
          <datalist id='rend-subproy'>{[...new Set((rendiciones||[]).filter(r=>String(r.client_id)===String(client.id)&&r.subproject).map(r=>r.subproject))].map(s=><option key={s} value={s}/>)}</datalist>
        </div>}
        </>)
      })()
  // Cifras de la rendición en UNA tarjeta, filas con el monto a la derecha (antes 3 tarjetas + un resumen aparte): lo seleccionado, fondos, ya rendido y el saldo que resulta.
  const lnR=(l,v,col,big)=><div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:10,padding:'3px 0'}}><span style={{fontSize:12,color:big?col:C.muted,fontWeight:big?700:400}}>{l}</span><span style={{fontSize:big?15:12.5,fontWeight:700,color:col||C.text,fontVariantNumeric:'tabular-nums'}}>{v}</span></div>
  const segBtn = (k,t,sub,on,dis) => <button key={k} type='button' disabled={dis} onClick={()=>elegirModo(k)} style={{flex:1,minWidth:0,border:'none',borderLeft:k!=='junto'?`1px solid ${C.border}`:'none',padding:'7px 4px',background:on?C.accent:C.surface,color:on?'#fff':(dis?C.done:C.muted),cursor:dis?'not-allowed':'pointer',fontFamily:'inherit',lineHeight:1.25}}><div style={{fontSize:11.5,fontWeight:600}}>{t}</div><div style={{fontSize:10,opacity:.85}}>{sub}</div></button>
  const bModo = multiT && (
      <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:'10px 13px',marginBottom:12}}>
        <div style={{...SEC_LBL,marginBottom:6}}>Cómo se envía · {trabajosSel.length} proyectos</div>
        {[['junto','Una rendición','1 PDF con todo'],['sep1','Una por proyecto',`${trabajosSel.length} PDF en un correo`],['sepN','Una por proyecto','un correo cada una']].map(([k,t,sub])=>{ const on=modo===k||(k==='junto'&&!['sep1','sepN'].includes(modo))
          return <div key={k} onClick={()=>elegirModo(k)} style={{display:'flex',alignItems:'center',gap:10,padding:'7px 8px',borderRadius:8,cursor:'pointer',background:on?C.azulBg:'transparent'}}>
            <span style={{width:15,height:15,borderRadius:'50%',border:on?`5px solid ${C.accent}`:`1.5px solid ${C.done}`,flexShrink:0,boxSizing:'border-box'}}/>
            <span style={{fontSize:12.5,fontWeight:on?700:500,color:on?C.accent:C.text,whiteSpace:'nowrap'}}>{t}</span><span style={{fontSize:11,color:C.textSoft,whiteSpace:'nowrap'}}>{sub}</span>
          </div> })}
        {modo!=='junto'&&!puedeSeparar&&(()=>{ const sinP=fondosRS.filter(x=>!(x.f.project||'').trim())
          const sugDe=x=>{ const c={}; x.gastos.forEach(g=>{ const k=keyP(g); if(k) c[k]=(c[k]||0)+1 }); return Object.keys(c).sort((a,b)=>c[b]-c[a])[0]||'' }
          return <div style={{borderTop:`1px solid ${C.track}`,marginTop:8,paddingTop:8}}>
            <div style={{...SEC_LBL,color:C.soonText,marginBottom:4}}>Antes de separar</div>
            <div style={{fontSize:11.5,color:C.textSoft,marginBottom:6}}>{sinP.length===1?'Este fondo no tiene proyecto: elige a cuál va.':`Estos ${sinP.length} fondos no tienen proyecto: elige a cuál va cada uno.`}</div>
            {sinP.map(x=>{ const sg=sugDe(x); return <div key={x.f.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,padding:'4px 0',flexWrap:'wrap'}}>
              <span style={{fontSize:12,color:C.text,whiteSpace:'nowrap',fontVariantNumeric:'tabular-nums'}}>Fondo {fmtFechaDMY(x.f.date)} · {fmtN(x.f.amount)}</span>
              <span style={{display:'inline-flex',gap:6,alignItems:'center'}}>
                {sg&&<button type='button' onClick={()=>asignarProyFondo(x.f,sg)} style={{fontSize:10.5,fontWeight:600,color:C.greenText,background:C.greenBg,border:'none',borderRadius:20,padding:'2px 9px',cursor:'pointer',whiteSpace:'nowrap'}}>Sugerido: {sg}</button>}
                <select value='' onChange={ev=>{ if(ev.target.value) asignarProyFondo(x.f,ev.target.value) }} style={{...chipSty(true),fontSize:11}}><option value=''>Elegir proyecto</option>{proyectosDisp.map(p=><option key={p} value={p}>{p}</option>)}</select>
              </span>
            </div> })}
          </div> })()}
        <div style={{marginTop:8}}>{porT.map((o,i)=><div key={o.t} style={{borderTop:`1px solid ${C.track}`,padding:'7px 0 3px'}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'baseline'}}><span style={{fontSize:12.5,fontWeight:700,color:C.accent,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{modoEf!=='junto'?`N° ${nextCorr+i} · `:''}{o.t}</span><span style={{fontSize:12.5,fontWeight:700,color:o.saldo<0?C.overdueText:C.greenText,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{o.saldo<0?'−':'+'}{fmtN(Math.abs(o.saldo))}</span></div>
          <div style={{fontSize:11.5,color:C.textSoft,display:'flex',justifyContent:'space-between',gap:8}}><span>fondos {fmtN(o.f.totFondos)}{o.f.rendido?` · ya rendido ${fmtN(o.f.rendido)}`:''} · {o.gs.length} gasto{o.gs.length!==1?'s':''} {fmtN(o.tg)}</span>{modoEf!=='junto'&&<button type='button' onClick={()=>verPdfVirtual(virtuales()[i])} style={{fontSize:11,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',padding:0,whiteSpace:'nowrap'}}>Ver PDF</button>}</div>
        </div>)}</div>
      </div>
  )
  const _uno = porTrabajoUno&&porT[0]
  // ── Qué se rinde (solo con 2+ fondos): gastos (por proyecto) o un fondo entregado (lo que cubrió).
  const pendFondo = x => x.gastos.filter(g=>g.type==='gasto'&&!g.client_rendered_at&&inScope(g))
  const elegirFondo = x => { setModoR('fondo'); setFondoSel(x.f.id); setAddSinFondo(false); setWipRec(false); setSelected(new Set(pendFondo(x).map(g=>g.id))) }
  const totPendG = (cntProy.__todos||{n:0,m:0})
  const totFondosRS = fondosRS.reduce((a,x)=>a+(Number(x.f.amount)||0),0)
  const cardModo = (k,ic,bg,col,t,sub,der,on,onClick) => <div key={k} onClick={onClick} style={{display:'flex',alignItems:'center',gap:isDesktop?10:8,background:C.surface,border:`1px solid ${on?C.accent:C.border}`,boxShadow:on?`inset 0 0 0 1px ${C.accent}`:'none',borderRadius:12,padding:isDesktop?'11px 13px':'9px 10px',cursor:'pointer',minWidth:0}}>
      <span style={{width:isDesktop?34:28,height:isDesktop?34:28,borderRadius:9,background:bg,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SIcon n={ic} s={isDesktop?17:15} c={col}/></span>
      <span style={{minWidth:0,flex:1}}><span style={{display:'block',fontSize:isDesktop?13.5:12.5,fontWeight:700,color:C.accent,whiteSpace:'nowrap'}}>{t}</span><span style={{fontSize:11.5,color:C.textSoft,whiteSpace:'nowrap'}}>{isDesktop?sub:der}</span></span>
      {isDesktop&&<span style={{fontSize:13,fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{der}</span>}
    </div>
  const bElegir = verModoFondo && (
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:isDesktop?10:8,marginBottom:14}}>
        {cardModo('g','receipt',C.azulBg,C.accent,'Rendir gastos','Marcar gastos por rendir, por proyecto',`${totPendG.n} · ${fmtN(totPendG.m)}`,!enFondo,()=>{ if(enFondo){ setModoR('gastos'); setFondoSel(null); setSelected(new Set()) } })}
        {cardModo('f','tFavor',C.greenBg,C.greenText,'Rendir un fondo','Elegir el fondo y rendir lo que cubrió',`${fondosRS.length} · ${fmtN(totFondosRS)}`,enFondo,()=>{ if(!enFondo){ const x=fondosRS.find(y=>pendFondo(y).length)||fondosRS[fondosRS.length-1]; if(x) elegirFondo(x) } })}
      </div>)
  const bFondos = enFondo && (
      <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:6,marginBottom:12}}>
        <div style={{...SEC_LBL,padding:'4px 6px 6px'}}>Fondos entregados</div>
        {fondosRS.map((x,i)=>{ const on=String(x.f.id)===String(fondoSel), np=pendFondo(x).length
          return <div key={x.f.id} onClick={()=>!on&&!esEdicion&&elegirFondo(x)} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 10px',borderTop:i&&!on?`1px solid ${C.track}`:'1px solid transparent',background:on?C.azulBg:'transparent',borderRadius:8,cursor:on?'default':'pointer'}}>
            <span style={{width:15,height:15,borderRadius:'50%',border:on?`5px solid ${C.accent}`:`1.5px solid ${C.done}`,flexShrink:0,boxSizing:'border-box'}}/>
            <span style={{flex:1,minWidth:0}}>
              {x.f.project
                ? <span style={{display:'block',fontSize:12.5,fontWeight:on?700:500,color:C.accent}}>{x.f.project}</span>
                : <select value='' onClick={_stop} onChange={ev=>{ _stop(ev); if(ev.target.value) asignarProyFondo(x.f,ev.target.value) }} style={{...chipSty(true),fontSize:11}}><option value=''>Asignar proyecto</option>{proyectosDisp.map(p=><option key={p} value={p}>{p}</option>)}</select>}
              <span style={{display:'block',fontSize:10.5,color:C.textSoft,marginTop:1}}>{fmtFechaDMY(x.f.date)} · {np?`${np} gasto${np!==1?'s':''} por rendir`:'sin gastos por rendir'}</span>
            </span>
            <span style={{textAlign:'right',flexShrink:0,fontVariantNumeric:'tabular-nums'}}>
              <span style={{display:'block',fontSize:13,fontWeight:700,color:C.text}}>{fmtN(x.f.amount)}</span>
              <span style={{fontSize:10.5,color:x.quedan<0?C.overdueText:C.textSoft}}>{x.quedan<0?`excedido ${fmtN(-x.quedan)}`:`queda ${fmtN(x.quedan)}`}</span>
            </span>
          </div> })}
      </div>)
  // Cuadratura del cliente con el reparto (fuente única): Σ fondos − gastos = saldo de la ficha. Si alguna vez no calza, se avisa.
  const _fgC = fgCliente(expenses, client.id), _cuadra = Math.round(_fgC.saldo)===Math.round(repF.saldo)
  const bCuadra = verModoFondo && (
      <div style={{display:'flex',justifyContent:'space-between',gap:8,fontSize:11.5,color:C.textSoft,padding:'8px 12px',background:C.bgSoft,borderRadius:9,marginBottom:12,flexWrap:'wrap'}}>
        <span style={{fontVariantNumeric:'tabular-nums'}}>Fondos <b style={{color:C.text}}>{fmtN(_fgC.fondos)}</b> − gastos <b style={{color:C.text}}>{fmtN(_fgC.gastos)}</b> = <b style={{color:C.text}}>{fmtSaldoG(_fgC.saldo)}</b></span>
        <span style={{fontWeight:700,color:_cuadra?C.greenText:C.overdueText}}>{_cuadra?'igual a la ficha':`no cuadra con la ficha (${fmtSaldoG(repF.saldo)})`}</span>
      </div>)
  const bKPIs = (
      <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:'10px 13px',marginBottom:12}}>
        <div style={{...lblG,marginBottom:4}}>{enFondo?`Este fondo · ${fmtFechaDMY(fondoObj?.date)}`:_uno?`Este trabajo · ${_uno.t}`:'Esta rendición'}</div>
        {lnR(`${gastosSel.length} gasto${gastosSel.length!==1?'s':''} seleccionado${gastosSel.length!==1?'s':''}`, fmtN(totalSel), gastosSel.length?C.text:C.muted)}
        {lnR(enFondo?'Fondo entregado':_uno?'Fondos de este trabajo':'Fondos', fmtN(_uno?_uno.f.totFondos:fondosDisp))}
        {lnR(enFondo?'Ya rendido de este fondo':'Ya rendido', fmtN(_uno?_uno.f.rendido:_fondoRend.rendido))}
        {(()=>{ const sal=_uno?_uno.saldo:saldoTrasRendicion; return <div style={{borderTop:`1px solid ${C.track}`,marginTop:4,paddingTop:5}}>{lnR(sal<0?'Saldo a cargo del cliente':'Saldo a favor del cliente', fmtN(Math.abs(sal)), sal<0?C.overdueText:C.greenText, true)}</div> })()}
        {_uno&&fondosDisp>_uno.f.totFondos&&<div style={{fontSize:11.5,color:C.textSoft,marginTop:4}}>Otros {fmtN(fondosDisp-_uno.f.totFondos)} en fondos del cliente están asignados a otro trabajo.</div>}
      </div>
  )
  const nDupR = disponibles.filter(e=>dupRend.has(e.id)).length
  // Chips del gasto: su proyecto y su fondo, ambos se corrigen tocándolos (no marcan ni desmarcan el gasto).
  const chipsG = e => { const k=keyP(e), opts=[...new Set([...(k?[k]:[]),...proyectosDisp])], dF=repF.deGasto[e.id]||''
    return (<>
      {(opts.length>0)&&<select value={k} onClick={_stop} onChange={ev=>{ _stop(ev); asignarProyGasto(e,ev.target.value) }} title='Proyecto del gasto' style={chipSty(!k)}>{!k&&<option value=''>Sin proyecto</option>}{opts.map(o=><option key={o} value={o}>{o}</option>)}</select>}
      {fondosRS.length>=2&&<select value={dF} onClick={_stop} onChange={ev=>{ _stop(ev); const v=ev.target.value; moverAFondo(e,v&&v!=='__auto'?v:null) }} title='Fondo que cubre el gasto' style={chipSty(!dF)}>{!dF?<option value=''>Sin fondo</option>:e.reembolso_fondo_id?<option value='__auto'>Reparto automático</option>:null}{fondosRS.map(x=><option key={x.f.id} value={x.f.id}>{`Fondo ${fmtFechaDMY(x.f.date)} · ${fmtN(x.f.amount)}`}</option>)}</select>}
    </>) }
  // Lista agrupada por proyecto cuando se ven varios (Todos o varios marcados); «Sin proyecto» al final.
  const gruposL = (()=>{ if(enFondo||proyecto) return null; const m=new Map(); disponibles.forEach(e=>{ const k=keyP(e); if(!m.has(k)) m.set(k,[]); m.get(k).push(e) })
    if(m.size<2) return null; const ordK=k=>k?(proyectosDisp.indexOf(k)<0?999:proyectosDisp.indexOf(k)):1e6
    return [...m.entries()].sort((a,b)=>ordK(a[0])-ordK(b[0])).map(([k,gs])=>({k,gs,tot:gs.reduce((a,e)=>a+(Number(e.amount)||0),0)})) })()
  const toggleGrupo = gr => setSelected(p=>{ const n=new Set(p), todos=gr.gs.every(e=>n.has(e.id)); gr.gs.forEach(e=>todos?n.delete(e.id):n.add(e.id)); return n })
  const asignarTodosSin = async(gs,pr) => { for(const e of gs){ await asignarProyGasto(e,pr) } }
  const filaG = e => {
    const isSel=selected.has(e.id)
    const catBg=CATS[e.category]||CATS['Otro']
    return (
      <div key={e.id} onClick={()=>toggleOne(e.id)}
        style={{background:isSel?C.azulBg:'#fff',borderRadius:8,padding:'8px 10px',marginBottom:5,
          border:`1px solid ${isSel?C.accent:C.border}`,cursor:'pointer',display:'flex',alignItems:'center',gap:8}}>
        <div style={{width:16,height:16,borderRadius:4,border:`2px solid ${isSel?C.accent:C.done}`,
          background:isSel?C.accent:'#fff',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
          {isSel&&<span style={{color:'#fff',fontSize:10}}><Gl n='tick'/></span>}
        </div>
        <div style={{flex:1,minWidth:0}}>
          {editDet?.id===e.id
            ? <input autoFocus value={editDet.v} onFocus={ev=>ev.target.select()} onClick={ev=>ev.stopPropagation()} onChange={ev=>setEditDet({id:e.id,v:ev.target.value})} onBlur={guardarDetalle}
                onKeyDown={ev=>{ if(ev.key==='Enter'){ ev.preventDefault(); ev.currentTarget.blur() } else if(ev.key==='Escape'){ ev.preventDefault(); setEditDet(null) } }}
                style={{width:'100%',boxSizing:'border-box',fontSize:12,fontWeight:500,color:C.text,border:`1px solid ${C.accent}`,borderRadius:6,padding:'4px 6px',outline:'none',background:'#fff',fontFamily:'inherit'}}/>
            : <div onClick={ev=>{ ev.stopPropagation(); setEditDet({id:e.id,v:e.concept||''}) }} title='Editar el detalle' style={{fontSize:12,fontWeight:500,color:C.text,cursor:'text',textDecoration:'underline dotted',textDecorationColor:C.border,textUnderlineOffset:3}}>{e.concept||'—'}</div>}
          <div style={{fontSize:10,color:C.muted,marginTop:1,display:'flex',flexWrap:'wrap',gap:'3px 5px',alignItems:'center'}}>
            {e.date&&<span>{fmtFechaDMY(e.date)}</span>}
            {e.category&&<span style={{padding:'2px 8px',borderRadius:20,background:catBg,color:C.muted,fontWeight:700,fontSize:9.5,whiteSpace:'nowrap'}}>{e.category}</span>}
            {chipsG(e)}
            {dupRend.has(e.id)&&(()=>{ const r=dupRend.get(e.id); return <span title={`Mismo monto y fecha que «${r.concept||'—'}»${r.client_rendered_at?' (ya rendido)':''}`} style={{padding:'2px 8px',borderRadius:20,background:C.overdueBg,color:C.overdueText,fontWeight:700,fontSize:9.5,whiteSpace:'nowrap'}}>{r.client_rendered_at?'Posible duplicado · ya rendido':'Posible duplicado'}</span> })()}
          </div>
        </div>
        <div style={{fontSize:13,fontWeight:600,color:C.text,flexShrink:0,fontVariantNumeric:'tabular-nums'}}>{fmtN(e.amount)}</div>
      </div>
    )
  }
  const bLista = (<>
      {!isDesktop&&nDupR>0&&<div style={{fontSize:11.5,fontWeight:700,color:C.overdueText,marginBottom:6}}>{nDupR} posible{nDupR!==1?'s':''} duplicado{nDupR!==1?'s':''}</div>}
      {wipRec&&gastosSel.length>0&&<div style={{display:'flex',alignItems:'center',gap:8,background:C.azulBg,borderRadius:8,padding:'7px 10px',marginBottom:8}}>
        <span style={{flex:1,minWidth:0,fontSize:11.5,color:C.accent,fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>Selección recuperada · {gastosSel.length} gasto{gastosSel.length!==1?'s':''}</span>
        <button onClick={()=>{ setSelected(new Set()); setWipRec(false) }} style={{fontSize:11.5,fontWeight:600,color:C.accent,background:'none',border:'none',cursor:'pointer',padding:0,flexShrink:0}}>Descartar</button>
      </div>}
      {enFondo&&(()=>{ const nSin=repF.sinFondo.filter(g=>g.type==='gasto'&&!g.client_rendered_at&&inScope(g)).length
        return <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,marginBottom:6}}>
          <span style={{fontSize:11,color:C.muted}}>Gastos del fondo del {fmtFechaDMY(fondoObj?.date)}</span>
          {nSin>0&&<button onClick={()=>setAddSinFondo(v=>!v)} style={{fontSize:10.5,color:C.accent,background:'none',border:'none',cursor:'pointer',fontWeight:700,whiteSpace:'nowrap'}}>{addSinFondo?'Ocultar los sin fondo':`Agregar gastos sin fondo (${nSin})`}</button>}
        </div> })()}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <span style={{fontSize:11,color:C.muted}}>{disponibles.length} gastos disponibles{isDesktop&&nDupR>0&&<b style={{color:C.overdueText,fontWeight:700}}> · {nDupR} posible{nDupR!==1?'s':''} duplicado{nDupR!==1?'s':''}</b>}</span>
          {!enFondo&&<button onClick={()=>setShowFiltroFecha(v=>!v)} style={{fontSize:10,color:(fDesde||fHasta)?C.accent:C.azulInfo,background:'none',border:'none',cursor:'pointer'}}>Filtrar por fecha{(fDesde||fHasta)?' ·':''} {showFiltroFecha?<Gl n='chevU'/>:<Gl n='chevD'/>}</button>}
        </div>
        {disponibles.length>0&&<button onClick={toggleAll} style={{fontSize:10,color:C.accent,background:'none',border:'none',cursor:'pointer',fontWeight:600}}>
          {disponibles.length&&gastosSel.length===disponibles.length?'Desmarcar todo':'Seleccionar todo'}
        </button>}
      </div>
      {showFiltroFecha&&!enFondo&&<div style={{display:'flex',gap:6,marginBottom:8,alignItems:'center'}}>
        <input type='date' value={fDesde} onChange={e=>setFDesde(e.target.value)} style={{flex:1,padding:'5px 8px',borderRadius:6,border:`0.5px solid ${C.border}`,fontSize:11,outline:'none'}}/>
        <span style={{fontSize:11,color:C.muted}}>→</span>
        <input type='date' value={fHasta} onChange={e=>setFHasta(e.target.value)} style={{flex:1,padding:'5px 8px',borderRadius:6,border:`0.5px solid ${C.border}`,fontSize:11,outline:'none'}}/>
        {(fDesde||fHasta)&&<button onClick={()=>{setFDesde('');setFHasta('')}} style={{fontSize:10,color:C.muted,background:'none',border:'none',cursor:'pointer'}}><Gl n='x'/></button>}
      </div>}
      {disponibles.length===0&&(gastosPend.length>0&&(proyF.size>0||fDesde||fHasta)
        ? <div style={{textAlign:'center',padding:20,fontSize:12,color:C.muted}}>
            Hay {gastosPend.length} gasto{gastosPend.length!==1?'s':''} pendiente{gastosPend.length!==1?'s':''} de rendir, pero el filtro los está ocultando.
            <button onClick={()=>{setProyecto('');setFDesde('');setFHasta('')}} style={{display:'block',margin:'8px auto 0',fontSize:11,fontWeight:600,color:C.accent,background:C.azulBg,border:'none',borderRadius:20,padding:'5px 12px',cursor:'pointer'}}>Ver todos los proyectos</button>
          </div>
        : <div style={{color:C.muted,textAlign:'center',padding:20,fontSize:12}}>No hay gastos pendientes de rendir</div>)}
      <div style={{maxHeight:isDesktop?'calc(100vh - 320px)':(gruposL?460:280),overflowY:'auto',marginBottom:12}}>
        {gruposL ? gruposL.map(gr=>(<Fragment key={gr.k||'__sin__'}>
            <div onClick={()=>toggleGrupo(gr)} style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:8,margin:'10px 2px 5px',cursor:'pointer'}}>
              <span style={{fontSize:10.5,fontWeight:700,letterSpacing:.5,textTransform:'uppercase',color:gr.k?C.accent:C.soonText,minWidth:0}}>{gr.k||'Sin proyecto'}</span>
              <span style={{fontSize:11.5,fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{gr.gs.length} · {fmtN(gr.tot)}</span>
            </div>
            {!gr.k&&proyectoSugerido&&<button onClick={()=>asignarTodosSin(gr.gs,proyectoSugerido)} style={{fontSize:10.5,fontWeight:600,color:C.greenText,background:C.greenBg,border:'none',borderRadius:20,padding:'2px 9px',cursor:'pointer',margin:'0 0 6px 2px'}}>Asignar {gr.gs.length===1?'a':'los '+gr.gs.length+' a'} {proyectoSugerido}</button>}
            {gr.gs.map(filaG)}
          </Fragment>)) : disponibles.map(filaG)}
      </div>
  </>)
  const bResumen = null
  const bIA = selected.size>0&&<button onClick={mejorarDescripcionesIA} disabled={limpiandoIA} style={{...chipBtn('soft'),width:'100%',marginBottom:8,opacity:limpiandoIA?.6:1}}>{limpiandoIA?'Mejorando descripciones…':'Mejorar descripciones con IA'}</button>
  const bExterna = !esEdicion&&(extOpen
        ? <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginTop:8,padding:'8px 10px',background:C.bgSoft,border:`1px solid ${C.border}`,borderRadius:10}}>
            <span style={{fontSize:12,color:C.muted}}>Rendida por fuera el</span>
            <input type='date' value={extFecha} onChange={e=>setExtFecha(e.target.value)} style={{fontSize:12,padding:'5px 7px',border:`1px solid ${C.border}`,borderRadius:7,color:C.text}}/>
            <input value={extLink} onChange={e=>setExtLink(e.target.value)} placeholder='Enlace al correo (opcional)' style={{flex:'1 1 160px',minWidth:0,fontSize:12,padding:'5px 8px',border:`1px solid ${C.border}`,borderRadius:7,color:C.text}}/>
            <button disabled={!puedeRendir||saving||!extFecha} onClick={handleExterna} style={{fontSize:12,fontWeight:700,padding:'6px 12px',borderRadius:8,border:'none',background:puedeRendir?C.accent:C.done,color:'#fff',cursor:puedeRendir?'pointer':'not-allowed'}}>{saving?'…':'Registrar'}</button>
            <button onClick={()=>setExtOpen(false)} style={{fontSize:12,background:'none',border:'none',color:C.textSoft,cursor:'pointer'}}>Cancelar</button>
          </div>
        : <button onClick={()=>setExtOpen(true)} disabled={!puedeRendir} style={{marginTop:8,background:'none',border:'none',padding:0,color:puedeRendir?C.accent:C.done,fontSize:12,fontWeight:600,cursor:puedeRendir?'pointer':'not-allowed'}}>Ya la rendí por fuera de la app</button>)
  const bBotones = navBorr&&!esEdicion ? (<>
      {faltaProyR&&<div style={{fontSize:11.5,color:C.overdueText,background:C.overdueBg,borderRadius:8,padding:'7px 10px',marginBottom:8}}>{nSinProyR===1?'1 gasto seleccionado no tiene proyecto':`${nSinProyR} gastos seleccionados no tienen proyecto`}: elige a cuál van para poder rendir.</div>}
      <button disabled={!puedeRendir||saving} onClick={()=>handleGenerar('borrador')}
        style={{width:'100%',padding:'11px 14px',borderRadius:10,border:'none',background:puedeRendir?C.accent:C.done,color:'#fff',fontSize:13.5,fontWeight:700,cursor:puedeRendir?'pointer':'not-allowed'}}>
        {saving?'Guardando…':(navBorr.i<navBorr.n-1?'Guardar borrador y continuar':'Guardar borrador')}
      </button>
      <div style={{display:'flex',gap:8,marginTop:8}}>
        {modoEf==='junto'&&<button disabled={!puedeRendir||saving} onClick={()=>handleGenerar('pdf')} style={{flex:1,padding:'9px 10px',borderRadius:10,border:`1px solid ${C.border}`,background:'#fff',color:puedeRendir?C.accent:C.done,fontSize:13,fontWeight:600,cursor:puedeRendir?'pointer':'not-allowed',whiteSpace:'nowrap'}}>Ver PDF</button>}
        <button disabled={!puedeRendir||saving} onClick={()=>handleGenerar('correo')} style={{flex:1,padding:'9px 10px',borderRadius:10,border:`1px solid ${C.border}`,background:'#fff',color:puedeRendir?C.accent:C.done,fontSize:13,fontWeight:600,cursor:puedeRendir?'pointer':'not-allowed',whiteSpace:'nowrap'}}>Continuar al correo →</button>
      </div>
      {bExterna}
  </>) : (<>
      {faltaProyR&&<div style={{fontSize:11.5,color:C.overdueText,background:C.overdueBg,borderRadius:8,padding:'7px 10px',marginBottom:8}}>{nSinProyR===1?'1 gasto seleccionado no tiene proyecto':`${nSinProyR} gastos seleccionados no tienen proyecto`}: elige a cuál van para poder rendir.</div>}
      <div style={{display:'flex',gap:8}}>
        {!asPage&&<button onClick={onClose} style={{flex:1,padding:'9px 14px',borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>}
        {esEdicion ? (
          <button disabled={!puedeRendir||saving} onClick={handleGuardarEdicion}
            style={{flex:3,padding:'9px 14px',borderRadius:10,border:'none',background:puedeRendir?C.accent:C.done,color:'#fff',fontSize:13,fontWeight:700,cursor:puedeRendir?'pointer':'not-allowed'}}>
            {saving?'Guardando…':'Guardar cambios'}
          </button>
        ) : (<>
        {modoEf==='junto'&&<button disabled={!puedeRendir||saving} onClick={()=>handleGenerar('pdf')}
          style={{flex:1,padding:'9px 10px',borderRadius:10,border:`1px solid ${C.border}`,background:'#fff',color:puedeRendir?C.accent:C.done,fontSize:13,fontWeight:600,cursor:puedeRendir?'pointer':'not-allowed',whiteSpace:'nowrap'}}>
          Ver PDF
        </button>}
        <button disabled={!puedeRendir||saving} onClick={()=>handleGenerar('borrador')}
          style={{flex:1.2,padding:'9px 10px',borderRadius:10,border:'none',background:C.azulBg,color:puedeRendir?C.accent:C.done,fontSize:13,fontWeight:700,cursor:puedeRendir?'pointer':'not-allowed',whiteSpace:'nowrap'}}>
          {saving?'Guardando…':'Guardar borrador'}
        </button>
        </>)}
      </div>
      {!esEdicion&&<button disabled={!puedeRendir||saving} onClick={()=>handleGenerar('correo')}
        style={{width:'100%',marginTop:10,padding:'11px 14px',borderRadius:10,border:'none',background:puedeRendir?C.normal:C.done,color:'#fff',fontSize:13.5,fontWeight:700,cursor:puedeRendir?'pointer':'not-allowed'}}>
        Continuar al correo →
      </button>}
      {bExterna}
  </>)

  // Recorrer los borradores preparados sin volver a la lista (escritorio: arriba a la derecha · celular: al pie).
  const _navBtn = (dir,dis) => <button onClick={ev=>{ ev.stopPropagation(); if(!saving) (dir<0?navBorr.onPrev:navBorr.onNext)() }} disabled={dis||saving} aria-label={dir<0?'Anterior':'Siguiente'} style={{width:26,height:26,borderRadius:13,border:`1px solid ${C.border}`,background:C.surface,color:dis?C.done:C.accent,display:'inline-flex',alignItems:'center',justifyContent:'center',cursor:dis?'default':'pointer',padding:0,flexShrink:0}}><Gl n={dir<0?'chevL':'chevron'}/></button>
  const bNav = navBorr&&!esEdicion&&(isDesktop
    ? <span style={{display:'inline-flex',alignItems:'center',gap:8,fontSize:12,color:C.muted,background:C.surface,border:`1px solid ${C.border}`,borderRadius:20,padding:'3px 4px 3px 12px',whiteSpace:'nowrap'}}>Borrador <b style={{color:C.accent}}>{navBorr.i+1} de {navBorr.n}</b>{_navBtn(-1,navBorr.i<=0)}{_navBtn(1,navBorr.i>=navBorr.n-1)}</span>
    : <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,marginTop:12,background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:'6px 8px'}}>
        <span onClick={()=>!saving&&navBorr.i>0&&navBorr.onPrev()} style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:12,fontWeight:600,color:navBorr.i>0?C.accent:C.done,cursor:'pointer'}}>{_navBtn(-1,navBorr.i<=0)}Anterior</span>
        <span style={{fontSize:12,color:C.muted,whiteSpace:'nowrap'}}>Borrador <b style={{color:C.accent}}>{navBorr.i+1} de {navBorr.n}</b></span>
        <span onClick={()=>!saving&&navBorr.i<navBorr.n-1&&navBorr.onNext()} style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:12,fontWeight:600,color:navBorr.i<navBorr.n-1?C.accent:C.done,cursor:'pointer'}}>Siguiente{_navBtn(1,navBorr.i>=navBorr.n-1)}</span>
      </div>)
  // Desktop: maestro-detalle (lista | documento). Móvil: apilado en el orden de hoy. Misma JSX, dos arreglos.
  return isDesktop ? (
    <div>
      {!esEdicion&&(bNav?<div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:12}}><PasosRend paso={1}/>{bNav}</div>:<PasosRend paso={1}/>)}
      {bElegir}
      <div style={{display:'grid',gridTemplateColumns:'minmax(0,1.55fr) minmax(0,1fr)',gap:22,alignItems:'start'}}>
        <div style={{minWidth:0}}>{bFondos}{bLista}</div>
        <div style={{minWidth:0}}>{bContinuidad}{bRS}{bProyecto}{bModo}{bKPIs}{bCuadra}{bResumen}{bIA}{bBotones}</div>
      </div>
    </div>
  ) : (
    <div>
      {!esEdicion&&<PasosRend paso={1}/>}
      {bElegir}{bContinuidad}{bFondos}{bRS}{bProyecto}{bKPIs}{bLista}{bModo}{bCuadra}{bResumen}{bIA}{bBotones}{bNav}
    </div>
  )
}

// Popup de correo para enviar una rendición al cliente (mailto + marca sent_at)
// Correo de DEVOLUCIÓN de fondos: mismo motor/formato que la rendición (logo, firma, destinatarios desde
// contactos + CC aprendido), pero adjuntando el COMPROBANTE de transferencia en vez del PDF de rendición.
export function DevolucionEmailModal({client, rend, rendN, amount, fecha, user, onClose, setRendiciones, asPage=false}){
  const isDesktop=useIsDesktop()
  const myEmail=(user?.email||'').toLowerCase()
  const EMAIL_BY_NAME=equipoPorNombre()
  const toEmail=x=>{ if(!x) return null; const s=String(x).trim(); return s.includes('@')?s.toLowerCase():(EMAIL_BY_NAME[s]||null) }
  const corr=rend?.correlativo||rendN||''
  const [para,setPara]=useState(rend?.dirigido_email||client?.email||'')
  const [cc,setCc]=useState([])
  const [ccInput,setCcInput]=useState('')
  const [studioOn,setStudioOn]=useState(true)
  const studioEmails=useMemo(()=>{ const set=new Set(); const resp=toEmail(client?.abogado_responsable); if(resp) set.add(resp); set.delete(myEmail); return [...set] },[client?.abogado_responsable,myEmail])
  const [fichaContacts,setFichaContacts]=useState([])
  const [firma,setFirma]=useState(firmaDefault(myEmail)||{nombre:user?.name||'',cargo:'Abogado',telefono:''})
  const [comp,setComp]=useState(null)   // comprobante: {name,mime,b64}
  const [sending,setSending]=useState(false)
  const asunto=`Devolución de fondos${corr?` · Rendición N° ${corr}`:''} — ${client?.name||''}`
  const [body,setBody]=useState(`Estimado ${(client?.name||'').split(' ')[0]},\n\nEspero que estés muy bien. Como complemento a la Rendición N° ${corr} que te enviamos, te confirmamos la devolución del saldo a favor por ${fmt(amount)}, correspondiente a los fondos no utilizados de dicha rendición.\n\nLa transferencia se realizó con fecha ${fmtFechaDMY(fecha)}. Adjuntamos el comprobante para tu registro.\n\nQuedamos atentos a cualquier consulta.\n\nSaludos cordiales,`)
  useEffect(()=>{ if(!client?.id) return; let alive=true
    supabase.from('contacts').select('nombre,email').eq('client_id',client.id).then(({data})=>{ if(alive) setFichaContacts((data||[]).filter(c=>c.email)) },()=>{})
    // "Para" = el destinatario real de la rendición (dirigido_email; si no, el último "Para" aprendido del cliente).
    if(!rend?.dirigido_email) supabase.from('learnings').select('value').eq('kind','rendicion_para').eq('key',String(client.id)).maybeSingle().then(({data})=>{ if(alive&&data&&data.value) setPara(p=>(!p||p===(client?.email||''))?String(data.value).trim():p) },()=>{})
    supabase.from('learnings').select('value').eq('kind','rendicion_cc').eq('key',String(client.id)).maybeSingle().then(({data})=>{ if(alive&&data&&data.value){ const ems=String(data.value).split(/[,;]/).map(s=>s.trim().toLowerCase()).filter(Boolean); setCc(prev=>[...new Set([...prev,...ems])]) } },()=>{})
    return ()=>{alive=false}
  },[client?.id])
  useEffect(()=>{ if(!myEmail) return; let alive=true
    supabase.from('learnings').select('value').eq('kind','firma_correo').eq('key',myEmail).order('updated_at',{ascending:false}).limit(1).maybeSingle().then(({data})=>{ if(alive&&data&&data.value){ try{ setFirma(prev=>({...prev,...JSON.parse(data.value)})) }catch(_){} } },()=>{})
    return ()=>{alive=false}
  },[myEmail])
  const addCc=em=>{ const e=String(em||'').trim().toLowerCase(); if(e&&e.includes('@')&&!cc.includes(e)&&e!==(para||'').toLowerCase()) setCc(p=>[...p,e]); setCcInput('') }
  const removeCc=em=>setCc(p=>p.filter(x=>x!==em))
  const onFile=ev=>{ const f=ev.target.files&&ev.target.files[0]; if(!f) return; const rd=new FileReader(); rd.onload=()=>setComp({name:f.name,mime:f.type||'application/octet-stream',b64:String(rd.result).replace(/^data:[^,]+,/,'')}); rd.readAsDataURL(f) }
  const buildHtml=(text,useCid=true)=>{
    const A='#003C50',A4='#E4E8EB',MUTED='#537281',BG='#F7F9FA'
    const logoW=useCid?'cid:lealogow':`${location.origin}${BRAND.logo.blanco}`
    const logoC=useCid?'cid:lealogoc':`${location.origin}${BRAND.logo.color}`
    const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    let out='',box=[]
    const flush=()=>{ if(box.length){ out+=`<div style="background-color:${BG};border:1px solid ${A4};border-radius:8px;padding:12px 16px;margin:12px 0;font-size:13px;line-height:1.8">${box.map(l=>{ const i=l.indexOf(':'); return i>0?`<div><span style="color:${MUTED}">${esc(l.slice(0,i))}:</span> <strong style="color:${A}">${esc(l.slice(i+1).trim())}</strong></div>`:`<div>${esc(l)}</div>` }).join('')}</div>`; box=[] } }
    String(text).split('\n').forEach(l=>{ if(/^\s{2,}\S/.test(l)) box.push(l.trim()); else { flush(); out+= l.trim()?`<p style="margin:0 0 10px">${esc(l)}</p>`:'' } }); flush()
    return `<div style="font-family:'DM Sans',Arial,Helvetica,sans-serif;color:#3D3D3D;font-size:14px;line-height:1.6;max-width:600px;margin:0 auto"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tbody><tr><td bgcolor="${A}" style="background-color:${A};padding:18px 24px"><table width="100%"><tbody><tr><td style="vertical-align:middle"><img src="${logoW}" alt="${BRAND.nombre}" style="height:26px;display:block"/></td><td style="text-align:right;vertical-align:middle;color:#fff;font-size:12px;font-weight:600">Devolución de fondos${corr?` · Rendición N° ${corr}`:''}</td></tr></tbody></table></td></tr></tbody></table><div style="padding:24px;border:1px solid ${A4};border-top:none">${out}${firmaCorreoHtml(firma,logoC,'es')}</div></div>`
  }
  const enviar=async()=>{
    if(!para.trim()){ appAlert('Falta el destinatario (Para).'); return }
    if(!comp && !await appConfirm('No adjuntaste el comprobante de transferencia. ¿Enviar igual?')) return
    setSending(true)
    const _strip=u=>String(u||'').replace(/^data:[^,]+,/,'')
    const logosInline=[{cid:'lealogow',b64:_strip(logoBlanco),mime:'image/png'},{cid:'lealogoc',b64:_strip(logoColor),mime:'image/png'}]
    const ccStr=[...cc,...(studioOn?studioEmails:[])].filter(e=>e&&e.toLowerCase()!==(para||'').trim().toLowerCase()).join(', ')
    const atts=comp?[{base64:comp.b64,name:comp.name,mime:comp.mime}]:[]
    let sent=false,err=null,via=null
    try{ const token=await driveToken(); if(token){ await sendGmailWithPdf(token,{to:para.trim(),cc:ccStr,subject:asunto,bodyText:body,bodyHtml:buildHtml(body,true),inlineImages:logosInline,attachments:atts}); sent=true; via='usuario' } }catch(e){ err=e }
    if(!sent){
      if(!await appConfirm(MAIL_OFICINA_CONFIRM)){ setSending(false); avisoNoEnviado('La devolución de fondos'); return }
      try{ await sendMailServer({to:para.trim(),cc:ccStr,subject:asunto,html:buildHtml(body,false),text:body,attachments:atts}); sent=true; via='oficina' }catch(e2){ err=e2 }
    }
    setSending(false)
    if(sent){ try{ if(cc.length) await setLearningKV('rendicion_cc',String(client.id),cc.join(', ')) }catch(e){registrarError({origen:'accion',vista:'rendicion_para',err:e})} try{ if((para||'').trim()) await setLearningKV('rendicion_para',String(client.id),para.trim()) }catch(e){registrarError({origen:'accion',vista:'rendicion_para',err:e})}
      // Registrar el envío de la devolución en la rendición → chip "Devolución enviada" en el historial.
      try{ if(rend?.id){ const now=new Date().toISOString(); if(!okDB(await supabase.from('rendiciones').update({devolucion_at:now}).eq('id',rend.id),'registrar el envío de la devolución')) throw new Error('devolucion'); setRendiciones&&setRendiciones(p=>p.map(x=>x.id===rend.id?{...x,devolucion_at:now}:x)) } }catch(e){registrarError({origen:'accion',vista:'rendiciones',err:e})}
      appAlert(txtEnviado(via,{que:'Aviso de devolución de fondos', para:[para.trim(),...cc].filter(Boolean).join(', ')})+(comp?'\nCon el comprobante adjunto.':''))
      onClose&&onClose() }
    else avisoNoEnviado('La devolución de fondos', err?.message||String(err||''))
  }
  const inp={width:'100%',height:38,border:`0.5px solid ${C.border}`,borderRadius:8,fontSize:13,padding:'0 10px',color:C.text,background:'#fff',outline:'none',boxSizing:'border-box'}
  const flabel={fontSize:10,fontWeight:600,color:C.textSoft,letterSpacing:'.05em',textTransform:'uppercase',marginBottom:6,display:'block'}
  const sugCc=fichaContacts.filter(c=>c.email&&c.email.toLowerCase()!==(para||'').toLowerCase()&&!cc.includes(c.email.toLowerCase()))
  const _body = (<>
        {!rend&&<div style={{fontSize:11,color:C.soonText,background:'#FEF6EE',border:'1px solid #F5E2CC',borderRadius:8,padding:'8px 10px',marginBottom:12}}>No encontré la rendición de este cliente para sacar el destinatario — agrégalo a mano abajo.</div>}
        <div style={isDesktop?{display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr)',gap:20,alignItems:'start'}:undefined}>
        <div>
        <div style={{marginBottom:12}}>
          <label style={flabel}>Para</label>
          <input value={para} onChange={e=>setPara(e.target.value)} placeholder='correo@cliente.cl' style={inp}/>
        </div>
        <div style={{marginBottom:12}}>
          <label style={flabel}>CC</label>
          {(()=>{ const ccVis=cc.filter(e=>e&&e.toLowerCase()!==(para||'').trim().toLowerCase()); return ccVis.length>0&&<div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:6}}>
            {ccVis.map(e=><span key={e} style={{display:'inline-flex',alignItems:'center',gap:5,background:C.azulBg,color:C.accent,borderRadius:16,padding:'3px 7px 3px 10px',fontSize:12}}>{e}<button onClick={()=>removeCc(e)} style={{background:'none',border:'none',color:C.accent,cursor:'pointer',fontSize:14,lineHeight:1,padding:0}}><Gl n='x'/></button></span>)}
          </div> })()}
          <input value={ccInput} onChange={e=>setCcInput(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter'||e.key===','){ e.preventDefault(); addCc(ccInput) } }} onBlur={()=>ccInput.trim()&&addCc(ccInput)} placeholder='Agregar correo y Enter' style={inp}/>
          {sugCc.length>0&&<div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:6}}>{sugCc.slice(0,6).map(c=><button key={c.email} onClick={()=>addCc(c.email)} style={{fontSize:11,border:`1px solid ${C.border}`,background:'#fff',color:C.muted,borderRadius:16,padding:'3px 10px',cursor:'pointer'}}>+ {c.nombre||c.email}</button>)}</div>}
          {studioEmails.length>0&&<label style={{display:'flex',gap:7,alignItems:'center',marginTop:8,fontSize:11,color:C.muted,cursor:'pointer'}}><input type='checkbox' checked={studioOn} onChange={e=>setStudioOn(e.target.checked)}/>Copia a la oficina ({studioEmails.join(', ')})</label>}
        </div>
        <div style={{marginBottom:12}}>
          <label style={flabel}>Comprobante de transferencia</label>
          {comp?(
            <div style={{display:'flex',alignItems:'center',gap:8,background:C.greenBg,borderRadius:8,padding:'9px 11px'}}>
              <span style={{fontSize:12,color:C.greenText,fontWeight:600,flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}><Gl n='tick'/> {comp.name}</span>
              <button onClick={()=>setComp(null)} style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:12}}>Quitar</button>
            </div>
          ):(
            <label style={{display:'flex',alignItems:'center',justifyContent:'center',gap:8,border:`1px dashed ${C.muted}`,borderRadius:8,padding:'12px',cursor:'pointer',color:C.accent,fontSize:12,fontWeight:600}}>
              <input type='file' accept='image/*,application/pdf' onChange={onFile} style={{display:'none'}}/>
              + Adjuntar comprobante (PDF o imagen)
            </label>
          )}
        </div>
        <div style={{marginBottom:12}}>
          <label style={flabel}>Mensaje</label>
          <textarea value={body} onChange={e=>setBody(e.target.value)} style={{width:'100%',minHeight:150,border:`0.5px solid ${C.border}`,borderRadius:10,fontSize:13,padding:'10px 11px',color:C.text,outline:'none',resize:'vertical',fontFamily:'inherit',boxSizing:'border-box',lineHeight:1.5}}/>
        </div>
        {!isDesktop&&<details style={{marginBottom:14}}><summary style={{fontSize:11,color:C.muted,cursor:'pointer'}}>Vista previa del correo</summary><div style={{border:`1px solid ${C.border}`,borderRadius:8,padding:12,maxHeight:300,overflowY:'auto',marginTop:8,background:'#fff'}} dangerouslySetInnerHTML={{__html:buildHtml(body,false)}}/></details>}
        </div>
        {isDesktop&&<div><label style={flabel}>Vista previa del correo</label><div style={{border:`1px solid ${C.border}`,borderRadius:10,padding:12,maxHeight:'62vh',overflowY:'auto',background:'#fff'}} dangerouslySetInnerHTML={{__html:buildHtml(body,false)}}/></div>}
        </div>
        <div style={{display:'flex',gap:8,marginTop:14}}>
          {!asPage&&<button onClick={onClose} style={{flex:1,height:44,borderRadius:10,border:`0.5px solid ${C.border}`,background:'#fff',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>}
          <button disabled={sending||!para.trim()} onClick={enviar} style={{flex:2,height:44,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:600,cursor:para.trim()?'pointer':'not-allowed',opacity:(sending||!para.trim())?.6:1,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>{sending?<Spin/>:null}{sending?'Enviando...':'Enviar devolución'}</button>
        </div>
      </>)
  const _page = _body
  return asPage ? _page : (<Modal fullscreen fsMaxWidth={isDesktop?960:720} title={<><span style={{color:C.accent}}>Enviar devolución</span>{client&&<><span style={{color:C.textSoft,fontWeight:400,margin:'0 7px'}}>|</span><span style={{color:C.muted}}>{client.name}</span></>}</>} onClose={onClose} closeOnBackdrop={false}>{_body}</Modal>)
}

export function RendicionEmailModal({r, client, user, expenses, clientEntities=[], sales=[], setExpenses=null, onSent, onClose, onPatch, onNext, asPage=false}) {
  const isDesktop = useIsDesktop()
  // Varias rendiciones en un mismo correo (separadas por trabajo): r es la primera y r._hermanas las demás.
  const _todas = [r, ...((r&&r._hermanas)||[])]
  const _multi = _todas.length>1
  const _borr = (r?.correo&&(r.correo.asunto||r.correo.cuerpo||r.correo.para))?r.correo:null   // borrador guardado: se retoma (el que solo agrupa no trae nada)
  // El texto (asunto/cuerpo) solo vale si es del mismo tipo de correo: si la hermana se eliminó, el texto que nombra dos rendiciones no sirve.
  const _txt = _borr && ((_borr.modo==='sep1')===_multi) ? _borr : null
  const det = gastosDeRend(r, expenses).slice().sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')))
  const [attachSet,setAttachSet] = useState(new Set())   // gastos de esta rendición con comprobante de respaldo
  useEffect(()=>{ const ids=det.map(e=>e.id); if(!ids.length) return; let alive=true; supabase.from('expense_attachments').select('expense_id').in('expense_id',ids).then(({data})=>{ if(alive) setAttachSet(new Set((data||[]).map(x=>String(x.expense_id)))) },()=>{}); return ()=>{alive=false} },[r.id])
  // Saldo del fondo con la MISMA fuente única que el PDF y el modal: fondos − gastos ya rendidos (de la RS).
  // Negativo = el cliente debe al Estudio → se incluyen los datos bancarios.
  // 1 RS: todo el cliente (incl. fondos sin entity_id) pertenece a esa RS; solo se acota con 2+ RS.
  const entId = ((clientEntities||[]).filter(e=>e.client_id===r.client_id).length>1) ? (det.find(e=>e.entity_id)||{}).entity_id : null
  const _trab = r.por_trabajo ? (r.project||'') : null
  const _rs0 = fondoDeRend(r, expenses, clientEntities)
  // Vista previa sin guardar: los gastos aún no están marcados como rendidos → se descuentan aquí (misma cifra que tendrá al guardarse).
  const _rs = r._virtual ? {..._rs0, rendido:_rs0.rendido+det.reduce((a,e)=>a+(e.amount||0),0), saldo:_rs0.saldo-det.reduce((a,e)=>a+(e.amount||0),0)} : _rs0
  const saldoCliente = _rs.saldo
  const totFondosCli = _rs.totFondos
  const debeCliente = saldoCliente < 0
  // 2+ proyectos: el correo los nombra y explica la imputación de saldos (misma fuente que el PDF).
  const _grp = (_trab!=null||r.fondo_id) ? null : rendGruposProyecto({expenses, clientId:r.client_id, scopeEntId:entId, gastos:det, excludeRenderId:r.id, clientEntities})
  // Saldo de cada rendición del correo (por trabajo cuando corresponde; en la vista previa se descuentan sus gastos).
  const saldoDeR = x => { const g=gastosDeRend(x, expenses); const f=rendicionFondo(expenses, x.client_id, entId, null, x.por_trabajo?(x.project||''):null, x.fondo_id||null); const sg=g.reduce((a,e)=>a+(e.amount||0),0); return x._virtual ? f.saldo-sg : f.saldo }
  const _saldosM = _multi ? _todas.map(x=>({x, saldo:saldoDeR(x), trabajo:x.project||'sin trabajo', corr:x.correlativo})) : null
  // Trabajos con saldos de distinto signo en el mismo correo: por defecto se pide el NETO (el saldo a favor de uno abona al que debe y al
  // enviar queda registrada la imputación); «Devolver el saldo a favor» cobra lo adeudado y devuelve aparte. Se recuerda por cliente.
  const _debM = (_saldosM||[]).reduce((a,o)=>a+(o.saldo<0?-o.saldo:0),0), _favM = (_saldosM||[]).reduce((a,o)=>a+(o.saldo>0?o.saldo:0),0)
  const _netoAplica = _multi && _debM>=1 && _favM>=1
  const [devolverFav,setDevolverFav] = useState(!!_borr?.devolver_favor)
  const _persona = esPersona(client?.name)
  // Trato del correo: tú / usted (una persona) · ustedes (empresa o varios). Se aprende por cliente (learnings trato_cliente).
  const [trato,setTrato] = useState(_borr?.trato||(_persona?'tu':'ustedes'))
  const T = { tu:{esp:'estés',adj:'Te adjuntamos tu',enc:'encontrarás',su:'tu',le:'te',pref:'prefieres',selo:'te lo'}, usted:{esp:'esté',adj:'Le adjuntamos su',enc:'encontrará',su:'su',le:'le',pref:'prefiere',selo:'se lo'}, ustedes:{esp:'estén',adj:'Les adjuntamos su',enc:'encontrarán',su:'su',le:'les',pref:'prefieren',selo:'se lo'} }[trato]
  // Fondos adicionales en el mismo correo (ej. falta plata para lo que viene): suma al saldo a cargo o se descuenta del saldo a favor.
  const [adicRaw,setAdic] = useState({monto:'',motivo:''})
  const adic = {...adicRaw, on:(parseInt(adicRaw.monto)||0)>0}   // sin interruptor: si hay monto, se pide
  // Sugerencia con datos reales (no inventada): el último fondo que mandó este cliente.
  const ultFondo = (expenses||[]).filter(e=>e.type==='fondo'&&e.client_id===r.client_id&&!e.deleted_at&&(e.amount||0)>0).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')))[0]||null
  const [para,setPara] = useState(_borr?.para || r?._carry?.para || r?.dirigido_email || client?.email || '')
  // Cc: gente del cliente (con chips, aprendida y editable) + copia al estudio (responsable + quienes cargaron los gastos).
  const EMAIL_BY_NAME = equipoPorNombre()
  const toEmail = x => { if(!x) return null; const s=String(x).trim(); return s.includes('@')?s.toLowerCase():(EMAIL_BY_NAME[s]||null) }
  const myEmail = (user?.email||'').toLowerCase()
  const studioEmails = useMemo(()=>{ const set=new Set(); const resp=toEmail(client?.abogado_responsable); if(resp) set.add(resp); det.forEach(e=>{ const em=toEmail(e.created_by); if(em) set.add(em) }); if(BRAND.casillaAgente) set.add(BRAND.casillaAgente); set.delete(myEmail); return [...set] },[client?.abogado_responsable, det, myEmail])
  const [studioOn,setStudioOn] = useState(_borr?.studioOn!==false && r?._carry?.studioOn!==false)
  const [cc,setCc] = useState(Array.isArray(_borr?.cc)?_borr.cc:(r?._carry?.cc||[]))
  const [ccInput,setCcInput] = useState('')
  const [fichaContacts,setFichaContacts] = useState([])
  useEffect(()=>{ if(!client?.id) return; let alive=true
    supabase.from('contacts').select('nombre,email').eq('client_id',client.id).then(({data})=>{ if(alive) setFichaContacts((data||[]).filter(c=>c.email)) },()=>{})
    supabase.from('learnings').select('value').eq('kind','rendicion_cc').eq('key',String(client.id)).maybeSingle().then(({data})=>{ if(alive&&data&&data.value){ const ems=String(data.value).split(/[,;]/).map(s=>s.trim().toLowerCase()).filter(Boolean); setCc(prev=>[...new Set([...prev,...ems])]) } },()=>{})
    return ()=>{alive=false}
  },[client?.id])
  useEffect(()=>{ let alive=true
    supabase.from('learnings').select('value').eq('kind','firma_correo').eq('key',myEmail).order('updated_at',{ascending:false}).limit(1).maybeSingle().then(({data})=>{ if(alive&&data&&data.value){ try{ const ff=JSON.parse(data.value); setFirma(prev=>({...prev,...ff})) }catch(_){} } },()=>{})
    return ()=>{alive=false}
  },[myEmail])
  const addCc = em => { const e=String(em||'').trim().toLowerCase(); if(e&&e.includes('@')&&!cc.includes(e)&&e!==(para||'').toLowerCase()) setCc(prev=>[...prev,e]); setCcInput('') }
  // Sugerencias desde el correo: solo la primera vez (cliente sin destinatarios guardados). Después, se mantiene lo definido;
  // las sugerencias quedan detrás de un enlace y se buscan solo si se piden.
  const [verSug,setVerSug] = useState(false)
  const [sugMail,setSugMail] = useState(null)
  const [primeraVez,setPrimeraVez] = useState(false)
  useEffect(()=>{ if(DEMO||!r?.client_id||_borr) return; let on=true
    supabase.from('learnings').select('value').eq('kind','rendicion_para').eq('key',String(r.client_id)).maybeSingle().then(({data})=>{ if(on&&!data?.value){ setPrimeraVez(true); setVerSug(true) } },()=>{})
    return ()=>{on=false} },[r?.client_id])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{ if(!verSug||sugMail!==null||DEMO) return; let on=true
    ;(async()=>{ try{ const token=await driveToken(); if(!token){ if(on) setSugMail([]); return }
      const terms=[client?.name, ...(clientEntities||[]).filter(x=>x.client_id===r.client_id).map(x=>x.name), ...fichaContacts.map(c=>c.email)]
      const out=await gmailParticipantesCliente(token, terms); if(on) setSugMail(out) }catch(_){ if(on) setSugMail([]) } })()
    return ()=>{on=false} },[verSug])   // eslint-disable-line react-hooks/exhaustive-deps
  const motivoSug = x => `${x.rol==='escribio'?'Escribió':x.rol==='recibio'?'Le escribimos':'Estuvo en copia'} el ${fmtFechaDMY(x.last)}${x.subj?`: «${x.subj.length>48?x.subj.slice(0,48)+'…':x.subj}»`:''}`
  const ponerPara = em => { const e=String(em).toLowerCase(); if(para.trim()&&para.trim().toLowerCase()!==e) setCc(p=>[...new Set([...p,para.trim().toLowerCase()])].filter(x=>x!==e)); else setCc(p=>p.filter(x=>x!==e)); setPara(e) }
  const removeCc = em => setCc(prev=>prev.filter(x=>x!==em))
  const asuntoMulti = lang => lang==='en' ? `Expense Reports ${_todas.map(x=>`No. ${x.correlativo||'?'}`).join(' and ')} — ${client?.name||''}` : `Rendiciones de gastos ${_todas.map(x=>`N° ${x.correlativo||'?'}`).join(' y ')} — ${client?.name||''}`
  const [asunto,setAsunto] = useState(_txt?.asunto || (_multi ? asuntoMulti('es') : `Rendición de gastos${r.correlativo?` N° ${r.correlativo}`:''} — ${r.project||client?.name||''}`))
  const [lang,setLang] = useState(_borr?.lang||r?._carry?.lang||'es')
  const [firma,setFirma] = useState(firmaDefault(user?.email) || {nombre:user?.name||'', cargo:'Abogado', telefono:''})
  const [showFirma,setShowFirma] = useState(false)
  const [sending,setSending] = useState(false)
  const buildHTML = () => {
    const A='#003C50',A2='#537281',A4='#E4E8EB'
    const rows = det.map(e=>`<tr><td style="padding:5px 8px;border-bottom:1px solid ${A4};white-space:nowrap">${fmtFechaDMY(e.date)}</td><td style="padding:5px 8px;border-bottom:1px solid ${A4}">${RENDCAT(e.category)}${e.subcategory?': '+glosaCliente(e.subcategory):''}</td><td style="padding:5px 8px;border-bottom:1px solid ${A4}">${glosaCliente(e.concept)||'—'}</td><td style="padding:5px 8px;border-bottom:1px solid ${A4};text-align:right;color:#E24B4A;white-space:nowrap">-${fmtN(e.amount)}</td></tr>`).join('')
    return `<div style="font-family:'DM Sans',Arial,sans-serif;color:#3D3D3D;font-size:13px"><div style="background:${A};color:#fff;padding:14px 18px;border-radius:8px 8px 0 0;display:flex;justify-content:space-between;align-items:center"><div><div style="font-size:14px;font-weight:700">Rendición de gastos</div><div style="font-size:11px;opacity:.85;margin-top:2px">${client?.name||''} · ${r.periodo}</div></div><img src="${logoBlanco}" alt="${BRAND.nombre}" style="height:28px;display:block"/></div><table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:8px"><thead><tr style="background:${A4}"><th style="text-align:left;padding:6px 8px">Fecha</th><th style="text-align:left;padding:6px 8px">Categoría</th><th style="text-align:left;padding:6px 8px">Descripción</th><th style="text-align:right;padding:6px 8px">Monto</th></tr></thead><tbody>${rows}</tbody><tfoot><tr style="font-weight:700"><td colspan="3" style="padding:8px;border-top:2px solid ${A2}">TOTAL RENDIDO</td><td style="padding:8px;border-top:2px solid ${A2};text-align:right;color:#E24B4A">-${fmtN(r.total)}</td></tr></tfoot></table><div style="margin-top:14px;font-size:12px">Atentamente,<br/><strong>${user?.name||''}</strong><br/>${BRAND.nombre}</div></div>`
  }
  // Envuelve el texto del correo (lo que el usuario ve/edita) en HTML con la marca del estudio,
  // para que no llegue plano. Las líneas indentadas (datos de cuenta) se muestran en una caja.
  const buildEmailHtml = (text, lang='es', useCid=false) => {
    const A='#003C50', A4='#E4E8EB', MUTED='#537281', BG='#F7F9FA'
    const logoW = useCid?'cid:lealogow':`${location.origin}${BRAND.logo.blanco}`
    const logoC = useCid?'cid:lealogoc':`${location.origin}${BRAND.logo.color}`
    const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    const lines = cuentaEnRecuadro(text).split('\n')
    let out='', box=[]
    const flush=()=>{ if(box.length){ out+=`<div style="background-color:${BG};border:1px solid ${A4};border-radius:8px;padding:12px 16px;margin:12px 0;font-size:13px;line-height:1.8">${box.map(l=>{ const i=l.indexOf(':'); return i>0?`<div><span style="color:${MUTED}">${esc(l.slice(0,i))}:</span> <strong style="color:${A}">${esc(l.slice(i+1).trim())}</strong></div>`:`<div>${esc(l)}</div>` }).join('')}</div>`; box=[] } }
    lines.forEach(l=>{ if(/^\s{2,}\S/.test(l)) box.push(l.trim()); else { flush(); out+= l.trim()? `<p style="margin:0 0 10px">${esc(l)}</p>` : '' } })
    flush()
    return `<div style="font-family:'DM Sans',Arial,Helvetica,sans-serif;color:#3D3D3D;font-size:14px;line-height:1.6;max-width:600px;margin:0 auto"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tbody><tr><td bgcolor="${A}" style="background-color:${A};padding:18px 24px"><table width="100%"><tbody><tr><td style="vertical-align:middle"><img src="${logoW}" alt="${BRAND.nombre}" style="height:24px;display:block"/></td><td style="text-align:right;vertical-align:middle;color:#fff;font-size:12px;font-weight:600;white-space:nowrap;padding-left:12px">${_multi?(lang==='en'?`Expense Reports No. ${_todas.map(x=>x.correlativo||'?').join(' and ')}`:`Rendiciones N° ${_todas.map(x=>x.correlativo||'?').join(' y ')}`):`${lang==='en'?'Expense Report':'Rendición de gastos'}${r.correlativo?`${lang==='en'?' No. ':' N° '}${r.correlativo}`:''}`}</td></tr></tbody></table></td></tr></tbody></table><div style="padding:24px;border:1px solid ${A4};border-top:none">${out}${firmaCorreoHtml(firma, logoC, lang)}</div></div>`
  }
  // Correo con varias rendiciones (una por trabajo): nombra cada N° con su trabajo y saldo; se transfiere la suma de lo que queda a cargo.
  const cuerpoMulti = (lang='es') => {
    const Y = adic.on ? Math.max(0, parseInt(adic.monto)||0) : 0, mot = adic.motivo.trim() ? ` (${adic.motivo.trim()})` : ''
    const deb = _debM, favs=(_saldosM||[]).filter(o=>o.saldo>0), debs=(_saldosM||[]).filter(o=>o.saldo<0), fav=_favM
    const neto = _netoAplica && !devolverFav
    const tot = neto ? deb + Y - fav : deb + Y
    const yL = a => a.length<2 ? (a[0]||'') : `${a.slice(0,-1).join(', ')} ${lang==='en'?'and':'y'} ${a[a.length-1]}`
    const refN = (arr, en) => en ? (arr.length>1?`reports No. ${yL(arr.map(o=>o.corr||'?'))}`:`report No. ${arr[0]?.corr||'?'}`) : (arr.length>1?`de las rendiciones N° ${yL(arr.map(o=>o.corr||'?'))}`:`de la rendición N° ${arr[0]?.corr||'?'}`)
    if(lang==='en'){
      const cuentaE = `\n  ${BRAND.nombreLegal}\n  Tax ID (RUT): ${fmtRutCL(BRAND.rut)}\n  Bank: ${BRAND.pago.gastos.banco}\n  Checking account: ${BRAND.pago.gastos.cuentaFmt}\n  Confirmation to: ${BRAND.pago.gastos.email}`
      const lineas = (_saldosM||[]).map(o=>`• No. ${o.corr||'?'} · ${o.trabajo}: ${o.saldo<0?`balance payable ${fmtN(-o.saldo)}`:o.saldo>0?`balance in your favor ${fmtN(o.saldo)}`:'no balance'}`).join('\n')
      const adE = Y?` (including an additional fund of ${fmtN(Y)} for the upcoming steps)`:''
      let cierre
      if(neto) cierre = tot>0 ? (Y&&fav>deb ? `\n\nFor the upcoming steps we request an additional fund of ${fmtN(Y)}. After deducting the balance in your favor from ${refN(favs,true)}, which covers the balance payable on ${refN(debs,true)}, we kindly ask you to transfer ${fmtN(tot)} to the account of:${cuentaE}` : `\n\nAfter deducting the balance in your favor from ${refN(favs,true)}, we kindly ask you to transfer ${fmtN(tot)}${adE} to the account of:${cuentaE}`)
        : `\n\nThe balance in your favor from ${refN(favs,true)} covers the balance payable on ${refN(debs,true)}${Y?` and the additional fund of ${fmtN(Y)} for the upcoming steps`:''}, so no transfer is needed.${tot<0?` A balance of ${fmtN(-tot)} remains in your favor; please let us know whether you prefer to keep it as a fund or to have it refunded.`:''}`
      else cierre = (tot>0?`\n\nWe kindly ask you to transfer ${fmtN(tot)}${adE} to the account of:${cuentaE}`:'')
        + (favs.length?(_netoAplica?`\n\nFor the balance in your favor on ${refN(favs,true)} (${fmtN(fav)}), please let us know the bank account to which you would like it refunded.`:`\n\nPlease let us know whether you prefer to keep the balance in your favor as a fund or to have it refunded.`):'')
      return `${saludoCliEn(client?.name)},\n\nI hope you are doing well. Please find attached your expense reports, one per matter:\n\n${lineas}\n\nThe attached documents contain an itemized breakdown of each disbursement.${cierre}\n\nWe remain at your disposal for any questions.\n\nKind regards,`
    }
    const cuentaLEA = `\n  ${BRAND.nombreLegal}\n  RUT: ${fmtRutCL(BRAND.rut)}\n  Banco: ${BRAND.pago.gastos.banco}\n  Cuenta Corriente: ${BRAND.pago.gastos.cuentaFmt}\n  Comprobante a: ${BRAND.pago.gastos.email}`
    const lineas = (_saldosM||[]).map(o=>`• N° ${o.corr||'?'} · ${o.trabajo}: ${o.saldo<0?`saldo a ${T.su} cargo de ${fmtN(-o.saldo)}`:o.saldo>0?`saldo a ${T.su} favor de ${fmtN(o.saldo)}`:'sin saldo pendiente'}`).join('\n')
    const Le = T.le[0].toUpperCase()+T.le.slice(1)
    const adT = Y?`un total de ${fmtN(tot)}, que incluye fondos adicionales por ${fmtN(Y)}${mot} para los próximos trámites,`:fmtN(tot)
    let cierre
    if(neto) cierre = tot>0 ? (Y&&fav>deb ? `\n\nPara los próximos trámites${mot} solicitamos fondos adicionales por ${fmtN(Y)}. Descontado el saldo a ${T.su} favor ${refN(favs)}, que cubre el saldo a ${T.su} cargo ${refN(debs)}, ${T.le} agradeceremos transferir ${fmtN(tot)} a la cuenta de:${cuentaLEA}` : `\n\nDescontado el saldo a ${T.su} favor ${refN(favs)}, ${T.le} agradeceremos transferir ${adT} a la cuenta de:${cuentaLEA}`)
      : `\n\nEl saldo a ${T.su} favor ${refN(favs)} cubre el saldo a ${T.su} cargo ${refN(debs)}${Y?` y los fondos adicionales por ${fmtN(Y)}${mot} para los próximos trámites`:''}, por lo que no es necesario transferir.${tot<0?` Queda un saldo a ${T.su} favor de ${fmtN(-tot)}; ${T.le} agradeceremos indicarnos si ${T.pref} mantenerlo como fondo o que ${T.selo} devolvamos.`:''}`
    else cierre = (tot>0 ? `\n\n${Le} agradeceremos transferir ${adT}${_netoAplica&&debs.length===1?` (saldo ${refN(debs)})`:''} a la cuenta de:${cuentaLEA}` : '')
      + (favs.length ? (_netoAplica ? `\n\nPor el saldo a ${T.su} favor ${refN(favs)} (${fmtN(fav)}), ${T.le} agradeceremos indicarnos la cuenta corriente a la que ${T.pref} que ${T.selo} devolvamos.`
        : `\n\nPor el saldo a ${T.su} favor, ${T.le} agradeceremos indicarnos si ${T.pref} mantenerlo como fondo o que ${T.selo} devolvamos.`) : '')
    return `${saludoCli(client?.name)}:\n\nEspero que ${T.esp} muy bien. ${T.adj}s rendiciones de gastos, una por trabajo:\n\n${lineas}\n\nEn los documentos adjuntos ${T.enc} el detalle de cada desembolso.${cierre}\n\nQuedamos atentos a cualquier consulta.\n\nSaludos cordiales,`
  }
  const saludoCliEn = name => esPersona(name) ? `Dear ${(name||'').trim().split(/\s+/)[0]}` : 'Dear Sir or Madam'
  const asuntoFor = lang => { if(_multi) return asuntoMulti(lang); const label = r.project || client?.name || ''; return lang==='en' ? `Expense Report${r.correlativo?` No. ${r.correlativo}`:''} — ${label}` : `Rendición de gastos${r.correlativo?` N° ${r.correlativo}`:''} — ${label}` }
  const cuerpoCorreo = (lang='es') => {
    if(_multi) return cuerpoMulti(lang)
    const abs = fmtN(Math.abs(saldoCliente))
    if(lang==='en'){
      const cuentaLEA = `\n  ${BRAND.nombreLegal}\n  Tax ID (RUT): ${fmtRutCL(BRAND.rut)}\n  Bank: ${BRAND.pago.gastos.banco}\n  Checking account: ${BRAND.pago.gastos.cuentaFmt}\n  Confirmation to: ${BRAND.pago.gastos.email}`
      let cierre = ''
      if(saldoCliente < 0){
        cierre = `\n\nThis report results in a balance of ${abs} payable by you, which we kindly ask you to transfer to the account of:${cuentaLEA}`
      } else if(saldoCliente > 0){
        cierre = `\n\nThe funds received amounted to ${fmtN(totFondosCli)} and the reported expenses total ${fmtN(_rs.rendido)}, leaving a balance of ${abs} in your favor. Please let us know the bank account to which you would like the surplus refunded, by writing to ${BRAND.pago.honorarios.email}.`
      }
      const Ye = adic.on ? Math.max(0, parseInt(adic.monto)||0) : 0
      if(Ye) cierre += `\n\nFor the upcoming steps we also request an additional fund of ${fmtN(Ye)}.`
      return `${saludoCliEn(client?.name)},

I hope you are doing well. Please find attached your expense report${r.correlativo?` No. ${r.correlativo}`:''}${r.project?` for the ${r.project} project${r.subproject?` (${r.subproject})`:''}`:''}. The attached document contains an itemized breakdown of each disbursement.${cierre}

We remain at your disposal for any questions.

Kind regards,`
    }
    const cuentaLEA = `\n  ${BRAND.nombreLegal}\n  RUT: ${fmtRutCL(BRAND.rut)}\n  Banco: ${BRAND.pago.gastos.banco}\n  Cuenta Corriente: ${BRAND.pago.gastos.cuentaFmt}\n  Comprobante a: ${BRAND.pago.gastos.email}`
    const Y = adic.on ? Math.max(0, parseInt(adic.monto)||0) : 0, sal = Math.abs(saldoCliente), mot = adic.motivo.trim() ? ` (${adic.motivo.trim()})` : ''
    let cierre = ''
    if(saldoCliente < 0){
      cierre = Y ? `\n\nDe esta rendición resulta un saldo a ${T.su} cargo de ${abs}. Además, para los próximos trámites${mot} solicitamos fondos adicionales por ${fmtN(Y)}, por lo que ${T.le} agradeceremos transferir un total de ${fmtN(sal+Y)} a la cuenta de:${cuentaLEA}`
        : `\n\nDe esta rendición resulta un saldo a ${T.su} cargo de ${abs}, que ${T.le} agradeceremos transferir a la cuenta de:${cuentaLEA}`
    } else if(saldoCliente > 0){
      cierre = Y ? `\n\nEl fondo recibido fue de ${fmtN(totFondosCli)} y los gastos rendidos suman ${fmtN(_rs.rendido)}, resultando un saldo a ${T.su} favor de ${abs}. Para los próximos trámites${mot} solicitamos fondos adicionales por ${fmtN(Y)}; ${Y>sal?`descontado ${T.su} saldo a favor, ${T.le} agradeceremos transferir ${fmtN(Y-sal)} a la cuenta de:${cuentaLEA}`:`${T.su} saldo a favor los cubre, por lo que lo mantendremos como fondo para esos trámites.`}`
        : `\n\nEl fondo recibido fue de ${fmtN(totFondosCli)} y los gastos rendidos suman ${fmtN(_rs.rendido)}, resultando un saldo a ${T.su} favor de ${abs}. ${T.le[0].toUpperCase()+T.le.slice(1)} agradeceremos indicarnos la cuenta corriente a la que ${T.pref} que ${T.le} devolvamos el excedente, escribiéndonos a ${BRAND.pago.honorarios.email}.`
    } else if(Y){
      cierre = `\n\nPara los próximos trámites${mot} solicitamos fondos adicionales por ${fmtN(Y)}, que ${T.le} agradeceremos transferir a la cuenta de:${cuentaLEA}`
    }
    const listaY = a => a.length<2 ? (a[0]||'') : `${a.slice(0,-1).join(', ')} y ${a[a.length-1]}`
    const proyTxt = _grp ? `, que incluye ${_grp.grupos.length} trabajos: ${listaY(_grp.grupos.map(x=>x.proyecto||'sin trabajo asignado'))}` : (r.project?` del trabajo ${r.project}${r.subproject?` (${r.subproject})`:''}`:'')
    const fav = _grp ? _grp.grupos.filter(x=>x.saldo>0) : [], cub = _grp ? _grp.grupos.filter(x=>x.saldo<0) : []
    const imputTxt = fav.length&&cub.length ? ` El saldo a ${T.su} favor de ${listaY(fav.map(x=>`${x.proyecto} (${fmtN(x.saldo)})`))} se abonó a ${listaY(cub.map(x=>x.proyecto))}.` : ''
    return `${saludoCli(client?.name)}:

Espero que ${T.esp} muy bien. ${T.adj} rendición de gastos${r.correlativo?` N° ${r.correlativo}`:''}${proyTxt}. En el documento adjunto ${T.enc} el detalle de cada desembolso.${imputTxt}${cierre}

Quedamos atentos a cualquier consulta.

Saludos cordiales,`
  }
  const bodyTocadoR=useRef(!!_txt?.cuerpo); const learnedTplR=useRef({})
  const _rendSign=()=> saldoCliente<0?'d':saldoCliente>0?'f':'0'   // la base se separa por signo del saldo: el cierre cambia (a cargo / a favor)
  const keyR=lg=>`${r.client_id}:${_rendSign()}:${lg}`
  // Tokeniza TODO lo variable (correlativo, proyecto, saldo, fondos, rendido) para reusar tu redacción SIN congelar cifras.
  const _rendPairs=(lg)=>[['{correlativo}', r.correlativo!=null?(lg==='en'?`No. ${r.correlativo}`:`N° ${r.correlativo}`):''],['{proyecto}', r.project||''],['{subproyecto}', r.subproject?` (${r.subproject})`:''],['{saldo}', fmtN(Math.abs(saldoCliente))],['{fondos}', fmtN(totFondosCli)],['{rendido}', fmtN(_rs.rendido)]]
  const _tokR=(t,lg)=>{ let s=String(t); for(const [tok,val] of _rendPairs(lg)){ if(val&&String(val).length>=2) s=s.split(val).join(tok) } return s }
  const _untokR=(t,lg)=>{ let s=String(t); for(const [tok,val] of _rendPairs(lg)){ s=s.split(tok).join(val) } return s }
  const [body,setBody] = useState(()=>_txt?.cuerpo || cuerpoCorreo(_borr?.lang||'es'))
  const aplicarBaseR=lg=>{ const tpl=_multi?null:learnedTplR.current[lg]; setBody(tpl?_untokR(tpl,lg):cuerpoCorreo(lg)) }
  useEffect(()=>{ setAsunto(asuntoFor(lang)); if(!bodyTocadoR.current) aplicarBaseR(lang) },[lang])
  const _tratoIni = useRef(true)
  useEffect(()=>{ if(_tratoIni.current){ _tratoIni.current=false; return } bodyTocadoR.current=false; setBody(cuerpoCorreo(lang)) },[trato])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{ if(DEMO||!r?.client_id) return; let alive=true
    supabase.from('learnings').select('value').eq('kind','trato_cliente').eq('key',String(r.client_id)).order('updated_at',{ascending:false}).limit(1).maybeSingle().then(({data})=>{ if(alive&&['tu','usted','ustedes'].includes(data?.value)&&data.value!==trato) setTrato(data.value) },()=>{})
    return ()=>{alive=false} },[r?.client_id])   // eslint-disable-line react-hooks/exhaustive-deps
  const elegirTrato = t => { setTrato(t); if(!DEMO&&r?.client_id) setLearningKV('trato_cliente',String(r.client_id),t).catch(()=>{}) }
  useEffect(()=>{ if(DEMO||!r?.client_id||!_netoAplica||_borr?.devolver_favor!=null) return; let alive=true
    supabase.from('learnings').select('value').eq('kind','rendicion_neto').eq('key',String(r.client_id)).order('updated_at',{ascending:false}).limit(1).maybeSingle().then(({data})=>{ if(alive&&data?.value==='devolver') setDevolverFav(true) },()=>{})
    return ()=>{alive=false} },[r?.client_id])   // eslint-disable-line react-hooks/exhaustive-deps
  const _devIni = useRef(true)
  useEffect(()=>{ if(_devIni.current){ _devIni.current=false; return } if(!bodyTocadoR.current) setBody(cuerpoCorreo(lang)) },[devolverFav])   // eslint-disable-line react-hooks/exhaustive-deps
  const elegirDevolver = v => { bodyTocadoR.current=false; setDevolverFav(v); if(!DEMO&&r?.client_id) setLearningKV('rendicion_neto',String(r.client_id),v?'devolver':'neto').catch(()=>{}) }
  useEffect(()=>{ if(!bodyTocadoR.current) setBody(adic.on||_multi?cuerpoCorreo(lang):(learnedTplR.current[lang]?_untokR(learnedTplR.current[lang],lang):cuerpoCorreo(lang))) },[adic.on,adic.monto,adic.motivo])   // eslint-disable-line
  // Carga tu última redacción (cliente + signo de saldo + idioma) y la aplica con las cifras de ESTA rendición.
  useEffect(()=>{ if(!r?.client_id||_multi) return; let alive=true
    ;['es','en'].forEach(lg=>{ supabase.from('learnings').select('value').eq('kind','rendicion_msg').eq('key',keyR(lg)).maybeSingle().then(({data})=>{ if(!alive||!data?.value) return; learnedTplR.current[lg]=data.value; if(lg===lang&&!bodyTocadoR.current) setBody(_untokR(data.value,lg)) },()=>{}) })
    return ()=>{alive=false} },[r?.client_id])
  const [aiBusy,setAiBusy] = useState(false)
  // La IA redacta el correo, pero las CIFRAS y los DATOS DE CUENTA van fijos (se le pasan y se le prohíbe cambiarlos).
  const redactarIA = async()=>{
    setAiBusy(true)
    const terminado = client?.status==='Terminado'
    const cierreTipo = saldoCliente<0?'falta_fondos':(saldoCliente>0?'a_favor_devolver':'cubierto')
    const facts = { saludo: (lang==='en'?saludoCliEn(client?.name):saludoCli(client?.name)), cliente: client?.name, correlativo: r.correlativo||null, proyecto: r.project||null, subproyecto: r.subproject||null, total_rendido: r.total, fondos_recibidos: totFondosCli, gastos_rendidos: _rs.rendido, saldo: saldoCliente, tipo_cierre: cierreTipo, remitente: user?.name||'', cuenta_LEA: cierreTipo==='falta_fondos'?{titular:BRAND.nombreLegal,rut:BRAND.rut,banco:BRAND.pago.gastos.banco,cuenta_corriente:BRAND.pago.gastos.cuentaFmt,correo:BRAND.pago.gastos.email}:null }
    const EN = lang==='en'
    const prompt = EN ? `You are an assistant at the Chilean law firm ${BRAND.nombre}. Write a SHORT email (max 6 lines) in professional English to send to a client together with the attached PDF of their expense report. HARD RULES: use the EXACT greeting "${saludoCliEn(client?.name)},"; do NOT invent or change any figures or bank details, use ONLY the ones provided (verbatim); mention that the breakdown is in the attached document; if there is a "proyecto", mention it naturally in the first sentence; do NOT list the expenses one by one; do NOT mention any period or date range. Based on "tipo_cierre": falta_fondos → ask to transfer the balance payable to the indicated account (include the bank details verbatim; end the sentence with "to the account of:" and put the account block below with "${BRAND.nombreLegal}" as the FIRST line (no label), then Tax ID, bank, account and confirmation, one per line; do NOT name the firm inside the paragraph; the words "Account holder" or "To" as a heading are FORBIDDEN); a_favor_devolver → mention that the funds received were "fondos_recibidos" and the reported expenses "gastos_rendidos", leaving a balance of "saldo" in their favor, and ask them to indicate the bank account to refund the surplus (to contacto@leabogados.cl); cubierto → do not mention any balance. Close with "Kind regards," and the sender. Return ONLY the email text, no subject, no markdown. Data:\n${JSON.stringify(facts,null,2)}` : `Eres asistente de la firma de abogados chilena ${BRAND.nombre}. Redacta un CORREO BREVE (máx 6 líneas) para enviar a un cliente junto al PDF adjunto de su rendición de gastos. Español de Chile, cordial y profesional. REGLAS DURAS: usa el saludo EXACTO "${saludoCli(client?.name)}:"; la primera frase es EXACTA "Espero que ${T.esp} muy bien."; trata al destinatario de ${trato==='tu'?'TÚ (te, tu, encontrarás)':trato==='usted'?'USTED (le, su, encontrará)':'USTEDES (les, su, encontrarán)'} de forma pareja en todo el correo, sin mezclar; NO inventes ni cambies cifras ni datos de cuenta, usa SOLO los que te paso (textualmente); menciona que el detalle está en el documento adjunto; si hay "proyecto", menciónalo de forma natural en la primera frase; NO listes los gastos uno a uno; NO menciones período ni rango de fechas. Según "tipo_cierre": falta_fondos → pide transferir el saldo a su cargo a la cuenta indicada (incluye los datos de cuenta tal cual; la frase termina en "a la cuenta de:" y debajo va el bloque de datos con "${BRAND.nombreLegal}" como PRIMERA línea (sin etiqueta) y luego RUT, banco, cuenta y comprobante, cada uno en su línea; NO nombres la oficina dentro del párrafo; PROHIBIDO usar las palabras "Destinatario" o "Titular"); a_favor_devolver → menciona que el fondo recibido fue "fondos_recibidos" y los gastos rendidos "gastos_rendidos", resultando un saldo a su favor de "saldo"; pide que indique la cuenta corriente a la que devolverle el excedente (a contacto@leabogados.cl); cubierto → no menciones saldo. Cierra con "Saludos cordiales," y el remitente. Devuelve SOLO el texto del correo, sin asunto ni markdown. Datos:\n${JSON.stringify(facts,null,2)}`
    try{
      const data = await claudeCall({model:'claude-opus-4-8',max_tokens:600,messages:[{role:'user',content:prompt}]})
      const txt = (data.content?.[0]?.text||'').trim()
      if(!txt) throw new Error('respuesta vacía')
      bodyTocadoR.current=true; setBody(txt); logEvent('rendicion','correo_ia',{client_id:r.client_id},user?.name)
    }catch(e){ appAlert('Error al redactar con IA: '+(e?.message||e)) }
    setAiBusy(false)
  }
  const verPDF = (x=r) => {
    const w=window.open('','_blank'); if(!w){ appAlert('Permite las ventanas emergentes para ver el PDF.'); return }
    w.document.write(rendicionPdfHtml(x, client, expenses, clientEntities, attachSet, lang))   // diseño rico A (mismo que "Ver PDF" del historial)
    w.document.close()
  }
  // La vista previa no registra nada: recién al guardar o enviar se crea(n) la(s) rendición(es) y se marcan sus gastos.
  const persistir = async() => { const out=[]; for(const x of _todas){ out.push(x._virtual ? await x._crear() : x) } return out }
  const _modoCorreo = _multi ? 'sep1' : (r._cola?.length ? 'sepN' : 'junto')
  const correoDatos = (extra, saved) => ({para:para.trim(), cc, asunto, cuerpo:body, trato, lang, studioOn, adic:adicRaw, por:user?.name||null, modo:_modoCorreo, grupo:(saved||[]).map(x=>x.id), devolver_favor:_netoAplica?devolverFav:null, ...extra})
  const guardarBorrador = async() => {
    setSending(true)
    try{
      const saved = await persistir()
      const correo = correoDatos({guardado_at:new Date().toISOString()}, saved)
      for(const x of saved){ const {error}=await supabase.from('rendiciones').update({correo}).eq('id',x.id); if(error) throw error; onPatch&&onPatch(x.id,{correo}) }
      // Un correo por rendición: las que esperan su turno también quedan como borrador (cada una con su propio correo después).
      for(const x of (r._cola||[])){ if(x._virtual) await x._crear() }
      logActividad('rendicion.borrador_guardado',{tabla:'rendiciones',id:saved[0]?.id,detalle:{cliente:client?.name,title:`Borrador guardado${saved.length>1?` (${saved.length} rendiciones)`:''}`,monto:Math.round(saved.reduce((a,x)=>a+(x.total||0),0))}})
      appAlert('Borrador guardado. Lo encuentras en Rendir a cliente › Borradores.')
      onClose()
    }catch(e){ appAlert('No se pudo guardar el borrador: '+(e?.message||e)) }
    setSending(false)
  }
  const enviar = async() => {
    if(!para.trim()){ appAlert('Falta el email del cliente.'); return }
    const texto = cuentaEnRecuadro(body)
    const firmaTxt = firma.nombre ? [firma.nombre, firma.cargo, firma.telefono, BRAND.direccionFirma, BRAND.ciudad+' - Chile', 'www.'+BRAND.web].filter(Boolean).join('\n') : ''
    const textoFull = firmaTxt ? texto+'\n\n'+firmaTxt : texto
    const _stripD = u=>String(u||'').replace(/^data:[^,]+,/,'')
    const logosInline = [{cid:'lealogow',b64:_stripD(logoBlanco),mime:'image/png'},{cid:'lealogoc',b64:_stripD(logoColor),mime:'image/png'}]
    const ccStr = [...cc, ...(studioOn?studioEmails:[])].filter(Boolean).join(', ')
    setSending(true)
    try{
      const saved = await persistir()
      // Número de cada rendición ANTES de armar los PDF: máximo ya usado por otra rendición del cliente + 1, en orden.
      const ids = saved.map(x=>x.id)
      const {data:mx}=await supabase.from('rendiciones').select('correlativo').eq('client_id',r.client_id).not('id','in',`(${ids.join(',')})`).is('anulada_at',null).not('correlativo','is',null).order('correlativo',{ascending:false}).limit(1).maybeSingle()
      let libre=((mx&&mx.correlativo)||0)+1
      const conNum = saved.map(x=>{ if(x.sent_at&&x.correlativo) return x   // reenvío: el cliente ya tiene ese N°, no se renumera
        const c=(x.correlativo&&x.correlativo>=libre)?x.correlativo:libre; libre=c+1; return {...x, correlativo:c} })
      const nombrePdf = x => `${lang==='en'?'Expense Report':'Rendicion'}${conNum.length>1?` ${x.correlativo}`:''} ${(client?.name||'').replace(/[^\w\s-]/g,'')} ${x.project||''}`.trim()+'.pdf'
      const armarAdjuntos = async()=>{ const out=[]; for(const x of conNum){ out.push({base64:await rendicionPdfBase64(x, client, expenses, clientEntities, user, attachSet, lang), name:nombrePdf(x), mime:'application/pdf'}) } return out }
      // Envío directo con PDF adjunto vía Gmail API (si el token tiene el scope gmail.send)
      let conAdjunto = false
      let sendErr = null, viaRend = null
      const token = await driveToken()
      if(token){
        try{
          await sendGmailWithPdf(token, {to:para.trim(), cc:ccStr, subject:asunto, bodyText:textoFull, bodyHtml:buildEmailHtml(texto, lang, true), inlineImages:logosInline, attachments:await armarAdjuntos()})
          conAdjunto = true; viaRend = 'usuario'
        }catch(err){ sendErr = err /* sin scope gmail.send (403) u otro: caemos al fallback */ }
      }
      if(!conAdjunto){
        // No se pudo desde el correo del usuario. NO se manda solo desde otra cuenta: se pregunta.
        // Si acepta → oficina. Si NO (o la oficina falla) → se descarga el PDF y se abre Gmail para enviarlo a mano DESDE SU correo.
        const usarOficina = await appConfirm(MAIL_OFICINA_CONFIRM)
        let irAManual = !usarOficina
        if(usarOficina){
          try{
            await sendMailServer({to:para.trim(), cc:ccStr, subject:asunto, html:buildEmailHtml(texto, lang), text:textoFull, attachments:await armarAdjuntos()})
            conAdjunto = true; viaRend = 'oficina'
          }catch(srvErr){ irAManual = true; sendErr = sendErr || srvErr }
        }
        if(irAManual && !conAdjunto){
          // Sale desde TU correo: descargamos el PDF y abrimos Gmail para que lo adjuntes a mano.
          appAlert('Para enviarlo desde tu correo: descargamos el PDF y abrimos Gmail para que lo adjuntes.\n(O cierra sesión y vuelve a entrar para enviarlo automático desde tu cuenta.)')
          try{
            for(const at of await armarAdjuntos()){
              const bytes = Uint8Array.from(atob(at.base64), c=>c.charCodeAt(0))
              const url = URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}))
              const a = document.createElement('a'); a.href=url; a.download = at.name
              document.body.appendChild(a); a.click(); a.remove()
              setTimeout(()=>URL.revokeObjectURL(url), 5000)
            }
          }catch(_){ verPDF() }
          const gmailUrl=`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(para.trim())}&su=${encodeURIComponent(asunto)}&body=${encodeURIComponent(textoFull)}`
          const win=window.open(gmailUrl,'_blank')
          if(!win) window.location.href=`mailto:${para.trim()}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(textoFull)}`
          // Envío a mano: la app no sabe si el correo salió. Se registra como enviada solo cuando el usuario lo confirma; si no, queda como borrador.
          const confirmado = await appConfirm('¿Enviaste el correo al cliente con el PDF adjunto?\n\nSi aún no, responde que no: la rendición queda como borrador (sin número) y la envías después desde Rendiciones.')
          if(!confirmado){ setSending(false); appAlert(`La rendición NO se envió: queda como borrador, sin número, en Rendir a cliente › Borradores.\n\n${TXT_REINGRESO()}`); return }
        }
      }
      const now = new Date().toISOString()
      // El correlativo se GRABA al confirmar el envío (no al generar): un borrador no consume número.
      const correoEnv = correoDatos({enviado_at:now}, conNum)
      for(const x of conNum){
        const {error:seErr}=await supabase.from('rendiciones').update({sent_at:now, correlativo:x.correlativo, dirigido_email:(para||'').trim()||x.dirigido_email||null, correo:correoEnv}).eq('id',x.id)
        if(seErr){ console.error('No se pudo marcar la rendición como enviada:',seErr.message); appAlert(`El correo salió, pero la app no pudo marcar la rendición N° ${x.correlativo} como enviada (${seErr.message}). Avísale a soporte para que quede registrada.`) }
        else { onSent && onSent(x.id, now, x.correlativo); onPatch && onPatch(x.id,{correo:correoEnv, dirigido_email:(para||'').trim()||null}) }
      }
      // Neto: el saldo a favor de un trabajo queda imputado al que debe (con bitácora; se deshace uniendo el fondo en Gastos › Editar fondo).
      if(_netoAplica && !devolverFav){ try{
        const res=await imputarSaldosTrabajos({expenses, clientId:r.client_id, saldos:_todas.map((x,i)=>({trabajo:x.project||'', saldo:(_saldosM[i]||{}).saldo||0, corr:conNum[i]?.correlativo})), sales, user, ref:conNum.map(x=>x.correlativo).join(' y '), cliente:client?.name})
        if(setExpenses&&(res.cambios.length||res.nuevos.length)) setExpenses(p=>[...p.map(e=>{ const c=res.cambios.find(z=>z.id===e.id); return c?{...e,...c.patch}:e }),...res.nuevos])
        if(res.faltan>=1) appAlert(`El correo salió. La imputación entre trabajos quedó incompleta: ${fmt(res.faltan)} sin registrar${res.motivo?` (${res.motivo})`:''}. Regístrala en Gastos › Editar fondo › Repartir entre proyectos.`)
      }catch(e){ appAlert('El correo salió, pero no se pudo registrar la imputación entre trabajos: '+(e?.message||e)+'. Regístrala en Gastos › Editar fondo › Repartir entre proyectos.') } }
      const corr = conNum.map(x=>x.correlativo).join(' y ')
      try{ if(cc.length){ await supabase.from('learnings').delete().eq('kind','rendicion_cc').eq('key',String(r.client_id)); await supabase.from('learnings').insert({kind:'rendicion_cc',key:String(r.client_id),value:cc.join(', '),meta:{}}) } }catch(e){registrarError({origen:'accion',vista:'learnings',err:e})}
      // Recordar el destinatario "Para" de la rendición → lo reusa la devolución (que va al mismo).
      try{ if((para||'').trim()){ await supabase.from('learnings').delete().eq('kind','rendicion_para').eq('key',String(r.client_id)); await supabase.from('learnings').insert({kind:'rendicion_para',key:String(r.client_id),value:para.trim(),meta:{}}) } }catch(e){registrarError({origen:'accion',vista:'learnings',err:e})}
      try{ if(r.client_id && !adic.on && !_multi) await setLearningKV('rendicion_msg', keyR(lang), _tokR(body,lang)) }catch(e){registrarError({origen:'accion',vista:'rendicion_msg',err:e})}
      // Fondos adicionales pedidos en la rendición: quedan en el historial de solicitudes (cruce con el depósito, avisos).
      // Lo que la rendición le pide transferir queda como solicitud de fondos (seguimiento hasta el depósito): saldo a su cargo + fondos
      // adicionales; con saldo a favor, solo lo adicional que exceda ese saldo. Se cierra sola cuando entra el depósito (Rendir a cliente).
      { const _Y=adic.on?Math.max(0,parseInt(adic.monto)||0):0, _sal=Math.abs(saldoCliente)
        const pedido=Math.round(_multi ? Math.max(0, _debM+_Y-(_netoAplica&&!devolverFav?_favM:0)) : (saldoCliente<0 ? _sal+_Y : (saldoCliente>0 ? Math.max(0,_Y-_sal) : _Y)))
        if(pedido>0){ try{
          // Reenviar no duplica el pedido: si el cliente ya tiene una solicitud abierta (sin depósito), se actualiza esa.
          // Se reusa solo una solicitud abierta, del cliente en general (sin venta) y aún sin depósito; una ya cubierta no se pisa.
          const {data:abiertas}=await supabase.from('fund_requests').select('*').eq('client_id',r.client_id).is('recibido_at',null).is('sale_id',null).order('enviada_at',{ascending:false}).limit(5)
          const abierta=(abiertas||[]).find(q=>estadoSolicitud(q,expenses).k!=='rec')||null
          const {error:frErr}= abierta?.id
            ? await supabase.from('fund_requests').update({ monto:pedido, asunto, para:para.trim(), cc:ccStr, enviada_por:user?.name||null, enviada_at:new Date().toISOString() }).eq('id',abierta.id)
            : await supabase.from('fund_requests').insert({ client_id:r.client_id||null, monto:pedido, asunto, para:para.trim(), cc:ccStr, enviada_por:user?.name||null, n_adjuntos:1 })
          if(frErr) console.error('fund_requests',frErr.message); else logActividad('fondos.solicitud_enviada',{tabla:'clients',id:r.client_id,detalle:{cliente:client?.name,title:`Pedido en la rendición${corr?` N° ${corr}`:''}`,monto:pedido}}) }catch(e){registrarError({origen:'accion',vista:'fund_requests',err:e})} } }   // la base de la próxima rendición de este cliente (mismo signo de saldo, idioma) = esta
      try{ if(firma.nombre||firma.cargo||firma.telefono||firma.correo){ await supabase.from('learnings').delete().eq('kind','firma_correo').eq('key',myEmail); await supabase.from('learnings').insert({kind:'firma_correo',key:myEmail,value:JSON.stringify(firma),meta:{}}) } }catch(e){registrarError({origen:'accion',vista:'learnings',err:e})}
      const _paraTxt=[para.trim(),...cc].filter(Boolean).join(', ')
      appAlert(conAdjunto
        ? txtEnviado(viaRend,{que:conNum.length>1?`Rendiciones N° ${corr}`:`Rendición${corr?` N° ${corr}`:''}`, g:conNum.length>1?'as':'a', para:_paraTxt})+(conNum.length>1?' Con sus PDF adjuntos.':' Con el PDF adjunto.')
        : `Rendición${corr?` N° ${corr}`:''} registrada como enviada desde tu correo (envío manual) a ${_paraTxt}.`)
      // Separadas en correos distintos: sigue con la próxima rendición de la cola.
      // Mismo cliente: el destinatario, la copia y el idioma elegidos pasan al correo siguiente.
      if(r._cola?.length && onNext){ const [sig,...resto]=r._cola; onNext({...sig, _cola:resto, ...(String(sig.client_id)===String(r.client_id)?{_carry:{para,cc,lang,studioOn}}:{})}) } else onClose()
    }catch(e){ appAlert('Error: '+e.message) }
    setSending(false)
  }
  const _body = (<>
      <PasosRend paso={2}/>
      {!para.trim() && <div style={{padding:'8px 10px',borderRadius:8,background:'#FEF6EE',border:'1px solid #F5E2CC',color:C.soon,fontSize:12,marginBottom:12}}>Falta el destinatario. Escríbelo abajo o complétalo en la ficha del cliente.</div>}
      <div style={{fontSize:11,color:C.textSoft,marginBottom:10}}>De <span style={{color:C.muted}}>{user?.email||''}</span></div>
      {/* Destinatarios: un solo bloque con chips (Para = principal navy, Cc = copias azules). Si Para está vacío, lo que escribes/eliges entra como Para. */}
      {(()=>{
        const flLbl={fontSize:8,color:C.textSoft,textTransform:'uppercase',letterSpacing:.5}
        const addOne = em => { const e=String(em||'').trim(); if(!e) return; if(!para.trim()) setPara(e); else addCc(e); setCcInput('') }
        const sug=fichaContacts.filter(c=>(c.email||'').toLowerCase()!==(para||'').toLowerCase()&&!cc.includes((c.email||'').toLowerCase()))
        return (
        <div style={{marginBottom:12}}>
          <div style={{background:C.bgSoft,border:`0.5px solid ${C.border}`,borderRadius:8,padding:'7px 9px'}}>
            <div style={{...flLbl,marginBottom:5}}>Destinatarios</div>
            <div style={{display:'flex',flexWrap:'wrap',gap:5,alignItems:'center'}}>
              {para.trim()&&<span style={{display:'inline-flex',alignItems:'center',gap:5,background:C.accent,color:'#fff',borderRadius:16,padding:'3px 7px 3px 9px',fontSize:12}}><span style={{fontSize:9,opacity:.65,fontWeight:600,letterSpacing:.5}}>PARA</span>{para}<button onClick={()=>setPara('')} aria-label='Quitar' style={{background:'none',border:'none',color:'#fff',cursor:'pointer',fontSize:14,lineHeight:1,padding:0,opacity:.8}}><Gl n='x'/></button></span>}
              {cc.map(em=><span key={em} style={{display:'inline-flex',alignItems:'center',gap:5,background:C.azulBg,color:C.accent,borderRadius:16,padding:'3px 6px 3px 8px',fontSize:12}}><span style={{fontSize:9,color:C.azulInfo,fontWeight:600,letterSpacing:.5}}>CC</span>{em}<button onClick={()=>removeCc(em)} aria-label='Quitar' style={{background:'none',border:'none',color:C.azulInfo,cursor:'pointer',fontSize:14,lineHeight:1,padding:0}}><Gl n='x'/></button></span>)}
              <input value={ccInput} onChange={e=>setCcInput(e.target.value)} onKeyDown={e=>{ if((e.key==='Enter'||e.key===',')&&ccInput.trim()){ e.preventDefault(); addOne(ccInput) } }} onBlur={()=>ccInput.trim()&&addOne(ccInput)} placeholder={para.trim()?'+ agregar copia…':'correo del cliente…'} style={{flex:1,minWidth:130,border:'none',outline:'none',fontSize:13,color:C.text,background:'none'}}/>
            </div>
          </div>
          {sug.length>0&&<div style={{display:'flex',flexWrap:'wrap',gap:6,marginTop:6}}>
            {sug.map(c=><button key={c.email} onClick={()=>addOne(c.email)} style={{fontSize:11,border:`0.5px solid ${C.border}`,color:C.muted,background:'none',borderRadius:16,padding:'3px 10px',cursor:'pointer'}}>+ {c.nombre?c.nombre+' · ':''}{c.email}</button>)}
          </div>}
          {!DEMO&&(verSug
            ? <div style={{marginTop:8,border:`1px solid ${C.border}`,borderRadius:10,padding:'8px 11px',background:C.surface}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}><span style={{...SEC_LBL}}>Sugeridos desde tu correo</span>{!primeraVez&&<button onClick={()=>setVerSug(false)} style={{fontSize:11,color:C.textSoft,background:'none',border:'none',cursor:'pointer'}}>Ocultar</button>}</div>
                {sugMail===null&&<div style={{fontSize:12,color:C.textSoft,padding:'6px 0'}}>Buscando en tu correo…</div>}
                {sugMail&&!sugMail.length&&<div style={{fontSize:12,color:C.textSoft,padding:'6px 0'}}>No encontré correos con este cliente.</div>}
                {(sugMail||[]).map(x=>{ const esPara=(para||'').toLowerCase()===x.email, esCc=cc.includes(x.email); return (
                  <div key={x.email} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 0',borderTop:`1px solid ${C.track}`}}>
                    <div style={{flex:1,minWidth:0}}><div style={{fontSize:12.5,fontWeight:700,color:C.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{x.name||x.email}{x.name&&<span style={{fontWeight:400,color:C.textSoft}}> · {x.email}</span>}</div>
                      <div style={{fontSize:11,color:C.textSoft,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{motivoSug(x)}</div></div>
                    <button onClick={()=>ponerPara(x.email)} style={{fontSize:11,fontWeight:700,borderRadius:20,padding:'3px 10px',border:`1px solid ${esPara?C.accent:C.border}`,background:esPara?C.azulBg:C.surface,color:C.accent,cursor:'pointer',whiteSpace:'nowrap'}}>Para</button>
                    <button onClick={()=>esCc?removeCc(x.email):addCc(x.email)} style={{fontSize:11,fontWeight:700,borderRadius:20,padding:'3px 10px',border:`1px solid ${esCc?C.accent:C.border}`,background:esCc?C.azulBg:C.surface,color:C.accent,cursor:'pointer',whiteSpace:'nowrap'}}>CC</button>
                  </div>) })}
                {primeraVez&&<div style={{fontSize:11,color:C.textSoft,marginTop:4}}>Solo esta vez: lo que elijas queda guardado para las próximas rendiciones de este cliente.</div>}
              </div>
            : <button onClick={()=>setVerSug(true)} style={{marginTop:6,fontSize:11,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',padding:0}}>Ver sugerencias del correo</button>)}
          {studioEmails.length>0&&<div style={{display:'flex',alignItems:'center',gap:8,marginTop:8}}><Switch on={studioOn} onToggle={()=>setStudioOn(v=>!v)}/><span style={{fontSize:12,color:C.text}}>Copia a la oficina <span style={{color:C.textSoft}}>({studioEmails.join(', ')})</span></span></div>}
        </div>
        )
      })()}
      <div style={{background:C.bgSoft,border:`0.5px solid ${C.border}`,borderRadius:8,padding:'6px 11px',marginBottom:12}}>
        <div style={{fontSize:8,color:C.textSoft,textTransform:'uppercase',letterSpacing:.5}}>Asunto</div>
        <input value={asunto} onChange={e=>setAsunto(e.target.value)} style={{width:'100%',border:'none',background:'none',outline:'none',fontSize:13,color:C.text,padding:0,height:22}}/>
      </div>
      {_netoAplica&&(()=>{ const net=_debM-_favM
        const fila=(k,l,v,col,b)=>(<div key={k} style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) auto',columnGap:10,alignItems:'baseline',padding:b?'7px 0 2px':'4px 0',borderTop:b?`1px solid ${C.border}`:'none',marginTop:b?3:0,fontSize:13}}><div style={{minWidth:0}}>{l}</div><span style={{fontWeight:b?700:600,color:col,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fmt(v)}</span></div>)
        const est=t=><span style={isDesktop?{marginLeft:8,fontSize:11.5,color:C.textSoft}:{display:'block',fontSize:11.5,color:C.textSoft}}>{t}</span>
        return (<div style={{background:C.bgSoft,border:`0.5px solid ${C.border}`,borderRadius:8,padding:'8px 11px',marginBottom:12}}>
          <div style={{fontSize:12.5,fontWeight:600,color:C.accent,marginBottom:2}}>Saldos de los trabajos</div>
          {(_saldosM||[]).filter(o=>Math.abs(o.saldo)>=1).map((o,i)=>fila(i,<><span>N° {o.corr||'?'} · {o.trabajo}</span>{est(o.saldo<0?'A su cargo':'A su favor')}</>,Math.abs(o.saldo),o.saldo<0?C.overdueText:C.greenText))}
          {devolverFav
            ? <>{fila('t',<span style={{fontWeight:700,color:C.accent}}>A transferir</span>,_debM,C.text,true)}{fila('d',<span style={{color:C.muted}}>A devolver al cliente</span>,_favM,C.greenText)}</>
            : (net>0 ? fila('t',<span style={{fontWeight:700,color:C.accent}}>A transferir (neto)</span>,net,C.text,true) : fila('t',<span style={{fontWeight:700,color:C.accent}}>Queda a su favor</span>,-net,C.greenText,true))}
          <div style={{display:'flex',alignItems:'center',gap:8,marginTop:8}}><Switch on={devolverFav} onToggle={()=>elegirDevolver(!devolverFav)}/><span style={{fontSize:12.5,color:C.text}}>Devolver el saldo a favor</span></div>
        </div>) })()}
      <div style={{background:C.bgSoft,border:`0.5px solid ${C.border}`,borderRadius:8,padding:'8px 11px',marginBottom:12}}>
        <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}><span style={{fontSize:12.5,fontWeight:600,color:C.accent}}>Fondos adicionales</span>
          {ultFondo&&!adic.on&&<button type='button' onClick={()=>setAdic(p=>({...p,monto:String(Math.round(ultFondo.amount))}))} style={{fontSize:11,fontWeight:600,color:C.accent,background:C.azulBg,border:'none',borderRadius:20,padding:'2px 9px',cursor:'pointer',whiteSpace:'nowrap'}}>Último fondo {fmt(ultFondo.amount)}</button>}
          {adic.on&&<span style={{marginLeft:'auto',fontSize:11.5,color:C.muted,whiteSpace:'nowrap'}}>{_multi?`a transferir ${fmt(Math.max(0,_debM+(parseInt(adic.monto)||0)-(_netoAplica&&!devolverFav?_favM:0)))}`:saldoCliente<0?`total a transferir ${fmt(Math.abs(saldoCliente)+(parseInt(adic.monto)||0))}`:saldoCliente>0?`a transferir ${fmt(Math.max(0,(parseInt(adic.monto)||0)-saldoCliente))}`:''}</span>}
        </div>
        {<div style={{display:'flex',gap:8,marginTop:8,flexWrap:'wrap'}}>
          <span style={{display:'flex',alignItems:'center',border:`1px solid ${C.border}`,borderRadius:8,background:'#fff',width:150}}><span style={{fontSize:13,color:C.muted,padding:'0 2px 0 10px'}}>$</span><input value={adic.monto?Number(adic.monto).toLocaleString('es-CL'):''} onChange={e=>setAdic(p=>({...p,monto:e.target.value.replace(/\D/g,'')}))} inputMode='numeric' placeholder='Monto' style={{border:'none',outline:'none',fontSize:13,padding:'8px 8px 8px 2px',width:'100%',background:'none'}}/></span>
          <input value={adic.motivo} onChange={e=>setAdic(p=>({...p,motivo:e.target.value}))} placeholder='Para qué (opcional)' style={{flex:'1 1 180px',minWidth:0,border:`1px solid ${C.border}`,borderRadius:8,fontSize:13,padding:'8px 10px',outline:'none'}}/>
        </div>}
      </div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:6,marginBottom:4}}>
        <Lbl>Mensaje</Lbl>
        <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',justifyContent:'flex-end'}}>
          {lang==='es'&&<div style={{display:'inline-flex',border:`0.5px solid ${C.border}`,borderRadius:14,overflow:'hidden'}}>
            {[['tu','Tú'],['usted','Usted'],['ustedes','Ustedes']].map(([k,l])=><button key={k} onClick={()=>elegirTrato(k)} style={{fontSize:10,fontWeight:600,padding:'4px 10px',border:'none',cursor:'pointer',background:trato===k?C.accent:'transparent',color:trato===k?'#fff':C.muted}}>{l}</button>)}
          </div>}
          <div style={{display:'inline-flex',border:`0.5px solid ${C.border}`,borderRadius:14,overflow:'hidden'}}>
            {['es','en'].map(l=><button key={l} onClick={()=>setLang(l)} style={{fontSize:10,fontWeight:600,padding:'4px 10px',border:'none',cursor:'pointer',background:lang===l?C.accent:'transparent',color:lang===l?'#fff':C.muted}}>{l.toUpperCase()}</button>)}
          </div>
          <button onClick={redactarIA} disabled={aiBusy} style={{...chipBtn('soft'),height:24,opacity:aiBusy?.6:1}}>{aiBusy?(lang==='en'?'Writing…':'Redactando…'):(lang==='en'?'Draft with AI':'Redactar con IA')}</button>
        </div>
      </div>
      <textarea value={body} onChange={e=>{bodyTocadoR.current=true; setBody(e.target.value)}} rows={8} style={{width:'100%',border:`1px solid ${C.border}`,borderRadius:8,padding:'10px 12px',fontSize:13,lineHeight:1.5,color:C.text,fontFamily:'inherit',resize:'vertical',boxSizing:'border-box',marginBottom:6}}/>
      <div style={{fontSize:10,color:C.textSoft,marginBottom:12}}>Las cifras y los datos de cuenta van fijos; la IA solo redacta. Revisa antes de enviar.</div>
      <div style={{marginBottom:12}}>
        <button onClick={()=>setShowFirma(v=>!v)} style={{fontSize:11,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',padding:0}}>Mi firma {showFirma?<Gl n='chevU'/>:<Gl n='chevD'/>}</button>
        {showFirma&&<><div style={{marginTop:8,display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
          {[['nombre','Nombre'],['cargo','Cargo'],['telefono','Teléfono']].map(([k,lbl])=>(
            <div key={k} style={{background:C.bgSoft,border:`0.5px solid ${C.border}`,borderRadius:8,padding:'6px 11px'}}>
              <div style={{fontSize:8,color:C.textSoft,textTransform:'uppercase',letterSpacing:.5}}>{lbl}</div>
              <input value={firma[k]||''} onChange={e=>setFirma(f=>({...f,[k]:e.target.value}))} style={{width:'100%',border:'none',background:'none',outline:'none',fontSize:13,color:C.text,padding:0,height:22}}/>
            </div>
          ))}
        </div><div style={{fontSize:10,color:C.textSoft,marginTop:6}}>Se guarda para tus próximos correos. El correo incluye el logo de {BRAND.nombre}.</div></>}
      </div>
      {!(asPage&&isDesktop)&&<details style={{marginBottom:14}} open><summary style={{fontSize:11,color:C.muted,cursor:'pointer'}}>Vista previa del correo</summary><div style={{border:`1px solid ${C.border}`,borderRadius:8,padding:12,maxHeight:300,overflowY:'auto',marginTop:8,background:'#fff'}} dangerouslySetInnerHTML={{__html:buildEmailHtml(body, lang)}}/></details>}
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
        {!asPage&&<button onClick={onClose} style={{flex:1,padding:'9px 14px',borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>}
        {_todas.map((x,i)=><button key={i} onClick={()=>verPDF(x)} style={{flex:1,padding:'9px 10px',borderRadius:10,border:`1px solid ${C.border}`,background:C.surface,color:C.accent,fontSize:13,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>{_multi?`PDF N° ${x.correlativo||i+1}`:'Ver PDF'}</button>)}
        <button onClick={guardarBorrador} disabled={sending} style={{flex:(!isDesktop&&_multi)?'1 1 100%':1.3,padding:'9px 10px',borderRadius:10,border:'none',background:C.azulBg,color:C.accent,fontSize:13,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap',opacity:sending?.6:1}}>Guardar borrador</button>
      </div>
      <button onClick={enviar} disabled={sending||!para.trim()} style={{width:'100%',marginTop:10,padding:'11px 14px',borderRadius:10,border:'none',background:C.normal,color:'#fff',fontSize:13.5,fontWeight:700,cursor:'pointer',opacity:(sending||!para.trim())?.6:1}}>{sending?'Enviando...':(_multi?`Enviar en un correo · ${_todas.length} PDF`:(r._cola?.length?(r._cola[0]._cliName&&String(r._cola[0].client_id)!==String(r.client_id)?`Enviar y seguir con ${r._cola[0]._cliName}`:`Enviar y seguir con la N° ${r._cola[0].correlativo||'siguiente'}`):'Enviar'))}</button>
      </>)
  const _page = (asPage&&isDesktop) ? <div style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(0,460px)',gap:22,alignItems:'start'}}><div style={{minWidth:0}}>{_body}</div><div style={{position:'sticky',top:72}}><div style={{...SEC_LBL,marginBottom:6}}>Vista previa del correo</div><div style={{border:`1px solid ${C.border}`,borderRadius:10,padding:12,background:'#fff',maxHeight:'calc(100vh - 170px)',overflowY:'auto'}} dangerouslySetInnerHTML={{__html:buildEmailHtml(body, lang)}}/></div></div> : _body
  return asPage ? _page : (<Modal fullscreen fsMaxWidth={isDesktop?780:640} title={<><span style={{color:C.accent}}>Enviar rendición</span>{client?.name&&<><span style={{color:C.textSoft,fontWeight:400,margin:'0 7px'}}>|</span><span style={{color:C.muted}}>{client.name}</span></>}</>} onClose={onClose} closeOnBackdrop={false}>{_body}</Modal>)
}

export async function rendicionPdfBase64(r, client, expenses, clientEntities, user, attachSet, lang='es'){
  const EN = lang==='en'
  const { jsPDF } = await import('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm')
  const doc = new jsPDF({unit:'pt', format:'letter'})
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight()
  // Datos: MISMA fuente que el "Ver PDF" (rendicionPdfHtml) para que ambos coincidan.
  const gastos = gastosDeRend(r, expenses).slice().sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))).map(e=>attachSet?({...e,respaldo:attachSet.has(String(e.id))}):e)
  const entsClient = (clientEntities||[]).filter(x=>x.client_id===(client&&client.id))
  const gEnt = (gastos.find(e=>e.entity_id)||{}).entity_id
  const scopeEntId = entsClient.length>1 ? gEnt : null
  const ent = entsClient.length===1 ? entsClient[0] : (gEnt ? (clientEntities||[]).find(x=>x.id===gEnt) : null)
  const trab = r.por_trabajo ? (r.project||'') : null
  const { fondos, totFondos, previas, rendidoAntes } = rendicionFondo(expenses, client&&client.id, scopeEntId, r.id, trab, r.fondo_id||null)
  const grp = (trab!=null||r.fondo_id) ? null : rendGruposProyecto({expenses, clientId:client&&client.id, scopeEntId, gastos, excludeRenderId:r.id, clientEntities})
  const razon = (ent&&ent.name) || (client&&client.name) || '—'
  const rut = (ent&&ent.rut) || (client&&client.rut) || ''
  const totGastos = gastos.reduce((a,e)=>a+(e.amount||0),0)
  const saldo = totFondos - rendidoAntes - totGastos
  const fechaEmision = r.created_at ? new Date(r.created_at).toLocaleDateString(EN?'en-GB':'es-CL',{day:'2-digit',month:'long',year:'numeric'}) : ''
  const T = EN
    ? {reportNo:'Report No.',issued:'Issued',exp:n=>`${n} expense${n!==1?'s':''}`,attn:'Attn',project:'PROJECT',funds:'Funds received',expPeriod:'Expenses (period)',balFavor:'Balance in your favor',balPending:'Outstanding balance',date:'DATE',concept:'DESCRIPTION',category:'CATEGORY',amount:'AMOUNT',totalExp:'Total expenses',fundsSection:'FUNDS RECEIVED',noFunds:'No funds recorded',fundSummary:'FUND SUMMARY',received:'Funds received',prev:'Report',thisRep:'This report',avail:'Available balance',due:'Balance due',footer:'Expense report'}
    : {reportNo:'Rendición N°',issued:'Emisión',exp:n=>`${n} gasto${n!==1?'s':''}`,attn:'Dirigido a',project:'PROYECTO',funds:'Fondos recibidos',expPeriod:'Gastos del período',balFavor:'Saldo a favor',balPending:'Saldo pendiente',date:'FECHA',concept:'CONCEPTO',category:'CATEGORÍA',amount:'MONTO',totalExp:'Total gastos',fundsSection:'FONDOS RECIBIDOS',noFunds:'Sin fondos registrados',fundSummary:'RESUMEN DEL FONDO',received:'Fondos recibidos',prev:'Rendición',thisRep:'Esta rendición',avail:'Saldo disponible',due:'Saldo a su cargo',footer:'Rendición de gastos'}
  const M=40, cNavy=[0,60,80], cMuted=[83,114,129], cTxt=[61,61,61], cA3=[153,171,180], cGreen=[15,110,86], cRed=[163,45,45], cGray=[228,232,235]
  const cMonto = W-M, cCat = W-196
  // ===== Header navy =====
  doc.setFillColor(0,60,80); doc.rect(0,0,W,76,'F')
  try{ doc.addImage(logoBlanco, 'PNG', M, 25, 170, 26) }catch(_){ doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(16); doc.text('LIBERONA ESCALA', M, 40) }
  doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.text(String(razon).slice(0,42), W-M, 36, {align:'right'})
  if(rut){ doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(153,171,180); doc.text(rut, W-M, 52, {align:'right'}) }
  // ===== Franja meta =====
  doc.setFillColor(237,240,243); doc.rect(0,76,W,24,'F'); doc.setTextColor(61,61,61); doc.setFontSize(9)
  let mx=M
  if(r.correlativo){ doc.setFont('helvetica','bold'); const s=`${T.reportNo} ${r.correlativo}`; doc.text(s, mx, 91); mx+=doc.getTextWidth(s)+14 }
  doc.setFont('helvetica','normal')
  const mA=`${T.issued}: ${fechaEmision}`; doc.text(mA, mx, 91); mx+=doc.getTextWidth(mA)+14
  doc.text(T.exp(gastos.length), mx, 91)
  if(r.dirigido_a){ doc.setFont('helvetica','bold'); doc.text(`${T.attn}: ${r.dirigido_a}`, W-M, 91, {align:'right'}) }
  // ===== KPIs =====
  let y=120; const bw=(W-2*M-12)/3, bh=44
  const kcard=(i,lbl,val,bg,fg)=>{ const x=M+i*(bw+6); doc.setFillColor(bg[0],bg[1],bg[2]); doc.roundedRect(x,y,bw,bh,4,4,'F'); doc.setFont('helvetica','bold'); doc.setFontSize(7); const lc=fg[0]===255?[255,255,255]:[153,171,180]; doc.setTextColor(lc[0],lc[1],lc[2]); doc.text(lbl.toUpperCase(), x+10, y+17); doc.setFontSize(13); doc.setTextColor(fg[0],fg[1],fg[2]); doc.text(val, x+10, y+35) }
  const sPos=saldo>=0
  kcard(0,T.funds,fmtN(totFondos),[245,247,249],cGreen)
  kcard(1,T.expPeriod,fmtN(totGastos),[245,247,249],cTxt)
  kcard(2,sPos?T.balFavor:T.balPending,(saldo<0?'-':'')+fmtN(Math.abs(saldo)),sPos?[225,245,238]:[252,235,235],sPos?cGreen:cRed)
  y+=bh+20
  const ensure=(n)=>{ if(y > H-70-n){ doc.addPage(); y=56 } }
  const filaG=e=>{
    ensure(24)
    const ot=e.ot_number?(String(e.ot_number).toUpperCase().startsWith('OT')?e.ot_number:'OT-'+e.ot_number):''
    const seg2 = !!(ot||e.respaldo)
    doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(61,61,61)
    doc.text(fmtFechaDMY(e.date), M, y)
    doc.text((glosaCliente(e.concept)||'—').slice(0,40), M+72, y)
    doc.setFontSize(8.5); doc.setTextColor(83,114,129); doc.text(RENDCAT(e.category).slice(0,24), cCat, y)
    doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(61,61,61); doc.text(fmtN(e.amount), cMonto, y, {align:'right'})
    if(seg2){ let sx=M+72; doc.setFont('helvetica','bold'); doc.setFontSize(7.5)
      if(ot){ doc.setTextColor(24,95,165); doc.text(ot, sx, y+11); sx+=doc.getTextWidth(ot)+10 }
      if(e.respaldo){ doc.setTextColor(15,110,86); doc.text(EN?'✓ receipt':'✓ respaldo', sx, y+11) }
    }
    y += seg2?23:18
  }
  if(!grp){
  // ===== Proyecto =====
  if(r.project){ doc.setFont('helvetica','bold'); doc.setFontSize(7.5); doc.setTextColor(83,114,129); doc.text(T.project, M, y); doc.setFont('helvetica','normal'); doc.setFontSize(10.5); doc.setTextColor(61,61,61); doc.text(String(r.project+(r.subproject?` · ${r.subproject}`:'')).slice(0,70), M+58, y); y+=20 }
  // ===== Tabla gastos =====
  doc.setTextColor(83,114,129); doc.setFont('helvetica','bold'); doc.setFontSize(8)
  doc.text(T.date, M, y); doc.text(T.concept, M+72, y); doc.text(T.category, cCat, y); doc.text(T.amount, cMonto, y, {align:'right'})
  y+=7; doc.setDrawColor(228,232,235); doc.setLineWidth(1); doc.line(M,y,W-M,y); y+=16
  gastos.forEach(filaG)
  y+=2; doc.setDrawColor(0,60,80); doc.setLineWidth(1.2); doc.line(M,y,W-M,y); y+=16
  doc.setFont('helvetica','bold'); doc.setFontSize(10.5); doc.setTextColor(61,61,61); doc.text(T.totalExp, M, y); doc.text(fmtN(totGastos), cMonto, y, {align:'right'}); y+=28
  // ===== Fondos recibidos =====
  ensure(40); doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(0,60,80); doc.text(T.fundsSection, M, y); y+=16
  if(fondos.length){ fondos.forEach(f=>{ ensure(16); doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(61,61,61); doc.text(fmtFechaDMY(f.date), M, y); doc.text(String(f.concept||T.received).slice(0,52), M+72, y); doc.setFont('helvetica','bold'); doc.setTextColor(15,110,86); doc.text(fmtN(f.amount), cMonto, y, {align:'right'}); y+=16 }) }
  else { doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(83,114,129); doc.text(T.noFunds, M, y); y+=16 }
  y+=10
  // ===== Resumen del fondo (si hay rendiciones previas) =====
  if(previas&&previas.length){
    const boxH = 36 + (previas.length+2)*15 + 16
    ensure(boxH+10); doc.setFillColor(0,60,80); doc.roundedRect(M,y,W-2*M,boxH,6,6,'F')
    let yy=y+20; doc.setTextColor(153,171,180); doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.text(T.fundSummary, M+16, yy); yy+=17
    const lrow=(lbl,val,neg)=>{ doc.setFont('helvetica','normal'); doc.setFontSize(9.5); doc.setTextColor(153,171,180); doc.text(lbl, M+16, yy); doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.text((neg?'-':'')+fmtN(val), W-M-16, yy, {align:'right'}); yy+=15 }
    lrow(T.received, totFondos)
    previas.forEach(pp=>lrow(`${T.prev} ${pp.fecha?fmtFechaDMY(String(pp.fecha).slice(0,10)):''}`, pp.total, true))
    lrow(T.thisRep, totGastos, true)
    yy+=3; doc.setDrawColor(90,110,125); doc.setLineWidth(0.5); doc.line(M+16,yy-9,W-M-16,yy-9)
    doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(255,255,255); doc.text(T.avail, M+16, yy+4); doc.text((saldo<0?'-':'')+fmtN(saldo), W-M-16, yy+4, {align:'right'})
    y += boxH+14
  }
  } else {
    // 2+ proyectos: bloque por proyecto (razón social, gastos, fondos, rendido antes, saldo) + imputación de saldos.
    const L=EN?{proj:'PROJECT',exp:'Project expenses',prev:'Previously reported',fav:'Balance in favor of the project',due:'Balance to cover',imp:'SUMMARY BY PROJECT · BALANCE ALLOCATION',others:'Other funds and previous reports',note:'Balances in favor are applied to the balances to cover',tot:sPos?T.balFavor:T.balPending}:{proj:'PROYECTO',exp:'Gastos del proyecto',prev:'Rendido anteriormente',fav:'Saldo a favor del proyecto',due:'Saldo por cubrir del proyecto',imp:'RESUMEN POR PROYECTO · IMPUTACIÓN DE SALDOS',others:'Otros fondos y rendiciones anteriores',note:'Los saldos a favor se imputan a los saldos por cubrir',tot:sPos?T.balFavor:T.balPending}
    const sgn=v=>(v<0?'-':v>0?'+':'')+fmtN(Math.abs(v))
    grp.grupos.forEach((x,i)=>{
      ensure(80)
      doc.setFont('helvetica','bold'); doc.setFontSize(7.5); doc.setTextColor(83,114,129); doc.text(`${L.proj} ${i+1}`, M, y)
      if(x.ent){ doc.setFontSize(8.5); doc.setTextColor(61,61,61); doc.text(String(x.ent.name).slice(0,52), W-M, y, {align:'right'}) }
      y+=13; doc.setFont('helvetica','bold'); doc.setFontSize(11.5); doc.setTextColor(0,60,80); doc.text(String(x.proyecto||'—').slice(0,58), M, y)
      if(x.ent&&x.ent.rut){ doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(83,114,129); doc.text(fmtRutCL(x.ent.rut), W-M, y, {align:'right'}) }
      y+=7; doc.setDrawColor(0,60,80); doc.setLineWidth(1.2); doc.line(M,y,W-M,y); y+=14
      doc.setTextColor(83,114,129); doc.setFont('helvetica','bold'); doc.setFontSize(8)
      doc.text(T.date, M, y); doc.text(T.concept, M+72, y); doc.text(T.category, cCat, y); doc.text(T.amount, cMonto, y, {align:'right'}); y+=16
      x.gastos.forEach(filaG)
      y+=2; doc.setDrawColor(228,232,235); doc.setLineWidth(0.8); doc.line(M,y,W-M,y); y+=14
      doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(61,61,61); doc.text(L.exp, M, y); doc.text(fmtN(x.totGastos), cMonto, y, {align:'right'}); y+=18
      if(x.fondos.length){ ensure(30); doc.setFont('helvetica','bold'); doc.setFontSize(8.5); doc.setTextColor(0,60,80); doc.text(T.fundsSection, M, y); y+=14
        x.fondos.forEach(fo=>{ ensure(16); doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(61,61,61); doc.text(fmtFechaDMY(fo.date), M, y); doc.text(String(fo.concept||T.received).slice(0,52), M+72, y); doc.setFont('helvetica','bold'); doc.setTextColor(15,110,86); doc.text(fmtN(fo.amount), cMonto, y, {align:'right'}); y+=16 }) }
      if(x.previo){ ensure(16); doc.setFont('helvetica','normal'); doc.setFontSize(9.5); doc.setTextColor(83,114,129); doc.text(L.prev, M, y); doc.text('-'+fmtN(x.previo), cMonto, y, {align:'right'}); y+=16 }
      ensure(26); const neg=x.saldo<0; doc.setFillColor(neg?252:225,neg?235:245,neg?235:238); doc.roundedRect(M,y-4,W-2*M,22,4,4,'F')
      doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(neg?163:15,neg?45:110,neg?45:86); doc.text(neg?L.due:L.fav, M+10, y+11); doc.text(sgn(x.saldo), W-M-10, y+11, {align:'right'}); y+=36
    })
    const mixto=grp.grupos.some(x=>x.saldo>0)&&grp.grupos.some(x=>x.saldo<0)
    const nL=grp.grupos.length+(Math.round(grp.otros)?1:0)+(mixto?1:0)
    const boxH=36+nL*15+20
    ensure(boxH+10); doc.setFillColor(0,60,80); doc.roundedRect(M,y,W-2*M,boxH,6,6,'F')
    let yy=y+20; doc.setTextColor(153,171,180); doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.text(L.imp, M+16, yy); yy+=17
    const lrow=(lbl,val,muted)=>{ doc.setFont('helvetica',muted?'normal':'bold'); doc.setFontSize(9.5); doc.setTextColor(muted?153:255,muted?171:255,muted?180:255); doc.text(String(lbl).slice(0,62), M+16, yy); if(val) doc.text(val, W-M-16, yy, {align:'right'}); yy+=15 }
    grp.grupos.forEach(x=>lrow(x.proyecto||'—', sgn(x.saldo)))
    if(Math.round(grp.otros)) lrow(L.others, sgn(grp.otros))
    if(mixto) lrow(L.note, '', true)
    yy+=3; doc.setDrawColor(90,110,125); doc.setLineWidth(0.5); doc.line(M+16,yy-9,W-M-16,yy-9)
    doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(255,255,255); doc.text(L.tot, M+16, yy+4); doc.text((saldo<0?'-':'')+fmtN(Math.abs(saldo)), W-M-16, yy+4, {align:'right'})
    y += boxH+14
  }
  // ===== Saldo a su cargo (si el cliente debe) =====
  if(saldo<0){
    const rows = EN?[`Account holder: ${BRAND.nombreLegalCorto}`,`Tax ID (RUT): ${fmtRutCL(BRAND.rut)}`,`Bank: ${BRAND.pago.gastos.banco}`,`Checking account: ${BRAND.pago.gastos.cuentaFmt}`,`Confirmation: ${BRAND.pago.gastos.email}`]:[`Titular: ${BRAND.nombreLegalCorto}`,`RUT: ${fmtRutCL(BRAND.rut)}`,`Banco: ${BRAND.pago.gastos.banco}`,`Cuenta Corriente: ${BRAND.pago.gastos.cuentaFmt}`,`Confirmación: ${BRAND.pago.gastos.email}`]
    const boxH = 30 + rows.length*15
    ensure(boxH+10); doc.setFillColor(252,235,235); doc.roundedRect(M,y,W-2*M,boxH,6,6,'F')
    let yy=y+20; doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(61,61,61); doc.text(`${T.due}: ${fmtN(Math.abs(saldo))}`, M+16, yy); yy+=17
    doc.setFont('helvetica','normal'); doc.setFontSize(9.5); doc.setTextColor(83,114,129); rows.forEach(l=>{ doc.text(l, M+16, yy); yy+=15 })
    y += boxH+14
  }
  // ===== Footer =====
  const fy=H-28; doc.setDrawColor(228,232,235); doc.setLineWidth(0.5); doc.line(M,fy-12,W-M,fy-12)
  doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(83,114,129)
  doc.text(`${BRAND.direccion} · ${BRAND.web}`, M, fy)
  doc.text(T.footer, W-M, fy, {align:'right'})
  return doc.output('datauristring').split(',')[1]
}

// PDF de la liquidación de caja chica (jsPDF) → base64. Agrupado por cliente, mismo estilo que la rendición.
export async function liquidacionPdfBase64({me, periodo, gastos, clients, titulo, resumen, anexo}){
  const { jsPDF } = await import('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm')
  const doc = new jsPDF({unit:'pt', format:'letter'})
  const W = doc.internal.pageSize.getWidth()
  const _tit = titulo || 'Liquidación de caja chica'
  const total = (gastos||[]).reduce((a,e)=>a+(e.amount||0),0)
  const porCliente = {}
  ;(gastos||[]).forEach(e=>{ const cn=(clients||[]).find(c=>c.id===e.client_id)?.name||'Sin cliente'; (porCliente[cn]=porCliente[cn]||[]).push(e) })
  doc.setFillColor(0,60,80); doc.rect(0,0,W,74,'F')
  doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(16)
  doc.text(_tit, 40, 34)
  doc.setFont('helvetica','normal'); doc.setFontSize(10)
  doc.text(`${me||''} · ${periodo||''}`, 40, 54)
  // Logo del estudio (BRAND, mismo que la rendición al cliente y los correos). Si no carga, cae al nombre en texto.
  let logoOk=false
  try{ const r=await fetch(BRAND.logo.blanco); const bl=await r.blob(); const dataUrl=await new Promise((res,rej)=>{ const fr=new FileReader(); fr.onload=()=>res(fr.result); fr.onerror=rej; fr.readAsDataURL(bl) }); const im=await new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=rej; i.src=dataUrl }); const lh=22, lw=im.naturalWidth&&im.naturalHeight?im.naturalWidth/im.naturalHeight*lh:140; doc.addImage(dataUrl,'PNG',W-40-lw,37-lh/2,lw,lh); logoOk=true }catch(_){}
  if(!logoOk){ doc.setFont('helvetica','bold'); doc.setFontSize(12); doc.text(String(BRAND.nombre||'').toUpperCase(), W-40, 44, {align:'right'}) }
  const bw=(W-80-12)/3, by=86, bh=42
  const kcard=(i,lbl,val)=>{ const x=40+i*(bw+6); doc.setFillColor(245,247,249); doc.roundedRect(x,by,bw,bh,4,4,'F'); doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(153,171,180); doc.text(lbl.toUpperCase(), x+10, by+16); doc.setFontSize(13); doc.setTextColor(61,61,61); doc.text(val, x+10, by+34) }
  kcard(0,'N° de gastos', String((gastos||[]).length))
  kcard(1,'Clientes', String(Object.keys(porCliente).length))
  kcard(2,'Total a rendir', fmtN(total))
  let y=160
  // Segunda fila (estado de la caja): Fondo recibido · Gastado · Saldo / Cubierto — a reembolsar (lo que el miembro puso de su bolsillo).
  if(resumen){
    const by2=by+bh+8
    const k2=(i,lbl,val,rojo)=>{ const x=40+i*(bw+6); doc.setFillColor(rojo?252:245,rojo?235:247,rojo?235:249); doc.roundedRect(x,by2,bw,bh,4,4,'F'); doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(rojo?163:153,rojo?45:171,rojo?45:180); doc.text(lbl.toUpperCase(), x+10, by2+15); doc.setFontSize(12); doc.setTextColor(rojo?163:0,rojo?45:60,rojo?45:80); doc.text(val, x+10, by2+32) }
    const cub=Math.max(0,-(resumen.saldo||0))
    k2(0,'Fondo recibido', fmtN(resumen.fondo))
    k2(1,'Gastado', fmtN(resumen.gastado))
    if(cub>0) k2(2,`Cubierto por ${String(me||'').split(' ')[0]} — a reembolsar`, fmtN(cub), true); else k2(2,'Saldo de caja', fmtN(resumen.saldo))
    y=by2+bh+32
  }
  Object.entries(porCliente).forEach(([cn,gs])=>{
    const tot=gs.reduce((a,e)=>a+(e.amount||0),0)
    if(y>690){ doc.addPage(); y=60 }
    doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(0,60,80)
    doc.text(`${String(cn).slice(0,50)} — ${fmtN(tot)}`, 40, y); y+=8
    doc.setDrawColor(0,60,80); doc.setLineWidth(1.2); doc.line(40,y,W-40,y); y+=18
    gs.forEach(e=>{
      if(y>700){ doc.addPage(); y=60 }
      doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(61,61,61)
      doc.text(fmtFechaDMY(e.date), 40, y)
      doc.text((String(e.concept||'—')+(e.ot_number?` · ${e.ot_number}`:'')).slice(0,52), 130, y)
      doc.setFontSize(8.5); doc.setTextColor(83,114,129)
      doc.text(String(e.category||'Otro').slice(0,20), 130, y+11)
      doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(226,75,74)
      doc.text('-'+fmtN(e.amount), W-40, y, {align:'right'})
      y+=26
    })
    y+=6
  })
  if(y>700){ doc.addPage(); y=60 }
  doc.setDrawColor(83,114,129); doc.setLineWidth(1.5); doc.line(40,y,W-40,y); y+=20
  doc.setTextColor(61,61,61); doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.text('TOTAL LIQUIDACIÓN', 40, y)
  doc.setTextColor(226,75,74); doc.text('-'+fmtN(total), W-40, y, {align:'right'})
  y+=30; doc.setTextColor(61,61,61); doc.setFont('helvetica','normal'); doc.setFontSize(10)
  doc.text('Atentamente,', 40, y); y+=15
  doc.setFont('helvetica','bold'); doc.text(me||'', 40, y); y+=14
  doc.setFont('helvetica','normal'); doc.text(BRAND.nombre, 40, y)
  // Anexo (anexoCajaChica): por categoría, caja chica por mes con su promedio y clientes con más gasto en 6 meses.
  if(anexo&&(anexo.categorias||[]).length){
    doc.addPage(); doc.setFillColor(0,60,80); doc.rect(0,0,W,52,'F'); doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(14)
    doc.text(`Anexo · ${me||''}`, 40, 32); let ay=86
    const tabla=(tit,filas,pie)=>{ if(ay>660){ doc.addPage(); ay=60 }
      doc.setFont('helvetica','bold'); doc.setFontSize(10.5); doc.setTextColor(0,60,80); doc.text(tit.toUpperCase(), 40, ay); ay+=7
      doc.setDrawColor(0,60,80); doc.setLineWidth(1); doc.line(40,ay,W-40,ay); ay+=16
      filas.forEach(([a,b,c])=>{ if(ay>720){ doc.addPage(); ay=60 }
        doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(61,61,61); doc.text(String(a).slice(0,56), 40, ay)
        doc.setTextColor(83,114,129); doc.text(String(b), W-170, ay, {align:'right'})
        doc.setFont('helvetica','bold'); doc.setTextColor(61,61,61); doc.text(String(c), W-40, ay, {align:'right'}); ay+=17 })
      if(pie){ doc.setDrawColor(228,232,235); doc.line(40,ay-8,W-40,ay-8); doc.setFont('helvetica','bold'); doc.setTextColor(61,61,61); doc.text(pie[0], 40, ay+4); doc.text(pie[1], W-40, ay+4, {align:'right'}); ay+=20 }
      ay+=14 }
    const g=n=>`${n} gasto${n!==1?'s':''}`
    tabla('Por categoría · esta liquidación', anexo.categorias.map(x=>[x.cat, g(x.n), fmtN(x.total)]))
    tabla('Caja chica por mes', anexo.porMes.map(x=>[x.etiqueta, g(x.n), fmtN(x.total)]), ['Promedio mensual', fmtN(anexo.promedio)])
    if((anexo.clientes||[]).length) tabla('Clientes con más gasto · 6 meses', anexo.clientes.map(x=>[x.name, g(x.n), fmtN(x.total)]))
  }
  return doc.output('datauristring').split(',')[1]
}

