// Presupuesto · paso 5 (Resultado): tres escenarios anclados a las metas del paso 4 (Conservador = repite el cierre estimado de 2026, Ideal = la meta, Optimista = la meta más el sobrecumplimiento de 2026),
// con cuatro tarjetas (los tres escenarios y la mora de cartera) y, al abrir una, la cadena completa de sus cifras hasta los retiros. Todo sale de escenariosMeta (_shared/metaPresupuesto.js); el arrastre abre su página y vuelve aquí.
import { useState } from 'react'
import { C } from '../lib/base.jsx'
import { partePorSocio, escenarioMetas, nombreCorto } from '../../supabase/functions/_shared/presupuesto.js'
import { escenariosMeta, metaBajoCierre, SOBRE_VENTAS, SOBRE_COBRANZA } from '../../supabase/functions/_shared/metaPresupuesto.js'
import { CFG_PRESUPUESTO as CFG } from '../lib/presupuestoCfg.js'
import { mm, mmP, pc, Panel, LBL } from '../lib/presupuestoUI.jsx'

/** Los tres escenarios de meta del estado actual (mismas entradas que el paso 4). */
export function useEscenariosMeta(X) {
  const { est, datos: d, MT, arrastre: A } = X
  return escenariosMeta({ base: d.base, est, cfg: CFG, ancla: MT.ancla, valorCadena: MT.valor, cierre: MT.cierre, rec: MT.rec, mora: A.moraEstimada, porCobrar: A.porCobrarHoy, ratio: MT.ratio, cv: MT.cv, arrastre: A.total, ufMed: X.M.ufMed, cierreFact: d.referencia.fact.cierre, chIdeal: MT.ok ? MT.ch : null })
}

export function EscenariosMeta({ X }) {
  const { est, datos: d, MT, arrastre: A, D } = X, Y = d.anioBase, rk = escenarioMetas(est, CFG)
  const E = useEscenariosMeta(X), nom = (/** @type {string} */ k) => nombreCorto(k, CFG)
  const [abierto, setAbierto] = useState(/** @type {string|null} */ (null))   // un escenario abierto a la vez
  const pp = partePorSocio(d.socios, CFG), refRet = d.referencia.retiros.cierre
  const bajo = metaBajoCierre(MT.valorFijada, MT.cierre), cons = E[0], ideal = E[1], opt = E[2]
  const verArr = (/** @type {string} */ k) => () => X.ir({ drill: { t: 'arr', k } })
  const v = (/** @type {any} */ e, /** @type {(e:any)=>number|null} */ f) => { if (!e.ok) return '—'; const x = f(e); return x == null ? '—' : mm(x) }
  const aviso = (/** @type {any} */ e) => e.ok && !e.cobranza.dentroMora ? `Supera la mora estimada de ${mm(e.cobranza.mora)}` : null
  const porSocio = (/** @type {any} */ e) => (e.ok ? e.ch.retiros * pp / 12 : null)   // mismo divisor de siempre: partePorSocio de los socios del estudio, en doce meses
  // Un tono por escenario (paleta de la app): Conservador gris, Ideal azul, Optimista oscuro; la mora, verde o ámbar según el estado.
  const TONO = /** @type {Record<string,[string,string]>} */ ({ conservador: [C.bgSoft, C.muted], ideal: [C.azulBg, C.azulInfo], optimista: [C.accent, '#fff'] })
  const tono = (/** @type {string} */ k) => TONO[k] || TONO.ideal
  const chip = (/** @type {string} */ t, /** @type {[string,string]} */ [bg, fg]) => <span style={{ display: 'inline-block', alignSelf: 'flex-start', fontSize: 12, fontWeight: 700, padding: '2px 12px', borderRadius: 20, background: bg, color: fg, whiteSpace: 'nowrap' }}>{t}</span>
  // Qué es cada escenario, en una línea (las cifras exactas y la explicación van en el detalle).
  const corta = (/** @type {any} */ e) => (e.k === 'conservador' ? `Repite el cierre de ${Y}` : e.k === 'ideal' ? 'Cumple la meta escrita' : `Meta +${SOBRE_VENTAS} % y cartera +${SOBRE_COBRANZA} %`)
  const sobreIdeal = bajo.bajo && cons.ok && ideal.ok && cons.ch.retiros > ideal.ch.retiros ? cons.ch.retiros - ideal.ch.retiros : null
  const todasDentro = E.every((e) => !e.ok || e.cobranza.dentroMora)
  const cardSty = (/** @type {boolean} */ on) => ({ background: C.card, border: `1px solid ${on ? C.accent : C.border}`, boxShadow: on ? `0 0 0 1px ${C.accent}` : 'none', borderRadius: 12, padding: D ? '12px 14px' : '10px 12px', display: 'flex', flexDirection: /** @type {'column'} */ ('column'), gap: D ? 6 : 5, minWidth: 0, boxSizing: /** @type {'border-box'} */ ('border-box') })
  const cap = { fontSize: 11, fontWeight: 700, letterSpacing: '.4px', textTransform: /** @type {'uppercase'} */ ('uppercase'), color: C.accent }
  const par = (/** @type {string} */ t, /** @type {string} */ val, /** @type {string|undefined} */ col) => <div key={t} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: D ? 13 : 12, color: C.muted, whiteSpace: 'nowrap' }}><span>{t}</span><b style={{ color: col || C.text, fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{val}</b></div>
  const tarjeta = (/** @type {any} */ e) => {
    const on = abierto === e.k
    return <div key={e.k} style={cardSty(on)}>
      {chip(e.nombre, tono(e.k))}
      <div style={{ fontSize: 11, color: C.muted, whiteSpace: 'nowrap' }}>{corta(e)}</div>
      {e.k === 'conservador' && sobreIdeal != null && <span title={`La meta de ${mm(MT.valorFijada)} está ${mm(Math.abs(bajo.dif))} bajo el cierre estimado de ${Y}. Subir la meta es decisión tuya.`} style={{ alignSelf: 'flex-start', fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 20, background: C.ambarBg, color: C.soonText, whiteSpace: 'nowrap' }}>+{mm(sobreIdeal)} sobre el Ideal</span>}
      <div style={cap}>Retiros</div>
      <div style={{ fontSize: D ? 28 : 22, fontWeight: 800, letterSpacing: -0.6, lineHeight: 1.1, color: e.ok && e.ch.retiros > 0 ? C.greenText : C.muted, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{e.ok ? mm(e.ch.retiros) : '—'}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{[par('Vendido', v(e, (x) => x.ventas)), par('Facturado', v(e, (x) => x.ch.fact)), par('Cobranza', v(e, (x) => x.cobranza.total), aviso(e) ? C.soonText : undefined), par('Por socio al mes', v(e, porSocio))]}</div>
      <button onClick={() => setAbierto(on ? null : e.k)} aria-expanded={on} style={{ marginTop: 'auto', alignSelf: 'flex-start', background: 'none', border: 'none', padding: '2px 0', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, color: C.accent }}>{on ? 'Ocultar detalle ▴' : 'Ver detalle ▾'}</button>
    </div>
  }
  const mora = <div key='mora' style={cardSty(false)}>
    {chip(todasDentro ? 'Dentro' : 'Supera', todasDentro ? [C.greenBg, C.greenText] : [C.ambarBg, C.soonText])}
    <div style={cap}>Mora cartera {Y}</div>
    <div style={{ fontSize: D ? 28 : 22, fontWeight: 800, letterSpacing: -0.6, lineHeight: 1.1, color: C.accent, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{mm(A.moraEstimada)}</div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{E.map((e) => par(e.nombre, e.ok ? mm(e.cobranza.rec) : '—', e.ok && !e.cobranza.dentroMora ? C.soonText : undefined))}</div>
    <div style={{ marginTop: 'auto', fontSize: 13, fontWeight: 700, color: C.accent, padding: '2px 0' }}>{D ? 'Recuperación necesaria' : 'Recup. necesaria'}</div>
  </div>

  // Detalle de un escenario: toda la cadena (antes la tabla comparativa, una columna por escenario). Escritorio: dos columnas (hasta el facturado | hasta los retiros); celular: una.
  const fila = (/** @type {any} */ e, /** @type {string} */ t, /** @type {number|null} */ val, /** @type {{ tot?:boolean, go?:any, suave?:boolean, color?:string }} */ o = {}) => <div key={t} role={o.go ? 'button' : undefined} onClick={o.go} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: D ? '9px 16px' : '8px 12px', borderTop: o.tot ? `2px solid ${C.accent}` : `1px solid ${C.border}`, fontSize: D ? 13 : 12, background: o.tot ? C.bgSoft : 'transparent', cursor: o.go ? 'pointer' : 'default', fontWeight: o.tot ? 800 : 500 }}>
    <span style={{ minWidth: 0 }}>{t}{o.go ? <span style={{ color: C.done }}> ›</span> : null}</span><span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: o.color || (o.suave ? C.muted : undefined), whiteSpace: 'nowrap' }}>{val == null || !e.ok ? '—' : mm(val)}</span></div>
  const txt = (/** @type {string} */ t, /** @type {{ t:string, c?:string }} */ x) => <div key={t} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: D ? '9px 16px' : '8px 12px', borderTop: `1px solid ${C.border}`, fontSize: D ? 13 : 12 }}><span>{t}</span><b style={{ color: x.c, whiteSpace: 'nowrap' }}>{x.t}</b></div>
  const sec = (/** @type {string} */ t) => <div style={{ ...LBL, color: C.accent, padding: D ? '12px 16px 4px' : '10px 12px 4px', fontSize: 11 }}>{t}</div>
  const detalle = (/** @type {any} */ e) => {
    const A0 = A, izq = <div key='izq' style={{ minWidth: 0 }}>
      {sec('Hasta el facturado')}
      {fila(e, 'Vendido', e.ventas)}
      {fila(e, `Arrastre ${Y}`, A0.total, { go: verArr('todo') })}
      {fila(e, '  Por facturar que se arrastra', A0.proyectos, { go: verArr('pf'), suave: true })}
      {fila(e, '  Asesorías permanentes', A0.asesorias, { go: verArr('as'), suave: true })}
      {A0.nAgregadas > 0 && fila(e, '  Agregadas a mano', A0.agregadas, { go: verArr('todo'), suave: true })}
      {fila(e, '+ Nuevo por facturar', e.ok ? e.falta.falta : null)}
      {fila(e, '= Facturado', e.ok ? e.ch.fact : null, { tot: true })}
      {fila(e, 'Ventas necesarias', e.ok ? e.falta.vendido : null, { suave: true })}
      {txt(`Arrastre ${Y} sobre el facturado`, { t: e.ok ? pc(e.ch.fact > 0 ? (A0.total / e.ch.fact) * 100 : 0) : '—' })}
    </div>, der = <div key='der' style={{ minWidth: 0, borderLeft: D ? `1px solid ${C.border}` : 'none' }}>
      {sec('Hasta los retiros')}
      {fila(e, 'Cobro del año', e.ok ? e.cobranza.cobro : null)}
      {fila(e, `+ Recuperación de cartera ${Y}`, e.ok ? e.cobranza.rec : null)}
      {fila(e, '= Cobranza', e.ok ? e.cobranza.total : null, { tot: true, color: aviso(e) ? C.soonText : undefined })}
      {txt(`Recuperación contra la mora (${mm(A0.moraEstimada)})`, e.ok ? (e.cobranza.dentroMora ? { t: 'Dentro', c: C.greenText } : { t: 'Supera', c: C.soonText }) : { t: '—' })}
      {fila(e, '− Comisiones', e.ok ? e.ch.terc : null)}
      {fila(e, '− Presupuesto', e.ok ? e.ch.costos : null)}
      {fila(e, '− Impuesto', e.ok ? e.ch.idpc : null)}
      {fila(e, '− Aumento de reserva', e.ok ? e.ch.reserva : null)}
      {fila(e, '= Retiros', e.ok ? e.ch.retiros : null, { tot: true, color: e.ok && e.ch.retiros > 0 ? C.greenText : C.muted })}
      {fila(e, 'Por socio al mes', porSocio(e), { suave: true })}
      {fila(e, `Variación contra el cierre ${Y}`, e.ok ? e.ch.retiros - refRet : null, { suave: true })}
    </div>
    const desc = e.k === 'conservador' ? `Repite el cierre estimado de ${Y} (${mm(e.valorAncla)} de ${nom(MT.ancla).toLowerCase()}, +0 %)` : e.k === 'ideal' ? `Cumple la meta escrita (${mm(e.valorAncla)})` : `Suma ${SOBRE_VENTAS} % a la meta (${mm(e.valorAncla)}) y una recuperación de cartera del ${SOBRE_COBRANZA} % del cobro del año, como el sobrecumplimiento de ${Y}`
    return <Panel key={'det' + e.k}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: D ? '10px 16px' : '9px 12px', flexWrap: 'wrap' }}>{chip(e.nombre, tono(e.k))}<span style={{ fontSize: 12, color: C.muted, minWidth: 0, flex: D ? 1 : '1 1 100%', order: D ? 0 : 3 }}>{desc}</span><button onClick={() => setAbierto(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, color: C.accent, marginLeft: D ? 0 : 'auto' }}>Ocultar detalle ▴</button></div>
      <div style={{ display: 'grid', gridTemplateColumns: D ? 'minmax(0,1fr) minmax(0,1fr)' : 'minmax(0,1fr)', alignItems: 'start', borderTop: `1px solid ${C.border}` }}>{izq}{der}</div>
      <div style={{ padding: '8px 16px 8px', fontSize: 11, color: C.muted, borderTop: `1px solid ${C.border}` }}>Costos +{pc(est.p[rk].alza)} · Cobro a {est.p[rk].dias} días, en los tres escenarios.</div>
      {e.k === 'conservador' && sobreIdeal != null && <div style={{ padding: '8px 16px 10px', fontSize: 12, color: C.soonText, borderTop: `1px solid ${C.border}` }}>El Conservador queda {mm(sobreIdeal)} sobre el Ideal en retiros: la meta de {mm(MT.valorFijada)} está {mm(Math.abs(bajo.dif))} bajo el cierre estimado de {Y}. Subir la meta es decisión tuya.</div>}
      {aviso(e) && <div style={{ padding: '8px 16px 10px', fontSize: 12, color: C.soonText, borderTop: `1px solid ${C.border}` }}>{e.nombre}: la recuperación necesaria ({mm(e.cobranza.rec)}) supera la mora estimada de {mm(e.cobranza.mora)}.</div>}
    </Panel>
  }
  const sel = E.find((e) => e.k === abierto)
  return <>
    <div style={{ display: 'grid', gridTemplateColumns: D ? 'repeat(4,minmax(0,1fr))' : 'repeat(2,minmax(0,1fr))', gridAutoRows: '1fr', gap: D ? 10 : 8 }}>{E.map(tarjeta)}{mora}</div>
    {sel && detalle(sel)}
  </>
}
