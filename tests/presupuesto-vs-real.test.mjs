// Presupuesto contra real de los costos de oficina: meses cerrados, mes sin planilla y proyección del año. Cifras anonimizadas.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { presupuestoVsReal } from './../supabase/functions/_shared/presupuestoVsReal.js'

const esPPM = (r) => String(r?.categoria || '') === 'Impuestos y patentes' && /ppm/i.test(String(r?.item || ''))
const costos = [
  { categoria: 'Remuneraciones', item: 'Sueldos', monto: 1_000_000 },
  { categoria: 'Leyes sociales', item: 'Cotizaciones', monto: 200_000 },
  { categoria: 'Arriendo y espacio', item: 'Arriendo', monto: 500_000 },
  { categoria: 'Arriendo y espacio', item: 'Aseo', monto: 50_000 },                       // el aseo va a gastos varios
  { categoria: 'Remuneraciones', item: 'Contadora', monto: 40_000 },                      // la contadora va aparte
  { categoria: 'Impuestos y patentes', item: 'PPM', monto: 300_000 },                     // el PPM no es costo
  { categoria: 'Arriendo y espacio', item: 'Subarriendo', monto: 100_000, es_ingreso: true },
]
const mesPlanilla = (rem, cot, arr, con, gv) => ({ conPlanilla: true, estimado: false, gv, cosLines: [{ k: 'rem', m: rem }, { k: 'cot', m: cot }, { k: 'arr', m: arr }, { k: 'con', m: con }, { k: 'gv', m: gv }] })

test('presupuesto por categoría y real de un mes con planilla; el desvío es real menos presupuesto', () => {
  const rmes = { 1: mesPlanilla(1_100_000, 200_000, 500_000, 40_000, 80_000) }
  const r = presupuestoVsReal({ costosOfiRows: costos, rmes, yr: 2026, curY: 2026, curM: 2, esPPM })   // solo enero está cerrado
  assert.equal(r.cerM, 1); assert.equal(r.bud, 1_000_000 + 200_000 + 500_000 + 50_000 + 40_000)
  assert.equal(r.real, 1_100_000 + 200_000 + 500_000 + 40_000 + 80_000); assert.equal(r.dv, r.real - r.bud)
  assert.equal(r.catTot('gv').b, 50_000); assert.equal(r.catTot('rem').r, 1_100_000)
})

test('un mes sin planilla toma su presupuesto más los gastos varios reales', () => {
  const rmes = { 1: { conPlanilla: false, gv: 30_000 } }
  const r = presupuestoVsReal({ costosOfiRows: costos, rmes, yr: 2026, curY: 2026, curM: 2, esPPM })
  assert.equal(r.filas[0].rt, r.filas[0].bt + 30_000); assert.equal(r.filas[0].est, true)
})

test('la proyección suma el real cerrado y el presupuesto de los meses que faltan; sin presupuesto da null', () => {
  const rmes = { 1: mesPlanilla(1_000_000, 200_000, 500_000, 40_000, 50_000) }
  const r = presupuestoVsReal({ costosOfiRows: costos, rmes, yr: 2026, curY: 2026, curM: 2, esPPM })
  assert.equal(r.resto.length, 11); assert.equal(r.proy, r.real + r.budResto); assert.equal(r.budAnio, r.bud + r.budResto)
  assert.equal(presupuestoVsReal({ costosOfiRows: [], rmes, yr: 2026, curY: 2026, curM: 2, esPPM }), null)
})
