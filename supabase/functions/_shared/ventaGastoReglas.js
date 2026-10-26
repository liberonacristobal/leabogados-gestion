// Regla ÚNICA para sugerir el trabajo (venta) de un gasto: carga de gastos, carga de la notaría, Sin asignar y la revisión con IA.
// El vínculo real es expenses.sale_id (project es solo el texto). Se vincula sola solo cuando no hay duda; lo demás se propone.
const _normTxt = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const _norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

// Ventas que pueden recibir gastos (no Propuesta/Rechazada/Borrador).
export const VENTA_REAL = s => !!s && !s.deleted_at && !['Propuesta', 'Rechazada', 'Borrador'].includes(s.status)
// Clave de glosa para aprender gasto→trabajo: palabras de 4 letras o más, ordenadas (independiente del orden).
export const glosaKey = s => _normTxt(s).split(' ').filter(w => w.length >= 4).slice(0, 5).sort().join(' ')

const _STOP_TRAB = new Set(['gastos', 'gasto', 'notariales', 'notarial', 'notaria', 'para', 'sobre', 'desde', 'spa', 'ltda', 'limitada', 'sociedad', 'acciones', 'anonima', 'asesoria', 'legal', 'legales', 'servicios', 'permanente', 'provision', 'fondos', 'fondo', 'conciliacion', 'bancaria', 'copia', 'copias', 'certificado', 'autorizacion', 'poder', 'especial', 'mandato', 'escritura', 'publica', 'protocolizacion', 'documentos', 'contrato', 'grupo', 'trabajo', 'varios', 'cliente', 'cuota', 'reduccion', 'junta', 'extraordinaria', 'accionistas', 'socios'])
export const toksTrab = s => _norm(s).split(/[^a-z0-9]+/).filter(t => t.length >= 4 && !_STOP_TRAB.has(t)).map(t => t.slice(0, 5))
// Glosa genérica = solo palabras de trámite («Gastos notariales — Mandato judicial amplio»): se repite en todos los trabajos.
const _TRAMITE = new Set(['judicial', 'amplio', 'domicilio', 'comercial', 'finiquito', 'vigencia', 'vigente', 'firma', 'legalizacion', 'inscripcion', 'extracto', 'publicacion', 'carta', 'certificada', 'declaracion', 'jurada', 'otros', 'otro'])
export const glosaGenerica = s => toksTrab(s).filter(t => !_TRAMITE.has(t) && ![..._TRAMITE].some(w => w.slice(0, 5) === t)).length === 0

// Lo aprendido (learnings gasto_proyecto, key `${client_id}::${glosaKey}`): value = título del trabajo; meta.sale_id y
// meta.entity_id en lo nuevo. Si el gasto tiene razón social y hay aprendizajes con razón social, cuentan solo los de esa razón
// social; con una glosa genérica, SOLO esos (sin razón social no dice nada del trabajo). Vale si TODAS las decisiones apuntan al
// mismo trabajo (si alguna vez fue a otro, no se sugiere).
export function ventaAprendida(e, ventas = [], aprendidos = []) {
  const gk = glosaKey(e?.concept || ''); if (!gk || !e?.client_id) return null
  let rows = (aprendidos || []).filter(r => r && r.key === `${e.client_id}::${gk}`)
  const gen = glosaGenerica(e.concept)
  if (e.entity_id) { const conRs = rows.filter(r => r.meta?.entity_id); if (conRs.length || gen) rows = conRs.filter(r => String(r.meta.entity_id) === String(e.entity_id)) }
  else if (gen) return null
  const porTitulo = t => { const n = _norm(t); return n ? ventas.filter(s => _norm(s.title) === n) : [] }
  const ids = rows.map(r => { const byId = r.meta?.sale_id && ventas.find(s => String(s.id) === String(r.meta.sale_id)); if (byId) return String(byId.id); const t = porTitulo(r.value); return t.length === 1 ? String(t[0].id) : null })
  if (!ids.length || ids.some(x => !x)) return null
  const unicos = [...new Set(ids)]; if (unicos.length !== 1) return null
  return { venta: ventas.find(s => String(s.id) === unicos[0]), n: ids.length }
}

// Sugerencia. ctx = { aprendidos (learnings gasto_proyecto), hermanos (gastos del cliente con trabajo) }.
// Orden: aprendido → única venta → única activa → mismo día (otro gasto del cliente de esa fecha y razón social ya tiene trabajo)
// → texto. auto=true solo en aprendido (2+), única y única activa. Sin regla por razón social (la de facturación no es la de la
// OT) ni por «única vigente en la fecha»: en la prueba contra lo ya asignado (25-10-2026) acertaban 1 de 4 y 2 de 5.
export function sugerirVentaGasto(e, ventas = [], ctx = {}) {
  const { aprendidos = [], hermanos = [] } = ctx || {}
  const ap = ventaAprendida(e, ventas, aprendidos)
  if (ap?.venta) return { venta: ap.venta, regla: 'aprendido', auto: ap.n >= 2, porque: ap.n >= 2 ? 'Así lo vinculaste antes' : 'Así lo vinculaste una vez' }
  if (!ventas.length) return { venta: null, regla: 'sinventa', auto: false, porque: 'El cliente no tiene ventas' }
  if (ventas.length === 1) return { venta: ventas[0], regla: 'unica', auto: true, porque: 'Única venta del cliente' }
  const act = ventas.filter(s => s.status === 'Activo')
  if (act.length === 1) return { venta: act[0], regla: 'activa', auto: true, porque: 'Única venta activa' }
  const f = e.date ? String(e.date).slice(0, 10) : null
  if (f) {
    const ids = new Set(ventas.map(s => String(s.id)))
    const mismos = (hermanos || []).filter(h => h && h.id !== e.id && !h.deleted_at && h.sale_id && ids.has(String(h.sale_id)) && String(h.client_id) === String(e.client_id)
      && String(h.date || '').slice(0, 10) === f && (!e.entity_id || !h.entity_id || String(h.entity_id) === String(e.entity_id)))
    const vs = [...new Set(mismos.map(h => String(h.sale_id)))]
    if (vs.length === 1) return { venta: ventas.find(s => String(s.id) === vs[0]), regla: 'mismo_dia', auto: false, porque: `Mismo día que ${mismos.length} gasto${mismos.length !== 1 ? 's' : ''} de este trabajo` }
  }
  const g = new Set(toksTrab([e.concept, e.subconcept, e.materia, e.project].filter(Boolean).join(' ')))
  const sc = ventas.map(s => ({ s, hit: [...new Set(toksTrab(s.title).filter(t => g.has(t)))] })).sort((a, b) => b.hit.length - a.hit.length)
  if (sc[0].hit.length && (sc.length === 1 || sc[0].hit.length > sc[1].hit.length)) return { venta: sc[0].s, regla: 'texto', auto: false, porque: 'El texto coincide con el trabajo' }
  return { venta: null, regla: 'decidir', auto: false, porque: `${ventas.length} trabajos posibles` }
}
