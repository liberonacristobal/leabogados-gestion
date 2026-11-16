// Una consulta a la base con «fecha ≤ AAAA-MM-31» falla con 400 en los meses de menos de 31 días (noviembre de 2026: la vista Mes en marcha perdía los cargos sin clasificar).
// El tope del mes sale siempre de finDeMes. Lectura estática de las vistas y las librerías.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const raiz = resolve(import.meta.dirname, '..')
const archivos = (d) => readdirSync(resolve(raiz, d), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? archivos(`${d}/${e.name}`) : /\.(jsx?|ts)$/.test(e.name) ? [`${d}/${e.name}`] : [])

test('ninguna consulta a la base pone «-31» (ni -29, -30) como fecha tope del mes', () => {
  const malas = []
  for (const f of [...archivos('src'), ...archivos('supabase/functions/_shared')].filter((x) => !/demoData/.test(x))) {
    readFileSync(resolve(raiz, f), 'utf8').split('\n').forEach((t, i) => { if (/\.(lte|lt)\(\s*['"`][a-z_]+['"`]\s*,[^)]*[-](29|30|31)['"`]\s*\)/.test(t)) malas.push(`${f}:${i + 1}`) })
  }
  assert.deepEqual(malas, [])
})
