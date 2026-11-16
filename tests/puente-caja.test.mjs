// Puente del resultado devengado a la base de caja: dos medidas independientes por variación y su cuadre. Cifras sintéticas.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { puenteCaja } from './../supabase/functions/_shared/puenteCaja.js'
import { idpcDesdePuente } from './../supabase/functions/_shared/idpcEstimado.js'

test('las dos medidas coinciden: la base de caja es resultado + variación por cobrar + variación por pagar', () => {
  // Facturado 100 y cobrado 70: por cobrar sube 30 (con 10 iniciales cobradas y 40 nuevas por cobrar). Devengado 60, pagado 50: por pagar sube 10.
  const r = puenteCaja({ resultadoAntes: 40, facturado: 100, cobrado: 70, porCobrarIni: 20, porCobrarFin: 50, devengado: 60, pagado: 50, porPagarIni: 5, porPagarFin: 15 })
  assert.equal(r.varCxC, -30); assert.equal(r.varCxP, 10); assert.equal(r.base, 20)
  assert.equal(r.base, 70 - 50)                       // cobrado − pagado = caja
  assert.ok(r.cuadra && r.cxcComprobada && r.cxpComprobada)
})

test('si los saldos no calzan con los flujos, la diferencia queda a la vista y no cuadra', () => {
  const r = puenteCaja({ resultadoAntes: 40, facturado: 100, cobrado: 70, porCobrarIni: 20, porCobrarFin: 60, devengado: 60, pagado: 50, porPagarIni: 5, porPagarFin: 15 })
  assert.equal(r.difCxC, 10); assert.equal(r.cuadra, false)
})

test('sin saldos no hay segunda medida, y sin datos no da NaN', () => {
  const r = puenteCaja({ resultadoAntes: 40, facturado: 100, cobrado: 70, devengado: 60, pagado: 50 })
  assert.equal(r.cxcComprobada, false); assert.equal(r.difCxC, 0)
  const v = puenteCaja({ resultadoAntes: null, facturado: undefined, cobrado: NaN, devengado: 'x', pagado: null })
  assert.ok(Object.values(v).every(x => typeof x === 'boolean' || Number.isFinite(x)))
})

test('IDPC desde la base de caja al corte con proyección moderada de dos meses', () => {
  const r = idpcDesdePuente({ baseAlCorte: 127_600_000, mesesRestantes: 2, cobradoMes: [5, 10, 20, 20, 20, 20, 20, 20].map(x => x * 1_000_000), pagadoUltimoMes: 14_000_000, ppmPagado: 2_400_000, ppmUltimoMes: 200_000 })
  assert.equal(r.proyeccion, Math.round((20_000_000 - 14_000_000) * 2))   // promedio de los últimos 6 meses (20 M) menos gasto del último mes, por 2
  assert.equal(r.baseAnio, 127_600_000 + 12_000_000)
  assert.equal(r.idpc, Math.round(r.baseAfecta * 0.125)); assert.equal(r.saldo, r.idpc - (2_400_000 + 400_000))
})
