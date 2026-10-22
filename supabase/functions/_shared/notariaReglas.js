// Reglas de la notaría compartidas por la app (Banco) y el servidor (conciliacion-auto). Una sola fuente.

const _dias = (a, b) => Math.round((new Date(String(a).slice(0, 10) + 'T12:00') - new Date(String(b).slice(0, 10) + 'T12:00')) / 864e5)

// Pago a la notaría ↔ su liquidación (rendiciones tipo 'notaria', enlace 1:1 en rendiciones.movimiento_id).
// Calce: liquidación sin pago enlazado, creada a ±30 días del cargo. Monto exacto y único → se enlaza; si además el RUT ya es
// conocido de la notaría (learnings 'notaria_rut', aprendido al enlazar a mano) se enlaza solo (auto). Monto distinto → solo se
// sugiere si el RUT es de la notaría y la diferencia es ≤10%.
export function liqParaCargo(m, liqs, rutsNota) {
  if (!m || m.tipo !== 'cargo' || m.es_interno || (Number(m.monto_conciliado) || 0) > 0) return null
  const libres = (liqs || []).filter(r => !r.movimiento_id && Math.abs(_dias(r.created_at, m.fecha)) <= 30)
  const monto = Math.abs(Number(m.monto) || 0)
  const ex = libres.filter(r => Math.round(Number(r.total) || 0) === Math.round(monto))
  const rutNota = !!m.rut_contraparte && rutsNota.has(m.rut_contraparte)
  if (ex.length === 1) return { liq: ex[0], exacto: true, auto: rutNota }
  if (!rutNota || ex.length > 1) return null
  const cerca = libres.map(r => ({ r, d: Math.abs((Number(r.total) || 0) - monto) })).filter(x => x.d <= Math.max(1, monto) * 0.1).sort((a, b) => a.d - b.d)
  return cerca.length ? { liq: cerca[0].r, exacto: false, auto: false, dif: monto - (Number(cerca[0].r.total) || 0) } : null
}
