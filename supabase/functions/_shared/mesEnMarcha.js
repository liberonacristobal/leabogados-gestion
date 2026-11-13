// «Mes en marcha»: ¿lo cobrado en el mes (neto de comisiones) cubre los gastos fijos de la oficina, los ya pagados y los que faltan?
// Funciones puras sobre los gastos de la oficina (expenses del cliente interno, por FECHA DE PAGO en el banco) y los cargos del banco sin clasificar.
// No calcula el cobrado (sale del «Cobrado propio» de la app) ni las comisiones (las de resultadoMes): solo agrupa, proyecta lo que falta y arma la cascada.

/** @typedef {{id?:any, date?:string, category?:string|null, subcategory?:string|null, concept?:string|null, amount?:number|string|null, type?:string|null, deleted_at?:any}} Gasto */
/** @typedef {{k:string, l:string, proy:boolean}} GrupoDef */

/** Grupos de gasto fijo de la oficina. `proy` = se proyecta cuando aún no se paga en el mes. */
export const GRUPOS = /** @type {Record<string, GrupoDef>} */ ({
  sueldos: { k: 'sueldos', l: 'Sueldos', proy: true },
  arriendo: { k: 'arriendo', l: 'Arriendo', proy: true },
  gc: { k: 'gc', l: 'Gastos comunes', proy: true },
  leyes: { k: 'leyes', l: 'Leyes sociales', proy: true },
  f29: { k: 'f29', l: 'IVA y PPM', proy: true },
  contadora: { k: 'contadora', l: 'Contadora', proy: true },
  tarjeta: { k: 'tarjeta', l: 'Tarjeta de crédito', proy: true },
  aseo: { k: 'aseo', l: 'Aseo', proy: true },
  impuestos: { k: 'impuestos', l: 'Impuestos y patentes', proy: false },
})

const t = (/** @type {any} */ s) => String(s || '').toLowerCase()

/** Grupo de un gasto de la oficina, o null si no es un gasto fijo (retiros, comisiones, proveedores, caja chica, etc.). @param {Gasto} e */
export function grupoDeGasto(e) {
  if (!e || e.deleted_at || e.type !== 'gasto') return null
  const c = t(e.category), k = t(e.concept)
  if (c === 'sueldos' || c === 'bono') return 'sueldos'
  if (c === 'arriendo' || c === 'arriendo y espacio') return 'arriendo'
  if (c === 'gastos comunes') return 'gc'
  if (c === 'leyes sociales') return 'leyes'
  if (c === 'impuestos y patentes') return /iva|ppm|f29/.test(k) ? 'f29' : 'impuestos'
  if (c === 'remuneraciones') return 'contadora'
  if (c === 'tarjeta de crédito' || c === 'software' || c === 'servicios') return 'tarjeta'
  if (c === 'otros' && /aseo/.test(k)) return 'aseo'
  return null
}

const ymDe = (/** @type {any} */ iso) => String(iso || '').slice(0, 7)
const dia = (/** @type {any} */ iso) => Number(String(iso || '').slice(8, 10)) || 0
const num = (/** @type {any} */ n) => Number(n) || 0
const iso = (/** @type {number} */ y, /** @type {number} */ m, /** @type {number} */ d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const finMes = (/** @type {string} */ ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate() }
const mesAnt = (/** @type {string} */ ym) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const mediana = (/** @type {number[]} */ a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), i = Math.floor(s.length / 2); return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2 }

/** Último día hábil del mes (ISO). @param {string} ym @param {(iso:string)=>boolean} esHabil */
export function ultimoDiaHabil(ym, esHabil) {
  const [y, m] = ym.split('-').map(Number)
  for (let d = finMes(ym); d >= 1; d--) { const f = iso(y, m, d); if (esHabil(f)) return f }
  return iso(y, m, finMes(ym))
}

/**
 * Gastos del mes pagados, agrupados por grupo y fecha de pago (una fila por grupo y día; los sueldos de varias personas el mismo día suman).
 * @param {Gasto[]} gastos gastos de la oficina @param {string} ym
 * @returns {{k:string, l:string, fecha:string, monto:number, ids:any[], n:number}[]}
 */
export function gastosPagados(gastos, ym) {
  /** @type {Record<string, {k:string,l:string,fecha:string,monto:number,ids:any[],n:number}>} */ const m = {}
  ;(gastos || []).forEach(e => {
    const g = grupoDeGasto(e); if (!g || ymDe(e.date) !== ym) return
    const f = String(e.date).slice(0, 10), key = g + '|' + f
    const x = (m[key] = m[key] || { k: g, l: GRUPOS[g].l, fecha: f, monto: 0, ids: [], n: 0 })
    x.monto += num(e.amount); x.ids.push(e.id); x.n++ })
  return Object.values(m).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.l.localeCompare(b.l))
}

/**
 * Gastos que aún faltan por pagar en el mes (mes en curso): por cada grupo sin pago en el mes, se proyecta el monto del último pago y el día habitual.
 * Sueldos: monto del último ciclo de pago (pagos separados por menos de 5 días) el último día hábil del mes, mientras no se haya pagado ese ciclo.
 * Solo proyecta fechas posteriores a hoy. @param {Gasto[]} gastos @param {string} ym @param {string} hoy ISO @param {(iso:string)=>boolean} esHabil
 * @returns {{k:string, l:string, fecha:string, monto:number}[]}
 */
export function gastosPorPagar(gastos, ym, hoy, esHabil) {
  if (ymDe(hoy) !== ym) return []
  const out = []
  const pagadosMes = /** @type {Set<string|null>} */ (new Set((gastos || []).filter(e => grupoDeGasto(e) && ymDe(e.date) === ym).map(e => grupoDeGasto(e))))
  const prev = mesAnt(ym), prev2 = mesAnt(prev), prev3 = mesAnt(prev2)
  for (const g of Object.keys(GRUPOS)) {
    if (!GRUPOS[g].proy) continue
    if (g === 'sueldos') {
      const ult = ultimoDiaHabil(ym, esHabil), ya = (gastos || []).some(e => grupoDeGasto(e) === 'sueldos' && ymDe(e.date) === ym && String(e.date).slice(0, 10) >= iso(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), Math.max(1, dia(ult) - 3)))
      if (ya || ult <= hoy) continue
      const pagos = (gastos || []).filter(e => grupoDeGasto(e) === 'sueldos' && String(e.date).slice(0, 10) < hoy).sort((a, b) => String(a.date).localeCompare(String(b.date)))
      if (!pagos.length) continue
      // último ciclo: hacia atrás desde el pago más reciente, mientras el pago anterior esté a menos de 5 días
      let monto = 0, fAnt = null
      for (let i = pagos.length - 1; i >= 0; i--) { const f = new Date(String(pagos[i].date).slice(0, 10) + 'T12:00:00').getTime(); if (fAnt != null && (fAnt - f) / 864e5 >= 5) break; monto += num(pagos[i].amount); fAnt = f }
      if (monto > 0) out.push({ k: g, l: GRUPOS[g].l, fecha: ult, monto })
      continue
    }
    if (pagadosMes.has(g)) continue
    const previos = (gastos || []).filter(e => grupoDeGasto(e) === g && [prev, prev2, prev3].includes(ymDe(e.date)))
    const porMes = {}; previos.forEach(e => { const k = ymDe(e.date); (porMes[k] = porMes[k] || { monto: 0, dias: [] }); porMes[k].monto += num(e.amount); porMes[k].dias.push(dia(e.date)) })
    const ms = Object.keys(porMes).sort(); if (!ms.length) continue
    const ultimo = porMes[ms[ms.length - 1]], d = Math.min(finMes(ym), Math.round(mediana(ms.flatMap(k => porMes[k].dias))))
    const f = iso(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), Math.max(1, d))
    if (f > hoy && ultimo.monto > 0) out.push({ k: g, l: GRUPOS[g].l, fecha: f, monto: ultimo.monto })
  }
  return out.sort((a, b) => a.fecha.localeCompare(b.fecha))
}

/**
 * Cascada de cobertura. Cobrado neto − pagados (− por pagar). Todo se redondea a `paso` y cuadra: cada saldo es la resta de las cifras mostradas.
 * @param {{cobrado:number, pagado:number, porPagar:number, paso?:number}} o
 * @returns {{cobrado:number, pagado:number, porPagar:number, trasPagados:number, saldo:number, falta:number, cubrePagados:boolean}}
 */
export function cascadaCobertura(o) {
  const p = o.paso || 1e5, r = (/** @type {number} */ x) => Math.round((Number(x) || 0) / p) * p
  const cobrado = r(o.cobrado), pagado = r(o.pagado), porPagar = r(o.porPagar)
  const trasPagados = cobrado - pagado, saldo = trasPagados - porPagar
  return { cobrado, pagado, porPagar, trasPagados, saldo, falta: saldo < 0 ? -saldo : 0, cubrePagados: trasPagados >= 0 }
}
