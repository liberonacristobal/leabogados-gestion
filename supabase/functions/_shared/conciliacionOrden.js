// Orden cronológico de las conciliaciones manuales: cuando un pago del banco se aplica a una factura y el mismo cliente tiene otra factura SIN PAGAR del mismo monto y más antigua,
// lo habitual es pagar primero la más antigua (caso real: dos facturas de $107.310 y dos depósitos iguales quedaron cruzados). Regla pura y única; no lee ni escribe la base.

const _n = (/** @type {any} */ x) => { const v = Number(x); return Number.isFinite(v) ? v : 0 }
const _fecha = (/** @type {any} */ f) => String((f && (f.issued_at || f.due)) || '').slice(0, 10)

/**
 * Factura más antigua del mismo cliente con el mismo saldo que la elegida y aún con saldo por pagar; null si no hay.
 * @param {{ facturas:any[], elegida:any, saldoDe:(f:any)=>number, tol?:number }} o  `facturas` = pool de facturas del cliente; `saldoDe` = la función de saldo de la app.
 * @returns {any|null}
 */
export function facturaMasAntiguaIgual({ facturas, elegida, saldoDe, tol = 0 }) {
  const fe = _fecha(elegida), se = saldoDe(elegida)
  if (!elegida || !fe || !(se > 0)) return null
  const mas = (facturas || []).filter((f) => f && f.id !== elegida.id && f.status !== 'Anulada' && !f.deleted_at && _fecha(f) && _fecha(f) < fe && saldoDe(f) > 0 && Math.abs(_n(saldoDe(f)) - _n(se)) <= tol)
    .sort((a, b) => (_fecha(a) < _fecha(b) ? -1 : _fecha(a) > _fecha(b) ? 1 : 0))
  return mas[0] || null
}
