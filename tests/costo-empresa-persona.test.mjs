// Costo empresa de una persona en el presupuesto: líquido + impuesto único + leyes sociales, de las propias partidas. Personas y cifras ficticias.
import test from 'node:test'
import assert from 'node:assert/strict'
import { costoEmpresaPersona, monto27 } from '../supabase/functions/_shared/presupuesto.js'

const costos = [
  { id: 'a', n: 'Socia Uno', m: 3_000_000, meses: 12, t: 'fijo', alza: null, g: 'Remuneraciones' },
  { id: 'b', n: 'Socio Dos', m: 2_000_000, meses: 12, t: 'fijo', alza: 10, g: 'Remuneraciones' },
  { id: 'c', n: 'Procuradora Tres', m: 600_000, meses: 12, t: 'fijo', alza: null, g: 'Remuneraciones', boleta: true, liq: 500_000 },
  { id: 'd', n: 'Socia Uno', m: 900_000, meses: 12, t: 'fijo', alza: null, g: 'Leyes sociales' },
  { id: 'e', n: 'Socio Dos', m: 600_000, meses: 12, t: 'fijo', alza: 10, g: 'Leyes sociales' },
  { id: 'imp', n: 'Impuesto único de trabajadores', m: 300_000, meses: 12, t: 'fijo', alza: 10, g: 'Remuneraciones', imp: true },
]
const liq = [{ periodo: '2026-09', persona: 'UNO APELLIDO SOCIA', impuesto_unico: 100_000 }, { periodo: '2026-10', persona: 'UNO APELLIDO SOCIA', impuesto_unico: 120_000 }, { periodo: '2026-10', persona: 'DOS APELLIDO SOCIO', impuesto_unico: 180_000 }]

test('suma el líquido, el impuesto único de su última liquidación y sus leyes sociales, con el reajuste de cada partida', () => {
  const a = costoEmpresaPersona({ costos, persona: 'Socia Uno', liquidaciones: liq, ym: '2026-11', alza: 0 })
  assert.equal(a.liquido, 36_000_000); assert.equal(a.leyes, 10_800_000); assert.equal(a.iu, 120_000 * 12 * 1.1)
  assert.equal(a.costo, a.liquido + a.iu + a.leyes)
  const b = costoEmpresaPersona({ costos, persona: 'Socio Dos', liquidaciones: liq, ym: '2026-11', alza: 0 })
  assert.equal(b.liquido, 2_000_000 * 12 * 1.1); assert.equal(b.leyes, 600_000 * 12 * 1.1); assert.equal(b.iu, 180_000 * 12 * 1.1)
})

test('los costos por persona más el resto de la partida de impuesto único suman las partidas', () => {
  const t = ['Socia Uno', 'Socio Dos'].map((n) => costoEmpresaPersona({ costos, persona: n, liquidaciones: liq, ym: '2026-11', alza: 0 }))
  assert.equal(Math.round(t.reduce((s, x) => s + x.iu, 0)), Math.round(costos.find((c) => c.imp).m * 12 * 1.1))   // 120.000 + 180.000 = la partida
  assert.equal(Math.round(t.reduce((s, x) => s + x.liquido + x.leyes, 0)), Math.round(costos.filter((c) => c.id !== 'imp' && c.id !== 'c').reduce((s, c) => s + monto27(c, 0), 0)))
})

test('quien emite boleta, quien no está en el presupuesto y un presupuesto sin liquidaciones no rompen nada', () => {
  assert.equal(costoEmpresaPersona({ costos, persona: 'Procuradora Tres', liquidaciones: liq, ym: '2026-11', alza: 0 }), null)
  assert.equal(costoEmpresaPersona({ costos, persona: 'Nadie', liquidaciones: liq, ym: '2026-11', alza: 0 }), null)
  const sinLiq = costoEmpresaPersona({ costos, persona: 'Socia Uno', liquidaciones: [], ym: '2026-11', alza: 0 })
  assert.equal(sinLiq.iu, 0); assert.equal(sinLiq.costo, sinLiq.liquido + sinLiq.leyes)
})
