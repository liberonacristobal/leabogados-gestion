// PDF directo (sin ventana de impresión) del documento «Resultado del año»: hoja carta horizontal con cuatro bloques
// (Vendido neto, Facturado, Cobrado propio, Resultado del ejercicio), cifras en UF y pesos. No calcula nada: recibe las cifras ya formateadas por la vista
// (una sola fuente) y solo las dibuja (dibujoResultadoAnio.js). Aquí solo va la descarga.
import { BRAND, appAlert } from './base.jsx'
import { entregarArchivo } from './archivos.js'
import { dibujarResultadoAnio } from './dibujoResultadoAnio.js'

/** Descarga el PDF. @param {DatosDoc} d @param {string} nombreArchivo */
export async function descargarResultadoAnioPdf(d, nombreArchivo) {
  try {
    const { jsPDF } = await import('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm')
    const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' })
    let logo = null
    try { const r = await fetch(BRAND.logo.blanco); const bl = await r.blob(); logo = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(bl) }) } catch (_) { logo = null }
    dibujarResultadoAnio(doc, d, /** @type {string|null} */ (logo), BRAND.nombre || '')
    await entregarArchivo(doc.output('blob'), nombreArchivo)
  } catch (e) { appAlert('No se pudo generar el PDF: ' + (e && /** @type {any} */ (e).message || e)) }
}
