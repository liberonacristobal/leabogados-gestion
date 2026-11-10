// «Cambiar cliente» de un abono: sugerencias (monto exacto contra saldo/gastos sin fondos del cliente; último cliente del pagador) y reversa de la reasignación de fondos. Datos de ejemplo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sugerenciasCliente, clavePagador, planReversaFondos } from './../supabase/functions/_shared/sugerenciasCliente.js'
import { planReasignacionFondos } from './../supabase/functions/_shared/fondosReglas.js'

const gasto = (id, client_id, amount, extra = {}) => ({ id, client_id, type: 'gasto', amount, ...extra })
const exps = [gasto('g1', 'alv', 208980), gasto('g2', 'ges', 100000), gasto('g3', 'ges', 50000, { client_rendered_at: '2026-10-01' }), { id: 'f1', client_id: 'ges', type: 'fondo', amount: 1227038 }]
const mov = { id: 'm1', tipo: 'abono', monto: 208980, cliente_id: 'ocas', rut_contraparte: '76.000.000-0', nombre_contraparte: 'MAE ASESORIAS SPA' }

test('clave del pagador: RUT sin puntos ni guion; sin RUT, nombre normalizado', () => {
  assert.equal(clavePagador(mov), 'rut:760000000'); assert.equal(clavePagador({ nombre_contraparte: ' Asesorías  SPA ' }), 'nom:asesorias spa'); assert.equal(clavePagador({}), '')
})
test('monto exacto: el cliente con saldo en contra o gastos sin fondos igual al monto; el cliente actual no se sugiere', () => {
  const r = sugerenciasCliente({ mov, clientIds: ['ocas', 'alv', 'ges'], expenses: exps })
  assert.deepEqual(r, [{ cid: 'alv', via: 'monto', monto: 208980 }])
  assert.deepEqual(sugerenciasCliente({ mov: { ...mov, cliente_id: 'alv' }, clientIds: ['alv'], expenses: exps }), [])   // el cliente actual nunca se sugiere
  assert.deepEqual(sugerenciasCliente({ mov: { ...mov, monto: 208981 }, clientIds: ['alv'], expenses: exps }), [])       // un peso de diferencia ya no calza
  const fondoCubre = [...exps, { id: 'f2', client_id: 'alv', type: 'fondo', amount: 208980 }]
  assert.deepEqual(sugerenciasCliente({ mov, clientIds: ['alv'], expenses: fondoCubre }), [])                             // con el gasto ya cubierto por un fondo, no hay saldo en contra
})
test('último cliente del pagador: el aprendido manda sobre el historial; sin repetir; sin pagador no hay fila', () => {
  const clave = clavePagador(mov)
  const a = sugerenciasCliente({ mov, clientIds: [], expenses: [], ultimoPagador: { [clave]: 'ges' }, historial: [{ clave, cid: 'otro', fecha: '2026-10-20' }] })
  assert.deepEqual(a, [{ cid: 'ges', via: 'pagador' }])
  const h = sugerenciasCliente({ mov, clientIds: [], expenses: [], historial: [{ clave, cid: 'ges', fecha: '2026-10-21' }, { clave, cid: 'viejo', fecha: '2026-09-01' }, { clave: 'rut:1', cid: 'x', fecha: '2026-11-01' }] })
  assert.deepEqual(h, [{ cid: 'ges', via: 'pagador' }])
  const dup = sugerenciasCliente({ mov, clientIds: ['alv'], expenses: exps, ultimoPagador: { [clave]: 'alv' } })
  assert.deepEqual(dup.map((x) => x.cid), ['alv'])                                                                          // no se repite
  assert.deepEqual(sugerenciasCliente({ mov: { id: 'm2', monto: 5 }, clientIds: ['alv'], expenses: exps }), [])
})
test('reversa de la reasignación de fondos: devuelve cada fondo a su cliente, razón social, venta y proyecto', () => {
  const fondo = { id: 'f1', type: 'fondo', client_id: 'ocas', entity_id: 'e1', sale_id: 's1', project: 'P', subproject: 'S' }
  const conc = [{ movimiento_id: 'm1', tipo_destino: 'fondo', gasto_id: 'f1' }]
  const ida = planReasignacionFondos({ movId: 'm1', clienteId: 'alv', conc, expenses: [fondo] })
  assert.deepEqual(ida.ids, ['f1']); assert.equal(ida.patch.client_id, 'alv'); assert.equal(ida.patch.entity_id, null)
  const vuelta = planReversaFondos(ida.filas)   // `filas` son los fondos tal como estaban antes del cambio
  assert.deepEqual(vuelta, [{ id: 'f1', patch: { client_id: 'ocas', entity_id: 'e1', sale_id: 's1', project: 'P', subproject: 'S' } }])
  assert.deepEqual(planReversaFondos([]), [])
})
