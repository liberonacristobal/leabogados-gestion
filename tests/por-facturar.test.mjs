// Pruebas de «Por facturar» (_shared/porFacturar.js) y de la cobertura de cuotas con saldo. Sin nombres de clientes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clasificarPorFacturar, cuadreVenta, anticiposSobreCuotas, GRUPOS } from './../supabase/functions/_shared/porFacturar.js'
import { cuotaTramo } from './../supabase/functions/_shared/saludDatos.js'
import { cuotasCubiertasVenta, noEmitirDeFilas } from './../supabase/functions/_shared/ventasReglas.js'

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

test('Por facturar: cada cuota cae en una sola partida y las partidas suman el total', () => {
  const sales = [venta('A', { moneda: 'UF', amount_uf: 75, amount_clp: null }), venta('B', { amount_clp: 1000000 }), venta('C', { amount_clp: 1000000 }),
    venta('D', { amount_clp: 3000000 }), venta('E', { cobro_type: 'mensual', amount_clp: 1000000 }), venta('F', { amount_clp: 1000000 }), venta('G', { amount_clp: 1000000 }),
    venta('H', { amount_clp: 1000000 }), venta('I', { amount_clp: 1000000 })]
  const billing = [
    prog('a1', 'A', '2026-09-01', 1000000), prog('a2', 'A', '2026-10-01', 1000000), prog('a3', 'A', '2026-11-01', 1000000), fact('f1', 'A', '2026-10-02', 800000),
    prog('b1', 'B', '2026-12-01', 1000000, { status: 'Pausada' }),
    prog('c1', 'C', '2026-05-01', 1000000),                                                   // vencida hace más de 90 días y la venta no se movió
    prog('d1', 'D', '2026-06-01', 1000000), fact('f2', 'D', '2026-10-10', 1000000), prog('d2', 'D', '2027-01-01', 1000000),   // vieja, pero su venta se movió
    prog('e1', 'E', '2026-12-01', 1000000, { billing_type: 'subarriendo' }),
    prog('f1x', 'F', '2026-12-15', 1000000), prog('g1', 'G', '2027-03-01', 1000000), prog('h1', 'H', '2026-12-01', 1000000),
    prog('i1', 'I', '2026-12-01', 1000000)]
  const noEmitir = new Set(['h1'])
  const anticipos = [{ id: 'n1', sale_id: 'I', client_id: 'cI', estado: 'disponible', monto: 400000, fecha: '2026-11-01' }]
  const r = clasificarPorFacturar({ ...base, billing, sales, anticipos, noEmitir })
  const porId = {}; r.filas.forEach(f => { (porId[f.id] = porId[f.id] || []).push([f.k, Math.round(f.monto)]) })
  assert.deepEqual(porId.a1, [['cubFactura', 800000], ['saldoCuota', 200000]])
  assert.deepEqual(porId.a2, [['vencida', 1000000]])
  assert.deepEqual(porId.a3, [['mesActual', 1000000]])
  assert.deepEqual(porId.b1, [['pausada', 1000000]])
  assert.deepEqual(porId.c1, [['porConfirmar', 1000000]])
  assert.deepEqual(porId.d1, [['vencida', 1000000]])
  assert.deepEqual(porId.d2, [['masAdelante', 1000000]])
  assert.deepEqual(porId.e1, [['recurrente', 1000000]])
  assert.deepEqual(porId.f1x, [['mesSiguiente', 1000000]])
  assert.deepEqual(porId.g1, [['masAdelante', 1000000]])
  assert.deepEqual(porId.h1, [['noCorresponde', 1000000]])
  assert.deepEqual(porId.i1, [['cubAnticipo', 400000], ['mesSiguiente', 600000]])
  assert.equal(Math.round(r.total), Math.round(r.tarjeta))                                   // el total es la tarjeta, al peso
  const suma = Object.values(r.partes).reduce((a, x) => a + x.m, 0)
  assert.equal(Math.round(suma), Math.round(r.total))
  assert.equal(Math.round(r.grupos.vigente.m + r.grupos.porConfirmar.m + r.grupos.fuera.m), Math.round(r.total))
  assert.ok(GRUPOS.porConfirmar.includes('saldoCuota'))                                      // el saldo de una cuota cubierta no cuenta como vigente
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

test('cuadre de la venta: Cuadra, Tolerancia, Sobra y Falta, en UF con la UF de cada documento', () => {
  const s = venta('A', { moneda: 'UF', amount_uf: 50, amount_clp: null })
  const mk = (facturadoUF, cuotasUF) => [fact('f', 'A', '2026-10-02', facturadoUF * 40000), prog('p', 'A', '2027-01-01', cuotasUF * 40000)]
  assert.equal(cuadreVenta(s, mk(15, 35), UF)?.estado, 'Cuadra')
  assert.equal(cuadreVenta(s, mk(15, 36), UF)?.estado, 'Tolerancia')       // +1 UF = 2 %
  assert.equal(cuadreVenta(s, mk(15, 50), UF)?.estado, 'Sobra')            // facturado + cuotas superan el plan en 15 UF
  assert.equal(cuadreVenta(s, mk(15, 20), UF)?.estado, 'Falta')
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
  const sobra = (s2, bs) => cuadreVenta(s2, bs, UF)?.estado === 'Sobra'
  const filas = (cuotasUF) => [fact('f', 'A', '2026-10-02', 15 * 40000), prog('p', 'A', '2027-01-01', cuotasUF * 40000)]
  assert.equal(cuotaTramo(filas(36), [s], new Set(), sobra).length, 0)           // 51 UF de 50: 2 %, tolerancia
  assert.equal(cuotaTramo(filas(40), [s], new Set(), sobra).length, 1)           // 55 UF de 50: sobran 5 UF (10 %)
  assert.equal(cuotaTramo(filas(37.5), [s], new Set(), sobra).length, 1)         // 52,5 UF: 5 %, ya supera el 3 %; el criterio antiguo (8 %) no lo veía
  assert.equal(cuotaTramo(filas(37.5), [s]).length, 0)
  assert.equal(cuotaTramo(filas(40), [s], new Set(['A']), sobra).length, 0)       // «No es doble conteo» guardado
  assert.equal(cuotaTramo(filas(40), [s], new Set(), () => null).length, 1)       // el cuadre no aplica (sin UF): rige el criterio antiguo, no se silencia
  assert.equal(cuotaTramo(filas(37.5), [s], new Set(), () => null).length, 0)
})
