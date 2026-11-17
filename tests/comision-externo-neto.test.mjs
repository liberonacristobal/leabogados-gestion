// El vendido neto de una venta no descuenta la parte del externo (terceros con comision_pct): no es un costo de la oficina. Datos anonimizados.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const raiz = resolve(import.meta.dirname, '..')
let M, dir
before(async () => {
  globalThis.localStorage = { getItem() { return null }, setItem() {} }
  dir = mkdtempSync(join(tmpdir(), 'cx-'))
  const out = join(dir, 'compartido.mjs')
  await build({ stdin: { contents: `export * from ${JSON.stringify(join(raiz, 'src/lib/compartido.jsx'))}`, resolveDir: raiz, loader: 'js' }, bundle: true, platform: 'node', format: 'esm', outfile: out, nodePaths: [join(raiz, 'node_modules')],
    loader: { '.js': 'jsx', '.jsx': 'jsx', '.png': 'dataurl', '.svg': 'dataurl', '.css': 'empty' }, define: { 'import.meta.env.VITE_SUPABASE_URL': '"http://x"', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '"x"', 'import.meta.env': '{}' },
    logLevel: 'silent', jsx: 'automatic', external: ['pdfjs-dist/build/pdf.worker?url'], banner: { js: "import {createRequire} from 'module'; const require=createRequire(import.meta.url);" } })
  M = await import(pathToFileURL(out).href)
})
after(() => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* sin limpieza */ } })

const venta = { id: 'v1', client_id: 'c1', moneda: 'CLP', amount_clp: 0, year: 2026, month: 11, status: 'Activo', responsible: 'Ana' }
test('la parte del externo no baja el neto; la comisión normal sí', () => {
  const terceros = [{ id: 't1', sale_id: 'v1', billing_id: 'b1', monto: 850, comision_pct: 15, estado: 'pendiente' }, { id: 't2', sale_id: 'v1', billing_id: 'b2', monto: 300, comision_pct: null, estado: 'pendiente' }]
  const c = M.comisionesVenta(venta, terceros, [{ id: 'b1' }, { id: 'b2' }], 0)
  assert.equal(c.clp, 1150)      // lo facturado de la venta: todo lo que sale a terceros
  assert.equal(c.ext, 850)
  assert.equal(c.anual, 300)     // el neto solo descuenta la comisión normal
})
test('sin filas de externo todo queda igual', () => {
  const c = M.comisionesVenta(venta, [{ id: 't', sale_id: 'v1', monto: 400, comision_pct: null }], [], 0)
  assert.equal(c.clp, 400); assert.equal(c.ext, 0); assert.equal(c.anual, 400)
})
