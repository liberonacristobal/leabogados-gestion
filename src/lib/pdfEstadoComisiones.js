// PDF directo (sin ventana de impresión) del «Estado de comisiones»: carta, mismo contenido y orden que estadoComisionesHtml.
// Datos y agrupación salen de _shared/estadoComisiones.js; aquí solo se dibuja (jsPDF, helvetica).
import { BRAND, appAlert } from './base.jsx'
import { armarEstadoComisiones, mesTitulo, pesos, dmy } from '../../supabase/functions/_shared/estadoComisiones.js'

const AZ = [0, 60, 80], MU = [83, 114, 129], TX = [61, 61, 61], LN = [228, 232, 235], LN2 = [153, 171, 180]

/** @param {{proveedor:string, rut?:string, items:import('../../supabase/functions/_shared/estadoComisiones.js').ItemComision[], emitido:string}} a */
export async function descargarEstadoComisionesPdf({ proveedor, rut, items, emitido }) {
  try {
    const { jsPDF } = await import('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm')
    const doc = new jsPDF({ unit: 'pt', format: 'letter' })
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 50, R = W - M, BOT = H - 56
    const e = armarEstadoComisiones(items), T = e.totales
    const col = (/** @type {number[]} */ c) => doc.setTextColor(c[0], c[1], c[2])
    const draw = (/** @type {number[]} */ c) => doc.setDrawColor(c[0], c[1], c[2])
    const fill = (/** @type {number[]} */ c) => doc.setFillColor(c[0], c[1], c[2])
    const txt = (/** @type {string} */ t, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ s, /** @type {boolean} */ b, /** @type {number[]} */ c, /** @type {any} */ al) => { doc.setFont('helvetica', b ? 'bold' : 'normal'); doc.setFontSize(s); col(c); doc.text(String(t), x, y, al ? { align: al } : undefined) }
    const uno = (/** @type {string} */ t, /** @type {number} */ w, /** @type {number} */ s, /** @type {boolean} */ b) => { doc.setFont('helvetica', b ? 'bold' : 'normal'); doc.setFontSize(s); const l = doc.splitTextToSize(String(t), w)[0] || ''; return l === String(t) ? l : l.slice(0, -1).trimEnd() + '…' }
    let logo = null
    try { const r = await fetch(BRAND.logo.color); const bl = await r.blob(); logo = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(bl) }) } catch (_) { logo = null }
    // Encabezado
    let y = 50
    if (logo) { try { doc.addImage(/** @type {string} */ (logo), 'PNG', M, y - 6, 150, 150 * 91 / 600) } catch (_) { txt(BRAND.nombre || '', M, y + 10, 14, true, AZ) } } else txt(BRAND.nombre || '', M, y + 10, 14, true, AZ)
    txt('ESTADO DE COMISIONES', R, y + 6, 11, true, AZ, 'right'); txt(`Emitido el ${emitido}`, R, y + 19, 8.5, false, MU, 'right')
    y += 38; draw(AZ); doc.setLineWidth(1.2); doc.line(M, y, R, y)
    // Franja de datos
    const periodo = e.desde && e.hasta ? (e.desde.slice(0, 7) === e.hasta.slice(0, 7) ? mesTitulo(e.desde.slice(0, 7)) : `${mesTitulo(e.desde.slice(0, 7))} a ${mesTitulo(e.hasta.slice(0, 7))}`) : 'Sin pagos aún'
    const xs = [M, M + 235, M + 330]
    ;[['NOMBRE', proveedor], ['RUT', rut || '—'], ['PERÍODO', periodo]].forEach(([l, v], i) => { txt(l, xs[i], y + 14, 7, false, MU); txt(uno(v, i === 0 ? 225 : 180, 10, true), xs[i], y + 28, 10, true, AZ) })
    y += 38; draw(LN); doc.setLineWidth(0.8); doc.line(M, y, R, y); y += 14
    // Tarjetas
    const cw = (R - M - 20) / 3
    ;[['Pagado', T.pagado, 0], ['Por pagar', T.porPagar, 1], ['Sujeto a cobro', T.sujeto, 2]].forEach(([l, m, k], i) => {
      const x = M + i * (cw + 10); draw(LN); doc.setLineWidth(0.8); doc.roundedRect(x, y, cw, 46, 4, 4, 'S')
      fill(LN); doc.circle(x + 20, y + 23, 12, 'F'); draw(AZ); doc.setLineWidth(1.1)
      if (k === 0) { doc.line(x + 15, y + 23.5, x + 19, y + 27); doc.line(x + 19, y + 27, x + 26, y + 19) }
      else if (k === 1) { doc.line(x + 20, y + 17, x + 20, y + 23); doc.line(x + 20, y + 23, x + 24, y + 26) }
      else { doc.rect(x + 16, y + 16, 8, 14); doc.line(x + 18, y + 21, x + 22, y + 21); doc.line(x + 18, y + 25, x + 22, y + 25) }
      txt(String(l), x + 40, y + 19, 8, false, MU); txt(pesos(Number(m)), x + 40, y + 36, 14, true, AZ) })
    y += 46 + 14
    const salto = (/** @type {number} */ h) => { if (y + h > BOT) { doc.addPage(); y = 50 } }
    const titulo = (/** @type {string} */ t, /** @type {number} */ m) => { salto(60); txt(t, M, y + 8, 11, true, AZ); txt(pesos(m), R, y + 8, 11, true, AZ, 'right'); y += 18 }
    // 1. Pagadas
    if (e.meses.length) {
      titulo('1. Comisiones pagadas', T.pagado)
      const X = [M + 4, M + 112, M + 180]
      const cabX = () => { ['Mes', 'Fecha pago', 'Cliente', 'Concepto'].forEach((l, i) => txt(l.toUpperCase(), [X[0], X[1], X[2], M + 284][i], y + 8, 7, false, MU)); txt('MONTO', R - 4, y + 8, 7, false, MU, 'right'); draw(LN2); doc.setLineWidth(1); doc.line(M, y + 13, R, y + 13); y += 13 }
      cabX()
      for (const mes of e.meses) {
        const hG = Math.max(mes.filas.length * 15, 28)
        if (y + Math.min(hG, 45) > BOT) { doc.addPage(); y = 50; cabX() }
        let first = true, y0 = y
        for (const r of mes.filas) {
          if (y + 15 > BOT) { doc.addPage(); y = 50; cabX(); first = true; y0 = y }
          if (first) { draw(LN2); doc.setLineWidth(0.7); doc.line(M, y, R, y); txt(mesTitulo(mes.ym), X[0], y + 11, 9, true, AZ); txt(pesos(mes.total), X[0], y + 22, 8, false, MU); first = false }
          txt(dmy(r.fecha), X[1], y + 11, 9, false, TX); txt(uno(r.cliente, 98, 9, false), X[2], y + 11, 9, false, TX)
          txt(uno(r.concepto, R - 4 - 62 - (M + 284), 9, false), M + 284, y + 11, 9, false, TX); txt(pesos(r.monto), R - 4, y + 11, 9, false, TX, 'right')
          y += 15 }
        if (y - y0 < 28) y = y0 + 28
      }
      y += 6
    }
    const lista = (/** @type {string} */ t, /** @type {number} */ m, /** @type {typeof e.porPagar} */ rows) => {
      if (!rows.length) return
      titulo(t, m); const X = [M + 4, M + 150, M + 322], cb = () => { ['Cliente', 'Concepto', 'Estado'].forEach((l, i) => txt(l.toUpperCase(), X[i], y + 8, 7, false, MU)); txt('MONTO', R - 4, y + 8, 7, false, MU, 'right'); draw(LN2); doc.setLineWidth(1); doc.line(M, y + 13, R, y + 13); y += 13 }
      salto(40); cb()
      for (const r of rows) { if (y + 15 > BOT) { doc.addPage(); y = 50; cb() }
        draw(LN); doc.setLineWidth(0.5); doc.line(M, y, R, y)
        txt(uno(r.cliente, 138, 9, false), X[0], y + 11, 9, false, TX); txt(uno(r.concepto, 166, 9, false), X[1], y + 11, 9, false, TX); txt(uno(r.detalle || '', 130, 9, false), X[2], y + 11, 9, false, TX); txt(pesos(r.monto), R - 4, y + 11, 9, false, TX, 'right'); y += 15 }
      y += 8 }
    lista('2. Por pagar', T.porPagar, e.porPagar)
    lista('3. Sujetas a cobro', T.sujeto, e.sujeto)
    if (e.porPagar.length || e.sujeto.length) { salto(30); draw(AZ); doc.setLineWidth(1.2); doc.line(M, y + 4, R, y + 4); txt('Total comprometido (2 + 3)', M, y + 20, 10, false, AZ); txt(pesos(T.porPagar + T.sujeto), R, y + 20, 10, true, AZ, 'right') }
    // Pie con número de página
    const n = doc.getNumberOfPages()
    for (let p = 1; p <= n; p++) { doc.setPage(p); draw(LN); doc.setLineWidth(0.6); doc.line(M, H - 40, R, H - 40)
      txt(`${BRAND.nombre || ''}${BRAND.direccion ? ' · ' + BRAND.direccion : ''}`, M, H - 28, 7.5, false, MU); txt(`Página ${p} de ${n}`, R, H - 28, 7.5, false, MU, 'right') }
    doc.save(`estado_comisiones_${String(proveedor).replace(/[^\w]+/g, '_')}.pdf`)
  } catch (err) { appAlert('No se pudo generar el PDF: ' + ((err && /** @type {any} */ (err).message) || err)) }
}
