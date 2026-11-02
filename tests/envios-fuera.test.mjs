import test from 'node:test'
import assert from 'node:assert/strict'
import { adjuntoEsDeFolio, enviosDetectados, envioDeFactura, folioNum, mencionaFolio } from '../supabase/functions/_shared/facturaEnvioReglas.js'

// Casos tomados del formato real de los envíos de la app («Factura 464 | concepto — detalle», adjunto «Factura 464.pdf»), anonimizados.
const mapa = new Map([
  ['pagos@cliente-a.cl', new Set(['A'])], ['gerente@cliente-a.cl', new Set(['A'])],
  ['admin@cliente-b.cl', new Set(['B'])],
  ['compartido@mixto.cl', new Set(['A', 'B'])],
])
const f = (id, no, cli, emi) => ({ id, invoice_no: no, client_id: cli, issued_at: emi })
const c = (id, over) => ({ id, de: 'socio@estudio.cl', para: ['pagos@cliente-a.cl'], cc: [], asunto: '', fecha: '2026-10-05', adjuntos: [], fragmento: '', ...over })
const opt = { mapa, dominio: 'estudio.cl' }

test('folio: «Factura 322» y ceros a la izquierda', () => {
  assert.equal(folioNum('Factura 322'), '322'); assert.equal(folioNum('0480'), '480'); assert.equal(folioNum(null), '')
})

test('menciona el folio solo con la palabra factura/folio/DTE cerca y como número completo', () => {
  assert.equal(mencionaFolio('Factura 464 | Pago 3/9', '464'), true)
  assert.equal(mencionaFolio('Adjuntamos la Factura N° 480 por el total', 'Factura 480'), true)
  assert.equal(mencionaFolio('Facturas 480 y 482', '482'), true)                     // envío en lote
  assert.equal(mencionaFolio('Factura 461 | Asesoría permanente — Septiembre 2026 OT 424', '424'), false)   // OT 424 no es la factura 424
  assert.equal(mencionaFolio('Factura 1488', '488'), false)                          // parte de otro número
  assert.equal(mencionaFolio('Factura por $1.882.375', '375'), false)                // monto, no folio
  assert.equal(mencionaFolio('Orden de compra 480', '480'), false)                   // sin la palabra factura
})

test('adjunto: nombre de la factura y no cualquier PDF con un número', () => {
  assert.equal(adjuntoEsDeFolio('Factura 464.pdf', '464'), true)
  assert.equal(adjuntoEsDeFolio('Fact 1170_LE Geslog.pdf', '1170'), true)
  assert.equal(adjuntoEsDeFolio('464.pdf', '464'), true)
  assert.equal(adjuntoEsDeFolio('Factura 1464.pdf', '464'), false)
  assert.equal(adjuntoEsDeFolio('Certificado 464.pdf', '464'), false)
  assert.equal(adjuntoEsDeFolio('Factura 464.png', '464'), false)
})

test('coincide: va al cliente, dentro de la ventana y con el N° en asunto, adjunto o texto', () => {
  const fa = f('1', '464', 'A', '2026-10-02')
  assert.deepEqual(envioDeFactura({ ...opt, factura: fa, correo: c('m1', { asunto: 'Factura 464 | Ordenamiento — Pago 3/9' }) }), { nivel: 'coincide', motivo: 'N° en el asunto' })
  assert.equal(envioDeFactura({ ...opt, factura: fa, correo: c('m2', { asunto: 'Documentos', adjuntos: [{ nombre: 'Factura 464.pdf' }] }) })?.motivo, 'N° en el adjunto')
  assert.equal(envioDeFactura({ ...opt, factura: fa, correo: c('m3', { asunto: 'Documentos', fragmento: 'Te adjunto la factura N° 464.' }) })?.motivo, 'N° en el texto')
})

test('no corresponde: otro cliente, interno, dos clientes, fuera de ventana, respuesta, monto solo', () => {
  const fa = f('1', '464', 'A', '2026-10-02')
  const base = { asunto: 'Factura 464' }
  assert.equal(envioDeFactura({ ...opt, factura: fa, correo: c('x1', { ...base, para: ['admin@cliente-b.cl'] }) }), null)                    // va a otro cliente
  assert.equal(envioDeFactura({ ...opt, factura: fa, correo: c('x2', { ...base, para: ['otro@estudio.cl'] }) }), null)                       // solo interno
  assert.equal(envioDeFactura({ ...opt, factura: fa, correo: c('x3', { ...base, para: ['pagos@cliente-a.cl', 'admin@cliente-b.cl'] }) }), null)  // dos clientes
  assert.equal(envioDeFactura({ ...opt, factura: fa, correo: c('x4', { ...base, para: ['compartido@mixto.cl'] }) }), null)                   // contacto de dos clientes
  assert.equal(envioDeFactura({ ...opt, factura: fa, correo: c('x5', { ...base, fecha: '2026-10-01' }) }), null)                            // antes de la emisión
  assert.equal(envioDeFactura({ ...opt, factura: fa, correo: c('x6', { ...base, fecha: '2026-12-20' }) }), null)                            // más de 60 días después
  assert.equal(envioDeFactura({ ...opt, factura: fa, correo: c('x7', { asunto: 'Re: Factura 464' }) }), null)                               // respuesta sin adjunto
  assert.equal(envioDeFactura({ ...opt, factura: fa, correo: c('x8', { para: ['desconocido@nadie.cl'], asunto: 'Factura 464' }) }), null)   // destinatario sin cliente conocido
  assert.equal(envioDeFactura({ ...opt, factura: fa, correo: c('x9', { asunto: 'Cobro', fragmento: 'Total $1.434.464' }) }), null)          // número dentro de un monto
})

test('un envío en lote cubre varias facturas del mismo cliente, cada una una vez', () => {
  const fs = [f('1', '480', 'A', '2026-10-02'), f('2', '482', 'A', '2026-10-02'), f('3', '490', 'B', '2026-10-02')]
  const r = enviosDetectados({ ...opt, facturas: fs, correos: [c('m1', { asunto: 'Facturas 480 y 482' })] })
  assert.deepEqual(r.map(x => x.factura_id), ['1', '2'])
  assert.ok(r.every(x => x.nivel === 'coincide'))
})

test('probable: sin folio, con PDF de factura y una sola pendiente del cliente; con dos o sin PDF, nada', () => {
  const uno = [f('1', '457', 'A', '2026-10-01')]
  const sinFolio = c('m1', { asunto: 'Factura - Orden de Compra 051-26', adjuntos: [{ nombre: 'Factura Cliente.pdf' }], fecha: '2026-10-01' })
  assert.deepEqual(enviosDetectados({ ...opt, facturas: uno, correos: [sinFolio] }).map(x => x.nivel), ['probable'])
  const dos = [...uno, f('2', '458', 'A', '2026-10-01')]
  assert.equal(enviosDetectados({ ...opt, facturas: dos, correos: [sinFolio] }).length, 0)                                              // ambiguo
  assert.equal(enviosDetectados({ ...opt, facturas: uno, correos: [{ ...sinFolio, adjuntos: [] }] }).length, 0)                          // sin PDF
  assert.equal(enviosDetectados({ ...opt, facturas: uno, correos: [{ ...sinFolio, asunto: 'Reunión', adjuntos: [{ nombre: 'Acta.pdf' }] }] }).length, 0)   // no habla de factura
  assert.equal(enviosDetectados({ ...opt, facturas: uno, correos: [{ ...sinFolio, para: ['admin@cliente-b.cl'] }] }).length, 0)           // otro cliente
})

test('correos ya decididos no vuelven', () => {
  const fs = [f('1', '464', 'A', '2026-10-02')]
  assert.equal(enviosDetectados({ ...opt, facturas: fs, correos: [c('m1', { asunto: 'Factura 464' })], vistos: new Set(['m1']) }).length, 0)
})

test('la dirección guardada con puntos calza con la real sin puntos (mismo dominio), no con otro dominio', () => {
  const m = new Map([['l.perez@dominio-x.cl', new Set(['A'])], ['jgomez@otro-y.cl', new Set(['B'])]])
  const fa = f('1', '459', 'A', '2026-10-02')
  const o = { mapa: m, dominio: 'estudio.cl' }
  assert.equal(envioDeFactura({ ...o, factura: fa, correo: c('m1', { para: ['lperez@dominio-x.cl'], asunto: 'Factura 459' }) })?.nivel, 'coincide')
  assert.equal(envioDeFactura({ ...o, factura: fa, correo: c('m2', { para: ['lperez@dominio-z.cl'], asunto: 'Factura 459' }) }), null)
})
