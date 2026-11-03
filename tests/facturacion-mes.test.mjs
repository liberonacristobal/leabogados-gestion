// Ciclo del mes de Facturación (cierre del mes anterior y pasos del ciclo): fuente única de Facturación y del Panel de socios. Casos sin nombres de clientes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cicloFacturacionMes } from '../supabase/functions/_shared/facturacionMes.js'

const now = new Date('2026-11-03T15:00:00Z')
const f = (id, extra) => ({ id, invoice_no: id, billing_type: 'honorarios', ...extra })

test('cierre del mes anterior: emitido, cobrado (pagado + abonos del banco) y tasa; no cuenta reembolsos, anuladas ni otros meses', () => {
  const billing = [
    f('1', { issued_at: '2026-10-05', amount: 1000, status: 'Pagado' }),
    f('2', { issued_at: '2026-10-20', amount: 2000, status: 'Pendiente' }),
    f('3', { issued_at: '2026-10-21', amount: 5000, status: 'Pendiente', billing_type: 'reembolso' }),
    f('4', { issued_at: '2026-10-22', amount: 7000, status: 'Anulada' }),
    f('5', { issued_at: '2026-09-30', amount: 9000, status: 'Pagado' }),
  ]
  const r = cicloFacturacionMes({ billing, now, respaldoMap: { '2': 500 } })
  assert.equal(r.cmK, '2026-10')
  assert.equal(r.tEmi, 3000)          // solo las facturas 1 y 2
  assert.equal(r.tCob, 1500)          // 1.000 pagada + 500 abonados en el banco a la 2
  assert.equal(r.tasa, 50)
  assert.deepEqual(r.cobPend.map(b => b.id), ['2'])   // queda por cobrar solo la 2
})

test('por enviar: emitida impaga con XML y sin envío; la enviada o sin XML no cuenta', () => {
  const xml = '<MntTotal>1200</MntTotal>'
  const billing = [
    f('10', { issued_at: '2026-11-02', amount: 1000, status: 'Pendiente', dte_xml: xml }),
    f('11', { issued_at: '2026-11-02', amount: 1000, status: 'Pendiente', dte_xml: xml, email_sent_at: '2026-11-02' }),
    f('12', { issued_at: '2026-11-02', amount: 1000, status: 'Pendiente' }),
  ]
  const r = cicloFacturacionMes({ billing, now })
  assert.deepEqual(r.porEnviar.map(b => b.id), ['10'])
  assert.equal(r.porEnvTot, 1200)     // el monto sale del DTE, no del programado
})

test('listas vacías: todo en cero, sin errores ni NaN', () => {
  const r = cicloFacturacionMes({ now })
  assert.equal(r.tEmi, 0); assert.equal(r.tasa, 0); assert.equal(r.pemN, 0); assert.equal(r.sinEmitirN, 0); assert.equal(r.porEnvTot, 0)
})
