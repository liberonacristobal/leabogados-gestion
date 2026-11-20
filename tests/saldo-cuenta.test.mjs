import { test } from 'node:test'
import assert from 'node:assert/strict'
import { saldoActualCuenta } from '../supabase/functions/_shared/saldoCuenta.js'

// Caso real del 20-11-2026: la cartola del día se cargó a las 11:51 y tres traspasos internos del mismo día a las 12:13.
test('saldo actual: suma los movimientos posteriores, también los del día de corte cargados más tarde, y no repite los de la cartola', () => {
  const cartola = { saldo_final: 46915850, fecha_hasta: '2026-11-20', created_at: '2026-11-20T11:51:58Z' }
  const movs = [
    { tipo: 'abono', monto: 1657784, fecha: '2026-11-20', created_at: '2026-11-20T11:51:57Z' },   // ya está en el saldo de la cartola
    { tipo: 'cargo', monto: 727762, fecha: '2026-11-20', created_at: '2026-11-20T11:51:57Z' },    // ya está en el saldo de la cartola
    { tipo: 'abono', monto: 821471, fecha: '2026-11-20', created_at: '2026-11-20T12:13:33Z' },
    { tipo: 'abono', monto: 451809, fecha: '2026-11-20', created_at: '2026-11-20T12:13:33Z' },
    { tipo: 'abono', monto: 1753465, fecha: '2026-11-20', created_at: '2026-11-20T12:13:33Z' },
  ]
  const r = saldoActualCuenta(cartola, movs)
  assert.equal(r.saldo, 49942595); assert.equal(r.n, 3); assert.equal(r.al, '2026-11-20')
  // un cargo de un día posterior resta y mueve la fecha
  const r2 = saldoActualCuenta(cartola, [...movs, { tipo: 'cargo', monto: 100, fecha: '2026-11-21', created_at: '2026-11-21T09:00:00Z' }])
  assert.equal(r2.saldo, 49942495); assert.equal(r2.al, '2026-11-21')
  // sin movimientos, o sin cartola, no rompe
  assert.equal(saldoActualCuenta(cartola, []).saldo, 46915850)
  assert.equal(saldoActualCuenta({}, null).saldo, 0)
})
