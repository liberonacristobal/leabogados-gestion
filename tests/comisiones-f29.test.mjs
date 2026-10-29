// Pruebas de boletas de honorarios, comisiones a terceros, F29 estimado y saldo por cliente (_shared). Sin nombres de clientes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseBHE, elegirComisionesBHE, calcesPagoComision, documentosPorPedir } from './../supabase/functions/_shared/comisionesReglas.js'
import { f29PerAnterior, f29Retenciones, f29TasaDeclarada } from './../supabase/functions/_shared/f29Reglas.js'
import { cuentaEnSaldo } from './../supabase/functions/_shared/gastosReglas.js'

const bheTxt = (extra = {}) => `Prestador Ejemplo | BOLETA DE HONORARIOS ELECTRÓNICA | N ° ${extra.folio ?? 123} | RUT: 12.345.678-5 | Fecha: 5 de octubre de 2026 | Emisión: 05/10/2026 | Rut: 76.111.111-1 | Por atención profesional: | Asesoría comisión | Total Honorarios: | ${extra.bruto ?? '1.000.000'} | 15,25 % Impto. Retenido: | 152.500 | | Total: | ${extra.liquido ?? '847.500'}`

test('boleta de honorarios: lee folio, RUT, fecha, bruto, retención y líquido', () => {
  const b = parseBHE(bheTxt())
  assert.equal(b.folio, 123); assert.equal(b.emisor_rut, '12.345.678-5'); assert.equal(b.receptor_rut, '76.111.111-1')
  assert.equal(b.fecha, '2026-10-05'); assert.equal(b.bruto, 1000000); assert.equal(b.retencion, 152500); assert.equal(b.liquido, 847500)
  assert.equal(b.tasa, 0.1525)
})

test('boleta de honorarios: si el bruto menos la retención no calza con el líquido, no se lee; tampoco un texto que no es boleta', () => {
  assert.equal(parseBHE(bheTxt({ liquido: '847.000' })), null)
  assert.equal(parseBHE('FACTURA ELECTRÓNICA N° 12'), null)
})

const com = (id, liquido, estado = 'por_pagar') => ({ id, liquido, estado })
const bhe = { bruto: 1000000, retencion: 152500, liquido: 847500 }

test('boleta ↔ comisiones: una sola combinación posible; el bruto y la retención se reparten sin perder un peso', () => {
  const r = elegirComisionesBHE([com('a', 500000), com('b', 347500), com('c', 90000)], bhe)
  assert.deepEqual(r.map(x => x.id), ['a', 'b'])
  assert.equal(r.reduce((s, x) => s + x.monto, 0), 1000000)
  assert.equal(r.reduce((s, x) => s + x.retencion, 0), 152500)
  assert.ok(r.every(x => x.monto - x.retencion === x.liquido))
})

test('boleta ↔ comisiones: si hay dos formas de calzar, o ninguna, no se elige', () => {
  assert.equal(elegirComisionesBHE([com('a', 847500), com('b', 847500)], bhe), null)
  assert.equal(elegirComisionesBHE([com('a', 100000)], bhe), null)
  assert.equal(elegirComisionesBHE([com('a', 847500, 'por_devengar')], bhe), null)   // el cliente aún no paga: no cuenta
})

test('pago del banco ↔ comisión: un cargo y una comisión únicos al monto; si hay dos cargos iguales, nadie', () => {
  const porPagar = [{ id: 't1', saldo: 847500 }, { id: 't2', saldo: 300000 }]
  assert.deepEqual(calcesPagoComision(porPagar, [{ id: 'm1', monto: -847500 }]).map(x => [x.mov.id, x.t.id]), [['m1', 't1']])
  assert.deepEqual(calcesPagoComision(porPagar, [{ id: 'm1', monto: -300000 }, { id: 'm2', monto: -300000 }]), [])
  assert.deepEqual(calcesPagoComision([{ id: 't1', saldo: 100 }, { id: 't2', saldo: 100 }], [{ id: 'm1', monto: 100 }]), [])
})

test('documentos por pedir: boleta al que emite boleta, definir al sin documento, nada a empresas ni a lo anterior a la app', () => {
  const t = (o) => ({ estado: 'pagado', movimiento_id: 'x', pagado_at: '2026-09-01', ...o })
  const proveedores = [{ id: 1, documento: 'boleta', rut: '12.345.678-5' }, { id: 2, documento: null, rut: '13.000.000-1' }, { id: 3, documento: null, rut: '76.111.111-1' }]
  const r = documentosPorPedir({ proveedores, terceros: [
    t({ id: 'a', proveedor_id: 1, liquido: 847500, monto: 1000000, retencion: 152500 }),
    t({ id: 'b', proveedor_id: 2 }),
    t({ id: 'c', proveedor_id: 3 }),                                   // empresa (RUT sobre 50.000.000): se espera su factura
    t({ id: 'd', proveedor_id: 1, liquido: 1, pagado_at: '2026-05-01' }), // anterior a la app
    t({ id: 'e', proveedor_id: 1, liquido: 1, bhe_id: 9 }),             // ya tiene boleta
    t({ id: 'f', proveedor_id: 1, liquido: 1, comision_pct: 10 }),      // comisión que nos pagan: no es costo
  ] })
  assert.deepEqual(r.map(x => [x.t.id, x.tipo]), [['a', 'pedir_boleta'], ['b', 'definir_documento']])
  assert.equal(documentosPorPedir({ proveedores, sinDocumento: new Set(['2']), terceros: [t({ id: 'b', proveedor_id: 2 })] }).length, 0)
})

test('F29: mes anterior, incluido el cambio de año; retenciones del mes sin boletas anuladas', () => {
  assert.equal(f29PerAnterior('2026-01'), '2025-12')
  assert.equal(f29PerAnterior('2026-10'), '2026-09')
  const r = f29Retenciones([{ fecha: '2026-09-03', retencion: 100 }, { fecha: '2026-09-20', retencion: 50, estado: 'anulada' }, { fecha: '2026-08-31', retencion: 999 }, { fecha: '2026-09-30', retencion: 25 }], '2026-09')
  assert.deepEqual(r, { ret: 125, n: 2 })
})

test('F29: la tasa del PPM es la que más se repite en los últimos 6 declarados; sin historia no hay tasa', () => {
  const d = { '2026-01': { tasa_ppm: 2 }, '2026-02': { tasa_ppm: 2 }, '2026-03': { tasa_ppm: 1.5 }, '2026-04': { tasa_ppm: 2 }, '2026-05': { tasa_ppm: 1.5 } }
  assert.equal(f29TasaDeclarada(d, '2026-06'), 0.02)
  assert.equal(f29TasaDeclarada({ '2026-01': { tasa_ppm: 1.5 }, '2026-02': { tasa_ppm: 2 } }, '2026-03'), 0.02)   // empate: la más reciente
  assert.equal(f29TasaDeclarada(d, '2026-01'), null)
  assert.equal(f29TasaDeclarada(null, '2026-06'), null)
})

test('saldo del cliente: lo resumido en un corte de apertura no suma', () => {
  assert.equal(cuentaEnSaldo({ apertura_id: 'ap1' }), false)
  assert.equal(cuentaEnSaldo({ apertura_id: null }), true)
  assert.equal(cuentaEnSaldo(null), true)
})
