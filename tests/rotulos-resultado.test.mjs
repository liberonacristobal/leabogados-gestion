// Rótulos de la cascada del resultado (devengado): una palabra por concepto y cada plano con su nombre.
// «Comisiones pagadas» es de caja (Cobrado, Ingreso real); la cascada Ingresos − Costos − Comisiones = Resultado lleva las devengadas
// y se llama «Comisiones». «Costos» ya incluye el subarriendo como menor costo, nunca como fila aparte. Lectura estática de las vistas.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { INDICADORES } from '../supabase/functions/_shared/informeMes.js'

const raiz = resolve(import.meta.dirname, '..')
const leer = (r) => readFileSync(resolve(raiz, r), 'utf8').split('\n').map((t, i) => ({ t, n: i + 1 })).filter((x) => !/^\s*\/\//.test(x.t))
const VISTAS = ['src/vistas/DashboardView.jsx', 'src/vistas/PanelSociosView.jsx', 'src/vistas/ResultadoAnioView.jsx', 'src/App.jsx']

test('una cifra devengada del resultado nunca se rotula «pagadas»', () => {
  for (const f of VISTAS) {
    const mal = leer(f).filter((x) => /Comisiones pagadas|'pagadas'/.test(x.t) && /resAnio\.com|V\.com|rm\.com|R\.com|r\.com/.test(x.t))
    assert.deepEqual(mal.map((x) => `${f}:${x.n}`), [])
  }
})

test('el informe del mes rotula el resultado con las mismas palabras que las vistas', () => {
  const et = Object.fromEntries(INDICADORES.map((x) => [x[1], x[2]]))
  assert.equal(et.cos, 'Costos'); assert.equal(et.com, 'Comisiones'); assert.equal(et.res, 'Resultado'); assert.equal(et.margen, 'Margen')
})

test('Costos es una palabra y no hay fila de subarriendo aparte en las cascadas', () => {
  for (const f of VISTAS) {
    const mal = leer(f).filter((x) => /(label|lab|l):\s*'Costos de (operación|oficina)'|\['− Costos de operación'|filaT\('(− )?Costos de operación'/.test(x.t))
    assert.deepEqual(mal.map((x) => `${f}:${x.n}`), [])
  }
  const hub = leer('src/App.jsx').filter((x) => /st\('sub'/.test(x.t))
  assert.equal(hub.length, 0)
})

test('la cifra en pesos es «Resultado» y «Margen» solo el porcentaje y «Pagadas en» lleva la cifra de caja', () => {
  for (const f of ['src/vistas/DashboardView.jsx', 'src/vistas/PanelSociosView.jsx']) {
    const mal = leer(f).filter((x) => (/label='Margen'|'Margen del mes'|hl:<>Margen /.test(x.t) && /rm\.res|resMes/.test(x.t)) || (/Pagadas en/.test(x.t) && /rm\.com\b/.test(x.t) && !/comPag/.test(x.t)))
    assert.deepEqual(mal.map((x) => `${f}:${x.n}`), [])
  }
  assert.equal(leer('src/App.jsx').filter((x) => /filaT\('Subarriendo/.test(x.t)).length, 0)
})

test('el porcentaje junto al Resultado se llama «margen», nunca «ingresos» ni «sobre los ingresos»', () => {
  const dash = leer('src/vistas/DashboardView.jsx'), ofi = leer('src/vistas/OficinaView.jsx')
  assert.deepEqual(dash.filter((x) => /sobre los ingresos/.test(x.t)).map((x) => x.n), [])
  assert.deepEqual(dash.filter((x) => /kpiTile\('marg'/.test(x.t) && /'ingresos'\)/.test(x.t)).map((x) => x.n), [])
  assert.deepEqual(ofi.filter((x) => /label='Resultado'/.test(x.t) && /cap='ingresos'/.test(x.t)).map((x) => x.n), [])
})

test('Resultado antes de sueldos de socios sale de la misma función en Inicio y en el Estado', () => {
  assert.ok(leer('src/vistas/DashboardView.jsx').some((x) => /Resultado antes de sueldos de socios/.test(x.t) && /mRes\('resSin'/.test(x.t)))
  assert.ok(leer('src/vistas/EstadoResultadosFormal.jsx').some((x) => /Resultado antes de sueldos de socios/.test(x.t) && /T1\.resSin/.test(x.t)))
  assert.ok(leer('src/lib/resultadoAnio.js').some((x) => /o\.resSin=o\.res\+o\.soc/.test(x.t)))
})

test('la calculadora de aumento es un solo bloque y está en las dos pantallas del presupuesto', () => {
  assert.ok(leer('src/vistas/presupuestoEtapas1.jsx').some((x) => /<CostoEmpresaBloque/.test(x.t)))
  assert.ok(leer('src/App.jsx').some((x) => /<CostoEmpresaBloque/.test(x.t)))
  assert.ok(leer('src/lib/costoEmpresaBloque.jsx').some((x) => /remuneracionDeLiquido/.test(x.t)))
  assert.ok(leer('src/vistas/presupuestoEtapas1.jsx').some((x) => /Reajuste al equipo/.test(x.t)))
})

test('la calculadora de Costos de Oficina compara con el monto vigente de la línea, no con el campo «Antes»', () => {
  const l = leer('src/App.jsx').filter((x) => /const hoyL=/.test(x.t))
  assert.equal(l.length, 1); assert.ok(/const hoyL=Number\(r\.monto\)/.test(l[0].t)); assert.ok(!/ef\.prev/.test(l[0].t))
})

test('presupuesto de costos: «Reajuste» es lo que se decide y «Variación» la columna 2027 contra 2026; no hay palanca de alza ni «aumento propio»', () => {
  const v = leer('src/vistas/presupuestoEtapas1.jsx').map((x) => x.t).join('\n')
  assert.ok(/<span style=\{\{ textAlign: 'right' \}\}>Variación<\/span>/.test(v)); assert.ok(/<div style=\{eti\}>Reajuste<\/div>/.test(v))
  assert.ok(!/Aumento propio/.test(v)); assert.ok(!/Alza de costos <Stp/.test(v)); assert.ok(!/Aumento al equipo/.test(v))
  assert.ok(/Cada 1 % de reajuste general/.test(v))
})
