// Reglas de la notaría compartidas por la app (Banco) y el servidor (conciliacion-auto). Una sola fuente.
import { repartoFondos, cuentaEnSaldo } from './gastosReglas.js'

const _dias = (a, b) => Math.round((+new Date(String(a).slice(0, 10) + 'T12:00') - +new Date(String(b).slice(0, 10) + 'T12:00')) / 864e5)

// Pago a la notaría ↔ su liquidación (rendiciones tipo 'notaria', enlace 1:1 en rendiciones.movimiento_id).
// Calce: liquidación sin pago enlazado, creada a ±30 días del cargo. Monto exacto y único → se enlaza; si además el RUT ya es
// conocido de la notaría (learnings 'notaria_rut', aprendido al enlazar a mano) se enlaza solo (auto). Monto distinto → solo se
// sugiere si el RUT es de la notaría y la diferencia es ≤10%.
export function liqParaCargo(m, liqs, rutsNota) {
  if (!m || m.tipo !== 'cargo' || m.es_interno || (Number(m.monto_conciliado) || 0) > 0) return null
  const libres = (liqs || []).filter(r => !r.movimiento_id && Math.abs(_dias(r.created_at, m.fecha)) <= 30)
  const monto = Math.abs(Number(m.monto) || 0)
  const ex = libres.filter(r => Math.round(Number(r.total) || 0) === Math.round(monto))
  const rutNota = !!m.rut_contraparte && rutsNota.has(m.rut_contraparte)
  if (ex.length === 1) return { liq: ex[0], exacto: true, auto: rutNota }
  if (!rutNota || ex.length > 1) return null
  const cerca = libres.map(r => ({ r, d: Math.abs((Number(r.total) || 0) - monto) })).filter(x => x.d <= Math.max(1, monto) * 0.1).sort((a, b) => a.d - b.d)
  return cerca.length ? { liq: cerca[0].r, exacto: false, auto: false, dif: monto - (Number(cerca[0].r.total) || 0) } : null
}

// Deuda con la notaría = OT (la OT es la fuente de la verdad): gasto de categoría Notaría con N° de OT, sin rendir ni liquidar.
// Un gasto de Notaría sin N° de OT no es deuda con la notaría.
// OT DE $1 = OT NO VÁLIDA (regla del usuario, 18-11-2026): la notaría registra por un peso las OT de repertorios que no se usaron o que se
// anularon; solo ocupan un número de la serie. No son deuda, no esperan un precio, no se cargan «porque falten» ni sirven para calzar un
// documento. Si la notaría cambia el monto (de $1 a un valor real) pasa a ser una OT normal. Toda regla de OT pasa por `otNoValida`.
export const OT_NO_VALIDA_MONTO = 1
export const otNoValida = e => !!e && e.amount != null && (Number(e.amount) || 0) <= OT_NO_VALIDA_MONTO
export const esNotaPend = e => !!e && e.type !== 'fondo' && e.category === 'Notaria' && /\d/.test(String(e.ot_number || '')) && !e.notaria_render_id && !e.notaria_liquidado_at
export const notariaPendientes = expenses => (expenses || []).filter(e => !e.deleted_at && esNotaPend(e) && !otNoValida(e) && (Number(e.amount) || 0) > OT_NO_VALIDA_MONTO)
const _enSaldo = e => !e?.apertura_id
// Disponible REAL para pagar notaría de un cliente = fondo − ya pagado (rendido o notaría liquidada) − reservado para OTROS gastos
// pendientes del cliente (no la notaría que se está liquidando). esOficina(cid): la oficina siempre cubre sus gastos.
// POR TRABAJO (como Rendiciones): una OT se paga con el fondo de su trabajo y, después, con el fondo sin trabajo del cliente; el fondo de
// otro trabajo nunca la cubre. El disponible nunca supera al del cliente completo (el reparto solo restringe, no agrega). Fondo y gastos se
// reparten con repartoFondos, la misma regla de Rendiciones. porTrabajo: lo que queda en cada trabajo con OT pendiente y en «sin trabajo»;
// otSinTrabajo: OT sin trabajo que no tiene fondo sin trabajo (hay que asignarles el trabajo antes de pagar).
export function disponibleNotaria(expenses, cid, { esOficina = /** @type {(cid: any) => boolean} */ (() => false) } = {}) {
  if (esOficina(cid)) return { fondo: 0, pagado: 0, reservado: 0, resItems: [], disp: Infinity, oficina: true }
  const delCli = (expenses || []).filter(e => !e.deleted_at && String(e.client_id) === String(cid) && _enSaldo(e))
  const g = delCli.filter(e => e.type !== 'fondo' && !e.no_descuenta_saldo)
  const fondo = delCli.filter(e => e.type === 'fondo').reduce((a, e) => a + (Number(e.amount) || 0), 0)
  const pagado = g.filter(e => e.rendered_at || e.notaria_liquidado_at).reduce((a, e) => a + (Number(e.amount) || 0), 0)
  const resItems = g.filter(e => !e.rendered_at && !e.notaria_liquidado_at && !esNotaPend(e))
  const reservado = resItems.reduce((a, e) => a + (Number(e.amount) || 0), 0)
  // Parte del fondo que no es plata del cliente: el ajuste «Incobrable · asumido por la oficina» (castigo ya decidido).
  const asumido = delCli.filter(e => e.type === 'fondo' && e.category === 'Ajuste' && /incobrable/i.test(e.concept || '')).reduce((a, e) => a + (Number(e.amount) || 0), 0)
  const completo = Math.max(0, fondo - pagado - reservado)
  const ots = delCli.filter(e => esNotaPend(e) && (Number(e.amount) || 0) > 1)
  /** @type {{ trabajo: string, disp: number }[]} */
  const porTrabajo = []
  let disp = completo, sinTrabajo = 0
  /** @type {any[]} */
  let otSinTrabajo = []
  if (ots.length) {
    /** @type {Record<string, number>} */
    const neto = {}
    repartoFondos(delCli.filter(e => !esNotaPend(e)).map(e => ({ ...e, client_id: cid })), cid).fondos.forEach((/** @type {any} */ x) => { const k = String(x.f.project || '').trim(); neto[k] = (neto[k] || 0) + x.quedan })
    sinTrabajo = Math.max(0, neto[''] || 0)
    const trabajos = [...new Set(ots.map(e => String(e.project || '').trim()).filter(Boolean))]
    trabajos.forEach(t => porTrabajo.push({ trabajo: t, disp: Math.max(0, neto[t] || 0) }))
    disp = Math.min(completo, sinTrabajo + porTrabajo.reduce((a, x) => a + x.disp, 0))
    if (sinTrabajo <= 0) otSinTrabajo = ots.filter(e => !String(e.project || '').trim())
  }
  const disponibleAsumido = Math.min(asumido, disp)
  return { fondo, pagado, reservado, resItems, disp, completo, porTrabajo, sinTrabajo, otSinTrabajo, asumido: disponibleAsumido }
}

// Tipo de acto de una OT: primero la materia que informa la notaría; si no viene, el concepto del gasto. El orden importa
// (mandato judicial antes que poder/mandato; uso de domicilio antes que autorización).
/** @type {[string, RegExp][]} */
const _ACTOS = [['Mandato judicial', /mandato judicial/], ['Uso de domicilio', /domicilio/], ['Poder o mandato especial', /poder|mandato/], ['Constitución de sociedad', /constituci/], ['Modificación de sociedad', /modificaci/], ['Acta de junta', /acta|junta|reduccion/], ['Compraventa o cesión', /compraventa|promesa|cesion/], ['Autorización de firma', /autoriz|firma/], ['Copia o certificado', /copia|certificad/], ['Finiquito o laboral', /finiquito|laboral|contrato de trabajo/], ['Mutuo o reconocimiento de deuda', /mutuo|deuda/], ['Arrendamiento', /arriendo|arrendamiento/], ['Posesión efectiva', /posesion efectiva|inventario/], ['Declaración jurada', /declaracion jurada|estado civil/]]
export const tipoActoNotaria = e => { const t = `${e?.materia || ''} ${e?.concept || ''}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); const a = _ACTOS.find(([, re]) => re.test(t)); return a ? a[0] : 'Otro' }
// Trámites de tarifa fija: su costo no depende del valor del bien, así que un monto sobre 3 veces lo habitual es un error probable.
// Constituciones, modificaciones, compraventas, mutuos, arriendos y posesiones cobran según el valor y quedan fuera (28-10-2026).
export const ACTOS_TARIFA_FIJA = new Set(['Mandato judicial', 'Uso de domicilio', 'Poder o mandato especial', 'Autorización de firma', 'Copia o certificado', 'Finiquito o laboral', 'Declaración jurada'])
const _med = xs => { const a = xs.slice().sort((x, y) => x - y); if (!a.length) return null; const m = a.length >> 1; return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2) }
const _q = (xs, p) => { const a = xs.slice().sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * (a.length - 1)))] : null }
const _d = (a, b) => Math.round((+new Date(String(a).slice(0, 10) + 'T12:00') - +new Date(String(b).slice(0, 10) + 'T12:00')) / 864e5)

// Análisis de la notaría (solo lee; no registra ni paga nada): estado de las OT por pagar, lo que se sale de lo habitual y lo
// que la historia enseña (demora de pago desde que existe la app, arancel típico por acto). Lo usa el edge notaria-analisis.
export function analisisNotaria({ expenses = [], rendiciones = [], hoy, appDesde = '2026-06-06', esOficina = /** @type {(cid: any) => boolean} */ (() => false) }) {
  const pend = notariaPendientes(expenses)
  const rend = {}; (rendiciones || []).forEach(r => { rend[String(r.id)] = r })
  // Demora OT → liquidación a la notaría, solo OT desde que existe la app (lo anterior es planilla importada).
  const demoras = (expenses || []).filter(e => !e.deleted_at && e.category === 'Notaria' && e.notaria_render_id && rend[String(e.notaria_render_id)] && String(e.date || '') >= appDesde)
    .map(e => _d(rend[String(e.notaria_render_id)].created_at, e.date)).filter(x => x >= 0)
  const maxDemora = demoras.length ? Math.max(...demoras) : null
  // Arancel típico por acto (toda la historia con monto real; $1 = escritura anulada).
  const porActo = {}; (expenses || []).filter(e => !e.deleted_at && e.type !== 'fondo' && e.category === 'Notaria' && (Number(e.amount) || 0) > 1).forEach(e => { const k = tipoActoNotaria(e); (porActo[k] = porActo[k] || []).push(Number(e.amount) || 0) })
  const actos = Object.entries(porActo).map(([tipo, xs]) => ({ tipo, n: xs.length, mediana: _med(xs), min: Math.min(...xs), max: Math.max(...xs) })).sort((a, b) => b.n - a.n)
  const medDe = k => actos.find(a => a.tipo === k && a.n >= 5 && k !== 'Otro')?.mediana || null
  // Estado por cliente.
  const porCli = {}; pend.forEach(e => { const k = String(e.client_id || '—'); (porCli[k] = porCli[k] || []).push(e) })
  const clientes = Object.entries(porCli).map(([cid, ots]) => { const ot = ots.reduce((a, e) => a + (Number(e.amount) || 0), 0); const d = cid === '—' ? { disp: 0, fondo: 0, oficina: false } : disponibleNotaria(expenses, cid, { esOficina }); return { cid, ots, ot, disp: d.oficina ? ot : d.disp, fondo: d.fondo, oficina: !!d.oficina } })
  const cubre = clientes.filter(c => !c.oficina).reduce((a, c) => a + Math.min(c.disp, c.ot), 0)
  const sinFondo = clientes.filter(c => !c.oficina && c.cid !== '—' && c.disp <= 0).sort((a, b) => b.ot - a.ot)
  const largas = maxDemora != null ? pend.filter(e => _d(hoy, e.date) > maxDemora).sort((a, b) => String(a.date).localeCompare(String(b.date))) : []
  const fuera = pend.map(e => ({ e, tipo: tipoActoNotaria(e), med: medDe(tipoActoNotaria(e)) })).filter(x => x.med && ACTOS_TARIFA_FIJA.has(x.tipo) && (Number(x.e.amount) || 0) > 3 * x.med)
  const sinFondo60 = pend.filter(e => { const c = clientes.find(x => x.cid === String(e.client_id || '—')); return c && !c.oficina && c.disp < c.ot && _d(hoy, e.date) > 60 })
  const liqs = (rendiciones || []).filter(r => r.tipo === 'notaria' && !r.anulada_at).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  return {
    pend, total: pend.reduce((a, e) => a + (Number(e.amount) || 0), 0), nClientes: clientes.length, cubre, clientes, sinFondo, largas, fuera, sinFondo60, actos,
    demora: { n: demoras.length, mediana: _med(demoras), p25: _q(demoras, 0.25), p75: _q(demoras, 0.75), max: maxDemora },
    ultimaLiq: liqs[0] || null,
  }
}

const _porFecha = (/** @type {any} */ a, /** @type {any} */ b) => String(a.date || '9999').localeCompare(String(b.date || '9999')) || String(a.ot_number || '').localeCompare(String(b.ot_number || ''))

// Cuenta personal de un miembro (gastos personal_de sin cliente): un fondo con gastos ligados (reembolso_fondo_id, p. ej. el que deja un tercero
// para un socio) cubre SOLO esos gastos; el resto se cubre con el saldo propio (fondos de uso general menos gastos sin fondo).
/** @param {any[]} expenses @param {string} persona */
function _cuentaPersonal(expenses, persona) {
  const mine = (expenses || []).filter(e => e.personal_de === persona && !e.client_id && !e.deleted_at && cuentaEnSaldo(e))
  const fondos = mine.filter(e => e.type === 'fondo' && !e.no_descuenta_saldo)
  const gastos = mine.filter(e => e.type !== 'fondo' && !e.no_descuenta_saldo)
  const fondoDe = (/** @type {any} */ g) => (g.reembolso_fondo_id ? fondos.find(f => String(f.id) === String(g.reembolso_fondo_id)) : null)
  const dedic = new Set(gastos.map(g => fondoDe(g)?.id).filter(Boolean).map(String))
  return { fondos, gastos, fondoDe, dedic }
}
/** @param {any[]} expenses @param {string} persona */
export function dispPersonaNotaria(expenses, persona) {
  const { fondos, gastos, fondoDe, dedic } = _cuentaPersonal(expenses, persona)
  const fondo = fondos.filter(f => !dedic.has(String(f.id))).reduce((a, e) => a + (Number(e.amount) || 0), 0)
  const otros = gastos.filter(g => !fondoDe(g) && !esNotaPend(g)).reduce((a, e) => a + (Number(e.amount) || 0), 0)
  return { fondo, otros, disp: Math.max(0, fondo - otros) }
}
// Cuánto de las OT `gs` (de una persona) se puede pagar con fondos: las ligadas a un fondo, con lo que le queda a ese fondo; las demás, con el saldo propio.
/** @param {any[]} expenses @param {string} persona @param {any[]} gs */
export function coberturaPersonaNotaria(expenses, persona, gs) {
  const { gastos, fondoDe } = _cuentaPersonal(expenses, persona)
  const general = dispPersonaNotaria(expenses, persona).disp
  const quedaF = (/** @type {any} */ f) => Math.max(0, (Number(f.amount) || 0) - gastos.filter(g => String(g.reembolso_fondo_id) === String(f.id) && !esNotaPend(g)).reduce((a, e) => a + (Number(e.amount) || 0), 0))
  /** @type {Map<string, {disp:number, items:any[]}>} */
  const grupos = new Map()
  ;(gs || []).forEach(e => { const f = fondoDe(e); const k = f ? String(f.id) : '__gen__'; let g = grupos.get(k); if (!g) { g = { disp: f ? quedaF(f) : general, items: [] }; grupos.set(k, g) } g.items.push(e) })
  let con = 0, disp = 0, ap = 0
  /** @type {any[]} */ const pagables = []
  grupos.forEach(g => { const t = g.items.reduce((a, e) => a + (Number(e.amount) || 0), 0); ap += t; con += Math.min(t, g.disp); disp += g.disp; let used = 0
    ;[...g.items].sort(_porFecha).forEach(e => { const m = Number(e.amount) || 0; if (used + m <= g.disp) { used += m; pagables.push(e) } }) })
  if (!grupos.has('__gen__')) disp += general
  return { con, ap, disp, pagables }
}

// Lo que de verdad le toca a quien liquida la notaría. UNA sola regla para Pagar, Panel de socios, resumen semanal y cierre de mes.
// Cada OT pendiente cae en exactamente una partida: pagables (con el fondo de su cliente, FIFO por fecha dentro del disponible; con el fondo de la persona
// si es personal; las del cliente oficina y las incobrables, que paga la oficina, van completas), esperan (cliente sin fondo que alcance) o sinCliente
// (sin cliente ni persona, y las personales que su fondo no cubre). Las partidas suman el pendiente.
/** @param {any[]} [expenses] @param {{esOficina?: (cid: any) => boolean}} [opts] */
export function notariaPorLiquidar(expenses = [], { esOficina = /** @type {(cid: any) => boolean} */ (() => false) } = {}) {
  const pend = notariaPendientes(expenses)
  /** @type {Record<string, any[]>} */ const porCli = {}
  /** @type {Record<string, any[]>} */ const porPersona = {}
  /** @type {any[]} */ const asume = [], sinCliente = [], pagables = [], esperan = []
  pend.forEach(e => {
    if (e.incobrable_at) { asume.push(e); return }
    if (e.client_id) { const k = String(e.client_id); (porCli[k] = porCli[k] || []).push(e) }
    else if (e.personal_de) { (porPersona[e.personal_de] = porPersona[e.personal_de] || []).push(e) }
    else sinCliente.push(e)
  })
  Object.entries(porCli).forEach(([cid, ots]) => {
    const d = disponibleNotaria(expenses, cid, { esOficina }); let usado = 0
    ots.slice().sort(_porFecha).forEach(e => { const m = Number(e.amount) || 0
      if (d.oficina || usado + m <= d.disp) { usado += m; pagables.push(e) } else esperan.push(e) })
  })
  Object.entries(porPersona).forEach(([persona, ots]) => {
    const cb = coberturaPersonaNotaria(expenses, persona, ots)
    const ok = new Set(cb.pagables.map(e => String(e.id)))
    ots.forEach(e => { if (ok.has(String(e.id))) pagables.push(e); else sinCliente.push(e) })
  })
  asume.forEach(e => pagables.push(e))
  const suma = (/** @type {any[]} */ xs) => xs.reduce((a, e) => a + (Number(e.amount) || 0), 0)
  return { pagables, esperan, sinCliente, asume, montoPagables: suma(pagables), montoEsperan: suma(esperan), montoSinCliente: suma(sinCliente), montoAsume: suma(asume) }
}

// Selección de Pagar = lo que la regla sugiere, menos lo que la persona sacó, más lo que agregó (solo si la OT sigue pendiente). Devuelve los id de las OT.
/** @param {any[]} pagables @param {{sacadas?: any[], agregadas?: any[]}} [ajustes] @param {any[]} [pendientes] @returns {any[]} */
export function seleccionNotaria(pagables, ajustes = {}, pendientes = pagables) {
  const sacadas = new Set((ajustes.sacadas || []).map(String)), agregadas = new Set((ajustes.agregadas || []).map(String))
  const base = (pagables || []).filter(e => !sacadas.has(String(e.id))).map(e => e.id)
  const ya = new Set(base.map(String))
  const extra = (pendientes || []).filter(e => agregadas.has(String(e.id)) && !ya.has(String(e.id))).map(e => e.id)
  return [...base, ...extra]
}

/**
 * Qué debe revisar quien carga una liquidación de la notaría, apenas se carga. Tres partidas, cada una con su acción:
 *  sinCliente (OT sin cliente ni miembro: hay que identificarla) · sinTrabajo (OT con cliente sin trabajo: sin él no se paga con el fondo del cliente) ·
 *  porConfirmar (OT que la notaría cobra y marcamos «no nuestra»: se confirma con la notaría). Las OT de $1 son OT no válidas y no cuentan.
 * `gastos` = las OT que creó la carga (expenses con su bulk_import_id); `resumen` = bulk_imports.resumen de la carga.
 * @param {any[]} gastos
 * @param {{cargadas?:number, noNuestras?:{monto?:number}[]}} [resumen]
 */
export function revisionCargaNotaria(gastos = [], resumen = {}) {
  const vivas = (gastos || []).filter(e => e && !e.deleted_at && !otNoValida(e))
  const suma = xs => xs.reduce((a, e) => a + (Number(e.amount ?? e.monto) || 0), 0)
  const sinCliente = vivas.filter(e => !e.client_id && !e.personal_de)
  const sinTrabajo = vivas.filter(e => e.client_id && !String(e.project || '').trim())
  const noNuestras = ((resumen && resumen.noNuestras) || []).filter(x => (Number(x.monto) || 0) > OT_NO_VALIDA_MONTO)
  const parte = xs => ({ n: xs.length, m: suma(xs) })
  // cargadas = todas las OT que creó la carga (con cliente y sin él), no solo las que el resumen cuenta como «cargadas» (esas excluyen las pendientes de cliente).
  const r = { cargadas: vivas.length, monto: suma(vivas), sinCliente: parte(sinCliente), sinTrabajo: parte(sinTrabajo), porConfirmar: parte(noNuestras) }
  return { ...r, porRevisar: r.sinCliente.n + r.sinTrabajo.n + r.porConfirmar.n }
}

const _sinTildes = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
const _GENERICAS = new Set(['gastos', 'notariales', 'sociedad', 'sociedades', 'constitucion', 'modificacion', 'compraventa', 'poder', 'mandato', 'autorizacion', 'autorizaciones', 'uso', 'domicilio', 'comercial', 'spa', 'limitada', 'ltda', 'inversiones', 'inversion', 'servicios', 'asesorias', 'grupo', 'capital', 'chile', 'varias', 'firmas', 'contratos', 'escritura', 'publica', 'certificado', 'protocolizacion'])
/**
 * Cliente sugerido para una OT sin cliente, por las palabras propias de su glosa (no genéricas, 4 letras o más): se puntúa cada cliente por cuántas de esas palabras
 * aparecen en sus gastos y se sugiere solo con un ganador claro (2 palabras o más, y más que el siguiente). Una sola palabra común no basta.
 * Devuelve {clienteId, palabras} o null.
 * @param {{concept?:string, id?:any}} ot
 * @param {any[]} gastos
 */
export function clienteSugeridoPorGlosa(ot, gastos) {
  const resto = String(ot?.concept || '').split('—').slice(1).join(' ') || String(ot?.concept || '')
  const palabras = [...new Set(_sinTildes(resto).split(/[^a-z0-9ñ]+/).filter(w => w.length >= 4 && !_GENERICAS.has(w)))]
  /** @type {Map<string, Set<string>>} */ const por = new Map()
  for (const g of gastos || []) {
    if (!g || g.deleted_at || !g.client_id || String(g.id) === String(ot?.id)) continue
    const txt = _sinTildes(g.concept)
    for (const w of palabras) if (txt.includes(w)) { const k = String(g.client_id); let ws = por.get(k); if (!ws) { ws = new Set(); por.set(k, ws) } ws.add(w) }
  }
  const orden = [...por].map(([clienteId, ws]) => ({ clienteId, palabras: [...ws] })).sort((a, b) => b.palabras.length - a.palabras.length)
  if (!orden.length || orden[0].palabras.length < 2) return null
  if (orden[1] && orden[1].palabras.length >= orden[0].palabras.length) return null
  return orden[0]
}
