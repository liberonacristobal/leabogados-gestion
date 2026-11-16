// Dibujo del PDF «Resultado del año» (jsPDF, helvetica): hoja carta vertical, estado corrido con cuatro bloques. Puro: recibe las cifras ya formateadas y el `doc`; sin dependencias, para poder probarlo sin navegador.

const AZ = [0, 60, 80], MU = [83, 114, 129], S3 = [153, 171, 180], TX = [61, 61, 61], LN = [228, 232, 235], BG = [245, 247, 249], RJ = [162, 45, 45], VD = [15, 110, 86], VDB = [225, 245, 238]

/**
 * @typedef {{ s?: string, l: string, uf: string, clp: string, t?: 'it'|'tot'|'mut', neg?: boolean, chip?: string }} FilaDoc  s = signo (+, −, =); uf y clp ya formateados; chip = margen bajo la etiqueta
 * @typedef {{ t: string, chip: string, gris?: boolean, filas: FilaDoc[] }} GrupoDoc
 * @typedef {{ t: string, uf: string, clp: string }} CifraDoc
 * @typedef {{ titulo: string, corte: string, cifras: CifraDoc[], grupos: GrupoDoc[], notas: string[], dominio: string }} DatosDoc
 */

/** Dibuja el documento en `doc` (una página carta vertical). Separado de la descarga para poder probarlo sin navegador. @param {any} doc @param {DatosDoc} d @param {string|null} logo @param {string} [nombre] */
export function dibujarResultadoAnio(doc, d, logo, nombre = '') {
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 40, R = W - M
  const col = (/** @type {number[]} */ c) => doc.setTextColor(c[0], c[1], c[2])
  const draw = (/** @type {number[]} */ c) => doc.setDrawColor(c[0], c[1], c[2])
  const fill = (/** @type {number[]} */ c) => doc.setFillColor(c[0], c[1], c[2])
  const txt = (/** @type {string} */ t, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ s, /** @type {boolean} */ b, /** @type {number[]} */ c, /** @type {any} */ al) => { doc.setFont('helvetica', b ? 'bold' : 'normal'); doc.setFontSize(s); col(c); doc.text(String(t).replace(/−/g, '-'), x, y, al ? { align: al } : undefined) }
  const raya = (/** @type {number} */ y, /** @type {number[]} */ c, /** @type {number} */ g) => { draw(c); doc.setLineWidth(g); doc.line(M, y, R, y) }
  const chip = (/** @type {string} */ t, /** @type {number} */ xR, /** @type {number} */ y, /** @type {boolean|undefined} */ gris, /** @type {'right'|'left'} */ lado = 'right') => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5)
    const w = doc.getTextWidth(t) + 12, x = lado === 'right' ? xR - w : xR
    fill(gris ? LN : VDB); doc.roundedRect(x, y - 8.5, w, 12, 6, 6, 'F'); txt(t, x + 6, y, 6.5, true, gris ? MU : VD)
  }

  // Encabezado
  let y = 40
  if (logo) { try { doc.addImage(logo, 'PNG', M, y - 6, 130, 130 * 91 / 600) } catch (_) { txt(nombre, M, y + 10, 13, true, AZ) } } else txt(nombre, M, y + 10, 13, true, AZ)
  txt(d.titulo, R, y + 4, 13, true, AZ, 'right'); txt(d.corte, R, y + 17, 8, false, MU, 'right')
  y += 34; raya(y, AZ, 1.5); y += 12

  // Franja de cuatro cifras (sin cajas): etiqueta, UF y pesos en millones
  const n = d.cifras.length, cw = (R - M) / n
  d.cifras.forEach((c, i) => { const x = M + i * cw; txt(c.t.toUpperCase(), x, y + 7, 6.5, true, AZ); txt(c.uf, x, y + 24, 15, true, AZ); txt(c.clp, x, y + 36, 8, false, MU) })
  y += 46; raya(y, LN, 0.7); y += 10

  // Columnas: signo, concepto, UF y pesos
  const xUF = R - 96, xP = R
  txt('CIFRAS EN UF Y PESOS', M + 16, y + 6, 6.5, true, S3); txt('UF', xUF, y + 6, 6.5, true, S3, 'right'); txt('PESOS', xP, y + 6, 6.5, true, S3, 'right'); y += 10

  // Bloques
  // Alto de fila: 17 pt, y se achica solo (hasta 13,5) si hay más filas (varios años de ventas) para que todo quede antes del pie.
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
  const lineasNotas = d.notas.reduce((a, t) => a + /** @type {string[]} */ (doc.splitTextToSize(t, R - M)).length, 0)
  const nFilas = d.grupos.reduce((a, g) => a + g.filas.length, 0), nChip = d.grupos.reduce((a, g) => a + g.filas.filter((f) => f.chip).length, 0)
  const fijo = y + d.grupos.length * 23 + 21 + lineasNotas * 9   // lo que ya se dibujó (encabezado, cifras, columnas), los títulos de bloque y las notas
  const alto = Math.min(17, Math.max(13.5, (H - 48 - fijo - nChip * 12) / Math.max(1, nFilas)))
  d.grupos.forEach((g) => {
    y += 6; fill(BG); doc.rect(M, y, R - M, 17, 'F'); raya(y, AZ, 1)
    txt(g.t.toUpperCase(), M + 6, y + 11.5, 7.5, true, AZ); chip(g.chip, R - 6, y + 12, g.gris)
    y += 17
    g.filas.forEach((f) => {
      const tot = f.t === 'tot', mut = f.t === 'mut', neg = !!f.neg, h = alto + (f.chip ? 12 : 0)
      raya(y, tot ? AZ : LN, tot ? 0.8 : 0.5)
      const base = y + 12, ink = neg ? RJ : mut ? MU : AZ
      if (f.s) txt(f.s, M + 8, base, 9, true, neg ? RJ : AZ, 'center')
      txt(f.l, M + 16, base, 9, tot, tot ? AZ : mut ? MU : TX)
      if (f.chip) chip(f.chip, M + 16, base + 12, false, 'left')
      txt(f.uf, xUF, base, 9, true, ink, 'right'); txt(f.clp, xP, base, 9, tot, neg ? RJ : tot ? AZ : MU, 'right')
      y += h
    })
  })

  // Notas
  y += 12; txt('NOTAS', M, y, 6.5, true, AZ); y += 9
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); col(MU)
  d.notas.forEach((t) => { /** @type {string[]} */ (doc.splitTextToSize(t, R - M)).forEach((l) => { doc.text(l, M, y); y += 9 }) })

  // Pie
  raya(H - 36, LN, 0.7)
  txt(`DOCUMENTO INTERNO, ${d.dominio}`, M, H - 24, 6.5, true, S3); txt('Página 1 de 1', R, H - 24, 6.5, true, S3, 'right')
  return y
}
