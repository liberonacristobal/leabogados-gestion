// Programación de salas por correo (Excel del Poder Judicial): filas del archivo y cruce con nuestras causas. Datos anonimizados.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fechaISO, nombreSala, leerTablaSalas, cruzarSalas } from './../supabase/functions/_shared/salasXls.js'

const CAB_APEL = ['Corte', 'Fecha', 'Sala', 'Tipo de Tabla', 'Tipo Recurso', 'Naturaleza', 'Caratulado', 'Rol', 'Era', '']
const CAB_SUP = ['Corte', 'Fecha', 'Sala', 'Tipo de Tabla', 'Glosa Recurso', 'Tipo Recurso', 'Naturaleza', 'Caratulado', 'Rol', 'Era', '']
const LS = 'CORTE DE APELACIONES DE LA SERENA                 '

test('fecha del archivo: dd/mm/aaaa a ISO; una fecha que no existe no vale', () => {
  assert.equal(fechaISO('02/11/2026'), '2026-11-02')
  assert.equal(fechaISO(' 2/1/2027 '), '2027-01-02')
  assert.equal(fechaISO('31/11/2026'), null)
  assert.equal(fechaISO('2026-11-02'), null)
  assert.equal(fechaISO(''), null)
  assert.equal(fechaISO(null), null)
})

test('sala: ordinal en palabras hasta la octava; otro número como «Sala N»', () => {
  assert.equal(nombreSala('1'), 'Primera Sala')
  assert.equal(nombreSala(3), 'Tercera Sala')
  assert.equal(nombreSala('12'), 'Sala 12')
  assert.equal(nombreSala(''), '')
})

test('lectura: columnas por nombre, filas sin fecha o rol fuera, ceros a la izquierda del rol quitados', () => {
  const r = leerTablaSalas([CAB_APEL,
    [LS, '02/11/2026', '1', 'ORDINARIA                     ', 'TRIBUTARIO-RECLAMACION', 'X', 'ALFA SPA/SERVICIO DE IMPUESTOS INTERNOS', '0015', '2025', ''],
    [LS, '', '1', 'ORDINARIA', 'CIVIL-APELACION', 'D', 'SIN FECHA', '10', '2025', ''],
    [LS, '03/11/2026', '2', 'ORDINARIA', 'CIVIL-APELACION', 'D', 'SIN ROL', '', '2025', ''],
    [LS, '03/11/2026', '2', 'ORDINARIA', 'CIVIL-APELACION', 'D', 'ERA MALA', '20', '25', ''],
  ])
  assert.equal(r.ok, true)
  assert.equal(r.filas.length, 1)
  assert.deepEqual(r.filas[0], { corte: LS.trim(), fecha: '2026-11-02', sala: '1', tabla: 'ORDINARIA', recurso: 'TRIBUTARIO-RECLAMACION', caratulado: 'ALFA SPA/SERVICIO DE IMPUESTOS INTERNOS', rol: '15', anio: '2025' })
})

test('lectura: la Corte Suprema trae «Glosa Recurso»; un archivo sin las columnas se informa, no se adivina', () => {
  const r = leerTablaSalas([CAB_SUP, ['CORTE SUPREMA', '02/11/2026', '1', 'ORDINARIA', '(CIVIL) CASACIÓN FONDO', 'CV04', 'C', 'RUBILAR CON ORÓSTICA (O)', '9432', '2026', '']])
  assert.equal(r.filas[0].recurso, '(CIVIL) CASACIÓN FONDO CV04')
  assert.equal(r.filas[0].rol, '9432')
  const mal = leerTablaSalas([['a', 'b'], ['1', '2']])
  assert.equal(mal.ok, false)
  assert.equal(leerTablaSalas([]).ok, false)
  assert.equal(leerTablaSalas(null).ok, false)
})

const causaTrib = { id: 'c1', instancia: 'apelaciones', corte_nombre: 'Corte de Apelaciones de La Serena', corte_codigo: '2501005', libro_nombre: 'Tributario Y Aduanero', rol: '15', anio: 2025, caratula: 'DÍAZ BUNSTER / SERVICIO DE IMPUESTOS INTERNOS' }
const filaLS = (o) => ({ corte: LS.trim(), fecha: '2026-11-03', sala: '2', tabla: 'ORDINARIA', recurso: 'TRIBUTARIO-RECLAMACION', caratulado: 'DIAZ BUNSTER/SII', rol: '15', anio: '2025', ...o })

test('cruce: mismo rol, año, Corte y materia del libro → la causa en tabla, con su sala y fecha', () => {
  const r = cruzarSalas([filaLS({}), filaLS({ fecha: '2026-11-04', sala: '1' })], [causaTrib])
  assert.equal(r.length, 1)
  assert.equal(r[0].causa_id, 'c1')
  assert.deepEqual(r[0].filas.map((f) => [f.fecha, f.sala]), [['2026-11-03', 'Segunda Sala'], ['2026-11-04', 'Primera Sala']])
  assert.equal(r[0].filas[0].numero, '')   // el N° de la tabla no viene en el archivo: no se inventa
})

test('cruce: el rol se repite en cada libro; otra materia sin palabra de la carátula en común no calza', () => {
  assert.deepEqual(cruzarSalas([filaLS({ recurso: 'FAMILIA-APELACION SENTENCIA', caratulado: 'LEDEZMA VÉLIZ' })], [causaTrib]), [])
  // misma materia que el libro aunque la carátula no coincida
  assert.equal(cruzarSalas([filaLS({ caratulado: 'OTRO NOMBRE' })], [causaTrib]).length, 1)
  // otra materia pero con una palabra de la carátula (≥5 letras) en común
  assert.equal(cruzarSalas([filaLS({ recurso: 'CIVIL-APELACION', caratulado: 'DIAZ BUNSTER Y OTRO' })], [causaTrib]).length, 1)
})

test('cruce: otra Corte, otro año o otro rol no calzan', () => {
  assert.deepEqual(cruzarSalas([filaLS({ corte: 'CORTE DE APELACIONES DE SANTIAGO' })], [causaTrib]), [])
  assert.deepEqual(cruzarSalas([filaLS({ anio: '2024' })], [causaTrib]), [])
  assert.deepEqual(cruzarSalas([filaLS({ rol: '150' })], [causaTrib]), [])
  assert.deepEqual(cruzarSalas([], [causaTrib]), [])
  assert.deepEqual(cruzarSalas([filaLS({})], []), [])
})

test('cruce: en la Corte Suprema el rol es único en el año, sin mirar la materia', () => {
  const sup = { id: 's1', instancia: 'suprema', corte_nombre: 'Corte Suprema', corte_codigo: '6050000', libro_nombre: null, rol: '9432', anio: 2026, caratula: '' }
  const f = { corte: 'CORTE SUPREMA', fecha: '2026-11-02', sala: '1', tabla: 'ORDINARIA', recurso: '(CIVIL) CASACIÓN FONDO', caratulado: 'RUBILAR CON ORÓSTICA (O)', rol: '9432', anio: '2026' }
  const r = cruzarSalas([f, { ...f, corte: 'CORTE DE APELACIONES DE LA SERENA', fecha: '2026-11-05' }], [sup])
  assert.equal(r.length, 1)
  assert.deepEqual(r[0].filas.map((x) => x.fecha), ['2026-11-02'])   // la fila de otra Corte con el mismo rol no cuenta
})
