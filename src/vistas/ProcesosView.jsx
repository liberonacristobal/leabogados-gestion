// Movido desde App.jsx por scripts/mover-a-modulo.py. Sin cambios de comportamiento.
import { useState, useEffect } from 'react'
import { supabase, DEMO } from '../supabase'
import { C, Gl, SEC_LBL, appAlert, appConfirm } from '../lib/base.jsx'
import { BitacoraLista, PageHeader, _DEMO_BANDEJA, cargarProcesos, estadoProceso, fechaHoraCL, logActividad, setLearningKV } from '../lib/compartido.jsx'
import { ConsumoIA } from '../lib/consumoIA.jsx'
import { DETECTOR_LBL } from '../../supabase/functions/_shared/saludDatos.js'

// Horario de una tarea (cron en UTC) leído en hora de Chile de hoy.
export function horarioProceso(schedule, corto=false){
  const [mi,ho,dom,,dow]=String(schedule||'').split(' ')
  if(!ho) return ''
  if(ho.startsWith('*')) return `cada ${ho.slice(2)||1} horas`
  const d=new Date(); d.setUTCHours(Number(ho),Number(mi)||0,0,0)
  const t=new Intl.DateTimeFormat('es-CL',{timeZone:'America/Santiago',hour:'2-digit',minute:'2-digit',hour12:false}).format(d)
  const DL={'1':'lunes','2':'martes','3':'miércoles','4':'jueves','5':'viernes','6':'sábado','0':'domingo'}, DC={'1':'lun.','2':'mar.','3':'mié.','4':'jue.','5':'vie.','6':'sáb.','0':'dom.'}
  if(dom&&dom!=='*') return `${dom.includes('-')?`días ${dom.split('-')[0]} al ${dom.split('-')[1]}`:`día ${dom}`}${corto?' ':', '}${t}`
  if(dow==='1-5') return `${corto?'lun. a vie. ':'lunes a viernes, '}${t}`
  if(dow&&dow!=='*') return `${dow.includes(',')?dow.split(',').map(x=>DC[x]).join(' y '):DL[dow]}${corto?' ':', '}${t}`
  return corto?`diario ${t}`:`todos los días, ${t}`
}

// Centro de agentes: cada proceso en su tema (por su nombre técnico), en el orden en que se muestran.
export const TEMAS_PROCESOS = [
  ['banco','Banco y conciliación',/^(agente-segunda|alerta-cartola|caja-chica|aviso-fondos-diario)/],
  ['fact','Facturación y SII',/^(facturas-sii|verificar-estados|cuadre-ventas|compras-sii|aviso-cuotas|bhe-correo|cierre-mes|f29-estimado|comisiones-documentos|xml-emitidos)/],
  ['trib','Tribunales, notaría y Diario Oficial',/^(causas-tablas|causas-monitor|notaria|diario-oficial|tgr-remates)/],
  ['norma','Normativa e indicadores',/^(sii-radar|normativa-sii-(manana|tarde)|vigilancia-normativa|indicadores)/],
  ['cli','Clientes, proyectos y tareas',/^(clientes-drive|agente-pmo|titulos-cortos|tareas-evidencia|task-reminders|cartera-semanal|pendientes-semanal)/],
  ['ofi','Oficina y costos',/^(oficina-|valores-contadora)/],
  ['equipo','Resúmenes al equipo',/^(tu-semana|resumen-lunes|gastos-limitado|horas-)/],
  ['control','Control de la app',/./],
]

export const temaProceso = jobname => (TEMAS_PROCESOS.find(([,,r])=>r.test(String(jobname||'')))||TEMAS_PROCESOS[TEMAS_PROCESOS.length-1])[0]

// «Lo que hizo» en una línea, leído de la última respuesta del proceso (procesos_corridas). Solo campos que el proceso devuelve;
// si no hay un resumen reconocible, la fecha de la última corrida. Nunca una cifra que no venga en la respuesta.
export function resumenCorrida(p){
  let r=null; try{ r=typeof p.respuesta==='string'?JSON.parse(p.respuesta):p.respuesta }catch(_){ r=null }
  const nn=(v,a,b)=>`${v} ${v===1?a:b}`, len=x=>Array.isArray(x)?x.length:null
  if(r&&typeof r==='object'){
    if(r.skipped==='apagado') return 'apagado'
    if(r.error) return `error: ${String(r.error).slice(0,80)}`
    const j=String(p.jobname||'')
    if(j==='causas-tablas-correo'&&r.correos!=null) return r.correos?`${nn(r.correos,'correo leído','correos leídos')} · ${r.en_tabla??0} ${r.en_tabla===1?'causa nuestra en tabla':'causas nuestras en tabla'}`:'Sin correos nuevos'
    if(/^causas-(tablas|monitor)/.test(j)&&r.revisadas!=null) return r.modo==='seguir'&&!r.revisadas&&!len(r.errores)?'Sin causas en la tabla de hoy':`${nn(r.revisadas,'causa revisada','causas revisadas')} · ${len(r.en_tabla)??0} en la tabla de hoy${len(r.errores)?` · ${len(r.errores)} sin revisar`:''}`
    if(j==='clientes-drive-sync'&&r.addedN!=null) return `${nn(r.addedN,'cliente nuevo','clientes nuevos')} · ${r.linkedN??0} vinculados`
    if(/^bhe-correo/.test(j)&&r.revisados!=null) return `${nn(r.revisados,'correo','correos')} · ${len(r.nuevas)??0} boletas nuevas`
    if(/^auditor-datos/.test(j)&&r.por_revisar!=null) return `${r.por_revisar} por revisar · ${r.nuevos??0} nuevos`
    if(/^oficina-liquidaciones/.test(j)&&r.liquidaciones!=null) return `${nn(r.liquidaciones,'liquidación leída','liquidaciones leídas')} · ${nn(r.correos??0,'correo','correos')}`
    if(/^vigilancia-procesos/.test(j)&&r.revisados!=null) return `${r.revisados} procesos · ${r.en_falla??0} en falla`
    if(/^titulos-cortos/.test(j)&&r.revisadas!=null) return `${r.revisadas} revisados · ${len(r.cambios)??0} cambios`
    if(/^tareas-evidencia/.test(j)&&r.revisadas!=null) return `${nn(r.revisadas,'tarea revisada','tareas revisadas')} · ${len(r.propuestas)??0} propuestas`
    if(/^agente-pmo/.test(j)&&r.nuevas!=null) return nn(r.nuevas,'paso sugerido','pasos sugeridos')
    if(/^notaria-sin-cliente/.test(j)&&r.n!=null) return nn(r.n,'OT sin cliente','OT sin cliente')
    if(/^notaria-pedir/.test(j)) return r.enviado?'liquidación pedida a la notaría':(r.motivo?String(r.motivo).replace(/\s*\(\d{4}-\d{2}-\d{2}\)/,''):'')
    if(/^facturas-sii-registrar/.test(j)&&Array.isArray(r.registradas)) return `${len(r.registradas)} registradas · ${len(r.a_bandeja)??0} por aprobar`
    if(/^xml-emitidos/.test(j)&&(r.cargados!=null||r.pendientes===0)) return r.pendientes?`${nn(r.cargados,'XML cargado','XML cargados')} de ${r.pendientes}`:'Sin XML pendientes'
    if(/^verificar-estados/.test(j)&&r.revisados!=null) return `${nn(r.revisados,'factura revisada','facturas revisadas')} · ${r.cambiados??0} con cambio`
    if(/^caja-chica-sweep/.test(j)&&r.nEnlazadas!=null) return nn(r.nEnlazadas,'transferencia enlazada','transferencias enlazadas')
    if(/^aviso-fondos-diario/.test(j)&&r.enviados!=null) return nn(r.enviados,'aviso enviado','avisos enviados')
    if(/^alerta-cartola/.test(j)&&r.gap!=null) return r.gap?`${nn(r.gap,'día','días')} sin cartola${r.enviado?' · aviso enviado':''}`:'cartolas al día'
    if(/^agente-segunda/.test(j)&&r.segunda_revision) return `${nn(r.segunda_revision.revisados??0,'comprobante revisado','comprobantes revisados')} · ${r.segunda_revision.registrados??0} registrados`
    if(/^task-reminders/.test(j)&&Array.isArray(r.sent)) return nn(r.sent.length,'recordatorio enviado','recordatorios enviados')
    if(/^notaria-documentos/.test(j)&&r.leidos!=null) return nn(r.leidos,'documento leído','documentos leídos')
    if(j==='sii-radar'&&r.inserted!=null) return nn(r.inserted,'norma nueva','normas nuevas')
    if(j==='tgr-remates'&&r.remates!=null) return `${r.remates} remates · ${r.de_clientes??0} de clientes`
  }
  return p.ultima?`última ${fechaHoraCL(p.ultima)}`:`primera: ${horarioProceso(p.schedule)}`
}

export const BANDEJA_TIPO={cuenta_bancaria:'Cuentas bancarias por confirmar',factura_sin_registrar:'Facturas por registrar',factura_sin_venta:'Facturas sin venta',fondo_por_registrar:'Fondos por registrar',comprobante:'Comprobantes por revisar',pedido_cliente:'Pedidos de clientes',respaldo_gasto:'Respaldos de gastos',boleta_honorarios:'Boletas de honorarios',liquidacion_notaria:'Liquidaciones de la notaría'}
export const HALLAZGO_TIPO={permiso_sin_sesion:'Permisos de la base fuera de la regla',compra_observada_sii:'Compras de proveedores observados por el SII',trabajo_terminado:'Trabajos activos que parecen terminados',trabajo_detenido_saldo:'Trabajos sin movimiento con saldo por cobrar',compra_plazo_reclamo:'Facturas recibidas en plazo de reclamo',cuota_tramo:'Cuotas programadas que superan la venta',glosa_conflicto:'Glosa con dos categorías aprendidas',anticipo_por_aplicar:'Anticipos por imputar',subarriendo_por_facturar:'Subarriendo pagado sin factura'}
// Etiqueta de un detector de Revisión de datos: la de esta tabla; si no, la del detector en _shared (misma que el correo del auditor); si no, genérica.
const _DEMO_HALLAZGOS=[{detector:'folio_duplicado',titulo:'Factura N° 448 en 2 filas'},{detector:'folio_duplicado',titulo:'Factura N° 451 en 2 filas'},{detector:'cuota_tramo',titulo:'Cuotas programadas que superan la venta · Cliente Demo'},{detector:'anticipo_por_aplicar',titulo:'Pago de subarriendo que calza con la Factura N° 502'}]
export const etiquetaHallazgo = k => HALLAZGO_TIPO[k] || DETECTOR_LBL[k] || 'Hallazgos de revisión'

export function ProcesosView({isDesktop, onBack, origen, onOpenBandeja, onOpenRevision, onOpenCartera, onOpenTareas, onOpenClientFicha}){
  // Por aprobar: lo que los agentes dejan para una persona, hoy repartido en 4 lugares (Bandeja, Revisión de datos, pasos de
  // proyectos y evidencias de tareas). Cada fila lleva a su lugar; aquí no se aprueba nada.
  const [pa,setPa]=useState(null), [paVer,setPaVer]=useState(()=>new Set()), [filtro,setFiltro]=useState(''), [temasAb,setTemasAb]=useState(()=>new Set())
  useEffect(()=>{ let on=true
    if(DEMO){ setPa({bandeja:_DEMO_BANDEJA.filter(r=>r.estado==='pendiente'||r.estado==='sospechoso'),hallazgos:_DEMO_HALLAZGOS,pmo:2,evid:1}); return ()=>{ on=false } }
    Promise.all([supabase.from('agente_bandeja').select('tipo,estado,asunto,propuesta').in('estado',['pendiente','sospechoso']),
      supabase.from('auditoria_hallazgos').select('detector,titulo').is('resuelto_at',null),
      supabase.from('pmo_sugerencias').select('id',{count:'exact',head:true}).eq('estado','pendiente'),
      supabase.from('tasks').select('id',{count:'exact',head:true}).not('evidencia','is',null).neq('status','Terminado')])
      .then(([b,h,pm,ev])=>{ if(!on) return
        setPa({bandeja:b.data||[],hallazgos:h.data||[],pmo:pm.count||0,evid:ev.count||0}) },()=>{ if(on) setPa({bandeja:[],hallazgos:[],pmo:0,evid:0}) })
    return ()=>{ on=false } },[])
  const [procs,setProcs]=useState(null), [err,setErr]=useState(null), [aviso,setAviso]=useState(null), [sel,setSel]=useState(null), [corr,setCorr]=useState(null)
  useEffect(()=>{ let on=true; cargarProcesos().then(d=>on&&setProcs(d),e=>on&&setErr(e.message||String(e)))
    if(!DEMO) supabase.from('learnings').select('value').eq('kind','config').eq('key','vigilancia_procesos').order('updated_at',{ascending:false}).limit(1).then(({data})=>on&&setAviso(String(data?.[0]?.value||'off')==='on'),()=>{}); else setAviso(false)
    return ()=>{ on=false } },[])
  useEffect(()=>{ if(!sel){ setCorr(null); return } if(DEMO){ setCorr(sel.ultima?[{id:1,lanzado_at:sel.ultima,estado:sel.estado,respuesta:sel.respuesta}]:[]); return }
    let on=true; supabase.from('procesos_corridas').select('id,lanzado_at,terminado_at,estado,status_code,respuesta').eq('jobname',sel.jobname).order('lanzado_at',{ascending:false}).limit(30).then(({data})=>on&&setCorr(data||[]),()=>on&&setCorr([]))
    return ()=>{ on=false } },[sel])
  const cambiarAviso = async()=>{ const nuevo=!aviso
    if(!await appConfirm(nuevo?'¿Encender el aviso de fallas? Cada hora la app revisa los procesos: los que fallan se reintentan solos (salvo los que envían correos) y, si siguen fallando después de 6 intentos, se envía un aviso desde la cuenta de la oficina, una vez por falla.':'¿Apagar el aviso de fallas? La página sigue mostrando el estado de cada proceso.')) return
    try{ await setLearningKV('config','vigilancia_procesos',nuevo?'on':'off'); setAviso(nuevo); logActividad('procesos.aviso_'+(nuevo?'encendido':'apagado'),{detalle:{title:`Aviso de fallas de procesos ${nuevo?'encendido':'apagado'}`}}) }catch(e){ appAlert('No se pudo guardar: '+(e.message||e)) } }
  const card={background:C.surface,border:`1px solid ${C.border}`,borderRadius:12}
  const chip=e=><span style={{fontSize:11,fontWeight:700,borderRadius:20,padding:'2px 9px',background:e.bg,color:e.c,whiteSpace:'nowrap'}}>{e.t}</span>
  const wrap=ch=><div style={isDesktop?{maxWidth:1240,margin:'0 auto',padding:'12px 20px 40px'}:{padding:'8px 16px 40px'}}>{ch}</div>
  if(sel){ const e=estadoProceso(sel)
    return wrap(<>
      <PageHeader origen='Procesos automáticos' onBack={()=>setSel(null)} titulo={isDesktop?sel.nombre:'Detalle'} style={{margin:isDesktop?'-12px -20px 12px':'-8px -16px 12px'}}/>
      <div style={{...card,padding:'12px 14px',marginBottom:12}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}><div style={{minWidth:0}}><div style={{fontSize:16,fontWeight:700,color:C.accent,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden',lineHeight:1.25}}>{sel.nombre}</div><div style={{fontSize:12,color:C.textSoft}}>{horarioProceso(sel.schedule)} · hora de Chile</div></div>{chip(e)}</div>
        <div style={{display:'grid',gridTemplateColumns:isDesktop?'repeat(3,minmax(0,1fr))':'minmax(0,1fr)',gap:8,marginTop:10}}>
          {[['Última corrida',fechaHoraCL(sel.ultima)],['Última correcta',fechaHoraCL(sel.ultima_ok)],['Fallas en 30 días',String(sel.fallas_30d||0)]].map(([a,b])=><div key={a} style={{background:C.bgSoft,borderRadius:10,padding:'8px 11px',display:'flex',justifyContent:'space-between',gap:8}}><span style={{fontSize:12,color:C.textSoft}}>{a}</span><b style={{fontSize:13,color:C.text,fontVariantNumeric:'tabular-nums'}}>{b}</b></div>)}
        </div>
      </div>
      <div style={{...SEC_LBL,margin:'4px 2px 6px'}}>Corridas registradas · {corr?corr.length:'…'}</div>
      <div style={{...card,overflow:'hidden'}}>
        {(corr||[]).map((c,i)=>{ const ec=estadoProceso({active:true,estado:c.estado}); return <div key={c.id} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',borderTop:i?`1px solid ${C.track}`:'none'}}>
          <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums'}}>{fechaHoraCL(c.lanzado_at)}</div><div style={{fontSize:11,color:C.textSoft,fontFamily:'ui-monospace,Menlo,monospace',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden',lineHeight:1.25}}>{c.respuesta?`Respuesta: ${c.respuesta}`:'Sin respuesta todavía'}</div></div>{chip(ec)}</div> })}
        {corr&&!corr.length&&<div style={{padding:18,textAlign:'center',fontSize:13,color:C.muted}}>Sin corridas registradas todavía.</div>}
      </div>
    </>) }
  const lista=procs||[]
  const n=k=>lista.filter(p=>estadoProceso(p).k===k).length
  // Los cuatro estados de siempre: cada uno es un filtro de la lista de procesos (tocarlo de nuevo lo quita).
  const partes=[['ok','Correctos',n('ok'),C.greenText,C.greenBg],['falla','Con falla',n('falla'),n('falla')?C.overdueText:C.textSoft,n('falla')?C.overdueBg:C.bgSoft],['sin','Aún no corren',n('sin'),C.textSoft,C.bgSoft],['pausa','Apagados',n('pausa'),C.textSoft,C.bgSoft]]
  const nomTema=p=>(TEMAS_PROCESOS.find(t=>t[0]===temaProceso(p.jobname))||[])[1]||''
  // Fila de un agente: nombre, lo que hizo (última respuesta) y su estado.
  const fila=(p,i,conTema)=>{ const e=estadoProceso(p)
    return <div key={p.jobname} onClick={()=>setSel(p)} style={{display:'flex',alignItems:'center',gap:10,padding:isDesktop?'9px 14px':'9px 12px',borderTop:i?`1px solid ${C.track}`:'none',cursor:'pointer'}}>
      <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:C.text,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden',lineHeight:1.25}}>{p.nombre}</div>
        <div style={{fontSize:11,color:C.textSoft,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden',lineHeight:1.25,fontVariantNumeric:'tabular-nums'}}>{conTema?`${nomTema(p)} · `:''}{resumenCorrida(p)}</div></div>
      {chip(e)}<span style={{color:C.textSoft}}><Gl n='chevron'/></span></div> }
  const altTema=k=>setTemasAb(s=>{ const n=new Set(s); n.has(k)?n.delete(k):n.add(k); return n })
  // Tema = una fila de la tarjeta; con el filtro «Correctos» solo cuenta y despliega los correctos.
  const filaTema=([k,t],i)=>{ const todos=lista.filter(p=>temaProceso(p.jobname)===k), ps=filtro==='ok'?todos.filter(p=>estadoProceso(p).k==='ok'):todos; if(!ps.length) return null
    const ab=temasAb.has(k), c=x=>ps.filter(p=>estadoProceso(p).k===x).length, ok=c('ok'), fa=c('falla'), si=c('sin'), ap=c('pausa')
    const res=ok===ps.length?`${ps.length} agentes · todos correctos`:[fa?`${fa} con falla`:'',ok?`${ok} correcto${ok===1?'':'s'}`:'',si?`${si} aún no corre${si===1?'':'n'}`:'',ap?`${ap} apagado${ap===1?'':'s'}`:''].filter(Boolean).join(' · ')
    return <div key={k} style={{borderTop:i?`1px solid ${C.track}`:'none'}}>
      <div onClick={()=>altTema(k)} style={{display:'flex',alignItems:'center',gap:10,padding:'12px 14px',cursor:'pointer'}}>
        <span style={{width:28,height:28,borderRadius:8,background:fa?C.overdueBg:C.azulBg,color:fa?C.overdueText:C.accent,display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:800,flexShrink:0}}>{t[0]}</span>
        <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:700,color:C.accent}}>{t}</div><div style={{fontSize:11,color:fa?C.overdueText:C.textSoft,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden',lineHeight:1.25}}>{res}</div></div>
        <span style={{color:C.done,fontSize:13,display:'inline-flex',transform:ab?'rotate(180deg)':'none'}}><Gl n='chevD'/></span></div>
      {ab&&ps.map((p,j)=>fila(p,1+j))}</div> }
  const planas=filtro&&filtro!=='ok'?lista.filter(p=>estadoProceso(p).k===filtro):null
  // Por aprobar agrupado por destino: cada fila = un tipo de decisión, con su cantidad y a dónde lleva.
  const folios=(rs,campo)=>{ const f=rs.map(r=>(String(r[campo]||'').match(/N° ?(\d+)/)||[])[1]).filter(Boolean); return f.length===rs.length&&f.length?`N° ${f.slice(0,2).join(', ')}${f.length>2?` y ${f.length-2} más`:''}`:'' }
  const paFilas=(()=>{ if(!pa) return []; const out=[]
    const gb={}; pa.bandeja.forEach(r=>{ const k=r.estado==='sospechoso'?'sospechoso':r.tipo||'otro'; (gb[k]=gb[k]||[]).push(r) })
    Object.entries(gb).forEach(([k,rs])=>out.push({k:'b'+k,d:'b',t:k==='sospechoso'?'Cambios de cuenta por revisar':BANDEJA_TIPO[k]||'Correos por revisar',s:['factura_sin_registrar','factura_sin_venta'].includes(k)?folios(rs,'asunto'):'',n:rs.length,on:()=>onOpenBandeja(k)}))
    const gh={}; pa.hallazgos.forEach(h=>{ (gh[h.detector]=gh[h.detector]||[]).push(h) })
    Object.entries(gh).forEach(([k,hs])=>out.push({k:'h'+k,d:'r',t:etiquetaHallazgo(k),s:folios(hs,'titulo'),n:hs.length,on:()=>onOpenRevision(k)}))
    if(pa.pmo) out.push({k:'pmo',d:'p',t:'Pasos sugeridos de proyectos',s:'Mis proyectos',n:pa.pmo,on:onOpenCartera})
    if(pa.evid) out.push({k:'ev',d:'p',t:'Tareas cumplidas según los registros',s:'Tareas · por confirmar',n:pa.evid,on:onOpenTareas})
    return out })()
  const paTot=paFilas.reduce((a,x)=>a+x.n,0)
  const MAX=isDesktop?5:4
  const DESTINOS=[['b','Bandeja del agente','B',C.soonBg,C.soonText,()=>onOpenBandeja()],['r','Revisión de datos','R',C.azulBg,C.accent,()=>onOpenRevision()],['p','Proyectos y tareas','P',C.greenBg,C.greenText,null]]
  const lbl2={...SEC_LBL,margin:'0 2px 8px',display:'flex',justifyContent:'space-between',gap:8}
  const tarjetaDestino=([d,t,l,bg,fg,abrir])=>{ const fs=paFilas.filter(x=>x.d===d); if(!fs.length) return null
    const todo=paVer.has(d), vis=todo?fs:fs.slice(0,MAX), tot=fs.reduce((a,x)=>a+x.n,0)
    return <div key={d} style={{...card,overflow:'hidden',minWidth:0}}>
      <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',borderBottom:`1px solid ${C.track}`}}>
        <span style={{width:32,height:32,borderRadius:9,background:bg,color:fg,display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:800,flexShrink:0}}>{l}</span>
        <div style={{flex:1,minWidth:0,fontSize:13.5,fontWeight:700,color:C.accent}}>{t}</div>
        <span style={{fontSize:15,fontWeight:800,color:C.soonText,fontVariantNumeric:'tabular-nums'}}>{tot}</span>
        {abrir&&<button type='button' onClick={abrir} style={{fontSize:12.5,fontWeight:600,color:C.azulInfo,background:'none',border:0,padding:'4px',cursor:'pointer',whiteSpace:'nowrap'}}>Abrir ›</button>}</div>
      {vis.map((x,i)=><div key={x.k} onClick={x.on||undefined} style={{display:'flex',alignItems:'center',gap:10,padding:isDesktop?'9px 14px':'9px 12px',borderTop:i?`1px solid ${C.track}`:'none',cursor:x.on?'pointer':'default'}}>
        <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:C.text,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden',lineHeight:1.25}}>{x.t}</div>{x.s&&<div style={{fontSize:11,color:C.textSoft,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden',lineHeight:1.25}}>{x.s}</div>}</div>
        <span style={{fontSize:13,fontWeight:800,color:C.accent,fontVariantNumeric:'tabular-nums'}}>{x.n}</span>
        {x.on&&<span style={{fontSize:12,fontWeight:700,color:C.azulInfo,whiteSpace:'nowrap'}}>Revisar ›</span>}</div>)}
      {fs.length>MAX&&<button type='button' onClick={()=>setPaVer(s=>{ const m=new Set(s); m.has(d)?m.delete(d):m.add(d); return m })} style={{display:'block',width:'100%',textAlign:'left',fontSize:12,fontWeight:700,color:C.azulInfo,background:'none',border:0,borderTop:`1px solid ${C.track}`,padding:'8px 14px',cursor:'pointer'}}>{todo?'Ver menos':`Ver ${fs.length-MAX} más`}</button>}</div> }
  const izq=<>
    <div style={lbl2}><span>Por aprobar{paTot?` · ${paTot}`:''}</span></div>
    {pa===null?<div style={{...card,padding:16,fontSize:13,color:C.muted}}>Cargando…</div>
      :!paTot?<div style={{...card,display:'flex',alignItems:'center',gap:10,padding:'12px 14px'}}><span style={{width:28,height:28,borderRadius:8,background:C.greenBg,color:C.greenText,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><Gl n='tick'/></span><span style={{fontSize:13,color:C.textSoft}}>Nada pendiente</span></div>
      :<div style={{display:'flex',flexDirection:'column',gap:isDesktop?12:10}}>{DESTINOS.map(tarjetaDestino)}</div>}
  </>
  const der=<>
    <div style={lbl2}><span>Procesos automáticos · {lista.length}</span></div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:8}}>
      {partes.map(([k,t,v,c,bg])=><button key={k} type='button' aria-pressed={filtro===k} onClick={()=>setFiltro(f=>f===k?'':k)} style={{background:bg,border:0,borderRadius:10,padding:'8px 11px',display:'flex',justifyContent:'space-between',alignItems:'center',gap:6,textAlign:'left',minWidth:0,width:'100%',cursor:'pointer',fontFamily:'inherit',boxShadow:filtro===k?`0 0 0 2px ${C.accent}`:'none'}}><span style={{fontSize:12,fontWeight:600,color:c,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{t}</span><span style={{fontSize:15,fontWeight:800,color:c,fontVariantNumeric:'tabular-nums'}}>{v}</span></button>)}
    </div>
    <div style={{...card,overflow:'hidden',marginTop:12}}>
      {planas?(planas.length?planas.map((p,i)=>fila(p,i,true)):<div style={{padding:18,textAlign:'center',fontSize:13,color:C.muted}}>Ninguno.</div>):TEMAS_PROCESOS.map(filaTema)}
    </div>
    <div style={{...card,padding:'10px 14px',marginTop:12,display:'flex',alignItems:'center',gap:10}}>
      <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:700,color:C.text,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden',lineHeight:1.25}}>{'Aviso de fallas'}</div><div style={{fontSize:12,color:C.textSoft,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden',lineHeight:1.25}}>{isDesktop?'reintenta cada hora lo que falla · avisa tras 6 intentos':'reintenta cada hora · aviso tras 6'}</div></div>
      {aviso!=null&&chip(aviso?{t:'Encendido',bg:C.greenBg,c:C.greenText}:{t:'Apagado',bg:C.bgSoft,c:C.textSoft})}
      {aviso!=null&&!DEMO&&<button onClick={cambiarAviso} style={{fontSize:12,fontWeight:700,border:aviso?`1px solid ${C.border}`:'none',borderRadius:10,padding:'6px 12px',cursor:'pointer',background:aviso?C.surface:C.accent,color:aviso?C.accent:'#fff',whiteSpace:'nowrap'}}>{aviso?'Apagar':'Encender'}</button>}
    </div>
    <div style={{marginTop:12}}><BitacoraLista prefijo='procesos.' titulo='Bitácora de procesos' limite={12} vacio='Aún no hay registros.' etiquetas={{'procesos.falla_detectada':'Falla detectada','procesos.resuelto':'Resuelto','procesos.falla_avisada':'Aviso enviado','procesos.aviso_encendido':'Aviso encendido','procesos.aviso_apagado':'Aviso apagado','procesos.vigilancia_encendida':'Aviso encendido','procesos.fallas_revisadas':'Fallas revisadas'}}/></div>
    <ConsumoIA/>
  </>
  return wrap(<>
    <PageHeader origen={origen||'Oficina'} onBack={onBack} titulo='Procesos automáticos' style={{margin:isDesktop?'-12px -20px 12px':'-8px -16px 12px'}}/>
    {err&&<div style={{...card,padding:16,color:C.overdueText,fontSize:13,marginBottom:12}}>No se pudo leer el estado de los procesos: {err}</div>}
    {!procs&&!err&&<div style={{padding:30,textAlign:'center',color:C.muted,fontSize:13}}>Cargando…</div>}
    {procs&&(isDesktop
      ?<div style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr)',gap:16,alignItems:'start'}}><div>{izq}</div><div>{der}</div></div>
      :<>{izq}<div style={{marginTop:16}}>{der}</div></>)}
  </>)
}
