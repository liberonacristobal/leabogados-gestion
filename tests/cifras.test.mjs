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

// Vendido neto: la cascada Bruto − Comisión = Neto se lee exacta, con el neto redondeado solo (la misma cifra en Inicio y Presupuesto).
import { cascadaVendido, kpisPorSocio } from '../src/lib/cifras.js'
test('cascada del vendido: neto + comisión = bruto redondeado, y el neto es el mismo que se ve solo', () => {
  const m = { bruto: 696_149_000, costo: 15_849_000, neto: 680_300_000 - 51_000 + 0, brutoUF: 17533.4, costoUF: 401.2, netoUF: 17132.2 }
  m.neto = m.bruto - m.costo                                                        // 680.300.000 → «$680,3M»
  const p = cascadaVendido(m, false)
  assert.equal(p.neto, Math.round(m.neto / 1e5) * 1e5)                              // el neto no se mueve por el ajuste
  assert.equal(p.neto + p.costo, p.bruto); assert.equal(p.bruto, Math.round(m.bruto / 1e5) * 1e5)
  const u = cascadaVendido(m, true)
  assert.equal(u.neto, Math.round(m.netoUF)); assert.equal(u.neto + u.costo, u.bruto); assert.equal(u.bruto, Math.round(m.brutoUF))
  // neto con decimales .4 y comisión .5: el neto sigue siendo su propio redondeo
  const q = cascadaVendido({ ...m, bruto: 696_140_000, costo: 15_840_000, neto: 680_300_000 }, false)
  assert.equal(q.neto, 680_300_000)
})

test('Vendido neto por socio: cada socio descuenta la comisión de SUS ventas y Socios + Sin socio = Oficina al peso', () => {
  const V = [
    { soc: 'A', ym: '2026-02', m: 1000.4 - 100.2, b: 1000.4, c: 100.2 }, { soc: 'B', ym: '2026-03', m: 500.4 - 0, b: 500.4, c: 0 },
    { soc: 'Sin socio', ym: '2026-05', m: 250.4 - 50.2, b: 250.4, c: 50.2 }, { soc: 'A', ym: '2026-06', m: 333.3 - 33.3, b: 333.3, c: 33.3 },
  ]
  const K = kpisPorSocio({ P: [], V, ym: '2026-11' }), of = K.vend(null, 'ytd'), suma = ['A', 'B', 'Sin socio'].reduce((a, s) => a + K.vend(s, 'ytd'), 0)
  assert.equal(suma, of); assert.equal(of, Math.round(V.reduce((a, x) => a + x.m, 0)))
  assert.equal(K.vend('A', 'ytd'), 1200)                                             // A: (1000,4 − 100,2) + (333,3 − 33,3), solo la comisión de sus ventas
  assert.ok(Math.abs(K.vend('B', 'ytd') - 500.4) < 1)                                // B no tenía comisión (el peso de ajuste de redondearPartes cae en el mayor resto)
})
