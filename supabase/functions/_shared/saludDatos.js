// Revisión de datos: los detectores que usan la página «Revisión de datos» de la app y el auditor nocturno (edge auditor-datos).
// Una sola fuente: funciones puras sobre las filas; ninguna escribe. Cada detector devuelve casos con las filas que lo prueban.

const normRut = r => String(r || '').toUpperCase().replace(/[^0-9K]/g, '')
const folioN = no => String(no || '').replace(/^factura\s*/i, '').trim()
const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')
const _dias = (a, b) => Math.round((new Date(String(a).slice(0, 10) + 'T12:00') - new Date(String(b).slice(0, 10) + 'T12:00')) / 864e5)
// Inicio de la facturación en la app: lo anterior es histórico importado (sin XML ni envío), no se audita como error.
export const APP_DESDE = '2026-06-06'

export function dteMontoTotal(dteXml) { if (!dteXml) return null; const m = String(dteXml).match(/<MntTotal>\s*(\d+(?:\.\d+)?)\s*<\/MntTotal>/); return m ? Math.round(+m[1]) : null }
export function montoFactura(b) { const t = b && b.dte_xml ? dteMontoTotal(b.dte_xml) : null; return (t != null) ? t : (b?.amount || 0) }

// Banco: plata contada dos veces o de más. Una entrega de caja y la conciliación de sus gastos pueden describir la MISMA
// transferencia → se toma el mayor, no la suma.
export function bancoChk(movs, conciliacion, pettyLinks, terceros) {
  const concBy = {}, tipoBy = {}; (conciliacion || []).forEach(c => { const k = String(c.movimiento_id); concBy[k] = (concBy[k] || 0) + (Number(c.monto_aplicado) || 0); (tipoBy[k] = tipoBy[k] || new Set()).add(c.tipo_destino) })
  const pcBy = {}; (pettyLinks || []).forEach(p => { const k = String(p.movimiento_id); pcBy[k] = (pcBy[k] || 0) + Math.abs(Number(p.amount) || 0) })
  const tercBy = {}; (terceros || []).forEach(t => { if (t.movimiento_id) tercBy[String(t.movimiento_id)] = true })
  const vivos = (movs || []).filter(m => !m.es_interno && m.estado !== 'interno')
  const sobre = vivos.filter(m => (concBy[String(m.id)] || 0) > (Number(m.monto) || 0) + 1)
  // Comisión y gasto en el mismo pago: es doble conteo solo si la comisión no tiene su parte conciliada o si las partes superan el
  // monto (un pago repartido entre comisiones y un bono, que suman el monto, es correcto).
  const doble = vivos.filter(m => { const k = String(m.id); return tercBy[k] && tipoBy[k]?.has('gasto') && (!tipoBy[k].has('tercero') || (concBy[k] || 0) > (Number(m.monto) || 0) + 1) })
  const atras = vivos.filter(m => Math.min(Number(m.monto) || 0, Math.max(concBy[String(m.id)] || 0, pcBy[String(m.id)] || 0)) > (Number(m.monto_conciliado) || 0) + 1)
  const sinBanco = (terceros || []).filter(t => t.estado === 'pagado' && !t.movimiento_id && String(t.pagado_at || '') >= '2026-06-01')
  return { sobre, doble, atras, sinBanco, concBy }
}

export function rutMulti(clientEntities) {
  const m = {}; (clientEntities || []).forEach(e => { const r = normRut(e.rut); if (!r) return; if (!m[r]) m[r] = { ids: new Set(), rs: e.name }; m[r].ids.add(String(e.client_id)) })
  return Object.entries(m).filter(([, v]) => v.ids.size > 1).map(([r, v]) => ({ rut: r, rs: v.rs, clientIds: [...v.ids] }))
}

export function folioDup(billing) {
  const m = {}; (billing || []).forEach(b => { if (b.deleted_at || b.status === 'Anulada' || !b.invoice_no) return; const f = folioN(b.invoice_no); if (!/^\d+$/.test(f)) return; (m[f] = m[f] || []).push(b) })
  return Object.entries(m).filter(([, a]) => a.length > 1).map(([f, a]) => ({ folio: f, rows: a }))
}

// Cruce REAL por identidad del receptor (RUT > razón social > cliente) + concepto + monto, sin anuladas por nota de crédito.
// Dos entidades distintas con el mismo monto no se marcan; solo la MISMA entidad con la misma cuota repetida.
export function facDup(billing) {
  const m = {}
  ;(billing || []).forEach(b => { if (b.deleted_at || b.status === 'Anulada' || ['reembolso', 'nota_credito'].includes(b.billing_type || '')) return
    const rut = normRut(b.receptor_rut); const ident = rut || norm(b.receptor_name) || ('cli:' + b.client_id)
    const key = ident + '|' + norm(b.concept) + '|' + Math.round(b.amount || 0); (m[key] = m[key] || []).push(b) })
  // No es duplicado: dos facturas con folio propio emitidas en meses distintos (serie mensual o tramos), dos con folio propio ya
  // pagadas, ni dos históricas anteriores a la app.
  const sospechoso = (x, y) => {
    const fx = folioN(x.invoice_no), fy = folioN(y.invoice_no)
    if (fx && fy && fx !== fy) {
      if (x.status === 'Pagado' && y.status === 'Pagado') return false
      if (x.issued_at && y.issued_at && Math.abs(_dias(x.issued_at, y.issued_at)) >= 20) return false
      if (String(x.issued_at || '') < APP_DESDE && String(y.issued_at || '') < APP_DESDE) return false
    }
    return true
  }
  return Object.values(m).map(a => { const en = new Set(); a.forEach((x, i) => a.slice(i + 1).forEach(y => { if (sospechoso(x, y)) { en.add(x); en.add(y) } })); return [...en] })
    .filter(a => a.length > 1).map(a => ({ rut: a[0].receptor_rut || null, rs: a[0].receptor_name || null, cid: a[0].client_id, concept: a[0].concept, amount: a[0].amount, rows: a }))
}

export const montoNeDte = billing => (billing || []).filter(b => !b.deleted_at && b.dte_xml && b.amount != null).map(b => ({ b, dte: dteMontoTotal(b.dte_xml) })).filter(x => x.dte != null && Math.round(x.dte) !== Math.round(x.b.amount))

export function ventasDup(sales) {
  const m = {}; (sales || []).forEach(s => { if (s.deleted_at || !['Activo', 'Terminado'].includes(s.status)) return; const k = `${s.client_id}|${s.amount_uf || s.amount_clp || 0}|${s.year}|${s.month}`; (m[k] = m[k] || []).push(s) })
  return Object.values(m).filter(a => a.length > 1)
}

// Doble conteo cuota↔tramo: venta NO recurrente donde cuotas Programadas + facturas emitidas SUPERAN la venta.
// ignorados = ventas marcadas «No es doble conteo» (learnings data_health 'cuotatramo:<venta>'): no vuelven a aparecer.
export function cuotaTramo(billing, sales, ignorados = new Set()) {
  const bySale = {}; (billing || []).forEach(b => { if (b.deleted_at || !b.sale_id) return; (bySale[String(b.sale_id)] = bySale[String(b.sale_id)] || []).push(b) })
  const out = []
  ;(sales || []).forEach(s => { if (s.deleted_at || !['Activo', 'Terminado'].includes(s.status) || s.cobro_type === 'mensual' || ignorados.has(String(s.id))) return
    const bs = bySale[String(s.id)] || []; if (!bs.length) return
    const prog = bs.filter(b => b.status === 'Programada').reduce((a, b) => a + montoFactura(b), 0)
    const emit = bs.filter(b => b.invoice_no && b.status !== 'Anulada').reduce((a, b) => a + montoFactura(b), 0)
    if (prog <= 0 || emit <= 0) return
    const venta = Math.round((Number(s.amount_uf) || 0) * (Number(s.uf_value) || 40000) + (Number(s.amount_clp) || 0))
    const exceso = prog + emit - venta
    if (venta > 0 && exceso > venta * 0.08 && exceso > 100000) out.push({ s, venta, prog, emit, exceso }) })
  return out.sort((a, b) => b.exceso - a.exceso)
}

// Clave del diccionario costo_oficina que guardó más de una categoría → la sugerencia sale no determinista. No cuenta la cuenta de
// una persona que recibe retiros, sueldo y bonos: eso lo decide el monto (redondo = retiro del socio), no la glosa.
const _CAT_PERSONA = new Set(['Retiros', 'Sueldos', 'Bono', 'Otros'])
export function glosaConflict(coRows) {
  const m = {}; (coRows || []).forEach(r => { if (!r.key) return; const cat = String(r.value || '').trim(); if (!cat) return; (m[r.key] = m[r.key] || {})[cat] = (m[r.key][cat] || 0) + 1 })
  return Object.entries(m).filter(([, v]) => Object.keys(v).length > 1 && !Object.keys(v).every(c => _CAT_PERSONA.has(c))).map(([k, v]) => ({ key: k, votos: Object.entries(v).sort((a, b) => b[1] - a[1]).map(([cat, n]) => ({ cat, n })) }))
}

// Emitidas sin cliente asignado: no cuentan en el por cobrar de nadie.
export const huerfanas = billing => (billing || []).filter(b => !b.deleted_at && b.status !== 'Anulada' && String(b.invoice_no || '').trim() && !b.client_id && !['reembolso', 'nota_credito'].includes(b.billing_type || ''))

// Vencimiento anterior a la emisión: se ve «vencida» recién emitida.
export const vencIncoh = billing => (billing || []).filter(b => !b.deleted_at && b.invoice_no && ['Pendiente', 'Vencido'].includes(b.status) && b.issued_at && b.due && String(b.due).slice(0, 10) < String(b.issued_at).slice(0, 10))

// Anticipo cargado a MANO (sin respaldo bancario, no marcado ·revisado) cuyo monto calza con los depósitos del banco del mismo
// cliente (la suma, o uno exacto).
// Anticipos de subarriendo (cada pago es de SU mes, según la nota): con la factura emitida de ese mes, por el mismo monto, sin abonos
// ni conciliación → «aplicar» (calce exacto y único por los dos lados); sin factura emitida de ese mes → «emitir» (pendiente de emisión).
const _MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
export const perTexto = p => { const [y, m] = String(p || '').split('-'); return y && m ? `${_MES[+m - 1]} ${y}` : '' }
const _per = t => { const x = String(t || '').toLowerCase(); const m = _MES.findIndex(n => x.includes(n)), y = (x.match(/\b(20\d\d)\b/) || [])[1]; return m >= 0 && y ? `${y}-${String(m + 1).padStart(2, '0')}` : null }
export function anticiposSubarriendo(anticipos, billing, sales, conciliacion) {
  const sub = new Set((sales || []).filter(s => s && (s.cobro_config?.subarriendo === true || s.area === 'Subarriendo')).map(s => String(s.id)))
  const conFac = new Set((conciliacion || []).filter(c => c.tipo_destino === 'factura' && c.factura_id).map(c => String(c.factura_id)))
  const facs = (billing || []).filter(b => b && !b.deleted_at && b.sale_id && sub.has(String(b.sale_id)) && b.status !== 'Anulada' && (b.billing_type || '') !== 'reembolso')
  const ants = (anticipos || []).filter(a => a && a.estado === 'disponible' && a.sale_id && sub.has(String(a.sale_id)) && (Number(a.monto) || 0) > 0 && _per(a.nota))
  const out = []
  for (const a of ants) {
    const per = _per(a.nota), monto = Math.round(Number(a.monto) || 0)
    const delMes = facs.filter(b => String(b.sale_id) === String(a.sale_id) && _per(b.concept) === per)
    const libres = delMes.filter(b => b.invoice_no && b.status !== 'Pagado' && !conFac.has(String(b.id)) && !(Number(b.paid_amount) > 0) && Math.round(Number(b.amount) || 0) === monto)
    const otros = ants.filter(x => x !== a && String(x.sale_id) === String(a.sale_id) && _per(x.nota) === per && Math.round(Number(x.monto) || 0) === monto)
    if (libres.length === 1 && !otros.length) out.push({ tipo: 'aplicar', a, b: libres[0], per })
    else if (!delMes.some(b => b.invoice_no)) out.push({ tipo: 'emitir', a, per })
  }
  return out
}

// Facturas recibidas dentro del plazo de reclamo (Registro de Compras del SII en estado PENDIENTE): 8 días corridos desde la
// recepción en el SII. vistas = las que alguien ya revisó sin reclamo (learnings compra_sin_reclamo). Reclamar se hace en el SII.
export const PLAZO_RECLAMO_DIAS = 8
export function comprasEnPlazoReclamo(docs, hoy, vistas = new Set()) {
  return (docs || []).filter(d => d && d.sii_estado === 'PENDIENTE' && d.fecha_recepcion && !vistas.has(String(d.id)) && Number(d.tipo_dte) !== 61)
    .map(d => { const rec = String(d.fecha_recepcion).slice(0, 10), vence = new Date(new Date(rec + 'T12:00').getTime() + PLAZO_RECLAMO_DIAS * 864e5).toISOString().slice(0, 10); return { d, rec, vence, quedan: _dias(vence, hoy) } })
    .filter(x => x.quedan >= 0).sort((a, b) => a.vence.localeCompare(b.vence))
}

// Compras de proveedores observados por el SII («Documentos observados» del RCV, W39): su crédito de IVA está objetado en el F29.
// vistas = las ya decididas (learnings compra_observada_vista: se rectifica o se acredita). La decisión se ejecuta en el SII.
export function comprasObservadasSII(docs, vistas = new Set()) {
  return (docs || []).filter(d => d && d.observado_sii && !vistas.has(String(d.id))).sort((a, b) => String(a.periodo || '').localeCompare(String(b.periodo || '')) || String(a.folio).localeCompare(String(b.folio)))
}

export function antDup(anticipos, conciliacion) {
  const bankIds = new Set((conciliacion || []).filter(c => c.tipo_destino === 'anticipo' && c.anticipo_id).map(c => String(c.anticipo_id)))
  const bankByCli = {}; (anticipos || []).forEach(a => { if (bankIds.has(String(a.id))) (bankByCli[String(a.client_id)] = bankByCli[String(a.client_id)] || []).push(a) })
  const out = []
  ;(anticipos || []).forEach(a => {
    if (bankIds.has(String(a.id)) || /·revisado/.test(a.nota || '') || (a.monto || 0) <= 0) return
    const banks = bankByCli[String(a.client_id)] || []; if (!banks.length) return
    const suma = banks.reduce((s, b) => s + (b.monto || 0), 0)
    const uno = banks.find(b => Math.abs((b.monto || 0) - (a.monto || 0)) <= 1)
    if (Math.abs(suma - (a.monto || 0)) <= 1) out.push({ manual: a, banks, suma })
    else if (uno) out.push({ manual: a, banks: [uno], suma: uno.monto || 0 })
  })
  return out
}

// Ventas en Borrador/Propuesta con facturas emitidas: trabajo real que queda fuera de «Vendido».
export function ventasBorradorCobrado(sales, billing) {
  const bySale = {}; (billing || []).forEach(b => { if (b.sale_id) (bySale[String(b.sale_id)] = bySale[String(b.sale_id)] || []).push(b) })
  return (sales || []).filter(s => !s.deleted_at && ['Borrador', 'Propuesta'].includes(s.status)).map(s => {
    const bs = (bySale[String(s.id)] || []).filter(b => !b.deleted_at && b.status !== 'Anulada' && b.invoice_no)
    const emitido = bs.reduce((a, b) => a + (Number(b.amount) || 0), 0)
    const pagado = bs.filter(b => b.status === 'Pagado').reduce((a, b) => a + (Number(b.amount) || 0), 0)
    return { s, emitido, pagado, n: bs.length }
  }).filter(x => x.emitido > 0).sort((a, b) => b.pagado - a.pagado)
}

// Honorario de la venta distinto de la suma de sus cuotas (vista v_ventas_salud). Una venta terminada cuyas facturas son todas
// anteriores a la app es histórico importado: no se marca.
export function honorarioDescuadrado(saludRows, billing, sales) {
  const ult = {}; (billing || []).forEach(b => { if (!b.sale_id || b.deleted_at) return; const k = String(b.sale_id), f = String(b.issued_at || b.due || ''); if (!ult[k] || f > ult[k]) ult[k] = f })
  const st = {}; (sales || []).forEach(s => { st[String(s.id)] = s.status })
  return (saludRows || []).filter(v => v.honorario_descuadrado && !(st[String(v.id)] === 'Terminado' && (ult[String(v.id)] || '') < APP_DESDE))
}

// Resumen para el auditor nocturno: un caso por fila de cada detector, con una clave estable (para saber si es nuevo, sigue o se
// resolvió), el título que se muestra y las filas que lo prueban.
export function hallazgos(d) {
  const nom = id => d.clientName?.(id) || '—'
  const out = []
  const add = (detector, clave, titulo, monto, prueba) => out.push({ detector, clave: `${detector}:${clave}`, titulo, monto: monto == null ? null : Math.round(monto), prueba })
  const bk = bancoChk(d.movs, d.conciliacion, d.pettyLinks, d.terceros)
  bk.sobre.forEach(m => add('banco_sobre', m.id, `Movimiento del banco conciliado por más de su monto · ${m.nombre_contraparte || m.descripcion || ''}`.trim(), bk.concBy[String(m.id)] - (Number(m.monto) || 0), { movimiento: m.id, fecha: m.fecha, monto: m.monto }))
  bk.doble.forEach(m => add('banco_doble', m.id, `Pago registrado como comisión y como gasto · ${m.nombre_contraparte || ''}`.trim(), m.monto, { movimiento: m.id, fecha: m.fecha }))
  bk.atras.forEach(m => add('banco_atras', m.id, `Movimiento con conciliación sin actualizar · ${m.nombre_contraparte || m.descripcion || ''}`.trim(), m.monto, { movimiento: m.id, fecha: m.fecha }))
  bk.sinBanco.forEach(t => add('comision_sin_banco', t.id, 'Comisión pagada sin su transferencia en el banco', t.monto, { tercero: t.id, pagado_at: t.pagado_at }))
  rutMulti(d.clientEntities).forEach(x => add('rut_varias_fichas', x.rut, `RUT ${x.rut} en ${x.clientIds.length} fichas · ${x.rs || ''}`.trim(), null, { clientes: x.clientIds }))
  folioDup(d.billing).forEach(x => add('folio_duplicado', x.folio, `Factura N° ${x.folio} en ${x.rows.length} filas`, x.rows[0]?.amount, { facturas: x.rows.map(b => b.id) }))
  facDup(d.billing).forEach(x => add('factura_duplicada', x.rows.map(b => b.id).sort().join('+'), `Facturas posiblemente duplicadas · ${nom(x.cid)} · ${x.concept || ''}`.trim(), x.amount, { facturas: x.rows.map(b => b.id) }))
  montoNeDte(d.billing).forEach(x => add('monto_distinto_dte', x.b.id, `Factura N° ${folioN(x.b.invoice_no) || '—'} · monto distinto del DTE · ${nom(x.b.client_id)}`, x.dte - x.b.amount, { factura: x.b.id, monto: x.b.amount, dte: x.dte }))
  ventasDup(d.sales).forEach(a => add('venta_duplicada', a.map(s => s.id).sort().join('+'), `Ventas que podrían estar duplicadas · ${nom(a[0].client_id)}`, null, { ventas: a.map(s => s.id) }))
  cuotaTramo(d.billing, d.sales, d.cuotaTramoNo || new Set()).forEach(x => add('cuota_tramo', x.s.id, `Cuotas programadas que superan la venta · ${nom(x.s.client_id)}`, x.exceso, { venta: x.s.id, venta_monto: x.venta, programado: x.prog, emitido: x.emit }))
  glosaConflict(d.coRows).forEach(x => add('glosa_conflicto', x.key, `Glosa con más de una categoría aprendida · ${x.key}`, null, { votos: x.votos }))
  huerfanas(d.billing).forEach(b => add('factura_sin_cliente', b.id, `Factura N° ${folioN(b.invoice_no)} sin cliente · ${b.receptor_name || ''}`.trim(), b.amount, { factura: b.id }))
  vencIncoh(d.billing).forEach(b => add('vencimiento_incoherente', b.id, `Factura N° ${folioN(b.invoice_no)} con vencimiento anterior a su emisión · ${nom(b.client_id)}`, b.amount, { factura: b.id, emision: b.issued_at, vence: b.due }))
  antDup(d.anticipos, d.conciliacion).forEach(x => add('anticipo_duplicado', x.manual.id, `Saldo a favor cargado a mano que calza con depósitos del banco · ${nom(x.manual.client_id)}`, x.manual.monto, { anticipo: x.manual.id, banco: x.banks.map(b => b.id) }))
  // Trabajos detenidos (regla única ventasReglas.trabajosDetenidos, calculada por quien llama para no importar en círculo).
  ;(d.detenidos || []).forEach(x => x.tipo === 'terminado'
    ? add('trabajo_terminado', x.s.id, `Trabajo activo sin movimiento hace ${x.dias} días y sin saldo · ${nom(x.s.client_id)} · ${x.s.title || ''}`.trim(), 0, { venta: x.s.id, ult: x.ult })
    : add('trabajo_detenido_saldo', x.s.id, `Trabajo sin movimiento hace ${x.dias} días con saldo por cobrar · ${nom(x.s.client_id)} · ${x.s.title || ''}`.trim(), x.porCobrar, { venta: x.s.id, ult: x.ult, facturas: x.facturas }))
  ventasBorradorCobrado(d.sales, d.billing).forEach(x => add('venta_borrador_facturada', x.s.id, `Venta en ${x.s.status} con facturas emitidas · ${nom(x.s.client_id)}`, x.emitido, { venta: x.s.id, facturas: x.n, pagado: x.pagado }))
  anticiposSubarriendo(d.anticipos, d.billing, d.sales, d.conciliacion).forEach(x => x.tipo === 'aplicar'
    ? add('anticipo_por_aplicar', x.a.id, `Pago de subarriendo que calza con la Factura N° ${folioN(x.b.invoice_no)} · ${nom(x.a.client_id)}`, x.a.monto, { anticipo: x.a.id, factura: x.b.id, periodo: x.per })
    : add('subarriendo_por_facturar', x.a.id, `Subarriendo de ${perTexto(x.per)} pagado sin factura · ${nom(x.a.client_id)}`, x.a.monto, { anticipo: x.a.id, periodo: x.per }))
  comprasObservadasSII(d.comprasObs, d.comprasObsVistas).forEach(x => add('compra_observada_sii', x.id, `Factura N° ${x.folio} de ${x.emisor_name || 'proveedor'} · proveedor observado por el SII${x.periodo ? ` · ${perTexto(x.periodo)}` : ''}`, Number(x.observado_iva) || 0, { folio: x.folio, periodo: x.periodo || null }))
  comprasEnPlazoReclamo(d.compras, d.hoy || new Date().toISOString().slice(0, 10), d.comprasVistas).forEach(x => add('compra_plazo_reclamo', x.d.id, `Factura N° ${x.d.folio} de ${x.d.emisor_name || 'proveedor'} · plazo de reclamo hasta el ${x.vence.split('-').reverse().join('-')}`, x.d.monto, { compra: x.d.id, vence: x.vence }))
  // Permisos de la base fuera de la regla (rpc auditoria_permisos): la consola de Supabase crea tablas abiertas al rol sin sesión.
  const PERM_TXT = { tabla_sin_sesion: x => `Tabla ${x.objeto} con permisos para usuarios sin sesión (${x.detalle})`, tabla_sin_rls: x => `Tabla ${x.objeto} sin RLS`, funcion_sin_sesion: x => `Función ${x.objeto} ejecutable sin sesión` }
  ;(d.permisos || []).forEach(x => add('permiso_sin_sesion', `${x.tipo}:${x.objeto}`, (PERM_TXT[x.tipo] || (y => `${y.tipo} ${y.objeto}`))(x), null, { tipo: x.tipo, objeto: x.objeto, detalle: x.detalle }))
  honorarioDescuadrado(d.saludRows, d.billing, d.sales).forEach(v => add('honorario_descuadrado', v.id, `Honorario distinto de la suma de sus cuotas · ${nom(v.client_id)} · ${v.title || ''}`.trim(), (Number(v.amount_clp) || 0) - (Number(v.suma_cuotas) || 0), { venta: v.id, honorario: v.amount_clp, cuotas: v.suma_cuotas }))
  return out
}

export const DETECTOR_LBL = {
  permiso_sin_sesion: 'Permisos de la base fuera de la regla',
  compra_observada_sii: 'Compras de proveedores observados por el SII',
  trabajo_terminado: 'Trabajos activos que parecen terminados', trabajo_detenido_saldo: 'Trabajos sin movimiento con saldo por cobrar',
  banco_sobre: 'Banco conciliado de más', banco_doble: 'Pago contado dos veces', banco_atras: 'Conciliación sin actualizar', comision_sin_banco: 'Comisión pagada sin transferencia',
  rut_varias_fichas: 'RUT en varias fichas', folio_duplicado: 'Folio duplicado', factura_duplicada: 'Facturas posiblemente duplicadas', monto_distinto_dte: 'Monto distinto del DTE',
  venta_duplicada: 'Ventas posiblemente duplicadas', cuota_tramo: 'Cuotas que superan la venta', glosa_conflicto: 'Glosa con dos categorías', factura_sin_cliente: 'Factura sin cliente',
  vencimiento_incoherente: 'Vencimiento anterior a la emisión', anticipo_duplicado: 'Saldo a favor duplicado', venta_borrador_facturada: 'Venta en borrador con facturas', honorario_descuadrado: 'Honorario descuadrado', anticipo_por_aplicar: 'Anticipo por aplicar', subarriendo_por_facturar: 'Subarriendo por facturar', compra_plazo_reclamo: 'Factura recibida en plazo de reclamo',
}
