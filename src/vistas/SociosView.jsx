// Movido desde App.jsx por scripts/mover-a-modulo.py. Sin cambios de comportamiento.
import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase, selectAll, DEMO } from '../supabase'
import { C, Gl, SEC_LBL, appAlert, appConfirm, fmt, fmtFechaDMY } from '../lib/base.jsx'
import { redondearPartes } from '../lib/cifras.js'
import { MES_C, SOCIOS_CFG, TH_BAND, _SOCIO_RET, _norm, cobradoBill, fmtMill, fmtMillLR, resultadoMes, setLearningKV, useFuentesResultado } from '../lib/compartido.jsx'

// Cobrado del mes (fuente única, = EstadoResultadosModal): facturas con paid_at en el mes, netas de anuladas/reembolsos, vía cobradoBill. Comisión del mes = terceros_pagos pagados en el mes. Ambas reusadas por OficinaHub para no divergir.
export const ingresosMesBill = (billing, ym) => (billing||[]).filter(b=>b&&!b.deleted_at&&b.status!=='Anulada'&&b.billing_type!=='reembolso'&&String(b.paid_at||'').startsWith(ym)).reduce((a,b)=>a+cobradoBill(b),0)

export const comisionMesTerc = (terceros, ym) => (terceros||[]).filter(t=>t&&t.estado==='pagado'&&String(t.pagado_at||'').startsWith(ym)).reduce((a,t)=>a+(Number(t.monto)||0),0)

// Sueldo de socio: los sueldos/bonos usan `subcategory` = nombre de la persona. Devuelve el socio si lo es, o null.
export const _SOCIO_SUELDO = e => { const scN=_norm(e.subcategory); for(const s of SOCIOS_CFG){ if(scN && (scN===_norm(s.nombre)||scN.includes(_norm(s.nombre)))) return s.nombre } return null }

export const _SOCIO_RUT_DISP = new Proxy({}, { get:(_,k)=>{ const s=SOCIOS_CFG.find(x=>x.nombre===k); return s?s.rut:undefined } })

// «¿Cuánto se puede retirar?» (Socios). Dos lecturas en paralelo, ambas desde la fuente:
// · En el banco hoy (manda): saldo de la última cartola con saldo de la cuenta de honorarios + movimientos posteriores
//   − reserva (learnings config.reserva_caja, editable) − comisiones por pagar de facturas ya pagadas por el cliente.
// · Caja del año (control): cobrado (ingresosMesBill) − costos reales (resultadoMes.cos) − comisiones pagadas − PPM pagado − retirado.
export const RESERVA_CAJA_DEF = 30000000

export function DisponibleRetiroCard({ expenses=[], clients=[], billing=[], terceros=[], costosOfiRows=[], nSocios=2, totalRet=0, yr, isDesktop=true }){
  const curY=new Date().getFullYear(), curM=new Date().getMonth()+1
  const [banco,setBanco]=useState(null)        // {saldo, al} | null (sin cartola con saldo)
  const [reserva,setReserva]=useState(RESERVA_CAJA_DEF)
  const [editRes,setEditRes]=useState(false)
  const [resTxt,setResTxt]=useState('')
  useEffect(()=>{ if(DEMO){ setBanco({saldo:42500000,al:new Date().toISOString().slice(0,10)}); return } let v=true
    ;(async()=>{ try{
      const {data:lr}=await supabase.from('learnings').select('value,updated_at').eq('kind','config').eq('key','reserva_caja').order('updated_at',{ascending:false}).limit(1)
      if(v&&lr&&lr[0]&&Number(lr[0].value)>=0) setReserva(Number(lr[0].value))
      const {data:cg}=await supabase.from('cartola_cargas').select('saldo_final,fecha_hasta,created_at').eq('rol_cuenta','honorarios').not('saldo_final','is',null).order('fecha_hasta',{ascending:false}).order('created_at',{ascending:false}).limit(1)
      const ult=cg&&cg[0]; if(!ult){ if(v) setBanco(null); return }
      const movs=await selectAll(()=>supabase.from('cartola_movimientos').select('tipo,monto,fecha').eq('rol_cuenta','honorarios').gt('fecha',ult.fecha_hasta).order('id'))
      const rows=(movs&&movs.data)||movs||[]
      let saldo=Number(ult.saldo_final)||0, al=String(ult.fecha_hasta).slice(0,10)
      ;(Array.isArray(rows)?rows:[]).forEach(m=>{ const x=Number(m.monto)||0; saldo+= m.tipo==='abono'?x:-x; const f=String(m.fecha||'').slice(0,10); if(f>al) al=f })
      if(v) setBanco({saldo,al})
    }catch(_){ if(v) setBanco(null) } })()
    return ()=>{v=false} },[])
  const guardarReserva=async()=>{ const n=Math.round(Number(String(resTxt).replace(/\D/g,''))||0); setEditRes(false); if(!(n>=0)||n>1e11) return; setReserva(n); if(DEMO) return; try{ await setLearningKV('config','reserva_caja',n) }catch(e){ appAlert('No se pudo guardar la reserva: '+(e.message||e)) } }
  const bById=useMemo(()=>{ const m={}; (billing||[]).forEach(b=>{ if(b) m[String(b.id)]=b }); return m },[billing])
  // Comisiones que ya son de otro: el cliente pagó la factura pero la comisión aún no sale del banco.
  const porPagar=useMemo(()=>(terceros||[]).filter(t=>{ if(!t||t.estado==='pagado'||!t.billing_id) return false; const b=bById[String(t.billing_id)]; return b&&!b.deleted_at&&b.status==='Pagado' }).reduce((a,t)=>a+(Number(t.monto)||0),0),[terceros,bById])
  const fu=useFuentesResultado()
  const maxM=yr<curY?12:(yr>curY?0:curM)
  const caja=useMemo(()=>{ const deps={billing,terceros,costosOfiRows,expenses,clients}; let cob=0,cos=0,com=0
    for(let m=1;m<=maxM;m++){ const ym=`${yr}-${String(m).padStart(2,'0')}`; cob+=ingresosMesBill(billing,ym); cos+=Number(resultadoMes(fu,deps,ym).cos)||0; com+=comisionMesTerc(terceros,ym) }
    const ofi=(clients||[]).find(c=>c&&(c.is_internal||/liberona\s+escala/i.test(c.name||'')))
    const ppm=ofi?(expenses||[]).filter(e=>e&&!e.deleted_at&&e.type==='gasto'&&String(e.client_id)===String(ofi.id)&&String(e.date||'').slice(0,4)===String(yr)&&String(e.category||'')==='Impuestos y patentes'&&/ppm/i.test(String(e.subcategory||''))).reduce((a,e)=>a+(Number(e.amount)||0),0):0
    const gen=cob-cos-com-ppm
    return {cob,cos,com,ppm,gen,sin:gen-totalRet} },[fu,billing,terceros,costosOfiRows,expenses,clients,yr,maxM,totalRet])   // eslint-disable-line react-hooks/exhaustive-deps
  const fM=n=>(n<0?'−':'')+fmtMill(Math.abs(Number(n)||0))
  const neg=n=>Math.abs(Number(n)||0)<1?'$0':'−'+fmtMill(Math.abs(Number(n)||0))
  const esHoy=yr===curY
  const disp=banco?banco.saldo-reserva-porPagar:null
  // Cascada (18-10): signo en columna, «=» en los totales y cifras redondeadas a $0,1M que SUMAN el total visible
  // (Disponible y Caja generada / Sin retirar fijos: son las cifras que se usan para decidir).
  const [dispV,resV,ppV]=banco?redondearPartes([disp,reserva,porPagar],1e5,[0]):[0,0,0]
  const [genV,cosV,comV,ppmV]=redondearPartes([caja.gen,caja.cos,caja.com,caja.ppm],1e5,[0])
  const [sinV,retV]=redondearPartes([caja.sin,totalRet],1e5,[0])
  const fMLR=n=>fmtMillLR(n)
  const ln=(sg,l,v,{tot,menos}={})=><div style={{display:'grid',gridTemplateColumns:'14px minmax(0,1fr) auto',columnGap:7,alignItems:'center',padding:'7px 0',borderTop:tot?`1.5px solid ${C.accent}`:`1px solid ${C.border}`,fontSize:12.5}}>
    <span style={{textAlign:'center',fontSize:13,fontWeight:700,color:tot?C.accent:C.muted}}>{sg}</span>
    <span style={{color:tot?C.accent:C.text,fontWeight:tot?800:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',minWidth:0}}>{l}</span>
    <span style={{fontWeight:tot?800:700,color:tot?C.accent:(menos?(v==='$0'?C.done:C.overdueText):C.text),fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{v}</span></div>
  const colH=(t,sub)=><div style={{display:'flex',alignItems:'baseline',gap:8,marginBottom:6}}><span style={{...SEC_LBL,whiteSpace:'nowrap'}}>{t}</span><span style={{marginLeft:'auto',fontSize:11,color:C.done,whiteSpace:'nowrap'}}>{sub}</span></div>
  const colSt={border:`1px solid ${C.border}`,borderRadius:14,padding:'13px 14px 9px',minWidth:0}
  const resLbl=editRes
    ? <span style={{display:'inline-flex',alignItems:'center',gap:6}}><input autoFocus onFocus={e=>e.target.select()} inputMode='numeric' value={resTxt} onChange={e=>{ const d=e.target.value.replace(/\D/g,''); setResTxt(d?Number(d).toLocaleString('es-CL'):'') }} onKeyDown={e=>{ if(e.key==='Enter') guardarReserva(); if(e.key==='Escape') setEditRes(false) }} style={{width:118,fontSize:12,fontWeight:700,textAlign:'right',border:`1px solid ${C.border}`,borderRadius:8,padding:'5px 8px',color:C.accent}}/><button onClick={guardarReserva} style={{fontSize:11,fontWeight:700,color:'#fff',background:C.accent,border:'none',borderRadius:8,padding:'6px 10px',cursor:'pointer'}}>Guardar</button></span>
    : <span onClick={()=>{ setResTxt(Number(reserva).toLocaleString('es-CL')); setEditRes(true) }} style={{fontSize:11,color:C.muted,cursor:'pointer',whiteSpace:'nowrap'}}>reserva {fmtMill(reserva)} · <span style={{color:C.azulInfo,fontWeight:700}}>editar</span></span>
  const perLbl=maxM===12?String(yr):`ene–${MES_C[maxM-1]}${isDesktop?' '+yr:''}`
  return (<div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:18,overflow:'hidden',marginBottom:16}}>
    <div style={{padding:'15px 18px 12px',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
      <span style={{width:30,height:30,borderRadius:9,background:C.greenBg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke={C.greenText} strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round'><path d='M3 21h18M5 21V10l7-5 7 5v11'/><path d='M9 21v-6h6v6'/></svg></span>
      <span style={{fontSize:13,fontWeight:800,color:C.accent,letterSpacing:-.2}}>¿Cuánto se puede retirar?</span>
      <span style={{marginLeft:'auto'}}>{resLbl}</span>
    </div>
    <div style={{display:'grid',gridTemplateColumns:isDesktop&&esHoy?'1fr 1fr':'1fr',gap:12,padding:'0 16px 16px'}}>
      {esHoy&&<div style={{...colSt,background:C.bgSoft}}>
        {colH('En el banco hoy',banco?`${isDesktop?'cuenta honorarios · ':''}${fmtFechaDMY(banco.al)}`:'')}
        {banco ? <>
          {ln('','Saldo en la cuenta',fMLR(dispV+resV+ppV))}
          {ln('−','Reserva',fMLR(resV),{menos:true})}
          {ln('−',isDesktop?'Comisiones por pagar (ya cobradas)':'Comisiones por pagar',fMLR(ppV),{menos:true})}
          <div style={{display:'flex',alignItems:'flex-end',gap:10,marginTop:6,padding:'12px',borderRadius:12,background:disp>=0?C.greenBg:C.overdueBg}}>
            <span style={{fontSize:14,fontWeight:800,color:disp>=0?C.greenText:C.overdueText,alignSelf:'center',width:14,textAlign:'center',flexShrink:0}}>=</span>
            <span style={{fontSize:11,fontWeight:800,textTransform:'uppercase',letterSpacing:.4,color:disp>=0?C.greenText:C.overdueText,whiteSpace:'nowrap'}}>{disp>=0?(isDesktop?'Disponible para retirar':'Disponible'):'Bajo la reserva'}
              {disp>0&&nSocios>1&&<span style={{display:'block',fontSize:11,fontWeight:600,textTransform:'none',letterSpacing:0,marginTop:2,opacity:.85}}>{fmtMill(disp/nSocios)} por socio</span>}</span>
            <span style={{marginLeft:'auto',fontSize:isDesktop?26:22,fontWeight:800,letterSpacing:-.6,color:disp>=0?C.greenText:C.overdueText,fontVariantNumeric:'tabular-nums'}}>{fMLR(dispV)}</span>
          </div></>
          : <div style={{fontSize:12,color:C.muted,padding:'8px 0 6px'}}>Falta una cartola con saldo de la cuenta de honorarios.</div>}
      </div>}
      <div style={colSt}>
        {colH('Caja del año',perLbl)}
        {ln('','Cobrado',fMLR(genV+cosV+comV+ppmV))}
        {ln('−','Costos reales',fMLR(cosV),{menos:true})}
        {ln('−','Comisiones pagadas',fMLR(comV),{menos:true})}
        {ln('−','PPM pagado',fMLR(ppmV),{menos:true})}
        {ln('=','Caja generada',fMLR(genV),{tot:true})}
        {ln('−','Retirado',fMLR(retV),{menos:true})}
        {ln('=','Sin retirar del año',fMLR(sinV),{tot:true})}
      </div>
    </div>
  </div>)
}

export function SociosView({ expenses=[], clients=[], billing=[], terceros=[], costosOfiRows=[], socios=[], isDesktop=true, onBack, onIrBanco, setExpenses }){
  const GAP=3   // días: transferencias del mismo socio a ≤3 días = el mismo retiro
  const curY=new Date().getFullYear(), curM=new Date().getMonth()+1
  const [yr,setYr]=useState(curY)
  const [eqMode,setEqMode]=useState('ambos')
  const [tablaMode,setTablaMode]=useState('monto')
  const [movVista,setMovVista]=useState('socio')
  const [expRet,setExpRet]=useState(null)
  const [busy,setBusy]=useState(null)
  const [ocultarVacios,setOcultarVacios]=useState(false)
  const [mesAbierto,setMesAbierto]=useState(null)
  const listaRef=useRef(null), porSocioRef=useRef(null)
  const scrollA=ref=>ref&&ref.current&&ref.current.scrollIntoView({behavior:'smooth',block:'start'})
  const verSocio=s=>{ setMovVista('socio'); setTimeout(()=>scrollA(listaRef),60) }
  const ofi=(clients||[]).find(c=>c.is_internal||/liberona\s+escala/i.test(c.name||''))
  const SOC_SRC=(socios&&socios.length)?socios:SOCIOS_CFG
  const SOC=SOC_SRC.map(s=>s.nombre)
  const _PAL=[[C.accent,'#EAF1F4'],['#8A6D12','#F8F1DE'],['#3B6D11','#EAF3DE'],[C.overdueText,C.overdueBg],['#A8472A','#FAECE7'],[C.tealText,C.tealBg]]
  const COL=Object.fromEntries(SOC_SRC.map((s,i)=>[s.nombre,(_PAL[i]||_PAL[0])[0]]))
  const BG=Object.fromEntries(SOC_SRC.map((s,i)=>[s.nombre,(_PAL[i]||_PAL[0])[1]]))
  const A=SOC[0], B=SOC[1]   // paridad entre 2 socios (LEA)
  const MESL=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
  const MC=['','ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
  const dnum=d=>{ const t=new Date(String(d||'').slice(0,10)+'T12:00').getTime(); return isNaN(t)?0:Math.round(t/86400000) }
  const _dmyS=d=>{ const m=String(d||'').slice(0,10).match(/^(\d{4})-(\d\d)-(\d\d)$/); return m?`${m[3]}-${m[2]}-${m[1]}`:(d||'') }
  const _mc=d=>{ const s=String(d||'').slice(0,10); const n=parseInt(s.slice(5,7),10); return n?`${s.slice(8,10)} ${MC[n]}`:'' }
  const fechaLbl=(d0,d1)=>{ if(d0===d1) return _mc(d0); const a=String(d0).slice(0,10),b=String(d1).slice(0,10); if(a.slice(5,7)===b.slice(5,7)) return `${a.slice(8,10)}–${b.slice(8,10)} ${MC[parseInt(a.slice(5,7),10)]}`; return `${_mc(d0)} – ${_mc(d1)}` }
  const fmtM=n=>fmtMill(Math.abs(Number(n)||0))   // millones, 1 decimal (helper único fmtMill)
  const yrs=(()=>{ const s=new Set([curY]); (expenses||[]).forEach(e=>{ const y=parseInt(String(e.date||'').slice(0,4),10); if(y) s.add(y) }); return [...s].sort((a,b)=>b-a) })()
  const inOfi=e=>ofi&&!e.deleted_at&&e.type==='gasto'&&String(e.client_id)===String(ofi.id)&&String(e.date||'').slice(0,4)===String(yr)
  const movs=(expenses||[]).filter(e=>inOfi(e)&&String(e.category||'').trim().toLowerCase()==='retiros').map(e=>({e,socio:_SOCIO_RET(e),amt:Number(e.amount)||0,date:String(e.date||'').slice(0,10)}))
  // clusters por socio: transferencias a ≤GAP días = un retiro
  const clusterSocio=arr=>{ const s=[...arr].sort((a,b)=>a.date.localeCompare(b.date)); const cl=[]; s.forEach(m=>{ const last=cl[cl.length-1]; if(last && dnum(m.date)-dnum(last.d1)<=GAP){ last.amt+=m.amt; last.movs.push(m); last.d1=m.date } else cl.push({socio:m.socio,d0:m.date,d1:m.date,amt:m.amt,movs:[m]}) }); return cl }
  const bySoc={}; movs.forEach(m=>{ (bySoc[m.socio]=bySoc[m.socio]||[]).push(m) })
  const retiros=[]; Object.keys(bySoc).forEach(soc=>clusterSocio(bySoc[soc]).forEach(c=>retiros.push(c)))
  const retSoc=retiros.filter(r=>SOC.includes(r.socio))
  const otros=retiros.filter(r=>!SOC.includes(r.socio))
  const sueldos={}; (expenses||[]).filter(e=>inOfi(e)&&['sueldos','bono'].includes(String(e.category||'').trim().toLowerCase())).forEach(e=>{ const s=_SOCIO_SUELDO(e); if(s) sueldos[s]=(sueldos[s]||0)+(Number(e.amount)||0) })
  const retTot={}, retN={}; retSoc.forEach(r=>{ retTot[r.socio]=(retTot[r.socio]||0)+r.amt; retN[r.socio]=(retN[r.socio]||0)+1 })
  const totalRet=movs.reduce((a,m)=>a+m.amt,0)
  const sueldoTot=SOC.reduce((a,s)=>a+(sueldos[s]||0),0)
  const nRet=retSoc.length
  const promRetiro=nRet?Math.round(totalRet/nRet):0
  const mesesComp=yr<curY?12:(yr>curY?0:Math.max(0,curM-1))
  const promDe=s=>{ const base=(retTot[s]||0)+(eqMode==='ambos'?(sueldos[s]||0):0); return mesesComp>0?Math.round(base/mesesComp):0 }
  // rondas: clusters de ambos socios a ≤GAP días = una ronda de retiro (para comparar paridad)
  const rondas=(()=>{ const cs=[...retSoc].sort((a,b)=>dnum(a.d0)-dnum(b.d0)); const rd=[]; cs.forEach(c=>{ const last=rd[rd.length-1]; if(last && dnum(c.d0)-dnum(last.d1)<=GAP){ if(dnum(c.d1)>dnum(last.d1)) last.d1=c.d1; last[c.socio]=(last[c.socio]||0)+c.amt } else { const r={d0:c.d0,d1:c.d1}; SOC.forEach(n=>r[n]=0); r[c.socio]=(r[c.socio]||0)+c.amt; rd.push(r) } }); return rd })()
  const difAcum=(retTot[A]||0)-(retTot[B]||0)
  const faltaTxt=d=>d===0?null:(d>0?`falta ${B} ${fmt(Math.abs(d))}`:`falta ${A} ${fmt(Math.abs(d))}`)
  // período = mes; dentro de un mes puede haber varias rondas de retiro. Muestro todos los meses del año transcurrido; toggle oculta los sin retiros.
  const mesesDelAnio=yr<curY?12:(yr>curY?0:curM)
  const rondasByMes={}; rondas.forEach(r=>{ const m=parseInt(String(r.d0).slice(5,7),10); (rondasByMes[m]=rondasByMes[m]||[]).push(r) })
  const mesTot=m=>{ const rs=rondasByMes[m]||[]; return {a:rs.reduce((x,r)=>x+(r[A]||0),0),b:rs.reduce((x,r)=>x+(r[B]||0),0)} }
  const sugSocio=r=>{ let a=0,b=0; rondas.forEach(x=>{ a+=(x[A]||0); b+=(x[B]||0) }); return a<=b?A:B }
  const asignar=async(r,soc)=>{ if(!(await appConfirm(`Asignar este retiro de ${fmt(r.amt)} (${fechaLbl(r.d0,r.d1)}) a ${soc}. Es reversible. ¿Confirmas?`))) return; setBusy(r.socio+'|'+r.d0); try{ const ids=r.movs.map(x=>x.e.id); await supabase.from('expenses').update({subcategory:soc,updated_at:new Date().toISOString()}).in('id',ids); setExpenses&&setExpenses(p=>p.map(x=>ids.includes(x.id)?{...x,subcategory:soc}:x)) }catch(err){ appAlert('No se pudo asignar: '+(err.message||err)) } setBusy(null) }
  const exportar=()=>{ const H=['Socio','Fecha','Monto','Transferencias']; const esc=s=>`"${String(s==null?'':s).replace(/"/g,'""')}"`; const lines=[...retSoc].sort((a,b)=>a.socio.localeCompare(b.socio)||a.d0.localeCompare(b.d0)).map(r=>[r.socio,r.d0,Math.round(r.amt),r.movs.length].map(esc).join(',')); const csv=[H.map(esc).join(','),...lines].join('\n'); const blob=new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`retiros_socios_${yr}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),1000) }
  const seg=(val,set,opts)=><span style={{display:'inline-flex',background:C.bgSoft,border:`1px solid ${C.border}`,borderRadius:20,overflow:'hidden'}}>{opts.map(([v,l])=><span key={v} onClick={()=>set(v)} style={{fontSize:10.5,fontWeight:700,padding:'6px 13px',cursor:'pointer',background:val===v?C.accent:'transparent',color:val===v?'#fff':C.muted}}>{l}</span>)}</span>
  const card={background:'#fff',border:`1px solid ${C.border}`,borderRadius:18,overflow:'hidden',marginBottom:16}
  const _thB=`1px solid ${C.border}`
  const thL={...TH_BAND,textAlign:'left',padding:'8px 18px',borderBottom:_thB}
  const thR={...thL,textAlign:'right'}
  const tdMes={fontSize:12,fontWeight:800,padding:'10px 18px',textAlign:'right',background:C.bgSoft,borderTop:_thB,color:C.accent,fontVariantNumeric:'tabular-nums'}
  const tdMesEmpty={fontSize:11,fontWeight:600,padding:'8px 18px',textAlign:'right',color:C.textSoft,borderTop:`1px solid ${C.bgSoft}`}
  const tdRet={fontSize:13,padding:'10px 18px',textAlign:'right',borderTop:`1px solid ${C.bgSoft}`,color:C.text,fontVariantNumeric:'tabular-nums'}
  const tdTot={fontSize:13,fontWeight:800,padding:'12px 18px',textAlign:'right',background:C.bgSoft,borderTop:`2px solid ${C.border}`,color:C.accent,fontVariantNumeric:'tabular-nums'}
  const pill={display:'inline-flex',alignItems:'center',fontSize:10.5,fontWeight:700,color:C.soonText,background:C.soonBg,borderRadius:6,padding:'3px 9px',whiteSpace:'nowrap'}
  const dotEl=col=><span style={{display:'inline-block',width:7,height:7,borderRadius:'50%',background:col,marginRight:5,verticalAlign:'middle'}}/>
  const chTi=(t,bg,sv)=><div style={{display:'flex',alignItems:'center',gap:9}}><span style={{width:30,height:30,borderRadius:9,background:bg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{sv}</span><span style={{fontSize:13,fontWeight:800,color:C.accent,letterSpacing:-.2}}>{t}</span></div>
  const chv=up=><svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke={C.done} strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round'><path d={up?'m18 15-6-6-6 6':'m6 9 6 6 6-6'}/></svg>
  const bankIc=<svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.4' strokeLinecap='round' strokeLinejoin='round'><path d='M7 7h10v10'/><path d='M7 17 17 7'/></svg>
  const retRow=(r)=>{ const key=r.socio+'|'+r.d0; const open=expRet===key; return (<div key={key}>
    <div onClick={()=>setExpRet(open?null:key)} style={{display:'flex',alignItems:'center',gap:13,padding:'12px 18px',borderTop:`1px solid ${C.bgSoft}`,cursor:'pointer',background:open?'#FBFCFD':'transparent'}}>
      <span style={{fontWeight:700,color:C.accent,fontSize:14,width:isDesktop?130:98}}>{fechaLbl(r.d0,r.d1)}</span>
      <span style={{color:C.muted,fontSize:11.5}}>{r.movs.length} transferencia{r.movs.length!==1?'s':''}</span>
      <span style={{marginLeft:'auto',fontWeight:800,color:COL[r.socio]||C.text,fontVariantNumeric:'tabular-nums',fontSize:15}}>{fmt(r.amt)}</span>
      <span style={{flexShrink:0}}>{chv(open)}</span>
    </div>
    {open&&<><div style={{padding:'7px 18px 7px 40px',fontSize:9.5,fontWeight:700,textTransform:'uppercase',letterSpacing:.3,color:C.textSoft,background:'#FBFCFD',borderTop:`1px solid ${C.bgSoft}`}}>{r.movs.length} transferencia{r.movs.length!==1?'s':''}{r.movs.length>1?' · partido por el límite diario':''}</div>
      {r.movs.map((mv,i)=><div key={i} style={{display:'flex',alignItems:'center',gap:11,padding:'9px 18px 9px 40px',borderTop:`1px solid ${C.bgSoft}`,fontSize:12.5,background:'#FBFCFD'}}>
        <span style={{color:C.muted,width:58,flexShrink:0}}>{_mc(mv.date)}</span>
        <span style={{color:C.textSoft,fontSize:11,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1}}>{mv.e.concept||'Transferencia'}</span>
        <span style={{fontWeight:700,fontVariantNumeric:'tabular-nums',flexShrink:0}}>{fmt(mv.amt)}</span>
        <span onClick={e=>{e.stopPropagation(); onIrBanco&&onIrBanco(_SOCIO_RUT_DISP[r.socio]||r.socio)}} style={{display:'flex',alignItems:'center',gap:4,justifyContent:'flex-end',fontSize:11,fontWeight:700,color:C.azulInfo,cursor:'pointer',width:72,flexShrink:0}}>Banco {bankIc}</span>
      </div>)}</>}
  </div>) }
  return (
  <div style={{maxWidth:isDesktop?1060:'100%',margin:'0 auto',padding:isDesktop?'0 20px 44px':'0 16px 44px'}}>
    <div style={{display:'flex',alignItems:'center',gap:11,margin:'4px 0 18px',flexWrap:'wrap'}}>
      <button onClick={onBack} style={{display:'flex',alignItems:'center',gap:6,background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:13,fontWeight:700,padding:0}}><svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round'><path d='M19 12H5'/><path d='m12 19-7-7 7-7'/></svg>Oficina</button>
      <h1 style={{fontSize:isDesktop?21:19,fontWeight:800,color:C.accent,letterSpacing:-.5}}>Socios · retiros y sueldos</h1>
      {difAcum===0
        ? <span style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:11,fontWeight:700,color:C.greenText,background:C.greenBg,borderRadius:20,padding:'6px 12px'}}><svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.6' strokeLinecap='round' strokeLinejoin='round'><path d='M20 6 9 17l-5-5'/></svg>Retiros al día</span>
        : <span style={{fontSize:11,fontWeight:700,color:C.soonText,background:C.soonBg,borderRadius:20,padding:'6px 12px'}}>Por igualar · {faltaTxt(difAcum)}</span>}
      <span style={{flex:1}}/>
      <select value={yr} onChange={e=>setYr(parseInt(e.target.value,10))} style={{fontSize:12,fontWeight:700,border:`1px solid ${C.border}`,borderRadius:20,padding:'6px 10px',background:C.azulBg,color:C.accent,cursor:'pointer'}}>{yrs.map(y=><option key={y} value={y}>{y}</option>)}</select>
      {nRet>0&&<button onClick={exportar} style={{display:'flex',alignItems:'center',gap:6,fontSize:12,fontWeight:700,color:C.accent,background:'#fff',border:`1px solid ${C.border}`,borderRadius:10,padding:'7px 13px',cursor:'pointer'}}><svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round'><path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'/><path d='m7 10 5 5 5-5'/><path d='M12 15V3'/></svg>Exportar</button>}
    </div>

    <div style={{display:'grid',gridTemplateColumns:isDesktop?'1.25fr 1fr 1fr':'1fr 1fr',gap:12,marginBottom:12}}>
      <div onClick={()=>scrollA(listaRef)} style={{background:C.accent,color:'#fff',borderRadius:18,padding:'19px 21px',gridColumn:isDesktop?'auto':'1/-1',cursor:'pointer',position:'relative'}}>
        <span style={{position:'absolute',top:16,right:16,color:'#85B7EB',fontSize:16,fontWeight:700}}><Gl n='chevron'/></span>
        <div style={{display:'flex',alignItems:'center',gap:7,fontSize:10,fontWeight:800,textTransform:'uppercase',letterSpacing:.5,color:'#9FC6D8'}}><svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='#9FC6D8' strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round'><path d='M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'/><circle cx='9' cy='7' r='4'/><path d='M22 21v-2a4 4 0 0 0-3-3.87'/><path d='M16 3.13a4 4 0 0 1 0 7.75'/></svg>A favor de socios · {yr}</div>
        <div style={{fontSize:40,fontWeight:800,letterSpacing:-1.5,lineHeight:1,margin:'11px 0 10px',fontVariantNumeric:'tabular-nums'}}>{fmtM(totalRet+sueldoTot)}</div>
        <div style={{display:'flex',gap:10}}>
          <div style={{flex:1,background:'rgba(255,255,255,.1)',borderRadius:10,padding:'8px 11px'}}><div style={{fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:.3,color:'#9FC6D8'}}>Retiros</div><div style={{fontSize:15,fontWeight:800,marginTop:1,fontVariantNumeric:'tabular-nums'}}>{fmtM(totalRet)}</div></div>
          <div style={{flex:1,background:'rgba(255,255,255,.1)',borderRadius:10,padding:'8px 11px'}}><div style={{fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:.3,color:'#9FC6D8'}}>Sueldos</div><div style={{fontSize:15,fontWeight:800,marginTop:1,fontVariantNumeric:'tabular-nums'}}>{fmtM(sueldoTot)}</div></div>
        </div>
      </div>
      {[['Retirado '+yr,fmtM(totalRet),nRet+' retiros · '+fmtM(promRetiro)+' prom.',C.azulBg,C.azulInfo,<><path d='M21 12V7H5a2 2 0 0 1 0-4h14v4'/><path d='M3 5v14a2 2 0 0 0 2 2h16v-5'/><path d='M18 12a2 2 0 0 0 0 4h4v-4Z'/></>],['Sueldos socios',fmtM(sueldoTot),SOC.join(' + '),BG[B]||'#F8F1DE','#8A6D12',<><rect x='2' y='7' width='20' height='14' rx='2'/><path d='M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16'/></>]].map((k,i)=>
        <div key={i} onClick={()=>scrollA(i===0?listaRef:porSocioRef)} style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:16,padding:'16px 17px',cursor:'pointer',position:'relative'}}>
          <span style={{position:'absolute',top:15,right:14,color:C.textSoft,fontSize:15,fontWeight:700}}><Gl n='chevron'/></span>
          <span style={{width:34,height:34,borderRadius:10,background:k[3],display:'flex',alignItems:'center',justifyContent:'center',marginBottom:14}}><svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke={k[4]} strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round'>{k[5]}</svg></span>
          <div style={{fontSize:27,fontWeight:800,color:C.accent,letterSpacing:-.9,fontVariantNumeric:'tabular-nums'}}>{k[1]}</div>
          <div style={{...SEC_LBL,marginTop:3}}>{k[0]}</div>
          <div style={{fontSize:11,color:C.textSoft,marginTop:5}}>{k[2]}</div>
        </div>)}
    </div>

    <DisponibleRetiroCard expenses={expenses} clients={clients} billing={billing} terceros={terceros} costosOfiRows={costosOfiRows} nSocios={SOC.length} totalRet={totalRet} yr={yr} isDesktop={isDesktop}/>

    <div ref={porSocioRef} style={card}>
      <div style={{padding:'15px 18px 13px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}>
        {chTi('Por socio · total y promedio',C.greenBg,<svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='#1D9E75' strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round'><circle cx='12' cy='8' r='4'/><path d='M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1'/></svg>)}
        {seg(eqMode,setEqMode,[['ambos','Retiro + sueldo'],['retiros','Solo retiros']])}
      </div>
      <div style={{display:'grid',gridTemplateColumns:isDesktop?'1fr 1fr':'1fr',gap:12,padding:'2px 16px 16px'}}>
        {SOC.map(s=>{ const tot=(retTot[s]||0)+(sueldos[s]||0); return <div key={s} onClick={()=>verSocio(s)} style={{background:BG[s],borderRadius:15,padding:'17px 18px',cursor:'pointer',position:'relative'}}>
          <span style={{position:'absolute',top:15,right:15,color:COL[s],opacity:.5,fontSize:15,fontWeight:700}}><Gl n='chevron'/></span>
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12}}><span style={{width:36,height:36,borderRadius:'50%',background:COL[s],color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:14}}>{s[0]}</span><span style={{fontWeight:800,fontSize:16,color:COL[s]}}>{s}</span><span style={{marginLeft:'auto',marginRight:16,fontSize:11,fontWeight:700,color:C.muted}}>{retN[s]||0} retiro{(retN[s]||0)!==1?'s':''}</span></div>
          <div style={{fontSize:34,fontWeight:800,letterSpacing:-1.1,lineHeight:1,color:COL[s],fontVariantNumeric:'tabular-nums'}}>{fmtM(tot)}</div>
          <div style={{...SEC_LBL,marginTop:4}}>total a favor · {yr}</div>
          <div style={{display:'flex',gap:10,marginTop:13}}>
            <div style={{flex:1,background:'rgba(255,255,255,.65)',borderRadius:10,padding:'9px 11px'}}><div style={{...SEC_LBL}}>Retiros</div><div style={{fontSize:14,fontWeight:800,marginTop:2,color:COL[s],fontVariantNumeric:'tabular-nums'}}>{fmt(retTot[s]||0)}</div></div>
            <div style={{flex:1,background:'rgba(255,255,255,.65)',borderRadius:10,padding:'9px 11px'}}><div style={{...SEC_LBL}}>Sueldo</div><div style={{fontSize:14,fontWeight:800,marginTop:2,color:COL[s],fontVariantNumeric:'tabular-nums'}}>{fmt(sueldos[s]||0)}</div></div>
          </div>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginTop:10,background:'rgba(255,255,255,.65)',borderRadius:10,padding:'10px 12px'}}>
            <div style={{...SEC_LBL,lineHeight:1.3}}>Promedio<br/>mensual</div>
            <div style={{textAlign:'right'}}><div style={{fontSize:18,fontWeight:800,color:COL[s],fontVariantNumeric:'tabular-nums'}}>{fmtM(promDe(s))}</div><div style={{fontSize:9.5,color:C.textSoft,fontWeight:600}}>÷ {mesesComp} meses{mesesComp>0?` · ene–${MC[Math.min(12,mesesComp)]}`:''}</div></div>
          </div>
        </div> })}
      </div>
    </div>

    <div style={card}>
      <div style={{padding:'15px 18px 13px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
        {chTi('Retiros por mes',C.soonBg,<svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='#9A6413' strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round'><rect x='3' y='4' width='18' height='18' rx='2'/><path d='M16 2v4M8 2v4M3 10h18'/></svg>)}
        <div style={{display:'flex',alignItems:'center',gap:14,flexWrap:'wrap'}}>
          <span onClick={()=>setOcultarVacios(v=>!v)} style={{display:'inline-flex',alignItems:'center',gap:7,fontSize:10.5,fontWeight:700,color:C.muted,cursor:'pointer'}}>
            <span style={{width:30,height:17,borderRadius:10,background:ocultarVacios?C.accent:C.border,position:'relative',transition:'.15s',flexShrink:0}}><span style={{position:'absolute',top:2,left:ocultarVacios?15:2,width:13,height:13,borderRadius:'50%',background:'#fff',transition:'.15s',boxShadow:'0 1px 2px rgba(0,0,0,.2)'}}/></span>
            Ocultar meses sin retiros
          </span>
          {seg(tablaMode,setTablaMode,[['monto','Monto'],['dif','Diferencia'],['acum','Acumulado']])}
        </div>
      </div>
      {mesesDelAnio===0&&<div style={{padding:'20px 18px',textAlign:'center',color:C.textSoft,fontSize:13}}>Sin datos de {yr}.</div>}
      {mesesDelAnio>0&&<div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse'}}>
        <thead><tr>
          <th style={thL}>Período</th>
          {tablaMode==='monto'&&<><th style={thR}>{dotEl(COL[A])}{A}</th><th style={thR}>{dotEl(COL[B])}{B}</th></>}
          <th style={thR}>{tablaMode==='acum'?`Acumulado (${(A||'')[0]}−${(B||'')[0]})`:'Diferencia'}</th>
        </tr></thead>
        <tbody>
          {(()=>{ let acum=0; const out=[]
            for(let m=1;m<=mesesDelAnio;m++){
              const rs=(rondasByMes[m]||[]).slice().sort((a,b)=>String(a.d0).localeCompare(String(b.d0)))
              if(rs.length===0){ if(ocultarVacios) continue; out.push(<tr key={'m'+m}><td style={{...tdMesEmpty,textAlign:'left',fontWeight:700}}>{MESL[m-1]}</td>{tablaMode==='monto'&&<><td style={tdMesEmpty}>—</td><td style={tdMesEmpty}>—</td></>}<td style={tdMesEmpty}>sin retiros</td></tr>); continue }
              const mt=mesTot(m), md=mt.a-mt.b
              const abierto=mesAbierto===m
              out.push(<tr key={'m'+m} onClick={()=>setMesAbierto(abierto?null:m)} style={{cursor:'pointer'}}>
                <td style={{...tdMes,textAlign:'left'}}>
                  <span style={{display:'inline-block',width:11,marginRight:5,color:C.textSoft,transform:abierto?'rotate(90deg)':'none',transition:'transform .15s',fontSize:11,fontWeight:700}}><Gl n='chevron'/></span>
                  {MESL[m-1]}<span style={{color:C.muted,fontWeight:600}}>{` · ${rs.length} retiro${rs.length!==1?'s':''}`}</span>
                </td>
                {tablaMode==='monto'&&<><td style={tdMes}>{mt.a>0?fmt(mt.a):'—'}</td><td style={tdMes}>{mt.b>0?fmt(mt.b):'—'}</td></>}
                <td style={tdMes}>{tablaMode==='acum'?'':(md===0?<span style={{color:C.textSoft,fontWeight:600}}>$0</span>:<span style={pill}>{faltaTxt(md)}</span>)}</td>
              </tr>)
              rs.forEach((r,ri)=>{ const c=r[A]||0,er=r[B]||0,d=c-er; acum+=d; const falta=d!==0
                if(!abierto) return
                out.push(<tr key={'r'+m+'_'+ri} onClick={()=>scrollA(listaRef)} style={{cursor:'pointer',background:falta?'#FFFCF4':'transparent'}}>
                  <td style={{...tdRet,textAlign:'left',color:C.accent,fontWeight:700,paddingLeft:22}}>{dotEl(C.done)}{fechaLbl(r.d0,r.d1)}</td>
                  {tablaMode==='monto'&&<><td style={tdRet}>{c>0?fmt(c):'—'}</td><td style={tdRet}>{er>0?fmt(er):'—'}</td></>}
                  <td style={tdRet}>{tablaMode==='acum'?(acum===0?<span style={{color:C.textSoft}}>$0</span>:<span style={{color:acum>0?C.accent:'#8A6D12',fontWeight:700}}>{acum>0?'+':'−'}{fmt(Math.abs(acum))}</span>):(d===0?<span style={{color:C.textSoft}}>$0</span>:<span style={pill}>{faltaTxt(d)}</span>)}</td>
                </tr>) })
            }
            out.push(<tr key='tot'><td style={{...tdTot,textAlign:'left'}}>Total {yr}</td>{tablaMode==='monto'&&<><td style={{...tdTot,color:COL[A]}}>{fmt(retTot[A]||0)}</td><td style={{...tdTot,color:COL[B]}}>{fmt(retTot[B]||0)}</td></>}<td style={tdTot}>{difAcum===0?<span style={{color:C.textSoft}}>$0</span>:<span style={{fontSize:10.5,color:C.soonText,fontWeight:700}}>{faltaTxt(difAcum)}</span>}</td></tr>)
            return out
          })()}
        </tbody>
      </table></div>}
    </div>

    <div ref={listaRef} style={card}>
      <div style={{padding:'15px 18px 13px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}>
        {chTi('Retiros · '+nRet+' en total',BG[A],<svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='#003C50' strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round'><line x1='12' y1='2' x2='12' y2='22'/><path d='M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6'/></svg>)}
        {seg(movVista,setMovVista,[['socio','Por socio'],['mes','Por mes'],['crono','Cronológico']])}
      </div>
      {nRet===0&&<div style={{padding:'22px 18px',textAlign:'center',color:C.textSoft,fontSize:13}}>Sin retiros registrados en {yr}.</div>}
      {otros.map((r,oi)=>{ const sg=sugSocio(r); return <div key={'o'+oi} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 18px',background:'#FFFCF4',borderTop:`1px solid ${C.bgSoft}`,flexWrap:'wrap'}}>
        <span style={{width:30,height:30,borderRadius:9,background:C.soonBg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='#9A6413' strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round'><path d='M12 3v18'/><path d='m6 8 6-4 6 4'/><path d='M6 8 3 14a3.5 3.5 0 0 0 6 0Z'/><path d='m18 8-3 6a3.5 3.5 0 0 0 6 0Z'/></svg></span>
        <div style={{flex:'1 1 200px',fontSize:12,color:C.text,lineHeight:1.45}}>Retiro de <b style={{color:C.accent}}>{fmt(r.amt)}</b> ({fechaLbl(r.d0,r.d1)}) sin socio. Por la paridad correspondería a <b style={{color:C.accent}}>{sg}</b>.</div>
        <div style={{display:'flex',gap:8,flexShrink:0}}><button disabled={busy===r.socio+'|'+r.d0} onClick={()=>asignar(r,sg)} style={{fontSize:11,fontWeight:700,border:'none',borderRadius:8,padding:'7px 13px',background:C.accent,color:'#fff',cursor:'pointer'}}>Sí, es {sg}</button><button onClick={()=>asignar(r,sg===A?B:A)} style={{fontSize:11,fontWeight:700,border:`1px solid ${C.border}`,borderRadius:8,padding:'7px 11px',background:'#fff',color:C.muted,cursor:'pointer'}}>Otro</button></div>
      </div> })}
      {(()=>{
        if(movVista==='crono'){ return [...retSoc].sort((a,b)=>a.d0.localeCompare(b.d0)).map(retRow) }
        if(movVista==='mes'){ const by={}; retSoc.forEach(r=>{ const m=parseInt(r.d0.slice(5,7),10); (by[m]=by[m]||[]).push(r) }); return Object.keys(by).sort((a,b)=>a-b).map(m=><div key={m}><div style={{padding:'11px 18px',fontSize:10.5,fontWeight:800,textTransform:'uppercase',letterSpacing:.3,color:C.muted,background:C.bgSoft,display:'flex',justifyContent:'space-between'}}><span>{MESL[m-1]}</span><span>{fmt(by[m].reduce((a,r)=>a+r.amt,0))}</span></div>{by[m].sort((a,b)=>a.d0.localeCompare(b.d0)).map(retRow)}</div>) }
        return SOC.map(s=>{ const rs=retSoc.filter(r=>r.socio===s).sort((a,b)=>a.d0.localeCompare(b.d0)); if(!rs.length) return null; return <div key={s}><div style={{padding:'11px 18px',fontSize:10.5,fontWeight:800,textTransform:'uppercase',letterSpacing:.3,background:BG[s],color:COL[s],display:'flex',justifyContent:'space-between'}}><span>{s} · {rs.length} retiro{rs.length!==1?'s':''}</span><span style={{fontVariantNumeric:'tabular-nums'}}>{fmt(retTot[s]||0)}</span></div>{rs.map(retRow)}</div> })
      })()}
    </div>
  </div>)
}

