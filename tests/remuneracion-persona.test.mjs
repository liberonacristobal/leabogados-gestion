// Remuneración completa desde el líquido con los parámetros de la última liquidación. Cifras ficticias (personas y montos inventados).
import test from 'node:test'
import assert from 'node:assert/strict'
import { liquidacionDeImponible } from '../supabase/functions/_shared/liquidoABruto.js'
import { tramosDelMes, ultimaLiquidacionDe, parametrosDeLiquidacion, remuneracionDeLiquido, impuestoUnicoPresupuesto, tasaEmpleadorDe, remuneracionBoleta } from '../supabase/functions/_shared/remuneracionPersona.js'

const FILAS = [[0, 950000, 0, 0], [950000.01, 2100000, 0.04, 38000], [2100000.01, 3500000, 0.08, 122000], [3500000.01, 4900000, 0.135, 314000], [4900000.01, 1e12, 0.23, 780000]]
  .flatMap((t, i) => ['2026-09', '2026-10'].map(periodo => ({ periodo, tramo: i + 1, desde: t[0], hasta: t[1] === 1e12 ? null : t[1], factor: t[2], rebaja: t[3] })))
const UF = { '2026-09': 40000, '2026-10': 40200 }, ufDeLiquidacion = (ym) => UF[ym] || 40200
// una liquidación «real» fabricada con el mismo modelo: Persona Uno, 10 % de AFP, plan de salud de 7 UF
const liqDe = (ym, imponible) => { const uf = UF[ym], r = liquidacionDeImponible({ imponible, afpPct: 0.1, planSaludPesos: 7 * uf, uf, tramos: tramosDelMes(FILAS, ym) }); return { periodo: ym, persona: 'UNO PEREZ PERSONA', imponible, liquido: r.liquido, impuesto_unico: r.iu, salud_adicional: r.adicional } }
const L = [liqDe('2026-09', 2500000)]

test('tramos del mes: el del mes, o el último anterior si el mes aún no está', () => {
  assert.equal(tramosDelMes(FILAS, '2026-10').length, 5); assert.equal(tramosDelMes(FILAS, '2026-12').length, 5); assert.deepEqual(tramosDelMes([], '2026-10'), [])
  assert.equal(tramosDelMes(FILAS, '2026-10')[4][1], 1e12)
})

test('la persona se reconoce por su nombre corto y se toma su última liquidación hasta el mes', () => {
  assert.equal(ultimaLiquidacionDe('Persona', L, '2026-10').periodo, '2026-09'); assert.equal(ultimaLiquidacionDe('Persona', L, '2026-08'), null); assert.equal(ultimaLiquidacionDe('Otra', L, '2026-10'), null)
})

test('los parámetros de la liquidación se recuperan: tasa de AFP y plan de salud en UF', () => {
  const p = parametrosDeLiquidacion(L[0], UF['2026-09'])
  assert.equal(p.afpPct, 0.1); assert.ok(Math.abs(p.planUF - 7) < 0.01)
  assert.equal(parametrosDeLiquidacion({ imponible: 0, liquido: 1, impuesto_unico: 0 }, 40000), null)
})

test('el mismo líquido de la liquidación reproduce su impuesto único; un líquido mayor sube el bruto', () => {
  const base = { persona: 'Persona', liquidaciones: L, ym: '2026-10', uf: UF['2026-10'], ufDeLiquidacion, tramosFilas: FILAS, tasaEmpleador: 0.06 }
  const hoy = remuneracionDeLiquido({ ...base, liquido: L[0].liquido }), mas = remuneracionDeLiquido({ ...base, liquido: Math.round(L[0].liquido * 1.1) })
  assert.ok(hoy && mas); assert.ok(Math.abs(hoy.liquido - L[0].liquido) <= 1)
  assert.equal(hoy.haberes, hoy.imponible); assert.equal(hoy.costoEmpresa, hoy.imponible + hoy.empleador)
  assert.ok(mas.costoEmpresa - hoy.costoEmpresa > mas.liquido - hoy.liquido)   // por cada peso de aumento líquido el costo empresa sube más de un peso
  assert.equal(remuneracionDeLiquido({ ...base, persona: 'Sin liquidacion', liquido: 1000000 }), null)
})

test('impuesto único del presupuesto: suma las líneas de Remuneraciones con liquidación y no las demás', () => {
  const rows = [{ categoria: 'Remuneraciones', item: 'Persona', monto: L[0].liquido }, { categoria: 'Remuneraciones', item: 'Contadora', monto: 500000 }, { categoria: 'Arriendo', item: 'Persona', monto: 999999 }, { categoria: 'Remuneraciones', item: 'Persona', monto: 1, activo: false }]
  const iu = impuestoUnicoPresupuesto({ rows, ym: '2026-10', liquidaciones: L, tramosFilas: FILAS, ufDelMes: UF['2026-10'], ufDeLiquidacion, vigente: (r) => r.monto })
  assert.ok(iu > 0); assert.ok(Math.abs(iu - L[0].impuesto_unico) <= 2000)   // otra UF y otra tabla del mes: casi el mismo impuesto
  assert.equal(impuestoUnicoPresupuesto({ rows: [], ym: '2026-10', liquidaciones: L, tramosFilas: FILAS, ufDelMes: 40200, ufDeLiquidacion, vigente: (r) => r.monto }), 0)
})

test('tasa del empleador: planilla menos cotizaciones del trabajador, sobre el imponible del último mes que tiene ambas', () => {
  const liqs = [{ periodo: '2026-09', persona: 'A', imponible: 1000000, impuesto_unico: 0, liquido: 800000 }, { periodo: '2026-09', persona: 'B', imponible: 1000000, impuesto_unico: 0, liquido: 800000 }]   // trabajador: 200.000 cada uno
  const r = tasaEmpleadorDe({ plan: [{ anio: 2026, mes: 9, cotizaciones: 520000 }], liquidaciones: liqs })
  assert.equal(r.periodo, '2026-09'); assert.ok(Math.abs(r.tasa - 0.06) < 1e-9)
  assert.equal(tasaEmpleadorDe({ plan: [], liquidaciones: liqs }), null); assert.equal(tasaEmpleadorDe({ plan: [{ anio: 2026, mes: 9, cotizaciones: 100 }], liquidaciones: liqs }), null)
})

test('boleta de honorarios: el costo es el bruto con la retención del año; 500.000 líquidos a 15,25 % son 589.970; en 2027 la retención sube', () => {
  const a = remuneracionBoleta({ liquido: 500000, fecha: '2026-10-01' }), b = remuneracionBoleta({ liquido: 500000, fecha: '2027-01-01' })
  assert.equal(a.costoEmpresa, 589970); assert.equal(a.iu, 89970); assert.equal(a.cotTrab, 0); assert.equal(a.empleador, 0); assert.equal(a.tasa, 0.1525)
  assert.ok(b.costoEmpresa > a.costoEmpresa); assert.equal(b.tasa, 0.16); assert.equal(remuneracionBoleta({ liquido: 0, fecha: '2026-10-01' }), null)
})

test('pasar de boleta a contrato: con AFP y plan dados se calcula sin liquidación previa, y el contrato lleva cotizaciones y impuesto único', () => {
  const base = { persona: 'Persona nueva', liquidaciones: [], ym: '2026-10', uf: 40200, ufDeLiquidacion: () => 40200, tramosFilas: FILAS, tasaEmpleador: 0.06, parametros: { afpPct: 0.1, planUF: 0 } }
  const c = remuneracionDeLiquido({ ...base, liquido: 500000 })
  assert.ok(c); assert.ok(Math.abs(c.liquido - 500000) <= 1); assert.ok(c.cotTrab > 0); assert.equal(c.empleador, Math.round(0.06 * c.imponible))
  assert.equal(remuneracionDeLiquido({ ...base, parametros: null, liquido: 500000 }), null)   // sin liquidación ni parámetros no se inventa
})
