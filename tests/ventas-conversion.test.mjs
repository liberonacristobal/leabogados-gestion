// Conversión de propuestas con ventana: solo cuentan las decididas desde la primera rechazada registrada; lo cargado como historia no entra. Datos anonimizados.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conversionPropuestas } from './../supabase/functions/_shared/ventasConversion.js'

const rech = (d, extra = {}) => ({ status: 'Rechazada', created_at: '2026-07-30T10:00:00Z', updated_at: d + 'T15:00:00Z', ...extra })
const acept = (creada, activada, extra = {}) => ({ status: 'Activo', created_at: creada, activated_at: activada, ...extra })
const historia = Array.from({ length: 90 }, () => acept('2026-06-06T10:00:00Z', '2026-06-06T10:00:30Z'))

test('0 registros: sin rechazadas no hay ventana ni cifra (aunque haya cientos de Activo cargados como historia)', () => {
  assert.deepEqual(conversionPropuestas({ sales: [] }), { pct: null, aceptadas: 0, rechazadas: 0, desde: null, hasta: null, decisiones: [] })
  assert.equal(conversionPropuestas({ sales: historia }).pct, null)
  assert.equal(conversionPropuestas({ sales: null }).pct, null)
})
test('ventana desde la primera rechazada: lo creado ya Activo y lo activado antes de la ventana no cuenta como propuesta aceptada', () => {
  const sales = [...historia, rech('2026-10-02'), rech('2026-10-02'), rech('2026-10-19'),
    acept('2026-09-20T10:00:00Z', '2026-09-27T10:00:00Z'),                    // aceptada antes de la ventana: fuera
    acept('2026-10-06T10:00:00Z', '2026-10-15T10:00:00Z'),                    // aceptada dentro de la ventana
    acept('2026-10-06T10:00:00Z', '2026-10-26T10:00:00Z', { status: 'Terminado' }),
    acept('2026-10-10T10:00:00Z', '2026-10-10T10:00:40Z'),                    // creada ya Activa: no fue propuesta
    { status: 'Propuesta', created_at: '2026-10-19T10:00:00Z' }]               // pendiente: no cuenta
  const r = conversionPropuestas({ sales })
  assert.deepEqual([r.aceptadas, r.rechazadas, r.desde, r.hasta], [2, 3, '2026-10-02', '2026-10-26'])
  assert.ok(Math.abs(r.pct - 40) < 1e-9)
})
test('solo aceptadas dentro de la ventana, sin rechazadas: sin cifra; solo rechazadas: 0 %; borradas y excluidas no cuentan', () => {
  assert.equal(conversionPropuestas({ sales: [acept('2026-10-06T10:00:00Z', '2026-10-15T10:00:00Z')] }).pct, null)
  assert.equal(conversionPropuestas({ sales: [rech('2026-10-02')] }).pct, 0)
  const r = conversionPropuestas({ sales: [rech('2026-10-02'), rech('2026-10-03', { deleted_at: '2026-10-04' }), rech('2026-10-05', { sub: true })], excluir: (s) => s.sub })
  assert.deepEqual([r.rechazadas, r.desde], [1, '2026-10-02'])
})

// Caso real anonimizado (10 decisiones): 5 aceptadas y 5 rechazadas; una rechazada es el duplicado de una aceptada y se marca «no cuenta».
const caso = () => [
  ...Array.from({ length: 60 }, (_, i) => acept('2026-06-06T10:00:00Z', '2026-06-06T10:00:30Z', { id: 'h' + i })),                          // historia cargada
  rech('2026-10-02', { id: 'r1', title: 'Propuesta A', client_id: 'c1' }), rech('2026-10-02', { id: 'r2', title: 'Propuesta B', client_id: 'c2' }), rech('2026-10-02', { id: 'r3', title: 'Propuesta C', client_id: 'c3' }),
  rech('2026-10-19', { id: 'r4', title: 'Propuesta D', client_id: 'c4' }), rech('2026-10-27', { id: 'dup', title: 'Propuesta E', client_id: 'c5', created_at: '2026-10-27T09:00:00Z' }),
  acept('2026-10-09T10:00:00Z', '2026-10-14T10:00:00Z', { id: 'a1', title: 'Propuesta F', client_id: 'c6' }), acept('2026-10-05T10:00:00Z', '2026-10-15T10:00:00Z', { id: 'a2', title: 'Propuesta G', client_id: 'c7' }),
  acept('2026-10-20T10:00:00Z', '2026-10-26T10:00:00Z', { id: 'a3', title: 'Propuesta H', client_id: 'c8' }), acept('2026-10-27T09:00:00Z', '2026-10-30T10:00:00Z', { id: 'a4', title: 'Propuesta E', client_id: 'c5' }),   // aceptada del duplicado
  acept('2026-11-01T10:00:00Z', '2026-11-06T10:00:00Z', { id: 'a5', title: 'Propuesta I', client_id: 'c9' }),
  acept('2026-10-20T08:00:00Z', '2026-10-20T11:00:00Z', { id: 'x', title: 'Creada y activada el mismo día' }),                                  // 3 h: no fue propuesta
]
test('caso real: sin marcar la duplicada son 5 aceptadas y 5 rechazadas (50 %); marcándola, 5 y 4 (56 %)', () => {
  const a = conversionPropuestas({ sales: caso() })
  assert.deepEqual([a.aceptadas, a.rechazadas, a.desde, a.hasta], [5, 5, '2026-10-02', '2026-11-06']); assert.equal(a.pct, 50); assert.equal(a.decisiones.length, 10)
  const b = conversionPropuestas({ sales: caso(), noCuentan: new Set(['dup']) })
  assert.deepEqual([b.aceptadas, b.rechazadas, b.desde], [5, 4, '2026-10-02']); assert.ok(Math.abs(b.pct - 500 / 9) < 1e-9)
  assert.equal(b.decisiones.length, 10); assert.equal(b.decisiones.filter((d) => !d.cuenta).length, 1); assert.equal(b.decisiones.find((d) => d.id === 'dup').cuenta, false)
  assert.deepEqual(b.decisiones.map((d) => d.fecha), ['2026-11-06', '2026-10-30', '2026-10-27', '2026-10-26', '2026-10-19', '2026-10-15', '2026-10-14', '2026-10-02', '2026-10-02', '2026-10-02'])   // más reciente primero
  assert.equal(b.decisiones.some((d) => d.id === 'x'), false)
  assert.equal(conversionPropuestas({ sales: caso(), noCuentan: ['dup'] }).rechazadas, 4)   // también acepta una lista de ids
})
test('la marca «no cuenta» aplica a cualquier propuesta: una aceptada marcada sale de la cifra pero queda en la lista; si era la única rechazada, no hay ventana', () => {
  const c = conversionPropuestas({ sales: caso(), noCuentan: new Set(['a2']) })
  assert.deepEqual([c.aceptadas, c.rechazadas], [4, 5]); assert.equal(c.decisiones.find((d) => d.id === 'a2').cuenta, false)
  const d = conversionPropuestas({ sales: [rech('2026-10-02', { id: 'solo' }), acept('2026-10-06T10:00:00Z', '2026-10-15T10:00:00Z', { id: 'ok' })], noCuentan: ['solo'] })
  assert.equal(d.pct, null); assert.equal(d.decisiones.find((x) => x.id === 'solo').cuenta, false)
})
