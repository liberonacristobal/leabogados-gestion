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
    && (() => { const dv = x.due || x.issued_at; if (!dv || !fecha) return true; return Math.abs((+new Date(dv) - +new Date(fecha)) / 86400000) <= (x.billing_type === 'comision' ? 60 : 120) })()
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
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00'); if (isNaN(+d)) return null
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

// ── Venta de una factura sin venta (motor ÚNICO: Bandeja, Facturación › Por clasificar, ficha del cliente y el registro
// automático facturas-sii-registrar). Funciones puras.
const _normTxt = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
const _nRut = r => String(r || '').toUpperCase().replace(/[^0-9K]/g, '')
// Clave de lo aprendido: cliente + RUT del receptor + glosa (learnings venta_factura / venta_factura_no).
export const claveVentaFactura = f => `${f?.client_id || ''}|${_nRut(f?.receptor_rut)}|${_normTxt(f?.concept || f?.glosa || '')}`
// Cuotas programadas de una venta que la factura reemplaza: las más antiguas, en orden, cuya suma más se acerca al monto
// sin pasarlo en más de 1% (mínimo una). calza = la suma queda a ±1% del monto.
export function cuotasQueReemplaza(progs, monto) {
  const xs = [...(progs || [])].sort((a, b) => String(a.due || '').localeCompare(String(b.due || '')))
  if (!xs.length || !(monto > 0)) return { cuotas: [], suma: 0, dif: monto || 0, calza: false }
  /** @type {any} */ let best = null, s = 0
  for (let n = 1; n <= xs.length; n++) { s += Number(xs[n - 1].amount) || 0; if (n > 1 && s > monto * 1.01) break; const d = Math.abs(s - monto); if (!best || d < best.d) best = { n, s, d } }
  return { cuotas: xs.slice(0, best.n), suma: best.s, dif: Math.round(best.s - monto), calza: best.d <= monto * 0.01 }
}
// Ventas candidatas para una factura sin venta, ordenadas por: lo aprendido (confirmaciones de la misma clave) > cuotas que
// calzan con el monto > misma razón social > única venta activa. rechazadas = sale_ids que una persona dijo que no
// corresponden para esta clave. auto = ya aprendido (≥2 confirmaciones) y las cuotas calzan: se puede asignar sola.
// billing = facturas/cuotas del cliente; aprendidas = {sale_id: hits} para la clave de la factura.
export function sugerirVentas({ factura, sales = [], billing = [], aprendidas = {}, rechazadas = [] }) {
  if (!factura?.client_id) return []
  const monto = Math.abs(Math.round(Number(factura.amount) || 0))
  const activas = (sales || []).filter(s => s && !s.deleted_at && String(s.client_id) === String(factura.client_id) && s.status === 'Activo' && s.cobro_config?.subarriendo !== true && s.area !== 'Subarriendo')
  const rech = new Set((rechazadas || []).map(String))
  return activas.map(s => {
    const progs = (billing || []).filter(b => b && !b.deleted_at && String(b.sale_id) === String(s.id) && b.status === 'Programada' && !b.invoice_no && b.billing_type !== 'reembolso')
    const r = cuotasQueReemplaza(progs, monto)
    const hits = Number(aprendidas[String(s.id)]) || 0
    const mismaRS = !!(s.entity_id && factura.entity_id && String(s.entity_id) === String(factura.entity_id))
    const motivo = hits ? 'aprendida' : r.calza ? 'cuotas' : mismaRS ? 'rs' : activas.length === 1 ? 'unica' : null
    const score = (rech.has(String(s.id)) ? -1000 : 0) + hits * 100 + (r.calza ? 50 - Math.min(10, Math.abs(r.dif) / Math.max(1, monto) * 1000) : 0) + (mismaRS ? 10 : 0) + (activas.length === 1 ? 5 : 0)
    return { sale: s, progs, ...r, hits, mismaRS, motivo, rechazada: rech.has(String(s.id)), auto: hits >= 2 && r.calza && !rech.has(String(s.id)), score }
  }).sort((a, b) => b.score - a.score)
}

// ── PROPUESTA DEL DÍA: cruce de una factura emitida en el SII con lo que la app proponía facturar (el Excel «Facturar») ──
// El Excel «Facturar_AAAA-MM» trae, por cuota por emitir, el RUT de la razón social y el «Monto hoy ($)»: la cuota en UF por el
// valor de la UF del día de la descarga, redondeado. Con eso se emite en el SII, así que una factura emitida se puede calzar
// con su cuota por RUT + monto exacto, sin tolerancias de porcentaje. Se reproduce la MISMA fórmula del Excel (BillingView.descargarExcel):
//   monto = venta en CLP ? cuota.amount : round(cuota.amount / venta.uf_value × UF del día)
// Funciones puras (sin red ni base). Fuente única de: el cotejo del SII (sii-sync/match.ts), el registro automático
// (facturas-sii-registrar) y la vista Cuadrar con SII.
export const rutNorm = r => String(r || '').toUpperCase().replace(/[^0-9K]/g, '').replace(/^0+/, '')

/**
 * RUT con que sale una cuota en el Excel «Facturar» (misma prioridad que rsRutExport): su receptor, la RS elegida, la única RS, la primera RS con RUT, el cliente.
 * @param {any} b @param {any[]} [entidadesCliente] @param {any} [cliente] */
export function rutDeCuota(b, entidadesCliente = [], cliente = null) {
  const ents = entidadesCliente || []
  const porId = b?.entity_id ? ents.find(e => String(e.id) === String(b.entity_id)) : null
  const r = [b?.receptor_rut, porId && porId.rut, ents.length === 1 && ents[0].rut, (ents.find(e => e.rut && String(e.rut).trim()) || {}).rut, cliente && cliente.rut].map(x => String(x || '').trim()).find(Boolean) || ''
  return rutNorm(r)
}

/** Monto «hoy» de una cuota a un valor de UF (null si no se puede calcular, como el Excel que lo deja vacío). */
export function montoDeCuota(b, venta, uf) {
  const amount = Number(b?.amount) || 0
  if (venta && venta.moneda === 'CLP') return amount
  const ufVal = Number(venta?.uf_value) || 0
  if (!(ufVal > 0) || !(uf > 0)) return null
  return Math.round(amount / ufVal * uf)
}

const _dia = (iso, d) => { const x = new Date(String(iso).slice(0, 10) + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10) }
const _inicioMesAnterior = iso => { const x = new Date(String(iso).slice(0, 10) + 'T12:00:00Z'); return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() - 1, 1)).toISOString().slice(0, 10) }
const _finMes = iso => { const x = new Date(String(iso).slice(0, 10) + 'T12:00:00Z'); return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).toISOString().slice(0, 10) }
const _difDias = (a, b) => Math.abs((Date.parse(String(a).slice(0, 10)) - Date.parse(String(b).slice(0, 10))) / 86400000)
/** Venta de subarriendo (marcador cobro_config.subarriendo, igual que esSubarriendo de cifras.js). @param {any} v */
export const esVentaSubarriendo = v => !!v && (v.cobro_config?.subarriendo === true || (v.area || '') === 'Subarriendo')

/** N° de cuota y mes que dice un texto (glosa o concepto). Cuota: «cuota 4», «pago 6/10», «cobro 8», «2-18», «2/2». */
export function senalesTexto(txt) {
  const t = String(txt || '')
  const p = periodoDeTexto(t)
  const c = t.match(/(?:cuota|pago|cobro)\s*(\d{1,2})/i) || t.match(/\b(\d{1,2})\s*[\/-]\s*\d{1,2}\b/)
  return { cuota: c ? +c[1] : null, mes: p.mes, anio: p.anio }
}
/** La glosa contradice a la cuota solo con señales fuertes: otro N° de cuota u otro mes. Sin dato en alguno de los dos, no contradice. */
export function glosaContradice(glosa, concepto) {
  const g = senalesTexto(glosa), c = senalesTexto(concepto)
  if (g.cuota != null && c.cuota != null && g.cuota !== c.cuota) return true
  if (g.mes != null && c.mes != null && g.mes !== c.mes) return true
  return false
}
/** La glosa coincide a favor de la cuota (mismo N° de cuota o mismo mes). */
export function glosaApoya(glosa, concepto) {
  const g = senalesTexto(glosa), c = senalesTexto(concepto)
  return (g.cuota != null && g.cuota === c.cuota) || (g.mes != null && g.mes === c.mes)
}

/**
 * Cuota que propone el día para una factura del SII.
 *  doc = {rut, monto, fecha, glosa?} · programadas = cuotas sin folio (cualquier cliente) · ents/clientes/ventas = filas crudas ·
 *  ufPorFecha = {'AAAA-MM-DD': valor UF} · anticipos = pagos por adelantado (fecha del pago de las cuotas Anticipada).
 * Solo entran cuotas Programada o Anticipada con devengo hasta el fin del mes de emisión (lo que el Excel trae), cuyo RUT es el del
 * documento y cuyo monto calza al peso con el de algún día de la ventana (5 días antes a 1 después de la emisión). Resultado (nivel):
 *   'exacta'      una sola cuota calza y su devengo es del mes anterior o posterior: se puede registrar sola.
 *   'atrasada'    una sola calza, pero con devengo de hace más de un mes: se propone y la confirma una persona.
 *   'serie'       varias cuotas de UNA venta: se propone la más antigua (FIFO) y la confirma una persona.
 *   'varias'      cuotas de ventas distintas: sin propuesta; candidatas = solo las que calzan.
 *   'subarriendo' cuotas del subarriendo de oficina y pagos sin factura (la glosa no se usa): FIFO, propone el período más antiguo sin factura.
 *   'comision'    «Comisión por facturar» (monto exacto): se propone y se confirma, con el registro que ya tiene sus ajustes.
 *   'sin_cuota'   la glosa contradice (otro N° de cuota u otro mes) a todas las que calzan por RUT y monto: no se propone ninguna.
 *   null          ninguna calza exacto (el cotejo sigue con sus tolerancias).
 * evidencia = lo que explica el calce (modo de monto, UF del día, señales de la glosa); candidatas va con la propuesta primero.
 * @param {{doc:any, programadas?:any[], ents?:any[], clientes?:any[], ventas?:any[], ufPorFecha?:Record<string,number>, anticipos?:any[], usadas?:Set<any>}} p */
export function propuestaDelDia({ doc, programadas = [], ents = [], clientes = [], ventas = [], ufPorFecha = {}, anticipos = [], usadas = new Set() }) {
  /** @type {{nivel:string|null, propuesta:any, candidatas:any[], motivo:string|null, evidencia:any}} */
  const sin = { nivel: null, propuesta: null, candidatas: [], motivo: null, evidencia: null }
  const rutD = rutNorm(doc?.rut), monto = Math.round(Number(doc?.monto) || 0), fecha = String(doc?.fecha || '').slice(0, 10)
  if (!rutD || !(monto > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return sin
  /** @type {[string, number][]} */
  const ufs = []
  for (let d = -5; d <= 1; d++) { const f = _dia(fecha, d), v = Number(ufPorFecha[f]); if (v > 0) ufs.push([f, v]) }
  const tope = _finMes(fecha)
  const ventaDe = new Map((ventas || []).map(v => [String(v.id), v]))
  const entsDe = new Map(), clienteDe = new Map((clientes || []).map(c => [String(c.id), c]))
  for (const e of ents || []) { const k = String(e.client_id); if (!entsDe.has(k)) entsDe.set(k, []); entsDe.get(k).push(e) }
  const antDe = new Map((anticipos || []).map(a => [String(a.id), a]))
  const fechaPago = b => String((b.paid_at || (b.prepaid_anticipo_id && antDe.get(String(b.prepaid_anticipo_id))?.fecha) || '')).slice(0, 10)
  const evid = new Map()
  const ok = (programadas || []).filter(b => {
    if (!b || b.deleted_at || b.invoice_no || !['Programada', 'Anticipada'].includes(b.status) || b.billing_type === 'reembolso' || usadas.has(b.id)) return false
    if (rutDeCuota(b, entsDe.get(String(b.client_id)) || [], clienteDe.get(String(b.client_id))) !== rutD) return false
    if (b.billing_type === 'comision') { if (b.status !== 'Anticipada' || Math.abs((Number(b.amount) || 0) - monto) > 1) return false; const fp = fechaPago(b) || b.due; if (fp && _difDias(fp, fecha) > 60) return false; evid.set(b.id, { modo: 'comision' }); return true }
    if (!(b.due && String(b.due) <= tope)) return false
    const v = ventaDe.get(String(b.sale_id))
    if (v && v.moneda === 'CLP') { if (Math.abs((Number(b.amount) || 0) - monto) > 1) return false; evid.set(b.id, { modo: 'clp' }); return true }
    for (const [f, u] of ufs) { const m = montoDeCuota(b, v, u); if (m != null && Math.abs(m - monto) <= 1) { evid.set(b.id, { modo: 'uf', ufDia: f, uf: Number(v?.uf_value) > 0 ? Math.round((Number(b.amount) || 0) / Number(v.uf_value) * 100) / 100 : null, valorUf: u }); return true } }
    return false
  }).sort((a, b) => String(a.due || '').localeCompare(String(b.due || '')))
  if (!ok.length) return sin
  const conEv = (b, extra = {}) => ({ ...(evid.get(b.id) || {}), ...extra })
  const ordenar = (lista, prop) => prop ? [prop, ...lista.filter(x => x.id !== prop.id)] : lista
  // Subarriendo de oficina: la glosa no manda (el texto de estas facturas no describe la cuota). Candidatas = sus cuotas (Programada o
  // pagada por adelantado) y los pagos recibidos sin factura (anticipos disponibles). FIFO: se propone el período más antiguo sin factura.
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
  const claveMes = (txt, respaldo) => { const p = periodoDeTexto(txt); return p.mes != null && p.anio != null ? `${p.anio}-${String(p.mes + 1).padStart(2, '0')}` : String(respaldo || '').slice(0, 7) }
  const etiqueta = k => { const [y, m] = String(k).split('-'); return `${MESES[(+m || 1) - 1].toLowerCase()} de ${y}` }
  const sub = ok.filter(b => esVentaSubarriendo(ventaDe.get(String(b.sale_id)))).map(b => ({ ...b, _k: claveMes(b.concept, b.due) }))
  for (const a of anticipos || []) {
    if (!a || a.estado !== 'disponible' || a.billing_id || !esVentaSubarriendo(ventaDe.get(String(a.sale_id))) || Math.abs((Number(a.monto) || 0) - monto) > 1) continue
    // Un pago sin factura no trae razón social fija: sirve cualquiera de las del cliente (o el RUT del cliente).
    const rutsCli = [...(entsDe.get(String(a.client_id)) || []).map(e => rutNorm(e.rut)), rutNorm(clienteDe.get(String(a.client_id))?.rut)]
    if (!rutsCli.includes(rutD)) continue
    const k = claveMes(a.nota, a.fecha), [y, m] = k.split('-'), titulo = ventaDe.get(String(a.sale_id))?.title || 'Subarrendamiento oficina'
    sub.push({ id: 'ant:' + a.id, anticipoId: a.id, esAnticipo: true, client_id: a.client_id, sale_id: a.sale_id, entity_id: a.entity_id || null, amount: Number(a.monto), status: 'Pagada sin factura', paid_at: String(a.fecha || '').slice(0, 10), billing_type: 'subarriendo',
      concept: `${titulo} — Mensual ${MESES[(+m || 1) - 1]} ${y}`, due: `${k}-01`, _k: k })
  }
  if (sub.length) {
    sub.sort((a, b) => String(a._k).localeCompare(String(b._k)) || (a.esAnticipo ? 1 : 0) - (b.esAnticipo ? 1 : 0))
    const prop = sub[0]
    return { nivel: 'subarriendo', propuesta: prop, candidatas: sub, motivo: `la más antigua sin factura del subarriendo (${etiqueta(prop._k)})`, evidencia: { ...(evid.get(prop.id) || {}), glosa: 'no_se_usa' } }
  }
  const com = ok.filter(b => b.billing_type === 'comision')
  if (com.length) {
    const prop = [...com].sort((a, b) => _difDias(fechaPago(a) || a.due, fecha) - _difDias(fechaPago(b) || b.due, fecha))[0]
    return { nivel: 'comision', propuesta: prop, candidatas: ordenar(com, prop), motivo: 'comisión por facturar del mismo monto', evidencia: conEv(prop) }
  }
  // La glosa descarta solo con señales fuertes (otro N° de cuota u otro mes); no es un veto general.
  const glosa = String(doc?.glosa || '')
  let vivas = ok
  if (glosa) {
    vivas = ok.filter(b => !glosaContradice(glosa, b.concept))
    if (!vivas.length) return { nivel: 'sin_cuota', propuesta: null, candidatas: [], motivo: 'la glosa no coincide con la cuota que calza por RUT y monto (otro N° de cuota u otro mes)', evidencia: { glosa: 'contradice' } }
    if (vivas.length > 1) { const ap = vivas.filter(b => glosaApoya(glosa, b.concept)); if (ap.length === 1) vivas = ap }
  }
  const senal = b => { const g = senalesTexto(glosa), c = senalesTexto(b.concept); return glosa ? { glosa: (g.cuota != null && g.cuota === c.cuota) || (g.mes != null && g.mes === c.mes) ? 'calza' : 'sin_dato', cuota: c.cuota, mes: c.mes } : {} }
  if (vivas.length === 1) {
    const b = vivas[0]
    // Una cuota con devengo de hace más de un mes no se registra sola aunque sea la única: puede ser una vieja sin emitir y la factura otra.
    if (String(b.due) < _inicioMesAnterior(fecha)) return { nivel: 'atrasada', propuesta: b, candidatas: [b], motivo: `única cuota que calza, pero con devengo del ${String(b.due).split('-').reverse().join('-')}`, evidencia: conEv(b, senal(b)) }
    return { nivel: 'exacta', propuesta: b, candidatas: [b], motivo: 'RUT y monto iguales a los de la lista Facturar', evidencia: conEv(b, senal(b)) }
  }
  const unaVenta = vivas.every(b => b.sale_id && String(b.sale_id) === String(vivas[0].sale_id))
  if (unaVenta) return { nivel: 'serie', propuesta: vivas[0], candidatas: vivas, motivo: `${vivas.length} cuotas de la misma venta calzan; se propone la más antigua`, evidencia: conEv(vivas[0], senal(vivas[0])) }
  return { nivel: 'varias', propuesta: null, candidatas: vivas, motivo: `${vivas.length} cuotas de ventas distintas calzan`, evidencia: null }
}

/** Una línea que explica por qué se asignó (para «Asignadas automáticamente»). @param {any} ev @param {string} concepto */
export function explicarAsignacion(ev, concepto) {
  const e = ev || {}, f = x => { const [y, m, d] = String(x || '').split('-'); return `${d}-${m}-${y}` }
  const monto = e.modo === 'uf' ? `el monto (${String(e.uf ?? '').replace('.', ',')} UF × UF del ${f(e.ufDia)})` : e.modo === 'comision' ? 'el monto de la comisión por facturar' : 'el monto'
  const partes = ['el RUT', monto]
  if (e.glosa === 'calza') partes.push(e.cuota != null ? `la cuota ${e.cuota} de la glosa` : 'el mes de la glosa')
  const lista = partes.length > 1 ? `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}` : partes[0]
  return `Asignada a «${concepto}». Coinciden ${lista}.`
}

/**
 * Parche que convierte una cuota en su factura emitida: FUENTE ÚNICA del registro (Cargar del SII, cotejo del SII, registro automático).
 * Una cuota Anticipada (pagada por adelantado) queda Pagada con la fecha de su pago; el vencimiento corre desde la emisión (due ya calculado
 * por quien llama); el monto es el del DTE. dteXml: undefined = no tocar; null o texto = guardar.
 * @param {{prog:any, folio:any, fecha:string, due?:string|null, tipoDte?:any, montoDte?:number|null, fechaAnticipo?:string|null, dteXml?:string|null, batchId?:string|null, ahora:string}} p
 */
export function parcheRegistroCuota({ prog, folio, fecha, due = null, tipoDte = 34, montoDte = null, fechaAnticipo = null, dteXml = undefined, batchId = null, ahora }) {
  /** @type {Record<string, any>} */
  const patch = { invoice_no: String(folio), status: 'Pendiente', issued_at: fecha || null, ...(fecha && due ? { due } : {}), ...(dteXml !== undefined ? { dte_xml: dteXml } : {}), sii_tipo_dte: tipoDte || 34, sii_synced_at: ahora, updated_at: ahora, ...(montoDte != null ? { amount: montoDte } : {}), ...(batchId ? { import_batch_id: batchId } : {}) }
  if (prog?.status === 'Anticipada') Object.assign(patch, { status: 'Pagado', paid: true, paid_at: fechaAnticipo || prog.paid_at || fecha || null })
  return patch
}
/** Lo que hace falta guardar de una cuota para poder deshacer su registro. @param {any} prog */
export const instantaneaCuota = prog => ({ status: prog?.status ?? 'Programada', due: prog?.due ?? null, amount: prog?.amount ?? null, paid: prog?.paid ?? null, paid_at: prog?.paid_at ?? null, sii_tipo_dte: prog?.sii_tipo_dte ?? null, sii_synced_at: prog?.sii_synced_at ?? null, issued_at: prog?.issued_at ?? null })
/** Parche que deshace el registro de una cuota a partir de su instantánea (vuelve a no tener folio). @param {any} prev @param {string} ahora */
export const parcheDeshacerRegistro = (prev, ahora) => ({ ...prev, invoice_no: null, dte_xml: null, updated_at: ahora })
