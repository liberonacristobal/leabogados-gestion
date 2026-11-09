// Presupuesto anual · etapas 4 y 5 (Escenarios con resultado, impuesto y por socio; Seguimiento) y las páginas de detalle (mes, cliente, indicador, socio, versiones).
import { useEffect, useRef, useState } from 'react'
import { C, appAlert } from '../lib/base.jsx'
import { modeloPresupuesto, diferenciaSupuestos, parteMeta, tasaPPMLegal } from '../../supabase/functions/_shared/presupuesto.js'
import { descargarLibroPresupuesto } from '../lib/presupuestoExcel.js'
import { nf, mm, pes, ufs, pc, sgn, MESL, MESC, fmtIn, Ic, Kpi, Mini, Titulo, Panel, Seg, Chip, Btn, Lnk, Fld, Stp, Fila, Det, Lista, Grid, LBL } from '../lib/presupuestoUI.jsx'

const ym = (y, i) => `${y}-${String(i + 1).padStart(2, '0')}`
const fechaDMY = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

// Tabla de cifras con una columna por escenario; en celular, solo la del escenario elegido (sin desplazamiento horizontal).
function Filas({ X, filas, tit }) {
  const { D, est } = X, cols = D ? X.ESC : X.ESC.filter(([k]) => k === est.esc)
  const g = `minmax(0,1fr) ${cols.map(() => '104px').join(' ')}`
  return <Panel>
    <div style={{ display: 'grid', gridTemplateColumns: g, gap: 10, padding: '10px 16px', fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: C.accent }}><span>{tit || ''}</span>{cols.map(([k, n]) => <span key={k} style={{ textAlign: 'right' }}>{n}</span>)}</div>
    {filas.map(([op, t, f, tot, go], i) => <div key={i} onClick={go} style={{ display: 'grid', gridTemplateColumns: g, gap: 10, padding: '10px 16px', borderTop: tot ? `2px solid ${C.accent}` : `1px solid ${C.border}`, background: tot ? C.bgSoft : 'transparent', fontWeight: tot ? 800 : 400, fontSize: 13, cursor: go ? 'pointer' : 'default' }}>
      <span><span style={{ display: 'inline-block', width: 16, color: C.textSoft, fontWeight: 700 }}>{op}</span>{t}{go ? <span style={{ color: C.done }}> ›</span> : null}</span>
      {cols.map(([k]) => <span key={k} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{f(X.M.esc[k])}</span>)}</div>)}
  </Panel>
}

// ── 4 · Escenarios ──
function Strip({ X }) {
  const { est, setGen, D } = X
  const campos = [['Reajuste UF', 'reajusteUF', 'pct', { suf: '%' }, 'Supuesto de inflación'], ['Tasa 1ª categoría', 'tasaIDPC', 'pct', { suf: '%' }, 'Pro Pyme · circular SII 53/2025'], ['PPM del año', 'ppmAnual', 'money', { pre: '$' }, 'Lo pagado hoy ($' + nf.format(Math.round(X.datos.ppmMes)) + ' al mes) · tasa legal ' + pc(tasaPPMLegal(X.datos.anio, X.datos.oficiales.fact.uf), 3) + ', por confirmar'], ['Reserva de caja', 'reserva', 'pct', { suf: '%' }, '% del resultado que no se retira']]
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(${D ? 4 : 2},minmax(0,1fr))`, gap: 10, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '10px 14px' }}>
    {campos.map(([t, f, k, u, n]) => <div key={f} style={{ minWidth: 0 }}><div style={{ ...LBL, fontSize: 10.5, color: C.accent, marginBottom: 4 }}>{t}</div><Fld kind={k} value={est[f]} onCommit={(v) => setGen(f, v)} w={9999} {...u} /><div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{n}</div></div>)}
  </div>
}

function CardEsc({ X, k }) {
  const { est, M, setPal, setEsc } = X, irEscTab = X.irEscTab, e = M.esc[k], p = est.p[k], b = M.esc.base, sel = est.esc === k
  const xr = (t, v, go, strong) => <div onClick={(ev) => { if (go) { ev.stopPropagation(); go() } }} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 4px', borderTop: `1px solid ${C.border}`, fontSize: 12.5, cursor: go ? 'pointer' : 'default', fontWeight: strong ? 800 : 400 }}><span>{t}</span><b style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{X.fm(v)}</b></div>
  const lv = (t, f, suf, d, mn, mx, int) => <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}><small style={{ ...LBL, fontSize: 10.5, color: C.accent }}>{t}</small><Stp value={p[f]} suf={suf} step={d} min={mn} max={mx} int={int} onChange={(v) => { setPal(k, f, v); setEsc(k) }} /></div>
  return <div onClick={() => setEsc(k)} style={{ background: C.card, border: sel ? `2px solid ${C.accent}` : `1px solid ${C.border}`, borderRadius: 12, padding: sel ? 13 : 14, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, boxSizing: 'border-box' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}><b style={{ color: C.accent, fontSize: 15 }}>{X.nomEsc(k)}</b>{sel && <Chip>elegido</Chip>}{k !== 'base' && <Chip tono={e.retiros >= b.retiros ? 'g' : 'r'}>{sgn(e.retiros - b.retiros)}{mm(Math.abs(e.retiros - b.retiros))} vs Base</Chip>}</div>
    <div style={{ ...LBL, color: C.muted }}>Retiros</div>
    <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.6, color: e.retiros > 0 ? C.greenText : C.overdueText, lineHeight: 1.1 }}>{X.fm(e.retiros)}</div>
    <div style={{ fontSize: 11, color: C.muted }}>{X.fmS(e.retiros / 24)} por socio al mes</div>
    <div style={{ marginTop: 6 }}>{xr('Cobrado', e.caja, () => X.irBase())}{xr('− Comisiones', e.terc, () => X.irCostos())}{xr('− Costos de oficina', e.costos, () => X.irCostos())}{xr('− Impuesto', e.idpc, () => irEscTab('imp'))}{xr('− Reserva de caja', e.reserva)}</div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8, borderTop: `1px solid ${C.border}`, paddingTop: 10, marginTop: 6 }}>{lv('Ventas', 'g', '%', 1, -30, 80)}{lv('Costos', 'alza', '%', 0.5, 0, 20)}{lv('Cobro', 'dias', 'd', 5, 0, 90, true)}</div>
  </div>
}



function TabImp({ X }) {
  const { est, M, setEsc } = X
  return <>
    <Grid cols={3} colsM={1}>{X.ESC.map(([k, n]) => { const e = M.esc[k], sel = est.esc === k
      return <div key={k} onClick={() => setEsc(k)} style={{ background: C.card, border: sel ? `2px solid ${C.accent}` : `1px solid ${C.border}`, borderRadius: 12, padding: sel ? 13 : 14, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><b style={{ color: C.accent, fontSize: 15 }}>{n}</b>{sel && <Chip>elegido</Chip>}</div>
        <div style={{ ...LBL, color: C.muted }}>Saldo en abril de {X.datos.anio + 1}</div>
        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.6, color: e.saldo > 0 ? C.soonText : C.greenText, lineHeight: 1.1 }}>{X.fm(Math.abs(e.saldo))}</div>
        <div style={{ fontSize: 11, color: C.muted }}>{e.saldo >= 0 ? 'por pagar' : 'a favor'}</div>
        <div style={{ marginTop: 6 }}>{[['Base imponible', X.fm(e.base)], ['× Tasa de primera categoría', pc(est.tasaIDPC)], [`= Impuesto del año ${X.datos.anio}`, X.fm(e.idpc), 1], [`− PPM pagados en ${X.datos.anio}`, X.fm(e.ppm)], ['Impuesto sobre el resultado', pc((e.idpc / Math.max(1, e.base)) * 100)]].map(([t, v, s]) => <div key={t} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 4px', borderTop: `1px solid ${C.border}`, fontSize: 12.5, fontWeight: s ? 800 : 400 }}><span>{t}</span><b style={{ fontWeight: 700 }}>{v}</b></div>)}</div></div> })}</Grid>
    <Panel hd='Calendario y alcance' pad><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Chip>{`Cada mes · PPM en el F29 (hoy ${pes(X.datos.ppmMes)} al mes)`}</Chip><Chip>{`Abril ${X.datos.anio + 1} · declaración anual de ${X.datos.anio}`}</Chip><Chip>Sin IVA · no hay crédito fiscal</Chip><Chip tono='y'>Fuera: impuesto personal de los socios, depreciación · tasa de PPM por confirmar</Chip></div></Panel>
  </>
}

// Metas de la oficina por escenario (las mismas de la tarjeta «Metas») y la parte de cada socio.
const metasEsc = (X, k) => ({ ventas: X.datos.oficiales.vend.uf * (1 + X.est.p[k].g / 100) * X.M.ufMed, fact: X.M.esc[k].fact, cobro: X.M.esc[k].caja })

function TabSoc({ X }) {
  const { est, M, datos: d } = X, e = M.esc[est.esc], tot = d.socios.reduce((a, s) => a + s.facturado, 0), mt = metasEsc(X, est.esc)
  return <>
    <Panel hd={`Por socio · ${X.nomEsc(est.esc)}`} small={`metas en partes iguales (${pc(parteMeta(d.socios, d.socios[0]?.nombre) * 100, 0)} cada socio) · retiros iguales`}>
      {d.socios.map((s) => { const sh = tot ? s.facturado / tot : 0, sin = s.nombre === 'Sin socio', pm = parteMeta(d.socios, s.nombre)
        return <Fila key={s.nombre} nombre={s.nombre} peq={`${pc(sh * 100)} de lo facturado en ${d.anioBase}${sin ? '' : ' · retiros ' + X.fmS(e.retiros / 24) + ' por mes'}`} sub={sin ? 'facturado ' + X.fmS(e.fact * sh) : `meta de ventas ${X.fmS(mt.ventas * pm)} · cobro ${X.fmS(mt.cobro * pm)}`} valor={sin ? '—' : X.fm(e.retiros / 2)} onClick={() => X.ir({ drill: { t: 'soc', n: s.nombre } })} /> })}
      <Fila tot sin nombre='Oficina' sub={`meta de ventas ${X.fmS(mt.ventas)} · cobro ${X.fmS(mt.cobro)}`} valor={X.fm(e.retiros)} />
    </Panel>
  </>
}

function Metas({ X }) {
  const { est, M, datos: d } = X, k = est.esc, o = d.oficiales
  const datos = [
    { c: 'a', ic: 'ventas', t: 'Ventas', nota: 'vendido ' + d.anioBase + ' × (1 + crecimiento)', ref: 'UF ' + nf.format(Math.round(o.vend.uf)), refs: (o.vend.pct != null ? pc(o.vend.pct, 0) + ' de la meta' + (o.metaVentasCLP ? ' de ' + mm(o.metaVentasCLP) : '') : 'sin meta'), fn: (kk) => o.vend.uf * (1 + est.p[kk].g / 100) * M.ufMed, uf: (kk) => o.vend.uf * (1 + est.p[kk].g / 100), base: o.vend.uf },
    { c: 'y', ic: 'fact', t: 'Facturación', nota: 'sin meta propia en ' + d.anioBase, ref: 'UF ' + nf.format(Math.round(o.fact.uf)), refs: (o.fact.pct != null ? pc(o.fact.pct, 0) + ' de lo vendido' : ''), fn: (kk) => M.esc[kk].fact, uf: (kk) => M.esc[kk].factUF, base: o.fact.uf },
    { c: 'g', ic: 'wal', t: 'Cobro', nota: 'cobrado en el año, plano caja', ref: 'UF ' + nf.format(Math.round(o.cob.uf)), refs: (o.cob.pct != null ? pc(o.cob.pct, 0) + ' de la meta' + (o.metaCobroCLP ? ' de ' + mm(o.metaCobroCLP) : '') : 'sin meta'), fn: (kk) => M.esc[kk].caja, uf: (kk) => M.esc[kk].caja / M.ufMed, base: o.cob.uf },
  ]
  const tono = { a: { bg: C.azulBg, fg: C.azulInfo, v: C.accent }, y: { bg: C.soonBg, fg: C.soonText, v: C.soonText }, g: { bg: C.greenBg, fg: C.greenText, v: C.greenText } }
  const fmS = (v) => (X.est.moneda === 'uf' ? ufs(v / M.ufMed) : mm(v))
  return <>
    <Titulo right={<span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500, color: C.muted }}>punto de partida: se mueven con los supuestos de cada escenario</span>}>Metas {d.anio} · escenario {X.nomEsc(k)}</Titulo>
    <Grid cols={3} colsM={1}>{datos.map((m) => { const t = tono[m.c], v = m.fn(k), dd = m.base ? (m.uf(k) / m.base - 1) * 100 : null
      return <div key={m.t} style={{ background: t.bg, color: t.fg, borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ width: 32, height: 32, borderRadius: 10, background: C.card, display: 'grid', placeItems: 'center', flexShrink: 0 }}><Ic n={m.ic} s={18} /></span><span style={{ ...LBL }}>Meta de {m.t}</span><span onClick={() => X.irMirada()} style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>Ver {d.anioBase} ›</span></div>
        <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.8, lineHeight: 1.1, color: t.v }}>{X.fm(v)}</div>
        {dd != null && <div style={{ fontSize: 12.5 }}><b>{sgn(dd)}{pc(Math.abs(dd), 0)}</b> contra {d.anioBase} a la fecha</div>}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '4px 0' }}>{X.ESC.map(([kk, n]) => <button key={kk} onClick={() => X.setEsc(kk)} style={{ border: kk === k ? '1px solid currentColor' : '1px solid transparent', background: kk === k ? C.card : 'rgba(255,255,255,.55)', color: 'inherit', borderRadius: 20, padding: '3px 7px', fontFamily: 'inherit', fontSize: 10.5, fontWeight: kk === k ? 700 : 400, cursor: 'pointer', whiteSpace: 'nowrap' }}>{n} <b>{fmS(m.fn(kk))}</b></button>)}</div>
        <div style={{ fontSize: 11.5, opacity: 0.9 }}>{d.anioBase} a la fecha: <b>{m.ref}</b>{m.refs ? ' · ' + m.refs : ''}</div>
        <div style={{ fontSize: 11.5, opacity: 0.9 }}>{m.nota} · {fmS(v / 12)} por mes</div></div> })}</Grid>
  </>
}

export function Escenarios({ X }) {
  const { est, M, D, ui, setUI, datos: d } = X
  const tabs = [['res', 'Resultado'], ['imp', 'Impuesto'], ['soc', 'Por socio']]
  const cuerpo = ui.tab === 'imp' ? <TabImp X={X} /> : ui.tab === 'soc' ? <TabSoc X={X} /> : <Grid cols={3} colsM={1}>{X.ESC.map(([k]) => <CardEsc key={k} X={X} k={k} />)}</Grid>
  const cascada = [['', 'Facturado', (x) => X.fm(x.fact)], ['−', 'Variación de cuentas por cobrar', (x) => X.fm(x.dCob)], ['=', 'Cobrado (caja)', (x) => X.fm(x.caja), 1], ['−', 'Comisiones', (x) => X.fm(x.terc)], ['−', 'Costos de oficina', (x) => X.fm(x.costos)], ['=', 'Resultado antes de impuesto', (x) => X.fm(x.base), 1], ['−', 'Impuesto de primera categoría', (x) => X.fm(x.idpc)], ['=', 'Resultado después de impuesto', (x) => X.fm(x.post), 1], ['−', 'Reserva de caja', (x) => X.fm(x.reserva)], ['=', 'Retiros de los socios', (x) => X.fm(x.retiros), 1]]
  const excel = () => descargarLibroPresupuesto({
    anio: d.anio, anioBase: d.anioBase, ufDic: d.ufDic, baseCLP: d.base.baseCLP, baseUF: d.base.baseUF, est, ESC: X.ESC, costos: est.costos, socios: d.socios, oficiales: d.oficiales,
    mes26: Array.from({ length: 12 }, (_, i) => { const k = (y) => `${y}-${String(i + 1).padStart(2, '0')}`; return { a: d.serie[k(d.anioBase - 1)]?.fac ?? null, f: d.serie[k(d.anioBase)]?.fac ?? null, cob: d.cobMes[k(d.anioBase)] ?? null } }),
  }, (t) => appAlert(t))
  const e = M.esc[est.esc]
  const mensual = <div>{MESC.map((m, i) => <Fila key={m} nombre={MESL[i]} sub={ufs(e.ingUF[i])} valor={mm(e.ing[i])} onClick={() => X.ir({ drill: { t: 'mes', i } })} />)}</div>
  const dg = { display: 'grid', gridTemplateColumns: D ? '1fr 1fr' : '1fr', gap: 10, alignItems: 'start' }
  return <>
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
      <Seg options={tabs} value={ui.tab} onChange={(v) => setUI({ tab: v })} />
      <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><Btn onClick={excel}>Descargar Excel</Btn></span>
    </div>
    {ui.tab !== 'soc' && <Strip X={X} />}
    {cuerpo}
    {ui.tab === 'res' && <Metas X={X} />}
    <div style={dg}>
      {ui.tab === 'res' && <>
        <Det t={`Metas ${d.anio} · tabla por escenario`}><MetasTabla X={X} /></Det>
        <Det t='Cascada completa por escenario'><div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>Plano caja · exento de IVA: lo facturado es el neto · UF promedio supuesta {nf.format(Math.round(M.ufMed))}</div><Filas X={X} filas={cascada} /></Det>
        <Det t={`Facturado mes a mes · ${X.nomEsc(est.esc)}`}>{mensual}</Det>
        <Det t='Por qué estos valores'><Lista items={[<span><b>Crecimiento real de ventas 0 / 10 / 25 %:</b> se aplica en UF sobre la base de {d.anioBase}. Es un criterio, no un cálculo: no hay conversión de propuestas para estimar la cartera nueva. El 10 % base supera el reajuste de la UF.</span>, <span><b>Alza de costos:</b> reajuste de sueldos más IPC; el prudente usa 6 % por si la inflación sorprende.</span>, <span><b>Comisiones:</b> parte de lo cobrado, la real de {d.anioBase}{d.terc != null ? ' (' + pc(d.terc) + ')' : ''}.</span>, <span><b>Días de cobro:</b> el prudente supone más días que el promedio real{d.dias.promedio != null ? ' (' + d.dias.promedio + ' días, mediana ' + d.dias.mediana + ')' : ''}.</span>, <span><b>Tasa de primera categoría:</b> 15 % para el año comercial {d.anio}, indicada por Cristóbal; editable.</span>, <span><b>Reserva:</b> por definir.</span>]} /></Det>
      </>}
      {ui.tab === 'imp' && <>
        <Det t='Qué se paga y cuándo'><Lista items={[<span><b>Cada mes:</b> PPM en el F29 del mes siguiente (hoy {pes(d.ppmMes)} presupuestados).</span>, <span><b>Abril de {d.anio + 1}:</b> declaración anual de {d.anio}; se paga el saldo o se pide la devolución.</span>, <span><b>Sin IVA:</b> no hay IVA que proyectar ni crédito fiscal.</span>, <span><b>Boletas de honorarios:</b> las retenciones siguen yendo al F29, como hoy.</span>]} /></Det>
        <Det t='Lo que no se proyecta aquí'><Lista items={['El impuesto personal de cada socio por sus retiros.', 'Depreciación y gastos rechazados: se estiman con la contadora.', 'Tasa de PPM: se mantiene lo pagado hoy (conservador); la legal Pro Pyme es menor, por confirmar con la contadora.']} /></Det>
      </>}
    </div>
  </>
}

// Tabla de metas por escenario (las tres filas: ventas, facturación y cobro), con las mismas cifras de las tarjetas.
function MetasTabla({ X }) {
  const { est, M, datos: d } = X, o = d.oficiales
  const fil = [['Ventas', 'vendido × (1 + crecimiento)', 'UF ' + nf.format(Math.round(o.vend.uf)), (kk) => o.vend.uf * (1 + est.p[kk].g / 100) * M.ufMed], ['Facturación', 'sin meta propia', 'UF ' + nf.format(Math.round(o.fact.uf)), (kk) => M.esc[kk].fact], ['Cobro', 'cobrado en el año, plano caja', 'UF ' + nf.format(Math.round(o.cob.uf)), (kk) => M.esc[kk].caja]]
  const cols = X.D ? X.ESC : X.ESC.filter(([k]) => k === est.esc), g = `minmax(0,1fr) ${X.D ? '110px ' : ''}${cols.map(() => '100px').join(' ')}`
  return <Panel><div style={{ display: 'grid', gridTemplateColumns: g, gap: 10, padding: '10px 16px', ...LBL, color: C.accent }}><span />{X.D && <span style={{ textAlign: 'right' }}>{d.anioBase} a la fecha</span>}{cols.map(([k, n]) => <span key={k} style={{ textAlign: 'right' }}>{n}</span>)}</div>
    {fil.map(([t, nota, ref, f]) => <div key={t} style={{ display: 'grid', gridTemplateColumns: g, gap: 10, padding: '10px 16px', borderTop: `1px solid ${C.border}`, fontSize: 13 }}><span>{t}<div style={{ fontSize: 11, color: C.muted }}>{nota}</div></span>{X.D && <span style={{ textAlign: 'right' }}>{ref}</span>}{cols.map(([k]) => <span key={k} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{X.fm(f(k))}</span>)}</div>)}</Panel>
}

// ── 5 · Seguimiento (presupuesto contra real) ──
export function Seguimiento({ X }) {
  const { est, M, D, datos: d } = X, Y = d.anio
  const of = X.vers.find((v) => v.oficial), k = of ? of.estado.esc : est.esc
  const mens = of && of.resumen && of.resumen[k] && of.resumen[k].mensual ? of.resumen[k].mensual : M.esc[k].ing
  const hoyY = Number(d.hoy.slice(0, 4)), hoyM = Number(d.hoy.slice(5, 7))
  const cerrado = (i) => Y < hoyY || (Y === hoyY && i + 1 < hoyM)
  const real = (i) => (cerrado(i) ? d.serie[ym(Y, i)]?.fac ?? null : null)
  let acc = 0, realAcc = 0, presCerr = 0
  const filas = MESL.map((_, i) => { acc += mens[i]; const r = real(i); if (r != null) { realAcc += r; presCerr += mens[i] }
    return { i, pres: mens[i], acc, r, des: r != null ? r - mens[i] : null } })
  const tot = mens.reduce((a, x) => a + x, 0), proy = realAcc + filas.filter((f) => f.r == null).reduce((a, f) => a + f.pres, 0), desv = realAcc - presCerr
  const avisos = []
  if (presCerr > 0 && realAcc < presCerr * 0.9) avisos.push(`Facturado acumulado ${mm(realAcc)} contra ${mm(presCerr)} presupuestados (${pc((realAcc / presCerr - 1) * 100, 0)}).`)
  if (d.dias.promedio != null && d.dias.promedio > est.p[k].dias) avisos.push(`Días de cobro reales ${d.dias.promedio} sobre los ${est.p[k].dias} supuestos.`)
  const mayor = d.clientes[0], tope = 15
  if (mayor && d.totalFact && (mayor.monto / d.totalFact) * 100 > tope) avisos.push(`${mayor.name} concentra ${pc((mayor.monto / d.totalFact) * 100, 0)} de lo facturado (tope ${tope} %).`)
  const lado = <>
    <Panel hd='Avisos que se anticipan' pad flex>
      {avisos.length ? <Lista items={avisos} /> : <div style={{ fontSize: 13, color: C.muted }}>Sin avisos por ahora.</div>}
      <div style={{ fontSize: 12, color: C.muted, marginTop: 10 }}>Se calculan con lo real del año: facturado contra presupuesto, días de cobro y concentración.</div>
    </Panel>
  </>
  return <>
    <Titulo>Presupuesto vs real · {Y} · {X.nomEsc(k)}{of ? ' · versión oficial «' + of.nombre + '»' : ' · borrador (sin versión oficial)'}</Titulo>
    <Grid cols={4} colsM={2}>
      <Mini ic='doc' label='Presupuesto' value={mm(tot)} sub={`facturado ${Y}`} onClick={() => X.irEsc('res')} />
      <Mini ic='egr' label='Real' value={realAcc > 0 ? mm(realAcc) : 'sin dato'} sub={realAcc > 0 ? 'meses cerrados' : `se llena desde enero de ${Y}`} />
      <Mini ic='alerta' label='Desvío' value={presCerr > 0 ? (desv >= 0 ? '+' : '−') + mm(Math.abs(desv)) : '—'} sub='solo meses cerrados' cls={presCerr > 0 ? (desv >= 0 ? 'pos' : 'neg') : 'amb'} />
      <Mini ic='res' label='Facturado proyectado' value={mm(proy)} sub='real de los meses cerrados + presupuesto de los que faltan' />
    </Grid>
    <div style={{ display: 'grid', gridTemplateColumns: D ? 'minmax(0,1fr) 290px' : '1fr', gap: 14, alignItems: 'stretch' }}>
      <Panel hd='Mes a mes' flex>
        <div style={{ display: 'grid', gridTemplateColumns: D ? 'minmax(0,1fr) 100px 100px 100px 90px' : 'minmax(0,1fr) 90px 90px', gap: 10, padding: '10px 16px', ...LBL, color: C.accent }}><span>Mes</span><span style={{ textAlign: 'right' }}>Presup.</span>{D && <span style={{ textAlign: 'right' }}>Acumulado</span>}<span style={{ textAlign: 'right' }}>Real</span>{D && <span style={{ textAlign: 'right' }}>Desvío</span>}</div>
        {filas.map((f) => <div key={f.i} onClick={() => X.ir({ drill: { t: 'mes', i: f.i } })} style={{ display: 'grid', gridTemplateColumns: D ? 'minmax(0,1fr) 100px 100px 100px 90px' : 'minmax(0,1fr) 90px 90px', gap: 10, padding: '12px 16px', borderTop: `1px solid ${C.border}`, fontSize: 13, cursor: 'pointer' }}>
          <span style={{ fontWeight: 600 }}>{MESL[f.i]}</span><span style={{ textAlign: 'right' }}>{mm(f.pres)}</span>{D && <span style={{ textAlign: 'right' }}>{mm(f.acc)}</span>}<span style={{ textAlign: 'right', color: f.r == null ? C.muted : C.text }}>{f.r == null ? <Chip tono='y'>Estimado</Chip> : mm(f.r)}</span>{D && <span style={{ textAlign: 'right', color: f.des == null ? C.muted : f.des >= 0 ? C.greenText : C.overdueText, fontWeight: 700 }}>{f.des == null ? '—' : (f.des >= 0 ? '+' : '−') + mm(Math.abs(f.des))}</span>}</div>)}
      </Panel>
      {D ? <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{lado}</div> : lado}
    </div>
  </>
}

// ── Páginas de detalle ──
const nombreMes = (i) => MESL[i]
function Pager({ prev, next }) {
  const b = (x, izq) => <button disabled={!x} onClick={x ? x.go : undefined} style={{ border: `1px solid ${C.border}`, background: C.card, color: C.accent, fontFamily: 'inherit', fontWeight: 700, fontSize: 13, padding: '9px 16px', borderRadius: 20, cursor: x ? 'pointer' : 'default', opacity: x ? 1 : 0.35 }}>{izq ? '‹ ' : ''}{x ? x.t : '—'}{izq ? '' : ' ›'}</button>
  return <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>{b(prev, true)}{b(next, false)}</div>
}

export function DMes({ X, i }) {
  const { datos: d, M, est } = X, Y = d.anioBase, f = d.serie[ym(Y, i)], a = d.serie[ym(Y - 1, i)], cob = d.cobMes[ym(Y, i)], H = Number(d.hoy.slice(5, 7)) - 1
  const futuro = i > H, par = i === H
  const x = f && a && a.fac ? (f.fac / a.fac - 1) * 100 : null
  const notas = []
  if (par) notas.push(`Mes en curso: cifras a la fecha, ${d.hoy.split('-').reverse().join('-')}.`)
  return <>
    <Grid cols={4} colsM={2}>
      <Mini ic='ventas' label={`Facturado ${Y}`} value={f && !futuro ? mm(f.fac) : '—'} sub={x != null ? `${sgn(x)}${pc(Math.abs(x), 0)} contra ${Y - 1}` : futuro ? 'aún no ocurre' : ''} cls={x == null ? '' : x >= 0 ? 'pos' : 'neg'} />
      <Mini ic='wal' label={`Cobrado ${Y}`} value={cob != null && !futuro ? mm(cob) : '—'} sub='por fecha del depósito' />
      <Mini ic='doc' label={`Facturado ${Y - 1}`} value={a ? mm(a.fac) : '—'} sub='mismo mes del año anterior' />
      <Mini ic='cal' label='UF del mes' value={nf.format(Math.round(M.uf27[i]))} sub={`${d.anio} proyectada`} />
    </Grid>
    <Titulo>Proyección de {MESL[i].toLowerCase()} de {d.anio} · toca un escenario</Titulo>
    <Grid cols={3} colsM={1}>{X.ESC.map(([k, n]) => <Mini key={k} ic='tgt' label={n + (k === est.esc ? ' · elegido' : '')} value={mm(M.esc[k].ing[i])} sub={ufs(M.esc[k].ingUF[i])} onClick={() => X.irEscTab('res')} />)}</Grid>
    {notas.length > 0 && <Panel hd='Notas del mes' pad><Lista items={notas} /></Panel>}
    <Pager prev={i > 0 && { t: MESL[i - 1], go: () => X.irDrill({ t: 'mes', i: i - 1 }) }} next={i < 11 && { t: MESL[i + 1], go: () => X.irDrill({ t: 'mes', i: i + 1 }) }} />
  </>
}

export function DCli({ X, id }) {
  const { datos: d } = X, i = d.clientes.findIndex((c) => c.id === id), c = d.clientes[i]
  if (!c) return <div style={{ background: C.avisoBg, border: `1px solid ${C.avisoLine}`, borderRadius: 12, padding: 14, fontSize: 13 }}>Ese cliente ya no está entre los facturados del año.</div>
  const acum = d.clientes.slice(0, i + 1).reduce((a, x) => a + x.monto, 0)
  return <>
    <Grid cols={4} colsM={2}>
      <Mini ic='ventas' label={`Facturado ${d.anioBase}`} value={mm(c.monto)} sub='de enero a la fecha' cls='pos' />
      <Mini ic='gauge' label='Parte de lo facturado' value={pc((c.monto / d.totalFact) * 100)} sub='de la oficina' />
      <Mini ic='fact' label='Facturas' value={String(c.n)} sub={`emitidas en ${d.anioBase}`} />
      <Mini ic='wal' label='Ticket promedio' value={mm(c.monto / c.n)} sub='por factura' />
    </Grid>
    <Panel hd='Posición'>
      <Fila sin nombre='Lugar en el ranking' peq={`de ${d.clientes.length} clientes facturados`} valor={'#' + (i + 1)} />
      <Fila sin nombre={`Los ${i + 1} primeros suman`} peq={`de lo facturado en ${d.anioBase}`} valor={pc((acum / d.totalFact) * 100)} />
      <Fila nombre='Concentración de clientes' peq='ver los 5 primeros' valor='' onClick={() => X.ir({ drill: { t: 'ind', k: 'conc' } })} />
    </Panel>
    <div style={{ fontSize: 12, color: C.muted, margin: '0 4px' }}>Abre la ficha del cliente desde su nombre en Clientes.</div>
    <Pager prev={i > 0 && { t: d.clientes[i - 1].name, go: () => X.irDrill({ t: 'cli', n: d.clientes[i - 1].id }) }} next={i < Math.min(7, d.clientes.length - 1) && { t: d.clientes[i + 1].name, go: () => X.irDrill({ t: 'cli', n: d.clientes[i + 1].id }) }} />
  </>
}

export function indicadores(X) {
  const { datos: d } = X, o = d.oficiales, Y = d.anioBase, H = Number(d.hoy.slice(5, 7)) - 1
  const uf = (n) => 'UF ' + nf.format(Math.round(n))
  const top5 = d.clientes.slice(0, 5).reduce((a, c) => a + c.monto, 0)
  return {
    vend: { tit: `Vendido ${Y}`, val: uf(o.vend.uf), sub: o.vend.pct != null ? pc(o.vend.pct, 0) + ' de la meta' : 'sin meta', fuente: 'ventas activas y terminadas del año, netas de costos de terceros, contra la meta anual', app: 'Oficina › Resultado del año', rows: [{ n: `Meta de ventas ${Y}`, c: 'neto de costos de terceros', v: o.metaVentasCLP ? mm(o.metaVentasCLP) : 'sin meta' }, { n: 'Avance a la fecha', v: o.vend.pct != null ? pc(o.vend.pct, 0) : '—' }, { n: 'Ya facturado', c: 'de lo vendido', v: o.fact.pct != null ? pc(o.fact.pct, 0) : '—', go: () => X.ir({ drill: { t: 'ind', k: 'fact26' } }) }] },
    fact26: { tit: `Facturado ${Y}`, val: uf(o.fact.uf), sub: o.fact.pct != null ? pc(o.fact.pct, 0) + ' de lo vendido' : '', fuente: 'facturas emitidas con folio, contra lo vendido', app: 'Oficina › Resultado del año', rows: [{ n: 'Vendido', v: uf(o.vend.uf), go: () => X.ir({ drill: { t: 'ind', k: 'vend' } }) }, { n: 'Facturado', v: uf(o.fact.uf) }, { n: 'Por facturar', c: 'vendido que aún no tiene factura', v: uf(Math.max(0, o.vend.uf - o.fact.uf)) }], texto: 'La facturación no tiene meta propia: la app la mide contra lo vendido.' },
    cob26: { tit: `Cobrado ${Y}`, val: uf(o.cob.uf), sub: o.cob.pct != null ? pc(o.cob.pct, 0) + ' de la meta' : 'sin meta', fuente: 'conciliación con el banco, contra la meta de cobranza', app: 'Oficina › Cobrado', rows: [{ n: `Meta de cobranza ${Y}`, v: o.metaCobroCLP ? mm(o.metaCobroCLP) : 'sin meta' }, { n: 'Avance a la fecha', v: o.cob.pct != null ? pc(o.cob.pct, 0) : '—' }, { n: 'Cobrado', v: uf(o.cob.uf) }] },
    marg: { tit: `Margen ${Y}`, val: uf(o.marg.uf), sub: o.marg.pct != null ? pc(o.marg.pct) + ' de ingresos' : '', fuente: 'ingresos menos costos de operación y comisiones', app: 'Oficina › Resultado del año', rows: [{ n: 'Margen', v: uf(o.marg.uf) }, { n: 'Sobre los ingresos', v: o.marg.pct != null ? pc(o.marg.pct) : '—' }] },
    conc: { tit: 'Concentración de clientes', val: pc((d.totalFact ? top5 / d.totalFact : 0) * 100, 0), sub: `los 5 primeros de ${d.clientes.length} clientes facturados`, fuente: `facturado ${Y} por cliente`, app: 'Clientes', rows: d.clientes.slice(0, 5).map((c, i) => ({ n: `${i + 1}. ${c.name}`, v: mm(c.monto), go: () => X.ir({ drill: { t: 'cli', n: c.id } }) })) },
    rec: { tit: 'Recurrente mensual', val: mm(d.recurrente.anualCLP / 12), sub: `${d.recurrente.n} ventas mensuales activas`, fuente: 'ventas con cobro mensual y estado activo, sin subarriendo', app: 'Ventas', rows: [{ n: 'Anualizado ×12', c: 'como en Ventas', v: mm(d.recurrente.anualCLP) }, { n: 'En UF', v: uf(d.recurrente.anualUF) }, { n: 'Ingreso base de la proyección', c: 'ver la etapa Base', v: '', go: () => X.irBase() }] },
    dias: { tit: 'Días de cobro', val: d.dias.promedio != null ? d.dias.promedio + ' días' : 'sin dato', sub: d.dias.n ? `promedio ${Y} · mediana ${d.dias.mediana}` : 'sin facturas pagadas este año', fuente: `${d.dias.n} facturas pagadas en ${Y}, de la emisión al pago`, app: 'Cobranza', rows: [{ n: 'Promedio', v: d.dias.promedio != null ? d.dias.promedio + ' días' : '—' }, { n: 'Mediana', v: d.dias.mediana != null ? d.dias.mediana + ' días' : '—' }, { n: 'Facturas pagadas', v: String(d.dias.n) }, { n: 'Supuesto del escenario Prudente', v: X.est.p.prudente.dias + ' días', go: () => X.irEscTab('res') }] },
    terc: { tit: 'Comisiones', val: d.terc != null ? pc(d.terc) : 'sin dato', sub: 'de lo cobrado en el año', fuente: 'comisiones pagadas del año contra el cobrado propio, como en Inicio', app: 'Comisiones', rows: [{ n: 'Parte de lo cobrado', v: d.terc != null ? pc(d.terc) : '—' }, { n: `Supuesto del presupuesto ${d.anio}`, v: pc(X.est.p.base.terc), go: () => X.irEscTab('res') }] },
    cost: { tit: 'Costos de oficina por mes', val: mm(d.costos.reduce((a, c) => a + c.m, 0) + d.ppmMes), sub: 'presupuesto vigente, con PPM', fuente: 'costos de oficina vigentes por categoría', app: 'Oficina › Resultado del año › Presupuesto vs real', rows: d.costos.map((c) => ({ n: c.n, v: mm(c.m) + ' /mes', go: () => X.irCostos() })).concat([{ n: 'PPM', v: mm(d.ppmMes) + ' /mes', go: () => X.irEscTab('imp') }]) },
    conv: { tit: 'Conversión de propuestas', val: 'sin dato', sub: 'el índice de propuestas no tiene registros', fuente: 'índice de propuestas (Drive)', app: 'Ventas › Propuestas', rows: [], texto: `Para estimar la cartera nueva de ${d.anio} hace falta registrar las propuestas enviadas y las aceptadas. Sin ese dato, el crecimiento de ventas sale de un criterio y no de un cálculo.` },
  }
}

// Evolución del año de Vendido o Cobrado contra su meta, y de qué trabajos y clientes salen los ingresos (estimación propia: reparte el total oficial de Inicio según las partidas).
const dmy = (iso) => String(iso).slice(0, 10).split('-').reverse().join('-')
const TONOS_TARJETA = [{ bg: C.azulBg, bd: C.azulBd, fg: C.azulInfo }, { bg: C.greenBg, bd: C.greenDeep, fg: C.greenText }, { bg: C.soonBg, bd: C.avisoLine, fg: C.soonText }, { bg: C.tealBg, bd: C.tealBg, fg: C.tealText }, { bg: C.ambarBg, bd: C.avisoLine, fg: C.coralText }]
function useAncho(def) {
  const ref = useRef(null), [w, setW] = useState(def)
  useEffect(() => { const f = () => { const el = ref.current; if (el) setW((p) => { const n = Math.max(280, Math.round(el.clientWidth) - 24); return n === p ? p : n }) }; f(); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f) })
  return [ref, w]
}
function Evolucion({ X, k }) {
  const [refG, W] = useAncho(640), [refA, WA] = useAncho(480)
  const [modo, setModo] = useState(k === 'vend' ? 'v' : 'c')
  const [hov, setHov] = useState(null)
  const { datos: d, est } = X, e = d.evo, o = d.oficiales, uf = est.moneda === 'uf'
  const H = Number(d.hoy.slice(5, 7)) - 1
  const def = { v: { nom: 'Vendido', c: o.vend, meta: o.metaVentasCLP, serie: e.vend, col: C.azulInfo, tono: 'a', ic: 'ventas', mes: e.cruceV, fecha: null }, c: { nom: 'Cobrado', c: o.cob, meta: o.metaCobroCLP, serie: e.cob, col: C.greenText, tono: 'g', ic: 'wal', mes: e.cruceC ? Number(e.cruceC.slice(5, 7)) - 1 : null, fecha: e.cruceC } }
  const val = (x, c) => (uf ? ufs(x * (c.clp > 0 ? c.uf / c.clp : 0)) : mm(x))
  const act = modo === 'a' ? [def.v, def.c] : [def[modo]]
  const maxV = Math.max(1, ...act.map((a) => Math.max(a.meta, ...a.serie.map((v) => v || 0))))
  const paso = (() => { const e10 = Math.pow(10, Math.floor(Math.log10(maxV / 4))); for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 10, 15, 20, 25, 30, 40, 50]) if (maxV / (m * e10) <= 4 + 1e-9) return m * e10; return maxV / 4 })()
  const nT = Math.max(1, Math.ceil(maxV / paso - 1e-9)), top = nT * paso
  const Ht = X.D ? 260 : 210, L = X.D ? 62 : 54, B = 26, T = 22, R = 24, x = (i) => L + (i * (W - L - R)) / 11, y = (v) => T + (1 - v / top) * (Ht - T - B)
  const ref = def.v.c.clp > 0 ? def.v.c : def.c.c, vv = (v) => val(v, ref)
  const frase = (a) => (a.meta <= 0 ? `${a.nom}: sin meta definida` : a.mes != null ? `${a.nom}: meta superada ${a.fecha ? 'el ' + dmy(a.fecha) : 'en ' + MESL[a.mes].toLowerCase()}` : `${a.nom}: faltan ${val(Math.max(0, a.meta - (a.c.clp || 0)), a.c)} para la meta`)
  const barras = e.areas.slice(0, 6), bw = WA / Math.max(1, barras.length), mx = Math.max(...barras.map((a) => a.monto), 1)
  const sobre = def.v.c.clp > 0 ? (def.c.c.clp / def.v.c.clp) * 100 : null
  const filas = (modo === 'c' ? def.c : def.v).serie
  const estado = (a) => (a.meta <= 0 ? ['z', 'sin meta'] : a.mes != null ? ['g', `meta ${val(a.meta, a.c)} superada ` + (a.fecha ? 'el ' + dmy(a.fecha) : 'en ' + MESL[a.mes].toLowerCase())] : ['y', `faltan ${val(Math.max(0, a.meta - (a.c.clp || 0)), a.c)} de ${val(a.meta, a.c)}`])
  const gy = Array.from({ length: nT + 1 }, (_, i) => i * paso), tk = (v) => vv(v).replace(',0M', 'M')
  // Colocación de rótulos sin pisar líneas ni otros rótulos: cada uno prueba cuatro posiciones y toma la primera libre.
  const polis = act.map((a) => a.serie.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean))
  const choca = (b) => polis.some((p) => p.some((pt, i) => { if (i === 0) return false; const [x1, y1] = p[i - 1], [x2, y2] = pt; for (let t = 0; t <= 1; t += 0.05) { const px = x1 + (x2 - x1) * t, py = y1 + (y2 - y1) * t; if (px >= b.x0 - 3 && px <= b.x1 + 3 && py >= b.y0 - 3 && py <= b.y1 + 3) return true } return false }))
  const solapa = (a, b) => !(a.x1 < b.x0 || a.x0 > b.x1 || a.y1 < b.y0 || a.y0 > b.y1)
  const ocup = []
  const finales = act.map((a, ai) => { const p = polis[ai], l = p[p.length - 1], lv = a.serie.filter((v) => v != null).pop(), txt = vv(lv), w = txt.length * 6.6
    if (!l) return null
    const lm = act.filter((z) => z.meta > 0).map((z) => y(z.meta)), mal = (b) => ocup.some((o) => solapa(o, b)) || lm.some((q) => q >= b.y0 - 2 && q <= b.y1 + 2)
    let by = l[1] - 24; let b = { x0: l[0] - w, x1: l[0], y0: by, y1: by + 13 }
    if (mal(b)) { by = l[1] + 10; b = { x0: l[0] - w, x1: l[0], y0: by, y1: by + 13 }; if (mal(b)) { by = l[1] - 38; b = { x0: l[0] - w, x1: l[0], y0: by, y1: by + 13 } } }
    ocup.push(b); return { txt, x: l[0], y: b.y1 - 2 } })
  // Las metas se rotulan en el eje (valor en el color de su serie) para no competir con las líneas; el rótulo baja si dos metas quedan casi a la misma altura.
  const ejeMetas = act.filter((a) => a.meta > 0).map((a) => ({ a, yy: y(a.meta) + 4 })).sort((p, q) => p.yy - q.yy).map((m, i, arr) => ({ ...m, yy: i > 0 && m.yy - arr[i - 1].yy < 12 ? arr[i - 1].yy + 12 : m.yy }))
  return <>
    <Titulo right={<Seg options={[['v', 'Vendido'], ['c', 'Cobrado'], ['a', 'Ambos']]} value={modo} onChange={setModo} />}>Evolución contra la meta · estimación propia</Titulo>
    <Grid cols={modo === 'a' ? 3 : 2} colsM={2}>
      {act.map((a) => <Kpi key={a.nom} tono={a.tono} ic={a.ic} label={a.nom} value={val(a.c.clp, a.c)} sub={a.c.pct != null ? <span><b style={{ color: C.accent, fontWeight: 800 }}>{pc(a.c.pct, 0)}</b> de la meta</span> : 'sin meta'} />)}
      {modo === 'a' && <div style={{ gridColumn: X.D ? undefined : '1 / -1', display: 'flex', flexDirection: 'column' }}><Kpi tono='y' ic='gauge' label='Cobrado sobre vendido' value={sobre != null ? pc(sobre, 0) : '—'} sub={`${vv(Math.max(0, def.v.c.clp - def.c.c.clp))} vendido sin cobrar`} /></div>}
    </Grid>
    <Panel hd={`Acumulado ${d.anioBase} contra la meta`} small={<span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>{act.map((a) => { const [t, tx] = estado(a); return <span key={a.nom} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><i style={{ width: 10, height: 10, borderRadius: 3, background: a.col, display: 'inline-block' }} /><b style={{ color: C.accent }}>{a.nom}</b><Chip tono={t}>{tx}</Chip></span> })}</span>}>
      <div ref={refG} style={{ padding: '10px 12px 6px', position: 'relative' }} onMouseLeave={() => setHov(null)}>
        {hov != null && (() => { const tip = act.map((a) => ({ a, v: a.serie[hov] })); if (tip.every((t) => t.v == null)) return null; const izq = x(hov) > W * 0.6
          return <div style={{ position: 'absolute', top: 6, [izq ? 'left' : 'right']: izq ? `calc(${(L / W) * 100}% + 12px)` : '3%', zIndex: 2, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 12px', fontSize: 12, boxShadow: '0 4px 14px rgba(0,0,0,.08)', pointerEvents: 'none', minWidth: 150 }}>
            <div style={{ ...LBL, color: C.accent, marginBottom: 4 }}>{MESL[hov]}</div>
            {tip.map(({ a, v }) => v != null && <div key={a.nom} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, fontVariantNumeric: 'tabular-nums' }}><span style={{ color: a.col, fontWeight: 700 }}>● {a.nom}</span><b style={{ color: C.accent }}>{vv(v)}</b></div>)}
            {tip.map(({ a, v }) => v != null && a.meta > 0 && <div key={'m' + a.nom} style={{ color: C.muted, fontSize: 11 }}>{pc((v / a.meta) * 100, 0)} de la meta {a.nom === 'Vendido' ? 'de ventas' : 'de cobro'}</div>)}
            {tip.map(({ a, v }) => v != null && hov > 0 && a.serie[hov - 1] != null && <div key={'d' + a.nom} style={{ color: C.muted, fontSize: 11 }}>{sgn(v - a.serie[hov - 1])}{vv(Math.abs(v - a.serie[hov - 1]))} en el mes · {a.nom.toLowerCase()}</div>)}
          </div> })()}
        <svg viewBox={`0 0 ${W} ${Ht}`} style={{ width: '100%', height: 'auto', display: 'block', touchAction: 'pan-y' }} role='img' aria-label='Evolución acumulada contra la meta' fontFamily='inherit'
          onMouseMove={(ev) => { const r = ev.currentTarget.getBoundingClientRect(), px = ((ev.clientX - r.left) / r.width) * W, i = Math.round(((px - L) / (W - L - R)) * 11); setHov(i >= 0 && i <= H ? i : null) }}
          onClick={(ev) => { const r = ev.currentTarget.getBoundingClientRect(), px = ((ev.clientX - r.left) / r.width) * W, i = Math.round(((px - L) / (W - L - R)) * 11); setHov(i >= 0 && i <= H ? (i === hov ? null : i) : null) }}>
          {hov != null && <line x1={x(hov)} x2={x(hov)} y1={T} y2={y(0)} stroke={C.muted} strokeWidth='1' strokeDasharray='3 3' />}
          {gy.map((v, i) => <g key={i}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={C.border} strokeWidth='1' strokeDasharray={i === 0 ? undefined : '2 4'} />{!ejeMetas.some((m) => Math.abs(m.yy - 4 - y(v)) < 13) && <text x={L - 8} y={y(v) + 4} textAnchor='end' fontSize='11' fill={C.muted}>{tk(v)}</text>}</g>)}
          {ejeMetas.map((m) => <text key={m.a.nom} x={L - 8} y={m.yy} textAnchor='end' fontSize='11' fontWeight='700' fill={m.a.col}>{tk(m.a.meta)}</text>)}
          {MESC.map((m, i) => (W > 520 || i % 3 === 0 || i === 11) && <text key={m} x={x(i)} y={Ht - 8} textAnchor='middle' fontSize='11' fill={C.muted} opacity={i <= H ? 1 : 0.5}>{m}</text>)}
          {act.map((a, ai) => { const pts = polis[ai], last = pts[pts.length - 1]
            return <g key={a.nom}>
              {a.meta > 0 && <line x1={L} x2={W - R} y1={y(a.meta)} y2={y(a.meta)} stroke={a.col} strokeWidth='1.25' strokeDasharray='5 4' opacity='.8' />}
              {pts.length > 1 && <polygon points={`${pts[0][0]},${y(0)} ${pts.map((p) => p.join(',')).join(' ')} ${last[0]},${y(0)}`} fill={a.col} opacity='.07' />}
              {pts.length > 1 && <polyline points={pts.map((p) => p.join(',')).join(' ')} fill='none' stroke={a.col} strokeWidth='2.5' strokeLinejoin='round' strokeLinecap='round' />}
              {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={i === hov ? 6 : i === pts.length - 1 ? 4.5 : 3} fill={i === pts.length - 1 ? a.col : C.card} stroke={a.col} strokeWidth='2' />)}
              {a.mes != null && a.serie[a.mes] != null && <circle cx={x(a.mes)} cy={y(a.serie[a.mes])} r='7.5' fill='none' stroke={a.col} strokeWidth='1.5' />}
                            {finales[ai] && <text x={finales[ai].x} y={finales[ai].y} textAnchor='end' fontSize='11' fontWeight='700' fill={a.col} stroke={C.card} strokeWidth='4' paintOrder='stroke' strokeLinejoin='round'>{finales[ai].txt}</text>}
            </g> })}
        </svg>
      </div>
    </Panel>
    <Det t={`Mes a mes · acumulado${modo === 'a' ? ' vendido y cobrado' : ''}`}>
      <div style={{ margin: '-8px -14px -10px' }}>{filas.map((v, i) => i <= H && <Fila key={i} nombre={MESL[i]} peq={modo === 'a' ? `cobrado ${e.cob[i] != null ? vv(e.cob[i]) : '—'}` : i > 0 && filas[i - 1] != null && v != null ? `${sgn(v - filas[i - 1])}${vv(Math.abs(v - filas[i - 1]))} en el mes` : undefined} valor={v != null ? vv(v) : '—'} onClick={() => X.ir({ drill: { t: 'mes', i } })} />)}</div>
    </Det>
    <Titulo>De qué trabajos y clientes salen los ingresos · estimación propia</Titulo>
    <div style={{ display: 'grid', gridTemplateColumns: X.D ? '1fr 1fr' : '1fr', gap: 12, alignItems: 'start' }}>
      {[['Vendido por tipo de trabajo', e.areas.map((a) => ({ n: a.n, pct: a.pct, monto: val(a.monto, def.v.c), sub: 'de lo vendido', azul: true })), 'Sin ventas del año.'],
        ['Facturado por tipo de cliente', e.tipos.map((t) => ({ n: t.n, pct: t.pct, monto: mm(t.monto), sub: `${t.nClientes} cliente${t.nClientes !== 1 ? 's' : ''}`, amb: t.n === 'Sin tipo', go: () => X.ir({ drill: { t: 'ind', k: 'conc' } }) })), 'Aún no hay facturas emitidas este año.']].map(([hd, items, vacio]) => <div key={hd} style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
        <span style={{ ...LBL, color: C.muted, padding: '0 4px' }}>{hd}</span>
        {items.length === 0 ? <div style={{ fontSize: 13, color: C.muted, padding: '0 4px' }}>{vacio}</div>
          : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 10 }}>{items.map((t, ti) => { const tn = t.amb ? { bg: C.bgSoft, bd: C.border, fg: C.grisText } : TONOS_TARJETA[ti % TONOS_TARJETA.length]; return <div key={t.n} onClick={t.go} style={{ background: tn.bg, border: `1px solid ${tn.bd}`, borderRadius: 12, padding: 12, cursor: t.go ? 'pointer' : 'default', minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: C.accent }}><span style={{ minWidth: 0 }}>{t.n}</span><span style={{ fontSize: 11, fontWeight: 800, background: '#fff', borderRadius: 20, padding: '1px 8px', whiteSpace: 'nowrap', color: tn.fg }}>{pc(t.pct, t.pct < 10 ? 1 : 0)}</span></div>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.4, color: C.accent, marginTop: 4, whiteSpace: 'nowrap' }}>{t.monto}</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{t.sub}</div>
          </div> })}</div>}
      </div>)}
    </div>
    {e.tipos[0]?.n === 'Sin tipo' && e.tipos[0].pct > 50 && <div style={{ fontSize: 11, color: C.muted, margin: '0 4px' }}>La mayoría de lo facturado sale «Sin tipo»: completar el tipo en la ficha del cliente mejora este análisis.</div>}
  </>
}

export function DInd({ X, k }) {
  const x = indicadores(X)[k]
  if (!x) return null
  return <>
    {k !== 'vend' && k !== 'cob26' && <Grid cols={1} colsM={1}><Kpi tono='a' ic='doc' label={x.tit} value={x.val} sub={x.sub} /></Grid>}
    {(k === 'vend' || k === 'cob26') && <Evolucion X={X} k={k === 'vend' ? 'vend' : 'cob'} />}
    {x.rows.length > 0 && (k === 'vend' || k === 'cob26' ? <Det t='De dónde sale'><div style={{ margin: '-8px -14px -10px' }}>{x.rows.map((r, i) => <Fila key={i} nombre={r.n} peq={r.c} valor={r.v} onClick={r.go} sin={!r.go} />)}</div></Det> : <Panel hd='De dónde sale' small='toca una fila'>{x.rows.map((r, i) => <Fila key={i} nombre={r.n} peq={r.c} valor={r.v} onClick={r.go} sin={!r.go} />)}</Panel>)}
    {x.texto && <div style={{ background: C.avisoBg, border: `1px solid ${C.avisoLine}`, color: C.avisoText, borderRadius: 12, padding: '10px 14px', fontSize: 13 }}>{x.texto}</div>}
    <div style={{ fontSize: 12, color: C.muted, margin: '0 4px' }}>Fuente: {x.fuente} · En la app: {x.app}</div>
  </>
}

export function DSoc({ X, n }) {
  const { datos: d, M, est } = X, ss = d.socios, i = ss.findIndex((s) => s.nombre === n), s = ss[i]
  if (!s) return null
  const tot = ss.reduce((a, x) => a + x.facturado, 0), sh = tot ? s.facturado / tot : 0, e = M.esc[est.esc], sin = n === 'Sin socio', pm = parteMeta(ss, n), mt = metasEsc(X, est.esc)
  return <>
    <Grid cols={4} colsM={2}>
      <Mini ic='ventas' label={`Facturado ${d.anioBase}`} value={mm(s.facturado)} sub='atribuido, a la fecha' />
      <Mini ic='gauge' label='Parte de la oficina' value={pc(sh * 100)} sub='de lo facturado' />
      <Mini ic='tgt' label={`Facturado ${d.anio} · ${X.nomEsc(est.esc)}`} value={mm(e.fact * sh)} sub={ufs(e.factUF * sh)} />
      <Mini ic='wal' label={`Retiros ${d.anio} · ${X.nomEsc(est.esc)}`} value={sin ? '—' : mm(e.retiros / 2)} sub={sin ? 'no retira' : 'parte igual de la oficina'} />
    </Grid>
    {!sin && <Grid cols={3} colsM={1}>
      <Mini ic='ventas' label={`Meta de ventas ${d.anio}`} value={mm(mt.ventas * pm)} sub={`${pc(pm * 100, 0)} de ${mm(mt.ventas)}`} />
      <Mini ic='fact' label={`Meta de facturación ${d.anio}`} value={mm(mt.fact * pm)} sub={`${pc(pm * 100, 0)} de ${mm(mt.fact)}`} />
      <Mini ic='wal' label={`Meta de cobro ${d.anio}`} value={mm(mt.cobro * pm)} sub={`${pc(pm * 100, 0)} de ${mm(mt.cobro)}`} />
    </Grid>}
    <Panel hd='Por escenario' small='toca para ver el resultado'>{X.ESC.map(([k, nn]) => <Fila key={k} nombre={nn} peq={'retiros ' + (sin ? '—' : mm(M.esc[k].retiros / 2))} valor={mm(M.esc[k].fact * sh)} onClick={() => { X.setEsc(k); X.irEscTab('soc') }} />)}</Panel>
    <Pager prev={i > 0 && { t: ss[i - 1].nombre, go: () => X.irDrill({ t: 'soc', n: ss[i - 1].nombre }) }} next={i < ss.length - 1 && { t: ss[i + 1].nombre, go: () => X.irDrill({ t: 'soc', n: ss[i + 1].nombre }) }} />
  </>
}

export function DVer({ X }) {
  const { vers, ui, setUI } = X, conf = ui.confirma, base = vers.find((v) => v.id === X.est.basadaEn)
  const sug = 'Versión ' + (vers.length + 1) + ' · ' + fechaDMY(new Date().toISOString()).slice(0, 10)
  const refN = useRef(null), refNo = useRef(null)
  return <>
    <Panel hd='Guardar esta versión'>
      <div style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: X.D ? 'minmax(0,1fr) minmax(0,1.4fr)' : '1fr', gap: 12 }}>
        <div><div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Nombre</div><input ref={refN} defaultValue={sug} style={campo} /></div>
        <div><div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Nota (opcional)</div><input ref={refNo} placeholder='Qué cambió o por qué' style={campo} /></div>
      </div>
      <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.border}`, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}><Btn onClick={() => X.guardarVersion((refN.current?.value || '').trim() || 'Versión', (refNo.current?.value || '').trim())}>Guardar versión</Btn><span style={{ fontSize: 12, color: C.muted }}>{base ? `El borrador parte de «${base.nombre}»` : 'Se guarda la foto de todos los supuestos, costos y notas de las etapas.'}</span></div>
    </Panel>
    <Titulo>Versiones guardadas · {vers.length}</Titulo>
    <Panel>{vers.length === 0 ? <div style={{ padding: 16, fontSize: 13, color: C.muted }}>Aún no hay versiones. Guarda la primera cuando termines una etapa.</div>
      : vers.map((v) => { const abierta = ui.vx === v.id, b = v.resumen && v.resumen.base ? v.resumen.base : null, c = conf && conf.id === v.id ? conf.a : null
        return <Fila key={v.id} abierta={abierta} nombre={<>{v.nombre}{v.oficial && <span style={{ marginLeft: 8 }}><Chip>Oficial</Chip></span>}{v.id === X.est.basadaEn && <span style={{ marginLeft: 8 }}><Chip tono='y'>borrador parte de aquí</Chip></span>}</>} peq={`${fechaDMY(v.created_at)}${v.creado_por ? ' · ' + v.creado_por : ''} · ${v.nota || 'sin nota'}`} sub={b ? 'retiros ' + mm(b.retiros) : ''} valor={b ? mm(b.fact) : ''} onClick={() => setUI({ vx: abierta ? null : v.id, confirma: null })}>
          {abierta && <div style={{ background: C.bgSoft, padding: '4px 16px 14px', display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
            {c === 'abrir' ? <><span>Reemplaza el borrador actual. Guárdalo antes como versión si lo necesitas.</span><span><Btn onClick={() => X.abrirVersion(v)}>Abrir</Btn> <Lnk onClick={() => setUI({ confirma: null })}>Cancelar</Lnk></span></>
              : c === 'borrar' ? <><span>Esta versión se elimina y no se puede recuperar.</span><span><Btn onClick={() => X.borrarVersion(v)}>Eliminar</Btn> <Lnk onClick={() => setUI({ confirma: null })}>Cancelar</Lnk></span></>
                : <><span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Btn onClick={() => setUI({ confirma: { a: 'abrir', id: v.id } })}>Abrir</Btn><Btn onClick={() => X.ir({ drill: { t: 'cmp', id: v.id } })}>Comparar con el borrador</Btn><Btn onClick={() => X.marcarOficial(v)}>{v.oficial ? 'Quitar como oficial' : 'Marcar como oficial'}</Btn></span><Lnk rojo onClick={() => setUI({ confirma: { a: 'borrar', id: v.id } })}>Eliminar</Lnk></>}
          </div>}
        </Fila> })}</Panel>
  </>
}
const campo = { width: '100%', boxSizing: 'border-box', height: 34, padding: '0 10px', background: C.bgSoft, border: `1px solid ${C.border}`, borderRadius: 8, fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600, color: C.text, outline: 'none' }

export function DCmp({ X, id }) {
  const v = X.vers.find((x) => x.id === id)
  if (!v) return <div style={{ background: C.avisoBg, border: `1px solid ${C.avisoLine}`, borderRadius: 12, padding: 14, fontSize: 13 }}>Esa versión ya no existe.</div>
  const A = v.estado, B = X.est, mA = modeloPresupuesto(X.datos.base, A), mB = modeloPresupuesto(X.datos.base, B), k = X.est.esc, eA = mA.esc[k], eB = mB.esc[k]
  const rows = [['Facturado', 'fact', 0], ['Comisiones', 'terc', 0], ['Costos de oficina', 'costos', 0], ['Resultado antes de impuesto', 'base', 1], ['Impuesto de primera categoría', 'idpc', 0], ['Retiros de los socios', 'retiros', 1]]
  const dif = diferenciaSupuestos(A, B, { mm, pc })
  return <>
    <Titulo>Escenario {X.nomEsc(k)} · versión contra el borrador de hoy</Titulo>
    <Panel>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 90px 90px 90px', gap: 10, padding: '10px 16px', ...LBL, color: C.accent }}><span /><span style={{ textAlign: 'right' }}>Versión</span><span style={{ textAlign: 'right' }}>Borrador</span><span style={{ textAlign: 'right' }}>Diferencia</span></div>
      {rows.map(([t, key, bueno]) => { const dd = eB[key] - eA[key], nulo = Math.abs(dd) < 1
        return <div key={t} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 90px 90px 90px', gap: 10, padding: '10px 16px', borderTop: `1px solid ${C.border}`, fontSize: 13 }}><span>{t}</span><span style={{ textAlign: 'right' }}>{mm(eA[key])}</span><span style={{ textAlign: 'right' }}>{mm(eB[key])}</span><b style={{ textAlign: 'right', color: nulo ? C.muted : bueno ? (dd > 0 ? C.greenText : C.overdueText) : C.text }}>{nulo ? '—' : (dd > 0 ? '+' : '−') + mm(Math.abs(dd))}</b></div> })}
    </Panel>
    <Panel hd='Supuestos que cambian' small={`${dif.length} cambio${dif.length !== 1 ? 's' : ''}`} pad>{dif.length ? <Lista items={dif} /> : <span style={{ fontSize: 13, color: C.muted }}>El borrador es igual a esta versión.</span>}</Panel>
  </>
}

export const titulosDrill = (X, d) => d.t === 'mes' ? nombreMes(d.i) : d.t === 'cli' ? (X.datos.clientes.find((c) => c.id === d.n)?.name || 'Cliente') : d.t === 'soc' ? 'Socio · ' + d.n : d.t === 'ver' ? 'Versiones' : d.t === 'cmp' ? 'Comparar versión' : (indicadores(X)[d.k]?.tit || 'Detalle')
export const vistaDrill = (X, d) => d.t === 'mes' ? <DMes X={X} i={d.i} /> : d.t === 'cli' ? <DCli X={X} id={d.n} /> : d.t === 'soc' ? <DSoc X={X} n={d.n} /> : d.t === 'ver' ? <DVer X={X} /> : d.t === 'cmp' ? <DCmp X={X} id={d.id} /> : <DInd X={X} k={d.k} />
