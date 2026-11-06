import { useState, useRef, useEffect, useCallback } from 'react'
import { C, SIcon, appAlert, useIsDesktop } from './base.jsx'
import { alternarSel, selAttrs } from './orden.jsx'

// Selección en lote (Clientes, Ventas, Cobranza, Facturas): un solo molde. useSeleccion lleva el estado (con Shift marca un rango, Esc limpia),
// Casilla es la casilla de cada fila y BarraSeleccion la barra con total, Limpiar y las acciones. Una acción que escribe datos pide confirmación en la
// misma barra (acción con `confirmar`); las de solo lectura no preguntan. Ninguna acción de aquí envía correos.
export function useSeleccion(lista) {
  const isDesk = useIsDesktop()
  const [sel, setSel] = useState(() => new Set())
  const [modo, setModo] = useState(false)   // celular: las casillas aparecen con «Seleccionar» y se van con «Listo»
  const ult = useRef(null)
  const limpiar = useCallback(() => { setSel(new Set()); ult.current = null }, [])
  useEffect(() => {
    if (!sel.size) return
    const f = e => { if (e.key === 'Escape') limpiar() }
    window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f)
  }, [sel.size, limpiar])
  const visible = isDesk || modo
  return {
    lista, sel, n: sel.size, has: id => sel.has(id), limpiar, visible, modo, setModo,
    toggle: (id, ev) => alternarSel(ult, lista, id, ev, setSel),
    attrs: id => selAttrs(lista, id),
    marcar: ids => setSel(new Set(ids)),
    todos: ids => ids.length > 0 && ids.every(i => sel.has(i)),
    alternarTodos: ids => setSel(p => ids.length > 0 && ids.every(i => p.has(i)) ? new Set() : new Set(ids)),
    salir: () => { setModo(false); limpiar() },
  }
}

export const Casilla = ({ s, id, on, onToggle, style }) => (
  <input type='checkbox' {...(id != null ? s.attrs(id) : {})} checked={!!on} onClick={e => e.stopPropagation()} onChange={onToggle || (ev => s.toggle(id, ev))}
    style={{ width: 16, height: 16, accentColor: C.accent, cursor: 'pointer', flexShrink: 0, margin: 0, ...style }} />
)

// Botón «Seleccionar» / «Listo» del celular (junto al buscador).
export const BtnSeleccionar = ({ s }) => {
  const on = s.modo
  return <button onClick={() => on ? s.salir() : s.setModo(true)} style={{ height: 34, padding: '0 13px', borderRadius: 9, border: `1px solid ${on ? C.accent : C.border}`, background: on ? C.accent : C.surface, color: on ? '#fff' : C.accent, fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}>{on ? 'Listo' : 'Seleccionar'}</button>
}

const cap = (n, un) => `${n} ${n === 1 ? un[0] : un[1]}`
const btnBar = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: '#fff', color: C.accent, border: 'none', borderRadius: 8, padding: '6px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', minHeight: 30 }

// acciones: [{ ic, label, corto?, onClick, confirmar?:{titulo,detalle}, opciones?:[{label,value}] }]
// Con `opciones` el botón abre una lista; al elegir se llama onClick(value) (tras confirmar, si hay `confirmar(value)` como función).
export function BarraSeleccion({ s, n: nProp, unidad = ['seleccionado', 'seleccionados'], total, acciones = [] }) {
  const isDesk = useIsDesktop()
  const [pend, setPend] = useState(null)   // {titulo,detalle,ok}
  const [menu, setMenu] = useState(null)   // índice de la acción con lista abierta
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 2600); return () => clearTimeout(t) }, [msg])
  const n = nProp ?? s.n
  if (!n && !msg) return null
  const correr = async (fn, ok) => {
    setBusy(true)
    try { const r = await fn(); if (ok !== false) setMsg(typeof r === 'string' ? r : null) } catch (e) { appAlert('No se pudo completar: ' + (e?.message || e)) }
    setBusy(false)
  }
  const lanzar = (a, valor) => {
    setMenu(null)
    const conf = typeof a.confirmar === 'function' ? a.confirmar(valor) : a.confirmar
    if (conf) setPend({ ...conf, ok: () => { setPend(null); correr(() => a.onClick(valor)) } })
    else correr(() => a.onClick(valor))
  }
  // Celular: la página corre en la ventana (no en #main-scroll), así que un sticky no se pegaría; la barra va fija sobre la barra de pestañas.
  const caja = { background: C.accent, color: '#fff', borderRadius: 10, padding: '9px 12px', zIndex: 30, ...(isDesk ? { position: 'sticky', top: 8, marginBottom: 10 } : { position: 'fixed', left: 'max(12px, env(safe-area-inset-left, 0px))', right: 'max(12px, env(safe-area-inset-right, 0px))', bottom: 'calc(68px + env(safe-area-inset-bottom, 0px))', boxShadow: '0 6px 18px rgba(0,60,80,.28)' }) }
  if (!n) return <div style={{ ...caja, fontSize: 13, fontWeight: 700 }}>{msg}</div>
  if (pend) return (
    <div style={{ ...caja, background: C.surface, color: C.text, border: `1px solid ${C.border}`, boxShadow: '0 4px 14px rgba(0,60,80,.14)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 240px', minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 700, color: C.accent }}>{pend.titulo}</div>{pend.detalle && <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{pend.detalle}</div>}</div>
      <span onClick={() => setPend(null)} style={{ fontSize: 12, fontWeight: 700, color: C.muted, cursor: 'pointer' }}>Cancelar</span>
      <button onClick={pend.ok} style={{ ...btnBar, background: C.accent, color: '#fff' }}>Confirmar</button>
    </div>)
  return (
    <div style={{ ...caja, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <b style={{ fontSize: 13, fontWeight: 700 }}>{cap(n, unidad)}</b>
      {total && <span style={{ fontSize: 12, opacity: .8 }}>{total}</span>}
      {msg && <span style={{ fontSize: 12, fontWeight: 700, color: '#BFE8D6' }}>{msg}</span>}
      <span onClick={s.limpiar} style={{ fontSize: 11, opacity: .75, cursor: 'pointer', whiteSpace: 'nowrap', marginLeft: 'auto' }}>Limpiar</span>
      <div style={{ display: 'flex', gap: 6, flexWrap: isDesk ? 'nowrap' : 'wrap', flex: isDesk ? '0 0 auto' : '1 1 100%', marginLeft: isDesk ? 6 : undefined }}>
        {acciones.map((a, i) => (
          <div key={a.label} style={{ position: 'relative', flex: isDesk ? undefined : 1, display: 'flex' }}>
            <button disabled={busy} onClick={() => a.opciones ? setMenu(menu === i ? null : i) : lanzar(a)} style={{ ...btnBar, flex: 1, opacity: busy ? .6 : 1 }}>
              {a.ic && <SIcon n={a.ic} s={13} c={C.accent} />}{isDesk || !a.corto ? a.label : a.corto}{a.opciones ? ' ▾' : ''}
            </button>
            {a.opciones && menu === i && (
              <div style={{ position: 'absolute', right: 0, top: isDesk ? 'calc(100% + 4px)' : undefined, bottom: isDesk ? undefined : 'calc(100% + 4px)', minWidth: 170, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: '0 6px 18px rgba(0,60,80,.18)', overflow: 'hidden', zIndex: 20 }}>
                {a.opciones.map(o => <div key={o.label} onClick={() => lanzar(a, o.value)} className='lf-row' style={{ padding: '9px 13px', fontSize: 13, color: C.text, cursor: 'pointer', borderTop: `1px solid ${C.bgSoft}` }}>{o.label}</div>)}
              </div>)}
          </div>))}
      </div>
    </div>)
}

// Copiar al portapapeles (devuelve el aviso corto que muestra la barra).
export async function copiarTexto(txt, aviso = 'Copiado') {
  try { await navigator.clipboard.writeText(String(txt)); return aviso } catch (_) { appAlert('No se pudo copiar al portapapeles.'); return false }
}

// Excel de lo elegido: head = encabezados, filas = arreglo de arreglos, numCols = índices con formato de pesos.
export async function descargarXlsx({ nombre, hoja, head, filas, anchos = [], numCols = [], fmtNum = '#,##0' }) {
  try {
    const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs')
    const ws = XLSX.utils.aoa_to_sheet([head, ...filas])
    ws['!cols'] = head.map((_, i) => ({ wch: anchos[i] || 14 }))
    ws['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(head.length - 1)}${filas.length + 1}` }; ws['!views'] = [{ state: 'frozen', ySplit: 1 }]
    for (let r = 1; r <= filas.length; r++) numCols.forEach(cc => { const cell = ws[XLSX.utils.encode_cell({ r, c: cc })]; if (cell && cell.t === 'n') cell.z = fmtNum })
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, hoja)
    XLSX.writeFile(wb, `${nombre}_${new Date().toISOString().slice(0, 10)}.xlsx`)
    return 'Excel descargado'
  } catch (e) { appAlert('No se pudo generar el Excel: ' + e.message); return false }
}
