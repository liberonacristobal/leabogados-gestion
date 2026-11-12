// Vista única de la cartera por cobrar: vencido, por vencer y total, de cada cliente, y cuánto es propio y cuánto de terceros.
// Presentación solamente: las cifras salen de resumenPropio (_shared/cobranzaPropio.js). Nada de aquí lleva a la ficha del cliente.
import { C, SEC_LBL, SIcon, fmtFechaDMY, folioN, useIsDesktop } from '../lib/base.jsx'
import { FlujoPagina, NOMBRE_CLI, TH_BAND } from '../lib/compartido.jsx'

const f0 = (/** @type {number} */ n) => '$' + Math.round(n || 0).toLocaleString('es-CL')
const fM = (/** @type {number} */ n) => '$' + ((n || 0) / 1e6).toFixed(1).replace('.', ',') + 'M'
const sum = (/** @type {any[]} */ a, /** @type {(x:any)=>number} */ f) => a.reduce((s, x) => s + f(x), 0)

/** @typedef {{ ref: any, saldo: number, ext: number, com: number, propio: number, mora: number, partes: { nombre: string, monto: number }[] }} Fac */

/** ¿La factura pasa el filtro? e: 'todas' | 'v' | 'p'; t: null | '*' (con terceros) | nombre del tercero. @param {Fac} f @param {{ e: string, t: string | null }} fl */
export const pasaFiltro = (f, fl) => (fl.e === 'todas' || (fl.e === 'v' ? f.mora > 0 : f.mora <= 0)) && (!fl.t || (fl.t === '*' ? f.ext + f.com > 0 : f.partes.some(p => p.nombre === fl.t)))

export function CobranzaPropioVista({ resumen, filtro, setFiltro, abiertos, setAbiertos, q, setQ, cn, onOpenFactura, onBack }) {
  const D = useIsDesktop()
  const fl = filtro || { e: 'todas', t: null }
  const activo = fl.e !== 'todas' || !!fl.t
  const T = resumen.todo, V = resumen.venc
  const cols3 = [['v', 'Vencido', V.total, V.propio, V.ext + V.com], ['p', 'Por vencer', T.total - V.total, T.propio - V.propio, T.ext + T.com - V.ext - V.com], ['todas', 'Total', T.total, T.propio, T.ext + T.com]]
  const colOn = (/** @type {string} */ k) => fl.e === k
  // Clientes con sus facturas filtradas, de mayor a menor vencido.
  const clientes = [...resumen.porCliente.values()].map((/** @type {any} */ c) => {
    /** @type {Fac[]} */
    const fs = c.facturas.filter((/** @type {Fac} */ f) => pasaFiltro(f, fl))
    const v = fs.filter(f => f.mora > 0), p = fs.filter(f => f.mora <= 0)
    const nombres = [...new Set(fs.flatMap(f => f.partes.map(x => x.nombre)))]
    return { cid: c.cid, fs, v, p, tot: sum(fs, f => f.saldo), venc: sum(v, f => f.saldo), pv: sum(p, f => f.saldo), prop: sum(fs, f => f.propio), terc: sum(fs, f => f.ext + f.com), nombres }
  }).filter(c => c.fs.length).sort((a, b) => b.venc - a.venc || b.tot - a.tot)
  const qq = String(q || '').trim().toLowerCase()
  const lista = qq ? clientes.filter(c => cn(c.cid).toLowerCase().includes(qq)) : clientes
  const terc = [...resumen.terceros.entries()].sort((a, b) => b[1].monto - a[1].monto)
  const abre = (/** @type {string} */ id) => setAbiertos((/** @type {string[]} */ a) => (a.includes(id) ? a.filter(x => x !== id) : [...a, id]))
  const btnFiltro = (/** @type {string} */ k) => setFiltro({ ...fl, e: fl.e === k && k !== 'todas' ? 'todas' : k })
  const cols = 'minmax(200px,1.5fr) 104px 104px 104px 120px 104px'   // Cliente · Vencido · Por vencer · Total · Terceros · Propio (la última cifra es lo que queda en la oficina)
  const colsF = cols
  const mora = (/** @type {Fac} */ f) => (f.mora > 0 ? `vencida hace ${f.mora} día${f.mora !== 1 ? 's' : ''}` : `vence en ${-f.mora} día${f.mora !== -1 ? 's' : ''}`)
  const fila = (/** @type {string} */ sg, /** @type {string} */ t, /** @type {any} */ sub, /** @type {number} */ val, /** @type {boolean} */ tot) => (
    <div key={t + sg} style={{ display: 'grid', gridTemplateColumns: '22px minmax(0,1fr) auto', gap: 8, alignItems: 'baseline', padding: tot ? '10px 0 0' : '8px 0', borderTop: tot ? `2px solid ${C.border}` : `1px solid ${C.bgSoft}`, marginTop: tot ? 2 : 0 }}>
      <span style={{ textAlign: 'center', color: C.muted, fontWeight: 700 }}>{sg}</span>
      <span style={{ minWidth: 0, fontWeight: tot ? 700 : 600, fontSize: 13, color: tot ? C.accent : C.text }}>{t}{sub && <span style={{ display: 'block', fontWeight: 400, fontSize: 12, color: C.muted }}>{sub}</span>}</span>
      <span style={{ fontWeight: 700, fontSize: 13, color: tot ? C.accent : C.text, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{f0(val)}</span>
    </div>)
  const detalle = (/** @type {any} */ c) => {
    /** @type {Map<string, number>} */
    const porTerc = new Map()
    c.fs.forEach((/** @type {Fac} */ f) => f.partes.forEach(p => porTerc.set(p.nombre, (porTerc.get(p.nombre) || 0) + p.monto)))
    const grupo = (/** @type {string} */ t, /** @type {Fac[]} */ l, /** @type {string} */ col) => l.length ? (
      <div key={t}>
        <div style={{ ...SEC_LBL, padding: '10px 0 4px' }}>{t} · {l.length} · <b style={{ color: col }}>{f0(sum(l, f => f.saldo))}</b></div>
        {[...l].sort((a, b) => String(a.ref?.issued_at || '').localeCompare(String(b.ref?.issued_at || ''))).map((f, i) => {
          const b = f.ref || {}, ajeno = f.ext + f.com, nom = f.partes.map(x => x.nombre).join(' · ')
          const quien = <><span style={{ fontWeight: 700, color: C.accent }}>Factura N° {folioN(b.invoice_no)}</span><span style={{ display: 'block', fontSize: 12, color: C.muted }}>{b.issued_at ? fmtFechaDMY(b.issued_at) + ' · ' : ''}{mora(f)}{ajeno > 0 && nom ? ' · ' + nom : ''}</span></>
          return (
            <div key={String(b.id || i)} onClick={() => onOpenFactura && b.id && onOpenFactura(b)} role='button' tabIndex={0} onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && onOpenFactura && b.id) onOpenFactura(b) }} style={{ display: 'grid', gridTemplateColumns: D ? colsF : 'minmax(0,1fr) auto', gap: D ? 12 : '3px 10px', alignItems: 'center', padding: '8px 0', borderTop: `1px solid ${C.bgSoft}`, cursor: onOpenFactura ? 'pointer' : 'default', fontSize: 13 }}>
              <span style={{ minWidth: 0 }}>{quien}</span>
              {D ? <><span /><span /><span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{f0(f.saldo)}</span><span style={{ textAlign: 'right', color: C.muted, fontVariantNumeric: 'tabular-nums' }}>{ajeno > 0 ? '−' + f0(ajeno) : '—'}</span><span style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{f0(f.propio)}</span></>
                : <><span style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{f0(f.propio)}</span><span style={{ fontSize: 12, color: C.muted, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nom ? `Terceros ${nom}` : 'Sin terceros'}</span><span style={{ textAlign: 'right', fontSize: 12, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>{ajeno > 0 ? `de ${f0(f.saldo)}` : f0(f.saldo)}</span></>}
            </div>)
        })}
      </div>) : null
    return (
      <div style={{ background: C.bg, borderTop: `1px solid ${C.bgSoft}`, padding: D ? '4px 16px 12px 34px' : '4px 12px 10px' }}>
        <div style={{ maxWidth: 520, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '4px 12px', margin: '8px 0 4px' }}>
          {fila('', 'Total', `${c.fs.length} factura${c.fs.length !== 1 ? 's' : ''} · ${c.v.length} vencida${c.v.length !== 1 ? 's' : ''}, ${c.p.length} por vencer`, c.tot, false)}
          {fila('−', 'Terceros', null, c.terc, false)}
          {[...porTerc].sort((a, b) => b[1] - a[1]).map(([n, m]) => <div key={n} style={{ display: 'grid', gridTemplateColumns: '22px minmax(0,1fr) auto', gap: 8, fontSize: 12, color: C.muted, padding: '0 0 6px' }}><span /><span>{n}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{f0(m)}</span></div>)}
          {fila('=', 'Propio', null, c.prop, true)}
        </div>
        {grupo('Vencidas', c.v, C.overdueText)}
        {grupo('Por vencer', c.p, C.accent)}
      </div>)
  }
  return (
    <FlujoPagina origen='Cobranza' titulo='Por cobrar' onBack={onBack} maxW={1100}>
      <div style={{ display: 'grid', gridTemplateColumns: D ? 'repeat(3,minmax(0,1fr))' : '1fr', gap: D ? 12 : 8, marginBottom: 10 }}>
        {(D ? cols3 : [cols3[0], cols3[2]]).map(c => {
          const k = String(c[0]), on = colOn(k), tot = Number(c[2]), pro = Number(c[3]), ter = Number(c[4])
          const est = k === 'v' ? { bg: C.overdueBg, bd: C.overdueBd, col: C.overdueText, ic: 'alert' } : k === 'p' ? { bg: C.tealBg, bd: C.azulBd, col: C.tealText, ic: 'clock' } : { bg: C.azulBg, bd: C.azulBd, col: C.azulInfo, ic: 'file' }
          const stat = (/** @type {string} */ t, /** @type {number} */ v) => <div key={t}><div style={{ fontSize: 10, fontWeight: 700, letterSpacing: .5, textTransform: 'uppercase', color: C.muted }}>{t}</div><div style={{ fontSize: D ? 15 : 14, fontWeight: 700, color: C.accent, marginTop: 2, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fM(v)}</div></div>
          return (
            <div key={k} onClick={() => btnFiltro(k)} role='button' tabIndex={0} aria-pressed={on} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') btnFiltro(k) }} style={{ background: est.bg, border: `1px solid ${est.bd}`, outline: on ? `2px solid ${C.accent}` : 'none', outlineOffset: 1, borderRadius: 14, padding: D ? '14px' : '12px', cursor: 'pointer', minWidth: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: D ? '10px 12px' : 10 }}>
              <span style={{ width: D ? 44 : 40, height: D ? 44 : 40, borderRadius: D ? 12 : 10, background: C.surface, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><SIcon n={est.ic} s={D ? 24 : 22} c={est.col} /></span>
              <div style={{ minWidth: 0, flex: '1 1 100px' }}>
                <div style={{ fontSize: D ? 13 : 12, fontWeight: 700, letterSpacing: .5, textTransform: 'uppercase', color: C.accent, whiteSpace: 'nowrap' }}>{String(c[1])}</div>
                <div style={{ fontSize: D ? 26 : 22, fontWeight: 800, letterSpacing: '-.6px', lineHeight: 1.05, marginTop: 2, color: k === 'v' ? C.overdueText : C.accent, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fM(tot)}</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: D ? 12 : 10, borderLeft: '1px solid rgba(0,0,0,.08)', paddingLeft: D ? 12 : 10, flexShrink: 0, marginLeft: 'auto' }}>{stat('Propio', pro)}{stat('Terceros', ter)}</div>
            </div>)
        })}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <select aria-label='Terceros' value={fl.t || ''} onChange={e => setFiltro({ ...fl, t: e.target.value || null })} style={{ font: 'inherit', fontSize: 12.5, fontWeight: 700, color: C.accent, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '0 10px', height: 34, maxWidth: '100%' }}>
          <option value=''>Terceros: todos</option>
          <option value='*'>Solo con terceros</option>
          {terc.map(([n, x]) => <option key={n} value={n}>{n} · {fM(x.monto)}</option>)}
        </select>
        <input value={q || ''} onChange={e => setQ(e.target.value)} placeholder='Buscar cliente…' aria-label='Buscar cliente' style={{ font: 'inherit', fontSize: 12.5, flex: '1 1 140px', minWidth: 0, maxWidth: 260, height: 34, border: `1px solid ${C.border}`, borderRadius: 10, padding: '0 10px', background: C.surface, color: C.text, boxSizing: 'border-box' }} />
        {activo && <button onClick={() => setFiltro({ e: 'todas', t: null })} style={{ font: 'inherit', fontSize: 12.5, fontWeight: 700, color: C.accent, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3, minHeight: 34 }}>Quitar filtro ✕</button>}
      </div>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden' }}>
        {D && <div style={{ ...TH_BAND, display: 'grid', gridTemplateColumns: cols, gap: 12, padding: '10px 16px' }}><span>Cliente</span><span style={{ textAlign: 'right' }}>Vencido</span><span style={{ textAlign: 'right' }}>Por vencer</span><span style={{ textAlign: 'right' }}>Total</span><span style={{ textAlign: 'right' }}>Terceros</span><span style={{ textAlign: 'right' }}>Propio</span></div>}
        {lista.map((c, i) => {
          const op = abiertos.includes(c.cid)
          return (
            <div key={c.cid} style={{ borderTop: i || D ? `1px solid ${C.bgSoft}` : 'none' }}>
              <div onClick={() => abre(c.cid)} role='button' tabIndex={0} aria-expanded={op} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') abre(c.cid) }} style={{ display: 'grid', gridTemplateColumns: D ? cols : 'minmax(0,1fr) auto', gap: D ? 12 : '3px 10px', alignItems: 'center', padding: D ? '11px 16px' : '12px 14px', cursor: 'pointer', fontSize: 13 }}>
                <span style={{ ...NOMBRE_CLI, minWidth: 0 }}><span style={{ display: 'inline-block', marginRight: 6, color: C.muted, transform: op ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }}>›</span>{cn(c.cid)}{D && c.nombres.length > 0 && <span style={{ display: 'block', fontSize: 11.5, fontWeight: 400, color: C.muted, paddingLeft: 14 }}>{c.nombres.join(' · ')}</span>}</span>
                {D ? <>
                  <span style={{ textAlign: 'right', color: c.venc ? C.overdueText : C.muted, fontVariantNumeric: 'tabular-nums' }}>{c.venc ? f0(c.venc) : '—'}</span>
                  <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{c.pv ? f0(c.pv) : '—'}</span>
                  <span style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{f0(c.tot)}</span>
                  <span style={{ textAlign: 'right', color: C.muted, fontVariantNumeric: 'tabular-nums' }}>{c.terc ? f0(c.terc) : '—'}</span>
                  <span style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{f0(c.prop)}</span></>
                  : <>
                    <span style={{ textAlign: 'right', fontWeight: 700, fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>{fM(c.tot)}</span>
                    <span style={{ gridColumn: '1 / -1', fontSize: 12, color: C.muted }}>Vencido <b style={{ color: c.venc ? C.overdueText : C.muted }}>{fM(c.venc)}</b> · Por vencer <b style={{ color: C.text }}>{fM(c.pv)}</b>{c.nombres.length ? <> · Terceros <b style={{ color: C.text }}>{c.nombres.join(', ')}</b></> : null}</span></>}
              </div>
              {op && detalle(c)}
            </div>)
        })}
        {!lista.length && <div style={{ color: C.muted, padding: 16 }}>Sin facturas con este filtro.</div>}
      </div>
    </FlujoPagina>)
}
