// Página «Cartola» de un cliente (desde Gastos › ficha del cliente): fondos, gastos y pagos en orden, con tres saldos corridos.
// La arma cartolaCliente (la misma que el Excel); el saldo es el de la ficha (fgCliente).
import { useMemo, useState } from 'react'
import { C, SIcon, BtnDescarga, diaGrande, fmt, fmtFechaDMY, useIsDesktop } from '../lib/base.jsx'
import { PaginaSobre } from '../lib/compartido.jsx'
import { cartolaCliente } from '../../supabase/functions/_shared/gastosClienteExcel.js'

const FILTROS = [['todos', 'Todos'], ['Fondo', 'Fondos'], ['Pago', 'Pagos'], ['Gasto', 'Gastos']]
const CHIP = { Fondo: { bg: C.greenBg, c: C.greenText }, Pago: { bg: C.azulBg, c: C.accent }, Gasto: { bg: C.border, c: C.accent } }
const signo = n => (n < 0 ? '−' : '') + fmt(Math.abs(n))
const LIM = 40

/** @param {{ client: any, expenses: any[], onBack: ()=>void, onVerGasto?: (id:any)=>void, onDescargar?: ()=>void }} p */
export function CartolaPagina({ client, expenses, onBack, onVerGasto, onDescargar }) {
  const D = useIsDesktop()
  const cart = useMemo(() => cartolaCliente({ expenses, clientId: client.id }), [expenses, client.id])
  const [fil, setFil] = useState('todos'), [q, setQ] = useState(''), [asc, setAsc] = useState(false), [todos, setTodos] = useState(false), [verNV, setVerNV] = useState(false), [abierto, setAbierto] = useState(/** @type {any} */ (null))
  const porId = useMemo(() => new Map((expenses || []).map(e => [String(e.id), e])), [expenses])
  const nq = q.trim().toLowerCase()
  const lista = useMemo(() => {
    const xs = cart.eventos.filter(e => (verNV || !e.nv) && (fil === 'todos' || e.k === fil) && (!nq || `${e.det} ${e.ots || ''} ${e.k}`.toLowerCase().includes(nq) || String(Math.round(e.abono || e.cargo || e.inc)).includes(nq.replace(/\D/g, '') || '§')))
    return asc ? xs : xs.slice().reverse()
  }, [cart, fil, nq, asc, verNV])
  const nNV = cart.eventos.filter(e => e.nv).length
  const ver = todos ? lista : lista.slice(0, LIM)
  const abrir = e => { if (e.k === 'Pago') setAbierto(a => (a === e.ref.id ? null : e.ref.id)); else if (onVerGasto) onVerGasto(e.ref.id) }

  const tile = (lbl, val, bg, col, nota, grande) => (
    <div style={{ background: bg, color: col, borderRadius: 12, padding: grande ? '11px 15px' : '11px 14px', minWidth: 0, ...(grande ? { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 10, ...(D ? {} : { gridColumn: '1 / -1' }) } : {}) }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: .6, textTransform: 'uppercase', opacity: .85 }}>{lbl}</div>
        <div style={{ fontSize: grande ? 26 : D ? 20 : 18, fontWeight: 800, letterSpacing: grande ? -.6 : -.4, lineHeight: 1.15, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{val}</div>
      </div>
      {nota && <div style={{ fontSize: 11, opacity: .8, whiteSpace: 'nowrap' }}>{nota}</div>}
    </div>)
  const neg = cart.saldo < 0
  const tag = k => <span style={{ display: 'inline-block', fontSize: 10.5, fontWeight: 700, borderRadius: 20, padding: '2px 9px', whiteSpace: 'nowrap', background: CHIP[k].bg, color: CHIP[k].c }}>{k === 'Fondo' ? 'Fondo' : k}</span>
  const monto = (n, col) => <span style={{ color: col || C.text, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{n}</span>
  const detalle = e => e.k === 'Pago' && abierto === e.ref.id && (
    <div style={{ padding: '4px 0 8px' }}>{e.ref.ids.map(id => { const x = porId.get(String(id)); return x ? (
      <div key={id} onClick={ev => { ev.stopPropagation(); onVerGasto && onVerGasto(id) }} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '5px 0', borderTop: `0.5px solid ${C.border}`, fontSize: 12, cursor: onVerGasto ? 'pointer' : 'default' }}>
        <span style={{ minWidth: 0, color: C.text }}>{x.ot_number ? `OT ${x.ot_number} · ` : ''}{String(x.concept || '—').replace(/^Gastos notariales — /, '')}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: C.muted }}>{fmt(x.amount)}</span>
      </div>) : null })}</div>)
  const barra = (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
      <div style={{ flex: '1 1 220px', display: 'flex', alignItems: 'center', gap: 8, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 11px', minWidth: 0 }}>
        <SIcon n='search' s={15} c={C.muted} /><input value={q} onChange={e => setQ(e.target.value)} placeholder='Buscar movimiento, OT o monto…' style={{ border: 'none', background: 'none', outline: 'none', fontSize: 13, color: C.text, width: '100%' }} />
      </div>
      {FILTROS.map(([k, l]) => <button key={k} type='button' onClick={() => setFil(k)} style={{ fontSize: 12, fontWeight: 600, border: `1px solid ${fil === k ? C.accent : C.border}`, borderRadius: 10, background: fil === k ? C.accent : C.surface, color: fil === k ? '#fff' : C.accent, padding: '7px 11px', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>{l}</button>)}
      <button type='button' onClick={() => setAsc(v => !v)} style={{ fontSize: 12, fontWeight: 600, border: `1px solid ${C.border}`, borderRadius: 10, background: C.surface, color: C.accent, padding: '7px 11px', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Fecha {asc ? '↑' : '↓'}</button>
      {nNV > 0 && <button type='button' onClick={() => setVerNV(v => !v)} title='Una OT de $0 o $1 es un repertorio no usado o anulado: no se debe' style={{ fontSize: 12, fontWeight: 600, border: `1px solid ${verNV ? C.accent : C.border}`, borderRadius: 10, background: verNV ? C.accent : C.surface, color: verNV ? '#fff' : C.accent, padding: '7px 11px', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>OT no válidas {nNV}</button>}
      {onDescargar && <BtnDescarga onClick={onDescargar} titulo='Descargar Excel de gastos' n='download' s={18} />}
    </div>)
  const th = (t, n) => <th style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: .5, textTransform: 'uppercase', color: C.accent, textAlign: n ? 'right' : 'left', padding: '9px 8px', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>{t}</th>
  const td = (c, n, extra) => <td style={{ padding: '8px 8px', borderTop: `0.5px solid ${C.border}`, verticalAlign: 'middle', fontVariantNumeric: 'tabular-nums', textAlign: n ? 'right' : 'left', whiteSpace: n ? 'nowrap' : 'normal', ...(extra || {}) }}>{c}</td>
  const tabla = (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
        <thead><tr>{th('Fecha')}{th('Movimiento')}{th('Detalle')}{th('Monto', 1)}{th('Caja', 1)}{th('Por pagar', 1)}{th('Saldo', 1)}</tr></thead>
        <tbody>{ver.map(e => [
          <tr key={e.ref.id + e.k} onClick={() => abrir(e)} style={{ cursor: 'pointer' }}>
            {td(fmtFechaDMY(e.f), false, { whiteSpace: 'nowrap' })}{td(tag(e.k))}{td(<span style={{ color: C.text }}>{e.det}{e.ots ? <span style={{ color: C.muted }}>{`: ${e.ots}`}</span> : null}</span>, false, { minWidth: 220 })}
            {td(e.abono ? monto('+' + fmt(e.abono), C.greenText) : e.cargo ? monto(signo(-e.cargo)) : monto(signo(-e.inc), C.overdue), true, { fontWeight: 600 })}
            {td(monto(signo(e.caja), e.caja < 0 ? C.overdue : C.text), true)}{td(monto(fmt(e.por)), true)}{td(monto(signo(e.cli), e.cli < 0 ? C.overdue : C.text), true, { fontWeight: 700 })}
          </tr>,
          e.k === 'Pago' && abierto === e.ref.id ? <tr key={e.ref.id + 'd'}><td colSpan={7} style={{ padding: '0 14px 4px 30px', background: C.bgPanel }}>{detalle(e)}</td></tr> : null])}</tbody>
      </table>
    </div>)
  const movil = ver.map(e => {
    const principal = e.abono ? { t: '+' + fmt(e.abono), c: C.greenText } : e.cargo ? { t: signo(-e.cargo), c: C.text } : { t: signo(-e.inc), c: C.overdue }
    return (
      <div key={e.ref.id + e.k} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '9px 12px', marginBottom: 8 }}>
        <div onClick={() => abrir(e)} style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}>
          {diaGrande(e.f)}
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ marginBottom: 3 }}>{tag(e.k)}</div><div style={{ fontSize: 13, fontWeight: 600, color: C.text, lineHeight: 1.25, overflowWrap: 'anywhere' }}>{e.det}</div></div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}><div style={{ fontSize: 14, fontWeight: 700, color: principal.c, fontVariantNumeric: 'tabular-nums' }}>{principal.t}</div><div style={{ fontSize: 11, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>saldo {signo(e.cli)}</div></div>
        </div>
        {detalle(e)}
      </div>)
  })
  return (
    <PaginaSobre origen='Gastos' titulo={`Cartola · ${client.name}`} onBack={onBack} maxW={1180}>
      <div style={{ display: 'grid', gridTemplateColumns: D ? '2fr 1fr 1fr' : '1fr 1fr', gap: D ? 10 : 8, marginBottom: 12 }}>
        {tile('Saldo del cliente', signo(cart.saldo), neg ? C.overdueBg : C.azulBg, neg ? C.overdueText : C.accent, neg ? 'por cobrar' : cart.saldo > 0 ? 'a favor' : 'al día', true)}
        {tile('Saldo en caja', signo(cart.caja), cart.caja < 0 ? C.overdueBg : C.greenBg, cart.caja < 0 ? C.overdueText : C.greenText)}
        {tile('Por pagar', fmt(cart.por), C.border, C.accent)}
      </div>
      {barra}
      {lista.length === 0 ? <div style={{ textAlign: 'center', padding: 24, fontSize: 13, color: C.muted }}>Sin movimientos{nq || fil !== 'todos' ? ' con ese filtro' : ''}.</div> : (D ? tabla : movil)}
      {!todos && lista.length > LIM && <button type='button' onClick={() => setTodos(true)} style={{ marginTop: 8, fontSize: 13, fontWeight: 600, color: C.azulInfo, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Ver los {lista.length}</button>}
    </PaginaSobre>)
}
