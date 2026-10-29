// Movido de compartido.jsx por scripts/dividir-compartido.py. Sin cambios de comportamiento.
import { useState, useEffect, useMemo } from 'react'
import { supabase, selectAll, DEMO } from '../supabase'
import { normRut as crNormRut } from '../cartola.js'
import { fgCliente } from '../../supabase/functions/_shared/gastosReglas.js'
import { C, Gl, SEC_LBL, SIcon, _normTxt, appAlert, appConfirm, diaGrande, fmt, fmtFechaDMY, fmtRutCL, folioN, isoLocal, useIsDesktop } from './base.jsx'
import { VENTA_REAL } from '../../supabase/functions/_shared/ventaGastoReglas.js'
import { Fragment } from 'react'
import { cuentaEnSaldo } from '../../supabase/functions/_shared/gastosReglas.js'
import { sugerirVentaGasto } from '../../supabase/functions/_shared/ventaGastoReglas.js'
import { diasA as _diasA } from '../../supabase/functions/_shared/calendarioReglas.js'
import { gastosPorRendirCli } from '../../supabase/functions/_shared/gastosReglas.js'
import { esSubarriendo, ventaUF } from './cifras.js'
import { ActBtn, AsignarVentaFactura, BitacoraLista, CAL_CLI_DIAS, CORTES_PJUD, CheckMini, Copyable, DestinatarioFacturasCard, ESTADO_COBRO, EstadoFacturaChip, IconSection, LIBROS_PJUD, OBL_CLIENTE, Sparkle, TH_BAND, UF_FALLBACK, _GRUPO_DESTINO, _MES_AB, _corteCorta, _estadoCausa, _libroLegible, _nomProp, _ordRol, _rolTxt, bigDate, calendarioCliente, catSinClienteVenta, cobradoBill, concPeriodoOf, cuotaNMof, cuotasOlvidadas, daysLeft, descargarPdfU8, driveCall, esFacturada, esPermanente, esVencidaB, estadoCobro, estadoFacturaLabel, facturaDtePdfBase64, facturaNombreArchivo, fmtSaldoG, fmtShort, fmtUF, huecoFIFO, loadXLSXStyle, logActividad, montoFactura, otConSello, planDeVenta, porCobrarBills, recordarCobroFactura, recorridoGasto, registrarError, rolledDueMap, rsDisplay, saldoBill, serieKey, splitSetDTE, subproyectosCliente, taskAssignees, tipoFacturaLbl, urgencyColor, useAprendidosVenta, useArrastre, useCalCliente, useCausas, useIaVenta, usePropiedades, useUF, verFacturaPdf } from './compartido.jsx'

// Tab "Contacto" de la ficha (reutilizado admin/limited): identificación + datos de
// contacto (edición inline en clients) + personas de contacto (CRUD en tabla contacts)
// Documentos del cliente en Drive (piezas 2+3): vincula la carpeta (auto por nombre, 1:1) y lista/abre sus archivos vía la edge function `drive`.
export function DocumentosDrive({client, onCount, onPick}){
  const [folder,setFolder] = useState(undefined)   // undefined=cargando · null=sin vincular · {id,name}=vinculada (raíz)
  const [path,setPath] = useState([])              // navegación: [{id,name}] desde la raíz
  const [items,setItems] = useState(null)          // contenido del nivel actual (subcarpetas + archivos)
  const FOLDER='application/vnd.google-apps.folder'
  const [busy,setBusy] = useState(false)
  const [err,setErr] = useState(null)
  const [q,setQ] = useState('')
  const [cand,setCand] = useState(null)
  const msg = (e)=>{ const m=e?.message||''; return /No hay conexión|No autorizado|GOOGLE_OAUTH|configurar|Failed to fetch|NetworkError|Error 40|Error 50/i.test(m) ? 'No se pudo conectar con Drive. Si aún no lo activaste: menú ☰ (admin) → “Conectar Drive (permanente)”.' : (m||'No se pudo leer Drive.') }
  const cargarNivel = async(fid, reportar)=>{
    setBusy(true); setErr(null)
    try{
      const data = await driveCall({action:'search', q:`'${fid}' in parents and trashed=false`, pageSize:100})
      const fs=(data.files||[]).slice().sort((a,b)=>{ const af=a.mimeType===FOLDER,bf=b.mimeType===FOLDER; if(af!==bf) return af?-1:1; return (a.name||'').localeCompare(b.name||'') })
      setItems(fs); if(reportar) onCount&&onCount(fs.length)
    }catch(e){ setErr(msg(e)); setItems(null) }
    setBusy(false)
  }
  const entrarRaiz = (f)=>{ setFolder({id:f.id,name:f.name}); setPath([{id:f.id,name:f.name}]); cargarNivel(f.id, true) }
  const entrarSub = (f)=>{ setPath(p=>[...p,{id:f.id,name:f.name}]); cargarNivel(f.id) }
  const irNivel = (i)=>{ const nueva=path.slice(0,i+1); setPath(nueva); cargarNivel(nueva[nueva.length-1].id) }
  const vincular = async(f)=>{
    // Una sola carpeta por cliente: la de la ficha (clients.drive_folder_id), que usan también los agentes; client_drive queda de respaldo.
    try{ await supabase.from('clients').update({drive_folder_id:f.id,updated_at:new Date().toISOString()}).eq('id',client.id) }catch(e){registrarError({origen:'accion',vista:'clients',err:e})}
    try{ await supabase.from('client_drive').upsert({client_id:String(client.id), folder_id:f.id, folder_name:f.name, updated_at:new Date().toISOString()},{onConflict:'client_id'}) }catch(e){registrarError({origen:'accion',vista:'client_drive',err:e})}
    setCand(null); entrarRaiz(f)
  }
  const autoVincular = async()=>{
    setBusy(true); setErr(null)
    try{
      const nm=(client.name||'').replace(/['\\]/g,' ').trim(); if(!nm){ setBusy(false); return }
      const data = await driveCall({action:'search', q:`mimeType='application/vnd.google-apps.folder' and name='${nm}' and trashed=false`, pageSize:5})
      const fs=data.files||[]
      if(fs.length===1) await vincular(fs[0])
      else if(fs.length>1) setCand(fs)
    }catch(e){ setErr(msg(e)) }
    setBusy(false)
  }
  const buscarCarpeta = async()=>{
    if(!q.trim()||busy) return
    setBusy(true); setErr(null)
    try{
      const data = await driveCall({action:'search', q:`mimeType='application/vnd.google-apps.folder' and name contains '${q.replace(/['\\]/g,' ').trim()}' and trashed=false`, pageSize:10})
      setCand(data.files||[])
    }catch(e){ setErr(msg(e)) }
    setBusy(false)
  }
  useEffect(()=>{ let alive=true
    ;(async()=>{
      setFolder(undefined); setItems(null); setPath([]); setErr(null); setCand(null); setQ('')
      try{
        if(client.drive_folder_id){ entrarRaiz({id:client.drive_folder_id,name:client.name}); return }   // carpeta de la ficha (fuente única)
        const {data} = await supabase.from('client_drive').select('folder_id,folder_name').eq('client_id',String(client.id)).maybeSingle()
        if(!alive) return
        if(data&&data.folder_id) entrarRaiz({id:data.folder_id,name:data.folder_name})
        else { setFolder(null); autoVincular() }
      }catch(_){ if(alive) setFolder(null) }
    })()
    return ()=>{ alive=false }
  },[client.id])
  const abrir = (f)=>{ try{ window.open('https://drive.google.com/open?id='+f.id,'_blank','noopener') }catch(_){} }
  const inp={width:'100%',border:`1px solid ${C.border}`,borderRadius:8,padding:'6px 9px',fontSize:12,color:C.text,outline:'none',boxSizing:'border-box',fontFamily:'inherit'}
  return (
    <div>
      {folder&&<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8,gap:8}}>
        <div style={{fontSize:11,color:C.muted,display:'flex',flexWrap:'wrap',alignItems:'center',gap:3,minWidth:0}}>
          {path.map((p,i)=>(<span key={p.id} style={{display:'inline-flex',alignItems:'center',gap:3}}>
            {i>0&&<span style={{color:C.textSoft}}><Gl n='chevron'/></span>}
            <span onClick={i<path.length-1?()=>irNivel(i):undefined} style={{color:i<path.length-1?C.azulInfo:C.text,fontWeight:i===path.length-1?700:400,cursor:i<path.length-1?'pointer':'default',maxWidth:150,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}</span>
          </span>))}
        </div>
        <button type='button' onClick={()=>{setFolder(null);setItems(null);setPath([]);setCand(null)}} style={{fontSize:10,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',padding:0,flexShrink:0}}>Cambiar</button>
      </div>}
      {busy&&<div style={{fontSize:11,color:C.muted}}>Cargando…</div>}
      {err&&<div style={{fontSize:11,color:C.overdueText,marginBottom:6}}>{err}</div>}
      {folder&&items&&items.length>0&&<div style={{display:'flex',flexDirection:'column',gap:4,maxHeight:280,overflowY:'auto'}}>
        {items.map(f=>{ const esCarpeta=f.mimeType===FOLDER; return (
          <button key={f.id} type='button' onClick={()=>esCarpeta?entrarSub(f):(onPick?onPick(f):abrir(f))} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 9px',borderRadius:8,border:`1px solid ${C.border}`,background:esCarpeta?C.bgSoft:'#fff',cursor:'pointer',textAlign:'left'}}>
            <SIcon n={esCarpeta?'building':'file'} s={14} c={esCarpeta?C.muted:C.accent}/>
            <span style={{flex:1,minWidth:0,fontSize:12,color:esCarpeta?C.text:C.accent,fontWeight:esCarpeta?600:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.name}</span>
            <span style={{fontSize:10,color:C.muted,flexShrink:0}}>{esCarpeta?<Gl n='chevron'/>:(f.modifiedTime?fmtFechaDMY(isoLocal(f.modifiedTime)):'')}</span>
          </button>
        )})}
      </div>}
      {folder&&items&&items.length===0&&!busy&&<div style={{fontSize:11,color:C.muted}}>Carpeta vacía.</div>}
      {!folder&&!busy&&cand&&cand.length>0&&<div>
        <div style={{fontSize:11,color:C.muted,marginBottom:6}}>Elige la carpeta de este cliente:</div>
        <div style={{display:'flex',flexDirection:'column',gap:4}}>{cand.map(f=>(<button key={f.id} type='button' onClick={()=>vincular(f)} style={{...inp,textAlign:'left',cursor:'pointer',fontWeight:600,color:C.accent}}>{f.name}</button>))}</div>
      </div>}
      {!folder&&!busy&&(!cand||cand.length===0)&&!err&&<div>
        <div style={{fontSize:11,color:C.muted,marginBottom:6}}>No vinculada aún. Busca la carpeta en tu Drive:</div>
        <div style={{display:'flex',gap:6}}>
          <input value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();buscarCarpeta()}}} placeholder={client.name||'Nombre de la carpeta'} style={inp}/>
          <button type='button' onClick={buscarCarpeta} disabled={busy} style={{fontSize:12,fontWeight:600,color:'#fff',background:C.muted,border:'none',borderRadius:8,padding:'6px 11px',cursor:'pointer'}}>Buscar</button>
        </div>
      </div>}
    </div>
  )
}

export function ContactoTab({client, entities, onSaveFields, clientBilling=[], onOpenFinanciero}) {
  const isDesktop = useIsDesktop()   // desktop: formulario a ancho cómodo centrado (no estirado a toda la pantalla)
  const fields = ['rut']
  const fromClient = () => fields.reduce((o,k)=>{o[k]=client[k]||'';return o},{})
  const [form,setForm] = useState(fromClient())
  const [savingF,setSavingF] = useState(false)
  useEffect(()=>{ setForm(fromClient()) },[client.id]) // recargar al cambiar de cliente

  const dirty = fields.some(k=>(form[k]||'')!==(client[k]||''))
  const set = (k,v)=>setForm(f=>({...f,[k]:v}))
  const [sec,setSec] = useState(()=>isDesktop?{id:true,rs:true,personas:true,dest:true}:{})   // móvil: colapsadas; escritorio: abiertas (Drive se abre a pedido: evita una llamada por ficha)
  const tog = k => setSec(s=>({...s,[k]:!s[k]}))
  const [docCount,setDocCount] = useState(null)   // nº de documentos del cliente en Drive (para el resumen de la sección)
  const guardar = async ()=>{
    setSavingF(true)
    try{ await onSaveFields(client.id, form) }catch(e){/* avisado en handler */}
    setSavingF(false)
  }

  // ── Personas de contacto ──
  const [contacts,setContacts] = useState([])
  const [loadingC,setLoadingC] = useState(true)
  const [showAdd,setShowAdd] = useState(false)
  const [edit,setEdit] = useState(null)
  const [cForm,setCForm] = useState({nombre:'',cargo:'',email:'',telefono:''})
  const [savingC,setSavingC] = useState(false)
  useEffect(()=>{
    let alive=true; setLoadingC(true)
    supabase.from('contacts').select('*').eq('client_id',client.id).order('created_at')
      .then(({data,error})=>{ if(alive){ if(!error) setContacts(data||[]); setLoadingC(false) } })
    return ()=>{alive=false}
  },[client.id])
  const resetC = ()=>{ setCForm({nombre:'',cargo:'',email:'',telefono:''}); setShowAdd(false); setEdit(null) }
  const startEdit = (c)=>{ setEdit(c); setCForm({nombre:c.nombre||'',cargo:c.cargo||'',email:c.email||'',telefono:c.telefono||''}); setShowAdd(true) }
  const guardarContacto = async ()=>{
    if(!cForm.nombre.trim()) return
    setSavingC(true)
    try{
      if(edit){
        const {data,error}=await supabase.from('contacts').update({...cForm,nombre:cForm.nombre.trim()}).eq('id',edit.id).select().single()
        if(error)throw error; setContacts(p=>p.map(x=>x.id===data.id?data:x))
      }else{
        const {data,error}=await supabase.from('contacts').insert({client_id:client.id,...cForm,nombre:cForm.nombre.trim()}).select().single()
        if(error)throw error; setContacts(p=>[...p,data])
      }
      resetC()
    }catch(e){appAlert('Error: '+e.message)}
    setSavingC(false)
  }
  const eliminarContacto = async (c)=>{
    if(!await appConfirm(`¿Eliminar a ${c.nombre}?`)) return
    const {error}=await supabase.from('contacts').delete().eq('id',c.id)
    if(error){appAlert('Error: '+error.message);return}
    setContacts(p=>p.filter(x=>x.id!==c.id))
  }
  const togglePrincipal = async (c)=>{ const nv=!c.principal; setContacts(p=>p.map(x=>x.id===c.id?{...x,principal:nv}:x)); const {error}=await supabase.from('contacts').update({principal:nv}).eq('id',c.id); if(error){appAlert('Error: '+error.message); setContacts(p=>p.map(x=>x.id===c.id?{...x,principal:!nv}:x))} }
  const initials = (n)=> (n||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase()

  const inp = {width:'100%',padding:'8px 10px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',fontSize:13,boxSizing:'border-box',outline:'none',color:C.text}
  const lbl = {fontSize:10,color:C.muted,fontWeight:600,textTransform:'uppercase',letterSpacing:.4,marginBottom:4,display:'block'}
  const card = {marginBottom:16,padding:'14px 16px',borderRadius:12,background:C.card,border:`1px solid ${C.border}`}
  const sTitle = (t)=>(<div style={{fontSize:10,color:C.muted,textTransform:'uppercase',letterSpacing:.5,fontWeight:600,marginBottom:10}}>{t}</div>)
  // función (no componente) para no remontar el input y perder el foco al tipear
  const field = (label,k,placeholder)=>(
    <div><label style={lbl}>{label}</label><input value={form[k]} onChange={e=>set(k,e.target.value)} placeholder={placeholder||''} style={inp}/></div>
  )

  const _card = kids => <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>{kids}</div>
  const sId = (
        <IconSection icon='id' title='Identificación' summary={client.rut||'sin RUT'} open={sec.id} onToggle={()=>tog('id')}>
          <div style={{display:'grid',gap:10,paddingTop:4}}>
            <div>
              <label style={lbl}>Nombre cliente</label>
              <input value={client.name||'—'} disabled style={{...inp,background:C.bgSoft,color:C.muted}}/>
              <div style={{fontSize:10,color:C.muted,marginTop:3}}>Para cambiarlo, usa "Editar".</div>
            </div>
            {field('RUT','rut','12.345.678-9')}
          </div>
          {dirty&&(
            <div style={{display:'flex',gap:8,marginTop:12}}>
              <button onClick={()=>setForm(fromClient())} disabled={savingF} style={{flex:1,padding:'9px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Descartar</button>
              <button onClick={guardar} disabled={savingF} style={{flex:2,padding:'9px',borderRadius:8,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',opacity:savingF?.6:1}}>{savingF?'Guardando...':'Guardar cambios'}</button>
            </div>
          )}
        </IconSection>
  )
  const sRs = (entities&&entities.length>0&&(
          <IconSection icon='building' title='Razones sociales facturadas' summary={entities.length} open={sec.rs} onToggle={()=>tog('rs')}>
            <div style={{paddingTop:4}}>
              {entities.map(e=>{
                const nFac=(clientBilling||[]).filter(b=>!b.deleted_at&&b.invoice_no&&(String(b.entity_id)===String(e.id)||(e.rut&&crNormRut(b.receptor_rut||'')===crNormRut(e.rut)))).length
                return (
                <div key={e.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,padding:'6px 0',borderBottom:`0.5px solid ${C.bgWarm}`}}>
                  <span onClick={onOpenFinanciero?()=>onOpenFinanciero():undefined} title={onOpenFinanciero?'Ver sus facturas en Financiero':undefined} style={{fontSize:12,color:C.text,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',cursor:onOpenFinanciero?'pointer':'inherit'}}>{rsDisplay(e.name)||'—'}</span>
                  <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
                    {nFac>0&&onOpenFinanciero&&<span onClick={()=>onOpenFinanciero()} style={{fontSize:10,fontWeight:700,color:C.accent,background:C.azulBg,borderRadius:20,padding:'2px 8px',cursor:'pointer',whiteSpace:'nowrap'}}>{nFac} factura{nFac!==1?'s':''} →</span>}
                    <Copyable text={e.rut} title='Copiar RUT'><span style={{fontSize:11,color:C.muted,whiteSpace:'nowrap'}}>{fmtRutCL(e.rut)}</span></Copyable>
                  </div>
                </div>
              )})}
            </div>
          </IconSection>
        ))
  const sPer = (
        <IconSection icon='users' title='Personas de contacto' summary={loadingC?'…':(contacts.length||'—')} open={sec.personas} onToggle={()=>tog('personas')}>
          <div style={{paddingTop:4}}>
            {!showAdd&&<button onClick={()=>{setEdit(null);setCForm({nombre:'',cargo:'',email:'',telefono:''});setShowAdd(true)}} style={{padding:'4px 10px',borderRadius:6,border:`1px solid ${C.accent}`,background:'transparent',color:C.accent,fontSize:11,fontWeight:600,cursor:'pointer',marginBottom:6}}>+ Agregar</button>}
            {loadingC&&<div style={{fontSize:12,color:C.muted,padding:'6px 0'}}>Cargando...</div>}
            {!loadingC&&contacts.length===0&&!showAdd&&<div style={{fontSize:12,color:C.muted,padding:'6px 0'}}>Sin contactos.</div>}
            {[...contacts].sort((a,b)=>(b.principal?1:0)-(a.principal?1:0)).map(c=>(
              <div key={c.id} style={{display:'flex',gap:10,alignItems:'center',padding:'9px 0',borderBottom:`0.5px solid ${C.bgWarm}`}}>
                <button onClick={()=>togglePrincipal(c)} title={c.principal?'Principal':'Marcar principal'} style={{background:'none',border:'none',cursor:'pointer',fontSize:18,lineHeight:1,color:c.principal?C.soon:'#CBD5DB',flexShrink:0,padding:0}}>{c.principal?'★':'☆'}</button>
                <div style={{width:34,height:34,borderRadius:'50%',background:C.azulBg,color:C.accent,fontSize:12,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{initials(c.nombre)}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:600,color:C.text}}>{c.nombre}{c.principal&&<span style={{fontSize:9,fontWeight:700,color:C.soonText,background:C.soonBg,padding:'1px 7px',borderRadius:20,marginLeft:5,textTransform:'uppercase',letterSpacing:.3}}>Principal</span>}{c.cargo&&<span style={{fontSize:11,fontWeight:400,color:C.muted}}> · {c.cargo}</span>}</div>
                  <div style={{fontSize:11,color:C.muted,display:'flex',gap:8,flexWrap:'wrap'}}>
                    {c.email&&<a href={`mailto:${c.email}`} style={{color:C.accent,textDecoration:'none'}}>{c.email}</a>}
                    {c.telefono&&<Copyable text={c.telefono} title='Copiar teléfono'>{c.telefono}</Copyable>}
                  </div>
                </div>
                <button onClick={()=>startEdit(c)} style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:13,padding:4}}>Editar</button>
                <button onClick={()=>eliminarContacto(c)} style={{background:'none',border:'none',color:C.overdue,cursor:'pointer',fontSize:13,padding:4}}>Eliminar</button>
              </div>
            ))}
            {showAdd&&(
              <div style={{marginTop:10,padding:'12px',borderRadius:10,background:C.bgSoft,border:`1px solid ${C.border}`}}>
                <div style={{display:'grid',gap:8}}>
                  <input autoFocus value={cForm.nombre} onChange={e=>setCForm(f=>({...f,nombre:e.target.value}))} placeholder="Nombre *" style={inp}/>
                  <input value={cForm.cargo} onChange={e=>setCForm(f=>({...f,cargo:e.target.value}))} placeholder="Cargo" style={inp}/>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                    <input value={cForm.email} onChange={e=>setCForm(f=>({...f,email:e.target.value}))} placeholder="Email" style={inp}/>
                    <input value={cForm.telefono} onChange={e=>setCForm(f=>({...f,telefono:e.target.value}))} placeholder="Teléfono" style={inp}/>
                  </div>
                  <div style={{display:'flex',gap:8,marginTop:2}}>
                    <button onClick={resetC} disabled={savingC} style={{flex:1,padding:'8px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.muted,fontSize:12,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
                    <button onClick={guardarContacto} disabled={savingC||!cForm.nombre.trim()} style={{flex:2,padding:'8px',borderRadius:8,border:'none',background:C.accent,color:'#fff',fontSize:12,fontWeight:700,cursor:'pointer',opacity:(savingC||!cForm.nombre.trim())?.6:1}}>{savingC?'Guardando...':(edit?'Guardar':'Agregar')}</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </IconSection>
  )
  const sDest = (
        <IconSection icon='mail' title='Destinatario de facturas' summary={(()=>{const p=contacts.find(c=>c.principal)||contacts[0];return p?(p.nombre||'').split(/\s+/)[0]:'—'})()} open={sec.dest} onToggle={()=>tog('dest')}>
          <DestinatarioFacturasCard client={client} contacts={contacts} embedded/>
        </IconSection>
  )
  const sDocs = (
        <IconSection icon='file' title='Documentos (Drive)' summary={docCount==null?null:docCount} open={sec.docs} onToggle={()=>tog('docs')} last>
          <DocumentosDrive client={client} onCount={setDocCount}/>
        </IconSection>
  )
  // Escritorio: dos columnas con las secciones abiertas (aprovecha el ancho). Móvil: una tarjeta en acordeón (igual que antes).
  return (
    <div style={{padding:'16px 20px 60px',maxWidth:isDesktop?1100:undefined,margin:isDesktop?'0 auto':undefined,...(isDesktop?{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,alignItems:'start'}:{})}}>
      {isDesktop ? <>{_card(<>{sId}{sRs}{sDest}</>)}{_card(<>{sPer}{sDocs}</>)}</> : _card(<>{sId}{sRs}{sPer}{sDest}{sDocs}</>)}
    </div>
  )
}

// Pestaña "Estado de cuenta" (ex Documentos): vista unificada y trazable del cliente. Lee conciliacion +
// cartola_movimientos para el sello "verificado en banco" y enlazar cada pago con su movimiento bancario.
export function EstadoCuentaTab({client, clientBilling=[], sales=[], anticipos=[], expenses=[], tasks=[], clientEntities=[], onEditExpense, onEditBilling, onOpenSale, onOpenConciliacion, onAjuste, onRendicion, onAsociarTrabajo}){
  const isDesktop = useIsDesktop()   // desktop: ancho acotado y centrado (no estirado a toda la pantalla)
  const aprVenta = useAprendidosVenta(), iaVenta = useIaVenta()
  const [sec,setSec]=useState({})   // secciones-icono (Honorarios/Fondos/Movimientos/Anticipos), colapsadas por defecto
  const secT=k=>setSec(s=>({...s,[k]:!s[k]}))
  const [conc,setConc]=useState([]); const [movs,setMovs]=useState([]); const [loading,setLoading]=useState(true)
  const [det,setDet]=useState(null); const [detG,setDetG]=useState(null)
  const [ord,setOrd]=useState('fecha')
  const [openRS,setOpenRS]=useState({})   // razones sociales desplegadas (por defecto plegadas)
  const [ultAsig,setUltAsig]=useState(null)   // último proyecto/RS asignado: {ids, n, undo} — "deshacer" en línea
  const asignar = onAsociarTrabajo ? async(lote,...r)=>{ const undo=await onAsociarTrabajo(lote,...r); if(undo) setUltAsig({ids:new Set(lote.map(x=>x.id)), n:lote.length, monto:lote.reduce((a,x)=>a+Math.abs(x.amount||0),0), undo}) } : null
  const deshacerAsig = async()=>{ const u=ultAsig; setUltAsig(null); if(u) await u.undo() }
  const [openProy,setOpenProy]=useState(null)  // proyecto/grupo "Por proyecto" desplegado (key o '_')
  const [porProyOpen,setPorProyOpen]=useState(false)   // el bloque "Por proyecto" arranca oculto
  const [openGrp,setOpenGrp]=useState({Activas:true})  // grupos de estado: Activas visible, Terminadas/Otras plegadas
  const [movOrd,setMovOrd]=useState('desc')    // orden por fecha en Movimientos: 'desc' | 'asc'
  const [fgOrd,setFgOrd]=useState('desc')      // orden por fecha en Fondos y gastos: 'desc' | 'asc'
  const [fgSinPR,setFgSinPR]=useState(false)   // filtro "Sin proyecto o RS"
  const [corrG,setCorrG]=useState(null)        // gasto cuyo proyecto/RS se está corrigiendo: {id, sale, ent}
  const [detMov,setDetMov]=useState(null)      // movimiento con detalle expandido en Movimientos
  const [movF,setMovF]=useState('todos')       // filtro Movimientos: todos|abonos|cargos|sin
  const _MES=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
  const mesAA=iso=>{const dp=String(iso||'').slice(0,10).split('-');return dp.length>=3?`${_MES[parseInt(dp[1])-1]||''} ${dp[0].slice(2)}`:''}
  const dCol=iso=>{const dp=String(iso||'').slice(0,10).split('-');return {dia:dp.length>=3?dp[2]:'—',sub:dp.length>=3?`${_MES[parseInt(dp[1])-1]||''} ${dp[0].slice(2)}`:''}}
  useEffect(()=>{ let ok=true; setLoading(true); (async()=>{
    const [a,b]=await Promise.all([
      selectAll(()=>supabase.from('conciliacion').select('*').order('id')),
      supabase.from('cartola_movimientos').select('id,fecha,monto,n_operacion,rol_cuenta,tipo,es_interno,categoria,descripcion').eq('cliente_id',client.id),
    ])
    if(ok){ setConc(a.data||[]); setMovs(b.data||[]); setLoading(false) }
  })(); return ()=>{ok=false} },[client.id])
  const ventaById=useMemo(()=>{const m={};sales.forEach(s=>m[s.id]=s);return m},[sales])
  const concByFac=useMemo(()=>{const m={};conc.forEach(c=>{if(c.factura_id)m[c.factura_id]=c});return m},[conc])
  const aplicadoByFac=useMemo(()=>{const m={};conc.forEach(c=>{if(c.factura_id&&c.tipo_destino==='factura')m[c.factura_id]=(m[c.factura_id]||0)+(c.monto_aplicado||0)});return m},[conc])
  const cartolaHastaEC=useMemo(()=>{let mx='';for(const x of movs){const f=String(x.fecha||'').slice(0,10);if(f>mx)mx=f}return mx||null},[movs])
  const movById=useMemo(()=>{const m={};movs.forEach(x=>m[x.id]=x);return m},[movs])
  const facturas=useMemo(()=>clientBilling.filter(b=>!b.deleted_at&&b.status!=='Anulada'&&b.billing_type!=='reembolso'&&b.status!=='Programada'),[clientBilling])
  const facturado=facturas.reduce((s,b)=>s+montoFactura(b),0)   // autoridad DTE
  const pagadoTot=facturas.reduce((s,b)=>s+cobradoBill(b),0)   // incluye parciales (banco o paid_amount); fuente única, coincide con Financiero/Resumen
  const porCobrar=porCobrarBills(clientBilling)
  const fg=fgCliente(expenses,client.id)
  const aFavor=(anticipos||[]).filter(a=>a.estado==='disponible').reduce((s,a)=>s+(a.monto||0),0)
  const hoy=new Date();hoy.setHours(0,0,0,0)
  const aging=due=>{if(!due)return null;const d=Math.round((new Date(due+'T12:00')-hoy)/86400000);if(d<0)return{t:`vencida ${-d}d`,c:C.overdueText};if(d<=7)return{t:`vence ${d}d`,c:C.soon};return{t:'al día',c:C.greenText}}
  const grupos=useMemo(()=>{const g={};facturas.forEach(b=>{const rs=b.receptor_name||client.name||'—';(g[rs]=g[rs]||[]).push(b)})
    const cmp=ord==='monto'?(x,y)=>(y.amount||0)-(x.amount||0):ord==='proyecto'?(x,y)=>((ventaById[x.sale_id]?.title||x.concept||'zzz')).localeCompare(ventaById[y.sale_id]?.title||y.concept||'zzz')||((x.issued_at||'')<(y.issued_at||'')?1:-1):(x,y)=>(x.issued_at||'')<(y.issued_at||'')?1:-1
    Object.values(g).forEach(a=>a.sort(cmp));return g},[facturas,ord,ventaById])
  const porProy=useMemo(()=>{const p={};facturas.forEach(b=>{const v=ventaById[b.sale_id];const k=b.sale_id||'_';const o=p[k]||(p[k]={key:k,sale_id:b.sale_id||null,venta:v||null,titulo:v?.title||'Sin proyecto',area:v?.area||'',year:v?.year||null,status:v?.status||null,fact:0,pag:0,facs:[]});o.fact+=montoFactura(b);o.pag+=cobradoBill(b);o.facs.push(b)});Object.values(p).forEach(o=>o.facs.sort((x,y)=>(x.issued_at||'')<(y.issued_at||'')?1:-1));return Object.values(p)},[facturas,ventaById])
  const kpi=(label,val,sub,col,corner)=>(<div style={{background:C.bgSoft,borderRadius:8,padding:'8px 9px',position:'relative'}}>{corner}<div style={{...SEC_LBL}}>{label}</div><div style={{fontSize:13,fontWeight:600,color:col}}>{fmt(val)}</div><div style={{fontSize:9,color:C.textSoft,lineHeight:1.3}}>{sub}</div></div>)
  const Hdr=({icon,title,purpose,summary,sumCol,k})=>(<div onClick={()=>secT(k)} style={{display:'flex',alignItems:'center',gap:10,padding:'12px 13px',cursor:'pointer',borderBottom:`0.5px solid ${C.bgWarm}`,background:sec[k]?C.bgPanel:'transparent'}}><SIcon n={icon} s={18} c={C.muted}/><div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:C.text}}>{title}</div>{purpose&&<div style={{fontSize:10,color:C.muted,fontWeight:500,marginTop:1}}>{purpose}</div>}</div>{summary!=null&&<span style={{fontSize:11,color:sumCol||C.muted,fontWeight:sumCol&&sumCol!==C.muted?700:400,whiteSpace:'nowrap'}}>{summary}</span>}<svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke={C.done} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' style={{flexShrink:0,transform:sec[k]?'rotate(180deg)':'none',transition:'transform .12s'}}><path d='M6 9l6 6 6-6'/></svg></div>)
  return (<div style={{padding:'14px 20px 40px',maxWidth:isDesktop?900:undefined,margin:isDesktop?'0 auto':undefined}}>
    {/* Banda accionable: lo único que de verdad importa en una cuenta donde casi solo entra plata — lo que falta conciliar */}
    {(()=>{ const movBase=movs.filter(m=>!m.es_interno); const sinC=movBase.filter(m=>!conc.find(x=>x.movimiento_id===m.id)); if(!sinC.length) return null; const tot=sinC.reduce((s,m)=>s+(m.monto||0),0); return (
      <div onClick={()=>{ if(!sec.movs)secT('movs'); setMovF('sin') }} style={{display:'flex',alignItems:'center',gap:10,background:C.ambarBg,border:'0.5px solid #EFD9A8',borderRadius:12,padding:'10px 12px',marginBottom:12,cursor:'pointer'}}>
        <SIcon n='alert' s={17} c={C.soonText}/>
        <span style={{flex:1,fontSize:12,fontWeight:700,color:C.soonText}}>{sinC.length} movimiento{sinC.length!==1?'s':''} sin conciliar</span>
        <span style={{fontSize:13,fontWeight:700,color:C.soonText}}>{fmt(tot)}</span>
        <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke={C.soon} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><path d='M9 6l6 6-6 6'/></svg>
      </div>
    )})()}
    <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
    {loading&&<div style={{fontSize:11,color:C.muted,padding:'10px 12px'}}>Cargando…</div>}
    <div style={{...SEC_LBL,padding:'11px 13px 6px'}}>General · la cartola</div>
    {Hdr({icon:'exchange',title:'Movimientos bancarios',k:'movs',summary:`${movs.filter(m=>!m.es_interno).length} mov`})}
    {sec.movs&&(()=>{ const base=movs.filter(m=>!m.es_interno)
      const totAb=base.filter(m=>m.tipo==='abono').reduce((s,m)=>s+(m.monto||0),0); const totCa=base.filter(m=>m.tipo==='cargo').reduce((s,m)=>s+(m.monto||0),0)
      const sinN=base.filter(m=>!conc.find(x=>x.movimiento_id===m.id)).length
      let lista=base; if(movF==='abonos')lista=lista.filter(m=>m.tipo==='abono'); else if(movF==='cargos')lista=lista.filter(m=>m.tipo==='cargo'); else if(movF==='sin')lista=lista.filter(m=>!conc.find(x=>x.movimiento_id===m.id))
      lista=lista.slice().sort((a,b)=>{ const r=(a.fecha||'')<(b.fecha||'')?1:-1; return movOrd==='desc'?r:-r })
      const chip=(v,l,n,dgr)=>(<span key={v} onClick={()=>setMovF(v)} style={{fontSize:10,padding:'3px 9px',borderRadius:20,cursor:'pointer',whiteSpace:'nowrap',...(movF===v?{background:dgr?C.overdueText:C.accent,color:'#fff',fontWeight:600,border:'1px solid transparent'}:{border:`1px solid ${dgr?'#F7C1C1':C.border}`,color:dgr?C.overdueText:C.muted})}}>{l}{n!=null?` ${n}`:''}</span>)
      return (<div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8,marginBottom:8}}>
        <div><div style={{fontSize:13,fontWeight:600,color:C.accent}}>Movimientos bancarios</div><div style={{fontSize:10,color:C.textSoft}}>{base.length} mov · <span style={{color:C.greenText}}>+{fmt(totAb)}</span>{totCa>0?<> · <span style={{color:C.overdueText}}>−{fmt(totCa)}</span></>:''}</div></div>
        <button onClick={()=>setMovOrd(o=>o==='desc'?'asc':'desc')} title='Ordenar por fecha' style={{fontSize:11,fontWeight:600,padding:'4px 11px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.accent,cursor:'pointer',whiteSpace:'nowrap'}}>Fecha {movOrd==='desc'?'↓':'↑'}</button>
      </div>
      <div style={{display:'flex',gap:6,marginBottom:8,flexWrap:'wrap'}}>{chip('todos','Todos',base.length)}{chip('abonos','Abonos')}{chip('cargos','Cargos')}{sinN>0&&chip('sin','Sin conciliar',sinN,true)}</div>
      {lista.length===0&&<div style={{fontSize:11,color:C.muted}}>Sin movimientos.</div>}
      {lista.map(m=>{ const c=conc.find(x=>x.movimiento_id===m.id); const open=detMov===m.id; const dest=c?(c.tipo_destino==='fondo'?'→ Fondo':c.tipo_destino==='anticipo'?'→ Anticipo':c.tipo_destino==='gasto'?(m.tipo==='cargo'?'→ Gasto por cuenta del cliente':'→ Reembolso gastos'):(()=>{const f=clientBilling.find(b=>b.id===c.factura_id);return f?`→ Factura N° ${folioN(f.invoice_no)||'—'}`:'→ por resolver · re-conciliar'})()):'sin conciliar'; const d=dCol(m.fecha); const cta=m.rol_cuenta==='gastos'?'Cta. Gastos':'Cta. Honorarios'; return (
        <div key={m.id}>
          <div onClick={()=>setDetMov(open?null:m.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:open?'none':'1px solid #F1F1F1',cursor:'pointer'}}>
            <div style={{width:44,flexShrink:0,textAlign:'center',lineHeight:1.1}}><div style={{fontSize:13,fontWeight:600,color:C.accent}}>{d.dia}</div><div style={{fontSize:9,color:C.textSoft}}>{d.sub}</div></div>
            <div style={{flex:1,minWidth:0}}><div style={{marginBottom:2}}><span style={{fontSize:9.5,fontWeight:700,background:m.rol_cuenta==='gastos'?C.ambarBg:C.azulBg,color:m.rol_cuenta==='gastos'?C.soonText:C.accent,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap'}}>{m.rol_cuenta==='gastos'?'Cta. Gastos':'Cta. Honorarios'}</span></div><div style={{fontSize:11,color:c?C.muted:C.soon,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{dest}</div></div>
            <b style={{color:m.tipo==='abono'?C.greenText:C.overdueText,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{m.tipo==='abono'?'+':'−'}{fmt(m.monto)}</b>
            <span style={{color:C.textSoft,fontSize:16,lineHeight:1,flexShrink:0,transform:open?'rotate(90deg)':'none',transition:'transform .15s'}}><Gl n='chevron'/></span>
          </div>
          {open&&<div style={{padding:'8px 10px',background:C.bgSoft,borderRadius:6,fontSize:11,color:C.muted,lineHeight:1.7,margin:'0 0 6px'}}>
            <div style={{display:'flex',gap:12,flexWrap:'wrap'}}><span>Cuenta: <b style={{color:C.text}}>{cta}</b></span><span>Tipo: <b style={{color:C.text}}>{m.tipo==='abono'?'Abono':'Cargo'}</b></span>{m.n_operacion&&<span>N° op.: <b style={{color:C.text}}>{m.n_operacion}</b></span>}</div>
            {m.descripcion&&<div>Glosa: <b style={{color:C.text}}>{m.descripcion}</b></div>}
            <div style={{marginTop:4,paddingTop:4,borderTop:`1px solid #E4E8EB`,display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}><span style={{color:c?C.text:C.soon}}>{c?<>{dest} <span style={{color:C.greenText,fontWeight:600}}><Gl n='tick'/> conciliado</span></>:'sin conciliar'}</span>{onOpenConciliacion&&<span onClick={(ev)=>{ev.stopPropagation();onOpenConciliacion(m.id)}} style={{fontSize:10,color:C.azulInfo,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>ver en Conciliación ↗</span>}</div>
          </div>}
        </div>) })}
    </div>) })()}
    <div style={{fontSize:9,color:C.textSoft,fontWeight:700,letterSpacing:.4,textTransform:'uppercase',padding:'13px 13px 6px',borderTop:`0.5px solid ${C.bgWarm}`}}>Específico · por categoría de pago</div>
    {Hdr({icon:'file',title:'Honorarios',k:'honorarios',summary:`${facturas.length} factura${facturas.length!==1?'s':''}`})}
    {sec.honorarios&&<div style={{padding:'2px 13px 12px'}}>
      {porProy.length>0&&(()=>{
        const tile=p=>{ const open=openProy===p.key; const falta=(p.fact||0)-(p.pag||0); return (
          <div key={p.key}>
            <div onClick={()=>setOpenProy(open?null:p.key)} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:`1px solid #F1F1F1`,cursor:'pointer'}}>
              <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.titulo}</div><div style={{display:'flex',gap:6,alignItems:'center',marginTop:2}}>{p.area&&<span style={{fontSize:9.5,padding:'2px 8px',borderRadius:20,background:p.area==='Corporativo'?C.azulBg:C.bgWarm,color:p.area==='Corporativo'?C.accent:C.muted,fontWeight:700,whiteSpace:'nowrap'}}>{p.area}</span>}<span style={{fontSize:10,color:C.textSoft}}>{p.year?`${p.year} · `:''}{p.facs.length} factura{p.facs.length!==1?'s':''}</span></div></div>
              <div style={{textAlign:'right',whiteSpace:'nowrap'}}><div style={{fontSize:13,fontWeight:600,fontVariantNumeric:'tabular-nums'}}>{fmt(p.fact)}</div><div style={{fontSize:10,color:falta>0?C.overdue:C.greenText}}>{falta>0?`falta ${fmt(falta)}`:'pagado'}</div></div>
              <span style={{color:C.textSoft,fontSize:16,lineHeight:1,transform:open?'rotate(90deg)':'none',transition:'transform .15s'}}><Gl n='chevron'/></span>
            </div>
            {open&&<div style={{padding:'2px 0 6px'}}>{p.facs.map(b=>{ const pagada=b.status==='Pagado'; return (
              <div key={b.id} onClick={()=>onOpenSale&&p.venta&&onOpenSale(p.venta)} style={{display:'flex',alignItems:'center',gap:8,padding:'4px 0 4px 12px',fontSize:11,cursor:onOpenSale&&p.venta?'pointer':'default'}}>
                <span style={{flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>Factura N° {folioN(b.invoice_no)||'—'} <span style={{color:C.textSoft}}>· {mesAA(b.issued_at)}</span></span>
                {(()=>{ const e=estadoFacturaLabel(b,aplicadoByFac[b.id]||0,cartolaHastaEC); return <span style={{fontSize:9,fontWeight:600,color:(e&&e.fg)||C.soon}}>{(e&&e.short)||(pagada?'Pagada':'pend.')}</span> })()}
                <span style={{fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap',textAlign:'right',minWidth:84}}>{fmt(b.amount)}</span>
              </div>) })}</div>}
          </div>) }
        const grpA=porProy.filter(p=>p.sale_id&&p.status==='Activo'); const grpT=porProy.filter(p=>p.sale_id&&p.status&&p.status!=='Activo'); const grpO=porProy.filter(p=>p.sale_id&&!p.status); const sinP=porProy.find(p=>!p.sale_id)
        const grupos2=[['Activas',grpA],['Terminadas',grpT],['Otras',grpO]].filter(([_,it])=>it.length)
        const totFact=porProy.reduce((s,p)=>s+(p.fact||0),0); const totPend=porProy.reduce((s,p)=>s+((p.fact||0)-(p.pag||0)),0)
        return (<div style={{background:C.bgPanel,border:`1px solid ${C.border}`,borderRadius:8,padding:'4px 11px 8px',marginBottom:10}}>
          <div onClick={()=>setPorProyOpen(o=>!o)} style={{display:'flex',alignItems:'center',gap:8,padding:'7px 0',cursor:'pointer'}}>
            <span style={{fontSize:14,color:C.textSoft,lineHeight:1,transform:porProyOpen?'rotate(90deg)':'none',transition:'transform .15s'}}><Gl n='chevron'/></span>
            <span style={{flex:1,fontSize:9,fontWeight:700,color:C.textSoft,textTransform:'uppercase',letterSpacing:.3}}>Por proyecto</span>
            <span style={{fontSize:10,color:C.textSoft,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fmt(totFact)}{totPend>0?<span style={{color:C.accent}}> · por cobrar {fmt(totPend)}</span>:''}</span>
          </div>
          {porProyOpen&&<>
          {grupos2.map(([label,items])=>{ const go=!!openGrp[label]; return (<div key={label} style={{marginBottom:2}}>
            <div onClick={()=>setOpenGrp(p=>({...p,[label]:!p[label]}))} style={{display:'flex',alignItems:'center',gap:6,padding:'5px 0',borderBottom:`1px solid ${C.border}`,cursor:'pointer'}}><span style={{fontSize:12,color:C.textSoft,lineHeight:1,transform:go?'rotate(90deg)':'none',transition:'transform .15s'}}><Gl n='chevron'/></span><span style={{flex:1,fontSize:10,fontWeight:700,color:C.accent,textTransform:'uppercase',letterSpacing:.3}}>{label}</span><span style={{fontSize:10,color:C.textSoft,fontVariantNumeric:'tabular-nums'}}>{items.length} · {fmt(items.reduce((s,p)=>s+p.fact,0))}</span></div>
            {go&&items.map(tile)}
          </div>) })}
          {sinP&&(()=>{ const open=openProy==='_'; return (<div style={{borderTop:`1px solid ${C.border}`,marginTop:4}}>
            <div onClick={()=>setOpenProy(open?null:'_')} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 0 8px',cursor:'pointer'}}>
              <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:500,color:C.overdueText}}>Sin proyecto</div><div style={{fontSize:10,color:C.textSoft,marginTop:2}}>{sinP.facs.length} factura{sinP.facs.length!==1?'s':''} · toca para asignar proyecto</div></div>
              <div style={{fontSize:13,fontWeight:600,textAlign:'right',fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fmt(sinP.fact)}</div>
            </div>
            {open&&<div style={{padding:'2px 0 6px'}}>{sinP.facs.map(b=>(
              <div key={b.id} onClick={()=>onEditBilling&&onEditBilling(b)} style={{display:'flex',alignItems:'center',gap:8,padding:'5px 0 5px 12px',fontSize:11,cursor:onEditBilling?'pointer':'default',borderBottom:`1px solid #F1F1F1`}}>
                <span style={{flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>Factura N° {folioN(b.invoice_no)||'—'} <span style={{color:C.textSoft}}>· {mesAA(b.issued_at)}</span>{onEditBilling&&<span style={{color:C.azulInfo,fontWeight:600}}> · asignar venta</span>}</span>
                <span style={{fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap',textAlign:'right',minWidth:84}}>{fmt(b.amount)}</span>
              </div>))}</div>}
          </div>) })()}
          </>}
        </div>) })()}
      <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:9,fontSize:11,color:C.muted}}>
        <span>Ordenar</span>
        {[['fecha','Fecha'],['proyecto','Proyecto'],['monto','Monto']].map(([v,l])=>(
          <span key={v} onClick={()=>setOrd(v)} style={{padding:'3px 9px',borderRadius:8,border:`1px solid ${ord===v?C.accent:C.border}`,color:ord===v?C.accent:C.muted,fontWeight:ord===v?600:400,cursor:'pointer'}}>{l}</span>
        ))}
      </div>
      {Object.keys(grupos).length===0&&<div style={{fontSize:11,color:C.muted}}>Sin facturas.</div>}
      {Object.entries(grupos).map(([rs,fs])=>{ const abierta=!!openRS[rs]; const rut=(fs.find(b=>b.receptor_rut)||{}).receptor_rut||(clientEntities.find(en=>en.name===rs)||{}).rut||''; const pend=porCobrarBills(fs); return (<div key={rs} style={{marginBottom:8}}>
        <div onClick={()=>setOpenRS(p=>({...p,[rs]:!p[rs]}))} style={{display:'flex',alignItems:'center',gap:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4,marginBottom:1,cursor:'pointer'}}>
          <span style={{fontSize:14,color:C.textSoft,lineHeight:1,transform:abierta?'rotate(90deg)':'none',transition:'transform .15s'}}><Gl n='chevron'/></span>
          <div style={{flex:1,minWidth:0}}><div style={{fontSize:9,fontWeight:700,color:C.accent,textTransform:'uppercase',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{rs}{rut?<span style={{color:C.textSoft,fontWeight:600}}> · {rut}</span>:''}</div></div>
          <span style={{fontSize:10,color:C.textSoft,whiteSpace:'nowrap'}}>{fs.length} fact.{pend>0?<span style={{color:C.overdue}}> · por cobrar {fmt(pend)}</span>:''}</span>
        </div>
        {abierta&&fs.map(b=>{ const open=det===b.id; const pagada=b.status==='Pagado'; const ag=!pagada?aging(b.due):null; const c=concByFac[b.id]; const mv=c?movById[c.movimiento_id]:null; const v=ventaById[b.sale_id]
          const dp=String(b.issued_at||'').slice(0,10).split('-'); const dia=dp.length>=3?dp[2]:'—'; const sub=dp.length>=3?`${['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][parseInt(dp[1])-1]||''} ${dp[0].slice(2)}`:''
          const estB=pagada?estadoFacturaLabel(b,aplicadoByFac[b.id]||0,cartolaHastaEC):null; const eCol=pagada?((estB&&estB.fg)||C.greenText):(ag?ag.c:C.soon); const eBg=pagada?((estB&&estB.bg)||C.greenBg):(eCol===C.overdueText?C.overdueBg:eCol===C.greenText?C.greenBg:C.azulBg); return (
          <div key={b.id}>
            <div onClick={()=>setDet(open?null:b.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 0',cursor:'pointer',borderBottom:open?'none':`1px solid ${C.border}`}}>
              {diaGrande(b.issued_at)}
              <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}><b>Factura N° {folioN(b.invoice_no)||'—'}</b> <span style={{color:C.muted}}>· {b.concept||'—'}</span></div><div style={{marginTop:3}}><span style={{fontSize:9.5,fontWeight:700,padding:'2px 8px',borderRadius:20,background:eBg,color:eCol,whiteSpace:'nowrap'}}>{pagada?((estB&&estB.short)||'Pagada'):(ag?ag.t:'pendiente')}</span></div></div>
              <div style={{fontSize:13,fontWeight:600,textAlign:'right',whiteSpace:'nowrap',fontVariantNumeric:'tabular-nums'}}>{fmt(b.amount)}</div>
            </div>
            {open&&<div style={{padding:'7px 9px',background:C.bgSoft,borderRadius:6,fontSize:11,color:C.muted,lineHeight:1.6,margin:'2px 0 5px'}}>
              <div style={{display:'flex',gap:12,flexWrap:'wrap'}}><span>Tipo: <b style={{color:C.text}}>{b.billing_type||'honorarios'}</b></span><span>Emisión: <b style={{color:C.text}}>{fmtFechaDMY(b.issued_at)}</b></span>{b.due&&<span>Vence: <b style={{color:C.text}}>{fmtFechaDMY(b.due)}</b></span>}</div>
              <div>Monto: <b style={{color:C.text}}>{fmt(montoFactura(b))}</b> · {pagada?((estB&&estB.label)||'Pagada'):`Saldo ${fmt(saldoBill(b))}`}</div>
              {v&&<div style={{marginTop:5,paddingTop:5,borderTop:`1px solid #E4E8EB`}}><div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline'}}><span style={{fontSize:9,fontWeight:700,color:C.textSoft,textTransform:'uppercase'}}>Venta / proyecto</span>{onOpenSale&&<span onClick={(ev)=>{ev.stopPropagation();onOpenSale(v)}} style={{fontSize:10,color:C.azulInfo,fontWeight:600,cursor:'pointer'}}>ver venta ↗</span>}</div><div onClick={onOpenSale?(ev)=>{ev.stopPropagation();onOpenSale(v)}:undefined} style={{color:C.text,cursor:onOpenSale?'pointer':'default'}}><b>{v.title}</b>{v.area?` · ${v.area}`:''}{v.responsible?` · ${v.responsible}`:''}{v.status?` · ${v.status}`:''}</div></div>}
              {pagada&&<div style={{marginTop:5,paddingTop:5,borderTop:`1px solid #E4E8EB`}}><div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline'}}><span style={{fontSize:9,fontWeight:700,color:C.textSoft,textTransform:'uppercase'}}>Pago</span>{c&&onOpenConciliacion&&<span onClick={(ev)=>{ev.stopPropagation();onOpenConciliacion(c.movimiento_id)}} style={{fontSize:10,color:C.azulInfo,fontWeight:600,cursor:'pointer'}}>ver movimiento ↗</span>}</div>
                {c?<div onClick={onOpenConciliacion?(ev)=>{ev.stopPropagation();onOpenConciliacion(c.movimiento_id)}:undefined} style={{color:C.text,cursor:onOpenConciliacion?'pointer':'default'}}>Transferencia <b>{fmt(c.monto_aplicado)}</b>{mv?` · ${fmtFechaDMY(mv.fecha)} · ${mv.rol_cuenta==='gastos'?'Cta. Gastos':'Cta. Honorarios'}${mv.n_operacion?` · N° op. ${mv.n_operacion}`:''}`:''} <span style={{color:C.greenText,fontWeight:600}}><Gl n='tick'/> verificado en banco</span></div>
                  :<div style={{color:C.soon}}>Marcada pagada a mano — sin movimiento bancario enlazado</div>}
              </div>}
            </div>}
          </div>) })}
      </div>) })}
    </div>}
    {Hdr({icon:'wallet',title:'Fondos y gastos',k:'fondos',summary:`saldo ${fmtSaldoG(fg.saldo)}`,sumCol:fg.saldo<0?C.overdue:C.normal})}
    {sec.fondos&&(()=>{ const _sf=(a,b)=>{ const r=(a.date||'')<(b.date||'')?1:-1; return fgOrd==='desc'?r:-r }; const fondos=expenses.filter(e=>e.client_id===client.id&&e.type==='fondo').sort(_sf); const gastos=expenses.filter(e=>e.client_id===client.id&&e.type==='gasto').sort(_sf)
      const faltaPR = e => !e.no_descuenta_saldo && e.category!=='Apertura' && cuentaEnSaldo(e) && (!e.sale_id || (!e.entity_id && (clientEntities||[]).length>0))
      const nPR = onAsociarTrabajo ? [...fondos,...gastos].filter(faltaPR).length : 0
      const fondosV = fgSinPR ? fondos.filter(faltaPR) : fondos, gastosV = fgSinPR ? gastos.filter(faltaPR) : gastos
      const fila=(e,signo,col)=>{ const open=detG===e.id; const v=ventaById[e.sale_id]; const isDev=signo>0&&((e.amount||0)<0||/^\s*devoluci/i.test(e.concept||'')); return (
        <div key={e.id} style={{borderBottom:`1px solid ${C.border}`}}>
          <div onClick={()=>setDetG(open?null:e.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 0',cursor:'pointer'}}>
            {diaGrande(e.date)}
            <div style={{flex:1,minWidth:0}}>
              {/* Fila limpia (regla sutil): tipo o categoría + OT con su sello de pagada; caja chica, banco y rendición quedan en el detalle (recorridoGasto). */}
              {(signo>0||e.category||e.ot_number||e.client_rendered_at)?<div style={{display:'flex',gap:6,alignItems:'center',marginBottom:2,flexWrap:'wrap'}}>{signo>0?<span style={{fontSize:9.5,padding:'2px 8px',borderRadius:20,background:isDev?C.azulBg:C.greenBg,color:isDev?C.azulInfo:C.greenText,fontWeight:700,whiteSpace:'nowrap'}}>{isDev?'Devolución':'Fondo'}</span>:(e.category&&<span style={{fontSize:9.5,padding:'2px 8px',borderRadius:20,background:C.bgWarm,color:C.muted,fontWeight:700,whiteSpace:'nowrap'}}>{e.category}</span>)}{signo<0&&otConSello(e)}{signo<0&&e.client_rendered_at&&<span style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:10.5,color:C.textSoft,whiteSpace:'nowrap'}}><CheckMini s={10}/>Rendido {fmtFechaDMY(e.client_rendered_at)}</span>}</div>:null}
              <div style={{fontSize:12,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.concept||e.category||(signo>0?(isDev?'Devolución':'Fondo'):'Gasto')}</div>
            </div>
            <div style={{fontSize:13,fontWeight:600,textAlign:'right',whiteSpace:'nowrap',fontVariantNumeric:'tabular-nums',color:isDev?C.muted:col,flexShrink:0}}>{isDev?'−'+fmt(Math.abs(e.amount)):(signo>0?'+':'−')+fmt(e.amount)}</div>
            <span style={{color:C.textSoft,fontSize:16,lineHeight:1,flexShrink:0,transform:open?'rotate(90deg)':'none',transition:'transform .15s'}}><Gl n='chevron'/></span>
          </div>
          {open&&<div style={{padding:'8px 10px',background:C.bgSoft,borderRadius:6,fontSize:11,color:C.muted,lineHeight:1.6,margin:'0 0 7px'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:8,marginBottom:3}}><span style={{fontSize:12,color:C.text,fontWeight:600,minWidth:0}}>{e.concept||e.category||(signo>0?(isDev?'Devolución':'Fondo recibido'):'Gasto')}</span>{onEditExpense&&<span onClick={(ev)=>{ev.stopPropagation();onEditExpense(e)}} style={{fontSize:10,color:C.azulInfo,fontWeight:600,cursor:'pointer',flexShrink:0}}>editar gasto ↗</span>}</div>
            <div style={{display:'flex',gap:12,flexWrap:'wrap'}}><span>Tipo: <b style={{color:C.text}}>{signo>0?(isDev?'Devolución':'Fondo recibido'):'Gasto'}</b></span><span>Fecha: <b style={{color:C.text}}>{fmtFechaDMY(e.date)}</b></span><span>Monto: <b style={{color:isDev?C.muted:col}}>{isDev?'−'+fmt(Math.abs(e.amount)):fmt(e.amount)}</b></span>{e.category&&<span>Categoría: <b style={{color:C.text}}>{e.category}</b></span>}</div>
            <div style={{marginTop:5,paddingTop:5,borderTop:`1px solid #E4E8EB`}}><div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:8}}><span style={{fontSize:9,fontWeight:700,color:C.textSoft,textTransform:'uppercase'}}>Venta / proyecto · razón social</span><span style={{display:'flex',gap:10,flexShrink:0}}>{v&&onOpenSale&&<span onClick={(ev)=>{ev.stopPropagation();onOpenSale(v)}} style={{fontSize:10,color:C.azulInfo,fontWeight:600,cursor:'pointer'}}>ver venta ↗</span>}{ultAsig?.ids.has(e.id)&&ultAsig.n===1&&<span onClick={(ev)=>{ev.stopPropagation();deshacerAsig()}} style={{fontSize:10,color:C.azulInfo,fontWeight:600,cursor:'pointer'}}>deshacer</span>}</span></div>
              {(()=>{ const entName=id=>{ const en=(clientEntities||[]).find(x=>String(x.id)===String(id)); return en?en.name:'Razón social asignada' }
                const txtProy = v?<><b>{v.title}</b>{e.subproject?<b>{` · ${e.subproject}`}</b>:null}{v.area?` · ${v.area}`:''}{v.responsible?` · ${v.responsible}`:''}{v.status?` · ${v.status}`:''}</>:(e.project?<b>{e.project}{e.subproject?` · ${e.subproject}`:''}</b>:null)
                // Corregir: el dato mismo se toca → selectores con lo actual → Confirmar (con "antes" a la vista). Deshacer queda en línea.
                if(onAsociarTrabajo&&corrG?.id===e.id){ const vs=(sales||[]).filter(s=>String(s.client_id)===String(e.client_id)&&(VENTA_REAL(s)||String(s.id)===String(e.sale_id))); const ents=clientEntities||[]
                  const cambia = String(corrG.sale||'')!==String(e.sale_id||'') || String(corrG.ent||'')!==String(e.entity_id||'')
                  const sel={flex:'1 1 170px',minWidth:0,fontSize:12,padding:'6px 8px',borderRadius:8,border:`1px solid ${C.border}`,background:C.card,color:C.text}
                  const confirmar=async()=>{ if(!cambia) return; if(e.client_rendered_at&&!(await appConfirm(`Este movimiento ya se rindió al cliente el ${fmtFechaDMY(e.client_rendered_at)} con el proyecto anterior. ¿Cambiarlo igual?`))) return; await asignar([e], corrG.sale||'', corrG.ent||'', '', {forzar:true}); setCorrG(null) }
                  return <div onClick={ev=>ev.stopPropagation()} style={{marginTop:4}}>
                    <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                      {vs.length>0&&<select value={corrG.sale||''} onChange={ev=>setCorrG(c=>({...c,sale:ev.target.value}))} aria-label='Proyecto' style={sel}><option value=''>Proyecto…</option>{vs.map(x=><option key={x.id} value={x.id}>{x.title}{x.status!=='Activo'?` (${String(x.status||'').toLowerCase()})`:''}</option>)}</select>}
                      {ents.length>0&&<select value={corrG.ent||''} onChange={ev=>setCorrG(c=>({...c,ent:ev.target.value}))} aria-label='Razón social' style={sel}><option value=''>Razón social…</option>{ents.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>}
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:10,marginTop:6,flexWrap:'wrap'}}>
                      <span style={{flex:1,minWidth:0,fontSize:10.5,color:C.muted}}>antes: {[v?.title||e.project||'sin proyecto', e.entity_id?entName(e.entity_id):'sin razón social'].join(' · ')}</span>
                      <span onClick={()=>setCorrG(null)} style={{fontSize:11,color:C.azulInfo,fontWeight:600,cursor:'pointer'}}>cancelar</span>
                      <button disabled={!cambia} onClick={confirmar} style={{fontSize:12,fontWeight:700,borderRadius:8,padding:'6px 12px',border:'none',background:cambia?C.accent:C.done,color:C.surface,cursor:cambia?'pointer':'default'}}>Confirmar</button>
                    </div></div> }
                const tap = (cont)=> <div onClick={(ev)=>{ev.stopPropagation();setCorrG({id:e.id,sale:e.sale_id||'',ent:e.entity_id||''})}} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,border:`1px dashed ${C.border}`,borderRadius:8,padding:'5px 8px',marginTop:4,cursor:'pointer',color:C.text}}><span style={{minWidth:0}}>{cont}</span><span style={{color:C.textSoft,flexShrink:0}}>⌄</span></div>
                return <>
                  {txtProy&&(onAsociarTrabajo ? tap(txtProy) : <div onClick={v&&onOpenSale?(ev)=>{ev.stopPropagation();onOpenSale(v)}:undefined} style={{color:C.text,cursor:v&&onOpenSale?'pointer':'default'}}>{txtProy}</div>)}
                  {!txtProy&&!onAsociarTrabajo&&<div style={{color:C.overdue}}>Sin proyecto asignado</div>}
                  {e.entity_id&&onAsociarTrabajo&&tap(<span style={{color:C.muted}}>{entName(e.entity_id)}</span>)}
                </> })()}
              {ultAsig?.ids.has(e.id)&&ultAsig.n>1&&<div style={{display:'flex',alignItems:'baseline',gap:8,background:C.greenBg,color:C.greenText,borderRadius:8,padding:'7px 10px',marginTop:5,fontSize:12}}><span>Asignados {ultAsig.n} · {fmt(ultAsig.monto)}</span><span onClick={(ev)=>{ev.stopPropagation();deshacerAsig()}} style={{marginLeft:'auto',color:C.azulInfo,fontWeight:600,cursor:'pointer'}}>deshacer</span></div>}
              {onAsociarTrabajo&&corrG?.id!==e.id&&(!v||!e.entity_id)&&<AsignarProyectoRS e={e} otros={sinProy.filter(x=>x.type===e.type)} ventas={(sales||[]).filter(s=>String(s.client_id)===String(e.client_id)&&VENTA_REAL(s))} ents={clientEntities||[]} subs={subproyectosCliente(e.client_id,tasks,expenses)} ctx={{aprendidos:aprVenta,hermanos:expenses,ia:iaVenta}} onAsignar={asignar}/>}
              {((e.entity_id&&!onAsociarTrabajo)||!onAsociarTrabajo||(!e.entity_id&&!(clientEntities||[]).length))&&<div style={{color:e.entity_id?C.muted:C.overdue,marginTop:1}}>{e.entity_id?(()=>{const ent=(clientEntities||[]).find(x=>String(x.id)===String(e.entity_id));return ent?ent.name:'Razón social asignada'})():'Sin razón social asignada'}</div>}</div>
            {/* Pago / depósito: de dónde viene o a dónde fue la plata (banco, notaría, caja chica, rendición, fondo que lo cubre). Cada enlace lleva al dato. */}
            {(()=>{ const links=recorridoGasto(e,{conc,movById,expenses}).map(p=>({k:p.k, t:p.t, d:[p.fecha?fmtFechaDMY(p.fecha):null, p.d].filter(Boolean).join(' · '), on:p.mov&&onOpenConciliacion?()=>onOpenConciliacion(p.mov):p.fondo?()=>setDetG(p.fondo):null}))
              if(!links.length) return null
              return <div style={{marginTop:5,paddingTop:5,borderTop:`1px solid ${C.border}`}}>
                <span style={{fontSize:9,fontWeight:700,color:C.textSoft,textTransform:'uppercase'}}>{signo>0?'Depósito':'Pago'}</span>
                {links.map(l=><div key={l.k} onClick={l.on?(ev)=>{ev.stopPropagation();l.on()}:undefined} style={{display:'flex',gap:6,alignItems:'baseline',color:C.text,cursor:l.on?'pointer':'default'}}><b>{l.t}</b><span style={{color:C.muted}}>{l.d}</span>{l.on&&<span style={{marginLeft:'auto',color:C.azulInfo,fontWeight:600,flexShrink:0}}>Ver <Gl n='chevron'/></span>}</div>)}
              </div> })()}
            {(e.created_by||e.notas)&&<div style={{marginTop:3}}>{e.created_by?`Registrado por ${e.created_by}`:''}{e.notas?` · ${e.notas}`:''}</div>}
          </div>}
        </div>) }
      const sinProy=[...fondos,...gastos].filter(e=>!e.sale_id&&!e.no_descuenta_saldo&&e.category!=='Apertura'&&cuentaEnSaldo(e)).sort((a,b)=>(a.date||'')<(b.date||'')?1:-1)
      return (<div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,marginBottom:8}}>
        <div style={{fontSize:11,color:C.muted}}>Fondos {fmt(fg.fondos)} − Gastos {fmt(fg.gastos)} = <b style={{color:fg.saldo<0?C.overdueText:C.greenText}}>{fmtSaldoG(fg.saldo)}</b></div>
        <div style={{display:'flex',gap:6,flexShrink:0}}>
          {(nPR>0||fgSinPR)&&<button onClick={()=>setFgSinPR(x=>!x)} style={{fontSize:11,fontWeight:600,padding:'4px 11px',borderRadius:999,border:`1px solid ${fgSinPR?C.accent:C.border}`,background:fgSinPR?C.accent:'#fff',color:fgSinPR?C.surface:C.text,cursor:'pointer',whiteSpace:'nowrap'}}>Sin proyecto o RS · {nPR}{fgSinPR?<>{" "}<Gl n='x'/></>:''}</button>}
          <button onClick={()=>setFgOrd(o=>o==='desc'?'asc':'desc')} title='Ordenar por fecha' style={{fontSize:11,fontWeight:600,padding:'4px 11px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.accent,cursor:'pointer',whiteSpace:'nowrap'}}>Fecha {fgOrd==='desc'?'↓':'↑'}</button>
        </div>
      </div>
      {onRendicion&&(()=>{ const pr=gastosPorRendirCli(expenses,client.id); if(!pr.length) return null; const m=pr.reduce((t,e)=>t+(Number(e.amount)||0),0); return <div style={{display:'flex',alignItems:'center',gap:10,background:C.greenBg,borderRadius:10,padding:'7px 8px 7px 13px',marginBottom:10}}><span style={{flex:1,minWidth:0,fontSize:12.5,fontWeight:600,color:C.greenText,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>Por rendir · {pr.length} gasto{pr.length!==1?'s':''}</span><b style={{color:C.greenText,fontVariantNumeric:'tabular-nums'}}>{fmt(m)}</b><ActBtn variant='success' onClick={onRendicion}>Rendir</ActBtn></div> })()}
      <div style={{fontSize:9,fontWeight:700,color:C.accent,textTransform:'uppercase',marginBottom:2}}>Fondos recibidos</div>
      {fondosV.length===0&&<div style={{fontSize:11,color:C.muted}}>—</div>}
      {fondosV.map(e=>fila(e,1,C.greenText))}
      <div style={{fontSize:9,fontWeight:700,color:C.accent,textTransform:'uppercase',margin:'8px 0 2px'}}>Gastos</div>
      {gastosV.length===0&&<div style={{fontSize:11,color:C.muted}}>—</div>}
      {gastosV.map(e=>fila(e,-1,C.overdueText))}
      <BitacoraLista plano prefijo={`clientes.${client.id}.`} autor='Administración' limite={50}/>
    </div>) })()}
    {Hdr({icon:'clock',title:'Anticipos',k:'adelantos',summary:anticipos.length?`${anticipos.length}`:'sin anticipos'})}
    {sec.adelantos&&<div style={{padding:'2px 13px 12px'}}>
      {(anticipos||[]).length===0&&<div style={{fontSize:11,color:C.muted}}>Sin adelantos.</div>}
      {(anticipos||[]).slice().sort((a,b)=>(a.fecha||'')<(b.fecha||'')?1:-1).map(a=>{ const bill=(clientBilling||[]).find(b=>String(b.id)===String(a.billing_id)); const clickable=a.estado!=='disponible'&&bill&&onEditBilling; return (<div key={a.id} onClick={clickable?()=>onEditBilling(bill):undefined} title={clickable?`Ver factura N° ${folioN(bill.invoice_no)||'—'}`:undefined} style={{display:'flex',justifyContent:'space-between',fontSize:11,padding:'4px 0',borderBottom:'1px solid #F1F1F1',cursor:clickable?'pointer':'default'}}><span>{(a.nota||'Anticipo').slice(0,30)} <span style={{color:C.textSoft}}>· {fmtFechaDMY(a.fecha)}</span></span><span style={{textAlign:'right'}}><b style={{color:C.greenText}}>{fmt(a.monto)}</b> <span style={{fontSize:9,color:a.estado==='disponible'?C.greenText:C.done}}>{a.estado}</span>{clickable?<span style={{color:C.textSoft,marginLeft:4}}><Gl n='chevron'/></span>:''}</span></div>) })}
    </div>}
    </div>
  </div>)
}

// otros: los demás movimientos del cliente sin proyecto. Al elegir el proyecto se listan (por descripción) para sumarlos al mismo.
export function AsignarProyectoRS({e, items, otros=[], ventas=[], ents=[], subs=[], ctx={}, onAsignar}){
  const [marc,setMarc] = useState(()=>new Set())
  const lote = items || (e ? [e] : [])
  const faltaV = lote.some(x=>!x.sale_id), faltaRS = ents.length>0 && lote.some(x=>!x.entity_id)
  const sug = e ? sugerirVentaGasto(e, ventas, ctx) : {venta: ventas.length===1 ? ventas[0] : (ventas.filter(s=>s.status==='Activo').length===1 ? ventas.find(s=>s.status==='Activo') : null)}
  const [v,setV] = useState(sug.venta?String(sug.venta.id):'')
  const rsDeV = id => { const s=ventas.find(x=>String(x.id)===String(id)); return s&&s.entity_id&&ents.some(en=>String(en.id)===String(s.entity_id)) ? String(s.entity_id) : (ents.length===1 ? String(ents[0].id) : '') }
  const [rs,setRs] = useState(rsDeV(v))
  const [sub,setSub] = useState('')
  const vSel = ventas.find(x=>String(x.id)===String(v))
  const pideSub = faltaV && esPermanente(vSel)
  if(!faltaV && !faltaRS) return null
  const sel = {flex:'1 1 170px',minWidth:0,fontSize:12,padding:'6px 8px',borderRadius:8,border:`1px solid ${C.border}`,background:C.card,color:C.text}
  const ok = (faltaV&&v) || (faltaRS&&rs)
  const lista = e && faltaV && v ? otros.filter(x=>x.id!==e.id) : []
  const extra = lista.filter(x=>marc.has(x.id))
  const todoLote = [...lote, ...extra]
  const asig = ()=>{ const rsX = faltaRS ? rs : (extra.some(x=>!x.entity_id) ? rsDeV(v) : ''); onAsignar(todoLote, faltaV?v:'', rsX, pideSub?sub.trim():''); setMarc(new Set()) }
  const btn = <button disabled={!ok} onClick={asig} style={{fontSize:12,fontWeight:700,borderRadius:8,padding:'6px 12px',border:'none',background:ok?C.accent:C.done,color:C.surface,cursor:ok?'pointer':'default',whiteSpace:'nowrap'}}>{todoLote.length>1?(items?`Asignar a los ${todoLote.length}`:`Asignar ${todoLote.length} · ${fmt(todoLote.reduce((a,x)=>a+Math.abs(x.amount||0),0))}`):'Asignar'}</button>
  const ck = on => <span style={{width:15,height:15,borderRadius:4,border:`1.5px solid ${on?C.accent:C.done}`,background:on?C.accent:'transparent',color:C.surface,fontSize:10,display:'grid',placeItems:'center',flexShrink:0,marginTop:1}}>{on?<Gl n='tick'/>:''}</span>
  if(lista.length) return (
    <div onClick={ev=>ev.stopPropagation()} style={{marginTop:5}}>
      <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
        {ventas.length>0&&<select value={v} onChange={ev=>{ setV(ev.target.value); const r=rsDeV(ev.target.value); if(r) setRs(r) }} aria-label='Proyecto' style={sel}>
          <option value=''>Proyecto…</option>
          {ventas.map(s=><option key={s.id} value={s.id}>{s.title}{s.status!=='Activo'?` (${s.status.toLowerCase()})`:''}</option>)}
        </select>}
        {pideSub&&<><input value={sub} onChange={ev=>setSub(ev.target.value)} list='asig-subproy' placeholder='Subproyecto…' aria-label='Subproyecto' style={sel}/><datalist id='asig-subproy'>{subs.map(x=><option key={x} value={x}/>)}</datalist></>}
        {faltaRS&&<select value={rs} onChange={ev=>setRs(ev.target.value)} aria-label='Razón social' style={sel}>
          <option value=''>Razón social…</option>
          {ents.map(en=><option key={en.id} value={en.id}>{en.name}</option>)}
        </select>}
        {faltaV&&sug.venta&&String(sug.venta.id)===String(v)&&sug.porque&&<div style={{flexBasis:'100%',fontSize:10.5,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={sug.porque}>Sugerido · {sug.porque}</div>}
      </div>
      <div style={{marginTop:7,paddingTop:7,borderTop:`1px solid ${C.border}`}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:8,marginBottom:2}}><b style={{fontSize:11.5,color:C.text}}>Otros sin proyecto · ¿van a este mismo?</b><span onClick={()=>setMarc(extra.length===lista.length?new Set():new Set(lista.map(x=>x.id)))} style={{fontSize:11,color:C.azulInfo,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>{extra.length===lista.length?'Desmarcar':'Marcar todos'}</span></div>
        {lista.map(x=>{ const on=marc.has(x.id); const ot=x.ot_number?(String(x.ot_number).toUpperCase().startsWith('OT')?x.ot_number:'OT-'+x.ot_number):null
          return <div key={x.id} onClick={()=>setMarc(s=>{ const n=new Set(s); n.has(x.id)?n.delete(x.id):n.add(x.id); return n })} style={{display:'flex',alignItems:'flex-start',gap:8,padding:'7px 0',borderBottom:`1px solid ${C.border}`,cursor:'pointer'}}>
            {ck(on)}
            <span style={{flex:1,minWidth:0,display:'grid',gap:1}}><span style={{fontSize:12,color:C.text,lineHeight:1.35}}>{String(x.concept||x.category||'Sin descripción').replace(/^gastos notariales\s*[—–-]\s*/i,'')}</span><span style={{fontSize:10.5,color:C.muted}}>{[fmtFechaDMY(x.date),ot].filter(Boolean).join(' · ')}</span></span>
            <span style={{fontSize:12,color:C.text,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fmt(Math.abs(x.amount||0))}</span>
          </div> })}
        <div style={{display:'flex',justifyContent:'flex-end',marginTop:8}}>{btn}</div>
      </div>
    </div>)
  return (
    <div onClick={ev=>ev.stopPropagation()} style={{display:'flex',gap:6,alignItems:'center',marginTop:5,flexWrap:'wrap'}}>
      {faltaV&&ventas.length>0&&<select value={v} onChange={ev=>{ setV(ev.target.value); const r=rsDeV(ev.target.value); if(r) setRs(r) }} aria-label='Proyecto' style={sel}>
        <option value=''>Proyecto…</option>
        {ventas.map(s=><option key={s.id} value={s.id}>{s.title}{s.status!=='Activo'?` (${s.status.toLowerCase()})`:''}</option>)}
      </select>}
      {pideSub&&<><input value={sub} onChange={ev=>setSub(ev.target.value)} list='asig-subproy' placeholder='Subproyecto…' aria-label='Subproyecto' style={sel}/><datalist id='asig-subproy'>{subs.map(x=><option key={x} value={x}/>)}</datalist></>}
      {faltaRS&&<select value={rs} onChange={ev=>setRs(ev.target.value)} aria-label='Razón social' style={sel}>
        <option value=''>Razón social…</option>
        {ents.map(en=><option key={en.id} value={en.id}>{en.name}</option>)}
      </select>}
      {btn}
      {faltaV&&sug.venta&&String(sug.venta.id)===String(v)&&sug.porque&&<div style={{flexBasis:'100%',fontSize:10.5,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={sug.porque}>Sugerido · {sug.porque}</div>}
    </div>)
}

export function CotejoVenta({sale, saleBills=[], orphans=[], isDesktop, client=null, entities=[], nested=false, sinMetricas=false, onOpenFactura, onAssociate}){
  const [pickFor,setPickFor] = useState(null)   // orphan.id en modo "elige cuota" (móvil / sin drag)
  const [hover,setHover] = useState(null)        // prog.id resaltada (elegida con «Asociar»)
  // Arrastrar una factura sin asociar a su cuota (mouse o dedo: useArrastre). En el celular sigue también «Asociar».
  const grupoArr = 'cotejo-'+(sale?.id||'')
  const arrF = useArrastre({grupo:grupoArr, onSoltar:(oid,progId)=>{ setPickFor(null); setHover(null); onAssociate&&onAssociate(progId,oid) }})
  const [view,setView] = useState(()=>{ try{ return localStorage.getItem('cotejo_view')||'linea' }catch(_){ return 'linea' } })
  const setViewP = v => { setView(v); try{ localStorage.setItem('cotejo_view',v) }catch(_){} }
  const useTable = isDesktop && view==='tabla'

  const plan = planDeVenta(sale)
  const hoy = isoLocal(new Date())
  // Vencimiento EFECTIVO: una programada de un mes ya pasado rodó al mes en curso (fuente única rolledDueMap).
  const rollMap = rolledDueMap(saleBills, hoy)
  const effDue = b => rollMap.get(String(b.id)) || b.due || b.issued_at
  const emit = b => !!b.invoice_no
  // Orden FIFO: por nº de cuota (1→10); sin nº, por vencimiento efectivo. Arregla el 2,1,4,3 (empates de fecha).
  const cnN = b => { const cn=cuotaNMof(b.concept); return cn?cn.n:9999 }
  const cuotas = (saleBills||[]).filter(b=>!b.deleted_at && b.status!=='Anulada' && b.billing_type!=='reembolso')
    .slice().sort((a,b)=> (cnN(a)-cnN(b)) || String(effDue(a)||'').localeCompare(String(effDue(b)||'')))
  const huecos = cuotas.filter(b=> !b.invoice_no)   // cuotas por emitir = destinos de asociación
  const olvidadas = cuotasOlvidadas(saleBills)      // saltadas (una emitida posterior las dejó atrás)
  const olvidadasSet = new Set(olvidadas.map(b=>String(b.id)))
  const mmm = d => { const s=String(d||''); return s.length>=7 ? `${_MES_AB[+s.slice(5,7)-1]} ${s.slice(2,4)}` : '' }
  const etiqueta = b => { const cn=cuotaNMof(b.concept); if(cn) return `Cuota ${cn.n}/${cn.tot}`; const per=concPeriodoOf(b.concept); if(per) return mmm(per+'-01'); return mmm(effDue(b))||'Cobro' }
  const estTxt = b => ({Pagado:'pagada',Pendiente:'pendiente',Vencido:'vencida',Anticipada:'anticipada'}[b.status]||'emitida')
  const estCol = b => ({Pagado:C.greenText,Pendiente:C.soonText,Vencido:C.overdueText,Anticipada:C.accent}[b.status]||C.greenText)
  const doAssoc = async (progId, orphanId) => { setPickFor(null); setHover(null); if(onAssociate) await onAssociate(progId, orphanId) }

  // Razón social + RUT a quien se factura (un cliente puede tener varias RS: se ordenan por RS, no por cliente).
  const nr = r => String(r||'').replace(/[.\s-]/g,'').toUpperCase()
  const entOf = b => { if(b.entity_id){ const e=entities.find(x=>String(x.id)===String(b.entity_id)); if(e) return e } const r=nr(b.receptor_rut); if(r){ const e=entities.find(x=>nr(x.rut)===r); if(e) return e } return null }
  const rutOf = b => { const e=entOf(b); return (e&&e.rut)?String(e.rut).trim():String(b.receptor_rut||'').trim() }
  const rsList = []; { const seen=new Set(); cuotas.forEach(b=>{ const e=entOf(b); const key=e?('e'+e.id):('r'+nr(b.receptor_rut)); if((e||b.receptor_rut)&&!seen.has(key)){ seen.add(key); rsList.push({name:e?e.name:(b.receptor_name||'Sin razón social'), rut:e?e.rut:b.receptor_rut}) } }) }

  const planN = plan.length
  const nTot = planN || cuotas.length
  const uf = (sale.amount_uf||0)*(sale.cobro_type==='mensual'?12:1)
  const nEmit = cuotas.filter(emit).length, nHueco = huecos.length
  const cobrado = cuotas.reduce((a,b)=>a+cobradoBill(b),0)
  const porEmitir = huecos.reduce((a,b)=>a+(b.amount||0),0)

  const dmy = iso => fmtFechaDMY(iso) || '—'
  const rutTxt = b => { const r=rutOf(b); return r||'' }

  // ── Celdas de la línea de tiempo ──
  const celdaCuota = (b) => { const olv=olvidadasSet.has(String(b.id))
    return (<div style={{background:emit(b)?'#fff':(olv?'#FCEBEB':(C.soonBg||'#FFFBF0')),border:`1px solid ${emit(b)?C.border:(olv?C.overdueText:(C.soon||'#EBD9AE'))}`,borderRadius:10,padding:'8px 10px'}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:8}}><span style={{fontSize:12.5,color:C.text,fontWeight:600}}>{etiqueta(b)}</span><span style={{fontSize:12.5,color:C.muted,fontVariantNumeric:'tabular-nums'}}>{fmt(b.amount||0)}</span></div>
      <div style={{fontSize:10.5,color:olv?C.overdueText:C.muted,marginTop:2}}>{emit(b)?`Vence ${dmy(b.due)}`:`Vence ${dmy(effDue(b))}`}{olv?' · sin facturar':''}</div>
    </div>) }
  const celdaFactura = (b) => emit(b) ? (
    <div onClick={()=>onOpenFactura&&onOpenFactura(b)} style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:10,padding:'8px 10px',cursor:onOpenFactura?'pointer':'default'}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'center'}}><span style={{fontSize:12.5,color:C.accent,fontWeight:700}}>Factura N° {folioN(b.invoice_no)||b.invoice_no}</span><span style={{fontSize:12.5,color:C.text,fontVariantNumeric:'tabular-nums'}}>{fmt(montoFactura(b)||b.amount||0)}</span></div>
      <div style={{fontSize:10.5,color:C.muted,marginTop:2,display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}><span style={{color:estCol(b),fontWeight:600}}>{estTxt(b)}</span><span>Emitida {dmy(b.issued_at)}</span>{rutTxt(b)&&<span>· {rutTxt(b)}</span>}<span style={{color:C.textSoft,marginLeft:'auto'}}><Gl n='chevron'/></span></div>
    </div>
  ) : (
    <div data-soltar={b.id} data-soltar-grupo={grupoArr}
      style={{border:`1.5px dashed ${(hover===b.id||arrF.sobre===String(b.id))?C.accent:(C.soon||'#EBD9AE')}`,background:(hover===b.id||arrF.sobre===String(b.id))?(C.azulBg||'#EAF0F3'):'transparent',borderRadius:10,padding:'8px 10px',display:'flex',justifyContent:'space-between',gap:8,alignItems:'center',transition:'background .1s'}}>
      <span style={{fontSize:12,color:C.soonText}}>por emitir</span>
      {orphans.length>0&&<span style={{fontSize:10.5,color:C.muted}}>{isDesktop?'arrastra aquí':''}</span>}
    </div>
  )

  return (
    <div style={{border:nested?'none':`1px solid ${C.border}`,borderRadius:nested?0:12,padding:nested?'6px 0 0':'12px 13px',marginBottom:nested?0:9,background:nested?'transparent':'#fff'}}>
      {/* Encabezado: proyecto + cliente + razón social + RUT + métricas */}
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}>
        <div style={{minWidth:0}}>
          {!nested&&<div style={{fontSize:14.5,fontWeight:700,color:C.text}}>{sale.title}</div>}
          {client&&<div style={{fontSize:11.5,color:C.muted,marginTop:1}}>Cliente <b style={{color:C.text,fontWeight:600}}>{client.name}</b>{rsList.length?' · facturado a':''}</div>}
          {rsList.length>0&&<div style={{display:'inline-flex',alignItems:'center',gap:6,background:C.azulBg||'#EAF0F3',color:C.accent,borderRadius:8,padding:'3px 9px',fontSize:12,fontWeight:600,marginTop:6}}>{rsDisplay?rsDisplay(rsList[0].name):rsList[0].name}{rsList[0].rut&&<span style={{color:C.muted,fontWeight:500}}>· {rsList[0].rut}</span>}{rsList.length>1&&<span style={{color:C.muted,fontWeight:500}}>+{rsList.length-1}</span>}</div>}
        </div>
        {isDesktop&&<div style={{display:'inline-flex',border:`1px solid ${C.border}`,borderRadius:9,overflow:'hidden',flexShrink:0}}>
          {[['linea','Línea'],['tabla','Tabla']].map(([v,l])=><button key={v} onClick={()=>setViewP(v)} style={{border:'none',background:view===v?C.accent:'#fff',color:view===v?'#fff':C.muted,fontSize:11.5,fontWeight:600,padding:'6px 13px',cursor:'pointer'}}>{l}</button>)}
        </div>}
      </div>
      {!sinMetricas&&<div style={{display:'flex',gap:16,marginTop:10,flexWrap:'wrap'}}>
        <div style={{fontSize:10.5,color:C.muted}}>Plan<div style={{fontSize:13,fontWeight:700,color:C.text}}>{nTot} cuota{nTot!==1?'s':''}{uf>0?` · ${fmtUF(uf)}`:''}</div></div>
        <div style={{fontSize:10.5,color:C.muted}}>Cobrado<div style={{fontSize:13,fontWeight:700,color:C.greenText,fontVariantNumeric:'tabular-nums'}}>{fmtShort(cobrado)}</div></div>
        <div style={{fontSize:10.5,color:C.muted}}>Facturado<div style={{fontSize:13,fontWeight:700,color:C.text}}>{nEmit} de {nTot}</div></div>
        <div style={{fontSize:10.5,color:C.muted}}>Por emitir<div style={{fontSize:13,fontWeight:700,color:nHueco?C.soonText:C.muted,fontVariantNumeric:'tabular-nums'}}>{nHueco?fmtShort(porEmitir):'$0'}</div></div>
      </div>}

      {/* AVISO: cuota(s) que quedaron sin facturar (una cuota posterior las dejó atrás) */}
      {olvidadas.length>0 && (()=>{ const o=olvidadas.slice().sort((a,b)=>cnN(a)-cnN(b))[0]
        return (<div onClick={()=>onOpenFactura&&onOpenFactura(o)} style={{marginTop:11,display:'flex',alignItems:'center',gap:9,background:'#FCEBEB',border:`1px solid ${C.overdueText}`,borderRadius:10,padding:'9px 11px',cursor:onOpenFactura?'pointer':'default'}}>
          <SIcon n='alert' s={16} c={C.overdueText}/>
          <div style={{flex:1,minWidth:0,fontSize:12,color:C.overdueText}}><b style={{fontWeight:700}}>{olvidadas.length} cuota{olvidadas.length!==1?'s':''} sin facturar.</b> Se emitió una posterior y quedó atrás la {etiqueta(o)} (venció {dmy(o.due)}). {onOpenFactura?<>Facturar ahora{" "}<Gl n='chevron'/></>:''}</div>
        </div>) })()}

      <div style={{marginTop:11}}>
      {useTable ? (
        <div style={{border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden'}}>
          <div style={{display:'grid',gridTemplateColumns:'26px 1.1fr 92px 1.1fr 96px 92px',gap:'0 12px',...TH_BAND,padding:'8px 10px'}}>
            <span>#</span><span>Cuota / vence</span><span style={{textAlign:'right'}}>Programado</span><span>Factura</span><span>RUT</span><span style={{textAlign:'right'}}>Emitido</span>
          </div>
          {cuotas.map((b,i)=>{ const olv=olvidadasSet.has(String(b.id))
            return (<div key={b.id} onClick={()=>emit(b)&&onOpenFactura&&onOpenFactura(b)} style={{display:'grid',gridTemplateColumns:'26px 1.1fr 92px 1.1fr 96px 92px',gap:'0 12px',alignItems:'center',padding:'9px 10px',borderTop:`1px solid ${C.border}`,background:emit(b)?'#fff':(olv?'#FEF4F4':'#FEFDF9'),cursor:emit(b)&&onOpenFactura?'pointer':'default',fontSize:12}}>
              <span style={{color:C.muted}}>{cuotaNMof(b.concept)?.n||i+1}</span>
              <span><span style={{fontWeight:600,color:C.text}}>{etiqueta(b)}</span><span style={{display:'block',fontSize:10.5,color:olv?C.overdueText:C.muted}}>{dmy(emit(b)?b.due:effDue(b))}{olv?' · sin facturar':''}</span></span>
              <span style={{textAlign:'right',fontVariantNumeric:'tabular-nums',color:C.text}}>{fmt(b.amount||0)}</span>
              <span>{emit(b)?<><span style={{fontWeight:700,color:C.accent}}>Factura N° {folioN(b.invoice_no)||b.invoice_no}</span> <span style={{color:estCol(b),fontSize:11}}>{estTxt(b)}</span><span style={{display:'block',fontSize:10,color:C.muted}}>Emitida {dmy(b.issued_at)}</span></>:<span style={{color:C.soonText,fontWeight:600}}>Por emitir</span>}</span>
              <span style={{fontSize:11,color:C.muted}}>{rutTxt(b)||'—'}</span>
              <span style={{textAlign:'right',fontVariantNumeric:'tabular-nums',color:emit(b)?C.text:C.muted,fontWeight:emit(b)?600:400}}>{emit(b)?fmt(montoFactura(b)||b.amount||0):'—'}</span>
            </div>) })}
        </div>
      ) : isDesktop ? (
        <div style={{display:'grid',gridTemplateColumns:'1fr 24px 1fr',gap:'0 8px',alignItems:'center'}}>
          <div style={{fontSize:9.5,color:C.muted,letterSpacing:.4,fontWeight:700,padding:'0 2px 4px'}}>PROGRAMADO</div><div/><div style={{fontSize:9.5,color:C.muted,letterSpacing:.4,fontWeight:700,padding:'0 2px 4px'}}>EMITIDO</div>
          {cuotas.map(b=>(<Fragment key={b.id}>
            <div style={{marginBottom:8}}>{celdaCuota(b)}</div>
            <div style={{display:'flex',justifyContent:'center',marginBottom:8,color:emit(b)?C.greenText:(C.soon||'#C9A94A')}}>{emit(b)?<SIcon n='check' s={14} c={C.greenText}/>:<span style={{fontSize:13,color:C.soonText}}>·</span>}</div>
            <div style={{marginBottom:8}}>{celdaFactura(b)}</div>
          </Fragment>))}
        </div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:7}}>
          {cuotas.map(b=>{ const olv=olvidadasSet.has(String(b.id))
            return (<div key={b.id} style={{border:`1px solid ${emit(b)?C.border:(olv?C.overdueText:(C.soon||'#EBD9AE'))}`,borderRadius:11,overflow:'hidden'}}>
            <div style={{padding:'8px 10px',background:emit(b)?'#fff':(olv?'#FCEBEB':(C.soonBg||'#FFFBF0'))}}>
              <div style={{display:'flex',justifyContent:'space-between',gap:8}}><span style={{fontSize:12.5,fontWeight:600,color:C.text}}>{etiqueta(b)}</span><span style={{fontSize:12.5,color:C.muted,fontVariantNumeric:'tabular-nums'}}>{fmt(b.amount||0)}</span></div>
              <div style={{fontSize:10.5,color:olv?C.overdueText:C.muted,marginTop:2}}>Vence {dmy(emit(b)?b.due:effDue(b))}{olv?' · sin facturar':''}</div>
            </div>
            {emit(b)
              ? <div onClick={()=>onOpenFactura&&onOpenFactura(b)} style={{padding:'8px 10px 8px 18px',borderTop:`1px solid ${C.border}`}}><div style={{display:'flex',alignItems:'center',gap:7}}><span style={{fontSize:12,color:C.muted}}>↳</span><span style={{flex:1,fontSize:12,color:C.accent,fontWeight:700}}>Factura N° {folioN(b.invoice_no)||b.invoice_no}</span><span style={{fontSize:12,color:C.text,fontVariantNumeric:'tabular-nums'}}>{fmt(montoFactura(b)||b.amount||0)}</span></div><div style={{fontSize:10.5,color:C.muted,marginTop:2,paddingLeft:19,display:'flex',gap:6,flexWrap:'wrap'}}><span style={{color:estCol(b),fontWeight:600}}>{estTxt(b)}</span><span>Emitida {dmy(b.issued_at)}</span>{rutTxt(b)&&<span>· {rutTxt(b)}</span>}</div></div>
              : <div style={{padding:'8px 10px 8px 18px',display:'flex',alignItems:'center',gap:7,borderTop:`1px dashed ${C.soon||'#EBD9AE'}`}}><span style={{fontSize:12,color:C.soonText}}>↳</span><span style={{flex:1,fontSize:12,color:C.soonText}}>por emitir · hueco</span></div>}
          </div>) })}
        </div>
      )}
      </div>
      {planN>0 && cuotas.length<planN && <div style={{fontSize:10.5,color:C.muted,marginTop:6}}>El plan tiene {planN} cuotas; faltan {planN-cuotas.length} por generar.</div>}

      {orphans.length>0 && (()=>{ const fifo=huecoFIFO(saleBills)
        return (<div style={{marginTop:11,borderTop:`1px solid ${C.border}`,paddingTop:9}}>
          <div style={{fontSize:9.5,color:C.muted,letterSpacing:.4,fontWeight:700,marginBottom:6}}>MISMO RUT · SIN ASOCIAR · {orphans.length}</div>
          {orphans.map(o=>{ const sug = fifo || huecos.find(h=>Math.abs((h.amount||0)-(montoFactura(o)||o.amount||0))/Math.max(1,h.amount||1)<0.03)
            const dnd = huecos.length>0 ? arrF.props(o.id, `Factura N° ${folioN(o.invoice_no)||o.invoice_no}`) : null
            return (<div key={o.id} onPointerDown={dnd?.onPointerDown}
              style={{...(dnd?.style||{}),border:`1px solid ${C.border}`,borderRadius:10,padding:'8px 10px',marginBottom:6,background:'#fff',cursor:isDesktop&&huecos.length?'grab':'default'}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                {isDesktop&&huecos.length>0&&<span style={{color:C.muted,fontSize:14}}>⠿</span>}
                <div style={{flex:1,minWidth:0}}><div style={{fontSize:12.5,fontWeight:600,color:C.text}}>Factura N° {folioN(o.invoice_no)||o.invoice_no}<span style={{fontWeight:400,color:C.muted}}> · emitida {dmy(o.issued_at||o.due)}</span></div>{sug&&<div style={{fontSize:10.5,color:C.accent}}>llena el hueco más antiguo · {etiqueta(sug)}</div>}</div>
                <div style={{fontSize:12.5,color:C.text,fontVariantNumeric:'tabular-nums'}}>{fmt(montoFactura(o)||o.amount||0)}</div>
                {huecos.length>0&&!isDesktop&&<button onClick={()=>setPickFor(pickFor===o.id?null:o.id)} style={{fontSize:11.5,color:C.accent,border:`1px solid ${C.accent}`,borderRadius:16,padding:'3px 10px',background:'none',cursor:'pointer',whiteSpace:'nowrap'}}>Asociar</button>}
              </div>
              {pickFor===o.id && (
                <div style={{marginTop:8,display:'flex',flexDirection:'column',gap:5}}>
                  <div style={{fontSize:10.5,color:C.muted}}>Asociar a la cuota:</div>
                  {huecos.map(h=>(<button key={h.id} onClick={()=>doAssoc(h.id,o.id)} style={{textAlign:'left',border:`1px solid ${sug&&sug.id===h.id?C.accent:C.border}`,background:sug&&sug.id===h.id?(C.azulBg||'#EAF0F3'):'#fff',borderRadius:9,padding:'7px 10px',cursor:'pointer',display:'flex',justifyContent:'space-between',gap:8}}><span style={{fontSize:12.5,color:C.text}}>{etiqueta(h)}{sug&&sug.id===h.id?' · más antigua':''}</span><span style={{fontSize:12.5,color:C.muted,fontVariantNumeric:'tabular-nums'}}>{fmt(h.amount||0)}</span></button>))}
                </div>
              )}
            </div>) })}
          <div style={{fontSize:10,color:C.muted,marginTop:2}}>Facturas de este RUT sin venta. Asociar enlaza la factura a la cuota más antigua (reversible) sin tocar la conciliación.</div>
        </div>) })()}
    </div>
  )
}

export function FinancieroTab({client, clientBilling, entities, sales=[], anticipos=[], billing=[], respaldoMap, cartolaHasta=null, onNuevoAnticipo, onSaveFields, onEditBilling, onAddBilling, onAddSale, onConciliar, onOpenConciliacion, onAssignSeries, onStatusChange, onReplaceProgramada, onOpenSale}) {
  const isDesktop = useIsDesktop()   // desktop: ancho acotado y centrado (no estirado a toda la pantalla)
  const causasCli = useCausas({clientId:client.id})   // causas en Cortes de cada venta (agente causas-tablas)
  const propsCli = usePropiedades({clientId:client.id})   // roles de avalúo de cada venta (tabla propiedades)
  // Cockpit de facturas: TODAS las del cliente — buscador + tabs por año + agrupación Proyecto → Razón social → Factura con orden por fecha.
  // Tocar una factura abre el editor BillingForm (editar/marcar pagada/anular/eliminar) → cambios se propagan a toda la app.
  const all = (clientBilling||[]).filter(b=>!b.deleted_at)
  const real = all.filter(b=>b.billing_type!=='reembolso')
  const facturado = real.filter(esFacturada).reduce((a,b)=>a+montoFactura(b),0)   // montoFactura = autoridad del DTE (no el amount programado)
  const cobrado = real.reduce((a,b)=>a+cobradoBill(b),0)   // incluye abonos parciales (fuente única cobradoBill)
  const porCobrar = porCobrarBills(real)
  const programado = real.filter(b=>!b.invoice_no&&!['Pagado','Anulada','Anticipada'].includes(b.status)).reduce((a,b)=>a+(b.amount||0),0)
  const overdueTot = real.filter(b=>b.invoice_no&&b.status==='Vencido').reduce((a,b)=>a+saldoBill(b),0)

  const clientSales = (sales||[]).filter(s=>String(s.client_id)===String(client.id))
  const saleTitle = id => clientSales.find(s=>String(s.id)===String(id))?.title || null
  // Cotejo cuota↔factura anidado dentro de cada proyecto (huérfanas del mismo RUT + asociar FIFO reversible).
  const [cjOpen,setCjOpen] = useState(()=>new Set())
  const toggleCj = id => setCjOpen(p=>{ const n=new Set(p); n.has(String(id))?n.delete(String(id)):n.add(String(id)); return n })
  const cotejoSinVenta = all.filter(b=> b.invoice_no && b.status!=='Anulada' && !['reembolso','comision','externo','subarriendo'].includes(b.billing_type) && !b.sale_id)
  const cotejoOrphansFor = s => cotejoSinVenta.filter(b=> !s.entity_id || !b.entity_id || String(b.entity_id)===String(s.entity_id))
  const cotejoAsociar = async (progId, orphanId) => {
    const o=(billing||[]).find(b=>String(b.id)===String(orphanId)); const h=(billing||[]).find(b=>String(b.id)===String(progId)); if(!o||!h) return
    if(!await appConfirm(`¿Asociar la factura N° ${folioN(o.invoice_no)||o.invoice_no} (${fmt(montoFactura(o)||o.amount||0)}) a la cuota "${(cuotaNMof(h.concept)?`Cuota ${cuotaNMof(h.concept).n}/${cuotaNMof(h.concept).tot}`:'programada')}"? La cuota queda cubierta y la factura se enlaza a la venta. Reversible.`)) return
    await onReplaceProgramada(h.id, o.id)
  }
  const kpiDate = b => b.status==='Programada'?(b.due||b.issued_at):(b.status==='Pagado'?(b.paid_at||b.issued_at):(b.issued_at||b.due))
  const anioDe = b => (kpiDate(b)||'').slice(0,4)
  const aniosList = [...new Set(all.map(anioDe).filter(Boolean))].sort((a,b)=>b.localeCompare(a))
  const projCounts = {}; all.forEach(b=>{ const k=b.sale_id?String(b.sale_id):'sin'; projCounts[k]=(projCounts[k]||0)+1 })

  const [q,setQ] = useState('')
  // Jerarquía Año → Proyecto → Factura (cockpit v2). Año sincronizado con Facturación (localStorage 'fac_year').
  const pickYear = () => { try{ const g=localStorage.getItem('fac_year'); if(g && aniosList.includes(g)) return g }catch(e){} return aniosList[0]||'' }
  const [selYear,setSelYear] = useState(pickYear)
  const setYearSync = y => { setSelYear(y); try{ localStorage.setItem('fac_year', y||'') }catch(e){} }
  const [openProj,setOpenProj] = useState(()=>new Set())
  const [subRSOpen,setSubRSOpen] = useState({})   // colapso por RS dentro de un proyecto (key: saleId|rsKey); default abierto si tiene deuda
  const [facDir,setFacDir] = useState('desc')   // orden por fecha de las facturas: 'desc' (nueva→antigua) | 'asc'
  const [detFac,setDetFac] = useState(()=>new Set())   // facturas con detalle/movimiento bancario expandido
  const [ficRs,setFicRs] = useState('all')   // filtro por razón social en la ficha (rsKey | 'all')
  const [ficEst,setFicEst] = useState({})   // colapso de los acordeones por estado en la ficha
  const [vSec,setVSec] = useState({})   // colapso de las secciones-icono de Ventas (Proyectos/Facturas), colapsadas por defecto
  const [svOpen,setSvOpen] = useState(null)   // factura sin venta con la asignación desplegada
  const sinVentaF = all.filter(b=>catSinClienteVenta(b)==='vta')   // misma regla que Facturación › Por clasificar
  const vtog = k => setVSec(s=>({...s,[k]:!s[k]}))
  const [facEje,setFacEje] = useState('estado')   // eje de la sección Facturas: 'estado' | 'anio' | 'proyecto'
  const [fConc,setFConc] = useState([]); const [fMovs,setFMovs] = useState([])   // conciliación del cliente para ver el movimiento de una factura conciliada
  useEffect(()=>{ if(!client?.id) return; let ok=true; Promise.all([selectAll(()=>supabase.from('conciliacion').select('factura_id,movimiento_id,tipo_destino,monto_aplicado').order('id')), selectAll(()=>supabase.from('cartola_movimientos').select('id,fecha,monto,n_operacion,descripcion').eq('cliente_id',client.id).order('id'))]).then(([a,b])=>{ if(ok){ setFConc(a.data||[]); setFMovs(b.data||[]) } }).catch(()=>{}); return ()=>{ ok=false } },[client?.id])
  const fConcByFac = useMemo(()=>{ const m={}; fConc.forEach(c=>{ if(c.factura_id&&c.tipo_destino==='factura') (m[c.factura_id]=m[c.factura_id]||[]).push(c) }); return m },[fConc])
  const fMovById = useMemo(()=>{ const m={}; fMovs.forEach(x=>m[x.id]=x); return m },[fMovs])
  const toggleDet = id => setDetFac(p=>{ const n=new Set(p); n.has(id)?n.delete(id):n.add(id); return n })
  useEffect(()=>{ setSelYear(pickYear()) },[client.id])
  const toggleProj = id => setOpenProj(p=>{ const n=new Set(p); n.has(id)?n.delete(id):n.add(id); return n })
  // Al abrir un año, expandir solo los proyectos con algo vencido (lo accionable visible sin clics).
  useEffect(()=>{ const ov=new Set(); (clientBilling||[]).forEach(b=>{ if(!b.deleted_at && b.sale_id && b.status==='Vencido' && (kpiDate(b)||'').slice(0,4)===selYear) ov.add(String(b.sale_id)) }); setOpenProj(ov) },[selYear,client.id])
  const sugSaleFor = (b,list) => { // ✦ venta probable por coincidencia de glosa base con el título (dentro de las ventas del año)
    if(!b?.concept) return null; const k=serieKey(b.concept); if(!k) return null
    const w=new Set(k.split(' ').filter(x=>x.length>3)); let best=null,sc=0
    ;(list||clientSales).forEach(s=>{ const n=serieKey(s.title).split(' ').filter(x=>x.length>3).filter(x=>w.has(x)).length; if(n>sc){sc=n;best=s} })
    return sc>0?best:null
  }
  const recordarCobro = b => recordarCobroFactura(b, client)
  const borde = b => estadoCobro(b).color

  const fields = ['abogado_responsable','notas_internas']
  const fromClient = () => fields.reduce((o,k)=>{o[k]=client[k]||'';return o},{})
  const [form,setForm] = useState(fromClient())
  const [savingF,setSavingF] = useState(false)
  useEffect(()=>{ setForm(fromClient()) },[client.id])
  const dirty = fields.some(k=>(form[k]||'')!==(client[k]||''))
  const set = (k,v)=>setForm(f=>({...f,[k]:v}))
  const guardar = async ()=>{ setSavingF(true); try{ await onSaveFields(client.id, form) }catch(e){} setSavingF(false) }

  const inp = {width:'100%',padding:'8px 10px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',fontSize:13,boxSizing:'border-box',outline:'none',color:C.text}
  const lbl = {fontSize:10,color:C.muted,fontWeight:600,textTransform:'uppercase',letterSpacing:.4,marginBottom:4,display:'block'}
  const card = {marginBottom:16,padding:'14px 16px',borderRadius:12,background:C.card,border:`1px solid ${C.border}`}
  const sTitle = (t)=>(<div style={{...SEC_LBL,marginBottom:10}}>{t}</div>)
  const VHdr = ({icon,iconCol,title,purpose,summary,sumCol,k}) => (<div onClick={()=>vtog(k)} style={{display:'flex',alignItems:'center',gap:11,padding:'12px 13px',cursor:'pointer',background:vSec[k]?'#F7F9FA':'#fff'}}>
    <SIcon n={icon} s={18} c={iconCol||C.muted}/>
    <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:vSec[k]?700:600,color:vSec[k]?C.accent:C.text}}>{title}</div>{purpose&&<div style={{fontSize:10,color:C.muted,fontWeight:500,marginTop:1}}>{purpose}</div>}</div>
    {summary!=null&&<span style={{fontSize:11,color:sumCol||C.muted,fontWeight:sumCol&&sumCol!==C.muted?700:400,whiteSpace:'nowrap'}}>{summary}</span>}
    <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke={C.done} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' style={{flexShrink:0,transform:vSec[k]?'rotate(180deg)':'none',transition:'transform .12s'}}><path d='M6 9l6 6 6-6'/></svg>
  </div>)
  const field = (label,k,placeholder)=>(
    <div><label style={lbl}>{label}</label><input value={form[k]} onChange={e=>set(k,e.target.value)} placeholder={placeholder||''} style={inp}/></div>
  )

  return (
    <div style={{padding:'16px 20px 60px',maxWidth:isDesktop?900:undefined,margin:isDesktop?'0 auto':undefined}}>
      {/* La foto (Vendido/Facturado/Cobrado/Por cobrar) vive en el embudo del Resumen — no se repite acá. Ventas = proyectos + facturas + anticipos. */}


      {/* Proyectos (icono-sección colapsada): Vigentes + Terminados, con barra de cobro (facturado→cobrado) */}
      {(()=>{
        const activas = clientSales.filter(s=>s.status==='Activo')
        const terminadas = clientSales.filter(s=>s.status==='Terminado')
        if(!activas.length && !terminadas.length) return null
        const projCard = s => {
          const sb=clientBilling.filter(b=>!b.deleted_at&&b.sale_id===s.id)
          const fac=sb.filter(esFacturada).reduce((a,b)=>a+montoFactura(b),0)
          const cob=sb.reduce((a,b)=>a+cobradoBill(b),0)   // incluye parciales; fuente única
          const pen=porCobrarBills(sb)
          const uf=(s.amount_uf||0)*(s.cobro_type==='mensual'?12:1)
          const ai={Corporativo:'building',Tributario:'file',Laboral:'users'}[s.area]||'briefcase'
          const pct=fac>0?Math.min(100,Math.round(cob/fac*100)):0
          const hasBills=sb.length>0; const open=cjOpen.has(String(s.id)); const olvN=cuotasOlvidadas(sb).length
          return (<div key={s.id} style={{background:'#fff',border:`0.5px solid ${olvN?C.overdueText:C.border}`,borderRadius:12,marginBottom:7,overflow:'hidden'}}>
            <div onClick={()=>toggleCj(s.id)} style={{padding:'10px 12px',cursor:'pointer'}}>
              <div style={{display:'flex',alignItems:'center',gap:9}}>
                <SIcon n={ai} s={19} c={C.muted}/>
                <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:700,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.title}</div><div style={{fontSize:10,color:olvN?C.overdueText:C.muted}}>{uf>0?fmtUF(uf):''}{s.year?` · ${s.year}`:''}{olvN?` · ${olvN} sin facturar`:''}{(()=>{ const n=(causasCli.rows||[]).filter(c=>String(c.sale_id||'')===String(s.id)).length; return n?` · ${n} causa${n!==1?'s':''}`:'' })()}</div></div>
                <div style={{textAlign:'right',flexShrink:0}}><div style={{fontSize:8,fontWeight:700,color:C.textSoft,textTransform:'uppercase',letterSpacing:.3,whiteSpace:'nowrap'}}>Por cobrar</div><div style={{fontSize:15,fontWeight:800,color:pen>0?C.accent:C.greenText,lineHeight:1,marginTop:1}}>{pen>0?fmtShort(pen):'$0'}</div></div>
                <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke={C.done} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' style={{flexShrink:0,transform:open?'rotate(180deg)':'none',transition:'transform .12s'}}><path d='M6 9l6 6 6-6'/></svg>
              </div>
              {fac>0&&<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,marginTop:8}}><span style={{fontSize:10,color:C.muted}}>Facturado <b style={{color:C.text}}>{fmtShort(fac)}</b> · Cobrado <b style={{color:C.text}}>{fmtShort(cob)}</b></span><span style={{fontSize:9.5,fontWeight:700,borderRadius:20,padding:'2px 8px',background:pct>=80?C.greenBg:C.soonBg,color:pct>=80?C.greenText:C.soonText,whiteSpace:'nowrap'}}>{pct}% cobrado</span></div>}
            </div>
            {open&&<div style={{padding:'0 11px 11px'}}>
              {hasBills&&<CotejoVenta sale={s} saleBills={sb} orphans={onReplaceProgramada?cotejoOrphansFor(s):[]} isDesktop={isDesktop} client={client} entities={entities} nested onOpenFactura={onEditBilling} onAssociate={onReplaceProgramada?cotejoAsociar:undefined}/>}
              <CausasVenta client={client} sale={s} isDesktop={isDesktop} causas={causasCli}/>
              <PropiedadesVenta client={client} sale={s} isDesktop={isDesktop} props={propsCli}/>
              {onOpenSale&&<div style={{textAlign:'right',marginTop:2}}><span onClick={(e)=>{e.stopPropagation();onOpenSale(s)}} style={{fontSize:11,color:C.accent,fontWeight:600,cursor:'pointer'}}>Abrir venta <Gl n='chevron'/></span></div>}
            </div>}
          </div>)
        }
        return (<div style={{background:'#fff',border:`0.5px solid ${C.border}`,borderRadius:12,overflow:'hidden',marginBottom:10}}>
          {VHdr({icon:'briefcase',title:'Proyectos',purpose:'cuánto falta cobrar',k:'proyectos',summary:`${activas.length} vigente${activas.length!==1?'s':''} · ${terminadas.length} terminado${terminadas.length!==1?'s':''}`})}
          {/* Facturas del cliente sin venta: aviso siempre visible (aunque Proyectos esté colapsado) con la misma asignación de Por clasificar. */}
          {sinVentaF.map(b=>{ const op=svOpen===b.id; return <div key={b.id} style={{padding:'0 13px 10px'}}>
            <div onClick={()=>setSvOpen(op?null:b.id)} style={{display:'flex',alignItems:'center',gap:8,background:C.azulBg,borderRadius:10,padding:'9px 11px',cursor:'pointer',minWidth:0}}>
              <span style={{fontSize:12.5,fontWeight:700,color:C.accent,whiteSpace:'nowrap'}}>Factura N° {folioN(b.invoice_no)||b.invoice_no} sin venta</span>
              {isDesktop&&<span style={{fontSize:11.5,color:C.textSoft,whiteSpace:'nowrap'}}>· {fmtFechaDMY(b.issued_at)}</span>}
              <span style={{marginLeft:'auto',fontSize:12.5,fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fmt(montoFactura(b))}</span>
              <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke={C.done} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' style={{flexShrink:0,transform:op?'rotate(180deg)':'none'}}><path d='M6 9l6 6 6-6'/></svg>
            </div>
            {op&&<AsignarVentaFactura factura={b} sales={sales} billing={billing} onHecho={()=>setSvOpen(null)}/>}
          </div> })}
          {vSec.proyectos&&<div style={{padding:'6px 13px 12px'}}>
            {onAddSale&&<button onClick={onAddSale} style={{padding:'4px 10px',borderRadius:6,border:`1px solid ${C.accent}`,background:'transparent',color:C.accent,fontSize:11,fontWeight:600,cursor:'pointer',marginBottom:9}}>+ Venta</button>}
            {activas.length===0&&terminadas.length===0&&<div style={{fontSize:12,color:C.muted,padding:'4px 2px 6px'}}>Sin ventas registradas.</div>}
            {activas.length>0&&<><div style={{...SEC_LBL,margin:'2px 2px 7px'}}>Vigentes · {activas.length}</div>
            {activas.map(projCard)}</>}
            {terminadas.length>0&&<><div style={{...SEC_LBL,margin:'10px 2px 7px'}}>Terminados · {terminadas.length}</div>
            {terminadas.map(projCard)}</>}
          </div>}
        </div>)
      })()}

      {/* Facturas (icono-sección colapsada): el cockpit Año → Proyecto → Factura va dentro */}
      <div style={{background:'#fff',border:`0.5px solid ${C.border}`,borderRadius:12,overflow:'hidden',marginBottom:10}}>
        {VHdr({icon:'file',title:'Facturas',k:'facturas',summary:porCobrar>0?`${fmt(porCobrar)} por cobrar`:(real.filter(esFacturada).length?`${real.filter(esFacturada).length} emitidas`:'sin facturas'),sumCol:porCobrar>0?C.accent:undefined})}
        {vSec.facturas&&<div style={{padding:'10px 13px 13px'}}>
        <div style={{display:'flex',justifyContent:'flex-end',alignItems:'center',marginBottom:9}}>
          <div style={{display:'flex',gap:10,alignItems:'center'}}>
            {onConciliar&&<span onClick={()=>onConciliar()} style={{fontSize:11,color:C.greenText,fontWeight:600,cursor:'pointer'}}>Conciliar</span>}
            <span onClick={()=>onAddBilling&&onAddBilling()} style={{fontSize:11,color:C.accent,fontWeight:600,cursor:'pointer'}}>+ Nueva factura</span>
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:6,background:C.bgSoft,border:`1px solid ${C.border}`,borderRadius:8,padding:'7px 10px',marginBottom:9}}>
          <svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='#99ABB4' strokeWidth='2.4'><circle cx='11' cy='11' r='7'/><line x1='21' y1='21' x2='16.5' y2='16.5'/></svg>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder='Buscar Factura N°, concepto, monto…' style={{flex:1,border:'none',background:'transparent',fontSize:13,color:C.text,outline:'none'}}/>
          {q&&<span onClick={()=>setQ('')} style={{fontSize:14,color:C.muted,cursor:'pointer',lineHeight:1}}><Gl n='x'/></span>}
        </div>
        {aniosList.length>0&&<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,marginBottom:11}}>
          <div style={{display:'flex',gap:6,overflowX:'auto',scrollbarWidth:'none'}}>
            {aniosList.map(y=>(<span key={y} onClick={()=>setYearSync(y)} style={{flexShrink:0,fontSize:12,fontWeight:600,borderRadius:8,padding:'5px 13px',cursor:'pointer',background:selYear===y?C.accent:'#fff',color:selYear===y?'#fff':C.muted,border:`1px solid ${selYear===y?C.accent:C.border}`}}>{y}</span>))}
          </div>
          <div style={{display:'flex',gap:7,alignItems:'center',flexShrink:0,fontSize:10}}>
            <span style={{color:C.textSoft}}>Fecha</span>
            {[['desc','↓ Nueva'],['asc','↑ Antigua']].map(([v,l])=><span key={v} onClick={()=>setFacDir(v)} style={{fontWeight:facDir===v?700:600,color:facDir===v?C.accent:C.muted,cursor:'pointer'}}>{l}</span>)}
          </div>
        </div>}
        {(()=>{
          if(!aniosList.length) return <div style={{fontSize:12,color:C.muted,padding:'8px 2px'}}>Este cliente no tiene facturas todavía.</div>
          const matchQ = b => { if(!q.trim()) return true; const s=q.toLowerCase().trim(); return `${b.concept||''} ${folioN(b.invoice_no)} ${b.amount||''} ${fmtFechaDMY(kpiDate(b))} ${saleTitle(b.sale_id)||''}`.toLowerCase().includes(s) }
          const yf = all.filter(b=>anioDe(b)===selYear && matchQ(b) && b.billing_type!=='nota_credito')   // las notas de crédito no van sueltas: se muestran anidadas bajo la factura que anulan
          // histYear: las emitidas históricas (≤2025) no exigen proyecto asignado (lo usa needsProj más abajo).
          const histYear = (parseInt(selYear)||9999) <= 2025
          const lblFolio = b => b.invoice_no?`Factura N° ${folioN(b.invoice_no)}`:(b.concept||'—')
          const rutOf=b=>{ if(b.entity_id){ const e=entities.find(x=>String(x.id)===String(b.entity_id)); if(e&&e.rut) return String(e.rut).trim() } return String(b.receptor_rut||'').trim() }
          const rsKeyOf=b=>{ const r=rutOf(b); return r?('rut:'+r):(b.receptor_name?('n:'+String(b.receptor_name).trim().toLowerCase()):'sin') }
          const rsNameOf=b=>{ const r=rutOf(b); const e=entities.find(x=>String(x.id)===String(b.entity_id))||entities.find(x=>x.rut&&String(x.rut).trim()===r); if(e) return e.name+(e.rut?(' · '+e.rut):''); return b.receptor_name?(b.receptor_name+(r?(' · '+r):'')):'Sin razón social' }
          const rsShort=b=>{ const r=rutOf(b); const e=entities.find(x=>String(x.id)===String(b.entity_id))||entities.find(x=>x.rut&&String(x.rut).trim()===r); if(e?.name) return rsDisplay(e.name); return b.receptor_name?rsDisplay(b.receptor_name):null }
          // Descargar copia PDF (con timbre) de una factura emitida — se regenera del DTE guardado, no depende de Drive. Siempre disponible.
          const verFacturaPdf = async(b)=>{ try{ const doc=splitSetDTE(b.dte_xml)[0]||b.dte_xml; const r=await facturaDtePdfBase64(doc); const bin=atob(r.base64); const u8=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i); descargarPdfU8(u8, facturaNombreArchivo(r)) }catch(e){ appAlert('No se pudo generar el PDF: '+(e.message||e)) } }
          const renderFactura = (b,assignable)=>{
            const proj=b.sale_id?saleTitle(b.sale_id):null; const rsNm=rsShort(b)
            // Asignable a CUALQUIER proyecto del cliente (un proyecto puede cruzar años y razones sociales).
            const ventasAsig = clientSales
            const sug = assignable?sugSaleFor(b,ventasAsig):null
            const conciliada = b.status==='Pagado' && (fConcByFac[b.id]||[]).length>0
            const detOpen = detFac.has(b.id)
            const e = estadoFacturaLabel(b,(respaldoMap&&respaldoMap[b.id])||0,cartolaHasta)
            const pend = ['Pendiente','Vencido'].includes(b.status)
            return (
              <div key={b.id} style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,padding:'8px 10px',marginBottom:5}}>
                <div onClick={()=> conciliada ? toggleDet(b.id) : (onEditBilling&&onEditBilling(b))} style={{display:'flex',alignItems:'center',gap:9,cursor:'pointer'}}>
                  {bigDate(kpiDate(b))}
                  <SIcon n={estadoCobro(b).icon} s={15} c={borde(b)}/>
                  <div style={{minWidth:0,flex:1}}>
                    <div style={{fontSize:12,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{lblFolio(b)}{['reembolso','comision','externo'].includes(b.billing_type)&&<span style={{fontSize:9,color:C.muted,marginLeft:5}}>{tipoFacturaLbl(b)}</span>}</div>
                    {b.invoice_no&&<div style={{fontSize:10,color:C.muted,marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.concept||'—'}</div>}
                    {(proj||rsNm)&&<div style={{fontSize:9,color:C.muted,marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{proj||''}{proj&&rsNm?' · ':''}{rsNm&&<b style={{fontWeight:600}}>{rsNm}</b>}</div>}
                  </div>
                  <div style={{textAlign:'right',flexShrink:0}}>
                    {(()=>{ const sal=saldoBill(b); const parcial=(b.paid_amount||0)>0&&!['Pagado','Anulada'].includes(b.status); return parcial
                      ? <><div style={{fontSize:9,color:C.textSoft}}>Saldo</div><div style={{fontSize:14,fontWeight:700,color:C.overdueText,lineHeight:1.05}}>{fmt(sal)}</div><div style={{fontSize:9,color:C.textSoft,marginTop:1}}>Abonado {fmt(b.paid_amount)} de {fmt(b.amount)}</div></>
                      : <div style={{fontSize:13,fontWeight:600,color:esVencidaB(b)?C.overdueText:(pend?C.accent:C.text)}}>{fmt(b.amount)}</div> })()}
                    {pend&&<ActBtn variant='softNavy' onClick={(ev)=>{ev.stopPropagation();recordarCobro(b)}} style={{marginTop:5}}>Recordar</ActBtn>}
                    {b.invoice_no&&b.dte_xml&&<button onClick={(ev)=>{ev.stopPropagation();verFacturaPdf(b)}} title='Descargar copia PDF (con timbre)' style={{marginTop:5,display:'block',marginLeft:'auto',fontSize:10,fontWeight:700,color:C.tealText,background:'#fff',border:`0.5px solid ${C.tealText}`,borderRadius:7,padding:'3px 10px',cursor:'pointer'}}>PDF ↓</button>}
                  </div>
                </div>
                {(b.anulada_por||'').startsWith('Nota de crédito')&&<div style={{marginTop:6,marginLeft:49,fontSize:10,lineHeight:1.4,display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',background:'#FFFBF4',border:'1px solid #EAD9B8',borderRadius:8,padding:'6px 9px'}}>
                  <span style={{fontSize:9,fontWeight:800,color:C.soonText,background:C.soonBg,borderRadius:4,padding:'2px 6px',textTransform:'uppercase',letterSpacing:.3,flexShrink:0}}>NC</span>
                  <span style={{color:C.text,minWidth:0}}>{b.anulada_por} anula esta factura{b.reemplazada_por_billing_id&&(()=>{ const rp=(billing||[]).find(x=>x.id===b.reemplazada_por_billing_id); return rp?<> · reemplazada por <b style={{color:C.accent,fontWeight:700}}>Factura N° {folioN(rp.invoice_no)}</b>{String(rp.client_id)!==String(client.id)&&(rsShort(rp)||rp.receptor_name)?` · ${rsShort(rp)||rp.receptor_name}`:''}</>:null })()}</span>
                  <span style={{marginLeft:'auto',fontWeight:800,color:C.overdueText,flexShrink:0,fontVariantNumeric:'tabular-nums'}}>− {fmt(b.amount)}</span>
                  <span style={{fontSize:10,color:C.greenText,fontWeight:700,flexShrink:0}}>saldo $0</span>
                </div>}
                {(()=>{ const orig=(billing||[]).find(x=>x.reemplazada_por_billing_id===b.id); return orig?<div style={{marginTop:6,marginLeft:49,fontSize:10,color:C.muted,lineHeight:1.4}}>Reemplaza a <b style={{color:C.accent,fontWeight:600}}>Factura N° {folioN(orig.invoice_no)}</b>{String(orig.client_id)!==String(client.id)&&(rsShort(orig)||orig.receptor_name)?` · ${rsShort(orig)||orig.receptor_name}`:''}</div>:null })()}
                {e&&<div style={{marginTop:6,marginLeft:49}}><EstadoFacturaChip b={b} respaldoMap={respaldoMap} cartolaHasta={cartolaHasta} chevron={conciliada}/></div>}
                {conciliada&&detOpen&&(()=>{ const cs=fConcByFac[b.id]||[]; const mv=fMovById[cs[0]?.movimiento_id]; return (
                  <div style={{marginTop:8,marginLeft:49,background:'#F0F7F4',border:`1px solid #CFE9DD`,borderRadius:8,padding:'8px 10px'}}>
                    <div style={{fontSize:9,fontWeight:700,color:C.greenText,textTransform:'uppercase',letterSpacing:.4,marginBottom:4}}>Movimiento bancario</div>
                    {mv ? <>
                      <div style={{display:'flex',justifyContent:'space-between',fontSize:11,padding:'1px 0'}}><span style={{color:C.muted}}>Fecha</span><span style={{color:C.text,fontWeight:600}}>{fmtFechaDMY(mv.fecha)}</span></div>
                      <div style={{display:'flex',justifyContent:'space-between',fontSize:11,padding:'1px 0'}}><span style={{color:C.muted}}>Monto</span><span style={{color:C.text,fontWeight:600}}>{fmt(mv.monto)}</span></div>
                      {mv.n_operacion&&<div style={{display:'flex',justifyContent:'space-between',fontSize:11,padding:'1px 0'}}><span style={{color:C.muted}}>N° operación</span><span style={{color:C.text,fontWeight:600}}>{mv.n_operacion}</span></div>}
                      {mv.descripcion&&<div style={{fontSize:11,color:C.muted,marginTop:2,lineHeight:1.4}}>{String(mv.descripcion).slice(0,90)}</div>}
                    </> : <div style={{fontSize:11,color:C.muted}}>Conciliada (movimiento en otra cuenta o sin detalle local).</div>}
                    <div style={{display:'flex',justifyContent:'flex-end',gap:12,marginTop:6}}>
                      {onEditBilling&&<span onClick={()=>onEditBilling(b)} style={{fontSize:10,fontWeight:600,color:C.muted,cursor:'pointer'}}>Editar</span>}
                      {(onOpenConciliacion&&cs[0]?.movimiento_id)
                        ? <span onClick={()=>onOpenConciliacion(cs[0].movimiento_id)} style={{fontSize:10,fontWeight:700,color:C.azulInfo,cursor:'pointer'}}>Ver este movimiento →</span>
                        : (onConciliar&&<span onClick={()=>onConciliar()} style={{fontSize:10,fontWeight:700,color:C.azulInfo,cursor:'pointer'}}>Ver en conciliación →</span>)}
                    </div>
                  </div>
                )})()}
                {assignable&&<div style={{display:'flex',gap:6,alignItems:'center',marginTop:7,flexWrap:'wrap',marginLeft:49}}>
                  {sug&&<button onClick={()=>onAssignSeries&&onAssignSeries(sug.id,[b.id])} style={{fontSize:10,background:C.greenBg,color:C.greenText,border:'none',borderRadius:8,padding:'3px 10px',fontWeight:600,cursor:'pointer'}}><Sparkle/> {sug.title}</button>}
                  {ventasAsig.length>0
                    ? <select defaultValue='' onChange={e=>{ if(e.target.value&&onAssignSeries) onAssignSeries(e.target.value,[b.id]) }} style={{fontSize:10,padding:'3px 8px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.muted}}>
                        <option value=''>+ Asignar a proyecto…</option>
                        {ventasAsig.map(s=><option key={s.id} value={s.id}>{s.title}{s.year?` · ${s.year}`:''}</option>)}
                      </select>
                    : <span style={{fontSize:10,color:C.muted}}>Este cliente no tiene proyectos</span>}
                </div>}
              </div>
            )
          }
          const nada = !yf.length
          return (<>
            {nada&&<div style={{fontSize:12,color:C.muted,padding:'8px 2px'}}>Sin facturas en {selYear}{q?' con esa búsqueda':''}.</div>}
            {!nada&&(()=>{
              // Ficha al mismo patrón que Facturación: filtro por razón social + acordeones por estado (Por cobrar [aging] / Por facturar / Cobradas / Anuladas). Proyecto y RS en cada factura; máximo detalle al tocar.
              const rsMap={}; yf.forEach(b=>{ const k=rsKeyOf(b); if(!rsMap[k]) rsMap[k]={k,name:rsShort(b)||rsNameOf(b)} })
              const rsArr=Object.values(rsMap)
              const facturas = ficRs==='all'?yf:yf.filter(b=>rsKeyOf(b)===ficRs)
              const byDir=arr=>[...arr].sort((a,b)=> facDir==='asc'?(kpiDate(a)||'').localeCompare(kpiDate(b)||''):(kpiDate(b)||'').localeCompare(kpiDate(a)||''))
              const agingAsc=arr=>[...arr].sort((a,b)=>(a.due||a.issued_at||'').localeCompare(b.due||b.issued_at||''))
              const needsProj=b=>!b.sale_id && !(histYear&&b.invoice_no&&b.issued_at&&b.issued_at<='2025-12-31')
              const ESTADOS=[
                ['Por cobrar', b=>b.invoice_no&&['Pendiente','Vencido'].includes(b.status), ESTADO_COBRO.porCobrar, saldoBill, agingAsc, true],
                ['Por facturar', b=>!b.invoice_no&&!['Pagado','Anulada','Anticipada'].includes(b.status), ESTADO_COBRO.porFacturar, b=>b.amount||0, agingAsc, false],
                ['Pagadas', b=>['Pagado','Anticipada'].includes(b.status), ESTADO_COBRO.cobrado, b=>b.amount||0, byDir, false],
                ['Anuladas', b=>b.status==='Anulada', ESTADO_COBRO.anulada, b=>b.amount||0, byDir, false],
              ]
              return (<>
                {rsArr.length>=2&&<div style={{display:'flex',gap:5,flexWrap:'wrap',marginBottom:10}}>
                  {[{k:'all',name:'Todas las RS'},...rsArr].map(r=>{ const on=ficRs===r.k; return <span key={r.k} onClick={()=>setFicRs(r.k)} style={{fontSize:9,fontWeight:600,borderRadius:20,padding:'3px 9px',cursor:'pointer',border:`1px solid ${on?C.accent:C.border}`,background:on?C.azulBg:'#fff',color:on?C.accent:C.muted,whiteSpace:'nowrap'}}>{r.name}</span> })}
                </div>}
                {ESTADOS.map(([lbl,pred,tok,money,ord,defOpen])=>{
                  const gr=facturas.filter(pred); if(!gr.length) return null
                  const isOpen=ficEst[lbl]!==undefined?ficEst[lbl]:defOpen
                  const subT=gr.reduce((a,b)=>a+money(b),0)
                  return (<div key={lbl} style={{marginBottom:7}}>
                    <div onClick={()=>setFicEst(p=>({...p,[lbl]:!isOpen}))} style={{display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer',marginBottom:4}}>
                      <span style={{display:'flex',alignItems:'center',gap:6,minWidth:0}}><SIcon n={tok.icon||'file'} s={15} c={tok.text}/><span style={{fontSize:10,fontWeight:700,background:tok.bg,color:tok.text,borderRadius:14,padding:'2px 10px',textTransform:'uppercase',letterSpacing:.4}}>{lbl} · {gr.length} {isOpen?<Gl n='chevD'/>:<Gl n='chevron'/>}</span></span>
                      <span style={{fontSize:12,fontWeight:700,color:tok.text}}>{fmt(subT)}</span>
                    </div>
                    {isOpen&&ord(gr).map(b=>renderFactura(b,needsProj(b)))}
                  </div>)
                })}
              </>)
            })()}
          </>)
        })()}
        </div>}
      </div>

      {/* Anticipos (icono-sección colapsada, igual que Proyectos/Facturas): el monto disponible es el protagonista en el header */}
      {(()=>{
        const antDisp = anticipos.filter(a=>a.estado==='disponible')
        const totalDisp = antDisp.reduce((s,a)=>s+(a.monto||0),0)
        const antSorted = [...anticipos].sort((a,b)=>((a.estado==='disponible'?0:1)-(b.estado==='disponible'?0:1))||(b.fecha||'').localeCompare(a.fecha||''))
        const fmtF = iso => { try{ const d=new Date(iso+'T12:00'); return String(d.getDate()).padStart(2,'0')+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+d.getFullYear() }catch(e){return iso||'—'} }
        const summary = totalDisp>0 ? fmt(totalDisp) : (anticipos.length ? 'sin disponibles' : 'sin anticipos')
        return (
          <div style={{background:'#fff',border:`0.5px solid ${C.border}`,borderRadius:12,overflow:'hidden',marginBottom:10}}>
            {VHdr({icon:'wallet',title:'Anticipos',k:'anticipos',summary,sumCol:totalDisp>0?C.normal:undefined})}
            {vSec.anticipos&&<div style={{padding:'8px 13px 12px'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:antSorted.length?6:0}}>
                {antDisp.length>0
                  ? <span style={{fontSize:11,fontWeight:600,color:C.soonText,background:C.soonBg,padding:'2px 9px',borderRadius:20}}>{antDisp.length} por facturar</span>
                  : <span/>}
                <button onClick={()=>onNuevoAnticipo&&onNuevoAnticipo()} style={{height:24,padding:'0 12px',borderRadius:8,background:'#fff',color:C.accent,border:`0.5px solid ${C.border}`,fontSize:11,fontWeight:600,cursor:'pointer'}}>+ Registrar</button>
              </div>
              {antSorted.length===0
                ? <div style={{fontSize:12,color:C.textSoft,padding:'4px 0 2px'}}>Sin anticipos aún.</div>
                : antSorted.map((a,i)=>{ const disp=a.estado==='disponible'; const bill=billing.find(b=>String(b.id)===String(a.billing_id)); const folio=bill?.invoice_no; const clickable=!disp&&bill&&onEditBilling; return (
                  <div key={a.id} onClick={clickable?()=>onEditBilling(bill):undefined} style={{display:'flex',gap:12,alignItems:'center',padding:'11px 0',borderTop:i?`0.5px solid ${C.border}`:'none',cursor:clickable?'pointer':'default'}}>
                    <div style={{width:36,height:36,borderRadius:10,flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',background:disp?C.greenBg:C.bgSoft}}>
                      {disp
                        ? <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke={C.normal} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><circle cx='12' cy='12' r='9'/><polyline points='12 7 12 12 15 14'/></svg>
                        : <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke={C.done} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><polyline points='20 6 9 17 4 12'/></svg>}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:500,color:C.text}}>{fmt(a.monto)}</div>
                      <div style={{fontSize:11,color:C.textSoft,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{fmtF(a.fecha)}{a.proyecto?` · ${a.proyecto}`:''}{a.nota?` · ${a.nota}`:''}</div>
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
                      {!disp&&folio&&<span style={{fontSize:11,color:C.muted,textDecoration:'underline'}}>Factura N° {folio}</span>}
                      <span style={{fontSize:9.5,fontWeight:700,padding:'2px 8px',borderRadius:20,background:disp?C.greenBg:C.bgSoft,color:disp?C.greenText:C.done,whiteSpace:'nowrap'}}>{disp?'Disponible':'Consumido'}</span>
                    </div>
                  </div>
                )})}
            </div>}
          </div>
        )
      })()}
    </div>
  )
}

// Foto del cliente (Resumen de la ficha): 5 KPI + Por rendir + Vencidas + Próximas tareas. Fuente única para la ficha de admin y la del responsable limitado.
export function FotoCliente({client, sales=[], billing=[], expenses=[], tasks=[], setFtab, onRendicion, onEditExpense, onEditBilling, onEditTask, onAddTask}){
  const isDesktop = useIsDesktop()
  const ufState = useUF()
  const ufRef = ufState.uf || sales.find(s=>s.uf_value>0)?.uf_value || UF_FALLBACK
  const clientSales = sales.filter(s=>s.client_id===client.id&&s.status!=='Borrador'&&s.status!=='Propuesta'&&s.status!=='Rechazada'&&!esSubarriendo(s))
  const clientBilling = billing.filter(b=>b.client_id===client.id)
  const clientTasks = tasks.filter(t=>t.client_id===client.id&&t.status!=='Terminado')
  // Vendido UF: misma fuente que Dashboard/Ventas (recurrentes x12, CLP convertido a UF)
  const vendidoUF = clientSales.reduce((a,s)=>a+ventaUF(s,ufRef),0)
  const facturado = clientBilling.filter(esFacturada).reduce((a,b)=>a+montoFactura(b),0)   // autoridad DTE
  const cobrado = clientBilling.filter(b=>!b.deleted_at&&b.billing_type!=='reembolso').reduce((a,b)=>a+cobradoBill(b),0)   // incluye parciales; fuente única
  const porCobrar = clientBilling.filter(b=>!b.deleted_at&&b.billing_type!=='reembolso'&&b.invoice_no&&['Pendiente','Vencido'].includes(b.status))
  const totalPorCobrar = porCobrarBills(clientBilling)   // fuente única (mismo helper que Financiero/lista/Dashboard)
  // Saldo del cliente: fuente única (fgCliente) — mismo criterio (todo lo no-fondo es gasto) que la lista de Gastos y el Dashboard.
  const {fondos, gastos, saldo:saldoFondos} = fgCliente(expenses, client.id)
  const porRendir = gastosPorRendirCli(expenses, client.id).sort((a,b)=>(a.date||'')<(b.date||'')?-1:1)
  const porRendirTot = porRendir.reduce((a,e)=>a+(Number(e.amount)||0),0)
  // Embudo del cliente: cifras a UNA décima (resumen escaneable; el detalle de las filas va en fmt completo).
  const fmtM1 = fmtShort
  const ufM1 = n => n>0 ? `UF ${Math.round(n).toLocaleString('es-CL')}` : '—'   // KPI hero: UF redonda (sin ",0" colgando)
  const nVencFicha = porCobrar.filter(b=>esVencidaB(b)&&saldoBill(b)>0).length   // vencida con saldo: una factura Vencido ya abonada entera no se debe
  // Secciones del Resumen: todas parten plegadas (una línea con su cifra) y se despliegan al tocar.
  const [abiertas,setAbiertas] = useState(()=>new Set())
  const alt = k => setAbiertas(x=>{ const n=new Set(x); n.has(k)?n.delete(k):n.add(k); return n })
  const [elegir,setElegir] = useState(false)
  const propsCal = usePropiedades({clientId:client.id}), causasCal = useCausas({clientId:client.id}), calCli = useCalCliente(client.id)
  const cal = useMemo(()=>calendarioCliente({props:propsCal.rows||[], causas:causasCal.rows||[], ...(calCli.f||{}), dj:calCli.dj}),[propsCal.rows,causasCal.rows,calCli.f,calCli.dj])
  return (<>
        {/* FOTO: 5 tarjetas KPI individuales (Vendido·Facturado·Cobrado·Por cobrar·Fondos) + 2 tarjetas accionables (Vencidas·Próximas tareas). Sin duplicar: el detalle vive en las pestañas. */}
        {(()=>{
          const kc=(l,v,sub,col,go)=>(<div onClick={go?()=>setFtab(go):undefined} className={go?'lf-kpi':undefined} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:'12px 13px',cursor:go?'pointer':'default'}}>
            <div style={{...SEC_LBL}}>{l}</div>
            <div style={{fontSize:17,fontWeight:800,color:col,marginTop:4,letterSpacing:-.3,fontVariantNumeric:'tabular-nums'}}>{v}</div>
            <div style={{fontSize:9,color:C.muted,marginTop:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{sub}</div>
          </div>)
          const nFact=clientBilling.filter(esFacturada).length
          const _MAf=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
          const dcol=iso=>{const p=String(iso||'').slice(0,10).split('-');return p.length>=3?{dd:p[2],mm:_MAf[+p[1]-1]||''}:null}
          const venc=porCobrar.filter(b=>esVencidaB(b)&&saldoBill(b)>0).sort((a,b)=>String(a.due||'').localeCompare(String(b.due||'')))
          const vencTot=venc.reduce((s,b)=>s+saldoBill(b),0)
          const dvenc=b=>{const dl=daysLeft(b.due);return dl!=null&&dl<0?-dl:0}
          const tks=[...clientTasks].sort((a,b)=>String(a.due||'zzzz').localeCompare(String(b.due||'zzzz'))).slice(0,3)
          return (<>
          <div style={{display:'grid',gridTemplateColumns:isDesktop?'repeat(5,1fr)':'repeat(2,1fr)',gap:10,marginBottom:14}}>
            {kc('Vendido', ufM1(vendidoUF), `${clientSales.length} venta${clientSales.length!==1?'s':''}`, C.accent, 'financiero')}
            {kc('Facturado', fmtM1(facturado), `${nFact} factura${nFact!==1?'s':''}`, C.accent, 'documentos')}
            {kc('Cobrado', fmtM1(cobrado), 'histórico', C.greenText, 'documentos')}
            {kc('Por cobrar', totalPorCobrar>0?fmtM1(totalPorCobrar):'$0', nVencFicha>0?`${nVencFicha} vencida${nVencFicha!==1?'s':''}`:'saldo vivo', totalPorCobrar>0?(nVencFicha>0?C.overdueText:C.accent):C.muted, 'financiero')}
            {kc('Fondos', fmtM1(saldoFondos), porRendir.length>0?`${porRendir.length} por rendir ›`:saldoFondos<0?'por reponer':'disponibles', saldoFondos<0?C.overdueText:C.tealText, 'documentos')}
          </div>
          {(()=>{
            const sec=(k,icn,ibg,icol,t,sub,val,vcol,body,borde)=>{ const ab=abiertas.has(k)&&!!body
              return <div key={k} style={{background:C.surface,border:`1px solid ${borde||C.border}`,borderRadius:12,overflow:'hidden',minWidth:0}}>
                <div onClick={body?()=>alt(k):undefined} style={{display:'flex',alignItems:'center',gap:10,padding:'12px 14px',borderBottom:ab?`1px solid ${C.bgSoft}`:'none',cursor:body?'pointer':'default'}}>
                  <span style={{width:28,height:28,borderRadius:8,background:ibg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SIcon n={icn} s={15} c={icol}/></span>
                  <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:700,color:C.accent}}>{t}</div><div style={{fontSize:10.5,color:C.muted,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{sub}</div></div>
                  {val!=null&&<span style={{fontSize:13,fontWeight:800,color:vcol||C.accent,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{val}</span>}
                  {body&&<span style={{color:C.done,fontSize:13,flexShrink:0,display:'inline-flex',transform:ab?'rotate(180deg)':'none',transition:'transform .12s'}}><Gl n='chevD'/></span>}
                </div>{ab&&body}</div> }
            const fila=(key,on,izq,centro,der)=><div key={key} onClick={on} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 14px',borderTop:`1px solid ${C.bgSoft}`,cursor:on?'pointer':'default',fontSize:12}}>{izq}<div style={{flex:1,minWidth:0}}>{centro}</div>{der}</div>
            const pie=(txt,col,on)=><div onClick={on} style={{padding:'9px 14px',borderTop:`1px solid ${C.bgSoft}`,fontSize:11,fontWeight:700,color:col,cursor:on?'pointer':'default'}}>{txt} <Gl n='chevron'/></div>
            const tt=(a,b)=><><div style={{fontWeight:600,color:C.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{a}</div>{b&&<div style={{fontSize:10,color:C.muted,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{b}</div>}</>
            const sRend=porRendir.length>0&&onRendicion&&sec('rend','wallet',C.greenBg,C.greenText,'Por rendir al cliente',`${porRendir.length} gasto${porRendir.length!==1?'s':''}${porRendir[0]?.date?` · desde ${fmtFechaDMY(porRendir[0].date)}`:''}`,fmt(porRendirTot),C.greenText,<>
              {porRendir.slice(0,3).map(e=>fila(e.id,onEditExpense?()=>onEditExpense(e):undefined,null,<div style={{fontWeight:600,color:C.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{e.concept||e.category||'Gasto'}</div>,<><span style={{fontSize:10,color:C.muted,flexShrink:0}}>{fmtFechaDMY(e.date)}</span><span style={{fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums',flexShrink:0,minWidth:72,textAlign:'right'}}>{fmt(e.amount)}</span></>))}
              {porRendir.length>3&&pie(`Ver los ${porRendir.length} en Cartola`,C.greenText,()=>setFtab('documentos'))}
              <div style={{padding:'9px 14px',borderTop:`1px solid ${C.bgSoft}`}}><ActBtn variant='success' full onClick={()=>onRendicion(client)}>Rendir</ActBtn></div></>,C.greenText)
            const sVenc=venc.length>0
              ? sec('venc','file',C.overdueBg,C.overdueText,'Vencidas',`${venc.length} factura${venc.length!==1?'s':''} · a cobrar ya`,fmt(vencTot),C.overdueText,<>
                  {venc.slice(0,3).map(b=>fila(b.id,onEditBilling?()=>onEditBilling(b):undefined,diaGrande(b.issued_at||b.due,C.overdueText),tt(b.concept||'Factura',`${b.invoice_no?`Factura N° ${folioN(b.invoice_no)||b.invoice_no} · `:''}${dvenc(b)} d`),<span style={{fontWeight:800,color:C.overdueText,fontVariantNumeric:'tabular-nums',flexShrink:0}}>{fmt(saldoBill(b))}</span>))}
                  {pie('Cobrar · ir a Ventas',C.overdueText,()=>setFtab('financiero'))}</>)
              : sec('venc','check',C.greenBg,C.greenText,'Vencidas','al día · sin facturas vencidas',null,null,null)
            const nTV=clientTasks.filter(t=>t.due&&String(t.due).slice(0,10)<isoLocal(Date.now())).length
            const sTar=sec('tar','check',C.azulBg,C.accent,'Próximas tareas',`pendiente${clientTasks.length!==1?'s':''}${nTV?` · ${nTV} vencida${nTV!==1?'s':''}`:''}`,String(clientTasks.length),C.accent,<>
              {tks.length===0?<div style={{padding:'12px 14px',fontSize:12,color:C.muted,borderTop:`1px solid ${C.bgSoft}`}}>Sin tareas pendientes.</div>
                :tks.map(t=>fila(t.id,onEditTask?()=>onEditTask(t):undefined,<span style={{width:7,height:7,borderRadius:'50%',background:urgencyColor(t.due,t.status),flexShrink:0}}/>,tt(t.title,`${taskAssignees(t).join(', ')||'—'}${t.due?` · vence ${fmtFechaDMY(t.due)}`:''}`),null))}
              {onAddTask&&<div onClick={()=>onAddTask()} style={{padding:'9px 14px',borderTop:`1px solid ${C.bgSoft}`,fontSize:11,fontWeight:700,color:C.azulInfo,cursor:'pointer'}}>+ Nueva tarea</div>}</>)
            const goCal=g=>g==='financiero'?()=>setFtab('financiero'):undefined
            const chipD=f=>{ const d=_diasA(cal.hoy,f), pr=d<=31; return <span style={{fontSize:10.5,fontWeight:700,borderRadius:10,padding:'2px 8px',whiteSpace:'nowrap',flexShrink:0,background:d<0?C.overdueBg:pr?C.soonBg:C.track,color:d<0?C.overdueText:pr?C.soonText:C.muted}}>{d<0?'Vencido':d===0?'Hoy':`En ${d} día${d===1?'':'s'}`}</span> }
            const sCal=sec('cal','cal',C.azulBg,C.accent,'Calendario',cal.items.length?`en ${CAL_CLI_DIAS} días · próximo ${fmtFechaDMY(cal.items[0].fecha)}`:`en ${CAL_CLI_DIAS} días`,String(cal.items.length),C.accent,<>
              {cal.items.length?cal.items.map((x,i)=>x.porConfirmar
                ? <div key={i} style={{display:'flex',alignItems:'flex-start',gap:10,padding:'9px 14px',borderTop:`1px solid ${C.bgSoft}`,fontSize:12}}>{diaGrande(x.fecha,x.vencido?C.overdueText:undefined)}
                    <div style={{flex:1,minWidth:0}}><div style={{fontWeight:600,color:C.text}}>{x.t}</div><div style={{fontSize:10,color:C.muted,overflowWrap:'anywhere'}}>{x.s}</div>
                      <div style={{display:'flex',gap:6,marginTop:6,alignItems:'center'}}><span style={{fontSize:10.5,fontWeight:700,borderRadius:10,padding:'2px 8px',background:C.soonBg,color:C.soonText,whiteSpace:'nowrap'}}>Por confirmar</span><span style={{flex:1}}/>
                        <button onClick={()=>calCli.resolverPlazoDoc(x.porConfirmar,true)} style={{fontSize:11,fontWeight:700,border:'none',borderRadius:8,padding:'4px 10px',background:C.accent,color:'#fff',cursor:'pointer',fontFamily:'inherit'}}>Confirmar</button>
                        <button onClick={()=>calCli.resolverPlazoDoc(x.porConfirmar,false)} style={{fontSize:11,fontWeight:600,border:`1px solid ${C.border}`,borderRadius:8,padding:'4px 10px',background:C.surface,color:C.muted,cursor:'pointer',fontFamily:'inherit'}}>Descartar</button></div></div></div>
                : fila(i,goCal(x.go),diaGrande(x.fecha,x.vencido?C.overdueText:undefined),tt(x.t,x.s),chipD(x.fecha)))
                :<div style={{padding:'10px 14px',borderTop:`1px solid ${C.bgSoft}`,fontSize:12,fontWeight:700,color:C.greenText}}>Sin vencimientos en {CAL_CLI_DIAS} días</div>}
              {cal.noRev>0&&fila('nor',()=>setFtab('financiero'),<span style={{width:7,height:7,borderRadius:'50%',background:C.overdue,flexShrink:0}}/>,<span style={{color:C.overdueText,fontSize:11.5,fontWeight:600}}>{cal.noRev} causa{cal.noRev!==1?'s':''} sin revisar · falló la última revisión</span>,<span style={{fontSize:11,fontWeight:700,color:C.azulInfo,flexShrink:0}}>Ver <Gl n='chevron'/></span>)}
              {cal.seguimiento>0&&fila('seg',()=>setFtab('financiero'),<span style={{width:7,height:7,borderRadius:'50%',background:C.done,flexShrink:0}}/>,<span style={{color:C.text,fontSize:11.5}}>{cal.seguimiento} causa{cal.seguimiento!==1?'s':''} en seguimiento · sin tabla</span>,<span style={{fontSize:11,fontWeight:700,color:C.azulInfo,flexShrink:0}}>Ver <Gl n='chevron'/></span>)}
              <div style={{display:'flex',alignItems:'center',gap:8,padding:'9px 14px',borderTop:`1px solid ${C.bgSoft}`,fontSize:11,fontWeight:700}}><span style={{color:C.muted,fontWeight:600,flex:1,minWidth:0,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>Obligaciones tributarias · {cal.oblTxt||'por definir'}</span><span onClick={()=>setElegir(v=>!v)} style={{color:C.azulInfo,cursor:'pointer',flexShrink:0}}>{elegir?'Listo':'Elegir'}</span></div>
              {elegir&&<div style={{display:'flex',flexWrap:'wrap',gap:6,padding:'10px 14px',borderTop:`1px solid ${C.bgSoft}`}}>{OBL_CLIENTE.map(([tp,fo,lb])=>{ const on=cal.elegidas.some(o=>o.tipo===tp&&String(o.formulario||'')===String(fo||''))
                return <span key={lb} onClick={()=>calCli.alternar(tp,fo,lb)} style={{fontSize:11.5,fontWeight:600,border:`1px solid ${on?C.accent:C.border}`,borderRadius:14,padding:'4px 10px',background:on?C.accent:C.surface,color:on?'#fff':C.muted,cursor:'pointer',whiteSpace:'nowrap'}}>{lb}</span> })}</div>}</>)
            // Escritorio: dos columnas (Por rendir · Próximas tareas | Vencidas · Calendario); celular: una columna en ese orden.
            const col=xs=><div style={{display:'flex',flexDirection:'column',gap:12,minWidth:0}}>{xs.filter(Boolean)}</div>
            return isDesktop
              ? <div style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr)',gap:12,marginBottom:8,alignItems:'start'}}>{col(sRend?[sRend,sTar]:[sVenc,sTar])}{col(sRend?[sVenc,sCal]:[sCal])}</div>
              : <div style={{display:'flex',flexDirection:'column',gap:12,marginBottom:8}}>{[sRend,sVenc,sTar,sCal].filter(Boolean)}</div>
          })()}
          </>)
        })()}
  </>)
}

// Una causa: resumen + acciones + seguimiento (bitácora) detrás de su botón. En celular parte plegada (una línea) y se abre al tocar.
export function CausaFila({c, isDesktop, cliente=null, onCambio, user}){
  const D=isDesktop
  const [op,setOp]=useState(D), [verSeg,setVerSeg]=useState(false), [seg,setSeg]=useState(null), [busy,setBusy]=useState(false), [edit,setEdit]=useState(false), [rol,setRol]=useState(c.rol||'')
  const [e0,eCol,eBg]=_estadoCausa(c)
  const cargarSeg=()=>{ if(DEMO){ setSeg([{id:'s1',revisado_at:'2026-10-23T19:40:00Z',origen:'manual',resultado:'Sin tabla: la búsqueda por causa no trae programación.'}]); return }
    supabase.from('causas_seguimiento').select('*').eq('causa_id',c.id).order('revisado_at',{ascending:false}).limit(40).then(({data})=>setSeg(data||[]),()=>setSeg([])) }
  const toggleSeg=()=>{ if(!verSeg&&seg===null) cargarSeg(); setVerSeg(v=>!v) }
  const revisar=async()=>{ if(busy) return; setBusy(true)
    try{ if(DEMO){ appAlert('Revisión hecha (demo): sin cambios en la tabla.'); return }
      const {data,error}=await supabase.functions.invoke('causas-tablas',{body:{causa_id:c.id}})
      if(error||data?.error) throw new Error(data?.error||error?.message||'sin respuesta')
      const t=(data.en_tabla||[])[0]
      appAlert(data.errores?.length?`No se pudo revisar: ${data.errores[0].error}`:t?`En tabla: ${t.sala||''}${t.numero?`, N° ${t.numero}`:''}, ${fmtFechaDMY(t.fecha)}.${(data.avisos||[]).length?((data.avisos[0].enviado)?` Aviso enviado a ${[...data.avisos[0].para,...(data.avisos[0].cc||[])].join(', ')} desde la casilla de la oficina.`:` El aviso NO se envió (${data.avisos[0].motivo}).`):''}`:'No está en la tabla de hoy. Quedó en el seguimiento.')
      onCambio&&onCambio(); if(seg!==null) cargarSeg()
    }catch(err){ appAlert('No se pudo revisar la causa: '+(err.message||err)+'\n\nSi el agente aún no está activo, la revisión automática empieza al activarlo.') }
    finally{ setBusy(false) } }
  const guardar=async(patch,log)=>{ setBusy(true)
    try{ if(!DEMO){ const {error}=await supabase.from('causas').update({...patch,updated_at:new Date().toISOString()}).eq('id',c.id); if(error) throw error }
      logActividad(log,{tabla:'causas',id:c.id,detalle:{title:`${_rolTxt({...c,...patch})} · ${_corteCorta(c.corte_nombre)}`,antes:Object.fromEntries(Object.keys(patch).map(k=>[k,c[k]??null])),cliente:cliente||null}})
      onCambio&&onCambio({...c,...patch}) }catch(err){ appAlert('No se pudo guardar: '+(err.message||err)) }
    setBusy(false) }
  const confirmar=()=>{ if(!/^\d+$/.test(String(rol||''))){ setEdit(true); appAlert('Completa el rol de la causa antes de confirmarla.'); return } guardar({estado:'activa',rol:String(rol)},'causas.confirmada') }
  const ab={fontSize:12.5,fontWeight:600,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',padding:0,whiteSpace:'nowrap'}
  const predio=String(c.origen||'').split(' · ')[0].trim()   // antecedente de primera instancia o predio (p. ej. «Tira Larga»)
  const detalle=[cliente, _rolTxt(c), predio||null, _libroLegible(c.libro_nombre), _corteCorta(c.corte_nombre), c.ultima_tabla?.sala&&c.ultima_tabla?.fecha>=isoLocal(new Date().toISOString())?`${c.ultima_tabla.sala}${c.ultima_tabla.numero?` · N° ${c.ultima_tabla.numero}`:''}${c.ultima_tabla.viendo?` · se está viendo el N° ${c.ultima_tabla.viendo}`:''}`:null, c.abogado].filter(Boolean).flatMap((x,i)=>i?[' · ',x]:[x]).map((x,i)=><Fragment key={i}>{x}</Fragment>)   // cliente puede venir como enlace (nodo): se intercala, no se une como texto
  const chip=<span style={{fontSize:11,fontWeight:600,color:eCol,background:eBg,borderRadius:12,padding:'2px 8px',whiteSpace:'nowrap',flexShrink:0}}>{e0}</span>
  return (<div style={{borderTop:`1px solid ${C.track}`}}>
    <div onClick={D?undefined:()=>setOp(v=>!v)} style={{display:'flex',alignItems:'center',gap:10,padding:D?'10px 14px':'10px 12px',cursor:D?'default':'pointer'}}>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:13.5,fontWeight:600,color:C.text,...(D?{}:{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'})}}>{c.caratula||'Sin carátula'}</div>
        <div style={{fontSize:12,color:C.textSoft,marginTop:1}}>{D?detalle:[_rolTxt(c),predio].filter(Boolean).join(' · ')}</div>
      </div>
      {chip}
      {D?<div style={{display:'flex',gap:12,flexShrink:0}}>{c.estado==='por_confirmar'?<button onClick={confirmar} disabled={busy} style={ab}>Confirmar</button>:<button onClick={revisar} disabled={busy} style={ab}>{busy?'Revisando…':'Revisar ahora'}</button>}<button onClick={toggleSeg} style={ab}>{verSeg?'Ocultar seguimiento':'Seguimiento'}</button><button onClick={()=>setEdit(v=>!v)} style={{...ab,color:C.muted}}>Editar</button></div>
        :<span style={{color:C.done,fontSize:12,transform:op?'rotate(90deg)':'none',transition:'transform .15s'}}><Gl n='chevron'/></span>}
    </div>
    {op&&<div style={{padding:D?'0 14px 10px':'0 12px 12px'}}>
      {!D&&<><div style={{fontSize:12,color:C.textSoft}}>{[_libroLegible(c.libro_nombre),_corteCorta(c.corte_nombre),c.abogado].filter(Boolean).join(' · ')}</div>{c.ultima_tabla?.sala&&c.ultima_tabla?.fecha>=isoLocal(new Date().toISOString())&&<div style={{fontSize:12,color:C.text,marginTop:2}}>{[c.ultima_tabla.sala,c.ultima_tabla.numero?`N° ${c.ultima_tabla.numero}`:'',c.ultima_tabla.viendo?`se está viendo el N° ${c.ultima_tabla.viendo}`:''].filter(Boolean).join(' · ')}</div>}
        <div style={{display:'flex',gap:14,marginTop:8,flexWrap:'wrap'}}>{c.estado==='por_confirmar'?<button onClick={confirmar} disabled={busy} style={ab}>Confirmar</button>:<button onClick={revisar} disabled={busy} style={ab}>{busy?'Revisando…':'Revisar ahora'}</button>}<button onClick={toggleSeg} style={ab}>Seguimiento</button><button onClick={()=>setEdit(v=>!v)} style={{...ab,color:C.muted}}>Editar</button></div></>}
      {edit&&<div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginTop:8}}>
        <input value={rol} onChange={ev=>setRol(ev.target.value.replace(/\D/g,''))} placeholder='Rol' inputMode='numeric' style={{width:90,fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,padding:'7px 9px',outline:'none'}}/>
        <span style={{fontSize:12.5,color:C.textSoft}}>-{c.anio}</span>
        <button disabled={busy||!rol} onClick={()=>{ guardar({rol:String(rol)},'causas.editada'); setEdit(false) }} style={{fontSize:12.5,fontWeight:700,borderRadius:9,border:'none',background:C.accent,color:'#fff',padding:'7px 12px',cursor:'pointer',opacity:!rol?.5:1}}>Guardar</button>
        <button disabled={busy} onClick={async()=>{ if(await appConfirm('¿Dar por terminada esta causa? Deja de revisarse en las tablas.')){ guardar({estado:'terminada'},'causas.terminada') } }} style={{...ab,color:C.muted}}>Terminar causa</button>
      </div>}
      {verSeg&&<div style={{marginTop:8,background:C.bgSoft,border:`1px solid ${C.border}`,borderRadius:8,padding:'8px 10px'}}>
        <div style={{...SEC_LBL,fontSize:10,marginBottom:4}}>Seguimiento</div>
        {seg===null?<div style={{fontSize:12,color:C.textSoft}}>Cargando…</div>:!seg.length?<div style={{fontSize:12,color:C.textSoft}}>Sin revisiones todavía.</div>
          :seg.map(x=><div key={x.id} style={{display:'flex',flexDirection:D?'row':'column',gap:D?10:1,fontSize:12,padding:'3px 0'}}><span style={{color:C.textSoft,whiteSpace:'nowrap',fontVariantNumeric:'tabular-nums'}}>{fmtFechaDMY(isoLocal(x.revisado_at))} {new Date(x.revisado_at).toTimeString().slice(0,5)}</span><span style={{minWidth:0}}><b style={{color:C.accent,fontWeight:600}}>{x.origen==='agente'?'Revisión automática':'Revisión manual'}</b> · {x.resultado}</span></div>)}
        <div style={{fontSize:11.5,color:C.textSoft,marginTop:5}}>Programación de Salas 3 veces al día · Monitor de Salas el día de la vista</div>
      </div>}
    </div>}
  </div>)
}

// Causas de una venta (Ficha › Ventas): lista + «+ Causa». En celular el bloque parte plegado en una línea con su resumen.
export function CausasVenta({client, sale, isDesktop, user, causas}){
  const D=isDesktop
  const {rows,setRows,recargar}=causas
  const [abierto,setAbierto]=useState(D), [nueva,setNueva]=useState(false), [busy,setBusy]=useState(false)
  const [f,setF]=useState({corte:'',libro:'',rol:'',anio:String(new Date().getFullYear()),caratula:'',abogado:sale.responsible||client.abogado_responsable||''})
  if(rows===null) return null
  const mias=rows.filter(c=>String(c.sale_id||'')===String(sale.id))
  const esSup=f.corte==='6050000'
  const listo=f.corte&&(esSup||f.libro)&&/^\d+$/.test(f.rol)&&/^\d{4}$/.test(f.anio)
  const guardar=async()=>{ if(!listo||busy) return; setBusy(true)
    try{ const corte=CORTES_PJUD.find(x=>x[0]===f.corte), libro=LIBROS_PJUD.find(x=>x[0]===f.libro)
      const row={client_id:client.id, sale_id:sale.id, abogado:f.abogado||null, instancia:esSup?'suprema':'apelaciones', corte_codigo:f.corte, corte_nombre:corte[1], libro_codigo:esSup?null:f.libro, libro_nombre:esSup?null:libro?.[1]||null, rol:String(Number(f.rol)), anio:Number(f.anio), caratula:f.caratula.trim()||null, estado:'activa', fuente:'manual', created_by:user?.name||null}
      let nuevo={...row,id:'demo-cz-'+Date.now()}
      if(!DEMO){ const {data,error}=await supabase.from('causas').insert(row).select().single(); if(error) throw new Error(/causas_unica|duplicate/.test(error.message)?'Esa causa ya está registrada.':error.message); nuevo=data }
      logActividad('causas.agregada',{tabla:'causas',id:nuevo.id,detalle:{title:`${_rolTxt(nuevo)} · ${_corteCorta(nuevo.corte_nombre)}`,cliente:client.name,venta:sale.title}})
      setRows(p=>[...(p||[]),nuevo]); setNueva(false); setF(x=>({...x,rol:'',caratula:''}))
      if(!DEMO){ const {data}=await supabase.functions.invoke('causas-tablas',{body:{causa_id:nuevo.id}}).catch(()=>({data:null})); const t=(data?.en_tabla||[])[0]; recargar(); appAlert(data?.ok?(t?`Causa guardada. Está en tabla: ${t.sala||''}${t.numero?`, N° ${t.numero}`:''}, ${fmtFechaDMY(t.fecha)}.`:'Causa guardada. Hoy no está en tabla; se revisa en los próximos horarios.'):'Causa guardada. Se revisa en los próximos horarios.') }
    }catch(err){ appAlert('No se pudo guardar la causa: '+(err.message||err)) }
    setBusy(false) }
  const fld=(label,el,st)=><label style={{display:'block',background:C.bgSoft,border:`0.5px solid ${C.border}`,borderRadius:8,padding:'5px 10px',minWidth:0,...st}}><span style={{display:'block',fontSize:8,color:C.textSoft,textTransform:'uppercase',letterSpacing:.5}}>{label}</span>{el}</label>
  const inS={width:'100%',border:'none',background:'none',outline:'none',fontSize:13,color:C.text,padding:'2px 0',minWidth:0}
  const nPc=mias.filter(c=>c.estado==='por_confirmar').length, nTab=mias.filter(c=>c.ultima_tabla?.fecha>=isoLocal(new Date().toISOString())).length
  const resumen=[nTab?`${nTab} en tabla`:null,nPc?`${nPc} por confirmar`:null].filter(Boolean).join(' · ')
  return (<div style={{marginTop:10,border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden',background:C.surface}} onClick={ev=>ev.stopPropagation()}>
    <div onClick={D?undefined:()=>setAbierto(v=>!v)} style={{display:'flex',alignItems:'center',gap:8,padding:'9px 12px',background:C.bgPanel,cursor:D?'default':'pointer'}}>
      <span style={{...SEC_LBL,fontSize:10.5,flex:1}}>Causas{mias.length?` · ${mias.length}`:''}</span>
      {resumen&&<span style={{fontSize:11,fontWeight:600,color:nTab?C.accent:C.textSoft,background:nTab?C.azulBg:C.track,borderRadius:12,padding:'2px 8px',whiteSpace:'nowrap'}}>{resumen}</span>}
      {D?<button onClick={()=>setNueva(v=>!v)} style={{fontSize:12.5,fontWeight:600,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',padding:0}}>+ Causa</button>
        :<span style={{color:C.done,fontSize:12,transform:abierto?'rotate(90deg)':'none',transition:'transform .15s'}}><Gl n='chevron'/></span>}
    </div>
    {abierto&&<>
      {mias.map(c=><CausaFila key={c.id} c={c} isDesktop={D} user={user} onCambio={x=>x?setRows(p=>p.map(y=>y.id===x.id?x:y).filter(y=>y.estado!=='terminada')):recargar()}/>)}
      {!mias.length&&!nueva&&<div style={{fontSize:12,color:C.textSoft,padding:'10px 12px',borderTop:`1px solid ${C.track}`}}>Sin causas en esta venta.</div>}
      {!D&&!nueva&&<div style={{padding:'9px 12px',borderTop:`1px solid ${C.track}`}}><button onClick={()=>setNueva(true)} style={{fontSize:12.5,fontWeight:600,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',padding:0}}>+ Causa</button></div>}
      {nueva&&<div style={{borderTop:`1px solid ${C.track}`,padding:'11px 12px'}}>
        <div style={{...SEC_LBL,fontSize:10,marginBottom:8}}>Agregar causa a esta venta</div>
        <div style={{display:'grid',gridTemplateColumns:D?'minmax(0,1.6fr) minmax(0,1.3fr) minmax(0,.7fr) minmax(0,.6fr)':'1fr 1fr',gap:8}}>
          {fld('Corte',<select value={f.corte} onChange={ev=>setF(x=>({...x,corte:ev.target.value}))} style={inS}><option value=''>Elige la Corte</option>{CORTES_PJUD.map(([k,n])=><option key={k} value={k}>{n}</option>)}</select>,D?null:{gridColumn:'1 / -1'})}
          {!esSup&&fld('Libro',<select value={f.libro} onChange={ev=>setF(x=>({...x,libro:ev.target.value}))} style={inS}><option value=''>Elige el libro</option>{LIBROS_PJUD.map(([k,n])=><option key={k} value={k}>{_libroLegible(n)}</option>)}</select>,D?null:{gridColumn:'1 / -1'})}
          {fld('Rol',<input value={f.rol} onChange={ev=>setF(x=>({...x,rol:ev.target.value.replace(/\D/g,'')}))} inputMode='numeric' style={inS}/>,esSup&&D?{gridColumn:'span 2'}:null)}
          {fld('Año',<input value={f.anio} onChange={ev=>setF(x=>({...x,anio:ev.target.value.replace(/\D/g,'').slice(0,4)}))} inputMode='numeric' style={inS}/>)}
        </div>
        <div style={{display:'grid',gridTemplateColumns:D?'minmax(0,3fr) minmax(0,1fr) auto':'1fr',gap:8,marginTop:8,alignItems:'stretch'}}>
          {fld('Carátula',<input value={f.caratula} onChange={ev=>setF(x=>({...x,caratula:ev.target.value}))} style={inS}/>)}
          {fld('Abogado',<select value={f.abogado} onChange={ev=>setF(x=>({...x,abogado:ev.target.value}))} style={inS}><option value=''>—</option>{['Cristóbal','Erasmo','Martín','Martina','Rodrigo'].map(n=><option key={n} value={n}>{n}</option>)}</select>)}
          <div style={{display:'flex',gap:8,alignItems:'center',justifyContent:D?'flex-start':'flex-end'}}>
            <button onClick={()=>setNueva(false)} style={{fontSize:12.5,fontWeight:600,color:C.muted,background:'none',border:'none',cursor:'pointer'}}>Cancelar</button>
            <button disabled={!listo||busy} onClick={guardar} style={{fontSize:12.5,fontWeight:700,borderRadius:9,border:'none',background:C.accent,color:'#fff',padding:'9px 13px',cursor:listo?'pointer':'default',opacity:listo&&!busy?1:.5,whiteSpace:'nowrap'}}>{busy?'Guardando…':'Guardar y revisar'}</button>
          </div>
        </div>
      </div>}
    </>}
  </div>)
}

export function PropiedadesVenta({client, sale, isDesktop, props}){
  const D=isDesktop
  const {rows,setRows}=props
  const [abierto,setAbierto]=useState(D), [q,setQ]=useState(''), [prop,setProp]=useState(''), [ab,setAb]=useState(()=>new Set()), [det,setDet]=useState(null), [todos,setTodos]=useState(()=>new Set())
  const [nuevo,setNuevo]=useState(false), [f,setF]=useState({comuna:'',rol:'',nombre:'',propietario:''}), [busy,setBusy]=useState(false)
  if(rows===null) return null
  const mias=rows.filter(p=>String(p.sale_id||'')===String(sale.id))
  if(!mias.length) return null
  const propietarios=[...new Set(mias.map(p=>p.propietario).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'))
  const qq=_normTxt(q)
  const lista=mias.filter(p=>(!prop||p.propietario===prop)&&(!qq||_normTxt(`${p.rol} ${p.lote||''} ${p.nombre||''} ${p.direccion||''} ${p.propietario||''} ${p.propietario_actual||''}`).includes(qq)))
  const hayFiltro=!!(qq||prop)
  const suma=(xs,k)=>xs.reduce((a,x)=>a+(Number(x[k])||0),0)
  const toggle=(set,k)=>set(p=>{ const n=new Set(p); n.has(k)?n.delete(k):n.add(k); return n })
  // Grupos: comuna; si la comuna tiene muchos roles, se parte por destino (lo sin destino queda en «Otros roles de <comuna>»).
  const comunas={}; lista.forEach(p=>{ (comunas[p.comuna]=comunas[p.comuna]||[]).push(p) })
  const ordenC=Object.keys(comunas).sort((a,b)=>comunas[b].length-comunas[a].length||a.localeCompare(b,'es'))
  const subgrupos=(c,xs)=>{ if(xs.length<=12) return [[`${c}`,xs.slice().sort(_ordRol),false]]
    const g=_GRUPO_DESTINO.map(([d,t])=>[t,xs.filter(p=>p.destino===d)])
    g.push(['Sin propiedad en el SII',xs.filter(p=>p.estado_sii)])
    const usados=new Set(g.flatMap(x=>x[1]))
    g.push([`Otros roles de ${c}`,xs.filter(p=>!usados.has(p))])
    return g.filter(x=>x[1].length).map(([t,ys])=>[t,ys.slice().sort((a,b)=>(Number(b.deuda_contribuciones)||0)-(Number(a.deuda_contribuciones)||0)||_ordRol(a,b)),true]) }
  const monto=xs=>{ const d=suma(xs,'deuda_contribuciones'), a=suma(xs,'avaluo_fiscal')
    return <span style={{fontSize:12.5,fontWeight:600,color:C.text,whiteSpace:'nowrap',fontVariantNumeric:'tabular-nums'}}>{a>0?fmtShort(a):''}{a>0&&d>0?' · ':''}{d>0&&<span style={{color:C.soonText}}>{fmtShort(d)} deuda</span>}</span> }
  const fila=(p,i)=>{ const op=det===p.id
    const sub=[p.lote?`Lote ${p.lote}`:null, _nomProp(p.propietario)||null, p.destino||(p.estado_sii?'Sin propiedad en el SII':null), D&&p.superficie_m2?`${Number(p.superficie_m2).toLocaleString('es-CL',{maximumFractionDigits:2})} m²`:null, D&&p.arrendado?'arrendado':null].filter(Boolean).join(' · ')
    const der=Number(p.deuda_contribuciones)>0?[fmtShort(p.deuda_contribuciones),'deuda',C.soonText]:Number(p.avaluo_fiscal)>0?[fmtShort(p.avaluo_fiscal),'avalúo',C.text]:null
    const dato=(l,v)=><div style={{minWidth:0}}><div style={{fontSize:11,color:C.textSoft}}>{l}</div><div style={{fontSize:12.5,fontWeight:600,color:C.text}}>{v||'—'}</div></div>
    return <div key={p.id}>
      <div onClick={()=>setDet(op?null:p.id)} style={{display:'flex',alignItems:'center',gap:10,padding:D?'8px 12px 8px 30px':'8px 12px',borderTop:`1px solid ${C.track}`,cursor:'pointer'}}>
        <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:C.text}}>{p.rol}{p.nombre?` · ${p.nombre}`:''}</div>
          <div style={{fontSize:11.5,color:C.textSoft,marginTop:1}}>{!p.nombre&&p.direccion?`${p.direccion} · `:''}{sub}</div></div>
        {der&&<div style={{textAlign:'right',flexShrink:0}}><div style={{fontSize:12.5,fontWeight:600,color:der[2],fontVariantNumeric:'tabular-nums'}}>{der[0]}</div><div style={{fontSize:11,color:C.textSoft}}>{der[1]}</div></div>}
      </div>
      {op&&<div style={{background:C.bgSoft,borderTop:`1px solid ${C.track}`,padding:D?'8px 12px 10px 30px':'8px 12px 10px',display:'grid',gridTemplateColumns:D?'repeat(3,minmax(0,1fr))':'1fr 1fr',gap:'8px 16px'}}>
        {dato('Inscripción',p.inscripcion_fojas?`Fs ${p.inscripcion_fojas} N° ${p.inscripcion_numero||'—'}${p.inscripcion_anio?` ${p.inscripcion_anio}`:''}`:null)}
        {dato('Propietario actual',_nomProp(p.propietario_actual))}
        {dato('Superficie',p.superficie_m2?`${Number(p.superficie_m2).toLocaleString('es-CL',{maximumFractionDigits:2})} m²`:null)}
        {dato('Avalúo fiscal',Number(p.avaluo_fiscal)>0?fmt(p.avaluo_fiscal):null)}
        {dato('Avalúo afecto',p.avaluo_afecto!=null?fmt(p.avaluo_afecto):null)}
        {dato('% de derecho',p.porcentaje_derecho!=null?`${Number(p.porcentaje_derecho).toLocaleString('es-CL')}%`:null)}
        {dato('Arriendo',p.arrendado?'Arrendado':null)}
        {dato('Deuda informada',Number(p.deuda_contribuciones)>0?fmt(p.deuda_contribuciones):null)}
        {dato('Origen',String(p.fuente||'').split(' · ').slice(-1)[0]||null)}
        {p.notas&&<div style={{gridColumn:'1 / -1',fontSize:12,color:C.muted}}>{p.notas}</div>}
      </div>}
    </div> }
  const grupo=(k,t,xs,nivel)=>{ const op=hayFiltro||ab.has(k), lim=todos.has(k)?xs.length:8
    return <div key={k} style={{borderTop:`1px solid ${C.track}`}}>
      <div onClick={()=>!hayFiltro&&toggle(setAb,k)} style={{display:'flex',alignItems:'center',gap:8,padding:nivel&&D?'10px 12px 10px 30px':'10px 12px',background:nivel?C.bgSoft:undefined,cursor:'pointer'}}>
        <span style={{fontSize:12,color:C.textSoft,transform:op?'rotate(90deg)':'none',transition:'transform .15s'}}><Gl n='chevron'/></span>
        <span style={{fontSize:nivel?13:13.5,fontWeight:700,color:nivel?C.text:C.accent,flex:1,minWidth:0}}>{t}</span>
        <span style={{fontSize:12,color:C.textSoft,whiteSpace:'nowrap'}}>{xs.length} rol{xs.length!==1?'es':''}</span>
        {D&&monto(xs)}
      </div>
      {op&&<>{xs.slice(0,lim).map(fila)}{xs.length>lim&&<div style={{padding:D?'8px 12px 10px 30px':'8px 12px 10px',borderTop:`1px solid ${C.track}`}}><button onClick={()=>toggle(setTodos,k)} style={{fontSize:12.5,fontWeight:600,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',padding:0}}>Ver los {xs.length}</button></div>}</>}
    </div> }
  const exportar=async()=>{ try{ const XLSX=await loadXLSXStyle()
    const data=lista.slice().sort((a,b)=>a.comuna.localeCompare(b.comuna,'es')||_ordRol(a,b)).map(p=>[p.comuna,p.rol,p.lote||'',p.nombre||p.direccion||'',p.destino||(p.estado_sii?'Sin propiedad en el SII':''),_nomProp(p.propietario),_nomProp(p.propietario_actual),p.inscripcion_fojas?`Fs ${p.inscripcion_fojas} N° ${p.inscripcion_numero||''} ${p.inscripcion_anio||''}`:'',Number(p.superficie_m2)||'',Number(p.avaluo_fiscal)||'',Number(p.deuda_contribuciones)||'',p.arrendado?'Sí':''])
    const ws=XLSX.utils.aoa_to_sheet([[`Roles · ${client.name} · ${sale.title}`],[],['Comuna','Rol','Lote','Nombre o dirección','Destino','Propietario','Propietario actual','Inscripción','Superficie m²','Avalúo fiscal','Deuda informada','Arrendado'],...data])
    ws['!cols']=[{wch:12},{wch:10},{wch:6},{wch:34},{wch:22},{wch:34},{wch:30},{wch:22},{wch:12},{wch:15},{wch:15},{wch:10}]
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Roles'); XLSX.writeFile(wb,`Roles ${client.name}.xlsx`) }catch(e){ appAlert('No se pudo exportar: '+e.message) } }
  const listo=f.comuna.trim()&&/^\d+-\d+$/.test(f.rol.trim())
  const guardar=async()=>{ if(!listo||busy) return; setBusy(true)
    try{ const row={client_id:client.id,sale_id:sale.id,comuna:f.comuna.trim(),rol:f.rol.trim(),nombre:f.nombre.trim()||null,propietario:f.propietario.trim()||null,fuente:`Agregado a mano · ${isoLocal(new Date().toISOString())}`}
      let n={...row,id:'demo-pr-'+Date.now()}
      if(!DEMO){ const {data,error}=await supabase.from('propiedades').insert(row).select().single(); if(error) throw new Error(/duplicate|unique/.test(error.message)?'Ese rol ya está registrado para este cliente.':error.message); n=data }
      logActividad('propiedades.agregada',{tabla:'propiedades',id:n.id,detalle:{title:`Rol ${n.comuna} ${n.rol}`,cliente:client.name,venta:sale.title}})
      setRows(p=>[...(p||[]),n]); setNuevo(false); setF(x=>({...x,rol:'',nombre:''}))
    }catch(err){ appAlert('No se pudo guardar el rol: '+(err.message||err)) }
    setBusy(false) }
  const inS={width:'100%',border:'none',background:'none',outline:'none',fontSize:13,color:C.text,padding:'2px 0',minWidth:0}
  const fld=(label,el)=><label style={{display:'block',background:C.bgSoft,border:`0.5px solid ${C.border}`,borderRadius:8,padding:'5px 10px',minWidth:0}}><span style={{display:'block',fontSize:8,color:C.textSoft,textTransform:'uppercase',letterSpacing:.4,fontWeight:700}}>{label}</span>{el}</label>
  const selSty={fontSize:12.5,color:C.text,background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:'7px 8px',minWidth:0,maxWidth:D?220:'100%'}
  return (<div style={{marginTop:10,border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden',background:C.surface}} onClick={ev=>ev.stopPropagation()}>
    <div onClick={()=>setAbierto(v=>!v)} style={{display:'flex',alignItems:'center',gap:8,padding:'9px 12px',background:C.bgPanel,cursor:'pointer'}}>
      <span style={{...SEC_LBL,fontSize:10.5}}>Roles · {mias.length}</span>
      {D&&<span style={{fontSize:12,color:C.textSoft,flex:1}}>{[suma(mias,'avaluo_fiscal')>0?`${fmtShort(suma(mias,'avaluo_fiscal'))} avalúo`:null,suma(mias,'deuda_contribuciones')>0?`${fmtShort(suma(mias,'deuda_contribuciones'))} deuda`:null].filter(Boolean).join(' · ')}</span>}
      {!D&&<span style={{flex:1}}/>}
      {abierto&&D?<button onClick={ev=>{ev.stopPropagation();setNuevo(v=>!v)}} style={{fontSize:12.5,fontWeight:600,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',padding:0}}>+ Rol</button>
        :<span style={{color:C.done,fontSize:12,transform:abierto?'rotate(90deg)':'none',transition:'transform .15s'}}><Gl n='chevron'/></span>}
    </div>
    {abierto&&<>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',padding:'10px 12px',borderTop:`1px solid ${C.track}`}}>
        <div style={{flex:D?'1 1 220px':'1 1 100%',display:'flex',alignItems:'center',gap:6,background:C.bgSoft,border:`1px solid ${C.border}`,borderRadius:8,padding:'7px 10px',minWidth:0}}>
          <SIcon n='search' s={14} c={C.done}/>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder={D?'Buscar rol, lote, dirección o propietario':'Buscar rol o propietario'} style={{border:'none',background:'none',outline:'none',fontSize:12.5,color:C.text,width:'100%',minWidth:0}}/>
        </div>
        {propietarios.length>1&&<select value={prop} onChange={e=>setProp(e.target.value)} style={selSty}><option value=''>Todos los propietarios</option>{propietarios.map(x=><option key={x} value={x}>{_nomProp(x)}</option>)}</select>}
        {D&&<button onClick={exportar} style={{fontSize:12.5,fontWeight:600,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',whiteSpace:'nowrap'}}>Excel</button>}
        {!D&&<button onClick={()=>setNuevo(v=>!v)} style={{fontSize:12.5,fontWeight:600,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',padding:0}}>+ Rol</button>}
      </div>
      {nuevo&&<div style={{borderTop:`1px solid ${C.track}`,padding:'10px 12px',display:'grid',gridTemplateColumns:D?'minmax(0,1fr) minmax(0,.7fr) minmax(0,1.3fr) minmax(0,1.3fr) auto':'1fr 1fr',gap:8,alignItems:'stretch'}}>
        {fld('Comuna',<input value={f.comuna} onChange={e=>setF(x=>({...x,comuna:e.target.value}))} style={inS}/>)}
        {fld('Rol',<input value={f.rol} onChange={e=>setF(x=>({...x,rol:e.target.value.replace(/[^\d-]/g,'')}))} placeholder='1100-60' inputMode='numeric' style={inS}/>)}
        {fld('Nombre o dirección',<input value={f.nombre} onChange={e=>setF(x=>({...x,nombre:e.target.value}))} style={inS}/>)}
        {fld('Propietario',<input value={f.propietario} onChange={e=>setF(x=>({...x,propietario:e.target.value}))} list={`prop-${sale.id}`} style={inS}/>)}
        <datalist id={`prop-${sale.id}`}>{propietarios.map(x=><option key={x} value={x}/>)}</datalist>
        <div style={{display:'flex',gap:8,alignItems:'center',justifyContent:'flex-end',gridColumn:D?undefined:'1 / -1'}}>
          <button onClick={()=>setNuevo(false)} style={{fontSize:12.5,fontWeight:600,color:C.muted,background:'none',border:'none',cursor:'pointer'}}>Cancelar</button>
          <button disabled={!listo||busy} onClick={guardar} style={{fontSize:12.5,fontWeight:700,borderRadius:9,border:'none',background:C.accent,color:'#fff',padding:'9px 13px',cursor:listo?'pointer':'default',opacity:listo&&!busy?1:.5,whiteSpace:'nowrap'}}>{busy?'Guardando…':'Guardar'}</button>
        </div>
      </div>}
      {ordenC.map(c=>{ const xs=comunas[c], sg=subgrupos(c,xs); const op=hayFiltro||ab.has('c:'+c)
        if(sg.length===1&&!sg[0][2]) return grupo('c:'+c,c,sg[0][1],0)
        return <div key={c} style={{borderTop:`1px solid ${C.track}`}}>
          <div onClick={()=>!hayFiltro&&toggle(setAb,'c:'+c)} style={{display:'flex',alignItems:'center',gap:8,padding:'10px 12px',cursor:'pointer'}}>
            <span style={{fontSize:12,color:C.textSoft,transform:op?'rotate(90deg)':'none',transition:'transform .15s'}}><Gl n='chevron'/></span>
            <span style={{fontSize:13.5,fontWeight:700,color:C.accent,flex:1,minWidth:0}}>{c}</span>
            <span style={{fontSize:12,color:C.textSoft,whiteSpace:'nowrap'}}>{xs.length} roles</span>{D&&monto(xs)}
          </div>
          {op&&sg.map(([t,ys])=>grupo(`g:${c}:${t}`,t,ys,1))}
        </div> })}
      {!lista.length&&<div style={{fontSize:12,color:C.textSoft,padding:'10px 12px',borderTop:`1px solid ${C.track}`}}>Ningún rol con esos filtros.</div>}
    </>}
  </div>)
}

