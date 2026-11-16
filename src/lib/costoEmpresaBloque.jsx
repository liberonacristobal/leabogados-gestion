// Bloque «Costo empresa» de un aumento de sueldo: del líquido a lo que cuesta la persona (impuesto único, cotizaciones del trabajador, haberes brutos, cotizaciones del empleador).
// Una sola fuente para el Presupuesto 2027 y Costos de Oficina; el cálculo es remuneracionPersona.js (con liquidoABruto.js). Sirve para cualquier persona que tenga liquidación.
import { C, fmt } from './base.jsx'
import { remuneracionDeLiquido, tasaEmpleadorDe } from '../../supabase/functions/_shared/remuneracionPersona.js'
import { desglosarImponible } from '../../supabase/functions/_shared/liquidoABruto.js'

/**
 * Remuneración de hoy y con el aumento de una persona. null si no tiene liquidación de la que tomar su AFP y su plan de salud.
 * @param {{persona:string, liquido:number, liquidoNuevo:number, liq:any[], tramosIU:any[], plan:any[], uf:number, ufDeLiquidacion:(ym:string)=>number, ym:string}} p
 */
export function calcularAumento(p) {
  const emp = tasaEmpleadorDe({ plan: p.plan, liquidaciones: p.liq }), tasaEmpleador = emp ? emp.tasa : 0
  const base = { persona: p.persona, liquidaciones: p.liq, ym: p.ym, uf: p.uf, ufDeLiquidacion: p.ufDeLiquidacion, tramosFilas: p.tramosIU, tasaEmpleador }
  const hoy = remuneracionDeLiquido({ ...base, liquido: p.liquido }), nuevo = remuneracionDeLiquido({ ...base, liquido: p.liquidoNuevo })
  if (!hoy || !nuevo) return null
  return { hoy, nuevo, tasaEmpleador, sinTasa: !emp, base: { hoy: desglosarImponible(hoy.imponible), nuevo: desglosarImponible(nuevo.imponible) } }
}

const sg = n => (n >= 0 ? '+' : '−') + fmt(Math.abs(n))
const FILAS = [['', 'Líquido', 'liquido'], ['+', 'Impuesto único', 'iu'], ['+', 'Cotizaciones del trabajador', 'cotTrab'], ['=', 'Haberes brutos', 'haberes', 'tot'], ['+', 'Cotizaciones del empleador', 'empleador'], ['=', 'Costo empresa', 'costoEmpresa', 'res']]

/** @param {{calc:ReturnType<typeof calcularAumento>, D:boolean, meses?:number, anio?:string|number}} p */
export function CostoEmpresaBloque({ calc, D, meses = 12, anio }) {
  if (!calc) return null
  const { hoy, nuevo } = calc
  const dif = nuevo.costoEmpresa - hoy.costoEmpresa
  const celda = { padding: '8px 0', borderTop: `1px solid ${C.bgSoft}`, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }
  const tope = nuevo.afp === hoy.afp
  return <div style={{ gridColumn: '1 / -1', border: `2px solid ${C.accent}`, borderRadius: 12, overflow: 'hidden', background: C.card }}>
    <div style={{ padding: '7px 14px', background: C.accent, color: '#fff', fontSize: 11, fontWeight: 700, letterSpacing: .5, textTransform: 'uppercase' }}>Costo empresa con el aumento</div>
    {D
      ? <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 120px 130px 110px', padding: '0 14px' }}>
        {['Por mes', 'Hoy', 'Con el aumento', 'Diferencia'].map((h, i) => <span key={h} style={{ ...celda, borderTop: 'none', fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: .4, textAlign: i ? 'right' : 'left' }}>{h}</span>)}
        {FILAS.flatMap(([s, l, k, c]) => {
          const tot = c === 'tot' || c === 'res', bg = c === 'res' ? C.grisBg : undefined, bt = c === 'tot' ? `1px solid ${C.accent}` : celda.borderTop
          return [
            <span key={k + 'l'} style={{ ...celda, borderTop: bt, background: bg, color: tot ? C.accent : C.muted, fontWeight: tot ? 700 : 400 }}>{s ? s + ' ' : ''}{l}</span>,
            <span key={k + 'h'} style={{ ...celda, borderTop: bt, background: bg, textAlign: 'right', paddingRight: 12, fontWeight: tot ? 700 : 400 }}>{fmt(hoy[k])}</span>,
            <span key={k + 'n'} style={{ ...celda, borderTop: bt, background: bg, textAlign: 'right', paddingRight: 12, fontWeight: 700, color: C.accent }}>{fmt(nuevo[k])}</span>,
            <span key={k + 'd'} style={{ ...celda, borderTop: bt, background: bg, textAlign: 'right', color: C.muted, fontWeight: tot ? 700 : 400 }}>{sg(nuevo[k] - hoy[k])}</span>]
        })}
      </div>
      : <div>{FILAS.map(([s, l, k, c]) => <div key={k} style={{ padding: '8px 12px', borderTop: c === 'tot' ? `1px solid ${C.accent}` : `1px solid ${C.bgSoft}`, background: c === 'res' ? C.grisBg : undefined }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, color: C.muted }}><span>{s ? s + ' ' : ''}{l}</span><b style={{ color: C.accent, fontVariantNumeric: 'tabular-nums' }}>{fmt(nuevo[k])}</b></div>
        <div style={{ fontSize: 11, color: C.textSoft }}>Hoy {fmt(hoy[k])}, {sg(nuevo[k] - hoy[k])}</div></div>)}</div>}
    <div style={{ padding: '9px 14px', borderTop: `1px solid ${C.bgSoft}`, fontSize: 12, color: C.muted, display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span>Sueldo base {fmt(calc.base.hoy.sueldoBase)} y gratificación {fmt(calc.base.hoy.gratificacion)} hoy; con el aumento {fmt(calc.base.nuevo.sueldoBase)} y {fmt(calc.base.nuevo.gratificacion)}</span>
      <span>Costo empresa{anio ? ` de ${anio}` : ''}, {meses} meses: <b style={{ color: C.accent }}>{fmt(nuevo.costoEmpresa * meses)}</b>, {sg(dif * meses)} contra hoy</span>
      {tope && <span>La AFP ya está en el tope imponible: no sube con el aumento</span>}
      {calc.sinTasa && <span>Sin planilla del mes para calcular las cotizaciones del empleador</span>}
    </div>
  </div>
}
