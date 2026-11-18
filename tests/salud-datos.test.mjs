// Pruebas de los detectores de Salud de datos (_shared/saludDatos): cada uno marca lo que es y deja pasar lo esperable.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dteMontoTotal, montoFactura, bancoChk, ventasDup, huerfanas, vencIncoh, perTexto, antDup, ventasBorradorCobrado, honorarioDescuadrado } from './../supabase/functions/_shared/saludDatos.js'

test('monto de una factura: manda el total del XML del DTE; sin XML, el monto cargado', () => {
  assert.equal(dteMontoTotal('<Totales><MntTotal>1190000</MntTotal></Totales>'), 1190000)
  assert.equal(dteMontoTotal('<MntTotal> 1190000.4 </MntTotal>'), 1190000)
  assert.equal(dteMontoTotal(null), null)
  assert.equal(montoFactura({ amount: 1000000, dte_xml: '<MntTotal>1190000</MntTotal>' }), 1190000)
  assert.equal(montoFactura({ amount: 1000000 }), 1000000)
  assert.equal(montoFactura(null), 0)
})

test('banco: conciliar más que el monto del movimiento es sobreconciliación; un pago repartido que suma el monto es correcto', () => {
  const movs = [{ id: 1, monto: 100000 }, { id: 2, monto: 100000 }, { id: 3, monto: 100000, es_interno: true }]
  const conc = [{ movimiento_id: 1, monto_aplicado: 100000, tipo_destino: 'factura' }, { movimiento_id: 1, monto_aplicado: 5000, tipo_destino: 'factura' },
    { movimiento_id: 2, monto_aplicado: 60000, tipo_destino: 'tercero' }, { movimiento_id: 2, monto_aplicado: 40000, tipo_destino: 'gasto' },
    { movimiento_id: 3, monto_aplicado: 999999, tipo_destino: 'factura' }]
  const r = bancoChk(movs, conc, [], [{ movimiento_id: 2 }])
  assert.deepEqual(r.sobre.map(m => m.id), [1])     // el interno no se revisa
  assert.deepEqual(r.doble.map(m => m.id), [])      // comisión y gasto que suman el monto: correcto
})

test('banco: comisión y gasto en el mismo pago sin la parte de la comisión conciliada es doble conteo', () => {
  const movs = [{ id: 2, monto: 100000 }]
  const r = bancoChk(movs, [{ movimiento_id: 2, monto_aplicado: 100000, tipo_destino: 'gasto' }], [], [{ movimiento_id: 2 }])
  assert.deepEqual(r.doble.map(m => m.id), [2])
})

test('banco: lo conciliado o de caja chica que no está marcado en el movimiento queda «atrasado»; comisión pagada sin movimiento va aparte', () => {
  const movs = [{ id: 1, monto: 100000, monto_conciliado: 0 }, { id: 2, monto: 100000, monto_conciliado: 100000 }]
  const r = bancoChk(movs, [{ movimiento_id: 1, monto_aplicado: 100000, tipo_destino: 'factura' }, { movimiento_id: 2, monto_aplicado: 100000, tipo_destino: 'factura' }],
    [], [{ estado: 'pagado', pagado_at: '2026-09-01' }, { estado: 'pagado', pagado_at: '2026-05-01' }])
  assert.deepEqual(r.atras.map(m => m.id), [1])
  assert.equal(r.sinBanco.length, 1)      // la anterior a junio de 2026 es histórico
})

test('ventas duplicadas: mismo cliente, monto, año y mes entre las vivas; las eliminadas o en borrador no cuentan', () => {
  const v = (id, o = {}) => ({ id, client_id: 'c1', amount_uf: 100, year: 2026, month: 3, status: 'Activo', ...o })
  const r = ventasDup([v(1), v(2), v(3, { deleted_at: '2026-04-01' }), v(4, { status: 'Borrador' }), v(5, { month: 4 }), v(6, { client_id: 'c2' })])
  assert.equal(r.length, 1); assert.deepEqual(r[0].map(s => s.id), [1, 2])
})

test('facturas sin cliente: solo las vivas con folio; reembolsos y notas de crédito no', () => {
  const r = huerfanas([{ invoice_no: '1' }, { invoice_no: '2', client_id: 'c1' }, { invoice_no: '3', billing_type: 'reembolso' }, { invoice_no: '  ' }, { invoice_no: '4', status: 'Anulada' }, { invoice_no: '5', deleted_at: 'x' }])
  assert.deepEqual(r.map(b => b.invoice_no), ['1'])
})

test('vencimiento anterior a la emisión: solo facturas con folio sin pagar', () => {
  const b = o => ({ invoice_no: '1', status: 'Pendiente', issued_at: '2026-10-10', due: '2026-10-01', ...o })
  assert.equal(vencIncoh([b({})]).length, 1)
  assert.equal(vencIncoh([b({ status: 'Pagado' })]).length, 0)
  assert.equal(vencIncoh([b({ due: '2026-10-10' })]).length, 0)
  assert.equal(vencIncoh([b({ invoice_no: null })]).length, 0)
})

test('período en texto', () => {
  assert.equal(perTexto('2026-09'), 'septiembre 2026')
  assert.equal(perTexto(''), '')
})

test('anticipo cargado a mano que repite un depósito del banco: por la suma o por uno exacto; el revisado y el del banco no', () => {
  const ants = [{ id: 'b1', client_id: 'c1', monto: 600000 }, { id: 'b2', client_id: 'c1', monto: 400000 }, { id: 'm1', client_id: 'c1', monto: 1000000 },
    { id: 'm2', client_id: 'c1', monto: 400000 }, { id: 'm3', client_id: 'c1', monto: 400000, nota: 'x ·revisado' }, { id: 'm4', client_id: 'c2', monto: 400000 }]
  const conc = [{ tipo_destino: 'anticipo', anticipo_id: 'b1' }, { tipo_destino: 'anticipo', anticipo_id: 'b2' }]
  const r = antDup(ants, conc)
  assert.deepEqual(r.map(x => x.manual.id), ['m1', 'm2'])
  assert.equal(r[0].suma, 1000000); assert.equal(r[1].banks.length, 1)
})

test('venta en borrador o propuesta con facturas emitidas: suma lo emitido y lo pagado, orden por lo pagado', () => {
  const sales = [{ id: 1, status: 'Borrador' }, { id: 2, status: 'Propuesta' }, { id: 3, status: 'Activo' }, { id: 4, status: 'Borrador' }]
  const bs = [{ sale_id: 1, invoice_no: '1', amount: 100, status: 'Pendiente' }, { sale_id: 2, invoice_no: '2', amount: 300, status: 'Pagado' }, { sale_id: 2, invoice_no: '3', amount: 50, status: 'Anulada' }, { sale_id: 3, invoice_no: '4', amount: 999, status: 'Pagado' }]
  const r = ventasBorradorCobrado(sales, bs)
  assert.deepEqual(r.map(x => [x.s.id, x.emitido, x.pagado, x.n]), [[2, 300, 300, 1], [1, 100, 0, 1]])
})

test('honorario descuadrado: no se marca una venta terminada cuya última factura es anterior a la app', () => {
  const rows = [{ id: 1, honorario_descuadrado: true }, { id: 2, honorario_descuadrado: true }, { id: 3, honorario_descuadrado: false }]
  const sales = [{ id: 1, status: 'Terminado' }, { id: 2, status: 'Terminado' }]
  const bs = [{ sale_id: 1, issued_at: '2026-01-10' }, { sale_id: 2, issued_at: '2026-08-10' }]
  assert.deepEqual(honorarioDescuadrado(rows, bs, sales).map(v => v.id), [2])
})

test('hallazgos: una nota de crédito del SII sin registrar aparece como nc_sin_registrar con su factura', async () => {
  const { hallazgos } = await import('../supabase/functions/_shared/saludDatos.js')
  const billing = [{ id: 'f1', invoice_no: '520', status: 'Pagado', billing_type: 'honorarios', amount: 2054908, receptor_rut: '76111222-3', client_id: 'c1' }]
  const siiNC = [{ id: 'n1', folio: '13', tipo_dte: 61, monto: 2054908, receptor_rut: '76.111.222-3', billing_id: null, doc_json: null }]
  const r = hallazgos({ billing, siiNC, clientName: () => 'Cliente Uno' }).filter(h => h.detector === 'nc_sin_registrar')
  assert.equal(r.length, 1)
  assert.equal(r[0].monto, 2054908)
  assert.match(r[0].titulo, /Nota de crédito N° 13/)
  assert.equal(hallazgos({ billing, siiNC: [] , clientName: () => '' }).filter(h => h.detector === 'nc_sin_registrar').length, 0)
})

test('revisión: gastos sin fecha, un caso por cliente; fondos, aperturas y borrados no cuentan', async () => {
  const { gastosSinFecha, hallazgos } = await import('../supabase/functions/_shared/saludDatos.js')
  const ex = [{ id: 1, client_id: 'A', date: null, amount: 1000, type: 'gasto' }, { id: 2, client_id: 'A', date: '', amount: 500, type: 'gasto' }, { id: 3, client_id: 'B', date: null, amount: 9000, type: 'gasto' },
    { id: 4, client_id: 'A', date: null, amount: 7, type: 'fondo' }, { id: 5, client_id: 'A', date: null, amount: 7, type: 'gasto', apertura_id: 'x' }, { id: 6, client_id: 'A', date: null, amount: 7, type: 'gasto', deleted_at: '2026-01-01' },
    { id: 7, client_id: 'A', date: '2026-06-15', amount: 7, type: 'gasto' }]
  const r = gastosSinFecha(ex)
  assert.deepEqual(r.map(x => [x.cid, x.gastos.length, x.monto]), [['B', 1, 9000], ['A', 2, 1500]])
  const h = hallazgos({ gastos: ex, clientName: id => 'Cliente ' + id }).filter(x => x.detector === 'gasto_sin_fecha')
  assert.equal(h.length, 2); assert.equal(h[1].clave, 'gasto_sin_fecha:A'); assert.equal(h[1].monto, 1500)
})

test('revisión: pago sin factura de más de 60 días; propone la cuota programada del mismo trabajo o dice que no hay', async () => {
  const { anticiposSinImputar, hallazgos } = await import('../supabase/functions/_shared/saludDatos.js')
  const an = [{ id: 'a1', client_id: 'A', sale_id: 's1', monto: 1000, estado: 'disponible', fecha: '2026-04-24' }, { id: 'a2', client_id: 'B', monto: 500, estado: 'disponible', fecha: '2026-01-01' },
    { id: 'a3', client_id: 'A', sale_id: 's1', monto: 9, estado: 'disponible', fecha: '2026-11-03' }, { id: 'a4', client_id: 'A', monto: 9, estado: 'consumido', fecha: '2026-01-01' }, { id: 'a5', client_id: 'A', monto: 9, estado: 'disponible', fecha: '2026-01-01', billing_id: 'f' }]
  const bs = [{ id: 'c2', client_id: 'A', sale_id: 's1', status: 'Programada', due: '2026-12-01' }, { id: 'c1', client_id: 'A', sale_id: 's1', status: 'Programada', due: '2026-11-01' }, { id: 'c9', client_id: 'A', sale_id: 's9', status: 'Programada', due: '2026-10-01' }]
  const r = anticiposSinImputar(an, bs, '2026-11-18')
  assert.deepEqual(r.map(x => [x.a.id, x.cuota ? x.cuota.id : null]), [['a2', null], ['a1', 'c1']])   // recientes, consumidos y ya ligados a factura no cuentan; la cuota es la primera del mismo trabajo
  const h = hallazgos({ anticipos: an, billing: bs, hoy: '2026-11-18', clientName: id => 'Cliente ' + id }).filter(x => x.detector === 'anticipo_sin_imputar')
  assert.equal(h.length, 2); assert.match(h[1].titulo, /podría cubrir una cuota programada/); assert.match(h[0].titulo, /sin cuota a la que imputarlo/)
})
