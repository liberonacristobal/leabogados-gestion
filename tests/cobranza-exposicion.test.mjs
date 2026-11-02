import test from 'node:test'
import assert from 'node:assert/strict'
import { enFiltroMora, estadoCompromiso, exposicionCartera, puntualidadCliente, puntualidadPorCliente, tramoMora } from '../supabase/functions/_shared/cobranzaExposicion.js'

test('tramo de antigüedad: al día, 1-30, 31-60, 61-90 y más de 90', () => {
  assert.deepEqual([-17, 0, 1, 30, 31, 60, 61, 90, 91, 374].map(tramoMora), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4])
  assert.equal(tramoMora(null), 0)
  assert.equal(enFiltroMora(null, 5), true)
  assert.equal(enFiltroMora('m60', 61), true); assert.equal(enFiltroMora('m60', 60), false)
  assert.equal(enFiltroMora(3, 75), true); assert.equal(enFiltroMora(3, 20), false)
})

test('foto de la cartera: tramos suman el total; más de 60 días, mayor deudor y tres mayores sobre el total por cobrar', () => {
  const filas = [
    { cid: 'A', saldo: 1000, mora: 200 }, { cid: 'A', saldo: 500, mora: 70 }, { cid: 'B', saldo: 300, mora: 10 },
    { cid: 'C', saldo: 200, mora: -5 }, { cid: 'D', saldo: 100, mora: 45 }, { cid: 'E', saldo: 0, mora: 300 }, { cid: 'F', saldo: -50, mora: 300 },
  ]
  const r = exposicionCartera(filas)
  assert.equal(r.total, 2100)
  assert.equal(r.tramos.reduce((a, t) => a + t.saldo, 0), r.total)                 // los tramos suman el total
  assert.deepEqual(r.tramos.map(t => t.n), [1, 1, 1, 1, 1])
  assert.equal(r.m60, 1500)
  assert.equal(Math.round(r.pctM60 * 100), 71)
  assert.equal(r.mayor.cid, 'A'); assert.equal(Math.round(r.mayor.pct * 100), 71)   // 1500 de 2100: la deuda TOTAL del cliente
  assert.equal(Math.round(r.top3pct * 100), 95)                                       // A + B + C = 2000
  assert.equal(r.tramos[4].clientes, 1)
})

test('cartera vacía: sin NaN ni división por cero', () => {
  const r = exposicionCartera([])
  assert.equal(r.total, 0); assert.equal(r.pctM60, null); assert.equal(r.mayor, null); assert.equal(r.top3pct, null)
  assert.equal(exposicionCartera(null).total, 0)
})

test('puntualidad: umbrales de la etiqueta', () => {
  assert.equal(puntualidadCliente([]).etiqueta, 'Sin pagos registrados')
  assert.equal(puntualidadCliente([{ dias: 5 }, { dias: 9 }]).etiqueta, 'Historial corto')
  assert.equal(puntualidadCliente([{ dias: 5 }, { dias: 9 }, { dias: 20 }, { dias: 25 }, { dias: 60 }]).etiqueta, 'Paga a tiempo')   // 4 de 5 = 80%
  assert.equal(puntualidadCliente([{ dias: 5 }, { dias: 9 }, { dias: 40 }, { dias: 50 }]).etiqueta, 'Se atrasa')                      // 50%
  assert.equal(puntualidadCliente([{ dias: 40 }, { dias: 50 }, { dias: 70 }, { dias: 5 }]).etiqueta, 'Atraso habitual')              // 25%
  const p = puntualidadCliente([{ dias: 10 }, { dias: 20 }, { dias: 90 }])
  assert.deepEqual([p.n, p.promedio, p.mediana, p.pct30], [3, 40, 20, 67])
})

test('puntualidad por cliente: solo pagos reales de los últimos 12 meses', () => {
  const b = (id, c, emi, pag, extra) => ({ id, client_id: c, invoice_no: id, status: 'Pagado', issued_at: emi, paid_at: pag, ...extra })
  const billing = [
    b('1', 'A', '2026-06-01', '2026-06-11'), b('2', 'A', '2026-07-01', '2026-07-21'), b('3', 'A', '2026-08-01', '2026-08-25'),
    b('4', 'A', '2026-09-01', '2026-08-30'),                                    // pagada antes de la emisión (anticipo): no cuenta
    b('5', 'A', '2026-09-01', '2026-09-10', { prepaid_anticipo_id: 'x' }),      // cubierta por anticipo: no cuenta
    b('6', 'A', '2026-09-01', '2026-09-10', { billing_type: 'reembolso' }),     // reembolso: no cuenta
    b('7', 'A', '2024-01-01', '2024-03-01'),                                    // fuera de la ventana
    b('8', 'A', '2026-09-01', null),                                            // sin fecha de pago
    { ...b('9', 'A', '2026-09-01', '2026-09-05'), status: 'Pendiente' },
    b('10', 'B', '2026-06-01', '2026-06-04', { deleted_at: '2026-07-01' }),
  ]
  const m = puntualidadPorCliente(billing, '2026-11-02')
  assert.equal(m.get('A').n, 3); assert.equal(m.get('A').pct30, 100); assert.equal(m.get('A').etiqueta, 'Paga a tiempo')
  assert.equal(m.has('B'), false)
})

test('compromiso de pago: vigente hasta su fecha; incumplido solo si sigue la deuda vencida', () => {
  assert.equal(estadoCompromiso(null, '2026-11-02', 100), null)
  assert.equal(estadoCompromiso({ fecha: '2026-12-15' }, '2026-11-02', 100), 'vigente')
  assert.equal(estadoCompromiso({ fecha: '2026-11-02' }, '2026-11-02', 100), 'vigente')
  assert.equal(estadoCompromiso({ fecha: '2026-10-30' }, '2026-11-02', 100), 'incumplido')
  assert.equal(estadoCompromiso({ fecha: '2026-10-30' }, '2026-11-02', 0), null)
})
