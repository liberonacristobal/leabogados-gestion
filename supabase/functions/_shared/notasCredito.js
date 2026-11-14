// Notas de crédito del SII que aún no están registradas en la app. Una sola regla para la compuerta de Facturación, la Revisión de datos y el auditor nocturno.
// Caso real 13-11-2026: la NC N° 13 anuló la factura N° 520 y nadie la registró: el detector solo corría al abrir la página del SII y la factura siguió «Pagado».
// Funciones puras: reciben filas, no tocan la base.

/** @typedef {{id:string, folio:string|number, tipo_dte?:number|string, fecha_emision?:string|null, receptor_rut?:string|null, receptor_name?:string|null, monto:number, doc_json?:any, billing_id?:string|null}} DocNC */
/** @typedef {{id:string, invoice_no?:string|number|null, status?:string|null, billing_type?:string|null, amount?:number|null, receptor_rut?:string|null, client_id?:string|null, deleted_at?:string|null, prepaid_anticipo_id?:string|null}} FacNC */

/** @param {any} r */
const norm = r => String(r || '').replace(/\D/g, '')

/**
 * NC del SII sin enlazar a una fila de la app y cuya factura viva se identifica sin ambigüedad:
 * por la referencia del propio documento (folio referido) o, si el RCV no la trae, por RUT + monto EXACTO con un solo candidato.
 * @param {DocNC[]} docs documentos tipo 61 del SII
 * @param {FacNC[]} billing facturas de la app
 * @returns {{d: DocNC, fac: FacNC, inferido: boolean}[]}
 */
export function ncPorRegistrar(docs, billing) {
  const vivas = (billing || []).filter(b => b && !b.deleted_at && b.billing_type !== 'nota_credito')
  const out = []
  for (const d of docs || []) {
    if (!d || d.billing_id || Number(d.tipo_dte) !== 61) continue   // ya enlazada o no es NC
    if ((billing || []).some(b => b && b.billing_type === 'nota_credito' && !b.deleted_at && norm(b.invoice_no) === norm(d.folio))) continue   // ya registrada
    const ref = d.doc_json?.detFolioDocRef || (Array.isArray(d.doc_json?.referencias) && d.doc_json.referencias[0]?.folioRef) || null
    let fac = null, inferido = false
    if (ref) fac = vivas.find(b => norm(b.invoice_no) === norm(ref)) || null
    if (!fac) {
      const rn = norm(d.receptor_rut), mn = Math.round(Number(d.monto) || 0)
      const cand = rn && mn ? vivas.filter(b => b.invoice_no && b.status !== 'Anulada' && norm(b.receptor_rut) === rn && Math.round(Number(b.amount) || 0) === mn) : []
      if (cand.length === 1) { fac = cand[0]; inferido = true }
    }
    if (!fac || fac.status === 'Anulada') continue   // sin factura viva referida: nada que resolver
    out.push({ d, fac, inferido })
  }
  return out
}

/**
 * Las que se podrían registrar solas: el documento nombra la factura (referencia exacta, no inferida) y el monto coincide al peso.
 * Hoy NO se usa para escribir: la compuerta sigue siendo humana hasta que haya confirmaciones suficientes ([[firmdesk-back-office-autonomo]]).
 * @param {{d: DocNC, fac: FacNC, inferido: boolean}[]} items
 */
export const ncAutoRegistrables = items => (items || []).filter(x => !x.inferido && Math.round(Number(x.d.monto) || 0) === Math.round(Number(x.fac.amount) || 0))
