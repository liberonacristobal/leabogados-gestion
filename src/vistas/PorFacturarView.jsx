// Por facturar: de la cifra de la tarjeta de Facturación a lo realmente cobrable, en partidas que suman al peso (vigente, por confirmar, fuera).
// No calcula nada propio: lee clasificarPorFacturar (_shared/porFacturar.js), la misma regla que usa el flujo de caja para los anticipos y la
// cobertura de cuotas. Del lado conservador: lo dudoso nunca queda en «Vigente».
import { Fragment, useMemo, useState } from 'react'
import { C, Gl, SIcon, fmt, fmtFechaDMY, useIsDesktop } from '../lib/base.jsx'
import { PageHeader, useNoEmitirSet, useUFFechas, usePorSocioFuentes, matchProgEmitidas, socioDe, SIN_SOCIO } from '../lib/compartido.jsx'
import { clasificarPorFacturar, GRUPOS } from '../../supabase/functions/_shared/porFacturar.js'

const fmtM = v => '$' + (v / 1e6).toFixed(1).replace('.', ',') + 'M'
const ROT = {
  vencida: ['Vencidas', 'por emitir'], mesActual: ['Mes actual', ''], mesSiguiente: ['Mes siguiente', ''], masAdelante: ['Más adelante', ''], recurrente: ['Recurrentes', 'mensuales'],
  porConfirmar: ['Por confirmar', 'más de 90 días sin movimiento'], saldoCuota: ['Saldo de cuota', 'facturada en parte'],
  cubFactura: ['Cubiertas', 'por factura'], cubAnticipo: ['Cubiertas', 'por anticipo'], noCorresponde: ['No corresponde', ''], pausada: ['Pausadas', ''],
}
const GRUPO_ROT = { vigente: 'Vigente', porConfirmar: 'Por confirmar', fuera: 'Fuera' }

export function PorFacturarView({ anio = '', billing = [], sales = [], clients = [], clientEntities = [], anticipos = [], fantasmaIds = null, origen = 'Facturación', onBack, onOpenClientFicha, onOpenVenta }) {
  const isDesktop = useIsDesktop()
  const noEmitir = useNoEmitirSet()
  const bb = useMemo(() => (billing || []).filter(b => !b.deleted_at && !(fantasmaIds && fantasmaIds.has(String(b.id)))), [billing, fantasmaIds])
  const ufFechas = useUFFechas(bb)
  const [fuentes] = usePorSocioFuentes()
  const hoy = new Date().toISOString().slice(0, 10)
  const [socio, setSocio] = useState('Todos')
  const [abiertos, setAbiertos] = useState(() => new Set(['vigente']))
  const [partida, setPartida] = useState('vencida')
  const saleById = useMemo(() => Object.fromEntries((sales || []).map(s => [String(s.id), s])), [sales])
  const cliById = useMemo(() => Object.fromEntries((clients || []).map(c => [String(c.id), c])), [clients])
  const nombre = id => (cliById[String(id)] || {}).name || 'Sin cliente'
  const R = useMemo(() => {
    const yaFacturadas = new Set(matchProgEmitidas(bb, clients, clientEntities, { sales }).map(m => String(m.prog.id)))
    return clasificarPorFacturar({ billing: bb, sales, anticipos, uf: ufFechas || {}, noEmitir, yaFacturadas, hoy, socioDe: b => socioDe(b, { saleById, cliById, ov: fuentes.ov || {} }), anio })
  }, [anio, bb, sales, clients, clientEntities, anticipos, ufFechas, noEmitir, hoy, saleById, cliById, fuentes])
  const filas = R.filas.filter(f => socio === 'Todos' || f.socio === socio)
  const suma = ks => filas.filter(f => ks.includes(f.k)).reduce((a, f) => a + f.monto, 0)
  const cuenta = ks => new Set(filas.filter(f => ks.includes(f.k)).map(f => f.id)).size
  const total = filas.reduce((a, f) => a + f.monto, 0)
  const porSocio = ['Todos', 'Cristóbal', 'Erasmo', SIN_SOCIO].map(s => [s, R.filas.filter(f => GRUPOS.vigente.includes(f.k) && (s === 'Todos' || f.socio === s)).reduce((a, f) => a + f.monto, 0)])
  const tog = k => setAbiertos(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const lista = useMemo(() => {
    const g = new Map()
    filas.filter(f => f.k === partida).sort((a, b) => String(a.b.due || '').localeCompare(String(b.b.due || ''))).forEach(f => { const k = String(f.b.client_id); if (!g.has(k)) g.set(k, { cid: k, items: [], total: 0 }); const x = g.get(k); x.items.push(f); x.total += f.monto })
    return [...g.values()].sort((a, b) => b.total - a.total)
  }, [filas, partida])
  const pad = isDesktop ? '14px' : '12px 10px'
  const box = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }
  const cap = t => <div style={{ padding: '11px 14px 7px', fontSize: 10, fontWeight: 700, letterSpacing: .5, textTransform: 'uppercase', color: C.accent }}>{t}</div>
  const fila = (sg, label, nota, val, { onClick, chev, tot, sub } = {}) => (
    <div onClick={onClick} style={{ display: 'grid', gridTemplateColumns: sub ? '110px minmax(0,1fr) auto 10px' : '16px minmax(0,1fr) auto 10px', columnGap: 8, alignItems: 'center', padding: sub ? '7px 14px 7px 28px' : '10px 14px', background: tot || sub ? C.bgSoft : 'transparent', borderTop: `1px solid ${C.border}`, cursor: onClick ? 'pointer' : 'default', fontSize: sub ? 12 : 13 }}>
      <span style={{ textAlign: sub ? 'left' : 'center', fontWeight: 700, color: tot ? C.accent : C.muted, fontSize: sub ? 11.5 : 13, whiteSpace: 'nowrap' }}>{sg}</span>
      <span style={{ minWidth: 0, overflowWrap: 'anywhere', fontWeight: sub ? 500 : 700, color: tot ? C.accent : (sub ? C.text : C.accent) }}>{label}{nota ? <span style={{ fontSize: 11, color: C.muted, fontWeight: 500, marginLeft: 8 }}>{nota}</span> : null}</span>
      <span style={{ fontWeight: 800, color: C.accent, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{val}</span>
      <span style={{ color: C.done, display: 'flex' }}>{chev === 'd' ? <SIcon n='chevD' s={11} c={C.done} /> : chev === 'u' ? <SIcon n='chevU' s={11} c={C.done} /> : chev ? <SIcon n='chevron' s={10} c={C.done} /> : null}</span>
    </div>)
  const partidaRow = k => { const [a, b] = ROT[k]; return <Fragment key={k}>{fila(a, b || `${cuenta([k])} cuota${cuenta([k]) !== 1 ? 's' : ''}`, b ? `${cuenta([k])} cuota${cuenta([k]) !== 1 ? 's' : ''}` : '', fmtM(suma([k])), { sub: true, chev: true, onClick: () => setPartida(k) })}</Fragment> }
  return (
    <div>
      <PageHeader origen={origen} onBack={onBack} titulo='Por facturar' ctx={`al ${fmtFechaDMY(hoy)}${anio ? ' · vencen en ' + anio : ''}`} />
      <div style={{ maxWidth: isDesktop ? 900 : 760, margin: '0 auto', padding: '14px 16px 80px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ ...box, padding: pad, display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ width: isDesktop ? 34 : 30, height: isDesktop ? 34 : 30, borderRadius: 8, background: C.bgSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><SIcon n='clock' s={17} c={C.accent} /></span>
          <div><div style={{ fontSize: isDesktop ? 11 : 10, fontWeight: 700, letterSpacing: .5, textTransform: 'uppercase', color: C.accent }}>Por facturar</div>
            <div style={{ fontSize: isDesktop ? 26 : 20, fontWeight: 800, letterSpacing: '-.6px', color: C.accent, fontVariantNumeric: 'tabular-nums' }}>{fmtM(total)}</div></div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {porSocio.map(([s, v]) => <span key={s} onClick={() => setSocio(s)} style={{ border: `1px solid ${socio === s ? C.accent : C.border}`, background: socio === s ? C.azulBg : C.surface, color: socio === s ? C.accent : C.muted, borderRadius: 20, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>{s === 'Todos' ? 'Todos' : `${s} · ${fmtM(v)}`}</span>)}
        </div>
        <div style={box}>
          {cap('Del total a lo cobrable')}
          {fila('+', 'Vigente', '', fmtM(suma(GRUPOS.vigente)), { chev: abiertos.has('vigente') ? 'u' : 'd', onClick: () => tog('vigente') })}
          {abiertos.has('vigente') && GRUPOS.vigente.map(partidaRow)}
          {fila('+', 'Por confirmar', `${cuenta(GRUPOS.porConfirmar)} cuota${cuenta(GRUPOS.porConfirmar) !== 1 ? 's' : ''}`, fmtM(suma(GRUPOS.porConfirmar)), { chev: abiertos.has('porConfirmar') ? 'u' : 'd', onClick: () => tog('porConfirmar') })}
          {abiertos.has('porConfirmar') && GRUPOS.porConfirmar.map(partidaRow)}
          {fila('+', 'Fuera', '', fmtM(suma(GRUPOS.fuera)), { chev: abiertos.has('fuera') ? 'u' : 'd', onClick: () => tog('fuera') })}
          {abiertos.has('fuera') && GRUPOS.fuera.map(partidaRow)}
          {fila('=', 'Por facturar', '', fmtM(total), { tot: true })}
        </div>
        <div style={box}>
          {cap(`${ROT[partida][0]}${ROT[partida][1] ? ' · ' + ROT[partida][1] : ''} · ${cuenta([partida])} cuota${cuenta([partida]) !== 1 ? 's' : ''} · ${fmtM(suma([partida]))}`)}
          {lista.length === 0 && <div style={{ padding: '18px 14px', textAlign: 'center', color: C.muted, fontSize: 13, borderTop: `1px solid ${C.border}` }}>Sin cuotas en esta partida.</div>}
          {lista.map(g => g.items.map((f, i) => (
            <div key={f.id + f.k} onClick={onOpenVenta && f.b.sale_id ? () => onOpenVenta(f.b.sale_id) : undefined} style={{ display: 'flex', gap: 11, alignItems: 'center', padding: '10px 14px', borderTop: `1px solid ${C.border}`, cursor: onOpenVenta ? 'pointer' : 'default' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.accent }}><span onClick={onOpenClientFicha ? e => { e.stopPropagation(); onOpenClientFicha(g.cid) } : undefined} style={{ cursor: onOpenClientFicha ? 'pointer' : 'default' }}>{nombre(g.cid)}</span></div>
                <div style={{ fontSize: 11, color: C.muted, overflowWrap: 'anywhere' }}>{String(f.b.concept || '').replace(/^.*? — /, '')} · vence {fmtFechaDMY(f.b.due)}</div>
              </div>
              <span style={{ fontSize: 14, fontWeight: 800, color: C.accent, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmt(f.monto)}</span>
              <span style={{ color: C.done, display: 'flex' }}><SIcon n='chevron' s={10} c={C.done} /></span>
            </div>)))}
        </div>
        <div style={{ fontSize: 12, color: C.textSoft }}>Parte de la tarjeta «Por facturar» y cada línea suma al peso. Lo dudoso queda fuera de «Vigente».</div>
      </div>
    </div>)
}
