// Descarga el Excel de gastos de un cliente (un libro por cliente): Resumen, Gastos (cada gasto con su OT, glosas completas, estado y fecha de pago) y Fondos.
import { cargarXlsx, guardarLibro } from './archivos.js'
import { hojasGastosCliente } from '../../supabase/functions/_shared/gastosClienteExcel.js'

const nombreArchivo = (/** @type {string} */ s) => String(s || 'Cliente').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w .-]/g, '').trim()

/** @param {{ cliente: any, expenses: any[], entidades?: any[], ventas?: any[], pagadoPor?: (e:any)=>string }} p */
export async function descargarGastosCliente(p) {
  const XLSX = await cargarXlsx(), h = hojasGastosCliente(p)
  const aHoja = (/** @type {any[][]} */ filas, /** @type {number[]} */ anchos, /** @type {boolean} */ filtro) => {
    const ws = XLSX.utils.aoa_to_sheet(filas.map(f => f.map((/** @type {any} */ c) => c && typeof c === 'object' ? { t: 'n', v: c.v, z: c.z } : c)))
    ws['!cols'] = anchos.map(w => ({ wch: w }))
    if (filtro && filas.length > 2) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: filas.length - 2, c: filas[0].length - 1 } }) }   // filtros sobre los gastos, sin la fila Total
    return ws
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, aHoja(h.resumen, [22, 46, 9, 14], false), 'Resumen')
  XLSX.utils.book_append_sheet(wb, aHoja(h.gastos, [13, 9, 54, 12, 12, 13, 18, 24, 15, 15, 20, 40, 24, 22, 22, 30, 26, 22, 18, 26, 15, 15, 30, 14, 13], true), 'Gastos')
  XLSX.utils.book_append_sheet(wb, aHoja(h.fondos, [13, 40, 40, 30, 14, 26, 22, 14], false), 'Fondos')
  await guardarLibro(XLSX, wb, `Gastos ${nombreArchivo(p.cliente?.name)}.xlsx`)
}
