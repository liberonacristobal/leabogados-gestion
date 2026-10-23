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

// ── Sugerencias de cliente para un documento por asignar (FUENTE ÚNICA: edge notaria-documentos y Notaría › Documentos).
// Cada sugerencia trae su motivo; la app propone y una persona confirma (lo confirmado se aprende en learnings notaria_parte).
// Fuentes, de más a menos fuerte: mismo repertorio que un documento ya clasificado · mismo correo (hilo) · OT libre del tipo y
// fecha (una OT que ya tiene su documento no cuenta) · lectura con IA (RUT/comparecientes) · nombre de las partes en el archivo ·
// repertorio vecino de documentos ya en la carpeta de un cliente. «auto» = se asigna sin preguntar (solo OT libres de un único cliente).
const GEN = new Set(['spa', 'ltda', 'limitada', 'sa', 'eirl', 'cia', 'compania', 'inversiones', 'inversion', 'sociedad', 'asesorias', 'servicios', 'otros', 'otra', 'otro', 'group', 'grupo', 'holding', 'capital', 'chile', 'consultores', 'asociados', 'empresa', 'comercial', 'sucesion', 'familia', 'banco', 'estado'])
const tokNom = s => norm(s).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !STOP.has(w) && !GEN.has(w))
const repsEnTexto = t => [...String(t || '').matchAll(/rep(?:ertorio)?\.?\s*n?[°º]?\s*(\d{4,6})/gi)].map(m => m[1])
export function repertoriosDoc(doc) { return [...new Set([doc?.repertorio, ...repsEnTexto(doc?.tipo_documento), ...repsEnTexto(doc?.archivo_nombre), ...repsEnTexto(doc?.asunto)].filter(Boolean).map(String))] }
// Nombres que identifican a un cliente: su nombre, sus razones sociales y sus contactos de 2+ palabras; y lo aprendido.
export function indiceNombres(clients, entities, contacts, aprendidos) {
  const out = []
  const add = (cid, nm, fuente) => { const t = tokNom(nm); if (t.length && cid) out.push({ cid: String(cid), nm, t, fuente }) }
  ;(clients || []).filter(c => !c.is_internal && !c.is_colaborador).forEach(c => add(c.id, c.name, 'cliente'))
  ;(entities || []).forEach(e => add(e.client_id, e.name, 'rs'))
  ;(contacts || []).filter(c => tokNom(c.nombre).length >= 2).forEach(c => add(c.client_id, c.nombre, 'contacto'))
  ;(aprendidos || []).forEach(a => add(a.value, a.key, 'aprendido'))
  return out
}
// Un nombre calza si están sus dos primeras palabras distintivas (o la única, si es larga) en el texto.
export function clientesEnTexto(texto, indice) {
  const T = new Set(tokNom(texto)); const hits = new Map()
  for (const k of indice) {
    const ok = k.t.length >= 2 ? (T.has(k.t[0]) && T.has(k.t[1])) : (k.t[0].length >= 6 && T.has(k.t[0]))
    if (ok && !hits.has(k.cid)) hits.set(k.cid, k)
  }
  return [...hits.values()]
}
function _cands(doc, ots, usadas, dias) {
  const tt = [...new Set(toks(doc.tipo_documento))]; if (!tt.length || !doc.fecha_documento) return []
  const necesita = tt.length <= 2 ? tt.length : Math.ceil(tt.length * 2 / 3)
  const f = String(doc.fecha_documento).slice(0, 10)
  return (ots || []).filter(o => !o.deleted_at && o.ot_number && o.date && o.client_id && !usadas.has(String(o.ot_number)) && Math.abs(_dias(String(o.date).slice(0, 10), f)) <= dias)
    .filter(o => { const ct = new Set(toks(`${o.concept || ''} ${o.materia || ''}`)); return tt.filter(w => ct.has(w)).length >= necesita })
}
export function sugerenciasDocumento(doc, { ots = [], usadas = new Set(), indice = [], clasificados = [], porRut = {} } = {}) {
  const sug = new Map(), put = (cid, s) => { cid = String(cid || ''); if (cid && !sug.has(cid)) sug.set(cid, { client_id: cid, ...s }) }
  // La publicación del Diario Oficial (edge diario-oficial) trae el RUT de la sociedad del extracto: si es la razón social de un
  // cliente, ese es el cliente. porRut = RUT sin puntos ni guion → client_id (fichas y razones sociales).
  const rutDO = String(doc.do_publicacion?.rut || '').replace(/[^0-9kK]/g, '').toUpperCase()
  if (rutDO.length >= 7 && porRut[rutDO]) put(porRut[rutDO], { fuente: 'diario_oficial', motivo: 'RUT publicado en el Diario Oficial' })
  const reps = repertoriosDoc(doc)
  const conRep = clasificados.filter(c => c.cliente_id && reps.length && repertoriosDoc(c).some(r => reps.includes(r)))
  if (new Set(conRep.map(c => String(c.cliente_id))).size === 1) put(conRep[0].cliente_id, { fuente: 'repertorio', motivo: `Mismo repertorio (${reps[0]}) que un documento ya en su carpeta` })
  const hilo = clasificados.filter(c => c.cliente_id && doc.thread_id && c.thread_id === doc.thread_id)
  if (new Set(hilo.map(c => String(c.cliente_id))).size === 1) put(hilo[0].cliente_id, { fuente: 'hilo', motivo: 'Mismo correo que un documento ya en su carpeta' })
  let auto = null
  for (const d of [0, 3]) {
    const c = _cands(doc, ots, usadas, d); const cli = [...new Set(c.map(o => String(o.client_id)))]
    if (cli.length === 1) { auto = cli[0]; put(cli[0], { fuente: 'ot', motivo: c.length === 1 ? `OT ${c[0].ot_number} del mismo tipo y fecha` : `${c.length} OT del mismo tipo y fecha, del mismo cliente`, ot: c.length === 1 ? c[0] : null }); break }
    if (cli.length > 1) { c.forEach(o => put(o.client_id, { fuente: 'ot', motivo: `OT ${o.ot_number} · ${String(o.date).slice(0, 10).split('-').reverse().join('-')}`, ot: o })); break }
  }
  if (doc.sugerencia?.client_id && doc.sugerencia?.fuente === 'ia') put(doc.sugerencia.client_id, { fuente: 'ia', motivo: doc.sugerencia.motivo || 'Leído en el documento' })
  const partes = clientesEnTexto(`${doc.archivo_nombre || ''} ${doc.asunto || ''}`.replace(/[._-]+/g, ' '), indice)
  if (partes.length === 1 || partes.length === 2) partes.forEach(k => put(k.cid, { fuente: 'partes', motivo: `"${k.nm}" en el ${/\.\w+$/.test(doc.archivo_nombre || '') && tokNom(doc.archivo_nombre).some(t => k.t.includes(t)) ? 'archivo' : 'asunto'}` }))
  if (!sug.size && reps.length) {
    const r = Number(reps[0]); const vec = clasificados.filter(c => c.cliente_id && repertoriosDoc(c).some(x => Math.abs(Number(x) - r) <= 15))
    const cli = [...new Set(vec.map(c => String(c.cliente_id)))]
    if (cli.length === 1) { const rs = vec.flatMap(repertoriosDoc).map(Number).filter(x => Math.abs(x - r) <= 15).sort((a, b) => a - b); put(cli[0], { fuente: 'vecinos', motivo: rs[0] === rs[rs.length - 1] ? `Repertorio vecino ya en su carpeta (${rs[0]})` : `Repertorios vecinos ya en su carpeta (${rs[0]}–${rs[rs.length - 1]})` }) }
  }
  return { sugerencias: [...sug.values()], auto: auto && sug.size === 1 ? auto : null }
}

// Cliente desde la lectura con IA de un escaneado (fuente única: edge notaria-documentos). Primero RUT exacto (de una sociedad o de
// una persona); si no, nombre, pero comparando cada compareciente POR SEPARADO (dos palabras del cliente en la misma persona) y
// descartando notarios, testigos y a la gente de la oficina (que comparecen como testigos o solicitantes). Nombre de una sola palabra
// solo cuenta contra una razón social, nunca contra el nombre de una persona.
export function clienteDeLectura(lec, { indice = [], porRut = {}, excluir = [] } = {}) {
  const rutN = r => String(r || '').replace(/[^0-9kK]/g, '').toUpperCase()
  const fuera = new Set((excluir || []).map(x => norm(x).replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean))
  const esOficina = n => { const t = norm(n).replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim(); return [...fuera].some(f => f && (t.includes(f) || f.split(' ').filter(w => w.length > 3).every(w => t.includes(w)))) }
  const personas = (lec?.comparecientes || []).filter(p => p?.nombre && !/notari|testig|suplente|oficial/i.test(p.calidad || '') && !esOficina(p.nombre))
  const socs = (lec?.sociedades || []).filter(s => s?.razon_social)
  const ruts = [...personas, ...socs].map(x => rutN(x.rut)).filter(r => r.length >= 7)
  const porR = [...new Set(ruts.map(r => porRut[r]).filter(Boolean))]
  if (porR.length === 1) return { client_id: porR[0], fuente: 'ia', motivo: 'RUT en la comparecencia' }
  const hits = new Set()
  for (const s of socs) clientesEnTexto(s.razon_social, indice).forEach(k => hits.add(k.cid))
  for (const p of personas) { const T = new Set(tokNom(p.nombre)); indice.filter(k => k.t.length >= 2 && T.has(k.t[0]) && T.has(k.t[1])).forEach(k => hits.add(k.cid)) }
  return hits.size === 1 ? { client_id: [...hits][0], fuente: 'ia', motivo: 'Nombre en la comparecencia' } : null
}
