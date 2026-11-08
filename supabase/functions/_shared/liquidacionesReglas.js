// Liquidaciones de sueldo leídas del correo de la contadora: de cada (período, persona) manda la versión MÁS RECIENTE del correo, porque ella reenvía
// corregidas. Función pura: no lee ni escribe la base.

/**
 * @param {{periodo:string, persona:string, _t?:number}[]} filas liquidaciones leídas, en cualquier orden; _t = fecha del correo (ms)
 * @returns {Record<string, any>[]} una por (período, persona), ordenadas por período, sin el campo _t
 */
export function liquidacionesVigentes(filas) {
  const unico = new Map()
  for (const f of [...(filas || [])].sort((a, b) => (a._t || 0) - (b._t || 0))) unico.set(`${f.periodo}|${f.persona}`, f)   // la más reciente pisa a la anterior
  return [...unico.values()].map(({ _t, ...f }) => f).sort((a, b) => String(a.periodo).localeCompare(String(b.periodo)) || String(a.persona).localeCompare(String(b.persona)))
}

/**
 * Cotizaciones provisorias de un mes, mientras la contadora no manda sus valores: cotizaciones del trabajador de las liquidaciones del mes más la parte
 * del empleador del último mes con valores reales (cotización real − la del trabajador), proporcional al imponible.
 * @param {{mes:{imponible:number, cotizaciones:number}[], previo:{imponible:number, cotizaciones:number}[], cotizPrevReal:number}} p
 * @returns {{cotizaciones:number, tasaEmpleador:number, trabajador:number, empleador:number}|null} null si falta algún dato (no se inventa)
 */
export function cotizacionesProvisorias({ mes, previo, cotizPrevReal }) {
  const suma = (/** @type {any[]} */ a, /** @type {string} */ k) => (a || []).reduce((s, x) => s + (Number(x && x[k]) || 0), 0)
  const impMes = suma(mes, 'imponible'), trabMes = suma(mes, 'cotizaciones'), impPrev = suma(previo, 'imponible'), trabPrev = suma(previo, 'cotizaciones')
  if (!(impMes > 0) || !(trabMes > 0) || !(impPrev > 0) || !(Number(cotizPrevReal) > 0)) return null
  const empPrev = Number(cotizPrevReal) - trabPrev
  if (!(empPrev >= 0)) return null
  const tasaEmpleador = empPrev / impPrev, empleador = tasaEmpleador * impMes
  return { cotizaciones: Math.round(trabMes + empleador), tasaEmpleador, trabajador: trabMes, empleador: Math.round(empleador) }
}

const sinTild = (/** @type {any} */ s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const tokens = (/** @type {any} */ s) => sinTild(s).split(/[^a-zñ]+/).filter(t => t.length >= 3)
/** Líquido de una liquidación: imponible − cotizaciones del trabajador − impuesto único. @param {{imponible:number, cotizaciones:number, impuesto_unico:number}} l */
export const liquidoDe = l => (Number(l.imponible) || 0) - (Number(l.cotizaciones) || 0) - (Number(l.impuesto_unico) || 0)
/** ¿La persona de una liquidación («APELLIDO APELLIDO NOMBRE») es la de una línea del presupuesto o gasto («Nombre Apellido»)? Todas las palabras del nombre corto están en el largo. */
export function mismaPersona(/** @type {string} */ corto, /** @type {string} */ largo) { const a = tokens(corto), b = new Set(tokens(largo)); return a.length > 0 && a.every(t => b.has(t)) }

/**
 * A qué persona corresponde un pago de sueldo del banco. (1) El monto es el líquido de UNA sola liquidación del mes; (2) si no, el monto es exactamente el sueldo
 * presupuestado de UNA sola persona y el destino de la transferencia (texto que termina en « a <inicio del nombre>») es compatible con ella.
 * @param {{amount:number, concept?:string}} pago
 * @param {{persona:string, imponible:number, cotizaciones:number, impuesto_unico:number}[]} liquidaciones las del mes trabajado
 * @param {{item:string, monto:number}[]} presupuesto líneas de Remuneraciones
 * @returns {string|null} nombre largo de la persona (liquidación o línea del presupuesto), o null si no es único
 */
export function personaDelPago(pago, liquidaciones, presupuesto) {
  const m = Math.round(Number(pago.amount) || 0); if (!(m > 0)) return null
  const porLiq = (liquidaciones || []).filter(l => Math.round(liquidoDe(l)) === m)
  if (porLiq.length === 1) return porLiq[0].persona
  if (porLiq.length > 1) return null
  const porPpto = (presupuesto || []).filter(r => Math.round(Number(r.monto) || 0) === m)
  if (porPpto.length !== 1) return null
  const partes = String(pago.concept || '').split(/ a (?=[^ ]+[^]*$)/i); if (partes.length < 2) return null
  const destino = tokens(partes.pop()), nombre = tokens(porPpto[0].item)   // lo que sigue a la última « a » del concepto: el destinatario
  return nombre.some(t => destino.some(d => t.startsWith(d) || d.startsWith(t))) ? porPpto[0].item : null
}

/**
 * Presupuesto de oficina por persona desde la última liquidación: Remuneraciones = líquido; Leyes sociales = cotizaciones del trabajador + parte del empleador
 * (tasa sobre el imponible). Con vigencia desde el mes de la liquidación (monto_prev conserva lo anterior). Solo cambia lo que difiere un 2 % o más.
 * @param {{periodo:string, liquidaciones:{persona:string, imponible:number, cotizaciones:number, impuesto_unico:number}[], tasaEmpleador:number|null,
 *   filas:{id:string, categoria:string, item:string, monto:number, monto_prev:number|null, desde:string|null}[]}} p
 * @returns {{id:string, categoria:string, item:string, monto:number, monto_prev:number, desde:string, antes:number}[]}
 */
export function presupuestoDesdeLiquidaciones({ periodo, liquidaciones, tasaEmpleador, filas }) {
  const desde = `${periodo}-01`, out = []
  for (const f of filas || []) {
    if (f.categoria !== 'Remuneraciones' && f.categoria !== 'Leyes sociales') continue
    const l = (liquidaciones || []).filter(x => mismaPersona(f.item, x.persona))
    if (l.length !== 1) continue
    const nuevo = f.categoria === 'Remuneraciones' ? liquidoDe(l[0]) : (tasaEmpleador == null ? NaN : (Number(l[0].cotizaciones) || 0) + tasaEmpleador * (Number(l[0].imponible) || 0))
    if (!(nuevo > 0)) continue
    const actual = Number(f.monto) || 0, n = Math.round(nuevo)
    if (actual > 0 && Math.abs(n - actual) / actual < 0.02) continue
    const d0 = f.desde ? String(f.desde).slice(0, 10) : null
    if (d0 && d0 !== desde) continue                     // un cambio posterior o un historial previo (la tabla guarda un solo valor anterior): no se pisa
    out.push({ id: f.id, categoria: f.categoria, item: f.item, monto: n, monto_prev: d0 === desde ? (Number(f.monto_prev) || 0) : actual, desde, antes: actual })
  }
  return out
}
