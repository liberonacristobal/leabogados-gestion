// Presupuesto anual: modelo por escenario, migración, diferencias, días de cobro. Datos de ejemplo, sin cifras reales.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tasaIDPCLegal, tasaPPMLegal, estadoInicial, proyectarUF, modeloPresupuesto, resumenModelo, migrarEstado, diferenciaSupuestos, ultimosCerrados, baseMensual, mesesAtipicos, diasDeCobro, concentracion, ESCENARIOS, aUF, aPesos, ufMedia, sumaConUF, mesesCerradosAnio, distribuirMensual, seguimientoMensual } from './../supabase/functions/_shared/presupuesto.js'

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
    assert.equal(e.ppm, 1_200_000)                                                // PPM = lo pagado hoy × 12 (conservador)
    assert.ok(Math.abs(e.saldo - (e.idpc - e.ppm)) < 1e-6)
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
  assert.ok(r.meta.retiros > r.prudente.retiros)   // la clave interna sigue siendo `meta`; el rótulo es «Optimista»
  assert.deepEqual(ESCENARIOS.map((x) => x[1]), ['Prudente', 'Base', 'Optimista'])
})

test('estado inicial: terceros y días de cobro reales reemplazan los de partida', () => {
  const st = estadoInicial({ costos, terc: 21.34, dias: 18 })
  assert.equal(st.p.base.terc, 21.3); assert.equal(st.p.base.dias, 18); assert.equal(st.p.meta.dias, 18); assert.equal(st.p.prudente.dias, 35)
  assert.equal(estadoInicial({ costos }).p.base.dias, 24)
})

test('migración: marcas y notas del diseño de 8 etapas pasan a las 5 actuales, sin perder ninguna', () => {
  const m = migrarEstado({ hecho: [0, 2, 4, 7], notas: { 2: 'revisar tasa', 3: 'base ok', 7: 'avisos' } })
  // 8 etapas → 5 (v2) y luego entra «Metas 2027» en el 4.º lugar (v4): las marcas y notas desde la 4.ª etapa se desplazan una posición
  assert.deepEqual(m.hecho.sort(), [0, 2, 4, 5])
  assert.equal(m.notas[4], "revisar tasa · base ok"); assert.equal(m.notas[5], "avisos"); assert.equal(m.v, 7)
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

test('tasas legales Pro Pyme por año comercial (circular SII 53/2025) y migración del borrador anterior', () => {
  assert.equal(tasaIDPCLegal(2026), 12.5); assert.equal(tasaIDPCLegal(2027), 12.5); assert.equal(tasaIDPCLegal(2028), 15); assert.equal(tasaIDPCLegal(2029), 25)
  assert.equal(tasaPPMLegal(2027, 10_000), 0.125); assert.equal(tasaPPMLegal(2027, 60_000), 0.25)   // rebaja transitoria hasta dic-2027
  assert.equal(tasaPPMLegal(2028, 10_000), 0.25); assert.equal(tasaPPMLegal(2028, 60_000), 0.5)     // sin rebaja en 2028
  const viejo = { v: 2, tasaIDPC: 15, ppmAnual: 1_200_000, esc: 'base', hecho: [], notas: {} }
  const m = migrarEstado(viejo, 2027)
  assert.equal(m.v, 7); assert.equal(m.tasaIDPC, 12.5); assert.equal(m.ppmAnual, 1_200_000)
  assert.equal(migrarEstado({ v: 3, ppmTasa: 0.125 }, 2027, 900_000).ppmAnual, 900_000)           // borrador guardado con tasa: recupera el PPM vigente
  assert.equal(migrarEstado({ v: 2, tasaIDPC: 20 }, 2027).tasaIDPC, 20)                              // una tasa editada a mano no se toca
  assert.deepEqual(migrarEstado(m, 2027), m)                                                          // idempotente
  assert.equal(estadoInicial({ anio: 2028 }).tasaIDPC, 15)
})

test('moneda: pesos ↔ UF de ida y vuelta, y casos borde sin NaN', () => {
  assert.ok(Math.abs(aPesos(aUF(1_234_567, 39_000), 39_000) - 1_234_567) < 1e-6)
  assert.equal(aUF(0, 39_000), 0)
  assert.equal(aUF(null, 39_000), null)
  assert.equal(aUF(1000, 0), null)
  assert.equal(aUF(1000, null), null)
  assert.equal(aUF(NaN, 39_000), null)
  assert.equal(aPesos(undefined, 39_000), null)
  assert.equal(aPesos(10, -1), null)
  assert.equal(aUF(-390_000, 39_000), -10)
})

test('moneda: UF media ignora valores inválidos y suma con la UF de cada día', () => {
  assert.equal(ufMedia([]), null)
  assert.equal(ufMedia([0, null, 'x']), null)
  assert.equal(ufMedia([38_000, 40_000, 0]), 39_000)
  const uf = { '2026-01-10': 38_000, '2026-02-10': 40_000 }
  const r = sumaConUF([{ monto: 380_000, fecha: '2026-01-10' }, { monto: 400_000, fecha: '2026-02-10' }, { monto: 390_000, fecha: '2026-03-01' }], (f) => uf[f], 39_000)
  assert.equal(r.clp, 1_170_000); assert.ok(Math.abs(r.uf - 30) < 1e-9); assert.equal(r.sinUF, 1)
  assert.deepEqual(sumaConUF([], () => 1), { clp: 0, uf: 0, sinUF: 0 })
})

test('seguimiento: meses cerrados, reparto mensual y desviación acumulada', () => {
  assert.equal(mesesCerradosAnio('2026-11-09', 2026), 10)
  assert.equal(mesesCerradosAnio('2026-11-09', 2027), 0)
  assert.equal(mesesCerradosAnio('2026-11-09', 2025), 12)
  const d = distribuirMensual(1200, [1, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  assert.ok(Math.abs(d.reduce((a, x) => a + x, 0) - 1200) < 1e-9); assert.equal(d[2], 600)
  assert.deepEqual(distribuirMensual(1200, null), Array(12).fill(100))
  assert.deepEqual(distribuirMensual(1200, Array(12).fill(0)), Array(12).fill(100))
  const pres = Array(12).fill(100), real = [110, 90, 120, null, ...Array(8).fill(null)]
  const s = seguimientoMensual({ pres, real, cerrados: 3 })
  assert.equal(s.realAcum, 320); assert.equal(s.presAcum, 300); assert.equal(s.des, 20)
  assert.ok(Math.abs(s.desPct - (20 / 300) * 100) < 1e-9)
  assert.equal(s.cierre, 320 + 900)                                    // real cerrado + presupuesto de los meses que faltan
  assert.equal(s.meses[3].estado, 'curso'); assert.equal(s.meses[4].estado, 'venir'); assert.equal(s.meses[1].des, -10)
  const sin = seguimientoMensual({ pres: Array(12).fill(null), real, cerrados: 3 })
  assert.equal(sin.des, null); assert.equal(sin.cierre, null); assert.equal(sin.presAcum, null)
  const nada = seguimientoMensual({ pres, real: Array(12).fill(null), cerrados: 0 })
  assert.equal(nada.realAcum, 0); assert.equal(nada.des, 0); assert.equal(nada.cierre, 1200)
})
