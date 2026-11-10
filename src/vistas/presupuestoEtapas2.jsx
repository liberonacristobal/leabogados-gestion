// Presupuesto anual · etapas 4 y 5 (Escenarios con resultado, impuesto y por socio; Seguimiento) y las páginas de detalle (mes, cliente, indicador, socio, versiones).
import { useEffect, useRef, useState } from 'react'
import { C, appAlert } from '../lib/base.jsx'
import { mesesCerradosAnio, distribuirMensual, seguimientoMensual, afavor, COMPONENTES, modeloPresupuesto, diferenciaSupuestos, parteMeta, tasaPPMLegal, escenariosContraMeta, valorComponente, nombreComponente, sueldosYRetiros } from '../../supabase/functions/_shared/presupuesto.js'
import { descargarLibroPresupuesto } from '../lib/presupuestoExcel.js'
import { nf, mm, mx, mmP, mxP, mp, ufs, pc, sgn, MESL, MESC, Kpi, Mini, Titulo, Panel, Seg, Chip, Btn, Lnk, Fld, FldDin, Stp, Fila, Det, Lista, Grid, LBL, Flecha, ESC_TONO, Val, Pestanas, Tarjeta, Ic, difMon, monedaActual, tasa27, aUF } from '../lib/presupuestoUI.jsx'
import { nivelTxt, DSocios } from '../lib/presupuestoBloques.jsx'

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
      {cols.map(([k]) => <span key={k} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}><Val v={f(X.M.esc[k])} /></span>)}</div>)}
  </Panel>
}

// ── 4 · Escenarios ──
function Strip({ X }) {
  const { est, setGen, D } = X
  const campos = [['Reajuste UF', 'reajusteUF', 'pct', { suf: '%' }, 'Supuesto de inflación'], ['Tasa 1ª categoría', 'tasaIDPC', 'pct', { suf: '%' }, 'Pro Pyme · circular SII 53/2025'], ['PPM del año', 'ppmAnual', 'money', { pre: '$' }, 'Lo pagado hoy: ' + mp(X.datos.ppmMes) + ' al mes'], ['Reserva de caja', 'reserva', 'pct', { suf: '%' }, '% que no se retira']]
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(${D ? 4 : 2},minmax(0,1fr))`, gap: 10, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '10px 14px' }}>
    {campos.map(([t, f, k, u, n]) => <div key={f} style={{ minWidth: 0 }}><div style={{ ...LBL, fontSize: 10.5, color: C.accent, marginBottom: 4 }}>{t}</div>{f === 'ppmAnual' ? <FldDin clp={est[f]} tasa={tasa27()} onCommit={(v) => setGen(f, v)} w={9999} /> : <Fld kind={k} value={est[f]} onCommit={(v) => setGen(f, v)} w={9999} {...u} />}<div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{n}</div></div>)}
  </div>
}

// Tarjeta de escenario: la MISMA en el paso 4 (Escenarios contra la meta) y en el paso 5. Cada escenario lleva su tono (ESC_TONO), dice si cubre la meta escrita en el paso 4 y la reserva al cierre en meses de costos.
export function CardEsc({ X, k }) {
  const { est, M, setPal, setEsc, MT } = X, irEscTab = X.irEscTab, e = M.esc[k], p = est.p[k], b = M.esc.base, sel = est.esc === k, tn = ESC_TONO[k]
  const cu = escenariosContraMeta(M, MT.ancla, MT.valor, MT.ratio).find((x) => x.k === k)
  const xr = (t, v, go, strong) => <div onClick={(ev) => { if (go) { ev.stopPropagation(); go() } }} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: X.D ? '7px 4px' : '4px 2px', borderTop: `1px solid ${C.border}`, fontSize: 12.5, cursor: go ? 'pointer' : 'default', fontWeight: strong ? 800 : 400 }}><span>{t}</span><b style={{ fontWeight: 700, whiteSpace: 'nowrap', textAlign: 'right' }}><Val v={mm(v)} /></b></div>
  const lv = (t, f, suf, d, mn, mx, int) => <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}><small style={{ ...LBL, fontSize: 10.5, color: C.accent }}>{t}</small><Stp value={p[f]} suf={suf} step={d} min={mn} max={mx} int={int} onChange={(v) => { setPal(k, f, v); setEsc(k) }} /></div>
  return <div onClick={() => setEsc(k)} role='button' aria-pressed={sel} style={{ background: C.card, border: sel ? `2px solid ${tn.bd === C.border ? C.accent : tn.bd}` : `1px solid ${tn.bd}`, borderRadius: 12, padding: X.D ? (sel ? 13 : 14) : (sel ? 9 : 10), cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: X.D ? 6 : 3, minWidth: 0, boxSizing: 'border-box' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}><span style={{ background: tn.bg, color: tn.fg, border: `1px solid ${tn.bd}`, borderRadius: 20, padding: '2px 11px', fontSize: 13, fontWeight: 800 }}>{X.nomEsc(k)}</span>{sel && <Chip>elegido</Chip>}{k !== 'base' && <Chip tono={e.retiros >= b.retiros ? 'g' : 'r'}>{sgn(e.retiros - b.retiros)}{mmP(Math.abs(e.retiros - b.retiros))} vs Base</Chip>}</div>
    <div style={{ ...LBL, color: C.muted }}>Retiros</div>
    <div style={{ fontSize: X.D ? 26 : 21, fontWeight: 800, letterSpacing: -0.6, color: e.retiros > 0 ? C.greenText : C.overdueText, lineHeight: 1.1 }}><Val v={mm(e.retiros)} /></div>
    <div style={{ fontSize: 11, color: C.muted }}>{mmP(e.retiros / 24)} por socio al mes</div>
    {cu && cu.dif != null && <div style={{ fontSize: 12, color: C.muted }}><Flecha sube={cu.cubre} bueno={cu.cubre}>{cu.dif >= -1 ? 'sobran' : 'faltan'} {mmP(Math.abs(cu.dif))}</Flecha> de la meta de {nombreComponente(MT.ancla).toLowerCase()}</div>}
    <div style={{ marginTop: X.D ? 6 : 2 }}>{xr('Cobrado', e.caja, () => X.irBase())}{xr('− Comisiones', e.terc, () => X.irCostos())}{xr('− Presupuesto de costos', e.costos, () => X.irCostos())}{xr('− Impuesto', e.idpc, () => irEscTab('imp'))}{xr('− Reserva de caja', e.reserva)}</div>
    <div style={{ fontSize: 12, color: C.muted, borderTop: `1px solid ${C.border}`, paddingTop: 7 }}>Reserva al cierre <b style={{ color: C.accent }}>{mm(e.reservaCierre)}</b>{e.mesesReserva != null ? ` · ${e.mesesReserva.toLocaleString('es-CL', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} meses de costos` : ''}</div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8, borderTop: `1px solid ${C.border}`, paddingTop: X.D ? 10 : 6, marginTop: X.D ? 6 : 2 }}>{lv('Ventas', 'g', '%', 1, -30, 80)}{lv('Costos', 'alza', '%', 0.5, 0, 20)}{lv('Cobro', 'dias', 'd', 5, 0, 90, true)}</div>
  </div>
}



function TabImp({ X }) {
  const { est, M, setEsc } = X
  return <>
    <Grid cols={3} colsM={1}>{X.ESC.map(([k, n]) => { const e = M.esc[k], sel = est.esc === k
      return <div key={k} onClick={() => setEsc(k)} style={{ background: C.card, border: sel ? `2px solid ${C.accent}` : `1px solid ${C.border}`, borderRadius: 12, padding: sel ? 13 : 14, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><b style={{ color: C.accent, fontSize: 15 }}>{n}</b>{sel && <Chip>elegido</Chip>}</div>
        <div style={{ ...LBL, color: C.muted }}>Saldo en abril de {X.datos.anio + 1}</div>
        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.6, color: e.saldo > 0 ? C.soonText : C.greenText, lineHeight: 1.1 }}><Val v={mm(Math.abs(e.saldo))} /></div>
        <div style={{ fontSize: 11, color: C.muted }}>{e.saldo >= 0 ? 'por pagar' : 'a favor'}</div>
        <div style={{ marginTop: 6 }}>{[['Base imponible', mm(e.base)], ['× Tasa de primera categoría', pc(est.tasaIDPC)], [`= Impuesto del año ${X.datos.anio}`, mm(e.idpc), 1], [`− PPM pagados en ${X.datos.anio}`, mm(e.ppm)], ['Impuesto sobre el resultado', pc((e.idpc / Math.max(1, e.base)) * 100)]].map(([t, v, s]) => <div key={t} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 4px', borderTop: `1px solid ${C.border}`, fontSize: 12.5, fontWeight: s ? 800 : 400 }}><span>{t}</span><b style={{ fontWeight: 700, textAlign: 'right' }}><Val v={v} /></b></div>)}</div></div> })}</Grid>
    <Panel hd='Calendario y alcance' pad><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Chip>{`Cada mes · PPM en el F29 (hoy ${mp(X.datos.ppmMes)} al mes)`}</Chip><Chip>{`Abril ${X.datos.anio + 1} · declaración anual de ${X.datos.anio}`}</Chip><Chip>Sin IVA · no hay crédito fiscal</Chip><Chip tono='y'>Fuera: impuesto personal de los socios, depreciación · tasa de PPM por confirmar</Chip></div></Panel>
  </>
}

// Metas de la oficina por escenario y la parte de cada socio (Vendido con la misma relación facturado/vendido de las metas).
const metasEsc = (X, k) => ({ ventas: valorComponente(X.M.esc[k], 'ventas', X.MT.ratio) ?? 0, fact: X.M.esc[k].fact, cobro: X.M.esc[k].caja })

function TabSoc({ X }) {
  const { est, M, datos: d } = X, e = M.esc[est.esc], tot = d.socios.reduce((a, s) => a + s.facturado, 0), mt = metasEsc(X, est.esc)
  return <>
    <Panel hd={`Por socio · ${X.nomEsc(est.esc)}`} small={`partes iguales (${pc(parteMeta(d.socios, d.socios[0]?.nombre) * 100, 0)} cada socio)`}>
      {d.socios.map((s) => { const sh = tot ? s.facturado / tot : 0, sin = s.nombre === 'Sin socio', pm = parteMeta(d.socios, s.nombre)
        return <Fila key={s.nombre} nombre={s.nombre} peq={`${pc(sh * 100)} de lo facturado en ${d.anioBase}${sin ? '' : ' · retiros ' + mmP(e.retiros / 24) + ' por mes'}`} sub={sin ? 'facturado ' + mmP(e.fact * sh) : `meta de ventas ${mmP(mt.ventas * pm)} · cobro ${mmP(mt.cobro * pm)}`} valor={sin ? '—' : mm(e.retiros / 2)} onClick={() => X.ir({ drill: { t: 'soc', n: s.nombre } })} /> })}
      <Fila tot sin nombre='Oficina' sub={`meta de ventas ${mmP(mt.ventas)} · cobro ${mmP(mt.cobro)}`} valor={mm(e.retiros)} />
    </Panel>
    <Titulo>Sueldos y retiros por escenario</Titulo>
    <Grid cols={3} colsM={1}>{X.ESC.map(([k, n]) => { const r = sueldosYRetiros({ socios: d.retiros26.socios, costos: est.costos, alza: est.p[k].alza, retiros: M.esc[k].retiros, real: { sueldos: d.retiros26.sueldos, retiros: d.retiros26.porSocio } }), tn = ESC_TONO[k]
      return <Panel key={k} hd={<span style={{ background: tn.bg, color: tn.fg, border: `1px solid ${tn.bd}`, borderRadius: 20, padding: '2px 11px', letterSpacing: 0, textTransform: 'none', fontSize: 13 }}>{n}</span>}>
        {r.filas.map((f) => <Fila key={f.nombre} nombre={f.nombre} peq={`sueldo ${mmP(f.sueldo27)} + retiros ${mmP(f.ret27)}`} valor={mm(f.tot27)} onClick={X.onOpenSocios} />)}
        <Fila tot sin nombre='Oficina' peq={`sueldos ${mmP(r.total.sueldo27)} + retiros ${mmP(r.total.ret27)}`} valor={mm(r.total.tot27)} />
      </Panel> })}</Grid>
    <div style={{ fontSize: 12, color: C.muted, margin: '-6px 4px 0' }}>Sueldo = Remuneraciones del socio con el alza del escenario; sus leyes sociales son costo de la oficina. Retiros en partes iguales.</div>
  </>
}

/** Descarga el libro de Excel del Presupuesto (conserva pesos y UF en columnas, sin importar el selector de moneda). */
export function descargarExcel(X) {
  const { est, datos: d } = X
  descargarLibroPresupuesto({
    anio: d.anio, anioBase: d.anioBase, ufDic: d.ufDic, baseCLP: d.base.baseCLP, baseUF: d.base.baseUF, est, ESC: X.ESC, costos: est.costos, socios: d.socios, oficiales: d.oficiales, metas: { ancla: X.MT.ancla, valor: X.MT.valor }, ratio: X.MT.ratio, referencia: d.referencia,
    mes26: Array.from({ length: 12 }, (_, i) => { const k = (y) => `${y}-${String(i + 1).padStart(2, '0')}`; return { a: d.serie[k(d.anioBase - 1)]?.fac ?? null, f: d.serie[k(d.anioBase)]?.fac ?? null, cob: d.cobMes[k(d.anioBase)] ?? null } }),
  }, (t) => appAlert(t))
}

export function Escenarios({ X }) {
  const { est, M, D, ui, setUI, datos: d } = X
  const tabs = [['res', 'Resultado'], ['imp', 'Impuesto'], ['soc', 'Por socio']]
  const cuerpo = ui.tab === 'imp' ? <TabImp X={X} /> : ui.tab === 'soc' ? <TabSoc X={X} /> : <Grid cols={3} colsM={1}>{X.ESC.map(([k]) => <CardEsc key={k} X={X} k={k} />)}</Grid>
  const cascada = [['', 'Vendido (estimación propia)', (x) => mm(valorComponente(x, 'ventas', X.MT.ratio) ?? 0)], ['', 'Facturado', (x) => mm(x.fact)], ['−', 'Aumento de lo por cobrar', (x) => mm(x.dCob)], ['=', 'Cobrado', (x) => mm(x.caja), 1], ['−', 'Comisiones', (x) => mm(x.terc)], ['−', 'Presupuesto de costos', (x) => mm(x.costos)], ['=', 'Margen', (x) => mm(x.base), 1], ['−', 'Impuesto de primera categoría', (x) => mm(x.idpc)], ['=', 'Después de impuesto', (x) => mm(x.post), 1], ['−', 'Reserva de caja', (x) => mm(x.reserva)], ['=', 'Retiros', (x) => mm(x.retiros), 1]]
  const e = M.esc[est.esc]
  const mensual = <div>{MESC.map((m, i) => <Fila key={m} nombre={MESL[i]} sub={monedaActual() === 'clp' ? ufs(e.ingUF[i]) : ''} valor={mx(e.ing[i], e.ingUF[i])} onClick={() => X.ir({ drill: { t: 'mes', i } })} />)}</div>
  const dg = { display: 'grid', gridTemplateColumns: D ? '1fr 1fr' : '1fr', gap: 10, alignItems: 'start' }
  return <>
    <Pestanas options={tabs} value={ui.tab} onChange={(v) => setUI({ tab: v })} />
    {ui.tab !== 'soc' && <Strip X={X} />}
    {ui.tab === 'res' && <><Titulo right={X.MT.ok ? <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 600, color: C.muted }}>exige <b style={{ color: C.accent }}>{sgn(X.MT.ch.g)}{pc(Math.abs(X.MT.ch.g))}</b> real en UF</span> : null}>Escenarios contra la meta de {nombreComponente(X.MT.ancla).toLowerCase()} · {mm(X.MT.valor)}</Titulo><div style={{ fontSize: 12, color: C.muted, margin: '-6px 4px 0' }}>{nivelTxt(escenariosContraMeta(X.M, X.MT.ancla, X.MT.valor, X.MT.ratio).find((x) => x.cubre)?.k ?? null)}.</div></>}
    {cuerpo}
    <div style={dg}>
      {ui.tab === 'res' && <>
        <Det t={`Metas ${d.anio} · por escenario`}><MetasTabla X={X} /></Det>
        <Det t='Estado de resultados por escenario'><div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>Caja, sin IVA · UF media {nf.format(Math.round(M.ufMed))}</div><Filas X={X} filas={cascada} /></Det>
        <Det t={`Facturado mes a mes · ${X.nomEsc(est.esc)}`}>{mensual}</Det>
        <Det t='Por qué estos valores'><Lista items={[<span><b>Crecimiento real de ventas 0 / 10 / 25 %:</b> se aplica en UF sobre la base de {d.anioBase}. Es un criterio, no un cálculo: no hay conversión de propuestas para estimar la cartera nueva. El 10 % base supera el reajuste de la UF.</span>, <span><b>Alza de costos:</b> reajuste de sueldos más IPC; el prudente usa 6 % por si la inflación sorprende.</span>, <span><b>Comisiones:</b> parte de lo cobrado, la real de {d.anioBase}{d.terc != null ? ' (' + pc(d.terc) + ')' : ''}.</span>, <span><b>Días de cobro:</b> el prudente supone más días que el promedio real{d.dias.promedio != null ? ' (' + d.dias.promedio + ' días, mediana ' + d.dias.mediana + ')' : ''}.</span>, <span><b>Impuesto:</b> tasa de primera categoría de {pc(est.tasaIDPC)} para el año comercial {d.anio} (Pro Pyme, circular SII 53/2025); editable.</span>, <span><b>Reserva de caja:</b> {pc(est.reserva, 0)} del resultado después de impuesto; la reserva mínima de {mm(est.reservaIni)} ya está en caja.</span>]} /></Det>
      </>}
      {ui.tab === 'imp' && <>
        <Det t='Qué se paga y cuándo'><Lista items={[<span><b>Cada mes:</b> PPM en el F29 del mes siguiente (hoy {mp(d.ppmMes)} presupuestados).</span>, <span><b>Abril de {d.anio + 1}:</b> declaración anual de {d.anio}; se paga el saldo o se pide la devolución.</span>, <span><b>Sin IVA:</b> no hay IVA que proyectar ni crédito fiscal.</span>, <span><b>Boletas de honorarios:</b> las retenciones siguen yendo al F29, como hoy.</span>]} /></Det>
        <Det t='Lo que no se proyecta aquí'><Lista items={['El impuesto personal de cada socio por sus retiros.', 'Depreciación y gastos rechazados: se estiman con la contadora.', `Tasa de PPM: se mantiene lo pagado hoy (conservador); la legal Pro Pyme (${pc(tasaPPMLegal(d.anio, d.oficiales.fact.uf), 3)}) es menor, por confirmar con la contadora.`]} /></Det>
      </>}
    </div>
  </>
}

// Tabla de metas por escenario (Vendido, Facturado y Cobrado), con las mismas cifras de la cascada.
function MetasTabla({ X }) {
  const { est, M, datos: d } = X, o = d.oficiales
  const fil = [['Vendido', 'facturado ÷ ' + (X.MT.ratio != null ? pc(X.MT.ratio, 0) : 'relación sin dato') + ' · estimación propia', mx(o.vend.clp, o.vend.uf), (kk) => valorComponente(M.esc[kk], 'ventas', X.MT.ratio) ?? 0], ['Facturado', 'sin meta propia', mx(o.fact.clp, o.fact.uf), (kk) => M.esc[kk].fact], ['Cobrado', 'plano caja', mx(o.cob.clp, o.cob.uf), (kk) => M.esc[kk].caja]]
  const cols = X.D ? X.ESC : X.ESC.filter(([k]) => k === est.esc), g = `minmax(0,1fr) ${X.D ? '110px ' : ''}${cols.map(() => '100px').join(' ')}`
  return <Panel><div style={{ display: 'grid', gridTemplateColumns: g, gap: 10, padding: '10px 16px', ...LBL, color: C.accent }}><span />{X.D && <span style={{ textAlign: 'right' }}>{d.anioBase} a la fecha</span>}{cols.map(([k, n]) => <span key={k} style={{ textAlign: 'right' }}>{n}</span>)}</div>
    {fil.map(([t, nota, ref, f]) => <div key={t} style={{ display: 'grid', gridTemplateColumns: g, gap: 10, padding: '10px 16px', borderTop: `1px solid ${C.border}`, fontSize: 13 }}><span>{t}<div style={{ fontSize: 11, color: C.muted }}>{nota}</div></span>{X.D && <span style={{ textAlign: 'right' }}><Val v={ref} /></span>}{cols.map(([k]) => <span key={k} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}><Val v={mm(f(k))} /></span>)}</div>)}</Panel>
}

// ── 6 · Seguimiento (presupuesto contra real) ──
const TONO_SEG = { ventas: ['a', 'ventas'], fact: ['y', 'fact'], caja: ['g', 'wal'], costos: ['t', 'egr'], margen: ['w', 'tax'], retiros: ['r', 'ing'] }
const sg2 = (/** @type {number} */ x) => (x >= 0 ? '+' : '−')
const TONO_BG = { a: C.azulBg, y: C.soonBg, g: C.greenBg, t: C.tealBg, r: C.ambarBg }

/**
 * Presupuesto y real mes a mes de los seis componentes (pesos y UF). Seguimiento del año en curso: contra la meta de ventas y de cobro (repartidas con la estacionalidad del facturado base) y el presupuesto de costos del año;
 * del año siguiente: contra la versión oficial (o el borrador). Lo que no tiene presupuesto propio (facturado y retiros del año en curso) queda sin desvío. Todo el reparto mensual es estimación propia.
 */
function seriesSeguimiento(X) {
  const { M, datos: d, est } = X, Y = d.anio, actual = Y === d.anioBase, cerr = mesesCerradosAnio(d.hoy, Y), o = d.oficiales, terc = (d.terc ?? 0) / 100
  const of = X.vers.find((v) => v.oficial), esc = of ? of.estado.esc : est.esc, ratio = X.MT.ratio
  const ymk = (/** @type {number} */ i) => ym(Y, i)
  /** @type {Record<string,(number|null)[]>} */ const P = {}, R = {}
  /** @type {Record<string,(number|null)[]>} */ const PU = {}, RU = {}
  const rate = (/** @type {number} */ i) => (actual ? d.uf26.porMes[i] : M.uf27[i]) || 1
  const nul = () => Array(12).fill(null)
  if (actual) {
    const w = d.base.baseCLP, costosP = d.costos26.mes
    P.ventas = o.metaVentasCLP > 0 ? distribuirMensual(o.metaVentasCLP, w) : nul(); P.caja = o.metaCobroCLP > 0 ? distribuirMensual(o.metaCobroCLP, w) : nul()
    P.costos = costosP; P.fact = nul(); P.retiros = nul()
    P.margen = P.caja.map((c, i) => (c == null ? null : c * (1 - terc) - costosP[i]))
    const cum = d.evo.vend, kU = o.vend.clp > 0 ? o.vend.uf / o.vend.clp : 0
    const vm = (/** @type {number} */ i) => (cum[i] == null ? null : cum[i] - (i > 0 ? cum[i - 1] ?? 0 : 0))
    R.fact = Array.from({ length: 12 }, (_, i) => d.serie[ymk(i)]?.fac ?? null); RU.fact = Array.from({ length: 12 }, (_, i) => d.serie[ymk(i)]?.facUF ?? null)
    R.ventas = Array.from({ length: 12 }, (_, i) => vm(i)); RU.ventas = R.ventas.map((x) => (x == null ? null : x * kU))
    R.caja = Array.from({ length: 12 }, (_, i) => d.cobMes[ymk(i)] ?? null); RU.caja = Array.from({ length: 12 }, (_, i) => d.cobMesUF[ymk(i)] ?? null)
    R.costos = Array.from({ length: 12 }, (_, i) => d.serie[ymk(i)]?.cos ?? null); RU.costos = Array.from({ length: 12 }, (_, i) => d.serie[ymk(i)]?.cosUF ?? null)
    R.margen = R.caja.map((c, i) => (c == null || R.costos[i] == null ? null : c * (1 - terc) - /** @type {number} */ (R.costos[i])))
    RU.margen = RU.caja.map((c, i) => (c == null || RU.costos[i] == null ? null : c * (1 - terc) - /** @type {number} */ (RU.costos[i])))
    R.retiros = d.retiros26.mes.map((x) => x); RU.retiros = d.retiros26.mesUF.map((x) => x)
  } else {
    const e = of && of.resumen && of.resumen[esc] ? of.resumen[esc] : M.esc[esc]
    const mens = of && of.resumen && of.resumen[esc] && of.resumen[esc].mensual ? of.resumen[esc].mensual : M.esc[esc].ing
    const vA = valorComponente(e, 'ventas', ratio) ?? 0
    P.fact = mens.slice(); P.ventas = distribuirMensual(vA, mens); P.caja = distribuirMensual(e.caja, mens); P.costos = distribuirMensual(e.costos, null); P.retiros = distribuirMensual(e.retiros, null)
    const ter = distribuirMensual(e.terc, mens); P.margen = P.caja.map((c, i) => c - ter[i] - P.costos[i])
    for (const kk of Object.keys(P)) R[kk] = nul()
  }
  const out = /** @type {Record<string,any>} */ ({})
  for (const kk of Object.keys(P)) {
    const real = R[kk] || nul(), rU = RU[kk] || nul()
    const pU = P[kk].map((v, i) => (v == null ? null : v / rate(i)))
    out[kk] = { c: seguimientoMensual({ pres: P[kk], real, cerrados: cerr, curso: actual && cerr < 12 }), u: seguimientoMensual({ curso: actual && cerr < 12, pres: pU, real: rU.map((x, i) => (real[i] != null && x == null ? /** @type {number} */ (real[i]) / rate(i) : x)), cerrados: cerr }) }
  }
  return { S: out, of, esc, cerr, actual }
}

export function Seguimiento({ X }) {
  const { est, D, datos: d, ui, setUI } = X, Y = d.anio
  const { S, of, esc, cerr } = seriesSeguimiento(X)
  const modo = ui.sg || 'p', comp = ui.sc || 'fact'
  const nombre = Object.fromEntries(COMPONENTES), corto = (/** @type {string} */ kk) => (kk === 'costos' ? 'Costos' : nombre[kk])
  const cel = (/** @type {any} */ a, /** @type {any} */ b) => mxP(a, b)
  const bueno = (/** @type {string} */ kk, /** @type {number} */ des) => (des === 0 ? true : (des > 0) === afavor(kk, true))
  // Desvío con flecha (↑ sobre el presupuesto, ↓ bajo él; verde a favor, rojo en contra) en % o en dinero, según el conmutador.
  const fl = (/** @type {string} */ kk, /** @type {any} */ m, /** @type {any} */ mu, /** @type {number} */ tam = 11) => (m == null || m.des == null ? <span style={{ color: C.muted }}>—</span>
    : <span style={{ fontWeight: 700, whiteSpace: 'nowrap', fontSize: tam, color: bueno(kk, m.des) ? C.greenText : C.overdueText }}>{m.des >= 0 ? '↑' : '↓'} {modo === 'p' ? (m.pres ? `${sg2(m.des)}${pc(Math.abs((m.des / m.pres) * 100), 0)}` : '—') : `${sg2(m.des)}${cel(Math.abs(m.des), Math.abs(mu.des))}`}</span>)
  const flA = (/** @type {string} */ kk, /** @type {any} */ c, /** @type {any} */ u) => (c.des == null ? <span style={{ color: C.muted }}>—</span> : <span style={{ fontWeight: 700, whiteSpace: 'nowrap', color: bueno(kk, c.des) ? C.greenText : C.overdueText }}>{c.des >= 0 ? '↑' : '↓'} {modo === 'p' ? (c.desPct != null ? `${sg2(c.des)}${pc(Math.abs(c.desPct), 0)}` : '—') : `${sg2(c.des)}${cel(Math.abs(c.des), Math.abs(u.des))}`}</span>)
  const rango = cerr > 0 ? `ene–${MESC[cerr - 1]}` : ''
  const tarjeta = (/** @type {string} */ kk) => {
    const s = S[kk], [tono, ic] = TONO_SEG[kk], u = s.u, c = s.c
    return <Tarjeta key={kk} tono={tono} ic={ic} label={nombre[kk]} aria={nombre[kk]} izq={{ cap: rango ? `Real ${rango}` : 'Real', val: cerr > 0 ? mx(c.realAcum, u.realAcum) : '—' }} der={{ cap: rango ? `Presupuesto ${rango}` : 'Presupuesto', val: c.presAcum != null && cerr > 0 ? mx(c.presAcum, u.presAcum) : cerr === 0 && c.cierre != null ? mx(c.cierre, u.cierre) : '—' }}
      cmp={cerr === 0 ? <span>Sin meses cerrados · presupuesto del año</span> : c.des != null ? <span style={{ display: 'inline-flex', gap: 12 }}><Flecha sube={c.des >= 0} bueno={bueno(kk, c.des)}>{sg2(c.des)}{c.desPct != null ? pc(Math.abs(c.desPct)) : ''}</Flecha><Flecha sube={c.des >= 0} bueno={bueno(kk, c.des)}>{sg2(c.des)}{mxP(Math.abs(c.des), Math.abs(u.des))}</Flecha></span> : <span>Sin presupuesto propio</span>}
      det={[['Cierre proyectado', c.cierre != null ? mx(c.cierre, u.cierre) : '—'], ['Meses cerrados', String(cerr)], ['Plano', 'presupuesto mensual: estimación propia']]} onClick={() => setUI({ sc: kk })} />
  }
  const avisos = []
  const f = S.fact.c
  if (f.presAcum > 0 && f.realAcum < f.presAcum * 0.9) avisos.push(`Facturado acumulado ${mx(f.realAcum, S.fact.u.realAcum)} contra ${mx(f.presAcum, S.fact.u.presAcum)} presupuestados (${pc((f.realAcum / f.presAcum - 1) * 100, 0)}).`)
  if (d.dias.promedio != null && d.dias.promedio > est.p[esc].dias) avisos.push(`Días de cobro reales ${d.dias.promedio} sobre los ${est.p[esc].dias} supuestos.`)
  const mayor = d.clientes[0], tope = 15
  if (mayor && d.totalFact && (mayor.monto / d.totalFact) * 100 > tope) avisos.push(`${mayor.name} concentra ${pc((mayor.monto / d.totalFact) * 100, 0)} de lo facturado (tope ${tope} %).`)
  const claves = Object.keys(S)
  const nomEst = (/** @type {string} */ e) => (e === 'cerrado' ? 'cerrado' : e === 'curso' ? 'en curso' : 'por venir')
  const conmut = <Seg options={[['p', '%'], ['m', '$']]} value={modo} onChange={(v) => setUI({ sg: v })} />
  const colW = '100px repeat(12,minmax(0,1fr)) 68px 68px 76px 70px', borde = `1px solid ${C.border}`
  const icono = (/** @type {string} */ kk) => { const [tono, ic] = TONO_SEG[kk]; return <span style={{ width: 24, height: 24, borderRadius: 8, background: tono === 'w' ? C.bgSoft : TONO_BG[tono], display: 'grid', placeItems: 'center', flexShrink: 0 }}><Ic n={ic} s={14} /></span> }
  const tabla = <Panel hd='Desvío por mes · contra el presupuesto' small={conmut}>
    <div style={{ overflowX: 'auto' }}><div style={{ minWidth: modo === 'p' ? 0 : 1120 }}>
      <div style={{ display: 'grid', gridTemplateColumns: colW, padding: '0 12px', ...LBL, fontSize: 10.5, color: C.accent }}>
        <span style={{ padding: '10px 0' }}>Componente</span>{MESC.map((m, i) => <span key={m} onClick={() => X.ir({ drill: { t: 'mes', i } })} style={{ textAlign: 'right', padding: '10px 4px 10px 0', cursor: 'pointer', color: i > cerr ? C.done : C.accent }}>{m}</span>)}
        {['Real', 'Presup.', 'Desvío', 'Cierre'].map((t) => <span key={t} style={{ textAlign: 'right', padding: '10px 0' }}>{t}</span>)}
      </div>
      {claves.map((kk) => { const c = S[kk].c, u = S[kk].u
        return <div key={kk} style={{ display: 'grid', gridTemplateColumns: colW, padding: '0 12px', alignItems: 'center', borderTop: borde, minHeight: 46 }}>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center', color: C.accent, fontWeight: 700, fontSize: 12.5 }}>{icono(kk)}{corto(kk)}</span>
          {c.meses.map((m, i) => <span key={i} onClick={() => X.ir({ drill: { t: 'mes', i } })} style={{ textAlign: 'right', paddingRight: 4, cursor: 'pointer', fontVariantNumeric: 'tabular-nums' }}>{m.estado === 'cerrado' ? fl(kk, m, u.meses[i]) : <span style={{ color: C.muted }}>—</span>}</span>)}
          <span style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{cel(c.realAcum, u.realAcum)}</span>
          <span style={{ textAlign: 'right', color: C.muted, fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{c.presAcum != null ? cel(c.presAcum, u.presAcum) : '—'}</span>
          <span style={{ textAlign: 'right', fontSize: 12 }}>{flA(kk, c, u)}</span>
          <span style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{c.cierre != null ? cel(c.cierre, u.cierre) : '—'}</span>
        </div> })}
      <div style={{ display: 'grid', gridTemplateColumns: colW, padding: '8px 12px 10px', borderTop: borde, fontSize: 10, color: C.muted }}><span>Estado</span>{S[claves[0]].c.meses.map((m, i) => <span key={i} style={{ textAlign: 'right', paddingRight: 4, color: m.estado === 'curso' ? C.accent : C.muted, fontWeight: m.estado === 'curso' ? 700 : 400 }} title={nomEst(m.estado)}>{m.estado === 'cerrado' ? '✓' : m.estado === 'curso' ? 'en curso' : '·'}</span>)}</div>
    </div></div>
  </Panel>
  const ks = S[comp] ? comp : 'fact', sel = S[ks], gr = 'minmax(0,.7fr) repeat(3,minmax(0,1fr)) 12px'
  const chips = <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>{claves.map((kk) => <button key={kk} onClick={() => setUI({ sc: kk })} aria-pressed={ks === kk} style={{ border: `1px solid ${ks === kk ? C.azulBg : C.border}`, background: ks === kk ? C.azulBg : C.card, color: ks === kk ? C.accent : C.muted, fontFamily: 'inherit', fontSize: 12.5, fontWeight: ks === kk ? 800 : 600, padding: '6px 12px', borderRadius: 20, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>{corto(kk)}</button>)}</div>
  const lista = <Panel>
    <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 12px' }}>{conmut}</div>
    <div style={{ display: 'grid', gridTemplateColumns: gr, gap: 8, padding: '8px 14px', borderTop: borde, ...LBL, fontSize: 10.5, color: C.accent }}><span>Mes</span><span style={{ textAlign: 'right' }}>Presup.</span><span style={{ textAlign: 'right' }}>Real</span><span style={{ textAlign: 'right' }}>Desvío</span><span /></div>
    {sel.c.meses.map((m, i) => { const mu = sel.u.meses[i]
      return <div key={i} onClick={() => X.ir({ drill: { t: 'mes', i } })} style={{ display: 'grid', gridTemplateColumns: gr, gap: 8, padding: '8px 14px', borderTop: borde, fontSize: 12, cursor: 'pointer', alignItems: 'center', fontVariantNumeric: 'tabular-nums' }}>
        <span style={{ fontWeight: 700 }}>{MESC[i]}</span>
        <span style={{ textAlign: 'right', color: C.muted }}><Val v={m.pres != null ? cel(m.pres, mu.pres) : '—'} /></span>
        <span style={{ textAlign: 'right' }}>{m.estado === 'cerrado' && m.real != null ? <b style={{ color: C.accent }}><Val v={cel(m.real, mu.real)} /></b> : <span style={{ color: C.muted }}>{m.estado === 'curso' ? 'a la fecha' : '—'}</span>}</span>
        <span style={{ textAlign: 'right' }}>{m.estado === 'cerrado' ? fl(ks, m, mu, 12) : <span style={{ color: C.muted }}>{m.estado === 'venir' ? 'por venir' : '—'}</span>}</span>
        <span style={{ color: C.done }}>›</span></div> })}
    <div style={{ display: 'grid', gridTemplateColumns: gr, gap: 8, padding: '9px 14px', borderTop: `2px solid ${C.accent}`, fontSize: 12.5, fontWeight: 800, color: C.accent, background: C.bgSoft }}><span>Acum.</span><span style={{ textAlign: 'right' }}>{sel.c.presAcum != null ? cel(sel.c.presAcum, sel.u.presAcum) : '—'}</span><span style={{ textAlign: 'right' }}>{cel(sel.c.realAcum, sel.u.realAcum)}</span><span style={{ textAlign: 'right' }}>{flA(ks, sel.c, sel.u)}</span><span /></div>
  </Panel>
  return <>
    <Titulo right={<span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500, color: C.muted }}>{rango ? `meses cerrados: ${rango}` : 'sin meses cerrados'}</span>}>Presupuesto contra real · {Y}</Titulo>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', background: C.card, border: borde, borderRadius: 12, padding: '10px 14px', fontSize: 12.5, color: C.muted }}>
      <span>Se mide contra {of ? <>la versión oficial <b style={{ color: C.accent }}>«{of.nombre}»</b></> : <>el <b style={{ color: C.accent }}>borrador</b> (sin versión oficial)</>} · escenario <b style={{ color: C.accent }}>{X.nomEsc(esc)}</b></span>
      <span onClick={() => X.ir({ drill: { t: 'ver' } })} role='button' style={{ cursor: 'pointer', fontWeight: 700, color: C.accent }}>Cambiar versión ›</span>
    </div>
    <Grid cols={3} colsM={1} gap={D ? 12 : 8}>{claves.map(tarjeta)}</Grid>
    <Titulo right={<span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500, color: C.muted }}>{D ? 'toca una celda para ver el mes' : 'toca un mes'} · presupuesto mensual: estimación propia</span>}>Mes a mes · {Y}</Titulo>
    {D ? tabla : <>{chips}{lista}<div style={{ fontSize: 12, color: C.muted }}>Cierre proyectado de {corto(ks).toLowerCase()}: <b style={{ color: C.accent }}>{sel.c.cierre != null ? mx(sel.c.cierre, sel.u.cierre) : '—'}</b> · real de los meses cerrados más presupuesto de los que faltan.</div></>}
    <Panel hd='Avisos' pad>{avisos.length ? <Lista items={avisos} /> : <div style={{ fontSize: 13, color: C.muted }}>Sin avisos por ahora.</div>}</Panel>
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
      <Mini ic='ventas' label={`Facturado ${Y}`} value={f && !futuro ? mx(f.fac, f.facUF) : '—'} sub={x != null ? `${sgn(x)}${pc(Math.abs(x), 0)} contra ${Y - 1}` : futuro ? 'aún no ocurre' : ''} cls={x == null ? '' : x >= 0 ? 'pos' : 'neg'} />
      <Mini ic='wal' label={`Cobrado ${Y}`} value={cob != null && !futuro ? mx(cob, d.cobMesUF[ym(Y, i)]) : '—'} sub='por fecha del depósito' />
      <Mini ic='doc' label={`Facturado ${Y - 1}`} value={a ? mx(a.fac, a.facUF) : '—'} sub='mismo mes del año anterior' />
      <Mini ic='cal' label='UF del mes' value={nf.format(Math.round(M.uf27[i]))} sub={`${d.anio} proyectada`} />
    </Grid>
    <Titulo>Proyección de {MESL[i].toLowerCase()} de {d.anio}</Titulo>
    <Grid cols={3} colsM={1}>{X.ESC.map(([k, n]) => <Mini key={k} ic='tgt' label={n + (k === est.esc ? ' · elegido' : '')} value={mx(M.esc[k].ing[i], M.esc[k].ingUF[i])} sub={monedaActual() === 'clp' ? ufs(M.esc[k].ingUF[i]) : ''} onClick={() => X.irEscTab('res')} />)}</Grid>
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
      <Mini ic='ventas' label={`Facturado ${d.anioBase}`} value={mx(c.monto, c.uf)} sub='de enero a la fecha' cls='pos' />
      <Mini ic='gauge' label='Parte de lo facturado' value={pc((c.monto / d.totalFact) * 100)} sub='de la oficina' />
      <Mini ic='fact' label='Facturas' value={String(c.n)} sub={`emitidas en ${d.anioBase}`} />
      <Mini ic='wal' label='Ticket promedio' value={mx(c.monto / c.n, c.uf / c.n)} sub='por factura' />
    </Grid>
    <Panel hd='Posición'>
      <Fila sin nombre='Lugar en el ranking' peq={`de ${d.clientes.length} clientes facturados`} valor={'#' + (i + 1)} />
      <Fila sin nombre={`Los ${i + 1} primeros suman`} peq={`de lo facturado en ${d.anioBase}`} valor={pc((acum / d.totalFact) * 100)} />
      <Fila nombre='Concentración de clientes' peq='ver los 5 primeros' valor='' onClick={() => X.ir({ drill: { t: 'ind', k: 'conc' } })} />
    </Panel>
    <div style={{ fontSize: 12, color: C.muted, margin: '0 4px' }}>Ficha en Clientes.</div>
    <Pager prev={i > 0 && { t: d.clientes[i - 1].name, go: () => X.irDrill({ t: 'cli', n: d.clientes[i - 1].id }) }} next={i < Math.min(7, d.clientes.length - 1) && { t: d.clientes[i + 1].name, go: () => X.irDrill({ t: 'cli', n: d.clientes[i + 1].id }) }} />
  </>
}

export function indicadores(X) {
  const { datos: d } = X, o = d.oficiales, Y = d.anioBase, H = Number(d.hoy.slice(5, 7)) - 1
  const mU = d.metaVentasUF > 0 ? d.metaVentasUF : null, enUF = (clp, u) => (monedaActual() === 'clp' ? [{ n: 'En UF', v: 'UF ' + nf.format(Math.round(u)) }] : [])
  const top5 = d.clientes.slice(0, 5).reduce((a, c) => a + c.monto, 0)
  return {
    vend: { tit: `Vendido ${Y}`, val: mx(o.vend.clp, o.vend.uf), sub: o.vend.pct != null ? pc(o.vend.pct, 0) + ' de la meta' : 'sin meta', fuente: 'ventas activas y terminadas del año, netas de costos de terceros, contra la meta anual', app: 'Oficina › Resultado del año', rows: [{ n: `Meta de ventas ${Y}`, c: 'neto de costos de terceros', v: o.metaVentasCLP ? mx(o.metaVentasCLP, mU) : 'sin meta' }, { n: 'Avance a la fecha', v: o.vend.pct != null ? pc(o.vend.pct, 0) : '—' }, { n: 'Ya facturado', c: 'de lo vendido', v: o.fact.pct != null ? pc(o.fact.pct, 0) : '—', go: () => X.ir({ drill: { t: 'ind', k: 'fact26' } }) }] },
    fact26: { tit: `Facturado ${Y}`, val: mx(o.fact.clp, o.fact.uf), sub: o.fact.pct != null ? pc(o.fact.pct, 0) + ' de lo vendido' : '', fuente: 'facturas emitidas con folio, contra lo vendido', app: 'Oficina › Resultado del año', rows: [{ n: 'Vendido', v: mx(o.vend.clp, o.vend.uf), go: () => X.ir({ drill: { t: 'ind', k: 'vend' } }) }, { n: 'Facturado', v: mx(o.fact.clp, o.fact.uf) }, { n: 'Por facturar', c: 'vendido que aún no tiene factura', v: mx(Math.max(0, o.vend.clp - o.fact.clp), Math.max(0, o.vend.uf - o.fact.uf)) }], texto: 'La facturación no tiene meta propia: la app la mide contra lo vendido.' },
    cob26: { tit: `Cobrado ${Y}`, val: mx(o.cob.clp, o.cob.uf), sub: o.cob.pct != null ? pc(o.cob.pct, 0) + ' de la meta' : 'sin meta', fuente: 'conciliación con el banco, contra la meta de cobranza', app: 'Oficina › Cobrado', rows: [{ n: `Meta de cobranza ${Y}`, v: o.metaCobroCLP ? mx(o.metaCobroCLP, null) : 'sin meta' }, { n: 'Avance a la fecha', v: o.cob.pct != null ? pc(o.cob.pct, 0) : '—' }, { n: 'Cobrado', v: mx(o.cob.clp, o.cob.uf) }] },
    marg: { tit: `Margen ${Y}`, val: mx(o.marg.clp, o.marg.uf), sub: o.marg.pct != null ? pc(o.marg.pct) + ' de ingresos' : '', fuente: 'ingresos menos costos de operación y comisiones', app: 'Oficina › Resultado del año', rows: [{ n: 'Margen', v: mx(o.marg.clp, o.marg.uf) }, { n: 'Sobre los ingresos', v: o.marg.pct != null ? pc(o.marg.pct) : '—' }] },
    ret26: { tit: `Retiros ${Y}`, val: mx(d.retiros26.total, d.retiros26.totalUF), sub: `${d.retiros26.n} retiro${d.retiros26.n !== 1 ? 's' : ''} de los socios`, fuente: 'transferencias a los socios (gastos «Retiros» de la oficina), como en la página Socios; por confirmar', app: 'Socios', rows: d.retiros26.socios.map((n) => ({ n, c: `sueldos pagados ${mxP(d.retiros26.sueldos[n] || 0, d.retiros26.sueldosUF[n] || 0)}`, v: mx(d.retiros26.porSocio[n] || 0, d.retiros26.porSocioUF[n] || 0), go: X.onOpenSocios })).concat([{ n: 'Sueldos de los socios', c: 'ya están en Remuneraciones', v: mx(d.retiros26.sueldoTot, Object.values(d.retiros26.sueldosUF).reduce((a, x) => a + Number(x), 0)) }]) },
    conc: { tit: 'Concentración de clientes', val: pc((d.totalFact ? top5 / d.totalFact : 0) * 100, 0), sub: `los 5 primeros de ${d.clientes.length} clientes facturados`, fuente: `facturado ${Y} por cliente`, app: 'Clientes', rows: d.clientes.slice(0, 5).map((c, i) => ({ n: `${i + 1}. ${c.name}`, v: mx(c.monto, c.uf), go: () => X.ir({ drill: { t: 'cli', n: c.id } }) })) },
    rec: { tit: 'Recurrente mensual', val: mx(d.recurrente.anualCLP / 12, d.recurrente.anualUF / 12), sub: `${d.recurrente.n} ventas mensuales activas`, fuente: 'ventas con cobro mensual y estado activo, sin subarriendo', app: 'Ventas', rows: [{ n: 'Anualizado ×12', c: 'como en Ventas', v: mx(d.recurrente.anualCLP, d.recurrente.anualUF) }, ...enUF(0, d.recurrente.anualUF), { n: 'Ingreso base de la proyección', c: 'ver la etapa Base', v: '', go: () => X.irBase() }] },
    dias: { tit: 'Días de cobro', val: d.dias.promedio != null ? d.dias.promedio + ' días' : 'sin dato', sub: d.dias.n ? `promedio ${Y} · mediana ${d.dias.mediana}` : 'sin facturas pagadas este año', fuente: `${d.dias.n} facturas pagadas en ${Y}, de la emisión al pago`, app: 'Cobranza', rows: [{ n: 'Promedio', v: d.dias.promedio != null ? d.dias.promedio + ' días' : '—' }, { n: 'Mediana', v: d.dias.mediana != null ? d.dias.mediana + ' días' : '—' }, { n: 'Facturas pagadas', v: String(d.dias.n) }, { n: 'Supuesto del escenario Prudente', v: X.est.p.prudente.dias + ' días', go: () => X.irEscTab('res') }] },
    terc: { tit: 'Comisiones', val: d.terc != null ? pc(d.terc) : 'sin dato', sub: 'de lo cobrado en el año', fuente: 'comisiones pagadas del año contra el cobrado propio, como en Inicio', app: 'Comisiones', rows: [{ n: 'Parte de lo cobrado', v: d.terc != null ? pc(d.terc) : '—' }, { n: `Supuesto del presupuesto ${d.anio}`, v: pc(X.est.p.base.terc), go: () => X.irEscTab('res') }] },
    cost: { tit: 'Costos de oficina por mes', val: mx(d.costos.reduce((a, c) => a + c.m, 0) + d.ppmMes, null), sub: 'presupuesto vigente, con PPM', fuente: 'costos de oficina vigentes por categoría', app: 'Oficina › Resultado del año › Presupuesto vs real', rows: d.costos.map((c) => ({ n: c.n, v: mx(c.m, null) + ' /mes', go: () => X.irCostos() })).concat([{ n: 'PPM', v: mx(d.ppmMes, null) + ' /mes', go: () => X.irEscTab('imp') }]) },
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
  const { datos: d } = X, e = d.evo, o = d.oficiales
  const H = Number(d.hoy.slice(5, 7)) - 1
  const def = { v: { nom: 'Vendido', c: o.vend, meta: o.metaVentasCLP, serie: e.vend, col: C.azulInfo, tono: 'a', ic: 'ventas', mes: e.cruceV, fecha: null }, c: { nom: 'Cobrado', c: o.cob, meta: o.metaCobroCLP, serie: e.cob, col: C.greenText, tono: 'g', ic: 'wal', mes: e.cruceC ? Number(e.cruceC.slice(5, 7)) - 1 : null, fecha: e.cruceC } }
  const rU = (x, c) => (c.clp > 0 ? (x * c.uf) / c.clp : null), val = (x, c) => mx(x, rU(x, c)), valP = (x, c) => mxP(x, rU(x, c))   // UF con la razón UF/pesos del total oficial de Inicio (estimación propia)
  const act = modo === 'a' ? [def.v, def.c] : [def[modo]]
  const maxV = Math.max(1, ...act.map((a) => Math.max(a.meta, ...a.serie.map((v) => v || 0))))
  const paso = (() => { const e10 = Math.pow(10, Math.floor(Math.log10(maxV / 4))); for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 10, 15, 20, 25, 30, 40, 50]) if (maxV / (m * e10) <= 4 + 1e-9) return m * e10; return maxV / 4 })()
  const nT = Math.max(1, Math.ceil(maxV / paso - 1e-9)), top = nT * paso
  const Ht = X.D ? 260 : 210, L = X.D ? 62 : 54, B = 26, T = 22, R = 24, x = (i) => L + (i * (W - L - R)) / 11, y = (v) => T + (1 - v / top) * (Ht - T - B)
  const ref = def.v.c.clp > 0 ? def.v.c : def.c.c, vv = (v) => valP(v, ref)
  const frase = (a) => (a.meta <= 0 ? `${a.nom}: sin meta definida` : a.mes != null ? `${a.nom}: meta superada ${a.fecha ? 'el ' + dmy(a.fecha) : 'en ' + MESL[a.mes].toLowerCase()}` : `${a.nom}: faltan ${valP(Math.max(0, a.meta - (a.c.clp || 0)), a.c)} para la meta`)
  const barras = e.areas.slice(0, 6), bw = WA / Math.max(1, barras.length), mxBar = Math.max(...barras.map((a) => a.monto), 1)
  const sobre = def.v.c.clp > 0 ? (def.c.c.clp / def.v.c.clp) * 100 : null
  const filas = (modo === 'c' ? def.c : def.v).serie
  const estado = (a) => (a.meta <= 0 ? ['z', 'sin meta'] : a.mes != null ? ['g', `meta ${valP(a.meta, a.c)} superada ` + (a.fecha ? 'el ' + dmy(a.fecha) : 'en ' + MESL[a.mes].toLowerCase())] : ['y', `faltan ${valP(Math.max(0, a.meta - (a.c.clp || 0)), a.c)} de ${valP(a.meta, a.c)}`])
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
    <Titulo>Origen de los ingresos · estimación propia</Titulo>
    <div style={{ display: 'grid', gridTemplateColumns: X.D ? '1fr 1fr' : '1fr', gap: 12, alignItems: 'start' }}>
      {[['Vendido por tipo de trabajo', e.areas.map((a) => ({ n: a.n, pct: a.pct, monto: val(a.monto, def.v.c), sub: 'de lo vendido', azul: true })), 'Sin ventas del año.'],
        ['Facturado por tipo de cliente', e.tipos.map((t) => ({ n: t.n, pct: t.pct, monto: mx(t.monto, t.uf), sub: `${t.nClientes} cliente${t.nClientes !== 1 ? 's' : ''}`, amb: t.n === 'Sin tipo', go: () => X.ir({ drill: { t: 'ind', k: 'conc' } }) })), 'Aún no hay facturas emitidas este año.']].map(([hd, items, vacio]) => <div key={hd} style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
        <span style={{ ...LBL, color: C.muted, padding: '0 4px' }}>{hd}</span>
        {items.length === 0 ? <div style={{ fontSize: 13, color: C.muted, padding: '0 4px' }}>{vacio}</div>
          : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 10 }}>{items.map((t, ti) => { const tn = t.amb ? { bg: C.bgSoft, bd: C.border, fg: C.grisText } : TONOS_TARJETA[ti % TONOS_TARJETA.length]; return <div key={t.n} onClick={t.go} style={{ background: tn.bg, border: `1px solid ${tn.bd}`, borderRadius: 12, padding: 12, cursor: t.go ? 'pointer' : 'default', minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: C.accent }}><span style={{ minWidth: 0 }}>{t.n}</span><span style={{ fontSize: 11, fontWeight: 800, background: '#fff', borderRadius: 20, padding: '1px 8px', whiteSpace: 'nowrap', color: tn.fg }}>{pc(t.pct, t.pct < 10 ? 1 : 0)}</span></div>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.4, color: C.accent, marginTop: 4, whiteSpace: 'nowrap' }}><Val v={t.monto} /></div>
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
    {x.rows.length > 0 && (k === 'vend' || k === 'cob26' ? <Det t='De dónde sale'><div style={{ margin: '-8px -14px -10px' }}>{x.rows.map((r, i) => <Fila key={i} nombre={r.n} peq={r.c} valor={r.v} onClick={r.go} sin={!r.go} />)}</div></Det> : <Panel hd='De dónde sale'>{x.rows.map((r, i) => <Fila key={i} nombre={r.n} peq={r.c} valor={r.v} onClick={r.go} sin={!r.go} />)}</Panel>)}
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
      <Mini ic='ventas' label={`Facturado ${d.anioBase}`} value={mx(s.facturado, null)} sub='atribuido, a la fecha' />
      <Mini ic='gauge' label='Parte de la oficina' value={pc(sh * 100)} sub='de lo facturado' />
      <Mini ic='tgt' label={`Facturado ${d.anio} · ${X.nomEsc(est.esc)}`} value={mm(e.fact * sh)} sub={monedaActual() === 'clp' ? ufs(e.factUF * sh) : ''} />
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
  const rows = [['Facturado', 'fact', 0], ['Comisiones', 'terc', 0], ['Presupuesto de costos', 'costos', 0], ['Margen', 'base', 1], ['Impuesto de primera categoría', 'idpc', 0], ['Retiros', 'retiros', 1]]
  const dif = diferenciaSupuestos(A, B, { mm, pc })
  return <>
    <Titulo>Escenario {X.nomEsc(k)} · versión contra el borrador de hoy</Titulo>
    <Panel>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 90px 90px 90px', gap: 10, padding: '10px 16px', ...LBL, color: C.accent }}><span /><span style={{ textAlign: 'right' }}>Versión</span><span style={{ textAlign: 'right' }}>Borrador</span><span style={{ textAlign: 'right' }}>Diferencia</span></div>
      {rows.map(([t, key, bueno]) => { const dd = eB[key] - eA[key], nulo = Math.abs(dd) < 1
        return <div key={t} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 90px 90px 90px', gap: 10, padding: '10px 16px', borderTop: `1px solid ${C.border}`, fontSize: 13 }}><span>{t}</span><span style={{ textAlign: 'right' }}><Val v={mm(eA[key])} /></span><span style={{ textAlign: 'right' }}><Val v={mm(eB[key])} /></span><b style={{ textAlign: 'right', color: nulo ? C.muted : bueno ? (dd > 0 ? C.greenText : C.overdueText) : C.text }}>{nulo ? '—' : (dd > 0 ? '+' : '−') + mmP(Math.abs(dd))}</b></div> })}
    </Panel>
    <Panel hd='Supuestos que cambian' small={`${dif.length} cambio${dif.length !== 1 ? 's' : ''}`} pad>{dif.length ? <Lista items={dif} /> : <span style={{ fontSize: 13, color: C.muted }}>El borrador es igual a esta versión.</span>}</Panel>
  </>
}

export const titulosDrill = (X, d) => d.t === 'mes' ? nombreMes(d.i) : d.t === 'cli' ? (X.datos.clientes.find((c) => c.id === d.n)?.name || 'Cliente') : d.t === 'soc' ? 'Socio · ' + d.n : d.t === 'socios' ? 'Sueldos y retiros de los socios' : d.t === 'ver' ? 'Versiones' : d.t === 'cmp' ? 'Comparar versión' : (indicadores(X)[d.k]?.tit || 'Detalle')
export const vistaDrill = (X, d) => d.t === 'mes' ? <DMes X={X} i={d.i} /> : d.t === 'cli' ? <DCli X={X} id={d.n} /> : d.t === 'soc' ? <DSoc X={X} n={d.n} /> : d.t === 'socios' ? <DSocios X={X} alza={X.est.p.base.alza} retiros={X.MT.ch.retiros} ir={X.onOpenSocios} irRetiros={() => X.ir({ drill: { t: 'ind', k: 'ret26' } })} /> : d.t === 'ver' ? <DVer X={X} /> : d.t === 'cmp' ? <DCmp X={X} id={d.id} /> : <DInd X={X} k={d.k} />
