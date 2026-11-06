// Movido desde App.jsx por scripts/mover-a-modulo.py. Sin cambios de comportamiento.
import { useState, useEffect, useCallback, useMemo, Fragment } from 'react'
import { supabase, DEMO } from '../supabase'
import { C, Gl, SIcon, _normTxt, appAlert, appConfirm, fmt, fmtN, fmtRutCL, fmtFechaDMY, folioN, personChip, useIsDesktop } from '../lib/base.jsx'
import { ActBtn, Buscador, CAT_COLORS, DriveIcon, FichaTabs, FlujoPagina, NOMBRE_CLI, TH_BAND, TIT_PAG, anularReembolsoDeRendicion, chipBtn, ddItem, detectarClientesDuplicados, driveBtn, fmtSaldoG, logActividad, porCobrarBills, rendicionPdfHtml, rsDisplay, rsLabel, saldoDelta, saldosPorCliente, viewMemGuardar, viewMemLeer } from '../lib/compartido.jsx'
import { RendicionEmailModal, RendicionModal } from '../lib/rendiciones.jsx'
import { ContactoTab, EstadoCuentaTab, FinancieroTab, FotoCliente } from '../lib/fichaCliente.jsx'
import { TIPOS_PENDIENTE, tiposDe, contables } from '../../supabase/functions/_shared/pendientesCliente.js'
import { VistasGuardadas, useVistasGuardadas } from '../lib/vistasGuardadas.jsx'

// Texto de cada tipo de pendiente en la lista de escritorio («2 cuotas por emitir»).
const TXT_PEND = {banco:['pago por imputar','pagos por imputar'], fondos:['fondos por solicitar','fondos por solicitar'], sinfactura:['pagada sin factura','pagadas sin factura'], cuotas:['cuota por emitir','cuotas por emitir'], vencidas:['factura vencida','facturas vencidas'], datos:['dato por corregir','datos por corregir']}
const txtTipos = (items,largo) => { const t=tiposDe(items); return largo ? t.map(x=>x.tipo==='fondos'?'fondos por solicitar':`${x.n} ${TXT_PEND[x.tipo][x.n===1?0:1]}`).join(' · ') : (t.length>3?[...t.slice(0,2).map(x=>x.label),`+${t.length-2}`]:t.map(x=>x.label)).join(' · ') }

// Pendientes financieros del cliente (Resumen de la ficha): solo el número actual y lo que falta; lo resuelto sale solo cuando la regla deja de detectarlo.
function PendientesCliente({pend,billing,sales,onGo}){
  const items=contables(pend?.items), fondos=(pend?.items||[]).filter(i=>i.soloFiltro)
  const venta = id => (sales||[]).find(s=>String(s.id)===String(id))
  const det = it => { const b=it.billing_id?(billing||[]).find(x=>String(x.id)===String(it.billing_id)):null
    if(it.tipo==='cuotas') return `Vencida el ${fmtFechaDMY(it.fecha)}`
    if(it.tipo==='vencidas') return `Factura N° ${folioN(b?.invoice_no)} · emitida el ${fmtFechaDMY(String(it.fecha||'').slice(0,10))}`
    if(it.tipo==='banco') return `Depósito del ${fmtFechaDMY(it.fecha)}`
    if(it.tipo==='fondos') return 'Gastos por rendir'
    return venta(it.sale_id)?.title||(b?.concept||'') }
  return (
    <div style={{marginBottom:12}}>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:'11px 14px'}}>
        <div style={{fontSize:10,fontWeight:800,letterSpacing:.5,textTransform:'uppercase',color:C.accent}}>Pendientes financieros</div>
        <div style={{fontSize:20,fontWeight:800,color:items.length?C.soonText:C.greenText,marginTop:2}}>{items.length?`${items.length} pendiente${items.length!==1?'s':''}`:'Sin pendientes'}</div>
      </div>
      {items.length+fondos.length>0&&<div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden',marginTop:8}}>
        {[...items,...fondos].map((it,i)=>(<div key={it.key} onClick={()=>onGo(it)} style={{display:'flex',gap:10,alignItems:'center',padding:'10px 12px',borderTop:i?`1px solid ${C.bgSoft}`:'none',cursor:'pointer'}}>
          <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:it.soloFiltro?500:700,color:it.soloFiltro?C.muted:C.text}}>{it.titulo}</div><div style={{fontSize:11,color:C.muted,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden',lineHeight:1.25}}>{det(it)}</div></div>
          {it.monto>0&&<span style={{fontSize:13,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fmt(it.monto)}</span>}
          <ActBtn variant={it.tipo==='cuotas'?'primary':undefined} onClick={e=>{e.stopPropagation();onGo(it)}}>{it.tipo==='cuotas'?'Emitir':'Ver'} →</ActBtn>
        </div>))}
      </div>}
    </div>)
}

export function ClientFicha({pend=null,onPendGo=null,setExpenses=null,onAsociarTrabajo,onToggleStatus,onOpenFusion,client,clients,sales,billing,expenses,tasks,clientEntities,anticipos,respaldoMap,cartolaHasta=null,onNuevoAnticipo,onEdit,onClose,onAddTask,onAddGasto,onAddFondo,onAddSale,onAddBilling,onEditBilling,onReplaceProgramada,onOpenSale,onEditTask,onEditExpense,onConciliar,onOpenConciliacion,onAssignSeries,onStatusChange,onRendicion,rendiciones,onAnularRendicion,onEditRendicion,user,onRendicionSent,onSaveFields,initialFtab,onAjuste,backLabel}) {
  const [emailRend,setEmailRend] = useState(null)
  const [menuMas,setMenuMas] = useState(false)
  // Volver a la misma pestaña de la ficha tras una página (gasto, factura, ajuste…).
  const [ftab,setFtab] = useState(()=>{ const vm=viewMemLeer('clienteFtab'); return initialFtab||(vm&&String(vm.id)===String(client.id)?vm.ftab:null)||'resumen' })
  useEffect(()=>{ viewMemGuardar('clienteFtab',{id:client.id,ftab}) },[client.id,ftab])
  const [fichaSii,setFichaSii] = useState([])   // novedades SII (perfil tributario por cliente)
  useEffect(()=>{ supabase.from('sii_novedades').select('id,tipo,numero,titulo,url,areas,prioridad').then(({data})=>setFichaSii(data||[]),()=>{}) },[])
  const [openRS,setOpenRS] = useState(()=>new Set())   // grupos de "Cobros pendientes" por RS, colapsados por defecto
  const toggleRS = n => setOpenRS(p=>{const s=new Set(p); s.has(n)?s.delete(n):s.add(n); return s})
  const [openSale,setOpenSale] = useState(()=>new Set())   // ventas expandidas (muestran sus facturas), colapsadas por defecto
  const toggleSale = id => setOpenSale(p=>{const s=new Set(p); s.has(id)?s.delete(id):s.add(id); return s})
  const [openSaleGrp,setOpenSaleGrp] = useState(()=>new Set())   // grupos de ventas (Activas/Terminadas), colapsados por defecto
  const toggleSaleGrp = k => setOpenSaleGrp(p=>{const s=new Set(p); s.has(k)?s.delete(k):s.add(k); return s})
  const [openEnt,setOpenEnt] = useState(false)   // caja "Razones sociales facturadas", colapsada por defecto
  const [rSec,setRSec] = useState({})   // secciones del Resumen colapsadas por defecto (el embudo de arriba da el resumen; se expande al tocar)
  const rtog = k => setRSec(s=>({...s,[k]:!s[k]}))
  const RHdr = ({icon,title,purpose,summary,sumCol,k,iconCol}) => (<div onClick={()=>rtog(k)} style={{display:'flex',alignItems:'center',gap:11,padding:'13px',cursor:'pointer',background:rSec[k]?'#F7F9FA':'#fff'}}>
    <SIcon n={icon} s={18} c={iconCol||C.muted}/>
    <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:rSec[k]?700:600,color:rSec[k]?C.accent:C.text}}>{title}</div>{purpose&&<div style={{fontSize:10,color:C.muted,fontWeight:400,marginTop:1}}>{purpose}</div>}</div>
    {summary!=null&&<span style={{fontSize:11,color:sumCol||C.muted,fontWeight:sumCol&&sumCol!==C.muted?700:400,whiteSpace:'nowrap'}}>{summary}</span>}
    <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke={C.done} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' style={{flexShrink:0,transform:rSec[k]?'rotate(180deg)':'none',transition:'transform .12s'}}><path d='M6 9l6 6 6-6'/></svg>
  </div>)
  const [respPick,setRespPick] = useState(false)   // asignar/cambiar abogado responsable desde el encabezado
  const isDesktop = useIsDesktop()   // desktop: ficha full-screen con KPIs a lo ancho + columna de contexto; móvil = columna simple
  const clientBilling = billing.filter(b=>b.client_id===client.id)
  // Abogado responsable: el campo del cliente, o el de su venta más reciente (mismo criterio que la lista).
  const responsable = client.abogado_responsable || [...(sales||[])].filter(s=>s.client_id===client.id&&s.responsible).sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0))[0]?.responsible || null



  const CATS = CAT_COLORS

  // Chevron de affordance (fila clickeable) — paleta corporativa, hover lo oscurece vía .lf-row:hover
  const Chev = ({mt=0}) => <span className="lf-chev" aria-hidden="true" style={{fontSize:18,lineHeight:1,flexShrink:0,marginLeft:6,marginTop:mt,fontWeight:400}}><Gl n='chevron'/></span>

  // Correo de rendición = PÁGINA (igual que en Gastos): "‹ cliente" vuelve a la ficha. Va después de todos los hooks.
  if(emailRend) return <FlujoPagina origen={client.name} titulo='Enviar rendición' ctx={emailRend.correlativo?`N° ${emailRend.correlativo}`:null} onBack={()=>setEmailRend(null)} maxW={1180}><RendicionEmailModal asPage r={emailRend} client={client} user={user} expenses={expenses} clientEntities={clientEntities} sales={sales} setExpenses={setExpenses} onSent={onRendicionSent} onNext={x=>setEmailRend(x)} onClose={()=>setEmailRend(null)}/></FlujoPagina>

  return (
    <div style={{paddingBottom:100}}>
      {/* Header */}
      <div style={{padding:'20px 20px 12px',position:'sticky',top:0,background:C.bg,zIndex:10,borderBottom:`1px solid ${C.border}`}}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
          <button onClick={onClose} title={backLabel?`Volver a ${backLabel}`:'Volver'} style={{background:'none',border:'none',color:backLabel?C.accent:C.muted,cursor:'pointer',fontSize:backLabel?13:20,fontWeight:backLabel?600:400,lineHeight:1,padding:'0 6px 0 0',display:'flex',alignItems:'center',gap:3,whiteSpace:'nowrap',flexShrink:0}}><Gl n='chevL'/>{backLabel?` ${backLabel}`:''}</button>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:'flex',alignItems:'center',gap:8,minWidth:0}}>
              <div onClick={()=>onEdit(client)} title='Tocar para editar' style={{fontSize:18,fontWeight:700,color:C.text,lineHeight:1.2,overflowWrap:'anywhere',cursor:'pointer'}}>{client.name}</div>
              {(()=>{ const pc=responsable?personChip(responsable):null; return <><span style={{color:C.textSoft,fontWeight:400,fontSize:16,flexShrink:0}}>|</span><button onClick={()=>setRespPick(v=>!v)} style={{flexShrink:0,fontSize:10,background:pc?pc.bg:C.bgWarm,color:pc?pc.color:C.grisText,borderRadius:10,padding:'1px 8px',fontWeight:600,border:'none',cursor:'pointer'}}>{responsable?`${responsable} ▾`:<>Asignar{" "}<Gl n='chevD'/></>}</button></> })()}
            </div>
            {(()=>{ const rs=rsLabel(client.id,clients,clientEntities); return (rs.name!==client.name||rs.multi)?<div onClick={()=>setFtab('contacto')} title='Ver razones sociales' style={{fontSize:11,color:C.muted,fontWeight:600,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden',lineHeight:1.25,cursor:'pointer'}}>{rs.multi?`${rs.multi} razones sociales`:`${rsDisplay(rs.name)}${rs.rut?` · ${fmtRutCL(rs.rut)}`:''}`}</div>:null })()}
            <div style={{fontSize:11,color:C.muted,display:'flex',alignItems:'center',gap:6}}>
              {client.type}
              {client.is_occasional&&<span style={{fontSize:10,padding:'2px 8px',borderRadius:20,background:C.bgWarm,color:C.grisText,fontWeight:700,whiteSpace:'nowrap'}}>Ocasional</span>}
              {client.status==='Terminado'&&<span style={{fontSize:10,padding:'2px 8px',borderRadius:20,background:C.bgSoft,color:C.muted,fontWeight:700,whiteSpace:'nowrap'}}>Terminado</span>}
              {client.status==='Prospecto'&&<span style={{fontSize:10,padding:'2px 8px',borderRadius:20,background:C.soonBg,color:C.soonText,fontWeight:700,whiteSpace:'nowrap'}}>Prospecto</span>}
            </div>
          </div>
          <div style={{display:'flex',gap:6,alignItems:'center',flexShrink:0,position:'relative'}}>
            {isDesktop&&<ActBtn onClick={()=>onEdit(client)} style={{color:C.accent}}>Editar</ActBtn>}
            {(onToggleStatus||onOpenFusion||!isDesktop)&&<ActBtn onClick={()=>setMenuMas(v=>!v)} title='Más acciones' style={{padding:'0 9px'}}><svg width='16' height='16' viewBox='0 0 24 24' fill={C.accent}><circle cx='5' cy='12' r='2'/><circle cx='12' cy='12' r='2'/><circle cx='19' cy='12' r='2'/></svg></ActBtn>}
            {menuMas&&<>
              <div onClick={()=>setMenuMas(false)} style={{position:'fixed',inset:0,zIndex:20}}/>
              <div style={{position:'absolute',right:0,top:40,zIndex:21,background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,boxShadow:'0 8px 24px rgba(0,0,0,.12)',padding:4,minWidth:220}}>
                {!isDesktop&&<div onClick={()=>{ setMenuMas(false); onEdit(client) }} className='lf-row' style={ddItem}>Editar cliente</div>}
                {onToggleStatus&&<div onClick={async()=>{ setMenuMas(false); const arch=client.status!=='Terminado'; if(await appConfirm(arch?`¿Archivar ${client.name}? Pasa a Terminados y sale de la lista de activos. Puedes reactivarlo cuando quieras desde su ficha.`:`¿Reactivar ${client.name}? Vuelve a la lista de activos.`)) onToggleStatus(client) }} className='lf-row' style={{...ddItem,color:client.status==='Terminado'?C.greenText:C.overdueText}}>{client.status==='Terminado'?'Reactivar cliente':'Archivar cliente'}</div>}
                {onOpenFusion&&<div onClick={()=>{ setMenuMas(false); onOpenFusion(client) }} className='lf-row' style={ddItem}>Fusionar con otro cliente</div>}
              </div>
            </>}
          </div>
        </div>
        {respPick&&(
          <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center',marginBottom:10}}>
            <span style={{fontSize:10,color:C.textSoft,fontWeight:600,textTransform:'uppercase',letterSpacing:.4}}>Responsable</span>
            {['Cristóbal','Erasmo','Martín','Martina','Rodrigo'].map(m=>{const pc=personChip(m);const on=responsable===m;return <button key={m} onClick={()=>{onSaveFields&&onSaveFields(client.id,{abogado_responsable:m});setRespPick(false)}} style={{fontSize:11,borderRadius:20,padding:'3px 11px',fontWeight:600,cursor:'pointer',background:on?pc.color:pc.bg,color:on?'#fff':pc.color,border:`1px solid ${on?pc.color:pc.color+'33'}`}}>{m}</button>})}
            {responsable&&<button onClick={()=>{onSaveFields&&onSaveFields(client.id,{abogado_responsable:null});setRespPick(false)}} style={{fontSize:11,background:'none',border:'none',color:C.muted,cursor:'pointer'}}>Quitar</button>}
          </div>
        )}
        <FichaTabs tab={ftab} setTab={setFtab} role="admin"/>
      </div>

      <div style={{padding:'16px 20px 0',maxWidth:isDesktop?900:undefined,margin:isDesktop?'0 auto':undefined,display:ftab==='resumen'?'block':'none'}}>

        {pend&&pend.items?.length>0&&<PendientesCliente pend={pend} billing={billing} sales={sales} onGo={it=>it.tipo==='fondos'?setFtab('financiero'):(onPendGo&&onPendGo(it))}/>}
        <FotoCliente client={client} sales={sales} billing={billing} expenses={expenses} tasks={tasks} setFtab={setFtab} onRendicion={onRendicion} onEditExpense={onEditExpense} onEditBilling={onEditBilling} onEditTask={onEditTask} onAddTask={onAddTask}/>

      </div>
      {ftab==='contacto'&&<ContactoTab client={client} entities={(clientEntities||[]).filter(e=>e.client_id===client.id)} onSaveFields={onSaveFields} clientBilling={clientBilling} onOpenFinanciero={()=>setFtab('financiero')}/>}
      {ftab==='financiero'&&<FinancieroTab client={client} clientBilling={clientBilling} entities={(clientEntities||[]).filter(e=>e.client_id===client.id)} sales={sales} anticipos={(anticipos||[]).filter(a=>a.client_id===client.id)} billing={billing} respaldoMap={respaldoMap} cartolaHasta={cartolaHasta} onNuevoAnticipo={()=>onNuevoAnticipo&&onNuevoAnticipo(client)} onSaveFields={onSaveFields} onEditBilling={onEditBilling} onAddBilling={()=>onAddBilling&&onAddBilling(client)} onAddSale={onAddSale} onConciliar={()=>onConciliar&&onConciliar(client)} onOpenConciliacion={onOpenConciliacion} onAssignSeries={onAssignSeries} onStatusChange={onStatusChange} onReplaceProgramada={onReplaceProgramada} onOpenSale={onOpenSale}/>}
      {ftab==='documentos'&&<EstadoCuentaTab onAsociarTrabajo={onAsociarTrabajo} tasks={tasks} client={client} clientBilling={clientBilling} sales={sales} anticipos={(anticipos||[]).filter(a=>a.client_id===client.id)} expenses={expenses} clientEntities={(clientEntities||[]).filter(e=>e.client_id===client.id)} onEditExpense={onEditExpense} onEditBilling={onEditBilling} onOpenSale={onOpenSale} onOpenConciliacion={onOpenConciliacion} onRendicion={onRendicion?()=>onRendicion(client):undefined} onAjuste={onAjuste}/>}
    </div>
  )
}

export function ClientsView({pendCli=null,pendIntent=null,onPendIntentUsed=null,onContactos,onCausas=null,onAsociarTrabajo,clients,sales,billing,setBilling,expenses,tasks,clientEntities,anticipos,respaldoMap,cartolaHasta=null,onNuevoAnticipo,onToggleStatus,onEdit,onAdd,onAddTask,onAddGasto,onAddFondo,onAddSale,onAddBilling,onEditBilling,onEditTask,onEditExpense,onAjuste,onConciliar,onOpenConciliacion,onAssignSeries,onStatusChange,onReplaceProgramada,onImportDrive,onProveedores,proveedores=[],terceros=[],onSaveProveedor,onRevertirPagoProveedor,onAsignarFacturas,onOpenSale,provSaving,setExpenses,setRendiciones,rendiciones,user,onSaveFields,onRendicionComplete,openFichaId,onOpenedFicha,navOrigin,navOriginLabel,onBackOrigin,onOpenFusion,onRedProfesional=null}) {
  // Clientes creados por el último sync de Drive → tag "Nuevo · Drive" unos días.
  const [nuevosDrive,setNuevosDrive] = useState(()=>new Set())
  useEffect(()=>{ if(DEMO){ setNuevosDrive(new Set(['tech araucanía spa'])); return } let alive=true
    supabase.from('learnings').select('value').eq('kind','config').eq('key','clientes_drive_sync_last').order('updated_at',{ascending:false}).limit(1).maybeSingle().then(({data})=>{ if(!alive||!data?.value) return; try{ const s=JSON.parse(data.value); if(s.at&&(Date.now()-new Date(s.at).getTime())<7*86400000&&Array.isArray(s.added)) setNuevosDrive(new Set(s.added.map(n=>String(n).toLowerCase().trim()))) }catch(_){} },()=>{})
    return ()=>{alive=false} },[clients])

  const handleAnularRendicion = async(r) => {
    if(!await appConfirm('\u00bfAnular esta rendici\u00f3n? Queda registrada como ANULADA (con su PDF para auditor\u00eda), los gastos vuelven a estar disponibles para rendir y se anula el cobro de reembolso asociado.')) return
    try {
      const now = new Date().toISOString()
      let pdf = r.pdf_html
      if(!pdf){ try{ const cl=clients.find(c=>c.id===r.client_id); pdf=rendicionPdfHtml(r,cl,expenses,clientEntities) }catch(_){} }
      const {error:ue}=await supabase.from('expenses').update({client_rendered_at:null,client_render_id:null}).eq('client_render_id',r.id)
      if(ue) throw ue   // si no se liberan los gastos, NO borrar la rendici\u00f3n (quedar\u00edan hu\u00e9rfanos)
      const reembolsos=await anularReembolsoDeRendicion(r, billing)
      const patch={anulada_at:now, anulada_por:user?.name||null}
      if(pdf&&!r.pdf_html) patch.pdf_html=pdf
      const {error:re}=await supabase.from('rendiciones').update(patch).eq('id',r.id)
      if(re) throw re
      logActividad('rendicion.anulada',{tabla:'rendiciones',id:r.id,detalle:{cliente:(clients||[]).find(c=>c.id===r.client_id)?.name,title:r.sent_at?`Rendición${r.correlativo?` N° ${r.correlativo}`:''} anulada`:'Borrador de rendición anulado',monto:Math.round(r.total||0),por:patch.anulada_por,gastos:(expenses||[]).filter(e=>e.client_render_id===r.id).map(e=>e.id)},completo:true})
      if(setRendiciones) setRendiciones(p=>p.map(x=>x.id===r.id?{...x,...patch}:x))
      if(setExpenses) setExpenses(p=>p.map(e=>e.client_render_id===r.id?{...e,client_rendered_at:null,client_render_id:null}:e))
      if(reembolsos.length&&setBilling){ setBilling(p=>p.map(b=>reembolsos.some(x=>x.id===b.id)?{...b,status:'Anulada'}:b)); appAlert(`También se anuló el cobro de reembolso asociado (${reembolsos.map(b=>fmtN(b.amount)).join(', ')}).`) }
    } catch(e) { appAlert('Error: '+e.message) }
  }
  // Volver al lugar exacto: tras abrir una página (gasto, factura, ajuste…) desde Clientes, la vista se re-monta con el mismo filtro y la misma ficha.
  const _vmC = viewMemLeer('clientes')
  const [sFilter,setSFilter] = useState(_vmC?.sFilter||'Activo')
  const [respSel,setRespSel] = useState(()=>new Set(_vmC?.resp||[]))
  const toggleResp = r => setRespSel(p=>{const n=new Set(p);n.has(r)?n.delete(r):n.add(r);return n})
  const [q,setQ] = useState(_vmC?.q||'')
  const [ord,setOrd] = useState(_vmC?.ord||{k:'nombre',dir:1})   // escritorio: columna por la que se ordena la tabla
  const [pendOn,setPendOn] = useState(!!_vmC?.pend)   // «Pendientes financieros»: solo los clientes con algo por resolver (regla única pendientesPorCliente)
  const [tipoSel,setTipoSel] = useState(()=>new Set(_vmC?.tipos||[]))
  // Vistas guardadas: la combinación de filtros de hoy (estado, responsables, pendientes, tipos, búsqueda y orden) con nombre, por usuario.
  const [vistasG,guardarVistasG] = useVistasGuardadas('clientes',user?.email)
  useEffect(()=>{ if(!pendIntent) return; setPendOn(true); setTipoSel(new Set()); setRespSel(new Set((pendIntent.resp||[]).filter(r=>responsables.includes(r)))); setSFilter('Activo'); setQ(''); setSelected(null); onPendIntentUsed&&onPendIntentUsed() },[pendIntent])
  const [selected,setSelected] = useState(()=>_vmC?.selId?(clients.find(c=>String(c.id)===String(_vmC.selId))||null):null)
  const [forceFtab,setForceFtab] = useState(null)
  const [rendicionClient,setRendicionClient] = useState(null)
  const [emailRendCV,setEmailRendCV] = useState(null)   // correo de la rendición recién generada (antes llamaba a setEmailRend, que no existía en esta vista → error al 'Enviar al cliente')
  const [rendEdit,setRendEdit] = useState(null)   // rendición en edición (RendicionModal modo edición)
  // Abrir la ficha de un cliente (en Financiero) cuando llega la señal desde otra vista (ej. Facturación → Ficha).
  const [extOpen,setExtOpen] = useState(!!_vmC?.extOpen)   // ficha abierta por cross-link desde otra vista → el ← vuelve al origen
  useEffect(()=>{ if(openFichaId){ const c=clients.find(x=>String(x.id)===String(openFichaId)); if(c){ setForceFtab('financiero'); setSelected(c); setExtOpen(true) } onOpenedFicha&&onOpenedFicha() } },[openFichaId])

  useEffect(()=>{ viewMemGuardar('clientes',{sFilter,resp:[...respSel],q,ord,selId:selected?.id||null,extOpen,pend:pendOn,tipos:[...tipoSel]}) },[sFilter,respSel,q,ord,selected?.id,extOpen,pendOn,tipoSel])
  // Actualizar selected cuando cambian los datos
  useEffect(()=>{ if(selected) setSelected(clients.find(c=>c.id===selected.id)||null) },[clients])

  // Responsable de un cliente = responsable de su venta más reciente (campo responsible en sales)
  const responsableDe = useMemo(()=>{ const m={}; clients.forEach(c=>{ if(c.abogado_responsable) m[c.id]=c.abogado_responsable }); [...sales].sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0)).forEach(s=>{ if(s.responsible&&s.client_id&&!m[s.client_id]) m[s.client_id]=s.responsible }); return m },[clients,sales])
  const responsables = useMemo(()=>[...new Set(Object.values(responsableDe))].filter(Boolean).sort((a,b)=>a.localeCompare(b,'es')),[responsableDe])
  const tareasDe = useMemo(()=>{ const m={}; tasks.forEach(t=>{ if(t.client_id&&t.status!=='Terminado') m[t.client_id]=(m[t.client_id]||0)+1 }); return m },[tasks])
  // Estado del cliente: UNA regla para la lista y para los conteos de los filtros (antes 'Activos' en escritorio dejaba el filtro vacío y mostraba todos).
  const baseCl = useMemo(()=>clients.filter(c=>!c.is_occasional&&!c.is_colaborador),[clients])   // ocasionales viven en Gastos/cobranza; colaboradores en Colaboradores
  const enEstado = (c,v) => v==='all' ? true : v==='Activo' ? (c.status||'Activo')==='Activo' : c.status===v
  const nEstado = v => baseCl.filter(c=>enEstado(c,v)).length
  // Buscar por nombre, razón social o RUT (de la ficha o de sus razones sociales).
  const entsDe = useMemo(()=>{ const m={}; (clientEntities||[]).forEach(e=>{ (m[e.client_id]=m[e.client_id]||[]).push(e) }); return m },[clientEntities])
  const calzaBusqueda = useCallback((c,txt)=>{ const t=_normTxt(txt); if(!t) return true; const r=String(txt).replace(/[^0-9kK]/g,'').toUpperCase(); const nr=x=>String(x||'').replace(/[^0-9kK]/g,'').toUpperCase()
    if(_normTxt(c.name).includes(t)) return true
    const ents=entsDe[c.id]||[]
    if(ents.some(e=>_normTxt(e.name).includes(t))) return true
    return r.length>=3 && [c.rut,...ents.map(e=>e.rut)].some(x=>nr(x).includes(r)) },[entsDe])
  const cl = useMemo(()=>{
    let base = baseCl.filter(c=>enEstado(c,sFilter))
    if(q.trim()) base=base.filter(c=>calzaBusqueda(c,q))
    if(respSel.size>0) base=base.filter(c=>respSel.has(responsableDe[c.id]))
    if(pendOn&&pendCli){ const nDe=c=>(tipoSel.size===0?contables(pendCli.get(String(c.id))?.items):(pendCli.get(String(c.id))?.items||[]).filter(i=>tipoSel.has(i.tipo))).length
      return base.filter(c=>nDe(c)>0).sort((a,b)=>nDe(b)-nDe(a)||(a.name||'').localeCompare(b.name||'','es')) }
    return [...base].sort((a,b)=>(a.name||'').localeCompare(b.name||'','es'))
  },[baseCl,sFilter,q,respSel,responsableDe,calzaBusqueda,pendOn,pendCli,tipoSel])
  // Ámbito de los conteos del filtro: estado y responsable elegidos (sin búsqueda ni tipo). Los números cuentan clientes, no pendientes.
  const ambitoPend = useMemo(()=>baseCl.filter(c=>enEstado(c,sFilter)&&(respSel.size===0||respSel.has(responsableDe[c.id]))&&contables(pendCli?.get(String(c.id))?.items).length>0),[baseCl,sFilter,respSel,responsableDe,pendCli])
  const nTipoCli = k => baseCl.filter(c=>enEstado(c,sFilter)&&(respSel.size===0||respSel.has(responsableDe[c.id]))&&(pendCli?.get(String(c.id))?.items||[]).some(i=>i.tipo===k)).length
  const itemsDe = c => tipoSel.size===0?contables(pendCli?.get(String(c.id))?.items):(pendCli?.get(String(c.id))?.items||[]).filter(i=>tipoSel.has(i.tipo))
  const irPend = it => { if(it.billing_id){ const b=(billing||[]).find(x=>String(x.id)===String(it.billing_id)); if(b&&onEditBilling) return onEditBilling(b) }
    if(it.mov_id&&onOpenConciliacion) return onOpenConciliacion(it.mov_id)
    if(it.sale_id){ const v=(sales||[]).find(x=>String(x.id)===String(it.sale_id)); if(v&&onOpenSale) return onOpenSale(v) } }
  // Por cobrar de cada cliente: misma fuente que la ficha (porCobrarBills).
  const porCobrarDe = useMemo(()=>{ const g={}; (billing||[]).forEach(b=>{ if(b&&b.client_id!=null) (g[b.client_id]=g[b.client_id]||[]).push(b) }); const m={}; Object.keys(g).forEach(k=>{ m[k]=porCobrarBills(g[k]) }); return m },[billing])
  const balances = useMemo(()=>saldosPorCliente(expenses),[expenses])   // fuente única (compartido.jsx), la misma del Panel de socios

  const isDesktop = useIsDesktop()   // Fase 2: en desktop, lista + ficha lado a lado (2-paneles)
  // Alerta proactiva de clientes duplicados/similares (evita fichas y carpetas de Drive repetidas). Abre la fusión.
  const dupGrupos = useMemo(()=>detectarClientesDuplicados(clients),[clients])

  const fichaEl = selected ? (
      <ClientFicha
        client={selected}
        setExpenses={setExpenses}
        respaldoMap={respaldoMap}
        cartolaHasta={cartolaHasta}
        initialFtab={forceFtab}
        pend={pendCli?.get(String(selected.id))||null}
        onPendGo={irPend}
        onAjuste={onAjuste}
        onSaveFields={onSaveFields}
        clients={clients}
        sales={sales}
        billing={billing}
        expenses={expenses}
        tasks={tasks}
        clientEntities={clientEntities}
        anticipos={anticipos}
        onNuevoAnticipo={onNuevoAnticipo}
        onEdit={c=>{onEdit(c)}}
        backLabel={extOpen?navOriginLabel:null}
        onClose={()=>{ const ext=extOpen; setExtOpen(false); setSelected(null); if(ext&&onBackOrigin) onBackOrigin() }}
        onAddTask={()=>onAddTask(selected)}
        onAddGasto={()=>onAddGasto(selected)}
        onAddFondo={(dev)=>onAddFondo(selected,dev)}
        onAddSale={()=>onAddSale(selected)}
        onAddBilling={()=>onAddBilling(selected)}
        onEditBilling={onEditBilling}
        onReplaceProgramada={onReplaceProgramada}
        onOpenSale={onOpenSale}
        onEditTask={onEditTask}
        onEditExpense={onEditExpense}
        onAsociarTrabajo={onAsociarTrabajo}
        onConciliar={onConciliar}
        onOpenConciliacion={onOpenConciliacion}
        onAssignSeries={onAssignSeries}
        onStatusChange={onStatusChange}
        onRendicion={c=>{setRendEdit(null);setRendicionClient(c)}}
        onToggleStatus={onToggleStatus}
        onOpenFusion={onOpenFusion?(c=>onOpenFusion(c)):undefined}
        onEditRendicion={r=>{const c=clients.find(x=>String(x.id)===String(r.client_id)); if(c){setRendEdit(r);setRendicionClient(c)}}}
        rendiciones={rendiciones}
        onAnularRendicion={handleAnularRendicion}
        user={user}
        onRendicionSent={(id,at,corr)=>setRendiciones(p=>p.map(x=>x.id===id?{...x,sent_at:at,correlativo:corr??x.correlativo}:x))}
      />
  ) : null
  // Rendición y su correo = PÁGINAS (como en Gastos): '‹ cliente' vuelve a la ficha. Después de todos los hooks.
  const rendModal = null
  if(rendicionClient){ const cerrar=()=>{setRendicionClient(null);setRendEdit(null)}
    return <FlujoPagina origen={rendicionClient.name||'Clientes'} titulo={rendEdit?'Editar rendición':'Rendición'} onBack={cerrar} maxW={1180}><RendicionModal client={rendicionClient} expenses={expenses} clientEntities={clientEntities} sales={sales} rendiciones={rendiciones} onClose={()=>{setRendicionClient(null);setRendEdit(null)}} setExpenses={setExpenses} setRendiciones={setRendiciones} billing={billing} setBilling={setBilling} editRend={rendEdit} onRendicionComplete={onRendicionComplete||((r)=>setRendiciones(p=>[r,...p]))} onEnviar={r=>{setRendicionClient(null);setRendEdit(null);setEmailRendCV(r)}} asPage/></FlujoPagina> }
  if(emailRendCV){ const cli=clients.find(c=>String(c.id)===String(emailRendCV.client_id))
    return <FlujoPagina origen={cli?.name||'Clientes'} titulo='Enviar rendición' ctx={emailRendCV.correlativo?`N° ${emailRendCV.correlativo}`:null} onBack={()=>setEmailRendCV(null)} maxW={1180}><RendicionEmailModal asPage r={emailRendCV} client={cli} user={user} expenses={expenses} clientEntities={clientEntities} sales={sales} setExpenses={setExpenses} onSent={(id,at,corr)=>setRendiciones(p=>p.map(x=>x.id===id?{...x,sent_at:at,correlativo:corr??x.correlativo}:x))} onPatch={(id,patch)=>setRendiciones(p=>p.map(x=>x.id===id?{...x,...patch}:x))} onNext={x=>setEmailRendCV(x)} onClose={()=>setEmailRendCV(null)}/></FlujoPagina> }

  // Lista: UNA fila por cliente con los mismos datos en escritorio y móvil (responsable, tareas, por cobrar, fondos).
  const esEmpresaC = c => /\b(spa|s\.?p\.?a|ltda|limitada|s\.?a|sociedad|inversiones|comercial|constructora|consultores|holding|cia|cía|asociados|partners)\b/i.test(c.name||'')||/empresa|corp|sociedad/i.test(c.type||'')
  const subDe = c => { const rs=rsLabel(c.id,clients,clientEntities); return rs.multi?`${rs.multi} razones sociales`:(rs.name&&rs.name!==c.name?rsDisplay(rs.name):(c.type||'')) }
  const abrir = c => { setForceFtab(null); setExtOpen(false); setSelected(c) }
  const tagsDe = c => (<>{c.is_internal&&<span style={{fontSize:10,fontWeight:700,color:C.muted,background:C.border,borderRadius:4,padding:'1px 6px',textTransform:'uppercase',letterSpacing:.4,marginLeft:6}}>Interno</span>}{nuevosDrive.has((c.name||'').toLowerCase().trim())&&<span style={{fontSize:10,fontWeight:700,color:C.greenText,background:C.greenBg,borderRadius:20,padding:'2px 8px',marginLeft:6,whiteSpace:'nowrap'}}>Nuevo · Drive</span>}</>)
  const ORD_DEF = {nombre:1,resp:1,tareas:-1,cobrar:-1,fondos:1}   // fondos ascendente = los que más deben reponer primero
  const valOrd = (c,k) => k==='resp'?(responsableDe[c.id]||'~'):k==='tareas'?(tareasDe[c.id]||0):k==='cobrar'?(porCobrarDe[c.id]||0):k==='fondos'?(balances[c.id]||0):(c.name||'')
  const filas = ord.k==='nombre' ? (ord.dir===1?cl:[...cl].reverse()) : [...cl].sort((x,y)=>{ const va=valOrd(x,ord.k), vb=valOrd(y,ord.k); const r=typeof va==='string'?va.localeCompare(vb,'es'):(va-vb); return (r*ord.dir)||(x.name||'').localeCompare(y.name||'','es') })
  const exportarExcel = async() => {
    try{
      const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs')
      const head=['Cliente','Razones sociales','RUT','Responsable','Estado','Tareas abiertas','Por cobrar','Fondos']
      const rows=filas.map(c=>{ const ents=entsDe[c.id]||[]; const ruts=[c.rut,...ents.map(e=>e.rut)].filter(Boolean).filter((v,i,arr)=>arr.indexOf(v)===i); return [c.name||'', ents.map(e=>e.name).filter(Boolean).join('; '), ruts.join('; '), responsableDe[c.id]||'', c.status||'Activo', tareasDe[c.id]||0, Math.round(porCobrarDe[c.id]||0), Math.round(balances[c.id]||0)] })
      const ws=XLSX.utils.aoa_to_sheet([head,...rows]); ws['!cols']=[{wch:34},{wch:40},{wch:26},{wch:14},{wch:11},{wch:10},{wch:14},{wch:14}]; ws['!autofilter']={ref:`A1:H${rows.length+1}`}; ws['!views']=[{state:'frozen',ySplit:1}]
      for(let r=1;r<=rows.length;r++){ [6,7].forEach(cc=>{ const cell=ws[XLSX.utils.encode_cell({r,c:cc})]; if(cell&&cell.t==='n') cell.z='#,##0' }) }
      const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Clientes'); XLSX.writeFile(wb,`Clientes_${new Date().toISOString().slice(0,10)}.xlsx`)
    }catch(e){ appAlert('No se pudo generar el Excel: '+e.message) }
  }
  const filtrosActuales = { sFilter, resp:[...respSel], pend:pendOn, tipos:[...tipoSel], q:q.trim(), ord:(ord.k==='nombre'&&ord.dir===1)?null:ord }
  const aplicarVistaG = f => { setSFilter(f.sFilter||'Activo'); setRespSel(new Set((f.resp||[]).filter(r=>responsables.includes(r)))); setPendOn(!!f.pend); setTipoSel(new Set(f.tipos||[])); setQ(f.q||''); setOrd(f.ord||{k:'nombre',dir:1}) }
  const resumenVistaG = [({Activo:'Activos',Prospecto:'Prospectos',Terminado:'Terminados',all:'Todos'})[sFilter]||sFilter,...respSel,pendOn?'Pendientes financieros':null,q.trim()?`«${q.trim()}»`:null].filter(Boolean).join(' · ')
  const vistasUI = <VistasGuardadas vistas={vistasG} guardar={guardarVistasG} actual={filtrosActuales} defecto={{sFilter:'Activo'}} resumen={resumenVistaG} onAplicar={aplicarVistaG}/>
  const filtroBtns = mob => [['Activo','Activos'],['Prospecto','Prospectos'],['Terminado','Terminados'],['all','Todos']].map(([v,l])=>{ const on=sFilter===v; return (
    <button key={v} onClick={()=>setSFilter(v)} style={{...(mob?{flex:1,padding:'7px 0'}:{padding:'7px 13px'}),borderRadius:8,border:`1px solid ${on?C.accent:C.border}`,background:on?C.azulBg:C.surface,color:on?C.accent:C.muted,fontSize:11,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>{l} <span style={{opacity:.7,fontVariantNumeric:'tabular-nums'}}>{nEstado(v)}</span></button>) })
  const respChips = responsables.length>0&&<div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>{responsables.map(r=>{ const on=respSel.has(r); return <button key={r} onClick={()=>toggleResp(r)} title={r} style={{height:26,padding:'0 11px',borderRadius:20,border:`0.5px solid ${on?C.accent:C.border}`,background:on?C.azulBg:C.surface,color:on?C.accent:C.muted,fontSize:11,fontWeight:on?600:500,cursor:'pointer',whiteSpace:'nowrap'}}>{r}</button> })}</div>
  const pendChip = pendCli&&(<button onClick={()=>{ setPendOn(v=>!v); setTipoSel(new Set()) }} style={{height:26,padding:'0 11px',borderRadius:20,border:`1px solid ${pendOn?C.soon:C.border}`,background:pendOn?C.soonBg:C.surface,color:pendOn?C.soonText:C.muted,fontSize:11,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'}}>Pendientes financieros <span style={{opacity:.75,fontVariantNumeric:'tabular-nums'}}>{ambitoPend.length}</span></button>)
  const tipoBtns = pendOn&&pendCli&&(<div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:8}}>{[['','Todos',ambitoPend.length],...TIPOS_PENDIENTE.map(([k,l])=>[k,l,nTipoCli(k)])].map(([k,l,n])=>{ const on=k===''?tipoSel.size===0:tipoSel.has(k); return (
    <button key={k||'todos'} onClick={()=>k===''?setTipoSel(new Set()):setTipoSel(p=>{ const x=new Set(p); x.has(k)?x.delete(k):x.add(k); return x })} style={{padding:'6px 11px',borderRadius:8,border:`1px solid ${on?C.accent:C.border}`,background:on?C.azulBg:C.surface,color:on?C.accent:C.muted,fontSize:11,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>{l} <span style={{opacity:.7,fontVariantNumeric:'tabular-nums'}}>{n}</span></button>) })}</div>)
  const pendVacio = <div style={{color:C.muted,textAlign:'center',padding:40,fontSize:13}}>{q.trim()?'Sin clientes que calcen con la búsqueda':'Sin clientes con pendientes financieros'}</div>
  const pendListaD = cl.length===0 ? pendVacio : (<div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
    <div style={{display:'grid',gridTemplateColumns:'minmax(0,1.2fr) minmax(0,2.6fr) 90px 14px',columnGap:14,padding:'8px 16px',...TH_BAND}}><span>Cliente</span><span>Tipo de pendiente</span><span style={{textAlign:'right'}}>Pendientes</span><span/></div>
    {cl.map(c=>{ const its=itemsDe(c), suma=its.reduce((a,i)=>a+(i.monto||0),0); return (
      <div key={c.id} onClick={()=>abrir(c)} className='lf-row' style={{display:'grid',gridTemplateColumns:'minmax(0,1.2fr) minmax(0,2.6fr) 90px 14px',columnGap:14,alignItems:'center',padding:'9px 16px',borderTop:`1px solid ${C.bgSoft}`,cursor:'pointer'}}>
        <div style={{minWidth:0}}><div style={{...NOMBRE_CLI}}>{c.name}</div>{subDe(c)&&<div style={{fontSize:11,color:C.muted,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden',lineHeight:1.25}}>{subDe(c)}</div>}</div>
        <span style={{fontSize:12,color:C.muted,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden',lineHeight:1.25}}>{txtTipos(its,true)}{tipoSel.size>0&&suma>0?` · ${fmt(suma)}`:''}</span>
        <span style={{textAlign:'right',fontSize:13,fontWeight:700,color:C.soonText,fontVariantNumeric:'tabular-nums'}}>{its.length}</span>
        <SIcon n='chevron' s={12} c={C.done}/>
      </div>) })}
    <div style={{padding:'9px 16px',borderTop:`1px solid ${C.border}`,background:C.bgSoft,fontSize:12,fontWeight:700}}>{cl.length} cliente{cl.length!==1?'s':''}</div>
  </div>)
  const pendListaM = cl.length===0 ? pendVacio : (<div>{cl.map(c=>{ const its=itemsDe(c), suma=its.reduce((a,i)=>a+(i.monto||0),0); return (
    <div key={c.id} onClick={()=>abrir(c)} style={{background:C.card,borderRadius:12,padding:'10px 12px',marginBottom:6,border:`1px solid ${C.border}`,cursor:'pointer',display:'flex',alignItems:'center',gap:11}}>
      <div style={{flex:1,minWidth:0}}>
        <div style={{...NOMBRE_CLI}}>{c.name}</div>
        <div style={{fontSize:12,color:C.muted,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden',lineHeight:1.25,marginTop:1}}>{txtTipos(its,false)}{tipoSel.size>0&&suma>0?` · ${fmt(suma)}`:''}</div>
      </div>
      <span style={{fontSize:13,fontWeight:700,color:C.soonText,fontVariantNumeric:'tabular-nums'}}>{its.length}</span>
    </div>) })}<div style={{fontSize:11,color:C.muted,margin:'8px 2px 0'}}>{cl.length} cliente{cl.length!==1?'s':''}</div></div>)
  const dupAlert = dupGrupos.length>0&&onOpenFusion&&(()=>{ const nf=dupGrupos.reduce((x,g)=>x+g.clientes.length,0); return (
    <div onClick={()=>onOpenFusion()} title='Revisar y fusionar' style={{display:'flex',alignItems:'center',gap:10,background:C.soonBg,border:`1px solid ${C.soon}`,borderRadius:12,padding:'10px 12px',marginBottom:12,cursor:'pointer'}}>
      <SIcon n='alert' s={18} c={C.soonText}/>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:13,fontWeight:700,color:C.soonText}}>{dupGrupos.length} posible{dupGrupos.length!==1?'s':''} cliente{dupGrupos.length!==1?'s':''} duplicado{dupGrupos.length!==1?'s':''}</div>
        <div style={{fontSize:11,color:C.soonText,opacity:.9,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden',lineHeight:1.25}}>{nf} fichas con nombres iguales o muy parecidos</div>
      </div>
      <ActBtn variant='softAmber' onClick={e=>{e.stopPropagation();onOpenFusion()}}>Revisar</ActBtn>
    </div> )})()
  const saldoCol = v => v<0?C.overdueText:v>0?C.tealText:C.done

  // ESCRITORIO: tabla ordenable (al elegir un cliente, su ficha ocupa toda la pantalla). El móvil mantiene su directorio A-Z en tarjetas.
  if(isDesktop){
    if(selected) return (<>{fichaEl}{rendModal}</>)
    const COLS='minmax(0,2.4fr) 130px 70px 140px 140px 14px'
    const hcol=(k,l,right)=>{ const on=ord.k===k; return <span onClick={()=>setOrd(o=>o.k===k?{k,dir:-o.dir}:{k,dir:ORD_DEF[k]})} style={{cursor:'pointer',textAlign:right?'right':'left',color:on?C.accent:C.muted,userSelect:'none'}}>{l}{on?(ord.dir===1?<>{" "}<Gl n='chevU'/></>:<>{" "}<Gl n='chevD'/></>):''}</span> }
    const totCobrar=filas.reduce((x,c)=>x+(porCobrarDe[c.id]||0),0), totReponer=filas.reduce((x,c)=>x+Math.min(0,balances[c.id]||0),0), totTareas=filas.reduce((x,c)=>x+(tareasDe[c.id]||0),0)
    let ultL=null
    return (
      <div style={{padding:'20px 24px 100px',borderTop:`1px solid ${C.border}`}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:11,flexWrap:'wrap',gap:8}}>
          <div style={TIT_PAG}>Clientes <span style={{fontSize:13,color:C.textSoft,fontWeight:400}}>· {cl.length}</span></div>
          <div style={{display:'flex',gap:7,alignItems:'center'}}><button onClick={onImportDrive} title='Sincronizar con Drive' style={driveBtn}><DriveIcon size={20}/></button>{onCausas&&<ActBtn onClick={onCausas} style={{color:C.accent}}>Causas</ActBtn>}{onContactos&&<ActBtn onClick={onContactos} style={{color:C.accent}}>Contactos</ActBtn>}<ActBtn onClick={()=>onProveedores&&onProveedores()} style={{color:C.accent}}>Proveedores</ActBtn>{onRedProfesional&&<ActBtn onClick={onRedProfesional} style={{color:C.accent}}>Red profesional</ActBtn>}{onOpenFusion&&<ActBtn onClick={()=>onOpenFusion()} style={{color:C.accent}}>Fusionar</ActBtn>}<ActBtn onClick={exportarExcel} title='Descargar la lista filtrada'><SIcon n='download' s={14} c={C.accent}/>Excel</ActBtn><ActBtn variant='primary' onClick={onAdd}>+ Cliente</ActBtn></div>
        </div>
        <Buscador value={q} onChange={setQ} placeholder='Buscar por nombre, razón social o RUT' style={{marginBottom:9}}/>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap',marginBottom:12}}>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{filtroBtns(false)}</div>
          <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>{respChips}{pendChip}{vistasUI}</div>
        </div>
        {tipoBtns&&<div style={{marginBottom:12,marginTop:-4}}>{tipoBtns}</div>}
        {dupAlert}
        {pendOn&&pendCli ? pendListaD : filas.length===0
          ? <div style={{color:C.muted,textAlign:'center',padding:40,fontSize:13}}>{q.trim()?'Sin clientes que calcen con la búsqueda':'Sin clientes'}</div>
          : <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
              <div style={{display:'grid',gridTemplateColumns:COLS,columnGap:14,padding:'8px 16px',...TH_BAND}}>{hcol('nombre','Cliente')}{hcol('resp','Responsable')}{hcol('tareas','Tareas',1)}{hcol('cobrar','Por cobrar',1)}{hcol('fondos','Fondos',1)}<span/></div>
              {filas.map(c=>{
                const bal=balances[c.id]||0, pcb=porCobrarDe[c.id]||0, tc=tareasDe[c.id]||0, resp=responsableDe[c.id], pc=resp?personChip(resp):null
                const L=(_normTxt(c.name||'').replace(/[^a-z0-9ñ]/gi,'')[0]||'#').toUpperCase(); const sep=ord.k==='nombre'&&L!==ultL; ultL=L
                return (<Fragment key={c.id}>
                  {sep&&<div style={{padding:'4px 16px',background:C.bg,fontSize:11,fontWeight:800,color:C.accent,borderTop:`1px solid ${C.border}`}}>{L}</div>}
                  <div onClick={()=>abrir(c)} className='lf-row' style={{display:'grid',gridTemplateColumns:COLS,columnGap:14,alignItems:'center',padding:'9px 16px',borderTop:`1px solid ${C.bgSoft}`,cursor:'pointer',opacity:c.status==='Terminado'?.6:1}}>
                    <div style={{minWidth:0}}>
                      <div style={{...NOMBRE_CLI}}>{c.name}{tagsDe(c)}</div>
                      {subDe(c)&&<div style={{fontSize:11,color:C.muted,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden',lineHeight:1.25}}>{subDe(c)}</div>}
                    </div>
                    <span>{resp?<span style={{fontSize:10,fontWeight:700,color:pc.color,background:pc.bg,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap'}}>{resp}</span>:<span style={{color:C.textSoft}}>—</span>}</span>
                    <span style={{textAlign:'right'}}>{tc>0?<span style={{fontSize:10,fontWeight:700,color:C.soonText,background:C.soonBg,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap'}}>{tc}</span>:<span style={{color:C.textSoft}}>—</span>}</span>
                    <span style={{textAlign:'right',fontSize:13,fontWeight:pcb>0?700:400,color:pcb>0?C.text:C.done,fontVariantNumeric:'tabular-nums'}}>{pcb>0?fmt(pcb):'—'}</span>
                    <span style={{textAlign:'right',fontSize:13,fontWeight:bal?700:400,color:saldoCol(bal),fontVariantNumeric:'tabular-nums'}}>{bal?fmtSaldoG(bal):'—'}</span>
                    <SIcon n='chevron' s={12} c={C.done}/>
                  </div>
                </Fragment>)
              })}
              <div style={{display:'grid',gridTemplateColumns:COLS,columnGap:14,alignItems:'center',padding:'9px 16px',borderTop:`1px solid ${C.border}`,background:C.bgSoft,fontSize:12,fontWeight:700}}>
                <span>{filas.length} cliente{filas.length!==1?'s':''}</span><span/>
                <span style={{textAlign:'right',fontVariantNumeric:'tabular-nums'}}>{totTareas||'—'}</span>
                <span style={{textAlign:'right',fontVariantNumeric:'tabular-nums'}}>{fmt(totCobrar)}</span>
                <span style={{textAlign:'right',fontVariantNumeric:'tabular-nums',color:totReponer<0?C.overdueText:C.done}} title='Suma de los fondos negativos (por reponer)'>{totReponer<0?fmtSaldoG(totReponer):'—'}</span><span/>
              </div>
            </div>}
        {rendModal}
      </div>
    )
  }

  if(selected) return (<>{fichaEl}{rendModal}</>)

  return (
    <div>
      <div style={{padding:'20px 20px 0',position:'sticky',top:0,background:C.bg,zIndex:10}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10,flexWrap:'wrap',gap:8}}>
          <div style={{fontSize:20,fontWeight:600,color:C.text,fontFamily:"'DM Sans',sans-serif",letterSpacing:-.4}}>Clientes</div>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <button onClick={onImportDrive} title='Sincronizar con Drive' style={driveBtn}><DriveIcon size={20}/></button>
            <button onClick={onAdd} style={chipBtn('soft')}>+ Cliente</button>
            <button onClick={()=>onAddTask(null)} style={chipBtn('primary')}>+ Tarea</button>
          </div>
        </div>
        <div style={{display:'flex',gap:8,marginBottom:8,alignItems:'center',flexWrap:'wrap'}}>
          <Buscador value={q} onChange={setQ} placeholder='Nombre, razón social o RUT' style={{flex:'1 1 100%',minWidth:0}}/>
          {onContactos&&<button onClick={onContactos} style={{...chipBtn('soft'),flexShrink:0,height:34,color:C.accent}}>Contactos</button>}{onCausas&&<button onClick={onCausas} style={{...chipBtn('soft'),flexShrink:0,height:34,color:C.accent}}>Causas</button>}<button onClick={()=>onProveedores&&onProveedores()} style={{...chipBtn('soft'),flexShrink:0,height:34,color:C.accent}}>Proveedores</button>{onRedProfesional&&<button onClick={onRedProfesional} style={{...chipBtn('soft'),flexShrink:0,height:34,color:C.accent}}>Red profesional</button>}{onOpenFusion&&<button onClick={()=>onOpenFusion()} style={{...chipBtn('soft'),flexShrink:0,height:34,color:C.accent}}>Fusionar</button>}
        </div>
        <div style={{display:'flex',gap:6,marginBottom:8}}>{filtroBtns(true)}</div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center',marginBottom:4}}>{respChips}{pendChip}{vistasUI}</div>
        {tipoBtns&&<div style={{marginBottom:4}}>{tipoBtns}</div>}
      </div>
      <div style={{padding:'10px 20px 100px'}}>
        {dupAlert}
        {pendOn&&pendCli&&pendListaM}
        {!(pendOn&&pendCli)&&cl.length===0&&<div style={{color:C.muted,textAlign:'center',padding:40}}>{q.trim()?'Sin clientes que calcen con la búsqueda':'Sin clientes'}</div>}
        {!(pendOn&&pendCli)&&cl.length>0&&(()=>{
          // Directorio A-Z: agrupado por inicial, avatar empresa/persona del color del responsable, índice lateral.
          const norm=s=>(s||'').trim().toUpperCase()
          const letterOf=c=>{ const ch=norm(c.name)[0]||'#'; return /[A-ZÑ]/.test(ch)?ch:'#' }
          const byLetter={}; cl.forEach(c=>{ const L=letterOf(c); (byLetter[L]=byLetter[L]||[]).push(c) })
          const letters=Object.keys(byLetter).sort((a,b)=>a.localeCompare(b,'es'))
          const idFor=L=>'cli-letter-'+(L==='#'?'num':L)
          const card=c=>{
            const resp=responsableDe[c.id]; const pc=resp?personChip(resp):{bg:C.bgWarm,color:C.textSoft}
            const tareasC=tareasDe[c.id]||0, bal=balances[c.id]||0, sub=subDe(c)
            return (
              <div key={c.id} onClick={()=>abrir(c)} style={{background:C.card,borderRadius:12,padding:'10px 12px',marginBottom:6,border:`1px solid ${C.border}`,opacity:c.status==='Terminado'?.55:1,cursor:'pointer',display:'flex',alignItems:'center',gap:11}}>
                <span style={{width:38,height:38,borderRadius:10,background:pc.bg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SIcon n={esEmpresaC(c)?'building':'user'} s={18} c={pc.color}/></span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{...NOMBRE_CLI}}>{c.name}{tagsDe(c)}</div>
                  <div style={{fontSize:11,color:C.muted,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden',lineHeight:1.25,marginTop:1}}>{resp&&<b style={{color:pc.color}}>{resp}</b>}{resp&&(sub||tareasC>0)?' · ':''}{sub}{sub&&tareasC>0?' · ':''}{tareasC>0?`${tareasC} tarea${tareasC!==1?'s':''}`:''}</div>
                </div>
                {bal<0&&<div style={{textAlign:'right',flexShrink:0}}><div style={{fontSize:13,fontWeight:700,color:C.overdueText,fontVariantNumeric:'tabular-nums'}}>{fmtSaldoG(bal)}</div><div style={{fontSize:10,fontWeight:700,color:C.overdueText}}>por reponer</div></div>}
              </div>
            )
          }
          return (<>
            <div style={{display:'flex',gap:8}}>
              <div style={{flex:1,minWidth:0}}>
                {letters.map(L=>(<div key={L} id={idFor(L)}>
                  <div style={{fontSize:12,fontWeight:700,color:C.textSoft,margin:'9px 2px 5px'}}>{L}</div>
                  {byLetter[L].map(card)}
                </div>))}
              </div>
              <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:1,flexShrink:0,position:'sticky',top:70,alignSelf:'flex-start'}}>
                {'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(L=>{ const has=!!byLetter[L]; return <span key={L} onClick={has?()=>{const el=document.getElementById(idFor(L));el&&el.scrollIntoView({behavior:'smooth',block:'start'})}:undefined} style={{fontSize:11,fontWeight:has?700:400,color:has?C.accent:C.toggleOff,cursor:has?'pointer':'default',padding:'1px 3px',lineHeight:1.15}}>{L}</span> })}
              </div>
            </div>
            <div style={{marginTop:10}}><ActBtn full onClick={exportarExcel}><SIcon n='download' s={14} c={C.accent}/>Descargar Excel</ActBtn></div>
          </>)
        })()}
      </div>
    </div>
  )
}

