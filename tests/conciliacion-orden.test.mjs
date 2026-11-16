// Orden cronológico de las conciliaciones manuales: facturas de igual monto, la más antigua primero. Cifras anonimizadas.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { facturaMasAntiguaIgual } from './../supabase/functions/_shared/conciliacionOrden.js'

const saldos = { a: 107_310, b: 107_310, c: 107_310, d: 250_000, e: 0 }
const saldoDe = (f) => saldos[f.id] ?? 0
const F = (id, issued_at, extra = {}) => ({ id, issued_at, status: 'Pendiente', ...extra })

test('propone la factura más antigua del mismo monto cuando se eligió una más nueva', () => {
  const pool = [F('a', '2025-12-01'), F('b', '2026-01-05'), F('c', '2026-02-02')]
  assert.equal(facturaMasAntiguaIgual({ facturas: pool, elegida: pool[1], saldoDe }).id, 'a')
  assert.equal(facturaMasAntiguaIgual({ facturas: pool, elegida: pool[2], saldoDe }).id, 'a')   // la más antigua de todas, no la intermedia
})

test('no propone nada si la elegida ya es la más antigua, o si el monto o el estado no calzan', () => {
  const pool = [F('a', '2025-12-01'), F('b', '2026-01-05'), F('d', '2025-11-01'), F('e', '2025-10-01'), F('c', '2025-09-01', { status: 'Anulada' })]
  assert.equal(facturaMasAntiguaIgual({ facturas: pool, elegida: pool[0], saldoDe }), null)       // a: no hay más antigua válida del mismo monto (la d es de otro monto, la e está pagada, la c anulada)
  assert.equal(facturaMasAntiguaIgual({ facturas: pool, elegida: pool[2], saldoDe }), null)       // d: otro monto
})

test('sin fecha, sin saldo o sin pool no da error', () => {
  assert.equal(facturaMasAntiguaIgual({ facturas: [], elegida: F('a', '2025-12-01'), saldoDe }), null)
  assert.equal(facturaMasAntiguaIgual({ facturas: [F('b', '2026-01-05')], elegida: { id: 'a' }, saldoDe }), null)
  assert.equal(facturaMasAntiguaIgual({ facturas: [F('b', '2026-01-05')], elegida: F('e', '2026-03-01'), saldoDe }), null)
})
