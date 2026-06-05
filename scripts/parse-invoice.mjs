// Parser de facturas electrónicas SII (Liberona Escala Abogados).
// Extrae: folio, cliente (receptor), RUT receptor, fecha de emisión y total.
// Robusto a: texto duplicado (original + cedible) y a artefactos de markdown (\).
import { readFile } from 'node:fs/promises'

const MESES = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
  agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
}

export function parseInvoice(raw) {
  // Normaliza: quita backslashes de markdown y colapsa espacios.
  const t = raw.replace(/\\/g, '').replace(/ /g, ' ')

  // Folio: "Nº276" / "N°276"
  const folio = (t.match(/N[º°]\s*(\d+)/) || [])[1] || null

  // Fecha: "03 de Febrero del 2026" -> ISO. (no-global => toma la 1ª, ignora la copia)
  let issued_at = null, fechaTexto = null
  const fm = t.match(/Fecha Emision:\s*(\d{1,2})\s+de\s+([A-Za-zÁÉÍÓÚáéíóú]+)\s+del?\s+(\d{4})/i)
  if (fm) {
    const dia = +fm[1], mes = MESES[fm[2].toLowerCase()], anio = +fm[3]
    if (mes) {
      issued_at = `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
      fechaTexto = `${fm[1]} de ${fm[2]} del ${fm[3]}`
    }
  }

  // Cliente receptor + su RUT (anclado en SEÑOR(ES), así evita el RUT del emisor).
  const cm = t.match(/SEÑOR\(ES\):\s*(.+?)\s*R\.U\.T\.:\s*([\d.]+\s*-\s*[\dkK])/)
  const cliente = cm ? cm[1].trim() : null
  const rut = cm ? cm[2].replace(/\s+/g, '') : null

  // Total: "TOTAL $ 1.587.935" -> 1587935 (entero CLP). Toma el 1º (ignora copia).
  const tm = t.match(/TOTAL\s*\$\s*([\d.]+)/)
  const total = tm ? parseInt(tm[1].replace(/\./g, ''), 10) : null

  // Concepto/glosa (best-effort): texto entre el encabezado de la tabla y "Forma de Pago".
  let concepto = null
  const gm = t.match(/Valor\s*([\s\S]*?)\s*Forma de Pago/)
  if (gm) {
    concepto = gm[1].replace(/\s+/g, ' ').replace(/^[-\s]+/, '')
      .replace(/\s*1\s+[\d.]+\s+[\d.]+\s*$/, '').trim() || null
  }

  return { folio, cliente, rut, issued_at, fechaTexto, total, concepto }
}

// ── Runner de validación sobre los 5 fixtures ──
const fixtures = JSON.parse(await readFile(new URL('./invoice-fixtures.json', import.meta.url)))
let ok = 0
for (const { file, text } of fixtures) {
  const r = parseInvoice(text)
  const complete = r.folio && r.cliente && r.rut && r.issued_at && r.total
  if (complete) ok++
  console.log('─'.repeat(70))
  console.log('📄', file, complete ? '✅' : '⚠️ INCOMPLETO')
  console.log('   folio    :', r.folio)
  console.log('   cliente  :', r.cliente, '   RUT:', r.rut)
  console.log('   emisión  :', r.issued_at, `(${r.fechaTexto})`)
  console.log('   total    : $', r.total?.toLocaleString('es-CL'))
  console.log('   concepto :', r.concepto)
}
console.log('─'.repeat(70))
console.log(`RESULTADO: ${ok}/${fixtures.length} facturas parseadas completas`)
