// Movido desde App.jsx por scripts/mover-a-modulo.py. Sin cambios de comportamiento.
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabase'
import { C, Gl, SEC_LBL, appAlert, appConfirm, fmt, fmtRutCL, folioN } from '../lib/base.jsx'
import { Buscador, bigDate, claudeCall, estadoFacturaLabel, learnPut, matchProgEmitidas, montoFactura, rsDisplay, rsLabel, serieKey, simTexto } from '../lib/compartido.jsx'

// Tab "Financiero" de la ficha (solo admin): KPIs de facturación, historial por año,
// razones sociales, datos de facturación y relación con el estudio (edición inline)
// Asistente de conciliación: 3 pasos con compuerta humana. (1) duplicados determinista, (2) sin proyecto agrupado por serie con sugerencia, (3) programada↔real por venta+mes+tolerancia. Nada se borra/asigna solo.
export function ConciliarFacturasModal({asPage=false, scope=[], sales=[], clients=[], clientEntities=[], clientId=null, respaldoMap=null, cartolaHasta=null, anticipos=[], conciliacion=[], onResolverDupAnticipo, onResolveDup, onAssignSeries, onReplaceProgramada, onReplaceMatch, onEditBilling, onOpenClientFicha, onClose}) {
  const [tab,setTab] = useState('facturas')   // 'facturas' | 'anticipos'
  const [q,setQ] = useState('')               // buscador de cliente
  const [dismissedMatch,setDismissedMatch] = useState(()=>new Set())   // matches B descartados en esta sesión ("No es match")
  const mes = d => (d||'').slice(0,7)
  // Período: 'todo' (ordenar el histórico) o 'mes' (revisión del mes corriente: emitidas por issued_at, programadas por due).
  const [periodo,setPeriodo] = useState('todo')
  const [orden,setOrden] = useState('desc')                 // fecha: desc=nueva→antigua
  const [openCat,setOpenCat] = useState(()=>new Set(['copias','dup']))   // categorías desplegadas
  const [openCli,setOpenCli] = useState(()=>new Set())      // grupos de cliente desplegados (key: cat|cid)
  const [expItem,setExpItem] = useState(()=>new Set())      // ítems en modo "Revisar" (detalle)
  const [sel,setSel] = useState(()=>new Set())              // facturas seleccionadas (opción A) para asignar en lote
  const [done,setDone] = useState({})                       // ítems accionados → franja "hecho · Deshacer" inline (sin toast global)
  const marcarHecho = (k,u,msg) => { if(u) setDone(p=>({...p,[k]:msg?{...u,msg}:u})) }
  const deshacer1 = async (k) => { const u=done[k]; setDone(p=>{const n={...p}; delete n[k]; return n}); try{ if(u&&u.onUndo) await u.onUndo() }catch(_){} }
  const fEstado = b => onEditBilling ? estadoFacturaLabel(b,(respaldoMap&&respaldoMap[b.id])||0,cartolaHasta) : null
  const abrirFac = b => { if(onEditBilling&&b) onEditBilling(b) }
  const [matchNo,setMatchNo] = useState(null)   // pares programada|emitida descartados a mano (aprendido, persistente) — DEBE ir antes de progMatches (dep array)
  useEffect(()=>{ supabase.from('learnings').select('key').eq('kind','match_no').then(({data})=>setMatchNo(p=>new Set([...(p||[]),...(data||[]).map(r=>String(r.key))])),()=>setMatchNo(p=>p||new Set())) },[])
  const curMes = new Date().toISOString().slice(0,7)
  const inPeriodo = b => periodo==='todo' ? true : (b.status==='Programada' ? mes(b.due)===curMes : mes(b.issued_at||b.due)===curMes)
  const act = (scope||[]).filter(b=>!b.deleted_at && b.status!=='Anulada' && b.status!=='Anulado').filter(inPeriodo)
  const cName = id => (clients||[]).find(c=>String(c.id)===String(id))?.name || 'Cliente'
  const norm = s => String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')
  // Período que dice la GLOSA (ej. "Asesoría — July 2026" → 2026-07). Eje del calce: dos facturas del mismo servicio comparten período.

  // (1) Duplicados. REGLA (usuario): una factura con FOLIO REAL nunca es duplicada — la duplicada es siempre un FANTASMA (sin folio),
  // o el MISMO folio cargado dos veces. Dos facturas con folios reales DISTINTOS (aunque igual monto/fecha, ej. una cuota dividida en
  // 3 facturas iguales) NO son duplicados. Solo se eliminan fantasmas o el folio repetido; nunca una emitida real distinta.
  const dupGroups = useMemo(()=>{
    const realF = x => { const f=folioN(x.invoice_no); return (f&&/\d/.test(f))?f:null }
    const by={}; act.forEach(b=>{ const k=`${b.client_id}|${b.amount||0}|${b.due||b.issued_at||''}`; (by[k]=by[k]||[]).push(b) })
    const folioBy={}; act.forEach(b=>{ const f=realF(b); if(f){ const k=`${b.client_id}|f|${f}`; (folioBy[k]=folioBy[k]||[]).push(b) } })
    const groups=[]; const seen=new Set()
    Object.values({...by,...folioBy}).forEach(g=>{ if(g.length<2) return; const ids=g.map(x=>x.id).sort().join(','); if(seen.has(ids)) return; seen.add(ids)
      const foliosR = g.map(realF).filter(Boolean)
      // Todas con folio real y DISTINTO entre sí → facturas reales separadas, NO duplicados. Salta.
      if(foliosR.length===g.length && new Set(foliosR).size===g.length) return
      // SIEMPRE conservar la que tiene número (Factura N° XX = la real); luego Pagada, folio limpio, n° más bajo.
      const keep=[...g].sort((a,b)=>((a.invoice_no?0:1)-(b.invoice_no?0:1))||((b.status==='Pagado')-(a.status==='Pagado'))||((a.invoice_no===folioN(a.invoice_no)?0:1)-(b.invoice_no===folioN(b.invoice_no)?0:1))||(parseInt(folioN(a.invoice_no))||9e9)-(parseInt(folioN(b.invoice_no))||9e9))[0]
      // Solo se eliminan FANTASMAS (sin folio real) o las que repiten el folio del keep. Una emitida real con folio distinto NUNCA se elimina.
      const drop = g.filter(x=> x.id!==keep.id && (!realF(x) || realF(x)===realF(keep)))
      if(!drop.length) return
      const folios=[...new Set(foliosR)]
      const motivo = (folios.length===1 && drop.every(d=>realF(d)===folios[0])) ? `mismo folio N° ${folios[0]} cargado ${g.length} veces (con y sin "Factura")` : 'copia sin folio del mismo monto y vencimiento'
      groups.push({rows:[keep,...drop], keepId:keep.id, motivo}) })
    return groups
  },[scope,periodo])

  // (2) Sin proyecto, agrupadas por serie. CRUCE POR PRIORIDAD (no solo glosa): modalidad/cuotas de la venta › monto › fecha › glosa, con RAZONES explícitas.
  const serieGroups = useMemo(()=>{
    const sin = act.filter(b=>!b.sale_id && b.billing_type!=='reembolso')
    const by={}; sin.forEach(b=>{ const k=serieKey(b.concept); if(!k||k.length<4) return; (by[`${b.client_id}|${k}`]=by[`${b.client_id}|${k}`]||[]).push(b) })
    const NMatch = c => { const m=String(c||'').match(/(\d+)\s*(?:\/|-|de)\s*(\d+)/); return m?{n:+m[1],tot:+m[2]}:null }
    const MES = /(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|mensual)/i
    const ventaTotal = s => (s.amount_clp || (s.amount_uf&&s.uf_value?Math.round(s.amount_uf*s.uf_value):0) || 0)
    const cruzar = (rows, s) => {
      const razones=[]; let score=0; const cfg=s.cobro_config||{}
      const sRows = act.filter(b=>String(b.sale_id)===String(s.id))   // facturas ya ligadas a la venta (su calendario real)
      const nm = NMatch(rows[0].concept)
      if(nm && s.cobro_type==='cuotas' && Number(cfg.nCuotas)===nm.tot){ score+=4; razones.push(`modalidad cuotas (${nm.tot}), esta es ${nm.n}/${nm.tot}`) }
      else if(s.cobro_type==='mensual' && MES.test(rows[0].concept||'')){ score+=4; razones.push('modalidad mensual') }
      const amt=rows[0].amount||0
      let expected = sRows.map(b=>b.amount||0).filter(Boolean)
      if(!expected.length && s.cobro_type==='cuotas' && Number(cfg.nCuotas)) expected=[Math.round(ventaTotal(s)/Number(cfg.nCuotas))]
      if(amt && expected.some(e=>Math.abs(e-amt)/amt<=0.15)){ score+=2; razones.push('monto coincide con la cuota esperada') }
      const w=new Set(serieKey(rows[0].concept).split(' ').filter(x=>x.length>3))
      const gl=serieKey(s.title).split(' ').filter(x=>x.length>3).filter(x=>w.has(x)).length
      if(gl){ score+=Math.min(2,gl); razones.push('glosa coincide') }
      return {score, razones}
    }
    return Object.entries(by).map(([k,rows])=>{
      const cid=rows[0].client_id
      const cs=(sales||[]).filter(s=>String(s.client_id)===String(cid))
      let best=null,bestSc=0,bestRaz=[]
      cs.forEach(s=>{ const {score,razones}=cruzar(rows,s); if(score>bestSc){bestSc=score;best=s;bestRaz=razones} })
      return {cid, rows:rows.sort((a,b)=>(a.due||'').localeCompare(b.due||'')), sug:bestSc>0?best:null, razones:bestRaz, sales:cs}
    }).filter(g=>g.sales.length>0).sort((a,b)=>b.rows.length-a.rows.length)
  },[scope,sales,periodo])

  // (3) Programada ↔ real: programada con venta, busca real del mismo cliente, mismo mes (±1) y monto con tolerancia ±15%.
  // Fuente ÚNICA: mismo detector que el conteo de duplicados y el inline "Ya emitida" — así el card, esta lista y Facturas del mes coinciden.
  const progMatches = useMemo(()=> matchProgEmitidas(act, clients, clientEntities, {noSet:matchNo||new Set()}), [act,clients,clientEntities,matchNo])

  // (4) Anticipos duplicados (espejo de antDup en RevisionDatosModal): un anticipo cargado A MANO (sin respaldo
  // bancario, sin '·revisado') cuyo monto CALZA con los depósitos reales del banco del mismo cliente (la suma, o uno exacto).
  const antDup = useMemo(()=>{
    const bankIds = new Set((conciliacion||[]).filter(c=>c.tipo_destino==='anticipo' && c.anticipo_id).map(c=>String(c.anticipo_id)))
    const banksByCli = {}
    ;(anticipos||[]).filter(a=>bankIds.has(String(a.id))).forEach(a=>{ const k=String(a.client_id); (banksByCli[k]=banksByCli[k]||[]).push(a) })
    const out=[]
    ;(anticipos||[]).forEach(a=>{
      if(bankIds.has(String(a.id))) return                                   // ya tiene respaldo del banco
      if(/·revisado/.test(a.nota||'')) return                                // marcado "son distintos"
      const m=Number(a.monto)||0; if(m<=0) return
      const banks=(banksByCli[String(a.client_id)]||[])
      if(!banks.length) return
      const suma=banks.reduce((s,b)=>s+(Number(b.monto)||0),0)
      const calceSuma=Math.abs(suma-m)<=1
      const uno=banks.find(b=>Math.abs((Number(b.monto)||0)-m)<=1)
      if(calceSuma||uno) out.push({manual:a, banks:uno?[uno]:banks, suma:uno?(Number(uno.monto)||0):suma})
    })
    return out
  },[anticipos,conciliacion])

  // (0) Fantasmas: Pagado SIN folio que es copia de una real CON folio (absorbe el tool de conciliación viejo). Respeta "no es duplicado" (learnings conciliacion_ok).
  const [okIds,setOkIds] = useState(null)
  useEffect(()=>{ supabase.from('learnings').select('key').eq('kind','conciliacion_ok').then(({data})=>setOkIds(new Set((data||[]).map(r=>String(r.key)))),()=>setOkIds(new Set())) },[])
  const igOk = okIds||new Set()
  const ghosts = useMemo(()=>{
    const sosp = act.filter(b=>b.status==='Pagado' && !b.invoice_no && b.billing_type!=='reembolso' && !igOk.has(String(b.id)))
    return sosp.map(g=>{
      const reales = act.filter(r=>r.invoice_no && String(r.client_id)===String(g.client_id) && ['Pagado','Pendiente','Vencido'].includes(r.status))
      let best=null,score=0
      reales.forEach(r=>{ const a=g.amount||0; const mEq=a&&Math.abs((r.amount||0)-a)/a<=0.02?0.5:0; const gl=simTexto(r.concept,g.concept)*0.5; const sc=mEq+gl; if(sc>score){score=sc;best=r} })
      const raz=[]
      if(best){ const a=g.amount||0; if(a&&Math.abs((best.amount||0)-a)/a<=0.02) raz.push('mismo monto'); if(simTexto(best.concept,g.concept)>=0.3) raz.push('glosa parecida'); raz.push('y esta no tiene número') }
      return {g, real:best, score, razones:raz}
    }).filter(x=>x.real && x.score>=0.5).sort((a,b)=>b.score-a.score)
  },[scope,okIds,periodo])
  const marcarLegit = id => { learnPut('conciliacion_ok', String(id), '1', {}); setOkIds(p=>new Set([...(p||[]),String(id)])) }

  // Opus para series ambiguas (sin sugerencia heurística): propone la venta.
  const [aiSug,setAiSug] = useState({})
  const [aiBusy,setAiBusy] = useState(null)
  const sugerirIA = async(g,idx)=>{
    setAiBusy(idx)
    try{
      const ventas=g.sales.map(s=>`${s.id} :: ${s.title}${s.year?` (${s.year})`:''} · modalidad ${s.cobro_type||'?'}${s.cobro_config?.nCuotas?` ${s.cobro_config.nCuotas} cuotas`:''} · total $${(s.amount_clp||(s.amount_uf&&s.uf_value?Math.round(s.amount_uf*s.uf_value):0)||0).toLocaleString('es-CL')}`).join('\n')
      const concs=g.rows.slice(0,8).map(r=>`- ${r.concept} · $${(r.amount||0).toLocaleString('es-CL')}${r.issued_at?` · emitida ${r.issued_at}`:''}`).join('\n')
      const prompt=`Asistente contable de un estudio de abogados. Estas facturas no están asignadas a un proyecto (venta). ¿A cuál venta pertenecen? Cruza por PRIORIDAD: modalidad de pago y número de cuotas de la venta › monto por cuota › fecha › glosa. Si las facturas dicen "cuota X/N", deben calzar con una venta de modalidad cuotas con N cuotas. Responde SOLO con el id exacto de la venta, o la palabra ninguna.\n\nVentas del cliente:\n${ventas}\n\nFacturas:\n${concs}`
      const j=await claudeCall({model:'claude-opus-4-8',max_tokens:60,messages:[{role:'user',content:prompt}]})
      const txt=(j?.content?.[0]?.text||'').trim()
      const m=g.sales.find(s=>txt.includes(String(s.id)))
      if(m) setAiSug(p=>({...p,[idx]:m})); else appAlert('La IA no encontró una venta clara para esta serie.')
    }catch(e){ appAlert('Error IA: '+e.message) }
    setAiBusy(null)
  }

  // ── Helpers de agrupación y estilo ──
  const toggle = (setter,k) => setter(p=>{ const n=new Set(p); n.has(k)?n.delete(k):n.add(k); return n })
  const btnP = {fontSize:12,fontWeight:700,color:'#fff',background:C.accent,border:'none',borderRadius:8,padding:'7px 13px',cursor:'pointer'}
  const btnS = {fontSize:12,fontWeight:600,color:C.muted,background:'#fff',border:`0.5px solid ${C.border}`,borderRadius:8,padding:'7px 13px',cursor:'pointer'}
  const fD = iso => iso ? String(iso).slice(0,10).split('-').reverse().join('-') : '—'
  const tieneDTE = b => !!(b.sii_synced_at||b.sii_tipo_dte||b.dte_track_id)
  const cargadaPor = b => b.sii_synced_at?'SII':(b.import_batch_id?'importada':'a mano')
  const proyDe = b => { const s=(sales||[]).find(s=>String(s.id)===String(b.sale_id)); return s?s.title:'—' }
  const respaldoDe = b => (respaldoMap&&(respaldoMap[b.id]||0)>0) ? {ok:true,txt:'con respaldo'} : {ok:false,txt:'sin respaldo'}
  const montoB = b => montoFactura(b)||b.amount||0

  // Agrupa ítems {cid,date,...} por cliente, ordenados por fecha (control orden) y filtrados por buscador.
  const byCli = (items) => {
    const nq=String(q||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')
    const g={}
    items.forEach(it=>{ const cid=String(it.cid); const name=cName(it.cid); if(nq&&!name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').includes(nq)) return; if(!g[cid]) g[cid]={cid,name,items:[],_d:'',monto:0}; g[cid].items.push(it); g[cid].monto+=(it.monto||0); const d=it.date||''; if(d>g[cid]._d) g[cid]._d=d })
    const arr=Object.values(g)
    arr.forEach(grp=> grp.items.sort((a,b)=> orden==='desc'?String(b.date||'').localeCompare(String(a.date||'')):String(a.date||'').localeCompare(String(b.date||''))))
    return arr.sort((a,b)=> orden==='desc'?b._d.localeCompare(a._d):a._d.localeCompare(b._d))
  }

  // Grilla de "toda la información disponible" de una factura (para decidir con certeza cuál conservar/retirar).
  const kvFactura = (b) => { const r=respaldoDe(b); const dte=tieneDTE(b); return (
    <div style={{marginTop:8,paddingTop:8,borderTop:`1px solid ${C.border}`,display:'grid',gap:3}}>
      {[['Monto',fmt(montoB(b)),null],
        ['Folio', b.invoice_no?('N° '+folioN(b.invoice_no)):'— sin folio', b.invoice_no?null:'no'],
        ['DTE (SII)', dte?'sí':'— sin DTE', dte?'ok':'no'],
        ['Emisión', fD(b.issued_at), null],
        ['Vence', fD(b.due), null],
        ['Concepto', b.concept||'—', null],
        ['Razón social', b.receptor_name||'—', null],
        ['RUT receptor', b.receptor_rut||'—', null],
        ['Estado', b.status||'—', null],
        ['Respaldo banco', r.txt, r.ok?'ok':'no'],
        ['Proyecto', proyDe(b), null],
        ['Cargada por', cargadaPor(b), null],
      ].map(([k,v,tone],i)=>(
        <div key={i} style={{display:'flex',justifyContent:'space-between',gap:8,fontSize:11}}>
          <span style={{color:C.textSoft,whiteSpace:'nowrap'}}>{k}</span>
          <span style={{fontWeight:600,textAlign:'right',color:tone==='ok'?C.greenText:tone==='no'?C.overdueText:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{v}{tone==='ok'?<>{" "}<Gl n='tick'/></>:''}</span>
        </div>
      ))}
    </div>
  ) }

  // Lado conserva/retira con la info completa. keep=true verde, drop=rojo con folio tachado.
  const sideFactura = (b, keep) => (
    <div onClick={()=>abrirFac(b)} style={{border:`1px solid ${keep?'#9FCFBB':'#E7B7B4'}`,borderRadius:10,padding:'9px 11px',background:keep?C.greenBg:C.overdueBg,cursor:onEditBilling?'pointer':'default',minWidth:0}}>
      <span style={{fontSize:9,fontWeight:800,textTransform:'uppercase',letterSpacing:'.4px',padding:'1px 7px',borderRadius:6,display:'inline-block',marginBottom:6,color:keep?C.greenText:C.overdueText,background:'#fff'}}>{keep?'Se conserva':'Se retira'}</span>
      <div style={{fontSize:13,fontWeight:700,color:keep?C.text:C.muted,textDecoration:keep?'none':'line-through',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.invoice_no?('N° '+folioN(b.invoice_no)):'Sin folio'}</div>
      <div style={{fontSize:13,fontWeight:700,marginTop:3,color:keep?C.greenText:C.muted}}>{fmt(montoB(b))}</div>
      {kvFactura(b)}
    </div>
  )

  // Un par (conserva ↔ retira) de facturas con su tipo, razón y acción (compuerta reversible).
  const pairFactura = ({keep, drops, tipo, why, k, retire, retireLabel, secLabel, secAct}) => {
    const ex=expItem.has(k)
    return <div key={k} style={{border:`0.5px solid ${C.border}`,borderRadius:10,marginBottom:6,overflow:'hidden'}}>
      <div onClick={()=>toggle(setExpItem,k)} style={{display:'flex',alignItems:'center',gap:9,padding:'9px 10px',cursor:'pointer'}}>
        {bigDate(keep.issued_at||keep.due||(drops[0]&&(drops[0].issued_at||drops[0].due)))}
        <div style={{flex:1,minWidth:0}}><div style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'.4px',color:C.soonText}}>{tipo}</div><div style={{fontSize:13,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{keep.concept||drops[0]?.concept||'—'}</div></div>
        <span style={{fontSize:13,fontWeight:800,color:C.overdueText,whiteSpace:'nowrap'}}>{fmt(drops.reduce((s,d)=>s+montoB(d),0))}</span>
        <span style={{fontSize:11,color:C.accent,fontWeight:600,flexShrink:0,marginLeft:4}}>{ex?<Gl n='chevD'/>:<>Ver{" "}<Gl n='chevron'/></>}</span>
      </div>
      {ex&&<div style={{padding:'0 10px 11px'}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:9}}>
          {sideFactura(keep,true)}
          <div style={{display:'grid',gap:9,minWidth:0}}>{drops.map(d=><div key={d.id}>{sideFactura(d,false)}</div>)}</div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8,marginTop:9,flexWrap:'wrap'}}>
          <div style={{flex:1,minWidth:120,fontSize:11,color:C.muted}}>{why}</div>
          {secLabel&&<button onClick={secAct} style={btnS}>{secLabel}</button>}
          <button onClick={async()=>{ const u=await retire(); marcarHecho(k,u,retireLabel+' → Papelera') }} style={btnP}>{retireLabel}</button>
        </div>
      </div>}
    </div>
  }

  // Lado de un anticipo (banco = conserva, a mano = retira).
  const sideAnticipo = (a, keep) => (
    <div style={{border:`1px solid ${keep?'#9FCFBB':'#E7B7B4'}`,borderRadius:10,padding:'9px 11px',background:keep?C.greenBg:C.overdueBg,minWidth:0}}>
      <span style={{fontSize:9,fontWeight:800,textTransform:'uppercase',letterSpacing:'.4px',padding:'1px 7px',borderRadius:6,display:'inline-block',marginBottom:6,color:keep?C.greenText:C.overdueText,background:'#fff'}}>{keep?'Del banco · con respaldo':'A mano · sin respaldo'}</span>
      <div style={{fontSize:13,fontWeight:700,marginTop:1,color:keep?C.greenText:C.muted}}>{fmt(Number(a.monto)||0)}</div>
      <div style={{marginTop:8,paddingTop:8,borderTop:`1px solid ${C.border}`,display:'grid',gap:3}}>
        {[['Fecha',fD(a.fecha)],['Nota',a.nota||'—'],['Origen',keep?'banco (conciliado)':'a mano'],['Cargado por',a.created_by||'—']].map(([k,v],i)=>(
          <div key={i} style={{display:'flex',justifyContent:'space-between',gap:8,fontSize:11}}>
            <span style={{color:C.textSoft,whiteSpace:'nowrap'}}>{k}</span>
            <span style={{fontWeight:600,textAlign:'right',color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  )

  // ── Datos de las dos pestañas ──
  const facturaItems = [
    ...ghosts.map(x=>({cid:x.g.client_id, date:x.g.issued_at||x.g.due, k:'copia|'+x.g.id, monto:montoB(x.g), keep:x.real, drops:[x.g], tipo:'Copia sin folio', why:<>Mismo monto y glosa; la copia <b style={{color:C.soonText}}>no tiene folio ni DTE</b>.</>, retire:()=>onReplaceProgramada&&onReplaceProgramada(x.g.id,{silent:true}), retireLabel:'Retirar copia', secLabel:'No es copia', secAct:()=>marcarLegit(x.g.id)})),
    ...dupGroups.map(g=>{ const keep=g.rows.find(r=>r.id===g.keepId); const drops=g.rows.filter(r=>r.id!==g.keepId); const rf=folioN(keep.invoice_no); const tipo=(rf&&/\d/.test(rf)&&drops.every(d=>folioN(d.invoice_no)===rf))?('Folio repetido · N° '+rf):'Copia sin folio'; return {cid:g.rows[0].client_id, date:keep.issued_at||keep.due, k:'dup|'+g.keepId, monto:drops.reduce((s,d)=>s+montoB(d),0), keep, drops, tipo, why:g.motivo, retire:()=>onResolveDup&&onResolveDup(g.keepId,drops.map(r=>r.id),{silent:true}), retireLabel:`Retirar ${drops.length} copia${drops.length!==1?'s':''}`} }),
    ...progMatches.map(m=>({cid:m.prog.client_id, date:m.prog.due||m.prog.issued_at, k:'prog|'+m.prog.id, monto:montoB(m.prog), keep:m.real, drops:[m.prog], tipo:'Programada ya emitida', why:<>La programada <b style={{color:C.soonText}}>ya se emitió</b> como factura real → sobra la programada.</>, retire:()=>onReplaceMatch&&onReplaceMatch(m.prog.id,m.real.id,{silent:true}), retireLabel:'Retirar programada', secLabel:'No es match', secAct:()=>{ const kk=`${m.prog.id}|${m.real.id}`; learnPut('match_no',kk); setMatchNo(p=>new Set([...(p||[]),kk])) }})),
  ]
  const anticipoItems = antDup.map(x=>({cid:x.manual.client_id, date:x.manual.fecha, k:'ant|'+x.manual.id, monto:Number(x.manual.monto)||0, manual:x.manual, banks:x.banks}))

  const nFact=facturaItems.length, nAnt=anticipoItems.length
  const montoDespeja=facturaItems.reduce((s,x)=>s+(x.monto||0),0)+anticipoItems.reduce((s,x)=>s+(x.monto||0),0)
  const total=nFact+nAnt
  const items = tab==='facturas'?facturaItems:anticipoItems
  const grupos = byCli(items)

  const retirarTodasFact=async()=>{ if(!(await appConfirm(`Retirar ${nFact} duplicado${nFact!==1?'s':''} de facturas. En cada uno se CONSERVA la factura real y se retira la copia/programada (reversible). ¿Seguir?`))) return; for(const x of facturaItems){ try{ const u=await x.retire(); if(u) marcarHecho(x.k,u,x.retireLabel+' → Papelera') }catch(_){} } }

  const tabPill = (v,l,n) => <span onClick={()=>setTab(v)} style={{fontSize:13,fontWeight:700,borderRadius:10,padding:'7px 14px',cursor:'pointer',display:'inline-flex',alignItems:'center',gap:7,background:tab===v?C.accent:'#fff',color:tab===v?'#fff':C.muted,border:`1px solid ${tab===v?C.accent:C.border}`}}>{l}<span style={{fontSize:11,fontWeight:800,borderRadius:999,padding:'0 7px',background:tab===v?'rgba(255,255,255,.22)':C.overdueBg,color:tab===v?'#fff':C.overdueText}}>{n}</span></span>

  return (
    <>
      {!asPage&&<div className='qt-head' style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,borderBottom:`0.5px solid ${C.border}`,position:'sticky',top:0,background:'#fff',zIndex:2}}>
        <div style={{display:'flex',alignItems:'center',gap:9,minWidth:0}}>
          <button className='qt-volver' onClick={onClose} aria-label='Volver' style={{alignItems:'center',gap:4,background:'none',border:'none',color:C.accent,fontSize:14,fontWeight:600,cursor:'pointer',padding:'2px 6px 2px 0',flexShrink:0}}><svg width='17' height='17' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.4' strokeLinecap='round' strokeLinejoin='round'><polyline points='15 18 9 12 15 6'/></svg>Volver</button>
          <span style={{fontSize:15,fontWeight:500,color:C.text,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>Duplicados{clientId&&<><span style={{color:C.textSoft,fontWeight:400,margin:'0 7px'}}>|</span><span style={{color:C.muted,fontWeight:600}}>{cName(clientId)}</span>{(()=>{ const rs=rsLabel(clientId,clients,clientEntities); return (rs.name&&rs.name!==cName(clientId))||rs.rut||rs.multi ? <span style={{color:C.muted,fontWeight:400,fontSize:12}}> · {rs.multi?`${rs.multi} RS`:`${rsDisplay(rs.name)}${rs.rut?` · ${fmtRutCL(rs.rut)}`:''}`}</span> : null })()}</>}{!clientId&&<span style={{color:C.muted,fontWeight:400,fontSize:12,marginLeft:8}}>Todos los clientes</span>}</span>
        </div>
        <button className='qt-close' onClick={onClose} style={{width:28,height:24,borderRadius:6,border:`0.5px solid ${C.border}`,background:'#fff',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',flexShrink:0}}>
          <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='#537281' strokeWidth='2.4' strokeLinecap='round'><line x1='18' y1='6' x2='6' y2='18'/><line x1='6' y1='6' x2='18' y2='18'/></svg>
        </button>
      </div>}
      <div className='qt-body' style={{display:'flex',flexDirection:'column',gap:14}}>
        {/* Foto: cuánto hay por limpiar y cuánto se despeja */}
        {total>0&&<div style={{display:'flex',alignItems:'center',gap:16,background:'#fff',border:`1px solid ${C.border}`,borderRadius:14,padding:'14px 16px'}}>
          <div style={{fontSize:32,fontWeight:800,letterSpacing:'-1px',color:C.overdueText,lineHeight:1}}>{total}</div>
          <div style={{fontSize:13,color:C.muted,lineHeight:1.5,flex:1}}><b style={{color:C.text}}>{total} duplicado{total!==1?'s':''} por limpiar.</b> En cada uno se <b style={{color:C.text}}>conserva</b> el documento real y se <b style={{color:C.text}}>retira</b> la copia — reversible.</div>
          <div style={{textAlign:'right'}}><div style={{fontSize:18,fontWeight:800,color:C.greenText}}>{fmt(montoDespeja)}</div><div style={{...SEC_LBL}}>se despeja</div></div>
        </div>}

        {/* Tabs + orden */}
        <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
          <div style={{display:'flex',gap:6}}>{tabPill('facturas','Facturas',nFact)}{tabPill('anticipos','Anticipos',nAnt)}</div>
          <span style={{marginLeft:'auto',fontSize:10,color:C.muted}}>Fecha{[['desc','↓ recientes'],['asc','↑ antiguas']].map(([v,l])=><span key={v} onClick={()=>setOrden(v)} style={{cursor:'pointer',marginLeft:6,fontWeight:orden===v?700:400,color:orden===v?C.accent:C.muted}}>{l}</span>)}</span>
        </div>

        {/* Buscador + período (solo facturas) */}
        <div style={{display:'flex',alignItems:'center',gap:9,flexWrap:'wrap'}}>
          <div style={{flex:1,minWidth:150,display:'flex',alignItems:'center',gap:7,background:'#fff',border:`1px solid ${C.border}`,borderRadius:10,padding:'6px 11px'}}>
            <svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke={C.done} strokeWidth='2.4'><circle cx='11' cy='11' r='7'/><line x1='21' y1='21' x2='16.65' y2='16.65'/></svg>
            <input value={q} onChange={e=>setQ(e.target.value)} placeholder='Buscar cliente…' style={{border:'none',outline:'none',fontSize:13,color:C.text,background:'transparent',width:'100%'}}/>
          </div>
          {tab==='facturas'&&<div style={{display:'flex',gap:6}}>{[['todo','Histórico'],['mes','Mes']].map(([v,l])=>(
            <span key={v} onClick={()=>setPeriodo(v)} style={{fontSize:11,fontWeight:600,borderRadius:8,padding:'6px 12px',cursor:'pointer',background:periodo===v?C.accent:'#fff',color:periodo===v?'#fff':C.muted,border:`1px solid ${periodo===v?C.accent:C.border}`}}>{l}</span>
          ))}</div>}
        </div>

        {/* Franja "hecho · Deshacer" */}
        {Object.keys(done).length>0&&<div style={{display:'flex',flexDirection:'column',gap:6}}>
          {Object.entries(done).map(([k,u])=>(
            <div key={k} style={{display:'flex',alignItems:'center',gap:9,background:C.greenBg,border:`0.5px solid #BFE3D5`,borderRadius:10,padding:'9px 11px'}}>
              <span style={{flex:1,fontSize:13,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{u.msg}</span>
              <button onClick={()=>deshacer1(k)} style={{fontSize:11,fontWeight:600,color:C.accent,background:'#fff',border:`0.5px solid ${C.border}`,borderRadius:8,padding:'5px 12px',cursor:'pointer',flexShrink:0}}>Deshacer</button>
            </div>
          ))}
        </div>}

        {total===0&&Object.keys(done).length===0&&<div style={{fontSize:13,color:C.muted,padding:'14px 2px',textAlign:'center'}}>Sin duplicados: ninguna copia, folio repetido, programada ya emitida ni anticipo a mano por revisar.</div>}

        {/* Barra de lote (solo facturas) */}
        {tab==='facturas'&&nFact>0&&<div style={{display:'flex',alignItems:'center',justifyContent:'space-between',background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,padding:'10px 14px'}}>
          <div style={{fontSize:13,fontWeight:700,color:C.text}}>{nFact} factura{nFact!==1?'s':''} duplicada{nFact!==1?'s':''} <span style={{color:C.muted,fontWeight:400}}>· {grupos.length} cliente{grupos.length!==1?'s':''}</span></div>
          <button onClick={retirarTodasFact} style={{background:C.accent,color:'#fff',border:'none',borderRadius:10,padding:'8px 15px',fontSize:12,fontWeight:700,cursor:'pointer'}}>Retirar todas</button>
        </div>}

        {/* Lista agrupada por cliente */}
        {grupos.map(grp=>{ const ck=tab+'|'+grp.cid; const co=clientId?true:openCli.has(ck); return (
          <div key={grp.cid} style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
            <div onClick={()=>!clientId&&toggle(setOpenCli,ck)} style={{display:'flex',alignItems:'center',gap:11,padding:'12px 14px',cursor:clientId?'default':'pointer'}}>
              <span style={{width:34,height:34,borderRadius:'50%',background:C.accent,color:'#fff',fontSize:12,fontWeight:800,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{(grp.name||'?').split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase()}</span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:15,fontWeight:800,letterSpacing:'-.1px',color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{grp.name}</div>
                <div style={{fontSize:11,color:C.muted}}>{grp.items.length} duplicado{grp.items.length!==1?'s':''}</div>
              </div>
              <div style={{textAlign:'right',flexShrink:0}}><div style={{fontSize:14,fontWeight:800,color:C.overdueText}}>{fmt(grp.monto)}</div><div style={{...SEC_LBL}}>a retirar</div></div>
              {onOpenClientFicha&&grp.cid&&grp.cid!=='null'&&<span onClick={e=>{e.stopPropagation();onOpenClientFicha(grp.cid)}} title='Ver ficha' style={{fontSize:12,color:C.accent,fontWeight:700,cursor:'pointer',flexShrink:0}}>↗</span>}
              {!clientId&&<span style={{color:C.textSoft,fontSize:13,flexShrink:0}}>{co?<Gl n='chevD'/>:<Gl n='chevron'/>}</span>}
            </div>
            {co&&<div style={{padding:'2px 12px 12px',borderTop:`1px solid ${C.border}`}}>
              {tab==='facturas'
                ? grp.items.map(it=>pairFactura(it))
                : grp.items.map(x=>{ const ex=expItem.has(x.k); return (
                    <div key={x.k} style={{border:`0.5px solid ${C.border}`,borderRadius:10,marginBottom:6,marginTop:8,overflow:'hidden'}}>
                      <div onClick={()=>toggle(setExpItem,x.k)} style={{display:'flex',alignItems:'center',gap:9,padding:'9px 10px',cursor:'pointer'}}>
                        {bigDate(x.manual.fecha)}
                        <div style={{flex:1,minWidth:0}}><div style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'.4px',color:C.soonText}}>Anticipo a mano · calza con banco</div><div style={{fontSize:13,color:C.text}}>{x.manual.nota||'sin nota'}</div></div>
                        <span style={{fontSize:13,fontWeight:800,color:C.overdueText,whiteSpace:'nowrap'}}>{fmt(Number(x.manual.monto)||0)}</span>
                        <span style={{fontSize:11,color:C.accent,fontWeight:600,flexShrink:0,marginLeft:4}}>{ex?<Gl n='chevD'/>:<>Ver{" "}<Gl n='chevron'/></>}</span>
                      </div>
                      {ex&&<div style={{padding:'0 10px 11px'}}>
                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:9}}>
                          <div style={{display:'grid',gap:9,minWidth:0}}>{x.banks.map((b,i)=><div key={i}>{sideAnticipo(b,true)}</div>)}</div>
                          {sideAnticipo(x.manual,false)}
                        </div>
                        <div style={{fontSize:11,color:C.muted,background:C.ambarBg,borderRadius:8,padding:'8px 11px',margin:'9px 0'}}>El anticipo a mano <b style={{color:C.soonText}}>calza exacto</b> con {x.banks.length>1?'los depósitos':'el depósito'} del banco → casi seguro es el mismo dinero cargado dos veces.</div>
                        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                          <button onClick={async()=>{ if(!onResolverDupAnticipo)return; if(!(await appConfirm('Retirar el anticipo cargado a mano y dejar solo el del banco. ¿Seguir?')))return; await onResolverDupAnticipo(x.manual.id,true) }} style={btnP}>Es duplicado · dejar el del banco</button>
                          <button onClick={()=>{ if(!onResolverDupAnticipo)return; onResolverDupAnticipo(x.manual.id,false) }} style={btnS}>Son distintos</button>
                        </div>
                      </div>}
                    </div>
                  )})}
            </div>}
          </div>
        )})}
      </div>
    </>
  )
}

