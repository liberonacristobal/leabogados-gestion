// PDF «Resultado del año» (hoja carta horizontal, cuatro bloques abiertos): el dibujo cabe en la hoja, sin pasar del pie, aun con tres años de ventas, y las dos cajas de una fila comparten alto.
// Prueba con un `doc` falso (sin navegador). Cifras ficticias.
import test from 'node:test'
import assert from 'node:assert/strict'
import { dibujarResultadoAnio } from '../src/lib/dibujoResultadoAnio.js'

const docFalso = () => {
  const llamadas = { texto: [], rayas: [] }, est = { size: 10 }
  return { llamadas, internal: { pageSize: { getWidth: () => 792, getHeight: () => 612 } },
    setFont() {}, setFontSize(s) { est.size = s }, setTextColor() {}, setDrawColor() {}, setFillColor() {}, setLineWidth() {}, addImage() {},
    text(t, x, y, o) { llamadas.texto.push({ t, x, y, al: o && o.align, s: est.size }) }, line(x1, y1, x2, y2) { llamadas.rayas.push([x1, y1, x2, y2]) }, rect() {}, roundedRect() {} }
}
const fila = (s, l, uf, clp, o = {}) => ({ s, l, uf, clp, ...o })
const datos = (anios = 2) => ({ titulo: 'Resultado del año 2026', corte: 'Corte al 16-11-2026, 19:42 hrs', dominio: 'gestion.ejemplo.cl', bloques: [
  { t: 'Vendido neto', pct: '113 % de la meta', uf: 'UF 11.145', clp: '$452.502.127', filas: [fila('', 'Vendido bruto', '12.308', '$499.404.318'), fila('−', 'Costos de terceros', '1.163', '$46.902.191', { neg: true }), fila('', 'Meta del año', '9.858', '$400.000.000', { t: 'mut' })] },
  { t: 'Facturado', pct: '67 % de lo vendido bruto', uf: 'UF 8.184', clp: '$332.252.104', filas: [...Array.from({ length: anios }, (_, i) => fila('', `De ventas ${2026 - i}`, '6.021', '$245.005.595')), fila('', 'Total emitido', '8.884', '$360.757.540', { t: 'mut' })] },
  { t: 'Cobrado propio', pct: '124 % de la meta', uf: 'UF 7.650', clp: '$310.764.656', filas: [fila('−', 'Comisiones pagadas', '738', '$30.090.654', { neg: true }), fila('+', 'Comisiones percibidas', '4', '$145.022'), fila('=', 'Ingreso real', '6.916', '$280.819.024', { t: 'tot' }), fila('', 'Total a caja', '8.015', '$325.610.846', { t: 'mut' }), ...Array.from({ length: anios }, (_, i) => fila('', `De ventas ${2026 - i}`, '5.772', '$235.260.126', { t: 'mut' })), fila('', 'Meta de cobranza', '6.154', '$250.000.000', { t: 'mut' }), fila('', 'Sobre la meta de cobranza', '1.496', '$60.764.656', { t: 'mut' })] },
  { t: 'Resultado del ejercicio', pct: '45,2 % margen', uf: 'UF 3.729', clp: '$151.363.561', filas: [fila('', 'Facturado', '8.184', '$332.252.104'), fila('+', 'Comisión de externos', '56', '$2.306.650'), fila('=', 'Ingresos', '8.240', '$334.558.754', { t: 'tot' }), fila('−', 'Costos', '3.653', '$148.175.711', { neg: true }), fila('', 'incluye subarriendo', '239', '$9.720.000', { t: 'mut' }), fila('−', 'Comisiones', '858', '$35.019.482', { neg: true }), fila('+', 'Sueldos de socios', '1.606', '$65.064.424'), fila('=', 'Antes de sueldos de socios', '5.335', '$216.427.985', { t: 'tot' })] },
] })

test('con tres años de ventas el contenido termina antes del pie de la hoja horizontal', () => {
  const doc = docFalso(), fin = dibujarResultadoAnio(doc, datos(3), null, 'Estudio')
  assert.ok(fin < 612 - 40, `termina en ${fin}`)
})
test('todo texto queda dentro de los márgenes y el signo menos se dibuja como guion (helvetica no trae «−»)', () => {
  const doc = docFalso(); dibujarResultadoAnio(doc, datos(2), null, 'Estudio')
  const t = doc.llamadas.texto
  assert.ok(t.every((x) => x.x >= 40 - 1 && x.x <= 792 - 40 + 1), 'fuera de margen')
  assert.ok(!t.some((x) => String(x.t).includes('−')))
  assert.ok(t.some((x) => x.t === 'Antes de sueldos de socios') && t.some((x) => x.t === 'Resultado del ejercicio') && t.some((x) => x.t === 'UF 3.729'))
  assert.ok(t.some((x) => /gestion\.ejemplo\.cl/.test(x.t)))
})
test('las dos cajas de una misma fila comienzan a la misma altura y la segunda fila queda debajo de la más alta de la primera', () => {
  const doc = docFalso(); dibujarResultadoAnio(doc, datos(3), null, 'Estudio')
  const ys = (/** @type {string} */ n) => doc.llamadas.texto.find((x) => x.t === n).y
  assert.equal(ys('Vendido neto'), ys('Facturado')); assert.equal(ys('Cobrado propio'), ys('Resultado del ejercicio'))
  const ultimaFila1 = Math.max(...doc.llamadas.texto.filter((x) => ['Meta del año', 'Total emitido', 'De ventas 2024'].includes(x.t) && x.y < ys('Cobrado propio')).map((x) => x.y))
  assert.ok(ys('Cobrado propio') > ultimaFila1 + 10)
})
test('sin logo escribe el nombre del estudio y no falla; un bloque suelto tampoco rompe', () => {
  const doc = docFalso(), d = datos(1); d.bloques = d.bloques.slice(0, 3)
  dibujarResultadoAnio(doc, d, null, 'Estudio Demo'); assert.ok(doc.llamadas.texto.some((x) => x.t === 'Estudio Demo'))
})

test('el título de cada bloque va a la misma altura que su cifra en UF y con letra grande', () => {
  const doc = docFalso(); dibujarResultadoAnio(doc, datos(2), null, 'Estudio')
  const tit = doc.llamadas.texto.find((x) => x.t === 'Vendido neto'), uf = doc.llamadas.texto.find((x) => x.t === 'UF 11.145')
  assert.equal(tit.y, uf.y); assert.ok(tit.s >= 14)
})
