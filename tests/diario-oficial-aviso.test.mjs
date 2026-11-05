import test from 'node:test'
import assert from 'node:assert/strict'
import { rutClave, rutBonito, quitarRut, nombreClave, calzarPublicaciones, destinatariosAviso, porDestinatario, asuntoAviso, introAviso } from '../supabase/functions/_shared/diarioOficialAviso.js'

const eq = { socios: [{ email: 'cl@x.cl' }, { email: 'ee@x.cl' }], correoDe: (n) => ({ 'Cristóbal': 'cl@x.cl', 'Erasmo': 'ee@x.cl', 'Martín': 'mc@x.cl' }[n] || '') }
const clientes = [
  { id: 1, name: 'Alfa', rut: null, abogado_responsable: 'Erasmo', status: 'Activo' },
  { id: 2, name: 'Beta Comercial SpA', rut: '76.111.222-3', abogado_responsable: 'Cristóbal', status: 'Activo' },
  { id: 3, name: 'Gamma', rut: null, abogado_responsable: null, status: 'Activo' },
  { id: 4, name: 'Prospecto Delta SpA', rut: '76.999.999-9', abogado_responsable: 'Cristóbal', status: 'Prospecto' },
]
const entidades = [
  { client_id: 1, name: 'ALFA INVERSIONES LIMITADA', rut: '78.231.749-0' },
  { client_id: 3, name: 'Gamma Servicios Limitada', rut: null },
]

test('rut y nombre se normalizan igual que la tabla', () => {
  assert.equal(rutClave('77.704.691-8'), '777046918')
  assert.equal(rutClave('abc'), '')
  assert.equal(rutBonito('77704691-8'), '77.704.691-8')
  assert.equal(quitarRut('ASESORÍAS LEGALES PROVIDENCIA LIMITADA 77.898.170-K*'), 'ASESORÍAS LEGALES PROVIDENCIA LIMITADA')
  assert.equal(nombreClave('Asesorías  Legales, S.A.'), 'asesorias legales s a')
})

test('calza por RUT (ficha y razón social) y es seguro', () => {
  const r = calzarPublicaciones([{ cve: '1', nombre: 'BETA COMERCIAL SpA 76.111.222-3*', rut: '76111222-3' }, { cve: '2', nombre: 'X 78.231.749-0', rut: '78231749-0' }], clientes, entidades)
  assert.deepEqual(r.map((x) => [x.cve ?? x.pub.cve, x.clientId, x.via, x.nota]), [['1', '2', 'rut', ''], ['2', '1', 'rut', '']])
})

test('calza por nombre con aviso: RUT distinto, ficha sin RUT o publicación sin RUT', () => {
  const r = calzarPublicaciones([
    { cve: '3', nombre: 'ALFA INVERSIONES LIMITADA 77.704.691-8*', nombre_norm: 'alfa inversiones limitada', rut: '77704691-8' },
    { cve: '4', nombre: 'GAMMA SERVICIOS LIMITADA', nombre_norm: 'gamma servicios limitada', rut: null },
    { cve: '5', nombre: 'Gamma Servicios Limitada 77.123.456-7*', nombre_norm: 'gamma servicios limitada', rut: '77123456-7' },
  ], clientes, entidades)
  assert.equal(r[0].via, 'nombre'); assert.match(r[0].nota, /RUT 78\.231\.749-0/)
  assert.match(r[1].nota, /no trae RUT/)
  assert.match(r[2].nota, /ficha no tiene RUT/)
})

test('no calza nombres cortos, prospectos ni lo que no es de un cliente', () => {
  const r = calzarPublicaciones([{ cve: '6', nombre: 'ALFA', nombre_norm: 'alfa', rut: null }, { cve: '7', nombre: 'Prospecto Delta SpA', nombre_norm: 'prospecto delta spa', rut: '76999999-9' }, { cve: '8', nombre: 'Otra SpA', nombre_norm: 'otra spa', rut: '76000000-0' }], clientes, entidades)
  assert.equal(r.length, 0)
})

test('cada correo va al socio dueño; sin dueño conocido, a los dos', () => {
  assert.deepEqual(destinatariosAviso('Cristóbal', eq), ['cl@x.cl'])
  assert.deepEqual(destinatariosAviso('Erasmo', eq), ['ee@x.cl'])
  assert.deepEqual(destinatariosAviso('', eq), ['cl@x.cl', 'ee@x.cl'])
  assert.deepEqual(destinatariosAviso('Martín', eq), ['cl@x.cl', 'ee@x.cl'])
  const m = porDestinatario([{ abogado: 'Cristóbal', cve: 'a' }, { abogado: 'Erasmo', cve: 'b' }, { abogado: '', cve: 'c' }], eq)
  assert.deepEqual(m.get('cl@x.cl').map((x) => x.cve), ['a', 'c'])
  assert.deepEqual(m.get('ee@x.cl').map((x) => x.cve), ['b', 'c'])
})

test('asunto e intro', () => {
  assert.equal(asuntoAviso(1), 'Diario Oficial: 1 publicación de clientes')
  assert.equal(asuntoAviso(3), 'Diario Oficial: 3 publicaciones de clientes')
  assert.equal(introAviso(['2026-11-05', '2026-11-05']), 'Edición del 05-11-2026. Publicaciones de sociedades de clientes:')
  assert.match(introAviso(['2026-11-04', '2026-11-05']), /recientes/)
})
