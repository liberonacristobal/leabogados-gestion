// La glosa del DTE de subarriendo es configurable y la factura se reconoce por su vínculo, nunca por su glosa. Datos anonimizados (el caso F514).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { glosaDteSubarriendo, GLOSA_DTE_SUBARRIENDO_DEFECTO } from './../supabase/functions/_shared/glosaSubarriendo.js'
import { docDeSubarriendo } from './../supabase/functions/_shared/costosOficina.js'
import { esVentaSubarriendo, propuestaDelDia } from './../supabase/functions/_shared/facturacionReglas.js'

test('glosa por defecto: «Servicios legales — Asesoría Laboral {mes} {año}», con el período del concepto o del vencimiento', () => {
  assert.equal(GLOSA_DTE_SUBARRIENDO_DEFECTO, 'Servicios legales — Asesoría Laboral {mes} {año}')
  assert.equal(glosaDteSubarriendo({ concept: 'Subarrendamiento oficina — Mensual Octubre 2026', due: '2026-11-01' }), 'Servicios legales — Asesoría Laboral Octubre 2026')
  assert.equal(glosaDteSubarriendo({ concept: 'Subarrendamiento oficina', due: '2026-12-01' }), 'Servicios legales — Asesoría Laboral Diciembre 2026')
  assert.ok(!/subarr/i.test(glosaDteSubarriendo({ concept: 'Subarrendamiento oficina — Mensual Octubre 2026' })))   // el DTE no lleva la palabra
})
test('la plantilla del estudio manda sobre el valor por defecto; vacía o nula usa el defecto', () => {
  const b = { concept: 'X — Mensual Marzo 2026' }
  assert.equal(glosaDteSubarriendo(b, 'Asesoría {mes} de {año}'), 'Asesoría Marzo de 2026')
  assert.equal(glosaDteSubarriendo(b, '  '), 'Servicios legales — Asesoría Laboral Marzo 2026'); assert.equal(glosaDteSubarriendo(b, null), glosaDteSubarriendo(b))
})
test('identificar por vínculo, nunca por glosa: una factura con la glosa de la F514 (sin la palabra) sigue siendo de subarriendo por su billing_type; una con la palabra, pero sin vínculo, no lo es', () => {
  const f514 = { id: 'b514', billing_type: 'subarriendo', invoice_no: '514', concept: 'Servicios legales — Asesoría Laboral Octubre 2026' }
  assert.equal(docDeSubarriendo(f514), true)
  assert.equal(docDeSubarriendo({ id: 'x', billing_type: 'honorarios', concept: 'Subarrendamiento oficina — Mensual Octubre 2026' }), false)
  assert.equal(esVentaSubarriendo({ cobro_config: { subarriendo: true }, title: 'Servicios legales' }), true)
  assert.equal(esVentaSubarriendo({ title: 'Subarrendamiento oficina' }), false)
})
test('el cruce con el SII reconoce la cuota de subarriendo con la glosa de la F514 (sin la palabra): la glosa no manda, manda el vínculo con la venta', () => {
  const ventas = [{ id: 'ss', moneda: 'CLP', title: 'Subarrendamiento oficina', cobro_config: { subarriendo: true } }]
  const cuota = { id: 'm10', client_id: 'c2', entity_id: null, receptor_rut: '78.099.865-2', sale_id: 'ss', amount: 1080000, due: '2026-10-01', status: 'Programada', invoice_no: null, billing_type: 'subarriendo', concept: 'Subarrendamiento oficina — Mensual Octubre 2026' }
  const doc = { rut: '78099865-2', monto: 1080000, fecha: '2026-11-03', glosa: 'Servicios legales — Asesoría Laboral octubre 2026' }
  const r = propuestaDelDia({ doc, programadas: [cuota], ents: [{ id: 'e9', client_id: 'c2', rut: '78.099.865-2' }], clientes: [{ id: 'c2', rut: '78.099.865-2' }], ventas, ufPorFecha: {}, anticipos: [] })
  assert.equal(r.nivel, 'subarriendo'); assert.equal(r.propuesta.id, 'm10')
})
