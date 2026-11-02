// Exposición de cobranza: antigüedad de la cartera, concentración y puntualidad de pago por cliente.
// Funciones puras (sin red ni base): fuente única de Cobranza, Inicio y la ficha del cliente. La mora sale de la fuente única de la app
// (emisión + 30 días); aquí solo se agrupa lo que cada vista ya calculó.

export const TRAMOS = ['Al día', '1 a 30 días', '31 a 60 días', '61 a 90 días', 'Más de 90 días']

/** Tramo de antigüedad según los días de mora (≤ 0 = al día). @param {any} dias @returns {number} 0 a 4 */
export const tramoMora = dias => { const d = Number(dias) || 0; return d <= 0 ? 0 : d <= 30 ? 1 : d <= 60 ? 2 : d <= 90 ? 3 : 4 }

/** ¿Cae en el filtro? f = null (todas) | 0 a 4 (tramo) | 'm60' (más de 60 días). @param {any} f @param {any} dias */
export const enFiltroMora = (f, dias) => f == null || (f === 'm60' ? (Number(dias) || 0) > 60 : tramoMora(dias) === f)

/**
 * Foto de la cartera por cobrar. filas = una por factura abierta: { cid, saldo, mora }.
 * Devuelve el total, cada tramo (facturas, clientes, saldo), lo que pasa de 60 días, el mayor deudor y los tres mayores.
 * Los porcentajes son sobre el total por cobrar y miden la deuda TOTAL de cada cliente (no solo lo vencido).
 * @param {{cid:any, saldo:any, mora:any}[]} filas
 */
export function exposicionCartera(filas) {
  const tr = TRAMOS.map(k => ({ k, n: 0, saldo: 0, clientes: new Set() }))
  /** @type {Map<string, number>} */
  const porCli = new Map()
  let total = 0, m60 = 0
  for (const f of filas || []) {
    const s = Number(f?.saldo) || 0
    if (!(s > 0)) continue
    const t = tr[tramoMora(f.mora)]
    t.n++; t.saldo += s; t.clientes.add(String(f.cid))
    total += s
    if ((Number(f.mora) || 0) > 60) m60 += s
    porCli.set(String(f.cid), (porCli.get(String(f.cid)) || 0) + s)
  }
  const orden = [...porCli.entries()].sort((a, b) => b[1] - a[1])
  const top3 = orden.slice(0, 3).reduce((a, x) => a + x[1], 0)
  return {
    total, m60,
    pctM60: total > 0 ? m60 / total : null,
    tramos: tr.map(t => ({ k: t.k, n: t.n, saldo: t.saldo, clientes: t.clientes.size })),
    porCliente: porCli,
    mayor: orden.length ? { cid: orden[0][0], saldo: orden[0][1], pct: total > 0 ? orden[0][1] / total : null } : null,
    top3pct: total > 0 ? top3 / total : null,
  }
}

/** Etiqueta de puntualidad a partir de los días que tardó cada pago desde la emisión. @param {{dias:number}[]} pagos */
export function puntualidadCliente(pagos) {
  const d = (pagos || []).map(p => Number(p?.dias)).filter(x => Number.isFinite(x) && x >= 0).sort((a, b) => a - b)
  const n = d.length
  if (!n) return { n: 0, promedio: null, mediana: null, pct30: null, etiqueta: 'Sin pagos registrados', tono: 'hacer' }
  const promedio = Math.round(d.reduce((a, x) => a + x, 0) / n)
  const mediana = n % 2 ? d[(n - 1) / 2] : (d[n / 2 - 1] + d[n / 2]) / 2
  const pct30 = Math.round(100 * d.filter(x => x <= 30).length / n)
  const [etiqueta, tono] = n < 3 ? ['Historial corto', 'gr'] : pct30 >= 80 ? ['Paga a tiempo', 'ok'] : pct30 >= 50 ? ['Se atrasa', 'am'] : ['Atraso habitual', 'hacer']
  return { n, promedio, mediana, pct30, etiqueta, tono }
}

/**
 * Puntualidad por cliente desde las facturas ya pagadas de los últimos `meses` meses. Cuentan solo pagos reales con su fecha: sin
 * reembolsos, notas de crédito, ni facturas que nacieron cubiertas por un anticipo (pagadas antes de la emisión).
 * @param {any[]} billing @param {string} hoy 'AAAA-MM-DD' @param {number} [meses]
 * @returns {Map<string, ReturnType<typeof puntualidadCliente>>}
 */
export function puntualidadPorCliente(billing, hoy, meses = 12) {
  const d0 = new Date(hoy + 'T12:00:00'); d0.setMonth(d0.getMonth() - meses)
  const desde = d0.toISOString().slice(0, 10)
  /** @type {Map<string, {dias:number}[]>} */
  const by = new Map()
  for (const b of billing || []) {
    if (!b || b.deleted_at || b.status !== 'Pagado' || !b.invoice_no || !b.paid_at || !b.issued_at || b.prepaid_anticipo_id) continue
    if (['reembolso', 'nota_credito'].includes(b.billing_type || '')) continue
    const e = String(b.issued_at).slice(0, 10), p = String(b.paid_at).slice(0, 10)
    if (p < e || p < desde) continue
    const dias = Math.round((new Date(p + 'T12:00:00').getTime() - new Date(e + 'T12:00:00').getTime()) / 86400000)
    const k = String(b.client_id)
    by.set(k, [...(by.get(k) || []), { dias }])
  }
  /** @type {Map<string, ReturnType<typeof puntualidadCliente>>} */
  const out = new Map()
  for (const [k, v] of by) out.set(k, puntualidadCliente(v))
  return out
}

/** Estado de un compromiso de pago: null sin compromiso, 'vigente' o 'incumplido' (la fecha pasó y todavía hay deuda vencida). @param {{fecha?:string}|null|undefined} comp @param {string} hoy @param {number} vencido */
export function estadoCompromiso(comp, hoy, vencido) {
  const f = String(comp?.fecha || '').slice(0, 10)
  if (!f) return null
  if (f >= hoy) return 'vigente'
  return vencido > 0 ? 'incumplido' : null
}
