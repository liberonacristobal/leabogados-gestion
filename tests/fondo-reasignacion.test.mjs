// Bug 2026-11: un fondo conciliado en Banco (transferencia de MAE ASESORIAS SPA por cuenta de Geslog) quedó en «Clientes ocasionales» y al reasignar el movimiento a Geslog el fondo NO cambió de cliente.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planReasignacionFondos } from '../supabase/functions/_shared/fondosReglas.js'

const expenses = [
  { id: 'f1', type: 'fondo', client_id: 'ocasionales', amount: 1227038, project: 'Otro', sale_id: 's9', entity_id: 'e1' },
  { id: 'f2', type: 'fondo', client_id: 'geslog', amount: 500000 },            // ya es del cliente nuevo
  { id: 'g1', type: 'gasto', client_id: 'ocasionales', amount: 1000 },          // un gasto no se toca
  { id: 'f3', type: 'fondo', client_id: 'ocasionales', amount: 10, deleted_at: '2026-11-01' },   // borrado: no se toca
  { id: 'f4', type: 'fondo', client_id: 'ocasionales', amount: 77 },            // de OTRO movimiento
]
const conc = [
  { movimiento_id: 'm1', tipo_destino: 'fondo', gasto_id: 'f1' }, { movimiento_id: 'm1', tipo_destino: 'fondo', gasto_id: 'f2' },
  { movimiento_id: 'm1', tipo_destino: 'fondo', gasto_id: 'f3' }, { movimiento_id: 'm1', tipo_destino: 'factura', gasto_id: 'g1' }, { movimiento_id: 'm2', tipo_destino: 'fondo', gasto_id: 'f4' },
]

test('reasignar el cliente de un movimiento arrastra solo los fondos que ese movimiento concilió y siguen en otro cliente', () => {
  const p = planReasignacionFondos({ movId: 'm1', clienteId: 'geslog', conc, expenses })
  assert.deepEqual(p.ids, ['f1'])
  assert.deepEqual(p.patch, { client_id: 'geslog', entity_id: null, sale_id: null, project: null, subproject: null })   // proyecto, venta y razón social eran del cliente anterior
})
test('sin conciliación, o con todos los fondos ya en el cliente nuevo, no hay nada que pasar', () => {
  assert.deepEqual(planReasignacionFondos({ movId: 'm9', clienteId: 'geslog', conc, expenses }).ids, [])
  assert.deepEqual(planReasignacionFondos({ movId: 'm1', clienteId: 'ocasionales', conc: [{ movimiento_id: 'm1', tipo_destino: 'fondo', gasto_id: 'f1' }], expenses }).ids, [])
  assert.deepEqual(planReasignacionFondos({ movId: 'm1', clienteId: 'geslog' }).ids, [])
})
