// Pruebas de las reglas únicas (_shared), segunda tanda: salud de datos, compras, notaría, comisiones, calces combinados.
// Casos de situaciones reales, sin nombres de clientes. Correr: npm test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { folioDup, facDup, montoNeDte, rutMulti, comprasEnPlazoReclamo, comprasObservadasSII } from '../supabase/functions/_shared/saludDatos.js'
import { calcesCompraPago } from '../supabase/functions/_shared/comprasReglas.js'
import { liqParaCargo, notariaPendientes, disponibleNotaria, tipoActoNotaria } from '../supabase/functions/_shared/notariaReglas.js'
import { nombreGenerico } from '../supabase/functions/_shared/contrapartes.js'
import { estadoComision, pagarT, reajusteBHEPago } from '../supabase/functions/_shared/comisionesReglas.js'
import { elegirCombo } from '../supabase/functions/_shared/conciliacionReglas.js'
import { periodoDeTexto } from '../supabase/functions/_shared/facturacionReglas.js'

test('folio duplicado: solo folios vivos y numéricos', () => {
  const r = folioDup([{ invoice_no: '412' }, { invoice_no: 'Factura 412' }, { invoice_no: '413' }, { invoice_no: '414', status: 'Anulada' }, { invoice_no: '414' }, { invoice_no: '415', deleted_at: '2026-10-01' }, { invoice_no: '415' }])
  assert.deepEqual(r.map(x => x.folio), ['412'])
})

test('facturas duplicadas: la misma cuota del mismo receptor, no una serie mensual', () => {
  const base = { receptor_rut: '76.111.111-1', concept: 'Asesoría mensual', amount: 817440 }
  // Serie mensual: folios propios emitidos con un mes de diferencia → no es duplicado.
  assert.equal(facDup([{ ...base, invoice_no: '401', issued_at: '2026-09-01' }, { ...base, invoice_no: '420', issued_at: '2026-10-01' }]).length, 0)
  // Dos pagadas con folio propio → tramos legítimos, no duplicado.
  assert.equal(facDup([{ ...base, invoice_no: '401', issued_at: '2026-10-01', status: 'Pagado' }, { ...base, invoice_no: '402', issued_at: '2026-10-02', status: 'Pagado' }]).length, 0)
  // Misma semana, mismo receptor, mismo monto, pendientes → candidato a revisar.
  const dup = facDup([{ ...base, invoice_no: '401', issued_at: '2026-10-01', status: 'Pendiente' }, { ...base, invoice_no: '402', issued_at: '2026-10-03', status: 'Pendiente' }])
  assert.equal(dup.length, 1); assert.equal(dup[0].rows.length, 2)
  // Otro receptor con el mismo monto → no se cruzan.
  assert.equal(facDup([{ ...base, invoice_no: '401', issued_at: '2026-10-01' }, { ...base, receptor_rut: '77.222.222-2', invoice_no: '402', issued_at: '2026-10-01' }]).length, 0)
})

test('monto distinto del DTE y RUT en varias fichas', () => {
  const r = montoNeDte([{ amount: 1000, dte_xml: '<MntTotal>1000</MntTotal>' }, { amount: 1000, dte_xml: '<MntTotal>1190</MntTotal>' }, { amount: 1000 }])
  assert.equal(r.length, 1); assert.equal(r[0].dte, 1190)
  const m = rutMulti([{ client_id: 'a', rut: '76.111.111-1', name: 'X SpA' }, { client_id: 'b', rut: '761111111', name: 'X SpA' }, { client_id: 'a', rut: '77.222.222-2' }])
  assert.equal(m.length, 1); assert.deepEqual(m[0].clientIds.sort(), ['a', 'b'])
})

test('compras: plazo de reclamo de 8 días y observadas por el SII', () => {
  const docs = [
    { id: 1, sii_estado: 'PENDIENTE', fecha_recepcion: '2026-10-20', tipo_dte: 33 },   // vence 28-10
    { id: 2, sii_estado: 'PENDIENTE', fecha_recepcion: '2026-10-10', tipo_dte: 33 },   // venció 18-10
    { id: 3, sii_estado: 'PENDIENTE', fecha_recepcion: '2026-10-22', tipo_dte: 61 },   // nota de crédito: no se reclama
    { id: 4, sii_estado: 'ACEPTADO', fecha_recepcion: '2026-10-22', tipo_dte: 33 },
  ]
  const r = comprasEnPlazoReclamo(docs, '2026-10-24')
  assert.deepEqual(r.map(x => x.d.id), [1]); assert.equal(r[0].vence, '2026-10-28'); assert.equal(r[0].quedan, 4)
  assert.equal(comprasEnPlazoReclamo(docs, '2026-10-24', new Set(['1'])).length, 0)   // ya revisada
  const obs = comprasObservadasSII([{ id: 'a', observado_sii: true, periodo: '2025-09', folio: 2 }, { id: 'b', observado_sii: false }, { id: 'c', observado_sii: true, periodo: '2025-08', folio: 9 }], new Set(['x']))
  assert.deepEqual(obs.map(x => x.id), ['c', 'a'])
})

test('factura de compra ↔ pago del banco: calce exacto y único', () => {
  const d = (id, monto, fecha, rut = '76.111.111-1') => ({ id, tipo_dte: 33, monto, fecha_emision: fecha, emisor_rut: rut })
  const c = (id, monto, fecha, rut = '76111111-1') => ({ id, tipo: 'cargo', monto: -monto, fecha, rut_contraparte: rut })
  assert.equal(calcesCompraPago([d('f1', 119000, '2026-10-01')], [c('m1', 119000, '2026-10-20')]).length, 1)
  assert.equal(calcesCompraPago([d('f1', 119000, '2026-10-01')], [c('m1', 119001, '2026-10-20')]).length, 0)    // al peso
  assert.equal(calcesCompraPago([d('f1', 119000, '2026-10-01')], [c('m1', 119000, '2027-01-10')]).length, 0)    // fuera de 75 días
  // Dos facturas iguales y un solo pago → ambiguo, no se enlaza ninguna.
  assert.equal(calcesCompraPago([d('f1', 119000, '2026-10-01'), d('f2', 119000, '2026-10-02')], [c('m1', 119000, '2026-10-20')]).length, 0)
  // Un cargo ya enlazado a otra factura no se reutiliza.
  assert.equal(calcesCompraPago([{ ...d('f0', 119000, '2026-09-01'), movimiento_id: 'm1' }, d('f1', 119000, '2026-10-01')], [c('m1', 119000, '2026-10-20')]).length, 0)
})

test('notaría: deuda por OT, disponible del cliente y liquidación del pago', () => {
  const g = [
    { id: 1, client_id: 'c', type: 'gasto', category: 'Notaria', ot_number: '446651', amount: 100000 },
    { id: 2, client_id: 'c', type: 'gasto', category: 'Notaria', ot_number: '', amount: 50000 },             // sin OT: no es deuda con la notaría
    { id: 3, client_id: 'c', type: 'gasto', category: 'Notaria', ot_number: '446652', amount: 1 },            // escritura anulada
    { id: 4, client_id: 'c', type: 'fondo', amount: 300000 },
    { id: 5, client_id: 'c', type: 'gasto', category: 'CBR', amount: 40000, rendered_at: '2026-10-01' },      // ya pagado
    { id: 6, client_id: 'c', type: 'gasto', category: 'CBR', amount: 30000 },                                 // reservado para otro gasto
  ]
  assert.deepEqual(notariaPendientes(g).map(e => e.id), [1])
  const d = disponibleNotaria(g, 'c')
  assert.equal(d.fondo, 300000); assert.equal(d.pagado, 40000)
  assert.equal(d.reservado, 80000)   // gasto 2 (sin OT) + gasto 6; la notaría con OT no se reserva: es la que se paga
  assert.equal(d.disp, 180000)
  assert.equal(disponibleNotaria(g, 'of', { esOficina: id => id === 'of' }).disp, Infinity)
  const liqs = [{ id: 'L1', total: 1335000, created_at: '2026-10-10' }, { id: 'L2', total: 900000, created_at: '2026-10-12' }]
  const m = { tipo: 'cargo', monto: -1335000, fecha: '2026-10-19', rut_contraparte: '7777777-7' }
  assert.deepEqual(liqParaCargo(m, liqs, new Set()), { liq: liqs[0], exacto: true, auto: false })
  assert.equal(liqParaCargo(m, liqs, new Set(['7777777-7'])).auto, true)                                     // RUT ya aprendido de la notaría
  assert.equal(liqParaCargo({ ...m, monto: -1300000 }, liqs, new Set()), null)                               // distinto y RUT desconocido
  assert.equal(liqParaCargo({ ...m, monto: -1300000 }, liqs, new Set(['7777777-7'])).exacto, false)          // dentro del 10%: solo sugiere
  assert.equal(tipoActoNotaria({ materia: 'MANDATO JUDICIAL' }), 'Mandato judicial')
  assert.equal(tipoActoNotaria({ concept: 'Poder especial' }), 'Poder o mandato especial')
  assert.equal(tipoActoNotaria({ concept: 'xyz' }), 'Otro')
})

test('nombre genérico del banco: no identifica al pagador', () => {
  assert.equal(nombreGenerico('NOMINA MISMO DIA PROVEEDORES'), true)
  assert.equal(nombreGenerico('PAGO MASIVO 2026'), true)
  assert.equal(nombreGenerico(''), true)
  assert.equal(nombreGenerico('Inversiones Ríofrío Ltda'), false)
})

test('comisiones: estado, monto a transferir y reajuste de la retención', () => {
  assert.equal(estadoComision({ estado: 'pagado' }, { status: 'Pendiente' }), 'pagada')
  assert.equal(estadoComision({ estado: 'pendiente' }, { status: 'Pagado' }), 'por_pagar')     // el cliente ya pagó su cuota
  assert.equal(estadoComision({ estado: 'pendiente' }, { status: 'Pendiente' }), 'por_devengar')
  assert.equal(pagarT({ monto: 100000, liquido: 84750 }), 84750)                               // boleta: se transfiere el líquido
  assert.equal(pagarT({ monto: 100000 }), 100000)                                              // factura: el monto
  // Estimada con la tasa de 2025 (14,5%) y pagada en 2026 (15,25%): el bruto se rehace con la tasa del año del pago.
  const r = reajusteBHEPago({ monto: 100000, liquido: 85500, retencion: 14500 }, '2026-03-01')
  assert.deepEqual(r, { monto: Math.round(85500 / (1 - 0.1525)), retencion: Math.round(85500 / (1 - 0.1525)) - 85500 })
  assert.equal(reajusteBHEPago({ monto: 100000, liquido: 85500, retencion: 14500, bhe_id: 'b1' }, '2026-03-01'), null)   // con boleta mandan sus cifras
})

test('abono que paga varias facturas: combinación exacta y única', () => {
  const f = (id, saldo, fecha) => ({ b: { id, issued_at: fecha }, saldo })
  const mov = { monto: 300000, fecha: '2026-10-15' }
  assert.deepEqual(elegirCombo(mov, [f('a', 100000, '2026-09-01'), f('b', 200000, '2026-10-01'), f('c', 50000, '2026-08-01')]).map(b => b.id), ['a', 'b'])
  assert.equal(elegirCombo(mov, [f('a', 100000, '2026-09-01'), f('z', 200000, '2026-11-01')]), null)          // una factura futura no entra
  // Cuatro cuotas iguales de 75.000 que suman el abono.
  assert.equal(elegirCombo(mov, [1, 2, 3, 4, 5].map(i => f('q' + i, 75000, `2026-0${i}-01`))).length, 4)
  assert.equal(elegirCombo(mov, [f('a', 100000, '2026-09-01')]), null)
})

test('período y cuota desde la glosa', () => {
  assert.deepEqual(periodoDeTexto('Honorarios septiembre 2026 · cuota 3'), { mes: 8, anio: 2026, cuota: 3 })
  assert.deepEqual(periodoDeTexto('Asesoría legal 2/5'), { mes: null, anio: null, cuota: 2 })
  assert.equal(periodoDeTexto('Servicios oct. 2025').mes, 9)
})

test('radar de cuotas vencidas sin facturar: una sola regla para Facturación, el lunes y el cierre', async () => {
  const { cuotasSinEmitir } = await import('../supabase/functions/_shared/ventasReglas.js')
  const sales = [{ id: 's1', status: 'Activo', amount_clp: 3000000, cobro_type: 'cuotas' }, { id: 's2', status: 'Terminado', amount_clp: 1000000 }, { id: 's3', status: 'Activo', amount_clp: 900000 }]
  const f = (id, sale, extra) => ({ id, sale_id: sale, amount: 1000000, ...extra })
  const billing = [
    f('e1', 's1', { invoice_no: '401', status: 'Pagado', issued_at: '2026-07-01' }),
    f('p1', 's1', { status: 'Programada', due: '2026-10-01' }),          // vencida en el mes cerrado → entra
    f('p2', 's1', { status: 'Programada', due: '2026-11-01' }),          // aún no vence → no
    f('p3', 's2', { status: 'Programada', due: '2026-09-01' }),          // venta terminada → no
    f('p4', 's3', { status: 'Programada', due: '2026-09-01' }),          // venta que nunca facturó → no
    f('p5', 's1', { status: 'Programada', due: '2026-05-01' }),          // antes de la app → no
  ]
  const r = cuotasSinEmitir({ billing, sales, hasta: '2026-11-01' })
  assert.deepEqual(r.map(b => b.id), ['p1'])
  assert.equal(cuotasSinEmitir({ billing, sales, hasta: '2026-11-01', noEmitir: new Set(['p1']) }).length, 0)   // «No corresponde»
  // Ya cubierta: lo facturado de la venta alcanza el total acordado → la programada no se cuenta.
  const cubierta = [...billing, f('e2', 's1', { invoice_no: '402', status: 'Pagado', issued_at: '2026-08-01', amount: 2000000 })]
  assert.equal(cuotasSinEmitir({ billing: cubierta, sales, hasta: '2026-11-01' }).length, 0)
})

test('correo: la cuenta citada de nuestra propia rendición no es la cuenta del remitente', async () => {
  const { parteNuevaCorreo } = await import('../supabase/functions/_shared/xmlTexto.js')
  const cita = 'De esta rendición resulta un saldo a su cargo de $52.700, que les agradeceremos transferir a la cuenta de:\r\nEstudio Demo Limitada\r\nRUT: 76.000.000-0\r\nBanco: Banco BICE\r\nCuenta Corriente: 1.000.001'
  const outlook = `Estimada, muchas gracias, procederemos al pago.\r\nSaludos\r\n\r\nDe: Persona <p@estudio.cl>\r\nEnviado el: martes, 20 de octubre de 2026 10:31\r\nPara: X\r\nAsunto: Rendición\r\n\r\n${cita}`
  const outlook2 = `Adjunto el comprobante.\r\n________________________________\r\nDe: Persona <p@estudio.cl>\r\nEnviado: martes, 20 de octubre de 2026 10:26\r\n${cita}`
  const gmail = `Gracias.\n\nEl vie, 16 oct 2026 a la(s) 6:16 p.m., Persona (p@estudio.cl)\nescribió:\n\n> ${cita}`
  for (const t of [outlook, outlook2, gmail]) assert.ok(!parteNuevaCorreo(t).includes('Cuenta Corriente'))
  assert.equal(parteNuevaCorreo('Nuestra nueva cuenta: Cuenta Corriente 123456 Banco Itaú'), 'Nuestra nueva cuenta: Cuenta Corriente 123456 Banco Itaú')
})

test('aviso de fondos: el contador cuenta avisos enviados, no días con gastos; sin residuos ni histórico', async () => {
  const { avisoFondosAplica, contadorAvisos } = await import('../supabase/functions/_shared/fondosReglas.js')
  // Caso real: cliente sin avisos previos y muchos días con gastos → su primer aviso es el N° 1 (antes salía «Aviso N° 20»).
  assert.deepEqual(contadorAvisos([], '2026-05-01', '2026-10-25'), { n: 1, ultimo: '' })
  assert.deepEqual(contadorAvisos([{ fecha: '2026-10-01' }, { fecha: '2026-10-16' }, { fecha: '2026-04-01' }], '2026-05-01', '2026-10-25'), { n: 3, ultimo: '2026-10-16' })
  assert.equal(avisoFondosAplica(-465, [{ date: '2026-09-01' }]), false)            // residuo bajo $1.000
  assert.equal(avisoFondosAplica(-80000, [{ date: '2025-11-01' }]), false)          // solo gastos antes de la app
  assert.equal(avisoFondosAplica(-80000, [{ date: '2025-11-01' }, { date: '2026-07-01' }]), true)
})

test('cuota programada + tramo emitido: «No es doble conteo» no vuelve a aparecer', async () => {
  const { cuotaTramo } = await import('../supabase/functions/_shared/saludDatos.js')
  const sales = [{ id: 'v1', status: 'Activo', amount_clp: 3000000, cobro_type: 'cuotas' }]
  const billing = [{ sale_id: 'v1', invoice_no: '483', status: 'Pendiente', amount: 1000000 }, { sale_id: 'v1', status: 'Programada', amount: 1000000, due: '2026-09-01' }, { sale_id: 'v1', status: 'Programada', amount: 1000000, due: '2026-10-01' }, { sale_id: 'v1', status: 'Programada', amount: 1000000, due: '2026-11-01' }]
  assert.equal(cuotaTramo(billing, sales).length, 1)
  assert.equal(cuotaTramo(billing, sales, new Set(['v1'])).length, 0)
})

test('abonos por identificar: sin los ya clasificados, el histórico ni los de personas del estudio', async () => {
  const { abonosPorIdentificar } = await import('../supabase/functions/_shared/conciliacionReglas.js')
  const m = (id, extra) => ({ id, tipo: 'abono', monto: 100000, estado: 'pendiente', fecha: '2026-09-01', ...extra })
  const r = abonosPorIdentificar([m('a'), m('b', { categoria: 'Reembolso' }), m('c', { fecha: '2025-03-18' }), m('d', { rut_contraparte: '12.345.678-5' }), m('e', { cliente_id: 'x' }), m('f', { estado: 'conciliado' })], { rutsPropios: new Set(['123456785']) })
  assert.deepEqual(r.map(x => x.id), ['a'])
})

test('notaría por liquidar: solo OT con fondos del cliente o sin cliente; las demás esperan fondos', async () => {
  const { notariaPorLiquidar } = await import('../supabase/functions/_shared/notariaReglas.js')
  const ot = (id, cid, amount, date) => ({ id, client_id: cid, type: 'gasto', category: 'Notaria', ot_number: String(400000 + id), amount, date })
  const ex = [{ id: 90, client_id: 'a', type: 'fondo', amount: 100000 }, ot(1, 'a', 80000, '2026-10-01'), ot(2, 'a', 50000, '2026-10-02'), ot(3, 'b', 60000, '2026-10-01'), ot(4, null, 50000, '2025-12-01'), ot(5, 'of', 30000, '2026-10-03')]
  const r = notariaPorLiquidar(ex, { esOficina: id => id === 'of' })
  assert.deepEqual(r.pagables.map(e => e.id).sort(), [1, 5])
  assert.deepEqual(r.esperan.map(e => e.id).sort(), [2, 3])
  assert.deepEqual(r.sinCliente.map(e => e.id), [4])
})

test('rendir a clientes: el grupo depende del saldo y de los gastos por rendir, no del mes', async () => {
  const { fgCliente, gastosPorRendirCli, grupoRendir } = await import('../supabase/functions/_shared/gastosReglas.js')
  const ex = [{ client_id: 'a', type: 'fondo', amount: 500000 }, { client_id: 'a', type: 'gasto', amount: 200000 }, { client_id: 'b', type: 'gasto', amount: 300000 }, { client_id: 'b', type: 'gasto', amount: 50000, apertura_id: 'x' }]
  const g = cid => grupoRendir({ n: gastosPorRendirCli(ex, cid).length, s: fgCliente(ex, cid).saldo, armada: false })
  assert.equal(g('a'), 'favor')   // con fondos a favor: nada que pedir este mes
  assert.equal(g('b'), 'pedir')   // debe $300.000 (lo de apertura no suma)
  assert.equal(grupoRendir({ n: 1, s: -900, armada: false }), 'cero')
  assert.equal(grupoRendir({ n: 3, s: -50000, armada: true }), 'env')
})

test('factura recibida de un colaborador que calza con sus comisiones sin factura; proveedor habitual no se muestra', async () => {
  const { comprasEnPlazoReclamo, comisionesQueCalzan } = await import('../supabase/functions/_shared/saludDatos.js')
  const doc = { id: 'd1', folio: 323, tipo_dte: 34, sii_estado: 'PENDIENTE', fecha_recepcion: '2026-10-19T18:35:18Z', fecha_emision: '2026-10-19', emisor_rut: '78099865-2', proveedor_id: 'p1', monto: 4982883 }
  const t = (id, monto, extra) => ({ id, monto, proveedor_id: 'p1', rut: '78.099.865-2', factura_numero: null, ...extra })
  const terceros = [t(1, 434296), t(2, 1111800), t(3, 104231), t(4, 382662), t(5, 384038), t(6, 436400), t(7, 1047362), t(8, 1082284), t(9, 50000, { factura_numero: '300' })]
  assert.equal(comisionesQueCalzan(doc, terceros).length, 8)   // caso real: 8 comisiones, $190 de diferencia
  const r = comprasEnPlazoReclamo([doc], '2026-10-25', new Set(), { terceros, historial: [] })
  assert.equal(r[0].calce.length, 8); assert.equal(r[0].vence, '2026-10-27')
  const nes = { id: 'n4', folio: 400719, tipo_dte: 33, sii_estado: 'PENDIENTE', fecha_recepcion: '2026-10-20T15:00:00Z', fecha_emision: '2026-10-20', emisor_rut: '96.000.000-1', monto: 29013 }
  const hist = [1, 2, 3].map(i => ({ id: 'h' + i, emisor_rut: '96000000-1', fecha_emision: `2026-0${i + 6}-01`, monto: 27000 }))
  assert.equal(comprasEnPlazoReclamo([nes], '2026-10-25', new Set(), { terceros: [], historial: hist }).length, 0)
  assert.equal(comprasEnPlazoReclamo([nes], '2026-10-25', new Set(), { terceros: [], historial: hist.slice(0, 2) }).length, 1)
})

test('trabajo detenido con saldo: un pago recibido es movimiento; para «parece terminado» no', async () => {
  const { trabajosDetenidos } = await import('../supabase/functions/_shared/ventasReglas.js')
  const sales = [{ id: 's1', client_id: 'c1', status: 'Activo', amount_clp: 797000, cobro_type: 'cuotas', created_at: '2025-09-01' }]
  const billing = [{ sale_id: 's1', invoice_no: '180', status: 'Vencido', amount: 797000, paid_amount: 400000, issued_at: '2025-09-24' }]
  const sin = trabajosDetenidos({ sales, billing, hoy: '2026-10-25' })
  assert.equal(sin[0].tipo, 'con_saldo'); assert.equal(sin[0].ult, '2025-09-24')
  const con = trabajosDetenidos({ sales, billing, pagos: [{ client_id: 'c1', fecha: '2026-05-20' }], hoy: '2026-10-25' })
  assert.equal(con[0].ult, '2026-05-20'); assert.equal(con[0].dias, 158)   // caso real: 158 días, no 396
})

test('subarriendo: el pago del mes cubre solo la factura de ese mes, exacta y única', async () => {
  const { anticiposSubarriendo } = await import('../supabase/functions/_shared/saludDatos.js')
  const sales = [{ id: 's1', cobro_config: { subarriendo: true } }, { id: 's2', area: 'Asesoría' }]
  const ant = (id, mes, monto = 1080000, sale_id = 's1') => ({ id, sale_id, monto, estado: 'disponible', nota: `Subarriendo ${mes} 2026 (pago sin factura)` })
  const fac = (id, mes, extra = {}) => ({ id, sale_id: 's1', invoice_no: id, status: 'Pendiente', amount: 1080000, concept: `Subarrendamiento oficina — Mensual ${mes} 2026`, ...extra })
  const r = anticiposSubarriendo(
    [ant('a6', 'junio'), ant('a7', 'julio'), ant('a8', 'agosto', 900000), ant('a9', 'septiembre'), ant('x', 'junio', 1080000, 's2')],
    [fac('489', 'Junio'), fac('490', 'Agosto'), fac('491', 'Septiembre'), fac('492', 'Septiembre')],
    sales, [])
  const por = Object.fromEntries(r.map(x => [x.a.id, x]))
  assert.equal(por.a6.tipo, 'aplicar'); assert.equal(por.a6.b.id, '489')
  assert.equal(por.a7.tipo, 'emitir')          // julio sin factura: no se cubre otra
  assert.equal(por.a8, undefined)              // monto distinto: lo ve una persona
  assert.equal(por.a9, undefined)              // dos facturas del mes: ambiguo
  assert.equal(por.x, undefined)               // venta que no es subarriendo
  const conc = anticiposSubarriendo([ant('a6', 'junio')], [fac('489', 'Junio')], sales, [{ tipo_destino: 'factura', factura_id: '489' }])
  assert.equal(conc.length, 0)                 // ya conciliada en el banco: no se cubre dos veces
})

test('cuotas por emitir: lo recibido a cuenta del mismo trabajo, por orden de vencimiento', async () => {
  const { recibidoACuenta } = await import('../supabase/functions/_shared/ventasReglas.js')
  const sales = [{ id: 's1' }, { id: 'sub', cobro_config: { subarriendo: true } }]
  const cuotas = [{ id: 'c4', sale_id: 's1', amount: 1000000, due: '2026-10-01' }, { id: 'c3', sale_id: 's1', amount: 1220850, due: '2026-09-01' }, { id: 'm', sale_id: 'sub', amount: 1080000, due: '2026-07-01' }]
  const ants = [{ sale_id: 's1', monto: 410972, estado: 'disponible' }, { sale_id: 's1', monto: 50000, estado: 'consumido' }, { sale_id: 's2', monto: 99, estado: 'disponible' }, { sale_id: 'sub', monto: 1080000, estado: 'disponible' }]
  const r = recibidoACuenta(cuotas, ants, sales)
  assert.equal(r.get('c3'), 410972)            // la más antigua primero
  assert.equal(r.get('c4'), undefined)
  assert.equal(r.get('m'), undefined)          // subarriendo: cada pago es de su mes
  assert.equal(recibidoACuenta(cuotas, [{ sale_id: 's1', monto: 3000000, estado: 'disponible' }], sales).get('c4'), 1000000) // tope = monto de la cuota
})

test('venta del gasto: aprendido por venta o nombre, coherente, y la glosa genérica solo con su razón social', async () => {
  const { sugerirVentaGasto, glosaKey } = await import('../supabase/functions/_shared/ventaGastoReglas.js')
  const V = [{ id: 'a', title: 'Puesta en marcha Ovalle', status: 'Activo' }, { id: 'b', title: 'Administración SPV', status: 'Activo' }, { id: 'c', title: 'Reorganización', status: 'Terminado' }]
  const k = c => `cli::${glosaKey(c)}`
  const pat = 'Patente comercial Fortelio'
  // Aprendido: por id (nuevo) o por nombre (filas antiguas); dos decisiones = se aplica sola.
  let r = sugerirVentaGasto({ client_id: 'cli', concept: pat }, V, { aprendidos: [{ key: k(pat), value: 'Administración SPV' }, { key: k(pat), value: 'x', meta: { sale_id: 'b' } }] })
  assert.equal(r.regla, 'aprendido'); assert.equal(r.venta.id, 'b'); assert.equal(r.auto, true)
  // Si alguna vez fue a otro trabajo, no se sugiere por aprendido.
  r = sugerirVentaGasto({ client_id: 'cli', concept: pat }, V, { aprendidos: [{ key: k(pat), value: 'Administración SPV' }, { key: k(pat), value: 'Puesta en marcha Ovalle' }] })
  assert.notEqual(r.regla, 'aprendido')
  // Glosa genérica: sin razón social no cuenta lo aprendido; con la misma razón social, sí.
  const man = 'Gastos notariales — Mandato judicial amplio'
  const ap = [{ key: k(man), value: 'x', meta: { sale_id: 'a', entity_id: 'rs1' } }]
  assert.notEqual(sugerirVentaGasto({ client_id: 'cli', concept: man }, V, { aprendidos: ap }).regla, 'aprendido')
  assert.notEqual(sugerirVentaGasto({ client_id: 'cli', concept: man, entity_id: 'rs2' }, V, { aprendidos: ap }).regla, 'aprendido')
  assert.equal(sugerirVentaGasto({ client_id: 'cli', concept: man, entity_id: 'rs1' }, V, { aprendidos: ap }).venta.id, 'a')
  // Mismo día: el Uber del día de las escrituras va al trabajo de esas escrituras (no a otro de otra razón social).
  const her = [{ id: 'h1', client_id: 'cli', sale_id: 'a', date: '2026-07-14', entity_id: 'rs1' }, { id: 'h2', client_id: 'cli', sale_id: 'b', date: '2026-07-14', entity_id: 'rs9' }]
  r = sugerirVentaGasto({ id: 'g', client_id: 'cli', concept: 'Uber a la notaría', date: '2026-07-14', entity_id: 'rs1' }, V, { hermanos: her })
  assert.equal(r.regla, 'mismo_dia'); assert.equal(r.venta.id, 'a')
  assert.equal(sugerirVentaGasto({ id: 'g', client_id: 'cli', concept: 'Uber a la notaría', date: '2026-07-14' }, V, { hermanos: her }).regla === 'mismo_dia', false) // dos trabajos ese día: no decide
  // Sin regla por razón social: la razón social de facturación no dice de qué trabajo es el gasto.
  assert.notEqual(sugerirVentaGasto({ client_id: 'cli', concept: 'Copia', entity_id: 'rs5' }, V, { billing: [{ sale_id: 'b', entity_id: 'rs5' }] }).regla, 'rs')
})

test('revisión: gasto con razón social de otro cliente y trabajo terminado que sigue recibiendo gastos', async () => {
  const { gastoRsAjena, terminadaConGastos } = await import('../supabase/functions/_shared/saludDatos.js')
  const ents = [{ id: 'rsA', client_id: 'A' }, { id: 'rsB', client_id: 'B' }]
  const r = gastoRsAjena([{ id: 1, client_id: 'A', entity_id: 'rsA' }, { id: 2, client_id: 'A', entity_id: 'rsB' }, { id: 3, client_id: 'A', entity_id: 'rsX' }, { id: 4, client_id: 'A', entity_id: 'rsB', deleted_at: 'x' }], ents)
  assert.deepEqual(r.map(e => e.id), [2])   // razón social desconocida o gasto borrado: no es hallazgo
  const sales = [{ id: 't', status: 'Terminado' }, { id: 'a', status: 'Activo' }]
  const ex = [{ id: 1, sale_id: 't', created_at: '2026-10-20T10:00:00Z', date: '2026-10-06', amount: 5000 }, { id: 2, sale_id: 't', created_at: '2026-08-01T10:00:00Z', date: '2026-07-01', amount: 9 }, { id: 3, sale_id: 'a', created_at: '2026-10-20T10:00:00Z', date: '2026-10-20', amount: 1 },
    { id: 5, sale_id: 't', created_at: '2026-10-13T10:00:00Z', date: '2025-07-31', amount: 7 }]   // gasto antiguo reimportado hace poco: no cuenta
  const t = terminadaConGastos(sales, ex, '2026-10-25')
  assert.equal(t.length, 1); assert.deepEqual(t[0].gastos.map(e => e.id), [1]); assert.equal(t[0].ultimo, '2026-10-06')   // solo gastos de los últimos 30 días
  assert.equal(terminadaConGastos(sales, ex, '2026-10-25', { ok: { t: '2026-10-21' } }).length, 0)   // «Sigue terminado» el 21: lo anterior no vuelve
  assert.equal(terminadaConGastos(sales, ex, '2026-10-25', { ok: { t: '2026-10-19' } }).length, 1)   // lo cargado después, sí
})

test('venta del gasto: la propuesta de la revisión con IA se sugiere después de «mismo día» y solo con una venta vigente', async () => {
  const { sugerirVentaGasto } = await import('../supabase/functions/_shared/ventaGastoReglas.js')
  const V = [{ id: 'a', title: 'Puesta en marcha', status: 'Activo' }, { id: 'b', title: 'Administración', status: 'Activo' }]
  const ia = { g: { sale_id: 'b', evidencia: 'Mismo trámite que el gasto del 14-07' } }
  let r = sugerirVentaGasto({ id: 'g', client_id: 'c', concept: 'Poder especial', date: '2026-08-28' }, V, { ia })
  assert.equal(r.regla, 'ia'); assert.equal(r.venta.id, 'b'); assert.match(r.porque, /Revisión con IA/)
  r = sugerirVentaGasto({ id: 'g', client_id: 'c', concept: 'Poder especial', date: '2026-08-28' }, V, { ia, hermanos: [{ id: 'h', client_id: 'c', sale_id: 'a', date: '2026-08-28' }] })
  assert.equal(r.regla, 'mismo_dia')   // la señal de la base manda sobre la IA
  assert.notEqual(sugerirVentaGasto({ id: 'g', client_id: 'c', concept: 'Poder especial' }, V, { ia: { g: { sale_id: 'zzz' } } }).regla, 'ia')   // venta que ya no existe
})

test('datos de pago del estudio: salen de la tabla estudios (igual que la cuenta que estaba escrita en el código)', async () => {
  const { datosPago } = await import('../supabase/functions/_shared/equipo.js')
  const est = { nombre_legal: 'Estudio Demo Limitada', rut: '77.000.000-0', pago: { honorarios: { banco: 'Banco Demo', email: 'pagos@demo.cl', cuenta: '1403834' }, gastos: { banco: 'Banco Demo', cuenta: '1383922' } } }
  assert.deepEqual(datosPago(est), { razon: 'Estudio Demo Limitada', rut: '77.000.000-0', banco: 'Banco Demo', cuenta: '1403834', email: 'pagos@demo.cl' })
  assert.equal(datosPago(est, 'gastos').cuenta, '1383922')
  assert.deepEqual(datosPago(null), { razon: '', rut: '', banco: '', cuenta: '', email: '' })   // sin estudio: vacío, nunca otro estudio
})

test('notaría, regla 4: solo los trámites de tarifa fija se marcan por monto sobre 3 veces lo habitual', async () => {
  const { analisisNotaria } = await import('../supabase/functions/_shared/notariaReglas.js')
  const mk = (i, concept, amount) => ({ id: `e${i}`, type: 'gasto', category: 'Notaria', concept, amount, date: '2026-09-01', client_id: 'c1', ot_number: String(100 + i) })
  const base = [...Array(6)].map((_, i) => mk(i, 'Poder especial', 10000)).concat([...Array(6)].map((_, i) => mk(10 + i, 'Compraventa de inmueble', 50000)))
  const raras = [mk(30, 'Poder especial', 80000), mk(31, 'Compraventa de inmueble', 400000)]
  const r = analisisNotaria({ expenses: [...base, ...raras], rendiciones: [], hoy: '2026-10-28' })
  assert.deepEqual(r.fuera.map(x => x.e.id), ['e30'])   // el poder sí; la compraventa cobra según el valor y no
})

test('notaría, regla 1: el RUT de una persona del estudio nunca identifica al cliente', async () => {
  const { clienteDeLectura } = await import('../supabase/functions/_shared/notariaDocsReglas.js')
  const lec = { comparecientes: [{ nombre: 'Persona Del Estudio', rut: '15.621.320-9', calidad: 'compareciente' }], sociedades: [{ razon_social: 'Sociedad Demo SpA', rut: '76.111.222-3' }] }
  const porRut = { '156213209': 'c-abogado', '761112223': 'c-sociedad' }
  assert.equal(clienteDeLectura(lec, { porRut })?.client_id, undefined, 'sin la exclusión, dos clientes distintos por RUT no se resuelven')
  assert.equal(clienteDeLectura(lec, { porRut, rutsExcluir: new Set(['156213209']) })?.client_id, 'c-sociedad')
})
