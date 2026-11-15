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

/**
 * Días de cobro de las facturas PAGADAS emitidas en un año (de la emisión al pago), ponderados por monto: la cifra única de Oficina y del Presupuesto.
 * Sin reembolsos, notas de crédito ni subarriendo. `mediana` va de los días sin ponderar. Funciones puras.
 * @param {{ status?:string, issued_at?:string|null, paid_at?:string|null, billing_type?:string|null, deleted_at?:string|null, paid_amount?:any, amount?:any }[]} billing @param {number} anio
 */
export function diasDeCobroFacturas(billing, anio) {
  const d = (/** @type {any} */ x) => Date.parse(String(x || '').slice(0, 10) + 'T00:00:00Z')
  const items = (billing || [])
    .filter((b) => b && !b.deleted_at && b.status === 'Pagado' && b.issued_at && b.paid_at && String(b.issued_at).slice(0, 4) === String(anio) && !['reembolso', 'nota_credito', 'subarriendo'].includes(String(b.billing_type || '')))
    .map((b) => ({ monto: Number(b.paid_amount) || Number(b.amount) || 0, dias: Math.round((d(b.paid_at) - d(b.issued_at)) / 86400000) }))
  const r = resumenDiasCobro(items)
  const v = items.filter((x) => x.monto > 0 && Number.isFinite(x.dias) && x.dias >= 0 && x.dias < 400).map((x) => x.dias).sort((a, b) => a - b), h = v.length >> 1
  return { ...r, mediana: v.length ? (v.length % 2 ? v[h] : Math.round((v[h - 1] + v[h]) / 2)) : null }
}
