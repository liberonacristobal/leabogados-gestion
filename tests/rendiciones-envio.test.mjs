import test from 'node:test'
import assert from 'node:assert/strict'
import { adjuntoEsDeRendicion, envioDeRendicion, mencionaRendicion, planRendiciones } from '../supabase/functions/_shared/rendicionEnvioReglas.js'

// Casos con el formato real de los envíos (anonimizados): «Rendición N° 14 | Cliente», adjunto «Rendición 14.pdf».
const mapa = new Map([['pagos@cliente-a.cl', new Set(['A'])], ['admin@cliente-b.cl', new Set(['B'])], ['mixto@x.cl', new Set(['A', 'B'])]])
const rend = (id, n, extra) => ({ id, client_id: 'A', correlativo: n, tipo: 'cliente', created_at: '2026-10-07T12:00:00Z', sent_at: null, anulada_at: null, ...extra })
const c = (id, over) => ({ id, para: ['pagos@cliente-a.cl'], cc: [], asunto: '', fecha: '2026-10-09', adjuntos: [], fragmento: '', ...over })

test('menciona la rendición N° y no un número que es parte de otro', () => {
  assert.equal(mencionaRendicion('Rendición N° 14 | Cliente A', 14), true)
  assert.equal(mencionaRendicion('Rendicion 14', 14), true)
  assert.equal(mencionaRendicion('Rendición N° 140', 14), false)
  assert.equal(mencionaRendicion('Factura 14', 14), false)
  assert.equal(mencionaRendicion('Rendición | OT 14', 14), false)
  assert.equal(adjuntoEsDeRendicion('Rendición 14.pdf', 14), true)
  assert.equal(adjuntoEsDeRendicion('Rendicion N°14 Cliente.pdf', 14), true)
  assert.equal(adjuntoEsDeRendicion('Rendición 140.pdf', 14), false)
  assert.equal(adjuntoEsDeRendicion('Factura 14.pdf', 14), false)
})

test('el correo debe ir a un contacto del mismo cliente, después de la rendición y con su N°', () => {
  const r = rend('r1', 14)
  assert.deepEqual(envioDeRendicion({ correo: c('m1', { asunto: 'Rendición N° 14' }), rendicion: r, mapa }), { motivo: 'N° en el asunto' })
  assert.equal(envioDeRendicion({ correo: c('m2', { asunto: 'Rendición N° 14', para: ['admin@cliente-b.cl'] }), rendicion: r, mapa }), null)   // otro cliente
  assert.equal(envioDeRendicion({ correo: c('m3', { asunto: 'Rendición N° 14', para: ['mixto@x.cl'] }), rendicion: r, mapa }), null)            // dos clientes
  assert.equal(envioDeRendicion({ correo: c('m4', { asunto: 'Rendición N° 14', fecha: '2026-10-01' }), rendicion: r, mapa }), null)              // antes de la rendición
  assert.equal(envioDeRendicion({ correo: c('m5', { asunto: 'Rendición N° 14', fecha: '2026-12-20' }), rendicion: r, mapa }), null)              // fuera de la ventana
  assert.equal(envioDeRendicion({ correo: c('m6', { asunto: 'Re: Rendición N° 14' }), rendicion: r, mapa }), null)                              // respuesta sin adjunto
  assert.equal(envioDeRendicion({ correo: c('m7', { para: ['socio@leabogados.cl'], asunto: 'Rendición N° 14' }), rendicion: r, mapa, dominio: 'leabogados.cl' }), null)   // solo interno
  assert.deepEqual(envioDeRendicion({ correo: c('m8', { adjuntos: [{ nombre: 'Rendición 14.pdf' }] }), rendicion: r, mapa }), { motivo: 'N° en el adjunto' })
})

test('plan: completa la fecha real y «externa» solo en rendiciones de clientes sin envío registrado', () => {
  const rs = [rend('r1', 14), rend('r2', 15, { sent_at: '2026-10-08T12:00:00Z' }), rend('r3', 16, { anulada_at: '2026-10-20T12:00:00Z' }), rend('r4', 17, { tipo: 'cajachica' })]
  const cs = [c('m1', { asunto: 'Rendición N° 14' }), c('m2', { asunto: 'Rendición N° 15' }), c('m3', { asunto: 'Rendición N° 16' }), c('m4', { asunto: 'Rendición N° 17' })]
  const p = planRendiciones({ rendiciones: rs, correos: cs, mapa })
  assert.deepEqual(p.map(x => x.id), ['r1'])
  assert.equal(p[0].estado_envio, 'externa')
  assert.equal(p[0].sent_at, '2026-10-09T15:00:00.000Z')
  assert.equal(p[0].dirigido_email, 'pagos@cliente-a.cl')
})
