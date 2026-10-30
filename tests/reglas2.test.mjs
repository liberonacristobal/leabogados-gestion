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

import { planCarga } from '../supabase/functions/_shared/cartolaDedupe.js'
test('carga de cartola: tres pagos idénticos el mismo día son tres filas, no se pierde ni se repite ninguno', () => {
  const huella = () => null
  const fila = (hash, extra = {}) => ({ hash, cuenta: 'A', tipo: 'abono', monto: 250000, fecha: '2026-10-13', n_operacion: null, ...extra })
  // la base ya tiene los 3 y el archivo trae los mismos 3 con otro hash (cargados a mano): no se inserta ninguno
  let r = planCarga([fila('x1'), fila('x2'), fila('x3')], [fila('a', { id: 1 }), fila('b', { id: 2 }), fila('c', { id: 3 })], huella)
  assert.equal(r.nuevos.length, 0)
  // la base tiene 2 y el archivo trae 3: entra solo la que falta
  r = planCarga([fila('x1'), fila('x2'), fila('x3')], [fila('a', { id: 1 }), fila('b', { id: 2 })], huella)
  assert.equal(r.nuevos.length, 1)
  // el mismo hash ya cargado nunca se vuelve a insertar
  assert.equal(planCarga([fila('a')], [fila('a', { id: 1 })], huella).nuevos.length, 0)
})
test('carga de cartola: la fila cargada a mano sin n° de operación recibe el del archivo', () => {
  const huella = () => null
  const r = planCarga([{ hash: 'n1', cuenta: 'A', tipo: 'cargo', monto: 300000, fecha: '2026-10-13', n_operacion: '555' }], [{ id: 9, hash: 'm1', cuenta: 'A', tipo: 'cargo', monto: 300000, fecha: '2026-10-13', n_operacion: null }], huella)
  assert.equal(r.nuevos.length, 0)
  assert.deepEqual(r.rellenar, [{ id: 9, n_operacion: '555' }])
})
test('carga de cartola: un código repetido con otro monto no confunde pagos distintos', () => {
  const huella = () => null
  const e = [{ id: 1, hash: 'a', cuenta: 'A', tipo: 'abono', monto: 250000, fecha: '2026-09-15', n_operacion: '4684450' }]
  const r = planCarga([{ hash: 'z', cuenta: 'A', tipo: 'abono', monto: 70000, fecha: '2026-09-15', n_operacion: '4684450' }], e, huella)
  assert.equal(r.nuevos.length, 1)
})
test('carga de cartola: mismo monto y día a otra contraparte es otro pago y entra', () => {
  const huella = () => null
  const e = [{ id: 1, hash: 'a', cuenta: 'A', tipo: 'cargo', monto: 250000, fecha: '2026-09-03', rut_contraparte: '21.138.928-1' }]
  const otro = planCarga([{ hash: 'z', cuenta: 'A', tipo: 'cargo', monto: 250000, fecha: '2026-09-03', rut_contraparte: '19.889.733-7' }], e, huella)
  assert.equal(otro.nuevos.length, 1)
  const igual = planCarga([{ hash: 'z', cuenta: 'A', tipo: 'cargo', monto: 250000, fecha: '2026-09-03', rut_contraparte: '21138928-1' }], e, huella)
  assert.equal(igual.nuevos.length, 0)
})

import { propuestaFondoRendicion } from '../supabase/functions/_shared/gastosReglas.js'
test('Banco: abono de un cliente con rendición enviada y saldo por cubrir propone acreditar el fondo', () => {
  const expenses = [{ client_id: 'c1', type: 'gasto', amount: 900000 }, { client_id: 'c1', type: 'fondo', amount: 200000 }]
  const rend = { id: 'r1', tipo: 'cliente', client_id: 'c1', sent_at: '2026-10-16T12:00:00+00:00', anulada_at: null, movimiento_id: null }
  const mov = { tipo: 'abono', cliente_id: 'c1', monto: 636812, monto_conciliado: 0, fecha: '2026-10-26', categoria: null }
  const p = propuestaFondoRendicion({ mov, expenses, rendiciones: [rend] })
  assert.equal(p.rend.id, 'r1'); assert.equal(p.porCubrir, 700000); assert.equal(p.queda, 63188)
  // sin rendición enviada antes del depósito, anulada, ya pagada, o con categoría puesta: no propone
  assert.equal(propuestaFondoRendicion({ mov: { ...mov, fecha: '2026-10-15' }, expenses, rendiciones: [rend] }), null)
  assert.equal(propuestaFondoRendicion({ mov, expenses, rendiciones: [{ ...rend, anulada_at: '2026-10-20' }] }), null)
  assert.equal(propuestaFondoRendicion({ mov, expenses, rendiciones: [{ ...rend, movimiento_id: 'm9' }] }), null)
  assert.equal(propuestaFondoRendicion({ mov: { ...mov, categoria: 'Provisión de gastos' }, expenses, rendiciones: [rend] }), null)
  // cliente sin saldo por cubrir o abono interno: no propone
  assert.equal(propuestaFondoRendicion({ mov, expenses: [{ client_id: 'c1', type: 'fondo', amount: 5000 }], rendiciones: [rend] }), null)
  assert.equal(propuestaFondoRendicion({ mov: { ...mov, es_interno: true }, expenses, rendiciones: [rend] }), null)
})

import { extraerContraparte } from '../src/cartola.js'
test('cartola: «Transferencia de X Rut … desde Banco … a Y Rut …» toma al destino en un cargo y al origen en un abono', () => {
  const g = 'Transferencia de LIBERONA ESCALA ABOGADOS LIMITADA Rut 77.700.387-9 desde Banco BICE a Martina De Los Angeles Perez Giuras Rut 21.138.928-1 a Cuenta Corriente de Banco Santander-Chile, el 2026-10-27 a las 09:33 hrs.'
  assert.deepEqual(extraerContraparte(g, 'cargo'), { nombre: 'Martina De Los Angeles Perez Giuras', rut: '21.138.928-1' })
  const a = 'Transferencia de Persona De Prueba Rut 15.621.320-9 desde Banco BICE a Liberona Escala Abogados Limitada Rut 77.700.387-9 a Cuenta Corriente de BICE, el 2026-10-19 a las 10:00 hrs.'
  assert.deepEqual(extraerContraparte(a, 'abono'), { nombre: 'Persona De Prueba', rut: '15.621.320-9' })
  const i = 'Transferencia de CLIENTE Rut 77.700.387-9 desde Banco BICE a BENEFICIARIO Rut 77.700.387-9 a Cuenta Corriente de BICE, el 2026-09-09 a las 18:48:00.'
  assert.deepEqual(extraerContraparte(i, 'cargo'), { nombre: null, rut: null })
})

import { vigilarEscrituras } from '../src/vigilanteEscrituras.js'
test('escrituras rechazadas por la base se avisan; lecturas, éxitos y el propio registro de errores no', async () => {
  const avisos = []
  const f = (status) => vigilarEscrituras(() => a => avisos.push(a), async () => new Response('{"message":"rechazado"}', { status }))
  await f(403)('https://x.supabase.co/rest/v1/billing?id=eq.1', { method: 'PATCH' })
  await new Promise(r => setTimeout(r, 5))
  assert.equal(avisos.length, 1); assert.equal(avisos[0].tabla, 'billing'); assert.equal(avisos[0].status, 403)
  await f(403)('https://x.supabase.co/rest/v1/billing?id=eq.1', { method: 'GET' })         // lectura: no
  await f(200)('https://x.supabase.co/rest/v1/billing', { method: 'POST' })                 // éxito: no
  await f(409)('https://x.supabase.co/rest/v1/app_errores', { method: 'POST' })             // el propio registro: no (evita bucle)
  await f(404)('https://x.supabase.co/functions/v1/push', { method: 'POST' })               // función con 404: no; solo 5xx
  await new Promise(r => setTimeout(r, 5))
  assert.equal(avisos.length, 1)
  await f(500)('https://x.supabase.co/functions/v1/push', { method: 'POST' })
  await new Promise(r => setTimeout(r, 5))
  assert.equal(avisos.length, 2)
})

import { glosaConflict } from '../supabase/functions/_shared/saludDatos.js'
test('glosa en conflicto: cada aprendizaje vale por sus usos (hits), no por filas; retiros y sueldos del mismo destinatario no son conflicto', () => {
  const r = glosaConflict([{ key: 'k1', value: 'Arriendo', hits: 5 }, { key: 'k1', value: 'Servicios', hits: 4 }, { key: 'k0', value: 'Arriendo', hits: 20 }, { key: 'k0', value: 'Servicios', hits: 2 }, { key: 'k2', value: 'Retiros', hits: 3 }, { key: 'k2', value: 'Sueldos', hits: 3 }])
  assert.equal(r.length, 1); assert.equal(r[0].key, 'k1'); assert.deepEqual(r[0].votos[0], { cat: 'Arriendo', n: 5 })   // k0 tiene mayoría clara (91%): no pregunta
})

import { votoGlosa } from '../supabase/functions/_shared/saludDatos.js'
test('glosa: una clasificación antigua ya corregida no genera conflicto; solo el empate reciente pregunta', () => {
  const hoy = Date.parse('2026-10-28'), dia = 86400000, f = d => new Date(hoy - d * dia).toISOString()
  // antes Arriendo (10 usos, hace 200 días); desde entonces Servicios (3 usos recientes) → gana lo vigente, sin preguntar
  const a = votoGlosa([{ key: 'k', value: 'Arriendo', hits: 10, updated_at: f(200) }, { key: 'k', value: 'Servicios', hits: 3, updated_at: f(10) }], hoy)
  assert.equal(a.k.category, 'Servicios'); assert.equal(a.k.ambiguo, false)
  // empate real en los últimos 90 días: pregunta
  const b = votoGlosa([{ key: 'k', value: 'Arriendo', hits: 4, updated_at: f(20) }, { key: 'k', value: 'Servicios', hits: 4, updated_at: f(5) }], hoy)
  assert.equal(b.k.ambiguo, true)
  // sin uso reciente se vota con todo el historial
  const c = votoGlosa([{ key: 'k', value: 'Arriendo', hits: 9, updated_at: f(300) }, { key: 'k', value: 'Servicios', hits: 1, updated_at: f(200) }], hoy)
  assert.equal(c.k.category, 'Arriendo'); assert.equal(c.k.ambiguo, false)
})

import { crearConsultas, resolverConIA, HERRAMIENTAS } from '../supabase/functions/_shared/consultasCopiloto.js'
import { fgCliente as _fgC, gastosPorRendirCli as _gpr } from '../supabase/functions/_shared/gastosReglas.js'
const _saldoB = b => (['Pagado', 'Anulada'].includes(b.status) ? 0 : Math.max(0, (b.amount || 0) - (b.paid_amount || 0)))
const _porCobrarB = bs => bs.filter(b => b.invoice_no && ['Pendiente', 'Vencido'].includes(b.status) && !['reembolso', 'nota_credito'].includes(b.billing_type)).reduce((s, b) => s + _saldoB(b), 0)
const _datosCopiloto = () => ({
  clients: [{ id: 'c1', name: 'Familia Schroder' }, { id: 'c2', name: 'Comercial Andes SpA' }, { id: 'c3', name: 'Comercial Norte SpA' }, { id: 'o', name: 'Estudio (oficina)', is_internal: true }],
  billing: [
    { id: 'b1', client_id: 'c1', invoice_no: '10', status: 'Pagado', amount: 250000, issued_at: '2026-10-16' },
    { id: 'b2', client_id: 'c2', invoice_no: '20', status: 'Vencido', amount: 1000000, paid_amount: 200000, issued_at: '2026-08-01', due: '2026-09-01' },
    { id: 'b3', client_id: 'c2', invoice_no: '21', status: 'Pendiente', amount: 500000, issued_at: '2026-10-01', due: '2026-12-01' },
  ],
  expenses: [{ client_id: 'c1', type: 'fondo', amount: 1367288 }, { client_id: 'c1', type: 'gasto', amount: 2004100, client_rendered_at: '2026-10-16' }, { client_id: 'c1', type: 'gasto', amount: 40000 }],
  tasks: [{ id: 't1', title: 'A', due: '2026-10-01', status: 'Activo', assignees: ['Martina'] }, { id: 't2', title: 'B', due: '2026-12-01', status: 'Activo', assignees: ['Martina'] }, { id: 't3', title: 'C', due: '2026-10-10', status: 'Terminado', assignees: ['Martín'] }],
  hoy: '2026-10-28', fgCliente: _fgC, gastosPorRendirCli: _gpr, saldoBill: _saldoB, esVencidaB: b => b.status === 'Vencido', porCobrarBills: _porCobrarB, folioN: x => String(x),
})
test('Counsel AI: deuda de un cliente = facturas por cobrar + gastos por cubrir, con las funciones de la app', async () => {
  const ej = crearConsultas(_datosCopiloto())
  const r = await ej('deuda_cliente', { cliente: 'Schröder' })       // sin tilde ni «Familia»: igual lo encuentra
  assert.equal(r.resumen.cliente, 'Familia Schroder'); assert.equal(r.resumen.deuda_total, '$676.812')
  assert.equal(r.resumen.facturas_por_cobrar, '$0'); assert.equal(r.resumen.gastos_por_cubrir, '$676.812'); assert.equal(r.resumen.gastos_sin_rendir, '$40.000')
  assert.equal(r.tarjeta.total.valor, '$676.812'); assert.equal(r.tarjeta.lineas.length, 3)
  assert.match((await ej('deuda_cliente', { cliente: 'Comercial' })).error, /2 clientes/)   // ambiguo: pide precisar, no adivina
  assert.match((await ej('deuda_cliente', { cliente: 'Inexistente' })).error, /No encontré/)
  assert.match((await ej('otra_cosa', {})).error, /no existe/)
})
test('Counsel AI: por cobrar total suma las partes y lista los mayores', async () => {
  const r = await crearConsultas(_datosCopiloto())('por_cobrar', { top: 3 })
  assert.equal(r.resumen.por_cobrar_total, '$1.300.000'); assert.equal(r.resumen.vencido, '$800.000')   // 800.000 + 500.000; vencido = el saldo de la vencida
  assert.equal(r.resumen.mayores[0].cliente, 'Comercial Andes SpA'); assert.equal(r.tarjeta.total.valor, '$1.300.000')
})
test('Counsel AI: tareas vencidas por responsable, sin las terminadas ni las de plazo futuro', async () => {
  const r = await crearConsultas(_datosCopiloto())('tareas_vencidas', {})
  assert.equal(r.resumen.tareas_vencidas, 1); assert.deepEqual(r.resumen.por_responsable, [{ responsable: 'Martina', tareas: 1 }])
})
test('Counsel AI: el bucle resuelve la consulta que pide la IA y devuelve la tarjeta; sin consulta responde directo', async () => {
  const ej = crearConsultas(_datosCopiloto()); let n = 0
  const llamar = async ({ messages, tools }) => { n++; assert.equal(tools.length, HERRAMIENTAS.length)
    if (n === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'u1', name: 'deuda_cliente', input: { cliente: 'Schroder' } }] }
    const ultimo = messages[messages.length - 1].content[0]; assert.equal(ultimo.type, 'tool_result'); assert.match(ultimo.content, /676\.812/)
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Debe $676.812.' }] } }
  const r = await resolverConIA({ llamar, sistema: 's', mensajes: [{ role: 'user', content: '¿cuánto debe?' }], ejecutar: ej })
  assert.equal(r.texto, 'Debe $676.812.'); assert.equal(r.tarjetas.length, 1); assert.equal(n, 2)
  const directo = await resolverConIA({ llamar: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'No tengo esa consulta.' }] }), sistema: 's', mensajes: [], ejecutar: ej })
  assert.equal(directo.tarjetas.length, 0); assert.equal(directo.texto, 'No tengo esa consulta.')
  const bucle = await resolverConIA({ llamar: async () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'x', name: 'tareas_vencidas', input: {} }] }), sistema: 's', mensajes: [], ejecutar: ej, maxVueltas: 2 })
  assert.equal(bucle.agotado, true)   // la IA no puede quedarse pidiendo consultas para siempre
})

import { coberturaVenta as _cobV, cuotasSinEmitir as _cse, trabajosSinFacturar as _tsf } from '../supabase/functions/_shared/ventasReglas.js'
const _datosVentas = () => {
  const d = _datosCopiloto()
  d.sales = [{ id: 's1', client_id: 'c2', title: 'Constitución de sociedad', status: 'Activo', moneda: 'CLP', amount_clp: 1500000, created_at: '2026-06-10' }, { id: 's2', client_id: 'c2', title: 'Propuesta antigua', status: 'Rechazado', moneda: 'CLP', amount_clp: 400000, created_at: '2026-01-10' }]
  d.billing = [...d.billing, { id: 'b4', client_id: 'c2', sale_id: 's1', invoice_no: '30', status: 'Pagado', amount: 1000000, issued_at: '2026-07-01' }, { id: 'b5', client_id: 'c2', sale_id: 's1', status: 'Programada', amount: 500000, due: '2026-08-15', concept: 'Cuota 2' }]
  d.clientEntities = [{ client_id: 'c2', name: 'Comercial Andes SpA', rut: '76.000.000-1' }]
  d.proyectos = [{ cliente_id: 'c2', nombre_proyecto: 'Constitución', estado: 'En curso', responsable: 'CL', activo: true }]
  d.coberturaVenta = _cobV; d.uf = {}
  d.cargarContactos = async id => id === 'c2' ? [{ nombre: 'Ana Pérez', cargo: 'Gerente', email: 'ana@example.com', telefono: '+56 9 1111 1111', principal: true }] : []
  d.calcCuotasSinEmitir = async () => _cse({ billing: d.billing, sales: d.sales, uf: {}, noEmitir: new Set(), hasta: '2026-10-01' })
  d.calcTrabajosSinFacturar = async () => _tsf({ sales: d.sales, billing: d.billing, uf: {}, ufHoy: 0, hoy: '2026-10-28', noEmitir: new Set(), decididos: new Set() })
  d.detenidos = [{ s: d.sales[0], tipo: 'con_saldo', dias: 120, porCobrar: 300000 }]
  return d
}
test('Counsel AI: dónde está algo, ficha y ventas de un cliente', async () => {
  const ej = crearConsultas(_datosVentas())
  const d = await ej('donde_esta', { tema: '¿Dónde cargo una cartola?' })
  assert.equal(d.tarjeta.lineas[0].sub, 'Banco › Cargar cartola'); assert.equal(d.tarjeta.lineas[0].destino.tab, 'conciliacion')
  assert.equal((await ej('donde_esta', { tema: 'astrología' })).resumen.encontrado, false)   // no inventa pantallas
  const f = await ej('ficha_cliente', { cliente: 'Andes' })
  assert.equal(f.resumen.contactos[0].nombre, 'Ana Pérez'); assert.equal(f.resumen.ventas_activas, 1); assert.equal(f.resumen.proyectos_activos[0].nombre, 'Constitución'); assert.equal(f.resumen.razones_sociales[0].rut, '76.000.000-1')
  const v = await ej('ventas_cliente', { cliente: 'Andes' })
  assert.equal(v.resumen.ventas[0].monto_acordado, '$1.500.000'); assert.equal(v.resumen.ventas[0].facturado, '$1.000.000'); assert.equal(v.resumen.ventas[0].por_facturar, '$500.000')
})
test('Counsel AI: por facturar y trabajos detenidos usan las reglas de ventas', async () => {
  const ej = crearConsultas(_datosVentas())
  const p = await ej('por_facturar', {})
  assert.equal(p.resumen.cuotas_sin_emitir, 1); assert.equal(p.resumen.monto_cuotas_sin_emitir, '$500.000')
  const t = await ej('trabajos_detenidos', {})
  assert.equal(t.resumen.con_saldo, 1); assert.equal(t.resumen.mayores[0].por_cobrar, '$300.000')
})

test('Counsel AI: el resultado del año es el que publica Inicio, con su plano; sin cálculo no inventa', async () => {
  const secs = [{ t: 'Ventas', pct: 97, uf: 'UF 17.481', clp: '$700.000.000', lines: [['Meta del año', 'UF 18.000', '$720.000.000']] }, { t: 'Cobrado propio', uf: 'UF 8.072', clp: '$330.000.000', lines: [] }]
  const ej = crearConsultas({ ..._datosCopiloto(), leerResultado: () => ({ anio: 2026, secs, at: Date.parse('2026-10-29T15:00:00Z') }) })
  const r = await ej('resultado_anio', {})
  assert.equal(r.resumen.anio, 2026); assert.equal(r.resumen.secciones[0].uf, 'UF 17.481'); assert.equal(r.resumen.secciones[0].avance, '97%')
  assert.match(r.resumen.plano, /depósitos conciliados por fecha del depósito/); assert.equal(r.tarjeta.lineas[1].valor, 'UF 8.072 · $330.000.000')
  assert.match((await crearConsultas({ ..._datosCopiloto(), leerResultado: () => null })('resultado_anio', {})).error, /Abre Inicio/)
})

import { analisisNotaria as _an, notariaPorLiquidar as _npl } from '../supabase/functions/_shared/notariaReglas.js'
test('Counsel AI: notaría pendiente, obligaciones, calendario de cliente y causas', async () => {
  const d = _datosCopiloto()
  d.expenses = [{ client_id: 'c1', type: 'fondo', amount: 500000 }, { client_id: 'c1', type: 'gasto', category: 'Notaria', ot_number: '100', amount: 200000, date: '2026-10-10' },
    { client_id: 'c2', type: 'gasto', category: 'Notaria', ot_number: '101', amount: 100000, date: '2026-10-11' }, { client_id: null, type: 'gasto', category: 'Notaria', ot_number: '102', amount: 50000, date: '2026-10-12' }]
  d.analisisNotaria = _an; d.notariaPorLiquidar = _npl; d.rendiciones = []
  d.cal = { alertas: [{ sev: 0, t: 'F29 de septiembre sin pago registrado · venció el 20-10-2026', fecha: '2026-10-20' }], vencimientos: [{ fecha: '2026-11-20', t: 'F29 de octubre', s: '' }, { fecha: '2026-10-01', t: 'Pasado', s: '' }] }
  d.calendarioDeCliente = async id => ({ items: id === 'c2' ? [{ fecha: '2026-11-05', t: 'Vista en tabla · Rol 19-2025', s: 'C.A. de La Serena', vencido: false }] : [], seguimiento: 2, noRev: 0, oblTxt: 'F29' })
  d.causasActivas = async id => [{ client_id: 'c2', caratula: 'DÍAZ / SII', rol: '19', anio: 2025, corte_nombre: 'Corte de Apelaciones de La Serena', abogado: 'Cristóbal', estado: 'activa', ultima_revision_at: '2026-10-28', ultima_tabla: null }].filter(x => !id || x.client_id === id)
  d.estadoCausa = () => ['Sin tabla']
  const ej = crearConsultas(d)
  const n = await ej('notaria_pendiente', {})
  assert.equal(n.resumen.ot_por_pagar, 3); assert.equal(n.resumen.monto_por_pagar, '$350.000')
  assert.equal(n.resumen.se_pueden_pagar_ahora.monto, '$200.000'); assert.equal(n.resumen.esperan_fondos_del_cliente.monto, '$100.000'); assert.equal(n.resumen.sin_cliente.monto, '$50.000')
  const o = await ej('obligaciones_estudio', {})
  assert.equal(o.resumen.alertas[0].urgencia, 'vencida'); assert.deepEqual(o.resumen.proximos_vencimientos.map(x => x.que), ['F29 de octubre'])   // el vencimiento pasado no es «próximo»
  assert.equal((await crearConsultas({ ...d, cal: null })('obligaciones_estudio', {})).error.includes('todavía no carga'), true)
  const c = await ej('calendario_cliente', { cliente: 'Andes' })
  assert.equal(c.resumen.proximos_60_dias[0].que, 'Vista en tabla · Rol 19-2025'); assert.equal(c.resumen.proximos_60_dias[0].fecha, '05-11-2026')
  const ca = await ej('causas', { cliente: 'Andes' })
  assert.equal(ca.resumen.causas[0].rol, '19-2025'); assert.equal(ca.resumen.causas[0].estado, 'Sin tabla'); assert.equal(ca.tarjeta.lineas[0].valor, 'Sin tabla')
  assert.equal((await ej('causas', {})).resumen.causas_activas, 1)
})

import { comprasEnPlazoReclamo as _cpr, comprasObservadasSII as _cpo } from '../supabase/functions/_shared/saludDatos.js'
test('Counsel AI: compras del SII (plazo de reclamo y observadas) y estado del F29', async () => {
  const d = _datosCopiloto()
  const docs = [
    { id: 'd1', folio: 501, tipo_dte: 33, emisor_name: 'Proveedor Uno', emisor_rut: '76.111.111-1', proveedor_id: 'p1', fecha_emision: '2026-10-20', monto: 119000, sii_estado: 'PENDIENTE', fecha_recepcion: '2026-10-26T12:00:00Z', periodo: '2026-10' },
    { id: 'd2', folio: 77, tipo_dte: 33, emisor_name: 'Proveedor Dos', emisor_rut: '76.222.222-2', proveedor_id: null, fecha_emision: '2026-09-02', monto: 50000, sii_estado: 'ACEPTADO', periodo: '2026-09', observado_sii: true }]
  d.cargarComprasSII = async () => ({ docs, vistasReclamo: new Set(), vistasObservadas: new Set() }); d.comprasEnPlazoReclamo = _cpr; d.comprasObservadasSII = _cpo
  d.cal = { ciclos: [{ per: '2026-09', f29: { vence: '2026-10-20', pago: { fecha: '2026-10-19', monto: 1121390 } }, v: { ppm: 1121390 } }, { per: '2026-10', f29: { vence: '2026-11-20', pago: null }, v: null }],
    proximos: [{ t: 'F29 · IVA/PPM', monto: 900000, est: 'cerrado', vence: '2026-11-20', f29: { total: 900000, ppm: 600000, ret: 100000, iu: 200000 } }] }
  const ej = crearConsultas(d)
  const c = await ej('compras_sii', {})
  assert.equal(c.resumen.recibidos_este_mes.documentos, 1); assert.equal(c.resumen.en_plazo_de_reclamo, 1); assert.equal(c.resumen.reclamo[0].folio, 501); assert.equal(c.resumen.observados_por_el_sii, 1); assert.equal(c.resumen.sin_proveedor_registrado_este_anio, 1)
  const f = await ej('f29', {})
  assert.equal(f.resumen.proximo.estado, 'estimado del mes cerrado'); assert.equal(f.resumen.proximo.monto, '$900.000'); assert.equal(f.resumen.ultimos_periodos[0].pagado.monto, '$1.121.390'); assert.match(f.resumen.nota, /no tiene el F29 presentado/)
})

import { crearCalendario, ymMas as _ymM, djFecha as _djF, CAL_CL as _CALCL } from '../supabase/functions/_shared/calendarioReglas.js'
test('calendario: F29 el 20 y cotizaciones el 13 del mes siguiente, al día hábil siguiente si cae en fin de semana o feriado', () => {
  const c = crearCalendario(new Set(['2026-11-20']))   // feriado inventado para probar el corrimiento
  assert.equal(crearCalendario().venceCalTrib('F29', '2026-10'), '2026-11-20')   // viernes
  assert.equal(c.venceCalTrib('F29', '2026-10'), '2026-11-23')                    // feriado → lunes
  assert.equal(crearCalendario().venceCalTrib('COT', '2026-10'), '2026-11-13')
  assert.equal(crearCalendario().habilDesde('2026-11-28'), '2026-11-30')          // sábado → lunes
  assert.equal(_ymM('2026-12', 1), '2027-01')
  const dj = [{ formulario: '1948', fecha: '2027-03-16', detalle: 'Sociedades de personas' }, { formulario: '1948', fecha: '2027-03-23', detalle: 'Sociedades anónimas' }]
  assert.equal(_djF({ formulario: '1948', detalle: 'DJ 1948 · retiros de socios, sociedades de personas' }, dj).fecha, '2027-03-16')
  assert.equal(_CALCL.F29.dia, 20)
})

import { armarEventos as _armarEv } from '../supabase/functions/_shared/calendarioEventos.js'
test('calendario de Google: tributario, causas en tabla, plazos, contribuciones y Diario Oficial, sin lo vencido ni lo ya presentado', () => {
  const ev = _armarEv({ hoy: '2026-10-29', obl: [{ tipo: 'F29', activo: true }, { tipo: 'COT', activo: true }, { tipo: 'F22', activo: true }, { tipo: 'DJ', formulario: '1948', detalle: 'retiros de socios sociedades de personas', activo: true }],
    dj: [{ anio_tributario: 2027, formulario: '1948', fecha: '2027-03-16', detalle: 'Sociedades de personas' }], cumplidas: [{ clave: 'F22-2026' }],
    causas: [{ id: 'c1', estado: 'activa', rol: '19', anio: 2025, caratula: 'DÍAZ / SII', corte_nombre: 'Corte de Apelaciones de La Serena', client_id: 'k1', abogado: 'Cristóbal', ultima_tabla: { fecha: '2026-11-30', sala: 'Primera Sala', numero: 12 } }, { id: 'c2', estado: 'activa', rol: '18', anio: 2025, ultima_tabla: { fecha: '2026-10-01' } }],
    plazos: [{ id: 'p1', titulo: 'Término del arriendo', fecha: '2026-12-15', estado: 'pendiente', client_id: 'k1' }, { id: 'p2', titulo: 'Hecho', fecha: '2026-12-16', estado: 'cumplido' }],
    props: [{ client_id: 'k1', rol: '1-2', deuda_contribuciones: 0 }, { client_id: 'k1', rol: '1-3', deuda_contribuciones: 5000 }], clientes: [{ id: 'k1', name: 'Javiera Díaz' }],
    docs: [{ id: 'd1', cliente_id: 'k1', do_estado: 'pendiente', do_publicacion: { vence: '2026-11-10' } }] })
  const por = t => ev.filter(e => e.tipo === t)
  assert.ok(por('tributario').some(e => e.clave === 'F29-2026-10' && e.fecha === '2026-11-20')); assert.ok(por('tributario').some(e => e.clave === 'COT-2026-10' && e.fecha === '2026-11-13'))
  assert.ok(!por('tributario').some(e => e.clave === 'F22-2026')); assert.ok(por('tributario').some(e => e.clave === 'F22-2027'))   // la ya presentada no entra
  assert.ok(por('tributario').some(e => /Declaraciones juradas 1948/.test(e.titulo) && e.fecha === '2027-03-16'))
  assert.deepEqual(por('causa').map(e => e.titulo), ['Vista en tabla · Rol 19-2025'])   // la de octubre ya pasó
  assert.match(por('causa')[0].descripcion, /Cliente: Javiera Díaz/)
  assert.deepEqual(por('plazo').map(e => e.fecha), ['2026-12-15']); assert.deepEqual(por('diario_oficial').map(e => e.fecha), ['2026-11-10'])
  assert.ok(por('contribuciones').some(e => e.fecha === '2026-11-30' && /2 roles de 1 clientes/.test(e.descripcion)))
  assert.ok(ev.every(e => e.fecha >= '2026-10-29'))
})

import { CALENDARIOS, eventosDeCalendario, destinatariosCalendario } from '../supabase/functions/_shared/calendarioEventos.js'
test('calendarios: tributario solo a socios, lo de clientes a todo el equipo; otro dominio nunca entra', () => {
  const ms = [{ email: 'Socio@estudio.cl', es_socio: true }, { email: 'abogado@estudio.cl', es_socio: false }, { email: 'socio@gmail.com', es_socio: true }, { email: 'socio@estudio.cl', es_socio: true }, { email: '', es_socio: true }]
  assert.deepEqual(destinatariosCalendario(ms, 'estudio.cl', 'socios'), ['socio@estudio.cl'])
  assert.deepEqual(destinatariosCalendario(ms, '@estudio.cl', 'equipo'), ['socio@estudio.cl', 'abogado@estudio.cl'])
  assert.deepEqual(destinatariosCalendario(ms, '', 'equipo'), [])
  const ev = [{ tipo: 'tributario' }, { tipo: 'causa' }, { tipo: 'plazo' }, { tipo: 'contribuciones' }, { tipo: 'diario_oficial' }]
  const [est, cli] = CALENDARIOS
  assert.equal(eventosDeCalendario(ev, est).length, 1)
  assert.equal(eventosDeCalendario(ev, cli).length, 4)
  assert.equal(eventosDeCalendario(ev, est).length + eventosDeCalendario(ev, cli).length, ev.length)   // todo evento cae en un calendario y solo en uno
})
