// Facturas del tercero ↔ cuotas. Compartida por la app (Proveedores y «Por revisar» de Facturación).
// El estudio factura la cuota «N de M» al cliente (billing) y, por cada una, hay una fila en terceros_pagos con la parte del tercero.
// El tercero emite su propia factura, que el Registro de Compras del SII trae a sii_compras_docs. Estas reglas (puras, sin red ni base)
// proponen el calce factura ↔ cuota, detectan lo que falta o no cuadra y arman la cadena de cada cuota.
// Las filas sin factura nuestra emitida (provisión de cuotas futuras) NUNCA cuentan como faltantes.

export const TERCERO_TOLERANCIA = 0.01      // diferencia aceptada entre la factura del tercero y la parte esperada (UF del día)
export const TERCERO_DIA_LIMITE = 10        // día del mes siguiente a nuestra factura desde el cual la ausente se marca
export const TERCERO_APP_DESDE = '2026-06-06' // antes de esta fecha lo emitido es histórico importado: no genera alerta

const _rut = (/** @type {any} */ r) => String(r || '').toUpperCase().replace(/[^0-9K]/g, '')
const _f10 = (/** @type {any} */ d) => String(d || '').slice(0, 10)
const _n = (/** @type {any} */ x) => Number(x) || 0
// Folios de un factura_numero escrito a mano («1170», «1170 / 1171»): sin ceros a la izquierda.
const _folios = (/** @type {any} */ s) => String(s || '').split(/[^0-9]+/).filter(Boolean).map(x => x.replace(/^0+(?=\d)/, ''))
const _folio = (/** @type {any} */ f) => String(f || '').trim().replace(/^0+(?=\d)/, '')
const _montoDoc = (/** @type {any} */ d) => Math.abs(_n(d && d.monto))
const _esFacturaTercero = (/** @type {any} */ d) => { const t = Number(d && d.tipo_dte); return t === 33 || t === 34 }
const _pct = (/** @type {number} */ real, /** @type {number} */ esperado) => esperado > 0 ? (real - esperado) / esperado : 0

/** Nuestra factura emitida (con folio, vigente, no provisión programada ni nota de crédito / reembolso). */
export function facturaEmitida(/** @type {any} */ b) {
  if (!b || b.deleted_at || b.status === 'Anulada' || b.status === 'Programada') return false
  if (!(b.invoice_no || b.folio)) return false
  return !['nota_credito', 'reembolso'].includes(b.billing_type)
}

/** Fecha límite (día 10 del mes siguiente) de una factura emitida el `issued`. */
export function fechaLimiteTercero(/** @type {any} */ issued, dia = TERCERO_DIA_LIMITE) {
  const y = Number(_f10(issued).slice(0, 4)), m = Number(_f10(issued).slice(5, 7))
  if (!y || !m) return ''
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1
  return `${ny}-${String(nm).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

/** Contexto común: pagos y documentos del proveedor, y la factura nuestra de cada pago. */
function _ctx(/** @type {any} */ a) {
  const { docs, pagos, billing, proveedor } = a
  const rut = _rut(proveedor && proveedor.rut), pid = proveedor && proveedor.id != null ? String(proveedor.id) : ''
  const bById = new Map((billing || []).map((/** @type {any} */ b) => [String(b.id), b]))
  const misPagos = (pagos || []).filter((/** @type {any} */ t) => (pid && String(t.proveedor_id) === pid) || (!t.proveedor_id && rut && _rut(t.rut) === rut))
  const misDocs = (docs || []).filter((/** @type {any} */ d) => rut && _rut(d.emisor_rut) === rut && _esFacturaTercero(d) && _folio(d.folio))
  const fac = (/** @type {any} */ t) => t && t.billing_id != null ? bById.get(String(t.billing_id)) : undefined
  return { rut, pid, misPagos, misDocs, fac }
}

/**
 * Calce factura del tercero ↔ cuota. Para cada documento del SII del proveedor (33/34, aún no ligado a una cuota por factura_numero)
 * propone la cuota sin factura_numero, con factura nuestra emitida, cuyo monto esperado queda dentro de la tolerancia. Los documentos
 * se recorren en orden de emisión y las cuotas en el orden en que se facturaron (la más antigua primero); una cuota ya propuesta sale
 * del universo, de modo que lo que era ambiguo puede resolverse con la siguiente vuelta. Si hay más de una cuota posible o ninguna
 * dentro de tolerancia, no propone y deja el motivo. `descartes`: claves `${doc.id}|${pago.id}` ya rechazadas por el usuario.
 */
export function propuestasCuadre(/** @type {any} */ args) {
  const { docs = [], pagos = [], billing = [], proveedor = null, tolerancia = TERCERO_TOLERANCIA, descartes = new Set() } = args || {}
  const { misPagos, misDocs, fac } = _ctx({ docs, pagos, billing, proveedor })
  const usados = new Set(misPagos.flatMap((/** @type {any} */ t) => _folios(t.factura_numero)))
  const libres = misDocs.filter((/** @type {any} */ d) => !usados.has(_folio(d.folio)) && _montoDoc(d) > 0)
    .sort((/** @type {any} */ a, /** @type {any} */ b) => _f10(a.fecha_emision).localeCompare(_f10(b.fecha_emision)) || _folio(a.folio).localeCompare(_folio(b.folio), 'es', { numeric: true }))
  const cuotas = misPagos.filter((/** @type {any} */ t) => !String(t.factura_numero || '').trim() && facturaEmitida(fac(t)) && _n(t.monto) > 0)
    .sort((/** @type {any} */ a, /** @type {any} */ b) => _f10(fac(a).issued_at).localeCompare(_f10(fac(b).issued_at)) || String(a.id).localeCompare(String(b.id)))
  /** @type {{doc:any,pago:any,diferencia:number,pct:number}[]} */
  const propuestas = []
  const tomadas = new Set(), hechos = new Set()
  let cambio = true
  while (cambio) {
    cambio = false
    for (const d of libres) {
      if (hechos.has(String(d.id))) continue
      const m = _montoDoc(d)
      const posibles = cuotas.filter((/** @type {any} */ t) => !tomadas.has(String(t.id)) && !descartes.has(`${d.id}|${t.id}`) && Math.abs(_pct(m, _n(t.monto))) <= tolerancia)
      if (posibles.length !== 1) continue
      const t = posibles[0]
      propuestas.push({ doc: d, pago: t, diferencia: m - _n(t.monto), pct: _pct(m, _n(t.monto)) })
      tomadas.add(String(t.id)); hechos.add(String(d.id)); cambio = true
    }
  }
  const noResueltas = libres.filter((/** @type {any} */ d) => !hechos.has(String(d.id))).map((/** @type {any} */ d) => {
    const m = _montoDoc(d)
    const posibles = cuotas.filter((/** @type {any} */ t) => !tomadas.has(String(t.id)) && !descartes.has(`${d.id}|${t.id}`) && Math.abs(_pct(m, _n(t.monto))) <= tolerancia)
    return { doc: d, motivo: posibles.length > 1 ? 'varias_cuotas' : cuotas.length ? 'fuera_tolerancia' : 'sin_cuota', candidatas: posibles }
  })
  propuestas.sort((a, b) => _f10(a.doc.fecha_emision).localeCompare(_f10(b.doc.fecha_emision)))
  return { propuestas, noResueltas }
}

/**
 * Alertas del tercero:
 *  · esperada_sin_emitir: nuestra factura emitida en el mes M, sin factura_numero ni propuesta, y hoy > día 10 del mes M+1 (antes es «esperada»);
 *    solo cuotas aún no pagadas y emitidas desde que existe la app (lo anterior es histórico).
 *  · monto: la cuota tiene factura_numero y el documento del SII difiere más de la tolerancia.
 *  · folio_repetido: el mismo factura_numero en dos cuotas con facturas nuestras distintas.
 *  · emisor_distinto: el documento del SII con ese folio es de otro RUT que el del proveedor.
 */
export function alertasTercero(/** @type {any} */ args) {
  const { pagos = [], docs = [], billing = [], proveedor = null, hoy = '', tolerancia = TERCERO_TOLERANCIA, descartes = new Set(), desde = TERCERO_APP_DESDE } = args || {}
  const { rut, misPagos, misDocs, fac } = _ctx({ docs, pagos, billing, proveedor })
  /** @type {{tipo:string,pago:any,doc?:any,detalle:string,pct?:number}[]} */
  const out = []
  const conPropuesta = new Set(propuestasCuadre({ docs, pagos, billing, proveedor, tolerancia, descartes }).propuestas.map(p => String(p.pago.id)))
  const h = _f10(hoy)
  for (const t of misPagos) {
    if (String(t.factura_numero || '').trim() || t.estado === 'pagado') continue
    const b = fac(t)
    if (!facturaEmitida(b) || _n(t.monto) <= 0 || _f10(b.issued_at) < desde || conPropuesta.has(String(t.id))) continue
    const lim = fechaLimiteTercero(b.issued_at)
    if (h && lim && h > lim) out.push({ tipo: 'esperada_sin_emitir', pago: t, detalle: lim })
  }
  /** @type {Map<string, any[]>} */
  const porFolio = new Map()
  for (const t of misPagos) for (const f of new Set(_folios(t.factura_numero))) porFolio.set(f, [...(porFolio.get(f) || []), t])
  for (const [f, ts] of porFolio) {
    const distintas = new Set(ts.map(t => String(t.billing_id || t.id)))
    if (distintas.size > 1) { out.push({ tipo: 'folio_repetido', pago: ts[0], detalle: f }); continue }
    for (const t of ts) {
      if (_folios(t.factura_numero).length !== 1) continue
      const propio = misDocs.find((/** @type {any} */ d) => _folio(d.folio) === f)
      if (propio) {
        const e = _n(t.monto), p = _pct(_montoDoc(propio), e)
        if (e > 0 && Math.abs(p) > tolerancia) out.push({ tipo: 'monto', pago: t, doc: propio, detalle: f, pct: p })
        continue
      }
      const otro = (docs || []).find((/** @type {any} */ d) => _esFacturaTercero(d) && _folio(d.folio) === f && rut && _rut(d.emisor_rut) !== rut)
      if (otro) out.push({ tipo: 'emisor_distinto', pago: t, doc: otro, detalle: f })
    }
  }
  return out
}

/**
 * Cadena de cada cuota (solo las con factura nuestra emitida; la provisión futura se cuenta aparte): cuatro hitos —
 * facturamos al cliente · el cliente paga · debemos al tercero · pagamos al tercero— y los totales.
 * `montoBill`: función única del monto de nuestra factura (la app pasa montoFactura).
 */
export function cadenaCuotas(/** @type {any} */ args) {
  const { pagos = [], docs = [], billing = [], proveedor = null, hoy = '', descartes = new Set(), tolerancia = TERCERO_TOLERANCIA, montoBill = (/** @type {any} */ b) => _n(b && b.amount) } = args || {}
  const { misPagos, misDocs, fac } = _ctx({ docs, pagos, billing, proveedor })
  const prop = new Map(propuestasCuadre({ docs, pagos, billing, proveedor, tolerancia, descartes }).propuestas.map(p => [String(p.pago.id), p]))
  const h = _f10(hoy)
  const cuotas = misPagos.filter((/** @type {any} */ t) => facturaEmitida(fac(t)))
    .sort((/** @type {any} */ a, /** @type {any} */ b) => _f10(fac(a).issued_at).localeCompare(_f10(fac(b).issued_at)) || String(a.id).localeCompare(String(b.id)))
    .map((/** @type {any} */ t) => {
      const b = fac(t), fn = String(t.factura_numero || '').trim()
      const doc = fn ? misDocs.find((/** @type {any} */ d) => _folios(fn).includes(_folio(d.folio))) : null
      const p = prop.get(String(t.id))
      const lim = fechaLimiteTercero(b.issued_at)
      /** @type {'recibida'|'registrada'|'propuesta'|'esperada'|'sin_emitir'} */
      const factura = doc ? 'recibida' : fn ? 'registrada' : p ? 'propuesta' : (h && lim && h > lim && t.estado !== 'pagado' && _f10(b.issued_at) >= TERCERO_APP_DESDE) ? 'sin_emitir' : 'esperada'
      const clientePagoOk = b.status === 'Pagado' || b.status === 'Anticipada'
      return {
        pago: t, billing: b,
        facturamos: { ok: true, folio: String(b.invoice_no || b.folio), fecha: _f10(b.issued_at), monto: _n(montoBill(b)) },
        clientePaga: { ok: clientePagoOk, vencida: b.status === 'Vencido', fecha: clientePagoOk ? _f10(b.paid_at) : '' },
        debemos: { monto: _n(t.monto), factura, folio: fn || (p ? String(p.doc.folio) : ''), doc: doc || (p ? p.doc : null), fecha: doc ? _f10(doc.fecha_emision) : '', limite: lim },
        pagamos: { ok: t.estado === 'pagado', fecha: t.estado === 'pagado' ? _f10(t.pagado_at) : '', habilitado: clientePagoOk },
      }
    })
  const provision = misPagos.filter((/** @type {any} */ t) => !facturaEmitida(fac(t)) && t.estado !== 'pagado').length
  const conFactura = cuotas.filter(c => c.debemos.factura === 'recibida')
  return {
    cuotas, provision,
    totales: {
      n: cuotas.length, nConFactura: conFactura.length,
      facturado: cuotas.reduce((a, c) => a + c.facturamos.monto, 0),
      parteTercero: cuotas.reduce((a, c) => a + c.debemos.monto, 0),
      conFactura: conFactura.reduce((a, c) => a + c.debemos.monto, 0),
    },
  }
}

/** Resumen de un proveedor: propuestas + alertas (lo «por revisar») y su cadena. Una sola entrada para la ficha y para Facturación. */
export function resumenTercero(/** @type {any} */ args) {
  const { propuestas, noResueltas } = propuestasCuadre(args)
  const alertas = alertasTercero(args)
  return { propuestas, noResueltas, alertas, cadena: cadenaCuotas(args), nRevisar: propuestas.length + alertas.length }
}
