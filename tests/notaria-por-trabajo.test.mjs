import test from 'node:test'
import assert from 'node:assert/strict'
import { disponibleNotaria, notariaPendientes, otNoValida, revisionCargaNotaria, clienteSugeridoPorGlosa, otPagadasEnListado, parrafoYaPagadasEnListado } from '../supabase/functions/_shared/notariaReglas.js'

const fondo = (id, amount, project, date = '2026-09-01') => ({ id, client_id: 'c', type: 'fondo', amount, project, date })
const ot = (id, amount, project) => ({ id, client_id: 'c', type: 'gasto', category: 'Notaria', ot_number: String(400000 + id), amount, project, date: '2026-10-01' })

test('notaría por trabajo: el fondo de otro trabajo no cubre la OT, y una OT sin trabajo pide asignarlo', () => {
  const g = [fondo(1, 300000, 'Trabajo A'), ot(2, 100000, 'Trabajo B'), ot(3, 50000, undefined)]
  const d = disponibleNotaria(g, 'c')
  assert.equal(d.completo, 300000)                 // el cliente tiene el fondo...
  assert.equal(d.disp, 0)                           // ...pero es de otro trabajo
  assert.deepEqual(d.otSinTrabajo.map(e => e.id), [3])
})

test('notaría por trabajo: fondo del mismo trabajo, y fondo sin trabajo como segundo recurso', () => {
  assert.equal(disponibleNotaria([fondo(1, 300000, 'Trabajo A'), ot(2, 100000, 'Trabajo A')], 'c').disp, 300000)
  const d = disponibleNotaria([fondo(1, 300000, 'Trabajo A'), fondo(2, 50000, undefined), ot(3, 100000, 'Trabajo B')], 'c')
  assert.equal(d.completo, 350000)
  assert.equal(d.sinTrabajo, 50000)
  assert.equal(d.disp, 50000)                       // solo el fondo sin trabajo alcanza a la OT de B
  assert.deepEqual(d.otSinTrabajo, [])
})

test('notaría por trabajo: nunca supera al disponible del cliente completo ni cambia sin OT pendientes', () => {
  const gasto = { id: 9, client_id: 'c', type: 'gasto', category: 'CBR', amount: 90000, rendered_at: '2026-10-01', date: '2026-09-15' }
  const d = disponibleNotaria([fondo(1, 100000, 'Trabajo A'), gasto, ot(2, 5000, 'Trabajo A')], 'c')
  assert.equal(d.completo, 10000); assert.equal(d.disp, 10000)
  assert.equal(disponibleNotaria([fondo(1, 300000, 'Trabajo A')], 'c').disp, 300000)
})

test('OT de $1 = OT no válida (repertorio no usado o anulado): no es deuda ni pendiente; con monto real sí', () => {
  const g = [ot(1, 1, 'T'), ot(2, 0, 'T'), ot(3, 35000, 'T')]
  assert.equal(otNoValida(g[0]), true)
  assert.equal(otNoValida(g[2]), false)
  assert.deepEqual(notariaPendientes(g).map(e => e.id), [3])
})

test('revisión de una carga de la notaría: sin cliente, sin trabajo y por confirmar; las OT de $1 y las personales no cuentan', () => {
  const g = [
    { id: 1, amount: 30000, client_id: null, personal_de: null, project: null },        // sin cliente
    { id: 2, amount: 90000, client_id: null, personal_de: 'Martín', project: null },    // personal: no se identifica
    { id: 3, amount: 20000, client_id: 'c', project: '' },                              // sin trabajo
    { id: 4, amount: 50000, client_id: 'c', project: 'Trabajo A' },                     // en orden
    { id: 5, amount: 1, client_id: null, personal_de: null, project: null },            // OT no válida
  ]
  const r = revisionCargaNotaria(g, { cargadas: 3, noNuestras: [{ monto: 20000 }, { monto: 1 }] })
  assert.deepEqual(r.sinCliente, { n: 1, m: 30000 })
  assert.deepEqual(r.sinTrabajo, { n: 1, m: 20000 })
  assert.deepEqual(r.porConfirmar, { n: 1, m: 20000 })
  assert.equal(r.porRevisar, 3)
  assert.equal(r.cargadas, 4)
})

test('OT sin cliente: se sugiere el cliente con más palabras propias de la glosa en sus gastos; una palabra común o un empate no sugieren', () => {
  const g = [
    { id: 1, client_id: 'jhvorj', concept: 'Contratos varios — Jhvpdt VsD, Grupo Mulet Inversiones SpA' },
    { id: 2, client_id: 'jhvorj', concept: 'Inscripcion Constitucion Modulares Mulet' },
    { id: 3, client_id: 'otro', concept: 'Gastos notariales — Compensación' },
  ]
  const ot = { id: 9, concept: 'Gastos notariales — Compensación, Grupo Mulet Inversiones SpA y Bodegas Modulares Mulet' }
  assert.equal(clienteSugeridoPorGlosa(ot, g).clienteId, 'jhvorj')
  assert.equal(clienteSugeridoPorGlosa({ id: 9, concept: 'Gastos notariales — Compensación' }, g), null)          // una sola palabra y común
  const empate = [{ id: 1, client_id: 'a', concept: 'Mulet Modulares' }, { id: 2, client_id: 'b', concept: 'Modulares Mulet' }]
  assert.equal(clienteSugeridoPorGlosa({ id: 9, concept: 'X — Mulet Modulares' }, empate), null)                // empate entre dos clientes
})

// Caso real del 16-11-2026 (anonimizado): el listado de la notaría trajo como deuda las OT que ya se habían pagado el 20-10.
test('OT ya pagadas que siguen en el listado de la notaría: solo las de liquidaciones enviadas antes de la carga, una vez por carga', () => {
  const carga = { id: 'c1', status: 'active', created_at: '2026-11-16T14:14:00Z', resumen: { notaria: true, repetidasDet: [{ ot: 'OT-100', monto: 10000 }, { ot: 'OT-101', monto: 20000 }, { ot: 'OT-102', monto: 5000 }, { ot: 'OT-103', monto: 7000 }, { ot: 'OT-104', monto: 9000 }] } }
  const expenses = [
    { id: 'e1', ot_number: 'OT-100', amount: 10000, notaria_render_id: 'L1' }, { id: 'e2', ot_number: '101', amount: 20000, notaria_render_id: 'L1' },
    { id: 'e3', ot_number: 'OT-102', amount: 5000, notaria_render_id: 'L2' },                    // liquidación por enviar: no está pagada
    { id: 'e4', ot_number: 'OT-103', amount: 7000, notaria_render_id: 'L3' },                    // pagada DESPUÉS de la carga: el listado no la veía
    { id: 'e5', ot_number: 'OT-104', amount: 9000 },                                             // sin liquidar
  ]
  const rend = [
    { id: 'L1', tipo: 'notaria', estado_envio: 'enviada', sent_at: '2026-10-20T13:11:00Z', created_at: '2026-10-20T13:04:00Z', comprobante_url: 'https://drive/x' },
    { id: 'L2', tipo: 'notaria', estado_envio: 'por_enviar', created_at: '2026-10-25T10:00:00Z' },
    { id: 'L3', tipo: 'notaria', estado_envio: 'enviada', sent_at: '2026-11-17T10:00:00Z', created_at: '2026-11-17T09:00:00Z' },
  ]
  const r = otPagadasEnListado({ cargas: [carga], expenses, rendiciones: rend })
  assert.equal(r.n, 2); assert.equal(r.total, 30000); assert.equal(r.grupos.length, 1)
  assert.deepEqual(r.grupos[0].ots, ['100', '101']); assert.equal(r.grupos[0].fecha, '2026-10-20'); assert.equal(r.grupos[0].comprobanteUrl, 'https://drive/x')
  // anulada o ya avisada para esa carga: no se vuelve a reclamar
  assert.equal(otPagadasEnListado({ cargas: [carga], expenses, rendiciones: rend.map(x => x.id === 'L1' ? { ...x, anulada_at: '2026-11-01T00:00:00Z' } : x) }).n, 0)
  assert.equal(otPagadasEnListado({ cargas: [carga], expenses, rendiciones: rend.map(x => x.id === 'L1' ? { ...x, correo: { listado: { carga: 'c1', rendiciones: ['L1'] } } } : x) }).n, 0)
  // una carga sin detalle de repetidas, deshecha o sin datos no produce nada
  assert.equal(otPagadasEnListado({ cargas: [{ ...carga, resumen: { notaria: true } }], expenses, rendiciones: rend }).n, 0)
  assert.equal(otPagadasEnListado({ cargas: [{ ...carga, status: 'undone' }], expenses, rendiciones: rend }).n, 0)
  assert.equal(otPagadasEnListado({}).n, 0)
})

test('párrafo de las OT ya pagadas: una liquidación o varias, con o sin comprobante, sin puntos medios', () => {
  const uno = parrafoYaPagadasEnListado({ grupos: [{ fecha: '2026-10-20', n: 40, total: 1335000 }] })
  assert.match(uno, /Las 40 OT que siguen figurando en su último listado de deuda ya fueron pagadas el 20-10-2026, por \$1\.335\.000\./)
  assert.match(uno, /Adjuntamos el comprobante y la liquidación de ese pago, y les pedimos rebajarlas de nuestra deuda\./)
  assert.match(parrafoYaPagadasEnListado({ grupos: [{ fecha: '2026-10-20', n: 40, total: 1335000 }] }, false), /Adjuntamos la liquidación de ese pago/)
  const varios = parrafoYaPagadasEnListado({ grupos: [{ fecha: '2026-09-15', n: 18, total: 3199000 }, { fecha: '2026-10-20', n: 40, total: 1335000 }] })
  assert.match(varios, /Hay 58 OT/); assert.match(varios, /• 15-09-2026: 18 OT por \$3\.199\.000\n• 20-10-2026: 40 OT por \$1\.335\.000/); assert.match(varios, /los comprobantes y las liquidaciones de esos pagos/)
  assert.doesNotMatch(uno + varios, /·/)
  assert.match(parrafoYaPagadasEnListado({ grupos: [{ fecha: '2026-10-20', n: 1, total: 10000 }] }), /La OT que sigue figurando .* ya fue pagada .* rebajarla de nuestra deuda/)
  assert.equal(parrafoYaPagadasEnListado({ grupos: [] }), '')
})
