// Del líquido al bruto de una liquidación: cifras ficticias. El cálculo se contrastó aparte con 27 liquidaciones reales (error máximo del imponible 0,4 %, impuesto único ±$1).
import test from 'node:test'
import assert from 'node:assert/strict'
import { liquidacionDeImponible, imponibleDeLiquido, impuestoUnico, desglosarImponible, costoEmpresaMes } from '../supabase/functions/_shared/liquidoABruto.js'

const UF = 40000
const TRAMOS = [[0, 950000, 0, 0], [950000.01, 2100000, 0.04, 38000], [2100000.01, 3500000, 0.08, 122000], [3500000.01, 4900000, 0.135, 314000], [4900000.01, 1e12, 0.23, 780000]]
const base = { afpPct: 0.1, uf: UF, tramos: TRAMOS }

test('impuesto único: exento bajo el primer tramo, y base × factor − rebaja en el tramo que corresponde', () => {
  assert.equal(impuestoUnico(900000, TRAMOS), 0)
  assert.equal(impuestoUnico(2400000, TRAMOS), Math.round(2400000 * 0.08 - 122000))
  assert.equal(impuestoUnico(0, TRAMOS), 0); assert.equal(impuestoUnico(-5, TRAMOS), 0)
})

test('liquidación de un imponible: descuentos y líquido suman, y la salud adicional sale del plan sobre el 7 %', () => {
  const r = liquidacionDeImponible({ ...base, imponible: 2500000, planSaludPesos: 300000 })
  assert.equal(r.afp, 250000); assert.equal(r.ces, 15000); assert.equal(r.saludLegal, 175000); assert.equal(r.saludTotal, 300000); assert.equal(r.adicional, 125000)
  // la salud descontable para el impuesto único se limita al 7 % del tope (90 UF), no al 7 % del imponible
  assert.equal(r.baseIU, 2500000 - 250000 - 15000 - Math.min(300000, Math.round(0.07 * 90 * UF)))
  assert.equal(r.liquido, 2500000 - r.afp - r.ces - r.saludTotal - r.iu)
})

test('sin plan de salud adicional rige el 7 % legal', () => {
  const r = liquidacionDeImponible({ ...base, imponible: 2000000 })
  assert.equal(r.saludTotal, 140000); assert.equal(r.adicional, 0)
})

test('sobre el tope imponible la AFP y la salud legal no crecen', () => {
  const a = liquidacionDeImponible({ ...base, imponible: 4000000 }), b = liquidacionDeImponible({ ...base, imponible: 5000000 })
  assert.equal(a.afp, b.afp); assert.equal(a.saludLegal, b.saludLegal); assert.equal(a.afp, Math.round(0.1 * 90 * UF))
})

test('del líquido al imponible y de vuelta: el líquido pedido se reproduce', () => {
  for (const liquido of [900000, 1650000, 2300000, 3100000, 4500000]) for (const plan of [0, 300000]) {
    const r = imponibleDeLiquido({ ...base, liquido, planSaludPesos: plan })
    assert.ok(r); assert.ok(Math.abs(r.liquido - liquido) <= 1, `líquido ${liquido}: ${r.liquido}`)
    assert.equal(liquidacionDeImponible({ ...base, imponible: r.imponible, planSaludPesos: plan }).liquido, r.liquido)
  }
})

test('un aumento de líquido sube el bruto más que el líquido, y sin líquido no hay cálculo', () => {
  const a = imponibleDeLiquido({ ...base, liquido: 2300000 }), b = imponibleDeLiquido({ ...base, liquido: 2400000 })
  assert.ok(a && b); assert.ok(b.imponible - a.imponible > 100000)
  assert.equal(imponibleDeLiquido({ ...base, liquido: 0 }), null); assert.equal(imponibleDeLiquido({ ...base, liquido: NaN }), null)
})

test('sueldo base y gratificación: 25 % con tope mensual, el resto son bonos', () => {
  assert.deepEqual(desglosarImponible(1000000), { sueldoBase: 800000, gratificacion: 200000, bonos: 0 })
  assert.deepEqual(desglosarImponible(3000000), { sueldoBase: 2786646, gratificacion: 213354, bonos: 0 })
  assert.deepEqual(desglosarImponible(1000000 + 400000, 400000), { sueldoBase: 800000, gratificacion: 200000, bonos: 400000 })
})

test('costo empresa: haberes más la parte del empleador sobre el imponible', () => {
  assert.deepEqual(costoEmpresaMes({ imponible: 2000000, tasaEmpleador: 0.0595 }), { haberes: 2000000, empleador: 119000, costoEmpresa: 2119000 })
  assert.equal(costoEmpresaMes({ imponible: 0, tasaEmpleador: 0.06 }).costoEmpresa, 0)
})
