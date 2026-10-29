// Una escritura que la base rechaza (permiso, restricción, dato inválido) no lanza: llega como {error} y la mayoría de las acciones
// la ignoraba sin dejar rastro. Este vigilante envuelve el fetch del cliente, mira cada respuesta de escritura y avisa al registro de
// errores de la app (tabla app_errores, que el administrador ve en Revisión de datos). No cambia la respuesta ni nada en pantalla.
export const vigilarEscrituras = (obtenerAviso, fetchBase = (...a) => fetch(...a)) => async (input, init) => {
  const res = await fetchBase(input, init)
  try {
    const aviso = obtenerAviso()
    const url = String(input?.url || input)
    const metodo = String(init?.method || input?.method || 'GET').toUpperCase()
    const rest = url.includes('/rest/v1/'), fn = url.includes('/functions/v1/')
    if (aviso && metodo !== 'GET' && metodo !== 'HEAD' && ((rest && res.status >= 400) || (fn && res.status >= 500)) && !url.includes('/app_errores')) {
      const tabla = (url.split(rest ? '/rest/v1/' : '/functions/v1/')[1] || '').split('?')[0]
      res.clone().text().then(t => aviso({ metodo, tabla, status: res.status, cuerpo: String(t || '').slice(0, 300) })).catch(() => {})
    }
  } catch (_) { /* vigilar nunca debe romper una petición */ }
  return res
}
