// xmlTexto.js — texto de un campo de un XML del SII tal como lo lee una persona. Fuente única (PDF de la factura y lectores).
// Los XML llegan escapados («BARRA &amp; STROBEL»); el PDF los imprimía tal cual. &amp; va al final para no decodificar dos veces.
export function desescaparXml(v) {
  return String(v ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}

// Parte nueva de un correo: corta donde empieza lo citado («El vie, 16 oct 2026 a la(s) 18:16, X escribió:», «-----Mensaje
// original-----», «De: … Enviado:», líneas con «>»). Lo citado suele ser NUESTRO (una rendición con nuestra cuenta, una solicitud).
export function parteNuevaCorreo(texto) {
  const s = String(texto || '')
  const i = s.search(/(^|\n)[ \t]*(?:El\s+\S+,?\s+\d{1,2}\s+(?:de\s+)?\S+\.?\s+(?:de\s+)?\d{4}[\s\S]{0,160}?escribi[oó]:|On\s.{5,120}?wrote:|-{2,}\s*(?:Mensaje original|Original Message)|De:[^\n]*\n[ \t]*(?:Enviado|Fecha|Sent)[^\n]*:|>)/i)
  return (i >= 0 ? s.slice(0, i) : s).trim()
}
