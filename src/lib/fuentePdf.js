// DM Sans (la tipografía de la marca) en los PDF: jsPDF no usa la fuente de la página, así que se registran los pesos 400 y 600 desde /fonts.
// Si no se pueden cargar, los PDF siguen con helvetica (un PDF sin la fuente de la marca es mejor que ninguno).

/** @type {Promise<string[]>|null} */ let _cache = null
const aBase64 = (/** @type {ArrayBuffer} */ buf) => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, /** @type {any} */ (u.subarray(i, i + 0x8000))); return btoa(s) }

/** Registra DM Sans en `doc` (normal = 400, bold = 600) y devuelve el nombre de la fuente a usar. @param {any} doc @returns {Promise<string>} */
export async function registrarFuentePdf(doc) {
  try {
    if (!_cache) _cache = Promise.all(['400', '600'].map(async (w) => { const r = await fetch(`/fonts/DMSans-${w}.ttf`); if (!r.ok) throw new Error(`fuente ${w}: ${r.status}`); return aBase64(await r.arrayBuffer()) }))
    const [normal, negrita] = await _cache
    doc.addFileToVFS('DMSans-400.ttf', normal); doc.addFont('DMSans-400.ttf', 'DMSans', 'normal')
    doc.addFileToVFS('DMSans-600.ttf', negrita); doc.addFont('DMSans-600.ttf', 'DMSans', 'bold')
    return 'DMSans'
  } catch (_) { _cache = null; return 'helvetica' }
}
