// Presupuesto · distribución mensual: partes iguales por defecto, «Estacionalidad» (promedio suavizado de los años observados) y «Manual»; las partes suman el total. Datos de ejemplo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  distribuirMensual, pesosEstacionalidad, pesosDe, repartoMensual, resumenDistribucion, estadoInicial, COMPONENTES_DIST, MODOS_DIST, nombreComponente,
} from './../supabase/functions/_shared/presupuesto.js'

const suma = (a) => a.reduce((x, y) => x + y, 0)
const cerca = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`)

test('distribuirMensual: partes iguales sin pesos y las partes suman el total al peso, también con ceros y totales raros', () => {
  const t = 1_234_567_891
  const iguales = distribuirMensual(t); assert.equal(iguales.length, 12); cerca(suma(iguales), t, 1e-3); cerca(iguales[0], t / 12); cerca(iguales[0], iguales[11])
  for (const w of [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], [0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0], [-5, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]]) cerca(suma(distribuirMensual(t, w)), t, 1e-3)
  assert.deepEqual(distribuirMensual(t, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), iguales)    // pesos que no suman → partes iguales
  assert.deepEqual(distribuirMensual(t, [1, 2, 3]), iguales)                                 // pesos incompletos → partes iguales
  assert.deepEqual(distribuirMensual(0, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), Array(12).fill(0))
  assert.deepEqual(distribuirMensual(NaN), Array(12).fill(0)); assert.deepEqual(distribuirMensual(null), Array(12).fill(0))
})

test('estacionalidad: cada año pesa contra su propio promedio, se promedian los años y se suaviza; sin datos devuelve null', () => {
  const a = Array.from({ length: 12 }, (_, i) => 100 + (i === 2 ? 600 : 0))             // 2025: marzo muy fuerte
  const b = Array.from({ length: 12 }, (_, i) => (i < 10 ? 200 * (i === 2 ? 0.2 : 1) : null))   // 2026: marzo débil, sin nov ni dic
  const w = pesosEstacionalidad([a, b])
  assert.equal(w.length, 12); assert.ok(w.every((x) => Number.isFinite(x) && x > 0))
  // un año el doble de grande no pesa el doble: con la misma forma da los mismos pesos
  const x1 = pesosEstacionalidad([a]), x2 = pesosEstacionalidad([a.map((v) => v * 2)]); x1.forEach((v, i) => cerca(v, x2[i], 1e-9))
  // suavizado: el pico de marzo de un solo año baja contra el dato crudo
  const crudo = a[2] / (suma(a) / 12); assert.ok(x1[2] < crudo)
  assert.equal(pesosEstacionalidad([]), null); assert.equal(pesosEstacionalidad([[null, null, 5]]), null); assert.equal(pesosEstacionalidad([Array(12).fill(0)]), null)
  assert.equal(pesosEstacionalidad(null), null)
  // un mes sin dato en ningún año se completa con el promedio de los demás
  const hueco = pesosEstacionalidad([a.map((v, i) => (i === 11 ? null : v))]); assert.ok(Number.isFinite(hueco[11]))
})

test('pesosDe y repartoMensual: por defecto partes iguales; estacional y manual solo si hay pesos válidos', () => {
  const dist = { modo: { ventas: 'estacional', caja: 'manual', costos: 'manual', retiros: 'estacional' }, manual: { caja: [10, 0, 10, 0, 10, 0, 10, 0, 10, 0, 10, 0], costos: [0, 0, 0] } }
  const est = [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2]
  assert.equal(pesosDe(dist, 'fact', est), null)                                         // sin modo → partes iguales
  assert.deepEqual(pesosDe(dist, 'ventas', est), est); assert.equal(pesosDe(dist, 'ventas', null), null)   // estacional sin datos → iguales
  assert.equal(pesosDe(dist, 'costos', est), null)                                       // manual inválido → iguales
  assert.equal(pesosDe(null, 'ventas', est), null); assert.equal(pesosDe({}, 'ventas', est), null)
  const total = 600_000_000
  for (const c of COMPONENTES_DIST) cerca(suma(repartoMensual(total, dist, c, est)), total, 1e-3)
  const caja = repartoMensual(total, dist, 'caja', est); cerca(caja[0], total / 6); assert.equal(caja[1], 0)
  const v = repartoMensual(total, dist, 'ventas', est); cerca(v[6] / v[0], 2)
  assert.deepEqual(repartoMensual(total, estadoInicial({}).dist, 'ventas', est), distribuirMensual(total))   // estado nuevo: partes iguales en todo
})

test('resumen de la distribución en una línea y modos disponibles', () => {
  const n = (c) => nombreComponente(c)
  assert.equal(resumenDistribucion(estadoInicial({}).dist, n), 'partes iguales'); assert.equal(resumenDistribucion(null, n), 'partes iguales')
  assert.equal(resumenDistribucion({ modo: { ventas: 'estacional', caja: 'manual', fact: 'iguales' }, manual: {} }, n), 'vendido estacionalidad · cobrado manual')
  assert.deepEqual(MODOS_DIST.map((x) => x[0]), ['iguales', 'estacional', 'manual'])
  assert.deepEqual(COMPONENTES_DIST, ['ventas', 'fact', 'caja', 'costos', 'retiros'])
})
