// Movido desde App.jsx por scripts/mover-a-modulo.py. Sin cambios de comportamiento.
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabase'
import { VENTA_REAL, glosaKey, sugerirVentaGasto } from '../../supabase/functions/_shared/ventaGastoReglas.js'
import { C, Gl, SEC_LBL, Spin, appAlert, fmt, fmtFechaDMY, fmtRutCL, personChip, useIsDesktop } from '../lib/base.jsx'
import { Attachments, CATS_DE_CLIENTE, CATS_GASTO, ClientePicker, FloatFld, MEDIOS_MOV, MEDIO_CON_DETALLE, deQueOpciones, esPermanente, fInp, glosaMovilizacion, glosaSinDetalle, medioMovDe, subOtro, subproyectosCliente, useAprendidosVenta, useDeQueAprendido, useIaVenta } from '../lib/compartido.jsx'

// La subcategoría es propia de «Otro» y de toda categoría de oficina (Sueldos, Remuneraciones, Impuestos, Otros…); los trámites del cliente no la usan.
export const conSubcat = c => !!c && (c==='Otro' || !CATS_GASTO.includes(c))

// ── EXPENSE EDIT FORM (editar/eliminar registro individual) ───────────────────
export function ExpenseEditForm({expense,clients,clientEntities,expenses,sales=[],onSave,onRepartirFondo,onUnirFondo,onClose,onDelete,saving,user,onAttachChange}) {
  const _hoyISO = (()=>{ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` })()
  const [f,setF] = useState({...expense,amount:expense.amount||'',concept:expense.concept||'',category:expense.category||'Otro',date:expense.date||_hoyISO})
  // Movilización: medio + desde + hasta + motivo (mismo criterio que al registrar). Si la glosa ya viene armada, se precarga.
  const _Dmv = useIsDesktop()
  const [mv,setMv] = useState(()=>{ const m=String(expense.concept||'').match(/^Movilización (.+?)–(.+?)(?: para (.+))?$/); return {medio:expense.subcategory||medioMovDe(expense.concept), desde:m?m[1]:'', hasta:m?m[2]:'', motivo:m&&m[3]?m[3]:''} })
  const movDet = MEDIO_CON_DETALLE.has(mv.medio)
  // Trayecto y motivo se exigen al registrar, al pasar un gasto a Movilización, al tocar esos campos o al resolver una consulta.
  // Un gasto antiguo con glosa libre («Uber of a notaría…») se puede seguir editando (cliente, proyecto, monto…) sin reescribirla.
  const [mv0] = useState(mv)
  const movExige = f.type!=='fondo' && f.category==='Movilización' && (expense.category!=='Movilización' || JSON.stringify(mv)!==JSON.stringify(mv0) || expense.revision_estado==='consultar')
  const movFalta = movExige && (!mv.medio || (movDet && (!mv.desde.trim()||!mv.hasta.trim()||mv.motivo.trim().length<4)))
  // Trámite cuya glosa no dice de qué es (inmueble, sociedad o persona): mismo control que al registrar.
  const [deqE] = useDeQueAprendido()
  const detFalta = f.type!=='fondo' && CATS_DE_CLIENTE.has(f.category) && glosaSinDetalle(f.concept)
  // Al completar una movilización pendiente: glosa armada, medio en subcategoría, lo escrito antes a notas y la consulta queda resuelta.
  const movPatch = () => { if(f.type==='fondo'||f.category!=='Movilización'||!movExige) return {}
    if(!movDet) return {subcategory:mv.medio||null, concept:String(f.concept||'').trim()||mv.medio, ...(f.revision_estado==='consultar'?{revision_estado:'consulta_resuelta',revisado_at:new Date().toISOString()}:{})}
    const concept=glosaMovilizacion(mv.desde,mv.hasta,mv.motivo), orig=String(f.concept||'').trim()
    const notas = orig&&orig!==concept&&!/^Movilización .+–/.test(orig)&&!String(f.notas||'').includes(orig) ? [f.notas,`Glosa original: ${orig}`].filter(Boolean).join(' · ') : (f.notas||null)
    return {concept, subcategory:mv.medio||null, notas, ...(f.revision_estado==='consultar'?{revision_estado:'consulta_resuelta',revisado_at:new Date().toISOString()}:{})} }
  const [showPersonal,setShowPersonal] = useState(!!expense.personal_de)
  const [repOpen,setRepOpen] = useState(false)   // fondo: repartir entre proyectos
  const [partes,setPartes] = useState(()=>[{project:expense.project||'',monto:String(Math.round(Number(expense.amount)||0))},{project:'',monto:''}])
  const [repBusy,setRepBusy] = useState(false)
  const [internoOpen,setInternoOpen] = useState(false)   // popover "Gasto interno · ¿oficina o miembro?"
  const esOficinaCli = cid => { const c=clients.find(x=>String(x.id)===String(cid)); return !!c && (c.is_internal || /liberona\s+escala/i.test(c.name||'')) }
  const up=(k,v)=>setF(p=>({...p,[k]:v}))
  const client=clients.find(c=>c.id===f.client_id)
  const isFondo=f.type==='fondo'
  const rsList = (clientEntities||[]).filter(e=>e.client_id===f.client_id)
  // Asociar siempre a una RS por defecto: con una sola, se asigna sola si venía sin asignar.
  // Al cambiar de cliente, la razón social que no es suya se limpia (antes quedaba la del cliente anterior: Uber con la RS de la oficina).
  useEffect(()=>{ const propia=f.entity_id&&rsList.some(r=>r.id===f.entity_id); if(propia) return; const nueva=rsList.length===1?rsList[0].id:null; if((f.entity_id||null)!==nueva) setF(p=>({...p,entity_id:nueva})) },[f.client_id])
  // Trabajo sugerido si el gasto no tiene proyecto: regla única sugerirVentaGasto (aprendido, mismo día, razón social, texto…);
  // sin venta que calce, el último proyecto escrito para esa glosa.
  const aprVenta = useAprendidosVenta(), iaVenta = useIaVenta()
  const [sugProy,setSugProy] = useState(null)
  useEffect(()=>{
    if(isFondo || f.project || !f.concept || !f.client_id){ setSugProy(null); return }
    const vs=(sales||[]).filter(s=>String(s.client_id)===String(f.client_id)&&VENTA_REAL(s))
    const r=sugerirVentaGasto({...f,id:expense?.id}, vs, {aprendidos:aprVenta,hermanos:expenses||[],ia:iaVenta})
    const gk=glosaKey(f.concept), ult=gk?[...aprVenta].reverse().find(x=>x.key===`${f.client_id}::${gk}`):null
    setSugProy(r.venta?.title || ult?.value || null)
  },[f.concept,f.client_id,f.project,f.date,f.entity_id,isFondo,aprVenta,iaVenta])
  // Aprendizaje glosa→subcategoría: la misma glosa recurrente (Jumbo, Uber) propone su subcategoría con un toque, sin re-tipear (regla "la app APRENDE").
  const [sugSub,setSugSub] = useState(null)
  useEffect(()=>{
    if(isFondo || f.subcategory || !f.concept){ setSugSub(null); return }
    if(!conSubcat(f.category)){ setSugSub(null); return }
    const gk=glosaKey(f.concept); if(!gk){ setSugSub(null); return }
    let alive=true
    supabase.from('learnings').select('value').eq('kind','gasto_subcategoria').eq('key',gk).order('updated_at',{ascending:false}).limit(1).then(({data})=>{ if(alive) setSugSub(data&&data[0]?.value||null) },()=>{})
    return ()=>{alive=false}
  },[f.concept,f.subcategory,f.category,isFondo])
  // Proyecto = venta: sugerencias de los títulos de ventas del cliente + proyectos ya usados en otros gastos.
  const projectOpts = useMemo(()=>{
    const set=new Set()
    ;(sales||[]).filter(s=>s.client_id===f.client_id&&s.title).forEach(s=>set.add(s.title))
    ;(expenses||[]).filter(e=>e.client_id===f.client_id&&e.project).forEach(e=>set.add(e.project))
    return [...set].sort()
  },[sales,expenses,f.client_id])
  const personalOn = !!f.personal_de
  const [cambiarCli,setCambiarCli] = useState(false)   // el cliente vive en el encabezado; reasignar es una acción discreta
  return (
    <>
      {/* Cliente tappable arriba: abre buscador para reasignar el gasto a otro cliente. */}
      {!personalOn&&(cambiarCli
        ? <div style={{marginBottom:8,background:C.azulBg,borderRadius:8,padding:'9px 11px'}}>
            <div style={{fontSize:10,color:C.muted,fontWeight:600,marginBottom:5}}>Reasignar a otro cliente</div>
            <ClientePicker clients={clients} onPick={cid=>{setF(p=>({...p,client_id:cid,entity_id:null}));setCambiarCli(false)}}/>
            <button type='button' onClick={()=>setCambiarCli(false)} style={{marginTop:5,fontSize:11,color:C.muted,background:'none',border:'none',cursor:'pointer',padding:0}}>Cancelar</button>
          </div>
        : <div onClick={()=>{ if(f.client_render_id||f.render_id||f.notaria_render_id){ appAlert('Este gasto está en una rendición/liquidación. Reábrela antes de moverlo a otro cliente.'); return } setCambiarCli(true) }} title='Tocar para cambiar de cliente' style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,marginBottom:8,padding:'8px 11px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',cursor:'pointer'}}>
            <div style={{minWidth:0}}><div style={{...SEC_LBL}}>Cliente</div><div style={{fontSize:13,color:client?.name?C.accent:C.overdue,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{client?.name||'Sin cliente'}</div></div>
            <span style={{fontSize:11,color:C.azulInfo,fontWeight:600,whiteSpace:'nowrap',flexShrink:0}}>Cambiar <Gl n='chevD'/></span>
          </div>
      )}
      {/* Gasto interno: marcar el gasto como de la oficina o personal de un miembro (mismo patrón que la carga masiva). */}
      {!isFondo&&!personalOn&&!esOficinaCli(f.client_id)&&!(f.client_render_id||f.render_id||f.notaria_render_id)&&(
        internoOpen
          ? <div style={{marginBottom:8}}>
              <select autoFocus onChange={e=>{ const v=e.target.value; if(v==='__ofi'){ const ofi=clients.find(c=>c.is_internal||/liberona\s+escala/i.test(c.name||'')); if(ofi){ setF(p=>({...p,client_id:ofi.id,entity_id:null,personal_de:null})) } setShowPersonal(false) } else if(v){ up('personal_de',v);setShowPersonal(true) } setInternoOpen(false) }} style={{...fInp,cursor:'pointer'}} defaultValue=''>
                <option value=''>Gasto interno · elegir…</option>
                <optgroup label='Oficina'><option value='__ofi'>De la oficina</option></optgroup>
                <optgroup label='Del equipo'>{['Cristóbal','Erasmo','Martín','Martina','Rodrigo'].map(m=><option key={m} value={m}>{m}</option>)}</optgroup>
              </select>
            </div>
          : <button type='button' onClick={()=>setInternoOpen(true)} style={{marginBottom:8,fontSize:11,color:C.azulInfo,fontWeight:600,background:'none',border:'none',cursor:'pointer',padding:0}}>Gasto interno <Gl n='chevD'/></button>
      )}
      {/* Fila 1: Categoría · Monto · Fecha (categoría no aplica a fondos). Fecha = botón-calendario breve. */}
      <div style={{display:'grid',gridTemplateColumns:isFondo||!_Dmv?'minmax(0,1fr) minmax(0,1fr)':'1.05fr 1fr 0.92fr',gap:7,marginBottom:8}}>
        {!isFondo&&(<div style={{gridColumn:_Dmv?'auto':'1 / -1',minWidth:0}}>
          <FloatFld label='Categoría' mb={0}><select value={f.category} onChange={e=>up('category',e.target.value)} style={{...fInp,cursor:'pointer'}}>{(CATS_GASTO.includes(f.category)||!f.category?CATS_GASTO:[f.category,...CATS_GASTO]).map(o=><option key={o} value={o}>{o}</option>)}</select></FloatFld></div>
        )}
        <FloatFld label='Monto' mb={0}><input type='number' value={f.amount} onChange={e=>up('amount',e.target.value)} placeholder='0' style={fInp}/></FloatFld>
        <FloatFld label='Fecha' mb={0}>
          <div style={{position:'relative'}}>
            <div style={{...fInp,display:'flex',alignItems:'center',gap:4,color:f.date?C.text:C.muted,whiteSpace:'nowrap',overflow:'hidden'}}>
              <svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke={C.muted} strokeWidth='2' style={{flexShrink:0}}><rect x='3' y='4' width='18' height='18' rx='2'/><line x1='3' y1='9' x2='21' y2='9'/><line x1='8' y1='2' x2='8' y2='6'/><line x1='16' y1='2' x2='16' y2='6'/></svg>
              {f.date?fmtFechaDMY(f.date):'Fecha'}
            </div>
            <input type='date' value={f.date||''} onChange={e=>up('date',e.target.value)} onClick={e=>{try{e.currentTarget.showPicker&&e.currentTarget.showPicker()}catch{}}} style={{position:'absolute',inset:0,width:'100%',height:'100%',opacity:0,border:'none',margin:0,padding:0,cursor:'pointer'}}/>
          </div>
        </FloatFld>
      </div>
      {/* Slot condicional: OT (Notaría) o Subcategoría (Otro) */}
      {!isFondo&&f.category==='Notaria'&&(
        <FloatFld label='OT (notaría)'><input value={f.ot_number||''} onChange={e=>up('ot_number',e.target.value)} placeholder='Ej: OT-447206' style={fInp}/></FloatFld>
      )}
      {!isFondo&&conSubcat(f.category)&&(
        <FloatFld label='Subcategoría'>
          <input list='expense-subcats' value={f.subcategory||''} onChange={e=>up('subcategory',e.target.value)} placeholder='Ej: Supermercado, Aseo, Insumos...' style={fInp}/>
          <datalist id='expense-subcats'>{[...new Set((expenses||[]).filter(e=>e.subcategory).map(e=>e.subcategory))].sort().map(s=><option key={s} value={s}/>)}</datalist>
          {sugSub&&!f.subcategory&&<button type='button' onClick={()=>{up('subcategory',sugSub);setSugSub(null)}} style={{marginTop:5,fontSize:11,fontWeight:600,color:C.greenText,background:C.greenBg,border:'none',borderRadius:20,padding:'3px 10px',cursor:'pointer'}}>Sugerido por glosa: {sugSub}</button>}
        </FloatFld>
      )}
      <FloatFld label='Descripción'><textarea value={f.concept} onChange={e=>up('concept',e.target.value)} rows={2} placeholder='Descripción...' style={{...fInp,height:'auto',resize:'none',fontFamily:'inherit',paddingTop:2}}/></FloatFld>
      {detFalta&&(()=>{ const op=deQueOpciones(deqE,f.personal_de?`p:${f.personal_de}`:String(f.client_id||''),f.personal_de?null:f.client_id,clientEntities)
        return <div style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:6,margin:'-4px 0 10px',fontSize:12}}>
          <span style={{fontWeight:700,color:C.overdueText,whiteSpace:'nowrap'}}>¿De qué?</span>
          {op.map(o=><button key={o} type='button' onClick={()=>up('concept',`${String(f.concept||'').trim()} · ${o}`)} style={{display:'inline-flex',alignItems:'center',height:26,padding:'0 12px',borderRadius:8,fontSize:12,fontWeight:500,background:C.azulTenue,color:C.accent,border:'1px solid transparent',cursor:'pointer',fontFamily:'inherit',maxWidth:220,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{o}</button>)}
          <span style={{color:C.muted}}>{op.length?'o agrégalo en la descripción':'Agrega en la descripción el inmueble, la sociedad o fs/N°/año'}</span>
        </div> })()}
      {!isFondo&&f.category==='Movilización'&&(()=>{ const fi=(k,label)=>{ const v=mv[k]||'', bad=movExige&&(!v.trim()||(k==='motivo'&&v.trim().length<4))
          return <FloatFld label={label} mb={0}><input value={v} onChange={e=>setMv(p=>({...p,[k]:e.target.value}))} style={{...fInp,borderColor:bad?C.overdueText:undefined}}/></FloatFld> }
        return (<div style={{display:'grid',gridTemplateColumns:_Dmv?'150px minmax(0,1fr) minmax(0,1fr)':'minmax(0,1fr) minmax(0,1fr)',gap:8,marginBottom:8}}>
          <div style={{gridColumn:_Dmv?'auto':'1 / -1',minWidth:0}}><FloatFld label='Medio' mb={0}><select value={mv.medio} onChange={e=>setMv(p=>({...p,medio:e.target.value}))} style={{...fInp,cursor:'pointer',borderColor:(mv.medio||!movExige)?undefined:C.overdueText}}><option value=''>Elegir medio</option>{MEDIOS_MOV.map(m=><option key={m} value={m}>{m}</option>)}</select></FloatFld></div>
          {movDet&&<>{fi('desde','Desde')}{fi('hasta','Hasta')}
          <div style={{gridColumn:'1 / -1'}}>{fi('motivo','Motivo (para qué fue)')}</div></>}
          {movFalta&&<div style={{gridColumn:'1 / -1',fontSize:11.5,color:C.overdueText,fontWeight:600}}>{mv.medio?'Completa desde, hasta y motivo para guardar':'Elige el medio para guardar'}</div>}
        </div>) })()}
      {/* Proyecto + adjuntar en la misma línea (también en fondos de un cliente: a qué proyecto va el fondo) */}
      {(!isFondo||!!f.client_id)&&(
        <div style={{display:'flex',gap:8,alignItems:'stretch',marginBottom:8}}>
          <div style={{flex:1,minWidth:0}}>
            <FloatFld label='Proyecto' mb={0}><input list='exp-edit-projects' value={f.project||''} onChange={e=>up('project',e.target.value)} placeholder='Proyecto (venta del cliente)…' style={fInp}/></FloatFld>
            <datalist id='exp-edit-projects'>{projectOpts.map(p=><option key={p} value={p}/>)}</datalist>
            {sugProy&&!f.project&&<button type='button' onClick={()=>{up('project',sugProy);setSugProy(null)}} style={{marginTop:5,fontSize:11,fontWeight:600,color:C.greenText,background:C.greenBg,border:'none',borderRadius:20,padding:'3px 10px',cursor:'pointer'}}>Sugerido por glosa: {sugProy}</button>}
            {esPermanente((sales||[]).find(s=>s.client_id===f.client_id&&s.title===f.project))&&<div style={{marginTop:6}}><FloatFld label='Subproyecto' mb={0}><input list='exp-edit-subproy' value={f.subproject||''} onChange={e=>up('subproject',e.target.value)} placeholder='Ej: Campos, Marcas…' style={fInp}/></FloatFld>
              <datalist id='exp-edit-subproy'>{subproyectosCliente(f.client_id,[],expenses).map(x=><option key={x} value={x}/>)}</datalist></div>}
          </div>
          {expense?.id&&<div style={{display:'flex',alignItems:'center'}}><Attachments inline table='expense_attachments' idField='expense_id' entityId={expense.id} folderKind='gastos' namePrefix={`${client?.name||'Sin cliente'} · ${f.concept||'Gasto'}`} user={user} onChange={onAttachChange}/></div>}
        </div>
      )}
      {/* Fondo de un cliente: repartirlo entre proyectos (cada parte queda como un fondo con su proyecto; se puede deshacer). */}
      {isFondo&&f.client_id&&expense?.id&&onRepartirFondo&&(Number(expense.amount)||0)>0&&(()=>{
        const vivos=(expenses||[]).filter(e=>!e.deleted_at)
        const origen=expense.fondo_origen_id?vivos.find(e=>String(e.id)===String(expense.fondo_origen_id)):null
        const o=origen||expense, ps=[o,...vivos.filter(e=>String(e.fondo_origen_id)===String(o.id))]
        const repInp={width:'100%',height:34,border:`1px solid ${C.border}`,borderRadius:8,background:C.surface,fontSize:13,color:C.text,padding:'0 8px',boxSizing:'border-box',outline:'none',fontFamily:'inherit'}
        const box={background:C.bgSoft,border:`1px solid ${C.border}`,borderRadius:10,padding:'9px 11px',marginBottom:8}
        if(ps.length>1){ const tot=ps.reduce((a,e)=>a+(Number(e.amount)||0),0)
          return <div style={box}>
            <div style={{...SEC_LBL,marginBottom:4}}>Repartido en {ps.length} proyectos</div>
            {ps.map(e=><div key={e.id} style={{display:'flex',justifyContent:'space-between',gap:8,fontSize:12.5,padding:'3px 0'}}><span style={{color:String(e.id)===String(expense.id)?C.accent:C.text,fontWeight:String(e.id)===String(expense.id)?700:400}}>{e.project||'Sin proyecto'}</span><span style={{fontVariantNumeric:'tabular-nums',fontWeight:600,whiteSpace:'nowrap'}}>{fmt(e.amount)}</span></div>)}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,borderTop:`1px solid ${C.border}`,marginTop:4,paddingTop:6}}>
              <button type='button' disabled={repBusy} onClick={async()=>{ setRepBusy(true); const ok=await onUnirFondo(o); setRepBusy(false); if(ok&&onClose) onClose() }} style={{fontSize:12,fontWeight:600,color:C.accent,background:'none',border:'none',padding:0,cursor:'pointer'}}>{repBusy?'Uniendo…':'Deshacer reparto'}</button>
              <span style={{fontSize:12.5,fontWeight:700,fontVariantNumeric:'tabular-nums'}}>Total {fmt(tot)}</span>
            </div>
          </div> }
        if(!repOpen) return <button type='button' onClick={()=>setRepOpen(true)} style={{fontSize:12,fontWeight:600,color:C.accent,background:'none',border:'none',padding:0,cursor:'pointer',marginBottom:10}}>Repartir entre proyectos</button>
        const monto=Math.round(Number(expense.amount)||0), suma=partes.reduce((a,x)=>a+(parseInt(String(x.monto).replace(/\D/g,''))||0),0), falta=monto-suma
        const ok=partes.length>=2&&falta===0&&partes.every(x=>(x.project||'').trim()&&(parseInt(String(x.monto).replace(/\D/g,''))||0)>0)&&new Set(partes.map(x=>x.project.trim().toLowerCase())).size===partes.length
        const setP=(i,k,v)=>setPartes(p=>p.map((x,j)=>j===i?{...x,[k]:v}:x))
        return <div style={box}>
          <div style={{...SEC_LBL,marginBottom:6}}>Repartir {fmt(monto)} entre proyectos</div>
          {partes.map((x,i)=><div key={i} style={{display:'flex',gap:6,alignItems:'center',marginBottom:6}}>
            <select value={x.project} onChange={e=>setP(i,'project',e.target.value)} style={{...repInp,flex:1,minWidth:0,cursor:'pointer'}}><option value=''>Proyecto…</option>{projectOpts.map(p=><option key={p} value={p}>{p}</option>)}</select>
            <input inputMode='numeric' value={x.monto?fmt(parseInt(String(x.monto).replace(/\D/g,''))||0):''} onChange={e=>setP(i,'monto',e.target.value.replace(/\D/g,''))} placeholder='$0' style={{...repInp,width:110,flex:'none',textAlign:'right'}}/>
            {partes.length>2&&<button type='button' onClick={()=>setPartes(p=>p.filter((_,j)=>j!==i))} aria-label='Quitar' style={{background:'none',border:'none',color:C.textSoft,cursor:'pointer',padding:4}}><Gl n='x'/></button>}
          </div>)}
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,flexWrap:'wrap'}}>
            <button type='button' onClick={()=>setPartes(p=>[...p,{project:'',monto:falta>0?String(falta):''}])} style={{fontSize:12,fontWeight:600,color:C.accent,background:'none',border:'none',padding:0,cursor:'pointer'}}>+ Otro proyecto</button>
            <span style={{fontSize:12,fontWeight:600,color:falta===0?C.greenText:C.soonText,fontVariantNumeric:'tabular-nums'}}>{falta===0?'Suma el monto del fondo':falta>0?`Faltan ${fmt(falta)}`:`Sobran ${fmt(-falta)}`}</span>
          </div>
          <div style={{display:'flex',gap:8,marginTop:8}}>
            <button type='button' onClick={()=>setRepOpen(false)} style={{flex:1,padding:'8px',borderRadius:9,border:`1px solid ${C.border}`,background:C.surface,color:C.muted,fontSize:12.5,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
            <button type='button' disabled={!ok||repBusy} onClick={async()=>{ setRepBusy(true); const r=await onRepartirFondo(expense,partes.map(x=>({project:x.project.trim(),monto:parseInt(String(x.monto).replace(/\D/g,''))||0}))); setRepBusy(false); if(r&&onClose) onClose() }} style={{flex:2,padding:'8px',borderRadius:9,border:'none',background:ok?C.accent:C.done,color:'#fff',fontSize:12.5,fontWeight:700,cursor:ok?'pointer':'not-allowed'}}>{repBusy?'Guardando…':'Guardar reparto'}</button>
          </div>
        </div> })()}
      {/* Razón social (el cliente ya va en el encabezado). Reasignar cliente = acción discreta "Cambiar cliente". */}
      {!personalOn&&(
        <div>
          {rsList.length>=1&&(
            <FloatFld label='Razón social' mb={6}>
              <select value={f.entity_id||''} onChange={e=>up('entity_id',e.target.value||null)} style={{...fInp,cursor:'pointer'}}><option value=''>— Sin asignar —</option>{rsList.map(e=><option key={e.id} value={e.id}>{e.name}{e.rut?` · ${fmtRutCL(e.rut)}`:''}</option>)}</select>
            </FloatFld>
          )}
        </div>
      )}
      {(f.client_render_id||f.render_id||f.notaria_render_id)&&<div style={{fontSize:10,color:C.overdue,marginTop:4}}>Este gasto está en una rendición/liquidación: reábrela antes de moverlo a otro cliente.</div>}
      {/* Personal de: chips cuando se activa */}
      {!isFondo&&(showPersonal||personalOn)&&(
        <div style={{display:'flex',gap:5,flexWrap:'wrap',alignItems:'center'}}>
          <span style={{fontSize:11,color:C.muted,fontWeight:600,marginRight:2}}>Personal de:</span>
          {['Cristóbal','Erasmo','Martín','Martina','Rodrigo'].map(m=>{const on=f.personal_de===m;const pc=personChip(m);return <button key={m} type='button' onClick={()=>up('personal_de',on?null:m)} style={{fontSize:11,borderRadius:20,padding:'2px 9px',fontWeight:600,cursor:'pointer',background:on?pc.color:pc.bg,color:on?'#fff':pc.color,border:'none'}}>{m}</button>})}
          <button type='button' onClick={()=>{up('personal_de',null);setShowPersonal(false)}} style={{fontSize:11,background:'none',border:'none',color:C.muted,cursor:'pointer'}}><Gl n='x'/></button>
        </div>
      )}
      {!isFondo&&!expense?.id&&<div style={{fontSize:10,color:C.muted,marginTop:6}}>Guarda el gasto para adjuntar comprobantes.</div>}
      <div style={{display:'flex',gap:8,marginTop:4}}>
        <button onClick={()=>onDelete(expense.id)} style={{padding:'11px 14px',borderRadius:10,border:`1px solid ${C.overdue}`,background:'transparent',color:C.overdue,fontSize:13,fontWeight:600,cursor:'pointer'}}>Eliminar</button>
        <button onClick={onClose} style={{flex:1,padding:'9px 14px',borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
        <button disabled={saving||!(parseInt(f.amount)>0)||!f.date||movFalta||detFalta} title={movFalta?'Falta el trayecto y el motivo de la movilización':detFalta?'Falta de qué es (inmueble, sociedad o persona)':undefined} onClick={()=>onSave({...f,amount:Math.max(0,parseInt(f.amount)||0),subcategory:conSubcat(f.category)?subOtro(f.subcategory):null,...movPatch(),...(f.personal_de?{client_id:null,entity_id:null,paid_by_client:false}:{})})} style={{flex:2,padding:'9px 14px',borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:(!f.amount||!f.date)?'default':'pointer',opacity:(!f.amount||!f.date)?.6:1,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
          {saving?<Spin/>:null}{saving?'Guardando...':'Guardar'}
        </button>
      </div>
    </>
  )
}

