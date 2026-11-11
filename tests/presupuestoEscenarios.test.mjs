// Presupuesto · escenarios editables: lista en el estado (crear duplicando, renombrar, eliminar, reordenar), migración v4 → v5 y modelo sobre la lista. Datos de ejemplo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  estadoInicial, modeloPresupuesto, resumenModelo, migrarEstado, diferenciaSupuestos, escenariosDe, nombreEscenario, escenarioMetas, duplicarEscenario, renombrarEscenario,
  eliminarEscenario, moverEscenario, escenariosContraMeta, nivelDeMeta, MAX_ESCENARIOS, N_TONOS_ESC, ESCENARIOS,
} from './../supabase/functions/_shared/presupuesto.js'

const costos = [{ id: 0, n: 'Sueldos', m: 5_000_000, meses: 12, t: 'fijo', alza: null }, { id: 1, n: 'Arriendo', m: 1_000_000, meses: 12, t: 'fijo', alza: null }]
const base = { baseCLP: Array.from({ length: 12 }, () => 10_000_000), baseUF: Array.from({ length: 12 }, () => 250), ufDic: 40_000 }
const claves = (st) => escenariosDe(st).map((x) => x[0])

test('estado nuevo: los tres escenarios de siempre, con `meta` llamado «Optimista»', () => {
  const st = estadoInicial({ costos })
  assert.deepEqual(escenariosDe(st), [['prudente', 'Prudente'], ['base', 'Base'], ['meta', 'Optimista']])
  assert.deepEqual(escenariosDe(st), ESCENARIOS)
  assert.equal(st.v, 6); assert.equal(st.esc, 'base'); assert.deepEqual(Object.keys(st.p).sort(), ['base', 'meta', 'prudente'])
  assert.deepEqual(st.escs.map((e) => e.t), [0, 1, 2])
})

test('migración v4 → v5: la lista sale de los tres escenarios guardados, conserva claves y palancas, y es idempotente', () => {
  const v4 = { v: 4, esc: 'meta', hecho: [], notas: {}, p: { prudente: { g: 1, alza: 6, terc: 20, dias: 40 }, base: { g: 11, alza: 4, terc: 20, dias: 30 }, meta: { g: 26, alza: 4, terc: 20, dias: 30 } }, costos: [], metas: { ancla: 'retiros', valor: null, ratio: null }, reservaIni: 30_000_000 }
  const m = migrarEstado(v4)
  assert.equal(m.v, 6); assert.deepEqual(claves(m), ['prudente', 'base', 'meta']); assert.equal(nombreEscenario(m, 'meta'), 'Optimista')
  assert.equal(m.esc, 'meta'); assert.deepEqual(m.p, v4.p); assert.deepEqual(m.dist, { modo: {}, manual: {} })
  assert.deepEqual(migrarEstado(m), m)                                         // idempotente
  assert.deepEqual(migrarEstado(migrarEstado(v4)), m)
  // el elegido que ya no existe pasa al primero; una palanca que falta se completa
  const roto = migrarEstado({ ...v4, esc: 'zzz', p: { base: v4.p.base } })
  assert.equal(roto.esc, claves(roto)[0]); assert.ok(roto.p[roto.esc].g != null)
})

test('duplicar: copia las palancas, queda al final y elegido, con nombre y tono propios; máximo 5', () => {
  const st = estadoInicial({ costos }); st.p.base.g = 17
  const c = duplicarEscenario(st, 'base')
  assert.equal(claves(c).length, 4); assert.equal(c.esc, claves(c)[3]); assert.deepEqual(c.p[c.esc], st.p.base)
  assert.notEqual(c.p[c.esc], c.p.base)                                         // copia, no la misma referencia
  assert.equal(nombreEscenario(c, c.esc), 'Base (copia)'); assert.equal(c.escs[3].t, 3)
  assert.equal(st.escs.length, 3)                                               // no toca el estado recibido
  const d = duplicarEscenario(c, 'base'); assert.equal(nombreEscenario(d, d.esc), 'Base (copia 2)')
  let x = d; for (let i = 0; i < 6; i++) x = duplicarEscenario(x, 'base')
  assert.equal(claves(x).length, MAX_ESCENARIOS); assert.equal(MAX_ESCENARIOS, 5)
  assert.equal(new Set(claves(x)).size, 5)                                      // claves únicas
  assert.equal(duplicarEscenario(st, 'noexiste').escs.length, 3)
  assert.ok(N_TONOS_ESC >= 5)
})

test('renombrar: limpia espacios, acota el largo y no acepta vacío; la clave no cambia', () => {
  const st = estadoInicial({ costos })
  assert.equal(nombreEscenario(renombrarEscenario(st, 'base', '  Plan   mínimo '), 'base'), 'Plan mínimo')
  assert.equal(nombreEscenario(renombrarEscenario(st, 'base', '   '), 'base'), 'Base')
  assert.equal(nombreEscenario(renombrarEscenario(st, 'base', 'abcdefghij'.repeat(6)), 'base').length, 24)
  assert.deepEqual(claves(renombrarEscenario(st, 'meta', 'Otro')), ['prudente', 'base', 'meta'])
})

test('eliminar: mínimo uno; si era el elegido pasa al siguiente (o al anterior si era el último); se van sus palancas', () => {
  const st = estadoInicial({ costos }); st.esc = 'base'
  const a = eliminarEscenario(st, 'base'); assert.deepEqual(claves(a), ['prudente', 'meta']); assert.equal(a.esc, 'meta'); assert.equal(a.p.base, undefined)
  st.esc = 'meta'; const b = eliminarEscenario(st, 'meta'); assert.equal(b.esc, 'base')
  const c = eliminarEscenario(eliminarEscenario(a, 'prudente'), 'meta'); assert.deepEqual(claves(c), ['meta'])   // no baja de uno
  assert.equal(eliminarEscenario(estadoInicial({ costos }), 'noexiste').escs.length, 3)
  // sin «Base», las metas toman los supuestos del primero
  assert.equal(escenarioMetas(a), 'prudente'); assert.equal(escenarioMetas(st), 'base')
})

test('mover: cambia el orden una posición y respeta los bordes', () => {
  const st = estadoInicial({ costos })
  assert.deepEqual(claves(moverEscenario(st, 'base', 1)), ['prudente', 'meta', 'base'])
  assert.deepEqual(claves(moverEscenario(st, 'prudente', -1)), ['prudente', 'base', 'meta'])
  assert.deepEqual(claves(moverEscenario(st, 'meta', 1)), ['prudente', 'base', 'meta'])
})

test('el modelo, el resumen y las metas iteran la lista, no los tres nombres', () => {
  let st = estadoInicial({ costos }); st = duplicarEscenario(duplicarEscenario(st, 'meta'), 'prudente'); st.p[st.esc].g = 40
  const m = modeloPresupuesto(base, st)
  assert.deepEqual(Object.keys(m.esc), claves(st)); assert.equal(m.lista.length, 5)
  assert.deepEqual(Object.keys(resumenModelo(m)), claves(st))
  const nueva = claves(st)[4]; assert.ok(m.esc[nueva].fact > m.esc.meta.fact * 0.99 || st.p[nueva].g === 40)
  const l = escenariosContraMeta(m, 'fact', m.esc.base.fact, null)
  assert.deepEqual(l.map((x) => x.k), claves(st)); assert.equal(nivelDeMeta(l), l.find((x) => x.cubre).k)
  // eliminar uno saca su columna
  assert.equal(Object.keys(modeloPresupuesto(base, eliminarEscenario(st, nueva)).esc).length, 4)
})

test('diferencia entre versiones: escenario nuevo, quitado y renombrado', () => {
  const a = estadoInicial({ costos }), f = { mm: (n) => `$${n}`, pc: (n) => `${n} %` }
  const b = renombrarEscenario(eliminarEscenario(duplicarEscenario(a, 'base'), 'prudente'), 'meta', 'Ambicioso')
  const d = diferenciaSupuestos(a, b, f)
  assert.ok(d.includes('Escenario nuevo: Base (copia)')); assert.ok(d.includes('Escenario quitado: Prudente')); assert.ok(d.includes('Escenario «Optimista» renombrado a «Ambicioso»'))
  assert.deepEqual(diferenciaSupuestos(a, a, f), [])
})
