// Movido desde App.jsx por scripts/mover-a-modulo.py. Sin cambios de comportamiento.
import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react'
import { supabase, DEMO } from '../supabase'
import { demoData } from '../demoData'
import { parseCartola, normRut as crNormRut, rutValido, esRutPropio, huellaGlosa, fechaGlosaISO } from '../cartola.js'
import { candidatosFactura, elegirFactura, elegirCombo, folioEnTexto } from '../../supabase/functions/_shared/conciliacionReglas.js'
import { pagarT, reajusteBHEPago, estadoComision } from '../../supabase/functions/_shared/comisionesReglas.js'
import { planCarga } from '../../supabase/functions/_shared/cartolaDedupe.js'
import { nombreGenerico } from '../../supabase/functions/_shared/contrapartes.js'
import { liqParaCargo as _liqParaCargo } from '../../supabase/functions/_shared/notariaReglas.js'
import { cuentaEnSaldo, propuestaFondoRendicion } from '../../supabase/functions/_shared/gastosReglas.js'
import { glosaKey } from '../../supabase/functions/_shared/ventaGastoReglas.js'
import * as SD from '../../supabase/functions/_shared/saludDatos.js'
import { C, Gl, SEC_LBL, SIcon, _normTxt, appAlert, appConfirm, diaGrande, fmt, fmtFechaDMY, fmtN, fmtRutCL, folioN, isoLocal, useIsDesktop } from '../lib/base.jsx'
import { ADMIN_NAMES, AsignarClienteInline, BitacoraLista, CATS_LEGALES, CATS_OFICINA_NUEVAS, Copyable, EQUIPO_CFG, FlujoPagina, MESES_ABR, Modal, RESPALDO_CUTOFF, SOCIOS_CFG, Sparkle, _ccDia, _ccEsAjuste, _esDiaHabil, _glosaTransf, _norm, acusePagoEmail, calceCajaChica, catOficinaNueva, claudeCall, concPeriodoOf, driveToken, esFacIngreso, esSubarriendo, estadoFacturaLabel, extraerTextoGmail, facturaRespaldo, fmtShort, glosaFactura, learnPut, logActividad, montoFactura, nDias, proyectoSeguro, rsLabel, saldoCliente, setLearningKV, txtEnviado, usePersistedState, viewMemGuardar, viewMemLeer } from '../lib/compartido.jsx'

// Días hábiles (no feriados) SIN cartola entre la última cargada y ayer, cuya cartola ya debió llegar. cov = Set de fechas 'YYYY-MM-DD' ya cubiertas
// por cartola_cargas (días con carga registrada, aunque vinieran vacíos). Fuente de la alerta "faltan cartolas".
// Tope de 60 días de barrido: si la frontera está más atrás, es un problema mayor (no la alarma de envío diario).
export function cartolaGapDias(cartolaHasta, cov){
  if(!cartolaHasta) return []
  const set = cov instanceof Set ? cov : new Set()
  const out=[]; const today=new Date(); today.setHours(0,0,0,0)
  const d=new Date(String(cartolaHasta).slice(0,10)+'T00:00:00'); if(isNaN(d)) return []
  d.setDate(d.getDate()+1); let guard=0
  // La cartola de un día hábil llega el día hábil SIGUIENTE (la del viernes, el lunes): recién ahí falta (misma regla que alerta-cartola).
  const sigHabil=d0=>{ const x=new Date(d0); let g=0; do{ x.setDate(x.getDate()+1) }while(!_esDiaHabil(x)&&g++<15); return x }
  while(d<today && guard++<60){ const s=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; if(_esDiaHabil(d)&&!set.has(s)&&sigHabil(d)<=today) out.push(s); d.setDate(d.getDate()+1) }
  return out
}

// Nombre de una factura en Banco y listas: «Comisión por facturar» si es un cobro de comisión aún sin folio.
export const lblFacturaN = b => b&&!b.invoice_no&&b.billing_type==='comision' ? 'Comisión por facturar' : `Factura N° ${folioN(b?.invoice_no)||'—'}`

// Abono conciliado solo en parte (ej. $2.320.000 con $566.460 aplicados a una factura): el resto sigue por resolver.
// Umbral $1.000 para no reabrir diferencias de UF/redondeo. Monto pendiente = monto − conciliado.
export const abonoConResto = m => !!m && m.tipo==='abono' && !m.es_interno && String(m.estado)==='parcial' && (Math.abs(Number(m.monto)||0)-(Number(m.monto_conciliado)||0))>1000

export const restoAbono = m => abonoConResto(m) ? Math.abs(Number(m.monto)||0)-(Number(m.monto_conciliado)||0) : (Number(m?.monto)||0)

// Marca en terceros_pagos.referencia de un costo registrado directo desde un cargo de Banco (su Deshacer lo borra).
export const REF_COSTO_BANCO = 'Registrado desde Banco'

// Pago del banco ↔ comisiones por pagar. Orden seguro: primero la conciliación (si la base la rechaza no se toca nada), después las
// comisiones y al final el cargo; si un paso falla se revierte lo anterior. Lo usan Banco y la ficha del proveedor.
export async function conciliarPagoComisiones(m, ids, sum){
  const {data:cc,error:e1}=await supabase.from('conciliacion').insert({movimiento_id:m.id,tipo_destino:'tercero',monto_aplicado:sum,origen:'manual'}).select().single()
  if(e1) throw e1
  const {error:e2}=await supabase.from('terceros_pagos').update({estado:'pagado',pagado_at:String(m.fecha).slice(0,10),movimiento_id:m.id}).in('id',ids)
  if(e2){ await supabase.from('conciliacion').delete().eq('id',cc.id); throw e2 }
  try{ const {data:rs}=await supabase.from('terceros_pagos').select('id,monto,liquido,retencion,bhe_id').in('id',ids)
    for(const t of (rs||[])){ const pt=reajusteBHEPago(t,m.fecha); if(pt) await supabase.from('terceros_pagos').update(pt).eq('id',t.id) } }catch(_){}
  const aplicado=(Number(m.monto_conciliado)||0)+sum
  const estado=(Math.abs(Number(m.monto)||0)-aplicado)<=1?'conciliado':'parcial'
  const {error:e3}=await supabase.from('cartola_movimientos').update({categoria:m.categoria||'Proveedor',monto_conciliado:aplicado,estado}).eq('id',m.id)
  if(e3){ await supabase.from('terceros_pagos').update({estado:'por_pagar',pagado_at:null,movimiento_id:null}).in('id',ids); await supabase.from('conciliacion').delete().eq('id',cc.id); throw e3 }
  return {conc:cc, aplicado, estado}
}

// Lee el último correo "VALORES MM-YYYY" de la contadora y la IA extrae los costos del mes (Cotizaciones→Leyes sociales, IVA=PPM→Impuestos, Contadora→Remuneraciones) con monto y fecha. PROD (Gmail + IA); compuerta humana en la UI.
export async function leerValoresClaudia(){
  const token=await driveToken()
  if(!token){ const e=new Error('Sin token de Google'); e.code=401; throw e }
  const q=encodeURIComponent('from:clsvsaez6@hotmail.com subject:VALORES')
  const r=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=3`,{headers:{Authorization:'Bearer '+token}})
  if(!r.ok){ const e=new Error('Gmail '+r.status); e.code=r.status; throw e }
  const j=await r.json(); const id=(j.messages||[])[0]?.id
  if(!id) return null
  const rm=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,{headers:{Authorization:'Bearer '+token}})
  if(!rm.ok){ const e=new Error('Gmail '+rm.status); e.code=rm.status; throw e }
  const jm=await rm.json()
  const H={}; (jm.payload?.headers||[]).forEach(h=>H[h.name.toLowerCase()]=h.value)
  const subject=H['subject']||''; const body=extraerTextoGmail(jm)||''
  const prompt=`De este correo de la contadora del estudio (asunto "${subject}"), extrae los costos a pagar del mes. IMPORTANTE: lo que ella llama "IVA" es en realidad el PPM. Devuelve SOLO un JSON array, sin texto extra: [{"item":"Cotizaciones Sueldos","categoria":"Leyes sociales","monto":2076519,"vence":"YYYY-MM-DD o null"}]. Categorías válidas EXACTAS: "Leyes sociales" (para cotizaciones/imposiciones), "Impuestos y patentes" (para PPM o lo que ella llame IVA), "Remuneraciones" (para contadora o sueldos). El monto es un número entero, sin puntos ni signos. La fecha del correo puede decir "se paga el jueves 20-08" → 2026-08-20. No inventes nada que no esté en el correo.\n\nCORREO:\n${String(body).slice(0,3000)}`
  const data=await claudeCall({model:'claude-opus-4-8',max_tokens:900,messages:[{role:'user',content:prompt}]})
  const arr=JSON.parse((data.content?.[0]?.text||'').match(/\[[\s\S]*\]/)?.[0]||'[]')
  return { subject, mes:(subject.match(/(\d{2}-\d{4})/)||[])[1]||'', items:(arr||[]).filter(o=>o&&o.item&&Number(o.monto)>0).map(o=>({item:String(o.item),categoria:String(o.categoria||'Impuestos y patentes'),monto:Math.round(Number(o.monto)||0),vence:(/^\d{4}-\d{2}-\d{2}$/.test(o.vence||'')?o.vence:null)})) }
}

// Revisión histórica: el STOCK de facturas COBRADAS (Pagado) SIN respaldo bancario de un año → las cruza con la cartola
// cargada (abono del mismo cliente/RUT, monto exacto, fecha cercana al pago). Separa calce exacto (conciliar en lote) /
// por revisar / sin pago, mes a mes. Concilia reusando onConciliar=reconciliar (fuente única; una Pagado sin respaldo
// tiene saldoFactura=monto, así que se liga sin cambiar estado ni mandar correo). No re-usa un mismo abono dos veces.
export function CobradasSinRespaldoPage({billing=[],movs=[],clients=[],clientEntities=[],aplicadoByFactura={},onConciliar,busy,onOpenClientFicha,onClose}){
  const isDesktop = useIsDesktop()
  const fmtM = fmt
  const nrm = crNormRut   // normalizador único de RUT
  const cmap = useMemo(()=>{ const m={}; (clients||[]).forEach(c=>m[c.id]=c.name); return m },[clients])
  // Fecha de trabajo: paid_at (marca de pago) o, si quedó sin fecha (marcada a mano/Excel), issued_at.
  const fechaOf = b => String(b.paid_at||b.issued_at||'').slice(0,10)
  // TODAS las cobradas NO conciliadas: Pagado, no borrada, no reembolso, y el banco NO cubre el total (aplicado<monto).
  // Sin exigir folio (muchas se marcaron a mano/Excel sin folio) ni fecha de pago ni cutoff.
  // Consolidación: los duplicados (folio repetido o fantasma sin folio) NO aparecen aquí — se manejan en el módulo
  // Duplicados, para que cada documento viva en un solo lugar y las dos vistas no se contradigan.
  const dupIds = useMemo(()=>{ const ids=new Set(); const act=(billing||[]).filter(b=>!b.deleted_at && b.status!=='Anulada' && b.status!=='Anulado')
    const byF={}; act.forEach(b=>{ const f=folioN(b.invoice_no); const d=(f&&/\d/.test(f))?f:null; if(d){ const k=b.client_id+'|'+d; (byF[k]=byF[k]||[]).push(b) } })
    Object.values(byF).forEach(g=>{ if(g.length<2) return; const keep=[...g].sort((a,b)=>((a.invoice_no?0:1)-(b.invoice_no?0:1))||((b.status==='Pagado')-(a.status==='Pagado')))[0]; g.forEach(x=>{ if(String(x.id)!==String(keep.id)) ids.add(String(x.id)) }) })
    act.filter(b=>b.status==='Pagado' && !b.invoice_no && (b.billing_type||'')!=='reembolso').forEach(g=>{ const a=g.amount||0; const real=a&&act.find(r=>r.invoice_no&&String(r.client_id)===String(g.client_id)&&Math.abs((r.amount||0)-a)/a<=0.02); if(real) ids.add(String(g.id)) })
    return ids },[billing])
  const noConciliada = b => !b.deleted_at && b.status==='Pagado' && (b.billing_type||'')!=='reembolso' && (aplicadoByFactura[b.id]||0) < (b.amount||0) && !dupIds.has(String(b.id))
  const yrs = [...new Set((billing||[]).filter(noConciliada).map(b=>fechaOf(b).slice(0,4)).filter(Boolean))].sort().reverse()
  const curYr = String(new Date().getFullYear())
  const [yr,setYr]=useState(()=> yrs.includes(curYr)?curYr:'todos')   // arranca en el año vivo; el histórico queda detrás del filtro
  const [openHist,setOpenHist]=useState(false)   // bloque "sin respaldo" colapsado
  const [showEx,setShowEx]=useState(false)        // ver todos los de calce exacto
  const [showRev,setShowRev]=useState(false)      // ver todos los por revisar
  const [pickFac,setPickFac]=useState(null)      // factura con candidatos alternativos desplegados
  const [montoFacFor,setMontoFacFor]=useState(null)   // movimiento sin identificar cuyas facturas-por-monto (último criterio) están desplegadas para elegir
  const [loteBusy,setLoteBusy]=useState(false)
  const [loteProg,setLoteProg]=useState(0)
  const rutsFac = fac => { const s=new Set(); const add=r=>{const n=nrm(r); if(n)s.add(n)}; add(fac.receptor_rut); const e=(clientEntities||[]).find(x=>String(x.id)===String(fac.entity_id)); if(e)add(e.rut); const c=(clients||[]).find(x=>String(x.id)===String(fac.client_id)); if(c)add(c.rut); (clientEntities||[]).filter(x=>String(x.client_id)===String(fac.client_id)).forEach(x=>add(x.rut)); return s }
  const candsFor = fac => { const facR=rutsFac(fac); const amt=montoFactura(fac); const pf=fechaOf(fac); const pt=pf?new Date(pf+'T12:00').getTime():null   // base = DTE, no el amount programado
    return (movs||[]).filter(m=> m.tipo==='abono' && !m.es_interno && ((m.monto||0)-(m.monto_conciliado||0))>0 && (String(m.cliente_id)===String(fac.client_id) || (m.rut_contraparte&&facR.has(nrm(m.rut_contraparte)))))
      .map(m=>{ const resto=(m.monto||0)-(m.monto_conciliado||0); const dt=m.fecha?new Date(m.fecha+'T12:00').getTime():null; const dias=(pt&&dt)?Math.round((dt-pt)/86400000):null; return {m,resto,dias,exacto:resto===amt,adias:dias==null?99999:Math.abs(dias)} })
      .sort((a,b)=> (b.exacto-a.exacto)||(a.adias-b.adias)) }
  const items = useMemo(()=>{ const cob=(billing||[]).filter(b=> noConciliada(b) && (yr==='todos' || fechaOf(b).slice(0,4)===yr) )
    return cob.map(fac=>{ const f=fechaOf(fac); const historica=!!f&&f<RESPALDO_CUTOFF; const parcial=(aplicadoByFactura[fac.id]||0)>0; const cs=candsFor(fac); const ex=cs.filter(c=>c.exacto); const best=ex.length===1?ex[0]:null; const cls=best?'exacto':(cs.length?'revisar':'sinpago'); return {fac,f,cs,ex,best,cls,historica,parcial} })
      .sort((a,b)=> String(a.f).localeCompare(String(b.f))) },[billing,movs,aplicadoByFactura,yr])   // eslint-disable-line
  const byDateDesc=(a,b)=>String(b.f).localeCompare(String(a.f))   // más reciente primero
  const exactos=items.filter(i=>i.cls==='exacto').sort(byDateDesc)
  const revisarL=items.filter(i=>i.cls==='revisar').sort(byDateDesc)
  const sinpago=items.filter(i=>i.cls==='sinpago')
  const histor=sinpago.filter(i=>i.historica), otros=sinpago.filter(i=>!i.historica)
  const nExacto=exactos.length, nRev=revisarL.length, nSin=sinpago.length, nAcc=nExacto+nRev
  const conciliarExactos = async()=>{ if(loteBusy||busy) return; setLoteBusy(true); setLoteProg(0); const used=new Set(); let done=0
    for(const it of items.filter(i=>i.cls==='exacto')){ if(used.has(it.best.m.id)) continue; used.add(it.best.m.id); try{ await onConciliar(it.best.m, it.fac) }catch(_){}; done++; setLoteProg(done) } setLoteBusy(false) }
  const depLine = m => `${fmtFechaDMY(m.fecha)}${m.rut_contraparte?` · ${m.rut_contraparte}`:''}${m.n_operacion?` · N° op. ${m.n_operacion}`:''}`
  const diasTxt = d => d==null?'':d===0?'mismo día':`${d>0?'+':''}${d} d`
  const Deposito = ({c,fac})=>(
    <div style={{display:'flex',alignItems:'center',gap:8,padding:'6px 0',borderTop:`1px solid ${C.bgSoft}`}}>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:11}}><b style={{color:C.greenText}}>+{fmtM(c.m.monto)}</b> <span style={{color:C.textSoft}}>· {depLine(c.m)}</span></div>
        <div style={{display:'flex',gap:5,marginTop:2,flexWrap:'wrap'}}>
          <span style={{fontSize:9.5,fontWeight:700,color:c.exacto?C.greenText:C.soonText,background:c.exacto?C.greenBg:C.soonBg,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap'}}>{c.exacto?<><Gl n='tick'/>{" "}monto exacto</>:`dif ${fmtM(Math.abs(c.resto-montoFactura(fac)))}`}</span>
          {c.dias!=null&&<span style={{fontSize:9.5,fontWeight:700,color:C.muted,background:C.bgSoft,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap'}}>{diasTxt(c.dias)}</span>}
          {c.m.descripcion&&<span style={{fontSize:9,color:C.muted,maxWidth:150,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.m.descripcion.slice(0,40)}</span>}
        </div>
      </div>
      <button disabled={!!busy||loteBusy} onClick={()=>onConciliar(c.m,fac)} style={{fontSize:10,fontWeight:700,color:'#fff',background:C.accent,border:'none',borderRadius:8,padding:'5px 12px',cursor:(busy||loteBusy)?'default':'pointer',flexShrink:0}}>Conciliar</button>
    </div>
  )
  // Tarjeta de una cobrada accionable (calce exacto o por revisar), cliente protagonista y clickeable a su ficha.
  const FacCard = (it) => { const fac=it.fac; const rs=fac.receptor_name||cmap[fac.client_id]||'—'
    return (
    <div key={fac.id} style={{border:`1px solid ${it.cls==='exacto'?'#BFE3D5':C.border}`,borderRadius:12,padding:'10px 12px',marginBottom:8}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'baseline'}}>
        <span onClick={()=>onOpenClientFicha&&fac.client_id&&onOpenClientFicha(fac.client_id)} style={{fontSize:14,fontWeight:800,color:C.accent,cursor:onOpenClientFicha?'pointer':'default',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{rs}</span>
        <span style={{fontSize:14,fontWeight:800,color:C.text,flexShrink:0}}>{fmtM(fac.amount)}</span>
      </div>
      <div style={{fontSize:11,color:C.muted,marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{folioN(fac.invoice_no)?`Factura N° ${folioN(fac.invoice_no)} · `:'sin folio · '}{fac.concept||'—'}{fac.paid_at?` · cobrada ${fmtFechaDMY(fac.paid_at)}`:''}{it.parcial?` · parcial (falta ${fmtM((fac.amount||0)-(aplicadoByFactura[fac.id]||0))})`:''}</div>
      {it.cls==='exacto'&&<Deposito c={it.best} fac={fac}/>}
      {it.cls==='revisar'&&<>
        <div style={{fontSize:10,fontWeight:700,color:C.soonText,marginTop:5}}>{it.ex.length>1?`${it.ex.length} pagos calzan exacto — elige`:'ningún pago calza exacto — revisa los cercanos'}</div>
        {(pickFac===fac.id?it.cs:it.cs.slice(0,3)).map(c=><Deposito key={c.m.id} c={c} fac={fac}/>)}
        {it.cs.length>3&&<button onClick={()=>setPickFac(pickFac===fac.id?null:fac.id)} style={{fontSize:10,color:C.accent,background:'none',border:'none',cursor:'pointer',marginTop:3,padding:0}}>{pickFac===fac.id?'ver menos':`ver ${it.cs.length-3} más`}</button>}
      </>}
    </div>) }
  const secLbl = t => <div style={{...SEC_LBL,margin:'16px 2px 8px'}}>{t}</div>
  const verMas = (n,open,setOpen,txt) => n>0 && <div onClick={()=>setOpen(!open)} style={{textAlign:'center',fontSize:11,fontWeight:600,color:C.accent,cursor:'pointer',padding:'4px 0 8px'}}>{open?'ver menos':`${n} ${txt} ▾`}</div>
  return (
    <div style={{paddingBottom:80,...(isDesktop?{maxWidth:900,margin:'0 auto'}:{})}}>
      <div style={{padding:'18px 20px 10px',position:'sticky',top:0,background:C.bg,zIndex:10,borderBottom:`1px solid ${C.border}`}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <button onClick={onClose} style={{background:'none',border:'none',color:C.accent,cursor:'pointer',fontSize:20,lineHeight:1,padding:'0 4px 0 0'}}><Gl n='chevL'/></button>
          <div style={{minWidth:0}}>
            <div style={{fontSize:20,fontWeight:600,color:C.text,letterSpacing:-.4}}>Conciliar cobradas · cartola</div>
            <div style={{fontSize:11,color:C.muted}}>cobradas sin respaldo · {items.length}</div>
          </div>
        </div>
      </div>
      <div style={{padding:'14px 20px 0'}}>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12,flexWrap:'wrap'}}>
        <select value={yr} onChange={e=>{setYr(e.target.value);setPickFac(null)}} style={{fontSize:13,fontWeight:600,padding:'5px 9px',borderRadius:8,border:`1px solid ${C.border}`,color:C.accent}}><option value='todos'>Todos</option>{yrs.map(y=><option key={y} value={y}>{y}</option>)}</select>
      </div>
      {items.length===0
        ? <div style={{background:C.greenBg,border:'1px solid #BFE3D5',borderRadius:12,padding:'14px',fontSize:12,color:C.greenText,fontWeight:600}}><Gl n='tick'/> {yr==='todos'?'Ninguna cobrada quedó sin respaldo.':`Ninguna cobrada del ${yr} quedó sin respaldo.`}</div>
        : <>
        {/* FOTO: protagonista = lo accionable (tiene pago en la cartola); lo demás baja */}
        <div style={{border:`1px solid ${C.border}`,borderRadius:14,overflow:'hidden',marginBottom:14}}>
          <div style={{background:C.greenBg,padding:'14px 15px',display:'flex',alignItems:'center',gap:13}}>
            <div style={{fontSize:30,fontWeight:800,color:C.greenText,lineHeight:1,letterSpacing:'-1px'}}>{nAcc}</div>
            <div style={{fontSize:13,color:C.greenText,fontWeight:600}}>por conciliar<div style={{color:C.muted,fontWeight:500,fontSize:11,marginTop:2}}>tienen el pago en la cartola cargada — falta ligarlos</div></div>
          </div>
          <div style={{display:'flex',borderTop:`1px solid ${C.border}`}}>
            <div style={{flex:1,padding:'9px 14px',fontSize:12}}><b style={{fontSize:15,fontWeight:800,color:C.greenText,display:'block'}}>{nExacto}</b>calce exacto</div>
            <div style={{flex:1,padding:'9px 14px',fontSize:12,borderLeft:`1px solid ${C.border}`}}><b style={{fontSize:15,fontWeight:800,color:C.soonText,display:'block'}}>{nRev}</b>por revisar</div>
          </div>
        </div>

        {nAcc===0&&<div style={{fontSize:13,color:C.muted,padding:'2px 2px 12px'}}>Ninguna cobrada de {yr==='todos'?'la historia':yr} tiene un pago en la cartola por ligar. Lo que queda está más abajo, sin acción.</div>}

        {/* CALCE EXACTO: listado y visible + atajo de lote */}
        {nExacto>0&&<>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',margin:'6px 2px 8px'}}>
            <span style={{fontSize:11,fontWeight:800,letterSpacing:'.5px',textTransform:'uppercase',color:C.muted}}>Calce exacto · {nExacto}</span>
            <button disabled={loteBusy||!!busy} onClick={conciliarExactos} style={{fontSize:11,fontWeight:700,color:'#fff',background:C.greenText,border:'none',borderRadius:8,padding:'6px 11px',cursor:(loteBusy||busy)?'default':'pointer',opacity:(loteBusy||busy)?.7:1}}>{loteBusy?`Conciliando ${loteProg}/${nExacto}…`:`Conciliar los ${nExacto}`}</button>
          </div>
          {(showEx?exactos:exactos.slice(0,4)).map(it=>FacCard(it))}
          {verMas(exactos.length-4,showEx,setShowEx,'más de calce exacto')}
        </>}

        {/* POR REVISAR */}
        {nRev>0&&<>
          {secLbl(`Por revisar · ${nRev}`)}
          {(showRev?revisarL:revisarL.slice(0,6)).map(it=>FacCard(it))}
          {verMas(revisarL.length-6,showRev,setShowRev,'más por revisar')}
        </>}

        {/* SIN RESPALDO: colapsado, honesto (nada de "cargar cartola") */}
        {nSin>0&&<div style={{border:`1px solid ${C.border}`,borderRadius:12,background:C.bgSoft,marginTop:16,overflow:'hidden'}}>
          <div onClick={()=>setOpenHist(!openHist)} style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',padding:'12px 14px',cursor:'pointer',gap:10}}>
            <div><div style={{fontSize:13,fontWeight:800,color:C.text}}>{nSin} sin respaldo en el banco</div><div style={{fontSize:11,color:C.muted,marginTop:2}}>No hay un pago que calce, y no se espera cartola de esos meses. No requieren conciliación.</div></div>
            <span style={{color:C.textSoft,flexShrink:0}}>{openHist?<Gl n='chevD'/>:<Gl n='chevron'/>}</span>
          </div>
          {openHist&&<div style={{padding:'0 14px 12px'}}>
            {histor.length>0&&<div style={{paddingTop:9,borderTop:`1px solid ${C.border}`}}><div style={{fontSize:12,color:C.text}}><b>{histor.length} históricas</b> · antes de feb-2025</div><div style={{fontSize:11,color:C.muted,marginTop:2}}>Pagadas antes de la integración bancaria. Sin respaldo esperado — se dejan así.</div></div>}
            {otros.length>0&&<div style={{paddingTop:10,marginTop:9,borderTop:`1px solid ${C.border}`}}><div style={{fontSize:12,color:C.text}}><b>{otros.length} sin depósito que calce</b></div><div style={{fontSize:11,color:C.muted,marginTop:2}}>Marcadas como pagadas pero sin movimiento en la cartola: cobros en efectivo, otra cuenta, o una marca de Pagado sin depósito real. No hay nada que conciliar; revisa solo si crees que alguna quedó mal marcada como pagada.</div>
              <div style={{marginTop:8,display:'flex',flexDirection:'column',gap:5}}>{otros.slice(0,40).map(it=>{ const fac=it.fac; const rs=fac.receptor_name||cmap[fac.client_id]||'—'
                return <div key={fac.id} onClick={()=>onOpenClientFicha&&fac.client_id&&onOpenClientFicha(fac.client_id)} style={{display:'flex',justifyContent:'space-between',gap:8,fontSize:11,padding:'6px 9px',background:'#fff',border:`0.5px solid ${C.border}`,borderRadius:8,cursor:onOpenClientFicha?'pointer':'default'}}>
                  <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:C.accent,fontWeight:600}}>{rs}{folioN(fac.invoice_no)?` · N° ${folioN(fac.invoice_no)}`:''}</span>
                  <span style={{color:C.muted,whiteSpace:'nowrap',flexShrink:0}}>{fmtM(fac.amount)}{fac.paid_at?` · ${fmtFechaDMY(fac.paid_at)}`:''}</span>
                </div> })}
                {otros.length>40&&<div style={{fontSize:11,color:C.faint||C.muted,textAlign:'center',paddingTop:3}}>y {otros.length-40} más</div>}</div>
            </div>}
          </div>}
        </div>}
      </>}
      </div>
    </div>
  )
}

// Confirmación detallada del "Conciliar en lote": en vez del aviso genérico, lista CADA par abono↔factura
// (cliente protagonista · factura · fecha del pago · RUT · monto) con checkbox para destildar lo que no.
export function ConciliarLoteModal({ rows=[], cmap={}, clients=[], onClose, onConfirm }){
  const [sel,setSel] = useState(()=>new Set(rows.map(x=>String(x.m.id))))
  const toggle = id => setSel(s=>{ const n=new Set(s); n.has(id)?n.delete(id):n.add(id); return n })
  const selRows = rows.filter(x=>sel.has(String(x.m.id)))
  const total = selRows.reduce((a,x)=>a+(Number(x.m.monto)||0),0)
  const nom = m => cmap[m.cliente_id] || m.nombre_contraparte || (clients.find(c=>String(c.id)===String(m.cliente_id))?.name) || 'Sin cliente'
  return (<>
    <div style={{background:C.greenBg,borderRadius:12,padding:'12px 14px',marginBottom:12}}><div style={{fontSize:10,fontWeight:700,color:C.greenText,textTransform:'uppercase',letterSpacing:.5}}>Calces exactos</div><div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:10}}><span style={{fontSize:22,fontWeight:800,color:C.greenText}}>{selRows.length} de {rows.length} pago{rows.length!==1?'s':''}</span><span style={{fontSize:20,fontWeight:800,color:C.greenText,fontVariantNumeric:'tabular-nums'}}>{fmt(total)}</span></div></div>
    <div style={{padding:'0 2px 10px',fontSize:13,color:C.muted,lineHeight:1.5}}>Cada pago calza <b style={{color:C.text}}>Exacto en pesos</b> con el saldo de su factura y comparte el <b style={{color:C.text}}>RUT</b>. Destilda el que no quieras conciliar. Es reversible.</div>
    <div style={{display:'flex',flexDirection:'column',gap:6}}>
      {rows.map(({m,f})=>{ const on=sel.has(String(m.id))
        return <div key={m.id} onClick={()=>toggle(String(m.id))} style={{display:'flex',gap:10,alignItems:'flex-start',padding:'9px 11px',border:`1px solid ${on?C.greenText:C.border}`,borderRadius:10,background:on?C.greenBg:'#fff',cursor:'pointer'}}>
          <span style={{width:18,height:18,borderRadius:6,border:`1.5px solid ${on?C.greenText:C.done}`,background:on?C.greenText:'#fff',flexShrink:0,marginTop:1,display:'flex',alignItems:'center',justifyContent:'center'}}>{on&&<svg width='11' height='11' viewBox='0 0 24 24' fill='none' stroke='#fff' strokeWidth='3.5' strokeLinecap='round' strokeLinejoin='round'><polyline points='20 6 9 17 4 12'/></svg>}</span>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:14,fontWeight:700,color:C.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{nom(m)}</div>
            <div style={{fontSize:11,color:C.muted,marginTop:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>→ Factura N° {folioN(f.invoice_no)||'—'}{f.issued_at?` · emitida ${fmtFechaDMY(f.issued_at)}`:''}{f.concept?` · ${f.concept}`:''}</div>
            <div style={{fontSize:11,color:C.muted,marginTop:1}}>Pago {fmtFechaDMY(m.fecha)}{m.rut_contraparte?` · RUT ${m.rut_contraparte}`:''}</div>
          </div>
          <div style={{fontSize:13,fontWeight:700,color:C.greenText,whiteSpace:'nowrap',fontVariantNumeric:'tabular-nums',flexShrink:0}}>{fmt(m.monto)}</div>
        </div> })}
    </div>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,marginTop:12,paddingTop:12,borderTop:`1px solid ${C.border}`}}>
      <button onClick={onClose} style={{fontSize:13,fontWeight:600,color:C.muted,background:'#fff',border:`1px solid ${C.border}`,borderRadius:10,padding:'9px 14px',cursor:'pointer'}}>Cancelar</button>
      <button disabled={!selRows.length} onClick={()=>onConfirm(selRows)} style={{fontSize:13,fontWeight:700,color:'#fff',background:selRows.length?C.greenText:C.done,border:'none',borderRadius:10,padding:'9px 15px',cursor:selRows.length?'pointer':'default'}}>Conciliar {selRows.length} · {fmt(total)}</button>
    </div>
  </>)
}

// ─── CONCILIACIÓN BANCARIA (Fase 1: importación + identificación, read-only) ────
// useConciliacionModel: capa de MODELO de Conciliacion (estado + datos derivados + acciones), extraida de ConciliacionView
// para habilitar presentaciones movil/desktop sobre la MISMA logica. Traslado verbatim: no cambia ninguna formula.
export function useConciliacionModel({setTercerosRoot=null,clients=[],clientEntities=[],billing=[],sales=[],setRendiciones,setBilling,anticipos=[],setAnticipos,expenses=[],setExpenses,proveedores=[],pettyCash=[],setPettyCash,user,focusMovId,onFocusConsumed,focusBuscar,onBuscarConsumed,openProp,onPropOpened,onClose,onOpenClientFicha,onCotejarSII,onBuscarSII,onIngresarSII,onFacturaPagada,onOpenProveedor}) {
  // Capa 2 — RUT conocidos para el tag "quién es"
  // RUT conocidos para el tag "quién es" — SOCIO_RUT/EQUIPO_RUT se derivan de `miembros` (SOCIOS_CFG/EQUIPO_CFG, tenant-aware; fallback LEA). CONTADORA_RUT es externa (no es miembro): queda hardcodeada hasta tener su config.
  const SOCIO_RUT  = useMemo(()=>{ const m={}; SOCIOS_CFG.forEach(s=>{ const k=crNormRut(s.rut); if(k) m[k]=s.nombre }); return m },[])   // eslint-disable-line
  const EQUIPO_RUT = useMemo(()=>{ const m={}; EQUIPO_CFG.forEach(s=>{ const k=crNormRut(s.rut); if(k) m[k]=s.nombre }); return m },[])   // eslint-disable-line
  const CONTADORA_RUT = { '124631432':'Claudia (contadora)' }
  const [movs,setMovs] = useState([])
  const [loading,setLoading] = useState(true)
  const [importing,setImporting] = useState(false)
  const [prog,setProg] = useState(null)          // {done,total}
  const [reportes,setReportes] = useState(null)  // resultado por archivo del último lote
  const [cargaPreview,setCargaPreview] = useState(null)  // {entries:[...]} parseado y sin escribir: compuerta antes de guardar
  const [verifRes,setVerifRes] = useState(null)  // resultado de "Verificar contra cartola oficial" (read-only, no inserta)
  const [verificando,setVerificando] = useState(false)
  const [aliases,setAliases] = useState([])
  const [sub,setSub] = useState(()=>viewMemLeer('concModel')?.sub||'abonos')        // 'abonos' | 'cargos'
  const [cobradasOpen,setCobradasOpen] = useState(false)   // modal de revisión histórica: cobradas sin respaldo ↔ cartola
  const [cuentaF,setCuentaF] = useState('ambas')   // filtro por cuenta: 'ambas' | 'honorarios' | 'gastos'
  const [anioF,setAnioF] = useState('todos')       // filtro por año
  const [mesF,setMesF] = useState('todos')         // filtro por mes (01-12)
  const [concYCol,setConcYCol] = usePersistedState('conc_y',()=>new Set())   // cartola: años colapsados (default: todos abiertos)
  const [concMOpen,setConcMOpen] = usePersistedState('conc_m',null)          // cartola: meses abiertos en la lista (null = solo el más reciente)
  const [respF,setRespF] = useState('todos')       // filtro por abogado responsable del cliente
  const [facChip,setFacChip] = useState(null)      // movimiento cuyo chip de factura está desplegado (Opción A)
  const [facMyc,setFacMyc] = useState(null)        // factura del detalle "Conciliar" (multi) desplegada
  const [devolFor,setDevolFor] = useState(null)    // 3.B: movimiento con el checklist de gastos de devolución abierto
  const [devolSel,setDevolSel] = useState(()=>new Set())  // gastos tildados para reembolsar
  const respByCid = useMemo(()=>{ const m={}; (clients||[]).forEach(c=>{ if(c.abogado_responsable) m[String(c.id)]=c.abogado_responsable }); return m },[clients])
  const respDisp = useMemo(()=>[...new Set((clients||[]).map(c=>c.abogado_responsable).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es')),[clients])
  const [q,setQ] = useState('')                    // búsqueda por RUT / nombre / cliente
  const [orden,setOrden] = useState('desc')        // orden por fecha: 'desc' | 'asc'
  const [verCartolas,setVerCartolas] = useState(false)   // panel "Cartolas cargadas" desplegado
  const [verCarga,setVerCarga] = useState(false)         // caja de carga de cartolas colapsada (solo se usa al inicio)
  const [verFiltros,setVerFiltros] = useState(false)     // filtros Mes/Año/Responsable colapsados
  const [editMov,setEditMov] = useState(null)    // id del movimiento en edición/identificación
  const [tagFor,setTagFor] = useState(null)      // id del movimiento con el picker de categoría abierto
  const [tipoAprendido,setTipoAprendido] = useState({})  // RUT/nombre → categoría aprendida (cartola_tipo)
  const [splitMov,setSplitMov] = useState(null)  // id del movimiento con el split adelanto/fondo abierto
  const [splitAdel,setSplitAdel] = useState('')  // monto que va a adelanto (el resto a fondo)
  const [fondoFor,setFondoFor] = useState(null)  // "Fondo por rendir" desplegado (adelanto vs devolución) — lista uniforme "¿A qué corresponde?"
  const [otroFor,setOtroFor] = useState(null)    // "Otro tipo de pago" desplegado (categorías) — lista uniforme
  const [otraFacFor,setOtraFacFor] = useState(null)  // "Otra factura" desplegado (estado de cuenta del cliente) — lista uniforme
  const [editForm,setEditForm] = useState({rut:'',nombre:''})
  const [conc,setConc] = useState([])           // filas de conciliacion (factura/anticipo aplicados)
  const [concView,setConcView] = useState(()=>viewMemLeer('concModel')?.concView||'todos')
  useEffect(()=>{ viewMemGuardar('concModel',{sub,concView}) },[sub,concView]) // abonos: 'todos' | 'porconciliar' | 'conciliados'
  const isDesktop = useIsDesktop()   // Fase 3: en desktop, columna de conciliación enfocada (ancho legible, no estirada)
  const [autoRun,setAutoRun] = useState(false)   // corriendo conciliación automática
  const [pickFor,setPickFor] = useState(null)    // id del abono con el picker de conciliación abierto
  const [revSugOpen,setRevSugOpen] = useState(false)   // modal "Revisar sugerencias" (identificar en lote)
  const [revSugSel,setRevSugSel] = useState(()=>new Set())
  const [revSugBusy,setRevSugBusy] = useState(false)
  const [comboFor,setComboFor] = useState(null)  // id del abono con la previsualización del combo (2 facturas) abierta
  const [reembFor,setReembFor] = useState(null)  // id del abono con las opciones de reembolso (saldar / +fondo) abiertas
  const [detFor,setDetFor] = useState(null)
  const [facBuscaQ,setFacBuscaQ] = useState('')  // buscador del estado de cuenta del cliente en el panel del pago      // id de la factura con el detalle expandido en el selector "Otra factura"
  const [rsConcOpen,setRsConcOpen] = useState(()=>new Set())   // por RS: mostrar las cobradas-conciliadas (colapsadas por defecto)
  const [modalMov,setModalMov] = useState(null)  // id del movimiento abierto en el modal de detalle
  const [otrasSet,setOtrasSet] = useState(()=>new Set())   // movs cuyo "Otras opciones" el usuario alternó (override del default)
  const toggleOtras = id => setOtrasSet(s=>{ const n=new Set(s); n.has(id)?n.delete(id):n.add(id); return n })
  // Salto desde el Estado de cuenta del cliente: limpia filtros, abre el movimiento y hace scroll. Espera a que carguen los movs.
  useEffect(()=>{ if(!focusMovId) return; const m=movs.find(x=>x.id===focusMovId); if(!m) return
    setSub(m.tipo==='cargo'?'cargos':'abonos'); setCuentaF('ambas'); setAnioF('todos'); setMesF('todos'); setRespF('todos'); setQ(''); setModalMov(focusMovId)
    setTimeout(()=>{ try{ document.getElementById('mov-'+focusMovId)?.scrollIntoView({behavior:'smooth',block:'center'}) }catch(_){} },150)
    onFocusConsumed&&onFocusConsumed() },[focusMovId,movs])
  // "Buscar pago" desde Cobranza: abre Abonos buscando por el nombre del cliente (candidatos de depósito), sin un movimiento puntual.
  useEffect(()=>{ if(!focusBuscar) return
    setSub('abonos'); setCuentaF('ambas'); setAnioF('todos'); setMesF('todos'); setRespF('todos'); setQ(String(focusBuscar))
    onBuscarConsumed&&onBuscarConsumed() },[focusBuscar])   // eslint-disable-line
  const [verGlosa,setVerGlosa] = useState(false)  // glosa cruda desplegada en el modal
  const [busy,setBusy] = useState(null)          // id del movimiento con una acción en curso
  const [costosOfi,setCostosOfi] = useState([])  // presupuesto de oficina, para cruzar cargos ↔ línea de costo (por monto exacto + glosa)
  useEffect(()=>{ if(DEMO){ setCostosOfi([{categoria:'Arriendo y espacio',item:'Arriendo',monto:2780000},{categoria:'Arriendo y espacio',item:'Gastos comunes',monto:890000},{categoria:'Servicios y tecnología',item:'Internet',monto:34200},{categoria:'Impuestos y patentes',item:'PPM',monto:800000},{categoria:'Remuneraciones',item:'Martín Campero',monto:1679268}]); return } supabase.from('costos_oficina').select('categoria,item,monto,es_ingreso,desde,monto_prev').eq('activo',true).then(({data})=>setCostosOfi(data||[]),()=>{}) },[])
  const [costosClaudia,setCostosClaudia] = useState([])   // costos EXACTOS del mes leídos del correo "VALORES" de la contadora (alimentan el cruce)
  const [valoresBusy,setValoresBusy] = useState(false); const [valoresInfo,setValoresInfo] = useState(null)
  // El cron `valores-contadora` deja el último mes en learnings kind='valores_contadora' (key=AAAA-MM) ya en el formato de items.
  // Lo cargamos SOLO al abrir para que el cruce use los montos exactos del mes sin obligar al clic "Leer valores".
  useEffect(()=>{ if(DEMO) return
    supabase.from('learnings').select('key,value').eq('kind','valores_contadora').order('key',{ascending:false}).limit(1)
      .then(({data})=>{ try{ const v=data&&data[0]&&JSON.parse(data[0].value); if(v&&Array.isArray(v.items)&&v.items.length){ setCostosClaudia(v.items); setValoresInfo({mes:v.mes,n:v.items.length,items:v.items,auto:true}) } }catch{} },()=>{}) },[])
  const leerValores = async()=>{ if(valoresBusy) return; setValoresBusy(true); setValoresInfo(null)
    try{ const r=await leerValoresClaudia()
      if(!r||!r.items.length){ setValoresInfo({err:'No encontré un correo "VALORES" de la contadora, o no pude leer los montos.'}); }
      else { setCostosClaudia(r.items); setValoresInfo({mes:r.mes,n:r.items.length,items:r.items}) }
    }catch(e){ setValoresInfo({err: e?.code===401?'Reconéctate a Google (falta permiso de Gmail).':'No se pudo leer: '+(e?.message||'reintenta')}) }
    setValoresBusy(false)
  }
  const poolCostos = useMemo(()=>[...(costosClaudia||[]).map(x=>({...x,_src:'claudia'})), ...(costosOfi||[]).map(x=>({...x,_src:'presupuesto'}))], [costosClaudia, costosOfi])   // primero los exactos del correo, luego el presupuesto
  const [gcFor,setGcFor] = useState(null)        // Fase 3.D: cargo en flujo "por cuenta de cliente" (mov id)
  const [gcCli,setGcCli] = useState(null)        // cliente elegido para el gasto por cuenta de cliente
  const [gcEnt,setGcEnt] = useState(null)        // razón social elegida para ese gasto
  const [ofiFor,setOfiFor] = useState(null)      // Pieza 3: cargo en flujo "costo de oficina" (mov id) — elige categoría
  const [ofiCat,setOfiCat] = useState(null)      // categoría elegida (paso 1) → habilita el paso de subcategoría
  const [ofiSub,setOfiSub] = useState('')        // subcategoría opcional del costo de oficina
  const [ingFor,setIngFor] = useState(null)      // abono en flujo "ingreso de oficina" (mov id) — menú de subcategoría abierto
  const [ingComFor,setIngComFor] = useState(null)// "Comisión Recibida" desplegada (mov id) → picker de proveedor/tercero
  const [ingProvQ,setIngProvQ] = useState('')    // búsqueda del proveedor en Comisión Recibida
  const [cargoCliLearn,setCargoCliLearn] = useState({})  // glosaKey → client_id aprendido (cargo por cuenta de cliente)
  useEffect(()=>{ supabase.from('learnings').select('key,value').eq('kind','cargo_cliente').order('updated_at',{ascending:true}).then(({data})=>{ const m={}; (data||[]).forEach(r=>{ if(r.key&&r.value) m[r.key]=r.value }); setCargoCliLearn(m) },()=>{}) },[])
  const [costoOfiLearn,setCostoOfiLearn] = useState({})  // glosaKey → {category, subcategory} aprendido (costo de oficina recurrente: arriendo/sueldos/servicios vienen del banco cada mes)
  // Lectura DETERMINISTA por voto de mayoría (antes: sin order-by + overwrite → la sugerencia salía al azar entre Retiro/Sueldo). Si el reparto NO tiene mayoría clara (≥62%), la clave queda AMBIGUA → no se auto-sugiere, va a la compuerta (Revisión de datos · glosa en conflicto).
  useEffect(()=>{ supabase.from('learnings').select('key,value,meta,hits,updated_at').eq('kind','costo_oficina').then(({data})=>{
    const m={}; Object.entries(SD.votoGlosa(data)).forEach(([k,v])=>{ m[k]={category:v.category,subcategory:v.subcategory,ambiguo:v.ambiguo} })   // misma regla que «glosa en conflicto»: usos de los últimos 90 días
    setCostoOfiLearn(m) },()=>{}) },[])
  // Cargo v2 — clasificador combo (Gasto Oficina / Gasto Cliente → categoría → subcategoría). Estado por movimiento.
  const [ccFam,setCcFam] = useState({})   // movId → 'oficina' | 'cliente' (familia elegida)
  const [ccCat,setCcCat] = useState({})   // movId → categoría de oficina en drill de subcategoría
  const [ccQ,setCcQ]     = useState({})   // movId → texto de búsqueda del combo
  const [ctSel,setCtSel] = useState({})   // movId → {cid, saleId, nat, billId} — 'Costo de terceros' de una venta
  const [provExtra,setProvExtra] = useState([])   // proveedores creados desde Banco en esta sesión (aún no en la lista de la app)
  const [abFam,setAbFam] = useState({})   // movId → 'cliente' | 'oficina' — familia elegida en el clasificador de ABONOS (tiles nivel 0), espeja ccFam de cargos
  const TOL = 0                                 // NO hay comisiones bancarias → calce EXACTO; cualquier diferencia = error a revisar
  const fmtM = fmt
  const mesAbbr = iso => { if(!iso) return ''; const [y,mo]=String(iso).slice(0,7).split('-'); const M=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']; return `${M[+mo-1]||mo} ${(y||'').slice(2)}` }

  const cargar = useCallback(async()=>{
    setLoading(true)
    if(DEMO){ setMovs(demoData.cartola_movimientos||[]); setAliases(demoData.cliente_alias||[]); setConc(demoData.conciliacion||[]); setLoading(false); return }
    // Supabase/PostgREST corta cada consulta en ~1000 filas (db-max-rows) e IGNORA .limit(8000): hay que PAGINAR
    // con .range o solo se cargaban los 1000 movimientos más nuevos (se caían los meses más antiguos de la cartola).
    const fetchAll = async(tabla, orderCol)=>{ let all=[], from=0; const SZ=1000; for(;;){ let q=supabase.from(tabla).select('*'); if(orderCol) q=q.order(orderCol,{ascending:false}); q=q.order('id'); const {data,error}=await q.range(from,from+SZ-1); if(error) throw error; if(!data||!data.length) break; all=all.concat(data); if(data.length<SZ) break; from+=SZ } return all }
    const [m,a,cc] = await Promise.all([
      fetchAll('cartola_movimientos','fecha'),
      supabase.from('cliente_alias').select('*').then(r=>r.data||[]),
      fetchAll('conciliacion',null),
    ])
    setMovs(m||[]); setAliases(a||[]); setConc(cc||[]); setLoading(false)
  },[])
  useEffect(()=>{ cargar() },[cargar])

  const cmap = useMemo(()=>{ const m={}; clients.forEach(c=>m[c.id]=c.name); return m },[clients])
  // RUT → nombre "oficial" (razón social del SII o nombre del cliente) para reemplazar el nombre truncado/corrupto del banco.
  const nameByRut = useMemo(()=>{ const m={}
    clients.forEach(c=>{ const k=crNormRut(c.rut); if(k&&!m[k]) m[k]=c.name })
    clientEntities.forEach(e=>{ const k=crNormRut(e.rut); if(k) m[k]=e.name })   // la RS pisa al nombre del cliente
    return m },[clients,clientEntities])
  const provByRut = useMemo(()=>{ const m={}; (proveedores||[]).forEach(p=>{ const k=crNormRut(p.rut); if(k) m[k]=p.nombre||p.name }); return m },[proveedores])
  // Sugerencia de cliente por NOMBRE (para abonos sin RUT registrado): cruza el nombre del banco contra nombres de
  // clientes y razones sociales del receptor de facturas EMITIDAS. Solo sugiere; el usuario confirma (y ahí aprende el RUT).
  const _stripNom = s => String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\b(spa|ltda|limitada|sa|eirl|sociedad|comercial|servicios|inversiones|cia)\b/g,' ').replace(/\s+/g,' ').trim()
  const _toksNom = s => _stripNom(s).split(' ').filter(t=>t.length>=4)
  useEffect(()=>{ supabase.from('learnings').select('key,value').eq('kind','cartola_tipo').order('updated_at',{ascending:true}).then(({data})=>{ const m={}; (data||[]).forEach(r=>{ if(r.key&&r.value) m[r.key]=r.value }); setTipoAprendido(m) },()=>{}) },[])
  // Sugerencia de categoría aprendida (cartola_tipo) para un abono sin identificar: mismo RUT o mismo nombre.
  const tipoSugerido = m => { if(m.es_interno||m.categoria) return null; const k=crNormRut(m.rut_contraparte); if(k&&tipoAprendido[k]) return tipoAprendido[k]; const nk=m.nombre_contraparte?'n:'+_stripNom(m.nombre_contraparte):null; if(nk&&tipoAprendido[nk]) return tipoAprendido[nk]; return null }
  // Costo de oficina aprendido por glosa (el mismo arriendo/sueldo/servicio que vuelve cada mes) → categoría + subcategoría sugeridas.
  const costoOfiSugerido = m => { if(m.tipo!=='cargo'||m.es_interno||(concByMov[m.id]?.length)) return null; const gk=glosaKey(m.descripcion); const l=gk&&costoOfiLearn[gk]; return (l&&!l.ambiguo)?l:null }
  // Nombres de pila comunes: no alcanzan para identificar (dos "José Miguel" distintos no son el mismo cliente).
  const _NOM_COMUN = new Set(['jose','juan','maria','luis','carlos','miguel','francisco','pedro','pablo','jorge','manuel','andres','felipe','cristobal','catalina','daniel','ignacio','antonio','rodrigo','sebastian','alejandro','fernando','gonzalo','ricardo','roberto','eduardo','patricio','claudio','marcelo','rafael','victor','angel','mario','raul','sergio','hernan','ramon',
    // palabras de servicios bancarios de pago (no identifican al pagador): «NOMINA MISMO DIA PROVEEDORES», «PAGO PROVEEDORES»
    'nomina','mismo','proveedores','proveedor','pagos','remuneraciones','transferencias'])
  const nombreIdx = useMemo(()=>{ const idx=[]
    clients.forEach(c=>idx.push({cid:c.id,t:_toksNom(c.name)}))
    const seen=new Set(); billing.forEach(f=>{ if(f.receptor_name&&f.client_id){ const k=f.client_id+'|'+f.receptor_name; if(!seen.has(k)){ seen.add(k); idx.push({cid:f.client_id,t:_toksNom(f.receptor_name)}) } } })
    aliases.forEach(a=>{ if(a.nombre_pagador&&a.cliente_id&&!nombreGenerico(a.nombre_pagador)){ const tk=_toksNom(a.nombre_pagador); if(tk.length) idx.push({cid:a.cliente_id,t:tk,rut:crNormRut(a.rut_pagador)||null}) } })
    return idx },[clients,billing,aliases])
  const sugerencias = useMemo(()=>{ const out={}
    // Solo abonos aún por conciliar (uno ya conciliado o clasificado no se vuelve a sugerir). Con RUT en el depósito, un nombre
    // aprendido de OTRO RUT no cuenta: «PROVEEDORES MISMO DIA» es el servicio del banco, no el pagador (Tarragona vs Spinex, 24-07).
    movs.forEach(mv=>{ if(mv.tipo==='abono'&&!mv.es_interno&&!mv.cliente_id&&mv.nombre_contraparte&&!nombreGenerico(mv.nombre_contraparte)&&mv.estado==='pendiente'&&!(Number(mv.monto_conciliado)>0)&&!mv.categoria){
      const nt=_toksNom(mv.nombre_contraparte); if(!nt.length) return
      const rutMv=crNormRut(mv.rut_contraparte)
      const hits=new Set()
      nombreIdx.forEach(e=>{ if(rutMv&&e.rut&&e.rut!==rutMv) return; const inter=e.t.filter(t=>nt.some(x=> x===t || (x.length>=5&&t.length>=5&&(x.startsWith(t)||t.startsWith(x)))))
        const fuertes=inter.filter(t=>!_NOM_COMUN.has(t)&&t.length>=5)   // tokens distintivos (no nombres de pila comunes)
        if(fuertes.length>=1 && (inter.length>=2 || fuertes.some(t=>t.length>=6))) hits.add(e.cid) })
      if(hits.size===1) out[mv.id]=[...hits][0] }})
    return out },[movs,nombreIdx])
  // Capa 2 — categoría "quién es": manual (categoria) manda; si no, auto por RUT conocido / cliente.
  const tipoContraparte = m => {
    if(m.es_interno) return null
    if(m.categoria) return m.categoria
    const k=crNormRut(m.rut_contraparte)
    if(k){ if(CONTADORA_RUT[k]) return 'Contadora'; if(SOCIO_RUT[k]) return 'Socio'; if(EQUIPO_RUT[k]) return 'Equipo'; if(provByRut[k]) return 'Proveedor' }
    // 'Cliente' solo aplica a ABONOS (plata que entra). Un mismo RUT puede ser cliente (te paga) y
    // proveedor (le pagas, p.ej. BDA): el cargo se clasifica a mano, no se auto-rotula Cliente.
    if(m.tipo==='abono' && m.cliente_id) return 'Cliente'
    return null
  }
  const TAG_STY = { 'Contadora':{bg:'#EEEDFE',color:'#3C3489'},'Equipo':{bg:'#EAF3DE',color:'#3B6D11'},'Socio':{bg:C.azulBg,color:C.accent},'Proveedor':{bg:C.ambarBg,color:C.soonText},'Cliente':{bg:C.greenBg,color:C.greenText},'Gastos Oficina':{bg:C.azulBg,color:C.azulInfo},'Notaría':{bg:'#FAECE7',color:C.coralText},'Impuestos':{bg:C.overdueBg,color:C.overdueText},'Provisión de gastos':{bg:C.tealBg,color:C.tealText},'Otro ingreso':{bg:C.bgWarm,color:C.grisText},'Devolución':{bg:'#FAECE7',color:C.coralText},'Reembolso':{bg:'#FAECE7',color:C.coralText},'Traspaso interno':{bg:C.bgWarm,color:C.grisText},'Intereses':{bg:C.ambarBg,color:C.soonText},'Tercero':{bg:C.track,color:C.muted},'Pago histórico':{bg:C.bgWarm,color:C.grisText},'Subarriendo':{bg:C.tealBg,color:C.tealText} }
  // Categorías distintas por sentido: cargos = a quién le pagas; abonos = solo se clasifican los de la cuenta de
  // Gastos que NO calzan factura (provisión de gastos = ocasional); un abono de honorarios es el pago del cliente.
  const CATS_CARGO = ['Gastos Oficina','Notaría','Proveedor','Equipo','Contadora','Socio','Impuestos','Devolución']
  const CATS_ABONO = ['Reembolso','Traspaso interno','Intereses','Tercero','Pago histórico','Provisión de gastos','Otro ingreso','Subarriendo']
  const RESUELTAS_ABO = ['Reembolso','Intereses','Tercero','Pago histórico','Subarriendo']  // clasificadas = fuera de "sin identificar" (Subarriendo = ingreso por arriendo, NO honorarios/venta)
  const ESTRUCT_ABO = ['Reembolso','Traspaso interno','Intereses','Tercero','Pago histórico']  // categoría deducible por RUT/nombre → se aprende
  // Tag manual. CARGOS: aprende por RUT (a un proveedor siempre le pagas igual → todos sus cargos). ABONOS: solo
  // este movimiento (un mismo cliente paga honorarios un mes y subarriendo otro → no se puede deducir por RUT).
  const setCategoria = async(mov,cat)=>{
    const k=crNormRut(mov.rut_contraparte)
    const keyLearn = k || (mov.nombre_contraparte?'n:'+_stripNom(mov.nombre_contraparte):null)
    try{
      // Traspaso interno: reusa el mecanismo de internos (sale de la bandeja de abonos).
      if(cat==='Traspaso interno'){
        const esp = espejoInterno(mov)   // espejo exacto en la otra cuenta (si existe) → ambos quedan internos
        const ids = esp ? [mov.id, esp.id] : [mov.id]
        const { error } = await supabase.from('cartola_movimientos').update({es_interno:true,estado:'interno',categoria:null}).in('id',ids)
        if(error) throw error
        setMovs(p=>p.map(x=>ids.includes(x.id)?{...x,es_interno:true,estado:'interno',categoria:null}:x))
        if(keyLearn) learnPut('cartola_tipo', keyLearn, cat)
        setTagFor(null); return
      }
      // CARGOS aprenden por RUT (a un proveedor le pagas siempre igual). ABONOS: solo este movimiento (la sugerencia hace el resto).
      const learn = !!k && mov.tipo==='cargo'
      const { error } = learn
        ? await supabase.from('cartola_movimientos').update({categoria:cat}).eq('rut_contraparte',mov.rut_contraparte).eq('tipo','cargo')
        : await supabase.from('cartola_movimientos').update({categoria:cat}).eq('id',mov.id)
      if(error) throw error
      if(learn) setMovs(p=>p.map(x=>crNormRut(x.rut_contraparte)===k&&x.tipo==='cargo'?{...x,categoria:cat}:x))
      else      setMovs(p=>p.map(x=>x.id===mov.id?{...x,categoria:cat}:x))
      // Aprende para sugerir en similares (cargos + abonos estructurales).
      if(cat && keyLearn && (mov.tipo==='cargo'||ESTRUCT_ABO.includes(cat))) learnPut('cartola_tipo', keyLearn, cat)
      setTagFor(null)
    }catch(e){ appAlert('Error al clasificar: '+e.message) }
  }
  // "No es cliente" — el que deposita es un TERCERO o una intermediaria (nos devuelve plata de una gestión), no un cliente. Reusa el
  // motor de categorías ('Tercero' ∈ ESTRUCT_ABO): clasifica este abono fuera de "sin identificar" y APRENDE el RUT (cartola_tipo),
  // de modo que _pagadorNoCliente corta el falso calce por monto en los próximos depósitos. No mueve plata (el cuadre del gasto real va aparte).
  const marcarNoCliente = async(mov)=>{
    if(!await appConfirm(`¿Marcar este depósito${mov.nombre_contraparte?` de ${mov.nombre_contraparte}`:''} como de un TERCERO / intermediaria (no es un cliente)?\n\nLa app aprende el RUT y no volverá a proponerlo como pago de cliente por monto. No mueve plata: el cuadre del gasto real se hace aparte.`)) return
    await setCategoria(mov,'Tercero')
  }
  // Corrección manual: un movimiento mal marcado interno pasa a normal (queda pendiente para identificar/conciliar).
  const desmarcarInterno = async(mov)=>{
    if(!await appConfirm('¿Marcarlo como NO interno? Pasará a ser un movimiento normal para identificar y conciliar.')) return
    try{
      const cid = mov.rut_contraparte ? resolver(mov.rut_contraparte) : null
      const { error } = await supabase.from('cartola_movimientos').update({es_interno:false,estado:'pendiente',cliente_id:cid}).eq('id',mov.id)
      if(error) throw error
      setMovs(p=>p.map(x=>x.id===mov.id?{...x,es_interno:false,estado:'pendiente',cliente_id:cid}:x))
    }catch(e){ appAlert('Error: '+e.message) }
  }
  // Resolución de cliente por RUT: alias → razón social → cliente → receptor de factura.
  const resolver = useMemo(()=>{
    const alias={},ent={},cli={},rec={}
    aliases.forEach(a=>{ const k=crNormRut(a.rut_pagador); if(k) alias[k]=a.cliente_id })
    clientEntities.forEach(e=>{ const k=crNormRut(e.rut); if(k&&!ent[k]) ent[k]=e.client_id })
    clients.forEach(c=>{ const k=crNormRut(c.rut); if(k&&!cli[k]) cli[k]=c.id })
    billing.forEach(b=>{ const k=crNormRut(b.receptor_rut); if(k&&!rec[k]) rec[k]=b.client_id })
    return rut=>{ const k=crNormRut(rut); if(!k) return null; return alias[k]||ent[k]||cli[k]||rec[k]||null }
  },[aliases,clientEntities,clients,billing])
  // Auto-identificar por NOMBRE al cargar (mismo criterio conservador que `sugerencias`): tokens distintivos + un único cliente. Es identificación reversible, no acción de plata.
  const resolverNombre = useMemo(()=>{ return (nombre)=>{ if(!nombre) return null; const nt=_toksNom(nombre); if(!nt.length) return null; const hits=new Set(); nombreIdx.forEach(e=>{ const inter=e.t.filter(t=>nt.some(x=> x===t || (x.length>=5&&t.length>=5&&(x.startsWith(t)||t.startsWith(x))))); const fuertes=inter.filter(t=>!_NOM_COMUN.has(t)&&t.length>=5); if(fuertes.length>=1 && (inter.length>=2 || fuertes.some(t=>t.length>=6))) hits.add(e.cid) }); return hits.size===1?[...hits][0]:null } },[nombreIdx])

  const onFiles = async(fileList)=>{
    // Solo .xlsx reales: descarta los temporales de Excel "~$..." (archivos de bloqueo, sin datos) y ocultos.
    const files=[...(fileList||[])].filter(f=>{ const n=(f.name||'').split(/[/\\]/).pop(); return /\.xlsx?$/i.test(n) && !n.startsWith('~$') && !n.startsWith('.') }); if(!files.length) return
    setImporting(true); setReportes(null); setProg({done:0,total:files.length})
    const reps=[]
    try{
      const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs')
      for(let fi=0; fi<files.length; fi++){
        const file=files[fi]
        try{
          const buf=await file.arrayBuffer()
          const wb=XLSX.read(buf,{type:'array'})
          const sheet=wb.Sheets[wb.SheetNames[0]]
          const aoa=XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:true})
          const res=parseCartola(aoa,{filename:file.name})
          // RUT de una persona conocida (equipo/socios/contadora) NO es cliente → cliente_id=null (evita falsos positivos de resolverNombre,
          // ej. "erasmo escala"→cliente "Liberona Escala" o "Martina…"→"Javier Vergara"); su cargo lo clasifica cargoSugerencia (sueldo/caja/retiro).
          const _esPersona = m => { const k=crNormRut(m.rut_contraparte); return !!(k&&(EQUIPO_RUT[k]||SOCIO_RUT[k]||CONTADORA_RUT[k])) }
          const rows=res.movimientos.map(m=>({ ...m, cliente_id: (m.es_interno||_esPersona(m))?null:(resolver(m.rut_contraparte)||resolverNombre(m.nombre_contraparte)), estado: m.es_interno?'interno':'pendiente', monto_conciliado:0 }))
          const fechas=rows.map(r=>r.fecha).filter(Boolean).sort(); const minF=fechas[0]||null, maxF=fechas[fechas.length-1]||null
          // dedup ROBUSTO por CONTEO (NO escribe todavía — es la compuerta de confirmación). El banco entrega DISTINTO n° de operación
          // y glosa entre la cartola DIARIA y la MENSUAL (inserta espacios por corte de columna: "Rut"→"R ut", "Chile"→"Chil e", y a
          // veces trunca distinto) → el hash NO calza y todo salía "nuevo". La única clave estable es cuenta|fecha|tipo|monto (montos y
          // fechas sí parsean bien: los totales cuadran). Comparación por MULTISET: si el banco ya tiene N con esa clave y el archivo trae M,
          // los primeros min(N,M) ya están (soporta 2 movimientos idénticos el mismo día, ej. dos $5.000.000 el 19-08 de clientes distintos).
          let nuevosRows=rows, rellenarOp=[]
          if(rows.length && minF){
            // Ventana ±5 días: la misma transferencia puede venir con otra fecha contable (glosa "el 19-06 a las 18:17" contabilizada el 22-06).
            const _dd=(f,n)=>{ const d=new Date(f+'T12:00'); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10) }
            const {data:ex}=await supabase.from('cartola_movimientos').select('id,hash,cuenta,fecha,tipo,monto,descripcion,n_operacion,rut_contraparte').eq('cuenta',res.cuenta).gte('fecha',_dd(minF,-5)).lte('fecha',_dd(maxF,5))
            // Misma regla que la carga automática (_shared/cartolaDedupe.js): cada fila existente se consume una vez, nunca borra.
            const plan=planCarga(rows,ex||[],huellaGlosa); nuevosRows=plan.nuevos; rellenarOp=plan.rellenar
          }
          const abo=rows.filter(r=>r.tipo==='abono'), car=rows.filter(r=>r.tipo==='cargo')
          const sumA=abo.reduce((a,r)=>a+r.monto,0), sumC=car.reduce((a,r)=>a+r.monto,0)
          const sinId=abo.filter(r=>!r.es_interno && !r.cliente_id).length
          // Cruce fecha↔glosa (tu regla: al cargar, siempre cruzar). La glosa suele traer la fecha real ("...el DD/MM/YYYY"); si la fecha del
          // movimiento quedó MUY lejos (≥30 días) de esa, es data sospechosa (bug de parseo / columna mal leída) → se avisa ANTES de confirmar.
          // Lee la glosa en dd-mm-yyyy y en ISO (yyyy-mm-dd): el ISO no se leía y 7 traspasos quedaron al 1-ene sin aviso.
          // Filas sin fecha propia (ni columna ni glosa) también se avisan: tomaron la del encabezado.
          const _incierta=new Set(res.movimientos.filter(m=>m.fechaIncierta).map(m=>m.hash))
          const sospechosos = nuevosRows.map(r=>{ if(_incierta.has(r.hash)) return {fecha:r.fecha,fechaGlosa:null,dias:null,monto:r.monto,desc:(r.descripcion||'').slice(0,64)}
            const fg=fechaGlosaISO(r.descripcion); if(!fg||!r.fecha) return null; const d=Math.abs((new Date(r.fecha+'T12:00')-new Date(fg+'T12:00'))/86400000); return d>=30?{fecha:r.fecha,fechaGlosa:fg,dias:Math.round(d),monto:r.monto,desc:(r.descripcion||'').slice(0,64)}:null }).filter(Boolean)
          reps.push({ file:file.name, cuenta:res.cuenta, rol:res.rol_cuenta, ok:!res.error, error:res.error||null,
            nAbonos:abo.length, sumAbonos:sumA, nCargos:car.length, sumCargos:sumC,
            internos:rows.filter(r=>r.es_interno).length, sinId, total:rows.length, nuevos:nuevosRows.length, dup:rows.length-nuevosRows.length,
            minF, maxF, nuevosRows, rellenarOp, sospechosos, saldoInicial:res.saldoInicial??null, saldoFinal:res.saldoFinal??null, totalAbonos:res.totalAbonos??null, totalCargos:res.totalCargos??null,
            verA: res.totalAbonos!=null?{banco:res.totalAbonos,parsed:sumA,diff:sumA-res.totalAbonos}:null,
            verC: res.totalCargos!=null?{banco:res.totalCargos,parsed:sumC,diff:sumC-res.totalCargos}:null })
        }catch(e){ reps.push({ file:file.name, ok:false, error:e.message, nuevosRows:[] }) }
        setProg({done:fi+1,total:files.length})
      }
      setCargaPreview({ entries:reps })   // muestra la compuerta; guardar es confirmarCarga()
    }catch(e){ appAlert('Error al leer: '+e.message) }
    setImporting(false); setProg(null)
  }
  // Confirmar la carga: escribe SOLO los nuevos (dedup ya hecho al preparar). ignoreDuplicates → recargar nunca pisa
  // estado/cliente_id/categoría de lo ya cargado. Reversible por el mismo hash. Tras guardar, muestra el reporte.
  const confirmarCarga = async()=>{
    if(!cargaPreview) return
    setImporting(true)
    const reps=[]
    try{
      for(const en of (cargaPreview.entries||[])){
        try{
          const nuevosRows=en.nuevosRows||[]
          for(const r of (en.rellenarOp||[])) await supabase.from('cartola_movimientos').update({n_operacion:r.n_operacion}).eq('id',r.id).is('n_operacion',null)   // la fila cargada sin n° de operación lo recibe del archivo
          for(let i=0;i<nuevosRows.length;i+=200){ const { error } = await supabase.from('cartola_movimientos').upsert(nuevosRows.slice(i,i+200),{onConflict:'hash',ignoreDuplicates:true}); if(error) throw error }
          // Registro de la carga con su cuenta y saldos (la carga manual no lo dejaba): alimenta la alerta de cartolas por cuenta.
          if(en.ok&&en.minF){ try{ await supabase.from('cartola_cargas').insert({ fecha_desde:en.minF, fecha_hasta:en.maxF, movimientos_n:en.total||0, origen:'manual', archivo:en.file||null, cuenta:en.cuenta||null, rol_cuenta:en.rol||null, saldo_inicial:en.saldoInicial, saldo_final:en.saldoFinal, total_cargos:en.totalCargos, total_abonos:en.totalAbonos, cargado_por:user?.email||null }) }catch(_){} }
          const {nuevosRows:_omit, rellenarOp:_ro, minF:_a, maxF:_b, total:_c, saldoInicial:_d, saldoFinal:_e, totalAbonos:_f, totalCargos:_g, ...rep}=en; reps.push(rep)
        }catch(e){ reps.push({ file:en.file, ok:false, error:e.message }) }
      }
      // Traspasos entre cuentas propias: internos solo con su movimiento espejo en la otra cuenta (función de la base).
      try{ await supabase.rpc('emparejar_traspasos_propios',{}) }catch(_){}
      setReportes(reps); setCargaPreview(null)
      await cargar()
    }catch(e){ appAlert('Error al guardar: '+e.message) }
    setImporting(false)
  }

  // Verificar (SIN insertar) que la base tenga todos los movimientos de una cartola OFICIAL (mensual).
  // La diaria automática y la mensual usan distinto N° de operación y glosa truncada → el hash NO calza entre ambas.
  // Por eso NO se puede re-importar la mensual (duplicaría). Aquí se compara por identidad estable fecha|tipo|monto.
  const onVerificar = async(fileList)=>{
    const files=[...(fileList||[])].filter(f=>{ const n=(f.name||'').split(/[/\\]/).pop(); return /\.xlsx?$/i.test(n) && !n.startsWith('~$') && !n.startsWith('.') }); if(!files.length) return
    setVerificando(true); setVerifRes(null); setReportes(null)
    const reps=[]
    try{
      const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs')
      for(const file of files){
        try{
          const buf=await file.arrayBuffer()
          const wb=XLSX.read(buf,{type:'array'})
          const aoa=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:'',raw:true})
          const res=parseCartola(aoa,{filename:file.name})
          const fm=res.movimientos||[]
          if(!fm.length){ reps.push({file:file.name,error:res.error||'Sin movimientos'}); continue }
          const sumA=fm.filter(m=>m.tipo==='abono').reduce((a,m)=>a+m.monto,0)
          const sumC=fm.filter(m=>m.tipo==='cargo').reduce((a,m)=>a+m.monto,0)
          const verA=res.totalAbonos!=null?{diff:sumA-res.totalAbonos}:null
          const verC=res.totalCargos!=null?{diff:sumC-res.totalCargos}:null
          const fechas=fm.map(m=>m.fecha).sort(); const minF=fechas[0], maxF=fechas[fechas.length-1]
          // Base: mismo rol de cuenta y dentro del rango del archivo.
          const db=movs.filter(m=> m.rol_cuenta===res.rol_cuenta && m.fecha>=minF && m.fecha<=maxF)
          const key=m=>`${m.fecha}|${m.tipo}|${m.monto}`
          const cf={},cd={},sampleF={},sampleD={}
          fm.forEach(m=>{ const k=key(m); cf[k]=(cf[k]||0)+1; if(!sampleF[k])sampleF[k]=m })
          db.forEach(m=>{ const k=key(m); cd[k]=(cd[k]||0)+1; if(!sampleD[k])sampleD[k]=m })
          const faltan=[],extra=[]
          new Set([...Object.keys(cf),...Object.keys(cd)]).forEach(k=>{
            const df=cf[k]||0, dd=cd[k]||0
            for(let x=0;x<df-dd;x++) faltan.push(sampleF[k])
            for(let x=0;x<dd-df;x++) extra.push(sampleD[k])
          })
          reps.push({file:file.name,cuenta:res.cuenta,nMovs:fm.length,nDB:db.length,verA,verC,rango:{minF,maxF},faltan,extra})
        }catch(e){ reps.push({file:file.name,error:e.message}) }
      }
      setVerifRes(reps)
    }catch(e){ appAlert('Error al leer: '+e.message) }
    setVerificando(false)
  }

  // Identificar un movimiento: opcionalmente fija RUT/nombre editados, asigna el cliente y APRENDE el alias
  // (RUT pagador → cliente) para identificar ese y los futuros con el mismo RUT.
  const identificar = async(mov,clientId,override)=>{
    if(!clientId) return
    // override (sugerencia aceptada sin abrir el editor) usa el RUT/nombre del propio movimiento, no el formulario.
    const rut = override ? (mov.rut_contraparte||null) : ((editForm.rut||'').trim() || mov.rut_contraparte || null)
    const nombre0 = override ? (mov.nombre_contraparte||null) : ((editForm.nombre||'').trim() || mov.nombre_contraparte || null)
    // Nombre genérico del banco («NOMINA MISMO DIA PROVEEDORES»): no se aprende; se usa el de la razón social de ese RUT o el del cliente.
    const nombre = nombreGenerico(nombre0) ? ((rut&&(clientEntities||[]).find(e=>crNormRut(e.rut)===crNormRut(rut))?.name) || cmap[clientId] || null) : nombre0
    if(rut && esRutPropio(rut)){ appAlert('Ese es el RUT propio de la oficina: es un movimiento interno, no se asocia a un cliente.'); return }
    // Seguridad del alias: si este RUT ya está mapeado a OTRO cliente, avisar y pedir confirmación (nunca cambiar en silencio).
    if(rut){ const prev=aliases.find(a=>crNormRut(a.rut_pagador)===crNormRut(rut))
      if(prev && String(prev.cliente_id)!==String(clientId) && !await appConfirm(`Este RUT ya está asociado a "${cmap[prev.cliente_id]||'otro cliente'}". ¿Reasignarlo a "${cmap[clientId]||'este cliente'}"? Afectará todos sus movimientos.`)) return }
    try{
      const r1 = await supabase.from('cartola_movimientos').update({cliente_id:clientId,rut_contraparte:rut,nombre_contraparte:nombre}).eq('id',mov.id)
      if(r1.error) throw r1.error
      let learnedK=null, learnedNom=null
      if(rut){
        const r2 = await supabase.from('cliente_alias').upsert({rut_pagador:rut,nombre_pagador:nombre,cliente_id:clientId},{onConflict:'rut_pagador'})
        if(r2.error) throw r2.error
        learnedK=crNormRut(rut)
        const r3 = await supabase.from('cartola_movimientos').update({cliente_id:clientId}).is('cliente_id',null).eq('rut_contraparte',rut)
        if(r3.error) throw r3.error
        setAliases(p=>[...p.filter(a=>crNormRut(a.rut_pagador)!==learnedK),{rut_pagador:rut,cliente_id:clientId,nombre_pagador:nombre}])
      } else if(nombre){
        // Sin RUT: aprende por NOMBRE exacto del banco → asigna el mismo cliente a los demás abonos sin identificar con ese mismo nombre.
        learnedNom=nombre
        const r3n = await supabase.from('cartola_movimientos').update({cliente_id:clientId}).is('cliente_id',null).eq('nombre_contraparte',nombre)
        if(r3n.error) throw r3n.error
      }
      setMovs(p=>p.map(m=> m.id===mov.id ? {...m,cliente_id:clientId,rut_contraparte:rut,nombre_contraparte:nombre}
        : (learnedK&&crNormRut(m.rut_contraparte)===learnedK&&!m.cliente_id ? {...m,cliente_id:clientId}
        : (learnedNom&&m.nombre_contraparte===learnedNom&&!m.cliente_id ? {...m,cliente_id:clientId} : m))))
      logActividad('banco.cliente_asignado',{tabla:'cartola_movimientos',id:mov.id,detalle:{name:cmap[clientId]||null,title:mov.nombre_contraparte||null,monto:mov.monto}})
      setEditMov(null); setEditForm({rut:'',nombre:''})
    }catch(e){ appAlert('Error: '+e.message) }
  }
  // Guardar solo RUT/nombre editados (sin asignar cliente): re-resuelve por si el RUT ya está en el sistema.
  const guardarRut = async(mov)=>{
    const rut=(editForm.rut||'').trim()||null, nombre=(editForm.nombre||'').trim()||mov.nombre_contraparte||null
    const cid = rut?resolver(rut):mov.cliente_id||null
    try{
      const { error } = await supabase.from('cartola_movimientos').update({rut_contraparte:rut,nombre_contraparte:nombre,cliente_id:cid}).eq('id',mov.id)
      if(error) throw error
      setMovs(p=>p.map(m=>m.id===mov.id?{...m,rut_contraparte:rut,nombre_contraparte:nombre,cliente_id:cid}:m))
      setEditMov(null); setEditForm({rut:'',nombre:''})
    }catch(e){ appAlert('Error: '+e.message) }
  }
  // Cruce: para el abono interno (plata que llega), busca el abono real (cliente/proveedor) en la OTRA cuenta.
  // Match exacto = confiado. Casi-calce dentro de la ventana = discrepancia a revisar (no hay comisiones en traspasos propios).
  const origenInterno = mov => {
    if(!mov.es_interno || mov.tipo!=='abono') return null
    const W=5*86400000, TOL=10000
    const cand = movs.filter(x=>x.tipo==='abono'&&!x.es_interno&&x.rol_cuenta!==mov.rol_cuenta
      && Math.abs(new Date(x.fecha)-new Date(mov.fecha))<=W && Math.abs((x.monto||0)-(mov.monto||0))<=TOL)
    if(!cand.length) return null
    cand.sort((a,b)=>(Math.abs(a.monto-mov.monto)-Math.abs(b.monto-mov.monto))||(Math.abs(new Date(a.fecha)-new Date(mov.fecha))-Math.abs(new Date(b.fecha)-new Date(mov.fecha))))
    const c=cand[0]
    return { cand:c, exact:c.monto===mov.monto, diff:c.monto-mov.monto }
  }
  const espejoInterno = mov => {
    const W=7*86400000
    const cand = movs.filter(x=> x.id!==mov.id && !x.es_interno && x.rol_cuenta!==mov.rol_cuenta && (x.monto||0)===(mov.monto||0) && Math.abs(new Date(x.fecha)-new Date(mov.fecha))<=W)
    if(!cand.length) return null
    cand.sort((a,b)=> Math.abs(new Date(a.fecha)-new Date(mov.fecha))-Math.abs(new Date(b.fecha)-new Date(mov.fecha)))
    return cand[0]
  }

  // ─── Motor de conciliación (Fase 2) ───────────────────────────────────────
  // Σ aplicado por factura (de la tabla conciliacion) y conciliaciones por movimiento.
  const aplicadoByFactura = useMemo(()=>{ const m={}; conc.forEach(c=>{ if(c.factura_id) m[c.factura_id]=(m[c.factura_id]||0)+(c.monto_aplicado||0) })
    // Respaldo INDIRECTO (igual que respaldoMap de Facturación): un anticipo con conciliación bancaria (tipo 'anticipo')
    // consumido en una factura respalda ESA factura. Sin esto, las pagadas con anticipos salían falsamente "sin depósito que calce".
    const antBancarios=new Set(conc.filter(c=>c.tipo_destino==='anticipo'&&c.anticipo_id).map(c=>String(c.anticipo_id)))
    for(const a of (anticipos||[])){ if(a.estado==='consumido'&&a.billing_id&&antBancarios.has(String(a.id))) m[a.billing_id]=(m[a.billing_id]||0)+(Number(a.monto)||0) }
    return m },[conc,anticipos])
  const cartolaHasta = useMemo(()=>{ let mx=''; for(const x of (movs||[])){ const f=String(x.fecha||'').slice(0,10); if(f>mx) mx=f } return mx||null },[movs])
  const concByMov = useMemo(()=>{ const m={}; conc.forEach(c=>{ (m[c.movimiento_id]=m[c.movimiento_id]||[]).push(c) }); return m },[conc])
  // Traspasos entre las cuentas propias ↔ el abono de cliente que los originó (historial: "traspasa el abono de X" / "traspasado a la cta. Y").
  // Origen = la cuenta de la pata cargo. Calce en orden: abono completo (≤10 d antes) · parte mal ubicada de un abono (fondo en honorarios,
  // factura/anticipo en gastos; ≤60 d) · fondo registrado en la app (honorarios → gastos; ≤60 d) · casi-calce (≤ $10.000) para revisar.
  const traspasos = useMemo(()=>{ const de={}, a={}; const D=86400000; const ts=f=>new Date(String(f).slice(0,10)+'T12:00:00').getTime()
    const bType={}; (billing||[]).forEach(b=>{ bType[b.id]=b.billing_type })
    const abonos=movs.filter(x=>x.tipo==='abono'&&!x.es_interno)
    movs.filter(x=>x.es_interno&&x.tipo==='cargo').forEach(t=>{ const tf=ts(t.fecha), orig=t.rol_cuenta
      const esp=movs.find(x=>x.es_interno&&x.tipo==='abono'&&x.rol_cuenta!==orig&&x.monto===t.monto&&ts(x.fecha)>=tf-D&&ts(x.fecha)<=tf+3*D)
      if(!esp) return   // sin espejo en la otra cuenta = no es traspaso propio (pago a tercero marcado interno)
      const enV=(x,dias)=>x.rol_cuenta===orig&&ts(x.fecha)>=tf-dias*D&&ts(x.fecha)<=tf+D
      const recientes=arr=>arr.sort((p,q)=>ts(q.fecha)-ts(p.fecha))
      let o=null
      const full=recientes(abonos.filter(x=>enV(x,10)&&x.monto===t.monto))[0]
      if(full) o={kind:'abono',mov:full,monto:full.monto}
      if(!o){ for(const x of recientes(abonos.filter(x=>enV(x,60)))){ const c=(concByMov[x.id]||[]).find(c=>Math.round(c.monto_aplicado||0)===Math.round(t.monto)&&(orig==='honorarios'?(c.tipo_destino==='fondo'||bType[c.factura_id]==='reembolso'):(['factura','anticipo'].includes(c.tipo_destino)&&bType[c.factura_id]!=='reembolso'))); if(c){ o={kind:'parte',mov:x,monto:c.monto_aplicado,td:c.tipo_destino}; break } } }
      if(!o&&orig==='honorarios'){ const f=(expenses||[]).filter(e=>e.type==='fondo'&&!e.deleted_at&&Math.round(e.amount||0)===Math.round(t.monto)&&e.date&&ts(e.date)>=tf-60*D&&ts(e.date)<=tf).sort((p,q)=>ts(q.date)-ts(p.date))[0]; if(f) o={kind:'fondo',fondo:f,monto:f.amount} }
      if(!o){ const n=abonos.filter(x=>enV(x,10)&&Math.abs((x.monto||0)-t.monto)<=10000).sort((p,q)=>Math.abs(p.monto-t.monto)-Math.abs(q.monto-t.monto))[0]; if(n) o={kind:'cerca',mov:n,monto:n.monto,diff:n.monto-t.monto} }
      const info={t,esp,orig,dest:esp.rol_cuenta,...(o||{kind:'sin'})}
      de[t.id]=info; de[esp.id]=info
      if(o&&o.mov&&o.kind!=='cerca') (a[o.mov.id]=a[o.mov.id]||[]).push(info)
    })
    return {de,a} },[movs,concByMov,billing,expenses])
  const irMov = id => { const m=movs.find(x=>x.id===id); if(!m) return
    setSub(m.tipo==='cargo'?'cargos':'abonos'); setCuentaF('ambas'); setAnioF('todos'); setMesF('todos'); setRespF('todos'); setQ(''); setModalMov(id)
    setTimeout(()=>{ try{ document.getElementById('mov-'+id)?.scrollIntoView({behavior:'smooth',block:'center'}) }catch(_){} },150) }
  const saldoFactura = b => Math.max(0,montoFactura(b) - (aplicadoByFactura[b.id]||0))   // AUTORIDAD del DTE, no el amount programado
  // Índice memoizado del pool de calce: facturas con saldo por aplicar (Pendiente|Pagado, no anuladas/borradas, amount−Σconciliado>TOL),
  // agrupadas por cliente. Antes cada movimiento re-escaneaba TODO billing (O(movs×facturas) en cada render → congelaba el iPhone
  // con cartolas grandes). Ahora el lookup por cliente es O(1) y la conversión a candidatos solo recorre las facturas de ese cliente.
  // Pool de conciliación = TODAS las facturas EMITIDAS (con folio) con saldo por conciliar, SALVO las ya conciliadas (saldo 0)
  // y las Anuladas/Anticipadas. Incluye VENCIDO (antes se excluía y dejaba fuera casi todo lo impago → 0 calces).
  // Pool de facturas ofrecibles para conciliar un depósito. Excluye las Pagadas ya SALDADAS (no ofrecer facturas
  // pagadas). Salvo que una Pagada tenga una conciliación bancaria PARCIAL en curso (aplicado>0): ahí queda un
  // saldo por pagar REAL y sí se ofrece. NO se toca saldoFactura (lo usa la pestaña "Cobradas s/ respaldo" y reconciliar).
  const facturasConSaldo = useMemo(()=> (billing||[]).filter(b=> !b.deleted_at && (b.amount||0)>0 && String(b.invoice_no||'').trim()!=='' && saldoFactura(b) > TOL && (['Pendiente','Vencido'].includes(b.status) || (b.status==='Pagado' && (aplicadoByFactura[b.id]||0) > TOL))), [billing,aplicadoByFactura])
  const facturasPorCliente = useMemo(()=>{ const m={}; facturasConSaldo.forEach(b=>{ (m[b.client_id]=m[b.client_id]||[]).push(b) }); return m },[facturasConSaldo])
  // Abono conciliable contra facturas: identificado a cliente, no interno, y de honorarios (Comisión/Subarriendo/Otro NO calzan).
  const esConciliable = m => m.tipo==='abono' && !m.es_interno && !!m.cliente_id && (!m.categoria || m.categoria==='Cliente')
  // Pool de calce del cliente (un pago en 2+ transferencias se imputa a la MISMA factura; una factura ya cubierta SALE del pool).
  const facturasCliente = cid => facturasPorCliente[cid] || []
  // RUTs de un cliente (el suyo + todas sus razones sociales) y de una factura (receptor/entidad/cliente), normalizados.
  const _rutsCliente = cid => { const s=new Set(); const add=r=>{ const n=crNormRut(r); if(n)s.add(n) }; const c=clients.find(x=>String(x.id)===String(cid)); if(c)add(c.rut); (clientEntities||[]).filter(e=>String(e.client_id)===String(cid)).forEach(e=>add(e.rut)); return s }
  const _rutsFactura = b => { const s=new Set(); const add=r=>{ const n=crNormRut(r); if(n)s.add(n) }; add(b.receptor_rut); const e=(clientEntities||[]).find(x=>String(x.id)===String(b.entity_id)); if(e)add(e.rut); const c=clients.find(x=>String(x.id)===String(b.client_id)); if(c)add(c.rut); (clientEntities||[]).filter(x=>String(x.client_id)===String(b.client_id)).forEach(x=>add(x.rut)); return s }
  // Pool para calzar un ABONO: las facturas del cliente + las de CUALQUIER cliente cuyo RUT calce con el del abono
  // (pagador) o con el del cliente identificado/sus RS. Así se sugiere la factura emitida a la empresa aunque el
  // pago venga con el RUT personal. El calce sigue exigiendo monto EXACTO, así que no genera falsos positivos.
  const facturasParaMov = mov => { const cid=mov.cliente_id; const base=facturasCliente(cid); const ruts=_rutsCliente(cid); const pr=crNormRut(mov.rut_contraparte); if(pr)ruts.add(pr); if(!ruts.size) return base; const seen=new Set(base.map(b=>String(b.id))); const extra=facturasConSaldo.filter(b=>String(b.client_id)!==String(cid)&&!seen.has(String(b.id))&&[...(_rutsFactura(b))].some(r=>ruts.has(r))); return extra.length?[...base,...extra]:base }
  // Diferencia en meses entre el mes de la factura (emisión) y el del pago (factura − pago). null si falta dato.
  const mesDiff = (fm,pm) => { if(!fm||!pm) return null; const [ya,ma]=fm.split('-').map(Number),[yb,mb]=pm.split('-').map(Number); return (ya*12+ma)-(yb*12+mb) }
  // Candidatas dentro de ±TOL del monto. Refuerzo para asesorías recurrentes (mismo monto cada mes): se EXCLUYE
  // toda factura emitida en un mes POSTERIOR al pago (no se paga hoy una factura del próximo mes) y se ordena por
  // cercanía de fecha (la del mes del pago primero) → así el pago de mayo calza la factura de mayo, no la de junio.
  // Reglas de calce: fuente única en supabase/functions/_shared/conciliacionReglas.js (las mismas que usa el servidor en conciliacion-auto).
  const _poolMov = (mov, exclude) => facturasParaMov(mov).filter(b=> !(exclude&&exclude.has(b.id))).map(b=>({b,saldo:saldoFactura(b)}))
  const candidatos = (mov, exclude, amount) => esConciliable(mov) ? candidatosFactura(mov, _poolMov(mov,exclude), amount) : []
  // Señal premium: el banco escribe el folio en la glosa ("PAGO FACTURA 412", "F°412"); el aviso del banco trae el mensaje del cliente.
  const folioGlosa = m => folioEnTexto(m?.descripcion)
  const mejorCandidato = (mov, exclude) => esConciliable(mov) ? elegirFactura(mov, _poolMov(mov,exclude), [mov.descripcion, mov.detalle_aviso].filter(Boolean).join(' ')) : null
  // Candidatas para MOSTRAR/CONFIRMAR (no auto): facturas del cliente/RUT cuyo saldo calza EXACTO con el pago, SIN la ventana
  // de fecha del auto. Motivo: la firma a veces emite la factura DESPUÉS de recibir el pago (emisión tardía) o el pago llega
  // meses antes/después; si el monto calza exacto y es del cliente, se OFRECE sí o sí (el usuario confirma). El auto
  // (mejorCandidato) sigue con la ventana estricta para no marcar pagos solo. Excluye ya pagadas/conciliadas (facturasParaMov→facturasConSaldo).
  const candidatosMostrar = (mov, exclude, amount) => { const amt = amount==null?(mov.monto||0):amount
    if(!esConciliable(mov) || amt<=0) return []
    const pr=crNormRut(mov.rut_contraparte)
    return facturasParaMov(mov).filter(b=> !(exclude&&exclude.has(b.id)))
      .map(b=>({b,saldo:saldoFactura(b)}))
      .filter(x=> x.saldo>0 && Math.abs(x.saldo-amt)<=TOL)   // monto EXACTO (TOL=0) + cliente/RUT; sin filtro de fecha
      .sort((a,b)=> ((pr&&crNormRut(b.b.receptor_rut)===pr?1:0)-(pr&&crNormRut(a.b.receptor_rut)===pr?1:0)) || ((a.b.issued_at||'').localeCompare(b.b.issued_at||'')))   // FIFO: la más antigua sin pagar primero
      .map(x=>x.b) }
  const tieneCand = m => esConciliable(m) && candidatosMostrar(m).length>0
  // Sugerencia de cliente por MONTO: para abonos sin identificar (depósitos sin RUT), busca una factura de algún
  // cliente cuyo saldo calce EXACTO con el abono y caiga en la ventana de fecha. Solo sugiere si el cliente es ÚNICO.
  // Un pagador ya aprendido como fuente NO-cliente (Tercero/Reembolso/Intereses/Pago histórico/Subarriendo) — p.ej. una intermediaria
  // que nos devuelve plata de una gestión — NO debe proponerse como cliente por MONTO (evita el falso "monto exacto" contra la factura
  // de otro cliente por pura coincidencia de cifra). Reusa el aprendizaje cartola_tipo (tipoAprendido), sin un learning nuevo.
  const _pagadorNoCliente = (mov) => {
    const k = crNormRut(mov.rut_contraparte)
    const cat = (k && tipoAprendido[k]) || (mov.nombre_contraparte && tipoAprendido['n:'+_stripNom(mov.nombre_contraparte)]) || null
    return !!cat && RESUELTAS_ABO.includes(cat)
  }
  const clientePorMonto = (mov) => {
    if(mov.cliente_id || mov.es_interno || mov.tipo!=='abono') return null
    if(_pagadorNoCliente(mov)) return null
    const amt = mov.monto||0; if(amt<=0) return null
    const payT = mov.fecha ? new Date(mov.fecha+'T12:00').getTime() : null
    const inwin = iso => { if(!payT||!iso) return true; const d=(payT-new Date(iso.slice(0,10)+'T12:00').getTime())/86400000; return d>=-3 && d<=60 }
    const ms = facturasConSaldo.filter(b=> b.client_id && Math.abs(saldoFactura(b)-amt)<=TOL && inwin(b.issued_at))
    if(!ms.length) return null
    const cids=[...new Set(ms.map(b=>String(b.client_id)))]
    if(cids.length!==1) return null
    return { cid:cids[0], factura:ms[0] }
  }
  // ÚLTIMO criterio de calce — SOLO sugerencia manual (nunca auto): un depósito sin identificar (sin cliente ni RUT que calce) se
  // busca contra CUALQUIER factura emitida sin pago cuyo saldo calce EXACTO, con la ventana AMPLIA del matcher normal (hasta ~36 meses
  // tarde), sin la ventana estrecha del auto ni exigir cliente único. Devuelve las candidatas ordenadas por cercanía al pago, para elegir.
  const facturaPorMontoManual = (mov) => {
    if(mov.cliente_id || mov.es_interno || mov.tipo!=='abono') return []
    if(_pagadorNoCliente(mov)) return []
    const amt = mov.monto||0; if(amt<=0) return []
    const payT = mov.fecha ? new Date(mov.fecha+'T12:00').getTime() : null
    const delta = iso => (payT&&iso) ? (payT-new Date(iso.slice(0,10)+'T12:00').getTime())/86400000 : null
    return facturasConSaldo
      .filter(b=> b.client_id && Math.abs(saldoFactura(b)-amt)<=TOL)
      .map(b=>({b, d:delta(b.issued_at)}))
      .filter(x=> x.d===null || (x.d>=-60 && x.d<=1095))
      .sort((a,b)=> (a.d==null?9e9:Math.abs(a.d))-(b.d==null?9e9:Math.abs(b.d)))
      .map(x=>x.b)
  }
  // D — Sugerencias de identificación por NOMBRE (único) para abonos sin cliente. El auto ya hace la id por monto; esto es para confirmar en lote las de nombre (con compuerta humana).
  const sugeridosId = useMemo(()=>{ const out=[]
    movs.forEach(m=>{ if(m.tipo!=='abono'||m.es_interno||m.cliente_id||RESUELTAS_ABO.includes(m.categoria)||concByMov[m.id]?.length) return
      const cid=sugerencias[m.id]; if(!cid) return
      out.push({mov:m, cid}) })
    return out },[movs,sugerencias,concByMov])
  const identificarLote = async()=>{
    const sel=sugeridosId.filter(s=>revSugSel.has(s.mov.id)); if(!sel.length) return
    setRevSugBusy(true)
    try{ for(const s of sel){ await identificar(s.mov, s.cid, true) } }
    finally{ setRevSugBusy(false); setRevSugOpen(false); setRevSugSel(new Set()) }
  }
  // Descalce = abono no interno, no conciliado, sin clasificar como no-honorario, y que NO tiene factura candidata
  // (sin cliente asociado, o con cliente pero sin factura que calce → fondo/anticipo/monto partido).
  // Descalce = abono IDENTIFICADO (con cliente) pero SIN factura que calce (anticipo o monto que no cuadra). Los sin cliente van a "Sin identificar", no acá (antes se solapaban).
  const esDescalce = m => m.tipo==='abono' && !m.es_interno && m.cliente_id && !(concByMov[m.id]?.length) && !tieneCand(m) && (!m.categoria||m.categoria==='Cliente')

  // Escribe el pago en billing (fuente de verdad única para "Pagado"). Cubierta → Pagado; si no, queda Pendiente con paid_amount.
  // reconciled_at (timestamp) marca "ya enlazada"; la distinción enlace-vs-marcó-pago va en conciliacion.marco_pago.
  const persistPagoFactura = async(factura, aplicadoTotal, fechaPago, ref)=>{
    const now=new Date().toISOString()
    let patch
    if(factura.status==='Pagado'){
      patch = { reconciled_at:now, updated_at:now }   // ya estaba pagada: SOLO enlaza, no toca estado/monto
    } else {
      const cubierta = aplicadoTotal >= (factura.amount||0)-TOL   // cubierta = aplicado cubre el monto (TOL=0: calce exacto, no hay comisiones)
      patch = cubierta
        ? { status:'Pagado', paid:true, paid_at:fechaPago, payment_date:fechaPago, payment_method:'Transferencia', payment_ref:ref||null, paid_amount:(factura.amount||0), reconciled_at:now, updated_at:now }
        : { paid_amount:aplicadoTotal, payment_method:'Transferencia', payment_ref:ref||null, reconciled_at:now, updated_at:now }
    }
    const { error } = await supabase.from('billing').update(patch).eq('id',factura.id)
    if(error) throw error
    setBilling&&setBilling(p=>p.map(b=>b.id===factura.id?{...b,...patch}:b))
    if(patch.status==='Pagado' && onFacturaPagada) onFacturaPagada(factura.id)   // FLIP comisiones: al conciliar el pago TOTAL, las cuentas a proveedor de esa factura pasan pendiente→por_pagar. Antes la conciliación no tocaba terceros → Cuentas por Pagar subvaloradas.
  }
  // ¿Esta aplicación TRANSICIONA la factura a Pagada? (para guardar marco_pago en la fila y revertir bien al deshacer)
  const marcaPago = (factura, aplicadoTotal) => factura.status!=='Pagado' && aplicadoTotal >= (factura.amount||0)-TOL
  // Registro auditable de quién concilió: update RESILIENTE (si la columna created_by aún no existe, falla en
  // silencio y NO rompe la conciliación). Lo llaman los reconciliar* tras crear cada fila. El 'cómo' va en origen, el 'cuándo' en created_at.
  const marcaQuien = (crId)=>{ if(!crId||!user?.email) return; try{ supabase.from('conciliacion').update({created_by:user.email}).eq('id',crId).then(()=>{},()=>{}) }catch(_){} }
  // Aplica un abono (o su resto) a una factura: crea fila conciliacion, marca la factura y avanza el estado del movimiento.
  const reconciliar = async(mov, factura, origen='manual')=>{
    if(busy) return
    setBusy(mov.id)
    let cr=null
    try{
      const saldo = saldoFactura(factura)
      const resto = (mov.monto||0) - (mov.monto_conciliado||0)
      const aplicado = Math.max(0, Math.min(resto, saldo))
      if(aplicado<=0){ setBusy(null); appAlert(saldo<=0 ? `La Factura N° ${folioN(factura.invoice_no)||'—'} ya está conciliada (sin saldo). Usa "Liberar calce" para soltarla y poder reasignar este pago.` : 'Este pago ya quedó completamente conciliado.'); return }   // INV-7: monto_aplicado siempre > 0; avisa por qué no se aplicó
      // REGLA: ninguna conciliación MANUAL se aplica sin mostrar el detalle de qué se concilia (factura ↔ movimiento ↔ montos).
      // Los lotes/auto/SII (origen distinto de 'manual') no piden confirmación (son calces únicos de alta confianza).
      if(origen==='manual'){
        const cli=clients.find(c=>String(c.id)===String(factura.client_id))
        const cubre = aplicado >= saldo - TOL
        const op = mov.n_operacion?` · Op ${mov.n_operacion}`:''
        const fx = n => '$'+Math.round(n||0).toLocaleString('es-CL')
        const msg = `¿Conciliar este pago?\n\n`+
          `Factura N° ${folioN(factura.invoice_no)||'—'}${cli?.name?` · ${cli.name}`:''}\n`+
          `Saldo de la factura: ${fx(saldo)}\n\n`+
          `Pago del banco: ${mov.fecha?fmtFechaDMY(mov.fecha):''} · ${mov.nombre_contraparte||'—'}${op}\n`+
          `Disponible del abono: ${fx(resto)}\n\n`+
          `Se aplicará ${fx(aplicado)} → ${cubre?'la factura queda PAGADA y enlazada al banco.':`pago PARCIAL, quedará saldo ${fx(saldo-aplicado)}.`}`
        if(!await appConfirm(msg)){ setBusy(null); return }
      }
      const manualExtra = Math.max(0, (factura.paid_amount||0) - (aplicadoByFactura[factura.id]||0))  // abono manual fuera de las filas de conciliación: súmalo, no lo reemplaces
      const aplTot = (aplicadoByFactura[factura.id]||0)+aplicado+manualExtra
      const ins = await supabase.from('conciliacion').insert({ movimiento_id:mov.id, tipo_destino:'factura', factura_id:factura.id, monto_aplicado:aplicado, origen, marco_pago:marcaPago(factura,aplTot) }).select().single()
      if(ins.error) throw ins.error
      cr=ins.data; marcaQuien(cr.id)
      await persistPagoFactura(factura, aplTot, mov.fecha, mov.n_operacion)
      const movAplicado = (mov.monto_conciliado||0)+aplicado
      const estado = ((mov.monto||0)-movAplicado) <= TOL ? 'conciliado' : 'parcial'
      const { error:me } = await supabase.from('cartola_movimientos').update({ estado, monto_conciliado:movAplicado }).eq('id',mov.id)
      if(me) throw me
      setConc(p=>[...p,cr]); setMovs(p=>p.map(x=>x.id===mov.id?{...x,estado,monto_conciliado:movAplicado}:x)); setPickFor(null)
      if(origen!=='lote') logActividad('banco.conciliado',{tabla:'conciliacion',id:cr.id,detalle:{folio:factura.invoice_no,name:cmap[factura.client_id]||mov.nombre_contraparte||null,monto:aplicado}})   // el lote deja una sola línea (banco.conciliar_varias)
      if(marcaPago(factura,aplTot)){ const cli=clients.find(c=>String(c.id)===String(factura.client_id)); const to=(cli?.email||'').trim(); if(to){ const fol=`Factura N° ${folioN(factura.invoice_no)||'—'}`; const mnt='$'+(factura.amount||0).toLocaleString('es-CL'); if(await appConfirm(`Factura conciliada y pagada por completo. ¿Enviar acuse de pago a ${to}?`)) acusePagoEmail(to,{folio:fol,monto:mnt,fecha:mov.fecha?fmtFechaDMY(mov.fecha):''}).then(via=>{ if(via) appAlert(txtEnviado(via,{que:'Acuse de pago',para:to})) }).catch(e=>appAlert('No se pudo enviar el acuse: '+(e?.message||e))) } }
    }catch(e){ if(cr) await supabase.from('conciliacion').delete().eq('id',cr.id); appAlert('Error al conciliar: '+e.message) }
    setBusy(null)
  }
  // Detecta el caso "una transferencia paga 2 facturas": par de facturas del pool cuyos saldos suman el monto (±TOL).
  const combos = (mov) => { if(!esConciliable(mov)) return null
    const fs = facturasCliente(mov.cliente_id).map(f=>({f,saldo:saldoFactura(f)})).filter(x=>x.saldo>0)
    const target=(mov.monto||0); let best=null, bestD=TOL+1
    for(let i=0;i<fs.length;i++) for(let j=i+1;j<fs.length;j++){ const d=Math.abs(fs[i].saldo+fs[j].saldo-target); if(d<=TOL&&d<bestD){ bestD=d; best=[fs[i].f,fs[j].f] } }
    if(best) return best
    // 3 facturas que sumen el abono (solo si no hubo par; cap para no explotar)
    if(fs.length<=45){ for(let i=0;i<fs.length;i++) for(let j=i+1;j<fs.length;j++) for(let k=j+1;k<fs.length;k++){ const d=Math.abs(fs[i].saldo+fs[j].saldo+fs[k].saldo-target); if(d<=TOL&&d<bestD){ bestD=d; best=[fs[i].f,fs[j].f,fs[k].f] } } }
    return best }
  // Combo EXACTO para el AUTO (fuente única elegirCombo): 2 o 3 facturas no futuras cuyos saldos suman el monto, si es única o
  // si todas las combinaciones son de los mismos montos (cuotas idénticas → las más antiguas); o N cuotas idénticas.
  const comboExacto = (mov, exclude) => esConciliable(mov) ? elegirCombo(mov, facturasCliente(mov.cliente_id).filter(b=> !(exclude&&exclude.has(b.id))).map(f=>({b:f,saldo:saldoFactura(f)}))) : null
  const comboExacto3 = () => null   // incluido en comboExacto (elegirCombo prueba pares, tríos y cuotas idénticas)
  // Gasto ya reembolsado vía conciliación (filas tipo_destino='gasto'), por cliente — para no re-sugerir lo ya cubierto.
  const cidByMov = useMemo(()=>{ const m={}; movs.forEach(x=>m[x.id]=x.cliente_id); return m },[movs])
  const reembGastoByCliente = useMemo(()=>{ const m={}; conc.forEach(c=>{ if(c.tipo_destino==='gasto'){ const cid=cidByMov[c.movimiento_id]; if(cid) m[cid]=(m[cid]||0)+(c.monto_aplicado||0) } }); return m },[conc,cidByMov])
  // Gastos pendientes de reembolso del cliente = (gastos − fondos del ledger) − lo ya reembolsado por conciliación.
  const gastoPend = cid => Math.max(0, -saldoCliente(expenses, cid) - (reembGastoByCliente[cid]||0))
  // 3.B — gastos del cliente AÚN no reembolsados (candidatos a marcar en una devolución), del más antiguo al más nuevo.
  const gastosReembolsables = cid => (expenses||[]).filter(e=> e.type!=='fondo' && !e.no_descuenta_saldo && String(e.client_id)===String(cid) && !e.reembolso_fondo_id && !e.deleted_at && cuentaEnSaldo(e)).sort((a,b)=>(a.date||'')<(b.date||'')?-1:1)
  // Caso "factura + gastos": el abono excede una factura y el exceso ≈ los gastos pendientes del cliente (reembolso junto a honorarios).
  const facturaMasGastos = (mov) => { if(!esConciliable(mov)) return null
    const pend = gastoPend(mov.cliente_id); if(pend<=0) return null
    const fs = facturasCliente(mov.cliente_id).map(f=>({f,saldo:saldoFactura(f)})).filter(x=>x.saldo>0)
    let best=null, bestD=TOL+1
    for(const {f,saldo} of fs){ const excess=(mov.monto||0)-saldo; if(excess<=0) continue; const d=Math.abs(excess-pend); if(d<=TOL&&d<bestD){ bestD=d; best={factura:f,saldo,excess} } }
    return best }
  // Concilia el abono contra VARIAS facturas en una pasada (lleva el monto_conciliado corrido entre facturas).
  const reconciliarCombo = async(mov, facturas)=>{
    if(busy) return
    setBusy(mov.id)
    const nuevas=[]
    try{
      let movAplicado = (mov.monto_conciliado||0); let aplicLocal={}
      for(const factura of facturas){
        const saldo = Math.max(0,(factura.amount||0)-((aplicadoByFactura[factura.id]||0)+(aplicLocal[factura.id]||0)))
        const aplicado = Math.max(0, Math.min((mov.monto||0)-movAplicado, saldo))
        if(aplicado<=0) continue
        const aplTot = (aplicadoByFactura[factura.id]||0)+(aplicLocal[factura.id]||0)+aplicado
        const ins = await supabase.from('conciliacion').insert({ movimiento_id:mov.id, tipo_destino:'factura', factura_id:factura.id, monto_aplicado:aplicado, origen:'manual', marco_pago:marcaPago(factura,aplTot) }).select().single()
        if(ins.error) throw ins.error
        nuevas.push(ins.data); marcaQuien(ins.data.id)
        await persistPagoFactura(factura, aplTot, mov.fecha, mov.n_operacion)
        aplicLocal[factura.id]=(aplicLocal[factura.id]||0)+aplicado; movAplicado += aplicado
      }
      const estado = ((mov.monto||0)-movAplicado) <= TOL ? 'conciliado' : 'parcial'
      const { error:me } = await supabase.from('cartola_movimientos').update({ estado, monto_conciliado:movAplicado }).eq('id',mov.id)
      if(me) throw me
      setConc(p=>[...p,...nuevas]); setMovs(p=>p.map(x=>x.id===mov.id?{...x,estado,monto_conciliado:movAplicado}:x)); setPickFor(null)
    }catch(e){ for(const cr of nuevas) await supabase.from('conciliacion').delete().eq('id',cr.id); appAlert('Error al conciliar combinación: '+e.message) }
    setBusy(null)
  }

  // ── Conciliación en LOTE: concilia de una todos los abonos con calce EXACTO y ÚNICO (mejorCandidato), deduplicados por
  // factura (una misma factura no se aplica a dos abonos → esos van a "por revisar"). Reusa reconciliar (reversible).
  const [loteOpen,setLoteOpen] = useState(false)
  const [loteBusy,setLoteBusy] = useState(false)
  const [loteProg,setLoteProg] = useState(0)
  const [loteConfirm,setLoteConfirm] = useState(null)   // exactos pendientes de confirmar en el modal detallado
  const [siiBuscando,setSiiBuscando] = useState(null)   // {hechos,total,mes} mientras busca en el SII
  const [siiResumen,setSiiResumen] = useState(null)     // resultado del último "Buscar todo en el SII"
  const [siiMovBusy,setSiiMovBusy] = useState(null)     // id del movimiento cuyo chip está buscando en el SII
  const [siiMovHit,setSiiMovHit] = useState(null)       // {movId, rows:[huérfanas que calzan], aplicadas, err} — resultado inline por movimiento
  const [siiMovIng,setSiiMovIng] = useState(null)       // folio en curso de "Ingresar y conciliar"
  // Busca en el SII SOLO para este movimiento (mes del pago + meses atrás), sin salir de la conciliación.
  // Las que ya calzaron aparecen abajo como sugerencia; las huérfanas que coinciden por RUT/monto se ofrecen con "Ingresar y conciliar".
  const buscarMovSII = async(m)=>{
    if(!onBuscarSII||siiBuscando||siiMovBusy) return
    const mesPago=String(m.fecha||'').slice(0,7)
    if(!/^\d{4}-\d{2}$/.test(mesPago)) return
    setSiiMovHit(null); setSiiMovBusy(m.id); setSiiBuscando({hechos:0,total:1,mes:mesPago})
    const r=await onBuscarSII([mesPago],(h,t,mes)=>setSiiBuscando({hechos:h,total:t,mes}))
    setSiiBuscando(null); setSiiMovBusy(null)
    if(!r||r.err){ setSiiMovHit({movId:m.id,err:(r&&r.err)||'No se pudo buscar en el SII'}); return }
    const rutsM=_rutsCliente(m.cliente_id); const pr=crNormRut(m.rut_contraparte); if(pr)rutsM.add(pr)
    const abs=Math.abs(Number(m.monto)||0)
    const rows=(r.sinMatch||[]).filter(x=>{ const rr=crNormRut(x.rut); return (rr&&rutsM.has(rr))||Math.abs(Number(x.monto)||0)===abs })
      .sort((a,b)=>(Math.abs(Number(a.monto)||0)===abs?0:1)-(Math.abs(Number(b.monto)||0)===abs?0:1))
    setSiiMovHit({movId:m.id,rows,aplicadas:r.aplicadas||0})
  }
  // Ingresa la huérfana del SII (forzando el cliente del movimiento) y concilia el abono con ella en un paso.
  const ingresarYConciliar = async(m,row)=>{
    if(!onIngresarSII||siiMovIng) return
    setSiiMovIng(row.folio)
    try{ const fac=await onIngresarSII(row,m.cliente_id); if(fac) await reconciliar(m,fac,'sii'); setSiiMovHit(null) }
    catch(e){ appAlert('No se pudo ingresar/conciliar: '+(e.message||e)) }
    setSiiMovIng(null)
  }
  const buscarTodoSII = async(movsSinFac)=>{
    if(!onBuscarSII||siiBuscando) return
    const meses=[...new Set((movsSinFac||[]).map(m=>String(m.fecha||'').slice(0,7)).filter(mm=>/^\d{4}-\d{2}$/.test(mm)))]
    if(!meses.length) return
    if(!(await appConfirm(`Buscar en el SII los ${meses.length} mes${meses.length!==1?'es':''} de estos pagos. Trae/actualiza las facturas emitidas y sugiere el calce. ¿Seguir?`))) return
    setSiiResumen(null); setSiiBuscando({hechos:0,total:meses.length,mes:meses[0]})
    const r=await onBuscarSII(meses,(hechos,total,mes)=>setSiiBuscando({hechos,total,mes}))
    setSiiBuscando(null); setSiiResumen(r||null)
  }
  const conciliarLote = async(exactos)=>{
    if(loteBusy||!exactos.length) return
    setLoteBusy(true); setLoteProg(0)
    for(let i=0;i<exactos.length;i++){ try{ await reconciliar(exactos[i].m, exactos[i].f, 'lote') }catch(_){}; setLoteProg(i+1) }
    logActividad('banco.conciliar_varias',{detalle:exactos.map(x=>({folio:x.f?.invoice_no,name:x.m?.nombre_contraparte||null,monto:x.m?.monto}))})
    setLoteBusy(false); setLoteOpen(false); setLoteConfirm(null)
  }

  // ── Pago en GRUPO: N transferencias del mismo cliente (cercanas en fecha) que juntas pagan M facturas (suma exacta) ──
  // Devuelve {transfers,facturas,total} o null. Subset-sum acotado; prefiere menos transferencias y facturas más cercanas/contiguas.
  const grupoPago = (mov)=>{
    if(!esConciliable(mov)) return null
    const W=30*86400000
    const near = movs.filter(m=> esConciliable(m) && String(m.cliente_id)===String(mov.cliente_id) && m.id!==mov.id && !(concByMov[m.id]?.length) && Math.abs(new Date(m.fecha)-new Date(mov.fecha))<=W)
    if(!near.length) return null
    const fsAll = facturasCliente(mov.cliente_id).map(f=>({f,saldo:saldoFactura(f)})).filter(x=>x.saldo>0)
    if(fsAll.length<2 || fsAll.length>12) return null
    const pFecha = new Date(mov.fecha).getTime()
    const facsParaTotal = (target)=>{
      const n=fsAll.length; let best=null, bestScore=Infinity
      for(let mask=1; mask<(1<<n); mask++){ let s=0; const pick=[]; for(let i=0;i<n;i++){ if(mask&(1<<i)){ s+=fsAll[i].saldo; pick.push(fsAll[i]) } } if(s!==target) continue
        const avg = pick.reduce((a,x)=>a+Math.abs(new Date(x.f.issued_at||x.f.due||mov.fecha).getTime()-pFecha),0)/pick.length
        const score = pick.length*1e15 + avg
        if(score<bestScore){ bestScore=score; best=pick.map(x=>x.f) } }
      return best
    }
    const others = near.slice().sort((a,b)=>Math.abs(new Date(a.fecha)-pFecha)-Math.abs(new Date(b.fecha)-pFecha)).slice(0,4)
    // prueba subconjuntos de 'others' (mov siempre incluido), de menor a mayor cantidad de transferencias
    const masks = []; for(let mask=1; mask<(1<<others.length); mask++) masks.push(mask)
    masks.sort((a,b)=>{ const pa=a.toString(2).split('1').length, pb=b.toString(2).split('1').length; return pa-pb })
    for(const mask of masks){
      const grp=[mov]; let tot=mov.monto||0
      for(let i=0;i<others.length;i++){ if(mask&(1<<i)){ grp.push(others[i]); tot+=others[i].monto||0 } }
      const facs = facsParaTotal(tot)
      if(facs && facs.length>=grp.length){
        // Si cada transferencia iguala EXACTO una factura (misma multiset de montos), son pagos INDIVIDUALES 1:1, no un grupo → no lo sugieras como grupo.
        const tAmts=grp.map(t=>t.monto||0).sort((a,b)=>a-b), fAmts=facs.map(f=>saldoFactura(f)).sort((a,b)=>a-b)
        const clean1a1 = grp.length===facs.length && tAmts.every((a,i)=>a===fAmts[i])
        if(!clean1a1) return { transfers:grp, facturas:facs, total:tot }
      }
    }
    return null
  }
  // Distribuye N transferencias entre M facturas (llena cada factura con las transferencias en orden). Crea las conciliaciones.
  const reconciliarGrupo = async(transfers, facturas)=>{
    if(busy) return
    setBusy((transfers[0]&&transfers[0].id)||(facturas[0]&&facturas[0].id))
    const nuevas=[]
    try{
      const ts=[...transfers].sort((a,b)=> (a.fecha||'')<(b.fecha||'')?-1:1)
      const fs=[...facturas].sort((a,b)=> (a.issued_at||'')<(b.issued_at||'')?-1:1)
      const restoMov={}; ts.forEach(t=>restoMov[t.id]=(t.monto||0)-(t.monto_conciliado||0))
      const aplicLocal={}
      for(const factura of fs){
        let saldo = Math.max(0,(factura.amount||0)-((aplicadoByFactura[factura.id]||0)+(aplicLocal[factura.id]||0)))
        for(const tr of ts){
          if(saldo<=0) break
          const aplicado = Math.max(0, Math.min(restoMov[tr.id]||0, saldo))
          if(aplicado<=0) continue
          const aplTot = (aplicadoByFactura[factura.id]||0)+(aplicLocal[factura.id]||0)+aplicado
          const ins = await supabase.from('conciliacion').insert({ movimiento_id:tr.id, tipo_destino:'factura', factura_id:factura.id, monto_aplicado:aplicado, origen:'auto', marco_pago:marcaPago(factura,aplTot) }).select().single()
          if(ins.error) throw ins.error
          nuevas.push(ins.data); marcaQuien(ins.data.id)
          aplicLocal[factura.id]=(aplicLocal[factura.id]||0)+aplicado; restoMov[tr.id]=(restoMov[tr.id]||0)-aplicado; saldo-=aplicado
          await persistPagoFactura(factura, aplTot, tr.fecha, tr.n_operacion)
        }
      }
      const ups=[]
      for(const tr of ts){ const movAplicado=(tr.monto||0)-(restoMov[tr.id]||0); const estado=((tr.monto||0)-movAplicado)<=TOL?'conciliado':'parcial'; const { error:me }=await supabase.from('cartola_movimientos').update({estado,monto_conciliado:movAplicado}).eq('id',tr.id); if(me) throw me; ups.push({id:tr.id,estado,monto_conciliado:movAplicado}) }
      setConc(p=>[...p,...nuevas]); setMovs(p=>p.map(x=>{ const u=ups.find(z=>z.id===x.id); return u?{...x,estado:u.estado,monto_conciliado:u.monto_conciliado}:x })); setModalMov(null)
    }catch(e){ for(const cr of nuevas) await supabase.from('conciliacion').delete().eq('id',cr.id); appAlert('Error al conciliar el grupo: '+e.message) }
    setBusy(null)
  }
  // Concilia "factura + gastos": aplica el saldo a la factura (la marca pagada) y registra el exceso como reembolso de
  // gastos (fila tipo_destino='gasto'). No toca el ledger de gastos todavía (eso es Fase 3 fina); deja la trazabilidad.
  const reconciliarFacturaGastos = async(mov, fg)=>{
    if(busy) return
    setBusy(mov.id)
    let crF=null, crG=null, fondo=null
    try{
      const aplicF = Math.max(0, Math.min((mov.monto||0)-(mov.monto_conciliado||0), fg.saldo))
      const aplTotF = (aplicadoByFactura[fg.factura.id]||0)+aplicF
      const insF = await supabase.from('conciliacion').insert({ movimiento_id:mov.id, tipo_destino:'factura', factura_id:fg.factura.id, monto_aplicado:aplicF, origen:'manual', marco_pago:marcaPago(fg.factura,aplTotF) }).select().single()
      if(insF.error) throw insF.error; crF=insF.data; marcaQuien(crF.id)
      await persistPagoFactura(fg.factura, aplTotF, mov.fecha, mov.n_operacion)
      let movAplicado=(mov.monto_conciliado||0)+aplicF
      const excess=(mov.monto||0)-movAplicado
      // El reembolso de gastos crea un FONDO (entra al saldo del cliente → lo corrige), no un bulto sin efecto.
      if(excess>0){
        const insFon = await supabase.from('expenses').insert({ client_id:mov.cliente_id, ...proyectoSeguro(mov.cliente_id, sales, {saleId:fg.factura.sale_id}), type:'fondo', amount:excess, date:mov.fecha, concept:`Reembolso de gastos · Factura N° ${folioN(fg.factura.invoice_no)||'—'} (conciliación)`, category:'Fondo', created_by:user?.email||null }).select().single()
        if(insFon.error) throw insFon.error; fondo=insFon.data
        const insG = await supabase.from('conciliacion').insert({ movimiento_id:mov.id, tipo_destino:'fondo', gasto_id:fondo.id, monto_aplicado:excess, origen:'manual' }).select().single()
        if(insG.error) throw insG.error; crG=insG.data; marcaQuien(crG.id); movAplicado+=excess
      }
      const estado = ((mov.monto||0)-movAplicado) <= TOL ? 'conciliado' : 'parcial'
      const { error:me } = await supabase.from('cartola_movimientos').update({ estado, monto_conciliado:movAplicado }).eq('id',mov.id)
      if(me) throw me
      if(fondo) setExpenses&&setExpenses(p=>[fondo,...p])
      setConc(p=>[...p,crF,...(crG?[crG]:[])]); setMovs(p=>p.map(x=>x.id===mov.id?{...x,estado,monto_conciliado:movAplicado}:x)); setPickFor(null)
    }catch(e){ if(crG) await supabase.from('conciliacion').delete().eq('id',crG.id); if(fondo) await supabase.from('expenses').delete().eq('id',fondo.id); if(crF) await supabase.from('conciliacion').delete().eq('id',crF.id); appAlert('Error al conciliar factura + gastos: '+e.message) }
    setBusy(null)
  }
  // Conciliar una factura de GASTOS/REEMBOLSO: la marca como reembolso (billing_type='reembolso' → FUERA de ingresos,
  // única palanca que excluye del por-cobrar/cobrado) y la concilia (pagada con respaldo bancario). Opcionalmente abona
  // el monto al FONDO POR RENDIR del cliente (prepago para gastos futuros). El usuario elige si SOLO salda o además funde
  // (regla conciliacion-paralelo-y-reembolso). Cifra: no doble-cuenta — la factura reembolso no suma a saldo; el fondo sí.
  const reconciliarReembolso = async(mov, factura, conFondo)=>{
    if(busy) return
    let fReemb=factura
    if((factura.billing_type||'')!=='reembolso'){
      try{
        const { error } = await supabase.from('billing').update({ billing_type:'reembolso', updated_at:new Date().toISOString() }).eq('id',factura.id)
        if(error) throw error
        logActividad('conciliacion.marcar_reembolso',{tabla:'billing',id:factura.id,detalle:{invoice_no:factura.invoice_no,amount:factura.amount,client_id:factura.client_id}})
        fReemb={...factura,billing_type:'reembolso'}
        setBilling&&setBilling(p=>p.map(b=>String(b.id)===String(factura.id)?{...b,billing_type:'reembolso'}:b))
      }catch(e){ appAlert('No se pudo marcar la factura como reembolso: '+e.message); return }
    }
    await reconciliar(mov, fReemb, 'manual')
    if(conFondo){
      try{
        const insFon = await supabase.from('expenses').insert({ client_id:fReemb.client_id||mov.cliente_id, ...proyectoSeguro(fReemb.client_id||mov.cliente_id, sales, {saleId:fReemb.sale_id}), type:'fondo', amount:(fReemb.amount||0), date:mov.fecha, concept:`Fondo por rendir · Factura N° ${folioN(fReemb.invoice_no)||'—'} (conciliación)`, category:'Fondo', created_by:user?.email||null }).select().single()
        if(insFon.error) throw insFon.error
        setExpenses&&setExpenses(p=>[insFon.data,...p])
      }catch(e){ appAlert('Factura conciliada, pero no se pudo crear el fondo por rendir: '+e.message) }
    }
  }
  // Devolución de gastos (abono que es 100% reembolso de un gasto que el estudio adelantó): crea un fondo por el
  // resto no aplicado (corrige el saldo del cliente). Mismo motor que la provisión, con concepto "Devolución".
  // 3.B — marca los gastos elegidos como reembolsados por este fondo (trazabilidad fina).
  const marcarGastosReembolsados = async(fondoId, gastoIds)=>{
    if(!fondoId || !gastoIds || !gastoIds.length) return
    try{
      await supabase.from('expenses').update({ reembolso_fondo_id:fondoId }).in('id', gastoIds)
      setExpenses&&setExpenses(p=>p.map(e=>gastoIds.includes(e.id)?{...e,reembolso_fondo_id:fondoId}:e))
    }catch(_){}
  }
  const devolucionGastos = async(mov, gastoIds)=>{
    if(busy) return
    if(!mov.cliente_id){ appAlert('Identifica el cliente antes de registrar la devolución.'); return }
    const resto=(mov.monto||0)-(mov.monto_conciliado||0)
    if(resto<=0){ appAlert('Esta transferencia ya está totalmente conciliada.'); return }
    // #4: si ya existe un fondo igual sin respaldo, ofrecer vincular ese (no duplicar).
    const exD = fondoExistente(mov, resto)
    if(exD && await appConfirm(`Este cliente ya tiene un fondo de ${fmtM(exD.amount||0)}${exD.date?' del '+fmtFechaDMY(exD.date):''} cargado a mano (sin respaldo bancario).\n\nAceptar = VINCULAR ese fondo a esta transferencia (no duplica).\nCancelar = crear uno NUEVO.`)){
      await vincularFondo(mov, exD.id, resto); await marcarGastosReembolsados(exD.id, gastoIds); setDevolFor(null); return
    }
    setBusy(mov.id)
    let fondo=null, cr=null
    try{
      const ins = await supabase.from('expenses').insert({ client_id:mov.cliente_id, ...proyectoSeguro(mov.cliente_id, sales), type:'fondo', amount:resto, date:mov.fecha, concept:'Devolución de gastos (conciliación bancaria)', category:'Fondo', created_by:user?.email||null }).select().single()
      if(ins.error) throw ins.error; fondo=ins.data
      const ic = await supabase.from('conciliacion').insert({ movimiento_id:mov.id, tipo_destino:'fondo', gasto_id:fondo.id, monto_aplicado:resto, origen:'manual' }).select().single()
      if(ic.error) throw ic.error; cr=ic.data; marcaQuien(cr.id)
      const nuevoConc=(mov.monto_conciliado||0)+resto
      const { error:me } = await supabase.from('cartola_movimientos').update({ estado:'conciliado', monto_conciliado:nuevoConc }).eq('id',mov.id)
      if(me) throw me
      await marcarGastosReembolsados(fondo.id, gastoIds)
      setExpenses&&setExpenses(p=>[fondo,...p]); setConc(p=>[...p,cr]); setMovs(p=>p.map(x=>x.id===mov.id?{...x,estado:'conciliado',monto_conciliado:nuevoConc}:x)); setDevolFor(null)
    }catch(e){ if(cr) await supabase.from('conciliacion').delete().eq('id',cr.id); if(fondo) await supabase.from('expenses').delete().eq('id',fondo.id); appAlert('Error al registrar devolución: '+e.message) }
    setBusy(null)
  }
  // Factura emitida y pendiente del MISMO cliente por el mismo monto (±1% o $1.000): si existe UNA, ese pago es esa factura,
  // no un anticipo suelto (caso Dante F486 / Gabriela F398). Devuelve la factura o null.
  const facturaMismoMonto = (mov, monto)=>{
    if(!mov?.cliente_id || !(monto>0)) return null
    const c=(billing||[]).filter(b=>!b.deleted_at&&String(b.client_id)===String(mov.cliente_id)&&b.invoice_no&&['Pendiente','Vencido'].includes(b.status)&&!['reembolso','nota_credito','subarriendo'].includes(b.billing_type||'')&&Math.abs(saldoFactura(b)-monto)<=Math.max(1000,monto*0.01))
    return c.length===1?c[0]:null
  }
  const ofrecerFacturaAntesDeAnticipo = async(mov, monto)=>{
    const f=facturaMismoMonto(mov, monto); if(!f) return false
    const fx=n=>'$'+Math.round(n||0).toLocaleString('es-CL')
    const ok=await appConfirm(`${cmap[mov.cliente_id]||'Este cliente'} tiene la Factura N° ${folioN(f.invoice_no)||'—'} pendiente por ${fx(saldoFactura(f))}${f.issued_at?` (emitida el ${fmtFechaDMY(f.issued_at)})`:''}, el mismo monto de este pago${mov.fecha?` del ${fmtFechaDMY(mov.fecha)}`:''}.\n\nAceptar = conciliar el pago a esa factura (queda PAGADA y enlazada al banco).\nCancelar = dejarlo igual como anticipo.`)
    if(!ok) return false
    await reconciliar(mov, f, 'sugerida')
    return true
  }
  // Deja el resto del abono como saldo a favor del cliente (anticipo disponible, reutiliza la feature Anticipos).
  const saldoAFavor = async(mov)=>{
    if(busy) return
    if((concByMov[mov.id]||[]).some(c=>c.tipo_destino==='anticipo')){ appAlert('Este movimiento ya generó un adelanto. Deshaz la conciliación antes de rehacerla.'); return }
    const resto = (mov.monto||0) - (mov.monto_conciliado||0)
    if(await ofrecerFacturaAntesDeAnticipo(mov, resto)) return
    // Compuerta anti-duplicado (espeja la de fondos, #4): si el cliente ya tiene un anticipo del mismo monto SIN respaldo
    // bancario (cargado a mano), ofrecer VINCULARLO a esta transferencia en vez de crear otro. Evita el doble de Gabriela.
    const _dup = anticipoExistente(mov, resto)
    if(_dup && await appConfirm(`Este cliente ya tiene un anticipo de ${fmtM(_dup.monto||0)}${_dup.fecha?' del '+fmtFechaDMY(_dup.fecha):''} cargado a mano (sin respaldo bancario).\n\nAceptar = VINCULAR ese anticipo a esta transferencia (no duplica).\nCancelar = crear uno NUEVO.`)){ await vincularAnticipo(mov, _dup.id, resto); return }
    setBusy(mov.id)
    let ant=null, cr=null
    try{
      // Enlaza el adelanto a la venta del cliente (si tiene UNA sola) para que entre al flujo
      // ya construido "Anticipos y cuotas" (Aplicar a cuotas / Emitir factura). Antes quedaba
      // flotando sin sale_id y se emitia una factura aparte -> doble registro (caso Gabriela).
      const _sids = [...new Set((billing||[]).filter(b=>String(b.client_id)===String(mov.cliente_id)&&b.sale_id).map(b=>String(b.sale_id)))]
      const _saleId = _sids.length===1 ? _sids[0] : null
      const ia = await supabase.from('anticipos').insert({ client_id:mov.cliente_id, sale_id:_saleId, monto:resto, fecha:mov.fecha, nota:'Pago sin factura (conciliación bancaria)', estado:'disponible', created_by:user?.email||null }).select().single()
      if(ia.error) throw ia.error
      ant=ia.data
      const ic = await supabase.from('conciliacion').insert({ movimiento_id:mov.id, tipo_destino:'anticipo', anticipo_id:ant.id, monto_aplicado:resto, origen:'manual' }).select().single()
      if(ic.error) throw ic.error
      cr=ic.data
      const { error:me } = await supabase.from('cartola_movimientos').update({ estado:'conciliado', monto_conciliado:(mov.monto||0) }).eq('id',mov.id)
      if(me) throw me
      setAnticipos&&setAnticipos(p=>[ant,...p]); setConc(p=>[...p,cr]); setMovs(p=>p.map(x=>x.id===mov.id?{...x,estado:'conciliado',monto_conciliado:(mov.monto||0)}:x)); setPickFor(null)
    }catch(e){ if(cr) await supabase.from('conciliacion').delete().eq('id',cr.id); if(ant) await supabase.from('anticipos').delete().eq('id',ant.id); appAlert('Error al crear saldo a favor: '+e.message) }
    setBusy(null)
  }
  // Split (abono sin factura que junta honorarios + gastos): adel → anticipo, resto → fondo por rendir. Marca el movimiento conciliado.
  const splitAdelantoFondo = async(mov, adelMonto)=>{
    if(busy) return
    if(!mov.cliente_id){ appAlert('Identifica el cliente primero.'); return }
    if((concByMov[mov.id]||[]).some(c=>c.tipo_destino==='anticipo')){ appAlert('Este movimiento ya generó un adelanto. Deshaz la conciliación antes de rehacerla.'); return }
    const resto = (mov.monto||0) - (mov.monto_conciliado||0)
    const adel = Math.max(0, Math.min(adelMonto||0, resto)); const fond = resto - adel
    if(fond<=0 && await ofrecerFacturaAntesDeAnticipo(mov, adel)) return
    setBusy(mov.id)
    let ant=null, fondo=null; const crs=[]
    try{
      if(adel>0){
        const _sids = [...new Set((billing||[]).filter(b=>String(b.client_id)===String(mov.cliente_id)&&b.sale_id).map(b=>String(b.sale_id)))]
        const _saleId = _sids.length===1 ? _sids[0] : null
        const ia = await supabase.from('anticipos').insert({ client_id:mov.cliente_id, sale_id:_saleId, monto:adel, fecha:mov.fecha, nota:'Honorarios sin factura (conciliación bancaria)', estado:'disponible', created_by:user?.email||null }).select().single()
        if(ia.error) throw ia.error; ant=ia.data
        const ic = await supabase.from('conciliacion').insert({ movimiento_id:mov.id, tipo_destino:'anticipo', anticipo_id:ant.id, monto_aplicado:adel, origen:'manual' }).select().single()
        if(ic.error) throw ic.error; crs.push(ic.data)
      }
      if(fond>0){
        const insF = await supabase.from('expenses').insert({ client_id:mov.cliente_id, ...proyectoSeguro(mov.cliente_id, sales), type:'fondo', amount:fond, date:mov.fecha, concept:'Provisión de fondos (conciliación bancaria)', category:'Fondo', created_by:user?.email||null }).select().single()
        if(insF.error) throw insF.error; fondo=insF.data
        const icF = await supabase.from('conciliacion').insert({ movimiento_id:mov.id, tipo_destino:'fondo', gasto_id:fondo.id, monto_aplicado:fond, origen:'manual' }).select().single()
        if(icF.error) throw icF.error; crs.push(icF.data)
      }
      const { error:me } = await supabase.from('cartola_movimientos').update({ estado:'conciliado', monto_conciliado:(mov.monto||0) }).eq('id',mov.id)
      if(me) throw me
      if(ant) setAnticipos&&setAnticipos(p=>[ant,...p]); if(fondo) setExpenses&&setExpenses(p=>[fondo,...p])
      setConc(p=>[...p,...crs]); setMovs(p=>p.map(x=>x.id===mov.id?{...x,estado:'conciliado',monto_conciliado:(mov.monto||0)}:x)); setSplitMov(null)
    }catch(e){ for(const c of crs) await supabase.from('conciliacion').delete().eq('id',c.id); if(ant) await supabase.from('anticipos').delete().eq('id',ant.id); if(fondo) await supabase.from('expenses').delete().eq('id',fondo.id); appAlert('Error al partir el abono: '+e.message) }
    setBusy(null)
  }
  // #4 — Evitar duplicar fondos: ¿el cliente ya tiene un fondo del mismo monto SIN respaldo bancario (cargado a mano,
  // no enlazado a ninguna conciliación, y que NO lo creó este flujo)? Si sí, se ofrece VINCULAR ese en vez de crear uno nuevo.
  const fondoExistente = (mov, monto) => {
    const cid = mov.cliente_id; if(!cid) return null
    const linked = new Set(conc.filter(c=>c.tipo_destino==='fondo'&&c.gasto_id).map(c=>String(c.gasto_id)))
    return (expenses||[]).find(e=> e.type==='fondo' && String(e.client_id)===String(cid) && Math.abs((e.amount||0)-monto)<=TOL && !linked.has(String(e.id)) && !/conciliaci[oó]n/i.test(e.concept||'')) || null
  }
  // Vincula un fondo YA existente (sin respaldo) a este movimiento, sin crear uno nuevo.
  const vincularFondo = async(mov, fondoId, monto) => {
    setBusy(mov.id)
    try{
      const ic = await supabase.from('conciliacion').insert({ movimiento_id:mov.id, tipo_destino:'fondo', gasto_id:fondoId, monto_aplicado:monto, origen:'manual' }).select().single()
      if(ic.error) throw ic.error
      const nuevoConc=(mov.monto_conciliado||0)+monto
      const { error:me } = await supabase.from('cartola_movimientos').update({ estado:'conciliado', monto_conciliado:nuevoConc }).eq('id',mov.id)
      if(me){ await supabase.from('conciliacion').delete().eq('id',ic.data.id); throw me }
      setConc(p=>[...p,ic.data]); setMovs(p=>p.map(x=>x.id===mov.id?{...x,estado:'conciliado',monto_conciliado:nuevoConc}:x))
    }catch(e){ appAlert('Error al vincular el fondo: '+e.message) }
    setBusy(null)
  }
  // Anti-duplicado de anticipos (espeja fondoExistente/vincularFondo): un anticipo del mismo cliente y monto SIN respaldo
  // bancario (no conciliado y no creado por este flujo) es candidato a VINCULAR en vez de duplicar (raíz del doble de Gabriela).
  const anticipoExistente = (mov, monto) => {
    const cid = mov.cliente_id; if(!cid) return null
    const conBanco = new Set(conc.filter(c=>c.tipo_destino==='anticipo'&&c.anticipo_id).map(c=>String(c.anticipo_id)))
    return (anticipos||[]).find(a=> String(a.client_id)===String(cid) && Math.abs((a.monto||0)-monto)<=TOL && (a.monto||0)>0 && !conBanco.has(String(a.id)) && !/conciliaci[oó]n/i.test(a.nota||'')) || null
  }
  // Vincula un anticipo YA existente (sin respaldo) a este movimiento del banco, sin crear otro.
  const vincularAnticipo = async(mov, anticipoId, monto) => {
    setBusy(mov.id)
    try{
      const ic = await supabase.from('conciliacion').insert({ movimiento_id:mov.id, tipo_destino:'anticipo', anticipo_id:anticipoId, monto_aplicado:monto, origen:'manual' }).select().single()
      if(ic.error) throw ic.error
      const nuevoConc=(mov.monto_conciliado||0)+monto
      const { error:me } = await supabase.from('cartola_movimientos').update({ estado:'conciliado', monto_conciliado:nuevoConc }).eq('id',mov.id)
      if(me){ await supabase.from('conciliacion').delete().eq('id',ic.data.id); throw me }
      setConc(p=>[...p,ic.data]); setMovs(p=>p.map(x=>x.id===mov.id?{...x,estado:'conciliado',monto_conciliado:nuevoConc}:x)); setPickFor(null)
    }catch(e){ appAlert('Error al vincular el anticipo: '+e.message) }
    setBusy(null)
  }
  // Fase 3.A — Provisión → fondo: acredita el abono al fondo del cliente (crea expenses type='fondo'), enlazado y reversible.
  const crearFondoProvision = async(mov)=>{
    if(busy) return
    if(!mov.cliente_id){ appAlert('Identifica el cliente antes de acreditar el fondo.'); return }
    // El fondo se acredita por el RESTO no aplicado (monto − lo ya conciliado a facturas/otros), no por el total
    // de la transferencia. Si no, una transferencia "factura + fondo" se contaría doble.
    const resto = (mov.monto||0) - (mov.monto_conciliado||0)
    if(resto<=0){ appAlert('Esta transferencia ya está totalmente conciliada.'); return }
    // #4: si ya existe un fondo igual sin respaldo, ofrecer vincular ese (no duplicar).
    const ex = fondoExistente(mov, resto)
    if(ex && await appConfirm(`Este cliente ya tiene un fondo de ${fmtM(ex.amount||0)}${ex.date?' del '+fmtFechaDMY(ex.date):''} cargado a mano (sin respaldo bancario).\n\nAceptar = VINCULAR ese fondo a esta transferencia (no duplica).\nCancelar = crear uno NUEVO.`)){
      await vincularFondo(mov, ex.id, resto); return
    }
    setBusy(mov.id)
    let fondo=null, cr=null
    try{
      const ins = await supabase.from('expenses').insert({ client_id:mov.cliente_id, ...proyectoSeguro(mov.cliente_id, sales), type:'fondo', amount:resto, date:mov.fecha, concept:'Provisión de fondos (conciliación bancaria)', category:'Fondo', created_by:user?.email||null }).select().single()
      if(ins.error) throw ins.error
      fondo=ins.data
      const ic = await supabase.from('conciliacion').insert({ movimiento_id:mov.id, tipo_destino:'fondo', gasto_id:fondo.id, monto_aplicado:resto, origen:'manual' }).select().single()
      if(ic.error) throw ic.error
      cr=ic.data
      const nuevoConciliado = (mov.monto_conciliado||0) + resto
      const { error:me } = await supabase.from('cartola_movimientos').update({ estado:'conciliado', monto_conciliado:nuevoConciliado }).eq('id',mov.id)
      if(me) throw me
      setExpenses&&setExpenses(p=>[fondo,...p]); setConc(p=>[...p,cr]); setMovs(p=>p.map(x=>x.id===mov.id?{...x,estado:'conciliado',monto_conciliado:nuevoConciliado}:x))
    }catch(e){ if(cr) await supabase.from('conciliacion').delete().eq('id',cr.id); if(fondo) await supabase.from('expenses').delete().eq('id',fondo.id); appAlert('Error al crear fondo: '+e.message) }
    setBusy(null)
  }
  // Fondo por rendir DEL EQUIPO: un tercero (no cliente) transfiere para cubrir gastos personal_de una persona del equipo.
  // Crea un fondo (type='fondo', personal_de, client_id null) que baja los gastos personales de esa persona, y guarda de quién vino (del banco).
  const crearFondoPersonal = async(mov, persona)=>{
    if(busy) return
    if(!persona){ appAlert('Elige a quién del equipo.'); return }
    const resto = (mov.monto||0) - (mov.monto_conciliado||0)
    if(resto<=0){ appAlert('Esta transferencia ya está totalmente conciliada.'); return }
    const tercero = (mov.nombre_contraparte||'').trim() || (mov.rut_contraparte?`RUT ${mov.rut_contraparte}`:'') || 'un tercero'
    if(!await appConfirm(`Crear fondo por rendir de ${fmtM(resto)} para ${persona} (de ${tercero}).\nBajará los gastos personales de ${persona}. Reversible.`)) return
    setBusy(mov.id)
    let fondo=null, cr=null
    try{
      const ins = await supabase.from('expenses').insert({ personal_de:persona, client_id:null, type:'fondo', amount:resto, date:mov.fecha, concept:`Fondo por rendir · de ${tercero} · para ${persona}`.slice(0,200), category:'Fondo', created_by:user?.email||null }).select().single()
      if(ins.error) throw ins.error; fondo=ins.data
      const ic = await supabase.from('conciliacion').insert({ movimiento_id:mov.id, tipo_destino:'fondo', gasto_id:fondo.id, monto_aplicado:resto, origen:'manual' }).select().single()
      if(ic.error) throw ic.error; cr=ic.data
      const nuevoConciliado = (mov.monto_conciliado||0) + resto
      const { error:me } = await supabase.from('cartola_movimientos').update({ estado:'conciliado', monto_conciliado:nuevoConciliado }).eq('id',mov.id)
      if(me) throw me
      setExpenses&&setExpenses(p=>[fondo,...p]); setConc(p=>[...p,cr]); setMovs(p=>p.map(x=>x.id===mov.id?{...x,estado:'conciliado',monto_conciliado:nuevoConciliado}:x))
      logActividad('banco.fondo_equipo',{tabla:'cartola_movimientos',id:mov.id,detalle:{persona,title:mov.nombre_contraparte||null,monto:mov.monto}})
    }catch(e){ if(cr) await supabase.from('conciliacion').delete().eq('id',cr.id); if(fondo) await supabase.from('expenses').delete().eq('id',fondo.id); appAlert('Error al crear fondo del equipo: '+e.message) }
    setBusy(null)
  }
  // Fase 3.D — Cargo por cuenta de un cliente: la oficina pagó a un tercero (Notaría/CBR/proveedor) por un asunto del
  // cliente. Crea un gasto (expenses type='gasto', client_id+entity_id) que DESCUENTA su fondo, enlazado y reversible.
  // Aprende glosa→cliente para no volver a preguntar. NO usa el RUT del beneficiario (un tercero sirve a varios clientes).
  const gastoPorCuentaCliente = async(mov, clientId, entityId, concept, category)=>{
    if(busy) return
    if(!clientId){ appAlert('Elige el cliente antes de registrar el gasto.'); return }
    setBusy(mov.id)
    let gasto=null, cr=null
    try{
      const monto=(mov.monto||0)-(mov.monto_conciliado||0)
      const ins = await supabase.from('expenses').insert({ client_id:clientId, entity_id:entityId||null, ...proyectoSeguro(clientId, sales), type:'gasto', amount:monto, date:mov.fecha, concept:(concept||'Gasto por cuenta del cliente').slice(0,200), category:category||'Notaría', created_by:user?.email||null, paid_by_client:false }).select().single()
      if(ins.error) throw ins.error; gasto=ins.data
      const ic = await supabase.from('conciliacion').insert({ movimiento_id:mov.id, tipo_destino:'gasto', gasto_id:gasto.id, monto_aplicado:monto, origen:'manual' }).select().single()
      if(ic.error) throw ic.error; cr=ic.data; marcaQuien(cr.id)
      const movAplic=(mov.monto_conciliado||0)+monto
      const estado=((mov.monto||0)-movAplic)<=TOL?'conciliado':'parcial'
      const { error:me } = await supabase.from('cartola_movimientos').update({ estado, monto_conciliado:movAplic, cliente_id:clientId }).eq('id',mov.id)
      if(me) throw me
      setExpenses&&setExpenses(p=>[gasto,...p]); setConc(p=>[...p,cr]); setMovs(p=>p.map(x=>x.id===mov.id?{...x,estado,monto_conciliado:movAplic,cliente_id:clientId}:x))
      const gk=glosaKey(mov.descripcion); if(gk){ learnPut('cargo_cliente',gk,clientId,{category:category||null}); setCargoCliLearn(p=>({...p,[gk]:String(clientId)})) }
      setGcFor(null); setGcCli(null); setGcEnt(null)
    }catch(e){ if(cr) await supabase.from('conciliacion').delete().eq('id',cr.id); if(gasto) await supabase.from('expenses').delete().eq('id',gasto.id); appAlert('Error al registrar el gasto: '+e.message) }
    setBusy(null)
  }
  // Pieza 3 — cliente interno (Oficina) y catálogo de categorías que aprende (mismo criterio que ExpensesView).
  const ofiCli = clients.find(c=>c.is_internal || /liberona\s+escala/i.test(c.name||''))
  const catsOficinaConc = useMemo(()=>{ const s=new Set(CATS_OFICINA_NUEVAS); if(ofiCli){ (expenses||[]).forEach(e=>{ if(String(e.client_id)===String(ofiCli.id)&&e.category&&!CATS_LEGALES.includes(String(e.category).trim().toLowerCase())) s.add(catOficinaNueva(e.category)) }) } return [...s] },[expenses,ofiCli])
  // Costo de OFICINA: el cargo es un gasto operativo de la firma → crea un gasto en el cliente interno con su categoría y concilia (reversible con Deshacer).
  // Un pago a proveedor vive en UN solo lugar: como comisión de su venta (terceros_pagos, rebaja el ingreso) o como gasto.
  // Registrarlo en ambos lo cuenta dos veces (pasó con MJ, BDA, Pedro Isla y Menchaca).
  const yaEsComision = m => (terc||[]).some(t=>String(t.movimiento_id)===String(m.id)) || (conc||[]).some(c=>String(c.movimiento_id)===String(m.id)&&c.tipo_destino==='tercero')
  // Pago de la tarjeta con viajes de Uber Business ya unidos (los registra el agente, uno por recibo): repartir el resto otra vez
  // como «Movilización › Uber» contaría ese Uber dos veces.
  const uberYaUnido = mov => conc.some(c=>String(c.movimiento_id)===String(mov.id)&&c.tipo_destino==='gasto'&&(expenses||[]).find(e=>String(e.id)===String(c.gasto_id))?.created_by==='Uber Business')
  const avisoUberDoble = async (mov, lineas) => { if(!uberYaUnido(mov)||!lineas.some(l=>l.categoria==='Movilización'&&/uber/i.test(l.sub||''))) return true
    return await appConfirm('Este pago de la tarjeta ya tiene unidos los viajes de Uber Business (registrados uno a uno desde sus recibos). Si agregas «Movilización › Uber» se contaría dos veces. ¿Registrar igual?') }
  const guardaComision = (mov, category) => {
    if(yaEsComision(mov)){ appAlert('Este cargo ya está registrado como pago de comisión a un proveedor (rebaja el ingreso de su venta). No se registra además como gasto de oficina.'); return false }
    const prov = ['Proveedores','Comisiones'].includes(category) ? provDeCargo(mov) : null
    if(prov && comisPorPagar(prov.id).length){ appAlert(`${prov.nombre||prov.razon_social} tiene comisiones por pagar. Registra este cargo con "Pagar comisiones" para que rebaje el ingreso de su venta y no quede duplicado como gasto de oficina.`); return false }
    return true
  }
  const costoOficina = async(mov, category, subcategory=null)=>{
    if(busy) return
    if(!ofiCli){ appAlert('No se encontró el cliente interno (Oficina).'); return }
    if(!category){ appAlert('Elige la categoría del costo de oficina.'); return }
    if(!guardaComision(mov, category)) return
    if(!(await avisoUberDoble(mov,[{categoria:category,sub:subcategory}]))) return
    setBusy(mov.id)
    let gasto=null, cr=null
    try{
      const monto=(mov.monto||0)-(mov.monto_conciliado||0)
      const ins = await supabase.from('expenses').insert({ client_id:ofiCli.id, type:'gasto', amount:monto, date:mov.fecha, concept:(mov.descripcion||'Costo de oficina').slice(0,200), category, subcategory:subcategory||null, created_by:user?.email||null, paid_by_client:false }).select().single()
      if(ins.error) throw ins.error; gasto=ins.data
      const ic = await supabase.from('conciliacion').insert({ movimiento_id:mov.id, tipo_destino:'gasto', gasto_id:gasto.id, monto_aplicado:monto, origen:'manual' }).select().single()
      if(ic.error) throw ic.error; cr=ic.data; marcaQuien(cr.id)
      const movAplic=(mov.monto_conciliado||0)+monto
      const estado=((mov.monto||0)-movAplic)<=TOL?'conciliado':'parcial'
      const { error:me } = await supabase.from('cartola_movimientos').update({ estado, monto_conciliado:movAplic, categoria:'Gastos Oficina' }).eq('id',mov.id)
      if(me) throw me
      setExpenses&&setExpenses(p=>[gasto,...p]); setConc(p=>[...p,cr]); setMovs(p=>p.map(x=>x.id===mov.id?{...x,estado,monto_conciliado:movAplic,categoria:'Gastos Oficina'}:x))
      const gko=glosaKey(mov.descripcion); if(gko&&category){ learnPut('costo_oficina',gko,category,{subcategory:subcategory||null}); setCostoOfiLearn(p=>({...p,[gko]:{category,subcategory:subcategory||null}})) }   // aprende: el mismo cargo (arriendo/sueldos) el próximo mes se auto-sugiere
      setOfiFor(null)
    }catch(e){ if(cr) await supabase.from('conciliacion').delete().eq('id',cr.id); if(gasto) await supabase.from('expenses').delete().eq('id',gasto.id); appAlert('Error al registrar el costo de oficina: '+e.message) }
    setBusy(null)
  }
  // Cargo AGRUPADO: reparte un cargo único en varias líneas de costo de oficina (N gastos + N conciliaciones parciales). El total repartido = el cargo.
  const costoOficinaSplit = async(mov, items)=>{
    if(busy) return
    if(!ofiCli){ appAlert('No se encontró el cliente interno (Oficina).'); return }
    if(!items?.length) return
    if(!guardaComision(mov, null)) return
    if(!(await avisoUberDoble(mov,items.map(i=>({categoria:i.categoria,sub:i.item}))))) return
    if(!await appConfirm(`Repartir este cargo (${fmtM(mov.monto)}) en ${items.length} costos de oficina?\n\n${items.map(i=>`· ${i.item} · ${fmtM(i.monto)}`).join('\n')}`)) return
    setBusy(mov.id)
    const creados=[]
    try{
      let aplicadoTot=0
      for(const it of items){
        const ins=await supabase.from('expenses').insert({ client_id:ofiCli.id, type:'gasto', amount:it.monto, date:mov.fecha, concept:(it.item||mov.descripcion||'Costo de oficina').slice(0,200), category:it.categoria, subcategory:it.item, created_by:user?.email||null, paid_by_client:false }).select().single()
        if(ins.error) throw ins.error
        const ic=await supabase.from('conciliacion').insert({ movimiento_id:mov.id, tipo_destino:'gasto', gasto_id:ins.data.id, monto_aplicado:it.monto, origen:'manual' }).select().single()
        if(ic.error) throw ic.error; marcaQuien(ic.data.id)
        creados.push({gasto:ins.data.id,conc:ic.data.id})
        setExpenses&&setExpenses(p=>[ins.data,...p]); setConc(p=>[...p,ic.data]); aplicadoTot+=it.monto
      }
      const movAplic=(mov.monto_conciliado||0)+aplicadoTot
      const estado=((mov.monto||0)-movAplic)<=TOL?'conciliado':'parcial'
      const { error:me } = await supabase.from('cartola_movimientos').update({ estado, monto_conciliado:movAplic, categoria:'Gastos Oficina' }).eq('id',mov.id); if(me) throw me
      setMovs(p=>p.map(x=>x.id===mov.id?{...x,estado,monto_conciliado:movAplic,categoria:'Gastos Oficina'}:x)); setOfiFor&&setOfiFor(null)
    }catch(e){ for(const c of creados){ try{ await supabase.from('conciliacion').delete().eq('id',c.conc); await supabase.from('expenses').delete().eq('id',c.gasto) }catch(_){} } appAlert('No se pudo repartir: '+(e.message||e)) }
    setBusy(null)
  }
  // INGRESO de OFICINA: un abono que es ingreso de la firma (no de un cliente) — comisión recibida, subarriendo, reembolso, otros.
  // Guarda una fila en ingresos_oficina (libro de ingresos reales; no ensucia gastos ni el presupuesto), concilia el
  // movimiento (tipo_destino='ingreso') y lo marca 'Ingresos Oficina'. Comisión Recibida se puede asignar a un proveedor/tercero.
  // Reversible: Deshacer borra la fila + la conciliación (ver el caso 'ingreso' en deshacer).
  // ── Comisión por facturar: depósito de quien nos paga comisiones, aún sin factura. Queda como cobro de comisión SIN folio
  // (billing_type 'comision', estado Anticipada, pagado en la fecha del depósito) conciliado a ese depósito. Cuando llega la factura
  // del SII por el mismo monto (≤60 días), el cruce de cuotas sin folio (matchProgramada → registrarProg) le pone el folio y queda
  // Pagada: la comisión se cuenta una sola vez (caja = el depósito; facturado = recién con folio).
  const cliPagadorCom = m => { if(m.cliente_id) return String(m.cliente_id); const rk=crNormRut(m.rut_contraparte||''); if(!rk) return null
    const c=(clients||[]).find(x=>crNormRut(x.rut||'')===rk) || (()=>{ const en=(clientEntities||[]).find(e=>crNormRut(e.rut||'')===rk); return en?(clients||[]).find(x=>String(x.id)===String(en.client_id)):null })(); return c?String(c.id):null }
  const pagaComisiones = cid => !!cid && (billing||[]).some(b=>!b.deleted_at&&b.billing_type==='comision'&&String(b.client_id)===String(cid))
  // Calce automático solo si es inequívoco: paga comisiones, no tiene comisiones facturadas abiertas (el depósito podría pagarlas) y el
  // monto es menor que su cuota de subarriendo (BDA también nos arrienda: un arriendo nunca se toma por comisión).
  const comisionAutoOk = (m, cid) => { if(!pagaComisiones(cid)) return false
    if(devolucionCands(m,(m.monto||0)-(m.monto_conciliado||0)).length) return false   // puede ser la devolución de un pago nuestro: lo decide una persona
    const bs=(billing||[]).filter(b=>!b.deleted_at&&b.status!=='Anulada'&&String(b.client_id)===String(cid))
    if(bs.some(b=>b.billing_type==='comision'&&['Pendiente','Vencido'].includes(b.status)&&saldoFactura(b)>TOL)) return false
    if(bs.some(b=>esFacIngreso(b)&&['Pendiente','Vencido'].includes(b.status)&&Math.abs(saldoFactura(b)-(Number(m.monto)||0))<=TOL)) return false   // calza con una factura abierta: va a conciliar
    const sub=bs.filter(b=>b.billing_type==='subarriendo').map(b=>Number(b.amount)||0).filter(x=>x>0)
    return !sub.length || (Number(m.monto)||0) < Math.min(...sub) }
  // Devolución de un pago nuestro: un abono (o parte) que devuelve un cargo anterior al mismo RUT (pago doble, pago de más).
  // Cada movimiento queda conciliado contra el otro (tipo 'devolucion'): el saldo del banco sube, pero no es cobrado, ingreso, gasto ni comisión.
  const devolucionCands = (m, resto) => { if(m?.tipo!=='abono'||!(resto>TOL)) return []; const r=crNormRut(m.rut_contraparte); if(!r) return []
    return (movs||[]).filter(c=>c.tipo==='cargo'&&!c.es_interno&&crNormRut(c.rut_contraparte)===r&&String(c.fecha||'')<=String(m.fecha||'')
      &&((c.monto||0)-(c.monto_conciliado||0))>TOL&&((c.monto||0)-(c.monto_conciliado||0))<=resto+TOL).sort((a,b)=>String(b.fecha||'').localeCompare(String(a.fecha||''))).slice(0,3) }
  const registrarDevolucion = async(abono, cargo) => { if(busy) return
    const monto=Math.min((abono.monto||0)-(abono.monto_conciliado||0),(cargo.monto||0)-(cargo.monto_conciliado||0)); if(monto<=TOL) return
    if(!await appConfirm(`¿Registrar ${fmtN(monto)} de este abono como la devolución del cargo del ${fmtFechaDMY(cargo.fecha)}?\n\nEl saldo del banco sube con esa plata, pero no cuenta como cobrado, ingreso ni gasto.`)) return
    setBusy(abono.id)
    try{ let ca, cc
      if(DEMO){ ca={id:'demo-dva-'+abono.id,movimiento_id:abono.id,tipo_destino:'devolucion',devuelve_mov_id:cargo.id,monto_aplicado:monto,origen:'manual'}; cc={id:'demo-dvc-'+cargo.id,movimiento_id:cargo.id,tipo_destino:'devolucion',devuelve_mov_id:abono.id,monto_aplicado:monto,origen:'manual'} }
      else {
        const a=await supabase.from('conciliacion').insert({movimiento_id:abono.id,tipo_destino:'devolucion',devuelve_mov_id:cargo.id,monto_aplicado:monto,origen:'manual'}).select().single(); if(a.error) throw a.error; ca=a.data
        const b=await supabase.from('conciliacion').insert({movimiento_id:cargo.id,tipo_destino:'devolucion',devuelve_mov_id:abono.id,monto_aplicado:monto,origen:'manual'}).select().single(); if(b.error){ await supabase.from('conciliacion').delete().eq('id',ca.id); throw b.error } cc=b.data
        marcaQuien(ca.id); marcaQuien(cc.id) }
      const upd=x=>{ const ap=(x.monto_conciliado||0)+monto; return {...x,monto_conciliado:ap,estado:((x.monto||0)-ap)<=TOL?'conciliado':'parcial'} }
      // Si falla un movimiento a medias, se deshace todo (las dos filas y el movimiento ya actualizado).
      if(!DEMO){ const hechos=[]
        for(const x of [abono,cargo]){ const u=upd(x); const {error}=await supabase.from('cartola_movimientos').update({estado:u.estado,monto_conciliado:u.monto_conciliado}).eq('id',x.id)
          if(error){ for(const h of hechos) await supabase.from('cartola_movimientos').update({estado:h.estado,monto_conciliado:h.monto_conciliado||0}).eq('id',h.id); await supabase.from('conciliacion').delete().in('id',[ca.id,cc.id]); throw error }
          hechos.push(x) } }
      setConc(p=>[...p,ca,cc]); setMovs(p=>p.map(x=>x.id===abono.id||x.id===cargo.id?upd(x):x))
      logActividad('banco.devolucion',{tabla:'cartola_movimientos',id:abono.id,detalle:{title:`Devolución del cargo del ${fmtFechaDMY(cargo.fecha)}`,name:abono.nombre_contraparte||null,monto,abono:abono.id,cargo:cargo.id},completo:true})
    }catch(e){ appAlert('No se pudo registrar la devolución: '+(e.message||e)) }
    setBusy(null) }
  const comisionPorFacturar = async(mov, {clientId, socio=null, origen=null, auto=false}={})=>{
    if(!auto&&busy) return false
    if(!clientId){ appAlert('Falta quién paga la comisión (el cliente del depósito).'); return false }
    const monto=(mov.monto||0)-(mov.monto_conciliado||0); if(monto<=TOL) return false
    // Nunca dos veces por el mismo depósito: ni una comisión ya ligada a este movimiento, ni una conciliación ya guardada en la base.
    if((billing||[]).some(b=>!b.deleted_at&&b.billing_type==='comision'&&String(b.notes||'').includes(`[mov:${mov.id}]`))) return false
    if(!DEMO){ const {count}=await supabase.from('conciliacion').select('id',{count:'exact',head:true}).eq('movimiento_id',mov.id); if(count>0) return false }
    if(!auto) setBusy(mov.id)
    try{
      const row={client_id:clientId, billing_type:'comision', status:'Anticipada', paid:true, paid_at:mov.fecha, due:mov.fecha, amount:monto, payment_method:'Transferencia',
        concept:'Comisión por facturar'+(origen?` · ${origen}`:''), comision_origen:origen||null, notes:`Depósito del ${fmtFechaDMY(mov.fecha)} sin factura: se le pone el folio cuando llegue la factura del SII por el mismo monto. [mov:${mov.id}]`}
      let fac=null, cr=null
      if(DEMO){ fac={...row,id:'demo-com-'+mov.id}; cr={id:'demo-cc-'+mov.id,movimiento_id:mov.id,tipo_destino:'factura',factura_id:fac.id,monto_aplicado:monto,origen:auto?'auto':'manual'} }
      else {
        const ins=await supabase.from('billing').insert(row).select().single(); if(ins.error) throw ins.error; fac=ins.data
        const ic=await supabase.from('conciliacion').insert({movimiento_id:mov.id, tipo_destino:'factura', factura_id:fac.id, monto_aplicado:monto, origen:auto?'auto':'manual', marco_pago:true}).select().single()
        if(ic.error){ await supabase.from('billing').update({deleted_at:new Date().toISOString()}).eq('id',fac.id); throw ic.error } cr=ic.data; marcaQuien(cr.id)
        const movAplic=(mov.monto_conciliado||0)+monto, estado=((mov.monto||0)-movAplic)<=TOL?'conciliado':'parcial'
        const {error:me}=await supabase.from('cartola_movimientos').update({estado, monto_conciliado:movAplic, cliente_id:mov.cliente_id||clientId}).eq('id',mov.id)
        if(me){ await supabase.from('conciliacion').delete().eq('id',cr.id); await supabase.from('billing').update({deleted_at:new Date().toISOString()}).eq('id',fac.id); throw me }   // nada a medias
        if(socio) await setLearningKV('socio_factura',fac.id,socio)
      }
      const movAplic=(mov.monto_conciliado||0)+monto, estado=((mov.monto||0)-movAplic)<=TOL?'conciliado':'parcial'
      setBilling&&setBilling(p=>[...(p||[]),fac]); setConc(p=>[...p,cr]); setMovs(p=>p.map(x=>x.id===mov.id?{...x,estado,monto_conciliado:movAplic,cliente_id:x.cliente_id||clientId}:x))
      logActividad('banco.comision_por_facturar',{tabla:'billing',id:fac.id,detalle:{title:auto?'Comisión por facturar (automática)':'Comisión por facturar',name:mov.nombre_contraparte||null,monto,socio,origen,movimiento:mov.id}})
      if(!auto){ setIngFor(null); setIngComFor(null); setIngProvQ(''); setAbFam(p=>({...p,[mov.id]:undefined})); setModalMov(null) }
      return true
    }catch(e){ if(!auto) appAlert('No se pudo registrar la comisión por facturar: '+(e.message||e)); return false }
    finally{ if(!auto) setBusy(null) }
  }
  const ingresoOficina = async(mov, sub, proveedorId=null)=>{
    if(busy) return
    if(!sub){ appAlert('Elige el tipo de ingreso de oficina.'); return }
    if(DEMO){ const monto=(mov.monto||0)-(mov.monto_conciliado||0); const movAplic=(mov.monto_conciliado||0)+monto; const estado=((mov.monto||0)-movAplic)<=TOL?'conciliado':'parcial'; setConc(p=>[...p,{id:'demo-ing-'+mov.id,movimiento_id:mov.id,tipo_destino:'ingreso',monto_aplicado:monto,origen:'manual'}]); setMovs(p=>p.map(x=>x.id===mov.id?{...x,estado,monto_conciliado:movAplic,categoria:'Ingresos Oficina'}:x)); setIngFor(null); setIngComFor(null); setIngProvQ(''); setAbFam(p=>({...p,[mov.id]:undefined})); setModalMov(null); return }
    setBusy(mov.id)
    let ing=null, cr=null
    try{
      const monto=(mov.monto||0)-(mov.monto_conciliado||0)
      const prov=proveedorId?(proveedores||[]).find(p=>String(p.id)===String(proveedorId)):null
      const nota=[mov.descripcion, prov?`asignada a ${prov.razon_social||prov.nombre}`:null].filter(Boolean).join(' · ').slice(0,200)
      const insI = await supabase.from('ingresos_oficina').insert({ movimiento_id:mov.id, categoria:'Ingreso de Oficina', subcategoria:sub, monto, fecha:mov.fecha, proveedor_id:proveedorId||null, nota, created_by:user?.email||null }).select().single()
      if(insI.error) throw insI.error; ing=insI.data
      const ic = await supabase.from('conciliacion').insert({ movimiento_id:mov.id, tipo_destino:'ingreso', monto_aplicado:monto, origen:'manual' }).select().single()
      if(ic.error) throw ic.error; cr=ic.data; marcaQuien(cr.id)
      const movAplic=(mov.monto_conciliado||0)+monto
      const estado=((mov.monto||0)-movAplic)<=TOL?'conciliado':'parcial'
      const { error:me } = await supabase.from('cartola_movimientos').update({ estado, monto_conciliado:movAplic, categoria:'Ingresos Oficina' }).eq('id',mov.id)
      if(me) throw me
      setConc(p=>[...p,cr]); setMovs(p=>p.map(x=>x.id===mov.id?{...x,estado,monto_conciliado:movAplic,categoria:'Ingresos Oficina'}:x))
      logActividad('banco.ingreso_oficina',{tabla:'cartola_movimientos',id:mov.id,detalle:{title:sub,name:mov.nombre_contraparte||null,monto:mov.monto}})
      setIngFor(null); setIngComFor(null); setIngProvQ(''); setAbFam(p=>({...p,[mov.id]:undefined})); setModalMov(null)
    }catch(e){ if(cr) await supabase.from('conciliacion').delete().eq('id',cr.id); if(ing) await supabase.from('ingresos_oficina').delete().eq('id',ing.id); appAlert('Error al registrar el ingreso de oficina: '+e.message) }
    setBusy(null)
  }
  // SUBARRIENDO: el pago del arriendo se aplica a la VENTA de subarriendo (fuente única de SubarriendoView), nunca como
  // "ingreso de oficina" suelto (bug 06-10-2026: el pago de octubre quedó ahí y su cuota siguió "por venir", contándose dos veces).
  // 1) Factura de subarriendo emitida con saldo ≈ monto → se imputa a ella.
  // 2) Si no hay factura: pago sin factura = anticipo de la venta que CUBRE la cuota programada del mes (Anticipada) → sale de lo por venir.
  // Sin venta de subarriendo → cae al ingreso de oficina de siempre.
  const cobroSubarriendo = async(mov)=>{
    if(busy) return
    const subSales=(sales||[]).filter(s=>esSubarriendo(s)&&!s.deleted_at)
    const sale=subSales.find(s=>mov.cliente_id&&String(s.client_id)===String(mov.cliente_id)) || (subSales.length===1?subSales[0]:null)
    if(!sale) return ingresoOficina(mov,'Subarrendamiento',null)
    const monto=(mov.monto||0)-(mov.monto_conciliado||0); if(monto<=0) return
    const deVenta=(billing||[]).filter(b=>!b.deleted_at&&String(b.sale_id)===String(sale.id))
    const fac=deVenta.filter(b=>b.invoice_no&&['Pendiente','Vencido'].includes(b.status)&&Math.abs(saldoFactura(b)-monto)<=TOL).sort((a,b)=>String(a.issued_at||'').localeCompare(String(b.issued_at||'')))[0]
    if(fac) return reconciliar({...mov,cliente_id:mov.cliente_id||sale.client_id},fac,'manual')
    const ym=String(mov.fecha||'').slice(0,7)
    const progs=deVenta.filter(b=>b.status==='Programada'&&!b.invoice_no&&Math.abs((Number(b.amount)||0)-monto)<=TOL)
    // La cuota del mes del pago (por el período del concepto); si no hay, la programada más antigua.
    const cuota=progs.find(b=>concPeriodoOf(b.concept)===ym) || progs.sort((a,b)=>String(a.due||'').localeCompare(String(b.due||'')))[0] || null
    const mesLbl=(()=>{ const [y,m]=((cuota&&concPeriodoOf(cuota.concept))||ym).split('-'); const n=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'][(+m||1)-1]; return `${n} ${y}` })()
    setBusy(mov.id)
    let ant=null, cr=null
    try{
      const ia=await supabase.from('anticipos').insert({ client_id:sale.client_id, sale_id:sale.id, monto, fecha:mov.fecha, nota:`Subarriendo ${mesLbl} (pago sin factura, conciliación bancaria)`, estado:cuota?'consumido':'disponible', created_by:user?.email||null }).select().single()
      if(ia.error) throw ia.error; ant=ia.data
      const ic=await supabase.from('conciliacion').insert({ movimiento_id:mov.id, tipo_destino:'anticipo', anticipo_id:ant.id, monto_aplicado:monto, origen:'manual' }).select().single()
      if(ic.error) throw ic.error; cr=ic.data; marcaQuien(cr.id)
      const movAplic=(mov.monto_conciliado||0)+monto
      const estado=((mov.monto||0)-movAplic)<=TOL?'conciliado':'parcial'
      const { error:me }=await supabase.from('cartola_movimientos').update({ estado, monto_conciliado:movAplic, categoria:'Subarriendo', cliente_id:mov.cliente_id||sale.client_id }).eq('id',mov.id)
      if(me) throw me
      if(cuota){ const { error:be }=await supabase.from('billing').update({ status:'Anticipada', prepaid_anticipo_id:ant.id, updated_at:new Date().toISOString() }).eq('id',cuota.id); if(be) throw be
        setBilling&&setBilling(p=>p.map(b=>b.id===cuota.id?{...b,status:'Anticipada',prepaid_anticipo_id:ant.id}:b)) }
      setAnticipos&&setAnticipos(p=>[ant,...p]); setConc(p=>[...p,cr]); setMovs(p=>p.map(x=>x.id===mov.id?{...x,estado,monto_conciliado:movAplic,categoria:'Subarriendo',cliente_id:x.cliente_id||sale.client_id}:x))
      logActividad('banco.subarriendo',{tabla:'cartola_movimientos',id:mov.id,detalle:{title:`Subarriendo ${mesLbl}${cuota?' · cubre la cuota del mes':''}`,monto}})
      setIngFor(null); setAbFam(p=>({...p,[mov.id]:undefined})); setModalMov(null)
    }catch(e){ if(cr) await supabase.from('conciliacion').delete().eq('id',cr.id); if(ant) await supabase.from('anticipos').delete().eq('id',ant.id); appAlert('Error al registrar el subarriendo: '+(e.message||e)) }
    setBusy(null)
  }
  // Deshace TODA la conciliación de un movimiento: revierte facturas/anticipos/fondos y deja el movimiento pendiente.
  const deshacer = async(mov)=>{
    if(busy) return
    const rows = conc.filter(c=>c.movimiento_id===mov.id); if(!rows.length) return
    // Si un saldo a favor ya se consumió (anticipo aplicado a una cuota), no se puede deshacer: borrar el vínculo
    // dejaría el movimiento "por conciliar" otra vez y podría generar un segundo anticipo por la misma plata.
    const antConsumido = rows.some(r=>{ if(r.tipo_destino!=='anticipo'||!r.anticipo_id) return false; const a=(anticipos||[]).find(x=>String(x.id)===String(r.anticipo_id)); return a && a.estado!=='disponible' })
    if(antConsumido){ appAlert('No se puede deshacer: el saldo a favor ya se imputó a una cuota. Revierte primero esa imputación.'); return }
    if(!(await appConfirm('¿Deshacer lo conciliado en este movimiento? Vuelve a quedar por resolver.'))) return
    setBusy(mov.id)
    try{
      const restantes={}   // aplicado restante por factura, descontando fila a fila (varias filas a la misma factura)
      for(const r of rows){
        if(r.tipo_destino==='factura' && r.factura_id){
          const fac = billing.find(b=>b.id===r.factura_id)
          if(!(r.factura_id in restantes)) restantes[r.factura_id]=(aplicadoByFactura[r.factura_id]||0)
          restantes[r.factura_id]=Math.max(0,restantes[r.factura_id]-(r.monto_aplicado||0))
          const nuevoAplic=restantes[r.factura_id]
          // Comisión por facturar (creada desde este depósito, aún sin folio): al deshacer se da de baja; nunca queda un cobro sin depósito.
          if(fac&&fac.billing_type==='comision'&&!fac.invoice_no&&fac.status==='Anticipada'){ const now=new Date().toISOString()
            const {error:de}=await supabase.from('billing').update({deleted_at:now,updated_at:now}).eq('id',fac.id); if(de) throw de
            setBilling&&setBilling(p=>p.filter(b=>b.id!==fac.id)) }
          else if(fac){ const now=new Date().toISOString()
            let patch
            if(r.marco_pago){
              // esta fila fue la que marcó la factura como pagada → revertir a Pendiente
              patch = nuevoAplic<=0
                ? { status: fac.status==='Anulada'?'Anulada':'Pendiente', paid:false, paid_at:null, payment_method:null, payment_ref:null, paid_amount:null, reconciled_at:null, updated_at:now }
                : { paid_amount:nuevoAplic, updated_at:now }
            } else if(fac.status==='Pagado'){
              // era una factura ya pagada que solo enlazamos: quita el enlace, NO la des-pagues
              patch = { reconciled_at:null, updated_at:now }
            } else {
              // pago parcial que no marcó pagada: ajusta lo aplicado (o limpia si ya no queda)
              patch = nuevoAplic<=0 ? { paid_amount:null, payment_method:null, payment_ref:null, reconciled_at:null, updated_at:now } : { paid_amount:nuevoAplic, updated_at:now }
            }
            const { error } = await supabase.from('billing').update(patch).eq('id',fac.id); if(error) throw error
            setBilling&&setBilling(p=>p.map(b=>b.id===fac.id?{...b,...patch}:b)) }
        } else if(r.tipo_destino==='anticipo' && r.anticipo_id){
          const { error:ae } = await supabase.from('anticipos').delete().eq('id',r.anticipo_id); if(ae) throw ae
          setAnticipos&&setAnticipos(p=>p.filter(a=>String(a.id)!==String(r.anticipo_id)))
        } else if((r.tipo_destino==='fondo'||r.tipo_destino==='gasto') && r.gasto_id){
          // 'gasto' (3.D) y los 'fondo' CREADOS por conciliación se borran. Un fondo VINCULADO (manual preexistente, #4) solo se desenlaza.
          const exp=(expenses||[]).find(x=>String(x.id)===String(r.gasto_id))
          const creadoAqui = r.tipo_destino==='gasto' || (exp && /conciliaci[oó]n/i.test(exp.concept||''))
          // 3.B: si el fondo se borra, los gastos ligados a él (reembolsados o asignados a ese fondo) quedan libres (reembolso_fondo_id → null).
          // Si solo se desenlaza del banco, el fondo sigue existiendo y sus gastos siguen ligados.
          const marcados=creadoAqui?(expenses||[]).filter(x=>String(x.reembolso_fondo_id)===String(r.gasto_id)).map(x=>x.id):[]
          if(marcados.length){ await supabase.from('expenses').update({reembolso_fondo_id:null}).eq('reembolso_fondo_id',r.gasto_id)
            setExpenses&&setExpenses(p=>p.map(x=>marcados.includes(x.id)?{...x,reembolso_fondo_id:null}:x)) }
          if(creadoAqui){ const { error:fe } = await supabase.from('expenses').delete().eq('id',r.gasto_id); if(fe) throw fe
            setExpenses&&setExpenses(p=>p.filter(x=>String(x.id)!==String(r.gasto_id))) }
        } else if(r.tipo_destino==='devolucion'&&r.devuelve_mov_id){
          // Devolución: se suelta también el tramo del otro movimiento (el cargo devuelto o el abono que lo devolvió).
          const {error:pe}=await supabase.from('conciliacion').delete().eq('movimiento_id',r.devuelve_mov_id).eq('devuelve_mov_id',mov.id).eq('tipo_destino','devolucion'); if(pe) throw pe
          const otro=(movs||[]).find(x=>String(x.id)===String(r.devuelve_mov_id))
          if(otro){ const ap=Math.max(0,(otro.monto_conciliado||0)-(Number(r.monto_aplicado)||0)), est=ap<=TOL?'pendiente':((otro.monto||0)-ap)<=TOL?'conciliado':'parcial'
            const {error:oe}=await supabase.from('cartola_movimientos').update({estado:est,monto_conciliado:ap}).eq('id',otro.id); if(oe) throw oe
            setMovs(p=>p.map(x=>x.id===otro.id?{...x,estado:est,monto_conciliado:ap}:x)) }
          setConc(p=>p.filter(c=>!(String(c.movimiento_id)===String(r.devuelve_mov_id)&&String(c.devuelve_mov_id)===String(mov.id)&&c.tipo_destino==='devolucion')))
        } else if(r.tipo_destino==='ingreso'){
          // Ingreso de oficina: borra la fila del libro de ingresos (enlazada por movimiento_id).
          const { error:ie } = await supabase.from('ingresos_oficina').delete().eq('movimiento_id',mov.id); if(ie) throw ie
        }
        const { error:de } = await supabase.from('conciliacion').delete().eq('id',r.id); if(de) throw de
      }
      const { error:me } = await supabase.from('cartola_movimientos').update({ estado:'pendiente', monto_conciliado:0 }).eq('id',mov.id); if(me) throw me
      setConc(p=>p.filter(c=>c.movimiento_id!==mov.id)); setMovs(p=>p.map(x=>x.id===mov.id?{...x,estado:'pendiente',monto_conciliado:0}:x))
      logActividad('banco.deshecho',{tabla:'cartola_movimientos',id:mov.id,detalle:{folio:(billing.find(b=>rows.some(r=>r.factura_id===b.id))||{}).invoice_no||null,name:cmap[mov.cliente_id]||mov.nombre_contraparte||null,monto:mov.monto}})
    }catch(e){ appAlert('Error al deshacer: '+e.message) }
    setBusy(null)
  }
  // ===== Clasificador de CARGOS (combo 2 familias → categoría → subcategoría, con aprendizaje) =====
  const CARGO_OFI_GRUPOS = [
    ['Personas',['Sueldos','Retiros','Caja chica']],
    ['Servicios externos',['Proveedores','Comisiones']],
    ['Local',['Arriendo','Gastos comunes','Servicios']],
    ['Administración',['Contadora','Software','Tarjeta de crédito','Reembolso oficina']],
  ]
  const CARGO_SUB_LABEL = { Sueldos:'persona', Retiros:'socio', 'Caja chica':'persona', Proveedores:'colaborador', Contadora:'tipo', Servicios:'tipo', Software:'tipo' }  // categorías con 3er nivel
  const cargoPersonas = cat => {
    const fromExp=[...new Set((expenses||[]).filter(e=>ofiCli&&String(e.client_id)===String(ofiCli.id)&&e.category===cat&&e.subcategory).map(e=>String(e.subcategory)))]
    let seed=[]
    if(cat==='Sueldos') seed=[...Object.values(EQUIPO_RUT),...Object.values(SOCIO_RUT)]
    else if(cat==='Retiros') seed=Object.values(SOCIO_RUT)
    else if(cat==='Proveedores') seed=(proveedores||[]).map(p=>p.nombre||p.name).filter(Boolean)
    else if(cat==='Contadora') seed=['Remuneración','PPM','Cotizaciones']
    else if(cat==='Caja chica') seed=[...(pettyCash||[]).map(p=>p.user_name).filter(Boolean),...Object.values(EQUIPO_RUT)]
    return [...new Set([...seed,...fromExp])].filter(Boolean).sort((a,b)=>a.localeCompare(b,'es'))
  }
  // Sugerencia aprendida para un cargo: RUT (persona/socio/contadora) > glosa (costo oficina) > glosa (cliente).
  const cargoSugerencia = m => {
    if(m.tipo!=='cargo'||m.es_interno) return null
    const k=crNormRut(m.rut_contraparte)
    if(k){
      if(EQUIPO_RUT[k]){ const per=EQUIPO_RUT[k]
        // El equipo (Martín/Martina) hace caja chica: la glosa NO distingue sueldo de reposición de caja (lo decide el MONTO), así que
        // NO se respeta la glosa aprendida ni se asume Sueldo. Su SUELDO = su línea de Remuneraciones del presupuesto (monto exacto) →
        // Sueldo auto; cualquier otro monto → menú [Caja chica · Sueldo · Otro] en el primer nivel (la caja chica es recurrente, a un clic).
        const abs=Math.round(Math.abs(Number(m.monto)||0))
        const ym=String(m.fecha||'').slice(0,7)||new Date().toISOString().slice(0,7)
        const effC=r=>(r.desde&&ym<String(r.desde).slice(0,7))?(r.monto_prev??r.monto):r.monto
        const esSueldo=(poolCostos||[]).some(r=>!r.es_ingreso && r.categoria==='Remuneraciones' && _normTxt(r.item).includes(_normTxt(per)) && Math.round(Number(effC(r))||0)===abs)
        return esSueldo ? {fam:'oficina',category:'Sueldos',sub:per,via:'presupuesto'} : {fam:'oficina',persona:per,via:'RUT',ambiguoCaja:true} }
      if(SOCIO_RUT[k]){
        // REGLA (usuario): los RETIROS a socios son SIEMPRE cifras enteras/redondas; los SUELDOS no (llevan cola por descuentos).
        // Un socio recibe sueldo Y retiro al mismo RUT, así que el RUT no basta: un cargo NO redondo a un socio = sueldo seguro.
        const redondo = (Math.abs(Number(m.monto)||0) % 1000) === 0
        return redondo
          ? {fam:'oficina',category:'Retiros',sub:SOCIO_RUT[k],via:'RUT'}
          : {fam:'oficina',category:'Sueldos',sub:SOCIO_RUT[k],via:'RUT',motivo:'monto no redondo'} }
      if(CONTADORA_RUT[k]) return {fam:'oficina',category:'Contadora',sub:null,via:'RUT'}
      if(provByRut[k]&&!provConComisiones(provDeCargo(m))) return {fam:'oficina',category:'Proveedores',sub:provByRut[k],via:'RUT'}   // con comisiones → pago de comisión, no gasto
    }
    const gk=glosaKey(m.descripcion)
    if(gk&&costoOfiLearn[gk]&&!costoOfiLearn[gk].ambiguo) return {fam:'oficina',category:costoOfiLearn[gk].category,sub:costoOfiLearn[gk].subcategory||null,via:'glosa'}
    if(gk&&cargoCliLearn[gk]) return {fam:'cliente',clientId:cargoCliLearn[gk],via:'glosa'}
    const bm=matchPresupuesto(m); if(bm) return bm   // cruce con el presupuesto de oficina: monto exacto (+ glosa)
    return null
  }
  // Cruce del cargo con el PRESUPUESTO de oficina: el monto del cargo calza (exacto) con una línea del presupuesto vigente ese mes → la sugiere.
  const _glosaHas = (desc,item,cat) => { const nz=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,''); const g=nz(desc); const words=(nz(item)+' '+nz(cat)).split(/[^a-z0-9]+/).filter(w=>w.length>=4); return words.some(w=>g.includes(w)) }
  const matchPresupuesto = m => {
    if(m.tipo!=='cargo'||m.es_interno||!(poolCostos||[]).length) return null
    const abs=Math.abs(Number(m.monto)||0); if(abs<=0) return null
    const ym=String(m.fecha||'').slice(0,7)||new Date().toISOString().slice(0,7)
    const eff=r=>(r.desde&&ym<String(r.desde).slice(0,7))?(r.monto_prev??r.monto):r.monto
    const exact=(poolCostos||[]).filter(r=>!r.es_ingreso && Math.round(Number(eff(r))||0)===Math.round(abs))
    if(!exact.length) return null
    const pick=exact.find(r=>_glosaHas(m.descripcion,r.item,r.categoria))||exact[0]
    return {fam:'oficina', category:pick.categoria, sub:pick.item, via:'presupuesto'}
  }
  // Cargo AGRUPADO: el monto del cargo = suma EXACTA de 2-3 líneas → propone repartirlo. Blindado contra falsos positivos:
  // (1) umbral de monto (los pagos agrupados reales son grandes; montos chicos generan combinaciones espurias);
  // (2) UNICIDAD — si más de una combinación suma el total, es ambiguo → no sugiere (no adivina);
  // (3) SEÑAL — al menos un componente debe venir del correo de Claudia o calzar con la glosa (evita sumas coincidentes del presupuesto).
  const matchGrupoPresupuesto = m => {
    if(m.tipo!=='cargo'||m.es_interno||!(poolCostos||[]).length) return null
    const abs=Math.round(Math.abs(Number(m.monto)||0)); if(abs<300000) return null
    const ym=String(m.fecha||'').slice(0,7)||new Date().toISOString().slice(0,7)
    const eff=r=>Math.round(Number((r.desde&&ym<String(r.desde).slice(0,7))?(r.monto_prev??r.monto):r.monto)||0)
    const it=(poolCostos||[]).filter(r=>!r.es_ingreso && eff(r)>0).map(r=>({categoria:r.categoria,item:r.item,monto:eff(r),src:r._src}))
    const combos=[]
    for(let i=0;i<it.length;i++) for(let j=i+1;j<it.length;j++){ if(it[i].monto+it[j].monto===abs) combos.push([it[i],it[j]]) }
    for(let i=0;i<it.length;i++) for(let j=i+1;j<it.length;j++) for(let k=j+1;k<it.length;k++){ if(it[i].monto+it[j].monto+it[k].monto===abs) combos.push([it[i],it[j],it[k]]) }
    if(combos.length!==1) return null   // 0 = no calza · >1 = ambiguo → no adivina
    const combo=combos[0]
    const conSenal = combo.some(x=> x.src==='claudia' || _glosaHas(m.descripcion,x.item,x.categoria))
    if(!conSenal) return null   // sin señal (correo/glosa) = probable coincidencia → no sugiere
    return {items:combo}
  }
  // Mes anterior con el mismo costo de oficina (categoría[+sub]) → hint "jul $X" para dar confianza.
  const cargoRachaHint = (cat,sub) => {
    const rows=(expenses||[]).filter(e=>ofiCli&&String(e.client_id)===String(ofiCli.id)&&e.category===cat&&(!sub||String(e.subcategory||'')===String(sub))&&e.date).sort((a,b)=>(b.date||'').localeCompare(a.date||''))
    if(!rows.length) return null
    return { mes:mesAbbr(rows[0].date), monto:rows[0].amount||0 }
  }
  // Gasto Cliente = SOLO CONTROL: marca cliente_id + categoría 'Cliente' en el movimiento, sin crear gasto ni tocar fondos.
  // «Gasto Cliente»: el cargo fue por cuenta de un cliente → se registra el GASTO en su ficha (consume su fondo o queda como deuda)
  // y se concilia, con el mismo camino que «Gasto por cuenta del cliente» (gastoPorCuentaCliente). Antes solo etiquetaba el cargo.
  const marcarCargoCliente = async(m, clientId) => {
    if(busy) return
    if(!clientId){ appAlert('Elige el cliente.'); return }
    const ents=(clientEntities||[]).filter(e=>String(e.client_id)===String(clientId))
    const gl=String(m.descripcion||'')
    const cat=/notar/i.test(gl)?'Notaria':/conservador|\bcbr\b/i.test(gl)?'CBR':/registro civil/i.test(gl)?'Registro Civil':'Otro'
    await gastoPorCuentaCliente(m, clientId, ents.length===1?ents[0].id:null, ('Gasto por cuenta del cliente · '+gl).slice(0,200), cat)
    try{ await supabase.from('cartola_movimientos').update({ categoria:'Cliente' }).eq('id',m.id); setMovs(p=>p.map(x=>x.id===m.id?{...x,categoria:'Cliente'}:x)) }catch(_){}
    setCcFam(p=>({...p,[m.id]:undefined})); setCcCat(p=>({...p,[m.id]:undefined})); setCcQ(p=>({...p,[m.id]:''}))
  }
  const quitarCargoCliente = async(m) => {
    if(busy) return
    setBusy(m.id)
    try{
      const { error } = await supabase.from('cartola_movimientos').update({ cliente_id:null, categoria:null }).eq('id',m.id)
      if(error) throw error
      setMovs(p=>p.map(x=>x.id===m.id?{...x,cliente_id:null,categoria:null}:x))
    }catch(e){ appAlert('Error: '+e.message) }
    setBusy(null)
  }
  // Abono a caja chica ya ingresado a mano (mismo nombre, monto exacto, aún sin vincular a un movimiento).
  const cajaChicaMatch = (persona, monto) => (pettyCash||[]).find(p => p.user_name===persona && (p.amount||0)>0 && Math.abs((p.amount||0)-monto)<=TOL && !p.movimiento_id && !String(p.notes||'').includes('mov:') && !_ccEsAjuste(p))
  // Pago a la notaría ↔ su liquidación: regla única en _shared/notariaReglas.js (la aplica también conciliacion-auto cada noche).
  const [liqsNota,setLiqsNota]=useState([]); const [rutsNota,setRutsNota]=useState(()=>new Set())
  useEffect(()=>{
    if(DEMO){ setLiqsNota((demoData.rendiciones||[]).filter(r=>r.tipo==='notaria'&&!r.anulada_at)); return }
    supabase.from('rendiciones').select('id,created_at,total,n_gastos,ot_numbers,periodo,movimiento_id,estado_envio,sent_at').eq('tipo','notaria').is('anulada_at',null).then(({data})=>setLiqsNota(data||[]),()=>{})
    supabase.from('learnings').select('key').eq('kind','notaria_rut').then(({data})=>setRutsNota(new Set((data||[]).map(x=>x.key))),()=>{})
  },[])
  const liqDeMov = m => liqsNota.find(r=>String(r.movimiento_id)===String(m.id)) || null
  const liqParaCargo = m => _liqParaCargo(m, liqsNota, rutsNota)
  const enlazarNotaria = async(m, liq) => {
    if(busy) return; setBusy(m.id)
    try{
      if(!DEMO){
        const {error:e1}=await supabase.from('rendiciones').update({movimiento_id:m.id}).eq('id',liq.id); if(e1) throw e1
        const {error:e2}=await supabase.from('cartola_movimientos').update({estado:'conciliado',monto_conciliado:m.monto,categoria:'Notaría'}).eq('id',m.id); if(e2) throw e2
        // El cargo del banco es la prueba del pago: las OT de la liquidación quedan pagadas con la fecha del cargo (si aún no lo estaban).
        const pagadoAt=String(m.fecha).slice(0,10)+'T12:00:00Z'
        const {error:e3}=await supabase.from('expenses').update({notaria_liquidado_at:pagadoAt}).eq('notaria_render_id',liq.id).is('notaria_liquidado_at',null); if(e3) throw e3
        setExpenses&&setExpenses(p=>p.map(e=>String(e.notaria_render_id)===String(liq.id)&&!e.notaria_liquidado_at?{...e,notaria_liquidado_at:pagadoAt}:e))
        if(m.rut_contraparte&&!rutsNota.has(m.rut_contraparte)) learnPut('notaria_rut', m.rut_contraparte, '1')
        logActividad('banco.notaria_enlazada',{tabla:'rendiciones',id:liq.id,detalle:{movimiento:m.id,fecha:m.fecha,pagado:m.monto,liquidacion:liq.total}})
      }
      if(m.rut_contraparte) setRutsNota(p=>new Set([...p,m.rut_contraparte]))
      setLiqsNota(p=>p.map(r=>r.id===liq.id?{...r,movimiento_id:m.id}:r)); setRendiciones&&setRendiciones(p=>p.map(r=>r.id===liq.id?{...r,movimiento_id:m.id}:r))
      setMovs(p=>p.map(x=>x.id===m.id?{...x,estado:'conciliado',monto_conciliado:m.monto,categoria:'Notaría'}:x))
    }catch(e){ appAlert('No se pudo enlazar: '+e.message) }
    setBusy(null)
  }
  const desenlazarNotaria = async(m) => {
    const liq=liqDeMov(m); if(busy) return
    // Con compuerta: se explica qué pasa con las OT antes de tocar nada; «Cancelar» deja todo igual.
    const sinAviso = liq && liq.estado_envio==='por_enviar' && !liq.sent_at
    const msgD = !liq ? '¿Quitar el enlace de este cargo del banco? El cargo queda por conciliar.'
      : sinAviso ? `¿Quitar el enlace de este cargo del banco?\n\nLa liquidación del ${fmtFechaDMY(isoLocal(liq.created_at))} no tiene aviso enviado a la notaría: sus ${liq.n_gastos||0} OT vuelven a «por pagar» y el cargo queda por conciliar.`
      : `¿Quitar el enlace de este cargo del banco?\n\nEl cargo queda por conciliar. Las ${liq.n_gastos||0} OT de la liquidación del ${fmtFechaDMY(isoLocal(liq.created_at))} siguen pagadas (el aviso a la notaría ya se envió).`
    if(!await appConfirm(msgD)) return
    setBusy(m.id)
    try{
      if(!DEMO){
        if(liq){ const {error:e1}=await supabase.from('rendiciones').update({movimiento_id:null}).eq('id',liq.id); if(e1) throw e1
          // Sin aviso enviado a la notaría, el cargo era la única prueba del pago: al quitarlo, sus OT vuelven a «por pagar».
          if(liq.estado_envio==='por_enviar'&&!liq.sent_at){ const {error:e4}=await supabase.from('expenses').update({notaria_liquidado_at:null}).eq('notaria_render_id',liq.id); if(e4) throw e4
            setExpenses&&setExpenses(p=>p.map(e=>String(e.notaria_render_id)===String(liq.id)?{...e,notaria_liquidado_at:null}:e)) } }
        const {error:e2}=await supabase.from('cartola_movimientos').update({estado:'pendiente',monto_conciliado:0,categoria:null}).eq('id',m.id); if(e2) throw e2
        logActividad('banco.notaria_desenlazada',{tabla:'rendiciones',id:liq?.id||null,detalle:{movimiento:m.id}})
      }
      if(liq){ setLiqsNota(p=>p.map(r=>r.id===liq.id?{...r,movimiento_id:null}:r)); setRendiciones&&setRendiciones(p=>p.map(r=>r.id===liq.id?{...r,movimiento_id:null}:r)) }
      setMovs(p=>p.map(x=>x.id===m.id?{...x,estado:'pendiente',monto_conciliado:0,categoria:null}:x))
    }catch(e){ appAlert('No se pudo deshacer: '+e.message) }
    setBusy(null)
  }
  // RUT ya conocido de la notaría + monto exacto y único → se enlaza solo al abrir el banco.
  useEffect(()=>{ if(busy||!liqsNota.length||!rutsNota.size) return
    const m=(movs||[]).find(x=>x.tipo==='cargo'&&x.estado==='pendiente'&&liqParaCargo(x)?.auto); if(m) enlazarNotaria(m, liqParaCargo(m).liq)
  },[movs,liqsNota,rutsNota,busy])
  const _cierraCaja = (m,movAplic,estado)=>{ setMovs(p=>p.map(x=>x.id===m.id?{...x,estado,monto_conciliado:movAplic,categoria:'Caja chica'}:x)); setCcFam(p=>({...p,[m.id]:undefined})); setCcCat(p=>({...p,[m.id]:undefined})); setCcQ(p=>({...p,[m.id]:''})) }
  // Caso común: la caja chica ya se ingresó a mano → VINCULAR (pide confirmar, no duplica). Solo crea si no hay match.
  const abonoCajaChica = async(m, persona) => {
    if(busy) return
    if(!persona){ appAlert('Elige a quién le pasaste la caja chica.'); return }
    const monto=(m.monto||0)-(m.monto_conciliado||0)
    const movAplic=(m.monto_conciliado||0)+monto
    const estado=((m.monto||0)-movAplic)<=TOL?'conciliado':'parcial'
    const match=cajaChicaMatch(persona, monto)
    if(match){
      const vincular = await appConfirm(`Ya ingresaste ${fmtM(match.amount)} a la caja chica de ${persona}${match.notes?` (${match.notes})`:''}. ¿Es este mismo movimiento? Se vincula para NO duplicar.`)
      if(vincular){
        setBusy(m.id)
        try{
          const nota=`${match.notes||''} · mov:${m.id}`.trim()
          const { error:pe } = await supabase.from('petty_cash').update({ notes:nota, movimiento_id:m.id }).eq('id',match.id); if(pe) throw pe   // enlace real 1:1 (columna, no solo el texto)
          const { error:me } = await supabase.from('cartola_movimientos').update({ estado, monto_conciliado:movAplic, categoria:'Caja chica' }).eq('id',m.id); if(me) throw me
          setPettyCash&&setPettyCash(p=>p.map(x=>x.id===match.id?{...x,notes:nota,movimiento_id:m.id}:x)); _cierraCaja(m,movAplic,estado)
        }catch(e){ appAlert('Error al vincular caja chica: '+e.message) }
        setBusy(null); return
      }
      // dijo que NO es ese abono → cae al alta de uno nuevo
    }
    setBusy(m.id)
    let pc=null
    try{
      const ins = await supabase.from('petty_cash').insert({ user_name:persona, amount:monto, delivered_at:m.fecha||null, movimiento_id:m.id, notes:`Abono caja chica (banco) · mov:${m.id}` }).select().single()   // creada desde el banco: fecha de entrega = fecha de la transferencia + enlace real
      if(ins.error) throw ins.error; pc=ins.data
      const { error:me } = await supabase.from('cartola_movimientos').update({ estado, monto_conciliado:movAplic, categoria:'Caja chica' }).eq('id',m.id); if(me) throw me
      setPettyCash&&setPettyCash(p=>[pc,...p]); _cierraCaja(m,movAplic,estado)
    }catch(e){ if(pc) await supabase.from('petty_cash').delete().eq('id',pc.id); appAlert('Error al abonar caja chica: '+e.message) }
    setBusy(null)
  }
  const deshacerCajaChica = async(m) => {
    if(busy) return
    setBusy(m.id)
    try{
      const pc=(pettyCash||[]).find(p=>String(p.movimiento_id)===String(m.id)||String(p.notes||'').includes(`mov:${m.id}`))
      if(pc){
        if(/\(banco\)/.test(pc.notes||'')){ const {error:pe}=await supabase.from('petty_cash').delete().eq('id',pc.id); if(pe) throw pe; setPettyCash&&setPettyCash(p=>p.filter(x=>x.id!==pc.id)) }   // lo creó la conciliación → borrar
        else { const nota=String(pc.notes||'').replace(new RegExp(`\\s*·\\s*mov:${m.id}`),'').trim(); const {error:pe}=await supabase.from('petty_cash').update({notes:nota, movimiento_id:null}).eq('id',pc.id); if(pe) throw pe; setPettyCash&&setPettyCash(p=>p.map(x=>x.id===pc.id?{...x,notes:nota,movimiento_id:null}:x)) }   // era manual → desvincular (limpia el enlace real)
      }
      const { error } = await supabase.from('cartola_movimientos').update({ estado:'pendiente', monto_conciliado:0, categoria:null }).eq('id',m.id)
      if(error) throw error
      setMovs(p=>p.map(x=>x.id===m.id?{...x,estado:'pendiente',monto_conciliado:0,categoria:null}:x))
    }catch(e){ appAlert('Error al deshacer: '+e.message) }
    setBusy(null)
  }
  // Marca de control (no crea gasto ni toca saldos): p.ej. "Reembolso oficina" de gastos ya registrados.
  const marcarControlCargo = async(m, cat) => {
    if(busy) return
    setBusy(m.id)
    try{
      const { error } = await supabase.from('cartola_movimientos').update({ categoria:cat }).eq('id',m.id)
      if(error) throw error
      setMovs(p=>p.map(x=>x.id===m.id?{...x,categoria:cat}:x))
      setCcFam(p=>({...p,[m.id]:undefined})); setCcCat(p=>({...p,[m.id]:undefined})); setCcQ(p=>({...p,[m.id]:''}))
    }catch(e){ appAlert('Error: '+e.message) }
    setBusy(null)
  }
  // Router del leaf de Gasto Oficina: Caja chica→petty_cash; Reembolso oficina→control; resto→costo de oficina.
  const registrarCargoOficina = (m, cat, sub) => {
    if(cat==='Caja chica') return abonoCajaChica(m, sub)
    if(cat==='Reembolso oficina') return marcarControlCargo(m, 'Reembolso oficina')
    return costoOficina(m, cat, sub||null)
  }
  // Render del clasificador de un cargo: estados resueltos (con Deshacer) o el combo de 3 niveles.
  // ── Pago a proveedor / comisiones (Fase 1): un cargo del banco salda comisiones por pagar (terceros_pagos).
  // NO calza exacto: la venta PROYECTA (30% de cada cuota), el banco es lo REALMENTE transferido (en lotes).
  // FIFO por antigüedad + tolerancia + residual visible ("diferencia esperada", no descuadre).
  const [terc,setTerc] = useState([])
  const [pagoSel,setPagoSel] = useState({})   // movId → Set(terceroId) seleccionados
  useEffect(()=>{ if(DEMO){ setTerc(demoData.terceros_pagos||[]); return } supabase.from('terceros_pagos').select('id,sale_id,billing_id,proveedor_id,proveedor,monto,liquido,retencion,estado,pagado_at,movimiento_id,naturaleza,referencia').then(({data})=>setTerc(data||[]),()=>{}) },[])
  const provDeCargo = m => { const k=crNormRut(m?.rut_contraparte); if(!k) return null; return [...(proveedores||[]),...provExtra].find(p=>crNormRut(p.rut)===k)||null }
  const bDue = id => { const b=(billing||[]).find(x=>String(x.id)===String(id)); return b?.paid_at||b?.due||'' }
  const billDe = id => id ? (billing||[]).find(x=>String(x.id)===String(id)) : null
  const estT = t => { const b=billDe(t.billing_id); if(t.billing_id&&(!b||b.status==='Anulada'||b.deleted_at)) return null; return estadoComision(t,b) }
  const comisPorPagar = provId => (terc||[]).filter(t=>String(t.proveedor_id)===String(provId)&&estT(t)==='por_pagar').sort((a,b)=>String(bDue(a.billing_id)).localeCompare(String(bDue(b.billing_id))))
  const comisAlCobro = provId => (terc||[]).filter(t=>String(t.proveedor_id)===String(provId)&&estT(t)==='por_devengar').sort((a,b)=>String(bDue(a.billing_id)).localeCompare(String(bDue(b.billing_id))))
  const provConComisiones = prov => { if(!prov) return false; const k=crNormRut(prov.rut); if(k&&SOCIO_RUT[k]) return false
    if(k&&EQUIPO_RUT[k]&&!comisPorPagar(prov.id).length) return false   // al equipo se le paga sueldo/caja chica; solo si además tiene comisiones por pagar (Martín) se ofrecen
    return (terc||[]).some(t=>String(t.proveedor_id)===String(prov.id)) }
  const [otroServ,setOtroServ] = useState({})   // movId → true: el pago a un proveedor con comisiones se clasifica como otro servicio (gasto)
  const preselFifo = (lista,objetivo)=>{ const out=new Set(); let acc=0; for(const t of lista){ if(acc>=objetivo) break; out.add(t.id); acc+=pagarT(t) } return out }
  const fFifoDate = iso => { try{ const d=new Date(String(iso).slice(0,10)+'T00:00:00'); const M=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']; return `${d.getUTCDate()} ${M[d.getUTCMonth()]} ${d.getUTCFullYear()}` }catch{ return '' } }
  const conciliarComisiones = async (m,prov,selIds)=>{
    if(!selIds.length||busy===m.id) return
    const cg=(conc||[]).filter(c=>String(c.movimiento_id)===String(m.id)&&c.tipo_destino==='gasto')
    if(cg.length){
      const gs=cg.map(c=>(expenses||[]).find(e=>String(e.id)===String(c.gasto_id))).filter(Boolean)
      const convertible=gs.length===cg.length&&gs.every(e=>['Proveedores','Comisiones'].includes(e.category)||e.subcategory==='Comisiones')
      if(!convertible){ appAlert('Este cargo ya está registrado como gasto. Deshaz ese registro antes de marcarlo como pago de comisión, para no contarlo dos veces.'); return }
      if(!(await appConfirm('Este pago quedó registrado como gasto de oficina. ¿Lo paso a pago de comisión? El gasto se quita de Gastos de oficina y queda en el historial.'))) return
      if(!DEMO){ for(const e of gs){ await logActividad('proveedores.gasto_a_comision',{tabla:'expenses',id:e.id,detalle:{title:`Gasto de oficina pasa a pago de comisión · ${e.subcategory||e.category}`,monto:Number(e.amount)||0,gasto:e}})
          await supabase.from('conciliacion').delete().eq('movimiento_id',m.id).eq('gasto_id',e.id)
          await supabase.from('expenses').update({deleted_at:new Date().toISOString()}).eq('id',e.id) }
        await supabase.from('cartola_movimientos').update({monto_conciliado:0,estado:'pendiente'}).eq('id',m.id) }
      setConc(p=>p.filter(c=>!(String(c.movimiento_id)===String(m.id)&&c.tipo_destino==='gasto')))
      setExpenses&&setExpenses(p=>p.filter(e=>!gs.some(g=>g.id===e.id)))
      m={...m,monto_conciliado:0,estado:'pendiente'}
    }
    setBusy(m.id)
    try{
      const sum=(terc||[]).filter(t=>selIds.includes(t.id)).reduce((a,t)=>a+pagarT(t),0)
      let res={aplicado:(Number(m.monto_conciliado)||0)+sum,estado:m.estado}
      if(!DEMO) res=await conciliarPagoComisiones({...m,categoria:'Proveedor'},selIds,sum)
      setTerc(p=>p.map(t=>selIds.includes(t.id)?{...t,estado:'pagado',pagado_at:String(m.fecha).slice(0,10),movimiento_id:m.id}:t))
      setConc(p=>[...p,{id:res.conc?.id,movimiento_id:m.id,tipo_destino:'tercero',monto_aplicado:sum,origen:'manual'}])
      setMovs(p=>p.map(x=>x.id===m.id?{...x,categoria:'Proveedor',monto_conciliado:res.aplicado,estado:res.estado}:x))
      setPagoSel(s=>{const n={...s}; delete n[m.id]; return n})
      logActividad(`proveedores.${prov.id}.comision`,{tabla:'cartola_movimientos',id:m.id,detalle:{title:`Pago del ${String(m.fecha).slice(8,10)}-${String(m.fecha).slice(5,7)} ↔ ${selIds.length} ${selIds.length===1?'comisión':'comisiones'} (desde Banco)`,monto:sum}})
    }catch(e){ appAlert('Error al conciliar el pago de comisiones: '+e.message) }
    setBusy(null)
  }
  const deshacerComisiones = async (m)=>{
    if(busy===m.id) return; setBusy(m.id)
    try{
      const rows=(terc||[]).filter(t=>String(t.movimiento_id)===String(m.id))
      const sum=rows.reduce((a,t)=>a+pagarT(t),0)
      // Los registrados directo desde Banco (costo posterior a la venta) se borran; los que venían por pagar vuelven a por pagar.
      const desdeBanco=rows.filter(t=>String(t.referencia||'').startsWith(REF_COSTO_BANCO)).map(t=>t.id)
      const ids=rows.filter(t=>!desdeBanco.includes(t.id)).map(t=>t.id)
      if(!DEMO){
        if(desdeBanco.length) await supabase.from('terceros_pagos').delete().in('id',desdeBanco)
        if(ids.length) await supabase.from('terceros_pagos').update({estado:'por_pagar',pagado_at:null,movimiento_id:null}).in('id',ids)
        await supabase.from('conciliacion').delete().eq('movimiento_id',m.id).eq('tipo_destino','tercero')
        { const ap=Math.max(0,(m.monto_conciliado||0)-sum); await supabase.from('cartola_movimientos').update({monto_conciliado:ap,estado:ap>0?'parcial':'pendiente'}).eq('id',m.id) }
      }
      setTerc(p=>p.filter(t=>!desdeBanco.includes(t.id)).map(t=>ids.includes(t.id)?{...t,estado:'por_pagar',pagado_at:null,movimiento_id:null}:t))
      setTercerosRoot&&setTercerosRoot(p=>p.filter(t=>!desdeBanco.includes(t.id)).map(t=>ids.includes(t.id)?{...t,estado:'por_pagar',pagado_at:null,movimiento_id:null}:t))
      setConc(p=>p.filter(c=>!(String(c.movimiento_id)===String(m.id)&&c.tipo_destino==='tercero')))
      setMovs(p=>p.map(x=>{ if(x.id!==m.id) return x; const ap=Math.max(0,(x.monto_conciliado||0)-sum); return {...x,monto_conciliado:ap,estado:ap>0?'parcial':'pendiente'} }))
    }catch(e){ appAlert('Error al deshacer: '+e.message) }
    setBusy(null)
  }
  // Costo de terceros POSTERIOR a la venta, registrado desde el cargo: comisión o servicio complementario de un especialista.
  // Queda pagado y conciliado (tipo 'tercero'), rebaja el ingreso de la venta y nunca se registra además como gasto de oficina.
  const registrarCostoTerceros = async (m, sale, nat, billId) => {
    if(busy===m.id||!sale) return
    if((conc||[]).some(c=>String(c.movimiento_id)===String(m.id)&&c.tipo_destino==='gasto')){ appAlert('Este cargo ya está registrado como gasto. Deshaz ese registro antes, para no contarlo dos veces.'); return }
    const monto=(m.monto||0)-(m.monto_conciliado||0); if(monto<=0) return
    setBusy(m.id)
    let prov=provDeCargo(m), creado=null, tp=null
    try{
      if(!prov){
        const nombre=String(m.nombre_contraparte||'').trim()||'Proveedor'
        if(DEMO){ prov={id:'demo-'+m.id,nombre,rut:m.rut_contraparte||null} }
        else { const r=await supabase.from('proveedores').insert({nombre,rut:m.rut_contraparte||null,activo:true}).select().single(); if(r.error) throw r.error; prov=r.data; creado=r.data }
        setProvExtra(p=>[...p,prov])
      }
      const fila={proveedor:prov.nombre||prov.razon_social||'Proveedor', rut:prov.rut||m.rut_contraparte||null, monto, estado:'pagado', pagado_at:String(m.fecha).slice(0,10),
        referencia:`${REF_COSTO_BANCO} · ${nat==='complementario'?'servicio complementario':'comisión'} · transferencia ${fmtFechaDMY(m.fecha)}`,
        created_by:user?.email||null, proveedor_id:prov.id, sale_id:sale.id, billing_id:billId||null, movimiento_id:m.id, naturaleza:nat==='complementario'?'complementario':'comision'}
      let cc={id:'demo-c-'+m.id}
      if(!DEMO){
        const r1=await supabase.from('terceros_pagos').insert(fila).select().single(); if(r1.error) throw r1.error; tp=r1.data
        const r2=await supabase.from('conciliacion').insert({movimiento_id:m.id,tipo_destino:'tercero',monto_aplicado:monto,origen:'manual'}).select().single(); if(r2.error) throw r2.error; cc=r2.data; marcaQuien(cc.id)
        const ap=(m.monto_conciliado||0)+monto
        const { error:me }=await supabase.from('cartola_movimientos').update({monto_conciliado:ap,estado:ap>=(m.monto||0)?'conciliado':'parcial',categoria:'Proveedor'}).eq('id',m.id); if(me) throw me
      } else tp={...fila,id:'demo-t-'+m.id}
      setTerc(p=>[...p,tp]); setTercerosRoot&&setTercerosRoot(p=>[tp,...p]); setConc(p=>[...p,{id:cc.id,movimiento_id:m.id,tipo_destino:'tercero',monto_aplicado:monto,origen:'manual'}])
      setMovs(p=>p.map(x=>{ if(x.id!==m.id) return x; const ap=(x.monto_conciliado||0)+monto; return {...x,monto_conciliado:ap,estado:ap>=(x.monto||0)?'conciliado':'parcial',categoria:'Proveedor'} }))
      setCtSel(p=>({...p,[m.id]:undefined})); setCcFam(p=>({...p,[m.id]:undefined}))
    }catch(e){
      if(tp&&!DEMO) await supabase.from('terceros_pagos').delete().eq('id',tp.id)
      if(creado&&!DEMO) await supabase.from('proveedores').delete().eq('id',creado.id)
      appAlert('No se pudo registrar el costo de terceros: '+e.message)
    }
    setBusy(null)
  }
  const renderPagoProveedor = (m)=>{
    if(m.tipo!=='cargo'||m.es_interno) return null
    const prov=provDeCargo(m); if(!prov) return null
    if((concByMov[m.id]||[]).some(c=>c.tipo_destino==='devolucion')) return null   // cargo devuelto: no es pago de comisión
    const pagadasAqui=(terc||[]).filter(t=>String(t.movimiento_id)===String(m.id))
    const yaConc=(concByMov[m.id]||[]).some(c=>c.tipo_destino==='tercero')||pagadasAqui.length>0
    if(yaConc){
      const sum=pagadasAqui.reduce((a,t)=>a+pagarT(t),0)
      return <div style={{marginTop:5,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}} onClick={e=>e.stopPropagation()}>
        <span style={{fontSize:9.5,fontWeight:700,borderRadius:20,padding:'2px 8px',background:C.greenBg,color:C.greenText,whiteSpace:'nowrap'}}>→ {pagadasAqui.length===1?(pagadasAqui[0].naturaleza==='complementario'?'servicio complementario':'comisión'):`${pagadasAqui.length} costos de terceros`} de {prov.nombre}{(()=>{ const sid=pagadasAqui[0]?.sale_id; const sv=(sales||[]).find(x=>String(x.id)===String(sid)); return sv?` · ${sv.title||'venta'}`:'' })()} · {fmtM(sum)}</span>
        <button disabled={busy===m.id} onClick={()=>deshacerComisiones(m)} style={{fontSize:10,color:C.muted,background:'none',border:'none',cursor:busy===m.id?'default':'pointer'}}>Deshacer</button>
      </div>
    }
    if(!provConComisiones(prov)) return null
    if(otroServ[m.id]) return <div style={{marginTop:5,fontSize:11,color:C.muted}} onClick={e=>e.stopPropagation()}>Clasificando como otro servicio · <span onClick={()=>setOtroServ(p=>({...p,[m.id]:false}))} style={{color:C.accent,fontWeight:700,cursor:'pointer'}}>Es pago de comisión <Gl n='chevron'/></span></div>
    // Comisiones ya marcadas pagadas a mano sin su movimiento del banco (±45 días): se ofrecen para enlazarlas con este cargo
    // (si no, al llegar la cartola solo aparecían las por pagar y el pago real no se podía conciliar).
    const sinBanco=(terc||[]).filter(t=>String(t.proveedor_id)===String(prov.id)&&t.estado==='pagado'&&!t.movimiento_id&&t.pagado_at&&Math.abs((new Date(String(t.pagado_at).slice(0,10))-new Date(String(m.fecha).slice(0,10)))/864e5)<=45)
    const debe=[...comisPorPagar(prov.id),...sinBanco], alCobro=comisAlCobro(prov.id), verAnt=!!pagoSel['ant:'+m.id]
    const lista=verAnt?[...debe,...alCobro]:debe
    const cargo=(m.monto||0)-(m.monto_conciliado||0)
    // Preselección: un calce EXACTO y único (1 a 4 comisiones) gana; si no, FIFO por antigüedad.
    const exacto=(()=>{ const L=debe.slice(0,14), hits=[]; const rec=(i,acc,sum)=>{ if(hits.length>1) return; if(acc.length&&Math.abs(sum-cargo)<=1){ hits.push(acc); return } if(acc.length>=4||i>=L.length||sum>cargo+1) return; rec(i+1,[...acc,L[i]],sum+(Number(L[i].monto)||0)); rec(i+1,acc,sum) }; rec(0,[],0); return hits.length===1?new Set(hits[0].map(t=>t.id)):null })()
    const sel=pagoSel[m.id]||exacto||preselFifo(debe,cargo)
    const selArr=lista.filter(t=>sel.has(t.id))
    const sumSel=selArr.reduce((a,t)=>a+pagarT(t),0)
    const diff=cargo-sumSel
    const toggle=id=>{ const n=new Set(sel); n.has(id)?n.delete(id):n.add(id); setPagoSel(s=>({...s,[m.id]:n})) }
    const cliNom=b=>(clients||[]).find(c=>String(c.id)===String(b?.client_id))?.name||''
    const fila=t=>{ const on=sel.has(t.id), b=billDe(t.billing_id), est=estT(t); return (
      <div key={t.id} onClick={()=>toggle(t.id)} style={{display:'flex',alignItems:'center',gap:9,padding:'7px 0',borderTop:`1px solid ${C.bgSoft}`,cursor:'pointer'}}>
        <span style={{width:18,height:18,borderRadius:6,flexShrink:0,border:`1.5px solid ${on?C.accent:C.border}`,background:on?C.accent:'transparent',color:'#fff',fontSize:11,fontWeight:800,display:'flex',alignItems:'center',justifyContent:'center'}}>{on?<Gl n='tick'/>:''}</span>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:12,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{cliNom(b)||prov.nombre}{b?.invoice_no?` · Factura N° ${folioN(b.invoice_no)}`:''}</div>
          <div style={{fontSize:10.5,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.estado==='pagado'&&!t.movimiento_id?`Marcada pagada ${fmtFechaDMY(t.pagado_at)} · falta el banco`:est==='por_pagar'?`Cliente pagó ${fmtFechaDMY(b?.paid_at)}`:'El cliente aún no paga'}{glosaFactura(b)?` · ${glosaFactura(b)}`:''}</div>
        </div>
        <span style={{fontSize:12,fontWeight:700,color:C.text,whiteSpace:'nowrap',fontVariantNumeric:'tabular-nums'}}>{fmtM(pagarT(t))}</span>
      </div>) }
    return <div style={{marginTop:6,border:`1px solid ${C.border}`,borderRadius:12,padding:'10px 12px',background:C.bgPanel}} onClick={e=>e.stopPropagation()}>
      <div style={{display:'flex',alignItems:'baseline',gap:8,marginBottom:4}}><span style={{flex:1,fontSize:13,fontWeight:700,color:C.accent}}>Pago de comisión a {prov.nombre}</span>{onOpenProveedor&&<span onClick={e=>{e.stopPropagation();onOpenProveedor(prov.id)}} style={{fontSize:11.5,fontWeight:700,color:C.accent,cursor:'pointer'}}>Ficha <Gl n='chevron'/></span>}</div>
      <div style={{fontSize:11,color:C.muted,marginBottom:4}}>{debe.length?(exacto?'Calce exacto con lo que le debes. Revisa y concilia.':'Le debes (el cliente ya pagó) · marca lo que cubre este pago.'):'No le debes comisiones: si es un anticipo, elige a cuál corresponde.'}</div>
      {debe.map(fila)}
      {alCobro.length>0&&<div onClick={()=>setPagoSel(s=>({...s,['ant:'+m.id]:!verAnt}))} style={{fontSize:11.5,fontWeight:700,color:C.accent,cursor:'pointer',padding:'7px 0',borderTop:`1px solid ${C.bgSoft}`}}>{verAnt?'Ocultar':'Anticipo'} · {alCobro.length} {alCobro.length===1?'comisión':'comisiones'} que el cliente aún no paga {verAnt?<Gl n='chevU'/>:<Gl n='chevD'/>}</div>}
      {verAnt&&alCobro.map(fila)}
      <div style={{marginTop:8,background:C.bgSoft,borderRadius:10,padding:'8px 11px'}}>
        <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:C.muted}}><span>Cargo del banco</span><b style={{color:C.text}}>{fmtM(cargo)}</b></div>
        <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:C.muted,marginTop:2}}><span>Comisiones marcadas</span><b style={{color:C.text}}>{fmtM(sumSel)}</b></div>
        {Math.abs(diff)>0&&<div style={{display:'flex',justifyContent:'space-between',marginTop:5,paddingTop:6,borderTop:`1px dashed ${C.border}`,fontSize:12,color:C.soonText}}><span>Diferencia</span><b>{fmtM(Math.abs(diff))}</b></div>}
      </div>
      <div style={{display:'flex',alignItems:'center',gap:10,marginTop:10,flexWrap:'wrap'}}>
        <button disabled={busy===m.id||!selArr.length} onClick={()=>conciliarComisiones(m,prov,[...sel].filter(id=>lista.some(t=>t.id===id)))} style={{flex:'1 1 200px',padding:'10px',borderRadius:10,border:'none',background:selArr.length?C.accent:C.muted,color:'#fff',fontSize:13,fontWeight:700,cursor:selArr.length&&busy!==m.id?'pointer':'default'}}>Conciliar pago de comisión</button>
        <span onClick={()=>setOtroServ(p=>({...p,[m.id]:true}))} style={{fontSize:11.5,fontWeight:700,color:C.muted,cursor:'pointer'}}>Otro servicio (gasto) <Gl n='chevron'/></span>
      </div>
    </div>
  }

  const renderCargoClasificar = (m) => {
    if(m.tipo!=='cargo'||m.es_interno) return null
    if(provConComisiones(provDeCargo(m))&&!otroServ[m.id]&&!(concByMov[m.id]||[]).length) return null   // proveedor con comisiones: el pago es comisión por defecto (panel "Pago de comisión")
    const conc=concByMov[m.id]||[]
    const monto=(m.monto||0)-(m.monto_conciliado||0)
    const stop=e=>e.stopPropagation()
    const dvRow=conc.find(c=>c.tipo_destino==='devolucion')
    if(dvRow){ const ab=(movs||[]).find(x=>String(x.id)===String(dvRow.devuelve_mov_id))
      return <div style={{marginTop:5,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}} onClick={stop}>
        <span style={{fontSize:9.5,fontWeight:700,borderRadius:20,padding:'2px 8px',background:C.bgWarm,color:C.grisText,whiteSpace:'nowrap'}}>→ Devuelto el {fmtFechaDMY(ab?.fecha)} · {fmtM(dvRow.monto_aplicado)}</span>
        {ab&&<button onClick={()=>irMov(ab.id)} style={{fontSize:10,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',fontWeight:600}}>Ver abono</button>}
        <button disabled={busy===m.id} onClick={()=>deshacer(m)} style={{fontSize:10,color:C.muted,background:'none',border:'none',cursor:busy===m.id?'default':'pointer'}}>Deshacer</button>
      </div> }
    const done=(sty,txt,onUndo,undoLabel)=><div style={{marginTop:5,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}} onClick={stop}>
      <span style={{fontSize:9.5,fontWeight:700,borderRadius:20,padding:'2px 8px',background:sty.bg,color:sty.color,whiteSpace:'nowrap'}}>→ {txt}</span>
      <button disabled={busy===m.id} onClick={()=>onUndo()} style={{fontSize:10,color:C.muted,background:'none',border:'none',cursor:busy===m.id?'default':'pointer'}}>{undoLabel||'Deshacer'}</button>
    </div>
    // ---- YA resuelto ----
    const gcRow=conc.find(c=>(c.tipo_destino==='gasto'||c.tipo_destino==='fondo')&&c.gasto_id)
    const gExp=gcRow&&(expenses||[]).find(e=>String(e.id)===String(gcRow.gasto_id))
    if(gExp){
      const esOfi=ofiCli&&String(gExp.client_id)===String(ofiCli.id)
      const txt=esOfi ? `Gasto Oficina · ${gExp.category||'—'}${gExp.subcategory?` › ${gExp.subcategory}`:''} · ${fmtM(gcRow.monto_aplicado)}` : `Gasto de ${cmap[gExp.client_id]||'cliente'} · ${fmtM(gcRow.monto_aplicado)}`
      return done(esOfi?{color:C.azulInfo,bg:C.azulBg}:{color:C.coralText,bg:'#FAECE7'}, txt, ()=>deshacer(m))
    }
    if(conc.length) return null   // conciliado contra otra cosa → lo maneja otro bloque
    const liqM=liqDeMov(m)
    if(liqM) return done({color:C.coralText,bg:'#FAECE7'}, `Notaría · liquidación del ${fmtFechaDMY(liqM.created_at)} · ${liqM.n_gastos||0} OT${Math.round(liqM.total||0)!==Math.round(m.monto||0)?` · liquidación ${fmtM(liqM.total)}`:''}`, ()=>desenlazarNotaria(m), 'Deshacer')
    if(m.categoria==='Cliente'&&m.cliente_id) return done({color:C.coralText,bg:'#FAECE7'}, `Gasto de ${cmap[m.cliente_id]||'cliente'} · control`, ()=>quitarCargoCliente(m), 'Quitar')
    if(m.categoria==='Caja chica'){ const pc=(pettyCash||[]).find(p=>String(p.nota||'').includes(`mov:${m.id}`)); const vinc=pc&&!/\(banco\)/.test(pc.nota||''); return done({color:C.tealText,bg:C.tealBg}, `Caja chica${pc?.user_name?` · ${pc.user_name}`:''}${vinc?' · vinculado':''} · ${fmtM(m.monto)}`, ()=>deshacerCajaChica(m), 'Deshacer') }
    if(m.categoria==='Reembolso oficina') return done({color:C.azulInfo,bg:C.azulBg}, 'Reembolso oficina · control', ()=>marcarControlCargo(m,null), 'Quitar')
    if(m.categoria&&m.categoria!=='Cliente'){ const t=TAG_STY[m.categoria]||{bg:C.bgWarm,color:C.grisText}; return done({color:t.color,bg:t.bg}, m.categoria, ()=>setCategoria(m,null), 'Quitar') }
    // ---- SIN clasificar → combo ----
    const fam=ccFam[m.id]; const cat=ccCat[m.id]; const q=(ccQ[m.id]||'')
    const sug=cargoSugerencia(m)
    const sugGrupo=(!sug||sug.fam!=='oficina')?matchGrupoPresupuesto(m):null   // cargo = suma de varias líneas del presupuesto → repartir
    const grupoBar=()=>{ if(!sugGrupo) return null
      return <div style={{background:'#F1FAF6',border:'1px solid #CFE9DD',borderRadius:10,padding:'9px 10px',marginBottom:8}}>
        <div style={{fontSize:12,fontWeight:700,color:C.accent,marginBottom:4}}>Pago agrupado · {sugGrupo.items.length} costos de oficina</div>
        {sugGrupo.items.map((it,ix)=>(<div key={ix} style={{display:'flex',justifyContent:'space-between',fontSize:10,color:C.muted,padding:'1px 0'}}><span>{it.item} <span style={{color:C.textSoft}}>· {it.categoria}</span></span><span style={{fontWeight:600,color:C.text,fontVariantNumeric:'tabular-nums'}}>{fmtM(it.monto)}</span></div>))}
        <div style={{fontSize:9,color:C.greenText,margin:'3px 0 7px'}}>calza con la suma de tu presupuesto · monto exacto</div>
        <button disabled={busy===m.id} onClick={()=>costoOficinaSplit(m,sugGrupo.items)} style={{width:'100%',fontSize:11,fontWeight:700,border:'none',borderRadius:8,padding:'7px',cursor:busy===m.id?'default':'pointer',background:C.accent,color:'#fff'}}>Conciliar · repartir en {sugGrupo.items.length}</button>
      </div> }
    const inp=(ph,onBg)=><div style={{display:'flex',alignItems:'center',gap:8,border:`1.5px solid ${C.accent}`,background:'#fff',borderRadius:10,padding:'8px 10px'}}>
      <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke={C.muted} strokeWidth='2.2' strokeLinecap='round'><circle cx='11' cy='11' r='7'/><line x1='21' y1='21' x2='16.5' y2='16.5'/></svg>
      <input value={q} onChange={e=>setCcQ(p=>({...p,[m.id]:e.target.value}))} placeholder={ph} style={{border:'none',outline:'none',fontSize:13,color:C.text,flex:1,minWidth:0,background:'none'}}/>
    </div>
    const rowSty=(i)=>({display:'flex',alignItems:'center',gap:10,padding:'9px 11px',borderTop:i>0?`1px solid ${C.bgSoft}`:'none',cursor:'pointer'})
    const backHd=(label,onBack)=><div style={{display:'flex',alignItems:'center',gap:7,marginBottom:8}}><span onClick={onBack} style={{color:C.accent,fontSize:15,cursor:'pointer'}}><Gl n='chevL'/></span><span style={{fontSize:12,fontWeight:700,color:C.accent,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{label}</span><span style={{marginLeft:'auto',fontSize:12,fontWeight:700,color:C.overdue,flexShrink:0}}>{fmtM(monto)}</span></div>
    const sugBar=()=>{ if(!sug) return null
      // Cargo a alguien del equipo CON caja chica: no asumir "Sueldo" — preguntar y dejar elegir (siempre confirma antes de asignar).
      if(sug.ambiguoCaja){ const per=sug.persona
        const opt=(bg,bd,col,lbl,sub,onClick,flag)=><button disabled={busy===m.id} onClick={onClick} style={{minWidth:0,position:'relative',background:bg,border:`1px solid ${bd}`,borderRadius:10,padding:'9px 6px',cursor:busy===m.id?'default':'pointer',textAlign:'center'}}>
          {flag&&<span style={{position:'absolute',top:-7,right:-4,fontSize:8,fontWeight:800,color:'#fff',background:C.greenText,borderRadius:10,padding:'1px 6px'}}>{flag}</span>}
          <div style={{fontSize:12,fontWeight:700,color:col}}>{lbl}</div><div style={{fontSize:9,color:C.textSoft,marginTop:2}}>{sub}</div></button>
        return <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,padding:'10px 11px',marginBottom:8}}>
          <div style={{fontSize:12,fontWeight:700,color:C.accent}}>Transferencia a {per} · ¿qué fue?</div>
          <div style={{fontSize:10,color:C.textSoft,marginBottom:9}}>Elígelo para clasificarla bien. Solo la reposición de caja chica descuenta de su fondo.</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:7}}>
            {opt(C.tealBg,'#BFE6E3',C.tealText,'Caja chica','repone su fondo',()=>registrarCargoOficina(m,'Caja chica',per),'frecuente')}
            {opt('#F2F7FB','#CFE0EC',C.accent,'Sueldo','remuneración',()=>registrarCargoOficina(m,'Sueldos',per))}
            {opt(C.greenBg,'#BFE0CF',C.greenText,'Bono','aguinaldo, gratif.',()=>registrarCargoOficina(m,'Bono',per))}
            {opt(C.ambarBg,'#EBD9AE',C.coralText,'Otro…','comisión, retiro',()=>{setCcFam(p=>({...p,[m.id]:'oficina'}));setCcCat(p=>({...p,[m.id]:undefined}));setCcQ(p=>({...p,[m.id]:''}))})}
          </div>
        </div> }
      if(sug.fam==='oficina'){ const hint=cargoRachaHint(sug.category,sug.sub); const path=`${sug.category}${sug.sub?` › ${sug.sub}`:''}`; const canConfirm=!!sug.sub||!CARGO_SUB_LABEL[sug.category]
        return <div style={{display:'flex',alignItems:'center',gap:9,background:'#F1FAF6',border:'1px solid #CFE9DD',borderRadius:10,padding:'8px 10px',marginBottom:8}}>
          <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:700,color:C.accent,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{path}</div><div style={{fontSize:10,color:C.greenText,marginTop:1}}>sugerido · {sug.via==='RUT'?'por el RUT':sug.via==='presupuesto'?'calza con tu presupuesto':'de la glosa'}{canConfirm?(hint?` · ${hint.mes} ${fmtM(hint.monto)}`:''):` · elige el ${CARGO_SUB_LABEL[sug.category]}`}</div></div>
          <button disabled={busy===m.id} onClick={canConfirm?()=>registrarCargoOficina(m,sug.category,sug.sub||null):()=>{setCcFam(p=>({...p,[m.id]:'oficina'}));setCcCat(p=>({...p,[m.id]:sug.category}));setCcQ(p=>({...p,[m.id]:''}))}} style={{fontSize:11,fontWeight:600,border:'none',borderRadius:8,padding:'6px 13px',cursor:'pointer',background:C.accent,color:'#fff'}}>{canConfirm?'Confirmar':'Elegir'}</button>
        </div> }
      const cnm=cmap[sug.clientId]||'cliente'
      return <div style={{display:'flex',alignItems:'center',gap:9,background:'#FBF3EF',border:'1px solid #F1DDD2',borderRadius:10,padding:'8px 10px',marginBottom:8}}>
        <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:700,color:C.coralText,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{cnm}</div><div style={{fontSize:10,color:C.coralText,marginTop:1}}>gasto de cliente · de la glosa · solo control</div></div>
        <button disabled={busy===m.id} onClick={()=>marcarCargoCliente(m,sug.clientId)} style={{fontSize:11,fontWeight:600,border:'none',borderRadius:8,padding:'6px 13px',cursor:'pointer',background:C.coralText,color:'#fff'}}>Confirmar</button>
      </div>
    }
    // Pago a la notaría: sugiere su liquidación (un toque enlaza; la diferencia se muestra, no se esconde).
    const lq=liqParaCargo(m)
    const notaBar=()=>{ if(!lq) return null
      return <div style={{display:'flex',alignItems:'center',gap:9,background:'#FBF3EF',border:'1px solid #F1DDD2',borderRadius:10,padding:'8px 10px',marginBottom:8}}>
        <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:700,color:C.coralText,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>Notaría · liquidación del {fmtFechaDMY(lq.liq.created_at)} · {lq.liq.n_gastos||0} OT</div><div style={{fontSize:10,color:C.coralText,marginTop:1}}>{lq.exacto?'mismo monto':`liquidación ${fmtM(lq.liq.total)} · diferencia ${fmtM(Math.abs(lq.dif))}`}</div></div>
        <button disabled={busy===m.id} onClick={()=>enlazarNotaria(m,lq.liq)} style={{fontSize:11,fontWeight:600,border:'none',borderRadius:8,padding:'6px 13px',cursor:'pointer',background:C.coralText,color:C.surface}}>Enlazar</button>
      </div> }
    // NIVEL 0 — tres tiles (pasan a dos filas si no caben)
    if(!fam) return <div style={{marginTop:6}} onClick={stop}>
      {notaBar()}
      {lq?null:sugBar()}
      {grupoBar()}
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
        <button onClick={()=>{setCcCat(p=>({...p,[m.id]:undefined}));setCcQ(p=>({...p,[m.id]:''}));setCcFam(p=>({...p,[m.id]:'oficina'}))}} style={{flex:'1 1 120px',minWidth:0,background:'#F2F7FB',border:'1px solid #CFE0EC',borderRadius:12,padding:'11px 8px',cursor:'pointer',textAlign:'center',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:2}}>
          <div style={{fontSize:13,fontWeight:700,whiteSpace:'nowrap',color:C.accent}}>Gasto Oficina</div><div style={{fontSize:9,color:C.muted,textWrap:'balance'}}>sueldos, arriendo, retiros…</div>
        </button>
        <button onClick={()=>{setCcQ(p=>({...p,[m.id]:''}));setCcFam(p=>({...p,[m.id]:'cliente'}))}} style={{flex:'1 1 120px',minWidth:0,background:'#FBF3EF',border:'1px solid #EFD8CC',borderRadius:12,padding:'11px 8px',cursor:'pointer',textAlign:'center',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:2}}>
          <div style={{fontSize:13,fontWeight:700,whiteSpace:'nowrap',color:C.coralText}}>Gasto Cliente</div><div style={{fontSize:9,color:C.muted,textWrap:'balance'}}>marca de qué cliente fue</div>
        </button>
        <button onClick={()=>{setCcQ(p=>({...p,[m.id]:''}));setCtSel(p=>({...p,[m.id]:{nat:'comision'}}));setCcFam(p=>({...p,[m.id]:'terceros'}))}} style={{flex:'1 1 120px',minWidth:0,background:C.tealBg,border:'1px solid #BFE6E3',borderRadius:12,padding:'11px 8px',cursor:'pointer',textAlign:'center',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:2}}>
          <div style={{fontSize:13,fontWeight:700,whiteSpace:'nowrap',color:C.tealText}}>Costo de terceros</div><div style={{fontSize:9,color:C.muted,textWrap:'balance'}}>rebaja el ingreso de una venta</div>
        </button>
      </div>
    </div>
    // FAMILIA COSTO DE TERCEROS — de una venta (comisión o servicio complementario posterior a la venta)
    if(fam==='terceros'){
      const st=ctSel[m.id]||{nat:'comision'}; const setSt=v=>setCtSel(p=>({...p,[m.id]:{...st,...v}}))
      const montoT=(m.monto||0)-(m.monto_conciliado||0)
      const prov=provDeCargo(m)
      const ventaTxt=v=>`${cmap[v.client_id]||'—'} · ${v.title||'venta'}`
      // Sugeridas: las ventas donde este proveedor ya tiene costos (aprende de lo registrado)
      const sugIds=prov?[...new Set((terc||[]).filter(t=>String(t.proveedor_id)===String(prov.id)&&t.sale_id).map(t=>String(t.sale_id)))]:[]
      const sugV=sugIds.map(id=>(sales||[]).find(v=>String(v.id)===id)).filter(Boolean).slice(0,4)
      const venta=st.saleId?(sales||[]).find(v=>String(v.id)===String(st.saleId)):null
      const hd=backHd(venta?`Costo de terceros › ${venta.title||'venta'}`:st.cid?`Costo de terceros › ${cmap[st.cid]||'cliente'}`:'Costo de terceros',()=>{ if(venta) setSt({saleId:undefined,billId:undefined}); else if(st.cid) setSt({cid:undefined}); else setCcFam(p=>({...p,[m.id]:undefined})) })
      const provTxt=prov?(prov.nombre||prov.razon_social):`${m.nombre_contraparte||'Proveedor'} (proveedor nuevo)`
      if(!venta){
        const ventasCli=st.cid?(sales||[]).filter(v=>String(v.client_id)===String(st.cid)&&!v.deleted_at&&!['Propuesta','Borrador','Rechazada'].includes(v.status)).sort((a,b)=>(a.status==='Activo'?0:1)-(b.status==='Activo'?0:1)||String(b.created_at||'').localeCompare(String(a.created_at||''))):[]
        return <div style={{marginTop:6}} onClick={stop}>
          {hd}
          <div style={{fontSize:10,color:C.muted,marginBottom:6}}>{provTxt} · ¿de qué venta es? Rebaja el ingreso de esa venta.</div>
          {!st.cid&&sugV.length>0&&<div style={{border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden',marginBottom:7}}>
            {sugV.map((v,i)=><div key={v.id} onClick={()=>setSt({cid:v.client_id,saleId:v.id})} style={rowSty(i)}><span style={{fontSize:13,fontWeight:600,color:C.text,flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{ventaTxt(v)}</span><span style={{fontSize:9,fontWeight:700,color:C.tealText,flexShrink:0}}>sugerida</span><span style={{color:C.textSoft,fontSize:14}}><Gl n='chevron'/></span></div>)}
          </div>}
          {!st.cid&&<AsignarClienteInline bill={{id:m.id}} clients={clients} onAssign={(_,cid)=>setSt({cid})} label='Buscar cliente' placeholder='Buscar cliente o RUT…'/>}
          {st.cid&&<div style={{border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden'}}>
            {ventasCli.map((v,i)=><div key={v.id} onClick={()=>setSt({saleId:v.id})} style={rowSty(i)}><span style={{fontSize:13,fontWeight:600,color:C.text,flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{v.title||'venta'}</span><span style={{fontSize:10,color:C.muted,flexShrink:0}}>{v.status}{v.year?` · ${v.year}`:''}</span><span style={{color:C.textSoft,fontSize:14}}><Gl n='chevron'/></span></div>)}
            {!ventasCli.length&&<div style={{padding:'9px 11px',fontSize:11,color:C.muted}}>Este cliente no tiene ventas activas ni terminadas.</div>}
          </div>}
        </div>
      }
      const facts=(billing||[]).filter(b=>b&&String(b.sale_id)===String(venta.id)&&!b.deleted_at&&b.status!=='Anulada'&&b.invoice_no&&b.billing_type!=='reembolso').sort((a,b)=>String(b.issued_at||'').localeCompare(String(a.issued_at||''))).slice(0,6)
      const natBtn=(k,lbl,sub)=>{ const on=st.nat===k; return <button onClick={()=>setSt({nat:k})} style={{flex:1,minWidth:0,background:on?C.tealBg:'#fff',border:`1.5px solid ${on?C.tealText:C.border}`,borderRadius:10,padding:'9px 6px',cursor:'pointer',textAlign:'center',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:2}}><div style={{fontSize:12,fontWeight:700,color:on?C.tealText:C.text,textWrap:'balance'}}>{lbl}</div><div style={{fontSize:9,color:C.textSoft,textWrap:'balance'}}>{sub}</div></button> }
      const chip=(on,lbl,onClick,key)=><span key={key} onClick={onClick} style={{fontSize:11,fontWeight:700,borderRadius:20,padding:'5px 11px',cursor:'pointer',border:`1px solid ${on?C.accent:C.border}`,background:on?C.azulBg:'#fff',color:on?C.accent:C.muted,whiteSpace:'nowrap'}}>{lbl}</span>
      return <div style={{marginTop:6}} onClick={stop}>
        {hd}
        <div style={{fontSize:10,color:C.muted,marginBottom:7}}>{provTxt} · {cmap[venta.client_id]||'—'}</div>
        <div style={{display:'flex',gap:7}}>
          {natBtn('comision','Comisión','por traer la venta')}
          {natBtn('complementario','Servicio complementario','especialista contratado después')}
        </div>
        {facts.length>0&&<><div style={{...SEC_LBL,margin:'10px 0 5px'}}>Factura que rebaja · opcional</div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{chip(!st.billId,'Sin factura',()=>setSt({billId:undefined}),'none')}{facts.map(b=>chip(String(st.billId)===String(b.id),`N° ${folioN(b.invoice_no)} · ${fmtFechaDMY(b.issued_at)}`,()=>setSt({billId:b.id}),b.id))}</div></>}
        <button disabled={busy===m.id} onClick={()=>registrarCostoTerceros(m,venta,st.nat,st.billId)} style={{marginTop:10,width:'100%',padding:'10px',borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:busy===m.id?'default':'pointer',opacity:busy===m.id?.6:1}}>{busy===m.id?'Registrando…':`Registrar costo de ${fmtM(montoT)}`}</button>
      </div>
    }
    // FAMILIA CLIENTE — buscador (crea el gasto del cliente)
    if(fam==='cliente') return <div style={{marginTop:6}} onClick={stop}>
      {backHd('Gasto Cliente',()=>setCcFam(p=>({...p,[m.id]:undefined})))}
      <div style={{fontSize:10,color:C.muted,marginBottom:6}}>Elige el cliente: se registra como gasto en su ficha y descuenta de su fondo.</div>
      <AsignarClienteInline bill={{id:m.id}} clients={clients} onAssign={(_,cid)=>marcarCargoCliente(m,cid)} label='Buscar cliente' placeholder='Buscar cliente o RUT…'/>
    </div>
    // FAMILIA OFICINA · 3er nivel (subcategoría de la categoría en drill)
    if(cat){
      const subLabel=CARGO_SUB_LABEL[cat]||'detalle'
      const subs=cargoPersonas(cat); const ql=q.trim().toLowerCase()
      const shown=ql?subs.filter(s=>s.toLowerCase().includes(ql)):subs
      const exact=subs.some(s=>s.toLowerCase()===ql)
      return <div style={{marginTop:6}} onClick={stop}>
        {backHd(`Gasto Oficina › ${cat}`,()=>{setCcCat(p=>({...p,[m.id]:undefined}));setCcQ(p=>({...p,[m.id]:''}))})}
        {inp(`busca o agrega ${subLabel}…`)}
        <div style={{border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden',marginTop:7}}>
          {shown.map((s,i)=><div key={s} onClick={()=>registrarCargoOficina(m,cat,s)} style={rowSty(i)}><span style={{fontSize:13,fontWeight:600,color:C.text,flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s}</span><span style={{color:C.textSoft,fontSize:14}}><Gl n='chevron'/></span></div>)}
          {ql&&!exact&&<div onClick={()=>registrarCargoOficina(m,cat,q.trim())} style={{...rowSty(shown.length),background:'#FBFCFD'}}><span style={{fontSize:13,fontWeight:600,color:C.accent}}>+ Crear "{q.trim()}" en {cat}</span></div>}
          {!shown.length&&!ql&&<div style={{padding:'9px 11px',fontSize:11,color:C.muted}}>Escribe para agregar {subLabel}…</div>}
        </div>
        <button disabled={busy===m.id} onClick={()=>registrarCargoOficina(m,cat,null)} style={{marginTop:7,fontSize:11,fontWeight:600,color:C.azulInfo,background:C.azulBg,border:'none',borderRadius:8,padding:'6px 12px',cursor:'pointer'}}>Sin {subLabel} · registrar {cat}</button>
      </div>
    }
    // FAMILIA OFICINA · nivel 2 (categorías agrupadas) + Otro
    const ql=q.trim().toLowerCase(); const matchCat=c=>!ql||c.toLowerCase().includes(ql)
    return <div style={{marginTop:6}} onClick={stop}>
      {backHd('Gasto Oficina',()=>setCcFam(p=>({...p,[m.id]:undefined})))}
      {sugBar()}
      {inp('busca o elige categoría…')}
      <div style={{border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden',marginTop:7}}>
        {CARGO_OFI_GRUPOS.map(([gname,cats])=>{ const vis=cats.filter(matchCat); if(!vis.length) return null; return <div key={gname}>
          <div style={{fontSize:9,fontWeight:700,color:C.grisText,textTransform:'uppercase',letterSpacing:.4,padding:'7px 11px 2px',background:C.bgSoft}}>{gname}</div>
          {vis.map((c,i)=>{ const sub=CARGO_SUB_LABEL[c]; const hint=cargoRachaHint(c,null); return <div key={c} onClick={()=> sub ? (setCcCat(p=>({...p,[m.id]:c})),setCcQ(p=>({...p,[m.id]:''}))) : registrarCargoOficina(m,c,null)} style={rowSty(i)}>
            <span style={{fontSize:13,fontWeight:600,color:C.text,flex:1,minWidth:0}}>{c}{sub&&<span style={{color:C.textSoft,fontWeight:400}}> <Gl n='chevron'/> {sub}</span>}</span>
            {hint?<span style={{fontSize:9.5,fontWeight:700,color:C.greenText,background:C.greenBg,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap'}}>{hint.mes} {fmtM(hint.monto)}</span>:<span style={{color:C.textSoft,fontSize:14}}>{sub?<Gl n='chevron'/>:''}</span>}
          </div> })}
        </div> })}
        <div onClick={()=>{ const t=q.trim(); if(t) registrarCargoOficina(m,'Otros',t); else setCcCat(p=>({...p,[m.id]:'Otros'})) }} style={{...rowSty(1),background:'#FBFCFD'}}>
          <span style={{fontSize:13,fontWeight:600,color:C.accent,flex:1}}>{q.trim()?`+ Usar "${q.trim()}" como concepto`:'Otro… escribir un concepto'}</span>
        </div>
      </div>
    </div>
  }
  // Glosa: distingue traspaso interno REAL vs pago de tercero. El estudio es RUT 77.700.387-9 con cuentas BICE 01-38392-2 (gastos) y 01-40383-4 (honorarios).
  // Interno = el banco lo declara "entre cuentas propias" O el REMITENTE es el propio estudio (de LIBERONA ESCALA ABOGADOS ... a LIBERONA ESCALA ABOGADOS / de QUAD ASES, mismo RUT).
  // OJO: "... a LIBERONA ESCALA ABOGADOS" por sí solo NO es interno (el beneficiario es el estudio en TODO pago entrante); hay que anclar en el remitente.
  const _glosaInterna = d => { const s=(d||'').toLowerCase(); return /entre cuentas propias/.test(s) || (/transferencia de\s+liberona escala abogados/.test(s) && /a\s+liberona escala abogados/.test(s)) || /transferencia de\s+quad ases/.test(s) }
  // Tercero = pago entrante de un tercero nombrado, salida a terceros, o el ENMASCARADO de BICE (cuando nos pagan desde otra cuenta BICE aparece "de CLIENTE ... a BENEFICIARIO" con nuestro propio RUT, muy parecido a un traspaso interno).
  const _glosaTercero = d => { const s=(d||'').toLowerCase(); return /abono por transferencia de /.test(s) || /transf\.?\s*a\s*terceros/.test(s) || /\bbeneficiario\b/.test(s) || /transferencia de\s+cliente\b/.test(s) || /dep[oó]sito/.test(s) }
  // AUTO: concilia solo cuando hay UNA factura del cliente dentro de ±TOL (candidato único). El resto va a la bandeja.
  const conciliarAuto = async()=>{
    if(autoRun||busy) return
    setAutoRun(true); let ok=0, monto=0, marc=0, enl=0, cmb=0, nInt=0, nCom=0; const used=new Set(), doneMovs=new Set()
    let sinId=0, sinIdM=0, sinCalce=0, sinCalceM=0   // Mejora 2: desglose de lo que QUEDA tras el auto, por razón
    try{
      // 1) Traspasos internos — LA GLOSA MANDA (BICE no muestra el nombre de quien nos paga, así que un pago de tercero se ve casi igual que un traspaso propio; solo la glosa los distingue):
      //    · glosa PROPIA ("entre cuentas propias" / "de LIBERONA ESCALA ABOGADOS ... a LIBERONA ESCALA ABOGADOS" / "de QUAD ASES") → interno directo, sin necesidad de par.
      //    · glosa de TERCERO ("Abono por transferencia de <nombre>" entrante, "Transf. a terceros" saliente, o el enmascarado "de CLIENTE ... a BENEFICIARIO") → NUNCA se empareja como interno.
      //    · el par cargo↔abono (mismo monto, otra cuenta, ±2 días, único) queda solo como respaldo para glosas neutras que no declaran nada.
      const libres = movs.filter(m=> !m.es_interno && !(concByMov[m.id]?.length) && !m.cliente_id && !m.categoria)
      const W2=2*86400000, usadosI=new Set(); const intSet=new Set()
      libres.forEach(m=>{ if(_glosaInterna(m.descripcion)) intSet.add(m.id) })   // 1a) glosa propia explícita
      // 1b) par por monto SOLO entre patas cuya glosa no es de tercero (bloquea el pago enmascarado "CLIENTE→BENEFICIARIO")
      libres.filter(m=>m.tipo==='cargo' && !intSet.has(m.id) && !_glosaTercero(m.descripcion)).forEach(c=>{ const ms=libres.filter(a=> a.tipo==='abono' && !usadosI.has(a.id) && !intSet.has(a.id) && !_glosaTercero(a.descripcion) && a.rol_cuenta!==c.rol_cuenta && (a.monto||0)===(c.monto||0) && Math.abs(new Date(a.fecha)-new Date(c.fecha))<=W2); if(ms.length===1 && !usadosI.has(c.id)){ usadosI.add(c.id); usadosI.add(ms[0].id); intSet.add(c.id); intSet.add(ms[0].id) } })
      if(intSet.size){ const idsInt=[...intSet]; const { error:ei } = await supabase.from('cartola_movimientos').update({es_interno:true,estado:'interno'}).in('id',idsInt); if(ei) throw ei; setMovs(p=>p.map(x=>intSet.has(x.id)?{...x,es_interno:true,estado:'interno'}:x)); nInt=idsInt.length }
      // 1.5) Auto-identificar abonos sin cliente cuando UNA sola factura (de un único cliente) calza el monto EXACTO en la ventana de fecha (clientePorMonto, mismo criterio que la sugerencia manual). No aprende alias: la id por monto no se propaga a otros movimientos. El paso 2 los concilia.
      const idMap={}
      const _inwinId=(payT,iso)=>{ if(!payT||!iso) return true; const d=(payT-new Date(iso.slice(0,10)+'T12:00').getTime())/86400000; return d>=-3&&d<=60 }
      movs.filter(m=>m.tipo==='abono'&&!m.es_interno&&!m.cliente_id&&!(concByMov[m.id]?.length)&&!RESUELTAS_ABO.includes(m.categoria)&&!intSet.has(m.id)).forEach(m=>{
        const cm=clientePorMonto(m); if(cm){ idMap[m.id]=String(cm.cid); return }
        // Por NOMBRE (estricto-único) PERO solo si está corroborado por una factura del monto exacto en ventana → evita falsos positivos.
        const cid=resolverNombre(m.nombre_contraparte); if(!cid) return
        const amt=m.monto||0; if(amt<=0) return
        const payT=m.fecha?new Date(m.fecha+'T12:00').getTime():null
        if(facturasConSaldo.some(b=>String(b.client_id)===String(cid)&&Math.abs(saldoFactura(b)-amt)<=TOL&&_inwinId(payT,b.issued_at))) idMap[m.id]=String(cid)
      })
      const idIds=Object.keys(idMap)
      if(idIds.length){ for(const mid of idIds){ const { error:ie } = await supabase.from('cartola_movimientos').update({cliente_id:idMap[mid]}).eq('id',mid); if(ie) throw ie } setMovs(p=>p.map(x=> idMap[x.id]?{...x,cliente_id:idMap[x.id]}:x)) }
      // 2) Conciliación exacta (excluye los recién marcados internos; incluye los recién identificados por monto). Gastos no se toca (suele ser fondo). FIFO para recurrentes.
      const movsV = idIds.length ? movs.map(m=> idMap[m.id]?{...m,cliente_id:idMap[m.id]}:m) : movs
      const pend = movsV.filter(m=>esConciliable(m) && m.rol_cuenta!=='gastos' && !(concByMov[m.id]?.length) && !intSet.has(m.id)).slice().sort((a,b)=> (a.fecha||'')<(b.fecha||'')?-1:1)
      // Pareo greedy FIFO: `pend` viene ordenado por fecha (más antiguo primero) y cada pago toma su MEJOR factura
      // EXACTA aún DISPONIBLE — `mejorCandidato(mov, used)` excluye las ya tomadas. Para recurrentes del mismo cliente
      // y monto (N pagos ↔ N facturas iguales) esto las empareja en orden (pago antiguo → factura antigua), que es
      // saldo-safe (el saldo del cliente baja igual sea cual sea la factura que marque). Antes un candado (facCnt<=1)
      // saltaba TODO el set recurrente; ahora se cruzan solos. En el borde "2 pagos, 1 factura" concilia el que
      // corresponde y deja el otro para revisar (antes dejaba los dos sin tocar).
      for(const mov of pend){
        const f=mejorCandidato(mov, used)
        if(f){ used.add(f.id); doneMovs.add(mov.id); if(f.status==='Pagado') enl++; else marc++; await reconciliar(mov, f, 'auto'); ok++; monto+=mov.monto; continue }
        const cb=comboExacto(mov, used) || comboExacto3(mov, used)
        if(cb){ cb.forEach(f=>used.add(f.id)); doneMovs.add(mov.id); await reconciliarCombo(mov, cb); cmb++; ok++; monto+=mov.monto } }
      // 3) Comisión por facturar: abono de quien nos paga comisiones que no calzó con una factura, solo si es inequívoco (comisionAutoOk).
      for(const mov of pend){ if(doneMovs.has(mov.id)||mov.tipo!=='abono') continue; const cid=cliPagadorCom(mov); if(!comisionAutoOk(mov,cid)) continue
        const okC=await comisionPorFacturar(mov,{clientId:cid, origen:mov.detalle_aviso||null, auto:true}); if(okC){ doneMovs.add(mov.id); ok++; monto+=mov.monto; nCom++ } }
      // Mejora 2 — desglose de lo que NO se pudo conciliar, por razón:
      //   sin calce  = abono YA identificado (cliente_id) que no encontró factura de monto exacto en ventana → el monto no cuadra.
      //   sin id     = abono sin cliente_id (ni auto-identificado) → falta cruzar el pagador (el auto no puede tocarlo).
      const sinCalceList = pend.filter(m=>!doneMovs.has(m.id))
      sinCalce = sinCalceList.length; sinCalceM = sinCalceList.reduce((s,m)=>s+(m.monto||0),0)
      const sinIdList = movsV.filter(m=> m.tipo==='abono' && !m.es_interno && !m.cliente_id && !RESUELTAS_ABO.includes(m.categoria) && !(concByMov[m.id]?.length))
      sinId = sinIdList.length; sinIdM = sinIdList.reduce((s,m)=>s+(m.monto||0),0)
    }catch(e){ appAlert('Error en conciliación automática: '+e.message) }
    setAutoRun(false)
    const hecho = (ok||nInt)? `Conciliadas ${ok} · ${fmtM(monto)}.${marc?`\n${marc} marcaron la factura pagada`:''}${enl?` · ${enl} enlazaron facturas ya pagadas`:''}${cmb?` · ${cmb} pagaron varias facturas`:''}${nCom?`\n${nCom} comisi${nCom!==1?'ones':'ón'} por facturar (se cruzan solas con su factura del SII)`:''}${nInt?`\n${nInt} movimiento${nInt!==1?'s':''} interno${nInt!==1?'s':''} marcado${nInt!==1?'s':''} (por glosa)`:''}` : 'No hubo calces nuevos.'
    const queda = (sinId||sinCalce)
      ? `\n\nQuedan sin conciliar:${sinId?`\n· ${sinId} sin identificar (${fmtM(sinIdM)}) — falta cruzar el pagador`:''}${sinCalce?`\n· ${sinCalce} identificadas sin calce exacto (${fmtM(sinCalceM)}) — el monto no cuadra con una factura`:''}`
      : '\n\nNo queda nada por conciliar.'
    appAlert(hecho+queda)
  }
  // Comisión por facturar automática: al abrir Banco, cada abono de quien nos paga comisiones que no tiene factura que calce
  // y es inequívoco (comisionAutoOk) queda registrado solo, una vez por sesión. Queda en la bitácora y se deshace desde el movimiento.
  const _comAutoHecho = useRef(false)
  useEffect(()=>{ if(_comAutoHecho.current||loading||!movs.length||!(billing||[]).length) return; _comAutoHecho.current=true
    const cands=movs.filter(m=>m.tipo==='abono'&&!m.es_interno&&m.estado==='pendiente'&&!(Number(m.monto_conciliado)>0)&&m.rol_cuenta!=='gastos'&&!(concByMov[m.id]?.length)&&!m.categoria&&!mejorCandidato(m,new Set())).map(m=>({m,cid:cliPagadorCom(m)})).filter(x=>comisionAutoOk(x.m,x.cid))
    if(!cands.length) return
    ;(async()=>{ let n=0; for(const {m,cid} of cands){ if(await comisionPorFacturar(m,{clientId:cid, origen:m.detalle_aviso||null, auto:true})) n++ } })()
  },[loading,movs.length,(billing||[]).length])   // eslint-disable-line react-hooks/exhaustive-deps
  // El panel "Revisar propuesta" se eliminó (era una UI paralela al detalle del movimiento). El icono de banco del landing abre el filtro "Por conciliar" — un solo flujo, la misma tarjeta del detalle.
  useEffect(()=>{ if(openProp){ setSub('abonos'); setConcView('porconciliar'); onPropOpened&&onPropOpened() } },[openProp])
  const resumenConc = useMemo(()=>{ const abo=movs.filter(esConciliable); const done=abo.filter(m=>concByMov[m.id]?.length)
    const desc=movs.filter(esDescalce); const fondos=movs.filter(m=>m.tipo==='abono'&&!m.es_interno&&m.rol_cuenta==='gastos'&&!(concByMov[m.id]?.length)&&(!m.categoria||m.categoria==='Cliente')&&!tieneCand(m))
    return { total:abo.length, done:done.length, pend:abo.length-done.length, montoPend:abo.filter(m=>!(concByMov[m.id]?.length)).reduce((s,m)=>s+(m.monto||0),0),
      descalces:desc.length, fondos:fondos.length, fondosMonto:fondos.reduce((s,m)=>s+(m.monto||0),0) } },[movs,concByMov,billing])

  // KPIs globales
  const G = useMemo(()=>{
    const abo=movs.filter(m=>m.tipo==='abono'&&!m.es_interno), car=movs.filter(m=>m.tipo==='cargo'&&!m.es_interno)
    return { nMov:movs.length, nAbo:abo.length, sumAbo:abo.reduce((a,m)=>a+m.monto,0), nCar:car.length, sumCar:car.reduce((a,m)=>a+m.monto,0),
      internos:movs.filter(m=>m.es_interno).length, sinId:abo.filter(m=>!m.cliente_id&&!RESUELTAS_ABO.includes(m.categoria)).length }
  },[movs])

  // Cartolas cargadas (derivado): agrupa por cuenta + mes con período, conteo y totales.
  const cartolas = useMemo(()=>{
    const g={}
    movs.forEach(m=>{ const mes=(m.fecha||'').slice(0,7); if(!mes) return; const k=`${m.rol_cuenta}|${mes}`
      const o=g[k]||(g[k]={rol:m.rol_cuenta,mes,fMin:m.fecha,fMax:m.fecha,n:0,abo:0,car:0})
      o.n++; if(m.fecha<o.fMin)o.fMin=m.fecha; if(m.fecha>o.fMax)o.fMax=m.fecha
      if(m.tipo==='abono')o.abo+=m.monto; else o.car+=m.monto })
    return Object.values(g).sort((a,b)=> a.rol!==b.rol ? (a.rol==='honorarios'?-1:1) : (a.mes<b.mes?1:-1))
  },[movs])

  const aniosDisp = useMemo(()=>{ const s=new Set(); movs.forEach(m=>{ const y=(m.fecha||'').slice(0,4); if(y) s.add(y) }); return [...s].sort().reverse() },[movs])
  const lista = useMemo(()=>{
    let l=movs.filter(m=> sub==='abonos' ? m.tipo==='abono' : m.tipo==='cargo')
    if(cuentaF!=='ambas') l=l.filter(m=>m.rol_cuenta===cuentaF)
    if(anioF!=='todos') l=l.filter(m=>(m.fecha||'').slice(0,4)===anioF)
    if(mesF!=='todos') l=l.filter(m=>(m.fecha||'').slice(5,7)===mesF)
    if(respF!=='todos') l=l.filter(m=> respF==='__sin__' ? !(m.cliente_id&&respByCid[String(m.cliente_id)]) : respByCid[String(m.cliente_id)]===respF)
    if(sub==='abonos'){
      // El movimiento ABIERTO (modalMov) nunca se filtra fuera: al conciliar/identificar queda a la vista
      // con su estado hecho + Deshacer (no se esfuma bajo el dedo). Se reordena solo al cerrarlo o abrir otro.
      const keepOpen=m=>String(m.id)===String(modalMov)
      if(concView==='sinid') l=l.filter(m=>keepOpen(m)||(!m.es_interno&&!m.cliente_id&&!tieneCand(m)&&!RESUELTAS_ABO.includes(m.categoria)))
      else if(concView==='porconciliar') l=l.filter(m=>keepOpen(m)||(tieneCand(m)&&!(concByMov[m.id]?.length)))
      else if(concView==='conciliados') l=l.filter(m=>keepOpen(m)||concByMov[m.id]?.length)
      else if(concView==='descalces') l=l.filter(m=>keepOpen(m)||esDescalce(m))
      // porresolver = unión: sin identificar + por conciliar + descalces (todos los abonos que faltan cruzar), sin duplicar como categorías separadas.
      else if(concView==='porresolver') l=l.filter(m=>keepOpen(m)||abonoConResto(m)||(!m.es_interno&&!(concByMov[m.id]?.length)&&!RESUELTAS_ABO.includes(m.categoria)&&(!m.cliente_id||esConciliable(m))))
    }
    else if(sub==='cargos'&&concView!=='todos'){
      // Cargos que piden tu criterio: sin categoría, no internos, no conciliados. El foco "Por clasificar" (foto arriba) filtra a esta base.
      // Chips de escritorio (mismo patrón que Abonos): sugeridas (la app propone por RUT), caja chica, clasificados, internos.
      const keepOpen=m=>String(m.id)===String(modalMov)
      const porClas=m=>!m.es_interno&&!(concByMov[m.id]?.length)&&!m.categoria
      if(concView==='clasificar') l=l.filter(m=>keepOpen(m)||porClas(m))
      else if(concView==='c_sugeridas') l=l.filter(m=>keepOpen(m)||(porClas(m)&&!!(cargoSugerencia(m)||liqParaCargo(m))))
      else if(concView==='c_caja') l=l.filter(m=>keepOpen(m)||m.categoria==='Caja chica')
      else if(concView==='c_clasificados') l=l.filter(m=>keepOpen(m)||(!m.es_interno&&(concByMov[m.id]?.length||m.categoria)))
      else if(concView==='c_internos') l=l.filter(m=>keepOpen(m)||m.es_interno)
    }
    // Búsqueda por RUT / nombre del banco / cliente resuelto.
    if(q.trim()){ const qq=q.trim().toLowerCase(), qd=q.replace(/[^0-9kK]/g,'').toLowerCase()
      const qn=qq.replace(/[^0-9]/g,'')   // dígitos de la búsqueda → permite buscar por CIFRA ("250000" o "250.000")
      l=l.filter(m=>{ const nm=(m.nombre_contraparte||'').toLowerCase(), cl=(cmap[m.cliente_id]||'').toLowerCase(), rut=(m.rut_contraparte||'').toLowerCase().replace(/[^0-9kk]/g,'')
        const mn=String(Math.abs(m.monto||0))
        return nm.includes(qq)||cl.includes(qq)||(qd.length>=3&&rut.includes(qd))||(qn.length>=3&&mn.includes(qn)) }) }
    l=l.slice().sort((a,b)=> orden==='asc' ? ((a.fecha||'')<(b.fecha||'')?-1:1) : ((a.fecha||'')>(b.fecha||'')?-1:1))
    return l.slice(0,3000)   // tope de seguridad (antes 400): con 400 y orden nueva→antigua se ESCONDÍAN los movimientos más antiguos (la lista "terminaba" a mitad de año). Las filas de meses colapsados no se renderizan, así que un tope alto no pesa. Los años/meses/búsqueda ya permiten acotar.
  },[movs,sub,cuentaF,anioF,mesF,respF,respByCid,concView,concByMov,billing,q,orden,cmap,modalMov,liqsNota,rutsNota])
  // Contadores de los chips de estado sobre la MISMA base filtrada que la lista (cuenta/mes/año/resp) — evita mostrar "88" cuando la vista filtrada está vacía.
  const chipCounts = useMemo(()=>{
    const _base=tipo=>{ let l=movs.filter(m=>m.tipo===tipo)
      if(cuentaF!=='ambas') l=l.filter(m=>m.rol_cuenta===cuentaF)
      if(anioF!=='todos') l=l.filter(m=>(m.fecha||'').slice(0,4)===anioF)
      if(mesF!=='todos') l=l.filter(m=>(m.fecha||'').slice(5,7)===mesF)
      return l }
    const _h0=Date.now(), _viejo=m=>{ const t=m.fecha?new Date(m.fecha+'T12:00').getTime():NaN; return !isNaN(t)&&(_h0-t)/86400000>90 }
    if(sub==='cargos'){ const l=_base('cargo'), pc=l.filter(m=>!m.es_interno&&!(concByMov[m.id]?.length)&&!m.categoria)
      return { clasificar:pc.length, clasificarMonto:pc.reduce((a,m)=>a+Math.abs(m.monto||0),0), clasificar90:pc.filter(_viejo).reduce((a,m)=>a+Math.abs(m.monto||0),0),
        sugeridas:pc.filter(m=>!!(cargoSugerencia(m)||liqParaCargo(m))).length, caja:l.filter(m=>m.categoria==='Caja chica').length,
        clasificados:l.filter(m=>!m.es_interno&&(concByMov[m.id]?.length||m.categoria)).length, internos:l.filter(m=>m.es_interno).length } }
    if(sub!=='abonos') return {porresolver:0,porresolverMonto:0,porresolver90:0,porconciliar:0,descalces:0,sinid:0,conciliados:0}
    let l=movs.filter(m=>m.tipo==='abono')
    if(cuentaF!=='ambas') l=l.filter(m=>m.rol_cuenta===cuentaF)
    if(anioF!=='todos') l=l.filter(m=>(m.fecha||'').slice(0,4)===anioF)
    if(mesF!=='todos') l=l.filter(m=>(m.fecha||'').slice(5,7)===mesF)
    if(respF!=='todos') l=l.filter(m=> respF==='__sin__' ? !(m.cliente_id&&respByCid[String(m.cliente_id)]) : respByCid[String(m.cliente_id)]===respF)
    const _pr=l.filter(m=>abonoConResto(m)||(!m.es_interno&&!(concByMov[m.id]?.length)&&!RESUELTAS_ABO.includes(m.categoria)&&(!m.cliente_id||esConciliable(m))))   // = filtro 'porresolver' de la lista
    const _h=Date.now(), porresolverMonto=_pr.reduce((a,m)=>a+restoAbono(m),0), porresolver90=_pr.filter(m=>{ const t=m.fecha?new Date(m.fecha+'T12:00').getTime():NaN; return !isNaN(t)&&(_h-t)/86400000>90 }).reduce((a,m)=>a+restoAbono(m),0)
    return { porresolver:_pr.length, porresolverMonto, porresolver90, porconciliar:l.filter(m=>tieneCand(m)&&!(concByMov[m.id]?.length)).length, descalces:l.filter(esDescalce).length, sinid:l.filter(m=>!m.es_interno&&!m.cliente_id&&!tieneCand(m)&&!RESUELTAS_ABO.includes(m.categoria)).length, conciliados:l.filter(m=>concByMov[m.id]?.length).length }
  },[movs,sub,cuentaF,anioF,mesF,respF,respByCid,concByMov,billing,liqsNota,rutsNota])

  const rolChip = rol => rol==='honorarios'?{bg:C.azulBg,color:C.accent,t:'Cta. Honorarios'}:rol==='gastos'?{bg:C.ambarBg,color:C.soonText,t:'Cta. Gastos'}:{bg:C.bgWarm,color:C.grisText,t:'—'}
  // Chip de estado definitivo para el landing (un solo chip que informa de verdad qué pasó con el movimiento).
  const estadoChip = m => {
    if(m.es_interno) return {t:'Interno', c:C.grisText, bg:C.bgWarm}
    const cc=concByMov[m.id]||[]
    if(cc.length){
      const fon=cc.find(c=>c.tipo_destino==='fondo'), ant=cc.find(c=>c.tipo_destino==='anticipo'), facs=cc.filter(c=>c.tipo_destino==='factura')
      // Factura primero (un abono "factura + gastos" se rotula por la factura; el fondo de reembolso es secundario).
      if(facs.length>1) return {t:`→ ${facs.length} facturas`, c:C.greenText, bg:C.greenBg}
      if(facs.length===1){ const f=billing.find(b=>b.id===facs[0].factura_id); return {t:`→ ${lblFacturaN(f)}`, c:C.greenText, bg:C.greenBg} }
      // Fondo: Devolución (cian invertido) vs Fondo por Rendir (verde invertido) según el concepto del fondo creado.
      if(fon){ const fe=(expenses||[]).find(e=>String(e.id)===String(fon.gasto_id)); const dev=fe&&/^(devoluci|reembolso)/i.test(fe.concept||''); return dev?{t:'→ Devolución', c:C.coralText, bg:'#FAECE7'}:{t:'Fondo por Rendir', c:C.tealText, bg:C.tealBg} }
      if(ant) return {t:'→ Anticipo', c:C.azulInfo, bg:C.azulBg}
      if(cc.some(c=>c.tipo_destino==='ingreso')) return {t:'→ Ingreso de oficina', c:C.greenText, bg:C.greenBg}
      if(cc.every(c=>c.tipo_destino==='devolucion')) return m.tipo==='cargo'?{t:'→ Devuelto', c:C.grisText, bg:C.bgWarm}:{t:'→ Devolución de un pago', c:C.grisText, bg:C.bgWarm}
      return {t:'→ Conciliado', c:C.greenText, bg:C.greenBg}
    }
    if(m.estado==='parcial') return {t:`Parcial · resta ${fmtM((m.monto||0)-(m.monto_conciliado||0))}`, c:C.soon, bg:C.soonBg}
    if(m.categoria){ const s=TAG_STY[m.categoria]||{bg:C.bgWarm,color:C.grisText}; const ct=m.categoria==='Devolución'?'← Devolución':m.categoria==='Provisión de gastos'?'Fondo por Rendir':m.categoria; return {t:ct, c:s.color, bg:s.bg} }
    if(m.tipo==='abono'){ if(!m.cliente_id) return {t:'Sin identificar', c:'#A35200', bg:C.overdueBg}; return tieneCand(m) ? {t:'Por conciliar', c:C.soon, bg:C.soonBg} : {t:'Sin factura que calce', c:C.coralText, bg:'#FAECE7'} }
    return {t:'Sin clasificar', c:C.muted, bg:C.bgWarm}
  }
  // Etiqueta legible para movimientos sin contraparte (tarjeta, SII, comisión, etc.) a partir de la glosa.
  const tipoMov = d => { const s=(d||'').toLowerCase()
    if(s.includes('tarjeta')) return 'Pago tarjeta de crédito'
    if(s.includes('pago sii')||s.includes('tesoreria')||s.includes('impuesto')||s.includes('f29')||s.includes('iva')) return 'Pago SII / impuestos'
    if(s.includes('previred')||s.includes('cotizac')||s.includes('afp')||s.includes('isapre')||s.includes('fonasa')) return 'Previred / cotizaciones'
    if(s.includes('remuneraci')||s.includes('sueldo')||s.includes('nomina')||s.includes('nómina')||s.includes('honorarios pers')) return 'Remuneraciones'
    if(s.includes('comisi')||s.includes('mantencion')||s.includes('mantención')||s.includes('cobro ')) return 'Comisión / mantención banco'
    if(s.includes('intereses')||s.includes('interes ')) return 'Intereses'
    if(s.includes('pac ')||s.includes('pago automatico')||s.includes('pago automático')) return 'PAC (pago automático)'
    if(s.includes('cheque')) return 'Cheque'
    if(s.includes('giro')||s.includes('retiro')) return 'Giro / retiro'
    if(s.includes('transf')) return 'Transferencia (sin RUT en glosa)'
    return 'Movimiento bancario' }

  return { devolucionCands, registrarDevolucion, liqParaCargo, enlazarNotaria, EQUIPO_RUT, SOCIO_RUT, CONTADORA_RUT, movs, setMovs, loading, setLoading, importing, setImporting, prog, setProg, reportes, setReportes, cargaPreview, setCargaPreview, verifRes, setVerifRes, verificando, setVerificando, aliases, setAliases, sub, setSub, cobradasOpen, setCobradasOpen, cuentaF, setCuentaF, anioF, setAnioF, mesF, setMesF, concYCol, setConcYCol, concMOpen, setConcMOpen, respF, setRespF, facChip, setFacChip, facMyc, setFacMyc, devolFor, setDevolFor, devolSel, setDevolSel, respByCid, respDisp, q, setQ, orden, setOrden, verCartolas, setVerCartolas, verCarga, setVerCarga, verFiltros, setVerFiltros, editMov, setEditMov, tagFor, setTagFor, tipoAprendido, setTipoAprendido, splitMov, setSplitMov, splitAdel, setSplitAdel, fondoFor, setFondoFor, otroFor, setOtroFor, otraFacFor, setOtraFacFor, editForm, setEditForm, conc, setConc, concView, setConcView, isDesktop, autoRun, setAutoRun, pickFor, setPickFor, revSugOpen, setRevSugOpen, revSugSel, setRevSugSel, revSugBusy, setRevSugBusy, comboFor, setComboFor, reembFor, setReembFor, detFor, setDetFor, facBuscaQ, setFacBuscaQ, rsConcOpen, setRsConcOpen, modalMov, setModalMov, otrasSet, setOtrasSet, toggleOtras, verGlosa, setVerGlosa, busy, setBusy, costosOfi, setCostosOfi, costosClaudia, setCostosClaudia, valoresBusy, setValoresBusy, valoresInfo, setValoresInfo, leerValores, poolCostos, gcFor, setGcFor, gcCli, setGcCli, gcEnt, setGcEnt, ofiFor, setOfiFor, ofiCat, setOfiCat, ofiSub, setOfiSub, cargoCliLearn, setCargoCliLearn, costoOfiLearn, setCostoOfiLearn, ccFam, setCcFam, ccCat, setCcCat, ccQ, setCcQ, abFam, setAbFam, TOL, fmtM, mesAbbr, cargar, cmap, nameByRut, provByRut, _stripNom, _toksNom, tipoSugerido, costoOfiSugerido, _NOM_COMUN, nombreIdx, sugerencias, tipoContraparte, TAG_STY, CATS_CARGO, CATS_ABONO, RESUELTAS_ABO, ESTRUCT_ABO, setCategoria, marcarNoCliente, desmarcarInterno, resolver, resolverNombre, onFiles, confirmarCarga, onVerificar, identificar, guardarRut, origenInterno, espejoInterno, traspasos, irMov, aplicadoByFactura, cartolaHasta, concByMov, saldoFactura, facturasConSaldo, facturasPorCliente, esConciliable, facturasCliente, _rutsCliente, _rutsFactura, facturasParaMov, mesDiff, candidatos, folioGlosa, mejorCandidato, candidatosMostrar, tieneCand, clientePorMonto, facturaPorMontoManual, sugeridosId, identificarLote, esDescalce, persistPagoFactura, marcaPago, marcaQuien, reconciliar, combos, comboExacto, comboExacto3, cidByMov, reembGastoByCliente, gastoPend, gastosReembolsables, facturaMasGastos, reconciliarCombo, loteOpen, setLoteOpen, loteBusy, setLoteBusy, loteProg, setLoteProg, loteConfirm, setLoteConfirm, siiBuscando, setSiiBuscando, siiResumen, setSiiResumen, siiMovBusy, setSiiMovBusy, siiMovHit, setSiiMovHit, siiMovIng, setSiiMovIng, buscarMovSII, ingresarYConciliar, buscarTodoSII, conciliarLote, grupoPago, reconciliarGrupo, reconciliarFacturaGastos, reconciliarReembolso, marcarGastosReembolsados, devolucionGastos, saldoAFavor, splitAdelantoFondo, fondoExistente, vincularFondo, anticipoExistente, vincularAnticipo, crearFondoProvision, crearFondoPersonal, gastoPorCuentaCliente, ofiCli, catsOficinaConc, costoOficina, costoOficinaSplit, ingresoOficina, comisionPorFacturar, cliPagadorCom, pagaComisiones, comisionAutoOk, cobroSubarriendo, ingFor, setIngFor, ingComFor, setIngComFor, ingProvQ, setIngProvQ, deshacer, CARGO_OFI_GRUPOS, CARGO_SUB_LABEL, cargoPersonas, cargoSugerencia, _glosaHas, matchPresupuesto, matchGrupoPresupuesto, cargoRachaHint, marcarCargoCliente, quitarCargoCliente, cajaChicaMatch, _cierraCaja, abonoCajaChica, deshacerCajaChica, marcarControlCargo, registrarCargoOficina, terc, setTerc, pagoSel, setPagoSel, provDeCargo, bDue, comisPorPagar, preselFifo, fFifoDate, conciliarComisiones, deshacerComisiones, renderPagoProveedor, renderCargoClasificar, conciliarAuto, resumenConc, G, cartolas, aniosDisp, lista, chipCounts, rolChip, estadoChip, tipoMov }
}

// Tarjeta de alerta: días hábiles sin cartola (el banco no envió, o falta cargarla). Amarillo claro; roja a los 3+ días.
// "Sin movimientos" marca esos días como cubiertos (inserta cartola_cargas con 0 movimientos) → deja de avisar (y el correo tampoco disparará).
export function CartolaGapCard({ cartolaHasta, onCargar }){
  const [cov,setCov]=useState(null)
  const [busy,setBusy]=useState(false)
  const [hidden,setHidden]=useState(false)
  useEffect(()=>{ if(DEMO){ setCov(new Set()); return } let alive=true
    supabase.from('cartola_cargas').select('fecha_desde,fecha_hasta').then(({data})=>{ if(!alive) return; const s=new Set(); (data||[]).forEach(r=>{ let d=new Date(String(r.fecha_desde)+'T00:00:00'); const h=new Date(String(r.fecha_hasta)+'T00:00:00'); let g=0; while(d<=h&&g++<400){ s.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`); d.setDate(d.getDate()+1) } }); setCov(s) },()=>{ if(alive) setCov(new Set()) })
    return ()=>{alive=false} },[])
  const gap = useMemo(()=> cov===null?[]:cartolaGapDias(cartolaHasta,cov), [cartolaHasta,cov])
  if(cov===null||hidden||gap.length===0||gap.length>15) return null
  const rojo=gap.length>=3
  const bg=rojo?'#FBE6E4':'#FEF3CE', bd=rojo?'#E7B7B1':'#EBD48A', tx=rojo?C.overdueText:'#7A5E09'
  const mmm=s=>{ const M=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']; const p=String(s).split('-'); return `${+p[2]} ${M[+p[1]-1]}` }
  const lista = gap.length<=3 ? gap.map(mmm).join(', ') : `${gap.length} días`
  const dismiss = async()=>{ if(DEMO){ setHidden(true); return } setBusy(true)
    try{ await supabase.from('cartola_cargas').insert(gap.map(s=>({fecha_desde:s,fecha_hasta:s,movimientos_n:0,origen:'sin_movimientos'}))); setHidden(true) }
    catch(e){ appAlert('No se pudo guardar: '+(e.message||e)) } setBusy(false) }
  return (
    <div style={{width:330,maxWidth:'100%',border:`1px solid ${bd}`,borderRadius:12,background:bg,padding:'12px 13px',marginBottom:12,boxShadow:'0 1px 3px rgba(0,0,0,.04)'}}>
      <div style={{display:'flex',alignItems:'center',gap:8}}>
        <span style={{width:24,height:24,borderRadius:8,background:'#fff',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SIcon n='alert' s={14} c={tx}/></span>
        <span style={{fontSize:13,fontWeight:800,color:tx}}>{rojo?`${gap.length} días sin cartola`:`Faltan ${gap.length} cartola${gap.length!==1?'s':''} del banco`}</span>
        <span onClick={()=>setHidden(true)} style={{marginLeft:'auto',color:C.textSoft,cursor:'pointer',fontSize:15,lineHeight:1}}><Gl n='x'/></span>
      </div>
      <div style={{fontSize:11,color:C.muted,margin:'5px 0 10px',lineHeight:1.45}}>Última: <b style={{color:C.text}}>{mmm(cartolaHasta)}</b> · sin <b style={{color:C.text}}>{lista}</b>.</div>
      <div style={{display:'flex',gap:7}}>
        <button disabled={busy} onClick={dismiss} style={{flex:1,fontSize:11,fontWeight:700,borderRadius:8,padding:'6px 11px',cursor:busy?'default':'pointer',border:`1px solid ${C.border}`,background:'#fff',color:C.muted,opacity:busy?.6:1}}>Sin movimientos</button>
        <button onClick={onCargar} style={{flex:1,fontSize:11,fontWeight:700,borderRadius:8,padding:'6px 11px',cursor:'pointer',border:'none',background:C.accent,color:'#fff'}}>Cargar cartola</button>
      </div>
    </div>
  )
}

export function ConciliacionView({setTercerosRoot=null,openCajaChicaRev=false,onCajaChicaRevConsumed,clients=[],clientEntities=[],billing=[],sales=[],rendiciones=[],setRendiciones,setBilling,anticipos=[],setAnticipos,expenses=[],setExpenses,proveedores=[],pettyCash=[],setPettyCash,user,focusMovId,onFocusConsumed,focusBuscar,onBuscarConsumed,openProp,onPropOpened,onClose,onOpenClientFicha,onCotejarSII,onBuscarSII,onIngresarSII,onFacturaPagada,onOpenFactura,onOpenProveedor}){
  const { devolucionCands, registrarDevolucion, liqParaCargo, enlazarNotaria, EQUIPO_RUT, SOCIO_RUT, CONTADORA_RUT, movs, setMovs, loading, setLoading, importing, setImporting, prog, setProg, reportes, setReportes, cargaPreview, setCargaPreview, verifRes, setVerifRes, verificando, setVerificando, aliases, setAliases, sub, setSub, cobradasOpen, setCobradasOpen, cuentaF, setCuentaF, anioF, setAnioF, mesF, setMesF, concYCol, setConcYCol, concMOpen, setConcMOpen, respF, setRespF, facChip, setFacChip, facMyc, setFacMyc, devolFor, setDevolFor, devolSel, setDevolSel, respByCid, respDisp, q, setQ, orden, setOrden, verCartolas, setVerCartolas, verCarga, setVerCarga, verFiltros, setVerFiltros, editMov, setEditMov, tagFor, setTagFor, tipoAprendido, setTipoAprendido, splitMov, setSplitMov, splitAdel, setSplitAdel, fondoFor, setFondoFor, otroFor, setOtroFor, otraFacFor, setOtraFacFor, editForm, setEditForm, conc, setConc, concView, setConcView, isDesktop, autoRun, setAutoRun, pickFor, setPickFor, revSugOpen, setRevSugOpen, revSugSel, setRevSugSel, revSugBusy, setRevSugBusy, comboFor, setComboFor, reembFor, setReembFor, detFor, setDetFor, facBuscaQ, setFacBuscaQ, rsConcOpen, setRsConcOpen, modalMov, setModalMov, otrasSet, setOtrasSet, toggleOtras, verGlosa, setVerGlosa, busy, setBusy, costosOfi, setCostosOfi, costosClaudia, setCostosClaudia, valoresBusy, setValoresBusy, valoresInfo, setValoresInfo, leerValores, poolCostos, gcFor, setGcFor, gcCli, setGcCli, gcEnt, setGcEnt, ofiFor, setOfiFor, ofiCat, setOfiCat, ofiSub, setOfiSub, cargoCliLearn, setCargoCliLearn, costoOfiLearn, setCostoOfiLearn, ccFam, setCcFam, ccCat, setCcCat, ccQ, setCcQ, abFam, setAbFam, TOL, fmtM, mesAbbr, cargar, cmap, nameByRut, provByRut, _stripNom, _toksNom, tipoSugerido, costoOfiSugerido, _NOM_COMUN, nombreIdx, sugerencias, tipoContraparte, TAG_STY, CATS_CARGO, CATS_ABONO, RESUELTAS_ABO, ESTRUCT_ABO, setCategoria, marcarNoCliente, desmarcarInterno, resolver, resolverNombre, onFiles, confirmarCarga, onVerificar, identificar, guardarRut, origenInterno, espejoInterno, traspasos, irMov, aplicadoByFactura, cartolaHasta, concByMov, saldoFactura, facturasConSaldo, facturasPorCliente, esConciliable, facturasCliente, _rutsCliente, _rutsFactura, facturasParaMov, mesDiff, candidatos, folioGlosa, mejorCandidato, candidatosMostrar, tieneCand, clientePorMonto, facturaPorMontoManual, sugeridosId, identificarLote, esDescalce, persistPagoFactura, marcaPago, marcaQuien, reconciliar, combos, comboExacto, comboExacto3, cidByMov, reembGastoByCliente, gastoPend, gastosReembolsables, facturaMasGastos, reconciliarCombo, loteOpen, setLoteOpen, loteBusy, setLoteBusy, loteProg, setLoteProg, loteConfirm, setLoteConfirm, siiBuscando, setSiiBuscando, siiResumen, setSiiResumen, siiMovBusy, setSiiMovBusy, siiMovHit, setSiiMovHit, siiMovIng, setSiiMovIng, buscarMovSII, ingresarYConciliar, buscarTodoSII, conciliarLote, grupoPago, reconciliarGrupo, reconciliarFacturaGastos, reconciliarReembolso, marcarGastosReembolsados, devolucionGastos, saldoAFavor, splitAdelantoFondo, fondoExistente, vincularFondo, anticipoExistente, vincularAnticipo, crearFondoProvision, crearFondoPersonal, gastoPorCuentaCliente, ofiCli, catsOficinaConc, costoOficina, costoOficinaSplit, ingresoOficina, comisionPorFacturar, cliPagadorCom, pagaComisiones, comisionAutoOk, cobroSubarriendo, ingFor, setIngFor, ingComFor, setIngComFor, ingProvQ, setIngProvQ, deshacer, CARGO_OFI_GRUPOS, CARGO_SUB_LABEL, cargoPersonas, cargoSugerencia, _glosaHas, matchPresupuesto, matchGrupoPresupuesto, cargoRachaHint, marcarCargoCliente, quitarCargoCliente, cajaChicaMatch, _cierraCaja, abonoCajaChica, deshacerCajaChica, marcarControlCargo, registrarCargoOficina, terc, setTerc, pagoSel, setPagoSel, provDeCargo, bDue, comisPorPagar, preselFifo, fFifoDate, conciliarComisiones, deshacerComisiones, renderPagoProveedor, renderCargoClasificar, conciliarAuto, resumenConc, G, cartolas, aniosDisp, lista, chipCounts, rolChip, estadoChip, tipoMov } = useConciliacionModel({ setTercerosRoot, clients, clientEntities, billing, sales, setRendiciones, setBilling, anticipos, setAnticipos, expenses, setExpenses, proveedores, pettyCash, setPettyCash, user, focusMovId, onFocusConsumed, focusBuscar, onBuscarConsumed, openProp, onPropOpened, onClose, onOpenClientFicha, onCotejarSII, onBuscarSII, onIngresarSII, onFacturaPagada, onOpenProveedor })
  // Hub de entrada (patrón del hub de Gastos): landing de tarjetas que rutea a las secciones ya existentes.
  // Pura presentación — no toca cifras (reusa resumenConc/G/cartolas y los predicados del modelo).
  const [noFondoRend,setNoFondoRend] = useState(()=>new Set())   // abonos donde se tocó «Es otra cosa» (la propuesta de fondo no vuelve a salir hasta recargar)
  const [comPF,setComPF] = useState({soc:'',orig:''})   // Comisión por facturar: socio y quién la generó (detalle del depósito)
  const [ingProvCambiar,setIngProvCambiar] = useState(null)   // Comisión Recibida: mov id en que el usuario pidió elegir otro tercero (ignora el sugerido)
  const [deskSel,setDeskSel] = useState(()=>viewMemLeer('concView')?.deskSel??null)   // escritorio: movimiento elegido en la bandeja {id,idx}; si sale de la lista (se resolvió) pasa al que quedó en su lugar
  useEffect(()=>{ if(focusMovId) setDeskSel({id:focusMovId,idx:0}) },[focusMovId])   // escritorio: un salto "ver en Banco" deja elegido ESE movimiento
  const [montoFacFor,setMontoFacFor] = useState(null)   // abono sin cliente con 2+ facturas del mismo monto: cuál tiene desplegadas sus opciones (antes no existía en esta vista → ReferenceError)
  const [hubOpen,setHubOpen] = useState(()=>{ const vm=viewMemLeer('concView'); return vm?vm.hubOpen:(!focusMovId&&!openProp&&!focusBuscar) })
  useEffect(()=>{ viewMemGuardar('concView',{hubOpen,deskSel}) },[hubOpen,deskSel])
  useEffect(()=>{ if(focusMovId||openProp||focusBuscar) setHubOpen(false) },[focusMovId,openProp,focusBuscar])
  // "Resolver de a uno" (opción 6): bandeja foco para "Sin identificar" — una tarjeta a la vez con la mejor sugerencia adelante.
  const [unoMode,setUnoMode] = useState(false)
  const [unoSkip,setUnoSkip] = useState(()=>new Set())
  const [unoTotal,setUnoTotal] = useState(0)
  const [verValores,setVerValores] = useState(false)
  // ── Revisión de caja chica (Fase 2): cruza cargas SIN enlace de Martín/Martina con las transferencias del banco (mismo RUT vía EQUIPO_RUT, monto exacto, ±3 días). ──
  const [ccRevOpen,setCcRevOpen] = useState(false)
  useEffect(()=>{ if(!openCajaChicaRev) return; setHubOpen(false); setSub('cargos'); setCcRevOpen(true); onCajaChicaRevConsumed&&onCajaChicaRevConsumed() },[openCajaChicaRev])   // eslint-disable-line
  const [ccBulk,setCcBulk] = useState(false)
  const [ccAuto,setCcAuto] = useState(false)   // interruptor del barrido diario (edge fn); persiste en learnings config 'caja_chica_auto'
  useEffect(()=>{ if(DEMO) return; supabase.from('learnings').select('value').eq('kind','config').eq('key','caja_chica_auto').order('updated_at',{ascending:false}).limit(1).maybeSingle().then(({data})=>{ if(data&&String(data.value).trim()==='on') setCcAuto(true) },()=>{}) },[])
  const setCcAutoGlob = async(v)=>{ const prev=ccAuto; setCcAuto(v); if(DEMO) return; try{ await supabase.from('learnings').delete().eq('kind','config').eq('key','caja_chica_auto'); await supabase.from('learnings').insert({kind:'config',key:'caja_chica_auto',value:v?'on':'off'}) }catch(e){ setCcAuto(prev); appAlert('No se pudo guardar: '+e.message) } }
  const CC_PERSONAS = Object.values(EQUIPO_RUT||{})
  const [ccNoCaja,setCcNoCaja] = useState(()=>new Set())   // transferencias que el miembro (o el admin) marcó "no es caja chica" (learnings cc_no_caja)
  useEffect(()=>{ if(DEMO) return; supabase.from('learnings').select('key').eq('kind','cc_no_caja').then(({data})=>setCcNoCaja(new Set((data||[]).map(r=>String(r.key)))),()=>{}) },[])
  // Calce con la regla única calceCajaChica (mismo monto + mismo día o el anterior = automático; lo demás se confirma).
  const revisionCC = useMemo(()=>{
    const conciliados=new Set(Object.keys(concByMov||{}).filter(k=>concByMov[k]?.length))
    const sueldos={}; (movs||[]).forEach(m=>{ const per=EQUIPO_RUT[crNormRut(m.rut_contraparte)]; if(m.tipo==='cargo'&&per&&concByMov[m.id]?.length){ const k=_norm(per); (sueldos[k]=sueldos[k]||new Set()).add(Math.round(Math.abs(m.monto||0))) } })
    const r=calceCajaChica(pettyCash, (movs||[]).filter(m=>!ccNoCaja.has(String(m.id))), {conciliados, sueldos})
    return { ...r, listas:r.auto, porRevisar:r.sugeridos }
  },[pettyCash,movs,concByMov,EQUIPO_RUT,ccNoCaja])   // eslint-disable-line
  // Transferencias contadas dos veces: ligadas a una caja chica y además conciliadas, por más de lo que mide el movimiento.
  // Partirla (caja + gasto que suman la transferencia) es válido; la base ya impide crear nuevas dobles (trigger _guard_mov_no_doble).
  const dobleCC = useMemo(()=>{ const byMov={}, out=[]
    ;(pettyCash||[]).forEach(p=>{ if(p.movimiento_id) (byMov[p.movimiento_id]=byMov[p.movimiento_id]||[]).push(p) })
    Object.entries(byMov).forEach(([mid,ps])=>{ const m=(movs||[]).find(x=>String(x.id)===String(mid)); if(!m) return
      const conc=(concByMov[mid]||[]).reduce((a,c)=>a+(Number(c.monto_aplicado)||0),0), pc=ps.reduce((a,p)=>a+Math.abs(Number(p.amount)||0),0)
      if(conc>0&&conc+pc>Math.abs(Number(m.monto)||0)+1) out.push({m,ps,conc,pc}) })
    return out.sort((a,b)=>String(a.m.fecha||'').localeCompare(String(b.m.fecha||''))) },[pettyCash,movs,concByMov])
  const quitarDobleCC = async(x)=>{ const per=x.ps[0]?.user_name||'la persona'
    if(!await appConfirm(`¿Quitar de la caja chica de ${per} la transferencia del ${fmtFechaDMY(x.m.fecha)} (${fmtN(x.pc)})?\n\nYa está conciliada en Banco por ${fmtN(x.conc)}; su caja deja de contarla. Banco no cambia.`)) return
    try{ await logActividad('cajachica.doble_quitada',{tabla:'petty_cash',id:x.ps[0].id,detalle:{title:'Caja chica: transferencia contada dos veces, se quita de la caja',persona:per,monto:Math.round(x.pc),conciliado:Math.round(x.conc),movimiento:x.m.id,filas:x.ps},completo:true})
      if(!DEMO){ const {error}=await supabase.from('petty_cash').delete().in('id',x.ps.map(p=>p.id)); if(error) throw error }
      setPettyCash&&setPettyCash(p=>(p||[]).filter(y=>!x.ps.some(z=>z.id===y.id)))
    }catch(e){ appAlert('No se pudo quitar: '+(e.message||e)) } }
  const marcarNoCajaCC = async(m)=>{ setCcNoCaja(p=>new Set([...p,String(m.id)])); if(DEMO) return; try{ await supabase.from('learnings').delete().eq('kind','cc_no_caja').eq('key',String(m.id)); await supabase.from('learnings').insert({kind:'cc_no_caja',key:String(m.id),value:'admin'}) }catch(_){} }
  // Acciones de confirmación (compuerta). Ajustar/fusionar/dividir dejan la caja = lo transferido, con nota y bitácora; nada se pierde.
  const confirmarCC = async(s)=>{
    if(busy) return
    const [p,q]=s.cajas, [c1,c2]=s.cargos
    const mt = x => Math.round(Math.abs(x.monto||0))
    try{
      if(s.tipo==='ajustar'){
        const nota=`${p.notes||''} · ajustada de ${fmtN(p.amount)} a lo transferido`.trim()
        if(!DEMO){ const {error}=await supabase.from('petty_cash').update({amount:mt(c1),notes:nota}).eq('id',p.id); if(error) throw error }
        const p2={...p,amount:mt(c1),notes:nota}; setPettyCash&&setPettyCash(x=>x.map(y=>y.id===p.id?p2:y)); await enlazarCajaChica(c1,p2)
      } else if(s.tipo==='fusionar'){
        const nota=`${p.notes||''} · + caja ${fmtFechaDMY(q.delivered_at)} ${fmtN(q.amount)}${q.notes?` (${q.notes})`:''}`.trim()
        if(!DEMO){ const {error}=await supabase.from('petty_cash').update({amount:mt(c1),notes:nota}).eq('id',p.id); if(error) throw error
          const {error:e2}=await supabase.from('petty_cash').delete().eq('id',q.id); if(e2) throw e2 }
        const p2={...p,amount:mt(c1),notes:nota}; setPettyCash&&setPettyCash(x=>x.filter(y=>y.id!==q.id).map(y=>y.id===p.id?p2:y)); await enlazarCajaChica(c1,p2)
      } else if(s.tipo==='dividir'){
        const nota=`${p.notes||''} · llegó en dos transferencias`.trim()
        let nueva={user_name:p.user_name,amount:mt(c2),delivered_at:c2.fecha,delivered_by:p.delivered_by||null,notes:`Parte de la caja ${fmtFechaDMY(p.delivered_at)}`}
        if(!DEMO){ const {error}=await supabase.from('petty_cash').update({amount:mt(c1),notes:nota}).eq('id',p.id); if(error) throw error
          const ins=await supabase.from('petty_cash').insert(nueva).select().single(); if(ins.error) throw ins.error; nueva=ins.data } else nueva={...nueva,id:'tmp'+Date.now()}
        const p2={...p,amount:mt(c1),notes:nota}; setPettyCash&&setPettyCash(x=>[nueva,...x.map(y=>y.id===p.id?p2:y)])
        await enlazarCajaChica(c1,p2); await enlazarCajaChica(c2,nueva)
      } else await enlazarCajaChica(c1,p)
      logActividad('cajachica.conciliada_'+s.tipo,{tabla:'petty_cash',id:p.id,detalle:{title:`${p.user_name} · ${s.motivo}`,monto:s.cargos.reduce((a,c)=>a+mt(c),0)}})
    }catch(e){ appAlert('No se pudo conciliar: '+e.message) }
  }
  const enlazarCajaChica = async(cargo,petty)=>{
    if(busy||!cargo||!petty) return
    setBusy(cargo.id)
    try{
      const monto=(cargo.monto||0)-(cargo.monto_conciliado||0), movAplic=(cargo.monto_conciliado||0)+monto, estado=((cargo.monto||0)-movAplic)<=TOL?'conciliado':'parcial'
      if(!DEMO){
        const nota=`${petty.notes||''} · mov:${cargo.id}`.trim()
        const { error:pe } = await supabase.from('petty_cash').update({ notes:nota, movimiento_id:cargo.id }).eq('id',petty.id); if(pe) throw pe
        const { error:me } = await supabase.from('cartola_movimientos').update({ estado, monto_conciliado:movAplic, categoria:'Caja chica' }).eq('id',cargo.id); if(me) throw me
        setPettyCash&&setPettyCash(p=>p.map(x=>x.id===petty.id?{...x,notes:nota,movimiento_id:cargo.id}:x))
      }
      _cierraCaja(cargo,movAplic,estado)
    }catch(e){ appAlert('Error al enlazar: '+e.message) }
    setBusy(null)
  }
  const enlazarTodasCC = async()=>{ if(ccBulk) return; setCcBulk(true); for(const {cargo,petty} of revisionCC.listas){ await enlazarCajaChica(cargo,petty) } setCcBulk(false) }
  // Con el barrido automático encendido, los calces exactos (misma persona y monto, transferencia el mismo día o el anterior) se enlazan
  // apenas la cartola está en el banco, sin esperar al barrido de la mañana. Si el monto es igual a un sueldo ya conciliado a esa persona,
  // calceCajaChica lo deja en "por confirmar" y nunca llega aquí. Cada par se intenta una sola vez (un error no se reintenta en bucle).
  const ccAutoIntentados = useRef(new Set())
  useEffect(()=>{ if(!ccAuto||DEMO||loading||busy||ccBulk) return
    const ls=revisionCC.listas.filter(({cargo})=>!ccAutoIntentados.current.has(String(cargo.id))); if(!ls.length) return
    ls.forEach(({cargo})=>ccAutoIntentados.current.add(String(cargo.id)))
    ;(async()=>{ setCcBulk(true)
      for(const {cargo,petty} of ls){ await enlazarCajaChica(cargo,petty); logActividad('cajachica.conciliada_auto',{tabla:'petty_cash',id:petty.id,detalle:{title:`${petty.user_name} · transferencia ${fmtFechaDMY(cargo.fecha)}`,monto:Math.round(Math.abs(cargo.monto||0))}}) }
      setCcBulk(false) })()
  },[revisionCC,ccAuto,loading,busy,ccBulk])   // eslint-disable-line
  // Fila de una propuesta (por confirmar): caja(s) ↔ transferencia(s) + motivo + la acción que corresponde al tipo.
  // Trazable: cada transferencia del panel abre su movimiento del banco (detalle con glosa, cuenta y conciliación).
  const verMovCC = id => { setCcRevOpen(false); setModalMov(id) }
  const ccTransfLbl = c => { const g=_glosaTransf(c.descripcion); const real=g.fecha&&g.fecha!==_ccDia(c.fecha)
    return <span onClick={e=>{e.stopPropagation();verMovCC(c.id)}} style={{color:C.accent,fontWeight:600,cursor:'pointer',textDecoration:'underline',textDecorationColor:C.border}}>transferencia {fmtFechaDMY(real?g.fecha:c.fecha)}{g.hora?` ${g.hora}`:''} {fmtM(c.monto)}{real?` (banco ${fmtFechaDMY(c.fecha)})`:''}</span> }
  const ccSugRow = (s,i)=>{ const p=s.cajas[0], lbl={exacto:'Es esta ✓',ajustar:'Ajustar y enlazar',fusionar:'Juntar y enlazar',dividir:'Dividir y enlazar'}[s.tipo]; const b=busy&&s.cargos.some(c=>c.id===busy); return (
    <div key={'s'+i} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 11px',border:`1px solid ${C.border}`,background:'#fff',borderRadius:10,marginBottom:7}}>
      {diaGrande(p.delivered_at)}
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:13,fontWeight:700,color:C.text}}>{p.user_name} · {s.cajas.map(c=>`caja ${fmtM(c.amount)}${s.cajas.length>1?` (${fmtFechaDMY(c.delivered_at)})`:''}`).join(' + ')}</div>
        <div style={{fontSize:10,color:C.muted,marginTop:2}}>↔ {s.cargos.map((c,k)=><Fragment key={c.id}>{k?' + ':''}{ccTransfLbl(c)}</Fragment>)} <span style={{color:C.soonText,fontWeight:700}}>· {s.motivo}</span></div>
      </div>
      <button disabled={!!busy} onClick={()=>confirmarCC(s)} style={{fontSize:11,fontWeight:700,color:'#fff',background:C.accent,border:'none',borderRadius:8,padding:'6px 12px',cursor:busy?'default':'pointer',flexShrink:0,whiteSpace:'nowrap'}}>{b?'…':lbl}</button>
    </div>) }
  const ccRow = (petty,cargo,kind,motivo)=> (
    <div key={petty.id} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 11px',border:`1px solid ${kind==='ok'?'#CFE9DD':C.border}`,background:'#fff',borderRadius:10,marginBottom:7}}>
      {diaGrande(petty.delivered_at)}
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:13,fontWeight:700,color:C.text}}>{petty.user_name} · caja chica <span style={{color:C.accent}}>{fmtM(petty.amount)}</span></div>
        <div style={{fontSize:10,color:C.muted,display:'flex',gap:6,flexWrap:'wrap',alignItems:'center',marginTop:2}}>
          {cargo?<><span style={{color:C.textSoft}}>↔</span>{ccTransfLbl(cargo)}<span>· {cargo.rol_cuenta==='gastos'?'Gastos':'Honorarios'}</span></>:null}
          {kind==='rev'&&motivo?<span style={{color:C.soonText,fontWeight:700}}>· {motivo}</span>:null}
        </div>
      </div>
      {cargo
        ? <button disabled={busy===cargo.id} onClick={()=>enlazarCajaChica(cargo,petty)} style={{fontSize:11,fontWeight:700,color:'#fff',background:kind==='ok'?C.greenText:C.accent,border:'none',borderRadius:8,padding:'6px 12px',cursor:'pointer',flexShrink:0,whiteSpace:'nowrap'}}>{busy===cargo.id?'…':(kind==='ok'?'Enlazar':<>Es esta{" "}<Gl n='tick'/></>)}</button>
        : <span style={{fontSize:10,color:C.muted,flexShrink:0,whiteSpace:'nowrap'}}>revisar a mano</span>}
    </div>
  )
  // Escritorio y móvil comparten el HUB de entrada (grilla de tarjetas). Al tocar una tarjeta se entra al interior
  // (en escritorio, el 2-panel rail+lista); el botón "volver" regresa al hub. Antes el escritorio saltaba directo al rail.
  // "Por resolver" — fuente ÚNICA de cifras/desglose (usada por el hub móvil y el rail de escritorio).
  const _hoyPR=Date.now()
  const porResolverMovs = movs.filter(m=> abonoConResto(m) || (m.tipo==='abono' && !m.es_interno && !(concByMov[m.id]?.length) && !RESUELTAS_ABO.includes(m.categoria) && (!m.cliente_id || esConciliable(m))))
  const prN = porResolverMovs.length, prMonto = porResolverMovs.reduce((s,m)=>s+restoAbono(m),0)
  const _sumM = arr => arr.reduce((s,m)=>s+Math.abs(m.monto||0),0)
  const _prSinIdA = porResolverMovs.filter(m=>!m.cliente_id), _prConfA = porResolverMovs.filter(m=>m.cliente_id&&tieneCand(m)), _prDescA = porResolverMovs.filter(m=>m.cliente_id&&!tieneCand(m))
  const prSinId = _prSinIdA.length, prConf = _prConfA.length, prDesc = _prDescA.length
  const pr90 = porResolverMovs.filter(m=>{ const t=m.fecha?new Date(m.fecha+'T12:00').getTime():NaN; return isNaN(t)?false:((_hoyPR-t)/86400000)>90 }).reduce((s,m)=>s+(m.monto||0),0)
  const prSub=[
    {n:prSinId,m:_sumM(_prSinIdA),cv:'sinid',t:'Falta asignar el cliente',s:'no sabemos de quién es el ingreso',act:'Asignar'},
    {n:prConf,m:_sumM(_prConfA),cv:'porconciliar',t:'Por confirmar',s:'la app ya propone quién es',act:'Confirmar'},
    {n:prDesc,m:_sumM(_prDescA),cv:'descalces',t:'Falta la factura',s:'anticipo, fondo o pago parcial',act:'Vincular'},
  ].filter(r=>r.n>0)
  // Identificar por su nombre (la app YA sabe de quién es) y Cargos por clasificar: fuente ÚNICA de conteo + $monto, usada por hub móvil, rail escritorio e interior.
  const sugMonto = (sugeridosId||[]).reduce((s,x)=>s+Math.abs(x.mov?.monto||0),0)
  const cargoClasifMovs = movs.filter(m=> m.tipo==='cargo' && !m.es_interno && !(concByMov[m.id]?.length) && !m.categoria)
  const ccN = cargoClasifMovs.length, ccMonto = _sumM(cargoClasifMovs)
  // "Listo para conciliar" (calces exactos 1:1) — fuente ÚNICA usada por hub móvil, rail escritorio e interior (antes se calculaba inline en el interior).
  const lcData=(()=>{ const pend=(movs||[]).filter(m=>esConciliable(m)&&((m.monto||0)-(m.monto_conciliado||0))>TOL); const cand=[],revisar=[],sinFac=[]; pend.forEach(m=>{ const mej=mejorCandidato(m); if(mej){cand.push({m,f:mej})} else { const cs=candidatos(m); if(cs.length>1)revisar.push(m); else sinFac.push(m) } }); const byFac={}; cand.forEach(x=>{ (byFac[String(x.f.id)]=byFac[String(x.f.id)]||[]).push(x) }); const exactos=[]; cand.forEach(x=>{ if(byFac[String(x.f.id)].length===1) exactos.push(x); else revisar.push(x.m) }); return {exactos,revisar,sinFac} })()
  const listosExactos=lcData.exactos, listosN=listosExactos.length
  const exportConc = ()=>{ try{
      const rows=[['Fecha','Cuenta','Nombre banco','RUT','Cliente','Monto','Estado','Factura']]
      movs.filter(m=>m.tipo==='abono'&&!m.es_interno).sort((a,b)=>(a.fecha||'')<(b.fecha||'')?1:-1).forEach(m=>{ const cc=concByMov[m.id]||[]; const fac=cc.find(c=>c.tipo_destino==='factura'); const fb=fac&&billing.find(b=>String(b.id)===String(fac.factura_id))
        const est=cc.length?(fac?'Conciliado':'Imputado'):(m.cliente_id?'Por conciliar':'Sin identificar')
        rows.push([fmtFechaDMY(m.fecha),m.rol_cuenta==='gastos'?'Gastos':'Honorarios',m.nombre_contraparte||'',m.rut_contraparte||'',cmap[m.cliente_id]||'',m.monto||0,est,fb?`N° ${folioN(fb.invoice_no)||''}`:'']) })
      const csv=rows.map(r=>r.map(c=>{const s=String(c==null?'':c);return /[",\n;]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}).join(';')).join('\n')
      const blob=new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`conciliacion_${new Date().toISOString().slice(0,10)}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),1000)
    }catch(e){ appAlert('No se pudo exportar: '+(e.message||e)) } }
  const concHub = hubOpen ? (()=>{
    const D=isDesktop
    const cDesc=movs.filter(esDescalce).length
    const goHub=fn=>{ fn(); setHubOpen(false) }
    const hubInner=(
      <div style={{maxWidth:D?860:undefined,margin:'0 auto',padding:D?'8px 22px 44px':'2px 6px 30px'}}>
        <div style={{display:'flex',alignItems:'center',gap:8,padding:D?'14px 2px 12px':'16px 8px 10px'}}>
          <button onClick={onClose} style={{background:'none',border:'none',color:C.accent,cursor:'pointer',fontSize:20,lineHeight:1,padding:'0 4px 0 0'}}><Gl n='chevL'/></button>
          <div style={{fontSize:D?22:20,fontWeight:600,color:C.text,fontFamily:"'DM Sans',sans-serif",letterSpacing:-.4}}>Conciliación bancaria</div>
          {loading&&<span style={{marginLeft:'auto',fontSize:11,color:C.muted}}>Cargando…</span>}
        </div>
        <CartolaGapCard cartolaHasta={cartolaHasta} onCargar={()=>{setHubOpen(false);setVerCarga(true)}}/>
        {/* Estructura A: Abonos/Cargos (mirar, lo que entró/salió) + UNA "Por resolver" (trabajar) + Sin respaldo/Cargar cartola (utilidades). Sin métricas de vanidad; sin duplicar sin identificar/descalces como tarjetas. */}
        {(()=>{
          // Grilla de tarjetas (todas del mismo tamaño, ninguna full-width). Orden: Abonos·Cargos / Por confirmar·Conciliados / Sin respaldo·Cargar cartola.
          const conciliadosN=(movs||[]).filter(m=>m.tipo==='abono'&&concByMov[m.id]?.length).length
          const c2=(sqbg,stroke,icon,titulo,tCol,valor,valCol,sub,onClick,opts={})=>(
            <div onClick={onClick} style={{cursor:'pointer',background:opts.bg||C.surface,border:`1px solid ${opts.border||C.border}`,borderRadius:12,padding:D?'12px 13px':'11px 12px',position:'relative',minHeight:D?90:80}}>
              {opts.badge!=null?<span style={{position:'absolute',top:9,right:11,fontSize:15,fontWeight:800,color:valCol}}>{opts.badge}</span>:<span style={{position:'absolute',top:9,right:11,color:C.textSoft,fontSize:12}}><Gl n='chevron'/></span>}
              <span style={{width:28,height:28,borderRadius:8,background:sqbg,display:'inline-flex',alignItems:'center',justifyContent:'center',marginBottom:7}}><SIcon n={icon} s={16} c={stroke}/></span>
              <div style={{fontSize:10,fontWeight:700,letterSpacing:.5,textTransform:'uppercase',color:tCol,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{titulo}</div>
              {valor?<div style={{fontSize:opts.big?18:16,fontWeight:800,letterSpacing:-.3,marginTop:4,color:valCol,fontVariantNumeric:'tabular-nums'}}>{valor}</div>:null}
              <div style={{fontSize:10,color:C.textSoft,marginTop:valor?1:6,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{sub}</div>
            </div>)
          return <>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:D?12:8,marginBottom:D?12:9}}>
              {c2(C.greenBg,C.greenText,'exchange','Abonos',C.greenText,String(G.nAbo),C.greenText,'movimientos del banco',()=>goHub(()=>{setSub('abonos');setConcView('todos')}))}
              {c2(ccN>0?C.soonBg:C.bgSoft,ccN>0?C.soonText:C.accent,'wallet','Cargos',ccN>0?C.soonText:C.accent,String(ccN>0?ccN:G.nCar),ccN>0?C.soonText:C.accent,ccN>0?`por clasificar · ${fmtShort(ccMonto)}`:'movimientos del banco',()=>goHub(()=>{setSub('cargos');setConcView(ccN>0?'clasificar':'todos')}))}
              {prN>0
                ? c2(C.surface,C.overdueText,'alert','Por resolver',C.overdueText,fmtShort(prMonto),C.overdueText,'calza o la app propone — confirma',()=>goHub(()=>{setSub('abonos');setConcView('porresolver')}),{bg:C.overdueBg,border:'#F3C9C4',badge:prN,big:true})
                : c2(C.greenBg,C.greenText,'check','Por resolver',C.greenText,'',C.greenText,'todo cruzado — nada por resolver',()=>goHub(()=>{setSub('abonos');setConcView('todos')}))}
              {c2(C.greenBg,C.greenText,'check','Conciliados',C.greenText,String(conciliadosN),C.greenText,'ya cruzados con su factura',()=>goHub(()=>{setSub('abonos');setConcView('conciliados')}))}
              {c2(C.azulBg,C.accent,'receipt','Sin respaldo',C.accent,'',C.accent,'facturas pagadas sin banco',()=>goHub(()=>setCobradasOpen(true)))}
              {c2(C.tealBg,C.tealText,'file','Cargar cartola',C.tealText,'',C.tealText,cartolas.length?`${cartolas.length} cargada${cartolas.length!==1?'s':''} · subir`:'subir · verificar',()=>goHub(()=>setVerCarga(true)))}
            </div>
            <div style={{display:'flex',justifyContent:'flex-end',marginTop:2}}>
              <button onClick={exportConc} style={{fontSize:11,fontWeight:600,color:C.accent,background:'none',border:`1px solid ${C.border}`,borderRadius:8,padding:'6px 12px',cursor:'pointer'}}>Exportar estado (CSV) ↓</button>
            </div>
          </>
        })()}
      </div>
    )
    if(D) return <div style={{height:'calc(100vh - 66px)',overflowY:'auto',background:C.bg}}>{hubInner}</div>
    return <div style={{background:C.bg,minHeight:'100%'}}>{hubInner}</div>
  })() : null
  // OJO Reglas de Hooks: el `return concHub` va MÁS ABAJO, después de TODOS los hooks (ccAutoRef/traspasosAuto/useEffect),
  // para que esos hooks se llamen SIEMPRE (antes estaba aquí y saltaba 3 hooks en el hub → crash "más hooks que antes" al entrar al detalle).
  // "Conciliar cobradas · cartola" es PÁGINA (no modal): su return va MÁS ABAJO, después de TODOS los hooks (igual que hubOpen) — NUNCA aquí, saltaría los 3 hooks siguientes ("fewer hooks").
  // Opción A — el interior se enfoca en la tarjeta que abriste: el header ES el contexto (icono + nombre + conteo),
  // y NO se repiten los tiles "Por resolver" (eso ya lo dijo la tarjeta). Cambiar de foco = una línea de texto.
  // El overview (tarjeta "Abonos", concView==='todos') queda idéntico → el móvil no se rompe.
  const FOCOS={
    porresolver:{ic:'alert',l:'Por resolver',col:C.overdueText,bg:C.overdueBg},
    porconciliar:{ic:'exchange',l:'Por conciliar',col:C.soonText,bg:C.soonBg},
    sinid:{ic:'id',l:'Sin identificar',col:C.overdueText,bg:C.overdueBg},
    descalces:{ic:'alert',l:'Descalces',col:C.soonText,bg:C.soonBg},
    conciliados:{ic:'check',l:'Conciliados',col:C.greenText,bg:C.greenBg},
  }
  const focoKey = sub==='cargos' ? 'cargos' : (concView!=='todos'?concView:null)
  const focused = !!focoKey
  const focoMeta = focoKey==='cargos' ? {ic:'wallet',l:'Cargos',col:C.accent,bg:C.azulBg} : FOCOS[focoKey]
  const focoSum = lista.reduce((s,m)=>s+(m.monto||0),0)
  // Fuente ÚNICA de la sugerencia de cliente para un abono (misma que usa la fila del detalle): por nombre → por monto (factura calzada) → por monto (única emitida sin pago).
  const sugMov = (m)=>{ const nomDe=cid=>cmap[cid]||clients.find(c=>String(c.id)===String(cid))?.name||'cliente'
    // Señal más fuerte: el banco nombra el folio en la glosa ("PAGO FACTURA 328") → esa factura (única) y su cliente.
    const fg=folioGlosa(m); if(fg){ const b=(billing||[]).find(x=>!x.deleted_at&&x.client_id&&String(folioN(x.invoice_no))===String(fg)&&saldoFactura(x)>TOL); if(b) return {cid:b.client_id, nombre:nomDe(b.client_id), via:'glosa', f:b} }
    if(sugerencias[m.id]&&cmap[sugerencias[m.id]]) return {cid:sugerencias[m.id], nombre:cmap[sugerencias[m.id]], via:'nombre', f:null}
    const cm=clientePorMonto(m); if(cm) return {cid:cm.cid, nombre:nomDe(cm.cid), via:'monto', f:cm.factura}
    const fm=facturaPorMontoManual(m); if(fm.length===1){ const f=fm[0]; return {cid:f.client_id, nombre:nomDe(f.client_id), via:'monto', f} }
    return null }
  // 8b — sugerencia del CARGO en la fila cerrada (antes solo dentro de renderCargoClasificar, al abrir). Reusa cargoSugerencia/matchGrupoPresupuesto y los confirm que ya aprenden por RUT.
  const cargoInlineSug = (m) => {
    const stop=e=>e.stopPropagation()
    const lq=liqParaCargo(m)
    if(lq) return (
      <div onClick={stop} style={{marginTop:8,background:'#FBF3EF',border:'1px solid #F1DDD2',borderRadius:10,padding:'8px 10px',display:'flex',alignItems:'center',gap:8}}>
        <div style={{flex:1,minWidth:0}}><div style={{fontSize:11,fontWeight:700,color:C.coralText,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>Notaría · liquidación del {fmtFechaDMY(lq.liq.created_at)} · {lq.liq.n_gastos||0} OT</div><div style={{fontSize:10,color:C.coralText,marginTop:1}}>{lq.exacto?'mismo monto':`liquidación ${fmtM(lq.liq.total)} · diferencia ${fmtM(Math.abs(lq.dif))}`}</div></div>
        <button disabled={busy===m.id} onClick={()=>enlazarNotaria(m,lq.liq)} style={{fontSize:11,fontWeight:700,color:C.surface,background:C.coralText,border:'none',borderRadius:8,padding:'5px 12px',cursor:'pointer',flexShrink:0}}>Enlazar</button>
      </div>)
    const grupo=matchGrupoPresupuesto(m), sug=cargoSugerencia(m)
    if(grupo&&(!sug||sug.fam!=='oficina')) return (
      <div onClick={stop} style={{marginTop:8,background:C.greenBg,border:'1px solid #CFE9DD',borderRadius:10,padding:'8px 10px',display:'flex',alignItems:'center',gap:8}}>
        <div style={{flex:1,minWidth:0}}><div style={{fontSize:11,fontWeight:700,color:C.greenText}}>Pago agrupado · {grupo.items.length} costos de oficina</div><div style={{fontSize:10,color:C.greenText,marginTop:1}}>calza con tu presupuesto · suma exacta</div></div>
        <button disabled={busy===m.id} onClick={()=>costoOficinaSplit(m,grupo.items)} style={{fontSize:11,fontWeight:700,color:'#fff',background:C.greenText,border:'none',borderRadius:8,padding:'5px 12px',cursor:busy===m.id?'default':'pointer',flexShrink:0}}>Repartir en {grupo.items.length}</button>
      </div>)
    if(!sug) return null
    if(sug.ambiguoCaja) return (
      <div onClick={stop} style={{marginTop:8,background:C.tealBg,border:'1px solid #BFE6E3',borderRadius:10,padding:'8px 10px',display:'flex',alignItems:'center',gap:8}}>
        <div style={{flex:1,minWidth:0}}><div style={{fontSize:11,fontWeight:700,color:C.tealText,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>Cargo a {sug.persona} · ¿caja chica o sueldo?</div><div style={{fontSize:10,color:C.tealText,marginTop:1}}>tiene caja chica — elige tú</div></div>
        <button disabled={busy===m.id} onClick={()=>setModalMov(m.id)} style={{fontSize:11,fontWeight:700,color:'#fff',background:C.tealText,border:'none',borderRadius:8,padding:'5px 12px',cursor:'pointer',flexShrink:0}}>Elegir</button>
      </div>)
    if(sug.fam==='oficina'){
      const path=`${sug.category}${sug.sub?` › ${sug.sub}`:''}`, canConfirm=!!sug.sub||!CARGO_SUB_LABEL[sug.category]
      const viaTxt=sug.via==='RUT'?'por el RUT · siempre lo clasificas así':sug.via==='presupuesto'?'calza con tu presupuesto':'de la glosa'
      return (
        <div onClick={stop} style={{marginTop:8,background:C.greenBg,border:'1px solid #CFE9DD',borderRadius:10,padding:'8px 10px',display:'flex',alignItems:'center',gap:8}}>
          <div style={{flex:1,minWidth:0}}><div style={{fontSize:11,fontWeight:700,color:C.greenText,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>Gasto Oficina <Gl n='chevron'/> {path}</div><div style={{fontSize:10,color:C.greenText,marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}><Sparkle/> {viaTxt}</div></div>
          <button disabled={busy===m.id} onClick={canConfirm?()=>registrarCargoOficina(m,sug.category,sug.sub||null):()=>setModalMov(m.id)} style={{fontSize:11,fontWeight:700,color:'#fff',background:C.greenText,border:'none',borderRadius:8,padding:'5px 12px',cursor:'pointer',flexShrink:0}}>{canConfirm?'Confirmar':'Elegir'}</button>
        </div>)
    }
    const cnm=cmap[sug.clientId]||'cliente'
    return (
      <div onClick={stop} style={{marginTop:8,background:'#FBF3EF',border:'1px solid #F1DDD2',borderRadius:10,padding:'8px 10px',display:'flex',alignItems:'center',gap:8}}>
        <div style={{flex:1,minWidth:0}}><div style={{fontSize:11,fontWeight:700,color:C.coralText,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{cnm}</div><div style={{fontSize:10,color:C.coralText,marginTop:1}}>gasto de cliente · de la glosa · solo control</div></div>
        <button disabled={busy===m.id} onClick={()=>marcarCargoCliente(m,sug.clientId)} style={{fontSize:11,fontWeight:700,color:'#fff',background:C.coralText,border:'none',borderRadius:8,padding:'5px 12px',cursor:'pointer',flexShrink:0}}>Confirmar</button>
      </div>)
  }
  // Traspaso interno SEGURO: marca como interno SOLO este movimiento (la pata enmascarada por BICE que duplica plata ya conciliada en la otra cuenta),
  // sale de la bandeja de ingresos. NO toca el pago real del cliente en la otra cuenta (por eso NO usa setCategoria, cuyo espejoInterno marcaría también ese pago). Reversible con desmarcarInterno.
  const marcarTraspasoInterno = async(m)=>{
    setBusy(m.id)
    try{
      if(!DEMO){ const { error } = await supabase.from('cartola_movimientos').update({es_interno:true,estado:'interno',categoria:null}).eq('id',m.id); if(error) throw error }
      setMovs(p=>p.map(x=>x.id===m.id?{...x,es_interno:true,estado:'interno',categoria:null}:x))
    }catch(e){ appAlert('Error: '+e.message) }
    setBusy(null)
  }
  // Traspaso interno "sweep": abono enmascarado (BICE, sin RUT, glosa "de cliente…beneficiario") que calza EXACTO con un abono YA
  // conciliado de un cliente en la OTRA cuenta, con el pago del cliente PRIMERO (fecha <=). Es el mismo dinero moviéndose entre las 2
  // cuentas del estudio. Devuelve {cliente, gap} (días entre el pago del cliente y el traspaso) o null.
  const traspasoSweep = (m)=>{ if(m.rut_contraparte||m.es_interno) return null
    const d=(m.descripcion||'').toLowerCase(); if(!(/\bde cliente\b/.test(d) && /beneficiario/.test(d))) return null
    const c=(movs||[]).find(x=> x.id!==m.id && x.tipo==='abono' && x.rol_cuenta!==m.rol_cuenta && (x.monto||0)===(m.monto||0) && x.cliente_id && (concByMov[x.id]?.length) && x.fecha && m.fecha && new Date(String(x.fecha).slice(0,10))<=new Date(String(m.fecha).slice(0,10)))
    if(!c) return null
    return { cliente: cmap[c.cliente_id]||'un cliente', gap: Math.round((new Date(String(m.fecha).slice(0,10)).getTime()-new Date(String(c.fecha).slice(0,10)).getTime())/86400000) }
  }
  // Auto-marcado: los sweep con el pago del cliente primero y a <=7 dias se marcan SOLOS (alta confianza, single-leg, reversible). >7 dias => queda la opcion manual.
  const ccAutoRef = useRef(new Set())
  const traspasosAuto = useMemo(()=> (movs||[]).filter(m=>{ const s=traspasoSweep(m); return s && s.gap<=7 }), [movs,concByMov])   // eslint-disable-line
  useEffect(()=>{ if(DEMO) return; traspasosAuto.forEach(m=>{ if(!ccAutoRef.current.has(m.id)){ ccAutoRef.current.add(m.id); marcarTraspasoInterno(m) } }) }, [traspasosAuto])   // eslint-disable-line
  // Conciliar varias = PÁGINA (antes modal): misma compuerta antes de tocar plata, con la foto de los calces y la bitácora del banco.
  if(loteConfirm) return <div style={isDesktop?{height:'calc(100vh - 66px)',overflowY:'auto',background:C.bg}:undefined}><FlujoPagina origen='Banco' titulo='Conciliar varias' onBack={()=>!loteBusy&&setLoteConfirm(null)} maxW={900}>
    {loteBusy&&<div style={{background:C.azulBg,color:C.accent,borderRadius:10,padding:'9px 12px',fontSize:12.5,fontWeight:600,marginBottom:10}}>Conciliando {loteProg} de {loteConfirm.length}…</div>}
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:'12px 14px'}}><ConciliarLoteModal rows={loteConfirm} cmap={cmap} clients={clients} onClose={()=>!loteBusy&&setLoteConfirm(null)} onConfirm={(sel)=>conciliarLote(sel)}/></div>
    <div style={{marginTop:12}}><BitacoraLista prefijo='banco.' titulo='Historial de conciliaciones en lote' etiquetas={{'banco.conciliar_varias':'Pagos conciliados en lote'}} limite={10}/></div>
  </FlujoPagina></div>
  if(cobradasOpen) return <CobradasSinRespaldoPage billing={billing} movs={movs} clients={clients} clientEntities={clientEntities} aplicadoByFactura={aplicadoByFactura} onConciliar={reconciliar} busy={busy} onOpenClientFicha={onOpenClientFicha} onClose={()=>setCobradasOpen(false)}/>   // ← movido aquí: después de TODOS los hooks (igual que hubOpen); evita "fewer hooks"
  if(hubOpen) return concHub   // ← movido aquí: recién después de TODOS los hooks (ver nota arriba). Nunca poner un return entre hooks.
  // "Por resolver" accionable: acción por fila en el abono CERRADO según su etapa (sin cliente → Es X ✓ / Asignar; por confirmar → Conciliar N°X; sin factura → Imputar). Reusa sugMov/identificar/crearFondoPersonal/reconciliar/mejorCandidato. El buscador vive detrás de "Asignar"/"Otro" (abre la fila).
  const abonoInlineAcc = (m) => {
    const stop=e=>e.stopPropagation()
    const bG={fontSize:11,fontWeight:700,color:'#fff',background:C.greenText,border:'none',borderRadius:8,padding:'5px 11px',cursor:busy===m.id?'default':'pointer',whiteSpace:'nowrap'}
    const bO={fontSize:11,fontWeight:700,color:C.accent,background:'transparent',border:`1px solid ${C.accent}`,borderRadius:8,padding:'5px 11px',cursor:'pointer',whiteSpace:'nowrap'}
    const bGh={fontSize:10,fontWeight:600,color:C.muted,background:C.bgSoft,border:`1px solid ${C.border}`,borderRadius:8,padding:'5px 10px',cursor:'pointer',whiteSpace:'nowrap'}
    // Glosa enmascarada por BICE (sin remitente): pista para identificar SIN ocultar plata. B = pago de cliente ("a terceros a cuenta propia"); C = ambiguo ("de CLIENTE→BENEFICIARIO", posible traspaso interno gastos↔honorarios). El interno "entre cuentas propias"/"Liberona→Liberona" ya lo marca solo el parser.
    const gmI = (()=>{ if(m.rut_contraparte) return null; const d=(m.descripcion||'').toLowerCase()
      const esCli=/transf\. a terceros/.test(d) && /(1403834|1383922|liberona escala)/.test(d)
      const esAmb=/\bde cliente\b/.test(d) && /beneficiario/.test(d)
      if(!esCli && !esAmb) return null
      const sw=esAmb?traspasoSweep(m):null; const sweep=sw?sw.cliente:null
      const txt = esCli ? 'Pago de cliente · BICE ocultó al remitente' : sweep ? `Traspaso interno · calza con el pago de ${sweep}${sw.gap>0?` (hace ${sw.gap} d)`:''} en la otra cuenta` : 'Remitente oculto (BICE) · ¿interno o cliente?'
      return {esCli,esAmb,sweep,gap:sw?sw.gap:null,node:<div title="El banco no imprime quién envió; asigna por el monto o tu memoria" style={{fontSize:9.5,fontWeight:700,color:esCli?C.azulInfo:C.soonText,background:esCli?C.azulBg:C.soonBg,borderRadius:20,padding:'2px 8px',display:'inline-block',whiteSpace:'nowrap'}}>{txt}</div>} })()
    const gm = gmI?.node
    // Marcar traspaso interno (movimiento entre las 2 cuentas propias del estudio) — la opción que faltaba. Cuando calza EXACTO con un pago ya conciliado (sweep), va como acción PRIMARIA en un toque.
    const intBtn = gmI?.esAmb ? <button disabled={busy===m.id} onClick={()=>marcarTraspasoInterno(m)} style={gmI.sweep?bG:bGh} title={gmI.sweep?`Calza con el pago de ${gmI.sweep} en la otra cuenta BICE — es el mismo dinero moviéndose entre cuentas de la oficina`:'Marcar como movimiento entre las cuentas propias de la oficina'}>{gmI.sweep?<><Gl n='tick'/>{" "}Es traspaso interno</>:'Marcar traspaso interno'}</button> : null
    const wrap=kids=><div onClick={stop} style={{marginTop:7}}>{gm}<div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center',marginTop:gm?6:0}}>{kids}</div></div>
    if(!m.cliente_id){
      const sc=sugMov(m)
      if(gmI?.sweep) return wrap(<>{intBtn}<button onClick={()=>setModalMov(m.id)} style={bGh}>Es de un cliente <Gl n='chevron'/></button></>)
      if(sc) return wrap(<><button disabled={busy===m.id} onClick={()=>identificar(m,sc.cid,true)} style={bG}>Es {(sc.nombre||'').length>16?(sc.nombre.slice(0,16)+'…'):sc.nombre} <Gl n='tick'/></button><button onClick={()=>setModalMov(m.id)} style={bGh}>Otro <Gl n='chevron'/></button>{intBtn}</>)
      return wrap(<><button onClick={()=>setModalMov(m.id)} style={bO}>Asignar cliente</button><button onClick={()=>{ setModalMov(m.id); setAbFam(p=>({...p,[m.id]:'oficina'})) }} title='Subarriendo, comisión recibida, reembolso u otro ingreso de la oficina' style={bO}>Ingreso de oficina <Gl n='chevron'/></button><span onClick={stop} style={{display:'inline-flex',alignItems:'center',gap:4}}><span style={{fontSize:9,color:C.textSoft}}>o fondo:</span><select disabled={busy===m.id} value='' onChange={e=>{ const p=e.target.value; e.target.value=''; if(p) crearFondoPersonal(m,p) }} style={{fontSize:10,fontWeight:600,border:`1px solid ${C.border}`,borderRadius:6,padding:'3px 6px',background:'#fff',color:C.accent,cursor:'pointer'}}><option value=''>equipo…</option>{['Cristóbal','Erasmo','Martín','Martina','Rodrigo'].map(p=><option key={p} value={p}>{p}</option>)}</select></span>{intBtn}</>)
    }
    if(tieneCand(m)){ const f=mejorCandidato(m)||candidatosMostrar(m)[0]; if(f) return wrap(<><button disabled={busy===m.id} onClick={()=>reconciliar(m,f,'manual')} style={bG}>Conciliar N° {folioN(f.invoice_no)||'—'}</button><button onClick={()=>setModalMov(m.id)} style={bGh}>Ver <Gl n='chevron'/></button></>) }
    const t=Math.abs(m.monto||0); const parc=facturasParaMov(m).map(f=>({f,saldo:saldoFactura(f)})).filter(x=>x.saldo>t).sort((a,b)=>(a.f.issued_at||'').localeCompare(b.f.issued_at||''))[0]
    if(parc) return wrap(<><button disabled={busy===m.id} onClick={()=>reconciliar(m,parc.f,'manual')} style={bO}>Imputar a N° {folioN(parc.f.invoice_no)||'—'}</button><button onClick={()=>setModalMov(m.id)} style={bGh}>Otra opción <Gl n='chevron'/></button></>)
    return wrap(<button onClick={()=>setModalMov(m.id)} style={bO}>Resolver <Gl n='chevron'/></button>)
  }
  // Selector "Ingreso de oficina" (Comisión Recibida / Subarrendamiento / Reembolso a la oficina / Otros) — fuente ÚNICA, reusada
  // en el abono CON cliente (dentro del calce) y en el abono SIN cliente (Rodrigo que paga subarriendo, remitente oculto por BICE):
  // el ingreso de oficina no necesita cliente, así que vive fuera del gate esConciliable. `resto` solo se muestra si viene.
  // Tercero que manda la comisión, reconocido por el RUT del remitente (o su nombre exacto): se propone y la lista solo
  // se abre si el usuario quiere cambiarlo.
  const provDelRemitente = m => { const rk=crNormRut(m.rut_contraparte||''); let p=rk?(proveedores||[]).find(x=>crNormRut(x.rut||'')===rk):null; if(p) return {p,por:'por el RUT del remitente'}
    const nm=_norm(m.nombre_contraparte||''); if(!nm) return null
    p=(proveedores||[]).find(x=>{ const a=_norm(x.razon_social||''), b=_norm(x.nombre||''); return (a&&a===nm)||(b&&b===nm) }); return p?{p,por:'por el nombre del remitente'}:null }
  const ofiIngresoPicker = (m, resto) => { const stop=e=>e.stopPropagation(); const provSug=provDelRemitente(m); return (
    <div onClick={stop} style={{marginBottom:6}}>
      <div onClick={()=>setAbFam(p=>({...p,[m.id]:undefined}))} style={{display:'flex',alignItems:'center',gap:7,padding:'6px 2px 4px',cursor:'pointer'}}><span style={{color:C.accent,fontSize:15}}><Gl n='chevL'/></span><span style={{fontSize:11,fontWeight:700,color:C.accent}}>Ingreso de oficina</span>{resto!=null&&<span style={{marginLeft:'auto',fontSize:11,fontWeight:700,color:C.soon,flexShrink:0}}>Resta {fmtM(resto)}</span>}</div>
      {(()=>{ const cid=cliPagadorCom(m); if(!pagaComisiones(cid)) return null; const nm=(clients||[]).find(c=>String(c.id)===cid)?.name||'quien paga'
        const fl={fontSize:9,fontWeight:700,letterSpacing:.5,textTransform:'uppercase',color:C.textSoft}
        return <div style={{border:`1px solid ${C.accent}`,background:C.azulBg,borderRadius:9,padding:'9px 10px',margin:'2px 2px 8px'}}>
          <div style={{fontSize:12,fontWeight:700,color:C.accent}}>Comisión por facturar</div>
          <div style={{fontSize:10.5,color:C.muted,marginBottom:7}}>{nm} nos paga comisiones · queda pendiente hasta que llegue la factura</div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'flex-end'}}>
            <label style={{display:'flex',flexDirection:'column',gap:3,flex:'1 1 140px',minWidth:0}}><span style={fl}>Quién la generó</span><input value={comPF.orig} onChange={e=>setComPF(p=>({...p,orig:e.target.value}))} placeholder={m.detalle_aviso||'Cliente derivado o asunto'} style={{fontSize:12,padding:'6px 8px',borderRadius:7,border:`1px solid ${C.border}`,background:'#fff',color:C.text,outline:'none',minWidth:0}}/></label>
            <label style={{display:'flex',flexDirection:'column',gap:3}}><span style={fl}>Socio</span><select value={comPF.soc} onChange={e=>setComPF(p=>({...p,soc:e.target.value}))} style={{fontSize:12,padding:'6px 8px',borderRadius:7,border:`1px solid ${C.border}`,background:'#fff',color:C.text}}><option value=''>Elegir</option>{ADMIN_NAMES.map(n=><option key={n} value={n}>{n}</option>)}</select></label>
            <button disabled={busy===m.id} onClick={async()=>{ const ok=await comisionPorFacturar(m,{clientId:cid, socio:comPF.soc||null, origen:(comPF.orig.trim()||m.detalle_aviso||'').trim()||null}); if(ok) setComPF({soc:'',orig:''}) }} style={{fontSize:11.5,fontWeight:700,color:'#fff',background:C.accent,border:'none',borderRadius:8,padding:'7px 12px',cursor:busy===m.id?'default':'pointer',whiteSpace:'nowrap'}}>{busy===m.id?'Registrando…':'Registrar'}</button>
          </div>
        </div> })()}
      <div style={{padding:'2px 2px 6px'}}>
        {[['Comisión Recibida','asignable a un tercero'],['Subarrendamiento','se imputa a la cuota del mes'],['Reembolso a la oficina','algo que adelantamos y nos devuelven'],['Otros','otro ingreso']].map(([sub,hint])=>{
          const esCom=sub==='Comisión Recibida'; const comOpen=esCom&&ingComFor===m.id; const conSug=esCom&&provSug&&ingProvCambiar!==m.id
          return <div key={sub}>
            <div onClick={busy===m.id?undefined:()=>{ if(esCom){ setIngComFor(comOpen?null:m.id); setIngProvQ(''); setIngProvCambiar(null) } else if(sub==='Subarrendamiento') cobroSubarriendo(m); else ingresoOficina(m,sub,null) }} style={{display:'flex',alignItems:'center',gap:8,padding:'7px 2px',borderTop:`1px solid ${C.bgSoft}`,cursor:busy===m.id?'default':'pointer'}}>
              <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:600,color:C.text}}>{sub}</div><div style={{fontSize:10,color:C.muted}}>{esCom&&provSug?(provSug.p.razon_social||provSug.p.nombre):hint}</div></div>
              <span style={{color:C.textSoft,fontSize:13}}>{comOpen?<Gl n='chevD'/>:<Gl n='chevron'/>}</span>
            </div>
            {comOpen&&conSug&&<div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 9px',margin:'2px 2px 6px 4px',border:`1px solid ${C.border}`,borderRadius:8,background:C.bgSoft}}>
              {isDesktop?<><span style={{width:6,height:6,borderRadius:'50%',background:C.azulInfo,flexShrink:0}}/>
              <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:700,color:C.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{provSug.p.razon_social||provSug.p.nombre}</div><div style={{fontSize:10,color:C.muted,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{provSug.por}</div></div></>:<span style={{flex:1}}/>}
              <span onClick={busy===m.id?undefined:()=>{ setIngProvCambiar(m.id); setIngProvQ('') }} style={{fontSize:11,fontWeight:600,color:C.accent,cursor:'pointer',padding:'4px 6px',flexShrink:0}}>Cambiar</span>
              <button disabled={busy===m.id} onClick={()=>ingresoOficina(m,'Comisión Recibida',provSug.p.id)} style={{fontSize:11.5,fontWeight:700,color:'#fff',background:C.accent,border:'none',borderRadius:8,padding:'6px 11px',cursor:busy===m.id?'default':'pointer',whiteSpace:'nowrap',flexShrink:0}}>{busy===m.id?'Registrando…':'Registrar comisión'}</button>
            </div>}
            {comOpen&&!conSug&&(()=>{ const ql=ingProvQ.trim().toLowerCase(); const provs=[...(proveedores||[])].sort((a,b)=>((a.razon_social||a.nombre||'')).localeCompare(b.razon_social||b.nombre||'','es')).filter(p=>!ql||(`${p.razon_social||''} ${p.nombre||''} ${p.rut||''}`).toLowerCase().includes(ql)); return (
              <div style={{padding:'4px 2px 6px 4px'}}>
                <div onClick={()=>setIngComFor(null)} style={{fontSize:10,fontWeight:700,color:C.accent,cursor:'pointer',marginBottom:6}}><Gl n='chevL'/> Volver a los tipos</div>
                <div style={{display:'flex',alignItems:'center',gap:6,border:`1.5px solid ${C.accent}`,background:'#fff',borderRadius:8,padding:'6px 9px',marginBottom:6}}>
                  <input value={ingProvQ} onChange={e=>setIngProvQ(e.target.value)} placeholder='Buscar proveedor o tercero…' style={{border:'none',outline:'none',fontSize:12,color:C.text,flex:1,minWidth:0,background:'none'}}/>
                </div>
                <div style={{maxHeight:150,overflowY:'auto',border:`1px solid ${C.border}`,borderRadius:8}}>
                  {provs.slice(0,8).map(p=><div key={p.id} onClick={busy===m.id?undefined:()=>ingresoOficina(m,'Comisión Recibida',p.id)} style={{display:'flex',alignItems:'center',gap:7,padding:'7px 9px',borderTop:`1px solid ${C.bgSoft}`,cursor:busy===m.id?'default':'pointer',fontSize:12}}><span style={{width:6,height:6,borderRadius:'50%',background:C.azulInfo,flexShrink:0}}/><span style={{flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.razon_social||p.nombre||'—'}</span></div>)}
                  {!provs.length&&!ql&&<div style={{padding:'8px 9px',fontSize:11,color:C.muted}}>Escribe para buscar o crear un tercero…</div>}
                  {ql&&!provs.some(p=>((p.razon_social||p.nombre||'').toLowerCase()===ql))&&<div onClick={busy===m.id?undefined:async()=>{ try{ const {data,error}=await supabase.from('proveedores').insert({razon_social:ingProvQ.trim(),activo:true}).select().single(); if(error) throw error; await ingresoOficina(m,'Comisión Recibida',data?.id||null) }catch(e){ appAlert('No se pudo crear el tercero: '+(e.message||e)) } }} style={{padding:'7px 9px',borderTop:`1px solid ${C.bgSoft}`,fontSize:12,fontWeight:600,color:C.accent,cursor:busy===m.id?'default':'pointer',background:'#FBFCFD'}}>+ Crear "{ingProvQ.trim()}" como tercero</div>}
                  <div onClick={busy===m.id?undefined:()=>ingresoOficina(m,'Comisión Recibida',null)} style={{padding:'7px 9px',borderTop:`1px solid ${C.bgSoft}`,fontSize:12,fontWeight:600,color:C.muted,cursor:busy===m.id?'default':'pointer'}}>Sin asignar · registrar comisión</div>
                </div>
              </div>) })()}
          </div>
        })}
      </div>
    </div>) }
  // Cola de "Resolver de a uno": abonos sin cliente ni conciliar dentro del foco (respeta filtros/búsqueda de `lista`); los saltados van al final.
  const unoBase = focoKey==='sinid' ? lista.filter(m=>!m.es_interno && !m.cliente_id && !(concByMov[m.id]?.length) && !RESUELTAS_ABO.includes(m.categoria)) : []
  const unoPend = [...unoBase.filter(m=>!unoSkip.has(m.id)), ...unoBase.filter(m=>unoSkip.has(m.id))]
  const unoCur = unoMode ? unoPend[0] : null
  // Rail de escritorio (2-panel): nav compacto a la izquierda; la lista (interiorEl) llena el ancho a la derecha.
  const deskRail = (
    <div style={{padding:'14px 12px'}}>
      <div style={{fontSize:15,fontWeight:600,color:C.text,marginBottom:11,padding:'0 2px'}}>Conciliación</div>
      {listosN>0&&<div onClick={()=>setLoteConfirm(listosExactos)} style={{cursor:'pointer',background:C.greenBg,border:`1px solid ${C.greenText}`,borderRadius:10,padding:'9px 10px',marginBottom:8,display:'flex',alignItems:'center',gap:8}}>
        <span style={{width:24,height:24,borderRadius:6,background:C.surface,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SIcon n='exchange' s={13} c={C.greenText}/></span>
        <div style={{flex:1,minWidth:0}}><div style={{fontSize:11,fontWeight:700,color:C.accent}}>Listo para conciliar</div><div style={{fontSize:9,color:C.greenText}}>{listosN} {listosN===1?'calza':'calzan'} exacto</div></div>
        <span style={{background:C.greenText,color:'#fff',borderRadius:6,padding:'4px 9px',fontSize:10,fontWeight:700,whiteSpace:'nowrap',flexShrink:0}}>Conciliar {listosN}</span>
      </div>}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:7}}>
        <div onClick={()=>{setSub('abonos');setConcView('todos')}} style={{cursor:'pointer',border:`1px solid ${C.border}`,borderRadius:10,padding:'8px 9px',background:C.surface,display:'flex',alignItems:'center',gap:7}}><span style={{width:24,height:24,borderRadius:6,background:C.greenBg,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SIcon n='exchange' s={14} c={C.greenText}/></span><div style={{minWidth:0}}><div style={{fontSize:12,fontWeight:600,color:C.text}}>Abonos</div><div style={{fontSize:9,color:C.muted}}>{G.nAbo} mov.</div></div></div>
        <div onClick={()=>{setSub('cargos');setConcView(ccN>0?'clasificar':'todos')}} style={{cursor:'pointer',border:`1px solid ${ccN>0?C.soonText:C.border}`,borderRadius:10,padding:'8px 9px',background:C.surface,display:'flex',alignItems:'center',gap:7}}><span style={{width:24,height:24,borderRadius:6,background:ccN>0?C.soonBg:C.bgSoft,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SIcon n='wallet' s={14} c={ccN>0?C.soonText:C.accent}/></span><div style={{minWidth:0}}><div style={{fontSize:12,fontWeight:600,color:C.text}}>Cargos</div>{ccN>0?<><div style={{fontSize:9,color:C.soonText,fontWeight:700}}>{ccN} por clasificar</div><div style={{fontSize:10,color:C.soonText,fontWeight:800,fontVariantNumeric:'tabular-nums'}}>{fmtM(ccMonto)}</div></>:<div style={{fontSize:9,color:C.muted}}>{G.nCar} mov.</div>}</div></div>
      </div>
      <div onClick={()=>{setSub('abonos');setConcView(prN>0?'porresolver':'todos')}} style={{cursor:'pointer',border:`1px solid ${prN>0?C.overdueText:C.border}`,background:prN>0?C.overdueBg:C.surface,borderRadius:12,padding:'10px 11px',marginTop:8}}>
        <div style={{fontSize:9,fontWeight:800,color:prN>0?C.overdueText:C.greenText,textTransform:'uppercase',letterSpacing:.3}}>{prN>0?'Por resolver':'Todo conciliado'}</div>
        {prN>0&&<>
          <div style={{fontSize:17,fontWeight:800,color:C.overdueText,lineHeight:1.05,marginTop:2}}>{prN} · {fmtM(prMonto)}</div>
          {pr90>0&&<div style={{fontSize:9,color:C.overdueText,opacity:.82,marginTop:2}}>{fmtM(pr90)} lleva +90 días</div>}
          <div style={{background:C.surface,borderRadius:8,marginTop:8,overflow:'hidden'}}>
            {prSub.map((r,i)=>{ const on=concView===r.cv; return (
              <div key={r.cv} onClick={(e)=>{e.stopPropagation();setSub('abonos');setConcView(r.cv)}} title={`${r.n} · ${r.t}`} style={{display:'flex',alignItems:'center',gap:8,padding:'7px 9px',borderTop:i>0?`1px solid ${C.border}`:'none',cursor:'pointer',background:on?C.overdueBg:'transparent'}}>
                <span style={{flex:1,minWidth:0,fontSize:11,fontWeight:on?700:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.t}</span>
                <span style={{fontSize:11,fontWeight:800,color:C.overdueText,fontVariantNumeric:'tabular-nums',flexShrink:0}}>{fmtM(r.m)}</span>
                <span style={{color:C.muted,fontSize:11,flexShrink:0}}><Gl n='chevron'/></span>
              </div>) })}
          </div>
        </>}
      </div>
      {sugeridosId.length>0&&<div onClick={()=>{setRevSugSel(new Set(sugeridosId.map(s=>s.mov.id)));setRevSugOpen(true)}} style={{cursor:'pointer',border:`1px solid ${C.azulInfo}`,background:C.azulBg,borderRadius:10,padding:'8px 10px',marginTop:8,display:'flex',alignItems:'center',gap:8}}>
        <div style={{flex:1,minWidth:0}}><div style={{fontSize:11,fontWeight:700,color:C.azulInfo}}>Identificar por su nombre</div><div style={{fontSize:9,color:C.muted}}>{sugeridosId.length} · la app ya sabe</div></div>
        <span style={{fontSize:11,fontWeight:800,color:C.azulInfo,fontVariantNumeric:'tabular-nums',flexShrink:0}}>{fmtM(sugMonto)}</span>
        <span style={{color:C.azulInfo,fontSize:11,flexShrink:0}}><Gl n='chevron'/></span>
      </div>}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:7,marginTop:8}}>
        <div onClick={()=>setCobradasOpen(true)} style={{cursor:'pointer',border:`1px solid ${C.border}`,borderRadius:8,padding:'7px 8px',background:C.surface}}><div style={{fontSize:11,fontWeight:600,color:C.text}}>Sin respaldo</div><div style={{fontSize:9,color:C.muted}}>Facturas sin banco</div></div>
        <div onClick={()=>setVerCarga(true)} style={{cursor:'pointer',border:`1px solid ${C.border}`,borderRadius:8,padding:'7px 8px',background:C.surface}}><div style={{fontSize:11,fontWeight:600,color:C.text}}>Cargar cartola</div><div style={{fontSize:9,color:C.muted}}>{cartolas.length} cargadas</div></div>
      </div>
      <div style={{textAlign:'right',marginTop:8}}><button onClick={exportConc} style={{fontSize:10,fontWeight:600,color:C.accent,background:'none',border:`1px solid ${C.border}`,borderRadius:8,padding:'4px 9px',cursor:'pointer'}}>Exportar (CSV) ↓</button></div>
    </div>
  )
  // Detalle de un movimiento (glosa, propuesta, otras opciones, contexto, lo conciliado). Fuente ÚNICA: bajo la fila en móvil y en el panel derecho en escritorio.
  const detalleMov = (m) => {
    const cliName=m.cliente_id?cmap[m.cliente_id]:null
    const nomBanco=(m.rut_contraparte&&nameByRut[crNormRut(m.rut_contraparte)])||m.nombre_contraparte||(m.es_interno?'Traspaso interno':tipoMov(m.descripcion))
    return (
                <div style={{marginTop:6,paddingTop:6,borderTop:`1px solid ${C.border}`}} onClick={e=>e.stopPropagation()}>
                  {m.detalle_aviso&&<div style={{fontSize:11,color:C.text,marginBottom:4,lineHeight:1.45}}><b>Mensaje de la transferencia:</b> {m.detalle_aviso}</div>}
                  <div style={{fontSize:10,color:C.muted,marginBottom:5,lineHeight:1.45}}><b>Glosa:</b> {verGlosa?(m.descripcion||'—'):`${(m.descripcion||'—').slice(0,70)}${(m.descripcion||'').length>70?'…':''}`} {(m.descripcion||'').length>70?<span onClick={()=>setVerGlosa(v=>!v)} style={{color:C.azulInfo,cursor:'pointer'}}>{verGlosa?'ver menos':'ver más'}</span>:null}{m.n_operacion?` · N° op. ${m.n_operacion}`:''}</div>
                {m.es_interno&&(()=>{ const tr=traspasos.de[m.id]; const cta=r=>r==='gastos'?'Cta. Gastos':'Cta. Honorarios'
                  const ir=id=>{ irMov(id); if(isDesktop) setDeskSel({id,idx:0}) }
                  const link=(txt,id)=><span onClick={e=>{e.stopPropagation();ir(id)}} style={{color:C.accent,fontWeight:700,cursor:'pointer',textDecoration:'underline',textDecorationColor:C.border}}>{txt}</span>
                  if(!tr){ const o=origenInterno(m); if(!o) return null; const c=o.cand; const nom=c.cliente_id?cmap[c.cliente_id]:(c.nombre_contraparte||'movimiento sin nombre')
                    return <div style={{fontSize:11,color:o.exact?C.accent:C.overdue,marginBottom:4}}>↔ {o.exact?'origen':'posible origen'}: {link(nom,c.id)} · abono en {cta(c.rol_cuenta)}{o.exact?'':` — diferencia ${fmtM(Math.abs(o.diff))}, revisar`}</div> }
                  const otra=m.id===tr.t.id?tr.esp:tr.t
                  const pata=<div style={{fontSize:11,color:C.muted,marginBottom:3}}>Traspaso de la {cta(tr.orig)} a la {cta(tr.dest)} · {link(m.id===tr.t.id?`ver la entrada en ${cta(tr.dest)}`:`ver la salida de ${cta(tr.orig)}`,otra.id)}</div>
                  if(tr.kind==='sin') return <>{pata}<div style={{fontSize:11,color:C.soonText,marginBottom:4}}>Sin abono identificado en la {cta(tr.orig)}</div></>
                  if(tr.kind==='fondo') return <>{pata}<div style={{fontSize:11,color:C.accent,marginBottom:4}}>Traspasa el fondo de <b>{cmap[tr.fondo.client_id]||'—'}</b> del {fmtFechaDMY(tr.fondo.date)} <span style={{color:C.greenText,fontWeight:600}}>(monto exacto)</span></div></>
                  const c=tr.mov; const nom=c.cliente_id?cmap[c.cliente_id]:(c.nombre_contraparte||'movimiento sin nombre')
                  if(tr.kind==='cerca') return <>{pata}<div style={{fontSize:11,color:C.overdue,marginBottom:4}}>Posible origen: {link(nom,c.id)} del {fmtFechaDMY(c.fecha)} — diferencia {fmtM(Math.abs(tr.diff))}, revisar</div></>
                  return <>{pata}<div style={{fontSize:11,color:C.accent,marginBottom:4}}>Traspasa {tr.kind==='parte'?`la parte ${tr.td==='fondo'?'de gastos':'de honorarios'} (${fmtM(tr.monto)}) del abono`:'el abono'} de {link(nom,c.id)} del {fmtFechaDMY(c.fecha)} <span style={{color:C.greenText,fontWeight:600}}>(monto exacto)</span></div></>
                })()}
                {!m.es_interno&&m.tipo==='abono'&&(traspasos.a[m.id]||[]).map(tr=><div key={tr.t.id} style={{fontSize:11,color:C.accent,marginBottom:4}}>↔ Traspasado a la {tr.dest==='gastos'?'Cta. Gastos':'Cta. Honorarios'} el {fmtFechaDMY(tr.t.fecha)} ({fmtM(tr.t.monto)}) · <span onClick={e=>{e.stopPropagation();irMov(tr.esp.id); if(isDesktop) setDeskSel({id:tr.esp.id,idx:0})}} style={{fontWeight:700,cursor:'pointer',textDecoration:'underline',textDecorationColor:C.border}}>ver traspaso</span></div>)}
                {!m.es_interno&&m.tipo==='abono'&&<div style={{display:'flex',alignItems:'center',gap:8,marginBottom:2}}><span style={{fontSize:9,fontWeight:700,color:C.textSoft,textTransform:'uppercase',letterSpacing:.3}}>{(!m.cliente_id&&abFam[m.id]==='oficina')?'Ingreso de oficina':'Cliente'}</span>{!m.cliente_id&&abFam[m.id]!=='oficina'&&<button onClick={e=>{e.stopPropagation();setAbFam(p=>({...p,[m.id]:'oficina'}))}} title='No es de un cliente: subarriendo, comisión recibida, reembolso u otro ingreso de la oficina' style={{marginLeft:'auto',fontSize:10,fontWeight:700,color:C.greenText,background:C.greenBg,border:'none',borderRadius:20,padding:'2px 10px',cursor:'pointer'}}>Ingreso de oficina <Gl n='chevron'/></button>}</div>}
                {!m.es_interno&&m.tipo==='cargo'&&renderCargoClasificar(m)}
                {!m.es_interno&&m.tipo==='cargo'&&renderPagoProveedor(m)}
                {!m.es_interno&&m.tipo==='abono'&&(
                  (!m.cliente_id&&abFam[m.id]==='oficina')
                    ? <div style={{marginTop:5}} onClick={e=>e.stopPropagation()}>{ofiIngresoPicker(m,(m.monto||0)-(m.monto_conciliado||0))}</div>
                  : editMov===m.id
                    ? <div style={{marginTop:5}} onClick={e=>e.stopPropagation()}>
                        <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:6}}>
                          <input value={editForm.rut} onChange={e=>setEditForm(f=>({...f,rut:e.target.value}))} placeholder='RUT (ej. 76.123.456-7)' style={{flex:'1 1 130px',minWidth:0,padding:'6px 8px',borderRadius:6,border:`1px solid ${C.border}`,fontSize:12,outline:'none'}}/>
                          <input value={editForm.nombre} onChange={e=>setEditForm(f=>({...f,nombre:e.target.value}))} placeholder='Nombre' style={{flex:'1 1 130px',minWidth:0,padding:'6px 8px',borderRadius:6,border:`1px solid ${C.border}`,fontSize:12,outline:'none'}}/>
                        </div>
                        <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                          <div style={{flex:'1 1 160px',minWidth:0}}><AsignarClienteInline bill={{id:m.id}} clients={clients} onAssign={(_,cid)=>identificar(m,cid)} label='Asignar cliente (aprende)' placeholder='Buscar cliente…'/></div>
                          <button onClick={()=>guardarRut(m)} style={{fontSize:11,fontWeight:600,padding:'5px 10px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.accent,cursor:'pointer'}}>Guardar RUT</button>
                          <button onClick={()=>{setEditMov(null);setEditForm({rut:'',nombre:''})}} style={{fontSize:11,color:C.muted,background:'none',border:'none',cursor:'pointer'}}>Cancelar</button>
                        </div>
                      </div>
                    : (!cliName&&(sugerencias[m.id]&&cmap[sugerencias[m.id]]||clientePorMonto(m)||facturaPorMontoManual(m).length===1))
                    ? (()=>{
                        // Sugerencia de cliente como TARJETA clara (protagonista + motivo), NUNCA un chip que asigna a ciegas. Cubre las dos vías:
                        // por NOMBRE de la transferencia, o por MONTO (una factura emitida sin pago que calza exacto). Al confirmar se asigna el
                        // cliente y aparece el card de conciliación "El depósito | La factura · Conciliar ahora" (la fila queda abierta).
                        const sc = sugMov(m)
                        if(!sc) return null
                        const fMon = sc.f ? montoFactura(sc.f) : 0
                        return (
                        <div onClick={e=>e.stopPropagation()} style={{marginTop:5}}>
                        <div style={{border:'1px solid #CFE9DD',background:'#F1FAF6',borderRadius:12,padding:'10px 12px'}}>
                          <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',gap:8}}>
                            <span style={{fontSize:14,fontWeight:700,color:C.accent,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{sc.nombre}</span>
                            <span style={{fontSize:9.5,fontWeight:700,color:C.greenText,background:C.greenBg,borderRadius:20,padding:'2px 8px',flexShrink:0,whiteSpace:'nowrap'}}>{sc.via==='nombre'?'Por el nombre':sc.via==='glosa'?'La glosa nombra el folio':'Monto exacto'}</span>
                          </div>
                          {sc.via==='nombre'
                            ? <div style={{fontSize:11,color:C.greenText,marginTop:2}}>Coincide por el nombre de la transferencia</div>
                            : sc.f ? <div style={{marginTop:8,borderTop:'1px solid #DCEEE5',paddingTop:8}}>
                                <div style={{display:'flex',justifyContent:'space-between',gap:8,fontSize:12}}><span style={{color:C.textSoft}}>Este depósito</span><b style={{color:C.greenText,fontVariantNumeric:'tabular-nums'}}>{fmtM(m.monto)}</b></div>
                                <div style={{display:'flex',justifyContent:'space-between',gap:8,fontSize:12,marginTop:3}}><span style={{color:C.textSoft}}>Factura N° {folioN(sc.f.invoice_no)||'—'}{sc.f.issued_at?` · emitida ${fmtFechaDMY(sc.f.issued_at)}`:''}</span><b style={{color:C.accent,fontVariantNumeric:'tabular-nums'}}>{fmtM(fMon)}</b></div>
                                {sc.f.concept&&<div style={{fontSize:10,color:C.muted,marginTop:3,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{sc.f.concept}</div>}
                                {(sc.f.receptor_name||sc.f.receptor_rut)&&<div style={{fontSize:10,color:C.muted,marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>Emitida a {sc.f.receptor_name||'—'}{sc.f.receptor_rut?` · ${fmtRutCL(sc.f.receptor_rut)}`:''}</div>}
                                <div style={{fontSize:10,color:C.textSoft,marginTop:5,lineHeight:1.4}}>La glosa no trae RUT — el calce es por <b>monto exacto</b>. Revisa que sea de este cliente antes de confirmar.</div>
                              </div> : null}
                          <div style={{display:'flex',gap:8,alignItems:'center',marginTop:9}}>
                            <AsignarClienteInline bill={{id:m.id}} clients={clients} onAssign={(_,cid)=>identificar(m,cid)} label='Buscar otro' placeholder='Buscar cliente…'/>
                            <button onClick={()=>identificar(m,sc.cid,true)} style={{marginLeft:'auto',fontSize:12,fontWeight:600,color:'#fff',background:C.greenText,border:'none',borderRadius:8,padding:'6px 14px',cursor:'pointer',whiteSpace:'nowrap'}}>Es {sc.nombre} <Gl n='tick'/></button>
                          </div>
                          {sc.via!=='nombre'&&<button disabled={busy===m.id} onClick={()=>marcarNoCliente(m)} title='El que deposita no es cliente (un tercero o una intermediaria que nos devuelve plata). Aprende el RUT y deja de proponerlo por monto.' style={{marginTop:7,fontSize:11,fontWeight:600,color:C.muted,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,padding:'5px 11px',cursor:busy===m.id?'default':'pointer'}}>No es cliente · tercero / intermediaria</button>}
                        </div>
                        </div>
                        )
                      })()
                    : <div style={{display:'flex',alignItems:'center',gap:8,marginTop:2,flexWrap:'wrap',fontSize:10}} onClick={e=>e.stopPropagation()}>
                        {/* Cliente como chip gris-borde (igual al header): tocar = editar/cambiar cliente */}
                        {cliName
                          ? <span onClick={()=>{setEditMov(m.id);setEditForm({rut:m.rut_contraparte||'',nombre:m.nombre_contraparte||''})}} title='Tocar para editar / cambiar cliente' style={{fontWeight:500,color:C.muted,border:`1px solid ${C.border}`,borderRadius:4,padding:'1px 8px',background:'#fff',cursor:'pointer'}}>{cliName}</span>
                          : <AsignarClienteInline bill={{id:m.id}} clients={clients} onAssign={(_,cid)=>identificar(m,cid)} label='Asignar cliente' placeholder='Buscar cliente o RUT…'/>}
                        {!cliName&&!m.es_interno&&<span onClick={e=>e.stopPropagation()} style={{display:'inline-flex',alignItems:'center',gap:4}}><span style={{fontSize:10,color:C.textSoft}}>o fondo del equipo:</span><select disabled={busy===m.id} value='' onChange={e=>{ const p=e.target.value; e.target.value=''; if(p) crearFondoPersonal(m,p) }} style={{fontSize:10,fontWeight:600,border:`1px solid ${C.border}`,borderRadius:6,padding:'2px 6px',background:'#fff',color:C.accent,cursor:'pointer'}}><option value=''>elegir…</option>{['Cristóbal','Erasmo','Martín','Martina','Rodrigo'].map(p=><option key={p} value={p}>{p}</option>)}</select></span>}
                        {!cliName&&sugerencias[m.id]&&cmap[sugerencias[m.id]]&&<button onClick={()=>identificar(m,sugerencias[m.id],true)} title='Asignar este cliente (aprende el RUT)' style={{fontSize:10,fontWeight:700,padding:'2px 9px',borderRadius:20,background:C.greenBg,color:C.greenText,border:'none',cursor:'pointer'}}>{cmap[sugerencias[m.id]]} <span style={{fontWeight:600,opacity:.85}}>· por el nombre</span></button>}
                        {!cliName&&!sugerencias[m.id]&&(()=>{
                          const cm=clientePorMonto(m)
                          if(cm){ const nom=cmap[cm.cid]||clients.find(c=>String(c.id)===String(cm.cid))?.name||'cliente'; return <button onClick={()=>identificar(m,cm.cid,true)} title={`Asignar a ${nom} — tiene la Factura N° ${folioN(cm.factura.invoice_no)||'—'} que calza exacto`} style={{fontSize:10,fontWeight:700,padding:'2px 9px',borderRadius:20,background:C.azulBg,color:C.accent,border:'none',cursor:'pointer'}}>{nom} <span style={{fontWeight:600,opacity:.85}}>· calza con N° {folioN(cm.factura.invoice_no)||'—'}</span></button> }
                          // Último criterio de calce: factura emitida sin pago con el mismo monto exacto (ventana amplia).
                          const fm=facturaPorMontoManual(m); if(!fm.length) return null
                          if(fm.length===1){ const f=fm[0]; const nom=cmap[f.client_id]||clients.find(c=>String(c.id)===String(f.client_id))?.name||'cliente'; return <button onClick={()=>identificar(m,f.client_id,true)} title={`Único calce por monto: Factura N° ${folioN(f.invoice_no)||'—'} de ${nom} (emitida sin pago, mismo monto exacto)`} style={{fontSize:10,fontWeight:700,padding:'2px 9px',borderRadius:20,background:C.azulBg,color:C.accent,border:'none',cursor:'pointer'}}>{nom} <span style={{fontWeight:600,opacity:.85}}>· calza con N° {folioN(f.invoice_no)||'—'}</span></button> }
                          const open=montoFacFor===m.id
                          return <><button onClick={()=>setMontoFacFor(open?null:m.id)} title='Facturas emitidas sin pago del mismo monto exacto — elige cuál' style={{fontSize:10,fontWeight:700,padding:'2px 9px',borderRadius:20,background:C.azulBg,color:C.accent,border:'none',cursor:'pointer'}}>{fm.length} facturas calzan {fmtM(m.monto)} {open?<Gl n='chevU'/>:<Gl n='chevD'/>}</button>
                            {open&&<div style={{flexBasis:'100%',display:'flex',flexDirection:'column',gap:4,marginTop:4}}>{fm.slice(0,8).map(f=>{ const nom=cmap[f.client_id]||clients.find(c=>String(c.id)===String(f.client_id))?.name||'cliente'; return <button key={f.id} onClick={()=>{identificar(m,f.client_id,true);setMontoFacFor(null)}} style={{textAlign:'left',fontSize:10,fontWeight:600,padding:'4px 9px',borderRadius:8,background:'#fff',border:`1px solid ${C.border}`,color:C.text,cursor:'pointer'}}>{nom} · Factura N° {folioN(f.invoice_no)||'—'} <span style={{color:C.muted,fontWeight:400}}>· emitida {fmtFechaDMY(f.issued_at)}</span></button> })}</div>}
                          </>
                        })()}
                        {/* Categoría = chip clickeable (sin texto "Cambiar tag"). Devolución en cargos con flecha ← */}
                        {/* Clasificar SOLO para: cargos (su única vía), o abonos SIN cliente (los abonos CON cliente clasifican en "¿A qué corresponde? → Otro tipo de pago"; y su categoría ya se ve en el badge de estado, no se repite acá). */}
                        {(m.tipo==='cargo'||tagFor===m.id||(m.tipo==='abono'&&!m.es_interno&&!m.cliente_id))&&(()=>{ const cats=m.tipo==='abono'?CATS_ABONO:CATS_CARGO; const tagTxt=c=>c==='Devolución'?'← Devolución':c==='Provisión de gastos'?'Fondo por Rendir':c; return (
                          tagFor===m.id
                            ? <>{cats.map(c=>{const t=TAG_STY[c];return <button key={c} onClick={()=>setCategoria(m,c)} style={{fontSize:10,fontWeight:700,borderRadius:20,padding:'2px 9px',cursor:'pointer',background:t.bg,color:t.color,border:'none'}}>{tagTxt(c)}</button>})}{m.categoria&&<button onClick={()=>setCategoria(m,null)} style={{fontSize:10,color:C.muted,background:'none',border:'none',cursor:'pointer'}}>Quitar</button>}<button onClick={()=>setTagFor(null)} style={{fontSize:10,color:C.muted,background:'none',border:'none',cursor:'pointer'}}>Cerrar</button></>
                            : m.categoria
                              ? (()=>{ const t=TAG_STY[m.categoria]||{bg:C.bgWarm,color:C.grisText}; return <button onClick={()=>setTagFor(m.id)} title='Tocar para cambiar categoría' style={{fontSize:10,fontWeight:700,borderRadius:20,padding:'2px 9px',cursor:'pointer',background:t.bg,color:t.color,border:'none'}}>{tagTxt(m.categoria)}</button> })()
                              : (m.tipo==='cargo'
                                  ? <>{(()=>{ const sg=tipoSugerido(m); return sg?<button onClick={()=>setCategoria(m,sg)} title='Categoría aprendida del mismo pagador — confirma para usarla' style={{fontSize:10,fontWeight:700,borderRadius:20,padding:'2px 9px',cursor:'pointer',background:C.azulBg,color:C.accent,border:'none'}}><Sparkle/> ¿{sg}?</button>:null })()}<button onClick={()=>setCategoria(m,'Gastos Oficina')} style={{fontSize:10,fontWeight:700,borderRadius:20,padding:'2px 10px',cursor:'pointer',background:C.azulBg,color:C.azulInfo,border:'none'}}>Gastos Oficina</button><button onClick={()=>setTagFor(m.id)} style={{fontSize:10,color:C.muted,background:'none',border:'none',cursor:'pointer',fontWeight:600}}>Otra…</button></>
                                  : (()=>{ const sg=tipoSugerido(m); return <>{sg&&<button onClick={()=>setCategoria(m,sg)} title='Sugerencia aprendida — confirma para usarla' style={{fontSize:10,fontWeight:700,borderRadius:20,padding:'2px 9px',cursor:'pointer',background:C.azulBg,color:C.accent,border:'none'}}><Sparkle/> ¿{sg}?</button>}<button onClick={()=>setTagFor(m.id)} style={{fontSize:10,color:C.muted,background:'none',border:'none',cursor:'pointer',fontWeight:600}}>Clasificar…</button></> })())
                        )})()}
                      </div>
                )}
                {/* Cargos: clasificación (Gasto Oficina / Gasto Cliente) → renderCargoClasificar(m), arriba. */}
                {/* Abono de un cliente con rendición enviada y saldo por cubrir → propone acreditarlo como fondo (misma tarjeta de sugerencia verde de Banco). Confirmar = categoría «Provisión de gastos» + fondo, igual que «+ Crear fondo». */}
                {!noFondoRend.has(m.id)&&!(concByMov[m.id]?.length)&&(()=>{
                  const pf=propuestaFondoRendicion({mov:m,expenses,rendiciones}); if(!pf) return null
                  return (<div onClick={e=>e.stopPropagation()} style={{marginTop:5}}>
                    <div style={{border:'1px solid #CFE9DD',background:'#F1FAF6',borderRadius:12,padding:'10px 12px'}}>
                      <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',gap:8}}>
                        <span style={{fontSize:14,fontWeight:700,color:C.accent,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>Pago de la rendición</span>
                        <span style={{fontSize:9.5,fontWeight:700,color:C.greenText,background:C.greenBg,borderRadius:20,padding:'2px 8px',flexShrink:0,whiteSpace:'nowrap'}}>Rendición enviada</span>
                      </div>
                      <div style={{fontSize:11,color:C.greenText,marginTop:2}}>{cmap[m.cliente_id]||'Cliente'} · enviada el {fmtFechaDMY(String(pf.rend.sent_at).slice(0,10))}</div>
                      <div style={{marginTop:8,borderTop:'1px solid #DCEEE5',paddingTop:8}}>
                        <div style={{display:'flex',justifyContent:'space-between',gap:8,fontSize:12}}><span style={{color:C.textSoft}}>Este depósito</span><b style={{color:C.greenText,fontVariantNumeric:'tabular-nums'}}>{fmtM(pf.resto)}</b></div>
                        <div style={{display:'flex',justifyContent:'space-between',gap:8,fontSize:12,marginTop:3}}><span style={{color:C.textSoft}}>Saldo por cubrir</span><b style={{color:C.accent,fontVariantNumeric:'tabular-nums'}}>{fmtM(pf.porCubrir)}</b></div>
                        <div style={{display:'flex',justifyContent:'space-between',gap:8,fontSize:12,marginTop:3}}><span style={{color:C.textSoft}}>Queda por cubrir</span><b style={{color:C.accent,fontVariantNumeric:'tabular-nums'}}>{fmtM(pf.queda)}</b></div>
                      </div>
                      <div style={{display:'flex',gap:8,alignItems:'center',marginTop:9,flexWrap:'wrap'}}>
                        <button onClick={()=>{ if(pf.rend.comprobante_url) window.open(pf.rend.comprobante_url,'_blank','noopener'); else if(onOpenClientFicha) onOpenClientFicha(m.cliente_id) }} style={{fontSize:12,fontWeight:600,color:C.muted,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,padding:'6px 12px',cursor:'pointer',whiteSpace:'nowrap'}}>Ver rendición</button>
                        <button onClick={()=>setNoFondoRend(p=>new Set(p).add(m.id))} style={{fontSize:12,fontWeight:600,color:C.muted,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,padding:'6px 12px',cursor:'pointer',whiteSpace:'nowrap'}}>Es otra cosa</button>
                        <button disabled={busy===m.id} onClick={async()=>{ await setCategoria(m,'Provisión de gastos'); await crearFondoProvision({...m,categoria:'Provisión de gastos'}) }} style={{marginLeft:'auto',fontSize:12,fontWeight:600,color:'#fff',background:C.greenText,border:'none',borderRadius:8,padding:'6px 14px',cursor:busy===m.id?'default':'pointer',whiteSpace:'nowrap'}}>Acreditar fondo <Gl n='tick'/></button>
                      </div>
                    </div>
                  </div>)
                })()}
                {/* Fase 3.A — Provisión de gastos → acreditar al fondo del cliente (proponer + confirmar) */}
                {m.tipo==='abono'&&!m.es_interno&&m.categoria==='Provisión de gastos'&&(()=>{
                  const fc=(concByMov[m.id]||[]).find(c=>c.tipo_destino==='fondo')
                  if(fc) return (<div style={{marginTop:5,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}} onClick={e=>e.stopPropagation()}>
                    <span style={{fontSize:9.5,fontWeight:700,color:C.tealText,background:C.tealBg,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap'}}>Fondo por Rendir <span style={{color:'#9FE1CB',fontWeight:400}}>|</span> {fmtM(fc.monto_aplicado)}</span>
                    <button disabled={busy===m.id} onClick={()=>deshacer(m)} style={{fontSize:10,color:C.muted,background:'none',border:'none',cursor:busy===m.id?'default':'pointer'}}>Deshacer</button></div>)
                  if(!m.cliente_id) return (<div style={{marginTop:5,fontSize:10,color:C.muted}}>Identifica el cliente para acreditar el fondo.</div>)
                  return (<div style={{marginTop:5,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}} onClick={e=>e.stopPropagation()}>
                    <span style={{fontSize:10,color:C.tealText}}>Acreditar al fondo de {cmap[m.cliente_id]||'cliente'}:</span>
                    <button disabled={busy===m.id} onClick={()=>crearFondoProvision(m)} style={{fontSize:10,fontWeight:700,borderRadius:20,padding:'2px 10px',cursor:busy===m.id?'default':'pointer',background:C.tealBg,color:C.tealText,border:'none'}}>+ Crear fondo {fmtM((m.monto||0)-(m.monto_conciliado||0))}</button></div>)
                })()}
                {/* Abono con cliente pero categorizado como "resuelto" (Otro ingreso / Pago histórico / etc.): quedó fuera de conciliación. Opción para RECLASIFICARLO como adelanto (saldo a favor) — quita la categoría y lo deja disponible para imputar a una factura. Reversible (Deshacer). */}
                {m.tipo==='abono'&&!m.es_interno&&m.cliente_id&&m.categoria&&!['Cliente','Provisión de gastos'].includes(m.categoria)&&!(concByMov[m.id]?.length)&&(()=>{
                  const resto=(m.monto||0)-(m.monto_conciliado||0); if(resto<=0) return null
                  return (<div style={{marginTop:5,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}} onClick={e=>e.stopPropagation()}>
                    <span style={{fontSize:10,color:C.muted}}>¿Era un adelanto de {cmap[m.cliente_id]||'este cliente'}?</span>
                    <button disabled={busy===m.id} onClick={async()=>{ if(!await appConfirm(`¿Dejar este abono de ${fmtM(resto)} como ADELANTO (saldo a favor) de ${cmap[m.cliente_id]||'este cliente'}?\n\nSe quita la categoría "${m.categoria}" y queda disponible para imputar a una factura.`)) return; await setCategoria(m,null); await saldoAFavor({...m,categoria:null}) }} style={{fontSize:10,fontWeight:700,borderRadius:20,padding:'3px 11px',cursor:busy===m.id?'default':'pointer',background:C.azulBg,color:C.accent,border:'none'}}>Dejar como adelanto</button>
                  </div>)
                })()}
                {/* Conciliación (Fase 2): calce de abono de cliente contra factura pendiente / saldo a favor */}
                {sub==='abonos'&&esConciliable(m)&&(()=>{
                  const myConc=concByMov[m.id]||[]; const resto=(m.monto||0)-(m.monto_conciliado||0)
                  const cands=resto>TOL?candidatosMostrar(m,null,resto):[]
                  // Facturas candidatas: del mismo cliente O del mismo RUT (aunque estén bajo otro cliente/RS) — así aparecen las
                  // emitidas a la empresa aunque el abono quede pegado al cliente-persona. Cruce por RUT (receptor/entidad/cliente).
                  // RUT a cruzar: el del pagador (m.rut_contraparte, a veces el personal de la glosa) MÁS los del cliente
                  // identificado y TODAS sus razones sociales (así aparecen las facturas emitidas a la empresa aunque el
                  // abono venga con el RUT personal). Cruza contra el RUT de cada factura (receptor/entidad/cliente).
                  const rutsMov=(()=>{ const s=new Set(); const add=r=>{ const n=crNormRut(r); if(n)s.add(n) }; add(m.rut_contraparte); const cli=clients.find(c=>String(c.id)===String(m.cliente_id)); if(cli)add(cli.rut); (clientEntities||[]).filter(e=>String(e.client_id)===String(m.cliente_id)).forEach(e=>add(e.rut)); return s })()
                  const rutsFac=b=>{ const s=new Set(); const add=r=>{ const n=crNormRut(r); if(n)s.add(n) }; add(b.receptor_rut); const e=(clientEntities||[]).find(x=>String(x.id)===String(b.entity_id)); if(e)add(e.rut); const c=clients.find(x=>String(x.id)===String(b.client_id)); if(c)add(c.rut); (clientEntities||[]).filter(x=>String(x.client_id)===String(b.client_id)).forEach(x=>add(x.rut)); return s }
                  const facsAll=(billing||[]).filter(b=>!b.deleted_at&&b.invoice_no&&(b.billing_type||'')!=='reembolso'&&(String(b.client_id)===String(m.cliente_id)||[...rutsFac(b)].some(r=>rutsMov.has(r))))
                  const combo=(myConc.length===0&&cands.length===0)?combos(m):null
                  const fmg=(myConc.length===0&&cands.length===0&&!combo)?facturaMasGastos(m):null
                  // Un pago suele pagar 1 factura + dejar un saldo para gastos/anticipo (o pagar 2 facturas). Cuando NADA calza
                  // solo, ofrecemos las facturas con saldo MENOR al pago: conciliar esa factura deja el resto para colocarlo abajo
                  // (Fondo/Saldo a favor/Devolución). Ordenadas por resto más chico = la que más explica el pago. Reversible.
                  // Solo facturas NO pagadas / no conciliadas (facturasParaMov = pool con saldo real; excluye Pagadas y saldo 0). Antes usaba facsAll (todas, incl. pagadas) y colaba facturas ya saldadas.
                  const factResto=(myConc.length===0&&cands.length===0&&!combo&&!fmg)?(()=>{ const t=Math.abs(m.monto||0); return facturasParaMov(m).map(f=>({f,saldo:saldoFactura(f)})).filter(x=>x.saldo>0&&x.saldo<t).map(x=>({...x,resto:t-x.saldo})).sort((a,b)=>((a.f.issued_at||'').localeCompare(b.f.issued_at||''))||(a.resto-b.resto)).slice(0,4) })():[]   // FIFO: la más antigua primero; dif como desempate
                  // Sugerencia permisiva: AUTO usa mejorCandidato (único/seguro); la sugerencia para CONFIRMAR cae al mejor
                  // candidato ordenado (RS·mes·cercanía) aunque no sea único → surfacea recurrentes que antes no se sugerían.
                  const showPick=myConc.length===0||resto>TOL; const sug=showPick?(mejorCandidato(m)||cands[0]||null):null
                  const calceFuerte=!!sug && saldoFactura(sug)===resto
                  // Si HAY una factura sugerida arriba, "¿A qué corresponde?" se repliega tras "No, es otro pago" (lo secundario no compite). Si no hay calce, se muestra abierto.
                  const hayCalce = showPick && !!sug
                  const showOtras = !hayCalce || otrasSet.has(m.id)
                  // Descalce (sin calce exacto): protagonista (la glosa nombra la factura, o el parcial FIFO más antiguo) + contexto cruzado (deuda en facturas, gastos por reembolsar, SII). Solo cuando no hay sug ni conciliación.
                  const esDesc = !sug && myConc.length===0 && resto>TOL
                  const deudaFacs = esDesc ? facturasParaMov(m).map(f=>({f,saldo:saldoFactura(f)})).filter(x=>x.saldo>0) : []
                  const deudaSum = deudaFacs.reduce((s,x)=>s+x.saldo,0)
                  const reembList = esDesc ? gastosReembolsables(m.cliente_id) : []
                  const reembSum = reembList.reduce((s,g)=>s+(g.amount||0),0)
                  const gFolio = esDesc ? folioGlosa(m) : null
                  const folioFac = gFolio ? deudaFacs.find(x=>String(folioN(x.f.invoice_no))===String(gFolio)) : null
                  // Parcial FIFO: la MÁS ANTIGUA con saldo mayor al pago (pagó de menos) — no la de dif más chica.
                  const parcialFac = esDesc ? deudaFacs.filter(x=>x.saldo>resto).sort((a,b)=>(a.f.issued_at||'').localeCompare(b.f.issued_at||''))[0] : null
                  const descProta = folioFac || parcialFac
                  return (
                    <div style={{marginTop:5}} onClick={e=>e.stopPropagation()}>
                      <div style={{...SEC_LBL,marginBottom:4}}>Conciliar</div>
                      {myConc.length>0&&<div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap',marginBottom:showPick?6:0}}>
                        {myConc.map(r=>{ const fe=r.tipo_destino==='fondo'?(expenses||[]).find(e=>String(e.id)===String(r.gasto_id)):null; const dev=fe&&/^(devoluci|reembolso)/i.test(fe.concept||''); const sty=r.tipo_destino==='fondo'?(dev?{color:C.coralText,background:'#FAECE7'}:{color:C.tealText,background:C.tealBg}):r.tipo_destino==='anticipo'?{color:C.azulInfo,background:C.azulBg}:{color:C.greenText,background:C.greenBg}; const lbl=r.tipo_destino==='devolucion'?`Devolución del cargo del ${fmtFechaDMY((movs||[]).find(x=>String(x.id)===String(r.devuelve_mov_id))?.fecha)} · ${fmtM(r.monto_aplicado)}`:r.tipo_destino==='anticipo'?`Saldo a Favor | Anticipo · ${fmtM(r.monto_aplicado)}`:r.tipo_destino==='gasto'?`Reembolso gastos · ${fmtM(r.monto_aplicado)}`:r.tipo_destino==='fondo'?`${dev?'Devolución':'Fondo por Rendir'} · ${fmtM(r.monto_aplicado)}`:(()=>{const f=billing.find(b=>b.id===r.factura_id);const link=!r.marco_pago&&f&&f.status==='Pagado';return `${lblFacturaN(f)} · ${fmtM(r.monto_aplicado)}${link?' · ya pagada':''}`})()
                          const clickable=r.tipo_destino==='factura'&&r.factura_id; const sinFlecha=r.tipo_destino==='fondo'&&!dev
                          return <span key={r.id} onClick={clickable?(e)=>{e.stopPropagation();setFacMyc(facMyc===r.factura_id?null:r.factura_id)}:undefined} style={{fontSize:10,fontWeight:700,color:sty.color,background:sty.background,borderRadius:20,padding:'2px 9px',cursor:clickable?'pointer':'default'}}>{sinFlecha?'':'→ '}{lbl}{clickable?(facMyc===r.factura_id?<>{" "}<Gl n='chevU'/></>:<>{" "}<Gl n='chevD'/></>):''}</span> })}
                        <button disabled={busy===m.id} onClick={()=>deshacer(m)} style={{fontSize:10,color:C.muted,background:'none',border:'none',cursor:busy===m.id?'default':'pointer'}}>Deshacer</button>
                      </div>}
                      {myConc.length>0&&facMyc&&myConc.some(r=>String(r.factura_id)===String(facMyc))&&(()=>{ const f=billing.find(b=>String(b.id)===String(facMyc)); if(!f) return null; const paid=f.status==='Pagado'; return (
                        <div style={{marginBottom:6,background:C.bgPanel,border:`1px solid ${C.border}`,borderRadius:10,padding:'9px 11px'}}>
                          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:5}}><span style={{fontSize:12,fontWeight:700,color:C.accent}}>Factura N° {folioN(f.invoice_no)||'—'}</span>{(()=>{ const e=facturaRespaldo(f,aplicadoByFactura,cartolaHasta); return e?<span style={{fontSize:9.5,fontWeight:700,borderRadius:20,padding:'2px 8px',background:e.bg,color:e.fg,whiteSpace:'nowrap'}}>{e.label}</span>:null })()}</div>
                          <div style={{display:'flex',justifyContent:'space-between',fontSize:11,padding:'2px 0'}}><span style={{color:C.textSoft}}>Concepto</span><span style={{color:C.text,fontWeight:600,maxWidth:'62%',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.concept||'—'}</span></div>
                          <div style={{display:'flex',justifyContent:'space-between',fontSize:11,padding:'2px 0'}}><span style={{color:C.textSoft}}>Emisión</span><span style={{color:C.text,fontWeight:600}}>{fmtFechaDMY(f.issued_at)}{f.due?` · vence ${fmtFechaDMY(f.due)}`:''}</span></div>
                          <div style={{display:'flex',justifyContent:'space-between',fontSize:11,padding:'2px 0'}}><span style={{color:C.textSoft}}>Monto</span><span style={{color:C.text,fontWeight:600}}>{fmtM(f.amount)}</span></div>
                          {f.receptor_name&&<div style={{display:'flex',justifyContent:'space-between',fontSize:11,padding:'2px 0'}}><span style={{color:C.textSoft}}>Razón social</span><span style={{color:C.text,fontWeight:600,maxWidth:'62%',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.receptor_name}{f.receptor_rut?` · ${fmtRutCL(f.receptor_rut)}`:''}</span></div>}
                        </div>
                      )})()}
                      {showPick&&<>
                        {sug&&(()=>{ const resto=(m.monto||0)-(m.monto_conciliado||0); const sld=saldoFactura(sug); const exacto=sld===resto; const est=estadoFacturaLabel(sug,aplicadoByFactura[sug.id]||0,cartolaHasta); const esReemb=(sug.billing_type||'')==='reembolso'; const rutMatch=[...rutsFac(sug)].some(r=>rutsMov.has(r)); const rsF=sug.receptor_name||cmap[sug.client_id]||cmap[m.cliente_id]||'—'; const cta=m.rol_cuenta==='gastos'?'Cta. Gastos':'Cta. Honorarios'; return (
                          <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:10,padding:'9px 10px',marginBottom:6}}>
                            {(()=>{ const bt=`1px solid ${C.bgSoft}`; const lC={fontSize:9,color:C.textSoft,borderTop:bt,padding:'5px 0'}; const vC={fontSize:11,color:C.text,borderTop:bt,padding:'5px 0',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}; const mC={textAlign:'center',borderTop:bt,padding:'5px 0'}; const ok=<span style={{color:C.greenText,fontWeight:700,fontSize:12}}><Gl n='tick'/></span>; return (
                            <div style={{display:'grid',gridTemplateColumns:'44px 1fr 18px 1fr',gap:'0 6px',alignItems:'center'}}>
                              <div></div><div style={{fontSize:9,fontWeight:700,color:C.accent,paddingBottom:5}}>Transferencia</div><div style={{fontSize:11,color:C.muted,textAlign:'center',paddingBottom:5}}>→</div><div style={{fontSize:9,fontWeight:700,color:C.accent,paddingBottom:5}}>Factura</div>
                              <div style={lC}>Monto</div><div style={{...vC,fontSize:13,fontWeight:700,color:C.greenText,fontVariantNumeric:'tabular-nums'}}>+{fmtM(m.monto)}</div><div style={mC}>{exacto?ok:<span style={{fontSize:8,fontWeight:700,color:C.soonText}}>dif</span>}</div><div style={{...vC,fontSize:13,fontWeight:700,color:C.accent,fontVariantNumeric:'tabular-nums'}}>N° {folioN(sug.invoice_no)||'—'} · {fmtM(sld)}</div>
                              <div style={lC}>Fecha</div><div style={vC}>{fmtFechaDMY(m.fecha)} · {cta}</div><div style={{...mC,color:C.muted}}>·</div><div style={vC}>Emitida {fmtFechaDMY(sug.issued_at)}{sug.due?` · vence ${fmtFechaDMY(sug.due)}`:''}</div>
                              <div style={lC}>Nombre</div><div style={vC}>{onOpenClientFicha&&m.cliente_id?<span onClick={e=>{e.stopPropagation();onOpenClientFicha(m.cliente_id)}} style={{color:C.accent,cursor:'pointer'}}>{nomBanco}</span>:nomBanco}</div><div style={mC}></div><div style={vC}>{rsF}</div>
                              <div style={lC}>RUT</div><div style={vC}>{m.rut_contraparte?<Copyable text={m.rut_contraparte} title='Copiar RUT' style={{color:C.text}}>{m.rut_contraparte}</Copyable>:<span style={{color:C.muted}}>—</span>}</div><div style={mC}>{rutMatch?ok:''}</div><div style={vC}>{sug.receptor_rut?<Copyable text={sug.receptor_rut} title='Copiar RUT' style={{color:C.text}}>{fmtRutCL(sug.receptor_rut)}</Copyable>:<span style={{color:C.muted}}>—</span>}</div>
                            </div>) })()}
                            {/* Detalle secundario (no se pierde): N° op · estado · reembolso · concepto · descripción · abonos previos · +N pagos */}
                            <div style={{marginTop:6,display:'flex',flexWrap:'wrap',alignItems:'center',gap:'4px 9px',fontSize:10,color:C.textSoft}}>
                              {!exacto&&<span style={{fontWeight:700,color:C.soonText,background:C.soonBg,borderRadius:6,padding:'1px 7px'}}>Dif {fmtM(Math.abs(sld-resto))}</span>}
                              {m.n_operacion&&<span>N° op. <Copyable text={String(m.n_operacion)} title='Copiar N° operación' style={{color:C.textSoft}}>{m.n_operacion}</Copyable></span>}
                              {est&&<span style={{fontWeight:700,borderRadius:6,padding:'1px 6px',background:est.bg,color:est.fg}}>{est.label}</span>}
                              {esReemb&&<span style={{fontWeight:700,borderRadius:6,padding:'1px 6px',background:'#FAECE7',color:C.coralText}}>Reembolso de gastos</span>}
                              {sug.concept&&<span style={{maxWidth:'100%',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{sug.concept}</span>}
                            </div>
                            {m.descripcion&&<div style={{fontSize:10,color:C.textSoft,marginTop:3,lineHeight:1.35}}>{(m.descripcion||'').slice(0,80)}{(m.descripcion||'').length>80?'…':''}</div>}
                            {(()=>{ const prev=(conc||[]).filter(c=>String(c.factura_id)===String(sug.id)&&c.tipo_destino==='factura'); if(!prev.length) return null; return <div style={{fontSize:10,color:C.greenText,marginTop:2,lineHeight:1.35}}>Abonos previos: {prev.map(c=>{ const mm=(movs||[]).find(x=>String(x.id)===String(c.movimiento_id)); return `${mm?fmtFechaDMY(mm.fecha):'—'} ${fmtM(c.monto_aplicado)}` }).join(' · ')}</div> })()}
                            {(()=>{ const otros=(movs||[]).filter(x=> String(x.id)!==String(m.id) && x.tipo==='abono' && !x.es_interno && !(concByMov[x.id]?.length) && ((m.cliente_id&&String(x.cliente_id||'')===String(m.cliente_id)) || (m.rut_contraparte&&x.rut_contraparte&&crNormRut(x.rut_contraparte)===crNormRut(m.rut_contraparte)))); if(!otros.length) return null; const tot=otros.reduce((a,x)=>a+((x.monto||0)-(x.monto_conciliado||0)),0); return <div style={{fontSize:10,fontWeight:600,color:C.soonText,marginTop:3}}>+ {otros.length} pago{otros.length!==1?'s':''} más de este cliente sin conciliar · {fmtM(tot)}</div> })()}
                            <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap',marginTop:7,paddingTop:6,borderTop:`1px solid ${C.bgSoft}`}}>
                              {/* El ✓ Mismo RUT / Monto exacto y la Dif ahora van en la grilla y en la línea de detalle. */}
                              {esReemb&&<button disabled={busy===m.id} onClick={()=>setReembFor(reembFor===m.id?null:m.id)} title='La factura es de gastos/reembolso: se marca pagada pero no cuenta como ingreso' style={{fontSize:10,fontWeight:600,borderRadius:20,padding:'4px 10px',border:'none',cursor:busy===m.id?'default':'pointer',background:reembFor===m.id?'#FAECE7':C.bgSoft,color:reembFor===m.id?C.coralText:C.muted}}>Es reembolso{reembFor===m.id?<>{" "}<Gl n='chevU'/></>:<>{" "}<Gl n='chevD'/></>}</button>}
                              <button disabled={busy===m.id} onClick={()=>reconciliar(m,sug,'manual')} style={{marginLeft:'auto',background:C.accent,color:'#fff',fontSize:11,fontWeight:600,borderRadius:6,padding:'5px 16px',border:'none',cursor:busy===m.id?'default':'pointer',whiteSpace:'nowrap'}}>Conciliar ahora</button>
                            </div>
                            {reembFor===m.id&&<div style={{marginTop:7,background:'#FAECE7',borderRadius:8,padding:'8px 10px'}}>
                              <div style={{fontSize:10,color:C.coralText,marginBottom:6,lineHeight:1.4}}>Factura de gastos: se marca <b>pagada</b> con respaldo, pero <b>No cuenta como ingreso</b>. Elige:</div>
                              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                                <button disabled={busy===m.id} onClick={()=>{setReembFor(null);reconciliarReembolso(m,sug,false)}} style={{fontSize:10,fontWeight:700,borderRadius:8,padding:'5px 12px',border:`1px solid ${C.coralText}`,background:'#fff',color:C.coralText,cursor:busy===m.id?'default':'pointer'}}>Solo saldar (no ingreso)</button>
                                <button disabled={busy===m.id} onClick={()=>{setReembFor(null);reconciliarReembolso(m,sug,true)}} style={{fontSize:10,fontWeight:700,borderRadius:8,padding:'5px 12px',border:'none',background:C.tealText,color:'#fff',cursor:busy===m.id?'default':'pointer'}}>Saldar + fondo por rendir</button>
                              </div>
                            </div>}
                          </div>) })()}
                        {(()=>{ const grp=grupoPago(m); if(!grp) return null
                          const depSum=grp.transfers.reduce((a,t)=>a+(t.monto||0),0); const facSum=grp.facturas.reduce((a,f)=>a+saldoFactura(f),0)
                          const nomDep=t=>(t.rut_contraparte&&nameByRut[crNormRut(t.rut_contraparte)])||t.nombre_contraparte||cmap[m.cliente_id]||'—'
                          return (
                          <div style={{background:'#fff',border:`1px solid #BFE3D5`,borderRadius:10,padding:'9px 10px',marginBottom:6}} onClick={e=>e.stopPropagation()}>
                            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,marginBottom:6}}>
                              <span style={{fontSize:11,fontWeight:700,color:C.greenText,minWidth:0}}><Sparkle/> Pago en grupo · {cmap[m.cliente_id]||'cliente'}</span>
                              <button disabled={busy===m.id} onClick={()=>reconciliarGrupo(grp.transfers,grp.facturas)} style={{background:C.accent,color:'#fff',fontSize:11,fontWeight:600,borderRadius:6,padding:'5px 13px',border:'none',cursor:busy===m.id?'default':'pointer',whiteSpace:'nowrap',flexShrink:0}}>Conciliar grupo</button>
                            </div>
                            <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
                              <div style={{flex:'1 1 150px',minWidth:130}}>
                                <div style={{...SEC_LBL,marginBottom:3}}>Los depósitos · {grp.transfers.length}</div>
                                {grp.transfers.map(t=>(<div key={t.id} style={{padding:'3px 0',borderTop:`1px solid ${C.bgSoft}`}}>
                                  <div style={{display:'flex',justifyContent:'space-between',gap:6}}><span style={{fontSize:11,fontWeight:700,color:C.greenText}}>+{fmtM(t.monto)}</span><span style={{fontSize:10,color:C.textSoft}}>{fmtFechaDMY(t.fecha)}</span></div>
                                  <div style={{fontSize:10,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{nomDep(t)}{t.rut_contraparte?` · ${t.rut_contraparte}`:''}</div>
                                  {t.n_operacion&&<div style={{fontSize:9,color:C.textSoft}}>N° op. {t.n_operacion}</div>}
                                </div>))}
                                <div style={{display:'flex',justifyContent:'space-between',borderTop:`1px solid ${C.border}`,marginTop:4,paddingTop:4,fontSize:11,fontWeight:700,color:C.text}}><span>Suma</span><span>{fmtM(depSum)}</span></div>
                              </div>
                              <div style={{flex:'1 1 150px',minWidth:130}}>
                                <div style={{...SEC_LBL,marginBottom:3}}>Las facturas · {grp.facturas.length}</div>
                                {grp.facturas.map(f=>(<div key={f.id} style={{padding:'3px 0',borderTop:`1px solid ${C.bgSoft}`}}>
                                  <div style={{display:'flex',justifyContent:'space-between',gap:6}}><span style={{fontSize:11,fontWeight:700,color:C.accent}}>Factura N° {folioN(f.invoice_no)||'—'}</span><span style={{fontSize:11,fontWeight:700,color:C.text}}>{fmtM(saldoFactura(f))}</span></div>
                                  <div style={{fontSize:10,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.receptor_name||cmap[m.cliente_id]||'—'}{f.receptor_rut?` · ${fmtRutCL(f.receptor_rut)}`:''}</div>
                                  <div style={{fontSize:9,color:C.textSoft,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.issued_at?fmtFechaDMY(f.issued_at):''}{f.concept?` · ${f.concept}`:''}</div>
                                </div>))}
                                <div style={{display:'flex',justifyContent:'space-between',borderTop:`1px solid ${C.border}`,marginTop:4,paddingTop:4,fontSize:11,fontWeight:700,color:C.text}}><span>Suma</span><span>{fmtM(facSum)}</span></div>
                              </div>
                            </div>
                            <div style={{fontSize:9.5,fontWeight:700,color:depSum===facSum?C.greenText:C.soonText,background:depSum===facSum?C.greenBg:C.soonBg,borderRadius:20,padding:'2px 8px',marginTop:6,display:'inline-block',whiteSpace:'nowrap'}}>{depSum===facSum?`✓ cuadra exacto · ${fmtM(grp.total)}`:`dif ${fmtM(Math.abs(depSum-facSum))}`}</div>
                          </div>
                        ) })()}
                        {esDesc&&descProta&&(()=>{ const f=descProta.f; const dif=descProta.saldo-resto; const viaGlosa=!!folioFac; return (
                          <div onClick={e=>e.stopPropagation()} style={{background:C.ambarBg,border:`1px solid ${C.soon}`,borderRadius:10,padding:'9px 10px',marginBottom:6,display:'flex',alignItems:'center',gap:9}}>
                            <SIcon n='file' s={14} c={C.soonText}/>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{fontSize:12,fontWeight:700,color:C.soonText,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{viaGlosa?`La glosa apunta a la N° ${folioN(f.invoice_no)||'—'}`:`Pago parcial de N° ${folioN(f.invoice_no)||'—'}`}</div>
                              <div style={{fontSize:10,color:C.soonText,opacity:.9}}>saldo {fmtM(descProta.saldo)}{dif>0?` · pagó ${fmtM(dif)} menos`:dif<0?` · sobran ${fmtM(-dif)}`:''}</div>
                            </div>
                            <button disabled={busy===m.id} onClick={()=>reconciliar(m,f,'manual')} style={{fontSize:10,fontWeight:700,color:C.soonText,background:'transparent',border:`1px solid ${C.soonText}`,borderRadius:8,padding:'5px 11px',cursor:busy===m.id?'default':'pointer',whiteSpace:'nowrap',flexShrink:0}}>Imputar a N° {folioN(f.invoice_no)||'—'}</button>
                          </div>) })()}
                        {esDesc&&(deudaFacs.length>0||reembSum>0||onBuscarSII)&&(()=>{
                          const searchSvg=<svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke={C.azulInfo} strokeWidth='2.2' strokeLinecap='round'><circle cx='11' cy='11' r='7'/><path d='M21 21l-4.3-4.3'/></svg>
                          const rows=[]
                          if(deudaFacs.length>0) rows.push({icon:<SIcon n='wallet' s={13} c={C.overdueText}/>,c:C.overdueText,lab:`Deuda del cliente · ${deudaFacs.length} factura${deudaFacs.length!==1?'s':''}`,val:fmtM(deudaSum),on:()=>{ if(otraFacFor!==m.id) setOtraFacFor(m.id) }})
                          if(reembSum>0) rows.push({icon:<SIcon n='receipt' s={13} c={C.tealText}/>,c:C.tealText,lab:'Gastos por reembolsar',val:fmtM(reembSum),on:()=>{ let acc=0; const sel=new Set(); for(const g of reembList){ if(acc>=resto) break; sel.add(g.id); acc+=(g.amount||0) } setDevolSel(sel); setDevolFor(m.id) }})
                          if(onBuscarSII) rows.push({icon:searchSvg,c:C.azulInfo,lab:'Buscar en el SII',val:String(m.fecha||'').slice(0,7),on:()=>buscarMovSII(m)})
                          return (
                          <div onClick={e=>e.stopPropagation()} style={{marginBottom:6}}>
                            <div style={{...SEC_LBL,margin:'2px 1px 2px'}}>Contexto</div>
                            {rows.map((r,i)=>(
                              <div key={i} onClick={busy===m.id?undefined:r.on} style={{display:'flex',alignItems:'center',gap:9,padding:'7px 6px',borderTop:i>0?`1px solid ${C.bgSoft}`:'none',borderRadius:8,cursor:busy===m.id?'default':'pointer'}}>
                                {r.icon}
                                <span style={{flex:1,minWidth:0,fontSize:11,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.lab}</span>
                                <span style={{fontSize:11,fontWeight:700,color:r.c,fontVariantNumeric:'tabular-nums'}}>{r.val}</span>
                                <span style={{color:C.textSoft,fontSize:12,flexShrink:0}}><Gl n='chevron'/></span>
                              </div>
                            ))}
                          </div>) })()}
                        {(()=>{ const dv=devolucionCands(m,(m.monto||0)-(m.monto_conciliado||0)); if(!dv.length) return null
                          return <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,padding:'8px 10px',marginBottom:6}} onClick={e=>e.stopPropagation()}>
                            <div style={{fontSize:11,fontWeight:700,color:C.accent,marginBottom:5}}>Devolución de un pago nuestro</div>
                            {dv.map(c=>{ const pend=(c.monto||0)-(c.monto_conciliado||0); return (
                              <div key={c.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,padding:'5px 0',borderTop:`1px solid ${C.bgSoft}`}}>
                                <span onClick={()=>irMov(c.id)} style={{minWidth:0,fontSize:11,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',cursor:'pointer'}}>Cargo del <b>{fmtFechaDMY(c.fecha)}</b> · {fmtM(pend)}</span>
                                <button disabled={busy===m.id} onClick={()=>registrarDevolucion(m,c)} style={{background:C.accent,color:'#fff',fontSize:10,fontWeight:600,borderRadius:6,padding:'4px 11px',border:'none',cursor:busy===m.id?'default':'pointer',flexShrink:0,whiteSpace:'nowrap'}}>Es la devolución</button>
                              </div>) })}
                          </div> })()}
                        {factResto.length>0&&(
                          <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,padding:'8px 10px',marginBottom:6}} onClick={e=>e.stopPropagation()}>
                            <div style={{fontSize:11,fontWeight:700,color:C.accent,marginBottom:5}}>Ninguna factura calza sola con {fmtM(m.monto)}. Opciones:</div>
                            {factResto.map(({f,saldo,resto})=>(
                              <div key={f.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,padding:'5px 0',borderTop:`1px solid ${C.bgSoft}`}}>
                                <span style={{minWidth:0,fontSize:11,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}><b>Factura N° {folioN(f.invoice_no)||'—'}</b> · {fmtM(saldo)}{f.receptor_name?<span style={{color:C.muted}}> · {f.receptor_name}</span>:''}<br/><span style={{fontSize:10,color:C.textSoft}}>{f.issued_at?`emitida ${fmtFechaDMY(f.issued_at)}`:''}{f.due?` · vence ${fmtFechaDMY(f.due)}`:''}</span> <span style={{fontSize:10,color:C.tealText}}>· + {fmtM(resto)} para gastos/anticipo</span></span>
                                <button disabled={busy===m.id} onClick={()=>reconciliar(m,f,'manual')} style={{background:C.accent,color:'#fff',fontSize:10,fontWeight:600,borderRadius:6,padding:'4px 11px',border:'none',cursor:busy===m.id?'default':'pointer',whiteSpace:'nowrap',flexShrink:0}}>Conciliar esta</button>
                              </div>
                            ))}
                            <div style={{fontSize:10,color:C.muted,marginTop:5}}>Concilias la factura y el resto lo colocas con los botones de abajo (Fondo por Rendir · Saldo a Favor · Devolución). O usa "Buscar en SII" si la factura del resto no está.</div>
                          </div>
                        )}
                        {hayCalce&&!showOtras
                          ? <button onClick={()=>toggleOtras(m.id)} style={{display:'flex',alignItems:'center',gap:6,width:'100%',marginTop:1,padding:'9px 0 3px',border:'none',borderTop:`1px solid ${C.bgSoft}`,background:'none',color:C.accent,fontSize:12,fontWeight:700,cursor:'pointer'}}>No, es otro pago <span style={{color:C.textSoft,fontWeight:400}}><Gl n='chevD'/></span>{myConc.length>0&&<span style={{marginLeft:'auto',color:C.soon,fontWeight:700}}>Resta {fmtM(resto)}</span>}</button>
                          : <div style={{display:'flex',alignItems:'center',gap:8,padding:'7px 0 2px',marginTop:1,borderTop:`1px solid ${C.bgSoft}`}}>
                              <span style={{fontSize:9,fontWeight:700,color:C.textSoft,textTransform:'uppercase',letterSpacing:.3}}>¿A qué corresponde?</span>
                              {hayCalce&&<button onClick={()=>toggleOtras(m.id)} style={{fontSize:10,color:C.muted,background:'none',border:'none',cursor:'pointer',fontWeight:600}}><Gl n='chevU'/> ocultar</button>}
                              {myConc.length>0&&<span style={{fontSize:10,fontWeight:700,color:C.soon,marginLeft:'auto'}}>Resta {fmtM(resto)}</span>}
                            </div>}
                        {showOtras&&<>
                        {(()=>{ const gs=gastosReembolsables(m.cliente_id)
                          const optRow=(icon,ic,ibg,name,hint,onClick,open,extra)=>(<div key={name}><div onClick={busy===m.id?undefined:onClick} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 2px',borderTop:`1px solid ${C.bgSoft}`,cursor:busy===m.id?'default':'pointer'}}><span style={{width:26,height:26,borderRadius:8,background:ibg,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SIcon n={icon} s={15} c={ic}/></span><div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:600,color:C.text}}>{name}</div>{hint&&<div style={{fontSize:10,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{hint}</div>}</div><span style={{color:C.textSoft,fontSize:13,flexShrink:0}}>{open?<Gl n='chevD'/>:<Gl n='chevron'/>}</span></div>{open&&extra}</div>)
                          const fam=abFam[m.id]
                          const backHd=(label)=><div onClick={()=>setAbFam(p=>({...p,[m.id]:undefined}))} style={{display:'flex',alignItems:'center',gap:7,padding:'6px 2px 4px',cursor:'pointer'}}><span style={{color:C.accent,fontSize:15}}><Gl n='chevL'/></span><span style={{fontSize:11,fontWeight:700,color:C.accent}}>{label}</span><span style={{marginLeft:'auto',fontSize:11,fontWeight:700,color:C.soon,flexShrink:0}}>Resta {fmtM(resto)}</span></div>
                          return <div style={{marginBottom:6}}>
                            {!fam&&<div style={{display:'flex',gap:8,padding:'4px 0 2px'}}>
                              <button onClick={()=>setAbFam(p=>({...p,[m.id]:'cliente'}))} style={{flex:1,background:'#F2F7FB',border:'1px solid #CFE0EC',borderRadius:12,padding:'11px 8px',cursor:'pointer',textAlign:'center',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:2}}>
                                <div style={{fontSize:13,fontWeight:700,color:C.accent}}>Pago de cliente</div><div style={{fontSize:9,color:C.muted}}>factura · anticipo · fondo</div>
                              </button>
                              <button onClick={()=>setAbFam(p=>({...p,[m.id]:'oficina'}))} style={{flex:1,background:C.greenBg,border:'1px solid #BFE0CF',borderRadius:12,padding:'11px 8px',cursor:'pointer',textAlign:'center',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:2}}>
                                <div style={{fontSize:13,fontWeight:700,color:C.greenText}}>Ingreso de oficina</div><div style={{fontSize:9,color:C.muted}}>comisión · subarriendo · reembolso</div>
                              </button>
                            </div>}
                            {fam==='cliente'&&<>
                            {backHd('Pago de cliente')}
                            {optRow('file',C.accent,C.azulBg,'Otra factura','Elegir del estado de cuenta',()=>setOtraFacFor(otraFacFor===m.id?null:m.id),otraFacFor===m.id,null)}
                            {combo&&optRow('receipt',C.accent,C.azulBg,`Varias facturas · ${combo.length}`,'Un pago que salda 2 o más',()=>setComboFor(comboFor===m.id?null:m.id),comboFor===m.id,null)}
                            {fmg&&optRow('wallet',C.tealText,C.tealBg,`Factura N° ${folioN(fmg.factura.invoice_no)||'—'} + gastos`,`Paga la factura y deja ${fmtM(fmg.excess)} de fondo`,()=>reconciliarFacturaGastos(m,fmg),false,null)}
                            {optRow('clock',C.azulInfo,C.azulBg,'Anticipo · saldo a favor','Pagó antes de la factura',()=>{ if(splitMov===m.id){setSplitMov(null);return} setSplitAdel(String(resto)); setSplitMov(m.id) },splitMov===m.id,null)}
                            {optRow('wallet',C.tealText,C.tealBg,'Fondo por rendir',`Adelanto para gastos · ${fmtM(resto)}`,()=>setFondoFor(fondoFor===m.id?null:m.id),fondoFor===m.id,
                              <div onClick={e=>e.stopPropagation()} style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap',padding:'0 2px 6px 36px'}}>
                                <button disabled={busy===m.id} onClick={()=>{setFondoFor(null);crearFondoProvision(m)}} style={{fontSize:11,fontWeight:700,borderRadius:8,padding:'6px 14px',border:'none',background:C.tealText,color:'#fff',cursor:busy===m.id?'default':'pointer'}}>Confirmar fondo · {fmtM(resto)}</button>
                                {gs.length>0&&<button disabled={busy===m.id} onClick={()=>{ let acc=0; const sel=new Set(); for(const g of gs){ if(acc>=resto) break; sel.add(g.id); acc+=(g.amount||0) } setDevolSel(sel); setFondoFor(null); setDevolFor(devolFor===m.id?null:m.id) }} style={{fontSize:10,fontWeight:600,color:C.coralText,background:'none',border:'none',cursor:busy===m.id?'default':'pointer'}}>¿Es devolución de gastos?</button>}
                              </div>)}
                            {optRow('exchange',C.muted,C.bgWarm,'Otro tipo de pago','No es de un cliente',()=>setOtroFor(otroFor===m.id?null:m.id),otroFor===m.id,
                              <div onClick={e=>e.stopPropagation()} style={{padding:'0 2px 6px 36px'}}>
                                <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:7}}>{CATS_ABONO.filter(c=>c!=='Provisión de gastos').map(c=>{ const t=TAG_STY[c]||{bg:C.bgWarm,color:C.grisText}; return <button key={c} onClick={()=>{setOtroFor(null);setCategoria(m,c)}} style={{fontSize:10,fontWeight:600,borderRadius:8,padding:'4px 10px',border:`1px solid ${C.border}`,background:'#fff',color:t.color,cursor:'pointer'}}>{c}</button> })}</div>
                                <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                                  <span style={{fontSize:10,color:C.muted}}>¿Corresponde a alguien del sistema?</span>
                                  <AsignarClienteInline bill={{id:m.id}} clients={clients} onAssign={(_,cid)=>{setOtroFor(null);identificar(m,cid)}} label='Asignar a…' placeholder='Buscar persona o entidad…'/>
                                </div>
                              </div>)}
                            </>}
                            {fam==='oficina'&&ofiIngresoPicker(m,resto)}
                          </div>
                        })()}
                        {splitMov===m.id&&(()=>{ const resto=(m.monto||0)-(m.monto_conciliado||0); const adel=Math.max(0,Math.min(parseInt(splitAdel)||0,resto)); const fond=resto-adel; return (
                          <div onClick={e=>e.stopPropagation()} style={{marginBottom:6,display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                            <span style={{fontSize:9.5,fontWeight:700,color:C.azulInfo,background:C.azulBg,borderRadius:20,padding:'2px 8px',display:'inline-flex',alignItems:'center',gap:5,whiteSpace:'nowrap'}}>Anticipo <input value={splitAdel} onChange={e=>setSplitAdel(e.target.value.replace(/[^0-9]/g,''))} inputMode='numeric' style={{width:80,border:`1px solid ${C.azulInfo}`,borderRadius:4,padding:'1px 5px',fontSize:11,fontWeight:600,color:C.accent,background:'#fff',outline:'none'}}/></span>
                            <span style={{fontSize:9.5,fontWeight:700,color:C.tealText,background:C.tealBg,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap'}}>Fondo por Rendir {fmtM(fond)}</span>
                            <button disabled={busy===m.id||(adel<=0&&fond<=0)} onClick={()=>splitAdelantoFondo(m,adel)} style={{fontSize:10,fontWeight:600,color:'#fff',background:C.accent,border:'none',borderRadius:6,padding:'3px 11px',cursor:busy===m.id?'default':'pointer'}}>Confirmar</button>
                          </div>) })()}
                        {devolFor===m.id&&(()=>{ const gs=gastosReembolsables(m.cliente_id); const resto=(m.monto||0)-(m.monto_conciliado||0); const sum=gs.filter(g=>devolSel.has(g.id)).reduce((a,g)=>a+(g.amount||0),0); return (
                          <div onClick={e=>e.stopPropagation()} style={{marginBottom:6,background:C.bgPanel,border:'1px solid #F0997B',borderRadius:10,padding:'9px 11px'}}>
                            <div style={{fontSize:10,fontWeight:700,color:C.coralText,marginBottom:6}}>¿Qué gastos cubre esta devolución de {fmtM(resto)}? <span style={{fontWeight:400,color:C.muted}}>(opcional · marca trazabilidad)</span></div>
                            {gs.map(g=>{ const on=devolSel.has(g.id); const cn=clients.find(c=>String(c.id)===String(g.client_id))?.name||''; return (
                              <div key={g.id} onClick={()=>setDevolSel(p=>{const n=new Set(p);n.has(g.id)?n.delete(g.id):n.add(g.id);return n})} style={{display:'flex',alignItems:'center',gap:8,padding:'3px 0',cursor:'pointer',fontSize:11}}>
                                <span style={{width:15,height:15,borderRadius:4,border:`2px solid ${on?C.coralText:C.border}`,background:on?C.coralText:'#fff',color:'#fff',fontSize:9,flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center'}}>{on?<Gl n='tick'/>:''}</span>
                                <span style={{flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{g.category&&g.category!=='Otro'?<b style={{color:C.azulInfo}}>{g.category} </b>:''}{g.concept||'—'} <span style={{color:C.textSoft}}>· {g.date?fmtFechaDMY(g.date):''}</span></span>
                                <span style={{fontWeight:600,whiteSpace:'nowrap',fontVariantNumeric:'tabular-nums'}}>{fmtM(g.amount)}</span>
                              </div>) })}
                            {gs.length===0&&<div style={{fontSize:10,color:C.muted}}>Este cliente no tiene gastos pendientes de reembolsar.</div>}
                            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:7,paddingTop:6,borderTop:`1px solid ${C.border}`}}>
                              <span style={{fontSize:10,color:C.muted}}>Marcas <b style={{color:C.coralText}}>{fmtM(sum)}</b> de {fmtM(resto)}{sum>resto?' · excede':''}</span>
                              <div style={{display:'flex',gap:6}}>
                                <button onClick={()=>{setDevolFor(null);setDevolSel(new Set())}} style={{fontSize:10,color:C.muted,background:'none',border:'none',cursor:'pointer'}}>Cancelar</button>
                                <button disabled={busy===m.id} onClick={()=>devolucionGastos(m,[...devolSel])} style={{fontSize:10,fontWeight:700,borderRadius:8,padding:'4px 12px',border:'none',background:C.coralText,color:'#fff',cursor:busy===m.id?'default':'pointer'}}>Acreditar devolución {fmtM(resto)}</button>
                              </div>
                            </div>
                          </div>
                        )})()}
                        {combo&&comboFor===m.id&&(()=>{ const tot=combo.reduce((s,f)=>s+saldoFactura(f),0); return (
                          <div style={{display:'flex',flexDirection:'column',gap:4,marginBottom:6,paddingLeft:8}}>
                            {combo.map(f=>(<button key={f.id} disabled={busy===m.id} onClick={()=>{setComboFor(null);reconciliar(m,f,'manual')}} title='Conciliar solo esta factura' style={{textAlign:'left',fontSize:11,color:C.text,background:'none',border:`1px solid ${C.border}`,borderRadius:6,padding:'4px 8px',cursor:busy===m.id?'default':'pointer'}}>Factura N° {folioN(f.invoice_no)||'—'} · {mesAbbr(f.issued_at)} · {(f.concept||'').slice(0,28)} · <b>{fmtM(saldoFactura(f))}</b></button>))}
                            <div style={{fontSize:10,color:C.muted}}>Suma: {fmtM(tot)} {tot===(m.monto||0)?'=':'≠'} abono {fmtM(m.monto)} · toca una para conciliar solo esa</div>
                            <div style={{display:'flex',gap:8,marginTop:2}}>
                              <button disabled={busy===m.id} onClick={()=>{setComboFor(null);reconciliarCombo(m,combo)}} style={{fontSize:10,fontWeight:700,borderRadius:8,padding:'4px 12px',border:'none',background:C.accent,color:'#fff',cursor:'pointer'}}>Confirmar las {combo.length}</button>
                              <button onClick={()=>setComboFor(null)} style={{fontSize:10,color:C.muted,background:'none',border:'none',cursor:'pointer'}}>Cancelar</button>
                            </div>
                          </div>) })()}
                        {otraFacFor===m.id&&(()=>{
                          // Estado de cuenta del cliente — se abre desde la fila "Otra factura": agrupado por razón social, montos a la derecha, fila → detalle.
                          const payTms=m.fecha?new Date(m.fecha+'T12:00').getTime():null; const qq=facBuscaQ.trim().toLowerCase()
                          const facsShow=facsAll.filter(f=> !qq || (`n°${folioN(f.invoice_no)||''} ${f.concept||''} ${f.amount||''}`.toLowerCase().includes(qq))).sort((a,b)=>(a.issued_at||'').localeCompare(b.issued_at||''))   // FIFO: la más antigua primero (no imputar a la nueva y dejar vacíos)
                          const grupos={}; facsShow.forEach(f=>{ const rs=f.receptor_name||cmap[m.cliente_id]||'—'; (grupos[rs]=grupos[rs]||[]).push(f) })
                          return (<div style={{borderLeft:`2px solid ${C.border}`,paddingLeft:8}}>
                            {facsAll.length>=8&&<input value={facBuscaQ} onChange={e=>setFacBuscaQ(e.target.value)} onClick={e=>e.stopPropagation()} placeholder='Buscar factura: N°, concepto, monto…' style={{width:'100%',boxSizing:'border-box',fontSize:11,padding:'5px 8px',borderRadius:6,border:`1px solid ${C.border}`,marginBottom:5,outline:'none'}}/>}
                            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,marginBottom:3}}>
                              <div style={{...SEC_LBL}}>Facturas del cliente{facsAll.length?` · ${facsAll.length}`:''} <span style={{fontWeight:500,textTransform:'none',letterSpacing:0}}>· más antigua primero</span></div>
                              {onBuscarSII&&(()=>{ const mesPago=String(m.fecha||'').slice(0,7); const buscando=siiMovBusy===m.id; return <button disabled={buscando||!!siiBuscando} onClick={e=>{e.stopPropagation();buscarMovSII(m)}} title={`Buscar en el SII la factura de este pago (${mesPago||'mes del pago'} y meses atrás), sin salir de aquí`} style={{fontSize:10,fontWeight:600,color:'#fff',background:C.azulInfo,border:'none',borderRadius:8,padding:'3px 10px',cursor:(buscando||siiBuscando)?'default':'pointer',opacity:(buscando||siiBuscando)?.6:1,flexShrink:0}}>{buscando?`Buscando ${siiBuscando?.mes||''}…`:'Buscar en SII'}</button> })()}
                            </div>
                            {facsAll.length===0&&!(siiMovHit&&siiMovHit.movId===m.id)&&<span style={{fontSize:10,color:C.muted}}>No encontramos la factura de este pago — <b>Buscar en SII</b> la trae del portal, o clasifícalo arriba como <b>Saldo a Favor</b> o <b>Fondo por Rendir</b>.</span>}
                            {siiMovHit&&siiMovHit.movId===m.id&&(()=>{
                              if(siiMovHit.err) return <div style={{fontSize:10,color:C.overdueText,background:C.overdueBg,borderRadius:8,padding:'5px 9px',marginTop:4}}>{siiMovHit.err}</div>
                              const rows=siiMovHit.rows||[]; const abs=Math.abs(Number(m.monto)||0)
                              if(!rows.length) return <div style={{fontSize:10,color:C.muted,background:C.bgSoft,borderRadius:8,padding:'6px 9px',marginTop:4}}>Sin facturas nuevas en el SII para este pago{siiMovHit.aplicadas?` (${siiMovHit.aplicadas} ya calzada${siiMovHit.aplicadas!==1?'s':''} arriba)`:''}.{onCotejarSII&&<> · <button onClick={e=>{e.stopPropagation();onCotejarSII(String(m.fecha||'').slice(0,7))}} style={{fontSize:10,fontWeight:600,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',textDecoration:'underline',padding:0}}>Ver el mes completo</button></>}</div>
                              return <div style={{marginTop:5,marginBottom:4,paddingLeft:8}}>
                                <div style={{fontSize:9,fontWeight:700,color:C.azulInfo,textTransform:'uppercase',letterSpacing:.3,marginBottom:3}}>En el SII · {rows.length} que calza{rows.length!==1?'n':''} con este pago</div>
                                {rows.map(row=>{ const exacto=Math.abs(Number(row.monto)||0)===abs; const ing=siiMovIng===row.folio; return (
                                  <div key={row.folio} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,fontSize:11,padding:'5px 0',borderBottom:`1px solid #F1F1F1`}}>
                                    <span style={{minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}><b>Factura N° {folioN(row.folio)||row.folio}</b> · {fmtM(row.monto)} <span style={{color:C.textSoft}}>· {fmtFechaDMY(row.fechaEmision)}</span>{exacto&&<span style={{marginLeft:6,fontSize:9.5,fontWeight:700,color:C.greenText,background:C.greenBg,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap'}}>Monto exacto</span>}<br/><span style={{color:C.muted,fontSize:10}}>{row.receptor||'—'}{row.rut?` · ${fmtRutCL(row.rut)}`:''}</span></span>
                                    <button disabled={ing} onClick={e=>{e.stopPropagation();ingresarYConciliar(m,row)}} style={{fontSize:10,fontWeight:700,borderRadius:8,padding:'4px 11px',border:'none',background:exacto?C.accent:C.muted,color:'#fff',cursor:ing?'default':'pointer',flexShrink:0}}>{ing?'Ingresando…':'Ingresar y conciliar'}</button>
                                  </div>) })}
                              </div>
                            })()}
                            {Object.entries(grupos).map(([rs,fs])=>{
                              const esConc=f=>{ const ap=aplicadoByFactura[f.id]||0; return (f.amount||0)>0 && ap>=(f.amount||0) }
                              const activas=fs.filter(f=>!esConc(f)), conciliadas=fs.filter(f=>esConc(f)); const concShown=rsConcOpen.has(rs)
                              const renderFac=f=>{ const open=detFor===f.id; return (
                                  <div key={f.id}>
                                    <div onClick={()=>setDetFor(open?null:f.id)} style={{display:'flex',justifyContent:'space-between',gap:8,fontSize:11,padding:'5px 0',cursor:'pointer',borderBottom:open?'none':`1px solid #F1F1F1`}}>
                                      <div style={{minWidth:0,flex:1}}>
                                        <div style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}><b>Factura N° {folioN(f.invoice_no)||'—'}</b> <span style={{color:C.text}}>· {f.concept||'sin concepto'}</span></div>
                                        <div style={{fontSize:10,color:C.textSoft,marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.receptor_name||cmap[m.cliente_id]||'—'}{f.receptor_rut?<> · <span onClick={e=>e.stopPropagation()}><Copyable text={f.receptor_rut} title='Copiar RUT' style={{color:C.textSoft}}>{fmtRutCL(f.receptor_rut)}</Copyable></span></>:''} · emitida {fmtFechaDMY(f.issued_at)}{f.due?` · vence ${fmtFechaDMY(f.due)}`:''}</div>
                                      </div>
                                      <span style={{textAlign:'right',flexShrink:0}}><b style={{whiteSpace:'nowrap'}}>{fmtM(f.amount)}</b><br/>{(()=>{ const e=estadoFacturaLabel(f,aplicadoByFactura[f.id]||0,cartolaHasta); const sld=['Pendiente','Vencido'].includes(f.status); return <span style={{fontSize:9,fontWeight:600,color:(e&&e.fg)||C.muted}}>{(e&&e.label)||f.status}{sld?` · saldo ${fmtM(saldoFactura(f))}`:''}</span> })()}</span>
                                    </div>
                                    {open&&(()=>{ const ap=aplicadoByFactura[f.id]||0; const est=estadoFacturaLabel(f,ap,cartolaHasta); const movsF=(conc||[]).filter(c=>String(c.factura_id)===String(f.id)&&c.tipo_destino==='factura').map(c=>{ const mm=(movs||[]).find(x=>String(x.id)===String(c.movimiento_id)); return mm?`${fmtFechaDMY(mm.fecha)} · ${fmtM(c.monto_aplicado)}`:null }).filter(Boolean); return (
                                    <div style={{padding:'7px 9px 8px',background:C.bgSoft,borderRadius:6,fontSize:11,color:C.muted,lineHeight:1.6,margin:'2px 0 4px'}}>
                                      {est&&<div style={{marginBottom:4}}><span style={{fontSize:9.5,fontWeight:700,padding:'2px 8px',borderRadius:20,background:est.bg,color:est.fg,whiteSpace:'nowrap'}}>{est.label}</span></div>}
                                      <div>Concepto: <b style={{color:C.text}}>{f.concept||'—'}</b></div>
                                      <div>Razón social: <b style={{color:C.text}}>{f.receptor_name||'—'}</b>{f.receptor_rut?` · ${fmtRutCL(f.receptor_rut)}`:''}</div>
                                      <div>Emisión: {fmtFechaDMY(f.issued_at)}{f.due?` · vence ${fmtFechaDMY(f.due)}`:''}</div>
                                      <div>Monto: {fmtM(f.amount)} · Saldo: {fmtM(saldoFactura(f))}</div>
                                      {f.status==='Pagado'&&<div>Respaldo banco: <b style={{color:ap>0?C.greenText:C.overdueText}}>{ap>0?`${fmtM(ap)}${ap<(f.amount||0)?` de ${fmtM(f.amount)}`:''}`:'sin movimiento (marcada a mano)'}</b>{movsF.length?` · ${movsF.join(', ')}`:''}</div>}
                                      <div style={{display:'flex',gap:8,alignItems:'center',marginTop:6,flexWrap:'wrap'}}>
                                        <button disabled={busy===m.id} onClick={()=>{setDetFor(null);reconciliar(m,f,'manual')}} style={{fontSize:10,fontWeight:700,borderRadius:8,padding:'4px 12px',border:'none',background:C.accent,color:'#fff',cursor:busy===m.id?'default':'pointer'}}>Conciliar con esta</button>
                                        {ap>0&&(()=>{ const cr=(conc||[]).find(c=>String(c.factura_id)===String(f.id)&&c.tipo_destino==='factura'); const mm=cr&&(movs||[]).find(x=>String(x.id)===String(cr.movimiento_id)); return mm?<button disabled={busy===m.id} onClick={async()=>{ if(await appConfirm(`¿Liberar el calce de la Factura N° ${folioN(f.invoice_no)}? El pago vuelve a "por conciliar" para reasignarlo.`)){ setDetFor(null); deshacer(mm) } }} style={{fontSize:10,fontWeight:700,borderRadius:8,padding:'4px 12px',border:'1px solid #F0997B',background:'#fff',color:C.overdueText,cursor:busy===m.id?'default':'pointer'}}>Liberar calce</button>:null })()}
                                      </div>
                                    </div>) })()}
                                  </div>) }
                              return (
                              <div key={rs} style={{marginBottom:5}}>
                                <div style={{fontSize:9,fontWeight:700,color:C.accent,textTransform:'uppercase',letterSpacing:.3,borderBottom:`1px solid ${C.border}`,paddingBottom:3,marginBottom:1}}>{rs}</div>
                                {activas.map(renderFac)}
                                {conciliadas.length>0&&<>
                                  <div onClick={()=>setRsConcOpen(s=>{const n=new Set(s); n.has(rs)?n.delete(rs):n.add(rs); return n})} style={{fontSize:9,fontWeight:600,color:C.muted,cursor:'pointer',padding:'4px 0'}}>{conciliadas.length} cobrada{conciliadas.length!==1?'s':''} y conciliada{conciliadas.length!==1?'s':''} {concShown?<Gl n='chevD'/>:<Gl n='chevron'/>}</div>
                                  {concShown&&conciliadas.map(renderFac)}
                                </>}
                              </div>
                            )})}
                          </div>) })()}
                        </>}
                      </>}
                    </div>
                  )
                })()}
                {(concByMov[m.id]||[]).length>0&&<div style={{fontSize:9,color:C.textSoft,marginTop:6,borderTop:`1px solid #F1F1F1`,paddingTop:4,lineHeight:1.4}}>{(concByMov[m.id]).map((r,i)=>{const dest={factura:'Conciliado con factura',fondo:'Fondo por rendir',anticipo:'Saldo a favor',gasto:m.tipo==='cargo'?'Gasto':'Reembolso de gastos',ingreso:'Ingreso de oficina',tercero:'Pago de comisión',devolucion:'Devolución de un pago'}[r.tipo_destino]||r.tipo_destino;return <div key={i}>{dest} · {r.origen==='auto'?'automático':'manual'}{r.created_at?` · ${fmtFechaDMY(r.created_at)}`:''}</div>})}</div>}
                </div>
    )
  }
  // ESCRITORIO · Abonos = bandeja + detalle (render aprobado, opción A). Arriba UNA foto: "Por resolver" protagonista (mismo criterio que el filtro de la lista),
  // sus partes son los filtros, y "Listo para conciliar" es un aviso con su botón. Izquierda: lista corta; derecha: el movimiento elegido (detalleMov, fuente única).
  const _MESL=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
  const quienMov = m => (m.cliente_id&&cmap[m.cliente_id])||(m.rut_contraparte&&nameByRut[crNormRut(m.rut_contraparte)])||m.nombre_contraparte||(m.es_interno?'Traspaso interno':tipoMov(m.descripcion))
  // Escritorio · Cargos: misma vista que Abonos (foto + chips + lista por mes + detalle al lado), render aprobado 2026-10-09.
  const deskFotoCargos = (isDesktop&&sub==='cargos') ? (()=>{
    const tabs=[
      {v:'clasificar',l:'Por clasificar',n:chipCounts.clasificar,c:C.soonText},
      {v:'c_sugeridas',l:'Sugeridas por RUT',n:chipCounts.sugeridas,c:C.greenText},
      {v:'c_caja',l:'Caja chica',n:chipCounts.caja,c:C.accent},
      {v:'c_clasificados',l:'Clasificados',n:chipCounts.clasificados,c:C.greenText},
      {v:'c_internos',l:'Internos',n:chipCounts.internos,c:C.muted},
      {v:'todos',l:'Todos',n:null},
    ]
    const pc=chipCounts.clasificar
    return (
      <div style={{display:'flex',flexDirection:'column',gap:10,marginBottom:12}}>
        <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:'12px 16px',display:'flex',alignItems:'center',gap:12,flexWrap:'wrap',minHeight:30}}>
          {pc>0
            ? <div onClick={()=>{setConcView('clasificar');setDeskSel(null)}} style={{display:'flex',alignItems:'baseline',gap:12,cursor:'pointer',flexWrap:'wrap'}}>
                <span style={{fontSize:10,fontWeight:700,color:C.soonText,textTransform:'uppercase',letterSpacing:.5}}>Por clasificar</span>
                <span style={{fontSize:22,fontWeight:800,color:C.soonText,fontVariantNumeric:'tabular-nums',letterSpacing:-.4}}>{fmt(chipCounts.clasificarMonto)}</span>
                <span style={{fontSize:11.5,color:C.muted}}>{pc} cargo{pc!==1?'s':''}{chipCounts.clasificar90>0?` · ${fmt(chipCounts.clasificar90)} lleva +90 días`:''}</span>
              </div>
            : <span style={{display:'inline-flex',alignItems:'center',gap:8,fontSize:14,fontWeight:600,color:C.greenText}}><SIcon n='check' s={15} c={C.greenText}/>Todo clasificado</span>}
        </div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
          {tabs.map(t=>{ const on=concView===t.v; return (
            <button key={t.v} onClick={()=>{setConcView(t.v);setDeskSel(null)}} style={{display:'inline-flex',alignItems:'center',gap:6,minHeight:32,padding:'0 13px',borderRadius:20,border:`1px solid ${on?C.accent:C.border}`,background:on?C.accent:C.surface,color:on?'#fff':C.text,fontSize:12,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>
              {t.l}{t.n!=null&&<b style={{fontVariantNumeric:'tabular-nums',color:on?'#fff':(t.n>0?t.c:C.muted)}}>{t.n}</b>}
            </button>) })}
        </div>
      </div>)
  })() : null
  const deskFoto = (isDesktop&&sub==='abonos') ? (()=>{
    const tabs=[
      {v:'porresolver',l:'Por resolver',n:chipCounts.porresolver,c:C.overdueText},
      {v:'sinid',l:'Sin cliente',n:chipCounts.sinid,c:C.overdueText},
      {v:'porconciliar',l:'Por confirmar',n:chipCounts.porconciliar,c:C.overdueText},
      {v:'descalces',l:'Sin factura',n:chipCounts.descalces,c:C.soonText},
      {v:'conciliados',l:'Conciliados',n:chipCounts.conciliados,c:C.greenText},
      {v:'todos',l:'Todos',n:null},
    ]
    const pr=chipCounts.porresolver
    return (
      <div style={{display:'flex',flexDirection:'column',gap:10,marginBottom:12}}>
        <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:'12px 16px',display:'flex',alignItems:'center',gap:12,flexWrap:'wrap',minHeight:30}}>
          {pr>0
            ? <div onClick={()=>{setConcView('porresolver');setDeskSel(null)}} style={{display:'flex',alignItems:'baseline',gap:12,cursor:'pointer',flexWrap:'wrap'}}>
                <span style={{fontSize:10,fontWeight:700,color:C.overdueText,textTransform:'uppercase',letterSpacing:.5}}>Por resolver</span>
                <span style={{fontSize:22,fontWeight:800,color:C.overdueText,fontVariantNumeric:'tabular-nums',letterSpacing:-.4}}>{fmt(chipCounts.porresolverMonto)}</span>
                <span style={{fontSize:11.5,color:C.muted}}>{pr} abono{pr!==1?'s':''}{chipCounts.porresolver90>0?` · ${fmt(chipCounts.porresolver90)} lleva +90 días`:''}</span>
              </div>
            : <span style={{display:'inline-flex',alignItems:'center',gap:8,fontSize:14,fontWeight:600,color:C.greenText}}><SIcon n='check' s={15} c={C.greenText}/>Todo conciliado</span>}
          {listosN>0&&<span style={{marginLeft:'auto',display:'inline-flex',alignItems:'center',gap:10,background:C.greenBg,borderRadius:9,padding:'5px 6px 5px 12px'}}>
            <span style={{fontSize:12,fontWeight:700,color:C.greenText}}>Listo para conciliar · {listosN} {listosN===1?'calza':'calzan'} exacto</span>
            <button onClick={()=>setLoteConfirm(listosExactos)} style={{minHeight:30,padding:'0 12px',borderRadius:8,border:'none',background:C.greenText,color:'#fff',fontSize:12,fontWeight:700,cursor:'pointer'}}>Conciliar {listosN}</button>
          </span>}
        </div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
          {tabs.map(t=>{ const on=concView===t.v; return (
            <button key={t.v} onClick={()=>{setConcView(t.v);setDeskSel(null)}} style={{display:'inline-flex',alignItems:'center',gap:6,minHeight:32,padding:'0 13px',borderRadius:20,border:`1px solid ${on?C.accent:C.border}`,background:on?C.accent:C.surface,color:on?'#fff':C.text,fontSize:12,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>
              {t.l}{t.n!=null&&<b style={{fontVariantNumeric:'tabular-nums',color:on?'#fff':(t.n>0?t.c:C.muted)}}>{t.n}</b>}
            </button>) })}
          {sugeridosId.length>0&&<button onClick={()=>{setRevSugSel(new Set(sugeridosId.map(s=>s.mov.id)));setRevSugOpen(true)}} style={{display:'inline-flex',alignItems:'center',gap:6,minHeight:32,padding:'0 13px',borderRadius:20,border:`1px solid ${C.azulInfo}`,background:C.azulBg,color:C.azulInfo,fontSize:12,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>Identificar por su nombre <b style={{fontVariantNumeric:'tabular-nums'}}>{sugeridosId.length}</b></button>}
        </div>
      </div>)
  })() : null
  const deskPanes = (isDesktop&&(sub==='abonos'||sub==='cargos')) ? (()=>{
    const found = deskSel ? lista.findIndex(m=>m.id===deskSel.id) : -1
    const selIdx = lista.length ? (found>=0 ? found : Math.min(deskSel?.idx||0, lista.length-1)) : -1
    const sel = selIdx>=0 ? lista[selIdx] : null
    const go = i => { const m=lista[i]; if(m){ setDeskSel({id:m.id,idx:i}); setVerGlosa(false) } }
    const TOPE=600
    // Total neto por mes (tile del mes, opción B del render): suma de lo que muestra la lista en ese mes.
    const totMes={}; lista.slice(0,TOPE).forEach(m=>{ const k=String(m.fecha||'').slice(0,7); totMes[k]=(totMes[k]||0)+(m.tipo==='abono'?1:-1)*Math.abs(m.monto||0) })
    return (
      <div style={{display:'flex',gap:16,alignItems:'flex-start'}}>
        <div style={{width:400,flexShrink:0,border:`1px solid ${C.border}`,borderRadius:12,background:C.surface,overflow:'hidden'}}>
          {lista.length===0&&<div style={{padding:30,textAlign:'center',color:C.muted,fontSize:12}}>No hay movimientos con estos filtros.</div>}
          {lista.slice(0,TOPE).map((m,i)=>{
            const ym=String(m.fecha||'').slice(0,7), pym=i>0?String(lista[i-1].fecha||'').slice(0,7):null
            const ec=estadoChip(m), on=i===selIdx
            return (
              <Fragment key={m.id}>
                {(i===0||ym!==pym)&&<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'9px 14px',fontSize:13,fontWeight:700,color:C.accent,background:C.toggleOff,borderTop:i?`1px solid ${C.border}`:'none'}}><span>{_MESL[+ym.slice(5,7)-1]||ym} {ym.slice(0,4)}</span><span style={{fontVariantNumeric:'tabular-nums',color:(totMes[ym]||0)<0?C.overdueText:C.greenText}}>{(totMes[ym]||0)<0?'−':'+'}{fmtM(Math.abs(totMes[ym]||0))}</span></div>}
                <div onClick={()=>go(i)} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 14px',borderTop:`1px solid ${C.track}`,cursor:'pointer',background:on?C.azulBg:C.surface,boxShadow:on?`inset 0 0 0 1.5px ${C.accent}`:'none'}}>
                  {diaGrande(m.fecha)}
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:700,color:C.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{quienMov(m)}</div>
                    <div style={{fontSize:11,color:C.muted,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{ec.t}{m.tipo==='cargo'&&!m.es_interno&&!(concByMov[m.id]?.length)&&!m.categoria&&(cargoSugerencia(m)||liqParaCargo(m))?' · sugerida':''}{m.detalle_aviso?` · ${m.detalle_aviso}`:''}</div>
                  </div>
                  <span style={{width:8,height:8,borderRadius:'50%',background:ec.c,flexShrink:0}}/>
                  <span style={{fontSize:13,fontWeight:700,color:m.tipo==='abono'?C.greenText:C.overdue,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap',flexShrink:0}}>{m.tipo==='abono'?'+':'−'}{fmtM(m.monto)}</span>
                </div>
              </Fragment>) })}
          {lista.length>TOPE&&<div style={{padding:'10px 14px',fontSize:11,color:C.muted,borderTop:`1px solid ${C.track}`}}>Se muestran {TOPE} de {lista.length}. Usa el buscador, un filtro o el mes para acotar.</div>}
        </div>
        <div style={{flex:1,minWidth:0,position:'sticky',top:72,maxHeight:'calc(100vh - 150px)',overflowY:'auto',display:'flex',flexDirection:'column',gap:12}}>
          {sel ? (()=>{ const ec=estadoChip(sel)
            const fc=(concByMov[sel.id]||[]).filter(c=>c.tipo_destino==='factura'); const facObj=fc.length===1?billing.find(b=>String(b.id)===String(fc[0].factura_id)):null
            return (
            <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:'16px 18px'}}>
              <div style={{display:'flex',alignItems:'flex-start',gap:12}}>
                {diaGrande(sel.fecha)}
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:18,fontWeight:700,color:sel.cliente_id&&onOpenClientFicha?C.accent:C.text,cursor:sel.cliente_id&&onOpenClientFicha?'pointer':'default',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} onClick={sel.cliente_id&&onOpenClientFicha?()=>onOpenClientFicha(sel.cliente_id):undefined} title={sel.cliente_id&&onOpenClientFicha?'Ver ficha del cliente':undefined}>{quienMov(sel)}</div>
                  <div style={{fontSize:11.5,color:C.muted,marginTop:2}}>{fmtFechaDMY(sel.fecha)} · {rolChip(sel.rol_cuenta).t}{sel.rut_contraparte?` · ${sel.rut_contraparte}`:''}{sel.cliente_id&&sel.nombre_contraparte&&sel.nombre_contraparte!==quienMov(sel)?` · ${sel.nombre_contraparte}`:''}</div>
                  {facObj&&<span onClick={onOpenFactura?()=>onOpenFactura(facObj):undefined} style={{display:'inline-block',marginTop:6,fontSize:12,fontWeight:700,color:C.accent,cursor:onOpenFactura?'pointer':'default',textDecoration:onOpenFactura?'underline':'none',textUnderlineOffset:2}}>{lblFacturaN(facObj)} <Gl n='chevron'/></span>}
                </div>
                <div style={{textAlign:'right',flexShrink:0}}>
                  <div style={{fontSize:20,fontWeight:800,color:sel.tipo==='abono'?C.greenText:C.overdue,fontVariantNumeric:'tabular-nums'}}>{sel.tipo==='abono'?'+':'−'}{fmtM(sel.monto)}</div>
                  <span style={{display:'inline-block',marginTop:3,fontSize:9.5,fontWeight:700,padding:'2px 8px',borderRadius:20,background:ec.bg,color:ec.c,whiteSpace:'nowrap'}}>{ec.t}</span>
                </div>
              </div>
              {detalleMov(sel)}
              <div style={{display:'flex',alignItems:'center',gap:8,marginTop:12,paddingTop:10,borderTop:`1px solid ${C.border}`}}>
                <span style={{fontSize:11.5,color:C.muted,fontVariantNumeric:'tabular-nums'}}>{selIdx+1} de {lista.length}</span>
                <button disabled={selIdx<=0} onClick={()=>go(selIdx-1)} style={{marginLeft:'auto',minHeight:32,padding:'0 12px',borderRadius:8,border:`1px solid ${C.border}`,background:C.surface,color:selIdx<=0?C.done:C.accent,fontSize:12,fontWeight:600,cursor:selIdx<=0?'default':'pointer'}}><Gl n='chevL'/> Anterior</button>
                <button disabled={selIdx>=lista.length-1} onClick={()=>go(selIdx+1)} style={{minHeight:32,padding:'0 12px',borderRadius:8,border:`1px solid ${C.border}`,background:C.surface,color:selIdx>=lista.length-1?C.done:C.accent,fontSize:12,fontWeight:600,cursor:selIdx>=lista.length-1?'default':'pointer'}}>Siguiente <Gl n='chevron'/></button>
              </div>
            </div>) })()
           : <div style={{background:C.surface,border:`1px dashed ${C.border}`,borderRadius:12,padding:30,textAlign:'center',fontSize:12,color:C.muted}}>{lista.length?'Elige un movimiento de la lista.':'Nada por resolver con estos filtros.'}</div>}
          <BitacoraLista prefijo='banco.' titulo='Bitácora del banco' limite={6} vacio='Aún no hay registros del banco.' etiquetas={{'banco.conciliado':'Conciliado','banco.deshecho':'Conciliación deshecha','banco.cliente_asignado':'Cliente asignado','banco.ingreso_oficina':'Ingreso de oficina','banco.fondo_equipo':'Fondo del equipo','banco.conciliar_varias':'Conciliar varias'}}/>
        </div>
      </div>)
  })() : null
  const interiorEl = (
    <div style={{paddingBottom:80,...(isDesktop?{maxWidth:(sub==='abonos'||sub==='cargos')?1240:980,margin:'0 auto'}:{})}}>
      <div style={{padding:'18px 20px 10px',position:'sticky',top:0,background:C.bg,zIndex:10,borderBottom:`1px solid ${C.border}`}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <button onClick={()=>setHubOpen(true)} style={{background:'none',border:'none',color:C.accent,cursor:'pointer',fontSize:20,lineHeight:1,padding:'0 4px 0 0'}}><Gl n='chevL'/></button>
          {focused&&focoMeta&&!(isDesktop&&(sub==='abonos'||sub==='cargos'))   // escritorio abonos: la foto de abajo ya dice el foco y su cifra (no repetir)
            ? <div style={{display:'flex',alignItems:'center',gap:9,flex:1,minWidth:0}}>
                <span style={{width:30,height:30,borderRadius:8,background:focoMeta.bg,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SIcon n={focoMeta.ic} s={16} c={focoMeta.col}/></span>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:16,fontWeight:600,color:C.text,lineHeight:1.1}}>{focoMeta.l}</div>
                  <div style={{fontSize:11,color:C.muted}}>{lista.length} movimiento{lista.length!==1?'s':''} · {fmtM(focoSum)}</div>
                </div>
              </div>
            : <div style={{fontSize:20,fontWeight:600,color:C.text,letterSpacing:-.4}}>Conciliación bancaria</div>}
          {loading&&<span style={{marginLeft:'auto',fontSize:11,color:C.muted}}>Cargando…</span>}
        </div>
      </div>

      <div style={{padding:'14px 20px 0'}}>
        {/* Cartolas: una sola línea (detalle a la izquierda · cargar a la derecha) — oculta dentro de un foco (Cargar cartola es su propia tarjeta) */}
        {!focused && (cartolas.length>0
          ? <div style={{marginBottom:12,border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden'}}>
              <div style={{display:'flex',alignItems:'center',gap:8,padding:'10px 12px',background:C.bgSoft}}>
                <span onClick={()=>setVerCartolas(v=>!v)} style={{display:'inline-flex',alignItems:'center',gap:6,cursor:'pointer'}}>
                  <span style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:.4}}>Cartolas</span>
                  <span style={{fontSize:11,color:C.muted}}>{movs.length} mov</span>
                  <span style={{fontSize:13,color:C.muted}}>{verCartolas?<Gl n='chevU'/>:<Gl n='chevD'/>}</span>
                </span>
                <button onClick={()=>setVerCarga(v=>!v)} style={{marginLeft:'auto',fontSize:11,fontWeight:600,color:C.accent,background:'none',border:'none',cursor:'pointer'}}>+ Cargar</button>
              </div>
              {verCartolas&&cartolas.map((c,i)=>{ const pc=c.rol==='honorarios'?C.accent:'#EF9F27'; const mesLbl=(()=>{const[y,mo]=c.mes.split('-');const M=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];return `${M[+mo-1]||mo} ${y}`})(); return (
                <div key={i} style={{padding:'10px 12px',borderTop:`1px solid ${C.border}`}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:8}}>
                    <span style={{fontSize:13,fontWeight:600,color:C.text}}>{c.rol==='honorarios'?'Cta. Honorarios':'Cta. Gastos'} · {mesLbl}</span>
                    <span style={{fontSize:11,color:C.muted,flexShrink:0}}>{fmtFechaDMY?fmtFechaDMY(c.fMin):c.fMin} → {fmtFechaDMY?fmtFechaDMY(c.fMax):c.fMax} · {c.n} mov.</span>
                  </div>
                  <div style={{fontSize:11,marginTop:2}}><span style={{color:C.greenText,fontWeight:600}}>+{fmtM(c.abo)}</span> <span style={{color:C.muted}}>abonos</span> · <span style={{color:C.overdue,fontWeight:600}}>−{fmtM(c.car)}</span> <span style={{color:C.muted}}>cargos</span></div>
                </div>
              )})}
            </div>
          : <div style={{display:'flex',justifyContent:'flex-end',gap:6,marginBottom:8}}>
              <label style={{fontSize:11,fontWeight:600,color:C.muted,background:'none',border:`1px solid ${C.border}`,borderRadius:20,padding:'4px 12px',cursor:'pointer'}} title='Sube la cartola mensual oficial: compara (no inserta) que la base tenga todos los movimientos'>
                {verificando?'Verificando…':'Verificar contra oficial'}
                <input type='file' accept='.xlsx,.xls' multiple onChange={e=>{onVerificar(e.target.files); e.target.value=''}} style={{display:'none'}}/>
              </label>
              <button onClick={()=>setVerCarga(true)} style={{fontSize:11,fontWeight:600,color:C.muted,background:'none',border:`1px solid ${C.border}`,borderRadius:20,padding:'4px 12px',cursor:'pointer'}}>+ Cargar cartolas</button>
            </div>)}

        {/* Caja de importación — se despliega con "+ Cargar" */}
        {(verCarga||importing)&&(
          <div style={{padding:'16px',borderRadius:10,border:`2px dashed ${C.border}`,textAlign:'center',background:C.bgSoft,marginBottom:12,position:'relative'}}>
            {!importing&&<button onClick={()=>setVerCarga(false)} style={{position:'absolute',top:8,right:10,background:'none',border:'none',color:C.muted,fontSize:16,lineHeight:1,cursor:'pointer'}}><Gl n='x'/></button>}
            <div style={{fontSize:14,color:C.accent,fontWeight:600,marginBottom:8}}>{importing?`Importando… ${prog?`${prog.done}/${prog.total}`:''}`:'Cargar cartolas BICE (.xlsx)'}</div>
            {!importing&&(
              <div style={{display:'flex',gap:8,justifyContent:'center',flexWrap:'wrap'}}>
                <label style={{display:'inline-block',padding:'7px 14px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.accent,fontSize:12,fontWeight:600,cursor:'pointer'}}>
                  <input type='file' accept='.xlsx,.xls' multiple onChange={e=>onFiles(e.target.files)} style={{display:'none'}}/>
                  Elegir archivos
                </label>
                <label style={{display:'inline-block',padding:'7px 14px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.accent,fontSize:12,fontWeight:600,cursor:'pointer'}}>
                  <input type='file' webkitdirectory='' directory='' multiple onChange={e=>onFiles(e.target.files)} style={{display:'none'}}/>
                  Seleccionar carpeta
                </label>
              </div>
            )}
            <div style={{fontSize:11,color:C.muted,marginTop:8}}>Varios a la vez o una carpeta entera (ambas cuentas). Re-subir no duplica.</div>
          </div>
        )}

        {/* Compuerta: revisar la cartola parseada ANTES de escribir (evita cargar mal sin darse cuenta) */}
        {cargaPreview&&(()=>{ const ents=cargaPreview.entries||[]; const totNuevos=ents.reduce((a,e)=>a+(e.nuevos||0),0); const rolTxt=r=>r==='gastos'?'Cta. Gastos':r==='honorarios'?'Cta. Honorarios':'la cuenta'; const dmy=f=>f?fmtFechaDMY(f):'—'; const uni=ents.length===1?ents[0]:null
          return (
          <div style={{border:`1px solid ${C.accent}`,borderRadius:12,overflow:'hidden',marginBottom:14}}>
            <div style={{padding:'10px 12px',background:C.azulBg}}>
              <div style={{fontSize:13,fontWeight:700,color:C.accent}}>Revisa antes de guardar</div>
              <div style={{fontSize:11,color:C.muted}}>Nada se escribe todavía · {ents.length} archivo{ents.length!==1?'s':''}</div>
            </div>
            <div style={{padding:'10px 12px'}}>
              {ents.map((e,i)=>(
                <div key={i} style={{marginBottom:i<ents.length-1?10:0,paddingBottom:i<ents.length-1?10:0,borderBottom:i<ents.length-1?`1px solid ${C.border}`:'none'}}>
                  {e.error&&!e.total? <div style={{fontSize:11,color:C.overdueText}}><b>{e.file}</b>: {e.error}</div> : <>
                    <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:8}}>
                      <span style={{fontSize:11,fontWeight:700,padding:'2px 9px',borderRadius:20,background:e.rol==='gastos'?C.ambarBg:C.azulBg,color:e.rol==='gastos'?C.soonText:C.accent}}>{rolTxt(e.rol)}{e.cuenta?` · ${e.cuenta}`:''}</span>
                      {e.minF&&<span style={{fontSize:11,color:C.muted}}>{dmy(e.minF)} – {dmy(e.maxF)}</span>}
                    </div>
                    <div style={{display:'flex',gap:8,marginBottom:8}}>
                      <div style={{flex:1,background:C.bgSoft,borderRadius:10,padding:'7px 10px'}}><div style={{fontSize:10,color:C.muted}}>Movimientos</div><div style={{fontSize:16,fontWeight:700,color:C.text}}>{e.total}</div></div>
                      <div style={{flex:1,background:C.bgSoft,borderRadius:10,padding:'7px 10px'}}><div style={{fontSize:10,color:C.muted}}>Nuevos</div><div style={{fontSize:16,fontWeight:700,color:C.greenText}}>{e.nuevos}</div></div>
                      <div style={{flex:1,background:C.bgSoft,borderRadius:10,padding:'7px 10px'}}><div style={{fontSize:10,color:C.muted}}>Ya cargados</div><div style={{fontSize:16,fontWeight:700,color:C.muted}}>{e.dup}</div></div>
                    </div>
                    <div style={{display:'flex',gap:14,alignItems:'center',background:C.bgSoft,borderRadius:10,padding:'7px 10px',flexWrap:'wrap'}}>
                      <div><div style={{fontSize:10,color:C.muted}}>Abonos</div><div style={{fontSize:13,fontWeight:700,color:C.greenText}}>+{fmtM(e.sumAbonos)}</div></div>
                      <div><div style={{fontSize:10,color:C.muted}}>Cargos</div><div style={{fontSize:13,fontWeight:700,color:C.overdue}}>−{fmtM(e.sumCargos)}</div></div>
                      {(e.verA||e.verC)&&(()=>{ const okA=!e.verA||e.verA.diff===0; const okC=!e.verC||e.verC.diff===0; const cuadra=okA&&okC; return <div style={{marginLeft:'auto',textAlign:'right'}}><div style={{fontSize:10,color:C.muted}}>Cuadra con el banco</div><div style={{fontSize:12,fontWeight:700,color:cuadra?C.greenText:C.overdue}}>{cuadra?<><Gl n='tick'/>{" "}sí</>:'revisar'}</div></div> })()}
                    </div>
                    {(e.nuevosRows||[]).length>0&&<div style={{marginTop:8}}>
                      <div style={{...SEC_LBL,marginBottom:3}}>Muestra · {Math.min(3,e.nuevosRows.length)} de {e.nuevos}</div>
                      {e.nuevosRows.slice(0,3).map((r,ri)=>(
                        <div key={ri} style={{display:'flex',justifyContent:'space-between',gap:8,fontSize:11,padding:'3px 0',borderTop:ri?`1px solid ${C.bgSoft}`:'none'}}>
                          <span style={{minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:C.muted}}>{dmy(r.fecha)} · {r.nombre_contraparte||r.descripcion||'—'}</span>
                          <span style={{whiteSpace:'nowrap',fontWeight:600,color:r.tipo==='abono'?C.greenText:C.overdue}}>{r.tipo==='abono'?'+':'−'}{fmtM(r.monto)}</span>
                        </div>
                      ))}
                    </div>}
                    {(e.sospechosos||[]).length>0&&<div style={{marginTop:8,background:C.ambarBg,borderRadius:10,padding:'8px 10px'}}>
                      <div style={{fontSize:11,fontWeight:700,color:C.soonText,marginBottom:3,display:'flex',alignItems:'center',gap:5}}><SIcon n='alert' s={13} c={C.soonText}/>{e.sospechosos.length} con fecha distinta a su glosa — revisa antes de cargar</div>
                      {e.sospechosos.slice(0,3).map((sp,si)=>(
                        <div key={si} style={{fontSize:10,color:C.soonText,padding:'2px 0',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{sp.fechaGlosa?<>{dmy(sp.fecha)} <span style={{opacity:.7}}>vs glosa</span> {dmy(sp.fechaGlosa)} <b>({sp.dias} días)</b></>:<>{dmy(sp.fecha)} <span style={{opacity:.7}}>· sin fecha propia, se usó la del período</span></>} · {fmtM(sp.monto)}</div>
                      ))}
                      {e.sospechosos.length>3&&<div style={{fontSize:10,color:C.soonText,opacity:.85,marginTop:2}}>y {e.sospechosos.length-3} más…</div>}
                    </div>}
                    {e.error&&<div style={{fontSize:10,color:C.overdueText,marginTop:5}}>{e.error}</div>}
                  </>}
                </div>
              ))}
              <div style={{display:'flex',gap:8,marginTop:12}}>
                <button disabled={importing} onClick={()=>setCargaPreview(null)} style={{fontSize:12,fontWeight:600,color:C.muted,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,padding:'9px 13px',cursor:importing?'default':'pointer'}}>Descartar</button>
                <button disabled={importing||totNuevos===0} onClick={confirmarCarga} style={{flex:1,fontSize:12,fontWeight:700,color:'#fff',background:totNuevos>0?C.accent:C.done,border:'none',borderRadius:8,padding:'9px 13px',cursor:(importing||totNuevos===0)?'default':'pointer'}}>{importing?'Guardando…':totNuevos>0?`Cargar ${totNuevos} movimiento${totNuevos!==1?'s':''}${uni&&uni.rol?` en ${rolTxt(uni.rol)}`:''}`:'Nada nuevo por cargar'}</button>
              </div>
            </div>
          </div>) })()}

        {/* Reporte del último lote */}
        {reportes&&(
          <div style={{marginBottom:14,border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden'}}>
            <div style={{...SEC_LBL,padding:'8px 12px',background:C.bgSoft}}>Último import · {reportes.length} archivo{reportes.length!==1?'s':''}</div>
            {reportes.map((r,i)=>{
              const okA=r.verA&&r.verA.diff===0, okC=r.verC&&r.verC.diff===0
              return (
                <div key={i} style={{padding:'10px 12px',borderTop:i?`1px solid ${C.border}`:'none',fontSize:12}}>
                  <div style={{display:'flex',justifyContent:'space-between',gap:8}}><span style={{fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.file}</span><span style={{flexShrink:0,color:C.muted}}>{r.cuenta||'—'}</span></div>
                  {r.error
                    ? <div style={{color:C.overdue,marginTop:3}}>Error: {r.error}</div>
                    : <div style={{color:C.muted,marginTop:3,lineHeight:1.6}}>
                        Abonos {r.nAbonos} · {fmtM(r.sumAbonos)} {r.verA&&<span style={{color:okA?C.greenText:C.overdue,fontWeight:600}}>({okA?<><Gl n='tick'/>{" "}cuadra</>:`dif ${fmtM(r.verA.diff)}`})</span>}<br/>
                        Cargos {r.nCargos} · {fmtM(r.sumCargos)} {r.verC&&<span style={{color:okC?C.greenText:C.overdue,fontWeight:600}}>({okC?<><Gl n='tick'/>{" "}cuadra</>:`dif ${fmtM(r.verC.diff)}`})</span>}<br/>
                        Internos {r.internos} · Sin identificar {r.sinId} · <b>{r.nuevos} nuevos</b>{r.dup?` · ${r.dup} ya estaban`:''}
                      </div>}
                </div>
              )
            })}
          </div>
        )}

        {/* Verificación contra cartola oficial (read-only) */}
        {(verifRes||verificando)&&(
          <div style={{marginBottom:14,border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden'}}>
            <div style={{fontSize:10,fontWeight:700,color:C.accent,textTransform:'uppercase',letterSpacing:.4,padding:'8px 12px',background:C.bgSoft,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span>Verificación contra cartola oficial</span>
              {verifRes&&<button onClick={()=>setVerifRes(null)} style={{background:'none',border:'none',color:C.muted,fontSize:15,lineHeight:1,cursor:'pointer'}}><Gl n='x'/></button>}
            </div>
            {verificando&&<div style={{padding:12,fontSize:12,color:C.muted}}>Verificando…</div>}
            {verifRes&&verifRes.map((r,i)=>{
              const okA=r.verA&&r.verA.diff===0, okC=r.verC&&r.verC.diff===0
              const completo=!r.error&&r.faltan&&r.faltan.length===0
              return (
                <div key={i} style={{padding:'10px 12px',borderTop:i?`1px solid ${C.border}`:'none',fontSize:12}}>
                  <div style={{display:'flex',justifyContent:'space-between',gap:8}}><span style={{fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.file}</span><span style={{flexShrink:0,color:C.muted}}>{r.cuenta||'—'}</span></div>
                  {r.error
                    ? <div style={{color:C.overdue,marginTop:3}}>Error: {r.error}</div>
                    : <>
                        <div style={{color:C.muted,marginTop:3,lineHeight:1.6}}>
                          Oficial: {r.nMovs} mov. {r.verA&&<span style={{color:okA?C.greenText:C.overdue,fontWeight:600}}>(abonos {okA?<Gl n='tick'/>:`dif ${fmtM(r.verA.diff)}`})</span>} {r.verC&&<span style={{color:okC?C.greenText:C.overdue,fontWeight:600}}>(cargos {okC?<Gl n='tick'/>:`dif ${fmtM(r.verC.diff)}`})</span>}<br/>
                          En la base ({r.rango.minF} a {r.rango.maxF}): {r.nDB} mov.
                        </div>
                        {completo
                          ? <div style={{marginTop:6,color:C.greenText,fontWeight:700}}><Gl n='tick'/> Todos presentes — no falta ninguno</div>
                          : <div style={{marginTop:6,color:C.overdue,fontWeight:700}}>Faltan {r.faltan.length} en la base:</div>}
                        {r.faltan&&r.faltan.map((m,j)=>(<div key={j} style={{marginTop:2,fontSize:11,color:C.text}}>· {m.fecha} · {m.tipo} · {fmtM(m.monto)} — {(m.descripcion||'').slice(0,55)}</div>))}
                        {r.extra&&r.extra.length>0&&<>
                          <div style={{marginTop:8,color:C.soonText,fontWeight:700}}>{r.extra.length} en la base que la oficial no tiene (posible duplicado u otra carga):</div>
                          {r.extra.map((m,j)=>(<div key={j} style={{marginTop:2,fontSize:11,color:C.muted}}>· {m.fecha} · {m.tipo} · {fmtM(m.monto)} — {(m.descripcion||'').slice(0,55)}</div>))}
                        </>}
                      </>}
                </div>
              )
            })}
          </div>
        )}

        {/* Buscar primero (lo que más se usa para encontrar un pago) + Mis clientes (estrella) + conteo */}
        <div style={{display:'flex',gap:8,marginBottom:9,alignItems:'center'}}>
          <div style={{flex:1,display:'flex',alignItems:'center',gap:6,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,padding:'7px 10px'}}>
            <svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke={C.muted} strokeWidth='2.2' strokeLinecap='round'><circle cx='11' cy='11' r='7'/><path d='M21 21l-4.3-4.3'/></svg>
            <input value={q} onChange={e=>setQ(e.target.value)} placeholder='Buscar RUT, nombre o cliente…' style={{flex:1,minWidth:0,border:'none',outline:'none',fontSize:12,color:C.text,background:'transparent'}}/>
            {q&&<button onClick={()=>setQ('')} style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:14,lineHeight:1,padding:0}}><Gl n='x'/></button>}
          </div>
          {(()=>{ const mio=(user?.name||'').trim(); if(!mio) return null; const on=respF===mio; return (
            <button onClick={()=>setRespF(on?'todos':mio)} title='Ver solo mis clientes' style={{background:'none',border:'none',cursor:'pointer',padding:4,display:'inline-flex',alignItems:'center',flexShrink:0}}>
              <svg width='19' height='19' viewBox='0 0 24 24' fill={on?C.accent:'none'} stroke={C.accent} strokeWidth='2' strokeLinejoin='round'><polygon points='12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2'/></svg>
            </button>
          )})()}
          <span style={{fontSize:10,color:C.muted,whiteSpace:'nowrap',flexShrink:0}}>{lista.length}{(()=>{const tot=movs.filter(m=>sub==='abonos'?m.tipo==='abono':m.tipo==='cargo').length;return tot>lista.length?` / ${tot}`:''})()}</span>
        </div>

        {/* Controles: tipo (segmentado) · Filtros (Cuenta + Mes/Año/Resp adentro) · orden por Fecha. Cada cosa en su grupo → cabe sin scroll horizontal. */}
        {(()=>{ const CHV = `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%2399ABB4' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>")`; const selSty={fontSize:11,fontWeight:600,height:28,boxSizing:'border-box',padding:'0 22px 0 10px',borderRadius:8,border:'none',backgroundColor:'#fff',color:C.accent,cursor:'pointer',outline:'none',WebkitAppearance:'none',MozAppearance:'none',appearance:'none',backgroundImage:CHV,backgroundRepeat:'no-repeat',backgroundPosition:'right 7px center'}; const btnSty={fontSize:12,fontWeight:600,height:28,boxSizing:'border-box',padding:'0 11px',borderRadius:8,border:'none',backgroundColor:'#F2F5F7',color:C.muted,cursor:'pointer',outline:'none',display:'inline-flex',alignItems:'center',gap:5}; const nF=(cuentaF!=='ambas'?1:0)+(mesF!=='todos'?1:0)+(anioF!=='todos'?1:0)+(respF!=='todos'?1:0); return (
        <div style={{marginBottom:11}}>
          <div style={{display:'flex',gap:6,alignItems:'center'}}>
            <span style={{display:'inline-flex',height:28,borderRadius:8,overflow:'hidden',background:C.track,padding:2,gap:2}}>
              {[['abonos','Abonos'],['cargos','Cargos']].map(([v,l])=>(
                <button key={v} onClick={()=>setSub(v)} style={{fontSize:12,fontWeight:600,padding:'0 14px',border:'none',borderRadius:6,background:sub===v?C.accent:'transparent',color:sub===v?'#fff':C.muted,cursor:'pointer'}}>{l}</button>
              ))}
            </span>
            <button onClick={()=>setVerFiltros(v=>!v)} style={{...btnSty,marginLeft:'auto',backgroundColor:nF>0?C.azulBg:'#F2F5F7',color:nF>0?C.accent:C.muted}}>
              <svg width='11' height='11' viewBox='0 0 24 24' fill='none' stroke={nF>0?C.accent:C.muted} strokeWidth='2' strokeLinecap='round'><path d='M3 5h18M6 12h12M10 19h4'/></svg>Filtros{nF>0?` · ${nF}`:''}
              <svg width='9' height='9' viewBox='0 0 24 24' fill='none' stroke='#99ABB4' strokeWidth='3' strokeLinecap='round' strokeLinejoin='round' style={{transform:verFiltros?'rotate(180deg)':'none'}}><polyline points='6 9 12 15 18 9'/></svg>
            </button>
            <button onClick={()=>setOrden(o=>o==='desc'?'asc':'desc')} title='Ordenar por fecha' style={{...btnSty,gap:4}}>Fecha
              <svg width='10' height='10' viewBox='0 0 24 24' fill='none' stroke={C.accent} strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round' style={{transform:orden==='asc'?'rotate(180deg)':'none'}}><line x1='12' y1='5' x2='12' y2='19'/><polyline points='6 13 12 19 18 13'/></svg>
            </button>
          </div>
          {verFiltros&&(
            <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center',background:C.bgSoft,borderRadius:8,padding:8,marginTop:6}}>
              <select value={cuentaF} onChange={e=>setCuentaF(e.target.value)} style={selSty}>
                <option value='ambas'>Cuenta</option>
                <option value='honorarios'>Honorarios</option>
                <option value='gastos'>Gastos</option>
              </select>
              <select value={mesF} onChange={e=>setMesF(e.target.value)} style={selSty}>
                <option value='todos'>Mes</option>
                {MESES_ABR.map((nm,i)=>{const mm=String(i+1).padStart(2,'0');return <option key={mm} value={mm}>{nm}</option>})}
              </select>
              <select value={anioF} onChange={e=>setAnioF(e.target.value)} style={selSty}>
                <option value='todos'>Año</option>
                {aniosDisp.map(y=><option key={y} value={y}>{y}</option>)}
              </select>
              <select value={respF} onChange={e=>setRespF(e.target.value)} style={selSty} title='Filtrar por abogado responsable del cliente'>
                <option value='todos'>Responsable</option>
                {respDisp.map(r=><option key={r} value={r}>{r}</option>)}
                <option value='__sin__'>Sin responsable</option>
              </select>
              {nF>0&&<span onClick={()=>{setCuentaF('ambas');setMesF('todos');setAnioF('todos');setRespF('todos')}} style={{marginLeft:'auto',fontSize:10,color:C.muted,textDecoration:'underline',cursor:'pointer'}}>Limpiar</span>}
            </div>
          )}
        </div>
        )})()}

        {/* Dentro de un foco (opción A): cambiar de foco es una línea de texto — no se repiten los tiles que ya dijo la tarjeta. */}
        {sub==='abonos'&&focused&&!isDesktop&&(()=>{
          const prTot=chipCounts.sinid+chipCounts.porconciliar+chipCounts.descalces
          const opts=[
            {v:'porresolver',l:'Por resolver',n:prTot},
            {v:'sinid',l:'Sin cliente',n:chipCounts.sinid},
            {v:'porconciliar',l:'Por confirmar',n:chipCounts.porconciliar},
            {v:'descalces',l:'Sin factura',n:chipCounts.descalces},
            {v:'conciliados',l:'Conciliados',n:chipCounts.conciliados},
          ]
          return (
            <div style={{display:'flex',flexWrap:'wrap',alignItems:'center',fontSize:11,marginBottom:11,padding:'0 2px'}}>
              <span style={{fontWeight:600,color:C.muted,marginRight:4}}>Ver:</span>
              {opts.map((o,i)=>{ const on=concView===o.v; return (
                <span key={o.v} onClick={()=>setConcView(on?'todos':o.v)} style={{cursor:'pointer',color:on?C.accent:C.muted,padding:'2px 4px'}}>
                  <span style={{fontWeight:on?700:600}}>{o.l}</span> <span style={{fontWeight:700,fontVariantNumeric:'tabular-nums'}}>{o.n}</span>
                  {i<opts.length-1?<span style={{color:C.border,marginLeft:5}}>·</span>:null}
                </span>
              )})}
            </div>
          )
        })()}

        {/* Overview de Abonos: tira DELGADA de triage. En ESCRITORIO el rail (brújula) ya la muestra → aquí se omite (de-dup); en MÓVIL es la navegación principal (no hay rail) → se conserva. Cada línea navega a su lista. */}
        {sub==='abonos'&&!focused&&!isDesktop&&(()=>{
          const pend=chipCounts.porconciliar+chipCounts.descalces+chipCounts.sinid, conc=chipCounts.conciliados, nSug=sugeridosId.length
          const nCobradas=(billing||[]).filter(b=>!b.deleted_at&&b.status==='Pagado'&&(b.billing_type||'')!=='reembolso'&&(aplicadoByFactura[b.id]||0)<(b.amount||0)).length
          if(pend===0&&nSug===0&&nCobradas===0) return (
            <div style={{display:'flex',alignItems:'center',gap:11,padding:'12px 13px',background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,marginBottom:11}}>
              <span style={{width:28,height:28,borderRadius:'50%',background:C.greenBg,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SIcon n='check' s={15} c={C.greenText}/></span>
              <span style={{fontSize:14,fontWeight:600,color:C.greenText}}>Todo conciliado · {conc}</span>
            </div>)
          const rows=[
            pend>0&&{k:'pr',col:C.overdueText,bg:C.overdueBg,n:pend,t:'Por resolver',s:'abonos sin cruzar con su factura',act:'Resolver',on:()=>setConcView('porresolver')},
            nSug>0&&{k:'id',col:C.accent,bg:C.azulBg,n:nSug,t:'Identificar por su nombre',s:'la app ya sabe de quién es',act:'Revisar',on:()=>{setRevSugSel(new Set(sugeridosId.map(s=>s.mov.id)));setRevSugOpen(true)}},
            nCobradas>0&&{k:'sr',col:C.soonText,bg:C.ambarBg,n:nCobradas,t:'Facturas sin respaldo',s:'pagadas, sin movimiento en el banco',act:'Ver',on:()=>setCobradasOpen(true)},
          ].filter(Boolean)
          return (
            <div style={{border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden',marginBottom:11}}>
              {rows.map((r,i)=>(
                <div key={r.k} onClick={r.on} style={{display:'flex',alignItems:'center',gap:11,padding:'10px 12px',borderTop:i>0?`1px solid ${C.border}`:'none',cursor:'pointer'}}>
                  <span style={{width:30,height:30,borderRadius:8,background:r.bg,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0,fontSize:15,fontWeight:800,color:r.col,fontVariantNumeric:'tabular-nums'}}>{r.n}</span>
                  <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:C.text}}>{r.t}</div><div style={{fontSize:10,color:C.muted}}>{r.s}</div></div>
                  <span style={{fontSize:11,fontWeight:700,color:r.col,border:`1px solid ${C.border}`,borderRadius:8,padding:'5px 12px',whiteSpace:'nowrap',flexShrink:0}}>{r.act} <Gl n='chevron'/></span>
                </div>
              ))}
            </div>
          )
        })()}

        {/* Cargos — foto "Por clasificar": los que piden tu criterio (sin categoría), simétrica al "Por resolver" de abonos. Toca para ver solo esos; cada fila ya trae su clasificación inline (cargoInlineSug). */}
        {isDesktop&&sub==='cargos'&&!unoMode&&deskFotoCargos}
        {sub==='cargos'&&!isDesktop&&(()=>{
          if(!ccN) return null
          const n=ccN, tot=ccMonto, on=concView==='clasificar'
          return (
            <div onClick={()=>setConcView(on?'todos':'clasificar')} style={{cursor:'pointer',border:`1px solid ${C.soonText}`,background:C.soonBg,borderRadius:12,padding:'12px 14px',marginBottom:10}}>
              <div style={{display:'flex',alignItems:'center',gap:9}}>
                <span style={{width:30,height:30,borderRadius:8,background:'rgba(0,0,0,.05)',display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SIcon n='wallet' s={16} c={C.soonText}/></span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:700,color:C.soonText}}>Por clasificar</div>
                  <div style={{fontSize:10,color:C.soonText,opacity:.85}}>cargos que piden tu criterio · gasto de oficina o de cliente</div>
                </div>
                <div style={{textAlign:'right',flexShrink:0}}>
                  <div style={{fontSize:19,fontWeight:800,color:C.soonText,lineHeight:1,fontVariantNumeric:'tabular-nums'}}>{n}</div>
                  <div style={{fontSize:12,fontWeight:700,color:C.soonText,fontVariantNumeric:'tabular-nums'}}>{fmtM(tot)}</div>
                </div>
              </div>
              <div style={{fontSize:10,fontWeight:700,color:C.accent,marginTop:7}}>{on?<>Mostrando solo estos · ver todos los cargos{" "}<Gl n='chevron'/></>:<>Ver solo los que faltan{" "}<Gl n='chevron'/></>}</div>
            </div>
          )
        })()}

        {/* Conciliar en lote: calces exactos y únicos de una; el resto (varios candidatos / sin factura) se cuenta y se resuelve abajo. Solo en overview o en el foco "Por conciliar" (donde tiene sentido). */}
        {sub==='abonos'&&!isDesktop&&(concView==='todos'||concView==='porconciliar')&&(()=>{
          const {exactos,revisar,sinFac}=lcData   // fuente única (definida arriba); el interior ya no recalcula (sinFac faltaba → ReferenceError al desplegar 'Listos para conciliar')
          if(!exactos.length) return null   // solo se muestra cuando hay calces exactos para conciliar de una; el resto (por revisar / sin factura) ya vive en los tiles "Por resolver"
          return (
            <div style={{border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden',marginBottom:11}}>
              <div onClick={()=>setLoteOpen(o=>!o)} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',background:C.greenText,cursor:'pointer'}}>
                <span style={{width:30,height:30,borderRadius:8,background:'rgba(255,255,255,.18)',display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SIcon n='exchange' s={15} c='#fff'/></span>
                <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:700,color:'#fff'}}>Listos para conciliar</div><div style={{fontSize:10,color:'rgba(255,255,255,.85)'}}>{exactos.length} {exactos.length===1?'calza':'calzan'} exacto con su factura{revisar.length?` · ${revisar.length} por revisar`:''}</div></div>
                {exactos.length>0&&!loteOpen&&<button onClick={e=>{e.stopPropagation();setLoteConfirm(exactos)}} disabled={loteBusy} style={{fontSize:12,fontWeight:700,color:C.greenText,background:'#fff',border:'none',borderRadius:8,padding:'6px 13px',cursor:'pointer',flexShrink:0,opacity:loteBusy?.6:1}}>{loteBusy?`${loteProg}/${exactos.length}…`:`Conciliar ${exactos.length}`}</button>}
                <span style={{fontSize:12,color:'rgba(255,255,255,.8)',marginLeft:4}}>{loteOpen?<Gl n='chevD'/>:<Gl n='chevron'/>}</span>
              </div>
              {loteOpen&&<div style={{padding:'10px 12px',borderTop:`1px solid ${C.border}`}}>
                {exactos.length>0?<>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                    <span style={{fontSize:10,fontWeight:700,color:C.greenText,textTransform:'uppercase',letterSpacing:.3}}>Calzan exacto · {exactos.length}</span>
                    <button onClick={()=>setLoteConfirm(exactos)} disabled={loteBusy} style={{fontSize:11,fontWeight:700,color:'#fff',background:C.greenText,border:'none',borderRadius:8,padding:'5px 12px',cursor:'pointer',opacity:loteBusy?.6:1}}>{loteBusy?`Conciliando ${loteProg}/${exactos.length}…`:`Conciliar los ${exactos.length}`}</button>
                  </div>
                  {exactos.slice(0,25).map(({m,f})=>(
                    <div key={m.id} onClick={()=>{setLoteOpen(false);setModalMov(m.id)}} title='Ver o ajustar este calce' style={{border:`0.5px solid ${C.border}`,borderRadius:10,overflow:'hidden',marginTop:8,cursor:'pointer'}}>
                      <div style={{display:'flex'}}>
                        <div style={{flex:1,padding:'8px 10px',minWidth:0}}><div style={{...SEC_LBL}}>Transferencia</div><div style={{fontSize:13,fontWeight:700,color:C.greenText,marginTop:1,fontVariantNumeric:'tabular-nums'}}>+{fmtM(m.monto)}</div><div style={{fontSize:10,color:C.muted,marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{fmtFechaDMY(m.fecha)} · {cmap[m.cliente_id]||m.nombre_contraparte||'—'}{m.rut_contraparte?` · ${m.rut_contraparte}`:''}</div></div>
                        <div style={{flex:1,padding:'8px 10px',borderLeft:`1px solid ${C.bgSoft}`,minWidth:0}}><div style={{...SEC_LBL}}>Factura</div><div style={{fontSize:13,fontWeight:700,color:C.accent,marginTop:1}}>N° {folioN(f.invoice_no)||'—'}</div><div style={{fontSize:10,color:C.muted,marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{fmtM(saldoFactura(f))}{f.receptor_name?` · ${f.receptor_name}`:f.concept?` · ${f.concept}`:''}</div></div>
                      </div>
                      <div style={{display:'flex',gap:12,padding:'5px 10px',background:C.bgSoft}}><span style={{fontSize:10,color:C.greenText,fontWeight:600}}><Gl n='tick'/> Monto exacto</span>{f.issued_at&&<span style={{fontSize:10,color:C.textSoft}}>Emitida {fmtFechaDMY(f.issued_at)}{f.due?` · vence ${fmtFechaDMY(f.due)}`:''}</span>}</div>
                    </div>
                  ))}
                  {exactos.length>25&&<div style={{fontSize:10,color:C.muted,marginTop:4}}>y {exactos.length-25} más…</div>}
                </>:<div style={{fontSize:11,color:C.muted}}>No hay calces exactos automáticos ahora.</div>}
                {revisar.length>0&&<div style={{marginTop:9,paddingTop:8,borderTop:`1px solid ${C.border}`}}>
                  <div style={{fontSize:10,fontWeight:700,color:C.soonText,textTransform:'uppercase',letterSpacing:.3,marginBottom:2}}>Por revisar · {revisar.length}</div>
                  <div style={{fontSize:10,color:C.muted,marginBottom:4}}>monto no calza exacto o hay varios candidatos — eliges tú</div>
                  {revisar.slice(0,15).map(m=>{ const cs=candidatos(m); return (
                    <div key={m.id} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 0',borderTop:`1px solid ${C.border}`,fontSize:11}}>
                      <span style={{flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}><b style={{color:C.accent}}>{cmap[m.cliente_id]||m.nombre_contraparte||'—'}</b> <span style={{color:C.muted}}>· {fmtFechaDMY(m.fecha)} · {fmtM(m.monto)}{m.rut_contraparte?` · ${m.rut_contraparte}`:''}{cs.length?` · ${cs.length} candidatas`:''}</span></span>
                      <button onClick={()=>{setLoteOpen(false);setModalMov(m.id)}} style={{fontSize:11,fontWeight:600,color:C.soonText,background:'#fff',border:`1px solid ${C.soon}`,borderRadius:8,padding:'4px 11px',cursor:'pointer',flexShrink:0}}>Elegir <Gl n='chevron'/></button>
                    </div>
                  )})}
                </div>}
                {sinFac.length>0&&<div style={{marginTop:9,paddingTop:8,borderTop:`1px solid ${C.border}`}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:2}}>
                    <span style={{fontSize:10,fontWeight:700,color:C.azulInfo,textTransform:'uppercase',letterSpacing:.3}}>Sin factura · {sinFac.length}</span>
                    {onBuscarSII&&<button onClick={()=>buscarTodoSII(sinFac)} disabled={!!siiBuscando} style={{fontSize:11,fontWeight:700,color:'#fff',background:C.azulInfo,border:'none',borderRadius:8,padding:'5px 12px',cursor:siiBuscando?'default':'pointer',opacity:siiBuscando?.6:1}}>{siiBuscando?`Buscando ${siiBuscando.hechos}/${siiBuscando.total}…`:'Buscar todo en el SII'}</button>}
                  </div>
                  <div style={{fontSize:10,color:C.muted,marginBottom:4}}>no están en la app — <b>"Buscar todo en el SII"</b> revisa el RCV de los <b>{sinFac.length}</b> pagos y hasta <b>36 meses atrás</b>, y sugiere el calce (incluye antiguas). O busca uno por su mes.</div>
                  {siiBuscando&&<div style={{margin:'2px 0 6px'}}><div style={{height:5,background:C.border,borderRadius:4,overflow:'hidden'}}><div style={{height:'100%',width:`${Math.round(siiBuscando.hechos/Math.max(1,siiBuscando.total)*100)}%`,background:C.azulInfo,transition:'width .3s'}}/></div><div style={{fontSize:9,color:C.muted,marginTop:3}}>Sincronizando {siiBuscando.mes}… ({siiBuscando.hechos}/{siiBuscando.total} meses)</div></div>}
                  {siiResumen&&!siiBuscando&&<div style={{fontSize:10,color:siiResumen.err?C.overdue:C.greenText,background:siiResumen.err?C.overdueBg:C.greenBg,borderRadius:8,padding:'5px 9px',marginBottom:6}}>{siiResumen.err?`No se pudo: ${siiResumen.err}`:`Listo · ${siiResumen.meses} mes(es) revisados · ${siiResumen.aplicadas} calzada(s)${siiResumen.huerfanas?` · ${siiResumen.huerfanas} sin cargar (revisar en Cuadrar con SII)`:''}. Las que calzan ya aparecen como sugerencia abajo.`}</div>}
                  <div style={{maxHeight:300,overflowY:'auto',margin:'0 -2px'}}>
                  {sinFac.map(m=>{ const mesPago=String(m.fecha||'').slice(0,7); return (
                    <div key={m.id} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 2px',borderTop:`1px solid ${C.border}`,fontSize:11}}>
                      <span style={{flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}><b style={{color:C.accent}}>{cmap[m.cliente_id]||m.nombre_contraparte||'—'}</b>{m.rut_contraparte?<span style={{color:C.muted}}> · {m.rut_contraparte}</span>:''} <span style={{color:C.muted}}>· {fmtM(m.monto)}</span> <span style={{color:C.grisText}}>· {mesPago}</span></span>
                      {onCotejarSII&&<button onClick={()=>onCotejarSII(mesPago)} title={`Buscar en el SII (${mesPago||'mes del pago'})`} style={{fontSize:11,fontWeight:600,color:C.azulInfo,background:'#fff',border:`1px solid ${C.azulInfo}`,borderRadius:8,padding:'4px 11px',cursor:'pointer',flexShrink:0}}>Buscar en SII</button>}
                    </div>
                  )})}
                  </div>
                </div>}
              </div>}
            </div>
          )
        })()}
        {/* El "pago en grupo" ya NO se sugiere en la vista principal: vive dentro del detalle de cada transferencia, y solo cuando es un grupo real (no descomponible en 1:1). */}
        {/* Resolver de a uno (opción 6): CTA para entrar a la bandeja foco (solo en "Sin identificar"). */}
        {focoKey==='sinid'&&!unoMode&&unoBase.length>0&&(
          <button onClick={()=>{setUnoTotal(unoBase.length);setUnoSkip(new Set());setUnoMode(true)}} style={{display:'flex',alignItems:'center',justifyContent:'center',gap:7,width:'100%',marginBottom:11,padding:'11px',borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer'}}>
            <SIcon n='id' s={15} c='#fff'/>Resolver de a uno · {unoBase.length}
          </button>
        )}
        {/* Bandeja foco: una tarjeta a la vez, con la mejor sugerencia adelante (sugMov, único). Reusa identificar / crearFondoPersonal / onCotejarSII / AsignarClienteInline. */}
        {unoMode&&focoKey==='sinid'&&(()=>{
          if(!unoCur) return (
            <div style={{border:`1px solid ${C.border}`,borderRadius:12,padding:'26px 16px',textAlign:'center',marginBottom:12}}>
              <span style={{width:34,height:34,borderRadius:'50%',background:C.greenBg,display:'inline-flex',alignItems:'center',justifyContent:'center'}}><SIcon n='check' s={18} c={C.greenText}/></span>
              <div style={{fontSize:15,fontWeight:700,color:C.greenText,marginTop:8}}>Todo resuelto</div>
              <div style={{fontSize:12,color:C.muted,marginTop:3}}>No quedan movimientos sin identificar en la cola.</div>
              <button onClick={()=>{setUnoMode(false);setUnoSkip(new Set())}} style={{marginTop:12,fontSize:12,fontWeight:600,color:C.accent,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,padding:'8px 16px',cursor:'pointer'}}>Volver a la lista</button>
            </div>
          )
          const m=unoCur, sc=sugMov(m), mesPago=String(m.fecha||'').slice(0,7)
          const done=Math.max(0,unoTotal-unoBase.length)
          const dp=String(m.fecha||'').slice(0,10).split('-'); const MM=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
          const salta=()=>setUnoSkip(s=>new Set(s).add(m.id))
          return (
            <div style={{marginBottom:12}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:7,padding:'0 2px'}}>
                <span style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:.3}}>Resolviendo</span>
                <span style={{fontSize:11,fontWeight:700,color:C.accent}}>{done} de {unoTotal}</span>
                <button onClick={()=>setUnoMode(false)} style={{marginLeft:'auto',fontSize:11,fontWeight:600,color:C.muted,background:'none',border:'none',cursor:'pointer'}}>Salir a la lista</button>
              </div>
              <div style={{height:5,background:C.border,borderRadius:4,overflow:'hidden',marginBottom:12}}><div style={{height:'100%',width:`${unoTotal?Math.round(done/unoTotal*100):0}%`,background:C.greenText,transition:'width .3s'}}/></div>
              <div style={{border:`1px solid ${C.border}`,borderRadius:12,padding:14}}>
                <div style={{display:'flex',alignItems:'center',gap:12}}>
                  <div style={{width:46,textAlign:'center',flexShrink:0,lineHeight:1.05}}><div style={{fontSize:24,fontWeight:800,color:C.accent}}>{dp.length>=3?+dp[2]:'—'}</div><div style={{fontSize:10,color:C.muted,fontWeight:600}}>{dp.length>=3?`${MM[+dp[1]-1]||''} ${dp[0].slice(2)}`:''}</div></div>
                  <div style={{flex:1,minWidth:0}}><div style={{fontSize:14,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.nombre_contraparte||tipoMov(m.descripcion)}</div><div style={{fontSize:11,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.rut_contraparte||'sin RUT'} · {m.rol_cuenta==='gastos'?'Cta. Gastos':'Cta. Honorarios'}</div></div>
                  <div style={{fontSize:16,fontWeight:800,color:C.greenText,flexShrink:0,fontVariantNumeric:'tabular-nums'}}>+{fmtM(m.monto)}</div>
                </div>
                {m.detalle_aviso&&<div style={{fontSize:11,color:C.text,marginTop:8,lineHeight:1.4}}><b>Mensaje de la transferencia:</b> {m.detalle_aviso}</div>}
                {m.descripcion&&<div style={{fontSize:10,color:C.muted,marginTop:8,lineHeight:1.4}}><b>Glosa:</b> {(m.descripcion||'').slice(0,90)}{(m.descripcion||'').length>90?'…':''}</div>}
                {sc
                  ? <div style={{background:'#F1FAF6',border:'1px solid #CFE9DD',borderRadius:12,padding:'10px 12px',marginTop:12}}>
                      <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',gap:8}}><span style={{fontSize:14,fontWeight:700,color:C.accent,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{sc.nombre}</span><span style={{fontSize:9.5,fontWeight:700,color:sc.via==='nombre'?C.greenText:C.accent,background:sc.via==='nombre'?C.greenBg:C.azulBg,borderRadius:20,padding:'2px 8px',flexShrink:0,whiteSpace:'nowrap'}}>{sc.via==='nombre'?'por el nombre':sc.via==='glosa'?`la glosa: N° ${folioN(sc.f?.invoice_no)||'—'}`:`calza N° ${folioN(sc.f?.invoice_no)||'—'}`}</span></div>
                      {(sc.via==='monto'||sc.via==='glosa')&&sc.f&&<div style={{fontSize:11,color:C.greenText,marginTop:3}}>Factura N° {folioN(sc.f.invoice_no)||'—'}{sc.f.issued_at?` · emitida ${fmtFechaDMY(sc.f.issued_at)}`:''} · {sc.via==='glosa'?'la glosa del banco nombra el folio':'monto exacto'}</div>}
                      {sc.via==='nombre'&&<div style={{fontSize:11,color:C.greenText,marginTop:3}}>Coincide por el nombre de la transferencia</div>}
                      <button disabled={busy===m.id} onClick={()=>identificar(m,sc.cid,true)} style={{marginTop:10,width:'100%',fontSize:13,fontWeight:700,color:'#fff',background:C.greenText,border:'none',borderRadius:10,padding:'10px',cursor:busy===m.id?'default':'pointer'}}>Es {sc.nombre} <Gl n='tick'/></button>
                    </div>
                  : <div style={{background:C.soonBg,borderRadius:12,padding:'10px 12px',marginTop:12}}>
                      <div style={{fontSize:13,fontWeight:700,color:C.soonText}}>Sin factura que calce</div>
                      <div style={{fontSize:11,color:C.soonText,marginTop:2}}>No está en la app — puede ser una factura antigua.</div>
                      {onCotejarSII&&<button onClick={()=>onCotejarSII(mesPago)} style={{marginTop:10,width:'100%',fontSize:13,fontWeight:700,color:'#fff',background:C.accent,border:'none',borderRadius:10,padding:'10px',cursor:'pointer'}}>Buscar en el SII</button>}
                    </div>}
                <div style={{display:'flex',gap:8,alignItems:'center',marginTop:10,flexWrap:'wrap'}}>
                  <div style={{flex:'1 1 150px',minWidth:0}}><AsignarClienteInline bill={{id:m.id}} clients={clients} onAssign={(_,cid)=>identificar(m,cid)} label='Buscar otro cliente' placeholder='Buscar cliente o RUT…'/></div>
                  <span style={{display:'inline-flex',alignItems:'center',gap:4}}><span style={{fontSize:10,color:C.textSoft}}>o fondo del equipo:</span><select disabled={busy===m.id} value='' onChange={e=>{ const p=e.target.value; e.target.value=''; if(p) crearFondoPersonal(m,p) }} style={{fontSize:10,fontWeight:600,border:`1px solid ${C.border}`,borderRadius:6,padding:'3px 6px',background:'#fff',color:C.accent,cursor:'pointer'}}><option value=''>elegir…</option>{['Cristóbal','Erasmo','Martín','Martina','Rodrigo'].map(p=><option key={p} value={p}>{p}</option>)}</select></span>
                </div>
                <button disabled={busy===m.id} onClick={()=>marcarNoCliente(m)} title='El que deposita no es cliente (un tercero o una intermediaria que nos devuelve plata). Aprende el RUT y deja de proponerlo por monto.' style={{marginTop:8,fontSize:11,fontWeight:600,color:C.muted,background:C.bgSoft,border:`1px solid ${C.border}`,borderRadius:8,padding:'6px 12px',cursor:busy===m.id?'default':'pointer'}}>No es cliente · tercero / intermediaria</button>
                <div style={{display:'flex',alignItems:'center',marginTop:12,paddingTop:10,borderTop:`1px solid ${C.border}`}}>
                  <span style={{fontSize:11,color:C.muted}}>Quedan {unoPend.length}</span>
                  <button onClick={salta} style={{marginLeft:'auto',fontSize:12,fontWeight:600,color:C.muted,background:'none',border:'none',cursor:'pointer'}}>Saltar →</button>
                </div>
              </div>
              <div style={{fontSize:10,color:C.muted,textAlign:'center',marginTop:9}}>Al confirmar aprende el RUT → los demás con ese RUT se identifican solos.</div>
            </div>
          )
        })()}
        {isDesktop&&sub==='abonos'&&!unoMode&&deskFoto}
        {isDesktop&&(sub==='abonos'||sub==='cargos')&&!unoMode&&deskPanes}
        {/* Título de la lista: separa el resumen (arriba) de los movimientos (abajo). Se oculta en modo bandeja. */}
        {!unoMode&&!(isDesktop&&(sub==='abonos'||sub==='cargos'))&&<>
        <div style={{display:'flex',alignItems:'center',gap:8,margin:'2px 3px 6px'}}>
          <span style={{fontSize:13,fontWeight:700,color:C.accent}}>Movimientos</span>
          <span onClick={()=>setOrden(o=>o==='desc'?'asc':'desc')} title='Ordenar por fecha' style={{marginLeft:'auto',fontSize:11,fontWeight:600,color:C.muted,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:3}}>Fecha
            <svg width='10' height='10' viewBox='0 0 24 24' fill='none' stroke={C.muted} strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round' style={{transform:orden==='asc'?'rotate(180deg)':'none'}}><line x1='12' y1='5' x2='12' y2='19'/><polyline points='6 13 12 19 18 13'/></svg>
          </span>
        </div>
        {/* Lista */}
        <div style={{border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden'}}>
          {lista.length===0&&<div style={{padding:30,textAlign:'center',color:C.muted,fontSize:12}}>{movs.length>0?<>No hay movimientos con estos filtros. <span onClick={()=>{setCuentaF('ambas');setMesF('todos');setAnioF('todos');setRespF('todos');setConcView('todos');setQ('')}} style={{color:C.accent,fontWeight:600,cursor:'pointer',textDecoration:'underline'}}>Ver todos</span></>:'Sin movimientos. Sube una cartola para empezar.'}</div>}
          {lista.map((m,i)=>{
            const rc=rolChip(m.rol_cuenta); const ec=estadoChip(m); const abierto=modalMov===m.id
            // Agrupación año › mes colapsable (mismo patrón que la propuesta): cabeceras inyectadas cuando cambia el año/mes; la fila solo se muestra si su año Y su mes están abiertos.
            const _ym=String(m.fecha||'').slice(0,7),_y=_ym.slice(0,4)
            const _p=lista[i-1],_pym=_p?String(_p.fecha||'').slice(0,7):null
            const _newY=i===0||_y!==(_pym?_pym.slice(0,4):null), _newM=i===0||_ym!==_pym
            // Con un filtro activo (Descalces/Sin identificar/búsqueda/año/mes) la lista va TODA expandida (si no, al resolver uno los de otros meses quedan colapsados y "desaparecen").
            const _filtroActivo = concView!=='todos' || !!q.trim() || anioF!=='todos' || mesF!=='todos' || respF!=='todos'
            const _yOpen=_filtroActivo||!concYCol.has(_y)
            const _firstYM=lista[0]?String(lista[0].fecha||'').slice(0,7):null
            const _mOpen=_filtroActivo||(concMOpen===null?_ym===_firstYM:concMOpen.has(_ym))
            const _MES=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
            const _mInfo=()=>{ let c=0,t=0; lista.forEach(x=>{ if(String(x.fecha||'').slice(0,7)===_ym){c++;t+=(x.monto||0)*(x.tipo==='abono'?1:-1)} }); return {c,t} }
            const _yCount=()=>lista.filter(x=>String(x.fecha||'').slice(0,4)===_y).length
            // Factura única conciliada → el chip "→ Factura N°X" se vuelve clickeable y despliega su detalle.
            const facObj=(()=>{ const fc=(concByMov[m.id]||[]).filter(c=>c.tipo_destino==='factura'); return fc.length===1?billing.find(b=>String(b.id)===String(fc[0].factura_id)):null })()
            const cliName=m.cliente_id?cmap[m.cliente_id]:null
            const nomBanco=(m.rut_contraparte&&nameByRut[crNormRut(m.rut_contraparte)])||m.nombre_contraparte||(m.es_interno?'Traspaso interno':tipoMov(m.descripcion))
            const rsId=(()=>{ if(!cliName) return null; let nm=null,rut=''; if(facObj&&facObj.receptor_name){nm=facObj.receptor_name;rut=facObj.receptor_rut||''} else {const r=rsLabel(m.cliente_id,clients,clientEntities); if(!r.multi&&r.name){nm=r.name;rut=r.rut||''}} return (nm&&nm!==cliName)?{name:nm,rut}:null })()
            const mostrarCli=cliName&&String(cliName).trim().toLowerCase()!==String(nomBanco||'').trim().toLowerCase()   // solo si aporta (≠ nombre del banco)
            const cat=tipoContraparte(m); const ts=cat?(TAG_STY[cat]||{bg:C.bgWarm,color:C.grisText}):null
            return (
              <Fragment key={m.id}>
              {_newY&&(
                <div onClick={()=>setConcYCol(p=>{const n=new Set(p);n.has(_y)?n.delete(_y):n.add(_y);return n})} style={{display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer',padding:'12px 14px',background:C.accent,marginTop:i>0?12:0}}>
                  <span style={{fontSize:16,fontWeight:800,color:'#fff',letterSpacing:'-.3px'}}>{_y}</span>
                  <span style={{fontSize:12,color:'#cfe0ef',transform:_yOpen?'rotate(180deg)':'none'}}>{<Gl n='chevD'/>}</span>
                </div>
              )}
              {_yOpen&&_newM&&(()=>{ const mi=_mInfo(); return (
                <div onClick={()=>setConcMOpen(prev=>{ const base=prev===null?new Set([_firstYM]):new Set(prev); base.has(_ym)?base.delete(_ym):base.add(_ym); return base })} style={{display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer',padding:'10px 13px 10px 18px',background:C.toggleOff,borderTop:`1px solid ${C.border}`}}>
                  <span style={{fontSize:14,fontWeight:700,color:C.accent}}>{_MES[+_ym.slice(5,7)-1]||_ym}</span>
                  <span style={{display:'flex',alignItems:'center',gap:9}}><span style={{fontSize:12,fontWeight:700,color:mi.t>=0?C.greenText:C.overdue,fontVariantNumeric:'tabular-nums'}}>{mi.t>=0?'+':'−'}{fmtM(Math.abs(mi.t))}</span><span style={{fontSize:11,color:C.textSoft,transform:_mOpen?'rotate(180deg)':'none'}}>{<Gl n='chevD'/>}</span></span>
                </div>
              )})()}
              {_yOpen&&_mOpen&&(
              <div id={'mov-'+m.id} style={{padding:'10px 12px',background:'#fff',borderTop:`1px solid #D7DEE3`,...(modalMov===m.id?{outline:`2px solid ${C.accent}`,outlineOffset:-2}:{})}}>
                <div onClick={()=>{setModalMov(abierto?null:m.id);setVerGlosa(false)}} style={{cursor:'pointer',display:'flex',gap:10,alignItems:'center'}}>
                  {diaGrande(m.fecha)}
                  <div style={{flex:1,minWidth:0}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3}}>
                    <span onClick={m.cliente_id&&onOpenClientFicha?(ev)=>{ev.stopPropagation();onOpenClientFicha(m.cliente_id)}:undefined} title={m.cliente_id&&onOpenClientFicha?'Ver ficha del cliente':undefined} style={{flex:1,minWidth:0,fontSize:13,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',cursor:m.cliente_id&&onOpenClientFicha?'pointer':'inherit'}}>{cliName||nomBanco}</span>
                    {m.rol_cuenta==='gastos'&&<span onClick={(e)=>{e.stopPropagation();setCuentaF(cuentaF==='gastos'?'ambas':'gastos')}} title='Cta. Gastos — filtrar por esta cuenta' style={{fontSize:9,fontWeight:700,padding:'1px 7px',borderRadius:10,background:rc.bg,color:rc.color,cursor:'pointer',flexShrink:0}}>{rc.t}</span>}
                    <span style={{fontSize:14,fontWeight:700,color:m.tipo==='abono'?C.greenText:C.overdue,flexShrink:0}}>{m.tipo==='abono'?'+':'−'}{fmtM(m.monto)}</span>
                  </div>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
                    <span title={m.descripcion||''} style={{fontSize:11,color:C.muted,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{cliName?(rsId?`${rsId.name}${rsId.rut?` · ${fmtRutCL(rsId.rut)}`:''}`:`${nomBanco}${m.rut_contraparte?` · ${m.rut_contraparte}`:''}`):(m.rut_contraparte||tipoMov(m.descripcion))}{m.detalle_aviso?` · ${m.detalle_aviso}`:''}{m.rut_contraparte&&!rutValido(m.rut_contraparte)?<span style={{marginLeft:6,fontSize:9.5,fontWeight:700,color:C.overdueText,background:C.overdueBg,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap'}}>revisar RUT</span>:''}</span>
                    <span style={{display:'flex',alignItems:'center',gap:5,flexShrink:0}}>
                    {(()=>{ const _pr=m.tipo==='abono'&&!m.es_interno&&!(concByMov[m.id]?.length)&&!RESUELTAS_ABO.includes(m.categoria)&&(!m.cliente_id||esConciliable(m)); if(!_pr) return null; const _t=m.fecha?new Date(m.fecha+'T12:00').getTime():NaN; if(isNaN(_t)) return null; const _d=Math.floor((Date.now()-_t)/86400000); if(_d<30) return null; const _c=_d>90?C.overdueText:C.soonText,_b=_d>90?C.overdueBg:C.soonBg; return <span title={`Sin cruzar hace ${_d} días`} style={{fontSize:9.5,fontWeight:700,color:_c,background:_b,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap'}}>{_d>90?'+90 días':`${_d} días`}</span> })()}
                    <span onClick={facObj?(e)=>{e.stopPropagation();setFacChip(facChip===m.id?null:m.id)}:undefined} style={{fontSize:10,fontWeight:600,padding:'1px 8px',borderRadius:20,background:ec.bg,color:ec.c,cursor:facObj?'pointer':'default',flexShrink:0}}>{ec.t}{facObj?(facChip===m.id?<>{" "}<Gl n='chevU'/></>:<>{" "}<Gl n='chevD'/></>):''}</span>
                    </span>
                  </div>
                  {facObj&&(()=>{ const ts=(terc||[]).filter(t=>String(t.billing_id)===String(facObj.id)); if(!ts.length) return null   // la factura que salda este abono tiene comisión de un proveedor → se ve aquí
                    const g={}; ts.forEach(t=>{ const k=String(t.proveedor_id||t.proveedor); if(!g[k]) g[k]={id:t.proveedor_id,nom:t.proveedor||'proveedor',pend:0,pag:0}; if(t.estado==='pagado') g[k].pag+=Number(t.monto)||0; else g[k].pend+=Number(t.monto)||0 })
                    return Object.values(g).map(x=><div key={x.id||x.nom} onClick={e=>{e.stopPropagation();x.id&&onOpenProveedor&&onOpenProveedor(x.id)}} style={{fontSize:10.5,color:C.muted,marginTop:3,cursor:x.id&&onOpenProveedor?'pointer':'default'}}>Incluye comisión de {(proveedores||[]).find(p=>String(p.id)===String(x.id))?.nombre||x.nom} · {x.pend>0?<><b style={{color:C.soonText,fontVariantNumeric:'tabular-nums'}}>{fmtM(x.pend)}</b> por pagar</>:<>{fmtM(x.pag)} pagada</>} <Gl n='chevron'/></div>) })()}
                  {facObj&&facChip===m.id&&(()=>{ const paid=facObj.status==='Pagado'; return (
                    <div onClick={e=>e.stopPropagation()} style={{marginTop:6,background:C.bgPanel,border:`1px solid ${C.border}`,borderRadius:10,padding:'9px 11px'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:5}}><span style={{fontSize:12,fontWeight:700,color:C.accent}}>{lblFacturaN(facObj)}</span>{(()=>{ const e=facturaRespaldo(facObj,aplicadoByFactura,cartolaHasta); return e?<span style={{fontSize:9.5,fontWeight:700,borderRadius:20,padding:'2px 8px',background:e.bg,color:e.fg,whiteSpace:'nowrap'}}>{e.label}</span>:null })()}</div>
                      <div style={{display:'flex',justifyContent:'space-between',fontSize:11,padding:'2px 0'}}><span style={{color:C.textSoft}}>Concepto</span><span style={{color:C.text,fontWeight:600,maxWidth:'62%',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{facObj.concept||'—'}</span></div>
                      <div style={{display:'flex',justifyContent:'space-between',fontSize:11,padding:'2px 0'}}><span style={{color:C.textSoft}}>Emisión</span><span style={{color:C.text,fontWeight:600}}>{fmtFechaDMY(facObj.issued_at)}{facObj.due?` · vence ${fmtFechaDMY(facObj.due)}`:''}</span></div>
                      <div style={{display:'flex',justifyContent:'space-between',fontSize:11,padding:'2px 0'}}><span style={{color:C.textSoft}}>Monto</span><span style={{color:C.text,fontWeight:600}}>{fmtM(facObj.amount)}</span></div>
                      {facObj.receptor_name&&<div style={{display:'flex',justifyContent:'space-between',fontSize:11,padding:'2px 0'}}><span style={{color:C.textSoft}}>Razón social</span><span style={{color:C.text,fontWeight:600,maxWidth:'62%',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{facObj.receptor_name}{facObj.receptor_rut?` · ${fmtRutCL(facObj.receptor_rut)}`:''}</span></div>}
                    </div>
                  )})()}
                  </div>
                </div>
                {!abierto&&m.tipo==='cargo'&&!m.es_interno&&!(concByMov[m.id]?.length)&&!m.categoria&&cargoInlineSug(m)}
                {!abierto&&m.tipo==='abono'&&!m.es_interno&&!(concByMov[m.id]?.length)&&!RESUELTAS_ABO.includes(m.categoria)&&(!m.cliente_id||esConciliable(m))&&abonoInlineAcc(m)}
                {abierto&&detalleMov(m)}
              </div>
              )}
              </Fragment>
            )
          })}
        </div>
        </>}
      </div>
      {revSugOpen&&(
        <Modal title='Identificar por nombre' fullscreenOnMobile onClose={()=>setRevSugOpen(false)} footer={<div style={{display:'flex',gap:8}}><button onClick={()=>setRevSugOpen(false)} style={{flex:1,height:44,borderRadius:10,border:`1px solid ${C.border}`,background:'#fff',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button><button disabled={revSugBusy||revSugSel.size===0} onClick={identificarLote} style={{flex:2,height:44,borderRadius:10,border:'none',background:revSugSel.size===0?C.done:C.accent,color:'#fff',fontSize:13,fontWeight:600,cursor:revSugSel.size===0?'default':'pointer'}}>{revSugBusy?'Identificando…':`Identificar ${revSugSel.size}`}</button></div>}>
            <div style={{fontSize:11,color:C.muted,marginBottom:6}}>Abonos con un cliente sugerido por nombre único — confirma los correctos.</div>
              {sugeridosId.length===0&&<div style={{fontSize:12,color:C.muted,textAlign:'center',padding:24}}>Sin sugerencias pendientes.</div>}
              {sugeridosId.map(s=>{ const on=revSugSel.has(s.mov.id); return (
                <div key={s.mov.id} onClick={()=>setRevSugSel(p=>{const n=new Set(p);n.has(s.mov.id)?n.delete(s.mov.id):n.add(s.mov.id);return n})} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 0',borderTop:`0.5px solid ${C.border}`,cursor:'pointer'}}>
                  <span style={{width:18,height:18,borderRadius:6,flexShrink:0,border:`1.5px solid ${on?C.accent:C.done}`,background:on?C.accent:'#fff',display:'inline-flex',alignItems:'center',justifyContent:'center'}}>{on&&<svg width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='#fff' strokeWidth='3.5' strokeLinecap='round' strokeLinejoin='round'><polyline points='20 6 9 17 4 12'/></svg>}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,color:C.text,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.mov.nombre_contraparte||'—'}</div>
                    <div style={{fontSize:10,color:C.muted}}>{s.mov.fecha?fmtFechaDMY(s.mov.fecha):''} · {fmt(s.mov.monto)}</div>
                  </div>
                  <span style={{fontSize:11,color:C.greenText,fontWeight:600,flexShrink:0,maxWidth:140,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>→ {cmap[s.cid]||'Cliente'}</span>
                </div>
              )})}
        </Modal>
      )}
      {ccRevOpen && <Modal fullscreen fsMaxWidth={720} title={<span style={{color:C.accent}}>Revisión de caja chica</span>} onClose={()=>setCcRevOpen(false)}>
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,background:C.bgPanel,border:`1px solid ${C.border}`,borderRadius:10,padding:'10px 12px'}}>
            <div><div style={{fontSize:12,fontWeight:700,color:C.text}}>Barrido automático diario</div><div style={{fontSize:10,color:C.muted}}>enlaza solo: mismo monto, transferencia el mismo día de la caja o el anterior</div></div>
            <span onClick={()=>setCcAutoGlob(!ccAuto)} title='Barrido diario' style={{width:34,height:18,borderRadius:20,background:ccAuto?C.greenText:C.toggleOff,position:'relative',flexShrink:0,cursor:'pointer'}}><span style={{position:'absolute',top:2,left:ccAuto?18:2,width:14,height:14,borderRadius:'50%',background:'#fff',transition:'left .15s'}}/></span>
          </div>
          {dobleCC.length>0 && <div>
            <div style={{fontSize:10,fontWeight:800,textTransform:'uppercase',letterSpacing:.4,color:C.overdueText,margin:'0 0 7px'}}>Registradas dos veces · caja chica y conciliación · {dobleCC.length}</div>
            {dobleCC.map(x=>(<div key={x.m.id} style={{display:'flex',alignItems:'center',flexWrap:'wrap',gap:10,padding:'10px 11px',border:`1px solid ${C.overdueBd}`,background:'#fff',borderRadius:10,marginBottom:7}}>
              {diaGrande(x.m.fecha)}
              <div style={{flex:'1 1 170px',minWidth:0}}>
                <div style={{fontSize:13,fontWeight:700,color:C.text}}>{x.ps[0]?.user_name||'—'} · {x.m.tipo==='abono'?'devolución':'transferencia'} <span style={{color:C.accent}}>{fmtM(Math.abs(x.m.monto||0))}</span></div>
                <div style={{fontSize:10.5,color:C.muted,marginTop:2}}>conciliada {fmtN(x.conc)} · en la caja {fmtN(x.pc)}</div>
              </div>
              <button onClick={()=>verMovCC(x.m.id)} style={{fontSize:11,fontWeight:700,color:C.accent,background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:'6px 10px',cursor:'pointer',flexShrink:0}}>Ver en Banco</button>
              <button onClick={()=>quitarDobleCC(x)} style={{fontSize:11,fontWeight:700,color:C.overdueText,background:C.surface,border:`1px solid ${C.overdueBd}`,borderRadius:8,padding:'6px 10px',cursor:'pointer',flexShrink:0}}>Quitar de la caja</button>
            </div>))}
          </div>}
          {revisionCC.listas.length>0 && <div>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:7,gap:8}}>
              <span style={{fontSize:10,fontWeight:800,textTransform:'uppercase',letterSpacing:.4,color:C.greenText}}>Se enlazan solas · mismo monto, mismo día o el anterior</span>
              {revisionCC.listas.length>1&&<button disabled={ccBulk} onClick={enlazarTodasCC} style={{fontSize:11,fontWeight:700,color:'#fff',background:C.greenText,border:'none',borderRadius:8,padding:'6px 12px',cursor:ccBulk?'default':'pointer',flexShrink:0,whiteSpace:'nowrap'}}>{ccBulk?'Enlazando…':`Enlazar las ${revisionCC.listas.length}`}</button>}
            </div>
            {revisionCC.listas.map(({petty,cargo})=> ccRow(petty,cargo,'ok'))}
          </div>}
          {revisionCC.porRevisar.length>0 && <div>
            <div style={{fontSize:10,fontWeight:800,textTransform:'uppercase',letterSpacing:.4,color:C.soonText,margin:'4px 0 7px'}}>Por confirmar</div>
            {revisionCC.porRevisar.map(ccSugRow)}
          </div>}
          {revisionCC.cajasSinTransf.length>0 && <div>
            <div style={{fontSize:10,fontWeight:800,textTransform:'uppercase',letterSpacing:.4,color:C.overdueText,margin:'4px 0 7px'}}>Cajas sin transferencia en el banco</div>
            {revisionCC.cajasSinTransf.map(({petty:p,dias})=> <div key={p.id} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 11px',border:`1px solid ${C.border}`,borderRadius:10,marginBottom:7}}>{diaGrande(p.delivered_at)}<div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:600,color:C.text}}>{p.user_name} · caja{p.notes?` · ${String(p.notes).replace(/\s*·\s*mov:[0-9a-f-]+/g,'')}`:''}</div><div style={{fontSize:10,color:dias>=5?C.overdueText:C.muted,fontWeight:dias>=5?700:400}}>{dias>=5?`${nDias(dias)} sin transferencia que la respalde · ¿salió de otra cuenta?`:'esperando la cartola del banco'}</div></div><div style={{fontSize:13,fontWeight:800,color:C.accent,fontVariantNumeric:'tabular-nums'}}>{fmtM(p.amount)}</div></div>)}
          </div>}
          {revisionCC.transfSinCaja.length>0 && <div>
            <div style={{...SEC_LBL,margin:'4px 0 7px'}}>Transferencias sin caja registrada · el miembro recibe un aviso</div>
            {revisionCC.transfSinCaja.map(({cargo:m,persona,dias,esCaja,posibleSueldo})=> <div key={m.id} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 11px',border:`1px solid ${C.border}`,borderRadius:10,marginBottom:7}}>{diaGrande(_glosaTransf(m.descripcion).fecha||m.fecha)}<div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:600,color:C.text}}>{persona} · {ccTransfLbl(m)}</div><div style={{fontSize:10,color:C.muted}}>{posibleSueldo?'mismo monto que su sueldo':esCaja?'clasificada como caja chica':'sin clasificar'} · hace {nDias(dias)}</div></div>
              <button disabled={!!busy} onClick={()=>abonoCajaChica(m,persona)} style={{fontSize:11,fontWeight:700,color:C.accent,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,padding:'5px 10px',cursor:'pointer',flexShrink:0,whiteSpace:'nowrap'}}>Crear caja</button>
              <button disabled={!!busy} onClick={()=>marcarNoCajaCC(m)} style={{fontSize:11,fontWeight:700,color:C.muted,background:'none',border:'none',padding:'5px 6px',cursor:'pointer',flexShrink:0,whiteSpace:'nowrap'}}>No es caja</button></div>)}
          </div>}
          {revisionCC.listas.length===0&&revisionCC.porRevisar.length===0&&revisionCC.cajasSinTransf.length===0&&revisionCC.transfSinCaja.length===0&&<div style={{fontSize:13,color:C.textSoft,textAlign:'center',padding:16}}>Todo enlazado. No hay caja chica pendiente de cruzar con el banco.</div>}
        </div>
      </Modal>}
    </div>
  )
  if(!isDesktop) return interiorEl
  // Escritorio: SIN rail. La lista/detalle va a todo el ancho (interiorEl ya se centra a 980px) y la navegación
  // entre secciones es por el HUB de tarjetas (el botón ← vuelve al hub). Antes había un 2-panel con rail que se veía recargado.
  return <div style={{height:'calc(100vh - 66px)',overflowY:'auto',background:C.bg}}>{interiorEl}</div>  // deskRail ya no se usa (queda definido, sin render)
}

