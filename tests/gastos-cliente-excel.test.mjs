import test from 'node:test'
import assert from 'node:assert/strict'
import { hojasGastosCliente, cartolaCliente, pagoDeGasto, descuentaSaldo, fechaExcel } from '../supabase/functions/_shared/gastosClienteExcel.js'
import { fgCliente, rendicionDeGasto } from '../supabase/functions/_shared/gastosReglas.js'

const cli = { id: 'c1', name: 'Cliente de prueba' }
const g = (id, amount, extra = {}) => ({ id, client_id: 'c1', type: 'gasto', amount, date: '2026-09-01', created_at: `2026-09-0${id}T12:00:00Z`, concept: `Glosa ${id}`, category: 'Notaria', ...extra })
const exps = [
  { id: 'f1', client_id: 'c1', type: 'fondo', amount: 1000000, date: '2026-08-01', concept: 'Provisión' },
  g(1, 400000, { ot_number: '490673', concept: 'Gastos notariales — Cesion de derechos', description: 'Detalle largo sin resumir', materia: 'Cesión', requirente: 'Persona X', notas: 'ojo', notaria_liquidado_at: '2026-09-20T15:00:00Z' }),
  g(2, 50000, { category: 'CBR', rendered_at: '2026-09-25T10:00:00Z' }),
  g(3, 30000, { category: 'Diario Oficial' }),
  g(4, 10000, { no_descuenta_saldo: true }),
  g(5, 99000, { deleted_at: '2026-09-02' }),
  { ...g(6, 7000), client_id: 'otro' },
]
const celda = c => (c && c.v !== undefined ? c.v : c)

test('Excel de gastos: una fila por gasto con OT y glosas completas; no entran borrados ni de otro cliente', () => {
  const h = hojasGastosCliente({ cliente: cli, expenses: exps, pagadoPor: e => e.category === 'Notaria' ? 'Notaría' : 'Oficina' })
  assert.equal(h.gastos.length, 1 + 4 + 1)                         // encabezado + 4 gastos + Total
  const enc = h.gastos[0], f = h.gastos[1]
  assert.equal(f[enc.indexOf('OT')], '490673')
  assert.equal(f[enc.indexOf('Concepto')], 'Gastos notariales — Cesion de derechos')
  assert.equal(f[enc.indexOf('Descripción')], 'Detalle largo sin resumir')
  assert.equal(f[enc.indexOf('Materia')], 'Cesión'); assert.equal(f[enc.indexOf('Requirente')], 'Persona X'); assert.equal(f[enc.indexOf('Nota')], 'ojo')
})

test('Excel de gastos: estado y fecha de pago salen de la liquidación o de la rendición; sin ellas, Sin pago', () => {
  const h = hojasGastosCliente({ cliente: cli, expenses: exps }), enc = h.gastos[0]
  const est = h.gastos.slice(1, 5).map(r => [r[enc.indexOf('Estado de pago')], r[enc.indexOf('Medio de pago')], r[enc.indexOf('Fecha de pago')]?.v ?? ''])
  assert.deepEqual(est[0], ['Pagado', 'Liquidación a la notaría', fechaExcel('2026-09-20')])
  assert.deepEqual(est[1], ['Pagado', 'Rendición de caja chica', fechaExcel('2026-09-25')])
  assert.deepEqual(est[2], ['Sin pago', '', ''])
  assert.deepEqual(pagoDeGasto({}), { pagado: false, fecha: null, medio: '' })
  assert.equal(descuentaSaldo({ no_descuenta_saldo: true }), 'No, saldado fuera de la app')
})

test('Cartola: los tres saldos cuadran con fgCliente y un pago no mueve el saldo del cliente', () => {
  const vivos = exps.filter(e => !e.deleted_at), fg = fgCliente(vivos, 'c1')
  const c = cartolaCliente({ expenses: exps, clientId: 'c1' })
  assert.equal(c.saldo, fg.saldo); assert.equal(c.saldo, c.caja - c.por)
  assert.equal(c.caja, 1000000 - 450000)                         // fondos − lo pagado (400.000 liquidado + 50.000 rendido)
  assert.equal(c.por, 480000 - 450000)                           // incurrido (sin el saldado fuera de la app) − pagado
  const pagos = c.eventos.filter(e => e.k === 'Pago')
  assert.deepEqual(pagos.map(e => e.cargo), [400000, 50000])
  pagos.forEach(p => { const i = c.eventos.indexOf(p); assert.equal(p.cli, c.eventos[i - 1].cli) })   // el saldo del cliente no cambia al pagar
  assert.match(pagos[0].det, /Liquidación a la notaría · 1 OT/); assert.equal(pagos[0].ots, '490673')
})

test('Cartola: orden cronológico (gasto, fondo, pago el mismo día) y el Excel repite la misma cartola', () => {
  const h = hojasGastosCliente({ cliente: cli, expenses: exps }), fin = h.cartola[h.cartola.length - 1]
  const c = cartolaCliente({ expenses: exps, clientId: 'c1' })
  assert.equal(celda(fin[8]), c.saldo); assert.equal(h.cartola.length, 1 + c.eventos.length + 1)
  const fechas = c.eventos.map(e => e.f); assert.deepEqual(fechas, [...fechas].sort())
})

test('Excel de pagos y fondos: lo sin pago primero, cada pago con su subtotal, y los sin fondo aparte', () => {
  const h = hojasGastosCliente({ cliente: cli, expenses: exps, pagadoPor: e => e.category === 'Notaria' ? 'Notaría' : 'Oficina' })
  const etiquetas = h.pagos.slice(1).map(r => celda(r[0])).filter(x => /^Total/.test(x))
  assert.equal(etiquetas.at(-1), 'Total gastos cargados')
  assert.equal(h.totales.gastos, 490000)
  const total = h.pagos.find(r => celda(r[0]) === 'Total gastos cargados'); assert.equal(celda(total[9]), 490000)
  assert.equal(h.pagos[1][0], 'Sin pago')                        // lo sin pago va primero
  const sinFondo = h.fondos.filter(r => celda(r[0]) === 'Sin fondo, a pedir al cliente'); assert.equal(sinFondo.length, 0)   // el fondo de 1.000.000 alcanza
})

test('Fondos: lo que ningún fondo alcanza queda «Sin fondo, a pedir al cliente»', () => {
  const corto = [{ id: 'f1', client_id: 'c1', type: 'fondo', amount: 100000, date: '2026-08-01', concept: 'Provisión' }, g(1, 100000), g(2, 60000, { ot_number: '502219' })]   // el fondo se agota con el primero: un gasto cae en un fondo mientras le quede saldo
  const h = hojasGastosCliente({ cliente: cli, expenses: corto })
  const filas = h.fondos.filter(r => celda(r[0]) === 'Sin fondo, a pedir al cliente')
  assert.equal(filas.length, 1); assert.equal(celda(filas[0][2]), '502219'); assert.equal(celda(filas[0][6]), -60000)
  assert.equal(celda(h.fondos.at(-1)[6]), -60000)
})

test('fechaExcel: la fecha de un timestamp es la de Chile, no la UTC', () => {
  assert.equal(fechaExcel('2026-09-20T02:00:00Z'), fechaExcel('2026-09-19'))   // 23:00 del 19 en Chile
  assert.equal(fechaExcel('2026-09-20'), 46285)
  assert.equal(fechaExcel(null), null)
})

test('Un gasto en un borrador de rendición no figura como rendido: ni en la regla ni en el Excel', () => {
  const borr = { id: 'r1', client_id: 'c1', tipo: 'cliente', sent_at: null }, env = { id: 'r2', client_id: 'c1', tipo: 'cliente', sent_at: '2026-11-17T15:00:00Z' }
  const gb = g(1, 10000, { client_rendered_at: '2026-11-16T10:00:00Z', client_render_id: 'r1' }), ge = g(2, 20000, { client_rendered_at: '2026-11-16T10:00:00Z', client_render_id: 'r2' })
  assert.deepEqual(rendicionDeGasto(gb, [borr, env]), { borrador: true, fecha: null })
  assert.deepEqual(rendicionDeGasto(ge, [borr, env]), { borrador: false, fecha: '2026-11-17T15:00:00Z' })   // la fecha es la del envío, no la de armado
  assert.equal(rendicionDeGasto(g(3, 1), [borr, env]), null)
  assert.equal(rendicionDeGasto({ ...gb, client_render_id: 'x' }, []).borrador, false)                    // sin la rendición cargada se respeta la marca
  const h = hojasGastosCliente({ cliente: cli, expenses: [gb, ge, g(3, 5000)], rendiciones: [borr, env] }), enc = h.gastos[0], col = enc.indexOf('Rendido al cliente')
  assert.deepEqual(h.gastos.slice(1, 4).map(r => celda(r[col])), ['En borrador, sin enviar', fechaExcel('2026-11-17'), ''])
})

test('Cartola: una OT de $0 o $1 va marcada como no válida (la página la oculta por defecto) y el saldo sigue cuadrando', () => {
  const ex = [{ id: 'f1', client_id: 'c1', type: 'fondo', amount: 100000, date: '2026-08-01' }, g(1, 40000, { ot_number: '1111' }), g(2, 1, { ot_number: '2222' }), g(3, 0, { ot_number: '3333' }), g(4, 1, {})]
  const c = cartolaCliente({ expenses: ex, clientId: 'c1' })
  assert.deepEqual(c.eventos.filter(e => e.nv).map(e => e.ref.id).sort(), [2, 3])   // el de $1 sin OT no es una OT no válida
  assert.equal(c.saldo, fgCliente(ex, 'c1').saldo)
})
