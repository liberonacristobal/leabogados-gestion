// Registro de una nota de crédito del SII: anula la factura referida, crea la fila de la NC y la enlaza a su documento.
// Un solo camino para la compuerta de Facturación y la Revisión de datos. Si la factura estaba pagada con un anticipo, el anticipo vuelve a «disponible»
// (caso real 13-11-2026: la factura anulada seguía con el anticipo «consumido» y el pago del cliente dejaba de verse).

/**
 * @param {any} supabase cliente de Supabase
 * @param {{nc:any, fac:any, replId?:string|null, vincular?:boolean, dteXml?:string|null, ahora?:string}} p nc = documento del SII (tipo 61); fac = fila completa de billing que anula
 * @returns {Promise<{patch:any, ncRow:any, anticipoLiberado:boolean}>}
 */
export async function registrarNotaCredito(supabase, { nc, fac, replId = null, vincular = false, dteXml = null, ahora = new Date().toISOString() }) {
  const patch = {
    status: 'Anulada', anulada_at: ahora, anulada_por: `Nota de crédito N° ${nc.folio}`, updated_at: ahora,
    ...(fac.prepaid_anticipo_id ? { prepaid_anticipo_id: null } : {}),
    ...(vincular && replId ? { reemplazada_por_billing_id: replId } : {}),
  }
  const { error: e1 } = await supabase.from('billing').update(patch).eq('id', fac.id)
  if (e1) throw e1
  // El anticipo con que se pagó vuelve a estar disponible (por el puntero de la factura o por el vínculo del propio anticipo).
  let anticipoLiberado = false
  const { data: ants, error: eA } = await supabase.from('anticipos').update({ estado: 'disponible', billing_id: null }).or(`id.eq.${fac.prepaid_anticipo_id || '00000000-0000-0000-0000-000000000000'},billing_id.eq.${fac.id}`).select('id')
  if (eA) throw eA
  anticipoLiberado = (ants || []).length > 0
  const ncRow = {
    client_id: fac.client_id || null, concept: `Nota de crédito — anula Factura N° ${fac.invoice_no}`, receptor_name: nc.receptor_name || null, receptor_rut: nc.receptor_rut || null,
    amount: Math.round(Number(nc.monto) || 0), status: 'Anulada', invoice_no: String(nc.folio), issued_at: nc.fecha_emision || null, billing_type: 'nota_credito', sii_tipo_dte: 61,
    dte_xml: dteXml, nc_ref_billing_id: fac.id, sii_synced_at: ahora,
  }
  const { data: ins, error: e2 } = await supabase.from('billing').insert(ncRow).select().single()
  if (e2) throw e2
  if (nc.id && ins?.id) await supabase.from('sii_cargas_docs').update({ billing_id: ins.id }).eq('id', nc.id)
  return { patch, ncRow: ins, anticipoLiberado }
}
