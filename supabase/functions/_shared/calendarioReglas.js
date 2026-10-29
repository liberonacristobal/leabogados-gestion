// Fechas legales del calendario del estudio (una sola fuente: la app y la sincronización con Google Calendar).
// Funciones puras: los feriados llegan como un Set de 'AAAA-MM-DD'; sin feriados solo cuentan los fines de semana.
export const CAL_CL = { F29: { dia: 20 }, COT: { dia: 13 }, F22: { mes: 4, dia: 30 }, PATENTE: { meses: [1, 7] }, valoresHasta: 16, avisoDias: 1 }
export const CONTRIB_CUOTAS = [['04', '1ª'], ['06', '2ª'], ['09', '3ª'], ['11', '4ª']]

const p2 = n => String(n).padStart(2, '0')
const isoDe = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
export const ymMas = (ym, n) => { const [Y, M] = String(ym).split('-').map(Number), d = new Date(Y, M - 1 + n, 1); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}` }
export const finDeMes = ym => { const [Y, M] = String(ym).split('-').map(Number); return isoDe(new Date(Y, M, 0)) }
export const diasA = (desde, hasta) => Math.round((new Date(hasta + 'T12:00') - new Date(desde + 'T12:00')) / 86400000)

export function crearCalendario(feriados = new Set()) {
  const esDiaHabil = dt => { const w = dt.getDay(); if (w === 0 || w === 6) return false; return !feriados.has(isoDe(dt)) }
  const habilDesde = iso => { const d = new Date(String(iso).slice(0, 10) + 'T12:00'); for (let i = 0; i < 10 && !esDiaHabil(d); i++) d.setDate(d.getDate() + 1); return isoDe(d) }
  // Vencimiento del pago del período `per` (se paga el mes siguiente).
  const venceCalTrib = (tipo, per) => habilDesde(`${ymMas(per, 1)}-${p2(CAL_CL[tipo].dia)}`)
  return { esDiaHabil, habilDesde, venceCalTrib }
}

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
// Vencimiento de una DJ del estudio: la fila de la resolución cuyo detalle más se parece al de la obligación (1948 tiene una fecha por tipo de sociedad).
export const djFecha = (o, dj) => {
  const rows = (dj || []).filter(r => String(r.formulario) === String(o.formulario) && r.fecha); if (!rows.length) return null
  const w = new Set(norm(o.detalle || '').split(' ').filter(x => x.length > 3)), sc = r => norm(r.detalle || '').split(' ').filter(x => w.has(x)).length
  return rows.slice().sort((a, b) => sc(b) - sc(a) || String(a.fecha).localeCompare(String(b.fecha)))[0]
}
