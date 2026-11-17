// Días de cobro de las facturas pagadas, PONDERADOS POR MONTO: Σ(monto × días) ÷ Σ monto. Una factura grande pesa más que una chica.
// El promedio simple (cada factura vale lo mismo) se entrega aparte como referencia. Funciones puras: solo reciben {monto, dias}.

/** @typedef {{monto:number, dias:number}} CobroDias */

/**
 * @param {CobroDias[]} items facturas pagadas (monto pagado y días entre emisión y pago)
 * @returns {{n:number, monto:number, pond:number|null, simple:number|null, pct60:number|null, pct90:number|null}}
 */
export function resumenDiasCobro(items) {
  // Decidido 2026-11-17: la factura que se emite ya pagada (días negativos: pago por adelantado) no tiene cobro que medir y queda fuera, no cuenta como 0 días.
  const v = (items || []).filter(x => x && Number(x.monto) > 0 && Number.isFinite(x.dias) && x.dias >= 0 && x.dias < 400)
  const monto = v.reduce((a, x) => a + x.monto, 0)
  if (!v.length || !(monto > 0)) return { n: 0, monto: 0, pond: null, simple: null, pct60: null, pct90: null }
  const pond = Math.round(v.reduce((a, x) => a + x.monto * x.dias, 0) / monto)
  const simple = Math.round(v.reduce((a, x) => a + x.dias, 0) / v.length)
  const parte = (/** @type {(d:number)=>boolean} */ f) => Math.round(v.filter(x => f(x.dias)).reduce((a, x) => a + x.monto, 0) / monto * 100)
  return { n: v.length, monto, pond, simple, pct60: parte(d => d <= 60), pct90: parte(d => d > 90) }
}

/**
 * Facturas PAGADAS emitidas en un año (o hasta un mes, o solo en un mes): la ÚNICA regla de qué facturas cuentan en los días de cobro, en Oficina, Presupuesto y Por socio.
 * Sin reembolsos, notas de crédito ni subarriendo (no es gestión de cobro del giro). `monto` = lo pagado (o el monto de la factura); `dias` = de la emisión al pago.
 * @param {{ id?:any, status?:string, issued_at?:string|null, paid_at?:string|null, billing_type?:string|null, deleted_at?:string|null, paid_amount?:any, amount?:any }[]} billing @param {number} anio
 * @param {{ ym?:string|null, mes?:boolean }} [opts] ym = 'AAAA-MM': solo las emitidas hasta ese mes (con `mes`, solo las emitidas en ese mes)
 */
export function facturasCobradas(billing, anio, opts = {}) {
  const d = (/** @type {any} */ x) => Date.parse(String(x || '').slice(0, 10) + 'T00:00:00Z')
  const ym = opts.ym || null
  return (billing || [])
    .filter((b) => b && !b.deleted_at && b.status === 'Pagado' && b.issued_at && b.paid_at && String(b.issued_at).slice(0, 4) === String(anio) && !['reembolso', 'nota_credito', 'subarriendo'].includes(String(b.billing_type || ''))
      && (!ym || (opts.mes ? String(b.issued_at).slice(0, 7) === ym : String(b.issued_at).slice(0, 7) <= ym)))
    .map((b) => ({ b, monto: Number(b.paid_amount) || Number(b.amount) || 0, dias: Math.round((d(b.paid_at) - d(b.issued_at)) / 86400000) }))
}

/**
 * Días de cobro de las facturas pagadas emitidas en el año, ponderados por monto: la cifra única de Oficina, Presupuesto y Por socio (`facturasCobradas`). `mediana` va de los días sin ponderar.
 * @param {Parameters<typeof facturasCobradas>[0]} billing @param {number} anio @param {Parameters<typeof facturasCobradas>[2]} [opts]
 */
export function diasDeCobroFacturas(billing, anio, opts) {
  const items = facturasCobradas(billing, anio, opts)
  const r = resumenDiasCobro(items)
  const v = items.filter((x) => x.monto > 0 && Number.isFinite(x.dias) && x.dias >= 0 && x.dias < 400).map((x) => x.dias).sort((a, b) => a - b), h = v.length >> 1
  return { ...r, mediana: v.length ? (v.length % 2 ? v[h] : Math.round((v[h - 1] + v[h]) / 2)) : null }
}
