// Presupuesto anual · paso 4: Metas 2027. Se escribe la meta de UN componente (retiros al partir) y los demás se proyectan con la misma cascada del modelo, en cualquier dirección
// (metasDesdeComponente en _shared/presupuesto.js). Pasos 1 y 2 muestran los mismos seis componentes de solo lectura; las metas se escriben solo aquí.
import { C, fmtFechaDMY } from '../lib/base.jsx'
import { cadenaMeta, componentesDe, componentesCortosDe, nombreCorto, anclasDe, valorComponente, escenariosContraMeta, nivelDeMeta, nombreComponente, reservaRecomendada, escenarioMetas, resumenDistribucion, partePorSocio, afavor } from '../../supabase/functions/_shared/presupuesto.js'
import { mm, mmP, mx, m26, pc, sgn, Tarjeta, FldDin, Fld, Titulo, Btn, Grid, tasa27, Pliegue, Panel, Fila, MESC, monedaActual, difMon, Seg, Val, LBL, Ic, Flecha } from '../lib/presupuestoUI.jsx'
import { pctSobreCierre, metaBajoCierre, faltaFacturar, cobranzaAnio, flujoMensualMeta } from '../../supabase/functions/_shared/metaPresupuesto.js'
import { repartoCierre } from '../lib/cifras.js'
import { Cmp, Supuestos, ReservaBloque, TablaPresupuesto, motivoMeta, nivelTxt } from '../lib/presupuestoBloques.jsx'
import { CFG_PRESUPUESTO as CFG } from '../lib/presupuestoCfg.js'
import { CardEsc, colsEsc } from './presupuestoEtapas2.jsx'
import { Distribucion } from './presupuestoDistribucion.jsx'

/** Tono e ícono de cada componente: los mismos de la app en los pasos 1, 2 y 4 (de la configuración del estudio). */
export const TONO_COMP = Object.fromEntries(CFG.componentes.map((c) => [c.k, [c.tono, c.ic]]))
/** Colores de la fila de cada componente (los de sus tarjetas en los otros pasos). */
const TONOS_FILA = { a: { bg: C.azulBg, fg: C.azulInfo }, y: { bg: C.soonBg, fg: C.soonText }, g: { bg: C.greenBg, fg: C.greenText }, t: { bg: C.tealBg, fg: C.tealText }, r: { bg: C.ambarBg, fg: C.coralText }, w: { bg: C.bgSoft, fg: C.accent } }
const PLANO = {
  ventas: (r, cv) => ['Neto de comisiones · estimación propia', r != null ? `facturado ÷ ${pc(r, 0)} = bruto; bruto − ${pc(cv ?? 0)} de comisiones` : 'falta la relación facturado/vendido'], fact: () => ['Facturado', 'cobrado + aumento de lo por cobrar'], caja: () => ['Caja', 'facturado − aumento de lo por cobrar'],
  costos: () => ['Presupuesto', 'presupuesto vigente + aumento'], margen: () => ['Antes de impuesto', 'cobrado − comisiones − costos'], retiros: () => ['Después de impuesto y reserva', 'margen − impuesto − reserva'],
}

/**
 * Cifras de «Composición del cierre» de un componente: real a la fecha, resto y cierre repartidos con repartoCierre (real + resto = cierre en $M de 1 decimal; en UF, a 1 UF).
 * @returns {{ a:any, r:any, c:any }} cada una lista para mostrar (moneda de la app)
 */
export function cierreCifras(X, k, corto = false) {
  const r = X.datos.referencia[k], u = X.datos.refUF[k], uf = monedaActual() === 'uf'
  if (uf) { const p = repartoCierre(u.aFecha, u.cierre - u.aFecha, 1); return { a: mx(0, p.aFecha), r: mx(0, p.resto), c: mx(0, p.cierre) } }
  const p = repartoCierre(r.aFecha, r.resto), ru = u.cierre - u.aFecha
  if (corto) return { a: mmP(p.aFecha), r: mmP(p.resto), c: mmP(p.cierre) }   // en las líneas del plegable, una sola moneda
  return { a: mx(p.aFecha, u.aFecha), r: mx(p.resto, ru), c: mx(p.cierre, u.cierre) }
}
const cero = (/** @type {number} */ v) => (Math.abs(v) < 1 ? '$0' : m26(v))

/** Tabla «Composición del cierre» de la página de un componente: real a la fecha, promedio mensual de 3 meses (con sus cifras), meses que faltan, resto y cierre. */
export function ComoSeArma({ X, k }) {
  const d = X.datos, r = d.referencia[k], Y = d.anioBase, c = cierreCifras(X, k), meses = (d.refMeses || {})[k]
  const hoy = fmtFechaDMY(d.hoy), fin = fmtFechaDMY(`${Y}-12-31`)
  const costos = k === 'costos', prom = r.promedio != null && meses && meses.length
  const filas = [[costos ? 'Real de los meses cerrados' : 'Real a la fecha', costos ? '' : `al ${hoy}`, c.a]]
  if (prom) {
    filas.push(['Promedio mensual', `${meses.map((x) => `${MESC[x.m - 1]} ${cero(x.v)}`).join(' · ')}, entre ${meses.length}`, m26(r.promedio)])
    filas.push(['Meses que faltan', `del ${hoy} al ${fin}`, r.faltan.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })])
  }
  if (r.resto) filas.push([costos ? 'Presupuesto de los meses que faltan' : `Resto de ${Y}`, prom ? 'promedio × meses que faltan' : '', c.r])
  filas.push([`Cierre ${Y} estimado`, 'real a la fecha + resto', c.c])
  return <Panel hd='Composición del cierre'>{filas.map(([t, s, v], i) => <Fila key={i} sin tot={i === filas.length - 1} nombre={t} peq={s || undefined} valor={v} />)}</Panel>
}

/** Plegable de una línea bajo las tarjetas de los pasos 2 y 4: «Cierre = real a la fecha + resto del año»; abierto, una línea por cierre con sus cifras. */
export function ComoSeCalcula({ X, de, solo = false }) {
  const d = X.datos, Y = d.anioBase, an = d.anio
  const par = (/** @type {string} */ k) => { const c = cierreCifras(X, k, true); return `${c.a} + ${c.r}` }
  const items = [
    [`Cierre ${Y}`, `Vendido, Facturado y Cobrado: lo real a la fecha más el promedio mensual de los últimos 3 meses cerrados × los meses que faltan (${d.referencia.ventas.faltan.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}).`, `Vendido ${par('ventas')} · Facturado ${par('fact')} · Cobrado ${par('caja')}`],
    ['Presupuesto', 'lo real de los meses cerrados más el presupuesto de los que faltan.', par('costos')],
    ['Margen', 'cobrado, menos comisiones, menos costos, todo del cierre.', cierreCifras(X, 'margen', true).c],
    ['Retiros', 'lo retirado a la fecha; no se proyecta.', cierreCifras(X, 'retiros', true).c],
    de === 'base' ? ['Base', `últimos 12 meses cerrados, sin crecimiento.`, ''] : ['Proyectado', `resultado del escenario ${X.nomEsc(escenarioMetas(X.est, CFG))} con el crecimiento que lleva a la meta; Presupuesto: el presupuesto de costos ${an}.`, ''],
  ]
  // Paso 2: la Base de cada componente contra su cierre estimado, una línea por componente.
  const ch0 = de === 'base' ? cadenaMeta(d.base, X.est, 0, X.MT.ratio, X.MT.cv) : null
  const lineasBase = ch0 ? componentesCortosDe(CFG).map(([k, n]) => { const v = valorComponente(ch0, k, X.MT.ratio, X.MT.cv), ref = d.referencia[k]; if (v == null) return null; const df = difMon(v, ref.cierre, null, d.refUF[k].cierre); return <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12 }}><span><b style={{ color: C.accent }}>{n}</b> · Base {mm(v)} · Cierre {Y} {mmP(ref.cierre)}</span><span style={{ fontWeight: 700, whiteSpace: 'nowrap', color: C.muted }}>{df.pct != null ? `${df.sg}${pc(Math.abs(df.pct))}` : `${df.sg}${df.abs}`}</span></div> }) : null
  const cuerpo = <div style={{ padding: '10px 16px 12px', display: 'flex', flexDirection: 'column', gap: 7, fontSize: 13 }}>{de === 'metas' && <div style={{ color: C.muted, fontSize: 12 }}>Variación contra el cierre estimado de {Y}: cada meta se compara con su cierre estimado (real a la fecha + resto del año).</div>}{lineasBase && <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 8, borderBottom: `1px solid ${C.border}` }}><b style={{ color: C.accent }}>Base contra cierre {Y}</b>{lineasBase}</div>}{items.map(([t, tx, cf], i) => <div key={i}><b style={{ color: C.accent }}>{t}</b> · {tx}{cf ? <div style={{ fontSize: 12, color: C.muted }}>{cf}</div> : null}</div>)}</div>
  return solo ? cuerpo : <Pliegue t='Cálculo' v='Cierre = real a la fecha + resto del año'>{cuerpo}</Pliegue>
}

/** Candado de la fila: cerrado = cifra fijada; abierto = calculada. */
const Candado = ({ cerrado }) => <svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'><rect x='5' y='11' width='14' height='9' rx='2' />{cerrado ? <path d='M8 11V8a4 4 0 0 1 8 0v3' /> : <path d='M8 11V8a4 4 0 0 1 7.5-2' />}</svg>

export function Metas({ X }) {
  const { est, datos: d, MT, parche, D, ui, setUI } = X, ch = MT.ch, Y = d.anioBase, an = d.anio, rk = escenarioMetas(est, CFG), A = X.arrastre
  const anclas = anclasDe(CFG), nom = (/** @type {string} */ k) => nombreCorto(k, CFG), uf = monedaActual() === 'uf', pct = MT.modo === 'pct'
  // Una sola cifra fijada (por defecto Vendido); las demás se calculan con la cadena vendido → facturado → cobrado → presupuesto → margen → retiros. Cifra, modo ($ | %) y recuperación quedan en st.metas.
  const setMeta = (/** @type {any} */ patch) => parche((c) => { c.metas = { ...(c.metas || {}), ...patch } })
  const redond = (/** @type {number|null} */ x) => (x == null ? null : Math.round(x * 10) / 10)
  const cierreDe = (/** @type {string} */ k) => d.referencia[k].cierre
  const fijar = (/** @type {string} */ k) => (/** @type {number|null} */ x) => {
    const v = x == null ? 0 : x
    if (pct) { const val = Math.round(cierreDe(k) * (1 + v / 100)); setMeta({ ancla: k, modo: 'pct', pct: v, valor: val }) } else setMeta({ ancla: k, modo: 'clp', valor: Math.round(v), pct: redond(pctSobreCierre(v, cierreDe(k))) })
  }
  const cambiarModo = (/** @type {string} */ m) => { if (m === MT.modo) return; setMeta(m === 'pct' ? { modo: 'pct', pct: redond(pctSobreCierre(MT.valorFijada, MT.cierre)) ?? 0, valor: Math.round(MT.valorFijada) } : { modo: 'clp', valor: Math.round(MT.valorFijada) }) }
  const restaurar = () => setMeta({ ancla: 'ventas', valor: null, pct: null, modo: MT.modo })
  const cobro = ch.caja, cob = cobranzaAnio({ cobro, rec: MT.rec, mora: A.moraEstimada, porCobrar: A.porCobrarHoy, cierre: cierreDe('caja') })
  const valorDe = (/** @type {string} */ k) => (k === 'caja' ? cob.total : valorComponente(ch, k, MT.ratio, MT.cv))
  const F = faltaFacturar({ factMeta: ch.fact, arrastre: A.total, ufMed: X.M.ufMed, ratio: MT.ratio, cv: MT.cv, cierreFact: cierreDe('fact') })
  const FM = flujoMensualMeta(ch.fact, A.porMes)
  const hoyC = fmtFechaDMY(d.hoy).slice(0, 5), o = d.oficiales
  const bajo = metaBajoCierre(MT.valorFijada, MT.cierre)
  const irComp = (/** @type {string} */ k) => () => X.ir({ drill: { t: 'comp', de: 'metas', k } })
  const copiar = () => { const t = `Metas ${an} · ${nombreComponente(MT.ancla, CFG)} ${mm(MT.valorFijada)}\n` + componentesDe(CFG).map(([k, n]) => `${n}: ${mm(valorDe(k))} (cierre ${Y} est. ${mx(d.referencia[k].cierre, d.refUF[k].cierre)})`).join('\n'); try { navigator.clipboard?.writeText(t) } catch { /* sin portapapeles */ } }
  const GR = '30px minmax(0,1.1fr) minmax(0,1fr) minmax(0,1.1fr) minmax(0,1.25fr) 112px minmax(0,1.5fr) 18px'
  const chip = (/** @type {boolean} */ fija) => <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 22, padding: '0 9px', borderRadius: 20, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', background: fija ? C.accent : C.card, color: fija ? '#fff' : C.muted, border: `1px solid ${fija ? C.accent : C.border}` }}><Candado cerrado={fija} />{fija ? 'Fijada' : 'Calculada'}</span>
  const aviso = `La meta de ${nom(MT.ancla)} está bajo el cierre estimado de ${Y}`
  const variacion = (/** @type {string} */ k, /** @type {number|null} */ v) => {
    if (v == null) return <span>—</span>
    const df = difMon(v, cierreDe(k), null, d.refUF[k].cierre), bueno = afavor(k, df.sube)
    const txt = pct || !D ? (D || pct ? `${df.sg}${df.abs}` : (df.pct != null ? `${df.sg}${pc(Math.abs(df.pct))}` : `${df.sg}${df.abs}`)) : `${df.sg}${df.pct != null ? pc(Math.abs(df.pct)) + ' · ' + df.sg : ''}${df.abs}`
    if (k === MT.ancla && bajo.bajo) return <span title={aviso} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: C.soonText, fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap' }}>{df.sube ? '↑' : '↓'} {txt}<span role='img' aria-label={aviso} style={{ display: 'inline-grid', placeItems: 'center', width: 14, height: 14, borderRadius: '50%', border: `1px solid ${C.soonText}`, fontSize: 9, fontWeight: 800, opacity: 0.8 }}>i</span></span>
    return <Flecha sube={df.sube} bueno={bueno}>{txt}</Flecha>
  }
  const campo = (/** @type {string} */ k, /** @type {boolean} */ fija, /** @type {number|null} */ v) => {
    const color = fija ? C.accent : C.muted, ed = anclas.includes(k)
    if (v == null) return <span>—</span>
    if (!ed) return <span style={{ color: C.muted }}>{pct ? `${(pctSobreCierre(v, cierreDe(k)) ?? 0) >= 0 ? '+' : '−'}${pc(Math.abs(pctSobreCierre(v, cierreDe(k)) ?? 0))}` : mm(v)}</span>
    return <span style={{ color, fontWeight: 800 }} onClick={(ev) => ev.stopPropagation()}>{pct ? <Fld sobrio grande kind='pct' suf=' %' sel={fija} value={redond(pctSobreCierre(v, cierreDe(k)))} onCommit={fijar(k)} label={`Meta de ${nom(k)} en porcentaje`} /> : <FldDin sobrio grande kind='mill' suf='M' sel={fija} clp={Math.round(v)} tasa={tasa27()} onCommit={fijar(k)} label={`Meta de ${nom(k)}`} />}</span>
  }
  // Cobranza dentro de la fila Cobrado: se despliega en «Cobro del año» (calculado) y «Recuperación de cartera» (editable), con el chequeo y las notas de cartera.
  const abCob = !!ui.cobAb
  const desplegableCob = abCob && <div style={{ background: C.bgSoft, borderTop: `1px solid ${C.border}`, padding: D ? '6px 16px 12px' : '6px 14px 12px', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
    <div style={{ display: 'grid', gridTemplateColumns: D ? 'minmax(0,1fr) 150px minmax(0,1.6fr)' : 'minmax(0,1fr) auto', gap: D ? 12 : '2px 12px', alignItems: 'center', minHeight: 36 }}><span>Cobro del año</span><b style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}><Val v={mm(cob.cobro)} /></b><span style={{ fontSize: 12, color: C.muted, gridColumn: D ? undefined : '1 / -1' }}>de lo facturado en {an}</span></div>
    <div style={{ display: 'grid', gridTemplateColumns: D ? 'minmax(0,1fr) 150px minmax(0,1.6fr)' : 'minmax(0,1fr) auto', gap: D ? 12 : '2px 12px', alignItems: 'center', minHeight: 36 }}><span>+ Recuperación de cartera {Y}</span><span style={{ textAlign: 'right', fontWeight: 800, color: C.accent }}><FldDin sobrio grande chica kind='mill' suf='M' sel clp={Math.round(MT.rec)} tasa={tasa27()} onCommit={(x) => setMeta({ rec: Math.max(0, x == null ? 0 : x) })} label={`Recuperación de cartera ${Y}`} /></span>
      <span style={{ fontSize: 12, color: cob.dentroMora ? C.muted : C.overdueText, gridColumn: D ? undefined : '1 / -1' }}>{cob.dentroMora ? `dentro de la mora estimada de ${mm(cob.mora)}` : <>supera la mora estimada de {mm(cob.mora)} · <span role='button' onClick={() => setMeta({ rec: Math.round(cob.mora) })} style={{ fontWeight: 700, color: C.accent, cursor: 'pointer' }}>Restaurar</span></>}</span></div>
    <div>Para cobrar <b>{mm(cob.total)}</b> necesitas facturar <b>{mm(ch.fact)}</b> y recuperar <b>{mm(cob.rec)}</b></div>
    <div style={{ fontSize: 11, color: C.muted }}>Cartera {Y}: por cobrar {mm(cob.porCobrar)} · mora estimada {mm(cob.mora)}{o.metaCobroCLP > 0 ? ` · ${Y} al ${hoyC}: cobrado ${m26(o.cob.clp)}, ${pc((o.cob.clp / o.metaCobroCLP) * 100, 0)} de su meta de ${m26(o.metaCobroCLP)}` : ''}</div>
    <div><span role='button' onClick={irComp('caja')} style={{ fontSize: 12, fontWeight: 700, color: C.accent, cursor: 'pointer' }}>Ver el detalle de Cobrado ›</span></div>
  </div>
  const filaMeta = ([k]) => {
    const [tono, ic] = TONO_COMP[k], fija = MT.ancla === k, v = valorDe(k), ref = d.referencia[k], t = TONOS_FILA[tono] || TONOS_FILA.w, esCob = k === 'caja'
    const icono = <span style={{ width: 28, height: 28, borderRadius: 8, background: t.bg, color: t.fg, display: 'grid', placeItems: 'center', flexShrink: 0 }}><Ic n={ic} s={15} /></span>
    const rotulo = <span style={{ fontWeight: 700, color: t.fg, fontSize: 13 }}>{nom(k)}</span>
    const restaura = fija && !MT.porDefecto && <span role='button' onClick={(ev) => { ev.stopPropagation(); restaurar() }} style={{ fontSize: 11, fontWeight: 700, color: C.accent, cursor: 'pointer', whiteSpace: 'nowrap', padding: '4px 2px' }}>Restaurar a calculada</span>
    const alturas = { minHeight: 48, boxSizing: 'border-box', borderTop: `1px solid ${C.border}`, cursor: 'pointer' }
    const al = esCob ? () => setUI({ cobAb: !abCob }) : irComp(k)
    const chev = <span aria-hidden='true' style={{ color: C.done, fontSize: 16, display: 'inline-block', transform: esCob && abCob ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>›</span>
    const fila = D ? <div role='button' aria-expanded={esCob ? abCob : undefined} onClick={al} style={{ display: 'grid', gridTemplateColumns: GR, gap: 8, alignItems: 'center', padding: '4px 16px', fontSize: 13, ...alturas }}>
      {icono}{rotulo}
      <span style={{ textAlign: 'right', fontWeight: 700, color: C.text }}><Val v={mx(ref.aFecha, d.refUF[k].aFecha)} /></span>
      <span style={{ textAlign: 'right', fontWeight: 700, color: C.text }}><Val v={mx(ref.cierre, d.refUF[k].cierre)} /></span>
      <span style={{ textAlign: 'right', background: C.bgSoft, alignSelf: 'stretch', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 4px' }}>{campo(k, fija, v)}</span>
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>{chip(fija)}{restaura}</span>
      <span style={{ textAlign: 'right' }}>{variacion(k, v)}</span>
      {chev}
    </div> : <div role='button' aria-expanded={esCob ? abCob : undefined} onClick={al} style={{ padding: '8px 14px', ...alturas }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}><span style={{ ...LBL, color: t.fg, fontSize: 12 }}>{nom(k)}</span>{chip(fija)}{esCob && chev}</span><span style={{ fontSize: 18, flexShrink: 0 }}>{campo(k, fija, v)}</span></div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 2, fontSize: 11, color: C.muted }}><span>al {hoyC} {mmP(ref.aFecha)} · cierre {mmP(ref.cierre)}{restaura ? ' · ' : ''}{restaura}</span><span style={{ flexShrink: 0 }}>{variacion(k, v)}</span></div>
    </div>
    return <div key={k}>{fila}{esCob && desplegableCob}</div>
  }
  const stat = (/** @type {string} */ cap, /** @type {any} */ val, /** @type {string} */ sub) => <div style={{ background: C.bgSoft, borderRadius: 10, padding: D ? '10px 14px' : '8px 10px', minWidth: 0 }}><div style={{ ...LBL, color: C.accent, fontSize: D ? 11 : 10 }}>{cap}</div><div style={{ fontSize: D ? 22 : 17, fontWeight: 800, letterSpacing: -0.6, color: C.accent, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{val}</div><div style={{ fontSize: 11, color: C.muted }}>{sub}</div></div>
  const celda = { textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }
  const colsMes = D ? `110px repeat(12,minmax(0,1fr)) 78px` : 'minmax(0,.6fr) repeat(3,minmax(0,1fr))'
  const lineaMes = (/** @type {string} */ t, /** @type {number[]} */ vs, /** @type {number} */ tot, /** @type {boolean} */ falta, /** @type {any} */ go) => <div role={go ? 'button' : undefined} onClick={go} style={{ display: 'grid', gridTemplateColumns: colsMes, gap: 4, padding: '8px 16px', borderTop: `1px solid ${C.border}`, fontSize: 12, alignItems: 'center', cursor: go ? 'pointer' : 'default', ...(falta ? { borderTop: `2px solid ${C.accent}`, background: C.bgSoft, fontWeight: 700 } : {}) }}><span>{t}</span>{vs.map((v, i) => <span key={i} style={{ ...celda, color: falta && v < 0 ? C.greenText : undefined }}>{mmP(v)}</span>)}<b style={{ ...celda, color: falta ? C.greenText : C.accent }}>{mmP(tot)}</b></div>
  // Tabla «Por mes»: va dentro de «Distribución mensual», encima de los selectores de reparto.
  const tablaMes = <div style={{ borderBottom: `1px solid ${C.border}` }}>
    {D ? <>
      <div style={{ display: 'grid', gridTemplateColumns: colsMes, gap: 4, padding: '9px 16px', ...LBL, color: C.accent, fontSize: 11 }}><span />{MESC.map((m) => <span key={m} style={celda}>{m}</span>)}<span style={celda}>{an}</span></div>
      {lineaMes(`Arrastre ${Y}`, FM.arrastre, FM.totales.arrastre, false, () => X.ir({ drill: { t: 'arr', k: 'todo' } }))}{lineaMes('Meta', FM.meta, FM.totales.meta, false, null)}{lineaMes('Falta facturar', FM.falta, FM.totales.falta, true, null)}
    </> : <>
      <div style={{ display: 'grid', gridTemplateColumns: colsMes, gap: 4, padding: '9px 16px', ...LBL, color: C.accent, fontSize: 10 }}><span>Mes</span><span style={celda}>Arrastre</span><span style={celda}>Meta</span><span style={celda}>Falta</span></div>
      {MESC.map((m, i) => <div key={m} style={{ display: 'grid', gridTemplateColumns: colsMes, gap: 4, padding: '8px 16px', borderTop: `1px solid ${C.border}`, fontSize: 12 }}><span>{m}</span><span style={celda}>{mmP(FM.arrastre[i])}</span><span style={celda}>{mmP(FM.meta[i])}</span><span style={{ ...celda, fontWeight: 700, color: FM.falta[i] < 0 ? C.greenText : C.text }}>{mmP(FM.falta[i])}</span></div>)}
      <div style={{ display: 'grid', gridTemplateColumns: colsMes, gap: 4, padding: '9px 16px', borderTop: `2px solid ${C.accent}`, background: C.bgSoft, fontSize: 12, fontWeight: 700 }}><span>Total</span><span style={celda}>{mmP(FM.totales.arrastre)}</span><span style={celda}>{mmP(FM.totales.meta)}</span><span style={{ ...celda, color: C.greenText }}>{mmP(FM.totales.falta)}</span></div>
    </>}
    <div style={{ padding: '8px 16px 10px', fontSize: 11, color: C.muted }}>Meta en partes iguales; en verde, el mes en que el arrastre {Y} supera la meta.</div>
  </div>
  // Seis accesos en cuadrícula (ícono a la izquierda; nombre y dato clave a la derecha); cada uno abre su contenido debajo, a todo el ancho.
  const abierto = ui.metaAb || null
  const dato = { calc: D ? `Variación contra el cierre ${Y}` : `Contra el cierre ${Y}`, res: `${mm(ch.reservaCierre)} al cierre`, sup: `comisiones ${pc(est.p[rk].terc)} · cobro ${est.p[rk].dias} días`, esc: MT.ok ? `exige ${sgn(ch.g)}${pc(Math.abs(ch.g))}${D ? ' real en UF' : ''}` : '—', dis: D ? `falta ${mmP(F.alMes)} al mes · partes iguales` : `${mmP(F.alMes)} al mes`, ret: `retiros ${mm(ch.retiros)}` }
  const accesos = [['calc', 'doc', 'Cálculo', 'Cálculo'], ['res', 'wal', 'Reserva de caja', 'Reserva'], ['sup', 'tax', 'Supuestos · 7', 'Supuestos'], ['esc', 'chart', 'Escenarios', 'Escenarios'], ['dis', 'cal', 'Distribución mensual', 'Distribución'], ['ret', 'ing', 'Estado de resultados', 'Resultados']]
  const contenidos = { calc: <ComoSeCalcula X={X} de='metas' solo />, res: <ReservaBloque X={X} ch={ch} irBanco={X.onOpenBanco} />, sup: <Supuestos X={X} MT={MT} />, esc: <div style={{ padding: '10px 12px 6px' }}><Grid cols={colsEsc(X.ESC.length)} colsM={1}>{X.ESC.map(([k]) => <CardEsc key={k} X={X} k={k} />)}</Grid></div>, dis: <>{tablaMes}<Distribucion X={X} /></>, ret: <TablaPresupuesto X={X} MT={MT} irPaso={(i) => X.ir({ etapa: i })} /> }
  const acceso = ([k, ic, nombre, corto]) => { const ab = abierto === k; return <div key={k} role='button' aria-expanded={ab} tabIndex={0} onClick={() => setUI({ metaAb: ab ? null : k })} style={{ display: 'flex', alignItems: 'center', gap: D ? 12 : 8, background: C.card, border: `1px solid ${ab ? C.accent : C.border}`, borderRadius: 12, padding: D ? '10px 14px' : '8px 10px', minHeight: D ? 62 : 60, minWidth: 0, cursor: 'pointer', boxSizing: 'border-box' }}>
    <span style={{ width: D ? 36 : 30, height: D ? 36 : 30, borderRadius: 10, background: C.bgSoft, color: C.accent, display: 'grid', placeItems: 'center', flexShrink: 0 }}><Ic n={ic} s={D ? 18 : 15} /></span>
    <span style={{ minWidth: 0, flex: 1 }}><span style={{ display: 'block', fontWeight: 700, fontSize: D ? 15 : 13, color: C.accent }}>{D ? nombre : corto}</span><span style={{ display: 'block', fontSize: D ? 12 : 11, color: C.muted, marginTop: 1 }}>{dato[k]}</span></span></div> }
  return <>
    <Panel hd='Metas' small={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Btn onClick={copiar}>Copiar resumen</Btn><Seg options={[['clp', uf ? 'UF' : '$'], ['pct', '%']]} value={MT.modo} onChange={cambiarModo} /></span>}>
      {D && <div style={{ display: 'grid', gridTemplateColumns: GR, gap: 8, padding: '10px 16px', ...LBL, color: C.accent, fontSize: 11 }}><span /><span /><span style={{ textAlign: 'right' }}>{Y} · al {hoyC}</span><span style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>Cierre est. {Y}</span><span style={{ textAlign: 'right' }}>Meta {an}</span><span /><span style={{ textAlign: 'right' }}>Variación</span><span /></div>}
      {componentesCortosDe(CFG).map(filaMeta)}
    </Panel>
    <Panel pad>
      <div style={{ display: 'grid', gridTemplateColumns: D ? 'minmax(0,1fr) minmax(0,2.4fr)' : '1fr', gap: D ? 20 : 10, alignItems: 'center' }}>
        <div role='button' onClick={() => X.ir({ drill: { t: 'arr', k: 'todo' } })} style={{ cursor: 'pointer' }}><div style={{ ...LBL, color: C.accent }}>Falta facturar en {an}</div><div style={{ fontSize: D ? 40 : 34, fontWeight: 800, letterSpacing: -1.2, color: C.greenText, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}><Val v={mm(F.falta)} /></div>{F.exceso > 0 && <div style={{ fontSize: 11, color: C.muted }}>el arrastre la supera en {mm(F.exceso)}</div>}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: D ? 10 : 6 }}>
          {stat(`Contra el cierre ${Y}`, F.sobreCierre != null ? `+${pc(F.sobreCierre)}` : '—', `de ${mmP(cierreDe('fact'))}`)}{stat('Contra el arrastre', F.sobreArrastre != null ? `+${pc(F.sobreArrastre)}` : '—', `de ${mmP(F.arrastre)}`)}{stat('Por mes', mmP(F.alMes), 'partes iguales')}
        </div>
      </div>
    </Panel>
    {!MT.ok && <div style={{ background: C.avisoBg, border: `1px solid ${C.avisoLine}`, color: C.avisoText, borderRadius: 12, padding: '10px 14px', fontSize: 13 }}>{motivoMeta(MT.motivo)} Mientras tanto se muestra el punto de partida, sin crecimiento.</div>}
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${D ? 3 : 2},minmax(0,1fr))`, gap: D ? 10 : 8 }}>{accesos.map(acceso)}</div>
    {abierto && <Panel hd={accesos.find((x) => x[0] === abierto)[2]}>{contenidos[abierto]}</Panel>}
  </>
}


// Aclaraciones de las tarjetas del paso 4 (antes en el plegable): se muestran en la página del componente.
export function filasMetas(X, k) {
  const { est, datos: d, MT } = X, ch = MT.ch, Y = d.anioBase, rk = escenarioMetas(est, CFG), plano = PLANO[k](MT.ratio, MT.cv), pp = partePorSocio(d.socios, CFG)
  const rows = [['Plano', plano[0]], ['Cálculo', k === 'costos' ? `presupuesto ${Y} + alza ${pc(est.p[rk].alza)}` : plano[1]],
    ...(k === 'ventas' && ch.ventasBruto != null ? [['Bruto', mm(ch.ventasBruto)], [`− Comisiones de venta · ${pc(MT.cv)}`, mm(ch.comisVentas)], ['Facturado / vendido', 'se aplica al vendido bruto']] : []),
    ...(k === 'retiros' ? [['Por socio', `${mm(ch.retiros * pp)} · ${mm(ch.retiros * pp / 12)} al mes`]] : []), ...(k === 'margen' ? [['Comisiones', `${mm(ch.terc)} (${pc(est.p[rk].terc)})`]] : [])]
  const go = k === 'costos' ? ['Presupuesto de costos', () => X.irCostos()] : k === 'retiros' ? ['Sueldos y retiros de los socios', () => X.ir({ drill: { t: 'socios' } })] : k === 'margen' ? ['Impuesto en Escenarios', () => X.irEscTab('imp')] : ['Arrastre del paso 2', () => X.irBase()]
  return { rows, go }
}
