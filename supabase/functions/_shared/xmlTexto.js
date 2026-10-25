// xmlTexto.js — texto de un campo de un XML del SII tal como lo lee una persona. Fuente única (PDF de la factura y lectores).
// Los XML llegan escapados («BARRA &amp; STROBEL»); el PDF los imprimía tal cual. &amp; va al final para no decodificar dos veces.
export function desescaparXml(v) {
  return String(v ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}
