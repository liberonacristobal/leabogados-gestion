// Estado de resultados formal: el estado de resultados como se arma en finanzas (ingresos de explotación, costo de ventas, margen bruto, gastos de administración,
// resultado antes de impuestos, PPM y resultado después de impuestos), con una columna por mes, el total del año, el mismo período del año anterior y el porcentaje sobre
// ingresos. No calcula nada propio: cada columna es resultadoMes (la misma función de Inicio, Oficina y Resultado del año), así que el resultado coincide con el de esas
// pantallas; el impuesto es el PPM puro de impuestosMensuales. Cifras en miles de pesos o en UF (la moneda de Oficina); los subtotales se arman con las cifras ya
// redondeadas para que el estado sume. El Excel baja las cifras exactas.
import { useMemo, useState } from 'react'
import { C, SEC_LBL, fmtFechaDMY, useIsDesktop } from '../lib/base.jsx'
import { resultadoMes, useFuentesResultado, useImpuestosFuentes, useUF, useUFFechas, ufDelDia, finMesOHoy, usePersistedState, UF_FALLBACK, currentYear } from '../lib/compartido.jsx'
import { descargarXlsx } from '../lib/seleccionLote.jsx'
import { DEMO } from '../supabase'
import { impuestosMensuales, pagosConBoleta, idOficina } from '../../supabase/functions/_shared/impuestosMensuales.js'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const MC = MESES.map(m => m.slice(0, 3))
const pad = n => String(n).padStart(2, '0')
const fN = n => n === 0 ? '0' : (n < 0 ? '−' : '') + Math.abs(n).toLocaleString('es-CL')
const fPct = (a, b) => { if (!(b > 0)) return ''; const v = Math.round(a / b * 1000) / 10; return (v < 0 ? '−' : '') + Math.abs(v).toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %' }
const fVar = (a, p) => { if (!p) return ''; const v = Math.round((a - p) / Math.abs(p) * 1000) / 10; if (Math.abs(v) > 999) return v > 0 ? '>+999 %' : '<−999 %'; return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %' }
const suma = a => a.reduce((x, y) => x + y, 0)
const ORDEN = ['rem', 'cot', 'arr', 'con', 'otr', 'pre', 'gv', 'sub']

export function EstadoResultadosFormal({ billing = [], terceros = [], costosOfiRows = [], expenses = [], clients = [], backLabel = 'Oficina', onBack, onGo }) {
  const D = useIsDesktop()
  const fu = useFuentesResultado()
  const year = currentYear, curM = new Date().getMonth() + 1, n = curM + 1
  const [selM, setSelM] = useState(curM)
  const [vista, setVista] = useState('pct')   // celular: tercera columna = % de ingresos o comparación con el año anterior
  const [moneda, setMoneda] = usePersistedState('oficina_moneda', 'CLP')
  const enUF = moneda === 'UF'
  const ufState = useUF(), ufRef = ufState.uf || UF_FALLBACK, ufDias = useUFFechas(billing)
  const deps = { billing, terceros, costosOfiRows, expenses, clients, ufd: ufDias, ufFb: ufRef }
  const imps = useImpuestosFuentes(), ofiId = useMemo(() => idOficina(clients), [clients])

  // Un año (mismos meses, de enero al mes en curso): resultadoMes de cada mes y su PPM puro (en pesos y en UF del fin de ese mes).
  const anio = (Y) => {
    const R = Array.from({ length: curM }, (_, i) => resultadoMes(fu, deps, `${Y}-${pad(i + 1)}`))
    const pagos = DEMO ? (imps.pagos || []) : pagosConBoleta({ expenses, ofiId, boletaSet: fu.boleta, terceros }), docs = (fu.sii && fu.sii.length ? fu.sii : imps.docs) || []
    const ppm = R.map((_, i) => { const per = `${Y}-${pad(i + 1)}`, clp = impuestosMensuales({ per, docs, boletas: imps.boletas, pagos, liquidaciones: imps.liquidaciones, declarados: imps.declarados, informado: imps.valores?.[per]?.ppm, destinos: imps.destinos || {}, terceros, boletaSet: [...fu.boleta] }).ppm.monto || 0
      return { clp, uf: clp / (ufDelDia(ufDias, finMesOHoy(per), ufRef) || ufRef) } })
    return { R, ppm }
  }
  const A1 = useMemo(() => anio(year), [fu, billing, terceros, costosOfiRows, expenses, clients, imps, ufDias, ufRef, curM, year])   // eslint-disable-line react-hooks/exhaustive-deps
  const A0 = useMemo(() => anio(year - 1), [fu, billing, terceros, costosOfiRows, expenses, clients, imps, ufDias, ufRef, curM, year])   // eslint-disable-line react-hooks/exhaustive-deps

  // Líneas de gastos: la unión de las de ambos años (en su orden), con el subarriendo como menor gasto (signo contrario).
  const gKeys = useMemo(() => { const m = {}; [A1, A0].forEach(A => A.R.forEach(r => (r.cosLines || []).forEach(l => { if (!m[l.k]) m[l.k] = l.l }))); return Object.keys(m).sort((a, b) => ORDEN.indexOf(a) - ORDEN.indexOf(b)).map(k => ({ k, l: m[k] })) }, [A1, A0])

  // Tabla de un año en la moneda elegida y a una escala (`esc`: 1000 = miles de pesos; 1 = UF o pesos exactos). Cada celda se redondea y los subtotales suman celdas ya redondeadas;
  // el total del año es el redondeo del total exacto de cada línea. Los gastos van en negativo (el subarriendo recuperado, positivo).
  const tabla = (A, esc) => {
    const r = x => Math.round((Number(x) || 0) / esc), fila = (get) => [...A.R.map((m, i) => r(get(m, i))), r(suma(A.R.map((m, i) => get(m, i))))]
    const hon = fila(m => enUF ? m.facUF : m.fac), rex = fila(m => enUF ? m.rexUF : m.rex), com = fila(m => -(enUF ? m.comUF : m.com))
    const gas = gKeys.map(g => ({ ...g, v: fila(m => -((m.cosLines || []).filter(l => l.k === g.k).reduce((a, l) => a + (enUF ? l.mUF : l.m), 0))) }))
    const imp = fila((_, i) => -(enUF ? A.ppm[i].uf : A.ppm[i].clp))
    const ing = hon.map((x, i) => x + rex[i]), mb = ing.map((x, i) => x + com[i]), totGas = Array.from({ length: n }, (_, i) => gas.reduce((a, g) => a + g.v[i], 0))
    const res = mb.map((x, i) => x + totGas[i]), neto = res.map((x, i) => x + imp[i])
    return { hon, rex, com, gas, imp, ing, mb, totGas, res, neto }
  }
  const esc = enUF ? 1 : 1000
  const T1 = tabla(A1, esc), T0 = tabla(A0, esc)
  const p0 = (v0) => v0 ? v0[n - 1] : 0   // total del año anterior (mismo período)
  const prevEst = A0.R.some(r => !r.cerrado)

  const cerrado = i => A1.R[i]?.cerrado
  const colsIdx = D ? Array.from({ length: n }, (_, i) => i) : [selM - 1, curM]   // celular: el mes elegido y el total del año
  const nomCol = i => i === curM ? 'Total' : MC[i]
  const goMes = i => i < curM ? () => onGo && onGo('estadoResultados', `${year}-${pad(i + 1)}`) : () => onGo && onGo('resultadoAnio')
  const gasIdx = k => gKeys.findIndex(g => g.k === k)
  const filas = [
    { t: 'sec', l: 'Ingresos de explotación (Revenue)' },
    { t: 'it', l: 'Honorarios facturados', v: T1.hon, w: T0.hon, go: i => () => onGo && onGo('estadoResultados', i < curM ? `${year}-${pad(i + 1)}` : undefined, { bloque: 'ing', sub: 'fac' }) },
    { t: 'it', l: 'Comisiones de externos', v: T1.rex, w: T0.rex, go: goMes },
    { t: 'sub', l: 'Total ingresos de explotación', v: T1.ing, w: T0.ing },
    { t: 'sec', l: 'Costo de ventas (COGS)' },
    { t: 'it', l: 'Comisiones devengadas', v: T1.com, w: T0.com, go: () => () => onGo && onGo('proveedores') },
    { t: 'sub', l: 'Margen bruto (Gross profit)', v: T1.mb, w: T0.mb, pct: true },
    { t: 'sec', l: 'Gastos de administración (Opex)' },
    ...T1.gas.map(g => ({ t: 'it', l: g.l, v: g.v, w: T0.gas[gasIdx(g.k)].v, go: () => () => onGo && onGo('costos') })),
    { t: 'sub', l: 'Total gastos de administración (Opex)', v: T1.totGas, w: T0.totGas },
    { t: 'sub', l: 'Resultado antes de impuestos (EBIT)', v: T1.res, w: T0.res, pct: true },
    { t: 'it', l: 'PPM, impuesto de primera categoría (pago provisional)', v: T1.imp, w: T0.imp },
    { t: 'res', l: 'Resultado después de impuestos (Net income)', v: T1.neto, w: T0.neto, pct: true },
    { t: 'sec', l: 'Partida informativa' },
    { t: 'inf', l: 'EBITDA, igual al EBIT (sin activo fijo no hay depreciación)', v: T1.res, w: T0.res },
  ]

  const exp = () => {
    const X1 = tabla(A1, 1), X0 = tabla(A0, 1)
    const f = (l, a, b) => [l, ...a, p0(b)]
    descargarXlsx({ nombre: `Estado_de_resultados_${year}${enUF ? '_UF' : ''}`, hoja: 'Estado de resultados', head: ['Concepto', ...MC.slice(0, curM), 'Total', `${year - 1} (mismo período)`], anchos: [48, ...Array(n + 1).fill(13)], numCols: Array.from({ length: n + 1 }, (_, i) => i + 1),
      filas: [f('Honorarios facturados', X1.hon, X0.hon), f('Comisiones de externos', X1.rex, X0.rex), f('Total ingresos de explotación (Revenue)', X1.ing, X0.ing), f('Comisiones devengadas', X1.com, X0.com), f('Margen bruto (Gross profit)', X1.mb, X0.mb),
        ...X1.gas.map((g, k) => f(g.l, g.v, X0.gas[k].v)), f('Total gastos de administración (Opex)', X1.totGas, X0.totGas), f('Resultado antes de impuestos (EBIT)', X1.res, X0.res), f('PPM, impuesto de primera categoría', X1.imp, X0.imp), f('Resultado después de impuestos (Net income)', X1.neto, X0.neto), f('EBITDA (igual al EBIT)', X1.res, X0.res)] })
  }

  const pad2 = D ? '7px 12px' : '6px 8px'
  const W = D ? 84 : 72
  // Columnas fijas a la derecha, de izquierda a derecha: total, año anterior, variación y % ingresos (en celular, solo las de la vista elegida).
  const colsDer = D ? ['tot', 'prev', 'var', 'pct'] : (vista === 'prev' ? ['tot', 'prev', 'var'] : ['tot', 'pct'])
  const right = k => (colsDer.length - 1 - colsDer.indexOf(k)) * W
  const fijo = (k, z) => ({ position: 'sticky', right: right(k), zIndex: z, minWidth: W, ...(k === 'tot' ? { boxShadow: `-1px 0 0 ${C.border}` } : {}) })
  const celdaSt = (f, v, extra) => ({ padding: pad2, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', fontWeight: f.t === 'it' || f.t === 'inf' ? 400 : 800, color: f.t === 'inf' ? C.muted : (v < 0 && f.t !== 'it' ? C.overdueText : (f.t === 'it' && v < 0 ? C.text : C.accent)), background: f.t === 'res' ? C.bgSoft : C.card, borderTop: f.t === 'res' ? `1.5px solid ${C.accent}` : f.t === 'sub' ? `1px solid ${C.border}` : 'none', ...extra })
  const muteSt = { fontWeight: 600, color: C.muted }
  const hd = (k, txt, sub) => <th key={k} style={{ ...fijo(k, 2), background: k === 'tot' ? C.border : C.bgSoft, padding: pad2, textAlign: 'right', ...SEC_LBL, fontSize: 10, whiteSpace: 'nowrap' }}>{txt}{sub && <span style={{ display: 'block', fontSize: 8.5, fontWeight: 600, color: C.muted, letterSpacing: 0, textTransform: 'none' }}>{sub}</span>}</th>
  const celdaDer = (k, f) => {
    if (k === 'tot') return <td key={k} style={celdaSt(f, f.v[curM], { ...fijo(k, 1), background: f.t === 'res' ? C.bgSoft : C.bgSoft })}>{fN(f.v[curM])}</td>
    if (k === 'prev') return <td key={k} style={celdaSt(f, f.w[curM], { ...fijo(k, 1), ...muteSt })}>{fN(f.w[curM])}</td>
    if (k === 'var') return <td key={k} style={celdaSt(f, 0, { ...fijo(k, 1), ...muteSt })}>{fVar(f.v[curM], f.w[curM])}</td>
    return <td key={k} style={celdaSt(f, 0, { ...fijo(k, 1), ...muteSt })}>{f.pct || f.t === 'it' || f.t === 'sub' ? fPct(f.v[curM], T1.ing[curM]) : ''}</td>
  }
  const colsMes = D ? Array.from({ length: curM }, (_, i) => i) : (vista === 'prev' ? [] : [selM - 1])   // celular, comparando con el año anterior: solo total, año anterior y variación
  const selSt = { fontSize: 12, fontWeight: 700, color: C.accent, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '5px 8px', fontFamily: 'inherit' }
  const unidad = enUF ? 'UF' : 'miles de pesos'

  return (
    <div style={{ paddingBottom: 40 }}>
      <div onClick={onBack} style={{ fontSize: 12, fontWeight: 700, color: C.accent, cursor: 'pointer', margin: '2px 2px 8px' }}>← {backLabel}</div>
      <div style={{ margin: '0 2px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: D ? 20 : 17, fontWeight: 800, color: C.accent, whiteSpace: 'nowrap' }}>Estado de resultados</div>
          <span onClick={exp} style={{ fontSize: 12, fontWeight: 700, color: C.azulInfo, cursor: 'pointer', whiteSpace: 'nowrap' }}>Excel ›</span>
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{D ? `Enero a ${MESES[curM - 1]} de ${year}, al ${fmtFechaDMY(new Date().toISOString().slice(0, 10))}. Cifras en ${unidad}.` : `Ene a ${MC[curM - 1]} ${year}, ${unidad}`}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: D ? 8 : 6, flexWrap: 'wrap', justifyContent: D ? 'flex-end' : 'flex-start' }}>
          {!D && vista !== 'prev' && <select value={selM} onChange={e => setSelM(Number(e.target.value))} style={selSt}>{MESES.slice(0, curM).map((m, i) => <option key={m} value={i + 1}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>)}</select>}
          {!D && <select value={vista} onChange={e => setVista(e.target.value)} style={selSt}><option value='pct'>% de ingresos</option><option value='prev'>vs {year - 1}</option></select>}
          <select value={moneda} onChange={e => setMoneda(e.target.value)} style={selSt}><option value='CLP'>CLP</option><option value='UF'>UF</option></select>
        </div>
      </div>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: D ? 12.5 : 12 }}>
            <thead><tr>
              <th style={{ position: 'sticky', left: 0, zIndex: 2, background: C.bgSoft, padding: pad2, textAlign: 'left', ...SEC_LBL, fontSize: 10, minWidth: D ? 270 : 150 }}>Concepto</th>
              {colsMes.map(i => <th key={i} onClick={goMes(i)} style={{ background: C.bgSoft, padding: pad2, textAlign: 'right', ...SEC_LBL, fontSize: 10, cursor: 'pointer', whiteSpace: 'nowrap' }}>{nomCol(i)}{!cerrado(i) && <span style={{ display: 'block', fontSize: 8.5, fontWeight: 600, color: C.muted, letterSpacing: 0, textTransform: 'none' }}>estimado</span>}</th>)}
              {colsDer.map(k => k === 'tot' ? hd(k, 'Total') : k === 'prev' ? hd(k, String(year - 1), prevEst ? 'estimado' : 'mismo período') : k === 'var' ? hd(k, 'Var. %') : hd(k, '% ingresos'))}
            </tr></thead>
            <tbody>
              {filas.map((f, k) => f.t === 'sec'
                ? <tr key={k}><td colSpan={colsMes.length + colsDer.length + 1} style={{ padding: D ? '12px 12px 4px' : '10px 8px 3px', ...SEC_LBL, fontSize: 10.5 }}>{f.l}</td></tr>
                : <tr key={k}>
                  <td style={{ position: 'sticky', left: 0, zIndex: 1, background: f.t === 'res' ? C.bgSoft : C.card, padding: pad2, paddingLeft: f.t === 'it' || f.t === 'inf' ? (D ? 26 : 16) : (D ? 12 : 8), fontWeight: f.t === 'it' || f.t === 'inf' ? 400 : 800, color: f.t === 'inf' ? C.muted : f.t === 'it' ? C.text : C.accent, borderTop: f.t === 'res' ? `1.5px solid ${C.accent}` : f.t === 'sub' ? `1px solid ${C.border}` : 'none', whiteSpace: D ? 'nowrap' : 'normal' }}>{f.l}</td>
                  {colsMes.map(i => <td key={i} onClick={f.go ? f.go(i) : undefined} style={celdaSt(f, f.v[i], { cursor: f.go ? 'pointer' : 'default' })}>{fN(f.v[i])}</td>)}
                  {colsDer.map(kk => celdaDer(kk, f))}
                </tr>)}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{ fontSize: 11, color: C.muted, margin: '10px 2px 0', lineHeight: 1.5 }}>
        Los gastos se muestran en negativo; el subarriendo y los gastos recuperados reducen los gastos. Los meses «estimado» usan el presupuesto de oficina mientras no se carguen sus costos reales. Los subtotales suman las cifras redondeadas a {enUF ? 'UF enteras' : 'miles'}. El impuesto es solo el PPM del período, anticipo del impuesto de primera categoría; el impuesto anual se liquida en abril. El PPM es el declarado en el F29; mientras un mes no se declara, se estima con la tasa declarada sobre la base del mes. {year - 1} se compara de enero a {MESES[curM - 1]}{prevEst ? ' y sus costos son estimados, porque no están cargados los costos reales de ese año' : ''}.{enUF ? ' En UF, cada cifra va a la UF del día de su movimiento.' : ''}
      </div>
    </div>)
}
