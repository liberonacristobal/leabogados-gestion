// El equipo armado desde miembros reproduce exactamente las tablas que cada función del servidor tenía escritas en el código.
// Filas = las de producción (estudio lea, principales) al 25-10-2026, más un alias y otro estudio que deben quedar fuera.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { armarEquipo, EQUIPO_RESPALDO } from '../supabase/functions/_shared/equipo.js'

const FILAS = [
  { email: 'rd@leabogados.cl', nombre: 'Rodrigo', iniciales: 'RD', rol: 'limited', es_socio: false },
  { email: 'cl@leabogados.cl', nombre: 'Cristóbal', iniciales: 'CL', rol: 'admin', es_socio: true },
  { email: 'mp@leabogados.cl', nombre: 'Martina', iniciales: 'MP', rol: 'limited', es_socio: false },
  { email: 'ee@leabogados.cl', nombre: 'Erasmo', iniciales: 'EE', rol: 'admin', es_socio: true },
  { email: 'mc@leabogados.cl', nombre: 'Martín', iniciales: 'MC', rol: 'limited', es_socio: false },
]
const ANTES = {
  EMAIL_POR_NOMBRE: { 'Cristóbal': 'cl@leabogados.cl', 'Erasmo': 'ee@leabogados.cl', 'Martín': 'mc@leabogados.cl', 'Martina': 'mp@leabogados.cl', 'Rodrigo': 'rd@leabogados.cl' },
  NOMBRE_POR_INI: { CL: 'Cristóbal', EE: 'Erasmo', MC: 'Martín', MP: 'Martina', RD: 'Rodrigo' },
  EMAIL_POR_INI: { CL: 'cl@leabogados.cl', EE: 'ee@leabogados.cl', MC: 'mc@leabogados.cl', MP: 'mp@leabogados.cl', RD: 'rd@leabogados.cl' },
  ADMINS: ['cl@leabogados.cl', 'ee@leabogados.cl'],
  LIMITADOS: [{ ini: 'MC', nombre: 'Martín', email: 'mc@leabogados.cl' }, { ini: 'MP', nombre: 'Martina', email: 'mp@leabogados.cl' }, { ini: 'RD', nombre: 'Rodrigo', email: 'rd@leabogados.cl' }],
}

for (const [nombre, filas] of [['miembros', FILAS], ['respaldo', EQUIPO_RESPALDO]]) {
  test(`equipo desde ${nombre} = tablas anteriores (mismo contenido y mismo orden)`, () => {
    const eq = armarEquipo(filas)
    assert.deepEqual(Object.entries(eq.porNombre), Object.entries(ANTES.EMAIL_POR_NOMBRE))
    assert.deepEqual(Object.entries(eq.nombrePorIni), Object.entries(ANTES.NOMBRE_POR_INI))
    assert.deepEqual(Object.entries(eq.porIni), Object.entries(ANTES.EMAIL_POR_INI))
    assert.deepEqual(eq.nombreDe, Object.fromEntries(Object.entries(ANTES.EMAIL_POR_NOMBRE).map(([n, e]) => [e, n])))
    assert.deepEqual(eq.iniDe, Object.fromEntries(Object.entries(ANTES.EMAIL_POR_INI).map(([i, e]) => [e, i])))
    assert.deepEqual(eq.admins, ANTES.ADMINS)
    assert.deepEqual(eq.socios.map((m) => m.nombre), ['Cristóbal', 'Erasmo'])
    assert.deepEqual(eq.limitados.map(({ ini, nombre, email }) => ({ ini, nombre, email })), ANTES.LIMITADOS)
  })
}

test('correoDe tolera tildes y mayúsculas como las tablas con alias («Martin», «Cristobal»)', () => {
  const eq = armarEquipo(FILAS)
  assert.equal(eq.correoDe('Martin'), 'mc@leabogados.cl')
  assert.equal(eq.correoDe('Cristobal'), 'cl@leabogados.cl')
  assert.equal(eq.correoDe('Martina'), 'mp@leabogados.cl')
  assert.equal(eq.correoDe('martina '), 'mp@leabogados.cl')
  assert.equal(eq.correoDe('Mart'), '')
  assert.equal(eq.correoDe(''), '')
})

test('filas sin correo o sin nombre no entran; sin iniciales se toman del nombre', () => {
  const eq = armarEquipo([{ email: 'x', nombre: 'A' }, { email: 'a@b.cl', nombre: '' }, { email: 'Ana@B.cl', nombre: 'Ána', rol: 'limited' }])
  assert.deepEqual(eq.miembros.map((m) => [m.email, m.ini]), [['ana@b.cl', 'AN']])
})
