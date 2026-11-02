import test from 'node:test'
import assert from 'node:assert/strict'
import { alertasTercero, cadenaCuotas, fechaLimiteTercero, propuestasCuadre, resumenTercero } from '../supabase/functions/_shared/terceroFacturasReglas.js'

// Datos ficticios: Proveedor A (RUT inventado) y Cliente A.
const PROV = { id: 'pA', rut: '76.000.111-2' }
const RUT = '76000111-2'
const bill = (id, folio, issued, extra = {}) => ({ id, invoice_no: folio, issued_at: issued, status: 'Pendiente', amount: 1000000, billing_type: 'honorarios', ...extra })
const pago = (id, billing_id, monto, extra = {}) => ({ id, billing_id, proveedor_id: 'pA', monto, estado: 'pendiente', factura_numero: null, ...extra })
const doc = (id, folio, fecha, monto, extra = {}) => ({ id, folio: String(folio), tipo_dte: 34, fecha_emision: fecha, emisor_rut: RUT, monto, ...extra })

const billing = [bill('b1', 'F1', '2026-08-03'), bill('b2', 'F2', '2026-09-01'), bill('b3', 'F3', '2026-10-02')]

test('calce exacto: un documento y una cuota con el mismo monto', () => {
  const r = propuestasCuadre({ docs: [doc('d1', 100, '2026-08-31', 500000)], pagos: [pago('t1', 'b1', 500000)], billing, proveedor: PROV })
  assert.equal(r.propuestas.length, 1)
  assert.equal(r.propuestas[0].pago.id, 't1')
  assert.equal(r.propuestas[0].diferencia, 0)
  assert.equal(r.noResueltas.length, 0)
})

test('calce dentro de 1%: propone con la diferencia y el porcentaje', () => {
  const r = propuestasCuadre({ docs: [doc('d1', 100, '2026-08-31', 503000)], pagos: [pago('t1', 'b1', 500000)], billing, proveedor: PROV })
  assert.equal(r.propuestas.length, 1)
  assert.equal(r.propuestas[0].diferencia, 3000)
  assert.ok(Math.abs(r.propuestas[0].pct - 0.006) < 1e-9)
})

test('fuera de tolerancia: no propone y deja el motivo', () => {
  const r = propuestasCuadre({ docs: [doc('d1', 100, '2026-08-31', 520000)], pagos: [pago('t1', 'b1', 500000)], billing, proveedor: PROV })
  assert.equal(r.propuestas.length, 0)
  assert.equal(r.noResueltas[0].motivo, 'fuera_tolerancia')
})

test('dos cuotas posibles: ambiguo, no propone', () => {
  const r = propuestasCuadre({ docs: [doc('d1', 100, '2026-09-30', 502000)], pagos: [pago('t1', 'b1', 500000), pago('t2', 'b2', 501000)], billing, proveedor: PROV })
  assert.equal(r.propuestas.length, 0)
  assert.equal(r.noResueltas[0].motivo, 'varias_cuotas')
  assert.equal(r.noResueltas[0].candidatas.length, 2)
})

test('FIFO: una cuota ya propuesta sale del universo y resuelve la siguiente', () => {
  // Montos separados >1%: cada documento calza solo con la suya, sin importar el orden de entrada.
  const docs = [doc('d2', 101, '2026-09-30', 600000), doc('d1', 100, '2026-08-31', 500000)]
  const r = propuestasCuadre({ docs, pagos: [pago('t2', 'b2', 600000), pago('t1', 'b1', 500000)], billing, proveedor: PROV })
  assert.deepEqual(r.propuestas.map(p => [p.doc.id, p.pago.id]), [['d1', 't1'], ['d2', 't2']])
  // Montos parecidos: el 1º documento solo calza con la cuota 1 (la 2ª ya está registrada), el 2º con la 2ª.
  const r2 = propuestasCuadre({
    docs: [doc('d1', 100, '2026-08-31', 500000), doc('d2', 101, '2026-09-30', 502000)],
    pagos: [pago('t1', 'b1', 500000), pago('t2', 'b2', 501000)], billing, proveedor: PROV })
  assert.equal(r2.propuestas.length, 0)   // ambos documentos caben en las dos cuotas: nada se adivina
  assert.equal(r2.noResueltas.length, 2)
  const r3 = propuestasCuadre({
    docs: [doc('d1', 100, '2026-08-31', 500000), doc('d2', 101, '2026-09-30', 502000)],
    pagos: [pago('t1', 'b1', 500000, { factura_numero: '100' }), pago('t2', 'b2', 501000)], billing, proveedor: PROV })
  assert.deepEqual(r3.propuestas.map(p => [p.doc.id, p.pago.id]), [['d2', 't2']])
})

test('un documento ya ligado por factura_numero, otro emisor o nota de crédito no se propone', () => {
  const docs = [doc('d1', 100, '2026-08-31', 500000), doc('d2', 200, '2026-08-31', 500000, { emisor_rut: '99999999-9' }), doc('d3', 300, '2026-08-31', 500000, { tipo_dte: 61 })]
  const r = propuestasCuadre({ docs, pagos: [pago('t0', 'b1', 500000, { factura_numero: '0100' }), pago('t1', 'b2', 500000)], billing, proveedor: PROV })
  assert.equal(r.propuestas.length, 0)
  assert.equal(r.noResueltas.length, 0)
})

test('descartes: una propuesta rechazada no vuelve', () => {
  const args = { docs: [doc('d1', 100, '2026-08-31', 500000)], pagos: [pago('t1', 'b1', 500000)], billing, proveedor: PROV }
  assert.equal(propuestasCuadre({ ...args, descartes: new Set(['d1|t1']) }).propuestas.length, 0)
})

test('provisión futura (sin factura nuestra) no se propone ni alerta ni cuenta', () => {
  const pagos = [pago('t1', null, 500000), pago('t2', 'bProg', 500000)]
  const b = [...billing, { id: 'bProg', status: 'Programada', issued_at: '2026-06-09', amount: 1 }]
  assert.equal(propuestasCuadre({ docs: [doc('d1', 100, '2026-08-31', 500000)], pagos, billing: b, proveedor: PROV }).propuestas.length, 0)
  assert.equal(alertasTercero({ pagos, docs: [], billing: b, proveedor: PROV, hoy: '2026-11-02' }).length, 0)
  const c = cadenaCuotas({ pagos, docs: [], billing: b, proveedor: PROV, hoy: '2026-11-02' })
  assert.equal(c.cuotas.length, 0)
  assert.equal(c.provision, 2)
})

test('esperada: sin alerta hasta el día 10 del mes siguiente; después, alerta', () => {
  const args = { pagos: [pago('t3', 'b3', 500000)], docs: [], billing, proveedor: PROV }
  assert.equal(fechaLimiteTercero('2026-10-02'), '2026-11-10')
  assert.equal(fechaLimiteTercero('2026-12-15'), '2027-01-10')
  assert.equal(alertasTercero({ ...args, hoy: '2026-11-10' }).length, 0)
  assert.equal(cadenaCuotas({ ...args, hoy: '2026-11-10' }).cuotas[0].debemos.factura, 'esperada')
  const a = alertasTercero({ ...args, hoy: '2026-11-11' })
  assert.deepEqual(a.map(x => x.tipo), ['esperada_sin_emitir'])
  assert.equal(cadenaCuotas({ ...args, hoy: '2026-11-11' }).cuotas[0].debemos.factura, 'sin_emitir')
})

test('esperada: lo pagado o anterior a la app no alerta; con propuesta tampoco', () => {
  assert.equal(alertasTercero({ pagos: [pago('t1', 'b1', 5e5, { estado: 'pagado' })], docs: [], billing, proveedor: PROV, hoy: '2026-12-01' }).length, 0)
  const viejo = [bill('bv', 'F0', '2026-04-01')]
  assert.equal(alertasTercero({ pagos: [pago('t0', 'bv', 5e5)], docs: [], billing: viejo, proveedor: PROV, hoy: '2026-12-01' }).length, 0)
  assert.equal(alertasTercero({ pagos: [pago('t1', 'b1', 5e5)], docs: [doc('d1', 100, '2026-08-31', 5e5)], billing, proveedor: PROV, hoy: '2026-12-01' }).length, 0)
})

test('monto fuera de tolerancia con factura_numero ya escrito', () => {
  const a = alertasTercero({ pagos: [pago('t1', 'b1', 500000, { factura_numero: '100' })], docs: [doc('d1', 100, '2026-08-31', 530000)], billing, proveedor: PROV, hoy: '2026-09-01' })
  assert.deepEqual(a.map(x => x.tipo), ['monto'])
  assert.ok(Math.abs((a[0].pct || 0) - 0.06) < 1e-9)
  const ok = alertasTercero({ pagos: [pago('t1', 'b1', 500000, { factura_numero: '100' })], docs: [doc('d1', 100, '2026-08-31', 502000)], billing, proveedor: PROV, hoy: '2026-09-01' })
  assert.equal(ok.length, 0)
})

test('folio repetido en dos cuotas de facturas nuestras distintas', () => {
  const a = alertasTercero({ pagos: [pago('t1', 'b1', 5e5, { factura_numero: '100' }), pago('t2', 'b2', 5e5, { factura_numero: '100' })], docs: [doc('d1', 100, '2026-08-31', 5e5)], billing, proveedor: PROV, hoy: '2026-12-01' })
  assert.deepEqual(a.map(x => x.tipo), ['folio_repetido'])
})

test('emisor distinto: el folio existe en el SII pero de otro RUT', () => {
  const a = alertasTercero({ pagos: [pago('t1', 'b1', 5e5, { factura_numero: '100' })], docs: [doc('dx', 100, '2026-08-31', 5e5, { emisor_rut: '99999999-9' })], billing, proveedor: PROV, hoy: '2026-09-01' })
  assert.deepEqual(a.map(x => x.tipo), ['emisor_distinto'])
})

test('cadena: cuatro hitos y totales', () => {
  const pagos = [pago('t1', 'b1', 500000, { factura_numero: '100', estado: 'pagado', pagado_at: '2026-09-05' }), pago('t2', 'b2', 600000), pago('t3', 'b3', 700000)]
  const b = [bill('b1', 'F1', '2026-08-03', { status: 'Pagado', paid_at: '2026-09-01' }), bill('b2', 'F2', '2026-09-01', { status: 'Vencido' }), bill('b3', 'F3', '2026-10-02')]
  const c = cadenaCuotas({ pagos, docs: [doc('d1', 100, '2026-08-31', 500000), doc('d2', 101, '2026-09-30', 601000)], billing: b, proveedor: PROV, hoy: '2026-11-11' })
  assert.equal(c.cuotas.length, 3)
  assert.deepEqual(c.cuotas.map(x => x.debemos.factura), ['recibida', 'propuesta', 'sin_emitir'])
  assert.equal(c.cuotas[0].clientePaga.ok, true)
  assert.equal(c.cuotas[0].pagamos.ok, true)
  assert.equal(c.cuotas[1].clientePaga.vencida, true)
  assert.equal(c.cuotas[1].pagamos.habilitado, false)
  assert.deepEqual(c.totales, { n: 3, nConFactura: 1, facturado: 3000000, parteTercero: 1800000, conFactura: 500000 })
})

test('listas vacías y valores nulos: sin NaN ni errores', () => {
  const r = resumenTercero({})
  assert.deepEqual([r.propuestas.length, r.alertas.length, r.nRevisar, r.cadena.cuotas.length], [0, 0, 0, 0])
  const c = cadenaCuotas({ pagos: [{ id: 'x', proveedor_id: 'pA', monto: null, billing_id: 'b1' }], docs: null, billing, proveedor: PROV, hoy: null })
  assert.equal(Number.isNaN(c.totales.parteTercero), false)
  assert.equal(c.totales.parteTercero, 0)
  assert.equal(alertasTercero({ pagos: null, docs: null, billing: null, proveedor: null }).length, 0)
})
