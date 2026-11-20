// Oficina: la vista financiera y de gestión de la oficina, en UNA sola página (Finanzas, Gestión y Socios), con selector Año | Mes.
// No calcula nada propio: cada cifra sale de la misma función que usa su pantalla de origen (hook del resultado del año de Inicio, resultadoMes, flujo de caja,
// cartera, comisiones, por socio), así que coincide con ellas. Arriba, fijas, las cuatro tarjetas (Vendido, Facturado, Cobrado, Resultado); en el año, tocar una
// abre su detalle como página (el mismo de Inicio) y las cuatro siguen a la vista. Maqueta aprobada 2026-11-14.
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase, DEMO } from '../supabase'
import { C, Gl, SEC_LBL, SIcon, BtnDescarga, fmtFechaDMY, useIsDesktop } from '../lib/base.jsx'
import { ADMIN_NAMES, SIN_SOCIO, _ymPrev, currentYear, cargarProcesos, cobradoBill, esSubarriendo, estadoProceso, fmtMill, fmtShort, fmtUFk, partidasPorSocio, porCobrarBills, resultadoMes, costoSociosAnio, resumenCartera, saldoComisiones, useCalTrib, useFlujoCaja, usePersistedState, usePorSocioFuentes, vendidoPorSocio, ventaCLP, ventaUF, _DEMO_BANDEJA, CifrasBrutoNeto } from '../lib/compartido.jsx'
import { kpisPorSocio, cascadaVendido } from '../lib/cifras.js'
import { KpiAnio, FilasKpi } from '../lib/tarjetasAnio.jsx'
import { pctsAnio, useResultadoAnio, ingresoRealAnio } from '../lib/resultadoAnio.js'
import { proyeccionCobranza, ResDrillPanel } from './DashboardView.jsx'
import { retirosSocios } from './SociosView.jsx'
import { comisionesACobrar } from './ProveedoresView.jsx'
import { nombreComponente } from '../../supabase/functions/_shared/presupuesto.js'
import { descargarXlsx } from '../lib/seleccionLote.jsx'
import { useMesEnMarcha } from './MesEnMarchaView.jsx'
import { diasDeCobroFacturas } from '../../supabase/functions/_shared/diasCobro.js'

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
const MCORTO = MESES.map(m => m.slice(0, 3))
const pad = n => String(n).padStart(2, '0')
const margenPct = (res, ing) => ing > 0 ? res / ing * 100 : null
const pct1 = v => v == null ? null : v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

// Tarjeta chica (la misma forma para todas las hermanas): etiqueta, cifra y una línea de apoyo. `er` = gris suave (Estado de resultados); `dest` = azul suave (la que se mira primero).
const Tl = ({ label, value, sub, vcol, er, dest, onClick, ic, tint, col }) => (
  <div onClick={onClick} className='pv-c' style={{ background: er ? C.border : dest ? C.azulBg : C.card, border: `1px solid ${dest ? C.azulBd : C.border}`, borderRadius: 12, padding: '10px 12px', minWidth: 0, boxSizing: 'border-box', cursor: onClick ? 'pointer' : 'default', display: ic ? 'flex' : 'block', alignItems: 'center', gap: 10 }}>
    {ic && <span style={{ width: 32, height: 32, borderRadius: 8, background: tint, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><SIcon n={ic} s={16} c={col} /></span>}
    <div style={{ minWidth: 0, flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, ...SEC_LBL, fontSize: 10, letterSpacing: .5, ...(ic ? { whiteSpace: 'normal', lineHeight: 1.2 } : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }) }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 800, color: vcol || C.accent, letterSpacing: -.4, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', marginTop: 1 }}>{value}</div>
      <div style={{ fontSize: 10.5, color: C.textSoft, minHeight: 14, lineHeight: 1.25, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{sub}</div>
    </div>
  </div>)

// Tarjeta de sección de la portada: ícono a la izquierda, rótulo, cifra y apoyo a su derecha; debajo, las partidas que la forman. Misma forma para las cuatro hermanas.
const SecCard = ({ ic, tint, col, t, v, vcol, s, rows, onClick, D }) => (
  <div onClick={onClick} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: D ? '14px' : '12px 10px', cursor: 'pointer', minWidth: 0, boxSizing: 'border-box' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: D ? 12 : 9, minWidth: 0 }}>
      <span style={{ width: D ? 34 : 30, height: D ? 34 : 30, borderRadius: 8, background: tint, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><SIcon n={ic} s={16} c={col} /></span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ ...SEC_LBL, fontSize: D ? 13 : 12 }}>{t}</div>
        <div style={{ fontSize: D ? 26 : 20, fontWeight: 800, color: vcol || C.accent, letterSpacing: -.6, lineHeight: 1.05, marginTop: 3, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{v}</div>
        {s && <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{s}</div>}
      </div>
      <span style={{ color: C.muted, fontSize: 16, alignSelf: 'flex-start' }}>›</span>
    </div>
    {rows && rows.length > 0 && <FilasKpi rows={rows} D={D} />}
  </div>)

export function OficinaView({ backRef, sales = [], billing = [], clients = [], terceros = [], proveedores = [], expenses = [], anticipos = [], costosOfiRows = [], fantasmaIds = null, nPendCuentas = 0, onGo }) {
  const isDesktop = useIsDesktop()
  const go = (d, x, y) => onGo && onGo(d, x, y)
  const hoy = new Date().toISOString().slice(0, 10), ymNow = hoy.slice(0, 7), year = currentYear, curM = Number(ymNow.slice(5, 7))
  const [modo, setModo] = useState('anio')
  const [selM, setSelM] = useState(curM)
  const [moneda, setMoneda] = usePersistedState('oficina_moneda', 'CLP')
  const [vendPrinc, setVendPrinc] = usePersistedState('d_vend_princ', 'bruto')   // misma elección que en Inicio
  const [cobPrinc, setCobPrinc] = usePersistedState('d_cob_princ', 'propio')
  const [drill, setDrill] = useState(null)   // {tile:'vend'|'fact'|'cob'|'marg'}: detalle del año como página, con las cuatro tarjetas a la vista
  const ymSel = `${year}-${pad(selM)}`, ymP = _ymPrev(ymSel)
  const esMes = modo === 'mes'

  // ── Año: el MISMO hook de Inicio y del Panel (lib/resultadoAnio.js) ──
  const R = useResultadoAnio({ sales, billing, terceros, costosOfiRows, expenses, clients, anticipos, selYear: year })
  const { m, resAnio, ingresosPorAnioVenta: ing, comisPagadasAnioVenta: comP, metaCobranza, metaUF, ufRef, fuRes, vendidoMes } = R
  const ingYTD = ing.total || 0, ingYTDUF = ing.totalUF || 0
  const ingRealA = ingresoRealAnio(ing, comP)
  const { ventaPct, ventaNetoPct, factPct, cobroPct, cobroRealPct } = pctsAnio({ m, resAnio, metaUF, ingYTD, metaCobranza, ingReal: ingRealA.clp })
  const vMon = (uf, clp) => moneda === 'UF' ? fmtUFk(Math.round(uf || 0)) : fmtShort(clp)
  const mRes = (k, abs) => { const v = (moneda === 'UF' ? resAnio.verUF : resAnio.verCLP)[k] || 0, x = abs ? Math.abs(v) : v; return moneda === 'UF' ? fmtUFk(x) : fmtShort(x) }

  // ── Mes: resultadoMes (el mismo del Estado de resultados) contra el mes anterior ──
  const deps = { billing, terceros, costosOfiRows, expenses, clients }
  const rm = useMemo(() => resultadoMes(fuRes, deps, ymSel), [fuRes, billing, terceros, costosOfiRows, expenses, clients, ymSel])
  const rp = useMemo(() => resultadoMes(fuRes, deps, ymP), [fuRes, billing, terceros, costosOfiRows, expenses, clients, ymP])
  const vend = ymX => { const v = vendidoMes(ymX); return { uf: v.brutoUF, clp: v.bruto, v } }   // Vendido bruto del mes y sus partes (costos de terceros y neto) de la misma función del año
  const vM = vend(ymSel), vP = vend(ymP)
  const cobM = { clp: ing.byMonth?.[ymSel] || 0, uf: ing.byMonthUF?.[ymSel] || 0 }
  const cobP = ymP.slice(0, 4) === String(year) ? { clp: ing.byMonth?.[ymP] || 0, uf: ing.byMonthUF?.[ymP] || 0 } : null
  const mesPrev = MCORTO[Number(ymP.slice(5, 7)) - 1]
  const cierre = fmtFechaDMY(`${selM === 12 ? year + 1 : year}-${pad(selM === 12 ? 1 : selM + 1)}-15`)
  // Variación contra el mes anterior: flecha y color según su efecto (subir un costo es rojo; subir un ingreso, verde).
  const dl = (v, p, fmt, costo) => { if (p == null) return undefined; const d = v - p; if (Math.abs(d) < 1) return `igual que ${mesPrev}`; const bueno = costo ? d < 0 : d > 0; return <span style={{ color: bueno ? C.greenText : C.overdueText, fontWeight: 700 }}><Gl n={d > 0 ? 'arrowUp' : 'arrowDown'} /> {fmt(Math.abs(d))} vs {mesPrev}</span> }
  const fMon = (clp, uf) => moneda === 'UF' ? fmtUFk(Math.round(uf)) : fmtShort(clp)
  const dMon = (v, p, ufV, ufP, costo) => dl(moneda === 'UF' ? ufV : v, p == null ? null : (moneda === 'UF' ? ufP : p), x => moneda === 'UF' ? fmtUFk(Math.round(x)) : fmtShort(x), costo)

  // ── Por resolver ──
  const { cal: calTrib } = useCalTrib(expenses)
  const [procsN, setProcsN] = useState(null), [bandN, setBandN] = useState(null)
  useEffect(() => { let v = true; cargarProcesos().then(d => { if (v && d && d.length) setProcsN({ total: d.length, falla: d.filter(p => estadoProceso(p).k === 'falla').length }) }, () => {}); return () => { v = false } }, [])
  useEffect(() => { if (DEMO) { setBandN(_DEMO_BANDEJA.filter(r => r.estado === 'pendiente' || r.estado === 'sospechoso').length); return } let v = true; supabase.from('agente_bandeja').select('id', { count: 'exact', head: true }).in('estado', ['pendiente', 'sospechoso']).then(({ count }) => { if (v && count != null) setBandN(count) }, () => {}); return () => { v = false } }, [])
  const nA = calTrib ? calTrib.alertas.length : 0

  // ── Caja y cobranza (saldo vivo: no cambia con el período) ──
  const flujo = useFlujoCaja({ billing, terceros, costosOfiRows, anticipos, expenses, clients, sales, fantasmaIds })
  const proy = useMemo(() => proyeccionCobranza(flujo).total, [flujo])
  const mesM = useMesEnMarcha({ ym: ymNow, expenses, clients, billing, sales, terceros, costosOfiRows, anticipos })
  const sc = useMemo(() => saldoComisiones(terceros, billing), [terceros, billing])
  // Por percibir: misma regla de la vista Comisiones (comisionesACobrar, facturas del año sin cobrar, todos los proveedores).
  const comCobrar = useMemo(() => (proveedores || []).reduce((a, p) => a + comisionesACobrar(p, terceros, billing, year).items.filter(x => !x.cob && String(x.b.issued_at || x.b.due || '').slice(0, 4) === String(year)).reduce((z, x) => z + x.monto, 0), 0), [proveedores, terceros, billing, year])
  const diasCom = sc.porPagarDesde ? Math.round((Date.now() - new Date(sc.porPagarDesde + 'T12:00').getTime()) / 86400000) : null
  const porCobrar = porCobrarBills(billing)
  const cart = useMemo(() => resumenCartera(billing), [billing])
  const totPorCobrar = porCobrar, venc = cart.vencidoTot
  const fin = flujo.fin
  // Días de cobro PONDERADOS por monto: la misma función del Presupuesto (diasDeCobroFacturas, diasCobro.js).
  const dCobro = useMemo(() => diasDeCobroFacturas(billing, year), [billing, year])
  const sinMov = !(mesM.cobrado || mesM.pagado || mesM.porPagar)
  const memTxt = sinMov ? 'Sin movimientos' : (mesM.actual && mesM.cas.falta > 0 ? 'Faltan ' + fmtMill(mesM.cas.falta) : mesM.cas.cubrePagados ? 'Cubierto' : 'Sin cubrir')
  const memCol = sinMov ? C.accent : (mesM.actual && mesM.cas.falta > 0 ? C.soonText : mesM.cas.cubrePagados ? C.greenText : C.overdueText)

  // ── Presupuesto del año siguiente: estado real de su borrador (tabla presupuestos) ──
  const [ppto, setPpto] = useState(null)
  useEffect(() => { if (DEMO) { setPpto({ borrador: true, meta: { ancla: 'ventas', valor: 780000000 }, actualizado: hoy, oficial: null }); return } let v = true
    supabase.from('presupuestos').select('tipo,oficial,nombre,updated_at,created_at,metas:estado->metas').eq('anio', year + 1).then(({ data }) => { if (!v) return
      const b = (data || []).find(r => r.tipo === 'borrador'), of = (data || []).find(r => r.oficial)
      setPpto({ borrador: !!b, meta: b && b.metas && Number(b.metas.valor) > 0 ? { ancla: b.metas.ancla, valor: Number(b.metas.valor) } : null, actualizado: b ? String(b.updated_at || b.created_at).slice(0, 10) : null, oficial: of ? { nombre: of.nombre || 'Versión oficial' } : null }) }, () => {}); return () => { v = false } }, [year])

  // ── Socios (misma regla que el Panel de socios: lo vendido, cobrado e ingreso real por socio) ──
  const [fu] = usePorSocioFuentes()
  const P = useMemo(() => partidasPorSocio({ billing, sales, clients, anticipos, terceros, expenses, ic: fu.ic, ia: fu.ia, ov: fu.ov, fondoExtra: {} }), [billing, sales, clients, anticipos, terceros, expenses, fu])
  const V = useMemo(() => vendidoPorSocio(sales, clients, ufRef, year, null, { terceros, billing }), [sales, clients, ufRef, terceros, billing])
  const { card6, ticket, margen } = useMemo(() => kpisPorSocio({ P, V, ym: ymNow }), [P, V, ymNow])
  const RS = useMemo(() => retirosSocios({ expenses, clients, socios: [], yr: year }), [expenses, clients, year])   // la misma fuente de la página Socios: retiros y sueldos de los socios
  // Sueldos de socios = costo empresa (sueldo líquido, impuesto único y cotizaciones), la misma regla del Estado de resultados; sin planilla cargada queda el líquido del banco.
  const CE = useMemo(() => costoSociosAnio(fuRes, { billing, terceros, costosOfiRows, expenses, clients }, year, curM), [fuRes, billing, terceros, costosOfiRows, expenses, clients])
  const usaCE = CE.total > 0, sueldoVal = usaCE ? CE.total : RS.sueldoTot, sueldoDe = s => usaCE ? (CE.por[s]?.total || 0) : (RS.sueldos[s] || 0), liquidoDe = s => usaCE ? (CE.por[s]?.liquido || 0) : (RS.sueldos[s] || 0)
  const aFavor = RS.totalRet + sueldoVal, mesesComp = Math.max(0, curM - 1)
  // Participación de cada socio en el total de los dos: su retribución sobre la retribución de socios, y su ingreso real sobre el ingreso real de los socios (cada par suma 100 %).
  const totRetrib = RS.SOC.reduce((a, x) => a + (RS.retTot[x] || 0) + sueldoDe(x), 0), totIngReal = RS.SOC.reduce((a, x) => a + (card6(x, 'ytd')[5] || 0), 0)
  const promDe = s => mesesComp > 0 ? Math.round(((RS.retTot[s] || 0) + sueldoDe(s)) / mesesComp) : 0

  // ── Presentación ──
  const D = isDesktop
  const [sec, setSec] = usePersistedState('oficina_sec', null)   // null = portada; 'fin' | 'ges' | 'soc' | 'res' = página de la sección (las cuatro tarjetas siguen fijas arriba)
  // La tira queda fija bajo la cabecera de la app; en celular (donde ocupa mucho alto) se contrae a una fila de cuatro mini tarjetas al salir de la pantalla.
  // El cuerpo de escritorio va con zoom: las medidas de la copia fija se pasan a su escala.
  const [hh, setHh] = useState(0), tiraRef = useRef(null), [fuera, setFuera] = useState(false), [box, setBox] = useState({ l: 0, w: 0 })
  useEffect(() => { const f = () => { const el = document.querySelector('.apphead'); const z = parseFloat(getComputedStyle(document.body).zoom) || 1; setHh(el ? Math.round(el.getBoundingClientRect().height / z) : 0); const t = tiraRef.current; if (t) { const r = t.getBoundingClientRect(); setBox({ l: r.left / z, w: r.width / z }) } }; f(); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f) }, [esMes, drill, sec])
  useEffect(() => { const el = tiraRef.current; if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setFuera(!e.isIntersecting && e.boundingClientRect.top < hh), { rootMargin: `-${hh}px 0px 0px 0px`, threshold: 0 }); io.observe(el); return () => io.disconnect() }, [hh, esMes, drill, sec])
  const grid = { display: 'grid', gridTemplateColumns: D ? 'repeat(4,minmax(0,1fr))' : 'repeat(2,minmax(0,1fr))', gap: 10 }
  const grid2 = { display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: D ? 12 : 8, marginTop: D ? 12 : 8 }
  const Lbl = ({ t, foto, link, onLink, xl }) => <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 2px 8px' }}><span style={{ ...SEC_LBL, flex: 1 }}>{t}</span>{foto && <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>{foto}</span>}{xl && <BtnDescarga onClick={xl} titulo='Descargar Excel' n='sheet' />}{link && <span onClick={onLink} style={{ fontSize: 11, fontWeight: 700, color: C.azulInfo, cursor: 'pointer' }}>{link} ›</span>}</div>
  const selSt = { fontSize: 12, fontWeight: 700, color: C.accent, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 8px', fontFamily: 'inherit', cursor: 'pointer' }
  const cap1 = s => s.charAt(0).toUpperCase() + s.slice(1)
  const enUF = moneda === 'UF', CLP = !enUF

  // Desglose de cada tarjeta: las partes que suman la cifra (solo en pesos donde la parte no existe en UF).
  const raAnio = useMemo(() => { let te = 0, teUF = 0; for (let i = 1; i <= curM; i++) { const r = resultadoMes(fuRes, deps, `${year}-${pad(i)}`); te += r.totalEmitido; teUF += r.totalEmitidoUF } return { te, teUF } }, [fuRes, billing, terceros, costosOfiRows, expenses, clients, curM, year])
  const ajR = x => Math.abs(x) < 1e6 ? Math.round(x) : Math.round(x / 1e5) * 1e5
  const facAnioV = resAnio.verCLP.fac || 0, ajAnio = ajR(raAnio.te - (resAnio.fac || 0)), facAnioUF = resAnio.verUF.fac || 0, ajAnioUF = Math.round(raAnio.teUF - (resAnio.facUF || 0))
  const CV = cascadaVendido(m, enUF), fV = x => enUF ? fmtUFk(x) : fmtShort(x)
  const rVend = [['Bruto', fV(CV.bruto)], ['Costos de terceros', '−' + fV(CV.costo), { neg: true }], ['Neto', fV(CV.neto), { tot: true }]]
  const vMs = vM.v, CVm = cascadaVendido({ neto: vMs.neto, costo: vMs.costo, netoUF: vMs.netoUF, costoUF: vMs.costoUF }, enUF)
  const rVendMes = [['Bruto', fV(CVm.bruto)], ['Costos de terceros', (CVm.costo > 0 ? '−' : '') + fV(CVm.costo), CVm.costo > 0 ? { neg: true } : undefined], ['Neto', fV(CVm.neto), { tot: true }]]
  const rFac = !esMes
    ? (CLP ? [['Total emitido', fmtShort(facAnioV + ajAnio)], ['Menos ajustes', '−' + fmtShort(ajAnio), { neg: true }], ['Facturado', fmtShort(facAnioV), { tot: true }]] : [['Total emitido', fmtUFk(facAnioUF + ajAnioUF)], ['Menos ajustes', '−' + fmtUFk(ajAnioUF), { neg: true }], ['Facturado', fmtUFk(facAnioUF), { tot: true }]])
    : (CLP ? [['Total emitido', fmtShort(rm.totalEmitido)], ['Menos ajustes', '−' + fmtShort(rm.totalEmitido - rm.fac), { neg: true }], ['Facturado', fmtShort(rm.fac), { tot: true }]] : [['Total emitido', fmtUFk(Math.round(rm.totalEmitidoUF))], ['Menos ajustes', '−' + fmtUFk(Math.round(rm.totalEmitidoUF - rm.facUF)), { neg: true }], ['Facturado', fmtUFk(Math.round(rm.facUF)), { tot: true }]])
  const cobReal = (ymX) => ({ clp: (ing.byMonth?.[ymX] || 0) - (comP.byMonth?.[ymX] || 0) + (ing.percByMonth?.[ymX] || 0), uf: (ing.byMonthUF?.[ymX] || 0) - (comP.byMonthUF?.[ymX] || 0) + (ing.percByMonthUF?.[ymX] || 0) })
  const rCob = !esMes ? [['Propio', vMon(ingYTDUF, ingYTD)], ['Real', vMon(ingRealA.uf, ingRealA.clp)], ...(CLP ? [['Por cobrar', fmtShort(totPorCobrar)]] : [])]
    : [['Propio', fMon(cobM.clp, cobM.uf)], ['Real', fMon(cobReal(ymSel).clp, cobReal(ymSel).uf)]]
  const rRes = !esMes ? [['Ingresos', mRes('ing')], ['Costos', '−' + mRes('cos', true), { neg: true }], ['Comisiones', '−' + mRes('com', true), { neg: true }]]
    : (CLP ? [['Ingresos', fmtShort(rm.ing)], ['Costos', '−' + fmtShort(rm.cos), { neg: true }], ['Comisiones', '−' + fmtShort(rm.com), { neg: true }]] : undefined)

  // Las cuatro tarjetas, fijas arriba: mismas reglas de Inicio (tono por tarjeta, % de la meta en negrita, verde y «+N %» sobre 100).
  // «Volver» de la cabecera de la app: primero cierra la página interior de Oficina (detalle del año o sección) y recién después sale; devuelve true si lo manejó.
  useEffect(() => { if (!backRef) return; backRef.current = () => { if (drill) { setDrill(null); return true } if (sec) { setSec(null); return true } return false }; return () => { backRef.current = null } }, [backRef, drill, sec])
  const sel = drill?.tile
  const tira = (() => {
    if (!esMes) return (<div style={{ display: 'grid', gridTemplateColumns: D ? 'repeat(4,minmax(0,1fr))' : 'repeat(2,minmax(0,1fr))', gap: D ? 12 : 8 }}>
      <KpiAnio D={D} ic='chart' tono='az' label='Vendido' activo={sel === 'vend'} onClick={() => setDrill(d => d && d.tile === 'vend' ? null : { tile: 'vend' })}
        value={vendPrinc === 'neto' ? vMon(m.netoUF, m.neto) : vMon(m.brutoUF, m.bruto)} rows={rVend} pct={m.meta > 0 ? (vendPrinc === 'neto' ? ventaNetoPct : ventaPct) : null} cap={<>{vendPrinc === 'neto' ? 'neto ' : 'bruto '}de la meta</>} />
      <KpiAnio D={D} ic='file' tono='am' label='Facturado' value={mRes('fac')} rows={rFac} pct={m.bruto > 0 ? factPct : null} cap='del bruto' activo={sel === 'fact'} onClick={() => setDrill(d => d && d.tile === 'fact' ? null : { tile: 'fact' })} />
      <KpiAnio D={D} ic='check' tono='gr' label='Cobrado' value={cobPrinc === 'real' ? vMon(ingRealA.uf, ingRealA.clp) : vMon(ingYTDUF, ingYTD)} rows={rCob} pct={metaCobranza > 0 ? (cobPrinc === 'real' ? cobroRealPct : cobroPct) : null} cap='de la meta' activo={sel === 'cob'} onClick={() => setDrill(d => d && d.tile === 'cob' ? null : { tile: 'cob' })} />
      {resAnio.ing > 0 && <KpiAnio D={D} ic='tPct' tono='nt' label='Resultado' value={(resAnio.res < 0 ? '−' : '') + mRes('res', true)} rows={rRes} pct={resAnio.pct != null ? pct1(resAnio.pct) : null} cap='margen' activo={sel === 'marg'} onClick={() => setDrill(d => d && d.tile === 'marg' ? null : { tile: 'marg' })} />}
    </div>)
    return (<div style={{ display: 'grid', gridTemplateColumns: D ? 'repeat(4,minmax(0,1fr))' : 'repeat(2,minmax(0,1fr))', gap: D ? 12 : 8 }}>
      <KpiAnio D={D} ic='chart' tono='az' label='Vendido' value={fMon(vM.clp, vM.uf)} sub={dMon(vM.clp, vP.clp, vM.uf, vP.uf)} rows={rVendMes} onClick={() => go('ventas')} />
      <KpiAnio D={D} ic='file' tono='am' label='Facturado' value={fMon(rm.fac, rm.facUF)} sub={dMon(rm.fac, rp.fac, rm.facUF, rp.facUF)} rows={rFac} onClick={() => go('estadoResultados', ymSel, { bloque: 'ing', sub: 'fac' })} />
      <KpiAnio D={D} ic='check' tono='gr' label='Cobrado' value={fMon(cobM.clp, cobM.uf)} sub={cobP ? dMon(cobM.clp, cobP.clp, cobM.uf, cobP.uf) : undefined} rows={rCob} onClick={() => go('cobradoMes', ymSel)} />
      <KpiAnio D={D} ic='tPct' tono='nt' label='Resultado' value={(rm.res < 0 ? '−' : '') + fMon(Math.abs(rm.res), Math.abs(rm.resUF))} sub={dMon(rm.res, rp.res, rm.resUF, rp.resUF)} rows={rRes} onClick={() => go('estadoResultados', ymSel)} />
    </div>)
  })()

  const mini = esMes
    ? [['Vendido', fMon(vM.clp, vM.uf), C.azulBg, C.azulInfo], ['Facturado', fMon(rm.fac, rm.facUF), C.soonBg, C.soonText], ['Cobrado', fMon(cobM.clp, cobM.uf), C.greenBg, C.greenText], ['Resultado', (rm.res < 0 ? '−' : '') + fMon(Math.abs(rm.res), Math.abs(rm.resUF)), C.card, C.accent]]
    : [['Vendido', vendPrinc === 'neto' ? vMon(m.netoUF, m.neto) : vMon(m.brutoUF, m.bruto), C.azulBg, C.azulInfo], ['Facturado', mRes('fac'), C.soonBg, C.soonText], ['Cobrado', cobPrinc === 'real' ? vMon(ingRealA.uf, ingRealA.clp) : vMon(ingYTDUF, ingYTD), C.greenBg, C.greenText], ['Resultado', (resAnio.res < 0 ? '−' : '') + mRes('res', true), C.card, C.accent]]
  // Año o mes: las cifras de Finanzas
  const res = esMes ? rm.res : resAnio.res, ingr = esMes ? rm.ing : resAnio.ing
  const mg = margenPct(res, ingr)
  // Las tarjetas de sección y sus páginas van siempre en pesos (saldos vivos como el flujo y la cobranza no existen en UF); la moneda elegida rige las cuatro tarjetas de arriba.
  const costoTxt = esMes ? fmtMill(rm.cos) : fmtShort(Math.abs(resAnio.verCLP.cos || 0)), comTxt = esMes ? fmtMill(rm.com) : fmtShort(Math.abs(resAnio.verCLP.com || 0))
  const pptoTxt = !ppto ? '' : !ppto.borrador ? 'Sin empezar' : (ppto.oficial ? ppto.oficial.nombre : 'Sin versión oficial') + (ppto.actualizado ? '. Actualizado ' + fmtFechaDMY(ppto.actualizado).replace(/-/g, '‑') : '')
  const resTxt = (res < 0 ? '−' : '') + fmtMill(Math.abs(res))
  const nResolver = (procsN ? procsN.falla : 0) + (bandN || 0) + nA + (nPendCuentas || 0)
  const partesRes = [procsN && procsN.falla ? `${procsN.falla} proceso${procsN.falla === 1 ? '' : 's'} con falla` : null, bandN ? `${bandN} en la bandeja` : null, nA ? `${nA} aviso${nA === 1 ? '' : 's'} tributario${nA === 1 ? '' : 's'}` : null, nPendCuentas ? `${nPendCuentas} por revisar` : null].filter(Boolean)
  const socIng = s => fmtShort(card6(s, 'ytd')[5] || 0)

  // Portada: cuatro tarjetas de sección y Por resolver, todas clickeables.
  const portada = (<>
    <div style={grid2}>
      <SecCard D={D} ic='chart' tint={C.azulBg} col={C.azulInfo} t='Finanzas' v={resTxt} vcol={res < 0 ? C.overdueText : undefined} s={esMes ? `resultado de ${MESES[selM - 1]}` : 'resultado del año'} onClick={() => setSec('fin')}
        rows={[['Costos', '−' + costoTxt, { neg: true, onClick: () => go('costos') }], ['Comisiones', '−' + comTxt, { neg: true, onClick: () => go('proveedores') }], ['Flujo de caja', (fin > 0 ? '+' : fin < 0 ? '−' : '') + fmtMill(Math.abs(fin)), { neg: fin < 0, onClick: () => go('flujoCaja') }], ['Comisiones por pagar', sc.porPagar > 0 ? fmtMill(sc.porPagar) : 'al día', { onClick: () => go('proveedores') }]]} />
      <SecCard D={D} ic='wallet' tint={C.tealBg} col={C.tealText} t='Gestión' v={fmtMill(totPorCobrar)} s='por cobrar' onClick={() => setSec('ges')}
        rows={[['Vencido', fmtMill(venc), { neg: venc > 0, onClick: () => go('cobranzaVencido') }], ['Más de 60 días', fmtMill(cart.expo.m60 || 0), { neg: cart.expo.m60 > 0, onClick: () => go('cobranzaM60') }], ['Com. por pagar', sc.porPagar > 0 ? fmtMill(sc.porPagar) : 'al día', { onClick: () => go('proveedores') }], ['Com. por percibir', comCobrar > 0 ? fmtMill(comCobrar) : 'al día', { onClick: () => go('proveedores') }]]} />
      <SecCard D={D} ic='users' tint={C.tealBg} col={C.tealText} t='Socios' v={fmtShort(aFavor)} s={`Retribución de socios · ${year}`} onClick={() => setSec('soc')}
        rows={[['Retirado ' + year, fmtShort(RS.totalRet), { onClick: () => go('socios') }], ['Sueldos de socios', fmtShort(sueldoVal), { onClick: () => go('socios') }], ['Ingreso real', socIng(null), { onClick: () => go('porSocio', null, 5) }]]} />
      <SecCard D={D} ic='building' tint={C.bgSoft} col={C.accent} t={`Presupuesto ${year + 1}`} v={!ppto ? '…' : ppto.borrador ? 'Borrador' : 'Sin empezar'} s={ppto && ppto.oficial ? ppto.oficial.nombre : 'sin versión oficial'} onClick={() => go('presupuesto')}
        rows={ppto && ppto.actualizado ? [...(ppto.meta ? [[`Meta de ${ppto.meta.ancla === 'ventas' ? 'ventas' : nombreComponente(ppto.meta.ancla).toLowerCase()}`, fmtShort(ppto.meta.valor)]] : []), ['Actualizado', fmtFechaDMY(ppto.actualizado)]] : undefined} />
    </div>
    <div style={{ marginTop: D ? 12 : 8 }}>
      <SecCard D={D} ic='alert' tint={C.overdueBg} col={C.overdueText} t='Por resolver' v={nResolver ? String(nResolver) : 'Al día'} vcol={nResolver ? undefined : C.greenText} s={partesRes.join(', ')} onClick={() => setSec('res')} />
    </div>
  </>)

  // Excel de las páginas (cifras exactas en pesos): lo que se ve en pantalla, para llevarlo a una reunión.
  const xlSocios = () => { const f = x => Math.round(x || 0)
    const filas = RS.SOC.map(x => { const v = card6(x, 'ytd'), r = RS.retTot[x] || 0, su = sueldoDe(x), rt = r + su
      return [x, f(r), f(su), f(liquidoDe(x)), f(rt), f(promDe(x)), f(v[0]), f(v[2]), f(v[5]), totRetrib > 0 ? Math.round(rt / totRetrib * 1000) / 10 : '', totIngReal > 0 ? Math.round((v[5] || 0) / totIngReal * 1000) / 10 : '', ticket(x, 'ytd') == null ? '' : f(ticket(x, 'ytd')), margen(x, 'ytd') == null ? '' : Math.round(margen(x, 'ytd') * 10) / 10] })
    const vs = card6(SIN_SOCIO, 'ytd'); filas.push([SIN_SOCIO, '', '', '', '', '', f(vs[0]), f(vs[2]), f(vs[5]), '', '', ticket(SIN_SOCIO, 'ytd') == null ? '' : f(ticket(SIN_SOCIO, 'ytd')), margen(SIN_SOCIO, 'ytd') == null ? '' : Math.round(margen(SIN_SOCIO, 'ytd') * 10) / 10])
    descargarXlsx({ nombre: `Socios_${year}`, hoja: 'Socios', head: ['Socio', 'Retiros', 'Sueldos de socios (costo empresa)', 'De los cuales, líquido', `Retribución ${year}`, 'Promedio mensual', 'Vendido neto', 'Cobrado', 'Ingreso real', '% de la retribución', '% del ingreso real de socios', 'Ticket promedio', 'Margen, %'], filas, anchos: [16, 14, 20, 16, 16, 16, 14, 14, 14, 18, 18, 16, 12], numCols: [1, 2, 3, 4, 5, 6, 7, 8, 11] }) }
  const xlGestion = () => descargarXlsx({ nombre: 'Gestion', hoja: 'Gestión', head: ['Concepto', 'Valor'], anchos: [34, 18], numCols: [1],
    filas: [['Por cobrar', Math.round(totPorCobrar)], ['Vencido', Math.round(venc)], ['Más de 60 días', Math.round(cart.expo.m60 || 0)], ['Días de cobro, ponderado por monto', dCobro.pond ?? ''], ['Comisiones por pagar', Math.round(sc.porPagar || 0)], ['Comisiones por percibir', Math.round(comCobrar || 0)]] })
  const xlFinanzas = () => { const f = x => Math.round(x || 0), cos = esMes ? rm.cos : (resAnio.verCLP.cos || 0), com = esMes ? rm.com : (resAnio.verCLP.com || 0)
    descargarXlsx({ nombre: 'Finanzas', hoja: 'Finanzas', head: ['Concepto', 'Valor'], anchos: [38, 18], numCols: [1],
      filas: [[esMes ? `Resultado de ${MESES[selM - 1]}` : `Resultado, enero a ${MESES[curM - 1]}`, f(res)], ['Ingresos', f(ingr)], ['Costos', -Math.abs(f(cos))], ['Comisiones devengadas', -Math.abs(f(com))], ['Flujo de caja, 8 semanas', f(fin)], [`Proyección de cobranza al ${fmtFechaDMY(`${year}-12-31`)}`, f(proy)], ['Comisiones por pagar', f(sc.porPagar)]] }) }
  const pagina = {
    res: (<><Lbl t='Por resolver' foto='foto de hoy' /><div style={grid}>
      <Tl label='Calendario tributario' value={nA ? `${nA} aviso${nA === 1 ? '' : 's'}` : 'al día'} vcol={nA ? (calTrib.alertas[0].sev === 0 ? C.overdueText : C.soonText) : C.greenText} onClick={() => go('calendarioTrib')} />
      <Tl label='Procesos automáticos' value={procsN == null ? '…' : procsN.falla ? `${procsN.falla} con falla` : `${procsN.total} procesos`} vcol={procsN && procsN.falla ? C.overdueText : C.accent} onClick={() => go('procesos')} />
      <Tl label='Bandeja' value={bandN == null ? '…' : bandN ? String(bandN) : 'al día'} sub={bandN ? 'pendientes' : ''} vcol={bandN ? C.accent : C.greenText} onClick={() => go('bandeja')} />
      <Tl label='Por revisar' value={String(nPendCuentas)} sub='clientes con pendientes' onClick={() => go('revisarCuentas')} />
    </div></>),
    fin: (<>
      <Lbl t={esMes ? `Resultado de ${MESES[selM - 1]}` : `Resultado, enero a ${MESES[curM - 1]}`} xl={xlFinanzas} />
      <div style={grid}>
        <Tl er label='Estado de resultados' value={resTxt} vcol={res < 0 ? C.overdueText : C.accent} sub={esMes ? `${mesPrev} ${rp.res < 0 ? '−' : ''}${fmtMill(Math.abs(rp.res))}` : (mg == null ? '' : `margen ${pct1(mg)} %`)} onClick={() => esMes ? go('estadoResultados', ymSel) : go('estadoFormal')} />
        <Tl label={esMes && !rm.cerrado ? 'Costos, estimado' : 'Costos'} value={'−' + costoTxt} vcol={C.overdueText} sub={esMes ? dl(rm.cos, rp.cos, fmtMill, true) : 'incluye subarriendo y gastos varios'} onClick={() => go('costos')} />
        <Tl label='Comisiones' value={rm.com || !esMes ? '−' + comTxt : '$0'} vcol={C.overdueText} sub={esMes ? dl(rm.com, rp.com, fmtMill, true) : 'devengadas'} onClick={() => go('proveedores')} />
        <Tl label='Compras · IVA' value='Ver' sub='facturas recibidas' onClick={() => go('compras')} />
      </div>
      <Lbl t='Caja' foto='foto de hoy' />
      <div style={grid}>
        <Tl dest label='Mes en marcha' value={memTxt} vcol={memCol} sub={`al ${fmtFechaDMY(hoy).slice(0, 5)}`} onClick={() => go('mesEnMarcha')} />
        <Tl label='Flujo de caja' value={(fin > 0 ? '+' : fin < 0 ? '−' : '') + fmtMill(Math.abs(fin))} vcol={fin >= 0 ? C.greenText : C.overdueText} sub={`8 semanas, ${flujo.conMorosos ? 'con' : 'sin'} morosos`} onClick={() => go('flujoCaja')} />
        <Tl label='Proyección' value={fmtMill(proy)} sub={`cobranza al ${fmtFechaDMY(`${year}-12-31`)}, ${flujo.conMorosos ? 'con' : 'sin'} morosos`} onClick={() => go('flujoCaja')} />
        <Tl label='Comisiones por pagar' value={sc.porPagar > 0 ? fmtMill(sc.porPagar) : 'al día'} vcol={sc.porPagar > 0 ? C.accent : C.greenText} sub={diasCom != null && sc.porPagar > 0 ? `la más antigua, hace ${diasCom} días` : ''} onClick={() => go('proveedores')} />
      </div></>),
    ges: (<><Lbl t='Cobranza' foto='foto de hoy' xl={xlGestion} /><div style={grid}>
      <Tl label='Por cobrar' value={fmtMill(totPorCobrar)} sub={totPorCobrar > 0 ? `${Math.round(venc / totPorCobrar * 100)} % vencido` : ''} onClick={() => go('cobranza')} />
      <Tl label='Vencido' value={fmtMill(venc)} vcol={venc > 0 ? C.overdueText : C.accent} sub={`${new Set(cart.vencidoBills.map(b => String(b.client_id))).size} clientes`} onClick={() => go('cobranzaVencido')} />
      <Tl label='Más de 60 días' value={fmtMill(cart.expo.m60 || 0)} vcol={cart.expo.m60 > 0 ? C.overdueText : C.accent} sub={totPorCobrar > 0 ? `${Math.round((cart.expo.pctM60 || 0) * 100)} % de la cartera` : ''} onClick={() => go('cobranzaM60')} />
      <Tl label='Días de cobro' value={dCobro.pond != null ? `${dCobro.pond} días` : '—'} sub='ponderado por monto' onClick={() => go('presupuesto')} />
    </div>
    <Lbl t='Comisiones' foto='foto de hoy' link='Comisiones' onLink={() => go('proveedores')} /><div style={grid}>
      <Tl label='Por pagar' value={sc.porPagar > 0 ? fmtMill(sc.porPagar) : 'al día'} vcol={sc.porPagar > 0 ? C.accent : C.greenText} sub={diasCom != null && sc.porPagar > 0 ? `la más antigua, hace ${diasCom} días` : 'a colaboradores'} onClick={() => go('proveedores')} />
      <Tl label='Por percibir' value={comCobrar > 0 ? fmtMill(comCobrar) : 'al día'} vcol={comCobrar > 0 ? C.accent : C.greenText} sub='lo que nos pagan' onClick={() => go('proveedores')} />
    </div></>),
    soc: (<>
      <div style={{ ...grid, marginTop: 14 }}>
        <Tl ic='users' tint={C.tealBg} col={C.tealText} label={`Retribución de socios · ${year}`} value={fmtShort(aFavor)} sub='retiros y sueldos' onClick={() => go('socios')} />
        <Tl ic='wallet' tint={C.overdueBg} col={C.overdueText} label={`Retirado ${year}`} value={fmtShort(RS.totalRet)} sub='retiros de socios' onClick={() => go('socios')} />
        <Tl ic='building' tint={C.bgSoft} col={C.accent} label='Sueldos de socios' value={fmtShort(sueldoVal)} sub={usaCE ? `líquido ${fmtShort(CE.liquido)}` : RS.SOC.join(' + ')} onClick={() => go('socios')} />
        <Tl ic='chart' tint={C.azulBg} col={C.azulInfo} label='Ingreso real' value={socIng(null)} sub='oficina' onClick={() => go('porSocio', null, 5)} />
      </div>
      <Lbl t={`Por socio, enero a ${MESES[curM - 1]}`} link='Por socio' onLink={() => go('porSocio')} xl={xlSocios} />
      <div style={{ display: 'grid', gridTemplateColumns: D ? 'repeat(2,minmax(0,1fr))' : '1fr', gap: D ? 12 : 8 }}>
        {RS.SOC.map(s => { const v = card6(s, 'ytd'), retr = (RS.retTot[s] || 0) + sueldoDe(s), ir = v[5] || 0
          const pRet = totRetrib > 0 ? retr / totRetrib * 100 : null, pIr = totIngReal > 0 ? ir / totIngReal * 100 : null
          const pctTxt = (p, de) => p == null ? null : <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}><b style={{ color: C.accent, fontWeight: 800 }}>{pct1(p)} %</b> {de}</div>
          const hero = (lbl, val, p, de, rows) => (
            <div style={{ minWidth: 0 }}>
              <div style={{ ...SEC_LBL, fontSize: 10.5 }}>{lbl}</div>
              <div style={{ fontSize: D ? 30 : 24, fontWeight: 800, color: C.accent, letterSpacing: -.7, lineHeight: 1.1, marginTop: 2, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{val}</div>
              {pctTxt(p, de)}
              <FilasKpi D={D} rows={rows} sinBorde />
            </div>)
          return (
          <div key={s} onClick={() => go('porSocio', s)} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: D ? '14px' : '12px 10px', cursor: 'pointer', minWidth: 0, boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span style={{ width: 28, height: 28, borderRadius: 8, background: C.tealBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><SIcon n='users' s={15} c={C.tealText} /></span>
              <span style={{ flex: 1, fontSize: 16, fontWeight: 800, color: C.accent }}>{s}</span>
              <span style={{ color: C.muted, fontSize: 16 }}>›</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: D ? '1fr 1fr' : '1fr', marginTop: 10 }}>
              <div style={D ? { paddingRight: 16, borderRight: `1px solid ${C.border}`, minWidth: 0 } : { paddingBottom: 12, minWidth: 0 }}>{hero(`Retribución · ${year}`, fmtShort(retr), pRet, 'de la retribución', [['Retiros', fmtShort(RS.retTot[s] || 0), { onClick: () => go('socios') }], ['Sueldo costo empresa', fmtShort(sueldoDe(s)), { onClick: () => go('socios') }], ['Sueldo líquido', fmtShort(liquidoDe(s)), { onClick: () => go('socios') }], ['Promedio mensual', fmtShort(promDe(s))]])}</div>
              <div style={D ? { paddingLeft: 16, minWidth: 0 } : { paddingTop: 12, borderTop: `1px solid ${C.border}`, minWidth: 0 }}>{hero('Ingreso real', fmtShort(ir), pIr, 'del ingreso real de socios', [['Vendido neto', fmtShort(v[0] || 0)], ['Cobrado', fmtShort(v[2] || 0)], ['Ticket promedio', ticket(s, 'ytd') == null ? '—' : fmtShort(ticket(s, 'ytd')), { onClick: () => go('porSocio', s) }], ['Margen', margen(s, 'ytd') == null ? '—' : Math.round(margen(s, 'ytd')) + ' %', { onClick: () => go('porSocio', s) }]])}</div>
            </div>
          </div>) })}
      </div>
      {(() => { const v = card6(SIN_SOCIO, 'ytd'); return (
        <div onClick={() => go('porSocio', SIN_SOCIO)} style={{ margin: '14px 4px 0', display: 'flex', alignItems: 'center', gap: D ? 18 : 12, flexWrap: 'wrap', fontSize: D ? 12.5 : 11.5, color: C.muted, cursor: 'pointer' }}>
          <span style={{ ...SEC_LBL, fontSize: 10.5 }}>{SIN_SOCIO}</span>
          {[['Vendido neto', v[0]], ['Cobrado', v[2]], ['Ingreso real', v[5]]].map(([l, x]) => <span key={l} style={{ whiteSpace: 'nowrap' }}>{l} <b style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', marginLeft: 5 }}>{fmtShort(x || 0)}</b></span>)}
        </div>) })()}
    </>),
  }

  return (
    <div style={{ paddingBottom: 40 }}>
      {/* Cabecera: período (año o mes) y moneda en selectores simples; estado del mes e Informe en texto */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {esMes && <span style={{ fontSize: 11.5, fontWeight: 700, color: rm.cerrado ? C.greenText : C.soonText, whiteSpace: 'nowrap' }}>{rm.cerrado ? 'Cerrado' : `Provisorio, cierre ${cierre}`}</span>}
          {esMes && <span onClick={() => go('informeMes')} style={{ fontSize: 12, fontWeight: 700, color: C.azulInfo, cursor: 'pointer', whiteSpace: 'nowrap' }}>Informe del mes ›</span>}
          <select value={esMes ? 'm' + selM : 'a'} onChange={e => { const v = e.target.value; if (v === 'a') { setModo('anio') } else { setModo('mes'); setSelM(Number(v.slice(1))); setDrill(null) } }} style={selSt}>
            <option value='a'>Año {year}</option>
            {MESES.slice(0, curM).map((n, i) => <option key={n} value={'m' + (i + 1)}>{cap1(n)} {year}</option>)}
          </select>
          <select value={moneda} onChange={e => setMoneda(e.target.value)} style={selSt}><option value='CLP'>CLP</option><option value='UF'>UF</option></select>
        </span>
      </div>

      {/* Las cuatro tarjetas, fijas arriba */}
      <div ref={tiraRef} style={{ padding: '6px 0 8px' }}>{tira}</div>
      {/* El contenedor de la app tiene desplazamiento propio y anula «sticky»: al salir la tira de la pantalla aparece una copia fija bajo la cabecera (en celular, una fila de cuatro mini tarjetas). */}
      {fuera && <div style={{ position: 'fixed', top: hh, left: box.l, width: box.w, zIndex: 15, background: C.bg, padding: D ? '6px 0 8px' : '5px 0', boxSizing: 'border-box' }}>
        {D ? tira : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 5 }}>
          {mini.map(([l, v, bg, fg]) => <div key={l} style={{ background: bg, border: `1px solid ${bg === C.card ? C.border : 'transparent'}`, borderRadius: 9, padding: '3px 6px', minWidth: 0 }}><div style={{ fontSize: 8, fontWeight: 800, letterSpacing: .4, textTransform: 'uppercase', color: fg }}>{l}</div><div style={{ fontSize: 12.5, fontWeight: 800, color: C.accent, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</div></div>)}</div>}
      </div>}

      {drill && !esMes ? (<div style={{ marginTop: 6 }}>
        <div onClick={() => setDrill(null)} style={{ fontSize: 12, fontWeight: 700, color: C.accent, cursor: 'pointer', margin: '2px 2px 8px' }}>← Oficina</div>
        <ResDrillPanel datos={R} clients={clients} terceros={terceros} tile={drill.tile} year={drill.year} setDrill={setDrill} moneda={moneda} isDesk={D} selYear={year}
          go={t => go(({ sales: 'ventas', billing: 'facturacion', expenses: 'gastos', presupuestoOficina: 'oficina' })[t] || t)} onOpenClientFicha={id => go('cliente', id)} onOpenEstadoResultados={() => go('resultadoAnio')} />
      </div>) : sec ? (<div style={{ marginTop: 6 }}>
        <div onClick={() => setSec(null)} style={{ fontSize: 12, fontWeight: 700, color: C.accent, cursor: 'pointer', margin: '2px 2px 0' }}>← Oficina</div>
        {pagina[sec]}
      </div>) : portada}
    </div>)
}
