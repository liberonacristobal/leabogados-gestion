// Vista «Ingreso propio» de Cobranza: de lo vencido o de lo por cobrar, cuánto es de la oficina y cuánto es de terceros o comisión.
// Presentación solamente: las cifras salen de resumenPropio (_shared/cobranzaPropio.js).
import { C, SEC_LBL, SIcon, useIsDesktop } from '../lib/base.jsx'
import { FlujoPagina } from '../lib/compartido.jsx'

const f0 = (/** @type {number} */ n) => '$' + Math.round(n || 0).toLocaleString('es-CL')
const fM = (/** @type {number} */ n) => '$' + ((n || 0) / 1e6).toFixed(1).replace('.', ',') + 'M'
const pc = (/** @type {number} */ a, /** @type {number} */ b) => (b > 0 ? Math.round((a / b) * 100) : 0)

export function CobranzaPropioVista({ resumen, tab, setTab, cn, onOpenClientFicha, onBack }) {
  const D = useIsDesktop()
  const v = tab === 'venc', d = v ? resumen.venc : resumen.todo
  const nombre = v ? 'Vencido' : 'Por cobrar'
  // Clientes con parte ajena, de mayor a menor; el resto se junta en una línea.
  const filas = [...resumen.porCliente.values()].map(c => ({ cid: c.cid, g: v ? c.venc : c.todo })).filter(x => x.g.total > 0)
  const conAjeno = filas.filter(x => x.g.ext + x.g.com > 0).sort((a, b) => (b.g.ext + b.g.com) - (a.g.ext + a.g.com))
  const resto = filas.filter(x => !(x.g.ext + x.g.com > 0)), restoTot = resto.reduce((a, x) => a + x.g.total, 0)
  const tarjeta = (/** @type {'venc'|'todo'} */ k, /** @type {string} */ label, /** @type {string} */ ico, bg, bd, col) => {
    const g = resumen[k], on = (k === 'venc') === v
    return (
      <button key={k} onClick={() => setTab(k === 'venc' ? 'venc' : 'todo')} aria-pressed={on} style={{ font: 'inherit', textAlign: 'left', cursor: 'pointer', background: bg, border: on ? `2px solid ${C.accent}` : `1px solid ${bd}`, borderRadius: 12, padding: on ? '11px 12px' : '12px 13px', display: 'flex', gap: 10, alignItems: 'flex-start', minWidth: 0 }}>
        <span style={{ width: 30, height: 30, borderRadius: 8, background: bd, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><SIcon n={ico} s={16} c={col} /></span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ ...SEC_LBL, display: 'block', whiteSpace: 'nowrap' }}>{label}</span>
          <span style={{ display: 'block', fontSize: D ? 26 : 20, fontWeight: 800, color: col, letterSpacing: '-.5px', lineHeight: 1, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', marginTop: 5 }}>{fM(g.total)}</span>
          <span style={{ display: 'block', fontSize: 10, color: C.muted, marginTop: 5, whiteSpace: 'nowrap' }}>{fM(g.propio)} propio</span>
        </span>
      </button>)
  }
  const fila = (sg, t, sub, val, tot) => (
    <div key={t} style={{ display: 'grid', gridTemplateColumns: '22px minmax(0,1fr) auto', gap: 8, alignItems: 'baseline', padding: tot ? '11px 0 0' : '9px 0', borderTop: tot ? `2px solid ${C.border}` : `1px solid ${C.bgSoft}`, marginTop: tot ? 2 : 0 }}>
      <span style={{ textAlign: 'center', color: C.muted, fontWeight: 700 }}>{sg}</span>
      <span style={{ minWidth: 0, fontWeight: tot ? 800 : 600, fontSize: tot ? 16 : 14, color: tot ? C.greenText : C.text }}>{t}{sub && <span style={{ display: 'block', fontWeight: 400, fontSize: 12, color: C.muted }}>{sub}</span>}</span>
      <span style={{ fontWeight: 700, fontSize: tot ? 17 : 14, color: tot ? C.greenText : C.text, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{f0(val)}</span>
    </div>)
  const cols = 'minmax(0,1.2fr) minmax(0,1.3fr) 130px 130px 130px'
  const chip = (/** @type {string} */ t, bg, col) => <span style={{ fontSize: 11.5, fontWeight: 700, borderRadius: 20, padding: '2px 9px', background: bg, color: col, whiteSpace: 'nowrap' }}>{t}</span>
  const detalle = (/** @type {{ext:number,com:number}} */ g) => <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{g.ext > 0 && chip('Por cuenta de terceros', C.soonBg, C.soonText)}{g.com > 0 && chip('Comisiones', C.tealBg, C.tealText)}</span>
  return (
    <FlujoPagina origen='Cobranza' titulo={nombre} onBack={onBack} maxW={1040}>
      <div style={{ display: 'grid', gridTemplateColumns: D ? 'repeat(2,minmax(0,360px))' : '1fr 1fr', gap: 8, marginBottom: 12 }}>
        {tarjeta('venc', 'Vencido', 'alert', C.overdueBg, C.overdueBd, C.overdueText)}
        {tarjeta('todo', 'Por cobrar', 'file', C.azulBg, C.azulBd, C.accent)}
      </div>
      <div>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px', marginBottom: 12, maxWidth: D ? 520 : undefined }}>
          <div style={{ ...SEC_LBL, marginBottom: 6 }}>{v ? 'De lo vencido' : 'De lo por cobrar'}, cuánto es nuestro</div>
          {fila('', nombre, `${d.n} factura${d.n !== 1 ? 's' : ''}`, d.total, false)}
          {fila('−', 'Por cuenta de terceros', '', d.ext, false)}
          {fila('−', 'Comisiones', 'por pagar a terceros', d.com, false)}
          {fila('=', 'Ingreso propio', '', d.propio, true)}
          <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>{pc(d.propio, d.total)} % {v ? 'de lo vencido' : 'de lo por cobrar'} es ingreso de la oficina.</div>
        </div>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px', minWidth: 0 }}>
          <div style={{ ...SEC_LBL, marginBottom: 6 }}>Por cliente</div>
          {D && <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 12, fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: C.muted, padding: '2px 0 6px' }}><span>Cliente</span><span>Terceros y comisiones</span><span style={{ textAlign: 'right' }}>{nombre}</span><span style={{ textAlign: 'right' }}>Ajeno</span><span style={{ textAlign: 'right' }}>Propio</span></div>}
          {conAjeno.map(x => {
            const g = x.g, ajeno = g.ext + g.com
            return (
              <div key={x.cid} onClick={() => onOpenClientFicha && onOpenClientFicha(x.cid)} role='button' tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onOpenClientFicha && onOpenClientFicha(x.cid) }} style={{ display: 'grid', gridTemplateColumns: D ? cols : 'minmax(0,1fr) auto', gap: D ? 12 : '4px 10px', alignItems: 'center', padding: '11px 0', borderTop: `1px solid ${C.bgSoft}`, cursor: 'pointer' }}>
                <span style={{ fontWeight: 700, color: C.accent, minWidth: 0 }}>{cn(x.cid)}</span>
                {D ? <>{detalle(g)}<span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{f0(g.total)}</span><span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: C.muted }}>−{f0(ajeno)}</span><span style={{ textAlign: 'right', fontWeight: 700, color: C.greenText, fontVariantNumeric: 'tabular-nums' }}>{f0(g.propio)}</span></>
                  : <><span style={{ textAlign: 'right', fontWeight: 700, color: C.greenText, fontVariantNumeric: 'tabular-nums' }}>{f0(g.propio)}</span>{detalle(g)}<span style={{ textAlign: 'right', fontSize: 12.5, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>−{f0(ajeno)}</span></>}
              </div>)
          })}
          {resto.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: D ? cols : 'minmax(0,1fr) auto', gap: D ? 12 : '4px 10px', alignItems: 'center', padding: '11px 0', borderTop: `1px solid ${C.bgSoft}`, color: C.muted }}>
              <span style={{ fontWeight: 600 }}>{resto.length} cliente{resto.length !== 1 ? 's' : ''} más</span>
              {D ? <><span>Sin terceros ni comisiones</span><span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{f0(restoTot)}</span><span style={{ textAlign: 'right' }}>—</span><span style={{ textAlign: 'right', fontWeight: 700, color: C.greenText, fontVariantNumeric: 'tabular-nums' }}>{f0(restoTot)}</span></>
                : <><span style={{ textAlign: 'right', fontWeight: 700, color: C.greenText, fontVariantNumeric: 'tabular-nums' }}>{f0(restoTot)}</span><span style={{ fontSize: 12.5 }}>Sin terceros ni comisiones</span></>}
            </div>)}
          {!conAjeno.length && !resto.length && <div style={{ color: C.muted, padding: '10px 0' }}>Sin facturas {v ? 'vencidas' : 'por cobrar'}.</div>}
        </div>
      </div>
    </FlujoPagina>)
}
