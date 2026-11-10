// Piezas de interfaz del Presupuesto anual. Formatos de la app (fmtMill, dd-mm-aaaa, es-CL) y paleta C; nada de colores sueltos.
import { useState, useEffect, useRef } from 'react'
import { C, useIsDesktop } from './base.jsx'
import { fmtMill } from './compartido.jsx'
import { aUF, aPesos } from '../../supabase/functions/_shared/presupuesto.js'

export const nf = new Intl.NumberFormat('es-CL')
export const pes = n => (n < 0 ? '−' : '') + '$' + nf.format(Math.abs(Math.round(n)))
export const ufs = n => (n < 0 ? '−' : '') + nf.format(Math.abs(Math.round(n))) + ' UF'

// ── Moneda: UN solo formateador para toda cifra en dinero del Presupuesto ──
// El selector Pesos / UF / Ambos vive en el estado del presupuesto; PresupuestoView lo fija en cada render con `setMoneda` (antes de dibujar los pasos) y todo lo demás pasa por estas funciones.
// Qué UF usa cada una: `mm` = cifras 2027 proyectadas (UF media del año del modelo; los meses traen su propia UF y usan `mx`); `mx` = cifras con su UF exacta (la del día o período de cada movimiento, de la fuente);
// `m26` = cifra 2026 que solo existe en pesos: UF media de los meses transcurridos, marcada «≈». Los nombres con P devuelven una sola moneda (en Ambos, pesos) para chips, flechas y gráficos.
let CFG = { moneda: 'clp', uf27: 0, uf26: 0 }
/** @param {{ moneda?:string, uf27?:number, uf26?:number }} c */
export const setMoneda = (c) => { CFG = { moneda: c.moneda === 'uf' || c.moneda === 'ambos' ? c.moneda : 'clp', uf27: Number(c.uf27) > 0 ? Number(c.uf27) : 0, uf26: Number(c.uf26) > 0 ? Number(c.uf26) : 0 } }
export const monedaActual = () => CFG.moneda
export const tasa27 = () => CFG.uf27
export const tasa26 = () => CFG.uf26
const AMB = '\u2060 · '                       // separa pesos y UF en Ambos; las tarjetas lo parten en dos líneas
const ufTxt = (/** @type {number|null} */ u, /** @type {boolean} */ aprox, dec = 0) => (u == null || !isFinite(u) ? '—' : (aprox ? '≈ ' : '') + (u < 0 ? '−' : '') + Math.abs(u).toLocaleString('es-CL', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + ' UF')
const dinero = (/** @type {any} */ clp, /** @type {number|null} */ u, /** @type {boolean} */ aprox, /** @type {(n:number)=>string} */ fp, dec, /** @type {boolean} */ una) => {
  const c = Number(clp) || 0, m = CFG.moneda
  if (m === 'clp' || (una && m === 'ambos')) return fp(c)
  return m === 'uf' ? ufTxt(u, aprox, dec) : fp(c) + AMB + ufTxt(u, aprox, dec)
}
/** Cifra 2027 (o del modelo): pesos y UF media del año. */
export const mm = (/** @type {any} */ clp) => dinero(clp, aUF(clp, CFG.uf27), false, fmtMill, 0, false)
/** Con la UF exacta de la fuente (`ufMonto`); sin ella, UF media de 2026 marcada «≈». */
export const mx = (/** @type {any} */ clp, /** @type {number|null|undefined} */ ufMonto) => { const ok = ufMonto != null && isFinite(ufMonto); return dinero(clp, ok ? ufMonto : aUF(clp, CFG.uf26), !ok, fmtMill, 0, false) }
/** Cifra 2026 que solo existe en pesos. */
export const m26 = (/** @type {any} */ clp) => mx(clp, null)
/** Una sola moneda (pesos en Ambos): chips, flechas y gráficos. */
export const mmP = (/** @type {any} */ clp) => dinero(clp, aUF(clp, CFG.uf27), false, fmtMill, 0, true)
export const mxP = (/** @type {any} */ clp, /** @type {number|null|undefined} */ ufMonto) => { const ok = ufMonto != null && isFinite(ufMonto); return dinero(clp, ok ? ufMonto : aUF(clp, CFG.uf26), !ok, fmtMill, 0, true) }
/** Pesos completos (monto mensual): «$1.234.567»; en UF con dos decimales. `ufMonto` opcional como en `mx`. */
export const mp = (/** @type {any} */ clp, /** @type {number|null|undefined} */ ufMonto) => { const ok = ufMonto != null && isFinite(ufMonto); return dinero(clp, ok ? ufMonto : aUF(clp, CFG.uf26), !ok, pes, 2, false) }
/**
 * Diferencia entre una cifra `a` (2027 o del modelo) y una referencia `b` (2026): en UF compara UF contra UF (crecimiento real); en Pesos y Ambos, pesos.
 * Sin UF propia, `a` usa la UF media 2027 y `b` la media 2026 («≈»).
 * @param {number} a @param {number} b @param {number|null} [aU] @param {number|null} [bU]
 */
export function difMon(a, b, aU = null, bU = null) {
  const ua = aU ?? aUF(a, CFG.uf27), ub = bU ?? aUF(b, CFG.uf26), uf = CFG.moneda === 'uf' && ua != null && ub != null
  const x = uf ? /** @type {number} */ (ua) : a, y = uf ? /** @type {number} */ (ub) : b, dif = x - y
  return { sube: dif >= 0, sg: dif >= 0 ? '+' : '−', abs: uf ? ufTxt(Math.abs(dif), bU == null) : fmtMill(Math.abs(dif)), pct: y ? (x / y - 1) * 100 : null }
}
/** UF → pesos con la UF dada, de ida y vuelta con `aUF`. */
export { aUF, aPesos }
/** Parte «pesos / UF» de una cifra en Ambos; null si es de una sola moneda. */
export const partirDin = (/** @type {any} */ v) => { const p = typeof v === 'string' ? v.split(AMB) : []; return p.length === 2 ? p : null }
/** Cifra en una celda: en Ambos, los pesos y debajo la UF en chico. */
export function Val({ v }) {
  const p = partirDin(v)
  return p ? <>{p[0]}<span style={{ display: 'block', fontSize: '.55em', fontWeight: 500, letterSpacing: 0, color: C.muted, lineHeight: 1.25, whiteSpace: 'nowrap' }}>{p[1]}</span></> : <>{v}</>
}
export const pc = (n, d = 1) => (n == null || !isFinite(n) ? '—' : n.toLocaleString('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' %')
export const sgn = v => (v >= 0 ? '+' : '−')
export const MESL = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
export const MESC = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

// Número editable con coma decimal y punto de miles: «1.000.000», «4,5».
// `mill` = pesos mostrados en millones con un decimal («101,0»); al escribir, un número de 100.000 o más se entiende como pesos y uno menor como millones.
export const fmtIn = (v, k) => (v == null || v === '' ? '' : k === 'uf' ? Number(v).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : k === 'mill' ? (v / 1e6).toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : k === 'money' ? nf.format(Math.round(v)) : k === 'int' ? String(Math.round(v)) : Number(v).toLocaleString('es-CL', { maximumFractionDigits: 3 }))
export const parseIn = t => { const x = parseFloat(String(t).replace(/[$\sM%]/g, '').replace(/−/g, '-').replace(/\./g, '').replace(',', '.')); return Number.isFinite(x) ? x : NaN }

const P = {
  ventas: 'M3 17l6-6 4 4 8-8M15 7h6v6', fact: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6', wal: 'M3 7a2 2 0 0 1 2-2h13v4M3 7h18v12H3zM16.5 13h.01', tax: 'M19 5L5 19M7 7h.01M17 17h.01',
  res: 'M3 3v18h18M19 9l-5 5-4-4-3 3', ing: 'M9 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM15 15a5 5 0 1 0 5-5', egr: 'M3 6h18v13H3zM3 10h18M7 6V4h10v2', gauge: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 12l4-4',
  doc: 'M7 3h8l4 4v14H7zM15 3v4h4M10 13h6M10 17h6', alerta: 'M12 3L2 20h20zM12 10v5M12 18v.01', pers: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21c1-5 15-5 16 0', cal: 'M4 5h16v16H4zM4 10h16M9 3v4M15 3v4',
  tgt: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 12h.01', horas: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2', com: 'M19 5L5 19M7 7h.01M17 17h.01',
}
export const Ic = ({ n, s = 18 }) => <svg width={s} height={s} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'><path d={P[n] || P.doc} /></svg>

const TONO = {
  a: { bg: C.azulBg, fg: C.azulInfo, v: C.accent, bd: C.azulBd },
  y: { bg: C.soonBg, fg: C.soonText, v: C.soonText, bd: C.avisoLine },
  g: { bg: C.greenBg, fg: C.greenText, v: C.greenText, bd: C.greenDeep },
  w: { bg: C.card, fg: C.accent, v: C.accent, bd: C.border },
  t: { bg: C.tealBg, fg: C.tealText, v: C.tealText, bd: C.tealBg },
  r: { bg: C.ambarBg, fg: C.coralText, v: C.coralText, bd: C.ambarBg },
}
// Un tono por escenario, con fichas de C que no chocan con los de los componentes (Vendido azul, Facturado amarillo, Cobrado verde, Presupuesto de costos turquesa, Retiros ámbar, Margen blanco):
// Prudente = gris cálido (cautela), Base = azul acero tenue con el azul de la marca, Optimista = azul marino sólido con letra blanca. Se aplica al selector, a la tarjeta y a su chip.
export const ESC_TONO = {
  prudente: { bg: C.bgWarm, fg: C.grisText, bd: C.border },
  base: { bg: C.tileLineOn, fg: C.accent, bd: C.tileLineOn },
  meta: { bg: C.accent, fg: '#fff', bd: C.accent },
}
export const LBL = { fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase' }

// Tarjeta de resultado (la de Inicio): ícono en caja blanca, rótulo, cifra grande y una línea.
export function Kpi({ tono = 'w', ic, label, value, sub, onClick }) {
  const t = TONO[tono], D = useIsDesktop()
  return <div onClick={onClick} style={{ background: t.bg, color: t.fg, border: `1px solid ${t.bd}`, borderRadius: 12, padding: D ? '10px 12px' : '12px 10px', display: 'flex', flexDirection: 'row', alignItems: 'center', gap: D ? 12 : 9, minWidth: 0, cursor: onClick ? 'pointer' : 'default', boxSizing: 'border-box' }}>
    <span style={{ width: D ? 32 : 30, height: D ? 32 : 30, borderRadius: D ? 10 : 8, background: tono === 'w' ? C.bgSoft : C.card, display: 'grid', placeItems: 'center', flexShrink: 0 }}><Ic n={ic} s={18} /></span>
    <div style={{ minWidth: 0, flex: 1 }}><div style={{ ...LBL, color: C.accent, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.25 }}>{label}</div><div style={{ fontSize: D ? 22 : 20, fontWeight: 800, letterSpacing: -0.6, lineHeight: 1.1, color: C.accent, fontVariantNumeric: 'tabular-nums' }}><Val v={value} /></div>{sub && <div style={{ fontSize: 11, marginTop: 2, color: C.muted }}>{sub}</div>}</div>
  </div>
}

// Tarjeta chica con ícono (indicadores, resumen). El rótulo va en mayúscula; la cifra a 20 px.
export function Mini({ ic, label, value, sub, cls, onClick }) {
  const col = cls === 'pos' ? C.greenText : cls === 'neg' ? C.overdueText : cls === 'amb' ? C.soonText : C.accent
  return <div onClick={onClick} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, cursor: onClick ? 'pointer' : 'default', boxSizing: 'border-box' }}>
    <span style={{ width: 34, height: 34, borderRadius: 10, background: C.azulBg, color: C.azulInfo, display: 'grid', placeItems: 'center', flexShrink: 0 }}><Ic n={ic} s={18} /></span>
    <div style={{ minWidth: 0 }}><div style={{ ...LBL, color: C.accent, lineHeight: 1.2 }}>{label}</div><div style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.4, color: col, marginTop: 1, fontVariantNumeric: 'tabular-nums' }}><Val v={value} /></div>{sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>{sub}</div>}</div>
  </div>
}

export const Titulo = ({ children, right, style }) => <div style={{ ...LBL, color: C.accent, margin: '8px 4px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', ...style }}><span>{children}</span>{right}</div>

export function Panel({ hd, small, children, pad, style, flex }) {
  return <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, minWidth: 0, overflow: 'hidden', ...(flex ? { flex: 1 } : {}), ...style }}>
    {hd && <div style={{ ...LBL, color: C.accent, padding: '12px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}><span>{hd}</span>{small && <span style={{ fontWeight: 500, letterSpacing: 0, textTransform: 'none', color: C.muted, fontSize: 12 }}>{small}</span>}</div>}
    {pad ? <div style={{ padding: '12px 16px' }}>{children}</div> : children}
  </div>
}

export function Seg({ options, value, onChange, style, tonos }) {
  return <div role='group' style={{ display: 'inline-flex', border: `1px solid ${C.border}`, borderRadius: 20, overflow: 'hidden', background: C.card, ...style }}>
    {options.map(([k, n]) => { const on = value === k, tn = tonos && tonos[k]
      return <button key={k} aria-pressed={on} onClick={() => onChange(k)} style={{ border: 0, background: on ? (tn ? tn.bg : C.azulBg) : 'transparent', color: on ? (tn ? tn.fg : C.accent) : C.muted, fontFamily: 'inherit', fontSize: 12.5, fontWeight: on ? 800 : 600, padding: '6px 11px', cursor: 'pointer', whiteSpace: 'nowrap' }}>{n}</button> })}
  </div>
}

export const Chip = ({ children, tono, c }) => { const t = c ? c : tono === 'y' ? { bg: C.ambarBg, fg: C.soonText } : tono === 'r' ? { bg: C.overdueBg, fg: C.overdueText } : tono === 'g' ? { bg: C.greenBg, fg: C.greenText } : tono === 'z' ? { bg: C.bgSoft, fg: C.muted } : { bg: C.azulBg, fg: C.azulInfo }
  return <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 20, background: t.bg, color: t.fg, whiteSpace: 'nowrap' }}>{children}</span> }

export const Btn = ({ children, onClick, primary, disabled, style, title }) => <button title={title} disabled={disabled} onClick={onClick} style={{ border: `1px solid ${primary ? C.accent : C.border}`, background: primary ? C.accent : C.card, color: primary ? '#fff' : C.accent, fontFamily: 'inherit', fontWeight: 700, fontSize: 13, padding: '8px 16px', borderRadius: 20, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.35 : 1, whiteSpace: 'nowrap', ...style }}>{children}</button>
export const Lnk = ({ children, onClick, rojo }) => <button onClick={onClick} style={{ border: 0, background: 'transparent', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, color: rojo ? C.overdueText : C.accent, cursor: 'pointer', padding: '4px 2px' }}>{children}</button>

// Campo con la unidad dentro. Escribe con el formato es-CL y confirma al salir del campo o con Enter (sin perder el foco mientras se teclea).
// `sobrio`: sin relleno (el fondo es el de la tarjeta), subrayado fino al pasar o enfocar y, en pantallas táctiles, un recuadro tenue siempre visible; la cifra no se mueve (el recuadro sale
// hacia los lados) y queda en la misma línea y del mismo tamaño que una cifra real. `grande`: la cifra de una tarjeta (26 px, 22 px en el celular).
export function Fld({ kind = 'pct', value, onCommit, pre, suf, ph, w = 132, text, sobrio, grande, sel, label }) {
  const [v, setV] = useState(() => (text ? String(value ?? '') : fmtIn(value, kind)))
  useEffect(() => { setV(text ? String(value ?? '') : fmtIn(value, kind)) }, [value, kind, text])
  const fin = () => {
    if (text) { if (v !== String(value ?? '')) onCommit(v); return }
    if (v.trim() === '' && kind === 'pct' && ph != null) { onCommit(null); return }
    let x = parseIn(v)
    if (Number.isFinite(x) && kind === 'mill' && Math.abs(x) < 100000) x *= 1e6
    if (Number.isFinite(x)) { if (x !== value) onCommit(x) } else setV(fmtIn(value, kind))
  }
  const alTeclear = e => { if (e.key === 'Enter') e.currentTarget.blur() }
  if (sobrio) return <label className={'pfs' + (grande ? ' g' : '') + (sel ? ' sel' : '')} onClick={e => e.stopPropagation()}>
    {pre && <span className='pfu'>{pre}</span>}
    <span className='pfw'><span className='pfm' aria-hidden='true'>{v || ph || ' '}</span><input size={1} value={v} placeholder={ph} aria-label={label} inputMode={text ? 'text' : 'decimal'} autoComplete='off' onFocus={e => e.target.select()} onChange={e => setV(e.target.value)} onBlur={fin} onKeyDown={alTeclear} /></span>
    {suf && <span className='pfu'>{suf}</span>}
  </label>
  return <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 10px', background: C.bgSoft, border: `1px solid ${C.border}`, borderRadius: 8, width: '100%', maxWidth: text ? 'none' : w, boxSizing: 'border-box' }}>
    {pre && <span style={{ fontSize: 12, color: C.muted }}>{pre}</span>}
    <input value={v} placeholder={ph} aria-label={label} inputMode={text ? 'text' : 'decimal'} onChange={e => setV(e.target.value)} onBlur={fin} onKeyDown={alTeclear} style={{ border: 0, background: 'transparent', fontFamily: 'inherit', fontSize: 13.5, fontWeight: text ? 600 : 700, color: C.text, textAlign: text ? 'left' : 'right', width: '100%', minWidth: 0, padding: 0, outline: 'none' }} />
    {suf && <span style={{ fontSize: 12, color: C.muted, flexShrink: 0 }}>{suf}</span>}
  </label>
}

/**
 * Campo de dinero que sigue al selector: en Pesos escribe pesos (`kind` money o mill, como el campo original); en UF escribe UF con dos decimales y guarda pesos = UF × `tasa`;
 * en Ambos escribe pesos y muestra debajo el equivalente en UF. `clp` = valor guardado (pesos); `tasa` = UF con que se convierte (27 = `tasa27()`, 26 = `tasa26()`, aproximada).
 */
export function FldDin({ clp, tasa, onCommit, kind = 'money', pre = '$', suf, ...rest }) {
  const m = CFG.moneda, ok = Number(tasa) > 0
  if (m === 'uf' && ok) return <Fld {...rest} kind='uf' suf=' UF' value={Math.round((Number(clp) / tasa) * 100) / 100} onCommit={(x) => onCommit(Math.round(x * tasa))} />
  const campo = <Fld {...rest} kind={kind} pre={pre} suf={suf} value={clp} onCommit={onCommit} />
  if (m !== 'ambos' || !ok) return campo
  return <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', minWidth: 0 }}>{campo}<span style={{ fontSize: 10.5, fontWeight: 500, color: C.muted, letterSpacing: 0, lineHeight: 1.3 }}>{ufTxt(Number(clp) / tasa, false)}</span></span>
}

// Estilos del campo sobrio (hover, foco y pantallas táctiles no se pueden escribir en línea). Una sola vez, al abrir el Presupuesto.
export function EstilosPresupuesto() {
  const A = C.accent, tenue = `color-mix(in srgb, ${A} 14%, transparent)`, medio = `color-mix(in srgb, ${A} 38%, transparent)`
  return <style>{`
.pfs{flex-shrink:0;display:inline-flex;align-items:baseline;gap:2px;box-sizing:border-box;cursor:text;border:0 solid transparent;border-bottom-width:1px;padding:0 8px;margin:0 -8px -1px;color:inherit;font:inherit;letter-spacing:inherit;line-height:inherit;font-variant-numeric:tabular-nums}
.pfs:hover,.pfs:focus-within{border-bottom-color:${medio}}
.pfs:focus-within,.pfs.sel{border-bottom-color:${A}}
.pfs .pfw{display:inline-grid;min-width:1.2ch}
.pfs .pfw>*{grid-area:1/1;font:inherit;letter-spacing:inherit;min-width:0}
.pfs .pfm{min-width:auto!important;visibility:hidden;white-space:pre;padding:0 3px 0 1px;height:1.15em;line-height:1.15}
.pfs input{width:100%;border:0;outline:0;background:transparent;color:inherit;padding:0;text-align:left;height:1.15em;line-height:1.15;font-variant-numeric:tabular-nums}
.pfs input::placeholder{color:${C.done};font-weight:500}
.pfs .pfu{font:inherit;letter-spacing:inherit}
.pfs.g{font-size:26px;font-weight:800;letter-spacing:-.9px;line-height:1.15;color:${A}}
@media (max-width:700px){.pfs.g{font-size:22px}}
@media (hover:none){.pfs{border:1px solid ${tenue};border-radius:8px;margin:-1px -9px;padding:0 8px}.pfs:focus-within,.pfs.sel{border-color:${A}}}
`}</style>
}

// Botones − / + con el valor al medio (palancas de cada escenario).
export function Stp({ value, suf, step, min, max, onChange, int }) {
  const dar = d => onChange(Math.min(max, Math.max(min, Math.round((value + d) * 100) / 100)))
  const b = { border: 0, background: 'transparent', width: 28, height: 28, color: C.accent, fontSize: 16, fontWeight: 700, cursor: 'pointer', padding: 0, lineHeight: 1 }
  return <div style={{ display: 'inline-flex', alignItems: 'center', border: `1px solid ${C.border}`, borderRadius: 20, background: C.bgSoft, height: 30, maxWidth: '100%' }}>
    <button aria-label='Menos' onClick={e => { e.stopPropagation(); dar(-step) }} style={b}>−</button>
    <span style={{ minWidth: 46, textAlign: 'center', fontWeight: 700, fontSize: 12.5, whiteSpace: 'nowrap' }}>{fmtIn(value, int ? 'int' : 'pct')}{suf}</span>
    <button aria-label='Más' onClick={e => { e.stopPropagation(); dar(step) }} style={b}>+</button>
  </div>
}

// Fila de lista: nombre con la flecha de navegación justo después, dato secundario debajo y la cifra siempre al extremo derecho.
export function Fila({ nombre, peq, valor, sub, onClick, abierta, sin, tot, children }) {
  const D = useIsDesktop()
  return <>
    <div onClick={onClick} style={{ display: 'grid', gridTemplateColumns: D ? 'fit-content(62%) 18px minmax(0,1fr) auto auto' : 'fit-content(75%) 18px minmax(0,1fr) auto', gap: 10, alignItems: 'center', padding: '12px 16px', cursor: onClick ? 'pointer' : 'default', fontSize: 13, borderTop: tot ? `2px solid ${C.accent}` : `1px solid ${C.border}`, background: abierta || tot ? C.bgSoft : 'transparent', fontWeight: tot ? 800 : 400 }}>
      <div style={{ minWidth: 0 }}><div style={{ fontWeight: tot ? 800 : 600 }}>{nombre}</div>{peq && <div style={{ fontSize: 11, color: C.muted, marginTop: 1, fontWeight: 400 }}>{peq}</div>}</div>
      <span style={{ color: C.done, fontSize: 16, lineHeight: 1, transform: abierta ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>{onClick && !sin ? '›' : ''}</span>
      <span />
      {D && <span style={{ textAlign: 'right', color: C.muted }}><Val v={sub} /></span>}
      <span style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', gridColumn: D ? undefined : 4 }}><Val v={valor} /></span>
    </div>
    {children}
  </>
}

export const Det = ({ t, children }) => <details style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '10px 14px', fontSize: 12.5, color: C.muted }}><summary style={{ cursor: 'pointer', fontWeight: 700, color: C.accent, fontSize: 12 }}>{t}</summary><div style={{ marginTop: 8, color: C.text }}>{children}</div></details>

export const Lista = ({ items }) => <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>{items.map((x, i) => <li key={i}>{x}</li>)}</ul>

// Cuadrícula de N columnas en escritorio y las de celular; sin desbordes.
export function Grid({ cols = 4, colsM = 2, gap = 10, children, style }) {
  const D = useIsDesktop()
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(${D ? cols : colsM},minmax(0,1fr))`, gap, alignItems: 'stretch', ...style }}>{children}</div>
}

// Flecha de comparación: ↑ si la cifra está sobre la referencia y ↓ si está bajo; verde = a favor, rojo = en contra.
export const Flecha = ({ sube, bueno, children }) => <span style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', color: bueno ? C.greenText : C.overdueText }}>{sube ? '↑' : '↓'} {children}</span>

// Tarjeta de un componente: rótulo sobrio, dos cifras del mismo tamaño en la misma línea base, UNA línea de comparación con flechas y un detalle que se abre con la flecha.
// Solo tipografía: sin pills ni barras. `izq`/`der` = { cap, val } (val puede ser un campo editable); `cmp` = <Flecha/> o texto; `det` = filas [rótulo, valor, ir?].
export function Tarjeta({ tono = 'w', ic, label, izq, der, cmp, det, onClick, aria }) {
  const t = TONO[tono], D = useIsDesktop(), [abre, setAbre] = useState(false), ref = useRef(null)
  const fig = f => <div style={{ minWidth: 0 }}><div style={{ fontSize: 10.5, fontWeight: 500, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 1 }}>{f.cap}</div>
    <div style={{ fontSize: D ? 26 : 22, fontWeight: 800, letterSpacing: -0.9, lineHeight: 1.15, color: C.accent, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', minHeight: '1.15em' }}><Val v={f.val} /></div></div>
  return <div ref={ref} role={onClick ? 'button' : undefined} aria-label={aria} onClick={onClick} style={{ background: t.bg, color: t.fg, border: `1px solid ${t.bd}`, borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0, cursor: onClick ? 'pointer' : 'default', boxSizing: 'border-box' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ width: 32, height: 32, borderRadius: 10, background: tono === 'w' ? C.bgSoft : C.card, display: 'grid', placeItems: 'center', flexShrink: 0 }}><Ic n={ic} s={18} /></span>
      <span style={{ ...LBL, fontSize: 10.5, fontWeight: 600, letterSpacing: '.7px', flex: 1, lineHeight: 1.2, color: tono === 'w' ? C.muted : 'inherit', opacity: tono === 'w' ? 1 : 0.9 }}>{label}</span>
      {det && <button aria-label={abre ? 'Cerrar el detalle' : 'Ver el detalle'} aria-expanded={abre} onClick={e => { e.stopPropagation(); setAbre(a => !a) }} style={{ border: 0, background: 'transparent', color: 'inherit', width: 28, height: 28, display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0, transform: abre ? 'rotate(90deg)' : 'none' }}><svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'><path d='M9 6l6 6-6 6' /></svg></button>}
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 12, alignItems: 'end' }}>{fig(izq)}{fig(der)}</div>
    {cmp != null && <div style={{ display: 'flex', gap: '2px 14px', flexWrap: 'wrap', fontSize: 12, color: C.muted, fontVariantNumeric: 'tabular-nums', minHeight: 17 }}>{cmp}</div>}
    {abre && det && <div style={{ borderTop: `1px solid color-mix(in srgb, currentColor 18%, transparent)`, paddingTop: 8, display: 'grid', gap: 4, fontSize: 12 }}>
      {det.map(([k, v, go], i) => <div key={i} onClick={go ? e => { e.stopPropagation(); go() } : undefined} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, cursor: go ? 'pointer' : 'default' }}><span style={{ color: C.muted }}>{k}{go ? ' ›' : ''}</span><b style={{ color: C.accent, textAlign: 'right' }}>{v}</b></div>)}
    </div>}
  </div>
}

// ── Navegación del Presupuesto: menú desplegable, pasos numerados y pestañas subrayadas ──
/** Botón con menú de opciones (año, moneda): se cierra al elegir o al tocar fuera. `boton` = contenido del botón; `opciones` = [[valor, rótulo]]. */
export function Menu({ boton, opciones, valor, onChange, derecha, aria, estilo }) {
  const [abre, setAbre] = useState(false), ref = useRef(null)
  useEffect(() => {
    if (!abre) return
    const fuera = (/** @type {any} */ e) => { if (ref.current && !ref.current.contains(e.target)) setAbre(false) }
    document.addEventListener('mousedown', fuera); document.addEventListener('touchstart', fuera)
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('touchstart', fuera) }
  }, [abre])
  return <span ref={ref} style={{ position: 'relative', display: 'inline-flex', minWidth: 0 }}>
    <button aria-label={aria} aria-haspopup='menu' aria-expanded={abre} onClick={() => setAbre((a) => !a)} style={{ border: 0, background: 'transparent', fontFamily: 'inherit', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 2px', color: 'inherit', fontSize: 'inherit', fontWeight: 'inherit', ...estilo }}>{boton}<span aria-hidden='true' style={{ width: 0, height: 0, borderLeft: '4px solid transparent', borderRight: '4px solid transparent', borderTop: '5px solid currentColor', display: 'inline-block' }} /></button>
    {abre && <div role='menu' style={{ position: 'absolute', top: '100%', [derecha ? 'right' : 'left']: 0, zIndex: 30, marginTop: 6, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 6, minWidth: 170, boxShadow: '0 8px 24px rgba(0,60,80,.14)' }}>
      {opciones.map(([k, n]) => <button key={String(k)} role='menuitem' onClick={() => { setAbre(false); onChange(k) }} style={{ display: 'block', width: '100%', textAlign: 'left', border: 0, fontFamily: 'inherit', cursor: 'pointer', padding: '9px 10px', borderRadius: 8, whiteSpace: 'nowrap', fontSize: 13, background: valor === k ? C.azulBg : 'transparent', color: valor === k ? C.accent : C.muted, fontWeight: valor === k ? 800 : 600 }}>{n}</button>)}
    </div>}
  </span>
}

/** Botón-chip de la barra de contexto (Versiones, Excel). */
export const ChipBtn = ({ children, onClick, aria, error, cuadrado, titulo }) => <button aria-label={aria} title={titulo} onClick={onClick} style={{ border: `1px solid ${error ? C.overdueBd : C.border}`, background: error ? C.overdueBg : C.card, color: error ? C.overdueText : C.accent, fontFamily: 'inherit', fontWeight: 700, fontSize: 12.5, height: 32, minWidth: cuadrado ? 32 : undefined, padding: cuadrado ? 0 : '0 12px', borderRadius: 20, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, whiteSpace: 'nowrap' }}>{children}</button>

/**
 * Pasos del presupuesto en una sola fila de círculos (check en los revisados), con la línea de tiempo encima: el año base sobre el paso 1 y el año del presupuesto sobre los pasos 2 a 6.
 * En escritorio cada círculo lleva su nombre; en el celular solo los círculos y, debajo, «Paso n de 6» con el nombre del paso activo.
 */
export function Pasos({ nombres, activa, hechos, onIr, anioBase, anio, desc }) {
  const D = useIsDesktop(), n = nombres.length
  const cap = { fontSize: D ? 11 : 10.5, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: C.accent, paddingBottom: 5, borderBottom: `1px solid ${C.done}`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${n},minmax(0,1fr))`, gap: 0 }}><span style={cap}>{D ? `Año base ${anioBase}` : anioBase}</span><span style={{ ...cap, gridColumn: `2 / span ${n - 1}`, marginLeft: 8 }}>Presupuesto {anio}</span></div>
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${n},minmax(0,1fr))`, alignItems: 'start' }}>
      {nombres.map((nom, i) => { const on = activa === i, ok = !on && hechos.includes(i)
        return <button key={nom} aria-current={on ? 'step' : undefined} aria-label={`Paso ${i + 1}: ${nom}${ok ? ', revisado' : ''}`} onClick={() => onIr(i)} style={{ border: 0, background: 'none', fontFamily: 'inherit', cursor: 'pointer', display: 'flex', flexDirection: D ? 'row' : 'column', alignItems: 'center', justifyContent: D ? 'flex-start' : 'center', gap: 8, padding: D ? '4px 2px' : 0, textAlign: 'left', minWidth: 0, width: '100%', boxSizing: 'border-box', color: on ? C.accent : C.muted, fontWeight: on ? 800 : 600, fontSize: 13 }}>
          <span style={{ width: D ? 28 : 38, height: D ? 28 : 38, borderRadius: '50%', border: `1.5px solid ${on ? C.accent : ok ? C.normal : C.done}`, background: on ? C.accent : ok ? C.greenBg : C.card, color: on ? '#fff' : ok ? C.greenText : C.muted, display: 'grid', placeItems: 'center', fontSize: D ? 12.5 : 14, fontWeight: 700, flexShrink: 0 }}>{ok ? '✓' : i + 1}</span>
          {D && <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{nom}</span>}
        </button> })}
    </div>
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <div><div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: C.muted }}>Paso {activa + 1} de {n}</div><div style={{ fontSize: D ? 21 : 19, fontWeight: 800, color: C.accent, letterSpacing: -0.3, lineHeight: 1.2 }}>{nombres[activa]}</div></div>
      {D && desc && <div style={{ fontSize: 12.5, color: C.muted }}>{desc[activa]}</div>}
    </div>
  </div>
}

/** Pestañas subrayadas (sub-vistas de un paso). */
export const Pestanas = ({ options, value, onChange }) => <div role='tablist' style={{ display: 'flex', gap: 22, borderBottom: `1px solid ${C.border}` }}>
  {options.map(([k, n]) => { const on = value === k; return <button key={k} role='tab' aria-selected={on} onClick={() => onChange(k)} style={{ border: 0, background: 'none', fontFamily: 'inherit', cursor: 'pointer', padding: '10px 2px', fontSize: 13, fontWeight: on ? 800 : 600, color: on ? C.accent : C.muted, borderBottom: `2px solid ${on ? C.accent : 'transparent'}`, marginBottom: -1 }}>{n}</button> })}
</div>
