import test from 'node:test'
import assert from 'node:assert/strict'
import { correoDeMensaje, debeLeerAhora, estadoConexion, planAtribucion, saludoDeCorreo, umbralHoras } from '../supabase/functions/_shared/gmailLectura.js'

// Horas de Chile: en noviembre rige UTC-3, en junio UTC-4. Se prueba con instantes en UTC.
const utc = s => new Date(s)

test('lectura programada: 07:00 todos los días; 13:00 y 18:00 solo del 1 al 8', () => {
  assert.equal(debeLeerAhora(utc('2026-11-12T10:05:00Z')), true)    // 07:05 en Chile (UTC-3)
  assert.equal(debeLeerAhora(utc('2026-11-12T16:05:00Z')), false)   // 13:05, día 12: no
  assert.equal(debeLeerAhora(utc('2026-11-05T16:05:00Z')), true)    // 13:05, día 5: sí
  assert.equal(debeLeerAhora(utc('2026-11-05T21:05:00Z')), true)    // 18:05, día 5: sí
  assert.equal(debeLeerAhora(utc('2026-11-09T21:05:00Z')), false)   // 18:05, día 9: no
  assert.equal(debeLeerAhora(utc('2026-11-05T22:05:00Z')), false)   // 19:05
  // Invierno (UTC-4): las 07:00 de Chile son las 11:00 UTC; el mismo cron a las 10:05 UTC ya no es la hora.
  assert.equal(debeLeerAhora(utc('2026-06-12T11:05:00Z')), true)
  assert.equal(debeLeerAhora(utc('2026-06-12T10:05:00Z')), false)
})

test('estado de la conexión: se calcula con la hora de la última lectura', () => {
  const ahora = utc('2026-11-12T15:00:00Z')   // día 12: umbral 36 h
  assert.equal(umbralHoras(ahora), 36)
  assert.equal(umbralHoras(utc('2026-11-05T15:00:00Z')), 20)
  assert.deepEqual(estadoConexion(null, ahora), { k: 'sin' })
  assert.deepEqual(estadoConexion({ estado: 'activa', ultimo_ok: null }, ahora), { k: 'ok' })                       // recién conectada
  assert.deepEqual(estadoConexion({ estado: 'activa', ultimo_ok: '2026-11-12T10:00:00Z' }, ahora), { k: 'ok' })     // 5 h
  assert.deepEqual(estadoConexion({ estado: 'activa', ultimo_ok: '2026-11-10T22:00:00Z' }, ahora), { k: 'atrasada' }) // 41 h
  assert.deepEqual(estadoConexion({ estado: 'activa', ultimo_ok: '2026-11-08T10:00:00Z' }, ahora), { k: 'fallo' })    // 101 h
  assert.deepEqual(estadoConexion({ estado: 'revocada', ultimo_ok: '2026-11-12T10:00:00Z' }, ahora), { k: 'reconectar' })
  // En la semana de facturación 20 h ya es atraso.
  const sem = utc('2026-11-05T15:00:00Z')
  assert.deepEqual(estadoConexion({ estado: 'activa', ultimo_ok: '2026-11-04T15:00:00Z' }, sem), { k: 'atrasada' }) // 24 h
})

test('mensaje de Gmail → correo: solo encabezados, adjuntos y el comienzo del texto; fecha en Chile', () => {
  const c = correoDeMensaje({
    id: 'm1', internalDate: String(Date.parse('2026-11-04T02:30:00Z')), snippet: 'Adjuntamos la factura N° 500',
    payload: { headers: [{ name: 'From', value: 'Erasmo <ee@leabogados.cl>' }, { name: 'To', value: 'Cliente <pagos@cliente.cl>' }, { name: 'Cc', value: 'cl@leabogados.cl' }, { name: 'Subject', value: 'Factura 500 | Servicios' }],
      parts: [{ filename: '', parts: [{ filename: 'Factura 500.pdf', mimeType: 'application/pdf' }] }] } })
  assert.equal(c?.de, 'ee@leabogados.cl')
  assert.deepEqual(c?.para, ['pagos@cliente.cl'])
  assert.deepEqual(c?.cc, ['cl@leabogados.cl'])
  assert.equal(c?.fecha, '2026-11-03')   // las 02:30 UTC del 4 son las 23:30 del 3 en Chile
  assert.deepEqual(c?.adjuntos, [{ nombre: 'Factura 500.pdf', mime: 'application/pdf' }])
  assert.equal(correoDeMensaje(null), null)
})

test('atribución: completa quién, a quién y la fecha real solo en facturas sin destinatario registrado', () => {
  const facturas = [
    { id: 'a', email_sent_at: '2026-11-04T17:44:00.000Z' },   // marcada a mano el 4-11
    { id: 'b', email_sent_at: '2026-11-03T15:00:00.000Z', sent_to: 'x@c.cl' },   // ya tiene prueba: no se toca
    { id: 'c', email_sent_at: '2026-11-02T15:00:00.000Z' },   // el correo es del mismo día: se conserva la hora
    { id: 'd', email_sent_at: null },                          // no figura enviada: no se toca
  ]
  const correos = [{ id: 'm1', para: ['pagos@c.cl'], cc: ['cl@leabogados.cl'], fecha: '2026-10-29' }, { id: 'm2', para: ['p@c.cl'], cc: [], fecha: '2026-11-02' }]
  const hallazgos = [
    { correo_id: 'm1', factura_id: 'a', nivel: 'coincide' }, { correo_id: 'm1', factura_id: 'b', nivel: 'coincide' },
    { correo_id: 'm2', factura_id: 'c', nivel: 'coincide' }, { correo_id: 'm2', factura_id: 'd', nivel: 'coincide' },
    { correo_id: 'm2', factura_id: 'a', nivel: 'probable' },
  ]
  const r = planAtribucion({ facturas, hallazgos, correos, quien: 'Erasmo' })
  assert.deepEqual(r.map(x => x.id), ['a', 'c'])
  assert.equal(r[0].email_sent_at, '2026-10-29T15:00:00.000Z')   // fecha real del correo, no la del marcado
  assert.equal(r[0].sent_to, 'pagos@c.cl, cl@leabogados.cl')
  assert.equal(r[0].sent_by, 'Erasmo')
  assert.equal(r[1].email_sent_at, '2026-11-02T15:00:00.000Z')   // mismo día: se conserva
})

test('saludo de un correo enviado: solo singular con nombre y una dirección de afuera', () => {
  const c = (fragmento, para) => ({ fragmento, para })
  assert.deepEqual(saludoDeCorreo(c('Estimada Carolina, Espero que estés muy bien. Adjuntamos la factura N° 480', ['pagos@cliente.cl']), 'leabogados.cl'), { email: 'pagos@cliente.cl', saludo: 'Estimada Carolina,' })
  assert.deepEqual(saludoDeCorreo(c('Estimado Agustín, Espero que estés', ['amolinari@tarragona.cl', 'amolinari@tarragona.cl']), ''), { email: 'amolinari@tarragona.cl', saludo: 'Estimado Agustín,' })
  assert.equal(saludoDeCorreo(c('Estimados, Espero que estén muy bien', ['pagos@cliente.cl'])), null)
  assert.equal(saludoDeCorreo(c('Estimado Agustín, Espero', ['a@x.cl', 'b@x.cl'])), null)               // dos destinatarios
  assert.equal(saludoDeCorreo(c('Estimado Agustín, Espero', ['socio@leabogados.cl']), 'leabogados.cl'), null)   // solo interno
  assert.equal(saludoDeCorreo(c('Hola, adjunto la factura', ['pagos@cliente.cl'])), null)
})
