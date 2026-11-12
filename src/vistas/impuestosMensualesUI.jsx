// «Impuestos mensuales · pago al SII»: grupo de la planilla del mes (tres filas clicables) y la página de detalle de cada tipo. Los números salen de impuestosMensuales (_shared); aquí solo se presentan.
import { C, SIcon, fmt, fmtFechaDMY } from '../lib/base.jsx'
import { fmtShort } from '../lib/compartido.jsx'
import { DESTINOS_BOLETA, ETIQ_DESTINO } from '../../supabase/functions/_shared/impuestosMensuales.js'
import { tasaBHE } from '../../supabase/functions/_shared/comisionesReglas.js'

export const TIPOS_IMP = [['ppm', 'PPM'], ['retencion', 'Retención de honorarios'], ['unico', 'Impuesto único']]
const CHIP = { verificado: [C.greenBg, C.greenText], estimado: [C.ambarBg, C.soonText], falta: [C.overdueBg, C.overdueText], 'por verificar': [C.ambarBg, C.soonText] }
export const Chip = ({ t }) => { const [bg, col] = CHIP[t.startsWith('falta') ? 'falta' : t] || CHIP.estimado; return <span style={{ fontSize: 10, fontWeight: 800, borderRadius: 20, padding: '2px 8px', background: bg, color: col, whiteSpace: 'nowrap' }}>{t}</span> }
const chev = <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke={C.done} strokeWidth='2.4' strokeLinecap='round' strokeLinejoin='round'><path d='m9 18 6-6-6-6' /></svg>
/** Destino del emisor de una boleta: chip que se cambia con un toque (guarda la decisión por RUT). Sin RUT o remuneración propia, solo se muestra. */
export function SelDestino({ rut, destino, onDestino }) {
  const fijo = !rut || destino === 'remuneracion' || !onDestino
  const col = destino ? [C.azulBg, C.accent] : [C.ambarBg, C.soonText]
  const sty = { fontSize: 10, fontWeight: 800, borderRadius: 20, padding: '2px 8px', background: col[0], color: col[1], border: 'none', textTransform: 'none', letterSpacing: 0, maxWidth: 190 }
  if (fijo) return <span style={sty}>{ETIQ_DESTINO[destino] || 'por clasificar'}</span>
  return <select aria-label='Destino del emisor' value={destino} onClick={(e) => e.stopPropagation()} onChange={(e) => onDestino(rut, e.target.value)} style={{ ...sty, cursor: 'pointer', appearance: 'auto' }}>
    <option value=''>{ETIQ_DESTINO['']}</option>{DESTINOS_BOLETA.map((d) => <option key={d} value={d}>{ETIQ_DESTINO[d]}</option>)}</select>
}
const pc = (n) => { const v = Math.round((n || 0) * 10000) / 100; return `${(Number.isInteger(v) ? v.toFixed(1) : String(v)).replace('.', ',')} %` }

/** Estado y una línea de contexto de cada tipo, para la fila de la planilla. @param {any} imp resultado de impuestosMensuales */
export function resumenFilas(imp) {
  const nombres = imp.retencion.personas.map((p) => String(p.persona).split(' ')[0]).filter(Boolean)
  return {
    ppm: { estado: imp.ppm.estado, sub: imp.ppm.fuente === 'declarado' ? 'F29 declarado' : `${pc(imp.ppm.tasa)} × base de ingresos` },
    retencion: { estado: imp.retencion.nFalta > 0 ? `falta ${imp.retencion.nFalta} boleta${imp.retencion.nFalta !== 1 ? 's' : ''}` : imp.retencion.estado, sub: nombres.length ? nombres.slice(0, 3).join(' y ') : 'sin boletas del mes' },
    unico: { estado: imp.unico.estado, sub: `${imp.unico.trabajadores.length} trabajador${imp.unico.trabajadores.length !== 1 ? 'es' : ''}` },
  }
}

/** Grupo de la planilla: total y tres filas clicables con su chip de estado. */
export function GrupoImpuestos({ imp, onAbrir }) {
  const f = resumenFilas(imp), cuerpo = { ppm: imp.ppm.monto, retencion: imp.retencion.monto, unico: imp.unico.monto }
  return <div style={{ borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, background: C.bgSoft }}>
    <div style={{ display: 'flex', alignItems: 'center', padding: '9px 16px' }}>
      <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: .4, textTransform: 'uppercase', color: C.accent }}>Impuestos mensuales · pago al SII</span>
      <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 800, color: C.accent, fontVariantNumeric: 'tabular-nums' }}>{fmt(imp.total)}</span>
    </div>
    {TIPOS_IMP.map(([k, l]) => <div key={k} role='button' tabIndex={0} onClick={() => onAbrir(k)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderTop: `1px solid ${C.border}`, background: C.surface, cursor: 'pointer' }}>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: C.accent }}>{k === 'unico' ? 'Impuesto único de trabajadores' : l}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 2 }}><Chip t={f[k].estado} /><span style={{ fontSize: 11, color: C.muted }}>{f[k].sub}</span></span>
      </span>
      <span style={{ fontSize: 14, fontWeight: 700, color: C.accent, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmt(cuerpo[k])}</span>
      <span style={{ flexShrink: 0 }}>{chev}</span>
    </div>)}
    {imp.porVerificar && <div style={{ padding: '8px 16px', fontSize: 11, color: C.soonText, background: C.ambarBg }}>Por verificar · el correo informa {fmt(imp.informado)} (diferencia {fmt(imp.dif)})</div>}
  </div>
}

const Kpi = ({ ic, t, v, s }) => <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '10px 12px', display: 'grid', gridTemplateColumns: '30px minmax(0,1fr)', columnGap: 10, alignItems: 'center', minWidth: 0 }}>
  <span style={{ gridRow: '1 / span 3', width: 30, height: 30, borderRadius: 9, background: C.azulBg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><SIcon n={ic} s={16} c={C.accent} /></span>
  <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .3, color: C.accent, whiteSpace: 'nowrap' }}>{t}</span>
  <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: -.4, color: C.accent, whiteSpace: 'nowrap' }}>{v}</span>
  <span style={{ fontSize: 11, color: C.textSoft, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s}</span>
</div>
const Caja = ({ ti, tot, children }) => <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, marginBottom: 9, overflow: 'hidden' }}>
  <div style={{ display: 'flex', alignItems: 'center', padding: '10px 16px', borderBottom: `1px solid ${C.border}` }}><span style={{ fontSize: 11, fontWeight: 800, letterSpacing: .4, textTransform: 'uppercase', color: C.accent }}>{ti}</span>{tot != null && <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 800, color: C.accent, fontVariantNumeric: 'tabular-nums' }}>{tot}</span>}</div>
  {children}</div>
const Fila = ({ a, b, c, d, onClick, chip }) => <div role={onClick ? 'button' : undefined} onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px', borderTop: `1px solid ${C.bgSoft}`, cursor: onClick ? 'pointer' : 'default' }}>
  <span style={{ minWidth: 0, flex: 1 }}><span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: C.text }}>{a}</span>{(b || chip) && <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 11, color: C.textSoft }}>{chip}{b}</span>}</span>
  {c != null && <span style={{ fontSize: 13, fontWeight: 700, color: C.accent, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', textAlign: 'right', minWidth: 78 }}>{c}</span>}
  {d != null && <span style={{ fontSize: 13, fontWeight: 700, color: C.accent, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', textAlign: 'right', minWidth: 78 }}>{d}</span>}
  {onClick ? <span style={{ flexShrink: 0 }}>{chev}</span> : d != null ? <span style={{ width: 15, flexShrink: 0 }} /> : null}
</div>
const Tot = ({ l, v }) => <div style={{ display: 'flex', alignItems: 'center', padding: '11px 16px', background: C.bgSoft, border: `1px solid ${C.border}`, borderRadius: 12, marginBottom: 9 }}><span style={{ fontSize: 13, fontWeight: 800, color: C.accent }}>= {l}</span><span style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 800, color: C.accent, fontVariantNumeric: 'tabular-nums' }}>{v}</span></div>

/** Página de detalle de un tipo, con selector entre los tres. `otrosMeses` = boletasPorCargar de los demás meses. */
export function DetalleImpuestos({ imp, tipo, setTipo, mesLbl, origen, onBack, isDesktop, onCargarBoleta, otrosMeses = [], tituloMes, onDestino }) {
  const nombre = TIPOS_IMP.find(([k]) => k === tipo)?.[1] || ''
  const grid = { display: 'grid', gridTemplateColumns: isDesktop ? 'repeat(4,minmax(0,1fr))' : 'repeat(2,minmax(0,1fr))', gap: isDesktop ? 10 : 8, marginBottom: 12 }
  let cuerpo = null
  if (tipo === 'ppm') {
    const p = imp.ppm
    cuerpo = <>
      <div style={grid}><Kpi ic='receipt' t='PPM' v={fmtShort(p.monto)} s={p.fuente === 'declarado' ? 'F29 declarado' : 'estimado'} /><Kpi ic='file' t='Base de ingresos' v={fmtShort(p.base)} s={`${p.nDocs} documento${p.nDocs !== 1 ? 's' : ''}`} /><Kpi ic='chart' t='Tasa' v={pc(p.tasa)} s={p.fuente === 'declarado' ? 'declarada' : 'más repetida'} /><Kpi ic='check' t='Estado' v={p.estado} s={p.fuente === 'declarado' ? 'según el SII' : 'hasta declarar'} /></div>
      <Caja ti={`Qué se paga · ${tituloMes}`} tot={fmt(p.monto)}>
        <Fila a='Base de ingresos del mes' b='facturas del Registro de Ventas del SII, sin IVA, menos notas de crédito' c={fmt(p.base)} />
        <Fila a='Tasa del PPM' b={p.fuente === 'declarado' ? 'declarada en el F29' : 'la que más se repite en los últimos seis F29 declarados'} c={pc(p.tasa)} />
      </Caja>
      <Tot l='PPM' v={fmt(p.monto)} />
    </>
  } else if (tipo === 'retencion') {
    const r = imp.retencion, nBol = r.personas.reduce((a, x) => a + x.boletas.filter((b) => b.folio != null).length, 0), nFalta = r.personas.reduce((a, x) => a + x.boletas.filter((b) => b.falta).length, 0)
    cuerpo = <>
      <div style={grid}><Kpi ic='file' t='Retención' v={fmtShort(r.monto)} s={r.fuente === 'declarado' ? 'F29 declarado' : `tasa ${pc(r.personas[0]?.boletas[0]?.tasa || tasaBHE(`${imp.per}-01`))}`} /><Kpi ic='receipt' t='Cargadas' v={String(nBol)} s={`${r.personas.filter((x) => x.boletas.some((b) => b.folio != null)).length} persona${r.personas.filter((x) => x.boletas.some((b) => b.folio != null)).length !== 1 ? 's' : ''}`} /><Kpi ic='alert' t='Por cargar' v={String(nFalta)} s={nFalta ? r.personas.filter((x) => x.boletas.some((b) => b.falta)).map((x) => x.persona.split(' ')[0]).join(', ') : 'ninguna'} /><Kpi ic='user' t='Personas' v={String(r.personas.length)} s='con boleta' /></div>
      {r.personas.length === 0 && <Caja ti='Boletas del mes'><div style={{ padding: '14px 16px', fontSize: 12, color: C.muted }}>Sin boletas de honorarios en el mes.</div></Caja>}
      {r.personas.map((p) => <Caja key={p.persona} ti={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>{p.persona}<SelDestino rut={p.rut} destino={p.destino} onDestino={onDestino} /></span>} tot={fmt(p.monto)}>
        <div style={{ display: 'flex', gap: 10, padding: '6px 16px 6px', fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: .3 }}><span style={{ flex: 1 }}>N° · fecha</span><span style={{ minWidth: 66, textAlign: 'right' }}>Bruto</span><span style={{ minWidth: 66, textAlign: 'right' }}>Retención</span><span style={{ width: 15 }} /></div>
        {p.boletas.map((b, i) => <Fila key={i} a={b.folio != null ? `N° ${b.folio}` : 'Por cargar'} b={b.folio != null ? <span>{fmtFechaDMY(b.fecha)}{b.sinEnlace ? ' · sin movimiento del banco' : ''}</span> : <span>pagado {fmtFechaDMY(b.pagado)}</span>} chip={b.falta ? <Chip t='falta' /> : b.porVerificar ? <Chip t='por verificar' /> : null} c={fmt(b.bruto)} d={fmt(b.retencion)} onClick={b.falta && onCargarBoleta ? onCargarBoleta : undefined} />)}
      </Caja>)}
      <Tot l='Retención de honorarios' v={fmt(r.monto)} />
      {r.fuente === 'declarado' && r.calculado !== r.monto && <div style={{ fontSize: 11, color: C.soonText, marginBottom: 9 }}>Por verificar · las boletas suman {fmt(r.calculado)} y el F29 declarado, {fmt(r.monto)}.</div>}
      {otrosMeses.length > 0 && <Caja ti='Boletas que faltan en otros meses'>
        {otrosMeses.map((x, i) => <Fila key={i} a={`${x.mesLbl} · ${x.persona}`} chip={<><Chip t={x.estado} />{x.origen === 'boleta' && <SelDestino rut={x.rut} destino='' onDestino={onDestino} />}</>} b={x.origen === 'boleta' ? <span>N° {x.folio} · {x.motivo}</span> : <span>pagado {fmtFechaDMY(x.pagado)}</span>} c={fmt(x.bruto)} d={fmt(x.retencion)} onClick={onCargarBoleta} />)}
      </Caja>}
      {onCargarBoleta && nFalta + otrosMeses.length > 0 && <button onClick={onCargarBoleta} style={{ fontSize: 13, fontWeight: 700, color: C.accent, background: 'none', border: 'none', padding: '4px 0', cursor: 'pointer', textDecoration: 'underline' }}>Cargar boleta en Proveedores</button>}
    </>
  } else {
    const u = imp.unico
    cuerpo = <>
      <div style={grid}><Kpi ic='user' t='Impuesto único' v={fmtShort(u.monto)} s={u.fuente === 'declarado' ? 'F29 declarado' : 'liquidaciones del mes'} /><Kpi ic='users' t='Trabajadores' v={String(u.trabajadores.length)} s='con liquidación' /><Kpi ic='check' t='Estado' v={u.estado} s={u.fuente} /><Kpi ic='file' t='Liquidaciones' v={fmtShort(u.calculado)} s='suma del período' /></div>
      <Caja ti={`Por trabajador · ${tituloMes}`} tot={fmt(u.monto)}>
        {u.trabajadores.length === 0 && <div style={{ padding: '14px 16px', fontSize: 12, color: C.muted }}>Sin liquidaciones cargadas del mes.</div>}
        {u.trabajadores.map((t, i) => <Fila key={i} a={t.persona} b='liquidación de sueldo' c={fmt(t.monto)} />)}
      </Caja>
      <Tot l='Impuesto único de trabajadores' v={fmt(u.monto)} />
      {u.fuente === 'declarado' && u.calculado !== u.monto && <div style={{ fontSize: 11, color: C.soonText, marginBottom: 9 }}>Por verificar · las liquidaciones suman {fmt(u.calculado)} y el F29 declarado, {fmt(u.monto)}.</div>}
    </>
  }
  return <div style={{ maxWidth: isDesktop ? 1120 : '100%', margin: '0 auto', padding: isDesktop ? '0 20px 48px' : '0 16px 110px' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, margin: '4px 0 12px', flexWrap: 'wrap' }}>
      <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 13, fontWeight: 700, padding: 0 }}><svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round'><path d='M19 12H5' /><path d='m12 19-7-7 7-7' /></svg>{origen}</button>
      <h1 style={{ fontSize: isDesktop ? 20 : 19, fontWeight: 800, color: C.accent, letterSpacing: -.5, margin: 0 }}>{nombre}</h1>
    </div>
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>{TIPOS_IMP.map(([k, l]) => <button key={k} onClick={() => setTipo(k)} style={{ fontSize: 12, fontWeight: 700, borderRadius: 20, padding: '6px 13px', cursor: 'pointer', border: `1px solid ${tipo === k ? C.accent : C.border}`, background: tipo === k ? C.accent : C.surface, color: tipo === k ? '#fff' : C.muted }}>{l}</button>)}</div>
    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: .4, textTransform: 'uppercase', color: C.accent, margin: '2px 0 8px' }}>{mesLbl}</div>
    {cuerpo}
  </div>
}
