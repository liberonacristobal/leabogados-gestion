// Presupuesto anual · paso 4: Metas 2027. Se escribe la meta de UN componente (retiros al partir) y los demás se proyectan con la misma cascada del modelo, en cualquier dirección
// (metasDesdeComponente en _shared/presupuesto.js). Pasos 1 y 2 muestran los mismos seis componentes de solo lectura; las metas se escriben solo aquí.
import { C, fmtFechaDMY } from '../lib/base.jsx'
import { cadenaMeta, componentesDe, componentesCortosDe, nombreCorto, anclasDe, valorComponente, escenariosContraMeta, nivelDeMeta, nombreComponente, reservaRecomendada, escenarioMetas, resumenDistribucion, partePorSocio } from '../../supabase/functions/_shared/presupuesto.js'
import { mm, mmP, mx, m26, pc, sgn, Tarjeta, FldDin, Titulo, Btn, Grid, tasa27, Pliegue, Panel, Fila, MESC, monedaActual, difMon } from '../lib/presupuestoUI.jsx'
import { repartoCierre } from '../lib/cifras.js'
import { Cmp, Supuestos, ReservaBloque, TablaPresupuesto, motivoMeta, nivelTxt } from '../lib/presupuestoBloques.jsx'
import { CFG_PRESUPUESTO as CFG } from '../lib/presupuestoCfg.js'
import { CardEsc, colsEsc } from './presupuestoEtapas2.jsx'
import { Distribucion } from './presupuestoDistribucion.jsx'

/** Tono e ícono de cada componente: los mismos de la app en los pasos 1, 2 y 4 (de la configuración del estudio). */
export const TONO_COMP = Object.fromEntries(CFG.componentes.map((c) => [c.k, [c.tono, c.ic]]))
const PLANO = {
  ventas: (r, cv) => ['Neto de comisiones · estimación propia', r != null ? `facturado ÷ ${pc(r, 0)} = bruto; bruto − ${pc(cv ?? 0)} de comisiones` : 'falta la relación facturado/vendido'], fact: () => ['Facturado', 'cobrado + aumento de lo por cobrar'], caja: () => ['Caja', 'facturado − aumento de lo por cobrar'],
  costos: () => ['Presupuesto', 'presupuesto vigente + aumento'], margen: () => ['Antes de impuesto', 'cobrado − comisiones − costos'], retiros: () => ['Después de impuesto y reserva', 'margen − impuesto − reserva'],
}

/**
 * Cifras de «Cómo se arma el cierre» de un componente: real a la fecha, resto y cierre repartidos con repartoCierre (real + resto = cierre en $M de 1 decimal; en UF, a 1 UF).
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

/** Tabla «Cómo se arma el cierre» de la página de un componente: real a la fecha, promedio mensual de 3 meses (con sus cifras), meses que faltan, resto y cierre. */
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
  return <Panel hd='Cómo se arma el cierre'>{filas.map(([t, s, v], i) => <Fila key={i} sin tot={i === filas.length - 1} nombre={t} peq={s || undefined} valor={v} />)}</Panel>
}

/** Plegable de una línea bajo las tarjetas de los pasos 2 y 4: «Cierre = real a la fecha + resto del año»; abierto, una línea por cierre con sus cifras. */
export function ComoSeCalcula({ X, de }) {
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
  return <Pliegue t='Cómo se calcula' v='Cierre = real a la fecha + resto del año'><div style={{ padding: '10px 16px 12px', display: 'flex', flexDirection: 'column', gap: 7, fontSize: 13 }}>{lineasBase && <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 8, borderBottom: `1px solid ${C.border}` }}><b style={{ color: C.accent }}>Base contra cierre {Y}</b>{lineasBase}</div>}{items.map(([t, tx, cf], i) => <div key={i}><b style={{ color: C.accent }}>{t}</b> · {tx}{cf ? <div style={{ fontSize: 12, color: C.muted }}>{cf}</div> : null}</div>)}</div></Pliegue>
}

export function Metas({ X }) {
  const { est, datos: d, MT, parche, D } = X, ch = MT.ch, Y = d.anioBase, an = d.anio, rk = escenarioMetas(est, CFG)
  const fijar = (k) => (x) => parche((c) => { c.metas = { ...(c.metas || {}), ancla: k, valor: x } })
  const tarjeta = ([k, nombre]) => {
    const [tono, ic] = TONO_COMP[k], anc = MT.ancla === k, ref = d.referencia[k], v = valorComponente(ch, k, MT.ratio, MT.cv)
    const editable = anclasDe(CFG).includes(k) && v != null
    const der = k === 'costos' ? { cap: 'Presupuesto', val: mm(v) }
      : { cap: anc ? 'Meta' : 'Proyectado', val: editable ? <FldDin sobrio grande kind='mill' suf='M' sel={anc} clp={anc ? MT.valor : v} tasa={tasa27()} onCommit={fijar(k)} label={`Meta de ${nombre}`} /> : (v != null ? mm(v) : '—') }
    return <Tarjeta key={k} tono={tono} ic={ic} label={nombre} izq={{ cap: 'Cierre', val: mx(ref.cierre, d.refUF[k].cierre) }} der={der} cmp={<Cmp comp={k} v={v} refv={ref.cierre} refU={d.refUF[k].cierre} />} onClick={() => X.ir({ drill: { t: 'comp', de: 'metas', k } })} aria={nombre} />
  }
  const rr = reservaRecomendada({ costosAnio: ch.costos, reservaIni: est.reservaIni, reservaAnio: ch.reserva, post: Math.max(0, ch.post), cfg: CFG })
  const lista = escenariosContraMeta(X.M, MT.ancla, MT.valor, MT.ratio, MT.cv), nivel = nivelDeMeta(lista)
  const copiar = () => { const t = `Metas ${an} · ${nombreComponente(MT.ancla, CFG)} ${mm(MT.valor)}\n` + componentesDe(CFG).map(([k, n]) => `${n}: ${mm(valorComponente(ch, k, MT.ratio, MT.cv))} (cierre ${Y} est. ${mx(d.referencia[k].cierre, d.refUF[k].cierre)})`).join('\n'); try { navigator.clipboard?.writeText(t) } catch { /* sin portapapeles */ } }
  return <>
    <Titulo right={<Btn onClick={copiar}>Copiar resumen</Btn>}>Metas {an}</Titulo>
    <Grid cols={3} colsM={2} gap={D ? 10 : 8}>{componentesCortosDe(CFG).map(tarjeta)}</Grid>
    <ComoSeCalcula X={X} de='metas' />
    {!MT.ok && <div style={{ background: C.avisoBg, border: `1px solid ${C.avisoLine}`, color: C.avisoText, borderRadius: 12, padding: '10px 14px', fontSize: 13 }}>{motivoMeta(MT.motivo)} Mientras tanto se muestra el punto de partida, sin crecimiento.</div>}
    <div style={{ display: 'grid', gridTemplateColumns: D ? 'repeat(2,minmax(0,1fr))' : '1fr', gap: 10, alignItems: 'start' }}>
    <Pliegue t='Reserva de caja' v={`${mm(ch.reservaCierre)} al cierre${rr.mesesCierre != null ? ` · ${rr.mesesCierre.toLocaleString('es-CL', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} meses` : ''}`}><ReservaBloque X={X} ch={ch} irBanco={X.onOpenBanco} /></Pliegue>
    <Pliegue t='Supuestos · 7' v={`comisiones ${pc(est.p[rk].terc)} · cobro ${est.p[rk].dias} días`}><Supuestos X={X} MT={MT} /></Pliegue>
    </div>
    <Pliegue t='Escenarios contra la meta' v={MT.ok ? <span>exige <b style={{ color: C.accent }}>{sgn(ch.g)}{pc(Math.abs(ch.g))}</b> {D && ' real en UF'}{D && <> · <b style={{ color: nivel ? C.greenText : C.overdueText }}>{nivelTxt(nivel, X.ESC)}</b></>}</span> : null}><div style={{ padding: '10px 12px 6px' }}><Grid cols={colsEsc(X.ESC.length)} colsM={1}>{X.ESC.map(([k]) => <CardEsc key={k} X={X} k={k} />)}</Grid></div></Pliegue>
    <div style={{ display: 'grid', gridTemplateColumns: D ? 'repeat(2,minmax(0,1fr))' : '1fr', gap: 10, alignItems: 'start' }}>
    <Pliegue t='Distribución mensual' v={resumenDistribucion(est.dist, (c) => nombreCorto(c, CFG))}><Distribucion X={X} /></Pliegue>
    <Pliegue t='Estado de resultados' v={`retiros ${mm(ch.retiros)}`}><TablaPresupuesto X={X} MT={MT} irPaso={(i) => X.ir({ etapa: i })} /></Pliegue>
    </div>
  </>
}


// Aclaraciones de las tarjetas del paso 4 (antes en el plegable): se muestran en la página del componente.
export function filasMetas(X, k) {
  const { est, datos: d, MT } = X, ch = MT.ch, Y = d.anioBase, rk = escenarioMetas(est, CFG), plano = PLANO[k](MT.ratio, MT.cv), pp = partePorSocio(d.socios, CFG)
  const rows = [['Plano', plano[0]], ['Cálculo', k === 'costos' ? `presupuesto ${Y} + alza ${pc(est.p[rk].alza)}` : plano[1]],
    ...(k === 'ventas' && ch.ventasBruto != null ? [['Bruto', mm(ch.ventasBruto)], [`− Comisiones de venta · ${pc(MT.cv)}`, mm(ch.comisVentas)], ['Facturado / vendido', 'se aplica al vendido bruto']] : []),
    ...(k === 'retiros' ? [['Por socio', `${mm(ch.retiros * pp)} · ${mm(ch.retiros * pp / 12)} al mes`]] : []), ...(k === 'margen' ? [['Comisiones', `${mm(ch.terc)} (${pc(est.p[rk].terc)})`]] : [])]
  const go = k === 'costos' ? ['Presupuesto de costos', () => X.irCostos()] : k === 'retiros' ? ['Sueldos y retiros de los socios', () => X.ir({ drill: { t: 'socios' } })] : k === 'margen' ? ['Impuesto en Escenarios', () => X.irEscTab('imp')] : ['Base del paso 2', () => X.irBase()]
  return { rows, go }
}
