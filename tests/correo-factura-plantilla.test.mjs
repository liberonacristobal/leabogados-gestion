import test from 'node:test'
import assert from 'node:assert/strict'
import { cuotaDe, cuotaIncoherente, destokenizar, quitarDespedida, tokenizar } from '../supabase/functions/_shared/correoFacturaPlantilla.js'

// Casos reales anonimizados (4-11-2026): el texto guardado con la cuota de UNA factura se reusaba tal cual en la siguiente.
const v2 = { folios: 'N° 500', total: '$825.160', periodo: '', cuota: cuotaDe('Cuota 2/10') }
const v3 = { folios: 'N° 512', total: '$825.160', periodo: '', cuota: cuotaDe('Cuota 3/10') }

test('la cuota escrita a mano se guarda como marca y la siguiente cuota sale con su propio número', () => {
  const guardado = tokenizar('Adjuntamos la factura N° 500, correspondiente al Pago 2 de 10 de nuestros servicios, por $825.160.', v2)
  assert.equal(guardado, 'Adjuntamos la factura {folios}, correspondiente al Pago {cuota} de nuestros servicios, por {total}.')
  const r = destokenizar(guardado, v3)
  assert.equal(r.completo, true)
  assert.match(r.texto, /Pago 3 de 10 de nuestros/)
  assert.match(r.texto, /N° 512/)
})

test('«cuota de 1 de 2» y «(cuota 1 de 18)» también quedan como marca', () => {
  assert.equal(tokenizar('la cuota de 1 de 2 del honorario', {}), 'la cuota de {cuota} del honorario')
  assert.equal(tokenizar('Puesta en marcha (cuota 1 de 18), por', {}), 'Puesta en marcha (cuota {cuota}), por')
})

test('una factura sin cuota (p. ej. «Honorarios») no puede completar la marca: se usa el texto por defecto', () => {
  const r = destokenizar('correspondiente a la cuota {cuota}, por {total}', { folios: 'N° 1', total: '$1', cuota: null })
  assert.equal(r.completo, false)
})

test('la despedida que agrega el envío no queda dentro del cuerpo guardado', () => {
  assert.equal(quitarDespedida('Adjuntamos la factura.\n\nLes saluda cordialmente,'), 'Adjuntamos la factura.')
  assert.equal(quitarDespedida('Adjuntamos la factura.\nSaludos cordiales,\n\n'), 'Adjuntamos la factura.')
  assert.equal(quitarDespedida('Adjuntamos la factura.\n\nQuedamos atentos a sus comentarios.\nSaludos,'), 'Adjuntamos la factura.')
  assert.equal(quitarDespedida('Les saluda cordialmente a todos los socios de la empresa en el texto.\nGracias.'), 'Les saluda cordialmente a todos los socios de la empresa en el texto.\nGracias.')
})

test('avisa cuando el texto nombra otra cuota; sin cuota conocida no opina', () => {
  assert.deepEqual(cuotaIncoherente('correspondiente a la cuota 1 de 18', { n: 2, tot: 18 }), { dice: '1 de 18', es: '2 de 18' })
  assert.deepEqual(cuotaIncoherente('Pago 2 de 10', { n: 3, tot: 10 }), { dice: '2 de 10', es: '3 de 10' })
  assert.equal(cuotaIncoherente('Pago 3 de 10', { n: 3, tot: 10 }), null)
  assert.equal(cuotaIncoherente('cuota 1 de 18', null), null)
  assert.equal(cuotaIncoherente('sin cuota alguna', { n: 2, tot: 18 }), null)
})

test('el folio del asunto se guarda como marca', () => {
  const g = tokenizar('Factura 477 | Asesoría permanente', { folio: '477' })
  assert.equal(g, 'Factura {folio} | Asesoría permanente')
  assert.equal(destokenizar(g, { folio: '494' }).texto, 'Factura 494 | Asesoría permanente')
})

test('un texto ya guardado con la cuota escrita a mano se corrige al leerlo', () => {
  const guardadoAntes = 'Adjuntamos la factura {folios}, correspondiente a la cuota 1 de 18 de nuestros servicios, por {total}.\n\nLes saluda cordialmente,'
  const r = destokenizar(tokenizar(quitarDespedida(guardadoAntes), {}), { folios: 'N° 511', total: '$1.000', cuota: cuotaDe('Cuota 2/18') })
  assert.equal(r.completo, true)
  assert.equal(r.texto, 'Adjuntamos la factura N° 511, correspondiente a la cuota 2 de 18 de nuestros servicios, por $1.000.')
})
