// Pruebas de la agrupación de la Bandeja del agente. Datos anonimizados.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agruparBandeja, asuntoBase, gruposBandeja, grupoAccionBandeja, MOTIVO_SIN_CLIENTE } from '../supabase/functions/_shared/bandejaReglas.js'

const sala = (id, fecha, asunto = 'Servicio Programación de salas') => ({ id, tipo: 'informativo', estado: 'sin_accion', asunto, de: 'sala@proveedor-salas.test', de_nombre: 'Servicio Programación de salas', recibido_at: fecha, motivo: MOTIVO_SIN_CLIENTE, propuesta: {} })

test('asuntoBase quita Re:/RV:/Fwd: encadenados', () => {
  assert.equal(asuntoBase('RE: Rv: Fwd:  Aviso de pago '), 'Aviso de pago')
  assert.equal(asuntoBase(null), '')
})

test('«Servicio Programación de salas» x4 es 1 grupo de 4, con el último correo', () => {
  const rows = [sala('a', '2026-11-03T10:00:00Z'), sala('b', '2026-11-06T08:02:00Z', 'RE: Servicio Programación de salas'), sala('c', '2026-11-04T09:00:00Z'), sala('d', '2026-11-05T09:00:00Z')]
  const g = agruparBandeja(rows)
  assert.equal(g.length, 1)
  assert.equal(g[0].n, 4)
  assert.equal(g[0].ultimo, '2026-11-06T08:02:00Z')
  assert.deepEqual(g[0].rows.map(r => r.id), ['b', 'd', 'c', 'a'])
})

test('distinto remitente o distinto tipo no se mezcla; los grupos van del más reciente al más antiguo', () => {
  const a = sala('a', '2026-11-01T10:00:00Z'), b = { ...sala('b', '2026-11-02T10:00:00Z'), de: 'otro@proveedor-salas.test' }, c = { ...sala('c', '2026-11-03T10:00:00Z'), tipo: 'spam' }
  const g = agruparBandeja([a, b, c])
  assert.equal(g.length, 3)
  assert.deepEqual(g.map(x => x.rows[0].id), ['c', 'b', 'a'])
  assert.deepEqual(agruparBandeja([]), [])
})

test('gruposBandeja: el aviso sin cliente forma su propia tarjeta por remitente; el resto, por categoría; las partes suman', () => {
  const rows = [
    sala('a', '2026-11-03T10:00:00Z'), sala('b', '2026-11-04T10:00:00Z'),
    { id: 'x', tipo: 'comprobante', estado: 'registrado', motivo: 'Depósito del 15-10-2026 ya conciliado', propuesta: {}, recibido_at: '2026-10-15T10:00:00Z' },
    { id: 'y', tipo: 'spam', estado: 'sin_accion', motivo: 'Publicidad o notificación', propuesta: {}, recibido_at: '2026-10-16T10:00:00Z' },
    { id: 'z', tipo: 'x', estado: 'descartado', motivo: 'Descartado por X', propuesta: {}, recibido_at: '2026-10-17T10:00:00Z' },
  ]
  const g = gruposBandeja(rows)
  assert.deepEqual(g.map(x => [x.t, x.n, x.solo]), [['Depósitos ya conciliados', 1, false], ['Servicio Programación de salas', 2, true], ['Publicidad y notificaciones', 1, false], ['Descartados', 1, false]])
  assert.equal(g.reduce((s, x) => s + x.n, 0), rows.length)
})

test('grupoAccionBandeja: una partida por acción distinta', () => {
  const t = a => grupoAccionBandeja({ propuesta: { accion: a } }).t
  assert.equal(t('asignar_venta'), t('registrar_factura'))
  assert.equal(t('pedir_boleta'), t('definir_documento'))
  assert.equal(t('registrar_fondo'), 'Fondos por registrar')
  assert.equal(t(undefined), 'Por revisar')
})
