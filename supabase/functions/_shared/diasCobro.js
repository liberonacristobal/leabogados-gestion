// Días de cobro de las facturas pagadas, PONDERADOS POR MONTO: Σ(monto × días) ÷ Σ monto. Una factura grande pesa más que una chica.
// El promedio simple (cada factura vale lo mismo) se entrega aparte como referencia. Funciones puras: solo reciben {monto, dias}.

/** @typedef {{monto:number, dias:number}} CobroDias */

/**
 * @param {CobroDias[]} items facturas pagadas (monto pagado y días entre emisión y pago)
 * @returns {{n:number, monto:number, pond:number|null, simple:number|null, pct60:number|null, pct90:number|null}}
 */
export function resumenDiasCobro(items) {
  const v = (items || []).filter(x => x && Number(x.monto) > 0 && Number.isFinite(x.dias) && x.dias >= 0 && x.dias < 400)
  const monto = v.reduce((a, x) => a + x.monto, 0)
  if (!v.length || !(monto > 0)) return { n: 0, monto: 0, pond: null, simple: null, pct60: null, pct90: null }
  const pond = Math.round(v.reduce((a, x) => a + x.monto * x.dias, 0) / monto)
  const simple = Math.round(v.reduce((a, x) => a + x.dias, 0) / v.length)
  const parte = (/** @type {(d:number)=>boolean} */ f) => Math.round(v.filter(x => f(x.dias)).reduce((a, x) => a + x.monto, 0) / monto * 100)
  return { n: v.length, monto, pond, simple, pct60: parte(d => d <= 60), pct90: parte(d => d > 90) }
}
