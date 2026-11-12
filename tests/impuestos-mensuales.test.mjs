// Impuestos mensuales (F29): PPM, retención de honorarios por persona e impuesto único. Casos anonimizados de octubre y septiembre de 2026 (cuadran al peso con el «Iva» del correo de la contadora).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { impuestosMensuales, boletasPorCargar, brutoDeLiquido, pagosConBoleta, listaBoletasPorCargar, boletasSinEnlace, rutNormal, rutsDeDestino, destinoDeEmisor, ETIQ_DESTINO, impuestosPresupuesto, mesTrabajadoDePago, mismaPersona } from './../supabase/functions/_shared/impuestosMensuales.js'

const docs = [{ tipo_dte: 34, monto: 65_577_480, fecha_emision: '2026-10-15' }, { tipo_dte: 34, monto: 9_000_000, fecha_emision: '2026-09-10' }]
const B = (folio, fecha, nombre, bruto, ret, extra = {}) => ({ id: 'b' + folio, folio, fecha, emisor_nombre: nombre, bruto, retencion: ret, liquido: bruto - ret, tasa: 0.1525, estado: 'vigente', movimiento_id: 'm' + folio, ...extra })
const boletas = [B(43, '2026-08-31', 'Persona Externa Uno', 183065, 27917), B(380, '2026-09-30', 'Persona Tres Sin Enlace', 821144, 125224, { movimiento_id: null }), B(10, '2026-09-30', 'CARLA APELLIDO UNO', 589970, 89970), B(230, '2026-10-19', 'PERSONA DOS ZETA', 874703, 133392, { movimiento_id: null })]
const pagos = [
  { persona: 'Carla', fecha: '2026-08-31', liquido: 500000, origen: 'sueldo' }, { persona: 'Carla', fecha: '2026-10-01', liquido: 500000, origen: 'sueldo' }, { persona: 'Carla', fecha: '2026-10-30', liquido: 500000, origen: 'sueldo' },
  { persona: 'Pablo Soto Reyes', fecha: '2026-09-30', liquido: 350000, bruto: 412979, retencion: 62979, origen: 'comision' },
]
const liquidaciones = [{ periodo: '2026-10', persona: 'A', impuesto_unico: 134873 }, { periodo: '2026-10', persona: 'B', impuesto_unico: 134873 }, { periodo: '2026-10', persona: 'C', impuesto_unico: 28346 }, { periodo: '2026-09', persona: 'A', impuesto_unico: 160564 }]
const declarados = {
  '2026-08': { ppm: 416721, impuesto_unico: 161063, retencion_bhe: 27917, total: 605701, tasa_ppm: 2 },
  '2026-09': { ppm: 659577, impuesto_unico: 160564, retencion_bhe: 215194, total: 1035335, tasa_ppm: 2 },
}

test('octubre: PPM 2,0 % × base + retención (boleta cargada y boleta esperada) + impuesto único = el «Iva» del correo, al peso', () => {
  const r = impuestosMensuales({ per: '2026-10', docs, boletas, pagos, liquidaciones, declarados, informado: 1_833_004 })
  assert.equal(r.ppm.monto, 1_311_550); assert.equal(r.ppm.estado, 'estimado'); assert.equal(r.ppm.base, 65_577_480); assert.equal(r.ppm.tasa, 0.02)
  assert.equal(r.retencion.monto, 133_392 + 89_970); assert.equal(r.retencion.nFalta, 1); assert.equal(r.retencion.estado, 'falta')
  assert.equal(r.unico.monto, 298_092); assert.equal(r.unico.trabajadores.length, 3); assert.equal(r.unico.estado, 'verificado')
  assert.equal(r.total, 1_833_004); assert.equal(r.cuadra, true); assert.equal(r.porVerificar, false)
  assert.deepEqual(r.retencion.personas.map((p) => p.persona).sort(), ['Carla', 'PERSONA DOS ZETA'].sort())
  const mart = r.retencion.personas.find((p) => /carla/i.test(p.persona)); assert.equal(mart.boletas[0].falta, true); assert.equal(mart.boletas[0].bruto, 589_970); assert.equal(mart.boletas[0].retencion, 89_970)
})
test('una diferencia con el correo queda «por verificar» y no se esconde', () => {
  const r = impuestosMensuales({ per: '2026-10', docs, boletas, pagos, liquidaciones, declarados, informado: 1_900_000 })
  assert.equal(r.dif, 1_900_000 - 1_833_004); assert.equal(r.porVerificar, true); assert.equal(r.cuadra, false)
  assert.equal(impuestosMensuales({ per: '2026-10', docs, boletas, pagos, liquidaciones, declarados }).dif, null)
})
test('septiembre declarado: manda el F29 (verificado) y la suma de boletas cargadas cuadra con su retención; la boleta que falta es la de la comisión', () => {
  const r = impuestosMensuales({ per: '2026-09', docs, boletas, pagos, liquidaciones, declarados, informado: 1_035_335 })
  assert.equal(r.ppm.monto, 659_577); assert.equal(r.ppm.estado, 'verificado'); assert.equal(r.retencion.monto, 215_194); assert.equal(r.unico.monto, 160_564)
  assert.equal(r.total, 1_035_335); assert.equal(r.cuadra, true)
  assert.equal(r.retencion.calculado, 89_970 + 125_224 + 62_979); assert.equal(r.retencion.nFalta, 1)   // Pedro (comisión con retención registrada): falta su boleta
})
test('boletas por cargar: comisión con retención registrada = falta; sueldo de un mes con F29 declarado que no la trae = por verificar; sueldo de un mes sin declarar = falta', () => {
  const l = boletasPorCargar({ pagos, boletas, declarados })
  const por = (p, per) => l.find((x) => mismaPersona(x.persona, p) && x.per === per)
  assert.equal(por('Carla', '2026-10').estado, 'falta'); assert.equal(por('Carla', '2026-10').bruto, 589_970); assert.equal(por('Carla', '2026-10').retencion, 89_970); assert.equal(por('Carla', '2026-10').pagado, '2026-10-30')
  assert.equal(por('Carla', '2026-08').estado, 'por verificar'); assert.equal(por('Carla', '2026-08').pagado, '2026-08-31')
  assert.equal(por('Pablo Soto', '2026-09').estado, 'falta'); assert.equal(por('Pablo Soto', '2026-09').bruto, 412_979); assert.equal(por('Pablo Soto', '2026-09').retencion, 62_979)
  assert.equal(l.length, 3)   // el pago del 01-10 (mes trabajado septiembre) lo cubre la boleta del 30-09
})
test('un pago ligado a su boleta (bhe_id) o ya cubierto por una boleta de la misma persona y mes no pide nada', () => {
  assert.equal(boletasPorCargar({ pagos: [{ persona: 'X', fecha: '2026-11-06', liquido: 741311, origen: 'comision', retencion: 133392, bhe_id: 'b' }], boletas: [], declarados: {} }).length, 0)
  assert.equal(boletasPorCargar({ pagos: [{ persona: 'Zeta', fecha: '2026-10-25', liquido: 741311, origen: 'comision' }], boletas, declarados: {} }).length, 0)
})
test('bruto de una boleta: 500.000 líquidos a 15,25 % son 589.970 brutos y 89.970 de retención; 350.000 son 412.979', () => {
  assert.equal(brutoDeLiquido(500000, 0.1525), 589_970); assert.equal(brutoDeLiquido(350000, 0.1525), 412_979); assert.equal(brutoDeLiquido(741311, 0.1525), 874_703); assert.equal(brutoDeLiquido(0, 0.1525), 0)
})
test('mes trabajado y nombres', () => {
  assert.equal(mesTrabajadoDePago('2026-10-01'), '2026-09'); assert.equal(mesTrabajadoDePago('2026-10-30'), '2026-10'); assert.equal(mesTrabajadoDePago('2026-01-05'), '2025-12'); assert.equal(mesTrabajadoDePago(''), '')
  assert.equal(mismaPersona('Carla', 'CARLA DE LOS RÍOS'), true); assert.equal(mismaPersona('Pablo Soto Reyes', 'PABLO SOTO REYES'), true); assert.equal(mismaPersona('Pablo', 'Carla'), false); assert.equal(mismaPersona('', 'x'), false)
})
test('Presupuesto: PPM puro (promedio de los F29 declarados), retención propia con la boleta bruta, externos solo informados e impuesto único del último mes × 12', () => {
  const dec = {}; for (let i = 1; i <= 14; i++) { const k = `2025-${String(((i + 5) % 12) + 1).padStart(2, '0')}`; dec[`${i <= 7 ? 2025 : 2026}-${String(((i - 1) % 12) + 1).padStart(2, '0')}`] = { ppm: 500000 } }
  const r = impuestosPresupuesto({ declarados: dec, liquidaciones, boletas, personasBoleta: [{ persona: 'Carla', liquido: 500000 }], anio: 2027 })
  assert.equal(r.nF29, 12); assert.equal(r.ppmAnual, 6_000_000)
  assert.equal(r.propias[0].bruto, brutoDeLiquido(500000, 0.16)); assert.equal(r.unicoMes, 298_092); assert.equal(r.unicoAnual, 298_092 * 12)
  assert.ok(r.externos.length >= 1); assert.equal(r.costoRemuneraciones, r.retencionPropiaAnual + r.unicoAnual)   // la retención de externos no se suma
  assert.equal(r.totalAnual, r.ppmAnual + r.retencionPropiaAnual + r.unicoAnual)   // los externos no se suman
})
test('pagos que deben tener boleta: sueldos de quien paga con boleta (no bonos ni otras personas) y comisiones con retención sin boleta', () => {
  const e = (cat, sub, fecha, amount, extra = {}) => ({ type: 'gasto', client_id: 'o', category: cat, subcategory: sub, date: fecha, amount, ...extra })
  const r = pagosConBoleta({ ofiId: 'o', boletaSet: new Set(['carla']), expenses: [e('Sueldos', 'Carla', '2026-10-30', 500000), e('Bono', 'Carla', '2026-09-16', 50000), e('Sueldos', 'Erasmo', '2026-10-30', 3095407), e('Sueldos', 'Carla', '2026-10-30', 1, { deleted_at: 'x' })],
    terceros: [{ estado: 'pagado', proveedor: 'Pablo Soto Reyes', pagado_at: '2026-09-30', liquido: 350000, monto: 412979, retencion: 62979, bhe_id: null }, { estado: 'pagado', proveedor: 'Otro', pagado_at: '2026-09-30', liquido: 1, monto: 1, retencion: 1, bhe_id: 'b' }, { estado: 'pagado', proveedor: 'Sin boleta', pagado_at: '2026-09-30', liquido: null, monto: 5, retencion: 0 }] })
  assert.deepEqual(r.map((x) => [x.origen, x.persona, x.liquido]), [['sueldo', 'Carla', 500000], ['comision', 'Pablo Soto Reyes', 350000]])
})

import { migrarEstado, estadoInicial } from './../supabase/functions/_shared/presupuesto.js'
test('estado v7: el PPM del año pasa a ser el PPM puro y las partidas suman el bruto de quien emite boleta y el impuesto único; sin datos, el estado queda igual', () => {
  const v6 = { ...estadoInicial({ costos: [{ id: 'Remuneraciones|Carla', n: 'Carla', m: 500000, meses: 12, t: 'fijo', alza: null, g: 'Remuneraciones' }], ppmMes: 800000, anio: 2027 }), v: 6, arrastre: { ajustes: {}, extras: [] } }
  assert.equal(v6.ppmAnual, 9_600_000)
  const imp = { ppmAnual: 5_800_000, partidas: [{ id: 'Remuneraciones|Carla', m: 595238, boleta: true, liq: 500000, tasa: 0.16 }, { id: 'impuesto-unico', n: 'Impuesto único de trabajadores', m: 298092, meses: 12, t: 'fijo', alza: null, g: 'Remuneraciones', imp: true }] }
  const m = migrarEstado(v6, 2027, 0, undefined, imp)
  assert.equal(m.v, 7); assert.equal(m.ppmAnual, 5_800_000); assert.equal(m.costos.find((c) => c.id === 'Remuneraciones|Carla').m, 595238); assert.equal(m.costos.find((c) => c.id === 'impuesto-unico').m, 298092); assert.equal(m.costos.length, 2)
  assert.deepEqual(migrarEstado(m, 2027, 0, undefined, imp).costos, m.costos)   // idempotente: ya es v7
  const sin = migrarEstado(v6, 2027, 0); assert.equal(sin.v, 7); assert.equal(sin.ppmAnual, 9_600_000); assert.equal(sin.costos.length, 1)
})

test('lista única de «Boletas por cargar» (caso real anonimizado de 2026): faltan las de octubre (sueldo) y septiembre (comisión), agosto queda por verificar y dos boletas sin enlace quedan por verificar', () => {
  const b = (folio, fecha, nombre, bruto, ret, extra = {}) => ({ folio, fecha, emisor_nombre: nombre, bruto, retencion: ret, liquido: bruto - ret, tasa: 0.1525, estado: 'vigente', movimiento_id: 'm', proveedor_id: null, ...extra })
  const boletas = [b(6, '2026-04-29', 'CARLA APELLIDO', 492035, 75035), b(7, '2026-05-29', 'CARLA APELLIDO', 589970, 89970), b(8, '2026-06-29', 'CARLA APELLIDO', 589970, 89970), b(9, '2026-07-30', 'CARLA APELLIDO', 589970, 89970), b(10, '2026-09-30', 'CARLA APELLIDO', 589970, 89970),
    b(1931, '2026-04-21', 'PERSONA SIN ENLACE UNO', 342183, 52183, { movimiento_id: null }), b(380, '2026-09-30', 'PERSONA SIN ENLACE DOS', 821144, 125224, { movimiento_id: null }), b(230, '2026-10-19', 'PERSONA CON PROVEEDOR', 874703, 133392, { movimiento_id: null, proveedor_id: 'p' }), b(1843, '2025-12-31', 'PERSONA SIN ENLACE UNO', 292398, 42398, { movimiento_id: null })]
  const S = (f, l) => ({ persona: 'Carla', fecha: f, liquido: l, origen: 'sueldo' })
  const pagos = [S('2026-04-30', 417000), S('2026-06-01', 500000), S('2026-07-01', 500000), S('2026-07-31', 500000), S('2026-08-31', 500000), S('2026-10-01', 500000), S('2026-10-30', 500000), { persona: 'Pablo Soto Reyes', fecha: '2026-09-30', liquido: 350000, bruto: 412979, retencion: 62979, origen: 'comision' }]
  const declarados = { '2026-04': { retencion_bhe: 1 }, '2026-05': { retencion_bhe: 1 }, '2026-06': { retencion_bhe: 1 }, '2026-07': { retencion_bhe: 1 }, '2026-08': { retencion_bhe: 27917 }, '2026-09': { retencion_bhe: 215194 } }
  const l = listaBoletasPorCargar({ pagos, boletas, declarados, desde: '2026-01' })
  assert.deepEqual(l.map((x) => [x.per, x.estado, x.origen === 'boleta' ? x.folio : x.bruto]), [['2026-08', 'por verificar', 589970], ['2026-09', 'falta', 412979], ['2026-10', 'falta', 589970], ['2026-04', 'por verificar', 1931], ['2026-09', 'por verificar', 380]])
  assert.equal(boletasSinEnlace({ boletas }).length, 3)   // sin la ventana de fechas entra también la de 2025; la que tiene proveedor no
})

import { f29Estimado } from './../supabase/functions/_shared/f29Reglas.js'
test('Presupuesto: quien paga con boleta no es «externo» aunque su partida y su boleta tengan nombres distintos; la retención de externos no entra al total y se rotula por comisión', () => {
  const bol = (n, f, r, extra = {}) => ({ folio: n, fecha: f, emisor_nombre: n === 1 ? 'CARLA DE LOS RÍOS' : n === 2 ? 'PERSONA CON COMISION' : 'PERSONA SIN COMISION', bruto: r * 6, retencion: r, liquido: r * 5, estado: 'vigente', movimiento_id: 'm', proveedor_id: n === 2 ? 'pv2' : null, ...extra })
  const dec = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`2026-${String(i + 1).padStart(2, '0')}`, { ppm: 500000 }]))
  const r = impuestosPresupuesto({ declarados: dec, liquidaciones, anio: 2027, boletaSet: ['carla'], personasBoleta: [{ persona: 'Carla Gómez Soto (procuradora)', liquido: 500000 }],
    boletas: [bol(1, '2026-05-29', 89970), bol(2, '2026-06-01', 40000), bol(3, '2026-07-01', 10000)], terceros: [{ estado: 'pagado', proveedor: 'Otro nombre', proveedor_id: 'pv2', pagado_at: '2026-06-02' }] })
  assert.deepEqual(r.externos.map((x) => x.persona).sort(), ['PERSONA CON COMISION', 'PERSONA SIN COMISION'])   // la procuradora no está entre los externos
  assert.equal(r.retencionExternosAnual, 50000); assert.equal(r.externos.find((x) => /CON/.test(x.persona)).enComisiones, true); assert.equal(r.externos.find((x) => /SIN/.test(x.persona)).enComisiones, false)
  assert.equal(r.totalAnual, r.ppmAnual + r.retencionPropiaAnual + r.unicoAnual)   // los externos no se suman
})
test('estado v7: el bruto de quien emite boleta sale del líquido que trae el estado, no del de los datos; sin datos o sin sellar, el estado queda en v6', () => {
  const v6 = { ...estadoInicial({ costos: [{ id: 'R|Carla', n: 'Carla', m: 600000, meses: 12, t: 'fijo', alza: null, g: 'Remuneraciones' }], ppmMes: 800000, anio: 2027 }), v: 6, arrastre: { ajustes: {}, extras: [] } }
  const imp = { ppmAnual: 5_800_000, partidas: [{ id: 'R|Carla', m: 595238, boleta: true, liq: 500000, tasa: 0.16 }] }
  const m = migrarEstado(v6, 2027, 0, undefined, imp)
  assert.equal(m.costos[0].liq, 600000); assert.equal(m.costos[0].m, brutoDeLiquido(600000, 0.16))   // 714.286, no 595.238
  const sinSellar = migrarEstado(v6, 2027, 0, undefined, null, false)
  assert.equal(sinSellar.v, 6); assert.equal(sinSellar.ppmAnual, 9_600_000); assert.equal(migrarEstado(sinSellar, 2027, 0, undefined, imp).v, 7)   // con datos, después sí se corrige
})
test('una sola regla: el F29 de octubre da 1.833.004 desde impuestosMensuales y desde f29Estimado (con liquidaciones y pagos, como el calendario y el estimado por correo)', () => {
  const a = impuestosMensuales({ per: '2026-10', docs, boletas, pagos, liquidaciones, declarados, informado: 1_833_004 })
  const e = f29Estimado({ per: '2026-10', docs, boletas, valores: { '2026-10': { ppm: 1_833_004 } }, declarados, liquidaciones, pagos })
  assert.equal(a.total, 1_833_004); assert.equal(e.total, 1_833_004); assert.equal(e.dif, 0); assert.equal(e.iu, 298_092); assert.equal(e.iuDe, '2026-10'); assert.equal(e.nFalta, 1)
  // sin liquidaciones del período queda el impuesto único del F29 anterior (como antes)
  const sin = f29Estimado({ per: '2026-10', docs, boletas, valores: {}, declarados: { ...declarados, '2026-09': { ...declarados['2026-09'] } }, liquidaciones: [] })
  assert.equal(sin.iu, 160_564); assert.equal(sin.iuDe, '2026-09')
})

test('destino de cada emisor de boleta: decisión por RUT (contabilidad, gasto de oficina, comisión, cliente); sin decisión, comisión si tiene pagos y, si no, por clasificar; se muestra y nunca se suma', () => {
  assert.equal(rutNormal('11.111.111-1'), '111111111'); assert.equal(rutNormal('7.654.321-k'), '7654321K'); assert.equal(rutNormal(null), '')
  const bol = (folio, fecha, nombre, rut, ret, extra = {}) => ({ folio, fecha, emisor_nombre: nombre, emisor_rut: rut, bruto: ret * 6, retencion: ret, liquido: ret * 5, estado: 'vigente', movimiento_id: null, proveedor_id: null, ...extra })
  // contador (3 boletas, sin movimiento propio), emisor de un gasto de oficina (1 boleta con su pago bancario) y emisor sin clasificar
  const boletas = [bol(1, '2026-05-10', 'CONTADORA UNO', '11.111.111-1', 50000), bol(2, '2026-06-10', 'CONTADORA UNO', '11.111.111-1', 50000), bol(3, '2026-07-10', 'CONTADORA UNO', '11.111.111-1', 50000),
    bol(4, '2026-07-12', 'EMISOR DE GASTO', '22.222.222-2', 30000, { movimiento_id: 'm' }), bol(5, '2026-09-30', 'EMISOR SIN CLASIFICAR', '33.333.333-3', 125000)]
  const destinos = { '111111111': 'contabilidad', '222222222': 'gasto_oficina' }
  assert.equal(destinoDeEmisor({ rut: '11.111.111-1', nombre: 'CONTADORA UNO' }, destinos), 'contabilidad'); assert.equal(destinoDeEmisor({ rut: '33.333.333-3', nombre: 'EMISOR SIN CLASIFICAR' }, destinos), '')
  assert.equal(destinoDeEmisor({ rut: '9', nombre: 'Pablo Soto Reyes' }, {}, [{ estado: 'pagado', proveedor: 'PABLO SOTO REYES' }]), 'comision'); assert.equal(destinoDeEmisor({ rut: '9', nombre: 'Carla' }, {}, [], ['carla']), 'remuneracion')
  assert.equal(destinoDeEmisor({ rut: '33.333.333-3', nombre: 'X' }, { '333333333': 'cliente' }), 'cliente'); assert.equal(destinoDeEmisor({ rut: '33.333.333-3', nombre: 'X' }, { '333333333': 'basura' }), '')
  const dec = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`2026-${String(i + 1).padStart(2, '0')}`, { ppm: 500000 }]))
  const r = impuestosPresupuesto({ declarados: dec, liquidaciones, boletas, anio: 2027, destinos })
  const d = Object.fromEntries(r.externos.map((x) => [x.persona, x.destino])); assert.deepEqual(d, { 'CONTADORA UNO': 'contabilidad', 'EMISOR DE GASTO': 'gasto_oficina', 'EMISOR SIN CLASIFICAR': '' })
  assert.equal(r.externos.find((x) => x.persona === 'CONTADORA UNO').anual, 150000); assert.equal(ETIQ_DESTINO[''], 'por clasificar')
  assert.equal(r.totalAnual, r.ppmAnual + r.retencionPropiaAnual + r.unicoAnual); assert.equal(r.costoRemuneraciones, r.retencionPropiaAnual + r.unicoAnual)   // ninguna retención de emisores externos se suma
  const m = impuestosMensuales({ per: '2026-09', docs: [], boletas, pagos: [], liquidaciones: [], declarados: {}, destinos })
  assert.equal(m.retencion.personas[0].persona, 'EMISOR SIN CLASIFICAR'); assert.equal(m.retencion.personas[0].destino, ''); assert.equal(m.retencion.personas[0].rut, '333333333')
  assert.equal(impuestosMensuales({ per: '2026-07', docs: [], boletas, pagos: [], liquidaciones: [], declarados: {}, destinos }).retencion.personas.find((p) => p.rut === '111111111').destino, 'contabilidad')
  // sin enlace: las boletas con destino decidido ya no se preguntan; la sin clasificar sigue por verificar
  assert.deepEqual(boletasSinEnlace({ boletas, destinos }).map((x) => x.folio), [5]); assert.equal(boletasSinEnlace({ boletas }).length, 4)
  assert.deepEqual(listaBoletasPorCargar({ boletas, destinos }).map((x) => x.folio), [5])
})

test('estado v7 sin sellar (fuentes incompletas) queda idéntico aunque haya datos; la corrección se aplica una sola vez en la carga buena (sin bruto sobre bruto) y con la lista de quienes emiten boleta del propio estado', () => {
  const v6 = { ...estadoInicial({ costos: [{ id: 'R|1', n: 'Carla Gómez Soto (procuradora)', m: 600000, meses: 12, t: 'fijo', alza: null, g: 'Remuneraciones' }, { id: 'R|2', n: 'Otra Persona', m: 900000, meses: 12, t: 'fijo', alza: null, g: 'Remuneraciones' }], ppmMes: 800000, anio: 2027 }), v: 6 }
  v6.arrastre = { ajustes: {}, extras: [] }
  const imp = { ppmAnual: 5_800_000, tasa: 0.16, grupo: 'Remuneraciones', boletaSet: ['carla'], partidas: [{ id: 'impuesto-unico', n: 'Impuesto único de trabajadores', m: 298_092, meses: 12, t: 'fijo', alza: null, g: 'Remuneraciones', imp: true }] }
  const sin = migrarEstado(v6, 2027, 0, undefined, imp, false)
  assert.deepEqual(sin, v6)   // idéntico: v6, mismo PPM, mismas partidas
  const buena = migrarEstado(sin, 2027, 0, undefined, imp)
  assert.equal(buena.v, 7); assert.equal(buena.ppmAnual, 5_800_000); assert.equal(buena.costos.find((c) => c.id === 'R|1').m, brutoDeLiquido(600000, 0.16)); assert.equal(buena.costos.find((c) => c.id === 'R|2').m, 900000); assert.equal(buena.costos.length, 3)
  assert.deepEqual(migrarEstado(buena, 2027, 0, undefined, imp).costos, buena.costos)   // ya es v7: no se repite
})

test('mapa de la contadora desde las decisiones guardadas: solo los RUT con destino «contabilidad», normalizados; sin filas, vacío', () => {
  const dest = { '111111111': 'contabilidad', '22.222.222-2': 'contabilidad', '333333333': 'gasto_oficina', '444444444': '' }
  assert.deepEqual(rutsDeDestino(dest, 'contabilidad', 'Contadora'), { '111111111': 'Contadora', '222222222': 'Contadora' })
  assert.deepEqual(rutsDeDestino({}, 'contabilidad', 'Contadora'), {}); assert.deepEqual(rutsDeDestino(null, 'contabilidad', 'Contadora'), {})
})
