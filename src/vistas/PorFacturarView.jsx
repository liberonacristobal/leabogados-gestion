// Por facturar: de la cifra de la tarjeta de Facturación a lo realmente cobrable, en partidas que suman al peso (vigente, por confirmar, fuera).
// No calcula nada propio: lee clasificarPorFacturar (_shared/porFacturar.js), la misma regla que usa el flujo de caja para los anticipos y la
// cobertura de cuotas. Del lado conservador: lo dudoso nunca queda en «Vigente».
import { Fragment, useMemo, useState } from 'react'
import { C, SIcon, fmt, fmtFechaDMY, folioN, appAlert, appConfirm, useIsDesktop } from '../lib/base.jsx'
import { PageHeader, PaginaSobre, useNoEmitirSet, useUFFechas, usePorSocioFuentes, matchProgEmitidas, socioDe, SIN_SOCIO, guardarDecisionCuota } from '../lib/compartido.jsx'
import { clasificarPorFacturar, cuadreVenta, GRUPOS } from '../../supabase/functions/_shared/porFacturar.js'

const fmtM = v => '$' + (v / 1e6).toFixed(1).replace('.', ',') + 'M'
// Cuatro partidas, nada más; el motivo es la etiqueta de cada fila (_shared/porFacturar.js).
const ROT = { vencida: ['Vencidas', 'por emitir'], porVencer: ['Este mes y después', ''], porConfirmar: ['Por confirmar', 'espera al abogado'], fuera: ['Fuera', 'ya explicado'] }
const MOTIVO = { cubFactura: 'cubierta por factura', cubAnticipo: 'cubierta por anticipo', noCorresponde: 'no corresponde', pausada: 'pausada', sinMovimiento: 'más de 90 días sin movimiento', saldoCuota: 'saldo de una cuota facturada en parte', recurrente: 'mensual' }
const PORQUE = {
  vencida: 'Venció en un mes ya cerrado y aún no se emite.', porVencer: 'Vence este mes o más adelante.',
  sinMovimiento: 'Venció hace más de 90 días y su venta no tiene facturas ni pagos en ese plazo. Queda fuera del flujo hasta que el abogado responsable lo confirme.',
  saldoCuota: 'La cuota se dio por cubierta con una factura menor. El saldo queda fuera del flujo hasta confirmarlo.',
  cubFactura: 'La cuota está cubierta por lo ya facturado en su venta.', cubAnticipo: 'Un anticipo disponible ya cubrió la cuota: falta emitir la factura.',
  noCorresponde: 'Se marcó «No corresponde».', pausada: 'La cuota está pausada.',
}
const primeroDelMesSiguiente = hoy => { const d = new Date(hoy + 'T12:00:00'); d.setMonth(d.getMonth() + 1, 1); return d.toISOString().slice(0, 10) }

function DetalleCuota({ f, filas, sales, bb, ufFechas, nombre, hoy, onClose, onGuardado, onOpenVenta, onOpenFactura, onOpenClientFicha }) {
  const [accion, setAccion] = useState(null)
  const [fecha, setFecha] = useState(primeroDelMesSiguiente(hoy))
  const [factura, setFactura] = useState('')
  const [guardando, setGuardando] = useState(false)
  const b = f.b, sale = (sales || []).find(x => String(x.id) === String(b.sale_id))
  const bs = bb.filter(x => String(x.sale_id) === String(b.sale_id))
  const emitidas = bs.filter(x => x.invoice_no && x.status !== 'Anulada').sort((x, y) => String(y.issued_at || '').localeCompare(String(x.issued_at || '')))
  const cuadre = useMemo(() => sale ? cuadreVenta(sale, bs, ufFechas || {}) : null, [sale, bs, ufFechas])
  const propias = filas.filter(x => x.id === f.id)
  const cubierto = propias.filter(x => ['cubFactura', 'cubAnticipo'].includes(x.motivo)).reduce((a, x) => a + x.monto, 0), saldo = propias.filter(x => x.motivo === 'saldoCuota').reduce((a, x) => a + x.monto, 0)
  const u = v => cuadre && cuadre.enUF ? `${v.toFixed(1).replace('.', ',')} UF` : fmt(v)
  const tono = cuadre ? ({ Cuadra: C.greenText, Tolerancia: C.soonText, Sobra: C.overdueText, Falta: C.overdueText })[cuadre.estado] : C.muted
  const concepto = String(b.concept || '').replace(/^.*? — /, '')
  const decidible = f.k !== 'fuera'
  const box = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }
  const cap = t => <div style={{ padding: '11px 14px 7px', fontSize: 10, fontWeight: 700, letterSpacing: .5, textTransform: 'uppercase', color: C.accent }}>{t}</div>
  const kv = (l, v, s2, col) => <div style={{ minWidth: 0 }}><div style={{ fontSize: 10, fontWeight: 700, letterSpacing: .5, textTransform: 'uppercase', color: C.accent }}>{l}</div><div style={{ fontSize: 16, fontWeight: 800, color: col || C.accent, whiteSpace: 'nowrap' }}>{v}</div>{s2 ? <div style={{ fontSize: 11, color: C.muted }}>{s2}</div> : null}</div>
  const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10, padding: '4px 14px 14px' }
  const guardar = async (a, msg, extra = {}) => {
    if (!(await appConfirm({ message: msg }))) return
    setGuardando(true)
    try { await guardarDecisionCuota({ cuotaId: b.id, accion: a, titulo: `${nombre} · ${concepto}`, ...extra }); onGuardado(a, extra) }
    catch (e) { appAlert('No se pudo guardar: ' + (e?.message || e)); setGuardando(false) }
  }
  const btn = (on) => ({ border: `1px solid ${on ? C.accent : C.border}`, background: on ? C.azulBg : C.surface, color: C.accent, borderRadius: 10, padding: '9px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', textAlign: 'left', minWidth: 0 })
  return (
    <PaginaSobre origen='Por facturar' titulo={nombre} ctx={concepto} onBack={onClose} maxW={720}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 60 }}>
        <div style={box}>{cap('Cuota')}{sale && sale.title ? <div style={{ padding: '0 14px 2px', fontSize: 13, fontWeight: 700, color: C.text, overflowWrap: 'anywhere' }}>{sale.title}</div> : null}<div style={grid}>
          {kv('Monto', fmt(b.amount))}{kv('Vence', fmtFechaDMY(b.due))}{kv('Partida', ROT[f.k][0] + (f.motivo ? ' · ' + MOTIVO[f.motivo] : ''))}
          {cubierto > 0 && kv('Cubierto', fmt(cubierto))}{saldo > 0 && kv('Saldo', fmt(saldo), 'por confirmar', C.soonText)}
        </div><div style={{ padding: '0 14px 12px', fontSize: 12, color: C.textSoft }}>{PORQUE[f.motivo] || PORQUE[f.k]}</div></div>
        {cuadre && <div style={box}>{cap('Cuadre de la venta')}<div style={grid}>
          {kv('Plan', u(cuadre.plan))}{kv('Facturado', u(cuadre.facturado))}{kv('En cuotas', u(cuadre.enCuotas))}{kv('Estado', cuadre.estado, Math.abs(cuadre.diferencia) > 0.0001 ? (cuadre.diferencia > 0 ? 'sobra ' : 'falta ') + u(Math.abs(cuadre.diferencia)) : '', tono)}
        </div></div>}
        <div style={box}>{cap('Facturas de la venta')}
          {emitidas.length === 0 && <div style={{ padding: '12px 14px', fontSize: 12.5, color: C.muted, borderTop: `1px solid ${C.border}` }}>La venta no tiene facturas emitidas.</div>}
          {emitidas.map(x => <div key={x.id} onClick={onOpenFactura ? () => onOpenFactura(x) : undefined} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 14px', borderTop: `1px solid ${C.border}`, cursor: onOpenFactura ? 'pointer' : 'default' }}>
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 700, color: C.accent }}>Factura N° {folioN(x.invoice_no) || '—'}</div><div style={{ fontSize: 11, color: C.muted, overflowWrap: 'anywhere' }}>{fmtFechaDMY(x.issued_at)} · {String(x.concept || '').slice(0, 60)} · {x.status}</div></div>
            <span style={{ fontSize: 13, fontWeight: 800, color: C.accent, whiteSpace: 'nowrap' }}>{fmt(x.amount)}</span>
          </div>)}
          <div style={{ display: 'flex', gap: 14, padding: '10px 14px', borderTop: `1px solid ${C.border}`, fontSize: 12, fontWeight: 700 }}>
            {onOpenVenta && b.sale_id && <span onClick={() => onOpenVenta(b.sale_id)} style={{ color: C.azulInfo, cursor: 'pointer' }}>Ver la venta →</span>}
            {onOpenClientFicha && <span onClick={() => onOpenClientFicha(b.client_id)} style={{ color: C.azulInfo, cursor: 'pointer' }}>Ver el cliente →</span>}
          </div>
        </div>
        {decidible && <div style={box}>{cap('Decisión')}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 8, padding: '4px 14px 12px' }}>
            <div style={btn(accion === 'fecha')} onClick={() => setAccion('fecha')}>Vigente, con nueva fecha<div style={{ fontSize: 11, fontWeight: 500, color: C.muted }}>Mueve el vencimiento.</div></div>
            <div style={btn(false)} onClick={() => guardar('baja', `Marcar «No corresponde» la cuota ${concepto} de ${nombre} por ${fmt(b.amount)}. Sale de Por facturar y del flujo.`)}>Dar de baja<div style={{ fontSize: 11, fontWeight: 500, color: C.muted }}>Queda «No corresponde».</div></div>
            <div style={btn(accion === 'facturada')} onClick={() => setAccion('facturada')}>Ya facturada<div style={{ fontSize: 11, fontWeight: 500, color: C.muted }}>Elegir la factura.</div></div>
          </div>
          {accion === 'fecha' && <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '10px 14px 14px', borderTop: `1px solid ${C.border}` }}>
            <input type='date' value={fecha} min={hoy} onChange={e => setFecha(e.target.value)} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '7px 10px', fontSize: 13, color: C.accent, fontWeight: 700 }} />
            <button disabled={guardando || !fecha || fecha < hoy} onClick={() => guardar('fecha', `Mover el vencimiento de ${concepto} de ${nombre} al ${fmtFechaDMY(fecha)}.`, { due: fecha })} style={{ ...btn(true), background: C.accent, color: '#fff', opacity: guardando || !fecha || fecha < hoy ? .5 : 1 }}>Guardar fecha</button>
          </div>}
          {accion === 'facturada' && <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '10px 14px 14px', borderTop: `1px solid ${C.border}` }}>
            <select value={factura} onChange={e => setFactura(e.target.value)} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '7px 10px', fontSize: 13, color: C.accent, maxWidth: '100%' }}>
              <option value=''>Elegir factura…</option>
              {emitidas.map(x => <option key={x.id} value={x.id}>N° {folioN(x.invoice_no) || '—'} · {fmtFechaDMY(x.issued_at)} · {fmt(x.amount)}</option>)}
            </select>
            <button disabled={guardando || !factura} onClick={() => guardar('facturada', `Marcar la cuota ${concepto} de ${nombre} como ya facturada. Sale de Por facturar y del flujo.`, { facturaId: factura })} style={{ ...btn(true), background: C.accent, color: '#fff', opacity: guardando || !factura ? .5 : 1 }}>Guardar</button>
            {emitidas.length === 0 && <span style={{ fontSize: 12, color: C.muted }}>La venta no tiene facturas emitidas: ábrela para vincularla.</span>}
          </div>}
          <div style={{ padding: '0 14px 12px', fontSize: 11.5, color: C.textSoft }}>La respuesta se guarda y no se vuelve a preguntar.</div>
        </div>}
      </div>
    </PaginaSobre>)
}

export function PorFacturarView({ anio = '', partidaInicial = null, onOpenAdelantos, billing = [], sales = [], clients = [], clientEntities = [], anticipos = [], fantasmaIds = null, origen = 'Facturación', onBack, onOpenClientFicha, onOpenVenta, onOpenFactura, setBilling }) {
  const isDesktop = useIsDesktop()
  const noEmitir = useNoEmitirSet()
  const bb = useMemo(() => (billing || []).filter(b => !b.deleted_at && !(fantasmaIds && fantasmaIds.has(String(b.id)))), [billing, fantasmaIds])
  const ufFechas = useUFFechas(bb)
  const [fuentes] = usePorSocioFuentes()
  const hoy = new Date().toISOString().slice(0, 10)
  const [socio, setSocio] = useState('Todos')
  const [partida, setPartida] = useState(partidaInicial || 'vencida')
  const [detalle, setDetalle] = useState(null)
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
  const porSocio = ['Todos', 'Cristóbal', 'Erasmo', SIN_SOCIO].map(s => [s, R.filas.filter(f => GRUPOS.vigente.includes(f.k) && (s === 'Todos' || f.socio === s)).reduce((a, f) => a + f.monto, 0)])   // lo vigente de cada socio
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
  const partidaRow = k => { const [a, b] = ROT[k]; const n = cuenta([k]); return <Fragment key={k}>{fila(k === 'vencida' || k === 'porVencer' ? '+' : '+', a, `${b ? b + ' · ' : ''}${n} cuota${n !== 1 ? 's' : ''}`, fmtM(suma([k])), { chev: true, onClick: () => setPartida(k) })}</Fragment> }
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
          {['vencida', 'porVencer', 'porConfirmar', 'fuera'].map(k => partidaRow(k))}
          {fila('=', 'Por facturar', '', fmtM(total), { tot: true })}
        </div>
        <div style={box}>
          {cap(`${ROT[partida][0]}${ROT[partida][1] ? ' · ' + ROT[partida][1] : ''} · ${cuenta([partida])} cuota${cuenta([partida]) !== 1 ? 's' : ''} · ${fmtM(suma([partida]))}`)}
          {partida === 'fuera' && onOpenAdelantos && filas.some(f => f.motivo === 'cubAnticipo') && <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 14px', borderTop: `1px solid ${C.border}`, fontSize: 12, color: C.muted }}><span style={{ flex: 1, minWidth: 180 }}>La plata ya entró. Falta emitir la factura.</span><span onClick={onOpenAdelantos} style={{ fontWeight: 700, color: C.azulInfo, cursor: 'pointer', whiteSpace: 'nowrap' }}>Ir a Facturar adelantos →</span></div>}
          {lista.length === 0 && <div style={{ padding: '18px 14px', textAlign: 'center', color: C.muted, fontSize: 13, borderTop: `1px solid ${C.border}` }}>Sin cuotas en esta partida.</div>}
          {lista.map(g => g.items.map((f, i) => (
            <div key={f.id + f.k} onClick={() => setDetalle(f)} style={{ display: 'flex', gap: 11, alignItems: 'center', padding: '10px 14px', borderTop: `1px solid ${C.border}`, cursor: 'pointer' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.accent }}><span onClick={onOpenClientFicha ? e => { e.stopPropagation(); onOpenClientFicha(g.cid) } : undefined} style={{ cursor: onOpenClientFicha ? 'pointer' : 'default' }}>{nombre(g.cid)}</span></div>
                <div style={{ fontSize: 11, color: C.muted, overflowWrap: 'anywhere' }}>{String(f.b.concept || '').replace(/^.*? — /, '')} · vence {fmtFechaDMY(f.b.due)}{f.motivo ? ` · ${MOTIVO[f.motivo]}` : ''}</div>
              </div>
              <span style={{ fontSize: 14, fontWeight: 800, color: C.accent, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmt(f.monto)}</span>
              <span style={{ color: C.done, display: 'flex' }}><SIcon n='chevron' s={10} c={C.done} /></span>
            </div>)))}
        </div>
        {detalle && <DetalleCuota f={detalle} filas={R.filas} sales={sales} bb={bb} ufFechas={ufFechas} nombre={nombre(detalle.b.client_id)} hoy={hoy} onClose={() => setDetalle(null)} onOpenVenta={onOpenVenta} onOpenFactura={onOpenFactura} onOpenClientFicha={onOpenClientFicha}
          onGuardado={(a, x) => { if (a === 'fecha' && setBilling) setBilling(p => p.map(r => String(r.id) === String(detalle.b.id) ? { ...r, due: x.due } : r)); setDetalle(null) }} />}
        <div style={{ fontSize: 12, color: C.textSoft }}>Parte de la tarjeta «Por facturar» y cada línea suma al peso. Lo dudoso queda fuera de «Vigente».</div>
      </div>
    </div>)
}
