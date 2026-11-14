// Oficina: la vista financiera y de gestión de la oficina, en UNA sola página (Finanzas, Gestión y Socios), con selector Año | Mes.
// No calcula nada propio: cada cifra sale de la misma función que usa su pantalla de origen (hook del resultado del año de Inicio, resultadoMes, flujo de caja,
// cartera, comisiones, por socio), así que coincide con ellas. Arriba, fijas, las cuatro tarjetas (Vendido, Facturado, Cobrado, Resultado); en el año, tocar una
// abre su detalle como página (el mismo de Inicio) y las cuatro siguen a la vista. Maqueta aprobada 2026-11-14.
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase, DEMO } from '../supabase'
import { C, Gl, SEC_LBL, SIcon, fmtFechaDMY, useIsDesktop } from '../lib/base.jsx'
import { ADMIN_NAMES, SIN_SOCIO, _ymPrev, currentYear, cargarProcesos, cobradoBill, esSubarriendo, estadoProceso, fmtMill, fmtShort, fmtUFk, partidasPorSocio, porCobrarBills, resultadoMes, resumenCartera, saldoComisiones, useCalTrib, useFlujoCaja, usePersistedState, usePorSocioFuentes, vendidoPorSocio, ventaCLP, ventaUF, _DEMO_BANDEJA, CifrasBrutoNeto } from '../lib/compartido.jsx'
import { kpisPorSocio } from '../lib/cifras.js'
import { KpiAnio } from '../lib/tarjetasAnio.jsx'
import { pctsAnio, useResultadoAnio, ingresoRealAnio } from '../lib/resultadoAnio.js'
import { proyeccionCobranza, ResDrillPanel } from './DashboardView.jsx'
import { useMesEnMarcha } from './MesEnMarchaView.jsx'
import { resumenDiasCobro } from '../../supabase/functions/_shared/diasCobro.js'

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
const MCORTO = MESES.map(m => m.slice(0, 3))
const pad = n => String(n).padStart(2, '0')
const margenPct = (res, ing) => ing > 0 ? res / ing * 100 : null
const pct1 = v => v == null ? null : v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

// Tarjeta chica (la misma forma para todas las hermanas): etiqueta, cifra y una línea de apoyo. `er` = gris suave (Estado de resultados).
const Tl = ({ label, value, sub, vcol, tag, er, onClick }) => (
  <div onClick={onClick} className='pv-c' style={{ background: er ? C.border : C.card, border: `1px solid ${er ? C.border : C.border}`, borderRadius: 12, padding: '10px 12px', minWidth: 0, boxSizing: 'border-box', cursor: onClick ? 'pointer' : 'default' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, ...SEC_LBL, fontSize: 10, letterSpacing: .5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}{tag && <span style={{ fontSize: 8.5, fontWeight: 700, border: `1px solid ${C.muted}`, color: C.muted, borderRadius: 8, padding: '0 6px', textTransform: 'none', letterSpacing: 0 }}>{tag}</span>}</div>
    <div style={{ fontSize: 17, fontWeight: 800, color: vcol || C.accent, letterSpacing: -.4, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', marginTop: 1 }}>{value}</div>
    <div style={{ fontSize: 10.5, color: C.textSoft, minHeight: 14, lineHeight: 1.25, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{sub}</div>
  </div>)

export function OficinaView({ sales = [], billing = [], clients = [], terceros = [], expenses = [], anticipos = [], costosOfiRows = [], fantasmaIds = null, nPendCuentas = 0, onGo }) {
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
  const { m, resAnio, ingresosPorAnioVenta: ing, comisPagadasAnioVenta: comP, metaCobranza, metaUF, ufRef, fuRes } = R
  const ingYTD = ing.total || 0, ingYTDUF = ing.totalUF || 0
  const ingRealA = ingresoRealAnio(ing, comP)
  const { ventaPct, ventaNetoPct, factPct, cobroPct, cobroRealPct } = pctsAnio({ m, resAnio, metaUF, ingYTD, metaCobranza, ingReal: ingRealA.clp })
  const vMon = (uf, clp) => moneda === 'UF' ? fmtUFk(Math.round(uf || 0)) : fmtShort(clp)
  const mRes = (k, abs) => { const v = (moneda === 'UF' ? resAnio.verUF : resAnio.verCLP)[k] || 0, x = abs ? Math.abs(v) : v; return moneda === 'UF' ? fmtUFk(x) : fmtShort(x) }

  // ── Mes: resultadoMes (el mismo del Estado de resultados) contra el mes anterior ──
  const deps = { billing, terceros, costosOfiRows, expenses, clients }
  const rm = useMemo(() => resultadoMes(fuRes, deps, ymSel), [fuRes, billing, terceros, costosOfiRows, expenses, clients, ymSel])
  const rp = useMemo(() => resultadoMes(fuRes, deps, ymP), [fuRes, billing, terceros, costosOfiRows, expenses, clients, ymP])
  const cierran = ymX => (sales || []).filter(s => s && !s.deleted_at && ['Activo', 'Terminado'].includes(s.status) && !esSubarriendo(s) && String(s.activated_at || '').slice(0, 7) === ymX)   // la misma regla del Informe del mes
  const vend = ymX => { const l = cierran(ymX); return { uf: l.reduce((a, s) => a + ventaUF(s, ufRef), 0), clp: l.reduce((a, s) => a + ventaCLP(s, ufRef), 0) } }
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
  const diasCom = sc.porPagarDesde ? Math.round((Date.now() - new Date(sc.porPagarDesde + 'T12:00').getTime()) / 86400000) : null
  const porCobrar = porCobrarBills(billing)
  const cart = useMemo(() => resumenCartera(billing), [billing])
  const totPorCobrar = porCobrar, venc = cart.vencidoTot
  const fin = flujo.fin
  // Días de cobro PONDERADOS por monto (diasCobro.js): facturas pagadas del año, sin reembolsos, notas de crédito ni subarriendo.
  const dCobro = useMemo(() => { const d = x => Date.parse(String(x).slice(0, 10) + 'T00:00:00Z')
    return resumenDiasCobro((billing || []).filter(b => b && !b.deleted_at && b.status === 'Pagado' && b.issued_at && b.paid_at && String(b.issued_at).slice(0, 4) === String(year) && !['reembolso', 'nota_credito', 'subarriendo'].includes(b.billing_type))
      .map(b => ({ monto: Number(b.paid_amount) || Number(b.amount) || 0, dias: Math.round((d(b.paid_at) - d(b.issued_at)) / 86400000) }))) }, [billing, year])
  const sinMov = !(mesM.cobrado || mesM.pagado || mesM.porPagar)
  const memTxt = sinMov ? 'Sin movimientos' : (mesM.actual && mesM.cas.falta > 0 ? 'Faltan ' + fmtMill(mesM.cas.falta) : mesM.cas.cubrePagados ? 'Cubierto' : 'Sin cubrir')
  const memCol = sinMov ? C.accent : (mesM.actual && mesM.cas.falta > 0 ? C.soonText : mesM.cas.cubrePagados ? C.greenText : C.overdueText)

  // ── Presupuesto del año siguiente: estado real de su borrador (tabla presupuestos) ──
  const [ppto, setPpto] = useState(null)
  useEffect(() => { if (DEMO) { setPpto({ borrador: true, actualizado: hoy, oficial: null }); return } let v = true
    supabase.from('presupuestos').select('tipo,oficial,nombre,updated_at,created_at').eq('anio', year + 1).then(({ data }) => { if (!v) return
      const b = (data || []).find(r => r.tipo === 'borrador'), of = (data || []).find(r => r.oficial)
      setPpto({ borrador: !!b, actualizado: b ? String(b.updated_at || b.created_at).slice(0, 10) : null, oficial: of ? { nombre: of.nombre || 'Versión oficial' } : null }) }, () => {}); return () => { v = false } }, [year])

  // ── Socios (misma regla que el Panel de socios: lo vendido, cobrado e ingreso real por socio) ──
  const [fu] = usePorSocioFuentes()
  const P = useMemo(() => partidasPorSocio({ billing, sales, clients, anticipos, terceros, expenses, ic: fu.ic, ia: fu.ia, ov: fu.ov, fondoExtra: {} }), [billing, sales, clients, anticipos, terceros, expenses, fu])
  const V = useMemo(() => vendidoPorSocio(sales, clients, ufRef, year, null, { terceros, billing }), [sales, clients, ufRef, terceros, billing])
  const { card6 } = useMemo(() => kpisPorSocio({ P, V, ym: ymNow }), [P, V, ymNow])
  const sociosFilas = [...ADMIN_NAMES, SIN_SOCIO, null]
  const retAnio = useMemo(() => (expenses || []).filter(e => e && !e.deleted_at && e.type === 'gasto' && String(e.category || '') === 'Retiros' && String(e.date || '').slice(0, 4) === String(year)).reduce((a, e) => a + (Number(e.amount) || 0), 0), [expenses, year])

  // ── Presentación ──
  const D = isDesktop
  // La tira queda fija bajo la cabecera de la app; en celular (donde ocupa mucho alto) se contrae a una fila de cuatro mini tarjetas al salir de la pantalla.
  // El cuerpo de escritorio va con zoom: las medidas de la copia fija se pasan a su escala.
  const [hh, setHh] = useState(0), tiraRef = useRef(null), [fuera, setFuera] = useState(false), [box, setBox] = useState({ l: 0, w: 0 })
  useEffect(() => { const f = () => { const el = document.querySelector('.apphead'); const z = parseFloat(getComputedStyle(document.body).zoom) || 1; setHh(el ? Math.round(el.getBoundingClientRect().height / z) : 0); const t = tiraRef.current; if (t) { const r = t.getBoundingClientRect(); setBox({ l: r.left / z, w: r.width / z }) } }; f(); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f) }, [esMes, drill])
  useEffect(() => { const el = tiraRef.current; if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setFuera(!e.isIntersecting && e.boundingClientRect.top < hh), { rootMargin: `-${hh}px 0px 0px 0px`, threshold: 0 }); io.observe(el); return () => io.disconnect() }, [hh, esMes, drill])
  const grid = { display: 'grid', gridTemplateColumns: D ? 'repeat(4,minmax(0,1fr))' : 'repeat(2,minmax(0,1fr))', gap: 10 }
  const Part = ({ t }) => <div style={{ fontSize: 15, fontWeight: 800, color: C.accent, margin: '26px 2px 0', paddingBottom: 6, borderBottom: `1.5px solid ${C.accent}` }}>{t}</div>
  const Lbl = ({ t, foto, link, onLink }) => <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '16px 2px 8px' }}><span style={{ ...SEC_LBL, flex: 1 }}>{t}</span>{foto && <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>{foto}</span>}{link && <span onClick={onLink} style={{ fontSize: 11, fontWeight: 700, color: C.azulInfo, cursor: 'pointer' }}>{link} ›</span>}</div>
  const pill = (on, txt, fn) => <span key={txt} onClick={fn} style={{ fontSize: 12, fontWeight: 700, padding: '4px 13px', borderRadius: 16, cursor: 'pointer', background: on ? C.accent : 'transparent', color: on ? '#fff' : C.muted }}>{txt}</span>
  const seg = (a, b) => <span style={{ display: 'inline-flex', border: `1px solid ${C.border}`, borderRadius: 18, overflow: 'hidden', background: C.card }}>{a}{b}</span>
  const hdrPill = { fontSize: 12, fontWeight: 700, color: C.accent, background: C.card, border: `1px solid ${C.border}`, borderRadius: 20, padding: '4px 12px', fontFamily: 'inherit', cursor: 'pointer' }

  // La tira de cuatro tarjetas, fija arriba.
  const sel = drill?.tile
  const tira = (() => {
    if (!esMes) return (<div style={{ display: 'grid', gridTemplateColumns: D ? 'repeat(4,minmax(0,1fr))' : 'repeat(2,minmax(0,1fr))', gap: D ? 12 : 8 }}>
      <KpiAnio D={D} ic='chart' tono='az' label='Vendido' activo={sel === 'vend'} onClick={() => setDrill(d => d && d.tile === 'vend' ? null : { tile: 'vend' })}
        dual={<CifrasBrutoNeto desk={D} bruto={vMon(m.brutoUF, m.bruto)} neto={vMon(m.netoUF, m.neto)} princ={vendPrinc} onAlt={setVendPrinc} />} pct={m.meta > 0 ? (vendPrinc === 'neto' ? ventaNetoPct : ventaPct) : null} cap={<>{vendPrinc === 'neto' ? 'neto ' : 'bruto '}de la meta</>} />
      <KpiAnio D={D} ic='file' tono='am' label='Facturado' value={mRes('fac')} pct={m.bruto > 0 ? factPct : null} cap='del bruto' activo={sel === 'fact'} onClick={() => setDrill(d => d && d.tile === 'fact' ? null : { tile: 'fact' })} />
      <KpiAnio D={D} ic='check' tono='gr' label='Cobrado' value={cobPrinc === 'real' ? vMon(ingRealA.uf, ingRealA.clp) : vMon(ingYTDUF, ingYTD)} chip={{ etiqueta: cobPrinc === 'real' ? 'Real' : 'Propio', otra: cobPrinc === 'real' ? 'propio' : 'real', onAlt: setCobPrinc }} pct={metaCobranza > 0 ? (cobPrinc === 'real' ? cobroRealPct : cobroPct) : null} cap='de la meta' activo={sel === 'cob'} onClick={() => setDrill(d => d && d.tile === 'cob' ? null : { tile: 'cob' })} />
      {resAnio.ing > 0 && <KpiAnio D={D} ic='tPct' tono='nt' label='Resultado' value={(resAnio.res < 0 ? '−' : '') + mRes('res', true)} pct={resAnio.pct != null ? pct1(resAnio.pct) : null} cap='ingresos' activo={sel === 'marg'} onClick={() => setDrill(d => d && d.tile === 'marg' ? null : { tile: 'marg' })} />}
    </div>)
    return (<div style={{ display: 'grid', gridTemplateColumns: D ? 'repeat(4,minmax(0,1fr))' : 'repeat(2,minmax(0,1fr))', gap: D ? 12 : 8 }}>
      <KpiAnio D={D} ic='chart' tono='az' label='Vendido' value={fMon(vM.clp, vM.uf)} sub={dMon(vM.clp, vP.clp, vM.uf, vP.uf)} onClick={() => go('ventas')} />
      <KpiAnio D={D} ic='file' tono='am' label='Facturado' value={fMon(rm.fac, rm.facUF)} sub={dMon(rm.fac, rp.fac, rm.facUF, rp.facUF)} onClick={() => go('estadoResultados', ymSel, { bloque: 'ing', sub: 'fac' })} />
      <KpiAnio D={D} ic='check' tono='gr' label='Cobrado' value={fMon(cobM.clp, cobM.uf)} sub={cobP ? dMon(cobM.clp, cobP.clp, cobM.uf, cobP.uf) : undefined} onClick={() => go('cobradoMes', ymSel)} />
      <KpiAnio D={D} ic='tPct' tono='nt' label='Resultado' value={(rm.res < 0 ? '−' : '') + fMon(Math.abs(rm.res), Math.abs(rm.resUF))} sub={dMon(rm.res, rp.res, rm.resUF, rp.resUF)} onClick={() => go('estadoResultados', ymSel)} />
    </div>)
  })()

  const mini = esMes
    ? [['Vendido', fMon(vM.clp, vM.uf), C.azulBg, C.azulInfo], ['Facturado', fMon(rm.fac, rm.facUF), C.soonBg, C.soonText], ['Cobrado', fMon(cobM.clp, cobM.uf), C.greenBg, C.greenText], ['Resultado', (rm.res < 0 ? '−' : '') + fMon(Math.abs(rm.res), Math.abs(rm.resUF)), C.card, C.accent]]
    : [['Vendido', vendPrinc === 'neto' ? vMon(m.netoUF, m.neto) : vMon(m.brutoUF, m.bruto), C.azulBg, C.azulInfo], ['Facturado', mRes('fac'), C.soonBg, C.soonText], ['Cobrado', cobPrinc === 'real' ? vMon(ingRealA.uf, ingRealA.clp) : vMon(ingYTDUF, ingYTD), C.greenBg, C.greenText], ['Resultado', (resAnio.res < 0 ? '−' : '') + mRes('res', true), C.card, C.accent]]
  // Año o mes: las cifras de Finanzas
  const res = esMes ? rm.res : resAnio.res, ingr = esMes ? rm.ing : resAnio.ing
  const mg = margenPct(res, ingr)
  const costoTxt = esMes ? fmtMill(rm.cos) : mRes('cos', true), comTxt = esMes ? fmtMill(rm.com) : mRes('com', true)
  const pptoTxt = !ppto ? '' : !ppto.borrador ? 'Sin empezar' : (ppto.oficial ? ppto.oficial.nombre : 'Sin versión oficial') + (ppto.actualizado ? '. Actualizado\u00A0' + fmtFechaDMY(ppto.actualizado).replace(/-/g, '\u2011') : '')

  return (
    <div style={{ paddingBottom: 40 }}>
      {/* Cabecera: Año | Mes, mes elegido, estado del mes, moneda y exportación */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ marginLeft: 'auto', display: 'inline-flex' }}>{seg(pill(!esMes, 'Año', () => { setModo('anio') }), pill(esMes, 'Mes', () => { setModo('mes'); setDrill(null) }))}</span>
        {esMes ? <>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, ...hdrPill }}><span onClick={() => setSelM(x => Math.max(1, x - 1))} style={{ cursor: 'pointer', padding: '0 4px' }}>‹</span>{MESES[selM - 1].charAt(0).toUpperCase() + MESES[selM - 1].slice(1)} {year}<span onClick={() => setSelM(x => Math.min(curM, x + 1))} style={{ cursor: 'pointer', padding: '0 4px' }}>›</span></span>
          <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 20, padding: '3px 10px', background: rm.cerrado ? C.greenBg : C.soonBg, color: rm.cerrado ? C.greenText : C.soonText, whiteSpace: 'nowrap' }}>{rm.cerrado ? 'Cerrado' : `Provisorio, cierre ${cierre}`}</span>
        </> : <span style={{ ...hdrPill, cursor: 'default' }}>{year}</span>}
        {seg(pill(moneda === 'UF', 'UF', () => setMoneda('UF')), pill(moneda === 'CLP', 'CLP', () => setMoneda('CLP')))}
        {esMes && <span onClick={() => go('informeMes')} style={hdrPill}>Informe del mes ›</span>}
      </div>

      {/* Las cuatro tarjetas, fijas arriba */}
      <div ref={tiraRef} style={{ padding: '6px 0 8px' }}>{tira}</div>
      {/* El contenedor de la app tiene desplazamiento propio y anula «sticky»: al salir la tira de la pantalla aparece una copia fija bajo la cabecera (completa en escritorio; en celular, una fila de cuatro mini tarjetas). */}
      {fuera && <div style={{ position: 'fixed', top: hh, left: box.l, width: box.w, zIndex: 15, background: C.bg, padding: D ? '6px 0 8px' : '5px 0', boxSizing: 'border-box' }}>
        {D ? tira : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 5 }}>
          {mini.map(([l, v, bg, fg]) => <div key={l} style={{ background: bg, border: `1px solid ${bg === C.card ? C.border : 'transparent'}`, borderRadius: 9, padding: '3px 6px', minWidth: 0 }}><div style={{ fontSize: 8, fontWeight: 800, letterSpacing: .4, textTransform: 'uppercase', color: fg }}>{l}</div><div style={{ fontSize: 12.5, fontWeight: 800, color: C.accent, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</div></div>)}</div>}
      </div>}

      {drill && !esMes ? (<div style={{ marginTop: 6 }}>
        <div onClick={() => setDrill(null)} style={{ fontSize: 12, fontWeight: 700, color: C.accent, cursor: 'pointer', margin: '2px 2px 8px' }}>← Oficina</div>
        <ResDrillPanel datos={R} clients={clients} terceros={terceros} tile={drill.tile} year={drill.year} setDrill={setDrill} moneda={moneda} isDesk={D} selYear={year}
          go={t => go(({ sales: 'ventas', billing: 'facturacion', expenses: 'gastos', presupuestoOficina: 'oficina' })[t] || t)} onOpenClientFicha={id => go('cliente', id)} onOpenEstadoResultados={() => go('resultadoAnio')} />
      </div>) : (<>
        <Lbl t='Por resolver' foto='foto de hoy' />
        <div style={grid}>
          <Tl label='Calendario tributario' value={nA ? `${nA} aviso${nA === 1 ? '' : 's'}` : 'al día'} vcol={nA ? (calTrib.alertas[0].sev === 0 ? C.overdueText : C.soonText) : C.greenText} onClick={() => go('calendarioTrib')} />
          <Tl label='Procesos automáticos' value={procsN == null ? '…' : procsN.falla ? `${procsN.falla} con falla` : `${procsN.total} procesos`} vcol={procsN && procsN.falla ? C.overdueText : C.accent} onClick={() => go('procesos')} />
          <Tl label='Bandeja' value={bandN == null ? '…' : bandN ? String(bandN) : 'al día'} sub={bandN ? 'pendientes' : ''} vcol={bandN ? C.accent : C.greenText} onClick={() => go('bandeja')} />
          <Tl label='Por revisar' value={String(nPendCuentas)} sub='clientes con pendientes' onClick={() => go('revisarCuentas')} />
        </div>

        <Part t='Finanzas' />
        <Lbl t={esMes ? `Resultado de ${MESES[selM - 1]}` : `Resultado, enero a ${MESES[curM - 1]}`} />
        <div style={grid}>
          <Tl er label='Estado de resultados' value={(res < 0 ? '−' : '') + fmtMill(Math.abs(res))} vcol={res < 0 ? C.overdueText : C.accent} sub={esMes ? `${mesPrev} ${rp.res < 0 ? '−' : ''}${fmtMill(Math.abs(rp.res))}` : (mg == null ? '' : `margen ${pct1(mg)} %`)} onClick={() => esMes ? go('estadoResultados', ymSel) : go('resultadoAnio')} />
          <Tl label='Costos' value={'−' + costoTxt} vcol={C.overdueText} tag={esMes && !rm.cerrado ? 'Estimado' : undefined} sub={esMes ? dl(rm.cos, rp.cos, fmtMill, true) : 'incluye subarriendo y gastos varios'} onClick={() => go('costos')} />
          <Tl label='Comisiones' value={rm.com || !esMes ? '−' + comTxt : '$0'} vcol={C.overdueText} sub={esMes ? dl(rm.com, rp.com, fmtMill, true) : 'devengadas'} onClick={() => go('proveedores')} />
          <Tl label='Compras · IVA' value='Ver' sub='facturas recibidas' onClick={() => go('compras')} />
        </div>
        <Lbl t='Caja' foto='foto de hoy' />
        <div style={grid}>
          <Tl label='Flujo de caja' value={(fin > 0 ? '+' : fin < 0 ? '−' : '') + fmtMill(Math.abs(fin))} vcol={fin >= 0 ? C.greenText : C.overdueText} sub={`8 semanas, ${flujo.conMorosos ? 'con' : 'sin'} morosos`} onClick={() => go('flujoCaja')} />
          <Tl label='Proyección' value={fmtMill(proy)} sub={`cobranza al ${fmtFechaDMY(`${year}-12-31`)}, ${flujo.conMorosos ? 'con' : 'sin'} morosos`} onClick={() => go('flujoCaja')} />
          <Tl label='Comisiones por pagar' value={sc.porPagar > 0 ? fmtMill(sc.porPagar) : 'al día'} vcol={sc.porPagar > 0 ? C.accent : C.greenText} sub={diasCom != null && sc.porPagar > 0 ? `la más antigua, hace ${diasCom} días` : ''} onClick={() => go('proveedores')} />
          <Tl label='Mes en marcha' value={memTxt} vcol={memCol} sub={`al ${fmtFechaDMY(hoy).slice(0, 5)}`} onClick={() => go('mesEnMarcha')} />
        </div>
        <Lbl t={`Presupuesto ${year + 1}`} />
        <div onClick={() => go('presupuesto')} style={{ display: 'flex', alignItems: 'center', gap: 12, background: C.accent, borderRadius: 12, padding: '13px 16px', cursor: 'pointer' }}>
          <span style={{ width: 34, height: 34, borderRadius: 9, background: 'rgba(255,255,255,.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><SIcon n='chart' s={17} c='#fff' /></span>
          <div style={{ minWidth: 0, flex: 1 }}><div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>{`Presupuesto ${year + 1}${ppto && ppto.borrador ? ', borrador' : ''}`}</div><div style={{ fontSize: 12, color: '#BFD8E0' }}>{pptoTxt}</div></div>
          <span style={{ border: '1.5px solid #fff', color: '#fff', borderRadius: 14, padding: '3px 12px', fontSize: 12, fontWeight: 700 }}>Abrir</span>
        </div>

        <Part t='Gestión' />
        <Lbl t='Cobranza' foto='foto de hoy' />
        <div style={grid}>
          <Tl label='Por cobrar' value={fmtMill(totPorCobrar)} sub={totPorCobrar > 0 ? `${Math.round(venc / totPorCobrar * 100)} % vencido` : ''} onClick={() => go('cobranza')} />
          <Tl label='Vencido' value={fmtMill(venc)} vcol={venc > 0 ? C.overdueText : C.accent} sub={`${new Set(cart.vencidoBills.map(b => String(b.client_id))).size} clientes`} onClick={() => go('cobranzaVencido')} />
          <Tl label='Más de 60 días' value={fmtMill(cart.expo.m60 || 0)} vcol={cart.expo.m60 > 0 ? C.overdueText : C.accent} sub={totPorCobrar > 0 ? `${Math.round((cart.expo.pctM60 || 0) * 100)} % de la cartera` : ''} onClick={() => go('cobranzaM60')} />
          <Tl label='Días de cobro' value={dCobro.pond != null ? `${dCobro.pond} días` : '—'} sub='ponderado por monto' onClick={() => go('presupuesto')} />
        </div>

        <Part t='Socios' />
        <Lbl t={`Por socio, enero a ${MESES[curM - 1]}`} link='Por socio' onLink={() => go('porSocio')} />
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: D ? 12.5 : 12, fontVariantNumeric: 'tabular-nums' }}>
            <thead><tr>{['Socio', 'Vendido neto', 'Cobrado', 'Ingreso real'].map((h, i) => <th key={h} style={{ padding: D ? '8px 14px' : '8px 6px', fontSize: D ? 10 : 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .4, color: C.accent, background: C.bgSoft, textAlign: i ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
            <tbody>{sociosFilas.map(s => { const v = card6(s, 'ytd'), tot = s === null; return (
              <tr key={s || 'ofi'} onClick={() => go('porSocio')} style={{ cursor: 'pointer', background: tot ? C.bgSoft : undefined }}>
                <td style={{ padding: D ? '8px 14px' : '8px 6px', borderTop: tot ? `1.5px solid ${C.accent}` : `1px solid ${C.bgSoft}`, fontWeight: tot ? 800 : 600, color: tot ? C.accent : C.text }}>{tot ? 'Oficina' : s}</td>
                {[0, 2, 5].map(i => <td key={i} onClick={e => { e.stopPropagation(); go('porSocio', s, i) }} style={{ padding: D ? '8px 14px' : '8px 6px', borderTop: tot ? `1.5px solid ${C.accent}` : `1px solid ${C.bgSoft}`, textAlign: 'right', fontWeight: tot ? 800 : 400, color: tot ? C.accent : undefined }}>{fmtShort(v[i] || 0)}</td>)}
              </tr>) })}
              <tr onClick={() => go('socios')} style={{ cursor: 'pointer' }}><td style={{ padding: D ? '8px 14px' : '8px 6px', borderTop: `1px solid ${C.bgSoft}`, fontWeight: 600 }}>Retiros de socios</td><td /><td /><td style={{ padding: D ? '8px 14px' : '8px 6px', borderTop: `1px solid ${C.bgSoft}`, textAlign: 'right' }}>{fmtShort(retAnio)}</td></tr>
            </tbody></table></div>
        </div>
      </>)}
    </div>)
}
