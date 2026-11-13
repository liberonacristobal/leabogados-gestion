// Escenarios de retiro: facturas vencidas por tramo (30 a 59, 60 a 89, 90 y más), comisiones a terceros y lo propio que sumarían. Datos anonimizados.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { facturasVencidasPorTramo, resumenPorTramo, escenarioRetiro } from './../supabase/functions/_shared/escenariosRetiro.js'

const D = s => new Date(s + 'T12:00:00').getTime(), hoy = D('2026-11-13')
const F = (id, cid, due, extra = {}) => ({ id, client_id: cid, invoice_no: String(id), status: 'Vencido', billing_type: 'honorarios', due, ...extra })
const saldos = { a: 4_000_000, b: 5_000_000, c: 18_000_000, d: 2_000_000, e: 3_000_000 }
const saldo = b => saldos[b.id] || 0
const billing = [F('a', 'c1', '2026-09-20'), F('b', 'c2', '2026-08-25'), F('c', 'c3', '2026-06-01'), F('d', 'c1', '2026-11-01'), F('e', 'c4', '2026-06-10', { status: 'Pagado' })]
const terceros = [{ billing_id: 'c', estado: 'pendiente', monto: 2_700_000 }, { billing_id: 'a', estado: 'pagado', monto: 999 }]

test('solo vencidas de 30 días o más con saldo; sin pagadas ni recientes', () => {
  const x = facturasVencidasPorTramo({ billing, terceros, saldo, hoyT: hoy })
  assert.deepEqual(x.map(i => i.b.id).sort(), ['a', 'b', 'c'])           // d lleva 12 días; e está pagada
  assert.deepEqual(Object.fromEntries(x.map(i => [i.b.id, i.tramo])), { a: 0, b: 1, c: 2 })   // 54, 80 y 165 días
})
test('comisiones: solo las pendientes de esa factura; lo propio = saldo − comisión', () => {
  const x = facturasVencidasPorTramo({ billing, terceros, saldo, hoyT: hoy }), c = x.find(i => i.b.id === 'c'), a = x.find(i => i.b.id === 'a')
  assert.equal(c.com, 2_700_000); assert.equal(c.neto, 15_300_000)
  assert.equal(a.com, 0); assert.equal(a.neto, 4_000_000)                // la comisión ya pagada no cuenta
})
test('factura por cuenta de un externo: solo es propia la comisión que se queda', () => {
  const x = facturasVencidasPorTramo({ billing: [F('b', 'c2', '2026-08-25')], terceros: [{ billing_id: 'b', estado: 'pendiente', monto: 4_000_000, comision_pct: 20, comision_monto: 1_000_000 }], saldo, hoyT: hoy })
  assert.equal(x[0].neto, 1_000_000)
})
test('resumen por tramo y escenario cuadrado', () => {
  const x = facturasVencidasPorTramo({ billing, terceros, saldo, hoyT: hoy }), rs = resumenPorTramo(x)
  assert.deepEqual(rs.map(t => [t.n, t.clientes, t.saldo]), [[1, 1, 4_000_000], [1, 1, 5_000_000], [1, 1, 18_000_000]])
  const e = escenarioRetiro({ items: x, elegidos: [false, false, true], disponible: 12_340_000, nSocios: 2 })
  assert.equal(e.bruto - e.com, e.neto); assert.equal(e.disponible + e.neto, e.retirable)
  assert.equal(e.retirable, 12_300_000 + 15_300_000); assert.equal(e.n, 1)
  assert.equal(escenarioRetiro({ items: x, elegidos: [false, false, false], disponible: 12_340_000, nSocios: 2 }).retirable, 12_300_000)   // sin tramo: solo lo de hoy
})
