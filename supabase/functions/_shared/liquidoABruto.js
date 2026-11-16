// Del sueldo LÍQUIDO al bruto de una liquidación de remuneraciones (trabajador dependiente, Chile). Regla pura: no lee ni escribe la base.
//   líquido = imponible − AFP − seguro de cesantía − salud − impuesto único
//   AFP y salud legal (7 %) se calculan sobre el imponible hasta el tope (90 UF); la cesantía hasta su propio tope (135,1 UF).
//   Salud pagada = la mayor entre el 7 % legal y el plan (en UF); lo que excede el 7 % es la salud adicional.
//   Base del impuesto único = imponible − AFP − cesantía − salud, con la salud descontable limitada al 7 % del tope imponible (no al 7 % del imponible).
//   Impuesto único = base × factor − rebaja, de la tabla mensual del SII (tabla `sii_impuesto_unico`).
// Verificada contra las liquidaciones reales (ver tests/liquido-a-bruto.test.mjs, con cifras anonimizadas).

export const CES_TRABAJADOR = 0.006      // seguro de cesantía a cargo del trabajador (contrato indefinido)
export const TOPE_AFP_UF = 90            // tope imponible de AFP y salud, en UF
export const TOPE_CES_UF = 135.1         // tope imponible del seguro de cesantía, en UF
export const SALUD_LEGAL = 0.07
export const GRATIFICACION_TOPE_MES = 213354   // 4,75 ingresos mínimos mensuales / 12 (ingreso mínimo $539.000); cambia con el ingreso mínimo

const _n = (/** @type {any} */ x) => { const v = Number(x); return Number.isFinite(v) ? v : 0 }

/** Impuesto único de una base tributable con los tramos del mes: [desde, hasta, factor, rebaja]. @param {number} base @param {number[][]} tramos */
export function impuestoUnico(base, tramos) {
  if (!(base > 0)) return 0
  const t = (tramos || []).find(x => base >= x[0] && base <= x[1]) || (tramos || [])[(tramos || []).length - 1]
  if (!t) return 0
  return Math.max(0, Math.round(base * t[2] - t[3]))
}

/**
 * La liquidación completa a partir del imponible.
 * @param {{imponible:number, afpPct:number, planSaludPesos?:number, uf:number, tramos:number[][], cesPct?:number}} p afpPct en fracción (0,1058)
 */
export function liquidacionDeImponible(p) {
  const imp = _n(p.imponible), uf = _n(p.uf), cesPct = p.cesPct == null ? CES_TRABAJADOR : p.cesPct
  const topeAfp = TOPE_AFP_UF * uf, topeCes = TOPE_CES_UF * uf
  const afp = Math.round(_n(p.afpPct) * Math.min(imp, topeAfp)), ces = Math.round(cesPct * Math.min(imp, topeCes))
  const saludLegal = Math.round(SALUD_LEGAL * Math.min(imp, topeAfp)), saludTotal = Math.max(saludLegal, Math.round(_n(p.planSaludPesos)))
  const baseIU = imp - afp - ces - Math.min(saludTotal, Math.round(SALUD_LEGAL * topeAfp))
  const iu = impuestoUnico(baseIU, p.tramos)
  return { imponible: imp, afp, ces, saludLegal, saludTotal, adicional: saludTotal - saludLegal, cotTrab: afp + ces + saludTotal, baseIU, iu, liquido: imp - afp - ces - saludTotal - iu }
}

/**
 * Imponible que da el líquido pedido (el líquido crece con el imponible, así que se busca por bisección).
 * @param {{liquido:number, afpPct:number, planSaludPesos?:number, uf:number, tramos:number[][], cesPct?:number}} p
 * @returns {ReturnType<typeof liquidacionDeImponible>|null} null si el líquido no es positivo
 */
export function imponibleDeLiquido(p) {
  const L = _n(p.liquido); if (!(L > 0)) return null
  let lo = L, hi = L * 3 + 1_000_000   // el imponible está entre el líquido y un tercio más de holgura
  const liq = (/** @type {number} */ imp) => liquidacionDeImponible({ ...p, imponible: imp }).liquido
  while (liq(hi) < L) hi *= 2
  while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (liq(mid) < L) lo = mid; else hi = mid }
  const cand = [lo, hi, hi + 1].map(i => liquidacionDeImponible({ ...p, imponible: i })).sort((a, b) => Math.abs(a.liquido - L) - Math.abs(b.liquido - L) || a.imponible - b.imponible)
  return cand[0]
}

/**
 * Sueldo base y gratificación de un imponible: gratificación legal del 25 % del sueldo base con tope mensual; el resto del imponible son bonos.
 * @param {number} imponible @param {number} [bonos] imponible que no es sueldo ni gratificación @param {number} [tope]
 */
export function desglosarImponible(imponible, bonos = 0, tope = GRATIFICACION_TOPE_MES) {
  const sinBonos = Math.max(0, _n(imponible) - _n(bonos))
  const base = 0.25 * (sinBonos / 1.25) >= tope ? sinBonos - tope : sinBonos / 1.25
  const sueldoBase = Math.round(base), gratificacion = Math.round(sinBonos - base)
  return { sueldoBase, gratificacion, bonos: _n(bonos) }
}

/**
 * Costo empresa de un mes: imponible (haberes) más la parte del empleador, que es una tasa sobre el imponible
 * (la que la app calcula desde la planilla: cotizaciones totales − las del trabajador, sobre el imponible).
 * @param {{imponible:number, tasaEmpleador:number, noImponible?:number}} p
 */
export function costoEmpresaMes(p) {
  const emp = Math.round(_n(p.tasaEmpleador) * _n(p.imponible)), haberes = _n(p.imponible) + _n(p.noImponible)
  return { haberes, empleador: emp, costoEmpresa: haberes + emp }
}
