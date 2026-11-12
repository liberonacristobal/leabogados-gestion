// Boletas de honorarios recibidas: lectura del informe del SII y cruce con los cargos del banco. Datos anonimizados.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { leerInformeBoletas, boletasDeCargo, rutBoleta } from './../supabase/functions/_shared/boletasRecibidas.js'

const TEXTO = `INFORME CORRESPONDIENTE AL MES Septiembre DEL AÑO 2026
Boleta Emisor Honorarios Observar Ver
16135924 VIG 03/09/2026 60306045-8 CONSERVADOR DE BIENES RAICES D
NO
4.600 0 4.600
16180593 VIG 15/09/2026 60306045-8 CONSERVADOR DE BIENES RAICES D
NO
4.600 0 4.600
16181148 VIG 15/09/2026 60306045-8 CONSERVADOR DE BIENES RAICES D
NO
2.300 0 2.300
864 VIG 09/09/2026 11111111-1 PERSONA UNO APELLIDO
NO
1.372.000 0 1.372.000
380 ANU 30/09/2026 22222222-2 PERSONA DOS
NO
821.144 125.224 695.920
Totales* : 2.000.000 0 2.000.000`

test('el texto del informe se lee boleta por boleta, con RUT, fecha ISO y montos enteros', () => {
  const { filas } = leerInformeBoletas(TEXTO)
  assert.equal(filas.length, 5)
  assert.deepEqual(filas[0], { folio: '16135924', estado: 'VIG', fecha: '2026-09-03', emisor_rut: '60306045-8', emisor_nombre: 'CONSERVADOR DE BIENES RAICES D', bruto: 4600, retencion: 0, pagado: 4600 })
  assert.deepEqual([filas[4].estado, filas[4].bruto, filas[4].retencion, filas[4].pagado], ['ANU', 821144, 125224, 695920])
  assert.deepEqual(leerInformeBoletas('').filas, []); assert.deepEqual(leerInformeBoletas(null).filas, [])
})
test('la planilla se lee por los nombres de sus columnas, en cualquier orden, y descarta filas sin fecha o RUT', () => {
  const aoa = [['Informe mensual'], ['Fecha', 'N° Boleta', 'Estado', 'Rut', 'Nombre o Razón Social', 'Brutos', 'Retenido', 'Pagado'], ['09/11/2026', 864, 'VIG', '11.111.111-1', 'PERSONA UNO', 1372000, 0, 1372000], ['', 5, 'VIG', '1-9', 'X', 1, 0, 1], ['Totales', '', '', '', '', 1372000, 0, 1372000]]
  const r = leerInformeBoletas(aoa)
  assert.equal(r.filas.length, 1); assert.equal(r.descartadas, 2)
  assert.deepEqual(r.filas[0], { folio: '864', estado: 'VIG', fecha: '2026-11-09', emisor_rut: '11111111-1', emisor_nombre: 'PERSONA UNO', bruto: 1372000, retencion: 0, pagado: 1372000 })
  assert.deepEqual(leerInformeBoletas([['nada', 'aquí']]).filas, [])
})
test('rutBoleta deja el RUT con guion y sin puntos', () => { assert.equal(rutBoleta('60.306.045-8'), '60306045-8'); assert.equal(rutBoleta('7883269k'), '7883269-K'); assert.equal(rutBoleta(null), '') })

const B = leerInformeBoletas(TEXTO).filas
test('cargo sin nombre (TGR): una boleta o varias del mismo emisor y del mismo día que sumen el monto', () => {
  assert.deepEqual(boletasDeCargo({ monto: 4600, fecha: '2026-09-04' }, B).map(x => x.boletas.map(b => b.folio)), [['16135924']])   // la del 15/09 queda a 11 días: fuera
  const dos = boletasDeCargo({ monto: 6900, fecha: '2026-09-15' }, B)
  assert.equal(dos.length, 1); assert.deepEqual(dos[0].boletas.map(b => b.folio), ['16180593', '16181148']); assert.equal(dos[0].total, 6900)
  assert.deepEqual(boletasDeCargo({ monto: 6900, fecha: '2026-10-30' }, B), [])   // fuera de la ventana
})
test('cargo a una persona con RUT: su boleta por el monto pagado (líquido); anuladas y ligadas a otro cargo no cuentan', () => {
  assert.equal(boletasDeCargo({ monto: 1372000, fecha: '2026-09-09', rut: '11.111.111-1' }, B).length, 1)
  assert.equal(boletasDeCargo({ monto: 1372000, fecha: '2026-09-09', rut: '33333333-3' }, B).length, 0)
  assert.equal(boletasDeCargo({ monto: 695920, fecha: '2026-09-30', rut: '22222222-2' }, B).length, 0)                     // anulada
  assert.equal(boletasDeCargo({ monto: 1372000, fecha: '2026-09-09', rut: '11111111-1', id: 'x' }, [{ ...B[3], movimiento_id: 'otro' }]).length, 0)
  assert.equal(boletasDeCargo({ monto: 1372000, fecha: '2026-09-09', rut: '11111111-1', id: 'x' }, [{ ...B[3], movimiento_id: 'x' }]).length, 1)
  for (const c of [null, {}, { monto: 0, fecha: '2026-09-09' }, { monto: 5, fecha: 'x' }]) assert.deepEqual(boletasDeCargo(/** @type {any} */ (c), B), [])
})
