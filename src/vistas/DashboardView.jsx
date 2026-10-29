// Movido desde App.jsx por scripts/mover-a-modulo.py. Sin cambios de comportamiento.
import { useState, useEffect, useCallback, useMemo, Fragment } from 'react'
import { supabase, selectAll, DEMO } from '../supabase'
import { demoData } from '../demoData'
import { fgCliente, gastosPorRendirCli } from '../../supabase/functions/_shared/gastosReglas.js'
import { ventasFacturando } from '../../supabase/functions/_shared/ventasReglas.js'
import { BRAND, C, Gl, SEC_LBL, SIcon, appAlert, diaGrande, fmt, fmtFechaDMY, fmtN, folioN, personChip, useIsDesktop } from '../lib/base.jsx'
import { CART_DOT, ChevAb, INICIALES_RESP, MES_C, META_UF, NOMBRE_CLI, SEÑAL_COL, UF_FALLBACK, _diasDesde, _esOfiCliR, publicarResultadoInicio, _ymPrev, alertasCajaChica, bigDate, carteraMovimiento, claudeCall, cobradoBill, comisPorPagarAnteriores, comisionesVenta, costosOficinaMes, currentYear, daysLeft, daysLeftB, esFacIngreso, esRecurrente, esSubarriendo, esVencidaB, flujoCajaProyectado, fmtDate, fmtMill, fmtMillLR, fmtShort, fmtUFk, gastosPorLiquidarCaja, logEvent, margenDeSale, margenPct, mesCorto, mesTitulo, montoFactura, nDias, porCobrarBills, redondearPartes, resultadoMes, saldoBill, saldoComisiones, saldoDelta, taskAssignees, ufDelDia, urgencyColor, useCalTrib, useFlujoCaja, useFuentesResultado, usePersistedState, useUF, useUFFechas, ventaCLP, ventaCuentaEnAnio, ventaUF } from '../lib/compartido.jsx'

// Overhead de oficina por hora (fuente única): costos NO-remuneración/mes ÷ horas del equipo CON costo (Σ metas ×4,33).
export function overheadHoraDe(costosOfiRows, metas={}, costoHora={}, ym){
  ym = ym || new Date().toISOString().slice(0,7)
  const eff=r=>(r.desde && ym<String(r.desde).slice(0,7))?(r.monto_prev??r.monto):r.monto
  const overheadMes=(costosOfiRows||[]).filter(r=>!['Remuneraciones','Leyes sociales'].includes(r.categoria)).reduce((a,r)=>a+(r.es_ingreso?-1:1)*(Number(eff(r))||0),0)
  const capMes=Object.keys(metas).filter(n=>Number(costoHora[n])>0).reduce((a,n)=>a+(Number(metas[n])||0),0)*4.33
  return capMes>0 ? overheadMes/capMes : 0
}

export const META_CLP = 400000000

// Fila de CASCADA (regla «aperturas aritméticas»): signo | etiqueta | píldora | flecha | cifra. Se lee como suma.
// kind: neg (resta, rojo) · tot (subtotal) · res/resNeg (resultado) · sub (detalle chico). tenue: cifra en gris (lo que queda aparte del total).
export function CxRow({sg='',label,extra,pill,val,kind,onClick,open,isDesk,tenue}){
  const tot=kind==='tot', res=kind==='res'||kind==='resNeg', sub=kind==='sub', fuerte=tot||res
  return (<div onClick={onClick} style={{display:'grid',gridTemplateColumns:isDesk?'16px minmax(0,1fr) auto 10px auto':'14px minmax(0,1fr) auto 10px auto',columnGap:6,alignItems:'center',padding:res?'12px 14px':sub?'7px 14px':'9px 14px',borderTop:fuerte?`1.5px solid ${C.accent}`:`1px solid ${C.border}`,background:res?'#EDF1F4':sub?C.bgSoft:undefined,cursor:onClick?'pointer':'default'}}>
    <span style={{fontSize:14,fontWeight:700,color:fuerte?C.accent:C.muted,textAlign:'center'}}>{sg}</span>
    <span style={{fontSize:sub?11.5:13,color:fuerte?C.accent:C.muted,fontWeight:fuerte?800:600,display:'flex',alignItems:'baseline',gap:6,minWidth:0,whiteSpace:'nowrap',overflow:'hidden'}}>{label}{extra}</span>
    <span style={{justifySelf:'end'}}>{pill||null}</span>
    <span style={{color:C.textSoft,display:'flex',justifyContent:'center'}}>{open!=null&&<ChevAb open={open}/>}</span>
    <span style={{fontWeight:800,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap',justifySelf:'end',color:(kind==='neg'||kind==='resNeg')?C.overdueText:(tenue&&!fuerte)?C.textSoft:C.accent,fontSize:res?20:tot?15:sub?11.5:13,letterSpacing:res?'-.4px':undefined}}>{val}</span>
  </div>) }

// Proyección de cobranza al 31-12 (Inicio): el MISMO cálculo del Flujo de caja (flujoCajaProyectado.cobros: plazo de pago real de
// cada cliente, sin morosas ni cuotas atrasadas, anticipos descontados), solo que hasta fin de año. Sus primeras 8 semanas son
// exactamente la Cobranza del Flujo; lo moroso y lo atrasado sin emitir quedan aparte (Trabajo impago), como en el Flujo.
export function proyeccionCobranza(F, hoy=new Date()){
  const fin=new Date(hoy.getFullYear(),11,31,23,59,59).getTime()
  const items=(F?.cobros||[]).filter(x=>x.t<=fin)
  return {items, total:items.reduce((a,x)=>a+x.m,0), anio:hoy.getFullYear(), fin}
}

export function ProyeccionDetalle({F, clients=[], sales=[], isDesktop=false, onOpenFlujoCaja, onOpenClientFicha}){
  const [anio,setAnio]=useState('todos')
  const [open,setOpen]=useState(null)
  const P=useMemo(()=>proyeccionCobranza(F),[F])
  const saleById=useMemo(()=>{ const m={}; (sales||[]).forEach(s=>{ if(s) m[String(s.id)]=s }); return m },[sales])
  const cliById=useMemo(()=>{ const m={}; (clients||[]).forEach(c=>{ if(c) m[String(c.id)]=c }); return m },[clients])
  const anioDe=b=>(b.sale_id&&saleById[String(b.sale_id)]?.year)||b.sale_year||null
  // El subarriendo no es de ningún socio (regla 18-10): va a «Oficina», nunca al abogado del cliente.
  const respDe=b=>b.billing_type==='subarriendo'?'Oficina':((b.sale_id&&saleById[String(b.sale_id)]?.responsible)||cliById[String(b.client_id)]?.abogado_responsable||'Sin abogado')
  const anios=useMemo(()=>[...new Set(P.items.map(x=>anioDe(x.b)).filter(Boolean))].sort((a,b)=>b-a),[P,saleById])
  const items=useMemo(()=>anio==='todos'?P.items:P.items.filter(x=>String(anioDe(x.b))===String(anio)),[P,anio,saleById])
  const sum=a=>a.reduce((s,x)=>s+x.m,0)
  const tot=sum(items), paso=tot>=1e6?1e5:1e4
  const emit=items.filter(x=>x.k==='emit'), prog=items.filter(x=>x.k==='prog')
  const [eV,pV]=redondearPartes([sum(emit),sum(prog)],paso)
  const isoDe=t=>{ const d=new Date(t); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
  const meses=useMemo(()=>{ const m={}; items.forEach(x=>{ const k=isoDe(x.t).slice(0,7); (m[k]=m[k]||[]).push(x) }); return Object.entries(m).sort(([a],[b])=>a.localeCompare(b)) },[items])
  const mesV=redondearPartes(meses.map(([,a])=>sum(a)),paso)
  const abog=useMemo(()=>{ const m={}; items.forEach(x=>{ const r=respDe(x.b); (m[r]=m[r]||[]).push(x) }); return Object.entries(m).map(([r,a])=>({r,a,v:sum(a)})).sort((x,y)=>y.v-x.v) },[items,saleById,cliById])
  const abV=redondearPartes(abog.map(x=>x.v),paso), abP=tot>0?redondearPartes(abog.map(x=>x.v/tot*100),1):abog.map(()=>0)
  // 8 semanas = la Cobranza del Flujo (F.E, misma cifra). Solo si esas 8 semanas terminan antes del 31-12 (si no, superarían el total).
  const w8fin=F?.weeks?.length?new Date(F.weeks[F.weeks.length-1].ini+'T12:00:00').getTime()+6*86400000:null
  const ver8=anio==='todos'&&w8fin!=null&&w8fin<=P.fin&&F.E>0
  const tiPaso=(F?.duda?.monto||0)+(F?.sinEmitir?.monto||0)>=1e6?1e5:1e4
  const [morV,pfV]=redondearPartes([F?.duda?.monto||0,F?.sinEmitir?.monto||0],tiPaso,[0])   // igual que la página del Flujo
  const tog=k=>()=>setOpen(o=>o===k?null:k)
  const pill=(t,tone)=><span style={{fontSize:10,fontWeight:700,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap',background:tone==='g'?C.greenBg:C.azulBg,color:tone==='g'?C.greenText:C.azulInfo}}>{t}</span>
  const cap=(t,line,der)=><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,padding:'12px 14px 6px',...SEC_LBL,fontWeight:800,borderTop:line?`1px solid ${C.border}`:undefined}}><span>{t}</span>{der}</div>
  const lista=(k,arr)=>open===k&&[...arr].sort((a,b)=>a.t-b.t).map(x=>{ const b=x.b, cid=b.client_id; return (
    <div key={k+String(b.id)} onClick={()=>cid&&onOpenClientFicha&&onOpenClientFicha(cid)} style={{display:'flex',alignItems:'center',gap:11,padding:'8px 14px',borderTop:`1px solid ${C.border}`,background:C.bgSoft,cursor:cid?'pointer':'default'}}>
      {diaGrande(isoDe(x.t))}
      <div style={{flex:1,minWidth:0}}><div style={{...NOMBRE_CLI,fontSize:13}}>{cliById[String(cid)]?.name||'Sin cliente'}</div><div style={{fontSize:10.5,color:C.textSoft,fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{b.invoice_no?`Factura N° ${folioN(b.invoice_no)}`:(b.concept||'Cuota por emitir')}</div></div>
      <span style={{fontSize:13,fontWeight:800,color:C.accent,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fmt(Math.round(x.m))}</span>
    </div>) })
  const sel=anios.length>1&&<select value={anio} onClick={e=>e.stopPropagation()} onChange={e=>{setAnio(e.target.value);setOpen(null)}} style={{fontSize:11,fontWeight:600,padding:'3px 7px',borderRadius:6,border:`1px solid ${C.border}`,background:'#fff',color:C.accent,cursor:'pointer',textTransform:'none',letterSpacing:0}}>
    <option value='todos'>Año venta: todos</option>{anios.map(y=><option key={y} value={y}>Año venta {y}</option>)}</select>
  const d=isDesktop
  return (<div style={{background:C.tileBg,border:`1px solid ${C.tileLine}`,borderRadius:12,overflow:'hidden'}}>
    {cap(`Proyección al ${fmtFechaDMY(`${P.anio}-12-31`)}`,false,sel)}
    {tot<=0&&<div style={{padding:'4px 14px 14px',fontSize:12,color:C.muted}}>Sin cobros esperados hasta el 31-12.</div>}
    {tot>0&&<>
      <CxRow isDesk={d} label='Facturas emitidas al día' pill={emit.length?pill(d?`${emit.length} factura${emit.length!==1?'s':''}`:emit.length):null} val={fmtMillLR(eV)} open={emit.length?open==='emit':null} onClick={emit.length?tog('emit'):undefined}/>
      {lista('emit',emit)}
      <CxRow isDesk={d} sg='+' label='Cuotas por emitir' pill={prog.length?pill(d?`${prog.length} cuota${prog.length!==1?'s':''}`:prog.length):null} val={fmtMillLR(pV)} open={prog.length?open==='prog':null} onClick={prog.length?tog('prog'):undefined}/>
      {lista('prog',prog)}
      <CxRow isDesk={d} sg='=' kind='res' label={`Proyección al 31-12`} val={fmtMillLR(eV+pV)}/>
      {cap('Cuándo entra',true)}
      {meses.map(([ym,a],i)=><Fragment key={ym}><CxRow isDesk={d} kind='sub' label={mesTitulo(new Date(ym+'-15T12:00:00')).split(' ')[0]} val={fmtMillLR(mesV[i])} open={open==='m'+ym} onClick={tog('m'+ym)}/>{lista('m'+ym,a)}</Fragment>)}
      {ver8&&<CxRow isDesk={d} label='Próximas 8 semanas' pill={pill(d?'igual al Flujo':'Flujo','g')} val={fmtMillLR(F.E)} open={onOpenFlujoCaja?false:null} onClick={onOpenFlujoCaja}/>}
      {abog.length>0&&cap('Por abogado',true)}
      {abog.map((x,i)=>{ const pc=personChip(x.r); return <Fragment key={x.r}><CxRow isDesk={d} kind='sub' sg={<span style={{display:'inline-block',width:7,height:7,borderRadius:'50%',background:pc.color||C.muted}}/>} label={x.r} pill={pill(`${abP[i]}%`)} val={fmtMillLR(abV[i])} open={open==='a'+x.r} onClick={tog('a'+x.r)}/>{lista('a'+x.r,x.a)}</Fragment> })}
    </>}
    {anio==='todos'&&(morV+pfV)>0&&<>
      {cap('Aparte · trabajo impago',true)}
      <CxRow isDesk={d} tenue label='Cartera morosa' pill={F.duda.n?pill(d?`${F.duda.n} factura${F.duda.n!==1?'s':''}`:F.duda.n):null} val={fmtMillLR(morV)} open={onOpenFlujoCaja?false:null} onClick={onOpenFlujoCaja}/>
      <CxRow isDesk={d} tenue sg='+' label='Por facturar vencido' pill={F.sinEmitir.n?pill(d?`${F.sinEmitir.n} cuota${F.sinEmitir.n!==1?'s':''}`:F.sinEmitir.n):null} val={fmtMillLR(pfV)} open={onOpenFlujoCaja?false:null} onClick={onOpenFlujoCaja}/>
      <CxRow isDesk={d} tenue sg='=' kind='tot' label='Trabajo impago' val={fmtMillLR(morV+pfV)}/>
    </>}
    {onOpenFlujoCaja&&<div onClick={onOpenFlujoCaja} style={{display:'flex',justifyContent:'center',alignItems:'center',gap:4,padding:'10px 14px',borderTop:`1px solid ${C.border}`,color:C.azulInfo,fontWeight:700,fontSize:12,cursor:'pointer'}}>Ver todo en Flujo de caja <Gl n='chevron'/></div>}
  </div>)
}

// Aging de cartera: clasifica las cuentas por cobrar (Pendiente/Vencido) por días de
// vencimiento sobre `due` (la app no tiene due_date/fecha; `due` ya es emisión + 30d).
export function computeAgingCartera(billingRows, clientesMap){
  const COL = { current:C.normal, warning:C.soon, overdue:C.overdue }
  const BG  = { current:C.greenBg, warning:C.soonBg, overdue:C.overdueBg }
  const LBL = { current:'Al día', warning:'31-60 días', overdue:'Vencido +60' }
  // Mismo universo que porCobrarBills (fuente única del "por cobrar"): emitidas con folio, no borradas.
  // Sin esto el aging contaba facturas borradas y sin folio (por facturar), inflando el total ~$40M.
  const pend = (billingRows||[]).filter(b=>(b.status==='Pendiente'||b.status==='Vencido') && b.invoice_no && !b.deleted_at)
  const diasVenc = b => { const dl=daysLeftB(b); return dl===null?null:-dl }   // misma base que Cobranza (emisión + 30)
  const bucketDe = b => { const dv=diasVenc(b); if(dv===null) return 'current'; if(dv>60) return 'overdue'; if(dv>30) return 'warning'; return 'current' }
  const total = pend.reduce((a,b)=>a+saldoBill(b),0)
  const pct = m => total>0?Math.round(m/total*100):0
  const sumB = k => pend.filter(b=>bucketDe(b)===k).reduce((a,b)=>a+saldoBill(b),0)
  const cur=sumB('current'), war=sumB('warning'), over=sumB('overdue')
  // Facturas que componen cada tramo (para el detalle al hacer click), ordenadas por monto desc.
  const itemsB = k => pend.filter(b=>bucketDe(b)===k).map(b=>{ const cid=b.client_id||'__none__'; const nombre=(clientesMap&&clientesMap[cid])||b.receptor_name||'Sin cliente'; return {id:b.id, client_id:b.client_id||null, invoice_no:b.invoice_no, nombre, monto:saldoBill(b), concept:b.concept||'', due:b.due, dias:diasVenc(b)} }).sort((a,b)=>(b.dias||0)-(a.dias||0)||b.monto-a.monto)
  const buckets = { current:{monto:cur,pct:pct(cur),items:itemsB('current')}, warning:{monto:war,pct:pct(war),items:itemsB('warning')}, overdue:{monto:over,pct:pct(over),items:itemsB('overdue')} }

  // Delta: pendiente actual vs total facturado el mes anterior (por created_at)
  const now = new Date()
  const ym = (y,m)=>`${y}-${String(m).padStart(2,'0')}`
  const mesAnt = now.getMonth()===0 ? ym(now.getFullYear()-1,12) : ym(now.getFullYear(),now.getMonth())
  const totMesAnt = (billingRows||[]).filter(b=>(b.created_at||'').startsWith(mesAnt)).reduce((a,b)=>a+(b.amount||0),0)
  const delta = { monto: totMesAnt>0?(total-totMesAnt):0, pct: totMesAnt>0?Math.round((total-totMesAnt)/totMesAnt*100):0 }

  // DSO ponderado por monto
  const dsoRaw = total>0 ? pend.reduce((a,b)=>a+saldoBill(b)*(diasVenc(b)||0),0)/total : 0
  const dso = Math.max(0, Math.round(dsoRaw))

  // Top 5 por cliente, con el tramo más crítico del cliente
  const byClient = {}
  pend.forEach(b=>{
    const cid=b.client_id||'__none__'
    const nombre=(clientesMap&&clientesMap[cid])||b.receptor_name||'Sin cliente'
    if(!byClient[cid]) byClient[cid]={id:cid,nombre,facturas:0,monto:0,rank:0}
    byClient[cid].monto+=saldoBill(b); byClient[cid].facturas+=1
    const k=bucketDe(b), r=k==='overdue'?3:k==='warning'?2:1
    if(r>byClient[cid].rank) byClient[cid].rank=r
  })
  const keyDe = r => r===3?'overdue':r===2?'warning':'current'
  const top5 = Object.values(byClient).sort((a,b)=>b.monto-a.monto).slice(0,5).map(c=>{
    const k=keyDe(c.rank)
    const iniciales=(c.nombre||'?').split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase()
    return { id:c.id, nombre:c.nombre, facturas:c.facturas, monto:c.monto, bucketLabel:LBL[k], bucketColor:COL[k], bucketBg:BG[k], iniciales }
  })
  const mayor = top5[0] || {nombre:'—',monto:0}
  return { total, buckets, delta, dso, mayorExposicion:{nombre:mayor.nombre,monto:mayor.monto}, concentracionTop1Pct: total>0?(mayor.monto/total*100):0, top5 }
}

export function Dashboard({onRendirClientes=null,proyHitos=[],sales,billing,fantasmaIds=new Set(),anticipos=[],clients,clientEntities=[],expenses,tasks,pettyCash,terceros=[],proveedores=[],rendiciones=[],proyectosCartera=[],setTab,navTo,user,onAddTask,onEditTask,onCompleteTask,onPreviewTask,onEntregarCaja,tareasOpen=false,onTareasClose,onOpenOficina,costosOfiMes=0,costosOfiRows=[],onOpenCostosOfi,onOpenEstadoResultados,onOpenFlujoCaja,onOpenClientFicha,onOpenPlazos,onOpenCalTrib,onOpenProyecto,onAcceso,onOpenEmitidoMes,prioOpen=false,setPrioOpen}) {
  const go = t => navTo ? navTo({tab:t}) : setTab(t)   // salto que apila origen+scroll (navTo) para que "Volver" regrese al Inicio en su posición exacta
  const [misProyOpen,setMisProyOpen] = usePersistedState('dash_misproy_open',false)
  const [verTodosProy,setVerTodosProy] = useState(false)   // "Ver todos" en Mis proyectos: carga mis terminados y muestra los 3 grupos
  const [terminadosProy,setTerminadosProy] = useState(null) // mis proyectos terminados (activo:false), cargados bajo demanda
  const cargarTerminadosProy = useCallback(async()=>{
    setVerTodosProy(true)
    if(terminadosProy!==null) return
    if(DEMO){ setTerminadosProy([{id:'pt1',cliente_id:'c4',nombre_proyecto:'Sucesión y posesión efectiva',responsable:INICIALES_RESP[user?.name]||null,estado:'verde',activo:false,updated_at:new Date(Date.now()-38*864e5).toISOString()}]); return }
    const miIni=INICIALES_RESP[user?.name]||null
    let qy=supabase.from('proyectos_cartera').select('*').eq('activo',false).order('updated_at',{ascending:false}).limit(50)
    if(miIni) qy=qy.eq('responsable',miIni)
    const {data}=await qy
    setTerminadosProy(data||[])
  },[terminadosProy,user])
  // Alertas del dueño ("Requiere atención"): replegado por defecto; descartadas persisten (reaparecen si el monto empeora >20%).
  const [alertExp,setAlertExp] = usePersistedState('dash_alert_exp',false)
  // prioOpen/setPrioOpen llegan como props (estado en App) → la página "Prioridades financieras" se abre desde el menú Finanzas del sidebar y ⌘K, no desde un tile.
  const [alertOff,setAlertOff] = usePersistedState('dash_alert_off',{})
  const descartarAlerta = a => setAlertOff(p=>({...(p&&typeof p==='object'?p:{}), [a.key]: a.monto||0}))
  // KPIs colapsables: "Cómo va el año" queda fijo (hero); el resto arranca en mini y se abre al tocar (recuerda por usuario).
  const [kpiOpen,setKpiOpen] = usePersistedState('dash_kpi_open',[])
  const kOpen = id => Array.isArray(kpiOpen) && kpiOpen.includes(id)
  const kToggle = id => setKpiOpen(p=>{ const a=Array.isArray(p)?p:[]; return a.includes(id)?a.filter(x=>x!==id):[...a,id] })
  // Tile compacto de KPI para el grid de 2 columnas del Inicio (icono + etiqueta + cifra + sub). Al tocar abre su detalle (kToggle) o navega (onClick). Reusa kOpen/kToggle.
  const kTile = (id,title,value,valCol,icon,tint,sub,onClick) => { const fg=tint?.fg||C.accent, bg=tint?.bg||C.azulBg, op=!onClick&&kOpen(id); return (
    <div key={id} onClick={onClick||(()=>kToggle(id))} style={{background:C.tileBg,border:`1px solid ${op?C.tileLineOn:C.tileLine}`,borderRadius:12,padding:'10px 12px',cursor:'pointer',position:'relative',minWidth:0,display:'flex',gap:9,alignItems:'flex-start'}}>
      {icon&&<span style={{width:26,height:26,borderRadius:8,background:bg,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0,marginTop:1}}><SIcon n={icon} s={14} c={fg}/></span>}
      <div style={{minWidth:0,flex:1}}>
        {/* Label, cifra y sub en una columna → todos alineados al mismo margen (a la derecha del icono), no bajo el icono. */}
        <div style={{fontSize:10,fontWeight:600,color:C.accent,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',paddingRight:12}}>{title}</div>
        <div style={{fontSize:(value&&String(value).length>8)?15:19,fontWeight:800,color:valCol||fg,lineHeight:1.05,letterSpacing:'-.3px',fontVariantNumeric:'tabular-nums',marginTop:4}}>{value||'—'}</div>
        {sub&&<div style={{fontSize:9,color:C.muted,marginTop:3,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{sub}</div>}
      </div>
      <span style={{position:'absolute',top:11,right:11,color:C.textSoft,fontSize:11,transform:op?'rotate(180deg)':'none',display:'inline-block',transition:'transform .2s'}}>{onClick?<Gl n='chevron'/>:<Gl n='chevD'/>}</span>
    </div>
  ) }
  // Rótulo de nivel de la pirámide del Inicio (Dinero por resolver / Referencia)
  const lvlLabel = t => <div style={{...SEC_LBL,padding:'14px 22px 0'}}>{t}</div>
  const {cal:calTrib} = useCalTrib(expenses)   // avisos del calendario tributario del estudio (misma fuente que Oficina › Calendario tributario)
  const [plazos,setPlazos] = useState([])   // plazos vencidos/próximos para "qué atender hoy"
  useEffect(()=>{ supabase.from('plazos').select('id,client_id,titulo,fecha,tipo,estado').then(({data})=>setPlazos(data||[]),()=>{}) },[])
  // "Ingresado a caja" ANCLADO A LA CARTOLA (regla 2026-08-27: debe cuadrar con el banco). Honorarios cobrados =
  // abonos (no internos) conciliados a factura/anticipo, por fecha del depósito. El fondo por rendir NO cuenta.
  const [ingConc,setIngConc] = useState([])     // conciliacion a factura/anticipo
  const [ingAbonos,setIngAbonos] = useState([]) // cartola: abonos no internos
  useEffect(()=>{
    if(DEMO){ setIngConc((demoData.conciliacion||[]).filter(c=>['factura','anticipo'].includes(c.tipo_destino))); setIngAbonos((demoData.cartola_movimientos||[]).filter(m=>m.tipo==='abono'&&!m.es_interno)); return }
    selectAll(()=>supabase.from('conciliacion').select('movimiento_id,factura_id,anticipo_id,tipo_destino,monto_aplicado').in('tipo_destino',['factura','anticipo']).order('id')).then(({data})=>setIngConc(data||[]),()=>{})
    selectAll(()=>supabase.from('cartola_movimientos').select('id,fecha,monto,monto_conciliado,cliente_id,categoria').eq('tipo','abono').neq('es_interno',true).order('id')).then(({data})=>setIngAbonos(data||[]),()=>{})
  },[])
  // Accesos que aprenden: se ordenan por frecuencia de uso de ESTE usuario (cache instantáneo en localStorage) + registro durable en usage_events. Un punto verde marca el último abierto.
  const accUsoKey = `accesoUso_${user?.name||user?.email||'x'}`
  const [accUso,setAccUso] = useState(()=>{ try{ return JSON.parse(localStorage.getItem(accUsoKey))||{c:{},last:''} }catch(_){ return {c:{},last:''} } })
  const bumpAcceso = id => { setAccUso(p=>{ const n={c:{...p.c,[id]:(p.c[id]||0)+1},last:id}; try{ localStorage.setItem(accUsoKey,JSON.stringify(n)) }catch(_){}; return n }); try{ logEvent('acceso',id,{},user?.name) }catch(_){} }
  const yr = currentYear
  const bb = billing
  // "Vendido del año" = Activo + Terminado (MISMA definición que kpis.vendidoYTD y SalesView.vendUF — fuente única; antes usaba "no Borrador/Propuesta/Rechazada", que divergía si aparecía otro estado como Pausado).
  const salesYr = sales.filter(s=>!s.deleted_at&&['Activo','Terminado'].includes(s.status)&&ventaCuentaEnAnio(s,yr)&&!esSubarriendo(s))
  const ufState = useUF()
  const ufHoy = ufState.uf

  const ufRef = ufHoy || salesYr.find(s=>s.uf_value>0)?.uf_value || UF_FALLBACK
  const ufDias = useUFFechas(billing)   // UF de cada día (mindicador): las cifras del año en UF se convierten con la UF del día de cada movimiento
  // Calculo centralizado: delega a funciones de modulo (single source of truth)
  const esRec = s => esRecurrente(s)
  const ufDeVenta = s => ventaUF(s, ufRef)
  const clpDeVenta = s => ventaCLP(s, ufRef)
  const vendidoBrutoUF = salesYr.reduce((a,s)=>a+ufDeVenta(s),0)
  const costoUF = salesYr.reduce((a,s)=>{ const u=parseFloat(s.uf_value)||ufRef; return a+(u>0?comisionesVenta(s,terceros,billing,ufRef).anual/u:0) },0)   // fuente única comisionesVenta (anual: incluye lo proyectado de las mensuales)
  const vendidoNetoUF = vendidoBrutoUF - costoUF
  // ① P&L / ② break-even — costos de oficina acumulados (respetan el quiebre de mes vía costosOficinaMes).
  const _mNow = new Date().getMonth()+1
  // Clientes permanentes con margen real NEGATIVO (para la alerta "rinde bajo su costo"). Usa el helper único margenDeSale (mismo cálculo que Horas→Rentabilidad).
  const [margenNeg,setMargenNeg] = useState([])
  // Puesta en marcha de Horas: horas propias cargadas ESTA semana (null=aún no sé; 0=no cargó → nudge para encender el módulo).
  const [misHorasSem,setMisHorasSem] = useState(null)
  useEffect(()=>{ let alive=true
    if(DEMO) return   // en demo no hay clientes con margen negativo (todos rinden); en prod usa el cálculo real
    Promise.all([
      supabase.from('horas').select('client_id,user_name,horas,fecha').gte('fecha',`${yr}-01-01`),
      supabase.from('learnings').select('kind,key,value').in('kind',['costo_hora','meta_horas','config']),
    ]).then(([hr,lr])=>{ if(!alive) return
      const hrs=hr.data||[]; const costoHora={}, metas={}; let ufAnio=0
      const _me=user?.name||''
      if(_me){ const _d=new Date(); const _lun=new Date(_d); _lun.setDate(_d.getDate()-((_d.getDay()+6)%7)); const _li=_lun.toLocaleDateString('en-CA'); setMisHorasSem(hrs.filter(h=>h.user_name===_me && String(h.fecha||'')>=_li).reduce((a,h)=>a+(Number(h.horas)||0),0)) }
      ;(lr.data||[]).forEach(r=>{ if(r.kind==='costo_hora')costoHora[r.key]=Number(r.value)||0; else if(r.kind==='meta_horas')metas[r.key]=Number(r.value)||0; else if(r.kind==='config'&&r.key==='uf_anio_'+yr)ufAnio=Number(r.value)||0 })
      const ufAnioEff=ufAnio>0?ufAnio:ufRef
      const oh=overheadHoraDe(costosOfiRows,metas,costoHora)
      const mesesYTD=new Date().getMonth()+1
      const negs=(sales||[]).filter(s=>!s.deleted_at&&esRec(s)).map(s=>margenDeSale(s,hrs,costoHora,oh,mesesYTD,ufRef,ufAnioEff,String(yr),terceros,billing)).filter(d=>!d.sinIng&&!d.faltaCosto&&d.margen<0).sort((a,b)=>a.margen-b.margen)
      setMargenNeg(negs)
    },()=>{})
    return ()=>{alive=false}
  },[sales,costosOfiRows,ufRef,yr])
  const vendidoBrutoCLP = Math.round(salesYr.reduce((a,s)=>a+clpDeVenta(s),0))
  const costoCLP = Math.round(salesYr.reduce((a,s)=>a+comisionesVenta(s,terceros,billing,ufRef).anual,0))
  const vendidoNetoCLP = vendidoBrutoCLP - costoCLP
  const pctMeta = Math.min(100, Math.round((vendidoNetoUF/META_UF)*100))

  const porCobrar = bb.filter(b=>!b.deleted_at&&b.billing_type!=='reembolso'&&b.invoice_no&&['Pendiente','Vencido'].includes(b.status))
  const totalPorCobrar = porCobrarBills(bb)   // fuente única del "por cobrar" (mismo helper que ficha/lista)
  const top5 = [...porCobrar].sort((a,b)=>(daysLeft(a.due)||0)-(daysLeft(b.due)||0)).slice(0,5)

  const byArea = {}
  salesYr.forEach(s=>{ byArea[s.area]=(byArea[s.area]||0)+ufDeVenta(s) })
  const topAreas = Object.entries(byArea).sort((a,b)=>b[1]-a[1]).slice(0,3)

  const balances = {}
  expenses.forEach(e=>{ balances[e.client_id]=(balances[e.client_id]||0)+saldoDelta(e) })
  const negatives = clients.filter(c=>!c.is_internal&&balances[c.id]<0)
  const [cpExp,setCpExp] = useState(null)       // cuenta por pagar a proveedor con su origen desplegado
  const [openPagar,setOpenPagar] = useState(true)
  const [cpProvOpen,setCpProvOpen] = useState({})   // drill: facturas del proveedor desplegadas
  const [cpF,setCpF] = useState('todos')            // filtro de la sección Comisiones (mismas 4 tarjetas que el home de Comisiones)
  const [comisOpen,setComisOpen] = usePersistedState('inicio_comis_open',false)   // sección Comisiones de Inicio: replegada por defecto (pedido 2026-10-15)
  const [cpVerTodos,setCpVerTodos] = useState(false)
  const [cpPagOpen,setCpPagOpen] = useState(false)  // sección "Pagadas este año" (colaboradores ya pagados) desplegada
  const [tareaPersOpen,setTareaPersOpen] = useState({})
  const [tareaHoyOpen,setTareaHoyOpen] = usePersistedState('d_atenHoy',{})   // tiles "Hoy" desplegados (acordeón)
  const [tareasCorte,setTareasCorte] = useState('todas')   // tablero equipo: 'todas' | 'delegaron' | 'delegue'
  const [dashMoneda,setDashMoneda] = useState('UF')   // switch global UF/CLP de los KPIs del dashboard (default UF: este KPI usa UF de venta, no del día)
  const [iaHoy,setIaHoy] = useState(null)       // resumen IA de "qué atender hoy"
  const [iaHoyBusy,setIaHoyBusy] = useState(false)

  // --- META anual: metas por año (annual_targets) + selector + histórico ---
  const [targets,setTargets] = useState([])
  const [selYear,setSelYear] = useState(currentYear)
  const [yearMenu,setYearMenu] = useState(false)
  useEffect(()=>{
    if(DEMO){ setTargets(demoData.annual_targets||[]); return }
    supabase.from('annual_targets').select('*').order('year',{ascending:false}).then(({data})=>{
      const rows = (data&&data.length)?[...data]:[]
      if(!rows.some(t=>t.year===currentYear)) rows.unshift({year:currentYear,target_amount:META_CLP,currency:'CLP'})
      setTargets(rows)
    })
  },[])
  // Métricas de un año desde sales (vendido), misma fórmula que el cálculo central
  const metricasAnio = (year) => {
    const sy = sales.filter(s=>!s.deleted_at&&ventaCuentaEnAnio(s,year)&&['Activo','Terminado'].includes(s.status)&&!esSubarriendo(s))   // Vendido = Activo + Terminado (fuente única con SalesView; excluye Pausado, que antes divergía)
    const bruto = Math.round(sy.reduce((a,s)=>a+clpDeVenta(s),0))
    // Comisiones = fuente única comisionesVenta (las registradas; si una venta no tiene, su costo pactado). En UF, con la UF de la venta.
    const costo = Math.round(sy.reduce((a,s)=>a+comisionesVenta(s,terceros,billing,ufRef).anual,0))
    const neto = bruto - costo
    // UF NOMINALES (suma directa de amount_uf, igual que la pestaña Ventas) — para que ambas vistas cuadren en modo UF. No reconvertir el CLP con la UF de hoy.
    const brutoUF = sy.reduce((a,s)=>a+ufDeVenta(s),0)
    const costoUF = sy.reduce((a,s)=>{ const u=parseFloat(s.uf_value)||ufRef; return a+(u>0?comisionesVenta(s,terceros,billing,ufRef).anual/u:0) },0)
    const netoUF = brutoUF - costoUF
    const meta = Number(targets.find(t=>t.year===year)?.target_amount) || (year===currentYear?META_CLP:0)
    const pct = meta>0 ? Math.round((neto/meta)*100) : 0   // % meta sobre NETO (igual que el historial y pctMeta) — no mezclar bruto/neto
    return {year,bruto,costo,neto,brutoUF,costoUF,netoUF,meta,pct}
  }
  const m = metricasAnio(selYear)
  // Facturado/Cobrado del AÑO seleccionado (facturas emitidas en el año; cobrado = de esas, cuánto pagado).
  const _sySel = String(selYear)
  // "Por cobrar" = saldo vivo real (fuente única porCobrarBills: folio, Pendiente/Vencido, saldoBill sobre el DTE, descuenta abonos).
  // NO facturado−cobrado con amount programado: eso ignoraba abonos parciales e inflaba la cifra (era un 3er número distinto al de Cobranza).
  const fmtMon = v => dashMoneda==='UF' ? (ufRef>0?fmtUFk(Math.round(v/ufRef)):'—') : fmtShort(v)
  // Para cifras de VENTAS (tienen UF nominal): en modo UF usa el UF nominal directo (cuadra con la pestaña Ventas); en CLP usa el monto en pesos. NO reconvertir CLP↔UF con la UF de hoy.
  const vMon = (uf,clp) => dashMoneda==='UF' ? fmtUFk(Math.round(uf||0)) : fmtShort(clp)
  // Meta en UF con la MISMA UF promedio de lo vendido (pesos de las ventas ÷ sus UF): así «% de la meta» = pesos ÷ pesos y no se infla
  // por dividir la meta (pesos) con la UF de hoy mientras lo vendido está en las UF de cada venta. Sin ventas, la UF de hoy.
  const metaUF = m.meta>0 ? ((m.bruto>0&&m.brutoUF>0) ? m.meta*m.brutoUF/m.bruto : (ufRef>0?m.meta/ufRef:0)) : 0
  // "Ingresado a caja" = HONORARIOS COBRADOS anclados a la CARTOLA (regla 2026-08-27: debe cuadrar con el banco).
  // = abonos (no internos) conciliados a factura/anticipo, por AÑO DE INGRESO = fecha del depósito. El fondo por rendir NO cuenta.
  // Desglose por AÑO DE VENTA (factura→sale.year / anticipo→sale.year). Lo no conciliado = "por identificar" (alerta, aparte).
  const ingresosPorAnioVenta = useMemo(()=>{
    const saleYrById={}; sales.forEach(s=>{ if(s.year!=null) saleYrById[String(s.id)]=s.year })
    const billById={}; (billing||[]).forEach(b=>{ billById[String(b.id)]=b })
    const antById={}; (anticipos||[]).forEach(a=>{ antById[String(a.id)]=a })
    const abonoById={}; ingAbonos.forEach(m=>{ abonoById[String(m.id)]=m })
    // Facturas emitidas POR CUENTA de un externo (terceros_pagos.comision_pct): lo cobrado NO es propio; solo nuestra comisión entra (proporcional a lo cobrado).
    const extByBill={}; (terceros||[]).forEach(t=>{ if(t&&t.comision_pct!=null&&t.billing_id){ const e=(extByBill[String(t.billing_id)]=extByBill[String(t.billing_id)]||{com:0,mto:0}); e.com+=Number(t.comision_monto)||0; e.mto+=Number(t.monto)||0 } })
    // Gasto dentro de una factura de honorarios (fondo ligado: expenses.invoice_id) = reembolso, no honorario: igual que Por socio.
    const fondoEnFac={}; (expenses||[]).forEach(e=>{ if(e&&!e.deleted_at&&e.type==='fondo'&&e.invoice_id) fondoEnFac[String(e.invoice_id)]=(fondoEnFac[String(e.invoice_id)]||0)+(Number(e.amount)||0) })
    const yrDe = iso => { const y=String(iso||'').slice(0,4); return /^\d{4}$/.test(y)?+y:null }
    const anioVentaDe = c => {
      let sid=null, sy=null, docFecha=null
      if(c.tipo_destino==='factura'){ const b=billById[String(c.factura_id)]; sid=b?.sale_id; sy=b?.sale_year; docFecha=b?.issued_at||b?.due }
      else { const a=antById[String(c.anticipo_id)]; sid=a?.sale_id; sy=a?.sale_year; docFecha=a?.fecha }
      if(sid&&saleYrById[String(sid)]!=null) return saleYrById[String(sid)]
      if(sy!=null) return sy
      // Fallback: sin venta enlazada, el año lo da el propio documento (emisión de la factura / fecha del anticipo o pago sin factura).
      // Antes esto caía a "sin año" aunque el documento SÍ tuviera fecha (facturas emitidas y anticipos/pagos conciliados).
      return yrDe(docFecha)
    }
    let total=0, totalUF=0, sinMontoUF=0, percibidasUF=0, cajaSubarrUF=0, cajaReembUF=0, cajaExtUF=0, sinMonto=0, sinN=0, percibidas=0, cajaSubarr=0, cajaReemb=0, cajaExt=0; const byYear={}, byYearUF={}; const listByYear={}; const sinList=[]; const percList=[]
    ingConc.forEach(c=>{
      const m=abonoById[String(c.movimiento_id)]; if(!m) return
      if(!String(m.fecha||'').startsWith(_sySel)) return          // AÑO DE INGRESO A CAJA = fecha del depósito
      let monto=Number(c.monto_aplicado)||0; if(monto<=0) return
      // Lo que NO es cobrado propio se acumula aparte solo para cuadrar el «Total a caja» con el banco.
      if(m.categoria==='Subarriendo'){ cajaSubarr+=monto; cajaSubarrUF+=monto/ufDelDia(ufDias,m.fecha,ufRef); return } // subarriendo = ingreso por arriendo, NO honorarios cobrados (vive en Colaboradores)
      if(c.tipo_destino==='factura'){
        const b=billById[String(c.factura_id)]
        if(b&&b.billing_type==='reembolso'){ cajaReemb+=monto; cajaReembUF+=monto/ufDelDia(ufDias,m.fecha,ufRef); return } // reembolso de gastos: devuelve plata, no son honorarios
        const ex=extByBill[String(c.factura_id)]
        if(ex){ cajaExt+=monto; cajaExtUF+=monto/ufDelDia(ufDias,m.fecha,ufRef); const base=ex.com+ex.mto; const p=base>0?monto*ex.com/base:0; percibidas+=p; percibidasUF+=p/ufDelDia(ufDias,m.fecha,ufRef); percList.push({ id:'cp-'+c.movimiento_id+'-'+String(c.factura_id), client_id:b?.client_id||m.cliente_id, folio:b?.invoice_no, paid_at:m.fecha, _cobrado:p }); return }
        const fo=b&&fondoEnFac[String(b.id)]
        if(fo){ const mf=montoFactura(b)||monto, r=monto*Math.min(1,fo/mf); cajaReemb+=r; cajaReembUF+=r/ufDelDia(ufDias,m.fecha,ufRef); monto-=r; if(monto<1) return }
      }
      const ay=anioVentaDe(c)
      let item
      if(c.tipo_destino==='factura'){ const b=billById[String(c.factura_id)]||{}; item={ id:'cf-'+c.movimiento_id+'-'+String(c.factura_id), client_id:b.client_id||m.cliente_id, invoice_no:b.invoice_no, folio:b.invoice_no, sale_id:b.sale_id||null, paid_at:m.fecha, _cobrado:monto, concept:b.concept } }
      else { const a=antById[String(c.anticipo_id)]||{}; item={ id:'ca-'+c.movimiento_id+'-'+String(c.anticipo_id), client_id:a.client_id||m.cliente_id, invoice_no:null, folio:null, sale_id:a.sale_id||null, paid_at:m.fecha, _cobrado:monto, _esAnticipo:true, concept:a.nota||'Anticipo' } }
      total+=monto; totalUF+=monto/ufDelDia(ufDias,m.fecha,ufRef)   // Cobrado en UF: cada pago con la UF del día del depósito
      if(ay==null){ sinMonto+=monto; sinMontoUF+=monto/ufDelDia(ufDias,m.fecha,ufRef); sinN++; sinList.push(item); return }
      byYear[ay]=(byYear[ay]||0)+monto; byYearUF[ay]=(byYearUF[ay]||0)+monto/ufDelDia(ufDias,m.fecha,ufRef); (listByYear[ay]=listByYear[ay]||[]).push(item)
    })
    // Por identificar = abonos del año que aún no se conciliaron (cola de conciliación) → ALERTA de acción, no plata perdida.
    const porIdentificar = ingAbonos.filter(m=>String(m.fecha||'').startsWith(_sySel)&&m.categoria!=='Subarriendo').reduce((a,m)=>a+Math.max(0,(Number(m.monto)||0)-(Number(m.monto_conciliado)||0)),0)
    const delAnio = byYear[selYear]||0
    const anteriores = Math.max(0, total - delAnio - sinMonto)
    const prioYears = Object.keys(byYear).map(Number).filter(y=>y<selYear).sort((a,b)=>b-a)
    const allYears = Object.keys(byYear).map(Number).sort((a,b)=>b-a)
    return {total,totalUF,sinMontoUF,percibidasUF,byYear,byYearUF,delAnio,anteriores,sinMonto,sinN,prioYears,allYears,listByYear,sinList,porIdentificar,percibidas,percList,cajaSubarr,cajaReemb,cajaExt,totalCaja:total+cajaSubarr+cajaReemb+cajaExt,totalCajaUF:totalUF+cajaSubarrUF+cajaReembUF+cajaExtUF,cajaSubarrUF,cajaReembUF,cajaExtUF}
  },[ingConc,ingAbonos,billing,anticipos,sales,terceros,expenses,selYear,ufDias,ufRef])
  // Comisiones PAGADAS del año (base caja, por pagado_at) atribuidas al AÑO DE LA VENTA — espejo de ingresosPorAnioVenta.
  // Año de venta = terceros.sale_id → sales.year; si no, vía la factura (billing.sale_id → sales.year); si no, el año del documento. Así "sin año" no aparece cuando la factura tiene venta.
  const comisPagadasAnioVenta = useMemo(()=>{
    const saleYrById={}; sales.forEach(s=>{ if(s.year!=null) saleYrById[String(s.id)]=s.year })
    const billById={}; (billing||[]).forEach(b=>{ billById[String(b.id)]=b })
    const yrDe = iso => { const y=String(iso||'').slice(0,4); return /^\d{4}$/.test(y)?+y:null }
    const anioVentaDe = t => {
      if(t.sale_id!=null && saleYrById[String(t.sale_id)]!=null) return saleYrById[String(t.sale_id)]
      const b=billById[String(t.billing_id)]
      if(b){ if(b.sale_id!=null && saleYrById[String(b.sale_id)]!=null) return saleYrById[String(b.sale_id)]; return yrDe(b.issued_at||b.due) }
      return null
    }
    let total=0, totalUF=0, totalTodo=0, sinAnio=0; const byYear={}
    ;(terceros||[]).forEach(t=>{
      if(t.estado!=='pagado') return
      if(!String(t.pagado_at||'').startsWith(String(selYear))) return   // AÑO DE SALIDA = fecha del pago
      const monto=Number(t.monto)||0; if(monto<=0) return
      totalTodo+=monto
      if(t.comision_pct!=null) return   // traspaso a un externo (factura por su cuenta): no es costo nuestro; lo nuestro entra como comisión percibida
      total+=monto; totalUF+=monto/ufDelDia(ufDias,t.pagado_at,ufRef)
      const ay=anioVentaDe(t)
      if(ay==null){ sinAnio+=monto; return }
      byYear[ay]=(byYear[ay]||0)+monto
    })
    return {total,totalUF,totalTodo,byYear,sinAnio}
  },[terceros,billing,sales,selYear,ufDias,ufRef])
  // Meta de cobranza del año (annual_targets.collection_target). % y faltante para la foto de ingresos.
  const metaCobranza = Number(targets.find(t=>t.year===selYear)?.collection_target) || 0
  // Facturado del año = HONORARIOS EMITIDOS en el año (por fecha de emisión issued_at), monto del DTE (fuente única montoFactura).
  // OJO criterio (afinado con el usuario): captura TODAS las facturas emitidas en el año, incluidas las de ventas de años anteriores;
  // EXCLUYE la facturación de gastos/reembolsos (billing_type='reembolso') — solo honorarios. El desglose por año de venta va en el drill.
  const _esFactHon = b => b && !b.deleted_at && b.invoice_no && b.status!=='Anulada' && esFacIngreso(b)   // honorarios + comisión + por externo (el externo va a «por cuenta de terceros» vía extBillIds)
  const extBillIds = useMemo(()=>new Set((terceros||[]).filter(t=>t&&t.comision_pct!=null&&t.billing_id).map(t=>String(t.billing_id))),[terceros])
  // Facturado POR CUENTA de terceros (externo con retención): se muestra aparte, no suma a lo propio.
  const facturadoTerceros = useMemo(()=>{ const list=(billing||[]).filter(b=> _esFactHon(b) && extBillIds.has(String(b.id)) && String(b.issued_at||'').slice(0,4)===String(selYear)).sort((a,b)=>String(b.issued_at||'').localeCompare(String(a.issued_at||''))); return {total:list.reduce((a,b)=>a+montoFactura(b),0), totalUF:list.reduce((a,b)=>a+montoFactura(b)/ufDelDia(ufDias,b.issued_at,ufRef),0), list} },[billing,extBillIds,selYear,ufDias,ufRef])
  // Total EMITIDO en el año (todo tipo: honorarios propios, por cuenta de terceros, reembolsos, subarriendo) → línea al pie del panel Facturado.
  const facturadoEmitido = useMemo(()=>{ const r={total:0,reemb:0,subarr:0,totalUF:0,reembUF:0,subarrUF:0}; (billing||[]).forEach(b=>{ if(!b||b.deleted_at||!b.invoice_no||b.status==='Anulada'||String(b.issued_at||'').slice(0,4)!==String(selYear)) return; const v=montoFactura(b), vu=v/ufDelDia(ufDias,b.issued_at,ufRef); r.total+=v; r.totalUF+=vu; if(b.billing_type==='reembolso'){ r.reemb+=v; r.reembUF+=vu } else if(b.billing_type==='subarriendo'){ r.subarr+=v; r.subarrUF+=vu } }); return r },[billing,selYear,ufDias,ufRef])
  const facturadoYr = useMemo(()=> (billing||[]).filter(b=> _esFactHon(b) && !extBillIds.has(String(b.id)) && String(b.issued_at||'').slice(0,4)===String(selYear)).reduce((a,b)=>a+montoFactura(b),0), [billing,extBillIds,selYear])
  // Facturado (emitido en el año) DESGLOSADO por año de la venta → drill del embudo (2026 / 2025 / sin venta=0). Lista por factura.
  const facturadoByYear = useMemo(()=>{
    const syById={}; sales.forEach(s=>{ if(s.year!=null) syById[String(s.id)]=s.year })
    const byYear={}, byYearUF={}; const listByYear={}
    ;(billing||[]).forEach(b=>{
      if(!_esFactHon(b) || extBillIds.has(String(b.id)) || String(b.issued_at||'').slice(0,4)!==String(selYear)) return
      // AÑO DE LA VENTA: venta enlazada (sale_id→sales.year) → sale_year (año resuelto a mano, aunque no haya venta enlazada) → año del vencimiento. Espeja anioVentaDe de Cobrado. Antes solo miraba sale_id y caía a "sin venta" ignorando sale_year.
      const y = (b.sale_id!=null && syById[String(b.sale_id)]!=null) ? syById[String(b.sale_id)] : (b.sale_year!=null ? b.sale_year : (b.due?Number(String(b.due).slice(0,4)):0))
      byYear[y]=(byYear[y]||0)+montoFactura(b); byYearUF[y]=(byYearUF[y]||0)+montoFactura(b)/ufDelDia(ufDias,b.issued_at,ufRef); (listByYear[y]=listByYear[y]||[]).push(b)
    })
    return {byYear,byYearUF,listByYear}
  },[billing,sales,extBillIds,selYear,ufDias,ufRef])
  const [resDrill,setResDrill] = usePersistedState('d_resdrill',null)   // {tile:'vend'|'fact'|'cob'|'marg', year:number|null} — embudo: nivel1 resumen, nivel2 años, nivel3 clientes
  const [resOrd,setResOrd] = usePersistedState('d_resord','fecha')      // orden del detalle por año: 'fecha' (más reciente) o 'monto' (mayor)
  const [resSeeAll,setResSeeAll] = useState({})                          // {`${tile}-${y}`:true} → ver TODOS los cobros de ese año (si no, tope 6)
  const [resComis,setResComis] = useState(false)                        // expandir la lista de comisiones pagadas dentro del panel
  const [resPerc,setResPerc] = useState(false)                          // expandir la lista de comisiones percibidas (Cobrado)
  const [resRex,setResRex] = useState(false)                            // expandir «Comisión de externos» (Margen): cobrada / por cobrar
  const [resRexL,setResRexL] = useState('pend')                         // lista abierta dentro de Comisión de externos: 'cob' | 'pend' | null
  const [resFTer,setResFTer] = useState(false)                          // expandir el desglose del total emitido (Facturado)
  const [resCaja,setResCaja] = useState(false)                          // expandir el desglose del total a caja (Cobrado)
  const isDeskRes = useIsDesktop()                                      // paneles del resultado: columnas de la grilla y % largo («45% de lo vendido») solo en escritorio
  const [ingDrill,setIngDrill] = usePersistedState('d_ingdrill',null)   // año de venta cuyo detalle (facturas) está abierto ('sin' = sin año)
  // Descargar la foto "Resultado del año" como PNG branded (canvas propio → salida limpia; en iPhone usa la hoja de compartir).
  // Recuadros por sección (Ventas/Facturado/Cobrado/Margen/Cobranza), logo real, fecha de corte destacada, cifras en UF y en pesos.
  // Las secciones de «Resultado del año» (Ventas, Facturado, Cobrado propio, Margen y Cobranza) con las cifras que muestra Inicio. Las usan la foto descargable
  // y Counsel AI (publica el resultado para responder la misma cifra, sin otra fórmula).
  const armarSecciones = () => {
      const ingYTD=ingresosPorAnioVenta.total||0, comisYTD=comisPagadasAnioVenta.total||0
      const percYTD=ingresosPorAnioVenta.percibidas||0, ingReal=ingYTD-comisYTD+percYTD
      const vPct=metaUF>0?Math.round(m.brutoUF/metaUF*100):0            // sin tope (sobrecumplimiento), igual que en pantalla
      const cobPct=metaCobranza>0?Math.round(ingYTD/metaCobranza*100):0 // sin tope (sobrecumplimiento)
      const uf=n=>fmtUFk(n), pe=n=>(n<0?'−$':'$')+Math.abs(Math.round(n||0)).toLocaleString('es-CL'), pS=n=>fmtShort(n)
      const iv=ingresosPorAnioVenta, ufR=ufRef||1
      const yrsCob=(iv.allYears||[]).slice(0,3)
      const fby=facturadoByYear.byYear||{}, fbyU=facturadoByYear.byYearUF||{}; const yrsFac=Object.keys(fby).map(Number).sort((a,b)=>b-a).slice(0,3)
      const yrLbl=(y)=> y? `De ventas ${y}${y!==selYear?' (ant.)':''}` : 'Sin venta asociada'
      // ── secciones (cada recuadro): title, %chip, hero UF+CLP, líneas [label, UF, CLP] (el peso va DEBAJO de la UF), barra opcional
      const secs=[
        { t:'Ventas', pct:vPct, uf:uf(m.brutoUF), clp:pe(m.bruto), lines:[
            ['Neto de costos de terceros', fmtUFk(m.netoUF), pe(m.neto)],
            ['Costos de terceros', '− '+fmtUFk(m.costoUF), pe(m.costo)],
            ['Meta del año', fmtUFk(metaUF), pe(m.meta)] ], bar:vPct },
        // UF con la UF del DÍA de cada movimiento (mismas cifras que la pantalla); los pesos, tal cual.
        { t:`Facturado · emitido en ${selYear}`, pct:m.bruto>0?Math.min(100,Math.round(resAnio.fac/m.bruto*100)):0, uf:uf(resAnio.verUF.fac), clp:pe(resAnio.fac),
          lines: [...yrsFac.map(y=>[yrLbl(y), fmtUFk(fbyU[y]||0), pe(fby[y]||0)]), ...(facturadoEmitido.total>0?[['Total emitido (con terceros y reembolsos)', fmtUFk(facturadoEmitido.totalUF), pe(facturadoEmitido.total)]]:[])] },
        { t:'Cobrado propio', uf:uf(iv.totalUF), clp:pe(ingYTD), lines:[
            ['Comisiones pagadas', '− '+fmtUFk(comisPagadasAnioVenta.totalUF), pe(comisYTD)],
            ['Comisiones percibidas', '+ '+fmtUFk(iv.percibidasUF), pe(percYTD)],
            ['Ingreso real', fmtUFk(iv.totalUF-comisPagadasAnioVenta.totalUF+iv.percibidasUF), pe(ingReal)],
            ['Total a caja', fmtUFk(iv.totalCajaUF||0), pe(iv.totalCaja||0)],
            ...yrsCob.map(y=>[yrLbl(y), fmtUFk((iv.byYearUF||{})[y]||0), pe(iv.byYear[y]||0)]) ] },
        { t:resAnio.res>=0?'Margen del ejercicio':'Pérdida del ejercicio', pct:resAnio.pct!=null?Math.round(resAnio.pct):null, uf:uf(resAnio.verUF.res), clp:pe(resAnio.res), lines:[
            ['Facturado', fmtUFk(resAnio.verUF.fac), pe(resAnio.fac)],
            ...(resAnio.sub?[['+ Subarriendo', fmtUFk(resAnio.verUF.sub), pe(resAnio.sub)]]:[]),
            ...(resAnio.rex?[['+ Comisión de externos', fmtUFk(resAnio.verUF.rex), pe(resAnio.rex)]]:[]),
            ['= Ingresos', fmtUFk(resAnio.verUF.ing), pe(resAnio.ing)],
            ['− Costos de operación', fmtUFk(resAnio.verUF.cos), pe(resAnio.cos)],
            ['− Comisiones pagadas', fmtUFk(resAnio.verUF.com), pe(resAnio.com)] ] },
        // Meta de cobranza (pesos) en UF con la UF promedio de lo cobrado → Cobrado − Meta = Sobre (o Meta − Cobrado = Falta) cuadra en UF.
        { t:'Cobranza', pct:cobPct, uf:uf(iv.totalUF), clp:pe(ingYTD), lines:(()=>{ const mU=ingYTD>0&&iv.totalUF>0?metaCobranza*iv.totalUF/ingYTD:metaCobranza/ufR, sobre=ingYTD>=metaCobranza
            const [a,b]=sobre?redondearPartes([mU,iv.totalUF-mU],1,[]):redondearPartes([iv.totalUF,mU-iv.totalUF],1,[0])
            return [['Meta de cobranza', fmtUFk(sobre?a:a+b), pe(metaCobranza)], [sobre?'Sobre la meta':'Falta para la meta', fmtUFk(b), pe(Math.abs(ingYTD-metaCobranza))]] })(), bar:cobPct },
      ]
      return { secs, ingYTD, comisYTD, percYTD, ingReal, iv, ufR, yrsCob, fby, fbyU, yrsFac, yrLbl, pe }
  }
  const descargarResultado = async () => {
    try{
      const { secs, ingYTD, comisYTD, percYTD, ingReal, iv, ufR, yrsCob, fby, fbyU, yrsFac, yrLbl, pe } = armarSecciones()
      const S=2, W=470, P=16, HDR=62, BAND=30, GAP=10, FOOT=30, LH=27
      const cardH = s => 14 + 42 + (s.lines.length*LH) + 10 + (s.bar!=null?16:0)
      const H = HDR + BAND + secs.reduce((a,s)=>a+cardH(s)+GAP,0) + FOOT
      const cv=document.createElement('canvas'); cv.width=W*S; cv.height=H*S
      const g=cv.getContext('2d'); g.scale(S,S); g.textBaseline='alphabetic'
      const F=(w,s)=>`${w} ${s}px 'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif`
      const rr=(x,y,w,h,r)=>{ g.beginPath(); if(g.roundRect) g.roundRect(x,y,w,h,r); else { g.moveTo(x+r,y); g.lineTo(x+w-r,y); g.arcTo(x+w,y,x+w,y+r,r); g.lineTo(x+w,y+h-r); g.arcTo(x+w,y+h,x+w-r,y+h,r); g.lineTo(x+r,y+h); g.arcTo(x,y+h,x,y+h-r,r); g.lineTo(x,y+r); g.arcTo(x,y,x+r,y,r); } g.closePath() }
      g.fillStyle='#fff'; g.fillRect(0,0,W,H)
      // header navy + logo real
      g.fillStyle='#003C50'; g.fillRect(0,0,W,HDR)
      try{ const logo=new Image(); logo.src=location.origin+BRAND.logo.blanco; await Promise.race([ new Promise((res,rej)=>{ logo.onload=res; logo.onerror=rej; if(logo.complete&&logo.naturalWidth) res() }), new Promise((_,rej)=>setTimeout(rej,1500)) ]); const lh=20, lw=logo.naturalWidth&&logo.naturalHeight?logo.naturalWidth/logo.naturalHeight*lh:130; g.drawImage(logo,P,(HDR-lh)/2,lw,lh) }catch(_){ g.fillStyle='#fff'; g.font=F(800,15); g.fillText(BRAND.nombre||'',P,HDR/2+5) }
      g.textAlign='right'; g.fillStyle='#fff'; g.font=F(800,13); g.fillText('RESULTADO DEL AÑO',W-P,HDR/2-2); g.fillStyle='#9FC4DD'; g.font=F(600,10); g.fillText(`Ejercicio ${selYear}`,W-P,HDR/2+13); g.textAlign='left'
      // banda fecha de corte
      const hoy=new Date(), dias=hoy.toLocaleDateString('es-CL',{day:'numeric',month:'long',year:'numeric'}), hhmm=`${String(hoy.getHours()).padStart(2,'0')}:${String(hoy.getMinutes()).padStart(2,'0')}`
      g.fillStyle='#E6F1FB'; g.fillRect(0,HDR,W,BAND)
      g.fillStyle=C.azulInfo; g.font=F(800,11); g.fillText(`CORTE AL ${dias.toUpperCase()}`,P,HDR+BAND/2+4)
      g.textAlign='right'; g.fillText(`${hhmm} HRS`,W-P,HDR+BAND/2+4); g.textAlign='left'
      // cards
      let y=HDR+BAND+GAP
      secs.forEach(s=>{
        const h=cardH(s), x=P, w=W-2*P
        g.strokeStyle='#E4E8EB'; g.lineWidth=1; rr(x,y,w,h,12); g.fillStyle='#fff'; g.fill(); g.stroke()
        let cy=y+22
        g.fillStyle='#537281'; g.font=F(800,9.5); g.fillText(s.t.toUpperCase(),x+13,cy)
        if(s.pct!=null){ g.textAlign='right'; g.fillStyle=C.azulInfo; g.font=F(800,10); g.fillText(`${s.pct}%`,x+w-13,cy); g.textAlign='left' }
        cy+=20
        g.fillStyle='#003C50'; g.font=F(800,19); g.fillText(s.uf,x+13,cy)
        g.fillStyle='#537281'; g.font=F(700,11); g.fillText(s.clp,x+13,cy+15)
        cy+=15+12
        s.lines.forEach(([l,ufv,clpv])=>{ const neg=String(ufv).startsWith('−'); g.fillStyle=neg?'#C0453F':'#537281'; g.font=F(500,10.5); g.fillText(l,x+13,cy); g.textAlign='right'; g.fillStyle=neg?'#C0453F':'#003C50'; g.font=F(800,11); g.fillText(ufv,x+w-13,cy); g.fillStyle='#99ABB4'; g.font=F(600,9.5); g.fillText(clpv,x+w-13,cy+12); g.textAlign='left'; cy+=LH })
        if(s.bar!=null){ const bw=w-26; g.fillStyle='#EDEFF1'; rr(x+13,cy-2,bw,7,3.5); g.fill(); g.fillStyle='#003C50'; rr(x+13,cy-2,bw*Math.min(100,s.bar)/100,7,3.5); g.fill() }
        y+=h+GAP
      })
      g.fillStyle='#99ABB4'; g.font=F(800,9); g.fillText('DOCUMENTO INTERNO · '+(BRAND.dominio||''),P,H-12); g.textAlign='right'; g.fillText((BRAND.nombre||'').toUpperCase(),W-P,H-12); g.textAlign='left'
      const blob=await new Promise(res=>cv.toBlob(res,'image/png'))
      if(!blob) throw new Error('canvas vacío')
      const file=new File([blob],`RESULTADO-DEL-ANO-${selYear}.png`,{type:'image/png'})
      if(navigator.canShare&&navigator.canShare({files:[file]})){ try{ await navigator.share({files:[file],title:`Resultado del año ${selYear}`}); return }catch(_){ } }
      const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=file.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),4000)
    }catch(e){ appAlert('No se pudo generar la imagen: '+(e.message||e)) }
  }
  // Imprimir informe del año (HTML limpio → Imprimir/PDF). Recuadros por sección, logo, fecha de corte destacada, cifras en UF y pesos.
  const imprimirResultado = () => {
    const iv=ingresosPorAnioVenta, ufR=ufRef||1
    const ingYTD=iv.total||0, comisYTD=comisPagadasAnioVenta.total||0
    const percYTD=iv.percibidas||0, ingReal=ingYTD-comisYTD+percYTD
    const A='#003C50', MUT='#537281', AZ3='#99ABB4', GRAY='#E4E8EB', GREEN=C.greenText, RED='#C0453F'
    const pe=n=>(n<0?'−$':'$')+Math.abs(Math.round(n||0)).toLocaleString('es-CL')
    const pct=(a,b)=>b>0?Math.round(a/b*100):0
    // fila de detalle: la UF manda y el peso va DEBAJO (no al lado), más chico
    const row=(l,ufv,clpv,neg)=>`<tr><td style='padding:7px 0;color:${neg?RED:MUT};font-size:12px;vertical-align:top'>${l}</td><td style='padding:7px 0;text-align:right;font-variant-numeric:tabular-nums'><div style='font-weight:800;color:${neg?RED:A};font-size:12.5px;line-height:1.15'>${neg?'− ':''}${fmtUFk(ufv)}</div><div style='color:${AZ3};font-size:10.5px;font-weight:600'>${pe(clpv)}</div></td></tr>`
    const card=(titulo,ufv,clpv,chip,rowsHtml)=>`<div style='border:1px solid ${GRAY};border-radius:12px;padding:14px 16px;margin-bottom:12px'><div style='display:flex;justify-content:space-between;align-items:baseline'><div style='font-size:10px;font-weight:800;color:${MUT};text-transform:uppercase;letter-spacing:.5px'>${titulo}</div>${chip!=null?`<div style='font-size:11px;font-weight:800;color:${A}'>${chip}</div>`:''}</div><div style='margin-top:6px;font-size:22px;font-weight:800;color:${A};letter-spacing:-.5px;line-height:1'>${fmtUFk(ufv)}</div><div style='font-size:12.5px;color:${MUT};font-weight:700;margin-top:2px'>${pe(clpv)}</div>${rowsHtml?`<table style='width:100%;border-collapse:collapse;margin-top:10px;border-top:1px solid #EFF1F3'>${rowsHtml}</table>`:''}</div>`
    const yrLbl=(y)=> y? `De ventas ${y}${y!==selYear?' (anterior)':''}` : 'Sin venta asociada'
    // UF con la UF del DÍA de cada movimiento (mismas cifras que la pantalla); los pesos, tal cual.
    const yrsCob=(iv.allYears||[]).map(y=>row(yrLbl(y), (iv.byYearUF||{})[y]||0, iv.byYear[y]||0)).join('')
    const fby=facturadoByYear.byYear||{}, fbyU=facturadoByYear.byYearUF||{}; const yrsFac=Object.keys(fby).map(Number).sort((a,b)=>b-a).map(y=>row(yrLbl(y), fbyU[y]||0, fby[y]||0)).join('')
    const V=resAnio.verUF, comU=comisPagadasAnioVenta.totalUF||0, percU=iv.percibidasUF||0
    const ventasCard=card('Ventas', m.brutoUF, m.bruto, `${pct(m.bruto,m.meta)}% de la meta`, row('Neto de costos de terceros',m.netoUF,m.neto)+row('Costos de terceros',m.costoUF,m.costo,true)+row('Meta del año',metaUF,m.meta))
    const factCard=card('Facturado', V.fac, resAnio.fac, `${pct(resAnio.fac,m.bruto)}% de lo vendido`, `<tr><td colspan='2' style='padding:8px 0 3px;font-size:9px;font-weight:800;color:${AZ3};text-transform:uppercase;letter-spacing:.4px'>Emitido en ${selYear}, según año de la venta</td></tr>`+yrsFac+(facturadoEmitido.total>0?row('Total emitido (con terceros y reembolsos)',facturadoEmitido.totalUF,facturadoEmitido.total):''))
    const cobCard=card('Cobrado propio', iv.totalUF||0, ingYTD, `${pct(ingYTD,metaCobranza)}% de la meta`, row('Comisiones pagadas',comU,comisYTD,true)+row('+ Comisiones percibidas',percU,percYTD)+row('Ingreso real',(iv.totalUF||0)-comU+percU,ingReal)+row('Total a caja',iv.totalCajaUF||0,iv.totalCaja||0)+`<tr><td colspan='2' style='padding:8px 0 3px;font-size:9px;font-weight:800;color:${AZ3};text-transform:uppercase;letter-spacing:.4px'>Según año de la venta</td></tr>`+yrsCob)
    const margCard=card(resAnio.res>=0?'Margen del ejercicio':'Pérdida del ejercicio', V.res, resAnio.res, (resAnio.pct!=null?`${pct1(resAnio.pct)}% sobre los ingresos`:'— sobre los ingresos'), row('Facturado',V.fac,resAnio.fac)+(resAnio.sub?row('+ Subarriendo',V.sub,resAnio.sub):'')+(resAnio.rex?row('+ Comisión de externos',V.rex,resAnio.rex):'')+row('= Ingresos',V.ing,resAnio.ing)+row('Costos de operación',V.cos,resAnio.cos,true)+row('Comisiones pagadas',V.com,resAnio.com,true))
    const _mU=ingYTD>0&&(iv.totalUF||0)>0?metaCobranza*iv.totalUF/ingYTD:metaCobranza/ufR, _sob=ingYTD>=metaCobranza
    const [_a,_b]=_sob?redondearPartes([_mU,(iv.totalUF||0)-_mU],1,[]):redondearPartes([iv.totalUF||0,_mU-(iv.totalUF||0)],1,[0])
    const cobranzaCard=card('Cobranza', iv.totalUF||0, ingYTD, `${pct(ingYTD,metaCobranza)}% de la meta`, row('Meta de cobranza',_sob?_a:_a+_b,metaCobranza)+row(_sob?'Sobre la meta':'Falta para la meta',_b,Math.abs(ingYTD-metaCobranza)))
    const dias=new Date().toLocaleDateString('es-CL',{day:'numeric',month:'long',year:'numeric'})
    const hhmm=new Date().toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit'})
    const html=`<!DOCTYPE html><html><head><meta charset='UTF-8'><title>Resultado del año ${selYear} — ${BRAND.nombre}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'DM Sans',Helvetica,Arial,sans-serif;color:#3D3D3D;background:#fff;font-size:12px}.page{max-width:760px;margin:0 auto}@page{size:letter portrait;margin:14mm}@media print{.no-print{display:none}}.print-btn{position:fixed;bottom:20px;right:20px;background:${A};color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer}.two{display:grid;grid-template-columns:1fr 1fr;gap:12px}</style></head><body><div class='page'><div style='background:${A};color:#fff;padding:18px 22px;display:flex;justify-content:space-between;align-items:center'><img src='${location.origin}${BRAND.logo.blanco}' alt='${BRAND.nombre}' style='height:26px;display:block'/><div style='text-align:right'><div style='font-size:14px;font-weight:800;letter-spacing:.3px'>RESULTADO DEL AÑO</div><div style='font-size:10px;color:#9FC4DD;margin-top:2px'>Ejercicio ${selYear}</div></div></div><div style='background:#E6F1FB;color:#185FA5;padding:8px 22px;display:flex;justify-content:space-between;font-size:11px;font-weight:800;letter-spacing:.3px'><span>CORTE AL ${dias.toUpperCase()}</span><span>${hhmm} HRS</span></div><div style='padding:18px 22px'><div class='two'>${ventasCard}${factCard}</div>${cobCard}${margCard}${cobranzaCard}<div style='margin-top:8px;padding-top:10px;border-top:1px solid ${GRAY};font-size:9px;color:${AZ3};font-weight:700;letter-spacing:.3px'>DOCUMENTO INTERNO · ${BRAND.nombre} · ${BRAND.dominio||''}</div></div></div><button class='print-btn no-print' onclick='window.print()'>Imprimir / Guardar PDF</button></body></html>`
    const w=window.open('','_blank'); if(w){ w.document.write(html); w.document.close() } else appAlert('Habilita las ventanas emergentes para imprimir el informe.')
  }
  // Años con meta cargada O con ventas registradas (así 2025/2024 aparecen al ingresar sus ventas, sin necesidad de meta)
  const aniosDisponibles = [...new Set([currentYear, ...targets.map(t=>t.year), ...sales.filter(s=>!['Borrador','Propuesta','Rechazada'].includes(s.status)&&!esSubarriendo(s)).map(s=>s.year).filter(Boolean)])].sort((a,b)=>b-a)
  const ufFecha = ufState.asOf ? new Date(ufState.asOf+'T12:00').toLocaleDateString('es-CL',{day:'2-digit',month:'2-digit'}) : ''
  const ufTxt = ufState.uf ? `UF ${ufFecha} · $${Math.round(ufState.uf).toLocaleString('es-CL')}` : ''
  const Chev = ({open}) => <svg width='9' height='9' viewBox='0 0 10 10' style={{transform:open?'rotate(180deg)':'none',transition:'transform .15s',flexShrink:0}}><path d='M2 3.5 L5 6.5 L8 3.5' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round'/></svg>


  // --- Aging de cartera ---
  const clientesMap = useMemo(()=>Object.fromEntries((clients||[]).map(c=>[c.id,c.name])),[clients])
  const [top5Open,setTop5Open] = usePersistedState('d_top5',false)
  const [agingBucket,setAgingBucket] = usePersistedState('d_aging',null)   // tramo del aging abierto para ver su detalle
  const agingData = useMemo(()=>computeAgingCartera(billing.filter(b=>b.billing_type!=='reembolso'), clientesMap),[billing,clientesMap])
  // Vencido = TODO lo vencido (porCobrarBills + esVencidaB), lo mismo que muestra Cobranza; el aging +60 queda solo para su gráfico.
  const vencidoBills = useMemo(()=>(billing||[]).filter(b=>b&&!b.deleted_at&&!['reembolso','nota_credito'].includes(b.billing_type)&&b.invoice_no&&['Pendiente','Vencido'].includes(b.status)&&esVencidaB(b)),[billing])
  const vencidoTot = vencidoBills.reduce((a,b)=>a+saldoBill(b),0)
  // Programadas fantasma (ya emitidas, alta confianza) fuera, para no contar dos veces la cuota y su factura gemela.
  const billingProj = useMemo(()=> (fantasmaIds&&fantasmaIds.size) ? (billing||[]).filter(b=> !fantasmaIds.has(String(b.id))) : (billing||[]), [billing,fantasmaIds])
  // Cuentas por pagar (cifra del tile): deuda a proveedores no pagada (por_pagar + pendiente), excluye facturas anuladas. Mismo criterio que el detalle.
  // Comisiones por pagar (fuente única saldoComisiones: el cliente ya pagó esa cuota; lo que aún no paga va como 'sujeto a cobro').
  const comisSaldo = useMemo(()=>saldoComisiones(terceros,billing),[terceros,billing])
  const cxpTotDash = comisSaldo.porPagar

  // --- Clientes sin fondos: detalle por cliente ---
  const [expSinFondos,setExpSinFondos] = useState(null)
  const totalNeg = negatives.reduce((a,c)=>a+(balances[c.id]||0),0)
  const maxDeficit = Math.max(1, ...negatives.map(c=>Math.abs(balances[c.id]||0)))
  const iniciales = (name) => (name||'?').split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase()
  const datosCliente = (c) => {
    const evs = expenses.filter(e=>e.client_id===c.id)
    const {fondos,gastos,saldo} = fgCliente(expenses, c.id)   // fuente única: excluye no_descuenta_saldo (antes el saldo del Dashboard contaba gastos históricos → divergía)
    const movs = [...evs].sort((a,b)=>new Date(b.date||0)-new Date(a.date||0)).slice(0,3)
    const rs = clientEntities.filter(e=>e.client_id===c.id)
    return {fondos,gastos,saldo,movs,rs}
  }

  // --- Qué atender hoy: junta lo urgente de todas las áreas, priorizado (determinista). ---
  const atenderHoy = useMemo(()=>{
    const today = new Date().toISOString().slice(0,10)
    const dlb = b => daysLeft(b.due)
    const vencidas = bb.filter(b=>b.status==='Vencido'&&b.billing_type!=='reembolso')
    const porCobrar7 = bb.filter(b=>b.status==='Pendiente'&&b.billing_type!=='reembolso'&&dlb(b)!=null&&dlb(b)>=0&&dlb(b)<=7)
    const tareasVenc = (tasks||[]).filter(t=>t.status!=='Terminado'&&t.due&&String(t.due)<today)
    const cajaUsers=['Martín','Martina']
    const cajaSinLiq = cajaUsers.flatMap(u=>gastosPorLiquidarCaja(expenses,u))   // misma regla que la caja chica de cada persona
    const _porRendir = clientesPorRendir(clients, expenses), rendCli = _porRendir.map(x=>x.c.id)   // misma cifra que la página Rendir a cliente
    const propTardias = sales.filter(s=>s.status==='Propuesta'&&s.created_at&&Math.floor((Date.now()-new Date(s.created_at))/86400000)>14)
    const sum = arr => arr.reduce((a,b)=>a+(b.amount||0),0)
    const sumSaldo = arr => arr.reduce((a,b)=>a+saldoBill(b),0)
    const cnD = id => (clients||[]).find(c=>String(c.id)===String(id))?.name || 'Cliente'
    const rcRows = _porRendir.map(x=>({name:x.c.name,val:fmtN(x.tot),v:x.tot,cid:x.c.id}))
    const en7plz = new Date(Date.now()+7*86400000).toISOString().slice(0,10)
    const plzVenc=(plazos||[]).filter(p=>p.estado!=='cumplido'&&p.fecha&&p.fecha<today)
    const plzProx=(plazos||[]).filter(p=>p.estado!=='cumplido'&&p.fecha&&p.fecha>=today&&p.fecha<=en7plz)
    const fmtPlz=f=>{ try{ return fmtFechaDMY(f) }catch(_){ return f||'' } }
    // Cartera: proyectos críticos (rojo) y sin mover +2 semanas → al panel
    const diasCart=iso=>iso?Math.floor((Date.now()-new Date(iso+'T00:00').getTime())/86400000):null
    const cartCrit=(proyectosCartera||[]).filter(p=>p.activo!==false&&(p.estado||'verde')==='rojo')
    const cartStale=(proyectosCartera||[]).filter(p=>p.activo!==false&&(p.estado||'verde')!=='rojo'&&diasCart(p.ultima_actividad)!=null&&diasCart(p.ultima_actividad)>=14)
    const items = [
      vencidas.length&&{sev:0,dot:C.overdue,ico:'cash',lbl:'Facturas vencidas',sub:`${vencidas.length} factura${vencidas.length!==1?'s':''}`,amt:fmtShort(sumSaldo(vencidas)),go:'billing',navLbl:`Ver las ${vencidas.length}`,rows:vencidas.slice(0,3).map(b=>({name:cnD(b.client_id),val:fmtN(saldoBill(b)),cid:b.client_id})),iaTxt:`${vencidas.length} facturas vencidas por ${fmtShort(sumSaldo(vencidas))}`},
      tareasVenc.length&&{sev:0,dot:C.overdue,ico:'alert',lbl:'Tareas vencidas',sub:`${tareasVenc.length} tarea${tareasVenc.length!==1?'s':''}`,amt:'',go:'tasks',navLbl:`Ver las ${tareasVenc.length}`,rows:tareasVenc.slice(0,3).map(t=>({name:t.title||'Tarea',val:''})),iaTxt:`${tareasVenc.length} tareas vencidas`},
      porCobrar7.length&&{sev:1,dot:C.soon,ico:'cash',lbl:'Por cobrar esta semana',sub:`${porCobrar7.length} factura${porCobrar7.length!==1?'s':''}`,amt:fmtShort(sumSaldo(porCobrar7)),go:'billing',navLbl:`Ver las ${porCobrar7.length}`,rows:porCobrar7.slice(0,3).map(b=>({name:cnD(b.client_id),val:fmtN(saldoBill(b)),cid:b.client_id})),iaTxt:`${porCobrar7.length} cobros vencen esta semana (${fmtShort(sumSaldo(porCobrar7))})`},
      // Caja chica por persona (alertasCajaChica, fuente única): en negativo = la oficina le debe (rojo); baja = bajo el umbral del estudio (ámbar). Acción: Entregar caja.
      ...alertasCajaChica(pettyCash,expenses).map(a=>a.tipo==='negativo'
        ? {sev:0,dot:C.overdue,ico:'wallet',lbl:'Caja chica en negativo',sub:`${a.persona} · la oficina le debe ${fmtN(-a.saldo)}`,amt:'−'+fmtN(-a.saldo),onNav:()=>onEntregarCaja&&onEntregarCaja(a.persona,-a.saldo),navLbl:`Entregar caja ${fmtN(-a.saldo)}`,rows:[],iaTxt:`${a.persona} tiene la caja chica en negativo por ${fmtN(-a.saldo)} (la oficina le debe)`}
        : {sev:1,dot:C.soon,ico:'wallet',lbl:'Caja chica baja',sub:`${a.persona} · quedan ${fmtN(a.saldo)} (aviso a ${fmtN(BRAND.cajaChicaUmbral)})`,amt:'',onNav:()=>onEntregarCaja&&onEntregarCaja(a.persona,null),navLbl:'Entregar caja',rows:[],iaTxt:`a ${a.persona} le quedan ${fmtN(a.saldo)} de caja chica`}),
      cajaSinLiq.length&&{sev:1,dot:C.soon,ico:'wallet',lbl:'Caja chica sin liquidar',sub:`${cajaSinLiq.length} gasto${cajaSinLiq.length!==1?'s':''}`,amt:fmtN(sum(cajaSinLiq)),go:'expenses',navLbl:`Ver los ${cajaSinLiq.length}`,rows:cajaSinLiq.slice(0,3).map(e=>({name:e.concept||'—',val:fmtN(e.amount)})),iaTxt:`${cajaSinLiq.length} gastos de caja chica sin liquidar`},
      rendCli.length&&{sev:2,dot:C.normal,ico:'file',lbl:'Rendiciones por hacer',sub:`${rendCli.length} cliente${rendCli.length!==1?'s':''}`,amt:'',go:'expenses',onNav:onRendirClientes||undefined,navLbl:`Ver los ${rendCli.length}`,rows:rcRows.slice(0,3),iaTxt:`${rendCli.length} clientes con gastos por rendir`},
      propTardias.length&&{sev:2,dot:C.done,ico:'clock',lbl:'Propuestas tardías (+14d)',sub:`${propTardias.length} propuesta${propTardias.length!==1?'s':''}`,amt:fmtShort(Math.round(propTardias.reduce((a,s)=>a+clpDeVenta(s),0))),go:'sales',navLbl:`Ver las ${propTardias.length}`,rows:propTardias.slice(0,3).map(s=>({name:s.title||cnD(s.client_id),val:'',cid:s.client_id})),iaTxt:`${propTardias.length} propuestas hace +14 días sin cerrar`},
      plzVenc.length&&{sev:0,dot:C.overdue,ico:'clock',lbl:'Plazos vencidos',sub:`${plzVenc.length} plazo${plzVenc.length!==1?'s':''}`,amt:'',onNav:()=>onOpenPlazos&&onOpenPlazos(),navLbl:'Ver plazos',rows:plzVenc.slice(0,3).map(p=>({name:p.titulo||'Plazo',val:fmtPlz(p.fecha),cid:p.client_id})),iaTxt:`${plzVenc.length} plazos vencidos`},
      plzProx.length&&{sev:1,dot:C.soon,ico:'clock',lbl:'Plazos esta semana',sub:`${plzProx.length} plazo${plzProx.length!==1?'s':''}`,amt:'',onNav:()=>onOpenPlazos&&onOpenPlazos(),navLbl:'Ver plazos',rows:plzProx.slice(0,3).map(p=>({name:p.titulo||'Plazo',val:fmtPlz(p.fecha),cid:p.client_id})),iaTxt:`${plzProx.length} plazos vencen esta semana`},
      calTrib&&calTrib.alertas.length&&{sev:calTrib.alertas[0].sev,dot:calTrib.alertas[0].sev?C.soon:C.overdue,ico:'clock',lbl:'Calendario tributario',sub:`${calTrib.alertas.length} aviso${calTrib.alertas.length!==1?'s':''}`,amt:'',onNav:()=>onOpenCalTrib&&onOpenCalTrib(),navLbl:'Ver calendario',rows:calTrib.alertas.slice(0,3).map(a=>({name:a.t,val:''})),iaTxt:`calendario tributario: ${calTrib.alertas.map(a=>a.t).join('; ')}`},
      cartCrit.length&&{sev:0,dot:C.overdue,ico:'alert',lbl:'Proyectos críticos',sub:`${cartCrit.length} proyecto${cartCrit.length!==1?'s':''}`,amt:'',onNav:()=>go('cartera'),navLbl:'Ver proyectos',rows:cartCrit.slice(0,3).map(p=>({name:cnD(p.cliente_id),val:'',cid:p.cliente_id})),iaTxt:`${cartCrit.length} proyecto${cartCrit.length!==1?'s':''} en rojo`},
      cartStale.length&&{sev:1,dot:C.soon,ico:'clock',lbl:'Proyectos sin mover +2 semanas',sub:`${cartStale.length} proyecto${cartStale.length!==1?'s':''}`,amt:'',onNav:()=>go('cartera'),navLbl:'Ver proyectos',rows:cartStale.slice(0,3).map(p=>({name:cnD(p.cliente_id),val:'',cid:p.cliente_id})),iaTxt:`${cartStale.length} proyecto${cartStale.length!==1?'s':''} sin mover +2 semanas`},
    ].filter(Boolean).sort((a,b)=>a.sev-b.sev)
    const head = vencidas.length ? `Hoy prioriza la cobranza: ${fmtShort(sum(vencidas))} en ${vencidas.length} factura${vencidas.length!==1?'s':''} vencida${vencidas.length!==1?'s':''}.`
      : tareasVenc.length ? `Tienes ${tareasVenc.length} tarea${tareasVenc.length!==1?'s':''} vencida${tareasVenc.length!==1?'s':''} por resolver.`
      : porCobrar7.length ? `Vence cobranza esta semana: ${fmtShort(sum(porCobrar7))} en ${porCobrar7.length}.`
      : items.length ? 'Pendientes menores por revisar.' : 'Todo al día.'
    return {items, head}
  },[bb,tasks,expenses,sales,negatives,totalNeg,clients,plazos,proyectosCartera,pettyCash,onEntregarCaja,calTrib,onOpenCalTrib])

  const resumenHoyIA = async()=>{
    if(!atenderHoy.items.length){ setIaHoy('Todo al día — sin pendientes urgentes.'); return }
    setIaHoyBusy(true)
    const prompt=`Eres el copiloto del socio de un estudio de abogados. Estos son los pendientes de HOY (ya calculados, no inventes cifras): ${atenderHoy.items.map(i=>i.iaTxt).join('; ')}. Escribe 2 frases MUY breves, en español de Chile, tono directo, diciendo en qué enfocarse hoy y por qué (prioriza cobranza/plazos). No listes todo, da el foco. Sin saludo ni markdown.`
    try{
      const data=await claudeCall({model:'claude-opus-4-8',max_tokens:300,messages:[{role:'user',content:prompt}]})
      const txt=(data.content?.[0]?.text||'').trim()
      if(txt) setIaHoy(txt)
    }catch(e){ appAlert('No se pudo generar el resumen: '+(e?.message||e)) }
    setIaHoyBusy(false)
  }

  const fuRes = useFuentesResultado()
  // Resultado real del año en curso (misma fuente que Oficina / Estado de resultados) para las alertas de costos: no el presupuesto.
  const resYTDReal = useMemo(()=>{ const deps={billing,terceros,costosOfiRows,expenses,clients,ufd:ufDias,ufFb:ufRef}, o={ing:0,cos:0,com:0,res:0,ingUF:0,cosUF:0,comUF:0}
    for(let i=1;i<=_mNow;i++){ const r=resultadoMes(fuRes,deps,`${currentYear}-${String(i).padStart(2,'0')}`); o.ing+=r.ing; o.cos+=r.cos; o.com+=r.com; o.res+=r.res; o.ingUF+=r.ingUF; o.cosUF+=r.cosUF; o.comUF+=r.comUF }
    return o },[fuRes,billing,terceros,costosOfiRows,expenses,clients,currentYear,_mNow,ufDias,ufRef])
  // Prioridades financieras (alertas del dueño) — se computa aquí para usar el conteo en la tarjeta de Accesos directos y reusar en la lista. De datos que ya existen.
  const prioridades = (()=>{
    const hoy=new Date().toISOString().slice(0,10)
    const vencMonto=vencidoTot
    const vencN=vencidoBills.length
    const _fact=ventasFacturando(billing)   // solo trabajos que ya empezaron a facturar (regla del usuario 24-10)
    const progVenc=(billingProj||[]).filter(b=> b && !b.deleted_at && b.status==='Programada' && b.due && b.due<hoy && (!b.sale_id || _fact.has(String(b.sale_id))))
    const progMonto=progVenc.reduce((a,b)=>a+(montoFactura(b)||b.amount||0),0)
    const porIdent=ingresosPorAnioVenta.porIdentificar||0
    const ingYTD_a=ingresosPorAnioVenta.total||0
    const cxpN=comisSaldo.provsPorPagar.size, cxpDias=comisSaldo.porPagarDesde?_diasDesde(comisSaldo.porPagarDesde):null
    const _pd=new Date(); _pd.setDate(1); _pd.setMonth(_pd.getMonth()-1); const prevYm=_pd.toISOString().slice(0,7)
    const _pdLbl=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][+prevYm.slice(5,7)-1]
    const abPrev=(ingAbonos||[]).filter(a=>String(a.fecha||'').startsWith(prevYm))
    const entraPrev=abPrev.reduce((s,a)=>s+(Number(a.monto)||0),0), entraPrevUF=abPrev.reduce((s,a)=>s+(Number(a.monto)||0)/ufDelDia(ufDias,a.fecha,ufRef),0)
    const rPrev=resultadoMes(fuRes,{billing,terceros,costosOfiRows,expenses,clients,ufd:ufDias,ufFb:ufRef},prevYm), cuestaPrev=rPrev.cos   // costo REAL del mes (banco + planilla + gastos varios)
    const cnA=id=>(clients.find(c=>String(c.id)===String(id))?.name)||'cliente'
    const _wk=(()=>{ const d=new Date(); const m=new Date(d); m.setDate(d.getDate()-((d.getDay()+6)%7)); return m.toLocaleDateString('en-CA') })()
    const raw=[
      vencMonto>0 && {key:'vencido',sev:'r',icon:'alert',monto:vencMonto,t:`Vencido ${fmtMon(vencMonto)}`,s:`${vencN} factura${vencN!==1?'s':''} vencida${vencN!==1?'s':''}`,goLbl:'Cobranza',go:()=>go('cobranza')},
      (entraPrev>0 && entraPrev<cuestaPrev) && {key:'cajames',sev:'r',icon:'chart',monto:cuestaPrev-entraPrev,t:`En ${_pdLbl} entró menos de lo que costó la oficina`,s:`entró ${vMon(entraPrevUF,entraPrev)} · costó ${vMon(rPrev.cosUF,cuestaPrev)}`,goLbl:'Costos',go:()=>onOpenCostosOfi&&onOpenCostosOfi()},
      progVenc.length>0 && {key:'porfacturar',sev:'a',icon:'file',monto:progMonto,t:`${progVenc.length} por emitir vencida${progVenc.length!==1?'s':''}`,s:`${fmtMon(progMonto)} vendido sin facturar`,goLbl:'Facturar',go:()=>onAcceso&&onAcceso('facturasMes')},
      cxpTotDash>0 && {key:'cxp',sev:'a',icon:'wallet',monto:cxpTotDash,t:`Comisiones por pagar ${fmtMon(cxpTotDash)}`,s:`${cxpN} proveedor${cxpN!==1?'es':''}${cxpDias!=null?` · la más antigua cobrada hace ${nDias(cxpDias)}`:''}${comisSaldo.porDevengar>0?` · sujeto a cobro ${fmtShort(comisSaldo.porDevengar)}`:''}`,goLbl:'Ver',go:()=>navTo?navTo({tab:'proveedores'}):go('billing')},
      margenNeg.length>0 && {key:'bajocosto',sev:'a',icon:'briefcase',monto:Math.abs(margenNeg[0].margen),t:`${margenNeg.length} cliente${margenNeg.length!==1?'s':''} rinde${margenNeg.length!==1?'n':''} bajo su costo`,s:`el más crítico: ${cnA(margenNeg[0].cid)} ${margenNeg[0].pct}%`,goLbl:'Repricing',go:()=>go('repricing')},
      (misHorasSem===0) && {key:'cargahoras:'+_wk,sev:'b',icon:'clock',monto:0,t:'Aún no cargas tus horas de la semana',s:'La app las lee de tu correo y agenda — así mides tu rentabilidad real',goLbl:'Cargar',go:()=>go('horas')},
      porIdent>0 && {key:'identificar',sev:'b',icon:'receipt',monto:porIdent,t:`${fmtMon(porIdent)} por identificar`,s:'abonos en el banco sin conciliar',goLbl:'Conciliar',go:()=>onAcceso&&onAcceso('conciliacion')},
      (resYTDReal.ing>0 && resYTDReal.res<0) && {key:'estructura',sev:'a',icon:'wallet',monto:-resYTDReal.res,t:'Aún no cubres los costos del año',s:`ingresos ${vMon(resYTDReal.ingUF,resYTDReal.ing)} < costos ${vMon(resYTDReal.cosUF+resYTDReal.comUF,resYTDReal.cos+resYTDReal.com)}`,goLbl:'Costos',go:()=>onOpenCostosOfi&&onOpenCostosOfi()},
    ].filter(Boolean)
    const off=(alertOff&&typeof alertOff==='object')?alertOff:{}
    return raw.filter(a=> off[a.key]==null || (a.monto||0) > off[a.key]*1.2 )
  })()

  // "Este mes": compara PRIMERO lo emitido este mes vs cuánto de ESAS mismas facturas ya se pagó (conversión real).
  // Aparte: "otras pagadas" = cobros de este mes de facturas de meses anteriores. Total ingresado = suma de ambos. Fuente única montoFactura/cobradoBill.
  const _ymNow = new Date().toISOString().slice(0,7)
  const _MES_NOM = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
  const emFacList = (billing||[]).filter(b=> b && !b.deleted_at && b.invoice_no && b.status!=='Anulada' && b.status!=='Programada' && b.billing_type!=='reembolso' && String(b.issued_at||'').startsWith(_ymNow))
    .slice().sort((a,b)=> String(b.issued_at||'').localeCompare(String(a.issued_at||'')))
  const emFacTot = emFacList.reduce((a,b)=>a+montoFactura(b),0)          // emitido del mes (DTE)
  const emFacPagTot = emFacList.reduce((a,b)=>a+cobradoBill(b),0)        // pagado DE LO EMITIDO del mes (conversión)
  const emFacPagN = emFacList.filter(b=>cobradoBill(b)>0).length
  const emOtrasList = (billing||[]).filter(b=> b && !b.deleted_at && b.status!=='Anulada' && b.billing_type!=='reembolso' && String(b.paid_at||'').startsWith(_ymNow) && !String(b.issued_at||'').startsWith(_ymNow))
    .slice().sort((a,b)=> String(b.paid_at||'').localeCompare(String(a.paid_at||'')))
  const emOtrasTot = emOtrasList.reduce((a,b)=>a+cobradoBill(b),0)       // otras pagadas este mes (facturas de meses anteriores)
  const emTotalMes = emFacPagTot + emOtrasTot                            // total ingresado en el mes
  const emPct = emFacTot>0 ? Math.round(emFacPagTot/emFacTot*100) : 0
  const emCliName = b => (clients.find(c=>String(c.id)===String(b.client_id))?.name)||b.receptor_name||'—'

  // Resultado del mes — FUENTE ÚNICA (resultadoMes), idéntico al de la página Estado de resultados.
  const resMes = resultadoMes(fuRes, {billing,terceros,costosOfiRows,expenses,clients}, _ymNow).res
  const resMesDif = resMes - resultadoMes(fuRes, {billing,terceros,costosOfiRows,expenses,clients}, _ymPrev(_ymNow)).res
  // MARGEN del año = el MISMO resultado del Estado de resultados / Oficina / Resultado del año (devengado): Σ resultadoMes del año elegido.
  const resAnio = useMemo(()=>{ const deps={billing,terceros,costosOfiRows,expenses,clients,ufd:ufDias,ufFb:ufRef}, ult=selYear===currentYear?_mNow:12
    const K=['fac','sub','rex','ing','cos','com','res'], o={}; K.forEach(k=>{ o[k]=0; o[k+'UF']=0 })
    o.rexItems=[]
    for(let i=1;i<=ult;i++){ const r=resultadoMes(fuRes,deps,`${selYear}-${String(i).padStart(2,'0')}`); K.forEach(k=>{ o[k]+=r[k]; o[k+'UF']+=r[k+'UF'] }); o.rexItems.push(...(r.rexItems||[])) }
    o.pct=margenPct(o.res,o.ing)
    // Cifras para MOSTRAR la cascada: redondeadas de modo que las partes sumen el total (UF enteras; pesos a $0,1M como fmtMill).
    const cuadra=(paso,sf)=>{ const ing=Math.round(o['ing'+sf]/paso)*paso, [fac,sub,rex]=redondearPartes([o['fac'+sf],o['sub'+sf],o['rex'+sf]],paso,[0]), [res,cos,com]=redondearPartes([o['res'+sf],o['cos'+sf],o['com'+sf]],paso,[0]); return {fac,sub,rex,ing,cos,com,res} }
    o.verUF=cuadra(1,'UF'); o.verCLP=cuadra(1e5,'')
    return o },[fuRes,billing,terceros,costosOfiRows,expenses,clients,selYear,currentYear,_mNow,ufDias,ufRef])
  // Counsel AI responde el resultado del año con la MISMA cifra que muestra Inicio: se publica aquí lo que Inicio acaba de calcular (no hay otra fórmula).
  useEffect(()=>{ try{ publicarResultadoInicio({ anio:selYear, secs:armarSecciones().secs, at:Date.now() }) }catch(_){} })
  const pct1 = v => v==null?null:v.toLocaleString('es-CL',{minimumFractionDigits:1,maximumFractionDigits:1})
  // Comisión de externos del año (facturado) partida en lo ya cobrado y lo por cobrar: misma comisión que «Comisiones percibidas»
  // (cobrado), medida al facturar. Cobrada = lo conciliado de la factura × comisión ÷ (comisión + parte del externo), la misma
  // fórmula de «Comisiones percibidas», con tope en la comisión facturada.
  const rexDet = useMemo(()=>{ const cobF={}; (ingConc||[]).forEach(c=>{ if(c&&c.tipo_destino==='factura'&&c.factura_id) cobF[String(c.factura_id)]=(cobF[String(c.factura_id)]||0)+(Number(c.monto_aplicado)||0) })
    const it=(resAnio.rexItems||[]).map(({t,b})=>{ const com=Number(t.comision_monto)||0, base=com+(Number(t.monto)||0), c=base>0?Math.min(com,(cobF[String(b.id)]||0)*com/base):0; return {b,com,cob:c,pend:com-c} })
    const cob=it.filter(x=>x.cob>=1).sort((a,b)=>String(b.b.paid_at||b.b.issued_at||'').localeCompare(String(a.b.paid_at||a.b.issued_at||''))), pend=it.filter(x=>x.pend>=1).sort((a,b)=>String(b.b.issued_at||'').localeCompare(String(a.b.issued_at||'')))
    return {cob, pend, tot:it.reduce((a,x)=>a+x.com,0), tCob:cob.reduce((a,x)=>a+x.cob,0), tPend:pend.reduce((a,x)=>a+x.pend,0), nVenc:pend.filter(x=>x.b.status==='Vencido').length}
  },[resAnio,ingConc])
  // Flujo de caja NETO a 8 semanas (entra − sale) sin depender del saldo del banco: cobros esperados − costos prorrateados − comisiones por pagar.
  const flujoCaja = useFlujoCaja({billing,terceros,costosOfiRows,anticipos,expenses,clients,sales,fantasmaIds})   // misma fuente que la página Flujo de caja y Oficina
  const flujoNeto8 = flujoCaja.fin
  const proyCobranza = useMemo(()=>proyeccionCobranza(flujoCaja).total,[flujoCaja])   // Proyección al 31-12 = el mismo cálculo del Flujo, hasta fin de año
  const vencMes = vencidoTot
  // Mi trabajo (operativo del usuario)
  const _miIniT = INICIALES_RESP[user?.name]||null
  const mineProyN = (proyectosCartera||[]).filter(p=>p&&p.activo!==false&&(!_miIniT||(p.responsable||'')===_miIniT)).length
  // «Mis» = asignadas a quien mira (como la lista de Tareas), no las de todo el equipo.
  const esMiaT = t => t && t.status!=='Terminado' && !t.archived && ((t.assignees&&t.assignees.includes(user?.name)) || t.who===user?.name)
  const tareasPendN = (tasks||[]).filter(esMiaT).length
  const _wk7ISO = (()=>{ const d=new Date(); d.setDate(d.getDate()+7); return d.toISOString().slice(0,10) })()
  const cargaSemN = (tasks||[]).filter(t=>esMiaT(t)&&t.due&&String(t.due).slice(0,10)<=_wk7ISO).length

  // PÁGINA Prioridades financieras (early-return): abre desde el menú Finanzas (sidebar) o ⌘K; cada alerta navega a su fuente (y cierra la página para que el volver caiga en Inicio).
  // (Página «Prioridades financieras» retirada 2026-10-14: duplicaba avisos que ya viven en Inicio, Cobranza, Banco y Comisiones.)


  return (
    <div className='dash-cols'>

      {/* Accesos directos + Mis proyectos */}
      {onAcceso&&(()=>{
        const ic = (d,col) => <svg width='19' height='19' viewBox='0 0 24 24' fill='none' stroke={col||C.accent} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>{d}</svg>
        const accesos = [
          ['conciliacion','Banco', ic(<><polyline points='17 1 21 5 17 9'/><path d='M3 11V9a4 4 0 0 1 4-4h14'/><polyline points='7 23 3 19 7 15'/><path d='M21 13v2a4 4 0 0 1-4 4H3'/></>,C.greenText), C.greenBg],
          ['cobranza','Cobranza', ic(<><rect x='2' y='6' width='20' height='12' rx='2'/><circle cx='12' cy='12' r='2.5'/><path d='M6 12h.01M18 12h.01'/></>,C.overdueText), C.overdueBg],
          ['facturasMes','Facturas', ic(<><path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'/><path d='M14 2v6h6'/><path d='M12 11v6M9.5 12.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4'/></>,C.accent), C.azulBg],
          ['cierreMes','Cierre mes', ic(<><rect x='3' y='4' width='18' height='18' rx='2'/><line x1='3' y1='10' x2='21' y2='10'/><path d='M8.5 15.5l2.5 2.5 4.5-4.5'/></>,C.greenText), C.greenBg],
          ['oficina','Oficina', ic(<><path d='M3 21h18'/><path d='M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16'/><path d='M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1'/></>,C.tealText), C.tealBg],
        ]
        const miIni = INICIALES_RESP[user?.name]||null
        const mine = (proyectosCartera||[]).filter(p=>p.activo!==false && (!miIni || (p.responsable||'')===miIni))
        const hace = iso => { if(!iso) return 'sin mover'; const d=Math.round((Date.now()-new Date(iso+'T00:00').getTime())/86400000); return d<=0?'hoy':d===1?'ayer':`hace ${nDias(d)}` }
        const sorted = [...mine].sort((a,b)=>{ const ka=a.ultima_actividad?new Date(a.ultima_actividad).getTime():0, kb=b.ultima_actividad?new Date(b.ultima_actividad).getTime():0; return ka-kb })
        const CART_DOT={rojo:'#E24B4A',ambar:'#EF9F27',verde:'#1D9E75'}
        return (
          <div style={{padding:'0 20px 0'}}>
            <div className='dash-acc' style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:7,marginBottom:14}}>
              {[...accesos].sort((a,b)=>((accUso.c[b[0]]||0)-(accUso.c[a[0]]||0))).map(([id,label,icon,bg])=>(
                <button key={id} onClick={()=>{bumpAcceso(id);onAcceso(id)}} style={{position:'relative',background:'#fff',border:`1px solid ${C.border}`,borderRadius:10,padding:'11px 4px',cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',gap:5}}>
                  {accUso.last===id&&<span title='Lo último que abriste' style={{position:'absolute',top:7,right:9,width:7,height:7,borderRadius:'50%',background:C.normal}}/>}
                  <span style={{width:34,height:34,borderRadius:'50%',background:bg,display:'inline-flex',alignItems:'center',justifyContent:'center'}}>{icon}</span>
                  <span style={{fontSize:10,color:C.text}}>{label}</span>
                </button>
              ))}
            </div>
          </div>
        )
      })()}

      {/* REQUIERE ATENCIÓN — alertas del dueño, replegado por defecto. Iconos SIcon, paleta C, sin emojis. De datos que ya existen. */}
      {(()=>{
        return null   // panel inline reemplazado por la PÁGINA Prioridades (early-return abajo; abre desde el tile de Finanzas·gestión)
        const alertas=prioridades
        if(!alertas.length || !alertExp) return null
        const SEV={r:{bg:C.overdueBg,fg:C.overdueText},a:{bg:C.soonBg,fg:C.soonText},b:{bg:C.azulBg,fg:C.azulInfo}}
        return (
        <div style={{padding:'0 20px 0'}}>
          <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
            <div style={{display:'flex',alignItems:'center',gap:9,padding:'10px 12px',background:C.bgSoft,borderBottom:`1px solid ${C.border}`}}>
              <span style={{width:24,height:24,borderRadius:8,background:C.azulBg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SIcon n='wallet' s={14} c={C.accent}/></span>
              <span style={{flex:1,fontSize:12,fontWeight:700,color:C.accent}}>Prioridades financieras</span>
              <span onClick={()=>setAlertExp(false)} title='Cerrar' style={{color:C.textSoft,cursor:'pointer',display:'flex'}}><svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round'><line x1='18' y1='6' x2='6' y2='18'/><line x1='6' y1='6' x2='18' y2='18'/></svg></span>
            </div>
            <div>
              {alertas.map((a,i)=>{ const sv=SEV[a.sev]||SEV.b; return (
                <div key={a.key} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',borderTop:i?`0.5px solid ${C.bgSoft}`:'none'}}>
                  <span style={{width:28,height:28,borderRadius:8,background:sv.bg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SIcon n={a.icon} s={15} c={sv.fg}/></span>
                  <div onClick={a.go} style={{flex:1,minWidth:0,cursor:'pointer'}}>
                    <div style={{fontSize:12,fontWeight:700,color:C.text,lineHeight:1.2}}>{a.t}</div>
                    <div style={{fontSize:10,color:C.muted,marginTop:1}}>{a.s}</div>
                  </div>
                  <span onClick={a.go} style={{fontSize:9,fontWeight:800,color:C.accent,whiteSpace:'nowrap',cursor:'pointer'}}>{a.goLbl} →</span>
                  <span onClick={e=>{e.stopPropagation();descartarAlerta(a)}} title='Descartar' style={{color:C.textSoft,cursor:'pointer',flexShrink:0,display:'flex'}}><svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round'><line x1='18' y1='6' x2='6' y2='18'/><line x1='6' y1='6' x2='18' y2='18'/></svg></span>
                </div>
              )})}
            </div>
          </div>
        </div>
        )
      })()}

      {/* ESTADO DEL NEGOCIO — embudo Vender→Facturar→Cobrar→Ganar. Reusa fuentes únicas (metricasAnio, ingresosPorAnioVenta, aging, costos). */}
      {(m.bruto>0||resAnio.ing>0)&&(()=>{
        const ingYTD=ingresosPorAnioVenta.total||0
        const comisYTD=comisPagadasAnioVenta.total||0                    // comisiones PAGADAS del año por ventas propias (base caja) — se restan
        const percYTD=ingresosPorAnioVenta.percibidas||0                  // comisiones PERCIBIDAS (nuestro % de facturas por cuenta de terceros) — se suman
        const ingReal=ingYTD-comisYTD+percYTD                             // Ingreso real = cobrado propio − comisiones pagadas + comisiones percibidas
        const ventaPct=metaUF>0?Math.round(m.brutoUF/metaUF*100):0   // sin tope: si supera la meta muestra el sobrecumplimiento (ej. 103%)
        const ventaNetoPct=metaUF>0?Math.round(m.netoUF/metaUF*100):0   // venta NETA (neto de comisiones) vs la MISMA meta
        const factPct=m.bruto>0?Math.min(100,Math.round(resAnio.fac/m.bruto*100)):0
        // Cifras del año en UF con la UF del DÍA de cada movimiento (ufDelDia); en CLP, los pesos tal cual. mRes = cifras de la cascada del resultado.
        const mRes=(k,abs)=>{ const v=(dashMoneda==='UF'?resAnio.verUF:resAnio.verCLP)[k]||0, x=abs?Math.abs(v):v; return dashMoneda==='UF'?fmtUFk(x):fmtShort(x) }
        const ingYTDUF=ingresosPorAnioVenta.totalUF||0, comisYTDUF=comisPagadasAnioVenta.totalUF||0, percYTDUF=ingresosPorAnioVenta.percibidasUF||0, ingRealUF=ingYTDUF-comisYTDUF+percYTDUF
        const fmtMonD=(v,iso)=>dashMoneda==='UF'?fmtUFk(Math.round((Number(v)||0)/ufDelDia(ufDias,iso,ufRef))):fmtShort(v)
        const cobroPct=metaCobranza>0?Math.round(ingYTD/metaCobranza*100):0   // sin tope: si supera la meta muestra el sobrecumplimiento (ej. 103%), igual que ventaPct
        return (<>
          <div style={{padding:'14px 22px 0',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div style={{display:'flex',alignItems:'center',gap:6,position:'relative'}}>
              <span style={{fontSize:9,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:'.5px',whiteSpace:'nowrap'}}>Resultado del año</span>
              <button onClick={()=>setYearMenu(o=>!o)} style={{display:'inline-flex',alignItems:'center',gap:3,background:'none',border:'none',padding:0,cursor:'pointer',fontSize:9,fontWeight:700,color:C.accent,textTransform:'uppercase',letterSpacing:'.5px'}}>{selYear}<span style={{fontSize:8,color:C.textSoft}}><Gl n='chevD'/></span></button>
              {yearMenu&&(
                <div style={{position:'absolute',left:0,top:'calc(100% + 4px)',background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,boxShadow:'0 8px 24px rgba(0,0,0,.12)',zIndex:20,overflow:'hidden',minWidth:70}}>
                  {aniosDisponibles.map(y=>(<button key={y} onClick={()=>{setSelYear(y);setYearMenu(false)}} style={{display:'block',width:'100%',textAlign:'left',padding:'7px 14px',border:'none',background:y===selYear?C.azulBg:'#fff',color:y===selYear?C.accent:C.text,fontSize:12,fontWeight:y===selYear?600:500,cursor:'pointer'}}>{y}</button>))}
                </div>
              )}
              {/* UF/CLP: cambia la moneda de estas cifras (antes iba junto a «Accesos directos») */}
              <div style={{display:'inline-flex',background:'#fff',border:`1px solid ${C.border}`,borderRadius:20,padding:2,marginLeft:4}}>
                {['UF','CLP'].map(u=>{ const on=dashMoneda===u; return <span key={u} onClick={()=>setDashMoneda(u)} style={{fontSize:10,fontWeight:700,color:on?'#fff':C.done,background:on?C.accent:'transparent',borderRadius:18,padding:'3px 9px',cursor:'pointer',lineHeight:1}}>{u}</span> })}
              </div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
              <button onClick={descargarResultado} title="Descargar imagen" aria-label="Descargar imagen" style={{display:'inline-flex',alignItems:'center',background:'none',border:'none',padding:0,cursor:'pointer',color:C.accent}}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              </button>
              <button onClick={imprimirResultado} title="Imprimir informe" aria-label="Imprimir informe" style={{display:'inline-flex',alignItems:'center',background:'none',border:'none',padding:0,cursor:'pointer',color:C.accent}}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
              </button>
              <span onClick={()=>go('sales')} style={{fontSize:9,fontWeight:700,color:C.azulInfo,cursor:'pointer',whiteSpace:'nowrap'}}><span className='fecha-full'>Ver detalle</span><span className='fecha-short'>Detalle</span> <Gl n='chevron'/></span>
            </div>
          </div>
          <div style={{padding:'6px 20px 0'}}>
            {/* Embudo Vender→Facturar→Cobrar→Ganar. Recuadro con color; textos gris; cifra y % en azul (unificado). Cifra = 1 solo texto (UF/$ mismo tamaño). % con rótulo de su denominador. Todo clickeable → panel. */}
            {(()=>{
              // Icono por etapa (coherente con los indicadores de abajo). stroke=currentColor toma el color del cuadro.
              const ICO={
                vend:<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/></svg>,
                fact:<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
                cob:<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/></svg>,
                marg:<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>,
              }
              // Tarjeta: icono a la izquierda; título, cifra y "% · rótulo" alineados en columna (el % va BAJO la cifra, no rompe en escritorio).
              const kpiTile=(key,label,bg,bd,icoBg,icoCol,fig,pct,cap)=>(
                <div key={key} onClick={()=>setResDrill(d=>d&&d.tile===key?null:{tile:key,year:null})} style={{background:bg,border:`1px solid ${resDrill?.tile===key?C.accent:bd}`,borderRadius:12,padding:'12px 13px',cursor:'pointer',display:'flex',gap:10,alignItems:'flex-start',boxShadow:resDrill?.tile===key?`0 0 0 1px ${C.accent} inset`:'none'}}>
                  <span style={{width:30,height:30,borderRadius:8,background:icoBg,color:icoCol,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{ICO[key]}</span>
                  <div style={{minWidth:0,flex:1}}>
                    <div style={{...SEC_LBL,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{label}</div>
                    <div style={{fontSize:22,fontWeight:800,color:C.accent,letterSpacing:'-.5px',lineHeight:1,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap',marginTop:5}}>{fig}</div>
                    {pct!=null&&<div style={{fontSize:10,color:C.muted,marginTop:5,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}><b style={{color:C.accent,fontWeight:800}}>{pct}%</b> {cap}</div>}
                  </div>
                </div>
              )
              return (<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:8}}>
                {m.bruto>0 && kpiTile('vend','Vendido','#EAF2FB','#D5E6F6','#D5E6F6',C.azulInfo, vMon(m.brutoUF,m.bruto), m.meta>0?ventaPct:null,'de la meta')}
                {kpiTile('fact','Facturado','#FDF4E2','#F5E6C6','#F1DFBB','#A8660F', mRes('fac'), m.bruto>0?factPct:null,'de lo vendido')}
                {kpiTile('cob','Cobrado','#E6F6EF','#CDEBDD','#CDEBDD',C.greenText, vMon(ingYTDUF,ingYTD), metaCobranza>0?cobroPct:null,'de la meta')}
                {resAnio.ing>0 && kpiTile('marg','Margen','#EDF1F4','#DCE4EA','#DCE4EA',C.accent, (resAnio.res<0?'−':'')+mRes('res',true), pct1(resAnio.pct),'sobre los ingresos')}
              </div>)
            })()}
            {resDrill&&(()=>{
              const t=resDrill.tile
              const cn = cid => (clients.find(c=>String(c.id)===String(cid))||{}).name || 'Sin cliente'
              const openYear = y => setResDrill(d=>({...d, year: d.year===y?null:y}))
              const box={margin:'9px 0 2px',background:C.tileBg,border:`1px solid ${C.tileLine}`,borderRadius:12,overflow:'hidden'}   // mismo fondo que las tarjetas de Finanzas · gestión (contraste con la página)
              const R={display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,padding:'10px 14px',borderTop:`1px solid ${C.border}`}
              const RC={...R,cursor:'pointer'}
              // ADN de fila único (mismo tamaño/peso en los 4 paneles; el COLOR de la cifra solo por rol):
              const rowL={fontSize:13,fontWeight:600,color:C.muted}                                   // etiqueta gris
              const rowV={fontSize:13,fontWeight:800,color:C.accent,fontVariantNumeric:'tabular-nums',flexShrink:0} // cifra neutra/subtotal (azul marino)
              const vPos={...rowV,color:C.greenText}                                                     // neto/positivo (verde)
              const vNeg={...rowV,color:C.overdueText}                                                   // resta (rojo)
              const lbYr={fontSize:13,fontWeight:800,color:C.accent}                                   // protagonista de fila (año)
              // Hero PARTIDO de los 4 paneles (Vendido/Facturado/Cobrado/Margen), cada mitad con su %. Fondo/color de la tarjeta.
              // Tonos = color de su tarjeta: az Vendido · gr Cobrado · am Facturado · gy Margen. bS/nS = texto tras el % (por defecto «de la meta»).
              const HeroSplit=({tone,cap,bK,bV,bP,nK,nV,nP,bS='de la meta',nS='de la meta',nCol})=>{
                const TN={az:[C.azulBg,'#D5E6F6',C.azulInfo,C.azulInfo,C.accent],gr:[C.greenBg,C.greenBd,C.greenText,C.normal,C.greenText],am:['#FDF4E2','#F5E6C6','#A8660F','#A8660F',C.soonText],gy:['#EDF1F4','#DCE4EA',C.accent,C.muted,C.accent]}
                const [bg,bd,capC,colB,colN0]=TN[tone]||TN.gr, colN=nCol||colN0
                const half=(k,v,p,col,brd,suf)=>(<div style={{flex:1,minWidth:0,...(brd?{borderLeft:`1px solid ${bd}`,paddingLeft:14}:{})}}>
                  <div style={{...SEC_LBL}}>{k}</div>
                  <div style={{fontSize:22,fontWeight:800,letterSpacing:'-.5px',lineHeight:1,margin:'3px 0 4px',color:col,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{v}</div>
                  {p!=null&&<div style={{fontSize:11,color:C.muted}}><b style={{color:col,fontWeight:800}}>{p}%</b> {suf}</div>}
                </div>)
                return (<div style={{padding:'12px 15px',background:bg}}>
                  <div style={{fontSize:10,fontWeight:800,textTransform:'uppercase',letterSpacing:'.5px',color:capC}}>{cap}</div>
                  <div style={{display:'flex',marginTop:8}}>{half(bK,bV,bP,colB,false,bS)}{half(nK,nV,nP,colN,true,nS)}</div>
                </div>) }
              const metaBand=(l,pctV,val)=>(<div style={{...R,background:C.azulBg}}><span style={{fontSize:13,fontWeight:700,color:C.accent}}>{l} <span style={{background:C.azulInfo,color:'#fff',fontSize:9.5,fontWeight:700,borderRadius:20,padding:'2px 8px',marginLeft:4,whiteSpace:'nowrap'}}>{pctV}%</span></span><span style={{...rowV,color:C.azulInfo}}>{val}</span></div>)
              const verlink=(txt,dest)=>(<div onClick={()=>go(dest)} style={{...RC,justifyContent:'center',color:C.azulInfo,fontWeight:700,fontSize:12}}>{txt} <Gl n='chevron'/></div>)
              // Lista de comisiones pagadas del año (base caja), para "ver los pagos" dentro del panel
              const comisPagos=(terceros||[]).filter(x=>x&&x.estado==='pagado'&&x.comision_pct==null&&String(x.pagado_at||'').startsWith(String(selYear))).sort((a,b)=>String(b.pagado_at||'').localeCompare(String(a.pagado_at||'')))
              // Fila desplegable en GRILLA (render Y5ryxK17d6iscXhLYzBnbN, opción A): etiqueta | % | flecha | cifra — mismas columnas en todo el panel, cifra al final.
              const GC=isDeskRes?'minmax(0,1fr) 130px 10px 90px':'minmax(0,1fr) 38px 10px 70px'
              const filaG=(key,onClick,label,pill,val,valSt,open)=>(<div key={key} onClick={onClick} style={{display:'grid',gridTemplateColumns:GC,columnGap:6,alignItems:'center',padding:'10px 14px',borderTop:`1px solid ${C.border}`,cursor:'pointer'}}>
                <span style={{gridColumn:pill?'1 / 2':'1 / 3',minWidth:0,display:'flex',alignItems:'baseline',gap:6,whiteSpace:'nowrap',overflow:'hidden'}}>{label}</span>
                {pill&&<span style={{justifySelf:'end'}}>{pill}</span>}
                <span style={{color:C.textSoft,display:'flex',justifyContent:'center'}}><Chev open={open}/></span>
                <span style={{...valSt,justifySelf:'end',whiteSpace:'nowrap'}}>{val}</span>
              </div>)
              // CASCADA (18-10, regla «aperturas aritméticas»): signo | etiqueta | píldora | flecha | cifra. Se lee como suma; las partes
              // visibles suman el total (cuadra → redondearPartes). kind: neg (resta, rojo) · tot (subtotal) · res (resultado) · sub (detalle chico).
              const cxR=({k,...p})=><CxRow key={k||String(p.label)} isDesk={isDeskRes} {...p}/>
              const capR=(txt,line)=>(<div style={{padding:'12px 14px 6px',...SEC_LBL,fontWeight:800,color:C.accent,borderTop:line?`1px solid ${C.border}`:undefined}}>{txt}</div>)
              const pctX=(p,suf)=>p!=null&&<span style={{fontSize:11,fontWeight:500,color:C.muted,marginLeft:2}}><b style={{color:C.accent,fontWeight:800}}>{p}%</b>{isDeskRes?` ${suf}`:''}</span>   // en el teléfono solo el % (la tarjeta ya dice de qué)
              // Cifras de una cascada en la moneda del panel. pares=[[uf,clp],…] (con signo) → sumas que cuadran; fijos = índices que también se ven en otra tarjeta.
              const cuadra=(pares,fijos=[])=>{ const enUF=dashMoneda==='UF', paso=enUF?1:1e5, v=redondearPartes(pares.map(p=>Number(enUF?p[0]:p[1])||0),paso,fijos), f=x=>enUF?fmtUFk(Math.abs(x)):fmtMillLR(Math.abs(x)), tv=v.reduce((a,x)=>a+x,0); return {s:v.map(f), tot:(tv<0?'−':'')+f(tv), neg:tv<0} }
              const comisChip=filaG('cp',e=>{e.stopPropagation();setResComis(v=>!v)},<span style={rowL}>Comisiones pagadas</span>,null,`− ${vMon(comisYTDUF,comisYTD)}`,vNeg,resComis)
              // Comisiones percibidas: nuestro % de las facturas emitidas por cuenta de un externo, al cobrarse (tocar → cliente)
              const percItems=(ingresosPorAnioVenta.percList||[]).slice().sort((a,b)=>String(b.paid_at||'').localeCompare(String(a.paid_at||'')))
              const percChip=filaG('pc',e=>{e.stopPropagation();setResPerc(v=>!v)},<span style={rowL}>Comisiones percibidas</span>,null,`+ ${vMon(percYTDUF,percYTD)}`,vPos,resPerc)
              const subFila=(k,cid,txt,val,col,onClick)=>(<div key={k} onClick={onClick} style={{display:'flex',justifyContent:'space-between',gap:10,padding:'6px 13px 6px 24px',fontSize:11,background:C.bgSoft,borderTop:`1px solid ${C.border}`,cursor:onClick?'pointer':'default'}}><span style={{minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:C.text}}>{txt}</span><span style={{fontWeight:700,color:col,flexShrink:0,fontVariantNumeric:'tabular-nums'}}>{val}</span></div>)
              const rxIt=(k,cid,fecha,folio,extra,val,col)=>(<div key={k} onClick={()=>cid&&onOpenClientFicha&&onOpenClientFicha(cid)} style={{display:'flex',alignItems:'center',gap:10,padding:isDeskRes?'7px 14px 7px 30px':'7px 14px 7px 22px',borderTop:`1px solid ${C.border}`,background:C.bgSoft,cursor:'pointer'}}>
                <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:700,color:C.accent,lineHeight:1.25,overflowWrap:'anywhere'}}>{cn(cid)}</div><div style={{fontSize:10.5,color:C.textSoft,fontWeight:600,whiteSpace:'nowrap'}}>{fecha?fmtFechaDMY(fecha):'—'}{folio?` · F${folioN(folio)||folio}`:''}{extra?` · ${extra}`:''}</div></div>
                <span style={{fontSize:12,fontWeight:800,color:col,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fmt(Math.round(val))}</span></div>)
              const percList = resPerc && <>{percItems.map(it=>rxIt(it.id,it.client_id,it.paid_at,it.folio,null,it._cobrado,C.greenText))}
                {rexDet.tot>=1&&<div onClick={e=>{e.stopPropagation(); setResRex(true); setResRexL('pend'); setResDrill({tile:'marg',year:null})}} style={{display:'flex',justifyContent:'space-between',gap:10,padding:isDeskRes?'8px 14px 8px 30px':'8px 14px 8px 22px',borderTop:`1px solid ${C.border}`,background:C.bgSoft,fontSize:11.5,color:C.azulInfo,fontWeight:700,cursor:'pointer'}}><span style={{minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>de {fmt(Math.round(rexDet.tot))} facturada · {rexDet.tPend>=1?`${fmt(Math.round(rexDet.tPend))} por cobrar`:'toda cobrada'}</span><Gl n='chevron'/></div>}</>
              const comisList = resComis && comisPagos.slice(0,30).map((x,i)=>{ const mes=x.pagado_at?mesCorto(x.pagado_at+'T12:00'):''; return (
                <div key={x.id||i} style={{display:'flex',justifyContent:'space-between',gap:10,padding:'6px 13px 6px 24px',fontSize:11,background:C.bgSoft,borderTop:`1px solid ${C.border}`}}><span style={{minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:C.text}}>{x.proveedor||'Colaborador'}{mes?` · ${mes}`:''}</span><span style={{fontWeight:700,color:C.overdueText,flexShrink:0,fontVariantNumeric:'tabular-nums'}}>{fmtMonD(Number(x.monto)||0,x.pagado_at)}</span></div>) })

              // VENDIDO — neto de comisiones (devengadas) + meta/falta
              if(t==='vend'){
                // Bruto − Costos de terceros = Neto; y la meta: Meta − Bruto = Falta (o Bruto − Meta = Sobre). Meta en UF con la UF promedio de lo vendido.
                const A=cuadra([[m.netoUF,m.neto],[m.costoUF,m.costo]])   // neto + costo = bruto (el total es la tarjeta)
                const sobre=m.bruto>=m.meta
                const M = sobre ? cuadra([[metaUF,m.meta],[m.brutoUF-metaUF,m.bruto-m.meta]]) : cuadra([[m.brutoUF,m.bruto],[metaUF-m.brutoUF,m.meta-m.bruto]],[0])
                return (<div style={box}>
                  {capR(`Resultado de ventas ${selYear}`)}
                  {cxR({label:'Vendido bruto',val:A.tot,onClick:()=>go('sales')})}
                  {m.costo!==0&&cxR({sg:'−',label:'Costos de terceros',val:A.s[1],kind:'neg',onClick:()=>go('proveedores')})}
                  {cxR({sg:'=',label:'Vendido neto',extra:m.meta>0&&pctX(ventaNetoPct,'de la meta'),val:A.s[0],kind:'res',onClick:()=>go('sales')})}
                  {m.meta>0&&<>
                    {capR(`Meta ${selYear}`,true)}
                    {sobre ? <>
                      {cxR({label:'Vendido bruto',val:M.tot,kind:'sub',onClick:()=>go('sales')})}
                      {cxR({sg:'−',label:'Meta del año',val:M.s[0],kind:'sub',onClick:()=>go('sales')})}
                      {cxR({sg:'=',label:'Sobre la meta',extra:pctX(ventaPct,'cumplido'),val:M.s[1],kind:'tot',onClick:()=>go('sales')})}
                    </> : <>
                      {cxR({label:'Meta del año',val:M.tot,kind:'sub',onClick:()=>go('sales')})}
                      {cxR({sg:'−',label:'Vendido bruto',val:M.s[0],kind:'sub',onClick:()=>go('sales')})}
                      {cxR({sg:'=',label:'Falta para la meta',extra:pctX(ventaPct,'cumplido'),val:M.s[1],kind:'tot',onClick:()=>go('sales')})}
                    </>}
                  </>}
                  {verlink('Ver todo en Ventas','sales')}
                </div>)
              }
              // MARGEN — cascada Cobrado − Comisiones − Costos de oficina = Margen
              if(t==='marg'){
                // Cascada lineal (18-10): se lee como una suma, de arriba abajo. Cifras de resAnio.ver* = redondeadas para que las partes
                // sumen el total visible (Facturado + Subarriendo + Comisión de externos = Ingresos; − Costos − Comisiones = Margen).
                const lin=(sg,lab,val,kind,onClick,extra)=>cxR({k:lab,sg,label:lab,val,extra,onClick,kind:(kind==='res'&&resAnio.res<0)?'resNeg':kind})
                const verL=<span style={{fontSize:10,color:C.azulInfo,fontWeight:700}}>ver <Gl n='chevron'/></span>
                const pctL=resAnio.pct!=null&&pctX(pct1(resAnio.pct),'sobre los ingresos')
                return (<div style={box}>
                  <div style={{padding:'12px 14px 6px',...SEC_LBL,fontWeight:800,color:C.accent}}>Resultado del ejercicio {selYear}</div>
                  {lin('','Facturado',mRes('fac'),null,()=>setResDrill({tile:'fact',year:null}))}
                  {resAnio.sub!==0&&lin('+','Subarriendo',mRes('sub'),null,()=>go('subarriendo'))}
                  {resAnio.rex!==0&&cxR({k:'rex',sg:'+',label:'Comisión de externos',val:mRes('rex'),onClick:()=>setResRex(v=>!v),open:resRex})}
                  {resAnio.rex!==0&&resRex&&<>
                    {rexDet.tCob>=1&&cxR({k:'rexc',label:'Cobrada · '+rexDet.cob.length+(rexDet.cob.length===1?' factura':' facturas'),val:fmt(Math.round(rexDet.tCob)),kind:'sub',onClick:()=>setResRexL(l=>l==='cob'?null:'cob'),open:resRexL==='cob'})}
                    {resRexL==='cob'&&rexDet.cob.map(x=>rxIt('rc'+x.b.id,x.b.client_id,x.b.paid_at||x.b.issued_at,x.b.invoice_no,null,x.cob,C.greenText))}
                    {rexDet.tPend>=1&&cxR({k:'rexp',label:'Por cobrar · '+rexDet.pend.length+(isDeskRes?(rexDet.pend.length===1?' factura':' facturas'):''),pill:rexDet.nVenc>0&&<span style={{fontSize:9.5,fontWeight:700,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap',color:C.overdueText,background:C.overdueBg}}>{rexDet.nVenc} vencida{rexDet.nVenc!==1?'s':''}</span>,val:fmt(Math.round(rexDet.tPend)),kind:'sub',onClick:()=>setResRexL(l=>l==='pend'?null:'pend'),open:resRexL==='pend'})}
                    {resRexL==='pend'&&rexDet.pend.map(x=>rxIt('rp'+x.b.id,x.b.client_id,x.b.issued_at,x.b.invoice_no,x.b.status==='Vencido'?'vencida':'por vencer',x.pend,C.accent))}
                  </>}
                  {lin('=','Ingresos',mRes('ing'),'tot',onOpenEstadoResultados||null)}
                  {lin('−','Costos de operación',mRes('cos'),'neg',()=>go('presupuestoOficina'),verL)}
                  {resAnio.com!==0&&lin('−','Comisiones pagadas',mRes('com'),'neg',()=>go('proveedores'))}
                  {lin('=',resAnio.res>=0?'Margen':'Pérdida',(resAnio.res<0?'−':'')+mRes('res',true),'res',onOpenEstadoResultados||null,pctL)}
                  {onOpenEstadoResultados&&<div onClick={onOpenEstadoResultados} style={{...RC,justifyContent:'center',color:C.azulInfo,fontWeight:700,fontSize:12}}>Ver estado de resultados <Gl n='chevron'/></div>}
                </div>)
              }
              // COBRADO / FACTURADO — año de venta → clientes (por fecha), ordenable
              const isCob=t==='cob'
              const g = isCob?ingresosPorAnioVenta:facturadoByYear
              const byYear=g.byYear||{}, byYearUF=g.byYearUF||{}, listByYear=g.listByYear||{}
              const yrs=Object.keys(byYear).map(Number).sort((a,b)=>(b||-1)-(a||-1))   // «sin venta» (0) al final
              const montoOf = it => isCob?(Number(it._cobrado)||0):montoFactura(it)
              const dateOf = it => isCob?it.paid_at:(it.issued_at||it.due)
              const sinCob = isCob&&(ingresosPorAnioVenta.sinMonto||0)>0   // cobrado sin año de venta: también suma al total
              const anyOpen = yrs.some(y=>resDrill.year===y) || (sinCob&&resDrill.year==='sin')
              // Años de la venta → = Facturado propio / Cobrado propio (las filas suman el total). Cada año abre sus documentos.
              const Y=cuadra([...yrs.map(y=>[byYearUF[y]||0,byYear[y]||0]), ...(sinCob?[[ingresosPorAnioVenta.sinMontoUF||0,ingresosPorAnioVenta.sinMonto]]:[])])
              const filaDocs=(key,items)=>{ items=items.slice(); items.sort((a,b)=> resOrd==='monto' ? (montoOf(b)-montoOf(a)) : String(dateOf(b)||'').localeCompare(String(dateOf(a)||''))); const seeAll=resSeeAll[key]; const shown=seeAll?items:items.slice(0,6)
                return (<>{shown.map(it=>{ const cid=it.client_id; const folio=isCob?it.folio:it.invoice_no; return (
                  <div key={it.id||it.invoice_no} onClick={()=>cid&&onOpenClientFicha&&onOpenClientFicha(cid)} style={{display:'flex',alignItems:'center',gap:11,padding:'8px 14px',borderTop:`1px solid ${C.border}`,background:C.bgSoft,cursor:'pointer'}}>
                    {bigDate(dateOf(it))}
                    <div style={{flex:1,minWidth:0}}><div style={{...NOMBRE_CLI}}>{cn(cid)}</div><div style={{fontSize:10,color:C.textSoft,fontWeight:600}}>{folio?`Factura N° ${folioN(folio)||folio}`:(it._esAnticipo?'anticipo':(it.concept||''))}</div></div>
                    <span style={{...rowV,fontSize:13}}>{fmtMonD(montoOf(it),dateOf(it))}</span>
                  </div>) })}
                  {items.length>6&&<div onClick={()=>setResSeeAll(s=>({...s,[key]:!s[key]}))} style={{textAlign:'center',padding:9,fontSize:11,fontWeight:700,color:C.azulInfo,background:C.bg,borderTop:`1px solid ${C.border}`,cursor:'pointer'}}>{seeAll?'Ver menos':`Ver las ${items.length} ›`}</div>}</>) }
              const fe=facturadoEmitido, propioUF=yrs.reduce((a,y)=>a+(byYearUF[y]||0),0), otros=Math.max(0,fe.total-facturadoYr-facturadoTerceros.total-fe.reemb-fe.subarr), otrosUF=Math.max(0,fe.totalUF-propioUF-(facturadoTerceros.totalUF||0)-fe.reembUF-fe.subarrUF)
              return (<div style={box}>
                {capR(isCob?`Resultado cobrado ${selYear}`:`Resultado facturado ${selYear}`)}
                {anyOpen&&(<div style={{display:'flex',alignItems:'center',gap:6,padding:'0 14px 8px'}}><span style={{fontSize:9,fontWeight:800,color:C.textSoft,textTransform:'uppercase',letterSpacing:'.4px',marginRight:'auto'}}>Orden</span><span style={{display:'inline-flex',background:C.surface,border:`1px solid ${C.border}`,borderRadius:14,padding:2}}>{['fecha','monto'].map(o=>(<span key={o} onClick={()=>setResOrd(o)} style={{fontSize:10,fontWeight:800,padding:'2px 10px',borderRadius:12,cursor:'pointer',color:resOrd===o?'#fff':C.muted,background:resOrd===o?C.accent:'transparent'}}>{o==='fecha'?'Fecha':'Monto'}</span>))}</span></div>)}
                {yrs.map((y,i)=>{ const open=resDrill.year===y
                  // % de lo vendido de ESE año (fuente única metricasAnio.bruto, CLP; mismo plano que byYear). Tono por nivel.
                  const vY = y ? (metricasAnio(y).bruto||0) : 0
                  const pctV = (y && vY>0) ? Math.round((byYear[y]||0)/vY*100) : null
                  const pTone = pctV==null ? {c:C.muted,bg:C.bgSoft} : pctV>=60 ? {c:C.greenText,bg:C.greenBg} : pctV>=40 ? {c:C.azulInfo,bg:C.azulBg} : {c:C.coralText,bg:C.ambarBg}
                  const pill = y ? <span style={{fontSize:9.5,fontWeight:700,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap',color:pTone.c,background:pTone.bg}}>{pctV==null?'—':(isDeskRes?`${pctV}% de lo vendido`:`${pctV}%`)}</span> : null
                  return (<Fragment key={y}>
                    {cxR({k:'y'+y,sg:i?'+':'',label:y?`De ventas ${y}`:'Sin venta asociada',pill,val:Y.s[i],onClick:()=>openYear(y),open})}
                    {open&&filaDocs(`${t}-${y}`,listByYear[y]||[])}
                  </Fragment>) })}
                {sinCob&&<>{cxR({k:'ysin',sg:yrs.length?'+':'',label:'Sin venta asociada',val:Y.s[yrs.length],onClick:()=>openYear('sin'),open:resDrill.year==='sin'})}{resDrill.year==='sin'&&filaDocs(`${t}-sin`,ingresosPorAnioVenta.sinList||[])}</>}
                {isCob ? (()=>{ const B=cuadra([[ingYTDUF,ingYTD],[percYTDUF,percYTD],[-comisYTDUF,-comisYTD]],[0,2]), iv=ingresosPorAnioVenta
                    const K=cuadra([[iv.totalUF||0,iv.total||0],[iv.cajaExtUF||0,iv.cajaExt||0],[iv.cajaReembUF||0,iv.cajaReemb||0],[iv.cajaSubarrUF||0,iv.cajaSubarr||0]],[0])
                    return (<>
                      {cxR({k:'cp',sg:'=',label:'Cobrado propio',extra:metaCobranza>0&&pctX(cobroPct,'de la meta'),val:Y.tot,kind:'tot',onClick:()=>go('cobranza')})}
                      {percYTD>0&&cxR({k:'pc',sg:'+',label:'Comisiones percibidas',val:B.s[1],onClick:()=>setResPerc(v=>!v),open:resPerc})}
                      {percList}
                      {comisYTD>0&&cxR({k:'cpg',sg:'−',label:'Comisiones pagadas',val:B.s[2],kind:'neg',onClick:()=>setResComis(v=>!v),open:resComis})}
                      {comisList}
                      {cxR({k:'ir',sg:'=',label:'Ingreso real',extra:metaCobranza>0&&pctX(Math.round(ingReal/metaCobranza*100),'de la meta'),val:B.tot,kind:B.neg?'resNeg':'res',onClick:()=>go('cobranza')})}
                      {(iv.totalCaja||0)>(iv.total||0)&&<>
                        {capR('Total a caja',true)}
                        {cxR({k:'tc0',label:'Cobrado propio',val:K.s[0],kind:'sub',onClick:()=>go('cobranza')})}
                        {(iv.cajaExt||0)>0&&cxR({k:'tc1',sg:'+',label:'Por cuenta de terceros',val:K.s[1],kind:'sub',onClick:()=>go('proveedores')})}
                        {(iv.cajaReemb||0)>0&&cxR({k:'tc2',sg:'+',label:'Reembolsos de gastos',val:K.s[2],kind:'sub',onClick:()=>go('expenses')})}
                        {(iv.cajaSubarr||0)>0&&cxR({k:'tc3',sg:'+',label:'Subarriendo',val:K.s[3],kind:'sub',onClick:()=>go('subarriendo')})}
                        {cxR({k:'tct',sg:'=',label:'Total a caja',val:K.tot,kind:'tot',onClick:()=>go('conciliacion')})}
                      </>}
                    </>) })()
                  : (()=>{ const E=cuadra([[propioUF,facturadoYr],[facturadoTerceros.totalUF||0,facturadoTerceros.total],[fe.reembUF,fe.reemb],[fe.subarrUF,fe.subarr],[otrosUF,otros]],[0])
                    return (<>
                      {cxR({k:'fp',sg:'=',label:'Facturado propio',extra:m.bruto>0&&isDeskRes&&pctX(factPct,'de lo vendido'),val:Y.tot,kind:'tot',onClick:()=>go('billing')})}
                      {fe.total>facturadoYr&&<>
                        {facturadoTerceros.total>0&&cxR({k:'e1',sg:'+',label:'Por cuenta de terceros',val:E.s[1],onClick:()=>go('proveedores')})}
                        {fe.reemb>0&&cxR({k:'e2',sg:'+',label:'Reembolsos de gastos',val:E.s[2],onClick:()=>go('billing')})}
                        {fe.subarr>0&&cxR({k:'e3',sg:'+',label:'Subarriendo',val:E.s[3],onClick:()=>go('subarriendo')})}
                        {otros>0&&cxR({k:'e4',sg:'+',label:'Otros',val:E.s[4],onClick:()=>go('billing')})}
                        {cxR({k:'et',sg:'=',label:'Total emitido',val:E.tot,kind:'res',onClick:()=>go('billing')})}
                      </>}
                    </>) })()}
                {verlink(isCob?'Ver todo en Cobranza':'Ver todo en Facturación',isCob?'cobranza':'billing')}
              </div>)
            })()}
          </div>
        </>)
      })()}



      {tareasOpen&&(()=>{
        const activas=(tasks||[]).filter(t=>t.status!=='Terminado')
        const orden=['Cristóbal','Erasmo','Martín','Martina','Rodrigo']
        const me=user?.name
        const corte=tareasCorte
        const base = corte==='delegaron' ? activas.filter(t=> taskAssignees(t).includes(me) && t.assigned_by && t.assigned_by!==me)
                   : corte==='delegue'  ? activas.filter(t=> t.assigned_by===me && taskAssignees(t).some(a=>a!==me))
                   : activas
        const groupKey = corte==='delegaron' ? (t=>[t.assigned_by||'—'])
                       : corte==='delegue'  ? (t=> taskAssignees(t).filter(a=>a!==me))
                       : (t=>{ const w=taskAssignees(t); return w.length?w:['Sin asignar'] })
        const porP={}
        base.forEach(t=>{ groupKey(t).forEach(w=>{ (porP[w]=porP[w]||[]).push(t) }) })
        const personas=Object.keys(porP).sort((a,b)=>{ const ia=orden.indexOf(a),ib=orden.indexOf(b); return (ia<0?99:ia)-(ib<0?99:ib)||a.localeCompare(b,'es') })
        const esVenc=t=>{ const d=daysLeft(t.due); return d!=null&&d<0 }
        const tone = d => d===C.overdue?{bg:'#FCEBEB',fg:C.overdueText}:d===C.soon?{bg:'#FAEEDA',fg:'#BA7517'}:d===C.normal?{bg:'#E1F5EE',fg:C.greenText}:{bg:C.bgWarm,fg:'#5F5E5A'}
        const chevSvg = <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.4' strokeLinecap='round' strokeLinejoin='round'><polyline points='6 9 12 15 18 9'/></svg>
        const sparkSvg = <svg width='17' height='17' viewBox='0 0 24 24' fill='currentColor'><path d='M12 2l1.7 5.6L19 9l-5.3 1.4L12 16l-1.7-5.6L5 9l5.3-1.4z'/></svg>
        const hoyIco = k => { const M={cash:<g><rect x='2.5' y='6' width='19' height='12' rx='2'/><circle cx='12' cy='12' r='2.6'/></g>,wallet:<g><rect x='3' y='6' width='18' height='13' rx='2.4'/><path d='M3 10h18'/></g>,file:<g><path d='M6 3h8l4 4v14H6z'/><path d='M14 3v4h4'/></g>,alert:<g><path d='M12 4l9 16H3z'/><path d='M12 10v4'/></g>,clock:<g><circle cx='12' cy='12' r='8.5'/><path d='M12 7.5V12l3 2'/></g>}; return <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.7' strokeLinecap='round' strokeLinejoin='round'>{M[k]||M.file}</svg> }
        return (
        <div onClick={onTareasClose} style={{position:'fixed',inset:0,background:'rgba(20,30,35,.45)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
          <div onClick={e=>e.stopPropagation()} style={{width:'100%',maxWidth:440,background:'#fff',borderRadius:18,maxHeight:'88vh',overflowY:'auto',padding:'16px 18px 22px',boxShadow:'0 12px 40px rgba(0,0,0,.18)'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
              <span style={{fontSize:19,fontWeight:500,color:C.accent,letterSpacing:-.3}}>Tareas</span>
              <div style={{display:'flex',alignItems:'center',gap:12}}>
                {onAddTask&&<button onClick={()=>{onTareasClose&&onTareasClose();onAddTask()}} style={{display:'inline-flex',alignItems:'center',gap:7,background:C.muted,color:'#fff',border:'none',borderRadius:20,padding:'7px 14px',fontSize:13,fontWeight:600,cursor:'pointer'}}><svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><rect x='5' y='4' width='14' height='17' rx='2'/><rect x='9' y='2.5' width='6' height='3.5' rx='1'/><path d='M8.5 11.5l1.5 1.5 3-3'/><line x1='8.5' y1='16' x2='15.5' y2='16'/></svg>Nueva tarea</button>}
                <span onClick={onTareasClose} style={{fontSize:21,color:C.muted,cursor:'pointer',lineHeight:1}}><Gl n='x'/></span>
              </div>
            </div>

            {atenderHoy.items.length>0&&(
              <div style={{display:'flex',alignItems:'center',gap:10,background:'#EEF4F8',borderRadius:12,padding:'10px 12px',marginBottom:16}}>
                <span style={{color:C.azulInfo,flexShrink:0,display:'inline-flex'}}>{sparkSvg}</span>
                <span style={{flex:1,fontSize:13,color:C.text,lineHeight:1.35}}>{iaHoy||atenderHoy.head}</span>
                <button onClick={resumenHoyIA} disabled={iaHoyBusy} style={{fontSize:11,fontWeight:600,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',whiteSpace:'nowrap',flexShrink:0,opacity:iaHoyBusy?.6:1}}>{iaHoyBusy?'…':(iaHoy?'Otra vez':'Resumen IA')}</button>
              </div>
            )}
            <div style={{...SEC_LBL,marginBottom:10}}>Hoy</div>
            {atenderHoy.items.length===0
              ? <div style={{fontSize:13,color:C.greenText,marginBottom:4}}>Todo al día — sin pendientes urgentes.</div>
              : <div style={{display:'flex',flexDirection:'column',gap:9}}>
                  {atenderHoy.items.map((it,i)=>{ const open=!!tareaHoyOpen[it.lbl]; const tn=tone(it.dot); return (
                    <div key={i} style={{border:`0.5px solid ${open?tn.fg:C.border}`,background:open?'#FCFBFA':'#fff',borderRadius:12,padding:'12px 13px'}}>
                      <div onClick={()=>setTareaHoyOpen(o=>({...o,[it.lbl]:!o[it.lbl]}))} style={{display:'flex',alignItems:'center',gap:12,cursor:'pointer'}}>
                        <span style={{width:37,height:37,borderRadius:12,background:tn.bg,color:tn.fg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{hoyIco(it.ico)}</span>
                        <div style={{flex:1,minWidth:0}}><div style={{fontSize:14,fontWeight:600,color:C.text}}>{it.lbl}</div><div style={{fontSize:11,color:C.muted}}>{it.sub}</div></div>
                        {it.amt&&<div style={{fontSize:16,fontWeight:600,color:C.accent,fontVariantNumeric:'tabular-nums',flexShrink:0}}>{it.amt}</div>}
                        <span style={{color:C.textSoft,flexShrink:0,transform:open?'rotate(180deg)':'none',transition:'transform .15s',display:'inline-flex'}}>{chevSvg}</span>
                      </div>
                      {open&&<div style={{margin:'11px 0 1px 49px',display:'flex',flexDirection:'column',gap:9}}>
                        {it.rows.map((r,j)=><div key={j} style={{display:'flex',justifyContent:'space-between',gap:10,fontSize:13}}><span onClick={r.cid?(ev=>{ev.stopPropagation();onOpenClientFicha&&onOpenClientFicha(r.cid)}):undefined} style={{color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',cursor:r.cid?'pointer':'default'}}>{r.name}</span>{r.val?<span style={{color:C.muted,fontVariantNumeric:'tabular-nums',flexShrink:0}}>{r.val}</span>:null}</div>)}
                        <span onClick={()=>{ if(it.onNav){it.onNav()} else {onTareasClose&&onTareasClose();go(it.go)} }} style={{fontSize:12,color:C.accent,fontWeight:600,cursor:'pointer'}}>{it.navLbl} →</span>
                      </div>}
                    </div>
                  )})}
                </div>}

            <div style={{height:0.5,background:C.track,margin:'18px 0 14px'}}/>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,flexWrap:'wrap',marginBottom:13}}>
              <span style={{fontSize:10,fontWeight:600,color:C.textSoft,textTransform:'uppercase',letterSpacing:.6}}>Equipo</span>
              {me&&<div style={{display:'flex',gap:6}}>
                {[['todas','Todas'],['delegaron','Me delegaron'],['delegue','Delegué']].map(([v,l])=>{ const on=corte===v; return <button key={v} onClick={()=>setTareasCorte(v)} style={{fontSize:11,fontWeight:500,borderRadius:20,padding:'4px 11px',cursor:'pointer',border:`0.5px solid ${on?C.accent:C.border}`,background:on?C.accent:'#fff',color:on?'#fff':C.muted}}>{l}</button> })}
              </div>}
            </div>
            {personas.length===0
              ? <div style={{fontSize:12,color:C.muted}}>{corte==='delegaron'?'No tienes tareas que te delegaron.':corte==='delegue'?'No has delegado tareas.':'Sin tareas activas.'}</div>
              : <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                  {personas.map(pn=>{ const arr=porP[pn]; const vn=arr.filter(esVenc).length; const pc=personChip(pn); const open=!!tareaPersOpen[pn]; return (
                    <span key={pn} onClick={()=>setTareaPersOpen(o=>({...o,[pn]:!o[pn]}))} title={pn} style={{display:'inline-flex',alignItems:'center',gap:7,background:open?pc.color:pc.bg,color:open?'#fff':pc.color,borderRadius:20,padding:'5px 7px 5px 12px',fontSize:13,fontWeight:500,cursor:'pointer'}}>
                      {pn}
                      <span style={{background:open?'rgba(255,255,255,.25)':(vn>0?C.overdue:pc.color),color:'#fff',borderRadius:10,minWidth:19,height:19,display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:600,padding:'0 5px'}}>{arr.length}</span>
                    </span>
                  )})}
                </div>}
            {personas.filter(pn=>tareaPersOpen[pn]).map(pn=>{
              const arr=porP[pn].slice().sort((a,b)=>{ const da=daysLeft(a.due),db=daysLeft(b.due); return (da==null?1e9:da)-(db==null?1e9:db) })
              const pc=personChip(pn)
              return (
                <div key={pn} style={{marginTop:13}}>
                  <span style={{fontSize:13,fontWeight:800,color:pc.color}}>{pn}</span>
                  {arr.map(t=>{ const cl=clients.find(c=>String(c.id)===String(t.client_id)); return (
                    <div key={t.id} onClick={()=>onPreviewTask&&onPreviewTask(t)} style={{display:'flex',alignItems:'center',gap:11,padding:'8px 0 8px 9px',borderTop:`1px solid #F2F5F7`,cursor:'pointer',marginTop:6}}>
                      {bigDate(t.due,urgencyColor(t.due,t.status))}
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.title}</div>
                        {(cl||t.project)&&<div style={{fontSize:10,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{cl?<span onClick={ev=>{ev.stopPropagation();onOpenClientFicha&&onOpenClientFicha(cl.id)}} style={{color:C.muted,fontWeight:600,cursor:'pointer'}}>{cl.name}</span>:''}{t.project?`${cl?' › ':''}${t.project}`:''}</div>}
                      </div>
                      <span onClick={e=>{e.stopPropagation();onCompleteTask&&onCompleteTask(t)}} title='Marcar terminada' style={{width:18,height:18,borderRadius:6,border:`1.5px solid #D7DEE3`,flexShrink:0,cursor:'pointer'}}/>
                    </div>
                  )})}
                </div>
              )
            })}
          </div>
        </div>
        )
      })()}


      {/* El rótulo 'Indicadores' viaja pegado a su primera fila de tiles (un solo hijo de .dash-cols) → no se orfana en otra columna del masonry. */}
      <div>
        {lvlLabel('Finanzas · gestión')}
        <div style={{padding:'6px 20px 0'}}>
          {/* Señales financieras — todas clickeables a su fuente. Resultado del mes y Flujo de caja abren su página; el resto navega o despliega. */}
          <div className='dash-fin' style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:8,alignItems:'stretch'}}>
            {/* Orden por pares (2026-10-17): el mes (Resultado · Emitido) → la caja (Flujo · Por cobrar) → el año (Proyección · Comisiones). Ícono propio por tarjeta; verde solo para lo bueno con signo. */}
            {kTile('resmes','Resultado del mes',(resMes>0?'+':'')+fmtShort(resMes),resMes>=0?C.greenText:C.overdueText,'chart',resMes>=0?{fg:C.greenText,bg:C.greenBg}:{fg:C.overdueText,bg:C.overdueBg},<><Gl n={resMesDif>=0?'arrowUp':'arrowDown'}/> {fmtShort(Math.abs(resMesDif))} vs {isDeskRes?'mes previo':MES_C[+_ymPrev(_ymNow).slice(5,7)-1]}</>,onOpenEstadoResultados)}
            {kTile('emitido','Emitido del mes',fmtShort(emFacTot),C.accent,'file',{fg:C.accent,bg:C.azulBg},emFacTot>0?`${emPct}% pagado`:'sin emitir aún',()=>onOpenEmitidoMes&&onOpenEmitidoMes())}
            {kTile('flujo','Flujo de caja',(flujoNeto8>0?'+':'')+fmtShort(flujoNeto8),flujoNeto8>=0?C.greenText:C.overdueText,'exchange',flujoNeto8>=0?{fg:C.greenText,bg:C.greenBg}:{fg:C.overdueText,bg:C.overdueBg},'neto · 8 semanas',onOpenFlujoCaja)}
            {kTile('cobranza','Por cobrar',fmtShort(totalPorCobrar),C.accent,'tCobrar',{fg:C.accent,bg:C.azulBg},vencMes>0?<span style={{color:C.overdueText,fontWeight:700}}>vencido {fmtShort(vencMes)}</span>:'del año',()=>go('cobranza'))}
            {kTile('proyeccion','Proyección',fmtShort(proyCobranza),C.accent,'clock',{fg:C.accent,bg:C.azulBg},`${isDeskRes?'cobranza ':''}al ${fmtFechaDMY(`${new Date().getFullYear()}-12-31`)}`)}
            {(terceros||[]).length>0&&(()=>{ const pagado=comisPagadasAnioVenta.totalTodo, porPagar=cxpTotDash
              // La cifra grande es lo accionable (por pagar, saldo vivo), igual que «Comisiones por pagar» en Oficina; lo pagado del año va debajo.
              const val=porPagar>0?fmtShort(porPagar):'Al día'
              const col=porPagar>0?C.soonText:C.greenText
              const tint=porPagar>0?{fg:C.soonText,bg:C.ambarBg}:{fg:C.greenText,bg:C.greenBg}
              const ant=comisPorPagarAnteriores(comisSaldo)
              const sub=ant?<span style={{color:C.soonText,fontWeight:700}}>{isDeskRes?'incluye ':''}{fmtShort(ant.monto)} de {ant.txt}</span>:isDeskRes?(pagado>0?`pagadas ${selYear} ${fmtShort(pagado)}`:`sin pagos en ${selYear}`):(porPagar>0?'por pagar':'sin deudas')
              return kTile('cxp',isDeskRes?'Comisiones por pagar':'Comisiones',val,col,'tPct',tint,sub,()=>navTo?navTo({tab:'proveedores'}):go('proveedores')) })()}
          </div>
        </div>
      </div>
      <div>
        {lvlLabel('Mi trabajo')}
        <div style={{padding:'6px 20px 0'}}>
          <div className='dash-fin' style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:8,alignItems:'stretch'}}>
            {kTile('misproy','Mis proyectos',String(mineProyN),C.accent,'briefcase',{fg:C.accent,bg:C.azulBg},'activos',()=>go('cartera'))}
            {kTile('mistareas','Mis tareas',String(tareasPendN),C.accent,'check',{fg:C.accent,bg:C.azulBg},cargaSemN>0?<>{isDeskRes?'pendientes · ':''}<span style={{color:C.soonText,fontWeight:700}}>{cargaSemN} esta semana</span></>:'pendientes',()=>go('tasks'))}
          </div>
        </div>
      </div>
      {kOpen('estemes')&&(()=>{ const emPorCob=emFacList.reduce((a,b)=>a+saldoBill(b),0), emPorCobN=emFacList.filter(b=>saldoBill(b)>0).length, opE=kOpen('estemes_emit'); return (
      <div style={{padding:'10px 20px 0'}}>
        <div style={{background:'#fff',border:'0.5px solid #E4E8EB',borderRadius:12,padding:'4px 4px'}}>
          {/* Categoría "Emitido" — se despliega a sus sub-totales Pagadas / Por cobrar (categorías, no listados). */}
          <div onClick={()=>kToggle('estemes_emit')} style={{padding:'11px 12px',cursor:'pointer'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span style={{display:'flex',alignItems:'center',gap:7,fontSize:13,fontWeight:700,color:C.text}}><span style={{color:C.accent,fontSize:11,transform:opE?'rotate(180deg)':'none',display:'inline-block',transition:'transform .2s'}}><Gl n='chevD'/></span>Emitido este mes</span>
              <span style={{fontSize:14.5,fontWeight:800,color:C.accent,fontVariantNumeric:'tabular-nums'}}>{fmtShort(emFacTot)}</span>
            </div>
            {opE&&<div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,margin:'10px 0 3px 20px'}}>
              <div onClick={e=>{e.stopPropagation();onOpenEmitidoMes&&emFacPagN>0&&onOpenEmitidoMes('pagadas')}} style={{background:C.greenBg,borderRadius:9,padding:'8px 10px',cursor:onOpenEmitidoMes&&emFacPagN>0?'pointer':'default',border:'1px solid #CDEBDD'}}><div style={{fontSize:10,color:C.greenText,fontWeight:700}}>Pagadas</div><div style={{fontSize:15,fontWeight:800,color:C.greenText,fontVariantNumeric:'tabular-nums'}}>{fmtShort(emFacPagTot)}</div><div style={{fontSize:9.5,color:C.muted,display:'flex',justifyContent:'space-between',alignItems:'center'}}><span>{emFacPagN} factura{emFacPagN!==1?'s':''}</span>{onOpenEmitidoMes&&emFacPagN>0&&<span style={{color:C.greenText,fontWeight:700}}>Ver <Gl n='chevron'/></span>}</div></div>
              <div onClick={e=>{e.stopPropagation();onOpenEmitidoMes&&emPorCobN>0&&onOpenEmitidoMes('porcobrar')}} style={{background:C.ambarBg||'#FFF8EC',borderRadius:9,padding:'8px 10px',cursor:onOpenEmitidoMes&&emPorCobN>0?'pointer':'default',border:'1px solid #EAD9A8'}}><div style={{fontSize:10,color:C.soonText,fontWeight:700}}>Por cobrar</div><div style={{fontSize:15,fontWeight:800,color:C.soonText,fontVariantNumeric:'tabular-nums'}}>{fmtShort(emPorCob)}</div><div style={{fontSize:9.5,color:C.muted,display:'flex',justifyContent:'space-between',alignItems:'center'}}><span>{emPorCobN} factura{emPorCobN!==1?'s':''}</span>{onOpenEmitidoMes&&emPorCobN>0&&<span style={{color:C.soonText,fontWeight:700}}>Ver <Gl n='chevron'/></span>}</div></div>
            </div>}
          </div>
          <div style={{height:1,background:C.track,margin:'0 12px'}}/>
          {/* Otras pagadas — cobros del mes de facturas de meses anteriores */}
          <div style={{padding:'11px 12px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span style={{fontSize:13,fontWeight:600,color:C.text}}>Otras pagadas <span style={{fontSize:11,color:C.muted,fontWeight:400}}>· de meses anteriores</span></span>
            <span style={{fontSize:14,fontWeight:700,color:C.greenText,fontVariantNumeric:'tabular-nums'}}>{fmtShort(emOtrasTot)}</span>
          </div>
          <div style={{height:1,background:C.track,margin:'0 12px'}}/>
          {/* Total ingresado en el mes */}
          <div style={{padding:'12px 12px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:'.04em'}}>Total ingresado en el mes</span>
            <span style={{fontSize:17,fontWeight:800,color:C.greenText,fontVariantNumeric:'tabular-nums'}}>{fmtShort(emTotalMes)}</span>
          </div>
        </div>
      </div>) })()}
      {kOpen('cobranza')&&(
      <div style={{padding:'10px 20px 0'}}>
        <div style={{background:'#fff',border:'0.5px solid #E4E8EB',borderRadius:12,padding:'1rem 1.25rem'}}>
          {/* Sin repetir el total ($60M ya está en el tile de arriba): el detalle arranca directo en los tramos de antigüedad. */}
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
            <span style={{fontSize:9,fontWeight:700,color:C.textSoft,textTransform:'uppercase',letterSpacing:'.05em'}}>Por antigüedad</span>
            <button onClick={()=>setTop5Open(o=>!o)} style={{display:'flex',alignItems:'center',gap:3,background:'none',border:'none',cursor:'pointer',color:C.muted,padding:0,fontSize:10,fontWeight:600,textTransform:'uppercase',letterSpacing:'.04em',flexShrink:0}}>Detalle <span style={{fontSize:12,transform:top5Open?'rotate(180deg)':'none',transition:'transform .2s'}}><Gl n='chevD'/></span></button>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
            {[['Al día','current',C.greenText,C.greenBg],['31-60 días','warning',C.soonText,C.ambarBg],['+60 días','overdue',C.overdueText,C.overdueBg]].map(([l,k,col,bg])=>{ const bk=agingData.buckets[k], abierto=agingBucket===k, vacio=bk.monto===0; return (
              <div key={k} onClick={()=>!vacio&&setAgingBucket(abierto?null:k)} style={{background:bg,borderRadius:10,padding:'9px 10px',cursor:vacio?'default':'pointer',border:`1px solid ${abierto?col:'transparent'}`,opacity:vacio?.55:1}}>
                <div style={{fontSize:16,fontWeight:700,color:col,lineHeight:1.05,fontVariantNumeric:'tabular-nums'}}>{fmtShort(bk.monto)}</div>
                <div style={{fontSize:9,fontWeight:600,color:col,opacity:.8,marginTop:1}}>{bk.pct}%</div>
                <div style={{fontSize:9,fontWeight:600,color:col,textTransform:'uppercase',letterSpacing:'.3px',marginTop:2}}>{l}</div>
              </div>
            )})}
          </div>
          {agingBucket&&agingData.buckets[agingBucket]?.items?.length>0&&(()=>{
            const col={current:C.normal,warning:C.soon,overdue:C.overdue}[agingBucket]
            const items=agingData.buckets[agingBucket].items
            return (
              <div style={{border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden',margin:'10px 0 2px'}}>
                {items.map((it,i)=>(
                  <div key={it.id} onClick={()=>it.client_id&&onOpenClientFicha&&onOpenClientFicha(it.client_id)} title={it.client_id?'Ver ficha del cliente':undefined} style={{display:'flex',alignItems:'center',gap:8,padding:'10px 12px',borderTop:i>0?`1px solid ${C.border}`:'none',cursor:it.client_id?'pointer':'default'}}>
                    <div style={{minWidth:0,flex:1}}>
                      <div style={{fontSize:12,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{it.nombre}</div>
                      <div style={{fontSize:10,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{it.invoice_no?`Factura N° ${folioN(it.invoice_no)||it.invoice_no} · `:''}{it.concept||'—'}{it.dias>0?` · ${it.dias} días vencida`:it.due?` · vence ${fmtDate(it.due)}`:''}</div>
                    </div>
                    <div style={{fontSize:13,fontWeight:700,color:col,whiteSpace:'nowrap',flexShrink:0}}>{fmtMon(it.monto)}</div>
                    <span style={{color:C.az3||C.muted,flexShrink:0,fontSize:14}}><Gl n='chevron'/></span>
                  </div>
                ))}
              </div>
            )
          })()}
          {top5Open&&<div style={{borderTop:'0.5px solid #E4E8EB',marginTop:11,paddingTop:11}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,margin:'9px 0 12px'}}>
                <div style={{background:C.bgSoft,borderRadius:8,padding:'9px 11px'}}><div style={{fontSize:10,color:C.muted}}>DSO</div><div style={{fontSize:15,fontWeight:600,color:C.accent}}>~{Math.round(Math.max(0,agingData.dso))} días</div></div>
                <div style={{background:C.bgSoft,borderRadius:8,padding:'9px 11px',minWidth:0}}><div style={{fontSize:10,color:C.muted}}>Mayor exposición</div><div style={{fontSize:12,fontWeight:600,color:C.accent,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{agingData.mayorExposicion.nombre}</div><div style={{fontSize:10,color:C.muted}}>{fmtMon(agingData.mayorExposicion.monto)}</div></div>
                <div style={{background:C.bgSoft,borderRadius:8,padding:'9px 11px'}}><div style={{fontSize:10,color:C.muted}}>Top 1</div><div style={{fontSize:15,fontWeight:600,color:C.accent}}>{agingData.concentracionTop1Pct.toFixed(1)}%</div></div>
              </div>
              <div style={{...SEC_LBL,marginBottom:2}}>Top 5 clientes</div>
              {agingData.top5.map((c,i)=>(
                <div key={c.id} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:i<agingData.top5.length-1?'0.5px solid #E4E8EB':'none'}}>
                  <div style={{width:28,height:28,borderRadius:'50%',background:C.border,color:C.muted,fontSize:10,fontWeight:600,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{c.iniciales}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:500,color:C.accent,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.nombre}</div>
                    <div style={{fontSize:11,color:C.muted}}>{c.facturas} factura{c.facturas!==1?'s':''}</div>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
                    <span style={{fontSize:13,fontWeight:500,color:C.accent}}>{fmtMon(c.monto)}</span>
                    <span style={{fontSize:9.5,padding:'2px 8px',borderRadius:20,background:c.bucketBg,color:c.bucketColor,whiteSpace:'nowrap',fontWeight:700}}>{c.bucketLabel}</span>
                  </div>
                </div>
              ))}
          </div>}
        </div>
      </div>)}
      {kOpen('proyeccion')&&(
      <div style={{padding:'10px 20px 0'}}>
        <ProyeccionDetalle F={flujoCaja} clients={clients} sales={sales} isDesktop={isDeskRes} onOpenFlujoCaja={onOpenFlujoCaja} onOpenClientFicha={onOpenClientFicha}/>
      </div>)}

      {/* Comisiones + Oficina ahora viven en la grilla única de Indicadores (arriba). Aquí solo su detalle desplegable. */}
      {/* Mis proyectos — su tile vive en la grilla única de Indicadores (arriba). Aquí solo su lista desplegable. */}
      {misProyOpen&&(()=>{
        const miIni=INICIALES_RESP[user?.name]||null; const isMine=p=>!miIni||(p.responsable||'')===miIni
        const enCurso=(proyectosCartera||[]).filter(p=>p.activo!==false && !p.pausado && isMine(p))
        const enPausa=(proyectosCartera||[]).filter(p=>p.activo!==false && !!p.pausado && isMine(p))
        const term = verTodosProy ? (terminadosProy||[]) : []
        if(!enCurso.length && !enPausa.length && !term.length) return null
        const movByP={}; enCurso.forEach(p=>{ movByP[p.id]=carteraMovimiento(p,{billing,tasks,anticipos,expenses,hitos:proyHitos}) })
        const sorted=[...enCurso].sort((a,b)=>(movByP[b.id].score)-(movByP[a.id].score))
        const CART_DOT={rojo:'#E24B4A',ambar:'#EF9F27',verde:'#1D9E75'}
        const nm=p=>clients.find(c=>String(c.id)===String(p.cliente_id))?.name||p.nombre_proyecto||'—'
        const ico=(d,c)=><svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke={c} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>{d}</svg>
        const abrir=p=>{ onOpenProyecto?onOpenProyecto(p.id):go('cartera') }
        const groupHd=(icoEl,label,n,col,bg)=><div style={{display:'flex',alignItems:'center',gap:8,padding:'9px 12px 6px',background:C.bgSoft,borderTop:'1px solid #DDE2E6'}}><span style={{width:20,height:20,borderRadius:6,background:bg,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{icoEl}</span><span style={{flex:1,fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:.4,color:col}}>{label}</span><span style={{fontSize:10,fontWeight:800,color:col}}>{n}</span></div>
        const rowCurso=p=>{ const m=movByP[p.id], s=m.ultima, dd=m.dias, cu=dd==null?'':dd<=0?'hoy':dd===1?'ayer':(s&&s.iso?fmtFechaDMY(s.iso):`hace ${nDias(dd)}`); const col=CART_DOT[p.estado||'verde']; return (
          <div key={p.id} onClick={()=>abrir(p)} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',borderTop:'1px solid #DDE2E6',background:'#fff',cursor:'pointer'}}>
            <span style={{width:30,height:30,borderRadius:8,background:col+'1A',display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><span style={{width:9,height:9,borderRadius:'50%',background:col}}/></span>
            <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{nm(p)}</div><div style={{fontSize:10,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',display:'flex',alignItems:'center',gap:5}}>{s&&<span style={{width:6,height:6,borderRadius:'50%',background:SEÑAL_COL[s.tipo]||C.muted,flexShrink:0}}/>}{s?s.texto:(p.nota||p.nombre_proyecto||'sin señales')}</div></div>
            <span style={{fontSize:10,color:C.textSoft,whiteSpace:'nowrap'}}>{s?cu:''}</span><span style={{color:C.textSoft,fontSize:15,flexShrink:0}}><Gl n='chevron'/></span>
          </div>) }
        const rowSimple=(p,sub,badge,icoEl,bg,pill)=>(
          <div key={p.id} onClick={()=>abrir(p)} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',borderTop:'1px solid #DDE2E6',background:'#fff',cursor:'pointer'}}>
            <span style={{width:30,height:30,borderRadius:8,background:bg,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{icoEl}</span>
            <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{nm(p)}</div><div style={{fontSize:10,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{sub}</div></div>
            <span style={{fontSize:9,fontWeight:700,borderRadius:20,padding:'2px 9px',flexShrink:0,...pill}}>{badge}</span><span style={{color:C.textSoft,fontSize:15,flexShrink:0}}><Gl n='chevron'/></span>
          </div>)
        const pausaIco=c=>ico(<><line x1='8' y1='5' x2='8' y2='19'/><line x1='16' y1='5' x2='16' y2='19'/></>,c)
        const checkIco=c=>ico(<path d='M20 6L9 17l-5-5'/>,c)
        const cnt=[[enCurso.length,'en curso'],[enPausa.length,'pausa'],...(verTodosProy?[[term.length,'fin']]:[])].filter(x=>x[0]>0)
        return (
        <div style={{padding:'8px 20px 0'}}>
          <div style={{border:'1px solid #DDE2E6',borderRadius:12,overflow:'hidden'}}>
            <div style={{display:'flex',alignItems:'center',gap:11,padding:'12px 13px',background:C.accent}}>
              <span style={{width:32,height:32,borderRadius:10,background:'rgba(255,255,255,.14)',display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><svg width='17' height='17' viewBox='0 0 24 24' fill='none' stroke='#fff' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><rect x='2' y='7' width='20' height='14' rx='2'/><path d='M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16'/></svg></span>
              <div style={{flex:1,minWidth:0}}><div style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:.5,color:'rgba(255,255,255,.75)'}}>Mis proyectos</div><div style={{fontSize:15,fontWeight:800,color:'#fff',marginTop:1}}>{enCurso.length+enPausa.length+term.length} en total</div></div>
              <div style={{display:'flex',gap:5,flexShrink:0,flexWrap:'wrap',justifyContent:'flex-end'}}>{cnt.map(([n,l],i)=><span key={i} style={{fontSize:9.5,fontWeight:700,borderRadius:20,padding:'2px 8px',background:'rgba(255,255,255,.16)',color:'#fff',whiteSpace:'nowrap'}}>{n} {l}</span>)}</div>
            </div>
            {enCurso.length>0 && groupHd(ico(<polygon points='6 4 20 12 6 20 6 4' fill={C.greenText} stroke='none'/>,C.greenText),'En curso',enCurso.length,C.greenText,C.greenBg)}
            {sorted.slice(0,6).map(rowCurso)}
            {enPausa.length>0 && <>
              {groupHd(pausaIco('#5F5E5A'),'En pausa',enPausa.length,C.grisText,C.bgWarm)}
              {enPausa.map(p=>rowSimple(p, p.nota||'en pausa','En pausa',pausaIco('#5F5E5A'),C.bgWarm,{color:C.grisText,background:C.bgWarm}))}
            </>}
            {verTodosProy && term.length>0 && <>
              {groupHd(checkIco('#99ABB4'),'Terminados',term.length,C.done,C.bgSoft)}
              {term.map(p=>rowSimple(p, p.nota||'terminado','Terminado',checkIco('#99ABB4'),C.bgSoft,{color:C.textSoft,background:C.bgSoft,border:`1px solid ${C.border}`}))}
            </>}
            {!verTodosProy
              ? <div onClick={cargarTerminadosProy} style={{padding:'10px 12px',borderTop:'1px solid #DDE2E6',textAlign:'center',fontSize:12,fontWeight:700,color:C.accent,cursor:'pointer',background:'#fff'}}>Ver todos →</div>
              : <div onClick={()=>go('cartera')} style={{padding:'10px 12px',borderTop:'1px solid #DDE2E6',textAlign:'center',fontSize:12,fontWeight:700,color:C.accent,cursor:'pointer',background:'#fff'}}>Abrir en Cartera →</div>}
          </div>
        </div>
        )
      })()}

      {/* Gestión Caja Chica retirada del Dashboard de admin (2026-06-25): la cubre el resumen "Caja chica sin liquidar" del sheet de Tareas. Bloque desactivado (queda el detalle por persona en Gastos › Caja chica). */}

      <div style={{height:20}}/>
    </div>
  )
}

export const clientesPorRendir = (clients,expenses) => (clients||[]).filter(c=>c&&!_esOfiCliR(c)&&c.status!=='Terminado').map(c=>{ const pr=gastosPorRendirCli(expenses,c.id).filter(e=>(Number(e.amount)||0)!==0); return {c, n:pr.length, tot:pr.reduce((a,e)=>a+(Number(e.amount)||0),0)} }).filter(x=>x.n>0).sort((a,b)=>b.tot-a.tot)


