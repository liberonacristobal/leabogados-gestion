// «Pago al SII (F29)» de la caja del año: PPM + impuesto único del F29 declarado; la retención de honorarios no suma (ya va en el bruto de Costos reales). Datos anonimizados.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { f29CajaDelAnio, periodoDeConceptoF29 } from './../supabase/functions/_shared/f29Caja.js'

const decl = { '2026-08': { ppm: 416721, impuesto_unico: 161063, retencion_bhe: 27917, total: 605701 }, '2026-09': { ppm: 659577, impuesto_unico: 160564, retencion_bhe: 215194, total: 1035335 } }
const G = (id, date, concept, amount) => ({ id, date, concept, amount })

test('período del concepto', () => { assert.equal(periodoDeConceptoF29('IVA/PPM 09-2026 (retenciones BHE'), '2026-09'); assert.equal(periodoDeConceptoF29('Patente'), null) })
test('declarado: cuenta PPM + impuesto único (sin la retención), sea cual sea el monto registrado del gasto', () => {
  const r = f29CajaDelAnio([G('a', '2026-09-11', 'IVA/PPM 08-2026', 577784), G('b', '2026-10-13', 'IVA/PPM 09-2026', 1035335)], decl, 2026, 12)
  assert.equal(r.total, 416721 + 161063 + 659577 + 160564)
  assert.equal(r.ret, 27917 + 215194)      // la retención se informa, no suma
  assert.equal(r.items[0].registrado, 577784); assert.equal(r.items[0].monto, 416721 + 161063)   // no el registrado: el declarado manda
})
test('sin declarar: cuenta el gasto registrado entero y lo marca', () => {
  const r = f29CajaDelAnio([G('a', '2026-11-12', 'IVA/PPM 10-2026', 1883004)], decl, 2026, 12)
  assert.equal(r.total, 1883004); assert.equal(r.sinDeclarar, 1883004); assert.equal(r.items[0].declarado, false)
})
test('solo pagos del año y hasta el mes pedido', () => {
  const r = f29CajaDelAnio([G('a', '2025-12-13', 'IVA/PPM 11-2025', 1), G('b', '2026-10-13', 'IVA/PPM 09-2026', 1035335), G('c', '2026-11-12', 'IVA/PPM 10-2026', 5)], decl, 2026, 10)
  assert.equal(r.items.length, 1); assert.equal(r.items[0].id, 'b')
})
