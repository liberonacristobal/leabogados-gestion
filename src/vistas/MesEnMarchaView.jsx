// «Mes en marcha» (Oficina): ¿lo cobrado en el mes, neto de comisiones, cubre los gastos fijos de la oficina (pagados y por pagar)?
// Solo lo real y lo propio: cobrado propio − comisiones pagadas contra los gastos de la oficina por fecha de pago. Sin cobros proyectados ni retiros (eso es Socios).
// Reglas puras en _shared/mesEnMarcha.js; el cobrado sale de useResultadoAnio (el mismo «Cobrado propio» de Socios) y las comisiones de resultadoMes.
import { useEffect, useMemo, useState } from 'react'
import { supabase, selectAll, DEMO } from '../supabase'
import { demoData } from '../demoData'
import { C, Gl, SIcon, diaGrande, isoLocal } from '../lib/base.jsx'
import { useResultadoAnio } from '../lib/resultadoAnio.js'
import { ChevAb, PageHeader, _esDiaHabil, fmtMillLR, resultadoMes, useFuentesResultado } from '../lib/compartido.jsx'
import { cascadaCobertura, gastosPagados, gastosPorPagar } from '../../supabase/functions/_shared/mesEnMarcha.js'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
export const YM_MIN = '2026-01'
export const ymTitulo = (/** @type {string} */ ym) => `${MESES[Number(ym.slice(5, 7)) - 1].replace(/^./, c => c.toUpperCase())} ${ym.slice(0, 4)}`
const mesMas = (/** @type {string} */ ym, /** @type {number} */ n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

/** Cargos del banco sin clasificar del mes (salieron de la cuenta pero aún no son un gasto): cuentan como pagados, con su etiqueta. */
function useCargosSinClasificar(ym) {
  const [rows, setRows] = useState(/** @type {any[]} */ ([]))
  useEffect(() => {
    let vivo = true
    const filtra = (/** @type {any[]} */ a) => (a || []).filter(m => m && m.tipo === 'cargo' && m.estado === 'pendiente' && !m.es_interno && String(m.fecha || '').slice(0, 7) === ym)
    if (DEMO) { setRows(filtra(demoData.cartola_movimientos)); return }
    selectAll(() => supabase.from('cartola_movimientos').select('id,fecha,tipo,monto,estado,es_interno,nombre_contraparte,descripcion').eq('tipo', 'cargo').eq('estado', 'pendiente').gte('fecha', ym + '-01').lte('fecha', ym + '-31').order('id'))
      .then(r => { if (vivo) setRows(filtra((r && r.data) || r)) }, () => { if (vivo) setRows([]) })
    return () => { vivo = false }
  }, [ym])
  return rows
}

/** Todo el cálculo de un mes: la vista y la tarjeta de Oficina leen lo mismo. */
export function useMesEnMarcha({ ym, expenses = [], clients = [], billing = [], sales = [], terceros = [], costosOfiRows = [], anticipos = [] }) {
  const yr = Number(ym.slice(0, 4))
  const fu = useFuentesResultado()
  const R = useResultadoAnio({ sales, billing, terceros, costosOfiRows, expenses, clients, anticipos, selYear: yr })
  const sinClas = useCargosSinClasificar(ym)
  return useMemo(() => {
    const hoy = isoLocal(Date.now()), actual = ym === hoy.slice(0, 7)
    const ofi = (clients || []).find(c => c && (c.is_internal || /liberona\s+escala/i.test(c.name || '')))
    const gastos = ofi ? (expenses || []).filter(e => e && String(e.client_id) === String(ofi.id)) : []
    const cobrado = Number(R.ingresosPorAnioVenta.byMonth?.[ym]) || 0
    const com = Number(resultadoMes(fu, { billing, terceros, costosOfiRows, expenses, clients }, ym).com) || 0
    const pag = gastosPagados(gastos, ym)
    const sc = sinClas.map(m => ({ k: 'sinclas', l: 'Cargo sin clasificar', fecha: String(m.fecha).slice(0, 10), monto: Number(m.monto) || 0, ids: [], n: 1, mov: m.id, sub: m.nombre_contraparte || '' }))
    const pagadosFilas = [...pag, ...sc].sort((a, b) => a.fecha.localeCompare(b.fecha))
    const porPagarFilas = actual ? gastosPorPagar(gastos, ym, hoy, f => _esDiaHabil(new Date(f + 'T12:00:00'))) : []
    const pagado = pagadosFilas.reduce((a, x) => a + x.monto, 0), porPagar = porPagarFilas.reduce((a, x) => a + x.monto, 0)
    const cas = cascadaCobertura({ cobrado: cobrado - com, pagado, porPagar })
    return { ym, actual, hoy, cobrado, com, pagadosFilas, porPagarFilas, pagado, porPagar, cas, gastos }
  }, [ym, R, fu, sinClas, expenses, clients, billing, terceros, costosOfiRows])
}

export function MesEnMarchaView({ expenses = [], clients = [], billing = [], sales = [], terceros = [], costosOfiRows = [], anticipos = [], isDesktop = true, backLabel = 'Oficina', onBack, onOpenGasto, onOpenCobradoMes, onOpenBanco, onOpenEstado }) {
  const hoyYm = isoLocal(Date.now()).slice(0, 7)
  const [ym, setYm] = useState(hoyYm)
  const [ab, setAb] = useState({ cob: true, gas: false })
  const M = useMesEnMarcha({ ym, expenses, clients, billing, sales, terceros, costosOfiRows, anticipos })
  const f = fmtMillLR, c = M.cas, D = isDesktop
  const gastoById = useMemo(() => { const m = /** @type {Record<string, any>} */ ({}); M.gastos.forEach(e => { m[String(e.id)] = e }); return m }, [M.gastos])
  const abrirGastos = () => setAb(a => ({ ...a, gas: true }))
  const pad = D ? '10px 16px' : '9px 12px'
  const card = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 10 }
  const tit = (/** @type {string} */ t, /** @type {string} */ sub, /** @type {boolean} */ open, /** @type {()=>void} */ on) => <div onClick={on} role='button' style={{ display: 'flex', alignItems: 'center', gap: 8, padding: D ? '13px 16px' : '12px 12px', cursor: 'pointer' }}>
    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: C.accent }}>{t}</span><span style={{ marginLeft: 'auto', fontSize: 11, color: C.muted }}>{sub}</span><span style={{ color: C.textSoft, display: 'inline-flex' }}><ChevAb open={open} /></span></div>
  const ln = (/** @type {string} */ sg, /** @type {string} */ l, /** @type {string} */ v, /** @type {string} */ s, /** @type {{on?:()=>void, rojo?:boolean, tot?:boolean, srojo?:boolean}} */ o = {}) =>
    <div onClick={o.on} role={o.on ? 'button' : undefined} style={{ display: 'grid', gridTemplateColumns: '14px minmax(0,1fr) auto auto', columnGap: 10, alignItems: 'center', padding: pad, borderTop: o.tot ? `1.5px solid ${C.accent}` : `1px solid ${C.border}`, background: o.tot ? C.bgSoft : undefined, fontSize: 13, cursor: o.on ? 'pointer' : 'default' }}>
      <span style={{ textAlign: 'center', fontWeight: 700, color: C.muted }}>{sg}</span>
      <span style={{ color: o.tot ? C.accent : C.text, fontWeight: o.tot ? 800 : 600, minWidth: 0 }}>{l}{o.on && <span style={{ color: C.textSoft, marginLeft: 6 }}><Gl n='chevron' /></span>}</span>
      <span style={{ fontWeight: o.tot ? 800 : 700, color: o.rojo ? C.overdueText : o.tot ? C.accent : C.text, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', textAlign: 'right', minWidth: 62 }}>{v}</span>
      <span style={{ fontWeight: 800, color: o.srojo ? C.overdueText : C.accent, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', textAlign: 'right', minWidth: 62 }}>{s}</span></div>
  const chip = (/** @type {string} */ t, /** @type {string} */ bg, /** @type {string} */ fg, /** @type {(()=>void)|undefined} */ on) => <span onClick={on} role={on ? 'button' : undefined} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700, borderRadius: 20, padding: '2px 9px', background: bg, color: fg, whiteSpace: 'nowrap', cursor: on ? 'pointer' : 'default' }}>{t}</span>
  const nSin = M.pagadosFilas.filter(x => x.k === 'sinclas').length
  const fila = (/** @type {any} */ x, /** @type {boolean} */ proy, /** @type {number} */ i) => {
    const e = !proy && x.n === 1 && x.ids[0] != null ? gastoById[String(x.ids[0])] : null
    const on = () => { if (x.k === 'sinclas') onOpenBanco && onOpenBanco(x.mov); else if (e && onOpenGasto) onOpenGasto(e); else onOpenEstado && onOpenEstado(ym) }
    const sub = x.k === 'sinclas' ? (x.sub || 'sin categoría') : x.n > 1 ? `${x.n} pagos` : proy ? 'según el último pago' : ''
    return <div key={x.k + x.fecha + i} onClick={on} role='button' className='er-c' style={{ display: 'flex', alignItems: 'center', gap: 10, padding: pad, borderTop: `1px solid ${C.border}`, cursor: 'pointer', color: proy ? C.muted : undefined }}>
      {diaGrande(x.fecha, proy ? C.muted : undefined)}
      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 700, color: proy ? C.muted : C.accent, fontStyle: proy ? 'italic' : 'normal' }}>{x.l}</div>{sub && <div style={{ fontSize: 11, color: C.textSoft }}>{sub}</div>}</div>
      <div style={{ textAlign: 'right' }}><div style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: proy ? C.muted : C.text }}>{f(x.monto)}</div>
        <div style={{ fontSize: 10, fontWeight: 700, color: proy ? C.textSoft : x.k === 'sinclas' ? C.soonText : C.greenText }}>{proy ? 'Proyectado' : x.k === 'sinclas' ? 'Pagado · sin clasificar' : 'Pagado'}</div></div>
      <span style={{ color: C.textSoft }}><Gl n='chevron' /></span></div> }
  const btnMes = (/** @type {number} */ n) => { const dis = n > 0 ? ym >= hoyYm : ym <= YM_MIN; return <button onClick={() => !dis && setYm(mesMas(ym, n))} disabled={dis} aria-label={n < 0 ? 'Mes anterior' : 'Mes siguiente'} style={{ width: 30, height: 30, borderRadius: 9, border: `1px solid ${C.border}`, background: C.card, color: C.accent, cursor: dis ? 'default' : 'pointer', opacity: dis ? .35 : 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Gl n={n < 0 ? 'chevL' : 'chevron'} /></button> }
  const totGastos = M.pagado + M.porPagar
  return <div style={D ? { maxWidth: 980, margin: '0 auto', padding: '12px 20px 40px' } : { padding: '8px 16px 40px' }}>
    <PageHeader origen={backLabel} onBack={onBack} titulo='Mes en marcha' style={{ margin: D ? '-12px -20px 12px' : '-8px -16px 12px' }} />
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 12px' }}>{btnMes(-1)}<span style={{ fontSize: 15, fontWeight: 800, color: C.accent, minWidth: 140, textAlign: 'center' }}>{ymTitulo(ym)}</span>{btnMes(1)}<span style={{ marginLeft: 'auto', fontSize: 12, color: C.muted }}>{M.actual ? `en curso · al ${M.hoy.slice(8, 10)}-${M.hoy.slice(5, 7)}` : 'mes cerrado'}</span></div>
    <div style={card}>
      {tit('Cobertura de gastos', M.actual ? `al ${M.hoy.slice(8, 10)}-${M.hoy.slice(5, 7)}` : 'mes cerrado', ab.cob, () => setAb(a => ({ ...a, cob: !a.cob })))}
      {ab.cob && <>
        <div style={{ display: 'grid', gridTemplateColumns: '14px minmax(0,1fr) auto auto', columnGap: 10, padding: D ? '0 16px 4px' : '0 12px 4px', fontSize: 10, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: C.muted }}><span /><span /><span style={{ textAlign: 'right', minWidth: 62 }}>Monto</span><span style={{ textAlign: 'right', minWidth: 62 }}>Saldo</span></div>
        {ln('', 'Cobrado neto de comisiones', f(c.cobrado), f(c.cobrado), { on: () => onOpenCobradoMes && onOpenCobradoMes(ym) })}
        {ln('−', 'Gastos pagados', f(c.pagado), f(c.trasPagados), { rojo: true, on: abrirGastos, srojo: c.trasPagados < 0 })}
        {M.actual && ln('−', `Gastos por pagar al ${String(new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate())}-${ym.slice(5, 7)}`, f(c.porPagar), f(c.saldo), { rojo: true, on: abrirGastos, srojo: c.saldo < 0 })}
        {M.actual ? ln('=', c.falta > 0 ? 'Falta por cubrir' : 'Gastos cubiertos', c.falta > 0 ? f(c.falta) : f(c.saldo), '', { tot: true, on: abrirGastos }) : ln('=', 'Resultado de caja', f(c.trasPagados), '', { tot: true })}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: D ? '10px 16px' : '9px 12px', borderTop: `1px solid ${C.border}` }}>
          {chip(c.cubrePagados ? '✓ Gastos pagados cubiertos' : 'Gastos pagados sin cubrir', c.cubrePagados ? C.greenBg : C.soonBg, c.cubrePagados ? C.greenText : C.soonText)}
          {M.actual && c.falta > 0 && chip('Por cubrir con cobros del mes', C.soonBg, C.soonText)}
          {nSin > 0 && chip(`${nSin} cargo${nSin !== 1 ? 's' : ''} sin clasificar`, C.soonBg, C.soonText, abrirGastos)}</div></>}
    </div>
    <div style={card}>
      {tit('Gastos del mes', `${M.pagadosFilas.length + M.porPagarFilas.length} movimientos · ${f(totGastos)}`, ab.gas, () => setAb(a => ({ ...a, gas: !a.gas })))}
      {ab.gas && <>{M.pagadosFilas.map((x, i) => fila(x, false, i))}{M.porPagarFilas.map((x, i) => fila(x, true, i))}
        {!M.pagadosFilas.length && !M.porPagarFilas.length && <div style={{ padding: 16, fontSize: 12.5, color: C.muted, borderTop: `1px solid ${C.border}` }}>Sin gastos en el mes.</div>}
        {ln('=', `Total ${MESES[Number(ym.slice(5, 7)) - 1]}`, f(totGastos), '', { tot: true, on: () => onOpenEstado && onOpenEstado(ym) })}</>}
    </div>
  </div>
}
