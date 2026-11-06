// Tiempo real: un cambio recarga solo su tabla, los cambios seguidos se juntan y con la pestaña oculta se espera al volver.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { suscribirCambios } from '../src/lib/tiempoReal.js'

const falso = () => {
  const oyentes = {}
  const ch = { on(_t, f, cb) { oyentes[f.table] = cb; return ch }, subscribe() { return ch } }
  return { oyentes, quitados: [], supabase: { channel: () => ch, removeChannel(c) { falso.quitados = (falso.quitados || []).concat(c) } } }
}
const doc = (visibilityState = 'visible') => { const l = {}; return { visibilityState, addEventListener: (e, f) => { l[e] = f }, removeEventListener: (e) => { delete l[e] }, l } }
const esperar = () => new Promise(r => setImmediate(r))

test('un cambio recarga solo esa tabla, una vez, tras la espera', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  const f = falso(); const llamadas = []
  suscribirCambios(f.supabase, { billing: () => llamadas.push('billing'), expenses: () => llamadas.push('expenses') }, { doc: doc(), ms: 1000 })
  f.oyentes.billing(); mock.timers.tick(999); await esperar()
  assert.deepEqual(llamadas, [])
  mock.timers.tick(1); await esperar()
  assert.deepEqual(llamadas, ['billing'])
  mock.timers.reset()
})

test('cambios seguidos se juntan en una sola lectura', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  const f = falso(); let n = 0
  suscribirCambios(f.supabase, { billing: () => { n++ } }, { doc: doc(), ms: 1000 })
  for (let i = 0; i < 100; i++) { f.oyentes.billing(); mock.timers.tick(10) }
  mock.timers.tick(1000); await esperar()
  assert.equal(n, 1)
  mock.timers.reset()
})

test('con la pestaña oculta espera y lee al volver; una falla de lectura no rompe', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  const f = falso(); const d = doc('hidden'); let n = 0
  suscribirCambios(f.supabase, { sales: () => { n++; throw new Error('sin red') } }, { doc: d, ms: 500 })
  f.oyentes.sales(); mock.timers.tick(500); await esperar()
  assert.equal(n, 0)
  d.visibilityState = 'visible'; d.l.visibilitychange(); await esperar()
  assert.equal(n, 1)
  mock.timers.reset()
})

test('al cerrar se quita el canal y los avisos pendientes no corren', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  const f = falso(); let n = 0; const d = doc()
  const cerrar = suscribirCambios(f.supabase, { tasks: () => { n++ } }, { doc: d, ms: 500 })
  f.oyentes.tasks(); cerrar(); mock.timers.tick(1000); await esperar()
  assert.equal(n, 0); assert.equal(d.l.visibilitychange, undefined)
  mock.timers.reset()
})
