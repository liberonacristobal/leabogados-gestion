// Presupuesto anual · paso 4: Metas 2027. Se escribe la meta de UN componente (retiros al partir) y los demás se proyectan con la misma cascada del modelo, en cualquier dirección
// (metasDesdeComponente en _shared/presupuesto.js). Pasos 1 y 2 muestran los mismos seis componentes de solo lectura; las metas se escriben solo aquí.
import { C } from '../lib/base.jsx'
import { COMPONENTES, ANCLAS, valorComponente, escenariosContraMeta, nivelDeMeta, nombreComponente } from '../../supabase/functions/_shared/presupuesto.js'
import { mm, pc, sgn, Tarjeta, Fld, Titulo, Btn, Grid } from '../lib/presupuestoUI.jsx'
import { Cmp, Supuestos, ReservaBloque, SociosBloque, TablaPresupuesto, motivoMeta, nivelTxt } from '../lib/presupuestoBloques.jsx'
import { CardEsc } from './presupuestoEtapas2.jsx'

/** Tono e ícono de cada componente: los mismos de la app en los pasos 1, 2 y 4. */
export const TONO_COMP = { ventas: ['a', 'ventas'], fact: ['y', 'fact'], caja: ['g', 'wal'], costos: ['t', 'egr'], margen: ['w', 'tax'], retiros: ['r', 'ing'] }
const PLANO = {
  ventas: (r) => ['Estimación propia', r != null ? `facturado ÷ ${pc(r, 0)}` : 'falta la relación facturado/vendido'], fact: () => ['Facturado', 'cobrado + aumento de lo por cobrar'], caja: () => ['Caja', 'facturado − aumento de lo por cobrar'],
  costos: () => ['Presupuesto', 'presupuesto vigente + aumento'], margen: () => ['Antes de impuesto', 'cobrado − comisiones − costos'], retiros: () => ['Después de impuesto y reserva', 'margen − impuesto − reserva'],
}

/** Filas de detalle de la referencia 2026 de un componente (cierre estimado = real a la fecha + resto del año, estimación propia). */
export function detalleReferencia(X, k) {
  const r = X.datos.referencia[k], Y = X.datos.anioBase
  const rows = [[k === 'costos' ? 'Real de los meses cerrados' : 'Real a la fecha', mm(r.aFecha)]]
  if (r.resto) rows.push([k === 'costos' ? 'Presupuesto de los meses que faltan' : `Resto de ${Y} · promedio de los últimos 3 meses cerrados × ${r.faltan.toLocaleString('es-CL', { maximumFractionDigits: 1 })} meses`, mm(r.resto)])
  rows.push([`Cierre ${Y} estimado`, mm(r.cierre)])
  return rows
}

export function Metas({ X }) {
  const { est, datos: d, MT, parche, D } = X, ch = MT.ch, Y = d.anioBase, an = d.anio
  const fijar = (k) => (x) => parche((c) => { c.metas = { ...(c.metas || {}), ancla: k, valor: x } })
  const tarjeta = ([k, nombre]) => {
    const [tono, ic] = TONO_COMP[k], anc = MT.ancla === k, ref = d.referencia[k], v = valorComponente(ch, k, MT.ratio)
    const editable = ANCLAS.includes(k) && v != null
    const der = k === 'costos' ? { cap: `Presupuesto ${an}`, val: mm(v) }
      : { cap: anc ? `Meta ${an}` : `Proyectado ${an}`, val: editable ? <Fld sobrio grande kind='mill' pre='$' suf='M' sel={anc} value={anc ? MT.valor : v} onCommit={fijar(k)} label={`Meta de ${nombre}`} /> : (v != null ? mm(v) : '—') }
    const plano = PLANO[k](MT.ratio)
    const det = [...detalleReferencia(X, k), ['Plano', plano[0]], ['Cálculo', k === 'costos' ? `presupuesto ${Y} + alza ${pc(est.p.base.alza)}` : plano[1]],
      ...(k === 'retiros' ? [['Por socio', `${mm(ch.retiros / 2)} · ${mm(ch.retiros / 24)} al mes`]] : []), ...(k === 'margen' ? [['Comisiones', `${mm(ch.terc)} (${pc(est.p.base.terc)})`]] : [])]
    const ir = k === 'costos' ? () => X.irCostos() : k === 'margen' || k === 'retiros' ? () => X.irEscTab('imp') : () => X.irBase()
    return <Tarjeta key={k} tono={tono} ic={ic} label={nombre} izq={{ cap: k === 'retiros' ? `${Y} real` : `Cierre ${Y} est.`, val: mm(ref.cierre) }} der={der} cmp={<Cmp comp={k} v={v} refv={ref.cierre} />} det={det} onClick={ir} aria={nombre} />
  }
  const lista = escenariosContraMeta(X.M, MT.ancla, MT.valor, MT.ratio), nivel = nivelDeMeta(lista)
  const copiar = () => { const t = `Metas ${an} · ${nombreComponente(MT.ancla)} ${mm(MT.valor)}\n` + COMPONENTES.map(([k, n]) => `${n}: ${mm(valorComponente(ch, k, MT.ratio))} (cierre ${Y} est. ${mm(d.referencia[k].cierre)})`).join('\n'); try { navigator.clipboard?.writeText(t) } catch { /* sin portapapeles */ } }
  return <>
    <Titulo right={<Btn onClick={copiar}>Copiar resumen</Btn>}>Metas {an} · escribe la meta de un componente; los demás se proyectan</Titulo>
    <Grid cols={3} colsM={1}>{COMPONENTES.map(tarjeta)}</Grid>
    {!MT.ok && <div style={{ background: C.avisoBg, border: `1px solid ${C.avisoLine}`, color: C.avisoText, borderRadius: 12, padding: '10px 14px', fontSize: 13 }}>{motivoMeta(MT.motivo)} Mientras tanto se muestra el punto de partida, sin crecimiento.</div>}
    <ReservaBloque X={X} ch={ch} irBanco={X.onOpenBanco} />
    <Titulo>Supuestos</Titulo>
    <Supuestos X={X} MT={MT} />
    <Titulo right={MT.ok ? <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 600, color: C.muted }}>exige <b style={{ color: C.accent }}>{sgn(ch.g)}{pc(Math.abs(ch.g))}</b> real en UF · <b style={{ color: nivel ? C.greenText : C.overdueText }}>{nivelTxt(nivel)}</b></span> : null}>Escenarios contra la meta</Titulo>
    <Grid cols={3} colsM={1}>{X.ESC.map(([k]) => <CardEsc key={k} X={X} k={k} />)}</Grid>
    <SociosBloque X={X} alza={est.p.base.alza} retiros={ch.retiros} ir={X.onOpenSocios} />
    <TablaPresupuesto X={X} MT={MT} irPaso={(i) => X.ir({ etapa: i })} />
  </>
}

