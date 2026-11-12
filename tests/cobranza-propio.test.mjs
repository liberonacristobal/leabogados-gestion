// Ingreso propio de lo por cobrar: lo ajeno (venta de terceros y comisiones por pagar) sale del por cobrar. Datos anonimizados.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ajenoDeFactura, resumenPropio, nombreTercero } from './../supabase/functions/_shared/cobranzaPropio.js'

const ec = (/** @type {any} */ f) => { const r = ajenoDeFactura(f); return { ext: r.ext, com: r.com } }
const externo = { saldo: 1_000_000, monto: 1_000_000, terceros: [{ monto: 850_000, comision_pct: 15, estado: 'pendiente' }] }
const comision = { saldo: 2_000_000, monto: 2_000_000, terceros: [{ monto: 800_000, comision_pct: null, estado: 'pendiente' }] }

test('venta de terceros: el 85 % es ajeno; comisión por pagar: se resta; ya pagada al tercero no cuenta', () => {
  assert.deepEqual(ec(externo), { ext: 850_000, com: 0 })
  assert.deepEqual(ec(comision), { ext: 0, com: 800_000 })
  assert.deepEqual(ec({ ...comision, terceros: [{ monto: 800_000, comision_pct: null, estado: 'pagado' }] }), { ext: 0, com: 0 })
})
test('sin filas de terceros usa monto_terceros de la factura; sin nada, todo es propio', () => {
  assert.deepEqual(ec({ saldo: 500_000, monto: 500_000, terceros: [], montoTerceros: 425_000 }), { ext: 425_000, com: 0 })
  assert.deepEqual(ec({ saldo: 500_000, monto: 500_000 }), { ext: 0, com: 0 })
})
test('un abono baja lo ajeno en la misma proporción y nunca pasa del saldo; casos borde sin NaN', () => {
  assert.deepEqual(ec({ ...externo, saldo: 500_000 }), { ext: 425_000, com: 0 })
  const tope = ajenoDeFactura({ saldo: 100, monto: 100, terceros: [{ monto: 90, comision_pct: 10 }, { monto: 90, comision_pct: null }] })
  assert.ok(tope.ext + tope.com <= 100)
  for (const x of [null, undefined, {}, { saldo: 'x', monto: 0 }, { saldo: -5, monto: 10 }]) assert.deepEqual(ec(/** @type {any} */ (x)), { ext: 0, com: 0 })
})
test('el resumen suma al peso: propio = total − terceros − comisiones, en todo, vencido, más de 60 y por cliente', () => {
  const filas = [
    { cid: 'a', ...externo, mora: 70 },
    { cid: 'a', ...comision, mora: 10 },
    { cid: 'b', saldo: 300_000, monto: 300_000, mora: 0 },
    { cid: 'b', saldo: 0, monto: 100_000, mora: 90 },
  ]
  const r = resumenPropio(filas)
  assert.deepEqual(r.todo, { total: 3_300_000, ext: 850_000, com: 800_000, propio: 1_650_000, n: 3 })
  assert.deepEqual(r.venc, { total: 3_000_000, ext: 850_000, com: 800_000, propio: 1_350_000, n: 2 })
  assert.deepEqual(r.m60, { total: 1_000_000, ext: 850_000, com: 0, propio: 150_000, n: 1 })
  const a = r.porCliente.get('a'), b = r.porCliente.get('b')
  assert.equal(a?.todo.propio, 1_350_000); assert.equal(a?.venc.total, 3_000_000); assert.equal(b?.venc.n, 0)
  for (const g of [r.todo, r.venc, r.m60]) assert.equal(g.total - g.ext - g.com, g.propio)
  assert.equal(a?.facturas.length, 2); assert.equal(a?.facturas.reduce((x, y) => x + y.propio, 0), a?.todo.propio)   // el detalle por factura suma el total del cliente
  assert.deepEqual(resumenPropio(/** @type {any} */ (null)).todo, { total: 0, ext: 0, com: 0, propio: 0, n: 0 })
})
test('el reparto por tercero suma lo ajeno de la factura y usa el nombre corto', () => {
  const f = { saldo: 1_000_000, monto: 1_000_000, terceros: [{ monto: 600_000, comision_pct: 15, proveedor: 'ALFA ABOGADOS LIMITADA' }, { monto: 100_000, comision_pct: null, estado: 'pendiente', proveedor: 'Beta Asesorias SpA' }, { monto: 50_000, comision_pct: null, estado: 'pagado', proveedor: 'Gamma' }] }
  const r = ajenoDeFactura(f)
  assert.deepEqual([r.ext, r.com], [600_000, 100_000])
  assert.deepEqual(r.partes, [{ nombre: 'Alfa Abogados', monto: 600_000 }, { nombre: 'Beta Asesorias', monto: 100_000 }])
  assert.equal(r.partes.reduce((a, x) => a + x.monto, 0), r.ext + r.com)
  const mitad = ajenoDeFactura({ ...f, saldo: 500_001 })   // con abono, cada tercero baja en proporción y la suma sigue exacta
  assert.equal(mitad.partes.reduce((a, x) => a + x.monto, 0), mitad.ext + mitad.com)
  const x = resumenPropio([{ cid: 'a', saldo: 1_000_000, monto: 1_000_000, mora: 5, terceros: f.terceros }])
  assert.equal(x.terceros.get('Alfa Abogados')?.monto, 600_000); assert.equal(x.terceros.get('Beta Asesorias')?.venc, 100_000)
  assert.equal(nombreTercero('MJ ASESORÍAS LIMITADA'), 'MJ Asesorías'); assert.equal(nombreTercero(null), 'Tercero'); assert.equal(nombreTercero('BDA Abogados Limitada'), 'BDA Abogados')
  assert.deepEqual(ajenoDeFactura({ saldo: 500_000, monto: 500_000, montoTerceros: 425_000 }).partes, [{ nombre: 'Tercero', monto: 425_000 }])
})
