// Desfase de pago de fin de año: cotizaciones y F29 sin PPM se pagan el mes siguiente. Cifras sintéticas.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { desfaseFinAnio, cotizacionesDePeriodo } from './../supabase/functions/_shared/desfasePagos.js'
import { idpcDesdePuente } from './../supabase/functions/_shared/idpcEstimado.js'

const ofi = 'o1'
const gastos = [
  { client_id: ofi, concept: 'Cotizaciones sueldos 12-2025', amount: 2_000_000 },
  { client_id: ofi, concept: 'Cotizaciones sueldos 10-2026', amount: 2_400_000 },
  { client_id: ofi, concept: 'Cotizaciones sueldos 09-2026', amount: 2_100_000 },
  { client_id: 'otro', concept: 'Cotizaciones sueldos 12-2025', amount: 999 },          // de otro cliente: no cuenta
  { client_id: ofi, concept: 'Cotizaciones sueldos 12-2025', amount: 5, deleted_at: '2026-02-01' }, // borrado: no cuenta
]

test('cotizaciones de un período: solo las de la oficina y no borradas', () => {
  assert.equal(cotizacionesDePeriodo(gastos, ofi, '12-2025'), 2_000_000)
  assert.equal(cotizacionesDePeriodo(gastos, ofi, '08-2026'), 0)
})

test('el desfase es el por pagar final menos el inicial', () => {
  const r = desfaseFinAnio({ expenses: gastos, ofiId: ofi, anio: 2026, perUlt: '2026-10', f29SinPpmInicial: 250_000, f29SinPpmUlt: 520_000 })
  assert.equal(r.inicial, 2_250_000); assert.equal(r.final, 2_920_000); assert.equal(r.desfase, 670_000)
  assert.equal(r.perInicial, '12-2025'); assert.equal(r.perFinal, '10-2026')
})

test('el ajuste de fin de año suma a la base del año', () => {
  const sin = idpcDesdePuente({ baseAlCorte: 100_000_000, mesesRestantes: 0, cobradoMes: [], pagadoUltimoMes: 0, ppmPagado: 0, ppmUltimoMes: 0 })
  const con = idpcDesdePuente({ baseAlCorte: 100_000_000, mesesRestantes: 0, cobradoMes: [], pagadoUltimoMes: 0, ppmPagado: 0, ppmUltimoMes: 0, ajusteFinAnio: 670_000 })
  assert.equal(con.baseAnio - sin.baseAnio, 670_000); assert.equal(con.ajusteFinAnio, 670_000)
})
