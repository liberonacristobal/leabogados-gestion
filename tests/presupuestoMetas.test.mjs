// Presupuesto 2027 · Metas: la cascada en los dos sentidos (ida y vuelta por cada componente), referencia 2026, reserva, costos enlazados y sueldos de los socios.
// Datos de ejemplo, sin cifras reales.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  estadoInicial, modeloPresupuesto, migrarEstado, cadenaMeta, metasDesdeComponente, escenariosContraMeta, nivelDeMeta, valorComponente, afavor,
  mesesTranscurridos, cierreEstimado, referencia2026, reservaRecomendada, RESERVA_MINIMA, COMPONENTES, ANCLAS, ESCENARIOS,
  fijarMonto27, fijarAlza, monto27, costoAnualBase, reajusteVigente, desglosarCostos, esDePersona, sueldosYRetiros, supuestosMetas, costosPresupuesto,
} from './../supabase/functions/_shared/presupuesto.js'

const costos = [
  { id: 'a', n: 'Cristóbal', m: 3_000_000, meses: 12, t: 'fijo', alza: null, g: 'Remuneraciones', desde: '2026-10-01', mPrev: 2_300_000 },
  { id: 'b', n: 'Erasmo', m: 3_000_000, meses: 12, t: 'fijo', alza: 0, g: 'Remuneraciones', desde: '2026-10-01', mPrev: 2_300_000 },
  { id: 'c', n: 'Martín', m: 1_600_000, meses: 12, t: 'fijo', alza: null, g: 'Remuneraciones' },
  { id: 'd', n: 'Cristóbal', m: 900_000, meses: 12, t: 'fijo', alza: null, g: 'Leyes sociales' },
  { id: 'e', n: 'Arriendo y espacio', m: 3_000_000, meses: 12, t: 'fijo', alza: null },
]
const base = { baseCLP: Array.from({ length: 12 }, (_, i) => 22_000_000 + i * 1_000_000), baseUF: Array.from({ length: 12 }, (_, i) => 560 + i * 25), ufDic: 40_000 }
const estado = () => estadoInicial({ costos, tasa: 12.5, ppmMes: 100_000 })
const cerca = (a, b, tol = 1) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`)

test('los seis componentes tienen un solo nombre y las escenarios se renombran sin tocar la clave', () => {
  assert.deepEqual(COMPONENTES.map((x) => x[1]), ['Vendido', 'Facturado', 'Cobrado', 'Presupuesto de costos', 'Resultado', 'Retiros'])
  assert.deepEqual([...ANCLAS].sort(), ['caja', 'fact', 'margen', 'retiros', 'ventas'])   // el presupuesto de costos se arma en su paso, no se fija como meta
  assert.deepEqual(ESCENARIOS.map((x) => x[0]), ['prudente', 'base', 'meta'])
})

test('ida y vuelta: escribir el valor de CUALQUIER componente devuelve el mismo valor y la misma cascada', () => {
  const st = estado(), ratio = 66
  for (const g0 of [-20, 0, 10, 25, 60]) {
    const ida = cadenaMeta(base, st, g0, ratio)
    for (const comp of ANCLAS) {
      const v = valorComponente(ida, comp, ratio)
      if (!(v > 0)) continue
      const vuelta = metasDesdeComponente(base, st, { componente: comp, valor: v, ratio })
      assert.equal(vuelta.ok, true, `${comp} g=${g0}`)
      cerca(vuelta.g, g0, 1e-6)
      for (const c of ['fact', 'caja', 'margen', 'retiros', 'ventas', 'costos']) cerca(valorComponente(vuelta, c, ratio), valorComponente(ida, c, ratio), 1e-3)
    }
  }
})

test('la cascada de la meta con g igual al del escenario Base es la del escenario Base', () => {
  const st = estado(), m = modeloPresupuesto(base, st), c = cadenaMeta(base, st, st.p.base.g, 66)
  for (const k of ['fact', 'caja', 'costos', 'terc', 'base', 'idpc', 'post', 'retiros', 'reserva']) cerca(c[k], m.esc.base[k], 1e-6)
  cerca(c.ventas, m.esc.base.fact / 0.66, 1e-6)
  cerca(c.margen, c.caja - c.terc - c.costos, 1e-6)
})

test('metas ≤ 0, base vacía, ratio ausente, componente no fijable y supuestos sin solución no revientan', () => {
  const st = estado()
  assert.equal(metasDesdeComponente(base, st, { componente: 'retiros', valor: 0, ratio: 66 }).ok, false)
  assert.equal(metasDesdeComponente(base, st, { componente: 'margen', valor: -5, ratio: 66 }).motivo, 'valor')
  assert.equal(metasDesdeComponente(base, st, { componente: 'retiros', valor: NaN, ratio: 66 }).ok, false)
  assert.equal(metasDesdeComponente(base, st, { componente: 'costos', valor: 5e6, ratio: 66 }).motivo, 'componente')
  assert.equal(metasDesdeComponente(base, st, { componente: 'ventas', valor: 5e8, ratio: null }).motivo, 'ratio')
  const vacia = { baseCLP: Array(12).fill(0), baseUF: Array(12).fill(0), ufDic: 40_000 }
  assert.equal(metasDesdeComponente(vacia, st, { componente: 'retiros', valor: 1e8, ratio: 66 }).motivo, 'base')
  assert.equal(cadenaMeta(vacia, st, 10, 66).fact, 0)
  const malo = estado(); malo.reserva = 100
  assert.equal(metasDesdeComponente(base, malo, { componente: 'retiros', valor: 1e8, ratio: 66 }).motivo, 'supuestos')
  const tiny = metasDesdeComponente(base, st, { componente: 'caja', valor: 1, ratio: 66 })   // caja menor que lo por cobrar de diciembre: facturado negativo
  assert.equal(tiny.ok, false)
})

test('días de cobro = 30: la variación de lo por cobrar es el diciembre completo y la inversa sigue cerrando', () => {
  const st = estado(); st.p.base.dias = 30
  const ida = cadenaMeta(base, st, 12, 66)
  cerca(ida.caja, ida.fact - (ida.ing[11] - base.baseCLP[11]), 1e-6)
  const v = metasDesdeComponente(base, st, { componente: 'caja', valor: ida.caja, ratio: 66 })
  cerca(v.g, 12, 1e-6)
})

test('los escenarios contra la meta: cuánto sobra o falta y el primer escenario que la cubre', () => {
  const st = estado(), m = modeloPresupuesto(base, st)
  const meta = m.esc.base.retiros
  const l = escenariosContraMeta(m, 'retiros', meta, 66)
  assert.equal(l.length, 3)
  assert.ok(l[0].dif < 0 && !l[0].cubre)                  // Prudente no la cubre
  assert.equal(l[1].cubre, true); cerca(l[1].dif, 0, 1e-6)
  assert.ok(l[2].dif > 0)
  assert.equal(nivelDeMeta(l), 'base')
  assert.equal(nivelDeMeta(escenariosContraMeta(m, 'retiros', m.esc.meta.retiros * 2, 66)), null)   // sobre el Optimista
  assert.equal(nivelDeMeta(escenariosContraMeta(m, 'ventas', 1, 66)), 'prudente')
})

test('a favor o en contra: más presupuesto de costos es en contra y en los demás componentes, más es a favor', () => {
  assert.equal(afavor('costos', true), false); assert.equal(afavor('costos', false), true)
  for (const c of ['ventas', 'fact', 'caja', 'margen', 'retiros']) { assert.equal(afavor(c, true), true); assert.equal(afavor(c, false), false) }
})

test('referencia 2026: meses transcurridos y cierre estimado con el promedio de los últimos meses cerrados', () => {
  cerca(mesesTranscurridos('2026-11-09'), 10.3, 1e-9); cerca(mesesTranscurridos('2026-12-31'), 12, 1e-9); cerca(mesesTranscurridos('2026-01-01'), 1 / 31, 1e-9)
  const c = cierreEstimado({ aFecha: 290, ultimos: [30, 40, 50], hoyISO: '2026-11-09' })
  cerca(c.promedio, 40, 1e-9); cerca(c.faltan, 1.7, 1e-9); cerca(c.resto, 68, 1e-9); cerca(c.cierre, 358, 1e-9)
  assert.equal(cierreEstimado({ aFecha: 100, ultimos: [], hoyISO: '2026-11-09' }).cierre, 100)         // sin meses cerrados no se inventa
  assert.equal(cierreEstimado({ aFecha: 100, ultimos: [10], hoyISO: '2026-12-31' }).resto, 0)           // fin de año: no queda nada por proyectar
  const r = referencia2026({ hoyISO: '2026-11-09', aFecha: { ventas: 500, fact: 330, caja: 290, retiros: 101 }, ultimos: { ventas: [40, 40, 40], fact: [30, 30, 30], caja: [28, 28, 28] }, costos: { real: 150, pptoResto: 25 }, terc: 10 })
  cerca(r.fact.cierre, 330 + 30 * 1.7, 1e-9); cerca(r.caja.cierre, 290 + 28 * 1.7, 1e-9)
  cerca(r.costos.cierre, 175, 1e-9)
  cerca(r.margen.cierre, r.caja.cierre * 0.9 - 175, 1e-9)                                              // plano de caja: cobrado − comisiones − costos
  assert.equal(r.retiros.cierre, 101)                                                                    // los retiros no se proyectan
  assert.equal(r.ventas.resto > 0, true)
})

test('reserva: la mínima de $30M es parámetro del estado, se suma a la del año y se expresa en meses de costos', () => {
  const st = estado()
  assert.equal(st.reservaIni, RESERVA_MINIMA); assert.equal(RESERVA_MINIMA, 30_000_000)
  const e = modeloPresupuesto(base, st).esc.base
  cerca(e.reservaCierre, 30_000_000 + e.reserva, 1e-6)
  cerca(e.mesesReserva, e.reservaCierre / (e.costos / 12), 1e-9)
  st.reservaIni = 0; cerca(modeloPresupuesto(base, st).esc.base.reservaCierre, e.reserva, 1e-6)
  assert.equal(modeloPresupuesto(base, { ...st, costos: [] }).esc.base.mesesReserva, null)             // sin costos no se divide por cero
})

test('reserva recomendada: 3 meses de costos con un aumento gradual por trimestre, sin tope sobre los retiros', () => {
  const r = reservaRecomendada({ costosAnio: 120_000_000, reservaIni: 30_000_000, reservaAnio: 20_000_000, post: 100_000_000 })
  assert.equal(r.objetivo, 30_000_000)                    // 3 meses de $10M
  assert.equal(r.brecha, 0); assert.equal(r.cubre, true); assert.equal(r.porTrimestre, 0)
  const q = reservaRecomendada({ costosAnio: 240_000_000, reservaIni: 30_000_000, reservaAnio: 10_000_000, post: 80_000_000 })
  assert.equal(q.objetivo, 60_000_000); assert.equal(q.brecha, 30_000_000); assert.equal(q.porTrimestre, 7_500_000)
  assert.deepEqual(q.niveles, [37_500_000, 45_000_000, 52_500_000, 60_000_000])
  assert.equal(q.cubre, false); assert.equal(q.falta, 20_000_000); cerca(q.pctNecesario, 37.5, 1e-9); cerca(q.mesesCierre, 2, 1e-9)
  assert.equal(reservaRecomendada({ costosAnio: 0, reservaIni: 5, reservaAnio: 0, post: 0 }).mesesCierre, null)
})

test('costos: el monto 2027 y el aumento se enlazan en los dos sentidos, también con rebajas', () => {
  const c = costos[2], alzaEsc = 4.5
  cerca(monto27(c, alzaEsc), 1_600_000 * 12 * 1.045, 1e-6)
  const p = fijarMonto27(c, 1_600_000 * 12 * 1.2); cerca(p.alza, 20, 1e-9)                           // monto → %
  cerca(monto27({ ...c, ...p }, alzaEsc), 1_600_000 * 12 * 1.2, 1e-6)                                 // % → mismo monto
  const rebaja = fijarMonto27(c, 1_600_000 * 12 * 0.9); cerca(rebaja.alza, -10, 1e-9)
  cerca(monto27({ ...c, ...fijarAlza(-10) }, alzaEsc), 1_600_000 * 12 * 0.9, 1e-6)
  assert.equal(fijarAlza(-250).alza, -100)                                                            // nunca bajo −100 %
  const nueva = { id: 9, n: 'Nueva partida', m: 0, meses: 12, t: 'fijo', alza: null }
  const q = fijarMonto27(nueva, 1_200_000); assert.equal(q.m, 100_000); assert.equal(q.alza, 0)
  cerca(monto27({ ...nueva, ...q }, alzaEsc), 1_200_000, 1e-6)
  assert.equal(fijarMonto27(c, -5).alza, -100)                                                        // monto negativo → 0
  const st = estado(); st.costos[0].alza = -50
  cerca(costosPresupuesto(st, 4.5), costosPresupuesto({ ...st, costos: st.costos.map((x, i) => (i ? x : { ...x, alza: null })) }, 4.5) - monto27({ ...costos[0], alza: null }, 4.5) + monto27({ ...costos[0], alza: -50 }, 4.5), 1e-6)
})

test('sueldo con reajuste reciente: el año base respeta la vigencia y se avisa para no reajustar dos veces', () => {
  const c = costos[0]
  cerca(costoAnualBase(c, 2026), 2_300_000 * 9 + 3_000_000 * 3, 1e-6)                                 // enero a septiembre al monto previo
  assert.equal(costoAnualBase(costos[2], 2026), 1_600_000 * 12)
  const r = reajusteVigente(c, 2026); cerca(r.pct, (3 / 2.3 - 1) * 100, 1e-9); assert.equal(r.desde, '2026-10-01')
  assert.equal(reajusteVigente(costos[2], 2026), null)
  assert.equal(reajusteVigente({ ...c, desde: '2025-03-01' }, 2026), null)
  assert.equal(costoAnualBase({ ...c, desde: '2027-02-01' }, 2026), 2_300_000 * 12)                   // el reajuste aún no rige
})

test('un borrador antiguo con Remuneraciones en una sola partida se desglosa por persona sin cambiar el total', () => {
  const vigentes = costos
  const antiguo = [{ id: 0, n: 'Remuneraciones', m: 8_000_000, meses: 12, t: 'fijo', alza: 7 }, { id: 1, n: 'Arriendo y espacio', m: 3_000_000, meses: 12, t: 'fijo', alza: null }]
  const d = desglosarCostos(antiguo, vigentes)
  const rem = d.filter((c) => c.g === 'Remuneraciones')
  assert.equal(rem.length, 3); assert.ok(rem.every((c) => c.alza === 7 && c.meses === 12))
  cerca(rem.reduce((a, c) => a + c.m, 0), 8_000_000, 3)
  assert.equal(d.find((c) => c.n === 'Arriendo y espacio').g, undefined)
  assert.deepEqual(desglosarCostos(d, vigentes), d)                                                   // idempotente
  assert.deepEqual(desglosarCostos(antiguo, [{ id: 'z', n: 'Arriendo y espacio', m: 1, meses: 12, t: 'fijo', alza: null }]), antiguo)   // sin personas, no toca nada
})

test('sueldos y retiros de los socios: el mismo dinero por socio, sin doble conteo', () => {
  assert.equal(esDePersona('Asociada senior · Javiera', 'Javiera'), true); assert.equal(esDePersona('Cristóbal Liberona', 'Cristobal'), true); assert.equal(esDePersona('Martín', 'Erasmo'), false)
  const st = estado(), m = modeloPresupuesto(base, st), e = m.esc.base
  const r = sueldosYRetiros({ socios: ['Cristóbal', 'Erasmo'], costos: st.costos, alza: st.p.base.alza, retiros: e.retiros, real: { sueldos: { Cristóbal: 24e6, Erasmo: 23e6 }, retiros: { Cristóbal: 50e6, Erasmo: 50e6 } } })
  cerca(r.filas[0].sueldo27, 3_000_000 * 12 * 1.045, 1e-6)                                            // sigue el alza del escenario
  cerca(r.filas[1].sueldo27, 3_000_000 * 12, 1e-6)                                                    // alza propia 0 %
  cerca(r.filas[0].leyes27, 900_000 * 12 * 1.045, 1e-6)                                               // leyes sociales: costo de la oficina
  cerca(r.filas[0].ret27 + r.filas[1].ret27, e.retiros, 1e-6); cerca(r.filas[0].ret27, e.retiros / 2, 1e-6)
  cerca(r.total.tot27, r.total.sueldo27 + r.total.ret27, 1e-6); cerca(r.total.tot26, 24e6 + 23e6 + 100e6, 1e-6)
  const antes = JSON.stringify(m.esc.base)
  sueldosYRetiros({ socios: ['Cristóbal'], costos: st.costos, alza: 4.5, retiros: 1, real: { sueldos: {}, retiros: {} } })
  assert.equal(JSON.stringify(modeloPresupuesto(base, st).esc.base), antes)                           // la vista no mueve Margen ni Retiros
})

test('migración v3 → v4: las etapas desde la 4.ª se desplazan, se agregan metas y reserva, y es idempotente', () => {
  const v3 = { v: 3, esc: 'base', hecho: [0, 1, 2, 3, 4], notas: { 0: 'a', 3: 'escenarios', 4: 'seguimiento' }, p: {}, costos: [], tasaIDPC: 12.5, ppmAnual: 1 }
  const m = migrarEstado(v3, 2027)
  assert.equal(m.v, 7); assert.deepEqual(m.hecho, [0, 1, 2, 4, 5]); assert.deepEqual(m.arrastre, { ajustes: {}, extras: [] })
  assert.deepEqual(m.notas, { 0: 'a', 4: 'escenarios', 5: 'seguimiento' })
  assert.deepEqual(m.metas, { ancla: 'retiros', valor: null, ratio: null }); assert.equal(m.reservaIni, RESERVA_MINIMA)
  assert.deepEqual(migrarEstado(m, 2027), m)
  const m4 = migrarEstado({ v: 4, hecho: [3], notas: {}, metas: { ancla: 'caja', valor: 5, ratio: 70 }, reservaIni: 10 })
  assert.equal(m4.v, 7); assert.deepEqual(m4.hecho, [3]); assert.deepEqual(m4.metas, { ancla: 'caja', valor: 5, ratio: 70 }); assert.equal(m4.reservaIni, 10); assert.equal(m4.ppmAnual, 0)
  assert.equal(migrarEstado(null).v, 7)
  assert.equal(estadoInicial({ costos }).v, 7); assert.deepEqual(estadoInicial({ costos }).arrastre, { ajustes: {}, extras: [] })
  assert.equal(supuestosMetas(estado()).alza, 4.5)
  // v5 → v6: el bloque del Arrastre aparece vacío; uno con ajustes se conserva y se limpia
  const v5 = migrarEstado({ v: 5, esc: 'base', hecho: [1], notas: {}, p: {}, costos: [], escs: [{ k: 'base', n: 'Base', t: 0 }] }, 2027)
  assert.equal(v5.v, 7); assert.deepEqual(v5.arrastre, { ajustes: {}, extras: [] })
  const v6 = migrarEstado({ ...v5, arrastre: { ajustes: { 'pf:s1': { monto: 5, nota: ' se cae ' }, vacio: {} }, extras: [{ id: 'n1', nombre: 'Nuevo', mensual: 10, desde: 3, meses: 4 }] } }, 2027)
  assert.deepEqual(v6.arrastre, { ajustes: { 'pf:s1': { monto: 5, nota: 'se cae' } }, extras: [{ id: 'n1', nombre: 'Nuevo', mensual: 10, desde: 3, meses: 4 }] }); assert.deepEqual(migrarEstado(v6, 2027), v6)
})
