// Foto del comprobante: lo que lee la IA se valida; lo dudoso queda vacío y nunca se inventa.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizarLectura, extraerJSON } from '../src/lib/comprobante.js'

const CATS = ['Notaria', 'CBR', 'Diario Oficial', 'Registro Civil', 'Movilización', 'Archivo Judicial', 'Otro']
const o = { hoy: '2026-11-05', categorias: CATS, catDeTexto: t => /uber|taxi/i.test(t) ? 'Movilización' : null }

test('lectura completa: monto, fecha, glosa y tipo', () => {
  const l = normalizarLectura({ monto: 5696, fecha: '2026-11-05', proveedor: 'Uber', glosa: 'Viaje a notaría', tipo: 'Movilización', ot: null }, o)
  assert.deepEqual(l, { monto: 5696, fecha: '2026-11-05', proveedor: 'Uber', glosa: 'Viaje a notaría', tipo: 'Movilización', ot: null, vacia: false })
})
test('el monto se entiende con símbolo, puntos y decimales; lo absurdo queda vacío', () => {
  assert.equal(normalizarLectura({ monto: '$5.696' }, o).monto, 5696)
  assert.equal(normalizarLectura({ monto: '5.696,00' }, o).monto, 5696)
  assert.equal(normalizarLectura({ monto: 1250.4 }, o).monto, 1250)
  for (const m of [0, -5, 'abc', null, '', 999999999]) assert.equal(normalizarLectura({ monto: m }, o).monto, null)
})
test('la fecha no puede ser del futuro, de hace más de un año ni inexistente', () => {
  assert.equal(normalizarLectura({ fecha: '2026-11-05' }, o).fecha, '2026-11-05')
  assert.equal(normalizarLectura({ fecha: '2026-11-06' }, o).fecha, '2026-11-06')   // un día de margen por la zona horaria
  assert.equal(normalizarLectura({ fecha: '2026-12-20' }, o).fecha, null)
  assert.equal(normalizarLectura({ fecha: '2025-01-02' }, o).fecha, null)
  assert.equal(normalizarLectura({ fecha: '2026-02-31' }, o).fecha, null)
  assert.equal(normalizarLectura({ fecha: '05-11-2026' }, o).fecha, null)
})
test('el tipo viene de la lista; si no, de la glosa; «Otro» no se adivina', () => {
  assert.equal(normalizarLectura({ tipo: 'Combustible', glosa: 'Uber a notaría' }, o).tipo, 'Movilización')
  assert.equal(normalizarLectura({ tipo: 'Combustible', glosa: 'cosas varias' }, o).tipo, null)
  assert.equal(normalizarLectura({ tipo: 'Notaria' }, o).tipo, 'Notaria')
})
test('una imagen que no es comprobante da lectura vacía, y el JSON se extrae aunque venga con texto alrededor', () => {
  assert.equal(normalizarLectura({ monto: null, fecha: null, proveedor: null, glosa: null, tipo: null, ot: null }, o).vacia, true)
  assert.equal(normalizarLectura(null, o).vacia, true)
  assert.deepEqual(extraerJSON('Aquí va:\n```json\n{"monto": 100}\n```'), { monto: 100 })
  assert.equal(extraerJSON('no sé'), null)
  assert.equal(normalizarLectura({ ot: '12345' }, o).ot, '12345')
  assert.equal(normalizarLectura({ ot: 'abc' }, o).ot, null)
})
