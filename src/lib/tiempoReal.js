// Tiempo real: cuando otro usuario, o un proceso del servidor (SII, conciliación, correos), cambia una tabla, esta app la vuelve a leer sola.
// La suscripción solo avisa «cambió X»; el dato siempre se lee con la misma consulta de la carga inicial, así que no hay otra fuente de cifras.
// Varios cambios seguidos (una importación de 100 filas) se juntan en una sola lectura; con la pestaña oculta la lectura espera al volver.
export function suscribirCambios(supabase, recargas, { ms = 1500, doc = globalThis.document, canal = 'firmdesk-cambios' } = {}) {
  const pendientes = new Set()
  const timers = {}
  const visible = () => !doc || doc.visibilityState !== 'hidden'
  const correr = t => {
    if (!visible()) { pendientes.add(t); return }
    pendientes.delete(t)
    Promise.resolve().then(recargas[t]).catch(() => {})
  }
  const alCambio = t => { clearTimeout(timers[t]); timers[t] = setTimeout(() => correr(t), ms) }
  const ch = supabase.channel(canal)
  Object.keys(recargas).forEach(t => ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, () => alCambio(t)))
  ch.subscribe()
  const alVolver = () => { if (visible()) [...pendientes].forEach(correr) }
  doc?.addEventListener?.('visibilitychange', alVolver)
  return () => {
    Object.values(timers).forEach(clearTimeout)
    doc?.removeEventListener?.('visibilitychange', alVolver)
    supabase.removeChannel(ch)
  }
}
