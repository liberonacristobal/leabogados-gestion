// Paso 6 del Presupuesto: real mensual, presupuesto desde el Ideal y el arrastre, ventana comparable y apertura. Datos de ejemplo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { realMensualAnio, presupuestoMensual, ventanaComparable, aperturaOrigen, versionTraeSeguimiento, fotoSeguimiento } from './../supabase/functions/_shared/seguimientoPresupuesto.js'
import { repartoMensual } from './../supabase/functions/_shared/presupuesto.js'

const serie = { '2026-01': { fac: 100, cos: 30 }, '2026-02': { fac: 120, cos: 30 }, '2026-03': { fac: 90, cos: 32 }, '2025-01': { fac: 80, cos: 28 }, '2025-02': { fac: 70, cos: 28 } }
const cobMes = { '2026-01': 90, '2026-02': 110, '2025-01': 60 }

test('real mensual: facturado, cobrado, costos, vendido por mes y margen en caja; lo que falta queda en null', () => {
  const r = realMensualAnio({ anio: 2026, serie, cobMes, evoVend: [50, 130, 200, null], retirosMes: [10, null], tercPct: 10 })
  assert.deepEqual(r.fact.slice(0, 4), [100, 120, 90, null]); assert.deepEqual(r.caja.slice(0, 3), [90, 110, null]); assert.deepEqual(r.ventas.slice(0, 3), [50, 80, 70])
  assert.equal(r.margen[0], 90 * 0.9 - 30); assert.equal(r.margen[2], null); assert.equal(r.retiros[0], 10); assert.equal(r.retiros[1], null)
  const p = realMensualAnio({ anio: 2025, serie, cobMes }); assert.equal(p.ventas[0], null); assert.equal(p.retiros[0], null); assert.equal(p.fact[1], 70)
})
test('presupuesto mensual: facturado = arrastre del mes + nuevo ÷ 12; margen = cobrado de la cadena − comisiones − costos', () => {
  const rep = (t, c) => repartoMensual(t, { modo: {}, manual: {} }, c, null)
  const P = presupuestoMensual({ rep, arrastreMes: [10, 20, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0], nuevoFacturar: 120, ventas: 600, cobranza: 400, ideal: { costos: 120, terc: 24, caja: 360, retiros: 60 } })
  assert.equal(P.fact[0], 20); assert.equal(P.fact[3], 10); assert.ok(Math.abs(P.fact.reduce((a, b) => a + b, 0) - (60 + 120)) < 1e-9)
  assert.ok(Math.abs(P.ventas.reduce((a, b) => a + b, 0) - 600) < 1e-9); assert.ok(Math.abs(P.caja.reduce((a, b) => a + b, 0) - 400) < 1e-9)
  assert.ok(Math.abs(P.margen.reduce((a, b) => a + b, 0) - (360 - 24 - 120)) < 1e-9)   // igual al margen del Ideal
  assert.equal(presupuestoMensual({ rep, arrastreMes: [], nuevoFacturar: -5, ventas: null, cobranza: 0, ideal: { costos: 0, terc: 0, caja: 0, retiros: 0 } }).ventas[0], null)
})
test('ventana comparable: solo meses cerrados con real; avance contra el presupuesto y diferencia contra el mismo período del año anterior', () => {
  const v = ventanaComparable({ pres: Array(12).fill(100), real: [90, 120, null, ...Array(9).fill(null)], previo: [80, 70, 60, ...Array(9).fill(null)], cerrados: 3 })
  assert.equal(v.hay, true); assert.equal(v.meses, 2); assert.equal(v.realAcum, 210); assert.equal(v.presAcum, 200); assert.equal(v.previoAcum, 150); assert.ok(Math.abs(v.avance - 105) < 1e-9); assert.equal(v.vsPrevio, 60); assert.equal(v.presAnio, 1200)
  const s = ventanaComparable({ pres: Array(12).fill(100), real: Array(12).fill(null), previo: [], cerrados: 0 })
  assert.equal(s.hay, false); assert.equal(s.avance, null); assert.equal(s.presAnio, 1200); assert.equal(s.realAcum, null)
  assert.equal(ventanaComparable({ pres: Array(12).fill(null), real: [5], previo: [], cerrados: 1 }).avance, null)   // sin presupuesto no hay avance
})
test('apertura por origen: las dos partes suman el total real y el presupuesto', () => {
  const a = aperturaOrigen({ presA: [60, 60], presB: [20, 20], realTotal: [70, 90], realB: [15, 25], cerrados: 2 })
  assert.equal(a.total.real, 160); assert.equal(a.b.real, 40); assert.equal(a.a.real, 120); assert.equal(a.a.pres + a.b.pres, a.total.pres); assert.ok(Math.abs(a.a.avance - 100) < 1e-9); assert.ok(Math.abs(a.b.avance - 100) < 1e-9)
  assert.equal(aperturaOrigen({ presA: [1], presB: [1], realTotal: [null], realB: [], cerrados: 1 }).hay, false)
})
test('una versión sin la foto del Seguimiento pide guardar otra para comparar', () => {
  const f = fotoSeguimiento({ ideal: { costos: 1, terc: 2, caja: 3, retiros: 4, extra: 9 }, ventas: 5, cobranza: 6, arrastreMes: [1, '2'], nuevoFacturar: 7 })
  assert.deepEqual(f.ideal, { costos: 1, terc: 2, caja: 3, retiros: 4 }); assert.deepEqual(f.arrastreMes, [1, 2])
  assert.equal(versionTraeSeguimiento({ resumen: { seg: f } }), true); assert.equal(versionTraeSeguimiento({ resumen: { base: {} } }), false); assert.equal(versionTraeSeguimiento(null), false)
})
