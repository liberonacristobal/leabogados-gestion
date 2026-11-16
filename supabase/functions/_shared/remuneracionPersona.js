// Remuneración completa de una persona a partir de su sueldo LÍQUIDO: parámetros desde su última liquidación (tasa de AFP, plan de salud en UF), tabla del SII del mes y
// regla de líquido a bruto (liquidoABruto.js). Regla pura: no lee ni escribe la base. La usan el Presupuesto (impuesto único y cotizaciones de cada línea de Remuneraciones) y la calculadora de aumentos.
import { imponibleDeLiquido, liquidacionDeImponible, costoEmpresaMes, TOPE_AFP_UF, TOPE_CES_UF, SALUD_LEGAL, CES_TRABAJADOR } from './liquidoABruto.js'
import { mismaPersona } from './liquidacionesReglas.js'

const _n = (/** @type {any} */ x) => { const v = Number(x); return Number.isFinite(v) ? v : 0 }

/** Tramos del impuesto único de un mes («AAAA-MM») desde las filas de `sii_impuesto_unico`; si el mes no está, el último anterior. @param {any[]} filas @param {string} ym @returns {number[][]} */
export function tramosDelMes(filas, ym) {
  const meses = [...new Set((filas || []).map(f => String(f.periodo)))].sort()
  const per = meses.filter(m => m <= ym).pop() || meses[meses.length - 1]
  if (!per) return []
  return (filas || []).filter(f => String(f.periodo) === per).sort((a, b) => _n(a.tramo) - _n(b.tramo)).map(f => [_n(f.desde), f.hasta == null ? 1e12 : _n(f.hasta), _n(f.factor), _n(f.rebaja)])
}

/** Última liquidación de una persona («Nombre» corto del presupuesto contra «APELLIDO NOMBRE» de la liquidación) hasta el mes `ym`. @param {string} persona @param {any[]} liquidaciones @param {string} ym */
export function ultimaLiquidacionDe(persona, liquidaciones, ym) {
  const l = (liquidaciones || []).filter(x => x && mismaPersona(persona, String(x.persona)) && String(x.periodo) <= ym).sort((a, b) => String(a.periodo).localeCompare(String(b.periodo)))
  return l.length ? l[l.length - 1] : null
}

/**
 * Parámetros de una liquidación: tasa de AFP y plan de salud en UF (la salud adicional es el plan sobre el 7 % legal; sin adicional el plan no obliga).
 * @param {{imponible:any, liquido:any, impuesto_unico:any, salud_adicional?:any}} l @param {number} uf UF del mes de la liquidación
 * @returns {{afpPct:number, planUF:number}|null}
 */
export function parametrosDeLiquidacion(l, uf) {
  const imp = _n(l.imponible), liq = _n(l.liquido), iu = _n(l.impuesto_unico), sa = _n(l.salud_adicional)
  if (!(imp > 0) || !(liq > 0) || !(uf > 0)) return null
  const cap = Math.min(imp, TOPE_AFP_UF * uf), ces = Math.round(CES_TRABAJADOR * Math.min(imp, TOPE_CES_UF * uf)), legal = Math.round(SALUD_LEGAL * cap), saludTotal = legal + sa
  const afpAmt = imp - iu - liq - ces - saludTotal
  if (!(afpAmt > 0)) return null
  return { afpPct: Math.round(afpAmt / cap * 1e4) / 1e4, planUF: sa > 0 ? saludTotal / uf : 0 }
}

/**
 * Remuneración completa de una persona para un líquido dado en el mes `ym`.
 * @param {{liquido:number, persona:string, liquidaciones:any[], ym:string, uf:number, ufDeLiquidacion:(ym:string)=>number, tramosFilas:any[], tasaEmpleador?:number}} p
 * @returns {{imponible:number, cotTrab:number, iu:number, liquido:number, haberes:number, empleador:number, costoEmpresa:number, afpPct:number, planUF:number}|null} null si la persona no tiene liquidación de la que tomar sus parámetros
 */
export function remuneracionDeLiquido(p) {
  const ult = ultimaLiquidacionDe(p.persona, p.liquidaciones, p.ym); if (!ult) return null
  const prm = parametrosDeLiquidacion(ult, p.ufDeLiquidacion(String(ult.periodo))); if (!prm) return null
  const tramos = tramosDelMes(p.tramosFilas, p.ym); if (!tramos.length) return null
  const r = imponibleDeLiquido({ liquido: p.liquido, afpPct: prm.afpPct, planSaludPesos: prm.planUF * p.uf, uf: p.uf, tramos }); if (!r) return null
  const c = costoEmpresaMes({ imponible: r.imponible, tasaEmpleador: _n(p.tasaEmpleador) })
  return { imponible: r.imponible, cotTrab: r.cotTrab, iu: r.iu, liquido: r.liquido, haberes: c.haberes, empleador: c.empleador, costoEmpresa: c.costoEmpresa, afpPct: prm.afpPct, planUF: prm.planUF }
}

/**
 * Impuesto único de las líneas de «Remuneraciones» del presupuesto de oficina en el mes `ym`: cada línea es un sueldo líquido; el impuesto único sale de su remuneración completa.
 * Las líneas sin liquidación (quien emite boleta, otros) no suman: su retención ya va en el bruto de la boleta.
 * @param {{rows:any[], ym:string, liquidaciones:any[], tramosFilas:any[], ufDelMes:number, ufDeLiquidacion:(ym:string)=>number, vigente:(r:any)=>number}} p `vigente` = monto de la línea en ese mes (con su desde/monto_prev)
 */
export function impuestoUnicoPresupuesto(p) {
  let total = 0
  for (const r of p.rows || []) {
    if (!r || r.activo === false || r.es_ingreso || String(r.categoria || '') !== 'Remuneraciones') continue
    const x = remuneracionDeLiquido({ liquido: _n(p.vigente(r)), persona: String(r.item || ''), liquidaciones: p.liquidaciones, ym: p.ym, uf: p.ufDelMes, ufDeLiquidacion: p.ufDeLiquidacion, tramosFilas: p.tramosFilas })
    if (x) total += x.iu
  }
  return total
}

export { liquidacionDeImponible }
