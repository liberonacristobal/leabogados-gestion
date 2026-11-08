// Liquidaciones: a quién corresponde un pago de sueldo y cómo se proyecta el presupuesto por persona. Cifras y nombres ficticios.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { liquidoDe, mismaPersona, personaDelPago, presupuestoDesdeLiquidaciones } from '../supabase/functions/_shared/liquidacionesReglas.js'

const LIQ = [
  { persona: 'PEREZ GOMEZ ANA MARIA', imponible: 4000000, cotizaciones: 700000, impuesto_unico: 100000 },
  { persona: 'SOTO RIOS LUIS', imponible: 4000000, cotizaciones: 700000, impuesto_unico: 100000 },
  { persona: 'DIAZ MORA PEDRO', imponible: 2000000, cotizaciones: 360000, impuesto_unico: 30000 },
]
const PPTO = [{ item: 'Ana Pérez', monto: 2300000 }, { item: 'Luis Soto', monto: 2200000 }, { item: 'Pedro Díaz', monto: 1700000 }, { item: 'Rosa Vega (procuradora)', monto: 500000 }]

test('líquido y nombre: el corto está dentro del largo, sin tildes', () => {
  assert.equal(liquidoDe(LIQ[2]), 1610000)
  assert.ok(mismaPersona('Ana Pérez', 'PEREZ GOMEZ ANA MARIA')); assert.ok(mismaPersona('Pedro Díaz', 'DIAZ MORA PEDRO'))
  assert.ok(!mismaPersona('Rosa Vega', 'DIAZ MORA PEDRO')); assert.ok(!mismaPersona('', 'X'))
})

test('líquido: manda el «líquido a pagar» del PDF (con salud adicional); sin él se calcula', () => {
  assert.equal(liquidoDe({ ...LIQ[2], liquido: 1590000 }), 1590000)
  assert.equal(liquidoDe({ ...LIQ[2], liquido: null }), 1610000)
  assert.equal(personaDelPago({ amount: 1590000, concept: 'a Ped' }, [{ ...LIQ[2], liquido: 1590000 }], []), 'DIAZ MORA PEDRO')
})

test('presupuesto: una línea ya fechada en el mes sigue al líquido exacto aunque la diferencia sea menor a 2 %', () => {
  const l = [{ persona: 'SOTO RIOS LUIS', imponible: 4000000, cotizaciones: 700000, impuesto_unico: 100000, liquido: 3180000 }]
  const f = [{ id: 'a', categoria: 'Remuneraciones', item: 'Luis Soto', monto: 3200000, monto_prev: 2200000, desde: '2026-10-01' }]
  const r = presupuestoDesdeLiquidaciones({ periodo: '2026-10', liquidaciones: l, tasaEmpleador: null, filas: f })
  assert.equal(r[0].monto, 3180000); assert.equal(r[0].monto_prev, 2200000)
  assert.deepEqual(presupuestoDesdeLiquidaciones({ periodo: '2026-10', liquidaciones: l, tasaEmpleador: null, filas: [{ ...f[0], monto: 3180000 }] }), [])   // ya igual: no repite
})

test('pago de sueldo: por líquido exacto único, o por sueldo presupuestado único con destino compatible; si no, no se asigna', () => {
  assert.equal(personaDelPago({ amount: 1610000, concept: 'Transferencia ... a Ped' }, LIQ, PPTO), 'DIAZ MORA PEDRO')
  assert.equal(personaDelPago({ amount: 500000, concept: 'Transferencia ... Banco X a Ros' }, LIQ, PPTO), 'Rosa Vega (procuradora)')
  assert.equal(personaDelPago({ amount: 500000, concept: 'Transferencia de X Rut 1-9 desde Banco Y a Rosa Maria Vega Perez Rut 2-7 a' }, LIQ, PPTO), 'Rosa Vega (procuradora)')   // destinatario completo
  assert.equal(personaDelPago({ amount: 500000, concept: 'Transferencia ... a Zoe' }, LIQ, PPTO), null)    // destino incompatible
  assert.equal(personaDelPago({ amount: 3200000, concept: 'a Ana' }, LIQ, PPTO), null)                      // dos liquidaciones con el mismo líquido: ambiguo
  assert.equal(personaDelPago({ amount: 3150000, concept: 'a Luis' }, LIQ, PPTO), null)                     // no coincide con nada
})

test('presupuesto desde las liquidaciones: líquido y cotización más parte del empleador, con vigencia del mes y lo anterior en monto_prev', () => {
  const filas = [
    { id: 'a', categoria: 'Remuneraciones', item: 'Luis Soto', monto: 2200000, monto_prev: null, desde: null },
    { id: 'b', categoria: 'Leyes sociales', item: 'Luis Soto', monto: 650000, monto_prev: null, desde: null },
    { id: 'c', categoria: 'Remuneraciones', item: 'Pedro Díaz', monto: 1600000, monto_prev: null, desde: null },
    { id: 'd', categoria: 'Remuneraciones', item: 'Contadora', monto: 65000, monto_prev: null, desde: null },
    { id: 'e', categoria: 'Leyes sociales', item: 'Procurador', monto: 81000, monto_prev: 0, desde: '2026-03-01' },
  ]
  const r = presupuestoDesdeLiquidaciones({ periodo: '2026-10', liquidaciones: LIQ, tasaEmpleador: 0.07, filas })
  assert.deepEqual(r.map(x => x.id).sort(), ['a', 'b'])                         // Pedro (+0,6 %) y las filas sin liquidación no cambian
  const a = r.find(x => x.id === 'a'), b = r.find(x => x.id === 'b')
  assert.equal(a.monto, 3200000); assert.equal(a.monto_prev, 2200000); assert.equal(a.desde, '2026-10-01')
  assert.equal(b.monto, 980000); assert.equal(b.monto_prev, 650000)             // 700.000 + 7 % de 4.000.000
})

test('presupuesto: sin tasa del empleador no toca Leyes sociales; repetir el mismo mes conserva el valor anterior; un historial previo no se pisa', () => {
  const f = [{ id: 'b', categoria: 'Leyes sociales', item: 'Luis Soto', monto: 650000, monto_prev: null, desde: null }]
  assert.deepEqual(presupuestoDesdeLiquidaciones({ periodo: '2026-10', liquidaciones: LIQ, tasaEmpleador: null, filas: f }), [])
  const ya = [{ id: 'a', categoria: 'Remuneraciones', item: 'Luis Soto', monto: 3000000, monto_prev: 2200000, desde: '2026-10-01' }]
  assert.equal(presupuestoDesdeLiquidaciones({ periodo: '2026-10', liquidaciones: LIQ, tasaEmpleador: 0.07, filas: ya })[0].monto_prev, 2200000)
  const viejo = [{ id: 'a', categoria: 'Remuneraciones', item: 'Luis Soto', monto: 2200000, monto_prev: 2000000, desde: '2026-03-01' }]
  assert.deepEqual(presupuestoDesdeLiquidaciones({ periodo: '2026-10', liquidaciones: LIQ, tasaEmpleador: 0.07, filas: viejo }), [])
})
