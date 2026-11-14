// Notas de crédito del SII sin registrar (supabase/functions/_shared/notasCredito.js). Casos reales anonimizados: sin nombres ni RUT verdaderos. Correr: npm test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ncPorRegistrar, ncAutoRegistrables } from '../supabase/functions/_shared/notasCredito.js'

const fac = (o = {}) => ({ id: 'f1', invoice_no: '520', status: 'Pagado', billing_type: 'honorarios', amount: 2054908, receptor_rut: '76.111.222-3', client_id: 'c1', ...o })
const nc = (o = {}) => ({ id: 'n1', folio: '13', tipo_dte: 61, fecha_emision: '2026-11-13', receptor_rut: '76111222-3', receptor_name: 'Cliente Uno SpA', monto: 2054908, doc_json: null, billing_id: null, ...o })

test('caso real: NC sin referencia, mismo RUT y monto exacto con un solo candidato → se propone (inferida)', () => {
  const r = ncPorRegistrar([nc()], [fac(), fac({ id: 'f2', invoice_no: '521', amount: 2465880, status: 'Pendiente' })])
  assert.equal(r.length, 1)
  assert.equal(r[0].fac.id, 'f1')
  assert.equal(r[0].inferido, true)
})

test('con la referencia del documento se identifica la factura aunque el monto no coincida, y no es inferida', () => {
  const r = ncPorRegistrar([nc({ monto: 1000000, doc_json: { detFolioDocRef: '520' } })], [fac()])
  assert.equal(r.length, 1)
  assert.equal(r[0].inferido, false)
})

test('dos facturas candidatas por RUT y monto: ambiguo, no se propone ninguna', () => {
  const r = ncPorRegistrar([nc()], [fac(), fac({ id: 'f3', invoice_no: '530' })])
  assert.deepEqual(r, [])
})

test('ya enlazada al SII, ya registrada como NC, o la factura ya anulada: nada que resolver', () => {
  assert.deepEqual(ncPorRegistrar([nc({ billing_id: 'x' })], [fac()]), [])
  assert.deepEqual(ncPorRegistrar([nc()], [fac(), { id: 'n9', invoice_no: '13', billing_type: 'nota_credito', status: 'Anulada' }]), [])
  assert.deepEqual(ncPorRegistrar([nc()], [fac({ status: 'Anulada' })]), [])
})

test('solo documentos tipo 61; una factura borrada no cuenta; listas vacías o nulas no fallan', () => {
  assert.deepEqual(ncPorRegistrar([nc({ tipo_dte: 33 })], [fac()]), [])
  assert.deepEqual(ncPorRegistrar([nc()], [fac({ deleted_at: '2026-11-14' })]), [])
  assert.deepEqual(ncPorRegistrar(null, null), [])
  assert.deepEqual(ncPorRegistrar([], []), [])
})

test('auto-registrables: solo con referencia exacta y monto igual al peso; las inferidas siguen con compuerta humana', () => {
  const inferida = ncPorRegistrar([nc()], [fac()])
  assert.deepEqual(ncAutoRegistrables(inferida), [])
  const exacta = ncPorRegistrar([nc({ doc_json: { detFolioDocRef: '520' } })], [fac()])
  assert.equal(ncAutoRegistrables(exacta).length, 1)
  const parcial = ncPorRegistrar([nc({ monto: 1000000, doc_json: { detFolioDocRef: '520' } })], [fac()])
  assert.deepEqual(ncAutoRegistrables(parcial), [])
})
