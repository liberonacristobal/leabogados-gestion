import test from 'node:test'
import assert from 'node:assert/strict'
import { carpetaFacturacion, nombrePdf, proximoIntentoMs, planPdfOficial, HORAS_REINTENTO } from '../supabase/functions/_shared/pdfOficialReglas.js'

const H = 3600 * 1000
const f = (id, no, extra = {}) => ({ id, invoice_no: no, status: 'Pendiente', issued_at: '2026-11-04', deleted_at: null, ...extra })

test('carpeta del PDF: el mes vencido; enero cae en diciembre del año anterior', () => {
  assert.deepEqual(carpetaFacturacion('2026-09-15'), { anio: 'Facturación 2026', mes: '08. Agosto 2026' })
  assert.deepEqual(carpetaFacturacion('2026-01-05'), { anio: 'Facturación 2025', mes: '12. Diciembre 2025' })
  assert.equal(carpetaFacturacion('').mes, 'Sin fecha')
})

test('nombre del archivo: folio y razón social sin caracteres de Drive; el oficial lleva su marca', () => {
  assert.equal(nombrePdf('511', 'Tarragona S.A.'), 'Factura 511 - Tarragona S.A..pdf')
  assert.equal(nombrePdf('1', 'A/B:C'), 'Factura 1 - ABC.pdf')
  assert.equal(nombrePdf('512', 'Batco', true), 'Factura 512 - Batco (oficial SII).pdf')
  assert.equal(nombrePdf('9', ''), 'Factura 9.pdf')
})

test('calendario: primero ya, tras la primera falla 6 horas, desde la segunda al día siguiente', () => {
  const t = 1_000_000_000_000
  assert.equal(proximoIntentoMs({ n: 0, ultimoMs: 0 }), 0)
  assert.equal(proximoIntentoMs({ n: 1, ultimoMs: t }), t + HORAS_REINTENTO * H)
  assert.equal(proximoIntentoMs({ n: 2, ultimoMs: t }), t + 18 * H)
  assert.equal(proximoIntentoMs({ n: 4, ultimoMs: t }), t + 18 * H)
})

test('plan: busca solo lo vivo, emitido, sin PDF oficial y fuera de espera; avisa desde la tercera falla y deja a mano al tope', () => {
  const t = 1_800_000_000_000
  const facturas = [
    f('a', '511'), f('b', '512'), f('c', '513'), f('d', '514'), f('e', '515'),
    f('x1', '400', { status: 'Anulada' }), f('x2', '401', { issued_at: '2026-05-01' }), f('x3', '402', { deleted_at: '2026-11-01' }), f('x4', ''), f('p', '403'),
  ]
  const intentos = {
    b: { n: 1, ultimoMs: t - 2 * H, ultimo: 'captcha' },        // falló hace 2 h: todavía espera
    c: { n: 1, ultimoMs: t - 7 * H, ultimo: 'sin documento' },  // falló hace 7 h: toca
    d: { n: 3, ultimoMs: t - 20 * H, ultimo: 'sin documento' }, // tercera falla: avisa, y toca otra vez
    e: { n: 6, ultimoMs: t - 99 * H, ultimo: 'sin documento' }, // tope: a mano
  }
  const r = planPdfOficial({ facturas, conPdf: new Set(['p']), intentos, ahoraMs: t, desde: '2026-06-09', limite: 10 })
  assert.deepEqual(r.aBuscar.map(x => x.folio), ['511', '513', '514'])
  assert.equal(r.sinPdf, 5)
  assert.deepEqual(r.fallidas.map(x => x.folio).sort(), ['514', '515'])
  assert.deepEqual(r.aMano, [{ id: 'e', folio: '515' }])
})

test('plan: respeta el límite por corrida y deja primero las nunca intentadas', () => {
  const t = 1_800_000_000_000
  const facturas = [f('a', '1'), f('b', '2'), f('c', '3')]
  const r = planPdfOficial({ facturas, conPdf: [], intentos: { a: { n: 2, ultimoMs: t - 30 * H } }, ahoraMs: t, desde: '2026-06-09', limite: 2 })
  assert.deepEqual(r.aBuscar.map(x => x.folio), ['2', '3'])
})
