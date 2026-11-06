// Orden de columnas: números como números, texto natural sin tildes, vacíos siempre al final, tercer toque vuelve al original.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ordenarFilas, siguienteOrden, compararValores } from '../src/lib/ordenar.js'

const F = [{ n: 'Álvarez', m: 1000, c: 'N° 10' }, { n: 'barros', m: null, c: 'N° 2' }, { n: 'Cruz', m: 250, c: '' }, { n: 'álamos', m: 99000, c: 'N° 1' }]
const acc = { Cliente: x => x.n, Monto: x => x.m, N: x => x.c }

test('números como números y vacío al final, también al invertir', () => {
  assert.deepEqual(ordenarFilas(F, { k: 'Monto', d: 1 }, acc).map(x => x.m), [250, 1000, 99000, null])
  assert.deepEqual(ordenarFilas(F, { k: 'Monto', d: -1 }, acc).map(x => x.m), [99000, 1000, 250, null])
})
test('texto sin tildes ni mayúsculas, y números dentro del texto en orden natural', () => {
  assert.deepEqual(ordenarFilas(F, { k: 'Cliente', d: 1 }, acc).map(x => x.n), ['álamos', 'Álvarez', 'barros', 'Cruz'])
  assert.deepEqual(ordenarFilas(F, { k: 'N', d: 1 }, acc).map(x => x.c), ['N° 1', 'N° 2', 'N° 10', ''])
})
test('el orden es estable, no cambia la lista original y sin accesor no hace nada', () => {
  const copia = JSON.stringify(F)
  const igual = [{ k: 1, v: 'a' }, { k: 2, v: 'a' }, { k: 3, v: 'a' }]
  assert.deepEqual(ordenarFilas(igual, { k: 'V', d: -1 }, { V: x => x.v }).map(x => x.k), [1, 2, 3])
  ordenarFilas(F, { k: 'Monto', d: 1 }, acc)
  assert.equal(JSON.stringify(F), copia)
  assert.equal(ordenarFilas(F, { k: 'Otro', d: 1 }, acc), F)
})
test('tres toques: ascendente, descendente y de vuelta al orden original', () => {
  const a = siguienteOrden(null, 'Monto'), b = siguienteOrden(a, 'Monto'), c = siguienteOrden(b, 'Monto')
  assert.deepEqual([a, b, c], [{ k: 'Monto', d: 1 }, { k: 'Monto', d: -1 }, null])
  assert.deepEqual(siguienteOrden(b, 'Cliente'), { k: 'Cliente', d: 1 })
  assert.equal(compararValores(undefined, 3), 1)
})
