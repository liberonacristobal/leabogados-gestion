// Facturas de compra del SII ↔ pagos del banco. Compartida por la app (Compras y Proveedores) y el servidor (conciliacion-auto).

const _rut = r => String(r || '').toUpperCase().replace(/[^0-9K]/g, '')
const _dias = (a, b) => Math.round((new Date(String(a).slice(0, 10) + 'T12:00') - new Date(String(b).slice(0, 10) + 'T12:00')) / 864e5)
// Ventana del pago respecto de la emisión: hasta 7 días antes (pago contra proforma) y 75 después (plazo de pago).
export const COMPRA_PAGO_ANTES = 7, COMPRA_PAGO_DESPUES = 75

// Calce exacto y ÚNICO por los dos lados: la factura (no nota de crédito, sin pago enlazado) tiene un solo cargo del mismo RUT y
// monto al peso dentro de la ventana, y ese cargo no calza con otra factura libre del mismo emisor. Un cargo ya enlazado a otra
// factura no se vuelve a usar. Lo ambiguo (tres facturas iguales y un pago, un pago antes de la emisión) no entra.
export function calcesCompraPago(docs, cargos) {
  const ligados = new Set((docs || []).map(d => d.movimiento_id).filter(Boolean).map(String))
  const libresD = (docs || []).filter(d => !d.movimiento_id && Number(d.tipo_dte) !== 61 && Math.abs(Number(d.monto) || 0) > 0 && _rut(d.emisor_rut))
  const libresM = (cargos || []).filter(m => m.tipo !== 'abono' && !m.es_interno && m.estado !== 'interno' && _rut(m.rut_contraparte) && !ligados.has(String(m.id)))
  const enVentana = (d, m) => { const x = _dias(m.fecha, d.fecha_emision); return x >= -COMPRA_PAGO_ANTES && x <= COMPRA_PAGO_DESPUES }
  const calza = (d, m) => _rut(m.rut_contraparte) === _rut(d.emisor_rut) && Math.round(Math.abs(Number(m.monto) || 0)) === Math.round(Math.abs(Number(d.monto) || 0)) && enVentana(d, m)
  const out = []
  for (const d of libresD) {
    const ms = libresM.filter(m => calza(d, m)); if (ms.length !== 1) continue
    if (libresD.filter(o => calza(o, ms[0])).length !== 1) continue
    out.push({ d, m: ms[0] })
  }
  return out
}
