// Reglas ÚNICAS de comisiones y boletas de honorarios (las usan la app y el servidor: conciliacion-auto, bhe-correo,
// agente-correo). Funciones puras: no leen ni escriben la base.

// Retención de boleta de honorarios por año (Ley 21.133).
export const RETENCION_BHE = { 2024: .1375, 2025: .145, 2026: .1525, 2027: .16, 2028: .17 }
export const tasaBHE = f => { const y = Number(String(f || '').slice(0, 4)) || new Date().getFullYear(); const ks = Object.keys(RETENCION_BHE).map(Number).sort((a, b) => a - b); return RETENCION_BHE[Math.min(Math.max(y, ks[0]), ks[ks.length - 1])] }
// Lo que se le transfiere por una comisión (líquido si emite boleta; si factura, el monto). Toda conciliación con el banco usa esto.
export const pagarT = t => t?.liquido != null ? (Number(t.liquido) || 0) : (Number(t?.monto) || 0)
// Al pagar una comisión de quien emite boleta SIN boleta registrada, el costo estimado se rehace con la tasa del AÑO DEL PAGO
// (la estimación pudo hacerse con la de otro año). Con boleta registrada mandan sus cifras reales.
export const reajusteBHEPago = (t, fecha) => { if (t?.liquido == null || t?.bhe_id || !(Number(t?.retencion) > 0)) return null
  const liq = Number(t.liquido) || 0, bruto = Math.round(liq / (1 - tasaBHE(fecha))); return bruto !== Number(t.monto) ? { monto: bruto, retencion: bruto - liq } : null }
// Lo que se le paga a un tercero por una cuota se calcula SOBRE LA FACTURA EMITIDA, no sobre la cuota programada: el reparto en % o en UF se
// reajusta con el monto real del DTE (la UF del día de emisión cambia el monto). % → factura × %; UF → factura × (UF del tercero ÷ UF de la venta).
// Un monto fijo en $ no cambia. No toca lo ya pagado, lo que ya tiene boleta registrada ni las retenciones de un externo (comision_pct).
// Con boleta de honorarios (liquido != null): el monto calculado es el líquido y el bruto sale con la tasa de retención vigente (como costoComision).
// Devuelve los cambios a aplicar [{id, patch}]; vacío si nada cambia. venta = {moneda, amount_uf}.
export function tercerosPorFactura({ terceros, venta, montoFactura, fecha }) {
  const out = []
  const total = Math.round(Number(montoFactura) || 0)
  if (!(total > 0)) return out
  for (const t of terceros || []) {
    if (!t || t.estado === 'pagado' || t.bhe_id || t.comision_pct != null) continue
    const v = Number(t.valor) || 0
    if (!(v > 0)) continue
    let m = null
    if (t.tipo_costo === 'pct') m = Math.round(total * v / 100)
    else if (t.tipo_costo === 'uf' && venta && (venta.moneda || 'UF') !== 'CLP' && Number(venta.amount_uf) > 0) m = Math.round(total * (v / Number(venta.amount_uf)))
    if (m == null || !(m > 0)) continue
    /** @type {Record<string, number>} */
    let patch = { monto: m }
    if (t.liquido != null) { const tasa = tasaBHE(fecha), bruto = Math.round(m / (1 - tasa)); patch = { monto: bruto, liquido: m, retencion: bruto - m } }
    if (Number(patch.monto) === Number(t.monto) && (patch.liquido == null || Number(patch.liquido) === Number(t.liquido))) continue
    out.push({ id: t.id, patch })
  }
  return out
}
// Estado de una comisión: pagada (lo marcó el banco) · por pagar (el cliente ya pagó su cuota) · por devengar.
export const estadoComision = (t, b) => t?.estado === 'pagado' ? 'pagada' : (t?.estado === 'por_pagar' || b?.status === 'Pagado' || b?.status === 'Anticipada') ? 'por_pagar' : 'por_devengar'

const _num = s => parseInt(String(s || '').replace(/[^\d]/g, ''), 10) || 0
const _nRut = r => String(r || '').replace(/[^0-9kK]/g, '').toUpperCase()
const _fmtRut = r => { const c = _nRut(r); return c.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + c.slice(-1) }
const _MESES = { enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06', julio: '07', agosto: '08', septiembre: '09', setiembre: '09', octubre: '10', noviembre: '11', diciembre: '12' }
// Campos de una boleta de honorarios electrónica del SII, desde el texto del PDF (ítems unidos por « | »). null si no lo es
// o si las cifras no cuadran (bruto − retención ≠ líquido).
export function parseBHE(t) {
  if (!/BOLETA DE HONORARIOS/i.test(t)) return null
  const folio = _num((t.match(/N\s*°\s*(\d+)/) || [])[1] || '')
  const ruts = [...t.matchAll(/R(?:UT|ut):?\s*\|?\s*([\d.]+\s*[−\-–]\s*[\dkK])/g)].map(m => _fmtRut(m[1]))
  const emisor_rut = ruts[0] || '', receptor_rut = ruts[1] || ''
  const emisor_nombre = (t.split(' | ')[0] || '').trim()
  let fecha = ''
  const fe = t.match(/Emisi[oó]n:\s*(\d{2})\/(\d{2})\/(\d{4})/); if (fe) fecha = `${fe[3]}-${fe[2]}-${fe[1]}`
  if (!fecha) { const f2 = t.match(/(\d{1,2}) de (\w+) de (\d{4})/i); if (f2) fecha = `${f2[3]}-${_MESES[f2[2].toLowerCase()] || '01'}-${f2[1].padStart(2, '0')}` }
  const bruto = _num((t.match(/Total Honorarios:?\s*\$?:?\s*\|\s*([\d.]+)/i) || [])[1] || '')
  const tasaM = t.match(/([\d.,]+)\s*%\s*Impto\.?\s*Retenido:?\s*\|\s*([\d.]+)/i)
  const tasa = tasaM ? parseFloat(tasaM[1].replace(',', '.')) / 100 : null
  const retencion = tasaM ? _num(tasaM[2]) : 0
  const liquido = _num((t.match(/\|\s*Total:\s*\|\s*([\d.]+)/i) || [])[1] || '') || (bruto - retencion)
  const glosa = ((t.match(/Por atenci[oó]n profesional:\s*\|\s*([^|]+)/i) || [])[1] || '').trim()
  if (!folio || !emisor_rut || !bruto || !fecha || bruto - retencion !== liquido) return null
  return { folio, emisor_rut, receptor_rut, emisor_nombre, fecha, bruto, retencion, liquido, tasa, glosa }
}
// Comisiones a las que corresponde una boleta: su líquido debe calzar (±$2) con 1–3 comisiones sin boleta, ya cobradas al
// cliente o pagadas, y de UNA sola forma. Devuelve los cambios por comisión (bruto, retención y líquido de la boleta
// repartidos en proporción) o null. cand = [{id, liquido, estado, billing_status}].
export function elegirComisionesBHE(cand, bhe) {
  const xs = (cand || []).filter(t => t.liquido != null && (t.estado === 'pagado' || t.estado === 'por_pagar' || ['Pagado', 'Anticipada'].includes(t.billing_status)))
  const L = t => Number(t.liquido) || 0, ok = s => Math.abs(s - bhe.liquido) <= 2
  const hits = []
  for (let i = 0; i < xs.length; i++) {
    if (ok(L(xs[i]))) hits.push([xs[i]])
    for (let j = i + 1; j < xs.length; j++) {
      if (ok(L(xs[i]) + L(xs[j]))) hits.push([xs[i], xs[j]])
      for (let k = j + 1; k < xs.length; k++) if (ok(L(xs[i]) + L(xs[j]) + L(xs[k]))) hits.push([xs[i], xs[j], xs[k]])
    }
  }
  if (hits.length !== 1) return null
  const sel = hits[0], tot = sel.reduce((s, t) => s + L(t), 0)
  let accB = 0, accR = 0
  return sel.map((t, i) => { const last = i === sel.length - 1, sh = tot > 0 ? L(t) / tot : 1 / sel.length
    const b2 = last ? bhe.bruto - accB : Math.round(bhe.bruto * sh), r2 = last ? bhe.retencion - accR : Math.round(bhe.retencion * sh); accB += b2; accR += r2
    return { id: t.id, monto: b2, retencion: r2, liquido: b2 - r2 } })
}
// Pago del banco ↔ comisión: un cargo al RUT del proveedor cuyo monto calza (±$1) con lo que falta transferirle de UNA sola
// comisión por pagar, y es el único cargo libre por ese monto. Igual que «Conciliación sola» de la app (Proveedores).
// porPagar = [{id, saldo}] · libres = [{id, monto}] del mismo proveedor. Devuelve [{mov, t}].
export function calcesPagoComision(porPagar, libres) {
  const amt = m => Math.abs(Number(m.monto) || 0), out = []
  for (const m of libres || []) { const a = amt(m); const ts = (porPagar || []).filter(t => Math.abs(t.saldo - a) <= 1); if (ts.length !== 1) continue
    if ((libres || []).filter(o => Math.abs(amt(o) - a) <= 1).length !== 1) continue
    if (out.some(x => x.t.id === ts[0].id)) continue
    out.push({ mov: m, t: ts[0] }) }
  return out
}

// Documentos por pedir a colaboradores: comisión YA pagada por el banco (movimiento_id), sin boleta (bhe_id) ni factura del colaborador.
// · proveedor que emite boleta y con líquido conocido → pedir la boleta (bruto, retención, líquido ya transferido);
// · persona natural sin documento definido (RUT bajo 50.000.000) → definir si emite boleta o factura (cambia la retención del F29);
// · empresa → se espera su factura (la lectura de compras del SII la enlaza): no se pide.
// sinDocumento = proveedores marcados «no emite documento» (learnings proveedor_sin_documento): no se pide nada.
export function documentosPorPedir({ terceros = [], proveedores = [], sinDocumento = new Set(), desde = '2026-06-06' }) {
  const prov = id => (proveedores || []).find(p => String(p.id) === String(id)) || null
  const rutN = r => Number(String(r || '').replace(/[^0-9kK]/g, '').slice(0, -1)) || 0
  const out = []
  for (const t of terceros || []) {
    if (t.estado !== 'pagado' || !t.movimiento_id || t.bhe_id || t.factura_numero || t.comision_pct != null || String(t.pagado_at || '') < desde) continue
    const p = prov(t.proveedor_id), doc = p?.documento || null
    if (sinDocumento.has(String(t.proveedor_id))) continue
    if (doc === 'boleta' && t.liquido != null) out.push({ tipo: 'pedir_boleta', t, p, bruto: Number(t.monto) || 0, retencion: Number(t.retencion) || 0, liquido: Number(t.liquido) || 0 })
    else if (!doc && rutN(t.rut || p?.rut) > 0 && rutN(t.rut || p?.rut) < 50000000) out.push({ tipo: 'definir_documento', t, p })
  }
  return out
}

// ── Comisión devengada (Resultado) ──────────────────────────────────────────────────────────────────────────────────────────────────────────
// La comisión de un colaborador pertenece al mes de la factura que la origina (ingreso y comisión en el mismo mes), no al mes en que se le paga
// (eso es caja: Banco y flujo). Solo cuentan facturas EMITIDAS (con folio, no anuladas) desde `desde` (inicio de la facturación en la app); una cuota
// programada no devenga nada hasta emitirse. Las filas de externos (`comision_pct`) ya entran netas (solo nuestro %) y no se tocan aquí. Una comisión
// sin factura emitida de la vida de la app (histórica, sin factura o ligada a una cuota que no se emitió) sigue contándose al pagarse. Funciones puras.
/** @typedef {{t:any, b:any, fecha:string, base:'emision'|'pago'}} ComDev */
/** Mes (AAAA-MM-DD) al que pertenece la comisión, o null si todavía no cuenta. @param {any} t @param {any} b @param {string} desde */
export function fechaComisionDevengada(t, b, desde) {
  if (!t || t.comision_pct != null) return null
  const emitida = b && !b.deleted_at && String(b.invoice_no || '').trim() && b.status !== 'Anulada' && !['Programada', 'Pausada'].includes(b.status || '')
  if (emitida && String(b.issued_at || '').slice(0, 10) >= desde) return { fecha: String(b.issued_at).slice(0, 10), base: /** @type {'emision'} */ ('emision') }
  if (t.estado === 'pagado' && t.pagado_at) return { fecha: String(t.pagado_at).slice(0, 10), base: /** @type {'pago'} */ ('pago') }
  return null
}
/** Comisiones devengadas en el mes `ym`. @param {any[]} terceros @param {any[]} billing @param {string} ym @param {string} [desde] @returns {ComDev[]} */
export function comisionesDevengadas(terceros, billing, ym, desde = '2026-06-06') {
  const bById = /** @type {Map<string, any>} */ (new Map()); for (const b of billing || []) if (b) bById.set(String(b.id), b)
  const out = []
  for (const t of terceros || []) {
    const b = t && t.billing_id ? bById.get(String(t.billing_id)) : null, r = fechaComisionDevengada(t, b, desde)
    if (r && r.fecha.startsWith(ym)) out.push({ t, b, fecha: r.fecha, base: r.base })
  }
  return out
}
