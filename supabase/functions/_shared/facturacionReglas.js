// Reglas ÚNICAS del registro de facturas emitidas en el SII (las usan la app —Cargar del SII › Cargadas sin registrar— y el
// servidor —facturas-sii-registrar—). Funciones puras: no leen ni escriben la base.

const _MESES_FULL = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const _MESES_ABR = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
// Señales de período en una glosa/concepto: mes (0-11), año y N° de cuota.
export function periodoDeTexto(txt) {
  const t = (txt || '').toLowerCase()
  let mes = null
  for (let i = 0; i < 12; i++) { if (t.includes(_MESES_FULL[i])) { mes = i; break } }
  if (mes == null) { for (let i = 0; i < 12; i++) { if (new RegExp('\\b' + _MESES_ABR[i] + '\\.?').test(t)) { mes = i; break } } }
  const yM = t.match(/\b20(\d{2})\b/); const anio = yM ? 2000 + +yM[1] : null
  // Cuota/pago: "cuota 2", "pago 1", "2/5", "3 de 24" (evita el dash para no confundir años tipo 2026-07). 1-2 dígitos.
  const cM = t.match(/(?:cuota|pago)\s*(\d{1,2})/) || t.match(/\b(\d{1,2})\s*(?:\/|\sde\s)\s*\d{1,2}\b/); const cuota = cM ? +cM[1] : null
  return { mes, anio, cuota }
}
// Puntúa cuánto calza el MES de servicio de la glosa (gmes) con una candidata. Prioriza la convención "mes vencido" de la firma
// (servicio = vencimiento − 1), luego el N° de cuota, y deja el mes directo como señal débil. Evita que cuotas de meses contiguos empaten.
export function mesScoreCandidata(concept, due, gmes) {
  if (gmes == null) return 0
  const cp = periodoDeTexto(concept || '')
  if (cp.mes === gmes) return 3
  const dm = due ? new Date(due).getUTCMonth() : null
  const dmOk = dm != null && !isNaN(dm)
  if (dmOk && ((dm - 1 + 12) % 12) === gmes) return 3
  if (cp.cuota != null && ((cp.cuota - 2 + 12) % 12) === gmes) return 2
  if (dmOk && dm === gmes) return 1
  if (cp.cuota != null && ((cp.cuota - 1 + 12) % 12) === gmes) return 1
  return 0
}
// Cuotas programadas/anticipadas del cliente que puede reemplazar la factura: sin folio, monto ±6% (comisión: exacto ±$1),
// vencimiento a ≤120 días (comisión ≤60) de la emisión. Ordenadas: mejor puntaje de período, luego la más antigua.
export function candidatasProgramadas(billing, cliId, monto, fecha, glosa) {
  if (!cliId || !(monto > 0)) return []
  const gp = periodoDeTexto(glosa)
  const score = x => { const cp = periodoDeTexto(x.concept || ''); let s = 0; if (gp.cuota != null && cp.cuota != null && gp.cuota === cp.cuota) s += 4; s += mesScoreCandidata(x.concept, x.due || x.issued_at, gp.mes); if (gp.anio != null && cp.anio != null && gp.anio === cp.anio) s += 1; return s }
  return (billing || []).filter(x => !x.deleted_at && !x.invoice_no && ['Programada', 'Anticipada'].includes(x.status) && x.billing_type !== 'reembolso' && String(x.client_id) === String(cliId) && Math.abs((x.amount || 0) - monto) / monto <= 0.06
    && (() => { const dv = x.due || x.issued_at; if (!dv || !fecha) return true; return Math.abs((new Date(dv) - new Date(fecha)) / 86400000) <= (x.billing_type === 'comision' ? 60 : 120) })()
    && (x.billing_type !== 'comision' || Math.abs((x.amount || 0) - monto) <= 1))
    .map(x => ({ x, s: score(x) })).sort((a, b) => b.s - a.s || String(a.x.due || a.x.issued_at || '').localeCompare(String(b.x.due || b.x.issued_at || ''))).map(o => ({ ...o.x, _s: o.s }))
}
// Todas las candidatas son de la MISMA venta (serie recurrente): no hay ambigüedad real → se toma la más antigua (FIFO).
export const unaSerie = pc => (pc || []).length > 1 && pc.every(c => c.sale_id && String(c.sale_id) === String(pc[0].sale_id))
// Qué hacer con una factura del SII cuyo RUT ya dio el cliente («cero toque»): reemplazar su cuota (única, o la más antigua
// de una misma serie) o crearla (asociada a la venta si el cliente tiene UNA sola activa que no es subarriendo). Varias cuotas
// de ventas distintas → la decide una persona. ventasActivas = ventas activas del cliente, sin subarriendo.
export function decidirRegistroSII(cands, ventasActivas) {
  if ((cands || []).length) {
    if (cands.length === 1) return { tipo: 'prog', prog: cands[0] }
    if (unaSerie(cands)) return { tipo: 'prog', prog: [...cands].sort((a, b) => String(a.due || '').localeCompare(String(b.due || '')))[0] }
    return { tipo: 'manual', motivo: `${cands.length} cuotas de ventas distintas pueden calzar` }
  }
  return { tipo: 'nueva', saleId: (ventasActivas || []).length === 1 ? ventasActivas[0].id : null }
}
// Vencimiento de pago = ÚLTIMO DÍA HÁBIL del mes de emisión si se emite dentro de los primeros 10 días; si se emite después
// del día 10, el último día hábil del mes SIGUIENTE. esHabil(date) = ni fin de semana ni feriado.
export function ultimoDiaHabilMesEmision(iso, esHabil) {
  if (!iso) return null
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00'); if (isNaN(d)) return null
  let y = d.getFullYear(), m = d.getMonth()
  if (d.getDate() > 10) { m++; if (m > 11) { m = 0; y++ } }
  const last = new Date(y, m + 1, 0)
  const ok = esHabil || (dt => dt.getDay() !== 0 && dt.getDay() !== 6)
  let guard = 0; while (!ok(last) && guard++ < 15) last.setDate(last.getDate() - 1)
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`
}
// La serie (venta) ya tiene una factura emitida en el mismo mes que esta: una segunda factura del mismo monto puede ser un mes
// ATRASADO que no estaba programado (BDA, F489 del 20-10-2026 = junio, con octubre ya facturado el 07-10) o uno adelantado. La
// cuota que toque no se puede saber por la regla «la más antigua» → la elige una persona. billing = facturas del cliente.
export function serieYaFacturadaEnMes(billing, saleId, fecha, folio) {
  if (!saleId || !fecha) return null
  const mes = String(fecha).slice(0, 7)
  return (billing || []).find(b => !b.deleted_at && b.status !== 'Anulada' && String(b.sale_id) === String(saleId) && b.invoice_no && String(b.invoice_no).replace(/^factura\s*/i, '').trim() !== String(folio) && String(b.issued_at || '').slice(0, 7) === mes) || null
}
