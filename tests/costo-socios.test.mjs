// Costo de los socios en un mes: sueldo del banco + impuesto único + cotizaciones (trabajador y su parte del empleador). Personas y cifras ficticias.
import test from 'node:test'
import assert from 'node:assert/strict'
import { costoSociosMes } from '../supabase/functions/_shared/costoSocios.js'

const liq = (persona, imponible, impuesto_unico, liquido) => ({ periodo: '2026-10', persona, imponible, impuesto_unico, liquido })
const L = [liq('UNO PEREZ SOCIA', 3000000, 100000, 2300000), liq('DOS GOMEZ SOCIO', 3000000, 100000, 2300000), liq('TRES LOPEZ EMPLEADO', 2000000, 30000, 1500000)]
const items = [{ persona: 'Socia', liquido: 2300000 }, { persona: 'Socio', liquido: 2300000 }, { persona: 'Empleado', liquido: 1500000 }]
const base = { items, liquidaciones: L, ym: '2026-10', socios: ['Socia', 'Socio'] }

test('el costo de los socios suma su sueldo, su impuesto único y sus cotizaciones con la parte del empleador en proporción al imponible', () => {
  // cotizaciones del trabajador: socia 600.000, socio 600.000, empleado 470.000; la planilla trae 1.870.000 + 480.000 del empleador
  const r = costoSociosMes({ ...base, cotPlanilla: 1670000 + 480000 })
  assert.equal(r.sueldo, 4600000); assert.equal(r.iu, 200000); assert.equal(r.cotTrab, 1200000)
  assert.equal(r.cotEmp, Math.round(480000 * 6000000 / 8000000))   // 75 % del imponible es de los socios
  assert.equal(r.total, r.sueldo + r.iu + r.cot); assert.equal(r.provisorio, false)
})

test('sin cotizaciones de planilla o sin socios no hay parte del empleador ni errores', () => {
  assert.equal(costoSociosMes({ ...base, cotPlanilla: 0 }).cotEmp, 0)
  const sin = costoSociosMes({ ...base, socios: [], cotPlanilla: 2150000 }); assert.equal(sin.total, 0)
  const vacio = costoSociosMes({ items: [], liquidaciones: [], ym: '2026-10', cotPlanilla: 0, socios: ['Socia'] }); assert.equal(vacio.total, 0); assert.equal(vacio.provisorio, false)
})

test('si el mes aún no tiene liquidaciones usa el anterior y lo marca provisorio', () => {
  const r = costoSociosMes({ ...base, ym: '2026-11', cotPlanilla: 2150000 })
  assert.equal(r.provisorio, true); assert.equal(r.iu, 200000)
})
