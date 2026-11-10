// Presupuesto · la meta de ventas se mide NETA de comisiones a terceros (como metricasAnio().neto de Inicio): relación bruto ↔ neto, ida y vuelta por la cadena de metas. Datos de ejemplo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  estadoInicial, modeloPresupuesto, cadenaMeta, metasDesdeComponente, valorComponente, ventasDeFact, ventasBrutoDeFact, netoDeBruto, brutoDeNeto, escenariosContraMeta,
} from './../supabase/functions/_shared/presupuesto.js'
import { hojasPresupuesto, evaluar } from './../src/lib/presupuestoExcel.js'

const costos = [{ id: 0, n: 'Sueldos', m: 5_000_000, meses: 12, t: 'fijo', alza: null }, { id: 1, n: 'Arriendo', m: 1_000_000, meses: 12, t: 'fijo', alza: null }]
const base = { baseCLP: Array.from({ length: 12 }, (_, i) => 10_000_000 + i * 700_000), baseUF: Array.from({ length: 12 }, (_, i) => 250 + i * 15), ufDic: 40_000 }
const cerca = (a, b, tol = 1) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`)

test('bruto ↔ neto: neto = bruto − comisiones (la fórmula de metricasAnio) y la inversa vuelve al bruto', () => {
  const bruto = 500_000_000, costo = 98_000_000, cv = (costo / bruto) * 100          // cv = comisión observada sobre el bruto
  cerca(netoDeBruto(bruto, cv), bruto - costo, 1e-3)
  cerca(brutoDeNeto(bruto - costo, cv), bruto, 1e-3)
  assert.equal(netoDeBruto(100, 0), 100); assert.equal(brutoDeNeto(100, 0), 100); assert.equal(brutoDeNeto(100, 100), null)   // 100 % de comisión no tiene inverso
  assert.equal(netoDeBruto(100, null), 100)
})

test('ventasDeFact: sin comisión es el de siempre; con comisión es neto, y el bruto sale de la relación facturado/vendido', () => {
  cerca(ventasDeFact(66, 66), 100, 1e-9)                                              // regresión: sin cv, igual que antes
  cerca(ventasBrutoDeFact(66, 66), 100, 1e-9)
  cerca(ventasDeFact(66, 66, 20), 80, 1e-9)                                           // bruto 100, comisiones 20 % → neto 80
  assert.equal(ventasDeFact(66, 0, 20), null); assert.equal(ventasDeFact(66, null), null)
})

test('cadena de metas: Vendido es el neto y se abre en bruto − comisiones; sin comisión no cambia nada', () => {
  const st = estadoInicial({ costos, tasa: 12.5 })
  const sin = cadenaMeta(base, st, 12, 66), con = cadenaMeta(base, st, 12, 66, 20)
  cerca(sin.ventas, sin.fact / 0.66, 1e-6); assert.equal(sin.comisVentas, 0)
  cerca(con.ventasBruto, con.fact / 0.66, 1e-6); cerca(con.ventas, con.ventasBruto * 0.8, 1e-6); cerca(con.comisVentas, con.ventasBruto * 0.2, 1e-6)
  cerca(con.ventas + con.comisVentas, con.ventasBruto, 1e-6)                          // neto + comisiones = bruto
  for (const k of ['fact', 'caja', 'retiros', 'margen']) cerca(con[k], sin[k], 1e-6)  // la comisión sobre ventas solo mueve Vendido, no la cascada de caja
})

test('ida y vuelta con comisión: escribir la meta de ventas NETA devuelve el mismo neto, y el crecimiento exigido sube', () => {
  const st = estadoInicial({ costos, tasa: 12.5 }), ratio = 66
  for (const cv of [0, 10, 24.4, 40]) for (const g0 of [-10, 0, 10, 25]) {
    const ch = cadenaMeta(base, st, g0, ratio, cv), meta = ch.ventas
    const r = metasDesdeComponente(base, st, { componente: 'ventas', valor: meta, ratio, cv })
    assert.ok(r.ok, `cv ${cv} g ${g0}`); cerca(r.g, g0, 1e-6); cerca(r.ventas, meta, 1e-4); cerca(r.fact, ch.fact, 1e-3); cerca(r.retiros, ch.retiros, 1e-3)
  }
  const a = metasDesdeComponente(base, st, { componente: 'ventas', valor: 300_000_000, ratio, cv: 0 }), b = metasDesdeComponente(base, st, { componente: 'ventas', valor: 300_000_000, ratio, cv: 20 })
  assert.ok(b.g > a.g)                                                                // la misma meta neta pide más bruto, más facturado y más crecimiento
  assert.equal(metasDesdeComponente(base, st, { componente: 'ventas', valor: 3e8, ratio, cv: 100 }).ok, false)   // comisión 100 %: sin solución, sin reventar
  assert.equal(metasDesdeComponente(base, st, { componente: 'ventas', valor: 3e8, ratio: null, cv: 10 }).motivo, 'ratio')
  // los demás componentes no dependen de la comisión sobre ventas
  const x = metasDesdeComponente(base, st, { componente: 'retiros', valor: 40_000_000, ratio, cv: 0 }), y = metasDesdeComponente(base, st, { componente: 'retiros', valor: 40_000_000, ratio, cv: 30 })
  cerca(x.g, y.g, 1e-9); cerca(y.ventas, x.ventas * 0.7, 1e-3)
})

test('los escenarios se comparan con la meta de ventas neta', () => {
  const st = estadoInicial({ costos }), m = modeloPresupuesto(base, st), cv = 20
  const l = escenariosContraMeta(m, 'ventas', 1, 66, cv)
  for (const x of l) cerca(x.valor, valorComponente(m.esc[x.k], 'ventas', 66, cv), 1e-6)
  cerca(l[1].valor, m.esc.base.fact / 0.66 * 0.8, 1e-3)
})

test('Excel: Vendido neto y bruto con la comisión coinciden con la cadena de la app', () => {
  const st = estadoInicial({ costos, tasa: 15, ppmMes: 100_000 }), ratio = 66, cv = 20
  st.metas = { ancla: 'ventas', valor: 280_000_000, ratio, cv }
  const P = { anio: 2027, anioBase: 2026, ufDic: base.ufDic, baseCLP: base.baseCLP, baseUF: base.baseUF, est: st, ESC: [['prudente', 'P'], ['base', 'B'], ['meta', 'O']], costos: st.costos, socios: [{ nombre: 'A', facturado: 1 }], oficiales: { vend: { uf: 0, clp: 0 }, fact: { uf: 0, clp: 0 }, cob: { uf: 0, clp: 0 }, marg: { uf: 0, clp: 0 }, metaVentasCLP: 0, metaCobroCLP: 0 }, mes26: [], metas: { ancla: 'ventas', valor: 280_000_000 }, ratio, cv }
  const h = evaluar(hojasPresupuesto(P)), hoja = h.find((x) => x.nombre === 'Metas 2027').filas, v = (fila) => hoja[fila - 1][1].v
  const r = metasDesdeComponente(base, st, { componente: 'ventas', valor: 280_000_000, ratio, cv })
  cerca(v(14), 280_000_000, 1e-3); cerca(v(15), r.fact, 1e-3); cerca(v(12), r.g, 1e-6)       // vendido neto = la meta, facturado y crecimiento = los de la app
  cerca(v(26), r.ventasBruto, 1e-3); cerca(v(27), r.comisVentas, 1e-3)
})

// H03 · los retiros por socio salen de parteMeta / partePorSocio (config), no de un «/ 2» cableado: 1, 2 y 3 socios, con y sin reparto configurado.
import { parteMeta, partePorSocio } from './../supabase/functions/_shared/presupuesto.js'
test('parte por socio: 1, 2 y 3 socios con partes iguales; «Sin socio» no cuenta y el reparto configurado manda', () => {
  const S = (n) => [...Array.from({ length: n }, (_, i) => ({ nombre: 'S' + i })), { nombre: 'Sin socio' }]
  for (const n of [1, 2, 3]) { cerca(partePorSocio(S(n)), 1 / n, 1e-12); cerca(parteMeta(S(n), 'S0') * 120, 120 / n, 1e-9); assert.equal(parteMeta(S(n), 'Sin socio'), 0) }
  const cfg = { socios: { reparto: { S0: 0.6, S1: 0.4 } } }
  cerca(parteMeta(S(2), 'S0', cfg) + parteMeta(S(2), 'S1', cfg), 1, 1e-12); cerca(partePorSocio(S(2), cfg), 0.5, 1e-12)
  assert.equal(partePorSocio([], undefined), 0)
})

// ── Comparar versiones: diferencias estructuradas con metas y notas ──
import { diferenciaEstructurada, diferenciaSupuestos } from './../supabase/functions/_shared/presupuesto.js'
test('diferencia estructurada: agrupa Supuestos, Costos, Metas y Notas; solo lo que cambió; igual da vacío', () => {
  const f = { mm: (n) => `$${(n / 1e6).toFixed(1)}M`, pc: (n) => `${n} %` }
  const A = estadoInicial({ costos, tasa: 12.5 }), B = JSON.parse(JSON.stringify(A))
  assert.deepEqual(diferenciaEstructurada(A, B, f), [])
  B.tasaIDPC = 15; B.p.base.g = 12; B.costos[0].m = 5_500_000; B.metas = { ancla: 'retiros', valor: 200_000_000, ratio: null }; B.notas = { 2: 'Revisar alza' }
  const d = diferenciaEstructurada(A, B, f), g = (x) => d.filter((r) => r.grupo === x)
  assert.equal(g('Supuestos').length, 2); assert.equal(g('Costos').length, 1); assert.equal(g('Metas').length, 1); assert.equal(g('Notas').length, 1)
  assert.deepEqual(g('Costos')[0], { grupo: 'Costos', etiqueta: 'Sueldos · por mes', antes: '$5.0M', despues: '$5.5M' })
  assert.equal(g('Notas')[0].despues, 'Revisar alza'); assert.equal(g('Notas')[0].antes, '—')
  assert.ok(diferenciaSupuestos(A, B, f).some((x) => /Tasa de primera categoría/.test(x)))
})

import { referenciaSeguimiento } from './../supabase/functions/_shared/presupuesto.js'
test('referencia del Seguimiento: la oficial manda; sin oficial, el año en curso anterior a 2027 va contra las metas y desde 2027 contra el borrador', () => {
  assert.equal(referenciaSeguimiento({ actual: true, hayOficial: false, anio: 2026 }), 'metas'); assert.equal(referenciaSeguimiento({ actual: true, hayOficial: false, anio: 2027 }), 'borrador')
  assert.equal(referenciaSeguimiento({ actual: false, hayOficial: false, anio: 2027 }), 'borrador'); assert.equal(referenciaSeguimiento({ actual: false, hayOficial: false, anio: 2028 }), 'borrador')
  assert.equal(referenciaSeguimiento({ actual: true, hayOficial: true, anio: 2026 }), 'oficial'); assert.equal(referenciaSeguimiento({ actual: false, hayOficial: true, anio: 2028 }), 'oficial')
})

import { cotizacionEmpleador } from './../supabase/functions/_shared/presupuesto.js'
import { CONFIG_DEFECTO as CFG_DEF } from './../supabase/functions/_shared/presupuestoConfig.js'
test('cotización del empleador (Ley 21.735): 2027 sube 0,75 puntos de agosto a diciembre; 2028 todo el año; base vacía o tasa 0 no suman', () => {
  const cal = CFG_DEF.previsional.empleador, base = { imponibleMensual: 10_000_000, baseYM: '2026-10', calendario: cal }
  const a27 = cotizacionEmpleador({ anio: 2027, ...base }); cerca(a27.total, 375_000, 1e-6); assert.equal(a27.tasaBase, 3.5); assert.equal(a27.meses.filter((m) => m.extra > 0).length, 5)
  cerca(cotizacionEmpleador({ anio: 2028, ...base }).total, 7 * 75_000 + 5 * 150_000, 1e-6)
  assert.equal(cotizacionEmpleador({ anio: 2027, ...base, imponibleMensual: 0 }).total, 0); assert.equal(cotizacionEmpleador({ anio: 2027, ...base, imponibleMensual: null }).total, 0)
  assert.equal(cotizacionEmpleador({ anio: 2027, ...base, calendario: [] }).total, 0)   // tasa 0: nada que sumar
  assert.equal(cotizacionEmpleador({ anio: 2026, ...base }).total, 0)                 // 2026 ya está en la base (3,5 % desde ago-2026)
})
