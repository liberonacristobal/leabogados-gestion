// Movido desde App.jsx por scripts/mover-a-modulo.py. Sin cambios de comportamiento.
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../supabase'
import { BRAND, C, Gl, SEC_LBL, _normTxt, fmtFechaDMY, fmtN, isoLocal, personChip, useIsDesktop } from '../lib/base.jsx'
import { Buscador, MESES, Modal, TaskPreview, _esDiaHabil, agendarTareaCalendar, bigDate, daysLeft, enMiLista, escanearTareasGmail, fmtDate, fmtSaldoG, learnPut, saldoCajaChica, taskAssignees, urgencyColor, useArrastre } from '../lib/compartido.jsx'

// Archivo automatico de tareas: una tarea Terminada se considera archivada cuando se completo
// hace mas de DAYS_TO_ARCHIVE dias. Las terminadas sin completed_at (historicas) cuentan como archivadas.
export const DAYS_TO_ARCHIVE = 15

export const isTaskArchived = t => t.status==='Terminado' && (!t.completed_at || (Date.now()-new Date(t.completed_at).getTime())/86400000 > DAYS_TO_ARCHIVE)

// ─── Fila deslizable (celular): al deslizar hacia la izquierda aparecen sus acciones DENTRO de la fila (no flotan) ──
// acciones = [{ etiqueta, color, fondo, onClick }]. En escritorio no desliza (las acciones están a la vista o al pasar el mouse).
export function FilaDeslizable({acciones=[], activo=true, children, radio=8}){
  const ANCHO=78, total=acciones.length*ANCHO
  const [dx,setDx]=useState(0), [abierta,setAbierta]=useState(false)
  const g=useRef(null)
  if(!activo||!acciones.length) return children
  const down=e=>{ if(e.pointerType==='mouse') return; g.current={x0:e.clientX,y0:e.clientY,base:abierta?-total:0,eje:null,t0:Date.now()} }
  const move=e=>{ const s=g.current; if(!s) return; const mx=e.clientX-s.x0, my=e.clientY-s.y0
    if(!s.eje){ if(Math.hypot(mx,my)<8) return; s.eje=Date.now()-s.t0>350?'arrastre':Math.abs(mx)>Math.abs(my)?'x':'y' }   // quieto antes de moverse = arrastre (useArrastre)
    if(s.eje!=='x') return
    setDx(Math.max(-total-24,Math.min(0,s.base+mx))) }
  const up=()=>{ const s=g.current; g.current=null; if(!s||s.eje!=='x') return
    const abrir=dx<-total/2; setAbierta(abrir); setDx(abrir?-total:0) }
  const cerrar=()=>{ setAbierta(false); setDx(0) }
  return (
    <div style={{position:'relative',overflow:'hidden',borderRadius:radio}}>
      <div style={{position:'absolute',top:0,right:0,bottom:0,display:'flex'}}>
        {acciones.map((a,i)=><button key={i} onClick={e=>{ e.stopPropagation(); cerrar(); a.onClick&&a.onClick() }} style={{width:ANCHO,border:'none',background:a.fondo||C.accent,color:a.color||'#fff',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>{a.etiqueta}</button>)}
      </div>
      <div onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={()=>{ g.current=null; setDx(abierta?-total:0) }}
        onClickCapture={e=>{ if(abierta){ e.stopPropagation(); e.preventDefault(); cerrar() } }}
        style={{position:'relative',transform:`translateX(${dx}px)`,transition:g.current?'none':'transform .2s ease',touchAction:'pan-y',background:C.card}}>
        {children}
      </div>
    </div>
  )
}

export function TasksOnlyView({tasks,clients,sales,expenses,pettyCash,rendiciones=[],onAddTask,onEdit,onComplete,onPreview,onReprogramar,currentUserName,setTab,navTo,isAdmin,onOpenClientFicha}) {
  const isDesktop = useIsDesktop()   // Fase 3: columna centrada más ancha en escritorio
  const hoy = new Date()
  const DIAS = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom']
  const fmtISO = d => isoLocal(d)   // fecha local (toISOString pasaba al día siguiente después de las 21:00 en Chile)

  const [filterClient,setFilterClient] = useState('')
  const [filterProject,setFilterProject] = useState('')
  const [openTerm,setOpenTerm] = useState(false)
  const [verArchivadas,setVerArchivadas] = useState(false)
  const [openActivas,setOpenActivas] = useState(true)
  const [selDay,setSelDay] = useState(null)   // calendario: día seleccionado → detalle abajo + resalta la lista
  // Reprogramar arrastrando: una tarea (del calendario o de la lista) se suelta sobre un día. El deshacer va en línea, bajo el calendario.
  const [ultMov,setUltMov] = useState(null)   // {t, de, a}
  useEffect(()=>{ if(!ultMov) return; const id=setTimeout(()=>setUltMov(null),20000); return ()=>clearTimeout(id) },[ultMov])
  const moverTarea = useCallback(async(t,iso)=>{ if(!onReprogramar||!t||t.due===iso) return; const de=t.due||null
    const ok=await onReprogramar(t,iso); if(ok!==false) setUltMov({t,de,a:iso}) },[onReprogramar])
  const arrT = useArrastre({grupo:'tarea', onSoltar:moverTarea})
  const sigHabilISO = ()=>{ const x=new Date(); let g=0; do{ x.setDate(x.getDate()+1) }while(!_esDiaHabil(x)&&g++<15); return isoLocal(x) }
  const [openAsignadas,setOpenAsignadas] = useState(true)
  const [grpCerrado,setGrpCerrado] = useState({})          // grupos por urgencia plegados (venc/sem/mas)
  const [verTodasVenc,setVerTodasVenc] = useState(false)   // móvil: vencidas muestra 3 + '+N más'
  const [asigPersOpen,setAsigPersOpen] = useState({})
  const [preview,setPreview] = useState(null)
  // Popup flotante de detalle (hover en desktop / long-press en móvil) sobre las tareas del calendario
  const [hoverTask,setHoverTask] = useState(null)
  const [hoverPos,setHoverPos] = useState({x:0,y:0})
  const hoverTimer = useRef(null)
  const longPressFired = useRef(false)
  const startPress = (t,e) => {
    const p = e.touches?.[0] ? {x:e.touches[0].clientX,y:e.touches[0].clientY} : {x:e.clientX,y:e.clientY}
    hoverTimer.current = setTimeout(()=>{ longPressFired.current=true; setHoverPos(p); setHoverTask(t) }, 380)
  }
  const endPress = () => { clearTimeout(hoverTimer.current); setHoverTask(null) }
  const me = currentUserName || ''
  // Proyectos dependientes del cliente filtrado: solo los del/los cliente(s) que matchean el texto buscado
  const clientIdsFiltro = new Set((filterClient ? clients.filter(c=>c.name?.toLowerCase().includes(filterClient.toLowerCase())) : []).map(c=>c.id))
  const proyectosCliente = filterClient
    ? [...new Set(tasks.filter(t=>clientIdsFiltro.has(t.client_id)&&t.project&&(enMiLista(t,me)||t.assigned_by===me)).map(t=>t.project))].sort()
    : []
  const projDisabled = !filterClient || proyectosCliente.length===0

  // Tareas activas (filtradas) y terminadas recientes
  // Buscador común: por tarea, cliente o proyecto (antes solo cliente).
  const pasaBusca = t => { if(!filterClient) return true; const q=_normTxt(filterClient); return [clients.find(c=>c.id===t.client_id)?.name, t.title, t.project, t.subproject].some(x=>_normTxt(x).includes(q)) }
  const base = tasks.filter(t=>{
    if(t.status!=='Activo') return false
    if(!pasaBusca(t)) return false
    if(filterProject && t.project!==filterProject) return false
    return true
  })
  const terminadasAll = tasks.filter(t=>{
    if(t.status!=='Terminado') return false
    if(!enMiLista(t,me) && t.assigned_by!==me) return false
    if(!pasaBusca(t)) return false
    if(filterProject && t.project!==filterProject) return false
    return true
  })
  const terminadas = terminadasAll.filter(t=>!isTaskArchived(t)).sort((a,b)=>(b.created_at||'')>(a.created_at||'')?1:-1).slice(0,30)
  const archivadas = terminadasAll.filter(t=>isTaskArchived(t)).sort((a,b)=>((b.completed_at||b.created_at||'')>(a.completed_at||a.created_at||'')?1:-1))

  // Mis tareas: las asignadas a mi. Tareas que asigne: yo las cree para otros.
  const mias = base.filter(t=>enMiLista(t,me))
  const asignadas = base.filter(t=>t.assigned_by===me && !enMiLista(t,me))

  // KPIs del hero (sobre mis tareas activas; respetan los filtros de cliente/proyecto)
  const _dl = t => daysLeft(t.due)
  const kpiVencidas = mias.filter(t=>_dl(t)!=null && _dl(t)<0)
  const kpiSemana = mias.filter(t=>{ const d=_dl(t); return d!=null && d>=0 && d<=7 })
  const _som = (()=>{ const n=new Date(); return new Date(n.getFullYear(),n.getMonth(),1).getTime() })()
  const kpiTermMes = terminadasAll.filter(t=>{ const cd=t.completed_at||t.created_at; return cd && new Date(cd).getTime()>=_som })
  // "Que asigné" por persona (a quién delegué y cuántas)
  const asignadasPorPersona = (()=>{ const m={}; asignadas.forEach(t=>{ (taskAssignees(t).length?taskAssignees(t):['—']).forEach(p=>{ m[p]=(m[p]||0)+1 }) }); return Object.entries(m).sort((a,b)=>b[1]-a[1]) })()

  // Recordatorios de caja chica para quien tiene caja activa (limited): hace ≥10 días sin cargar gastos y/o fondo bajo (<$50.000) → conviene liquidar.
  const tieneCaja = (pettyCash||[]).some(p=>p.user_name===me)
  const miSaldo = saldoCajaChica(pettyCash, expenses, me)
  const _misGastosFechas = (expenses||[]).filter(e=>e.type==='gasto'&&e.created_by===me&&e.date).map(e=>e.date).sort()
  const _ultGasto = _misGastosFechas.length ? _misGastosFechas[_misGastosFechas.length-1] : null
  const diasSinGasto = _ultGasto ? Math.floor((Date.now()-new Date(_ultGasto+'T12:00').getTime())/86400000) : null
  const nudgeCargar = tieneCaja && diasSinGasto!=null && diasSinGasto>=10
  const nudgeLiquidar = tieneCaja && miSaldo < 50000

  // Sugerencias de tareas desde Gmail (no leídos) para el hero. Escaneo 1 vez por sesión (cacheado), solo admin.
  const [sugTareas,setSugTareas] = useState(()=>{ try{ const c=sessionStorage.getItem('gmail_tareas_sug'); return c?JSON.parse(c):null }catch(_){ return null } })
  const [sugBusy,setSugBusy] = useState(false)
  const [sugOpen,setSugOpen] = useState(false)
  const [sugDismiss,setSugDismiss] = useState(new Set())
  useEffect(()=>{ supabase.from('learnings').select('key').eq('kind','tarea_gmail_descartada').then(({data})=>setSugDismiss(new Set((data||[]).map(r=>String(r.key)))),()=>{}) },[])
  useEffect(()=>{ if(!isAdmin||sugTareas!=null) return; let alive=true; setSugBusy(true); escanearTareasGmail(clients).then(items=>{ if(!alive)return; setSugTareas(items); try{sessionStorage.setItem('gmail_tareas_sug',JSON.stringify(items))}catch(_){}; setSugBusy(false) }).catch(()=>{ if(alive){ setSugTareas([]); setSugBusy(false) } }); return ()=>{alive=false} },[isAdmin])
  const sugVisibles = (sugTareas||[]).filter(a=>!sugDismiss.has(a.id))
  const descartarSug = a=>{ learnPut('tarea_gmail_descartada',a.id,'descartada',{}); setSugDismiss(p=>new Set([...p,a.id])) }

  // Agregar el vencimiento de una tarea al Google Calendar (evento de día completo).
  // Intenta la Calendar API (silencioso, 1 clic) y si no hay permiso cae al link pre-armado de Calendar,
  // que NO requiere ningún scope: así siempre funciona, esté o no autorizada la API.
  const agendarTarea = t => agendarTareaCalendar(t, clients)

  // Orden por urgencia: vencimiento más cercano primero, sin fecha al final
  const porUrgencia = arr => [...arr].sort((a,b)=>(daysLeft(a.due)??99999)-(daysLeft(b.due)??99999))

  const fmtVenceShort = iso => { if(!iso) return ''; try{ const d=new Date(iso+'T12:00'); return String(d.getDate()).padStart(2,'0')+'-'+String(d.getMonth()+1).padStart(2,'0') }catch(e){return ''} }
  const bsCard = due => { const d=daysLeft(due); if(d===null) return {bg:C.border,col:C.muted}; if(d<0) return {bg:C.overdueBg,col:C.overdue}; if(d<=1) return {bg:C.ambarBg,col:C.soon}; if(d<=7) return {bg:C.ambarBg,col:C.soon}; return {bg:C.border,col:C.muted} }
  // Se llama como función (Card({t})), no como <Card/>: definida dentro de la vista, como componente se recrearía en cada dibujo
  // y la fila deslizable perdería su estado (abierta/cerrada).
  const Card = ({t,showWho,done}) => {
    const client=clients.find(c=>c.id===t.client_id)
    const bs=bsCard(t.due)
    const mover = !done && !!onReprogramar
    const dnd = mover ? arrT.props(t, client?.name||t.title) : null
    const sig = mover && !isDesktop ? sigHabilISO() : null
    const sigLbl = sig ? (()=>{ const d=new Date(sig+'T12:00'), m=new Date(); m.setDate(m.getDate()+1); return fmtISO(m)===sig?'Mañana':['Dom','Lunes','Martes','Miérc.','Jueves','Viernes','Sáb'][d.getDay()] })() : ''
    const acciones = !done&&!isDesktop ? [
      ...(mover&&t.due!==sig?[{etiqueta:sigLbl, fondo:C.accent, onClick:()=>moverTarea(t,sig)}]:[]),
      ...(onComplete?[{etiqueta:'Terminar', fondo:C.greenText, onClick:()=>onComplete(t)}]:[]),
    ] : []
    return (
      <div key={t.id} style={{marginBottom:5}}><FilaDeslizable acciones={acciones}>
      <div onClick={()=>(onPreview||setPreview)(t)} className='tk-card' {...(dnd?{onPointerDown:dnd.onPointerDown}:{})} style={{...(dnd?dnd.style:{}),background:C.card,borderRadius:8,border:`0.5px solid ${C.border}`,overflow:'hidden',opacity:done?.7:1,cursor:mover&&isDesktop?'grab':'pointer'}}>
        <div style={{display:'flex',alignItems:'flex-start',padding:'9px 11px',gap:8}}>
          {bigDate(t.due,done?C.muted:urgencyColor(t.due,t.status))}
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:13,fontWeight:600,color:done?C.muted:C.text,lineHeight:1.3,textDecoration:done?'line-through':'none'}}>{t.title}</div>
            {(client||t.project||t.subproject||(showWho&&taskAssignees(t).length>0))&&(
              <div style={{fontSize:10,color:C.textSoft,marginTop:3,display:'flex',alignItems:'center',gap:5,flexWrap:'wrap'}}>
                {(client||t.project||t.subproject)&&<span style={{minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{client&&<span onClick={onOpenClientFicha?(ev)=>{ev.stopPropagation();onOpenClientFicha(client.id)}:undefined} title={onOpenClientFicha?'Ver ficha del cliente':undefined} style={{color:C.muted,fontWeight:600,cursor:onOpenClientFicha?'pointer':'inherit'}}>{client.name}</span>}{t.project&&<span>{client?' · ':''}{t.project}</span>}{t.subproject&&<span>{(client||t.project)?<>{" "}<Gl n='chevron'/>{" "}</>:''}{t.subproject}</span>}</span>}
                {showWho&&taskAssignees(t).map(w=>{const pc=personChip(w);return <span key={w} style={{flexShrink:0,fontSize:11,color:pc.color,fontWeight:700}}>{w}</span>})}
              </div>
            )}
            {(t.delegated_to||[]).length>0&&<div style={{fontSize:9.5,color:C.soonText,background:C.ambarBg,borderRadius:20,padding:'2px 8px',marginTop:4,display:'inline-block',fontWeight:700,whiteSpace:'nowrap'}}>Delegada a {(t.delegated_to||[]).join(', ')}{t.delegated_due?` · vence ${fmtVenceShort(t.delegated_due)}`:''}</div>}
            {!done&&t.evidencia&&!t.evidencia.descartada&&<div style={{fontSize:9.5,color:C.greenText,background:C.greenBg,borderRadius:20,padding:'2px 8px',marginTop:4,display:'inline-block',fontWeight:700,whiteSpace:'nowrap'}}>Cumplida según los registros</div>}
          </div>
          {!done&&(
            <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:5,flexShrink:0}}>
              {!t.due&&<span style={{fontSize:9.5,fontWeight:700,padding:'2px 8px',borderRadius:20,background:bs.bg,color:bs.col,whiteSpace:'nowrap'}}>Sin fecha</span>}
              <div style={{display:'flex',gap:9,alignItems:'center'}}>
                {isDesktop&&<span className='tk-ic' style={{display:'inline-flex',gap:9,alignItems:'center'}}>
                <button onClick={(e)=>{e.stopPropagation();agendarTarea(t)}} disabled={!t.due} title={t.due?'Agregar a Google Calendar':'Sin fecha de vencimiento'} style={{background:'none',border:'none',padding:0,cursor:t.due?'pointer':'default',color:t.due?C.muted:'#C7D0D5',display:'inline-flex',alignItems:'center'}}>
                  <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><rect x='3' y='4' width='18' height='18' rx='2'/><line x1='16' y1='2' x2='16' y2='6'/><line x1='8' y1='2' x2='8' y2='6'/><line x1='3' y1='10' x2='21' y2='10'/></svg>
                </button>
                <button onClick={(e)=>{e.stopPropagation();onEdit&&onEdit(t)}} title='Editar' style={{background:'none',border:'none',padding:0,cursor:'pointer',color:C.muted,display:'inline-flex',alignItems:'center'}}>
                  <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><path d='M12 20h9'/><path d='M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z'/></svg>
                </button>
                </span>}
                {onComplete&&<span onClick={(e)=>{e.stopPropagation();onComplete(t)}} data-no-arrastre title='Terminada' style={{width:isDesktop?18:22,height:isDesktop?18:22,borderRadius:isDesktop?6:7,border:`1.5px solid #D7DEE3`,cursor:'pointer',flexShrink:0}}/>}
              </div>
            </div>
          )}
        </div>
      </div>
      </FilaDeslizable></div>
    )
  }

  // Título de bloque (Mis tareas / Próximas dos semanas / Mi caja chica): mismo estilo entre sí
  const BloqueTitulo = ({children}) => <div style={{...SEC_LBL}}>{children}</div>
  // Subtítulo colapsable (Activas / Terminadas / Tareas que asigné): mismo estilo, menor que el de bloque
  const SubHeader = ({label,count,open,onToggle}) => (
    <div onClick={onToggle} style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',userSelect:'none',padding:'6px 0',marginBottom:open?6:0}}>
      <span style={{fontSize:12,fontWeight:600,color:C.text,flex:1}}>{label} <span style={{color:C.muted}}>· {count}</span></span>
      <span style={{width:7,height:7,border:`solid ${C.muted}`,borderWidth:'0 1.5px 1.5px 0',display:'inline-block',transform:open?'rotate(-135deg)':'rotate(45deg)',transition:'transform .2s',marginBottom:open?-2:2}}></span>
    </div>
  )

  const totalMias = mias.length
  const primerNombre = (me||'').trim().split(' ')[0]
  const saludo = `¡Hola${primerNombre?` ${primerNombre}`:''}!`
  const fechaHoy = new Date().toLocaleDateString('es-CL',{weekday:'long',day:'numeric',month:'long'}).replace(/^\w/,c=>c.toUpperCase())

  const heroChip = (label,val,bg,col,onClick)=>(<span onClick={onClick} style={{fontSize:11,background:bg,color:col,borderRadius:20,padding:'4px 11px',fontWeight:600,cursor:onClick?'pointer':'default'}}>{label} {val}</span>)
  // Abre la sección y hace scroll hasta ella (las pills del hero llevan a su tema).
  const goSec = (setter,id)=>{ setter&&setter(true); setVerArchivadas(false); setTimeout(()=>{ const el=document.getElementById(id); if(el) el.scrollIntoView({behavior:'smooth',block:'start'}) },70) }
  /* Recordatorio caja chica (solo quien tiene caja activa): sin cargar gastos hace ≥10 días y/o fondo bajo */
  const _nudge = ((nudgeCargar||nudgeLiquidar)&&(
        <div style={{padding:'14px 20px 0'}}>
          <div onClick={()=>navTo?navTo({tab:'cajachica'}):setTab&&setTab('cajachica')} style={{background:C.soonBg,border:'1px solid #F0D88A',borderRadius:10,padding:'10px 12px',cursor:'pointer',display:'flex',alignItems:'center',gap:10}}>
            <span style={{width:8,height:8,borderRadius:'50%',background:C.soon,flexShrink:0}}/>
            <div style={{flex:1,minWidth:0,fontSize:12,color:C.soonText,lineHeight:1.45}}>
              {nudgeLiquidar&&<div><b>Tu caja chica está baja</b> ({fmtN(miSaldo)}) — conviene liquidarla pronto.</div>}
              {nudgeCargar&&<div>Hace <b>{diasSinGasto} días</b> que no cargas gastos.</div>}
            </div>
            <span style={{fontSize:11,fontWeight:700,color:C.soonText,whiteSpace:'nowrap',flexShrink:0}}>Caja chica <Gl n='chevron'/></span>
          </div>
        </div>
      ));
  /* Hero: foco del día (titular) + tablero de 4 KPIs (tocables → abren la sección) */
  const _hero = (
      <div style={{padding:isDesktop?0:'14px 20px 0'}}>
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:'14px 16px',marginBottom:8}}>
          <div style={{display:'flex',flexDirection:isDesktop?'column':'row',gap:12,alignItems:'stretch'}}>
            {/* Col 1: subtarjeta de foco (vencidas/esta semana/al día) + a quiénes asigné, debajo */}
            <div style={{flex:isDesktop?'0 0 auto':1,minWidth:0}}>
              {(()=>{ const foco = kpiVencidas.length>0 ? {n:kpiVencidas.length,lbl:`vencida${kpiVencidas.length!==1?'s':''}`,bg:C.overdueBg,col:C.overdue}
                  : kpiSemana.length>0 ? {n:kpiSemana.length,lbl:'vencen esta semana',bg:C.ambarBg,col:'#B5710F'}
                  : {n:mias.length,lbl:'activas · al día',bg:C.greenBg,col:C.greenText}
                return (
                  <div onClick={()=>goSec(setOpenActivas,'sec-activas')} style={{background:foco.bg,borderRadius:10,padding:'10px 12px',cursor:'pointer'}}>
                    <div style={{fontSize:30,fontWeight:600,color:foco.col,lineHeight:1}}>{foco.n}</div>
                    <div style={{fontSize:10,color:foco.col,marginTop:3,fontWeight:500,lineHeight:1.3}}>{foco.lbl}</div>
                    {kpiVencidas.length>0&&kpiSemana.length>0&&<div style={{fontSize:9,color:foco.col,marginTop:2,opacity:.85}}>+{kpiSemana.length} esta semana</div>}
                  </div>
                )
              })()}
              {asignadasPorPersona.length>0&&(
                <div style={{display:'flex',gap:5,flexWrap:'wrap',marginTop:7}}>
                  {asignadasPorPersona.map(([p,n])=>{ const pc=personChip(p); return <span key={p} onClick={()=>goSec(setOpenAsignadas,'sec-asignadas')} style={{fontSize:10,background:pc.bg,color:pc.color,borderRadius:10,padding:'2px 7px',fontWeight:600,cursor:'pointer'}}>{p} · {n}</span> })}
                </div>
              )}
            </div>
            <div style={{width:isDesktop?'100%':1,height:isDesktop?1:'auto',background:C.border,alignSelf:'stretch',flexShrink:0}}/>
            {/* Col 2: pills entre las dos subtarjetas */}
            <div style={{flex:isDesktop?'0 0 auto':1,minWidth:0,display:'flex',flexDirection:isDesktop?'row':'column',flexWrap:isDesktop?'wrap':'nowrap',gap:7,justifyContent:'flex-start',alignItems:'flex-start'}}>
              {heroChip('Activas',mias.length,'#E6EEF1',C.accent,()=>goSec(setOpenActivas,'sec-activas'))}
              {asignadas.length>0&&heroChip('Que asigné',asignadas.length,C.bgWarm,'#5F5E5A',()=>goSec(setOpenAsignadas,'sec-asignadas'))}
              {heroChip('Terminadas',kpiTermMes.length,'#E1F5EE',C.greenText,()=>goSec(setOpenTerm,'sec-term'))}
            </div>
            {/* Col 3: subtarjeta sugeridas desde Gmail (admin); al tocar se despliega la lista abajo */}
            {isAdmin&&(sugBusy||sugVisibles.length>0)&&(<>
              <div style={{width:isDesktop?'100%':1,height:isDesktop?1:'auto',background:C.border,alignSelf:'stretch',flexShrink:0}}/>
              <div onClick={()=>{ if(!sugBusy) setSugOpen(o=>!o) }} style={{flex:1,minWidth:0,background:C.greenBg,borderRadius:10,padding:'10px 12px',display:'flex',flexDirection:'column',justifyContent:'center',cursor:sugBusy?'default':'pointer'}}>
                {sugBusy ? <span style={{fontSize:11,color:C.greenText,fontWeight:500}}>Revisando…</span> : (<>
                  <div style={{fontSize:30,fontWeight:600,color:C.greenText,lineHeight:1}}>{sugVisibles.length}</div>
                  <div style={{fontSize:10,color:C.greenText,marginTop:3,lineHeight:1.3,fontWeight:500}}>sugeridas desde Gmail</div>
                  <div style={{fontSize:11,color:C.greenText,fontWeight:700,marginTop:6}}>{sugOpen?<>Ocultar{" "}<Gl n='chevU'/></>:<>Revisar{" "}<Gl n='chevron'/></>}</div>
                </>)}
              </div>
            </>)}
          </div>
          {isAdmin&&sugOpen&&sugVisibles.length>0&&(
            <div style={{marginTop:10,paddingTop:10,borderTop:`0.5px solid ${C.border}`}}>
              {sugVisibles.map(a=>(
                <div key={a.id} style={{display:'flex',alignItems:'center',gap:8,marginTop:6,padding:'8px 10px',background:C.bgSoft,borderRadius:8}}>
                  <div onClick={()=>onEdit&&onEdit({title:a.title,client_id:a.client_id,due:a.due,note:a.note})} style={{flex:1,minWidth:0,cursor:'pointer'}}>
                    <div style={{fontSize:12,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.title}</div>
                    <div style={{fontSize:10,color:C.textSoft,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.fromName}{a.client_id?` · ${clients.find(c=>c.id===a.client_id)?.name||''}`:''}{a.due?` · vence ${fmtVenceShort(a.due)}`:''}</div>
                  </div>
                  <button onClick={()=>descartarSug(a)} title='Descartar' style={{background:'none',border:'none',color:C.textSoft,cursor:'pointer',fontSize:16,lineHeight:1,padding:'0 2px',flexShrink:0}}><Gl n='x'/></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
  );
  const _list = (
      <div style={{padding:isDesktop?0:'14px 20px 0'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,flexWrap:'wrap',marginBottom:4}}>
          <BloqueTitulo>Mis tareas</BloqueTitulo>
          <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',justifyContent:'flex-end',flex:1,minWidth:0}}>
            <div style={{position:'relative',display:'flex',alignItems:'center',flex:'1 1 170px',minWidth:150,maxWidth:270}}>
              <input value={filterClient} onChange={e=>{setFilterClient(e.target.value);setFilterProject('')}} placeholder='Tarea, cliente o proyecto' style={{width:'100%',padding:'5px 22px 5px 8px',borderRadius:8,border:`1px solid ${filterClient?C.accent:C.border}`,fontSize:12,background:filterClient?C.azulBg:C.bgSoft,color:C.text,boxSizing:'border-box',outline:'none'}}/>
              {filterClient&&<button onClick={()=>{setFilterClient('');setFilterProject('')}} style={{position:'absolute',right:5,background:'none',border:'none',color:C.muted,fontSize:14,cursor:'pointer',lineHeight:1}}><Gl n='x'/></button>}
            </div>
            <button onClick={()=>onAddTask&&onAddTask()} style={{padding:'5px 12px',borderRadius:8,border:'none',background:C.accent,color:'#fff',fontSize:12,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap',flexShrink:0}}>+ Nueva tarea</button>
            {(archivadas.length>0||verArchivadas)&&
              <button onClick={()=>setVerArchivadas(v=>!v)} style={{padding:'5px 9px',borderRadius:8,border:`1px ${verArchivadas?'solid':'dashed'} ${verArchivadas?C.accent:C.done}`,fontSize:11,fontWeight:600,background:verArchivadas?C.azulBg:'transparent',color:verArchivadas?C.accent:C.done,cursor:'pointer',flexShrink:0}}>Archivadas ({archivadas.length})</button>
            }
          </div>
        </div>
        {verArchivadas ? (
          <>
            <SubHeader label='Archivadas' count={archivadas.length} open={true} onToggle={()=>setVerArchivadas(false)}/>
            {archivadas.length>0
              ? archivadas.map(t=><div key={t.id} style={{opacity:.6}}>{Card({t,showWho:true,done:true})}</div>)
              : <div style={{fontSize:12,color:C.muted,padding:'2px 0 8px'}}>Sin tareas archivadas con estos filtros</div>}
          </>
        ) : (
          <>
        <div id='sec-activas'/>
        <SubHeader label='Activas' count={mias.length} open={openActivas} onToggle={()=>setOpenActivas(o=>!o)}/>
        {openActivas&&(mias.length>0
          ? (()=>{ // Agrupadas por urgencia: Vencidas (primero) · Esta semana · Más adelante (incluye sin fecha). Mismo corte que las cifras de arriba (daysLeft).
              const ord=porUrgencia(mias), dl=t=>daysLeft(t.due)
              const grupos=[
                ['venc','Vencidas',C.overdueText,ord.filter(t=>dl(t)!=null&&dl(t)<0)],
                ['sem','Esta semana',C.soonText,ord.filter(t=>dl(t)!=null&&dl(t)>=0&&dl(t)<=7)],
                ['mas','Más adelante · sin fecha',C.muted,ord.filter(t=>dl(t)==null||dl(t)>7)],
              ]
              return grupos.map(([k,lbl,col,arr])=>{ if(!arr.length&&k!=='sem') return null; const cerrado=!!grpCerrado[k]
                const vis=(k==='venc'&&!isDesktop&&!verTodasVenc)?arr.slice(0,3):arr
                return (<div key={k} id={'sec-'+k} style={{marginBottom:6}}>
                  <div onClick={()=>setGrpCerrado(g=>({...g,[k]:!g[k]}))} style={{display:'flex',alignItems:'center',gap:6,padding:'6px 2px',cursor:'pointer',userSelect:'none'}}>
                    <span style={{fontSize:11,fontWeight:700,color:col,textTransform:'uppercase',letterSpacing:.4}}>{lbl}</span>
                    <span style={{fontSize:11,color:C.muted}}>· {arr.length}</span>
                    <span style={{marginLeft:'auto',color:C.textSoft,fontSize:12}}>{cerrado?<Gl n='chevD'/>:<Gl n='chevU'/>}</span>
                  </div>
                  {!cerrado&&(arr.length===0
                    ? <div style={{fontSize:12,color:C.muted,padding:'0 2px 6px'}}>Nada vence esta semana.</div>
                    : <>{vis.map(t=>Card({t,showWho:false}))}
                        {vis.length<arr.length&&<div onClick={()=>setVerTodasVenc(true)} style={{fontSize:12,fontWeight:600,color:C.accent,textAlign:'center',padding:'6px 0',cursor:'pointer'}}>+ {arr.length-vis.length} vencida{arr.length-vis.length!==1?'s':''} más</div>}</>)}
                </div>) })
            })()
          : <div style={{fontSize:12,color:C.muted,padding:'2px 0 8px'}}>{filterProject||filterClient?'Sin tareas activas con estos filtros':'No tienes tareas activas'}</div>)}
        {asignadas.length>0&&(
          <>
            <div id='sec-asignadas'/>
            <SubHeader label='Tareas que asigné' count={asignadas.length} open={openAsignadas} onToggle={()=>setOpenAsignadas(o=>!o)}/>
            {openAsignadas&&(()=>{
              const grp={}; asignadas.forEach(t=>{ (taskAssignees(t).length?taskAssignees(t):['—']).forEach(pn=>{ (grp[pn]=grp[pn]||[]).push(t) }) })
              const orden=['Cristóbal','Erasmo','Martín','Martina','Rodrigo']
              const personas=Object.keys(grp).sort((a,b)=>{ const ia=orden.indexOf(a),ib=orden.indexOf(b); return (ia<0?99:ia)-(ib<0?99:ib)||a.localeCompare(b,'es') })
              const esVenc=t=>{ const d=daysLeft(t.due); return d!=null&&d<0 }
              return personas.map(pn=>{
                const arr=porUrgencia(grp[pn]); const vn=arr.filter(esVenc).length; const pc=personChip(pn); const open=!asigPersOpen[pn]
                return (
                  <div key={pn}>
                    <div onClick={()=>setAsigPersOpen(o=>({...o,[pn]:!o[pn]}))} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 2px',cursor:'pointer'}}>
                      <span style={{fontSize:13,fontWeight:800,color:pc.color}}>{pn}</span>
                      <span style={{fontSize:11,color:C.muted}}>{arr.length} tarea{arr.length!==1?'s':''}</span>
                      {vn>0&&<span style={{fontSize:10,fontWeight:600,color:C.overdueText}}>· {vn} vencida{vn!==1?'s':''}</span>}
                      <span style={{marginLeft:'auto',color:C.textSoft,fontSize:12}}>{open?<Gl n='chevU'/>:<Gl n='chevD'/>}</span>
                    </div>
                    {open&&arr.map(t=>Card({t,showWho:false}))}
                  </div>
                )
              })
            })()}
          </>
        )}
        {terminadas.length>0&&(
          <>
            <div id='sec-term'/>
            <SubHeader label='Terminadas' count={terminadas.length} open={openTerm} onToggle={()=>setOpenTerm(o=>!o)}/>
            {openTerm&&terminadas.map(t=>Card({t,showWho:true,done:true}))}
          </>
        )}
          </>
        )}
      </div>
  );
  const _urgCal = due => { const d=daysLeft(due); if(d==null) return {dot:C.done,bg:C.bgSoft,fg:C.muted}; if(d<0) return {dot:C.overdue,bg:C.overdueBg,fg:C.overdueText}; if(d<=7) return {dot:C.soon,bg:C.ambarBg,fg:C.soonText}; return {dot:C.done,bg:C.bgSoft,fg:C.muted} }
  const _cal = (
      <div style={{padding:isDesktop?0:'24px 20px 0'}}>
        <div style={{marginBottom:10}}><BloqueTitulo>Próximas semanas</BloqueTitulo></div>
        {(()=>{ const cellH=isDesktop?76:58, maxChips=isDesktop?2:1
          return [0,1].map(semIdx=>{
            const lunesSem = new Date(hoy); lunesSem.setDate(hoy.getDate()-((hoy.getDay()+6)%7)+semIdx*7); lunesSem.setHours(0,0,0,0)
            const dias = Array.from({length:5},(_,i)=>{ const d=new Date(lunesSem); d.setDate(lunesSem.getDate()+i); return d })
            const dd = n => String(n.getDate()).padStart(2,'0')+'-'+String(n.getMonth()+1).padStart(2,'0')
            const rango = `${dd(dias[0])} — ${dd(dias[4])}`
            const byDay = dias.map(dia=>{ const iso=fmtISO(dia); return { iso, dia, ts:tasks.filter(t=>t.due===iso&&t.status!=='Terminado'&&(enMiLista(t,me)||t.assigned_by===me)) } })
            const semTs = byDay.flatMap(d=>d.ts)
            return (
              <div key={semIdx} style={{marginBottom:13}}>
                {/* Encabezado B+D: etiqueta destacada + conteo + puntos de urgencia */}
                <div style={{display:'flex',alignItems:'center',gap:9,marginBottom:7}}>
                  <span style={{fontSize:12,fontWeight:800,borderRadius:8,padding:'3px 10px',background:semIdx===0?C.accent:'transparent',color:semIdx===0?'#fff':C.muted,border:semIdx===0?'none':`0.5px solid ${C.border}`}}>{semIdx===0?'Esta semana':'Próxima'}</span>
                  <span style={{fontSize:11,color:C.muted}}><b style={{color:C.text,fontWeight:700}}>{semTs.length} tarea{semTs.length!==1?'s':''}</b> · {rango}</span>
                  {semTs.length>0&&<span style={{marginLeft:'auto',display:'flex',gap:3}}>{semTs.slice(0,8).map((t,j)=><span key={j} style={{width:7,height:7,borderRadius:'50%',background:_urgCal(t.due).dot}}/>)}</span>}
                </div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:5}}>
                  {byDay.map(({iso,dia,ts},i)=>{ const esHoy=iso===fmtISO(hoy); const sel=iso===selDay; return (
                    <div key={i} data-soltar={iso} data-soltar-grupo='tarea' onClick={()=>ts.length?setSelDay(sel?null:iso):onAddTask(iso)} title={ts.length?'Ver tareas del día':'Nueva tarea este día'} style={{height:cellH,overflow:'hidden',background:arrT.sobre===iso?C.azulBg:sel?C.azulBg:'#fff',borderRadius:8,padding:'6px 7px',border:`1px ${arrT.arrastrando&&arrT.sobre===iso?'dashed':'solid'} ${arrT.sobre===iso||sel||esHoy?C.accent:C.border}`,cursor:'pointer',display:'flex',flexDirection:'column',transition:'background .12s'}}>
                      <div style={{display:'flex',alignItems:'baseline',gap:4}}><span style={{fontSize:9,fontWeight:700,color:esHoy?C.accent:C.done,textTransform:'uppercase'}}>{DIAS[i]}</span><span style={{fontSize:13,fontWeight:800,color:esHoy?C.accent:C.text}}>{String(dia.getDate()).padStart(2,'0')}</span></div>
                      <div style={{marginTop:5,display:'flex',flexDirection:'column',gap:3,minHeight:0}}>
                        {ts.slice(0,maxChips).map(t=>{ const u=_urgCal(t.due); const cl=clients.find(x=>x.id===t.client_id); const lbl=cl?cl.name:t.title
                          const dnd=onReprogramar?arrT.props(t,lbl):{onPointerDown:undefined,style:{}}
                          return isDesktop
                            ? <div key={t.id} onPointerDown={dnd.onPointerDown} title={onReprogramar?'Arrastra a otro día para reprogramar':undefined} style={{...dnd.style,fontSize:9.5,fontWeight:700,borderRadius:20,padding:'2px 8px',background:u.bg,color:u.fg,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',display:'flex',alignItems:'center',gap:5,cursor:onReprogramar?'grab':'pointer'}}><span style={{width:5,height:5,borderRadius:'50%',background:u.dot,flexShrink:0}}/>{lbl}</div>
                            : <div key={t.id} onPointerDown={dnd.onPointerDown} style={{...dnd.style,fontSize:9,fontWeight:700,color:u.fg,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',display:'flex',alignItems:'center',gap:4}}><span style={{width:6,height:6,borderRadius:'50%',background:u.dot,flexShrink:0}}/>{lbl}</div>
                        })}
                        {ts.length>maxChips&&<div style={{fontSize:9,color:C.textSoft,fontWeight:700}}>+{ts.length-maxChips} más</div>}
                      </div>
                    </div>
                  )})}
                </div>
              </div>
            )
          })
        })()}
        {ultMov&&<div style={{display:'flex',alignItems:'center',gap:8,fontSize:12,color:C.muted,background:C.bgSoft,borderRadius:10,padding:'8px 12px',margin:'0 0 10px'}}>
          <span style={{minWidth:0,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{isDesktop?<><b style={{color:C.text,fontWeight:600}}>{ultMov.t.title}</b> · reprogramada al {fmtFechaDMY(ultMov.a)}</>:<>Reprogramada al <b style={{color:C.text,fontWeight:600}}>{fmtFechaDMY(ultMov.a)}</b></>}</span>
          <button onClick={async()=>{ const m=ultMov; setUltMov(null); await onReprogramar({...m.t,due:m.a},m.de) }} style={{background:'none',border:'none',color:C.accent,fontWeight:700,fontSize:12,cursor:'pointer',padding:0,flexShrink:0}}>Deshacer</button>
        </div>}
        {selDay&&(()=>{ const ts=tasks.filter(t=>t.due===selDay&&t.status!=='Terminado'&&(enMiLista(t,me)||t.assigned_by===me)); const d=new Date(selDay+'T12:00'); const lbl0=d.toLocaleDateString('es-CL',{weekday:'long',day:'numeric',month:'long'}); const lbl=lbl0.charAt(0).toUpperCase()+lbl0.slice(1)
          return (
          <div style={{background:'#fff',border:`1px solid ${C.accent}`,borderRadius:12,padding:'10px 12px',marginTop:2,marginBottom:10}}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:ts.length?7:0}}>
              <span style={{fontSize:12,fontWeight:800,color:C.accent}}>{lbl}</span>
              <span style={{fontSize:11,color:C.muted}}>{ts.length} tarea{ts.length!==1?'s':''}</span>
              <button onClick={()=>setSelDay(null)} style={{marginLeft:'auto',background:'none',border:'none',color:C.textSoft,cursor:'pointer',fontSize:16,lineHeight:1,padding:0}}><Gl n='x'/></button>
            </div>
            {ts.map(t=>{ const u=_urgCal(t.due); const cl=clients.find(x=>x.id===t.client_id); return (
              <div key={t.id} onClick={()=>(onPreview||setPreview)(t)} style={{display:'flex',alignItems:'flex-start',gap:8,padding:'6px 0',borderTop:`0.5px solid ${C.border}`,cursor:'pointer'}}>
                <span style={{width:7,height:7,borderRadius:'50%',background:u.dot,flexShrink:0,marginTop:4}}/>
                <div style={{minWidth:0,flex:1}}><div style={{fontSize:13,fontWeight:700,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.title}</div><div style={{fontSize:11,color:C.muted}}>{cl?cl.name:'Sin cliente'}{taskAssignees(t).length?` · ${taskAssignees(t).join(', ')}`:''}</div></div>
              </div>
            )})}
            <button onClick={()=>onAddTask(selDay)} style={{marginTop:8,fontSize:11,fontWeight:700,color:C.accent,background:'none',border:'none',cursor:'pointer',padding:0}}>+ Nueva tarea este día</button>
          </div>
        )})()}
        <div style={{display:'flex',gap:14,alignItems:'center',marginTop:4,flexWrap:'wrap'}}>
          <span style={{display:'inline-flex',alignItems:'center',gap:5,fontSize:10,color:C.muted}}><span style={{width:8,height:8,borderRadius:'50%',background:C.overdue}}/>Vencida</span>
          <span style={{display:'inline-flex',alignItems:'center',gap:5,fontSize:10,color:C.muted}}><span style={{width:8,height:8,borderRadius:'50%',background:C.soon}}/>Esta semana</span>
          <span style={{display:'inline-flex',alignItems:'center',gap:5,fontSize:10,color:C.muted}}><span style={{width:8,height:8,borderRadius:'50%',background:C.done}}/>Más adelante</span>
        </div>
      </div>
  );
  // RESUMEN FINANCIERO (caja chica del usuario) — mismo estilo y tamaños de antes (rótulo 10 · cifra 22 · chip 11 · títulos/filas 12 · montos 13),
  // más completo: última caja recibida · Mi caja este mes (gastado · por liquidar con antigüedad · última liquidación) · últimos gastos con su estado.
  const irCaja = sub => { try{ if(sub) sessionStorage.setItem('cc_tab',sub) }catch(_){} if(navTo) navTo({tab:'cajachica'}); else setTab&&setTab('cajachica') }
  const _fin = (
      <div style={{padding:isDesktop?'16px 0 40px':'24px 20px 100px'}}>
        <div style={{marginBottom:10}}><BloqueTitulo>Resumen financiero</BloqueTitulo></div>
        {(()=>{
          const saldo = saldoCajaChica(pettyCash, expenses, me)
          const misGastos = (expenses||[]).filter(e=>e.type==='gasto' && e.created_by===me)
          const porLiquidar = misGastos.filter(e=>!e.rendered_at&&!e.paid_by_client)
          const totalPorLiquidar = porLiquidar.reduce((a,e)=>a+(e.amount||0),0)
          const masAntiguo = porLiquidar.map(e=>e.date).filter(Boolean).sort()[0]||null
          const diasAntiguo = masAntiguo ? Math.floor((Date.now()-new Date(masAntiguo+'T12:00').getTime())/86400000) : null
          const ultimos = [...misGastos].sort((a,b)=>{
            const da=a.date||'', db=b.date||''
            if(da!==db) return da<db?1:-1
            return (b.created_at||'')<(a.created_at||'')?-1:1
          }).slice(0,3)
          const mesK = new Date().toISOString().slice(0,7)
          const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
          const delMes = misGastos.filter(e=>!e.paid_by_client&&String(e.date||'').slice(0,7)===mesK)   // mismo universo que el saldo (sin lo pagado por el cliente)
          const gastadoMes = delMes.reduce((a,e)=>a+(e.amount||0),0)
          const ultCaja = (pettyCash||[]).filter(p=>p.user_name===me).sort((a,b)=>String(b.delivered_at||'').localeCompare(String(a.delivered_at||'')))[0]||null
          const ultLiq = (rendiciones||[]).filter(r=>r.user_name===me&&r.tipo!=='cliente'&&!r.anulada_at).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')))[0]||null
          const fmtCLP = fmtN
          const fmtFecha = fmtFechaDMY
          const GREEN={num:C.normal,bg:C.greenBg,bd:'#D4EDE0',label:C.muted}
          const ORANGE={num:C.soon,bg:'#FEF6EE',bd:'#F5E2CC',label:C.soon}
          const RED={num:C.overdue,bg:C.overdueBg,bd:'#F2D5D5',label:C.muted}
          const saldoSch = saldo<0 ? RED : saldo<=(BRAND.cajaChicaUmbral||50000) ? ORANGE : GREEN
          const sinLiqNoNotaria = porLiquidar.filter(e=>e.category!=='Notaria').length
          const liqSch = sinLiqNoNotaria>10 ? RED : ORANGE
          const viejo = diasAntiguo!=null && diasAntiguo>30
          const colHd = t => <div style={{fontSize:12,fontWeight:600,color:C.text,marginBottom:8,display:'flex',alignItems:'center',gap:6}}>{t}</div>
          const tile = (lbl,val,sub,col,onClick) => (
            <div onClick={onClick} style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:8,padding:'9px 11px',minWidth:0,height:66,boxSizing:'border-box',display:'flex',flexDirection:'column',justifyContent:'center',cursor:onClick?'pointer':'default'}}>
              <div style={{...SEC_LBL,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{lbl}{onClick?<>{" "}<Gl n='chevron'/></>:''}</div>
              <div style={{fontSize:13,fontWeight:600,color:col||C.text,marginTop:3,fontVariantNumeric:'tabular-nums'}}>{val}</div>
              <div style={{fontSize:10,color:col||C.muted,marginTop:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{sub}</div>
            </div>)
          return (<>
            {/* Saldo (igual que antes) + última caja recibida; el chip lleva a liquidar */}
            <div style={{background:saldoSch.bg,borderRadius:10,padding:'12px 14px',border:`1px solid ${saldoSch.bd}`,display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px 12px',flexWrap:'wrap'}}>
              <div style={{minWidth:0,flex:'1 1 200px'}}>
                <div style={{fontSize:10,fontWeight:600,color:saldoSch.label,textTransform:'uppercase',letterSpacing:.5,marginBottom:4}}>Saldo en tu caja{saldo<0?' · te debemos':''}</div>
                <div style={{fontSize:22,fontWeight:700,color:saldoSch.num,lineHeight:1.1}}>{fmtSaldoG(saldo)}</div>
                {ultCaja&&<div style={{fontSize:10,color:C.muted,marginTop:4,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>Última caja recibida · {fmtFecha(ultCaja.delivered_at)} · {fmtCLP(ultCaja.amount)}</div>}
              </div>
              {totalPorLiquidar>0&&<span onClick={()=>irCaja('liquidar')} style={{flexShrink:0,fontSize:11,fontWeight:600,color:liqSch.num,background:'#fff',border:`0.5px solid ${liqSch.bd}`,padding:'5px 11px',borderRadius:20,whiteSpace:'nowrap',cursor:'pointer'}}>{porLiquidar.length} por liquidar · {fmtCLP(totalPorLiquidar)} <Gl n='chevron'/></span>}
            </div>
            {/* Mi caja este mes: tres cifras del mismo tamaño */}
            <div style={{marginTop:14}}>
              {colHd(`Mi caja este mes · ${MESES[new Date().getMonth()]}`)}
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:8}}>
                {tile('Gastado', fmtCLP(gastadoMes), `${delMes.length} gasto${delMes.length!==1?'s':''}`)}
                {tile('Por liquidar', totalPorLiquidar>0?fmtCLP(totalPorLiquidar):'—', totalPorLiquidar>0?`${porLiquidar.length}${masAntiguo?(isDesktop?` · desde el ${fmtFecha(masAntiguo).slice(0,5)} (${diasAntiguo} días)`:` · ${diasAntiguo} días`):''}`:'al día', viejo?C.soonText:null, totalPorLiquidar>0?()=>irCaja('liquidar'):null)}
                {tile('Liquidación', ultLiq?fmtCLP(ultLiq.total||0):'—', ultLiq?`última · ${fmtFecha(String(ultLiq.created_at||'').slice(0,10))}`:'aún no hay', null, ultLiq?()=>irCaja('caja'):null)}
              </div>
            </div>
            {/* Últimos gastos ingresados: a todo el ancho, con su estado */}
            {ultimos.length>0&&(
              <div style={{marginTop:14}}>
                {colHd('Últimos gastos ingresados')}
                {ultimos.map(e=>{ const cl=clients.find(c=>c.id===e.client_id); const liq=!!e.rendered_at; return (
                  <div key={e.id} style={{display:'flex',alignItems:'center',gap:10,background:C.card,borderRadius:8,padding:'0 11px',height:50,boxSizing:'border-box',marginBottom:6,border:`0.5px solid ${C.border}`}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:500,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.concept||'—'}</div>
                      <div style={{fontSize:10,color:C.muted,marginTop:2,display:'flex',gap:6,alignItems:'center',minWidth:0}}>
                        <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',minWidth:0}}>{[cl?.name,fmtFecha(e.date)].filter(Boolean).join(' · ')}</span>
                        {!e.paid_by_client&&<span style={{padding:'2px 8px',borderRadius:20,fontWeight:700,fontSize:9.5,background:liq?C.greenBg:C.soonBg,color:liq?C.greenText:C.soonText,flexShrink:0,whiteSpace:'nowrap'}}>{liq?'liquidado':'por liquidar'}</span>}
                      </div>
                    </div>
                    <div style={{width:92,textAlign:'right',fontSize:13,fontWeight:600,color:C.overdue,flexShrink:0,fontVariantNumeric:'tabular-nums'}}>{fmtCLP(e.amount)}</div>
                  </div>) })}
                <div onClick={()=>irCaja(null)} style={{fontSize:12,fontWeight:600,color:C.accent,textAlign:'right',cursor:'pointer'}}>Ver toda mi caja chica <Gl n='chevron'/></div>
              </div>
            )}
          </>)
        })()}
      </div>
  );
  const _overlays = (<>
      {hoverTask&&(()=>{
        const cl=clients.find(c=>c.id===hoverTask.client_id)
        const left=Math.max(8,Math.min(hoverPos.x+12, (typeof window!=='undefined'?window.innerWidth:360)-238))
        const top=Math.max(8,Math.min(hoverPos.y+12, (typeof window!=='undefined'?window.innerHeight:640)-200))
        const Row=({l,v})=><div style={{display:'flex',gap:6,marginTop:3}}><span style={{fontSize:10,color:C.muted,minWidth:74,flexShrink:0,textTransform:'uppercase',letterSpacing:.3}}>{l}</span><span style={{fontSize:11,color:C.text,minWidth:0,wordBreak:'break-word'}}>{v}</span></div>
        return (
          <div style={{position:'fixed',left,top,zIndex:300,width:230,background:'#fff',border:'1px solid #E4E8EB',borderRadius:10,boxShadow:'0 8px 28px rgba(0,0,0,.14)',padding:'10px 12px',pointerEvents:'none'}}>
            <div style={{fontSize:13,fontWeight:700,color:C.text,lineHeight:1.25,marginBottom:6}}>{hoverTask.title}</div>
            {cl&&<Row l='Cliente' v={cl.name}/>}
            {hoverTask.project&&<Row l='Proyecto' v={hoverTask.project}/>}
            {hoverTask.subproject&&<Row l='Subproyecto' v={hoverTask.subproject}/>}
            <Row l='Responsable' v={taskAssignees(hoverTask).join(', ')||'—'}/>
            <Row l='Vence' v={hoverTask.due?fmtDate(hoverTask.due):'Sin fecha'}/>
            <Row l='Estado' v={hoverTask.status||'—'}/>
          </div>
        )
      })()}
      {preview&&(
        <Modal title='Detalle de tarea' onClose={()=>setPreview(null)}>
          <TaskPreview task={preview} clients={clients} onClose={()=>setPreview(null)}
            onEdit={t=>{setPreview(null);onEdit(t)}}
            onComplete={t=>{onComplete(t);setPreview(null)}}/>
        </Modal>
      )}
  </>);
  // Desktop: banda de 4 KPIs (el pulso del día). En escritorio reemplaza al _hero; el móvil sigue con _hero intacto.
  const _kpiband = (()=>{ const tiles=[
      {n:kpiVencidas.length,l:kpiVencidas.length===1?'vencida':'vencidas',bg:C.overdueBg,num:C.overdue,lc:C.overdueText,go:()=>{ setGrpCerrado(g=>({...g,venc:false})); goSec(setOpenActivas,'sec-venc') }},
      {n:kpiSemana.length,l:'vencen esta semana',bg:C.ambarBg,num:C.soon,lc:C.soonText,go:()=>{ setGrpCerrado(g=>({...g,sem:false})); goSec(setOpenActivas,'sec-sem') }},
      {n:mias.length,l:'activas en total',bg:C.card,num:C.accent,lc:C.muted,plain:true,go:()=>goSec(setOpenActivas,'sec-activas')},
      {n:kpiTermMes.length,l:'terminadas este mes',bg:C.greenBg,num:C.greenText,lc:C.greenText,go:()=>goSec(setOpenTerm,'sec-term')} ]
    return <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:14}}>{tiles.map((t,i)=>(
      <div key={i} onClick={t.go} style={{background:t.bg,border:`1px solid ${t.plain?C.border:'transparent'}`,borderRadius:12,padding:'13px 14px',cursor:'pointer'}}>
        <div style={{fontSize:27,fontWeight:700,color:t.num,lineHeight:1}}>{t.n}</div>
        <div style={{fontSize:11,color:t.lc,marginTop:4,fontWeight:500}}>{t.l}</div>
      </div>))}</div>
  })()
  // Desktop: sugeridas desde Gmail (solo admin) — se conservan como tira bajo la banda, no se pierden al quitar el _hero.
  const _sugStrip = (isAdmin&&(sugBusy||sugVisibles.length>0)) ? (
    <div style={{marginBottom:14}}>
      <div onClick={()=>{ if(!sugBusy) setSugOpen(o=>!o) }} style={{background:C.greenBg,borderRadius:10,padding:'10px 12px',display:'flex',alignItems:'center',gap:10,cursor:sugBusy?'default':'pointer'}}>
        {sugBusy?<span style={{fontSize:12,color:C.greenText,fontWeight:500}}>Revisando Gmail…</span>:<>
          <span style={{fontSize:20,fontWeight:700,color:C.greenText,lineHeight:1}}>{sugVisibles.length}</span>
          <span style={{fontSize:12,color:C.greenText,fontWeight:600,flex:1}}>sugeridas desde Gmail</span>
          <span style={{fontSize:11,color:C.greenText,fontWeight:700}}>{sugOpen?<>Ocultar{" "}<Gl n='chevU'/></>:<>Revisar{" "}<Gl n='chevron'/></>}</span>
        </>}
      </div>
      {sugOpen&&sugVisibles.length>0&&<div style={{marginTop:8}}>{sugVisibles.map(a=>(
        <div key={a.id} style={{display:'flex',alignItems:'center',gap:8,marginTop:6,padding:'8px 10px',background:C.bgSoft,borderRadius:8}}>
          <div onClick={()=>onEdit&&onEdit({title:a.title,client_id:a.client_id,due:a.due,note:a.note})} style={{flex:1,minWidth:0,cursor:'pointer'}}>
            <div style={{fontSize:12,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.title}</div>
            <div style={{fontSize:10,color:C.textSoft,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.fromName}{a.client_id?` · ${clients.find(c=>c.id===a.client_id)?.name||''}`:''}{a.due?` · vence ${fmtVenceShort(a.due)}`:''}</div>
          </div>
          <button onClick={()=>descartarSug(a)} title='Descartar' style={{background:'none',border:'none',color:C.textSoft,cursor:'pointer',fontSize:16,lineHeight:1,padding:'0 2px',flexShrink:0}}><Gl n='x'/></button>
        </div>
      ))}</div>}
    </div>
  ) : null
  return (
    <>
      {isDesktop ? (
        <div style={{maxWidth:1200,margin:'0 auto',padding:'0 16px'}}>
          {_nudge}
          {_kpiband}
          {_sugStrip}
          {/* Calendario protagonista a la izquierda · tareas a la derecha */}
          <div style={{display:'grid',gridTemplateColumns:'1.35fr 1fr',gap:16,alignItems:'start'}}>
            <div style={{minWidth:0}}>{_cal}{_fin}</div>
            <div style={{minWidth:0}}>{_list}</div>
          </div>
        </div>
      ) : (
        <div>{_nudge}{_hero}{_list}{_cal}{_fin}</div>
      )}
      {_overlays}
    </>
  )
}

