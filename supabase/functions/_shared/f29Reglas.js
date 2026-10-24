// Regla ÚNICA del F29 estimado de un mes CERRADO (la usan el calendario tributario de la app y el edge f29-estimado).
// Funciones puras: no leen ni escriben la base.
//   F29 = PPM (tasa × facturado del mes − notas de crédito, Registro de Ventas del SII)
//       + retención de las boletas de honorarios recibidas en el mes (boletas_honorarios)
//       + impuesto único de trabajadores = el del mes anterior (F29 informado por la contadora − su PPM − sus retenciones).
// Verificado con el F29 real de 09-2025 (cód. 62 PPM 587.909 = 1,5% de 39.193.947; cód. 151 366.897; cód. 48 166.584).
// El impuesto único es estimado: cambia con los sueldos; las diferencias se ven al cuadrar con el correo VALORES.

export const TASA_PPM = 0.015

const _ymMas = (ym, n) => { const d = new Date(`${ym}-01T12:00:00`); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 7) }
export const f29PerAnterior = per => _ymMas(per, -1)

// Base del PPM: facturas y notas de débito del mes menos notas de crédito. Afectas (33/56) sin IVA; exentas (34) por su total.
export function f29Base(docs, per) {
  let b = 0, n = 0
  for (const d of docs || []) {
    if (String(d.fecha_emision || d.fecha || '').slice(0, 7) !== per) continue
    const t = Number(d.tipo_dte), m = Number(d.monto) || 0
    if (t === 34) { b += m; n++ } else if (t === 33 || t === 56) { b += Math.round(m / 1.19); n++ } else if (t === 61) b -= m
  }
  return { base: b, n }
}
export function f29Retenciones(boletas, per) {
  const l = (boletas || []).filter(x => String(x.fecha || '').slice(0, 7) === per && x.estado !== 'anulada')
  return { ret: l.reduce((a, x) => a + (Number(x.retencion) || 0), 0), n: l.length }
}

// valores = { 'AAAA-MM': { ppm: total F29 informado por la contadora } } (learnings kind valores_contadora; ella lo llama IVA/PPM).
export function f29Estimado({ per, docs, boletas, valores, tasa = TASA_PPM }) {
  const { base, n: nDocs } = f29Base(docs, per)
  const ppm = Math.round(base * tasa)
  const { ret, n: nBoletas } = f29Retenciones(boletas, per)
  const prev = f29PerAnterior(per), vPrev = valores?.[prev]
  let iu = null
  if (vPrev && Number(vPrev.ppm) > 0) {
    const ppmPrev = Math.round(f29Base(docs, prev).base * tasa), retPrev = f29Retenciones(boletas, prev).ret
    iu = Math.max(0, Number(vPrev.ppm) - ppmPrev - retPrev)
  }
  const informado = Number(valores?.[per]?.ppm) || null
  const total = ppm + ret + (iu || 0)
  return { per, base, nDocs, tasa, ppm, ret, nBoletas, iu, iuDe: prev, total, completo: iu != null, informado, dif: informado != null ? informado - total : null }
}
