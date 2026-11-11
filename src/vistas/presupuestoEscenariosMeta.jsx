// Presupuesto · paso 5 (Resultado): tres escenarios anclados a las metas del paso 4 (Conservador = repite el cierre estimado de 2026, Ideal = la meta, Optimista = la meta más el sobrecumplimiento de 2026),
// con una tabla comparativa de las cifras hasta los retiros. Todo sale de escenariosMeta (_shared/metaPresupuesto.js); el arrastre abre su página y vuelve aquí.
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
  const { est, datos: d, MT, arrastre: A, D } = X, Y = d.anioBase, an = d.anio, rk = escenarioMetas(est, CFG)
  const E = useEscenariosMeta(X), nom = (/** @type {string} */ k) => nombreCorto(k, CFG)
  const pp = partePorSocio(d.socios, CFG), refRet = d.referencia.retiros.cierre
  const bajo = metaBajoCierre(MT.valorFijada, MT.cierre), cons = E[0], ideal = E[1], opt = E[2]
  const verArr = (/** @type {string} */ k) => () => X.ir({ drill: { t: 'arr', k } })
  const v = (/** @type {any} */ e, /** @type {(e:any)=>number|null} */ f) => { if (!e.ok) return '—'; const x = f(e); return x == null ? '—' : mm(x) }
  const aviso = (/** @type {any} */ e) => e.ok && !e.cobranza.dentroMora ? `Supera la mora estimada de ${mm(e.cobranza.mora)}` : null

  // Tabla comparativa: una fila por cifra, una columna por escenario; en el celular las mismas tres columnas con el rótulo ajustado (sin desplazamiento horizontal).
  const cols = D ? 'minmax(0,1.5fr) repeat(3,minmax(0,1fr))' : 'minmax(0,1.25fr) repeat(3,minmax(0,1fr))'
  const fila = (/** @type {string} */ t, /** @type {(e:any)=>number|null} */ f, /** @type {{ tot?:boolean, go?:any, suave?:boolean }} */ o = {}) => <div key={t} role={o.go ? 'button' : undefined} onClick={o.go} style={{ display: 'grid', gridTemplateColumns: cols, gap: D ? 10 : 6, padding: D ? '9px 16px' : '8px 12px', borderTop: o.tot ? `2px solid ${C.accent}` : `1px solid ${C.border}`, fontSize: D ? 13 : 12, alignItems: 'center', background: o.tot ? C.bgSoft : 'transparent', cursor: o.go ? 'pointer' : 'default', fontWeight: o.tot ? 800 : 500 }}>
    <span style={{ minWidth: 0 }}>{t}{o.go ? <span style={{ color: C.done }}> ›</span> : null}</span>{E.map((e) => <span key={e.k} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: o.suave ? C.muted : undefined, whiteSpace: 'nowrap' }}>{v(e, f)}</span>)}</div>
  const txt = (/** @type {string} */ t, /** @type {(e:any)=>{ t:string, c?:string }|null} */ f) => <div key={t} style={{ display: 'grid', gridTemplateColumns: cols, gap: D ? 10 : 6, padding: D ? '9px 16px' : '8px 12px', borderTop: `1px solid ${C.border}`, fontSize: D ? 13 : 12, alignItems: 'center' }}><span>{t}</span>{E.map((e) => { const x = e.ok ? f(e) : null; return <span key={e.k} style={{ textAlign: 'right', fontWeight: 700, color: x && x.c ? x.c : undefined, whiteSpace: 'nowrap' }}>{x ? x.t : '—'}</span> })}</div>
  const sec = (/** @type {string} */ t) => <div style={{ ...LBL, color: C.accent, padding: D ? '12px 16px 4px' : '10px 12px 4px', fontSize: 11 }}>{t}</div>
  const filaCob = <div key='cob' style={{ display: 'grid', gridTemplateColumns: cols, gap: D ? 10 : 6, padding: D ? '9px 16px' : '8px 12px', borderTop: `2px solid ${C.accent}`, background: C.bgSoft, fontSize: D ? 13 : 12, alignItems: 'center', fontWeight: 800 }}><span>= Cobranza</span>{E.map((e) => <span key={e.k} title={aviso(e) || undefined} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: aviso(e) ? C.soonText : undefined, whiteSpace: 'nowrap' }}>{v(e, (x) => x.cobranza.total)}{aviso(e) ? ' !' : ''}</span>)}</div>
  const retiros = <div key='ret' style={{ display: 'grid', gridTemplateColumns: cols, gap: D ? 10 : 6, padding: D ? '12px 16px' : '10px 12px', borderTop: `2px solid ${C.accent}`, background: C.bgSoft, alignItems: 'center', fontWeight: 800 }}><span style={{ fontSize: D ? 15 : 13 }}>= Retiros</span>{E.map((e) => <span key={e.k} style={{ textAlign: 'right', fontSize: D ? 20 : 15, fontVariantNumeric: 'tabular-nums', color: e.ok && e.ch.retiros > 0 ? C.greenText : C.muted, whiteSpace: 'nowrap' }}>{e.ok ? mm(e.ch.retiros) : '—'}</span>)}</div>
  const avisos = E.filter((e) => aviso(e))
  return <>
    <div style={{ fontSize: 12, color: C.muted, margin: '0 4px' }}>Conservador repite el cierre estimado de {Y} ({mm(cons.valorAncla)} de {nom(MT.ancla).toLowerCase()}, +0 %); Ideal cumple la meta escrita ({mm(ideal.valorAncla)}); Optimista suma {SOBRE_VENTAS} % a la meta ({mm(opt.valorAncla)}) y una recuperación de cartera del {SOBRE_COBRANZA} % del cobro del año, como el sobrecumplimiento de {Y}.</div>
    {bajo.bajo && cons.ok && ideal.ok && cons.ch.retiros > ideal.ch.retiros && <div style={{ fontSize: 12, color: C.soonText, margin: '0 4px' }}>El Conservador queda {mm(cons.ch.retiros - ideal.ch.retiros)} sobre el Ideal en retiros: la meta de {mm(MT.valorFijada)} está {mm(Math.abs(bajo.dif))} bajo el cierre estimado de {Y}. Subir la meta es decisión tuya.</div>}
    <Panel>
      <div style={{ display: 'grid', gridTemplateColumns: cols, gap: D ? 10 : 6, padding: D ? '12px 16px 8px' : '10px 12px 6px', ...LBL, color: C.accent, fontSize: D ? 12 : 11 }}><span />{E.map((e) => <span key={e.k} style={{ textAlign: 'right', textDecoration: e.k === 'ideal' ? 'underline' : 'none' }}>{e.nombre}</span>)}</div>
      {sec('Hasta el facturado')}
      {fila('Vendido', (e) => e.ventas)}
      {fila(`Arrastre ${Y}`, () => A.total, { go: verArr('todo') })}
      {fila('  Por facturar que se arrastra', () => A.proyectos, { go: verArr('pf'), suave: true })}
      {fila('  Asesorías permanentes', () => A.asesorias, { go: verArr('as'), suave: true })}
      {A.nAgregadas > 0 && fila('  Agregadas a mano', () => A.agregadas, { go: verArr('todo'), suave: true })}
      {fila('+ Nuevo por facturar', (e) => e.falta.falta)}
      {fila('= Facturado', (e) => e.ch.fact, { tot: true })}
      {fila('Equivale a por vender', (e) => e.falta.vendido, { suave: true })}
      {txt(`Arrastre ${Y} sobre el facturado`, (e) => ({ t: pc(e.ch.fact > 0 ? (A.total / e.ch.fact) * 100 : 0) }))}
      {sec('Hasta los retiros')}
      {fila('Cobro del año', (e) => e.cobranza.cobro)}
      {fila(`+ Recuperación de cartera ${Y}`, (e) => e.cobranza.rec)}
      {filaCob}
      {txt(`Recuperación contra la mora (${mm(A.moraEstimada)})`, (e) => (e.cobranza.dentroMora ? { t: 'Dentro', c: C.greenText } : { t: 'Supera', c: C.soonText }))}
      {fila('− Comisiones', (e) => e.ch.terc)}
      {fila('− Presupuesto', (e) => e.ch.costos)}
      {fila('− Impuesto', (e) => e.ch.idpc)}
      {fila('− Aumento de reserva', (e) => e.ch.reserva)}
      {retiros}
      {fila('Por socio al mes', (e) => e.ch.retiros * pp / 12, { suave: true })}
      {fila(`Sobre cierre ${Y}`, (e) => e.ch.retiros - refRet, { suave: true })}
      <div style={{ padding: '8px 16px 8px', fontSize: 11, color: C.muted, borderTop: `1px solid ${C.border}` }}>Costos +{pc(est.p[rk].alza)} · Cobro a {est.p[rk].dias} días, en los tres escenarios.</div>
      {avisos.length > 0 && <div style={{ padding: '8px 16px 10px', fontSize: 12, color: C.soonText, borderTop: `1px solid ${C.border}` }}>{avisos.map((e) => `${e.nombre}: la recuperación necesaria (${mm(e.cobranza.rec)}) supera la mora estimada de ${mm(e.cobranza.mora)}`).join(' · ')}.</div>}
    </Panel>
  </>
}
