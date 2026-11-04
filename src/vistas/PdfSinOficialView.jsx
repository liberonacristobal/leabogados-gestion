// Facturas sin PDF oficial del SII: las que el proceso automático (sii-sync · pdf-oficial) no logró guardar en Drive tras varios intentos.
// La lista sale de learnings 'pdf_oficial_intentos' (hits = intentos); una factura que por fin se guarda deja de estar en ella, así que
// el aviso se limpia solo. «Reintentar ahora» pide el PDF de esa factura al instante, sin esperar el calendario.
import { useState } from 'react'
import { C, SEC_LBL } from '../lib/base.jsx'
import { tokenSesion } from '../lib/compartido.jsx'
import { supabase } from '../supabase'

const hace = iso => {
  const ms = Date.now() - Date.parse(iso || ''); if (!isFinite(ms) || ms < 0) return ''
  const h = Math.floor(ms / 3600000)
  return h < 1 ? 'hace menos de 1 hora' : h < 24 ? `hace ${h} h` : `hace ${Math.floor(h / 24)} d`
}

export function PdfSinOficialView({ filas, clients, isDesktop, onResuelta, onAbrirCliente }) {
  const [busy, setBusy] = useState(null), [msg, setMsg] = useState({})
  const reintentar = async f => {
    setBusy(f.id); setMsg(m => ({ ...m, [f.id]: '' }))
    try {
      const token = await tokenSesion()
      const res = await fetch('https://kibuwhtpoxrnfowfdolu.supabase.co/functions/v1/sii-sync', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, apikey: supabase.supabaseKey }, body: JSON.stringify({ action: 'pdf-oficial', facturaId: f.id }) })
      const d = await res.json().catch(() => ({}))
      const r = (d.resultados || [])[0]
      if (r?.estado === 'guardado') { setMsg(m => ({ ...m, [f.id]: 'Guardado' })); onResuelta && onResuelta(f.id) }
      else setMsg(m => ({ ...m, [f.id]: r?.motivo || d.error || 'El SII no entregó el PDF' }))
    } catch (e) { setMsg(m => ({ ...m, [f.id]: String(e?.message || e) })) }
    setBusy(null)
  }
  const nombre = id => (clients || []).find(c => String(c.id) === String(id))?.name || ''
  return (<div>
    <div style={{ ...SEC_LBL, margin: '0 2px 6px' }}>{filas.length === 1 ? '1 factura' : `${filas.length} facturas`}</div>
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
      {!filas.length && <div style={{ fontSize: 13, color: C.muted, padding: '16px 14px' }}>Todas las facturas tienen su PDF oficial.</div>}
      {filas.map((f, i) => (<div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderTop: i ? `1px solid ${C.bgSoft}` : 'none', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.accent, fontVariantNumeric: 'tabular-nums' }}>N° {f.folio}</div>
          <div onClick={() => f.client_id && onAbrirCliente && onAbrirCliente(f.client_id)} style={{ fontSize: 13, color: C.text, cursor: f.client_id ? 'pointer' : 'default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nombre(f.client_id) || 'Sin cliente'}</div>
        </div>
        <div style={{ flex: '2 1 240px', minWidth: 0, fontSize: 12, color: msg[f.id] && msg[f.id] !== 'Guardado' ? C.overdueText : C.muted, lineHeight: 1.35 }}>
          {msg[f.id] || `${f.n} intentos · último ${hace(f.at)}${f.ultimo ? ` · ${f.ultimo}` : ''}`}
        </div>
        <button disabled={busy === f.id} onClick={() => reintentar(f)} style={{ fontSize: 12, fontWeight: 700, color: C.surface, background: C.accent, border: 'none', borderRadius: 8, padding: '7px 12px', cursor: busy === f.id ? 'default' : 'pointer', minHeight: 34, opacity: busy === f.id ? 0.6 : 1 }}>{busy === f.id ? 'Buscando…' : 'Reintentar ahora'}</button>
      </div>))}
    </div>
  </div>)
}
