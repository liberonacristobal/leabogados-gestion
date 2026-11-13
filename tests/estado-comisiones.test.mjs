import test from 'node:test'
import assert from 'node:assert/strict'
import { resumenReciente, armarEstadoComisiones, estadoComisionesHtml, pesos, dmy, mesTitulo } from '../supabase/functions/_shared/estadoComisiones.js'

const items = [
  { estado: 'pagada', cliente: 'A', concepto: 'F1', fecha: '2026-09-22', monto: 100 },
  { estado: 'pagada', cliente: 'B', concepto: 'F2', fecha: '2026-10-05', monto: 200 },
  { estado: 'pagada', cliente: 'C', concepto: 'F3', fecha: '2026-10-14', monto: 300 },
  { estado: 'por_pagar', cliente: 'D', concepto: 'F4', fecha: '2026-11-02', monto: 50, detalle: 'Cobrada 02-11-2026' },
  { estado: 'por_devengar', cliente: 'E', concepto: 'F5', monto: 70 },
]
test('meses de más nuevo a más antiguo y sumas', () => {
  const e = armarEstadoComisiones(items)
  assert.deepEqual(e.meses.map(m => m.ym), ['2026-10', '2026-09'])
  assert.equal(e.meses[0].total, 500)
  assert.equal(e.meses[0].filas[0].cliente, 'C')
  assert.deepEqual(e.totales, { pagado: 600, porPagar: 50, sujeto: 70 })
  assert.equal(e.desde, '2026-09-22'); assert.equal(e.hasta, '2026-10-14')
})
test('las partes suman el total', () => {
  const e = armarEstadoComisiones(items)
  assert.equal(e.meses.reduce((s, m) => s + m.total, 0), e.totales.pagado)
})
test('formatos', () => {
  assert.equal(pesos(1234567), '$1.234.567'); assert.equal(dmy('2026-11-13'), '13-11-2026'); assert.equal(mesTitulo('2026-10'), 'Octubre 2026')
})
test('html escapa y no falla sin pagos', () => {
  const h = estadoComisionesHtml({ proveedor: 'A <b>', items: [], emitido: '13-11-2026', marca: { nombre: 'X', logoUrl: '/l.png' }, auto: false })
  assert.ok(h.includes('A &lt;b&gt;') && h.includes('Sin pagos aún') && !h.includes('window.print'))
})

test('resumen reciente: últimas pagadas y por pagar, sin sujeto a cobro', () => {
  const r = resumenReciente(items, 2)
  assert.deepEqual(r.pagadas.map(i => i.cliente), ['C', 'B'])
  assert.equal(r.totalPagadas, 500); assert.equal(r.totalPorPagar, 50); assert.equal(r.porPagar.length, 1)
})
