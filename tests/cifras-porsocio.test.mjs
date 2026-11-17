// Resumen Por socio: las cifras en $M y la participación % suman exacto. Datos anonimizados.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { partesM, partesPct, partesPctEnt } from './../src/lib/cifras.js'

test('partesM: ingreso real en $M de 1 decimal sumando el total redondeado (201,1 + 134,5 = 335,6)', () => {
  const r = partesM([201130000, 134448010, 0])
  assert.deepEqual(r, [201100000, 134500000, 0]); assert.equal(r.reduce((a, x) => a + x, 0), 335600000)
})
test('partesPctEnt y partesPct: suman 100; negativos y nulos cuentan 0; sin positivos todo 0', () => {
  const e = partesPctEnt([201130000, 134448010, 0]); assert.deepEqual(e, [60, 40, 0])
  const t = partesPctEnt([1, 1, 1]); assert.equal(t.reduce((a, x) => a + x, 0), 100)
  const d = partesPct([307139309, 169875000, 0]); assert.ok(Math.abs(d.reduce((a, x) => a + x, 0) - 100) < 1e-9)
  assert.deepEqual(partesPctEnt([-5, null, 0]), [0, 0, 0]); assert.deepEqual(partesPctEnt([-140400, 450550000, 230100000]).slice(0, 1), [0])
})

import { repartoCierre } from './../src/lib/cifras.js'
test('repartoCierre: real + resto = cierre en $M de 1 decimal (680,2 + 94,2 = 774,4 aunque 94,14 se redondee a 94,1)', () => {
  const r = repartoCierre(680236110, 94144222.2222)
  assert.deepEqual([r.aFecha, r.resto, r.cierre], [680200000, 94200000, 774400000]); assert.equal(r.aFecha + r.resto, r.cierre)
  const z = repartoCierre(0, 0); assert.deepEqual([z.aFecha, z.resto, z.cierre], [0, 0, 0])
  const u = repartoCierre(17131.43, 2279.4, 1); assert.equal(u.aFecha + u.resto, u.cierre)
})

import { kpisPorSocio } from './../src/lib/cifras.js'
// Ventas anonimizadas de un año: ticket, ticket mediano, mayor cliente y crecimiento (V = vendidoPorSocio).
const _v = (soc, ym, b, c, cli) => ({ soc, ym, b, c, m: b - c, s: { client_id: cli } })
const _V = [_v('Ana', '2026-03', 1000, 100, 'k1'), _v('Ana', '2026-05', 3000, 0, 'k2'), _v('Ana', '2026-11', 8000, 800, 'k1'), _v('Beto', '2026-02', 500, 0, 'k3'), _v('Beto', '2026-11', 1500, 0, 'k3')]
const _Vp = [_v('Ana', '2025-04', 2000, 0, 'k1'), _v('Ana', '2025-12', 9999, 0, 'k1'), _v('Beto', '2025-11', 1000, 0, 'k3')]
test('ticket, ticket mediano y mayor cliente por socio y período', () => {
  const k = kpisPorSocio({ P: [], V: _V, ym: '2026-11' })
  assert.equal(k.ticket('Ana', 'ytd'), 4000); assert.equal(k.ticketMediano('Ana', 'ytd'), 3000)   // promedio sesgado por la venta grande
  assert.equal(k.ticket('Ana', 'mes'), 8000); assert.equal(k.ticketMediano('Beto', 'ytd'), 1000)   // par: promedio de los dos centrales
  assert.equal(k.ticket(null, 'ytd'), 14000 / 5)                                                   // oficina = todas las ventas
  assert.equal(Math.round(k.mayorCliente('Ana', 'ytd')), 75)                                       // k1 = 9000 de 12000
  assert.equal(k.mayorCliente('Beto', 'ytd'), 100); assert.equal(k.ticket('Nadie', 'ytd'), null); assert.equal(k.mayorCliente('Nadie', 'ytd'), null)
})
test('crecimiento contra el mismo período del año anterior, sin base es null', () => {
  const k = kpisPorSocio({ P: [], V: _V, Vprev: _Vp, ym: '2026-11' })
  assert.equal(Math.round(k.crecimiento('Ana', 'ytd')), 455)      // neto 2026 enero-nov 11.100 contra 2.000 de 2025 hasta noviembre (el de diciembre no cuenta): (11.100 − 2.000) ÷ 2.000
  assert.equal(k.crecimiento('Beto', 'mes'), 50)                  // 1.500 contra 1.000 en noviembre
  assert.equal(k.crecimiento('Nadie', 'ytd'), null)
  assert.equal(kpisPorSocio({ P: [], V: _V, ym: '2026-11' }).crecimiento('Ana', 'ytd'), null)
})
test('margen después de comisiones = (facturado − comisiones) ÷ facturado, sin facturado es null', () => {
  const P = [{ s: 'f', k: 'emit', soc: 'Ana', m: 1000, d: '2026-05-10' }, { s: 'f', k: 'com', soc: 'Ana', m: -100, d: '2026-05-10' }]
  const k = kpisPorSocio({ P, V: [], ym: '2026-11' })
  assert.equal(k.margen('Ana', 'ytd'), 90); assert.equal(k.margen('Beto', 'ytd'), null)
})
