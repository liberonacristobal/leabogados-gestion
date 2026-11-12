// Ingreso propio de lo por cobrar: de cada factura abierta, cuánto es de la oficina y cuánto es ajeno.
// Ajeno = parte de terceros (venta de terceros: la factura se emite por el total y el resto es del externo) + comisiones por pagar a terceros
// (se activan cuando el cliente paga). Funciones puras: fuente única de Cobranza; no leen ni escriben la base.
// Ya pagado a un tercero (estado «pagado») no cuenta como deuda pendiente.

const n = (/** @type {any} */ x) => Number(x) || 0

/**
 * Nombre corto de un tercero para mostrar: sin «Limitada», «SpA»…, hasta dos palabras, siglas en mayúscula («BDA Abogados Limitada» → «BDA Abogados»).
 * @param {any} p
 */
export const nombreTercero = p => {
  const w = String(p || '').replace(/[.,]/g, ' ').trim().split(/\s+/).filter(x => x && !/^(limitada|ltda|spa|eirl|sa|s|a|y|e|cia|compania)$/i.test(x))
  return w.length ? w.slice(0, 2).map(x => (x.length <= 3 ? x.toUpperCase() : x[0].toUpperCase() + x.slice(1).toLowerCase())).join(' ') : 'Tercero'
}

/**
 * Parte ajena de UNA factura abierta, proporcional a su saldo (un abono baja lo ajeno en la misma proporción).
 * ext = lo que es de un tercero porque se factura por cuenta suya; com = comisiones por pagar a terceros. Para quien lee son lo mismo: lo que no queda en la oficina.
 * @param {{ saldo?: any, monto?: any, terceros?: any[], montoTerceros?: any }} f  monto = monto de la factura; terceros = filas de terceros_pagos de la factura
 * @returns {{ ext: number, com: number, partes: { nombre: string, monto: number }[] }} pesos enteros; ext + com nunca pasa del saldo; partes suma ext + com
 */
export function ajenoDeFactura(f) {
  const s = Math.max(0, n(f?.saldo)), m = n(f?.monto)
  if (!(s > 0) || !(m > 0)) return { ext: 0, com: 0, partes: [] }
  /** @type {{ nombre: string, monto: number, ext: boolean }[]} */
  const rows = []
  let ext = 0, com = 0
  for (const t of f?.terceros || []) {
    if (!t) continue
    if (t.comision_pct != null) { ext += n(t.monto); rows.push({ nombre: nombreTercero(t.proveedor), monto: n(t.monto), ext: true }) }
    else if (t.estado !== 'pagado') { com += n(t.monto); rows.push({ nombre: nombreTercero(t.proveedor), monto: n(t.monto), ext: false }) }
  }
  if (!(ext > 0) && n(f?.montoTerceros) > 0) { ext = n(f.montoTerceros); rows.push({ nombre: 'Tercero', monto: ext, ext: true }) }
  const tot = ext + com
  if (tot > m) { ext = ext * m / tot; com = com * m / tot }   // nunca más que la factura
  const k = Math.min(1, s / m)
  const e = Math.round(ext * k), c = Math.round(com * k)
  const cc = Math.min(c, Math.max(0, Math.round(s) - e))
  // Reparto por tercero: cada grupo (por cuenta de terceros / comisiones) se escala a su total y la diferencia de redondeo va a la primera parte.
  /** @type {Map<string, number>} */
  const por = new Map()
  for (const [esExt, total] of /** @type {[boolean, number][]} */ ([[true, e], [false, cc]])) {
    const g = rows.filter(x => x.ext === esExt), raw = g.reduce((a, x) => a + x.monto, 0)
    if (!(total > 0) || !(raw > 0)) continue
    const parts = g.map(x => Math.round(x.monto * total / raw)), dif = total - parts.reduce((a, x) => a + x, 0)
    if (parts.length) parts[0] += dif
    g.forEach((x, i) => por.set(x.nombre, (por.get(x.nombre) || 0) + parts[i]))
  }
  return { ext: e, com: cc, partes: [...por].map(([nombre, monto]) => ({ nombre, monto })).filter(x => x.monto > 0).sort((a, b) => b.monto - a.monto) }
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
  const r = { todo: cero(), venc: cero(), m60: cero(), /** @type {Map<string, { cid: string, todo: ReturnType<typeof cero>, venc: ReturnType<typeof cero>, facturas: { ref: any, saldo: number, ext: number, com: number, propio: number, mora: number, terceros: any[], partes: { nombre: string, monto: number }[] }[] }>} */ porCliente: new Map(), /** @type {Map<string, { monto: number, venc: number }>} */ terceros: new Map() }   // porCliente[cid].facturas: el detalle de cada factura abierta del cliente; terceros: cuánto de la cartera es de cada tercero
  for (const f of filas || []) {
    const s = Math.round(n(f?.saldo))
    if (!(s > 0)) continue
    const { ext, com, partes } = ajenoDeFactura({ ...f, saldo: s })
    const mora = n(f?.mora), cid = String(f?.cid)
    sumar(r.todo, s, ext, com)
    if (mora > 0) sumar(r.venc, s, ext, com)
    if (mora > 60) sumar(r.m60, s, ext, com)
    let c = r.porCliente.get(cid)
    if (!c) { c = { cid, todo: cero(), venc: cero(), facturas: [] }; r.porCliente.set(cid, c) }
    c.facturas.push({ ref: f?.ref, saldo: s, ext, com, propio: s - ext - com, mora, terceros: f?.terceros || [], partes })
    for (const p of partes) { const x = r.terceros.get(p.nombre) || { monto: 0, venc: 0 }; x.monto += p.monto; if (mora > 0) x.venc += p.monto; r.terceros.set(p.nombre, x) }
    sumar(c.todo, s, ext, com)
    if (mora > 0) sumar(c.venc, s, ext, com)
  }
  return r
}
