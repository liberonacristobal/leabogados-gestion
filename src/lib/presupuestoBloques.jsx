// Bloques del Presupuesto que comparten varios pasos: cálculo de las metas, comparación con flechas, Supuestos con su efecto, Reserva de caja y Sueldos y retiros de los socios.
// Cada cifra sale de un helper de _shared/presupuesto.js (metasDesdeComponente, reservaRecomendada, sueldosYRetiros); aquí solo se dibujan.
import { C, useIsDesktop, fmtFechaDMY } from './base.jsx'
import {
  ANCLAS, cadenaMeta, metasDesdeComponente, valorComponente, afavor, reservaRecomendada, sueldosYRetiros, mesesTranscurridos,
} from '../../supabase/functions/_shared/presupuesto.js'
import { mm, pc, Flecha, Fld, Panel, Seg, Titulo, LBL } from './presupuestoUI.jsx'

/**
 * Las metas 2027 con lo que haya escrito el usuario: el componente fijado (ancla) y su valor; sin nada escrito parte con los retiros reales de 2026.
 * Si la meta no tiene solución (≤ 0, base vacía…), muestra el punto de partida (crecimiento 0) y el motivo.
 * @param {any} d datos del Presupuesto @param {any} est estado
 */
export function calcMetas(d, est) {
  const ratio = est.metas?.ratio ?? d.ratioFactVend ?? null
  const ancla = ANCLAS.includes(est.metas?.ancla) ? est.metas.ancla : 'retiros'
  // Sin nada escrito parte con lo real de 2026; si no hay (p. ej. sin retiros registrados), con lo que da el escenario Base.
  const refAncla = d.referencia[ancla].cierre
  const valor = est.metas?.valor != null ? est.metas.valor : refAncla > 0 ? refAncla : valorComponente(cadenaMeta(d.base, est, est.p.base.g, ratio), ancla, ratio) ?? 0
  const r = metasDesdeComponente(d.base, est, { componente: ancla, valor, ratio })
  return { ancla, valor, ratio, ok: !!r.ok, motivo: r.ok ? null : r.motivo, ch: r.ok ? r : cadenaMeta(d.base, est, 0, ratio), ref: d.referencia }
}

/** Motivo en texto de una meta sin solución. */
export const motivoMeta = (/** @type {string|null|undefined} */ m) => (m === 'valor' ? 'Escribe una meta mayor que cero.' : m === 'ratio' ? 'Falta la relación facturado/vendido para llevar la meta de ventas a facturado.' : m === 'base' ? 'No hay facturas en los últimos 12 meses cerrados: la base está en cero.' : m === 'supuestos' ? 'Con estos supuestos la meta no tiene solución: revisa comisiones, días de cobro, impuesto y reserva.' : 'La meta pide un facturado negativo: sube el valor.')

const sg = (/** @type {number} */ x) => (x >= 0 ? '+' : '−')

/** Comparación con flecha contra la referencia: variación % y diferencia en pesos (el Presupuesto de costos, una sola flecha). */
export function Cmp({ comp, v, refv }) {
  if (v == null || refv == null) return <span>—</span>
  const sube = v >= refv, bueno = afavor(comp, sube), dif = v - refv, p = refv ? (v / refv - 1) * 100 : null
  if (comp === 'costos') return <Flecha sube={sube} bueno={bueno}>{sg(dif)}{mm(Math.abs(dif))}{p != null ? ` · ${sg(p)}${pc(Math.abs(p))}` : ''}</Flecha>
  return <>{p != null && <Flecha sube={sube} bueno={bueno}>{sg(p)}{pc(Math.abs(p))}</Flecha>}<Flecha sube={sube} bueno={bueno}>{sg(dif)}{mm(Math.abs(dif))}</Flecha></>
}

/** Frase de qué escenario cubre la meta. */
export const nivelTxt = (/** @type {string|null} */ k) => (k === 'prudente' ? 'La cubre el escenario Prudente' : k === 'base' ? 'La cubre desde el escenario Base' : k === 'meta' ? 'La cubre solo el escenario Optimista' : 'Sobre el escenario Optimista')

// ── Supuestos con su efecto ──
/** Seis supuestos de las metas (los del escenario Base y los generales), cada uno con su efecto en pesos; filas con líneas de corte dentro de una tarjeta: 3 por fila en escritorio y 2 en el celular. */
export function Supuestos({ X, MT }) {
  const D = useIsDesktop(), { est, setPal, setGen, parche } = X, ch = MT.ch, p = est.p.base
  const cols = D ? 3 : 2
  const campos = [
    ['Comisiones', 'terc', 'pct', '%', p.terc, (v) => setPal('base', 'terc', Math.max(0, v)), mm(ch.terc), 'de comisiones'],
    ['Días de cobro', 'dias', 'int', 'días', p.dias, (v) => setPal('base', 'dias', Math.max(0, Math.round(v))), mm(ch.dCob), 'por cobrar al cierre'],
    ['Alza de costos', 'alza', 'pct', '%', p.alza, (v) => setPal('base', 'alza', v), mm(ch.costos), 'de costos ' + X.datos.anio],
    ['Impuesto', 'tasa', 'pct', '%', est.tasaIDPC, (v) => setGen('tasaIDPC', Math.max(0, v)), mm(ch.idpc), 'de impuesto'],
    ['Reserva de caja', 'res', 'pct', '%', est.reserva, (v) => setGen('reserva', Math.min(100, Math.max(0, v))), mm(ch.reserva), 'a la reserva'],
    ['Facturado / vendido', 'ratio', 'pct', '%', MT.ratio, (v) => parche((c) => { c.metas = { ...(c.metas || {}), ratio: v == null ? null : Math.min(100, Math.max(1, v)) } }), MT.ratio != null ? mm(ch.fact) : '—', 'facturables'],
  ]
  return <Panel>
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols},minmax(0,1fr))` }}>
      {campos.map(([t, k, kind, suf, val, set, ef, txt], i) => <div key={k} style={{ padding: D ? '14px 20px 16px' : '12px 14px 14px', borderTop: i >= cols ? `1px solid ${C.border}` : 'none', borderLeft: i % cols ? `1px solid ${C.border}` : 'none', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, lineHeight: 1.2 }}>{t}</div>
        <div style={{ fontSize: D ? 20 : 18, fontWeight: 800, letterSpacing: -0.4, color: C.accent, lineHeight: 1.2 }}><Fld sobrio kind={kind} suf={suf} value={val} ph={k === 'ratio' ? '—' : undefined} onCommit={set} label={t} /></div>
        <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.3 }}><b style={{ color: C.accent, fontSize: 14 }}>{ef}</b> {txt}</div>
      </div>)}
    </div>
  </Panel>
}

// ── Reserva de caja ──
/** Reserva mínima + reserva del año = reserva al cierre, en meses de costos, y la recomendación (regla simple de criterio). Por confirmar contra el saldo del Banco. */
export function ReservaBloque({ X, ch, irBanco }) {
  const D = useIsDesktop(), { est } = X
  const r = reservaRecomendada({ costosAnio: ch.costos, reservaIni: est.reservaIni, reservaAnio: ch.reserva, post: Math.max(0, ch.post) })
  const fila = (t, v, o = {}) => <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: D ? '10px 20px' : '10px 14px', borderTop: `1px solid ${C.border}`, fontSize: 13, alignItems: 'baseline', background: o.tot ? C.bgSoft : 'transparent', fontWeight: o.tot ? 800 : 400 }}><span style={{ minWidth: 0 }}>{t}</span><span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: o.tot ? C.accent : C.text }}>{v}</span></div>
  return <Panel hd='Reserva de caja' small={irBanco ? <span onClick={irBanco} style={{ cursor: 'pointer', fontWeight: 700, color: C.accent }}>por confirmar contra el saldo del Banco ›</span> : 'por confirmar contra el saldo del Banco'}>
    {fila(<>Reserva mínima <span style={{ color: C.muted, fontSize: 12 }}>· base que no se toca</span></>, mm(est.reservaIni))}
    {fila(`+ Reserva del año (${pc(est.reserva, 0)} de ${mm(Math.max(0, ch.post))} después de impuesto)`, mm(ch.reserva))}
    {fila('= Reserva al cierre', mm(ch.reservaCierre), { tot: true })}
    {fila('Meses de costos de oficina que cubre', <span><b style={{ color: C.accent }}>{r.mesesCierre != null ? r.mesesCierre.toLocaleString('es-CL', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) : '—'}</b> de {mm(r.costosMes)} al mes</span>)}
    <div style={{ padding: D ? '12px 20px 14px' : '12px 14px 14px', borderTop: `1px solid ${C.border}`, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div><b style={{ color: C.accent }}>Recomendación</b> · llegar a {r.meses} meses de costos ({mm(r.objetivo)}) con un aumento gradual{r.brecha > 0 ? ` de ${mm(r.porTrimestre)} por trimestre` : ''}.</div>
      {r.brecha > 0 && <div style={{ color: C.muted, fontSize: 12 }}>{r.niveles.map((n, i) => `T${i + 1} ${mm(n)}`).join(' · ')}</div>}
      <div><Flecha sube={r.cubre} bueno={r.cubre}>{r.cubre ? `la reserva del año la cubre` : `faltan ${mm(r.falta)}`}</Flecha>{!r.cubre && r.pctNecesario != null && <span style={{ color: C.muted, fontSize: 12 }}> · equivale a reservar {pc(r.pctNecesario, 0)} del resultado después de impuesto</span>}</div>
      <div style={{ color: C.muted, fontSize: 11.5 }}>Recomendación de criterio, no un cálculo oficial · sin tope sobre los retiros.</div>
    </div>
  </Panel>
}

// ── Sueldos y retiros de los socios ──
/** Filas por socio para un año: 2026 real (sueldos pagados + retiros) y 2027 (sueldo del presupuesto + retiros en partes iguales). @param {any} X @param {number} alza @param {number} retiros */
export function repartoSocios(X, alza, retiros) {
  const d = X.datos
  return sueldosYRetiros({ socios: d.retiros26.socios, costos: X.est.costos, alza, retiros, real: { sueldos: d.retiros26.sueldos, retiros: d.retiros26.porSocio } })
}

/**
 * Sueldos y retiros de los socios: el mismo dinero del presupuesto visto por socio (no se suma a los costos; Margen y Retiros no cambian).
 * `solo26`: solo el real de 2026 (paso 1). Anual o mensual (`ui.sm`).
 */
export function SociosBloque({ X, alza, retiros, solo26, ir }) {
  const D = useIsDesktop(), { ui, setUI, datos: d } = X, mensual = ui.sm === 'm'
  const R = repartoSocios(X, alza, retiros ?? 0)
  const f26 = mensual ? 1 / Math.max(1, mesesTranscurridos(d.hoy)) : 1, f27 = mensual ? 1 / 12 : 1
  const fila = (key, nombre, sueldo, ret, tot, cmp, o = {}) => D
    ? <div key={key} onClick={ir} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) repeat(3,minmax(0,1fr)) minmax(0,1.1fr)', gap: 8, padding: '9px 20px', borderTop: `1px solid ${C.border}`, fontSize: 13, alignItems: 'center', cursor: ir ? 'pointer' : 'default', background: o.tt ? C.bgSoft : 'transparent' }}>
      <span style={{ fontWeight: o.tt ? 800 : 600, color: o.tt ? C.accent : C.text }}>{nombre}</span><span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{mm(sueldo)}</span><span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{mm(ret)}</span><b style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: C.accent }}>{mm(tot)}</b><span style={{ textAlign: 'right' }}>{cmp}</span></div>
    : <div key={key} onClick={ir} style={{ padding: '10px 14px', borderTop: `1px solid ${C.border}`, fontSize: 12.5, cursor: ir ? 'pointer' : 'default', background: o.tt ? C.bgSoft : 'transparent', display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: '4px 8px' }}>
      <span style={{ gridColumn: '1 / -1', fontWeight: o.tt ? 800 : 600, color: o.tt ? C.accent : C.text }}>{nombre}</span>
      {[['Sueldos', mm(sueldo)], ['Retiros', mm(ret)], ['Total', mm(tot)]].map(([c, v]) => <span key={c} style={{ fontVariantNumeric: 'tabular-nums' }}><span style={{ display: 'block', fontSize: 10.5, color: C.muted }}>{c}</span>{c === 'Total' ? <b style={{ color: C.accent }}>{v}</b> : v}</span>)}
      {cmp && <span style={{ gridColumn: '1 / -1' }}>{cmp}</span>}</div>
  const cabeza = D && <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) repeat(3,minmax(0,1fr)) minmax(0,1.1fr)', gap: 8, padding: '10px 20px', ...LBL, color: C.accent }}><span>Socio</span><span style={{ textAlign: 'right' }}>Sueldos</span><span style={{ textAlign: 'right' }}>Retiros</span><span style={{ textAlign: 'right' }}>Total</span><span style={{ textAlign: 'right' }}>{solo26 ? '' : 'Variación'}</span></div>
  return <>
    <Titulo right={<Seg options={[['a', 'Anual'], ['m', 'Mensual']]} value={mensual ? 'm' : 'a'} onChange={(v) => setUI({ sm: v })} />}>Sueldos y retiros de los socios · {solo26 ? d.anioBase : d.anio}</Titulo>
    <Panel>
      {cabeza}
      {R.filas.flatMap((f) => solo26
        ? [fila(f.nombre, f.nombre, f.sueldo26 * f26, f.ret26 * f26, f.tot26 * f26, null)]
        : [fila(f.nombre + '26', `${f.nombre} · ${d.anioBase} real`, f.sueldo26 * f26, f.ret26 * f26, f.tot26 * f26, null),
          fila(f.nombre + '27', `${f.nombre} · ${d.anio} meta`, f.sueldo27 * f27, f.ret27 * f27, f.tot27 * f27, <Cmp comp='retiros' v={f.tot27 * f27} refv={f.tot26 * f26} />)])}
      {solo26
        ? fila('t', 'Oficina', R.total.sueldo26 * f26, R.total.ret26 * f26, R.total.tot26 * f26, null, { tt: true })
        : <>{fila('t26', `Oficina · ${d.anioBase} real`, R.total.sueldo26 * f26, R.total.ret26 * f26, R.total.tot26 * f26, null, { tt: true })}{fila('t27', `Oficina · ${d.anio} meta`, R.total.sueldo27 * f27, R.total.ret27 * f27, R.total.tot27 * f27, <Cmp comp='retiros' v={R.total.tot27 * f27} refv={R.total.tot26 * f26} />, { tt: true })}</>}
    </Panel>
    <div style={{ fontSize: 12, color: C.muted, margin: '-6px 4px 0' }}>
      {solo26 ? 'Los sueldos ya están en el presupuesto de costos (Remuneraciones): es el mismo dinero visto por socio. El impuesto personal de cada socio no se proyecta.'
        : `Sueldo ${d.anio} = Remuneraciones de cada socio con su aumento; sus leyes sociales son costo de la oficina. No se suman a los costos: Margen y Retiros no cambian. Retiros en partes iguales.`}{mensual ? ` Por mes: ${d.anioBase} ÷ ${mesesTranscurridos(d.hoy).toLocaleString('es-CL', { maximumFractionDigits: 1 })} meses transcurridos.` : ''}
      {!solo26 && d.retiros26.desde ? ` Retiros ${d.anioBase}: ${d.retiros26.n} entre ${fmtFechaDMY(d.retiros26.desde)} y ${fmtFechaDMY(d.retiros26.hasta)}, por confirmar contra la página Socios.` : ''}
    </div>
  </>
}

/** Estado de resultados de la meta, con el cierre 2026 estimado al lado y la variación. */
export function TablaPresupuesto({ X, MT, irPaso }) {
  const D = useIsDesktop(), ch = MT.ch, ref = MT.ref, an = X.datos.anio
  const L = [
    ['', 'Vendido', ch.ventas, ref.ventas.cierre, 'ventas', 0], ['', 'Facturado', ch.fact, ref.fact.cierre, 'fact', 0], ['−', 'Aumento de lo por cobrar', ch.dCob, null, null, 0], ['=', 'Cobrado', ch.caja, ref.caja.cierre, 'caja', 1],
    ['−', 'Comisiones', ch.terc, null, null, 0], ['−', 'Presupuesto de costos', ch.costos, ref.costos.cierre, 'costos', 0, () => irPaso(2)], ['=', 'Margen', ch.margen, ref.margen.cierre, 'margen', 1],
    ['−', 'Impuesto de primera categoría', ch.idpc, null, null, 0], ['=', 'Después de impuesto', ch.post, null, null, 1], ['−', 'Reserva de caja', ch.reserva, null, null, 0], ['=', 'Retiros', ch.retiros, ref.retiros.cierre, 'retiros', 1],
  ]
  const g = D ? 'minmax(0,1fr) 110px 110px 150px' : 'minmax(0,1fr) 88px 88px'
  return <Panel hd={`Presupuesto ${an}`} small='la meta escrita, como estado de resultados'>
    <div style={{ display: 'grid', gridTemplateColumns: g, gap: 10, padding: '10px 16px', ...LBL, color: C.accent }}><span /><span style={{ textAlign: 'right' }}>{an}</span><span style={{ textAlign: 'right' }}>Cierre {X.datos.anioBase}</span>{D && <span style={{ textAlign: 'right' }}>Variación</span>}</div>
    {L.map(([op, t, v, r, comp, tot, go], i) => <div key={i} onClick={go} style={{ display: 'grid', gridTemplateColumns: g, gap: 10, padding: '9px 16px', borderTop: tot ? `2px solid ${C.accent}` : `1px solid ${C.border}`, background: tot ? C.bgSoft : 'transparent', fontWeight: tot ? 800 : 400, fontSize: 13, cursor: go ? 'pointer' : 'default', alignItems: 'center' }}>
      <span><span style={{ display: 'inline-block', width: 16, color: C.textSoft, fontWeight: 700 }}>{op}</span>{t}{go ? <span style={{ color: C.done }}> ›</span> : null}</span>
      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{v != null ? mm(v) : '—'}</span><span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: C.muted }}>{r != null ? mm(r) : '—'}</span>
      {D && <span style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>{comp && v != null && r != null ? <Cmp comp={comp} v={v} refv={r} /> : ''}</span>}</div>)}
  </Panel>
}

