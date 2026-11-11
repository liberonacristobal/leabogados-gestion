// Presupuesto anual · etapas 4 y 5 (Escenarios con resultado, impuesto y por socio; Seguimiento) y las páginas de detalle (mes, cliente, indicador, socio, versiones).
import { DArrastre, tituloArrastre } from './presupuestoArrastre.jsx'
import { EscenariosMeta } from './presupuestoEscenariosMeta.jsx'
import { aplicarAjustesArrastre } from '../../supabase/functions/_shared/arrastreAnio.js'
import { useEffect, useRef, useState } from 'react'
import { C, appAlert, fmtFechaDMY } from '../lib/base.jsx'
import { mesesCerradosAnio, repartoMensual, seguimientoMensual, afavor, componentesDe, componentesCortosDe, nombreCorto, modeloPresupuesto, diferenciaEstructurada, parteMeta, partePorSocio, tasaPPMLegal, escenariosContraMeta, referenciaSeguimiento, valorComponente, nombreComponente, sueldosYRetiros, totalesSocios, escenarioMetas, nombreEscenario, resumenDistribucion, MAX_NOMBRE_ESCENARIO } from '../../supabase/functions/_shared/presupuesto.js'
import { CFG_PRESUPUESTO as CFG } from '../lib/presupuestoCfg.js'
const TX = new Proxy({}, { get: (_, k) => CFG.tributario.textos[/** @type {string} */ (k)] }), cap = (/** @type {string} */ t) => t.charAt(0).toUpperCase() + t.slice(1)   // textos del régimen (cfg.tributario.textos)
import { descargarLibroPresupuesto } from '../lib/presupuestoExcel.js'
import { nf, mm, mx, mmP, mxP, mp, ufs, pc, sgn, MESL, MESC, Kpi, Mini, Titulo, Panel, Seg, Chip, Btn, Lnk, Fld, FldDin, Stp, Fila, Det, Lista, Grid, LBL, Flecha, tonoEsc, Val, Pestanas, Pliegue, Tarjeta, Ic, difMon, monedaActual, tasa27, tasa26, aUF, unidadUF } from '../lib/presupuestoUI.jsx'
import { nivelTxt, DSocios, vistaIdeal } from '../lib/presupuestoBloques.jsx'
import { filasBase } from './presupuestoEtapas1.jsx'
import { filasMetas, ComoSeArma } from './presupuestoMetas.jsx'
import { DCfg, DIni } from './presupuestoConfigVista.jsx'

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
  const campos = [['Reajuste UF', 'reajusteUF', 'pct', { suf: '%' }, ''], ['Tasa 1ª categoría', 'tasaIDPC', 'pct', { suf: '%' }, CFG.tributario.etiqueta], ['PPM del año', 'ppmAnual', 'money', { pre: '$' }, 'Hoy: ' + mp(X.datos.ppmMes) + ' al mes'], ['Reserva en cuenta corriente', 'reservaIni', 'money', { pre: '$' }, ''], ['Aumento de reserva', 'reserva', 'pct', { suf: '%' }, '']]
  return <div style={{ display: 'grid', gridTemplateColumns: `${D ? 'minmax(0,.8fr) minmax(0,.85fr) minmax(0,1fr) minmax(0,1.5fr) minmax(0,1.25fr)' : 'repeat(2,minmax(0,1fr))'}`, gap: 10, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '8px 14px' }}>
    {campos.map(([t, f, k, u, n]) => <div key={f} style={{ minWidth: 0 }}><div style={{ ...LBL, fontSize: 11, color: C.accent, marginBottom: 2, minHeight: D ? 14 : 28, display: 'flex', alignItems: 'flex-end', lineHeight: 1.25 }}>{t}</div>{f === 'ppmAnual' || f === 'reservaIni' ? <FldDin clp={est[f]} tasa={f === 'reservaIni' ? tasa26() : tasa27()} onCommit={(v) => setGen(f, f === 'reservaIni' ? Math.max(0, v) : v)} w={9999} /> : <Fld kind={k} value={est[f]} onCommit={(v) => setGen(f, v)} w={9999} {...u} />}{n && <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{n}</div>}</div>)}
  </div>
}

/** Columnas de la grilla de escenarios en escritorio: 3, salvo con 4 (2 × 2) para que las filas queden completas. */
export const colsEsc = (/** @type {number} */ n) => (n === 4 ? 2 : 3)

// Nombre del escenario en línea (sin ventana): Enter o salir del campo lo guarda; Escape lo deja como estaba.
function RenombrarEsc({ valor, tn, onFin }) {
  const [v, setV] = useState(valor), cancela = useRef(false)
  return <input autoFocus value={v} maxLength={MAX_NOMBRE_ESCENARIO} aria-label='Nombre del escenario' size={Math.max(8, Math.min(MAX_NOMBRE_ESCENARIO, v.length + 1))} onClick={(ev) => ev.stopPropagation()} onChange={(ev) => setV(ev.target.value)} onFocus={(ev) => ev.target.select()}
    onBlur={() => onFin(cancela.current ? null : v)} onKeyDown={(ev) => { if (ev.key === 'Enter') ev.currentTarget.blur(); else if (ev.key === 'Escape') { cancela.current = true; ev.currentTarget.blur() } }}
    style={{ border: `1px solid ${C.accent}`, background: C.card, color: C.accent, borderRadius: 20, padding: '1px 10px', fontSize: 13, fontWeight: 800, fontFamily: 'inherit', outline: 'none', minWidth: 0, maxWidth: '100%', boxSizing: 'border-box' }} />
}

// Tarjeta de escenario: la MISMA en el paso 4 (Escenarios contra la meta) y en el paso 5. Cada escenario lleva su tono (tonoEsc), dice si cubre la meta escrita en el paso 4 y la reserva al cierre en meses de costos.
// Con `editable` (paso 5) suma las acciones discretas Duplicar, Renombrar y Eliminar (y mover), sin botones nuevos en la barra.
export function CardEsc({ X, k, editable }) {
  const { est, M, setPal, setEsc, MT } = X, irEscTab = X.irEscTab, e = M.esc[k], p = est.p[k], rk = escenarioMetas(est, CFG), b = M.esc[rk], sel = est.esc === k, tn = tonoEsc(X.tonoDe(k))
  const [ren, setRen] = useState(false)
  const cu = escenariosContraMeta(M, MT.ancla, MT.valor, MT.ratio, MT.cv).find((x) => x.k === k)
  const idx = X.ESC.findIndex((x) => x[0] === k), n = X.ESC.length
  const xr = (t, v, go, strong) => <div onClick={(ev) => { if (go) { ev.stopPropagation(); go() } }} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: X.D ? '4px 4px' : '4px 2px', borderTop: `1px solid ${C.border}`, fontSize: 12, cursor: go ? 'pointer' : 'default', fontWeight: strong ? 800 : 400 }}><span>{t}</span><b style={{ fontWeight: 700, whiteSpace: 'nowrap', textAlign: 'right' }}><Val v={mm(v)} /></b></div>
  const lv = (t, f, suf, d, mn, mx, int) => <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}><small style={{ ...LBL, fontSize: 11, color: C.accent }}>{t}</small><Stp value={p[f]} suf={suf} step={d} min={mn} max={mx} int={int} onChange={(v) => { setPal(k, f, v); setEsc(k) }} /></div>
  const acc = { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', borderTop: `1px solid ${C.border}`, paddingTop: 4, marginTop: X.D ? 2 : 0 }
  return <div onClick={() => setEsc(k)} role='button' aria-pressed={sel} style={{ background: C.card, border: sel ? `2px solid ${tn.bd === C.border ? C.accent : tn.bd}` : `1px solid ${tn.bd}`, borderRadius: 12, padding: X.D ? (sel ? 11 : 12) : (sel ? 9 : 10), cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: X.D ? 6 : 3, minWidth: 0, boxSizing: 'border-box' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>{ren ? <RenombrarEsc valor={X.nomEsc(k)} tn={tn} onFin={(v) => { setRen(false); if (v != null) X.renombrarEsc(k, v) }} /> : <span style={{ background: tn.bg, color: tn.fg, border: `1px solid ${tn.bd}`, borderRadius: 20, padding: '2px 11px', fontSize: 13, fontWeight: 800 }}>{X.nomEsc(k)}</span>}{k !== rk && b && <Chip tono={e.retiros >= b.retiros ? 'g' : 'r'}>{sgn(e.retiros - b.retiros)}{mmP(Math.abs(e.retiros - b.retiros))} vs {X.nomEsc(rk)}</Chip>}</div>
    {X.D ? <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}><span style={{ ...LBL, color: C.muted }}>Retiros</span><span style={{ fontSize: 11, color: C.muted }}>{mmP(e.retiros * partePorSocio(X.datos.socios, CFG) / 12)} por socio al mes</span></div> : <div style={{ ...LBL, color: C.muted }}>Retiros</div>}
    <div style={{ fontSize: X.D ? 26 : 21, fontWeight: 800, letterSpacing: -0.6, color: e.retiros > 0 ? C.greenText : C.muted, lineHeight: 1.1 }}><Val v={mm(e.retiros)} /></div>{e.retiros <= 0 && <div style={{ fontSize: 12, color: C.muted }}>no alcanza para retirar</div>}
    {!X.D && <div style={{ fontSize: 11, color: C.muted }}>{mmP(e.retiros * partePorSocio(X.datos.socios, CFG) / 12)} por socio al mes</div>}
    {cu && cu.dif != null && Math.abs(cu.dif) >= 1 && <div style={{ fontSize: 12, color: C.muted }}><Flecha sube={cu.cubre} bueno={cu.cubre}>{cu.dif > 0 ? 'exceso' : 'déficit'} {mmP(Math.abs(cu.dif))}</Flecha></div>}
    {(() => { const det = <>
    <div style={{ marginTop: X.D ? 6 : 2 }}>{xr('Cobrado', e.caja, () => X.irBase())}{xr(`− Comisiones ${pc(p.terc, Number.isInteger(p.terc) ? 0 : 1)} del cobrado`, e.terc, () => X.irCostos())}{xr(`− ${nombreCorto('costos', CFG)}`, e.costos, () => X.irCostos())}{xr('− Impuesto', e.idpc, () => irEscTab('imp'))}{xr('− Aumento de reserva', e.reserva)}</div>
    <div style={{ fontSize: X.D ? 11 : 12, color: C.muted, borderTop: `1px solid ${C.border}`, paddingTop: X.D ? 5 : 7 }}>Reserva al cierre <b style={{ color: C.accent }}>{mm(e.reservaCierre)}</b>{e.mesesReserva != null ? ` · ${e.mesesReserva.toLocaleString('es-CL', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} meses de costos` : ''}</div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8, borderTop: `1px solid ${C.border}`, paddingTop: X.D ? 10 : 6, marginTop: X.D ? 6 : 2 }}>{lv('Ventas', 'g', '%', 1, -30, 80)}{lv('Costos', 'alza', '%', 0.5, 0, 20)}{lv('Cobro', 'dias', 'd', 5, 0, 90, true)}</div>
    {editable && <div style={acc} onClick={(ev) => ev.stopPropagation()}>
      {n < CFG.maxEscenarios && <Lnk onClick={() => X.duplicarEsc(k)}>Duplicar</Lnk>}
      <Lnk onClick={() => setRen(true)}>Renombrar</Lnk>
      {n > 1 && <Lnk rojo onClick={() => X.eliminarEsc(k)}>Eliminar</Lnk>}
      {n > 1 && <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 2 }}>{idx > 0 ? <Lnk titulo='Mover antes' onClick={() => X.moverEsc(k, -1)}>‹</Lnk> : <span style={{ width: 14 }} />}{idx < n - 1 ? <Lnk titulo='Mover después' onClick={() => X.moverEsc(k, 1)}>›</Lnk> : null}</span>}
    </div>}
    </>
      // En el celular el detalle de cada escenario va plegado (solo el elegido abierto): el paso 5 baja de ~2.100 px a una tarjeta corta por escenario.
      return X.D ? det : <details open={sel} onClick={(ev) => ev.stopPropagation()}><summary className='pp-tac' style={{ cursor: 'pointer', fontSize: 12, fontWeight: 700, color: C.accent, padding: '10px 0', listStyle: 'none' }}>Detalle y supuestos ›</summary>{det}</details> })()}
  </div>
}



// Paso 5 (alternativa D): tres tarjetas simples (solo Retiros, estado contra la meta y los supuestos en una línea) y un único panel «Cómo se llega» del escenario elegido, con cada fila de la cadena y,
// al lado, los controles de los que depende: decisión (punto lleno) o supuesto (punto vacío). Duplicar, Renombrar, Eliminar y mover viven en la cabecera del panel.
function CardEscSimple({ X, k }) {
  const { est, M, setEsc, MT } = X, e = M.esc[k], p = est.p[k], rk = escenarioMetas(est, CFG), b = M.esc[rk], sel = est.esc === k, tn = tonoEsc(X.tonoDe(k))
  const cu = escenariosContraMeta(M, MT.ancla, MT.valor, MT.ratio, MT.cv).find((x) => x.k === k)
  const fm = (/** @type {number} */ x) => Number(x).toLocaleString('es-CL', { maximumFractionDigits: 1 })
  return <div aria-label={`Escenario ${X.nomEsc(k)}`} style={{ background: C.card, border: sel ? `2px solid ${tn.bd === C.border ? C.accent : tn.bd}` : `1px solid ${tn.bd}`, borderRadius: 12, padding: X.D ? (sel ? 11 : 12) : (sel ? 9 : 10), cursor: 'default', display: 'flex', flexDirection: 'column', gap: X.D ? 5 : 3, minWidth: 0, boxSizing: 'border-box' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}><span style={{ background: tn.bg, color: tn.fg, border: `1px solid ${tn.bd}`, borderRadius: 20, padding: '2px 11px', fontSize: 13, fontWeight: 800 }}>{X.nomEsc(k)}</span>{sel && <Chip>elegido</Chip>}{k !== rk && b && <Chip tono={e.retiros >= b.retiros ? 'g' : 'r'}>{sgn(e.retiros - b.retiros)}{mmP(Math.abs(e.retiros - b.retiros))} vs {X.nomEsc(rk)}</Chip>}</div>
    <div style={{ ...LBL, color: C.muted }}>Retiros</div>
    <div style={{ fontSize: X.D ? 26 : 21, fontWeight: 800, letterSpacing: -0.6, color: e.retiros > 0 ? C.greenText : C.muted, lineHeight: 1.1 }}><Val v={mm(e.retiros)} /></div>
    <div style={{ fontSize: 11, color: C.muted }}>{e.retiros <= 0 ? 'no alcanza para retirar' : `${mmP(e.retiros * partePorSocio(X.datos.socios, CFG) / 12)} por socio al mes`}</div>
    {cu && cu.dif != null && Math.abs(cu.dif) >= 1 ? <div style={{ fontSize: 12, color: C.muted }}><Flecha sube={cu.cubre} bueno={cu.cubre}>{cu.dif > 0 ? 'exceso' : 'déficit'} {mmP(Math.abs(cu.dif))}</Flecha></div> : cu && cu.cubre ? <div style={{ fontSize: 12, fontWeight: 700, color: C.greenText }}>Cubre la meta</div> : null}
    <div style={{ fontSize: 11, color: C.muted, borderTop: `1px solid ${C.border}`, paddingTop: 5 }}>Ventas {fm(p.g)} % · Costos {fm(p.alza)} % · Cobro {p.dias} d</div>
  </div>
}

function PanelEsc({ X }) {
  const { est, M, setPal, setGen, setEsc, MT, D } = X, k = est.esc, e = M.esc[k], p = est.p[k], tn = tonoEsc(X.tonoDe(k)), idx = X.ESC.findIndex((x) => x[0] === k), n = X.ESC.length
  const [ren, setRen] = useState(false)
  const cu = escenariosContraMeta(M, MT.ancla, MT.valor, MT.ratio, MT.cv).find((x) => x.k === k)
  const ctl = (/** @type {string} */ t, /** @type {boolean} */ dec, /** @type {any} */ el) => <div key={t} style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}><div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}><span style={{ ...LBL, fontSize: 10.5, color: C.accent, whiteSpace: 'nowrap' }}>{t}</span><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, color: C.grisText, background: C.bgSoft, borderRadius: 20, padding: '1px 7px', whiteSpace: 'nowrap' }}><span style={{ width: 6, height: 6, borderRadius: '50%', boxSizing: 'border-box', background: dec ? C.grisText : 'transparent', border: `1.5px solid ${C.grisText}` }} />{dec ? 'decisión' : 'supuesto'}</span></div>{el}</div>
  const stp = (/** @type {string} */ f, /** @type {string} */ suf, /** @type {number} */ d, /** @type {number} */ mn, /** @type {number} */ mx2, int) => <Stp value={p[f]} suf={suf} step={d} min={mn} max={mx2} int={int} onChange={(v) => { setPal(k, f, v); setEsc(k) }} />
  const fila = (/** @type {string} */ t, /** @type {any} */ v, /** @type {any} */ ctls, tot) => <div style={{ display: 'grid', gridTemplateColumns: D ? 'minmax(120px,.9fr) 120px minmax(0,3fr)' : '1fr auto', gap: D ? 16 : '4px 10px', alignItems: 'center', padding: D ? '10px 0' : '9px 0', borderTop: tot ? `2px solid ${C.accent}` : `1px solid ${C.border}` }}>
    <span style={{ fontSize: 13, fontWeight: tot ? 800 : 600 }}>{t}</span><b style={{ textAlign: 'right', fontSize: tot ? 17 : 15, fontVariantNumeric: 'tabular-nums', color: tot ? C.greenText : C.text, whiteSpace: 'nowrap' }}><Val v={v} /></b>
    <div style={{ gridColumn: D ? undefined : '1 / -1', display: 'flex', gap: '8px 18px', flexWrap: 'wrap', alignItems: 'flex-end', minWidth: 0 }}>{ctls}</div></div>
  return <Panel>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 16px', borderBottom: `1px solid ${C.border}` }}>
      <span style={{ ...LBL, color: C.accent }}>Cómo se llega</span>
      {ren ? <RenombrarEsc valor={X.nomEsc(k)} tn={tn} onFin={(v) => { setRen(false); if (v != null) X.renombrarEsc(k, v) }} /> : <span style={{ background: tn.bg, color: tn.fg, border: `1px solid ${tn.bd}`, borderRadius: 20, padding: '2px 11px', fontSize: 13, fontWeight: 800 }}>{X.nomEsc(k)}</span>}
      <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {n < CFG.maxEscenarios && <Lnk onClick={() => X.duplicarEsc(k)}>Duplicar</Lnk>}<Lnk onClick={() => setRen(true)}>Renombrar</Lnk>{n > 1 && <Lnk rojo onClick={() => X.eliminarEsc(k)}>Eliminar</Lnk>}
        {n > 1 && <span style={{ display: 'inline-flex', gap: 2 }}>{idx > 0 ? <Lnk titulo='Mover antes' onClick={() => X.moverEsc(k, -1)}>‹</Lnk> : null}{idx < n - 1 ? <Lnk titulo='Mover después' onClick={() => X.moverEsc(k, 1)}>›</Lnk> : null}</span>}</span>
    </div>
    <div style={{ padding: '0 16px' }}>
      {fila('Cobrado', mm(e.caja), <>{ctl('Ventas', false, MT.ok ? <span style={{ fontSize: 13 }}>{pc(p.g)} <span style={{ color: C.muted }}>real en UF · lo exige la meta</span></span> : stp('g', '%', 1, -30, 80))}{ctl('Reajuste UF', false, <Fld kind='pct' suf='%' value={est.reajusteUF} onCommit={(v) => setGen('reajusteUF', v)} w={110} />)}{ctl('Cobro', true, stp('dias', 'd', 5, 0, 90, true))}</>)}
      {fila(`− Comisiones ${pc(p.terc, Number.isInteger(p.terc) ? 0 : 1)} del cobrado`, mm(e.terc), <span style={{ fontSize: 12, color: C.muted }}>Real {X.datos.anioBase}, no se elige</span>)}
      {fila(`− ${nombreCorto('costos', CFG)}`, mm(e.costos), ctl('Alza de costos', true, stp('alza', '%', 0.5, 0, 20)))}
      {fila('− Impuesto', mm(e.idpc), <>{ctl('Tasa 1ª categoría', false, <Fld kind='pct' suf='%' value={est.tasaIDPC} onCommit={(v) => setGen('tasaIDPC', v)} w={110} />)}{ctl('PPM del año', false, <FldDin clp={est.ppmAnual} tasa={tasa27()} onCommit={(v) => setGen('ppmAnual', v)} w={150} />)}</>)}
      {fila('− Aumento de reserva', mm(e.reserva), <>{ctl('Aumento', true, <Fld kind='pct' suf='%' value={est.reserva} onCommit={(v) => setGen('reserva', v)} w={110} />)}{ctl('Reserva en cuenta corriente', true, <FldDin clp={est.reservaIni} tasa={tasa26()} onCommit={(v) => setGen('reservaIni', Math.max(0, v))} w={150} />)}</>)}
      {fila('= Retiros', mm(e.retiros), ctl('Meta', true, <span style={{ fontSize: 13 }}>{mm(MT.valor)} {cu ? <b style={{ color: cu.cubre ? C.greenText : C.overdueText }}>{cu.cubre ? 'la cubre' : 'no la cubre'}</b> : null}</span>), true)}
      <div style={{ fontSize: 12, color: C.muted, padding: '9px 0 12px', borderTop: `1px solid ${C.border}` }}>Reserva al cierre <b style={{ color: C.accent }}>{mm(e.reservaCierre)}</b>{e.mesesReserva != null ? ` · ${e.mesesReserva.toLocaleString('es-CL', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} meses de costos` : ''} · punto lleno: decisión tuya; punto vacío: supuesto que estimamos.</div>
    </div>
  </Panel>
}

function TabImp({ X }) {
  const { est, M, setEsc } = X
  return <>
    <Grid cols={colsEsc(X.ESC.length)} colsM={1}>{X.ESC.map(([k, n]) => { const e = M.esc[k], sel = est.esc === k
      return <div key={k} onClick={() => setEsc(k)} style={{ background: C.card, border: sel ? `2px solid ${C.accent}` : `1px solid ${C.border}`, borderRadius: 12, padding: sel ? 13 : 14, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><b style={{ color: C.accent, fontSize: 14 }}>{n}</b>{sel && <Chip>elegido</Chip>}</div>
        <div style={{ ...LBL, color: C.muted }}>Saldo en {TX.mesAnual} de {X.datos.anio + 1}</div>
        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.6, color: e.saldo > 0 ? C.soonText : C.greenText, lineHeight: 1.1 }}><Val v={mm(Math.abs(e.saldo))} /></div>
        <div style={{ fontSize: 11, color: C.muted }}>{e.saldo >= 0 ? 'por pagar' : 'a favor'}</div>
        <div style={{ marginTop: 6 }}>{[['Base imponible', mm(e.base)], ['× Tasa de primera categoría', pc(est.tasaIDPC)], [`= Impuesto del año ${X.datos.anio}`, mm(e.idpc), 1], [`− PPM pagados en ${X.datos.anio}`, mm(e.ppm)], ['Impuesto sobre el resultado', pc((e.idpc / Math.max(1, e.base)) * 100)]].map(([t, v, s]) => <div key={t} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 4px', borderTop: `1px solid ${C.border}`, fontSize: 12, fontWeight: s ? 800 : 400 }}><span>{t}</span><b style={{ fontWeight: 700, textAlign: 'right' }}><Val v={v} /></b></div>)}</div></div> })}</Grid>
    <Panel hd='Calendario y alcance' pad><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Chip>{`Cada mes · ${TX.pagoMensual} en el ${TX.formulario} (hoy ${mp(X.datos.ppmMes)} al mes)`}</Chip><Chip>{`${cap(TX.mesAnual)} ${X.datos.anio + 1} · declaración anual de ${X.datos.anio}`}</Chip><Chip>{`Sin ${TX.impuestoIndirecto} · no hay crédito fiscal`}</Chip><Chip tono='y'>Fuera: impuesto personal de los socios, depreciación · tasa de {TX.pagoMensual} por confirmar</Chip></div></Panel>
  </>
}

// Metas de la oficina por escenario y la parte de cada socio (Vendido con la misma relación facturado/vendido de las metas).
const metasEsc = (X, k) => ({ ventas: valorComponente(X.M.esc[k], 'ventas', X.MT.ratio, X.MT.cv) ?? 0, fact: X.M.esc[k].fact, cobro: X.M.esc[k].caja })

function TabSoc({ X }) {
  const { est, M, datos: d } = X, e = M.esc[est.esc], tot = d.socios.reduce((a, s) => a + s.facturado, 0), mt = metasEsc(X, est.esc)
  return <>
    <Panel hd={`Por socio · ${X.nomEsc(est.esc)}`} small={CFG.socios && CFG.socios.reparto ? 'reparto de la configuración' : `partes iguales (${pc(parteMeta(d.socios, d.socios[0]?.nombre, CFG) * 100, 0)} cada socio)`}>
      {d.socios.map((s) => { const sh = tot ? s.facturado / tot : 0, sin = s.nombre === 'Sin socio', pm = parteMeta(d.socios, s.nombre, CFG)
        return <Fila key={s.nombre} nombre={s.nombre} peq={`${pc(sh * 100)} de lo facturado en ${d.anioBase}${sin ? '' : ' · retiros ' + mmP(e.retiros * pm / 12) + ' por mes'}`} sub={sin ? 'facturado ' + mmP(e.fact * sh) : `meta de ventas ${mmP(mt.ventas * pm)} · cobro ${mmP(mt.cobro * pm)}`} valor={sin ? '—' : mm(e.retiros * pm)} onClick={() => X.ir({ drill: { t: 'soc', n: s.nombre } })} /> })}
      <Fila tot sin nombre='Oficina' sub={`meta de ventas ${mmP(mt.ventas)} · cobro ${mmP(mt.cobro)}`} valor={mm(e.retiros)} />
    </Panel>
    <Titulo>Sueldos y retiros por escenario</Titulo>
    <Grid cols={colsEsc(X.ESC.length)} colsM={1}>{X.ESC.map(([k, n]) => { const r = sueldosYRetiros({ socios: d.retiros26.socios, costos: est.costos, alza: est.p[k].alza, retiros: M.esc[k].retiros, real: { sueldos: d.retiros26.sueldos, retiros: d.retiros26.porSocio }, cfg: CFG }), tn = tonoEsc(X.tonoDe(k))
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
    arrastre: X.arrastre.lineas.map((l) => ({ nombre: l.origen === 'agregada' ? l.nombre : X.cliNom(l.cid), concepto: l.origen === 'agregada' ? 'Agregada a mano' : l.concepto, tipo: l.tipo === 'cuota' ? 'Cuotas' : 'Asesoría', estado: l.quitado ? 'quitada' : l.origen === 'agregada' ? 'agregada' : l.ajustado ? 'ajustada' : 'de la app', n: l.n, mensual: l.mensual, meses: l.meses, total: l.monto, enApp: l.base.monto, nota: l.nota, porMes: l.porMes })),
    anio: d.anio, anioBase: d.anioBase, ufDic: d.ufDic, baseCLP: d.base.baseCLP, baseUF: d.base.baseUF, est, ESC: X.ESC, refK: escenarioMetas(est, CFG), costos: est.costos, socios: d.socios, oficiales: d.oficiales, metas: { ancla: X.MT.ancla, valor: X.MT.valor }, ratio: X.MT.ratio, cv: X.MT.cv, referencia: d.referencia,
    mes26: Array.from({ length: 12 }, (_, i) => { const k = (y) => `${y}-${String(i + 1).padStart(2, '0')}`; return { a: d.serie[k(d.anioBase - 1)]?.fac ?? null, f: d.serie[k(d.anioBase)]?.fac ?? null, cob: d.cobMes[k(d.anioBase)] ?? null } }),
  }, (t) => appAlert(t))
}

export function Escenarios({ X }) {
  const { est, M, D, ui, setUI, datos: d } = X
  const tabs = [['res', 'Resultado'], ['imp', 'Impuesto'], ['soc', 'Por socio']]
  const cuerpo = ui.tab === 'imp' ? <TabImp X={X} /> : ui.tab === 'soc' ? <TabSoc X={X} /> : <><EscenariosMeta X={X} /><Det t='Escenarios de supuestos · crecimiento, costos y cobro'><div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>Comparación de supuestos por escenario; el resultado de este paso sigue a la meta (Ideal) y no cambia con ellos.</div><Grid cols={colsEsc(X.ESC.length)} colsM={1}>{X.ESC.map(([k]) => <CardEscSimple key={k} X={X} k={k} />)}</Grid></Det><PanelEsc X={X} /></>
  const cascada = [['', 'Vendido neto (estimación propia)', (x) => mm(valorComponente(x, 'ventas', X.MT.ratio, X.MT.cv) ?? 0)], ['', 'Facturado', (x) => mm(x.fact)], ['−', 'Aumento de lo por cobrar', (x) => mm(x.dCob)], ['=', 'Cobrado', (x) => mm(x.caja), 1], ['−', 'Comisiones', (x) => mm(x.terc)], ['−', nombreCorto('costos', CFG), (x) => mm(x.costos)], ['=', 'Margen', (x) => mm(x.base), 1], ['−', 'Impuesto de primera categoría', (x) => mm(x.idpc)], ['=', 'Después de impuesto', (x) => mm(x.post), 1], ['−', 'Aumento de reserva', (x) => mm(x.reserva)], ['=', 'Retiros', (x) => mm(x.retiros), 1]]
  const e = M.esc[est.esc]
  const mensual = <div>{MESC.map((m, i) => <Fila key={m} nombre={MESL[i]} sub={monedaActual() === 'clp' ? ufs(e.ingUF[i]) : ''} valor={mx(e.ing[i], e.ingUF[i])} onClick={() => X.ir({ drill: { t: 'mes', i } })} />)}</div>
  const fmtN = (x) => Number(x).toLocaleString('es-CL', { maximumFractionDigits: 1 })
  const dg = { display: 'grid', gridTemplateColumns: D && ui.tab === 'res' ? 'repeat(4,minmax(0,1fr))' : D && X.ESC.length <= 3 ? '1fr 1fr' : '1fr',   // los cuatro plegables en una fila; el abierto toma todo el ancho (.pp-dg)
     gap: 10, alignItems: 'start' }
  return <>
    <Pestanas options={tabs} value={ui.tab} onChange={(v) => setUI({ tab: v })} />
    {ui.tab === 'imp' && <Strip X={X} />}
    {ui.tab === 'res' && <><Titulo right={X.MT.ok ? <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 600, color: C.muted }}>exige <b style={{ color: C.accent }}>{sgn(X.MT.ch.g)}{pc(Math.abs(X.MT.ch.g))}</b> real en UF</span> : null}>Escenarios contra la meta de {nombreComponente(X.MT.ancla, CFG).toLowerCase()} · {mm(X.MT.valor)}<span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 600, color: C.muted }}> · {nivelTxt(escenariosContraMeta(X.M, X.MT.ancla, X.MT.valor, X.MT.ratio, X.MT.cv).find((x) => x.cubre)?.k ?? null, X.ESC)}</span></Titulo></>}
    {cuerpo}
    <div className='pp-dg' style={dg}>
      {ui.tab === 'res' && <>
        <Det t={`Metas ${d.anio} · por escenario`}><MetasTabla X={X} /></Det>
        <Det t='Estado de resultados'><div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>Caja, sin {TX.impuestoIndirecto} · UF media {nf.format(Math.round(M.ufMed))}</div><Filas X={X} filas={cascada} /></Det>
        <Det t={`Facturado mes a mes · ${X.nomEsc(est.esc)}`}>{mensual}</Det>
        <Det t='Origen de los supuestos'><Lista items={[<span><b>Crecimiento real de ventas {X.ESC.map(([kk]) => fmtN(est.p[kk].g)).join(' / ')} %:</b> criterio sobre la base de {d.anioBase}, en UF; el del escenario {X.nomEsc(escenarioMetas(est, CFG))} ({pc(est.p[escenarioMetas(est, CFG)].g, 0)}) se compara con el reajuste de la UF ({pc(est.reajusteUF)}).</span>, <span><b>Alza de costos:</b> reajuste de sueldos más IPC; editable por escenario.</span>, <span><b>Comisiones:</b> la real de {d.anioBase}{d.terc != null ? ' (' + pc(d.terc) + ' de lo cobrado)' : ''}.</span>, <span><b>Días de cobro:</b> promedio real{d.dias.promedio != null ? ' ' + d.dias.promedio + ' días' : ''}{d.dias.mediana != null ? ', mediana ' + d.dias.mediana : ''}.</span>, <span><b>Impuesto:</b> primera categoría {pc(est.tasaIDPC)} para el año comercial {d.anio} ({CFG.tributario.etiqueta}); editable.</span>, <span><b>Reserva:</b> reserva en cuenta corriente {mm(est.reservaIni)}, no se toca; el aumento lo fijas tú.</span>]} /></Det>
      </>}
      {ui.tab === 'imp' && <>
        <Det t='Qué se paga y cuándo'><Lista items={[<span><b>Cada mes:</b> {TX.pagoMensual} en el {TX.formulario} del mes siguiente (hoy {mp(d.ppmMes)} presupuestados).</span>, <span><b>{cap(TX.mesAnual)} de {d.anio + 1}:</b> declaración anual de {d.anio}; se paga el saldo o se pide la devolución.</span>, <span><b>Sin {TX.impuestoIndirecto}:</b> no hay {TX.impuestoIndirecto} que proyectar ni crédito fiscal.</span>, <span><b>{cap(TX.retenciones)}:</b> las retenciones siguen yendo al {TX.formulario}, como hoy.</span>]} /></Det>
        <Det t='Lo que no se proyecta aquí'><Lista items={['El impuesto personal de cada socio por sus retiros.', 'Depreciación y gastos rechazados: se estiman con la contadora.', `Tasa de ${TX.pagoMensual}: se mantiene lo pagado hoy (conservador); la legal ${CFG.tributario.regimen} (${pc(tasaPPMLegal(d.anio, d.oficiales.fact.uf), 3)}) es menor, por confirmar con la contadora.`]} /></Det>
      </>}
    </div>
  </>
}

// Tabla de metas por escenario (Vendido, Facturado y Cobrado), con las mismas cifras de la cascada.
function MetasTabla({ X }) {
  const { est, M, datos: d } = X, o = d.oficiales
  const fil = [['Vendido', 'neto: facturado ÷ ' + (X.MT.ratio != null ? pc(X.MT.ratio, 0) : 'relación sin dato') + ' − ' + pc(X.MT.cv) + ' de comisiones · estimación propia', mx(o.vend.clp, o.vend.uf), (kk) => valorComponente(M.esc[kk], 'ventas', X.MT.ratio, X.MT.cv) ?? 0], ['Facturado', 'sin meta propia', mx(o.fact.clp, o.fact.uf), (kk) => M.esc[kk].fact], ['Cobrado', 'plano caja', mx(o.cob.clp, o.cob.uf), (kk) => M.esc[kk].caja]]
  const cols = X.D ? X.ESC : X.ESC.filter(([k]) => k === est.esc), g = `minmax(0,1fr) ${X.D ? '110px ' : ''}${cols.map(() => '100px').join(' ')}`
  return <Panel><div style={{ display: 'grid', gridTemplateColumns: g, gap: 10, padding: '10px 16px', ...LBL, color: C.accent }}><span />{X.D && <span style={{ textAlign: 'right' }}>{d.anioBase} a la fecha</span>}{cols.map(([k, n]) => <span key={k} style={{ textAlign: 'right' }}>{n}</span>)}</div>
    {fil.map(([t, nota, ref, f]) => <div key={t} style={{ display: 'grid', gridTemplateColumns: g, gap: 10, padding: '10px 16px', borderTop: `1px solid ${C.border}`, fontSize: 13 }}><span>{t}<div style={{ fontSize: 11, color: C.muted }}>{nota}</div></span>{X.D && <span style={{ textAlign: 'right' }}><Val v={ref} /></span>}{cols.map(([k]) => <span key={k} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}><Val v={mm(f(k))} /></span>)}</div>)}</Panel>
}

// ── 6 · Seguimiento (presupuesto contra real) ──
const TONO_SEG = { ventas: ['a', 'ventas'], fact: ['y', 'fact'], caja: ['g', 'wal'], costos: ['t', 'egr'], margen: ['w', 'tax'], retiros: ['r', 'ing'] }
const sg2 = (/** @type {number} */ x) => (x >= 0 ? '+' : '−')
const TONO_BG = { a: C.azulBg, y: C.soonBg, g: C.greenBg, t: C.tealBg, r: C.ambarBg }

/**
 * Presupuesto y real mes a mes de los seis componentes (pesos y UF). Seguimiento del año en curso: contra la meta de ventas (neta) y de cobro, repartidas con la distribución mensual elegida en Metas (por defecto partes iguales),
 * y el presupuesto de costos del año; del año siguiente: contra la versión oficial (o el borrador), con la distribución de esa versión. Lo que no tiene presupuesto propio (facturado y retiros del año en curso) queda sin desvío.
 * Todo el reparto mensual es estimación propia.
 */
function seriesSeguimiento(X) {
  const { M, datos: d, est } = X, Y = d.anio, actual = Y === d.anioBase, cerr = mesesCerradosAnio(d.hoy, Y), o = d.oficiales, terc = (d.terc ?? 0) / 100
  const of = X.vers.find((v) => v.oficial), esc = of ? of.estado.esc : est.esc, ratio = X.MT.ratio, cv = X.MT.cv
  const dist = (of ? of.estado.dist : est.dist) || { modo: {}, manual: {} }, pe = d.pesosEst, rep12 = (/** @type {number} */ total, /** @type {string} */ c) => repartoMensual(total, dist, c, pe)
  const ymk = (/** @type {number} */ i) => ym(Y, i)
  /** @type {Record<string,(number|null)[]>} */ const P = {}, R = {}
  /** @type {Record<string,(number|null)[]>} */ const PU = {}, RU = {}
  const rate = (/** @type {number} */ i) => (actual ? d.uf26.porMes[i] : M.uf27[i]) || 1
  const nul = () => Array(12).fill(null)
  const ref = referenciaSeguimiento({ actual, hayOficial: !!of, anio: Y, primerAnio: CFG.primerAnio }), modoMetas = ref === 'metas'
  if (actual) {   // el real del año en curso, mes a mes
    const costosP = d.costos26.mes
    const cum = d.evo.vend, kU = o.vend.clp > 0 ? o.vend.uf / o.vend.clp : 0
    const vm = (/** @type {number} */ i) => (cum[i] == null ? null : cum[i] - (i > 0 ? cum[i - 1] ?? 0 : 0))
    R.fact = Array.from({ length: 12 }, (_, i) => d.serie[ymk(i)]?.fac ?? null); RU.fact = Array.from({ length: 12 }, (_, i) => d.serie[ymk(i)]?.facUF ?? null)
    R.ventas = Array.from({ length: 12 }, (_, i) => vm(i)); RU.ventas = R.ventas.map((x) => (x == null ? null : x * kU))
    R.caja = Array.from({ length: 12 }, (_, i) => d.cobMes[ymk(i)] ?? null); RU.caja = Array.from({ length: 12 }, (_, i) => d.cobMesUF[ymk(i)] ?? null)
    R.costos = Array.from({ length: 12 }, (_, i) => d.serie[ymk(i)]?.cos ?? null); RU.costos = Array.from({ length: 12 }, (_, i) => d.serie[ymk(i)]?.cosUF ?? null)
    R.margen = R.caja.map((c, i) => (c == null || R.costos[i] == null ? null : c * (1 - terc) - /** @type {number} */ (R.costos[i])))
    RU.margen = RU.caja.map((c, i) => (c == null || RU.costos[i] == null ? null : c * (1 - terc) - /** @type {number} */ (RU.costos[i])))
    R.retiros = d.retiros26.mes.map((x) => x); RU.retiros = d.retiros26.mesUF.map((x) => x)
    if (modoMetas) {   // sin oficial: metas de ventas y cobranza y presupuesto de costos del año; facturado y retiros no tienen presupuesto propio
      P.ventas = o.metaVentasCLP > 0 ? rep12(o.metaVentasCLP, 'ventas') : nul(); P.caja = o.metaCobroCLP > 0 ? rep12(o.metaCobroCLP, 'caja') : nul()
      P.costos = costosP; P.fact = nul(); P.retiros = nul()
      P.margen = P.caja.map((c, i) => (c == null ? null : c * (1 - terc) - costosP[i]))
    }
  }
  if (!modoMetas) {   // contra la versión oficial (o el borrador): sus metas cubren los seis componentes
    const e = of && of.resumen && of.resumen[esc] ? of.resumen[esc] : M.esc[esc] || M.esc[est.esc]
    const vA = valorComponente(e, 'ventas', ratio, cv) ?? 0
    P.fact = rep12(e.fact, 'fact'); P.ventas = rep12(vA, 'ventas'); P.caja = rep12(e.caja, 'caja'); P.costos = rep12(e.costos, 'costos'); P.retiros = rep12(e.retiros, 'retiros')
    const ter = rep12(e.terc, 'caja'); P.margen = P.caja.map((c, i) => c - ter[i] - P.costos[i])   // las comisiones siguen al cobrado
    if (!actual) for (const kk of Object.keys(P)) R[kk] = nul()
  }
  const out = /** @type {Record<string,any>} */ ({})
  for (const kk of Object.keys(P)) {
    const real = R[kk] || nul(), rU = RU[kk] || nul()
    const pU = P[kk].map((v, i) => (v == null ? null : v / rate(i)))
    out[kk] = { c: seguimientoMensual({ pres: P[kk], real, cerrados: cerr, curso: actual && cerr < 12 }), u: seguimientoMensual({ curso: actual && cerr < 12, pres: pU, real: rU.map((x, i) => (real[i] != null && x == null ? /** @type {number} */ (real[i]) / rate(i) : x)), cerrados: cerr }) }
  }
  return { S: out, of, esc, cerr, actual, modoMetas, estS: of ? of.estado : est }
}

export function Seguimiento({ X }) {
  const { est, D, datos: d, ui, setUI } = X, Y = d.anio
  const { S, of, esc, cerr, estS, modoMetas } = seriesSeguimiento(X)
  const modo = ui.sg || 'p', comp = ui.sc || 'fact'
  const nombre = Object.fromEntries(componentesCortosDe(CFG)), corto = (/** @type {string} */ kk) => nombre[kk]
  const cel = (/** @type {any} */ a, /** @type {any} */ b) => mxP(a, b)
  const bueno = (/** @type {string} */ kk, /** @type {number} */ des) => (des === 0 ? true : (des > 0) === afavor(kk, true))
  const color = (/** @type {string} */ kk, /** @type {number} */ des) => (kk === 'retiros' ? C.muted : bueno(kk, des) ? C.greenText : C.overdueText)   // retiros bajo el presupuesto: color neutro, no es una alarma
  // Desvío con flecha (↑ sobre el presupuesto, ↓ bajo él; verde a favor, rojo en contra) en % o en dinero, según el conmutador.
  const fl = (/** @type {string} */ kk, /** @type {any} */ m, /** @type {any} */ mu, /** @type {number} */ tam = 11, /** @type {boolean} */ compacto = false) => (m == null || m.des == null ? <span style={{ color: C.muted }}>—</span>
    : <span style={{ fontWeight: 700, whiteSpace: 'nowrap', fontSize: tam, color: color(kk, m.des) }}>{compacto ? '' : (m.des >= 0 ? '↑ ' : '↓ ')}{modo === 'p' ? (m.pres ? `${sg2(m.des)}${compacto ? Math.round(Math.abs((m.des / m.pres) * 100)) + '%' : pc(Math.abs((m.des / m.pres) * 100), 0)}` : '—') : `${sg2(m.des)}${cel(Math.abs(m.des), Math.abs(mu.des))}`}</span>)
  const flA = (/** @type {string} */ kk, /** @type {any} */ c, /** @type {any} */ u) => (c.des == null ? <span style={{ color: C.muted }}>—</span> : <span style={{ fontWeight: 700, whiteSpace: 'nowrap', color: color(kk, c.des) }}>{c.des >= 0 ? '↑' : '↓'} {modo === 'p' ? (c.desPct != null ? `${sg2(c.des)}${pc(Math.abs(c.desPct), 0)}` : '—') : `${sg2(c.des)}${cel(Math.abs(c.des), Math.abs(u.des))}`}</span>)
  const rango = cerr > 0 ? `ene–${MESC[cerr - 1]}` : ''
  const tarjeta = (/** @type {string} */ kk) => {
    const s = S[kk], [tono, ic] = TONO_SEG[kk], u = s.u, c = s.c
    return <Tarjeta key={kk} tono={tono} ic={ic} label={nombre[kk]} aria={nombre[kk]} izq={cerr === 0 ? { cap: 'Presup.', val: c.cierre != null ? mx(c.cierre, u.cierre) : '—' } : { cap: 'Real', val: mx(c.realAcum, u.realAcum) }} der={cerr === 0 ? undefined : { cap: 'Presup.', val: c.presAcum != null ? mx(c.presAcum, u.presAcum) : '—' }}
      cmp={cerr === 0 ? <span> </span> : c.des != null ? <span style={{ display: 'inline-flex', gap: 12 }}><Flecha sube={c.des >= 0} bueno={kk === 'retiros' ? null : bueno(kk, c.des)}>{sg2(c.des)}{c.desPct != null ? pc(Math.abs(c.desPct)) : ''}</Flecha><Flecha sube={c.des >= 0} bueno={kk === 'retiros' ? null : bueno(kk, c.des)}>{sg2(c.des)}{mxP(Math.abs(c.des), Math.abs(u.des))}</Flecha></span> : <span>Sin presupuesto propio</span>}
      onClick={() => { setUI({ sc: kk }); X.ir({ drill: { t: 'comp', de: 'seg', k: kk } }) }} />
  }
  const avisos = []
  const f = S.fact.c
  if (f.presAcum > 0 && f.realAcum < f.presAcum * 0.9) avisos.push(`Facturado acumulado ${mx(f.realAcum, S.fact.u.realAcum)} contra ${mx(f.presAcum, S.fact.u.presAcum)} presupuestados (${pc((f.realAcum / f.presAcum - 1) * 100, 0)}).`)
  const diasSup = (estS.p[esc] || est.p[est.esc]).dias
  if (d.dias.promedio != null && d.dias.promedio > diasSup) avisos.push(`Días de cobro reales ${d.dias.promedio} sobre los ${diasSup} supuestos.`)
  const mayor = d.clientes[0], tope = 15
  if (mayor && d.totalFact && (mayor.monto / d.totalFact) * 100 > tope) avisos.push(`${mayor.name} concentra ${pc((mayor.monto / d.totalFact) * 100, 0)} de lo facturado (tope ${tope} %).`)
  const claves = componentesDe(CFG).map(([kk]) => kk).filter((kk) => S[kk])   // mismo orden y nombres que el resto (lista de componentes de la configuración)
  const nomEst = (/** @type {string} */ e) => (e === 'cerrado' ? 'cerrado' : e === 'curso' ? 'en curso' : 'por venir')
  const conmut = <Seg options={[['p', '%'], ['m', '$']]} value={modo} onChange={(v) => setUI({ sg: v })} />
  const colW = '130px repeat(12,minmax(0,1fr)) 72px 72px 84px 72px', borde = `1px solid ${C.border}`
  const icono = (/** @type {string} */ kk) => { const [tono, ic] = TONO_SEG[kk]; return <span style={{ width: 24, height: 24, borderRadius: 8, background: tono === 'w' ? C.bgSoft : TONO_BG[tono], display: 'grid', placeItems: 'center', flexShrink: 0 }}><Ic n={ic} s={14} /></span> }
  const tabla = <Panel hd='Desvío por mes · contra el presupuesto' small={conmut} style={{ border: 0, borderRadius: 0 }}>
    <div style={{ overflowX: 'auto' }}><div style={{ minWidth: modo === 'p' ? 0 : 1120 }}>
      <div style={{ display: 'grid', gridTemplateColumns: colW, padding: '0 12px', ...LBL, fontSize: 11, color: C.accent }}>
        <span style={{ padding: '10px 0' }}>Componente</span>{MESC.map((m, i) => <span key={m} onClick={() => X.ir({ drill: { t: 'mes', i } })} style={{ textAlign: 'right', padding: '10px 4px 10px 0', cursor: 'pointer', color: i > cerr ? C.muted : C.accent }}>{m}</span>)}
        {['Real', 'Presup.', 'Desvío', 'Cierre'].map((t) => <span key={t} style={{ textAlign: 'right', padding: '10px 0' }}>{t}</span>)}
      </div>
      {claves.map((kk) => { const c = S[kk].c, u = S[kk].u
        return <div key={kk} style={{ display: 'grid', gridTemplateColumns: colW, padding: '0 12px', alignItems: 'center', borderTop: borde, minHeight: 46 }}>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center', color: C.accent, fontWeight: 700, fontSize: 12 }}>{icono(kk)}{kk === 'costos' ? 'Costos' : corto(kk)}</span>
          {c.meses.map((m, i) => <span key={i} onClick={() => X.ir({ drill: { t: 'mes', i } })} style={{ textAlign: 'right', paddingRight: 4, cursor: 'pointer', fontVariantNumeric: 'tabular-nums' }}>{m.estado === 'cerrado' ? fl(kk, m, u.meses[i], 11, true) : <span style={{ color: C.muted }}>—</span>}</span>)}
          <span style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{cerr > 0 ? cel(c.realAcum, u.realAcum) : '—'}</span>
          <span style={{ textAlign: 'right', color: C.muted, fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{c.presAcum != null ? cel(c.presAcum, u.presAcum) : '—'}</span>
          <span style={{ textAlign: 'right', fontSize: 12 }}>{cerr > 0 ? flA(kk, c, u) : <span style={{ color: C.muted }}>—</span>}</span>
          <span style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{c.cierre != null ? cel(c.cierre, u.cierre) : '—'}</span>
        </div> })}
      <div style={{ display: 'grid', gridTemplateColumns: colW, padding: '8px 12px 10px', borderTop: borde, fontSize: 11, color: C.muted }}><span>Estado</span>{S[claves[0]].c.meses.map((m, i) => <span key={i} style={{ textAlign: 'right', paddingRight: 4, color: m.estado === 'curso' ? C.accent : C.muted, fontWeight: m.estado === 'curso' ? 700 : 400 }} title={nomEst(m.estado)}>{m.estado === 'cerrado' ? '✓' : m.estado === 'curso' ? 'en curso' : '·'}</span>)}</div>
    </div></div>
  </Panel>
  const ks = S[comp] ? comp : 'fact', sel = S[ks], gr = 'minmax(0,.7fr) repeat(3,minmax(0,1fr)) 12px'
  const chips = <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{claves.map((kk) => <button key={kk} onClick={() => setUI({ sc: kk })} aria-pressed={ks === kk} style={{ border: `1px solid ${ks === kk ? C.azulBg : C.border}`, background: ks === kk ? C.azulBg : C.card, color: ks === kk ? C.accent : C.muted, fontFamily: 'inherit', fontSize: 12, fontWeight: ks === kk ? 800 : 600, padding: '6px 12px', borderRadius: 20, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>{corto(kk)}</button>)}</div>
  // N08: sin meses cerrados y con el mismo presupuesto cada mes, una sola línea en vez de doce filas iguales.
  const mismoMes = cerr === 0 && sel.c.meses.length > 0 && sel.c.meses.every((m) => m.pres === sel.c.meses[0].pres)
  const lista = mismoMes ? <Panel pad><span style={{ fontSize: 13 }}>Presupuesto mensual <b style={{ color: C.accent }}><Val v={cel(sel.c.meses[0].pres, sel.u.meses[0].pres)} /></b> por mes · el real aparece al cierre de cada mes.</span></Panel> : <Panel>
    <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 12px' }}>{conmut}</div>
    <div style={{ display: 'grid', gridTemplateColumns: gr, gap: 8, padding: '8px 14px', borderTop: borde, ...LBL, fontSize: 11, color: C.accent }}><span>Mes</span><span style={{ textAlign: 'right' }}>Presup.</span><span style={{ textAlign: 'right' }}>Real</span><span style={{ textAlign: 'right' }}>Desvío</span><span /></div>
    {sel.c.meses.map((m, i) => { const mu = sel.u.meses[i]
      return <div key={i} onClick={() => X.ir({ drill: { t: 'mes', i } })} style={{ display: 'grid', gridTemplateColumns: gr, gap: 8, padding: '8px 14px', borderTop: borde, fontSize: 12, cursor: 'pointer', alignItems: 'center', fontVariantNumeric: 'tabular-nums' }}>
        <span style={{ fontWeight: 700 }}>{MESC[i]}</span>
        <span style={{ textAlign: 'right', color: C.muted }}><Val v={m.pres != null ? cel(m.pres, mu.pres) : '—'} /></span>
        <span style={{ textAlign: 'right' }}>{m.estado === 'cerrado' && m.real != null ? <b style={{ color: C.accent }}><Val v={cel(m.real, mu.real)} /></b> : <span style={{ color: C.muted }}>{m.estado === 'curso' ? 'a la fecha' : '—'}</span>}</span>
        <span style={{ textAlign: 'right' }}>{m.estado === 'cerrado' ? fl(ks, m, mu, 12) : <span style={{ color: C.muted }}>{m.estado === 'venir' ? 'por venir' : '—'}</span>}</span>
        <span style={{ color: C.done }}>›</span></div> })}
    <div style={{ display: 'grid', gridTemplateColumns: gr, gap: 8, padding: '9px 14px', borderTop: `2px solid ${C.accent}`, fontSize: 12, fontWeight: 800, color: C.accent, background: C.bgSoft }}><span>Acum.</span><span style={{ textAlign: 'right' }}>{sel.c.presAcum != null ? cel(sel.c.presAcum, sel.u.presAcum) : '—'}</span><span style={{ textAlign: 'right' }}>{cel(sel.c.realAcum, sel.u.realAcum)}</span><span style={{ textAlign: 'right' }}>{flA(ks, sel.c, sel.u)}</span><span /></div>
  </Panel>
  return <>
    <Titulo right={<span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500, color: C.muted }}>{rango ? `Meses cerrados: ${rango}` : 'Sin meses cerrados'}</span>}>Presupuesto contra real · {Y}</Titulo>
    <Pliegue t='Referencia' v={`${of ? `Oficial «${of.nombre}»` : modoMetas ? `Metas ${Y}` : 'Borrador'} · ${nombreEscenario(estS, esc)}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', padding: '10px 14px', fontSize: 12, color: C.muted }}>
        <span>{of ? <>Se mide contra la versión oficial <b style={{ color: C.accent }}>«{of.nombre}»</b></> : modoMetas ? <>Se mide contra las metas de {Y}: ventas, cobranza y costos</> : <>Sin versión oficial · se mide contra el <b style={{ color: C.accent }}>borrador</b></>} · escenario <b style={{ color: C.accent }}>{nombreEscenario(estS, esc)}</b>{cerr === 0 && <> · el real aparece al cierre de {MESL[0].toLowerCase()}</>}</span>
        <span style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {cerr === 0 && d.anio !== d.anioBase && <span onClick={() => X.irAnio(d.anioBase)} role='button' style={{ cursor: 'pointer', fontWeight: 700, color: C.accent }}>Ver Seguimiento {d.anioBase} ›</span>}
          <span onClick={() => X.ir({ drill: { t: 'ver' } })} role='button' style={{ cursor: 'pointer', fontWeight: 700, color: C.accent }}>{of ? 'Cambiar versión ›' : 'Marcar una como oficial ›'}</span></span>
      </div>
    </Pliegue>
    <Grid cols={3} colsM={2} gap={D ? 12 : 8}>{claves.map(tarjeta)}</Grid>
    <Pliegue key={Y} abajo={!D} t={`Mes a mes · ${Y}`} v={cerr > 0 ? `Acumulado ${cel(sel.c.realAcum, sel.u.realAcum)} · ${cerr} ${cerr === 1 ? 'mes cerrado' : 'meses cerrados'}` : 'Sin meses cerrados'}>{D ? tabla : <div style={{ padding: '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>{chips}{lista}<div style={{ fontSize: 12, color: C.muted }}>Cierre proyectado de {corto(ks).toLowerCase()}: <b style={{ color: C.accent }}>{sel.c.cierre != null ? mx(sel.c.cierre, sel.u.cierre) : '—'}</b> · real de los meses cerrados más presupuesto de los que faltan.</div></div>}</Pliegue>
    <Panel hd='Avisos' pad>{avisos.length ? <Lista items={avisos} /> : <div style={{ fontSize: 13, color: C.muted }}>Sin avisos por ahora.</div>}</Panel>
  </>
}

// ── Páginas de detalle ──
const nombreMes = (i) => MESL[i]
function Pager({ prev, next }) {
  const b = (x, izq) => !x ? <span /> : <button onClick={x.go} style={{ border: `1px solid ${C.border}`, background: C.card, color: C.accent, fontFamily: 'inherit', fontWeight: 700, fontSize: 13, padding: '9px 16px', borderRadius: 20, cursor: x ? 'pointer' : 'default', opacity: x ? 1 : 0.35 }}>{izq ? '‹ ' : ''}{x ? x.t : '—'}{izq ? '' : ' ›'}</button>
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
    <Grid cols={colsEsc(X.ESC.length)} colsM={1}>{X.ESC.map(([k, n]) => <Mini key={k} ic='tgt' label={n + (k === est.esc ? ' · elegido' : '')} value={mx(M.esc[k].ing[i], M.esc[k].ingUF[i])} sub={monedaActual() === 'clp' ? ufs(M.esc[k].ingUF[i]) : ''} onClick={() => X.irEscTab('res')} />)}</Grid>
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
  const mU = d.metaVentasUF > 0 ? d.metaVentasUF : null, enUF = (clp, u) => (monedaActual() === 'clp' ? [{ n: 'En UF', v: ufs(u) }] : [])
  const top5 = d.clientes.slice(0, 5).reduce((a, c) => a + c.monto, 0)
  const lento = [...X.ESC].sort((a, b) => X.est.p[b[0]].dias - X.est.p[a[0]].dias)[0][0]   // el escenario de cobro más lento
  return {
    vend: { tit: `Vendido ${Y}`, val: mx(o.vend.clp, o.vend.uf), sub: o.vend.pct != null ? pc(o.vend.pct, 0) + ' de la meta' : 'sin meta', fuente: 'ventas activas y terminadas del año, netas de comisiones a terceros, contra la meta anual (también neta)', app: 'Oficina › Resultado del año', rows: [{ n: 'Vendido bruto', v: mx(o.vendCascada.clp.bruto, o.vendCascada.uf.bruto) }, { n: '− Comisiones de venta', c: 'costo a terceros', v: mx(o.vendCascada.clp.costo, o.vendCascada.uf.costo) }, { n: '= Vendido neto', v: mx(o.vendCascada.clp.neto, o.vendCascada.uf.neto) }, ...enUF(o.vend.clp, o.vend.uf), { n: `Meta de ventas ${Y}`, c: 'neta de comisiones a terceros', v: o.metaVentasCLP ? mx(o.metaVentasCLP, mU) : 'sin meta' }, { n: 'Avance a la fecha', c: 'neto contra la meta', v: o.vend.pct != null ? pc(o.vend.pct, 0) : '—' }, { n: 'Ya facturado', c: 'del vendido bruto', v: o.fact.pct != null ? pc(o.fact.pct, 0) : '—', go: () => X.ir({ drill: { t: 'ind', k: 'fact26' } }) }] },
    fact26: { tit: `Facturado ${Y}`, val: mx(o.fact.clp, o.fact.uf), sub: o.fact.pct != null ? pc(o.fact.pct, 0) + ' del vendido bruto' : '', fuente: 'facturas emitidas con folio, contra el vendido bruto', app: 'Oficina › Resultado del año', rows: [{ n: 'Vendido bruto', v: mx(o.vendBruto.clp, o.vendBruto.uf), go: () => X.ir({ drill: { t: 'ind', k: 'vend' } }) }, { n: 'Facturado', v: mx(o.fact.clp, o.fact.uf) }, ...enUF(o.fact.clp, o.fact.uf), { n: 'Del vendido bruto', c: 'facturado ÷ vendido bruto', v: o.fact.pct != null ? pc(o.fact.pct, 0) : '—' }, { n: 'Por facturar', c: 'vendido que aún no tiene factura', v: mx(Math.max(0, o.vendBruto.clp - o.fact.clp), Math.max(0, o.vendBruto.uf - o.fact.uf)) }], texto: 'La facturación no tiene meta propia: la app la mide contra lo vendido bruto.' },
    cob26: { tit: `Cobrado ${Y}`, val: mx(o.cob.clp, o.cob.uf), sub: o.cob.pct != null ? pc(o.cob.pct, 0) + ' de la meta' : 'sin meta', fuente: 'conciliación con el banco, contra la meta de cobranza', app: 'Oficina › Cobrado', rows: [{ n: `Meta de cobranza ${Y}`, v: o.metaCobroCLP ? mx(o.metaCobroCLP, null) : 'sin meta' }, { n: 'Avance a la fecha', v: o.cob.pct != null ? pc(o.cob.pct, 0) : '—' }, { n: 'Cobrado', c: 'plano caja', v: mx(o.cob.clp, o.cob.uf) }, ...enUF(o.cob.clp, o.cob.uf)] },
    marg: { tit: `Margen ${Y}`, val: mx(o.marg.clp, o.marg.uf), sub: o.marg.pct != null ? pc(o.marg.pct) + ' de ingresos' : '', fuente: 'ingresos menos costos de operación y comisiones', app: 'Oficina › Resultado del año', rows: [{ n: 'Margen', c: 'devengado, como en Inicio', v: mx(o.marg.clp, o.marg.uf) }, ...enUF(o.marg.clp, o.marg.uf), { n: 'Sobre los ingresos', v: o.marg.pct != null ? pc(o.marg.pct) : '—' }, { n: 'En caja', c: 'cobrado − comisiones − costos · estimación propia', v: mx(d.referencia.margen.aFecha, d.refUF.margen.aFecha) }] },
    ret26: { tit: `Retiros ${Y}`, val: mx(d.retiros26.total, d.retiros26.totalUF), sub: `${d.retiros26.n} retiro${d.retiros26.n !== 1 ? 's' : ''} de los socios`, fuente: 'transferencias a los socios (gastos «Retiros» de la oficina), como en la página Socios; por confirmar', app: 'Socios', rows: [{ n: 'Retiros', c: d.retiros26.desde ? `${dmy(d.retiros26.desde)} a ${dmy(d.retiros26.hasta)}` : '', v: String(d.retiros26.n) }].concat(d.retiros26.socios.map((n) => ({ n, c: `sueldos pagados ${mxP(d.retiros26.sueldos[n] || 0, d.retiros26.sueldosUF[n] || 0)}`, v: mx(d.retiros26.porSocio[n] || 0, d.retiros26.porSocioUF[n] || 0), go: X.onOpenSocios }))).concat([{ n: 'Sueldos de los socios', c: 'ya están en Remuneraciones', v: mx(d.retiros26.sueldoTot, Object.values(d.retiros26.sueldosUF).reduce((a, x) => a + Number(x), 0)) }]) },
    costos26: { tit: `Presupuesto de costos ${Y}`, val: mx(d.costos26.real, d.costos26.realUF), sub: d.costos26.ppto > 0 ? 'real contra el presupuesto de los mismos meses' : 'sin presupuesto', fuente: 'costos de operación de Resultado del año (real aproximado, por confirmar) contra el presupuesto vigente', app: 'Oficina › Resultado del año › Presupuesto vs real', rows: [{ n: 'Real', c: d.costos26.hasta ? `enero a ${MESC[Number(d.costos26.hasta.slice(5, 7)) - 1]}, aproximado` : 'aproximado', v: mx(d.costos26.real, d.costos26.realUF) }, { n: 'Presupuesto de los mismos meses', v: mx(d.costos26.ppto, d.costos26.pptoUF) }, { n: 'Presupuesto del año', v: mx(d.costos26.ppto + d.costos26.pptoResto, d.costos26.pptoUF + d.costos26.pptoRestoUF) }, ...enUF(d.costos26.real, d.costos26.realUF)] },
    conc: { tit: 'Concentración de clientes', val: pc((d.totalFact ? top5 / d.totalFact : 0) * 100, 0), sub: `los 5 primeros de ${d.clientes.length} clientes facturados`, fuente: `facturado ${Y} por cliente`, app: 'Clientes', rows: d.clientes.slice(0, 5).map((c, i) => ({ n: `${i + 1}. ${c.name}`, v: mx(c.monto, c.uf), go: () => X.ir({ drill: { t: 'cli', n: c.id } }) })) },
    rec: { tit: 'Recurrente mensual', val: mx(d.recurrente.anualCLP / 12, d.recurrente.anualUF / 12), sub: `${d.recurrente.n} ventas mensuales activas`, fuente: 'ventas con cobro mensual y estado activo, sin subarriendo', app: 'Ventas', rows: [{ n: 'Anualizado ×12', c: 'como en Ventas', v: mx(d.recurrente.anualCLP, d.recurrente.anualUF) }, ...enUF(0, d.recurrente.anualUF), { n: 'Ingreso base de la proyección', c: 'ver la etapa Base', v: '', go: () => X.irBase() }] },
    dias: { tit: 'Días de cobro', val: d.dias.promedio != null ? d.dias.promedio + ' días' : 'sin dato', sub: d.dias.n ? `promedio ${Y} · mediana ${d.dias.mediana}` : 'sin facturas pagadas este año', fuente: `${d.dias.n} facturas pagadas en ${Y}, de la emisión al pago`, app: 'Cobranza', rows: [{ n: 'Promedio', v: d.dias.promedio != null ? d.dias.promedio + ' días' : '—' }, { n: 'Mediana', v: d.dias.mediana != null ? d.dias.mediana + ' días' : '—' }, { n: 'Facturas pagadas', v: String(d.dias.n) }, { n: `Supuesto del escenario ${nombreEscenario(X.est, lento)}`, v: X.est.p[lento].dias + ' días', go: () => X.irEscTab('res') }] },
    terc: { tit: 'Comisiones', val: d.terc != null ? pc(d.terc) : 'sin dato', sub: 'de lo cobrado en el año', fuente: 'comisiones pagadas del año contra el cobrado propio, como en Inicio', app: 'Comisiones', rows: [{ n: 'Parte de lo cobrado', v: d.terc != null ? pc(d.terc) : '—' }, { n: `Supuesto del presupuesto ${d.anio}`, v: pc(X.est.p[escenarioMetas(X.est, CFG)].terc), go: () => X.irEscTab('res') }] },
    cost: { tit: 'Presupuesto de costos por mes', val: mx(d.costos.reduce((a, c) => a + c.m, 0) + d.ppmMes, null), sub: 'presupuesto vigente, con PPM', fuente: 'costos de oficina vigentes por categoría', app: 'Oficina › Resultado del año › Presupuesto vs real', rows: d.costos.map((c) => ({ n: c.n, v: mx(c.m, null) + ' /mes', go: () => X.irCostos() })).concat([{ n: 'PPM', v: mx(d.ppmMes, null) + ' /mes', go: () => X.irEscTab('imp') }]) },
    conv: { tit: 'Conversión de propuestas', val: 'sin dato', sub: 'el índice de propuestas no tiene registros', fuente: 'índice de propuestas (Drive)', app: 'Ventas › Propuestas', rows: [], texto: `Para estimar la cartera nueva de ${d.anio} hace falta registrar las propuestas enviadas y las aceptadas. Sin ese dato, el crecimiento de ventas sale de un criterio y no de un cálculo.` },
  }
}

// Evolución del año de Vendido o Cobrado contra su meta, y de qué trabajos y clientes salen los ingresos (estimación propia: reparte el total oficial de Inicio según las partidas).
const dmy = (iso) => String(iso).slice(0, 10).split('-').reverse().join('-')
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
  const frase = (a) => (a.meta <= 0 ? `${a.nom}: sin meta definida` : a.mes != null ? `${a.nom}: meta superada ${a.fecha ? 'el ' + dmy(a.fecha) : 'en ' + MESL[a.mes].toLowerCase()}` : `${a.nom}: déficit de ${valP(Math.max(0, a.meta - (a.c.clp || 0)), a.c)} contra la meta`)
  const barras = e.areas.slice(0, 6), bw = WA / Math.max(1, barras.length), mxBar = Math.max(...barras.map((a) => a.monto), 1)
  const sobre = def.v.c.clp > 0 ? (def.c.c.clp / def.v.c.clp) * 100 : null
  const filas = (modo === 'c' ? def.c : def.v).serie
  const estado = (a) => (a.meta <= 0 ? ['z', 'sin meta'] : a.mes != null ? ['g', `meta ${valP(a.meta, a.c)} superada ` + (a.fecha ? 'el ' + dmy(a.fecha) : 'en ' + MESL[a.mes].toLowerCase())] : ['y', `déficit ${valP(Math.max(0, a.meta - (a.c.clp || 0)), a.c)} de ${valP(a.meta, a.c)}`])
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
  // Una sola categoría al 100 % solo repite el total: no se muestra.
  const origen = [['Vendido por tipo de trabajo', e.areas.map((a) => ({ n: a.n, pct: a.pct, monto: val(a.monto, def.v.c), sub: 'de lo vendido', azul: true })), 'Sin ventas del año.'],
        ['Facturado por tipo de cliente', e.tipos.map((t) => ({ n: t.n, pct: t.pct, monto: mx(t.monto, t.uf), sub: `${t.nClientes} cliente${t.nClientes !== 1 ? 's' : ''}`, amb: t.n === 'Sin tipo', go: () => X.ir({ drill: { t: 'ind', k: 'conc' } }) })), 'Aún no hay facturas emitidas este año.']].filter(([, it]) => !(it.length === 1 && it[0].pct >= 99.5))
  return <>
    <Titulo right={<Seg options={[['v', 'Vendido'], ['c', 'Cobrado'], ['a', 'Ambos']]} value={modo} onChange={setModo} />}>Evolución contra la meta · estimación propia</Titulo>
    <Grid cols={modo === 'a' ? 3 : 1} colsM={modo === 'a' ? 2 : 1}>
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
    {origen.length > 0 && <Titulo>Origen de los ingresos · estimación propia</Titulo>}
    {/* H15: filas neutras (los tonos son solo de los seis componentes), de mayor a menor, sin tarjetas solitarias */}
    {origen.length > 0 && <div style={{ display: 'grid', gridTemplateColumns: X.D && origen.length > 1 ? '1fr 1fr' : '1fr', gap: 12, alignItems: 'start' }}>
      {origen.map(([hd, items, vacio]) => <Panel key={hd} hd={hd}>{items.length === 0 ? <div style={{ fontSize: 13, color: C.muted, padding: '12px 16px' }}>{vacio}</div>
        : [...items].sort((x, y) => y.pct - x.pct).map((t) => <Fila key={t.n} nombre={t.n} peq={`${pc(t.pct, t.pct < 10 ? 1 : 0)} · ${t.sub}`} valor={t.monto} onClick={t.go} sin={!t.go} />)}</Panel>)}
    </div>}
    {e.tipos[0]?.n === 'Sin tipo' && e.tipos[0].pct > 50 && <div style={{ fontSize: 11, color: C.muted, margin: '0 4px' }}>La mayoría de lo facturado sale «Sin tipo»: completar el tipo en la ficha del cliente mejora este análisis.</div>}
  </>
}

// Aclaraciones de las tarjetas del paso 6 (antes en el plegable de la tarjeta).
export function filasSeg(X, kk) {
  const { datos: d } = X, Y = d.anio, { S, cerr, estS } = seriesSeguimiento(X), c = S[kk].c, u = S[kk].u
  const rows = [['Cierre proyectado', c.cierre != null ? mx(c.cierre, u.cierre) : '—'], ['Meses cerrados', String(cerr)], ...(kk === 'ventas' && Y === d.anioBase ? [['Bruto a la fecha', mx(d.oficiales.vendBruto.clp, d.oficiales.vendBruto.uf)], ['Plano', 'neto de comisiones, como la meta']] : []), ['Plano', 'presupuesto mensual: estimación propia · ' + resumenDistribucion(estS.dist, (cc) => nombreComponente(cc, CFG))]]
  return { rows, go: null }
}

// Página de un componente de los pasos 2, 4 y 6: las aclaraciones que antes se abrían dentro de la tarjeta, más el enlace al lugar al que llevaba.
export function DComp({ X, de, k }) {
  const f = de === 'base' ? filasBase(X, k) : de === 'metas' ? filasMetas(X, k) : filasSeg(X, k)
  return <>
  {(de === 'base' || de === 'metas') && <ComoSeArma X={X} k={k} />}
  <Panel hd='Detalle'>
    {f.rows.map(([t, v], i) => (String(v).length > 26 ? <Fila key={i} sin nombre={t} peq={v} valor='' /> : <Fila key={i} sin nombre={t} valor={v} />))}
    {f.go && <Fila nombre={f.go[0]} valor='' onClick={f.go[1]} />}
  </Panel>
  </>
}

// Página «Retiros»: tres tarjetas (Retiros, Sueldos, Total) y por socio su total con la apertura retiros + sueldos; Oficina = suma al peso (totalesSocios).
function DRetiros({ X }) {
  const { datos: d, ui, setUI } = X, R = d.retiros26, uf = monedaActual() === 'uf'
  const T = totalesSocios({ socios: R.socios, retiros: uf ? R.porSocioUF : R.porSocio, sueldos: uf ? R.sueldosUF : R.sueldos })
  const dmy = (/** @type {string} */ x) => fmtFechaDMY(x)
  const val = (/** @type {number} */ x) => (uf ? mx(0, x) : mx(x, null))
  const pq = (/** @type {number} */ x) => (uf ? mx(0, x) : mmP(x))   // en las aperturas, una sola moneda (en «Pesos y UF» solo pesos)
  const abierto = !!ui.retDet
  return <>
    <Grid cols={3} colsM={2} gap={X.D ? 10 : 8}>
      <Tarjeta tono='r' ic='ing' label='Retiros' aria='Retiros: ver cuántos y el período' izq={{ cap: 'Real', val: val(T.oficina.retiros) }} onClick={() => setUI({ retDet: !abierto })} />
      <Tarjeta tono='t' ic='doc' label='Sueldos' aria='Sueldos de los socios' izq={{ cap: 'Real', val: val(T.oficina.sueldos) }} />
      <div style={{ gridColumn: X.D ? undefined : '1 / -1' }}><Tarjeta tono='a' ic='chart' label='Total' aria='Retiros más sueldos' izq={{ cap: 'Retiros + sueldos', val: val(T.oficina.total) }} /></div>
    </Grid>
    {abierto && <Panel><Fila sin nombre={`${R.n} retiro${R.n !== 1 ? 's' : ''} de los socios`} peq={R.desde ? `del ${dmy(R.desde)} al ${dmy(R.hasta)}` : 'sin retiros registrados'} valor={val(T.oficina.retiros)} /></Panel>}
    <Panel hd='Por socio'>
      {T.filas.map((f) => <Fila key={f.socio} nombre={f.socio} peq={`retiros ${pq(f.retiros)} + sueldos ${pq(f.sueldos)}`} valor={val(f.total)} onClick={X.onOpenSocios} />)}
      <Fila tot sin nombre='Oficina' peq={`retiros ${pq(T.oficina.retiros)} + sueldos ${pq(T.oficina.sueldos)}`} valor={val(T.oficina.total)} />
    </Panel>
    <div style={{ fontSize: 12, color: C.muted, margin: '0 4px' }}>Fuente: {indicadores(X).ret26.fuente} · En la app: Socios</div>
  </>
}

export function DInd({ X, k }) {
  if (k === 'ret26') return <DRetiros X={X} />
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
  const tot = ss.reduce((a, x) => a + x.facturado, 0), sh = tot ? s.facturado / tot : 0, e = M.esc[est.esc], sin = n === 'Sin socio', pm = parteMeta(ss, n, CFG), mt = metasEsc(X, est.esc)
  return <>
    <Grid cols={4} colsM={2}>
      <Mini ic='ventas' label={`Facturado ${d.anioBase}`} value={mx(s.facturado, null)} sub='atribuido, a la fecha' />
      <Mini ic='gauge' label='Parte de la oficina' value={pc(sh * 100)} sub='de lo facturado' />
      <Mini ic='tgt' label={`Facturado ${d.anio} · ${X.nomEsc(est.esc)}`} value={mm(e.fact * sh)} sub={monedaActual() === 'clp' ? ufs(e.factUF * sh) : ''} />
      <Mini ic='wal' label={`Retiros ${d.anio} · ${X.nomEsc(est.esc)}`} value={sin ? '—' : mm(e.retiros * pm)} sub={sin ? 'no retira' : `${pc(pm * 100, 0)} de la oficina`} />
    </Grid>
    {!sin && <Grid cols={3} colsM={2}>
      <Mini ic='ventas' label={`Meta de ventas ${d.anio}`} value={mm(mt.ventas * pm)} sub={`${pc(pm * 100, 0)} de ${mm(mt.ventas)}`} />
      <Mini ic='fact' label={`Meta de facturación ${d.anio}`} value={mm(mt.fact * pm)} sub={`${pc(pm * 100, 0)} de ${mm(mt.fact)}`} />
      <Mini ic='wal' label={`Meta de cobro ${d.anio}`} value={mm(mt.cobro * pm)} sub={`${pc(pm * 100, 0)} de ${mm(mt.cobro)}`} />
    </Grid>}
    <Panel hd='Por escenario' small='toca para ver el resultado'>{X.ESC.map(([k, nn]) => <Fila key={k} nombre={nn} peq={'retiros ' + (sin ? '—' : mm(M.esc[k].retiros * pm))} valor={mm(M.esc[k].fact * sh)} onClick={() => { X.setEsc(k); X.irEscTab('soc') }} />)}</Panel>
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
    <Titulo right={<span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 600, color: vers.length >= 6 ? C.soonText : C.muted, display: 'inline-flex', gap: 10, alignItems: 'center' }}>{vers.length >= 2 && <Btn onClick={() => { setUI({ cmpA: vers[1].id, cmpB: vers[0].id, cmpE: null }); X.ir({ drill: { t: 'cmp', id: vers[1].id } }) }}>Comparar</Btn>}{vers.length} de 6</span>}>Versiones guardadas</Titulo>
    <Panel>{vers.length === 0 ? <div style={{ padding: 16, fontSize: 13, color: C.muted }}>Aún no hay versiones. Guarda la primera cuando termines una etapa.</div>
      : vers.map((v) => { const abierta = ui.vx === v.id, b = v.resumen && v.resumen.base ? v.resumen.base : null, c = conf && conf.id === v.id ? conf.a : null
        return <Fila key={v.id} abierta={abierta} nombre={<>{v.nombre}{v.oficial && <span style={{ marginLeft: 8 }}><Chip>Oficial</Chip></span>}{v.id === X.est.basadaEn && <span style={{ marginLeft: 8 }}><Chip tono='y'>borrador parte de aquí</Chip></span>}</>} peq={`${fechaDMY(v.created_at)}${v.creado_por ? ' · ' + v.creado_por : ''} · ${v.nota || 'sin nota'}`} sub={b ? 'retiros ' + mm(b.retiros) : ''} valor={b ? mm(b.fact) : ''} onClick={() => setUI({ vx: abierta ? null : v.id, confirma: null })}>
          {abierta && <div style={{ background: C.bgSoft, padding: '4px 16px 14px', display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
            {c === 'abrir' ? <><span>Reemplaza el borrador actual. Guárdalo antes como versión si lo necesitas.</span><span><Btn onClick={() => X.abrirVersion(v)}>Abrir</Btn> <Lnk onClick={() => setUI({ confirma: null })}>Cancelar</Lnk></span></>
              : c === 'borrar' ? <><span>Esta versión se elimina y no se puede recuperar.</span><span><Btn onClick={() => X.borrarVersion(v)}>Eliminar</Btn> <Lnk onClick={() => setUI({ confirma: null })}>Cancelar</Lnk></span></>
                : <><span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Btn onClick={() => setUI({ confirma: { a: 'abrir', id: v.id } })}>Abrir</Btn><Btn onClick={() => { setUI({ cmpA: v.id, cmpB: 'borrador', cmpE: null }); X.ir({ drill: { t: 'cmp', id: v.id } }) }}>Comparar con…</Btn><Btn onClick={() => X.marcarOficial(v)}>{v.oficial ? 'Quitar como oficial' : 'Marcar como oficial'}</Btn></span><Lnk rojo onClick={() => setUI({ confirma: { a: 'borrar', id: v.id } })}>Eliminar</Lnk></>}
          </div>}
        </Fila> })}</Panel>
  </>
}
const campo = { width: '100%', boxSizing: 'border-box', height: 34, padding: '0 10px', background: C.bgSoft, border: `1px solid ${C.border}`, borderRadius: 8, fontFamily: 'inherit', fontSize: 14, fontWeight: 600, color: C.text, outline: 'none' }

// Comparar versiones: se elige Antes y Después (versiones guardadas o el borrador actual; se pueden intercambiar) y el escenario; arriba las seis cifras con su diferencia y debajo los cambios agrupados en Supuestos, Costos, Metas y Notas.
export function DCmp({ X, id }) {
  const { vers, ui, setUI } = X, idA = ui.cmpA || id, idB = ui.cmpB || 'borrador'
  const quita = (/** @type {any} */ e) => { const { cfgFoto, ...r } = e || {}; return r }
  const get = (/** @type {string} */ i) => (i === 'borrador' ? { nombre: 'Borrador actual', estado: X.est } : vers.find((v) => v.id === i))
  const va = get(idA), vb = get(idB), aviso = (/** @type {string} */ t) => <div style={{ background: C.avisoBg, border: `1px solid ${C.avisoLine}`, borderRadius: 12, padding: 14, fontSize: 13 }}>{t}</div>
  if (!va || !vb) return aviso('Esa versión ya no existe.')
  const opts = [...vers.map((v) => [v.id, /\d{2}-\d{2}-\d{4}/.test(v.nombre) ? v.nombre : `${v.nombre} · ${fechaDMY(v.created_at).slice(0, 10)}`]), ['borrador', 'Borrador actual']]
  const sel = (/** @type {string} */ rot, /** @type {string} */ val, /** @type {(v:string)=>void} */ on) => <label style={{ display: 'block', minWidth: 0 }}><span style={{ ...LBL, color: C.muted, fontSize: 11 }}>{rot}</span><select value={val} onChange={(ev) => on(ev.target.value)} style={{ ...campo, height: 44, marginTop: 3 }}>{opts.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
  const A = quita(va.estado), B = quita(vb.estado), mA = modeloPresupuesto(X.datos.base, vistaIdeal(X.datos, A).est), mB = modeloPresupuesto(X.datos.base, vistaIdeal(X.datos, B).est)
  const comunes = mB.lista.filter(([kk]) => mA.esc[kk]).map(([kk]) => kk), k = comunes.includes(ui.cmpE) ? ui.cmpE : comunes.includes(X.est.esc) ? X.est.esc : comunes[0]
  const cab = <Panel><div style={{ padding: 12, display: 'grid', gridTemplateColumns: X.D ? 'minmax(0,1fr) auto minmax(0,1fr)' : '1fr', gap: 8, alignItems: 'end' }}>
    {sel('Antes', idA, (v) => setUI({ cmpA: v, cmpB: idB }))}
    <button aria-label='Intercambiar' onClick={() => setUI({ cmpA: idB, cmpB: idA })} className='pp-tac' style={{ width: 40, height: 40, borderRadius: '50%', border: `1px solid ${C.border}`, background: C.card, color: C.accent, cursor: 'pointer', justifySelf: 'center', fontSize: 16 }}>⇄</button>
    {sel('Después', idB, (v) => setUI({ cmpB: v, cmpA: idA }))}
  </div></Panel>
  if (!k) return <>{cab}{aviso('Las dos no comparten ningún escenario: no hay cifras que comparar.')}</>
  const eA = mA.esc[k], eB = mB.esc[k]
  const totArr = (/** @type {any} */ est) => aplicarAjustesArrastre(X.arrastre.base, est.arrastre, X.arrastre.base.morosos).total   // el arrastre de cada estado, sobre las líneas de hoy
  const rows = [[`Arrastre ${X.datos.anioBase}`, 'arr', 1], ['Facturado', 'fact', 0], ['Comisiones', 'terc', 0], [nombreCorto('costos', CFG), 'costos', 0], [nombreComponente('margen', CFG), 'base', 1], ['Impuesto de primera categoría', 'idpc', 0], [nombreComponente('retiros', CFG), 'retiros', 1]]
  const cambios = diferenciaEstructurada(A, B, { mm, pc, nombreComp: (/** @type {string} */ kk) => nombreCorto(kk, CFG), paso: (/** @type {number} */ i) => `Paso ${Number(i) + 1}`, totalArrastre: totArr })
  const grupos = ['Supuestos', 'Arrastre', 'Costos', 'Metas', 'Notas'].map((g) => [g, cambios.filter((x) => x.grupo === g)]).filter(([, l]) => l.length)
  const cols = X.D ? 'minmax(0,1fr) 96px 96px 96px' : 'minmax(0,1fr) 70px 70px 74px'
  return <>
    {cab}
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}><span style={{ ...LBL, color: C.muted }}>Escenario</span><Seg options={comunes.map((kk) => [kk, nombreEscenario(B, kk)])} value={k} onChange={(v) => setUI({ cmpE: v })} /></div>
    <Panel>
      <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, padding: '10px 16px', ...LBL, color: C.accent }}><span /><span style={{ textAlign: 'right' }}>Antes</span><span style={{ textAlign: 'right' }}>Después</span><span style={{ textAlign: 'right' }}>Dif.</span></div>
      {rows.map(([t, key, bueno]) => { const vA = key === 'arr' ? totArr(A) : eA[key], vB = key === 'arr' ? totArr(B) : eB[key], dd = vB - vA, nulo = Math.abs(dd) < 1
        return <div key={t} style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, padding: '10px 16px', borderTop: `1px solid ${C.border}`, fontSize: 13 }}><span>{t}</span><span style={{ textAlign: 'right', color: C.muted }}><Val v={mmP(vA)} /></span><span style={{ textAlign: 'right' }}><Val v={mmP(vB)} /></span><b style={{ textAlign: 'right', color: nulo ? C.muted : bueno ? (dd > 0 ? C.greenText : C.overdueText) : C.text }}>{nulo ? '—' : (dd > 0 ? '↑ ' : '↓ ') + mmP(Math.abs(dd))}</b></div> })}
    </Panel>
    <Titulo>Qué cambió · {cambios.length}</Titulo>
    {grupos.length === 0 ? <Panel pad><span style={{ fontSize: 13, color: C.muted }}>Las dos son iguales: no hay supuestos, arrastre, costos, metas ni notas distintos.</span></Panel>
      : grupos.map(([g, l]) => <Panel key={g} hd={g} small={`${l.length} cambio${l.length !== 1 ? 's' : ''}`}>{l.map((x, i) => <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '9px 16px', borderTop: i ? `1px solid ${C.border}` : 'none', fontSize: 13, flexDirection: X.D ? 'row' : 'column' }}><span>{x.etiqueta}</span><span style={{ fontWeight: 700, color: C.accent, textAlign: X.D ? 'right' : 'left' }}><span style={{ color: C.muted, fontWeight: 500 }}>{x.antes}</span> → {x.despues}</span></div>)}</Panel>)}
  </>
}

export const titulosDrill = (X, d) => d.t === 'mes' ? nombreMes(d.i) : d.t === 'cli' ? (X.datos.clientes.find((c) => c.id === d.n)?.name || 'Cliente') : d.t === 'soc' ? 'Socio · ' + d.n : d.t === 'socios' ? 'Sueldos y retiros de los socios' : d.t === 'ver' ? 'Versiones' : d.t === 'cmp' ? 'Comparar versión' : d.t === 'comp' ? nombreComponente(d.k, CFG) : d.t === 'arr' ? tituloArrastre(X, d) : d.t === 'cfg' ? 'Configuración del presupuesto' : d.t === 'ini' ? 'Preparar desde cero' : (indicadores(X)[d.k]?.tit || 'Detalle')
export const vistaDrill = (X, d) => d.t === 'mes' ? <DMes X={X} i={d.i} /> : d.t === 'cli' ? <DCli X={X} id={d.n} /> : d.t === 'soc' ? <DSoc X={X} n={d.n} /> : d.t === 'socios' ? <DSocios X={X} alza={X.est.p.base.alza} retiros={X.MT.ch.retiros} ir={X.onOpenSocios} irRetiros={() => X.ir({ drill: { t: 'ind', k: 'ret26' } })} /> : d.t === 'ver' ? <DVer X={X} /> : d.t === 'cmp' ? <DCmp X={X} id={d.id} /> : d.t === 'comp' ? <DComp X={X} de={d.de} k={d.k} /> : d.t === 'arr' ? <DArrastre X={X} k={d.k} /> : d.t === 'cfg' ? (X.esAdmin ? <DCfg X={X} /> : null) : d.t === 'ini' ? <DIni X={X} /> : <DInd X={X} k={d.k} />
