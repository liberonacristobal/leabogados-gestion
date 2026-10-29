// Movido de compartido.jsx por scripts/dividir-compartido.py. Sin cambios de comportamiento.
import { useState, useMemo } from 'react'
import { supabase, DEMO } from '../supabase'
import { fgCliente } from '../../supabase/functions/_shared/gastosReglas.js'
import { C, Gl, SEC_LBL, SIcon, _normTxt, appAlert, diaGrande, fmt, fmtFechaDMY, folioN, useIsDesktop } from './base.jsx'
import { Fragment } from 'react'
import { esRecurrente, esSubarriendo, ventaCLP, redondearPartes } from './cifras.js'
import { ADMIN_NAMES, ChevAb, MES_C, MES_L, PS_KPIS, PS_KPI_DEF, PS_RX_GASTO, SIN_SOCIO, UF_FALLBACK, _lsGet, _lsSet, flujoCajaProyectado, fmtMillLR, logActividad, mesTitulo, montoFactura, partidasPorSocio, saldoBill, setLearningKV, socioDe, socioDeVenta, socioNorm, useNoEmitirSet, usePorSocioFuentes, useUF, useUFFechas, vendidoPorSocio } from './compartido.jsx'

// Vista Por socio (Facturación › Por socio e Inteligencia › Socios): Resumen · Comparativo · Datos. Render aprobado 19-10-2026 (ABU5j4gotedSVCZJkE9kG2).
export function PorSocioVista({billing=[],sales=[],clients=[],anticipos=[],terceros=[],expenses=[],fantasmaIds=null,tabIni='res',onOpenClientFicha,onIrBanco,onIrBilling,onIrCobranza,onIrProveedores,onIrSubarriendo}){
  const isDesk=useIsDesktop()
  const [fu,setFu]=usePorSocioFuentes()
  const ufState=useUF(); const ufRef=ufState.uf||UF_FALLBACK
  const noEmitir=useNoEmitirSet()
  const bill=useMemo(()=>(fantasmaIds&&fantasmaIds.size)?(billing||[]).filter(b=>!fantasmaIds.has(String(b.id))):billing,[billing,fantasmaIds])
  const ufFechas=useUFFechas(bill)
  const COLS=ADMIN_NAMES.concat([SIN_SOCIO])
  const tinta={[ADMIN_NAMES[0]]:C.accent,[ADMIN_NAMES[1]]:C.tealText,[SIN_SOCIO]:C.soonText,Oficina:C.greenText}
  const _now=new Date(); const curYM=`${_now.getFullYear()}-${String(_now.getMonth()+1).padStart(2,'0')}`
  const [tab,setTab]=useState(tabIni)
  const [ym,setYm]=useState(curYM)
  const [vista,setVista]=useState('ytd')
  const [ps,setPs0]=useState(()=>_lsGet('porsocio_ps',false)); const setPs=v=>{ setPs0(v); _lsSet('porsocio_ps',v) }
  const [sec,setSec]=useState({f:false,c:false})
  const [open,setOpen]=useState(null)
  const [verTodo,setVerTodo]=useState(false)
  const [mm,setMm]=useState('c')
  const [rev,setRev]=useState(null)
  const [kpis,setKpis0]=useState(()=>{ const v=_lsGet('porsocio_kpis',PS_KPI_DEF); return (Array.isArray(v)?v:PS_KPI_DEF).map(k=>({fneto:'fac',ext:'cext'})[k]||k).filter((k,i,a)=>PS_KPIS.some(x=>x.k===k)&&a.indexOf(k)===i) }); const setKpis=v=>{ setKpis0(v); _lsSet('porsocio_kpis',v) }
  const [pick,setPick]=useState(false)
  const [kopen,setKopen]=useState(null)
  const [dat,setDat]=useState({sec:'f',con:'pre',soc:null,q:'',ord:'f',lim:40})
  const [fondoExtra,setFondoExtra]=useState({})
  const [ligando,setLigando]=useState(null)
  const shift=n=>{ const [yy,mo]=ym.split('-').map(Number); const d=new Date(yy,mo-1+n,1); const nym=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; if(nym<=curYM){ setYm(nym); setOpen(null); setKopen(null) } }
  const y=Number(ym.slice(0,4)), mo=Number(ym.slice(5,7))
  const MN=MES_L, mesLbl=`${MN[mo-1].charAt(0).toUpperCase()+MN[mo-1].slice(1)}`
  const perLbl=p=>p==='mes'?`${mesLbl} ${y}`:(mo===1?`enero ${y}`:`ene–${MES_C[mo-1]} ${y}`)
  const inPer=(d,p)=>{ const s=String(d||'').slice(0,7); return p==='mes'?s===ym:(s>=`${y}-01`&&s<=ym) }
  const saleById=useMemo(()=>{const m={};(sales||[]).forEach(s=>{ if(s) m[String(s.id)]=s });return m},[sales])
  const cliById=useMemo(()=>{const m={};(clients||[]).forEach(c=>{ if(c) m[String(c.id)]=c });return m},[clients])
  const billById=useMemo(()=>{const m={};(billing||[]).forEach(b=>{ if(b) m[String(b.id)]=b });return m},[billing])
  const ctx={saleById,cliById,ov:fu.ov}
  const P=useMemo(()=>partidasPorSocio({billing,sales,clients,anticipos,terceros,expenses,ic:fu.ic,ia:fu.ia,ov:fu.ov,fondoExtra}),[billing,sales,clients,anticipos,terceros,expenses,fu,fondoExtra])
  const V=useMemo(()=>vendidoPorSocio(sales,clients,ufRef,y),[sales,clients,ufRef,y])
  // «Sin socio» dice de quién es: los abogados no socios dueños de sus partidas del año (venta.responsible → abogado del cliente).
  const sinAbos=useMemo(()=>{ const set=new Set(); P.forEach(r=>{ if(r.soc!==SIN_SOCIO||r.k==='sub'||!String(r.d).startsWith(String(y))) return; const b=r.bid&&billById[String(r.bid)], sv=b&&b.sale_id&&saleById[String(b.sale_id)], a=(sv&&sv.responsible)||cliById[String(r.cid)]?.abogado_responsable; if(a&&!ADMIN_NAMES.includes(a)) set.add(a) }); return [...set].sort() },[P,y,billById,saleById,cliById])
  const Ls=c=>c!==SIN_SOCIO?c:sinAbos.length===1?sinAbos[0]:sinAbos.length?'Otros':SIN_SOCIO   // encabezados angostos
  const L=c=>c!==SIN_SOCIO?c:!sinAbos.length?SIN_SOCIO:sinAbos.length===1?`${SIN_SOCIO} · ${sinAbos[0]}`:'Otros abogados'
  const F=useMemo(()=>flujoCajaProyectado({billing:bill,sales,anticipos,noEmitir,ufFechas}),[bill,sales,anticipos,noEmitir,ufFechas])
  const sumP=(s,k,soc,p)=>P.reduce((a,r)=>a+((r.s===s&&(k==null||(Array.isArray(k)?k.includes(r.k):r.k===k))&&(!soc||r.soc===soc)&&inPer(r.d,p))?r.m:0),0)
  const vend=(soc,p)=>V.reduce((a,x)=>a+((!soc||x.soc===soc)&&(p==='mes'?x.ym===ym:x.ym<=ym)?x.m:0),0)
  // [Vendido, Facturado, Cobrado propio, Comisiones pagadas, Comisiones percibidas, Ingreso real, Subarriendo (aparte)]
  const KF=['emit','cext','reemb','nc'], KC=['fac','ant','reemb'], KI=[...KC,'com','perc']
  const card6=(soc,p)=>{ const fac=sumP('f',KF,soc,p), cp=sumP('c',KC,soc,p), com=-sumP('c','com',soc,p), pe=sumP('c','perc',soc,p); return [vend(soc,p),fac,cp,com,pe,cp-com+pe,sumP('c','sub',soc,p)] }
  const P$=v=>(v<0?'−':'')+fmt(Math.abs(Math.round(v)))
  const FMT=v=>isDesk?P$(v):fmtMillLR(v)
  const nm=cid=>cliById[String(cid)]?.name||'Sin cliente'
  const irA=it=>{ if(it.mov&&onIrBanco) return onIrBanco(it.mov); if(it.k==='com'&&onIrProveedores) return onIrProveedores(); if(it.k==='sub'&&onIrSubarriendo) return onIrSubarriendo(); if(it.cid&&onOpenClientFicha) return onOpenClientFicha(it.cid) }
  const irDatos=(soc,i,p)=>{ setVista(p); if(i===0){ setTab('cmp'); return } setDat(d=>({...d,sec:i===1?'f':'c',con:[null,'pre','cp','com','perc','pre','sub'][i],soc,lim:40})); setTab('dat') }
  const lista=(items,tit)=>{ const tot=items.reduce((a,x)=>a+x.m,0), shown=verTodo?items:items.slice(0,8)
    return <div style={{background:C.bgSoft}}>
      <div style={{display:'flex',justifyContent:'space-between',padding:isDesk?'7px 16px':'7px 10px',...SEC_LBL,fontWeight:800}}><span>{tit} · {items.length}</span><span style={{fontVariantNumeric:'tabular-nums'}}>{P$(tot)}</span></div>
      {shown.map((x,j)=><div key={j} onClick={()=>irA(x)} className='er-c' style={{display:'flex',alignItems:'center',gap:10,padding:isDesk?'7px 16px':'7px 10px',borderTop:`1px solid ${C.border}`,cursor:'pointer'}}>
        {diaGrande(x.d)}
        <div style={{flex:1,minWidth:0}}><div style={{fontSize:12.5,fontWeight:700,color:C.accent,lineHeight:1.25,overflowWrap:'anywhere'}}>{nm(x.cid)}</div><div style={{fontSize:10.5,color:C.textSoft,fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{[x.doc,isDesk?x.det:(x.doc?null:x.det)].filter(Boolean).join(' · ')}</div></div>
        <span style={{fontSize:12.5,fontWeight:800,color:x.m<0?C.overdueText:C.accent,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{P$(x.m)}</span><span style={{color:C.textSoft}}><Gl n='chevron'/></span></div>)}
      {items.length>8&&<div onClick={()=>setVerTodo(v=>!v)} style={{textAlign:'center',padding:8,fontSize:11.5,fontWeight:700,color:C.azulInfo,borderTop:`1px solid ${C.border}`,cursor:'pointer'}}>{verTodo?'Ver menos':`Ver las ${items.length}`}</div>}
    </div> }

  // ── Tarjetas: Oficina arriba, socios abajo · Octubre y Acumulado · pesos exactos (cuadran en toda dirección)
  const pcY=(()=>{ const v=COLS.map(s=>card6(s,'ytd')[5]), t=v.reduce((a,x)=>a+x,0); return t>0?redondearPartes(v.map(x=>x/t*100),1):v.map(()=>0) })()
  const filasCard=[['ref','Vendido',0],['ref','Facturado',1],['sep','Cobrado propio',2],['','− Com. pagadas',3],['','+ Com. percibidas',4],['res','= Ingreso real',5]]
  const tdC=(v,i,soc,p,col,big)=>{ const on=Math.abs(v)>=1; return <td onClick={on?()=>irDatos(soc,i,p):undefined} className={on?'er-c':undefined} style={{textAlign:'right',padding:'4px 0 4px 8px',fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap',cursor:on?'pointer':'default',fontSize:big?(isDesk?19:13.5):i===5?13.5:12,fontWeight:i===5?800:600,color:i===6?C.done:i===5?col:i<2?C.textSoft:C.text,borderTop:i===5?`1.5px solid ${col}`:i===2?`1px solid ${C.border}`:i===6?`1px dashed ${C.border}`:'none'}}>{on?P$(v):'—'}</td> }
  const cardSocio=(soc,col)=>{ const m=card6(soc,'mes'), a=card6(soc,'ytd'), pc=soc?pcY[COLS.indexOf(soc)]:0, filas=soc?filasCard:[...filasCard,['apt','Subarriendo',6]]
    return <div key={soc||'of'} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:isDesk?'12px 16px 10px':'11px 12px 8px',minWidth:0}}>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}><span style={{width:9,height:9,borderRadius:'50%',background:col,flexShrink:0}}/><span onClick={()=>{ setTab('res'); setPs(true); setSec({f:true,c:true}) }} style={{fontSize:11,fontWeight:800,letterSpacing:.5,textTransform:'uppercase',color:col,cursor:'pointer'}}>{soc?L(soc):'Oficina'} <Gl n='chevron'/></span><span style={{marginLeft:'auto',fontSize:11,fontWeight:700,color:C.muted,whiteSpace:'nowrap'}}>{soc?`${pc}% del ingreso real${isDesk?' del año':''}`:'ingreso real del año'}</span></div>
      <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed'}}><colgroup><col style={{width:'40%'}}/><col style={{width:'28%'}}/><col style={{width:'32%'}}/></colgroup>
        <thead><tr><th/>{[mesLbl,'Acumulado'].map(h=><th key={h} style={{fontSize:9.5,fontWeight:800,letterSpacing:.4,textTransform:'uppercase',textAlign:'right',padding:'4px 0 4px 8px',color:C.muted,whiteSpace:'nowrap'}}>{h}</th>)}</tr></thead>
        <tbody>{filas.map(([cl,l,i])=><tr key={i}><td style={{fontSize:i===5?12.5:12,fontWeight:i===5?800:600,color:i===6?C.done:i===5?col:i<2?C.textSoft:C.muted,padding:'4px 0',borderTop:i===5?`1.5px solid ${col}`:i===2?`1px solid ${C.border}`:i===6?`1px dashed ${C.border}`:'none',whiteSpace:'nowrap'}}>{l}</td>{tdC(m[i],i,soc,'mes',col,!soc&&i===5)}{tdC(a[i],i,soc,'ytd',col,!soc&&i===5)}</tr>)}</tbody></table></div> }
  const cardOficinaAncha=()=>{ const m=card6(null,'mes'), a=card6(null,'ytd'), col=C.greenText, socsPc=COLS.map((s,i)=>`${L(s)} ${pcY[i]}%`).join(' · ')
    const hdr=['Vendido','Facturado','Cobrado propio','− Com. pagadas','+ Com. percibidas','= Ingreso real','Subarriendo · aparte'], wH=['12%','11%','12%','12%','12%','12%','15%','14%']
    return <div style={{gridColumn:'1/-1',background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:'12px 16px 10px'}}>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}><span style={{width:9,height:9,borderRadius:'50%',background:col}}/><span onClick={()=>{ setTab('res'); setPs(true); setSec({f:true,c:true}) }} style={{fontSize:11,fontWeight:800,letterSpacing:.5,textTransform:'uppercase',color:col,cursor:'pointer'}}>Oficina <Gl n='chevron'/></span><span style={{marginLeft:'auto',fontSize:11,fontWeight:700,color:C.muted}}>{socsPc} del ingreso real del año</span></div>
      <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed'}}><colgroup>{wH.map((w,i)=><col key={i} style={{width:w}}/>)}</colgroup>
        <thead><tr><th/>{hdr.map((h,i)=><th key={h} style={{fontSize:9.5,fontWeight:800,letterSpacing:.4,textTransform:'uppercase',textAlign:'right',padding:'6px 0 6px 8px',color:i===6?C.done:C.muted,whiteSpace:'nowrap'}}>{h}</th>)}</tr></thead>
        <tbody>{[[mesLbl,m,'mes'],[`Acumulado ${y}`,a,'ytd']].map(([l,v,p],r)=><tr key={p}><td style={{fontSize:13,fontWeight:600,color:C.muted,padding:'6px 0',borderTop:r?`1px solid ${C.border}`:'none',whiteSpace:'nowrap'}}>{l}</td>{v.map((x,i)=>{ const on=Math.abs(x)>=1; return <td key={i} onClick={on?()=>irDatos(null,i,p):undefined} className={on?'er-c':undefined} style={{textAlign:'right',padding:'6px 0 6px 8px',fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap',cursor:on?'pointer':'default',fontSize:i===5?19:14,fontWeight:i===5?800:600,color:i===6?C.done:i===5?col:i<2?C.textSoft:C.text,borderTop:r?`1px solid ${C.border}`:'none'}}>{on?P$(x):'—'}</td> })}</tr>)}</tbody></table></div> }

  // ── Composición (plegada) y mes a mes: escritorio en pesos; celular en $M con cada columna cuadrada (redondearPartes)
  // Fila sin clave = subtotal (suma de las filas anteriores); el subarriendo va aparte, debajo, sin sumar.
  const FF=[['emit','','Facturas emitidas','Emitidas'],['cext','+','Comisión de externos','Com. externos'],['reemb','−','Reembolsos de gastos','Reembolsos'],['nc','−','Notas de crédito','NC']]
  const FC=[['fac','','Cobrado de facturas','De facturas'],['ant','+','Anticipos','Anticipos'],['reemb','−','Reembolsos de gastos','Reembolsos'],[null,'=','Cobrado propio','Cobrado propio'],['com','−','Comisiones pagadas','Com. pagadas'],['perc','+','Comisiones percibidas','Percibidas']]
  const colsT=ps?(isDesk?[null,...COLS]:COLS):[null]
  const th={fontSize:isDesk?10:9,fontWeight:800,letterSpacing:.3,textTransform:'uppercase',padding:isDesk?'8px 12px':'8px 5px',textAlign:'right',whiteSpace:'nowrap',background:C.bgSoft,borderBottom:`1px solid ${C.border}`}
  const td={padding:isDesk?'8px 12px':'8px 5px',borderTop:`1px solid ${C.border}`,fontSize:isDesk?(ps?12:12.5):11.5,whiteSpace:'nowrap',textAlign:'right',fontVariantNumeric:'tabular-nums'}
  const sgn={display:'inline-block',width:isDesk?13:10,textAlign:'center',fontWeight:700,color:C.muted}
  const wCols=n=>n===1?['60%','40%']:n===3?['34%','22%','22%','22%']:['24%','19%','19%','19%','19%']
  const valsCol=(s,keys,soc,p)=>{ const a=keys.map(k=>sumP(s,k,soc,p)); return isDesk?a:redondearPartes(a,1e5) }
  const Comp=()=>{ const p=vista
    const seccion=(s,lab,rows,netLab,aparte)=>{ const ab=sec[s], keys=rows.filter(r=>r[0]).map(r=>r[0]), cv=colsT.map(soc=>valsCol(s,keys,soc,p)); let ri=0
      const apV=aparte?colsT.map(soc=>sumP(s,aparte,soc,p)):null, apO=aparte&&open&&open.s===s&&open.k===aparte
      return <Fragment key={s}>
        <tr onClick={()=>setSec(x=>({...x,[s]:!x[s]}))} style={{cursor:'pointer'}}><td colSpan={colsT.length+1} style={{padding:isDesk?'12px 16px 5px':'11px 8px 5px',...SEC_LBL,fontWeight:800,borderTop:`1px solid ${C.border}`}}>{lab} <span style={{color:C.textSoft,display:'inline-block'}}><ChevAb open={ab}/></span></td></tr>
        {ab&&rows.map(([k,sg,lg,sh])=>{ if(!k){ const sv=cv.map(a=>a.slice(0,ri).reduce((x,v)=>x+v,0)); return <tr key={lg}><td style={{...td,textAlign:'left',paddingLeft:isDesk?16:8,color:C.accent,fontWeight:700,background:C.bgSoft}}><span style={{...sgn,color:C.accent}}>{sg}</span>{ps&&isDesk?sh:(isDesk?lg:sh)}</td>{sv.map((v,j)=><td key={j} style={{...td,fontWeight:700,color:C.accent,background:C.bgSoft,paddingRight:j===sv.length-1?(isDesk?16:8):undefined}}>{FMT(v)}</td>)}</tr> }
          const i=ri++; if(cv.every(a=>Math.abs(a[i])<1)) return null; const isO=open&&open.s===s&&open.k===k
          return <Fragment key={k}><tr>
            <td style={{...td,textAlign:'left',paddingLeft:isDesk?16:8,color:C.muted,fontWeight:600}}><span style={sgn}>{sg}</span>{ps&&isDesk?sh:(isDesk?lg:sh)}</td>
            {cv.map((a,j)=>{ const v=Math.abs(a[i]), soc=colsT[j], sel=isO&&open.soc===soc; return <td key={j} onClick={v>=1?()=>{ setVerTodo(false); setOpen(o=>(o&&o.s===s&&o.k===k&&o.soc===soc)?null:{s,k,soc}) }:undefined} style={{...td,fontWeight:soc===null&&ps?800:700,color:v>=1?(soc===null&&ps?C.accent:C.text):C.done,cursor:v>=1?'pointer':'default',background:sel?C.azulBg:undefined,paddingRight:j===cv.length-1?(isDesk?16:8):undefined}}>{v>=1?FMT(v):'—'}</td> })}
          </tr>{isO&&<tr><td colSpan={colsT.length+1} style={{padding:0}}>{lista(P.filter(r=>r.s===s&&r.k===k&&(!open.soc||r.soc===open.soc)&&inPer(r.d,p)).sort((a,b)=>Math.abs(b.m)-Math.abs(a.m)),`${open.soc?L(open.soc):'Oficina'} · ${lg}`)}</td></tr>}</Fragment> })}
        <tr onClick={s==='f'?onIrBilling:onIrCobranza} style={{cursor:'pointer'}}><td style={{...td,textAlign:'left',paddingLeft:isDesk?16:8,fontWeight:800,color:C.accent,borderTop:`1.5px solid ${C.accent}`,background:'#EDF1F4'}}><span style={{...sgn,color:C.accent}}>=</span>{netLab} <Gl n='chevron'/></td>
          {cv.map((a,j)=>{ const n=a.reduce((x,v)=>x+v,0); return <td key={j} style={{...td,fontWeight:800,fontSize:isDesk?(ps?12.5:14):12.5,color:C.accent,borderTop:`1.5px solid ${C.accent}`,background:'#EDF1F4',paddingRight:j===cv.length-1?(isDesk?16:8):undefined}}>{FMT(n)}</td> })}</tr>
        {apV&&apV.some(v=>Math.abs(v)>=1)&&<><tr><td style={{...td,textAlign:'left',paddingLeft:isDesk?16:8,color:C.done,fontWeight:600,borderTop:`1px dashed ${C.border}`}}><span style={sgn}/>{isDesk?'Subarriendo · aparte':'Subarriendo'}</td>
          {apV.map((v,j)=>{ const soc=colsT[j]; return <td key={j} onClick={Math.abs(v)>=1?()=>{ setVerTodo(false); setOpen(o=>(o&&o.s===s&&o.k===aparte&&o.soc===soc)?null:{s,k:aparte,soc}) }:undefined} style={{...td,color:C.done,fontWeight:600,borderTop:`1px dashed ${C.border}`,cursor:Math.abs(v)>=1?'pointer':'default',background:apO&&open.soc===soc?C.azulBg:undefined,paddingRight:j===apV.length-1?(isDesk?16:8):undefined}}>{Math.abs(v)>=1?FMT(v):'—'}</td> })}</tr>
          {apO&&<tr><td colSpan={colsT.length+1} style={{padding:0}}>{lista(P.filter(r=>r.s===s&&r.k===aparte&&(!open.soc||r.soc===open.soc)&&inPer(r.d,p)).sort((a,b)=>Math.abs(b.m)-Math.abs(a.m)),`${open.soc?L(open.soc):'Oficina'} · Subarriendo`)}</td></tr>}</>}
      </Fragment> }
    return <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed'}}><colgroup>{wCols(colsT.length).map((w,i)=><col key={i} style={{width:w}}/>)}</colgroup>
      <thead><tr><th style={{...th,textAlign:'left'}}/>{colsT.map((c,j)=><th key={j} style={{...th,color:tinta[c||'Oficina'],paddingRight:j===colsT.length-1?(isDesk?16:8):undefined}}>{c?Ls(c):'Oficina'}</th>)}</tr></thead>
      <tbody>{seccion('f','Facturado',FF,'Facturado')}{seccion('c','Cobrado',FC,'Ingreso real','sub')}</tbody></table> }
  const MesAMes=()=>{ const s=mm, nMes=mo
    const ks=s==='c'?KI:KF
    const cv=colsT.map(soc=>{ const a=Array.from({length:nMes},(_,i)=>P.reduce((x,r)=>x+((r.s===s&&ks.includes(r.k)&&(!soc||r.soc===soc)&&String(r.d).startsWith(`${y}-${String(i+1).padStart(2,'0')}`))?r.m:0),0)); return isDesk?a:redondearPartes(a,1e5) })
    const socIdx=colsT.map((c,j)=>c?j:-1).filter(j=>j>=0)
    return <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed'}}><colgroup>{(colsT.length===1?['60%','40%']:colsT.length===3?['28%','24%','24%','24%']:['24%','19%','19%','19%','19%']).map((w,i)=><col key={i} style={{width:w}}/>)}</colgroup>
      <thead><tr><th style={{...th,textAlign:'left',paddingLeft:isDesk?16:8}}>Mes</th>{colsT.map((c,j)=><th key={j} style={{...th,color:tinta[c||'Oficina'],paddingRight:j===colsT.length-1?(isDesk?16:8):undefined}}>{c?Ls(c):'Oficina'}</th>)}</tr></thead>
      <tbody>{Array.from({length:nMes},(_,k)=>nMes-1-k).map(i=>{ const vs=cv.map(a=>a[i]); const a0=socIdx.length>1?vs[socIdx[0]]:null, a1=socIdx.length>1?vs[socIdx[1]]:null, mx=a0==null?-1:(a0>=a1?socIdx[0]:socIdx[1]); const ymI=`${y}-${String(i+1).padStart(2,'0')}`, sel=vista==='mes'&&ym===ymI
        return <tr key={i} onClick={()=>{ setYm(ymI); setVista('mes'); setOpen(null) }} className='er-c' style={{cursor:'pointer',background:sel?C.azulBg:undefined}}><td style={{...td,textAlign:'left',paddingLeft:isDesk?16:8,color:C.accent,fontWeight:700}}>{isDesk?mesTitulo(new Date(y,i,15)).split(' ')[0]:MES_C[i]}</td>
          {vs.map((v,j)=><td key={j} style={{...td,fontWeight:colsT[j]===null?800:700,color:Math.abs(v)<1?C.done:colsT[j]===null?C.accent:(j===mx?tinta[colsT[j]]:C.text),paddingRight:j===vs.length-1?(isDesk?16:8):undefined}}>{Math.abs(v)>=1?FMT(v):'—'}</td>)}</tr> })}
        <tr><td style={{...td,textAlign:'left',paddingLeft:isDesk?16:8,fontWeight:800,color:C.accent,borderTop:`1.5px solid ${C.accent}`,background:'#EDF1F4'}}>{y}</td>{cv.map((a,j)=><td key={j} style={{...td,fontWeight:800,color:C.accent,borderTop:`1.5px solid ${C.accent}`,background:'#EDF1F4',paddingRight:j===cv.length-1?(isDesk?16:8):undefined}}>{FMT(a.reduce((x,v)=>x+v,0))}</td>)}</tr>
      </tbody></table> }

  // ── Para revisar (compuerta → aprende → no vuelve a preguntar)
  const fondoEnFac=useMemo(()=>{ const m={}; (expenses||[]).forEach(e=>{ const inv=fondoExtra[String(e?.id)]||e?.invoice_id; if(e&&!e.deleted_at&&e.type==='fondo'&&inv) m[String(inv)]=true }); return m },[expenses,fondoExtra])
  // Gasto dentro de una factura de honorarios: la factura menciona un gasto Y el cliente tiene un fondo sin depósito propio
  // (sin conciliación) dentro de ±31 días de la emisión o el pago y menor que la factura → esa plata vino dentro de la factura.
  // Si el fondo entró en su propia transferencia (conciliado), la factura es honorario puro y no se marca.
  const fondoCand=useMemo(()=>{ const m={}; const dd=(a,b)=>Math.abs(new Date(String(a).slice(0,10))-new Date(String(b).slice(0,10)))/864e5
    ;(billing||[]).forEach(b=>{ if(!b||b.deleted_at||!b.invoice_no||b.billing_type!=='honorarios'||b.status==='Anulada'||String(b.issued_at||'').slice(0,4)!==String(y)) return
      if(!PS_RX_GASTO.test(String(b.concept||'')+' '+String((String(b.dte_xml||'').match(/<NmbItem>(.*?)<\/NmbItem>/)||[])[1]||''))) return
      const mf=montoFactura(b)||Number(b.amount)||0
      const fs=(expenses||[]).filter(e=>e&&!e.deleted_at&&e.type==='fondo'&&String(e.client_id)===String(b.client_id)&&!e.invoice_id&&!fondoExtra[String(e.id)]&&!fu.gc.has(String(e.id))&&(Number(e.amount)||0)<mf&&[b.issued_at,b.paid_at].some(x=>x&&dd(x,e.date)<=31))
      if(fs.length) m[String(b.id)]=fs })
    return m },[billing,expenses,y,fondoExtra,fu.gc])
  const revTram=useMemo(()=>(billing||[]).filter(b=>b&&fondoCand[String(b.id)]&&!fondoEnFac[String(b.id)]&&!fu.hok.has(String(b.id))),[billing,fondoCand,fondoEnFac,fu.hok])
  const revCuo=useMemo(()=>(billing||[]).filter(b=>b&&!b.deleted_at&&!b.invoice_no&&b.issued_at&&!['Programada','Anulada'].includes(b.status)&&b.billing_type!=='reembolso'),[billing])
  const revBda=useMemo(()=>(billing||[]).filter(b=>b&&!b.deleted_at&&b.invoice_no&&b.status!=='Anulada'&&(b.billing_type==='comision'||(b.sale_id&&/^comisi/i.test(String(saleById[String(b.sale_id)]?.title||''))))&&!fu.ov[String(b.id)]),[billing,saleById,fu.ov])
  const esHonorario=async b=>{ setFu(f=>({...f,hok:new Set([...f.hok,String(b.id)])})); if(!DEMO){ await setLearningKV('honorario_sin_gasto',b.id,'1'); logActividad('honorario_sin_gasto',{tabla:'billing',id:b.id,detalle:b}) } }
  const ligar=async(b,e)=>{ setFondoExtra(x=>({...x,[String(e.id)]:b.id})); setLigando(null); if(!DEMO){ const {error}=await supabase.from('expenses').update({invoice_id:b.id}).eq('id',e.id).is('invoice_id',null); if(error){ appAlert('No se pudo ligar el gasto: '+error.message); return } logActividad('fondo_ligado_factura',{tabla:'expenses',id:e.id,detalle:{invoice_no:b.invoice_no,monto:e.amount}}) } }
  const asignar=async(b,soc)=>{ setFu(f=>({...f,ov:{...f.ov,[String(b.id)]:soc}})); if(!DEMO){ await setLearningKV('socio_factura',b.id,soc); logActividad('socio_factura',{tabla:'billing',id:b.id,detalle:{invoice_no:b.invoice_no,persona:soc}}) } }
  const revTile=(k,ic,ibg,icol,lab,val,vcol)=>{ const on=rev===k; return <div key={k} onClick={()=>setRev(r=>r===k?null:k)} style={{background:C.card,border:`1px solid ${on?C.accent:C.border}`,borderRadius:10,padding:isDesk?'10px 16px':'10px 12px',display:'flex',gap:10,alignItems:'center',cursor:'pointer',minWidth:0}}>
      <span style={{width:28,height:28,borderRadius:8,background:ibg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SIcon n={ic} s={15} c={icol}/></span>
      <div style={{minWidth:0,flex:1}}><div style={{fontSize:12,fontWeight:700,color:C.accent,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{lab}</div><div style={{fontSize:15,fontWeight:800,color:vcol,fontVariantNumeric:'tabular-nums'}}>{val}</div></div><span style={{color:C.textSoft}}><ChevAb open={on}/></span></div> }
  const grupoSocio=(arr,fn)=>COLS.map(soc=>{ const its=arr.filter(b=>socioDe(b,ctx)===soc); if(!its.length) return null; return <Fragment key={soc}><div style={{display:'flex',justifyContent:'space-between',padding:isDesk?'8px 16px':'8px 10px',fontSize:11,fontWeight:800,color:C.accent,borderTop:`1px solid ${C.border}`}}><span>{L(soc)} · {its.length}</span><span style={{fontVariantNumeric:'tabular-nums'}}>{P$(its.reduce((a,b)=>a+(montoFactura(b)||b.amount||0),0))}</span></div>{its.map(fn)}</Fragment> })
  const filaRev=(b,der,sub)=><div key={b.id} style={{display:'flex',alignItems:'center',gap:10,padding:isDesk?'7px 16px':'7px 10px',borderTop:`1px solid ${C.border}`}}>
      {diaGrande(b.issued_at)}
      <div onClick={()=>b.client_id&&onOpenClientFicha&&onOpenClientFicha(b.client_id)} style={{flex:1,minWidth:0,cursor:'pointer'}}><div style={{fontSize:12.5,fontWeight:700,color:C.accent,lineHeight:1.25,overflowWrap:'anywhere'}}>{nm(b.client_id)}</div><div style={{fontSize:10.5,color:C.textSoft,fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{b.invoice_no?`F${folioN(b.invoice_no)}`:b.status}{sub?` · ${sub}`:(isDesk&&b.concept?` · ${b.concept}`:'')}</div></div>
      <span style={{fontSize:12.5,fontWeight:800,color:C.accent,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{P$(montoFactura(b)||b.amount||0)}</span>{der}</div>
  const btn=(t,on,prim)=><button onClick={e=>{ e.stopPropagation(); on() }} style={{fontSize:11,fontWeight:700,borderRadius:8,padding:'4px 9px',border:`1px solid ${prim?C.accent:C.border}`,background:prim?C.accent:C.card,color:prim?'#fff':C.accent,cursor:'pointer',whiteSpace:'nowrap'}}>{t}</button>
  const revDet=()=>{ if(!rev) return null
    const caja=(t,body)=><div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden',marginTop:8}}><div style={{padding:isDesk?'11px 16px':'10px 10px',borderBottom:`1px solid ${C.border}`,...SEC_LBL,fontWeight:800}}>{t}</div>{body}</div>
    if(rev==='tram') return caja(isDesk?'Facturas de honorarios con señales de gasto y sin gasto ligado':'Gastos dentro de honorarios',revTram.length?grupoSocio(revTram,b=><Fragment key={b.id}>{filaRev(b,<span style={{display:'flex',gap:6}}>{btn(isDesk?'Es honorario':'Honorario',()=>esHonorario(b))}{btn(isDesk?'Ligar gasto':'Gasto',()=>setLigando(l=>l===b.id?null:b.id),true)}</span>,(()=>{ const e=(fondoCand[String(b.id)]||[])[0]; return e?`fondo sin depósito ${P$(e.amount)} del ${fmtFechaDMY(e.date)}`:null })())}
        {ligando===b.id&&(()=>{ const fs=fondoCand[String(b.id)]||[]; return <div style={{background:C.bgSoft,padding:isDesk?'6px 16px 10px':'6px 10px 10px'}}>{fs.length?fs.map(e=><div key={e.id} onClick={()=>ligar(b,e)} className='er-c' style={{display:'flex',justifyContent:'space-between',gap:8,padding:'6px 8px',borderRadius:8,cursor:'pointer',fontSize:12}}><span style={{color:C.muted,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{fmtFechaDMY(e.date)} · {e.concept||'Fondo'}</span><b style={{color:C.accent,fontVariantNumeric:'tabular-nums'}}>{P$(e.amount)}</b></div>):<div style={{fontSize:12,color:C.muted,padding:'4px 8px'}}>Este cliente no tiene fondos sin ligar. Regístralo en su ficha › Gastos.</div>}</div> })()}</Fragment>):<div style={{padding:14,fontSize:12,color:C.muted}}>Sin pendientes.</div>)
    if(rev==='cuo') return caja(isDesk?'Cuotas con fecha de emisión y sin factura':'Cuotas sin factura',revCuo.length?grupoSocio(revCuo,b=>filaRev(b,<span style={{color:C.textSoft}}><Gl n='chevron'/></span>)):<div style={{padding:14,fontSize:12,color:C.muted}}>Sin pendientes.</div>)
    if(rev==='bda') return caja(isDesk?'Comisiones que nos pagan: ¿de qué socio es el cliente?':'Comisiones por asignar',revBda.length?revBda.map(b=>filaRev(b,<span style={{display:'flex',gap:6}}>{ADMIN_NAMES.map(sn=>btn(sn,()=>asignar(b,sn)))}</span>)):<div style={{padding:14,fontSize:12,color:C.muted}}>Al día: todas tienen socio.</div>)
    return null }
  const sumB=a=>a.reduce((x,b)=>x+(montoFactura(b)||b.amount||0),0)
  const ParaRevisar=()=><><div style={{...SEC_LBL,fontWeight:800,margin:'16px 2px 8px'}}>Para revisar</div>
    <div style={{display:'grid',gridTemplateColumns:'1fr',gap:8}}>
      {revTile('tram','alert',C.ambarBg,C.soonText,`Gastos dentro de honorarios · ${revTram.length}`,revTram.length?fmtMillLR(sumB(revTram)):'Al día',revTram.length?C.soonText:C.greenText)}
      {revTile('cuo','file',C.azulBg,C.azulInfo,`Cuotas con fecha sin factura · ${revCuo.length}`,revCuo.length?fmtMillLR(sumB(revCuo)):'Al día',revCuo.length?C.azulInfo:C.greenText)}
      {revTile('bda','users',C.greenBg,C.greenText,revBda.length?`Comisiones por asignar · ${revBda.length}`:'Comisiones por asignar',revBda.length?fmtMillLR(sumB(revBda)):'Al día',revBda.length?C.soonText:C.greenText)}
    </div>{revDet()}</>

  // ── Comparativo («+ Agregar indicador»)
  const KV=useMemo(()=>{ const o={}; const z=()=>({[ADMIN_NAMES[0]]:0,[ADMIN_NAMES[1]]:0,[SIN_SOCIO]:0}); const add=(k,soc,v,it)=>{ (o[k]=o[k]||{v:z(),n:z(),it:[]}); o[k].v[soc]+=v; o[k].n[soc]++; if(it) o[k].it.push({...it,soc}) }
    ;(bill||[]).forEach(b=>{ if(!b||b.deleted_at||!b.invoice_no||!['Pendiente','Vencido'].includes(b.status)||['reembolso','nota_credito'].includes(b.billing_type)) return; const sv=saldoBill(b); if(!(sv>0)) return; const soc=socioDe(b,ctx), it={d:b.issued_at,cid:b.client_id,doc:`F${folioN(b.invoice_no)}`,det:b.concept||'',m:sv}
      add('pcob',soc,sv,it); if(b.status==='Vencido') add('venc',soc,sv,it) })
    ;(F.fuera||[]).forEach(x=>{ const b=billById[String(x.id)]; if(!b) return; const soc=socioDe(b,ctx); add(x.tipo==='duda'?'moro':'pfat',soc,x.m,{d:b.issued_at||b.due,cid:b.client_id,doc:b.invoice_no?`F${folioN(b.invoice_no)}`:'',det:b.concept||'',m:x.m}) })
    const porCli={}; (expenses||[]).forEach(e=>{ if(!e||e.deleted_at||!e.client_id) return; porCli[String(e.client_id)]=true })
    Object.keys(porCli).forEach(cid=>{ const c=cliById[cid]; if(!c||/^liberona escala/i.test(String(c.name||''))) return; const s0=fgCliente(expenses,c.id).saldo; const soc=socioNorm(c.abogado_responsable); const it={d:null,cid:c.id,doc:'',det:'saldo de gastos',m:s0}
      if(s0<-1) add('deuda',soc,-s0,{...it,m:-s0}); else if(s0>1) add('favor',soc,s0,it) })
    return o },[bill,F,billById,expenses,cliById,fu.ov,saleById])
  const kpiVal=(k,soc,p)=>{ const z=v=>v||0
    if(k==='vend') return vend(soc,p)
    if(k==='fac') return sumP('f',KF,soc,p)
    if(k==='ireal') return sumP('c',KI,soc,p)
    if(k==='compag') return -sumP('c','com',soc,p)
    if(k==='comfac') return -sumP('f','com',soc,p)
    if(k==='cext') return sumP('f','cext',soc,p)
    if(k==='perc') return sumP('c','perc',soc,p)
    if(k==='reemb') return -sumP('f','reemb',soc,p)
    if(['pcob','venc','moro','pfat','deuda','favor'].includes(k)){ const o=KV[k]; return o?(soc?z(o.v[soc]):Object.values(o.v).reduce((a,v)=>a+v,0)):0 }
    const its=V.filter(x=>(!soc||x.soc===soc)&&(p==='mes'?x.ym===ym:x.ym<=ym))
    if(k==='nven') return its.length
    if(k==='tick') return its.length?its.reduce((a,x)=>a+x.m,0)/its.length:null
    if(k==='cact') return new Set(its.map(x=>String(x.s.client_id))).size
    const ss=(sales||[]).filter(s=>s&&!s.deleted_at&&!esSubarriendo(s)&&(!soc||socioDeVenta(s,{cliById})===soc))
    if(k==='conv'){ const g=ss.filter(s=>s.activated_at).length, r=ss.filter(s=>s.status==='Rechazada').length; return (g+r)?g/(g+r)*100:null }
    if(k==='pipe') return ss.filter(s=>s.status==='Propuesta').length
    if(k==='mrr') return ss.filter(s=>esRecurrente(s)).reduce((a,s)=>a+ventaCLP(s,ufRef)/12,0)
    if(k==='comp') return (bill||[]).filter(b=>b&&!b.deleted_at&&b.status==='Programada'&&Number(String(b.due||'').slice(0,4))>y&&(!soc||socioDe(b,ctx)===soc)).reduce((a,b)=>a+(montoFactura(b)||b.amount||0),0)
    if(k==='dso'){ const ps2=(billing||[]).filter(b=>b&&!b.deleted_at&&b.status==='Pagado'&&b.paid_at&&b.issued_at&&b.invoice_no&&inPer(b.paid_at,p)&&!['reembolso','nota_credito'].includes(b.billing_type)&&(!soc||socioDe(b,ctx)===soc)).map(b=>(new Date(b.paid_at)-new Date(b.issued_at))/864e5).filter(d=>d>=0&&d<400); return ps2.length?Math.round(ps2.reduce((a,d)=>a+d,0)/ps2.length):null }
    return null }
  const fK=(v,f)=>v==null?'—':f==='$'?(Math.abs(v)<1?'—':FMT(v)):f==='%'?`${Math.round(v)}%`:f==='d'?`${v} d`:String(Math.round(v))
  const Comparativo=()=>{ const p=vista, cs=isDesk?[null,...COLS]:COLS, w=cs.length===3?['34%','22%','22%','22%']:['28%','18%','18%','18%','18%']
    const orden=kpis.slice().sort((a,b)=>PS_KPIS.findIndex(x=>x.k===a)-PS_KPIS.findIndex(x=>x.k===b)); let g=null
    return <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
      <div style={{display:'flex',alignItems:'center',gap:8,padding:isDesk?'11px 16px':'10px 10px',borderBottom:`1px solid ${C.border}`}}><span style={{...SEC_LBL,fontWeight:800,whiteSpace:'nowrap'}}>{isDesk?'Comparativo entre socios':'Comparativo'} · {perLbl(p)}</span><button onClick={()=>setPick(v=>!v)} style={{marginLeft:'auto',fontSize:11,fontWeight:700,border:`1px solid ${C.azulBd}`,background:C.azulBg,color:C.accent,borderRadius:14,padding:'4px 11px',cursor:'pointer',whiteSpace:'nowrap'}}>{isDesk?'+ Agregar indicador':'+ Agregar'}</button></div>
      {pick&&<div style={{display:'grid',gridTemplateColumns:isDesk?'repeat(3,minmax(0,1fr))':'1fr 1fr',gap:'6px 14px',padding:isDesk?'10px 16px':'10px',borderBottom:`1px solid ${C.border}`}}>
        {PS_KPIS.map((K,i)=>{ const nuevo=i===0||PS_KPIS[i-1].g!==K.g, on=kpis.includes(K.k); return <Fragment key={K.k}>{nuevo&&<div style={{gridColumn:'1/-1',...SEC_LBL,fontWeight:800,margin:'6px 0 2px'}}>{K.g}</div>}<button onClick={()=>setKpis(on?kpis.filter(x=>x!==K.k):[...kpis,K.k])} style={{textAlign:'left',fontSize:12,fontWeight:600,color:C.accent,background:on?C.azulBg:C.bgSoft,border:0,borderRadius:8,padding:'6px 10px',cursor:'pointer',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{on?'✓ ':'+ '}{K.l}</button></Fragment> })}</div>}
      <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed'}}><colgroup>{w.map((x,i)=><col key={i} style={{width:x}}/>)}</colgroup>
        <thead><tr><th style={{...th,textAlign:'left',paddingLeft:isDesk?16:8}}>Indicador</th>{cs.map((c,j)=><th key={j} style={{...th,color:tinta[c||'Oficina'],paddingRight:j===cs.length-1?(isDesk?16:8):undefined}}>{c?(isDesk?L(c):Ls(c)):'Oficina'}</th>)}</tr></thead>
        <tbody>{orden.map(k=>{ const K=PS_KPIS.find(x=>x.k===k); if(!K) return null; const cap=K.g!==g; g=K.g; const ko=kopen&&kopen.k===k
          const vals=cs.map(soc=>kpiVal(k,soc,p))
          const its=KV[k]?.it||null
          return <Fragment key={k}>
            {cap&&<tr><td colSpan={cs.length+1} style={{padding:isDesk?'12px 16px 5px':'11px 8px 5px',...SEC_LBL,fontWeight:800,borderTop:`1px solid ${C.border}`}}>{K.g}{K.per==='flujo'?` · ${perLbl(p)}`:''}</td></tr>}
            <tr><td style={{...td,textAlign:'left',paddingLeft:K.sub?(isDesk?30:18):(isDesk?16:8),color:C.muted,fontWeight:K.sub?500:600}}>{isDesk?K.l:K.ls}<span onClick={()=>setKpis(kpis.filter(x=>x!==k))} style={{color:C.done,cursor:'pointer',marginLeft:6,fontWeight:700}}>×</span></td>
              {vals.map((v,j)=>{ const soc=cs[j], clic=v!=null&&(its||['fac','ireal','compag','comfac','cext','perc','reemb'].includes(k)); const sel=ko&&kopen.soc===soc
                return <td key={j} onClick={clic?()=>{ if(its){ setVerTodo(false); setKopen(o=>(o&&o.k===k&&o.soc===soc)?null:{k,soc}) } else { setDat(d=>({...d,sec:['fac','comfac','cext','reemb'].includes(k)?'f':'c',con:{compag:'com',comfac:'com',cext:'cext',perc:'perc',reemb:'reemb'}[k]||'pre',soc,lim:40})); setTab('dat') } }:undefined} style={{...td,fontWeight:soc===null?800:700,color:soc===null?C.accent:C.text,cursor:clic?'pointer':'default',background:sel?C.azulBg:undefined,paddingRight:j===vals.length-1?(isDesk?16:8):undefined}}>{fK(v,K.f)}{isDesk&&its&&soc&&KV[k]?.n[soc]?<span style={{fontSize:10,color:C.textSoft,fontWeight:600,marginLeft:4}}>{KV[k].n[soc]}</span>:null}</td> })}</tr>
            {ko&&its&&<tr><td colSpan={cs.length+1} style={{padding:0}}>{lista(its.filter(x=>!kopen.soc||x.soc===kopen.soc).sort((a,b)=>b.m-a.m),`${kopen.soc?L(kopen.soc):'Oficina'} · ${K.l}`)}</td></tr>}
          </Fragment> })}</tbody></table></div> }

  // ── Datos crudos (partidas reales, monto en la columna de su socio)
  const CON={f:{emit:'Facturas emitidas',cext:'Comisión de externos',reemb:'Reembolsos de gastos',nc:'Notas de crédito',com:'Comisiones de lo facturado',sub:'Subarriendo · aparte'},c:{fac:'Cobrado de facturas',ant:'Anticipos',reemb:'Reembolsos de gastos',com:'Comisiones pagadas',perc:'Comisiones percibidas',sub:'Subarriendo · aparte'}}
  const SECL={f:'Facturado',c:'Cobrado'}
  const Datos=()=>{ const p=vista, base=P.filter(r=>r.s===dat.sec&&inPer(r.d,p)&&(!dat.soc||r.soc===dat.soc)), presentes=[...new Set(base.map(r=>r.k))], q=_normTxt(dat.q||'')
    const grupo=dat.con==='pre'?(dat.sec==='f'?KF:KI):dat.con==='cp'?KC:[dat.con]
    let L=base.filter(r=>grupo.includes(r.k)&&(!q||_normTxt(nm(r.cid)).includes(q)||String(r.doc||'').toLowerCase().includes(q)))
    L.sort((a,b)=>dat.ord==='m'?Math.abs(b.m)-Math.abs(a.m):String(b.d).localeCompare(String(a.d)))
    const T={}; COLS.forEach(c=>T[c]=0); L.forEach(r=>T[r.soc]+=r.m)
    const chip=(on,t,f)=><button key={t} onClick={f} style={{fontSize:11,fontWeight:700,borderRadius:20,padding:'4px 10px',border:0,cursor:'pointer',background:on?C.accent:C.bgSoft,color:on?'#fff':C.muted,whiteSpace:'nowrap'}}>{t}</button>
    const tdD={padding:isDesk?'7px 10px':'7px 6px',borderTop:`1px solid ${C.border}`,fontSize:isDesk?12:11,whiteSpace:'nowrap',textAlign:'right',fontVariantNumeric:'tabular-nums',overflow:'hidden',textOverflow:'ellipsis'}
    return <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
      <div style={{display:'flex',alignItems:'center',gap:8,padding:isDesk?'11px 16px':'10px',borderBottom:`1px solid ${C.border}`}}><span style={{...SEC_LBL,fontWeight:800}}>{SECL[dat.sec]} · partidas · {perLbl(p)}</span></div>
      <div style={{display:'flex',gap:12,flexWrap:'wrap',padding:isDesk?'8px 16px':'8px 10px',borderBottom:`1px solid ${C.border}`,fontSize:11.5,fontWeight:700}}>{COLS.map(c=><span key={c} style={{color:tinta[c],fontVariantNumeric:'tabular-nums'}}>{L(c)} {P$(T[c])}</span>)}<span style={{color:C.accent,fontVariantNumeric:'tabular-nums'}}>· Oficina {P$(COLS.reduce((a,c)=>a+T[c],0))}</span></div>
      <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center',padding:isDesk?'10px 16px':'8px 10px',borderBottom:`1px solid ${C.border}`}}>
        {chip(dat.sec==='f','Facturado',()=>setDat(d=>({...d,sec:'f',con:'pre',lim:40})))}{chip(dat.sec==='c','Cobrado',()=>setDat(d=>({...d,sec:'c',con:'pre',lim:40})))}
        <span style={{width:6}}/>{[[null,'Todos'],...COLS.map(c=>[c,L(c)])].map(([k,l])=>chip(dat.soc===k,l,()=>setDat(d=>({...d,soc:k,lim:40}))))}
        <input value={dat.q} onChange={e=>setDat(d=>({...d,q:e.target.value,lim:40}))} placeholder='Buscar cliente o folio' style={{flex:1,minWidth:isDesk?160:'100%',maxWidth:isDesk?260:'none',marginLeft:isDesk?'auto':0,fontSize:12,border:`1px solid ${C.border}`,borderRadius:8,padding:'6px 10px',color:C.text}}/></div>
      <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center',padding:isDesk?'10px 16px':'8px 10px',borderBottom:`1px solid ${C.border}`}}>
        {chip(dat.con==='pre',dat.sec==='f'?'Facturado':'Ingreso real',()=>setDat(d=>({...d,con:'pre',lim:40})))}{dat.sec==='c'&&chip(dat.con==='cp','Cobrado propio',()=>setDat(d=>({...d,con:'cp',lim:40})))}
        {Object.entries(CON[dat.sec]).filter(([k])=>presentes.includes(k)).map(([k,l])=>chip(dat.con===k,l,()=>setDat(d=>({...d,con:k,lim:40}))))}
        <span style={{marginLeft:'auto',display:'inline-flex',gap:4}}>{chip(dat.ord==='f','Fecha',()=>setDat(d=>({...d,ord:'f'})))}{chip(dat.ord==='m','Monto',()=>setDat(d=>({...d,ord:'m'})))}</span></div>
      <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed'}}>
        <colgroup>{(isDesk?['10%','22%','8%','21%','13%','13%','13%']:['66%','34%']).map((w,i)=><col key={i} style={{width:w}}/>)}</colgroup>
        <thead><tr>{(isDesk?['Fecha','Cliente','Folio','Concepto']:['Cliente']).map((h,i)=><th key={h} style={{...th,textAlign:'left',paddingLeft:i===0?(isDesk?16:10):undefined}}>{h}</th>)}{(isDesk?COLS:['Monto']).map((c,j,arr)=><th key={c} style={{...th,color:tinta[c]||C.accent,paddingRight:j===arr.length-1?(isDesk?16:10):undefined}}>{COLS.includes(c)?L(c):c}</th>)}</tr></thead>
        <tbody>{L.slice(0,dat.lim).map((r,i)=><tr key={i} onClick={()=>irA(r)} className='er-c' style={{cursor:'pointer'}}>
          {isDesk?<><td style={{...tdD,textAlign:'left',paddingLeft:16,color:C.muted}}>{fmtFechaDMY(r.d)}</td>
          <td style={{...tdD,textAlign:'left',color:C.accent,fontWeight:700}} title={nm(r.cid)}>{nm(r.cid)}</td></>
          :<td style={{...tdD,textAlign:'left',paddingLeft:10,whiteSpace:'normal'}}><div style={{color:C.accent,fontWeight:700,fontSize:11.5,lineHeight:1.25,overflowWrap:'anywhere'}}>{nm(r.cid)}</div><div style={{color:C.textSoft,fontSize:10.5,fontWeight:600,whiteSpace:'nowrap'}}>{fmtFechaDMY(r.d)}{r.doc?` · ${r.doc}`:''}</div></td>}
          {isDesk&&<td style={{...tdD,textAlign:'left',color:C.muted}}>{r.doc||'—'}</td>}
          {isDesk&&<td style={{...tdD,textAlign:'left',color:C.textSoft}} title={r.det}>{CON[r.s][r.k]}</td>}
          {isDesk?COLS.map((c,j)=><td key={c} style={{...tdD,color:c===r.soc?(r.m<0?C.overdueText:C.text):C.done,paddingRight:j===COLS.length-1?16:undefined}}>{c===r.soc?P$(r.m):'·'}</td>)
            :<td style={{...tdD,paddingRight:10,verticalAlign:'top',color:r.m<0?C.overdueText:C.text}}><span style={{display:'inline-block',width:7,height:7,borderRadius:'50%',background:tinta[r.soc],marginRight:5}}/>{P$(r.m)}</td>}
        </tr>)}
          <tr><td colSpan={isDesk?4:1} style={{...tdD,textAlign:'left',paddingLeft:isDesk?16:10,fontWeight:800,color:C.accent,borderTop:`1.5px solid ${C.accent}`,background:'#EDF1F4'}}>Total · {L.length} partidas</td>
            {isDesk?COLS.map((c,j)=><td key={c} style={{...tdD,fontWeight:800,color:C.accent,borderTop:`1.5px solid ${C.accent}`,background:'#EDF1F4',paddingRight:j===COLS.length-1?16:undefined}}>{P$(T[c])}</td>)
              :<td style={{...tdD,fontWeight:800,color:C.accent,borderTop:`1.5px solid ${C.accent}`,background:'#EDF1F4',paddingRight:10}}>{P$(COLS.reduce((a,c)=>a+T[c],0))}</td>}</tr></tbody></table>
      {L.length>dat.lim&&<div onClick={()=>setDat(d=>({...d,lim:d.lim+40}))} style={{textAlign:'center',padding:10,fontSize:12,fontWeight:700,color:C.azulInfo,borderTop:`1px solid ${C.border}`,cursor:'pointer'}}>Ver {Math.min(40,L.length-dat.lim)} más de {L.length}</div>}
    </div> }

  const exportar=()=>{ try{
    const rows=[['Fecha','Socio','Sección','Concepto','Cliente','Folio','Detalle','Monto']]
    P.filter(r=>inPer(r.d,'ytd')).sort((a,b)=>String(a.d).localeCompare(String(b.d))).forEach(r=>rows.push([fmtFechaDMY(r.d),L(r.soc),SECL[r.s],CON[r.s][r.k],nm(r.cid),r.doc,r.det,Math.round(r.m)]))
    const csv=rows.map(r=>r.map(c=>{const s=String(c==null?'':c);return /[",\n;]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}).join(';')).join('\n')
    const blob=new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`por_socio_${ym}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),1000)
  }catch(e){ appAlert('No se pudo exportar: '+(e.message||e)) } }

  const seg=(opts,val,set)=><span style={{display:'inline-flex',background:C.card,border:`1px solid ${C.border}`,borderRadius:16,padding:2,flex:isDesk?'none':(opts.length>2?'1 1 100%':'none')}}>{opts.map(([k,l])=><button key={k} onClick={()=>set(k)} style={{flex:isDesk?'none':1,fontSize:12,fontWeight:700,border:0,borderRadius:14,padding:'5px 13px',cursor:'pointer',background:val===k?C.accent:'transparent',color:val===k?'#fff':C.muted}}>{l}</button>)}</span>
  const nb=(dis,on,ch)=><button disabled={dis} onClick={on} style={{width:30,height:30,borderRadius:9,border:`1px solid ${C.border}`,background:C.card,color:C.accent,cursor:dis?'default':'pointer',opacity:dis?.35:1}}><Gl n={ch}/></button>
  if(!fu.ok) return <div style={{padding:24,fontSize:13,color:C.muted}}>Cargando…</div>
  return (<div>
    <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',margin:'0 0 14px'}}>
      {seg([['res','Resumen'],['cmp','Comparativo'],['dat','Datos']],tab,setTab)}
      {seg([['mes','Mes'],['ytd','Año']],vista,v=>{ setVista(v); setOpen(null); setKopen(null) })}
      <span style={{display:'inline-flex',alignItems:'center',gap:6,marginLeft:isDesk?'auto':0}}>{nb(false,()=>shift(-1),'chevL')}<span style={{minWidth:isDesk?124:96,textAlign:'center',fontSize:13.5,fontWeight:700,color:C.text}}>{perLbl(vista)}</span>{nb(ym===curYM,()=>shift(1),'chevron')}</span>
      <button onClick={exportar} style={{fontSize:11,fontWeight:600,color:C.accent,background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:'5px 10px',cursor:'pointer',whiteSpace:'nowrap',marginLeft:isDesk?0:'auto'}}>{isDesk?'Exportar ↓':'↓'}</button>
    </div>
    <div style={{display:'grid',gridTemplateColumns:isDesk?'repeat(3,minmax(0,1fr))':'1fr',gap:isDesk?12:8}}>
      {isDesk?cardOficinaAncha():cardSocio(null,C.greenText)}
      {COLS.map(c=>cardSocio(c,tinta[c]))}
    </div>
    {tab==='res'&&<div style={{display:'grid',gridTemplateColumns:isDesk?'repeat(2,minmax(0,1fr))':'1fr',gap:isDesk?12:8,marginTop:16,alignItems:'start'}}>
      <div style={{minWidth:0}}>
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
          <div style={{display:'flex',alignItems:'center',gap:8,padding:isDesk?'11px 16px':'10px',borderBottom:`1px solid ${C.border}`}}><span style={{...SEC_LBL,fontWeight:800,whiteSpace:'nowrap'}}>Composición · {perLbl(vista)}</span><button onClick={()=>setPs(!ps)} style={{marginLeft:'auto',fontSize:11,fontWeight:700,border:`1px solid ${ps?C.azulBd:C.border}`,background:ps?C.azulBg:C.card,color:C.accent,borderRadius:14,padding:'4px 11px',cursor:'pointer',whiteSpace:'nowrap'}}>{ps?'Cerrar por socio':'Abrir por socio'}</button></div>
          {Comp()}
        </div>
        {ParaRevisar()}
      </div>
      <div style={{minWidth:0}}>
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
          <div style={{display:'flex',alignItems:'center',gap:8,padding:isDesk?'11px 16px':'10px',borderBottom:`1px solid ${C.border}`}}><span style={{...SEC_LBL,fontWeight:800,whiteSpace:'nowrap'}}>Mes a mes {y}</span><span style={{marginLeft:'auto',display:'inline-flex',background:C.bgSoft,borderRadius:12,padding:2}}>{[['c','Ingreso real'],['f','Facturado']].map(([k,l])=><button key={k} onClick={()=>setMm(k)} style={{fontSize:10.5,fontWeight:700,border:0,borderRadius:10,padding:'3px 9px',cursor:'pointer',background:mm===k?C.card:'transparent',color:mm===k?C.accent:C.muted,boxShadow:mm===k?`0 0 0 1px ${C.border}`:'none',whiteSpace:'nowrap'}}>{l}</button>)}</span></div>
          {MesAMes()}
        </div>
      </div>
    </div>}
    {tab==='cmp'&&<div style={{marginTop:16}}>{Comparativo()}</div>}
    {tab==='dat'&&<div style={{marginTop:16}}>{Datos()}</div>}
  </div>)
}

