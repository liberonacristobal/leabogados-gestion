// Sugerencias para «Cambiar cliente» de un abono del banco (Banco › detalle del movimiento). Funciones puras.
// (a) Clientes cuyo saldo en contra (gastos sin fondos: fgCliente, la misma regla de la app) calza EXACTO con el monto.
// (b) El último cliente al que se asignó este pagador (learning pagador_cliente por RUT o nombre; o, sin él, el último movimiento identificado del mismo pagador).
// Solo sugieren: la persona siempre confirma, nada se asigna solo.
import { fgCliente } from './gastosReglas.js'

const _nrm = (/** @type {any} */ s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()

/** Clave del pagador: su RUT sin puntos ni guion, o su nombre normalizado si no trae RUT. @param {{rut_contraparte?:any, nombre_contraparte?:any}} mov @returns {string} */
export function clavePagador(mov) {
  const rut = String((mov && mov.rut_contraparte) || '').replace(/[^0-9kK]/g, '').toLowerCase()
  if (rut) return 'rut:' + rut
  const nom = _nrm(mov && mov.nombre_contraparte)
  return nom ? 'nom:' + nom : ''
}

/**
 * @param {{ mov:any, clientIds:any[], expenses:any[], ultimoPagador?:Record<string,any>, historial?:{clave:string, cid:any, fecha?:string}[] }} o
 * @returns {{ cid:string, via:'monto'|'pagador', monto?:number }[]}  hasta 2 por monto exacto y 1 por pagador; sin repetir ni sugerir el cliente actual.
 */
export function sugerenciasCliente({ mov, clientIds, expenses, ultimoPagador = {}, historial = [] }) {
  if (!mov) return []
  const monto = Number(mov.monto) || 0, actual = mov.cliente_id == null ? '' : String(mov.cliente_id)
  /** @type {{cid:string, via:'monto'|'pagador', monto?:number}[]} */ const out = []
  if (monto > 0) {
    for (const id of clientIds || []) {
      const cid = String(id)
      if (cid === actual) continue
      const enContra = -fgCliente(expenses, id).saldo   // gastos sin fondos = saldo en contra del cliente (fondos − gastos)
      if (Math.abs(enContra - monto) < 1) out.push({ cid, via: 'monto', monto: enContra })
      if (out.length >= 2) break
    }
  }
  const clave = clavePagador(mov)
  if (clave) {
    let ult = ultimoPagador[clave]
    if (ult == null) { const h = (historial || []).filter((x) => x.clave === clave && x.cid != null && String(x.cid) !== '').sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || ''))); ult = h.length ? h[0].cid : null }
    if (ult != null && String(ult) !== actual && !out.some((x) => x.cid === String(ult))) out.push({ cid: String(ult), via: 'pagador' })
  }
  return out
}

/**
 * Inverso de planReasignacionFondos: con los fondos tal como estaban ANTES del cambio, el parche de cada uno para devolverlo a su cliente, razón social, venta y proyecto.
 * @param {any[]} filasAntes @returns {{ id:string, patch:{client_id:any, entity_id:any, sale_id:any, project:any, subproject:any} }[]}
 */
export function planReversaFondos(filasAntes) {
  return (filasAntes || []).filter(Boolean).map((e) => ({ id: String(e.id), patch: { client_id: e.client_id ?? null, entity_id: e.entity_id ?? null, sale_id: e.sale_id ?? null, project: e.project ?? null, subproject: e.subproject ?? null } }))
}
