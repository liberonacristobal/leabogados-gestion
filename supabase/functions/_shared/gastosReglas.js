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
