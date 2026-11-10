// Presupuesto anual · Metas · «Distribución mensual»: cómo se reparte en los 12 meses el presupuesto de cada componente (lo que mide el Seguimiento).
// Por defecto, partes iguales; por componente se puede elegir «Estacionalidad» (promedio suavizado de 2025 y 2026) o «Manual» (peso de cada mes). Estimación propia.
// Las reglas son pesosDe / repartoMensual de _shared/presupuesto.js; aquí solo se elige y se dibuja.
import { C, useIsDesktop } from '../lib/base.jsx'
import { COMPONENTES_DIST, MODOS_DIST, nombreComponente, pesosDe } from '../../supabase/functions/_shared/presupuesto.js'
import { MESC, Seg, Fld, Lnk, pc } from '../lib/presupuestoUI.jsx'
import { CFG_PRESUPUESTO as CFG } from '../lib/presupuestoCfg.js'

/** Pesos manuales de partida: los de la distribución vigente del componente, llevados a % del año (suman 100). */
const pesosPartida = (dist, comp, pesosEst) => { const w = pesosDe(dist, comp, pesosEst) || Array(12).fill(1), t = w.reduce((a, x) => a + x, 0) || 1; return w.map((x) => Math.round((x / t) * 10000) / 100) }

export function Distribucion({ X }) {
  const D = useIsDesktop(), { est, datos: d, parche, ui, setUI } = X, dist = est.dist || { modo: {}, manual: {} }
  const abierto = ui.distAbierta || null
  const poner = (comp, modo) => parche((c) => {
    c.dist = c.dist || { modo: {}, manual: {} }
    if (modo === 'manual' && !(c.dist.manual[comp] || []).length) c.dist.manual[comp] = pesosPartida(dist, comp, d.pesosEst)
    c.dist.modo[comp] = modo
  })
  const ponerMes = (comp, i, v) => parche((c) => { c.dist = c.dist || { modo: {}, manual: {} }; const w = (c.dist.manual[comp] && c.dist.manual[comp].length === 12 ? c.dist.manual[comp] : pesosPartida(dist, comp, d.pesosEst)).slice(); w[i] = Math.max(0, v == null ? 0 : v); c.dist.manual[comp] = w })
  const fila = (comp) => {
    const modo = dist.modo[comp] || 'iguales', manual = modo === 'manual', w = dist.manual[comp] || [], suma = w.reduce((a, x) => a + (Number(x) || 0), 0), sinEst = modo === 'estacional' && !pesosDe(dist, comp, d.pesosEst)
    return <div key={comp} style={{ padding: D ? '12px 16px' : '10px 14px', borderTop: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <b style={{ color: C.accent, fontSize: 14 }}>{nombreComponente(comp, CFG)}</b>
        <Seg options={MODOS_DIST} value={modo} onChange={(m) => { poner(comp, m); setUI({ distAbierta: m === 'manual' ? comp : abierto === comp ? null : abierto }) }} />
      </div>
      {sinEst && <div style={{ fontSize: 12, color: C.muted }}>No hay meses cerrados suficientes en 2025 y 2026: se usan partes iguales.</div>}
      {manual && <>
        <div onClick={() => setUI({ distAbierta: abierto === comp ? null : comp })} role='button' style={{ cursor: 'pointer', fontSize: 12, fontWeight: 700, color: C.accent, width: 'max-content' }}>{abierto === comp ? 'Ocultar los meses ›' : 'Editar los meses ›'}</div>
        {abierto === comp && <>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${D ? 6 : 3},minmax(0,1fr))`, gap: D ? 10 : 8 }}>
            {MESC.map((m, i) => <div key={m} style={{ background: C.bgSoft, border: `1px solid ${C.border}`, borderRadius: 10, padding: '7px 10px', minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: C.accent }}>{m}</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: C.accent }}><Fld sobrio kind='pct' suf='%' value={w.length === 12 ? w[i] : 100 / 12} onCommit={(v) => ponerMes(comp, i, v)} label={`${nombreComponente(comp, CFG)} · ${m}`} /></div>
            </div>)}
          </div>
          <div style={{ fontSize: 12, color: Math.abs(suma - 100) < 0.05 ? C.muted : C.soonText }}>Suma {pc(suma)}{Math.abs(suma - 100) < 0.05 ? '' : ' · se ajusta a 100 % al repartir'}</div>
        </>}
      </>}
    </div>
  }
  return <>
    <div style={{ padding: D ? '10px 16px' : '10px 14px', fontSize: 12, color: C.muted }}>Sin estacionalidad estable: entre 2025 y 2026 los meses cambian de peso (pocas facturas grandes los mueven), por eso parte en partes iguales. Estimación propia; el Seguimiento usa esta misma distribución.</div>
    {COMPONENTES_DIST.map(fila)}
    <div style={{ padding: D ? '10px 16px 12px' : '10px 14px 12px', borderTop: `1px solid ${C.border}`, fontSize: 12, color: C.muted, display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
      <span>El Margen se calcula cada mes con Cobrado, comisiones y Presupuesto de costos.</span>
      <Lnk onClick={() => { parche((c) => { c.dist = { modo: {}, manual: {} } }); setUI({ distAbierta: null }) }}>Volver a partes iguales</Lnk>
    </div>
  </>
}
