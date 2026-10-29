// Regla ÚNICA del F29 estimado de un mes CERRADO (la usan el calendario tributario de la app y el edge f29-estimado).
// Funciones puras: no leen ni escriben la base.
//   F29 = PPM (tasa × facturado del mes − notas de crédito, Registro de Ventas del SII)
//       + retención de las boletas de honorarios recibidas en el mes (boletas_honorarios)
//       + impuesto único de trabajadores = el del F29 del mes anterior (cód. 48; tabla f29_declarados, leída del SII).
// Cotejado con los 13 F29 declarados de 09-2025 a 09-2026: total = cód. 62 + 48 + 151 exacto; la base del PPM y las retenciones
// de la app calzan al peso con lo declarado. La tasa del PPM (cód. 115) sale de lo declarado (la que más se repite en los últimos
// 6 meses: en 2026 es 2%; la contadora declaró 1,5% en 09-2025, 12-2025 y 06-2026). Sin F29 cargados: tasa por defecto y el
// impuesto único derivado del total informado por la contadora (valores_contadora) − su PPM − sus retenciones.

export const TASA_PPM = 0.02

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
// Tasa del PPM según lo declarado: la que más se repite en los últimos 6 F29 anteriores al período (empate → la más reciente).
export function f29TasaDeclarada(declarados, per) {
  const prev = Object.keys(declarados || {}).filter(k => k < per).sort().slice(-6)
  if (!prev.length) return null
  const n = {}; prev.forEach(k => { const t = Number(declarados[k]?.tasa_ppm); if (t > 0) n[t] = (n[t] || 0) + 1 })
  const best = Object.entries(n).sort((a, b) => b[1] - a[1] || prev.map(k => Number(declarados[k]?.tasa_ppm)).lastIndexOf(Number(b[0])) - prev.map(k => Number(declarados[k]?.tasa_ppm)).lastIndexOf(Number(a[0])))[0]
  return best ? Number(best[0]) / 100 : null
}
// declarados = { 'AAAA-MM': { tasa_ppm, impuesto_unico, total } } (tabla f29_declarados, solo administradores).
/** @param {{per: string, docs: any, boletas: any, valores: any, declarados?: any, tasa?: number | null}} a */
export function f29Estimado({ per, docs, boletas, valores, declarados = null, tasa = null }) {
  tasa = tasa ?? f29TasaDeclarada(declarados, per) ?? TASA_PPM
  const { base, n: nDocs } = f29Base(docs, per)
  const ppm = Math.round(base * tasa)
  const { ret, n: nBoletas } = f29Retenciones(boletas, per)
  const prev = f29PerAnterior(per), vPrev = valores?.[prev]
  let iu = null
  const dPrev = declarados?.[prev]
  if (dPrev && dPrev.impuesto_unico != null) iu = Number(dPrev.impuesto_unico) || 0
  else if (vPrev && Number(vPrev.ppm) > 0) {
    const ppmPrev = Math.round(f29Base(docs, prev).base * tasa), retPrev = f29Retenciones(boletas, prev).ret
    iu = Math.max(0, Number(vPrev.ppm) - ppmPrev - retPrev)
  }
  const informado = Number(declarados?.[per]?.total) || Number(valores?.[per]?.ppm) || null
  const total = ppm + ret + (iu || 0)
  return { per, base, nDocs, tasa, ppm, ret, nBoletas, iu, iuDe: prev, total, completo: iu != null, informado, dif: informado != null ? informado - total : null }
}
