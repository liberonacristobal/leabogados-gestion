// El reembolso de gastos incluido en una factura de honorarios (fondo del cliente ligado a la factura) no es ingreso: baja el Facturado y no cambia el total emitido. Datos anonimizados.
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
  dir = mkdtempSync(join(tmpdir(), 'fr-'))
  const out = join(dir, 'compartido.mjs')
  await build({ stdin: { contents: `export * from ${JSON.stringify(join(raiz, 'src/lib/compartido.jsx'))}`, resolveDir: raiz, loader: 'js' }, bundle: true, platform: 'node', format: 'esm', outfile: out, nodePaths: [join(raiz, 'node_modules')],
    loader: { '.js': 'jsx', '.jsx': 'jsx', '.png': 'dataurl', '.svg': 'dataurl', '.css': 'empty' }, define: { 'import.meta.env.VITE_SUPABASE_URL': '"http://x"', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '"x"', 'import.meta.env': '{}' },
    logLevel: 'silent', jsx: 'automatic', external: ['pdfjs-dist/build/pdf.worker?url'], banner: { js: "import {createRequire} from 'module'; const require=createRequire(import.meta.url);" } })
  M = await import(pathToFileURL(out).href)
})
after(() => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* sin limpieza */ } })

const billing = [{ id: 'h1', billing_type: 'honorarios', invoice_no: '1', status: 'Pagado', issued_at: '2026-02-02', amount: 420000 }, { id: 'h2', billing_type: 'honorarios', invoice_no: '2', status: 'Pagado', issued_at: '2026-02-03', amount: 500000 }]
const sii = [{ tipo_dte: 34, monto: 420000, fecha_emision: '2026-02-02', billing_id: 'h1', folio: '1' }, { tipo_dte: 34, monto: 500000, fecha_emision: '2026-02-03', billing_id: 'h2', folio: '2' }]
const deps = (expenses) => ({ billing, terceros: [], costosOfiRows: [], expenses, clients: [], ufd: null, ufFb: 39000 })
const fu = { sii, plan: [], boleta: new Set() }
test('el reembolso ligado a la factura baja el Facturado y sube la línea de reembolsos', () => {
  const r0 = M.resultadoMes(fu, deps([]), '2026-02')
  const r1 = M.resultadoMes(fu, deps([{ id: 'f1', type: 'fondo', amount: 102600, invoice_id: 'h1' }]), '2026-02')
  assert.equal(r0.fac, 920000)
  assert.equal(r1.fac, 920000 - 102600)
  assert.equal(r1.facExc.reemb, 102600)
  assert.equal(r1.totalEmitido, r0.totalEmitido)      // lo emitido no cambia
  assert.equal(r1.ing, r0.ing - 102600)
})
test('un fondo sin factura o borrado no cuenta; nunca baja más que la factura', () => {
  const r = M.resultadoMes(fu, deps([{ id: 'f2', type: 'fondo', amount: 50000 }, { id: 'f3', type: 'fondo', amount: 70000, invoice_id: 'h2', deleted_at: '2026-03-01' }, { id: 'f4', type: 'fondo', amount: 9e6, invoice_id: 'h1' }]), '2026-02')
  assert.equal(r.fac, 500000); assert.equal(r.facExc.reemb, 420000)
})
