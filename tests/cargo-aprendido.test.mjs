// Cargos del banco: el RUT de una transferencia con la glosa cortada, la clasificación aprendida por RUT y el cliente que nombra el mensaje. Datos anonimizados.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { glosaGenerica, esPagoTGR, clasificacionPorRut, clientePorMensaje } from './../supabase/functions/_shared/cargoAprendido.js'
import { extraerContraparte } from './../src/cartola.js'

test('transferencia entre bancos con la glosa cortada: el destino (persona) y su RUT salen igual que con «a Cuenta Corriente…»', () => {
  const corta = 'Transferencia de LIBERONA ESCALA ABOGADOS LIMITADA Rut 77.700.387-9 desde Banco BICE a PERSONA UNO Rut 11.111.111-1'
  assert.deepEqual(extraerContraparte(corta, 'cargo'), { nombre: 'PERSONA UNO', rut: '11.111.111-1' })
  assert.deepEqual(extraerContraparte(corta + ' a Cuenta Corriente de Banco BICE, el 2026-11-09', 'cargo'), { nombre: 'PERSONA UNO', rut: '11.111.111-1' })
  assert.deepEqual(extraerContraparte('Transferencia de PERSONA DOS Rut 22.222.222-2 desde Banco BICE a Liberona Escala Abogados Limitada Rut 77.700.387-9', 'abono'), { nombre: 'PERSONA DOS', rut: '22.222.222-2' })
})
test('la glosa «Transferencia de LIBERONA ESCALA…» es genérica: no identifica a quién se pagó', () => {
  assert.equal(glosaGenerica('Transferencia de LIBERONA ESCALA ABOGADOS LIMITADA Rut 77.700.387-9 desde Banco BICE a PERSONA UNO'), true)
  assert.equal(glosaGenerica('Transf. a terceros vía Internet a cuenta 111 B.Estado, PERSONA UNO, Rut 11.111.111-1'), false)
  assert.equal(glosaGenerica(null), false)
})
test('clasificación por RUT: la misma de siempre se sugiere; si cambió entre cargos, no', () => {
  const h = [
    { rut: '11.111.111-1', category: 'Otros', subcategory: 'Aseo' }, { rut: '11111111-1', category: 'Otros', subcategory: 'Aseo' },
    { rut: '33.333.333-3', category: 'Otros', subcategory: 'Aseo' }, { rut: '33.333.333-3', category: 'Servicios', subcategory: null },
    { rut: null, category: 'Otros' }, { rut: '44.444.444-4', category: '' },
  ]
  const m = clasificacionPorRut(h)
  assert.deepEqual(m.get('111111111'), { category: 'Otros', sub: 'Aseo', n: 2 })
  assert.equal(m.has('333333333'), false)   // ambiguo
  assert.equal(m.size, 1)
  assert.equal(clasificacionPorRut(/** @type {any} */ (null)).size, 0)
})
test('el mensaje que nombra la sociedad de un cliente lo identifica; con dos clientes o ninguno, no adivina', () => {
  const cands = [{ id: 'c1', nombres: ['Cliente Uno', 'INVERSIONES NOGALES SPA'] }, { id: 'c2', nombres: ['Cliente Dos', 'Comercial Pinares Ltda'] }]
  assert.equal(clientePorMensaje('Inscripción a nombre de Nogales SpA', cands), 'c1')
  assert.equal(clientePorMensaje('Pago pinares y nogales', cands), null)   // dos clientes
  assert.equal(clientePorMensaje('Aseo oficina', cands), null)
  assert.equal(clientePorMensaje('', cands), null)
  assert.equal(clientePorMensaje('Inscripción a nombre de SpA', [{ id: 'x', nombres: ['Inversiones SpA'] }]), null)   // sin palabra propia
})
test('pago a la TGR: se reconoce en sus dos glosas, no tiene a quién y no sirve de clave de aprendizaje', () => {
  for (const d of ['Cargo por Pago TGR Nro. Oper. 2026000000000001, via Electronica, el 13/10/2026', 'Cargo por Pago de Impuesto (TGR)']) { assert.equal(esPagoTGR(d), true); assert.equal(glosaGenerica(d), true) }
  for (const d of ['Cargo por Pago de Impuesto', 'Pago TGR', null, 'Transf. a terceros vía Internet a cuenta 1 B.Estado, PERSONA, Rut 1-9']) assert.equal(esPagoTGR(d), false)
})
