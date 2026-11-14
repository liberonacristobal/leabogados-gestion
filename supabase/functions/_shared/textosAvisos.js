// Textos de los avisos de venta (una sola redacción para Revisión de datos y la página de la venta). Funciones puras.
import { pesos } from './estadoComisiones.js'

const folio = (/** @type {any} */ no) => String(no || '').replace(/^factura\s*/i, '').trim()
/** UF con hasta dos decimales y coma. @param {any} x */
export const ufTxt = x => String(Number((Number(x) || 0).toFixed(2))).replace('.', ',')

/** Factura mensual mayor que su venta (una subida de tarifa que no llegó a la venta). @param {{factura:any, mensual:number, factura_en:number, enUF:boolean}} x */
export const avisoTarifa = x => x.enUF
  ? `Factura N° ${folio(x.factura.invoice_no)}: ${ufTxt(x.factura_en)} UF, la venta dice ${ufTxt(x.mensual)} UF al mes`
  : `Factura N° ${folio(x.factura.invoice_no)}: ${pesos(x.factura_en)}, la venta dice ${pesos(x.mensual)} al mes`

/** Factura emitida sin la comisión del colaborador. @param {{factura:any, proveedor?:string, monto:number}} x */
export const avisoComision = x => `Factura N° ${folio(x.factura.invoice_no)}: falta la comisión de ${x.proveedor || 'el colaborador'}, ${pesos(x.monto)}`

/** Pregunta antes de registrar la comisión. @param {{factura:any, proveedor?:string, monto:number}} x */
export const confirmaComision = x => `¿Registrar la comisión de ${pesos(x.monto)} a ${x.proveedor || 'el colaborador'} en la factura N° ${folio(x.factura.invoice_no)}?`
