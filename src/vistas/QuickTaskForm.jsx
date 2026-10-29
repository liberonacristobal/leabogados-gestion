// Movido desde App.jsx por scripts/mover-a-modulo.py. Sin cambios de comportamiento.
import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../supabase'
import { C, SEC_LBL, Spin, _normTxt, personChip } from '../lib/base.jsx'
import { Attachments, Fld, INICIALES_RESP, Inp, isAssignee } from '../lib/compartido.jsx'

// ─── CLIENTS VIEW ─────────────────────────────────────────────────────────────
export function QuickTaskForm({clients,sales,tasks,clientEntities,onSave,onDelegate,onClose,saving,preClient,preProject,preDue,preTitle,user,task}) {
  const [q,setQ] = useState('')
  const [selectedClient,setSelectedClient] = useState(preClient || (task ? clients.find(c=>c.id===task.client_id)||null : null))
  // preDue: fecha precargada (string 'YYYY-MM-DD') al crear desde el calendario
  // preProject: {id,name} al crear desde un proyecto de Cartera → enlace firme project_id + nombre precargado
  // preTitle: título precargado (p. ej. el "siguiente paso" sugerido por IA desde Cartera) — editable antes de guardar.
  const initAssignees = task ? (task.assignees?.length?task.assignees:(task.who?[task.who]:[])) : [user?.name||'Cristóbal']
  const [f,setF] = useState(task
    ? {id:task.id,title:task.title||'',assignees:initAssignees,entity_id:task.entity_id||null,due:task.due||'',status:task.status||'Activo',note:task.note||'',sale_id:task.sale_id||'',project:task.project||'',subproject:task.subproject||'',assigned_by:task.assigned_by,project_id:task.project_id||null}
    : {title:preTitle||'',assignees:initAssignees,entity_id:null,due:(typeof preDue==='string'?preDue:'')||'',status:'Activo',note:'',sale_id:'',project:preProject?.name||'',subproject:'',project_id:preProject?.id||null,assigned_by:user?.name||null})
  const [showProjects,setShowProjects] = useState(false)
  const [subNew,setSubNew] = useState(false)
  const [showDate,setShowDate] = useState(false)
  const [deleg,setDeleg] = useState(false)        // switch "Delegar"
  const [delegTo,setDelegTo] = useState([])       // a quién se delega (multi)
  const [delegDue,setDelegDue] = useState('')     // nuevo plazo de la delegación
  const [delegNota,setDelegNota] = useState('')   // motivo de la delegación (obligatorio)
  const [draftId,setDraftId] = useState(null)
  const draftRef = useRef(null)       // id de la tarea borrador (creada al adjuntar en tarea nueva)
  const committedRef = useRef(false)  // true si se guardó vía "Guardar" (no borrar al cerrar)

  // Si el modal se cierra sin guardar y existe un borrador, se elimina (sin huérfanos)
  useEffect(()=>()=>{ if(draftRef.current && !committedRef.current){ supabase.from('tasks').delete().eq('id',draftRef.current) } },[])

  const up=(k,v)=>setF(p=>({...p,[k]:v}))
  const WHO = ['Cristóbal','Martín','Erasmo','Rodrigo','Martina']
  const toggleResp = w => setF(p=>{ const a=p.assignees||[]; return {...p, assignees: a.includes(w)?a.filter(x=>x!==w):[...a,w]} })

  // Razones sociales del cliente. Con 1, se asume; con 2+, el usuario elige (principal = la primera).
  const clientEnts = useMemo(()=>(clientEntities||[]).filter(e=>e.client_id===selectedClient?.id),[clientEntities,selectedClient])
  const multiRS = clientEnts.length>1
  // Al elegir/cambiar cliente, fija la RS por defecto (primera) si la actual no aplica.
  useEffect(()=>{
    if(!selectedClient) return
    setF(p=>{ if(p.entity_id&&clientEnts.some(e=>e.id===p.entity_id)) return p; return {...p, entity_id: clientEnts[0]?.id||null} })
  },[selectedClient,clientEnts])

  // Crea la tarea silenciosamente (sin cerrar el modal ni avisar) para habilitar el uploader
  const ensureTaskId = async() => {
    if(task?.id) return task.id
    if(draftRef.current) return draftRef.current
    const asg = f.assignees?.length?f.assignees:[user?.name||'Cristóbal']
    const payload = {title:f.title||'',who:asg[0],assignees:asg,entity_id:f.entity_id||null,due:f.due||null,status:f.status||'Activo',note:f.note||'',sale_id:f.sale_id||null,project:f.project?.trim()||null,subproject:f.subproject?.trim()||null,client_id:selectedClient?.id||null,assigned_by:f.assigned_by||user?.name||null,project_id:f.project_id||null}
    const {data,error} = await supabase.from('tasks').insert(payload).select().single()
    if(error) throw error
    draftRef.current = data.id; setDraftId(data.id)
    return data.id
  }
  const handleGuardar = () => {
    committedRef.current = true
    const asg = f.assignees?.length?f.assignees:[user?.name||'Cristóbal']
    onSave({...f, assignees:asg, who:asg[0], entity_id:f.entity_id||null, id: task?.id||draftRef.current||undefined, client_id:selectedClient.id, project:f.project?.trim()||null, subproject:f.subproject?.trim()||null, _isNew: !task?.id})
  }

  const matches = useMemo(()=>{
    if(!q.trim()) return []
    return clients.filter(c=>_normTxt(c.name).includes(_normTxt(q))).slice(0,6)
  },[clients,q])

  // Proyectos existentes del cliente: de tareas + de ventas
  const clientProjects = useMemo(()=>{
    if(!selectedClient) return []
    const fromTasks = tasks.filter(t=>t.client_id===selectedClient.id&&t.project).map(t=>t.project)
    const fromSales = sales.filter(s=>s.client_id===selectedClient.id&&s.title).map(s=>s.title)
    return [...new Set([...fromSales,...fromTasks])].sort()
  },[tasks,sales,selectedClient])

  const clientSubprojects = useMemo(()=>{
    if(!selectedClient) return []
    const base = tasks.filter(t=>t.client_id===selectedClient.id&&t.subproject).map(t=>t.subproject)
    return [...new Set([...base, ...(f.subproject?[f.subproject]:[])])].sort()
  },[tasks,selectedClient,f.subproject])

  // Plazos rápidos (fecha local YYYY-MM-DD)
  const di = n => { const d=new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()+n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
  const presets = [['Mañana',di(1)],['3 días',di(3)],['7 días',di(7)]]
  const isCustomDue = f.due && !presets.some(p=>p[1]===f.due)

  // Clientes recientes (por última tarea creada) y conteo de tareas activas, para el paso de elección.
  const activosPorCliente = useMemo(()=>{ const m={}; tasks.forEach(t=>{ if(t.status==='Activo'&&t.client_id) m[t.client_id]=(m[t.client_id]||0)+1 }); return m },[tasks])
  const recientes = useMemo(()=>{
    const last={}; tasks.forEach(t=>{ if(t.client_id){ const k=t.created_at||''; if(!last[t.client_id]||k>last[t.client_id]) last[t.client_id]=k } })
    return Object.keys(last).sort((a,b)=>last[b]>last[a]?1:-1).map(id=>clients.find(c=>c.id===id)).filter(Boolean).slice(0,6)
  },[tasks,clients])
  const cIni = name => (name||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase()
  const subt = c => { const n=activosPorCliente[c.id]||0; return n>0?`${n} tarea${n!==1?'s':''} activa${n!==1?'s':''}`:(c.type||'—') }
  const ClientCard = c => (
    <button key={c.id} onClick={()=>{setSelectedClient(c);setQ('')}} style={{textAlign:'left',border:`0.5px solid ${C.border}`,borderRadius:10,padding:11,display:'flex',flexDirection:'column',gap:7,background:'#fff',cursor:'pointer'}}>
      <span style={{width:30,height:30,borderRadius:8,background:C.accent,color:'#fff',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700}}>{cIni(c.name)}</span>
      <span style={{fontSize:13,fontWeight:500,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',width:'100%'}}>{c.name}</span>
      <span style={{fontSize:10,color:C.muted}}>{subt(c)}</span>
    </button>
  )

  const selBox = {width:'100%',padding:'9px 11px',borderRadius:8,border:`1px solid ${C.border}`,background:C.bgSoft,color:C.text,fontSize:13,boxSizing:'border-box',outline:'none',appearance:'none',cursor:'pointer'}
  const pill = on => ({fontSize:12,fontWeight:on?600:500,padding:'6px 12px',borderRadius:20,border:`1px solid ${on?C.accent:C.border}`,background:on?C.azulBg:C.bgSoft,color:on?C.accent:C.muted,cursor:'pointer'})
  const ReqLabel = ({children}) => <span>{children} <span style={{color:C.overdue}}>*</span></span>

  const canSave = selectedClient && f.title?.trim() && f.project?.trim() && (!multiRS || f.subproject?.trim()) && (f.assignees?.length>0)

  // Roles para el flujo de delegación
  const me = user?.name || ''
  const esEdicion = !!task?.id
  const soyResponsable = esEdicion && isAssignee(task,me)   // el responsable puede editar Y delegar
  const yaDelegada = esEdicion && ((task.delegated_to||[]).length>0)

  // Regla dura: el nuevo plazo no puede exceder el original + 3 días.
  const addDaysISO = (iso,n)=>{ if(!iso) return ''; const [y,m,d]=iso.split('-').map(Number); const dt=new Date(y,m-1,d); dt.setDate(dt.getDate()+n); return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}` }
  const maxDelegDue = task?.due ? addDaysISO(task.due,3) : ''
  const delegDueOk = !!delegDue && (!maxDelegDue || delegDue<=maxDelegDue)
  const puedeDelegar = deleg && delegTo.length>0 && delegDueOk && !!delegNota.trim()
  const toggleDelegTo = w => setDelegTo(a=>a.includes(w)?a.filter(x=>x!==w):[...a,w])
  const handleDelegar = () => { committedRef.current=true; onDelegate(task,{to:delegTo,due:delegDue,nota:delegNota.trim()}) }

  const DelegBanner = () => (
    <div style={{fontSize:12,color:C.soonText,background:C.ambarBg,borderRadius:8,padding:'9px 11px',marginBottom:14}}>
      <span style={{fontWeight:600}}>{task.delegated_by}</span> la delegó a <span style={{fontWeight:600}}>{(task.delegated_to||[]).join(', ')}</span>{task.delegated_due?` · vence ${task.delegated_due}`:''}
      {task.delegated_note&&<div style={{marginTop:4,fontStyle:'italic'}}>"{task.delegated_note}"</div>}
    </div>
  )

  return (
    <>
      <div className='qt-head' style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,borderBottom:`1px solid ${C.border}`,position:'sticky',top:0,background:C.surface,zIndex:2}}>
        <div style={{display:'flex',alignItems:'center',gap:9,minWidth:0}}>
          <button className='qt-volver' onClick={onClose} aria-label='Volver' style={{alignItems:'center',gap:4,background:'none',border:'none',color:C.accent,fontSize:14,fontWeight:600,cursor:'pointer',padding:'2px 6px 2px 0',flexShrink:0}}><svg width='17' height='17' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.4' strokeLinecap='round' strokeLinejoin='round'><polyline points='15 18 9 12 15 6'/></svg>Volver</button>
          <span style={{fontSize:16,fontWeight:600,color:C.accent,fontFamily:"'DM Sans',sans-serif",letterSpacing:-.4,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
            {task?'Editar tarea':'Nueva tarea'}
            {selectedClient&&<><span style={{color:C.textSoft,fontWeight:400,margin:'0 7px'}}>|</span><span onClick={()=>{setSelectedClient(null);setQ('')}} title='Cambiar cliente' style={{color:C.muted,fontWeight:600,cursor:'pointer',textDecoration:'underline',textDecorationColor:C.done,textUnderlineOffset:3}}>{selectedClient.name}</span></>}
          </span>
        </div>
        <button className='qt-close' onClick={onClose} aria-label='Cerrar' style={{background:'none',border:'none',color:C.muted,fontSize:24,cursor:'pointer',lineHeight:1,width:40,height:44,display:'flex',alignItems:'center',justifyContent:'center',marginRight:-8}}>x</button>
      </div>

      <div className='qt-body'>
      {!selectedClient ? (
        <>
          <Fld label='Cliente'>
            <Inp value={q} onChange={e=>setQ(e.target.value)} placeholder='Buscar cliente…' autoFocus/>
          </Fld>
          {(()=>{ const lista = q.trim()?matches:recientes; return lista.length>0 ? (
            <>
              {!q.trim()&&<div style={{...SEC_LBL,marginBottom:8}}>Recientes</div>}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>{lista.map(ClientCard)}</div>
            </>
          ) : (
            <div style={{fontSize:13,color:C.muted,padding:'4px 0'}}>{q.trim()?`Sin resultados para "${q}"`:'Aún no hay clientes recientes. Escribe para buscar.'}</div>
          ) })()}
        </>
      ) : (
        <>
          {yaDelegada&&<DelegBanner/>}

          {multiRS ? (
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              <Fld label='Razón social'>
                <select value={f.entity_id||''} onChange={e=>up('entity_id',e.target.value)} style={selBox}>
                  {clientEnts.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </Fld>
              <Fld label={<ReqLabel>Proyecto</ReqLabel>}>
                <div style={{position:'relative'}}>
                  <Inp value={f.project||''} onChange={e=>up('project',e.target.value)} onFocus={()=>setShowProjects(true)} onBlur={()=>setTimeout(()=>setShowProjects(false),150)} placeholder={clientProjects.length>0?'Elige o escribe...':'Nombre del proyecto...'}/>
                  {showProjects&&clientProjects.length>0&&(
                    <div style={{position:'absolute',top:'100%',left:0,right:0,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,boxShadow:'0 4px 16px rgba(0,0,0,.10)',zIndex:100,marginTop:4,maxHeight:180,overflowY:'auto'}}>
                      {clientProjects.filter(p=>!f.project||p.toLowerCase().includes(f.project.toLowerCase())).map((p,i)=>(
                        <div key={i} onMouseDown={()=>up('project',p)} style={{padding:'9px 14px',cursor:'pointer',borderBottom:`1px solid ${C.border}`,fontSize:13,color:C.text}} onMouseEnter={e=>e.currentTarget.style.background=C.bgSoft} onMouseLeave={e=>e.currentTarget.style.background='#fff'}>{p}</div>
                      ))}
                    </div>
                  )}
                </div>
              </Fld>
            </div>
          ) : (
            <Fld label={<ReqLabel>Proyecto</ReqLabel>}>
              <div style={{position:'relative'}}>
                <Inp value={f.project||''} onChange={e=>up('project',e.target.value)} onFocus={()=>setShowProjects(true)} onBlur={()=>setTimeout(()=>setShowProjects(false),150)} placeholder={clientProjects.length>0?'Elige uno existente o escribe uno nuevo...':'Nombre del proyecto...'}/>
                {showProjects&&clientProjects.length>0&&(
                  <div style={{position:'absolute',top:'100%',left:0,right:0,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,boxShadow:'0 4px 16px rgba(0,0,0,.10)',zIndex:100,marginTop:4,maxHeight:180,overflowY:'auto'}}>
                    {clientProjects.filter(p=>!f.project||p.toLowerCase().includes(f.project.toLowerCase())).map((p,i)=>(
                      <div key={i} onMouseDown={()=>up('project',p)} style={{padding:'9px 14px',cursor:'pointer',borderBottom:`1px solid ${C.border}`,fontSize:13,color:C.text}} onMouseEnter={e=>e.currentTarget.style.background=C.bgSoft} onMouseLeave={e=>e.currentTarget.style.background='#fff'}>{p}</div>
                    ))}
                  </div>
                )}
              </div>
            </Fld>
          )}

          {multiRS&&(
            <Fld label={<ReqLabel>Subproyecto</ReqLabel>}>
              {subNew ? (
                <div style={{display:'flex',gap:6}}>
                  <Inp value={f.subproject||''} onChange={e=>up('subproject',e.target.value)} placeholder='Nombre del subproyecto...' autoFocus/>
                  <button onClick={()=>{up('subproject','');setSubNew(false)}} style={{padding:'0 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:12,cursor:'pointer',flexShrink:0}}>x</button>
                </div>
              ) : (
                <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                  {clientSubprojects.map(s=>(<button key={s} onClick={()=>up('subproject',s)} style={pill(f.subproject===s)}>{s}</button>))}
                  <button onClick={()=>{up('subproject','');setSubNew(true)}} style={{fontSize:12,padding:'6px 12px',borderRadius:20,border:`1px dashed ${C.done}`,background:'#fff',color:C.muted,cursor:'pointer'}}>+ Nuevo</button>
                </div>
              )}
            </Fld>
          )}

          <Fld label='Descripción de la tarea'><textarea value={f.title} onChange={e=>up('title',e.target.value)} placeholder='Describe la tarea...' rows={3} style={{width:'100%',padding:'10px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:C.bgSoft,color:C.text,fontSize:14,boxSizing:'border-box',resize:'vertical',fontFamily:'inherit'}}/></Fld>

          <Fld label='Responsables'>
            <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
              {WHO.map(w=>{ const on=(f.assignees||[]).includes(w); const pc=personChip(w); return (
                <button key={w} onClick={()=>toggleResp(w)} style={{fontSize:12,fontWeight:on?700:500,padding:'5px 13px',borderRadius:20,border:`1px solid ${on?pc.color:C.border}`,background:on?pc.bg:'#fff',color:on?pc.color:C.muted,cursor:'pointer'}}>{w}</button>
              )})}
            </div>
          </Fld>

          {/* Quién la encargó: queda como asignador (aparece en su "Tareas que asigné" y le llega el aviso al terminarla). */}
          {!esEdicion&&(
            <Fld label='Encargada por'>
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                {WHO.map(w=>{ const on=f.assigned_by===w; const pc=personChip(w); return (
                  <button key={w} onClick={()=>up('assigned_by',w)} style={{fontSize:12,fontWeight:on?700:500,padding:'5px 13px',borderRadius:20,border:`1px solid ${on?pc.color:C.border}`,background:on?pc.bg:'#fff',color:on?pc.color:C.muted,cursor:'pointer'}}>{w===me?`${w} (yo)`:w}</button>
                )})}
              </div>
            </Fld>
          )}

          <Fld label='Plazo'>
            <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
              {presets.map(([lbl,iso])=>(<button key={iso} onClick={()=>{up('due',iso);setShowDate(false)}} style={pill(f.due===iso)}>{lbl}</button>))}
              <button onClick={()=>setShowDate(true)} style={pill(isCustomDue||showDate)}>Otra fecha</button>
              {(showDate||isCustomDue)&&<Inp type='date' value={f.due} onChange={e=>up('due',e.target.value)} style={{width:160}}/>}
            </div>
          </Fld>

          {(task?.id||selectedClient)&&(
            <div style={{marginTop:4}}>
              <Attachments table='task_attachments' idField='task_id' entityId={task?.id||draftId} ensureEntityId={ensureTaskId} folderKind='tareas'
                namePrefix={`${selectedClient?.name||'Sin cliente'} · ${f.title||'Tarea'}`} user={user}/>
            </div>
          )}
          {esEdicion&&soyResponsable&&(
            <>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'11px 0',borderTop:`1px solid ${C.border}`,marginBottom:deleg?12:0}}>
                <div style={{fontSize:13,color:C.accent,fontWeight:500}}>Delegar</div>
                <button onClick={()=>setDeleg(v=>!v)} style={{width:42,height:24,borderRadius:20,background:deleg?C.accent:C.border,position:'relative',border:'none',cursor:'pointer',flexShrink:0,padding:0}}>
                  <span style={{position:'absolute',top:2,left:deleg?20:2,width:20,height:20,borderRadius:'50%',background:'#fff',transition:'left .15s'}}/>
                </button>
              </div>
              {deleg&&(
                <>
                  <Fld label='Delegar a'>
                    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                      {WHO.filter(w=>w!==me).map(w=>{ const on=delegTo.includes(w); return (
                        <button key={w} onClick={()=>toggleDelegTo(w)} style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:12,fontWeight:on?600:500,padding:'5px 11px 5px 5px',borderRadius:20,border:`1px solid ${on?C.accent:C.border}`,background:on?C.azulBg:C.bgSoft,color:on?C.accent:C.muted,cursor:'pointer'}}>
                          <span style={{width:22,height:22,borderRadius:'50%',background:on?C.accent:C.done,color:'#fff',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:700}}>{INICIALES_RESP[w]||w.slice(0,2).toUpperCase()}</span>{w}
                        </button>
                      )})}
                    </div>
                  </Fld>
                  <Fld label='Nuevo plazo'>
                    <Inp type='date' value={delegDue} max={maxDelegDue||undefined} onChange={e=>setDelegDue(e.target.value)} style={{width:170}}/>
                    {maxDelegDue&&<div style={{fontSize:11,color:delegDue&&!delegDueOk?C.overdue:C.muted,marginTop:5}}>Máximo {maxDelegDue} (plazo original + 3 días){delegDue&&!delegDueOk?' — excede el límite':''}</div>}
                  </Fld>
                  <Fld label='Motivo *'>
                    <textarea value={delegNota} onChange={e=>setDelegNota(e.target.value)} placeholder='Ej: me voy de vacaciones, la sigue Rodrigo' rows={2} style={{width:'100%',boxSizing:'border-box',padding:'9px 11px',borderRadius:10,border:`1px solid ${C.border}`,fontSize:13,color:C.text,resize:'vertical',fontFamily:'inherit',lineHeight:1.4,outline:'none'}}/>
                  </Fld>
                </>
              )}
            </>
          )}
        </>
      )}

      <div style={{display:'flex',gap:8,marginTop:8}}>
        <button onClick={onClose} style={{flex:1,padding:'9px 14px',borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
        {selectedClient&&(deleg ? (
          <button disabled={saving||!puedeDelegar} onClick={handleDelegar}
            style={{flex:2,padding:'9px 14px',borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:puedeDelegar?'pointer':'not-allowed',display:'flex',alignItems:'center',justifyContent:'center',gap:8,opacity:puedeDelegar?1:.6}}>
            {saving?<Spin/>:null}{saving?'Delegando...':'Delegar'}
          </button>
        ) : (
          <button disabled={saving||!canSave} onClick={handleGuardar}
            style={{flex:2,padding:'9px 14px',borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:canSave?'pointer':'not-allowed',display:'flex',alignItems:'center',justifyContent:'center',gap:8,opacity:canSave?1:.6}}>
            {saving?<Spin/>:null}{saving?'Guardando...':(task?'Guardar tarea':'Enviar tarea')}
          </button>
        ))}
      </div>
      </div>
    </>
  )
}

