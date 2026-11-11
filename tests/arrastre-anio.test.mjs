// Arrastre del año siguiente: proyectos vigentes + asesorías × 12, sin contar dos veces las cuotas de asesorías ni el subarriendo, y con los ajustes del borrador. Datos anonimizados.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { arrastreAnio, cuotasEntre, lineasArrastre, aplicarAjustesArrastre, ajustarLinea, restaurarArrastre, agregarExtra, editarExtra, lineasTocadas, normalizarArrastre } from './../supabase/functions/_shared/arrastreAnio.js'

const fila = (id, cid, monto, due, extra = {}) => ({ k: 'porVencer', motivo: null, id, monto, b: { id, client_id: cid, due, ...(extra.b || {}) }, ...extra, ...(extra.k ? { k: extra.k } : {}) })
const filas = [
  fila('1', 'a', 1_000_000, '2027-01-15'), fila('2', 'a', 500_000, '2027-03-10'), fila('3', 'b', 2_000_000, '2027-03-20'),
  fila('4', 'c', 90_000, '2027-02-05', { motivo: 'recurrente' }),                       // cuota de una asesoría: ya va en asesorías × 12
  fila('5', 'sub', 1_080_000, '2027-02-01', { b: { billing_type: 'subarriendo' } }),    // subarriendo: no es ingreso
  fila('6', 'd', 700_000, '2027-04-01', { k: 'fuera' }),                                 // fuera de lo vigente
  fila('7', 'e', 300_000, '2027-04-01', { k: 'porConfirmar' }),
]
const ases = [{ cid: 'c', anual: 1_080_000 }, { cid: 'f', anual: 240_000 }]

test('arrastre = proyectos vigentes + asesorías × 12; sin cuotas recurrentes, subarriendo ni partidas fuera de lo vigente', () => {
  const r = arrastreAnio({ filas, asesorias: ases })
  assert.equal(r.proyectos, 3_500_000); assert.equal(r.asesorias, 1_320_000); assert.equal(r.total, 4_820_000); assert.equal(r.subarriendo, 1_080_000)
  const ingenuo = filas.filter((f) => f.k === 'porVencer').reduce((a, f) => a + f.monto, 0) + 1_320_000
  assert.ok(ingenuo > r.total)   // la suma ingenua cuenta de más (subarriendo y cuota recurrente)
})
test('por cliente y por mes suman el total; los morosos se señalan y no se descuentan', () => {
  const r = arrastreAnio({ filas, asesorias: ases, morosos: ['a', 'zz'] })
  assert.equal(r.porCliente.reduce((x, c) => x + c.total, 0), r.total)
  assert.ok(Math.abs(r.porMes.reduce((x, v) => x + v, 0) - r.total) < 1e-6)
  assert.deepEqual(r.morosos.cids, ['a']); assert.equal(r.morosos.monto, 1_500_000); assert.ok(Math.abs(r.morosos.pct - 1_500_000 / 4_820_000 * 100) < 1e-9)
  assert.equal(r.total, 4_820_000)
  assert.equal(r.porCliente.find((c) => c.cid === 'c').asesorias, 1_080_000)
})
test('sin datos: todo cero', () => {
  const r = arrastreAnio({ filas: [], asesorias: [] })
  assert.deepEqual([r.total, r.morosos.n, r.morosos.pct, r.porCliente.length], [0, 0, 0, 0])
  assert.deepEqual(arrastreAnio({ filas: null, asesorias: null }).porMes, Array(12).fill(0))
})
test('cuotasEntre: solo proyectos vigentes dentro del rango', () => {
  const f = [fila('1', 'a', 100, '2026-11-20'), fila('2', 'a', 50, '2026-12-31'), fila('3', 'a', 70, '2027-01-01'), fila('4', 'c', 9, '2026-12-01', { motivo: 'recurrente' })]
  assert.equal(cuotasEntre(f, '2026-11-01', '2026-12-31'), 150)
})

// ── Ajustes del arrastre (st.arrastre) ──
const f2 = (id, cid, monto, due, venta, extra = {}) => ({ k: 'porVencer', motivo: null, id, monto, b: { id, client_id: cid, due, sale_id: venta, ...(extra.b || {}) }, ...(extra.motivo ? { motivo: extra.motivo } : {}) })
const fil2 = [
  f2('1', 'a', 1_000_000, '2027-01-15', 's1', { b: { concept: 'Cuota 1' } }), f2('2', 'a', 500_000, '2027-03-10', 's1'), f2('3', 'b', 2_000_000, '2027-03-20', 's2'),
  f2('4', 'c', 90_000, '2027-02-05', 's3', { motivo: 'recurrente' }), f2('5', 'sub', 1_080_000, '2027-02-01', 's9', { b: { billing_type: 'subarriendo' } }),
]
const ases2 = [{ cid: 'c', anual: 1_200_000, id: 's3', concepto: 'Asesoría C' }, { cid: 'a', anual: 600_000, id: 's4', concepto: 'Asesoría A' }]
const ventas = { s1: 'Proyecto uno', s2: 'Proyecto dos' }
const base = lineasArrastre({ filas: fil2, asesorias: ases2, ventas })
const sumaPm = (r) => r.porMes.reduce((x, v) => x + v, 0)
const cuadra = (r) => { assert.ok(Math.abs(r.porCliente.reduce((x, c) => x + c.total, 0) - r.total) < 1e-6, 'clientes'); assert.ok(Math.abs(sumaPm(r) - r.total) < 1e-6, 'meses'); assert.ok(Math.abs(r.lineas.reduce((x, l) => x + l.monto, 0) - r.total) < 1e-6, 'líneas') }

test('una línea por venta: las cuotas de una venta se juntan y las de una asesoría no se cuentan dos veces', () => {
  assert.deepEqual(base.lineas.map((l) => [l.id, l.monto, l.n]), [['pf:s1', 1_500_000, 2], ['pf:s2', 2_000_000, 1], ['as:s3', 1_200_000, 12], ['as:s4', 600_000, 12]])
  assert.equal(base.lineas[0].concepto, 'Proyecto uno'); assert.equal(base.subarriendo, 1_080_000)
  const r = aplicarAjustesArrastre(base, undefined); cuadra(r)
  assert.equal(r.total, 5_300_000); assert.equal(r.nAjustadas, 0)
  assert.equal(r.total, arrastreAnio({ filas: fil2, asesorias: ases2, ventas }).total)   // el atajo da la misma cifra
})
test('ajustar el monto de una cuota reparte el nuevo monto en los mismos meses y marca la línea', () => {
  const arr = ajustarLinea(undefined, base.lineas[0], { monto: 750_000 })
  const r = aplicarAjustesArrastre(base, arr); cuadra(r)
  assert.equal(r.proyectos, 2_750_000); assert.equal(r.total, 4_550_000); assert.equal(r.nAjustadas, 1)
  const r0 = aplicarAjustesArrastre(base)
  assert.ok(Math.abs(r.porMes[0] - r0.porMes[0] + 500_000) < 1e-6 && Math.abs(r.porMes[2] - r0.porMes[2] + 250_000) < 1e-6)   // ene baja 1.000.000 → 500.000 y mar 500.000 → 250.000 (2/3 y 1/3 del monto nuevo)
  const l = r.lineas.find((x) => x.id === 'pf:s1'); assert.equal(l.ajustado, true); assert.equal(l.base.monto, 1_500_000)
})
test('quitar una línea la deja en cero y volver a incluirla la restaura; escribir el valor de la app no cuenta como ajuste', () => {
  const q = ajustarLinea(undefined, base.lineas[1], { quitado: true })
  const r = aplicarAjustesArrastre(base, q); cuadra(r)
  assert.equal(r.total, 3_300_000); assert.equal(r.nQuitadas, 1); assert.equal(r.porCliente.find((c) => c.cid === 'b'), undefined)
  const v = ajustarLinea(q, base.lineas[1], { quitado: false })
  assert.deepEqual(v, { ajustes: {}, extras: [] }); assert.equal(aplicarAjustesArrastre(base, v).total, 5_300_000)
  assert.deepEqual(ajustarLinea(undefined, base.lineas[0], { monto: 1_500_000 }), { ajustes: {}, extras: [] })
})
test('asesoría: monto mensual y meses en 2027 (una que termina en junio vale 6 meses)', () => {
  const arr = ajustarLinea(undefined, base.lineas[2], { meses: 6 })
  const r = aplicarAjustesArrastre(base, arr); cuadra(r)
  assert.equal(r.asesorias, 600_000 + 600_000); assert.equal(r.total, 4_700_000)
  const l = r.lineas.find((x) => x.id === 'as:s3'); assert.equal(l.meses, 6); assert.equal(l.monto, 600_000); assert.equal(l.porMes[5], 100_000); assert.equal(l.porMes[6], 0)
  const r2 = aplicarAjustesArrastre(base, ajustarLinea(arr, base.lineas[2], { mensual: 150_000 })); cuadra(r2)
  assert.equal(r2.lineas.find((x) => x.id === 'as:s3').monto, 900_000)
  assert.equal(aplicarAjustesArrastre(base, ajustarLinea(undefined, base.lineas[2], { meses: 40 })).lineas.find((x) => x.id === 'as:s3').meses, 12)   // tope de 12 meses
})
test('agregar una línea manual: meses parciales desde el mes de inicio, por cliente y por mes sin doble conteo', () => {
  const arr = agregarExtra(undefined, { nombre: 'Contrato nuevo', mensual: 300_000, desde: 11, meses: 6 }, 'n1')   // noviembre: solo cabe noviembre y diciembre
  const r = aplicarAjustesArrastre(base, arr); cuadra(r)
  assert.equal(r.agregadas, 600_000); assert.equal(r.total, 5_900_000); assert.equal(r.nAgregadas, 1)
  assert.equal(r.porMes[9], base.lineas.reduce((x, l) => x + l.porMes[9], 0)); assert.equal(r.porMes[10] - aplicarAjustesArrastre(base).porMes[10], 300_000)
  const c = r.porCliente.find((x) => x.cid === 'x:n1'); assert.equal(c.nombre, 'Contrato nuevo'); assert.equal(c.total, 600_000)
  const e2 = editarExtra(arr, 'n1', { quitado: true }); assert.equal(aplicarAjustesArrastre(base, e2).total, 5_300_000)
  assert.deepEqual(editarExtra(arr, 'n1', null).extras, [])
})
test('un cliente con cuota y asesoría suma una sola vez; los morosos usan el total con ajustes', () => {
  const arr = ajustarLinea(undefined, base.lineas[3], { quitado: true })
  const r = aplicarAjustesArrastre(base, arr, ['a']); cuadra(r)
  assert.equal(r.porCliente.find((c) => c.cid === 'a').total, 1_500_000)   // la asesoría de «a» quedó quitada
  assert.equal(r.morosos.monto, 1_500_000); assert.deepEqual(r.morosos.cids, ['a'])
  assert.equal(r.lineas.find((l) => l.id === 'pf:s1').moroso, true)
})
test('restaurar una línea o todas las de la app conserva lo agregado', () => {
  let arr = ajustarLinea(undefined, base.lineas[0], { monto: 1, nota: 'se cae' }); arr = ajustarLinea(arr, base.lineas[2], { meses: 3 }); arr = agregarExtra(arr, { nombre: 'X', mensual: 1, desde: 1, meses: 1 }, 'n1')
  assert.equal(lineasTocadas(arr), 3)
  assert.deepEqual(Object.keys(restaurarArrastre(arr, 'pf:s1').ajustes), ['as:s3'])
  const t = restaurarArrastre(arr); assert.deepEqual(t.ajustes, {}); assert.equal(t.extras.length, 1)
  assert.equal(aplicarAjustesArrastre(base, arr).lineas.find((l) => l.id === 'pf:s1').nota, 'se cae')
})
test('un bloque antiguo o dañado se normaliza sin romper', () => {
  assert.deepEqual(normalizarArrastre(undefined), { ajustes: {}, extras: [] })
  assert.deepEqual(normalizarArrastre({ ajustes: { x: {} }, extras: 'no' }), { ajustes: {}, extras: [] })
  assert.equal(aplicarAjustesArrastre({ lineas: [], subarriendo: 0 }, null).total, 0)
})

test('Comparar versiones: cuenta las líneas ajustadas y muestra el total del arrastre de cada estado', async () => {
  const { estadoInicial, diferenciaEstructurada } = await import('./../supabase/functions/_shared/presupuesto.js')
  const a = estadoInicial({ costos: [] }), b = JSON.parse(JSON.stringify(a))
  b.arrastre = { ajustes: { 'as:s3': { meses: 6 } }, extras: [{ id: 'n1', nombre: 'Nuevo', mensual: 1, desde: 1, meses: 1 }] }
  const f = { mm: (n) => `$${n}`, pc: String, totalArrastre: (e) => aplicarAjustesArrastre(base, e.arrastre).total }
  const r = diferenciaEstructurada(a, b, f).filter((x) => x.grupo === 'Arrastre')
  assert.deepEqual(r.map((x) => [x.etiqueta, x.antes, x.despues]), [['Líneas ajustadas', '0', '2'], ['Total del arrastre', '$5300000', '$4700001']])
  assert.deepEqual(diferenciaEstructurada(a, JSON.parse(JSON.stringify(a)), f).filter((x) => x.grupo === 'Arrastre'), [])   // iguales: nada que mostrar
})
