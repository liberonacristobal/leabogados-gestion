import { test } from 'node:test'
import assert from 'node:assert/strict'
import { listaClientesIA } from './../supabase/functions/_shared/listaClientesIA.js'

const clientes = [
  { id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Alfa  SpA', status: 'Activo' },
  { id: 'aaaaaaaa-0000-0000-0000-000000000002', name: 'Beta Ltda', status: 'Terminado' },
  { id: 'aaaaaaaa-0000-0000-0000-000000000003', name: 'Gamma', status: 'Activo' },
]

test('lista: sin terminados, numerada desde 1, espacios colapsados', () => {
  const { texto } = listaClientesIA(clientes)
  assert.equal(texto, '1|Alfa SpA\n2|Gamma')
})

test('número → id real; fuera de la lista, texto o nulo → null', () => {
  const { idDe } = listaClientesIA(clientes)
  assert.equal(idDe(2), 'aaaaaaaa-0000-0000-0000-000000000003')
  assert.equal(idDe('1'), 'aaaaaaaa-0000-0000-0000-000000000001')
  for (const x of [0, 3, -1, 1.5, 'x', null, undefined]) assert.equal(idDe(x), null)
})

test('sin clientes: lista vacía y todo null', () => {
  const { texto, idDe } = listaClientesIA(null)
  assert.equal(texto, '')
  assert.equal(idDe(1), null)
})
