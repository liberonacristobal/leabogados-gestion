import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, DEMO } from '../supabase'
import { C, SIcon } from './base.jsx'
import { setLearningKV } from './compartido.jsx'
import { agregarVista, claveVistas, hayFiltro, leerVistas, mismaVista, quitarVista } from './vistasGuardadas.js'

// Vistas guardadas por usuario y lista. Una sola fila en learnings (kind vista_guardada, key «correo|lista»); en la demo y como copia local, localStorage.
export function useVistasGuardadas(lista, email) {
  const clave = claveVistas(email, lista)
  const [vistas, setVistas] = useState(() => { try { return leerVistas(localStorage.getItem('vg:' + clave)) } catch (_) { return [] } })
  useEffect(() => {
    if (DEMO || !email) return
    let on = true
    supabase.from('learnings').select('value').eq('kind', 'vista_guardada').eq('key', clave).order('updated_at', { ascending: false }).limit(1)
      .then(({ data }) => { if (on && data && data[0]) setVistas(leerVistas(data[0].value)) }, () => {})
    return () => { on = false }
  }, [clave]) // eslint-disable-line react-hooks/exhaustive-deps
  const guardar = useCallback(nueva => {
    setVistas(nueva)
    try { localStorage.setItem('vg:' + clave, JSON.stringify(nueva)) } catch (_) {}
    if (!DEMO && email) Promise.resolve(setLearningKV('vista_guardada', clave, JSON.stringify(nueva))).catch(() => {})
  }, [clave]) // eslint-disable-line react-hooks/exhaustive-deps
  return [vistas, guardar]
}

// Control «Vistas» junto a los filtros: aplica una vista guardada de un toque o guarda la combinación actual con un nombre.
// actual: filtros de hoy · defecto: combinación de origen (sin filtros) · resumen: texto corto de lo que hoy está filtrado.
export function VistasGuardadas({ vistas, guardar, actual, defecto = {}, resumen = '', onAplicar }) {
  const [abierto, setAbierto] = useState(false)
  const [nombre, setNombre] = useState('')
  const [error, setError] = useState(null)
  const caja = useRef(null)
  useEffect(() => {
    if (!abierto) return
    const fuera = e => { if (caja.current && !caja.current.contains(e.target)) setAbierto(false) }
    const esc = e => { if (e.key === 'Escape') setAbierto(false) }
    document.addEventListener('mousedown', fuera); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', esc) }
  }, [abierto])
  const activa = vistas.find(v => mismaVista(v.f, actual))
  const puede = hayFiltro(actual, defecto) && !activa
  const guardarActual = () => { const r = agregarVista(vistas, nombre, actual); if (r.error) { setError(r.error); return } guardar(r.lista); setNombre(''); setError(null) }
  return (
    <span ref={caja} style={{ position: 'relative', display: 'inline-flex', marginLeft: 'auto' }}>
      <button type='button' onClick={() => setAbierto(o => !o)} aria-expanded={abierto} style={{ height: 26, padding: '0 11px', borderRadius: 20, border: `1px solid ${activa || abierto ? C.accent : C.border}`, background: activa ? C.azulBg : C.surface, color: C.accent, fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <SIcon n='star' s={12} c={C.accent} />{activa ? activa.nombre : 'Vistas'}{!activa && vistas.length > 0 && <span style={{ opacity: .7, fontVariantNumeric: 'tabular-nums' }}>{vistas.length}</span>}
      </button>
      {abierto && <div style={{ position: 'absolute', top: 32, right: 0, width: 'min(290px, calc(100vw - 32px))', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: '0 10px 30px rgba(0,60,80,.18)', padding: 8, zIndex: 30, textAlign: 'left' }}>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.06em', color: C.done, textTransform: 'uppercase', margin: '4px 6px' }}>Mis vistas</div>
        {vistas.length === 0 && <div style={{ fontSize: 12, color: C.muted, padding: '6px 8px' }}>Aún no guardas ninguna.</div>}
        {vistas.map(v => { const on = activa && activa.id === v.id; return (
          <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 8, background: on ? C.azulBg : 'transparent' }}>
            <button type='button' onClick={() => { onAplicar(v.f); setAbierto(false) }} style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 'none', background: 'none', padding: '8px', fontFamily: 'inherit', fontSize: 13, fontWeight: on ? 700 : 500, color: on ? C.accent : C.text, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.nombre}</button>
            <button type='button' aria-label={`Borrar la vista ${v.nombre}`} onClick={() => guardar(quitarVista(vistas, v.id))} style={{ border: 'none', background: 'none', color: C.done, fontSize: 16, cursor: 'pointer', padding: '4px 8px', lineHeight: 1 }}>×</button>
          </div>) })}
        <div style={{ borderTop: `1px solid ${C.bgSoft}`, marginTop: 6, paddingTop: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.06em', color: C.done, textTransform: 'uppercase', margin: '0 6px 6px' }}>Guardar la vista actual</div>
          {puede ? <>
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={nombre} onChange={e => { setNombre(e.target.value); setError(null) }} onKeyDown={e => { if (e.key === 'Enter') guardarActual() }} placeholder='Nombre de la vista' maxLength={40} style={{ flex: 1, minWidth: 0, border: `1px solid ${C.accent}`, borderRadius: 8, padding: '7px 9px', fontFamily: 'inherit', fontSize: 16, outline: 'none', color: C.text, background: C.surface }} />
              <button type='button' onClick={guardarActual} disabled={!nombre.trim()} style={{ border: 'none', borderRadius: 8, background: nombre.trim() ? C.accent : C.border, color: '#fff', fontWeight: 700, fontSize: 12, padding: '0 12px', cursor: nombre.trim() ? 'pointer' : 'default' }}>Guardar</button>
            </div>
            {resumen && <div style={{ fontSize: 11, color: C.muted, margin: '5px 2px 0' }}>{resumen}</div>}
            {error && <div style={{ fontSize: 11, color: C.overdueText, margin: '5px 2px 0' }}>{error}</div>}
          </> : <div style={{ fontSize: 12, color: C.muted, padding: '2px 6px 4px' }}>{activa ? 'Esta combinación ya está guardada.' : 'Ajusta los filtros y vuelve aquí para guardarlos.'}</div>}
        </div>
      </div>}
    </span>)
}
