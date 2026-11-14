// Rótulos de la cascada del resultado (devengado): una palabra por concepto y cada plano con su nombre.
// «Comisiones pagadas» es de caja (Cobrado, Ingreso real); la cascada Ingresos − Costos − Comisiones = Margen lleva las devengadas
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
  assert.equal(et.cos, 'Costos'); assert.equal(et.com, 'Comisiones'); assert.equal(et.res, 'Margen'); assert.equal(et.margen, 'Margen %')
})

test('Costos es una palabra y no hay fila de subarriendo aparte en las cascadas', () => {
  for (const f of VISTAS) {
    const mal = leer(f).filter((x) => /(label|lab|l):\s*'Costos de (operación|oficina)'|\['− Costos de operación'|filaT\('(− )?Costos de operación'/.test(x.t))
    assert.deepEqual(mal.map((x) => `${f}:${x.n}`), [])
  }
  const hub = leer('src/App.jsx').filter((x) => /st\('sub'/.test(x.t))
  assert.equal(hub.length, 0)
})
