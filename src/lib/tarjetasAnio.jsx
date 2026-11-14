// Tarjetas del resultado (Vendido, Facturado, Cobrado, Resultado): el mismo molde de Inicio y del Panel de socios, compartido para que Oficina no lo copie.
// Con `pct`/`cap` muestra «% de la meta»; con `sub` una línea libre (la comparación contra el mes anterior).
import { C, SEC_LBL } from './base.jsx'
import { BrutoNetoPill } from './compartido.jsx'

const DOS_LINEAS = {display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden',lineHeight:1.25}
export const TONO_ANIO = { az:[C.azulBg,C.azulBd,'#fff',C.azulInfo], am:[C.soonBg,C.avisoLine,'#fff',C.soonText], gr:[C.greenBg,C.greenDeep,'#fff',C.greenText], nt:[C.surface,C.border,C.bgSoft,C.accent] }
// Mismos íconos que los tiles de Inicio (DashboardView): tendencia, documento, billete y margen.
const ICO_ANIO = {
  chart:<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/></svg>,
  file:<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
  check:<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/></svg>,
  tPct:<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>,
}
export const KpiAnio = ({ic,tono='nt',label,value,dual,chip,pct,cap,sub,onClick,D,activo}) => { const [bg,bd,icoBg,fg]=TONO_ANIO[tono]; return (
  <div onClick={onClick} style={{background:bg,border:`1px solid ${activo?C.accent:bd}`,boxShadow:activo?`0 0 0 1px ${C.accent} inset`:'none',borderRadius:12,padding:D?'14px':'12px 10px',minHeight:D?undefined:86,boxSizing:'border-box',position:'relative',display:'flex',alignItems:'center',gap:D?12:9,cursor:onClick?'pointer':'default',minWidth:0}}>
    <span style={{width:D?34:30,height:D?34:30,borderRadius:8,background:icoBg,color:fg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{ICO_ANIO[ic]}</span>
    <div className='kpi-col' style={{minWidth:0,flex:1,containerType:'inline-size'}}>
      {(dual||chip)&&!D?<div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:4}}><span style={{...SEC_LBL,fontSize:12,lineHeight:1.25}}>{label}</span>{dual?<BrutoNetoPill princ={dual.props.princ} onAlt={dual.props.onAlt}/>:<BrutoNetoPill etiqueta={chip.etiqueta} otra={chip.otra} onAlt={chip.onAlt}/>}</div>:<div style={{...SEC_LBL,fontSize:D?13:12,...DOS_LINEAS}}>{label}</div>}
      {dual||<div style={{fontSize:D?26:20,fontWeight:800,letterSpacing:'-.6px',lineHeight:1.05,color:C.accent,marginTop:3,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{value}</div>}
      {chip&&D&&<BrutoNetoPill etiqueta={chip.etiqueta} otra={chip.otra} onAlt={chip.onAlt} style={{position:'absolute',top:8,right:8,padding:'1px 7px'}}/>}
      {pct!=null&&<div style={{fontSize:11,color:C.muted,marginTop:3,...DOS_LINEAS}}><b style={{color:Number(pct)>100?C.greenText:C.accent,fontWeight:800}}>{Number(pct)>100?`+${Number(pct)-100}`:pct} %</b> {cap}</div>}
      {sub!=null&&<div style={{fontSize:11,color:C.muted,marginTop:3,...DOS_LINEAS}}>{sub}</div>}
    </div>
  </div>) }
