// «Mes en marcha»: grupos de gasto, pagos del mes por fecha de pago, proyección de lo que falta y cascada de cobertura. Datos anonimizados.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { grupoDeGasto, gastosPagados, gastosPorPagar, cascadaCobertura, ultimoDiaHabil } from './../supabase/functions/_shared/mesEnMarcha.js'

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
