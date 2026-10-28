// Qué filas de una cartola ya están cargadas y cuáles son nuevas. Una sola regla para la carga automática y las pruebas.
// Cada fila existente se "consume" una sola vez: tres pagos idénticos el mismo día son tres filas, no una.
// Orden: 1) mismo hash; 2) n° de operación (misma cuenta, tipo y monto); 3) huella de la glosa; 4) cuenta|fecha|tipo|monto.
// Nunca borra. Si una fila existente sin n° de operación calza con una del archivo que sí lo trae, devuelve el relleno.
const montoR = x => Math.round(Number(x) || 0)
const rutN = r => String(r || '').replace(/[^0-9kK]/g, '').toUpperCase()
// Si ambos lados traen RUT de la contraparte y difieren, son pagos distintos aunque coincidan monto y día.
const otraContraparte = (m, e) => { const a = rutN(m.rut_contraparte), b = rutN(e.rut_contraparte); return !!a && !!b && a !== b }

export function planCarga(movs, existentes, huellaGlosa) {
  const entrantes = new Set(movs.map(m => m.hash))
  const yaHay = new Set(existentes.map(e => e.hash))
  const libres = existentes.map((e, i) => ({ e, i })).filter(x => !entrantes.has(x.e.hash))
  const usados = new Set()
  const rellenar = []
  const mismo = (m, e) => e.cuenta === m.cuenta && e.tipo === m.tipo && montoR(e.monto) === montoR(m.monto) && !otraContraparte(m, e)
  const tomar = (pred) => { const x = libres.find(x => !usados.has(x.i) && pred(x.e)); if (x) usados.add(x.i); return x ? x.e : null }
  const nuevos = []
  for (const m of movs) {
    if (yaHay.has(m.hash)) continue
    let e = null
    if (m.n_operacion) e = tomar(e => mismo(m, e) && String(e.n_operacion || '') === String(m.n_operacion))
    if (!e) { const h = huellaGlosa(m); if (h) e = tomar(e => mismo(m, e) && huellaGlosa(e) === h) }
    if (!e) e = tomar(e => mismo(m, e) && String(e.fecha).slice(0, 10) === m.fecha)
    if (!e) { nuevos.push(m); continue }
    if (m.n_operacion && !e.n_operacion && e.id) rellenar.push({ id: e.id, n_operacion: String(m.n_operacion) })
  }
  return { nuevos, rellenar }
}
