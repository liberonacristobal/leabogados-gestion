// Foto descargable de una tabla (PNG con el encabezado del estudio, fecha de corte y secciones), con el mismo formato que la foto de «Resultado del año» de Inicio.
// Recibe filas ya calculadas por la vista (no calcula nada): { t:'sec'|'fila'|'tot', c:[texto, ...celdas] }. En iPhone abre la hoja de compartir.
import { BRAND, C, appAlert } from './base.jsx'

/** @param {{titulo:string, sub?:string, cols:string[], filas:{t:'sec'|'fila'|'tot', c:string[]}[], archivo:string}} a */
export async function descargarFotoTabla({ titulo, sub = '', cols, filas, archivo }) {
  try {
    const S = 2, W = 560, P = 16, HDR = 62, BAND = 30, RH = 26, TH = 28
    const H = HDR + BAND + 12 + TH + filas.length * RH + 14 + 30
    const cv = document.createElement('canvas'); cv.width = W * S; cv.height = H * S
    const g = cv.getContext('2d'); if (!g) throw new Error('canvas no disponible')
    g.scale(S, S); g.textBaseline = 'alphabetic'
    const F = (/** @type {number} */ w, /** @type {number} */ s) => `${w} ${s}px 'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif`
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H)
    g.fillStyle = '#003C50'; g.fillRect(0, 0, W, HDR)
    try { const logo = new Image(); logo.src = location.origin + BRAND.logo.blanco
      await Promise.race([new Promise((res, rej) => { logo.onload = res; logo.onerror = rej; if (logo.complete && logo.naturalWidth) res(undefined) }), new Promise((_, rej) => setTimeout(rej, 1500))])
      const lh = 20, lw = logo.naturalWidth && logo.naturalHeight ? logo.naturalWidth / logo.naturalHeight * lh : 130; g.drawImage(logo, P, (HDR - lh) / 2, lw, lh)
    } catch (_) { g.fillStyle = '#fff'; g.font = F(800, 15); g.fillText(BRAND.nombre || '', P, HDR / 2 + 5) }
    g.textAlign = 'right'; g.fillStyle = '#fff'; g.font = F(800, 13); g.fillText(titulo.toUpperCase(), W - P, HDR / 2 - 2)
    if (sub) { g.fillStyle = '#9FC4DD'; g.font = F(600, 10); g.fillText(sub, W - P, HDR / 2 + 13) }
    g.textAlign = 'left'
    const hoy = new Date(), dia = hoy.toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' }), hhmm = `${String(hoy.getHours()).padStart(2, '0')}:${String(hoy.getMinutes()).padStart(2, '0')}`
    g.fillStyle = '#E6F1FB'; g.fillRect(0, HDR, W, BAND)
    g.fillStyle = C.azulInfo; g.font = F(800, 11); g.fillText(`CORTE AL ${dia.toUpperCase()}`, P, HDR + BAND / 2 + 4)
    g.textAlign = 'right'; g.fillText(`${hhmm} HRS`, W - P, HDR + BAND / 2 + 4); g.textAlign = 'left'
    // columnas: la primera a la izquierda, el resto alineado a la derecha
    const nC = cols.length, w0 = nC > 4 ? 190 : 170, wc = (W - 2 * P - w0) / Math.max(1, nC - 1), xr = (/** @type {number} */ i) => P + w0 + wc * i
    let y = HDR + BAND + 12
    g.fillStyle = '#F5F7F9'; g.fillRect(P, y, W - 2 * P, TH)
    g.fillStyle = '#537281'; g.font = F(800, 9); g.fillText(cols[0].toUpperCase(), P + 8, y + 18)
    g.textAlign = 'right'; cols.slice(1).forEach((c, i) => g.fillText(c.toUpperCase(), xr(i + 1) - 8, y + 18)); g.textAlign = 'left'
    y += TH
    filas.forEach(f => {
      if (f.t === 'sec') { g.fillStyle = '#E6F1FB'; g.fillRect(P, y, W - 2 * P, RH); g.fillStyle = '#003C50'; g.font = F(800, 9.5); g.fillText(f.c[0].toUpperCase(), P + 8, y + 17) }
      else {
        const tot = f.t === 'tot'
        g.strokeStyle = tot ? '#003C50' : '#E4E8EB'; g.lineWidth = tot ? 1.5 : 1; g.beginPath(); g.moveTo(P, y); g.lineTo(W - P, y); g.stroke()
        g.fillStyle = tot ? '#003C50' : '#3D3D3D'; g.font = F(tot ? 800 : 600, 11); g.fillText(f.c[0], P + 8, y + 17)
        g.textAlign = 'right'; g.font = F(tot ? 800 : 700, 11)
        f.c.slice(1).forEach((c, i) => { g.fillStyle = String(c).startsWith('−') ? '#C0453F' : tot ? '#003C50' : '#3D3D3D'; g.fillText(c, xr(i + 1) - 8, y + 17) }); g.textAlign = 'left'
      }
      y += RH
    })
    g.fillStyle = '#99ABB4'; g.font = F(800, 9); g.fillText('DOCUMENTO INTERNO · ' + (BRAND.dominio || ''), P, H - 12); g.textAlign = 'right'; g.fillText((BRAND.nombre || '').toUpperCase(), W - P, H - 12); g.textAlign = 'left'
    const blob = await new Promise(res => cv.toBlob(res, 'image/png'))
    if (!blob) throw new Error('canvas vacío')
    const file = new File([blob], archivo, { type: 'image/png' })
    if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: titulo }); return } catch (_) { /* si cancela, baja el archivo */ } }
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 400)
  } catch (e) { appAlert('No se pudo generar la imagen: ' + ((e && /** @type {any} */ (e).message) || e)) }
}
