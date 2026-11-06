// Vistas guardadas: comparación de combinaciones, nombre único, tope y lectura tolerante.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agregarVista, canonica, hayFiltro, leerVistas, mismaVista, quitarVista, TOPE_VISTAS, claveVistas } from '../src/lib/vistasGuardadas.js'

test('dos combinaciones iguales se reconocen aunque cambie el orden, y lo vacío no cuenta', () => {
  assert.ok(mismaVista({ sFilter: 'Activo', resp: ['Erasmo', 'Cristóbal'], pend: true }, { pend: true, resp: ['Cristóbal', 'Erasmo'], sFilter: 'Activo', q: '', tipos: [] }))
  assert.ok(!mismaVista({ sFilter: 'Activo', resp: ['Erasmo'] }, { sFilter: 'Activo', resp: [] }))
  assert.deepEqual(canonica({ q: '', pend: false, tipos: [], sFilter: 'all' }), { sFilter: 'all' })
})
test('hay filtro solo si la combinación difiere de la de origen', () => {
  assert.equal(hayFiltro({ sFilter: 'Activo' }, { sFilter: 'Activo' }), false)
  assert.equal(hayFiltro({ sFilter: 'Activo', pend: true }, { sFilter: 'Activo' }), true)
})
test('agregar: nombre limpio, mismo nombre reemplaza, vacío y tope dan error', () => {
  let r = agregarVista([], '  Erasmo   con pendientes ', { sFilter: 'Activo', resp: ['Erasmo'] }, { id: 'a' })
  assert.equal(r.lista[0].nombre, 'Erasmo con pendientes')
  r = agregarVista(r.lista, 'erasmo CON pendientes', { sFilter: 'all' }, { id: 'b' })
  assert.equal(r.lista.length, 1); assert.deepEqual(r.lista[0].f, { sFilter: 'all' })
  assert.equal(agregarVista(r.lista, '   ', {}).error, 'Escribe un nombre')
  let l = []; for (let i = 0; i < TOPE_VISTAS; i++) l = agregarVista(l, 'v' + i, { q: 'x' + i }, { id: 'i' + i }).lista
  assert.match(agregarVista(l, 'otra', {}).error, /Máximo/)
  assert.equal(agregarVista(l, 'v0', { q: 'z' }).error, null)   // reemplazar una existente sí se puede con el tope lleno
})
test('quitar y lectura tolerante a texto dañado', () => {
  assert.deepEqual(quitarVista([{ id: 'a' }, { id: 'b' }], 'a'), [{ id: 'b' }])
  assert.deepEqual(leerVistas('esto no es json'), [])
  assert.deepEqual(leerVistas('{"a":1}'), [])
  assert.deepEqual(leerVistas('[{"id":"1","nombre":"x","f":{"q":"a"}},{"nombre":"sin id"}]').map(v => v.id), ['1'])
  assert.equal(claveVistas('CL@leabogados.cl', 'clientes'), 'cl@leabogados.cl|clientes')
})
