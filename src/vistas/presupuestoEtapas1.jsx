// Presupuesto anual · etapas 1 a 3: Mirada a 2026, Base y Costos. Todo dato abre su detalle (ir y volver al lugar exacto).
import { C, fmtFechaDMY } from '../lib/base.jsx'
import { mesesAtipicos, COMPONENTES, afavor, cadenaMeta, valorComponente, monto27, fijarMonto27, fijarAlza, costoAnualBase, reajusteVigente } from '../../supabase/functions/_shared/presupuesto.js'
import { nf, mm, mx, m26, mp, mxP, ufs, pc, sgn, MESL, MESC, Mini, Titulo, Panel, Seg, Chip, Btn, Lnk, Fld, FldDin, Stp, Fila, Val, Lista, Grid, Tarjeta, Flecha, monedaActual, tasa27, tasa26, difMon } from '../lib/presupuestoUI.jsx'
import { Cmp, SociosBloque } from '../lib/presupuestoBloques.jsx'
import { TONO_COMP, detalleReferencia } from './presupuestoMetas.jsx'

const ym = (y, i) => `${y}-${String(i + 1).padStart(2, '0')}`

// ── 1 · Mirada a 2026 ──
export function Mirada({ X }) {
  const { datos: d, est, D, ui, setUI, ir } = X, o = d.oficiales, uf = est.moneda === 'uf'
  const Y = d.anioBase, H = Number(d.hoy.slice(5, 7)) - 1
  const serie = (y, i) => d.serie[ym(y, i)]
  const meses = Array.from({ length: 12 }, (_, i) => ({ i, f: i <= H ? serie(Y, i) : null, a: serie(Y - 1, i), cob: i <= H ? d.cobMes[ym(Y, i)] ?? null : null }))
  const fv = (x) => (uf ? x.facUF : x.fac)
  const atip = new Set(mesesAtipicos(meses.map((m) => (m.f && m.i < H ? m.f.fac : null))))
  const r5 = d.clientes.slice(0, 5).reduce((a, c) => a + c.monto, 0), conc = d.totalFact ? r5 / d.totalFact : 0
  const rec = d.recurrente, recMes = rec.anualCLP / 12
  // Orden por lo que mueve el resultado (modelo del Presupuesto, escenario Base): +1 punto de comisiones resta ~4 veces más a los retiros que +10 días de cobro; lo recurrente y la concentración no son palancas del modelo (base de ingreso casi seguro y riesgo, en ese orden).
  const indic = [
    ['com', 'Comisiones', d.terc != null ? pc(d.terc) : 'sin dato', 'de lo cobrado en el año', '', 'terc'],
    ['horas', 'Días de cobro', d.dias.promedio != null ? d.dias.promedio + ' días' : 'sin dato', d.dias.n ? `promedio · mediana ${d.dias.mediana}` : 'sin facturas pagadas', '', 'dias'],
    ['cal', 'Recurrente mensual', mx(recMes, rec.anualUF / 12), `${rec.n} ventas mensuales activas`, '', 'rec'],
    ['pers', 'Concentración', pc(conc * 100, 0), `5 de ${d.clientes.length} · ene–${MESC[H]}`, 'amb', 'conc'],
  ]
  const mas = [
    ['egr', 'Costos de oficina', m26(d.costos.reduce((a, c) => a + c.m, 0) + d.ppmMes), 'por mes vigente, con PPM', '', 'cost'],
    ['alerta', 'Conversión de propuestas', 'sin dato', 'el índice de propuestas no tiene registros', 'amb', 'conv'],
  ]
  // Seis tarjetas de solo lectura, una por componente (los mismos nombres, tonos e íconos de los pasos 2 y 4). Cada cifra en la moneda elegida, con la UF de su fuente.
  const nSoc = d.retiros26.socios.length || 1, c26 = d.costos26, r26 = d.referencia, RU = d.refUF
  const cumple = (real, meta, realU, metaU) => { if (!(meta > 0)) return <span>Sin meta</span>; const x = difMon(real, meta, realU, metaU); return <><Flecha sube={real >= meta} bueno={real >= meta}>{pc((real / meta) * 100, 0)}</Flecha><Flecha sube={real >= meta} bueno={real >= meta}>{x.sg}{x.abs}</Flecha></> }
  const enUF = (c) => (monedaActual() === 'clp' ? [['En UF', 'UF ' + nf.format(Math.round(c.uf))]] : [])
  const hastaC = c26.hasta ? MESC[Number(c26.hasta.slice(5, 7)) - 1] : null
  const dMin = d.retiros26.desde, dMax = d.retiros26.hasta, mVU = d.metaVentasUF > 0 ? d.metaVentasUF : null
  const T = Object.fromEntries(COMPONENTES.map(([k, n]) => [k, TONO_COMP[k]]))
  const tarjetas26 = COMPONENTES.map(([k, nombre]) => {
    const [tono, ic] = T[k]
    const base = { tono, ic, label: nombre, aria: nombre }
    if (k === 'ventas') return <Tarjeta key={k} {...base} izq={{ cap: `Real ${Y}`, val: mx(o.vend.clp, o.vend.uf) }} der={{ cap: `Meta ${Y}`, val: o.metaVentasCLP > 0 ? mx(o.metaVentasCLP, mVU) : 'Sin meta' }} cmp={cumple(o.vend.clp, o.metaVentasCLP, o.vend.uf, mVU)} det={[...enUF(o.vend), ['Plano', 'ventas activas y terminadas del año, netas de costos de terceros']]} onClick={() => ir({ drill: { t: 'ind', k: 'vend' } })} />
    if (k === 'fact') return <Tarjeta key={k} {...base} izq={{ cap: `Real ${Y}`, val: mx(o.fact.clp, o.fact.uf) }} der={{ cap: 'De lo vendido', val: o.vend.clp > 0 ? pc((o.fact.clp / o.vend.clp) * 100, 0) : '—' }} cmp={<span>Sin meta propia</span>} det={[...enUF(o.fact), ['Plano', 'facturas emitidas con folio']]} onClick={() => ir({ drill: { t: 'ind', k: 'fact26' } })} />
    if (k === 'caja') return <Tarjeta key={k} {...base} izq={{ cap: `Real ${Y}`, val: mx(o.cob.clp, o.cob.uf) }} der={{ cap: `Meta ${Y}`, val: o.metaCobroCLP > 0 ? m26(o.metaCobroCLP) : 'Sin meta' }} cmp={cumple(o.cob.clp, o.metaCobroCLP, o.cob.uf, null)} det={[...enUF(o.cob), ['Plano', 'caja, por conciliación bancaria']]} onClick={() => ir({ drill: { t: 'ind', k: 'cob26' } })} />
    if (k === 'costos') return <Tarjeta key={k} {...base} izq={{ cap: hastaC ? `Real ene–${hastaC} ≈` : 'Real ≈', val: mx(c26.real, c26.realUF) }} der={{ cap: hastaC ? `Presupuesto ene–${hastaC}` : 'Presupuesto', val: mx(c26.ppto, c26.pptoUF) }} cmp={c26.ppto > 0 ? (() => { const x = difMon(c26.real, c26.ppto, c26.realUF, c26.pptoUF); return <Flecha sube={x.sube} bueno={afavor('costos', x.sube)}>{x.sg}{x.abs} · {x.sg}{pc(Math.abs(x.pct))}</Flecha> })() : <span>—</span>} det={[['Desvío', 'real contra el presupuesto de los mismos meses'], ['Real', 'costos de operación de Resultado del año, por confirmar'], ['Presupuesto del año', mx(c26.ppto + c26.pptoResto, c26.pptoUF + c26.pptoRestoUF)]]} onClick={() => ir({ drill: { t: 'ind', k: 'cost' } })} />
    if (k === 'margen') return <Tarjeta key={k} {...base} izq={{ cap: `Real ${Y}`, val: mx(o.marg.clp, o.marg.uf) }} der={{ cap: 'En caja ≈', val: mx(r26.margen.aFecha, RU.margen.aFecha) }} cmp={<span>{o.marg.pct != null ? pc(o.marg.pct, 0) + ' de ingresos' : '—'}</span>} det={[...enUF(o.marg), ['Real', 'devengado, como en Inicio'], ['En caja', 'cobrado − comisiones − costos; estimación propia']]} onClick={() => ir({ drill: { t: 'ind', k: 'marg' } })} />
    return <Tarjeta key={k} {...base} izq={{ cap: `Real ${Y}`, val: mx(d.retiros26.total, d.retiros26.totalUF) }} der={{ cap: 'Por socio', val: mx(d.retiros26.total / nSoc, d.retiros26.totalUF / nSoc) }} cmp={<span> </span>} det={[['Retiros', `${d.retiros26.n}${dMin ? ` · ${fmtFechaDMY(dMin)} a ${fmtFechaDMY(dMax)}` : ''}`], ['Plano', 'transferencias a los socios, como en la página Socios; por confirmar']]} onClick={() => ir({ drill: { t: 'ind', k: 'ret26' } })} />
  })
  const tile = (m) => {
    const x = m.f && m.a && fv(m.a) ? (fv(m.f) / fv(m.a) - 1) * 100 : null, at = atip.has(m.i)
    return <div key={m.i} onClick={() => ir({ drill: { t: 'mes', i: m.i } })} style={{ background: at ? C.soonBg : C.card, border: `1px solid ${at ? C.avisoLine : C.border}`, borderRadius: 12, padding: 12, cursor: 'pointer', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}><span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: C.accent }}>{D ? MESL[m.i] : MESC[m.i]}</span>{x == null ? <Chip tono='z'>—</Chip> : <Chip tono={x >= 0 ? 'g' : 'r'}>{sgn(x)}{pc(Math.abs(x), 0)}</Chip>}</div>
      <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.4, color: C.accent }}>{m.f ? <Val v={mx(m.f.fac, m.f.facUF)} /> : '—'}</div>
      <div style={{ fontSize: 11, color: C.muted }}>cobrado {m.cob != null ? mxP(m.cob, d.cobMesUF[ym(Y, m.i)]) : '—'}{m.i === H ? ' · a la fecha' : ''}</div>
      {at && <div style={{ fontSize: 10.5, fontWeight: 700, color: C.soonText }}>atípico</div>}
    </div>
  }
  return <>
    <Titulo right={<span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500, color: C.muted }}>al {fmtFechaDMY(d.hoy)}</span>}>Resultado del año {Y}</Titulo>
    <Grid cols={3} colsM={1}>{tarjetas26}</Grid>
    <div onClick={() => ir({ etapa: 3 })} role='button' style={{ fontSize: 12, fontWeight: 700, color: C.accent, margin: '-4px 4px 0', cursor: 'pointer', width: 'max-content', maxWidth: '100%' }}>Metas {d.anio} en el paso 4 ›</div>
    <SociosBloque X={X} solo26 ir={X.onOpenSocios} />
    <Titulo right={<Btn onClick={() => setUI({ mas: !ui.mas })}>{ui.mas ? 'Ver menos' : 'Ver más'}</Btn>}>Indicadores {Y}</Titulo>
    <Grid cols={4} colsM={2}>{indic.map(([ic, l, v, s, cl, k]) => <Mini key={k} ic={ic} label={l} value={v} sub={s} cls={cl} onClick={() => ir({ drill: { t: 'ind', k } })} />)}</Grid>
    {ui.mas && <Grid cols={4} colsM={2}>{mas.map(([ic, l, v, s, cl, k]) => <Mini key={k} ic={ic} label={l} value={v} sub={s} cls={cl} onClick={() => ir({ drill: { t: 'ind', k } })} />)}</Grid>}
    <Titulo right={<span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{atip.size > 0 && <Chip tono='y'>{atip.size} atípicos</Chip>}{D && <Seg options={[['tarjetas', 'Tarjetas'], ['tabla', 'Tabla']]} value={ui.vm} onChange={(v) => setUI({ vm: v })} />}</span>}>Mes a mes · {Y} contra {Y - 1}</Titulo>
    {ui.vm === 'tabla' && D
      ? <Panel><div style={{ display: 'grid', gridTemplateColumns: '120px repeat(12,minmax(0,1fr))', fontSize: 12 }}>
        <span />{MESC.map((m, i) => <span key={m} onClick={() => ir({ drill: { t: 'mes', i } })} style={{ padding: '9px 6px', textAlign: 'right', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.accent, cursor: 'pointer' }}>{m}</span>)}
        {[['Facturado ' + (Y - 1), (m) => (m.a ? <Val v={mx(m.a.fac, m.a.facUF)} /> : '—')], ['Facturado ' + Y, (m) => (m.f ? <Val v={mx(m.f.fac, m.f.facUF)} /> : '—')], ['Cobrado ' + Y, (m) => (m.cob != null ? <Val v={mx(m.cob, d.cobMesUF[ym(Y, m.i)])} /> : '—')]].map(([t, f]) => [<span key={t} style={{ padding: '10px 12px', borderTop: `1px solid ${C.border}` }}>{t}</span>, ...meses.map((m) => <span key={t + m.i} style={{ padding: '10px 6px', textAlign: 'right', borderTop: `1px solid ${C.border}` }}>{f(m)}</span>)])}
      </div></Panel>
      : <div style={{ display: 'grid', gridTemplateColumns: `repeat(${D ? 6 : 2},minmax(0,1fr))`, gap: 10 }}>{meses.map(tile)}</div>}
    <Panel hd={`Clientes que más facturaron · ${Y}`} small={`los 5 primeros suman ${pc(conc * 100, 0)}`}>
      {d.clientes.length === 0 ? <div style={{ padding: 16, fontSize: 13, color: C.muted }}>Aún no hay facturas emitidas este año.</div>
        : <div style={{ display: 'grid', gridTemplateColumns: D ? '1fr 1fr' : '1fr' }}>{d.clientes.slice(0, 8).map((c, i) => <div key={c.id} style={{ borderRight: D && i % 2 === 0 ? `1px solid ${C.border}` : 'none' }}><Fila nombre={<><span style={{ color: C.done, fontWeight: 700, fontSize: 12, marginRight: 8 }}>{i + 1}</span>{c.name}</>} peq={`${c.n} factura${c.n !== 1 ? 's' : ''} · ${pc((c.monto / d.totalFact) * 100)} de lo facturado`} valor={mx(c.monto, c.uf)} onClick={() => ir({ drill: { t: 'cli', n: c.id } })} /></div>)}</div>}
    </Panel>
  </>
}

// ── 2 · Base 2027 ──
export function Base({ X }) {
  const { datos: d, est, D, ui, setUI, ir, MT } = X
  const Y = d.anio, rec = d.recurrente, recAnual = rec.anualCLP
  const b = d.base, tot = b.baseCLP.reduce((a, x) => a + x, 0), totUF = b.baseUF.reduce((a, x) => a + x, 0)
  const origen = (i) => { const c = d.cierres.find((x) => Number(x.ym.slice(5, 7)) - 1 === i); return c ? c.ym.slice(0, 4) : '—' }
  // Seis tarjetas de solo lectura: el cierre 2026 estimado contra la base de {Y} (últimos 12 meses cerrados, sin crecimiento, con los supuestos del escenario Base).
  const ch0 = cadenaMeta(d.base, est, 0, MT.ratio)
  const tarjetasBase = COMPONENTES.map(([k, nombre]) => {
    const [tono, ic] = TONO_COMP[k], v = valorComponente(ch0, k, MT.ratio), ref = d.referencia[k]
    const ir1 = k === 'costos' ? () => X.irCostos() : k === 'margen' || k === 'retiros' ? () => X.irEscTab('imp') : () => ir({ etapa: 3 })
    const det = [['Base', 'sin crecimiento; no cambia con el escenario'], ...detalleReferencia(X, k), ...(k === 'ventas' ? [['Plano', MT.ratio != null ? `estimación propia: facturado ÷ ${pc(MT.ratio, 0)}` : 'falta la relación facturado/vendido']] : []), ...(k === 'costos' ? [['Cálculo', `presupuesto vigente + alza ${pc(est.p.base.alza)}`]] : [])]
    return <Tarjeta key={k} tono={tono} ic={ic} label={nombre} aria={nombre} izq={{ cap: k === 'retiros' ? `${d.anioBase} real` : `Cierre ${d.anioBase} est.`, val: mx(ref.cierre, d.refUF[k].cierre) }} der={{ cap: `Base ${Y}`, val: v != null ? mm(v) : '—' }} cmp={<Cmp comp={k} v={v} refv={ref.cierre} refU={d.refUF[k].cierre} />} det={det} onClick={ir1} />
  })
  const tile = (i) => <div key={i} onClick={() => ir({ drill: { t: 'mes', i } })} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, cursor: 'pointer', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: C.accent }}>{MESC[i]}</span><Chip tono='z'>{origen(i)}</Chip></div>
    <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.4, color: C.accent }}><Val v={mx(b.baseCLP[i], b.baseUF[i])} /></div>
    <div style={{ fontSize: 11, color: C.muted }}>{monedaActual() === 'clp' ? ufs(b.baseUF[i]) : ' '}</div></div>
  return <>
    <Titulo>Base {Y} · últimos 12 meses cerrados</Titulo>
    <Grid cols={3} colsM={1}>{tarjetasBase}</Grid>
    <div onClick={() => ir({ etapa: 3 })} role='button' style={{ fontSize: 12, fontWeight: 700, color: C.accent, margin: '-4px 4px 0', cursor: 'pointer', width: 'max-content', maxWidth: '100%' }}>Metas {Y} en el paso 4 ›</div>
    <Titulo>De dónde sale el ingreso de {Y}</Titulo>
    <Grid cols={3} colsM={1}>
      <Mini ic='cal' label='Recurrente' value={mx(recAnual, rec.anualUF)} sub={`${rec.n} ventas mensuales, anualizadas`} cls='pos' onClick={() => ir({ drill: { t: 'ind', k: 'rec' } })} />
      <Mini ic='doc' label='Por facturar' value='ver en Por facturar' sub='cuotas de ventas aceptadas' cls='amb' onClick={X.irPorFacturar} />
      <Mini ic='tgt' label='Vendido nuevo' value={MT.ch.ventas != null ? mx(Math.max(0, MT.ch.ventas - recAnual), Math.max(0, MT.ch.ventas / tasa27() - rec.anualUF)) : '—'} sub={`meta de ventas ${Y} − recurrente`} onClick={() => ir({ etapa: 3 })} />
    </Grid>
    <Titulo right={D && <Seg options={[['tarjetas', 'Tarjetas'], ['tabla', 'Tabla']]} value={ui.vm} onChange={(v) => setUI({ vm: v })} />}>Base mensual · {d.cierres[0]?.ym.slice(5, 7)}-{d.cierres[0]?.ym.slice(2, 4)} a {d.cierres[11]?.ym.slice(5, 7)}-{d.cierres[11]?.ym.slice(2, 4)}</Titulo>
    {d.sinBase && <div style={{ background: C.avisoBg, border: `1px solid ${C.avisoLine}`, color: C.avisoText, borderRadius: 12, padding: '10px 14px', fontSize: 13 }}>No hay facturas emitidas en los últimos 12 meses cerrados: la base queda en cero y el presupuesto no tiene de qué partir.</div>}
    {ui.vm === 'tabla' && D
      ? <Panel><div style={{ display: 'grid', gridTemplateColumns: '120px repeat(12,minmax(0,1fr))', fontSize: 12 }}><span />{MESC.map((m, i) => <span key={m} onClick={() => ir({ drill: { t: 'mes', i } })} style={{ padding: '9px 6px', textAlign: 'right', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.accent, cursor: 'pointer' }}>{m}</span>)}
        {monedaActual() !== 'uf' && <><span style={{ padding: '10px 12px', borderTop: `1px solid ${C.border}` }}>Facturado base</span>{b.baseCLP.map((v, i) => <span key={i} style={{ padding: '10px 6px', textAlign: 'right', borderTop: `1px solid ${C.border}` }}>{mxP(v, b.baseUF[i])}</span>)}</>}
        <span style={{ padding: '10px 12px', borderTop: `1px solid ${C.border}`, color: monedaActual() === 'uf' ? C.text : C.muted }}>{monedaActual() === 'uf' ? 'Facturado base (UF)' : 'En UF'}</span>{b.baseUF.map((v, i) => <span key={i} style={{ padding: '10px 6px', textAlign: 'right', borderTop: `1px solid ${C.border}`, color: monedaActual() === 'uf' ? C.text : C.muted }}>{nf.format(Math.round(v))}</span>)}</div></Panel>
      : <div style={{ display: 'grid', gridTemplateColumns: `repeat(${D ? 6 : 2},minmax(0,1fr))`, gap: 10 }}>{Array.from({ length: 12 }, (_, i) => tile(i))}</div>}
    <Panel><Fila tot nombre='Total base' peq='UF de cada mes' sub={monedaActual() === 'clp' ? ufs(totUF) : ''} valor={mx(tot, totUF)} sin /></Panel>
    <Grid cols={2} colsM={1} gap={14} style={{ alignItems: 'start' }}>
      <Panel hd='Lo recurrente' small='ventas mensuales activas'>
        <Fila nombre='Ventas mensuales activas' peq={`${rec.n} ventas · anualizadas ×12`} valor={mx(recAnual, rec.anualUF)} sub={monedaActual() === 'clp' ? ufs(rec.anualUF) : ''} onClick={() => ir({ drill: { t: 'ind', k: 'rec' } })} />
        <Fila tot sin nombre='Promedio mensual' valor={mx(recAnual / 12, rec.anualUF / 12)} />
      </Panel>
    </Grid>
  </>
}

// ── 3 · Costos ──
// Cada partida se edita por su monto 2027 o por su aumento (puede ser negativo), enlazados en los dos sentidos. Sueldos y leyes sociales van por persona, con su reajuste propio.
export function Costos({ X }) {
  const { datos: d, est, D, ui, setUI, M, setCosto, patchCosto, addCosto, delCosto, resetCostos, setPal } = X
  const k = est.esc, p = est.p[k], e = M.esc[k], nomE = X.nomEsc(k), Yb = d.anioBase
  const base26 = est.costos.reduce((a, c) => a + costoAnualBase(c, Yb), 0), tot26 = est.costos.reduce((a, c) => a + c.m * 12, 0)
  const val = (c, kk) => monto27(c, est.p[kk].alza)
  const dc = difMon(e.costos, tot26), Y = d.anio
  const grupo = (t, tit, col) => {
    const it = est.costos.map((c, i) => [c, i]).filter(([c]) => c.t === t); if (!it.length) return null
    return <div key={t}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 10, background: C.bgSoft, padding: '9px 16px', borderTop: `1px solid ${C.border}`, ...eti2 }}><span><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: col, marginRight: 8 }} />{tit}</span><b>{mm(it.reduce((a, [c]) => a + val(c, k), 0))}</b></div>
      {it.map(([c, i]) => {
        const v = val(c, k), abierto = ui.abierta === i, rj = reajusteVigente(c, Yb), efec = c.alza == null ? p.alza : c.alza
        const peq = [c.g || '', c.meses < 12 ? c.meses + ' meses' : '', rj ? `subió ${pc(rj.pct)} desde ${fmtFechaDMY(rj.desde)} (antes ${mp(rj.previo)})` : ''].filter(Boolean).join(' · ')
        const campos = <>
          <div style={{ display: 'flex', flexDirection: D ? 'row' : 'column', gap: 2, alignItems: D ? 'baseline' : 'flex-start', justifyContent: 'flex-end' }}>{!D && <span style={cap}>Aumento</span>}<span style={{ fontSize: 13, fontWeight: 700, color: C.accent }}><Fld sobrio kind='pct' suf='%' value={efec} onCommit={(x) => patchCosto(i, fijarAlza(x == null ? 0 : x))} label={`Aumento de ${c.n}`} /></span></div>
          <div style={{ display: 'flex', flexDirection: D ? 'row' : 'column', gap: 2, alignItems: D ? 'baseline' : 'flex-start', justifyContent: 'flex-end' }}>{!D && <span style={cap}>{Y}</span>}<span style={{ fontSize: 13, fontWeight: 700, color: C.accent }}><FldDin sobrio clp={Math.round(v)} tasa={tasa27()} onCommit={(x) => patchCosto(i, fijarMonto27(c, x == null ? 0 : x))} label={`Monto ${Y} de ${c.n}`} /></span></div>
        </>
        return <div key={c.id}>
          <div style={{ display: 'grid', gridTemplateColumns: D ? 'minmax(0,1fr) 96px 84px 160px' : 'minmax(0,1fr) minmax(0,1fr)', gap: D ? 14 : '6px 18px', alignItems: 'center', padding: '10px 16px', borderTop: `1px solid ${C.border}`, fontSize: 13, background: abierto ? C.bgSoft : 'transparent' }}>
            <div onClick={() => setUI({ abierta: abierto ? null : i })} style={{ gridColumn: D ? undefined : '1 / -1', cursor: 'pointer', minWidth: 0 }}><span style={{ fontWeight: 600 }}>{c.n}</span><span style={{ color: C.done, marginLeft: 6, display: 'inline-block', transform: abierto ? 'rotate(90deg)' : 'none' }}>›</span>{peq && <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>{peq}</div>}</div>
            {D && <span style={{ textAlign: 'right', color: C.muted, fontVariantNumeric: 'tabular-nums' }}>{m26(costoAnualBase(c, Yb))}</span>}
            {campos}
          </div>
          {abierto && <div style={{ background: C.bgSoft, padding: '2px 16px 14px', display: 'grid', gridTemplateColumns: D ? 'minmax(0,1.6fr) minmax(0,1fr) minmax(0,.8fr) minmax(0,.8fr)' : 'repeat(2,minmax(0,1fr))', gap: 10, alignItems: 'end' }}>
            <div style={{ gridColumn: D ? undefined : '1 / -1' }}><div style={eti}>Nombre</div><Fld text value={c.n} onCommit={(x) => setCosto(i, 'n', x)} /></div>
            <div><div style={eti}>Monto por mes</div><FldDin w={150} clp={c.m} tasa={tasa26()} onCommit={(x) => setCosto(i, 'm', Math.max(0, x))} /></div>
            <div><div style={eti}>Meses</div><Fld kind='int' suf='de 12' w={96} value={c.meses} onCommit={(x) => setCosto(i, 'meses', Math.min(12, Math.max(0, Math.round(x))))} /></div>
            <div><div style={eti}>Aumento propio</div><Fld kind='pct' suf='%' w={96} ph={String(p.alza).replace('.', ',')} value={c.alza} onCommit={(x) => setCosto(i, 'alza', x)} /></div>
            <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12, color: C.muted }}>
              <Seg options={[['fijo', 'Fijo'], ['discrecional', 'Discrecional']]} value={c.t} onChange={(x) => setCosto(i, 't', x)} />
              <span>{X.ESC.map(([kk, n], j) => <span key={kk}>{j ? ' · ' : ''}{n} <b style={{ color: C.text }}>{mm(val(c, kk))}</b></span>)}</span>
              <Lnk rojo onClick={() => delCosto(i)}>Quitar partida</Lnk>
            </div>
            {rj && <div style={{ gridColumn: '1 / -1', fontSize: 12, color: C.muted }}>El monto por mes ya incluye el reajuste vigente desde {fmtFechaDMY(rj.desde)}: el aumento se aplica sobre ese monto, no sobre el anterior. {c.g === 'Remuneraciones' ? 'Sus leyes sociales son costo de la oficina.' : ''}</div>}
          </div>}
        </div>
      })}
    </div>
  }
  const lado = <>
    <Panel hd='Qué se ajusta de 2026' pad flex><Lista items={['Remuneraciones: una partida por persona, con el monto vigente al comenzar el año; un sueldo que ya subió rige desde su fecha y solo sube otra vez si lo escribes.', 'Leyes sociales: parte del empleador; son costo de la oficina, no ingreso del socio.', 'Gastos reembolsables a clientes: no son costo ni ingreso, quedan fuera.', 'Comisiones: salen de la regla de la app, como pago a terceros.']} /></Panel>
  </>
  return <>
    <Titulo>Costos {Y}</Titulo>
    <Grid cols={3} colsM={1}>
      <Mini ic='doc' label='Presupuesto vigente' value={m26(tot26)} sub={`costos de oficina × 12, sin PPM${Math.abs(base26 - tot26) > 1 ? ' · ' + Yb + ' con sus reajustes ' + m26(base26) : ''}`} />
      <Mini ic='egr' label={`Presupuesto de costos ${nomE} ${Y}`} value={mm(e.costos)} sub={`${dc.sg}${dc.abs} contra hoy`} />
      <Mini ic='com' label='Comisiones' value={mm(e.terc)} sub={`${pc(p.terc)} de lo cobrado`} />
    </Grid>
    <div style={{ display: 'grid', gridTemplateColumns: D ? 'minmax(0,1fr) 290px' : '1fr', gap: 14, alignItems: 'stretch' }}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <Panel flex hd={`Partidas · ${nomE}`} small={<span style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}><span>Alza de costos <Stp value={p.alza} suf='%' step={0.5} min={0} max={20} onChange={(v) => setPal(k, 'alza', v)} /></span><span>Comisiones <Stp value={p.terc} suf='%' step={1} min={0} max={60} onChange={(v) => setPal(k, 'terc', v)} /></span></span>}>
          {D && <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 96px 84px 160px', gap: 14, padding: '10px 16px', ...eti2 }}><span>Partida</span><span style={{ textAlign: 'right' }}>{Yb} /año</span><span style={{ textAlign: 'right' }}>Aumento</span><span style={{ textAlign: 'right' }}>{Y}</span></div>}
          {grupo('fijo', 'Fijos', C.accent)}{grupo('discrecional', 'Discrecionales', C.soonText)}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', background: C.bgSoft, padding: '9px 16px', borderTop: `1px solid ${C.border}`, ...eti2 }}><span><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: C.tealText, marginRight: 8 }} />Variables</span><b>{mm(e.terc)}</b></div>
          <Fila nombre='Comisiones' peq={`${pc(p.terc)} de lo cobrado · se ajusta arriba`} valor={mm(e.terc)} onClick={() => X.irEsc('res')} />
          <Fila tot sin nombre='Presupuesto de costos + comisiones' valor={mm(e.costos + e.terc)} />
          <div onClick={addCosto} style={{ padding: '12px 16px', borderTop: `1px solid ${C.border}`, fontSize: 13, fontWeight: 700, color: C.accent, cursor: 'pointer' }}>+ Agregar partida</div>
        </Panel>
        <div style={{ fontSize: 12, color: C.muted, margin: '6px 4px 0' }}><Lnk onClick={resetCostos}>Restaurar los valores vigentes</Lnk> · 6 meses sirve para una contratación desde julio; 1 mes, para un gasto único.</div>
      </div>
      {D ? <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{lado}</div> : lado}
    </div>
  </>
}
const cap = { fontSize: 10.5, fontWeight: 600, color: C.muted }
const eti = { fontSize: 10.5, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: C.accent, marginBottom: 4 }
const eti2 = { fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: C.accent }
