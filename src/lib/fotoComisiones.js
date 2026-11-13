// Imagen simple de comisiones para enviar (PNG, formato app): últimas pagadas y por pagar de un proveedor. Sin «sujeto a cobro».
// Recibe los ítems ya clasificados por la ficha; el recorte y las sumas salen de _shared/estadoComisiones.js. En iPhone abre la hoja de compartir.
import { BRAND, appAlert } from './base.jsx'
import { resumenReciente, pesos } from '../../supabase/functions/_shared/estadoComisiones.js'

const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
/** @param {string} nombre @param {Parameters<typeof resumenReciente>[0]} items @param {string} corte dd-mm-aaaa */
export async function descargarImagenComisiones(nombre, items, corte) {
  try {
    const r = resumenReciente(items, 6)
    const S = 2, W = 420, P = 14, HDR = 62, RH = 46, BD = 30
    const filas = (/** @type {number} */ n) => Math.max(1, n)
    const H = HDR + 12 + 62 + 12 + BD + filas(r.pagadas.length) * RH + 12 + BD + filas(r.porPagar.length) * RH + 12 + 34
    const cv = document.createElement('canvas'); cv.width = W * S; cv.height = H * S
    const g = cv.getContext('2d'); if (!g) throw new Error('canvas no disponible')
    g.scale(S, S); g.textBaseline = 'alphabetic'
    const F = (/** @type {number} */ w, /** @type {number} */ s) => `${w} ${s}px 'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif`
    const clip = (/** @type {string} */ t, /** @type {number} */ max, /** @type {number} */ w, /** @type {number} */ s) => { g.font = F(w, s); let x = String(t); while (x.length > 3 && g.measureText(x).width > max) x = x.slice(0, -2); return x === String(t) ? x : x.trimEnd() + '…' }
    const caja = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ w, /** @type {number} */ h, /** @type {string} */ fill) => { g.fillStyle = fill; g.beginPath(); g.roundRect(x, y, w, h, 10); g.fill() }
    g.fillStyle = '#F5F7F9'; g.fillRect(0, 0, W, H)
    g.fillStyle = '#003C50'; g.fillRect(0, 0, W, HDR)
    try { const logo = new Image(); logo.src = location.origin + BRAND.logo.blanco
      await Promise.race([new Promise((res, rej) => { logo.onload = res; logo.onerror = rej; if (logo.complete && logo.naturalWidth) res(undefined) }), new Promise((_, rej) => setTimeout(rej, 1500))])
      const lh = 20, lw = logo.naturalWidth && logo.naturalHeight ? logo.naturalWidth / logo.naturalHeight * lh : 130; g.drawImage(logo, P, (HDR - lh) / 2, lw, lh)
    } catch (_) { g.fillStyle = '#fff'; g.font = F(800, 15); g.fillText(BRAND.nombre || '', P, HDR / 2 + 5) }
    g.textAlign = 'right'; g.fillStyle = '#fff'; g.font = F(800, 13); g.fillText(clip(`COMISIONES ${nombre}`.toUpperCase(), 220, 800, 13), W - P, HDR / 2 - 2)
    g.fillStyle = '#9FC4DD'; g.font = F(600, 10); g.fillText(`Corte ${corte}`, W - P, HDR / 2 + 13); g.textAlign = 'left'
    let y = HDR + 12
    const cw = (W - 2 * P - 8) / 2
    ;[['Pagado reciente', r.totalPagadas], ['Por pagar', r.totalPorPagar]].forEach(([t, m], i) => {
      const x = P + i * (cw + 8); caja(x, y, cw, 62, '#fff'); g.strokeStyle = '#E4E8EB'; g.lineWidth = 1; g.beginPath(); g.roundRect(x, y, cw, 62, 10); g.stroke()
      g.strokeStyle = '#537281'; g.lineWidth = 1.5; g.beginPath(); g.arc(x + 17, y + 19, 6, 0, Math.PI * 2); g.stroke()
      g.beginPath(); if (i === 0) { g.moveTo(x + 14.5, y + 19.5); g.lineTo(x + 16.5, y + 21.5); g.lineTo(x + 20, y + 17) } else { g.moveTo(x + 17, y + 16); g.lineTo(x + 17, y + 19.5); g.lineTo(x + 19.5, y + 21) } g.stroke()
      g.fillStyle = '#537281'; g.font = F(700, 11); g.fillText(String(t), x + 29, y + 23)
      g.fillStyle = '#003C50'; g.font = F(800, 19); g.fillText(pesos(Number(m)), x + 12, y + 49) })
    y += 62 + 12
    const lista = (/** @type {string} */ tit, /** @type {number} */ tot, /** @type {typeof r.pagadas} */ rows, /** @type {boolean} */ conFecha) => {
      const h = BD + filas(rows.length) * RH
      caja(P, y, W - 2 * P, h, '#fff'); g.save(); g.beginPath(); g.roundRect(P, y, W - 2 * P, h, 10); g.clip()
      g.fillStyle = '#E4E8EB'; g.fillRect(P, y, W - 2 * P, BD)
      g.fillStyle = '#003C50'; g.font = F(800, 10.5); g.fillText(tit.toUpperCase(), P + 12, y + 19); g.textAlign = 'right'; g.fillText(pesos(tot), W - P - 12, y + 19); g.textAlign = 'left'
      if (!rows.length) { g.fillStyle = '#99ABB4'; g.font = F(600, 12); g.fillText('Sin comisiones por pagar', P + 12, y + BD + 28) }
      rows.forEach((it, i) => { const ry = y + BD + i * RH
        g.strokeStyle = '#F1EFE8'; g.lineWidth = 1; g.beginPath(); g.moveTo(P, ry); g.lineTo(W - P, ry); g.stroke()
        const m = String(it.fecha || '').match(/^(\d{4})-(\d{2})-(\d{2})/) || String(it.fecha || '').match(/^(\d{2})-(\d{2})-(\d{4})/)
        g.textAlign = 'center'; g.fillStyle = '#003C50'; g.font = F(800, 19)
        const iso = /^\d{4}/.test(String(it.fecha || ''))
        g.fillText(conFecha && m ? String(Number(iso ? m[3] : m[1])) : '—', P + 33, ry + 23); g.fillStyle = '#537281'; g.font = F(600, 10)
        g.fillText(conFecha && m ? `${MES[Number(m[2]) - 1]} ${String(iso ? m[1] : m[3]).slice(2)}` : 'cobrada', P + 33, ry + 37); g.textAlign = 'left'
        g.fillStyle = '#3D3D3D'; g.font = F(700, 13); g.fillText(clip(it.cliente, 190, 700, 13), P + 64, ry + 21)
        g.fillStyle = '#537281'; g.font = F(500, 11); g.fillText(clip(it.concepto, 190, 500, 11), P + 64, ry + 37)
        g.textAlign = 'right'; g.fillStyle = '#3D3D3D'; g.font = F(700, 13); g.fillText(pesos(it.monto), W - P - 12, ry + 29); g.textAlign = 'left' })
      g.restore(); y += h + 12 }
    lista('Últimas pagadas', r.totalPagadas, r.pagadas, true)
    lista('Por pagar', r.totalPorPagar, r.porPagar, false)
    g.fillStyle = '#99ABB4'; g.font = F(700, 10); g.textAlign = 'center'; g.fillText(BRAND.nombre || '', W / 2, H - 16); g.textAlign = 'left'
    const blob = await new Promise(res => cv.toBlob(res, 'image/png'))
    if (!blob) throw new Error('canvas vacío')
    const file = new File([blob], `comisiones_${String(nombre).replace(/\s+/g, '_')}.png`, { type: 'image/png' })
    if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: `Comisiones ${nombre}` }); return } catch (_) { /* si cancela, baja el archivo */ } }
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 400)
  } catch (e) { appAlert('No se pudo generar la imagen: ' + ((e && /** @type {any} */ (e).message) || e)) }
}
