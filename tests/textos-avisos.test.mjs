import test from 'node:test'
import assert from 'node:assert/strict'
import { avisoTarifa, avisoComision, confirmaComision, ufTxt } from '../supabase/functions/_shared/textosAvisos.js'

const factura = { invoice_no: 'Factura 495' }
test('UF con coma y hasta dos decimales', () => { assert.equal(ufTxt(42.5), '42,5'); assert.equal(ufTxt(30), '30'); assert.equal(ufTxt(10.625), '10,63') })
test('aviso de tarifa, en UF y en pesos', () => {
  assert.equal(avisoTarifa({ factura, mensual: 30, factura_en: 42.5, enUF: true }), 'Factura N° 495: 42,5 UF, la venta dice 30 UF al mes')
  assert.equal(avisoTarifa({ factura, mensual: 1000000, factura_en: 1753465, enUF: false }), 'Factura N° 495: $1.753.465, la venta dice $1.000.000 al mes')
})
test('aviso y confirmación de comisión, sin punto medio', () => {
  const x = { factura: { invoice_no: '515' }, proveedor: 'BDA Abogados Limitada', monto: 52607 }
  assert.equal(avisoComision(x), 'Factura N° 515: falta la comisión de BDA Abogados Limitada, $52.607')
  assert.equal(confirmaComision(x), '¿Registrar la comisión de $52.607 a BDA Abogados Limitada en la factura N° 515?')
  assert.ok(![avisoTarifa({ factura, mensual: 1, factura_en: 2, enUF: true }), avisoComision(x), confirmaComision(x)].some(t => t.includes('·')))
})
