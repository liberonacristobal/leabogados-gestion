// Gasto de la IA del mes contra su tope. Datos de ejemplo, sin llamadas reales.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { precioDe, costoUSD, centavos, gastoDelMes, estadoTope } from './../supabase/functions/_shared/costoIA.js'

test('precio por modelo: exacto o con sufijo de fecha; uno desconocido no se inventa', () => {
  assert.equal(precioDe('claude-sonnet-4-6').salida, 15)
  assert.equal(precioDe('claude-sonnet-4-6-20260101').entrada, 3)
  assert.equal(precioDe('claude-opus-5-5').entrada, 4)
  assert.equal(precioDe('modelo-nuevo'), null)
  assert.equal(costoUSD({ modelo: 'modelo-nuevo', entrada: 1e6 }), null)
})

test('costo de una fila: entrada, salida y caché a su precio por millón', () => {
  // Opus 5.5: 1M entrada = 4, 0,5M salida = 10, 2M lectura de caché = 0,4, 1M escritura = 5
  assert.ok(Math.abs(costoUSD({ modelo: 'claude-opus-5-5', entrada: 1e6, salida: 5e5, cache_lectura: 2e6, cache_escritura: 1e6 }) - 19.4) < 1e-9)
  assert.equal(costoUSD({ modelo: 'claude-opus-5-5' }), 0)
  assert.equal(costoUSD({ modelo: 'claude-opus-5-5', entrada: -5, salida: 'x' }), 0)
})

test('centavos: las partes suman el total redondeado', () => {
  const r = centavos([0.333, 0.333, 0.334])
  assert.equal(Math.round(r.reduce((a, x) => a + x, 0) * 100), 100)
  assert.deepEqual(centavos([]), [])
})

const FILAS = [
  { dia: '2026-11-04', funcion: 'f-a', modelo: 'claude-sonnet-5-5', llamadas: 10, fallas: 1, entrada: 2e6, salida: 1e5 },   // 4,00 + 1,00
  { dia: '2026-11-05', funcion: 'f-a', modelo: 'claude-opus-5-5', llamadas: 2, fallas: 0, entrada: 5e5, salida: 1e5 },       // 2,00 + 2,00
  { dia: '2026-11-05', funcion: 'f-b', modelo: 'claude-opus-4-8', llamadas: 3, fallas: 0, entrada: 1e5, salida: 2e4 },       // 0,50 + 0,50
  { dia: '2026-10-30', funcion: 'f-b', modelo: 'claude-opus-4-8', llamadas: 9, fallas: 0, entrada: 9e6, salida: 9e6 },       // otro mes: no cuenta
  { dia: '2026-11-06', funcion: 'f-c', modelo: 'modelo-nuevo', llamadas: 4, fallas: 0, entrada: 1e6, salida: 1e6 },        // sin precio: no suma, se informa
]

test('gasto del mes: solo ese mes, por función de mayor a menor, sumando al centavo, con los modelos sin precio aparte', () => {
  const g = gastoDelMes(FILAS, '2026-11')
  assert.equal(g.usd, 10)
  assert.deepEqual(g.porFuncion.map((x) => [x.funcion, x.usd]), [['f-a', 9], ['f-b', 1], ['f-c', 0]])
  assert.equal(g.porFuncion[0].fallas, 1); assert.equal(g.porFuncion[0].llamadas, 12)
  assert.deepEqual(g.porFuncion[0].modelos, ['claude-opus-5-5', 'claude-sonnet-5-5'])
  assert.deepEqual(g.sinPrecio, ['modelo-nuevo'])
  assert.equal(g.llamadas, 19); assert.equal(g.tokens, 2e6 + 1e5 + 5e5 + 1e5 + 1e5 + 2e4 + 2e6)
  assert.equal(Math.round(g.porFuncion.reduce((a, x) => a + x.usd, 0) * 100) / 100, g.usd)
})

test('gasto del mes: sin filas o con basura no falla', () => {
  assert.deepEqual(gastoDelMes([], '2026-11'), { usd: 0, llamadas: 0, tokens: 0, porFuncion: [], sinPrecio: [] })
  assert.equal(gastoDelMes(null, '2026-11').usd, 0)
})

test('tope: cuánto queda y el nivel (cerca desde el 80 %, sobre desde el 100 %); sin tope no hay estado', () => {
  assert.deepEqual(estadoTope(27.73, 50), { tope: 50, queda: 22.27, pct: 0.5546, nivel: 'ok' })
  assert.equal(estadoTope(40, 50)?.nivel, 'cerca')
  assert.equal(estadoTope(39.99, 50)?.nivel, 'ok')
  assert.equal(estadoTope(50, 50)?.nivel, 'sobre')
  assert.equal(estadoTope(60, 50)?.queda, 0)
  assert.equal(estadoTope(10, 0), null); assert.equal(estadoTope(10, 'x'), null)
})
