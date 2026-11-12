// Proyección al 31-12: comisiones proyectadas (acotadas al período, mayores primero, el resto suma el total) e ingreso propio. Datos anonimizados.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { comisionesProyectadas, ingresoPropioProyectado } from './../supabase/functions/_shared/proyeccionPropia.js'

const D = s => new Date(s + 'T12:00:00').getTime()
const fin = D('2026-12-31')
const base = [
  { t: D('2026-11-20'), m: 2_000_000, prov: 'Uno' }, { t: D('2026-12-04'), m: 4_000_000, prov: 'Dos' }, { t: D('2026-12-10'), m: 5_000_000, prov: 'Tres' },
  { t: D('2026-11-18'), m: 1_000_000, prov: 'Cuatro' }, { t: D('2027-01-15'), m: 9_000_000, prov: 'Fuera' }, { t: D('2026-11-27'), m: 3_000_000, prov: 'Cinco' },
  { t: D('2026-12-20'), m: 500_000, prov: 'Seis' },
]
test('solo cuenta lo que se espera cobrar hasta el 31-12; los mayores primero y el resto suma el total', () => {
  const r = comisionesProyectadas(base, fin, 3)
  assert.equal(r.n, 6); assert.equal(r.total, 15_500_000)
  assert.deepEqual(r.items.map(x => x.prov), ['Tres', 'Dos', 'Cinco'])
  assert.deepEqual(r.resto, { n: 3, monto: 3_500_000 })
  assert.equal(r.items.reduce((a, x) => a + x.m, 0) + r.resto.monto, r.total)   // las partes suman el total
})
test('filtro (año de venta), vacío y montos no positivos', () => {
  assert.equal(comisionesProyectadas(base, fin, 5, x => x.prov === 'Uno').total, 2_000_000)
  assert.deepEqual(comisionesProyectadas(null, fin), { total: 0, n: 0, items: [], resto: { n: 0, monto: 0 } })
  assert.equal(comisionesProyectadas([{ t: D('2026-11-01'), m: 0 }, { t: D('2026-11-01'), m: -5 }], fin).n, 0)
})
test('ingreso propio = cobranza − comisiones, sin pasar de cero', () => {
  assert.equal(ingresoPropioProyectado(98_700_000, 21_700_000), 77_000_000)
  assert.equal(ingresoPropioProyectado(1_000_000, 5_000_000), 0)
  assert.equal(ingresoPropioProyectado(undefined, null), 0)
})
