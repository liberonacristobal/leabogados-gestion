// PDF «Resultado del año»: el dibujo cabe en una hoja carta, sin pasar del pie, aun con tres años de ventas y todas las notas. Prueba con un `doc` falso (sin navegador).
import test from 'node:test'
import assert from 'node:assert/strict'
import { dibujarResultadoAnio } from '../src/lib/dibujoResultadoAnio.js'

const docFalso = () => {
  const llamadas = { texto: [], rayas: [], fondos: 0 }, est = { size: 10 }
  return { llamadas, internal: { pageSize: { getWidth: () => 612, getHeight: () => 792 } },
    setFont() {}, setFontSize(s) { est.size = s }, setTextColor() {}, setDrawColor() {}, setFillColor() {}, setLineWidth() {}, addImage() {},
    text(t, x, y, o) { llamadas.texto.push({ t, x, y, al: o && o.align, s: est.size }) }, line(x1, y1, x2, y2) { llamadas.rayas.push([x1, y1, x2, y2]) }, rect() { llamadas.fondos++ }, roundedRect() { llamadas.fondos++ },
    getTextWidth(t) { return String(t).length * est.size * 0.5 }, splitTextToSize(t, w) { const max = Math.floor(w / (est.size * 0.5)), out = []; let l = ''; for (const p of String(t).split(' ')) { if ((l + ' ' + p).trim().length > max) { out.push(l); l = p } else l = (l + ' ' + p).trim() } if (l) out.push(l); return out } }
}
const fila = (s, l, uf, clp, o = {}) => ({ s, l, uf, clp, ...o })
const datos = (anios = 2) => ({ titulo: 'Resultado del año 2026', corte: 'Corte al 16-11-2026, 19:42 hrs', dominio: 'gestion.ejemplo.cl',
  cifras: [{ t: 'Vendido neto', uf: 'UF 11.145', clp: '$452,5M' }, { t: 'Facturado', uf: 'UF 8.184', clp: '$332,3M' }, { t: 'Cobrado propio', uf: 'UF 7.650', clp: '$310,8M' }, { t: 'Resultado', uf: 'UF 3.729', clp: '$151,4M' }],
  grupos: [
    { t: 'Vendido', chip: '113 % de la meta', filas: [fila('', 'Vendido bruto', '12.308', '$499.404.318'), fila('−', 'Costos de terceros', '1.163', '$46.902.191', { neg: true }), fila('=', 'Vendido neto', '11.145', '$452.502.127', { t: 'tot' }), fila('', 'Meta del año', '9.858', '$400.000.000', { t: 'mut' })] },
    { t: 'Facturado', chip: '67 % del bruto', gris: true, filas: [...Array.from({ length: anios }, (_, i) => fila('', `De ventas ${2026 - i}`, '6.021', '$245.005.595')), fila('=', 'Facturado', '8.184', '$332.252.104', { t: 'tot' }), fila('', 'Total emitido', '8.884', '$360.757.540', { t: 'mut' })] },
    { t: 'Cobrado', chip: '124 % de la meta', filas: [...Array.from({ length: anios }, (_, i) => fila('', `De ventas ${2026 - i}`, '5.772', '$235.260.126')), fila('=', 'Cobrado propio', '7.650', '$310.764.656', { t: 'tot' }), fila('−', 'Comisiones pagadas', '738', '$30.090.654', { neg: true }), fila('+', 'Comisiones percibidas', '4', '$145.022'), fila('=', 'Ingreso real', '6.916', '$280.819.024', { t: 'tot' }), fila('', 'Total a caja', '8.015', '$325.610.846', { t: 'mut' }), fila('', 'Meta de cobranza', '6.154', '$250.000.000', { t: 'mut' }), fila('', 'Sobre la meta de cobranza', '1.496', '$60.764.656', { t: 'mut' })] },
    { t: 'Resultado del ejercicio', chip: '45,2 % margen', filas: [fila('', 'Facturado', '8.184', '$332.252.104'), fila('+', 'Comisión de externos', '56', '$2.306.650'), fila('=', 'Ingresos', '8.240', '$334.558.754', { t: 'tot' }), fila('−', 'Costos', '3.653', '$148.175.711', { neg: true }), fila('−', 'Comisiones', '858', '$35.019.482', { neg: true }), fila('=', 'Resultado', '3.729', '$151.363.561', { t: 'tot' }), fila('+', 'Sueldos de socios', '1.606', '$65.064.424'), fila('=', 'Antes de sueldos de socios', '5.335', '$216.427.985', { t: 'tot', chip: '64,7 % margen' })] },
  ],
  notas: ['Total emitido incluye documentos de terceros y reembolsos. Total a caja incluye, además del cobrado propio, subarriendo, reembolsos y la parte de externos.', 'Costos incluyen subarriendo y gastos recuperados como menor costo (UF 239, $9,7M). Sueldos de socios a costo empresa: líquido, impuesto único y cotizaciones.', 'Resultado es devengado; Cobrado, por fecha del depósito. UF del día de cada movimiento.'] })

test('con tres años de ventas el contenido termina antes del pie de la hoja carta', () => {
  const doc = docFalso(), fin = dibujarResultadoAnio(doc, datos(3), null, 'Estudio')
  assert.ok(fin < 792 - 36 - 6, `termina en ${fin}`)
})
test('todo texto queda dentro de los márgenes y el signo menos se dibuja como guion (helvetica no trae «−»)', () => {
  const doc = docFalso(); dibujarResultadoAnio(doc, datos(2), null, 'Estudio')
  const t = doc.llamadas.texto
  assert.ok(t.every((x) => x.x >= 40 - 1 && x.x <= 612 - 40 + 1), 'fuera de margen')
  assert.ok(!t.some((x) => String(x.t).includes('−')))
  assert.ok(t.some((x) => x.t === 'Antes de sueldos de socios') && t.some((x) => x.t === '64,7 % margen'))
  assert.ok(t.some((x) => /gestion\.ejemplo\.cl/.test(x.t)))
})
test('sin logo escribe el nombre del estudio y no falla', () => {
  const doc = docFalso(); dibujarResultadoAnio(doc, datos(1), null, 'Estudio Demo'); assert.ok(doc.llamadas.texto.some((x) => x.t === 'Estudio Demo'))
})
