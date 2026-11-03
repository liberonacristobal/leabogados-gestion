// Pruebas de pendientes financieros por cliente (vista «Revisar cuentas»). Casos de situaciones reales, sin nombres de clientes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pendientesPorCliente, tiposDe, clientesConPendientes, contables } from '../supabase/functions/_shared/pendientesCliente.js'

const HOY = '2026-11-03'
const clients = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }, { id: 'ci', is_internal: true }]
const base = { clients, sales: [], billing: [], anticipos: [], expenses: [], hoy: HOY }
const tipos = m => Object.fromEntries([...m.entries()].map(([k, g]) => [k, g.items.map(i => i.tipo).sort()]))

test('cuota vencida sin facturar en un trabajo que ya factura: tipo cuotas; «No corresponde» la saca', () => {
  const sales = [{ id: 's1', client_id: 'c1', status: 'Activo' }]
  const billing = [
    { id: 'b1', sale_id: 's1', client_id: 'c1', invoice_no: '10', status: 'Pagado', due: '2026-09-01', amount: 100 },
    { id: 'b2', sale_id: 's1', client_id: 'c1', status: 'Programada', due: '2026-10-01', amount: 100 }]
  assert.deepEqual(tipos(pendientesPorCliente({ ...base, sales, billing })), { c1: ['cuotas'] })
  assert.equal(pendientesPorCliente({ ...base, sales, billing, noEmitir: new Set(['b2']) }).size, 0)
})

test('pagada sin factura: cuenta hasta que se decide «No se emitirá»; con «Se emitirá» sigue pendiente', () => {
  const sales = [{ id: 's1', client_id: 'c1', status: 'Activo' }]
  const billing = [{ id: 'b1', sale_id: 's1', client_id: 'c1', status: 'Anticipada', due: '2026-08-01', amount: 500 }]
  const anticipos = [{ id: 'a1', sale_id: 's1', client_id: 'c1', monto: 500 }]
  assert.deepEqual(tipos(pendientesPorCliente({ ...base, sales, billing, anticipos })), { c1: ['sinfactura'] })
  assert.equal(pendientesPorCliente({ ...base, sales, billing, anticipos, decFact: new Map([['s1', 'no']]) }).size, 0)
  assert.equal(pendientesPorCliente({ ...base, sales, billing, anticipos, decFact: new Map([['s1', 'si']]) }).get('c1').items[0].titulo, 'Factura por emitir')
})

test('cuota Anticipada previa a la app, en un trabajo que sí factura, no es pendiente; posterior sí', () => {
  const sales = [{ id: 's1', client_id: 'c1', status: 'Activo' }]
  const f = { id: 'f', sale_id: 's1', client_id: 'c1', invoice_no: '5', status: 'Pagado', due: '2026-07-01', amount: 10 }
  assert.equal(pendientesPorCliente({ ...base, sales, billing: [f, { id: 'x', sale_id: 's1', client_id: 'c1', status: 'Anticipada', due: '2025-12-01', amount: 99 }] }).size, 0)
  assert.deepEqual(tipos(pendientesPorCliente({ ...base, sales, billing: [f, { id: 'x', sale_id: 's1', client_id: 'c1', status: 'Anticipada', due: '2026-09-01', amount: 99 }] })), { c1: ['sinfactura'] })
})

test('vencidas: usa la regla inyectada y descarta pagadas, reembolsos y saldo cero', () => {
  const billing = [
    { id: 'v1', client_id: 'c2', invoice_no: '1', status: 'Vencido', issued_at: '2026-08-01' },
    { id: 'v2', client_id: 'c2', invoice_no: '2', status: 'Pagado', issued_at: '2026-08-01' },
    { id: 'v3', client_id: 'c2', invoice_no: '3', status: 'Vencido', billing_type: 'reembolso' },
    { id: 'v4', client_id: 'c2', invoice_no: '4', status: 'Vencido', issued_at: '2026-08-01' }]
  const m = pendientesPorCliente({ ...base, billing, esVencida: () => true, saldoBill: b => (b.id === 'v4' ? 0 : 1000) })
  assert.deepEqual(m.get('c2').items.map(i => i.billing_id), ['v1'])
})

test('fondos: solo cuando hay gastos por rendir y el cliente debe; el interno y quien está al día no entran', () => {
  const expenses = [{ client_id: 'c3', type: 'gasto', amount: 50000 }, { client_id: 'c1', type: 'gasto', amount: 50000 }, { client_id: 'c1', type: 'fondo', amount: 50000 }]
  assert.deepEqual(tipos(pendientesPorCliente({ ...base, expenses })), { c3: ['fondos'] })
})

test('banco: abono asignado al cliente con resto por conciliar; el resto menor a $1.000 no cuenta', () => {
  const movsPend = [{ id: 'm1', cliente_id: 'c1', monto: 300000, monto_conciliado: 0 }, { id: 'm2', cliente_id: 'c2', monto: 100000, monto_conciliado: 99500 }]
  assert.deepEqual(tipos(pendientesPorCliente({ ...base, movsPend })), { c1: ['banco'] })
})

test('datos: anulada sin motivo cuenta; con motivo o nota de crédito no', () => {
  const billing = [{ id: 'a1', client_id: 'c1', status: 'Anulada' }, { id: 'a2', client_id: 'c1', status: 'Anulada', motivo_baja: 'Ya facturada' }, { id: 'a3', client_id: 'c1', status: 'Anulada', billing_type: 'nota_credito' }]
  assert.deepEqual(pendientesPorCliente({ ...base, billing }).get('c1').items.map(i => i.billing_id), ['a1'])
})

test('tiposDe y clientesConPendientes: orden fijo, filtro por tipo y orden por cantidad', () => {
  const sales = [{ id: 's1', client_id: 'c1', status: 'Activo' }]
  const billing = [{ id: 'b1', sale_id: 's1', client_id: 'c1', invoice_no: '10', status: 'Pagado', due: '2026-09-01' }, { id: 'b2', sale_id: 's1', client_id: 'c1', status: 'Programada', due: '2026-10-01' }, { id: 'a1', client_id: 'c2', status: 'Anulada' }, { id: 'a2', client_id: 'c2', status: 'Anulada' }]
  const m = pendientesPorCliente({ ...base, sales, billing })
  assert.deepEqual(tiposDe(m.get('c1').items).map(x => x.tipo), ['cuotas'])
  assert.deepEqual(clientesConPendientes(m).map(x => x.id), ['c2', 'c1'])
  assert.deepEqual(clientesConPendientes(m, new Set(['cuotas'])).map(x => x.id), ['c1'])
  assert.deepEqual(clientesConPendientes(m, new Set(), new Set(['c1'])).map(x => x.id), ['c1'])
})

test('fondos viven solo como filtro: no cuentan en «Todos» ni en contables, sí al elegir el tipo', () => {
  const expenses = [{ client_id: 'c3', type: 'gasto', amount: 50000 }]
  const m = pendientesPorCliente({ ...base, expenses, billing: [{ id: 'a1', client_id: 'c3', status: 'Anulada' }] })
  assert.equal(m.get('c3').items.length, 2)
  assert.deepEqual(contables(m.get('c3').items).map(i => i.tipo), ['datos'])
  assert.deepEqual(clientesConPendientes(m).map(x => x.n), [1])
  assert.deepEqual(clientesConPendientes(m, new Set(['fondos'])).map(x => x.n), [1])
  assert.equal(clientesConPendientes(pendientesPorCliente({ ...base, expenses })).length, 0)
})
