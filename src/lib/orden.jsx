import { useState, useMemo } from 'react'
import { C, SIcon } from './base.jsx'
import { ordenarFilas, siguienteOrden } from './ordenar.js'

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
