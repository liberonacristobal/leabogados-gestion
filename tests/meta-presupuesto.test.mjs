// Paso 4 del Presupuesto: meta en $ o en %, falta facturar contra el arrastre y aviso bajo el cierre estimado. Datos de ejemplo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estadoInicial, metasDesdeComponente, modeloPresupuesto, escenarioMetas } from './../supabase/functions/_shared/presupuesto.js'
import { modoDeMeta, valorDeMeta, pctSobreCierre, metaBajoCierre, faltaFacturar, resolverMeta, cobranzaAnio, flujoMensualMeta, escenariosMeta, estConMetaIdeal } from './../supabase/functions/_shared/metaPresupuesto.js'

test('la meta en % es el cierre estimado × (1 + %) y en $ es el valor escrito', () => {
  assert.equal(modoDeMeta({ modo: 'pct', pct: -6.3 }), 'pct'); assert.equal(modoDeMeta({ modo: 'pct' }), 'clp'); assert.equal(modoDeMeta(undefined), 'clp')
  assert.ok(Math.abs(valorDeMeta({ modo: 'pct', pct: -6.3 }, 537_300_000) - 503_450_100) < 1)
  assert.equal(valorDeMeta({ modo: 'clp', valor: 500_000_000, pct: 3 }, 537_300_000), 500_000_000)
  assert.equal(valorDeMeta({ modo: 'pct', pct: 5 }, 0), null); assert.equal(valorDeMeta({ modo: 'clp', valor: 0 }, 10), null); assert.equal(valorDeMeta(null, 10), null)
})
test('el % sobre el cierre y su inverso coinciden; sin cierre no hay %', () => {
  const v = valorDeMeta({ modo: 'pct', pct: 12.5 }, 400); assert.ok(Math.abs(pctSobreCierre(v, 400) - 12.5) < 1e-9)
  assert.equal(pctSobreCierre(100, 0), null); assert.equal(pctSobreCierre(null, 10), null)
})
test('aviso bajo el cierre: solo si la meta es menor; igual o mayor no avisa', () => {
  const a = metaBajoCierre(503_400_000, 537_300_000); assert.equal(a.bajo, true); assert.ok(Math.abs(a.pct + 6.31) < 0.01); assert.equal(a.dif, -33_900_000)
  assert.equal(metaBajoCierre(537_300_000, 537_300_000).bajo, false); assert.equal(metaBajoCierre(600, 537).bajo, false); assert.equal(metaBajoCierre(5, 0).bajo, false)
})
test('falta facturar = facturado de la meta − arrastre, con equivalencias; sin negativos', () => {
  const r = faltaFacturar({ factMeta: 400_000_000, arrastre: 250_000_000, ufMed: 40_000, ratio: 80, cv: 10 })
  assert.equal(r.falta, 150_000_000); assert.equal(r.exceso, 0); assert.equal(r.alMes, 12_500_000); assert.equal(r.uf, 3750); assert.ok(Math.abs(r.pct - 37.5) < 1e-9)
  assert.ok(Math.abs(r.vendido - 150_000_000 / 0.8 * 0.9) < 1)
  const s = faltaFacturar({ factMeta: 100, arrastre: 130 }); assert.equal(s.falta, 0); assert.equal(s.exceso, 30); assert.equal(s.vendido, 0); assert.equal(s.uf, null)
  assert.equal(faltaFacturar({ factMeta: 0, arrastre: 0 }).pct, 0); assert.equal(faltaFacturar({ factMeta: 10, arrastre: 5, ratio: null }).vendido, null)
})

const cierres = { ventas: 537_300_000, fact: 392_400_000, caja: 369_300_000, margen: 171_600_000, retiros: 101_000_000 }, anclas = Object.keys(cierres)
test('meta por defecto: Vendido fijada en su cierre estimado; lo guardado se respeta', () => {
  const d = resolverMeta({ metas: { ancla: 'retiros', valor: null, ratio: null }, cierres, anclas })
  assert.equal(d.ancla, 'ventas'); assert.equal(d.valor, 537_300_000); assert.equal(d.porDefecto, true); assert.equal(d.modo, 'clp'); assert.equal(d.rec, 0)
  const f = resolverMeta({ metas: { ancla: 'caja', valor: 400_000_000, rec: 34_300_000 }, cierres, anclas })
  assert.equal(f.ancla, 'caja'); assert.equal(f.valor, 400_000_000); assert.equal(f.valorCadena, 365_700_000); assert.equal(f.porDefecto, false)
  const o = resolverMeta({ metas: { ancla: 'ventas', valor: 503_400_000, rec: 5 }, cierres, anclas }); assert.equal(o.valorCadena, 503_400_000)   // la recuperación solo resta con Cobrado fijada
})
test('meta en %: cada cifra fijada se mide contra su propio cierre estimado', () => {
  const r = resolverMeta({ metas: { ancla: 'caja', modo: 'pct', pct: 8.3, valor: 1 }, cierres, anclas })
  assert.equal(r.modo, 'pct'); assert.ok(Math.abs(r.valor - 369_300_000 * 1.083) < 1); assert.equal(r.pct, 8.3)
  assert.equal(resolverMeta({ metas: { ancla: 'caja', modo: 'pct', pct: 8, valor: 400 }, cierres: { ...cierres, caja: 0 }, anclas }).modo, 'clp')   // sin cierre el % no se traduce
  assert.equal(resolverMeta({ metas: null, cierres: { ventas: 0 }, anclas: ['ventas'] }).valor, null)
})
test('cobranza: cobro del año + recuperación; avisa si la recuperación supera la mora', () => {
  const a = cobranzaAnio({ cobro: 365_700_000, rec: 34_300_000, mora: 43_600_000, porCobrar: 60_400_000, cierre: 369_300_000 })
  assert.equal(a.total, 400_000_000); assert.equal(a.dentroMora, true); assert.equal(a.exceso, 0); assert.ok(Math.abs(a.sobreCierre - 8.3) < 0.05)
  const b = cobranzaAnio({ cobro: 100, rec: 60, mora: 50 }); assert.equal(b.dentroMora, false); assert.equal(b.exceso, 10); assert.equal(b.sobreCierre, null)
  assert.equal(cobranzaAnio({ cobro: -5, rec: -1, mora: 0 }).total, 0)
})
test('flujo mensual: meta en partes iguales, arrastre por mes y diferencia que suma lo que falta', () => {
  const ar = [27, 26, 31, 21, 25, 17, 21, 15, 21, 15, 15, 20], f = flujoMensualMeta(367.2, ar)
  assert.ok(Math.abs(f.totales.falta - (367.2 - 254)) < 1e-9); assert.ok(f.falta[2] < 0 === (367.2 / 12 < 31)); assert.equal(f.meta.length, 12); assert.equal(flujoMensualMeta(null, null).totales.falta, 0)
  const g = faltaFacturar({ factMeta: 400, arrastre: 250, cierreFact: 300 }); assert.ok(Math.abs(g.sobreCierre - 50) < 1e-9); assert.ok(Math.abs(g.sobreArrastre - 60) < 1e-9)
})

const costosE = [{ id: 'a', n: 'Sueldos', m: 5_000_000, meses: 12, t: 'fijo', alza: null }, { id: 'e', n: 'Arriendo', m: 3_000_000, meses: 12, t: 'fijo', alza: null }]
const baseE = { baseCLP: Array.from({ length: 12 }, (_, i) => 22_000_000 + i * 1_000_000), baseUF: Array.from({ length: 12 }, (_, i) => 560 + i * 25), ufDic: 40_000 }
const estE = estadoInicial({ costos: costosE, tasa: 12.5, ppmMes: 100_000 })
test('escenarios del paso 5: Conservador repite el cierre, Ideal es la meta del paso 4 y Optimista suma el sobrecumplimiento', () => {
  const cierre = 400_000_000, meta = 360_000_000, ratio = 70, cv = 10
  const chIdeal = metasDesdeComponente(baseE, estE, { componente: 'ventas', valor: meta, ratio, cv })
  const E = escenariosMeta({ base: baseE, est: estE, ancla: 'ventas', valorCadena: meta, cierre, rec: 5_000_000, mora: 8_000_000, porCobrar: 20_000_000, ratio, cv, arrastre: 150_000_000, ufMed: 40_000, cierreFact: 300_000_000, chIdeal })
  assert.deepEqual(E.map((e) => e.k), ['conservador', 'ideal', 'optimista']); assert.ok(E.every((e) => e.ok))
  assert.ok(Math.abs(E[0].ventas - cierre) < 1); assert.ok(Math.abs(E[1].ventas - meta) < 1); assert.ok(Math.abs(E[2].ventas - meta * 1.13) < 1)
  assert.equal(E[1].ch, chIdeal)                                      // la misma cadena del paso 4, sin recalcular
  assert.ok(E[0].ch.fact > E[1].ch.fact && E[2].ch.fact > E[1].ch.fact && E[2].ch.retiros > E[1].ch.retiros)
  assert.equal(E[0].cobranza.rec, 0); assert.equal(E[1].cobranza.rec, 5_000_000); assert.ok(Math.abs(E[2].cobranza.rec - E[2].ch.caja * 0.2) < 1)
  assert.equal(E[1].cobranza.dentroMora, true); assert.equal(E[2].cobranza.dentroMora, E[2].cobranza.rec <= 8_000_000)
  assert.ok(Math.abs(E[1].falta.falta - (chIdeal.fact - 150_000_000)) < 1)
})
test('escenarios del paso 5: sin cierre o sin meta, el escenario queda sin cifras en vez de inventarlas; el sobrecumplimiento es configurable', () => {
  const chIdeal = metasDesdeComponente(baseE, estE, { componente: 'ventas', valor: 360_000_000, ratio: 70, cv: 10 })
  const sin = escenariosMeta({ base: baseE, est: estE, ancla: 'ventas', valorCadena: 360_000_000, cierre: 0, rec: 0, mora: 0, ratio: 70, cv: 10, arrastre: 0, chIdeal })
  assert.equal(sin[0].ok, false); assert.equal(sin[0].ch, null); assert.equal(sin[1].ok, true)
  const dos = escenariosMeta({ base: baseE, est: estE, ancla: 'ventas', valorCadena: 360_000_000, cierre: 400_000_000, rec: 0, mora: 0, ratio: 70, cv: 10, arrastre: 0, chIdeal, sobreVentas: 0, sobreCobranza: 0 })
  assert.ok(Math.abs(dos[2].ventas - 360_000_000) < 1); assert.equal(dos[2].cobranza.rec, 0)
})

test('la franja del paso 5 es el Ideal: el escenario de referencia con el crecimiento de la meta da el margen, el resultado y los retiros del paso 4', () => {
  const k = escenarioMetas(estE), ch = metasDesdeComponente(baseE, estE, { componente: 'retiros', valor: 90_000_000, ratio: 70, cv: 10 })
  assert.ok(ch.ok)
  const v = estConMetaIdeal(estE, ch, k), m = modeloPresupuesto(baseE, v).esc[k]
  for (const campo of ['fact', 'caja', 'terc', 'costos', 'base', 'idpc', 'post', 'reserva', 'retiros']) assert.ok(Math.abs(m[campo] - ch[campo]) < 1, campo)   // franja = paso 4
  const E = escenariosMeta({ base: baseE, est: estE, ancla: 'retiros', valorCadena: 90_000_000, cierre: 100_000_000, rec: 0, mora: 0, ratio: 70, cv: 10, arrastre: 0, chIdeal: ch })
  assert.ok(Math.abs(E[1].ch.retiros - m.retiros) < 1)                                                                                                     // = Ideal
  assert.equal(v.esc, k); assert.equal(estE.p[k].g === v.p[k].g, false)                                                                                    // no toca lo escrito
  assert.equal(estConMetaIdeal(estE, null, k).p, estE.p)                                                                                                   // sin cadena válida, igual
})
