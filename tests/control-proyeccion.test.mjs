// Pruebas del control de la proyección del flujo (_shared/controlProyeccion.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lunesDe, domingoDe, instantanea, controlProyeccion } from './../supabase/functions/_shared/controlProyeccion.js'

test('lunes y domingo de la semana, incluido el domingo y el cambio de mes', () => {
  assert.equal(lunesDe('2026-11-06'), '2026-11-02'); assert.equal(lunesDe('2026-11-08'), '2026-11-02'); assert.equal(lunesDe('2026-11-02'), '2026-11-02')
  assert.equal(lunesDe('2026-12-01'), '2026-11-30'); assert.equal(domingoDe('2026-11-30'), '2026-12-06')
})

test('solo compara semanas cerradas, con lo cobrado desde el día en que se guardó la proyección', () => {
  const snaps = [
    { key: '2026-10-26', value: JSON.stringify(instantanea('2026-10-26', 10000000)) },
    { key: '2026-11-02', value: JSON.stringify(instantanea('2026-11-04', 8000000)) },     // se guardó el miércoles
    { key: '2026-11-09', value: JSON.stringify(instantanea('2026-11-09', 5000000)) },     // semana aún abierta
  ]
  const cobros = [{ fecha: '2026-10-27', monto: 6000000 }, { fecha: '2026-11-01', monto: 3000000 },
    { fecha: '2026-11-03', monto: 2000000 },                                            // antes de guardar: no cuenta para esa semana
    { fecha: '2026-11-05', monto: 7000000 }, { fecha: '2026-11-10', monto: 1000000 }]
  const r = controlProyeccion({ snaps, cobros, hoy: '2026-11-10' })
  assert.deepEqual(r.filas.map(f => [f.ini, f.proyectado, f.cobrado]), [['2026-11-02', 8000000, 7000000], ['2026-10-26', 10000000, 9000000]])
  assert.equal(r.filas[0].pct, -0.125)
  assert.equal(Math.round(r.error * 100), -11)                                         // (−1 M −1 M) sobre 18 M proyectados
})

test('sin historial, con proyección en cero o con datos dañados no hay NaN ni se rompe', () => {
  assert.deepEqual(controlProyeccion({ snaps: [], cobros: [], hoy: '2026-11-10' }), { filas: [], error: null })
  const r = controlProyeccion({ snaps: [{ key: '2026-10-26', value: '{no es json' }, { key: '2026-10-19', value: JSON.stringify(instantanea('2026-10-19', 0)) }], cobros: [{ fecha: '2026-10-20', monto: 500 }], hoy: '2026-11-10' })
  assert.equal(r.filas.length, 1); assert.equal(r.filas[0].pct, null); assert.equal(r.error, null)
})

test('solo muestra las últimas semanas cerradas', () => {
  const snaps = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05'].map(k => ({ key: k, value: instantanea(k, 1000) }))
  assert.equal(controlProyeccion({ snaps, cobros: [], hoy: '2026-11-10' }).filas.length, 4)
  assert.equal(controlProyeccion({ snaps: [{ key: '2026-09-35', value: instantanea('2026-09-01', 1000) }], cobros: [], hoy: '2026-11-10' }).filas.length, 0)   // clave dañada: se salta
})
