// Presupuesto anual · etapas 1 a 3: Mirada a 2026, Base y Costos. Todo dato abre su detalle (ir y volver al lugar exacto).
import { C, fmtFechaDMY } from '../lib/base.jsx'
import { mesesAtipicos, nombreComponente, nombreCorto, componentesCortosDe, componentesDe, afavor, cadenaMeta, valorComponente, escenarioMetas, monto27, fijarMonto27, fijarAlza, costoAnualBase, costoVigente, reajusteVigente } from '../../supabase/functions/_shared/presupuesto.js'
import { VacioPaso, nf, mm, mx, m26, mp, mxP, mmP, ufs, pc, sgn, MESL, MESC, Mini, Titulo, Panel, Pliegue, Seg, Chip, Btn, Lnk, Fld, FldDin, Stp, Fila, Val, Lista, Det, Grid, Tarjeta, Flecha, monedaActual, tasa27, tasa26, difMon } from '../lib/presupuestoUI.jsx'
import { Cmp } from '../lib/presupuestoBloques.jsx'
import { TONO_COMP, detalleReferencia } from './presupuestoMetas.jsx'
import { CFG_PRESUPUESTO as CFG } from '../lib/presupuestoCfg.js'

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
  // Orden por el efecto en los retiros de un choque estándar (escenario Base de la demo): perder al mayor cliente (−47 %), −10 % de lo recurrente (−10 %), +1 punto de comisiones (−2 %) y +10 días de cobro (0 en la demo: el modelo solo mide diciembre).
  // Estimación propia en Concentración y Recurrente (el modelo no trae esos choques); Comisiones y Días de cobro salen del modelo (supuestos terc y dias). Los choques no son comparables entre sí: el orden es de magnitud.
  const indic = [
    ['pers', 'Concentración', pc(conc * 100, 0), `5 de ${d.clientes.length} · ene–${MESC[H]}`, 'amb', 'conc'],
    ['cal', 'Recurrente', mx(recMes, rec.anualUF / 12), `${rec.n} ventas mensuales activas`, '', 'rec'],
    ['com', 'Comisiones', d.terc != null ? pc(d.terc) : 'sin dato', 'de lo cobrado en el año', '', 'terc'],
    ['horas', 'Días de cobro', d.dias.promedio != null ? d.dias.promedio + ' días' : 'sin dato', d.dias.n ? `promedio · mediana ${d.dias.mediana}` : 'sin facturas pagadas', '', 'dias'],
  ]
  const mas = [
    ['egr', 'Presupuesto de costos', m26(d.costos.reduce((a, c) => a + c.m, 0) + d.ppmMes), 'por mes vigente, con PPM', '', 'cost'],
    ['alerta', 'Conversión de propuestas', 'sin dato', 'el índice de propuestas no tiene registros', 'amb', 'conv'],
  ]
  // Seis tarjetas de solo lectura, una por componente (los mismos nombres, tonos e íconos de los pasos 2 y 4). Cada cifra en la moneda elegida, con la UF de su fuente.
  const nSoc = d.retiros26.socios.length || 1, c26 = d.costos26, r26 = d.referencia, RU = d.refUF
  const cumple = (real, meta, realU, metaU) => { if (!(meta > 0)) return <span>Sin meta</span>; const x = difMon(real, meta, realU, metaU); return <><Flecha sube={real >= meta} bueno={real >= meta}>{pc((real / meta) * 100, 0)}</Flecha><Flecha sube={real >= meta} bueno={real >= meta}>{x.sg}{x.abs}</Flecha></> }
  const mVU = d.metaVentasUF > 0 ? d.metaVentasUF : null
  const T = Object.fromEntries(componentesDe(CFG).map(([k, n]) => [k, TONO_COMP[k]]))
  const tarjetas26 = componentesCortosDe(CFG).map(([k, nombre]) => {
    const [tono, ic] = T[k]
    const base = { tono, ic, label: nombre, aria: nombre }
    // Vendido (alternativa D): cifras gemelas BRUTO | NETO del mismo tamaño; la comparación es el neto contra la meta («Sin meta» si no hay). En el celular el bruto va primero.
    if (k === 'ventas') return <Tarjeta key={k} {...base} izq={{ cap: 'Bruto', val: mx(o.vendBruto.clp, o.vendBruto.uf) }} der={{ cap: 'Neto', val: mx(o.vend.clp, o.vend.uf) }} cmp={o.metaVentasCLP > 0 ? <><Flecha sube={o.vend.clp >= o.metaVentasCLP} bueno={o.vend.clp >= o.metaVentasCLP}>{pc((o.vend.clp / o.metaVentasCLP) * 100, 0)} neto</Flecha>{D && <span>Meta {mxP(o.metaVentasCLP, mVU)}</span>}</> : <span role='button' onClick={(ev) => { ev.stopPropagation(); ir({ etapa: 3 }) }} style={{ fontWeight: 700, color: C.accent, cursor: 'pointer' }}>Sin meta · Definir meta ›</span>} onClick={() => ir({ drill: { t: 'ind', k: 'vend' } })} />
    if (k === 'fact') return <Tarjeta key={k} {...base} izq={{ cap: 'Real', val: mx(o.fact.clp, o.fact.uf) }} der={{ cap: 'Del bruto', val: o.vendBruto.clp > 0 ? pc((o.fact.clp / o.vendBruto.clp) * 100, 0) : '—' }} cmp={<span>Sin meta propia</span>} onClick={() => ir({ drill: { t: 'ind', k: 'fact26' } })} />
    if (k === 'caja') return <Tarjeta key={k} {...base} izq={{ cap: 'Real', val: mx(o.cob.clp, o.cob.uf) }} der={{ cap: 'Meta', val: o.metaCobroCLP > 0 ? m26(o.metaCobroCLP) : 'Sin meta' }} cmp={o.metaCobroCLP > 0 ? cumple(o.cob.clp, o.metaCobroCLP, o.cob.uf, null) : <span role='button' onClick={(ev) => { ev.stopPropagation(); ir({ etapa: 3 }) }} style={{ fontWeight: 700, color: C.accent, cursor: 'pointer' }}>Definir meta ›</span>} onClick={() => ir({ drill: { t: 'ind', k: 'cob26' } })} />
    if (k === 'costos') return <Tarjeta key={k} {...base} izq={{ cap: 'Real', val: mx(c26.real, c26.realUF) }} der={{ cap: 'Presupuesto', val: mx(c26.ppto, c26.pptoUF) }} cmp={c26.ppto > 0 ? (() => { const x = difMon(c26.real, c26.ppto, c26.realUF, c26.pptoUF); return <Flecha sube={x.sube} bueno={afavor('costos', x.sube)}>{x.sg}{x.abs} · {x.sg}{pc(Math.abs(x.pct))}</Flecha> })() : <span>—</span>} onClick={() => ir({ drill: { t: 'ind', k: 'costos26' } })} />
    if (k === 'margen') return <Tarjeta key={k} {...base} izq={{ cap: 'Real', val: mx(o.marg.clp, o.marg.uf) }} der={{ cap: 'En caja', val: mx(r26.margen.aFecha, RU.margen.aFecha) }} cmp={<span>{o.marg.pct != null ? pc(o.marg.pct, 0) + ' de ingresos' : '—'}</span>} onClick={() => ir({ drill: { t: 'ind', k: 'marg' } })} />
    return <Tarjeta key={k} {...base} izq={d.retiros26.total > 0 ? { cap: 'Real', val: mx(d.retiros26.total, d.retiros26.totalUF) } : { cap: 'Real', val: 'Sin retiros' }} der={d.retiros26.total > 0 ? { cap: 'Por socio', val: mx(d.retiros26.total / nSoc, d.retiros26.totalUF / nSoc) } : undefined} cmp={d.retiros26.total > 0 ? <span> </span> : <span>{D ? 'sin retiros registrados' : ''}{D && <> · <span role='button' onClick={(ev) => { ev.stopPropagation(); X.onOpenSocios && X.onOpenSocios() }} style={{ fontWeight: 700, color: C.accent, cursor: 'pointer' }}>Socios ›</span></>}</span>} onClick={() => ir({ drill: { t: 'ind', k: 'ret26' } })} />
  })
  const tile = (m) => {
    const x = m.f && m.a && fv(m.a) && m.i < H ? (fv(m.f) / fv(m.a) - 1) * 100 : null, at = atip.has(m.i)   // el mes en curso no se compara (queda «a la fecha»)
    return <div key={m.i} onClick={() => ir({ drill: { t: 'mes', i: m.i } })} style={{ background: at ? C.soonBg : C.card, border: `1px solid ${at ? C.avisoLine : C.border}`, borderRadius: 12, padding: D ? '9px 12px' : '8px 9px', cursor: 'pointer', minWidth: 0, display: 'flex', flexDirection: 'column', gap: D ? 1 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}><span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: C.accent }}>{D && !dosCol ? MESL[m.i] : MESC[m.i]}</span>{at ? <span style={{ fontSize: 11, fontWeight: 700, color: C.soonText }}>atípico</span> : m.i === H ? <span style={{ fontSize: 11, color: C.muted }}>a la fecha</span> : null}{x == null ? null : <Chip tono={x >= 0 ? 'g' : 'r'}>{sgn(x)}{pc(Math.abs(x), 0)}</Chip>}</div>
      <div style={{ fontSize: D ? 21 : 14, fontWeight: 800, letterSpacing: -0.4, color: C.accent }}>{m.f ? <Val v={mx(m.f.fac, m.f.facUF)} /> : '—'}</div>
      <div style={{ fontSize: 11, color: C.muted }}>cobrado {m.cob != null ? mxP(m.cob, d.cobMesUF[ym(Y, m.i)]) : '—'}</div>
    </div>
  }
  // Primer año sin historia: no hay nada que mostrar; se parte desde cero (Costos → Metas → Escenarios).
  if (d.sinBase && d.clientes.length === 0) return <VacioPaso titulo={`Sin datos de ${Y} en la app`} causa={`No hay facturas emitidas en ${Y}, así que no hay resultado que comparar. El presupuesto se puede preparar igual.`} pasos={[[1, 'Costos', 'las partidas de la oficina'], [2, `Metas ${d.anio}`, 'lo que se quiere retirar'], [3, 'Escenarios', 'qué tan alcanzable es la meta']]} acciones={[['Preparar desde cero', () => ir({ drill: { t: 'ini' } }), true], ...(X.esAdmin ? [['Configuración del presupuesto', () => ir({ drill: { t: 'cfg' } }), false]] : [])]} />
  const dosCol = D && ui.vm !== 'tabla'
  return <>
    <Titulo right={<span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500, color: C.muted }}>al {fmtFechaDMY(d.hoy)}</span>}>Resultado del año {Y}</Titulo>
    <Grid cols={3} colsM={2} gap={D ? 10 : 8}>{tarjetas26}</Grid>
    {/* Escritorio: Indicadores y Mes a mes lado a lado (4 × 3) y debajo Clientes; en tabla y en el celular, uno bajo otro */}
    {(() => {
      const mesB = <div key='mes' style={{ display: 'flex', flexDirection: 'column', gap: D ? 8 : 10, minWidth: 0 }}>
    <Titulo right={<span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{atip.size > 0 && <Chip tono='y'>{atip.size} atípicos</Chip>}{D && <Seg options={[['tarjetas', 'Tarjetas'], ['tabla', 'Tabla']]} value={ui.vm} onChange={(v) => setUI({ vm: v })} />}</span>}>Mes a mes · {Y} contra {Y - 1}</Titulo>
    {ui.vm === 'tabla' && D
      ? <Panel><div style={{ display: 'grid', gridTemplateColumns: '120px repeat(12,minmax(0,1fr))', fontSize: 12 }}>
        <span />{MESC.map((m, i) => <span key={m} onClick={() => ir({ drill: { t: 'mes', i } })} style={{ padding: '9px 6px', textAlign: 'right', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.accent, cursor: 'pointer' }}>{m}</span>)}
        {[['Facturado ' + (Y - 1), (m) => (m.a ? <Val v={mx(m.a.fac, m.a.facUF)} /> : '—')], ['Facturado ' + Y, (m) => (m.f ? <Val v={mx(m.f.fac, m.f.facUF)} /> : '—')], ['Cobrado ' + Y, (m) => (m.cob != null ? <Val v={mx(m.cob, d.cobMesUF[ym(Y, m.i)])} /> : '—')]].map(([t, f]) => [<span key={t} style={{ padding: '10px 12px', borderTop: `1px solid ${C.border}` }}>{t}</span>, ...meses.map((m) => <span key={t + m.i} style={{ padding: '10px 6px', textAlign: 'right', borderTop: `1px solid ${C.border}` }}>{f(m)}</span>)])}
      </div></Panel>
      : <div style={{ display: 'grid', gridTemplateColumns: `repeat(${D ? (dosCol ? 4 : 6) : 3},minmax(0,1fr))`, gap: D ? 10 : 6 }}>{meses.map(tile)}</div>}
      </div>
      const indB = <div key='ind' style={{ display: 'flex', flexDirection: 'column', gap: D ? 8 : 10, minWidth: 0 }}>
    <Titulo right={<Btn onClick={() => setUI({ mas: !ui.mas })}>{ui.mas ? 'Ver menos' : 'Ver más'}</Btn>}>Indicadores {Y}</Titulo>
    <Grid cols={dosCol ? 2 : 4} colsM={2}>{indic.map(([ic, l, v, s, cl, k]) => <Mini key={k} ic={ic} label={l} value={v} sub={s} cls={cl} onClick={() => ir({ drill: { t: 'ind', k } })} />)}</Grid>
    {ui.mas && <Grid cols={dosCol ? 2 : 4} colsM={2}>{mas.map(([ic, l, v, s, cl, k]) => <Mini key={k} ic={ic} label={l} value={v} sub={s} cls={cl} onClick={() => ir({ drill: { t: 'ind', k } })} />)}</Grid>}
      </div>
      const cliB = <Panel key='cli' hd={`Clientes que más facturaron · ${Y}`} small={`los 5 primeros suman ${pc(conc * 100, 0)}`}>
        {d.clientes.length === 0 ? <div style={{ padding: 16, fontSize: 13, color: C.muted }}>Aún no hay facturas emitidas este año.</div>
          : <div style={{ display: 'grid', gridTemplateColumns: D ? '1fr 1fr' : '1fr' }}>{d.clientes.slice(0, 8).map((c, i) => <div key={c.id} style={{ borderRight: D && i % 2 === 0 ? `1px solid ${C.border}` : 'none' }}><Fila nombre={<><span style={{ color: C.muted, fontWeight: 700, fontSize: 12, marginRight: 8 }}>{i + 1}</span>{c.name}</>} {...(D ? { sub: <span style={{ whiteSpace: 'nowrap' }}>{pc((c.monto / d.totalFact) * 100)} · {c.n} factura{c.n !== 1 ? 's' : ''}</span> } : { peq: `${c.n} factura${c.n !== 1 ? 's' : ''} · ${pc((c.monto / d.totalFact) * 100)} de lo facturado` })} valor={mx(c.monto, c.uf)} onClick={() => ir({ drill: { t: 'cli', n: c.id } })} /></div>)}</div>}
      </Panel>

      return dosCol ? [<div key='dos' style={{ display: 'grid', gridTemplateColumns: 'minmax(0,5fr) minmax(0,7fr)', gap: 12, alignItems: 'start' }}>{indB}{mesB}</div>, cliB] : [indB, mesB, cliB]
    })()}
  </>
}

// ── 2 · Base 2027 ──
export function Base({ X }) {
  const { datos: d, est, D, ui, setUI, ir, MT } = X
  const Y = d.anio, rec = d.recurrente
  const b = d.base, tot = b.baseCLP.reduce((a, x) => a + x, 0), totUF = b.baseUF.reduce((a, x) => a + x, 0)
  const origen = (i) => { const c = d.cierres.find((x) => Number(x.ym.slice(5, 7)) - 1 === i); return c ? c.ym.slice(0, 4) : '—' }
  // Seis tarjetas de solo lectura: el cierre 2026 estimado contra la base de {Y} (últimos 12 meses cerrados, sin crecimiento, con los supuestos del escenario Base). Tocar una abre su página (filasBase).
  const ch0 = cadenaMeta(d.base, est, 0, MT.ratio, MT.cv)
  const tarjetasBase = componentesCortosDe(CFG).map(([k, nombre]) => {
    const [tono, ic] = TONO_COMP[k], v = valorComponente(ch0, k, MT.ratio, MT.cv), ref = d.referencia[k]
    return <Tarjeta key={k} tono={tono} ic={ic} label={nombre} aria={nombre} izq={{ cap: 'Cierre', val: mx(ref.cierre, d.refUF[k].cierre) }} der={{ cap: 'Base', val: v != null ? mm(v) : '—' }} cmp={<Cmp comp={k} v={v} refv={ref.cierre} refU={d.refUF[k].cierre} />} onClick={() => ir({ drill: { t: 'comp', de: 'base', k } })} />
  })
  const tile = (i) => <div key={i} onClick={() => ir({ drill: { t: 'mes', i } })} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: D ? 12 : '8px 9px', cursor: 'pointer', minWidth: 0, display: 'flex', flexDirection: 'column', gap: D ? 3 : 1 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ fontSize: D ? 11 : 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: C.accent }}>{MESC[i]}</span>{D && <Chip tono='z'>{origen(i)}</Chip>}</div>
    <div style={{ fontSize: D ? 21 : 14, fontWeight: 800, letterSpacing: -0.4, color: C.accent }}><Val v={mx(b.baseCLP[i], b.baseUF[i])} /></div>
    <div style={{ fontSize: 11, color: C.muted }}>{monedaActual() === 'clp' ? ufs(b.baseUF[i]) : ' '}</div></div>
  const mesesTxt = `${d.cierres[0]?.ym.slice(5, 7)}-${d.cierres[0]?.ym.slice(2, 4)} a ${d.cierres[11]?.ym.slice(5, 7)}-${d.cierres[11]?.ym.slice(2, 4)}`
  // Todo en el plano de Vendido (neto de comisiones): meta de ventas − recurrente neto.
  const vNuevo = MT.ch.ventas != null ? mx(Math.max(0, MT.ch.ventas - rec.netoCLP), Math.max(0, MT.ch.ventas / tasa27() - rec.netoUF)) : '—'
  const ingreso = [
    ['Recurrente', `${rec.n} ventas mensuales · ${mx(rec.netoCLP / 12, rec.netoUF / 12)} al mes · neto de comisiones`, mx(rec.netoCLP, rec.netoUF), () => ir({ drill: { t: 'ind', k: 'rec' } })],
    ['Por facturar', 'cuotas de ventas ya vendidas · fuera de Vendido nuevo', m26(X.porFacturar || 0), X.irPorFacturar],
    ['Vendido nuevo', `meta de ventas ${Y} (neta) − recurrente`, vNuevo, () => ir({ etapa: 3 })],
  ]
  return <>
    <Titulo>Base {Y} · últimos 12 meses cerrados</Titulo>
    <Grid cols={3} colsM={2} gap={D ? 12 : 8}>{tarjetasBase}</Grid>
    <Titulo>Ingreso {Y}</Titulo>
    <Panel>{ingreso.map(([n, sub, v, go], i) => <Fila key={n} nombre={n} peq={sub} valor={v} onClick={go} />)}</Panel>
    {d.sinBase && <div style={{ background: C.avisoBg, border: `1px solid ${C.avisoLine}`, color: C.avisoText, borderRadius: 12, padding: '10px 14px', fontSize: 13 }}>No hay facturas emitidas en los últimos 12 meses cerrados: la base queda en cero y el presupuesto no tiene de qué partir.</div>}
    <Det t={`Base mensual · ${mesesTxt} · total ${mx(tot, totUF)}`}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>{D && <Seg options={[['tarjetas', 'Tarjetas'], ['tabla', 'Tabla']]} value={ui.vm} onChange={(v) => setUI({ vm: v })} />}</div>
      {ui.vm === 'tabla' && D
        ? <div style={{ display: 'grid', gridTemplateColumns: '120px repeat(12,minmax(0,1fr))', fontSize: 12 }}><span />{MESC.map((m, i) => <span key={m} onClick={() => ir({ drill: { t: 'mes', i } })} style={{ padding: '9px 6px', textAlign: 'right', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.accent, cursor: 'pointer' }}>{m}</span>)}
          {monedaActual() !== 'uf' && <><span style={{ padding: '10px 12px', borderTop: `1px solid ${C.border}` }}>Facturado base</span>{b.baseCLP.map((v, i) => <span key={i} style={{ padding: '10px 6px', textAlign: 'right', borderTop: `1px solid ${C.border}` }}>{mxP(v, b.baseUF[i])}</span>)}</>}
          <span style={{ padding: '10px 12px', borderTop: `1px solid ${C.border}`, color: monedaActual() === 'uf' ? C.text : C.muted }}>{monedaActual() === 'uf' ? 'Facturado base (UF)' : 'En UF'}</span>{b.baseUF.map((v, i) => <span key={i} style={{ padding: '10px 6px', textAlign: 'right', borderTop: `1px solid ${C.border}`, color: monedaActual() === 'uf' ? C.text : C.muted }}>{nf.format(Math.round(v))}</span>)}</div>
        : <div style={{ display: 'grid', gridTemplateColumns: `repeat(${D ? 6 : 3},minmax(0,1fr))`, gap: D ? 10 : 6 }}>{Array.from({ length: 12 }, (_, i) => tile(i))}</div>}
      <Fila tot sin nombre='Total base' peq='UF de cada mes' sub={monedaActual() === 'clp' ? ufs(totUF) : ''} valor={mx(tot, totUF)} />
    </Det>
  </>
}

// ── 3 · Costos ──
// Cada partida se edita por su monto 2027 o por su aumento (puede ser negativo), enlazados en los dos sentidos. Sueldos y leyes sociales van por persona, con su reajuste propio.
export function Costos({ X }) {
  const { datos: d, est, D, ui, setUI, M, setCosto, patchCosto, addCosto, delCosto, resetCostos, setPal, ir: ir1 } = X
  const k = est.esc, p = est.p[k], e = M.esc[k], nomE = X.nomEsc(k), Yb = d.anioBase
  const base26 = est.costos.reduce((a, c) => a + costoAnualBase(c, Yb), 0), tot26 = est.costos.reduce((a, c) => a + costoVigente(c), 0)
  const val = (c, kk) => monto27(c, est.p[kk].alza)
  const dc = difMon(e.costos, tot26), Y = d.anio
  const mats = ui.mats || []
  const cotC = est.costos.find((c) => c.id === 'cot-empleador'), cotV = cotC ? val(cotC, k) : 0   // alza de cotización del empleador (si la partida sigue y vale algo)
  const itemsDe = (c) => (d.costos.find((x) => String(x.id) === String(c.id))?.items) || []
  // Una fila por materia (c.g si la partida es por persona; si no, su nombre), de mayor a menor monto 2027; todo cerrado al entrar.
  const mapa = {}
  est.costos.forEach((c, i) => { const m = c.g || c.n; (mapa[m] || (mapa[m] = { m, it: [] })).it.push([c, i]) })
  const materias = Object.values(mapa).map((x) => ({ ...x, t27: x.it.reduce((a, [c]) => a + val(c, k), 0), t26: x.it.reduce((a, [c]) => a + costoAnualBase(c, Yb), 0) })).sort((a, b) => b.t27 - a.t27)
  const partida = ([c, i]) => {
        const v = val(c, k), abierto = ui.abierta === i, rj = reajusteVigente(c, Yb), efec = c.alza == null ? p.alza : c.alza
        const peq = [c.g || '', c.t === 'fijo' ? 'Fijo' : 'Discrecional', c.meses < 12 ? c.meses + ' meses' : '', rj ? `subió ${pc(rj.pct)} desde ${fmtFechaDMY(rj.desde)} (antes ${mp(rj.previo)})` : ''].filter(Boolean).join(' · ')
        const campos = <>
          <div style={{ display: 'flex', flexDirection: D ? 'row' : 'column', gap: 2, alignItems: D ? 'baseline' : 'flex-start', justifyContent: 'flex-end' }}>{!D && <span style={cap}>Aumento</span>}<span style={{ fontSize: 13, fontWeight: 700, color: C.accent }}><Fld sobrio kind='pct' suf='%' value={efec} onCommit={(x) => patchCosto(i, fijarAlza(x == null ? 0 : x))} label={`Aumento de ${c.n}`} /></span></div>
          <div style={{ display: 'flex', flexDirection: D ? 'row' : 'column', gap: 2, alignItems: D ? 'baseline' : 'flex-start', justifyContent: 'flex-end' }}>{!D && <span style={cap}>{Y}</span>}<span style={{ fontSize: 13, fontWeight: 700, color: C.accent }}><FldDin sobrio clp={Math.round(v)} tasa={tasa27()} onCommit={(x) => patchCosto(i, fijarMonto27(c, x == null ? 0 : x))} label={`Monto ${Y} de ${c.n}`} /></span></div>
        </>
        return <div key={c.id}>
          <div style={{ display: 'grid', gridTemplateColumns: D ? 'minmax(0,1fr) 96px 84px 160px' : 'minmax(0,1fr) minmax(0,1fr)', gap: D ? 14 : '6px 18px', alignItems: 'center', padding: D ? '10px 16px 10px 30px' : '10px 16px 10px 24px', borderTop: `1px solid ${C.border}`, fontSize: 13, background: abierto ? C.bgSoft : 'transparent' }}>
            <div onClick={() => setUI({ abierta: abierto ? null : i })} style={{ gridColumn: D ? undefined : '1 / -1', cursor: 'pointer', minWidth: 0 }}><span style={{ fontWeight: 600 }}>{c.n}</span><span style={{ color: C.done, marginLeft: 6, display: 'inline-block', transform: abierto ? 'rotate(90deg)' : 'none' }}>›</span>{peq && <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>{peq}</div>}</div>
            {D && <span style={{ textAlign: 'right', color: C.muted, fontVariantNumeric: 'tabular-nums' }}>{m26(costoAnualBase(c, Yb))}</span>}
            {campos}
          </div>
          {abierto && <div style={{ background: C.bgSoft, padding: '2px 16px 14px', display: 'grid', gridTemplateColumns: D ? (c.id === 'cot-empleador' ? 'minmax(0,2.4fr) minmax(0,1fr) minmax(0,.8fr) minmax(0,.8fr)' : 'minmax(0,1.6fr) minmax(0,1fr) minmax(0,.8fr) minmax(0,.8fr)') : 'repeat(2,minmax(0,1fr))', gap: 10, alignItems: 'end' }}>
            <div style={{ gridColumn: D ? undefined : '1 / -1' }}><div style={eti}>Nombre</div><Fld text value={c.n} onCommit={(x) => setCosto(i, 'n', x)} /></div>
            <div><div style={eti}>Monto por mes</div><FldDin w={150} clp={c.m} tasa={tasa26()} onCommit={(x) => setCosto(i, 'm', Math.max(0, x))} /></div>
            <div><div style={eti}>Meses</div><Fld kind='int' suf='de 12' w={96} value={c.meses} onCommit={(x) => setCosto(i, 'meses', Math.min(12, Math.max(0, Math.round(x))))} /></div>
            <div><div style={eti}>Aumento propio</div><Fld kind='pct' suf='%' w={96} ph={String(p.alza).replace('.', ',')} value={c.alza} onCommit={(x) => setCosto(i, 'alza', x)} /></div>
            <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12, color: C.muted }}>
              <Seg options={[['fijo', 'Fijo'], ['discrecional', 'Discrecional']]} value={c.t} onChange={(x) => setCosto(i, 't', x)} />
              <span>{X.ESC.map(([kk, n], j) => <span key={kk}>{j ? ' · ' : ''}{n} <b style={{ color: C.text }}>{mm(val(c, kk))}</b></span>)}</span>
              <Lnk rojo onClick={() => delCosto(i)}>Quitar partida</Lnk>
            </div>
            {c.id === 'cot-empleador' && d.cotEmp.total > 0 && (() => {
              const cm = d.cotEmp, tp = (/** @type {number} */ x) => Number(x).toLocaleString('es-CL', { maximumFractionDigits: 2 }) + ' %', desde = cm.meses.find((x) => x.tasa > cm.tasaBase), fila = (t, v, tot) => <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12, ...(tot ? { borderTop: `1px solid ${C.border}`, paddingTop: 4, marginTop: 2, fontWeight: 700, color: C.accent } : { color: C.muted }) }}><span>{t}</span><span style={{ fontVariantNumeric: 'tabular-nums', color: tot ? C.accent : C.text, fontWeight: tot ? 800 : 600 }}>{v}</span></div>
              return <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 3 }}>
                {fila('Tasa de cotización hoy', tp(cm.tasaBase))}
                {desde && fila(`Tasa desde el ${fmtFechaDMY(desde.ym + '-01')}`, tp(desde.tasa))}
                {fila(`Meses de ${Y} con el alza`, String(cm.meses.filter((x) => x.extra > 0).length))}
                {fila('Remuneración imponible mensual', m26(cm.base.monto))}
                {fila(`Alza de cotización ${Y}`, m26(cm.total), true)}
              </div>
            })()}
            {rj && <div style={{ gridColumn: '1 / -1', fontSize: 12, color: C.muted }}>El monto por mes ya incluye el reajuste vigente desde {fmtFechaDMY(rj.desde)}: el aumento se aplica sobre ese monto, no sobre el anterior. {c.g === 'Remuneraciones' ? 'Sus leyes sociales son costo de la oficina.' : ''}</div>}
          </div>}
        </div>
      }
  const materia = ({ m, it, t27, t26 }) => {
    const abre = mats.includes(m), aum = t26 > 0 ? (t27 / t26 - 1) * 100 : null, inc = it.length === 1 ? itemsDe(it[0][0]) : []
    return <div key={m}>
      <div onClick={() => setUI({ mats: abre ? mats.filter((x) => x !== m) : [...mats, m] })} role='button' aria-expanded={abre} style={{ display: 'grid', gridTemplateColumns: D ? 'minmax(0,1fr) 96px 84px 160px' : 'minmax(0,1fr) auto', gap: D ? 14 : 10, alignItems: 'center', padding: D ? '13px 16px' : '10px 14px', borderTop: `1px solid ${C.border}`, cursor: 'pointer', fontSize: 13, background: abre ? C.bgSoft : 'transparent' }}>
        <div style={{ minWidth: 0 }}><span style={{ fontWeight: 700 }}>{m}</span>{' '}<span style={{ color: C.done, display: 'inline-block', transform: abre ? 'rotate(90deg)' : 'none' }}>›</span>{!D && <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>{aum != null ? `${aum >= 0 ? '+' : '−'}${pc(Math.abs(aum))} · ` : ''}{m26(t26)} en {Yb}</div>}</div>
        {D && <span style={{ textAlign: 'right', color: C.muted, fontVariantNumeric: 'tabular-nums' }}>{m26(t26)}</span>}
        {D && <span style={{ textAlign: 'right', color: C.muted, fontVariantNumeric: 'tabular-nums' }}>{aum != null ? `${aum >= 0 ? '+' : '−'}${pc(Math.abs(aum))}` : '—'}</span>}
        <b style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: C.accent }}><Val v={mm(t27)} /></b>
      </div>
      {abre && <>{it.map(partida)}{inc.length > 1 && <div style={{ padding: D ? '8px 16px 12px 30px' : '8px 16px 12px 24px', fontSize: 12, color: C.muted, background: C.bgSoft }}>Incluye: {inc.map((x) => `${x.n} ${m26(x.m * 12)}`).join(' · ')}</div>}</>}
    </div>
  }
  return <>
    {/* H02 / N05 / R3: una sola cifra de costos y un solo nombre; el «vigente» pasa al detalle («Cómo se calcula»); tarjetas A2 con textos breves */}
    <Tarjeta tono='t' ic='egr' label={`${nombreCorto('costos', CFG)} ${Y} · ${nomE}`} aria={`${nombreCorto('costos', CFG)} ${Y}`} izq={{ cap: 'Costos', val: mm(e.costos) }} der={{ cap: 'Comisiones', val: mm(e.terc) }} cmp={<span>{dc.sg}{dc.abs} contra hoy</span>} cmp2={cotC && cotV > 0 ? <span>de lo cual, alza de cotización +{mmP(cotV)}</span> : null} onClick={() => ir1({ drill: { t: 'comp', de: 'metas', k: 'costos' } })} />
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <Pliegue t='Partidas' v={`${materias.length} materias · ${mm(e.costos)}`}>
          <div style={{ ...LBLC, padding: '9px 16px', display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontWeight: 500, letterSpacing: 0, textTransform: 'none', color: C.muted, fontSize: 12 }}><span>Alza de costos <Stp value={p.alza} suf='%' step={0.5} min={0} max={20} onChange={(v) => setPal(k, 'alza', v)} /></span><span>Comisiones <Stp value={p.terc} suf='%' step={1} min={0} max={60} onChange={(v) => setPal(k, 'terc', v)} /></span></div>
          {D && <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 96px 84px 160px', gap: 14, padding: '10px 16px', ...eti2 }}><span>Materia y partida</span><span style={{ textAlign: 'right' }}>{Yb} /año</span><span style={{ textAlign: 'right' }}>Aumento</span><span style={{ textAlign: 'right' }}>{Y}</span></div>}
          {materias.map(materia)}
          <Fila nombre='Comisiones' peq={`variable · ${pc(p.terc)} de lo cobrado · se ajusta arriba`} valor={mm(e.terc)} onClick={() => X.irEsc('res')} />
          <Fila nombre='Impuestos y patentes' peq={`${TXc('pagoMensual')} · pagado hoy`} valor={mm(e.ppm)} onClick={() => X.irEscTab('imp')} />
          <Fila tot sin nombre='Con comisiones' valor={mm(e.costos + e.terc)} />
          <div onClick={addCosto} style={{ padding: '12px 16px', borderTop: `1px solid ${C.border}`, fontSize: 13, fontWeight: 700, color: C.accent, cursor: 'pointer' }}>+ Agregar partida</div>
        </Pliegue>
        <div style={{ fontSize: 12, color: C.muted, margin: '6px 4px 0' }}><Lnk onClick={resetCostos}>Restaurar los valores vigentes</Lnk></div>
      </div>
      <Det t='Cómo se calcula'><Lista items={[<span><b>Alza de cotización del empleador (Ley 21.735, estimación):</b> (tasa de cada mes − {pc(d.cotEmp.tasaBase, 2)} que ya incluye la base de {d.cotEmp.base.mes}) × remuneración imponible mensual {m26(d.cotEmp.base.monto)} ({d.cotEmp.base.fuente}) = {m26(d.cotEmp.total)} en {Y}; entra como partida de Leyes sociales solo en {Y} (no cuenta en {Yb} ni en lo vigente), editable{est.sinCotEmpleador ? ' (quitada)' : ''}.</span>, <span><b>Presupuesto vigente:</b> {m26(tot26)} (costos de oficina × 12, sin {TXc('pagoMensual')}){Math.abs(base26 - tot26) > 1 ? <>; {Yb} con sus reajustes {m26(base26)}</> : ''}.</span>, 'Remuneraciones: una partida por persona, con el monto vigente al comenzar el año; un sueldo que ya subió rige desde su fecha y solo sube otra vez si lo escribes.', 'Leyes sociales: parte del empleador; son costo de la oficina, no ingreso del socio.', 'Gastos reembolsables a clientes: no son costo ni ingreso, quedan fuera.', 'Comisiones: salen de la regla de la app, como pago a terceros.', 'Meses: 6 sirve para una contratación desde julio; 1, para un gasto único.']} /></Det>
    </div>
  </>
}
const TXc = (/** @type {string} */ k) => CFG.tributario.textos[k]
const LBLC = { borderBottom: `1px solid ${C.border}` }
const cap = { fontSize: 11, fontWeight: 600, color: C.muted }
const eti = { fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: C.accent, marginBottom: 4 }
const eti2 = { fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: C.accent }

// Aclaraciones de las tarjetas del paso 2 (antes en el plegable de la tarjeta): se muestran en la página del componente. `ir` = a dónde llevaba la tarjeta, ahora un enlace de la página.
export function filasBase(X, k) {
  const { datos: d, est, MT, ir } = X, ch0 = cadenaMeta(d.base, est, 0, MT.ratio, MT.cv), rk = escenarioMetas(est, CFG)
  const rows = [['Base', 'sin crecimiento; no cambia con el escenario'], ...detalleReferencia(X, k), ...(k === 'ventas' ? [['Plano', MT.ratio != null ? `neto de comisiones · estimación propia: facturado ÷ ${pc(MT.ratio, 0)} = bruto, menos ${pc(MT.cv)} de comisiones` : 'falta la relación facturado/vendido'], ...(ch0.ventasBruto != null ? [['Bruto', mm(ch0.ventasBruto)], ['− Comisiones de venta', mm(ch0.comisVentas)]] : [])] : []), ...(k === 'costos' ? [['Cálculo', `presupuesto vigente + alza ${pc(est.p[rk].alza)}`]] : [])]
  const go = k === 'costos' ? ['Presupuesto de costos', () => X.irCostos()] : k === 'retiros' ? ['Sueldos y retiros de los socios', () => ir({ drill: { t: 'socios' } })] : k === 'margen' ? ['Impuesto en Escenarios', () => X.irEscTab('imp')] : ['Metas del paso 4', () => ir({ etapa: 3 })]
  return { rows, go }
}
