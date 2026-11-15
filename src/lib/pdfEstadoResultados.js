// PDF directo (sin ventana de impresión) del «Estado de resultados» formal: carta horizontal, mismas líneas, cifras y orden que la vista.
// No calcula nada: recibe las celdas ya formateadas por la vista (una sola fuente de cifras) y solo las dibuja (jsPDF, helvetica).
import { BRAND, appAlert } from './base.jsx'
import { entregarArchivo } from './archivos.js'

const AZ = [0, 60, 80], MU = [83, 114, 129], TX = [61, 61, 61], LN = [228, 232, 235], BG = [245, 247, 249], RJ = [162, 45, 45]

/**
 * @typedef {{ t: 'sec'|'it'|'sub'|'res'|'inf', l: string, c?: string[], neg?: boolean }} FilaPdf
 * c = celdas en orden: un valor por mes, total, año anterior, variación y % de ingresos (texto ya formateado).
 * @typedef {{ titulo: string, periodo: string, unidad: string, emitido: string, meses: string[], estimado: boolean[], anioPrev: string, prevEst: boolean, filas: FilaPdf[] }} DatosPdf
 */

/** Dibuja el estado en `doc` (una página carta horizontal). Separado de la descarga para poder probarlo sin navegador. @param {any} doc @param {DatosPdf} d @param {string|null} logo @param {string} [nombre] */
export function dibujarEstadoResultados(doc, d, logo, nombre = '') {
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 32, R = W - M
  const col = (/** @type {number[]} */ c) => doc.setTextColor(c[0], c[1], c[2])
  const draw = (/** @type {number[]} */ c) => doc.setDrawColor(c[0], c[1], c[2])
  const fill = (/** @type {number[]} */ c) => doc.setFillColor(c[0], c[1], c[2])
  const txt = (/** @type {string} */ t, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ s, /** @type {boolean} */ b, /** @type {number[]} */ c, /** @type {any} */ al) => { doc.setFont('helvetica', b ? 'bold' : 'normal'); doc.setFontSize(s); col(c); doc.text(String(t), x, y, al ? { align: al } : undefined) }
  // Encabezado
  let y = 40
  if (logo) { try { doc.addImage(logo, 'PNG', M, y - 6, 130, 130 * 91 / 600) } catch (_) { txt(nombre, M, y + 10, 13, true, AZ) } } else txt(nombre, M, y + 10, 13, true, AZ)
  txt(d.titulo.toUpperCase(), R, y + 6, 12, true, AZ, 'right'); txt(`Emitido el ${d.emitido}`, R, y + 19, 8.5, false, MU, 'right')
  y += 36; draw(AZ); doc.setLineWidth(1.2); doc.line(M, y, R, y); y += 16
  txt(d.periodo, M, y, 10, true, TX); txt(`Cifras en ${d.unidad}`, R, y, 9, false, MU, 'right'); y += 14

  // Columnas: concepto, un mes por columna, total, año anterior, variación y % ingresos.
  const n = d.meses.length, wConc = 200, wTot = 46, wPrev = 46, wVar = 40, wPct = 40
  const wMes = (R - M - wConc - wTot - wPrev - wVar - wPct) / n
  const xCol = [], ancho = [...Array(n).fill(wMes), wTot, wPrev, wVar, wPct]
  let x = M + wConc; ancho.forEach(w => { xCol.push(x + w); x += w })   // borde derecho de cada columna

  // Fila de títulos
  const hH = 24; fill(BG); doc.rect(M, y, R - M, hH, 'F')
  txt('CONCEPTO', M + 6, y + 15, 7, true, AZ)
  const tit = [...d.meses.map((m, i) => [m, d.estimado[i] ? 'est.' : '']), ['Total', ''], [d.anioPrev, d.prevEst ? 'est.' : 'mismo per.'], ['Var. %', ''], ['% ingr.', '']]
  tit.forEach(([a, b], i) => { txt(a.toUpperCase(), xCol[i] - 4, y + (b ? 11 : 15), 7, true, AZ, 'right'); if (b) txt(b, xCol[i] - 4, y + 20, 6, false, MU, 'right') })
  y += hH

  // Cuerpo
  d.filas.forEach(f => {
    if (f.t === 'sec') { y += 5; txt(f.l.toUpperCase(), M + 6, y + 9, 7.5, true, AZ); y += 14; return }
    const res = f.t === 'res', sub = f.t === 'sub' || res, bold = f.t !== 'it' && f.t !== 'inf', xl = M + (f.t === 'it' || f.t === 'inf' ? 14 : 6), fs = f.t === 'inf' ? 7.5 : 8
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(fs)
    const lin = /** @type {string[]} */ (doc.splitTextToSize(f.l, wConc - (xl - M) - 6)), alto = 15 + (lin.length - 1) * 9 + (res ? 2 : 0)
    if (res) { fill(BG); doc.rect(M, y, R - M, alto, 'F'); draw(AZ); doc.setLineWidth(1); doc.line(M, y, R, y) } else if (sub) { draw(LN); doc.setLineWidth(0.7); doc.line(M, y, R, y) }
    const base = y + 11 + (res ? 1 : 0)
    lin.forEach((t, k) => txt(t, xl, base + k * 9, fs, bold, f.t === 'inf' ? MU : TX))
    ;(f.c || []).forEach((c0, i) => { const c = c0.replace(/−/g, '-'), neg = c.startsWith('-') && i < n + 1 && f.t !== 'it' && f.t !== 'inf', mut = i >= n + 1 || f.t === 'inf'   // helvetica del PDF no trae el signo «−»
      txt(c, xCol[i] - 4, base, 7, bold && i <= n && !mut, neg ? RJ : (mut ? MU : TX), 'right') })
    y += alto
  })
  y += 12; draw(LN); doc.setLineWidth(0.7); doc.line(M, y, R, y)
  txt('Resultado después de impuestos considera solo el PPM. Sin activo fijo no hay depreciación, por lo que el EBITDA es igual al EBIT.', M, y + 12, 7, false, MU)
  txt(nombre ? `${nombre}, ${d.emitido}` : d.emitido, R, H - 24, 7, false, MU, 'right')
}

/** Descarga el PDF. @param {DatosPdf} d @param {string} nombreArchivo */
export async function descargarEstadoResultadosPdf(d, nombreArchivo) {
  try {
    const { jsPDF } = await import('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm')
    const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' })
    let logo = null
    try { const r = await fetch(BRAND.logo.color); const bl = await r.blob(); logo = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(bl) }) } catch (_) { logo = null }
    dibujarEstadoResultados(doc, d, /** @type {string|null} */ (logo), BRAND.nombre || '')
    await entregarArchivo(doc.output('blob'), nombreArchivo)
  } catch (e) { appAlert('No se pudo generar el PDF: ' + (e && /** @type {any} */ (e).message || e)) }
}
