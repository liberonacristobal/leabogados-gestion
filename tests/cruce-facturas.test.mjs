// Pruebas del veto del cruce factura ↔ cuota (_shared/cruceFacturas.js). Sin nombres de clientes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { vetoCruce, indexVentas, palabrasDeGlosa } from './../supabase/functions/_shared/cruceFacturas.js'

const sales = [
  { id: 'v1', client_id: 'c1', title: 'Donación familiar' },
  { id: 'v2', client_id: 'c1', title: 'Venta de casa Machalí' },
  { id: 'v3', client_id: 'c2', title: 'Constitución de sociedad' },
]
const idx = indexVentas(sales)
const cuota = { id: 'q', sale_id: 'v1', client_id: 'c1', concept: 'Donación familiar — Cobro 1 (25 UF)' }

test('la factura de OTRA venta no puede ser de esta cuota, aunque monto y ordinal coincidan', () => {
  const f = { id: 'f', sale_id: 'v2', client_id: 'c1', concept: 'Venta de casa Machalí — Cobro 1 (25 UF)' }
  assert.equal(vetoCruce(cuota, f), 'otra_venta')                         // sin índice, basta la venta
  assert.equal(vetoCruce(cuota, f, idx), 'otra_venta')
})

test('factura sin venta: la glosa que nombra otro trabajo del cliente la descarta', () => {
  const f = { id: 'f', sale_id: null, client_id: 'c1', concept: 'Asesoría venta de casa Machalí' }
  assert.equal(vetoCruce(cuota, f, idx), 'otra_glosa')
  assert.equal(vetoCruce(cuota, f), null)                                  // sin ventas a mano no se afirma nada
})

test('el veto solo descarta: glosa genérica, de esta venta o sin coincidencias deja el par en pie', () => {
  const g = c => ({ id: 'f', sale_id: null, client_id: 'c1', concept: c })
  assert.equal(vetoCruce(cuota, g('Honorarios'), idx), null)
  assert.equal(vetoCruce(cuota, g('Asesoría legal'), idx), null)
  assert.equal(vetoCruce(cuota, g('Honorarios donación familiar'), idx), null)
  assert.equal(vetoCruce(cuota, g('Servicios varios octubre'), idx), null)
  assert.equal(vetoCruce(cuota, { id: 'f', sale_id: 'v1', client_id: 'c1', concept: 'x' }, idx), null)   // misma venta
})

test('palabras de la glosa: solo las que identifican un trabajo', () => {
  assert.deepEqual([...palabrasDeGlosa('Servicios legales — Cuota 3/10 septiembre')], [])
  assert.deepEqual([...palabrasDeGlosa('Constitución sociedad Ñuñoa')].sort(), ['constitucion', 'nunoa', 'sociedad'])
})
