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

// Facturas recibidas por pagar: emitidas desde que existe la app, con más de 30 días y sin pago enlazado, que NO muestran pago por
// ninguna vía conocida. Se descartan con evidencia: cargo del banco del mismo RUT por el monto exacto (uno o dos cargos, aunque sea
// antes de la emisión); gasto registrado por el mismo monto ±3 días (caja chica o banco); comercio de la tarjeta (regla
// tarjeta_comercio); emisor marcado con su forma de pago (learnings compra_pago_emisor: tarjeta, cargo automático); colaboradores
// (sus facturas son del módulo Comisiones, no de este); nota de crédito del mismo emisor por el monto; y la factura que alguien
// ya marcó pagada (learnings compra_pagada). Lo que queda va «por confirmar», con lo pagado parcial (cargos del RUT en la ventana).
export const COMPRA_POR_PAGAR_DIAS = 30
export function comprasPorPagar({ docs = [], cargos = [], gastos = [], tarjetaReglas = [], emisoresPago = new Set(), rutsColaboradores = new Set(), pagadas = new Set(), hoy, appDesde = '2026-06-06', dias = COMPRA_POR_PAGAR_DIAS }) {
  const lim = new Date(new Date(hoy + 'T12:00').getTime() - dias * 864e5).toISOString().slice(0, 10)
  const nc = (docs || []).filter(d => Number(d.tipo_dte) === 61)
  const reTar = (tarjetaReglas || []).map(k => { try { return new RegExp(k, 'i') } catch (_) { return null } }).filter(Boolean)
  const cargosDe = {}; (cargos || []).forEach(m => { if (m.tipo === 'abono' || m.es_interno || m.estado === 'interno') return; const r = _rut(m.rut_contraparte); if (r) (cargosDe[r] = cargosDe[r] || []).push(m) })
  const out = []
  for (const d of docs || []) {
    const t = Number(d.tipo_dte), r = _rut(d.emisor_rut), monto = Math.round(Math.abs(Number(d.monto) || 0)), fe = String(d.fecha_emision || '').slice(0, 10)
    if ((t !== 33 && t !== 34) || d.movimiento_id || !fe || fe < appDesde || fe > lim || !(monto > 0) || pagadas.has(String(d.id))) continue
    if (rutsColaboradores.has(r) || emisoresPago.has(r) || reTar.some(re => re.test(String(d.emisor_name || '')))) continue
    if (nc.some(n => _rut(n.emisor_rut) === r && Math.round(Math.abs(Number(n.monto) || 0)) === monto)) continue
    const enV = (m, antes) => { const x = _dias(m.fecha, fe); return x >= -antes && x <= COMPRA_PAGO_DESPUES }
    const cs = (cargosDe[r] || []).filter(m => enV(m, 60)), mm = m => Math.round(Math.abs(Number(m.monto) || 0))
    if (cs.some(m => mm(m) === monto) || cs.some((a, i) => cs.some((b, j) => j > i && mm(a) + mm(b) === monto))) continue
    if ((gastos || []).some(g => Math.round(Number(g.amount) || 0) === monto && Math.abs(_dias(g.date, fe)) <= 3)) continue
    const pagado = Math.min(monto, cs.reduce((a, m) => a + mm(m), 0))
    out.push({ d, monto, pagado, falta: monto - pagado, dias: _dias(hoy, fe) })
  }
  return out.sort((a, b) => b.falta - a.falta)
}
