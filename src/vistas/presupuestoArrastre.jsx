// Presupuesto · página del Arrastre (paso 2): las líneas que componen el arrastre (cuotas por venta, asesorías permanentes y las agregadas a mano), cada una editable o quitable.
// Los ajustes se guardan en el borrador (st.arrastre) y los aplica una sola función (_shared/arrastreAnio.js); no tocan ventas, facturas ni cuotas reales.
import { C, appConfirm } from '../lib/base.jsx'
import { ajustarLinea, restaurarArrastre, agregarExtra, editarExtra, lineasTocadas } from '../../supabase/functions/_shared/arrastreAnio.js'
import { mm, mmP, mp, MESL, Panel, Titulo, Fld, FldDin, Lnk, Btn, Val, tasa27, LBL } from '../lib/presupuestoUI.jsx'

const fUF = (/** @type {number} */ n) => n.toLocaleString('es-CL', { maximumFractionDigits: 2 })
const bl = (/** @type {any} */ l) => ({ id: l.id, monto: l.base.monto, mensual: l.base.mensual, meses: l.base.meses })   // la línea tal como la entrega la app (los ajustes se comparan contra ella)
const cap = { fontSize: 11, fontWeight: 600, color: C.muted }

/** Título de la página según lo que se tocó en el paso 2. @param {any} X @param {{k:string}} d */
// Título corto: en el celular comparte la cabecera con el «← Arrastre 2026» y no debe cortarlo.
export const tituloArrastre = (X, d) => (d.k === 'pf' ? 'Por facturar' : d.k === 'as' ? 'Asesorías' : 'Líneas')
const rotuloPagina = (k) => (k === 'pf' ? 'Por facturar' : k === 'as' ? 'Asesorías permanentes' : 'Facturado del arrastre')

export function DArrastre({ X, k }) {
  const { D, est, ui, setUI, arrastre: A, setArrastre } = X, Y = X.datos.anio
  const lineas = A.lineas, q = String(ui.arrQ || '').trim().toLowerCase()
  const nombre = (/** @type {any} */ l) => (l.origen === 'agregada' ? l.nombre : X.cliNom(l.cid))
  const de = (/** @type {string} */ tipo) => lineas.filter((l) => l.origen === 'app' && l.tipo === tipo)
  const pf = de('cuota'), as = de('asesoria'), ex = lineas.filter((l) => l.origen === 'agregada')
  const coincide = (/** @type {any} */ l) => !q || (nombre(l) + ' ' + l.concepto).toLowerCase().includes(q)
  const orden = (/** @type {any[]} */ ls) => [...ls].filter(coincide).sort((a, b) => b.base.monto - a.base.monto || String(nombre(a)).localeCompare(String(nombre(b))))
  const muestraPF = k !== 'as', muestraAS = k !== 'pf', muestraEX = k === 'todo'
  const abierta = ui.arrAb
  const tocadas = lineasTocadas(est.arrastre)
  const idsPagina = [...(muestraPF ? pf : []), ...(muestraAS ? as : [])].map((l) => l.id)
  const hayAjustes = idsPagina.some((id) => est.arrastre.ajustes[id])
  const restaurarPagina = async () => {
    if (!(await appConfirm('¿Volver todas las líneas de esta página a los valores calculados?\nSe pierden los ajustes y las notas; las líneas agregadas a mano se conservan.'))) return
    setArrastre((a) => idsPagina.reduce((x, id) => restaurarArrastre(x, id), a))
  }
  const ajusta = (/** @type {any} */ l, /** @type {any} */ patch) => setArrastre((a) => ajustarLinea(a, bl(l), patch))
  const alta = () => { const id = 'n' + Date.now().toString(36); setArrastre((a) => agregarExtra(a, { nombre: 'Línea nueva', mensual: 0, desde: 1, meses: 12 }, id)); setUI({ arrAb: 'x:' + id }) }
  const GR = D ? 'minmax(0,1fr) 156px 96px 120px' : 'minmax(0,1fr) auto'

  // Rótulo de una línea: cliente de protagonista y, debajo, el proyecto con su detalle en gris (sin franjas ni pills).
  const rotulo = (/** @type {any} */ l, /** @type {string[]} */ det) => {
    const ab = abierta === l.id
    return <div onClick={() => setUI({ arrAb: ab ? null : l.id })} role='button' aria-expanded={ab} style={{ minWidth: 0, cursor: 'pointer' }}>
      <span style={{ fontWeight: 700, opacity: l.quitado ? 0.5 : 1, textDecoration: l.quitado ? 'line-through' : 'none' }}>{nombre(l)}</span>{' '}<span style={{ color: C.done, display: 'inline-block', transform: ab ? 'rotate(90deg)' : 'none' }}>›</span>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 1, opacity: l.quitado ? 0.7 : 1 }}>{[l.concepto, ...det].filter(Boolean).join(' · ')}</div>
    </div>
  }
  const volver = (/** @type {any} */ l) => <Lnk onClick={() => ajusta(l, { quitado: false })}>Volver a incluir</Lnk>
  const detalleAbierto = (/** @type {any} */ l, /** @type {string} */ valorApp) => <div style={{ background: C.bgSoft, padding: '8px 16px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
    <div><div style={{ ...LBL, color: C.accent, fontSize: 11, marginBottom: 4 }}>Nota</div><Fld text value={l.nota} ph='Motivo del ajuste (opcional)' label={`Nota de ${nombre(l)}`} onCommit={(v) => ajusta(l, { nota: String(v || '').trim() || null })} /></div>
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: 12, color: C.muted }}>
      <span>Calculado: <b style={{ color: C.text }}>{valorApp}</b></span>
      {l.quitado ? volver(l) : <Lnk rojo onClick={() => ajusta(l, { quitado: true })}>Quitar del arrastre</Lnk>}
      {(l.ajustado || l.nota) && !l.quitado && <Lnk onClick={() => setArrastre((a) => restaurarArrastre(a, l.id))}>Restaurar el valor calculado</Lnk>}
    </div>
  </div>
  const ajustadoTxt = (/** @type {any} */ l) => (l.quitado ? 'quitada' : l.ajustado ? `ajustado (calculado ${mmP(l.base.monto)})` : '')

  const filaCuota = (/** @type {any} */ l) => <div key={l.id}>
    <div style={{ display: 'grid', gridTemplateColumns: D ? 'minmax(0,1fr) 156px' : 'minmax(0,1fr) auto', gap: D ? 14 : '4px 12px', alignItems: 'center', padding: D ? '9px 16px' : '10px 14px', borderTop: `1px solid ${C.border}`, fontSize: 13 }}>
      {rotulo(l, [`${l.n} cuota${l.n !== 1 ? 's' : ''}`, l.enUF ? `${fUF(l.uf)} UF · a UF ${Y}` : '', l.moroso ? 'con factura morosa' : '', ajustadoTxt(l)])}
      {l.quitado ? <span style={{ textAlign: 'right', gridColumn: D ? '2 / -1' : undefined }}>{volver(l)}</span>
        : <span style={{ textAlign: 'right', fontWeight: 700, color: C.accent }}><FldDin sobrio clp={Math.round(l.monto)} tasa={tasa27()} label={`Monto ${Y} de ${nombre(l)}`} onCommit={(x) => ajusta(l, { monto: Math.max(0, x == null ? 0 : x) })} /></span>}
    </div>
    {abierta === l.id && detalleAbierto(l, mp(l.base.monto))}
  </div>

  const campoMes = (/** @type {any} */ l) => <span style={{ fontWeight: 700, color: C.accent }}><Fld sobrio kind='int' suf={'\u00A0de 12'} value={l.meses} label={`Meses de ${nombre(l)} en ${Y}`} onCommit={(x) => ajusta(l, { meses: Math.min(12, Math.max(0, Math.round(x == null ? 0 : x))) })} /></span>
  const campoMensual = (/** @type {any} */ l) => <span style={{ fontWeight: 700, color: C.accent }}><FldDin sobrio clp={Math.round(l.mensual)} tasa={tasa27()} label={`Monto mensual de ${nombre(l)}`} onCommit={(x) => ajusta(l, { mensual: Math.max(0, x == null ? 0 : x) })} /></span>
  const filaAsesoria = (/** @type {any} */ l) => <div key={l.id}>
    <div style={{ display: 'grid', gridTemplateColumns: GR, gap: D ? 14 : '6px 12px', alignItems: 'center', padding: D ? '9px 16px' : '10px 14px', borderTop: `1px solid ${C.border}`, fontSize: 13 }}>
      {rotulo(l, [l.enUF ? `${fUF(l.uf / 12)} UF al mes · a UF ${Y}` : '', l.moroso ? 'con factura morosa' : '', ajustadoTxt(l)])}
      {l.quitado ? <span style={{ textAlign: 'right', gridColumn: D ? '2 / -1' : undefined }}>{volver(l)}</span> : <>
        {D && <span style={{ textAlign: 'right' }}>{campoMensual(l)}</span>}
        {D && <span style={{ textAlign: 'right' }}>{campoMes(l)}</span>}
        <b style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: C.accent }}><Val v={mm(l.monto)} /></b>
        {!D && <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={cap}>Por mes</span>{campoMensual(l)}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={cap}>Meses en {Y}</span>{campoMes(l)}</div>
        </div>}
      </>}
    </div>
    {abierta === l.id && detalleAbierto(l, `${mp(l.base.mensual)} por mes × ${l.base.meses} · ${mm(l.base.monto)}`)}
  </div>

  const filaExtra = (/** @type {any} */ l) => { const id = l.id.slice(2), e = est.arrastre.extras.find((x) => x.id === id) || { nombre: l.nombre, mensual: l.mensual, desde: 1, meses: l.meses }, ab = abierta === l.id
    const set = (/** @type {any} */ patch) => setArrastre((a) => editarExtra(a, id, patch))
    return <div key={l.id}>
      <div style={{ display: 'grid', gridTemplateColumns: GR, gap: D ? 14 : '6px 12px', alignItems: 'center', padding: D ? '9px 16px' : '10px 14px', borderTop: `1px solid ${C.border}`, fontSize: 13 }}>
        <div onClick={() => setUI({ arrAb: ab ? null : l.id })} role='button' aria-expanded={ab} style={{ minWidth: 0, cursor: 'pointer' }}><span style={{ fontWeight: 700, opacity: l.quitado ? 0.5 : 1, textDecoration: l.quitado ? 'line-through' : 'none' }}>{l.nombre}</span>{' '}<span style={{ color: C.done, display: 'inline-block', transform: ab ? 'rotate(90deg)' : 'none' }}>›</span><div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>agregada a mano · desde {MESL[e.desde - 1].toLowerCase()}{l.quitado ? ' · quitada' : ''}</div></div>
        {D && <span style={{ textAlign: 'right' }}>{campoMensual({ ...l, mensual: e.mensual })}</span>}
        {D && <span style={{ textAlign: 'right' }}>{campoMes({ ...l, meses: e.meses })}</span>}
        <b style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: C.accent }}><Val v={mm(l.monto)} /></b>
        {!D && <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={cap}>Por mes</span>{campoMensual({ ...l, mensual: e.mensual })}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={cap}>Meses</span>{campoMes({ ...l, meses: e.meses })}</div>
        </div>}
      </div>
      {ab && <div style={{ background: C.bgSoft, padding: '8px 16px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'grid', gridTemplateColumns: D ? 'minmax(0,2fr) minmax(0,1fr) minmax(0,1fr)' : '1fr 1fr', gap: 10, alignItems: 'end' }}>
          <div style={{ gridColumn: D ? undefined : '1 / -1' }}><div style={{ ...LBL, color: C.accent, fontSize: 11, marginBottom: 4 }}>Nombre</div><Fld text value={e.nombre} label='Nombre de la línea' onCommit={(v) => set({ nombre: String(v || '').trim() || 'Línea nueva' })} /></div>
          <div><div style={{ ...LBL, color: C.accent, fontSize: 11, marginBottom: 4 }}>Mes de inicio</div><Fld kind='int' w={96} suf='(1 a 12)' value={e.desde} label='Mes de inicio' onCommit={(x) => set({ desde: Math.min(12, Math.max(1, Math.round(x == null ? 1 : x))) })} /></div>
          <div><div style={{ ...LBL, color: C.accent, fontSize: 11, marginBottom: 4 }}>Meses</div><Fld kind='int' w={96} suf='de 12' value={e.meses} label='Meses de la línea' onCommit={(x) => set({ meses: Math.min(12, Math.max(0, Math.round(x == null ? 0 : x))) })} /></div>
          <div style={{ gridColumn: '1 / -1' }}><div style={{ ...LBL, color: C.accent, fontSize: 11, marginBottom: 4 }}>Nota</div><Fld text value={e.nota || ''} ph='Opcional' label='Nota de la línea' onCommit={(v) => set({ nota: String(v || '').trim() })} /></div>
        </div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12 }}>{l.quitado ? <Lnk onClick={() => set({ quitado: false })}>Volver a incluir</Lnk> : <Lnk onClick={() => set({ quitado: true })}>Quitar del arrastre</Lnk>}<Lnk rojo onClick={() => { set(null); setUI({ arrAb: null }) }}>Eliminar la línea</Lnk></div>
      </div>}
    </div>
  }

  const cab = (/** @type {string} */ c1, /** @type {boolean} */ campos) => D && <div style={{ display: 'grid', gridTemplateColumns: campos ? GR : 'minmax(0,1fr) 156px', gap: 14, padding: '9px 16px', ...LBL, color: C.accent, borderBottom: `1px solid ${C.border}` }}><span>{c1}</span>{campos ? <><span style={{ textAlign: 'right' }}>Por mes</span><span style={{ textAlign: 'right' }}>Meses</span><span style={{ textAlign: 'right' }}>Total {Y}</span></> : <span style={{ textAlign: 'right' }}>Monto {Y}</span>}</div>
  const pie = (/** @type {string} */ t, /** @type {number} */ v) => k !== 'todo' ? null : <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 12, padding: '10px 16px', borderTop: `2px solid ${C.accent}`, background: C.bgSoft, fontSize: 13, fontWeight: 800 }}><span>{t}</span><span style={{ fontVariantNumeric: 'tabular-nums', color: C.accent }}><Val v={mm(v)} /></span></div>
  const sinLineas = (/** @type {string} */ t) => <div style={{ padding: '12px 16px', fontSize: 13, color: C.muted }}>{t}</div>
  const vistasPF = orden(pf), vistasAS = orden(as), vistasEX = ex.filter(coincide)
  const nTot = (muestraPF ? pf.length : 0) + (muestraAS ? as.length : 0)

  return <>
    <Panel pad>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: C.muted }}>{rotuloPagina(k)}{tocadas > 0 ? ` · ${tocadas} línea${tocadas !== 1 ? 's' : ''} ajustada${tocadas !== 1 ? 's' : ''}` : ' · valores calculados'}</span>
        <b style={{ fontSize: D ? 21 : 18, color: C.accent, fontVariantNumeric: 'tabular-nums' }}><Val v={mm(k === 'pf' ? A.proyectos : k === 'as' ? A.asesorias : A.total)} /></b>
      </div>
      {hayAjustes && <div style={{ marginTop: 6 }}><Lnk onClick={restaurarPagina}>Restaurar los valores calculados</Lnk></div>}
    </Panel>
    {nTot > 10 && <input value={ui.arrQ || ''} onChange={(ev) => setUI({ arrQ: ev.target.value })} placeholder='Buscar cliente o proyecto' aria-label='Buscar cliente o proyecto' style={{ width: '100%', boxSizing: 'border-box', height: 40, padding: '0 12px', background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, fontFamily: 'inherit', fontSize: 14, color: C.text, outline: 'none' }} />}
    {muestraPF && <>{k === 'todo' && <Titulo>Por facturar · cuotas de proyectos con vencimiento en {Y}</Titulo>}
      <Panel>{cab('Cliente y proyecto', false)}{vistasPF.length ? vistasPF.map(filaCuota) : sinLineas(pf.length ? 'Ninguna línea coincide con la búsqueda.' : `No hay cuotas de proyectos con vencimiento en ${Y}.`)}{pie(`Por facturar`, A.proyectos)}</Panel></>}
    {muestraAS && <>{k === 'todo' && <Titulo>Asesorías permanentes · ventas mensuales activas</Titulo>}
      <Panel>{cab('Cliente y asesoría', true)}{vistasAS.length ? vistasAS.map(filaAsesoria) : sinLineas(as.length ? 'Ninguna línea coincide con la búsqueda.' : 'No hay asesorías permanentes activas.')}{pie('Asesorías permanentes', A.asesorias)}</Panel></>}
    {muestraEX && <>
      <Titulo right={<Btn onClick={alta}>+ Agregar línea</Btn>}>Agregadas a mano</Titulo>
      <Panel>{vistasEX.length ? <>{cab('Línea', true)}{vistasEX.map(filaExtra)}{pie('Agregadas a mano', A.agregadas)}</> : sinLineas('Contrato que aún no está registrado.')}</Panel></>}
    <div style={{ fontSize: 12, color: C.muted, margin: '0 4px' }}>Los ajustes quedan en este borrador y en sus versiones; no cambian ventas, facturas ni cuotas.</div>
  </>
}
