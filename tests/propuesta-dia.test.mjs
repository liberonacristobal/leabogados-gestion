// Propuesta del día: cruce de una factura del SII con lo que el Excel «Facturar» proponía. Casos anonimizados.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { propuestaDelDia, rutDeCuota, montoDeCuota, rutNorm } from '../supabase/functions/_shared/facturacionReglas.js'

const UF = { '2026-11-02': 41258.26, '2026-11-03': 41263.57, '2026-11-04': 41268.88 }
const clientes = [{ id: 'c1', rut: null }, { id: 'c2', rut: '77.000.000-1' }]
const ents = [{ id: 'e1', client_id: 'c1', rut: '76.217.569-K' }, { id: 'e2', client_id: 'c1', rut: '11.111.111-1' }]
const ventas = [
  { id: 's1', moneda: 'UF', uf_value: 41065 },    // cuota 2.381.792 = 58 UF
  { id: 's2', moneda: 'UF', uf_value: 40650 },    // cuota 1.626.000 = 40 UF
  { id: 's3', moneda: 'CLP', uf_value: null },
]
const P = (id, o) => ({ id, client_id: 'c1', entity_id: 'e1', receptor_rut: '76.217.569-K', status: 'Programada', invoice_no: null, billing_type: 'honorarios', ...o })
const progs = [
  P('a2', { sale_id: 's1', amount: 2381792, due: '2026-11-01', concept: 'Malla — Cuota 2/18' }),
  P('a3', { sale_id: 's1', amount: 2381792, due: '2026-12-01', concept: 'Malla — Cuota 3/18' }),
  P('b1', { sale_id: 's2', amount: 1626000, due: '2026-11-30', concept: 'Asesoría Permanente — Mensual Octubre 2026' }),
  P('b2', { sale_id: 's2', amount: 1626000, due: '2026-12-31', concept: 'Asesoría Permanente — Mensual Noviembre 2026' }),
]
const run = (doc, extra = {}) => propuestaDelDia({ doc, programadas: progs, ents, clientes, ventas, ufPorFecha: UF, ...extra })

test('reproduce la fórmula del Excel: cuota en UF × UF del día, al peso', () => {
  assert.equal(montoDeCuota(progs[0], ventas[0], 41263.57), 2393309)
  assert.equal(montoDeCuota(progs[2], ventas[1], 41263.57), 1650543)
  assert.equal(montoDeCuota({ amount: 500000 }, ventas[2], 41263.57), 500000)
  assert.equal(montoDeCuota(progs[0], { moneda: 'UF', uf_value: null }, 41263.57), null)
})

test('una sola cuota calza exacto (aunque sea recurrente): se registra sola, y no cuenta las de meses futuros', () => {
  const r = run({ rut: '76217569-K', monto: 2393309, fecha: '2026-11-03' })
  assert.equal(r.nivel, 'exacta'); assert.equal(r.propuesta.id, 'a2')
  const m = run({ rut: '76.217.569-K', monto: 1650543, fecha: '2026-11-03' })
  assert.equal(m.nivel, 'exacta'); assert.equal(m.propuesta.id, 'b1')
})

test('el UF de cualquier día de la ventana sirve (descarga un día, emite el siguiente)', () => {
  assert.equal(run({ rut: '76217569K', monto: Math.round(2381792 / 41065 * 41258.26), fecha: '2026-11-03' }).nivel, 'exacta')
  assert.equal(run({ rut: '76217569K', monto: 2393309 + 500, fecha: '2026-11-03' }).nivel, null, 'un monto que no es de ningún día no calza')
})

test('varias cuotas de una misma venta con el mismo monto: serie, se propone la más antigua', () => {
  const dos = [...progs, P('a1', { sale_id: 's1', amount: 2381792, due: '2026-10-01', concept: 'Malla — Cuota 1/18' })]
  const r = run({ rut: '76217569K', monto: 2393309, fecha: '2026-11-03' }, { programadas: dos })
  assert.equal(r.nivel, 'serie'); assert.equal(r.propuesta.id, 'a1'); assert.deepEqual(r.candidatas.map(c => c.id), ['a1', 'a2'])
})

test('cuotas de ventas distintas con el mismo monto: sin propuesta, solo las que calzan como candidatas', () => {
  const otra = [...progs, P('x1', { sale_id: 's3', amount: 2393309, due: '2026-10-31', concept: 'Otra' })]
  const r = run({ rut: '76217569K', monto: 2393309, fecha: '2026-11-03' }, { programadas: otra })
  assert.equal(r.nivel, 'varias'); assert.equal(r.propuesta, null); assert.equal(r.candidatas.length, 2)
})

test('el RUT es el de la razón social de la cuota, no el de cualquier razón social del cliente', () => {
  assert.equal(run({ rut: '11111111-1', monto: 2393309, fecha: '2026-11-03' }).nivel, null)
  assert.equal(rutDeCuota({ receptor_rut: null, entity_id: 'e2' }, ents, clientes[0]), '111111111')
  assert.equal(rutDeCuota({}, [], clientes[1]), '770000001')
})

test('una única cuota con devengo viejo se propone pero no es exacta (no se registra sola)', () => {
  const vieja = [P('v1', { sale_id: 's1', amount: 2381792, due: '2026-05-01', concept: 'Malla — Cuota 1/18' })]
  const r = run({ rut: '76217569K', monto: 2393309, fecha: '2026-11-03' }, { programadas: vieja })
  assert.equal(r.nivel, 'atrasada'); assert.equal(r.propuesta.id, 'v1')
  assert.equal(run({ rut: '76217569K', monto: 2393309, fecha: '2026-11-03' }, { programadas: [P('v2', { sale_id: 's1', amount: 2381792, due: '2026-10-01', concept: 'Malla' })] }).nivel, 'exacta', 'devengo del mes anterior sí')
})

test('no usa cuotas ya tomadas, con folio, anuladas ni de reembolso; sin datos no propone', () => {
  assert.equal(run({ rut: '76217569K', monto: 2393309, fecha: '2026-11-03' }, { usadas: new Set(['a2']) }).nivel, null)
  assert.equal(run({ rut: '76217569K', monto: 2393309, fecha: '2026-11-03' }, { programadas: [P('z', { sale_id: 's1', amount: 2381792, due: '2026-11-01', invoice_no: '5' })] }).nivel, null)
  assert.equal(run({ rut: '', monto: 100, fecha: '2026-11-03' }).nivel, null); assert.equal(run({ rut: '1-9', monto: 0, fecha: '2026-11-03' }).nivel, null)
  assert.equal(rutNorm('76.217.569-k'), '76217569K')
})
