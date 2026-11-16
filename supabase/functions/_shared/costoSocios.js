// Costo de los socios en un mes, para mostrar «Resultado antes de sueldos de socios». Regla pura: no lee ni escribe la base.
//   Sueldo = líquido pagado en el banco a los socios del mes trabajado.
//   Impuesto único = el de sus liquidaciones.
//   Cotizaciones = las del trabajador de sus liquidaciones (imponible − impuesto único − líquido) + su parte de las del empleador.
//     La parte del empleador del mes = cotizaciones de la planilla − las de todos los trabajadores, y se reparte en proporción al imponible (es una tasa sobre el imponible, igual para todos).
// Es exactamente lo que el Resultado descuenta por los socios en Remuneraciones y Cotizaciones.
import { liquidacionesDelMes, mismaPersona } from './liquidacionesReglas.js'

const _n = (/** @type {any} */ x) => { const v = Number(x); return Number.isFinite(v) ? v : 0 }

/**
 * @param {{ items:{persona:string, liquido:number}[], liquidaciones:any[], ym:string, cotPlanilla:number, socios:string[] }} p
 *   items = pagos de sueldo del banco del mes (remuneracionesBancoMes); socios = nombres cortos de los socios.
 * @returns {{ sueldo:number, iu:number, cotTrab:number, cotEmp:number, cot:number, total:number, provisorio:boolean }}
 */
export function costoSociosMes({ items, liquidaciones, ym, cotPlanilla, socios }) {
  const esSocio = (/** @type {string} */ nombre) => (socios || []).some((s) => mismaPersona(s, nombre))
  const sueldo = (items || []).filter((x) => esSocio(String(x.persona))).reduce((a, x) => a + _n(x.liquido), 0)
  const { filas, provisorio } = liquidacionesDelMes(liquidaciones, ym)
  const ct = (/** @type {any} */ l) => Math.max(0, _n(l.imponible) - _n(l.impuesto_unico) - _n(l.liquido))
  const soc = filas.filter((l) => esSocio(String(l.persona)))
  const impTot = filas.reduce((a, l) => a + _n(l.imponible), 0), impSoc = soc.reduce((a, l) => a + _n(l.imponible), 0)
  const iu = soc.reduce((a, l) => a + _n(l.impuesto_unico), 0)
  const cotTrab = soc.reduce((a, l) => a + ct(l), 0)
  const empTotal = Math.max(0, _n(cotPlanilla) - filas.reduce((a, l) => a + ct(l), 0))
  const cotEmp = impTot > 0 ? Math.round(empTotal * impSoc / impTot) : 0
  const cot = cotTrab + cotEmp
  return { sueldo, iu, cotTrab, cotEmp, cot, total: sueldo + iu + cot, provisorio }
}
