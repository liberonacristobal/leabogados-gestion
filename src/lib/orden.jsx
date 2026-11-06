import { useState, useMemo } from 'react'
import { C, SIcon } from './base.jsx'
import { ordenarFilas, siguienteOrden, rangoIds, aplicarRango } from './ordenar.js'

// Encabezado ordenable: un toque ordena, otro invierte y otro vuelve al orden original. Con estado propio (useOrden) o ajeno (orden/setOrden).
export function ThOrden({ etiqueta, orden, setOrden, estilo, ...extra }) {
  const on = orden && orden.k === etiqueta
  return (
    <th {...extra} onClick={() => setOrden(o => siguienteOrden(o, etiqueta))} aria-sort={on ? (orden.d === 1 ? 'ascending' : 'descending') : 'none'} title='Ordenar'
      style={{ ...estilo, cursor: 'pointer', userSelect: 'none' }}>
      {etiqueta}<span style={{ display: 'inline-flex', verticalAlign: 'middle', marginLeft: 4, opacity: on ? 1 : 0, color: C.muted }}><SIcon n={on && orden.d === -1 ? 'chevD' : 'chevU'} s={10} c={C.muted} /></span>
    </th>)
}

// Columnas ordenables: useOrden(filas, { 'Etiqueta': fila => valor }) devuelve las filas ordenadas y th(etiqueta, estilo) para el encabezado.
// Una etiqueta sin accesor queda como encabezado normal.
export function useOrden(filas, accesores) {
  const [orden, setOrden] = useState(null)
  const ordenadas = useMemo(() => ordenarFilas(filas, orden, accesores), [filas, orden]) // eslint-disable-line react-hooks/exhaustive-deps
  const th = (etiqueta, estilo, extra = {}) => (accesores && accesores[etiqueta])
    ? <ThOrden key={etiqueta} etiqueta={etiqueta} orden={orden} setOrden={setOrden} estilo={estilo} {...extra} />
    : <th key={etiqueta} style={estilo} {...extra}>{etiqueta}</th>
  return { filas: ordenadas, th, orden }
}

// Selección por rango con Shift en listas con casillas. Cada casilla (o fila) lleva selAttrs(lista, id); alternarSel(ult, lista, id, ev, setSel) marca o desmarca
// las filas visibles entre la última tocada (ult = useRef) y la actual, en el orden de la pantalla. Sin Shift, alterna solo la tocada.
// Con data-sel-tope / data-sel-usado / data-sel-monto en la fila, el rango respeta ese tope (fondo del cliente en Notaría).
export const selAttrs = (lista, id) => ({ 'data-sel': lista, 'data-sel-id': String(id), onMouseDown: e => { if (e.shiftKey) e.preventDefault() } })
export function alternarSel(ult, lista, id, ev, setSel) {
  const shift = !!(ev && (ev.shiftKey || (ev.nativeEvent && ev.nativeEvent.shiftKey)))
  const els = shift && ult.current != null ? [...document.querySelectorAll(`[data-sel="${lista}"]`)] : []
  let rango = els.length ? rangoIds(els.map(e => e.getAttribute('data-sel-id')), String(ult.current), String(id)) : null
  if (rango && rango.length < 2) rango = null
  ult.current = id
  setSel(prev => {
    if (!rango) { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n }
    const info = new Map(els.map(e => { const t = e.getAttribute('data-sel-tope'); return [e.getAttribute('data-sel-id'), { tope: t == null || t === '' ? null : Number(t), usado: Number(e.getAttribute('data-sel-usado')) || 0, monto: Number(e.getAttribute('data-sel-monto')) || 0 }] }))
    return aplicarRango(prev, rango, id, info)
  })
}
