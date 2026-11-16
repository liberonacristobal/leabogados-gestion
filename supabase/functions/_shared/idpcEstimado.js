// IDPC estimado del año en curso: real hasta hoy + proyección moderada del resto, sobre la regla única idpcAnual (Pro Pyme general, 14 D N° 3).
// Regla pura: recibe series mensuales ya calculadas por la app (percibidos, pagados, PPM) y no lee ni escribe la base.
//   Percibidos = cobrado bruto del mes (fecha del depósito). Pagados = banco y tarjeta, con las comisiones a terceros por fecha de pago.
//   Proyección moderada, sin crecimiento: percibidos = promedio de los últimos 6 meses con dato; pagados y PPM = último mes completo.
import { idpcAnual } from './idpc.js'

const _n = (/** @type {any} */ x) => { const v = Number(x); return Number.isFinite(v) ? v : 0 }
const _suma = (/** @type {number[]} */ a) => a.reduce((s, x) => s + _n(x), 0)

/**
 * IDPC del año desde la base de caja al corte (la del puente del Estado) más la proyección moderada de los meses restantes: ingresos = promedio de los últimos 6 meses cobrados,
 * gastos = último mes completo, PPM = último mes. Sin crecimiento.
 * `ajusteFinAnio` = desfase de pago de cotizaciones y F29 entre diciembre del año anterior y diciembre de este año (desfasePagos.js); sube o baja la base del año.
 * @param {{ baseAlCorte:number, mesesRestantes:number, cobradoMes:number[], pagadoUltimoMes:number, ppmPagado:number, ppmUltimoMes:number, ajusteFinAnio?:number, tasa?:number, incentivo?:number, topeIncentivo?:number|null }} o
 * @returns {{ baseAlCorte:number, proyeccion:number, ajusteFinAnio:number, baseAnio:number, incentivo:number, baseAfecta:number, idpc:number, ppm:number, saldo:number, perdida:number }}
 */
export function idpcDesdePuente(o) {
  const resto = Math.max(0, Math.min(12, Math.floor(_n(o.mesesRestantes))))
  const ult6 = (o.cobradoMes || []).slice(-6).map(_n), prom = ult6.length ? _suma(ult6) / ult6.length : 0
  const proyeccion = Math.round((prom - _n(o.pagadoUltimoMes)) * resto)
  const ppm = _n(o.ppmPagado) + Math.round(_n(o.ppmUltimoMes) * resto)
  const ajusteFinAnio = Math.round(_n(o.ajusteFinAnio))
  const baseAnio = Math.round(_n(o.baseAlCorte)) + proyeccion + ajusteFinAnio
  const r = idpcAnual({ percibidos: baseAnio, pagados: 0, ppmPagado: ppm, tasa: o.tasa, incentivo: o.incentivo, topeIncentivo: o.topeIncentivo })
  return { baseAlCorte: Math.round(_n(o.baseAlCorte)), proyeccion, ajusteFinAnio, baseAnio, incentivo: r.incentivo, baseAfecta: r.baseAfecta, idpc: r.idpc, ppm, saldo: r.saldo, perdida: r.perdida }
}

/**
 * @param {{ percibidos:number[], pagados:number[], ppm:number[], mesesReales:number, extraPagado?:number, tasa?:number, incentivo?:number, topeIncentivo?:number|null }} o
 * Series de 12 meses (enero = índice 0); `mesesReales` = meses ya cerrados con dato real (el mes en curso cuenta como real parcial si se incluye).
 * `extraPagado` = pagos ya comprometidos del año que aún no están en las series (p. ej. comisiones por pagar hoy).
 * @returns {{ percibidos:number, pagados:number, ppm:number, proyPercibidos:number, proyPagados:number, proyPpm:number, base:number, incentivo:number, baseAfecta:number, idpc:number, saldo:number, perdida:number }}
 */
export function idpcEstimado(o) {
  const n = Math.max(0, Math.min(12, Math.floor(_n(o.mesesReales)))), resto = 12 - n
  const real = (/** @type {number[]} */ s) => _suma((s || []).slice(0, n))
  const ult = (/** @type {number[]} */ s, /** @type {number} */ k) => { const v = (s || []).slice(0, n).slice(-k).map(_n); return v.length ? _suma(v) / v.length : 0 }
  const percReal = real(o.percibidos), pagReal = real(o.pagados) + _n(o.extraPagado), ppmReal = real(o.ppm)
  const proyPerc = Math.round(ult(o.percibidos, 6) * resto)
  const proyPag = Math.round(ult(o.pagados, 1) * resto)
  const proyPpm = Math.round(ult(o.ppm, 1) * resto)
  const r = idpcAnual({ percibidos: percReal + proyPerc, pagados: pagReal + proyPag, ppmPagado: ppmReal + proyPpm, tasa: o.tasa, incentivo: o.incentivo, topeIncentivo: o.topeIncentivo })
  return { percibidos: percReal + proyPerc, pagados: pagReal + proyPag, ppm: ppmReal + proyPpm, proyPercibidos: proyPerc, proyPagados: proyPag, proyPpm, base: r.base, incentivo: r.incentivo, baseAfecta: r.baseAfecta, idpc: r.idpc, saldo: r.saldo, perdida: r.perdida }
}
