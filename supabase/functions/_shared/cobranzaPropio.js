// Ingreso propio de lo por cobrar: de cada factura abierta, cuánto es de la oficina y cuánto es ajeno.
// Ajeno = parte de terceros (venta de terceros: la factura se emite por el total y el resto es del externo) + comisiones por pagar a terceros
// (se activan cuando el cliente paga). Funciones puras: fuente única de Cobranza; no leen ni escriben la base.
// Ya pagado a un tercero (estado «pagado») no cuenta como deuda pendiente.

const n = (/** @type {any} */ x) => Number(x) || 0

/**
 * Parte ajena de UNA factura abierta, proporcional a su saldo (un abono baja lo ajeno en la misma proporción).
 * @param {{ saldo?: any, monto?: any, terceros?: any[], montoTerceros?: any }} f  monto = monto de la factura; terceros = filas de terceros_pagos de la factura
 * @returns {{ ext: number, com: number }} pesos enteros; ext + com nunca pasa del saldo
 */
export function ajenoDeFactura(f) {
  const s = Math.max(0, n(f?.saldo)), m = n(f?.monto)
  if (!(s > 0) || !(m > 0)) return { ext: 0, com: 0 }
  let ext = 0, com = 0
  for (const t of f?.terceros || []) {
    if (!t) continue
    if (t.comision_pct != null) ext += n(t.monto)
    else if (t.estado !== 'pagado') com += n(t.monto)
  }
  if (!(ext > 0)) ext = n(f?.montoTerceros)
  const tot = ext + com
  if (tot > m) { ext = ext * m / tot; com = com * m / tot }   // nunca más que la factura
  const k = Math.min(1, s / m)
  const e = Math.round(ext * k), c = Math.round(com * k)
  return { ext: e, com: Math.min(c, Math.max(0, Math.round(s) - e)) }
}

const cero = () => ({ total: 0, ext: 0, com: 0, propio: 0, n: 0 })
/** @param {{ total: number, ext: number, com: number, propio: number, n: number }} a @param {number} s @param {number} ext @param {number} com */
const sumar = (a, s, ext, com) => { a.total += s; a.ext += ext; a.com += com; a.propio += s - ext - com; a.n++ }

/**
 * Resumen del ingreso propio de la cartera: total, vencido (mora > 0) y más de 60 días, y por cliente.
 * Las partes suman al peso: propio = total − terceros − comisiones.
 * @param {{ cid?: any, saldo?: any, monto?: any, mora?: any, terceros?: any[], montoTerceros?: any, ref?: any }[]} filas una por factura abierta (mora = días de mora, ≤ 0 al día; ref = la factura, para el detalle por cliente)
 */
export function resumenPropio(filas) {
  const r = { todo: cero(), venc: cero(), m60: cero(), /** @type {Map<string, { cid: string, todo: ReturnType<typeof cero>, venc: ReturnType<typeof cero>, facturas: { ref: any, saldo: number, ext: number, com: number, propio: number, mora: number, terceros: any[] }[] }>} */ porCliente: new Map() }   // porCliente[cid].facturas: el detalle de cada factura abierta del cliente
  for (const f of filas || []) {
    const s = Math.round(n(f?.saldo))
    if (!(s > 0)) continue
    const { ext, com } = ajenoDeFactura({ ...f, saldo: s })
    const mora = n(f?.mora), cid = String(f?.cid)
    sumar(r.todo, s, ext, com)
    if (mora > 0) sumar(r.venc, s, ext, com)
    if (mora > 60) sumar(r.m60, s, ext, com)
    let c = r.porCliente.get(cid)
    if (!c) { c = { cid, todo: cero(), venc: cero(), facturas: [] }; r.porCliente.set(cid, c) }
    c.facturas.push({ ref: f?.ref, saldo: s, ext, com, propio: s - ext - com, mora, terceros: f?.terceros || [] })
    sumar(c.todo, s, ext, com)
    if (mora > 0) sumar(c.venc, s, ext, com)
  }
  return r
}
