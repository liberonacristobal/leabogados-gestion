// Documentos firmados que envía la notaría: lectura del correo y cliente por la OT. Lo usa el edge notaria-documentos.

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const STOP = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'en', 'con', 'por', 'para', 'a', 'al', 'sin', 'copia', 'escritura', 'publica', 'documento', 'gastos', 'notariales'])
// Singular simple («mutuos» = «mutuo», «vehiculos» = «vehiculo») para que el plural de la glosa no impida el calce.
const raiz = w => w.length > 4 ? w.replace(/(es|s)$/, '') : w
const toks = s => norm(s).replace(/[^a-z0-9ñ ]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w)).map(raiz)

// Correo automático de la notaría (lo reenvía la asistente): «Se adjunta documento CONSTITUCION DE SOCIEDAD POR ACCIONES,
// correspondiente al repertorio 52157 con fecha 02-10-2026 firmado electronicamente … codigo de validacion 316-2026101413123242».
export function leerCorreoNotaria(texto) {
  const t = String(texto || '').replace(/\s+/g, ' ')
  const m = t.match(/se adjunta documento\s+(.+?),\s*correspondiente al repertorio\s+(\S+?)\s+con fecha\s+(\d{2})-(\d{2})-(\d{4})/i)
  const c = t.match(/c[oó]digo de validaci[oó]n\s+(\d{3}-\d{5,})/i)
  if (!m) return null
  const rep = /^n\/?a$/i.test(m[2]) ? null : m[2].replace(/[^\dA-Za-z-]/g, '')
  return { tipo: m[1].trim(), repertorio: rep || null, fecha: `${m[5]}-${m[4]}-${m[3]}`, codigo: c ? c[1] : null }
}

// ¿El correo lo firma la notaría? La firma (p. ej. «Mildred Gutiérrez», «Silvana Delgado») debe estar en el texto PROPIO del
// correo, antes de lo citado («De:», «El … escribió:»), para que un tercero que responde citando a la notaría no cuente.
export function firmadoPorNotaria(texto, firmas) {
  const t = String(texto || ''); const corte = t.search(/^\s*(>|De:|From:|-----\s*Original|El .{0,120}escribi[oó]:|On .{0,120}wrote:)/mi)
  const propio = norm(corte >= 0 ? t.slice(0, corte) : t)
  return (firmas || []).some(f => { const n = norm(f).trim(); return n.length >= 5 && propio.includes(n) })
}

// OT de la liquidación que corresponde al documento: misma fecha y el tipo de documento contenido en la glosa de la OT
// (al menos 2/3 de sus palabras, y todas si son dos o menos). Varias el mismo día (cinco prendas «sobre vehículos», «sobre
// acciones»…) → la que calza más palabras, si es una sola. Sin OT ese día → a ±3 días solo con TODAS las palabras (dos o más) y única.
const _dias = (a, b) => Math.round((new Date(a + 'T12:00') - new Date(b + 'T12:00')) / 864e5)
export function otParaDocumento(doc, ots) {
  if (!doc?.fecha || !doc?.tipo) return null
  const tt = [...new Set(toks(doc.tipo))]; if (!tt.length) return null
  const necesita = tt.length <= 2 ? tt.length : Math.ceil(tt.length * 2 / 3)
  const vivas = (ots || []).filter(o => !o.deleted_at && o.ot_number && o.date)
  const puntaje = o => { const ct = new Set(toks(`${o.concept || ''} ${o.materia || ''}`)); return tt.filter(w => ct.has(w)).length }
  const mismoDia = vivas.filter(o => String(o.date).slice(0, 10) === doc.fecha).map(o => ({ o, p: puntaje(o) })).filter(x => x.p >= necesita)
  if (mismoDia.length) { const max = Math.max(...mismoDia.map(x => x.p)), top = mismoDia.filter(x => x.p === max); return top.length === 1 ? top[0].o : null }
  if (tt.length < 2) return null   // «PODER» solo, a otra fecha, no basta
  const cerca = vivas.filter(o => Math.abs(_dias(String(o.date).slice(0, 10), doc.fecha)) <= 3 && puntaje(o) === tt.length)
  return cerca.length === 1 ? cerca[0] : null
}

// Nombre del archivo en Drive: la razón social primero (el usuario lo pidió así), luego el tipo, la fecha y el repertorio.
// «GESMAQ SPA» → «GESMAQ SpA». Sin tipo (borrador, matriz): la razón social y el nombre original, salvo que ya la traiga.
export const rsBonita = rs => String(rs || '').replace(/\s+/g, ' ').trim().replace(/\bSPA\b/g, 'SpA')
export function nombreArchivoNotaria(doc, ext = 'pdf', rs = '', original = '') {
  const R = rsBonita(rs)
  if (!doc?.tipo) { const base = String(original || 'Documento').replace(/\.[a-z0-9]+$/i, ''); const ya = R && norm(base).includes(norm(R)); return `${R && !ya ? `${R} - ` : ''}${base}.${ext}`.replace(/[\\/:*?"<>|]/g, '-') }
  const tipo = String(doc.tipo).toLowerCase().replace(/\s+/g, ' ').trim()
  const t = tipo.charAt(0).toUpperCase() + tipo.slice(1)
  const [y, m, d] = String(doc.fecha || '').split('-')
  return `${R ? `${R} - ` : ''}${t}${y ? ` - ${d}-${m}-${y}` : ''}${doc.repertorio ? ` - Rep ${doc.repertorio}` : ''}.${ext}`.replace(/[\\/:*?"<>|]/g, '-')
}
