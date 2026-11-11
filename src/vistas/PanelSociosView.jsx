// Panel de socios — una sola página que reúne lo financiero para la reunión de socios. No calcula nada propio: cada cifra sale de la MISMA función que usa
// su pantalla de origen (hook del resultado del año de Inicio, Por socio, ciclo de Facturación, cartera, Socios, Estado de resultados, comisiones, flujo de caja…),
// de modo que coincide con ellas. Cada cifra y cada tarjeta es tocable y lleva a su detalle; «‹» vuelve al mismo punto (navTo/goBack del App).
import { Children, useMemo, useState } from 'react'
import { C, SEC_LBL, SIcon, appAlert, fmtFechaDMY, useIsDesktop } from '../lib/base.jsx'
import { ADMIN_NAMES, ActBtn, PageHeader, loadXLSXStyle, SIN_SOCIO, _ymPrev, currentYear, fmtShort, fmtUFk, partidasPorSocio, porCobrarBills, resultadoMes, resumenCartera, saldoComisiones, saldosPorCliente, totalesFondos, ufFechaCache, useFlujoCaja, useNoEmitirSet, usePersistedState, usePorSocioFuentes, vendidoPorSocio, ventaUF, CifrasBrutoNeto } from '../lib/compartido.jsx'
import { kpisPorSocio, redondearPartes } from '../lib/cifras.js'
import { anticiposDisponibles } from '../../supabase/functions/_shared/ventasReglas.js'
import { pctsAnio, useResultadoAnio } from '../lib/resultadoAnio.js'
import { proyeccionCobranza, ResDrillPanel, ProyeccionDetalle } from './DashboardView.jsx'
import { retirosSocios } from './SociosView.jsx'
import { cicloFacturacionMes } from '../../supabase/functions/_shared/facturacionMes.js'
import { notariaPorLiquidar } from '../../supabase/functions/_shared/notariaReglas.js'
import { nClientesConPendientes } from '../../supabase/functions/_shared/pendientesCliente.js'

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
const TONO = { az:[C.azulBg,C.azulInfo], am:[C.soonBg,C.soonText], gr:[C.greenBg,C.greenText], ro:[C.overdueBg,C.overdueText], te:[C.tealBg,C.tealText], gy:[C.bgSoft,C.muted] }
const norm = s => String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\s+/g,' ').trim()

// Tarjeta del año (mismo molde que Resultado/Ingresos del Dashboard: ícono a la izquierda, etiqueta 10,5 px, cifra 26 px) y fila de cifra (ícono de su tono, texto, monto a la derecha).
const ELIPSIS = {whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}
const DOS_LINEAS = {display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden',lineHeight:1.25}   // escritorio: el texto baja a una segunda línea en vez de cortarse con «…»
const TONO_ANIO = { az:[C.azulBg,C.azulBd,'#fff',C.azulInfo], am:[C.soonBg,C.avisoLine,'#fff',C.soonText], gr:[C.greenBg,C.greenDeep,'#fff',C.greenText], nt:[C.surface,C.border,C.bgSoft,C.accent] }
// Mismos íconos que los tiles de Inicio (DashboardView): tendencia, documento, billete y margen.
const ICO_ANIO = {
  chart:<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/></svg>,
  file:<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
  check:<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/></svg>,
  tPct:<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>,
}
const KpiAnio = ({ic,tono='nt',label,value,dual,pct,cap,onClick,D,activo}) => { const [bg,bd,icoBg,fg]=TONO_ANIO[tono]; return (
  <div onClick={onClick} style={{background:bg,border:`1px solid ${activo?C.accent:bd}`,boxShadow:activo?`0 0 0 1px ${C.accent} inset`:'none',borderRadius:12,padding:D?'14px':'12px 10px',minHeight:D?undefined:86,boxSizing:'border-box',position:'relative',display:'flex',alignItems:'center',gap:D?12:9,cursor:onClick?'pointer':'default',minWidth:0}}>
    <span style={{width:D?34:30,height:D?34:30,borderRadius:8,background:icoBg,color:fg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{ICO_ANIO[ic]}</span>
    <div style={{minWidth:0,flex:1}}>
      <div style={{...SEC_LBL,fontSize:D?13:12,...DOS_LINEAS}}>{label}</div>
      {dual||<div style={{fontSize:D?26:20,fontWeight:800,letterSpacing:'-.6px',lineHeight:1.05,color:C.accent,marginTop:3,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{value}</div>}
      {pct!=null&&<div style={{fontSize:11,color:C.muted,marginTop:3,paddingRight:dual&&!D?50:0,...DOS_LINEAS}}><b style={{color:C.accent,fontWeight:800}}>{pct} %</b> {cap}</div>}
    </div>
  </div>) }
const Fila = ({tono='az',ic='file',label,sub,value,vcol,onClick,det,detEl,detLink}) => { const [bg,fg]=TONO[tono]||TONO.az; const [op,setOp]=useState(false); const desp=!!(det||detEl); return (<>
  <div onClick={desp?()=>setOp(o=>!o):onClick} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 12px',minHeight:52,borderTop:`1px solid ${C.bgSoft}`,cursor:(onClick||desp)?'pointer':'default'}}>
    <span style={{width:26,height:26,borderRadius:8,background:bg,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SIcon n={ic} s={14} c={fg}/></span>
    <div style={{flex:1,minWidth:0}}><div style={{fontSize:12.5,fontWeight:600,color:C.text}}>{label}</div>{sub&&<div style={{fontSize:10.5,color:C.muted}}>{sub}</div>}</div>
    <span style={{fontSize:14,fontWeight:800,color:vcol||fg,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{value}</span>
    {desp&&<span style={{color:C.done,display:'flex'}}><SIcon n={op?'chevU':'chevD'} s={11} c={C.done}/></span>}
  </div>
  {desp&&op&&<>
    {det&&(det.length===0?<div style={{padding:'8px 12px 8px 48px',background:C.bgSoft,borderTop:`1px solid ${C.bgSoft}`,fontSize:11.5,color:C.muted}}>Sin partidas</div>
      :det.map((d,i)=><div key={d.k||i} onClick={d.onClick} style={{display:'grid',gridTemplateColumns:'74px minmax(0,1fr) auto 10px',columnGap:8,alignItems:'center',padding:'7px 12px 7px 24px',background:C.bgSoft,borderTop:`1px solid ${C.border}`,cursor:d.onClick?'pointer':'default',fontSize:12}}>
        <span style={{fontWeight:700,color:C.accent,fontSize:11.5,whiteSpace:'nowrap'}}>{d.a}</span>
        <span style={{minWidth:0,color:C.text,...DOS_LINEAS}}>{d.t}{d.tag}</span>
        <span style={{fontWeight:700,color:C.text,whiteSpace:'nowrap',fontVariantNumeric:'tabular-nums',textAlign:'right'}}>{d.v}</span>
        <span style={{color:C.done,display:'flex'}}>{d.onClick&&<SIcon n='chevron' s={10} c={C.done}/>}</span></div>))}
    {detEl&&<div style={{background:C.bgSoft,borderTop:`1px solid ${C.border}`,padding:'8px 8px 4px'}}>{detEl}</div>}
    {onClick&&<div onClick={onClick} style={{padding:'9px 12px',borderTop:`1px solid ${C.border}`,textAlign:'center',fontSize:12,fontWeight:700,color:C.azulInfo,cursor:'pointer'}}>{detLink||'Ver todo'} ›</div>}</>}
</>) }
const KpiMes = ({ic,tono='az',label,value,sub,vcol,onClick}) => { const [bg,fg]=TONO[tono]||TONO.az; return (
  <div onClick={onClick} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:'10px 12px',minHeight:80,boxSizing:'border-box',display:'flex',gap:10,alignItems:'center',cursor:onClick?'pointer':'default',minWidth:0}}>
    <span style={{width:30,height:30,borderRadius:8,background:bg,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SIcon n={ic} s={16} c={fg}/></span>
    <div style={{minWidth:0,flex:1}}><div style={{fontSize:10.5,fontWeight:700,letterSpacing:.5,textTransform:'uppercase',color:C.accent,...ELIPSIS}}>{label}</div>
      <div style={{fontSize:20,fontWeight:800,letterSpacing:-.4,color:vcol||C.accent,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{value}</div>
      {sub&&<div style={{fontSize:11,color:C.muted,...ELIPSIS}}>{sub}</div>}</div>
  </div>) }
// Cierre del mes en tres grupos (emitido · caja · resultado devengado); 6 columnas si el ancho alcanza, si no 3, 2 o 1, sin barra horizontal.
const CierreGrid = ({grupos}) => (<>
  <style>{`.cm-w{container-type:inline-size}.cm-g{display:grid;gap:12px;grid-template-columns:repeat(3,minmax(0,1fr))}.cm-k{display:grid;gap:12px;grid-template-columns:subgrid;grid-column:span var(--n)}.cm-t{grid-column:1/-1;margin:0 2px 6px}@container (min-width:1010px){.cm-g{grid-template-columns:repeat(6,minmax(0,1fr))}}@container (max-width:600px){.cm-g{grid-template-columns:repeat(2,minmax(0,1fr))}.cm-k{grid-column:1/-1;grid-template-columns:repeat(2,minmax(0,1fr))}}@container (max-width:480px){.cm-g{grid-template-columns:minmax(0,1fr)}.cm-k{grid-template-columns:minmax(0,1fr)}}`}</style>
  <div className='cm-w'><div className='cm-g'>{grupos.map(g=>(
    <div key={g.t} className='cm-k' style={{'--n':g.k.length,alignContent:'start'}}>
      <div className='cm-t' style={{...SEC_LBL,fontSize:10}}>{g.t}</div>{g.k}</div>))}</div></div></>)
// Franja de cifras (mismo molde que la franja de «Cierre»): etiqueta, cifra y una línea de apoyo.
const MiniK = ({label,value,sub,onClick}) => (
  <div onClick={onClick} style={{border:`1px solid ${C.border}`,borderRadius:10,padding:'8px 9px',minWidth:0,background:C.surface,cursor:onClick?'pointer':'default'}}>
    <div style={{fontSize:10,fontWeight:700,letterSpacing:.4,textTransform:'uppercase',color:C.muted,...ELIPSIS}}>{label}</div>
    <div style={{fontSize:16,fontWeight:800,color:C.accent,whiteSpace:'nowrap',fontVariantNumeric:'tabular-nums'}}>{value}</div>
    {sub&&<div style={{fontSize:10,color:C.muted,lineHeight:1.25}}>{sub}</div>}
  </div>)
// Barras apiladas (Cristóbal abajo, Erasmo arriba) del ingreso emitido mes a mes; el último mes va rayado: en curso.
const BarrasMes = ({datos,corto,onMes}) => {
  const [hv,setHv]=useState(null)
  const w=corto?340:1000, h=170, pl=30, pb=20, pt=14, iw=w-pl-6, ih=h-pb-pt, n=datos.length, g=iw/Math.max(n,1), bw=g*.62
  const mx=Math.max(20e6, Math.ceil(Math.max(...datos.map(d=>d.a+d.b),0)/20e6)*20e6), ticks=[0,1,2,3].map(i=>mx*i/3)
  const tt=hv!=null?datos[hv]:null, ttx=tt?Math.min(86,Math.max(14,(pl+g*hv+g/2)/w*100)):0
  const fila=(c,nom,v)=><div style={{display:'flex',justifyContent:'space-between',gap:14}}><span style={{display:'inline-flex',alignItems:'center',gap:5}}><i style={{display:'inline-block',width:8,height:8,borderRadius:2,background:c}}/>{nom}</span><b style={{fontVariantNumeric:'tabular-nums'}}>{fmtShort(v)}</b></div>
  return (<div style={{position:'relative'}} onMouseLeave={()=>setHv(null)}>
  {tt&&<div style={{position:'absolute',left:`${ttx}%`,top:0,transform:'translate(-50%,-4px)',zIndex:2,pointerEvents:'none',background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:'8px 10px',fontSize:12,color:C.text,minWidth:150,boxShadow:'0 4px 14px rgba(0,60,80,.14)'}}>
    <div style={{fontSize:11,fontWeight:800,color:C.accent,marginBottom:4}}>{MESES[Number(tt.ym.slice(5,7))-1]} {tt.ym.slice(0,4)}{hv===n-1?' · en curso':''}</div>
    {fila(C.accent,ADMIN_NAMES[0],tt.a)}{fila(C.done,ADMIN_NAMES[1],tt.b)}
    <div style={{display:'flex',justifyContent:'space-between',gap:14,borderTop:`1px solid ${C.bgSoft}`,marginTop:4,paddingTop:4,fontWeight:800,color:C.accent}}><span>Total</span><span style={{fontVariantNumeric:'tabular-nums'}}>{fmtShort(tt.a+tt.b)}</span></div>
    {Math.abs(tt.s||0)>=1&&<div style={{display:'flex',justifyContent:'space-between',gap:14,marginTop:3,color:C.muted}}><span>{SIN_SOCIO} (aparte)</span><span style={{fontVariantNumeric:'tabular-nums'}}>{fmtShort(tt.s)}</span></div>}
    {onMes&&<div style={{marginTop:5,fontSize:11,fontWeight:700,color:C.azulInfo}}>Tocar otra vez: facturas de {MESES[Number(tt.ym.slice(5,7))-1]} ›</div>}
  </div>}
  <svg viewBox={`0 0 ${w} ${h}`} width='100%' role='img' aria-label='Ingreso emitido por mes y socio' style={{display:'block'}}>
    <defs><pattern id='rayaMes' width='5' height='5' patternUnits='userSpaceOnUse' patternTransform='rotate(45)'><rect width='5' height='5' fill='#fff'/><rect width='2.2' height='5' fill={C.done}/></pattern></defs>
    {ticks.map(t=>{ const y=pt+ih-ih*t/mx; return <g key={t}><line x1={pl} x2={w-4} y1={y} y2={y} stroke={C.border}/><text x={pl-5} y={y+3} textAnchor='end' fontSize='9' fill={C.muted}>{Math.round(t/1e6)}</text></g> })}
    {datos.map((d,i)=>{ const x=pl+g*i+(g-bw)/2, ha=ih*d.a/mx, hb=ih*d.b/mx, yb=pt+ih, cur=i===n-1
      return <g key={d.ym}><rect x={x} y={yb-ha} width={bw} height={ha} fill={cur?C.muted:C.accent}/><rect x={x} y={yb-ha-hb} width={bw} height={hb} fill={cur?'url(#rayaMes)':C.done} stroke={cur?C.done:'none'}/>
        <text x={x+bw/2} y={yb-ha-hb-3} textAnchor='middle' fontSize='8.5' fontWeight='700' fill={C.accent}>{((d.a+d.b)/1e6).toFixed(1).replace('.',',')}</text>
        <text x={x+bw/2} y={h-5} textAnchor='middle' fontSize='9' fill={C.muted}>{MESES[Number(d.ym.slice(5,7))-1].slice(0,3)}</text>
        <rect x={pl+g*i} y={pt} width={g} height={ih+pb} fill={hv===i?C.accent:'transparent'} fillOpacity={.06} style={{cursor:'pointer'}} onMouseEnter={()=>setHv(i)} onClick={()=>{ if(hv===i&&onMes) onMes(d.ym); else setHv(i) }}/></g> })}
  </svg></div>) }
// Título de sección fuera de la tarjeta (como en el resto de la app): etiqueta de acento a la izquierda; extra y enlace a la derecha.
const Sec = ({t,link,onLink,extra}) => (
  <div style={{display:'flex',alignItems:'center',gap:10,margin:'2px 2px -4px'}}>
    <span style={{...SEC_LBL,flex:1,minWidth:0,...ELIPSIS}}>{t}</span>{extra}
    {link&&<span onClick={onLink} style={{fontSize:11,fontWeight:700,color:C.accent,cursor:onLink?'pointer':'default',whiteSpace:'nowrap'}}>{link} ›</span>}
  </div>)
const ICO_BLQ = { emi:'file', ing:'users', mm:'chart', mes:'chart', soc:'users', ret:'users', fac:'clock', cob:'tCobrar', cos:'building', com:'tPct', deb:'tPagar', caj:'wallet', rev:'alert' }
// Recorre el árbol de un bloque y devuelve sus filas (Fila con su valor exacto «raw») y subtítulos, tal como se muestran: la exportación no recalcula nada.
const filasDe = (nodo, out=[]) => { Children.toArray(nodo).forEach(e=>{ if(!e||!e.type) return
  if(e.type===Fila) out.push({ k:'fila', label:e.props.label, sub:e.props.sub, raw:e.props.raw, unit:e.props.unit, txt:e.props.value })
  else if(e.type===Sub) out.push({ k:'sub', t:e.props.t })
  else if(e.props&&e.props.children) filasDe(e.props.children,out) }); return out }
const Sub = ({t}) => <div style={{padding:'6px 12px',background:C.bgSoft,fontSize:10,fontWeight:800,color:C.accent,textTransform:'uppercase',letterSpacing:.4}}>{t}</div>
const Caja = ({titulo,link,onLink,extra,children}) => (
  <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
    <div style={{display:'flex',alignItems:'center',gap:8,padding:'9px 12px',background:C.bgSoft,borderBottom:`1px solid ${C.border}`}}>
      <span style={{fontSize:12,fontWeight:800,color:C.accent,flex:1}}>{titulo}</span>
      {extra}
      {link&&<span onClick={onLink} style={{fontSize:11,fontWeight:700,color:C.azulInfo,cursor:onLink?'pointer':'default',whiteSpace:'nowrap'}}>{link} ›</span>}
    </div>{children}
  </div>)

export function PanelSociosView({ sales=[], billing=[], clients=[], terceros=[], expenses=[], anticipos=[], costosOfiRows=[], fantasmaIds=null, socios=[], respaldoMap={}, pendCli=null, onGo, onBack, backLabel='Inicio' }){
  const isDesktop = useIsDesktop()
  const go = (d,x,y) => onGo&&onGo(d,x,y)
  const hoy = new Date().toISOString().slice(0,10), ymNow = hoy.slice(0,7), ymPrev = _ymPrev(ymNow)
  const mesPasado = MESES[Number(ymPrev.slice(5,7))-1], mesActual = MESES[Number(ymNow.slice(5,7))-1]
  const [moneda,setMoneda] = usePersistedState('panel_moneda','UF')
  const [vendPrinc,setVendPrinc] = usePersistedState('d_vend_princ','bruto')   // misma elección que en Inicio
  const [drill,setDrill] = usePersistedState('panel_resdrill',null)   // {tile:'vend'|'fact'|'cob'|'marg', year} — desglose bajo los tiles del año, el mismo de Inicio
  const [abiertas,setAbiertas] = usePersistedState('panel_abiertas',[])
  const lista = Array.isArray(abiertas)?abiertas:[]
  const tog = id => setAbiertas(lista.includes(id)?lista.filter(x=>x!==id):[...lista,id])
  // Desplegar o plegar de una vez todos los bloques de un grupo (la revisión recorre todo).
  const todosAbiertos = ids => ids.every(i=>lista.includes(i))
  const togTodos = ids => setAbiertas(todosAbiertos(ids)?lista.filter(x=>!ids.includes(x)):[...new Set([...lista,...ids])])
  const btnTodos = ids => <span onClick={()=>togTodos(ids)} style={{fontSize:11,fontWeight:700,color:C.azulInfo,cursor:'pointer',whiteSpace:'nowrap'}}>{todosAbiertos(ids)?'Plegar todo':'Desplegar todo'}</span>

  // ── Año: el MISMO hook de Inicio (lib/resultadoAnio.js) ──
  const R = useResultadoAnio({ sales, billing, terceros, costosOfiRows, expenses, clients, anticipos, selYear:currentYear })
  const { m, resAnio, ingresosPorAnioVenta:ing, comisPagadasAnioVenta:comP, metaCobranza, metaUF, ufRef, ufDias, fuRes } = R
  const ingYTD = ing.total||0, ingYTDUF = ing.totalUF||0
  const { ventaNetoPct, factPct, cobroPct } = pctsAnio({ m, resAnio, metaUF, ingYTD, metaCobranza })
  const vMon = (uf,clp) => moneda==='UF' ? fmtUFk(Math.round(uf||0)) : fmtShort(clp)
  const mRes = (k,abs) => { const v=(moneda==='UF'?resAnio.verUF:resAnio.verCLP)[k]||0, x=abs?Math.abs(v):v; return moneda==='UF'?fmtUFk(x):fmtShort(x) }
  const pct1 = v => v==null?null:v.toLocaleString('es-CL',{minimumFractionDigits:1,maximumFractionDigits:1})

  // ── Mes pasado: resultadoMes (el mismo del Estado de resultados) y el cierre de facturas de Facturación ──
  const deps = { billing, terceros, costosOfiRows, expenses, clients }
  const cobMes = ymPrev.slice(0,4)===String(currentYear) ? (ing.byMonth?.[ymPrev]||0) : null   // caja del mes pasado (fecha del depósito); «—» si cae en el año anterior
  const rm = useMemo(()=>resultadoMes(fuRes, deps, ymPrev),[fuRes,billing,terceros,costosOfiRows,expenses,clients,ymPrev])
  const ymAnt = _ymPrev(ymPrev), mesAnt = MESES[Number(ymAnt.slice(5,7))-1].slice(0,3)
  const rmAnt = useMemo(()=>resultadoMes(fuRes, deps, ymAnt),[fuRes,billing,terceros,costosOfiRows,expenses,clients,ymAnt])
  const cobAnt = ymAnt.slice(0,4)===String(currentYear) ? (ing.byMonth?.[ymAnt]||0) : null
  // Variación contra el mes anterior (misma función del Estado de resultados): una alza de costo va en rojo; una de ingreso, en verde.
  const dl = (v,p,costo) => { if(p==null) return undefined; const d=v-p; if(Math.abs(d)<1) return `= vs ${mesAnt}`; const bueno = costo ? d<0 : d>0; return <span><b style={{color:bueno?C.greenText:C.overdueText}}>{d>0?'▲':'▼'} {fmtShort(Math.abs(d))}</b> vs {mesAnt}</span> }
  const noEmitir = useNoEmitirSet()
  const ciclo = useMemo(()=>cicloFacturacionMes({ billing, sales, anticipos, fantasmaIds:fantasmaIds||new Set(), noEmitir:noEmitir||new Set(), respaldoMap, uf:ufFechaCache()||{}, now:new Date() }),[billing,sales,anticipos,fantasmaIds,noEmitir,respaldoMap])

  // ── Por socio y retiros ──
  const [fu] = usePorSocioFuentes()
  const P = useMemo(()=>partidasPorSocio({ billing, sales, clients, anticipos, terceros, expenses, ic:fu.ic, ia:fu.ia, ov:fu.ov, fondoExtra:{} }),[billing,sales,clients,anticipos,terceros,expenses,fu])
  const V = useMemo(()=>vendidoPorSocio(sales, clients, ufRef, currentYear, null, { terceros, billing }),[sales,clients,ufRef,terceros,billing])
  const { card6, sumP, emitido, nEmitidas, emitidoMeses } = useMemo(()=>kpisPorSocio({ P, V, ym:ymNow }),[P,V,ymNow])
  // Ingreso emitido (facturado − comisiones de lo facturado; helper único de cifras.js): mes en curso, acumulado del año y mes a mes.
  const sumaN = a => a.reduce((x,y)=>x+y,0)
  const emSocs = [...ADMIN_NAMES, SIN_SOCIO]
  const emMes = emSocs.map(s=>({ s, ...emitido(s,'mes'), n:nEmitidas(s,'mes') })).filter(x=>x.s!==SIN_SOCIO||Math.abs(x.i)>=1||x.n>0)
  const emIng = redondearPartes(emMes.map(x=>x.i),1e5), emCom = redondearPartes(emMes.map(x=>x.c),1e5)   // las partes suman el total que muestra la tarjeta
  const emTot = { i:sumaN(emIng), c:sumaN(emCom) }; emTot.f = emTot.i+emTot.c
  const emSub = sumP('f','sub',null,'mes')
  const emAnio = emSocs.map(s=>({ s, ...emitido(s,'ytd') })).filter(x=>x.s!==SIN_SOCIO||Math.abs(x.f)>=1)
  const emMeses = useMemo(()=>emitidoMeses([...ADMIN_NAMES,SIN_SOCIO]).map(x=>({ ym:x.ym, a:x.v[ADMIN_NAMES[0]]||0, b:x.v[ADMIN_NAMES[1]]||0, s:x.v[SIN_SOCIO]||0 })),[emitidoMeses])
  // «Sin socio» no va en las barras: se avisa cuánto es en el año y en qué meses cae.
  const emSin = emitido(SIN_SOCIO,'ytd').i, emSinMeses = emMeses.filter(x=>Math.abs(x.s)>=1)
  const ret = useMemo(()=>retirosSocios({ expenses, clients, socios, yr:currentYear }),[expenses,clients,socios])

  // ── Cartera, fondos, comisiones, notaría, caja ──
  const bb = billing
  const porCobrar = porCobrarBills(bb)
  const cart = useMemo(()=>resumenCartera(billing),[billing])
  const mayorCli = cart.expo.mayor ? (clients||[]).find(c=>String(c.id)===String(cart.expo.mayor.cid)) : null
  const fondos = useMemo(()=>totalesFondos(saldosPorCliente(expenses), (clients||[]).filter(c=>c&&!c.is_internal).map(c=>c.id)),[expenses,clients])
  const sc = useMemo(()=>saldoComisiones(terceros, billing),[terceros,billing])
  const diasCom = sc.porPagarDesde ? Math.round((Date.now()-new Date(sc.porPagarDesde+'T12:00').getTime())/86400000) : null
  const internos = useMemo(()=>new Set((clients||[]).filter(c=>c&&c.is_internal).map(c=>String(c.id))),[clients])
  const nota = useMemo(()=>notariaPorLiquidar(expenses,{ esOficina:cid=>internos.has(String(cid)) }),[expenses,internos])
  const antDisp = anticiposDisponibles(anticipos)
  const flujo = useFlujoCaja({ billing, terceros, costosOfiRows, anticipos, expenses, clients, sales, fantasmaIds })
  const proy = useMemo(()=>proyeccionCobranza(flujo).total,[flujo])
  const props = (sales||[]).filter(s=>s&&!s.deleted_at&&s.status==='Propuesta')
  const propUF = props.reduce((a,s)=>a+ventaUF(s,ufRef),0)

  // ── Por revisar: pendientes financieros por abogado (la misma regla de «Revisar cuentas») ──
  const abogados = ADMIN_NAMES
  const pendDe = a => pendCli ? nClientesConPendientes(pendCli, clients, a, norm) : 0
  const nDatos = pendCli ? [...pendCli.values()].reduce((a,g)=>a+(g.items||[]).filter(i=>i.tipo==='datos').length,0) : 0

  // Listas que se despliegan en la misma fila (sin salir del Panel): cada partida lleva a su ficha, venta o factura.
  const nomCli = cid => (clients||[]).find(c=>String(c.id)===String(cid))?.name||'Sin cliente'
  const hoyMs = Date.now()
  const detProps = props.slice().sort((a,b)=>new Date(a.created_at||0)-new Date(b.created_at||0)).map(sv=>{ const d=sv.created_at?Math.floor((hoyMs-new Date(sv.created_at))/86400000):null; return { k:sv.id, a:d==null?'—':`${d} día${d!==1?'s':''}`, t:`${sv.title||'Propuesta'} · ${nomCli(sv.client_id)}`, tag:d!=null&&d>14?' · tardía':'', v:fmtUFk(Math.round(ventaUF(sv,ufRef))), onClick:()=>go('venta',sv.id) } })
  const detAnt = (anticipos||[]).filter(x=>x&&x.estado==='disponible').sort((x,y)=>String(y.fecha||'').localeCompare(String(x.fecha||''))).map(x=>({ k:x.id, a:x.fecha?fmtFechaDMY(String(x.fecha).slice(0,10)):'—', t:nomCli(x.client_id), v:fmtShort(x.monto||0), onClick:()=>go('cliente',x.client_id) }))
  const detDatos = pendCli ? [...pendCli.entries()].flatMap(([cid,g])=>(g.items||[]).filter(i=>i.tipo==='datos').map((i,j)=>({ k:`${cid}-${j}`, a:i.billing_id?'Factura':i.sale_id?'Venta':'Cliente', t:`${i.titulo||'Dato por corregir'} · ${nomCli(cid)}`, v:i.monto?fmtShort(i.monto):'', onClick:()=>i.billing_id?go('factura',i.billing_id):i.sale_id?go('venta',i.sale_id):go('cliente',cid) }))) : []
  // ── Bloques ──
  const sociosFilas = [...ADMIN_NAMES, SIN_SOCIO, null]
  const tonoSoc = s => s===ADMIN_NAMES[0]?'az':s===ADMIN_NAMES[1]?'am':s===SIN_SOCIO?'am':'gy'
  const cextAnio = sumP('f','cext',null,'ytd')   // diferencia estructural entre esta tabla (DTE emitidos, con nuestra comisión de externos) y la tarjeta Facturado (honorarios propios)
  const tablaSocios = (
    <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:isDesktop?12.5:12,fontVariantNumeric:'tabular-nums'}}>
      <thead><tr>{['Socio','Vendido neto','Facturado','Cobrado','Ingreso real'].map((h,i)=><th key={h} style={{padding:isDesktop?'8px 14px':'8px 6px',fontSize:isDesktop?10:9.5,fontWeight:700,textTransform:'uppercase',letterSpacing:isDesktop?.5:.2,color:C.accent,background:C.bgSoft,textAlign:i?'right':'left',whiteSpace:isDesktop?'nowrap':'normal',verticalAlign:'bottom',lineHeight:1.15}}>{h}</th>)}</tr></thead>
      <tbody>{sociosFilas.map(s=>{ const v=card6(s,'ytd'), tot=s===null; return (
        <tr key={s||'ofi'} onClick={()=>go('porSocio')} style={{cursor:'pointer',background:tot?C.bgSoft:undefined,fontWeight:tot?800:400}}>
          <td style={{padding:isDesktop?'8px 14px':'8px 6px',borderTop:tot?`1.5px solid ${C.accent}`:`1px solid ${C.bgSoft}`,fontWeight:tot?800:600,color:tot?C.accent:C.text}}>{tot?'Oficina':s}</td>
          {[0,1,2,5].map(i=><td key={i} onClick={e=>{ e.stopPropagation(); go('porSocio',s,i) }} style={{padding:isDesktop?'8px 14px':'8px 6px',borderTop:tot?`1.5px solid ${C.accent}`:`1px solid ${C.bgSoft}`,textAlign:'right',color:tot?C.accent:undefined}}>{fmtShort(v[i])}</td>)}
        </tr>) })}</tbody>
    </table>{cextAnio>=1&&<div style={{padding:isDesktop?'8px 14px':'8px 6px',fontSize:11,color:C.muted}}>Facturado incluye la parte nuestra de las facturas por cuenta de externos ({fmtShort(cextAnio)}); la tarjeta Facturado del año cuenta solo honorarios propios y esa comisión va en Margen.</div>}</div>)
  const Mes1 = mesActual.charAt(0).toUpperCase()+mesActual.slice(1)
  const celdasEm = [...emMes.map((x,i)=>({ k:x.s, soc:x.s, v:fmtShort(emIng[i]), sub:`${x.n} factura${x.n!==1?'s':''}${emCom[i]>0?` · com. ${fmtShort(emCom[i])}`:''}` })), ...(Math.abs(emSub)>=1?[{ k:'Subarriendo', v:fmtShort(emSub), sub:'aparte, sin socio' }]:[])]
  const tablaEm = (() => { const cols = emAnio.map(x=>{ const [i,c]=isDesktop?[x.i,x.c]:redondearPartes([x.i,x.c],1e5); return { s:x.s, f:i+c, c, i } })
    const tot = { f:sumaN(cols.map(x=>x.f)), c:sumaN(cols.map(x=>x.c)), i:sumaN(cols.map(x=>x.i)) }
    const F = v => Math.abs(v)>=1 ? fmtShort(v) : '—', td = {padding:isDesktop?'9px 14px':'8px 6px',borderTop:`1px solid ${C.bgSoft}`,textAlign:'right',whiteSpace:'nowrap',fontVariantNumeric:'tabular-nums',fontSize:isDesktop?12.5:11.5}
    const th = {padding:isDesktop?'8px 14px':'8px 6px',fontSize:10,fontWeight:800,letterSpacing:.3,textTransform:'uppercase',color:C.muted,textAlign:'right',background:C.bgSoft,whiteSpace:'nowrap'}
    const lbl = {...td,textAlign:'left',fontWeight:600}, pc = (c,f)=>f>0?`${(c/f*100).toLocaleString('es-CL',{minimumFractionDigits:1,maximumFractionDigits:1})} %`:'—'
    return <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse'}}>
      <thead><tr><th style={{...th,textAlign:'left'}}></th>{cols.map(x=><th key={x.s} style={th}>{isDesktop||x.s!==SIN_SOCIO?x.s:'S/socio'}</th>)}<th style={th}>Oficina</th></tr></thead>
      <tbody>
        <tr><td style={lbl}>Facturado</td>{cols.map(x=><td key={x.s} style={td}>{F(x.f)}</td>)}<td style={td}>{F(tot.f)}</td></tr>
        <tr><td style={lbl}>− Comisiones</td>{cols.map(x=><td key={x.s} style={td}>{F(x.c)}</td>)}<td style={td}>{F(tot.c)}</td></tr>
        <tr style={{background:C.bgSoft}}><td style={{...lbl,fontWeight:800,color:C.accent}}>= Ingreso emitido</td>{cols.map(x=><td key={x.s} style={{...td,fontWeight:800,color:C.accent}}>{F(x.i)}</td>)}<td style={{...td,fontWeight:800,color:C.accent}}>{F(tot.i)}</td></tr>
        <tr><td style={{...lbl,fontWeight:500,color:C.muted,fontSize:11}}>{isDesktop?'Comisiones sobre lo facturado':'% comisión'}</td>{cols.map(x=><td key={x.s} style={{...td,color:C.muted,fontSize:11}}>{pc(x.c,x.f)}</td>)}<td style={{...td,color:C.muted,fontSize:11}}>{pc(tot.c,tot.f)}</td></tr>
      </tbody></table></div> })()
  const emUlt = emMeses[emMeses.length-1]||{a:0,b:0}, emPrev = emMeses[emMeses.length-2]
  const bloques = {
    emi: { titulo:`${Mes1} en curso`, hl:<>{fmtShort(emTot.f)} − {fmtShort(emTot.c)} = <b style={{color:C.greenText}}>{fmtShort(emTot.i)}</b></>, tono:'az', link:'Facturas del mes', dest:'facturasDelMes',
      body:<div style={{display:'grid',gridTemplateColumns:`repeat(${isDesktop?Math.max(celdasEm.length,1):Math.min(Math.max(celdasEm.length,1),3)},minmax(0,1fr))`,gap:8,padding:10}}>{celdasEm.map(c=><MiniK key={c.k} label={c.k} value={c.v} sub={c.sub} onClick={()=>go('facturasMes',ymNow,c.soc||null)}/>)}</div> },
    ing: { titulo:`Ingreso emitido · ${mesActual==='enero'?'enero':'enero–'+mesActual}`, tM:`Ingreso emitido · ${mesActual==='enero'?'ene':'ene–'+mesActual.slice(0,3)}`, hl:<>{ADMIN_NAMES.map((a,i)=><span key={a}>{i?' · ':''}{isDesktop?a:a.slice(0,1)} <b>{fmtShort(emitido(a,'ytd').i)}</b></span>)}</>, tono:'az', link:'Por socio', dest:'porSocio', body:tablaEm },
    mm: { titulo:'Ingreso emitido mes a mes', hl:<>{emPrev?<>{MESES[Number(emPrev.ym.slice(5,7))-1].slice(0,3)} <b>{fmtShort(emPrev.a+emPrev.b)}</b> · </>:null}{mesActual.slice(0,3)} <b>{fmtShort(emUlt.a+emUlt.b)}</b></>, tono:'az', link:'Informe y comparación', dest:'informeMes',
      body:<div style={{padding:'8px 10px 4px'}}><BarrasMes datos={emMeses} corto={!isDesktop} onMes={ym=>go('facturasMes',ym,null)}/><div style={{display:'flex',gap:14,fontSize:11,color:C.muted,flexWrap:'wrap'}}><span><i style={{display:'inline-block',width:10,height:10,borderRadius:3,background:C.accent,marginRight:5}}/>{ADMIN_NAMES[0]}</span><span><i style={{display:'inline-block',width:10,height:10,borderRadius:3,background:C.done,marginRight:5}}/>{ADMIN_NAMES[1]}</span><span>no incluye {SIN_SOCIO}{Math.abs(emSin)>=1&&<>: <b style={{color:C.accent}}>{fmtShort(emSin)}</b> en el año ({emSinMeses.map(x=>MESES[Number(x.ym.slice(5,7))-1].slice(0,3)+' '+fmtShort(x.s)).join(' · ')})</>}</span></div></div> },
    mes: { cap:'Resultado', titulo:`Cierre de ${mesPasado}`, hl:<>Resultado <b style={{color:rm.res>=0?C.greenText:C.overdueText}}>{(rm.res>0?'+':'')+fmtShort(rm.res)}</b></>, tono:'gr', link:'Informe y comparación', dest:'informeMes',
      body:<>
        <div style={{...SEC_LBL,fontSize:10,padding:"8px 12px 4px"}}>{`Emitido en ${mesPasado}`}</div>
        <Fila ic='file' tono='am' label='Emitido bruto' sub={`${ciclo.tasa} % pagado`} value={fmtShort(ciclo.tEmi)} raw={ciclo.tEmi} onClick={()=>go('cierreMes')}/>
        <Fila ic='tEntra' tono='az' label='Ingreso' sub={<span>propio · {dl(rm.ing,rmAnt.ing)}</span>} value={fmtShort(rm.ing)} raw={rm.ing} onClick={()=>go('estadoResultados',ymPrev,{bloque:'ing',sub:'fac'})}/>
        <div style={{...SEC_LBL,fontSize:10,padding:"8px 12px 4px"}}>Entró a caja</div>
        <Fila ic='check' tono='gr' label='Cobrado' sub={cobMes!=null?dl(cobMes,cobAnt):undefined} value={cobMes==null?'—':fmtShort(cobMes)} raw={cobMes??''} onClick={()=>cobMes!=null&&go('cobradoMes',ymPrev)}/>
        <div style={{...SEC_LBL,fontSize:10,padding:"8px 12px 4px"}}>Resultado devengado</div>
        <Fila ic='building' tono='gy' label='Costos' sub={dl(rm.cos,rmAnt.cos,true)} value={fmtShort(rm.cos)} raw={rm.cos} onClick={()=>go('estadoResultados',ymPrev,{bloque:'cos'})}/>
        <Fila ic='tPct' tono='am' label='Comisiones' sub={dl(rm.com,rmAnt.com,true)} value={fmtShort(rm.com)} raw={rm.com} onClick={()=>go('estadoResultados',ymPrev,{bloque:'com'})}/>
        <Fila ic='chart' tono={rm.res>=0?'gr':'ro'} label='Resultado' sub={rm.margen!=null?`margen ${pct1(rm.margen)} %`:undefined} value={(rm.res>0?'+':'')+fmtShort(rm.res)} vcol={rm.res<0?C.overdueText:C.accent} raw={rm.res} onClick={()=>go('estadoResultados',ymPrev)}/>
      </> },
    soc: { cap:'Resultado', titulo:`Por socio · ${mesActual==='enero'?'enero':'enero–'+mesActual}`, tM:`Por socio · ${mesActual==='enero'?'ene':'ene–'+mesActual.slice(0,3)}`, hl:<>{ADMIN_NAMES.map((s,i)=><span key={s}>{i?' · ':''}{isDesktop?s:s.slice(0,1)} <b>{fmtShort(card6(s,'ytd')[5])}</b></span>)}</>, tono:'az', link:'Por socio', dest:'porSocio', body:tablaSocios },
    ret: { cap:'Resultado', titulo:'Retiros de socios', hl:<><b style={{color:C.tealText}}>{fmtShort(ret.retTot[ret.A]||0)}</b> · <b style={{color:C.tealText}}>{fmtShort(ret.retTot[ret.B]||0)}</b></>, tono:'te', link:'Socios', dest:'socios',
      body:<>{ret.SOC.map(s=><Fila key={s} tono='te' label={s} sub={`${ret.retN[s]||0} retiro${(ret.retN[s]||0)!==1?'s':''}`} value={fmtShort(ret.retTot[s]||0)} raw={ret.retTot[s]||0} onClick={()=>go('socios',s)}/>)}
        <Fila tono='te' label='Diferencia' sub={ret.difAcum===0?'al día':`falta ${ret.difAcum>0?ret.B:ret.A}`} value={fmtShort(Math.abs(ret.difAcum))} raw={Math.abs(ret.difAcum)} onClick={()=>go('socios')}/></> },
    fac: { cap:'Facturación y cobranza', capCorto:'Fact. y cobranza', titulo:'Por facturar', hl:<>Por emitir <b style={{color:C.soonText}}>{fmtShort(ciclo.pemTot)}</b></>, tono:'am', link:'Facturación', dest:'facturas',
      body:<>
        <Fila tono='am' label={`Por emitir en ${mesActual}`} sub={`${ciclo.pemN} cuota${ciclo.pemN!==1?'s':''}`} value={fmtShort(ciclo.pemTot)} raw={ciclo.pemTot} onClick={()=>go('facturas')}/>
        <Fila tono='ro' label='Cuotas vencidas sin facturar' sub={`${ciclo.sinEmitirN} cuota${ciclo.sinEmitirN!==1?'s':''}`} value={fmtShort(ciclo.sumM(ciclo.sinEmitirCands))} raw={ciclo.sumM(ciclo.sinEmitirCands)} onClick={()=>go('sinEmitir')}/>
        <Fila tono='az' label='Por enviar al cliente' sub={`${ciclo.porEnviar.length} factura${ciclo.porEnviar.length!==1?'s':''}`} value={fmtShort(ciclo.porEnvTot)} raw={ciclo.porEnvTot} onClick={()=>go('facturasPorEnviar')}/>
        <Fila tono='az' label='Propuestas por cerrar' sub={`${props.length} propuesta${props.length!==1?'s':''}`} value={fmtUFk(Math.round(propUF))} raw={propUF} unit='UF' onClick={()=>go('ventasPropuestas')} det={detProps} detLink='Ver todas en Ventas'/>
      </> },
    cob: { cap:'Facturación y cobranza', capCorto:'Fact. y cobranza', titulo:'Por cobrar', hl:<>Vencido <b style={{color:C.overdueText}}>{fmtShort(cart.vencidoTot)}</b></>, tono:'az', link:'Cobranza', dest:'cobranza',
      body:<>
        <Fila tono='az' label='Honorarios por cobrar' value={fmtShort(porCobrar)} raw={porCobrar} onClick={()=>go('cobranza')}/>
        <Fila tono='ro' label='Vencido' sub={porCobrar>0?`${Math.round(cart.vencidoTot/porCobrar*100)} % de lo por cobrar`:undefined} value={fmtShort(cart.vencidoTot)} raw={cart.vencidoTot} onClick={()=>go('cobranzaVencido')}/>
        <Fila tono='ro' label='Más de 60 días' sub={cart.expo.pctM60!=null?`${Math.round(cart.expo.pctM60*100)} % de la cartera`:undefined} value={fmtShort(cart.expo.m60)} raw={cart.expo.m60} onClick={()=>go('cobranzaM60')}/>
        <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center',padding:'9px 12px',borderTop:`1px solid ${C.bgSoft}`}}><span style={{fontSize:10,fontWeight:700,letterSpacing:.5,textTransform:'uppercase',color:C.accent,marginRight:4}}>Antigüedad</span>{(cart.expo.tramos||[]).map((t,i)=><span key={t.k} onClick={()=>t.n>0&&go('cobranzaTramo',i)} style={{fontSize:11,fontWeight:600,borderRadius:20,padding:'4px 11px',border:`1px solid ${C.border}`,background:C.surface,color:t.n>0?C.accent:C.done,cursor:t.n>0?'pointer':'default',whiteSpace:'nowrap'}}>{t.k} · {fmtShort(t.saldo||0)}</span>)}</div>
        {cart.expo.mayor&&<Fila tono='az' label='Mayor deudor' sub={mayorCli?.name} value={fmtShort(cart.expo.mayor.saldo)} raw={cart.expo.mayor.saldo} onClick={()=>mayorCli&&go('cliente',mayorCli.id)}/>}
        <Fila tono='am' label='Gastos por cobrar a clientes' sub={`${fondos.nDeben} cliente${fondos.nDeben!==1?'s':''} · pagados por la oficina, sin fondos`} value={fmtShort(fondos.porReponer)} raw={fondos.porReponer} onClick={()=>go('gastosDeben')}/>
      </> },
    cos: { cap:'Costos y pagos', capCorto:'Costos y pagos', titulo:'Costos de oficina', hl:<>{mesPasado.slice(0,3)} <b>{fmtShort(rm.cos)}</b></>, tono:'az', link:'Estado de resultados', dest:'estadoResultados',
      body:<>
        <Fila tono='az' label={`Costos de ${mesPasado}`} sub={`año a la fecha ${fmtShort(resAnio.cos)}`} value={fmtShort(rm.cos)} raw={rm.cos} onClick={()=>go('estadoResultados',ymPrev,{bloque:'cos'})}/>
        {(rm.cosLines||[]).map(l=><Fila key={l.k} tono='az' label={l.l} value={fmtShort(l.m)} raw={l.m} onClick={()=>go('estadoResultados',ymPrev,{bloque:'cos',sub:l.k})}/>)}
        {rm.ppm>0&&<Fila tono='az' label='PPM' sub='aparte de los costos' value={fmtShort(rm.ppm)} raw={rm.ppm} onClick={()=>go('estadoResultados',ymPrev,{bloque:'cos'})}/>}
      </> },
    com: { cap:'Costos y pagos', capCorto:'Costos y pagos', titulo:'Comisiones', hl:<>Pagadas {currentYear} <b style={{color:C.greenText}}>{fmtShort(comP.total||0)}</b></>, tono:'gr', link:'Comisiones', dest:'proveedores',
      body:<>
        <Fila tono='gr' label={`Pagadas en ${mesPasado}`} value={fmtShort(rm.com)} raw={rm.com} onClick={()=>go('proveedores','pagada')}/>
        <Fila tono='gr' label={`Pagadas ${currentYear}`} value={fmtShort(comP.total||0)} raw={comP.total||0} onClick={()=>go('proveedores','pagada')}/>
        <Fila tono='gr' label={`Percibidas ${currentYear}`} sub='nos pagan a nosotros' value={fmtShort(ing.percibidas||0)} raw={ing.percibidas||0} onClick={()=>go('proveedores','cobrar')}/>
        <Fila tono='az' label='Sujetas a cobro' sub='el cliente aún no paga' value={fmtShort(sc.porDevengar)} raw={sc.porDevengar} onClick={()=>go('proveedores','por_devengar')}/>
      </> },
    deb: { cap:'Costos y pagos', capCorto:'Costos y pagos', titulo:'Por pagar', hl:<>Comisiones <b style={{color:C.soonText}}>{fmtShort(sc.porPagar)}</b></>, tono:'am', link:'Comisiones', dest:'proveedores',
      body:<>
        <Sub t='A terceros'/>
        <Fila tono='am' label='Comisiones por pagar' sub={diasCom!=null?`la más antigua, hace ${diasCom} días`:undefined} value={fmtShort(sc.porPagar)} raw={sc.porPagar} onClick={()=>go('proveedores','por_pagar')}/>
        <Fila tono='am' label='Notaría por transferir' sub={nota.montoEsperan>0?`esperan fondos del cliente ${fmtShort(nota.montoEsperan)}`:undefined} value={fmtShort(nota.montoPagables)} raw={nota.montoPagables} onClick={()=>go('notaria')}/>
        <Sub t='Fondos de clientes'/>
        <Fila tono='te' label='Fondos de clientes' sub={`${fondos.nFavor} cliente${fondos.nFavor!==1?'s':''} · provisión de gastos`} value={fmtShort(fondos.aFavor)} raw={fondos.aFavor} onClick={()=>go('gastosFavor')}/>
        <Fila tono='te' label='Anticipos disponibles' sub='recibidos sin factura' value={fmtShort(antDisp)} raw={antDisp} onClick={()=>go('anticipos')} det={detAnt} detLink='Ver anticipos en Facturación'/>
        <Fila tono='gy' label='Compras a proveedores, IVA y caja chica' sub='ver en Oficina' value='›' vcol={C.azulInfo} onClick={()=>go('oficina')}/>
      </> },
    caj: { cap:'Caja y revisión', capCorto:'Caja y revisión', titulo:'Caja', hl:<>Flujo <b style={{color:flujo.fin>=0?C.greenText:C.overdueText}}>{(flujo.fin>0?'+':'')+fmtShort(flujo.fin)}</b></>, tono:'az', link:'Flujo de caja', dest:'flujoCaja',
      body:<>
        <Fila tono={flujo.fin>=0?'gr':'ro'} label='Flujo de caja' sub='neto · 8 semanas' value={(flujo.fin>0?'+':'')+fmtShort(flujo.fin)} raw={flujo.fin} onClick={()=>go('flujoCaja')}/>
        <Fila tono='az' label='Proyección de cobranza' sub={`al ${fmtFechaDMY(`${currentYear}-12-31`)}`} value={fmtShort(proy)} raw={proy} onClick={()=>go('flujoCaja')} detEl={<ProyeccionDetalle F={flujo} clients={clients} sales={sales} isDesktop={isDesktop} onOpenFlujoCaja={()=>go('flujoCaja')} onOpenClientFicha={id=>go('cliente',id)}/>} detLink='Ver el flujo de caja'/>
        <Fila tono='am' label='Por identificar en el banco' sub='abonos sin conciliar del año' value={fmtShort(ing.porIdentificar||0)} raw={ing.porIdentificar||0} onClick={()=>go('conciliacionPorResolver')}/>
      </> },
    rev: { cap:'Caja y revisión', capCorto:'Caja y revisión', titulo:'Por revisar', hl:<>{abogados.map((a,i)=><span key={a}>{i?' · ':''}{a} <b style={{color:C.tealText}}>{pendDe(a)}</b></span>)}</>, tono:'te', link:'Clientes', dest:'clientes',
      body:<>
        {abogados.map(a=><Fila key={a} tono='te' label={`Pendientes financieros · ${a}`} sub='clientes con algo por resolver' value={String(pendDe(a))} raw={pendDe(a)} onClick={()=>go('revisarCuentas',a)}/>)}
        <Fila tono='am' label='Datos por corregir' sub='anuladas sin motivo y otros' value={String(nDatos)} raw={nDatos} onClick={()=>go('revisarCuentas')} det={detDatos} detLink='Revisar en Clientes'/>
      </> },
  }
  // ── Excel: las mismas variables y filas del panel (pesos exactos); Resumen, Por socio e Ingreso emitido ──
  const exportar = async () => { try {
    const XLSX = await loadXLSXStyle()
    const PESOS='"$"#,##0', UF_F='#,##0.00" UF"', NUM='#,##0'
    const hdr={ font:{bold:true,color:{rgb:'FFFFFF'}}, fill:{fgColor:{rgb:'003C50'}} }, sec={ font:{bold:true,color:{rgb:'003C50'}}, fill:{fgColor:{rgb:'E4E8EB'}} }, tit={ font:{bold:true,sz:14,color:{rgb:'003C50'}} }
    const hojaDe = (filas, anchos, cols) => { const ws=XLSX.utils.aoa_to_sheet(filas.map(f=>f.v.map((v,c)=>typeof v==='number'&&f.z&&f.z[c]===PESOS?Math.round(v):v))); ws['!cols']=anchos.map(w=>({wch:w}))
      filas.forEach((f,r)=>{ f.v.forEach((v,c)=>{ const ref=XLSX.utils.encode_cell({r,c}); if(!ws[ref]) return
        if(f.s==='hdr') ws[ref].s=hdr; else if(f.s==='sec') ws[ref].s=sec; else if(f.s==='tit') ws[ref].s=tit
        if(typeof v==='number'&&f.z&&f.z[c]) ws[ref].z=f.z[c] }) })
      return ws }
    // Resumen: año (pesos y UF lado a lado), cierre del mes pasado y cada bloque del detalle con las filas que se ven
    const R=[ {v:[`Panel de socios · datos al ${fmtFechaDMY(hoy)}`],s:'tit'}, {v:[]},
      {v:['Concepto','Detalle','Valor ($)','Valor (UF)'],s:'hdr'}, {v:[`Año ${currentYear}`,'','',''],s:'sec'},
      {v:['Vendido bruto','',m.bruto,m.brutoUF],z:[null,null,PESOS,UF_F]},
      {v:['Vendido neto',m.meta>0?`${ventaNetoPct} % de la meta`:'',m.neto,m.netoUF],z:[null,null,PESOS,UF_F]},
      {v:['Facturado',m.bruto>0?`${factPct} % de lo vendido bruto`:'',resAnio.verCLP.fac,resAnio.verUF.fac],z:[null,null,PESOS,UF_F]},
      {v:['Cobrado',metaCobranza>0?`${cobroPct} % de la meta`:'',ingYTD,ingYTDUF],z:[null,null,PESOS,UF_F]},
      {v:['Margen',resAnio.pct!=null?`${pct1(resAnio.pct)} % de ingresos`:'',resAnio.verCLP.res,resAnio.verUF.res],z:[null,null,PESOS,UF_F]},
      {v:[`Cierre de ${mesPasado}`,'','',''],s:'sec'},
      {v:['Facturado',`${ciclo.emi.length} emitidas · ${ciclo.tasa} % pagado`,ciclo.tEmi,''],z:[null,null,PESOS]},
      {v:['Ingreso','propio',rm.ing,''],z:[null,null,PESOS]}, {v:['Cobrado en el mes','',cobMes??'',''],z:[null,null,PESOS]},
      {v:['Costos','de oficina',rm.cos,''],z:[null,null,PESOS]}, {v:['Comisiones','pagadas',rm.com,''],z:[null,null,PESOS]},
      {v:['Resultado',rm.margen!=null?`margen ${pct1(rm.margen)} %`:'',rm.res,''],z:[null,null,PESOS]} ]
    R.push({v:['Detalle','','',''],s:'sec'})
    for(const id of ['ret','fac','cob','cos','com','deb','caj','rev']){ const b=bloques[id]; R.push({v:[b.titulo,'','',''],s:'sec'})
      filasDe(b.body).forEach(f=>{ if(f.k==='sub') R.push({v:[f.t,'','','']}); else { const num=typeof f.raw==='number'&&isFinite(f.raw)
        const enUF=f.unit==='UF', esCuenta=/^Pendientes|^Datos por/.test(String(f.label))
        R.push({ v:[f.label,f.sub||'', num&&!enUF?f.raw:(num?'':(f.txt==='›'?'':f.txt)), num&&enUF?f.raw:''], z:[null,null,esCuenta?NUM:PESOS,UF_F] }) } }) }
    // Por socio (acumulado del año)
    const S=[ {v:[`Por socio · enero–${mesActual} ${currentYear}`],s:'tit'}, {v:[]}, {v:['Socio','Vendido neto','Facturado','Cobrado','Ingreso real'],s:'hdr'},
      ...sociosFilas.map(s=>{ const v=card6(s,'ytd'); return {v:[s===null?'Oficina':s,v[0],v[1],v[2],v[5]],z:[null,PESOS,PESOS,PESOS,PESOS]} }) ]
    // Ingreso emitido: mes en curso, acumulado y mes a mes (facturado − comisiones de lo facturado)
    const E=[ {v:[`Ingreso emitido · ${Mes1} en curso`],s:'tit'}, {v:[]}, {v:['Socio','Facturado','Comisiones','Ingreso emitido','Facturas'],s:'hdr'},
      ...emMes.map(x=>({v:[x.s,x.i+x.c,x.c,x.i,x.n],z:[null,PESOS,PESOS,PESOS,NUM]})),
      ...(Math.abs(emSub)>=1?[{v:['Subarriendo (aparte, sin socio)',emSub,'','',''],z:[null,PESOS]}]:[]),
      {v:[]}, {v:[`Acumulado enero–${mesActual}`,'','','',''],s:'sec'}, {v:['Socio','Facturado','Comisiones','Ingreso emitido',''],s:'hdr'},
      ...emAnio.map(x=>({v:[x.s,x.i+x.c,x.c,x.i,''],z:[null,PESOS,PESOS,PESOS]})),
      {v:[]}, {v:['Mes a mes','','','',''],s:'sec'}, {v:['Mes',ADMIN_NAMES[0],ADMIN_NAMES[1],SIN_SOCIO,'Total'],s:'hdr'},
      ...emMeses.map(x=>({v:[`${MESES[Number(x.ym.slice(5,7))-1].slice(0,3)} ${x.ym.slice(0,4)}`,x.a,x.b,x.s,x.a+x.b+x.s],z:[null,PESOS,PESOS,PESOS,PESOS]})) ]
    const wb=XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb,hojaDe(R,[42,34,18,18]),'Resumen')
    XLSX.utils.book_append_sheet(wb,hojaDe(S,[16,16,16,16,16]),'Por socio')
    XLSX.utils.book_append_sheet(wb,hojaDe(E,[34,16,16,18,16]),'Ingreso emitido')
    XLSX.writeFile(wb,`Panel de socios ${fmtFechaDMY(hoy)}.xlsx`)
  } catch(e){ appAlert('No se pudo exportar: '+(e.message||e)) } }
  const CAPS = [['Resultado',['mes','soc','ret','emi','ing','mm']],['Facturación y cobranza',['fac','cob']],['Costos y pagos',['cos','com','deb']],['Caja y revisión',['caj','rev']]]
  const tarjeta = (id,D) => { const b=bloques[id], [bg,fg]=TONO[b.tono], open=lista.includes(id); return (
    <div key={id} onClick={()=>tog(id)} style={{background:C.surface,border:`1px solid ${open?C.accent:C.border}`,borderRadius:12,padding:D?'12px 14px':'9px 10px',cursor:'pointer',display:'flex',alignItems:'center',gap:D?12:9,minWidth:0,boxSizing:'border-box',height:'100%'}}>
      <span style={{width:D?34:30,height:D?34:30,borderRadius:10,background:bg,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SIcon n={ICO_BLQ[id]} s={D?17:15} c={fg}/></span>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:D?14:13,fontWeight:600,color:C.text,...(D?DOS_LINEAS:ELIPSIS)}}>{D?b.titulo:(b.tM||b.titulo)}</div>
        <div style={{fontSize:D?12:11,color:C.muted,marginTop:1,...(D?DOS_LINEAS:ELIPSIS),fontVariantNumeric:'tabular-nums'}}>{b.hl}</div>
      </div>
      <SIcon n={open?'chevU':'chevD'} s={13} c={C.textSoft}/>
    </div>) }
  const cuerpo = id => { const b=bloques[id]; return <Caja key={'b'+id} titulo={b.titulo} link={b.link} onLink={()=>go(b.dest)}>{b.body}</Caja> }
  const selMoneda = (
    <div style={{display:'inline-flex',background:C.surface,border:`1px solid ${C.border}`,borderRadius:20,padding:2}}>
      {['UF','CLP'].map(u=>{ const on=moneda===u; return <span key={u} onClick={()=>setMoneda(u)} style={{fontSize:10,fontWeight:700,color:on?'#fff':C.done,background:on?C.accent:'transparent',borderRadius:18,padding:'3px 9px',cursor:'pointer',lineHeight:1}}>{u}</span> })}
    </div>)
  const ano = (<>
    <Sec t={`Año ${currentYear}`} extra={selMoneda} link='Resultado del año' onLink={()=>go('resultadoAnio')}/>
    <div style={{display:'grid',gridTemplateColumns:isDesktop?'repeat(4,minmax(0,1fr))':'repeat(2,minmax(0,1fr))',gap:isDesktop?12:8}}>
      <KpiAnio D={isDesktop} ic='chart' tono='az' label='Vendido' dual={<CifrasBrutoNeto desk={isDesktop} bruto={vMon(m.brutoUF,m.bruto)} neto={vMon(m.netoUF,m.neto)} princ={vendPrinc} onAlt={setVendPrinc}/>} pct={m.meta>0?ventaNetoPct:null} cap='neto de la meta' activo={drill?.tile==='vend'} onClick={()=>setDrill(d=>d&&d.tile==='vend'?null:{tile:'vend',year:null})}/>
      <KpiAnio D={isDesktop} ic='file' tono='am' label='Facturado' value={mRes('fac')} pct={m.bruto>0?factPct:null} cap='del bruto' activo={drill?.tile==='fact'} onClick={()=>setDrill(d=>d&&d.tile==='fact'?null:{tile:'fact',year:null})}/>
      <KpiAnio D={isDesktop} ic='check' tono='gr' label='Cobrado' value={vMon(ingYTDUF,ingYTD)} pct={metaCobranza>0?cobroPct:null} cap='de la meta' activo={drill?.tile==='cob'} onClick={()=>setDrill(d=>d&&d.tile==='cob'?null:{tile:'cob',year:null})}/>
      {resAnio.ing>0&&<KpiAnio D={isDesktop} ic='tPct' tono='nt' label='Margen' value={(resAnio.res<0?'−':'')+mRes('res',true)} pct={resAnio.pct!=null?pct1(resAnio.pct):null} cap='ingresos' activo={drill?.tile==='marg'} onClick={()=>setDrill(d=>d&&d.tile==='marg'?null:{tile:'marg',year:null})}/>}
    </div>
    {drill&&<ResDrillPanel datos={R} clients={clients} terceros={terceros} tile={drill.tile} year={drill.year} setDrill={setDrill} moneda={moneda} isDesk={isDesktop} selYear={currentYear}
      go={t=>go(({sales:'ventas',billing:'facturacion',expenses:'gastos',presupuestoOficina:'oficina'})[t]||t)} onOpenClientFicha={id=>go('cliente',id)} onOpenEstadoResultados={()=>go('resultadoAnio')} propAbiertas={{uf:propUF,n:props.length,onClick:()=>go('ventasPropuestas')}}/>}
  </>)
  const fecha = fmtFechaDMY(hoy)
  const resColor = rm.res>=0?C.greenText:C.overdueText
  return (
    <div style={{maxWidth:1120,margin:'0 auto',padding:isDesktop?'0 20px 40px':'0 14px 40px'}}>
      <PageHeader origen={backLabel} onBack={onBack} titulo='Panel de socios' ctx={isDesktop?`datos al ${fecha}`:undefined} right={<ActBtn variant='ghost' onClick={exportar} title='Descargar el panel en Excel'><SIcon n='download' s={14} c={C.accent}/>{isDesktop?'Excel':''}</ActBtn>}/>
      <div style={{display:'flex',flexDirection:'column',gap:isDesktop?12:10,marginTop:isDesktop?12:6}}>
        {ano}
        {isDesktop ? (<>
          <Sec t={bloques.mes.titulo} link={bloques.mes.link} onLink={()=>go(bloques.mes.dest)}/>
          <CierreGrid grupos={[
            {t:`Emitido en ${mesPasado}`,k:[
              <KpiMes key='f' ic='file' tono='am' label='Emitido bruto' value={fmtShort(ciclo.tEmi)} sub={`${ciclo.tasa} % pagado`} onClick={()=>go('cierreMes')}/>,
              <KpiMes key='i' ic='tEntra' tono='az' label='Ingreso' value={fmtShort(rm.ing)} sub={<span>propio · {dl(rm.ing,rmAnt.ing)}</span>} onClick={()=>go('estadoResultados',ymPrev,{bloque:'ing',sub:'fac'})}/>]},
            {t:'Entró a caja',k:[<KpiMes key='c' ic='check' tono='gr' label='Cobrado' value={cobMes==null?'—':fmtShort(cobMes)} sub={cobMes!=null?dl(cobMes,cobAnt):undefined} onClick={()=>cobMes!=null&&go('cobradoMes',ymPrev)}/>]},
            {t:'Resultado devengado',k:[
              <KpiMes key='o' ic='building' tono='gy' label='Costos' value={fmtShort(rm.cos)} sub={dl(rm.cos,rmAnt.cos,true)} onClick={()=>go('estadoResultados',ymPrev,{bloque:'cos'})}/>,
              <KpiMes key='m' ic='tPct' tono='am' label='Comisiones' value={fmtShort(rm.com)} sub={dl(rm.com,rmAnt.com,true)} onClick={()=>go('estadoResultados',ymPrev,{bloque:'com'})}/>,
              <KpiMes key='r' ic='chart' tono={rm.res>=0?'gr':'ro'} label='Resultado' value={(rm.res>0?'+':'')+fmtShort(rm.res)} vcol={rm.res<0?C.overdueText:undefined} sub={rm.margen!=null?`margen ${pct1(rm.margen)} %`:undefined} onClick={()=>go('estadoResultados',ymPrev)}/>]}]}/>
          <Sec t='Detalle' extra={btnTodos(['ret','fac','cob','cos','com','deb','caj','rev'])}/>
          <div className='ps-g4' style={{display:'grid',gridTemplateColumns:'repeat(4,minmax(0,1fr))',gap:12}}>{['ret','fac','cob','cos','com','deb','caj','rev'].map(id=>tarjeta(id,true))}</div>
          {['ret','fac','cob','cos','com','deb','caj','rev'].filter(id=>lista.includes(id)).map(cuerpo)}
          <Sec t={bloques.soc.titulo} link={bloques.soc.link} onLink={()=>go(bloques.soc.dest)}/>
          <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>{tablaSocios}</div>
          <Sec t='Ingreso emitido' extra={btnTodos(['emi','ing','mm'])}/>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:12}}>{['emi','ing','mm'].map(id=>tarjeta(id,true))}</div>
          {['emi','ing','mm'].filter(id=>lista.includes(id)).map(cuerpo)}
        </>) : CAPS.map(([cap,ids])=>(
          <div key={cap} style={{display:'flex',flexDirection:'column',gap:8}}>
            <div style={{display:'flex',alignItems:'center',gap:10,margin:'4px 2px 0'}}><span style={{...SEC_LBL,flex:1}}>{cap}</span>{btnTodos(ids)}</div>
            {ids.map(id=>(<div key={id} style={{display:'flex',flexDirection:'column',gap:8}}>{tarjeta(id,false)}{lista.includes(id)&&cuerpo(id)}</div>))}
          </div>))}
      </div>
    </div>)
}
