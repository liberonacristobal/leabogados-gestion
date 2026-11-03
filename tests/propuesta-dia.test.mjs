// Propuesta del día: cruce de una factura del SII con lo que el Excel «Facturar» proponía. Casos anonimizados.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { propuestaDelDia, rutDeCuota, montoDeCuota, rutNorm, senalesTexto, glosaContradice, glosaApoya, explicarAsignacion, parcheRegistroCuota, instantaneaCuota, parcheDeshacerRegistro } from '../supabase/functions/_shared/facturacionReglas.js'

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

// ── Glosa, subarriendo, comisión, registro de cuota ──
test('señales de la glosa: N° de cuota y mes, con los textos reales del 03-11', () => {
  assert.equal(senalesTexto('Servicios legales Pago 6/10').cuota, 6)
  assert.equal(senalesTexto('Servicios legales Fusiones 2-18 UF 58').cuota, 2)
  assert.equal(senalesTexto('Servicios legales Pago 4-9 UF 47,52').cuota, 4)
  assert.equal(senalesTexto('Servicios legales Cuota 1-6').cuota, 1)
  assert.equal(senalesTexto('Servicios legales Saldo final 2/2').cuota, 2)
  assert.equal(senalesTexto('Asesoría permanente Octubre 2026 OT 424').mes, 9)
  assert.equal(senalesTexto('Servicios profesionales Asesoría legal permanente sociedad UF 40').cuota, null)
})
test('la glosa solo contradice con otro N° de cuota u otro mes; sin dato no contradice', () => {
  assert.equal(glosaContradice('Pago 6/10', 'Reorganizacion patrimonial — Cuota 7/10'), true)
  assert.equal(glosaContradice('Pago 6/10', 'Reorganizacion patrimonial — Cuota 6/10'), false)
  assert.equal(glosaContradice('Asesoría Laboral octubre 2026', 'Subarrendamiento oficina — Mensual Mayo 2026'), true)
  assert.equal(glosaContradice('Asesoría legal permanente sociedad UF 40', 'Reorganización patrimonial — Cuota 3/15'), false)
  assert.equal(glosaApoya('Octubre 2026', 'Asesoría Permanente — Mensual Octubre 2026'), true)
})
test('si la glosa contradice a todas las que calzan, sin cuota y sin propuesta (no cae a las tolerancias)', () => {
  const r = run({ rut: '76217569K', monto: 2393309, fecha: '2026-11-03', glosa: 'Servicios legales Pago 7' })
  assert.equal(r.nivel, 'sin_cuota'); assert.equal(r.propuesta, null); assert.deepEqual(r.candidatas, [])
  assert.equal(run({ rut: '76217569K', monto: 2393309, fecha: '2026-11-03', glosa: 'Fusiones 2-18 UF 58' }).evidencia.glosa, 'calza')
})
test('la glosa desempata entre cuotas de la misma serie', () => {
  const dos = [...progs, P('a1', { sale_id: 's1', amount: 2381792, due: '2026-10-01', concept: 'Malla — Cuota 1/18' })]
  const r = run({ rut: '76217569K', monto: 2393309, fecha: '2026-11-03', glosa: 'Fusiones 2-18' }, { programadas: dos })
  assert.equal(r.nivel, 'exacta'); assert.equal(r.propuesta.id, 'a2')
})
test('subarriendo: incluye cuotas pagadas por adelantado, propone la cubierta por el pago cercano y nunca usa la glosa', () => {
  const ventasS = [...ventas, { id: 'ss', moneda: 'CLP', uf_value: null, cobro_config: { subarriendo: true } }]
  const sub = [
    P('m5', { sale_id: 'ss', amount: 1080000, due: '2026-05-01', concept: 'Subarrendamiento oficina — Mensual Mayo 2026', client_id: 'c2', entity_id: null, receptor_rut: '78.099.865-2' }),
    P('m11', { sale_id: 'ss', amount: 1080000, due: '2026-11-01', concept: 'Subarrendamiento oficina — Mensual Noviembre 2026', client_id: 'c2', entity_id: null, receptor_rut: '78.099.865-2', status: 'Anticipada', paid_at: '2026-11-02' }),
  ]
  const r = propuestaDelDia({ doc: { rut: '78099865-2', monto: 1080000, fecha: '2026-11-03', glosa: 'Asesoría Laboral octubre 2026' }, programadas: sub, ents: [], clientes, ventas: ventasS, ufPorFecha: UF })
  assert.equal(r.nivel, 'subarriendo'); assert.equal(r.propuesta.id, 'm11'); assert.deepEqual(r.candidatas.map(c => c.id), ['m11', 'm5'])
  const sinPago = propuestaDelDia({ doc: { rut: '78099865-2', monto: 1080000, fecha: '2026-11-03' }, programadas: [sub[0]], ents: [], clientes, ventas: ventasS, ufPorFecha: UF })
  assert.equal(sinPago.propuesta.id, 'm5')
})
test('comisión por facturar: solo Anticipada de monto exacto y dentro de 60 días; se propone, no se registra sola', () => {
  const com = (o) => P('k1', { billing_type: 'comision', status: 'Anticipada', amount: 202500, due: '2026-10-21', paid_at: '2026-10-21', sale_id: null, ...o })
  const doc = { rut: '76217569K', monto: 202500, fecha: '2026-11-03' }
  assert.equal(propuestaDelDia({ doc, programadas: [com()], ents, clientes, ventas, ufPorFecha: UF }).nivel, 'comision')
  assert.equal(propuestaDelDia({ doc: { ...doc, monto: 202501 + 1 }, programadas: [com()], ents, clientes, ventas, ufPorFecha: UF }).nivel, null)
  assert.equal(propuestaDelDia({ doc, programadas: [com({ status: 'Programada' })], ents, clientes, ventas, ufPorFecha: UF }).nivel, null)
  assert.equal(propuestaDelDia({ doc, programadas: [com({ paid_at: '2026-05-01', due: '2026-05-01' })], ents, clientes, ventas, ufPorFecha: UF }).nivel, null)
})
test('explicación de una asignación automática', () => {
  const r = run({ rut: '76217569K', monto: 2393309, fecha: '2026-11-03', glosa: 'Fusiones 2-18 UF 58' })
  assert.equal(explicarAsignacion(r.evidencia, 'Malla — Cuota 2/18'), 'Asignada a «Malla — Cuota 2/18». Coinciden el RUT, el monto (58 UF × UF del 03-11-2026) y la cuota 2 de la glosa.')
})
test('registro de cuota: pendiente, o pagada con la fecha del pago si estaba pagada por adelantado; deshacer vuelve a la cuota', () => {
  const ahora = '2026-11-03T12:00:00Z'
  const prog = { id: 'x', status: 'Programada', amount: 2381792, due: '2026-11-01', paid: null, paid_at: null }
  const p1 = parcheRegistroCuota({ prog, folio: 511, fecha: '2026-11-03', due: '2026-11-30', montoDte: 2393309, ahora })
  assert.deepEqual([p1.invoice_no, p1.status, p1.issued_at, p1.due, p1.amount, p1.dte_xml], ['511', 'Pendiente', '2026-11-03', '2026-11-30', 2393309, undefined])
  const ant = { ...prog, status: 'Anticipada', paid_at: '2026-11-02' }
  const p2 = parcheRegistroCuota({ prog: ant, folio: 514, fecha: '2026-11-03', due: '2026-11-30', montoDte: 1080000, fechaAnticipo: '2026-11-02', ahora })
  assert.deepEqual([p2.status, p2.paid, p2.paid_at], ['Pagado', true, '2026-11-02'])
  assert.equal(parcheRegistroCuota({ prog, folio: 1, fecha: '2026-11-03', due: '2026-11-30', dteXml: '<DTE/>', ahora }).dte_xml, '<DTE/>')
  const back = parcheDeshacerRegistro(instantaneaCuota(ant), ahora)
  assert.deepEqual([back.status, back.invoice_no, back.amount, back.due, back.paid_at], ['Anticipada', null, 2381792, '2026-11-01', '2026-11-02'])
})
