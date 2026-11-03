import test from 'node:test'
import assert from 'node:assert/strict'
import { disponibleNotaria } from '../supabase/functions/_shared/notariaReglas.js'

const fondo = (id, amount, project, date = '2026-09-01') => ({ id, client_id: 'c', type: 'fondo', amount, project, date })
const ot = (id, amount, project) => ({ id, client_id: 'c', type: 'gasto', category: 'Notaria', ot_number: String(400000 + id), amount, project, date: '2026-10-01' })

test('notaría por trabajo: el fondo de otro trabajo no cubre la OT, y una OT sin trabajo pide asignarlo', () => {
  const g = [fondo(1, 300000, 'Trabajo A'), ot(2, 100000, 'Trabajo B'), ot(3, 50000, undefined)]
  const d = disponibleNotaria(g, 'c')
  assert.equal(d.completo, 300000)                 // el cliente tiene el fondo...
  assert.equal(d.disp, 0)                           // ...pero es de otro trabajo
  assert.deepEqual(d.otSinTrabajo.map(e => e.id), [3])
})

test('notaría por trabajo: fondo del mismo trabajo, y fondo sin trabajo como segundo recurso', () => {
  assert.equal(disponibleNotaria([fondo(1, 300000, 'Trabajo A'), ot(2, 100000, 'Trabajo A')], 'c').disp, 300000)
  const d = disponibleNotaria([fondo(1, 300000, 'Trabajo A'), fondo(2, 50000, undefined), ot(3, 100000, 'Trabajo B')], 'c')
  assert.equal(d.completo, 350000)
  assert.equal(d.sinTrabajo, 50000)
  assert.equal(d.disp, 50000)                       // solo el fondo sin trabajo alcanza a la OT de B
  assert.deepEqual(d.otSinTrabajo, [])
})

test('notaría por trabajo: nunca supera al disponible del cliente completo ni cambia sin OT pendientes', () => {
  const gasto = { id: 9, client_id: 'c', type: 'gasto', category: 'CBR', amount: 90000, rendered_at: '2026-10-01', date: '2026-09-15' }
  const d = disponibleNotaria([fondo(1, 100000, 'Trabajo A'), gasto, ot(2, 5000, 'Trabajo A')], 'c')
  assert.equal(d.completo, 10000); assert.equal(d.disp, 10000)
  assert.equal(disponibleNotaria([fondo(1, 300000, 'Trabajo A')], 'c').disp, 300000)
})
