// Reglas del aviso de gastos sin fondos (edge aviso-fondos). Funciones puras, con prueba en tests/.
export const UMBRAL_DEUDA = -1000   // mismo umbral que Rendir a clientes: un residuo de menos de $1.000 no se avisa
export const APP_DESDE_FONDOS = '2026-06-06'

// ¿Corresponde avisar? Saldo bajo el umbral y con al menos un gasto sin fondos dentro de la vida de la app (lo anterior es
// histórico importado: se ve en Rendir a clientes, no en un seguimiento cada 15 días).
export function avisoFondosAplica(saldo, gastosSinFondo = [], appDesde = APP_DESDE_FONDOS) {
  if (!(saldo <= UMBRAL_DEUDA)) return false
  return gastosSinFondo.some((g) => String(g?.date || '') >= appDesde)
}

// Número del aviso y último aviso: solo los avisos enviados de verdad (avisos_fondos) desde el último fondo.
export function contadorAvisos(historial = [], ultimoFondo = '', hoy = '9999-12-31') {
  const h = historial.filter((r) => String(r.fecha) > String(ultimoFondo || '') && String(r.fecha) < hoy).map((r) => String(r.fecha)).sort()
  return { n: h.length + 1, ultimo: h.length ? h[h.length - 1] : '' }
}
