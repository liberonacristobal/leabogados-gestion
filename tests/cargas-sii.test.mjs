import test from 'node:test'
import assert from 'node:assert/strict'
import { sinPisarRegistradas } from '../supabase/functions/_shared/cargasSii.js'

test('carga del SII: un folio ya registrado no vuelve a «sin registrar» al cargar de nuevo su XML', () => {
  const stage = [{ folio: '514', tipo_dte: 34 }, { folio: '515', tipo_dte: 34 }]
  const existentes = [{ folio: '514', tipo_dte: 34, estado: 'registrada' }]
  assert.deepEqual(sinPisarRegistradas(stage, existentes).map((s) => s.folio), ['515'])
})

test('carga del SII: lo pendiente o descartado se actualiza; la llave es folio + tipo (33 por defecto)', () => {
  const stage = [{ folio: '10' }, { folio: '10', tipo_dte: 34 }, { folio: '11', tipo_dte: 33 }]
  const existentes = [{ folio: '10', tipo_dte: 33, estado: 'registrada' }, { folio: '11', tipo_dte: 33, estado: 'sin_registrar' }]
  assert.deepEqual(sinPisarRegistradas(stage, existentes), [{ folio: '10', tipo_dte: 34 }, { folio: '11', tipo_dte: 33 }])
})

test('carga del SII: sin filas guardadas o con listas vacías no cambia nada', () => {
  const stage = [{ folio: '1', tipo_dte: 33 }]
  assert.deepEqual(sinPisarRegistradas(stage, []), stage)
  assert.deepEqual(sinPisarRegistradas([], [{ folio: '1', estado: 'registrada' }]), [])
})
