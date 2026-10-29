// Regla única del saldo de gastos de un cliente (fgCliente), la que usan la app, el cierre de mes, el resumen semanal y el aviso de fondos.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fgCliente, gastosPorRendirCli, grupoRendir, propuestaFondoRendicion } from './../supabase/functions/_shared/gastosReglas.js'

const f = (amount, o = {}) => ({ client_id: 'c1', type: 'fondo', amount, ...o })
const g = (amount, o = {}) => ({ client_id: 'c1', type: 'gasto', amount, ...o })

test('saldo = fondos − gastos del cliente, sin mezclar a otros clientes', () => {
  const r = fgCliente([f(500000), g(200000), g(50000), g(999, { client_id: 'c2' }), f(7, { client_id: 'c2' })], 'c1')
  assert.deepEqual(r, { fondos: 500000, gastos: 250000, saldo: 250000 })
})

test('solo se excluye el gasto marcado no_descuenta_saldo; lo resumido en un corte de apertura no suma', () => {
  const r = fgCliente([f(100000), g(30000), g(40000, { no_descuenta_saldo: true }), g(50000, { apertura_id: 'ap1' }), f(60000, { apertura_id: 'ap1' })], 'c1')
  assert.deepEqual(r, { fondos: 100000, gastos: 30000, saldo: 70000 })
})

test('un cliente sin movimientos tiene saldo 0, y una lista vacía o nula no rompe', () => {
  assert.deepEqual(fgCliente([], 'c1'), { fondos: 0, gastos: 0, saldo: 0 })
  assert.deepEqual(fgCliente(null, 'c1'), { fondos: 0, gastos: 0, saldo: 0 })
})

test('gastos por rendir: solo los del cliente, sin rendir, que descuentan saldo y fuera del corte de apertura', () => {
  const es = [g(1000), g(2000, { client_rendered_at: '2026-10-01' }), g(3000, { no_descuenta_saldo: true }), g(4000, { apertura_id: 'x' }), g(5000, { client_id: 'c2' }), f(9000)]
  assert.deepEqual(gastosPorRendirCli(es, 'c1').map(e => e.amount), [1000])
})

test('grupo de rendir: borrador armado, pedir, a favor, en cero, depósito por esperar y al día', () => {
  assert.equal(grupoRendir({ n: 3, s: -5000, armada: true }), 'env')
  assert.equal(grupoRendir({ n: 3, s: -5000 }), 'pedir')
  assert.equal(grupoRendir({ n: 3, s: 5000 }), 'favor')
  assert.equal(grupoRendir({ n: 3, s: 0 }), 'cero')
  assert.equal(grupoRendir({ n: 0, s: -5000 }), 'dep')
  assert.equal(grupoRendir({ n: 0, s: 0 }), 'aldia')
})

test('propuesta de fondo por una rendición enviada: solo con cliente, abono libre, rendición enviada antes y saldo por cubrir', () => {
  const mov = { tipo: 'abono', cliente_id: 'c1', monto: 300000, monto_conciliado: 0, fecha: '2026-10-20' }
  const rendiciones = [{ id: 'r1', tipo: 'cliente', client_id: 'c1', sent_at: '2026-10-10T10:00:00' }]
  const expenses = [g(500000)]
  const p = propuestaFondoRendicion({ mov, expenses, rendiciones })
  assert.equal(p.rend.id, 'r1'); assert.equal(p.porCubrir, 500000); assert.equal(p.queda, 200000)
  assert.equal(propuestaFondoRendicion({ mov: { ...mov, cliente_id: null }, expenses, rendiciones }), null)
  assert.equal(propuestaFondoRendicion({ mov: { ...mov, categoria: 'Otro' }, expenses, rendiciones }), null)
  assert.equal(propuestaFondoRendicion({ mov, expenses: [g(500000), f(500000)], rendiciones }), null)   // sin saldo por cubrir
  assert.equal(propuestaFondoRendicion({ mov: { ...mov, fecha: '2026-10-05' }, expenses, rendiciones }), null)   // el abono es anterior a la rendición
})
