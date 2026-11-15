// Entrega de archivos generados en el navegador (PDF, Excel) y estándar de planilla de la oficina.
// En teléfono se comparte el archivo mismo (sin texto ni enlace «blob:»); en escritorio se descarga.

/** @param {Blob} blob @param {string} nombre */
export async function entregarArchivo(blob, nombre) {
  try {
    const tactil = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
    const file = new File([blob], nombre, { type: blob.type })
    if (tactil && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return } catch (e) { if (e && /** @type {any} */ (e).name === 'AbortError') return }
    }
  } catch (_) { /* sin compartir: baja el archivo */ }
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000)
}

const AZUL1 = '003C50'
const TIPO = 'Aptos Light'

/** Carga la librería de Excel con estilos (la misma en toda la app). */
export const cargarXlsx = () => import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/+esm').then(m => /** @type {any} */ (m.default || m))

const yaDisenada = (/** @type {any} */ ws) => Object.keys(ws).some(k => k[0] !== '!' && ws[k] && ws[k].s)

/** Estándar de planilla LEA: columna A de margen, zoom 140 %, encabezado AZUL 1 con letra blanca, totales en negrita, letra uniforme. @param {any} XLSX @param {any} ws */
function estilizarHoja(XLSX, ws) {
  if (!ws || !ws['!ref']) return
  if (yaDisenada(ws)) return   // hoja que ya trae su propio diseño
  const rg = XLSX.utils.decode_range(ws['!ref']), nuevo = /** @type {any} */ ({})
  const conFormula = Object.keys(ws).some(k => k[0] !== '!' && ws[k] && ws[k].f)
  Object.keys(ws).forEach(k => { if (k[0] === '!') return; const c = XLSX.utils.decode_cell(k); nuevo[XLSX.utils.encode_cell({ r: c.r, c: c.c + (conFormula ? 0 : 1) })] = ws[k] })
  const dc = conFormula ? 0 : 1
  rg.e.c += dc; nuevo['!ref'] = XLSX.utils.encode_range(rg)
  if (ws['!cols']) nuevo['!cols'] = dc ? [{ wch: 3 }, ...ws['!cols']] : ws['!cols']; else if (dc) nuevo['!cols'] = [{ wch: 3 }]
  if (ws['!merges']) nuevo['!merges'] = ws['!merges'].map((/** @type {any} */ m) => ({ s: { r: m.s.r, c: m.s.c + dc }, e: { r: m.e.r, c: m.e.c + dc } }))
  if (ws['!autofilter']) { const f = XLSX.utils.decode_range(ws['!autofilter'].ref); f.s.c += dc; f.e.c += dc; nuevo['!autofilter'] = { ref: XLSX.utils.encode_range(f) } }
  for (let r = rg.s.r; r <= rg.e.r; r++) {
    const primero = Object.keys(nuevo).filter(k => k[0] !== '!').map(k => XLSX.utils.decode_cell(k)).filter((/** @type {any} */ c) => c.r === r).sort((/** @type {any} */ a, /** @type {any} */ b) => a.c - b.c)[0]
    const esTotal = primero && /^total/i.test(String(nuevo[XLSX.utils.encode_cell(primero)].v || ''))
    for (let c = rg.s.c; c <= rg.e.c; c++) {
      const dir = XLSX.utils.encode_cell({ r, c }), cel = nuevo[dir]
      if (c < 1 && dc) continue
      if (!cel) { if (r === 0) nuevo[dir] = { t: 's', v: '', s: { fill: { patternType: 'solid', fgColor: { rgb: AZUL1 } } } }; continue }
      cel.s = r === 0
        ? { font: { name: TIPO, sz: 10, bold: true, color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: AZUL1 } }, alignment: { vertical: 'center', wrapText: true, horizontal: c > 1 && cel.t !== 's' ? 'right' : undefined } }
        : { font: { name: TIPO, sz: 10, bold: !!esTotal, color: { rgb: '000000' } } }
    }
  }
  Object.keys(ws).forEach(k => delete ws[k]); Object.assign(ws, nuevo)
}

/** La librería no escribe la vista de la hoja: se ajusta en el archivo (zoom 140 %, sin cuadrícula, primera fila fija). @param {ArrayBuffer} buf */
async function vistaLEA(buf) {
  const JSZip = /** @type {any} */ ((await import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm')).default)
  const zip = await JSZip.loadAsync(buf)
  const vista = '<sheetView showGridLines="0" zoomScale="140" zoomScaleNormal="140" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView>'
  await Promise.all(Object.keys(zip.files).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).map(async n => { const x = await zip.file(n).async('string'); zip.file(n, x.replace(/<sheetView workbookViewId="0"\/>/, vista)) }))
  return zip.generateAsync({ type: 'arraybuffer' })
}

/** Guarda el libro con el estándar LEA y lo entrega (descarga en escritorio, compartir en teléfono). @param {any} XLSX @param {any} wb @param {string} nombre @param {{ estilo?: boolean }} [op] */
export async function guardarLibro(XLSX, wb, nombre, op = {}) {
  if (op.estilo !== false) wb.SheetNames.forEach((/** @type {string} */ n) => estilizarHoja(XLSX, wb.Sheets[n]))
  let out = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true })
  if (op.estilo !== false) { try { out = await vistaLEA(out) } catch (_) { /* queda sin zoom, el archivo sigue válido */ } }
  await entregarArchivo(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nombre)
}
