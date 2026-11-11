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
