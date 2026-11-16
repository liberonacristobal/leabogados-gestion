// Presupuesto contra real de los costos de la oficina, en costos BRUTOS por categoría. Regla ÚNICA y pura (la usan el Estado de resultados y su Excel): no lee ni escribe la base.
//   Presupuesto = Costos de oficina (sin PPM, sin el subarriendo ni los gastos recuperados), vigente por mes con desde/monto_prev.
//   Real = las líneas de costo de resultadoMes SIN la de subarriendo (planilla + banco + gastos varios); un mes sin planilla toma su presupuesto más los gastos varios reales.
//   Solo meses cerrados: el mes en curso trae costos parciales y se compararía contra su presupuesto completo.

const _n = (/** @type {any} */ x) => { const v = Number(x); return Number.isFinite(v) ? v : 0 }
export const CATS_PVR = /** @type {Array<[string,string]>} */ ([['rem', 'Remuneraciones'], ['cot', 'Leyes sociales'], ['arr', 'Arriendo y GGCC'], ['gv', 'Gastos varios'], ['con', 'Contadora']])
const LMAP = /** @type {Record<string,string>} */ ({ rem: 'rem', cot: 'cot', arr: 'arr', con: 'con', otr: 'gv', gv: 'gv' })
const vacio = () => /** @type {Record<string,number>} */ ({ rem: 0, cot: 0, arr: 0, gv: 0, con: 0 })
const tot = (/** @type {Record<string,number>} */ o) => Object.values(o).reduce((a, v) => a + v, 0)

/**
 * @param {{ costosOfiRows:any[], rmes:Record<number,any>, yr:number, curY:number, curM:number, esPPM:(r:any)=>boolean, iuMes?:(m:number)=>number }} o `iuMes(m)` = impuesto único de las líneas de Remuneraciones en ese mes (va en Remuneraciones, como en lo real)
 * `rmes[m]` = resultadoMes del mes m (1 a 12). Devuelve null si no hay presupuesto.
 */
export function presupuestoVsReal({ costosOfiRows, rmes, yr, curY, curM, esPPM, iuMes }) {
  const pad = (/** @type {number} */ m) => `${yr}-${String(m).padStart(2, '0')}`
  const cerM = yr < curY ? 12 : curM - 1
  const allM = Array.from({ length: Math.max(0, cerM) }, (_, i) => i + 1)
  const budCat = (/** @type {any} */ r) => { const c = String(r.categoria || ''), it = String(r.item || ''); if (/contador/i.test(it)) return 'con'; if (c === 'Remuneraciones') return 'rem'; if (c === 'Leyes sociales') return 'cot'; if (c === 'Arriendo y espacio' && !/limpieza|aseo/i.test(it)) return 'arr'; return 'gv' }
  const budM = (/** @type {number} */ m) => { const o = vacio(); (costosOfiRows || []).filter((r) => r && r.activo !== false && !r.es_ingreso && !esPPM(r)).forEach((r) => { const eff = (r.desde && pad(m) < String(r.desde).slice(0, 7)) ? (r.monto_prev ?? r.monto) : r.monto; o[budCat(r)] += _n(eff) }); if (iuMes) o.rem += _n(iuMes(m)); return o }
  const realM = (/** @type {number} */ m) => {
    const r = rmes[m], o = vacio(); if (!r) return o
    if (!r.conPlanilla) { const b = budM(m); Object.keys(o).forEach((k) => { o[k] = b[k] }); o.gv += _n(r.gv); return o }
    ;(r.cosLines || []).forEach((/** @type {any} */ x) => { const k = LMAP[x.k]; if (k) o[k] += _n(x.m) }); return o
  }
  const filas = allM.map((m) => { const b = budM(m), r = realM(m); return { m, b, r, bt: tot(b), rt: tot(r), est: !!(rmes[m] && (rmes[m].estimado || !rmes[m].conPlanilla)) } })
  const bud = filas.reduce((a, f) => a + f.bt, 0), real = filas.reduce((a, f) => a + f.rt, 0), dv = real - bud
  if (!(bud > 0)) return null
  const resto = Array.from({ length: 12 - cerM }, (_, i) => cerM + 1 + i), budResto = resto.reduce((a, m) => a + tot(budM(m)), 0)
  const proy = real + budResto, budAnio = bud + budResto
  const catTot = (/** @type {string} */ k) => ({ b: filas.reduce((a, f) => a + f.b[k], 0), r: filas.reduce((a, f) => a + f.r[k], 0) })
  const gvGrupos = (() => {
    /** @type {Record<string,number>} */ const g = {}
    allM.forEach((m) => (rmes[m]?.gvItems || []).forEach((/** @type {any} */ e) => { const l = [e.category, e.subcategory].filter(Boolean).join(' › ') || 'Sin categoría'; g[l] = (g[l] || 0) + _n(e.amount) }))
    const otr = allM.reduce((a, m) => a + (_n((rmes[m]?.cosLines || []).find((/** @type {any} */ x) => x.k === 'otr')?.m) || 0), 0); if (otr) g['Otros (planilla)'] = otr
    return Object.entries(g).sort((a, b) => b[1] - a[1])
  })()
  return { cerM, allM, CATS: CATS_PVR, filas, bud, real, dv, resto, budResto, proy, budAnio, catTot, gvGrupos, budM, tot }
}
