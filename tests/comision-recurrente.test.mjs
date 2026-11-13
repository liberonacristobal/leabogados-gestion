import test from 'node:test'
import assert from 'node:assert/strict'
import { comisionRecurrenteFaltante, lineaDte } from '../supabase/functions/_shared/saludDatos.js'

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
