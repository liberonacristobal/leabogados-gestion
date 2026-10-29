// Movido desde App.jsx por scripts/mover-a-modulo.py. Sin cambios de comportamiento.
import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase, DEMO } from '../supabase'
import { C, SEC_LBL, SIcon, appAlert, fmtFechaDMY } from '../lib/base.jsx'
import { ActBtn, PageHeader, learnPut, logActividad } from '../lib/compartido.jsx'

// Clientes › Contactos: personas encontradas en el Gmail del estudio (contactos_candidatos), revisadas por grupos
// (abogado, estado, área, tipo, función, confianza). Confirmar crea el contacto en la ficha con su función;
// descartar se aprende (contacto_descartado) y elegir el cliente de un correo enseña su dominio (dominio_cliente).
export const FUN_CONTACTO = {decision:'Decisión',administracion:'Administración y contabilidad',gestion:'Gestión',asistente:'Asistente',familia:'Familia',asesor:'Asesor externo',sin_definir:'Sin definir'}

export const FUN_CONTACTO_ORD = Object.keys(FUN_CONTACTO)

export const _MAIL_GENERICO = /^(gmail|hotmail|outlook|yahoo|icloud|live|me|proton|gmx|aol)\b/

export const _DEMO_CANDIDATOS = [
  { id:'cc1', email:'gerencia@comercialandes.cl', nombre:'Paula Ríos', client_id:'c1', rol:'cliente', funcion:'decision', cargo:'Gerente General', fuentes:['firma: «Gerente General»'], recibe:['Informativo estratégico','Propuestas y reportes'], confianza:'alta', posibles:[], estado:'propuesto', evidencia:{hilos:14,ultimo:'2026-10-18'} },
  { id:'cc2', email:'contabilidad@comercialandes.cl', nombre:'Contabilidad Andes', client_id:'c1', rol:'cliente', funcion:'administracion', cargo:null, fuentes:['casilla «contabilidad@»','recibe facturas desde la app'], recibe:['Informativo técnico-contable','Facturas y cobranza'], confianza:'alta', posibles:[], estado:'propuesto', evidencia:{hilos:9,ultimo:'2026-10-02'} },
  { id:'cc3', email:'jperez@contadoresasociados.cl', nombre:'Jorge Pérez', client_id:'c1', rol:'asesor', funcion:'asesor', cargo:'Contador', fuentes:['envía documentos contables'], recibe:['Informativo técnico-contable'], confianza:'media', posibles:[], estado:'propuesto', evidencia:{hilos:4,ultimo:'2026-09-20'} },
  { id:'cc4', email:'socio@riofrio.cl', nombre:'Andrés Riofrío', client_id:'c2', rol:'cliente', funcion:'decision', cargo:'Socio', fuentes:['firma: «Socio»'], recibe:['Informativo estratégico'], confianza:'alta', posibles:[], estado:'registrado', evidencia:{hilos:22,ultimo:'2026-10-20'} },
  { id:'cc5', email:'finanzas@riofrio.cl', nombre:'Carla Soto', client_id:'c2', rol:'cliente', funcion:'administracion', cargo:'Jefa de Finanzas', fuentes:['firma: «Jefa de Finanzas»'], recibe:['Informativo técnico-contable','Rendiciones y fondos'], confianza:'alta', posibles:[], estado:'propuesto', evidencia:{hilos:6,ultimo:'2026-10-11'} },
  { id:'cc6', email:'abogado@bancodelsur.cl', nombre:'Banco del Sur', client_id:'c2', rol:'contraparte', funcion:'sin_definir', cargo:null, fuentes:[], recibe:[], confianza:'media', posibles:[], estado:'propuesto', evidencia:{hilos:3,ultimo:'2026-08-30'} },
  { id:'cc7', email:'mvaldes@gmail.com', nombre:'María Valdés', client_id:null, rol:'desconocido', funcion:'sin_definir', cargo:null, fuentes:[], recibe:[], confianza:'baja', posibles:['Tech Araucanía SpA','Viñedos del Maipo Ltda'], estado:'propuesto', evidencia:{hilos:2,ultimo:'2026-07-14'} },
  { id:'cc8', email:'admin@vinedosmaipo.cl', nombre:'Administración Viñedos', client_id:'c5', rol:'cliente', funcion:'administracion', cargo:null, fuentes:['casilla «admin@»'], recibe:['Facturas y cobranza'], confianza:'media', posibles:[], estado:'propuesto', evidencia:{hilos:5,ultimo:'2026-10-07'} },
]

export function ContactosClientes({isDesktop, clients=[], sales=[], user, onBack, origen, onOpenClientFicha, onBuscarGmail}){
  const D=isDesktop
  const [rows,setRows]=useState(null), [ficha,setFicha]=useState([])
  const [F,setF]=useState({ab:'',st:'',ar:'',tipo:'',fun:'',cf:'',rev:'pend'})
  const [q,setQ]=useState(''), [sel,setSel]=useState(null), [verDet,setVerDet]=useState(false), [lote,setLote]=useState(null), [busy,setBusy]=useState(false)
  const [cerrados,setCerrados]=useState({}), [funPick,setFunPick]=useState({}), [cliPick,setCliPick]=useState({})
  const cargar=useCallback(()=>{ if(DEMO){ setRows(_DEMO_CANDIDATOS); return }
    supabase.from('contactos_candidatos').select('*').order('created_at').limit(5000).then(({data})=>setRows(data||[]),()=>setRows([]))
    supabase.from('contacts').select('client_id,email,funcion').then(({data})=>setFicha((data||[]).filter(c=>c.email)),()=>{}) },[])
  useEffect(()=>{ cargar() },[cargar])
  const cli=useMemo(()=>Object.fromEntries(clients.map(c=>[String(c.id),c])),[clients])
  const areasCli=useMemo(()=>{ const m={}; (sales||[]).forEach(s=>{ if(s.client_id&&s.area&&!s.deleted_at){ const k=String(s.client_id); (m[k]=m[k]||new Set()).add(s.area) } }); return m },[sales])
  const wrap=ch=><div style={D?{maxWidth:1280,margin:'0 auto',padding:'12px 20px 40px'}:{padding:'8px 16px 40px'}}>{ch}</div>
  const header=<PageHeader origen={origen||'Clientes'} onBack={onBack} titulo='Contactos' right={onBuscarGmail&&!DEMO?<ActBtn onClick={onBuscarGmail} title='Buscar personas nuevas en tu Gmail'>Buscar en Gmail</ActBtn>:null} style={{margin:D?'-12px -20px 12px':'-8px -16px 12px'}}/>
  if(rows===null) return wrap(<>{header}<div style={{fontSize:12,color:C.muted,padding:'10px 2px'}}>Cargando…</div></>)

  const SIN='__sin'
  const kCli=r=>r.client_id&&cli[String(r.client_id)]?String(r.client_id):SIN
  const nomCli=k=>k===SIN?'Por asignar cliente':(cli[k]?.name||'—')
  const abDe=k=>k===SIN?SIN:(cli[k]?.abogado_responsable||'Sin asignar')
  const arDe=k=>[...(areasCli[k]||[])].sort()
  const est=r=>r.estado==='propuesto'?'':r.estado==='descartado'?'no':'ok'
  const fn=r=>funPick[r.id]||r.funcion||'sin_definir'
  const _n=t=>String(t||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')
  const qq=_n(q.trim())
  const pasaCli=(r,sinAb)=>{ const k=kCli(r); return (sinAb||!F.ab||abDe(k)===F.ab)&&(!F.st||cli[k]?.status===F.st)&&(!F.ar||(F.ar==='-'?k!==SIN&&!arDe(k).length:arDe(k).includes(F.ar))) }
  const pasaPer=(r,conRev=true)=>(!F.tipo||r.rol===F.tipo)&&(!F.fun||fn(r)===F.fun)&&(!F.cf||r.confianza===F.cf)&&(!conRev||F.rev===''||(F.rev==='pend'?!est(r):est(r)===F.rev))
  const pasaQ=r=>!qq||_n(`${nomCli(kCli(r))} ${r.nombre||''} ${r.email} ${(r.posibles||[]).join(' ')}`).includes(qq)
  const filtrar=(sinAb,conRev=true)=>rows.filter(r=>pasaCli(r,sinAb)&&pasaPer(r,conRev)&&pasaQ(r))

  // Cifras: lo confirmado y lo que ya estaba en la ficha cuentan; la base son los clientes del estudio (sin internos ni colaboradores).
  const base=clients.filter(c=>!c.is_internal&&!c.is_colaborador), enBase=new Set(base.map(c=>String(c.id)))
  const vivos=[...ficha.map(c=>({k:String(c.client_id),f:c.funcion})), ...rows.filter(r=>est(r)==='ok'&&r.client_id).map(r=>({k:String(r.client_id),f:fn(r)}))].filter(x=>enBase.has(x.k))
  const nCli=f=>new Set(vivos.filter(x=>!f||x.f===f).map(x=>x.k)).size
  const nPend=rows.filter(r=>!est(r)).length
  const kpis=[['Por revisar',nPend,'en Gmail'],['Con correo',nCli(),`clientes de ${base.length}`],['Decisión',nCli('decision'),'clientes identificados'],['Administración',nCli('administracion'),'clientes identificados']]

  const sinAbF=filtrar(true)
  const AB_ORD=[...new Set(['Cristóbal','Erasmo','Martín',...base.map(c=>c.abogado_responsable).filter(Boolean),'Sin asignar',SIN])]
  const abChips=[['', 'Todos', sinAbF.length], ...AB_ORD.map(a=>[a, a===SIN?'Por asignar cliente':a, sinAbF.filter(r=>abDe(kCli(r))===a).length]).filter(x=>x[2]||F.ab===x[0])]
  const areasOpc=[...new Set(Object.values(areasCli).flatMap(s=>[...s]))].sort((a,b)=>a.localeCompare(b,'es'))
  const SELS=[
    ['st','Estado',[['','Todos'],['Activo','Activo'],['Prospecto','Prospecto'],['Terminado','Terminado']]],
    ['ar','Área',[['','Todas'],...areasOpc.map(a=>[a,a]),['-','Sin área']]],
    ['tipo','Tipo',[['','Todos'],['cliente','Del cliente'],['asesor','Asesor'],['desconocido','Sin clasificar'],['contraparte','Contraparte']]],
    ['fun','Función',[['','Todas'],...FUN_CONTACTO_ORD.map(k=>[k,FUN_CONTACTO[k]])]],
    ['cf','Confianza',[['','Todas'],['alta','Alta'],['media','Media'],['baja','Baja']]],
    ['rev','Revisión',[['pend','Por revisar'],['ok','Confirmados'],['no','Descartados'],['','Todos']]],
  ]
  const setFil=(k,v)=>{ setF(p=>({...p,[k]:v})); setLote(null) }

  const rs=filtrar(false)
  const g={}; rs.forEach(r=>{ const k=kCli(r); (g[k]=g[k]||[]).push(r) })
  const porAb={}; Object.keys(g).forEach(k=>{ const a=abDe(k); (porAb[a]=porAb[a]||[]).push(k) })
  const orden=AB_ORD.filter(a=>porAb[a]).flatMap(a=>porAb[a].sort((x,y)=>nomCli(x).localeCompare(nomCli(y),'es')))
  const selK=sel&&g[sel]?sel:(D?orden[0]||null:null)
  const pendDe=k=>rows.filter(r=>kCli(r)===k&&!est(r)).length

  // Escritura: confirmar en lote (contactos nuevos en una sola inserción), descartar, deshacer, asignar cliente.
  const quien=user?.name||user?.email||'Oficina'
  const confirmables=lst=>lst.filter(r=>!est(r)&&kCli(r)!==SIN&&r.rol!=='contraparte')
  const confirmar=async lst=>{ const ok=confirmables(lst); if(!ok.length||busy) return; setBusy(true)
    const now=new Date().toISOString(); let hechos=0
    try{
      const ids={}
      if(!DEMO){
        const cids=[...new Set(ok.map(r=>r.client_id))]
        for(let i=0;i<cids.length;i+=100){ const {data}=await supabase.from('contacts').select('id,client_id,email').in('client_id',cids.slice(i,i+100)); (data||[]).forEach(c=>{ if(c.email) ids[`${c.client_id}|${String(c.email).trim().toLowerCase()}`]=c.id }) }
        const campos=r=>({rol:r.rol==='asesor'?'asesor':'cliente',funcion:fn(r),funcion_fuente:(r.fuentes||[]).join(' · ')||null,recibe:r.recibe?.length?r.recibe:null,origen:r.origen||'gmail',verificado_por:quien,verificado_at:now})
        const nuevos=ok.filter(r=>!ids[`${r.client_id}|${r.email.toLowerCase()}`])
        for(let i=0;i<nuevos.length;i+=200){
          const {data,error}=await supabase.from('contacts').insert(nuevos.slice(i,i+200).map(r=>({client_id:r.client_id,nombre:(r.nombre||r.email.split('@')[0]).trim(),email:r.email,cargo:r.cargo||null,...campos(r)}))).select('id,client_id,email')
          if(error) throw error
          ;(data||[]).forEach(c=>{ ids[`${c.client_id}|${String(c.email).trim().toLowerCase()}`]=c.id })
        }
        const upd=ok.map(r=>({id:r.id,email:r.email,estado:'confirmado',funcion:fn(r),contact_id:ids[`${r.client_id}|${r.email.toLowerCase()}`]||null,revisado_por:quien,revisado_at:now,updated_at:now}))
        for(let i=0;i<upd.length;i+=200){ const {error}=await supabase.from('contactos_candidatos').upsert(upd.slice(i,i+200),{onConflict:'id'}); if(error) throw error }
      }
      const okIds=new Set(ok.map(r=>r.id))
      setRows(p=>p.map(x=>okIds.has(x.id)?{...x,estado:'confirmado',funcion:fn(x),contact_id:ids[`${x.client_id}|${x.email.toLowerCase()}`]||x.contact_id}:x)); hechos=ok.length
      logActividad('contactos.confirmados',{tabla:'contactos_candidatos',detalle:{title:`${hechos} contacto${hechos!==1?'s':''} confirmado${hechos!==1?'s':''} en la ficha de su cliente`,n:hechos}})
    }catch(e){ appAlert('No se pudo confirmar: '+(e.message||e)); cargar() }
    setBusy(false); setLote(null) }
  const descartar=async lst=>{ const ok=lst.filter(r=>!est(r)); if(!ok.length||busy) return; setBusy(true)
    const now=new Date().toISOString()
    try{
      if(!DEMO){
        const ids=ok.map(r=>r.id)
        for(let i=0;i<ids.length;i+=200){ const {error}=await supabase.from('contactos_candidatos').update({estado:'descartado',revisado_por:quien,revisado_at:now,updated_at:now}).in('id',ids.slice(i,i+200)); if(error) throw error }
        supabase.from('learnings').insert(ok.map(r=>({kind:'contacto_descartado',key:r.email,value:'descartado',meta:{}}))).then(()=>{},()=>{})
      }
      const okIds=new Set(ok.map(r=>r.id)); setRows(p=>p.map(x=>okIds.has(x.id)?{...x,estado:'descartado'}:x))
      logActividad('contactos.descartados',{tabla:'contactos_candidatos',detalle:{title:`${ok.length} persona${ok.length!==1?'s':''} descartada${ok.length!==1?'s':''} de la base de contactos`,n:ok.length}})
    }catch(e){ appAlert('No se pudo descartar: '+(e.message||e)) }
    setBusy(false); setLote(null) }
  const deshacer=async r=>{ if(busy) return; setBusy(true)
    try{
      if(!DEMO){
        if(r.estado==='confirmado'&&r.contact_id) await supabase.from('contacts').delete().eq('id',r.contact_id).eq('origen',r.origen||'gmail')
        if(r.estado==='descartado') await supabase.from('learnings').delete().eq('kind','contacto_descartado').eq('key',r.email)
        const {error}=await supabase.from('contactos_candidatos').update({estado:'propuesto',contact_id:null,revisado_por:null,revisado_at:null,updated_at:new Date().toISOString()}).eq('id',r.id); if(error) throw error
      }
      setRows(p=>p.map(x=>x.id===r.id?{...x,estado:'propuesto',contact_id:null}:x))
      logActividad('contactos.deshecho',{tabla:'contactos_candidatos',id:r.id,detalle:{title:`${r.email}: vuelve a por revisar`}})
    }catch(e){ appAlert('No se pudo deshacer: '+(e.message||e)) }
    setBusy(false) }
  const asignarCli=async(r,cid)=>{ if(!cid) return
    const dom=r.email.split('@')[1]||''
    if(!DEMO){ const {error}=await supabase.from('contactos_candidatos').update({client_id:cid,rol:r.rol==='desconocido'?'cliente':r.rol,updated_at:new Date().toISOString()}).eq('id',r.id); if(error){ appAlert('No se pudo guardar: '+error.message); return }
      if(dom&&!_MAIL_GENERICO.test(dom)) learnPut('dominio_cliente',dom,cid,{}) }
    setRows(p=>p.map(x=>x.id===r.id?{...x,client_id:cid,rol:x.rol==='desconocido'?'cliente':x.rol}:x))
    logActividad('contactos.cliente_asignado',{tabla:'contactos_candidatos',id:r.id,detalle:{title:`${r.email} → ${nomCli(String(cid))}`}}) }
  const esDelCliente=async r=>{ if(!DEMO){ const {error}=await supabase.from('contactos_candidatos').update({rol:'cliente',updated_at:new Date().toISOString()}).eq('id',r.id); if(error){ appAlert('No se pudo guardar: '+error.message); return } }
    setRows(p=>p.map(x=>x.id===r.id?{...x,rol:'cliente'}:x)) }
  const aRed=async r=>{ if(busy) return; setBusy(true)
    try{ if(!DEMO){ const dom=r.email.split('@')[1]||''; const {error}=await supabase.from('red_profesional').insert({nombre:(r.nombre||r.email.split('@')[0]).trim(),email:r.email,web:dom&&!_MAIL_GENERICO.test(dom)?dom:null}); if(error) throw error
        await supabase.from('contactos_candidatos').update({estado:'descartado',revisado_por:quien,revisado_at:new Date().toISOString(),evidencia:{...(r.evidencia||{}),destino:'red_profesional'}}).eq('id',r.id) }
      setRows(p=>p.map(x=>x.id===r.id?{...x,estado:'descartado'}:x)); logActividad('contactos.a_red',{tabla:'contactos_candidatos',id:r.id,detalle:{title:`${r.email} → Red profesional`}})
    }catch(e){ appAlert('No se pudo guardar en la red: '+(e.message||e)) }
    setBusy(false) }

  // Presentación
  const card={background:C.card,border:`1px solid ${C.border}`,borderRadius:12}
  const lblSty={...SEC_LBL,fontSize:9.5}
  const btnPri={fontSize:12,fontWeight:700,border:'none',borderRadius:8,padding:'7px 12px',background:C.accent,color:'#fff',cursor:'pointer',whiteSpace:'nowrap'}
  const btnSec={fontSize:12,fontWeight:600,border:`1px solid ${C.border}`,borderRadius:8,padding:'6px 11px',background:C.card,color:C.accent,cursor:'pointer',whiteSpace:'nowrap'}
  const btnTxt={fontSize:12,fontWeight:600,border:'none',background:'none',color:C.muted,padding:'7px 4px',cursor:'pointer',whiteSpace:'nowrap'}
  const activos=clients.filter(c=>!c.is_internal&&c.status!=='Terminado').sort((a,b)=>String(a.name).localeCompare(String(b.name),'es'))

  const pend=rs.filter(r=>!est(r)), conf=confirmables(rs), nCliL=new Set(pend.map(kCli)).size, quedan=pend.length-conf.length
  const loteBox=<div style={{...card,display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',padding:'8px 12px',marginBottom:12,fontSize:12.5,color:C.text}}>
    {!pend.length? <span style={{flex:1}}>{filtrar(false,false).length?'Grupo revisado.':'Sin personas con estos filtros.'}</span>
    : lote? <>
        <span style={{flex:'1 1 220px',minWidth:0}}>{lote==='ok'?<>Confirmar <b style={{color:C.accent}}>{conf.length}</b> en la ficha de su cliente{quedan?` · ${quedan} sin cliente o contraparte quedan por revisar`:''}</>:<>Descartar <b style={{color:C.accent}}>{pend.length}</b> persona{pend.length!==1?'s':''}</>}</span>
        <button disabled={busy||(lote==='ok'&&!conf.length)} onClick={()=>lote==='ok'?confirmar(pend):descartar(pend)} style={{...btnPri,opacity:busy?.6:1}}>{busy?'Guardando…':lote==='ok'?`Confirmar ${conf.length}`:`Descartar ${pend.length}`}</button>
        <button onClick={()=>setLote(null)} style={btnTxt}>Cancelar</button>
      </>
    : <>
        <span style={{flex:'1 1 220px',minWidth:0}}><b style={{color:C.accent}}>{pend.length}</b> por revisar en este grupo · {nCliL} cliente{nCliL!==1?'s':''}</span>
        <button disabled={!conf.length} onClick={()=>setLote('ok')} style={{...btnSec,opacity:conf.length?1:.5}}>Confirmar el grupo</button>
        <button onClick={()=>setLote('no')} style={btnTxt}>Descartar el grupo</button>
      </>}
  </div>

  const lista=<div style={{...card,overflow:'hidden'}}>
    {orden.length? AB_ORD.filter(a=>porAb[a]).map((a,ai)=>{ const ks=porAb[a], cerrado=!!cerrados[a]; return <div key={a}>
      <div onClick={()=>setCerrados(p=>({...p,[a]:!p[a]}))} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,padding:'9px 13px',background:C.bgSoft,borderTop:ai?`1px solid ${C.border}`:'none',cursor:'pointer'}}>
        <span style={{...SEC_LBL}}>{a===SIN?'Por asignar cliente':a}</span>
        <span style={{fontSize:11.5,color:C.muted}}>{ks.length} cliente{ks.length!==1?'s':''} {cerrado?'▸':'▾'}</span>
      </div>
      {!cerrado&&ks.map(k=>{ const p=pendDe(k), on=selK===k; return <div key={k} onClick={()=>{ setSel(k); setVerDet(true); if(!D) window.scrollTo(0,0) }} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 13px',borderTop:`1px solid ${C.track}`,cursor:'pointer',background:on&&D?C.azulBg:'transparent'}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:13.5,fontWeight:600,color:C.accent,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{nomCli(k)}</div>
          <div style={{fontSize:11.5,color:C.muted,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{k===SIN?'Elige el cliente de cada correo':[cli[k]?.status,...arDe(k)].filter(Boolean).join(' · ')||'—'} · {g[k].length} en el filtro</div>
        </div>
        <span style={{fontSize:12,fontWeight:600,whiteSpace:'nowrap',color:p?C.soonText:C.greenText,fontVariantNumeric:'tabular-nums'}}>{p?`${p} por revisar`:'Revisado'}</span>
      </div> })}
    </div> }) : <div style={{padding:'28px 16px',textAlign:'center',fontSize:13,color:C.muted}}>Sin clientes con estos filtros.</div>}
  </div>

  const fila=(r,i)=>{ const e=est(r), f=fn(r), ev=r.evidencia||{}, k=kCli(r)
    const evTxt=(r.fuentes||[]).length?r.fuentes.join(' · '):[ev.hilos?`${ev.hilos} hilo${ev.hilos!==1?'s':''}`:ev.correos?`${ev.correos} correo${ev.correos!==1?'s':''}`:null, ev.ultimo?`último ${fmtFechaDMY(ev.ultimo)}`:null].filter(Boolean).join(' · ')
    const otros=(r.posibles||[]).length>1?`También calza con: ${r.posibles.filter(n=>n!==nomCli(k)).join(', ')}`:''
    const dot={alta:C.greenText,media:C.soon,baja:C.textSoft}[r.confianza]||C.textSoft
    const txtSty={fontSize:11,color:C.muted,whiteSpace:D?'nowrap':'normal',overflow:'hidden',textOverflow:'ellipsis'}
    const acc = r.estado==='registrado' ? <span style={{fontSize:11.5,fontWeight:600,color:C.greenText,whiteSpace:'nowrap'}}>Ya en la ficha</span>
      : e ? <><span style={{fontSize:11.5,fontWeight:600,color:e==='ok'?C.greenText:C.muted,whiteSpace:'nowrap'}}>{e==='ok'?'Confirmado':'Descartado'}</span><button disabled={busy} onClick={()=>deshacer(r)} style={btnTxt}>Deshacer</button></>
      : k===SIN ? <><select value={cliPick[r.id]||''} onChange={ev2=>{ setCliPick(p=>({...p,[r.id]:ev2.target.value})); asignarCli(r,ev2.target.value) }} style={{fontSize:12,color:C.text,border:`1px solid ${C.border}`,borderRadius:8,padding:'6px 8px',background:C.surface,minWidth:0,flex:D?'0 1 200px':'1 1 auto',maxWidth:D?200:'none'}}><option value=''>Elige el cliente</option>{activos.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><button disabled={busy} onClick={()=>aRed(r)} style={btnTxt}>→ Red</button><button disabled={busy} onClick={()=>descartar([r])} style={btnTxt}>Descartar</button></>
      : r.rol==='contraparte' ? <><button disabled={busy} onClick={()=>esDelCliente(r)} style={btnSec}>Es del cliente</button><button disabled={busy} onClick={()=>descartar([r])} style={btnTxt}>Descartar</button></>
      : <><select value={f} onChange={ev2=>setFunPick(p=>({...p,[r.id]:ev2.target.value}))} title='Función' style={{fontSize:12,color:C.accent,border:`1px solid ${C.border}`,borderRadius:8,padding:'6px 6px',background:C.surface,minWidth:0,flex:D?'0 1 170px':'1 1 auto',maxWidth:D?170:'none'}}>{FUN_CONTACTO_ORD.map(x=><option key={x} value={x}>{FUN_CONTACTO[x]}</option>)}</select><button disabled={busy} onClick={()=>confirmar([r])} style={btnPri}>Confirmar</button><button disabled={busy} onClick={()=>descartar([r])} style={btnTxt}>Descartar</button></>
    return <div key={r.id} style={{display:'flex',alignItems:'center',gap:D?12:8,rowGap:6,flexWrap:'wrap',padding:D?'10px 14px':'10px 12px',borderTop:i?`1px solid ${C.track}`:'none'}}>
      <div style={{flex:'1 1 240px',minWidth:0,opacity:e?.6:1}}>
        <div style={{fontSize:13.5,fontWeight:600,color:C.text,whiteSpace:D?'nowrap':'normal',overflow:'hidden',textOverflow:'ellipsis'}}>{r.nombre||r.email.split('@')[0]}{r.cargo?` · ${r.cargo}`:''}</div>
        <div style={{fontSize:12,color:C.azulInfo,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.email}</div>
        {(otros||evTxt)&&<div style={txtSty}>{otros||evTxt}</div>}
        {r.rol!=='contraparte'&&(r.recibe||[]).length>0&&<div style={{...txtSty,color:C.accent}}>Recibe: {r.recibe.join(' · ')}</div>}
      </div>
      <span style={{fontSize:11,color:C.muted,whiteSpace:'nowrap',display:'flex',alignItems:'center',gap:5,width:D?56:'auto'}}><span style={{width:6,height:6,borderRadius:'50%',background:dot}}/>{r.confianza?r.confianza[0].toUpperCase()+r.confianza.slice(1):'—'}</span>
      <div style={{display:'flex',gap:6,alignItems:'center',flexShrink:0,justifyContent:'flex-end',marginLeft:'auto',width:D?'auto':'100%'}}>{acc}</div>
    </div> }

  const det=(()=>{ if(!selK) return <div style={{...card,padding:'28px 16px',textAlign:'center',fontSize:13,color:C.muted}}>Elige un cliente.</div>
    const ps=rows.filter(r=>kCli(r)===selK&&pasaQ(r)&&pasaPer(r,false)&&(F.rev==='pend'||F.rev===''||est(r)===F.rev))
    const altas=confirmables(rows.filter(r=>kCli(r)===selK&&r.confianza==='alta'))
    const fg={}; ps.forEach(r=>{ const k=r.rol==='contraparte'?'contraparte':fn(r); (fg[k]=fg[k]||[]).push(r) })
    const m=cli[selK]
    return <div style={{minWidth:0}}>
      {!D&&<button onClick={()=>setVerDet(false)} style={{...btnTxt,color:C.accent,fontSize:13,padding:'0 0 10px'}}>‹ Clientes</button>}
      <div style={{display:'flex',alignItems:'flex-start',gap:10,flexWrap:'wrap',marginBottom:6}}>
        <div style={{flex:D?1:'1 1 100%',minWidth:0}}>
          <div onClick={selK!==SIN&&onOpenClientFicha?()=>onOpenClientFicha(selK):undefined} title={selK!==SIN?'Ver ficha del cliente':undefined} style={{fontSize:18,fontWeight:800,color:C.accent,cursor:selK!==SIN?'pointer':'default'}}>{nomCli(selK)}</div>
          <div style={{fontSize:12,color:C.muted,marginTop:2}}>{selK===SIN?'Elige el cliente de cada correo antes de confirmarlo':[m?.abogado_responsable,m?.status,...arDe(selK)].filter(Boolean).join(' · ')}</div>
        </div>
        {altas.length>0&&<button disabled={busy} onClick={()=>confirmar(altas)} style={btnPri}>Confirmar {altas.length} de confianza alta</button>}
      </div>
      {[...FUN_CONTACTO_ORD,'contraparte'].filter(k=>fg[k]).map(k=><div key={k}>
        <div style={{...SEC_LBL,display:'flex',justifyContent:'space-between',margin:'12px 2px 6px'}}><span>{k==='contraparte'?'Contraparte':FUN_CONTACTO[k]}</span><span style={{color:C.muted,fontWeight:600}}>{fg[k].length}</span></div>
        <div style={{...card,overflow:'hidden'}}>{fg[k].sort((a,b)=>(({alta:0,media:1,baja:2}[a.confianza]??3)-({alta:0,media:1,baja:2}[b.confianza]??3))||((b.evidencia?.hilos||0)-(a.evidencia?.hilos||0))).map(fila)}</div>
      </div>)}
      {!ps.length&&<div style={{...card,padding:'24px 16px',textAlign:'center',fontSize:13,color:C.muted,marginTop:10}}>Sin personas con estos filtros en este cliente.</div>}
    </div> })()

  const revisados=rows.filter(r=>est(r)).length
  return wrap(<>
    {header}
    {(D||!verDet)&&<>
      <div style={{display:'grid',gridTemplateColumns:D?'repeat(4,minmax(0,1fr))':'repeat(2,minmax(0,1fr))',gap:10,marginBottom:12}}>
        {kpis.map(([l,v,s])=><div key={l} style={{...card,padding:'11px 14px',minWidth:0}}>
          <div style={{...SEC_LBL,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{l}</div>
          <div style={{fontSize:24,fontWeight:800,color:C.text,fontVariantNumeric:'tabular-nums',lineHeight:1.2}}>{v}</div>
          <div style={{fontSize:11.5,color:C.muted,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{s}</div>
        </div>)}
      </div>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
        <div style={{display:'flex',gap:6,overflowX:'auto',flex:1,minWidth:0,scrollbarWidth:'none'}}>
          {abChips.map(([k,l,n])=>{ const on=F.ab===k; return <button key={k||'todos'} onClick={()=>{ setFil('ab',k); setSel(null) }} style={{fontSize:12.5,fontWeight:600,borderRadius:20,padding:'6px 13px',border:`1px solid ${on?C.accent:C.border}`,background:on?C.accent:C.card,color:on?'#fff':C.muted,cursor:'pointer',whiteSpace:'nowrap',flexShrink:0}}>{l} <span style={{fontWeight:500,opacity:.8}}>{n}</span></button> })}
        </div>
        {D&&<span style={{fontSize:12.5,color:C.muted,whiteSpace:'nowrap'}}>Revisados <b style={{color:C.text}}>{revisados}</b> de <b style={{color:C.text}}>{rows.length}</b></span>}
      </div>
      <div style={{display:'grid',gridTemplateColumns:D?'repeat(6,minmax(0,1fr))':'repeat(2,minmax(0,1fr))',gap:6,marginBottom:8}}>
        {SELS.map(([k,l,ops])=>{ const act=F[k]&&!(k==='rev'&&F[k]==='pend'); return <label key={k} style={{background:C.card,border:`1px solid ${act?C.accent:C.border}`,borderRadius:8,padding:'4px 9px 5px',minWidth:0,display:'block'}}>
          <span style={{...lblSty,display:'block',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{l}</span>
          <select value={F[k]} onChange={e=>setFil(k,e.target.value)} style={{width:'100%',border:'none',outline:'none',background:'none',fontSize:12.5,color:C.text,padding:0,cursor:'pointer'}}>{ops.map(([v,t])=><option key={v} value={v}>{t}</option>)}</select>
        </label> })}
      </div>
      <div style={{display:'flex',alignItems:'center',gap:6,background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:'7px 10px',marginBottom:10}}>
        <SIcon n='search' s={14} c={C.done}/>
        <input value={q} onChange={e=>{ setQ(e.target.value); setLote(null) }} placeholder='Buscar cliente, persona o correo' style={{border:'none',background:'none',outline:'none',fontSize:12.5,color:C.text,width:'100%',minWidth:0}}/>
      </div>
      {!D&&<div style={{fontSize:12.5,color:C.muted,margin:'0 2px 8px'}}>Revisados <b style={{color:C.text}}>{revisados}</b> de <b style={{color:C.text}}>{rows.length}</b></div>}
      {loteBox}
    </>}
    {D ? <div style={{display:'grid',gridTemplateColumns:'340px minmax(0,1fr)',gap:14,alignItems:'start'}}>{lista}{det}</div>
       : (verDet&&selK ? det : lista)}
  </>)
}

