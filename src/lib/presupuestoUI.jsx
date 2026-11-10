// Piezas de interfaz del Presupuesto anual. Formatos de la app (fmtMill, dd-mm-aaaa, es-CL) y paleta C; nada de colores sueltos.
import { useState, useEffect, useRef } from 'react'
import { C, useIsDesktop } from './base.jsx'
import { fmtMill } from './compartido.jsx'

export const nf = new Intl.NumberFormat('es-CL')
export const mm = fmtMill
export const pes = n => (n < 0 ? '−' : '') + '$' + nf.format(Math.abs(Math.round(n)))
export const ufs = n => (n < 0 ? '−' : '') + nf.format(Math.abs(Math.round(n))) + ' UF'
export const pc = (n, d = 1) => (n == null || !isFinite(n) ? '—' : n.toLocaleString('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' %')
export const sgn = v => (v >= 0 ? '+' : '−')
export const MESL = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
export const MESC = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

// Número editable con coma decimal y punto de miles: «1.000.000», «4,5».
// `mill` = pesos mostrados en millones con un decimal («101,0»); al escribir, un número de 100.000 o más se entiende como pesos y uno menor como millones.
export const fmtIn = (v, k) => (v == null || v === '' ? '' : k === 'mill' ? (v / 1e6).toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : k === 'money' ? nf.format(Math.round(v)) : k === 'int' ? String(Math.round(v)) : Number(v).toLocaleString('es-CL', { maximumFractionDigits: 3 }))
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
    <div style={{ minWidth: 0, flex: 1 }}><div style={{ ...LBL, color: C.accent, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.25 }}>{label}</div><div style={{ fontSize: D ? 22 : 20, fontWeight: 800, letterSpacing: -0.6, lineHeight: 1.1, color: C.accent, fontVariantNumeric: 'tabular-nums' }}>{value}</div>{sub && <div style={{ fontSize: 11, marginTop: 2, color: C.muted }}>{sub}</div>}</div>
  </div>
}

// Tarjeta chica con ícono (indicadores, resumen). El rótulo va en mayúscula; la cifra a 20 px.
export function Mini({ ic, label, value, sub, cls, onClick }) {
  const col = cls === 'pos' ? C.greenText : cls === 'neg' ? C.overdueText : cls === 'amb' ? C.soonText : C.accent
  return <div onClick={onClick} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, cursor: onClick ? 'pointer' : 'default', boxSizing: 'border-box' }}>
    <span style={{ width: 34, height: 34, borderRadius: 10, background: C.azulBg, color: C.azulInfo, display: 'grid', placeItems: 'center', flexShrink: 0 }}><Ic n={ic} s={18} /></span>
    <div style={{ minWidth: 0 }}><div style={{ ...LBL, color: C.accent, lineHeight: 1.2 }}>{label}</div><div style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.4, color: col, marginTop: 1, fontVariantNumeric: 'tabular-nums' }}>{value}</div>{sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>{sub}</div>}</div>
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
      {D && <span style={{ textAlign: 'right', color: C.muted }}>{sub}</span>}
      <span style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', gridColumn: D ? undefined : 4 }}>{valor}</span>
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
    <div style={{ fontSize: D ? 26 : 22, fontWeight: 800, letterSpacing: -0.9, lineHeight: 1.15, color: C.accent, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', minHeight: '1.15em' }}>{f.val}</div></div>
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
