// Bloque «Costo empresa» de un aumento de sueldo: del líquido a lo que cuesta la persona. Una sola fuente para el Presupuesto 2027 y Costos de Oficina; el cálculo es
// remuneracionPersona.js (con liquidoABruto.js). Sirve para cualquier persona: con liquidación (contrato), con boleta de honorarios, o quien pasa de boleta a contrato.
import { useMemo, useState } from 'react'
import { C, fmt } from './base.jsx'
import { remuneracionDeLiquido, remuneracionBoleta, tasaEmpleadorDe, parametrosDeLiquidacion, ultimaLiquidacionDe } from '../../supabase/functions/_shared/remuneracionPersona.js'
import { desglosarImponible } from '../../supabase/functions/_shared/liquidoABruto.js'

/** Tasa de AFP más frecuente entre las últimas liquidaciones del equipo: valor inicial para quien pasa de boleta a contrato (se puede cambiar). */
export function afpFrecuente(liq, ufDeLiquidacion, ym) {
  const personas = [...new Set((liq || []).map(l => String(l.persona)))], n = {}
  for (const p of personas) { const l = ultimaLiquidacionDe(p.split(' ').slice(-1)[0], (liq || []).filter(x => String(x.persona) === p), ym); if (!l) continue; const prm = parametrosDeLiquidacion(l, ufDeLiquidacion(String(l.periodo))); if (prm) n[prm.afpPct] = (n[prm.afpPct] || 0) + 1 }
  const best = Object.entries(n).sort((a, b) => b[1] - a[1])[0]
  return best ? Number(best[0]) : 0.1058
}

/**
 * Remuneración de hoy y con el aumento. `modo`: 'liquidacion' (contrato, parámetros de su última liquidación), 'boleta' (honorarios) o 'contrato' (hoy boleta, con el aumento contrato; pide AFP y plan).
 * null si falta de qué calcular (persona sin liquidación, sin tabla del SII).
 * @param {{persona:string, liquido:number, liquidoNuevo:number, liq:any[], tramosIU:any[], plan:any[], uf:number, ufDeLiquidacion:(ym:string)=>number, ym:string, ymNuevo?:string, modo?:'liquidacion'|'boleta'|'contrato', afpPct?:number, planUF?:number}} p
 */
export function calcularAumento(p) {
  const modo = p.modo || 'liquidacion', emp = tasaEmpleadorDe({ plan: p.plan, liquidaciones: p.liq }), tasaEmpleador = emp ? emp.tasa : 0
  const ymN = p.ymNuevo || p.ym
  const base = { persona: p.persona, liquidaciones: p.liq, ym: p.ym, uf: p.uf, ufDeLiquidacion: p.ufDeLiquidacion, tramosFilas: p.tramosIU, tasaEmpleador }
  let hoy, nuevo
  if (modo === 'boleta') { hoy = remuneracionBoleta({ liquido: p.liquido, fecha: p.ym + '-01' }); nuevo = remuneracionBoleta({ liquido: p.liquidoNuevo, fecha: ymN + '-01' }) }
  else if (modo === 'contrato') { hoy = remuneracionBoleta({ liquido: p.liquido, fecha: p.ym + '-01' }); nuevo = remuneracionDeLiquido({ ...base, ym: ymN, liquido: p.liquidoNuevo, parametros: { afpPct: Number(p.afpPct) || 0, planUF: Number(p.planUF) || 0 } }) }
  else { hoy = remuneracionDeLiquido({ ...base, liquido: p.liquido }); nuevo = remuneracionDeLiquido({ ...base, liquido: p.liquidoNuevo }) }
  if (!hoy || !nuevo) return null
  return { modo, hoy, nuevo, tasaEmpleador, sinTasa: !emp && modo !== 'boleta', base: { hoy: desglosarImponible(hoy.imponible), nuevo: desglosarImponible(nuevo.imponible) } }
}

const sg = n => (n >= 0 ? '+' : '−') + fmt(Math.abs(n))

/**
 * @param {{entrada:Omit<Parameters<typeof calcularAumento>[0],'modo'|'afpPct'|'planUF'>, esBoleta?:boolean, D:boolean, meses?:number, anio?:string|number}} p
 * `esBoleta`: la persona emite boleta de honorarios; el bloque ofrece verla como boleta o como contrato de trabajo.
 */
export function CostoEmpresaBloque({ entrada, esBoleta, D, meses = 12, anio }) {
  const [modoB, setModoB] = useState('boleta')
  const afp0 = useMemo(() => afpFrecuente(entrada.liq, entrada.ufDeLiquidacion, entrada.ym), [entrada.liq, entrada.ym]) // eslint-disable-line react-hooks/exhaustive-deps
  const [afp, setAfp] = useState(String(Math.round(afp0 * 10000) / 100).replace('.', ',')), [plan, setPlan] = useState('')
  const modo = esBoleta ? modoB : 'liquidacion'
  const num = x => Number(String(x).replace(',', '.')) || 0
  const calc = useMemo(() => calcularAumento({ ...entrada, modo, afpPct: num(afp) / 100, planUF: num(plan) }), [entrada, modo, afp, plan]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!esBoleta && !calc) return null
  const { hoy, nuevo } = calc || { hoy: {}, nuevo: {} }
  const dif = calc ? nuevo.costoEmpresa - hoy.costoEmpresa : 0
  const celda = { padding: '8px 0', borderTop: `1px solid ${C.bgSoft}`, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }
  const tope = !!(calc && nuevo.afp && nuevo.afp === hoy.afp)
  const etqIU = modo === 'boleta' ? 'Retención de honorarios' : modo === 'contrato' ? 'Impuesto único o retención' : 'Impuesto único'
  const filas = [['', 'Líquido', 'liquido'], ['+', etqIU, 'iu'], ['+', 'Cotizaciones del trabajador', 'cotTrab'], ['=', modo === 'boleta' ? 'Boleta de honorarios' : 'Haberes brutos', 'haberes', 'tot'], ['+', 'Cotizaciones del empleador', 'empleador'], ['=', 'Costo empresa', 'costoEmpresa', 'res']]
    .filter(([, , k]) => modo !== 'boleta' || (k !== 'cotTrab' && k !== 'empleador'))
  const inp = { border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 9px', fontSize: 13, width: 92, color: C.accent, fontWeight: 600, background: C.card, textAlign: 'right' }
  const chip = (v, t) => <span key={v} onClick={() => setModoB(v)} style={{ fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 20, cursor: 'pointer', border: `1px solid ${modoB === v ? C.accent : C.border}`, background: modoB === v ? C.accent : C.card, color: modoB === v ? '#fff' : C.muted, whiteSpace: 'nowrap' }}>{t}</span>
  return <div style={{ gridColumn: '1 / -1', border: `2px solid ${C.accent}`, borderRadius: 12, overflow: 'hidden', background: C.card }}>
    <div style={{ padding: '7px 14px', background: C.accent, color: '#fff', fontSize: 11, fontWeight: 700, letterSpacing: .5, textTransform: 'uppercase' }}>Costo empresa con el aumento</div>
    {esBoleta && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '10px 14px 4px' }}>{chip('boleta', 'Boleta de honorarios')}{chip('contrato', 'Contrato de trabajo')}</div>}
    {esBoleta && modoB === 'contrato' && <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end', padding: '6px 14px 8px' }}>
      <div><div style={{ fontSize: 10, fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: .5, marginBottom: 3 }}>AFP, tasa</div><input value={afp} onChange={e => setAfp(e.target.value)} style={inp} /></div>
      <div><div style={{ fontSize: 10, fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: .5, marginBottom: 3 }}>Plan de salud, UF</div><input value={plan} onChange={e => setPlan(e.target.value)} placeholder='7 % legal' style={inp} /></div></div>}
    {!calc ? <div style={{ padding: '10px 14px', fontSize: 12, color: C.muted }}>Falta la tabla del impuesto único del SII o la AFP para calcular el contrato</div> : <>
    {D
      ? <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 120px 130px 110px', padding: '0 14px' }}>
        {['Por mes', modo === 'contrato' ? 'Hoy, boleta' : 'Hoy', modo === 'contrato' ? 'Con contrato' : 'Con el aumento', 'Diferencia'].map((h, i) => <span key={h} style={{ ...celda, borderTop: 'none', fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: .4, textAlign: i ? 'right' : 'left' }}>{h}</span>)}
        {filas.flatMap(([s, l, k, c]) => {
          const tot = c === 'tot' || c === 'res', bg = c === 'res' ? C.grisBg : undefined, bt = c === 'tot' ? `1px solid ${C.accent}` : celda.borderTop
          return [
            <span key={k + 'l'} style={{ ...celda, borderTop: bt, background: bg, color: tot ? C.accent : C.muted, fontWeight: tot ? 700 : 400 }}>{s ? s + ' ' : ''}{l}</span>,
            <span key={k + 'h'} style={{ ...celda, borderTop: bt, background: bg, textAlign: 'right', paddingRight: 12, fontWeight: tot ? 700 : 400 }}>{fmt(hoy[k])}</span>,
            <span key={k + 'n'} style={{ ...celda, borderTop: bt, background: bg, textAlign: 'right', paddingRight: 12, fontWeight: 700, color: C.accent }}>{fmt(nuevo[k])}</span>,
            <span key={k + 'd'} style={{ ...celda, borderTop: bt, background: bg, textAlign: 'right', color: C.muted, fontWeight: tot ? 700 : 400 }}>{sg(nuevo[k] - hoy[k])}</span>]
        })}
      </div>
      : <div>{filas.map(([s, l, k, c]) => <div key={k} style={{ padding: '8px 12px', borderTop: c === 'tot' ? `1px solid ${C.accent}` : `1px solid ${C.bgSoft}`, background: c === 'res' ? C.grisBg : undefined }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, color: C.muted }}><span>{s ? s + ' ' : ''}{l}</span><b style={{ color: C.accent, fontVariantNumeric: 'tabular-nums' }}>{fmt(nuevo[k])}</b></div>
        <div style={{ fontSize: 11, color: C.textSoft }}>Hoy {fmt(hoy[k])}, {sg(nuevo[k] - hoy[k])}</div></div>)}</div>}
    <div style={{ padding: '9px 14px', borderTop: `1px solid ${C.bgSoft}`, fontSize: 12, color: C.muted, display: 'flex', flexDirection: 'column', gap: 3 }}>
      {modo !== 'boleta' && <span>Sueldo base {fmt(calc.base.hoy.sueldoBase)} y gratificación {fmt(calc.base.hoy.gratificacion)} hoy; con el aumento {fmt(calc.base.nuevo.sueldoBase)} y {fmt(calc.base.nuevo.gratificacion)}</span>}
      {modo !== 'liquidacion' && hoy.tasa != null && <span>Retención de la boleta: {String((hoy.tasa * 100).toFixed(2)).replace('.', ',')} % hoy{nuevo.tasa != null && nuevo.tasa !== hoy.tasa ? `, ${String((nuevo.tasa * 100).toFixed(2)).replace('.', ',')} % con el aumento` : ''}</span>}
      <span>Costo empresa{anio ? ` de ${anio}` : ''}, {meses} meses: <b style={{ color: C.accent }}>{fmt(nuevo.costoEmpresa * meses)}</b>, {sg(dif * meses)} contra hoy</span>
      {tope && <span>La AFP ya está en el tope imponible: no sube con el aumento</span>}
      {calc.sinTasa && <span>Sin planilla del mes para calcular las cotizaciones del empleador</span>}
    </div></>}
  </div>
}
