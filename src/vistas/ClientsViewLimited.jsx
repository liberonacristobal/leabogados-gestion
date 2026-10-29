// Movido desde App.jsx por scripts/mover-a-modulo.py. Sin cambios de comportamiento.
import { useState, useEffect } from 'react'
import { fgCliente } from '../../supabase/functions/_shared/gastosReglas.js'
import { C, Gl, SEC_LBL, SIcon, _normTxt, fmtFechaDMY, fmtRutCL, personChip, useIsDesktop } from '../lib/base.jsx'
import { ActBtn, CAT_COLORS, ChipSearch, Copyable, DriveIcon, FichaTabs, FlujoPagina, NOMBRE_CLI, bigDate, chipBtn, driveBtn, rsDisplay, rsLabel } from '../lib/compartido.jsx'
import { ContactoTab, EstadoCuentaTab, FinancieroTab, FotoCliente } from '../lib/fichaCliente.jsx'
import { RendicionEmailModal, RendicionModal } from '../lib/rendiciones.jsx'

// ─── CLIENTS VIEW LIMITED ──────────────────────────────────────────────────
// Recuadros de filtro de estado de clientes (Activos / Terminados / Todos) — compartido admin/limited
export function ClientStatusTabs({value,onChange,activeN,endedN,prospectoN}){
  return (
    <div style={{display:'flex',gap:6,marginBottom:4}}>
      {[['Activo',`Activos (${activeN})`],['Prospecto',`Prospectos (${prospectoN})`],['Terminado',`Terminados (${endedN})`],['all','Todos']].map(([v,l])=>(
        <button key={v} onClick={()=>onChange(v)} style={{flex:1,padding:'7px 0',borderRadius:8,border:`1px solid ${value===v?C.accent:C.border}`,background:value===v?C.azulBg:'transparent',color:value===v?C.accent:C.muted,fontSize:11,fontWeight:600,cursor:'pointer'}}>{l}</button>
      ))}
    </div>
  )
}

export function ClientsViewLimited({onContactos=null,onCausas=null,openFichaId=null,onOpenedFicha=null,onAsociarTrabajo=null,clients,expenses,tasks,clientEntities,rendiciones,sales=[],billing=[],anticipos=[],currentUserName,onEdit,onAdd,onAddTask,onQuickTask,onAddGasto,onAddFondo,onAddSale,onAddBilling,onEditBilling,onNuevoAnticipo,onConciliar,onOpenSale,onAjuste,onAssignSeries,onStatusChange,onEditTask,onEditExpense,onSaveFields,onImportDrive,setExpenses,setRendiciones,setBilling,user,onRendicionComplete}) {
  const [q,setQ] = useState('')
  const [rendicionClient,setRendicionClient] = useState(null), [rendEdit,setRendEdit] = useState(null), [emailRendCV,setEmailRendCV] = useState(null)   // Rendir desde la ficha completa (responsable)
  const [selected,setSelected] = useState(null)
  const isDesktop = useIsDesktop()
  const [confirmEdit,setConfirmEdit] = useState(null)
  const [openRend,setOpenRend] = useState(null)
  const [openEnt,setOpenEnt] = useState(false)   // caja "Razones sociales facturadas", colapsada por defecto
  const [sFilter,setSFilter] = useState('Activo')
  const [ftab,setFtab] = useState('resumen')
  // Salto desde otra vista (tocar el nombre del cliente en Gastos/Tareas): abre su ficha. Los limited ven la ficha sin honorarios (FichaTabs role limited).
  useEffect(()=>{ if(openFichaId){ const c=clients.find(x=>String(x.id)===String(openFichaId)); if(c){ setFtab('resumen'); setSelected(c) } onOpenedFicha&&onOpenedFicha() } },[openFichaId])

  const activeN=clients.filter(c=>!c.is_internal&&(c.status||'Activo')==='Activo').length
  const endedN=clients.filter(c=>!c.is_internal&&c.status==='Terminado').length
  const prospectoN=clients.filter(c=>!c.is_internal&&c.status==='Prospecto').length
  const filtered = clients.filter(c=>{
    if(c.is_internal) return false   // la oficina (Liberona Escala) no es un cliente: los limited no la ven ni sus costos (sueldos/arriendo)
    if(sFilter==='Activo' && (c.status||'Activo')!=='Activo') return false
    if(sFilter==='Terminado' && c.status!=='Terminado') return false
    if(sFilter==='Prospecto' && c.status!=='Prospecto') return false
    if(q.trim() && !_normTxt(c.name).includes(_normTxt(q))) return false
    return true
  }).sort((a,b)=>(a.name||'').localeCompare(b.name||''))


  const Ficha = ({cl}) => {
    // El limited ve la ficha completa (Financiero + Estado de cuenta) solo en los clientes de los que es responsable.
    const esResp = !!currentUserName && (sales||[]).some(s=>s&&String(s.client_id)===String(cl.id))   // sales ya llega filtrado a SUS ventas
    const effTab = (esResp||ftab==='resumen'||ftab==='contacto') ? ftab : 'resumen'
    const clientBilling = (billing||[]).filter(b=>b.client_id===cl.id)
    const clientExpenses = expenses.filter(e=>e.client_id===cl.id).sort((a,b)=>b.date>a.date?1:-1)
    const {fondos,gastos,saldo} = fgCliente(expenses, cl.id)   // fuente única (no duplicar la fórmula de saldo inline)
    const clientTasks = tasks.filter(t=>t.client_id===cl.id&&t.status!=='Terminado')
    const entities = (clientEntities||[]).filter(e=>e.client_id===cl.id)
    const CATS = CAT_COLORS
    const Chev = ({mt=0}) => <span className="lf-chev" aria-hidden="true" style={{fontSize:18,lineHeight:1,flexShrink:0,marginLeft:6,marginTop:mt,fontWeight:400}}><Gl n='chevron'/></span>

    return (
      <div style={{paddingBottom:100}}>
        <div style={{padding:'16px 20px 12px',position:'sticky',top:0,background:C.bgSoft,zIndex:10,borderBottom:'1px solid #E4E8EB'}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <button onClick={()=>setSelected(null)} style={{background:'none',border:'none',color:C.accent,cursor:'pointer',fontSize:20,padding:'0 4px 0 0'}}><Gl n='chevL'/></button>
            <div style={{flex:1}}>
              <div style={{fontSize:18,fontWeight:700,color:C.text}}>{cl.name}</div>
              <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                {cl.type&&<span style={{fontSize:11,color:C.muted}}>{cl.type}</span>}
                {cl.abogado_responsable&&(()=>{ const pc=personChip(cl.abogado_responsable); return <span style={{fontSize:11,color:pc.color,fontWeight:700}}>{cl.abogado_responsable}</span> })()}
              </div>
            </div>
            <ActBtn variant='ghost' onClick={()=>onEdit(cl)}>Editar</ActBtn>
          </div>
          <FichaTabs tab={effTab} setTab={setFtab} role={esResp?'admin':'limited'}/>
        </div>

        <div style={{padding:'16px 20px 0',display:effTab==='resumen'?'block':'none'}}>
          {esResp&&<FotoCliente client={cl} sales={sales} billing={billing} expenses={expenses} tasks={tasks} setFtab={setFtab} onRendicion={setRendicionClient?(c=>{setRendEdit(null);setRendicionClient(c)}):undefined} onEditExpense={onEditExpense} onEditBilling={onEditBilling} onEditTask={onEditTask} onAddTask={onAddTask?()=>onAddTask(cl):undefined}/>}

          {entities.length>0&&(
            <div style={{marginBottom:16,padding:'4px 14px',borderRadius:10,background:C.bgSoft,border:'1px solid #E4E8EB'}}>
              <div className="lf-row" onClick={()=>setOpenEnt(o=>!o)} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,padding:'8px 0'}}>
                <div style={{display:'flex',alignItems:'center',gap:6,fontSize:10,color:C.muted,textTransform:'uppercase',letterSpacing:.5,fontWeight:600}}>
                  <span aria-hidden="true" style={{display:'inline-block',transform:openEnt?'rotate(90deg)':'none',transition:'transform .12s',fontSize:14,lineHeight:1}}><Gl n='chevron'/></span>
                  Razones sociales facturadas
                </div>
                <span style={{fontSize:9,color:C.muted,fontWeight:700}}>{entities.length}</span>
              </div>
              {openEnt&&entities.map(e=>(
                <div key={e.id} className="lf-row" onClick={()=>setFtab('contacto')} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,padding:'6px 0',borderTop:'1px solid #E4E8EB'}}>
                  <div style={{fontSize:12,fontWeight:500,color:C.text,flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{rsDisplay(e.name)||'—'}</div>
                  {e.rut&&<Copyable text={e.rut} title='Copiar RUT' style={{fontSize:11,color:C.muted}}>{fmtRutCL(e.rut)}</Copyable>}
                  <Chev/>
                </div>
              ))}
            </div>
          )}

          <div style={{marginBottom:20}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
              <div style={{...SEC_LBL}}>Gastos y Fondos</div>
            </div>
            {(()=>{ const sNeg=saldo<0, sZero=saldo===0
              const bg=sNeg?C.overdueBg:sZero?C.bgWarm:C.greenBg, col=sNeg?C.overdue:sZero?C.grisText:C.greenText, line=sNeg?C.overdue:sZero?C.border:C.normal
              const plus=(onClick,bgc,al)=>(<button onClick={onClick} aria-label={al} style={{width:18,height:18,borderRadius:'50%',background:bgc,border:'none',cursor:'pointer',display:'inline-flex',alignItems:'center',justifyContent:'center',padding:0,flexShrink:0}}><svg width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='#fff' strokeWidth='3.5' strokeLinecap='round'><line x1='12' y1='5' x2='12' y2='19'/><line x1='5' y1='12' x2='19' y2='12'/></svg></button>)
              return (
              <div style={{background:bg,borderRadius:10,padding:'12px 14px',marginBottom:10}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
                  <div style={{minWidth:0}}>
                    <div style={{...SEC_LBL}}>Saldo{sNeg?' · por reembolsar':saldo>0?' · a favor':''}</div>
                    <div style={{fontSize:21,fontWeight:700,color:col,marginTop:1}}>${saldo.toLocaleString('es-CL')}</div>
                  </div>
                  {saldo>0&&onAddFondo&&<button onClick={()=>onAddFondo(cl,true)} aria-label='Devolver saldo a favor' title='Devolver saldo a favor' style={{flexShrink:0,height:24,padding:'0 11px',borderRadius:8,border:`0.5px solid ${C.normal}`,background:'#fff',color:C.greenText,fontSize:11,fontWeight:600,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:5}}>Devolver<svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round'><line x1='5' y1='12' x2='19' y2='12'/><polyline points='13 6 19 12 13 18'/></svg></button>}
                </div>
                <div style={{display:'flex',gap:18,marginTop:9,paddingTop:9,borderTop:`0.5px solid ${line}`,flexWrap:'wrap'}}>
                  <div style={{display:'flex',alignItems:'center',gap:6}}><span style={{fontSize:11,color:C.muted}}>Fondos</span><span style={{fontSize:12,fontWeight:600,color:C.normal}}>+${fondos.toLocaleString('es-CL')}</span>{plus(()=>onAddFondo(cl),C.normal,'Agregar fondo')}</div>
                  <div style={{display:'flex',alignItems:'center',gap:6}}><span style={{fontSize:11,color:C.muted}}>Gastos</span><span style={{fontSize:12,fontWeight:600,color:C.overdue}}>−${gastos.toLocaleString('es-CL')}</span>{plus(()=>onAddGasto(cl),C.overdue,'Agregar gasto')}</div>
                </div>
              </div>
            )})()}
            {clientExpenses.slice(0,8).map(e=>{
              const isFondo=e.type==='fondo'
              const isDev=isFondo&&((e.amount||0)<0||/^\s*devoluci/i.test(e.concept||''))
              const catBg=CATS[e.category]||CATS['Otro']
              return (
                <div key={e.id} className={onEditExpense?'lf-row':undefined} onClick={onEditExpense?()=>onEditExpense(e):undefined} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:'1px solid #E4E8EB'}}>
                  <div style={{minWidth:0,flex:1,display:'flex',gap:6,alignItems:'center'}}>
                    {!isFondo&&e.category&&<span style={{fontSize:9.5,padding:'2px 8px',borderRadius:20,background:catBg,color:C.muted,fontWeight:700,flexShrink:0,whiteSpace:'nowrap'}}>{e.category}</span>}
                    {isFondo&&<span style={{fontSize:9.5,padding:'2px 8px',borderRadius:20,background:isDev?C.azulBg:C.greenBg,color:isDev?C.azulInfo:C.normal,fontWeight:700,flexShrink:0,whiteSpace:'nowrap'}}>{isDev?'Devolución':'Fondo'}</span>}
                    <span style={{fontSize:12,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.concept||'—'}</span>
                  </div>
                  <div style={{fontSize:12,fontWeight:600,color:isDev?C.muted:isFondo?C.normal:C.overdue,flexShrink:0,marginLeft:8}}>{isDev?'−$'+Math.abs(e.amount).toLocaleString('es-CL'):(isFondo?'+':'-')+'$'+e.amount.toLocaleString('es-CL')}</div>
                  {onEditExpense&&<Chev/>}
                </div>
              )
            })}
          </div>

          {(()=>{
            const rends=(rendiciones||[]).filter(r=>r.client_id===cl.id&&r.tipo==='cliente').sort((a,b)=>b.created_at>a.created_at?1:-1)
            if(!rends.length) return null
            return (
              <div style={{marginBottom:20}}>
                <div style={{...SEC_LBL,marginBottom:8}}>Rendiciones realizadas</div>
                {rends.map(r=>{
                  const isOpen=openRend===r.id
                  const det=expenses.filter(e=>e.client_render_id===r.id).sort((a,b)=>b.date>a.date?1:-1)
                  return (
                    <div key={r.id} style={{borderBottom:'1px solid #E4E8EB'}}>
                      <div onClick={()=>setOpenRend(isOpen?null:r.id)} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',cursor:'pointer'}}>
                        <div style={{display:'flex',alignItems:'center',gap:10,minWidth:0,flex:1}}>
                          {bigDate(r.created_at)}
                          <div style={{minWidth:0}}>
                          <div style={{fontSize:12,fontWeight:600,color:C.text}}>{r.periodo}</div>
                          <div style={{fontSize:10,color:C.muted}}>{r.n_gastos} gasto{r.n_gastos!==1?'s':''}{r.user_name?` · ${r.user_name}`:''}</div>
                          </div>
                        </div>
                        <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
                          <div style={{fontSize:12,fontWeight:700,color:C.overdue}}>-${(r.total||0).toLocaleString('es-CL')}</div>
                          <span style={{fontSize:11,color:C.muted,transform:isOpen?'rotate(180deg)':'none',display:'inline-block',transition:'transform .2s'}}><Gl n='chevD'/></span>
                        </div>
                      </div>
                      {isOpen&&(
                        <div style={{padding:'2px 0 10px 4px'}}>
                          {det.length===0&&<div style={{fontSize:11,color:C.muted,padding:'4px 0'}}>Sin detalle disponible</div>}
                          {det.map(e=>(
                            <div key={e.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'5px 0',borderBottom:'1px solid #E4E8EB'}}>
                              <div style={{minWidth:0,flex:1,display:'flex',gap:6,alignItems:'center'}}>
                                {e.category&&<span style={{fontSize:9.5,padding:'2px 8px',borderRadius:20,background:CATS[e.category]||CATS['Otro'],color:C.muted,fontWeight:700,flexShrink:0,whiteSpace:'nowrap'}}>{e.category}</span>}
                                <span style={{fontSize:12,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.concept||'—'}</span>
                              </div>
                              <div style={{fontSize:11,color:C.muted,flexShrink:0,marginLeft:8}}>{fmtFechaDMY(e.date)}</div>
                              <div style={{fontSize:12,fontWeight:600,color:C.overdue,flexShrink:0,marginLeft:8}}>-${(e.amount||0).toLocaleString('es-CL')}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })()}

          <div style={{marginBottom:20}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
              <div style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:'uppercase',letterSpacing:.5}}>Tareas</div>
              <button onClick={()=>onAddTask(cl)} style={chipBtn('soft')}>+ Tarea</button>
            </div>
            {onQuickTask&&<input placeholder='Nueva tarea… (Enter para crear)' onKeyDown={e=>{ const v=e.target.value.trim(); if(e.key==='Enter'&&v){ onQuickTask(cl,v); e.target.value='' } }} style={{width:'100%',height:34,border:`0.5px solid ${C.border}`,borderRadius:8,fontSize:13,padding:'0 11px',boxSizing:'border-box',outline:'none',color:C.text,marginBottom:8}}/>}
            {clientTasks.length===0&&<div style={{fontSize:12,color:C.muted}}>Sin tareas activas</div>}
            {clientTasks.map(t=>(
              <div key={t.id} className={onEditTask?'lf-row':undefined} onClick={onEditTask?()=>onEditTask(t):undefined} style={{display:'flex',alignItems:'center',gap:8,padding:'9px 0',borderBottom:'1px solid #E4E8EB'}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,color:C.text,fontWeight:500}}>{t.title}</div>
                  {t.due&&<div style={{fontSize:11,color:C.muted,marginTop:2}}>Vence: {fmtFechaDMY(t.due)}</div>}
                </div>
                {onEditTask&&<Chev/>}
              </div>
            ))}
          </div>

        </div>
        {effTab==='contacto'&&<ContactoTab client={cl} entities={entities} onSaveFields={onSaveFields}/>}
        {esResp&&effTab==='financiero'&&<FinancieroTab client={cl} clientBilling={clientBilling} entities={entities} sales={sales} anticipos={(anticipos||[]).filter(a=>a.client_id===cl.id)} billing={billing} onNuevoAnticipo={()=>onNuevoAnticipo&&onNuevoAnticipo(cl)} onSaveFields={onSaveFields} onEditBilling={onEditBilling} onAddBilling={()=>onAddBilling&&onAddBilling(cl)} onConciliar={()=>onConciliar&&onConciliar(cl)} onAssignSeries={onAssignSeries} onStatusChange={onStatusChange}/>}
        {esResp&&effTab==='documentos'&&<EstadoCuentaTab onAsociarTrabajo={onAsociarTrabajo} client={cl} clientBilling={clientBilling} sales={sales} anticipos={(anticipos||[]).filter(a=>a.client_id===cl.id)} expenses={expenses} clientEntities={entities} onEditExpense={onEditExpense} onEditBilling={onEditBilling} onOpenSale={onOpenSale} onAjuste={onAjuste}/>}
      </div>
    )
  }

  const listInner = (<>
      <div style={{padding:'20px 20px 10px',position:'sticky',top:0,background:C.bgSoft,zIndex:10}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10,flexWrap:'wrap',gap:8}}>
          <div style={{fontSize:20,fontWeight:600,color:C.text,fontFamily:"'DM Sans',sans-serif",letterSpacing:-.4}}>Clientes</div>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            {onImportDrive&&<button onClick={onImportDrive} title='Importar desde Drive' style={driveBtn}><DriveIcon size={20}/></button>}
            {onContactos&&<button onClick={onContactos} style={{...chipBtn('soft'),color:C.accent}}>Contactos</button>}
            {onCausas&&<button onClick={onCausas} style={{...chipBtn('soft'),color:C.accent}}>Causas</button>}
            {onAdd&&<button onClick={onAdd} style={chipBtn('primary')}>+ Cliente</button>}
          </div>
        </div>
        <ChipSearch value={q} onChange={e=>setQ(e.target.value)} placeholder='Buscar cliente…' style={{marginBottom:8}}/>
        <ClientStatusTabs value={sFilter} onChange={setSFilter} activeN={activeN} endedN={endedN} prospectoN={prospectoN}/>
      </div>
      <div style={{padding:'4px 20px 100px'}}>
        {filtered.length===0&&<div style={{color:C.muted,textAlign:'center',padding:40}}>Sin clientes</div>}
        {filtered.length>0&&(()=>{
          // Directorio A-Z (mismo patrón que la vista admin): inicial + avatar empresa/persona del color del responsable + índice lateral, sin cifras.
          const norm=s=>(s||'').trim().toUpperCase()
          const letterOf=cl=>{ const ch=norm(cl.name)[0]||'#'; return /[A-ZÑ]/.test(ch)?ch:'#' }
          const byLetter={}; filtered.forEach(cl=>{ const L=letterOf(cl); (byLetter[L]=byLetter[L]||[]).push(cl) })
          const letters=Object.keys(byLetter).sort((a,b)=>a.localeCompare(b,'es'))
          const idFor=L=>'climl-letter-'+(L==='#'?'num':L)
          const card=cl=>{
            const ended=cl.status==='Terminado'
            const resp=cl.abogado_responsable; const pc=resp?personChip(resp):{bg:C.bgWarm,color:C.textSoft}
            const esEmpresa=/\b(spa|s\.?p\.?a|ltda|limitada|s\.?a|sociedad|inversiones|comercial|constructora|consultores|holding|cia|cía|asociados|partners)\b/i.test(cl.name||'')||/empresa|corp|sociedad/i.test(cl.type||'')
            const tareasC=(tasks||[]).filter(t=>t.client_id===cl.id&&t.status!=='Terminado').length
            const rs=rsLabel(cl.id,clients,clientEntities)
            const sub=rs.multi?`${rs.multi} razones sociales`:(rs.name&&rs.name!==cl.name?rsDisplay(rs.name):(cl.type||''))
            return (
              <div key={cl.id} onClick={()=>{setFtab('resumen');setSelected(cl)}} style={{background:'#fff',borderRadius:12,padding:'10px 12px',marginBottom:6,border:`1px solid ${C.border}`,opacity:ended?.55:1,cursor:'pointer',display:'flex',alignItems:'center',gap:11}}>
                <span style={{width:38,height:38,borderRadius:10,background:pc.bg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SIcon n={esEmpresa?'building':'user'} s={18} c={pc.color}/></span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{...NOMBRE_CLI}}>{cl.name}{tareasC>0&&<span style={{fontSize:9.5,fontWeight:700,color:C.soonText,background:C.soonBg,borderRadius:20,padding:'2px 8px',marginLeft:6,whiteSpace:'nowrap'}}>{tareasC} {tareasC===1?'tarea':'tareas'}</span>}</div>
                  {sub&&<div style={{fontSize:10,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginTop:1}}>{sub}</div>}
                </div>
                {resp&&<span style={{flexShrink:0,fontSize:11,color:pc.color,fontWeight:700,whiteSpace:'nowrap'}}>{resp}</span>}
                <button onClick={ev=>{ev.stopPropagation();onSaveFields&&onSaveFields(cl.id,{status:ended?'Activo':'Terminado'})}} title={ended?'Reactivar cliente':'Archivar cliente'} style={{flexShrink:0,width:24,height:24,borderRadius:6,border:`0.5px solid ${ended?C.normal:C.border}`,background:'transparent',color:ended?C.greenText:C.done,cursor:'pointer',display:'inline-flex',alignItems:'center',justifyContent:'center',padding:0}}>{ended?<svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><path d='M3 7v6h6'/><path d='M3.5 13a9 9 0 1 0 2.5-6.5L3 9'/></svg>:<svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><rect x='3' y='4' width='18' height='4' rx='1'/><path d='M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8'/><line x1='10' y1='12' x2='14' y2='12'/></svg>}</button>
              </div>
            )
          }
          return (<div style={{display:'flex',gap:8}}>
            <div style={{flex:1,minWidth:0}}>
              {letters.map(L=>(<div key={L} id={idFor(L)}>
                <div style={{fontSize:12,fontWeight:700,color:C.textSoft,margin:'9px 2px 5px'}}>{L}</div>
                {byLetter[L].slice().sort((a,b)=>(a.name||'').localeCompare(b.name||'','es')).map(card)}
              </div>))}
            </div>
            <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:1,flexShrink:0,position:'sticky',top:70,alignSelf:'flex-start'}}>
              {'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(L=>{ const has=!!byLetter[L]; return <span key={L} onClick={has?()=>{const el=document.getElementById(idFor(L));el&&el.scrollIntoView({behavior:'smooth',block:'start'})}:undefined} style={{fontSize:11,fontWeight:has?700:400,color:has?C.accent:'#CBD5DB',cursor:has?'pointer':'default',lineHeight:1.3,padding:'3px 6px'}}>{L}</span> })}
            </div>
          </div>)
        })()}
      </div>
  </>)
  // Rendición y su correo = PÁGINAS (mismo flujo que la ficha de admin): '‹ cliente' vuelve a la ficha.
  if(rendicionClient&&setExpenses){ const cerrar=()=>{setRendicionClient(null);setRendEdit(null)}
    return <FlujoPagina origen={rendicionClient.name||'Clientes'} titulo={rendEdit?'Editar rendición':'Rendición'} onBack={cerrar} maxW={1180}><RendicionModal client={rendicionClient} expenses={expenses} clientEntities={clientEntities} sales={sales} rendiciones={rendiciones} onClose={cerrar} setExpenses={setExpenses} setRendiciones={setRendiciones} billing={billing} setBilling={setBilling} editRend={rendEdit} onRendicionComplete={onRendicionComplete||((r)=>setRendiciones&&setRendiciones(p=>[r,...p]))} onEnviar={r=>{setRendicionClient(null);setRendEdit(null);setEmailRendCV(r)}} asPage/></FlujoPagina> }
  if(emailRendCV){ const cli=clients.find(c=>String(c.id)===String(emailRendCV.client_id))
    return <FlujoPagina origen={cli?.name||'Clientes'} titulo='Enviar rendición' ctx={emailRendCV.correlativo?`N° ${emailRendCV.correlativo}`:null} onBack={()=>setEmailRendCV(null)} maxW={1180}><RendicionEmailModal asPage r={emailRendCV} client={cli} user={user} expenses={expenses} clientEntities={clientEntities} sales={sales} setExpenses={setExpenses} onSent={(id,at,corr)=>setRendiciones&&setRendiciones(p=>p.map(x=>x.id===id?{...x,sent_at:at,correlativo:corr??x.correlativo}:x))} onPatch={(id,patch)=>setRendiciones&&setRendiciones(p=>p.map(x=>x.id===id?{...x,...patch}:x))} onNext={x=>setEmailRendCV(x)} onClose={()=>setEmailRendCV(null)}/></FlujoPagina> }
  if(isDesktop) return (
    <div style={{display:'grid',gridTemplateColumns:'360px 1fr',height:'calc(100vh - 66px)',borderTop:`1px solid ${C.border}`}}>
      <div style={{overflowY:'auto',borderRight:`1px solid ${C.border}`,background:C.bgSoft}}>{listInner}</div>
      <div style={{overflowY:'auto',background:C.bg}}>{selected
        ? <div style={{maxWidth:760,margin:'0 auto'}}><Ficha cl={selected}/></div>
        : <div style={{height:'100%',display:'flex',alignItems:'center',justifyContent:'center',color:C.textSoft,fontSize:13,textAlign:'center',padding:24}}>Elige un cliente para ver su ficha</div>}</div>
    </div>
  )
  if(selected) return (<div style={{maxWidth:900,margin:'0 auto'}}><Ficha cl={selected}/></div>)
  return (<div style={{maxWidth:900,margin:'0 auto'}}>{listInner}</div>)
}

