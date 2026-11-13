// «Escenarios de retiro» (Socios): ¿cuánto podríamos retirar hoy si pagaran los clientes con facturas vencidas de los tramos que elijas?
// Solo lo que sigue impago hoy, por tramo de mora (30–59, 60–89, 90 y más; los mismos del simulador del Flujo de caja). Reglas puras en _shared/escenariosRetiro.js.
import { useMemo, useState } from 'react'
import { C, Gl, SEC_LBL, isoLocal } from '../lib/base.jsx'
import { ChevAb, fmtMillLR, saldoBill } from '../lib/compartido.jsx'
import { escenarioRetiro, facturasVencidasPorTramo, resumenPorTramo } from '../../supabase/functions/_shared/escenariosRetiro.js'

const ETQ = ['30–59', '60–89', '90 y más']

export function EscenariosRetiro({ billing = [], terceros = [], clients = [], disponible = 0, nSocios = 2, isDesktop = true, onOpenClientFicha, onOpenFlujoCaja, onOpenProveedores }) {
  const [el, setEl] = useState([false, false, true])   // tramos elegidos; empieza en «90 y más»
  const [ver, setVer] = useState(false)
  const items = useMemo(() => facturasVencidasPorTramo({ billing, terceros, saldo: saldoBill, hoyT: new Date(isoLocal(Date.now()) + 'T12:00:00').getTime() }), [billing, terceros])
  const rs = useMemo(() => resumenPorTramo(items), [items])
  const e = useMemo(() => escenarioRetiro({ items, elegidos: el, disponible, nSocios }), [items, el, disponible, nSocios])
  const nomCli = useMemo(() => { const m = /** @type {Record<string,string>} */ ({}); (clients || []).forEach(c => { if (c) m[String(c.id)] = c.name }); return m }, [clients])
  const porCliente = useMemo(() => { const m = /** @type {Record<string, {cid:any, n:number, saldo:number, dias:number}>} */ ({}); items.filter(x => el[x.tramo]).forEach(x => { const k = String(x.cid), g = (m[k] = m[k] || { cid: x.cid, n: 0, saldo: 0, dias: 0 }); g.n++; g.saldo += x.saldo; g.dias = Math.max(g.dias, x.dias) }); return Object.values(m).sort((a, b) => b.saldo - a.saldo) }, [items, el])
  const f = fmtMillLR
  const ln = (/** @type {string} */ sg, /** @type {string} */ l, /** @type {string} */ v, /** @type {{rojo?:boolean, on?:()=>void}} */ o = {}) => <div onClick={o.on} role={o.on ? 'button' : undefined} style={{ display: 'grid', gridTemplateColumns: '14px minmax(0,1fr) auto', columnGap: 8, alignItems: 'center', padding: '8px 0', borderTop: `1px solid ${C.border}`, fontSize: 13, cursor: o.on ? 'pointer' : 'default' }}>
    <span style={{ textAlign: 'center', fontWeight: 700, color: C.muted }}>{sg}</span><span style={{ color: C.text, fontWeight: 600, minWidth: 0 }}>{l}{o.on && <span style={{ color: C.textSoft, marginLeft: 5 }}><Gl n='chevron' /></span>}</span>
    <span style={{ fontWeight: 700, color: o.rojo ? C.overdueText : C.text, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{v}</span></div>
  const link = (/** @type {string} */ t, /** @type {(()=>void)|undefined} */ on) => on ? <span onClick={on} role='button' style={{ fontSize: 11.5, fontWeight: 700, color: C.azulInfo, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3 }}>{t} <Gl n='chevron' /></span> : null
  const sin = e.n === 0
  return <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 18, overflow: 'hidden', marginBottom: 16 }}>
    <div style={{ padding: '15px 18px 8px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ width: 30, height: 30, borderRadius: 10, background: C.soonBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='#9A6413' strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round'><path d='M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6' /></svg></span>
      <span style={{ fontSize: 13, fontWeight: 800, color: C.accent, letterSpacing: -.2 }}>Escenarios de retiro</span>
      {isDesktop && <span style={{ marginLeft: 'auto', fontSize: 11, color: C.muted }}>si pagaran los clientes con facturas vencidas</span>}
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 6, padding: '4px 16px 8px' }}>
      {rs.map((t, i) => { const on = el[i]; return <button key={t.k} onClick={() => setEl(a => a.map((v, j) => j === i ? !v : v))} aria-pressed={on} style={{ border: `1px solid ${on ? C.tileLineOn : C.border}`, background: on ? C.azulBg : C.card, borderRadius: 12, padding: '8px 6px', cursor: 'pointer', textAlign: 'center', minWidth: 0, fontFamily: 'inherit' }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: C.accent, whiteSpace: 'nowrap' }}>{ETQ[i]}</div>
        <div style={{ fontSize: 12, fontWeight: 800, color: on ? C.accent : C.muted, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{f(t.saldo)}</div></button> })}
    </div>
    <div style={{ padding: '0 18px 8px', fontSize: 12, color: C.muted }}>{sin ? 'Sin tramo elegido' : `${e.n} factura${e.n !== 1 ? 's' : ''} · ${e.clientes} cliente${e.clientes !== 1 ? 's' : ''} · días de mora`}</div>
    <div style={{ padding: '0 18px 4px' }}>
      {ln('', 'Facturas vencidas elegidas', f(e.bruto), { on: sin ? undefined : () => setVer(v => !v) })}
      {ln('−', 'Comisiones a terceros que se pagarían', f(e.com), { rojo: true, on: onOpenProveedores })}
      {ln('=', 'Se sumaría a la caja', f(e.neto))}
      {ln('+', 'Disponible hoy', f(e.disponible))}
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderTop: `1.5px solid ${C.accent}`, background: C.greenBg, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: .4, color: C.greenText }}>Retirable hoy en este escenario{nSocios > 1 && !sin && <span style={{ display: 'block', fontSize: 11.5, fontWeight: 600, textTransform: 'none', letterSpacing: 0, opacity: .9 }}>{f(e.porSocio)} por socio</span>}</span>
      <span style={{ marginLeft: 'auto', fontSize: isDesktop ? 26 : 22, fontWeight: 800, color: C.greenText, letterSpacing: -.6, fontVariantNumeric: 'tabular-nums' }}>{f(e.retirable)}</span>
    </div>
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', padding: '10px 18px 12px', alignItems: 'center' }}>
      {!sin && <span onClick={() => setVer(v => !v)} role='button' style={{ fontSize: 11.5, fontWeight: 700, color: C.azulInfo, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>Ver las {e.n} factura{e.n !== 1 ? 's' : ''} por cliente <ChevAb open={ver} /></span>}
      {link('Simular cobro a futuro en Flujo de caja', onOpenFlujoCaja)}
    </div>
    {ver && !sin && <div style={{ borderTop: `1px solid ${C.border}` }}>{porCliente.map(g => <div key={String(g.cid)} onClick={() => onOpenClientFicha && onOpenClientFicha(g.cid)} role='button' className='er-c' style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 18px', borderTop: `1px solid ${C.bgSoft}`, cursor: onOpenClientFicha ? 'pointer' : 'default' }}>
      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 700, color: C.accent, overflowWrap: 'anywhere' }}>{nomCli[String(g.cid)] || 'Sin cliente'}</div><div style={{ fontSize: 11, color: C.textSoft }}>{g.n} factura{g.n !== 1 ? 's' : ''} · hasta {g.dias} días de mora</div></div>
      <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{f(g.saldo)}</span><span style={{ color: C.textSoft }}><Gl n='chevron' /></span></div>)}</div>}
  </div>
}
