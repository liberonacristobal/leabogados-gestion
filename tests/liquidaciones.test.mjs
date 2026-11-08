// Liquidaciones de la contadora: la corregida (correo más reciente) reemplaza a la original. Casos con cifras ficticias, sin nombres ni sueldos reales.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { liquidacionesVigentes, cotizacionesProvisorias } from '../supabase/functions/_shared/liquidacionesReglas.js'

const L = (periodo, persona, imponible, _t) => ({ periodo, persona, imponible, _t })

test('la corregida (correo posterior) reemplaza a la original, venga en el orden que venga', () => {
  const orig = L('2026-10', 'PERSONA UNO', 3000000, 1000), corr = L('2026-10', 'PERSONA UNO', 4000000, 2000)
  assert.equal(liquidacionesVigentes([orig, corr])[0].imponible, 4000000)
  assert.equal(liquidacionesVigentes([corr, orig])[0].imponible, 4000000)   // Gmail entrega primero el más reciente
})

test('una por período y persona, ordenadas, y sin el campo auxiliar', () => {
  const r = liquidacionesVigentes([L('2026-10', 'B', 1, 5), L('2026-09', 'B', 2, 1), L('2026-10', 'A', 3, 5), L('2026-10', 'B', 9, 9)])
  assert.deepEqual(r.map(x => `${x.periodo}|${x.persona}|${x.imponible}`), ['2026-09|B|2', '2026-10|A|3', '2026-10|B|9'])
  assert.ok(r.every(x => !('_t' in x)))
})

test('sin filas o con basura no falla', () => {
  assert.deepEqual(liquidacionesVigentes([]), []); assert.deepEqual(liquidacionesVigentes(null), [])
})

const previo = [{ imponible: 3000000, cotizaciones: 540000 }, { imponible: 2000000, cotizaciones: 360000 }, { imponible: 3000000, cotizaciones: 540000 }]

test('cotizaciones provisorias: trabajador del mes + parte del empleador del mes real anterior, proporcional al imponible', () => {
  const mes = [{ imponible: 4000000, cotizaciones: 700000 }, { imponible: 2000000, cotizaciones: 360000 }, { imponible: 4000000, cotizaciones: 700000 }]
  const r = cotizacionesProvisorias({ mes, previo, cotizPrevReal: 2000000 })   // empleador anterior = 2.000.000 − 1.440.000 = 560.000 sobre 8.000.000 (7 %)
  assert.equal(r.trabajador, 1760000)
  assert.equal(r.cotizaciones, 2460000)                                         // 1.760.000 + 7 % de 10.000.000
  assert.ok(Math.abs(r.tasaEmpleador - 0.07) < 1e-9)
})

test('cotizaciones provisorias: con el mismo imponible que el mes real reproduce ese mes con poca diferencia', () => {
  const otro = [{ imponible: 3000000, cotizaciones: 535000 }, { imponible: 2000000, cotizaciones: 360000 }, { imponible: 3000000, cotizaciones: 535000 }]
  assert.equal(Math.abs(cotizacionesProvisorias({ mes: otro, previo, cotizPrevReal: 2000000 }).cotizaciones - 1995000), 5000)
})

test('cotizaciones provisorias: sin datos del mes anterior o con una cotización real menor que la del trabajador no inventa', () => {
  const m = [{ imponible: 1000000, cotizaciones: 180000 }]
  assert.equal(cotizacionesProvisorias({ mes: m, previo: [], cotizPrevReal: 300000 }), null)
  assert.equal(cotizacionesProvisorias({ mes: m, previo: m, cotizPrevReal: 0 }), null)
  assert.equal(cotizacionesProvisorias({ mes: m, previo: m, cotizPrevReal: 100000 }), null)
  assert.equal(cotizacionesProvisorias({ mes: [], previo: m, cotizPrevReal: 300000 }), null)
})
