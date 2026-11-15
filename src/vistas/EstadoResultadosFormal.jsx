// Estado de resultados formal: el estado de resultados como se arma en finanzas (ingresos de explotación, costo de ventas, margen bruto, gastos de administración y
// resultado del ejercicio), con una columna por mes, el total del año y el porcentaje sobre ingresos. No calcula nada propio: cada columna es resultadoMes (la misma función
// de Inicio, Oficina y Resultado del año), así que el resultado coincide con el de esas pantallas. Cifras en miles de pesos; los subtotales se arman con las cifras ya
// redondeadas para que el estado sume. El Excel baja los pesos exactos.
import { useMemo, useState } from 'react'
import { C, SEC_LBL, fmtFechaDMY, useIsDesktop } from '../lib/base.jsx'
import { resultadoMes, useFuentesResultado, useImpuestosFuentes, currentYear } from '../lib/compartido.jsx'
import { descargarXlsx } from '../lib/seleccionLote.jsx'
import { DEMO } from '../supabase'
import { impuestosMensuales, pagosConBoleta, idOficina } from '../../supabase/functions/_shared/impuestosMensuales.js'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const MC = MESES.map(m => m.slice(0, 3))
const pad = n => String(n).padStart(2, '0')
const miles = x => Math.round((Number(x) || 0) / 1000)
const fN = n => n === 0 ? '0' : (n < 0 ? '−' : '') + Math.abs(n).toLocaleString('es-CL')
const fPct = (a, b) => { if (!(b > 0)) return ''; const v = Math.round(a / b * 1000) / 10; return (v < 0 ? '−' : '') + Math.abs(v).toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %' }

export function EstadoResultadosFormal({ billing = [], terceros = [], costosOfiRows = [], expenses = [], clients = [], backLabel = 'Oficina', onBack, onGo }) {
  const D = useIsDesktop()
  const fu = useFuentesResultado()
  const year = currentYear, curM = new Date().getMonth() + 1
  const [selM, setSelM] = useState(curM)
  const deps = { billing, terceros, costosOfiRows, expenses, clients }
  const R = useMemo(() => Array.from({ length: curM }, (_, i) => resultadoMes(fu, deps, `${year}-${pad(i + 1)}`)), [fu, billing, terceros, costosOfiRows, expenses, clients, curM, year])

  // Líneas de gastos de administración: la unión de las líneas de costo de todos los meses (en su orden), con el subarriendo como menor gasto (signo contrario).
  const gastos = useMemo(() => {
    const orden = ['rem', 'cot', 'arr', 'con', 'otr', 'pre', 'gv', 'sub'], mapa = {}
    R.forEach((r, i) => (r.cosLines || []).forEach(l => { const o = mapa[l.k] || (mapa[l.k] = { k: l.k, l: l.l, m: Array(curM).fill(0) }); o.m[i] += l.m }))
    return Object.values(mapa).sort((a, b) => orden.indexOf(a.k) - orden.indexOf(b.k))
  }, [R, curM])

  // Cada fila es un arreglo de `curM` cifras exactas en pesos (la última columna del total se calcula aparte).
  const fil = {
    hon: R.map(r => r.fac), rex: R.map(r => r.rex), com: R.map(r => -r.com),
  }
  const suma = a => a.reduce((x, y) => x + y, 0)
  // Cifras mostradas: cada celda a miles; subtotales sumando celdas ya redondeadas (cada columna suma). Total del año = redondeo del total exacto de cada línea.
  const cel = a => a.map(miles)
  const tot = a => miles(suma(a))
  const L = {
    hon: [...cel(fil.hon), tot(fil.hon)], rex: [...cel(fil.rex), tot(fil.rex)], com: [...cel(fil.com), tot(fil.com)],
    gas: gastos.map(g => ({ ...g, v: [...cel(g.m), tot(g.m)].map(x => -x) })),
  }
  // Los gastos van en negativo; el subarriendo recuperado es menor gasto y queda positivo.
  const n = curM + 1
  const ing = Array.from({ length: n }, (_, i) => L.hon[i] + L.rex[i])
  const mb = Array.from({ length: n }, (_, i) => ing[i] + L.com[i])
  const totGas = Array.from({ length: n }, (_, i) => L.gas.reduce((a, g) => a + g.v[i], 0))
  const res = Array.from({ length: n }, (_, i) => mb[i] + totGas[i])
  // Impuesto = solo el PPM del período (anticipo del impuesto de primera categoría): el PPM puro de impuestosMensuales, con las mismas fuentes que Resultado del año
  // (no el total del F29, que trae también retenciones e impuesto único de trabajadores).
  const imps = useImpuestosFuentes(), ofiId = useMemo(() => idOficina(clients), [clients])
  const ppmEx = useMemo(() => { const pagos = DEMO ? (imps.pagos || []) : pagosConBoleta({ expenses, ofiId, boletaSet: fu.boleta, terceros }), docs = (fu.sii && fu.sii.length ? fu.sii : imps.docs) || []
    return R.map((_, i) => -(impuestosMensuales({ per: `${year}-${pad(i + 1)}`, docs, boletas: imps.boletas, pagos, liquidaciones: imps.liquidaciones, declarados: imps.declarados, informado: imps.valores?.[`${year}-${pad(i + 1)}`]?.ppm, destinos: imps.destinos || {}, terceros, boletaSet: [...fu.boleta] }).ppm.monto || 0)) }, [R, fu, imps, expenses, ofiId, terceros, year])
  const imp = [...ppmEx.map(miles), miles(suma(ppmEx))]
  const neto = Array.from({ length: n }, (_, i) => res[i] + imp[i])

  const cerrado = i => R[i]?.cerrado
  const colsIdx = D ? Array.from({ length: n }, (_, i) => i) : [selM - 1, curM]   // celular: el mes elegido y el total del año
  const nomCol = i => i === curM ? 'Total' : MC[i]

  // Filas de la tabla: {t: tipo, l: rótulo, v: arreglo, go: destino}
  const goMes = i => i < curM ? () => onGo && onGo('estadoResultados', `${year}-${pad(i + 1)}`) : () => onGo && onGo('resultadoAnio')
  const filas = [
    { t: 'sec', l: 'Ingresos de explotación (Revenue)' },
    { t: 'it', l: 'Honorarios facturados', v: L.hon, go: i => () => onGo && onGo('estadoResultados', i < curM ? `${year}-${pad(i + 1)}` : undefined, { bloque: 'ing', sub: 'fac' }) },
    { t: 'it', l: 'Comisiones de externos', v: L.rex, go: goMes },
    { t: 'sub', l: 'Total ingresos de explotación', v: ing },
    { t: 'sec', l: 'Costo de ventas (COGS)' },
    { t: 'it', l: 'Comisiones devengadas', v: L.com, go: () => () => onGo && onGo('proveedores') },
    { t: 'sub', l: 'Margen bruto (Gross profit)', v: mb, pct: true },
    { t: 'sec', l: 'Gastos de administración (Opex)' },
    ...L.gas.map(g => ({ t: 'it', l: g.l, v: g.v, go: () => () => onGo && onGo('costos') })),
    { t: 'sub', l: 'Total gastos de administración (Opex)', v: totGas },
    { t: 'sub', l: 'Resultado antes de impuestos (EBIT)', v: res, pct: true },
    { t: 'it', l: 'PPM, impuesto de primera categoría (pago provisional)', v: imp },
    { t: 'res', l: 'Resultado después de impuestos (Net income)', v: neto, pct: true },
    { t: 'sec', l: 'Partida informativa' },
    { t: 'inf', l: 'EBITDA, igual al EBIT (sin activo fijo no hay depreciación)', v: res },
  ]

  const exp = () => {
    const ex = a => a.map(x => Math.round(x))
    const sx = a => Math.round(suma(a))
    const hon = [...ex(fil.hon), sx(fil.hon)], rex = [...ex(fil.rex), sx(fil.rex)], com = [...ex(fil.com), sx(fil.com)]
    const ga = gastos.map(g => [g.l, ...ex(g.m).map(x => -x), -sx(g.m)])
    const ing2 = hon.map((x, i) => x + rex[i]), mb2 = ing2.map((x, i) => x + com[i]), tg = ga.reduce((a, g) => a.map((x, i) => x + g[i + 1]), Array(n).fill(0)), r2 = mb2.map((x, i) => x + tg[i])
    const ix = [...ppmEx.map(x => Math.round(x)), Math.round(suma(ppmEx))]
    descargarXlsx({ nombre: `Estado_de_resultados_${year}`, hoja: 'Estado de resultados', head: ['Concepto', ...MC.slice(0, curM), 'Total'], anchos: [44, ...Array(n).fill(13)], numCols: Array.from({ length: n }, (_, i) => i + 1),
      filas: [['Honorarios facturados', ...hon], ['Comisiones de externos', ...rex], ['Total ingresos de explotación (Revenue)', ...ing2], ['Comisiones devengadas', ...com], ['Margen bruto (Gross profit)', ...mb2], ...ga, ['Total gastos de administración (Opex)', ...tg], ['Resultado antes de impuestos (EBIT)', ...r2], ['PPM, impuesto de primera categoría', ...ix], ['Resultado después de impuestos (Net income)', ...r2.map((x, i) => x + ix[i])], ['EBITDA (igual al EBIT)', ...r2]] })
  }

  const pad2 = D ? '7px 12px' : '6px 8px'
  const PCT_W = D ? 84 : 70
  const celdaSt = (f, i, esTot) => ({ ...(esTot ? { position: 'sticky', right: PCT_W, zIndex: 1, boxShadow: `-1px 0 0 ${C.border}` } : {}), padding: pad2, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', fontWeight: f.t === 'it' || f.t === 'inf' ? 400 : 800, color: f.t === 'inf' ? C.muted : (f.v && f.v[i] < 0 && f.t !== 'it' ? C.overdueText : (f.t === 'it' && f.v[i] < 0 ? C.text : C.accent)), background: f.t === 'res' ? C.bgSoft : (esTot ? C.bgSoft : C.card), borderTop: f.t === 'res' ? `1.5px solid ${C.accent}` : f.t === 'sub' ? `1px solid ${C.border}` : 'none', cursor: f.go ? 'pointer' : 'default' })

  return (
    <div style={{ paddingBottom: 40 }}>
      <div onClick={onBack} style={{ fontSize: 12, fontWeight: 700, color: C.accent, cursor: 'pointer', margin: '2px 2px 8px' }}>← {backLabel}</div>
      <div style={{ margin: '0 2px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: D ? 20 : 17, fontWeight: 800, color: C.accent, whiteSpace: 'nowrap' }}>Estado de resultados</div>
          <span onClick={exp} style={{ fontSize: 12, fontWeight: 700, color: C.azulInfo, cursor: 'pointer', whiteSpace: 'nowrap' }}>Excel ›</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: C.muted }}>{D ? `Enero a ${MESES[curM - 1]} de ${year}, al ${fmtFechaDMY(new Date().toISOString().slice(0, 10))}. Cifras en miles de pesos.` : `Ene a ${MC[curM - 1]} ${year}, miles de pesos`}</div>
          {!D && <select value={selM} onChange={e => setSelM(Number(e.target.value))} style={{ fontSize: 12, fontWeight: 700, color: C.accent, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '5px 8px', fontFamily: 'inherit' }}>{MESES.slice(0, curM).map((m, i) => <option key={m} value={i + 1}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>)}</select>}
        </div>
      </div>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: D ? 12.5 : 12 }}>
            <thead><tr>
              <th style={{ position: 'sticky', left: 0, zIndex: 2, background: C.bgSoft, padding: pad2, textAlign: 'left', ...SEC_LBL, fontSize: 10, minWidth: D ? 290 : 150 }}>Concepto</th>
              {colsIdx.map(i => <th key={i} onClick={goMes(i)} style={{ ...(i === curM ? { position: 'sticky', right: PCT_W, zIndex: 2, boxShadow: `-1px 0 0 ${C.border}` } : {}), background: i === curM ? C.border : C.bgSoft, padding: pad2, textAlign: 'right', ...SEC_LBL, fontSize: 10, cursor: 'pointer', whiteSpace: 'nowrap' }}>{nomCol(i)}{i < curM && !cerrado(i) && <span style={{ display: 'block', fontSize: 8.5, fontWeight: 600, color: C.muted, letterSpacing: 0, textTransform: 'none' }}>estimado</span>}</th>)}
              <th style={{ position: 'sticky', right: 0, zIndex: 2, minWidth: PCT_W, background: C.bgSoft, padding: pad2, textAlign: 'right', ...SEC_LBL, fontSize: 10, whiteSpace: 'nowrap' }}>% ingresos</th>
            </tr></thead>
            <tbody>
              {filas.map((f, k) => f.t === 'sec'
                ? <tr key={k}><td colSpan={colsIdx.length + 2} style={{ padding: D ? '12px 12px 4px' : '10px 8px 3px', ...SEC_LBL, fontSize: 10.5 }}>{f.l}</td></tr>
                : <tr key={k}>
                  <td style={{ position: 'sticky', left: 0, zIndex: 1, background: f.t === 'res' ? C.bgSoft : C.card, padding: pad2, paddingLeft: f.t === 'it' || f.t === 'inf' ? (D ? 26 : 16) : (D ? 12 : 8), fontWeight: f.t === 'it' || f.t === 'inf' ? 400 : 800, color: f.t === 'inf' ? C.muted : f.t === 'it' ? C.text : C.accent, borderTop: f.t === 'res' ? `1.5px solid ${C.accent}` : f.t === 'sub' ? `1px solid ${C.border}` : 'none', whiteSpace: D ? 'nowrap' : 'normal' }}>{f.l}</td>
                  {colsIdx.map(i => <td key={i} onClick={f.go ? f.go(i) : undefined} style={celdaSt(f, i, i === curM)}>{fN(f.v[i])}</td>)}
                  <td style={{ ...celdaSt(f, curM, false), position: 'sticky', right: 0, zIndex: 1, minWidth: PCT_W, fontWeight: 600, color: C.muted }}>{f.pct || f.t === 'it' || f.t === 'sub' ? fPct(f.v[curM], ing[curM]) : ''}</td>
                </tr>)}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{ fontSize: 11, color: C.muted, margin: '10px 2px 0', lineHeight: 1.5 }}>
        Los gastos se muestran en negativo; el subarriendo y los gastos recuperados reducen los gastos. Los meses «estimado» usan el presupuesto de oficina mientras no se carguen sus costos reales. Los subtotales suman las cifras redondeadas a miles. El impuesto es solo el PPM del período, anticipo del impuesto de primera categoría; el impuesto anual se liquida en abril. El PPM es el declarado en el F29; mientras un mes no se declara, se estima con la tasa declarada sobre la base del mes.
      </div>
    </div>)
}
