// Reconocer una solicitud de fondos en un correo enviado: monto y cliente, solo cuando no hay duda.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { montoDeTexto, montoSolicitado, montoCorto, pedidosInternos, clienteDePedido, clienteDeCorreo } from './../supabase/functions/_shared/fondosReglas.js'

test('monto del correo: uno solo, con o sin puntos, en pesos; varios distintos o ninguno, no se adivina', () => {
  assert.equal(montoDeTexto('Solicitud de fondos por $1.200.000 para la constitución'), 1200000)
  assert.equal(montoDeTexto('Provisión de fondos $ 300.000'), 300000)
  assert.equal(montoDeTexto('te pido 450.000 pesos de provisión'), 450000)
  assert.equal(montoDeTexto('fondos $300000'), 300000)
  assert.equal(montoDeTexto('el mismo monto $1.200.000 y de nuevo $1.200.000'), 1200000)
  assert.equal(montoDeTexto('$1.200.000 o bien $800.000'), null)
  assert.equal(montoDeTexto('Solicitud de fondos'), null)
  assert.equal(montoDeTexto('son $500 de papel'), null)          // bajo el mínimo de un fondo
  assert.equal(montoDeTexto('rol 1.234.567 de la causa'), null)    // sin signo $ ni «pesos»: no es un monto
  assert.equal(montoDeTexto(null), null)
})

test('monto solicitado: entre gastos incurridos y total, vale la cifra que se pide transferir (correos reales, anonimizados)', () => {
  const vkh = 'Gastos notariales: $25.000, $35.000, $35.000. Total incurrido: $95.000. Adicionalmente, un fondo de $200.000. Por lo anterior, les pedimos transferir un total de $295.000 a la cuenta destinada a gastos'
  assert.equal(montoSolicitado(vkh), 295000)
  const sbs = 'quisiera pedirle por favor que nos transfiera un fondo por rendir para los gastos asociados a la constitución de la sociedad que prestará el servicio de pasajeros en la ciudad de Osorno, por un total de $1.200.000.-'
  assert.equal(montoSolicitado(sbs), 1200000)   // la cifra queda a más de 80 caracteres de «transfiera»: la toma «por un total de»
  assert.equal(montoSolicitado('fondos por $300.000'), 300000)          // sin frase: la cifra única de siempre
  assert.equal(montoSolicitado('Total incurrido: $95.000 y un fondo de $200.000'), null)   // sin frase y con dos cifras: no se adivina
  assert.equal(montoSolicitado('transferir $100.000 o $200.000'), null)  // la frase nombra dos cifras
  assert.equal(montoSolicitado(null), null)
})

const clients = [
  { id: 1, name: 'Inversiones Osorno SpA' }, { id: 2, name: 'Agrícola Villarrica Ltda' },
  { id: 3, name: 'Oficina', is_internal: true }, { id: 4, name: 'Cliente Cerrado SpA', status: 'Terminado' },
]
const mapa = new Map([['gerencia@osorno.cl', new Set(['1'])], ['compartido@x.cl', new Set(['1', '2'])]])

test('cliente del correo: el único destinatario conocido; dos clientes en los destinatarios, ninguno', () => {
  assert.equal(clienteDeCorreo(['gerencia@osorno.cl', 'otro@desconocido.cl'], '', clients, mapa), '1')
  assert.equal(clienteDeCorreo(['compartido@x.cl'], 'Inversiones Osorno SpA', clients, mapa), null)
})

test('cliente del correo: sin destinatario conocido vale el nombre en el texto, si es uno solo y de un cliente vigente', () => {
  assert.equal(clienteDeCorreo(['x@y.cl'], 'Solicitud de fondos Agrícola Villarrica Ltda', clients, mapa), '2')
  assert.equal(clienteDeCorreo(['x@y.cl'], 'Inversiones Osorno SpA y Agrícola Villarrica Ltda', clients, mapa), null)
  assert.equal(clienteDeCorreo(['x@y.cl'], 'Cliente Cerrado SpA', clients, mapa), null)   // terminado
  assert.equal(clienteDeCorreo(['x@y.cl'], 'Oficina', clients, mapa), null)               // interno y nombre corto
  assert.equal(clienteDeCorreo([], '', clients, mapa), null)
})

test('monto corto: 2M, 1,5M, millones y pesos; un número suelto no es monto', () => {
  assert.equal(montoCorto('2M'), 2000000)
  assert.equal(montoCorto('1,5M'), 1500000)
  assert.equal(montoCorto('1.5 millones'), 1500000)
  assert.equal(montoCorto('$2.000.000'), 2000000)
  assert.equal(montoCorto('300.000'), 300000)
  assert.equal(montoCorto('2'), null)
  assert.equal(montoCorto('rol 1234'), null)
  assert.equal(montoCorto('4M de papel'), 4000000)   // lo que sigue al monto no cuenta: la línea ya trae su forma
  assert.equal(montoCorto(null), null)
})

test('pedido interno: una fila por línea «cliente: concepto: monto» (correo real entre el equipo, anonimizado)', () => {
  const correo = 'Marti,\n\nPor favor hacer las siguientes solicitudes de fxr.\n\n- Alfa Perez: Puesta en marcha proyecto Sur: 2M\n- Geslog: Reorganización: 1,5M\n- Beta: Inscripción posesión efectiva y liquidación: 2M\n\nSaludos,'
  assert.deepEqual(pedidosInternos(correo), [
    { cliente: 'Alfa Perez', concepto: 'Puesta en marcha proyecto Sur', monto: 2000000 },
    { cliente: 'Geslog', concepto: 'Reorganización', monto: 1500000 },
    { cliente: 'Beta', concepto: 'Inscripción posesión efectiva y liquidación', monto: 2000000 },
  ])
  assert.deepEqual(pedidosInternos('• Gamma: provisión: $300.000'), [{ cliente: 'Gamma', concepto: 'provisión', monto: 300000 }])
  assert.deepEqual(pedidosInternos('- Delta: sin monto\n- Épsilon: gastos: 2\nTexto: sin viñeta: 2M'), [])   // sin monto válido o sin viñeta: no es pedido
  assert.deepEqual(pedidosInternos(''), [])
})

test('cliente del pedido: el nombre corto dentro del de un cliente vigente, si es uno solo', () => {
  const cs = [{ id: 1, name: 'Geslog SpA' }, { id: 2, name: 'Alfa Perez Ltda' }, { id: 3, name: 'Beta Uno SpA' }, { id: 4, name: 'Beta Dos SpA' }, { id: 5, name: 'Geslog Cerrada', status: 'Terminado' }, { id: 6, name: 'Oficina Interna', is_internal: true }]
  assert.equal(clienteDePedido('Geslog', cs), '1')            // la terminada no cuenta
  assert.equal(clienteDePedido('Alfa Perez', cs), '2')
  assert.equal(clienteDePedido('Beta', cs), null)              // dos clientes: elige una persona
  assert.equal(clienteDePedido('Fu', cs), null)                // demasiado corto
  assert.equal(clienteDePedido('Oficina', cs), null)           // interno
  assert.equal(clienteDePedido('', cs), null)
})
