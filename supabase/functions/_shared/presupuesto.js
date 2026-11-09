// presupuesto.js — reglas del PRESUPUESTO ANUAL (año siguiente): modelo por escenario, migración del estado guardado, diferencia entre versiones,
// días de cobro y meses atípicos. Funciones puras (sin lectura ni escritura de la base): las usan la vista Presupuesto y, más adelante, los avisos del
// seguimiento. Con prueba en tests/presupuesto.test.mjs.
//
// Plano: CAJA (el régimen Pro Pyme tributa lo percibido menos lo pagado). Sociedad de profesionales exenta de IVA: lo facturado es el neto.

/** @typedef {{ g:number, alza:number, terc:number, dias:number }} Supuestos  g = crecimiento real de ventas (% en UF); alza = alza de costos (%); terc = comisiones (% de lo cobrado); dias = días de cobro */
/** @typedef {{ id:number|string, n:string, m:number, meses:number, t:string, alza:number|null }} PartidaCosto  m = monto por mes; meses = meses del año; alza propia (null = la del escenario) */
/** Parte de cada socio en las metas de la oficina: partes iguales entre los socios (con dos socios, 50 % cada uno). «Sin socio» no tiene meta.
 * @param {{ nombre:string }[]} socios @param {string} nombre */
export const parteMeta = (socios, nombre) => { const n = (socios || []).filter((s) => s.nombre !== 'Sin socio').length; return n && nombre !== 'Sin socio' ? 1 / n : 0 }

/**
 * Tasa de primera categoría del régimen Pro Pyme general (14 D N°3) por año COMERCIAL. Circular SII N° 53 de 2025 (Ley 21.755): 12,5 % en 2025, 2026 y 2027 y 15 % en 2028,
 * siempre que la cotización del empleador (Ley 21.735) sea la del año (la circular la da por cumplida hasta 2028); desde 2029 la tasa permanente es 25 %.
 * @param {number|null|undefined} anio
 */
export const tasaIDPCLegal = (anio) => { const a = num(anio, 2027); return a <= 2027 ? 12.5 : a === 2028 ? 15 : 25 }

/**
 * Tasa legal del PPM de un contribuyente 14 D N°3 (% de los ingresos brutos del giro). Normal: 0,25 % (ingresos del año anterior hasta 50.000 UF) o 0,5 % (más de 50.000 UF);
 * con la rebaja transitoria (ingresos de agosto de 2025 a diciembre de 2027) queda en 0,125 % o 0,25 %. Sin rebaja desde 2028 (Circular SII N° 53 de 2025, § 2.2 y 2.3).
 * @param {number|null|undefined} anio @param {number|null|undefined} ufAnterior ingresos brutos del año anterior en UF
 */
export const tasaPPMLegal = (anio, ufAnterior) => { const grande = num(ufAnterior) > 50_000; return num(anio, 2027) <= 2027 ? (grande ? 0.25 : 0.125) : (grande ? 0.5 : 0.25) }

/** @typedef {{ v:number, esc:string, moneda:string, reajusteUF:number, tasaIDPC:number, ppmTasa:number, reserva:number, p:Record<string,Supuestos>, costos:PartidaCosto[], hecho:number[], notas:Record<string,string>, basadaEn:string|null }} EstadoPresupuesto */
/** @typedef {{ baseCLP:number[], baseUF:number[], ufDic:number }} BasePresupuesto  base de 12 meses (enero a diciembre del año del presupuesto) en pesos y UF, y UF de cierre del año anterior */

export const ESCENARIOS = /** @type {[string,string][]} */ ([['prudente', 'Prudente'], ['base', 'Base'], ['meta', 'Meta']])

/** Supuestos de partida de cada escenario: criterio inicial editable, no un cálculo (el crecimiento) o el dato real del año anterior (terceros, días de cobro). */
export const PALANCAS_INICIALES = /** @type {Record<string,Supuestos>} */ ({
  prudente: { g: 0, alza: 6, terc: 24.4, dias: 35 },
  base: { g: 10, alza: 4.5, terc: 24.4, dias: 24 },
  meta: { g: 25, alza: 4.5, terc: 24.4, dias: 24 },
})

const sum = (/** @type {number[]} */ a) => a.reduce((x, y) => x + (Number(y) || 0), 0)
const num = (/** @type {any} */ x, d = 0) => { const n = Number(x); return Number.isFinite(n) ? n : d }

/**
 * Estado inicial editable. `terc` y `dias` (reales del año anterior) reemplazan el valor de partida de los escenarios Base y Meta; el Prudente supone cobro más lento.
 * `anio` (año comercial del presupuesto) define las tasas legales de partida: primera categoría y PPM sobre lo facturado (`ufAnterior` = ingresos del año anterior en UF).
 * @param {{ costos?:PartidaCosto[], terc?:number|null, dias?:number|null, tasa?:number, ppmTasa?:number, anio?:number, ufAnterior?:number, reajusteUF?:number, reserva?:number }} [o]
 * @returns {EstadoPresupuesto}
 */
export function estadoInicial(o = {}) {
  const p = /** @type {Record<string,Supuestos>} */ (JSON.parse(JSON.stringify(PALANCAS_INICIALES)))
  if (o.terc != null && Number.isFinite(Number(o.terc))) for (const k of Object.keys(p)) p[k].terc = Math.round(Number(o.terc) * 10) / 10
  if (o.dias != null && Number.isFinite(Number(o.dias)) && Number(o.dias) > 0) { p.base.dias = Math.round(Number(o.dias)); p.meta.dias = Math.round(Number(o.dias)); p.prudente.dias = Math.max(p.prudente.dias, Math.round(Number(o.dias)) + 10) }
  return {
    v: 3, esc: 'base', moneda: 'clp', reajusteUF: num(o.reajusteUF, 3.5), tasaIDPC: num(o.tasa, tasaIDPCLegal(o.anio)), ppmTasa: num(o.ppmTasa, tasaPPMLegal(o.anio, o.ufAnterior)), reserva: num(o.reserva, 15),
    p, costos: (o.costos || []).map((c) => ({ ...c })), hecho: [], notas: {}, basadaEn: null,
  }
}

/** UF proyectada del mes `mesIdx` (0 = enero) con reajuste anual compuesto mensual sobre la UF de cierre del año anterior. @param {number} ufDic @param {number} reajustePct @param {number} mesIdx */
export function proyectarUF(ufDic, reajustePct, mesIdx) {
  return ufDic * Math.pow(1 + num(reajustePct) / 100, (mesIdx + 1) / 12)
}

/**
 * Modelo del presupuesto por escenario. Cada mes del año parte del mismo mes de la base (en UF, para que la UF no distorsione), se multiplica por (1 + crecimiento real)
 * y se convierte a pesos con la UF proyectada de ese mes. Caja = facturado menos el aumento de lo por cobrar al cierre (días de cobro sobre la variación de diciembre).
 * @param {BasePresupuesto} base @param {EstadoPresupuesto} st
 */
export function modeloPresupuesto(base, st) {
  const uf27 = Array.from({ length: 12 }, (_, i) => proyectarUF(base.ufDic, st.reajusteUF, i))
  const ufMed = sum(uf27) / 12
  const esc = /** @type {Record<string, any>} */ ({})
  for (const [k] of ESCENARIOS) {
    const p = st.p[k]
    const ingUF = base.baseUF.map((x) => num(x) * (1 + p.g / 100))
    const ing = ingUF.map((x, i) => x * uf27[i])
    const fact = sum(ing)
    const dCob = (p.dias / 30) * (ing[11] - num(base.baseCLP[11]))
    const caja = fact - dCob
    const costos = sum(st.costos.map((c) => num(c.m) * num(c.meses) * (1 + (c.alza == null ? p.alza : num(c.alza)) / 100)))
    const terc = (caja * p.terc) / 100
    const antes = caja - terc - costos
    const idpc = Math.max(0, antes) * (st.tasaIDPC / 100)
    const post = antes - idpc
    const retiros = Math.max(0, post) * (1 - st.reserva / 100)
    const ppm = fact * (st.ppmTasa / 100)   // PPM del año: tasa sobre lo facturado (ingresos brutos del giro)
    esc[k] = { p, ing, ingUF, fact, factUF: sum(ingUF), dCob, caja, costos, terc, base: antes, idpc, ppm, saldo: idpc - ppm, post, retiros, reserva: Math.max(0, post) * (st.reserva / 100), egr: costos + terc + idpc }
  }
  return { uf27, ufMed, esc }
}

/** Resumen por escenario que se guarda con cada versión (y sus facturados mensuales, congelados: la base se mueve cada mes). @param {ReturnType<typeof modeloPresupuesto>} m */
export function resumenModelo(m) {
  const o = /** @type {Record<string, any>} */ ({})
  for (const [k] of ESCENARIOS) {
    const e = m.esc[k]
    o[k] = { fact: e.fact, caja: e.caja, costos: e.costos, terc: e.terc, base: e.base, idpc: e.idpc, post: e.post, retiros: e.retiros, mensual: e.ing, mensualUF: e.ingUF }
  }
  return o
}

/** Etapas del primer diseño (8) → etapas actuales (5). */
export const ETAPA_ANTIGUA = /** @type {Record<number,number>} */ ({ 0: 0, 1: 1, 2: 3, 3: 3, 4: 2, 5: 3, 6: 3, 7: 4 })

/** Lleva un estado guardado con la numeración antigua de etapas a la actual (marcas «revisada» y notas); idempotente. @param {any} st */
export function migrarEstado(st, anio = /** @type {number|undefined} */ (undefined), ufAnterior = /** @type {number|undefined} */ (undefined)) {
  const c = JSON.parse(JSON.stringify(st || {}))
  if (c.v !== 2 && c.v !== 3) {
    const h = new Set(), n = /** @type {Record<string,string>} */ ({})
    ;(c.hecho || []).forEach((/** @type {number} */ i) => { if (ETAPA_ANTIGUA[i] != null) h.add(ETAPA_ANTIGUA[i]) })
    Object.keys(c.notas || {}).sort().forEach((k) => { const t = ETAPA_ANTIGUA[/** @type {any} */ (k)]; if (t == null || !c.notas[k]) return; n[t] = n[t] ? n[t] + ' · ' + c.notas[k] : c.notas[k] })
    c.hecho = [...h]; c.notas = n; c.v = 2
  }
  if (c.v === 2) {
    // v3: la tasa de primera categoría de partida (15 %) pasa a la legal del año comercial (circular SII 53/2025) y el PPM pasa de un monto a una tasa sobre lo facturado.
    if (anio != null && num(c.tasaIDPC, 15) === 15) c.tasaIDPC = tasaIDPCLegal(anio)
    c.ppmTasa = tasaPPMLegal(anio, ufAnterior); delete c.ppmAnual; c.v = 3
  }
  return c
}

/**
 * Supuestos que cambian entre dos estados, en texto para el usuario.
 * @param {EstadoPresupuesto} a @param {EstadoPresupuesto} b @param {{ mm:(n:number)=>string, pc:(n:number)=>string }} f
 * @returns {string[]}
 */
export function diferenciaSupuestos(a, b, f) {
  /** @type {string[]} */
  const o = []
  const t = (/** @type {string} */ n, /** @type {any} */ x, /** @type {any} */ y) => { if (x !== y) o.push(`${n}: ${x} → ${y}`) }
  t('Reajuste de la UF', f.pc(a.reajusteUF), f.pc(b.reajusteUF)); t('Tasa de primera categoría', f.pc(a.tasaIDPC), f.pc(b.tasaIDPC)); t('Tasa de PPM', f.pc(a.ppmTasa), f.pc(b.ppmTasa)); t('Reserva de caja', f.pc(a.reserva), f.pc(b.reserva))
  const L = /** @type {Record<string,string>} */ ({ g: 'Crecimiento', alza: 'Alza de costos', terc: 'Comisiones', dias: 'Días de cobro' })
  for (const [k, nom] of ESCENARIOS) for (const campo of Object.keys(L)) t(nom + ' · ' + L[campo], a.p[k][/** @type {keyof Supuestos} */ (campo)], b.p[k][/** @type {keyof Supuestos} */ (campo)])
  const ma = new Map(a.costos.map((c) => [c.id, c])), mb = new Map(b.costos.map((c) => [c.id, c]))
  for (const c of b.costos) {
    const x = ma.get(c.id)
    if (!x) { o.push(`Partida nueva: ${c.n} (${f.mm(c.m)} al mes, ${c.meses} meses)`); continue }
    if (x.n !== c.n) o.push(`Partida «${x.n}» renombrada a «${c.n}»`)
    if (x.m !== c.m) o.push(`${c.n}: ${f.mm(x.m)} → ${f.mm(c.m)} por mes`)
    if (x.meses !== c.meses) o.push(`${c.n}: ${x.meses} → ${c.meses} meses`)
    if (x.alza !== c.alza) o.push(`${c.n}: alza ${x.alza == null ? 'del escenario' : f.pc(x.alza)} → ${c.alza == null ? 'del escenario' : f.pc(c.alza)}`)
    if (x.t !== c.t) o.push(`${c.n}: ${x.t} → ${c.t}`)
  }
  for (const c of a.costos) if (!mb.has(c.id)) o.push(`Partida quitada: ${c.n}`)
  return o
}

/** Meses cerrados más recientes (YYYY-MM), del más antiguo al más reciente: el mes en curso NO cuenta. @param {string} hoyISO @param {number} [n] */
export function ultimosCerrados(hoyISO, n = 12) {
  const y = Number(hoyISO.slice(0, 4)), m = Number(hoyISO.slice(5, 7))
  /** @type {string[]} */
  const out = []
  for (let i = n; i >= 1; i--) { const t = y * 12 + (m - 1) - i; out.push(`${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`) }
  return out
}

/**
 * Base mensual de enero a diciembre del año del presupuesto: cada mes toma el mismo mes calendario del último año cerrado. Un mes sin dato queda en 0 (no se inventa).
 * @param {{ ym:string, clp:number, uf:number }[]} cierres @param {number} ufDic
 * @returns {BasePresupuesto}
 */
export function baseMensual(cierres, ufDic) {
  const baseCLP = Array.from({ length: 12 }, () => 0), baseUF = Array.from({ length: 12 }, () => 0)
  for (const c of cierres) { const i = Number(c.ym.slice(5, 7)) - 1; if (i >= 0 && i < 12) { baseCLP[i] = num(c.clp); baseUF[i] = num(c.uf) } }
  return { baseCLP, baseUF, ufDic }
}

/** Índices de los meses que se salen de lo normal: más de 1,5 veces o menos de la mitad de la mediana. @param {(number|null)[]} montos */
export function mesesAtipicos(montos) {
  const v = montos.filter((x) => x != null && Number.isFinite(Number(x))).map(Number).sort((a, b) => a - b)
  if (v.length < 3) return /** @type {number[]} */ ([])
  const h = v.length >> 1, med = v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2
  return montos.map((x, i) => (x != null && (Number(x) > med * 1.5 || Number(x) < med * 0.5) ? i : -1)).filter((i) => i >= 0)
}

/**
 * Días de cobro de las facturas pagadas emitidas en el año (de la emisión al pago). Sin reembolsos ni notas de crédito.
 * @param {{ status?:string, issued_at?:string|null, paid_at?:string|null, billing_type?:string|null, deleted_at?:string|null }[]} billing @param {number} anio
 */
export function diasDeCobro(billing, anio) {
  const d = (/** @type {any} */ x) => Date.parse(String(x || '').slice(0, 10) + 'T00:00:00Z')
  const v = (billing || [])
    .filter((b) => b && !b.deleted_at && b.status === 'Pagado' && b.issued_at && b.paid_at && String(b.issued_at).slice(0, 4) === String(anio) && !['reembolso', 'nota_credito'].includes(String(b.billing_type || '')))
    .map((b) => Math.round((d(b.paid_at) - d(b.issued_at)) / 86400000)).filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b)
  if (!v.length) return { n: 0, promedio: null, mediana: null }
  const h = v.length >> 1
  return { n: v.length, promedio: Math.round(sum(v) / v.length), mediana: v.length % 2 ? v[h] : Math.round((v[h - 1] + v[h]) / 2) }
}

/** Concentración: parte de lo facturado que suman los `k` primeros clientes. @param {number[]} montosOrdenados de mayor a menor @param {number} total @param {number} [k] */
export function concentracion(montosOrdenados, total, k = 5) {
  return total > 0 ? sum(montosOrdenados.slice(0, k)) / total : 0
}
