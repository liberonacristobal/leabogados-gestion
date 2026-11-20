// «Mes en marcha»: grupos de gasto, pagos del mes por fecha de pago, proyección de lo que falta y cascada de cobertura. Datos anonimizados.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { grupoDeGasto, gastosPagados, gastosPorPagar, gastosProximoMes, cascadaCobertura, ultimoDiaHabil, esPagoTarjeta, pagosTarjetaComoGastos } from './../supabase/functions/_shared/mesEnMarcha.js'

const G = (id, date, category, amount, concept = '') => ({ id, date, category, amount, concept, type: 'gasto' })
const habil = iso => { const d = new Date(iso + 'T12:00:00').getDay(); return d !== 0 && d !== 6 }   // sin feriados: lunes a viernes

test('grupo de gasto: fijos sí; retiros, comisiones y caja chica no', () => {
  assert.equal(grupoDeGasto(G('a', '2026-11-02', 'Arriendo', 1)), 'arriendo')
  assert.equal(grupoDeGasto(G('b', '2026-11-12', 'Impuestos y patentes', 1, 'IVA/PPM 10-2026')), 'f29')
  assert.equal(grupoDeGasto(G('c', '2026-09-16', 'Impuestos y patentes', 1, 'Patente comercial')), 'impuestos')
  assert.equal(grupoDeGasto(G('d', '2026-11-09', 'Otros', 1, 'Aseo oficina')), 'aseo')
  assert.equal(grupoDeGasto(G('e', '2026-11-09', 'Retiros', 1)), null)
  assert.equal(grupoDeGasto({ ...G('f', '2026-11-09', 'Arriendo', 1), deleted_at: '2026-11-10' }), null)
})
test('pagados: una fila por grupo y día; los sueldos del mismo día suman', () => {
  const r = gastosPagados([G('1', '2026-11-02', 'Sueldos', 100), G('2', '2026-11-02', 'Sueldos', 50), G('3', '2026-11-02', 'Arriendo', 10), G('4', '2026-10-30', 'Sueldos', 999)], '2026-11')
  assert.equal(r.length, 2); const s = r.find(x => x.k === 'sueldos'); assert.equal(s.monto, 150); assert.equal(s.n, 2)
})
test('por pagar: proyecta lo que falta con el monto del último pago y el día habitual; solo fechas futuras', () => {
  const gs = [G('1', '2026-10-19', 'Gastos comunes', 700), G('2', '2026-09-22', 'Gastos comunes', 650), G('3', '2026-11-02', 'Arriendo', 2500), G('4', '2026-10-01', 'Arriendo', 2400),
    G('5', '2026-10-30', 'Sueldos', 500), G('6', '2026-10-30', 'Sueldos', 3000), G('7', '2026-10-02', 'Sueldos', 1000), G('8', '2026-11-02', 'Sueldos', 3100)]
  const r = gastosPorPagar(gs, '2026-11', '2026-11-12', habil)
  const gc = r.find(x => x.k === 'gc'); assert.equal(gc.monto, 700); assert.ok(gc.fecha > '2026-11-12')
  assert.ok(!r.find(x => x.k === 'arriendo'))                     // ya pagado este mes
  const su = r.find(x => x.k === 'sueldos'); assert.equal(su.fecha, '2026-11-30'); assert.equal(su.monto, 6600)   // último ciclo: 30-10 y 02-11 (3 días entre ambos)
})
test('mes cerrado o sin historia: nada por pagar', () => {
  assert.deepEqual(gastosPorPagar([G('1', '2026-10-19', 'Gastos comunes', 700)], '2026-10', '2026-11-12', habil), [])
  assert.deepEqual(gastosPorPagar([], '2026-11', '2026-11-12', habil), [])
})
test('último día hábil', () => { assert.equal(ultimoDiaHabil('2026-11', habil), '2026-11-30'); assert.equal(ultimoDiaHabil('2026-05', habil), '2026-05-29') })
test('cascada: cuadra y dice cuánto falta', () => {
  const c = cascadaCobertura({ cobrado: 15_640_000, pagado: 10_680_000, porPagar: 9_150_000 })
  assert.equal(c.cobrado - c.pagado, c.trasPagados); assert.equal(c.trasPagados - c.porPagar, c.saldo)
  assert.equal(c.falta, 4_300_000); assert.equal(c.cubrePagados, true)
  assert.equal(cascadaCobertura({ cobrado: 5e6, pagado: 6e6, porPagar: 0 }).cubrePagados, false)
})

test('primeros días del mes siguiente: el arriendo (día habitual 1 a 3) entra hasta el 5; los gastos de mitad de mes y los sueldos no', () => {
  const gs = [G('1', '2026-11-02', 'Arriendo', 2558), G('2', '2026-10-01', 'Arriendo', 2546), G('3', '2026-09-03', 'Arriendo', 2534),
    G('4', '2026-11-12', 'Impuestos y patentes', 1833, 'IVA/PPM 10-2026'), G('5', '2026-11-20', 'Gastos comunes', 727), G('6', '2026-11-02', 'Sueldos', 3120)]
  const r = gastosProximoMes(gs, '2026-11-20')
  assert.equal(r.length, 1); assert.equal(r[0].k, 'arriendo'); assert.equal(r[0].monto, 2558); assert.equal(r[0].fecha, '2026-12-02')
  assert.deepEqual(gastosProximoMes(gs, '2026-11-20', 1), [])       // tope del día 1: el arriendo se paga el 2
  assert.equal(gastosProximoMes(gs, '2026-12-20')[0].fecha, '2027-01-02')   // cruza el año
})

// Caso real de noviembre 2026: el pago al aseo es una transferencia sin la palabra «aseo» en la glosa; la subcategoría lo identifica y entra a la proyección del 1 al 5.
test('aseo: se reconoce por la subcategoría y se proyecta en los primeros días del mes siguiente', () => {
  const T = 'Transf. a terceros vía Internet a cuenta'
  const g = [['2026-09-01', 310500], ['2026-10-01', 241500], ['2026-11-09', 276000]].map(([date, amount]) => ({ date, category: 'Otros', subcategory: 'Aseo', concept: T, amount, type: 'gasto' }))
  assert.equal(grupoDeGasto(g[0]), 'aseo')
  assert.deepEqual(gastosProximoMes(g, '2026-11-20').map(x => [x.k, x.fecha, x.monto]), [['aseo', '2026-12-01', 276000]])
})

test('tarjeta: el pago del banco cuenta como gasto del grupo, esté o no repartido; se proyecta con el último pago', () => {
  const M = (id, fecha, monto, extra = {}) => ({ id, fecha, tipo: 'cargo', monto, descripcion: 'Cargo por Pago Tarjeta VISA Nro. XXXX XXXX XXXX 0000.', ...extra })
  const movs = [M('m1', '2026-10-06', 153619), M('m2', '2026-11-11', 367332), M('m3', '2026-11-12', 500, { descripcion: 'Transferencia a terceros' }), M('m4', '2026-11-13', 900, { es_interno: true })]
  assert.equal(esPagoTarjeta(movs[0]), true); assert.equal(esPagoTarjeta(movs[2]), false); assert.equal(esPagoTarjeta(movs[3]), false)
  const ps = pagosTarjetaComoGastos(movs, [])
  assert.equal(ps.length, 2); assert.equal(grupoDeGasto(ps[0]), 'tarjeta')
  const pag = gastosPagados(ps, '2026-11'); assert.equal(pag.length, 1); assert.equal(pag[0].monto, 367332); assert.equal(pag[0].k, 'tarjeta')
  // diciembre: sin pago aún, se proyecta el último pago (nov) en el día habitual
  const pp = gastosPorPagar(ps, '2026-12', '2026-12-01', habil).find(x => x.k === 'tarjeta')
  assert.equal(pp.monto, 367332); assert.ok(pp.fecha > '2026-12-01')
  // no repite un pago que ya existe como gasto de la categoría (misma fecha y monto)
  assert.equal(pagosTarjetaComoGastos(movs, [G('g1', '2026-11-11', 'Tarjeta de crédito', 367332)]).length, 1)
})
