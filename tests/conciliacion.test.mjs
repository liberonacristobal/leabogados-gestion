// Pruebas del calce automático de abonos (conciliacionReglas): facturas, fondos, anticipos, cargos recurrentes y contadora.
// Casos de situaciones reales, sin nombres de clientes. Correr: npm test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normRut, mesDiff, candidatosFactura, delMes, elegirFondo, elegirAnticipo, proyectoEnTexto, pareceFondo, rachaCargo, repartoContadora } from './../supabase/functions/_shared/conciliacionReglas.js'

const fac = (no, issued_at, rut = '76.111.111-1') => ({ invoice_no: no, issued_at, receptor_rut: rut })

test('RUT: se compara sin puntos ni guion y con K en mayúscula', () => {
  assert.equal(normRut('76.111.111-k'), '76111111K')
  assert.equal(normRut(null), '')
})

test('diferencia de meses entre factura y pago; sin dato no se inventa', () => {
  assert.equal(mesDiff('2026-08', '2026-10'), -2)
  assert.equal(mesDiff('2026-12', '2026-10'), 2)
  assert.equal(mesDiff(null, '2026-10'), null)
})

test('candidatos: solo saldo exacto y dentro de la ventana (60 días antes, 36 meses después)', () => {
  const mov = { fecha: '2026-10-20', monto: 500000 }
  const pool = [
    { b: fac('1', '2026-09-01'), saldo: 500000 },
    { b: fac('2', '2026-09-02'), saldo: 499999 },       // un peso distinto: no calza
    { b: fac('3', '2026-12-30'), saldo: 500000 },       // emitida 71 días después del pago: fuera
    { b: fac('4', '2023-01-01'), saldo: 500000 },       // más de 36 meses: fuera
    { b: fac('5', '2026-11-15'), saldo: 500000 },       // 26 días después (anticipo): dentro
  ]
  assert.deepEqual(candidatosFactura(mov, pool).map(f => f.invoice_no), ['1', '5'])
})

test('candidatos: primero la factura del RUT del pagador, luego la más antigua', () => {
  const mov = { fecha: '2026-10-20', monto: 100, rut_contraparte: '77.222.222-2' }
  const pool = [
    { b: fac('1', '2026-07-01', '76.111.111-1'), saldo: 100 },
    { b: fac('2', '2026-09-01', '77.222.222-2'), saldo: 100 },
    { b: fac('3', '2026-08-01', '77.222.222-2'), saldo: 100 },
  ]
  assert.deepEqual(candidatosFactura(mov, pool).map(f => f.invoice_no), ['3', '2', '1'])
})

test('la factura «del mes» es la emitida más cerca de la fecha del pago', () => {
  const fs = [fac('a', '2026-07-01'), fac('b', '2026-10-10'), fac('c', '2026-08-01')]
  assert.equal(delMes({ fecha: '2026-10-20' }, fs).invoice_no, 'b')
  assert.equal(delMes({}, fs).invoice_no, 'a')
  assert.equal(delMes({ fecha: '2026-10-20' }, []), null)
})

test('fondo: mismo monto exacto dentro de 10 días; uno solo se concilia', () => {
  const mov = { fecha: '2026-10-20', monto: 300000 }
  const fondos = [{ id: 1, amount: 300000, date: '2026-10-15', concept: 'Fondos', project: 'Alfa' }, { id: 2, amount: 300000, date: '2026-09-01', concept: 'Fondos', project: 'Beta' }]
  assert.equal(elegirFondo(mov, fondos, '').id, 1)
  assert.equal(elegirFondo({ ...mov, monto: 300001 }, fondos, ''), null)
})

test('fondo: con varios del mismo monto decide el trabajo que nombra el mensaje; sin pista y distintos, nadie', () => {
  const mov = { fecha: '2026-10-20', monto: 300000 }
  const fondos = [{ id: 1, amount: 300000, date: '2026-10-15', concept: 'Fondos', project: 'Osorno' }, { id: 2, amount: 300000, date: '2026-10-16', concept: 'Fondos', project: 'Villarica' }]
  assert.equal(elegirFondo(mov, fondos, 'constitución sociedad osorno').id, 1)
  assert.equal(elegirFondo(mov, fondos, 'abono'), null)
  const iguales = [{ id: 7, amount: 300000, date: '2026-10-15', concept: 'Fondos', project: 'Osorno' }, { id: 8, amount: 300000, date: '2026-10-16', concept: 'Fondos', project: 'Osorno' }]
  assert.equal(elegirFondo(mov, iguales, '').id, 7)   // mismo concepto y trabajo: el más antiguo
})

test('anticipo: único, mismo monto al peso, ±10 días, sin marca de revisado ni origen en una conciliación', () => {
  const mov = { fecha: '2026-10-20', monto: 800000 }
  const a = { id: 1, monto: 800000, fecha: '2026-10-18', nota: '' }
  assert.equal(elegirAnticipo(mov, [a]).id, 1)
  assert.equal(elegirAnticipo(mov, [{ ...a, nota: 'saldo a favor ·revisado' }]), null)
  assert.equal(elegirAnticipo(mov, [{ ...a, nota: 'creado desde conciliación' }]), null)
  assert.equal(elegirAnticipo(mov, [{ ...a, fecha: '2026-09-01' }]), null)
  assert.equal(elegirAnticipo(mov, [a, { ...a, id: 2 }]), null)   // dos iguales: lo decide una persona
})

test('trabajo nombrado en un texto: nombres del mismo trabajo cuentan como uno; trabajos distintos con la misma palabra, ninguno', () => {
  assert.equal(proyectoEnTexto('constitución sociedad osorno', ['Puesta en marcha Osorno', 'OSORNO']), 'Puesta en marcha Osorno')
  assert.equal(proyectoEnTexto('viáticos ovalle', ['Ovalle 2025', 'Ovalle arriendo', 'Otro']), null)
  assert.equal(proyectoEnTexto('', ['Osorno']), null)
})

test('abono sin destino: solo es fondo con señal positiva y nunca si habla de facturas', () => {
  const mov = { fecha: '2026-10-20', monto: 250000 }
  const sol = [{ id: 's1', monto: 250000, asunto: 'RE: Fondos Osorno', enviada_at: '2026-10-10' }]
  const r = pareceFondo(mov, 'transferencia', sol, ['Osorno'])
  assert.equal(r.fuente, 'solicitud'); assert.equal(r.solicitud, 's1'); assert.equal(r.proyecto, 'Osorno'); assert.equal(r.concepto, 'Fondos Osorno')
  assert.equal(pareceFondo(mov, 'pago factura 412', sol, ['Osorno']), null)
  assert.equal(pareceFondo(mov, 'transferencia', [{ ...sol[0], enviada_at: '2026-08-01' }], []), null)   // solicitud de hace más de 45 días
  assert.equal(pareceFondo(mov, 'viáticos', [], []).fuente, 'mensaje')
  assert.equal(pareceFondo(mov, 'varios', [], []), null)
})

test('cargo recurrente: la racha de 3 iguales clasifica el siguiente si el monto está a ±30%; otra clase corta la racha', () => {
  const p = f => ({ fecha: f, monto: 100000, clas: 'Servicios›Hosting' })
  const previos = [p('2026-07-01'), p('2026-08-01'), p('2026-09-01')]
  assert.equal(rachaCargo(previos, 125000), 'Servicios›Hosting')
  assert.equal(rachaCargo(previos, 131000), null)
  assert.equal(rachaCargo([...previos.slice(0, 2), { ...p('2026-09-01'), clas: 'Otra›Cosa' }], 100000), null)
  assert.equal(rachaCargo(previos.slice(0, 2), 100000), null)
})

test('contadora: la transferencia se reparte solo si calza al peso con una partida o con todas', () => {
  const valores = { mes: '2026-09', items: [{ item: 'PPM', monto: 300000 }, { item: 'Cotizaciones', monto: 200000 }, { item: 'Contador', monto: 100000 }] }
  assert.deepEqual(repartoContadora(200000, valores, []).map(p => p.subcategoria), ['Cotizaciones'])
  assert.equal(repartoContadora(600000, valores, []).length, 3)
  assert.equal(repartoContadora(250000, valores, []), null)
})

test('contadora: las retenciones de boletas se restan del PPM y van como parte de terceros; nunca un gasto en $0 ni negativo', () => {
  const valores = { mes: '2026-09', items: [{ item: 'PPM', monto: 300000 }] }
  const r = repartoContadora(300000, valores, [{ nombre: 'Prestador', folio: 12, monto: 100000 }])
  assert.deepEqual(r.map(p => [p.tipo, p.monto]), [['gasto', 200000], ['tercero', 100000]])
  assert.deepEqual(repartoContadora(300000, valores, [{ nombre: 'P', folio: 1, monto: 300000 }]).map(p => p.tipo), ['tercero'])
  assert.equal(repartoContadora(300000, valores, [{ nombre: 'P', folio: 1, monto: 400000 }]), null)
})

test('fondo y anticipo: el límite es de 10 días exactos', () => {
  const mov = { fecha: '2026-10-20', monto: 300000 }
  const fondo = d => [{ id: 1, amount: 300000, date: d, concept: 'Fondos', project: 'Alfa' }]
  assert.equal(elegirFondo(mov, fondo('2026-10-10'), '').id, 1)
  assert.equal(elegirFondo(mov, fondo('2026-10-09'), ''), null)
  const anti = d => [{ id: 1, monto: 300000, fecha: d, nota: '' }]
  assert.equal(elegirAnticipo(mov, anti('2026-10-30')).id, 1)
  assert.equal(elegirAnticipo(mov, anti('2026-10-31')), null)
})
