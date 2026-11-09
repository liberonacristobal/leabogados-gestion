// Presupuesto anual: modelo por escenario, migración, diferencias, días de cobro. Datos de ejemplo, sin cifras reales.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estadoInicial, proyectarUF, modeloPresupuesto, resumenModelo, migrarEstado, diferenciaSupuestos, ultimosCerrados, baseMensual, mesesAtipicos, diasDeCobro, concentracion, ESCENARIOS } from './../supabase/functions/_shared/presupuesto.js'

const costos = [
  { id: 0, n: 'Sueldos', m: 5_000_000, meses: 12, t: 'fijo', alza: null },
  { id: 1, n: 'Arriendo', m: 1_000_000, meses: 12, t: 'fijo', alza: null },
]
const base = { baseCLP: Array.from({ length: 12 }, () => 10_000_000), baseUF: Array.from({ length: 12 }, () => 250), ufDic: 40_000 }
const fmt = { mm: (/** @type {number} */ n) => `$${Math.round(n / 1e5) / 10}M`, pc: (/** @type {number} */ n) => `${n} %` }

test('UF proyectada: el reajuste anual se compone mes a mes sobre la UF de cierre', () => {
  assert.ok(Math.abs(proyectarUF(40_000, 3.5, 11) - 40_000 * 1.035) < 1e-6)
  assert.ok(proyectarUF(40_000, 3.5, 0) < proyectarUF(40_000, 3.5, 5))
  assert.equal(proyectarUF(40_000, 0, 7), 40_000)
})

test('modelo: cada mes parte de la base en UF y la cascada cierra al peso', () => {
  const st = estadoInicial({ costos, tasa: 15, ppmMes: 100_000 })
  const m = modeloPresupuesto(base, st)
  for (const [k] of ESCENARIOS) {
    const e = m.esc[k], g = st.p[k].g
    assert.ok(Math.abs(e.factUF - 12 * 250 * (1 + g / 100)) < 1e-6)
    assert.ok(Math.abs(e.ing[3] - 250 * (1 + g / 100) * m.uf27[3]) < 1e-6)
    assert.ok(Math.abs(e.base - (e.caja - e.terc - e.costos)) < 1e-6)            // resultado = cobrado − terceros − costos
    assert.ok(Math.abs(e.post - (e.base - e.idpc)) < 1e-6)                        // después de impuesto
    assert.ok(Math.abs(e.retiros + e.reserva - Math.max(0, e.post)) < 1e-6)      // retiros + reserva = resultado después de impuesto
    assert.ok(Math.abs(e.saldo - (e.idpc - st.ppmAnual)) < 1e-6)
    assert.equal(st.ppmAnual, 1_200_000)
  }
})

test('modelo: más crecimiento da más retiros; más alza de costos, menos; y el impuesto no es negativo con pérdida', () => {
  const st = estadoInicial({ costos })
  const a = modeloPresupuesto(base, st).esc.base.retiros
  st.p.base.g += 10
  assert.ok(modeloPresupuesto(base, st).esc.base.retiros > a)
  st.p.base.g -= 10; st.p.base.alza += 10
  assert.ok(modeloPresupuesto(base, st).esc.base.retiros < a)
  const perdida = estadoInicial({ costos: [{ id: 9, n: 'Enorme', m: 90_000_000, meses: 12, t: 'fijo', alza: null }] })
  const e = modeloPresupuesto(base, perdida).esc.base
  assert.ok(e.base < 0); assert.equal(e.idpc, 0); assert.equal(e.retiros, 0)
})

test('modelo: la alza propia de una partida manda sobre la del escenario y los meses prorratean', () => {
  const st = estadoInicial({ costos: [{ id: 0, n: 'Nuevo ingreso', m: 1_000_000, meses: 6, t: 'fijo', alza: null }] })
  assert.ok(Math.abs(modeloPresupuesto(base, st).esc.base.costos - 6_000_000 * 1.045) < 1e-6)
  st.costos[0].alza = 10
  assert.ok(Math.abs(modeloPresupuesto(base, st).esc.base.costos - 6_000_000 * 1.1) < 1e-6)
})

test('modelo: días de cobro aumentan lo por cobrar solo si diciembre crece contra la base', () => {
  const st = estadoInicial({ costos })
  const e = modeloPresupuesto(base, st).esc.base
  assert.ok(e.dCob > 0 && e.caja < e.fact)
  const plano = { ...base, baseCLP: Array.from({ length: 12 }, () => 0), baseUF: Array.from({ length: 12 }, () => 0) }
  assert.equal(modeloPresupuesto(plano, st).esc.base.fact, 0)
})

test('resumen: guarda los facturados mensuales congelados', () => {
  const r = resumenModelo(modeloPresupuesto(base, estadoInicial({ costos })))
  assert.equal(r.base.mensual.length, 12); assert.equal(r.base.mensualUF.length, 12)
  assert.ok(r.meta.retiros > r.prudente.retiros)
})

test('estado inicial: terceros y días de cobro reales reemplazan los de partida', () => {
  const st = estadoInicial({ costos, terc: 21.34, dias: 18 })
  assert.equal(st.p.base.terc, 21.3); assert.equal(st.p.base.dias, 18); assert.equal(st.p.meta.dias, 18); assert.equal(st.p.prudente.dias, 35)
  assert.equal(estadoInicial({ costos }).p.base.dias, 24)
})

test('migración: marcas y notas del diseño de 8 etapas pasan a las 5 actuales, sin perder ninguna', () => {
  const m = migrarEstado({ hecho: [0, 2, 4, 7], notas: { 2: 'revisar tasa', 3: 'base ok', 7: 'avisos' } })
  assert.deepEqual(m.hecho.sort(), [0, 2, 3, 4])
  assert.equal(m.notas[3], 'revisar tasa · base ok'); assert.equal(m.notas[4], 'avisos'); assert.equal(m.v, 2)
  assert.deepEqual(migrarEstado(m), m)   // idempotente
})

test('diferencias entre versiones: supuestos y partidas que cambian', () => {
  const a = estadoInicial({ costos }), b = JSON.parse(JSON.stringify(a))
  assert.deepEqual(diferenciaSupuestos(a, b, fmt), [])
  b.p.base.g = 18; b.tasaIDPC = 25; b.costos[0].m = 6_000_000; b.costos.push({ id: 5, n: 'Asociado', m: 2_000_000, meses: 6, t: 'fijo', alza: null }); b.costos.splice(1, 1)
  const d = diferenciaSupuestos(a, b, fmt)
  assert.ok(d.includes('Base · Crecimiento: 10 → 18'))
  assert.ok(d.some((x) => x.startsWith('Tasa de primera categoría')))
  assert.ok(d.some((x) => x.includes('Sueldos: $5M → $6M')))
  assert.ok(d.some((x) => x.startsWith('Partida nueva: Asociado')))
  assert.ok(d.includes('Partida quitada: Arriendo'))
})

test('meses cerrados y base: el mes en curso no cuenta y cada mes calendario toma el último cerrado', () => {
  const u = ultimosCerrados('2026-11-09')
  assert.equal(u.length, 12); assert.equal(u[0], '2025-11'); assert.equal(u[11], '2026-10')
  assert.equal(ultimosCerrados('2026-01-15')[11], '2025-12')
  const b = baseMensual(u.map((ym, i) => ({ ym, clp: (i + 1) * 1e6, uf: i + 1 })), 40_000)
  assert.equal(b.baseCLP[10], 1e6); assert.equal(b.baseCLP[11], 2e6); assert.equal(b.baseCLP[9], 12e6)   // nov-25, dic-25, oct-26
  assert.equal(baseMensual([], 1).baseCLP.every((x) => x === 0), true)
})

test('meses atípicos: más de 1,5 veces o menos de la mitad de la mediana', () => {
  assert.deepEqual(mesesAtipicos([10, 11, 9, 10, 30, 10, 3, null]), [4, 6])
  assert.deepEqual(mesesAtipicos([10, 10]), [])
})

test('días de cobro: promedio y mediana de facturas pagadas del año, sin reembolsos', () => {
  const f = (/** @type {string} */ i, /** @type {string} */ p, /** @type {any} */ extra = {}) => ({ status: 'Pagado', issued_at: i, paid_at: p, billing_type: 'honorarios', ...extra })
  const r = diasDeCobro([f('2026-01-10', '2026-01-20'), f('2026-02-01', '2026-02-11'), f('2026-03-01', '2026-04-10'), f('2026-03-01', '2026-03-05', { billing_type: 'reembolso' }), f('2025-12-01', '2025-12-02'), { status: 'Pendiente', issued_at: '2026-05-01' }], 2026)
  assert.equal(r.n, 3); assert.equal(r.mediana, 10); assert.equal(r.promedio, 20)
  assert.deepEqual(diasDeCobro([], 2026), { n: 0, promedio: null, mediana: null })
})

test('concentración: los k primeros sobre el total', () => {
  assert.equal(concentracion([50, 30, 10, 5, 3, 2], 100, 2), 0.8)
  assert.equal(concentracion([], 0), 0)
})
