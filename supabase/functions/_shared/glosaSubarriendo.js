// Glosa del DTE de una factura de subarriendo. Es configuración del estudio (learnings kind 'config', key 'glosa_dte_subarriendo'); sin ella rige el valor por defecto.
// REGLA: la app reconoce una factura de subarriendo por su VÍNCULO (billing_type, venta de subarriendo, sale_id), NUNCA por el texto de la glosa: la glosa del SII
// no dice «subarriendo» (p. ej. la F514 dice «Servicios legales — Asesoría Laboral …» y está ligada al billing de subarriendo). El `concept` interno puede seguir diciendo Subarriendo.
import { periodoDeTexto } from './facturacionReglas.js'

export const GLOSA_DTE_SUBARRIENDO_DEFECTO = 'Servicios legales — Asesoría Laboral {mes} {año}'
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

/**
 * Texto del ítem del DTE de una factura de subarriendo. Mes y año: los del concepto interno («… — Mensual Octubre 2026»); si no los trae, los del vencimiento.
 * @param {{concept?:string|null, due?:string|null}} b @param {string|null} [plantilla] con {mes} y {año}
 */
export function glosaDteSubarriendo(b, plantilla) {
  const p = periodoDeTexto(String(b?.concept || ''))
  const d = b?.due ? new Date(String(b.due).slice(0, 10) + 'T12:00:00Z') : null
  const mes = p.mes != null ? p.mes : d && !isNaN(+d) ? d.getUTCMonth() : null
  const anio = p.anio != null ? p.anio : d && !isNaN(+d) ? d.getUTCFullYear() : null
  const t = String(plantilla || '').trim() || GLOSA_DTE_SUBARRIENDO_DEFECTO
  return t.replace('{mes}', mes != null ? MESES[mes] : '').replace('{año}', anio != null ? String(anio) : '').replace(/\s+/g, ' ').trim().slice(0, 80)
}
