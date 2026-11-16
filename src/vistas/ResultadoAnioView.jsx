// Movido desde App.jsx por scripts/mover-a-modulo.py. Sin cambios de comportamiento.
import { useState, useEffect, useMemo, Fragment } from 'react'
import { supabase, selectAll, DEMO } from '../supabase'
import { etiquetaRecuperado, docDeSubarriendo, recuperadoOficinaMes } from '../../supabase/functions/_shared/costosOficina.js'
import { fgCliente } from '../../supabase/functions/_shared/gastosReglas.js'
import { impuestosMensuales, pagosConBoleta, listaBoletasPorCargar, idOficina } from '../../supabase/functions/_shared/impuestosMensuales.js'
import { GrupoImpuestos, DetalleImpuestos } from './impuestosMensualesUI.jsx'
import { C, Gl, appAlert, fmt, fmtFechaDMY } from '../lib/base.jsx'
import { descargarXlsx } from '../lib/seleccionLote.jsx'
import { KpiIco, MESES, MES_C, esPPMcosto, fmtMill, fmtMillLR, margenPct, redondearPartes, redondearA, cascadaResultado, repartoFondos, resultadoMes, tonoMargen, useFuentesResultado, useImpuestosFuentes, setLearningKV } from '../lib/compartido.jsx'

// ── Página "Resultado del año" (tab resultadoAnio, en Oficina). Ingresos (facturación SII propia neta de NC + comisión de externos) − egresos (planilla real oficina_costos_mensual, neta del subarriendo, + comisiones). Cifras desde fuentes de verdad: SII (sii_cargas_docs) + planilla editable. Cada bloque se expande (NC cliqueables). Filtros Año / Por mes. Responsive. ──
export function ResultadoAnioView({ backLabel='Oficina', billing=[], terceros=[], costosOfiRows=[], isDesktop=true, soloControl=false, checksExtra=[], onBack, user, expenses=[], clients=[], onOpenGasto, onCargarBoleta }){
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
  const [pvCat,setPvCat]=useState(null)   // categoría de un mes abierta hasta sus partidas: «<mes><cat>»
  const [liqs,setLiqs]=useState([])   // liquidaciones de sueldo leídas del correo de la contadora (solo administradores)
  useEffect(()=>{ if(DEMO){ setVentas([]); setCm([]); return } let v=true
    selectAll(()=>supabase.from('sii_cargas_docs').select('tipo_dte,monto,fecha_emision,folio,receptor_name,billing_id').order('id')).then(({data})=>{ if(v&&data) setVentas(data) },()=>{})
    supabase.from('oficina_costos_mensual').select('*').eq('anio',yr).then(({data})=>{ if(v&&data) setCm(data) },()=>{})
    supabase.from('remuneraciones_tributables').select('periodo,persona,imponible,cotizaciones,tributable,impuesto_unico,fuente').like('periodo',yr+'-%').then(({data})=>{ if(v&&data) setLiqs(data) },()=>{})
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
  const bById=useMemo(()=>{ const m={}; (billing||[]).forEach(b=>{ if(b) m[String(b.id)]=b }); return m },[billing])
  const ncPropia=d=>Number(d.tipo_dte)===61&&!docDeSubarriendo(bById[String(d.billing_id)],bById)   // igual que resultadoMes: la NC de una factura de subarriendo no resta honorarios
  const fuB=useFuentesResultado()   // quién paga con boleta (miembros), para las remuneraciones desde el banco
  // Impuestos mensuales (PPM, retención de honorarios, impuesto único): una sola función (_shared/impuestosMensuales.js) arma las tres partes del F29 de cada mes.
  const imps=useImpuestosFuentes(), [impDet,setImpDet]=useState(null)   // impDet = {m, tipo} o null
  const ofiId=useMemo(()=>idOficina(clients),[clients])
  const pagosB=useMemo(()=>DEMO?(imps.pagos||[]):pagosConBoleta({expenses,ofiId,boletaSet:fuB.boleta,terceros}),[expenses,ofiId,fuB,terceros,imps.pagos])  // eslint-disable-line react-hooks/exhaustive-deps
  // Destino de cada emisor de boleta (decisión reutilizable por RUT, learnings boleta_destino): la app no vuelve a preguntar. En demo queda solo en pantalla.
  const [destDemo,setDestDemo]=useState({})
  const destinos={...(imps.destinos||{}),...destDemo}
  const guardarDestino=async(rut,v)=>{ if(!rut) return; if(DEMO){ setDestDemo(p=>({...p,[rut]:v})); return }
    try{ await setLearningKV('boleta_destino',rut,v||''); imps.recargar() }catch(e){ appAlert('No se pudo guardar el destino: '+(e.message||e)) } }
  const impOf=m=>impuestosMensuales({per:pad(m),docs:(ventas&&ventas.length?ventas:imps.docs)||[],boletas:imps.boletas,pagos:pagosB,liquidaciones:imps.liquidaciones,declarados:imps.declarados,informado:imps.valores?.[pad(m)]?.ppm,destinos,terceros,boletaSet:[...fuB.boleta]})
  const faltanOtros=m=>listaBoletasPorCargar({pagos:pagosB,boletas:imps.boletas,declarados:imps.declarados,desde:`${yr}-01`,destinos}).filter(x=>x.per!==pad(m)).map(x=>({...x,mesLbl:MESES[Number(x.per.slice(5,7))-1]}))
  const rmes=useMemo(()=>{ const fuY={sii:ventas||[],plan:cm||[],boleta:fuB.boleta}, deps={billing,terceros,costosOfiRows,expenses,clients}, o={}
    for(let m=1;m<=maxM;m++) o[m]=resultadoMes(fuY,deps,pad(m)); return o },[ventas,cm,fuB,billing,terceros,costosOfiRows,expenses,clients,yr,maxM])   // eslint-disable-line react-hooks/exhaustive-deps
  const R=(m,k)=>Number(rmes[m]?.[k])||0
  // Desglose de la facturación propia (cuadra con resultadoMes.fac): emitida sin facturas de gastos ni de subarriendo − NC − externos.
  const propiaDoc=d=>!['reembolso','subarriendo'].includes(bTipo[String(d.billing_id)])
  const emitidaMes=m=>vMes(m).filter(d=>[33,34].includes(Number(d.tipo_dte))&&propiaDoc(d)).reduce((a,d)=>a+(Number(d.monto)||0),0)
  const ncMes=m=>vMes(m).filter(ncPropia).reduce((a,d)=>a+(Number(d.monto)||0),0)
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
  const ncList=months.flatMap(m=>vMes(m).filter(ncPropia).map(d=>({folio:d.folio,rec:d.receptor_name,monto:Number(d.monto)||0,ext:!d.billing_id})))
  const estim=months.some(m=>cmBy[m]&&cmBy[m].estimado)
  const fmtM=n=>(n<0?'−':'+')+fmtMill(Math.abs(n))
  const fmtMp=n=>fmtMill(Math.abs(n))
  const titulo=scope==='mes'?`${MESES[selM-1]} ${yr}`:(yr<curY?`${yr} completo`:`Enero–${MESES[maxM-1]} ${yr}`)
  const nCerrados=Array.from({length:maxM},(_,i)=>i+1).filter(m=>cmBy[m]&&cmBy[m].cerrado).length
  const CAMPOS=[['sueldos','Sueldos'],['cotizaciones','Cotizaciones'],['ppm','Pago al SII (F29)'],['contadora','Contadora'],['arriendo','Arriendo'],['gastos_comunes','Gastos comunes'],['honorarios','Honorarios'],['otros_costos','Otros'],['subarriendo','Subarriendo · menor costo (informativo)'],['comisiones','Comisiones']]
  const mesEstado=m=>{ const r=cmBy[m]; if(r&&r.cerrado) return 'cerrado'; if(r&&rmes[m]?.planillaIncompleta) return 'provisorio'; if(r&&r.estimado) return 'estimado'; if(r) return 'abierto'; return 'vacio' }
  const EST_COL={cerrado:C.greenText,estimado:C.soonText,provisorio:C.soonText,abierto:C.done,vacio:C.border}
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

  const card={background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,marginBottom:9,overflow:'hidden'}
  const seg=(val,set,opts)=><span style={{display:'inline-flex',background:C.bgSoft,border:`1px solid ${C.border}`,borderRadius:20,overflow:'hidden'}}>{opts.map(([v,l])=><span key={v} onClick={()=>set(v)} style={{fontSize:11,fontWeight:700,padding:'7px 14px',cursor:'pointer',background:val===v?C.accent:'transparent',color:val===v?'#fff':C.muted}}>{l}</span>)}</span>
  const chev=o=><svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke={C.done} strokeWidth='2.4' strokeLinecap='round' strokeLinejoin='round' style={{transform:o?'rotate(90deg)':'none',transition:'.2s'}}><path d='m9 18 6-6-6-6'/></svg>
  const row=(l,v,s,col)=><div style={{display:'flex',alignItems:'center',gap:10,padding:'8px 2px',borderTop:`1px solid ${C.bgSoft}`,fontSize:13}}><span style={{color:C.text,fontWeight:600}}>{l}{s?<span style={{color:C.textSoft,fontSize:11,fontWeight:400,marginLeft:6}}>{s}</span>:null}</span><span style={{marginLeft:'auto',fontWeight:700,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap',color:col||C.accent}}>{v}</span></div>
  const sec=(id,icBg,icCol,icPath,ti,sub,amt,amtCol,body)=><div style={card}>
    <div onClick={()=>setOpen(open===id?null:id)} style={{padding:'14px 16px',display:'flex',alignItems:'center',gap:12,cursor:'pointer'}}>
      <span style={{width:36,height:36,borderRadius:10,background:icBg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke={icCol} strokeWidth='2.1' strokeLinecap='round' strokeLinejoin='round'>{icPath}</svg></span>
      <span style={{minWidth:0}}><span style={{fontSize:14,fontWeight:800,color:C.accent,display:'block'}}>{ti}</span><span style={{fontSize:11,color:C.textSoft}}>{sub}</span></span>
      <span style={{marginLeft:'auto',fontSize:17,fontWeight:800,letterSpacing:-.3,fontVariantNumeric:'tabular-nums',color:amtCol}}>{amt}</span>
      <span style={{flexShrink:0}}>{chev(open===id)}</span>
    </div>
    {open===id&&<div style={{padding:'0 16px 14px'}}>{body}</div>}
  </div>

  // Detalle de un impuesto mensual: PÁGINA con «← Costos del mes»; al volver queda la planilla en la misma fila.
  if(impDet){ const m=impDet.m, i=impOf(m); return <DetalleImpuestos imp={i} tipo={impDet.tipo} setTipo={t=>setImpDet({m,tipo:t})} mesLbl={`${MESES[m-1]} ${yr}`} tituloMes={`${MESES[m-1].toLowerCase()} de ${yr}`} origen={`Costos de ${MESES[m-1]} ${yr}`} onBack={()=>{ setImpDet(null); setTimeout(()=>{ const el=document.getElementById('imp-grupo'); el&&el.scrollIntoView({block:'center'}) },50) }} isDesktop={isDesktop} onCargarBoleta={onCargarBoleta} otrosMeses={faltanOtros(m)} onDestino={guardarDestino}/> }
  // Editor de un mes como PÁGINA (no modal): reemplaza la vista con su propio "← Resultado del año".
  if(editM!=null) return (
  <div style={{maxWidth:isDesktop?720:'100%',margin:'0 auto',padding:isDesktop?'0 20px 48px':'0 16px 48px'}}>
    <div style={{display:'flex',alignItems:'center',gap:11,margin:'4px 0 16px',flexWrap:'wrap'}}>
      <button onClick={()=>!busy&&setEditM(null)} style={{display:'flex',alignItems:'center',gap:6,background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:13,fontWeight:700,padding:0}}><svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round'><path d='M19 12H5'/><path d='m12 19-7-7 7-7'/></svg>Planilla de costos</button>
      <h1 style={{fontSize:isDesktop?20:19,fontWeight:800,color:C.accent,letterSpacing:-.5,margin:0}}>Costos de {MESES[editM-1]} {yr}</h1>
      {cmBy[editM]&&cmBy[editM].cerrado?<span style={{fontSize:10,fontWeight:800,textTransform:'uppercase',letterSpacing:.3,color:C.greenText,background:C.greenBg,borderRadius:20,padding:'3px 9px'}}>Cerrado</span>:null}
    </div>
    <div style={card}>
      <div style={{fontSize:11,color:C.textSoft,padding:'14px 16px 2px'}}>Montos en pesos. El subarriendo no es ingreso: baja el costo de oficina (monto fijo de Costos de Oficina). La columna «Subarriendo» de la planilla es informativa.</div>
      <div style={{padding:'4px 16px 10px'}}>
        {CAMPOS.map(([k,l])=><Fragment key={k}><div style={{display:'flex',alignItems:'center',gap:10,padding:'9px 0',borderTop:`1px solid ${C.bgSoft}`}}>
          <span style={{fontSize:13,color:k==='subarriendo'?C.greenText:C.text,fontWeight:600,flex:1}}>{l}</span>
          <input type='number' value={form[k]==null?0:form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))} style={{width:isDesktop?180:140,fontSize:14,fontWeight:700,textAlign:'right',border:`1px solid ${C.border}`,borderRadius:8,padding:'8px 10px',color:C.accent}}/>
        </div>{k==='cotizaciones'&&<div id='imp-grupo' style={{margin:'6px -16px'}}><GrupoImpuestos imp={impOf(editM)} onAbrir={t=>setImpDet({m:editM,tipo:t})}/></div>}</Fragment>)}
        <div style={{padding:'11px 0 4px',borderTop:`1px solid ${C.bgSoft}`}}><textarea placeholder='Nota (opcional)' value={form.nota||''} onChange={e=>setForm(f=>({...f,nota:e.target.value}))} rows={2} style={{width:'100%',fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,padding:'8px 10px',resize:'vertical',fontFamily:'inherit',color:C.text,boxSizing:'border-box'}}/></div>
        <label style={{display:'flex',alignItems:'center',gap:8,fontSize:13,color:C.text,fontWeight:600,padding:'8px 0 2px',cursor:'pointer'}}><input type='checkbox' checked={!!form.estimado} onChange={e=>setForm(f=>({...f,estimado:e.target.checked}))}/> Marcar como estimado (datos aún no confirmados)</label>
      </div>
    </div>
    <button disabled={busy} onClick={guardar} style={{width:'100%',fontSize:14,fontWeight:700,border:'none',borderRadius:12,padding:'13px',marginTop:12,background:C.accent,color:'#fff',cursor:busy?'default':'pointer',opacity:busy?.6:1}}>Guardar</button>
    <div style={{fontSize:11,color:C.textSoft,marginTop:11,lineHeight:1.55,padding:'0 2px'}}>{cmBy[editM]&&cmBy[editM].cerrado
      ? <>Mes cerrado{cmBy[editM].cerrado_por?` · ${cmBy[editM].cerrado_por==='auto'?'automático':cmBy[editM].cerrado_por}`:''}{cmBy[editM].cerrado_at?' · '+String(cmBy[editM].cerrado_at).slice(0,10):''}. Marca "estimado" para reabrirlo.</>
      : <>Se cierra solo cuando los datos están completos (sueldos, cotizaciones y pago al SII) y pasó el 15 del mes siguiente. Marca "estimado" si aún no son definitivos.</>}</div>
  </div>)

  return (
  <div style={soloControl?{}:{maxWidth:isDesktop?1120:'100%',margin:'0 auto',padding:isDesktop?'0 20px 48px':'0 16px 48px'}}>
    {!soloControl&&<>
    <div style={{display:'flex',alignItems:'center',gap:11,margin:'4px 0 14px',flexWrap:'wrap'}}>
      <button onClick={onBack} style={{display:'flex',alignItems:'center',gap:6,background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:13,fontWeight:700,padding:0}}><svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round'><path d='M19 12H5'/><path d='m12 19-7-7 7-7'/></svg>{backLabel}</button>
      <h1 style={{fontSize:isDesktop?20:19,fontWeight:800,color:C.accent,letterSpacing:-.5,margin:0}}>Planilla de costos</h1>
      <span style={{flex:1}}/>
      <select value={yr} onChange={e=>setYr(parseInt(e.target.value,10))} style={{fontSize:12,fontWeight:700,border:`1px solid ${C.border}`,borderRadius:20,padding:'6px 10px',background:C.azulBg,color:C.accent,cursor:'pointer'}}>{yrs.map(y=><option key={y} value={y}>{y}</option>)}</select>
    </div>


    {/* Molde Oficina / Estado de resultados (18-10): 4 tarjetas de color (las mismas de Oficina) + 3 bloques blancos que se abren
        en su cascada (+ − = con redondeo que cuadra) + comparativa mensual como la del Estado de resultados (cada mes:
        Ingresos − Costos − Comisiones = Resultado). Misma fuente: resultadoMes por mes. */}
    {(()=>{
      // Planilla de costos: un mes por línea (el más reciente primero); tocar un mes abre su editor. El resultado del año, sus aperturas y la comparativa mensual viven en el Estado de resultados.
      const ETQ={cerrado:'Cerrado',provisorio:'Provisorio',estimado:'Estimado',abierto:'Abierto',vacio:'Sin datos'}
      return <div style={card}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,padding:'12px 16px 8px'}}><span style={{fontSize:10.5,fontWeight:700,letterSpacing:.5,textTransform:'uppercase',color:C.accent}}>Costos por mes · {yr}</span><span style={{fontSize:11,color:C.textSoft,whiteSpace:'nowrap'}}>toca un mes para editar</span></div>
        {Array.from({length:maxM},(_,i)=>maxM-i).map(m=>{ const est=mesEstado(m); return <div key={m} onClick={()=>abrirEditor(m)} className='er-c' style={{display:'flex',alignItems:'center',gap:10,padding:'11px 16px',borderTop:`1px solid ${C.bgSoft}`,cursor:'pointer'}}>
          <span style={{width:7,height:7,borderRadius:'50%',background:EST_COL[est],flexShrink:0}}/>
          <span style={{flex:1,minWidth:0,fontSize:13,fontWeight:700,color:C.accent,whiteSpace:'nowrap'}}>{MESES[m-1]}</span>
          <span style={{fontSize:11,color:C.textSoft,whiteSpace:'nowrap'}}>{ETQ[est]}</span>
          <span style={{fontSize:13,fontWeight:700,minWidth:72,textAlign:'right',whiteSpace:'nowrap',fontVariantNumeric:'tabular-nums',color:C.text}}>{fmtMill(R(m,'cos'))}</span>
          <Gl n='chevron'/></div> })}
      </div>
    })()}
    </>}

    {soloControl&&(()=>{
      // Presupuesto vs real, en costos BRUTOS por categoría. Presupuesto = Costos de oficina (sin PPM, sin el subarriendo ni los gastos recuperados, vigente por mes con desde/monto_prev).
      // Real = las mismas líneas de costo de resultadoMes SIN la línea de subarriendo (planilla + banco + gastos varios): cuadra con «Costos de operación» más el subarriendo (que baja ese total).
      const cerM=yr<curY?12:curM-1   // solo meses cerrados: el mes en curso trae costos parciales y se compararía contra su presupuesto completo
      const allM=Array.from({length:cerM},(_,i)=>i+1)
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
      const resto=Array.from({length:12-cerM},(_,i)=>cerM+1+i), budResto=resto.reduce((a,m)=>a+tot(budM(m)),0)
      const proy=real+budResto, budAnio=bud+budResto
      const catTot=k=>({b:filas.reduce((a,f)=>a+f.b[k],0), r:filas.reduce((a,f)=>a+f.r[k],0)})
      const gvGrupos=(()=>{ const g={}; allM.forEach(m=>(rmes[m]?.gvItems||[]).forEach(e=>{ const l=[e.category,e.subcategory].filter(Boolean).join(' › ')||'Sin categoría'; g[l]=(g[l]||0)+(Number(e.amount)||0) }))
        const otr=allM.reduce((a,m)=>a+(Number((rmes[m]?.cosLines||[]).find(x=>x.k==='otr')?.m)||0),0); if(otr) g['Otros (planilla)']=otr
        return Object.entries(g).sort((a,b)=>b[1]-a[1]) })()
      const dCol=v=>Math.abs(v)<1?C.done:v>0?C.overdueText:C.greenText
      const dTxt=v=>Math.abs(v)<1?'—':(v>0?'+':'−')+fmtMill(Math.abs(v))
      const pct=bud>0?Math.abs(dv)/bud*100:0
      const per=cerM===12?String(yr):`ene–${MES_C[cerM-1]}`
      const kLb={fontSize:isDesktop?10:10,fontWeight:700,letterSpacing:isDesktop?.5:.3,textTransform:'uppercase',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden',lineHeight:1.25}
      const kt=(k,ic,bg,fg,lab,val,sub)=>{ const blanco=bg===C.card; return <div key={k} style={{background:bg,border:`1px solid ${blanco?C.border:'transparent'}`,borderRadius:12,padding:isDesktop?'13px 13px':'11px 10px',display:'flex',gap:isDesktop?11:8,alignItems:'center',minWidth:0}}>
        <KpiIco n={ic} c={fg} soft={blanco}/>
        <div style={{minWidth:0,flex:1}}><div style={{...kLb,color:fg}}>{lab}</div><div style={{fontSize:isDesktop?20:18,fontWeight:800,color:fg,letterSpacing:-.5,marginTop:2,whiteSpace:'nowrap',fontVariantNumeric:'tabular-nums'}}>{val}</div><div style={{fontSize:11,color:fg,opacity:.85,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden',lineHeight:1.25}}>{sub}</div></div></div> }
      const sobre=dv>0
      const estChip=<span style={{fontSize:10,fontWeight:700,color:C.soonText,background:C.ambarBg,borderRadius:20,padding:'1px 6px',marginLeft:5}}>est.</span>
      // Fila única para ambos formatos: escritorio = 4 columnas; celular = nombre con «ppto.» debajo, desvío y real a la derecha.
      const fila=(key,lab,b,r,{est,sub,open,on,tot:esTot,ppto}={})=>{ const d=r==null?null:r-b
        const nameCol=sub?C.muted:C.accent
        if(isDesktop) return <div key={key} onClick={on} style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) 110px 110px 100px',gap:10,alignItems:'center',padding:sub?'5px 14px 5px 30px':'9px 14px',borderTop:sub?'none':`1px solid ${esTot?C.border:C.bgSoft}`,background:sub||open?C.bgSoft:'transparent',cursor:on?'pointer':'default',fontSize:sub?12:13,fontVariantNumeric:'tabular-nums'}}>
          <span style={{fontWeight:esTot?800:sub?600:700,color:nameCol,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden',lineHeight:1.25}}>{lab}{est?estChip:null}{on?<span style={{marginLeft:6,display:'inline-block',verticalAlign:'middle'}}>{chev(open)}</span>:null}</span>
          <span style={{textAlign:'right',color:sub?C.muted:C.text,fontWeight:esTot?800:500}}>{fmtMill(b)}</span>
          <span style={{textAlign:'right',color:sub?C.muted:C.text,fontWeight:esTot?800:600}}>{r==null?<span style={{color:C.done}}>{ppto||'—'}</span>:fmtMill(r)}</span>
          <span style={{textAlign:'right',fontWeight:sub?600:700,color:d==null?C.done:dCol(d)}}>{d==null?'—':dTxt(d)}</span>
        </div>
        return <div key={key} onClick={on} style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) auto auto',gap:10,alignItems:'center',padding:sub?'6px 12px 6px 24px':'9px 12px',borderTop:sub?'none':`1px solid ${esTot?C.border:C.bgSoft}`,background:sub||open?C.bgSoft:'transparent',cursor:on?'pointer':'default',fontSize:sub?12:13,fontVariantNumeric:'tabular-nums'}}>
          <span style={{minWidth:0}}><span style={{display:'block',fontWeight:esTot?800:sub?600:700,color:nameCol,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{lab}{est?estChip:null}</span><span style={{display:'block',fontSize:11,color:C.done,whiteSpace:'nowrap'}}>ppto. {fmtMill(b)}</span></span>
          <span style={{fontSize:12,fontWeight:700,textAlign:'right',minWidth:54,color:d==null?C.done:dCol(d)}}>{d==null?'—':dTxt(d)}</span>
          <span style={{fontWeight:esTot?800:700,textAlign:'right',minWidth:58,color:sub?C.muted:C.text}}>{r==null?<span style={{color:C.done,fontWeight:400}}>{ppto||'—'}</span>:fmtMill(r)}</span>
        </div> }
      const head=(t)=>isDesktop?<div style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) 110px 110px 100px',gap:10,padding:'8px 14px',background:C.bgSoft}}>{[t,'Presupuesto','Real','Desvío'].map((h,i)=><span key={h} style={{fontSize:10,fontWeight:800,textTransform:'uppercase',letterSpacing:.3,color:C.accent,textAlign:i?'right':'left',whiteSpace:'nowrap'}}>{h}</span>)}</div>:null
      const pvOpen=open&&String(open).startsWith('pv')?open:(scope==='mes'?'pvm'+selM:null)
      const tg=id=>setOpen(o=>(o===id||(!o&&pvOpen===id))?'pvx':id)
      const mesFilas=f=>{ const id='pvm'+f.m, o=pvOpen===id; return [fila(id,isDesktop?MESES[f.m-1]:MES_C[f.m-1],f.bt,f.rt,{est:f.est,open:o,on:()=>tg(id)}),
        ...(o?CATS.flatMap(([k,l])=>{ const cid=f.m+k, oc=pvCat===cid; return [fila(id+k,l,f.b[k],f.r[k],{sub:true,open:oc,on:()=>setPvCat(x=>x===cid?null:cid)}),...(oc?[panelPartidas(f.m,k,f.b[k],f.r[k])]:[])] }):[])] }
      // Partidas reales de una categoría de un mes: cada una con su fuente (banco, planilla o presupuesto) y, si es un gasto, el clic que lo abre.
      const nPeso=v=>Number(v)||0
      const partidas=(m,k,bud)=>{ const r=rmes[m], pl=cmBy[m], ym=pad(m), rows=[]; if(!r) return {rows,liqs:[]}
        const estP=pl?(pl.cerrado?'cerrada':pl.estimado?'estimada':'abierta'):''
        const plan=(concepto,monto)=>({fecha:'',concepto,fuente:`Planilla ${estP} de ${MESES[m-1].toLowerCase()}`,monto:nPeso(monto),planilla:m})
        const gasto=(e,fuente)=>({fecha:String(e.date||'').slice(0,10),concepto:[e.subcategory,e.concept||e.description].filter(Boolean).join(' · ')||e.category||'Gasto',fuente,monto:nPeso(e.amount),gasto:e.id})
        if(!r.conPlanilla&&k!=='gv') rows.push({fecha:'',concepto:'Presupuesto de oficina',fuente:r.planillaIncompleta?'Planilla provisoria':'Sin planilla del mes',monto:bud})
        else if(k==='rem'){ if(r.remEst) rows.push(plan('Sueldos y honorarios',nPeso(pl?.sueldos)+nPeso(pl?.honorarios))); else r.remItems.forEach(x=>rows.push({fecha:String(x.e.date||'').slice(0,10),concepto:x.persona||'Sueldo',fuente:x.boleta?'Banco · boleta, costo bruto':'Banco · líquido pagado',monto:x.costo,gasto:x.e.id})) }
        else if(k==='con'){ if((r.conItems||[]).length) r.conItems.forEach(e=>rows.push(gasto(e,'Banco · gasto'))); else rows.push(plan('Contadora',pl?.contadora)) }
        else if(k==='cot') rows.push(plan('Cotizaciones',pl?.cotizaciones))
        else if(k==='arr'){ rows.push(plan('Arriendo',pl?.arriendo)); rows.push(plan('Gastos comunes',pl?.gastos_comunes)) }
        else if(k==='gv'){ if(!r.conPlanilla) rows.push({fecha:'',concepto:'Presupuesto de oficina',fuente:'Sin planilla del mes',monto:bud-r.gv}); else if(nPeso(pl?.otros_costos)) rows.push(plan('Otros costos',pl.otros_costos)); (r.gvItems||[]).forEach(e=>rows.push(gasto(e,'Banco · gasto'))) }
        return {rows:rows.filter(x=>x.monto!==0), liqs:k==='rem'?(liqs||[]).filter(x=>x.periodo===ym):[]} }
      const panelPartidas=(m,k,bud,real)=>{ const {rows,liqs:lq}=partidas(m,k,bud), tot=rows.reduce((a,x)=>a+x.monto,0), dif=Math.round(real-tot)
        const baja=async()=>{ await descargarXlsx({nombre:`Real_${CATS.find(c=>c[0]===k)[1].replace(/\s+/g,'_')}_${pad(m)}`,hoja:'Partidas',head:['Mes','Fecha','Concepto','Fuente','Monto'],filas:[...rows.map(x=>[pad(m),x.fecha,x.concepto,x.fuente,x.monto]),...lq.map(x=>[pad(m),'',`Liquidación ${x.persona}: imponible ${nPeso(x.imponible)}, cotizaciones ${nPeso(x.cotizaciones)}, impuesto único ${nPeso(x.impuesto_unico)}`,x.fuente,''])],anchos:[10,12,56,40,14],numCols:[4]}) }
        const idCorreo=f=>{ const x=String(f||'').match(/correo\s+([0-9a-f]+)/i); return x?x[1]:null }
        const pad2=isDesktop?'6px 14px 6px 44px':'6px 12px 6px 30px'
        const lin=(key,izq,sub,der,on)=><div key={key} onClick={on} style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) auto',gap:10,alignItems:'baseline',padding:pad2,background:C.bgSoft,cursor:on?'pointer':'default',fontVariantNumeric:'tabular-nums'}}><span style={{minWidth:0}}><span style={{display:'block',fontSize:12,fontWeight:600,color:C.text,lineHeight:1.25}}>{izq}{on?<span style={{marginLeft:6,display:'inline-block',verticalAlign:'middle'}}>{chev(false)}</span>:null}</span><span style={{display:'block',fontSize:11,color:C.muted,lineHeight:1.3}}>{sub}</span></span><span style={{fontSize:12,fontWeight:700,color:C.text,whiteSpace:'nowrap'}}>{der}</span></div>
        return <div key={'pp'+m+k}>
          {rows.map((x,i)=>lin(i,`${x.fecha?fmtFechaDMY(x.fecha)+' · ':''}${x.concepto}`,x.fuente,fmt(x.monto),x.gasto&&onOpenGasto?()=>onOpenGasto(x.gasto):x.planilla?()=>setEditM(x.planilla):null))}
          {k==='rem'&&<div style={{padding:pad2,background:C.bgSoft,fontSize:11,fontWeight:800,letterSpacing:.4,textTransform:'uppercase',color:C.accent}}>Liquidaciones leídas del correo</div>}
          {k==='rem'&&(lq.length?lq.map((x,i)=>{ const id=idCorreo(x.fuente); return lin('l'+i,x.persona,`imponible ${fmt(nPeso(x.imponible))} · cotizaciones ${fmt(nPeso(x.cotizaciones))} · impuesto único ${fmt(nPeso(x.impuesto_unico))}${id?'':''}`,id?<a href={`https://mail.google.com/mail/u/0/#all/${id}`} target='_blank' rel='noreferrer' onClick={e=>e.stopPropagation()} style={{color:C.azulInfo,fontWeight:700,textDecoration:'none'}}>Ver correo</a>:'',null) }):lin('l0','Sin liquidaciones leídas de este mes','Las del correo de la contadora no se han cargado; los sueldos de arriba salen del banco','',null))}
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,padding:pad2,background:C.bgSoft,borderBottom:`1px solid ${C.border}`}}>
            <span style={{fontSize:11,color:Math.abs(dif)>0?C.overdueText:C.muted}}>{Math.abs(dif)>0?`Partidas ${fmt(Math.round(tot))} · diferencia con el real ${fmt(dif)}`:`Las partidas suman el real: ${fmt(Math.round(tot))}`}</span>
            <button onClick={e=>{e.stopPropagation();baja()}} style={{fontSize:11.5,fontWeight:700,color:C.accent,background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:'3px 9px',cursor:'pointer'}}>Excel</button></div></div> }
      const ordM=isDesktop?filas:[...filas].reverse()
      const card2={background:C.card,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden',minWidth:0}
      const secT=t=><div style={{fontSize:10.5,fontWeight:800,letterSpacing:.5,textTransform:'uppercase',color:C.accent,margin:'16px 4px 8px'}}>{t}</div>
      return <>
        <div style={{fontSize:10.5,fontWeight:800,letterSpacing:.5,textTransform:'uppercase',color:C.muted,margin:'22px 4px 10px'}}>Presupuesto vs real · costos brutos, sin descontar el subarriendo · {per}{cerM<12?' '+yr:''}</div>
        <div style={{display:'grid',gridTemplateColumns:isDesktop?'repeat(4,minmax(0,1fr))':'repeat(2,minmax(0,1fr))',gap:8}}>
          {kt('pb','file',C.card,C.accent,'Presupuesto',fmtMill(bud),`costos ${per}`)}
          {kt('pr','wallet',C.azulBg,C.accent,'Real',fmtMill(real),'banco + planilla')}
          {kt('pd','alert',sobre?C.ambarBg:C.greenBg,sobre?C.soonText:C.greenText,'Desvío',dTxt(dv),`${pct.toFixed(1).replace('.',',')} % ${sobre?'sobre':'bajo'} ppto.`)}
          {kt('pp','chart',C.tealBg,C.tealText,'Costo proyectado',fmtMill(proy),`ppto. ${fmtMill(budAnio)}`)}
        </div>
        {secT('Mes a mes')}
        <div style={card2}>{head('Mes')}{ordM.flatMap(mesFilas)}
          {resto.length>0&&fila('pvresto',isDesktop?`${MESES[cerM]}${resto.length>1?'–'+MESES[11]:''}`:`${MES_C[cerM]}${resto.length>1?'–'+MES_C[11]:''}`,budResto,null,{ppto:'proyectado'})}
          {fila('pvtot',String(yr),budAnio,proy,{tot:true})}
        </div>
        {secT(`Por categoría · ${per}`)}
        <div style={card2}>{head('Categoría')}
          {CATS.flatMap(([k,l])=>{ const t=catTot(k), id='pvc'+k, o=pvOpen===id, dr=k==='gv'&&gvGrupos.length>0
            return [fila(id,l,t.b,t.r,{open:o,on:()=>tg(id)}), ...(o?[...(dr?gvGrupos.map(([g,v])=><div key={id+g} style={{display:'grid',gridTemplateColumns:isDesktop?'minmax(0,1fr) 110px 110px 100px':'minmax(0,1fr) auto',gap:10,padding:isDesktop?'5px 14px 5px 30px':'6px 12px 6px 24px',background:C.bgSoft,fontSize:12,color:C.muted,fontVariantNumeric:'tabular-nums'}}><span style={{minWidth:0,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden',lineHeight:1.25,fontWeight:600}}>{g}</span>{isDesktop?<span/>:null}<span style={{whiteSpace:'nowrap',fontWeight:600,textAlign:'right'}}>{fmtMill(v)}</span>{isDesktop?<span/>:null}</div>):[]),...filas.filter(f=>f.b[k]||f.r[k]).flatMap(f=>{ const cid=f.m+k, oc=pvCat===cid; return [fila(id+'m'+f.m,isDesktop?MESES[f.m-1]:MES_C[f.m-1],f.b[k],f.r[k],{sub:true,est:f.est,open:oc,on:()=>setPvCat(x=>x===cid?null:cid)}),...(oc?[panelPartidas(f.m,k,f.b[k],f.r[k])]:[])] })]:[])] })}
          {fila('pvctot','Total',bud,real,{tot:true})}
        </div>
      </>
    })()}

    {soloControl&&(()=>{
      const cerM=yr<curY?12:curM-1   // solo meses cerrados: el mes en curso trae costos parciales y se compararía contra su presupuesto completo
      const allM=Array.from({length:cerM},(_,i)=>i+1)
      const sinEnl=(ventas||[]).filter(d=>String(d.fecha_emision||'').slice(0,4)===String(yr)&&[33,34,61].includes(Number(d.tipo_dte))&&!d.billing_id)
      const faltaClaudia=allM.filter(m=>{ const r=cmBy[m]; return r && (Number(r.cotizaciones)===0||Number(r.ppm)===0||r.estimado) })
      const sldFalta=allM.filter(m=>{ const r=cmBy[m]; return !r || Number(r.sueldos)===0 })
      const pendCierre=allM.filter(m=>cierreDisponible(m)&&mesEstado(m)!=='cerrado')   // ya corresponde cerrar por fecha, pero faltan datos o está estimado
      const descF=fondosChk.desc
      // Un mes con factura de subarriendo pero sin ítem `es_ingreso` vigente en Costos de Oficina: el subarriendo desaparece del resultado (ya no suma a ingresos).
      const subSinItem=months.filter(m=>recuperadoOficinaMes(costosOfiRows,pad(m))===0&&(billing||[]).some(b=>b&&!b.deleted_at&&b.billing_type==='subarriendo'&&b.invoice_no&&b.status!=='Anulada'&&String(b.issued_at||'').startsWith(pad(m))))
      // Boletas de honorarios por cargar: pagos a quien emite boleta (o comisiones con retención) sin su boleta cargada; regla única en _shared/impuestosMensuales.js.
      const bPorCargar=listaBoletasPorCargar({pagos:pagosB,boletas:imps.boletas,declarados:imps.declarados,desde:`${yr}-01`,destinos}).filter(x=>x.per.startsWith(String(yr)))
      const bFalta=bPorCargar.filter(x=>x.estado==='falta')
      const checks=[
        [sinEnl.length===0,'Facturas del SII',sinEnl.length?`${sinEnl.length} sin enlazar a una venta · tócalo para ver cuáles`:'todas enlazadas a una venta', sinEnl.length?{label:sinEnlOpen?'ocultar':'ver',on:()=>setSinEnlOpen(o=>!o)}:null],
        [pendCierre.length===0,'Cierre de meses',pendCierre.length?`${pendCierre.length} mes${pendCierre.length!==1?'es':''} por cerrar · faltan datos reales (completa abajo)`:`se cierran solos · ${nCerrados} cerrado${nCerrados!==1?'s':''}`, null],
        [faltaClaudia.length===0,'Cotizaciones y pago al SII (Claudia)',faltaClaudia.length?`${faltaClaudia.length} mes${faltaClaudia.length!==1?'es':''} con valores pendientes o estimados`:'todos con los valores reales de Claudia', faltaClaudia.length?{label:'editar',on:()=>abrirEditor(faltaClaudia[0])}:null],
        [bFalta.length===0,'Boletas por cargar',bFalta.length?`${bFalta.length} boleta${bFalta.length!==1?'s':''} de honorarios sin cargar${bPorCargar.length>bFalta.length?` · ${bPorCargar.length-bFalta.length} por verificar`:''}`:(bPorCargar.length?`${bPorCargar.length} por verificar`:'todas las boletas de los pagos están cargadas'), bPorCargar.length?{label:'ver',on:()=>{ const x=(bFalta[0]||bPorCargar[0]); setEditM(Number(x.per.slice(5,7))); setImpDet({m:Number(x.per.slice(5,7)),tipo:'retencion'}) }}:null],
        [subSinItem.length===0,'Subarriendo en Costos de Oficina',subSinItem.length?`${subSinItem.length} mes${subSinItem.length!==1?'es':''} con factura de subarriendo y sin el ítem que baja el costo en Costos de Oficina: el subarriendo no aparece en el resultado`:'el subarriendo facturado tiene su ítem en Costos de Oficina'],
        [descF.length===0,'Fondos de clientes',descF.length?`${descF.length} cliente${descF.length!==1?'s':''} cuyo reparto por fondo no suma su saldo: ${descF.slice(0,3).join(', ')}`:`el reparto por fondo suma el saldo de cada ficha · ${fondosChk.n} clientes`],
        [sldFalta.length===0,'Sueldos de la planilla',sldFalta.length?`${sldFalta.length} mes${sldFalta.length!==1?'es':''} sin sueldos cargados · confírmalos con las liquidaciones`:'cargados en todos los meses · confírmalos con las liquidaciones', sldFalta.length?{label:'editar',on:()=>abrirEditor(sldFalta[0])}:null],
      ,...(checksExtra||[])]
      return <><div style={{fontSize:10.5,fontWeight:800,letterSpacing:.5,textTransform:'uppercase',color:C.muted,margin:'22px 4px 10px'}}>Salud de datos</div>
        <div style={card}>{(()=>{ const out=[]; checks.forEach(([ok,t,d,act],i)=>{
          out.push(<div key={'c'+i} onClick={act?act.on:undefined} style={{display:'flex',alignItems:'center',gap:11,padding:'12px 16px',borderTop:i?`1px solid ${C.bgSoft}`:'none',cursor:act?'pointer':'default'}}>
            <span style={{width:28,height:28,borderRadius:'50%',background:ok?C.greenBg:C.soonBg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{ok
              ?<svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke={C.greenText} strokeWidth='2.6' strokeLinecap='round' strokeLinejoin='round'><path d='M20 6 9 17l-5-5'/></svg>
              :<svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke={C.soonText} strokeWidth='2.4' strokeLinecap='round' strokeLinejoin='round'><path d='M12 9v4M12 17h.01'/><path d='M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z'/></svg>}</span>
            <span style={{minWidth:0,flex:1}}><span style={{fontSize:13,fontWeight:700,color:C.accent,display:'block'}}>{t}</span><span style={{fontSize:11,color:ok?C.done:C.soonText}}>{d}</span></span>
            {act&&<span style={{flexShrink:0,fontSize:11,fontWeight:800,color:C.soonText,whiteSpace:'nowrap'}}>{act.label} <Gl n='chevron'/></span>}
          </div>)
          if(i===0&&sinEnlOpen&&sinEnl.length>0) out.push(<div key='sinenl' style={{padding:'0 16px 12px'}}><div style={{background:C.overdueBg,borderRadius:10,overflow:'hidden'}}>{sinEnl.slice().sort((a,b)=>String(a.fecha_emision||'').localeCompare(String(b.fecha_emision||''))).map((d,j)=><div key={j} style={{display:'flex',justifyContent:'space-between',gap:10,padding:'7px 12px',fontSize:12,color:C.overdueText,fontWeight:600,borderTop:j?'1px solid rgba(163,45,45,.14)':'none'}}><span>{Number(d.tipo_dte)===61?'NC · ':''}N° {d.folio} · {d.receptor_name||'—'}</span><span style={{fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fmt(Number(d.monto)||0)}</span></div>)}</div></div>)
        }); return out })()}</div></>
    })()}
  </div>)
}

