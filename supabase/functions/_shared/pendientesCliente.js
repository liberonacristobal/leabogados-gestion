// Pendientes financieros por cliente (vista «Revisar cuentas»): UNA regla que junta, por cliente, lo que cada radar de la app ya detecta.
// No inventa criterios: cada tipo sale de la función que usa su propia vista. Un pendiente desaparece solo cuando su regla deja de
// detectarlo (se emitió, se cobró, se imputó), nunca por marcarlo a mano; lo decidido («No corresponde», «No se emitirá») ya no cuenta.
// Funciones puras. esVencida y saldoBill se inyectan porque viven en la app (dependen del respaldo bancario cargado).
import { estadoPagoVenta, APP_DESDE } from './ventasReglas.js'
import { cuotasVencidasSinFacturar } from './porFacturar.js'
import { fgCliente, gastosPorRendirCli, grupoRendir } from './gastosReglas.js'
import { montoNeDte, vencIncoh, ventasBorradorCobrado } from './saludDatos.js'

export const TIPOS_PENDIENTE = [['banco', 'Banco'], ['fondos', 'Fondos'], ['sinfactura', 'Sin factura'], ['cuotas', 'Cuotas'], ['vencidas', 'Vencidas'], ['datos', 'Datos']]

/**
 * Entrada (objeto): clients, sales, billing, anticipos, expenses, movsPend (abonos del banco asignados a un cliente y sin conciliar del todo:
 * id, cliente_id, monto, monto_conciliado, fecha), uf, hoy (AAAA-MM-DD, hora de Chile), noEmitir (learnings cuota_no_emitir), decFact
 * (learnings venta_factura: 'si' | 'no'), esVencida y saldoBill (reglas de la app).
 * @param {any} p
 * @returns {Map<string,{n:number, items:any[]}>} por client_id, solo clientes con al menos un pendiente
 */
export function pendientesPorCliente(p) {
  const { clients = [], sales = [], billing = [], anticipos = [], expenses = [], movsPend = [], uf = {}, hoy, noEmitir = new Set(), decFact = new Map(), esVencida = () => false, saldoBill = () => 0 } = /** @type {any} */ (p)
  const cli = new Set((clients || []).filter(c => c && !c.is_internal).map(c => String(c.id)))
  const venta = new Map((sales || []).filter(s => s && !s.deleted_at).map(s => [String(s.id), s]))
  const out = new Map()
  const add = (cid, tipo, key, extra) => {
    const k = String(cid || ''); if (!k || !cli.has(k)) return
    if (!out.has(k)) out.set(k, { n: 0, items: [] })
    const g = out.get(k); g.items.push({ tipo, key: `${tipo}:${key}`, ...extra }); g.n++
  }
  const mesCerrado = String(hoy).slice(0, 8) + '01'
  const cDe = b => b.client_id || venta.get(String(b.sale_id))?.client_id

  // Cuotas: el mismo radar de Facturación (cuotas vencidas sin facturar, meses cerrados).
  cuotasVencidasSinFacturar({ billing, sales, anticipos, uf, noEmitir, hasta: mesCerrado, hoy }).forEach(b => add(cDe(b), 'cuotas', b.id, { billing_id: b.id, sale_id: b.sale_id, fecha: b.due, monto: Number(b.amount) || 0, titulo: 'Cuota por emitir' }))

  // Sin factura: trabajo pagado con anticipos y sin factura (la misma etiqueta de Ventas), salvo que ya se decidió «No se emitirá».
  ;(sales || []).forEach(s => {
    if (!s || s.deleted_at) return
    const ep = estadoPagoVenta(s, billing, anticipos, mesCerrado, APP_DESDE, noEmitir)
    if (ep?.estado === 'pagada' && decFact.get(String(s.id)) !== 'no') add(s.client_id, 'sinfactura', s.id, { sale_id: s.id, monto: Math.round(ep.recibido || 0), titulo: decFact.get(String(s.id)) === 'si' ? 'Factura por emitir' : 'Pagada sin factura' })
  })
  // Cuota pagada por anticipo, sin folio, dentro de un trabajo que sí factura (la etiqueta anterior no la alcanza: tiene facturas).
  ;(billing || []).forEach(b => {
    if (!b || b.deleted_at || b.status !== 'Anticipada' || (b.invoice_no || b.folio) || !b.sale_id || !b.due || String(b.due) < APP_DESDE) return
    const s = venta.get(String(b.sale_id)); if (!s || !['Activo', 'Terminado'].includes(s.status) || decFact.get(String(s.id)) === 'no' || noEmitir.has(String(b.id))) return
    if (estadoPagoVenta(s, billing, anticipos, mesCerrado, APP_DESDE, noEmitir)) return   // ya la cuenta el caso anterior
    add(s.client_id, 'sinfactura', `ca${b.id}`, { billing_id: b.id, sale_id: b.sale_id, fecha: b.due, monto: Number(b.amount) || 0, titulo: 'Cuota pagada sin factura' })
  })

  // Vencidas: factura emitida, impaga y pasada de su vencimiento (Cobranza).
  ;(billing || []).forEach(b => {
    if (!b || b.deleted_at || !b.invoice_no || !['Pendiente', 'Vencido'].includes(b.status) || ['reembolso', 'nota_credito'].includes(b.billing_type)) return
    const sal = saldoBill(b); if (sal > 0 && esVencida(b)) add(b.client_id, 'vencidas', b.id, { billing_id: b.id, sale_id: b.sale_id || null, fecha: b.issued_at || b.due, monto: Math.round(sal), titulo: 'Factura vencida' })
  })

  // Fondos: gastos por rendir y el cliente debe (la misma regla de «Rendir a clientes»: grupo «pedir»). Decisión 03-11: son muchos y pequeños
  // (24 de 30 clientes de un abogado), así que viven solo como filtro: no suman a «Todos», al número de Inicio ni al total de la ficha.
  cli.forEach(id => {
    const n = gastosPorRendirCli(expenses, id).length, s = fgCliente(expenses, id).saldo
    if (grupoRendir({ n, s, armada: false }) === 'pedir') add(id, 'fondos', id, { monto: Math.round(-s), titulo: 'Fondos por solicitar', soloFiltro: true })
  })

  // Banco: abono ya asignado al cliente y aún sin conciliar.
  ;(movsPend || []).forEach(m => { const r = (Number(m.monto) || 0) - (Number(m.monto_conciliado) || 0); if (r > 1000) add(m.cliente_id, 'banco', m.id, { mov_id: m.id, fecha: m.fecha, monto: Math.round(r), titulo: 'Pago por imputar' }) })

  // Datos: anuladas sin motivo y los detectores de Revisión de datos que apuntan a un cliente.
  ;(billing || []).forEach(b => { if (b && !b.deleted_at && b.status === 'Anulada' && !b.motivo_baja && b.billing_type !== 'nota_credito') add(b.client_id, 'datos', `an${b.id}`, { billing_id: b.id, monto: Number(b.amount) || 0, titulo: 'Anulada sin motivo' }) })
  montoNeDte(billing).forEach(x => add(x.b.client_id, 'datos', `dte${x.b.id}`, { billing_id: x.b.id, monto: Math.round(x.dte - x.b.amount), titulo: 'Monto distinto del DTE' }))
  vencIncoh(billing).forEach(b => add(b.client_id, 'datos', `vi${b.id}`, { billing_id: b.id, monto: Number(b.amount) || 0, titulo: 'Vencimiento anterior a la emisión' }))
  ventasBorradorCobrado(sales, billing).forEach(x => add(x.s.client_id, 'datos', `vb${x.s.id}`, { sale_id: x.s.id, monto: Math.round(x.emitido), titulo: 'Venta en borrador con facturas' }))

  return out
}

/** Los pendientes que cuentan por defecto (todos menos los que viven solo como filtro). */
export const contables = (items = []) => items.filter(i => !i.soloFiltro)

/** Conteo por tipo de los pendientes de un cliente, en el orden fijo de TIPOS_PENDIENTE. */
export function tiposDe(items = []) {
  return TIPOS_PENDIENTE.map(([k, l]) => ({ tipo: k, label: l, n: items.filter(i => i.tipo === k).length })).filter(x => x.n > 0)
}

/**
 * Clientes (ids) con pendientes de alguno de los tipos elegidos (vacío = cualquiera), ordenados por cantidad descendente.
 * @param {Map<string,any>} mapa @param {Set<string>} [tipos] @param {Set<string>|null} [ids]
 */
export function clientesConPendientes(mapa, tipos = new Set(), ids = null) {
  const res = []
  mapa.forEach((g, id) => {
    if (ids && !ids.has(String(id))) return
    const items = tipos.size ? g.items.filter(i => tipos.has(i.tipo)) : contables(g.items)
    if (items.length) res.push({ id, n: items.length, items })
  })
  return res.sort((a, b) => b.n - a.n)
}

/**
 * Cuántos clientes ACTIVOS de un abogado tienen pendientes que cuentan (sin los que viven solo como filtro). La usan la tarjeta «Revisar cuentas» de Inicio y el
 * Panel de socios. norm = normalizador de nombres (minúsculas sin acentos); excluye internos, ocasionales y colaboradores, igual que la lista de Clientes.
 * @param {Map<string,any>} mapa @param {any[]} clients @param {string} abogado @param {(s:string)=>string} norm
 */
export function nClientesConPendientes(mapa, clients, abogado, norm) {
  const yo = norm(abogado || ''); if (!yo) return 0
  let n = 0
  ;(clients || []).forEach(c => { if (c && !c.is_internal && !c.is_occasional && !c.is_colaborador && c.status === 'Activo' && norm(c.abogado_responsable || '') === yo && (mapa.get(String(c.id))?.items || []).some(/** @param {any} i */ i => !i.soloFiltro)) n++ })
  return n
}

