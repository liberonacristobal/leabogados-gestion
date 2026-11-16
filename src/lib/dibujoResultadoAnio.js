// Dibujo del documento «Resultado del año»: PDF (jsPDF, helvetica, hoja carta horizontal) e imagen para el celular (canvas 2D). Huincha azul con el logo blanco, cuatro cajas suaves
// en cuadrícula 2×2 (cada fila de bloques con el mismo alto), sin líneas: el orden lo dan el espacio, la letra y los fondos suaves (cajas y totales).
// Puro: recibe las cifras ya formateadas y el contexto de dibujo; sin dependencias, para poder probarlo sin navegador.

const AZ = [0, 60, 80], MU = [83, 114, 129], S3 = [153, 171, 180], TX = [61, 61, 61], NG = [185, 84, 78], TOT = [233, 239, 242], SOFT = [245, 248, 249]

/**
 * @typedef {{ s?: string, l: string, uf: string, clp: string, n?: number, t?: 'tot'|'mut', neg?: boolean }} FilaDoc  s = signo (+, −, =); uf y clp ya formateados; n = pesos (número, para la imagen en millones)
 * @typedef {{ t: string, pct: string, uf: string, clp: string, n?: number, filas: FilaDoc[] }} BloqueDoc  uf = «UF 11.145»; pct = «113 % de la meta»
 * @typedef {{ titulo: string, corte: string, bloques: BloqueDoc[], dominio: string }} DatosDoc
 */

/** Dibuja el PDF en `doc` (una página carta horizontal). Devuelve la y donde termina el último bloque. @param {any} doc @param {DatosDoc} d @param {string|null} logo logo blanco (PNG) @param {string} [nombre] @param {string} [fuente] */
export function dibujarResultadoAnio(doc, d, logo, nombre = '', fuente = 'helvetica') {
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 44, R = W - M, GAP = 20
  const col = (/** @type {number[]} */ c) => doc.setTextColor(c[0], c[1], c[2])
  const fill = (/** @type {number[]} */ c) => doc.setFillColor(c[0], c[1], c[2])
  const txt = (/** @type {string} */ t, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ s, /** @type {boolean} */ b, /** @type {number[]} */ c, /** @type {any} */ al) => { doc.setFont(fuente, b ? 'bold' : 'normal'); doc.setFontSize(s); col(c); doc.text(fuente === 'helvetica' ? String(t).replace(/−/g, '-') : String(t), x, y, al ? { align: al } : undefined) }

  // Huincha azul con el logo blanco y el título
  const BANDA = 66
  fill(AZ); doc.rect(0, 0, W, BANDA, 'F')
  if (logo) { try { doc.addImage(logo, 'PNG', M, 20, 150, 150 * 114 / 747) } catch (_) { txt(nombre, M, 40, 13, true, [255, 255, 255]) } } else txt(nombre, M, 40, 13, true, [255, 255, 255])
  txt(d.titulo, R, 31, 14, true, [255, 255, 255], 'right'); txt(d.corte, R, 45, 8, false, S3, 'right')
  let y = BANDA + 30

  // Cuadrícula 2×2 de cajas suaves: las dos de una fila comparten alto (el del bloque con más filas). El título va grande y a la altura de la cifra en UF.
  const cw = (R - M - GAP) / 2, CI = 16, HDR = 48, ALTO = 21
  const filasDe = (/** @type {number} */ i) => Math.max(d.bloques[i] ? d.bloques[i].filas.length : 0, d.bloques[i + 1] ? d.bloques[i + 1].filas.length : 0)
  /** @param {BloqueDoc} b @param {number} x @param {number} y0 @param {number} alto */
  const bloque = (b, x, y0, alto) => {
    fill(SOFT); doc.roundedRect(x, y0, cw, alto, 8, 8, 'F')
    const x1 = x + CI, w1 = cw - 2 * CI, yT = y0 + CI + 17
    txt(b.t, x1, yT, 15, true, AZ); txt(b.pct, x1, yT + 14, 8.5, false, S3)
    txt(b.uf, x1 + w1, yT, 22, true, AZ, 'right'); txt(b.clp, x1 + w1, yT + 15, 9.5, false, MU, 'right')
    const xUF = x1 + w1 - 104, xP = x1 + w1
    let yy = y0 + CI + HDR
    b.filas.forEach((f) => {
      const tot = f.t === 'tot', mut = f.t === 'mut', neg = !!f.neg
      if (tot) { fill(TOT); doc.roundedRect(x1 - 6, yy + 1, w1 + 12, ALTO - 2, 3, 3, 'F') }
      const base = yy + 14.5
      if (f.s) txt(f.s, x1 + 4, base, 10, true, neg ? NG : S3, 'center')
      txt(f.l, x1 + 16, base, 10, tot, neg ? NG : mut ? S3 : tot ? AZ : TX)
      txt(f.uf, xUF, base, 10, true, neg ? NG : mut ? MU : tot ? AZ : TX, 'right'); txt(f.clp, xP, base, 9.5, false, neg ? NG : MU, 'right')
      yy += ALTO
    })
  }
  let fin = y
  for (let i = 0; i < d.bloques.length; i += 2) {
    const alto = CI + HDR + filasDe(i) * ALTO + CI
    ;[d.bloques[i], d.bloques[i + 1]].forEach((b, k) => { if (b) bloque(b, M + k * (cw + GAP), y, alto) })
    y += alto + 18; fin = y - 18
  }

  // Pie
  txt('DOCUMENTO INTERNO', M, H - 24, 6.5, false, S3); txt(d.dominio, R, H - 24, 6.5, false, S3, 'right')
  return fin
}

// ── Imagen para el celular: cuatro cifras y la cascada del Resultado del ejercicio, en una sola pantalla ──
const mM = (/** @type {number} */ n) => '$' + (Math.abs(n || 0) / 1e6).toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + 'M'
const rgb = (/** @type {number[]} */ c) => `rgb(${c[0]},${c[1]},${c[2]})`
/** Filas de la cascada que van en la imagen: las del Resultado del ejercicio sin las notas en gris. @param {DatosDoc} d */
const cascadaImagen = (d) => (d.bloques[3] ? d.bloques[3].filas.filter((f) => f.t !== 'mut') : [])
const ANCHO_IMG = 390, BANDA_IMG = 64, FILA_IMG = 25, TILE_H = 96

/** Alto de la imagen del celular (390 px de ancho). @param {DatosDoc} d */
export function alturaImagenResultado(d) { return BANDA_IMG + 12 + 2 * TILE_H + 8 + 12 + 26 + cascadaImagen(d).length * FILA_IMG + 10 + 32 }

/** Dibuja la imagen en un contexto 2D ya escalado. @param {any} g @param {DatosDoc} d @param {any} logo imagen del logo blanco (o null) @param {string} [nombre] */
export function dibujarImagenResultado(g, d, logo, nombre = '') {
  const W = ANCHO_IMG, H = alturaImagenResultado(d), F = (/** @type {number} */ w, /** @type {number} */ s) => `${w} ${s}px 'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif`
  const caja = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ w, /** @type {number} */ h, /** @type {number} */ r, /** @type {number[]} */ c) => { g.fillStyle = rgb(c); g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); g.fill() }
  const t = (/** @type {string} */ s, /** @type {number} */ x, /** @type {number} */ y, /** @type {string} */ f, /** @type {number[]} */ c, /** @type {'left'|'right'} */ al = 'left') => { g.font = f; g.fillStyle = rgb(c); g.textAlign = al; g.fillText(s, x, y) }
  g.textBaseline = 'alphabetic'; g.fillStyle = '#fff'; g.fillRect(0, 0, W, H)
  g.fillStyle = rgb(AZ); g.fillRect(0, 0, W, BANDA_IMG)
  if (logo && logo.naturalWidth) g.drawImage(logo, 16, 20, 150, 150 * logo.naturalHeight / logo.naturalWidth); else t(nombre, 16, 38, F(600, 14), [255, 255, 255])
  t(d.titulo, W - 16, 30, F(600, 13), [255, 255, 255], 'right'); t(d.corte, W - 16, 45, F(400, 10), S3, 'right')
  // cuatro cifras en dos filas
  const tw = (W - 32) / 2
  d.bloques.slice(0, 4).forEach((b, i) => {
    const x = 12 + (i % 2) * (tw + 8), y = BANDA_IMG + 12 + Math.floor(i / 2) * (TILE_H + 8)
    caja(x, y, tw, TILE_H, 10, SOFT)
    t(b.t, x + 12, y + 22, F(600, 12.5), AZ); t(b.uf, x + 12, y + 48, F(600, 19), AZ)
    t(mM(b.n || 0), x + 12, y + 64, F(400, 11), MU); t(b.pct, x + 12, y + 80, F(400, 10), S3)
  })
  // cascada del Resultado
  let y = BANDA_IMG + 12 + 2 * TILE_H + 8 + 12
  t('DETALLE DEL RESULTADO', 16, y + 12, F(600, 10), MU); y += 26
  cascadaImagen(d).forEach((f) => {
    const tot = f.t === 'tot', neg = !!f.neg, c = neg ? NG : tot ? AZ : TX
    if (tot) caja(10, y, W - 20, FILA_IMG, 6, TOT)
    const base = y + 17
    if (f.s) t(f.s, 22, base, F(600, 12.5), neg ? NG : S3, 'left')
    t(f.l, 36, base, F(tot ? 600 : 400, 12.5), c); t(f.uf, W - 16 - 72, base, F(tot ? 700 : 500, 12.5), c, 'right'); t(mM(f.n || 0), W - 16, base, F(400, 11.5), neg ? NG : MU, 'right')
    y += FILA_IMG
  })
  t('DOCUMENTO INTERNO', 16, H - 12, F(400, 9), S3); t(d.dominio, W - 16, H - 12, F(400, 9), S3, 'right')
}
