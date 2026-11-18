// Reparto sugerido con un colaborador al cuadrar una factura del SII. Datos anonimizados.
import test from 'node:test'
import assert from 'node:assert/strict'
import { sugerirReparto, esGlosaLaboral, claveRepartoAprendido } from '../supabase/functions/_shared/repartoSugerido.js'

const fac = (id, no, concept, amount, extra = {}) => ({ id, client_id: 'c1', invoice_no: no, concept, amount, billing_type: 'honorarios', ...extra })
const tp = (billing_id, monto, extra = {}) => ({ billing_id, proveedor_id: 'p1', proveedor: 'BDA Abogados Limitada', rut: '29366958-9', monto, estado: 'pagado', comision_pct: null, ...extra })

test('glosa: reconoce conceptos laborales', () => {
  for (const g of ['Asesoría laboral', 'Juicio Laboral Cuota 1', 'Despido y finiquito', 'Tutela de derechos', 'Dirección del Trabajo']) assert.equal(esGlosaLaboral(g), true, g)
  for (const g of ['Servicios legales UF 15', 'Honorarios', '', null]) assert.equal(esGlosaLaboral(g), false, String(g))
})

test('propone el colaborador y el % de las facturas laborales anteriores del cliente (85 %)', () => {
  const billing = [fac('b1', 'Factura 273', 'Asesoria laboral', 501808), fac('b2', 'Factura 304', 'Juicio Laboral Cuota 1', 956201), fac('b3', 'Factura 144', 'Servicios legales UF 15', 587610)]
  const terceros = [tp('b1', 426537), tp('b2', 85996), tp('b2', 226775), tp('b2', 500000)]
  const r = sugerirReparto({ clienteId: 'c1', glosa: null, monto: 1639860, billing, terceros })
  assert.equal(r.proveedor, 'BDA Abogados Limitada'); assert.equal(r.pct, 85); assert.equal(r.monto, 1393881); assert.equal(r.resto, 245979)
  assert.equal(r.senal, 'historial'); assert.equal(r.glosa, 'sin_glosa'); assert.deepEqual(r.porque.sort(), ['273', '304'])
})

test('con glosa conocida: laboral propone; no laboral no propone', () => {
  const billing = [fac('b1', 'F1', 'Asesoria laboral', 100000)], terceros = [tp('b1', 85000)]
  assert.equal(sugerirReparto({ clienteId: 'c1', glosa: 'Asesoría laboral octubre', monto: 200000, billing, terceros }).glosa, 'laboral')
  assert.equal(sugerirReparto({ clienteId: 'c1', glosa: 'Servicios legales', monto: 200000, billing, terceros }), null)
})

test('sin facturas laborales anteriores con colaborador: no propone; un cliente ajeno tampoco cuenta', () => {
  assert.equal(sugerirReparto({ clienteId: 'c1', monto: 100000, billing: [fac('b1', 'F1', 'Servicios legales', 100000)], terceros: [tp('b1', 85000)] }), null)
  assert.equal(sugerirReparto({ clienteId: 'c2', monto: 100000, billing: [fac('b1', 'F1', 'Asesoria laboral', 100000)], terceros: [tp('b1', 85000)] }), null)
})

test('lo aprendido manda sobre el historial; la venta de terceros (con comision_pct) no se confunde con un colaborador', () => {
  const ap = { proveedorId: 'p9', proveedor: 'Otro colaborador', pct: 70 }
  const r = sugerirReparto({ clienteId: 'c1', monto: 100000, billing: [], terceros: [], aprendido: ap })
  assert.equal(r.senal, 'aprendido'); assert.equal(r.pct, 70); assert.equal(r.monto, 70000)
  assert.equal(sugerirReparto({ clienteId: 'c1', monto: 100000, billing: [fac('b1', 'F1', 'Asesoria laboral', 100000)], terceros: [tp('b1', 85000, { comision_pct: 15 })] }), null)
  assert.equal(claveRepartoAprendido('c1'), 'c1|laboral')
})
