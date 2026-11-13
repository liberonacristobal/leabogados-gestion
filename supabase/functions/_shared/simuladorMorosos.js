// Simulador de cobro de la cartera morosa (Flujo de caja): qué pasa si se cobra una parte de lo moroso, con un porcentaje por tramo de mora.
// Funciones puras sobre lo que ya calcula el Flujo (flujoCajaProyectado): los cobros de clientes morosos que queda fuera (exclMor.items), lo que se paga a terceros
// de esas facturas (comMoroso) y las semanas. No guarda nada y no cambia ninguna otra cifra.

const DAY = 86400000

/** Tramos de mora (días desde el vencimiento): los que mide el estudio; parten en 30 porque desde ahí la cartera se considera morosa (FLUJO_DUDA_DIAS). Los usan el simulador del Flujo de caja y los escenarios de retiros. */
export const TRAMOS_MORA = [
  { k: 't1', l: '30 a 59 días', desde: 30, hasta: 59 },
  { k: 't2', l: '60 a 89 días', desde: 60, hasta: 89 },
  { k: 't3', l: '90 días y más', desde: 90, hasta: Infinity },
]

/** Índice del tramo (0, 1, 2) para unos días de mora. @param {number} dias */
export const tramoDeMora = dias => (dias <= 59 ? 0 : dias <= 89 ? 1 : 2)

const tMs = (/** @type {any} */ s) => { const t = new Date(String(s || '').slice(0, 10) + 'T12:00:00').getTime(); return Number.isNaN(t) ? null : t }

/** Días de mora de un cobro moroso: desde el vencimiento hasta hoy. El vencimiento es el de Cobranza y el de toda la app (`venceBill`): la emisión + 30 días; sin emisión, el `due`. @param {any} b @param {number} hoyT */
export function diasDeMora(b, hoyT) {
  const e = b && b.issued_at ? tMs(b.issued_at) : null
  const t = e != null ? e + 30 * DAY : tMs(b && b.due); if (t == null) return 0
  return Math.max(0, Math.round((hoyT - t) / DAY))
}

const clampPct = (/** @type {any} */ v) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0 }

/**
 * Monto y clientes por tramo de mora de los cobros morosos.
 * @param {{ b: any, m: number }[]} items @param {number} hoyT
 */
export function resumenTramos(items, hoyT) {
  const r = TRAMOS_MORA.map(t => ({ ...t, monto: 0, n: 0, cli: new Set() }))
  ;(items || []).forEach(x => { const i = tramoDeMora(diasDeMora(x.b, hoyT)); r[i].monto += x.m; r[i].cli.add(String(x.b && x.b.client_id || '')) })
  return r.map(t => ({ k: t.k, l: t.l, monto: t.monto, nCli: t.cli.size }))
}

/**
 * Aplica el cobro simulado: de cada cobro moroso entra el porcentaje de su tramo, en su misma fecha esperada, y la parte de terceros baja en la misma proporción.
 * Devuelve las semanas con su saldo corrido recalculado, los totales a 8 semanas, los cobros simulados, lo que sigue sin cobrarse y lo que cae hasta `finAnio`.
 * @param {{ weeks: any[], semanas?: number, exclItems: any[], comMoroso: { billId: any, monto: number }[], hoyT: number, pct: number[], finAnio?: number, clientes?: any[] }} o
 */
export function simularMorosos(o) {
  const pct = [0, 1, 2].map(i => clampPct(o.pct && o.pct[i]) / 100)
  const semanas = o.semanas || (o.weeks || []).length
  const weeks = (o.weeks || []).map(w => ({ ...w }))
  const comDe = {}; (o.comMoroso || []).forEach(c => { const k = String(c.billId); comDe[k] = (comDe[k] || 0) + (Number(c.monto) || 0) })
  const monT = weeks.length ? tMs(weeks[0].ini) : null
  const idx = (/** @type {number} */ t) => (monT == null || t < monT ? 0 : Math.floor((t - monT + 2 * 3600000) / (7 * DAY)))
  /** @type {any[]} */ const cobros = [], resto = []
  const porCli = {}; let simIng = 0, simCom = 0, anioIng = 0, anioCom = 0
  ;(o.exclItems || []).forEach(x => {
    const p = pct[tramoDeMora(diasDeMora(x.b, o.hoyT))], m = Number(x.m) || 0, add = m * p, com = (comDe[String(x.b && x.b.id)] || 0) * p
    if (add > 0) {
      const w = idx(x.t)
      if (w < semanas && weeks[w]) { weeks[w].entra += add; weeks[w].com += com }
      simIng += add; simCom += com
      if (o.finAnio == null || x.t <= o.finAnio) { anioIng += add; anioCom += com }
      cobros.push({ b: x.b, t: x.t, m: add, k: 'emit', v: true, est: false, sim: true })   // factura vencida: sale en la serie «Emitidas vencidas»
      const k = String(x.b && x.b.client_id || ''); (porCli[k] = porCli[k] || { entra: 0, com: 0 }); porCli[k].entra += add; porCli[k].com += com
    }
    if (m - add > 0.5) resto.push({ ...x, m: m - add })
  })
  let run = 0
  weeks.forEach(w => { w.sale = (w.of || 0) + w.com; run += w.entra - w.sale; w.run = run })
  const E = weeks.reduce((a, w) => a + w.entra, 0), C = weeks.reduce((a, w) => a + w.com, 0)
  const clientes = (o.clientes || []).map(c => porCli[c.cid] ? { ...c, entra: c.entra + porCli[c.cid].entra, com: c.com + porCli[c.cid].com, duda: Math.max(0, (c.duda || 0) - porCli[c.cid].entra) } : c)
  return { weeks, E, C, fin: run, cobros, resto, restoMonto: resto.reduce((a, x) => a + x.m, 0), simIng, simCom, anioIng, anioCom, clientes }
}

/**
 * Reparte lo simulado entre «8 semanas» y «Después» (lo que cae más allá de las 8 semanas), redondeado a `paso` (1e5 = $M de 1 decimal) y cuadrado:
 * 8 semanas + Después = Total en cada fila, y «Para el estudio» = Se cobra − A terceros en cada columna.
 * @param {{ ing: number, com: number, ing8: number, com8: number, paso?: number }} o ing/com = total simulado (cobro / pago a terceros); ing8/com8 = la parte que cae dentro de las 8 semanas
 * @returns {{ ing: number[], com: number[], neto: number[] }} cada fila es [8 semanas, Después, Total]
 */
export function repartoOchoSemanas(o) {
  const paso = o.paso || 1e5, r = (/** @type {number} */ x) => Math.round((Number(x) || 0) / paso) * paso
  const fila = (/** @type {number} */ tot, /** @type {number} */ a) => { const t = r(tot), a8 = Math.max(0, Math.min(t, r(a))); return [a8, t - a8, t] }
  const ing = fila(o.ing, o.ing8), com = fila(o.com, o.com8)
  return { ing, com, neto: ing.map((v, i) => v - com[i]) }
}
