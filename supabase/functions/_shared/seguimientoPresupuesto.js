// Paso 6 del Presupuesto («Seguimiento»): real mes a mes, presupuesto mensual desde la meta (Ideal) y el arrastre, ventana comparable contra el mismo período del año anterior y apertura por origen.
// Funciones puras (sin lectura de la base); las cifras de entrada salen de los helpers de siempre (resultadoMes, cobrado por banco, retiros, escenario Ideal de vistaIdeal, arrastre con ajustes).

const _n = (/** @type {any} */ x) => { if (x == null || x === '') return null; const v = Number(x); return Number.isFinite(v) ? v : null }
const _ym = (/** @type {number} */ anio, /** @type {number} */ i) => `${anio}-${String(i + 1).padStart(2, '0')}`

/**
 * Real mes a mes de un año para los seis componentes (null donde no hay dato). Margen en caja: cobrado menos comisiones menos costos del mes.
 * `serie` = facturado y costos por mes («aaaa-mm»), `cobMes` = cobrado por mes, `evoVend` = vendido acumulado del año (solo el año en curso), `retirosMes` = retiros por mes (solo el año en curso).
 * @param {{ anio:number, serie:Record<string,{fac?:number,cos?:number}>, cobMes:Record<string,number>, evoVend?:(number|null)[]|null, retirosMes?:(number|null)[]|null, tercPct?:number|null }} o
 */
export function realMensualAnio({ anio, serie, cobMes, evoVend, retirosMes, tercPct }) {
  const terc = (_n(tercPct) ?? 0) / 100, mes = (/** @type {number} */ i) => _ym(anio, i)
  const col = (/** @type {(i:number)=>number|null} */ f) => Array.from({ length: 12 }, (_, i) => f(i))
  const fact = col((i) => _n(serie && serie[mes(i)] && serie[mes(i)].fac)), costos = col((i) => _n(serie && serie[mes(i)] && serie[mes(i)].cos)), caja = col((i) => _n(cobMes && cobMes[mes(i)]))
  const ventas = col((i) => { const c = evoVend ? _n(evoVend[i]) : null; return c == null ? null : c - (i > 0 ? _n(evoVend && evoVend[i - 1]) ?? 0 : 0) })
  const margen = caja.map((c, i) => (c == null || costos[i] == null ? null : c * (1 - terc) - /** @type {number} */ (costos[i])))
  const retiros = col((i) => (retirosMes ? _n(retirosMes[i]) : null))
  return { fact, ventas, caja, costos, margen, retiros }
}

/**
 * Presupuesto mensual del año del presupuesto: Facturado = arrastre de cada mes (con ajustes) + lo nuevo por facturar ÷ 12; Vendido y Cobrado = su meta repartida (el cobrado es la cobranza: cobro del año + recuperación);
 * Costos y Retiros del escenario Ideal repartidos igual, y Margen = cobrado de la cadena − comisiones − costos (coincide con el margen del Ideal). `rep(total, componente)` es el reparto mensual elegido en Metas.
 * @param {{ rep:(total:number, comp:string)=>(number|null)[], arrastreMes:number[], nuevoFacturar:number, ventas:number|null, cobranza:number, ideal:{ costos:number, terc:number, caja:number, retiros:number } }} o
 */
export function presupuestoMensual({ rep, arrastreMes, nuevoFacturar, ventas, cobranza, ideal }) {
  const nuevo = Math.max(0, _n(nuevoFacturar) || 0) / 12
  const costos = rep(ideal.costos, 'costos'), caja = rep(ideal.caja, 'caja'), ter = rep(ideal.terc, 'caja')
  return {
    ventas: ventas == null ? Array(12).fill(null) : rep(ventas, 'ventas'),
    fact: Array.from({ length: 12 }, (_, i) => (Number((arrastreMes || [])[i]) || 0) + nuevo),
    caja: rep(cobranza, 'caja'), costos, retiros: rep(ideal.retiros, 'retiros'),
    margen: caja.map((c, i) => (c ?? 0) - (ter[i] ?? 0) - (costos[i] ?? 0)),
  }
}

/**
 * Ventana comparable de un componente: lo presupuestado, lo real y lo del mismo período del año anterior, solo en los meses cerrados con real. Avance = real ÷ presupuesto; `vsPrevio` = real − año anterior.
 * Sin meses cerrados no hay ventana (`hay` false) y solo se entrega el presupuesto del año.
 * @param {{ pres:(number|null)[], real:(number|null)[], previo:(number|null)[], cerrados:number }} o
 */
export function ventanaComparable({ pres, real, previo, cerrados }) {
  const presAnio = (pres || []).reduce((/** @type {number} */ a, x) => a + (_n(x) ?? 0), 0), hayPres = (pres || []).some((x) => _n(x) != null)
  let pa = 0, ra = 0, ya = 0, n = 0, hayPrev = false
  for (let i = 0; i < Math.min(12, Math.max(0, cerrados)); i++) {
    const r = _n((real || [])[i]); if (r == null) continue
    n++; ra += r; pa += _n((pres || [])[i]) ?? 0
    const y = _n((previo || [])[i]); if (y != null) { ya += y; hayPrev = true }
  }
  const hay = n > 0
  return { hay, meses: n, presAnio: hayPres ? presAnio : null, presAcum: hay && hayPres ? pa : null, realAcum: hay ? ra : null, previoAcum: hay && hayPrev ? ya : null, avance: hay && hayPres && pa > 0 ? (ra / pa) * 100 : null, vsPrevio: hay && hayPrev ? ra - ya : null }
}

/**
 * Apertura de un componente en dos orígenes (Facturado: arrastre y nuevo): presupuesto y real de cada uno en los meses cerrados y su avance. El real de `a` es el total menos el de `b` (las partes suman el total).
 * @param {{ presA:(number|null)[], presB:(number|null)[], realTotal:(number|null)[], realB:(number|null)[], cerrados:number }} o
 */
export function aperturaOrigen({ presA, presB, realTotal, realB, cerrados }) {
  let pa = 0, pb = 0, rt = 0, rb = 0, n = 0
  for (let i = 0; i < Math.min(12, Math.max(0, cerrados)); i++) { const r = _n((realTotal || [])[i]); if (r == null) continue; n++; rt += r; rb += _n((realB || [])[i]) ?? 0; pa += _n((presA || [])[i]) ?? 0; pb += _n((presB || [])[i]) ?? 0 }
  const fila = (/** @type {number} */ p, /** @type {number} */ r) => ({ pres: p, real: r, avance: p > 0 ? (r / p) * 100 : null })
  return { hay: n > 0, a: fila(pa, rt - rb), b: fila(pb, rb), total: fila(pa + pb, rt) }
}

/** Lo que el Seguimiento necesita de una versión guardada para medir contra ella (se guarda con la versión: ver `fotoSeguimiento`). */
export const versionTraeSeguimiento = (/** @type {any} */ v) => !!(v && v.resumen && v.resumen.seg && v.resumen.seg.v === 1)

/** Foto que se guarda con cada versión para el Seguimiento: el Ideal (costos, comisiones, cobrado, retiros), las metas de vendido y cobranza, el arrastre por mes y lo nuevo por facturar. @param {{ ideal:any, ventas:number|null, cobranza:number, arrastreMes:number[], nuevoFacturar:number }} o */
export function fotoSeguimiento({ ideal, ventas, cobranza, arrastreMes, nuevoFacturar }) {
  return { v: 1, ideal: { costos: ideal.costos, terc: ideal.terc, caja: ideal.caja, retiros: ideal.retiros }, ventas, cobranza, arrastreMes: (arrastreMes || []).map((x) => Number(x) || 0), nuevoFacturar }
}
