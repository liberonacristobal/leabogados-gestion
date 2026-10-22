// Tareas con evidencia: lo que pide una tarea ya quedó hecho en los registros de la app. Lo usa el edge tareas-evidencia.
// Solo tareas cuyo título nombra una acción que deja un registro propio, del mismo cliente y POSTERIOR a la creación de la tarea.
// Es una propuesta: el responsable la confirma («Marcar cumplida») o la descarta («No corresponde»).

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const dmy = iso => { const [y, m, d] = String(iso || '').slice(0, 10).split('-'); return y && m && d ? `${d}-${m}-${y}` : '' }
const fmt = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-CL')
const folioN = no => String(no || '').replace(/^factura\s*/i, '').trim()

export const REGLAS_TAREA = [
  { regla: 'solicitud_fondos', re: /(solicitar|pedir|enviar)\b.*\bfondos|provision de fondos/ },
  { regla: 'factura_emitida', re: /\bemitir\b.*\bfactura|\bfacturar\b/ },
  { regla: 'liquidacion_notaria', re: /\b(liquidar|liquidacion|pagar|pago)\b.*\bnotaria|\bnotaria\b.*\b(liquidar|liquidacion)/ },
  { regla: 'rendicion_enviada', re: /^(enviar|preparar|hacer)?\s*(la\s+)?rendicion\b|^rendir\b/ },
]

// d = { fundRequests, fondos, billing, rendiciones } (filas crudas). Devuelve { regla, texto, fecha, tabla, id } o null.
export function evidenciaTarea(t, d) {
  if (!t || t.status === 'Terminado') return null
  const tit = norm(t.title).trim(), desde = String(t.created_at || '').slice(0, 10)
  if (!desde) return null
  const r = REGLAS_TAREA.find(x => x.re.test(tit)); if (!r) return null
  const cli = x => t.client_id && String(x.client_id) === String(t.client_id)
  const mas = (a, b) => String(b.f).localeCompare(String(a.f))
  if (r.regla === 'solicitud_fondos') {
    const sol = (d.fundRequests || []).filter(f => cli(f) && String(f.enviada_at || '').slice(0, 10) >= desde).map(f => ({ f: String(f.enviada_at).slice(0, 10), x: f })).sort(mas)[0]
    if (sol) return { regla: r.regla, texto: `Solicitud de fondos enviada el ${dmy(sol.f)} por ${fmt(sol.x.monto)}`, fecha: sol.f, tabla: 'fund_requests', id: sol.x.id }
    const fo = (d.fondos || []).filter(e => cli(e) && e.type === 'fondo' && !e.deleted_at && Number(e.amount) > 0 && String(e.date || '').slice(0, 10) >= desde).map(e => ({ f: String(e.date).slice(0, 10), x: e })).sort(mas)[0]
    if (fo) return { regla: r.regla, texto: `Fondos recibidos el ${dmy(fo.f)} por ${fmt(fo.x.amount)}`, fecha: fo.f, tabla: 'expenses', id: fo.x.id }
    return null
  }
  if (r.regla === 'factura_emitida') {
    const b = (d.billing || []).filter(b => cli(b) && (!t.sale_id || String(b.sale_id) === String(t.sale_id)) && b.invoice_no && !b.deleted_at && b.status !== 'Anulada'
      && !['reembolso', 'nota_credito'].includes(b.billing_type || '') && String(b.issued_at || '').slice(0, 10) >= desde).map(b => ({ f: String(b.issued_at).slice(0, 10), x: b })).sort(mas)[0]
    return b ? { regla: r.regla, texto: `Factura N° ${folioN(b.x.invoice_no)} emitida el ${dmy(b.f)} por ${fmt(b.x.amount)}`, fecha: b.f, tabla: 'billing', id: b.x.id } : null
  }
  if (r.regla === 'liquidacion_notaria') {
    const l = (d.rendiciones || []).filter(x => x.tipo === 'notaria' && !x.anulada_at && String(x.created_at || '') >= String(t.created_at)).map(x => ({ f: String(x.created_at).slice(0, 10), x })).sort(mas)[0]
    return l ? { regla: r.regla, texto: `Liquidación de notaría preparada el ${dmy(l.f)} por ${fmt(l.x.total)}`, fecha: l.f, tabla: 'rendiciones', id: l.x.id } : null
  }
  if (r.regla === 'rendicion_enviada') {
    const l = (d.rendiciones || []).filter(x => x.tipo === 'cliente' && cli(x) && !x.anulada_at && x.sent_at && String(x.sent_at) >= String(t.created_at)).map(x => ({ f: String(x.sent_at).slice(0, 10), x })).sort(mas)[0]
    return l ? { regla: r.regla, texto: `Rendición enviada el ${dmy(l.f)} por ${fmt(l.x.total)}`, fecha: l.f, tabla: 'rendiciones', id: l.x.id } : null
  }
  return null
}
