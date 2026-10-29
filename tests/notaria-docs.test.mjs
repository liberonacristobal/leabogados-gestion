// Pruebas de los documentos firmados de la notaría (lectura del correo, OT, nombre del archivo, cliente) y de la paginación REST.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { leerCorreoNotaria, firmadoPorNotaria, otParaDocumento, rsBonita, nombreArchivoNotaria, repertoriosDoc, indiceNombres, clientesEnTexto, sugerenciasDocumento } from './../supabase/functions/_shared/notariaDocsReglas.js'
import { todasRest, PAGINA } from './../supabase/functions/_shared/paginar.js'

test('correo de la notaría: tipo, repertorio, fecha y código de validación; un correo ajeno no se lee', () => {
  const r = leerCorreoNotaria('Se adjunta documento CONSTITUCION DE SOCIEDAD POR ACCIONES, correspondiente al repertorio 52157 con fecha 02-10-2026 firmado electronicamente, codigo de validacion 316-2026101413123242')
  assert.deepEqual(r, { tipo: 'CONSTITUCION DE SOCIEDAD POR ACCIONES', repertorio: '52157', fecha: '2026-10-02', codigo: '316-2026101413123242' })
  assert.equal(leerCorreoNotaria('Hola, te envío lo conversado'), null)
  assert.equal(leerCorreoNotaria(''), null)
})

test('correo de la notaría: repertorio «N/A» queda sin repertorio y sin código no se inventa', () => {
  const r = leerCorreoNotaria('Se adjunta documento PODER, correspondiente al repertorio N/A con fecha 05-10-2026')
  assert.equal(r.repertorio, null); assert.equal(r.codigo, null)
})

test('firma de la notaría: cuenta solo la del texto propio, no la de un correo citado', () => {
  const firmas = ['Mildred Gutiérrez']
  assert.equal(firmadoPorNotaria('Saludos, Mildred Gutiérrez', firmas), true)
  assert.equal(firmadoPorNotaria('Gracias.\n\nDe: Mildred Gutiérrez\nSe adjunta', firmas), false)
  assert.equal(firmadoPorNotaria('Gracias.\n> Mildred Gutiérrez', firmas), false)
  assert.equal(firmadoPorNotaria('Saludos, Mildred Gutiérrez', ['Ana']), false)   // firma demasiado corta
})

const ot = (n, date, concept, o = {}) => ({ ot_number: n, date, concept, client_id: 'c' + n, ...o })

test('OT del documento: misma fecha y tipo contenido en la glosa; plural y singular calzan', () => {
  const ots = [ot('1', '2026-10-02', 'Gastos notariales — Constitución sociedad acciones'), ot('2', '2026-10-02', 'Poder amplio')]
  assert.equal(otParaDocumento({ fecha: '2026-10-02', tipo: 'CONSTITUCION DE SOCIEDAD POR ACCIONES' }, ots).ot_number, '1')
  assert.equal(otParaDocumento({ fecha: '2026-10-02', tipo: 'MUTUOS' }, [ot('3', '2026-10-02', 'Mutuo')]).ot_number, '3')
})

test('OT del documento: varias el mismo día se resuelven por la que calza más palabras, y si empatan, ninguna', () => {
  const ots = [ot('1', '2026-10-02', 'Prenda sobre vehículos'), ot('2', '2026-10-02', 'Prenda sobre acciones')]
  assert.equal(otParaDocumento({ fecha: '2026-10-02', tipo: 'PRENDA SOBRE VEHICULOS' }, ots).ot_number, '1')
  assert.equal(otParaDocumento({ fecha: '2026-10-02', tipo: 'PRENDA' }, ots), null)
})

test('OT del documento: a otra fecha solo con todas las palabras (dos o más), dentro de 3 días y única', () => {
  const ots = [ot('1', '2026-10-05', 'Constitución sociedad acciones')]
  assert.equal(otParaDocumento({ fecha: '2026-10-02', tipo: 'CONSTITUCION SOCIEDAD ACCIONES' }, ots).ot_number, '1')
  assert.equal(otParaDocumento({ fecha: '2026-09-28', tipo: 'CONSTITUCION SOCIEDAD ACCIONES' }, ots), null)   // 7 días
  assert.equal(otParaDocumento({ fecha: '2026-10-02', tipo: 'PODER' }, [ot('1', '2026-10-05', 'Poder')]), null)  // una palabra, otra fecha
  assert.equal(otParaDocumento({ fecha: '2026-10-02', tipo: 'PODER' }, [ot('1', '2026-10-02', 'Poder', { deleted_at: 'x' })]), null)
  assert.equal(otParaDocumento(null, ots), null)
})

test('nombre del archivo en Drive: razón social, tipo, fecha y repertorio; sin tipo conserva el original sin duplicar la razón social', () => {
  assert.equal(rsBonita('  GESMAQ   SPA '), 'GESMAQ SpA')
  assert.equal(nombreArchivoNotaria({ tipo: 'CONSTITUCION DE SOCIEDAD', fecha: '2026-10-02', repertorio: '52157' }, 'pdf', 'GESMAQ SPA'), 'GESMAQ SpA - Constitucion de sociedad - 02-10-2026 - Rep 52157.pdf')
  assert.equal(nombreArchivoNotaria({}, 'pdf', 'GESMAQ SPA', 'escaneo 12.pdf'), 'GESMAQ SpA - escaneo 12.pdf')
  assert.equal(nombreArchivoNotaria({}, 'pdf', 'GESMAQ SPA', 'GESMAQ SPA borrador.pdf'), 'GESMAQ SPA borrador.pdf')
  assert.equal(nombreArchivoNotaria({ tipo: 'PODER: amplio/judicial', fecha: '2026-10-02' }, 'pdf', ''), 'Poder- amplio-judicial - 02-10-2026.pdf')
})

test('repertorios de un documento: el propio y los que aparecen en su nombre o asunto, sin repetir', () => {
  assert.deepEqual(repertoriosDoc({ repertorio: '52157', archivo_nombre: 'Rep N° 52157 poder.pdf', asunto: 'repertorio 52999' }).sort(), ['52157', '52999'])
  assert.deepEqual(repertoriosDoc({}), [])
})

const clients = [{ id: 1, name: 'Inversiones Osorno SpA' }, { id: 2, name: 'Agrícola Villarrica Ltda' }, { id: 3, name: 'Oficina', is_internal: true }]

test('cliente en un texto: están sus dos primeras palabras distintivas; los clientes internos y los nombres genéricos no cuentan', () => {
  const ind = indiceNombres(clients, [{ client_id: 1, name: 'Frutícola Osorno' }], [], [])
  assert.deepEqual(clientesEnTexto('Escritura Agrícola Villarrica copia', ind).map(k => k.cid), ['2'])
  assert.equal(clientesEnTexto('Oficina central', ind).length, 0)
  assert.equal(clientesEnTexto('inversiones spa', ind).length, 0)
})

test('sugerencias: una OT libre del tipo y fecha de un solo cliente se asigna sola; con dos clientes solo propone; una OT ya usada no cuenta', () => {
  const doc = { tipo_documento: 'CONSTITUCION SOCIEDAD ACCIONES', fecha_documento: '2026-10-02' }
  const ots = [ot('1', '2026-10-02', 'Constitución sociedad acciones')]
  const a = sugerenciasDocumento(doc, { ots })
  assert.equal(a.auto, 'c1'); assert.equal(a.sugerencias[0].fuente, 'ot')
  const b = sugerenciasDocumento(doc, { ots: [...ots, ot('2', '2026-10-02', 'Constitución sociedad acciones')] })
  assert.equal(b.auto, null); assert.equal(b.sugerencias.length, 2)
  assert.equal(sugerenciasDocumento(doc, { ots, usadas: new Set(['1']) }).sugerencias.length, 0)
})

test('sugerencias: el mismo repertorio de un documento ya clasificado y el RUT del Diario Oficial señalan al cliente', () => {
  const rep = sugerenciasDocumento({ repertorio: '52157' }, { clasificados: [{ cliente_id: 7, repertorio: '52157' }] })
  assert.equal(rep.sugerencias[0].fuente, 'repertorio'); assert.equal(rep.sugerencias[0].client_id, '7')
  const dos = sugerenciasDocumento({ repertorio: '52157' }, { clasificados: [{ cliente_id: 7, repertorio: '52157' }, { cliente_id: 8, repertorio: '52157' }] })
  assert.equal(dos.sugerencias.filter(s => s.fuente === 'repertorio').length, 0)   // dos clientes: no se elige
  const doe = sugerenciasDocumento({ do_publicacion: { rut: '76.111.111-1' } }, { porRut: { '761111111': 9 } })
  assert.equal(doe.sugerencias[0].fuente, 'diario_oficial')
})

test('paginación REST: pide páginas de 1.000 con orden estable hasta que una viene incompleta, y falla fuerte si la base responde error', async () => {
  const pedidas = []
  const orig = globalThis.fetch
  globalThis.fetch = async (url, { headers }) => { pedidas.push([url, headers.Range]); const n = pedidas.length; return { ok: true, json: async () => Array.from({ length: n < 3 ? PAGINA : 5 }, (_, i) => ({ id: n * 10000 + i })) } }
  try {
    const filas = await todasRest('https://x.supabase.co', { apikey: 'k' }, 'billing?select=*')
    assert.equal(filas.length, 2 * PAGINA + 5)
    assert.deepEqual(pedidas.map(p => p[1]), ['0-999', '1000-1999', '2000-2999'])
    assert.ok(pedidas.every(p => /order=/.test(p[0])))
    globalThis.fetch = async () => ({ ok: false, status: 500 })
    await assert.rejects(() => todasRest('https://x.supabase.co', {}, 'billing?select=*'), /billing: 500/)
  } finally { globalThis.fetch = orig }
})

test('firma de la notaría: un nombre corto de menos de 5 letras no vale como firma', () => {
  assert.equal(firmadoPorNotaria('Saludos, Ana', ['Ana']), false)
})
