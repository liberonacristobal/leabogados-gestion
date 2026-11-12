// «Impuestos mensuales»: lo que el estudio paga al SII cada mes en el F29, separado en sus tres partes. Reglas ÚNICAS y puras (la usan la planilla del mes,
// el lector del correo de la contadora y el Presupuesto); no leen ni escriben la base.
//   PPM = lo declarado en el F29 (f29_declarados.ppm) o, mientras no esté declarado, la tasa declarada (la que más se repite en los últimos 6 F29; 2 % por defecto) × la base del mes
//         (facturas del Registro de Ventas del SII, sin IVA, menos notas de crédito; f29Reglas.f29Base). La tasa legal del PPM de presupuesto.js (tasaPPMLegal) es solo referencia: no es lo que se declara.
//   Retención de honorarios = retención de las boletas de honorarios del mes (por persona que emite boleta) + las boletas esperadas por pagos sin boleta cargada
//         (sueldos a quien paga con boleta y comisiones con retención registrada): bruto = líquido ÷ (1 − tasa).
//   Impuesto único de trabajadores = el de las liquidaciones del mes (remuneraciones_tributables), por trabajador.
// Total del mes = suma de las tres. Contra el «Iva» del correo de la contadora debe cuadrar al peso; si no, la diferencia queda «por verificar».
import { tasaBHE } from './comisionesReglas.js'

const _norm = (/** @type {any} */ s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const _ymMenos = (/** @type {string} */ ym) => { const d = new Date(`${ym}-01T12:00:00`); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7) }
const _n = (/** @type {any} */ x) => Number(x) || 0

// ── Primitivas del F29 (las reexporta f29Reglas) ──
export const TASA_PPM = 0.02

const _ymMas = (ym, n) => { const d = new Date(`${ym}-01T12:00:00`); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 7) }
export const f29PerAnterior = per => _ymMas(per, -1)

// Base del PPM: facturas y notas de débito del mes menos notas de crédito. Afectas (33/56) sin IVA; exentas (34) por su total.
export function f29Base(docs, per) {
  let b = 0, n = 0
  for (const d of docs || []) {
    if (String(d.fecha_emision || d.fecha || '').slice(0, 7) !== per) continue
    const t = Number(d.tipo_dte), m = Number(d.monto) || 0
    if (t === 34) { b += m; n++ } else if (t === 33 || t === 56) { b += Math.round(m / 1.19); n++ } else if (t === 61) b -= m
  }
  return { base: b, n }
}
export function f29Retenciones(boletas, per) {
  const l = (boletas || []).filter(x => String(x.fecha || '').slice(0, 7) === per && x.estado !== 'anulada')
  return { ret: l.reduce((a, x) => a + (Number(x.retencion) || 0), 0), n: l.length }
}

// Tasa del PPM según lo declarado: la que más se repite en los últimos 6 F29 anteriores al período (empate → la más reciente).
export function f29TasaDeclarada(declarados, per) {
  const prev = Object.keys(declarados || {}).filter(k => k < per).sort().slice(-6)
  if (!prev.length) return null
  const n = {}; prev.forEach(k => { const t = Number(declarados[k]?.tasa_ppm); if (t > 0) n[t] = (n[t] || 0) + 1 })
  const best = Object.entries(n).sort((a, b) => b[1] - a[1] || prev.map(k => Number(declarados[k]?.tasa_ppm)).lastIndexOf(Number(b[0])) - prev.map(k => Number(declarados[k]?.tasa_ppm)).lastIndexOf(Number(a[0])))[0]
  return best ? Number(best[0]) / 100 : null
}

/** Bruto de una boleta de honorarios desde su líquido: el menor bruto tal que bruto − round(bruto × tasa) = líquido (como lo emite el SII: 500.000 líquidos con 15,25 % son 589.970 brutos y 89.970 de retención). @param {number} liquido @param {number} tasa */
export function brutoDeLiquido(liquido, tasa) {
  const l = Math.round(_n(liquido)), t = _n(tasa), b0 = Math.floor(l / (1 - t))
  for (let b = Math.max(0, b0 - 1); b <= b0 + 2; b++) if (b - Math.round(b * t) === l) return b
  return Math.round(l / (1 - t))
}

/** Mes trabajado de un pago de sueldo: hasta el día 10 cuenta para el mes anterior (misma regla de remuneracionesBancoMes). @param {string} fecha */
export const mesTrabajadoDePago = (fecha) => { const d = String(fecha || '').slice(0, 10); if (d.length < 10) return ''; return Number(d.slice(8, 10)) <= 10 ? _ymMenos(d.slice(0, 7)) : d.slice(0, 7) }

/** ¿Dos nombres son la misma persona? Todas las palabras del más corto están en el otro (la boleta trae el nombre completo; el pago, el nombre de pila). @param {string} a @param {string} b */
export function mismaPersona(a, b) {
  const x = _norm(a).split(' ').filter((t) => t.length > 1), y = _norm(b).split(' ').filter((t) => t.length > 1)
  if (!x.length || !y.length) return false
  const [c, l] = x.length <= y.length ? [x, y] : [y, x]
  return c.every((t) => l.includes(t))
}

/** Mapa { RUT normalizado: nombre } de los emisores con un destino dado (p. ej. 'contabilidad' → la contadora); sale de las decisiones guardadas, sin RUT escritos en código. @param {Record<string,string>} destinos @param {string} destino @param {string} nombre */
export const rutsDeDestino = (destinos, destino, nombre) => Object.fromEntries(Object.entries(destinos || {}).filter(([k, v]) => v === destino && rutNormal(k)).map(([k]) => [rutNormal(k), nombre]))

/** Cliente interno de la oficina (sus gastos «Sueldos» son los de la planilla): una sola regla para la planilla, el calendario y los lectores del servidor. @param {any[]} clients */
export const idOficina = (clients) => { const c = (clients || []).find((x) => x && (x.is_internal || /liberona\s+escala/i.test(x.name || ''))); return c ? c.id : null }

/** RUT normalizado para llaves de decisiones: sin puntos ni guion, dígito verificador en mayúscula (11.111.111-1 → 111111111). @param {any} rut */
export const rutNormal = (rut) => String(rut || '').replace(/[^0-9kK]/g, '').toUpperCase()

/**
 * Destino de cada emisor de boleta (decisión reutilizable, learnings kind='boleta_destino', key = RUT normalizado): dónde ya está costeado lo que se le paga.
 * 'contabilidad' = ya en la partida Contadora/Contabilidad · 'gasto_oficina' = ya entra por Gastos varios o el banco · 'comision' = ya en Comisiones · 'cliente' = gasto de un cliente, fuera de costos de oficina · vacío = por clasificar.
 */
export const DESTINOS_BOLETA = ['contabilidad', 'gasto_oficina', 'comision', 'cliente']
export const ETIQ_DESTINO = { contabilidad: 'ya en Contabilidad', gasto_oficina: 'ya en gastos de oficina', comision: 'ya en Comisiones', cliente: 'gasto de un cliente', remuneracion: 'remuneración propia', '': 'por clasificar' }

/**
 * Destino de un emisor: la decisión guardada por su RUT; si no hay, 'comision' cuando tiene pagos en terceros_pagos; 'remuneracion' si paga con boleta (miembro); si no, '' (por clasificar).
 * @param {{ rut?:any, nombre?:any, proveedor_id?:any }} e @param {Record<string,string>} [destinos] @param {any[]} [terceros] @param {string[]} [boletaSet]
 * @returns {string}
 */
export function destinoDeEmisor(e, destinos = {}, terceros = [], boletaSet = []) {
  const d = destinos && destinos[rutNormal(e && e.rut)]
  if (d && DESTINOS_BOLETA.includes(d)) return d
  if ((boletaSet || []).some((nom) => mismaPersona(nom, e && e.nombre))) return 'remuneracion'
  if ((terceros || []).some((t) => t && t.estado === 'pagado' && ((e.proveedor_id && t.proveedor_id && String(e.proveedor_id) === String(t.proveedor_id)) || mismaPersona(t.proveedor, e.nombre)))) return 'comision'
  return ''
}

/**
 * Pagos de honorarios que deben tener boleta y no la tienen cargada. `pagos` = [{ persona, fecha (del pago), liquido, retencion?, origen:'sueldo'|'comision', proveedor_id?, bhe_id? }].
 * Una boleta cubre un pago si es de la misma persona (o proveedor) y de su mes (sueldo: mes trabajado; comisión: mes del pago), o si su líquido calza con el pago (±$2) dentro de 10 días. Cada boleta cubre un solo pago.
 * Estado: «falta» = la boleta se debe y no está (comisión con retención registrada, o mes sin F29 declarado); «por verificar» = sueldo de un mes con F29 declarado que no trae su retención (no se sabe si emitió la boleta).
 * @param {{ pagos?:any[], boletas?:any[], declarados?:Record<string,any> }} a
 * @returns {Array<{ per:string, persona:string, pagado:string, liquido:number, bruto:number, retencion:number, tasa:number, origen:string, estado:'falta'|'por verificar' }>}
 */
export function boletasPorCargar({ pagos = [], boletas = [], declarados = {} } = {}) {
  const vivas = (boletas || []).filter((b) => b && b.estado !== 'anulada')
  const usadas = new Set()
  const out = []
  const orden = [...(pagos || [])].filter((p) => p && _n(p.liquido) > 0).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))
  for (const p of orden) {
    if (p.bhe_id) continue   // ya ligado a su boleta
    const per = p.origen === 'sueldo' ? mesTrabajadoDePago(p.fecha) : String(p.fecha || '').slice(0, 7)
    if (!per) continue
    const cubre = vivas.findIndex((b, i) => !usadas.has(i) && ((p.proveedor_id && b.proveedor_id && String(p.proveedor_id) === String(b.proveedor_id)) || mismaPersona(p.persona, b.emisor_nombre))
      && (String(b.fecha || '').slice(0, 7) === per || (Math.abs(_n(b.liquido) - _n(p.liquido)) <= 2 && Math.abs(Date.parse(String(b.fecha).slice(0, 10)) - Date.parse(String(p.fecha).slice(0, 10))) <= 10 * 86400000)))
    if (cubre >= 0) { usadas.add(cubre); continue }
    const tasa = _n(p.tasa) > 0 ? _n(p.tasa) : tasaBHE(p.fecha), bruto = p.origen === 'comision' && _n(p.bruto) > 0 ? Math.round(_n(p.bruto)) : brutoDeLiquido(p.liquido, tasa)
    const retencion = p.origen === 'comision' && _n(p.retencion) > 0 ? Math.round(_n(p.retencion)) : bruto - Math.round(_n(p.liquido))
    const d = declarados && declarados[per]
    const declaradoSinEsta = d && d.retencion_bhe != null
    const estado = /** @type {'falta'|'por verificar'} */ (p.origen === 'comision' || !declaradoSinEsta ? 'falta' : 'por verificar')
    out.push({ per, persona: String(p.persona || ''), pagado: String(p.fecha).slice(0, 10), liquido: Math.round(_n(p.liquido)), bruto, retencion, tasa, origen: String(p.origen || ''), estado })
  }
  return out
}

/**
 * Las tres partes del F29 de un mes.
 * @param {{ per:string, docs?:any[], boletas?:any[], pagos?:any[], liquidaciones?:any[], declarados?:Record<string,any>, informado?:number|null, tasa?:number|null, destinos?:Record<string,string>, terceros?:any[], boletaSet?:string[] }} a
 *   docs = sii_cargas_docs (tipo_dte, monto, fecha_emision); boletas = boletas_honorarios; pagos = ver boletasPorCargar; liquidaciones = remuneraciones_tributables; declarados = f29_declarados por período; informado = «Iva» del correo de la contadora.
 */
export function impuestosMensuales({ per, docs = [], boletas = [], pagos = [], liquidaciones = [], declarados = {}, informado = null, tasa: tasaPpm = null, destinos = {}, terceros = [], boletaSet = [] }) {
  const d = declarados && declarados[per] ? declarados[per] : null
  // PPM
  const tasa = tasaPpm ?? f29TasaDeclarada(declarados, per) ?? TASA_PPM, { base, n: nDocs } = f29Base(docs, per)
  const ppm = d && d.ppm != null ? { monto: _n(d.ppm), fuente: 'declarado', estado: 'verificado', base: d.base_ppm != null ? _n(d.base_ppm) : base, tasa: d.tasa_ppm != null ? _n(d.tasa_ppm) / 100 : tasa, nDocs }
    : { monto: Math.round(base * tasa), fuente: 'estimado', estado: 'estimado', base, tasa, nDocs }
  // Retención de honorarios: boletas del mes (por persona) + las esperadas
  const delMes = (boletas || []).filter((b) => b && b.estado !== 'anulada' && String(b.fecha || '').slice(0, 7) === per)
  /** @type {Record<string, { persona:string, boletas:any[], monto:number, rut:string, proveedor_id:any }>} */
  const por = {}
  const grupo = (/** @type {string} */ nombre) => { const k = Object.keys(por).find((x) => mismaPersona(x, nombre)) || nombre; return por[k] || (por[k] = { persona: k, boletas: [], monto: 0, rut: '', proveedor_id: null }) }
  for (const b of delMes) { const g = grupo(String(b.emisor_nombre || 'Sin nombre')), r = _n(b.retencion); if (!g.rut) g.rut = rutNormal(b.emisor_rut); if (!g.proveedor_id) g.proveedor_id = b.proveedor_id || null; g.boletas.push({ folio: b.folio, fecha: String(b.fecha).slice(0, 10), bruto: _n(b.bruto), retencion: r, tasa: _n(b.tasa) || tasaBHE(b.fecha), sinEnlace: !b.movimiento_id, falta: false, id: b.id }); g.monto += r }
  const faltan = boletasPorCargar({ pagos, boletas, declarados }).filter((x) => x.per === per)
  for (const f of faltan) {
    const g = grupo(f.persona); g.boletas.push({ folio: null, fecha: null, pagado: f.pagado, bruto: f.bruto, retencion: f.retencion, tasa: f.tasa, sinEnlace: false, falta: f.estado === 'falta', porVerificar: f.estado === 'por verificar' })
    if (f.estado === 'falta') g.monto += f.retencion
  }
  const personas = Object.values(por).map((g) => ({ ...g, destino: destinoDeEmisor({ rut: g.rut, nombre: g.persona, proveedor_id: g.proveedor_id }, destinos, terceros, boletaSet) })).sort((a, b) => b.monto - a.monto || a.persona.localeCompare(b.persona))
  const retCalc = personas.reduce((a, x) => a + x.monto, 0)
  const nFalta = faltan.filter((f) => f.estado === 'falta').length
  const retencion = d && d.retencion_bhe != null
    ? { monto: _n(d.retencion_bhe), fuente: 'declarado', estado: 'verificado', personas, nFalta, calculado: retCalc }
    : { monto: retCalc, fuente: 'boletas', estado: nFalta > 0 ? 'falta' : 'estimado', personas, nFalta, calculado: retCalc }
  // Impuesto único de trabajadores: liquidaciones del período
  const liqs = (liquidaciones || []).filter((x) => x && String(x.periodo) === per)
  const trabajadores = liqs.map((x) => ({ persona: String(x.persona || ''), monto: _n(x.impuesto_unico) })).sort((a, b) => b.monto - a.monto)
  const unicoLiq = trabajadores.reduce((a, x) => a + x.monto, 0)
  const unico = d && d.impuesto_unico != null
    ? { monto: _n(d.impuesto_unico), fuente: 'declarado', estado: 'verificado', trabajadores, calculado: unicoLiq }
    : { monto: unicoLiq, fuente: liqs.length ? 'liquidaciones' : 'sin liquidaciones', estado: liqs.length ? 'verificado' : 'estimado', trabajadores, calculado: unicoLiq }
  const total = ppm.monto + retencion.monto + unico.monto
  const inf = _n(informado) > 0 ? Math.round(_n(informado)) : null
  const dif = inf != null ? inf - total : null
  return { per, ppm, retencion, unico, total, informado: inf, dif, cuadra: dif != null && dif === 0, porVerificar: dif != null && dif !== 0 }
}

/**
 * Impuestos mensuales de un presupuesto anual: PPM = promedio de los últimos 12 F29 declarados; retención por persona (quien emite boleta, con la boleta bruta); impuesto único = el de las liquidaciones del último mes × 12.
 * La retención de externos se MUESTRA y no se suma nunca al costo ni al total: la de quienes tienen pagos de comisión ya está en el bruto de Comisiones; la de quienes emiten boleta sin comisión no está costeada (por revisar).
 * Quien paga con boleta (`boletaSet` = nombres de miembros con paga_con_boleta) nunca es externo, aunque su partida y su boleta lleven nombres distintos. `terceros` = pagos a terceros (para saber quién tiene comisión).
 * @param {{ declarados?:Record<string,any>, liquidaciones?:any[], boletas?:any[], personasBoleta?:Array<{persona:string, liquido:number}>, boletaSet?:string[], terceros?:any[], destinos?:Record<string,string>, anio:number }} a
 */
export function impuestosPresupuesto({ declarados = {}, liquidaciones = [], boletas = [], personasBoleta = [], boletaSet = [], terceros = [], destinos = {}, anio }) {
  const pers = Object.keys(declarados || {}).sort().slice(-12)
  const ppmMes = pers.length ? pers.reduce((a, k) => a + _n(declarados[k].ppm), 0) / pers.length : 0
  const ultimo = (liquidaciones || []).map((x) => String(x.periodo)).sort().pop() || null
  const liqs = (liquidaciones || []).filter((x) => String(x.periodo) === ultimo)
  const unicoMes = liqs.reduce((a, x) => a + _n(x.impuesto_unico), 0)
  const tasa = tasaBHE(`${anio}-01-01`)
  const propias = (personasBoleta || []).map((p) => { const bruto = brutoDeLiquido(p.liquido, tasa); return { persona: p.persona, liquido: Math.round(_n(p.liquido)), bruto, retencionMes: bruto - Math.round(_n(p.liquido)), anual: (bruto - Math.round(_n(p.liquido))) * 12 } })
  const esDeLaOficina = (/** @type {any} */ emisor) => (boletaSet || []).some((nom) => mismaPersona(nom, emisor)) || propias.some((p) => mismaPersona(p.persona, emisor))
  const desde = pers.length ? pers[0] : null
  /** @type {Record<string, { anual:number, rut:string, destino:string }>} */ const ext = {}
  for (const b of boletas || []) {
    if (!b || b.estado === 'anulada' || (desde && String(b.fecha || '').slice(0, 7) < desde) || esDeLaOficina(b.emisor_nombre)) continue
    const k = String(b.emisor_nombre || 'Sin nombre'), g = Object.keys(ext).find((x) => mismaPersona(x, k)) || k
    const e = ext[g] || (ext[g] = { anual: 0, rut: '', destino: '' })
    e.anual += _n(b.retencion); if (!e.rut) e.rut = rutNormal(b.emisor_rut)
    const d = destinoDeEmisor({ rut: b.emisor_rut, nombre: b.emisor_nombre, proveedor_id: b.proveedor_id }, destinos, terceros); if (d) e.destino = d
  }
  // La retención de externos (destino contabilidad, gasto de oficina, comisión o cliente) se muestra y nunca se suma: ya está en su partida o gasto.
  const externos = Object.entries(ext).map(([persona, e]) => ({ persona, anual: e.anual, rut: e.rut, destino: e.destino, enComisiones: e.destino === 'comision' })).sort((a, b) => b.anual - a.anual)
  const retencionPropiaAnual = propias.reduce((a, p) => a + p.anual, 0), retencionExternosAnual = externos.reduce((a, x) => a + x.anual, 0)
  const ppmAnual = Math.round(ppmMes * 12), unicoAnual = Math.round(unicoMes * 12)
  return {
    ppmMes, ppmAnual, nF29: pers.length, desde: pers[0] || null, hasta: pers[pers.length - 1] || null,
    propias, externos, retencionPropiaAnual, retencionExternosAnual,
    unicoMes, unicoAnual, unicoPeriodo: ultimo,
    // Total de impuestos mensuales del presupuesto: PPM + retención propia + impuesto único. La retención de externos queda fuera (solo se muestra).
    totalAnual: ppmAnual + retencionPropiaAnual + unicoAnual,
    // Lo que sube el costo de remuneraciones: el bruto de quien emite boleta (retención propia) y el impuesto único; el PPM solo descuenta del impuesto de primera categoría.
    costoRemuneraciones: retencionPropiaAnual + unicoAnual,
  }
}

/**
 * Pagos de honorarios que deben tener boleta: sueldos de la oficina a quien emite boleta (gastos «Sueldos», no los bonos: no llevan boleta aparte) y comisiones pagadas con retención registrada.
 * `boletaSet` = nombres normalizados de quienes pagan con boleta (miembros.paga_con_boleta). @param {{ expenses?:any[], ofiId?:any, boletaSet?:Set<string>, terceros?:any[] }} a
 */
export function pagosConBoleta({ expenses = [], ofiId = null, boletaSet = new Set(), terceros = [] }) {
  const out = []
  for (const e of expenses || []) {
    if (!e || e.deleted_at || e.type !== 'gasto' || String(e.category || '') !== 'Sueldos' || (ofiId != null && String(e.client_id) !== String(ofiId))) continue
    const nom = _norm(e.subcategory || ''); if (!nom || !boletaSet || !boletaSet.has(nom)) continue
    out.push({ persona: String(e.subcategory), fecha: String(e.date || '').slice(0, 10), liquido: _n(e.amount), origen: 'sueldo' })
  }
  for (const t of terceros || []) {
    if (!t || t.estado !== 'pagado' || t.liquido == null || !(_n(t.retencion) > 0) || t.bhe_id) continue
    out.push({ persona: String(t.proveedor || ''), fecha: String(t.pagado_at || '').slice(0, 10), liquido: _n(t.liquido), bruto: _n(t.monto), retencion: _n(t.retencion), origen: 'comision', proveedor_id: t.proveedor_id || null, bhe_id: t.bhe_id || null })
  }
  return out
}

/**
 * Partidas de costos que cambian con los impuestos mensuales (una sola función para la pantalla y para pasar un estado a la versión 7): el bruto de quien emite boleta (líquido ÷ (1 − tasa del año)) y el impuesto único de trabajadores.
 * `costos` = partidas del presupuesto (por persona: {id, n, m líquido, g}); `boletaSet` = nombres de quienes pagan con boleta; `grupo` = grupo de las remuneraciones. Devuelve {personas, partidas}: las personas con su líquido y las partidas a fijar o agregar.
 * @param {{ costos:any[], boletaSet:string[], impuestos:any, anio:number, grupo:string }} a
 */
export function partidasImpuestos({ costos, boletaSet, impuestos, anio, grupo }) {
  const tasa = tasaBHE(`${anio}-01-01`)
  const personas = (costos || []).filter((c) => c.g === grupo && (boletaSet || []).some((nom) => mismaPersona(nom, c.n))).map((c) => ({ persona: c.n, liquido: c.m, id: c.id }))
  /** @type {any[]} */ const partidas = personas.map((p) => ({ id: p.id, m: brutoDeLiquido(p.liquido, tasa), boleta: true, liq: p.liquido, tasa }))
  if (_n(impuestos && impuestos.unicoMes) > 0) partidas.push({ id: 'impuesto-unico', n: 'Impuesto único de trabajadores', m: Math.round(impuestos.unicoMes), meses: 12, t: 'fijo', alza: null, g: grupo, imp: true })
  return { personas, partidas, tasa }
}

/**
 * Boletas cargadas sin enlace: sin movimiento del banco y sin proveedor. No se sabe a qué pago corresponden: quedan «por verificar» (no cuentan como faltantes). `desde` = AAAA-MM mínimo.
 * @param {{ boletas?:any[], desde?:string, destinos?:Record<string,string> }} a
 * @returns {Array<{ per:string, persona:string, rut:string, folio:any, fecha:string, bruto:number, retencion:number, estado:'por verificar', motivo:string, origen:string }>}
 */
export function boletasSinEnlace({ boletas = [], desde = '', destinos = {} } = {}) {
  // Un emisor con destino decidido ya no se pregunta: su boleta no necesita enlace con un pago.
  return (boletas || []).filter((b) => b && b.estado !== 'anulada' && !b.movimiento_id && !b.proveedor_id && !DESTINOS_BOLETA.includes(destinos[rutNormal(b.emisor_rut)]) && (!desde || String(b.fecha || '').slice(0, 7) >= desde))
    .map((b) => ({ per: String(b.fecha || '').slice(0, 7), persona: String(b.emisor_nombre || 'Sin nombre'), rut: rutNormal(b.emisor_rut), folio: b.folio, fecha: String(b.fecha || '').slice(0, 10), bruto: _n(b.bruto), retencion: _n(b.retencion), estado: /** @type {'por verificar'} */ ('por verificar'), motivo: 'sin movimiento del banco', origen: 'boleta' }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
}

/** Lista única de «Boletas por cargar»: las que faltan, las por verificar (sueldo de un mes con F29 sin su retención) y las boletas sin enlace. @param {{ pagos?:any[], boletas?:any[], declarados?:Record<string,any>, desde?:string, destinos?:Record<string,string> }} a */
export function listaBoletasPorCargar({ pagos = [], boletas = [], declarados = {}, desde = '', destinos = {} }) {
  const pend = boletasPorCargar({ pagos, boletas, declarados }).filter((x) => !desde || x.per >= desde)
  return [...pend.map((x) => ({ ...x, folio: null, motivo: x.estado === 'falta' ? 'sin boleta cargada' : 'el F29 declarado no la trae' })), ...boletasSinEnlace({ boletas, desde, destinos })]
}
