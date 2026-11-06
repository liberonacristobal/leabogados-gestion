import test from 'node:test'
import assert from 'node:assert/strict'
import { ajustarTrato, cuerpoVariasFacturas, esSaludoSingular, periodoDe, saludoPara, lineasTrabajos } from '../supabase/functions/_shared/correoFacturaTexto.js'

// Casos REALES del 4-11-2026 (anonimizados solo en lo que no importa): el correo de varias facturas hablaba de un solo proyecto y decía el total.
// Tarragona 511 (Simplificación de Malla Corporativa, Cuota 2/18) y 512 (Asesoría Permanente, octubre 2026) son DOS trabajos distintos.
test('dos trabajos distintos se listan los dos, sin total', () => {
  const t = cuerpoVariasFacturas({ items: [
    { folio: '511', relacion: 'Simplificación de Malla Corporativa', detalle: 'Pago 2 de 18', key: 'venta-a' },
    { folio: '512', relacion: 'Asesoría Permanente', periodo: 'Octubre 2026', key: 'venta-b' },
  ] })
  assert.equal(t, 'Espero que estén muy bien. Adjuntamos las facturas N° 511 y 512, correspondientes a los siguientes trabajos:\n– Simplificación de Malla Corporativa: Pago 2 de 18 (N° 511).\n– Asesoría Permanente: Octubre 2026 (N° 512).')
  assert.doesNotMatch(t, /total|\$/i)
})

test('un trabajo con varias facturas las junta en su línea y dice «al siguiente trabajo»', () => {
  const t = cuerpoVariasFacturas({ items: [
    { folio: '480', relacion: 'Reorganización grupo', detalle: 'Pago 6 de 24', key: 'g' },
    { folio: '498', relacion: 'Reorganización grupo', detalle: 'Pago 7 de 24', key: 'g' },
  ] })
  assert.match(t, /correspondientes al siguiente trabajo:\n– Reorganización grupo: Pago 6 de 24 \(N° 480\) y Pago 7 de 24 \(N° 498\)\.$/)
})

test('tres trabajos: una línea por trabajo, en el orden recibido; una factura sin cuota ni período lleva solo su N°', () => {
  const t = cuerpoVariasFacturas({ items: [
    { folio: '498', relacion: 'Reorganización grupo', detalle: 'Pago 7 de 24', key: 'a' },
    { folio: '502', relacion: 'Ases laboral octubre 26', key: 'b' },
    { folio: '520', relacion: 'Negociación arriendo', detalle: 'Pago 3 de 3', key: 'c' },
  ] })
  assert.equal(t.split('\n').length, 4)
  assert.match(t, /facturas N° 498, 502 y 520, correspondientes a los siguientes trabajos:/)
  assert.match(t, /– Ases laboral octubre 26: N° 502\./)
})

test('en inglés: mismo orden y las cuotas en inglés', () => {
  const t = cuerpoVariasFacturas({ lang: 'en', items: [{ folio: '511', relacion: 'Corporate simplification', detalle: 'Pago 2 de 18', key: 'a' }, { folio: '512', relacion: 'Retainer', periodo: 'Octubre 2026', key: 'b' }] })
  assert.equal(t, 'We attach invoices No. 511 and 512, corresponding to the following works:\n– Corporate simplification: Payment 2 of 18 (No. 511).\n– Retainer: October 2026 (No. 512).')
})

test('período: mes y año completos de la glosa o del concepto', () => {
  assert.equal(periodoDe('Octubre 2026'), 'Octubre 2026')
  assert.equal(periodoDe('', 'Asesoría Permanente — Mensual octubre de 2026'), 'Octubre 2026')
  assert.equal(periodoDe('Asesoria legal oct 26'), '')
  assert.equal(periodoDe('Pago 7 de 24'), '')
})

test('el trato del cuerpo sigue al saludo, también en un cuerpo ya editado', () => {
  assert.equal(esSaludoSingular('Estimado Agustín,'), true)
  assert.equal(esSaludoSingular('Estimada Carolina,'), true)
  assert.equal(esSaludoSingular('Estimados,'), false)
  assert.equal(esSaludoSingular('Estimadas,'), false)
  assert.equal(ajustarTrato('Espero que estén muy bien. Adjuntamos la factura. Quedamos atentos a sus comentarios.', true), 'Espero que estés muy bien. Adjuntamos la factura. Quedamos atentos a tus comentarios.')
  assert.equal(ajustarTrato('Espero que estés muy bien. Quedamos atentos a tus comentarios.', false), 'Espero que estén muy bien. Quedamos atentos a sus comentarios.')
  assert.equal(ajustarTrato('Texto sin esas frases', true), 'Texto sin esas frases')
})

// Tarragona: el contacto «Agustin Molinari» existía y, con una persona en copia, igual salió «Estimados,».
const personas = { generoF: n => /a$/i.test(n.split(' ')[0]) && !/^agustin$/i.test(n.split(' ')[0]), esPersona: n => n.trim().split(/\s+/).length >= 2 }
test('el saludo se decide por el «Para», no por la copia', () => {
  const contactos = [{ email: 'amolinari@tarragona.cl', nombre: 'Agustin Molinari' }, { email: 'etienne.coqueletf@gmail.com', nombre: 'etienne.coqueletf' }, { email: 'cbatlle@tarragona.cl', nombre: 'Carola Batlle' }]
  assert.equal(saludoPara({ para: ['amolinari@tarragona.cl'], contactos, ...personas }), 'Estimado Agustin,')
  assert.equal(saludoPara({ para: ['cbatlle@tarragona.cl'], contactos, ...personas }), 'Estimada Carola,')
  assert.equal(saludoPara({ para: ['etienne.coqueletf@gmail.com'], contactos, ...personas }), 'Estimados,')   // el «nombre» es su propio correo
  assert.equal(saludoPara({ para: ['amolinari@tarragona.cl', 'cbatlle@tarragona.cl'], contactos, ...personas }), 'Estimados,')
  assert.equal(saludoPara({ para: [], contactos, ...personas }), 'Estimados,')
  assert.equal(saludoPara({ para: ['otro@x.cl'], contactos, ...personas }), 'Estimados,')
  // Lo aprendido de un saludo escrito a mano manda
  assert.equal(saludoPara({ para: ['etienne.coqueletf@gmail.com'], contactos, aprendido: 'Estimado Etienne,', ...personas }), 'Estimado Etienne,')
})

// Geslog 498 («Asesoria reorg», cuota 7/24) y 502 («Ases laboral octubre 26») están vinculadas a la MISMA venta en la base, pero son dos trabajos:
// se agrupa por la glosa, no por la venta.
test('sin clave de venta se agrupa por el nombre del trabajo de la glosa', () => {
  const t = cuerpoVariasFacturas({ items: [
    { folio: '498', relacion: 'Asesoria reorg', detalle: 'Pago 7 de 24' },
    { folio: '502', relacion: 'Ases laboral octubre 26' },
    { folio: '519', relacion: 'asesoria  reorg', detalle: 'Pago 8 de 24' },
  ] })
  assert.match(t, /a los siguientes trabajos:\n– Asesoria reorg: Pago 7 de 24 \(N° 498\) y Pago 8 de 24 \(N° 519\)\.\n– Ases laboral octubre 26: N° 502\.$/)
})

import { tratoDeTexto } from '../supabase/functions/_shared/correoFacturaTexto.js'
import { tratoDeCorreo } from '../supabase/functions/_shared/gmailLectura.js'

test('trato por persona: «esté» es usted, «estés» es tú, «estén» no enseña; manda el aprendido sobre el saludo (correos reales 4-11)', () => {
  assert.equal(tratoDeTexto('Espero que esté muy bien. Adjuntamos la factura'), 'usted')
  assert.equal(tratoDeTexto('Espero que estés muy bien.'), 'tu')
  assert.equal(tratoDeTexto('Espero que estén muy bien.'), null)
  assert.equal(ajustarTrato('Espero que estén muy bien. Quedamos atentos a sus comentarios.', true, 'usted'), 'Espero que esté muy bien. Quedamos atentos a sus comentarios.')
  assert.equal(ajustarTrato('Espero que estén muy bien. Quedamos atentos a sus comentarios.', true, null), 'Espero que estés muy bien. Quedamos atentos a tus comentarios.')
  assert.equal(ajustarTrato('Espero que esté muy bien.', false, 'usted'), 'Espero que estén muy bien.')
})

test('trato leído de un correo enviado: una dirección de afuera; «estén» y dos destinatarios no enseñan', () => {
  const c = para => ({ para, fragmento: 'Estimada Gabriela, Espero que esté muy bien. Adjuntamos la factura N° 507' })
  assert.deepEqual(tratoDeCorreo(c('gmasihy@hotmail.com'), 'leabogados.cl'), { email: 'gmasihy@hotmail.com', trato: 'usted' })
  assert.equal(tratoDeCorreo(c('a@x.cl, b@y.cl'), 'leabogados.cl'), null)
  assert.equal(tratoDeCorreo({ para: 'a@x.cl', fragmento: 'Estimados, Espero que estén muy bien.' }, 'leabogados.cl'), null)
})

import { notaPagadas } from '../supabase/functions/_shared/correoFacturaTexto.js'
test('nota de facturas ya pagadas: una, varias, ninguna e inglés (caso real 439 en el envío 448+439)', () => {
  assert.equal(notaPagadas(['439']), 'La factura N° 439 ya se encuentra pagada.')
  assert.equal(notaPagadas(['439', '440']), 'Las facturas N° 439 y 440 ya se encuentran pagadas.')
  assert.equal(notaPagadas([]), '')
  assert.equal(notaPagadas(['439'], 'en'), 'Invoice No. 439 has already been paid.')
})

test('lineasTrabajos son las líneas del cuerpo de varias facturas, una por trabajo con su folio', () => {
  const items = [{ folio: '511', relacion: 'Proyecto A', detalle: 'Pago 1 de 18', key: 'a' }, { folio: '512', relacion: 'Servicio B', detalle: 'Octubre 2026', key: 'b' }]
  const l = lineasTrabajos({ items, lang: 'es' })
  assert.deepEqual(l, ['– Proyecto A: Pago 1 de 18 (N° 511).', '– Servicio B: Octubre 2026 (N° 512).'])
  assert.ok(cuerpoVariasFacturas({ items, lang: 'es' }).endsWith(l.join('\n')))
})
