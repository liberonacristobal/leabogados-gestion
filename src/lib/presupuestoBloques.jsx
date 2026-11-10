// Bloques del Presupuesto que comparten varios pasos: cálculo de las metas, comparación con flechas, Supuestos con su efecto, Reserva de caja y Sueldos y retiros de los socios.
// Cada cifra sale de un helper de _shared/presupuesto.js (metasDesdeComponente, reservaRecomendada, sueldosYRetiros); aquí solo se dibujan.
import { C, useIsDesktop, fmtFechaDMY } from './base.jsx'
import {
  anclasDe, cadenaMeta, metasDesdeComponente, valorComponente, afavor, reservaRecomendada, sueldosYRetiros, mesesTranscurridos, escenarioMetas,
} from '../../supabase/functions/_shared/presupuesto.js'
import { CFG_PRESUPUESTO as CFG } from './presupuestoCfg.js'
import { mm, mx, pc, Flecha, Fld, Btn, Panel, Seg, Titulo, LBL, Val, difMon, Det, Lista, Grid } from './presupuestoUI.jsx'

/**
 * Las metas 2027 con lo que haya escrito el usuario: el componente fijado (ancla) y su valor; sin nada escrito parte con los retiros reales de 2026.
 * Si la meta no tiene solución (≤ 0, base vacía…), muestra el punto de partida (crecimiento 0) y el motivo.
 * @param {any} d datos del Presupuesto @param {any} est estado
 */
export function calcMetas(d, est) {
  // facturado/vendido se aplica al vendido BRUTO; la comisión sobre ventas (% del bruto, la observada en el año en curso salvo que se edite) lleva el bruto al NETO de la meta de ventas.
  const ratio = est.metas?.ratio ?? d.ratioFactVend ?? null
  const cv = est.metas?.cv ?? d.comisVentaPct ?? 0
  const ancla = anclasDe(CFG).includes(est.metas?.ancla) ? est.metas.ancla : CFG.anclaInicial
  // Sin nada escrito parte con lo real de 2026; si no hay (p. ej. sin retiros registrados), con lo que da el escenario de referencia (Base).
  const refAncla = d.referencia[ancla].cierre
  const valor = est.metas?.valor != null ? est.metas.valor : refAncla > 0 ? refAncla : valorComponente(cadenaMeta(d.base, est, est.p[escenarioMetas(est, CFG)].g, ratio, cv), ancla, ratio, cv) ?? 0
  const r = metasDesdeComponente(d.base, est, { componente: ancla, valor, ratio, cv }, CFG)
  return { ancla, valor, ratio, cv, ok: !!r.ok, motivo: r.ok ? null : r.motivo, ch: r.ok ? r : cadenaMeta(d.base, est, 0, ratio, cv), ref: d.referencia }
}

/** Motivo en texto de una meta sin solución. */
export const motivoMeta = (/** @type {string|null|undefined} */ m) => (m === 'valor' ? 'Escribe una meta mayor que cero.' : m === 'ratio' ? 'Falta la relación facturado/vendido para llevar la meta de ventas a facturado.' : m === 'base' ? 'No hay facturas en los últimos 12 meses cerrados: la base está en cero.' : m === 'supuestos' ? 'Con estos supuestos la meta no tiene solución: revisa comisiones, días de cobro, impuesto y reserva.' : 'La meta pide un facturado negativo: sube el valor.')

/** Comparación con flecha contra la referencia: variación % y diferencia (el Presupuesto de costos, una sola flecha). `vU`/`refU` = las mismas cifras en UF si la fuente las trae; en UF se compara UF contra UF. */
export function Cmp({ comp, v, refv, vU = null, refU = null }) {
  const D = useIsDesktop()
  if (v == null || refv == null) return <span>—</span>
  const d = difMon(v, refv, vU, refU), bueno = afavor(comp, d.sube)
  if (comp === 'costos' && !D && d.pct != null) return <Flecha sube={d.sube} bueno={bueno}>{d.sg}{pc(Math.abs(d.pct))}</Flecha>
  if (comp === 'costos') return <Flecha sube={d.sube} bueno={bueno}>{d.sg}{d.abs}{d.pct != null ? ` · ${d.sg}${pc(Math.abs(d.pct))}` : ''}</Flecha>
  // En la tarjeta compacta del celular (dos por fila) cabe una sola flecha: el % (o la diferencia si no hay %); la otra queda en la página del componente.
  if (!D && d.pct != null) return <Flecha sube={d.sube} bueno={bueno}>{d.sg}{pc(Math.abs(d.pct))}</Flecha>
  return <span style={{ display: 'inline-flex', gap: 12, flexWrap: 'wrap', justifyContent: 'inherit' }}>{d.pct != null && <Flecha sube={d.sube} bueno={bueno}>{d.sg}{pc(Math.abs(d.pct))}</Flecha>}<Flecha sube={d.sube} bueno={bueno}>{d.sg}{d.abs}</Flecha></span>
}

/** Frase de qué escenario cubre la meta: el primero de la lista que la cubre («desde» si hay más ambiciosos, «solo» si es el último) o, si ninguno, «Sobre» el último. @param {string|null} k @param {[string,string][]} lista [clave, nombre] en el orden de la lista */
export function nivelTxt(k, lista) {
  const i = lista.findIndex((x) => x[0] === k), ult = lista[lista.length - 1]
  if (i < 0) return `Sobre el escenario ${ult ? ult[1] : ''}`.trim()
  return i === 0 || lista.length === 1 ? `La cubre el escenario ${lista[i][1]}` : i === lista.length - 1 ? `La cubre solo el escenario ${lista[i][1]}` : `La cubre desde el escenario ${lista[i][1]}`
}

// ── Supuestos con su efecto ──
/** Siete supuestos de las metas (los del escenario de referencia y los generales), cada uno con su efecto en pesos; filas con líneas de corte dentro de una tarjeta: 3 por fila en escritorio y 2 en el celular. */
export function Supuestos({ X, MT }) {
  const D = useIsDesktop(), { est, setPal, setGen, parche } = X, ch = MT.ch, rk = escenarioMetas(est, CFG), p = est.p[rk]
  const cols = D ? 3 : 2
  const campos = [
    ['Comisiones', 'terc', 'pct', '%', p.terc, (v) => setPal(rk, 'terc', Math.max(0, v)), mm(ch.terc), 'de comisiones'],
    ['Días de cobro', 'dias', 'int', 'días', p.dias, (v) => setPal(rk, 'dias', Math.max(0, Math.round(v))), mm(ch.dCob), 'por cobrar al cierre'],
    ['Alza de costos', 'alza', 'pct', '%', p.alza, (v) => setPal(rk, 'alza', v), mm(ch.costos), 'de costos ' + X.datos.anio],
    ['Impuesto', 'tasa', 'pct', '%', est.tasaIDPC, (v) => setGen('tasaIDPC', Math.max(0, v)), mm(ch.idpc), 'de impuesto'],
    ['Reserva de caja', 'res', 'pct', '%', est.reserva, (v) => setGen('reserva', Math.min(100, Math.max(0, v))), mm(ch.reserva), 'de aumento'],
    ['Facturado / vendido bruto', 'ratio', 'pct', '%', MT.ratio, (v) => parche((c) => { c.metas = { ...(c.metas || {}), ratio: v == null ? null : Math.min(100, Math.max(1, v)) } }), MT.ratio != null ? mm(ch.fact) : '—', 'facturables'],
    ['Comisión sobre ventas', 'cv', 'pct', '%', MT.cv, (v) => parche((c) => { c.metas = { ...(c.metas || {}), cv: v == null ? null : Math.min(99, Math.max(0, v)) } }), ch.comisVentas != null ? mm(ch.comisVentas) : '—', 'de comisiones de venta'],
  ]
  return <Panel>
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols},minmax(0,1fr))` }}>
      {campos.map(([t, k, kind, suf, val, set, ef, txt], i) => <div key={k} style={{ padding: D ? '14px 20px 16px' : '12px 14px 14px', borderTop: i >= cols ? `1px solid ${C.border}` : 'none', borderLeft: i % cols ? `1px solid ${C.border}` : 'none', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, lineHeight: 1.2 }}>{t}</div>
        <div style={{ fontSize: D ? 21 : 19, fontWeight: 800, letterSpacing: -0.4, color: C.accent, lineHeight: 1.2 }}><Fld sobrio kind={kind} suf={suf} value={val} ph={k === 'ratio' ? '—' : undefined} onCommit={set} label={t} /></div>
        <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.3 }}><b style={{ color: C.accent, fontSize: 14 }}>{ef}</b> {txt}</div>
      </div>)}
    </div>
  </Panel>
}

// ── Reserva de caja ──
/** Reserva mínima + reserva del año = reserva al cierre, en meses de costos, y la recomendación (regla simple de criterio). Por confirmar contra el saldo del Banco. */
export function ReservaBloque({ X, ch, irBanco }) {
  const D = useIsDesktop(), { est } = X
  const r = reservaRecomendada({ costosAnio: ch.costos, reservaIni: est.reservaIni, reservaAnio: ch.reserva, post: Math.max(0, ch.post), cfg: CFG })
  const fila = (t, v, o = {}) => <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: D ? '10px 20px' : '10px 14px', borderTop: `1px solid ${C.border}`, fontSize: 13, alignItems: 'baseline', background: o.tot ? C.bgSoft : 'transparent', fontWeight: o.tot ? 800 : 400 }}><span style={{ minWidth: 0 }}>{t}</span><span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: o.tot ? C.accent : C.text }}>{v}</span></div>
  return <>
    {fila(<>Reserva en cuenta corriente <span style={{ color: C.muted, fontSize: 12 }}>· no se toca</span></>, mm(est.reservaIni))}
    {fila(`+ Aumento del año (${pc(est.reserva, 1)} de ${mm(Math.max(0, ch.post))} después de impuesto)`, mm(ch.reserva))}
    {fila('= Reserva al cierre', mm(ch.reservaCierre), { tot: true })}
    {fila('Meses de costos que cubre', <span><b style={{ color: C.accent }}>{r.mesesCierre != null ? r.mesesCierre.toLocaleString('es-CL', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) : '—'}</b> de {mm(r.costosMes)} al mes</span>)}
    <div style={{ padding: D ? '10px 20px 12px' : '10px 14px 12px', borderTop: `1px solid ${C.border}`, fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div><b style={{ color: C.accent }}>Recomendación</b> · llegar a {r.meses} meses de costos ({mm(r.objetivo)}){r.brecha > 0 ? `, con ${mm(r.porTrimestre)} más por trimestre` : ''}. <Flecha sube={r.cubre} bueno={r.cubre}>{r.cubre ? 'la cubre' : `déficit ${mm(r.falta)}`}</Flecha></div>
      {r.pctNecesario != null && !r.cubre && <div><Btn onClick={() => X.setGen('reserva', Math.min(99, Math.ceil(r.pctNecesario * 10) / 10))}>Usar la recomendada · {pc(Math.min(99, Math.ceil(r.pctNecesario * 10) / 10), 1)}</Btn></div>}
      {irBanco && <div onClick={irBanco} role='button' style={{ cursor: 'pointer', fontWeight: 700, color: C.accent }}>Por confirmar en Banco ›</div>}
    </div>
  </>
}

// ── Sueldos y retiros de los socios ──
/** Filas por socio para un año: 2026 real (sueldos pagados + retiros) y 2027 (sueldo del presupuesto + retiros en partes iguales). @param {any} X @param {number} alza @param {number} retiros */
export function repartoSocios(X, alza, retiros) {
  const d = X.datos
  return sueldosYRetiros({ socios: d.retiros26.socios, costos: X.est.costos, alza, retiros, real: { sueldos: d.retiros26.sueldos, retiros: d.retiros26.porSocio }, cfg: CFG })
}
/** Lo real de 2026 de cada socio en UF (cada sueldo y retiro con la UF de su día). @param {any} X */
export function repartoSocios26UF(X) {
  const d = X.datos
  return sueldosYRetiros({ socios: d.retiros26.socios, costos: [], alza: 0, retiros: 0, real: { sueldos: d.retiros26.sueldosUF, retiros: d.retiros26.porSocioUF }, cfg: CFG })
}

/**
 * Sueldos y retiros de los socios (página): una tarjeta por socio y la de la oficina, 2026 real contra 2027 meta, anual o mensual. Es el mismo dinero del presupuesto visto por socio
 * (no se suma a los costos; Margen y Retiros no cambian). `ir` = enlace a la página Socios; `irRetiros` = lista de los retiros del año.
 */
export function DSocios({ X, alza, retiros, ir, irRetiros }) {
  const D = useIsDesktop(), { ui, setUI, datos: d } = X, mensual = ui.sm === 'm'
  const R = repartoSocios(X, alza, retiros ?? 0), U = repartoSocios26UF(X)
  const f26 = mensual ? 1 / Math.max(1, mesesTranscurridos(d.hoy)) : 1, f27 = mensual ? 1 / 12 : 1
  const v26 = (/** @type {number} */ clp, /** @type {number} */ u) => mx(clp * f26, u * f26), v27 = (/** @type {number} */ clp) => mm(clp * f27)
  const cel = { textAlign: 'right', fontVariantNumeric: 'tabular-nums', minWidth: 0 }
  const fila = (/** @type {string} */ t, /** @type {string} */ a, /** @type {string} */ b, /** @type {boolean} */ tot = false) => <div key={t} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,.8fr) minmax(0,1fr) minmax(0,1fr)', gap: 10, padding: '9px 0', borderTop: tot ? `2px solid ${C.accent}` : `1px solid ${C.border}`, fontSize: 13, fontWeight: tot ? 800 : 400, color: tot ? C.accent : C.text, alignItems: 'baseline' }}><span>{t}</span><span style={cel}><Val v={a} /></span><span style={cel}><Val v={b} /></span></div>
  const tarjeta = (/** @type {string} */ nombre, /** @type {any} */ f, /** @type {any} */ u, /** @type {boolean} */ of = false) => <div key={nombre} onClick={ir} style={{ background: of ? C.bgSoft : C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: D ? '14px 18px 12px' : '11px 14px 10px', cursor: ir ? 'pointer' : 'default', minWidth: 0 }}>
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,.8fr) minmax(0,1fr) minmax(0,1fr)', gap: 10, alignItems: 'baseline', paddingBottom: 8 }}><b style={{ color: C.accent, fontSize: 14 }}>{nombre}</b><span style={{ ...cel, ...LBL, color: C.muted, fontWeight: 600 }}>{d.anioBase} real</span><span style={{ ...cel, ...LBL, color: C.muted, fontWeight: 600 }}>{d.anio} meta</span></div>
    {fila('Sueldos', v26(f.sueldo26, u.sueldo26), v27(f.sueldo27))}
    {fila('Retiros', v26(f.ret26, u.ret26), v27(f.ret27))}
    {fila('Total', v26(f.tot26, u.tot26), v27(f.tot27), true)}
    <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 6, minHeight: 20 }}><Cmp comp='retiros' v={f.tot27 * f27} refv={f.tot26 * f26} refU={u.tot26 * f26} /></div>
  </div>
  return <>
    <Titulo right={<Seg options={[['a', 'Anual'], ['m', 'Mensual']]} value={mensual ? 'm' : 'a'} onChange={(v) => setUI({ sm: v })} />}>{d.anioBase} real contra {d.anio} meta</Titulo>
    <Grid cols={3} colsM={1}>{R.filas.map((f, i) => tarjeta(f.nombre, f, U.filas[i]))}{tarjeta('Oficina', R.total, U.total, true)}</Grid>
    <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 12, fontWeight: 700, color: C.accent }}>
      {d.retiros26.desde && irRetiros && <span onClick={irRetiros} role='button' style={{ cursor: 'pointer' }}>Ver los {d.retiros26.n} retiros ›</span>}
      {ir && <span onClick={ir} role='button' style={{ cursor: 'pointer' }}>Panel de socios ›</span>}
    </div>
    <Det t='Cómo se calcula'><Lista items={[`Sueldo ${d.anio}: Remuneraciones de cada socio con su aumento; sus leyes sociales son costo de la oficina. No se suman a los costos: Margen y Retiros no cambian.`, 'Retiros: en partes iguales. El impuesto personal de cada socio no se proyecta.', `${d.anioBase} real: sueldos pagados y retiros de la página Socios${d.retiros26.desde ? `, ${d.retiros26.n} retiros entre ${fmtFechaDMY(d.retiros26.desde)} y ${fmtFechaDMY(d.retiros26.hasta)}` : ''}, por confirmar.`, ...(mensual ? [`Por mes: ${d.anioBase} ÷ ${mesesTranscurridos(d.hoy).toLocaleString('es-CL', { maximumFractionDigits: 1 })} meses; ${d.anio} ÷ 12.`] : [])]} /></Det>
  </>
}

/** Estado de resultados de la meta, con el cierre 2026 estimado al lado y la variación. */
export function TablaPresupuesto({ X, MT, irPaso }) {
  const D = useIsDesktop(), ch = MT.ch, ref = MT.ref, an = X.datos.anio
  const L = [
    ['', 'Vendido', ch.ventas, ref.ventas.cierre, 'ventas', 0], ['', 'Facturado', ch.fact, ref.fact.cierre, 'fact', 0], ['−', 'Aumento de lo por cobrar', ch.dCob, null, null, 0], ['=', 'Cobrado', ch.caja, ref.caja.cierre, 'caja', 1],
    ['−', 'Comisiones', ch.terc, null, null, 0], ['−', 'Presupuesto de costos', ch.costos, ref.costos.cierre, 'costos', 0, () => irPaso(2)], ['=', 'Margen', ch.margen, ref.margen.cierre, 'margen', 1],
    ['−', 'Impuesto de primera categoría', ch.idpc, null, null, 0], ['=', 'Después de impuesto', ch.post, null, null, 1], ['−', 'Aumento de reserva', ch.reserva, null, null, 0], ['=', 'Retiros', ch.retiros, ref.retiros.cierre, 'retiros', 1],
  ]
  const g = D ? 'minmax(0,1fr) 110px 110px 150px' : 'minmax(0,1fr) 88px 88px'
  return <Panel hd={`Presupuesto ${an}`} small='estado de resultados'>
    <div style={{ display: 'grid', gridTemplateColumns: g, gap: 10, padding: '10px 16px', ...LBL, color: C.accent }}><span /><span style={{ textAlign: 'right' }}>{an}</span><span style={{ textAlign: 'right' }}>Cierre {X.datos.anioBase}</span>{D && <span style={{ textAlign: 'right' }}>Variación</span>}</div>
    {L.map(([op, t, v, r, comp, tot, go], i) => <div key={i} onClick={go} style={{ display: 'grid', gridTemplateColumns: g, gap: 10, padding: '9px 16px', borderTop: tot ? `2px solid ${C.accent}` : `1px solid ${C.border}`, background: tot ? C.bgSoft : 'transparent', fontWeight: tot ? 800 : 400, fontSize: 13, cursor: go ? 'pointer' : 'default', alignItems: 'center' }}>
      <span><span style={{ display: 'inline-block', width: 16, color: C.textSoft, fontWeight: 700 }}>{op}</span>{t}{go ? <span style={{ color: C.done }}> ›</span> : null}</span>
      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}><Val v={v != null ? mm(v) : '—'} /></span><span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: C.muted }}><Val v={r != null ? mx(r, comp ? X.datos.refUF[comp].cierre : null) : '—'} /></span>
      {D && <span style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>{comp && v != null && r != null ? <Cmp comp={comp} v={v} refv={r} refU={X.datos.refUF[comp].cierre} /> : ''}</span>}</div>)}
  </Panel>
}

