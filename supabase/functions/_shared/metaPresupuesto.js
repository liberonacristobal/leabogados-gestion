// Paso 4 del Presupuesto («Metas»): una sola meta con su cifra (Vendido, Facturado…) escrita en $ o en % sobre el cierre estimado del año base, lo que falta facturar contra el arrastre y el aviso
// cuando la meta queda bajo ese cierre. Funciones puras; la cadena que lleva la meta a los demás componentes sigue siendo metasDesdeComponente (presupuesto.js).
import { ventasDeFact } from './presupuesto.js'

const _n = (/** @type {any} */ x) => { if (x == null || x === '') return null; const v = Number(x); return Number.isFinite(v) ? v : null }

/** Modo de la meta guardada: «pct» solo si hay un % válido; en cualquier otro caso «clp». @param {any} m @returns {'clp'|'pct'} */
export const modoDeMeta = (m) => (m && m.modo === 'pct' && _n(m.pct) != null ? 'pct' : 'clp')

/** Meta en pesos. En % es el cierre estimado × (1 + %); sin cierre (≤ 0) el % no se puede traducir y devuelve null. @param {any} m {modo,valor,pct} @param {number|null|undefined} cierre @returns {number|null} */
export function valorDeMeta(m, cierre) {
  if (modoDeMeta(m) === 'pct') { const c = _n(cierre); return c != null && c > 0 ? c * (1 + Number(m.pct) / 100) : null }
  const v = _n(m && m.valor); return v != null && v > 0 ? v : null
}

/** Meta contra el cierre estimado, en % (null sin cierre). @param {number|null|undefined} valor @param {number|null|undefined} cierre @returns {number|null} */
export function pctSobreCierre(valor, cierre) { const v = _n(valor), c = _n(cierre); return v != null && c != null && c > 0 ? (v / c - 1) * 100 : null }

/** ¿La meta está bajo el cierre estimado? Con la diferencia en pesos y en %. No bloquea: es solo un aviso. @param {number|null|undefined} valor @param {number|null|undefined} cierre */
export function metaBajoCierre(valor, cierre) {
  const p = pctSobreCierre(valor, cierre)
  return p != null && p < -1e-9 ? { bajo: true, pct: p, dif: Number(valor) - Number(cierre) } : { bajo: false, pct: p, dif: p == null ? 0 : Number(valor) - Number(cierre) }
}

/**
 * Lo que falta facturar para llegar a la meta: facturado de la meta menos el arrastre (sin negativos: si el arrastre ya la supera, falta 0 y `exceso` dice cuánto), con sus equivalencias
 * en UF, al mes, % del facturado y vendido neto equivalente (estimación propia: facturado ÷ relación, menos comisiones de venta).
 * @param {{ factMeta:number, arrastre:number, ufMed?:number|null, ratio?:number|null, cv?:number, meses?:number, cierreFact?:number|null }} o
 */
export function faltaFacturar({ factMeta, arrastre, ufMed, ratio, cv = 0, meses = 12, cierreFact = null }) {
  const f = Math.max(0, _n(factMeta) || 0), a = Math.max(0, _n(arrastre) || 0), dif = f - a, falta = Math.max(0, dif)
  return { facturado: f, arrastre: a, falta, exceso: Math.max(0, -dif), pct: f > 0 ? (falta / f) * 100 : 0, sobreCierre: _n(cierreFact) != null && Number(cierreFact) > 0 ? (falta / Number(cierreFact)) * 100 : null, sobreArrastre: a > 0 ? (falta / a) * 100 : null, alMes: meses > 0 ? falta / meses : 0, uf: _n(ufMed) != null && Number(ufMed) > 0 ? falta / Number(ufMed) : null, vendido: falta > 0 ? ventasDeFact(falta, ratio ?? null, cv) : 0 }
}


/**
 * La meta única del paso 4 con lo guardado en st.metas: la cifra fijada (`ancla`, por defecto Vendido), su valor en $ o en % sobre su propio cierre estimado, y la recuperación de cartera.
 * `valor` es lo que escribió el usuario (null si no hay nada escrito ni cierre); `valorCadena` es lo que entra a la cadena vendido → facturado → cobrado → margen → retiros: con Cobrado fijada
 * es la meta menos la recuperación (la recuperación de cartera no es facturación de 2027 y no sube margen ni retiros).
 * @param {{ metas:any, cierres:Record<string,number>, anclas:string[], defecto?:string }} o
 */
export function resolverMeta({ metas, cierres, anclas, defecto = 'ventas' }) {
  const m = metas || {}, escrita = _n(m.valor) != null || (modoDeMeta(m) === 'pct')
  const ancla = anclas.includes(m.ancla) && escrita ? m.ancla : (anclas.includes(defecto) ? defecto : anclas[0])
  const cierre = _n(cierres[ancla]) ?? 0, enPct = valorDeMeta(m, cierre)
  const modo = modoDeMeta(m) === 'pct' && enPct != null ? 'pct' : 'clp'
  const valor = modo === 'pct' ? enPct : _n(m.valor) != null && Number(m.valor) > 0 ? Number(m.valor) : cierre > 0 ? cierre : null
  const rec = Math.max(0, _n(m.rec) || 0)
  return { ancla, modo, pct: modo === 'pct' ? Number(m.pct) : pctSobreCierre(valor, cierre), valor, rec, valorCadena: valor == null ? null : ancla === 'caja' ? valor - rec : valor, cierre, porDefecto: !escrita }
}

/**
 * Cobranza del año: el cobro de lo facturado (sale de la cadena) más la recuperación de cartera de 2026 (editable, dentro de la mora estimada). `dentroMora` avisa si la recuperación supera la mora.
 * @param {{ cobro:number, rec:number, mora:number, porCobrar?:number, cierre?:number|null }} o
 */
export function cobranzaAnio({ cobro, rec, mora, porCobrar = 0, cierre = null }) {
  const c = Math.max(0, _n(cobro) || 0), r = Math.max(0, _n(rec) || 0), m = Math.max(0, _n(mora) || 0), total = c + r
  return { cobro: c, rec: r, total, mora: m, porCobrar: Math.max(0, _n(porCobrar) || 0), dentroMora: r <= m + 1e-9, exceso: Math.max(0, r - m), sobreCierre: _n(cierre) != null && Number(cierre) > 0 ? pctSobreCierre(total, cierre) : null }
}

/** Flujo mensual de lo que falta: la meta de facturado en partes iguales, el arrastre de cada mes y la diferencia (negativa si el arrastre del mes ya supera la meta). @param {number} factMeta @param {number[]} arrastreMes */
export function flujoMensualMeta(factMeta, arrastreMes) {
  const m = Math.max(0, _n(factMeta) || 0) / 12, ar = Array.from({ length: 12 }, (_, i) => Number((arrastreMes || [])[i]) || 0)
  const meta = ar.map(() => m), falta = ar.map((x) => m - x), suma = (/** @type {number[]} */ l) => l.reduce((a, b) => a + b, 0)
  return { meta, arrastre: ar, falta, totales: { meta: suma(meta), arrastre: suma(ar), falta: suma(falta) } }
}
