// Movido desde App.jsx por scripts/mover-a-modulo.py. Sin cambios de comportamiento.
import { useState, useEffect } from 'react'
import { supabase, getDriveToken, DEMO } from '../supabase'
import { C, Gl, Spin, appConfirm } from '../lib/base.jsx'
import { _lev, driveGet, nrmCliente, registrarError, setLearningKV } from '../lib/compartido.jsx'

export const simNombre = (a,b) => { const x=nrmCliente(a),y=nrmCliente(b); if(!x||!y) return 0; if(x===y) return 1; return 1 - _lev(x,y)/Math.max(x.length,y.length) }

export const CLIENTES_ROOT='19JsFeh9icekmXMKyubkbLxfXVujmc3eh'

export const CLIENTES_TERMINADOS_ROOT='1_wi0td0ib9QlBLjUvDkr6QzdLn1sPwGX'

export function ClienteDriveImporter({clients,onImported,onClose,onChanged}){
  const [step,setStep]=useState('loading')
  const [token,setToken]=useState(null)
  const [newClients,setNewClients]=useState([])
  const [terminados2024,setTerminados2024]=useState([])
  const [terminados2025,setTerminados2025]=useState([])
  const [selected,setSelected]=useState({})
  const [saving,setSaving]=useState(false)
  const [log,setLog]=useState([])
  const addLog=msg=>setLog(p=>[...p,msg])
  // Sincronización automática (cron / al abrir) de incorporación de clientes nuevos desde Drive.
  const [autoOn,setAutoOn]=useState(false)
  const [syncing,setSyncing]=useState(false)
  const [syncMsg,setSyncMsg]=useState(null)
  const [lastSync,setLastSync]=useState(null)

  useEffect(()=>{init();cargarSync()},[])

  async function cargarSync(){
    if(DEMO){ setLastSync({at:new Date().toISOString(),addedN:2}); setAutoOn(false); return }
    try{ const {data:cfg}=await supabase.from('learnings').select('value').eq('kind','config').eq('key','clientes_drive_sync').order('updated_at',{ascending:false}).limit(1).maybeSingle(); setAutoOn((cfg?.value||'off').trim()==='on') }catch(_){}
    try{ const {data:ls}=await supabase.from('learnings').select('value').eq('kind','config').eq('key','clientes_drive_sync_last').order('updated_at',{ascending:false}).limit(1).maybeSingle(); if(ls?.value) setLastSync(JSON.parse(ls.value)) }catch(_){}
  }
  const syncNow=async()=>{
    setSyncing(true); setSyncMsg(null)
    if(DEMO){ await new Promise(r=>setTimeout(r,700)); setSyncMsg('Demo: +2 nuevos incorporados, 3 archivados.'); setSyncing(false); return }
    try{
      // 1) Previa (dryRun): NO escribe. Muestra qué incorporaría y qué archivaría → corrida supervisada.
      const {data:prev,error:pe}=await supabase.functions.invoke('clientes-drive-sync',{body:{dryRun:true}})
      if(pe) throw pe
      if(prev?.error) throw new Error(prev.error)
      const addN=prev.wouldAddN||0, termN=prev.wouldTerminateN||0, revN=prev.needsReviewN||0
      if(!addN && !termN && !revN){ setSyncMsg('Todo al día: no hay nada nuevo que incorporar ni archivar.'); setSyncing(false); return }
      const lista=(arr,n)=>{ const a=(arr||[]).slice(0,12); return a.join(', ')+(n>a.length?` y ${n-a.length} más`:'') }
      const partes=[]
      if(addN) partes.push(`Incorporar ${addN} cliente${addN!==1?'s':''} nuevo${addN!==1?'s':''}: ${lista(prev.wouldAdd,addN)}`)
      if(termN) partes.push(`Archivar ${termN} cliente${termN!==1?'s':''} movido${termN!==1?'s':''} a Terminados: ${lista(prev.wouldTerminate,termN)}`)
      // Near-dup: carpetas que se parecen a un cliente ya existente (typo). NO se crean; se resuelven a mano abajo, en la lista de nuevos.
      if(revN){ const rl=(prev.needsReview||[]).slice(0,8).map(r=>`"${r.folder}" ≈ ${r.maybe}`).join('; '); partes.push(`Atención · ${revN} carpeta${revN!==1?'s':''} se parece${revN!==1?'n':''} a un cliente existente y NO se crearán (revísalas abajo): ${rl}${revN>8?'…':''}`) }
      if(!addN && !termN){ setSyncMsg(`Nada que incorporar ni archivar. ${revN} carpeta(s) parecida(s) a un cliente existente quedaron para revisar abajo (no se crean duplicados).`); setSyncing(false); return }
      if(!await appConfirm(`Drive propone:\n\n${partes.join('\n\n')}\n\n¿Confirmar los cambios? Es reversible.`)){ setSyncMsg('Cancelado — no se cambió nada.'); setSyncing(false); return }
      // 2) Aplicar de verdad.
      const {data,error}=await supabase.functions.invoke('clientes-drive-sync',{body:{}})
      if(error) throw error
      if(data?.error) throw new Error(data.error)
      setSyncMsg(`Listo: ${data.addedN||0} nuevo(s) incorporado(s), ${data.terminatedN||0} archivado(s).`+((data.needsReviewN||0)?` ${data.needsReviewN} parecida(s) a un cliente existente NO se crearon — revísalas abajo.`:''))
      await cargarSync(); await init(); onChanged&&onChanged()
    }catch(e){ setSyncMsg('Error al sincronizar: '+(e.message||e)) }
    setSyncing(false)
  }
  const toggleAuto=async()=>{
    const nv=!autoOn; setAutoOn(nv)
    if(DEMO) return
    try{ await setLearningKV('config','clientes_drive_sync',nv?'on':'off') }catch(_){ setAutoOn(!nv) }
  }
  // Compuerta fuzzy: la carpeta se parece a un cliente existente → vincular (aprende alias, no crea) o marcar como nuevo.
  const vincularFolder = async (f) => {
    if(!f._maybe) return
    try{ await supabase.from('learnings').insert({kind:'cliente_folder',key:nrmCliente(f.name),value:f._maybe.id}) }catch(e){registrarError({origen:'accion',vista:'learnings',err:e})}
    setNewClients(list=>list.filter(x=>x.id!==f.id))
    setSyncMsg(`"${f.name}" vinculada a ${f._maybe.name} — no se crea duplicado. La app lo recuerda.`)
  }
  const marcarNuevo = (f) => setNewClients(list=>list.map(x=>x.id===f.id?{...x,_maybe:null}:x))

  async function init(){
    setStep('loading')
    let t=localStorage.getItem('drive_token')
    if(!t){try{t=await getDriveToken()}catch(e){}}
    if(!t){setStep('notoken');return}
    setToken(t)
    try{
      // Clientes activos
      const resActivos=await driveGet(t,`https://www.googleapis.com/drive/v3/files?q='${CLIENTES_ROOT}'+in+parents+and+mimeType='application/vnd.google-apps.folder'+and+trashed=false&orderBy=name&fields=files(id,name)`)
      // Dedup ROBUSTO = mismo criterio que el edge function clientes-drive-sync: colapsa espacios y quita acentos.
      // (Antes .toLowerCase().trim() dejaba pasar "Fernando  Oliver" vs "Fernando Oliver" y "Survias" vs "Survías" → duplicados.)
      const activos=(resActivos.files||[]).filter(f=>!f.name.startsWith('1. CLIENTES'))
      const existingNames=new Set(clients.map(c=>nrmCliente(c.name)))
      // Alias aprendidos (folder→cliente): no volver a proponer lo que ya vinculaste.
      let aliasSet=new Set()
      try{ const {data:al}=await supabase.from('learnings').select('key').eq('kind','cliente_folder'); aliasSet=new Set((al||[]).map(r=>nrmCliente(r.key))) }catch(_){}
      const noExactos=activos.filter(f=>!existingNames.has(nrmCliente(f.name)) && !aliasSet.has(nrmCliente(f.name)))
      // Fuzzy: si se parece mucho a un cliente existente (typo), marcarlo como POSIBLE duplicado (compuerta), no crear a ciegas.
      const vivos=clients.filter(c=>c.status!=='Terminado')
      const nuevos=noExactos.map(f=>{ let best=null; for(const c of vivos){ const s=simNombre(f.name,c.name); if(s>=0.82 && s<1 && (!best||s>best.ratio)) best={id:c.id,name:c.name,ratio:Math.round(s*100)} } return best?{...f,_maybe:best}:f })
      setNewClients(nuevos)

      // Clientes terminados - buscar subcarpetas 2024 y 2025
      const resTerminados=await driveGet(t,`https://www.googleapis.com/drive/v3/files?q='${CLIENTES_TERMINADOS_ROOT}'+in+parents+and+mimeType='application/vnd.google-apps.folder'+and+trashed=false&orderBy=name&fields=files(id,name)`)
      const yearFolders=resTerminados.files||[]

      for(const yf of yearFolders){
        const resYear=await driveGet(t,`https://www.googleapis.com/drive/v3/files?q='${yf.id}'+in+parents+and+mimeType='application/vnd.google-apps.folder'+and+trashed=false&orderBy=name&fields=files(id,name)`)
        const yearClients=(resYear.files||[]).filter(f=>!existingNames.has(nrmCliente(f.name)))
        if(yf.name.includes('2024')) setTerminados2024(yearClients)
        if(yf.name.includes('2025')) setTerminados2025(yearClients)
      }
      setStep('review')
    }catch(e){setStep('error');addLog('Error: '+e.message)}
  }

  const toggle=(id)=>setSelected(p=>({...p,[id]:!p[id]}))
  const toggleAll=(list)=>{
    const allSelected=list.every(f=>selected[f.id])
    const upd={...selected}
    list.forEach(f=>{upd[f.id]=!allSelected})
    setSelected(upd)
  }

  const saveSelected=async()=>{
    const toImport=[...newClients,...terminados2024,...terminados2025].filter(f=>selected[f.id])
    if(!toImport.length) return
    setSaving(true);setStep('saving')
    let imported=0
    for(const f of toImport){
      const t2024=terminados2024.find(x=>x.id===f.id), t2025=terminados2025.find(x=>x.id===f.id)
      const isTerminado=t2024||t2025
      // El estado va en `status` (la tabla clients NO tiene columna `area`); los terminados quedan con fecha de término del año de su carpeta.
      const payload={name:f.name, status:isTerminado?'Terminado':'Activo'}
      if(isTerminado) payload.ended_at = (t2024?'2024':'2025')+'-12-31'
      const {error}=await supabase.from('clients').insert(payload)
      if(!error){imported++;addLog(`${f.name}`)}
      else addLog(`Error: ${f.name}: ${error.message}`)
    }
    addLog(`─────────────────`)
    addLog(`${imported} clientes importados`)
    setStep('done')
    onImported()
    setSaving(false)
  }

  const allNew=[...newClients,...terminados2024,...terminados2025]
  const selectedCount=allNew.filter(f=>selected[f.id]).length

  return (
    <div>
      {/* Sincronización con Drive: interruptor del cron + corrida manual + última corrida */}
      <div style={{background:C.bgSoft,borderRadius:10,padding:'12px 14px',marginBottom:14}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:13,fontWeight:700,color:C.accent}}>Sincronización automática</div>
            <div style={{fontSize:11,color:C.muted}}>Al abrir la app y cada 2h: incorpora los nuevos y archiva los que mueves a "1. CLIENTES TERMINADOS". Drive manda.</div>
          </div>
          <div onClick={toggleAuto} style={{width:40,height:23,borderRadius:12,background:autoOn?C.normal:C.done,position:'relative',cursor:'pointer',transition:'.15s',flexShrink:0}}>
            <div style={{position:'absolute',top:2,left:autoOn?19:2,width:19,height:19,borderRadius:'50%',background:'#fff',transition:'.15s',boxShadow:'0 1px 2px rgba(0,0,0,.2)'}}/>
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <button onClick={syncNow} disabled={syncing} style={{height:24,padding:'0 16px',background:syncing?C.done:C.accent,color:'#fff',border:'none',borderRadius:8,fontSize:13,fontWeight:600,cursor:syncing?'default':'pointer',flexShrink:0}}>{syncing?'Sincronizando…':'Sincronizar ahora'}</button>
          <div style={{flex:1,fontSize:11,color:syncMsg&&syncMsg.startsWith('Error')?C.overdue:C.muted}}>
            {syncMsg ? syncMsg : lastSync ? `Última: ${new Date(lastSync.at).toLocaleString('es-CL',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})} · +${lastSync.addedN||0} nuevos${lastSync.terminatedN?`, ${lastSync.terminatedN} archivados`:''}` : 'Aún no se ha sincronizado.'}
          </div>
        </div>
      </div>
      {step==='loading'&&<div style={{textAlign:'center',padding:20}}><Spin/><p style={{fontSize:13,color:C.muted,marginTop:12}}>Conectando con Drive...</p></div>}
      {step==='notoken'&&<div style={{textAlign:'center',padding:20}}><p style={{fontSize:13,marginBottom:16}}>Necesitas autorizar Drive.</p><button onClick={()=>getDriveToken().then(t=>{setToken(t);init()})} style={{padding:'10px 20px',borderRadius:8,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer'}}>Autorizar Drive</button></div>}
      {step==='error'&&<div style={{padding:20}}>{log.map((l,i)=><div key={i} style={{fontSize:12,color:C.overdue}}>{l}</div>)}</div>}
      {(step==='review'||step==='saving')&&(
        <div>
          {/* Posibles duplicados (compuerta fuzzy): la carpeta se parece a un cliente que ya existe → vincular o marcar nuevo */}
          {newClients.some(f=>f._maybe)&&(
            <div style={{marginBottom:16}}>
              <div style={{fontSize:12,fontWeight:700,color:C.soonText,textTransform:'uppercase',letterSpacing:.5,marginBottom:8}}>Posibles duplicados ({newClients.filter(f=>f._maybe).length})</div>
              {newClients.filter(f=>f._maybe).map(f=>(
                <div key={f.id} style={{border:`1px solid ${C.soon}`,borderRadius:10,padding:'10px 11px',marginBottom:7,background:C.soonBg}}>
                  <div style={{fontSize:13,fontWeight:700,color:C.soonText}}>{f.name}</div>
                  <div style={{fontSize:11,color:C.text,margin:'3px 0 8px'}}>Se parece a <b>{f._maybe.name}</b> ({f._maybe.ratio}%). ¿Es el mismo cliente?</div>
                  <div style={{display:'flex',gap:7}}>
                    <button onClick={()=>vincularFolder(f)} style={{flex:1,padding:'7px 10px',borderRadius:8,border:'none',background:C.accent,color:'#fff',fontSize:12,fontWeight:700,cursor:'pointer'}}>Es el mismo · vincular</button>
                    <button onClick={()=>marcarNuevo(f)} style={{padding:'7px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.muted,fontSize:12,fontWeight:600,cursor:'pointer'}}>Es nuevo</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {/* Clientes nuevos (sin parecido, o ya marcados como nuevos) */}
          {newClients.some(f=>!f._maybe)&&(
            <div style={{marginBottom:16}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                <div style={{fontSize:12,fontWeight:700,color:C.accent,textTransform:'uppercase',letterSpacing:.5}}>Clientes nuevos ({newClients.filter(f=>!f._maybe).length})</div>
                <button onClick={()=>toggleAll(newClients.filter(f=>!f._maybe))} style={{fontSize:11,color:C.accent,background:'none',border:'none',cursor:'pointer',fontWeight:600}}>{newClients.filter(f=>!f._maybe).every(f=>selected[f.id])?'Deseleccionar todos':'Seleccionar todos'}</button>
              </div>
              {newClients.filter(f=>!f._maybe).map(f=>(
                <div key={f.id} onClick={()=>toggle(f.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 10px',borderRadius:8,marginBottom:4,background:selected[f.id]?C.azulBg:C.bgSoft,cursor:'pointer',border:`1px solid ${selected[f.id]?C.accent:C.border}`}}>
                  <div style={{width:16,height:16,borderRadius:4,border:`2px solid ${selected[f.id]?C.accent:C.border}`,background:selected[f.id]?C.accent:'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                    {selected[f.id]&&<span style={{color:'#fff',fontSize:10,fontWeight:700}}><Gl n='tick'/></span>}
                  </div>
                  <span style={{fontSize:13,color:C.text}}>{f.name}</span>
                </div>
              ))}
            </div>
          )}
          {/* Terminados 2024 */}
          {terminados2024.length>0&&(
            <div style={{marginBottom:16}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                <div style={{fontSize:12,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:.5}}>Terminados 2024 ({terminados2024.length})</div>
                <button onClick={()=>toggleAll(terminados2024)} style={{fontSize:11,color:C.muted,background:'none',border:'none',cursor:'pointer',fontWeight:600}}>{terminados2024.every(f=>selected[f.id])?'Deseleccionar todos':'Seleccionar todos'}</button>
              </div>
              {terminados2024.map(f=>(
                <div key={f.id} onClick={()=>toggle(f.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 10px',borderRadius:8,marginBottom:4,background:selected[f.id]?'#F7F2EC':C.bgSoft,cursor:'pointer',border:`1px solid ${selected[f.id]?C.soon:C.border}`}}>
                  <div style={{width:16,height:16,borderRadius:4,border:`2px solid ${selected[f.id]?C.soon:C.border}`,background:selected[f.id]?C.soon:'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                    {selected[f.id]&&<span style={{color:'#fff',fontSize:10,fontWeight:700}}><Gl n='tick'/></span>}
                  </div>
                  <span style={{fontSize:13,color:C.text}}>{f.name}</span>
                  <span style={{fontSize:10,color:C.soon,fontWeight:600,marginLeft:'auto'}}>2024</span>
                </div>
              ))}
            </div>
          )}
          {/* Terminados 2025 */}
          {terminados2025.length>0&&(
            <div style={{marginBottom:16}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                <div style={{fontSize:12,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:.5}}>Terminados 2025 ({terminados2025.length})</div>
                <button onClick={()=>toggleAll(terminados2025)} style={{fontSize:11,color:C.muted,background:'none',border:'none',cursor:'pointer',fontWeight:600}}>{terminados2025.every(f=>selected[f.id])?'Deseleccionar todos':'Seleccionar todos'}</button>
              </div>
              {terminados2025.map(f=>(
                <div key={f.id} onClick={()=>toggle(f.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 10px',borderRadius:8,marginBottom:4,background:selected[f.id]?'#F7F2EC':C.bgSoft,cursor:'pointer',border:`1px solid ${selected[f.id]?C.soon:C.border}`}}>
                  <div style={{width:16,height:16,borderRadius:4,border:`2px solid ${selected[f.id]?C.soon:C.border}`,background:selected[f.id]?C.soon:'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                    {selected[f.id]&&<span style={{color:'#fff',fontSize:10,fontWeight:700}}><Gl n='tick'/></span>}
                  </div>
                  <span style={{fontSize:13,color:C.text}}>{f.name}</span>
                  <span style={{fontSize:10,color:C.soon,fontWeight:600,marginLeft:'auto'}}>2025</span>
                </div>
              ))}
            </div>
          )}
          {newClients.length===0&&terminados2024.length===0&&terminados2025.length===0&&(
            <div style={{textAlign:'center',padding:40,color:C.muted,fontSize:13}}>Todos los clientes de Drive ya están en la app</div>
          )}
          <div style={{display:'flex',gap:8,marginTop:8,position:'sticky',bottom:0,background:C.bg,paddingBottom:8}}>
            <button onClick={onClose} style={{flex:1,padding:'9px 14px',borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
            <button onClick={saveSelected} disabled={saving||selectedCount===0} style={{flex:2,padding:'9px 14px',borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',opacity:selectedCount===0?.5:1}}>
              {saving?'Importando...':`Importar ${selectedCount} cliente${selectedCount!==1?'s':''}`}
            </button>
          </div>
        </div>
      )}
      {step==='done'&&(
        <div>
          <div style={{background:C.bgSoft,borderRadius:8,padding:'10px 12px',maxHeight:200,overflowY:'auto',fontSize:12,fontFamily:'monospace',color:C.text,lineHeight:1.7,marginBottom:12}}>
            {log.map((l,i)=><div key={i}>{l}</div>)}
          </div>
          <button onClick={onClose} style={{width:'100%',padding:11,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer'}}>Cerrar</button>
        </div>
      )}
    </div>
  )
}

