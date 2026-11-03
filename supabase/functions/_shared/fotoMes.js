// Foto mensual de cartera y de lo por pagar: reglas ÚNICAS que la función `foto-mes` guarda el día 1 y el Informe del mes compara.
// Funciones puras (sin red ni base). Reproducen, sobre las filas crudas, las cifras que la app calcula en vivo:
// saldoBill / venceBill / esVencidaB / resumenCartera (cartera), saldoComisiones (comisiones por pagar) y saldosPorCliente / totalesFondos (gastos por cobrar).
import { montoFactura } from './saludDatos.js'
import { estadoComision } from './comisionesReglas.js'
import { exposicionCartera } from './cobranzaExposicion.js'
import { cuentaEnSaldo } from './gastosReglas.js'
import { variacion, textoVariacion } from './informeMes.js'

/** Suma conciliada por factura: abonos del banco + anticipos consumidos con respaldo bancario (igual que el respaldoMap de la app). */
export function respaldoPorFactura(conciliacion, anticipos) {
  /** @type {Record<string, number>} */
  const m = {}
  for (const c of conciliacion || []) if (c.tipo_destino === 'factura' && c.factura_id) m[c.factura_id] = (m[c.factura_id] || 0) + (Number(c.monto_aplicado) || 0)
  const bancarios = new Set((conciliacion || []).filter(c => c.tipo_destino === 'anticipo' && c.anticipo_id).map(c => String(c.anticipo_id)))
  for (const a of anticipos || []) if (a.estado === 'consumido' && a.billing_id && bancarios.has(String(a.id))) m[a.billing_id] = (m[a.billing_id] || 0) + (Number(a.monto) || 0)
  return m
}

/** Saldo de una factura: monto del DTE menos lo mayor entre paid_amount y lo conciliado. Pagada o anulada = 0. */
export const saldoFactura = (b, respaldo) => {
  if (!b || ['Pagado', 'Anulada'].includes(b.status)) return 0
  const abonado = Math.max(b.paid_amount || 0, (respaldo || {})[b.id] || 0)
  return Math.max(0, montoFactura(b) - abonado)
}

/** Vencimiento: emisión + 30 días; sin emisión, el vencimiento programado. */
export const venceFactura = b => {
  if (b?.issued_at) { const x = new Date(b.issued_at + 'T00:00:00'); x.setDate(x.getDate() + 30); return x.toISOString().slice(0, 10) }
  return b?.due || ''
}

/** Días de mora al día `asOf` (> 0 = vencida hace N días). */
export const diasMora = (b, asOf) => {
  const v = venceFactura(b); if (!v) return 0
  return -Math.round((new Date(v + 'T12:00').getTime() - new Date(asOf + 'T12:00').getTime()) / 86400000)
}

const abierta = b => b && !b.deleted_at && !['reembolso', 'nota_credito'].includes(b.billing_type) && b.invoice_no && ['Pendiente', 'Vencido'].includes(b.status)
const vencida = (b, asOf) => !['Pagado', 'Anulada', 'Programada', 'Pausada'].includes(b.status) && !!venceFactura(b) && venceFactura(b) < asOf

/**
 * Cartera por cobrar al día `asOf`: total, vencido (todo lo vencido), más de 60 días y tramos de antigüedad.
 * @param {{billing:any[], conciliacion:any[], anticipos:any[], asOf:string}} p
 */
export function fotoCartera({ billing, conciliacion, anticipos, asOf }) {
  const resp = respaldoPorFactura(conciliacion, anticipos)
  const venc = (billing || []).filter(b => abierta(b) && vencida(b, asOf))
  const vencido = venc.reduce((a, b) => a + saldoFactura(b, resp), 0)
  const abiertas = (billing || []).filter(b => abierta(b) && saldoFactura(b, resp) > 0)
  const expo = exposicionCartera(abiertas.map(b => ({ cid: b.client_id, saldo: saldoFactura(b, resp), mora: vencida(b, asOf) ? diasMora(b, asOf) : 0 })))
  return {
    porCobrar: expo.total, nFacturas: abiertas.length, nClientes: expo.porCliente.size,
    vencido, nVencidas: venc.filter(b => saldoFactura(b, resp) > 0).length,
    m60: expo.m60,
    tramos: expo.tramos.map(t => ({ k: t.k, n: t.n, saldo: t.saldo })),
  }
}

/** Comisiones por pagar (mismas reglas que saldoComisiones): cuota ya cobrada al cliente y comisión sin pagar. */
export function fotoComisiones({ terceros, billing }) {
  const byId = new Map((billing || []).map(b => [String(b.id), b]))
  let porPagar = 0, n = 0
  for (const t of terceros || []) {
    if (!t) continue
    const b = t.billing_id ? byId.get(String(t.billing_id)) : null
    if (t.billing_id && (!b || b.status === 'Anulada' || b.deleted_at)) continue
    if (estadoComision(t, b) !== 'por_pagar') continue
    porPagar += Number(t.monto) || 0; n++
  }
  return { porPagar, n }
}

/** Gastos que la oficina adelantó y los clientes deben reponer (saldo negativo por cliente, sin clientes internos). */
export function fotoFondos({ expenses, clients }) {
  /** @type {Record<string, number>} */
  const s = {}
  for (const e of expenses || []) { const d = !cuentaEnSaldo(e) ? 0 : e.type === 'fondo' ? (e.amount || 0) : (e.no_descuenta_saldo ? 0 : -(e.amount || 0)); s[e.client_id] = (s[e.client_id] || 0) + d }
  let porReponer = 0, nDeben = 0
  for (const c of clients || []) { if (!c || c.is_internal) continue; const v = s[c.id] || 0; if (v < 0) { porReponer -= v; nDeben++ } }
  return { porReponer, nDeben }
}

/**
 * Foto completa. `per` = mes que cierra (AAAA-MM); `capturada` = fecha real de la captura (la cartera es la de ese día).
 * @param {{per:string, capturada:string, billing:any[], conciliacion:any[], anticipos:any[], terceros:any[], expenses:any[], clients:any[]}} p
 */
export function construirFoto({ per, capturada, billing, conciliacion, anticipos, terceros, expenses, clients }) {
  return {
    per, capturada,
    cartera: fotoCartera({ billing, conciliacion, anticipos, asOf: capturada }),
    comisiones: fotoComisiones({ terceros, billing }),
    fondos: fotoFondos({ expenses, clients }),
  }
}

/** Lee el valor guardado (JSON) de una foto; null si no es una foto válida. */
export function leerFoto(value) {
  try { const f = typeof value === 'string' ? JSON.parse(value) : value; return f && f.per && f.cartera && typeof f.cartera.porCobrar === 'number' ? f : null } catch { return null }
}

/**
 * Filas del «Cartera al cierre»: valor de la foto del mes y de la anterior con su variación (menos es mejor en todas).
 * Sin foto del mes devuelve []; sin foto previa, las filas traen p = null y variación vacía.
 */
export function filasFoto(nueva, previa) {
  if (!nueva) return []
  /** @type {[string, string, (c:any)=>number][]} */
  const x = [
    ['porCobrar', 'Por cobrar', c => c.cartera.porCobrar],
    ['vencido', 'Vencido', c => c.cartera.vencido],
    ['m60', 'Más de 60 días', c => c.cartera.m60],
    ['comisiones', 'Comisiones por pagar', c => c.comisiones.porPagar],
    ['fondos', 'Gastos por cobrar a clientes', c => c.fondos.porReponer],
  ]
  return x.map(([k, etiqueta, g]) => { const m = g(nueva), p = previa ? g(previa) : null; return { grupo: 'Cartera al cierre', k, etiqueta, tipo: 'clp', m, p, ...variacion(m, p, false) } })
}

/** Resumen para la IA de la cartera al cierre: cifras ya formateadas y la fecha real de la foto. null si no hay foto del mes. */
export function resumenFoto(nueva, previa, fmt) {
  if (!nueva) return null
  return { fechaFoto: String(nueva.capturada || '').split('-').reverse().join('-'), conFotoAnterior: !!previa,
    filas: filasFoto(nueva, previa).map(r => ({ indicador: r.etiqueta, alCierre: fmt(r.m), anterior: r.p == null ? null : fmt(r.p), variacion: r.p == null ? null : textoVariacion(r) })) }
}
