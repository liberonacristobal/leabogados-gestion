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
export function cuotaTramo(billing, sales) {
  const bySale = {}; (billing || []).forEach(b => { if (b.deleted_at || !b.sale_id) return; (bySale[String(b.sale_id)] = bySale[String(b.sale_id)] || []).push(b) })
  const out = []
  ;(sales || []).forEach(s => { if (s.deleted_at || !['Activo', 'Terminado'].includes(s.status) || s.cobro_type === 'mensual') return
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
  cuotaTramo(d.billing, d.sales).forEach(x => add('cuota_tramo', x.s.id, `Cuotas programadas que superan la venta · ${nom(x.s.client_id)}`, x.exceso, { venta: x.s.id, venta_monto: x.venta, programado: x.prog, emitido: x.emit }))
  glosaConflict(d.coRows).forEach(x => add('glosa_conflicto', x.key, `Glosa con más de una categoría aprendida · ${x.key}`, null, { votos: x.votos }))
  huerfanas(d.billing).forEach(b => add('factura_sin_cliente', b.id, `Factura N° ${folioN(b.invoice_no)} sin cliente · ${b.receptor_name || ''}`.trim(), b.amount, { factura: b.id }))
  vencIncoh(d.billing).forEach(b => add('vencimiento_incoherente', b.id, `Factura N° ${folioN(b.invoice_no)} con vencimiento anterior a su emisión · ${nom(b.client_id)}`, b.amount, { factura: b.id, emision: b.issued_at, vence: b.due }))
  antDup(d.anticipos, d.conciliacion).forEach(x => add('anticipo_duplicado', x.manual.id, `Saldo a favor cargado a mano que calza con depósitos del banco · ${nom(x.manual.client_id)}`, x.manual.monto, { anticipo: x.manual.id, banco: x.banks.map(b => b.id) }))
  ventasBorradorCobrado(d.sales, d.billing).forEach(x => add('venta_borrador_facturada', x.s.id, `Venta en ${x.s.status} con facturas emitidas · ${nom(x.s.client_id)}`, x.emitido, { venta: x.s.id, facturas: x.n, pagado: x.pagado }))
  honorarioDescuadrado(d.saludRows, d.billing, d.sales).forEach(v => add('honorario_descuadrado', v.id, `Honorario distinto de la suma de sus cuotas · ${nom(v.client_id)} · ${v.title || ''}`.trim(), (Number(v.amount_clp) || 0) - (Number(v.suma_cuotas) || 0), { venta: v.id, honorario: v.amount_clp, cuotas: v.suma_cuotas }))
  return out
}

export const DETECTOR_LBL = {
  banco_sobre: 'Banco conciliado de más', banco_doble: 'Pago contado dos veces', banco_atras: 'Conciliación sin actualizar', comision_sin_banco: 'Comisión pagada sin transferencia',
  rut_varias_fichas: 'RUT en varias fichas', folio_duplicado: 'Folio duplicado', factura_duplicada: 'Facturas posiblemente duplicadas', monto_distinto_dte: 'Monto distinto del DTE',
  venta_duplicada: 'Ventas posiblemente duplicadas', cuota_tramo: 'Cuotas que superan la venta', glosa_conflicto: 'Glosa con dos categorías', factura_sin_cliente: 'Factura sin cliente',
  vencimiento_incoherente: 'Vencimiento anterior a la emisión', anticipo_duplicado: 'Saldo a favor duplicado', venta_borrador_facturada: 'Venta en borrador con facturas', honorario_descuadrado: 'Honorario descuadrado',
}
