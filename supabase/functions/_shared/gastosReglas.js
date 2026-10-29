// Reglas ÚNICAS del saldo de gastos de un cliente y de su rendición (app: Rendir a clientes, fichas; servidor: cierre de mes).
// Funciones puras. Corte de apertura: lo que tiene apertura_id quedó resumido en el «Saldo de apertura» y no suma.
export const cuentaEnSaldo = e => !e?.apertura_id

// Fondos − gastos de un cliente. Excluye solo los gastos no_descuenta_saldo (histórico ya saldado fuera de la app).
export function fgCliente(expenses, clientId) {
  let fondos = 0, gastos = 0
  ;(expenses || []).forEach(e => { if (e.client_id !== clientId || !cuentaEnSaldo(e)) return; if (e.type === 'fondo') fondos += (e.amount || 0); else if (!e.no_descuenta_saldo) gastos += (e.amount || 0) })
  return { fondos, gastos, saldo: fondos - gastos }
}

// Gastos del cliente aún sin rendir (lo que entra en su próxima rendición).
export const gastosPorRendirCli = (expenses, cid) => (expenses || []).filter(e => String(e.client_id) === String(cid) && e.type === 'gasto' && !e.no_descuenta_saldo && !e.client_rendered_at && cuentaEnSaldo(e) && e.category !== 'Apertura')

// Grupo de Rendir a clientes: env (borrador armado) · pedir (gastos por rendir y debe ≥ $1.000) · favor · cero · dep (debe sin
// gastos por rendir: espera depósito) · aldia. n = gastos por rendir, s = saldo, armada = hay borrador sin enviar.
export const grupoRendir = ({ n, s, armada }) => armada ? 'env' : n > 0 && s <= -1000 ? 'pedir' : n > 0 && s >= 1000 ? 'favor' : n > 0 ? 'cero' : s <= -1000 ? 'dep' : 'aldia'

// Abono de un cliente al que ya se le envió una rendición: Banco propone acreditarlo como fondo (Provisión de gastos).
// Solo propone cuando hay certeza del contexto (cliente asignado, abono sin conciliar y sin categoría, rendición enviada antes del
// depósito y aún sin pago enlazado, cliente con saldo por cubrir). No compara el monto con el total de la rendición: ese total
// incluye partidas ya cubiertas y no es lo que se debe. Muestra el saldo por cubrir del cliente (fgCliente) antes y después.
export function propuestaFondoRendicion({ mov, expenses, rendiciones }) {
  if (!mov || mov.tipo !== 'abono' || mov.es_interno || !mov.cliente_id) return null
  if (mov.categoria && mov.categoria !== 'Cliente') return null
  const resto = (Number(mov.monto) || 0) - (Number(mov.monto_conciliado) || 0)
  if (resto <= 1000) return null
  const desde = String(mov.fecha || '').slice(0, 10)
  const cands = (rendiciones || []).filter(r => r.tipo === 'cliente' && String(r.client_id) === String(mov.cliente_id) && !r.anulada_at && !r.movimiento_id && r.sent_at && String(r.sent_at).slice(0, 10) <= desde)
    .sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at)))
  if (!cands.length) return null
  const porCubrir = -fgCliente(expenses, mov.cliente_id).saldo
  if (porCubrir < 1000) return null
  const rend = cands[0]
  return { rend, resto, porCubrir, queda: Math.max(0, porCubrir - resto) }
}
