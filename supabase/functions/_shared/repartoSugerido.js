// Reparto sugerido con un colaborador (BDA / Rodrigo Díaz) al cuadrar una factura del SII que aún no se registra.
// El reparto vive en terceros_pagos (colaborador, sin comision_pct) anclado a la factura. Se propone a partir de DOS señales:
//  · la glosa de la factura (conceptos laborales), cuando el SII la entrega; y
//  · el historial del cliente: sus facturas laborales anteriores con ese colaborador y su porcentaje.
// Lo aprendido (el usuario aceptó antes para ese cliente) manda sobre el historial. Nunca se aplica solo: la pantalla lo propone y una persona confirma.

/** Conceptos de una glosa que indican trabajo laboral. */
export const CONCEPTOS_LABORAL = /laboral|trabajador|finiquito|despido|tutela|direcci[oó]n del trabajo|previsional|sindical|horas extra/i
export const esGlosaLaboral = g => CONCEPTOS_LABORAL.test(String(g || ''))
/** Clave de lo aprendido: cliente y tipo de trabajo (hoy solo «laboral»). */
export const claveRepartoAprendido = clienteId => `${clienteId}|laboral`

/**
 * @param {{clienteId:string, glosa?:string|null, monto:number, billing:any[], terceros:any[], aprendido?:{proveedorId?:string,proveedor?:string,rut?:string,pct:number}|null}} p
 * @returns {null | {proveedorId:string|null, proveedor:string, rut:string|null, pct:number, monto:number, resto:number, senal:'aprendido'|'historial', glosa:'laboral'|'sin_glosa', porque:string[]}}
 */
export function sugerirReparto({ clienteId, glosa = null, monto, billing = [], terceros = [], aprendido = null }) {
  const total = Math.round(Number(monto) || 0)
  if (!clienteId || !(total > 0)) return null
  const tieneGlosa = !!String(glosa || '').trim()
  if (tieneGlosa && !esGlosaLaboral(glosa)) return null            // glosa conocida y no laboral: no se propone
  const g = tieneGlosa ? 'laboral' : 'sin_glosa'
  const partes = (pct, base) => { const m = Math.round(total * pct / 100); return { monto: m, resto: total - m, ...base } }
  if (aprendido && Number(aprendido.pct) > 0 && Number(aprendido.pct) < 100) {
    return partes(Number(aprendido.pct), { proveedorId: aprendido.proveedorId || null, proveedor: String(aprendido.proveedor || ''), rut: aprendido.rut || null, pct: Number(aprendido.pct), senal: 'aprendido', glosa: g, porque: [] })
  }
  const facturas = (billing || []).filter(b => b && String(b.client_id) === String(clienteId) && !b.deleted_at && b.invoice_no && (Number(b.amount) || 0) > 0 && !['reembolso', 'nota_credito', 'subarriendo'].includes(b.billing_type || '') && esGlosaLaboral(b.concept))
  const porFactura = new Map()
  for (const t of terceros || []) { if (!t || t.estado === 'anulado' || t.comision_pct != null || !t.billing_id) continue; (porFactura.get(String(t.billing_id)) || porFactura.set(String(t.billing_id), []).get(String(t.billing_id))).push(t) }
  /** @type {Map<string,{prov:any, pcts:number[], folios:string[]}>} */
  const grupos = new Map()
  for (const b of facturas) {
    const ts = porFactura.get(String(b.id)); if (!ts) continue
    const porProv = new Map()
    for (const t of ts) { const k = String(t.proveedor_id || t.proveedor); porProv.set(k, { prov: t, suma: (porProv.get(k)?.suma || 0) + (Number(t.monto) || 0) }) }
    for (const [k, x] of porProv) { const pct = x.suma / Number(b.amount) * 100; const e = grupos.get(k) || { prov: x.prov, pcts: [], folios: [] }; e.pcts.push(pct); e.folios.push(String(b.invoice_no).replace(/^Factura\s*/i, '')); grupos.set(k, e) }
  }
  const mejor = [...grupos.values()].sort((a, b) => b.folios.length - a.folios.length)[0]
  if (!mejor) return null
  const prom = mejor.pcts.reduce((a, x) => a + x, 0) / mejor.pcts.length
  const pct = Math.abs(prom - Math.round(prom)) < 0.6 ? Math.round(prom) : Math.round(prom * 100) / 100
  if (!(pct > 0 && pct < 100)) return null
  return partes(pct, { proveedorId: mejor.prov.proveedor_id || null, proveedor: String(mejor.prov.proveedor || ''), rut: mejor.prov.rut || null, pct, senal: 'historial', glosa: g, porque: mejor.folios })
}
