// Caso real anonimizado (2026-11-19): un cliente con correo en Microsoft 365 tenía guardadas las direcciones sin el punto
// («nombreapellido@») cuando su gente escribe «nombre.apellido@». El envío rebotó y la app dijo «enviado».
import test from 'node:test'
import assert from 'node:assert/strict'
import { direccionDudosa, motivoDeRebote, rebotesDe } from '../supabase/functions/_shared/direccionesReglas.js'

const vistas = ['nombre.apellido@cliente.com', 'otra.persona@cliente.com', 'sinpuntos@otro.cl']

test('una dirección sin el punto que sí aparece en el Gmail se avisa y se sugiere la real', () => {
  assert.deepEqual(direccionDudosa('nombreapellido@cliente.com', vistas, 'estudio.cl'), { sugerida: 'nombre.apellido@cliente.com' })
})
test('también al revés: con punto cuando la real no lo lleva', () => {
  assert.deepEqual(direccionDudosa('sin.puntos@otro.cl', vistas), { sugerida: 'sinpuntos@otro.cl' })
})
test('una dirección vista, o nueva sin parecida, no se avisa', () => {
  assert.equal(direccionDudosa('nombre.apellido@cliente.com', vistas), null)
  assert.equal(direccionDudosa('alguien@cliente.com', vistas), null)
})
test('un dominio distinto no cuenta como parecida; la oficina nunca se avisa', () => {
  assert.equal(direccionDudosa('nombreapellido@otro-dominio.com', vistas), null)
  assert.equal(direccionDudosa('mp@estudio.cl', ['m.p@estudio.cl'], 'estudio.cl'), null)
})
test('sin direcciones conocidas no avisa', () => {
  assert.equal(direccionDudosa('nombreapellido@cliente.com', []), null)
})

test('motivo del rebote en palabras simples', () => {
  assert.equal(motivoDeRebote('No se ha encontrado la dirección'), 'la dirección no existe')
  assert.equal(motivoDeRebote('El mensaje se bloqueó'), 'el servidor del destinatario lo bloqueó')
  assert.equal(motivoDeRebote('mailbox full'), 'el buzón está lleno')
  assert.equal(motivoDeRebote('algo raro'), 'el servidor del destinatario lo rechazó')
})

const T0 = Date.parse('2026-11-18T16:42:00Z')
const envios = [
  { id: 'r1', tipo: 'rendicion', destinatarios: ['nombreapellido@cliente.com', 'copia@cliente.com'], enviado_ms: T0 },
  { id: 'r2', tipo: 'rendicion', destinatarios: ['nombreapellido@cliente.com', 'copia@cliente.com'], enviado_ms: T0 },
  { id: 'f1', tipo: 'factura', destinatarios: ['otra@cliente.com'], enviado_ms: T0 },
]
test('el rebote marca los envíos que salieron a la dirección fallida (las dos rendiciones del mismo correo)', () => {
  const r = rebotesDe({ envios, correos: [{ id: 'b1', fecha_ms: T0 + 2000, fallidos: ['NombreApellido@cliente.com'], motivo: 'el servidor del destinatario lo bloqueó' }] })
  assert.deepEqual(r.map(x => x.envio_id).sort(), ['r1', 'r2'])
  assert.equal(r[0].direccion, 'nombreapellido@cliente.com')
})
test('un rebote anterior al envío, o de más de 3 días después, no cuenta', () => {
  assert.equal(rebotesDe({ envios, correos: [{ id: 'b', fecha_ms: T0 - 3600000, fallidos: ['nombreapellido@cliente.com'] }] }).length, 0)
  assert.equal(rebotesDe({ envios, correos: [{ id: 'b', fecha_ms: T0 + 4 * 86400000, fallidos: ['nombreapellido@cliente.com'] }] }).length, 0)
})
test('un rebote de una dirección a la que no se envió no marca nada', () => {
  assert.equal(rebotesDe({ envios, correos: [{ id: 'b', fecha_ms: T0 + 1000, fallidos: ['otro@x.com'] }] }).length, 0)
})
