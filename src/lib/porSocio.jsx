// Movido de compartido.jsx por scripts/dividir-compartido.py. Sin cambios de comportamiento.
import { useState, useMemo, useEffect } from 'react'
import { supabase, DEMO } from '../supabase'
import { resumenDiasCobro } from '../../supabase/functions/_shared/diasCobro.js'
import { useAnnualTargets } from './resultadoAnio.js'
import { conversionPropuestas } from '../../supabase/functions/_shared/ventasConversion.js'
import { C, Gl, SEC_LBL, SIcon, _normTxt, appAlert, diaGrande, fmt, fmtFechaDMY, folioN, useIsDesktop } from './base.jsx'
import { Fragment } from 'react'
import { esSubarriendo, redondearPartes, kpisPorSocio, partesM, partesPctEnt } from './cifras.js'
import { usePropuestasNoCuentan, ADMIN_NAMES, ChevAb, MES_C, MES_L, PS_RX_GASTO, SIN_SOCIO, UF_FALLBACK, _lsGet, _lsSet, esVencidaB, fmtMillLR, logActividad, mesTitulo, montoFactura, partidasPorSocio, saldoBill, setLearningKV, socioDe, socioDeVenta, usePorSocioFuentes, useUF, vendidoPorSocio } from './compartido.jsx'

// Última posición de la vista (pestaña, período y fila abierta): al volver desde una ficha se regresa al mismo lugar.
let _psMem=null

// Vista Por socio (Facturación › Por socio e Inteligencia › Socios): Resumen · Comparativo · Datos. Render aprobado 19-10-2026 (ABU5j4gotedSVCZJkE9kG2).
export function PorSocioVista({billing=[],sales=[],clients=[],anticipos=[],terceros=[],expenses=[],fantasmaIds=null,tabIni='res',datIni=null,onOpenClientFicha,onIrBanco,onIrBilling,onIrCobranza,onIrProveedores,onIrSubarriendo}){
  const isDesk=useIsDesktop()
  const [fu,setFu]=usePorSocioFuentes()
  const noCuentan=usePropuestasNoCuentan()   // propuestas marcadas «duplicada: no cuenta»: misma cifra de conversión que el Presupuesto
  const ufState=useUF(); const ufRef=ufState.uf||UF_FALLBACK
  const bill=useMemo(()=>(fantasmaIds&&fantasmaIds.size)?(billing||[]).filter(b=>!fantasmaIds.has(String(b.id))):billing,[billing,fantasmaIds])
  const COLS=ADMIN_NAMES.concat([SIN_SOCIO])
  const tinta={[ADMIN_NAMES[0]]:C.accent,[ADMIN_NAMES[1]]:C.tealText,[SIN_SOCIO]:C.soonText,Oficina:C.greenText}
  const _now=new Date(); const curYM=`${_now.getFullYear()}-${String(_now.getMonth()+1).padStart(2,'0')}`
  const [tab,setTab]=useState(()=>datIni?(datIni.i===0?'cmp':'dat'):(_psMem?.tab||tabIni))   // datIni {soc,i,p}: llegar a la celda de una columna y un socio (Panel de socios)
  const [ym,setYm]=useState(()=>(!datIni&&_psMem?.ym)||curYM)
  const [vista,setVista]=useState(datIni?.p||_psMem?.vista||'ytd')
  const [ps,setPs0]=useState(()=>_lsGet('porsocio_ps',false)); const setPs=v=>{ setPs0(v); _lsSet('porsocio_ps',v) }
  const [sec,setSec]=useState({f:false,c:false})
  const [open,setOpen]=useState(null)
  const [verTodo,setVerTodo]=useState(false)
  const [mm,setMm]=useState('c')
  const [rev,setRev]=useState(null)
  const [kopen,setKopen]=useState(()=>(!datIni&&_psMem?.kopen)||null)
  useEffect(()=>{ _psMem={tab,vista,ym,kopen} },[tab,vista,ym,kopen])
  const [dat,setDat]=useState(()=>datIni&&datIni.i>0?{sec:datIni.i===1?'f':'c',con:[null,'pre','cp','com','perc','pre','sub'][datIni.i],soc:datIni.soc??null,q:'',ord:'f',lim:40}:{sec:'f',con:'pre',soc:null,q:'',ord:'f',lim:40})
  const [fondoExtra,setFondoExtra]=useState({})
  const [ligando,setLigando]=useState(null)
  const shift=n=>{ const [yy,mo]=ym.split('-').map(Number); const d=new Date(yy,mo-1+n,1); const nym=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; if(nym<=curYM){ setYm(nym); setOpen(null); setKopen(null) } }
  const y=Number(ym.slice(0,4)), mo=Number(ym.slice(5,7))
  const MN=MES_L, mesLbl=`${MN[mo-1].charAt(0).toUpperCase()+MN[mo-1].slice(1)}`
  const perLbl=p=>p==='mes'?`${mesLbl} ${y}`:(mo===1?`enero ${y}`:`ene–${MES_C[mo-1]} ${y}`)
  const saleById=useMemo(()=>{const m={};(sales||[]).forEach(s=>{ if(s) m[String(s.id)]=s });return m},[sales])
  const cliById=useMemo(()=>{const m={};(clients||[]).forEach(c=>{ if(c) m[String(c.id)]=c });return m},[clients])
  const billById=useMemo(()=>{const m={};(billing||[]).forEach(b=>{ if(b) m[String(b.id)]=b });return m},[billing])
  const ctx={saleById,cliById,ov:fu.ov}
  const P=useMemo(()=>partidasPorSocio({billing,sales,clients,anticipos,terceros,expenses,ic:fu.ic,ia:fu.ia,ov:fu.ov,fondoExtra}),[billing,sales,clients,anticipos,terceros,expenses,fu,fondoExtra])
  const V=useMemo(()=>vendidoPorSocio(sales,clients,ufRef,y,null,{terceros,billing}),[sales,clients,ufRef,y,terceros,billing])
  const {inPer,sumP,vend,KF,KC,KI,card6,emitido}=kpisPorSocio({P,V,ym})   // fuente única (compartido.jsx): la misma que usa el Panel de socios
  // «Sin socio» dice de quién es: los abogados no socios dueños de sus partidas del año (venta.responsible → abogado del cliente).
  const sinAbos=useMemo(()=>{ const set=new Set(); P.forEach(r=>{ if(r.soc!==SIN_SOCIO||r.k==='sub'||!String(r.d).startsWith(String(y))) return; const b=r.bid&&billById[String(r.bid)], sv=b&&b.sale_id&&saleById[String(b.sale_id)], a=(sv&&sv.responsible)||cliById[String(r.cid)]?.abogado_responsable; if(a&&!ADMIN_NAMES.includes(a)) set.add(a) }); return [...set].sort() },[P,y,billById,saleById,cliById])
  const Ls=c=>c!==SIN_SOCIO?c:sinAbos.length===1?sinAbos[0]:sinAbos.length?'Otros':SIN_SOCIO   // encabezados angostos
  const L=c=>c!==SIN_SOCIO?c:!sinAbos.length?SIN_SOCIO:sinAbos.length===1?`${SIN_SOCIO} · ${sinAbos[0]}`:'Otros abogados'
  const metas=useAnnualTargets()
  // [Vendido, Facturado, Cobrado propio, Comisiones pagadas, Comisiones percibidas, Ingreso real, Subarriendo (aparte)]
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
        <div style={{flex:1,minWidth:0}}><div style={{fontSize:12.5,fontWeight:700,color:C.accent,lineHeight:1.25,overflowWrap:'anywhere'}}>{nm(x.cid)}</div><div style={{fontSize:10.5,color:C.textSoft,fontWeight:600,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden',lineHeight:1.25}}>{[x.doc,isDesk?x.det:(x.doc?null:x.det)].filter(Boolean).join(' · ')}</div></div>
        <span style={{fontSize:12.5,fontWeight:800,color:x.m<0?C.overdueText:C.accent,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{P$(x.m)}</span><span style={{color:C.textSoft}}><Gl n='chevron'/></span></div>)}
      {items.length>8&&<div onClick={()=>setVerTodo(v=>!v)} style={{textAlign:'center',padding:8,fontSize:11.5,fontWeight:700,color:C.azulInfo,borderTop:`1px solid ${C.border}`,cursor:'pointer'}}>{verTodo?'Ver menos':`Ver las ${items.length}`}</div>}
    </div> }

  // ── Tarjetas: Oficina arriba, socios abajo · Octubre y Acumulado · pesos exactos (cuadran en toda dirección)
  const pcY=(()=>{ const v=COLS.map(s=>card6(s,'ytd')[5]), t=v.reduce((a,x)=>a+x,0); return t>0?redondearPartes(v.map(x=>x/t*100),1):v.map(()=>0) })()
  const filasCard=[['ref','Vendido neto',0],['ref','Facturado',1],['sep','Cobrado propio',2],['','− Com. pagadas',3],['','+ Com. percibidas',4],['res','= Ingreso real',5]]
  const tdC=(v,i,soc,p,col,big)=>{ const on=Math.abs(v)>=1; return <td onClick={on?()=>irDatos(soc,i,p):undefined} className={on?'er-c':undefined} style={{textAlign:'right',padding:'4px 0 4px 8px',fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap',cursor:on?'pointer':'default',fontSize:big?(isDesk?19:13.5):i===5?13.5:12,fontWeight:i===5?800:600,color:i===6?C.done:i===5?col:i<2?C.textSoft:C.text,borderTop:i===5?`1.5px solid ${col}`:i===2?`1px solid ${C.border}`:i===6?`1px dashed ${C.border}`:'none'}}>{on?P$(v):'—'}</td> }
  const cardSocio=(soc,col)=>{ const m=card6(soc,'mes'), a=card6(soc,'ytd'), pc=soc?pcY[COLS.indexOf(soc)]:0, filas=soc?filasCard:[...filasCard,['apt','Subarriendo',6]]
    return <div key={soc||'of'} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:isDesk?'12px 16px 10px':'11px 12px 8px',minWidth:0}}>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}><span style={{width:9,height:9,borderRadius:'50%',background:col,flexShrink:0}}/><span onClick={()=>{ setTab('res'); setPs(true); setSec({f:true,c:true}) }} style={{fontSize:11,fontWeight:800,letterSpacing:.5,textTransform:'uppercase',color:col,cursor:'pointer'}}>{soc?L(soc):'Oficina'} <Gl n='chevron'/></span><span style={{marginLeft:'auto',fontSize:11,fontWeight:700,color:C.muted,whiteSpace:'nowrap'}}>{soc?`${pc} % del ingreso real${isDesk?' del año':''}`:'ingreso real del año'}</span></div>
      <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed'}}><colgroup><col style={{width:'40%'}}/><col style={{width:'28%'}}/><col style={{width:'32%'}}/></colgroup>
        <thead><tr><th/>{[mesLbl,'Acumulado'].map(h=><th key={h} style={{fontSize:10,fontWeight:800,letterSpacing:.4,textTransform:'uppercase',textAlign:'right',padding:'4px 0 4px 8px',color:C.muted,whiteSpace:'nowrap'}}>{h}</th>)}</tr></thead>
        <tbody>{filas.map(([cl,l,i])=><tr key={i}><td style={{fontSize:i===5?12.5:12,fontWeight:i===5?800:600,color:i===6?C.done:i===5?col:i<2?C.textSoft:C.muted,padding:'4px 0',borderTop:i===5?`1.5px solid ${col}`:i===2?`1px solid ${C.border}`:i===6?`1px dashed ${C.border}`:'none',whiteSpace:'nowrap'}}>{l}</td>{tdC(m[i],i,soc,'mes',col,!soc&&i===5)}{tdC(a[i],i,soc,'ytd',col,!soc&&i===5)}</tr>)}</tbody></table></div> }
  const cardOficinaAncha=()=>{ const m=card6(null,'mes'), a=card6(null,'ytd'), col=C.greenText, socsPc=COLS.map((s,i)=>`${L(s)} ${pcY[i]} %`).join(' · ')
    const hdr=['Vendido neto','Facturado','Cobrado propio','− Com. pagadas','+ Com. percibidas','= Ingreso real','Subarriendo · aparte']
    return <div style={{gridColumn:'1/-1',background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:'12px 16px 10px'}}>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}><span style={{width:9,height:9,borderRadius:'50%',background:col}}/><span onClick={()=>{ setTab('res'); setPs(true); setSec({f:true,c:true}) }} style={{fontSize:11,fontWeight:800,letterSpacing:.5,textTransform:'uppercase',color:col,cursor:'pointer'}}>Oficina <Gl n='chevron'/></span><span style={{marginLeft:'auto',fontSize:11,fontWeight:700,color:C.muted}}>{socsPc} del ingreso real del año</span></div>
      <table style={{width:'100%',borderCollapse:'collapse'}}>
        <thead><tr><th/>{hdr.map((h,i)=><th key={h} style={{fontSize:10,fontWeight:800,letterSpacing:.4,textTransform:'uppercase',textAlign:'right',padding:'6px 0 6px 8px',color:i===6?C.done:C.muted,lineHeight:1.2,verticalAlign:'bottom'}}>{h}</th>)}</tr></thead>
        <tbody>{[[mesLbl,m,'mes'],[`Acumulado ${y}`,a,'ytd']].map(([l,v,p],r)=><tr key={p}><td style={{fontSize:13,fontWeight:600,color:C.muted,padding:'6px 0',borderTop:r?`1px solid ${C.border}`:'none',whiteSpace:'nowrap'}}>{l}</td>{v.map((x,i)=>{ const on=Math.abs(x)>=1; return <td key={i} onClick={on?()=>irDatos(null,i,p):undefined} className={on?'er-c':undefined} style={{textAlign:'right',padding:'6px 0 6px 8px',fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap',cursor:on?'pointer':'default',fontSize:i===5?19:13,fontWeight:i===5?800:600,color:i===6?C.done:i===5?col:i<2?C.textSoft:C.text,borderTop:r?`1px solid ${C.border}`:'none'}}>{on?P$(x):'—'}</td> })}</tr>)}</tbody></table></div> }

  // ── Resumen (alternativa A): 4 tarjetas con el ingreso real en $M (cuadran con redondearPartes) y UNA tabla comparativa, Oficina primera.
  const kv=vista, ir6=COLS.map(c=>card6(c,kv)[5]), irM=partesM(ir6), irPct=partesPctEnt(ir6), irOf=irM.reduce((a,x)=>a+x,0)
  const iniC={[ADMIN_NAMES[0]]:'C',[ADMIN_NAMES[1]]:'E',[SIN_SOCIO]:'S'}, bgC={[ADMIN_NAMES[0]]:C.azulBg,[ADMIN_NAMES[1]]:C.tealBg,[SIN_SOCIO]:C.ambarBg}
  const kpiTiles=()=>{ const t=(key,ini,bg,col,lab,val,sub,go)=><div key={key} {...(go?{role:'button',tabIndex:0,onClick:go,onKeyDown:e=>{ if(e.key==='Enter') go() }}:{})} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:isDesk?'10px 14px':'8px 10px',display:'grid',gridTemplateColumns:`${isDesk?36:28}px minmax(0,1fr)`,columnGap:isDesk?12:8,alignItems:'center',minWidth:0,cursor:'pointer',boxSizing:'border-box'}}>
      <span style={{gridRow:'1 / span 3',width:isDesk?36:28,height:isDesk?36:28,borderRadius:'50%',background:bg,color:col,display:'grid',placeItems:'center'}}><span style={{width:isDesk?12:10,height:isDesk?12:10,borderRadius:'50%',background:col}}/></span>
      <div style={{fontSize:isDesk?11:10,fontWeight:700,letterSpacing:.5,textTransform:'uppercase',color:col,whiteSpace:'nowrap'}}>{lab}</div>
      <div style={{fontSize:isDesk?21:17,fontWeight:800,letterSpacing:-.6,color:col===C.done?C.done:C.accent,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap',lineHeight:1.15}}>{fmtMillLR(val)}</div>
      <div style={{fontSize:11,color:C.muted,whiteSpace:'nowrap'}}>{sub}</div></div>
    return <div style={{display:'grid',gridTemplateColumns:isDesk?'repeat(4,minmax(0,1fr))':'repeat(2,minmax(0,1fr))',gap:isDesk?12:8}}>
      {t('of','▦',C.greenBg,C.greenText,'Oficina',irOf,'Socios + Sin socio',()=>irDatos(null,5,kv))}
      {COLS.map((c,i)=>t(c,iniC[c],bgC[c],tinta[c],L(c),irM[i],`${irPct[i]} % del total`,()=>irDatos(c,5,kv)))}
    </div> }
  const tablaResumen=()=>{ const cs=[null,...COLS], A=cs.map(c=>card6(c,kv)), lab=['Vendido neto','Facturado','Cobrado propio','− Com. pagadas','+ Com. percibidas','= Ingreso real',isDesk?'Subarriendo · aparte':'Subarriendo']
    const th2=(c,j)=><th key={j} style={{...th,color:tinta[c||'Oficina'],background:c===null?C.greenSoft:C.bgSoft,paddingRight:j===cs.length-1?(isDesk?16:8):undefined}}>{c===null?'Oficina':Ls(c)}</th>
    return <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
      <div style={{display:'flex',alignItems:'center',gap:8,padding:isDesk?'11px 16px':'10px',borderBottom:`1px solid ${C.border}`}}><span style={{...SEC_LBL,fontWeight:800,whiteSpace:'nowrap'}}>Comparativo · {perLbl(kv)}</span></div>
      <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed'}}><colgroup>{(isDesk?['28%','18%','18%','18%','18%']:['28%','18%','18%','18%','18%']).map((w,i)=><col key={i} style={{width:w}}/>)}</colgroup>
        <thead><tr><th style={{...th,textAlign:'left',paddingLeft:isDesk?16:8}}/>{cs.map(th2)}</tr></thead>
        <tbody>{lab.map((l,i)=>{ const fin=i===5, ap=i===6
          return <tr key={i}><td style={{...td,textAlign:'left',paddingLeft:isDesk?16:8,fontWeight:fin?800:600,...(fin?{fontSize:isDesk?14:12.5}:{}),color:ap?C.done:fin?C.accent:C.muted,borderTop:fin?`1.5px solid ${C.accent}`:ap?`1px dashed ${C.border}`:`1px solid ${C.border}`}}>{l}</td>
            {ap?<><td style={{...td,color:C.done,background:C.greenSoft,borderTop:`1px dashed ${C.border}`}}>{Math.abs(A[0][6])>=1?FMT(A[0][6]):'—'}</td><td colSpan={3} style={{...td,textAlign:'left',color:C.done,fontSize:11,borderTop:`1px dashed ${C.border}`,whiteSpace:'normal'}}>No es de ningún socio · no suma al ingreso real</td></>
            :cs.map((c,j)=>{ const v=A[j][i], on=Math.abs(v)>=1; return <td key={j} onClick={on?()=>irDatos(c,i,kv):undefined} className={on?'er-c':undefined} style={{...td,cursor:on?'pointer':'default',fontWeight:fin||c===null?800:600,...(fin?{fontSize:isDesk?15:13}:{}),color:!on?C.done:fin?(c===null?C.greenText:tinta[c]):c===null?C.accent:C.text,background:c===null?C.greenSoft:undefined,borderTop:fin?`1.5px solid ${C.accent}`:`1px solid ${C.border}`,paddingRight:j===cs.length-1?(isDesk?16:8):undefined}}>{on?FMT(v):'—'}</td> })}
          </tr> })}</tbody></table></div> }

  // ── Composición (plegada) y mes a mes: escritorio en pesos; celular en $M con cada columna cuadrada (redondearPartes)
  // Fila sin clave = subtotal (suma de las filas anteriores); el subarriendo va aparte, debajo, sin sumar.
  const FF=[['emit','','Facturas emitidas','Emitidas'],['cext','+','Comisión de externos','Com. externos'],['reemb','−','Reembolsos de gastos','Reembolsos'],['nc','−','Notas de crédito','NC']]
  const FC=[['fac','','Cobrado de facturas','De facturas'],['ant','+','Anticipos','Anticipos'],['reemb','−','Reembolsos de gastos','Reembolsos'],[null,'=','Cobrado propio','Cobrado propio'],['com','−','Comisiones pagadas','Com. pagadas'],['perc','+','Comisiones percibidas','Percibidas']]
  const colsT=ps?(isDesk?[null,...COLS]:COLS):[null]
  const th={fontSize:isDesk?10:10,fontWeight:800,letterSpacing:.3,textTransform:'uppercase',padding:isDesk?'8px 12px':'8px 5px',textAlign:'right',whiteSpace:'nowrap',background:C.bgSoft,borderBottom:`1px solid ${C.border}`}
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
  const MesAMes=()=>{ const csM=[...COLS,null], s=mm, nMes=mo
    const ks=s==='c'?KI:KF
    const cv=csM.map(soc=>{ const a=Array.from({length:nMes},(_,i)=>P.reduce((x,r)=>x+((r.s===s&&ks.includes(r.k)&&(!soc||r.soc===soc)&&String(r.d).startsWith(`${y}-${String(i+1).padStart(2,'0')}`))?r.m:0),0)); return isDesk?a:redondearPartes(a,1e5) })
    const socIdx=csM.map((c,j)=>c?j:-1).filter(j=>j>=0)
    return <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed'}}><colgroup>{(csM.length===1?['60%','40%']:csM.length===3?['28%','24%','24%','24%']:['24%','19%','19%','19%','19%']).map((w,i)=><col key={i} style={{width:w}}/>)}</colgroup>
      <thead><tr><th style={{...th,textAlign:'left',paddingLeft:isDesk?16:8}}>Mes</th>{csM.map((c,j)=><th key={j} style={{...th,color:tinta[c||'Oficina'],paddingRight:j===csM.length-1?(isDesk?16:8):undefined}}>{c?Ls(c):'Oficina'}</th>)}</tr></thead>
      <tbody>{Array.from({length:nMes},(_,k)=>nMes-1-k).map(i=>{ const vs=cv.map(a=>a[i]); const a0=socIdx.length>1?vs[socIdx[0]]:null, a1=socIdx.length>1?vs[socIdx[1]]:null, mx=a0==null?-1:(a0>=a1?socIdx[0]:socIdx[1]); const ymI=`${y}-${String(i+1).padStart(2,'0')}`, sel=vista==='mes'&&ym===ymI
        return <tr key={i} onClick={()=>{ setYm(ymI); setVista('mes'); setOpen(null) }} className='er-c' style={{cursor:'pointer',background:sel?C.azulBg:undefined}}><td style={{...td,textAlign:'left',paddingLeft:isDesk?16:8,color:C.accent,fontWeight:700}}>{isDesk?mesTitulo(new Date(y,i,15)).split(' ')[0]:MES_C[i]}</td>
          {vs.map((v,j)=><td key={j} style={{...td,fontWeight:csM[j]===null?800:700,color:Math.abs(v)<1?C.done:csM[j]===null?C.accent:(j===mx?tinta[csM[j]]:C.text),paddingRight:j===vs.length-1?(isDesk?16:8):undefined}}>{Math.abs(v)>=1?FMT(v):'—'}</td>)}</tr> })}
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
      <div style={{minWidth:0,flex:1}}><div style={{fontSize:12,fontWeight:700,color:C.accent,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden',lineHeight:1.25}}>{lab}</div><div style={{fontSize:15,fontWeight:800,color:vcol,fontVariantNumeric:'tabular-nums'}}>{val}</div></div><span style={{color:C.textSoft}}><ChevAb open={on}/></span></div> }
  const grupoSocio=(arr,fn)=>COLS.map(soc=>{ const its=arr.filter(b=>socioDe(b,ctx)===soc); if(!its.length) return null; return <Fragment key={soc}><div style={{display:'flex',justifyContent:'space-between',padding:isDesk?'8px 16px':'8px 10px',fontSize:11,fontWeight:800,color:C.accent,borderTop:`1px solid ${C.border}`}}><span>{L(soc)} · {its.length}</span><span style={{fontVariantNumeric:'tabular-nums'}}>{P$(its.reduce((a,b)=>a+(montoFactura(b)||b.amount||0),0))}</span></div>{its.map(fn)}</Fragment> })
  const filaRev=(b,der,sub)=><div key={b.id} style={{display:'flex',alignItems:'center',gap:10,padding:isDesk?'7px 16px':'7px 10px',borderTop:`1px solid ${C.border}`}}>
      {diaGrande(b.issued_at)}
      <div onClick={()=>b.client_id&&onOpenClientFicha&&onOpenClientFicha(b.client_id)} style={{flex:1,minWidth:0,cursor:'pointer'}}><div style={{fontSize:12.5,fontWeight:700,color:C.accent,lineHeight:1.25,overflowWrap:'anywhere'}}>{nm(b.client_id)}</div><div style={{fontSize:10.5,color:C.textSoft,fontWeight:600,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden',lineHeight:1.25}}>{b.invoice_no?`F${folioN(b.invoice_no)}`:b.status}{sub?` · ${sub}`:(isDesk&&b.concept?` · ${b.concept}`:'')}</div></div>
      <span style={{fontSize:12.5,fontWeight:800,color:C.accent,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{P$(montoFactura(b)||b.amount||0)}</span>{der}</div>
  const btn=(t,on,prim)=><button onClick={e=>{ e.stopPropagation(); on() }} style={{fontSize:11,fontWeight:700,borderRadius:8,padding:'4px 9px',border:`1px solid ${prim?C.accent:C.border}`,background:prim?C.accent:C.card,color:prim?'#fff':C.accent,cursor:'pointer',whiteSpace:'nowrap'}}>{t}</button>
  const revDet=()=>{ if(!rev) return null
    const caja=(t,body)=><div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden',marginTop:8}}><div style={{padding:isDesk?'11px 16px':'10px 10px',borderBottom:`1px solid ${C.border}`,...SEC_LBL,fontWeight:800}}>{t}</div>{body}</div>
    if(rev==='tram') return caja(isDesk?'Facturas de honorarios con señales de gasto y sin gasto ligado':'Gastos dentro de honorarios',revTram.length?grupoSocio(revTram,b=><Fragment key={b.id}>{filaRev(b,<span style={{display:'flex',gap:6}}>{btn(isDesk?'Es honorario':'Honorario',()=>esHonorario(b))}{btn(isDesk?'Ligar gasto':'Gasto',()=>setLigando(l=>l===b.id?null:b.id),true)}</span>,(()=>{ const e=(fondoCand[String(b.id)]||[])[0]; return e?`fondo sin depósito ${P$(e.amount)} del ${fmtFechaDMY(e.date)}`:null })())}
        {ligando===b.id&&(()=>{ const fs=fondoCand[String(b.id)]||[]; return <div style={{background:C.bgSoft,padding:isDesk?'6px 16px 10px':'6px 10px 10px'}}>{fs.length?fs.map(e=><div key={e.id} onClick={()=>ligar(b,e)} className='er-c' style={{display:'flex',justifyContent:'space-between',gap:8,padding:'6px 8px',borderRadius:8,cursor:'pointer',fontSize:12}}><span style={{color:C.muted,minWidth:0,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden',lineHeight:1.25}}>{fmtFechaDMY(e.date)} · {e.concept||'Fondo'}</span><b style={{color:C.accent,fontVariantNumeric:'tabular-nums'}}>{P$(e.amount)}</b></div>):<div style={{fontSize:12,color:C.muted,padding:'4px 8px'}}>Este cliente no tiene fondos sin ligar. Regístralo en su ficha › Gastos.</div>}</div> })()}</Fragment>):<div style={{padding:14,fontSize:12,color:C.muted}}>Sin pendientes.</div>)
    if(rev==='cuo') return caja(isDesk?'Cuotas con fecha de emisión y sin factura':'Cuotas sin factura',revCuo.length?grupoSocio(revCuo,b=>filaRev(b,<span style={{color:C.textSoft}}><Gl n='chevron'/></span>)):<div style={{padding:14,fontSize:12,color:C.muted}}>Sin pendientes.</div>)
    if(rev==='bda') return caja(isDesk?'Comisiones que nos pagan: ¿de qué socio es el cliente?':'Comisiones por asignar',revBda.length?revBda.map(b=>filaRev(b,<span style={{display:'flex',gap:6}}>{ADMIN_NAMES.map(sn=>btn(sn,()=>asignar(b,sn)))}</span>)):<div style={{padding:14,fontSize:12,color:C.muted}}>Al día: todas tienen socio.</div>)
    return null }
  const sumB=a=>a.reduce((x,b)=>x+(montoFactura(b)||b.amount||0),0)
  const revChip=(k,lab,n,val,col)=>{ const on=rev===k; return <button key={k} onClick={()=>setRev(r=>r===k?null:k)} style={{display:'inline-flex',alignItems:'center',gap:7,fontFamily:'inherit',fontSize:12,fontWeight:700,borderRadius:20,padding:'6px 12px',cursor:'pointer',border:`1px solid ${on?C.accent:n?C.avisoLine:C.border}`,background:n?C.soonBg:C.card,color:n?C.soonText:C.greenText,whiteSpace:'nowrap'}}>{!n&&<span style={{width:7,height:7,borderRadius:'50%',background:C.normal}}/>}{lab}{n?` · ${n} · ${val}`:''}{n?<Gl n='chevron'/>:null}</button> }
  const ParaRevisar=()=><div><div style={{display:'flex',flexWrap:'wrap',gap:8,alignItems:'center'}}><span style={{...SEC_LBL,fontWeight:800,marginRight:4}}>Para revisar</span>
      {revChip('tram','Gastos dentro de honorarios',revTram.length,fmtMillLR(sumB(revTram)))}
      {revChip('cuo','Cuotas con fecha sin factura',revCuo.length,fmtMillLR(sumB(revCuo)))}
      {revChip('bda','Comisiones por asignar',revBda.length,fmtMillLR(sumB(revBda)))}
    </div>{revDet()}</div>

  // ── Comparativo entre socios: tarjetas del indicador elegido + tabla agrupada por tema (Oficina y cada socio), con diferencias contra la Oficina y apertura hasta el registro.
  // Cada cifra sale de la fuente única de la app (P/V de kpisPorSocio, saldoBill/esVencidaB, resumenDiasCobro de _shared); aquí solo se ordena y se presenta.
  const KV=useMemo(()=>{ const o={}; const z=()=>({[ADMIN_NAMES[0]]:0,[ADMIN_NAMES[1]]:0,[SIN_SOCIO]:0}); const add=(k,soc,v,it)=>{ (o[k]=o[k]||{v:z(),n:z(),it:[]}); o[k].v[soc]+=v; o[k].n[soc]++; if(it) o[k].it.push({...it,soc}) }
    ;(bill||[]).forEach(b=>{ if(!b||b.deleted_at||!b.invoice_no||!['Pendiente','Vencido'].includes(b.status)||['reembolso','nota_credito'].includes(b.billing_type)) return; const sv=saldoBill(b); if(!(sv>0)) return; const soc=socioDe(b,ctx), it={d:b.issued_at,cid:b.client_id,doc:`F${folioN(b.invoice_no)}`,det:b.concept||'',m:sv}
      add('pcob',soc,sv,it); if(esVencidaB(b)) add('venc',soc,sv,it) })
    return o },[bill,fu.ov,saleById,cliById])
  const metaAnio=Number(metas.find(t=>t.year===y)?.target_amount)||0
  const metaDe=soc=>soc===null?metaAnio:ADMIN_NAMES.includes(soc)?metaAnio/ADMIN_NAMES.length:0   // meta repartida en partes iguales entre los socios; «Sin socio» no tiene
  const ventasP=(soc,p)=>V.filter(x=>(!soc||x.soc===soc)&&(p==='mes'?x.ym===ym:x.ym<=ym))
  const itVenta=(x,m)=>({d:`${x.ym}-01`,cid:x.s.client_id,doc:'',det:x.s.title||'',m,soc:x.soc})
  const cobradas=(soc,p)=>(billing||[]).filter(b=>b&&!b.deleted_at&&b.status==='Pagado'&&b.paid_at&&b.issued_at&&b.invoice_no&&inPer(b.paid_at,p)&&!['reembolso','nota_credito'].includes(b.billing_type)&&(!soc||socioDe(b,ctx)===soc)).map(b=>({b,dias:Math.round((new Date(b.paid_at)-new Date(b.issued_at))/864e5),monto:montoFactura(b)||Number(b.amount)||0}))
  const itCobro=(soc,p)=>cobradas(soc,p).map(x=>({d:x.b.paid_at,cid:x.b.client_id,doc:`F${folioN(x.b.invoice_no)}`,det:`${x.dias} d`,m:x.monto,soc:socioDe(x.b,ctx)}))
  const itP=(s,ks,sg)=>(soc,p)=>P.filter(r=>r.s===s&&ks.includes(r.k)&&(!soc||r.soc===soc)&&inPer(r.d,p)).map(r=>({d:r.d,cid:r.cid,doc:r.doc,det:r.det,m:sg*r.m,soc:r.soc,mov:r.mov}))
  const itKV=k=>soc=>(KV[k]?.it||[]).filter(x=>!soc||x.soc===soc)
  const ssAll=useMemo(()=>(sales||[]).filter(s=>s&&!s.deleted_at&&!esSubarriendo(s)),[sales])
  const sociosDe=soc=>soc?ssAll.filter(s=>socioDeVenta(s,{cliById})===soc):ssAll
  const dc=(soc,p)=>resumenDiasCobro(cobradas(soc,p))
  const marg=(soc,p)=>{ const e=emitido(soc,p); return e.f>0?e.i/e.f*100:null }
  const cobt=(soc,p)=>{ const its=ventasP(soc,p), tot=its.reduce((a,x)=>a+x.b,0); return tot>0?its.filter(x=>x.c>0).reduce((a,x)=>a+x.b,0)/tot*100:null }
  // g = tema · f = formato · ext = cifra de monto o cantidad (muestra su participación en la Oficina); sin ext = cifra relativa (muestra la diferencia con la Oficina)
  const FILAS=[
    {g:'ven',k:'vbru',l:'Vendido bruto',f:'$',ext:1,v:(s,p)=>ventasP(s,p).reduce((a,x)=>a+x.b,0),dr:(s,p)=>ventasP(s,p).map(x=>itVenta(x,x.b))},
    {g:'ven',k:'vnet',l:'Vendido neto de comisiones',f:'$',ext:1,v:(s,p)=>vend(s,p),dr:(s,p)=>ventasP(s,p).map(x=>itVenta(x,x.m))},
    {g:'ven',k:'nven',l:'Ventas cerradas',f:'n',ext:1,v:(s,p)=>ventasP(s,p).length,dr:(s,p)=>ventasP(s,p).map(x=>itVenta(x,x.b))},
    {g:'ven',k:'tick',l:'Ticket promedio',f:'$',v:(s,p)=>{ const a=ventasP(s,p); return a.length?a.reduce((x,y2)=>x+y2.b,0)/a.length:null },dr:(s,p)=>ventasP(s,p).map(x=>itVenta(x,x.b))},
    {g:'ven',k:'conv',l:'Conversión de propuestas',f:'%',per:'hoy',v:s=>conversionPropuestas({sales:sociosDe(s),noCuentan}).pct,dr:(s,p)=>ventasP(s,p).map(x=>itVenta(x,x.b))},
    {g:'cos',k:'cfac',l:'Comisiones de lo facturado',f:'$',ext:1,v:(s,p)=>-sumP('f','com',s,p),dr:itP('f',['com'],-1)},
    {g:'cos',k:'fnet',l:'Facturado neto de comisiones',f:'$',ext:1,v:(s,p)=>emitido(s,p).i,dr:itP('f',[...KF,'com'],1)},
    {g:'cos',k:'cpag',l:'Comisiones pagadas en el año',f:'$',ext:1,v:(s,p)=>-sumP('c','com',s,p),dr:itP('c',['com'],-1)},
    {g:'cob',k:'dcob',l:'Días de cobro',f:'d',v:(s,p)=>dc(s,p).pond,dr:itCobro},
    {g:'cob',k:'p60',l:'Cobrado en ≤60 días',f:'%',v:(s,p)=>dc(s,p).pct60,dr:itCobro},
    {g:'cob',k:'p90',l:'Cobrado en más de 90 días',f:'%',v:(s,p)=>dc(s,p).pct90,dr:itCobro},
    {g:'car',k:'venc',l:'Vencido',f:'$',ext:1,per:'hoy',v:s=>{ const o=KV.venc; return o?(s?o.v[s]||0:Object.values(o.v).reduce((a,x)=>a+x,0)):0 },dr:itKV('venc')},
    {g:'car',k:'pcob',l:'Por cobrar',f:'$',ext:1,per:'hoy',v:s=>{ const o=KV.pcob; return o?(s?o.v[s]||0:Object.values(o.v).reduce((a,x)=>a+x,0)):0 },dr:itKV('pcob')},
    {g:'mar',k:'marg',l:'Margen después de comisiones',f:'%',v:marg,dr:itP('f',['com'],-1)},
    {g:'mar',k:'cobt',l:'Cobertura de otros costos',f:'%',v:cobt,dr:(s,p)=>ventasP(s,p).filter(x=>!(x.c>0)).map(x=>itVenta(x,x.b))},
    {g:'met',k:'meta',l:'Meta del año',f:'$',ext:1,per:'anio',v:s=>metaDe(s)>0?metaDe(s):null},
    {g:'met',k:'cump',l:'Cumplimiento de la meta',f:'%',per:'anio',v:s=>metaDe(s)>0?vend(s,'ytd')/metaDe(s)*100:null,dr:(s)=>ventasP(s,'ytd').map(x=>itVenta(x,x.m))},
  ]
  const GRUPOS=[['ven','Ventas','',C.azulBg],['cos','Costo de la venta','comisiones a terceros',C.ambarBg],['cob','Cobro','ponderado por monto',C.tealBg],['car','Cartera · hoy','',C.greenBg],['mar','Margen','después de comisiones',C.bgSoft],['met','Metas','repartidas 50 % y 50 % entre los socios',C.azulBg]]
  const fV=(v,f)=>v==null?'—':f==='$'?(Math.abs(v)<1?'—':fmtMillLR(v)):f==='%'?`${Math.round(v)} %`:f==='d'?`${Math.round(v)} d`:String(Math.round(v))
  // Diferencia de un socio con la Oficina en una cifra relativa: sin umbral, cualquier diferencia se marca.
  const difDe=(F2,v,vo)=>{ if(F2.ext||v==null||vo==null||(F2.f==='$'&&(Math.abs(v)<1||Math.abs(vo)<1))) return null; const d=F2.f==='$'?(vo?(v/vo-1)*100:0):v-vo, r=Math.round(Math.abs(d)); if(r<1) return null; return {up:d>0,t:F2.f==='$'?`${r} %`:F2.f==='d'?`${r} d`:`${r} pp`} }
  const Flecha=({up,t})=><span style={{display:'inline-flex',alignItems:'center',gap:2,fontSize:10,fontWeight:700,color:C.azulInfo,background:C.azulBg,borderRadius:10,padding:'0 6px',lineHeight:'16px',whiteSpace:'nowrap'}}><Gl n={up?'arrowUp':'arrowDown'}/>{t}</span>
  const [ind,setInd0]=useState(()=>{ const v=_lsGet('porsocio_ind','vnet'); return FILAS.some(x=>x.k===v)?v:'vnet' }); const setInd=v=>{ setInd0(v); _lsSet('porsocio_ind',v) }
  const [dif,setDif0]=useState(()=>_lsGet('porsocio_dif',true)); const setDif=v=>{ setDif0(v); _lsSet('porsocio_dif',v) }
  const [ofiFin,setOfiFin0]=useState(()=>_lsGet('porsocio_ofifin',false)); const setOfiFin=v=>{ setOfiFin0(v); _lsSet('porsocio_ofifin',v) }
  const [gAb,setGAb]=useState({})   // grupos plegados
  const [indMenu,setIndMenu]=useState(false)
  const pDe=F2=>F2.per==='anio'?'ytd':vista
  const abrirFila=(k,soc)=>{ const F2=FILAS.find(x=>x.k===k); if(!F2?.dr) return; setVerTodo(false); setGAb(g=>({...g,[F2.g]:false})); setKopen(o=>(o&&o.k===k&&o.soc===soc)?null:{k,soc}); setTimeout(()=>{ try{ document.getElementById('cmp-'+k)?.scrollIntoView({block:'center',behavior:'smooth'}) }catch(_){} },60) }
  const valsFila=F2=>{ const p=pDe(F2); const o=[F2.v(null,p),...COLS.map(c=>F2.v(c,p))]; return o }   // [Oficina, ...socios]
  const TarjetasCmp=()=>{ const F2=FILAS.find(x=>x.k===ind)||FILAS[1], vs=valsFila(F2), pcs=F2.ext?partesPctEnt(vs.slice(1)):null
    const card=(soc,j)=>{ const v=vs[j], d=soc===null?null:difDe(F2,v,vs[0]), col=soc===null?C.greenText:tinta[soc], on=v!=null&&F2.dr
      return <div key={soc||'of'} role={on?'button':undefined} tabIndex={on?0:undefined} onClick={on?()=>abrirFila(F2.k,soc):undefined} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:isDesk?'10px 14px':'9px 11px',minWidth:0,cursor:on?'pointer':'default',boxSizing:'border-box'}}>
        <div style={{display:'flex',alignItems:'center',gap:6,minWidth:0}}><span style={{width:8,height:8,borderRadius:'50%',background:col,flexShrink:0}}/><span style={{fontSize:isDesk?11:10,fontWeight:700,letterSpacing:.5,textTransform:'uppercase',color:col,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{soc===null?'Oficina':(isDesk?L(soc):Ls(soc))}</span></div>
        <div style={{fontSize:isDesk?22:18,fontWeight:800,letterSpacing:-.6,color:C.accent,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap',lineHeight:1.2,marginTop:3}}>{fV(v,F2.f)}</div>
        <div style={{fontSize:11,color:C.muted,whiteSpace:'nowrap',minHeight:16}}>{soc===null?(F2.ext?'Suma de los socios':'Toda la oficina'):F2.ext?(v!=null&&Math.abs(v)>=1?`${pcs[j-1]} % de la oficina`:'—'):(dif&&d?<Flecha {...d}/>:'')}</div></div> }
    return <div style={{display:'grid',gridTemplateColumns:isDesk?'repeat(4,minmax(0,1fr))':'repeat(2,minmax(0,1fr))',gap:isDesk?12:8}}>{[null,...COLS].map((c,j)=>card(c,j))}</div> }
  const Comparativo=()=>{ const cs=ofiFin?[...COLS,null]:[null,...COLS], w=['28%','18%','18%','18%','18%']
    const seg2=(on,t,f,ic)=><button key={t} onClick={f} style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:11,fontWeight:700,border:`1px solid ${on?C.azulBd:C.border}`,background:on?C.azulBg:C.card,color:C.accent,borderRadius:14,padding:'4px 10px',cursor:'pointer',whiteSpace:'nowrap'}}>{ic}{t}</button>
    return <div style={{display:'flex',flexDirection:'column',gap:isDesk?12:8}}>
      <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}><span style={{...SEC_LBL,fontWeight:800}}>Indicador</span>
        <button onClick={()=>setIndMenu(v=>!v)} style={{display:'inline-flex',alignItems:'center',gap:5,fontSize:12.5,fontWeight:700,color:C.accent,background:C.bgSoft,border:0,borderRadius:16,padding:'5px 12px',cursor:'pointer',maxWidth:'100%'}}><span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{(FILAS.find(x=>x.k===ind)||FILAS[1]).l} · {perLbl(pDe(FILAS.find(x=>x.k===ind)||FILAS[1]))}</span><ChevAb open={indMenu}/></button></div>
      {indMenu&&<div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>{GRUPOS.map(([g,gl])=><div key={g}><div style={{padding:'8px 14px 4px',...SEC_LBL,fontWeight:800}}>{gl}</div>{FILAS.filter(x=>x.g===g).map(x=><div key={x.k} onClick={()=>{ setInd(x.k); setIndMenu(false) }} className='er-c' style={{padding:'9px 14px',fontSize:12.5,fontWeight:x.k===ind?800:600,color:C.accent,background:x.k===ind?C.azulBg:undefined,cursor:'pointer'}}>{x.l}</div>)}</div>)}</div>}
      {TarjetasCmp()}
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
        <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',padding:isDesk?'11px 16px':'10px',borderBottom:`1px solid ${C.border}`}}><span style={{...SEC_LBL,fontWeight:800,whiteSpace:'nowrap'}}>{isDesk?'Comparativo entre socios':'Comparativo'} · {perLbl(vista)}</span>
          <span style={{marginLeft:'auto',display:'inline-flex',gap:6}}>{seg2(dif,'Diferencias',()=>setDif(!dif),<Gl n='arrowUp'/>)}{seg2(ofiFin,'Oficina al final',()=>setOfiFin(!ofiFin))}</span></div>
        <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed'}}><colgroup>{w.map((x,i)=><col key={i} style={{width:x}}/>)}</colgroup>
          <thead><tr><th style={{...th,textAlign:'left',paddingLeft:isDesk?16:8}}>Indicador</th>{cs.map((c,j)=><th key={j} style={{...th,color:tinta[c||'Oficina'],paddingRight:j===cs.length-1?(isDesk?16:8):undefined}}>{c?(isDesk?L(c):Ls(c)):'Oficina'}</th>)}</tr></thead>
          <tbody>{GRUPOS.map(([g,gl,gs,gbg])=>{ const rows=FILAS.filter(x=>x.g===g), ab=!gAb[g]
            const nDif=dif?rows.filter(F2=>{ const vs=valsFila(F2); return COLS.some((c,j)=>difDe(F2,vs[j+1],vs[0])) }).length:0
            return <Fragment key={g}>
              <tr onClick={()=>setGAb(x=>({...x,[g]:!x[g]}))} style={{cursor:'pointer',background:gbg}}><td colSpan={cs.length+1} style={{padding:isDesk?'9px 16px':'9px 8px',borderTop:`1px solid ${C.border}`}}><span style={{...SEC_LBL,fontWeight:800}}>{gl}{gs?<span style={{fontWeight:600,textTransform:'none',letterSpacing:0,color:C.muted}}> · {gs}</span>:null}</span> <span style={{color:C.textSoft}}><ChevAb open={ab}/></span>{nDif>0&&<span style={{marginLeft:8,display:'inline-flex',alignItems:'center',gap:2,fontSize:10.5,fontWeight:700,color:C.azulInfo,verticalAlign:'middle'}}><Gl n='arrowUp'/><Gl n='arrowDown'/>{nDif}</span>}</td></tr>
              {ab&&rows.map(F2=>{ const vs=valsFila(F2), pcs=F2.ext?partesPctEnt(vs.slice(1)):null, ko=kopen&&kopen.k===F2.k
                return <Fragment key={F2.k}>
                  <tr id={'cmp-'+F2.k}><td style={{...td,textAlign:'left',paddingLeft:isDesk?16:8,color:C.muted,fontWeight:600,whiteSpace:'normal',lineHeight:1.25}}>{F2.l}{F2.per==='hoy'&&<span style={{display:'block',fontSize:10,color:C.textSoft,fontWeight:600}}>hoy</span>}</td>
                    {cs.map((c,j)=>{ const idx=c===null?0:COLS.indexOf(c)+1, v=vs[idx], d=c===null?null:difDe(F2,v,vs[0]), clic=v!=null&&Math.abs(v)>=(F2.f==='$'?1:0)&&F2.dr, sel=ko&&kopen.soc===c
                      return <td key={j} onClick={clic?()=>abrirFila(F2.k,c):undefined} className={clic?'er-c':undefined} style={{...td,fontWeight:c===null?800:700,color:v==null||(F2.f==='$'&&Math.abs(v)<1)?C.done:c===null?C.accent:C.text,cursor:clic?'pointer':'default',background:sel?C.azulBg:undefined,paddingRight:j===cs.length-1?(isDesk?16:8):undefined,verticalAlign:'top'}}>{fV(v,F2.f)}
                        {c!==null&&F2.ext&&v!=null&&Math.abs(v)>=1&&<div style={{fontSize:10,color:C.textSoft,fontWeight:600}}>{pcs[COLS.indexOf(c)]} %</div>}
                        {dif&&d&&<div style={{marginTop:2}}><Flecha {...d}/></div>}</td> })}</tr>
                  {ko&&F2.dr&&<tr><td colSpan={cs.length+1} style={{padding:0}}>{lista(F2.dr(kopen.soc,pDe(F2)).sort((a,b)=>Math.abs(b.m)-Math.abs(a.m)),`${kopen.soc?L(kopen.soc):'Oficina'} · ${F2.l}`)}</td></tr>}
                </Fragment> })}
            </Fragment> })}</tbody></table></div></div> }

  // ── Datos crudos (partidas reales, monto en la columna de su socio)
  const CON={f:{emit:'Facturas emitidas',cext:'Comisión de externos',reemb:'Reembolsos de gastos',nc:'Notas de crédito',com:'Comisiones de lo facturado',sub:'Subarriendo · aparte'},c:{fac:'Cobrado de facturas',ant:'Anticipos',reemb:'Reembolsos de gastos',com:'Comisiones pagadas',perc:'Comisiones percibidas',sub:'Subarriendo · aparte'}}
  const SECL={f:'Facturado',c:'Cobrado'}
  const Datos=()=>{ const p=vista, base=P.filter(r=>r.s===dat.sec&&inPer(r.d,p)&&(!dat.soc||r.soc===dat.soc)), presentes=[...new Set(base.map(r=>r.k))], q=_normTxt(dat.q||'')
    const grupo=dat.con==='pre'?(dat.sec==='f'?KF:KI):dat.con==='cp'?KC:[dat.con]
    let LD=base.filter(r=>grupo.includes(r.k)&&(!q||_normTxt(nm(r.cid)).includes(q)||String(r.doc||'').toLowerCase().includes(q)))
    LD.sort((a,b)=>dat.ord==='m'?Math.abs(b.m)-Math.abs(a.m):String(b.d).localeCompare(String(a.d)))
    const T={}; COLS.forEach(c=>T[c]=0); LD.forEach(r=>T[r.soc]+=r.m)
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
        <tbody>{LD.slice(0,dat.lim).map((r,i)=><tr key={i} onClick={()=>irA(r)} className='er-c' style={{cursor:'pointer'}}>
          {isDesk?<><td style={{...tdD,textAlign:'left',paddingLeft:16,color:C.muted}}>{fmtFechaDMY(r.d)}</td>
          <td style={{...tdD,textAlign:'left',color:C.accent,fontWeight:700}} title={nm(r.cid)}>{nm(r.cid)}</td></>
          :<td style={{...tdD,textAlign:'left',paddingLeft:10,whiteSpace:'normal'}}><div style={{color:C.accent,fontWeight:700,fontSize:11.5,lineHeight:1.25,overflowWrap:'anywhere'}}>{nm(r.cid)}</div><div style={{color:C.textSoft,fontSize:10.5,fontWeight:600,whiteSpace:'nowrap'}}>{fmtFechaDMY(r.d)}{r.doc?` · ${r.doc}`:''}</div></td>}
          {isDesk&&<td style={{...tdD,textAlign:'left',color:C.muted}}>{r.doc||'—'}</td>}
          {isDesk&&<td style={{...tdD,textAlign:'left',color:C.textSoft}} title={r.det}>{CON[r.s][r.k]}</td>}
          {isDesk?COLS.map((c,j)=><td key={c} style={{...tdD,color:c===r.soc?(r.m<0?C.overdueText:C.text):C.done,paddingRight:j===COLS.length-1?16:undefined}}>{c===r.soc?P$(r.m):'·'}</td>)
            :<td style={{...tdD,paddingRight:10,verticalAlign:'top',color:r.m<0?C.overdueText:C.text}}><span style={{display:'inline-block',width:7,height:7,borderRadius:'50%',background:tinta[r.soc],marginRight:5}}/>{P$(r.m)}</td>}
        </tr>)}
          <tr><td colSpan={isDesk?4:1} style={{...tdD,textAlign:'left',paddingLeft:isDesk?16:10,fontWeight:800,color:C.accent,borderTop:`1.5px solid ${C.accent}`,background:'#EDF1F4'}}>Total · {LD.length} partidas</td>
            {isDesk?COLS.map((c,j)=><td key={c} style={{...tdD,fontWeight:800,color:C.accent,borderTop:`1.5px solid ${C.accent}`,background:'#EDF1F4',paddingRight:j===COLS.length-1?16:undefined}}>{P$(T[c])}</td>)
              :<td style={{...tdD,fontWeight:800,color:C.accent,borderTop:`1.5px solid ${C.accent}`,background:'#EDF1F4',paddingRight:10}}>{P$(COLS.reduce((a,c)=>a+T[c],0))}</td>}</tr></tbody></table>
      {LD.length>dat.lim&&<div onClick={()=>setDat(d=>({...d,lim:d.lim+40}))} style={{textAlign:'center',padding:10,fontSize:12,fontWeight:700,color:C.azulInfo,borderTop:`1px solid ${C.border}`,cursor:'pointer'}}>Ver {Math.min(40,LD.length-dat.lim)} más de {LD.length}</div>}
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
    {tab!=='cmp'&&kpiTiles()}
    {tab==='res'&&<div style={{display:'flex',flexDirection:'column',gap:isDesk?12:8,marginTop:isDesk?12:8}}>
      {tablaResumen()}
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
        <div style={{display:'flex',alignItems:'center',gap:8,padding:isDesk?'11px 16px':'10px',borderBottom:`1px solid ${C.border}`}}><span style={{...SEC_LBL,fontWeight:800,whiteSpace:'nowrap'}}>Mes a mes {y}</span><span style={{marginLeft:'auto',display:'inline-flex',background:C.bgSoft,borderRadius:12,padding:2}}>{[['c','Ingreso real'],['f','Facturado']].map(([k,l])=><button key={k} onClick={()=>setMm(k)} style={{fontSize:10.5,fontWeight:700,border:0,borderRadius:10,padding:'3px 9px',cursor:'pointer',background:mm===k?C.card:'transparent',color:mm===k?C.accent:C.muted,boxShadow:mm===k?`0 0 0 1px ${C.border}`:'none',whiteSpace:'nowrap'}}>{l}</button>)}</span></div>
        {MesAMes()}
      </div>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
        <div style={{display:'flex',alignItems:'center',gap:8,padding:isDesk?'11px 16px':'10px',borderBottom:`1px solid ${C.border}`}}><span style={{...SEC_LBL,fontWeight:800,whiteSpace:'nowrap'}}>Composición · {perLbl(vista)}</span><button onClick={()=>setPs(!ps)} style={{marginLeft:'auto',fontSize:11,fontWeight:700,border:`1px solid ${ps?C.azulBd:C.border}`,background:ps?C.azulBg:C.card,color:C.accent,borderRadius:14,padding:'4px 11px',cursor:'pointer',whiteSpace:'nowrap'}}>{ps?'Cerrar por socio':'Abrir por socio'}</button></div>
        {Comp()}
      </div>
      {ParaRevisar()}
    </div>}
    {tab==='cmp'&&<div style={{marginTop:16}}>{Comparativo()}</div>}
    {tab==='dat'&&<div style={{marginTop:16}}>{Datos()}</div>}
  </div>)
}

