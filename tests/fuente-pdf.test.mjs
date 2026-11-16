// DM Sans en los PDF (la fuente cargada queda en caché de módulo, por eso el caso de falla va primero): se registran los pesos 400 y 600 desde /fonts; si no se pueden cargar, los PDF siguen con helvetica. Prueba con `fetch` y `doc` falsos.
import test from 'node:test'
import assert from 'node:assert/strict'
import { registrarFuentePdf } from '../src/lib/fuentePdf.js'

const docFalso = () => { const reg = { archivos: [], fuentes: [] }; return { reg, addFileToVFS(n, d) { reg.archivos.push([n, d.length]) }, addFont(n, f, e) { reg.fuentes.push([n, f, e]) } } }

test('sin los archivos de la fuente cae a helvetica y no rompe', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 404 })
  assert.equal(await registrarFuentePdf(docFalso()), 'helvetica')
  globalThis.fetch = async () => { throw new Error('sin red') }
  assert.equal(await registrarFuentePdf(docFalso()), 'helvetica')
})
test('registra DM Sans en normal (400) y negrita (600) y devuelve su nombre', async () => {
  const pedidos = []
  globalThis.fetch = async (u) => { pedidos.push(u); return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer } }
  const doc = docFalso(), f = await registrarFuentePdf(doc)
  assert.equal(f, 'DMSans'); assert.deepEqual(pedidos, ['/fonts/DMSans-400.ttf', '/fonts/DMSans-600.ttf'])
  assert.deepEqual(doc.reg.fuentes, [['DMSans-400.ttf', 'DMSans', 'normal'], ['DMSans-600.ttf', 'DMSans', 'bold']])
})
