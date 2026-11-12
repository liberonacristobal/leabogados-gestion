// Regla ÚNICA del F29 estimado de un mes CERRADO (la usan el calendario tributario de la app y el edge f29-estimado).
// Funciones puras: no leen ni escriben la base.
//   F29 = PPM (tasa × facturado del mes − notas de crédito, Registro de Ventas del SII)
//       + retención de las boletas de honorarios recibidas en el mes (boletas_honorarios)
//       + impuesto único de trabajadores = el de las liquidaciones del período (sin ellas, el del F29 del mes anterior).
// Desde el 11-11-2026 el cálculo es el de _shared/impuestosMensuales.js (una sola regla para la planilla, el correo de la contadora, el calendario y este estimado); aquí quedan las primitivas reexportadas y la envoltura.
// Cotejado con los 13 F29 declarados de 09-2025 a 09-2026: total = cód. 62 + 48 + 151 exacto; la base del PPM y las retenciones
// de la app calzan al peso con lo declarado. La tasa del PPM (cód. 115) sale de lo declarado (la que más se repite en los últimos
// 6 meses: en 2026 es 2%; la contadora declaró 1,5% en 09-2025, 12-2025 y 06-2026). Sin F29 cargados: tasa por defecto y el
// impuesto único derivado del total informado por la contadora (valores_contadora) − su PPM − sus retenciones.

import { TASA_PPM, f29PerAnterior, f29Base, f29Retenciones, f29TasaDeclarada, impuestosMensuales } from './impuestosMensuales.js'
export { TASA_PPM, f29PerAnterior, f29Base, f29Retenciones, f29TasaDeclarada }

/**
 * F29 estimado de un mes. `liquidaciones` y `pagos` (sueldos a quien emite boleta y comisiones con retención) mejoran el cálculo; sin liquidaciones del período, el impuesto único es el del F29 del mes anterior.
 * @param {{per: string, docs: any, boletas: any, valores: any, declarados?: any, tasa?: number | null, liquidaciones?: any[] | null, pagos?: any[]}} a
 */
export function f29Estimado({ per, docs, boletas, valores, declarados = null, tasa = null, liquidaciones = null, pagos = [] }) {
  const tasaUsada = tasa ?? f29TasaDeclarada(declarados, per) ?? TASA_PPM
  let liqs = (liquidaciones || []).filter((x) => String(x.periodo) === per), iuDe = per
  if (!liqs.length) {
    const prev = f29PerAnterior(per), vPrev = valores?.[prev], dPrev = declarados?.[prev]
    let iu = null
    if (dPrev && dPrev.impuesto_unico != null) iu = Number(dPrev.impuesto_unico) || 0
    else if (vPrev && Number(vPrev.ppm) > 0) {
      const ppmPrev = Math.round(f29Base(docs, prev).base * tasaUsada), retPrev = f29Retenciones(boletas, prev).ret
      iu = Math.max(0, Number(vPrev.ppm) - ppmPrev - retPrev)
    }
    if (iu != null) { liqs = [{ periodo: per, persona: 'F29 del mes anterior', impuesto_unico: iu }]; iuDe = prev }
  }
  const informado = Number(declarados?.[per]?.total) || Number(valores?.[per]?.ppm) || null
  const r = impuestosMensuales({ per, docs, boletas, pagos, liquidaciones: liqs, declarados, informado, tasa: tasaUsada })
  const iu = liqs.length ? r.unico.monto : null
  const nBoletas = r.retencion.personas.reduce((a, x) => a + x.boletas.filter((b) => b.folio != null).length, 0)
  return { per, base: r.ppm.base, nDocs: r.ppm.nDocs, tasa: r.ppm.tasa, ppm: r.ppm.monto, ret: r.retencion.monto, nBoletas, nFalta: r.retencion.nFalta, iu, iuDe, total: r.total, completo: iu != null, informado, dif: informado != null ? informado - r.total : null, impuestos: r }
}
