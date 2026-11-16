// Puente del resultado devengado (el del Estado de resultados) a la base de caja del IDPC. Regla ÚNICA y pura: recibe cifras ya calculadas por la app.
//   Base de caja = Resultado antes de impuestos + variación de cuentas por cobrar + variación de cuentas por pagar.
//   Cada variación se mide de dos maneras independientes y deben coincidir; si no, la diferencia queda «por verificar» y no se esconde:
//     por cobrar: (a) cobrado − facturado del período y (b) −(por cobrar final − por cobrar inicial)
//     por pagar:  (a) devengado − pagado del período y (b)  (por pagar final − por pagar inicial)
//   Signo: un aumento de cuentas por cobrar baja la base (facturado y aún no cobrado); un aumento de cuentas por pagar la sube (costo devengado y aún no pagado).

const _n = (/** @type {any} */ x) => { const v = Number(x); return Number.isFinite(v) ? v : 0 }

/**
 * @param {{ resultadoAntes:number, facturado:number, cobrado:number, porCobrarIni?:number|null, porCobrarFin?:number|null, devengado:number, pagado:number, porPagarIni?:number|null, porPagarFin?:number|null, tolerancia?:number }} o
 * Los saldos (inicial y final) son opcionales: sin ellos no hay segunda medida y la variación queda sin comprobar.
 * @returns {{ resultadoAntes:number, varCxC:number, varCxP:number, base:number, cxcComprobada:boolean, cxpComprobada:boolean, difCxC:number, difCxP:number, cuadra:boolean }}
 */
export function puenteCaja(o) {
  const tol = o.tolerancia == null ? 1 : Math.abs(_n(o.tolerancia))
  const resultadoAntes = _n(o.resultadoAntes)
  const varCxC = _n(o.cobrado) - _n(o.facturado)
  const varCxP = _n(o.devengado) - _n(o.pagado)
  const tieneCxC = o.porCobrarIni != null && o.porCobrarFin != null, tieneCxP = o.porPagarIni != null && o.porPagarFin != null
  const difCxC = tieneCxC ? varCxC - (-(_n(o.porCobrarFin) - _n(o.porCobrarIni))) : 0
  const difCxP = tieneCxP ? varCxP - (_n(o.porPagarFin) - _n(o.porPagarIni)) : 0
  const cuadra = Math.abs(difCxC) <= tol && Math.abs(difCxP) <= tol
  return { resultadoAntes, varCxC, varCxP, base: Math.round(resultadoAntes + varCxC + varCxP), cxcComprobada: tieneCxC, cxpComprobada: tieneCxP, difCxC, difCxP, cuadra }
}
