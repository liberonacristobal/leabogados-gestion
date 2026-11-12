// Proyección al 31-12 (Inicio): la parte de la cobranza esperada que se paga a terceros (comisiones y ventas por cuenta de terceros)
// y, por diferencia, el ingreso propio. Funciones puras: el Flujo de caja entrega cada comisión con la fecha en que se espera el cobro de su
// factura (mismo cálculo y mismas exclusiones: el moroso queda fuera con su parte) y aquí solo se acota al período y se agrupa para mostrar.

/**
 * @param {{ t: number, m: number, cid?: string, billId?: any, provId?: any, prov?: any, porCuenta?: boolean }[] | null | undefined} comCobros
 * @param {number} fin instante (ms) hasta el que se proyecta
 * @param {number} [top] pagos visibles antes del resto
 * @param {(x: any) => boolean} [filtro] p. ej. por año de venta
 */
export function comisionesProyectadas(comCobros, fin, top = 5, filtro) {
  const items = (comCobros || []).filter(x => x && x.t <= fin && x.m > 0 && (!filtro || filtro(x))).sort((a, b) => b.m - a.m || a.t - b.t)
  const total = items.reduce((a, x) => a + x.m, 0)
  const vis = items.slice(0, top)
  const resto = items.slice(top)
  return { total, n: items.length, items: vis, resto: { n: resto.length, monto: resto.reduce((a, x) => a + x.m, 0) } }
}

/** Ingreso propio = cobranza esperada − comisiones proyectadas (nunca negativo). */
export const ingresoPropioProyectado = (cobranza, comisiones) => Math.max(0, (Number(cobranza) || 0) - (Number(comisiones) || 0))
