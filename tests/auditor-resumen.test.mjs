// Resumen del auditor nocturno (qué sigue abierto, cuándo sale correo) y detector de plantillas con números escritos a mano.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { siguenAbiertos, esLunes, correoDelDia } from './../supabase/functions/_shared/auditorResumen.js'
import { numerosEscritos } from './../supabase/functions/_shared/correoFacturaPlantilla.js'
import { plantillasConNumeros, hallazgos } from './../supabase/functions/_shared/saludDatos.js'

const AHORA = Date.parse('2026-11-05T09:30:00Z')

test('siguen abiertos: solo los que ya estaban de antes, por tipo, con la antigüedad del más viejo', () => {
  const casos = [{ detector: 'a', clave: 'a:1' }, { detector: 'a', clave: 'a:2' }, { detector: 'a', clave: 'a:3' }, { detector: 'b', clave: 'b:1' }]
  const previos = [{ clave: 'a:1', primera_vez: '2026-10-25T09:30:00Z' }, { clave: 'a:2', primera_vez: '2026-11-03T09:30:00Z' }, { clave: 'b:1', primera_vez: null }, { clave: 'z:9', primera_vez: '2026-10-01T00:00:00Z' }]
  assert.deepEqual(siguenAbiertos(casos, previos, AHORA), [{ detector: 'a', n: 2, dias: 11 }, { detector: 'b', n: 1, dias: 0 }])   // a:3 es nuevo; z:9 ya no aparece
  assert.deepEqual(siguenAbiertos([], previos, AHORA), [])
  assert.deepEqual(siguenAbiertos(null, null, AHORA), [])
})

test('correo del día: con casos nuevos siempre; sin nuevos, solo el lunes y si algo sigue abierto', () => {
  assert.equal(esLunes('2026-11-02'), true)
  assert.equal(esLunes('2026-11-04'), false)
  assert.equal(esLunes(''), false)
  assert.equal(correoDelDia(2, 0, '2026-11-04'), true)
  assert.equal(correoDelDia(0, 5, '2026-11-04'), false)
  assert.equal(correoDelDia(0, 5, '2026-11-02'), true)
  assert.equal(correoDelDia(0, 0, '2026-11-02'), false)
})

test('números escritos a mano: monto y folio sí; marcas, mes y cuota no', () => {
  assert.deepEqual(numerosEscritos('Adjuntamos la factura {folios}, correspondiente a la cuota 2 de 10 de octubre de 2026, por {total}.'), [])
  assert.deepEqual(numerosEscritos('Adjuntamos la factura N° 500, por $1.190.000.'), ['$1.190.000', 'factura N° 500'])
  assert.deepEqual(numerosEscritos('Adjuntamos las facturas 511 y 512'), ['facturas 511 y 512'])
  assert.deepEqual(numerosEscritos('Proyecto 2026, plazo de 30 días'), [])   // un año o un plazo no son folio ni monto
  assert.deepEqual(numerosEscritos(null), [])
})

test('plantillas aprendidas: las reales de hoy (con marcas) no son caso; una con folio escrito sí, con su cliente', () => {
  const rows = [{ kind: 'factura_msg', key: 'c1:p1', value: 'Adjuntamos la factura {folios}, por {total}.' }, { kind: 'factura_msg', key: 'c2:p2', value: 'Adjuntamos la factura N° 500, por {total}.' }]
  assert.deepEqual(plantillasConNumeros(rows).map(x => x.key), ['c2:p2'])
  const h = hallazgos({ plantillas: rows, clientName: id => (id === 'c2' ? 'Cliente Dos' : '—') }).filter(x => x.detector === 'plantilla_con_numeros')
  assert.equal(h.length, 1)
  assert.equal(h[0].clave, 'plantilla_con_numeros:factura_msg:c2:p2')
  assert.match(h[0].titulo, /Cliente Dos/)
})
