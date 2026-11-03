// Informe del mes: indicadores, comparación mes contra mes, resumen de cifras para la IA y verificación de su texto. Funciones puras (sin red ni base).
// Regla de oro: las cifras las calcula la app con sus funciones de siempre; la IA solo redacta con ese resumen, y todo número de su texto debe existir en él.

/** Un indicador: [grupo, clave, etiqueta, tipo, mejorSiSube] — tipo: clp | uf | n | pts; mejorSiSube: true | false | null (neutro). */
/** @type {[string, string, string, string, boolean|null][]} */
export const INDICADORES = [
  ['Resultado', 'ing', 'Ingresos', 'clp', true],
  ['Resultado', 'cobrado', 'Cobrado', 'clp', true],
  ['Resultado', 'cos', 'Costos de oficina', 'clp', false],
  ['Resultado', 'com', 'Comisiones pagadas', 'clp', false],
  ['Resultado', 'res', 'Resultado', 'clp', true],
  ['Resultado', 'margen', 'Margen', 'pts', true],
  ['Ventas', 'ventasUF', 'Ventas cerradas', 'uf', true],
  ['Ventas', 'ventasN', 'N° de ventas cerradas', 'n', true],
  ['Socios y pagos', 'retiros', 'Retiros de socios', 'clp', null],
]

/** Umbrales de los estados por tema (mejora · atención · riesgo): valores por defecto, ajustables aquí en un solo lugar. */
export const UMBRALES = { cambioRelevante: 0.05, vencidoAtencion: 0.5, vencidoRiesgo: 0.7, comisionDiasAtencion: 60, ventasCaida: 0.3 }

/** Variación de un indicador: abs, pct (sobre el valor anterior en positivo; null si no hay base) y tono (up mejora · dn empeora · nt neutro). */
/** @param {number|null|undefined} m @param {number|null|undefined} p @param {boolean|null} [mejorSiSube] */
export function variacion(m, p, mejorSiSube = true) {
  if (m == null || p == null || !isFinite(m) || !isFinite(p)) return { abs: null, pct: null, tono: 'nt' }
  const abs = m - p
  const pct = p !== 0 ? abs / Math.abs(p) : null
  const sinCambio = Math.abs(abs) < 0.5 || (pct != null && Math.abs(pct) < 0.005)
  const tono = sinCambio || mejorSiSube == null ? 'nt' : ((abs > 0) === mejorSiSube ? 'up' : 'dn')
  return { abs, pct, tono }
}

/** Filas de la comparación: una por indicador con valor del mes, del anterior y su variación. d = { m: {clave: número}, p: {clave: número} } */
export function filasComparacion(d) {
  return INDICADORES.map(([grupo, k, etiqueta, tipo, mejor]) => {
    const m = d?.m?.[k] ?? null, p = d?.p?.[k] ?? null
    return { grupo, k, etiqueta, tipo, mejor, m, p, ...variacion(m, p, mejor) }
  })
}

/** Los n cambios más grandes (en %), de mayor a menor, ignorando márgenes en puntos, sin base y cambios menores al umbral. */
export function masMovidos(filas, n = 5) {
  return (filas || []).filter(f => f.tipo !== 'pts' && f.pct != null && Math.abs(f.pct) >= UMBRALES.cambioRelevante).sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)).slice(0, n)
}

/** Texto de la variación de una fila: «+17%», «−4%», «+3 pts» o «—». */
export function textoVariacion(f) {
  if (f.abs == null) return '—'
  const sg = f.abs > 0 ? '+' : f.abs < 0 ? '−' : ''
  if (f.tipo === 'pts') return `${sg}${Math.abs(Math.round(f.abs * 10) / 10).toLocaleString('es-CL')} pts`
  if (f.pct == null) return '—'
  const r = Math.abs(Math.round(f.pct * 100))
  return r === 0 ? '0%' : `${sg}${r}%`
}

/**
 * Estado de cada tema del informe, por reglas fijas sobre las cifras (no lo decide la IA).
 * @param {{filas:any[], pctVencido:number|null, comisionDias:number|null, flujo:number|null, difRetiros:number|null}} x
 * @returns {Record<string,string>}
 */
export function estadosTemas(x) {
  const f = k => (x.filas || []).find(r => r.k === k)
  const res = f('res'), ventas = f('ventasUF')
  /** @type {Record<string,string>} */ const estado = {}
  estado.resultado = res?.m != null && res.m < 0 ? 'riesgo' : res?.pct != null && res.pct >= UMBRALES.cambioRelevante ? 'mejora' : res?.pct != null && res.pct <= -UMBRALES.cambioRelevante ? 'atencion' : 'sin_cambio'
  estado.cobranza = x.pctVencido == null ? 'sin_cambio' : x.pctVencido >= UMBRALES.vencidoRiesgo ? 'riesgo' : x.pctVencido >= UMBRALES.vencidoAtencion ? 'atencion' : 'mejora'
  estado.ventas = ventas?.pct != null && ventas.pct <= -UMBRALES.ventasCaida ? 'atencion' : ventas?.pct != null && ventas.pct >= UMBRALES.cambioRelevante ? 'mejora' : 'sin_cambio'
  estado.comisiones = x.comisionDias != null && x.comisionDias >= UMBRALES.comisionDiasAtencion ? 'atencion' : 'sin_cambio'
  estado.retiros = x.difRetiros != null && x.difRetiros !== 0 ? 'atencion' : 'sin_cambio'
  estado.liquidez = x.flujo != null && x.flujo < 0 ? 'riesgo' : x.flujo != null ? 'mejora' : 'sin_cambio'
  return estado
}

/**
 * Resumen de cifras para la IA: todo ya formateado como se muestra en la app; la IA debe copiar esas cifras tal cual.
 * @param {{mes:string, comparado:string, filas:any[], f:{clp:(n:number)=>string, uf:(n:number)=>string, n:(n:number)=>string, pts:(n:number)=>string}, extras:Record<string,any>, estados:Record<string,string>}} a
 */
export function construirDossier({ mes, comparado, filas, f, extras = {}, estados = {} }) {
  const fmt = (r, v) => v == null ? null : r.tipo === 'clp' ? f.clp(v) : r.tipo === 'uf' ? f.uf(v) : r.tipo === 'pts' ? f.pts(v) : f.n(v)
  return {
    mes, comparado,
    indicadores: (filas || []).map(r => ({ indicador: r.etiqueta, grupo: r.grupo, mes: fmt(r, r.m), anterior: fmt(r, r.p), variacion: textoVariacion(r) })),
    masMovidos: masMovidos(filas).map(r => ({ indicador: r.etiqueta, mes: fmt(r, r.m), anterior: fmt(r, r.p), variacion: textoVariacion(r) })),
    estados,
    hoy: extras,
  }
}

/** Números (como texto) que aparecen en un valor cualquiera del resumen. */
function numerosDe(v, out) {
  if (v == null) return
  if (typeof v === 'number') { out.add(normNum(String(v))); return }
  if (typeof v === 'string') { (v.match(/\d[\d.,]*/g) || []).forEach(t => out.add(normNum(t))); return }
  if (Array.isArray(v)) { v.forEach(x => numerosDe(x, out)); return }
  if (typeof v === 'object') Object.values(v).forEach(x => numerosDe(x, out))
}
const normNum = t => String(t).replace(/[.,]+$/, '').replace(/^[.,]+/, '')

/** Conjunto de números permitidos en el texto de la IA (todos los del resumen). */
export function numerosPermitidos(dossier) { const s = new Set(); numerosDe(dossier, s); return s }

/**
 * Verifica que todo número del texto exista en el resumen. Devuelve { ok, faltantes }.
 * @param {string} texto @param {any} dossier
 */
export function verificarTexto(texto, dossier) {
  const ok = numerosPermitidos(dossier), faltantes = []
  ;(String(texto || '').match(/\d[\d.,]*/g) || []).forEach(t => { const n = normNum(t); if (!ok.has(n) && !faltantes.includes(n)) faltantes.push(n) })
  return { ok: faltantes.length === 0, faltantes }
}

export const TEMAS = ['resultado', 'cobranza', 'ventas', 'comisiones', 'retiros', 'liquidez']

/**
 * Lee la respuesta de la IA: { frase, puntos:[{tema, cifra, etiqueta, variacion, titular, porque, enlace}] }. Acepta texto con cercos ```json.
 * Devuelve null si no es un informe válido de 6 puntos en el orden fijo.
 * @param {string} raw @returns {any}
 */
export function leerInformeIA(raw) {
  try {
    const t = String(raw || '').replace(/```json|```/g, '').trim()
    const i = t.indexOf('{'), j = t.lastIndexOf('}')
    const o = JSON.parse(t.slice(i, j + 1))
    if (!o || typeof o.frase !== 'string' || !Array.isArray(o.puntos) || o.puntos.length !== TEMAS.length) return null
    for (let k = 0; k < TEMAS.length; k++) { const p = o.puntos[k]; if (!p || typeof p.titular !== 'string' || typeof p.porque !== 'string') return null
      const tema = String(p.tema || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
      if (tema !== TEMAS[k]) return null
      p.tema = tema; p.cifra = String(p.cifra ?? ''); p.variacion = String(p.variacion ?? ''); p.etiqueta = String(p.etiqueta ?? '') }
    return o
  } catch (_) { return null }
}

/** Todo el texto de un informe (frase y puntos) para verificar sus números de una vez. */
export function textoDeInforme(inf) { return [inf?.frase, ...(inf?.puntos || []).flatMap(p => [p.cifra, p.variacion, p.titular, p.porque])].filter(Boolean).join(' · ') }
