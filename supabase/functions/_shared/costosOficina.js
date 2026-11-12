// Costo de oficina mensual NETO: bruto − subarriendo y gastos recuperados. Los ítems `es_ingreso` (el subarriendo, un monto fijo mensual que la oficina recibe) son un MENOR COSTO de oficina, nunca un ingreso:
// no suman a ingresos ni a facturado y no se cuentan dos veces. Fuente única de resultadoMes, Oficina, Horas, Inicio (overhead por hora), Counsel AI y lo que consuma serie.cos.
// Cada ítem vale su `monto` o, antes de su fecha `desde`, su `monto_prev` (reajustes por mes): el monto recurrente del mes, no el calendario de la factura.

/** Nombre genérico de la partida cuando el estudio no le puso uno propio. */
export const TXT_RECUPERADO = 'Subarriendo y gastos recuperados'

/** Valor vigente de un ítem en el mes `ym` («aaaa-mm»). @param {any} r @param {string} ym */
export const valorVigenteCosto = (r, ym) => { const v = (r && r.desde && ym < String(r.desde).slice(0, 7)) ? (r.monto_prev ?? r.monto) : r && r.monto; return Number(v) || 0 }   // `monto_prev` nulo con `desde`: antes de esa fecha vale el monto actual (como el resto de la app)

const _mes = (/** @type {string|undefined} */ ym) => (/^\d{4}-\d{2}/.test(String(ym || '')) ? String(ym).slice(0, 7) : new Date().toISOString().slice(0, 7))   // mes inválido: el mes actual
const _cuenta = (/** @type {any} */ r, /** @type {{ excluirCategorias?:string[], soloCategoria?:string }} */ o) => !!r && r.activo !== false && !(o.excluirCategorias || []).includes(r.categoria) && (o.soloCategoria == null || r.categoria === o.soloCategoria)

/** Costo de oficina BRUTO del mes: los ítems que no son ingreso (el flujo de caja lo usa: el subarriendo entra allí por su cobro). @param {any[]} rows @param {string} [ym] @param {{ excluirCategorias?:string[], soloCategoria?:string }} [o] */
export function costoOficinaBruto(rows, ym, o = {}) {
  const mes = _mes(ym)
  return (rows || []).reduce((/** @type {number} */ a, r) => (_cuenta(r, o) && !r.es_ingreso ? a + valorVigenteCosto(r, mes) : a), 0)
}

/** Subarriendo y gastos recuperados del mes (los ítems `es_ingreso`), en positivo: es el menor costo. @param {any[]} rows @param {string} [ym] @param {{ excluirCategorias?:string[], soloCategoria?:string }} [o] */
export function recuperadoOficinaMes(rows, ym, o = {}) {
  const mes = _mes(ym)
  return (rows || []).reduce((/** @type {number} */ a, r) => (_cuenta(r, o) && r.es_ingreso ? a + valorVigenteCosto(r, mes) : a), 0)
}

/** Costo de oficina NETO del mes = bruto − recuperado. @param {any[]} rows @param {string} [ym] @param {{ excluirCategorias?:string[], soloCategoria?:string }} [o] */
export const costoOficinaNeto = (rows, ym, o = {}) => costoOficinaBruto(rows, ym, o) - recuperadoOficinaMes(rows, ym, o)

/** Rótulo de la partida: el nombre del ítem del estudio si es uno solo (tal como está en los datos); si no, el genérico. @param {any[]} rows */
export function etiquetaRecuperado(rows) {
  const nombres = [...new Set((rows || []).filter((r) => r && r.es_ingreso && String(r.item || '').trim()).map((r) => String(r.item).trim()))]
  return nombres.length === 1 ? nombres[0] : TXT_RECUPERADO
}

/**
 * ¿La planilla del mes se puede usar? Una planilla cerrada siempre. Una sin cerrar solo si trae remuneraciones (sueldos u honorarios, o pagos de sueldos en el banco): sin ellas es un borrador a medio llenar
 * (p. ej. solo el arriendo) y el mes se calcula con el presupuesto de oficina hasta que cierre. @param {any} row @param {{ remBanco?:number }} [o]
 */
export function planillaUsable(row, o = {}) {
  if (!row) return false
  if (row.cerrado) return true
  return (Number(row.sueldos) || 0) + (Number(row.honorarios) || 0) + (Number(o.remBanco) || 0) > 0
}

/** ¿El documento es una factura de subarriendo o una nota de crédito que apunta a una? No suma ni resta honorarios: el subarriendo no es ingreso. @param {any} b @param {Record<string,any>} [bById] */
export function docDeSubarriendo(b, bById = {}) {
  if (!b) return false
  if (b.billing_type === 'subarriendo') return true
  const ref = b.nc_ref_billing_id != null ? bById[String(b.nc_ref_billing_id)] : null
  return !!ref && ref.billing_type === 'subarriendo'
}

/**
 * Costo de operación BRUTO de un mes de `resultadoMes` (para el flujo de caja): su `cos` ya viene NETO del subarriendo (línea `sub` negativa), así que se suma de vuelta, porque el subarriendo entra al flujo por su cobro;
 * restarlo también del costo lo contaría dos veces. `ppm` se suma aparte (anticipo de impuesto). @param {{ cos?:number, sub?:number, ppm?:number }} r
 */
export const costoOperacionBruto = (r) => (Number(r && r.cos) || 0) + (Number(r && r.sub) || 0) + (Number(r && r.ppm) || 0)

// Alerta de caja del mes anterior: lo que entró al banco (incluye los depósitos de subarriendo) contra el costo BRUTO de la oficina (cos neto + subarriendo), sin PPM.
export const cajaContraCosto = (entra, r) => {
  const e = Number(entra) || 0
  const cuesta = (Number(r && r.cos) || 0) + (Number(r && r.sub) || 0)
  const cuestaUF = (Number(r && r.cosUF) || 0) + (Number(r && r.subUF) || 0)
  return { alerta: e > 0 && e < cuesta, cuesta, cuestaUF, falta: cuesta - e }
}
