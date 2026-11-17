import test from 'node:test'
import assert from 'node:assert/strict'
import { comisionParcial, ajusteComision, planLiberarParcial } from '../supabase/functions/_shared/comisionesReglas.js'

// Caso anonimizado: factura de $956.201 con $585.996 cobrados; comisión total $812.771 (85 %), de la cual $85.996 ya se pagó como anticipo.
const b = { id: 'b1', status: 'Vencido', amount: 956201, paid_amount: 585996 }
const filas = [
  { id: 'a', billing_id: 'b1', proveedor_id: 'p1', monto: 85996, estado: 'pagado', naturaleza: 'comision' },
  { id: 'c', billing_id: 'b1', proveedor_id: 'p1', monto: 726775, estado: 'pendiente', naturaleza: 'comision' },
]
test('lo liberable es la comisión sobre lo cobrado, menos lo ya pagado', () => {
  const r = comisionParcial(filas, b, 956201)
  assert.equal(r.total, 812771); assert.equal(Math.round(r.pct * 10) / 10, 85); assert.equal(r.devengado, 498097)
  assert.equal(r.liberable, 412101)
  assert.equal(r.pendiente - r.liberable, 314674)
  assert.equal(r.pagado + r.liberable + (r.pendiente - r.liberable), r.total)   // las partes suman la comisión
})
test('no aplica a factura pagada, sin abono, anticipada o sin comisiones', () => {
  assert.equal(comisionParcial(filas, { ...b, status: 'Pagado' }, 956201), null)
  assert.equal(comisionParcial(filas, { ...b, paid_amount: 0 }, 956201), null)
  assert.equal(comisionParcial(filas, { ...b, status: 'Anticipada' }, 956201), null)
  assert.equal(comisionParcial([], b, 956201), null)
  assert.equal(comisionParcial(filas, b, 0), null)
})
test('no mezcla externos, boletas ni servicios complementarios', () => {
  const extra = [...filas, { id: 'x', billing_id: 'b1', monto: 1e6, estado: 'pendiente', comision_pct: 15 }, { id: 'y', billing_id: 'b1', monto: 1e6, estado: 'pendiente', liquido: 800000 }, { id: 'z', billing_id: 'b1', monto: 1e6, estado: 'pendiente', naturaleza: 'complementario' }]
  assert.equal(comisionParcial(extra, b, 956201).liberable, 412101)
})
test('lo ya puesto por pagar se descuenta; el tope es lo pendiente', () => {
  const ya = [filas[0], { id: 'd', billing_id: 'b1', monto: 400000, estado: 'por_pagar', naturaleza: 'comision' }, { ...filas[1], monto: 326775 }]
  assert.equal(comisionParcial(ya, b, 956201).liberable, 12101)
  assert.equal(comisionParcial(filas, { ...b, paid_amount: 950000 }, 956201).liberable, 721504)   // casi todo cobrado: casi toda la comisión
})
test('cobrado mayor que la factura no libera de más', () => {
  assert.equal(comisionParcial(filas, { ...b, paid_amount: 2e6 }, 956201).liberable, 726775)
})
test('ajustar comisión: nuevo monto de la fila pendiente, sin tocar lo pagado', () => {
  assert.deepEqual(ajusteComision(filas, b, 956201, 100), { id: 'c', monto: 870205 })
  assert.deepEqual(ajusteComision(filas, b, 956201, 85), { id: 'c', monto: 726775 })
  const r = comisionParcial(filas.map(t => t.id === 'c' ? { ...t, monto: 870205 } : t), b, 956201)
  assert.equal(r.total, 956201); assert.equal(r.liberable, 500000)
})
test('ajustar comisión: errores claros', () => {
  assert.ok(ajusteComision(filas, b, 956201, 120).error)
  assert.ok(ajusteComision(filas, b, 956201, -1).error)
  assert.ok(ajusteComision(filas, b, 956201, 5).error)                       // bajo lo ya pagado
  assert.ok(ajusteComision([filas[0]], b, 956201, 85).error)                 // sin pendiente
  assert.ok(ajusteComision([...filas, { ...filas[1], id: 'c2' }], b, 956201, 85).error)   // dos pendientes
})
test('pasar a por pagar: entera o partida', () => {
  assert.deepEqual(planLiberarParcial(filas[1], 412101), { id: 'c', completa: false, liberar: 412101, resto: 314674 })
  assert.deepEqual(planLiberarParcial(filas[1], 726775), { id: 'c', completa: true, liberar: 726775, resto: 0 })
  assert.equal(planLiberarParcial(filas[1], 0), null); assert.equal(planLiberarParcial(filas[0], 100), null)
})
