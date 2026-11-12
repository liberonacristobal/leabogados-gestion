// «Boletas recibidas del SII»: carga mensual del informe de boletas de honorarios recibidas (planilla electrónica o texto pegado).
// Muestra qué se leyó y qué es nuevo antes de guardar. Las cifras y el cruce con los cargos salen de _shared/boletasRecibidas.js.
import { useState } from 'react'
import { supabase, DEMO } from '../supabase'
import { C, appAlert, fmtFechaDMY } from '../lib/base.jsx'
import { leerInformeBoletas } from '../../supabase/functions/_shared/boletasRecibidas.js'

const f0 = (/** @type {number} */ n) => '$' + Math.round(n || 0).toLocaleString('es-CL')
const clave = (/** @type {any} */ b) => `${b.emisor_rut}|${b.folio}`

export function CargarBoletasSII({ existentes = [], onGuardadas, userEmail }) {
  const [leidas, setLeidas] = useState(/** @type {any} */ (null))
  const [texto, setTexto] = useState('')
  const [pegar, setPegar] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const ya = new Set((existentes || []).map(clave))
  const procesa = (/** @type {any} */ entrada) => {
    const r = leerInformeBoletas(entrada)
    if (!r.filas.length) { appAlert('No encontré boletas en lo que cargaste. Sube la planilla del informe mensual de boletas recibidas o pega el texto del informe.'); return }
    setLeidas({ ...r, nuevas: r.filas.filter(b => !ya.has(clave(b))) })
  }
  const onArchivo = async (/** @type {FileList | null} */ lista) => {
    const f = lista && lista[0]; if (!f) return
    try {
      if (/\.(csv|txt)$/i.test(f.name)) { const t = new TextDecoder('latin1').decode(await f.arrayBuffer()); const primero = leerInformeBoletas(t); if (primero.filas.length) return procesa(t)
        return procesa(t.split(/\r?\n/).map(l => l.split(/;|\t|,(?=\S)/))) }
      const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs')
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' })
      procesa(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true }))
    } catch (e) { appAlert('No se pudo leer el archivo: ' + (e && /** @type {any} */ (e).message || e)) }
  }
  const guardar = async () => {
    const nuevas = leidas?.nuevas || []; if (!nuevas.length || guardando) return
    setGuardando(true)
    try {
      const filas = nuevas.map((/** @type {any} */ b) => ({ folio: b.folio, fecha: b.fecha, emisor_rut: b.emisor_rut, emisor_nombre: b.emisor_nombre, estado: b.estado, bruto: b.bruto, retencion: b.retencion, pagado: b.pagado, periodo: b.fecha.slice(0, 7), created_by: userEmail || null }))
      if (!DEMO) { for (let i = 0; i < filas.length; i += 200) { const { error } = await supabase.from('sii_boletas_recibidas').upsert(filas.slice(i, i + 200), { onConflict: 'estudio_id,emisor_rut,folio', ignoreDuplicates: true }); if (error) throw error } }
      onGuardadas && onGuardadas(filas)
      setLeidas(null); setTexto(''); setPegar(false)
      appAlert(`Se guardaron ${filas.length} boleta${filas.length !== 1 ? 's' : ''} recibidas.`)
    } catch (e) { appAlert('No se pudieron guardar las boletas: ' + (e && /** @type {any} */ (e).message || e)) }
    setGuardando(false)
  }
  const btn = { display: 'inline-block', padding: '7px 14px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.accent, fontSize: 12, fontWeight: 600, cursor: 'pointer' }
  const L = leidas
  const total = L ? L.nuevas.reduce((a, b) => a + b.pagado, 0) : 0
  return (
    <div style={{ padding: 16, borderRadius: 10, border: `2px dashed ${C.border}`, textAlign: 'center', background: C.bgSoft, marginBottom: 12 }}>
      <div style={{ fontSize: 14, color: C.accent, fontWeight: 600, marginBottom: 8 }}>Cargar boletas recibidas del SII</div>
      {!L && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <label style={btn}><input type='file' accept='.xlsx,.xls,.csv,.txt' onChange={e => onArchivo(e.target.files)} style={{ display: 'none' }} />Elegir planilla</label>
          <button onClick={() => setPegar(p => !p)} style={btn}>Pegar el informe</button>
        </div>)}
      {!L && pegar && (
        <div style={{ marginTop: 10 }}>
          <textarea value={texto} onChange={e => setTexto(e.target.value)} placeholder='Pega aquí el texto del informe mensual de boletas recibidas' rows={5} style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${C.border}`, borderRadius: 8, padding: 8, fontSize: 12, background: C.surface, color: C.text }} />
          <button onClick={() => procesa(texto)} disabled={!texto.trim()} style={{ ...btn, marginTop: 6 }}>Leer</button>
        </div>)}
      {L && (
        <div style={{ textAlign: 'left' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            {[['Leídas', L.filas.length, C.text], ['Nuevas', L.nuevas.length, C.greenText], ['Ya cargadas', L.filas.length - L.nuevas.length, C.muted]].map(([t, v, col]) => (
              <div key={String(t)} style={{ flex: 1, background: C.surface, borderRadius: 10, padding: '7px 10px' }}><div style={{ fontSize: 10, color: C.muted }}>{t}</div><div style={{ fontSize: 16, fontWeight: 700, color: /** @type {string} */ (col) }}>{String(v)}</div></div>))}
          </div>
          {L.descartadas > 0 && <div style={{ fontSize: 11, color: C.soonText, marginBottom: 6 }}>{L.descartadas} fila{L.descartadas !== 1 ? 's' : ''} sin fecha, RUT o folio, omitida{L.descartadas !== 1 ? 's' : ''}.</div>}
          <div style={{ maxHeight: 180, overflowY: 'auto', background: C.surface, borderRadius: 8, padding: '4px 8px', fontSize: 11 }}>
            {L.nuevas.slice(0, 40).map((/** @type {any} */ b) => (
              <div key={clave(b)} style={{ display: 'flex', gap: 8, padding: '3px 0', borderTop: `1px solid ${C.bgSoft}` }}><span style={{ width: 78, color: C.muted }}>{fmtFechaDMY(b.fecha)}</span><span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.emisor_nombre}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{f0(b.pagado)}</span></div>))}
            {L.nuevas.length > 40 && <div style={{ color: C.muted, padding: '4px 0' }}>y {L.nuevas.length - 40} más</div>}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: C.muted, marginRight: 'auto' }}>{L.nuevas.length ? `Nuevas por ${f0(total)}` : 'Todo el informe ya estaba cargado'}</span>
            <button onClick={() => setLeidas(null)} style={btn}>Cancelar</button>
            <button onClick={guardar} disabled={!L.nuevas.length || guardando} style={{ ...btn, background: C.accent, color: '#fff', border: 'none', opacity: L.nuevas.length ? 1 : .5 }}>{guardando ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </div>)}
      <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>Informe mensual de boletas recibidas del SII. Volver a cargarlo no duplica.</div>
    </div>)
}
