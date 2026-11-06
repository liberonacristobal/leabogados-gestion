// Cuánto se demora cada cliente en pagar, y cuánto más hay que esperar a una factura que ya pasó su fecha esperada. Del lado conservador:
// un cliente sin historial propio se mide con el percentil 75 del estudio (no la mediana) y una factura que ya se pasó no se cobra «esta
// semana»: se espera lo que históricamente faltaba a quienes ya llevaban ese tiempo sin pagar. Funciones puras: no leen ni escriben la base.

export const MIN_PAGOS_PROPIOS = 3
export const ESPERA_SIN_HISTORIAL = 14   // días, cuando no hay pagos comparables
export const ESPERA_MINIMA = 7           // días: lo vencido nunca entra antes de la semana siguiente
export const EMISION_REZAGO_DIAS = 7     // cuota que ya venció y aún no se emite: se supone emitida la semana siguiente (hasta guardar la fecha programada)

/** @param {number[]} a ordenado o no @param {number} p entre 0 y 1 @returns {number|null} percentil por rango más cercano */
export function percentil(a, p) {
  if (!a.length) return null
  const x = [...a].sort((u, v) => u - v)
  return x[Math.min(x.length - 1, Math.max(0, Math.ceil(p * x.length) - 1))]
}
/** @param {number[]} a @returns {number|null} */
export function mediana(a) {
  if (!a.length) return null
  const x = [...a].sort((u, v) => u - v), m = Math.floor(x.length / 2)
  return x.length % 2 ? x[m] : (x[m - 1] + x[m]) / 2
}

/**
 * @param {{c:string, p:number, d:number}[]} pagos cliente, momento del pago y días de emisión a pago de cada factura pagada
 * @param {number} hoyT @param {{ventanaDias?:number, maxPorCliente?:number}} [o]
 */
export function ritmosDePago(pagos, hoyT, o = {}) {
  const ventana = (o.ventanaDias == null ? 365 : o.ventanaDias) * 86400000, max = o.maxPorCliente || 12
  const recientes = pagos.filter(x => x.p >= hoyT - ventana).map(x => x.d)
  const base = recientes.length ? recientes : pagos.map(x => x.d)
  const estudio = { mediana: mediana(base) ?? 30, p75: percentil(base, 0.75) ?? 45, dias: base }
  /** @type {Map<string,{dias:number[], propio:boolean}>} */ const porCliente = new Map()
  const grp = new Map(); pagos.forEach(x => { const k = String(x.c || ''); grp.set(k, [...(grp.get(k) || []), x]) })
  grp.forEach((a, k) => { const u = a.sort((x, y) => y.p - x.p).slice(0, max); porCliente.set(k, { dias: u.map(x => x.d), propio: u.length >= MIN_PAGOS_PROPIOS }) })
  const de = (/** @type {any} */ c) => porCliente.get(String(c || '')) || { dias: [], propio: false }
  return {
    estudio,
    /** ¿el cliente tiene historial propio suficiente? */
    propio: (/** @type {any} */ c) => de(c).propio,
    /** Días de pago habituales: su mediana si tiene historial, si no la mediana del estudio (sirve para marcar morosas). */
    mediano: (/** @type {any} */ c) => { const x = de(c); return x.propio ? /** @type {number} */ (mediana(x.dias)) : estudio.mediana },
    /** Días de pago para proyectar: su mediana si tiene historial; si no, el percentil 75 del estudio. */
    conservador: (/** @type {any} */ c) => { const x = de(c); return x.propio ? /** @type {number} */ (mediana(x.dias)) : estudio.p75 },
    /** Días que faltan para cobrar una factura que lleva `transcurridos` días sin pagarse: la mediana de lo que les faltaba a los pagos que tardaron más. */
    esperaRestante: (/** @type {any} */ c, /** @type {number} */ transcurridos) => {
      const x = de(c), muestra = x.propio ? x.dias : estudio.dias
      const falta = muestra.filter(d => d > transcurridos).map(d => d - transcurridos)
      const m = falta.length >= MIN_PAGOS_PROPIOS ? /** @type {number} */ (mediana(falta)) : ESPERA_SIN_HISTORIAL
      return Math.max(ESPERA_MINIMA, Math.round(m))
    },
  }
}
