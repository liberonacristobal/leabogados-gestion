import test from 'node:test'
import assert from 'node:assert/strict'
import { comisionRecurrenteFaltante, lineaDte, comisionPorReparto, comisionesPorRegistrar } from '../supabase/functions/_shared/saludDatos.js'

// Caso real anonimizado (octubre 2026): factura mensual con dos líneas; la laboral (12,5 UF) es 85 % de un colaborador y no tenía su fila.
const xml = (a, b) => `<Detalle><NmbItem>Ases permanente oct 26</NmbItem><MontoItem>${a}</MontoItem></Detalle><Detalle><NmbItem>Ases laboral oct</NmbItem><MontoItem>${b}</MontoItem></Detalle>`
const venta = { id: 's1', cobro_config: { comisionRecurrente: { proveedor_id: 'p1', pct: 85, linea: 'laboral', desde: '2026-04-01' } } }
const fac = (o = {}) => ({ id: 'b1', sale_id: 's1', invoice_no: '495', status: 'Pagado', issued_at: '2026-11-02', dte_xml: xml(1237740, 515725), ...o })

test('línea del DTE', () => { assert.deepEqual(lineaDte(xml(1, 515725), 'laboral'), { nombre: 'Ases laboral oct', monto: 515725 }); assert.equal(lineaDte(xml(1, 2), 'inexistente'), null) })
test('factura pagada sin fila: propone el 85 % de la línea, por pagar', () => {
  const r = comisionRecurrenteFaltante([fac()], [], [venta])
  assert.equal(r.length, 1); assert.equal(r[0].monto, 438366); assert.equal(r[0].estado, 'por_pagar'); assert.equal(r[0].base, 515725)
})
test('no propone: ya tiene su fila, anterior a «desde», sin línea, anulada o de otra venta', () => {
  assert.equal(comisionRecurrenteFaltante([fac()], [{ billing_id: 'b1', proveedor_id: 'p1' }], [venta]).length, 0)
  assert.equal(comisionRecurrenteFaltante([fac({ issued_at: '2026-03-01' })], [], [venta]).length, 0)
  assert.equal(comisionRecurrenteFaltante([fac({ dte_xml: '<Detalle><NmbItem>Ases permanente</NmbItem><MontoItem>9</MontoItem></Detalle>' })], [], [venta]).length, 0)
  assert.equal(comisionRecurrenteFaltante([fac({ status: 'Anulada' })], [], [venta]).length, 0)
  assert.equal(comisionRecurrenteFaltante([fac({ sale_id: 'otra' })], [], [venta]).length, 0)
  assert.equal(comisionRecurrenteFaltante([fac({ status: 'Pendiente' })], [], [venta])[0].estado, 'pendiente')
})

// Reparto de la venta (formulario «Reparto a proveedores»): la fila con tipo_costo 'pct' es el acuerdo; la factura emitida sin su fila se propone.
const vta = { id: 's2' }
const fila = (o = {}) => ({ id: 'r1', sale_id: 's2', proveedor_id: 'p1', proveedor: 'BDA', tipo_costo: 'pct', valor: 85, billing_id: 'b0', created_at: '2026-10-01', ...o })
const fac2 = (o = {}) => ({ id: 'b1', sale_id: 's2', invoice_no: '502', status: 'Pendiente', billing_type: 'honorarios', issued_at: '2026-11-02', due: '2026-11-30', amount: 1444030, ...o })
const antes = { id: 'b0', sale_id: 's2', invoice_no: '482', status: 'Pagado', issued_at: '2026-10-02', due: '2026-10-30', amount: 1232190 }

test('reparto: factura emitida de la venta sin fila del colaborador → propone su % (sujeta a cobro si está pendiente)', () => {
  const r = comisionPorReparto([antes, fac2()], [fila()], [vta])
  assert.equal(r.length, 1); assert.equal(r[0].monto, 1227426); assert.equal(r[0].estado, 'pendiente'); assert.equal(r[0].tipo_costo, 'pct')
  assert.equal(comisionPorReparto([antes, fac2({ status: 'Pagado' })], [fila()], [vta])[0].estado, 'por_pagar')
})
test('reparto: no propone si ya tiene fila del colaborador, si es anterior a la 1ª comisión, omitida, reembolso o venta borrada', () => {
  assert.equal(comisionPorReparto([antes, fac2()], [fila(), fila({ id: 'r2', billing_id: 'b1' })], [vta]).length, 0)
  assert.equal(comisionPorReparto([antes, fac2({ due: '2026-09-01', issued_at: '2026-09-01' })], [fila()], [vta]).length, 0)
  assert.equal(comisionPorReparto([antes, fac2()], [fila()], [vta], new Set(['b1|p1'])).length, 0)
  assert.equal(comisionPorReparto([antes, fac2({ billing_type: 'reembolso' })], [fila()], [vta]).length, 0)
  assert.equal(comisionPorReparto([antes, fac2()], [fila()], [{ id: 's2', deleted_at: 'x' }]).length, 0)
})
test('reparto + línea juntos, sin duplicar la misma factura del mismo colaborador', () => {
  const todo = comisionesPorRegistrar([fac(), fac2()], [fila()], [venta, vta])
  assert.equal(todo.filter(x => x.origen === 'linea').length, 1); assert.equal(todo.filter(x => x.origen === 'reparto').length, 1)
})
