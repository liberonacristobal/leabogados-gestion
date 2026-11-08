// Foto mensual de cartera y por pagar: mismas reglas que la app. Casos sin nombres de clientes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { respaldoPorFactura, saldoFactura, venceFactura, diasMora, fotoCartera, fotoComisiones, fotoFondos, construirFoto, leerFoto, filasFoto, resumenFoto } from '../supabase/functions/_shared/fotoMes.js'

const F = (id, o = {}) => ({ id, client_id: 'c1', invoice_no: String(id), status: 'Pendiente', amount: 1000000, issued_at: '2026-08-01', billing_type: 'honorarios', ...o })

test('vencimiento: emisión + 30 días; sin emisión, el programado', () => {
  assert.equal(venceFactura(F(1)), '2026-08-31'); assert.equal(venceFactura({ due: '2026-09-15' }), '2026-09-15')
  assert.equal(diasMora(F(1), '2026-11-01'), 62); assert.equal(diasMora(F(1), '2026-08-20'), -11)
})

test('saldo: el mayor entre paid_amount y lo conciliado; pagada y anulada en cero', () => {
  const r = respaldoPorFactura([{ tipo_destino: 'factura', factura_id: 1, monto_aplicado: '300000' }], [])
  assert.equal(saldoFactura(F(1), r), 700000); assert.equal(saldoFactura(F(1, { paid_amount: 500000 }), r), 500000)
  assert.equal(saldoFactura(F(1, { status: 'Pagado' }), r), 0); assert.equal(saldoFactura(F(1, { status: 'Anulada' }), r), 0)
})

test('respaldo: un anticipo consumido solo cuenta si tiene respaldo bancario', () => {
  const ant = [{ id: 'a1', estado: 'consumido', billing_id: 1, monto: '400000' }, { id: 'a2', estado: 'consumido', billing_id: 2, monto: '100000' }]
  const r = respaldoPorFactura([{ tipo_destino: 'anticipo', anticipo_id: 'a1' }], ant)
  assert.equal(r[1], 400000); assert.equal(r[2], undefined)
})

test('cartera: excluye reembolsos, notas de crédito, borradas y sin folio; vencido y +60 días a la fecha', () => {
  const billing = [
    F(1), F(2, { issued_at: '2026-10-20' }), F(3, { billing_type: 'reembolso' }), F(4, { billing_type: 'nota_credito' }),
    F(5, { deleted_at: '2026-09-01' }), F(6, { invoice_no: null }), F(7, { status: 'Pagado' }), F(8, { client_id: 'c2', issued_at: '2026-05-01', amount: 500000 }),
  ]
  const c = fotoCartera({ billing, conciliacion: [], anticipos: [], asOf: '2026-11-03' })
  assert.equal(c.porCobrar, 2500000); assert.equal(c.nFacturas, 3); assert.equal(c.nClientes, 2)
  assert.equal(c.vencido, 1500000); assert.equal(c.nVencidas, 2); assert.equal(c.m60, 1500000)
  assert.equal(c.tramos.reduce((a, t) => a + t.saldo, 0), c.porCobrar)
})

test('comisiones: solo por pagar; ignora las de facturas anuladas o inexistentes', () => {
  const billing = [{ id: 1, status: 'Pagado' }, { id: 2, status: 'Pendiente' }, { id: 3, status: 'Anulada' }]
  const terceros = [{ billing_id: 1, monto: 100, estado: 'pendiente' }, { billing_id: 2, monto: 50, estado: 'pendiente' }, { billing_id: 3, monto: 70, estado: 'por_pagar' }, { billing_id: 9, monto: 20 }, { billing_id: 1, monto: 30, estado: 'pagado' }, { monto: 10, estado: 'por_pagar' }]
  assert.deepEqual(fotoComisiones({ terceros, billing }), { porPagar: 110, n: 2 })
})

test('fondos: solo lo que los clientes deben reponer, sin clientes internos ni histórico saldado', () => {
  const expenses = [
    { client_id: 'c1', type: 'gasto', amount: 300000 }, { client_id: 'c1', type: 'fondo', amount: 100000 },
    { client_id: 'c2', type: 'fondo', amount: 500000 }, { client_id: 'c3', type: 'gasto', amount: 900000, no_descuenta_saldo: true },
    { client_id: 'c4', type: 'gasto', amount: 50000 }, { client_id: 'c1', type: 'gasto', amount: 999000, apertura_id: 'x' },
    { client_id: 'c5', type: 'gasto', amount: 500 },                                   // residuo bajo $1.000: no cuenta como deuda (UMBRAL_DEUDA)
  ]
  const clients = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }, { id: 'c4', is_internal: true }, { id: 'c5' }]
  assert.deepEqual(fotoFondos({ expenses, clients }), { porReponer: 200000, nDeben: 1 })
})

test('foto completa, lectura y comparación', () => {
  const base = { billing: [F(1)], conciliacion: [], anticipos: [], terceros: [], expenses: [], clients: [] }
  const a = construirFoto({ per: '2026-09', capturada: '2026-10-01', ...base })
  const b = construirFoto({ per: '2026-10', capturada: '2026-11-01', ...base, billing: [F(1, { paid_amount: 400000 })] })
  assert.equal(leerFoto(JSON.stringify(a)).per, '2026-09'); assert.equal(leerFoto('no es json'), null); assert.equal(leerFoto('{"per":"x"}'), null)
  const f = filasFoto(b, a), v = f.find(x => x.k === 'porCobrar')
  assert.equal(v.abs, -400000); assert.ok(Math.abs(v.pct + 0.4) < 1e-9); assert.equal(v.tono, 'up'); assert.deepEqual(filasFoto(null, a), [])
  const sola = filasFoto(b, null).find(x => x.k === 'porCobrar'); assert.equal(sola.p, null); assert.equal(sola.tono, 'nt')
  const r = resumenFoto(b, a, n => `$${n}`); assert.equal(r.fechaFoto, '01-11-2026'); assert.equal(r.filas[0].variacion, '−40%'); assert.equal(resumenFoto(null, a, String), null)
})
