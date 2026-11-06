// Foto del comprobante: la IA lee el comprobante (boleta, voucher, recibo, transferencia) y el formulario de gastos se rellena con lo leído.
// Aquí vive lo que no depende de la pantalla: el pedido a la IA y la validación de lo que devuelve. Lo dudoso queda vacío, nunca inventado;
// el gasto siempre lo confirma una persona en el formulario de siempre.
export const PROMPT_COMPROBANTE = `Eres asistente de una oficina de abogados en Chile. Lee este comprobante (boleta, factura, voucher de pago, recibo de transferencia o de aplicación de transporte) y responde SOLO un JSON, sin texto antes ni después:
{"monto": entero en pesos chilenos con el total pagado, o null,
 "fecha": "AAAA-MM-DD" o null,
 "proveedor": nombre de quien cobra, o null,
 "glosa": en qué consistió el pago, corto y en español, o null,
 "tipo": uno de ["Movilización","Notaria","CBR","Diario Oficial","Registro Civil","Archivo Judicial","Otro"] o null,
 "ot": número de OT, orden de trabajo o repertorio si aparece, o null}
Reglas: no inventes. Si un dato no se ve con claridad, pon null. El monto es el total final, sin puntos ni símbolo. Si la imagen no es un comprobante, responde {"monto":null,"fecha":null,"proveedor":null,"glosa":null,"tipo":null,"ot":null}.`

export const extraerJSON = texto => {
  const t = String(texto || '')
  const i = t.indexOf('{'), j = t.lastIndexOf('}')
  if (i < 0 || j <= i) return null
  try { return JSON.parse(t.slice(i, j + 1)) } catch (_) { return null }
}

const montoDe = m => {
  if (m == null || m === '') return null
  let n
  if (typeof m === 'number') n = Math.round(m)
  else {
    let s = String(m).replace(/[$\s]/g, '')
    if (/,\d{1,2}$/.test(s)) s = s.replace(/,\d{1,2}$/, '')        // 5.696,00 → 5.696
    n = parseInt(s.replace(/[^\d]/g, ''), 10)
  }
  return Number.isFinite(n) && n >= 1 && n <= 100000000 ? n : null
}

const fechaDe = (f, hoy) => {
  const s = String(f || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(s + 'T00:00:00')
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null
  const h = new Date(hoy + 'T00:00:00')
  const dias = (h - d) / 86400000
  return dias >= -1 && dias <= 400 ? s : null                     // ni del futuro ni de hace más de un año
}

// raw: lo que devolvió la IA. categorias: las del formulario. catDeTexto: la clasificación por glosa que ya usa el formulario.
export function normalizarLectura(raw, { hoy, categorias = [], catDeTexto = () => null } = {}) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const limpio = (v, max) => { const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); return s ? s.slice(0, max) : null }
  const proveedor = limpio(r.proveedor, 60), glosa = limpio(r.glosa, 90)
  let tipo = categorias.includes(r.tipo) ? r.tipo : null
  if (!tipo) { const c = catDeTexto([proveedor, glosa].filter(Boolean).join(' ')); if (c && categorias.includes(c) && c !== 'Otro') tipo = c }
  const ot = /^\d{3,10}$/.test(String(r.ot || '').trim()) ? String(r.ot).trim() : null
  const out = { monto: montoDe(r.monto), fecha: fechaDe(r.fecha, hoy), proveedor, glosa, tipo, ot }
  out.vacia = !out.monto && !out.fecha && !out.proveedor && !out.glosa
  return out
}

// Reduce la foto antes de mandarla (un celular saca 4–8 MB; con 1600 px de lado alcanza para leer un comprobante y viaja liviana).
export async function reducirImagen(file, maxPx = 1600, calidad = 0.82) {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => mal(new Error('No se pudo abrir la imagen')); i.src = url })
    const k = Math.min(1, maxPx / Math.max(img.width, img.height))
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
    return { media_type: 'image/jpeg', data: c.toDataURL('image/jpeg', calidad).split(',')[1] }
  } finally { URL.revokeObjectURL(url) }
}

export const archivoABase64 = file => new Promise((ok, mal) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = () => mal(new Error('No se pudo leer el archivo')); r.readAsDataURL(file) })
