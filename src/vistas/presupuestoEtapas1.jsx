// Presupuesto anual · etapas 1 a 3: Mirada a 2026, Base y Costos. Todo dato abre su detalle (ir y volver al lugar exacto).
import { C } from '../lib/base.jsx'
import { mesesAtipicos } from '../../supabase/functions/_shared/presupuesto.js'
import { nf, mm, pes, ufs, pc, sgn, MESL, MESC, Kpi, Mini, Titulo, Panel, Seg, Chip, Btn, Lnk, Fld, Stp, Fila, Det, Lista, Grid } from '../lib/presupuestoUI.jsx'

const ym = (y, i) => `${y}-${String(i + 1).padStart(2, '0')}`

// ── 1 · Mirada a 2026 ──
export function Mirada({ X }) {
  const { datos: d, est, D, ui, setUI, ir } = X, o = d.oficiales, uf = est.moneda === 'uf', ambos = est.moneda === 'ambos'
  const cifra = (c) => (uf || ambos ? 'UF ' + nf.format(Math.round(c.uf)) : mm(c.clp))
  const sub = (c, txt) => <span>{c.pct != null && <b>{pc(c.pct, 0)}</b>} {txt}{ambos ? ' · ' + mm(c.clp) : ''}</span>
  const Y = d.anioBase, H = Number(d.hoy.slice(5, 7)) - 1
  const serie = (y, i) => d.serie[ym(y, i)]
  const meses = Array.from({ length: 12 }, (_, i) => ({ i, f: i <= H ? serie(Y, i) : null, a: serie(Y - 1, i), cob: i <= H ? d.cobMes[ym(Y, i)] ?? null : null }))
  const fv = (x) => (uf ? x.facUF : x.fac)
  const atip = new Set(mesesAtipicos(meses.map((m) => (m.f && m.i < H ? m.f.fac : null))))
  const r5 = d.clientes.slice(0, 5).reduce((a, c) => a + c.monto, 0), conc = d.totalFact ? r5 / d.totalFact : 0
  const rec = d.recurrente, recMes = rec.anualCLP / 12
  const indic = [
    ['pers', 'Concentración', pc(conc * 100, 0), `5 de ${d.clientes.length} · ene–${MESC[H]}`, 'amb', 'conc'],
    ['horas', 'Días de cobro', d.dias.promedio != null ? d.dias.promedio + ' días' : 'sin dato', d.dias.n ? `promedio · mediana ${d.dias.mediana}` : 'sin facturas pagadas', '', 'dias'],
    ['cal', 'Recurrente mensual', mm(recMes), `${rec.n} ventas mensuales activas`, '', 'rec'],
    ['com', 'Comisiones', d.terc != null ? pc(d.terc) : 'sin dato', 'de lo cobrado en el año', '', 'terc'],
  ]
  const mas = [
    ['egr', 'Costos de oficina', mm(d.costos.reduce((a, c) => a + c.m, 0) + d.ppmMes), 'por mes vigente, con PPM', '', 'cost'],
    ['alerta', 'Conversión de propuestas', 'sin dato', 'el índice de propuestas no tiene registros', 'amb', 'conv'],
  ]
  const tile = (m) => {
    const x = m.f && m.a && fv(m.a) ? (fv(m.f) / fv(m.a) - 1) * 100 : null, at = atip.has(m.i)
    return <div key={m.i} onClick={() => ir({ drill: { t: 'mes', i: m.i } })} style={{ background: at ? C.soonBg : C.card, border: `1px solid ${at ? C.avisoLine : C.border}`, borderRadius: 12, padding: 12, cursor: 'pointer', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}><span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: C.accent }}>{D ? MESL[m.i] : MESC[m.i]}</span>{x == null ? <Chip tono='z'>—</Chip> : <Chip tono={x >= 0 ? 'g' : 'r'}>{sgn(x)}{pc(Math.abs(x), 0)}</Chip>}</div>
      <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.4, color: C.accent }}>{m.f ? (uf ? ufs(m.f.facUF) : mm(m.f.fac)) : '—'}</div>
      <div style={{ fontSize: 11, color: C.muted }}>cobrado {m.cob != null ? mm(m.cob) : '—'}{m.i === H ? ' · a la fecha' : ''}</div>
      {at && <div style={{ fontSize: 10.5, fontWeight: 700, color: C.soonText }}>atípico</div>}
    </div>
  }
  return <>
    <Titulo>Resultado del año {Y} · metas · toca Vendido o Cobrado para ver su evolución</Titulo>
    <Grid cols={4} colsM={2}>
      <Kpi tono='a' ic='ventas' label='Vendido' value={cifra(o.vend)} sub={sub(o.vend, 'de la meta')} onClick={() => ir({ drill: { t: 'ind', k: 'vend' } })} />
      <Kpi tono='y' ic='fact' label='Facturado' value={cifra(o.fact)} sub={sub(o.fact, 'de lo vendido')} onClick={() => ir({ drill: { t: 'ind', k: 'fact26' } })} />
      <Kpi tono='g' ic='wal' label='Cobrado' value={cifra(o.cob)} sub={sub(o.cob, 'de la meta')} onClick={() => ir({ drill: { t: 'ind', k: 'cob26' } })} />
      <Kpi tono='w' ic='tax' label='Margen' value={cifra(o.marg)} sub={sub({ pct: o.marg.pct, clp: o.marg.clp }, 'de ingresos')} onClick={() => ir({ drill: { t: 'ind', k: 'marg' } })} />
    </Grid>
    <div style={{ fontSize: 12, color: C.muted, margin: '-6px 4px 0' }}>Cifras de Inicio › Resultado del año {Y}, al {d.hoy.split('-').reverse().join('-')}. {o.metaVentasCLP > 0 ? `Meta de ventas ${mm(o.metaVentasCLP)} netos` : 'Sin meta de ventas'}{o.metaCobroCLP > 0 ? ` y meta de cobranza ${mm(o.metaCobroCLP)}` : ''}; la facturación se mide contra lo vendido y no tiene meta propia.</div>
    <Titulo right={<Btn onClick={() => setUI({ mas: !ui.mas })}>{ui.mas ? 'Ver menos' : 'Ver más'}</Btn>}>Qué más se mira de {Y} · toca cualquier dato</Titulo>
    <Grid cols={4} colsM={2}>{indic.map(([ic, l, v, s, cl, k]) => <Mini key={k} ic={ic} label={l} value={v} sub={s} cls={cl} onClick={() => ir({ drill: { t: 'ind', k } })} />)}</Grid>
    {ui.mas && <Grid cols={4} colsM={2}>{mas.map(([ic, l, v, s, cl, k]) => <Mini key={k} ic={ic} label={l} value={v} sub={s} cls={cl} onClick={() => ir({ drill: { t: 'ind', k } })} />)}</Grid>}
    <Titulo right={<span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{atip.size > 0 && <Chip tono='y'>{atip.size} atípicos</Chip>}{D && <Seg options={[['tarjetas', 'Tarjetas'], ['tabla', 'Tabla']]} value={ui.vm} onChange={(v) => setUI({ vm: v })} />}</span>}>Mes a mes · {Y} contra {Y - 1}</Titulo>
    {ui.vm === 'tabla' && D
      ? <Panel><div style={{ display: 'grid', gridTemplateColumns: '120px repeat(12,minmax(0,1fr))', fontSize: 12 }}>
        <span />{MESC.map((m, i) => <span key={m} onClick={() => ir({ drill: { t: 'mes', i } })} style={{ padding: '9px 6px', textAlign: 'right', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.accent, cursor: 'pointer' }}>{m}</span>)}
        {[['Facturado ' + (Y - 1), (m) => (m.a ? mm(uf ? m.a.facUF : m.a.fac) : '—')], ['Facturado ' + Y, (m) => (m.f ? mm(uf ? m.f.facUF : m.f.fac) : '—')], ['Cobrado ' + Y, (m) => (m.cob != null ? mm(m.cob) : '—')]].map(([t, f]) => [<span key={t} style={{ padding: '10px 12px', borderTop: `1px solid ${C.border}` }}>{t}</span>, ...meses.map((m) => <span key={t + m.i} style={{ padding: '10px 6px', textAlign: 'right', borderTop: `1px solid ${C.border}` }}>{f(m)}</span>)])}
      </div></Panel>
      : <div style={{ display: 'grid', gridTemplateColumns: `repeat(${D ? 6 : 2},minmax(0,1fr))`, gap: 10 }}>{meses.map(tile)}</div>}
    <Panel hd={`Clientes que más facturaron · ${Y}`} small={`los 5 primeros suman ${pc(conc * 100, 0)}`}>
      {d.clientes.length === 0 ? <div style={{ padding: 16, fontSize: 13, color: C.muted }}>Aún no hay facturas emitidas este año.</div>
        : <div style={{ display: 'grid', gridTemplateColumns: D ? '1fr 1fr' : '1fr' }}>{d.clientes.slice(0, 8).map((c, i) => <div key={c.id} style={{ borderRight: D && i % 2 === 0 ? `1px solid ${C.border}` : 'none' }}><Fila nombre={<><span style={{ color: C.done, fontWeight: 700, fontSize: 12, marginRight: 8 }}>{i + 1}</span>{c.name}</>} peq={`${c.n} factura${c.n !== 1 ? 's' : ''} · ${pc((c.monto / d.totalFact) * 100)} de lo facturado`} valor={mm(c.monto)} onClick={() => ir({ drill: { t: 'cli', n: c.id } })} /></div>)}</div>}
    </Panel>
    <Det t='Cómo leer estas cifras'>El Vendido, Facturado, Cobrado y Margen son los de Inicio. Las tarjetas por mes y el ranking de clientes salen del facturado propio por mes de Resultado del año y de las facturas emitidas, y el cobrado por mes, de lo conciliado con el banco por fecha del depósito. {d.base && d.sinBase ? 'Todavía no hay 12 meses cerrados de facturación: la base de la proyección queda en cero. ' : ''}El mes en curso va a la fecha, {d.hoy.split('-').reverse().join('-')}.</Det>
  </>
}

// ── 2 · Base 2027 ──
export function Base({ X }) {
  const { datos: d, est, D, ui, setUI, ir, M, U } = X, uf = est.moneda === 'uf'
  const Y = d.anio, rec = d.recurrente, recAnual = rec.anualCLP
  const b = d.base, tot = b.baseCLP.reduce((a, x) => a + x, 0), totUF = b.baseUF.reduce((a, x) => a + x, 0)
  const origen = (i) => { const c = d.cierres.find((x) => Number(x.ym.slice(5, 7)) - 1 === i); return c ? c.ym.slice(0, 4) : '—' }
  const tile = (i) => <div key={i} onClick={() => ir({ drill: { t: 'mes', i } })} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, cursor: 'pointer', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: C.accent }}>{MESC[i]}</span><Chip tono='z'>{origen(i)}</Chip></div>
    <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.4, color: C.accent }}>{uf ? ufs(b.baseUF[i]) : mm(b.baseCLP[i])}</div>
    <div style={{ fontSize: 11, color: C.muted }}>{uf ? mm(b.baseCLP[i]) : ufs(b.baseUF[i])}</div></div>
  return <>
    <Titulo>De dónde sale el ingreso de {Y}</Titulo>
    <Grid cols={3} colsM={1}>
      <Mini ic='cal' label='Recurrente' value={mm(recAnual)} sub={`${rec.n} ventas mensuales, anualizadas · casi seguro`} cls='pos' onClick={() => ir({ drill: { t: 'ind', k: 'rec' } })} />
      <Mini ic='doc' label='Por facturar' value='lo calcula la app' sub='cuotas pendientes de ventas aceptadas, en Por facturar' cls='amb' onClick={X.irPorFacturar} />
      <Mini ic='tgt' label='Ventas nuevas' value='meta − A − B' sub={`lo que realmente hay que vender en ${Y}`} />
    </Grid>
    <Titulo right={D && <Seg options={[['tarjetas', 'Tarjetas'], ['tabla', 'Tabla']]} value={ui.vm} onChange={(v) => setUI({ vm: v })} />}>Base · últimos 12 meses cerrados · {d.cierres[0]?.ym.slice(5, 7)}-{d.cierres[0]?.ym.slice(2, 4)} a {d.cierres[11]?.ym.slice(5, 7)}-{d.cierres[11]?.ym.slice(2, 4)}</Titulo>
    {d.sinBase && <div style={{ background: C.avisoBg, border: `1px solid ${C.avisoLine}`, color: C.avisoText, borderRadius: 12, padding: '10px 14px', fontSize: 13 }}>No hay facturas emitidas en los últimos 12 meses cerrados: la base queda en cero y el presupuesto no tiene de qué partir.</div>}
    {ui.vm === 'tabla' && D
      ? <Panel><div style={{ display: 'grid', gridTemplateColumns: '120px repeat(12,minmax(0,1fr))', fontSize: 12 }}><span />{MESC.map((m, i) => <span key={m} onClick={() => ir({ drill: { t: 'mes', i } })} style={{ padding: '9px 6px', textAlign: 'right', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: C.accent, cursor: 'pointer' }}>{m}</span>)}
        <span style={{ padding: '10px 12px', borderTop: `1px solid ${C.border}` }}>Facturado base</span>{b.baseCLP.map((v, i) => <span key={i} style={{ padding: '10px 6px', textAlign: 'right', borderTop: `1px solid ${C.border}` }}>{mm(v)}</span>)}
        <span style={{ padding: '10px 12px', borderTop: `1px solid ${C.border}`, color: C.muted }}>En UF</span>{b.baseUF.map((v, i) => <span key={i} style={{ padding: '10px 6px', textAlign: 'right', borderTop: `1px solid ${C.border}`, color: C.muted }}>{nf.format(Math.round(v))}</span>)}</div></Panel>
      : <div style={{ display: 'grid', gridTemplateColumns: `repeat(${D ? 6 : 2},minmax(0,1fr))`, gap: 10 }}>{Array.from({ length: 12 }, (_, i) => tile(i))}</div>}
    <Panel><Fila tot nombre='Total base' peq='en UF de cada mes, para que la UF no distorsione' sub={ufs(totUF)} valor={mm(tot)} sin /></Panel>
    <Grid cols={2} colsM={1} gap={14} style={{ alignItems: 'start' }}>
      <Panel hd='Lo recurrente' small='ventas con cobro mensual activas'>
        <Fila nombre='Ventas mensuales activas' peq={`${rec.n} ventas · anualizadas ×12 como en Ventas`} valor={mm(recAnual)} sub={ufs(rec.anualUF)} onClick={() => ir({ drill: { t: 'ind', k: 'rec' } })} />
        <Fila tot sin nombre='Promedio mensual' valor={mm(recAnual / 12)} />
      </Panel>
      <Panel hd='Cómo se proyecta cada mes' pad><Lista items={['Cada mes de ' + Y + ' parte del mismo mes de la base, en UF.', 'Se multiplica por 1 + el crecimiento real del escenario.', 'Se convierte a pesos con la UF de ese mes de ' + Y + '.', 'La estacionalidad sale de los datos, no de un promedio plano.']} /></Panel>
    </Grid>
  </>
}

// ── 3 · Costos ──
export function Costos({ X }) {
  const { datos: d, est, D, ui, setUI, M, setCosto, addCosto, delCosto, resetCostos, setPal } = X
  const k = est.esc, p = est.p[k], e = M.esc[k], nomE = X.nomEsc(k), tot26 = est.costos.reduce((a, c) => a + c.m * 12, 0)
  const val = (c, kk) => c.m * c.meses * (1 + (c.alza == null ? est.p[kk].alza : c.alza) / 100)
  const dif = e.costos - tot26, Y = d.anio
  const grupo = (t, tit, col) => {
    const it = est.costos.map((c, i) => [c, i]).filter(([c]) => c.t === t); if (!it.length) return null
    return <div key={t}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 10, background: C.bgSoft, padding: '9px 16px', borderTop: `1px solid ${C.border}`, ...({ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: C.accent }) }}><span><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: col, marginRight: 8 }} />{tit}</span><b>{mm(it.reduce((a, [c]) => a + val(c, k), 0))}</b></div>
      {it.map(([c, i]) => {
        const v = val(c, k), b = c.m * 12, dd = b ? (v / b - 1) * 100 : null, abierto = ui.abierta === i
        const peq = [c.meses < 12 ? c.meses + ' meses' : '', c.alza != null ? 'alza ' + String(c.alza).replace('.', ',') + ' %' : ''].filter(Boolean).join(' · ')
        return <Fila key={c.id} nombre={c.n} peq={peq || null} sub={<span><span style={{ marginRight: 14 }}>{mm(b)}</span><Chip tono='z'>{dd == null ? '—' : sgn(dd) + pc(Math.abs(dd))}</Chip></span>} valor={mm(v)} abierta={abierto} onClick={() => setUI({ abierta: abierto ? null : i })}>
          {abierto && <div style={{ background: C.bgSoft, padding: '2px 16px 14px', display: 'grid', gridTemplateColumns: D ? 'minmax(0,1.6fr) minmax(0,1fr) minmax(0,.8fr) minmax(0,.8fr)' : 'repeat(2,minmax(0,1fr))', gap: 10, alignItems: 'end' }}>
            <div style={{ gridColumn: D ? undefined : '1 / -1' }}><div style={eti}>Nombre</div><Fld text value={c.n} onCommit={(x) => setCosto(i, 'n', x)} /></div>
            <div><div style={eti}>Monto por mes</div><Fld kind='money' pre='$' w={150} value={c.m} onCommit={(x) => setCosto(i, 'm', Math.max(0, x))} /></div>
            <div><div style={eti}>Meses</div><Fld kind='int' suf='de 12' w={96} value={c.meses} onCommit={(x) => setCosto(i, 'meses', Math.min(12, Math.max(0, Math.round(x))))} /></div>
            <div><div style={eti}>Alza propia</div><Fld kind='pct' suf='%' w={96} ph={String(p.alza).replace('.', ',')} value={c.alza} onCommit={(x) => setCosto(i, 'alza', x)} /></div>
            <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12, color: C.muted }}>
              <Seg options={[['fijo', 'Fijo'], ['discrecional', 'Discrecional']]} value={c.t} onChange={(x) => setCosto(i, 't', x)} />
              <span>{X.ESC.map(([kk, n], j) => <span key={kk}>{j ? ' · ' : ''}{n} <b style={{ color: C.text }}>{mm(val(c, kk))}</b></span>)}</span>
              <Lnk rojo onClick={() => delCosto(i)}>Quitar partida</Lnk>
            </div></div>}
        </Fila>
      })}
    </div>
  }
  const lado = <>
    <Panel hd='Qué se ajusta de 2026' pad flex><Lista items={['Remuneraciones: líquido real de las liquidaciones; el bono de enero no se repite.', 'Leyes sociales: parte del empleador al último valor real (octubre sigue provisoria).', 'Gastos reembolsables a clientes: no son costo ni ingreso, quedan fuera.', 'Comisiones: salen de la regla de la app, como pago a terceros.']} /></Panel>
    <Panel hd='Cómo usarlo' pad flex><Lista items={[<span><b>Contratar a alguien desde julio:</b> agrega la partida con su líquido más leyes sociales por mes y 6 meses.</span>, <span><b>Un gasto único</b> (mudanza, equipamiento): 1 mes.</span>, <span><b>Quitar una partida:</b> «Quitar partida» en su editor; «Restaurar» vuelve a los valores vigentes.</span>, 'Comisiones se ajusta con los botones de la cabecera: es un porcentaje de lo cobrado.']} /></Panel>
  </>
  return <>
    <Titulo>Costos {Y} · toca una partida para editarla</Titulo>
    <Grid cols={3} colsM={1}>
      <Mini ic='doc' label='Presupuesto vigente' value={mm(tot26)} sub='costos de oficina × 12, sin PPM' />
      <Mini ic='egr' label={`Costos ${nomE} ${Y}`} value={mm(e.costos)} sub={`${sgn(dif)}${mm(Math.abs(dif))} contra hoy`} />
      <Mini ic='com' label='Comisiones' value={mm(e.terc)} sub={`${pc(p.terc)} de lo cobrado`} />
    </Grid>
    <div style={{ display: 'grid', gridTemplateColumns: D ? 'minmax(0,1fr) 290px' : '1fr', gap: 14, alignItems: 'stretch' }}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <Panel flex hd={`Partidas · ${nomE}`} small={<span style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}><span>Alza de costos <Stp value={p.alza} suf='%' step={0.5} min={0} max={20} onChange={(v) => setPal(k, 'alza', v)} /></span><span>Terceros <Stp value={p.terc} suf='%' step={1} min={0} max={60} onChange={(v) => setPal(k, 'terc', v)} /></span></span>}>
          {D && <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto auto', gap: 10, padding: '10px 16px', ...eti2 }}><span>Partida</span><span style={{ textAlign: 'right', minWidth: 150 }}>2026 /año · cambio</span><span style={{ textAlign: 'right', minWidth: 110 }}>{Y}</span></div>}
          {grupo('fijo', 'Fijos', C.accent)}{grupo('discrecional', 'Discrecionales', C.soonText)}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', background: C.bgSoft, padding: '9px 16px', borderTop: `1px solid ${C.border}`, ...eti2 }}><span><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: C.tealText, marginRight: 8 }} />Variables</span><b>{mm(e.terc)}</b></div>
          <Fila nombre='Comisiones' peq={`${pc(p.terc)} de lo cobrado · se ajusta arriba`} valor={mm(e.terc)} onClick={() => X.irEsc('res')} />
          <Fila tot sin nombre='Costos de oficina + terceros' valor={mm(e.costos + e.terc)} />
          <div onClick={addCosto} style={{ padding: '12px 16px', borderTop: `1px solid ${C.border}`, fontSize: 13, fontWeight: 700, color: C.accent, cursor: 'pointer' }}>+ Agregar partida</div>
        </Panel>
        <div style={{ fontSize: 12, color: C.muted, margin: '6px 4px 0' }}><Lnk onClick={resetCostos}>Restaurar los valores vigentes</Lnk> · 6 meses sirve para una contratación desde julio; 1 mes, para un gasto único.</div>
      </div>
      {D ? <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{lado}</div> : lado}
    </div>
  </>
}
const eti = { fontSize: 10.5, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: C.accent, marginBottom: 4 }
const eti2 = { fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: C.accent }
