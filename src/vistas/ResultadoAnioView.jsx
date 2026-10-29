// Movido desde App.jsx por scripts/mover-a-modulo.py. Sin cambios de comportamiento.
import { useState, useEffect, useMemo, Fragment } from 'react'
import { supabase, selectAll, DEMO } from '../supabase'
import { fgCliente } from '../../supabase/functions/_shared/gastosReglas.js'
import { C, Gl, appAlert, fmt } from '../lib/base.jsx'
import { KpiIco, MESES, MES_C, esPPMcosto, fmtMill, fmtMillLR, margenPct, redondearPartes, repartoFondos, resultadoMes, tonoMargen, useFuentesResultado } from '../lib/compartido.jsx'

// ── Página "Resultado del año" (tab resultadoAnio, en Oficina). Ingresos (facturación SII propia neta de NC + subarriendo) − egresos (planilla real oficina_costos_mensual + comisiones). Cifras desde fuentes de verdad: SII (sii_cargas_docs) + planilla editable. Cada bloque se expande (NC cliqueables). Filtros Año / Por mes. Responsive. ──
export function ResultadoAnioView({ billing=[], terceros=[], costosOfiRows=[], isDesktop=true, onBack, user, expenses=[], clients=[] }){
  const curY=new Date().getFullYear(), curM=new Date().getMonth()+1
  // Salud de datos › Fondos de clientes: el reparto por fondo (repartoFondos) debe sumar el saldo de la ficha (fgCliente), cliente por cliente.
  // Una sola pasada por los gastos, agrupados por cliente (ambas funciones filtran por cliente: mismo resultado); se recalcula solo si cambian.
  const fondosChk = useMemo(()=>{ const by={}; (expenses||[]).forEach(e=>{ if(e&&e.client_id) (by[e.client_id]=by[e.client_id]||[]).push(e) })
    const ids=Object.keys(by), desc=ids.filter(cid=>Math.round(repartoFondos(by[cid],cid).saldo)!==Math.round(fgCliente(by[cid],cid).saldo)).map(cid=>(clients||[]).find(c=>String(c.id)===String(cid))?.name||'cliente')
    return {n:ids.length, desc} },[expenses,clients])
  const [yr,setYr]=useState(curY)
  const [scope,setScope]=useState('ytd')
  const [selM,setSelM]=useState(curM)
  const [open,setOpen]=useState('ing')   // bloque abierto: 'ing' | 'cos' | 'com' | null
  const [ncOpen,setNcOpen]=useState(false)
  const [sinEnlOpen,setSinEnlOpen]=useState(false)   // Salud de datos: despliegue inline de facturas SII sin enlazar
  const [ventas,setVentas]=useState([]); const [cm,setCm]=useState([])
  const [editM,setEditM]=useState(null)   // mes en edición (1-12) o null
  const [form,setForm]=useState({})
  const [busy,setBusy]=useState(false)
  const [reloadN,setReloadN]=useState(0)
  useEffect(()=>{ if(DEMO){ setVentas([]); setCm([]); return } let v=true
    selectAll(()=>supabase.from('sii_cargas_docs').select('tipo_dte,monto,fecha_emision,folio,receptor_name,billing_id').order('id')).then(({data})=>{ if(v&&data) setVentas(data) },()=>{})
    supabase.from('oficina_costos_mensual').select('*').eq('anio',yr).then(({data})=>{ if(v&&data) setCm(data) },()=>{})
    return ()=>{v=false} },[yr,reloadN])
  const MESES=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
  const yrs=(()=>{ const s=new Set([curY]); (ventas||[]).forEach(d=>{ const y=parseInt(String(d.fecha_emision||'').slice(0,4),10); if(y) s.add(y) }); return [...s].sort((a,b)=>b-a) })()
  const pad=m=>`${yr}-${String(m).padStart(2,'0')}`
  const extBillIds=useMemo(()=>new Set((terceros||[]).filter(t=>t&&t.comision_pct!=null&&t.billing_id).map(t=>String(t.billing_id))),[terceros])
  const maxM=yr<curY?12:curM
  const months=scope==='mes'?[selM]:Array.from({length:maxM},(_,i)=>i+1)
  const cmBy=useMemo(()=>{ const m={}; (cm||[]).forEach(r=>{ m[r.mes]=r }); return m },[cm])
  const vMes=m=>(ventas||[]).filter(d=>String(d.fecha_emision||'').startsWith(pad(m)))
  // FUENTE ÚNICA: cada mes sale de resultadoMes (la misma del Estado de resultados y del Inicio); el año es la suma de sus meses.
  const bTipo=useMemo(()=>{ const m={}; (billing||[]).forEach(b=>{ if(b) m[String(b.id)]=b.billing_type||'honorarios' }); return m },[billing])
  const fuB=useFuentesResultado()   // quién paga con boleta (miembros), para las remuneraciones desde el banco
  const rmes=useMemo(()=>{ const fuY={sii:ventas||[],plan:cm||[],boleta:fuB.boleta}, deps={billing,terceros,costosOfiRows,expenses,clients}, o={}
    for(let m=1;m<=maxM;m++) o[m]=resultadoMes(fuY,deps,pad(m)); return o },[ventas,cm,fuB,billing,terceros,costosOfiRows,expenses,clients,yr,maxM])   // eslint-disable-line react-hooks/exhaustive-deps
  const R=(m,k)=>Number(rmes[m]?.[k])||0
  // Desglose de la facturación propia (cuadra con resultadoMes.fac): emitida sin facturas de gastos ni de subarriendo − NC − externos.
  const propiaDoc=d=>!['reembolso','subarriendo'].includes(bTipo[String(d.billing_id)])
  const emitidaMes=m=>vMes(m).filter(d=>[33,34].includes(Number(d.tipo_dte))&&propiaDoc(d)).reduce((a,d)=>a+(Number(d.monto)||0),0)
  const ncMes=m=>vMes(m).filter(d=>Number(d.tipo_dte)===61).reduce((a,d)=>a+(Number(d.monto)||0),0)
  const terMes=m=>vMes(m).filter(d=>[33,34].includes(Number(d.tipo_dte))&&propiaDoc(d)&&extBillIds.has(String(d.billing_id))).reduce((a,d)=>a+(Number(d.monto)||0),0)
  const S=(fn)=>months.reduce((a,m)=>a+fn(m),0)
  const emitida=S(emitidaMes), nc=S(ncMes), terc=S(terMes)
  const facturacion=S(m=>R(m,'fac'))
  const cl=(k)=>months.reduce((a,m)=>{ const r=cmBy[m]; return a+(r?Number(r[k])||0:0) },0)
  const sueldos=cl('sueldos'), cotiz=cl('cotizaciones'), ppm=S(m=>R(m,'ppm')), contadora=cl('contadora'), arriendo=cl('arriendo'), ggcc=cl('gastos_comunes'), honor=cl('honorarios'), otrosC=cl('otros_costos')
  const subarr=S(m=>R(m,'sub')), rex=S(m=>R(m,'rex')), comis=S(m=>R(m,'com'))
  const gvarMes=m=>R(m,'gv')
  const gvar=S(gvarMes)
  const costosOper=S(m=>R(m,'cos'))                               // planilla SIN PPM (o presupuesto) + gastos varios
  const ingresos=S(m=>R(m,'ing'))
  const egresos=costosOper+comis
  const resultado=S(m=>R(m,'res'))
  const margenV=margenPct(resultado,ingresos), margen=margenV==null?null:Math.round(margenV)
  const ncList=months.flatMap(m=>vMes(m).filter(d=>Number(d.tipo_dte)===61).map(d=>({folio:d.folio,rec:d.receptor_name,monto:Number(d.monto)||0,ext:!d.billing_id})))
  const estim=months.some(m=>cmBy[m]&&cmBy[m].estimado)
  const fmtM=n=>(n<0?'−':'+')+fmtMill(Math.abs(n))
  const fmtMp=n=>fmtMill(Math.abs(n))
  const titulo=scope==='mes'?`${MESES[selM-1]} ${yr}`:(yr<curY?`${yr} completo`:`Enero–${MESES[maxM-1]} ${yr}`)
  const nCerrados=Array.from({length:maxM},(_,i)=>i+1).filter(m=>cmBy[m]&&cmBy[m].cerrado).length
  const CAMPOS=[['sueldos','Sueldos'],['cotizaciones','Cotizaciones'],['ppm','PPM'],['contadora','Contadora'],['arriendo','Arriendo'],['gastos_comunes','Gastos comunes'],['honorarios','Honorarios'],['otros_costos','Otros'],['subarriendo','Subarriendo (ingreso)'],['comisiones','Comisiones']]
  const mesEstado=m=>{ const r=cmBy[m]; if(r&&r.cerrado) return 'cerrado'; if(r&&r.estimado) return 'estimado'; if(r) return 'abierto'; return 'vacio' }
  const EST_COL={cerrado:C.greenText,estimado:C.soonText,abierto:C.done,vacio:C.border}
  const abrirEditor=m=>{ const r=cmBy[m]||{}; const f={}; CAMPOS.forEach(([k])=>f[k]=r[k]!=null?Number(r[k]):0); f.nota=r.nota||''; f.estimado=!!r.estimado; f.cerrado=!!r.cerrado; setForm(f); setEditM(m) }
  // Cierre AUTOMÁTICO por criterio (sin botón): un mes se cierra solo cuando (1) ya es ≥ día 15 del mes siguiente —pasó el 13, cuando se paga la previsión (Previred), el costo que llega más tarde; margen para que cargue la cartola—, (2) tiene datos reales (sueldos+cotizaciones+PPM >0) y (3) no está marcado estimado. Verificado contra las fechas reales de la cartola 2026. El único control humano es el toggle "estimado". Reversible: marcar estimado reabre. Un barrido diario (pg_cron) lo aplica por el paso del tiempo; aquí se decide también al guardar.
  const cierreDisponible=m=> new Date() >= new Date(yr, m, 15)   // día 15 del mes SIGUIENTE a M (new Date mes es 0-based: índice m = mes m+1)
  const cumpleCierre=(m,v)=> cierreDisponible(m) && !v.estimado && Number(v.sueldos)>0 && Number(v.cotizaciones)>0 && Number(v.ppm)>0
  const guardar=async()=>{ if(DEMO){ setEditM(null); return } setBusy(true); try{
    const auto=cumpleCierre(editM, form)
    const prev=cmBy[editM]
    const p={estudio_id:'lea',anio:yr,mes:editM,nota:form.nota||null,estimado:!!form.estimado,updated_at:new Date().toISOString(),
      cerrado:auto, cerrado_at:auto?((prev&&prev.cerrado_at)||new Date().toISOString()):null, cerrado_por:auto?((prev&&prev.cerrado_por)||'auto'):null}
    CAMPOS.forEach(([k])=>p[k]=Math.round(Number(form[k])||0))
    const {error}=await supabase.from('oficina_costos_mensual').upsert(p,{onConflict:'estudio_id,anio,mes'}); if(error) throw error
    setEditM(null); setReloadN(n=>n+1)
  }catch(e){ appAlert('No se pudo guardar: '+(e.message||e)) } setBusy(false) }

  const card={background:'#fff',border:`1px solid ${C.border}`,borderRadius:16,marginBottom:9,overflow:'hidden'}
  const seg=(val,set,opts)=><span style={{display:'inline-flex',background:C.bgSoft,border:`1px solid ${C.border}`,borderRadius:20,overflow:'hidden'}}>{opts.map(([v,l])=><span key={v} onClick={()=>set(v)} style={{fontSize:11,fontWeight:700,padding:'7px 14px',cursor:'pointer',background:val===v?C.accent:'transparent',color:val===v?'#fff':C.muted}}>{l}</span>)}</span>
  const chev=o=><svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke={C.done} strokeWidth='2.4' strokeLinecap='round' strokeLinejoin='round' style={{transform:o?'rotate(90deg)':'none',transition:'.2s'}}><path d='m9 18 6-6-6-6'/></svg>
  const row=(l,v,s,col)=><div style={{display:'flex',alignItems:'center',gap:10,padding:'8px 2px',borderTop:`1px solid ${C.bgSoft}`,fontSize:12.5}}><span style={{color:C.text,fontWeight:600}}>{l}{s?<span style={{color:C.textSoft,fontSize:10.5,fontWeight:500,marginLeft:6}}>{s}</span>:null}</span><span style={{marginLeft:'auto',fontWeight:700,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap',color:col||C.accent}}>{v}</span></div>
  const sec=(id,icBg,icCol,icPath,ti,sub,amt,amtCol,body)=><div style={card}>
    <div onClick={()=>setOpen(open===id?null:id)} style={{padding:'14px 16px',display:'flex',alignItems:'center',gap:12,cursor:'pointer'}}>
      <span style={{width:36,height:36,borderRadius:11,background:icBg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke={icCol} strokeWidth='2.1' strokeLinecap='round' strokeLinejoin='round'>{icPath}</svg></span>
      <span style={{minWidth:0}}><span style={{fontSize:13.5,fontWeight:800,color:C.accent,display:'block'}}>{ti}</span><span style={{fontSize:11,color:C.textSoft}}>{sub}</span></span>
      <span style={{marginLeft:'auto',fontSize:17,fontWeight:800,letterSpacing:-.3,fontVariantNumeric:'tabular-nums',color:amtCol}}>{amt}</span>
      <span style={{flexShrink:0}}>{chev(open===id)}</span>
    </div>
    {open===id&&<div style={{padding:'0 16px 14px'}}>{body}</div>}
  </div>

  // Editor de un mes como PÁGINA (no modal): reemplaza la vista con su propio "← Resultado del año".
  if(editM!=null) return (
  <div style={{maxWidth:isDesktop?720:'100%',margin:'0 auto',padding:isDesktop?'0 20px 48px':'0 16px 48px'}}>
    <div style={{display:'flex',alignItems:'center',gap:11,margin:'4px 0 16px',flexWrap:'wrap'}}>
      <button onClick={()=>!busy&&setEditM(null)} style={{display:'flex',alignItems:'center',gap:6,background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:13,fontWeight:700,padding:0}}><svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round'><path d='M19 12H5'/><path d='m12 19-7-7 7-7'/></svg>Resultado del año</button>
      <h1 style={{fontSize:isDesktop?21:19,fontWeight:800,color:C.accent,letterSpacing:-.5,margin:0}}>Costos de {MESES[editM-1]} {yr}</h1>
      {cmBy[editM]&&cmBy[editM].cerrado?<span style={{fontSize:9.5,fontWeight:800,textTransform:'uppercase',letterSpacing:.3,color:C.greenText,background:C.greenBg,borderRadius:20,padding:'3px 9px'}}>Cerrado</span>:null}
    </div>
    <div style={card}>
      <div style={{fontSize:11,color:C.textSoft,padding:'14px 16px 2px'}}>Montos en pesos. El subarriendo es ingreso (baja el costo neto).</div>
      <div style={{padding:'4px 16px 10px'}}>
        {CAMPOS.map(([k,l])=><div key={k} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 0',borderTop:`1px solid ${C.bgSoft}`}}>
          <span style={{fontSize:13,color:k==='subarriendo'?C.greenText:C.text,fontWeight:600,flex:1}}>{l}</span>
          <input type='number' value={form[k]==null?0:form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))} style={{width:isDesktop?180:140,fontSize:13.5,fontWeight:700,textAlign:'right',border:`1px solid ${C.border}`,borderRadius:8,padding:'8px 10px',color:C.accent}}/>
        </div>)}
        <div style={{padding:'11px 0 4px',borderTop:`1px solid ${C.bgSoft}`}}><textarea placeholder='Nota (opcional)' value={form.nota||''} onChange={e=>setForm(f=>({...f,nota:e.target.value}))} rows={2} style={{width:'100%',fontSize:12.5,border:`1px solid ${C.border}`,borderRadius:8,padding:'8px 10px',resize:'vertical',fontFamily:'inherit',color:C.text,boxSizing:'border-box'}}/></div>
        <label style={{display:'flex',alignItems:'center',gap:8,fontSize:13,color:C.text,fontWeight:600,padding:'8px 0 2px',cursor:'pointer'}}><input type='checkbox' checked={!!form.estimado} onChange={e=>setForm(f=>({...f,estimado:e.target.checked}))}/> Marcar como estimado (datos aún no confirmados)</label>
      </div>
    </div>
    <button disabled={busy} onClick={guardar} style={{width:'100%',fontSize:14,fontWeight:700,border:'none',borderRadius:12,padding:'13px',marginTop:12,background:C.accent,color:'#fff',cursor:busy?'default':'pointer',opacity:busy?.6:1}}>Guardar</button>
    <div style={{fontSize:11,color:C.textSoft,marginTop:11,lineHeight:1.55,padding:'0 2px'}}>{cmBy[editM]&&cmBy[editM].cerrado
      ? <>Mes cerrado{cmBy[editM].cerrado_por?` · ${cmBy[editM].cerrado_por==='auto'?'automático':cmBy[editM].cerrado_por}`:''}{cmBy[editM].cerrado_at?' · '+String(cmBy[editM].cerrado_at).slice(0,10):''}. Marca "estimado" para reabrirlo.</>
      : <>Se cierra solo cuando los datos están completos (sueldos, cotizaciones y PPM) y pasó el 15 del mes siguiente. Marca "estimado" si aún no son definitivos.</>}</div>
  </div>)

  return (
  <div style={{maxWidth:isDesktop?1120:'100%',margin:'0 auto',padding:isDesktop?'0 20px 48px':'0 16px 48px'}}>
    <div style={{display:'flex',alignItems:'center',gap:11,margin:'4px 0 14px',flexWrap:'wrap'}}>
      <button onClick={onBack} style={{display:'flex',alignItems:'center',gap:6,background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:13,fontWeight:700,padding:0}}><svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round'><path d='M19 12H5'/><path d='m12 19-7-7 7-7'/></svg>Oficina</button>
      <h1 style={{fontSize:isDesktop?21:19,fontWeight:800,color:C.accent,letterSpacing:-.5,margin:0}}>Resultado del año</h1>
      <span style={{flex:1}}/>
      <select value={yr} onChange={e=>setYr(parseInt(e.target.value,10))} style={{fontSize:12,fontWeight:700,border:`1px solid ${C.border}`,borderRadius:20,padding:'6px 10px',background:C.azulBg,color:C.accent,cursor:'pointer'}}>{yrs.map(y=><option key={y} value={y}>{y}</option>)}</select>
      {seg(scope,setScope,[['ytd','Año'],['mes','Por mes']])}
    </div>

    {scope==='mes'&&<div style={{display:'flex',gap:6,overflowX:'auto',padding:'1px 1px 11px'}}>{Array.from({length:maxM},(_,i)=>i+1).map(m=><button key={m} onClick={()=>setSelM(m)} style={{flex:'0 0 auto',fontSize:11,fontWeight:700,padding:'6px 12px',borderRadius:20,cursor:'pointer',whiteSpace:'nowrap',border:`1px solid ${selM===m?C.accent:C.border}`,background:selM===m?C.accent:'#fff',color:selM===m?'#fff':C.muted}}>{MESES[m-1]}</button>)}</div>}

    {/* Molde Oficina / Estado de resultados (18-10): 4 tarjetas de color (las mismas de Oficina) + 3 bloques blancos que se abren
        en su cascada (+ − = con redondeo que cuadra) + comparativa mensual como la del Estado de resultados (cada mes:
        Ingresos − Costos − Comisiones = Resultado). Misma fuente: resultadoMes por mes. */}
    {(()=>{
      const num={fontVariantNumeric:'tabular-nums'}
      const kLbl={fontSize:isDesktop?10.5:9.5,fontWeight:700,letterSpacing:isDesktop?.5:.3,textTransform:'uppercase',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}
      const kt=(k,ic,[bg,fg],lab,val,sub,on,{sel,chev,big=true}={})=>{ const blanco=bg===C.card; return <div key={k} onClick={on} className='pv-c' style={{background:bg,border:`${sel?1.5:1}px solid ${sel?C.accent:(blanco?C.border:'transparent')}`,borderRadius:12,padding:isDesktop?'14px 14px':'11px 10px',display:'flex',gap:isDesktop?12:8,alignItems:'center',minWidth:0,cursor:on?'pointer':'default'}}>
        {(isDesktop||big)&&<KpiIco n={ic} c={fg} soft={blanco}/>}
        <div style={{minWidth:0,flex:1}}><div style={{...kLbl,color:fg}}>{lab}</div><div style={{fontSize:isDesktop?(big?26:22):(big?20:18),fontWeight:800,color:fg,letterSpacing:-.6,marginTop:2,whiteSpace:'nowrap',...num}}>{val}</div>{sub&&<div style={{fontSize:11,color:fg,opacity:.85,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{sub}</div>}</div>
        {chev&&<span style={{color:C.done,fontSize:13}}>{sel?<Gl n='chevU'/>:<Gl n='chevD'/>}</span>}</div> }
      const sgn=v=>(v<0?'−':'')+fmtMill(Math.abs(v)), sgnLR=v=>(v<0?'−':'')+fmtMillLR(Math.abs(v))
      const egr=costosOper+comis
      const per=scope==='mes'?`${MESES[selM-1]} ${yr}`:(yr<curY?`${yr} completo`:`ene–${MES_C[maxM-1]} ${yr}`)
      const estadoP=scope==='mes'?((cmBy[selM]&&cmBy[selM].cerrado)?'cerrado':'provisorio'):(yr<curY?'cerrado':'al día')
      const grid4={display:'grid',gridTemplateColumns:isDesktop?'repeat(4,minmax(0,1fr))':'repeat(2,minmax(0,1fr))',gap:8}
      const tRes=resultado>=0?[C.greenBg,C.greenText]:[C.overdueBg,C.overdueText]
      const card={background:C.card,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden',minWidth:0,marginTop:8}
      // Fila de cascada (mismo patrón que el Estado de resultados): signo · etiqueta · cifra; tot = fila «=» gris azulada.
      const ln=({k,sg='',l,v,tot,on,open:op,est})=><div key={k} onClick={on} className={on?'er-c':undefined} style={{display:'flex',alignItems:'center',gap:7,padding:'8px 14px',borderTop:tot?`1.5px solid ${C.accent}`:`1px solid ${C.bgSoft}`,background:tot?'#EDF1F4':undefined,fontSize:12.5,cursor:on?'pointer':'default'}}>
        <span style={{width:12,flexShrink:0,textAlign:'center',fontSize:13,fontWeight:700,color:tot?C.accent:C.muted}}>{sg}</span>
        <span style={{flex:1,minWidth:0,fontWeight:tot?800:600,color:(on||tot)?C.accent:C.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{l}{est&&<span style={{fontSize:9.5,fontWeight:700,color:C.soonText,background:C.soonBg,borderRadius:20,padding:'1px 7px',marginLeft:6}}>est.</span>}{op!==undefined&&<span style={{color:C.textSoft,marginLeft:5}}>{op?<Gl n='chevU'/>:<Gl n='chevD'/>}</span>}</span>
        <span style={{fontWeight:tot?800:700,minWidth:72,textAlign:'right',whiteSpace:'nowrap',color:tot?C.accent:C.text,...num}}>{v}</span></div>
      const subF=(k,a,b,v)=><div key={k} style={{display:'flex',alignItems:'center',gap:10,padding:'6px 14px 6px 33px',borderTop:`1px solid ${C.bgSoft}`,background:C.bgSoft,fontSize:11.5}}><span style={{fontWeight:600,color:C.text,whiteSpace:'nowrap',flexShrink:0}}>{a}</span>{isDesktop&&b?<span style={{flex:1,minWidth:0,color:C.muted,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{b}</span>:<span style={{flex:1}}/>}<span style={{fontWeight:600,whiteSpace:'nowrap',...num}}>{v}</span></div>
      const cab=t=><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,padding:'10px 14px 8px'}}><span style={{...kLbl,color:C.accent}}>{t} · {per}</span></div>
      // Ingresos: Facturación propia (+ su apertura emitida − NC − terceros) + Subarriendo + Comisión de externos = Ingresos
      const [vFac,vSub,vRex]=redondearPartes([facturacion,subarr,rex],1e5,[0])
      const [fFac,fNc,fTer]=redondearPartes([facturacion,nc,terc],1e5,[0])
      const detIng=<div style={card}>{cab('Ingresos')}
        {ln({k:'fac',l:'Facturación propia',v:fmtMillLR(vFac),on:e=>{e.stopPropagation();setNcOpen(!ncOpen)},open:ncOpen})}
        {ncOpen&&<>{subF('em','Emitida en el SII','sin facturas de gastos ni subarriendo',fmtMillLR(fFac+fNc+fTer))}{subF('nc','− Notas de crédito',ncList.length?`${ncList.length} nota${ncList.length!==1?'s':''}`:'',fmtMillLR(fNc))}{fTer?subF('te','− Por cuenta de terceros','se traspasa a externos',fmtMillLR(fTer)):null}</>}
        {subarr!==0&&ln({k:'sub',sg:'+',l:'Subarriendo',v:fmtMillLR(vSub)})}
        {rex!==0&&ln({k:'rex',sg:'+',l:'Comisión de externos',v:fmtMillLR(vRex)})}
        {ln({k:'ingT',sg:'=',l:'Ingresos',v:fmtMillLR(vFac+vSub+vRex),tot:true})}</div>
      // Costos: suma de las líneas de resultadoMes de los meses del período (misma fuente que Estado de resultados).
      const COSL={rem:'Remuneraciones',cot:'Cotizaciones',arr:'Arriendo y GGCC',con:'Contadora',otr:'Otros costos',pre:'Presupuesto de oficina',gv:'Gastos varios'}
      const cosAgg={}; months.forEach(m=>(rmes[m]?.cosLines||[]).forEach(x=>{ cosAgg[x.k]=(cosAgg[x.k]||0)+(Number(x.m)||0) }))
      const cosK=['rem','cot','arr','con','otr','pre','gv'].filter(k=>cosAgg[k])
      const cosV=redondearPartes(cosK.map(k=>cosAgg[k]),1e5)
      const remEst=months.some(m=>rmes[m]?.remEst&&rmes[m]?.conPlanilla)
      const detCos=<div style={card}>{cab('Costos de operación')}
        {cosK.map((k,i)=>ln({k,sg:i?'+':'',l:COSL[k],v:fmtMillLR(cosV[i]),est:k==='rem'&&remEst}))}
        {ln({k:'cosT',sg:'=',l:'Costos de operación',v:fmtMillLR(cosV.reduce((a,x)=>a+x,0)),tot:true})}
        {ppm>0&&<div style={{fontSize:11.5,color:C.muted,padding:'9px 14px',borderTop:`1px solid ${C.bgSoft}`}}>PPM {per} <b style={{color:C.accent}}>{fmtMill(ppm)}</b> · anticipo de impuesto, va aparte</div>}</div>
      // Comisiones pagadas: por colaborador (comList de cada mes).
      const comAgg={}; months.forEach(m=>(rmes[m]?.comList||[]).forEach(x=>{ const k=String(x.pid||x.nombre); if(!comAgg[k]) comAgg[k]={nombre:x.nombre,m:0}; comAgg[k].m+=Number(x.m)||0 }))
      const comL=Object.values(comAgg).sort((a,b)=>b.m-a.m), comV=redondearPartes(comL.map(x=>x.m),1e5)
      const detCom=<div style={card}>{cab('Comisiones pagadas')}
        {comL.length?<>{comL.map((x,i)=>ln({k:'c'+i,sg:i?'+':'',l:x.nombre,v:fmtMillLR(comV[i])}))}{comL.length>1&&ln({k:'comT',sg:'=',l:'Comisiones pagadas',v:fmtMillLR(comV.reduce((a,x)=>a+x,0)),tot:true})}</>
          :<div style={{padding:'10px 14px',fontSize:12,color:C.muted,borderTop:`1px solid ${C.bgSoft}`}}>Sin comisiones pagadas en el período</div>}</div>
      const blk=open==='cos'||open==='com'?open:(open===null?null:'ing')
      const B=[{k:'ing',ic:'tEntra',lab:'Ingresos',val:fmtMill(ingresos)},{k:'cos',ic:'wallet',lab:'Costos de operación',val:costosOper?'−'+fmtMill(costosOper):'$0'},{k:'com',ic:'tPct',lab:'Comisiones pagadas',val:comis?'−'+fmtMill(comis):'$0'}]
      const det=k=>k==='ing'?detIng:k==='cos'?detCos:detCom
      const bloques=isDesktop
        ? <><div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:8,marginTop:12}}>{B.map(b=>kt(b.k,b.ic,[C.card,C.accent],b.lab,b.val,null,()=>setOpen(blk===b.k?null:b.k),{sel:blk===b.k,chev:true,big:false}))}</div>{blk&&det(blk)}</>
        : <div style={{display:'flex',flexDirection:'column',gap:8,marginTop:12}}>{B.map(b=><Fragment key={b.k}>{kt(b.k,b.ic,[C.card,C.accent],b.lab,b.val,null,()=>setOpen(blk===b.k?null:b.k),{sel:blk===b.k,chev:true,big:false})}{blk===b.k&&det(b.k)}</Fragment>)}</div>
      // Comparativa mensual: por mes, Ingresos − Costos − Comisiones = Resultado (redondeo que cuadra en cada mes; el resultado fijo).
      const allM=Array.from({length:maxM},(_,i)=>i+1)
      const col=ms=>{ const ing=ms.reduce((a,m)=>a+R(m,'ing'),0), cos=ms.reduce((a,m)=>a+R(m,'cos'),0), com=ms.reduce((a,m)=>a+R(m,'com'),0), res=ms.reduce((a,m)=>a+R(m,'res'),0); const [r,c,k]=redondearPartes([res,cos,com],1e5,[0]); return {ing:r+c+k,cos:c,com:k,res:r,margen:margenPct(res,ing)} }
      const cols=allM.map(m=>({m,...col([m])})), tot=col(allM)
      const pctM=v=>v==null?'—':`${v.toLocaleString('es-CL',{maximumFractionDigits:1})} %`
      const th={fontSize:9.5,fontWeight:700,letterSpacing:.5,textTransform:'uppercase',color:C.accent,background:C.bgSoft,padding:'7px 8px',textAlign:'right',whiteSpace:'nowrap'}
      const td={padding:'7px 8px',textAlign:'right',borderTop:`1px solid ${C.bgSoft}`,whiteSpace:'nowrap',fontSize:12,...num}
      const dot=m=><span title={mesEstado(m)} style={{display:'inline-block',width:6,height:6,borderRadius:'50%',background:EST_COL[mesEstado(m)],marginRight:4,verticalAlign:'middle'}}/>
      const filaT=(lab,get,neg)=><tr>{[<td key='l' style={{...td,textAlign:'left',paddingLeft:14,fontWeight:600}}>{lab}</td>,...cols.map(c=>{ const v=get(c); return <td key={c.m} onClick={()=>abrirEditor(c.m)} className='er-c' style={{...td,cursor:'pointer',color:v?C.text:C.done}}>{v?(neg?'−':'')+fmtMillLR(v):'—'}</td> }),<td key='t' style={{...td,fontWeight:800,borderLeft:`1px solid ${C.border}`}}>{(neg&&get(tot)?'−':'')+fmtMillLR(get(tot))}</td>]}</tr>
      const tabla=<div style={{...card,marginTop:0}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,padding:'10px 14px 8px'}}><span style={{...kLbl,color:C.accent}}>Comparativa mensual · {yr}</span><span style={{fontSize:11,color:C.textSoft,whiteSpace:'nowrap'}}>{nCerrados>0?`${nCerrados} ${nCerrados===1?'mes cerrado':'meses cerrados'} · `:''}toca un mes para editar</span></div>
        <div style={{overflowX:'auto'}}><table style={{borderCollapse:'collapse',width:'100%'}}><thead><tr><th style={{...th,textAlign:'left',paddingLeft:14}}/>{cols.map(c=><th key={c.m} onClick={()=>abrirEditor(c.m)} className='er-c' style={{...th,cursor:'pointer'}}>{dot(c.m)}{MES_C[c.m-1]}</th>)}<th style={th}>{yr}</th></tr></thead>
        <tbody>{filaT('Ingresos',c=>c.ing,false)}{filaT('− Costos de operación',c=>c.cos,true)}{filaT('− Comisiones pagadas',c=>c.com,true)}
          <tr>{[<td key='l' style={{...td,textAlign:'left',paddingLeft:14,fontWeight:800,color:C.accent,borderTop:`1.5px solid ${C.accent}`}}>= Resultado</td>,...cols.map(c=>{ const [bg,fg]=tonoMargen(c.margen); return <td key={c.m} onClick={()=>abrirEditor(c.m)} className='er-c' style={{...td,fontWeight:800,background:bg,color:fg,cursor:'pointer',borderTop:`1.5px solid ${C.accent}`}}>{sgnLR(c.res)}</td> }),<td key='t' style={{...td,fontWeight:800,color:tot.res>=0?C.greenText:C.overdueText,borderTop:`1.5px solid ${C.accent}`,borderLeft:`1px solid ${C.border}`}}>{sgnLR(tot.res)}</td>]}</tr>
          <tr>{[<td key='l' style={{...td,textAlign:'left',paddingLeft:14,fontWeight:700}}>Margen</td>,...cols.map(c=><td key={c.m} onClick={()=>abrirEditor(c.m)} className='er-c' style={{...td,fontWeight:700,fontSize:11.5,cursor:'pointer',color:tonoMargen(c.margen)[1]}}>{pctM(c.margen)}</td>),<td key='t' style={{...td,fontWeight:800,borderLeft:`1px solid ${C.border}`}}>{pctM(tot.margen)}</td>]}</tr>
        </tbody></table></div></div>
      // Celular (como el Estado de resultados): un mes por línea, del más nuevo al más antiguo; tocar abre su planilla.
      const lista=<div style={{...card,marginTop:0}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,padding:'10px 14px 8px'}}><span style={{...kLbl,color:C.accent}}>Mes a mes · {yr}</span><span style={{fontSize:11,color:C.textSoft,whiteSpace:'nowrap'}}>toca para editar</span></div>
        {[...cols].reverse().map(c=>{ const [bg,fg]=tonoMargen(c.margen); return <div key={c.m} onClick={()=>abrirEditor(c.m)} className='er-c' style={{display:'flex',alignItems:'center',gap:10,padding:'9px 14px',borderTop:`1px solid ${C.bgSoft}`,cursor:'pointer'}}>
          <span style={{flex:1,minWidth:0,fontSize:12.5,fontWeight:700,color:C.accent,whiteSpace:'nowrap'}}>{dot(c.m)}{MESES[c.m-1]}</span>
          <span style={{fontSize:11,fontWeight:700,borderRadius:20,padding:'2px 8px',background:bg,color:fg,minWidth:58,textAlign:'center',whiteSpace:'nowrap',...num}}>{pctM(c.margen)}</span>
          <span style={{fontSize:12.5,fontWeight:800,minWidth:70,textAlign:'right',whiteSpace:'nowrap',color:c.res>=0?C.greenText:C.overdueText,...num}}>{sgnLR(c.res)}</span></div> })}
        <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',borderTop:`1.5px solid ${C.accent}`,background:'#EDF1F4'}}><span style={{flex:1,fontSize:12.5,fontWeight:800,color:C.accent}}>{yr}</span><span style={{fontSize:11,fontWeight:700,color:C.accent,...num}}>{pctM(tot.margen)}</span><span style={{fontSize:12.5,fontWeight:800,minWidth:70,textAlign:'right',color:tot.res>=0?C.greenText:C.overdueText,...num}}>{sgnLR(tot.res)}</span></div></div>
      return <>
        <div style={grid4}>
          {kt('res','chart',tRes,'Resultado',sgn(resultado),`${per} · ${estadoP}${estim?' · incl. estimados':''}`)}
          {kt('ing','tEntra',[C.azulBg,C.accent],'Ingresos',fmtMill(ingresos),'incluye subarriendo',()=>setOpen('ing'))}
          {kt('egr','wallet',[C.soonBg,C.soonText],'Egresos',egr?'−'+fmtMill(egr):'$0','costos + comisiones',()=>setOpen('cos'))}
          {kt('mar','tPct',[C.card,C.accent],'Margen',margenV==null?'—':`${margenV.toLocaleString('es-CL',{maximumFractionDigits:1})} %`,'sobre los ingresos')}
        </div>
        {bloques}
        <div style={{marginTop:14}}>{isDesktop?tabla:lista}</div>
      </>
    })()}

    {(()=>{
      // Presupuesto vs real. Presupuesto = Costos de oficina por categoría (sin PPM ni subarriendo, vigente por mes con desde/monto_prev).
      // Real = las mismas líneas de costo de resultadoMes (planilla + banco + gastos varios), así el total cuadra con «Costos de operación».
      const allM=Array.from({length:maxM},(_,i)=>i+1)
      const CATS=[['rem','Remuneraciones'],['cot','Leyes sociales'],['arr','Arriendo y GGCC'],['gv','Gastos varios'],['con','Contadora']]
      const budCat=r=>{ const c=String(r.categoria||''), it=String(r.item||''); if(/contador/i.test(it)) return 'con'; if(c==='Remuneraciones') return 'rem'; if(c==='Leyes sociales') return 'cot'; if(c==='Arriendo y espacio'&&!/limpieza|aseo/i.test(it)) return 'arr'; return 'gv' }
      const vacio=()=>({rem:0,cot:0,arr:0,gv:0,con:0})
      const budM=m=>{ const o=vacio(); (costosOfiRows||[]).filter(r=>r&&r.activo!==false&&!r.es_ingreso&&!esPPMcosto(r)).forEach(r=>{ const eff=(r.desde&&pad(m)<String(r.desde).slice(0,7))?(r.monto_prev??r.monto):r.monto; o[budCat(r)]+=Number(eff)||0 }); return o }
      const LMAP={rem:'rem',cot:'cot',arr:'arr',con:'con',otr:'gv',gv:'gv'}
      const realM=m=>{ const r=rmes[m]; const o=vacio(); if(!r) return o; if(!r.conPlanilla){ const b=budM(m); Object.keys(o).forEach(k=>o[k]=b[k]); o.gv+=Number(r.gv)||0; return o }
        ;(r.cosLines||[]).forEach(x=>{ const k=LMAP[x.k]; if(k) o[k]+=Number(x.m)||0 }); return o }
      const tot=o=>Object.values(o).reduce((a,v)=>a+v,0)
      const filas=allM.map(m=>{ const b=budM(m), r=realM(m); return {m,b,r,bt:tot(b),rt:tot(r),est:!!(rmes[m]&&(rmes[m].estimado||!rmes[m].conPlanilla))} })
      const bud=filas.reduce((a,f)=>a+f.bt,0), real=filas.reduce((a,f)=>a+f.rt,0), dv=real-bud
      if(!(bud>0)) return null
      const resto=Array.from({length:12-maxM},(_,i)=>maxM+1+i), budResto=resto.reduce((a,m)=>a+tot(budM(m)),0)
      const proy=real+budResto, budAnio=bud+budResto
      const catTot=k=>({b:filas.reduce((a,f)=>a+f.b[k],0), r:filas.reduce((a,f)=>a+f.r[k],0)})
      const gvGrupos=(()=>{ const g={}; allM.forEach(m=>(rmes[m]?.gvItems||[]).forEach(e=>{ const l=[e.category,e.subcategory].filter(Boolean).join(' › ')||'Sin categoría'; g[l]=(g[l]||0)+(Number(e.amount)||0) }))
        const otr=allM.reduce((a,m)=>a+(Number((rmes[m]?.cosLines||[]).find(x=>x.k==='otr')?.m)||0),0); if(otr) g['Otros (planilla)']=otr
        return Object.entries(g).sort((a,b)=>b[1]-a[1]) })()
      const dCol=v=>Math.abs(v)<1?C.done:v>0?C.overdueText:C.greenText
      const dTxt=v=>Math.abs(v)<1?'—':(v>0?'+':'−')+fmtMill(Math.abs(v))
      const pct=bud>0?Math.abs(dv)/bud*100:0
      const per=maxM===12?String(yr):`ene–${MES_C[maxM-1]}`
      const kLb={fontSize:isDesktop?10:9.5,fontWeight:700,letterSpacing:isDesktop?.5:.3,textTransform:'uppercase',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}
      const kt=(k,ic,bg,fg,lab,val,sub)=>{ const blanco=bg===C.card; return <div key={k} style={{background:bg,border:`1px solid ${blanco?C.border:'transparent'}`,borderRadius:12,padding:isDesktop?'13px 13px':'11px 10px',display:'flex',gap:isDesktop?11:8,alignItems:'center',minWidth:0}}>
        <KpiIco n={ic} c={fg} soft={blanco}/>
        <div style={{minWidth:0,flex:1}}><div style={{...kLb,color:fg}}>{lab}</div><div style={{fontSize:isDesktop?22:18,fontWeight:800,color:fg,letterSpacing:-.5,marginTop:2,whiteSpace:'nowrap',fontVariantNumeric:'tabular-nums'}}>{val}</div><div style={{fontSize:11,color:fg,opacity:.85,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{sub}</div></div></div> }
      const sobre=dv>0
      const estChip=<span style={{fontSize:9.5,fontWeight:700,color:C.soonText,background:C.ambarBg,borderRadius:20,padding:'1px 6px',marginLeft:5}}>est.</span>
      // Fila única para ambos formatos: escritorio = 4 columnas; celular = nombre con «ppto.» debajo, desvío y real a la derecha.
      const fila=(key,lab,b,r,{est,sub,open,on,tot:esTot,ppto}={})=>{ const d=r==null?null:r-b
        const nameCol=sub?C.muted:C.accent
        if(isDesktop) return <div key={key} onClick={on} style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) 110px 110px 100px',gap:10,alignItems:'center',padding:sub?'5px 14px 5px 30px':'9px 14px',borderTop:sub?'none':`1px solid ${esTot?C.border:C.bgSoft}`,background:sub||open?C.bgSoft:'transparent',cursor:on?'pointer':'default',fontSize:sub?11.5:12.5,fontVariantNumeric:'tabular-nums'}}>
          <span style={{fontWeight:esTot?800:sub?600:700,color:nameCol,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{lab}{est?estChip:null}{on?<span style={{marginLeft:6,display:'inline-block',verticalAlign:'middle'}}>{chev(open)}</span>:null}</span>
          <span style={{textAlign:'right',color:sub?C.muted:C.text,fontWeight:esTot?800:500}}>{fmtMill(b)}</span>
          <span style={{textAlign:'right',color:sub?C.muted:C.text,fontWeight:esTot?800:600}}>{r==null?<span style={{color:C.done}}>{ppto||'—'}</span>:fmtMill(r)}</span>
          <span style={{textAlign:'right',fontWeight:sub?600:700,color:d==null?C.done:dCol(d)}}>{d==null?'—':dTxt(d)}</span>
        </div>
        return <div key={key} onClick={on} style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) auto auto',gap:10,alignItems:'center',padding:sub?'6px 12px 6px 24px':'9px 12px',borderTop:sub?'none':`1px solid ${esTot?C.border:C.bgSoft}`,background:sub||open?C.bgSoft:'transparent',cursor:on?'pointer':'default',fontSize:sub?11.5:12.5,fontVariantNumeric:'tabular-nums'}}>
          <span style={{minWidth:0}}><span style={{display:'block',fontWeight:esTot?800:sub?600:700,color:nameCol,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{lab}{est?estChip:null}</span><span style={{display:'block',fontSize:10.5,color:C.done,whiteSpace:'nowrap'}}>ppto. {fmtMill(b)}</span></span>
          <span style={{fontSize:11.5,fontWeight:700,textAlign:'right',minWidth:54,color:d==null?C.done:dCol(d)}}>{d==null?'—':dTxt(d)}</span>
          <span style={{fontWeight:esTot?800:700,textAlign:'right',minWidth:58,color:sub?C.muted:C.text}}>{r==null?<span style={{color:C.done,fontWeight:500}}>{ppto||'—'}</span>:fmtMill(r)}</span>
        </div> }
      const head=(t)=>isDesktop?<div style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) 110px 110px 100px',gap:10,padding:'8px 14px',background:C.bgSoft}}>{[t,'Presupuesto','Real','Desvío'].map((h,i)=><span key={h} style={{fontSize:9.5,fontWeight:800,textTransform:'uppercase',letterSpacing:.3,color:C.accent,textAlign:i?'right':'left',whiteSpace:'nowrap'}}>{h}</span>)}</div>:null
      const pvOpen=open&&String(open).startsWith('pv')?open:(scope==='mes'?'pvm'+selM:null)
      const tg=id=>setOpen(o=>(o===id||(!o&&pvOpen===id))?'pvx':id)
      const mesFilas=f=>{ const id='pvm'+f.m, o=pvOpen===id; return [fila(id,isDesktop?MESES[f.m-1]:MES_C[f.m-1],f.bt,f.rt,{est:f.est,open:o,on:()=>tg(id)}),
        ...(o?CATS.map(([k,l])=>fila(id+k,l,f.b[k],f.r[k],{sub:true})):[])] }
      const ordM=isDesktop?filas:[...filas].reverse()
      const card2={background:C.card,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden',minWidth:0}
      const secT=t=><div style={{fontSize:10.5,fontWeight:800,letterSpacing:.5,textTransform:'uppercase',color:C.accent,margin:'16px 4px 8px'}}>{t}</div>
      return <>
        <div style={{fontSize:10.5,fontWeight:800,letterSpacing:.5,textTransform:'uppercase',color:C.muted,margin:'22px 4px 10px'}}>Presupuesto vs real · {per}{maxM<12?' '+yr:''}</div>
        <div style={{display:'grid',gridTemplateColumns:isDesktop?'repeat(4,minmax(0,1fr))':'repeat(2,minmax(0,1fr))',gap:8}}>
          {kt('pb','file',C.card,C.accent,'Presupuesto',fmtMill(bud),`costos ${per}`)}
          {kt('pr','wallet',C.azulBg,C.accent,'Real',fmtMill(real),'banco + planilla')}
          {kt('pd','alert',sobre?C.ambarBg:C.greenBg,sobre?C.soonText:C.greenText,'Desvío',dTxt(dv),`${pct.toFixed(1).replace('.',',')} % ${sobre?'sobre':'bajo'} ppto.`)}
          {kt('pp','chart',C.tealBg,C.tealText,'Costo proyectado',fmtMill(proy),`ppto. ${fmtMill(budAnio)}`)}
        </div>
        {secT('Mes a mes')}
        <div style={card2}>{head('Mes')}{ordM.flatMap(mesFilas)}
          {resto.length>0&&fila('pvresto',isDesktop?`${MESES[maxM]}${resto.length>1?'–'+MESES[11]:''}`:`${MES_C[maxM]}${resto.length>1?'–'+MES_C[11]:''}`,budResto,null,{ppto:'proyectado'})}
          {fila('pvtot',String(yr),budAnio,proy,{tot:true})}
        </div>
        {secT(`Por categoría · ${per}`)}
        <div style={card2}>{head('Categoría')}
          {CATS.flatMap(([k,l])=>{ const t=catTot(k), id='pvc'+k, o=pvOpen===id, dr=k==='gv'&&gvGrupos.length>0
            return [fila(id,l,t.b,t.r,dr?{open:o,on:()=>tg(id)}:{}), ...(dr&&o?gvGrupos.map(([g,v])=><div key={id+g} style={{display:'grid',gridTemplateColumns:isDesktop?'minmax(0,1fr) 110px 110px 100px':'minmax(0,1fr) auto',gap:10,padding:isDesktop?'5px 14px 5px 30px':'6px 12px 6px 24px',background:C.bgSoft,fontSize:11.5,color:C.muted,fontVariantNumeric:'tabular-nums'}}><span style={{minWidth:0,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',fontWeight:600}}>{g}</span>{isDesktop?<span/>:null}<span style={{whiteSpace:'nowrap',fontWeight:600,textAlign:'right'}}>{fmtMill(v)}</span>{isDesktop?<span/>:null}</div>):[])] })}
          {fila('pvctot','Total',bud,real,{tot:true})}
        </div>
      </>
    })()}

    {(()=>{
      const allM=Array.from({length:maxM},(_,i)=>i+1)
      const sinEnl=(ventas||[]).filter(d=>String(d.fecha_emision||'').slice(0,4)===String(yr)&&[33,34,61].includes(Number(d.tipo_dte))&&!d.billing_id)
      const faltaClaudia=allM.filter(m=>{ const r=cmBy[m]; return r && (Number(r.cotizaciones)===0||Number(r.ppm)===0||r.estimado) })
      const sldFalta=allM.filter(m=>{ const r=cmBy[m]; return !r || Number(r.sueldos)===0 })
      const pendCierre=allM.filter(m=>cierreDisponible(m)&&mesEstado(m)!=='cerrado')   // ya corresponde cerrar por fecha, pero faltan datos o está estimado
      const descF=fondosChk.desc
      const checks=[
        [sinEnl.length===0,'Facturas del SII',sinEnl.length?`${sinEnl.length} sin enlazar a una venta · tócalo para ver cuáles`:'todas enlazadas a una venta', sinEnl.length?{label:sinEnlOpen?'ocultar':'ver',on:()=>setSinEnlOpen(o=>!o)}:null],
        [pendCierre.length===0,'Cierre de meses',pendCierre.length?`${pendCierre.length} mes${pendCierre.length!==1?'es':''} por cerrar · faltan datos reales (completa abajo)`:`se cierran solos · ${nCerrados} cerrado${nCerrados!==1?'s':''}`, null],
        [faltaClaudia.length===0,'Cotizaciones y PPM (Claudia)',faltaClaudia.length?`${faltaClaudia.length} mes${faltaClaudia.length!==1?'es':''} con valores pendientes o estimados`:'todos con los valores reales de Claudia', faltaClaudia.length?{label:'editar',on:()=>abrirEditor(faltaClaudia[0])}:null],
        [descF.length===0,'Fondos de clientes',descF.length?`${descF.length} cliente${descF.length!==1?'s':''} cuyo reparto por fondo no suma su saldo: ${descF.slice(0,3).join(', ')}`:`el reparto por fondo suma el saldo de cada ficha · ${fondosChk.n} clientes`],
        [sldFalta.length===0,'Sueldos de la planilla',sldFalta.length?`${sldFalta.length} mes${sldFalta.length!==1?'es':''} sin sueldos cargados · confírmalos con las liquidaciones`:'cargados en todos los meses · confírmalos con las liquidaciones', sldFalta.length?{label:'editar',on:()=>abrirEditor(sldFalta[0])}:null],
      ]
      return <><div style={{fontSize:10.5,fontWeight:800,letterSpacing:.5,textTransform:'uppercase',color:C.muted,margin:'22px 4px 10px'}}>Salud de datos</div>
        <div style={card}>{(()=>{ const out=[]; checks.forEach(([ok,t,d,act],i)=>{
          out.push(<div key={'c'+i} onClick={act?act.on:undefined} style={{display:'flex',alignItems:'center',gap:11,padding:'12px 16px',borderTop:i?`1px solid ${C.bgSoft}`:'none',cursor:act?'pointer':'default'}}>
            <span style={{width:28,height:28,borderRadius:'50%',background:ok?C.greenBg:C.soonBg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{ok
              ?<svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke={C.greenText} strokeWidth='2.6' strokeLinecap='round' strokeLinejoin='round'><path d='M20 6 9 17l-5-5'/></svg>
              :<svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke={C.soonText} strokeWidth='2.4' strokeLinecap='round' strokeLinejoin='round'><path d='M12 9v4M12 17h.01'/><path d='M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z'/></svg>}</span>
            <span style={{minWidth:0,flex:1}}><span style={{fontSize:12.5,fontWeight:700,color:C.accent,display:'block'}}>{t}</span><span style={{fontSize:11,color:ok?C.done:C.soonText}}>{d}</span></span>
            {act&&<span style={{flexShrink:0,fontSize:11,fontWeight:800,color:C.soonText,whiteSpace:'nowrap'}}>{act.label} <Gl n='chevron'/></span>}
          </div>)
          if(i===0&&sinEnlOpen&&sinEnl.length>0) out.push(<div key='sinenl' style={{padding:'0 16px 12px'}}><div style={{background:C.overdueBg,borderRadius:10,overflow:'hidden'}}>{sinEnl.slice().sort((a,b)=>String(a.fecha_emision||'').localeCompare(String(b.fecha_emision||''))).map((d,j)=><div key={j} style={{display:'flex',justifyContent:'space-between',gap:10,padding:'7px 12px',fontSize:11.5,color:C.overdueText,fontWeight:600,borderTop:j?'1px solid rgba(163,45,45,.14)':'none'}}><span>{Number(d.tipo_dte)===61?'NC · ':''}N° {d.folio} · {d.receptor_name||'—'}</span><span style={{fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fmt(Number(d.monto)||0)}</span></div>)}</div></div>)
        }); return out })()}</div></>
    })()}
  </div>)
}

