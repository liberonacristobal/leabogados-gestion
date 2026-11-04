// Panel de socios — una sola página que reúne lo financiero para la reunión de socios. No calcula nada propio: cada cifra sale de la MISMA función que usa
// su pantalla de origen (hook del resultado del año de Inicio, Por socio, ciclo de Facturación, cartera, Socios, Estado de resultados, comisiones, flujo de caja…),
// de modo que coincide con ellas. Cada cifra y cada tarjeta es tocable y lleva a su detalle; «‹» vuelve al mismo punto (navTo/goBack del App).
import { useMemo } from 'react'
import { C, SEC_LBL, SIcon, fmtFechaDMY, useIsDesktop } from '../lib/base.jsx'
import { ADMIN_NAMES, PageHeader, SIN_SOCIO, _ymPrev, currentYear, fmtShort, fmtUFk, partidasPorSocio, porCobrarBills, resultadoMes, resumenCartera, saldoComisiones, saldosPorCliente, totalesFondos, ufFechaCache, useFlujoCaja, useNoEmitirSet, usePersistedState, usePorSocioFuentes, vendidoPorSocio, ventaUF } from '../lib/compartido.jsx'
import { kpisPorSocio } from '../lib/cifras.js'
import { pctsAnio, useResultadoAnio } from '../lib/resultadoAnio.js'
import { proyeccionCobranza } from './DashboardView.jsx'
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
const TONO_ANIO = { az:[C.azulBg,C.azulInfo,C.azulBd], am:[C.soonBg,C.soonText,C.avisoLine], gr:[C.greenBg,C.greenText,C.greenDeep], nt:[C.surface,C.accent,C.border] }
const KpiAnio = ({ic,tono='nt',label,value,sub,onClick,D}) => { const [bg,fg,bd]=TONO_ANIO[tono]; return (
  <div onClick={onClick} style={{background:bg,border:`1px solid ${bd}`,borderRadius:12,padding:D?'14px':'11px 10px',display:'flex',alignItems:'center',gap:12,cursor:onClick?'pointer':'default',minWidth:0}}>
    {D&&<span style={{width:34,height:34,borderRadius:8,background:tono==='nt'?C.bgSoft:'#fff',display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SIcon n={ic} s={17} c={fg}/></span>}
    <div style={{minWidth:0,flex:1}}>
      <div style={{fontSize:D?10.5:10,fontWeight:700,letterSpacing:.5,textTransform:'uppercase',color:fg,...DOS_LINEAS}}>{label}</div>
      <div style={{fontSize:D?26:19,fontWeight:800,letterSpacing:-.6,color:fg,marginTop:2,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{value}</div>
      {sub&&<div style={{fontSize:11,color:fg,opacity:.85,...DOS_LINEAS}}>{sub}</div>}
    </div>
  </div>) }
const Fila = ({tono='az',label,sub,value,vcol,onClick}) => { const [bg,fg]=TONO[tono]||TONO.az; return (
  <div onClick={onClick} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 12px',borderTop:`1px solid ${C.bgSoft}`,cursor:onClick?'pointer':'default'}}>
    <span style={{width:26,height:26,borderRadius:8,background:bg,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SIcon n='file' s={14} c={fg}/></span>
    <div style={{flex:1,minWidth:0}}><div style={{fontSize:12.5,fontWeight:600,color:C.text}}>{label}</div>{sub&&<div style={{fontSize:10.5,color:C.muted}}>{sub}</div>}</div>
    <span style={{fontSize:14,fontWeight:800,color:vcol||fg,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{value}</span>
  </div>) }
const KpiMes = ({ic,label,value,sub,vcol,onClick}) => (
  <div onClick={onClick} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:12,display:'flex',gap:10,alignItems:'center',cursor:onClick?'pointer':'default',minWidth:0}}>
    <span style={{width:30,height:30,borderRadius:8,background:C.bgSoft,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SIcon n={ic} s={16} c={C.muted}/></span>
    <div style={{minWidth:0,flex:1}}><div style={{fontSize:10.5,fontWeight:700,letterSpacing:.5,textTransform:'uppercase',color:C.accent,...DOS_LINEAS}}>{label}</div>
      <div style={{fontSize:20,fontWeight:800,letterSpacing:-.4,color:vcol||C.accent,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{value}</div>
      {sub&&<div style={{fontSize:11,color:C.muted,...DOS_LINEAS}}>{sub}</div>}</div>
  </div>)
// Título de sección fuera de la tarjeta (como en el resto de la app): etiqueta de acento a la izquierda; extra y enlace a la derecha.
const Sec = ({t,link,onLink,extra}) => (
  <div style={{display:'flex',alignItems:'center',gap:10,margin:'2px 2px -4px'}}>
    <span style={{...SEC_LBL,flex:1,minWidth:0,...ELIPSIS}}>{t}</span>{extra}
    {link&&<span onClick={onLink} style={{fontSize:11,fontWeight:700,color:C.accent,cursor:onLink?'pointer':'default',whiteSpace:'nowrap'}}>{link} ›</span>}
  </div>)
const ICO_BLQ = { mes:'chart', soc:'users', ret:'users', fac:'clock', cob:'tCobrar', cos:'building', com:'tPct', deb:'tPagar', caj:'wallet', rev:'alert' }
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
  const go = (d,x) => onGo&&onGo(d,x)
  const hoy = new Date().toISOString().slice(0,10), ymNow = hoy.slice(0,7), ymPrev = _ymPrev(ymNow)
  const mesPasado = MESES[Number(ymPrev.slice(5,7))-1], mesActual = MESES[Number(ymNow.slice(5,7))-1]
  const [moneda,setMoneda] = usePersistedState('panel_moneda','UF')
  const [abiertas,setAbiertas] = usePersistedState('panel_abiertas',[])
  const lista = Array.isArray(abiertas)?abiertas:[]
  const tog = id => setAbiertas(lista.includes(id)?lista.filter(x=>x!==id):[...lista,id])

  // ── Año: el MISMO hook de Inicio (lib/resultadoAnio.js) ──
  const R = useResultadoAnio({ sales, billing, terceros, costosOfiRows, expenses, clients, anticipos, selYear:currentYear })
  const { m, resAnio, ingresosPorAnioVenta:ing, comisPagadasAnioVenta:comP, metaCobranza, metaUF, ufRef, ufDias, fuRes } = R
  const ingYTD = ing.total||0, ingYTDUF = ing.totalUF||0
  const { ventaPct, factPct, cobroPct } = pctsAnio({ m, resAnio, metaUF, ingYTD, metaCobranza })
  const vMon = (uf,clp) => moneda==='UF' ? fmtUFk(Math.round(uf||0)) : fmtShort(clp)
  const mRes = (k,abs) => { const v=(moneda==='UF'?resAnio.verUF:resAnio.verCLP)[k]||0, x=abs?Math.abs(v):v; return moneda==='UF'?fmtUFk(x):fmtShort(x) }
  const pct1 = v => v==null?null:v.toLocaleString('es-CL',{minimumFractionDigits:1,maximumFractionDigits:1})

  // ── Mes pasado: resultadoMes (el mismo del Estado de resultados) y el cierre de facturas de Facturación ──
  const deps = { billing, terceros, costosOfiRows, expenses, clients }
  const rm = useMemo(()=>resultadoMes(fuRes, deps, ymPrev),[fuRes,billing,terceros,costosOfiRows,expenses,clients,ymPrev])
  const noEmitir = useNoEmitirSet()
  const ciclo = useMemo(()=>cicloFacturacionMes({ billing, sales, anticipos, fantasmaIds:fantasmaIds||new Set(), noEmitir:noEmitir||new Set(), respaldoMap, uf:ufFechaCache()||{}, now:new Date() }),[billing,sales,anticipos,fantasmaIds,noEmitir,respaldoMap])

  // ── Por socio y retiros ──
  const [fu] = usePorSocioFuentes()
  const P = useMemo(()=>partidasPorSocio({ billing, sales, clients, anticipos, terceros, expenses, ic:fu.ic, ia:fu.ia, ov:fu.ov, fondoExtra:{} }),[billing,sales,clients,anticipos,terceros,expenses,fu])
  const V = useMemo(()=>vendidoPorSocio(sales, clients, ufRef, currentYear),[sales,clients,ufRef])
  const { card6 } = useMemo(()=>kpisPorSocio({ P, V, ym:ymNow }),[P,V,ymNow])
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
  const antDisp = (anticipos||[]).filter(a=>a.estado==='disponible').reduce((s,a)=>s+(a.monto||0),0)
  const flujo = useFlujoCaja({ billing, terceros, costosOfiRows, anticipos, expenses, clients, sales, fantasmaIds })
  const proy = useMemo(()=>proyeccionCobranza(flujo).total,[flujo])
  const props = (sales||[]).filter(s=>s&&!s.deleted_at&&s.status==='Propuesta')
  const propUF = props.reduce((a,s)=>a+ventaUF(s,ufRef),0)

  // ── Por revisar: pendientes financieros por abogado (la misma regla de «Revisar cuentas») ──
  const abogados = ADMIN_NAMES
  const pendDe = a => pendCli ? nClientesConPendientes(pendCli, clients, a, norm) : 0
  const nDatos = pendCli ? [...pendCli.values()].reduce((a,g)=>a+(g.items||[]).filter(i=>i.tipo==='datos').length,0) : 0

  // ── Bloques ──
  const sociosFilas = [...ADMIN_NAMES, SIN_SOCIO, null]
  const tonoSoc = s => s===ADMIN_NAMES[0]?'az':s===ADMIN_NAMES[1]?'am':s===SIN_SOCIO?'am':'gy'
  const tablaSocios = (
    <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:12.5,fontVariantNumeric:'tabular-nums',minWidth:330}}>
      <thead><tr>{['Socio','Vendido','Facturado','Cobrado','Ingreso real'].map((h,i)=><th key={h} style={{padding:isDesktop?'8px 14px':'8px 10px',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:.5,color:C.accent,background:C.bgSoft,textAlign:i?'right':'left'}}>{h}</th>)}</tr></thead>
      <tbody>{sociosFilas.map(s=>{ const v=card6(s,'ytd'), tot=s===null; return (
        <tr key={s||'ofi'} onClick={()=>go('porSocio')} style={{cursor:'pointer',background:tot?C.bgSoft:undefined,fontWeight:tot?800:400}}>
          <td style={{padding:isDesktop?'8px 14px':'8px 10px',borderTop:tot?`1.5px solid ${C.accent}`:`1px solid ${C.bgSoft}`,fontWeight:tot?800:600,color:tot?C.accent:C.text}}>{tot?'Oficina':s}</td>
          {[0,1,2,5].map(i=><td key={i} style={{padding:isDesktop?'8px 14px':'8px 10px',borderTop:tot?`1.5px solid ${C.accent}`:`1px solid ${C.bgSoft}`,textAlign:'right',color:tot?C.accent:undefined}}>{fmtShort(v[i])}</td>)}
        </tr>) })}</tbody>
    </table></div>)
  const bloques = {
    mes: { cap:'Resultado', titulo:`Cierre de ${mesPasado}`, hl:<>Resultado <b style={{color:rm.res>=0?C.greenText:C.overdueText}}>{(rm.res>0?'+':'')+fmtShort(rm.res)}</b></>, tono:'gr', link:'Informe y comparación', dest:'informeMes',
      body:<>
        <Fila tono='az' label='Ingresos del mes' sub='Estado de resultados' value={fmtShort(rm.ing)} onClick={()=>go('estadoResultados')}/>
        <Fila tono='az' label='Costos de oficina' value={fmtShort(rm.cos)} onClick={()=>go('estadoResultados')}/>
        <Fila tono='am' label='Comisiones pagadas' value={fmtShort(rm.com)} onClick={()=>go('estadoResultados')}/>
        <Fila tono={rm.res>=0?'gr':'ro'} label='Resultado' sub={rm.margen!=null?`margen ${pct1(rm.margen)} %`:undefined} value={(rm.res>0?'+':'')+fmtShort(rm.res)} onClick={()=>go('estadoResultados')}/>
        <Fila tono='az' label={`Facturas de ${mesPasado}`} sub={`${ciclo.emi.length} emitidas · ${ciclo.tasa} % pagado`} value={fmtShort(ciclo.tEmi)} onClick={()=>go('cierreMes')}/>
      </> },
    soc: { cap:'Resultado', titulo:`Por socio · ${mesActual==='enero'?'enero':'enero–'+mesActual}`, tM:`Por socio · ${mesActual==='enero'?'ene':'ene–'+mesActual.slice(0,3)}`, hl:<>{ADMIN_NAMES.map((s,i)=><span key={s}>{i?' · ':''}{isDesktop?s:s.slice(0,1)} <b>{fmtShort(card6(s,'ytd')[5])}</b></span>)}</>, tono:'az', link:'Por socio', dest:'porSocio', body:tablaSocios },
    ret: { cap:'Resultado', titulo:'Retiros de socios', hl:<><b style={{color:C.tealText}}>{fmtShort(ret.retTot[ret.A]||0)}</b> · <b style={{color:C.tealText}}>{fmtShort(ret.retTot[ret.B]||0)}</b></>, tono:'te', link:'Socios', dest:'socios',
      body:<>{ret.SOC.map(s=><Fila key={s} tono='te' label={s} sub={`${ret.retN[s]||0} retiro${(ret.retN[s]||0)!==1?'s':''}`} value={fmtShort(ret.retTot[s]||0)} onClick={()=>go('socios')}/>)}
        <Fila tono='te' label='Diferencia' sub={ret.difAcum===0?'al día':`falta ${ret.difAcum>0?ret.B:ret.A}`} value={fmtShort(Math.abs(ret.difAcum))} onClick={()=>go('socios')}/></> },
    fac: { cap:'Facturación y cobranza', capCorto:'Fact. y cobranza', titulo:'Por facturar', hl:<>Por emitir <b style={{color:C.soonText}}>{fmtShort(ciclo.pemTot)}</b></>, tono:'am', link:'Facturación', dest:'facturas',
      body:<>
        <Fila tono='am' label={`Por emitir en ${mesActual}`} sub={`${ciclo.pemN} cuota${ciclo.pemN!==1?'s':''}`} value={fmtShort(ciclo.pemTot)} onClick={()=>go('facturas')}/>
        <Fila tono='ro' label='Cuotas vencidas sin facturar' sub={`${ciclo.sinEmitirN} cuota${ciclo.sinEmitirN!==1?'s':''}`} value={fmtShort(ciclo.sumM(ciclo.sinEmitirCands))} onClick={()=>go('sinEmitir')}/>
        <Fila tono='az' label='Por enviar al cliente' sub={`${ciclo.porEnviar.length} factura${ciclo.porEnviar.length!==1?'s':''}`} value={fmtShort(ciclo.porEnvTot)} onClick={()=>go('facturas')}/>
        <Fila tono='az' label='Propuestas por cerrar' sub={`${props.length} propuesta${props.length!==1?'s':''}`} value={fmtUFk(Math.round(propUF))} onClick={()=>go('ventas')}/>
      </> },
    cob: { cap:'Facturación y cobranza', capCorto:'Fact. y cobranza', titulo:'Por cobrar', hl:<>Vencido <b style={{color:C.overdueText}}>{fmtShort(cart.vencidoTot)}</b></>, tono:'az', link:'Cobranza', dest:'cobranza',
      body:<>
        <Fila tono='az' label='Honorarios por cobrar' value={fmtShort(porCobrar)} onClick={()=>go('cobranza')}/>
        <Fila tono='ro' label='Vencido' sub={porCobrar>0?`${Math.round(cart.vencidoTot/porCobrar*100)} % de lo por cobrar`:undefined} value={fmtShort(cart.vencidoTot)} onClick={()=>go('cobranza')}/>
        <Fila tono='ro' label='Más de 60 días' sub={cart.expo.pctM60!=null?`${Math.round(cart.expo.pctM60*100)} % de la cartera`:undefined} value={fmtShort(cart.expo.m60)} onClick={()=>go('cobranza')}/>
        {cart.expo.mayor&&<Fila tono='az' label='Mayor deudor' sub={mayorCli?.name} value={fmtShort(cart.expo.mayor.saldo)} onClick={()=>mayorCli&&go('cliente',mayorCli.id)}/>}
        <Fila tono='am' label='Gastos por cobrar a clientes' sub={`${fondos.nDeben} cliente${fondos.nDeben!==1?'s':''} · pagados por la oficina, sin fondos`} value={fmtShort(fondos.porReponer)} onClick={()=>go('gastos')}/>
      </> },
    cos: { cap:'Costos y pagos', capCorto:'Costos y pagos', titulo:'Costos de oficina', hl:<>{mesPasado.slice(0,3)} <b>{fmtShort(rm.cos)}</b></>, tono:'az', link:'Estado de resultados', dest:'estadoResultados',
      body:<>
        <Fila tono='az' label={`Costos de ${mesPasado}`} sub={`año a la fecha ${fmtShort(resAnio.cos)}`} value={fmtShort(rm.cos)} onClick={()=>go('estadoResultados')}/>
        {(rm.cosLines||[]).map(l=><Fila key={l.k} tono='az' label={l.l} value={fmtShort(l.m)} onClick={()=>go('estadoResultados')}/>)}
        {rm.ppm>0&&<Fila tono='az' label='PPM' sub='aparte de los costos' value={fmtShort(rm.ppm)} onClick={()=>go('estadoResultados')}/>}
      </> },
    com: { cap:'Costos y pagos', capCorto:'Costos y pagos', titulo:'Comisiones', hl:<>Pagadas {currentYear} <b style={{color:C.greenText}}>{fmtShort(comP.total||0)}</b></>, tono:'gr', link:'Comisiones', dest:'proveedores',
      body:<>
        <Fila tono='gr' label={`Pagadas en ${mesPasado}`} value={fmtShort(rm.com)} onClick={()=>go('proveedores')}/>
        <Fila tono='gr' label={`Pagadas ${currentYear}`} value={fmtShort(comP.total||0)} onClick={()=>go('proveedores')}/>
        <Fila tono='gr' label={`Percibidas ${currentYear}`} sub='nos pagan a nosotros' value={fmtShort(ing.percibidas||0)} onClick={()=>go('proveedores')}/>
        <Fila tono='az' label='Sujetas a cobro' sub='el cliente aún no paga' value={fmtShort(sc.porDevengar)} onClick={()=>go('proveedores')}/>
      </> },
    deb: { cap:'Costos y pagos', capCorto:'Costos y pagos', titulo:'Por pagar', hl:<>Comisiones <b style={{color:C.soonText}}>{fmtShort(sc.porPagar)}</b></>, tono:'am', link:'Comisiones', dest:'proveedores',
      body:<>
        <Sub t='A terceros'/>
        <Fila tono='am' label='Comisiones por pagar' sub={diasCom!=null?`la más antigua, hace ${diasCom} días`:undefined} value={fmtShort(sc.porPagar)} onClick={()=>go('proveedores')}/>
        <Fila tono='am' label='Notaría por transferir' sub={nota.montoEsperan>0?`esperan fondos del cliente ${fmtShort(nota.montoEsperan)}`:undefined} value={fmtShort(nota.montoPagables)} onClick={()=>go('gastos')}/>
        <Sub t='Fondos de clientes'/>
        <Fila tono='te' label='Fondos de clientes' sub={`${fondos.nFavor} cliente${fondos.nFavor!==1?'s':''} · provisión de gastos`} value={fmtShort(fondos.aFavor)} onClick={()=>go('gastos')}/>
        <Fila tono='te' label='Anticipos disponibles' sub='a favor de clientes' value={fmtShort(antDisp)} onClick={()=>go('facturas')}/>
        <Fila tono='gy' label='Compras a proveedores, IVA y caja chica' sub='ver en Oficina' value='›' vcol={C.azulInfo} onClick={()=>go('oficina')}/>
      </> },
    caj: { cap:'Caja y revisión', capCorto:'Caja y revisión', titulo:'Caja', hl:<>Flujo <b style={{color:flujo.fin>=0?C.greenText:C.overdueText}}>{(flujo.fin>0?'+':'')+fmtShort(flujo.fin)}</b></>, tono:'az', link:'Flujo de caja', dest:'flujoCaja',
      body:<>
        <Fila tono={flujo.fin>=0?'gr':'ro'} label='Flujo de caja' sub='neto · 8 semanas' value={(flujo.fin>0?'+':'')+fmtShort(flujo.fin)} onClick={()=>go('flujoCaja')}/>
        <Fila tono='az' label='Proyección de cobranza' sub={`al ${fmtFechaDMY(`${currentYear}-12-31`)}`} value={fmtShort(proy)} onClick={()=>go('flujoCaja')}/>
        <Fila tono='am' label='Por identificar en el banco' sub='abonos sin conciliar del año' value={fmtShort(ing.porIdentificar||0)} onClick={()=>go('conciliacion')}/>
      </> },
    rev: { cap:'Caja y revisión', capCorto:'Caja y revisión', titulo:'Por revisar', hl:<>{abogados.map((a,i)=><span key={a}>{i?' · ':''}{a} <b style={{color:C.tealText}}>{pendDe(a)}</b></span>)}</>, tono:'te', link:'Clientes', dest:'clientes',
      body:<>
        {abogados.map(a=><Fila key={a} tono='te' label={`Pendientes financieros · ${a}`} sub='clientes con algo por resolver' value={String(pendDe(a))} onClick={()=>go('revisarCuentas',a)}/>)}
        <Fila tono='am' label='Datos por corregir' sub='anuladas sin motivo y otros' value={String(nDatos)} onClick={()=>go('revisarCuentas')}/>
      </> },
  }
  const CAPS = [['Resultado',['mes','soc','ret']],['Facturación y cobranza',['fac','cob']],['Costos y pagos',['cos','com','deb']],['Caja y revisión',['caj','rev']]]
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
      <KpiAnio D={isDesktop} ic='chart' tono='az' label='Vendido' value={vMon(m.brutoUF,m.bruto)} sub={m.meta>0?`${ventaPct} % de la meta`:undefined} onClick={()=>go('resultadoAnio')}/>
      <KpiAnio D={isDesktop} ic='file' tono='am' label='Facturado' value={mRes('fac')} sub={m.bruto>0?`${factPct} % de lo vendido`:undefined} onClick={()=>go('resultadoAnio')}/>
      <KpiAnio D={isDesktop} ic='check' tono='gr' label='Cobrado' value={vMon(ingYTDUF,ingYTD)} sub={metaCobranza>0?`${cobroPct} % de la meta`:undefined} onClick={()=>go('resultadoAnio')}/>
      {resAnio.ing>0&&<KpiAnio D={isDesktop} ic='tPct' tono='nt' label='Margen' value={(resAnio.res<0?'−':'')+mRes('res',true)} sub={resAnio.pct!=null?`${pct1(resAnio.pct)} % de ingresos`:undefined} onClick={()=>go('resultadoAnio')}/>}
    </div>
  </>)
  const fecha = fmtFechaDMY(hoy)
  const resColor = rm.res>=0?C.greenText:C.overdueText
  return (
    <div style={{maxWidth:1120,margin:'0 auto',padding:isDesktop?'0 20px 40px':'0 14px 40px'}}>
      <PageHeader origen={backLabel} onBack={onBack} titulo='Panel de socios' ctx={isDesktop?`datos al ${fecha}`:undefined}/>
      <div style={{display:'flex',flexDirection:'column',gap:isDesktop?12:10,marginTop:isDesktop?12:6}}>
        {ano}
        {isDesktop ? (<>
          <Sec t={bloques.mes.titulo} link={bloques.mes.link} onLink={()=>go(bloques.mes.dest)}/>
          <div style={{display:'grid',gridTemplateColumns:'repeat(5,minmax(0,1fr))',gap:12}}>
            <KpiMes ic='tEntra' label='Ingresos' value={fmtShort(rm.ing)} sub='del mes' onClick={()=>go('estadoResultados')}/>
            <KpiMes ic='building' label='Costos' value={fmtShort(rm.cos)} sub='de oficina' onClick={()=>go('estadoResultados')}/>
            <KpiMes ic='tPct' label='Comisiones' value={fmtShort(rm.com)} sub='pagadas' onClick={()=>go('estadoResultados')}/>
            <KpiMes ic='chart' label='Resultado' value={(rm.res>0?'+':'')+fmtShort(rm.res)} vcol={resColor} sub={rm.margen!=null?`margen ${pct1(rm.margen)} %`:undefined} onClick={()=>go('estadoResultados')}/>
            <KpiMes ic='file' label='Facturas' value={fmtShort(ciclo.tEmi)} sub={`${ciclo.emi.length} · ${ciclo.tasa} % pagado`} onClick={()=>go('cierreMes')}/>
          </div>
          <Sec t='Detalle'/>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,minmax(0,1fr))',gap:12}}>{['ret','fac','cob','cos','com','deb','caj','rev'].map(id=>tarjeta(id,true))}</div>
          {['ret','fac','cob','cos','com','deb','caj','rev'].filter(id=>lista.includes(id)).map(cuerpo)}
          <Sec t={bloques.soc.titulo} link={bloques.soc.link} onLink={()=>go(bloques.soc.dest)}/>
          <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>{tablaSocios}</div>
        </>) : CAPS.map(([cap,ids])=>(
          <div key={cap} style={{display:'flex',flexDirection:'column',gap:8}}>
            <div style={{...SEC_LBL,margin:'4px 2px 0'}}>{cap}</div>
            {ids.map(id=>(<div key={id} style={{display:'flex',flexDirection:'column',gap:8}}>{tarjeta(id,false)}{lista.includes(id)&&cuerpo(id)}</div>))}
          </div>))}
      </div>
    </div>)
}
