// «Factura más antigua sin pago» al conciliar: solo cuentan las anteriores del mismo pagador; reembolsos y notas de crédito no. Datos anonimizados.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { facturasMasAntiguasSinPago } from './../supabase/functions/_shared/conciliacionReglas.js'

const F = (id, issued_at, invoice_no, billing_type = 'honorarios') => ({ id, issued_at, invoice_no, billing_type })
test('la elegida es la más antigua: no hay anteriores', () => {
  assert.deepEqual(facturasMasAntiguasSinPago(F('a', '2026-11-02', '493'), [F('a', '2026-11-02', '493'), F('b', '2026-12-01', '510')]), [])
})
test('hay anteriores: salen de la más antigua a la más nueva, sin contar la elegida', () => {
  const r = facturasMasAntiguasSinPago(F('a', '2026-11-02', '493'), [F('c', '2026-10-05', '482'), F('a', '2026-11-02', '493'), F('b', '2026-09-02', '471')])
  assert.deepEqual(r.map(x => x.id), ['b', 'c'])
})
test('mismo día: decide el folio; reembolsos y notas de crédito no cuentan; sin fecha no hay comparación', () => {
  assert.deepEqual(facturasMasAntiguasSinPago(F('a', '2026-11-02', '493'), [F('x', '2026-11-02', '490'), F('y', '2026-11-02', '495')]).map(x => x.id), ['x'])
  assert.deepEqual(facturasMasAntiguasSinPago(F('a', '2026-11-02', '493'), [F('r', '2026-09-01', '400', 'reembolso'), F('n', '2026-09-01', '401', 'nota_credito')]), [])
  assert.deepEqual(facturasMasAntiguasSinPago(F('a', null, '493'), [F('b', '2026-09-01', '400')]), [])
})
