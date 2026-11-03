// Glosa de una factura desde su XML (NmbItem + DscItem) y la revisión contra la cuota asignada. Casos anonimizados.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { glosaDeXml, guardarYRevisarGlosa } from '../supabase/functions/sii-sync/glosa.ts'

const xml = '<Documento><Detalle><NroLinDet>1</NroLinDet><NmbItem>Servicios legales</NmbItem><DscItem>Recurso de nulidad &amp; reclamo 10 UF</DscItem></Detalle><Detalle><NmbItem>Pago 6/10</NmbItem></Detalle></Documento>'

test('glosa: nombre y descripción de cada detalle, con las entidades decodificadas', () => {
  assert.equal(glosaDeXml(xml), 'Servicios legales Recurso de nulidad & reclamo 10 UF · Pago 6/10')
  assert.equal(glosaDeXml('<Documento></Documento>'), '')
})

// Cliente base de datos mínimo para probar la revisión.
const base = (b, log) => {
  const ins = []
  const q = (tabla) => ({
    update: () => ({ eq: () => ({ is: async () => ({}) }) }),
    select: () => tabla === 'billing' ? ({ eq: () => ({ maybeSingle: async () => ({ data: b }) }) }) : ({ eq: () => ({ in: () => ({ limit: async () => ({ data: log }) }) }) }),
    insert: async (x) => { ins.push(x); return {} },
  })
  return { sb: { from: q }, ins }
}
test('si el motor asignó la factura y la glosa contradice la cuota, deja un aviso; si no la asignó el motor o no contradice, no', async () => {
  const x = (g) => `<Detalle><NmbItem>${g}</NmbItem></Detalle>`
  let c = base({ id: 'b1', concept: 'Reorganizacion — Cuota 7/10', sale_id: 's', invoice_no: '505' }, [{ id: 1 }])
  await guardarYRevisarGlosa(c.sb, 'b1', '505', x('Pago 6/10')); assert.equal(c.ins.length, 1); assert.equal(c.ins[0].action, 'facturacion.glosa_no_coincide')
  c = base({ id: 'b1', concept: 'Reorganizacion — Cuota 6/10', sale_id: 's' }, [{ id: 1 }]); await guardarYRevisarGlosa(c.sb, 'b1', '505', x('Pago 6/10')); assert.equal(c.ins.length, 0)
  c = base({ id: 'b1', concept: 'Reorganizacion — Cuota 7/10', sale_id: 's' }, []); await guardarYRevisarGlosa(c.sb, 'b1', '505', x('Pago 6/10')); assert.equal(c.ins.length, 0)
  c = base({ id: 'b1', concept: 'Cuota 7/10', sale_id: null }, [{ id: 1 }]); await guardarYRevisarGlosa(c.sb, 'b1', '505', x('Pago 6/10')); assert.equal(c.ins.length, 0)
})
