import test from 'node:test'
import assert from 'node:assert/strict'
import { cuotaDe, cuotaIncoherente, destokenizar, limpiarEspacios, numerosEscritos, quitarDespedida, tokenizar } from '../supabase/functions/_shared/correoFacturaPlantilla.js'

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

test('los espacios dobles de la glosa del SII no pasan al texto guardado', () => {
  assert.equal(limpiarEspacios('Asesoria legal oct  26, por {total}.\nLínea  dos'), 'Asesoria legal oct 26, por {total}.\nLínea dos')
})

import { partesMes } from '../supabase/functions/_shared/correoFacturaPlantilla.js'

test('mes del texto aprendido: «Octubre de 2026» pasa a marca y vuelve con el mes de la factura; sin mes conocido no se completa', () => {
  const t = tokenizar('en relación a los servicios de Asesoría permanente del mes de Octubre de 2026, por $825.271.', {})
  assert.match(t, /del mes de \{Mes\}, por/)
  assert.equal(destokenizar(t, { mes: partesMes('Noviembre 2026') }).texto, 'en relación a los servicios de Asesoría permanente del mes de Noviembre de 2026, por $825.271.')
  assert.equal(destokenizar(tokenizar('prestados durante el mes de agosto de 2026', {}), { mes: partesMes('septiembre de 2026') }).texto, 'prestados durante el mes de septiembre de 2026')
  assert.equal(destokenizar(t, {}).completo, false)
  assert.equal(partesMes('Pago 3 de 10'), null)
})

// Caso real anonimizado (5-11-2026): el correo de dos facturas de un cliente (Proyecto A y Servicio B) quedó guardado con las líneas por trabajo escritas
// a mano, «(N° 511)» y «(N° 512)». El auditor lo marcó (plantilla_con_numeros) y el siguiente envío habría repetido esos folios.
const LINEAS_1 = '– Proyecto A: Pago 1 de 18 (N° 511).\n– Servicio B: Octubre 2026 (N° 512).'
const LINEAS_2 = '– Proyecto A: Pago 2 de 18 (N° 513).\n– Servicio B: Noviembre 2026 (N° 514).'
const CUERPO = l => `Espero que estés muy bien. Adjuntamos las facturas N° ${l === LINEAS_1 ? '511 y 512' : '513 y 514'}, correspondientes a los siguientes trabajos:\n${l}`

test('las líneas por trabajo de varias facturas se guardan como {trabajos} y el siguiente envío sale con sus propios folios', () => {
  const guardado = tokenizar(CUERPO(LINEAS_1), { folios: 'N° 511 y 512', trabajos: LINEAS_1 })
  assert.equal(guardado, 'Espero que estés muy bien. Adjuntamos las facturas {folios}, correspondientes a los siguientes trabajos:\n{trabajos}')
  assert.deepEqual(numerosEscritos(guardado), [])
  const r = destokenizar(guardado, { folios: 'N° 513 y 514', trabajos: LINEAS_2 })
  assert.equal(r.completo, true)
  assert.equal(r.texto, CUERPO(LINEAS_2))
  assert.doesNotMatch(r.texto, /511|512/)
})

test('un texto ya guardado con las líneas escritas a mano se convierte al leerlo (sin valores)', () => {
  const viejo = 'Espero que estés muy bien. Adjuntamos las facturas {folios}, correspondientes a los siguientes trabajos:\n– Proyecto A: Pago {cuota} (N° 511).\n– Servicio B: Octubre 2026 (N° 512).'
  const leido = tokenizar(viejo, {})
  assert.match(leido, /\n\{trabajos\}$/)
  assert.deepEqual(numerosEscritos(leido), [])
  assert.equal(destokenizar(leido, { folios: 'N° 513 y 514', trabajos: LINEAS_2 }).texto, CUERPO(LINEAS_2))
})

test('{trabajos} sin las facturas del envío no se completa: se usa el texto por defecto', () => {
  assert.equal(destokenizar('Adjuntamos {folios}.\n{trabajos}', { folios: 'N° 500' }).completo, false)
})

test('una lista con guion que no lleva folios no se toca', () => {
  const t = 'Puntos a revisar:\n– Contrato firmado.\n– Poder vigente.'
  assert.equal(tokenizar(t, {}), t)
})
