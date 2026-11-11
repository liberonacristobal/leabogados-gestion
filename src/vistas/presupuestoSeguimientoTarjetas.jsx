// Presupuesto · paso 6: las seis tarjetas del Seguimiento (Presup., Real y el mismo período del año anterior, avance y diferencia) y la apertura de Facturado y Cobrado.
import { C } from '../lib/base.jsx'
import { valorComponente } from '../../supabase/functions/_shared/presupuesto.js'
import { faltaFacturar } from '../../supabase/functions/_shared/metaPresupuesto.js'
import { fotoSeguimiento } from '../../supabase/functions/_shared/seguimientoPresupuesto.js'
import { TONO, Ic, Panel, Val, LBL, Flecha } from '../lib/presupuestoUI.jsx'

/** Tarjeta de un componente: tres cifras (Presup., Real, año anterior), «Avance X %» y «± $ contra el año anterior». `abre` = muestra la flecha hacia abajo (la apertura se despliega bajo las tarjetas). */
export function TarjetaSeg({ tono, ic, label, filas, avance, vs, abre, abierta, onClick, aria, D }) {
  const t = TONO[tono] || TONO.w
  return <div role='button' tabIndex={0} aria-label={aria} aria-expanded={abre ? !!abierta : undefined} onClick={onClick} onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onClick() } }} className='pp-foco'
    style={{ background: t.bg, color: t.fg, border: abierta ? `2px solid ${C.accent}` : `1px solid ${t.bd}`, borderRadius: 12, padding: D ? (abierta ? '9px 13px 8px' : '10px 14px 9px') : (abierta ? '7px 8px' : '8px 9px'), cursor: 'pointer', minWidth: 0, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: D ? 5 : 3 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: D ? 10 : 6, minWidth: 0 }}>
      <span style={{ width: D ? 36 : 26, height: D ? 36 : 26, flexShrink: 0, borderRadius: 10, background: tono === 'w' ? C.bgSoft : C.card, display: 'grid', placeItems: 'center' }}><Ic n={ic} s={D ? 18 : 15} /></span>
      <span style={{ ...LBL, fontSize: D ? 13 : 12, flex: 1, minWidth: 0, color: tono === 'w' ? C.muted : 'inherit' }}>{label}</span>
      <svg width={D ? 16 : 12} height={D ? 16 : 12} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true' style={{ flexShrink: 0, opacity: 0.7, transform: abre ? (abierta ? 'rotate(-90deg)' : 'rotate(90deg)') : 'none' }}><path d='M9 6l6 6-6 6' /></svg>
    </div>
    {filas.map(([cap, val, fuerte], i) => <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6, minWidth: 0 }}><span style={{ ...LBL, fontSize: D ? 11 : 10.5, opacity: 0.85, whiteSpace: 'nowrap' }}>{cap}</span><span style={{ fontSize: fuerte ? (D ? 20 : 14) : (D ? 15 : 12), fontWeight: fuerte ? 800 : 600, letterSpacing: -0.4, color: fuerte ? C.accent : C.muted, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', minWidth: 0, textAlign: 'right' }}><Val v={val} /></span></div>)}
    <div style={{ fontSize: D ? 12 : 11, color: C.muted, minHeight: '1.2em', whiteSpace: 'nowrap' }}>{avance}</div>
    <div style={{ fontSize: D ? 12 : 11, minHeight: '1.2em', whiteSpace: 'nowrap' }}>{vs}</div>
  </div>
}

/** Apertura bajo las tarjetas: dos filas (origen A y B) y el total, con presupuesto, real y avance de los meses cerrados. @param {{ titulo:string, nota?:string, cols:string[], filas:[string,string,any[],boolean?][], D:boolean, pie?:any }} p */
export function AperturaSeg({ titulo, cols, filas, D, nota, pie }) {
  const g = D ? 'minmax(0,1.6fr) repeat(3,minmax(0,1fr))' : 'minmax(0,1.3fr) repeat(3,minmax(0,1fr))'
  return <Panel hd={titulo} small={nota}>
    <div style={{ display: 'grid', gridTemplateColumns: g, gap: D ? 10 : 6, padding: D ? '10px 16px 6px' : '9px 12px 5px', ...LBL, color: C.accent, fontSize: D ? 11 : 10 }}><span />{cols.map((c) => <span key={c} style={{ textAlign: 'right' }}>{c}</span>)}</div>
    {filas.map(([t, sub, vals, tot], i) => <div key={i} style={{ display: 'grid', gridTemplateColumns: g, gap: D ? 10 : 6, padding: D ? '9px 16px' : '8px 12px', borderTop: tot ? `2px solid ${C.accent}` : `1px solid ${C.border}`, background: tot ? C.bgSoft : 'transparent', alignItems: 'center', fontSize: D ? 13 : 12 }}>
      <span style={{ minWidth: 0, fontWeight: tot ? 800 : 600 }}>{t}{sub && <span style={{ display: 'block', fontSize: 11, fontWeight: 400, color: C.muted }}>{sub}</span>}</span>
      {vals.map((v, j) => <span key={j} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, whiteSpace: 'nowrap' }}>{v}</span>)}</div>)}
    {pie && <div style={{ padding: '8px 16px 10px', fontSize: 12, color: C.muted, borderTop: `1px solid ${C.border}` }}>{pie}</div>}
  </Panel>
}
export { Flecha }

/** Lo que el Seguimiento necesita del estado de hoy (borrador): el Ideal, las metas de vendido y cobranza, el arrastre por mes y lo nuevo por facturar. Es lo mismo que se guarda con cada versión. */
export function fotoVivaSeguimiento(X) {
  const { M, MT, arrastre: A, est } = X, e = M.esc[est.esc], F = faltaFacturar({ factMeta: MT.ch.fact, arrastre: A.total })
  return fotoSeguimiento({ ideal: e, ventas: valorComponente(MT.ch, 'ventas', MT.ratio, MT.cv), cobranza: MT.ch.caja + MT.rec, arrastreMes: A.porMes, nuevoFacturar: F.falta })
}
