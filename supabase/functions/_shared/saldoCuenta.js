// Saldo actual de una cuenta del banco = saldo final de la última cartola con saldo + los movimientos que llegaron después de ella.
// «Después» incluye los del mismo día de corte que se cargaron más tarde (traspasos y avisos del banco): caso real del 20-11-2026,
// el saldo de la cartola ($46.915.850) más tres traspasos internos cargados después ($3.026.745) calza al peso con el banco ($49.942.595).
const _dia = (/** @type {any} */ v) => String(v || '').slice(0, 10)

/**
 * @param {{saldo_final?: any, fecha_hasta?: any, created_at?: any}} cartola última cartola con saldo
 * @param {{tipo?: string, monto?: any, fecha?: any, created_at?: any}[]} movs movimientos de la cuenta (basta con los de la fecha de corte en adelante)
 * @returns {{saldo: number, al: string, n: number}}
 */
export function saldoActualCuenta(cartola, movs) {
  const hasta = _dia(cartola && cartola.fecha_hasta), cre = String((cartola && cartola.created_at) || '')
  let saldo = Number(cartola && cartola.saldo_final) || 0, al = hasta, n = 0
  for (const m of movs || []) {
    const f = _dia(m && m.fecha)
    const despues = f > hasta || (f === hasta && cre !== '' && String(m.created_at || '') > cre)
    if (!despues) continue
    const x = Number(m.monto) || 0
    saldo += m.tipo === 'abono' ? x : -x; n++
    if (f > al) al = f
  }
  return { saldo, al, n }
}
