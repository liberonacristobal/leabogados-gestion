// Pruebas del registro de facturas del SII y de la cobertura de cuotas por venta (_shared). Sin nombres de clientes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mesScoreCandidata, candidatasProgramadas, unaSerie, decidirRegistroSII, ultimoDiaHabilMesEmision, serieYaFacturadaEnMes, claveVentaFactura } from './../supabase/functions/_shared/facturacionReglas.js'
import { ventasFacturando, cuotasCubiertasVenta } from './../supabase/functions/_shared/ventasReglas.js'

const prog = (id, sale_id, due, amount, o = {}) => ({ id, sale_id, due, amount, status: 'Programada', client_id: 'c1', ...o })

test('mes de servicio: manda la convención «mes vencido» (servicio = vencimiento − 1), luego la cuota, y el mes directo pesa poco', () => {
  assert.equal(mesScoreCandidata('Honorarios', '2026-10-31', 8), 3)        // vence en octubre → servicio septiembre (mes 8)
  assert.equal(mesScoreCandidata('Honorarios septiembre', '2026-12-31', 8), 3)
  assert.equal(mesScoreCandidata('Cuota 10', '2026-12-31', 8), 2)          // cuota 10 → septiembre
  assert.equal(mesScoreCandidata('Honorarios', '2026-09-15', 8), 1)        // mes directo: señal débil
  assert.equal(mesScoreCandidata('Honorarios', '2026-12-15', null), 0)
})

test('candidatas para una factura: sin folio, monto ±6%, vencimiento a ≤120 días, de ese cliente, y primero la del período', () => {
  const billing = [
    prog('a', 's1', '2026-09-30', 1000000),
    prog('b', 's1', '2026-10-31', 1000000),
    prog('c', 's1', '2026-10-31', 1100000),                      // fuera del ±6%
    prog('d', 's1', '2025-01-31', 1000000),                      // vence a más de 120 días
    prog('e', 's1', '2026-10-31', 1000000, { invoice_no: '55' }),// ya tiene folio
    prog('f', 's1', '2026-10-31', 1000000, { client_id: 'c2' }),
    prog('g', 's1', '2026-10-31', 1000000, { billing_type: 'reembolso' }),
  ]
  const r = candidatasProgramadas(billing, 'c1', 1000000, '2026-10-05', 'Honorarios septiembre 2026')
  assert.deepEqual(r.map(x => x.id), ['b', 'a'])       // la de octubre (servicio septiembre) pesa más que la de septiembre
  assert.deepEqual(candidatasProgramadas(billing, 'c1', 0, '2026-10-05', ''), [])
  assert.deepEqual(candidatasProgramadas(billing, null, 1000, '2026-10-05', ''), [])
})

test('candidatas: una comisión exige el monto exacto (±$1) y vencimiento a ≤60 días', () => {
  const billing = [prog('a', 's1', '2026-10-31', 1000000, { billing_type: 'comision' })]
  assert.equal(candidatasProgramadas(billing, 'c1', 1000001, '2026-10-30', '').length, 1)
  assert.equal(candidatasProgramadas(billing, 'c1', 1000100, '2026-10-30', '').length, 0)
  assert.equal(candidatasProgramadas(billing, 'c1', 1000000, '2026-07-01', '').length, 0)
})

test('registro automático: una cuota la reemplaza, las de una misma serie toman la más antigua, de ventas distintas decide una persona', () => {
  assert.deepEqual(decidirRegistroSII([prog('a', 's1', '2026-10-31', 1)], []).tipo, 'prog')
  const serie = [prog('b', 's1', '2026-11-30', 1), prog('a', 's1', '2026-10-31', 1)]
  assert.equal(unaSerie(serie), true)
  assert.equal(decidirRegistroSII(serie, []).prog.id, 'a')
  const mezcla = [prog('a', 's1', '2026-10-31', 1), prog('b', 's2', '2026-10-31', 1)]
  assert.equal(unaSerie(mezcla), false)
  assert.equal(decidirRegistroSII(mezcla, []).tipo, 'manual')
  assert.deepEqual(decidirRegistroSII([], [{ id: 's9' }]), { tipo: 'nueva', saleId: 's9' })
  assert.deepEqual(decidirRegistroSII([], [{ id: 's9' }, { id: 's8' }]), { tipo: 'nueva', saleId: null })
})

test('vencimiento de pago: último día hábil del mes de emisión si se emite hasta el 10; después, el del mes siguiente', () => {
  assert.equal(ultimoDiaHabilMesEmision('2026-10-05'), '2026-10-30')     // 31-10 es sábado
  assert.equal(ultimoDiaHabilMesEmision('2026-10-11'), '2026-11-30')
  assert.equal(ultimoDiaHabilMesEmision('2026-12-20'), '2027-01-29')     // 31-01-2027 es domingo
  assert.equal(ultimoDiaHabilMesEmision('2026-10-05', d => d.getDate() !== 30 && d.getDay() !== 0 && d.getDay() !== 6), '2026-10-29')   // con un feriado el 30
  assert.equal(ultimoDiaHabilMesEmision(null), null)
})

test('serie ya facturada en el mes: otra factura distinta de la misma venta en ese mes; no la misma, ni anulada, ni de otro mes', () => {
  const b = (o) => ({ sale_id: 's1', invoice_no: '10', issued_at: '2026-10-07', status: 'Pendiente', ...o })
  assert.equal(serieYaFacturadaEnMes([b({})], 's1', '2026-10-20', '11').invoice_no, '10')
  assert.ok(!serieYaFacturadaEnMes([b({})], 's1', '2026-10-20', '10'))
  assert.ok(!serieYaFacturadaEnMes([b({ status: 'Anulada' })], 's1', '2026-10-20', '11'))
  assert.ok(!serieYaFacturadaEnMes([b({ issued_at: '2026-09-07' })], 's1', '2026-10-20', '11'))
  assert.ok(!serieYaFacturadaEnMes([b({})], null, '2026-10-20', '11'))
})

test('clave de lo aprendido: cliente + RUT sin formato + glosa sin tildes ni espacios dobles', () => {
  assert.equal(claveVentaFactura({ client_id: 'c1', receptor_rut: '76.111.111-k', concept: '  Asesoría   Mensual ' }), 'c1|76111111K|asesoria mensual')
  assert.equal(claveVentaFactura(null), '||')
})

test('ventas que ya facturan: con folio, sin anular ni reembolso', () => {
  const s = ventasFacturando([
    { sale_id: 1, invoice_no: '10' }, { sale_id: 2, invoice_no: '11', status: 'Anulada' }, { sale_id: 3, invoice_no: '12', billing_type: 'reembolso' },
    { sale_id: 4 }, { sale_id: 5, invoice_no: '13', deleted_at: '2026-10-01' },
  ])
  assert.deepEqual([...s], ['1'])
})

test('cuotas cubiertas: el exceso facturado sobre el plan cubre las programadas más antiguas', () => {
  const sales = [{ id: 's1', status: 'Activo', amount_clp: 3000000, cobro_config: {} }]
  const billing = [
    { id: 'f1', sale_id: 's1', invoice_no: '1', amount: 2000000, issued_at: '2026-08-01', status: 'Pagado' },
    prog('p1', 's1', '2026-09-01', 1000000), prog('p2', 's1', '2026-10-01', 1000000), prog('p3', 's1', '2026-11-01', 1000000),
  ]
  // facturado 2.000.000 + programadas 3.000.000 − plan 3.000.000 = 2.000.000 de exceso → cubre p1 y p2 enteras, no p3
  const r = cuotasCubiertasVenta(billing, sales, {})
  assert.deepEqual([...r.keys()].sort(), ['p1', 'p2'])
  assert.deepEqual(r.get('p1'), { total: true, m: 1000000 })
})

test('cuotas cubiertas: un exceso parcial (menos del 80% de la cuota) cubre solo esa parte; dentro del 3% del plan no cubre nada', () => {
  const sales = [{ id: 's1', status: 'Activo', amount_clp: 3000000, cobro_config: {} }]
  const base = [{ id: 'f1', sale_id: 's1', invoice_no: '1', amount: 2500000, issued_at: '2026-08-01', status: 'Pagado' }, prog('p1', 's1', '2026-09-01', 1000000), prog('p2', 's1', '2026-10-01', 1000000)]
  // 2.500.000 + 2.000.000 − 3.000.000 = 1.500.000: p1 entera y 500.000 de p2
  const r = cuotasCubiertasVenta(base, sales, {})
  assert.deepEqual(r.get('p1'), { total: true, m: 1000000 })
  assert.deepEqual(r.get('p2'), { total: false, m: 500000 })
  const casi = [{ ...base[0], amount: 2000000 }, prog('p1', 's1', '2026-09-01', 1000000), prog('p2', 's1', '2026-10-01', 50000)]
  assert.equal(cuotasCubiertasVenta(casi, sales, {}).size, 0)   // exceso de 50.000 < 3% de 3.000.000
})

test('cuotas cubiertas: venta recurrente o sin plan no aplica, y sin la UF de una fecha no se infiere nada', () => {
  const rec = [{ id: 's1', status: 'Activo', cobro_type: 'mensual', amount_clp: 1000000 }]
  const bs = [{ id: 'f1', sale_id: 's1', invoice_no: '1', amount: 5000000, issued_at: '2026-08-01', status: 'Pagado' }, prog('p1', 's1', '2026-09-01', 1000000)]
  assert.equal(cuotasCubiertasVenta(bs, rec, {}).size, 0)
  const enUF = [{ id: 's1', status: 'Activo', moneda: 'UF', amount_uf: 100, cobro_config: {} }]
  assert.equal(cuotasCubiertasVenta(bs, enUF, {}).size, 0)   // sin valores de UF: no se esconde plata
})
