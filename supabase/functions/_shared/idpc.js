// IDPC (impuesto de primera categoría) de una sociedad Pro Pyme general (art. 14 letra D N° 3 LIR). Regla ÚNICA y pura: no lee ni escribe la base.
//   Base = ingresos percibidos − egresos pagados (flujo de caja; la depreciación instantánea del activo fijo entra como egreso del año en que se paga).
//   Incentivo al ahorro (art. 14 E): rebaja del 50 % de esa base (el tope de 5.000 UF se pasa en pesos, si se quiere aplicar).
//   IDPC = base afecta × tasa (12,5 % hasta 2027). Saldo del año = IDPC − PPM pagado: positivo se paga en abril, negativo queda a favor.
// Caso base verificado con el F22 AT 2026 (anonimizado en tests/idpc.test.mjs): base 76.506.611 → incentivo 38.253.306 → IDPC 4.781.663 → saldo 1.122.303.

const _n = (/** @type {any} */ x) => { const v = Number(x); return Number.isFinite(v) ? v : 0 }

/**
 * @param {{ percibidos:number, pagados:number, ppmPagado?:number, tasa?:number, incentivo?:number, topeIncentivo?:number|null }} o
 * tasa y incentivo son fracciones (0,125 y 0,5). topeIncentivo en pesos (5.000 UF a la UF del cierre) o null si no se aplica.
 * @returns {{ base:number, perdida:number, incentivo:number, baseAfecta:number, idpc:number, ppmPagado:number, saldo:number }}
 */
export function idpcAnual(o) {
  const percibidos = _n(o.percibidos), pagados = _n(o.pagados), ppmPagado = _n(o.ppmPagado)
  const tasa = o.tasa == null ? 0.125 : _n(o.tasa), pctInc = o.incentivo == null ? 0.5 : _n(o.incentivo)
  const base = Math.round(percibidos - pagados)
  if (base <= 0) return { base, perdida: -base, incentivo: 0, baseAfecta: 0, idpc: 0, ppmPagado, saldo: -ppmPagado }
  let incentivo = Math.round(base * pctInc)
  if (o.topeIncentivo != null && _n(o.topeIncentivo) > 0) incentivo = Math.min(incentivo, Math.round(_n(o.topeIncentivo)))
  const baseAfecta = base - incentivo, idpc = Math.round(baseAfecta * tasa)
  return { base, perdida: 0, incentivo, baseAfecta, idpc, ppmPagado, saldo: idpc - ppmPagado }
}
