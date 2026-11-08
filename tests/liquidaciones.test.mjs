// Liquidaciones de la contadora: la corregida (correo más reciente) reemplaza a la original. Casos sin nombres reales.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { liquidacionesVigentes } from '../supabase/functions/_shared/liquidacionesReglas.js'

const L = (periodo, persona, imponible, _t) => ({ periodo, persona, imponible, _t })

test('la corregida (correo posterior) reemplaza a la original, venga en el orden que venga', () => {
  const orig = L('2026-10', 'PERSONA UNO', 2969115, 1000), corr = L('2026-10', 'PERSONA UNO', 3710375, 2000)
  assert.equal(liquidacionesVigentes([orig, corr])[0].imponible, 3710375)
  assert.equal(liquidacionesVigentes([corr, orig])[0].imponible, 3710375)   // Gmail entrega primero el más reciente
})

test('una por período y persona, ordenadas, y sin el campo auxiliar', () => {
  const r = liquidacionesVigentes([L('2026-10', 'B', 1, 5), L('2026-09', 'B', 2, 1), L('2026-10', 'A', 3, 5), L('2026-10', 'B', 9, 9)])
  assert.deepEqual(r.map(x => `${x.periodo}|${x.persona}|${x.imponible}`), ['2026-09|B|2', '2026-10|A|3', '2026-10|B|9'])
  assert.ok(r.every(x => !('_t' in x)))
})

test('sin filas o con basura no falla', () => {
  assert.deepEqual(liquidacionesVigentes([]), []); assert.deepEqual(liquidacionesVigentes(null), [])
})

import { cotizacionesProvisorias } from '../supabase/functions/_shared/liquidacionesReglas.js'

test('cotizaciones provisorias: trabajador del mes + parte del empleador del mes real anterior, proporcional al imponible', () => {
  const previo = [{ imponible: 2969115, cotizaciones: 590607 }, { imponible: 2066736, cotizaciones: 383326 }, { imponible: 2969115, cotizaciones: 578290 }]
  const mes = [{ imponible: 3931402, cotizaciones: 676208 }, { imponible: 2066736, cotizaciones: 384043 }, { imponible: 3931402, cotizaciones: 676208 }]
  const r = cotizacionesProvisorias({ mes, previo, cotizPrevReal: 2123762 })
  assert.equal(r.trabajador, 1736459)
  assert.ok(Math.abs(r.cotizaciones - 2445409) <= 1)
  assert.ok(Math.abs(r.tasaEmpleador - 0.0714) < 0.0001)
})

test('cotizaciones provisorias: mismo imponible que el mes real reproduce ese mes (agosto con septiembre, $3.568)', () => {
  const sep = [{ imponible: 2969115, cotizaciones: 590607 }, { imponible: 2066736, cotizaciones: 383326 }, { imponible: 2969115, cotizaciones: 578290 }]
  const ago = [{ imponible: 2969115, cotizaciones: 589452 }, { imponible: 2066736, cotizaciones: 382634 }, { imponible: 2969115, cotizaciones: 573511 }]
  assert.equal(Math.abs(cotizacionesProvisorias({ mes: ago, previo: sep, cotizPrevReal: 2123762 }).cotizaciones - 2120704), 3568)
})

test('cotizaciones provisorias: sin datos del mes anterior o con una cotización real menor que la del trabajador no inventa', () => {
  const m = [{ imponible: 1000000, cotizaciones: 180000 }]
  assert.equal(cotizacionesProvisorias({ mes: m, previo: [], cotizPrevReal: 300000 }), null)
  assert.equal(cotizacionesProvisorias({ mes: m, previo: m, cotizPrevReal: 0 }), null)
  assert.equal(cotizacionesProvisorias({ mes: m, previo: m, cotizPrevReal: 100000 }), null)
  assert.equal(cotizacionesProvisorias({ mes: [], previo: m, cotizPrevReal: 300000 }), null)
})
