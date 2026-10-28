// Reglas de la notaría compartidas por la app (Banco) y el servidor (conciliacion-auto). Una sola fuente.

const _dias = (a, b) => Math.round((new Date(String(a).slice(0, 10) + 'T12:00') - new Date(String(b).slice(0, 10) + 'T12:00')) / 864e5)

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
// Un gasto de Notaría sin N° de OT no es deuda con la notaría; los de $1 o menos son escrituras anuladas (solo orden).
export const esNotaPend = e => !!e && e.type !== 'fondo' && e.category === 'Notaria' && /\d/.test(String(e.ot_number || '')) && !e.notaria_render_id && !e.notaria_liquidado_at
export const notariaPendientes = expenses => (expenses || []).filter(e => !e.deleted_at && esNotaPend(e) && (Number(e.amount) || 0) > 1)
const _enSaldo = e => !e?.apertura_id
// Disponible REAL para pagar notaría de un cliente = fondo − ya pagado (rendido o notaría liquidada) − reservado para OTROS gastos
// pendientes del cliente (no la notaría que se está liquidando). esOficina(cid): la oficina siempre cubre sus gastos.
export function disponibleNotaria(expenses, cid, { esOficina = () => false } = {}) {
  if (esOficina(cid)) return { fondo: 0, pagado: 0, reservado: 0, resItems: [], disp: Infinity, oficina: true }
  const delCli = (expenses || []).filter(e => !e.deleted_at && String(e.client_id) === String(cid) && _enSaldo(e))
  const g = delCli.filter(e => e.type !== 'fondo' && !e.no_descuenta_saldo)
  const fondo = delCli.filter(e => e.type === 'fondo').reduce((a, e) => a + (Number(e.amount) || 0), 0)
  const pagado = g.filter(e => e.rendered_at || e.notaria_liquidado_at).reduce((a, e) => a + (Number(e.amount) || 0), 0)
  const resItems = g.filter(e => !e.rendered_at && !e.notaria_liquidado_at && !esNotaPend(e))
  const reservado = resItems.reduce((a, e) => a + (Number(e.amount) || 0), 0)
  // Parte del fondo que no es plata del cliente: el ajuste «Incobrable · asumido por la oficina» (castigo ya decidido).
  const asumido = delCli.filter(e => e.type === 'fondo' && e.category === 'Ajuste' && /incobrable/i.test(e.concept || '')).reduce((a, e) => a + (Number(e.amount) || 0), 0)
  const disp = Math.max(0, fondo - pagado - reservado)
  return { fondo, pagado, reservado, resItems, disp, asumido: Math.min(asumido, disp) }
}

// Tipo de acto de una OT: primero la materia que informa la notaría; si no viene, el concepto del gasto. El orden importa
// (mandato judicial antes que poder/mandato; uso de domicilio antes que autorización).
const _ACTOS = [['Mandato judicial', /mandato judicial/], ['Uso de domicilio', /domicilio/], ['Poder o mandato especial', /poder|mandato/], ['Constitución de sociedad', /constituci/], ['Modificación de sociedad', /modificaci/], ['Acta de junta', /acta|junta|reduccion/], ['Compraventa o cesión', /compraventa|promesa|cesion/], ['Autorización de firma', /autoriz|firma/], ['Copia o certificado', /copia|certificad/], ['Finiquito o laboral', /finiquito|laboral|contrato de trabajo/], ['Mutuo o reconocimiento de deuda', /mutuo|deuda/], ['Arrendamiento', /arriendo|arrendamiento/], ['Posesión efectiva', /posesion efectiva|inventario/], ['Declaración jurada', /declaracion jurada|estado civil/]]
export const tipoActoNotaria = e => { const t = `${e?.materia || ''} ${e?.concept || ''}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); const a = _ACTOS.find(([, re]) => re.test(t)); return a ? a[0] : 'Otro' }
// Trámites de tarifa fija: su costo no depende del valor del bien, así que un monto sobre 3 veces lo habitual es un error probable.
// Constituciones, modificaciones, compraventas, mutuos, arriendos y posesiones cobran según el valor y quedan fuera (28-10-2026).
export const ACTOS_TARIFA_FIJA = new Set(['Mandato judicial', 'Uso de domicilio', 'Poder o mandato especial', 'Autorización de firma', 'Copia o certificado', 'Finiquito o laboral', 'Declaración jurada'])
const _med = xs => { const a = xs.slice().sort((x, y) => x - y); if (!a.length) return null; const m = a.length >> 1; return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2) }
const _q = (xs, p) => { const a = xs.slice().sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * (a.length - 1)))] : null }
const _d = (a, b) => Math.round((new Date(String(a).slice(0, 10) + 'T12:00') - new Date(String(b).slice(0, 10) + 'T12:00')) / 864e5)

// Análisis de la notaría (solo lee; no registra ni paga nada): estado de las OT por pagar, lo que se sale de lo habitual y lo
// que la historia enseña (demora de pago desde que existe la app, arancel típico por acto). Lo usa el edge notaria-analisis.
export function analisisNotaria({ expenses = [], rendiciones = [], hoy, appDesde = '2026-06-06', esOficina = () => false }) {
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

// Lo que de verdad le toca a quien liquida la notaría: OT pagables con los fondos del cliente (FIFO por fecha dentro del disponible,
// o de la oficina) y OT sin cliente (por asignar). Las demás esperan fondos del cliente: eso es del aviso de fondos del abogado.
export function notariaPorLiquidar(expenses = [], { esOficina = () => false } = {}) {
  const pend = notariaPendientes(expenses), porCli = {}
  pend.forEach(e => { const k = e.client_id ? String(e.client_id) : '—'; (porCli[k] = porCli[k] || []).push(e) })
  const pagables = [], esperan = [], sinCliente = porCli['—'] || []
  Object.entries(porCli).forEach(([cid, ots]) => { if (cid === '—') return
    const d = disponibleNotaria(expenses, cid, { esOficina }); let usado = 0
    ots.slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))).forEach(e => { const m = Number(e.amount) || 0
      if (d.oficina || usado + m <= d.disp) { usado += m; pagables.push(e) } else esperan.push(e) }) })
  const suma = xs => xs.reduce((a, e) => a + (Number(e.amount) || 0), 0)
  return { pagables, esperan, sinCliente, montoPagables: suma(pagables), montoEsperan: suma(esperan), montoSinCliente: suma(sinCliente) }
}
