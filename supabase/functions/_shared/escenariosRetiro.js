// Escenarios de retiro (Socios): «si pagaran los clientes con facturas vencidas de estos tramos, ¿cuánto podríamos retirar HOY?».
// Solo lo que sigue impago hoy, por tramo de mora (los de `TRAMOS_MORA`: 30 a 59, 60 a 89, 90 y más). Funciones puras.
// Lo que se sumaría a la caja es lo PROPIO: el saldo de la factura menos las comisiones a terceros que se pagarían al cobrarla (terceros_pagos pendientes de esa factura);
// en una factura emitida por cuenta de un externo solo es nuestro lo que se queda como comisión (comision_monto).
import { diasDeMora, tramoDeMora, TRAMOS_MORA } from './simuladorMorosos.js'

/** @typedef {{id:any, client_id?:any, invoice_no?:any, status?:string, billing_type?:string|null, deleted_at?:any, due?:string|null, issued_at?:string|null}} Factura */
/** @typedef {{billing_id?:any, estado?:string|null, monto?:any, comision_pct?:any, comision_monto?:any}} Tercero */

const n = (/** @type {any} */ x) => Number(x) || 0
const DIAS_MIN = 30

/**
 * Facturas vencidas (30 días o más) con saldo por cobrar, con su tramo, sus comisiones y lo propio que sumarían.
 * @param {{billing:Factura[], terceros:Tercero[], saldo:(b:any)=>number, hoyT:number}} o saldo = la misma función de saldo de la app (`saldoBill`)
 * @returns {{b:Factura, cid:any, saldo:number, dias:number, tramo:number, com:number, neto:number}[]}
 */
export function facturasVencidasPorTramo({ billing, terceros, saldo, hoyT }) {
  /** @type {Record<string, Tercero[]>} */ const tPor = {}
  ;(terceros || []).forEach(t => { if (t && t.billing_id != null && t.estado !== 'pagado') (tPor[String(t.billing_id)] = tPor[String(t.billing_id)] || []).push(t) })
  const out = []
  ;(billing || []).forEach(b => {
    if (!b || b.deleted_at || !String(b.invoice_no || '').trim() || ['Pagado', 'Anulada', 'Programada', 'Pausada'].includes(String(b.status)) || ['reembolso', 'nota_credito'].includes(String(b.billing_type || ''))) return
    const s = n(saldo(b)); if (!(s > 1)) return
    const dias = diasDeMora(b, hoyT); if (dias < DIAS_MIN) return
    const ts = tPor[String(b.id)] || [], externo = ts.some(t => t.comision_pct != null)
    const com = externo ? 0 : ts.reduce((a, t) => a + n(t.monto), 0)
    const neto = externo ? Math.min(s, ts.reduce((a, t) => a + n(t.comision_monto), 0)) : Math.max(0, s - com)
    out.push({ b, cid: b.client_id, saldo: s, dias, tramo: tramoDeMora(dias), com: externo ? s - neto : com, neto })
  })
  return out
}

/** Resumen por tramo: facturas, clientes y saldo. @param {{cid:any, saldo:number, tramo:number}[]} items */
export function resumenPorTramo(items) {
  return TRAMOS_MORA.map((t, i) => { const xs = (items || []).filter(x => x.tramo === i); return { k: t.k, l: t.l, n: xs.length, clientes: new Set(xs.map(x => String(x.cid))).size, saldo: xs.reduce((a, x) => a + x.saldo, 0) } })
}

/**
 * Escenario con los tramos elegidos. Todo se redondea a `paso` y cuadra: bruto − comisiones = neto y disponible + neto = retirable.
 * @param {{items:{cid:any, saldo:number, tramo:number, com:number, neto:number}[], elegidos:boolean[], disponible:number, nSocios:number, paso?:number}} o
 */
export function escenarioRetiro(o) {
  const p = o.paso || 1e5, r = (/** @type {number} */ x) => Math.round((Number(x) || 0) / p) * p
  const xs = (o.items || []).filter(x => o.elegidos[x.tramo])
  const bruto = r(xs.reduce((a, x) => a + x.saldo, 0)), com = r(xs.reduce((a, x) => a + x.com, 0)), disponible = r(o.disponible)
  const neto = bruto - com, retirable = disponible + neto
  return { n: xs.length, clientes: new Set(xs.map(x => String(x.cid))).size, bruto, com, neto, disponible, retirable, porSocio: o.nSocios > 0 ? r(retirable / o.nSocios) : retirable }
}
