// Desfase de pago de fin de año: las cotizaciones y la parte del F29 que no es PPM (retención de honorarios e impuesto único) se pagan el mes siguiente a su devengo.
//   Lo devengado en diciembre del año anterior se paga en enero (cuenta como costo de caja de este año) y lo devengado en diciembre de este año se paga en enero siguiente (no cuenta).
//   Base de caja = base devengada − por pagar inicial + por pagar final. El por pagar final se estima con el último período cerrado como proxy de diciembre.
// Regla pura: recibe los gastos de la oficina y las partes del F29 ya calculadas por la app; no lee ni escribe la base.

const _n = (/** @type {any} */ x) => { const v = Number(x); return Number.isFinite(v) ? v : 0 }
const _pad = (/** @type {number} */ n) => String(n).padStart(2, '0')

/** Cotizaciones pagadas de un período «MM-AAAA»: los gastos «Cotizaciones sueldos MM-AAAA» de la oficina. @param {any[]} expenses @param {any} ofiId @param {string} mmaaaa */
export function cotizacionesDePeriodo(expenses, ofiId, mmaaaa) {
  let t = 0
  for (const e of expenses || []) {
    if (!e || e.deleted_at || (ofiId != null && String(e.client_id) !== String(ofiId))) continue
    if (new RegExp('cotizaciones sueldos ' + mmaaaa.replace('-', '\\-'), 'i').test(String(e.concept || e.description || ''))) t += _n(e.amount)
  }
  return t
}

/**
 * @param {{ expenses:any[], ofiId:any, anio:number, perUlt:string, f29SinPpmInicial:number, f29SinPpmUlt:number }} o
 * perUlt = último período cerrado «AAAA-MM» (proxy de diciembre). f29SinPpm* = retención de honorarios + impuesto único de diciembre del año anterior y del período último.
 * @returns {{ inicial:number, final:number, desfase:number, perInicial:string, perFinal:string }}
 */
export function desfaseFinAnio(o) {
  const perInicial = `12-${o.anio - 1}`, perFinal = `${o.perUlt.slice(5, 7)}-${o.perUlt.slice(0, 4)}`
  const inicial = cotizacionesDePeriodo(o.expenses, o.ofiId, perInicial) + _n(o.f29SinPpmInicial)
  const final = cotizacionesDePeriodo(o.expenses, o.ofiId, perFinal) + _n(o.f29SinPpmUlt)
  return { inicial, final, desfase: final - inicial, perInicial, perFinal }
}
