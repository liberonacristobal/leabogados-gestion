// Reglas de la carga de XML del SII (sii_cargas_docs). Funciones puras, con prueba en tests/.

/**
 * La carga guarda lo no registrado como 'sin_registrar'. Una fila que ya pasó a factura ('registrada') no se vuelve a pisar:
 * pasaba cuando la vista tenía la lista de facturas desactualizada y el folio ya existía (la factura 514 volvió a «Por registrar»).
 * @param {Array<{folio:string, tipo_dte?:number}>} stage filas a guardar
 * @param {Array<{folio:string, tipo_dte?:number, estado?:string}>} existentes filas ya guardadas con esos folios
 */
export function sinPisarRegistradas(stage, existentes = []) {
  const llave = (/** @type {{folio:string, tipo_dte?:number}} */ r) => `${String(r.folio)}|${Number(r.tipo_dte) || 33}`
  const registradas = new Set((existentes || []).filter((e) => e && e.estado === 'registrada').map(llave))
  return (stage || []).filter((s) => !registradas.has(llave(s)))
}
