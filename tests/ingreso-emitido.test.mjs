// Ingreso emitido por socio (Panel de socios · «en curso»): facturado − comisiones de lo facturado; el subarriendo va aparte.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { kpisPorSocio } from '../src/lib/cifras.js'

const f = (k, soc, d, m, bid) => ({ s: 'f', k, soc, d, m, bid })
const P = [
  f('emit', 'Socio A', '2026-11-03', 17990804, 'a1'), f('com', 'Socio A', '2026-11-03', -2038102, 'a1'),
  f('emit', 'Socio B', '2026-11-02', 9693499, 'b1'), f('emit', 'Socio B', '2026-11-02', 1000000, 'b2'), f('com', 'Socio B', '2026-11-02', -756342, 'b1'),
  f('sub', 'Sin socio', '2026-11-03', 1080000, 's1'),
  f('emit', 'Socio A', '2026-10-05', 5000000, 'a0'), f('com', 'Socio A', '2026-10-05', -500000, 'a0'),
  f('emit', 'Socio B', '2026-11-04', 300000, 'r1'), f('reemb', 'Socio B', '2026-11-04', -300000, 'r1'),   // reembolso entero: no es una factura de honorarios
]
const K = kpisPorSocio({ P, V: [], ym: '2026-11' })

test('ingreso emitido = facturado − comisiones; el subarriendo no entra', () => {
  assert.deepEqual(K.emitido('Socio A', 'mes'), { f: 17990804, c: 2038102, i: 15952702 })
  assert.deepEqual(K.emitido('Socio B', 'mes'), { f: 10693499, c: 756342, i: 9937157 })
  const t = K.emitido(null, 'mes')
  assert.equal(t.i, 15952702 + 9937157)
  assert.equal(t.f - t.c, t.i)
})

test('el acumulado suma enero al mes elegido y las partes suman el total', () => {
  const a = K.emitido('Socio A', 'ytd'), b = K.emitido('Socio B', 'ytd'), t = K.emitido(null, 'ytd')
  assert.equal(a.i + b.i, t.i)
  assert.equal(a.i, 15952702 + 4500000)
})

test('cuenta facturas, no partidas: la devuelta entera como reembolso no cuenta', () => {
  assert.equal(K.nEmitidas('Socio A', 'mes'), 1)
  assert.equal(K.nEmitidas('Socio B', 'mes'), 2)
  assert.equal(K.nEmitidas(null, 'mes'), 3)
})

test('mes a mes por socio y sin partidas todo en cero', () => {
  const m = K.emitidoMeses(['Socio A', 'Socio B'])
  assert.equal(m.length, 11)
  assert.equal(m[9].v['Socio A'], 4500000)
  assert.equal(m[10].v['Socio A'], 15952702)
  assert.ok(m.slice(0, 9).every(x => x.v['Socio A'] === 0 && x.v['Socio B'] === 0))
  const z = kpisPorSocio({ P: [], V: [], ym: '2026-11' })
  assert.deepEqual(z.emitido(null, 'mes'), { f: 0, c: -0, i: 0 })
  assert.equal(z.nEmitidas(null, 'ytd'), 0)
})
