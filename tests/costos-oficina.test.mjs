// Costo de oficina NETO: el subarriendo y los gastos recuperados (es_ingreso) bajan el costo; no son ingreso. Planilla incompleta y notas de crédito de subarriendo. Datos anonimizados.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { costoOficinaBruto, costoOficinaNeto, recuperadoOficinaMes, valorVigenteCosto, etiquetaRecuperado, docDeSubarriendo, costoOperacionBruto, TXT_RECUPERADO } from './../supabase/functions/_shared/costosOficina.js'

const rows = [
  { categoria: 'Remuneraciones', item: 'Persona A', monto: 3_000_000, desde: '2026-10-01', monto_prev: 2_300_000 },
  { categoria: 'Arriendo y espacio', item: 'Arriendo', monto: 2_780_000, desde: '2026-03-01', monto_prev: 780_000 },
  { categoria: 'Arriendo y espacio', item: 'Gastos comunes', monto: 890_000 },
  { categoria: 'Arriendo y espacio', item: 'Subarriendo de prueba', monto: 1_080_000, es_ingreso: true, desde: '2026-03-01', monto_prev: 0 },
  { categoria: 'Servicios', item: 'Internet', monto: 34_200 },
]
test('el valor de cada ítem es el vigente en el mes (antes de su fecha, el anterior)', () => {
  assert.equal(valorVigenteCosto(rows[1], '2026-02'), 780_000); assert.equal(valorVigenteCosto(rows[1], '2026-03'), 2_780_000); assert.equal(valorVigenteCosto(null, '2026-01'), 0)
})
test('neto = bruto − subarriendo fijo del mes: sin subarriendo antes de su inicio y 1,08 M desde entonces (no el calendario de la factura)', () => {
  assert.equal(costoOficinaBruto(rows, '2026-11'), 3_000_000 + 2_780_000 + 890_000 + 34_200)
  assert.equal(recuperadoOficinaMes(rows, '2026-11'), 1_080_000); assert.equal(recuperadoOficinaMes(rows, '2026-02'), 0)
  assert.equal(costoOficinaNeto(rows, '2026-11'), costoOficinaBruto(rows, '2026-11') - 1_080_000); assert.equal(costoOficinaNeto(rows, '2026-02'), costoOficinaBruto(rows, '2026-02'))
  assert.equal(costoOficinaNeto(rows, '2026-11', { excluirCategorias: ['Remuneraciones'] }), 2_780_000 + 890_000 + 34_200 - 1_080_000)   // overhead por hora
  assert.equal(costoOficinaNeto(rows, '2026-11', { soloCategoria: 'Arriendo y espacio' }), 2_780_000 + 890_000 - 1_080_000)
})
test('ítems inactivos no cuentan, varios ítems es_ingreso suman, ym inválido usa el mes actual y monto_prev nulo vale el monto', () => {
  const r2 = [...rows, { categoria: 'Arriendo y espacio', item: 'Gasto recuperado', monto: 100_000, es_ingreso: true }, { categoria: 'Servicios', item: 'Viejo', monto: 9_999_999, activo: false }, { categoria: 'Arriendo y espacio', item: 'Sin previo', monto: 70_000, desde: '2027-01-01' }]
  assert.equal(recuperadoOficinaMes(r2, '2026-11'), 1_180_000)                                          // varias filas es_ingreso suman
  assert.equal(costoOficinaBruto(r2, '2026-11'), 3_000_000 + 2_780_000 + 890_000 + 34_200 + 70_000)   // el inactivo no entra; sin monto_prev vale su monto aun antes de `desde`
  assert.equal(costoOficinaNeto(r2, '2026-11'), costoOficinaBruto(r2, '2026-11') - 1_180_000)
  assert.equal(costoOficinaBruto(rows, 'no-es-mes'), costoOficinaBruto(rows)); assert.equal(costoOficinaBruto(rows, ''), costoOficinaBruto(rows))
  assert.equal(recuperadoOficinaMes([{ item: 'x', monto: 5, es_ingreso: true, activo: false }], '2026-11'), 0)
})
test('flujo: el costo de operación BRUTO suma de vuelta el subarriendo y el PPM', () => {
  assert.equal(costoOperacionBruto({ cos: 12_000_000, sub: 1_080_000, ppm: 800_000 }), 13_880_000); assert.equal(costoOperacionBruto({ cos: 5 }), 5); assert.equal(costoOperacionBruto(null), 0)
})
test('rótulo: el nombre del ítem del estudio si es uno solo; si no, el genérico; filas nulas no rompen', () => {
  assert.equal(etiquetaRecuperado(rows), 'Subarriendo de prueba'); assert.equal(etiquetaRecuperado([]), TXT_RECUPERADO); assert.equal(TXT_RECUPERADO, 'Subarriendo y gastos recuperados')
  assert.equal(etiquetaRecuperado([...rows, { categoria: 'Otros', item: 'Gasto recuperado', monto: 5, es_ingreso: true }]), TXT_RECUPERADO)
  assert.equal(costoOficinaNeto(null, '2026-11'), 0); assert.equal(costoOficinaNeto([null, { monto: 'x' }], '2026-11'), 0)
})
test('nota de crédito de una factura de subarriendo no resta honorarios; la de una factura normal sí', () => {
  const bById = { s1: { id: 's1', billing_type: 'subarriendo' }, h1: { id: 'h1', billing_type: 'honorarios' } }
  assert.equal(docDeSubarriendo({ billing_type: 'subarriendo' }, bById), true)
  assert.equal(docDeSubarriendo({ billing_type: 'nota_credito', nc_ref_billing_id: 's1' }, bById), true)
  assert.equal(docDeSubarriendo({ billing_type: 'nota_credito', nc_ref_billing_id: 'h1' }, bById), false)
  assert.equal(docDeSubarriendo({ billing_type: 'honorarios' }, bById), false); assert.equal(docDeSubarriendo(null, bById), false); assert.equal(docDeSubarriendo({ billing_type: 'nota_credito' }), false)
})

test('alerta de caja del mes: lo que entró (con los depósitos de subarriendo) se compara con el costo BRUTO, no con el neto', async () => {
  const { cajaContraCosto } = await import('./../supabase/functions/_shared/costosOficina.js')
  const r = { cos: 2_000_000, sub: 500_000, cosUF: 50, subUF: 12.5 }   // neto 2,0 M + subarriendo 0,5 M = bruto 2,5 M
  const a = cajaContraCosto(2_300_000, r)
  assert.equal(a.cuesta, 2_500_000); assert.equal(a.cuestaUF, 62.5); assert.equal(a.alerta, true); assert.equal(a.falta, 200_000)   // con el neto (2,0 M) no habría alerta: se descontaba dos veces
  assert.equal(cajaContraCosto(2_600_000, r).alerta, false); assert.equal(cajaContraCosto(0, r).alerta, false); assert.equal(cajaContraCosto(1, null).alerta, false)
})
