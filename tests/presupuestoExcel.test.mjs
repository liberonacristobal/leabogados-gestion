// Excel del presupuesto: las fórmulas del libro dan lo mismo que el modelo de la app. Datos de ejemplo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estadoInicial, modeloPresupuesto, ESCENARIOS, escenariosDe, duplicarEscenario, eliminarEscenario } from './../supabase/functions/_shared/presupuesto.js'
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

test('hoja «Metas 2027»: las fórmulas despejan y calculan lo mismo que la app para cada componente fijado, también con una rebaja de costos', async () => {
  const { cadenaMeta, metasDesdeComponente, valorComponente, ANCLAS } = await import('./../supabase/functions/_shared/presupuesto.js')
  const est = estadoInicial({ costos, tasa: 12.5, ppmMes: 100_000, reajusteUF: 3.5 })
  est.costos[2].alza = -20                                       // una rebaja de costos también entra en el libro
  const b = { baseCLP, baseUF, ufDic }
  const ratio = 66
  for (const comp of ANCLAS) {
    const ref = cadenaMeta(b, est, 12, ratio), v = valorComponente(ref, comp, ratio)
    const app = metasDesdeComponente(b, est, { componente: comp, valor: v, ratio })
    const h = evaluar(hojasPresupuesto({ ...mk(est), ratio, metas: { ancla: comp, valor: v } }))
    assert.ok(Math.abs(valor(h, 'Metas 2027', 'B12') - app.g) < 1e-6, `${comp} g`)
    for (const [fila, campo] of [[15, 'fact'], [16, 'caja'], [17, 'terc'], [18, 'costos'], [19, 'margen'], [20, 'idpc'], [21, 'post'], [22, 'reserva'], [23, 'retiros'], [24, 'reservaCierre']]) {
      assert.ok(Math.abs(valor(h, 'Metas 2027', 'B' + fila) - app[campo]) < 1e-3, `${comp} ${campo}`)
    }
    assert.ok(Math.abs(valor(h, 'Metas 2027', 'B14') - app.ventas) < 1e-3)
    assert.ok(Math.abs(valor(h, 'Metas 2027', 'B25') - app.mesesReserva) < 1e-6)
  }
})

test('columnas dinámicas: con 5 escenarios (o con uno quitado) el libro sigue cuadrando con el modelo, incluido «Por socio» sobre el de referencia', () => {
  let est = estadoInicial({ costos, tasa: 15, ppmMes: 100_000 })
  est = duplicarEscenario(duplicarEscenario(est, 'prudente'), 'meta'); est.p.e2.g = 40
  const lista = escenariosDe(est), m = modeloPresupuesto({ baseCLP, baseUF, ufDic }, est)
  const h = evaluar(hojasPresupuesto({ ...mk(est), ESC: lista, refK: 'base' }))
  lista.forEach(([k], j) => {
    const c = String.fromCharCode(66 + j), e = m.esc[k]
    for (const [fila, campo] of [[3, 'fact'], [5, 'caja'], [7, 'costos'], [12, 'retiros']]) assert.ok(Math.abs(valor(h, 'Escenarios', c + fila) - e[campo]) < 1e-4, `${k} ${campo}`)
  })
  assert.equal(h.find((x) => x.nombre === 'Mes a mes').filas[0].length, 2 + 2 * lista.length)
  assert.ok(Math.abs(valor(h, 'Por socio', 'D5') - m.esc.base.fact) < 1e-4)
  // sin «Base», la referencia pasa al primero y las columnas siguen el orden de la lista
  const sin = eliminarEscenario(est, 'base'), l2 = escenariosDe(sin), m2 = modeloPresupuesto({ baseCLP, baseUF, ufDic }, sin)
  const h2 = evaluar(hojasPresupuesto({ ...mk(sin), ESC: l2, refK: l2[0][0] }))
  assert.ok(Math.abs(valor(h2, 'Escenarios', 'C12') - m2.esc[l2[1][0]].retiros) < 1e-4)
  assert.ok(Math.abs(valor(h2, 'Por socio', 'D5') - m2.esc[l2[0][0]].fact) < 1e-4)
})

test('el libro agrega la hoja del Arrastre con una fila por línea y sus totales (las quitadas valen 0)', () => {
  const est = estadoInicial({ costos, tasa: 15, ppmMes: 100_000 })
  const lin = [
    { nombre: 'Cliente A', concepto: 'Proyecto', tipo: 'Cuotas', estado: 'ajustada', n: 2, mensual: 0, meses: 0, total: 750_000, enApp: 1_500_000, nota: 'se atrasa', porMes: [500_000, 0, 250_000, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { nombre: 'Cliente B', concepto: 'Asesoría', tipo: 'Asesoría', estado: 'de la app', n: 12, mensual: 100_000, meses: 12, total: 1_200_000, enApp: 1_200_000, nota: '', porMes: Array(12).fill(100_000) },
    { nombre: 'Cliente C', concepto: 'Asesoría', tipo: 'Asesoría', estado: 'quitada', n: 12, mensual: 50_000, meses: 12, total: 0, enApp: 600_000, nota: '', porMes: Array(12).fill(0) },
  ]
  const hojas = hojasPresupuesto({ ...mk(est), arrastre: lin }), h = evaluar(hojas)
  assert.deepEqual(hojas.map((x) => x.nombre).slice(0, 3), ['Supuestos', 'Base', 'Arrastre 2026'])
  assert.equal(valor(h, 'Arrastre 2026', 'G6'), 1_950_000); assert.equal(valor(h, 'Arrastre 2026', 'I6'), 3_300_000); assert.equal(valor(h, 'Arrastre 2026', 'K6'), 600_000)
  assert.equal(hojasPresupuesto(mk(est)).some((x) => x.nombre === 'Arrastre 2026'), false)   // sin arrastre, el libro es el de siempre
})
