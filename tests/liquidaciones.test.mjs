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
