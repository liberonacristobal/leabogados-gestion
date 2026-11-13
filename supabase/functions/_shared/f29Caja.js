// «Pago al SII (F29)» de la caja del año: lo que se pagó al SII en el año, por FECHA DE PAGO, tomado del F29 declarado de cada período (f29_declarados).
// El F29 trae tres partes: PPM, impuesto único de trabajadores y retención de honorarios. En la caja del año cuentan PPM + impuesto único: la retención ya está dentro
// del honorario BRUTO de «Costos reales» (a quien emite boleta se le cuenta el bruto), así que sumarla otra vez la contaría dos veces. Se muestra como dato.
// Sin F29 declarado para el período, cuenta el monto del gasto registrado (todo como PPM). Funciones puras.

/** @typedef {{ppm?:any, impuesto_unico?:any, retencion_bhe?:any, total?:any}} F29Decl */

const n = (/** @type {any} */ x) => Number(x) || 0

/** Período (AAAA-MM) que nombra el concepto de un gasto de F29 («IVA/PPM 09-2026 …»), o null. @param {any} concepto */
export function periodoDeConceptoF29(concepto) {
  const m = String(concepto || '').match(/(\d{2})-(\d{4})/)
  return m ? `${m[2]}-${m[1]}` : null
}

/**
 * @param {{id?:any, date?:string, amount?:any, concept?:string|null}[]} gastosF29 gastos de la oficina de «Impuestos y patentes» con subcategoría PPM (el pago al SII)
 * @param {Record<string, F29Decl>} declarados F29 declarados por período
 * @param {number} anio @param {number} maxMes último mes de pago que cuenta (1 a 12)
 * @returns {{total:number, ppm:number, unico:number, ret:number, sinDeclarar:number, items:{id:any, fecha:string, periodo:string|null, ppm:number, unico:number, ret:number, monto:number, registrado:number, declarado:boolean}[]}}
 */
export function f29CajaDelAnio(gastosF29, declarados, anio, maxMes) {
  const items = []
  ;(gastosF29 || []).forEach(e => {
    const f = String(e.date || '').slice(0, 10), y = Number(f.slice(0, 4)), m = Number(f.slice(5, 7))
    if (y !== anio || m > maxMes) return
    const periodo = periodoDeConceptoF29(e.concept), d = periodo ? (declarados || {})[periodo] : null
    if (d && (n(d.total) > 0 || n(d.ppm) > 0)) items.push({ id: e.id, fecha: f, periodo, ppm: n(d.ppm), unico: n(d.impuesto_unico), ret: n(d.retencion_bhe), monto: n(d.ppm) + n(d.impuesto_unico), registrado: n(e.amount), declarado: true })
    else items.push({ id: e.id, fecha: f, periodo, ppm: n(e.amount), unico: 0, ret: 0, monto: n(e.amount), registrado: n(e.amount), declarado: false })
  })
  items.sort((a, b) => a.fecha.localeCompare(b.fecha))
  const sum = (/** @type {(x:any)=>number} */ g) => items.reduce((a, x) => a + g(x), 0)
  return { total: sum(x => x.monto), ppm: sum(x => x.ppm), unico: sum(x => x.unico), ret: sum(x => x.ret), sinDeclarar: sum(x => (x.declarado ? 0 : x.monto)), items }
}
