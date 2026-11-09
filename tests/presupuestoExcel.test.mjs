// Excel del presupuesto: las fórmulas del libro dan lo mismo que el modelo de la app. Datos de ejemplo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estadoInicial, modeloPresupuesto, ESCENARIOS } from './../supabase/functions/_shared/presupuesto.js'
import { hojasPresupuesto, evaluar } from './../src/lib/presupuestoExcel.js'

const costos = [
  { id: 0, n: 'Sueldos', m: 5_000_000, meses: 12, t: 'fijo', alza: null },
  { id: 1, n: 'Arriendo', m: 1_000_000, meses: 6, t: 'fijo', alza: 2 },
  { id: 2, n: 'Equipos', m: 800_000, meses: 1, t: 'discrecional', alza: null },
]
const baseUF = [200, 210, 190, 250, 300, 220, 180, 260, 240, 230, 270, 310]
const ufDic = 40_000
const baseCLP = baseUF.map((x) => x * 38_000)
const mk = (est) => ({
  anio: 2027, anioBase: 2026, ufDic, baseCLP, baseUF, est, ESC: ESCENARIOS, costos: est.costos,
  socios: [{ nombre: 'A', facturado: 600 }, { nombre: 'B', facturado: 400 }, { nombre: 'Sin socio', facturado: 0 }],
  oficiales: { vend: { uf: 1, clp: 2 }, fact: { uf: 1, clp: 2 }, cob: { uf: 1, clp: 2 }, marg: { uf: 1, clp: 2 }, metaVentasCLP: 3, metaCobroCLP: 4 },
  mes26: Array.from({ length: 12 }, (_, i) => ({ a: 100 + i, f: i < 10 ? 150 + i : null, cob: i < 10 ? 90 : null })),
})
const valor = (hojas, nombre, ref) => {
  const h = hojas.find((x) => x.nombre === nombre), c = ref.charCodeAt(0) - 65, r = Number(ref.slice(1)) - 1
  const x = h.filas[r][c]; return typeof x === 'object' ? x.v : x
}

test('las fórmulas del libro coinciden con el modelo en cada escenario', () => {
  const est = estadoInicial({ costos, tasa: 15, ppmMes: 100_000, reajusteUF: 3.5 })
  const m = modeloPresupuesto({ baseCLP, baseUF, ufDic }, est)
  const h = evaluar(hojasPresupuesto(mk(est)))
  ESCENARIOS.forEach(([k], j) => {
    const c = String.fromCharCode(66 + j), e = m.esc[k]
    for (const [fila, campo] of [[2, 'factUF'], [3, 'fact'], [4, 'dCob'], [5, 'caja'], [6, 'terc'], [7, 'costos'], [8, 'base'], [9, 'idpc'], [10, 'post'], [11, 'reserva'], [12, 'retiros'], [14, 'saldo']]) {
      assert.ok(Math.abs(valor(h, 'Escenarios', c + fila) - e[campo]) < 1e-4, `${k} ${campo}`)
    }
  })
})

test('el libro se recalcula al cambiar un supuesto y suma por socio y por mes', () => {
  const est = estadoInicial({ costos, tasa: 15, ppmMes: 100_000 })
  est.p.base.g = 25; est.reserva = 30
  const m = modeloPresupuesto({ baseCLP, baseUF, ufDic }, est)
  const h = evaluar(hojasPresupuesto(mk(est)))
  assert.ok(Math.abs(valor(h, 'Escenarios', 'C12') - m.esc.base.retiros) < 1e-4)
  assert.ok(Math.abs(valor(h, 'Mes a mes', 'G14') - m.esc.base.fact) < 1e-4)          // total mensual = facturado del año
  assert.ok(Math.abs(valor(h, 'Por socio', 'D5') - m.esc.base.fact) < 1e-4)           // socios suman el total
  assert.ok(Math.abs(valor(h, 'Por socio', 'E5') - m.esc.base.retiros) < 1e-4)
  assert.ok(Math.abs(valor(h, 'Resumen 2026', 'D11') - (150 / 100 - 1)) < 1e-9)
})

test('metas por socio: partes iguales (50 % con dos socios), «Sin socio» sin meta y las partes suman la meta de la oficina', () => {
  const est = estadoInicial({ costos, tasa: 15, ppmMes: 100_000 })
  const m = modeloPresupuesto({ baseCLP, baseUF, ufDic }, est)
  const h = evaluar(hojasPresupuesto(mk(est)))
  assert.equal(valor(h, 'Por socio', 'F2'), 0.5)
  assert.equal(valor(h, 'Por socio', 'F3'), 0.5)
  assert.equal(valor(h, 'Por socio', 'F4'), 0)
  assert.ok(Math.abs(valor(h, 'Por socio', 'G2') - m.esc.base.fact / 2) < 1e-4)
  assert.ok(Math.abs(valor(h, 'Por socio', 'H5') - m.esc.base.caja) < 1e-4)
})
