// Presupuesto · configuración por estudio: los defectos reproducen EXACTAMENTE las cifras de siempre (regresión, valores tomados antes del cambio) y cambiar la configuración cambia el resultado. Datos de ejemplo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  estadoInicial, modeloPresupuesto, cadenaMeta, metasDesdeComponente, reservaRecomendada, tasaIDPCLegal, tasaPPMLegal, parteMeta, componentesDe, anclasDe, nombreComponente, migrarEstado, sueldosYRetiros,
} from './../supabase/functions/_shared/presupuesto.js'
import { CONFIG_DEFECTO, configPresupuesto, mezclarConfig, tramoDelAnio } from './../supabase/functions/_shared/presupuestoConfig.js'

const costos = [
  { id: 0, n: 'Sueldos', m: 5_000_000, meses: 12, t: 'fijo', alza: null, g: 'Remuneraciones' },
  { id: 1, n: 'Arriendo', m: 1_000_000, meses: 12, t: 'fijo', alza: null },
]
const base = { baseCLP: Array.from({ length: 12 }, (_, i) => 10_000_000 + i * 700_000), baseUF: Array.from({ length: 12 }, (_, i) => 250 + i * 15), ufDic: 40_000 }
const estado = (o = {}) => estadoInicial({ costos, terc: 24.4, dias: 30, anio: 2027, ppmMes: 100_000, reajusteUF: 3.5, ...o })
const r0 = (x) => Math.round(x)

test('regresión: con la configuración por defecto, el modelo da las mismas cifras de antes (pesos redondeados)', () => {
  const st = estado(), m = modeloPresupuesto(base, st)
  const dorado = {
    prudente: { fact: 162860452, caja: 163552452, costos: 76320000, terc: 39906798, base: 47325653, idpc: 5915707, post: 41409947, retiros: 35198455, reserva: 6211492, reservaCierre: 36211492, saldo: 4715707, dCob: -692000 },
    base: { fact: 179146497, caja: 177947397, costos: 75240000, terc: 43419165, base: 59288232, idpc: 7411029, post: 51877203, retiros: 44095622, reserva: 7781580, reservaCierre: 37781580, saldo: 6211029, dCob: 1199100 },
    meta: { fact: 203575564, caja: 199799314, costos: 75240000, terc: 48751033, base: 75808282, idpc: 9476035, post: 66332247, retiros: 56382410, reserva: 9949837, reservaCierre: 39949837, saldo: 8276035, dCob: 3776250 },
  }
  for (const k of Object.keys(dorado)) for (const [campo, v] of Object.entries(dorado[k])) assert.equal(r0(m.esc[k][campo]), v, `${k}.${campo}`)
  const ch = cadenaMeta(base, st, 12, 66)
  assert.deepEqual([r0(ch.fact), r0(ch.caja), r0(ch.retiros), r0(ch.ventas)], [182403706, 180860986, 45733861, 276369251])
  const inv = metasDesdeComponente(base, st, { componente: 'retiros', valor: 50_000_000, ratio: 66 })
  assert.deepEqual([Math.round(inv.g * 1000) / 1000, r0(inv.fact), r0(inv.ventas)], [17.208, 190885810, 289220924])
  assert.deepEqual([tasaIDPCLegal(2027), tasaIDPCLegal(2028), tasaIDPCLegal(2030), tasaPPMLegal(2027, 1000), tasaPPMLegal(2027, 60000), tasaPPMLegal(2029, 1000), tasaPPMLegal(2029, 60000)], [12.5, 15, 25, 0.125, 0.25, 0.25, 0.5])
  const rr = reservaRecomendada({ costosAnio: m.esc.base.costos, reservaIni: st.reservaIni, reservaAnio: m.esc.base.reserva, post: m.esc.base.post })
  assert.deepEqual([r0(rr.objetivo), r0(rr.porTrimestre), rr.mesesCierre], [18810000, 0, 6.025770404962991])
  assert.deepEqual(st.p, { prudente: { g: 0, alza: 6, terc: 24.4, dias: 40 }, base: { g: 10, alza: 4.5, terc: 24.4, dias: 30 }, meta: { g: 25, alza: 4.5, terc: 24.4, dias: 30 } })
  assert.deepEqual([st.reservaIni, st.tasaIDPC, st.ppmAnual, st.reserva, st.reajusteUF], [30_000_000, 12.5, 1_200_000, 15, 3.5])
  assert.deepEqual(componentesDe().map((x) => x[1]), ['Vendido', 'Facturado', 'Cobrado', 'Presupuesto de costos', 'Margen', 'Retiros'])
  assert.deepEqual(estado({ cfg: configPresupuesto() }), st)                              // pasar la configuración por defecto explícita no cambia nada
})

test('configuración: mezclar no toca el defecto, reemplaza arreglos y mezcla objetos', () => {
  const antes = JSON.stringify(CONFIG_DEFECTO)
  const c = configPresupuesto({ reserva: { minima: 1 }, tributario: { idpc: [{ tasa: 27 }] }, socios: { reparto: { A: 0.7, B: 0.3 } } })
  assert.equal(c.reserva.minima, 1); assert.equal(c.reserva.porcentaje, 15); assert.equal(c.reserva.meses, 3)       // objeto: se mezcla clave a clave
  assert.deepEqual(c.tributario.idpc, [{ tasa: 27 }]); assert.equal(c.tributario.ppm.umbralUF, 50000)                // arreglo: se reemplaza
  assert.equal(JSON.stringify(CONFIG_DEFECTO), antes)
  assert.deepEqual(mezclarConfig({ a: 1, b: { c: 2 } }, undefined), { a: 1, b: { c: 2 } })
  assert.deepEqual(mezclarConfig({ a: 1 }, { a: 2, z: [1] }), { a: 2, z: [1] })
  assert.equal(tramoDelAnio([{ hasta: 2027, x: 1 }, { x: 2 }], 2030).x, 2); assert.equal(tramoDelAnio([{ hasta: 2027, x: 1 }], 2030).x, 1); assert.equal(tramoDelAnio([], 2030), null)
})

test('otra tasa tributaria cambia el impuesto, los retiros y la tasa de partida del estado y de la migración', () => {
  const cfg = configPresupuesto({ tributario: { idpc: [{ hasta: 2030, tasa: 27 }, { tasa: 30 }], ppm: { umbralUF: 1000, tramos: [{ chica: 1, grande: 2 }] } } })
  assert.equal(tasaIDPCLegal(2027, cfg), 27); assert.equal(tasaIDPCLegal(2031, cfg), 30); assert.equal(tasaPPMLegal(2027, 500, cfg), 1); assert.equal(tasaPPMLegal(2027, 5000, cfg), 2)
  const a = estado(), b = estado({ cfg })
  assert.equal(b.tasaIDPC, 27); assert.ok(modeloPresupuesto(base, b).esc.base.idpc > modeloPresupuesto(base, a).esc.base.idpc); assert.ok(modeloPresupuesto(base, b).esc.base.retiros < modeloPresupuesto(base, a).esc.base.retiros)
  // el borrador v2 con la tasa de partida (15 %) pasa a la legal de la configuración
  assert.equal(migrarEstado({ v: 2, tasaIDPC: 15, p: {}, hecho: [], notas: {} }, 2027, 0, cfg).tasaIDPC, 27)
  assert.equal(migrarEstado({ v: 2, tasaIDPC: 15, p: {}, hecho: [], notas: {} }, 2027).tasaIDPC, 12.5)
})

test('otra reserva (mínima, porcentaje, regla de meses) cambia la reserva al cierre y la recomendación', () => {
  const cfg = configPresupuesto({ reserva: { minima: 60_000_000, porcentaje: 30, meses: 6, trimestres: 2 } })
  const a = estado(), b = estado({ cfg })
  assert.equal(b.reservaIni, 60_000_000); assert.equal(b.reserva, 30)
  const ea = modeloPresupuesto(base, a).esc.base, eb = modeloPresupuesto(base, b).esc.base
  assert.ok(eb.reservaCierre > ea.reservaCierre); assert.ok(eb.retiros < ea.retiros); assert.ok(Math.abs(eb.reserva + eb.retiros - Math.max(0, eb.post)) < 1e-6)
  const ra = reservaRecomendada({ costosAnio: ea.costos, reservaIni: a.reservaIni, reservaAnio: ea.reserva, post: ea.post }), rb = reservaRecomendada({ costosAnio: eb.costos, reservaIni: b.reservaIni, reservaAnio: eb.reserva, post: eb.post, cfg })
  assert.equal(ra.meses, 3); assert.equal(rb.meses, 6); assert.equal(rb.niveles.length, 2); assert.ok(rb.objetivo > ra.objetivo)
  assert.equal(migrarEstado({ v: 3, p: {}, hecho: [], notas: {} }, 2027, 0, cfg).reservaIni, 60_000_000)
})

test('otra lista de componentes (nombre, orden, cuáles se fijan) y otro reparto de socios cambian lo que las vistas recorren', () => {
  const cfg = configPresupuesto({ componentes: [
    { k: 'retiros', n: 'Distribución', tono: 'r', ic: 'ing', ancla: true }, { k: 'caja', n: 'Ingresos cobrados', tono: 'g', ic: 'wal', ancla: false }, { k: 'costos', n: 'Gastos', tono: 't', ic: 'egr', ancla: false },
  ], anclaInicial: 'retiros', socios: { reparto: { A: 0.7, B: 0.3 } } })
  assert.deepEqual(componentesDe(cfg), [['retiros', 'Distribución'], ['caja', 'Ingresos cobrados'], ['costos', 'Gastos']])
  assert.deepEqual(anclasDe(cfg), ['retiros']); assert.equal(nombreComponente('caja', cfg), 'Ingresos cobrados'); assert.equal(nombreComponente('caja'), 'Cobrado')
  assert.equal(metasDesdeComponente(base, estado(), { componente: 'caja', valor: 1e8, ratio: 66 }, cfg).motivo, 'componente')   // caja ya no se puede fijar
  assert.equal(metasDesdeComponente(base, estado(), { componente: 'caja', valor: 1e8, ratio: 66 }).ok, true)
  const socios = [{ nombre: 'A' }, { nombre: 'B' }, { nombre: 'Sin socio' }]
  assert.equal(parteMeta(socios, 'A'), 0.5); assert.equal(parteMeta(socios, 'A', cfg), 0.7); assert.equal(parteMeta(socios, 'B', cfg), 0.3); assert.equal(parteMeta(socios, 'Sin socio', cfg), 0)
  const real = { sueldos: {}, retiros: {} }, args = { socios: ['A', 'B'], costos: [], alza: 0, retiros: 100, real }
  assert.equal(sueldosYRetiros(args).filas[0].ret27, 50); assert.equal(sueldosYRetiros({ ...args, cfg }).filas[0].ret27, 70)
})

test('otros grupos de sueldos y otras escenarios de partida: el reparto por socio y el estado inicial los siguen', () => {
  const cfg = configPresupuesto({ costos: { grupoSueldos: 'Honorarios socios', grupoLeyes: 'Cargas' }, escenarios: [{ k: 'a', n: 'Bajo', t: 0, p: { g: 1, alza: 2, terc: 10, dias: 50 } }, { k: 'b', n: 'Alto', t: 1, p: { g: 30, alza: 3, terc: 10, dias: 20 } }], escenarioMetas: 'a' })
  const c = [{ id: 1, n: 'Ana', m: 1000, meses: 12, t: 'fijo', alza: null, g: 'Honorarios socios' }, { id: 2, n: 'Ana', m: 100, meses: 12, t: 'fijo', alza: null, g: 'Cargas' }]
  const r = sueldosYRetiros({ socios: ['Ana'], costos: c, alza: 0, retiros: 0, real: { sueldos: {}, retiros: {} }, cfg })
  assert.equal(r.filas[0].sueldo27, 12000); assert.equal(r.filas[0].leyes27, 1200)
  assert.equal(sueldosYRetiros({ socios: ['Ana'], costos: c, alza: 0, retiros: 0, real: { sueldos: {}, retiros: {} } }).filas[0].sueldo27, 0)
  const st = estadoInicial({ costos, cfg, terc: 20 })
  assert.deepEqual(Object.keys(st.p), ['a', 'b']); assert.equal(st.esc, 'a'); assert.equal(st.p.a.terc, 20)
  assert.equal(modeloPresupuesto(base, st).lista.length, 2)
})

// ── Configuración guardada: validarConfig y diferenciaConfig ──
import { validarConfig, diferenciaConfig } from './../supabase/functions/_shared/presupuestoConfig.js'
test('validarConfig: lo válido pasa; rangos, componentes, reparto y tramos se rechazan con su ruta', () => {
  assert.equal(validarConfig({}).ok, true); assert.equal(validarConfig({ reserva: { porcentaje: 20 } }).ok, true)
  const r = (o) => validarConfig(o).errores.map((e) => e.ruta)
  assert.deepEqual(r({ reserva: { porcentaje: 120 } }), ['reserva.porcentaje'])
  assert.deepEqual(r({ escenarios: [] }), ['escenarios'])
  assert.ok(r({ escenarios: [{ k: 'a', n: 'A', t: 0, p: { g: 10, alza: -1, terc: 5, dias: 12 } }] }).includes('escenarios.0.p.alza'))
  assert.ok(r({ socios: { reparto: { A: 0.6, B: 0.5 } } }).includes('socios.reparto')); assert.equal(validarConfig({ socios: { reparto: { A: 0.6, B: 0.4 } } }).ok, true)
  assert.ok(r({ tributario: { idpc: [{ hasta: 2028, tasa: 15 }, { hasta: 2027, tasa: 12 }, { tasa: 25 }] } }).includes('tributario.idpc.1.hasta'))
  assert.ok(r({ tributario: { idpc: [{ hasta: 2027, tasa: 12.5 }] } }).includes('tributario.idpc.0.hasta'))
  assert.ok(r({ componentes: [{ k: 'ventas', n: 'V' }] }).includes('componentes'))
  assert.ok(r({ moneda: { simbolo: '' } }).includes('moneda.simbolo'))
})
test('diferenciaConfig: solo guarda lo que cambia respecto del defecto y vuelve a mezclarse igual', () => {
  const cfg = configPresupuesto({ reserva: { porcentaje: 20 }, tributario: { regimen: 'Régimen X' } })
  const d = diferenciaConfig(cfg)
  assert.deepEqual(d, { reserva: { porcentaje: 20 }, tributario: { regimen: 'Régimen X' } })
  assert.deepEqual(configPresupuesto(d), cfg); assert.deepEqual(diferenciaConfig(CONFIG_DEFECTO), {})
})

test('validarConfig: la lista de socios del estudio debe ser nombres y vacía (null) vale por «los administradores»', () => {
  assert.equal(validarConfig({ socios: { lista: ['Ana', 'Luis', 'Eva'] } }).ok, true); assert.equal(validarConfig({ socios: { lista: null } }).ok, true)
  assert.ok(validarConfig({ socios: { lista: ['Ana', ''] } }).errores.some((e) => e.ruta === 'socios.lista')); assert.ok(validarConfig({ socios: { lista: 'Ana' } }).errores.some((e) => e.ruta === 'socios.lista'))
  assert.equal(CONFIG_DEFECTO.socios.lista, null)
})

test('validarConfig: el calendario de la cotización del empleador pide meses AAAA-MM ascendentes y porcentajes entre 0 y 30', () => {
  assert.equal(validarConfig({ previsional: { empleador: [{ desde: '2026-08', pct: 3.5 }, { desde: '2027-08', pct: 4.25 }] } }).ok, true)
  const r = (l) => validarConfig({ previsional: { empleador: l } }).errores.map((e) => e.ruta)
  assert.ok(r([{ desde: '2026-13', pct: 3 }]).includes('previsional.empleador.0.desde')); assert.ok(r([{ desde: '2027-08', pct: 4 }, { desde: '2026-08', pct: 3 }]).includes('previsional.empleador.1.desde'))
  assert.ok(r([{ desde: '2026-08', pct: 40 }]).includes('previsional.empleador.0.pct')); assert.ok(r('x').includes('previsional.empleador'))
})
