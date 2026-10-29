// Movido desde App.jsx por scripts/mover-a-modulo.py. Sin cambios de comportamiento.
import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { glosaKey } from '../../supabase/functions/_shared/ventaGastoReglas.js'
import { C, Gl, SEC_LBL, _normTxt, appAlert, appConfirm, fmt, fmtFechaDMY, fmtRutCL } from '../lib/base.jsx'
import { NOMBRE_CLI, Sparkle, chipBtn, learnPut, logEvent, normRut, simTexto } from '../lib/compartido.jsx'

// ─── CONCILIACIÓN DE FACTURAS (v1: barrido de auditoría de dobles conteos) ──
// Detecta cuotas marcadas Pagado SIN N° de factura (una factura pagada real lleva folio): suelen ser
// "fantasma" que duplican una factura real (caso BM Soluciones). Agrupa por cliente, muestra la evidencia
// y deja darlas de baja (soft-delete, reversible) o marcarlas legítimas (la app aprende y no las re-muestra).
export function ConciliacionModal({billing=[], setBilling, clients=[], clientEntities=[], sales=[], currentUserName, onClose}){
  const [ignorados,setIgnorados] = useState(null)   // ids marcados "no es duplicado" (learnings)
  const [busy,setBusy] = useState(false)
  const [toast,setToast] = useState(null)
  const [chosenCand,setChosenCand] = useState({})   // {fantasmaId: facturaRealId} candidata elegida a mano
  const [expanded,setExpanded] = useState({})       // {fantasmaId: 'cuotas'|'cand'} sección abierta
  const [resueltas,setResueltas] = useState([])     // log de la sesión: {b, tipo:'baja'|'legit'} para plegar + deshacer
  const [showResueltas,setShowResueltas] = useState(false)
  const [showConc,setShowConc] = useState(false)    // sección plegable de cuotas YA conciliadas (con folio)
  const [concQ,setConcQ] = useState('')             // búsqueda dentro de Conciliadas (por cliente/glosa/folio)
  const [cardFilter,setCardFilter] = useState(null) // null='todas' · 'match' · 'revisar' · 'conc' (filtro por tarjeta de resumen)
  const [pickRS,setPickRS] = useState({})           // {cid: entityId} razón social elegida cuando el cliente tiene varias
  const [dupSigs,setDupSigs] = useState(new Set())  // firmas (cliente::glosa) de duplicados confirmados antes → suben la certeza de futuras parecidas
  useEffect(()=>{ supabase.from('learnings').select('key').eq('kind','conciliacion_ok').then(({data})=>{ setIgnorados(new Set((data||[]).map(r=>String(r.key)))) },()=>setIgnorados(new Set())) },[])
  useEffect(()=>{ supabase.from('learnings').select('meta').eq('kind','conciliacion_dup').then(({data})=>{ const s=new Set(); (data||[]).forEach(r=>{ const mm=r.meta||{}; if(mm.client_id&&mm.concept) s.add(`${mm.client_id}::${glosaKey(mm.concept)}`) }); setDupSigs(s) },()=>{}) },[])
  useEffect(()=>{ if(toast){ const t=setTimeout(()=>setToast(null),5000); return ()=>clearTimeout(t) } },[toast])
  const ig = ignorados||new Set()
  const clientById = id => clients.find(c=>String(c.id)===String(id))
  const rutDe = id => { const c=clientById(id); if(c?.rut) return c.rut; const e=(clientEntities||[]).find(x=>x.client_id===id&&x.rut); return e?.rut||'' }
  const saleTitle = sid => sales.find(s=>String(s.id)===String(sid))?.title||''
  // Folio limpio: invoice_no a veces trae la palabra "Factura" (texto). Evita "Factura Factura 261".
  const folio = no => { const s=String(no||'').trim(); return /^\d+$/.test(s)?`Factura ${s}`:s }
  const folioNum = no => String(no||'').replace(/^factura\s*/i,'').trim()||'—'
  // Sospechosas: Pagado sin folio, vivas, no reembolso, no ya marcadas legítimas.
  const sospechosas = (billing||[]).filter(b=>!b.deleted_at && b.billing_type!=='reembolso' && b.status==='Pagado' && !b.invoice_no && !ig.has(String(b.id)))
  const grupos = {}
  sospechosas.forEach(b=>{ const k=String(b.client_id||'__'); (grupos[k]=grupos[k]||[]).push(b) })
  const realesDe = cid => (billing||[]).filter(b=>!b.deleted_at && b.billing_type!=='reembolso' && String(b.client_id)===String(cid) && b.invoice_no && ['Pagado','Pendiente'].includes(b.status))
  // Análisis determinista fantasma↔factura real: por cada candidata, score 0..1 + señales por campo.
  const analizar = (b, reales) => {
    const proy = saleTitle(b.sale_id)
    const cands = reales.map(r=>{
      const montoDelta = (r.amount||0)-(b.amount||0)
      const montoIgual = Math.abs(montoDelta) <= Math.max(1000, (b.amount||0)*0.01)
      const glosaSim = Math.max(simTexto(r.concept,b.concept), simTexto(r.concept,proy))
      const mismoProy = !!(r.sale_id&&b.sale_id&&String(r.sale_id)===String(b.sale_id)) || (!!proy&&simTexto(r.concept,proy)>=0.6)
      const d1=b.paid_at?String(b.paid_at).slice(0,10):'', d2=r.paid_at?String(r.paid_at).slice(0,10):''
      const mismaFecha = !!(d1&&d2&&d1===d2)
      // Razón social / RUT también pesan en el match: misma RS (entity_id), mismo RUT o mismo nombre de receptor.
      const rRut=normRut(r.receptor_rut), bRut=normRut(b.receptor_rut)
      const mismaRS = !!((r.entity_id&&b.entity_id&&String(r.entity_id)===String(b.entity_id)) || (rRut&&bRut&&rRut===bRut) || (r.receptor_name&&b.receptor_name&&_normTxt(r.receptor_name)===_normTxt(b.receptor_name)))
      const montoScore = montoIgual?0.40:Math.max(0,0.40-Math.min(0.40,Math.abs(montoDelta)/Math.max(1,b.amount||1)))
      const score = Math.min(1, montoScore + glosaSim*0.25 + (mismoProy?0.15:0) + (mismaFecha?0.10:0) + (mismaRS?0.10:0))
      return {r, montoDelta, montoIgual, glosaSim, mismoProy, mismaFecha, mismaRS, score}
    }).sort((a,b)=>b.score-a.score)
    return cands
  }
  const dupBoost = b => (b.client_id&&b.concept&&dupSigs.has(`${b.client_id}::${glosaKey(b.concept)}`)) ? 0.15 : 0   // aprendió que esta glosa ya fue duplicado
  const scoreOf = b => { const cs=analizar(b,realesDe(b.client_id)); return Math.min(1,(cs[0]?cs[0].score:0)+dupBoost(b)) }
  const pasaFiltro = b => cardFilter==='match' ? scoreOf(b)>=0.6 : cardFilter==='revisar' ? scoreOf(b)<0.6 : true
  // Suspechosas de ALTA certeza (para acción masiva): score boosteado ≥ 0.85.
  const altaCerteza = () => sospechosas.filter(b=>!ig.has(String(b.id))&&scoreOf(b)>=0.85)
  const veredicto = sc => sc>=0.85?['Muy probable duplicado',C.overdueText,'#FCEBEB']:sc>=0.6?['Probable duplicado','#854F0B',C.soonBg]:sc>=0.4?['Posible duplicado','#854F0B',C.soonBg]:['Poco probable','#537281',C.bgSoft]
  const fmtDelta = d => (d>0?'+':'−')+fmt(Math.abs(d))
  const STOP = new Set(['de','la','el','los','las','y','del','en','por','para','con','cuota','mensual','factura','cobro','servicio','servicios','asesoria','asesoría','permanente'])
  // Resalta en la glosa las palabras que también están en la otra (comparación visual de glosas).
  const diffGlosa = (txt, ref) => { const set=new Set(_normTxt(ref||'').split(/\s+/).filter(w=>w.length>=3&&!STOP.has(w))); return String(txt||'—').split(/(\s+)/).map((w,i)=>{ const t=_normTxt(w); return (set.has(t)&&t.length>=3)?<b key={i} style={{color:C.accent,fontWeight:700}}>{w}</b>:<span key={i}>{w}</span> }) }
  const darDeBaja = async(items)=>{
    const ids=items.map(x=>x.id); if(busy||!ids.length) return; setBusy(true)
    try{
      const now=new Date().toISOString()
      const {error}=await supabase.from('billing').update({deleted_at:now}).in('id',ids)
      if(error) throw error
      if(setBilling) setBilling(p=>p.map(b=>ids.includes(b.id)?{...b,deleted_at:now}:b))
      logEvent('conciliacion','dar_de_baja',{ids,n:ids.length},currentUserName)
      // Aprende del proceso: deja registro auditable de cada duplicado confirmado (concepto/cliente/monto).
      items.forEach(b=>learnPut('conciliacion_dup', b.id, 'dup', {concept:b.concept,client_id:b.client_id,amount:b.amount}))
      setResueltas(p=>[...items.map(b=>({b,tipo:'baja'})),...p])
      setToast(`${ids.length} cuota(s) dada(s) de baja — puedes deshacer en "Ya resueltas"`)
    }catch(e){ appAlert('Error: '+e.message) }
    setBusy(false)
  }
  const deshacerBaja = async(b)=>{
    setBusy(true)
    try{ const {error}=await supabase.from('billing').update({deleted_at:null}).eq('id',b.id); if(error)throw error; if(setBilling) setBilling(p=>p.map(x=>x.id===b.id?{...x,deleted_at:null}:x)); setResueltas(p=>p.filter(r=>!(r.tipo==='baja'&&r.b.id===b.id))); setToast('Cuota restaurada') }catch(e){ appAlert('Error: '+e.message) }
    setBusy(false)
  }
  const noEsDuplicado = (b)=>{
    learnPut('conciliacion_ok', b.id, 'legit', {concept:b.concept,client_id:b.client_id})
    logEvent('conciliacion','marcar_legitima',{id:b.id},currentUserName)
    setIgnorados(p=>new Set([...(p||[]),String(b.id)]))
    setResueltas(p=>[{b,tipo:'legit'},...p])
  }
  const deshacerLegit = async(b)=>{
    try{ await supabase.from('learnings').delete().eq('kind','conciliacion_ok').eq('key',String(b.id)) }catch(e){}
    setIgnorados(p=>{ const n=new Set(p||[]); n.delete(String(b.id)); return n })
    setResueltas(p=>p.filter(r=>!(r.tipo==='legit'&&r.b.id===b.id)))
  }
  const C2 = {muted:C.muted,text:C.text,border:C.border,accent:C.accent,over:C.overdue,green:C.greenText}
  const lbl = {fontSize:9,fontWeight:600,color:C.textSoft,textTransform:'uppercase',letterSpacing:.3}
  if(ignorados===null) return <div style={{padding:30,textAlign:'center',color:C.muted,fontSize:13}}>Cargando…</div>
  const claves = Object.keys(grupos)
  // Fila comparable: valor fantasma | valor real | punto de coincidencia (verde lleno / ámbar vacío).
  const cmpRow = (left,right,ok) => (
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 14px',gap:8,padding:'6px 10px',background:ok?'#EDF7F2':'#FFFAF0',alignItems:'flex-start'}}>
      <div style={{fontSize:11,color:C.text,lineHeight:1.35,wordBreak:'break-word'}}>{left}</div>
      <div style={{fontSize:11,color:C.text,lineHeight:1.35,wordBreak:'break-word'}}>{right}</div>
      <span style={{fontSize:11,color:ok?C.greenText:C.soon,lineHeight:1.35}}>{ok?'●':'○'}</span>
    </div>
  )
  const stPillCuota = st => st==='Pagado'?['Pagada',C.greenText,'#E1F5EE']:st==='Programada'?['Programada',C.muted,C.bgSoft]:st==='Pendiente'?['Pendiente',C.accent,'#E6EEF1']:[st,C.muted,C.bgSoft]
  return (
    <div style={{maxWidth:600}}>
      <div style={{fontSize:11,color:C.muted,lineHeight:1.45,marginBottom:8}}>
        Cuotas <b style={{color:C.text}}>Pagadas sin folio</b> que pueden <b style={{color:C.text}}>Duplicar</b> una factura real. Toca una tarjeta para filtrar.
      </div>
      {(()=>{
        let conMatch=0; sospechosas.forEach(b=>{ if(scoreOf(b)>=0.6) conMatch++ })
        const aRev=sospechosas.length-conMatch
        const concCount=(billing||[]).filter(b=>!b.deleted_at&&b.billing_type!=='reembolso'&&b.invoice_no&&b.status==='Pagado').length
        const stat=(key,v,l,col,bg)=>{ const act=cardFilter===key; return (
          <button onClick={()=>{ const nk=act?null:key; setCardFilter(nk); if(nk==='conc') setShowConc(true) }} style={{flex:1,minWidth:68,background:bg,borderRadius:10,padding:'6px 8px',textAlign:'center',border:act?`2px solid ${col}`:'2px solid transparent',cursor:'pointer'}}>
            <div style={{fontSize:16,fontWeight:700,color:col,lineHeight:1.1}}>{v}</div>
            <div style={{...SEC_LBL,marginTop:1}}>{l}</div>
          </button>
        )}
        return (
          <div style={{display:'flex',gap:5,marginBottom:12}}>
            {stat(null,sospechosas.length,'Analizadas',C.text,C.bgSoft)}
            {stat('match',conMatch,'Con match',C.accent,'#E6EEF1')}
            {stat('revisar',aRev,'A revisar',aRev>0?C.overdueText:C.muted,aRev>0?C.overdueBg:C.bgSoft)}
            {stat('conc',concCount,'Conciliadas',C.greenText,'#E1F5EE')}
          </div>
        )
      })()}
      {(()=>{ const alta=altaCerteza(); if(alta.length<2) return null; const tot=alta.reduce((a,b)=>a+(b.amount||0),0); return (
        <button disabled={busy} onClick={async()=>{ if(await appConfirm(`Dar de baja ${alta.length} cuotas de alta certeza (≥85%) por ${fmt(tot)}? Van a Papelera (reversible).`)) darDeBaja(alta) }} style={{width:'100%',marginBottom:12,padding:'9px',borderRadius:10,border:`1px solid ${C.overdue}`,background:C.overdueBg,color:C.overdueText,fontSize:13,fontWeight:600,cursor:'pointer',opacity:busy?.6:1}}>Dar de baja las {alta.length} de alta certeza · {fmt(tot)}</button>
      )})()}
      {claves.length===0 && <div style={{textAlign:'center',color:C.muted,fontSize:13,padding:'28px 0'}}>Sin duplicados sospechosos. Todo en orden.</div>}
      {cardFilter!=='conc' && claves.length>0 && !claves.some(cid=>(grupos[cid]||[]).filter(pasaFiltro).length>0) && <div style={{textAlign:'center',color:C.muted,fontSize:13,padding:'22px 0'}}>Nada en esta categoría.</div>}
      {cardFilter!=='conc' && claves.map(cid=>{
        const grupoAll=(grupos[cid]||[]).filter(pasaFiltro); if(!grupoAll.length) return null
        const rsSel = pickRS[cid]||''   // '' = todas las RS; si se elige una, se filtran las cuotas a esa RS
        let grupo = rsSel ? grupoAll.filter(b=>String(b.entity_id)===String(rsSel)) : grupoAll
        if(cardFilter==='revisar') grupo = [...grupo].sort((a,b)=>scoreOf(a)-scoreOf(b))   // menor certeza primero
        const c=clientById(cid); const reales=realesDe(cid)
        const sumF=grupo.reduce((a,b)=>a+(b.amount||0),0); const sumR=reales.filter(r=>r.status==='Pagado').reduce((a,b)=>a+(b.amount||0),0)
        return (
          <div key={cid} style={{border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden',marginBottom:14}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',padding:'10px 14px',background:C.bgSoft,borderBottom:`1px solid ${C.border}`}}>
              {(()=>{
                const ents=(clientEntities||[]).filter(e=>String(e.client_id)===String(cid))
                const sel=ents.find(e=>String(e.id)===String(rsSel))
                return (<div style={{minWidth:0,flex:1}}>
                  <div style={{...NOMBRE_CLI}}>{c?.name||'Cliente'}</div>
                  {ents.length>1
                    ? <select value={rsSel} onChange={e=>setPickRS(p=>({...p,[cid]:e.target.value}))} style={{fontSize:10,color:rsSel?C.accent:C.muted,fontWeight:rsSel?600:400,border:`0.5px solid ${rsSel?C.accent:C.border}`,borderRadius:6,padding:'2px 6px',background:'#fff',marginTop:2,maxWidth:'100%'}}><option value=''>Todas las razones sociales</option>{ents.map(e=><option key={e.id} value={e.id}>{e.name}{e.rut?` · ${fmtRutCL(e.rut)}`:''}</option>)}</select>
                    : (ents[0]?<div style={{fontSize:10,color:C.textSoft,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{ents[0].name}{ents[0].rut?` | ${ents[0].rut}`:''}</div>:(rutDe(cid)?<div style={{fontSize:10,color:C.textSoft}}>{rutDe(cid)}</div>:null))}
                </div>)
              })()}
              <div style={{textAlign:'right',flexShrink:0}}><div style={lbl}>Sin folio · {grupo.length}</div><div style={{fontSize:13,fontWeight:600,color:C.overdue}}>{fmt(sumF)}</div></div>
            </div>
            {reales.length>0&&<div style={{fontSize:10,color:C.muted,padding:'6px 14px',borderBottom:`1px solid ${C.border}`}}>Facturas reales con folio del cliente: <b style={{color:C.greenText}}>{fmt(sumR)}</b> en {reales.filter(r=>r.status==='Pagado').length} pagada(s)</div>}
            {grupo.length===0&&<div style={{fontSize:11,color:C.muted,textAlign:'center',padding:'14px'}}>Esta razón social no tiene cuotas sin folio. Cambia el selector a "Todas".</div>}
            {grupo.map(b=>{
              const cands=analizar(b,reales)
              const m = chosenCand[b.id] ? (cands.find(x=>String(x.r.id)===String(chosenCand[b.id]))||cands[0]) : cands[0]
              const apr = dupBoost(b)>0   // la app aprendió que esta glosa ya fue duplicado
              const sc = m ? Math.min(1, m.score + dupBoost(b)) : 0
              const [vl,vfg,vbg] = m ? veredicto(sc) : ['Sin candidata clara','#537281',C.bgSoft]
              const otras = (billing||[]).filter(x=>!x.deleted_at&&x.billing_type!=='reembolso'&&String(x.client_id)===String(b.client_id)&&String(x.id)!==String(b.id)).sort((a,c)=>String(c.due||c.paid_at||'').localeCompare(String(a.due||a.paid_at||'')))
              const proyB = saleTitle(b.sale_id)
              return (
                <div key={b.id} style={{borderBottom:`1px solid ${C.border}`,padding:'10px 12px'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:6,marginBottom:8}}>
                    <span style={{fontSize:11,fontWeight:700,padding:'3px 10px',borderRadius:20,background:vbg,color:vfg}}>{m?`${vl} · ${Math.round(sc*100)}%`:vl}</span>
                    {apr&&<span style={{fontSize:9.5,fontWeight:700,color:C.accent,background:C.azulBg,padding:'2px 8px',borderRadius:20,whiteSpace:'nowrap'}}>aprendido <Sparkle/></span>}
                  </div>
                  {m ? (
                    <div style={{border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden'}}>
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 14px',gap:8,padding:'7px 10px',borderBottom:`1px solid ${C.border}`}}>
                        <div style={{fontSize:9,fontWeight:700,color:C.overdueText,textTransform:'uppercase',letterSpacing:.3}}>Fantasma · sin folio</div>
                        <div style={{fontSize:9,fontWeight:700,color:C.greenText,textTransform:'uppercase',letterSpacing:.3}}>{folio(m.r.invoice_no)} · folio</div>
                        <span/>
                      </div>
                      {cmpRow(diffGlosa(b.concept,m.r.concept), diffGlosa(m.r.concept,b.concept), m.glosaSim>=0.6)}
                      {cmpRow(<b style={{fontWeight:700}}>{fmt(b.amount)}</b>, <span><b style={{fontWeight:700}}>{fmt(m.r.amount)}</b>{!m.montoIgual&&m.montoDelta!==0&&<span style={{color:C.soon,fontWeight:600}}> ({fmtDelta(m.montoDelta)})</span>}</span>, m.montoIgual)}
                      {cmpRow(b.paid_at?fmtFechaDMY(b.paid_at):'—', m.r.paid_at?fmtFechaDMY(m.r.paid_at):'—', m.mismaFecha)}
                      {cmpRow(proyB||'—', saleTitle(m.r.sale_id)||'—', m.mismoProy)}
                      {(b.receptor_name||m.r.receptor_name||b.receptor_rut||m.r.receptor_rut)&&cmpRow(b.receptor_name||b.receptor_rut||'—', m.r.receptor_name||m.r.receptor_rut||'—', m.mismaRS)}
                    </div>
                  ) : (
                    <div style={{border:`1px solid ${C.border}`,borderRadius:10,padding:'9px 11px',background:'#FFFAF0'}}>
                      <div style={{display:'flex',justifyContent:'space-between',gap:8}}><span style={{fontSize:12,color:C.text}}>{b.concept||'—'}</span><b style={{fontSize:13,fontWeight:600,color:C.text}}>{fmt(b.amount)}</b></div>
                      <div style={{fontSize:10,color:C.textSoft,marginTop:2}}>Pagada {b.paid_at?fmtFechaDMY(b.paid_at):'—'} · sin folio · no encontré una factura real que calce</div>
                    </div>
                  )}
                  <div style={{display:'flex',gap:10,marginTop:8,flexWrap:'wrap'}}>
                    {reales.length>0&&<button onClick={()=>setExpanded(p=>({...p,[b.id]:p[b.id]==='cand'?null:'cand'}))} style={{fontSize:11,color:C.muted,background:'none',border:`0.5px solid ${C.border}`,borderRadius:8,padding:'4px 9px',cursor:'pointer'}}>¿Otra factura? ({reales.length}) {expanded[b.id]==='cand'?<Gl n='chevU'/>:<Gl n='chevD'/>}</button>}
                    {otras.length>0&&<button onClick={()=>setExpanded(p=>({...p,[b.id]:p[b.id]==='cuotas'?null:'cuotas'}))} style={{fontSize:11,color:C.muted,background:'none',border:`0.5px solid ${C.border}`,borderRadius:8,padding:'4px 9px',cursor:'pointer'}}>Otras cuotas del cliente ({otras.length}) {expanded[b.id]==='cuotas'?<Gl n='chevU'/>:<Gl n='chevD'/>}</button>}
                  </div>
                  {expanded[b.id]==='cand'&&(
                    <div style={{border:`0.5px solid ${C.border}`,borderRadius:8,marginTop:6,overflow:'hidden'}}>
                      {cands.map(x=>{ const sel=String((chosenCand[b.id]||(cands[0]&&cands[0].r.id)))===String(x.r.id); return (
                        <div key={x.r.id} onClick={()=>setChosenCand(p=>({...p,[b.id]:x.r.id}))} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,padding:'7px 10px',borderBottom:`0.5px solid ${C.border}`,cursor:'pointer',background:sel?C.azulBg:'#fff'}}>
                          <div style={{minWidth:0}}><div style={{fontSize:11,fontWeight:sel?700:500,color:sel?C.accent:C.text}}>{folio(x.r.invoice_no)}</div><div style={{fontSize:10,color:C.textSoft,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{x.r.concept||'—'}</div></div>
                          <div style={{textAlign:'right',flexShrink:0}}><div style={{fontSize:11,fontWeight:600,color:C.text}}>{fmt(x.r.amount)}</div><div style={{fontSize:9,color:x.score>=0.6?C.greenText:C.soon}}>{Math.round(x.score*100)}%</div></div>
                        </div>
                      )})}
                    </div>
                  )}
                  {expanded[b.id]==='cuotas'&&(
                    <div style={{border:`0.5px solid ${C.border}`,borderRadius:8,marginTop:6,overflow:'hidden',maxHeight:'34vh',overflowY:'auto'}}>
                      {otras.map(x=>{ const [sl,sc,sb]=stPillCuota(x.status); const same=Math.abs((x.amount||0)-(b.amount||0))<=Math.max(1000,(b.amount||0)*0.01); return (
                        <div key={x.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,padding:'7px 10px',borderBottom:`0.5px solid ${C.border}`}}>
                          <div style={{minWidth:0}}><div style={{fontSize:11,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{x.concept||'—'}{same&&<span style={{color:C.soon,fontWeight:600}}> · = monto</span>}</div><div style={{fontSize:9,color:C.textSoft}}>{x.invoice_no?`Factura N° ${folioNum(x.invoice_no)} · `:''}{x.status==='Pagado'?`pagada ${x.paid_at?fmtFechaDMY(x.paid_at):''}`:`vence ${x.due?fmtFechaDMY(x.due):'—'}`}</div></div>
                          <div style={{textAlign:'right',flexShrink:0,display:'flex',alignItems:'center',gap:6}}><span style={{fontSize:9.5,fontWeight:700,padding:'2px 8px',borderRadius:20,background:sb,color:sc,whiteSpace:'nowrap'}}>{sl}</span><span style={{fontSize:11,fontWeight:600,color:C.text}}>{fmt(x.amount)}</span></div>
                        </div>
                      )})}
                    </div>
                  )}
                  <div style={{display:'flex',gap:6,marginTop:8}}>
                    <button disabled={busy} onClick={()=>darDeBaja([b])} style={{...chipBtn('primary'),opacity:busy?.6:1}}>Dar de baja la fantasma</button>
                    <button onClick={()=>noEsDuplicado(b)} style={chipBtn('soft')}>No es duplicado</button>
                  </div>
                </div>
              )
            })}
            {grupo.length>1&&<div style={{padding:'10px 14px'}}><button disabled={busy} onClick={()=>darDeBaja(grupo)} style={{...chipBtn('primary'),opacity:busy?.6:1}}>Dar de baja las {grupo.length}</button></div>}
          </div>
        )
      })}
      {(()=>{
        const conc=(billing||[]).filter(b=>!b.deleted_at&&b.billing_type!=='reembolso'&&b.invoice_no&&b.status==='Pagado').sort((a,b)=>String(b.paid_at||'').localeCompare(String(a.paid_at||'')))
        if(conc.length===0) return null
        const totC=conc.reduce((a,b)=>a+(b.amount||0),0)
        const cq=concQ.trim().toLowerCase()
        const concF = cq ? conc.filter(b=>{ const cn=(clientById(b.client_id)?.name||'').toLowerCase(); return cn.includes(cq)||String(b.concept||'').toLowerCase().includes(cq)||String(b.invoice_no||'').toLowerCase().includes(cq) }) : conc
        const gC={}; concF.forEach(b=>{ const k=String(b.client_id||'__'); (gC[k]=gC[k]||[]).push(b) })
        return (
          <div style={{border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden',marginTop:4,marginBottom:8}}>
            <div onClick={()=>setShowConc(s=>!s)} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 14px',cursor:'pointer',background:'#EDF7F2'}}>
              <span style={{fontSize:12,color:C.muted}}><b style={{color:C.greenText}}>●</b> Conciliadas · con folio · <b style={{color:C.text}}>{conc.length}</b> · {fmt(totC)}</span>
              <span style={{fontSize:12,color:C.accent,fontWeight:600}}>{showConc?<>Ocultar{" "}<Gl n='chevU'/></>:<>Ver{" "}<Gl n='chevD'/></>}</span>
            </div>
            {showConc&&<div style={{maxHeight:'44vh',overflowY:'auto'}}>
              <div style={{padding:'8px 12px',borderTop:`0.5px solid ${C.border}`,position:'sticky',top:0,background:'#fff',zIndex:1}}><input value={concQ} onChange={e=>setConcQ(e.target.value)} placeholder='Buscar por cliente, glosa o folio…' style={{width:'100%',height:34,border:`1px solid ${C.border}`,borderRadius:8,padding:'0 10px',fontSize:12,color:C.text,background:C.bgSoft,colorScheme:'light',outline:'none',boxSizing:'border-box'}}/></div>
              {Object.keys(gC).length===0&&<div style={{fontSize:12,color:C.muted,textAlign:'center',padding:'16px 0'}}>Sin coincidencias.</div>}
              {Object.keys(gC).map(cid=>{ const list=gC[cid]; const c=clientById(cid); return (
                <div key={cid}>
                  <div style={{fontSize:10,fontWeight:600,color:C.textSoft,textTransform:'uppercase',letterSpacing:.3,padding:'7px 14px 3px',borderTop:`0.5px solid ${C.border}`,background:C.bgPanel}}>{c?.name||'Cliente'} · {list.length}</div>
                  {list.map(x=>(
                    <div key={x.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,padding:'7px 14px',borderTop:`0.5px solid ${C.border}`}}>
                      <div style={{minWidth:0}}><div style={{fontSize:11,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}><b style={{color:C.greenText}}>Factura N° {folioNum(x.invoice_no)}</b> · {x.concept||'—'}</div><div style={{fontSize:9,color:C.textSoft}}>Pagada {x.paid_at?fmtFechaDMY(x.paid_at):'—'}</div></div>
                      <span style={{fontSize:11,fontWeight:600,color:C.text,flexShrink:0}}>{fmt(x.amount)}</span>
                    </div>
                  ))}
                </div>
              )})}
            </div>}
          </div>
        )
      })()}
      {resueltas.length>0&&(
        <div style={{border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden',marginTop:4}}>
          <div onClick={()=>setShowResueltas(s=>!s)} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 14px',cursor:'pointer',background:C.bgSoft}}>
            <span style={{fontSize:12,color:C.muted}}>Ya resueltas en esta revisión · <b style={{color:C.text}}>{resueltas.length}</b></span>
            <span style={{fontSize:12,color:C.accent,fontWeight:600}}>{showResueltas?<>Ocultar{" "}<Gl n='chevU'/></>:<>Ver / deshacer{" "}<Gl n='chevD'/></>}</span>
          </div>
          {showResueltas&&resueltas.map((rz,i)=>(
            <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,padding:'8px 14px',borderTop:`0.5px solid ${C.border}`}}>
              <div style={{minWidth:0}}><div style={{fontSize:11,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{rz.b.concept||'—'} · {fmt(rz.b.amount)}</div><div style={{fontSize:9,color:C.textSoft}}>{rz.tipo==='baja'?'Dada de baja (en Papelera)':'Marcada legítima'}</div></div>
              <button disabled={busy} onClick={()=>rz.tipo==='baja'?deshacerBaja(rz.b):deshacerLegit(rz.b)} style={{fontSize:11,fontWeight:600,color:C.accent,background:C.azulBg,border:'none',borderRadius:8,padding:'4px 10px',cursor:'pointer',flexShrink:0}}>Deshacer</button>
            </div>
          ))}
        </div>
      )}
      {toast&&<div style={{position:'sticky',bottom:0,background:C.greenText,color:'#fff',fontSize:12,fontWeight:600,padding:'10px 12px',borderRadius:8,marginTop:8}}>{toast}</div>}
    </div>
  )
}

