// Piezas de interfaz del Presupuesto anual. Formatos de la app (fmtMill, dd-mm-aaaa, es-CL) y paleta C; nada de colores sueltos.
import { useState, useEffect, useRef } from 'react'
import { C, useIsDesktop } from './base.jsx'
import { fmtMill } from './compartido.jsx'
import { aUF, aPesos } from '../../supabase/functions/_shared/presupuesto.js'

export const nf = new Intl.NumberFormat('es-CL')
export const pes = n => (n < 0 ? '−' : '') + '$' + nf.format(Math.abs(Math.round(n)))
// Formato único de cifras: pesos en millones SIN espacio ($806,7M, fmtMill); la unidad reajustable (UF, módulo país de la configuración) siempre después del número y separada por un espacio (12.345 UF), nunca antes.
let UNIDAD = 'UF'
export const unidadUF = () => UNIDAD
export const ufs = n => (n < 0 ? '−' : '') + nf.format(Math.abs(Math.round(n))) + ' ' + UNIDAD

// ── Moneda: UN solo formateador para toda cifra en dinero del Presupuesto ──
// El selector Pesos / UF / Ambos vive en el estado del presupuesto; PresupuestoView lo fija en cada render con `setMoneda` (antes de dibujar los pasos) y todo lo demás pasa por estas funciones.
// Qué UF usa cada una: `mm` = cifras 2027 proyectadas (UF media del año del modelo; los meses traen su propia UF y usan `mx`); `mx` = cifras con su UF exacta (la del día o período de cada movimiento, de la fuente);
// `m26` = cifra 2026 que solo existe en pesos: UF media de los meses transcurridos, marcada «≈». Los nombres con P devuelven una sola moneda (en Ambos, pesos) para chips, flechas y gráficos.
let CFG = { moneda: 'clp', uf27: 0, uf26: 0 }
/** @param {{ moneda?:string, uf27?:number, uf26?:number, unidad?:string }} c */
export const setMoneda = (c) => { if (c.unidad) UNIDAD = String(c.unidad); CFG = { moneda: c.moneda === 'uf' || c.moneda === 'ambos' ? c.moneda : 'clp', uf27: Number(c.uf27) > 0 ? Number(c.uf27) : 0, uf26: Number(c.uf26) > 0 ? Number(c.uf26) : 0 } }
export const monedaActual = () => CFG.moneda
export const tasa27 = () => CFG.uf27
export const tasa26 = () => CFG.uf26
const AMB = '\u2060 · '                       // separa pesos y UF en Ambos; las tarjetas lo parten en dos líneas
const ufTxt = (/** @type {number|null} */ u, /** @type {boolean} */ aprox, dec = 0) => (u == null || !isFinite(u) ? '—' : (aprox ? '≈ ' : '') + (u < 0 ? '−' : '') + Math.abs(u).toLocaleString('es-CL', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + ' ' + UNIDAD)
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
  return p ? <>{p[0]}<span style={{ display: 'block', fontSize: 11, fontWeight: 500, letterSpacing: 0, color: C.muted, lineHeight: 1.25, whiteSpace: 'nowrap' }}>{p[1]}</span></> : <>{v}</>
}
export const pc = (n, d = 1) => (n == null || !isFinite(n) ? '—' : n.toLocaleString('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' %')
export const sgn = v => (v >= 0 ? '+' : '−')
export const MESL = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
export const MESC = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

// Número editable con coma decimal y punto de miles: «1.000.000», «4,5».
// `mill` = pesos mostrados en millones con un decimal («101,0»); al escribir, un número de 100.000 o más se entiende como pesos y uno menor como millones.
export const fmtIn = (v, k) => (v == null || v === '' ? '' : k === 'uf' ? Number(v).toLocaleString('es-CL', Math.abs(v) >= 1000 ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : k === 'mill' ? (v / 1e6).toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : k === 'money' ? nf.format(Math.round(v)) : k === 'int' ? String(Math.round(v)) : Number(v).toLocaleString('es-CL', { maximumFractionDigits: 3 }))
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
// Un tono por escenario (el índice `t` guardado en cada escenario), con fichas de C que no chocan con los de los componentes (Vendido azul, Facturado amarillo, Cobrado verde, Presupuesto de costos turquesa, Retiros ámbar, Margen blanco):
// 0 gris cálido (cautela), 1 azul acero tenue con el azul de la marca, 2 azul marino sólido con letra blanca, 3 azul grisáceo sólido (AZUL2) con letra blanca y 4 azul grisáceo claro (AZUL3) con letra de la marca.
// Se aplica al selector, a la tarjeta y a su chip. Con más escenarios que tonos, el tono se repite (el nombre los distingue).
export const ESC_TONOS = [
  { bg: C.bgWarm, fg: C.grisText, bd: C.border },
  { bg: C.tileLineOn, fg: C.accent, bd: C.tileLineOn },
  { bg: C.accent, fg: '#fff', bd: C.accent },
  { bg: C.muted, fg: '#fff', bd: C.muted },
  { bg: C.done, fg: C.accent, bd: C.done },
]
/** Tono (bg/fg/bd) de un escenario del estado por su índice de tono. @param {number|null|undefined} t */
export const tonoEsc = (t) => ESC_TONOS[((Number(t) || 0) % ESC_TONOS.length + ESC_TONOS.length) % ESC_TONOS.length]
export const LBL = { fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase' }

/** Props de un elemento tocable con teclado (H04): rol botón, tabIndex, Enter y Espacio, y foco visible (clase pp-foco). Sin onClick no agrega nada. */
export const tocable = (/** @type {any} */ onClick) => onClick ? { role: 'button', tabIndex: 0, className: 'pp-foco', onClick, onKeyDown: (/** @type {any} */ e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onClick(e) } } } : {}

// Tarjeta de resultado (la de Inicio): ícono en caja blanca, rótulo, cifra grande y una línea.
export function Kpi({ tono = 'w', ic, label, value, sub, onClick }) {
  const t = TONO[tono], D = useIsDesktop()
  return <div {...tocable(onClick)} style={{ background: t.bg, color: t.fg, border: `1px solid ${t.bd}`, borderRadius: 12, padding: D ? '10px 12px' : '8px 10px', display: 'flex', flexDirection: 'row', alignItems: 'center', gap: D ? 12 : 9, minWidth: 0, cursor: onClick ? 'pointer' : 'default', boxSizing: 'border-box' }}>
    <span style={{ width: D ? 32 : 30, height: D ? 32 : 30, borderRadius: D ? 10 : 8, background: tono === 'w' ? C.bgSoft : C.card, display: 'grid', placeItems: 'center', flexShrink: 0 }}><Ic n={ic} s={18} /></span>
    <div style={{ minWidth: 0, flex: 1 }}><div style={{ ...LBL, color: C.accent, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.25 }}>{label}</div><div style={{ fontSize: D ? 21 : 19, fontWeight: 800, letterSpacing: -0.6, lineHeight: 1.1, color: C.accent, fontVariantNumeric: 'tabular-nums' }}><Val v={value} /></div>{sub && <div style={{ fontSize: 11, marginTop: 2, color: C.muted }}>{sub}</div>}</div>
  </div>
}

// Tarjeta chica con ícono (indicadores, resumen). El rótulo va en mayúscula; la cifra a 20 px.
export function Mini({ ic, label, value, sub, cls, onClick }) {
  const D = useIsDesktop(), col = cls === 'pos' ? C.greenText : cls === 'neg' ? C.overdueText : cls === 'amb' ? C.soonText : C.accent
  return <div {...tocable(onClick)} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: D ? '7px 12px' : '9px 10px', display: 'flex', alignItems: 'center', gap: D ? 12 : 9, minWidth: 0, cursor: onClick ? 'pointer' : 'default', boxSizing: 'border-box' }}>
    <span style={{ width: D ? 34 : 28, height: D ? 34 : 28, borderRadius: 10, background: C.azulBg, color: C.azulInfo, display: 'grid', placeItems: 'center', flexShrink: 0 }}><Ic n={ic} s={18} /></span>
    <div style={{ minWidth: 0 }}><div style={{ ...LBL, color: C.accent, lineHeight: 1.2, whiteSpace: 'nowrap', fontSize: 10.5, letterSpacing: '.3px' }}>{label}</div><div style={{ fontSize: D ? 19 : 16, fontWeight: 800, letterSpacing: -0.4, color: col, marginTop: 1, fontVariantNumeric: 'tabular-nums' }}><Val v={value} /></div>{sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>{sub}</div>}</div>
  </div>
}

export const Titulo = ({ children, right, style }) => <div style={{ ...LBL, color: C.accent, margin: '4px 4px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', ...style }}><span>{children}</span>{right}</div>

export function Panel({ hd, small, children, pad, style, flex }) {
  return <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, minWidth: 0, overflow: 'hidden', ...(flex ? { flex: 1 } : {}), ...style }}>
    {hd && <div style={{ ...LBL, color: C.accent, padding: '9px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}><span>{hd}</span>{small && <span style={{ fontWeight: 500, letterSpacing: 0, textTransform: 'none', color: C.muted, fontSize: 12 }}>{small}</span>}</div>}
    {pad ? <div style={{ padding: '12px 16px' }}>{children}</div> : children}
  </div>
}

export function Seg({ options, value, onChange, style, tonos }) {
  return <div role='group' style={{ display: 'inline-flex', border: `1px solid ${C.border}`, borderRadius: 20, overflow: 'hidden', background: C.card, ...style }}>
    {options.map(([k, n]) => { const on = value === k, tn = tonos && tonos[k]
      return <button key={k} className='pp-tac pp-pill' aria-pressed={on} onClick={() => onChange(k)} style={{ border: 0, background: on ? (tn ? tn.bg : C.azulBg) : 'transparent', color: on ? (tn ? tn.fg : C.accent) : C.muted, fontFamily: 'inherit', fontSize: 12, fontWeight: on ? 800 : 600, padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}>{n}</button> })}
  </div>
}

export const Chip = ({ children, tono, c }) => { const t = c ? c : tono === 'y' ? { bg: C.ambarBg, fg: C.soonText } : tono === 'r' ? { bg: C.overdueBg, fg: C.overdueText } : tono === 'g' ? { bg: C.greenBg, fg: C.greenText } : tono === 'z' ? { bg: C.bgSoft, fg: C.muted } : { bg: C.azulBg, fg: C.azulInfo }
  return <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 20, background: t.bg, color: t.fg, whiteSpace: 'nowrap' }}>{children}</span> }

export const Btn = ({ children, onClick, primary, disabled, style, title }) => <button title={title} className='pp-tac pp-pill' disabled={disabled} onClick={onClick} style={{ border: `1px solid ${primary ? C.accent : C.border}`, background: primary ? C.accent : C.card, color: primary ? '#fff' : C.accent, fontFamily: 'inherit', fontWeight: 700, fontSize: 13, padding: '4px 12px', lineHeight: 1.3, borderRadius: 20, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.35 : 1, whiteSpace: 'nowrap', ...style }}>{children}</button>
export const Lnk = ({ children, onClick, rojo, titulo }) => <button title={titulo} className='pp-tac' aria-label={titulo} onClick={onClick} style={{ border: 0, background: 'transparent', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, color: rojo ? C.overdueText : C.accent, cursor: 'pointer', padding: '4px 2px' }}>{children}</button>

// Campo con la unidad dentro. Escribe con el formato es-CL y confirma al salir del campo o con Enter (sin perder el foco mientras se teclea).
// `sobrio`: sin relleno (el fondo es el de la tarjeta), subrayado fino al pasar o enfocar y, en pantallas táctiles, un recuadro tenue siempre visible; la cifra no se mueve (el recuadro sale
// hacia los lados) y queda en la misma línea y del mismo tamaño que una cifra real. `grande`: la cifra de una tarjeta (26 px, 22 px en el celular).
export function Fld({ kind = 'pct', value, onCommit, pre, suf, ph, w = 132, text, sobrio, grande, sel, label, chica }) {
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
  if (sobrio) return <label className={'pfs' + (grande ? ' g' : '') + (chica ? ' c' : '') + (sel ? ' sel' : '')} onClick={e => e.stopPropagation()}>
    {pre && <span className='pfu'>{pre}</span>}
    <span className='pfw'><span className='pfm' aria-hidden='true'>{v || ph || ' '}</span><input size={1} value={v} placeholder={ph} aria-label={label} inputMode={text ? 'text' : 'decimal'} autoComplete='off' onFocus={e => e.target.select()} onChange={e => setV(e.target.value)} onBlur={fin} onKeyDown={alTeclear} /></span>
    {suf && <span className='pfu'>{suf}</span>}
  </label>
  return <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 10px', background: C.bgSoft, border: `1px solid ${C.border}`, borderRadius: 8, width: '100%', maxWidth: text ? 'none' : w, boxSizing: 'border-box' }}>
    {pre && <span style={{ fontSize: 12, color: C.muted }}>{pre}</span>}
    <input value={v} placeholder={ph} aria-label={label} inputMode={text ? 'text' : 'decimal'} onChange={e => setV(e.target.value)} onBlur={fin} onKeyDown={alTeclear} style={{ border: 0, background: 'transparent', fontFamily: 'inherit', fontSize: 14, fontWeight: text ? 600 : 700, color: C.text, textAlign: text ? 'left' : 'right', width: '100%', minWidth: 0, padding: 0, outline: 'none' }} />
    {suf && <span style={{ fontSize: 12, color: C.muted, flexShrink: 0 }}>{suf}</span>}
  </label>
}

/**
 * Campo de dinero que sigue al selector: en Pesos escribe pesos (`kind` money o mill, como el campo original); en UF escribe UF con dos decimales y guarda pesos = UF × `tasa`;
 * en Ambos escribe pesos y muestra debajo el equivalente en UF. `clp` = valor guardado (pesos); `tasa` = UF con que se convierte (27 = `tasa27()`, 26 = `tasa26()`, aproximada).
 */
export function FldDin({ clp, tasa, onCommit, kind = 'money', pre = '$', suf, ...rest }) {
  const m = CFG.moneda, ok = Number(tasa) > 0
  if (m === 'uf' && ok) { const u = Number(clp) / tasa; return <Fld {...rest} chica kind='uf' suf={'\u00A0' + UNIDAD} value={Math.abs(u) >= 1000 ? Math.round(u) : Math.round(u * 100) / 100} onCommit={(x) => onCommit(Math.round(x * tasa))} /> }
  const campo = <Fld {...rest} kind={kind} pre={pre} suf={suf} value={clp} onCommit={onCommit} />
  if (m !== 'ambos' || !ok) return campo
  return <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', minWidth: 0 }}>{campo}<span style={{ fontSize: 11, fontWeight: 500, color: C.muted, letterSpacing: 0, lineHeight: 1.3 }}>{ufTxt(Number(clp) / tasa, false)}</span></span>
}

// Estilos del campo sobrio (hover, foco y pantallas táctiles no se pueden escribir en línea). Una sola vez, al abrir el Presupuesto.
export function EstilosPresupuesto() {
  const A = C.accent, tenue = `color-mix(in srgb, ${A} 14%, transparent)`, medio = `color-mix(in srgb, ${A} 38%, transparent)`
  return <style>{`
.pp-foco:focus-visible,summary:focus-visible,button:focus-visible{outline:2px solid ${A};outline-offset:2px}
@media (max-width:1023px){.pp-pill{min-height:32px;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box}.pp-tac,.pfs{position:relative}.pp-tac::after{content:'';position:absolute;left:-4px;right:-4px;top:-8px;bottom:-8px}.pfs::after{content:'';position:absolute;left:-4px;right:-4px;top:-14px;bottom:-14px}}
.pfs{flex-shrink:0;display:inline-flex;align-items:baseline;gap:0;box-sizing:border-box;cursor:text;border:0 solid transparent;border-bottom-width:1px;padding:0 8px;margin:0 -8px -1px;color:inherit;font:inherit;letter-spacing:inherit;line-height:inherit;font-variant-numeric:tabular-nums}
.pp-dg>details[open]{grid-column:1 / -1}
@media (min-width:1024px){.pp-dg>details{padding:8px 10px!important}}
.pfs:hover,.pfs:focus-within{border-bottom-color:${medio}}
.pfs:focus-within,.pfs.sel{border-bottom-color:${A}}
.pfs .pfw{display:inline-grid;min-width:1.2ch}
.pfs .pfw>*{grid-area:1/1;font:inherit;letter-spacing:inherit;min-width:0}
.pfs .pfm{min-width:auto!important;visibility:hidden;white-space:pre;padding:0 1px 0 0;height:1.15em;line-height:1.15}
.pfs input{width:100%;border:0;outline:0;background:transparent;color:inherit;padding:0;text-align:left;height:1.15em;line-height:1.15;font-variant-numeric:tabular-nums}
.pfs input::placeholder{color:${C.done};font-weight:500}
.pfs .pfu{font:inherit;letter-spacing:inherit}
.pfs.g{font-size:19px;font-weight:800;letter-spacing:-.9px;line-height:1.15;color:${A}}
@media (min-width:1024px){.pfs.g.c{font-size:16px}}
@media (hover:none){.pfs{border:1px solid ${tenue};border-radius:8px;margin:-1px -9px;padding:0 8px}.pfs:focus-within,.pfs.sel{border-color:${A}}}
@media (max-width:700px){.pfs.g{font-size:14px;letter-spacing:-.4px;padding:0 5px;margin:-1px -6px}}   /* cifra editable de la tarjeta compacta (dos por fila): del tamaño de las demás cifras y sin tocar el borde */
`}</style>
}

// Botones − / + con el valor al medio (palancas de cada escenario).
export function Stp({ value, suf, step, min, max, onChange, int }) {
  const dar = d => onChange(Math.min(max, Math.max(min, Math.round((value + d) * 100) / 100)))
  const b = { border: 0, background: 'transparent', width: 28, height: 28, color: C.accent, fontSize: 16, fontWeight: 700, cursor: 'pointer', padding: 0, lineHeight: 1 }
  return <div style={{ display: 'inline-flex', alignItems: 'center', border: `1px solid ${C.border}`, borderRadius: 20, background: C.bgSoft, height: 30, maxWidth: '100%' }}>
    <button aria-label='Menos' className='pp-tac' onClick={e => { e.stopPropagation(); dar(-step) }} style={b}>−</button>
    <span style={{ minWidth: 46, textAlign: 'center', fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap' }}>{fmtIn(value, int ? 'int' : 'pct')}{suf}</span>
    <button aria-label='Más' className='pp-tac' onClick={e => { e.stopPropagation(); dar(step) }} style={b}>+</button>
  </div>
}

// Fila de lista: nombre con la flecha de navegación justo después, dato secundario debajo y la cifra siempre al extremo derecho.
export function Fila({ nombre, peq, valor, sub, onClick, abierta, sin, tot, children }) {
  const D = useIsDesktop()
  return <>
    <div {...tocable(onClick)} style={{ display: 'grid', gridTemplateColumns: D ? 'fit-content(62%) 18px minmax(0,1fr) auto auto' : 'fit-content(75%) 18px minmax(0,1fr) auto', gap: 10, alignItems: 'center', padding: D ? '6px 16px' : '9px 14px', cursor: onClick ? 'pointer' : 'default', fontSize: 13, borderTop: tot ? `2px solid ${C.accent}` : `1px solid ${C.border}`, background: abierta || tot ? C.bgSoft : 'transparent', fontWeight: tot ? 800 : 400 }}>
      <div style={{ minWidth: 0 }}><div style={{ fontWeight: tot ? 800 : 600 }}>{nombre}</div>{peq && <div style={{ fontSize: 11, color: C.muted, marginTop: 1, fontWeight: 400 }}>{peq}</div>}</div>
      <span style={{ color: C.done, fontSize: 16, lineHeight: 1, transform: abierta ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>{onClick && !sin ? '›' : ''}</span>
      <span />
      {D && <span style={{ textAlign: 'right', color: C.muted }}><Val v={sub} /></span>}
      <span style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', gridColumn: D ? undefined : 4 }}><Val v={valor} /></span>
    </div>
    {children}
  </>
}

export const Det = ({ t, children }) => <details style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '10px 14px', fontSize: 12, color: C.muted }}><summary style={{ cursor: 'pointer', fontWeight: 700, color: C.accent, fontSize: 12 }}>{t}</summary><div style={{ marginTop: 8, color: C.text }}>{children}</div></details>

export const Lista = ({ items }) => <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>{items.map((x, i) => <li key={i}>{x}</li>)}</ul>

// Cuadrícula de N columnas en escritorio y las de celular; sin desbordes.
export function Grid({ cols = 4, colsM = 2, gap = 10, children, style }) {
  const D = useIsDesktop()
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(${D ? cols : colsM},minmax(0,1fr))`, gap, alignItems: 'stretch', ...style }}>{children}</div>
}

// Flecha de comparación: ↑ si la cifra está sobre la referencia y ↓ si está bajo; verde = a favor, rojo = en contra.
export const Flecha = ({ sube, bueno, children }) => <span style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', color: bueno == null ? C.muted : bueno ? C.greenText : C.overdueText }}>{sube ? '↑' : '↓'} {children}</span>

// Tarjeta de un componente (A2): SIN detalle plegable, siempre del mismo alto; tocarla abre su página de detalle (la flecha › lo indica) y ahí viven las aclaraciones.
// Escritorio: carril de ícono a la izquierda y, a su derecha, rótulo, dos cifras con su rótulo y UNA línea de comparación con flechas. Celular (dos por fila): ícono 26 px y rótulo en una línea,
// REAL y META apiladas (rótulo a la izquierda, cifra a la derecha) y la comparación en una línea. Solo tipografía: sin pills ni barras. `izq`/`der` = { cap, val } (val puede ser un campo editable);
// `cmp` = <Flecha/> o texto. Teclado: Enter y Espacio abren, con foco visible (clase pp-foco, ver EstilosPresupuesto).
export function Tarjeta({ tono = 'w', ic, label, izq, der, cmp, cmp2, onClick, aria, solo }) {
  const t = TONO[tono], D = useIsDesktop(), ico = D ? 36 : 26, ambos = CFG.moneda === 'ambos'
  const tecla = onClick ? (/** @type {any} */ e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onClick(e) } } : undefined
  const flecha = onClick && <svg width={D ? 16 : 12} height={D ? 16 : 12} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true' style={{ flexShrink: 0, opacity: 0.7 }}><path d='M9 6l6 6-6 6' /></svg>
  const fig = (/** @type {any} */ f) => D
    ? <div style={{ minWidth: 0 }}><div style={{ ...LBL, fontSize: 11, fontWeight: 700, letterSpacing: '.7px', color: tono === 'w' ? C.muted : t.fg, opacity: 0.85, whiteSpace: 'nowrap', marginBottom: 2 }}>{f.cap}</div>
      <div style={{ fontSize: CFG.moneda === 'uf' ? 16 : 21, fontWeight: 800, letterSpacing: -0.9, lineHeight: 1.15, color: C.accent, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', minHeight: '1.15em' }}><Val v={f.val} /></div></div>
    : <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6, minWidth: 0, minHeight: ambos ? 32 : 18 }}><span style={{ ...LBL, fontSize: 11, fontWeight: 700, letterSpacing: '.4px', color: tono === 'w' ? C.muted : t.fg, opacity: 0.85, whiteSpace: 'nowrap' }}>{f.cap}</span>
      <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: -0.4, lineHeight: 1.15, color: C.accent, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', textAlign: 'right', minWidth: 0 }}><Val v={f.val} /></span></div>
  const cab = <div style={{ display: 'flex', alignItems: 'center', gap: D ? 8 : 6, minHeight: D ? 30 : 30, minWidth: 0 }}>
    {!D && <span style={{ width: ico, height: ico, flexShrink: 0, borderRadius: 8, background: tono === 'w' ? C.bgSoft : C.card, display: 'grid', placeItems: 'center' }}><Ic n={ic} s={15} /></span>}
    <span style={{ ...LBL, fontSize: D ? 13 : 12, fontWeight: 700, letterSpacing: D ? '.5px' : '.2px', flex: 1, minWidth: 0, lineHeight: 1.15, color: tono === 'w' ? C.muted : 'inherit', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{label}</span>{flecha}</div>
  const cmpEl = <div style={{ display: 'flex', gap: D ? '2px 14px' : '0 8px', flexWrap: D ? 'wrap' : 'nowrap', overflow: D ? undefined : 'hidden', whiteSpace: D ? undefined : 'nowrap', fontSize: D ? 12 : 11, color: C.muted, fontVariantNumeric: 'tabular-nums', minHeight: D ? 18 : 16, alignItems: 'center' }}>{cmp}</div>
  const cmpEl2 = cmp2 ? <div style={{ ...(D ? { gridColumn: 2 } : {}), fontSize: D ? 12 : 11, color: C.muted, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{cmp2}</div> : null
  const caja = { background: t.bg, color: t.fg, border: `1px solid ${t.bd}`, borderRadius: 12, minWidth: 0, cursor: onClick ? 'pointer' : 'default', boxSizing: /** @type {'border-box'} */ ('border-box'), alignContent: /** @type {'start'} */ ('start') }
  const ar = { role: onClick ? 'button' : undefined, tabIndex: onClick ? 0 : undefined, 'aria-label': aria, className: onClick ? 'pp-foco' : undefined, onClick, onKeyDown: tecla }
  if (solo && !D) return <div {...ar} style={{ ...caja, padding: '8px 9px', display: 'grid', gap: 2 }}>{cab}{fig(izq)}</div>
  if (!D) return <div {...ar} style={{ ...caja, padding: '8px 9px', display: 'grid', gap: 4, minHeight: ambos ? 136 : 112, gridTemplateRows: cmp2 ? 'auto auto auto auto auto' : 'auto auto auto auto' }}>{cab}{fig(izq)}{der ? fig(der) : <div style={{ minHeight: ambos ? 32 : 18 }} />}{cmpEl}{cmpEl2}</div>
  return <div {...ar} style={{ ...caja, padding: '8px 14px 6px', display: 'grid', gridTemplateColumns: `${ico}px minmax(0,1fr)`, columnGap: 12, rowGap: 4, alignItems: 'start' }}>
    <span style={{ gridRow: '1 / span 3', width: ico, height: ico, borderRadius: 10, background: tono === 'w' ? C.bgSoft : C.card, display: 'grid', placeItems: 'center' }}><Ic n={ic} s={18} /></span>
    {cab}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 16, alignItems: 'start', marginTop: -4 }}>{fig(izq)}{der && fig(der)}</div>
    {!solo && cmpEl}
    {cmpEl2}
  </div>
}

// ── Navegación del Presupuesto: menú desplegable, pasos numerados y pestañas subrayadas ──
/** Botón con menú de opciones (año, moneda): se cierra al elegir o al tocar fuera. `boton` = contenido del botón; `opciones` = [[valor, rótulo]]. */
export function Menu({ boton, opciones, valor, onChange, derecha, aria, estilo, pie }) {
  const [abre, setAbre] = useState(false), ref = useRef(null)
  useEffect(() => {
    if (!abre) return
    const fuera = (/** @type {any} */ e) => { if (ref.current && !ref.current.contains(e.target)) setAbre(false) }
    document.addEventListener('mousedown', fuera); document.addEventListener('touchstart', fuera)
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('touchstart', fuera) }
  }, [abre])
  return <span ref={ref} onKeyDown={(e) => { if (e.key === 'Escape') setAbre(false) }} style={{ position: 'relative', display: 'inline-flex', minWidth: 0 }}>
    <button aria-label={aria} aria-haspopup='menu' className='pp-tac' aria-expanded={abre} onClick={() => setAbre((a) => !a)} style={{ border: 0, background: 'transparent', fontFamily: 'inherit', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 2px', color: 'inherit', fontSize: 'inherit', fontWeight: 'inherit', ...estilo }}>{boton}<span aria-hidden='true' style={{ width: 0, height: 0, borderLeft: '4px solid transparent', borderRight: '4px solid transparent', borderTop: '5px solid currentColor', display: 'inline-block' }} /></button>
    {abre && <div role='menu' style={{ position: 'absolute', top: '100%', [derecha ? 'right' : 'left']: 0, zIndex: 30, marginTop: 6, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 6, minWidth: 170, boxShadow: '0 8px 24px rgba(0,60,80,.14)' }}>
      {opciones.map(([k, n]) => <button key={String(k)} role='menuitem' onClick={() => { setAbre(false); onChange(k) }} style={{ display: 'block', width: '100%', textAlign: 'left', border: 0, fontFamily: 'inherit', cursor: 'pointer', padding: '9px 10px', borderRadius: 8, whiteSpace: 'nowrap', fontSize: 13, background: valor === k ? C.azulBg : 'transparent', color: valor === k ? C.accent : C.muted, fontWeight: valor === k ? 800 : 600 }}>{n}</button>)}
      {pie && <button key='pie' role='menuitem' onClick={() => { setAbre(false); pie[0]() }} style={{ display: 'block', width: '100%', textAlign: 'left', border: 0, borderTop: `1px solid ${C.border}`, fontFamily: 'inherit', cursor: 'pointer', padding: '9px 10px', marginTop: 4, borderRadius: 8, whiteSpace: 'nowrap', fontSize: 13, background: 'transparent', color: C.accent, fontWeight: 800 }}>{pie[1]}</button>}
    </div>}
  </span>
}

/** Botón-chip de la barra de contexto (Versiones, Excel). */
export const ChipBtn = ({ children, onClick, aria, error, cuadrado, titulo }) => <button aria-label={aria} title={titulo} className='pp-tac pp-pill' onClick={onClick} style={{ border: `1px solid ${error ? C.overdueBd : C.border}`, background: error ? C.overdueBg : C.card, color: error ? C.overdueText : C.accent, fontFamily: 'inherit', fontWeight: 700, fontSize: 12, height: 28, minWidth: cuadrado ? 28 : undefined, padding: cuadrado ? 0 : '0 10px', borderRadius: 20, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, whiteSpace: 'nowrap' }}>{children}</button>

/**
 * Pasos del presupuesto en una sola fila de círculos (check en los revisados), con la línea de tiempo encima: el año base sobre el paso 1 y el año del presupuesto sobre los pasos 2 a 6.
 * En escritorio cada círculo lleva su nombre; en el celular solo los círculos y, debajo, «Paso n de 6» con el nombre del paso activo.
 */
export function Pasos({ nombres, activa, hechos, onIr, anioBase, anio, desc, acciones, debajo }) {
  const D = useIsDesktop(), n = nombres.length
  const cap = { fontSize: D ? 11 : 11, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: C.accent, paddingBottom: 5, borderBottom: `1px solid ${C.done}`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
  // Móvil (alternativa D): círculos numerados unidos por una línea que se vuelve verde en los pasos revisados; el título lleva ✓ y nota, sin «Paso n de 6». Zona táctil de 44 px por paso.
  if (!D) return <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    <div role='group' aria-label='Pasos del presupuesto' style={{ display: 'flex', alignItems: 'center' }}>
      {nombres.map((nom, i) => { const on = activa === i, ok = !on && hechos.includes(i)
        return <span key={nom} style={{ display: 'contents' }}>
          {i > 0 && <span aria-hidden='true' style={{ flex: 1, height: 2, background: hechos.includes(i - 1) ? C.normal : C.border }} />}
          <button className='pp-tac' title={nom} aria-current={on ? 'step' : undefined} aria-label={`Paso ${i + 1}: ${nom}${ok ? ', revisado' : ''}`} onClick={() => onIr(i)} style={{ border: 0, background: 'none', padding: 0, width: 44, height: 44, display: 'grid', placeItems: 'center', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, margin: '0 -6px' }}>
            <span style={{ width: 32, height: 32, borderRadius: '50%', border: `1.5px solid ${on ? C.accent : ok ? C.normal : C.done}`, background: on ? C.accent : ok ? C.greenBg : C.card, color: on ? '#fff' : ok ? C.greenText : C.muted, display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700 }}>{ok ? '✓' : i + 1}</span>
          </button></span> })}
    </div>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <div style={{ fontSize: 19, fontWeight: 800, color: C.accent, letterSpacing: -0.3, lineHeight: 1.2, minWidth: 0 }}>{nombres[activa]}</div>
      {acciones && <div style={{ flexShrink: 0 }}>{acciones}</div>}
    </div>
    {debajo}
  </div>
  // Escritorio: una sola franja (la línea de tiempo «Año base | Presupuesto» sobre los pasos, y la nota a la derecha); el paso activo ya se lee en la franja, sin segunda fila de título.
  const cols = `repeat(${n},minmax(0,1fr)) auto`
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    <div style={{ display: 'grid', gridTemplateColumns: cols }}><span style={{ ...cap, paddingBottom: 3 }}>Año base {anioBase}</span><span style={{ ...cap, paddingBottom: 3, gridColumn: `2 / span ${n - 1}`, marginLeft: 8 }}>Presupuesto {anio}</span><span /></div>
    <div role='group' aria-label='Pasos del presupuesto' style={{ display: 'grid', gridTemplateColumns: cols, alignItems: 'center' }}>
      {nombres.map((nom, i) => { const on = activa === i, ok = !on && hechos.includes(i)
        return <button key={nom} className='pp-tac' title={nom} aria-current={on ? 'step' : undefined} aria-label={`Paso ${i + 1}: ${nom}${ok ? ', visitado' : ''}`} onClick={() => onIr(i)} style={{ border: 0, background: 'none', fontFamily: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0', textAlign: 'left', minWidth: 0, width: '100%', boxSizing: 'border-box', color: on ? C.accent : C.muted, fontWeight: on ? 800 : 600, fontSize: 13 }}>
          <span style={{ width: 26, height: 26, borderRadius: '50%', border: `1.5px solid ${on ? C.accent : ok ? C.normal : C.done}`, background: on ? C.accent : ok ? C.greenBg : C.card, color: on ? '#fff' : ok ? C.greenText : C.muted, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{ok ? '✓' : i + 1}</span>
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{nom}</span>
        </button> })}
      <div style={{ paddingLeft: 10 }}>{acciones}</div>
    </div>
    {debajo}
  </div>
}

/** Pestañas subrayadas (sub-vistas de un paso). */
export const Pestanas = ({ options, value, onChange }) => <div role='tablist' style={{ display: 'flex', gap: 22, borderBottom: `1px solid ${C.border}` }}>
  {options.map(([k, n]) => { const on = value === k; return <button key={k} className='pp-tac' role='tab' aria-selected={on} onClick={() => onChange(k)} style={{ border: 0, background: 'none', fontFamily: 'inherit', cursor: 'pointer', padding: '6px 2px', fontSize: 13, fontWeight: on ? 800 : 600, color: on ? C.accent : C.muted, borderBottom: `2px solid ${on ? C.accent : 'transparent'}`, marginBottom: -1 }}>{n}</button> })}
</div>

/** Sección plegada: una línea con el título, la cifra clave a la derecha y un chevrón; se abre y se cierra sin desmontar lo de adentro (lo escrito se conserva). */
export function Pliegue({ t, v, children, abierto, abajo }) {
  const D = useIsDesktop()
  return <details open={abierto} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, minWidth: 0 }}>
    <summary className='pp-tac' style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', alignItems: 'center', flexWrap: abajo ? 'wrap' : 'nowrap', gap: abajo ? '1px 10px' : 10, padding: abajo ? '7px 14px' : D ? '6px 16px' : '6px 14px', minHeight: abajo ? undefined : 34, boxSizing: 'border-box', lineHeight: 1.25, fontSize: D ? 13 : 12 }}>
      <b style={{ color: C.accent, fontSize: 13 }}>{t}</b><span style={abajo ? { order: 3, flexBasis: '100%', textAlign: 'left', color: C.muted, fontVariantNumeric: 'tabular-nums', minWidth: 0 } : { flex: 1, textAlign: 'right', color: C.muted, fontVariantNumeric: 'tabular-nums', minWidth: 0 }}>{v}</span><span aria-hidden='true' style={{ color: C.done, fontSize: 16, lineHeight: 1, marginLeft: abajo ? 'auto' : 0 }}>›</span>
    </summary>
    <div style={{ padding: '0 0 4px', display: 'flex', flexDirection: 'column', gap: 10, borderTop: `1px solid ${C.border}` }}>{children}</div>
  </details>
}

/** Resumen del paso 5 (H06): una sola tarjeta de tres cifras que siguen la cascada del escenario elegido: Margen → Resultado → Retiros. Margen siempre en $. Cada celda abre su detalle. */
export function ResumenCascada({ margen, resultado, retiros, esc, onMargen, onResultado, onRetiros }) {
  const D = useIsDesktop()
  const celda = (/** @type {string} */ rot, /** @type {any} */ v, /** @type {string} */ sub, /** @type {any} */ go, /** @type {boolean} */ ult) => <div {...tocable(go)} style={{ padding: D ? '8px 16px' : '9px 10px', minWidth: 0, borderLeft: rot === 'Margen' ? 'none' : `1px solid ${C.border}`, cursor: 'pointer' }}>
    <div style={{ ...LBL, color: C.accent, whiteSpace: 'nowrap' }}>{rot}</div>
    <div style={{ fontSize: D ? 21 : 16, fontWeight: 800, letterSpacing: D ? -0.6 : -0.4, color: ult ? C.greenText : C.accent, fontVariantNumeric: 'tabular-nums', lineHeight: 1.15, whiteSpace: 'nowrap' }}><Val v={v} /></div>
    {D && <div style={{ fontSize: 11, color: C.muted }}>{sub}</div>}
  </div>
  return <div>
    <div style={{ position: 'relative', background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', overflow: 'hidden' }}>{celda('Margen', margen, 'antes de impuesto', onMargen, false)}{celda('Resultado', resultado, 'después de impuesto', onResultado, false)}{celda('Retiros', retiros, 'después del aumento de reserva', onRetiros, true)}{D && <span style={{ position: 'absolute', top: 8, right: 16, fontSize: 11, color: C.muted }}>Escenario {esc} · elegido</span>}</div>
    {!D && <div style={{ fontSize: 12, color: C.muted, margin: '4px 4px 0' }}>Escenario {esc} · elegido</div>}
  </div>
}

/** Estado vacío de un paso: título, la causa, los pasos siguientes numerados y los botones (el primero es el principal). */
export function VacioPaso({ titulo, causa, pasos = [], acciones = [] }) {
  return <div style={{ background: C.card, border: `1px dashed ${C.done}`, borderRadius: 12, padding: '18px 18px', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
    <div style={{ fontWeight: 800, color: C.accent, fontSize: 14 }}>{titulo}</div>
    <div style={{ color: C.muted, fontSize: 14 }}>{causa}</div>
    {pasos.length > 0 && <div style={{ width: '100%', display: 'flex', flexDirection: 'column' }}>{pasos.map(([n, t, s], i) => <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: i ? `1px solid ${C.border}` : 'none' }}><span style={{ width: 26, height: 26, borderRadius: '50%', border: `1.5px solid ${C.done}`, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, color: C.muted, flexShrink: 0 }}>{n}</span><div style={{ fontSize: 14 }}><b style={{ color: C.accent }}>{t}</b><div style={{ color: C.muted, fontSize: 12 }}>{s}</div></div></div>)}</div>}
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{acciones.map(([t, go, primary]) => <Btn key={t} primary={primary} onClick={go}>{t}</Btn>)}</div>
  </div>
}
