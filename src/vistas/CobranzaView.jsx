// Movido desde App.jsx por scripts/mover-a-modulo.py. Sin cambios de comportamiento.
import { useState, useEffect, useMemo, Fragment } from 'react'
import { supabase, DEMO } from '../supabase'
import { C, Gl, SEC_LBL, SIcon, Spin, _normTxt, appAlert, appConfirm, fmtFechaDMY, folioN, personChip, useIsDesktop } from '../lib/base.jsx'
import { Buscador, FlujoPagina, Modal, NOMBRE_CLI, PageHeader, TH_BAND, TIT_PAG, avisoNoEnviado, bigDate, daysLeft, daysLeftB, enviarComoUsuario, esVencidaB, facturaPdfAdjunto, fmtMill, modoEnvioLote, nDias, pillPersonaSty, recordatorioCobro, rsDeFactura, rsDisplay, saldoBill, setLearningKV, txtEnviado, txtResumenEnvio, useTrabajosDetenidos, verFacturaPdf, viewMemGuardar, viewMemLeer, registrarError, logActividad, venceBill, okDB } from '../lib/compartido.jsx'
import { TRAMOS, enFiltroMora, estadoCompromiso, exposicionCartera, puntualidadPorCliente } from '../../supabase/functions/_shared/cobranzaExposicion.js'

// Cadencia de cobranza (fuente única): ¿toca recordatorio para esta factura hoy? Escala por mora,
// respeta un piso de días entre envíos para no spamear. lastISO = fecha del último recordatorio (factura_recordado).
export const COBRANZA_GAP = 7   // días mínimos entre recordatorios de una misma factura

export function facturaCobrable(b){ return b && saldoBill(b)>0 && b.invoice_no && b.status!=='Programada' && b.status!=='Anulada' && b.billing_type!=='reembolso' && !b.deleted_at }

export function cobranzaAccion(b, lastISO, hoyISO){
  if(!facturaCobrable(b)) return null
  const dl=daysLeftB(b); const diasVenc=(dl!=null&&dl<0)?-dl:0   // fuente única (emisión+30), no el due crudo
  if(diasVenc<=0) return null   // solo vencidas (la etapa amable pre-vencimiento no se automatiza)
  const gap = lastISO ? Math.round((new Date(hoyISO+'T00:00')-new Date(String(lastISO).slice(0,10)+'T00:00'))/86400000) : null
  if(gap!=null && gap<COBRANZA_GAP) return null   // aún dentro del piso, no reenviar
  return { nivel: diasVenc<=30?'firme':'final', diasVenc, gap }
}

// Vista previa + flexibilidad del recordatorio de cobro: elegir qué facturas incluir (vencidas marcadas por
// defecto; al día seleccionables), un solo correo con todas o uno por factura, y re-adjuntar el PDF. El preview
// del correo está SIEMPRE visible (desplegable). El envío efectivo lo hace el padre vía onEnviar (fuente única).
export function RecordatorioModal({ grupo, to, nombre, clientEntities=[], sending, nota:notaProp='', onClose, onEnviar, asPage=false }){
  const isDesktop = useIsDesktop()
  const cand = grupo.items   // {b, acc, venc, diasVenc} — vencidas y al día
  const [sel,setSel] = useState(()=> new Set(cand.filter(x=>x.venc).map(x=>String(x.b.id))))
  const [combinado,setCombinado] = useState(true)   // un solo correo con todas (default) vs uno por factura
  const [adjuntar,setAdjuntar] = useState(true)      // re-adjuntar el PDF con timbre de cada factura
  const [verPreview,setVerPreview] = useState(true)  // preview desplegable, abierto por defecto
  const [nota,setNota] = useState(notaProp)          // nota libre por cliente (opcional), persistente
  const f0 = n=>'$'+Math.round(n||0).toLocaleString('es-CL')
  const toggle = id=>setSel(s=>{ const n=new Set(s); n.has(id)?n.delete(id):n.add(id); return n })
  const selItems = cand.filter(x=>sel.has(String(x.b.id)))
  const selBs = selItems.map(x=>x.b)
  const totalSel = selItems.reduce((a,x)=>a+(saldoBill(x.b)||x.b.amount||0),0)
  const preview = selBs.length ? recordatorioCobro(combinado?selBs:selBs[0], nota) : null
  const nCorreos = combinado?1:selBs.length
  const okDisabled = sending || !selBs.length
  const chk = on=>({width:18,height:18,borderRadius:6,border:`1.5px solid ${on?C.accent:C.done}`,background:on?C.accent:'#fff',flexShrink:0,display:'inline-flex',alignItems:'center',justifyContent:'center'})
  const Row = ({label,desc,on,onToggle,disabled})=> (
    <div onClick={disabled?undefined:onToggle} style={{display:'flex',alignItems:'center',gap:9,padding:'8px 0',cursor:disabled?'default':'pointer',opacity:disabled?.5:1}}>
      <span style={{width:34,height:19,borderRadius:20,background:on?C.greenText:C.done,position:'relative',flexShrink:0,transition:'background .15s'}}><span style={{position:'absolute',top:2,left:on?17:2,width:15,height:15,borderRadius:'50%',background:'#fff',transition:'left .15s'}}/></span>
      <div style={{minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:C.text}}>{label}</div>{desc&&<div style={{fontSize:11,color:C.muted,lineHeight:1.4}}>{desc}</div>}</div>
    </div>
  )
  const _body = (<>
      <div style={{fontSize:12,color:C.muted,marginBottom:12,lineHeight:1.5}}><b style={{color:C.text}}>Para:</b> {to} · <b style={{color:C.text}}>{nombre}</b> · firma <b style={{color:C.text}}>Administración</b></div>
      <div style={{display:isDesktop?'grid':'block',gridTemplateColumns:isDesktop?'1fr 1fr':undefined,gap:18}}>
        {/* Columna 1: opciones */}
        <div>
          <div style={{...SEC_LBL,marginBottom:6}}>Facturas a incluir</div>
          <div style={{border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden',marginBottom:14}}>
            {cand.map(x=>{ const id=String(x.b.id); const on=sel.has(id); const s=saldoBill(x.b)||x.b.amount||0
              return (
              <div key={id} onClick={()=>toggle(id)} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 11px',borderTop:`1px solid ${C.bgSoft}`,cursor:'pointer',background:on?'#fff':C.bgSoft}}>
                <span style={chk(on)}>{on&&<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.4"><path d="M5 13l4 4L19 7"/></svg>}</span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:700,color:on?C.accent:C.muted,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>Factura N° {folioN(x.b.invoice_no)||'—'}{x.b.concept?<span style={{fontWeight:500,color:C.muted}}> · {x.b.concept}</span>:''}</div>
                  <div style={{fontSize:11,color:x.venc?C.soonText:C.done}}>{x.venc?`Vencida hace ${nDias(x.diasVenc)}`:'Al día'}</div>
                </div>
                <div style={{fontSize:13,fontWeight:700,color:on?C.text:C.muted,fontVariantNumeric:'tabular-nums',flexShrink:0}}>{f0(s)}</div>
              </div>) })}
          </div>
          {selBs.length>1 && <Row label='Un solo correo con todas' desc={combinado?'Se lista cada factura y el total en un mismo correo.':'Se envía un correo por cada factura seleccionada.'} on={combinado} onToggle={()=>setCombinado(v=>!v)}/>}
          <Row label='Adjuntar la(s) factura(s) en PDF' desc='Se re-genera el PDF con timbre de cada factura incluida.' on={adjuntar} onToggle={()=>setAdjuntar(v=>!v)}/>
          <div style={{fontSize:10,fontWeight:800,textTransform:'uppercase',letterSpacing:.4,color:C.textSoft,margin:'12px 0 5px'}}>Nota para este cliente · opcional</div>
          <textarea value={nota} onChange={e=>setNota(e.target.value)} rows={2} placeholder='Ej. Cualquier consulta sobre esta factura, con gusto les ayudamos. ¡Gracias!' style={{width:'100%',border:`1px solid ${C.border}`,borderRadius:8,padding:'8px 10px',fontSize:12.5,lineHeight:1.5,color:C.text,fontFamily:'inherit',resize:'vertical',boxSizing:'border-box'}}/>
          <div style={{fontSize:10.5,color:C.muted,marginTop:4}}>Va dentro del correo y se recuerda para este cliente. Las cifras del cobro se arman solas.</div>
        </div>
        {/* Columna 2: preview siempre visible, desplegable */}
        <div>
          <div onClick={()=>setVerPreview(v=>!v)} style={{display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer',marginBottom:6}}>
            <span style={{fontSize:10,fontWeight:800,textTransform:'uppercase',letterSpacing:.4,color:C.textSoft}}>Vista previa del correo</span>
            <span style={{fontSize:11,fontWeight:700,color:C.azulInfo}}>{verPreview?<>Ocultar{" "}<Gl n='chevU'/></>:<>Ver{" "}<Gl n='chevD'/></>}</span>
          </div>
          {verPreview && (preview
            ? <>
                <div style={{fontSize:11,color:C.muted,marginBottom:7,lineHeight:1.5}}><b style={{color:C.text}}>Asunto:</b> {preview.subject}{!combinado&&selBs.length>1?<span style={{color:C.soonText}}> · +{selBs.length-1} correo{selBs.length-1!==1?'s':''} más</span>:''}</div>
                <div style={{border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden',background:'#fff',maxHeight:isDesktop?'52vh':'40vh',overflowY:'auto'}}><div style={{padding:12}} dangerouslySetInnerHTML={{__html:preview.html}}/></div>
              </>
            : <div style={{fontSize:12,color:C.muted,background:C.bgSoft,border:`1px solid ${C.border}`,borderRadius:10,padding:16,textAlign:'center'}}>Selecciona al menos una factura para ver el correo.</div>)}
        </div>
      </div>
      <div style={{display:'flex',gap:9,justifyContent:'flex-end',alignItems:'center',marginTop:16,borderTop:`1px solid ${C.border}`,paddingTop:13}}>
        <div style={{marginRight:'auto',fontSize:11,color:C.muted}}>{selBs.length} factura{selBs.length!==1?'s':''} · {f0(totalSel)} · {nCorreos} correo{nCorreos!==1?'s':''}</div>
        <button onClick={onClose} style={{background:'none',border:`1px solid ${C.border}`,borderRadius:10,padding:'9px 16px',fontSize:13,color:C.muted,cursor:'pointer'}}>Cancelar</button>
        <button disabled={okDisabled} onClick={()=>onEnviar({bs:selBs, combinado:selBs.length>1?combinado:true, adjuntar, nota})} style={{background:okDisabled?C.done:C.accent,border:'none',borderRadius:10,padding:'9px 18px',fontSize:13,fontWeight:700,color:'#fff',cursor:okDisabled?'default':'pointer',display:'inline-flex',alignItems:'center',gap:7}}>{sending?<Spin/>:null}{sending?'Enviando…':`Enviar ${nCorreos>1?`(${nCorreos})`:'recordatorio'}`}</button>
      </div>
  </>)
  return asPage ? _body : <Modal fullscreen fsMaxWidth={isDesktop?900:640} title='Recordatorio de cobro' onClose={onClose}>{_body}</Modal>
}

// ─── COBRANZA AUTÓNOMA (Fase 1: cockpit con gate humano + aprendizaje "se libera") ────────────────
// Patrón FirmDesk: la app propone el recordatorio que TOCA hoy (cadencia cobranzaAccion), tú confirmas.
// Cada confirmación por cliente suma; al llegar al umbral, ofrece "liberar" ese cliente a automático (cron, Fase 3).
export function CobranzaView({ billing=[], clients=[], sales=[], clientEntities=[], expenses=[], tasks=[], currentUserName, onOpenClientFicha, onOpenFactura, onIrConciliacion, onClose, origen, filtroInicial=null, onFiltroListo }){
  const isDesktop = useIsDesktop()   // Fase 3: columna más ancha en escritorio
  const LIBERAR_UMBRAL = 3
  const [recMap,setRecMap] = useState({})      // factura.id → fecha ISO último recordatorio
  const [okCount,setOkCount] = useState({})    // client_id → nº de tandas confirmadas (aprendizaje)
  const [autoCli,setAutoCli] = useState({})    // client_id → true si liberado a automático
  const [sending,setSending] = useState(null)  // client_id en envío
  const [recPrev,setRecPrev] = useState(null)  // vista previa del recordatorio antes de enviar
  const [qCob,setQCob] = useState('')          // buscador: cliente, N° de factura, RUT o concepto
  const [recNotaMap,setRecNotaMap] = useState({})   // client_id → nota libre del recordatorio (persistente)
  const [autoGlobal,setAutoGlobal] = useState(false)   // interruptor GLOBAL: la app envía sola los recordatorios de los clientes liberados (config cobranza_auto; lo lee el edge fn cobranza-auto). Sin esto, "En automático" queda inerte.
  const [sortBy,setSortBy] = useState(()=>viewMemLeer('cobranza')?.sortBy||{col:'total',dir:'desc'})   // orden de la lista (móvil + escritorio)
  const [expCli,setExpCli] = useState(()=>viewMemLeer('cobranza')?.expCli??null)
  useEffect(()=>{ viewMemGuardar('cobranza',{sortBy,expCli}) },[sortBy,expCli])   // escritorio: cliente con sus facturas desplegadas
  const [reembOpen,setReembOpen] = useState(false)   // sección Reembolsos por cobrar: plegada por defecto
  const [tramoF,setTramoF] = useState(()=>filtroInicial??null)   // antigüedad: null (todas) | 0 a 4 (tramo) | 'm60' (más de 60 días)
  useEffect(()=>{ if(filtroInicial!=null){ setTramoF(filtroInicial); onFiltroListo&&onFiltroListo() } },[filtroInicial])   // eslint-disable-line
  const [compMap,setCompMap] = useState({})    // client_id → compromiso de pago {fecha, por, monto, creado, quien} (learnings cobranza_compromiso)
  const [movTab,setMovTab] = useState('fac')   // móvil, cliente desplegado: 'fac' (facturas) | 'ges' (gestión)
  const [compPage,setCompPage] = useState(null)   // client_id con la hoja «Compromiso de pago» abierta
  const [compForm,setCompForm] = useState({fecha:'',por:'',monto:''})
  const [aboFilter,setAboFilter] = useState(null)   // anillo de abogado seleccionado → filtra la lista de clientes (hero y anillos siguen globales)
  const hoy = new Date().toLocaleDateString('en-CA',{timeZone:'America/Santiago'})
  const cn = id => clients.find(c=>String(c.id)===String(id))?.name || 'Cliente'
  const f0 = n => '$'+Math.round(n||0).toLocaleString('es-CL')
  const fM = n => fmtMill(n||0)   // compacto para la foto (hero + anillos); el detalle por factura mantiene el peso exacto
  // Trabajo detenido con saldo (misma regla que Revisión de datos): sale_id → {ult, dias}. Marca tenue en la factura, sin otra cifra.
  const detTrab = useTrabajosDetenidos({sales,billing,expenses,tasks})
  const detPorVenta = useMemo(()=>Object.fromEntries(detTrab.filter(x=>x.tipo==='con_saldo').map(x=>[String(x.s.id),x])),[detTrab])
  useEffect(()=>{
    if(DEMO){ setRecMap({}); setOkCount({c4:3}); setAutoCli({}); setAutoGlobal(false); setCompMap({}); return }
    supabase.from('learnings').select('kind,key,value').in('kind',['factura_recordado','cobranza_ok','fd_auto','config','recordatorio_nota','cobranza_compromiso']).then(({data})=>{
      const rm={},ok={},au={},nm={},cm={}; let ag=false; (data||[]).forEach(r=>{ if(r.kind==='factura_recordado') rm[r.key]=r.value; else if(r.kind==='cobranza_ok') ok[r.key]=Number(r.value)||0; else if(r.kind==='fd_auto'&&String(r.key).startsWith('cobranza:')) au[String(r.key).slice(9)]=true; else if(r.kind==='config'&&r.key==='cobranza_auto') ag=(String(r.value||'').trim()==='on'); else if(r.kind==='recordatorio_nota'&&r.value) nm[r.key]=r.value; else if(r.kind==='cobranza_compromiso'){ try{ cm[r.key]=JSON.parse(r.value) }catch(_){} } })
      setRecMap(rm); setOkCount(ok); setAutoCli(au); setAutoGlobal(ag); setRecNotaMap(nm); setCompMap(cm)
    },()=>{})
  },[])
  // Agrupa por cliente TODAS las facturas pendientes de pago (vencidas o NO): el usuario quiere ver toda la deuda
  // (hay clientes que pagan muy rápido). Por cliente: total (toda la deuda), vencido (solo lo vencido), maxDias, y
  // nAccion = facturas vencidas que toca recordar hoy (cobranzaAccion). Facturas ordenadas nueva→antigua.
  const grupos = useMemo(()=>{
    const by={}
    ;(billing||[]).forEach(b=>{ if(!facturaCobrable(b)||!['Pendiente','Vencido'].includes(b.status)) return
      const cid=String(b.client_id); const acc=cobranzaAccion(b, recMap[String(b.id)], hoy); const dl=daysLeftB(b); const venc=dl!=null&&dl<0; const s=saldoBill(b)
      const g=(by[cid]=by[cid]||{cid,items:[],total:0,vencido:0,maxDias:0,nivel:'firme',nAccion:0})
      g.items.push({b,acc,venc,diasVenc:venc?-dl:0}); g.total+=s
      if(venc){ g.vencido+=s; g.maxDias=Math.max(g.maxDias,-dl); if(acc&&acc.nivel==='final') g.nivel='final' }
      if(acc) g.nAccion++ })
    Object.values(by).forEach(g=> g.items.sort((x,y)=> String(x.b.issued_at||x.b.due||'').localeCompare(String(y.b.issued_at||y.b.due||'')) ))   // dentro del cliente: antigua (arriba) → nueva (abajo)
    return Object.values(by)
  },[billing,recMap,hoy])
  // Atribución de cada factura a un abogado: la venta (responsible) manda; si no, el responsable del cliente (misma regla que Facturación, App.jsx ~6399).
  const saleById = useMemo(()=>Object.fromEntries((sales||[]).map(s=>[String(s.id),s])),[sales])
  const aboDe = b=>{ const s=b.sale_id?saleById[String(b.sale_id)]:null; const r=(s&&s.responsible)||clients.find(c=>String(c.id)===String(b.client_id))?.abogado_responsable; return (r&&String(r).trim())||'Sin asignar' }
  // Exposición por abogado (SIEMPRE visible, global): total por cobrar + vencido, sobre el MISMO universo cobrable que los grupos. Identifica quién debe apretar el cobro y quién trabaja sin recibir pago.
  const porAbogado = useMemo(()=>{ const by={}
    ;(billing||[]).forEach(b=>{ if(!facturaCobrable(b)||!['Pendiente','Vencido'].includes(b.status)) return
      const a=aboDe(b); const s=saldoBill(b); const dl=daysLeftB(b); const venc=dl!=null&&dl<0
      const g=(by[a]=by[a]||{abo:a,total:0,vencido:0,n:0,nVenc:0}); g.total+=s; g.n++; if(venc){g.vencido+=s;g.nVenc++} })
    return Object.values(by).sort((x,y)=>y.total-x.total)
  },[billing,saleById,clients])   // eslint-disable-line
  // Lista de clientes filtrable por abogado (al tocar un anillo). El hero y los anillos NO se filtran: son la foto global.
  const gruposView = useMemo(()=>{ if(!aboFilter&&tramoF==null) return grupos
    return grupos.map(g=>{ const items=g.items.filter(x=>(!aboFilter||aboDe(x.b)===aboFilter)&&enFiltroMora(tramoF,x.venc?x.diasVenc:0)); if(!items.length) return null
      let total=0,vencido=0,maxDias=0,nAccion=0; items.forEach(x=>{ const s=saldoBill(x.b); total+=s; if(x.venc){vencido+=s;maxDias=Math.max(maxDias,x.diasVenc)} if(x.acc)nAccion++ })
      return {...g,items,total,vencido,maxDias,nAccion} }).filter(Boolean)
  },[grupos,aboFilter,tramoF,saleById,clients])   // eslint-disable-line
  // Facturas vencidas ya contactadas hace poco (dentro del piso) — contexto, sin acción.
  const enEspera = useMemo(()=> (billing||[]).filter(b=>{ if(!facturaCobrable(b)) return false; const dl=daysLeft(b.due); if(!(dl!=null&&dl<0)) return false; const last=recMap[String(b.id)]; if(!last) return false; const gap=Math.round((new Date(hoy+'T00:00')-new Date(String(last).slice(0,10)+'T00:00'))/86400000); return gap<COBRANZA_GAP }).length, [billing,recMap,hoy])
  // Reembolsos de gastos facturados e impagos: NO son honorarios (fuera del hero y de los totales, igual que Facturación), pero se cobran → sección aparte.
  const reembolsos = useMemo(()=>{ const qq=_normTxt(qCob.trim())
    return (billing||[]).filter(b=>b&&!b.deleted_at&&b.billing_type==='reembolso'&&b.invoice_no&&['Pendiente','Vencido'].includes(b.status)&&saldoBill(b)>0)
      .filter(b=>(!aboFilter||aboDe(b)===aboFilter)&&(!qq||_normTxt(cn(b.client_id)).includes(qq)||_normTxt(b.concept).includes(qq)||String(folioN(b.invoice_no)||'').includes(qCob.trim())))
      .map(b=>{ const dl=daysLeftB(b); const venc=dl!=null&&dl<0; return {b,acc:null,venc,diasVenc:venc?-dl:0} })
      .sort((x,y)=>String(x.b.issued_at||'').localeCompare(String(y.b.issued_at||'')))
  },[billing,qCob,aboFilter,clients,saleById])   // eslint-disable-line
  const vencidoTotal = grupos.reduce((a,g)=>a+g.vencido,0)
  const deudaTotal = grupos.reduce((a,g)=>a+g.total,0)
  const nVencidas = grupos.reduce((a,g)=>a+g.items.filter(x=>x.venc).length,0)
  // Exposición: antigüedad, concentración y puntualidad (helpers únicos de _shared/cobranzaExposicion.js). Nada sale de «Vencido»: solo se lee.
  const expo = useMemo(()=>exposicionCartera(grupos.flatMap(g=>g.items.map(x=>({cid:g.cid,saldo:saldoBill(x.b),mora:x.venc?x.diasVenc:0})))),[grupos])
  const punt = useMemo(()=>puntualidadPorCliente(billing,hoy),[billing,hoy])
  const gGlobal = useMemo(()=>Object.fromEntries(grupos.map(g=>[g.cid,g])),[grupos])
  const gruposAccion = grupos.filter(g=>g.nAccion>0)   // clientes con vencido que toca recordar hoy
  // Orden compartido (móvil y escritorio): por nombre / N° facturas / monto (deuda total) / vencido / mora, asc o desc.
  const gsort = useMemo(()=>{ const d=sortBy.dir==='desc'?-1:1
    const key={facturas:g=>g.items.length,total:g=>g.total,monto:g=>g.total,vencido:g=>g.vencido,mora:g=>g.maxDias}[sortBy.col]
    const qq=_normTxt(qCob.trim()), qd=qCob.replace(/[^0-9kK]/g,'').toLowerCase()
    const base = !qq ? gruposView : gruposView.filter(g=> _normTxt(cn(g.cid)).includes(qq) || g.items.some(({b})=> (qd.length>=3&&String(folioN(b.invoice_no)||'').includes(qd)) || _normTxt(b.concept).includes(qq) || (qd.length>=4&&String(b.receptor_rut||'').replace(/[^0-9kK]/g,'').toLowerCase().includes(qd)) || _normTxt(rsDeFactura(b,clientEntities)).includes(qq)))
    return [...base].sort((a,b)=> sortBy.col==='cliente' ? (sortBy.dir==='asc'?1:-1)*cn(a.cid).localeCompare(cn(b.cid),'es') : d*((key?key(a):a.total)-(key?key(b):b.total)) )
  },[gruposView,sortBy,qCob,clientEntities])
  // Contexto: "Por cobrar total" (todo lo emitido sin pagar, vencido + al día) para explicar la diferencia con Facturación. Cobranza actúa solo sobre lo vencido.
  const _cobr=b=>!b.deleted_at && b.invoice_no && !['reembolso','nota_credito'].includes(b.billing_type) && ['Pendiente','Vencido'].includes(b.status) && saldoBill(b)>0
  const nAlDia=(billing||[]).filter(b=>_cobr(b)&&!esVencidaB(b)).length   // "al día" por la FUENTE ÚNICA (emisión+30), no el due crudo → consistente con la lista

  // Correo del cliente igual que los envíos de facturas: ficha → correo aprendido (factura_to) → contactos.
  const resolverTo = async(g)=>{ const cl=clients.find(c=>String(c.id)===String(g.cid)); let to=(cl?.email||'').trim()
    if(!to){ try{ const {data}=await supabase.from('learnings').select('value').eq('kind','factura_to').eq('key',String(g.cid)).maybeSingle(); if(data?.value) to=String(data.value).split(/[,;]/)[0].trim() }catch(_){} }
    if(!to){ try{ const {data}=await supabase.from('contacts').select('email,principal').eq('client_id',g.cid); const c=(data||[]).find(x=>x.principal&&x.email)||(data||[]).find(x=>x.email); if(c) to=String(c.email).trim() }catch(_){} }
    if(!to && DEMO) to='cliente@ejemplo.cl'   // demo: correo de ejemplo para poder ver la vista previa (no se envía)
    return (to&&/@/.test(to))?to:null }
  // Abre la vista previa (RecordatorioModal): el usuario elige facturas, un correo o varios, y adjuntar el PDF.
  async function enviarCliente(g){
    const toRem=g.items.filter(x=>x.acc)   // vencidas que toca recordar hoy
    if(!toRem.length){ appAlert('Este cliente no tiene facturas vencidas por recordar.'); return }
    const to=await resolverTo(g)
    if(!to){ appAlert('Ese cliente no tiene correo (ni en la ficha, ni aprendido de facturas, ni en contactos). Agrégalo para recordar.'); return }
    setRecPrev({g, to, nombre:cn(g.cid), nota:recNotaMap[g.cid]||''})
  }
  // Envío efectivo (fuente única): combinado (un correo con todas) o separado (uno por factura), con/ sin PDF adjunto.
  async function doEnviar({g, to, bs, combinado, adjuntar, nota, modo}){
    if(!bs.length) return {ok:0,no:0}
    // Varios correos para un cliente (uno por factura): la cuenta de salida se decide una sola vez.
    const lote = modo || (!combinado && bs.length>1 ? await modoEnvioLote(bs.length) : undefined)
    if(lote==='cancelar'){ if(!modo) appAlert(txtResumenEnvio({ok:0,no:bs.length,que:'recordatorios'})); return {ok:0,no:combinado?1:bs.length} }
    setSending(g.cid)
    const sentIds=[]; let nCorreos=0, viaUlt=null, errEnv=null
    try{
      if(DEMO){ await new Promise(r=>setTimeout(r,400)); bs.forEach(b=>sentIds.push(String(b.id))) }
      else{
        const build=async(x)=>{ const r=recordatorioCobro(x, nota); let attachments=null
          if(adjuntar){ const list=Array.isArray(x)?x:[x]; const a=[]; for(const b of list){ const ad=await facturaPdfAdjunto(b); if(ad) a.push(ad) } if(a.length) attachments=a }
          return {r, attachments} }
        if(combinado){ const {r,attachments}=await build(bs); const via=await enviarComoUsuario({to, subject:r.subject, html:r.html, text:r.text, attachments, que:`El recordatorio a ${cn(g.cid)}`}, lote); if(via){ viaUlt=via; nCorreos++; bs.forEach(b=>sentIds.push(String(b.id))) } }
        else{ for(const b of bs){ const {r,attachments}=await build(b); const via=await enviarComoUsuario({to, subject:r.subject, html:r.html, text:r.text, attachments, que:`El recordatorio a ${cn(g.cid)}`}, lote); if(via){ viaUlt=via; nCorreos++; sentIds.push(String(b.id)) } } }
      }
    }catch(e){ errEnv=e; if(!modo) avisoNoEnviado(`El recordatorio a ${cn(g.cid)}`, e.message||String(e)) }
    const nIntentos = combinado?1:bs.length
    if(sentIds.length){ const at=new Date().toISOString()
      if(!DEMO) for(const id of sentIds){ try{ await setLearningKV('factura_recordado',id,at) }catch(e){registrarError({origen:'accion',vista:'factura_recordado',err:e})} }
      setRecMap(m=>{ const n={...m}; sentIds.forEach(id=>n[id]=at); return n })
      const nc=(okCount[g.cid]||0)+1; setOkCount(o=>({...o,[g.cid]:nc})); if(!DEMO){ try{ await setLearningKV('cobranza_ok',String(g.cid),String(nc)) }catch(e){registrarError({origen:'accion',vista:'cobranza_ok',err:e})} }
      if(!DEMO&&g.cid){ try{ await setLearningKV('recordatorio_nota',String(g.cid),String(nota||'')) }catch(e){registrarError({origen:'accion',vista:'recordatorio_nota',err:e})} }; setRecNotaMap(m=>({...m,[g.cid]:String(nota||'')}))
      setRecPrev(null)
      if(!modo) appAlert(lote&&!combinado
        ? txtResumenEnvio({ok:nCorreos, no:nIntentos-nCorreos, via:viaUlt, que:nCorreos===1?'recordatorio':'recordatorios'})+` (${cn(g.cid)}, ${to}).`
        : txtEnviado(DEMO?'usuario':viaUlt,{que:`Recordatorio de ${sentIds.length} factura${sentIds.length!==1?'s':''}`, para:`${cn(g.cid)} (${to})`}))
    } else if(lote&&!modo&&!errEnv) appAlert(txtResumenEnvio({ok:0,no:nIntentos,que:'recordatorios'}))
    setSending(null)
    return {ok:nCorreos, no:nIntentos-nCorreos, via:viaUlt}
  }
  // Envío automático (lote / "Enviar a todos"): sin vista previa, combinado con PDF, solo las vencidas que tocan hoy.
  async function enviarClienteAuto(g, modo){
    const bs=g.items.filter(x=>x.acc).map(x=>x.b); if(!bs.length) return null
    const to=await resolverTo(g); if(!to) return null
    return await doEnviar({g, to, bs, combinado:true, adjuntar:true, nota:recNotaMap[g.cid]||'', modo})
  }
  async function enviarTodos(){
    if(!(await appConfirm(`¿Enviar el recordatorio que corresponde a ${gruposAccion.length} cliente${gruposAccion.length!==1?'s':''} (${nVencidas} factura${nVencidas!==1?'s':''} vencida${nVencidas!==1?'s':''}, ${f0(vencidoTotal)})?\n\nSe envía un correo por cliente (con todas sus facturas y el PDF adjunto).`))) return
    const lista=gruposAccion.filter(g=>!autoCli[g.cid])
    const modo=await modoEnvioLote(lista.length)
    if(modo==='cancelar'){ appAlert(txtResumenEnvio({ok:0,no:lista.length,que:'recordatorios'})); return }
    let ok=0, no=0, sinCorreo=0; for(const g of lista){ const r=await enviarClienteAuto(g, modo); if(!r) sinCorreo++; else { ok+=r.ok; no+=r.no } }
    appAlert(txtResumenEnvio({ok, no, via:modo, que:ok===1?'recordatorio':'recordatorios'})+(sinCorreo?`\n(${sinCorreo} cliente${sinCorreo!==1?'s':''} sin correo, omitido${sinCorreo!==1?'s':''}.)`:''))
  }
  async function setAutoGlob(v){   // interruptor global (config cobranza_auto) que habilita el envío automático del edge fn
    const prev=autoGlobal; setAutoGlobal(v); if(DEMO) return
    try{ await supabase.from('learnings').delete().eq('kind','config').eq('key','cobranza_auto'); await supabase.from('learnings').insert({kind:'config',key:'cobranza_auto',value:v?'on':'off'}) }catch(e){ setAutoGlobal(prev); appAlert('No se pudo guardar: '+e.message) }
  }
  async function liberar(cid){
    if(!(await appConfirm(`¿Liberar la cobranza de ${cn(cid)} a automático? La app enviará sola los recordatorios que correspondan (siempre puedes pausarlo y queda en bitácora).`))) return
    setAutoCli(a=>({...a,[cid]:true})); if(DEMO) return
    try{ await setLearningKV('fd_auto','cobranza:'+cid,'1') }catch(e){ setAutoCli(a=>{const n={...a};delete n[cid];return n}); appAlert('No se pudo liberar: '+e.message) }
  }
  async function pausar(cid){
    setAutoCli(a=>{const n={...a};delete n[cid];return n}); if(DEMO) return
    try{ await supabase.from('learnings').delete().eq('kind','fd_auto').eq('key','cobranza:'+cid) }catch(e){registrarError({origen:'accion',vista:'learnings',err:e})}
  }
  // ── Exposición visible (render aprobado 2026-11-02): puntualidad, compromiso de pago y gestiones por cliente ──
  const pctTxt = p => p==null?'—':Math.round(p*100)+'%'
  const pctCartera = cid => pctTxt(expo.total>0?(gGlobal[cid]?.total||0)/expo.total:null)   // deuda TOTAL del cliente sobre el total por cobrar
  const TONO = {ok:{bg:C.greenBg,fg:C.greenText},am:{bg:C.soonBg,fg:C.soonText},hacer:{bg:C.overdueBg,fg:C.overdueText},gr:{bg:C.bgSoft,fg:C.muted}}
  const chipSty = t=>({fontSize:10,fontWeight:700,borderRadius:20,padding:'2px 9px',whiteSpace:'nowrap',background:t.bg,color:t.fg,display:'inline-block'})
  const chipPunt = cid=>{ const e=punt.get(String(cid))||{etiqueta:'Sin pagos registrados',tono:'hacer',n:0}
    return <span title={e.n>0?`${e.n} pagada${e.n!==1?'s':''} en 12 meses · ${e.promedio} días en promedio desde la emisión · ${e.pct30}% dentro de 30 días`:'Ninguna factura pagada en los últimos 12 meses'} style={chipSty(TONO[e.tono]||TONO.gr)}>{e.etiqueta}</span> }
  const compDe = cid=>{ const c=compMap[cid]; if(!c) return null; const G=gGlobal[cid]; return {c, st:estadoCompromiso(c,hoy,G?G.vencido:0)} }
  const chipComp = cid=>{ const x=compDe(cid); if(!x||!x.st) return null
    return <span style={chipSty(x.st==='incumplido'?TONO.hacer:TONO.am)}>{x.st==='incumplido'?'Compromiso incumplido':'Compromiso'} {fmtFechaDMY(x.c.fecha)}</span> }
  const abrirCompromiso = cid=>{ const G=gGlobal[cid]; const c=compMap[cid]; setCompForm({fecha:c?.fecha||'',por:c?.por||'',monto:String(Math.round(c?.monto||G?.vencido||0)||'')}); setCompPage(cid) }
  const guardarCompromiso = async()=>{ const cid=compPage; const fecha=String(compForm.fecha||'').slice(0,10)
    if(!/^\d{4}-\d{2}-\d{2}$/.test(fecha)){ appAlert('Indica la fecha comprometida.'); return }
    if(fecha<hoy){ appAlert('La fecha comprometida no puede ser anterior a hoy.'); return }
    const val={fecha, por:(compForm.por||'').trim()||null, monto:Number(String(compForm.monto||'').replace(/\D/g,''))||null, creado:hoy, quien:currentUserName||null}
    try{ if(!DEMO){ await setLearningKV('cobranza_compromiso',String(cid),JSON.stringify(val)); logActividad('cobranza.compromiso',{tabla:'clients',id:cid,detalle:{title:`Compromiso de pago de ${cn(cid)}: ${fmtFechaDMY(fecha)}`,...val}}) }
      setCompMap(m=>({...m,[cid]:val})); setCompPage(null)
    }catch(e){ registrarError({origen:'accion',vista:'cobranza_compromiso',err:e}); appAlert('No se pudo guardar el compromiso: '+(e?.message||e)) } }
  const quitarCompromiso = async cid=>{ if(!await appConfirm(`¿Quitar el compromiso de pago de ${cn(cid)}?`)) return
    try{ if(!DEMO){ okDB(await supabase.from('learnings').delete().eq('kind','cobranza_compromiso').eq('key',String(cid)),'quitar el compromiso de pago'); logActividad('cobranza.compromiso_quitado',{tabla:'clients',id:cid,detalle:{title:`Compromiso de pago quitado: ${cn(cid)}`}}) }
      setCompMap(m=>{ const n={...m}; delete n[cid]; return n })
    }catch(e){ registrarError({origen:'accion',vista:'cobranza_compromiso',err:e}); appAlert('No se pudo quitar el compromiso: '+(e?.message||e)) } }
  const ultRec = g=>(gGlobal[g.cid]||g).items.map(({b})=>recMap[String(b.id)]).filter(Boolean).sort().slice(-1)[0]
  const chipGes = g=>{ const G=gGlobal[g.cid]||g; if(!(G.vencido>0)||compMap[g.cid]) return null; const u=ultRec(g)
    return u ? <span style={chipSty(TONO.gr)}>Recordado {fmtFechaDMY(u)}</span> : <span style={chipSty(TONO.hacer)}>Sin gestiones</span> }
  // Fila compacta de factura para el móvil (N°, vence, mora, saldo a la derecha); al tocarla abre la factura, donde están PDF y Buscar pago.
  const detMini = ({b,venc,diasVenc})=>(
    <div key={b.id} onClick={()=>onOpenFactura&&onOpenFactura(b)} style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) auto auto',gap:8,alignItems:'center',padding:'8px 0',borderTop:`1px solid ${C.bgSoft}`,cursor:onOpenFactura?'pointer':'default'}}>
      <div style={{minWidth:0}}><div style={{fontSize:12.5,fontWeight:700,color:C.accent}}>N° {folioN(b.invoice_no)||'—'}</div><div style={{fontSize:10.5,color:C.muted}}>Vence {fmtFechaDMY(venceBill(b))}</div></div>
      <span style={chipSty(!venc?TONO.ok:diasVenc>90?TONO.hacer:diasVenc>30?TONO.am:TONO.gr)}>{venc?`${diasVenc} d`:'Al día'}</span>
      <span style={{fontSize:13,fontWeight:700,fontVariantNumeric:'tabular-nums',textAlign:'right'}}>{f0(saldoBill(b))}</span>
    </div>)
  // Gestiones de cobro del cliente (despliegue): compromiso vigente/incumplido, último recordatorio, o la ausencia de gestiones a la vista.
  const gestionesDe = (g,mini)=>{ const G=gGlobal[g.cid]||g; const recs=G.items.map(({b})=>recMap[String(b.id)]).filter(Boolean).sort(); const x=compDe(g.cid)
    const desde=G.items.filter(i=>i.venc).map(i=>venceBill(i.b)).filter(Boolean).sort()[0]
    return (<div onClick={e=>e.stopPropagation()} style={{margin:mini?'2px 0 4px':'10px 0 4px'}}>
      {!mini&&<div style={SEC_LBL}>Gestiones de cobro</div>}
      {mini&&<div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:4}}>{chipPunt(g.cid)}<span style={{color:C.muted,fontSize:11.5}}>{(()=>{ const e=punt.get(String(g.cid)); return e&&e.n>0?`${e.n} pagada${e.n!==1?'s':''} · ${e.promedio} d en promedio · ${e.pct30}% en 30 d`:'Ninguna pagada en 12 meses' })()}</span></div>}
      {x&&<div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',fontSize:12,color:C.text,marginTop:5}}><span>Compromiso de pago <b>{fmtFechaDMY(x.c.fecha)}</b>{x.c.monto?` · ${f0(x.c.monto)}`:''}{x.c.por?` · ${x.c.por}`:''}</span>{chipComp(g.cid)}<span onClick={()=>quitarCompromiso(g.cid)} style={{fontSize:11,color:C.muted,cursor:'pointer',textDecoration:'underline'}}>Quitar</span></div>}
      {recs.length>0 ? <div style={{fontSize:12,color:C.muted,marginTop:5}}>Último recordatorio {fmtFechaDMY(recs[recs.length-1])}</div>
        : (G.vencido>0&&!x&&desde) ? <div style={{fontSize:12,fontWeight:700,color:C.overdueText,marginTop:5}}>Sin gestiones registradas en la app desde el {fmtFechaDMY(desde)}</div> : null}
      {G.vencido>0&&<button onClick={()=>abrirCompromiso(g.cid)} style={{marginTop:7,minHeight:32,padding:'0 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.accent,fontSize:11.5,fontWeight:700,cursor:'pointer'}}>{x?'Cambiar compromiso de pago':'Registrar compromiso de pago'}</button>}
    </div>) }
  const NIV = { firme:{bg:C.soonBg,tx:C.soonText,lbl:'Firme'}, final:{bg:C.overdueBg,tx:C.overdueText,lbl:'Final'} }
  // Detalle de una factura vencida (compartido móvil/escritorio): fecha día-grande + folio + glosa + estado + saldo, y acciones Buscar pago (→ Conciliación) / Abrir factura (→ ficha/factura, con el Conciliar en un toque). Reusa helpers (folioN, saldoBill, fmtFechaDMY).
  const detItem = ({b,acc,venc,diasVenc})=>{ const s=String(b.issued_at||b.due||'').slice(0,10); const dd=/^\d{4}-\d{2}-\d{2}$/.test(s)?s.split('-'):null; const parcial=(b.paid_amount||0)>0
    // Color por severidad de mora (mismo criterio que abonos/cargos): verde al día · ámbar <30 d · rojo ≥30 d. SIN línea izquierda (ya no se usa).
    const sevCol = !venc ? C.greenText : (diasVenc>=30 ? C.overdueText : C.soonText)
    const dl = daysLeftB(b)   // >0 = días para vencer (al día) · fuente única (emisión+30)
    const kk = {fontSize:8,fontWeight:700,color:C.textSoft,textTransform:'uppercase',letterSpacing:'.3px'}
    const dv = {fontSize:11,fontWeight:700,fontVariantNumeric:'tabular-nums'}
    // Razón social a la que se emitió (fuente única rsDeFactura). Protagonista de la fila cuando aporta:
    // el cliente tiene más de una RS, o la RS difiere de su nombre. Si no, se mantiene el folio como título.
    const rs = rsDeFactura(b, clientEntities)
    const nEnt = (clientEntities||[]).filter(e=>String(e.client_id)===String(b.client_id)).length
    const showRs = !!rs && (nEnt>1 || _normTxt(rs)!==_normTxt(cn(b.client_id)))
    const det = b.sale_id ? detPorVenta[String(b.sale_id)] : null
    const acciones=(<div style={{display:'flex',gap:6,justifyContent:'flex-end',marginTop:5,width:isDesktop?'auto':'100%'}}>
          {b.dte_xml&&<button onClick={e=>{e.stopPropagation();verFacturaPdf(b)}} title='Descargar el PDF con timbre' style={{minHeight:32,padding:'0 10px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.accent,fontSize:11.5,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'}}>PDF</button>}
          {onIrConciliacion&&<button onClick={e=>{e.stopPropagation();onIrConciliacion(b)}} style={{minHeight:32,padding:'0 10px',borderRadius:8,border:`1px solid ${C.border}`,background:C.greenBg,color:C.greenText,fontSize:11.5,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'}}>Buscar pago <Gl n='chevron'/></button>}
        </div>)
    return (
    // Toda la fila abre la factura (→ su detalle con "Volver"); la fecha de emisión y los días de vencida son el foco.
    <div key={b.id} onClick={()=>onOpenFactura&&onOpenFactura(b)} style={{display:'flex',flexWrap:isDesktop?'nowrap':'wrap',alignItems:'center',gap:11,borderTop:`1px solid ${C.bgSoft}`,padding:'9px 4px',cursor:onOpenFactura?'pointer':'default'}}>
      {dd?bigDate(s,sevCol):<div style={{width:44,flexShrink:0,textAlign:'center',fontSize:11,color:C.textSoft}}>—</div>}
      <div style={{flex:1,minWidth:0}}>
        {showRs
          ? <><div style={{fontSize:12,fontWeight:700,color:C.accent,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{rsDisplay(rs)}</div>
              <div style={{fontSize:11,color:C.muted,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>Factura N° {folioN(b.invoice_no)||'—'}{b.concept?` · ${b.concept}`:''}</div></>
          : <div style={{fontSize:12,fontWeight:700,color:C.accent,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>Factura N° {folioN(b.invoice_no)||'—'}{b.concept?<span style={{color:C.muted,fontWeight:500}}> · {b.concept}</span>:''}</div>}
        <div style={{display:'flex',gap:18,marginTop:3}}>
          <div><div style={kk}>Emitida</div><div style={{...dv,color:C.text,whiteSpace:'nowrap'}}>{b.issued_at?fmtFechaDMY(b.issued_at):'—'}</div></div>
          <div><div style={kk}>{venc?'Vencida':'Vence en'}</div><div style={{...dv,color:sevCol}}>{venc?`${diasVenc} días`:(dl>0?`${dl} días`:'hoy')}</div></div>
        </div>
        {det&&<div title={`«${det.s.title||'Trabajo'}» sin factura, gasto, tarea ni horas del cliente desde ${fmtFechaDMY(det.ult)}`} style={{fontSize:10.5,color:C.muted,marginTop:3,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>Trabajo detenido desde {fmtFechaDMY(det.ult)}</div>}
      </div>
      <div style={{textAlign:'right',flexShrink:0}}>
        <div style={{fontSize:13,fontWeight:700,fontVariantNumeric:'tabular-nums'}}>{f0(saldoBill(b))}</div>
        {parcial&&<div style={{fontSize:9,color:C.textSoft}}>abonado {f0(b.paid_amount)} de {f0(b.amount)}</div>}
        {isDesktop&&acciones}
      </div>
      {!isDesktop&&acciones}
    </div>) }

  // Recordatorio de cobro = PÁGINA (antes ventana encima): mismo contenido, con '‹ Cobranza' para volver. El envío sigue con su botón y confirmación.
  if(recPrev) return <FlujoPagina origen='Cobranza' titulo='Recordatorio de cobro' ctx={cn(recPrev.g.cid)} onBack={()=>setRecPrev(null)} maxW={1000}><RecordatorioModal grupo={recPrev.g} to={recPrev.to} nombre={recPrev.nombre} nota={recPrev.nota} clientEntities={clientEntities} sending={sending===recPrev.g.cid} onClose={()=>setRecPrev(null)} onEnviar={({bs,combinado,adjuntar,nota})=>doEnviar({g:recPrev.g, to:recPrev.to, bs, combinado, adjuntar, nota})} asPage/></FlujoPagina>
  if(compPage!=null){ const G=gGlobal[compPage]; const inp={width:'100%',boxSizing:'border-box',border:`1px solid ${C.border}`,borderRadius:10,padding:'10px 12px',fontSize:14,background:'#fff',fontFamily:'inherit'}; const lb={...SEC_LBL,marginBottom:5}
    const linea=(ic,t)=><div style={{display:'flex',gap:9,alignItems:'flex-start',padding:'6px 0',fontSize:12,lineHeight:1.45}}><span style={{width:20,height:20,borderRadius:'50%',background:C.bgSoft,color:C.accent,fontWeight:800,fontSize:11,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{ic}</span><span>{t}</span></div>
    return <FlujoPagina origen='Cobranza' titulo='Compromiso de pago' ctx={cn(compPage)} onBack={()=>setCompPage(null)} maxW={640}>
      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,padding:'12px 14px'}}><div style={SEC_LBL}>Cliente</div><div style={{fontSize:15,fontWeight:700,color:C.accent}}>{cn(compPage)}</div><div style={{fontSize:11.5,color:C.muted}}>{G?G.items.length:0} factura{G&&G.items.length!==1?'s':''} · {f0(G?.total)} · mora máxima {G?.maxDias||0} días</div></div>
        <div><div style={lb}>Fecha comprometida</div><input type='date' min={hoy} value={compForm.fecha} onChange={e=>setCompForm(f=>({...f,fecha:e.target.value}))} style={inp}/></div>
        <div><div style={lb}>Quién lo comprometió</div><input type='text' value={compForm.por} onChange={e=>setCompForm(f=>({...f,por:e.target.value}))} placeholder='Nombre del contacto del cliente' style={inp}/></div>
        <div><div style={lb}>Monto</div><input inputMode='numeric' value={compForm.monto} onChange={e=>setCompForm(f=>({...f,monto:e.target.value.replace(/\D/g,'')}))} style={inp}/></div>
        <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,padding:'10px 14px'}}><div style={SEC_LBL}>Qué cambia</div>
          {linea('=','Las facturas siguen en Vencido y en Por cobrar: nada se oculta.')}
          {linea('!','Si la fecha pasa sin pago, el compromiso se marca incumplido en rojo.')}
          {linea('+','Queda en las gestiones de cobro del cliente.')}</div>
        <div style={{display:'flex',gap:8}}><button onClick={guardarCompromiso} style={{background:C.accent,color:'#fff',border:'none',borderRadius:9,padding:'10px 18px',fontSize:13,fontWeight:700,cursor:'pointer'}}>Guardar compromiso</button><button onClick={()=>setCompPage(null)} style={{background:'#fff',color:C.accent,border:`1px solid ${C.border}`,borderRadius:9,padding:'10px 16px',fontSize:13,fontWeight:700,cursor:'pointer'}}>Cancelar</button></div>
      </div></FlujoPagina> }
  return (
    <div style={{padding:'12px 14px 40px',maxWidth:isDesktop?1040:560,margin:'0 auto'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:12}}>
        {onClose?<PageHeader origen={origen||'Inicio'} onBack={onClose} titulo='Cobranza' style={{flex:1,margin:'-12px -14px 0'}}/>:<div style={TIT_PAG}>Cobranza</div>}
      </div>
      {(()=>{
        // Foto de Cobranza: dos tarjetas en tonos claros (molde del Inicio). Tocar una ordena la lista por esa cifra.
        const tile=(key,label,fig,cap,bg,bd,ico,icoCol,figCol)=>(
          <div onClick={()=>key==='m60'?setTramoF(f=>f==='m60'?null:'m60'):setSortBy({col:key,dir:'desc'})} style={{background:bg,border:`1px solid ${bd}`,borderRadius:12,padding:'12px 13px',cursor:'pointer'}}>
            <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
              <span style={{width:30,height:30,borderRadius:8,background:bd,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SIcon n={ico} s={16} c={icoCol}/></span>
              <div style={{minWidth:0,flex:1}}>
                <div style={{...SEC_LBL,whiteSpace:'nowrap'}}>{label}</div>
                <div style={{fontSize:22,fontWeight:800,color:figCol,letterSpacing:'-.5px',lineHeight:1,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap',marginTop:5}}>{fig}</div>
                <div style={{fontSize:10,color:C.muted,marginTop:5,whiteSpace:'nowrap'}}>{cap}</div>
              </div>
            </div>
          </div>)
        const chip=a=>{ const on=aboFilter===a.abo; return (
          <button key={a.abo} onClick={()=>setAboFilter(on?null:a.abo)} title={`${a.abo} · ${fM(a.vencido)} vencido de ${fM(a.total)} · ${a.nVenc}/${a.n} vencidas`} style={pillPersonaSty(personChip(a.abo),on)}>{a.abo} · {fM(a.vencido)}</button>) }
        return (<>
          <div style={{display:'grid',gridTemplateColumns:isDesktop&&expo.m60>0?'1fr 1fr 1fr':'1fr 1fr',gap:8,marginBottom:12,alignItems:'start'}}>
            {tile('vencido','Vencido',fM(vencidoTotal),`${nVencidas} factura${nVencidas!==1?'s':''}${isDesktop?` · ${gruposAccion.length} cliente${gruposAccion.length!==1?'s':''}`:''}`,C.overdueBg,C.overdueBd,'alert',C.overdueText,C.overdueText)}
            {tile('total','Por cobrar',fM(deudaTotal),`${grupos.length} cliente${grupos.length!==1?'s':''}${isDesktop&&nAlDia>0?` · ${nAlDia} al día`:''}`,C.azulBg,C.azulBd,'file',C.azulInfo,C.accent)}
            {expo.m60>0&&<div style={isDesktop?undefined:{gridColumn:'1 / -1'}}>{tile('m60','Más de 60 días',fM(expo.m60),`${pctTxt(expo.pctM60)} de la cartera`,C.soonBg,`${C.soon}55`,'clock',C.soonText,C.soonText)}</div>}
          </div>
          {expo.mayor&&expo.mayor.pct>=0.25&&gGlobal[expo.mayor.cid]&&<div style={{background:C.soonBg,borderRadius:12,padding:'10px 13px',marginBottom:10}}>
            <div style={{fontSize:12.5,fontWeight:700,color:C.soonText}}>{cn(expo.mayor.cid)} concentra el {pctTxt(expo.mayor.pct)} de la cartera por cobrar</div>
            <div style={{fontSize:11,color:C.soonText,marginTop:2}}>{(()=>{ const G=gGlobal[expo.mayor.cid], pp=punt.get(String(expo.mayor.cid)); return `${G.items.length} factura${G.items.length!==1?'s':''}${!pp||pp.n===0?', sin pagos registrados':''}; mora máxima ${G.maxDias} días. Los tres mayores deudores suman ${pctTxt(expo.top3pct)}.` })()}</div></div>}
          {grupos.length>0&&<div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap',marginBottom:10}}>
            <span style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:.3,color:C.textSoft}}>Antigüedad</span>
            {[[null,'Todas',expo.tramos.reduce((a,t)=>a+t.n,0)],...TRAMOS.map((k,i)=>[i,k,expo.tramos[i].n])].map(([v,l,n])=>{ const on=tramoF===v; return <button key={String(v)} onClick={()=>setTramoF(on&&v!==null?null:v)} style={{fontSize:11,fontWeight:on?700:600,borderRadius:20,padding:'4px 11px',cursor:'pointer',border:`1px solid ${on?C.accent:C.border}`,background:on?C.azulBg:'#fff',color:on?C.accent:C.muted}}>{l} · {n}</button> })}
            {tramoF==='m60'&&<button onClick={()=>setTramoF(null)} style={{fontSize:11,fontWeight:700,borderRadius:20,padding:'4px 11px',cursor:'pointer',border:`1px solid ${C.accent}`,background:C.azulBg,color:C.accent}}>Más de 60 días ×</button>}
          </div>}
          {grupos.length>0&&(isDesktop
            ? <div style={{display:'flex',gap:6,alignItems:'center',marginBottom:10}}><Buscador value={qCob} onChange={setQCob} placeholder='Buscar cliente, N° de factura o RUT…' style={{flex:1,minWidth:0,marginRight:4}}/>{porAbogado.map(chip)}</div>
            : <><Buscador value={qCob} onChange={setQCob} placeholder='Buscar cliente, N° de factura o RUT…' style={{marginBottom:8}}/><div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:10}}>{porAbogado.map(chip)}</div></>)}
        </>)
      })()}
      {grupos.length===0 && <div style={{fontSize:13,color:C.textSoft,background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,padding:16,textAlign:'center'}}>Nada por cobrar hoy. {enEspera?`${enEspera} factura${enEspera!==1?'s':''} ya contactada${enEspera!==1?'s':''}, en espera de respuesta.`:'Todo al día.'}</div>}
      {grupos.length>0 && (()=>{ const SORTS=[['cliente','Nombre'],['facturas','Facturas'],['total','Monto'],['vencido','Vencido'],['mora','Mora']]; return (
        <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap',marginBottom:10}}>
          <span style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:.3,color:C.textSoft}}>Ordenar</span>
          {SORTS.map(([col,lbl])=>{ const on=sortBy.col===col; return <button key={col} onClick={()=>setSortBy(s=>({col,dir:s.col===col&&s.dir==='desc'?'asc':'desc'}))} style={{fontSize:11,fontWeight:on?700:600,borderRadius:20,padding:'4px 11px',cursor:'pointer',border:`1px solid ${on?C.accent:C.border}`,background:on?C.azulBg:'#fff',color:on?C.accent:C.muted}}>{lbl}{on?(sortBy.dir==='desc'?' ↓':' ↑'):''}</button> })}
          <div style={{marginLeft:'auto',display:'inline-flex',alignItems:'center',gap:14}}>
            {gruposAccion.length>1 && <span onClick={()=>!sending&&enviarTodos()} title="Enviar recordatorio a todos los clientes que corresponde" style={{fontSize:11,fontWeight:600,color:sending?C.done:C.azulInfo,cursor:sending?'default':'pointer'}}>{sending?'Enviando…':`Enviar a todos (${gruposAccion.filter(g=>!autoCli[g.cid]).length})`}</span>}
            <span onClick={()=>setAutoGlob(!autoGlobal)} title={autoGlobal?'Envío automático activado — la app envía sola a los clientes que liberaste':'Envío automático desactivado — actívalo para que la app envíe sola'} style={{display:'inline-flex',alignItems:'center',gap:5,cursor:'pointer',fontSize:11,fontWeight:600,color:C.muted}}>Automática<span style={{width:30,height:16,borderRadius:20,background:autoGlobal?C.greenText:C.toggleOff,position:'relative',flexShrink:0,transition:'background .15s'}}><span style={{position:'absolute',top:2,left:autoGlobal?16:2,width:12,height:12,borderRadius:'50%',background:'#fff',transition:'left .15s'}}/></span></span>
          </div>
        </div>) })()}
      {isDesktop ? (()=>{
        const thS={...TH_BAND,padding:'9px 12px',textAlign:'left',whiteSpace:'nowrap'}
        const th=(col,lbl,r)=>(<th onClick={()=>setSortBy(s=>({col,dir:s.col===col&&s.dir==='desc'?'asc':'desc'}))} style={{...thS,textAlign:r?'right':'left',cursor:'pointer',userSelect:'none'}}>{lbl}{sortBy.col===col?<span style={{color:C.muted}}> {sortBy.dir==='desc'?<Gl n='chevD'/>:<Gl n='chevU'/>}</span>:''}</th>)
        const gapDe=g=>{ const l=g.items.map(({b})=>recMap[String(b.id)]).filter(Boolean).sort().slice(-1)[0]; return l?`hace ${Math.round((new Date(hoy+'T00:00')-new Date(String(l).slice(0,10)+'T00:00'))/86400000)} d`:'sin contactar' }
        return (
          <div style={{border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
            <table style={{borderCollapse:'collapse',width:'100%'}}>
              <thead><tr>{th('cliente','Cliente')}{th('facturas','Facturas')}{th('mora','Mora')}<th style={thS}>Puntualidad</th><th style={{...thS,textAlign:'right'}}>% cartera</th>{th('vencido','Vencido',true)}{th('total','Total deuda',true)}</tr></thead>
              <tbody>
                {gsort.map(g=>{ const nc=okCount[g.cid]||0; const auto=autoCli[g.cid]; const open=expCli===g.cid; const gap=gapDe(g); const conVenc=g.nAccion>0||g.vencido>0; const td={padding:'10px 12px',borderTop:`1px solid ${C.border}`,fontSize:13,verticalAlign:'middle'}; return (
                  <Fragment key={g.cid}>
                  <tr onClick={()=>setExpCli(open?null:g.cid)} onMouseEnter={e=>e.currentTarget.style.background=C.bgSoft} onMouseLeave={e=>e.currentTarget.style.background='#fff'} style={{cursor:'pointer',background:'#fff'}}>
                    <td style={td}><span style={{display:'inline-flex',marginRight:7,verticalAlign:'middle',transform:open?'rotate(90deg)':'none',transition:'transform .15s'}}><SIcon n='chevron' s={12} c={C.done}/></span><span onClick={onOpenClientFicha?e=>{e.stopPropagation();onOpenClientFicha(g.cid)}:undefined} title={onOpenClientFicha?'Ver ficha del cliente':undefined} style={{fontWeight:700,color:C.accent,cursor:'pointer'}}>{cn(g.cid)}</span>{chipComp(g.cid)&&<span style={{marginLeft:8}}>{chipComp(g.cid)}</span>}</td>
                    <td style={{...td,color:C.muted}}>{g.items.length}</td>
                    <td style={{...td,fontVariantNumeric:'tabular-nums',color:g.maxDias>0?C.overdueText:C.done}}>{g.maxDias>0?`${g.maxDias} d`:'—'}</td>
                    <td style={td}>{chipPunt(g.cid)}</td>
                    <td style={{...td,textAlign:'right',fontVariantNumeric:'tabular-nums',color:C.muted,fontWeight:600}}>{pctCartera(g.cid)}</td>
                    <td style={{...td,textAlign:'right',fontWeight:800,fontVariantNumeric:'tabular-nums',color:g.vencido>0?C.overdueText:C.done}}>{g.vencido>0?f0(g.vencido):'—'}</td>
                    <td style={{...td,textAlign:'right',fontWeight:800,fontVariantNumeric:'tabular-nums',color:C.accent}}>{f0(g.total)}</td>
                  </tr>
                  {open&&<tr><td colSpan={7} style={{background:'#FFFFFF',borderTop:`1px dashed ${C.border}`,padding:'8px 14px 10px'}}>
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,flexWrap:'wrap',marginBottom:4}} onClick={e=>e.stopPropagation()}>
                      <span style={{fontSize:11,color:C.muted}}>Último contacto: <b style={{color:conVenc?(gap==='sin contactar'?C.overdueText:C.muted):C.done}}>{conVenc?gap:'—'}</b>{conVenc&&nc>0?` · ${nc} envío${nc!==1?'s':''} confirmado${nc!==1?'s':''}`:''}{onOpenClientFicha?<> · <span onClick={()=>onOpenClientFicha(g.cid)} style={{color:C.azulInfo,fontWeight:700,cursor:'pointer'}}>Ver ficha <Gl n='chevron'/></span></>:''}</span>
                      {!conVenc ? <span style={{fontSize:11,fontWeight:700,color:C.greenText}}>Al día — sin vencidas</span>
                      : auto ? <span style={{display:'inline-flex',gap:6,alignItems:'center'}}><span style={{fontSize:10,fontWeight:700,color:C.greenText,background:C.greenBg,borderRadius:8,padding:'5px 9px'}}>En automático</span><button onClick={()=>pausar(g.cid)} style={{background:'#fff',border:`1px solid ${C.border}`,color:C.textSoft,borderRadius:8,padding:'6px 10px',fontSize:11,fontWeight:600,cursor:'pointer'}}>Pausar</button></span>
                        : <span style={{display:'inline-flex',gap:6,alignItems:'center'}}>{nc>=LIBERAR_UMBRAL&&<button onClick={()=>liberar(g.cid)} style={{background:'#fff',border:`1px solid ${C.greenText}55`,color:C.greenText,borderRadius:8,padding:'6px 10px',fontSize:11,fontWeight:700,cursor:'pointer'}}>Liberar →</button>}<button onClick={()=>enviarCliente(g)} disabled={sending===g.cid} style={{background:C.accent,color:'#fff',border:'none',borderRadius:8,padding:'6px 12px',fontSize:11,fontWeight:700,cursor:'pointer'}}>{sending===g.cid?'Enviando…':'Enviar recordatorio'}</button></span>}
                    </div>
                    {g.items.map(detItem)}
                    {gestionesDe(g)}
                  </td></tr>}
                  </Fragment>
                )})}
              </tbody>
            </table>
          </div>
        )
      })() : gsort.map(g=>{ const nc=okCount[g.cid]||0; const auto=autoCli[g.cid]; const conVenc=g.nAccion>0||g.vencido>0; const last=g.items.map(({b})=>recMap[String(b.id)]).filter(Boolean).sort().slice(-1)[0]; const gapTxt=last?`último hace ${Math.round((new Date(hoy+'T00:00')-new Date(String(last).slice(0,10)+'T00:00'))/86400000)} d`:'sin contactar'; return (
        <div key={g.cid} style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,padding:'10px 12px',marginBottom:9}}>
          {/* Plegada: nombre + vencido (o el total si está al día). Al tocar se abre el resto: total, estado, ficha, facturas y recordatorio. */}
          <div onClick={()=>{ setExpCli(expCli===g.cid?null:g.cid); setMovTab('fac') }} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,cursor:'pointer'}}>
            <span onClick={onOpenClientFicha?e=>{e.stopPropagation();onOpenClientFicha(g.cid)}:undefined} style={{...NOMBRE_CLI,cursor:'pointer',minWidth:0}}>{cn(g.cid)}</span>
            <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
              <div style={{textAlign:'right',lineHeight:1.15}}>
                {g.vencido>0
                  ? <><div style={{fontSize:8,fontWeight:700,textTransform:'uppercase',letterSpacing:.3,color:C.textSoft}}>Vencido</div><div style={{fontSize:14,fontWeight:800,color:C.overdueText,fontVariantNumeric:'tabular-nums'}}>{f0(g.vencido)}</div>{expCli===g.cid&&<div style={{fontSize:11,fontWeight:600,color:C.muted,fontVariantNumeric:'tabular-nums'}}>Total {f0(g.total)}</div>}</>
                  : <div style={{fontSize:14,fontWeight:800,color:C.accent,fontVariantNumeric:'tabular-nums'}}>{f0(g.total)}</div>}
              </div>
              <span style={{fontSize:11,color:C.muted}}>{expCli===g.cid?<Gl n='chevD'/>:<Gl n='chevron'/>}</span>
            </div>
          </div>
          <div onClick={()=>{ setExpCli(expCli===g.cid?null:g.cid); setMovTab('fac') }} style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',marginTop:6,cursor:'pointer'}}>{chipPunt(g.cid)}{chipGes(g)}{chipComp(g.cid)}<span style={{fontSize:11,fontWeight:600,color:C.muted}}>{pctCartera(g.cid)} de la cartera</span></div>
          {expCli===g.cid&&<>
          <div onClick={e=>e.stopPropagation()} style={{display:'flex',gap:6,margin:'10px 0 6px'}}>{[['fac',`Facturas · ${g.items.length}`],['ges','Gestión']].map(([k,l])=>{ const on=movTab===k; return <button key={k} onClick={()=>setMovTab(k)} style={{flex:1,fontSize:11.5,fontWeight:700,borderRadius:20,padding:'7px 8px',cursor:'pointer',border:`1px solid ${on?C.accent:C.border}`,background:on?C.azulBg:'#fff',color:on?C.accent:C.muted}}>{l}</button> })}</div>
          {movTab==='ges' ? gestionesDe(g,true) : <>
          <div>{g.items.map(detMini)}</div>
          {!conVenc
            ? <div style={{marginTop:9,fontSize:11,fontWeight:700,color:C.greenText}}>Al día — sin facturas vencidas</div>
            : <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:9,marginTop:10}}>
            {auto ? <span style={{fontSize:11,fontWeight:700,color:C.greenText,background:C.greenBg,borderRadius:8,padding:'6px 11px'}}>En automático</span>
                  : <div style={{fontSize:10,color:C.textSoft}}>{nc>0?`${nc} envío${nc!==1?'s':''} confirmado${nc!==1?'s':''}`:'Sugerido'}</div>}
            <div style={{display:'flex',gap:7,alignItems:'center'}}>
              {auto ? <button onClick={()=>pausar(g.cid)} style={{background:'#fff',border:`1px solid ${C.border}`,color:C.textSoft,borderRadius:8,padding:'7px 12px',fontSize:12,fontWeight:600,cursor:'pointer'}}>Pausar</button>
                : <>{nc>=LIBERAR_UMBRAL && <button onClick={()=>liberar(g.cid)} style={{background:'#fff',border:`1px solid ${C.greenText}55`,color:C.greenText,borderRadius:8,padding:'7px 11px',fontSize:12,fontWeight:700,cursor:'pointer'}}>Liberar automático →</button>}
                  <button onClick={()=>enviarCliente(g)} disabled={sending===g.cid} style={{background:C.accent,color:'#fff',border:'none',borderRadius:8,padding:'7px 14px',fontSize:12,fontWeight:600,cursor:'pointer'}}>{sending===g.cid?'Enviando…':'Enviar recordatorio'}</button></>}
            </div>
          </div>}
          {onOpenClientFicha&&<div style={{marginTop:8}}><span onClick={e=>{e.stopPropagation();onOpenClientFicha(g.cid)}} style={{fontSize:11,color:C.azulInfo,fontWeight:700,cursor:'pointer'}}>Ver ficha <Gl n='chevron'/></span></div>}
          </>}
          </>}
        </div>
      )})}
      {reembolsos.length>0&&<div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,padding:'10px 12px',marginTop:14}}>
        <div onClick={()=>setReembOpen(o=>!o)} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,cursor:'pointer'}}>
          <span style={{...SEC_LBL,display:'inline-flex',alignItems:'center',gap:6}}><span style={{color:C.muted}}>{reembOpen?<Gl n='chevD'/>:<Gl n='chevron'/>}</span>Reembolsos por cobrar · {reembolsos.length}</span>
          <span style={{fontSize:14,fontWeight:800,color:C.accent,fontVariantNumeric:'tabular-nums'}}>{fM(reembolsos.reduce((a,x)=>a+saldoBill(x.b),0))}</span>
        </div>
        {reembOpen&&reembolsos.map(x=>(<div key={x.b.id}>
          <div onClick={onOpenClientFicha?()=>onOpenClientFicha(x.b.client_id):undefined} style={{...NOMBRE_CLI,fontSize:13,marginTop:8,cursor:onOpenClientFicha?'pointer':'default'}}>{cn(x.b.client_id)}</div>
          {detItem(x)}
        </div>))}
      </div>}
      <div style={{fontSize:10,color:C.textSoft,marginTop:12}}>Escala sola: amable → firme → final. Al confirmar {LIBERAR_UMBRAL} envíos de un cliente puedes liberarlo a automático.</div>
    </div>
  )
}

