// Pruebas de las cifras puras de venta (src/lib/cifras.js): UF/CLP, recurrentes x12, costo de terceros y redondeo que cuadra.
// Casos de situaciones reales, sin nombres de clientes. Correr: npm test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { esRecurrente, esSubarriendo, ventaUF, ventaCLP, costoVentaUF, redondearPartes } from '../src/lib/cifras.js'

test('venta recurrente activa se proyecta x12; inactiva o única, tal cual', () => {
  const base = { moneda: 'UF', amount_uf: 10, uf_value: 38000 }
  assert.equal(ventaUF({ ...base, cobro_type: 'mensual', status: 'Activo' }), 120)
  assert.equal(ventaUF({ ...base, cobro_type: 'mensual', status: 'Terminado' }), 10)
  assert.equal(ventaUF({ ...base, cobro_type: 'unico', status: 'Activo' }), 10)
  assert.equal(esRecurrente({ cobro_type: 'mensual', status: 'Activo' }), true)
})

test('venta en pesos: usa la UF congelada de la venta y la de referencia solo de respaldo', () => {
  const v = { moneda: 'CLP', amount_clp: 1000000, uf_value: 40000, cobro_type: 'unico' }
  assert.equal(ventaUF(v, 38000), 25)
  assert.equal(ventaUF({ ...v, uf_value: 0 }, 50000), 20)
  assert.equal(ventaUF({ ...v, uf_value: 0 }, 0), 0)   // sin UF no divide por cero ni da NaN
  assert.equal(ventaCLP(v, 38000), 1000000)
})

test('venta en UF a pesos: monto guardado, si no UF congelada, si no la de referencia; nunca NaN', () => {
  const u = { moneda: 'UF', amount_uf: 10, cobro_type: 'unico' }
  assert.equal(ventaCLP({ ...u, amount_clp: 390000 }, 38000), 390000)
  assert.equal(ventaCLP({ ...u, uf_value: 39000 }, 38000), 390000)
  assert.equal(ventaCLP(u, 38000), 380000)
  assert.equal(ventaCLP({ moneda: 'UF', cobro_type: 'unico' }, 38000), 0)
})

test('venta ausente no rompe: costo y recurrencia de null dan 0 y falso', () => {
  assert.equal(esRecurrente(null), false)
  assert.equal(costoVentaUF(null, 38000), 0)
  assert.equal(costoVentaUF(undefined, 38000), 0)
})

test('subarriendo se reconoce por la marca o por el área', () => {
  assert.equal(esSubarriendo({ cobro_config: { subarriendo: true } }), true)
  assert.equal(esSubarriendo({ area: 'Subarriendo' }), true)
  assert.equal(esSubarriendo({ area: 'Tributario' }), false)
  assert.equal(esSubarriendo(null), false)
})

test('costo de terceros: en UF directo, en pesos con la UF de la venta, anualizado si es recurrente', () => {
  assert.equal(costoVentaUF({ cost_uf: 2, cobro_type: 'unico' }, 38000), 2)
  assert.equal(costoVentaUF({ moneda: 'CLP', cost_clp: 400000, uf_value: 40000, cobro_type: 'unico' }, 38000), 10)
  assert.equal(costoVentaUF({ cost_uf: 1, cobro_type: 'mensual', status: 'Activo' }, 38000), 12)
  assert.equal(costoVentaUF({}, 38000), 0)
})

test('redondeo que cuadra: las partes redondeadas suman el total redondeado', () => {
  const partes = [10.4, 10.4, 10.4]   // sumas 31,2 → 31
  const r = redondearPartes(partes)
  assert.equal(r.reduce((a, x) => a + x, 0), 31)
  const m = redondearPartes([0.5, 0.5, 0.5, 0.5])   // mitades: el total 2 se reparte sin perder ni sumar de más
  assert.equal(m.reduce((a, x) => a + x, 0), 2)
  assert.deepEqual(redondearPartes([]), [])
  assert.deepEqual(redondearPartes([0, 0, 0]), [0, 0, 0])
  assert.deepEqual(redondearPartes([null, undefined, 5]), [0, 0, 5])
})

test('redondeo con cifra fija: la cifra que se ve en otra tarjeta no se mueve', () => {
  const r = redondearPartes([5.5, 5.5, 5.5, 5.5], 1, [0])
  assert.equal(r[0], 6)   // fija: redondeo normal
  assert.equal(r.reduce((a, x) => a + x, 0), 22)
})
