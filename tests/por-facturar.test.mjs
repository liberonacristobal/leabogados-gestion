// Pruebas de «Por facturar» (_shared/porFacturar.js) y de la cobertura de cuotas con saldo. Sin nombres de clientes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clasificarPorFacturar, cuotasVencidasSinFacturar, destinoCuotaFlujo, cuadreVenta, anticiposSobreCuotas, GRUPOS } from './../supabase/functions/_shared/porFacturar.js'
import { cuotaTramo } from './../supabase/functions/_shared/saludDatos.js'
import { cuotasCubiertasVenta, noEmitirDeFilas, cuotaDeLaApp, cuotasSinEmitir } from './../supabase/functions/_shared/ventasReglas.js'

const UF = { '2026-01-01': 40000 }                                     // UF constante: 1 UF = $40.000
const venta = (id, o = {}) => ({ id, client_id: 'c' + id, status: 'Activo', cobro_type: 'cuotas', moneda: 'CLP', amount_clp: 1000000, area: 'X', ...o })
const prog = (id, sale_id, due, amount, o = {}) => ({ id, sale_id, client_id: 'c' + sale_id, due, amount, status: 'Programada', created_at: due + 'T12:00:00Z', ...o })
const fact = (id, sale_id, issued_at, amount, o = {}) => ({ id, sale_id, client_id: 'c' + sale_id, issued_at, due: issued_at, amount, invoice_no: id, status: 'Pendiente', ...o })
const base = { anticipos: [], uf: UF, noEmitir: new Set(), hoy: '2026-11-06' }

test('cuota con 80 % o más facturado se da por cubierta y su saldo no se pierde', () => {
  const s = venta('A', { moneda: 'UF', amount_uf: 75, amount_clp: null })
  const b = [prog('a1', 'A', '2026-09-01', 1000000), prog('a2', 'A', '2026-10-01', 1000000), prog('a3', 'A', '2026-11-01', 1000000), fact('f1', 'A', '2026-10-02', 800000)]
  const c = cuotasCubiertasVenta(b, [s], UF).get('a1')
  assert.equal(c.total, true); assert.equal(Math.round(c.saldo), 200000)   // 20 de 25 UF facturadas: faltan 5 UF
  assert.equal(cuotasCubiertasVenta(b, [s], UF).has('a2'), false)
})

test('Por facturar: cuatro partidas, cada cuota en una sola, y las partidas suman el total', () => {
  const sales = [venta('A', { moneda: 'UF', amount_uf: 75, amount_clp: null }), venta('B', { amount_clp: 1000000 }), venta('C', { amount_clp: 1000000 }),
    venta('D', { amount_clp: 3000000 }), venta('E', { cobro_type: 'mensual', amount_clp: 1000000 }), venta('F', { amount_clp: 1000000 }), venta('G', { amount_clp: 1000000 }),
    venta('H', { amount_clp: 1000000 }), venta('I', { amount_clp: 1000000 })]
  const billing = [
    prog('a1', 'A', '2026-09-01', 1000000), prog('a2', 'A', '2026-10-01', 1000000), prog('a3', 'A', '2026-11-01', 1000000), fact('f1', 'A', '2026-10-02', 800000),
    prog('b1', 'B', '2026-12-01', 1000000, { status: 'Pausada' }),
    prog('c1', 'C', '2026-05-01', 1000000),                                                   // vencida hace más de 90 días y la venta no se movió
    prog('d1', 'D', '2026-07-01', 1000000), fact('f2', 'D', '2026-10-10', 1000000), prog('d2', 'D', '2027-01-01', 1000000),   // vieja, pero su venta se movió
    prog('e1', 'E', '2026-12-01', 1000000, { billing_type: 'subarriendo' }),
    prog('f1x', 'F', '2026-12-15', 1000000), prog('g1', 'G', '2027-03-01', 1000000), prog('h1', 'H', '2026-12-01', 1000000),
    prog('i1', 'I', '2026-12-01', 1000000)]
  const noEmitir = new Set(['h1'])
  const anticipos = [{ id: 'n1', sale_id: 'I', client_id: 'cI', estado: 'disponible', monto: 400000, fecha: '2026-11-01' }]
  const r = clasificarPorFacturar({ ...base, billing, sales, anticipos, noEmitir })
  const porId = {}; r.filas.forEach(f => { (porId[f.id] = porId[f.id] || []).push([f.k, f.motivo, Math.round(f.monto)]) })
  assert.deepEqual(porId.a1, [['fuera', 'cubFactura', 800000], ['porConfirmar', 'saldoCuota', 200000]])
  assert.deepEqual(porId.a2, [['vencida', null, 1000000]])
  assert.deepEqual(porId.a3, [['porVencer', null, 1000000]])                  // vence el 01-11, mes en curso: no es de un mes cerrado
  assert.deepEqual(porId.b1, [['fuera', 'pausada', 1000000]])
  assert.deepEqual(porId.c1, [['porConfirmar', 'sinMovimiento', 1000000]])
  assert.deepEqual(porId.d1, [['vencida', null, 1000000]])
  assert.deepEqual(porId.d2, [['porVencer', null, 1000000]])
  assert.deepEqual(porId.e1, [['porVencer', 'recurrente', 1000000]])           // recurrente: misma regla de fechas, solo lleva su etiqueta
  assert.deepEqual(porId.f1x, [['porVencer', null, 1000000]])
  assert.deepEqual(porId.g1, [['porVencer', null, 1000000]])
  assert.deepEqual(porId.h1, [['fuera', 'noCorresponde', 1000000]])
  assert.deepEqual(porId.i1, [['fuera', 'cubAnticipo', 400000], ['porVencer', null, 600000]])
  assert.deepEqual(Object.keys(r.partes).sort(), ['fuera', 'porConfirmar', 'porVencer', 'vencida'])   // cuatro partidas y nada más
  assert.equal(Math.round(r.total), Math.round(r.tarjeta))                                   // el total es la tarjeta, al peso
  const suma = Object.values(r.partes).reduce((a, x) => a + x.m, 0)
  assert.equal(Math.round(suma), Math.round(r.total))
  assert.equal(Math.round(r.grupos.vigente.m + r.grupos.porConfirmar.m + r.grupos.fuera.m), Math.round(r.total))
  assert.ok(r.filas.filter(f => f.motivo === 'saldoCuota').every(f => f.k === 'porConfirmar'))   // el saldo de una cuota cubierta nunca cuenta como vigente
})

test('lo dudoso queda fuera de lo vigente: por confirmar y saldo de cuota nunca suman a vigente', () => {
  const sales = [venta('C')]
  const r = clasificarPorFacturar({ ...base, sales, billing: [prog('c1', 'C', '2026-05-01', 1000000)] })
  assert.equal(r.grupos.vigente.m, 0); assert.equal(r.grupos.porConfirmar.m, 1000000)
})

test('el filtro de año limita la tarjeta al año de vencimiento, como el de Facturación', () => {
  const sales = [venta('B', { amount_clp: 2000000 })]
  const billing = [prog('b1', 'B', '2026-12-01', 1000000), prog('b2', 'B', '2027-03-01', 1000000)]
  assert.equal(clasificarPorFacturar({ ...base, sales, billing }).total, 2000000)
  assert.equal(clasificarPorFacturar({ ...base, sales, billing, anio: '2026' }).total, 1000000)
  assert.equal(clasificarPorFacturar({ ...base, sales, billing, anio: '2027' }).total, 1000000)
})

test('los reembolsos de gastos no son por facturar (Facturación los excluye)', () => {
  const sales = [venta('B', { amount_clp: 2000000 })]
  const billing = [prog('b1', 'B', '2026-12-01', 1000000), prog('b2', 'B', '2026-12-01', 1000000, { billing_type: 'reembolso' })]
  assert.equal(clasificarPorFacturar({ ...base, sales, billing }).total, 1000000)
})

test('las cuotas ya relacionadas con una factura (cruce) no son parte de Por facturar', () => {
  const sales = [venta('B')]
  const r = clasificarPorFacturar({ ...base, sales, billing: [prog('b1', 'B', '2026-12-01', 1000000)], yaFacturadas: new Set(['b1']) })
  assert.equal(r.total, 0)
})

test('cuadre de la venta: Cuadra (hasta 3 %), Exceso y Saldo, en UF con la UF de cada documento', () => {
  const s = venta('A', { moneda: 'UF', amount_uf: 50, amount_clp: null })
  const mk = (facturadoUF, cuotasUF) => [fact('f', 'A', '2026-10-02', facturadoUF * 40000), prog('p', 'A', '2027-01-01', cuotasUF * 40000)]
  assert.equal(cuadreVenta(s, mk(15, 35), UF)?.estado, 'Cuadra')
  assert.equal(cuadreVenta(s, mk(15, 36), UF)?.estado, 'Cuadra')           // +1 UF = 2 %: dentro del 3 %
  assert.equal(cuadreVenta(s, mk(15, 50), UF)?.estado, 'Exceso')           // facturado + cuotas superan el plan en 15 UF
  assert.equal(cuadreVenta(s, mk(15, 20), UF)?.estado, 'Saldo')
  assert.equal(Math.round(cuadreVenta(s, mk(15, 50), UF).diferencia), 15)
  assert.equal(cuadreVenta(venta('R', { cobro_type: 'mensual' }), [], UF), null)   // recurrente: no aplica
})

test('anticipos disponibles cubren las cuotas más antiguas, y el subarriendo solo la de su mes', () => {
  const cuotas = [prog('p1', 'S', '2026-09-01', 600000), prog('p2', 'S', '2026-10-01', 600000)]
  const r = anticiposSobreCuotas({ cuotas, anticipos: [{ estado: 'disponible', sale_id: 'S', monto: 900000, fecha: '2026-11-01' }] })
  assert.deepEqual(r.cubierto, { p1: 600000, p2: 300000 }); assert.equal(r.total, 900000)
  const sub = [prog('m1', 'M', '2026-08-01', 1000000, { billing_type: 'subarriendo' }), prog('m2', 'M', '2026-09-01', 1000000, { billing_type: 'subarriendo' })]
  const r2 = anticiposSobreCuotas({ cuotas: sub, anticipos: [{ estado: 'disponible', sale_id: 'M', monto: 1000000, fecha: '2026-09-03' }] })
  assert.deepEqual(r2.cubierto, { m2: 1000000 })                            // el pago de septiembre no cubre agosto
  assert.deepEqual(anticiposSobreCuotas({ cuotas, anticipos: [{ estado: 'consumido', sale_id: 'S', monto: 900000, fecha: '2026-11-01' }] }).cubierto, {})
})

test('«Ya facturada» (cuota_no_emitir con valor facturada:<factura>) saca la cuota igual que «No corresponde»', () => {
  const s = noEmitirDeFilas([{ kind: 'cuota_no_emitir', key: 'a', value: '1' }, { kind: 'cuota_no_emitir', key: 'b', value: 'facturada:f9' }, { kind: 'cuota_postergada', key: 'c' }])
  assert.ok(s.has('a') && s.has('b') && !s.has('c'))
  assert.ok(s.facturadas.has('b') && !s.facturadas.has('a')); assert.ok(s.postergadas.has('c'))
})

test('doble conteo cuota ↔ tramo usa el cuadre de la venta: más de 3 % en UF de cada fecha; sin el criterio rige el antiguo', () => {
  const s = venta('A', { moneda: 'UF', amount_uf: 50, amount_clp: null, uf_value: 40000 })
  const excede = (s2, bs) => cuadreVenta(s2, bs, UF)?.estado === 'Exceso'
  const filas = (cuotasUF) => [fact('f', 'A', '2026-10-02', 15 * 40000), prog('p', 'A', '2027-01-01', cuotasUF * 40000)]
  assert.equal(cuotaTramo(filas(36), [s], new Set(), excede).length, 0)           // 51 UF de 50: 2 %, tolerancia
  assert.equal(cuotaTramo(filas(40), [s], new Set(), excede).length, 1)           // 55 UF de 50: sobran 5 UF (10 %)
  assert.equal(cuotaTramo(filas(37.5), [s], new Set(), excede).length, 1)         // 52,5 UF: 5 %, ya supera el 3 %; el criterio antiguo (8 %) no lo veía
  assert.equal(cuotaTramo(filas(37.5), [s]).length, 0)
  assert.equal(cuotaTramo(filas(40), [s], new Set(['A']), excede).length, 0)       // «No es doble conteo» guardado
  assert.equal(cuotaTramo(filas(40), [s], new Set(), () => null).length, 1)       // el cuadre no aplica (sin UF): rige el criterio antiguo, no se silencia
  assert.equal(cuotaTramo(filas(37.5), [s], new Set(), () => null).length, 0)
})

test('cuota de la app: vence desde la app, o nació en ella y a tiempo; un plan generado hacia atrás es histórico', () => {
  const c = (due, created_at) => ({ due, created_at: created_at + 'T12:00:00Z' })
  assert.equal(cuotaDeLaApp(c('2026-09-01', '2026-07-06')), true)         // vence dentro de la vida de la app
  assert.equal(cuotaDeLaApp(c('2026-06-04', '2026-06-09')), true)         // venció 2 días antes del corte, pero se creó en la app a los 5 días
  assert.equal(cuotaDeLaApp(c('2025-09-01', '2026-07-06')), false)        // importada: plan de 2025 generado en julio de 2026
  assert.equal(cuotaDeLaApp(c('2025-11-01', '2026-10-17')), false)        // creada hace poco, pero hacia atrás
  assert.equal(cuotaDeLaApp(c('2026-05-01', '2026-05-10')), false)        // anterior a la app
  assert.equal(cuotaDeLaApp({ due: '', created_at: '2026-07-01' }), false); assert.equal(cuotaDeLaApp({ due: '2026-05-01' }), false)
})

test('el radar de cuotas vencidas ve la cuota creada en la app aunque venciera días antes del corte, y no ve el plan retroactivo', () => {
  const sales = [venta('A', { amount_clp: 3000000 }), venta('B', { amount_clp: 2000000 })]
  const billing = [fact('fA', 'A', '2026-08-01', 1000000), prog('a1', 'A', '2026-06-04', 1000000, { created_at: '2026-06-09T12:00:00Z' }), prog('a2', 'A', '2026-12-01', 1000000),
    fact('fB', 'B', '2026-08-01', 1000000), prog('b1', 'B', '2025-09-01', 1000000, { created_at: '2026-07-06T12:00:00Z' })]
  const ids = cuotasSinEmitir({ billing, sales, uf: UF, noEmitir: new Set(), hasta: '2026-11-01' }).map(b => b.id)
  assert.deepEqual(ids, ['a1'])
})

test('Por facturar › Vencida es exactamente el radar «Cuotas vencidas sin facturar»; lo vencido que el radar no cuenta queda por confirmar con su motivo', () => {
  const sales = [venta('A'), venta('B'), venta('C', { status: 'Terminado' })]
  const billing = [
    prog('a1', 'A', '2026-10-01', 1000000), fact('fa', 'A', '2026-10-15', 500000),                       // en el radar
    prog('b1', 'B', '2026-03-01', 700000), fact('fb', 'B', '2026-10-20', 500000),                         // histórica, anterior a la app
    prog('c1', 'C', '2026-10-01', 600000)]                                                                // venta no activa
  const r = clasificarPorFacturar({ ...base, billing, sales })
  const radar = cuotasSinEmitir({ billing, sales, anticipos: [], uf: UF, noEmitir: new Set(), hasta: '2026-11-01' }).map(b => b.id).sort()
  assert.deepEqual(r.filas.filter(f => f.k === 'vencida').map(f => f.id).sort(), radar)
  assert.deepEqual(r.filas.filter(f => f.k === 'porConfirmar').map(f => [f.id, f.motivo]).sort(), [['b1', 'anteriorApp'], ['c1', 'ventaInactiva']])
  assert.equal(r.total, r.grupos.vigente.m + r.grupos.porConfirmar.m + r.grupos.fuera.m)
})

test('Cuotas vencidas sin facturar: el radar entrega las mismas cuotas que Vencidas; la cubierta por anticipo y la sin movimiento salen', () => {
  const sales = [venta('A'), venta('B'), venta('C')]
  const billing = [
    prog('a1', 'A', '2026-10-01', 1000000), fact('fa', 'A', '2026-10-15', 500000),                       // vencida, su venta se movió
    prog('b1', 'B', '2026-10-01', 700000),                                                                // cubierta entera por un anticipo
    prog('c1', 'C', '2026-07-01', 900000)]                                                                // más de 90 días y su venta no se movió
  const anticipos = [{ id: 'n1', sale_id: 'B', client_id: 'cB', estado: 'disponible', monto: 700000, fecha: '2026-10-05' }]
  const p = { billing, sales, anticipos, uf: UF, noEmitir: new Set(), hasta: '2026-11-01', hoy: '2026-11-08' }
  assert.deepEqual(cuotasVencidasSinFacturar(p).map(b => b.id), ['a1'])
  const r = clasificarPorFacturar({ ...base, hoy: '2026-11-08', billing, sales, anticipos })
  assert.deepEqual(r.filas.filter(f => f.k === 'vencida').map(f => f.id), ['a1'])
  assert.deepEqual(r.filas.filter(f => f.id === 'c1').map(f => f.k), ['porConfirmar'])
})

test('Flujo de caja: destino de cada cuota programada sin folio (vencida del radar, por confirmar, futura, cubierta)', () => {
  const sales = [venta('A', { amount_clp: 10000000 }), venta('B', { status: 'Terminado' })]
  const billing = [prog('v1', 'A', '2026-10-01', 1000000), prog('v2', 'A', '2026-03-01', 800000), prog('f1', 'A', '2026-12-01', 600000), prog('t1', 'B', '2026-12-01', 500000), prog('a1', 'A', '2026-12-05', 400000), fact('fa', 'A', '2026-10-15', 300000)]   // la venta A ya factura
  const radar = new Set(cuotasVencidasSinFacturar({ billing, sales, anticipos: [], uf: UF, noEmitir: new Set(), hasta: '2026-11-01', hoy: '2026-11-08' }).map(b => String(b.id)))
  const cubV = cuotasCubiertasVenta(billing, sales, UF)
  const fuera = b => (b.sale_id && { A: 'Activo', B: 'Terminado' }[b.sale_id] !== 'Activo') || cubV.get(String(b.id))?.total
  const d = (id, cubierto = {}) => destinoCuotaFlujo({ b: billing.find(x => x.id === id), cubierto, cubV, fuera, radar, curYm: '2026-11' })
  assert.deepEqual([d('v1').tipo, d('v1').m], ['sinEmitir', 1000000])     // vencida del radar: fuera de la proyección
  assert.equal(d('v2').tipo, 'porConfirmar')                              // anterior a la app: el radar no la cuenta
  assert.equal(d('f1').tipo, 'proyecta')                                  // futura: entra al flujo
  assert.equal(d('t1').tipo, 'fuera')                                     // venta no activa
  assert.equal(d('a1', { a1: 400000 }).tipo, 'pagadaAnt')                  // anticipo la cubre entera
  assert.deepEqual([d('a1', { a1: 100000 }).tipo, d('a1', { a1: 100000 }).m], ['proyecta', 300000])   // cubierta en parte: lo que falta
})

test('Por facturar: una cuota marcada «Ya facturada» lleva su propio motivo y no «No corresponde»', () => {
  const sales = [venta('A', { amount_clp: 10000000 })]
  const billing = [prog('y1', 'A', '2026-12-01', 500000), prog('y2', 'A', '2026-12-15', 500000)]
  const noEmitir = noEmitirDeFilas([{ kind: 'cuota_no_emitir', key: 'y1', value: 'facturada:f9' }, { kind: 'cuota_no_emitir', key: 'y2', value: '' }])
  const r = clasificarPorFacturar({ ...base, billing, sales, noEmitir })
  assert.deepEqual(r.filas.map(f => [f.id, f.k, f.motivo]).sort(), [['y1', 'fuera', 'yaFacturada'], ['y2', 'fuera', 'noCorresponde']])
})
