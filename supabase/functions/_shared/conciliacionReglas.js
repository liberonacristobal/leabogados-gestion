// Reglas ÚNICAS de calce automático de un abono del banco (fuente única: las usa la app en Banco y el servidor en
// conciliacion-auto). Funciones puras: reciben el movimiento y el pool ya armado; no leen ni escriben la base.
// Calce EXACTO en pesos (no hay comisiones bancarias). Ante cualquier duda devuelven null → lo decide una persona.

export const normRut = r => String(r || '').toUpperCase().replace(/[^0-9K]/g, '')
export const folioN = no => String(no || '').replace(/^factura\s*/i, '').trim()
const _t = iso => new Date(String(iso).slice(0, 10) + 'T12:00').getTime()
// Diferencia en meses entre el mes de la factura y el del pago (factura − pago). null si falta dato.
export const mesDiff = (fm, pm) => { if (!fm || !pm) return null; const [ya, ma] = fm.split('-').map(Number), [yb, mb] = pm.split('-').map(Number); return (ya * 12 + ma) - (yb * 12 + mb) }
// Folio escrito en un texto del banco ("PAGO FACTURA 412", "F°412").
export const folioEnTexto = txt => { const mt = String(txt || '').match(/\b(?:factura|fact|fac|fra|f[°ºn])\s*[°ºn.\-:]*\s*(\d{2,7})\b/i); return mt ? mt[1] : null }

// Facturas cuyo saldo calza EXACTO con el monto, en ventana de fecha (−60 días = anticipo; hasta 36 meses tarde), ordenadas:
// 1) RS del pagador, 2) FIFO (la más antigua sin pagar). pool = [{b, saldo}].
export function candidatosFactura(mov, pool, amount) {
  const amt = amount == null ? (mov.monto || 0) : amount
  const pr = normRut(mov.rut_contraparte)
  const payT = mov.fecha ? _t(mov.fecha) : null
  const delta = iso => (payT && iso) ? (payT - _t(iso)) / 86400000 : null
  let xs = (pool || []).map(x => ({ ...x, delta: delta(x.b.issued_at) }))
    .filter(x => x.saldo > 0 && x.saldo === amt && (x.delta === null || (x.delta >= -60 && x.delta <= 1095)))
  return xs.sort((a, b) =>
    ((pr && normRut(b.b.receptor_rut) === pr ? 1 : 0) - (pr && normRut(a.b.receptor_rut) === pr ? 1 : 0))
    || ((a.b.issued_at || '').localeCompare(b.b.issued_at || ''))).map(x => x.b)
}

// La factura que paga el abono, o null. Folio en la glosa o en el mensaje del aviso → esa. Una sola → esa (si no es de más
// de 2 meses después del pago). Varias del mismo monto → la del RUT del pagador; si siguen varias, depende del cliente: unos
// pagan la factura del mes y dejan atrasada una antigua (Vaisman), otros pagan la más antigua primero (Bustos). El saldo
// total baja igual, pero cambia cuál queda vencida y se cobra. Sin opciones (app) → la más antigua. Con opts.estricto
// (servidor, sin supervisión) → solo si la más antigua y la del mes son la misma, o si el cliente tiene costumbre
// (opts.habito 'fifo' | 'mes', aprendida de sus pagos anteriores); si no, null.
export function elegirFactura(mov, pool, texto, opts = {}) {
  const cs = candidatosFactura(mov, pool); if (!cs.length) return null
  const fg = folioEnTexto(texto != null ? texto : mov.descripcion)
  if (fg) { const f = cs.find(c => String(folioN(c.invoice_no)) === String(fg)); if (f) return f }
  const pm = (mov.fecha || '').slice(0, 7), pr = normRut(mov.rut_contraparte)
  if (cs.length === 1) { const d = mesDiff((cs[0].issued_at || '').slice(0, 7), pm); return (d == null || d >= -2) ? cs[0] : null }
  let p = cs; if (pr) { const r = p.filter(f => normRut(f.receptor_rut) === pr); if (r.length) p = r }
  if (p.length === 1 || !opts.estricto) return p[0]
  const viejo = p[0], mes = delMes(mov, p)
  if (viejo === mes) return viejo
  // Con una igual atrasada más de 60 días, el pago puede ser para ponerse al día (Rendalo, 06-08-2026, pagó la de enero): se pregunta.
  if (opts.habito === 'mes' && viejo.issued_at && mov.fecha && (_t(mov.fecha) - _t(viejo.issued_at)) / 86400000 > 60) return null
  return opts.habito === 'fifo' ? viejo : opts.habito === 'mes' ? mes : null
}
// La factura emitida más cerca de la fecha del pago (la «del mes»).
export function delMes(mov, facturas) {
  const t0 = mov.fecha ? _t(mov.fecha) : null; if (!t0) return facturas[0] || null
  return [...facturas].sort((a, b) => (a.issued_at ? Math.abs(_t(a.issued_at) - t0) : 9e15) - (b.issued_at ? Math.abs(_t(b.issued_at) - t0) : 9e15) || (a.issued_at || '').localeCompare(b.issued_at || ''))[0] || null
}

// Un abono que paga VARIAS facturas del cliente (no futuras): la combinación de 2 o 3 cuyos saldos suman EXACTO el monto,
// si es única. Si hay varias pero todas son de los MISMOS montos (p. ej. cuotas idénticas), se toman las más antiguas.
// También N cuotas idénticas (hasta 12) que suman el monto. Si no, null. pool = [{b, saldo}].
export function elegirCombo(mov, pool) {
  const pm = (mov.fecha || '').slice(0, 7), M = mov.monto || 0
  const fs = (pool || []).filter(x => x.saldo > 0 && x.saldo < M && (() => { const d = mesDiff((x.b.issued_at || '').slice(0, 7), pm); return d == null || d <= 0 })())
    .sort((a, b) => (a.b.issued_at || '').localeCompare(b.b.issued_at || ''))
  if (fs.length < 2) return null   // el tope de 45 es solo para tríos e iguales (pares: como la app de antes)
  const elegir = sets => { if (!sets.length) return null; const k = s => s.map(x => x.saldo).sort((a, b) => a - b).join(','); const k0 = k(sets[0]); if (!sets.every(s => k(s) === k0)) return null
    const fe = s => s.map(x => x.b.issued_at || '').sort().join('|'); return [...sets].sort((a, b) => fe(a).localeCompare(fe(b)))[0].map(x => x.b) }
  const pares = []; for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) if (fs[i].saldo + fs[j].saldo === M) pares.push([fs[i], fs[j]])
  if (pares.length) return elegir(pares)
  if (fs.length > 45) return null
  const trios = []; for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) for (let k = j + 1; k < fs.length; k++) if (fs[i].saldo + fs[j].saldo + fs[k].saldo === M) trios.push([fs[i], fs[j], fs[k]])
  if (trios.length) return elegir(trios)
  const porMonto = {}; fs.forEach(x => { (porMonto[x.saldo] = porMonto[x.saldo] || []).push(x) })
  const igual = Object.entries(porMonto).filter(([s, xs]) => M % Number(s) === 0 && M / Number(s) >= 4 && M / Number(s) <= Math.min(12, xs.length))
  return igual.length === 1 ? igual[0][1].slice(0, M / Number(igual[0][0])).map(x => x.b) : null
}

const _STOP = new Set(['proyecto', 'puesta', 'marcha', 'fondo', 'fondos', 'gastos', 'gasto', 'para', 'por', 'rendir', 'provision', 'sociedad', 'constitucion', 'servicios', 'legales', 'cliente', 'trabajo', 'pago', 'abono'])
const _norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const _toks = s => _norm(s).split(/[^a-z0-9ñ]+/).filter(w => w.length >= 4 && !_STOP.has(w))
// Fondo ya registrado en la app (sin respaldo del banco) que corresponde al abono, o null: mismo monto exacto y registrado
// dentro de 10 días del depósito. Uno solo → ese. Varios → el que nombra el mensaje del aviso o la glosa (p. ej.
// «constitución sociedad osorno» → el fondo de Osorno); si todos son iguales (mismo concepto y trabajo), el más antiguo.
// fondos = [{id, amount, date, concept, project}] del mismo cliente, sin conciliar.
export function elegirFondo(mov, fondos, texto) {
  const M = mov.monto || 0, t0 = mov.fecha ? _t(mov.fecha) : null
  const cs = (fondos || []).filter(f => Math.round(Number(f.amount) || 0) === M && (!t0 || !f.date || Math.abs(_t(f.date) - t0) <= 10 * 86400000))
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
  if (cs.length <= 1) return cs[0] || null
  const txt = _norm(texto).replace(/[^a-z0-9ñ]/g, '')
  if (txt) {
    const tk = cs.map(f => new Set(_toks(`${f.concept || ''} ${f.project || ''}`)))
    const propios = tk.map((s, i) => [...s].filter(w => !tk.some((o, j) => j !== i && o.has(w))))
    const hits = cs.filter((f, i) => propios[i].some(w => txt.includes(w)))
    if (hits.length === 1) return hits[0]
  }
  const firma = f => `${_norm(f.concept).trim()}|${_norm(f.project).trim()}`
  return cs.every(f => firma(f) === firma(cs[0])) ? cs[0] : null
}

// Saldo a favor (anticipo) cargado a mano, sin respaldo del banco, que espera su depósito: mismo monto al peso, a ±10 días y ÚNICO.
// Fuera: el ya marcado ·revisado (se revisó que no tiene depósito propio) y el creado desde una conciliación.
export function elegirAnticipo(mov, anticipos) {
  const M = Math.round(Number(mov.monto) || 0), t0 = mov.fecha ? _t(mov.fecha) : null
  const cs = (anticipos || []).filter(a => Math.round(Number(a.monto) || 0) === M && M > 0 && !/·revisado/.test(a.nota || '') && !/conciliaci[oó]n/i.test(a.nota || '')
    && (!t0 || !a.fecha || Math.abs(_t(a.fecha) - t0) <= 10 * 86400000))
  return cs.length === 1 ? cs[0] : null
}

// Trabajo del cliente que nombra un texto (mensaje del aviso, asunto de la solicitud): «constitución sociedad osorno» →
// Osorno; «viáticos villa rica» → Villarica. Nombres del mismo trabajo (la venta «Puesta en marcha Osorno» y el proyecto
// «OSORNO» de los gastos: un nombre contiene al otro) cuentan como uno y se devuelve el primero de la lista (la venta, que
// el que llama pone primero). Varios trabajos distintos con la misma coincidencia («ovalle» en cuatro ventas) → null.
export function proyectoEnTexto(texto, proyectos) {
  const txt = _norm(texto).replace(/[^a-z0-9ñ]/g, ''); if (!txt) return null
  const ps = [...new Set((proyectos || []).map(p => String(p || '').trim()).filter(Boolean))]
  const hits = ps.map((p, i) => { const t = new Set(_toks(p)); return { p, i, t, m: [...t].filter(w => txt.includes(w)).length } }).filter(h => h.m)
    .sort((a, b) => b.m - a.m || a.i - b.i)
  if (!hits.length) return null
  const best = hits[0], dentro = (a, b) => [...a].every(w => b.has(w))
  return hits.filter(h => h.m === best.m).every(h => dentro(h.t, best.t) || dentro(best.t, h.t)) ? best.p : null
}
const _FONDO = /\b(fondos?|provisi[oó]n|vi[aá]ticos?|gastos?|rendir|rendici[oó]n)\b/i
const _NO_FONDO = /\b(factura|fact|honorarios?|cuota|boleta)\b/i
// ¿Un abono SIN destino en la app (sin factura exacta, combinación ni fondo registrado) es un fondo que falta registrar?
// Solo con señal positiva (la prueba con la historia mostró que la mayoría de los abonos sin destino son pagos de facturas):
// 1) una solicitud de fondos del cliente por ese monto exacto, enviada hasta 45 días antes y aún sin fondo; o 2) el mensaje
// de la transferencia nombra un trabajo del cliente o habla de fondos/viáticos/gastos. Con palabras de factura → null.
// solicitudes = [{id, monto, asunto, enviada_at}] del cliente; proyectos = nombres de trabajo del cliente.
// Devuelve {fuente, solicitud, proyecto, concepto} o null. Nunca crea nada: es la propuesta que una persona confirma.
export function pareceFondo(mov, texto, solicitudes, proyectos) {
  const M = Math.round(mov.monto || 0), t0 = mov.fecha ? _t(mov.fecha) : null, tx = String(texto || '')
  if (!M || _NO_FONDO.test(tx) || folioEnTexto(tx)) return null
  const sols = (solicitudes || []).filter(s => Math.round(Number(s.monto) || 0) === M && (!t0 || !s.enviada_at || ((t0 - _t(s.enviada_at)) / 86400000 >= -3 && (t0 - _t(s.enviada_at)) / 86400000 <= 45)))
    .sort((a, b) => String(a.enviada_at || '').localeCompare(String(b.enviada_at || '')))
  const pMsg = proyectoEnTexto(tx, proyectos)
  if (sols.length) {
    // Varias solicitudes del mismo monto (dos trabajos): la que nombra el mensaje; si no nombra ninguna, el trabajo lo elige una persona.
    const s = (pMsg && sols.find(x => proyectoEnTexto(x.asunto, proyectos) === pMsg)) || (sols.length === 1 ? sols[0] : null)
    if (!s) return { fuente: 'solicitud', solicitud: null, proyecto: null, concepto: null }
    return { fuente: 'solicitud', solicitud: s.id, proyecto: pMsg || proyectoEnTexto(s.asunto, proyectos), concepto: String(s.asunto || '').replace(/^((re|rv|fw|fwd)\s*:\s*)+/i, '').trim() || null }
  }
  if (pMsg || _FONDO.test(tx)) return { fuente: 'mensaje', solicitud: null, proyecto: pMsg, concepto: null }
  return null
}

// ── Cargos recurrentes ──
// Racha: los últimos 3 cargos al mismo RUT quedaron como UN costo de oficina con la misma categoría y subcategoría, y el
// monto nuevo está a ±30% del promedio de esos 3 → el siguiente se clasifica igual. Una clasificación distinta corta la racha.
// previos = [{fecha, monto, clas: 'Categoría›Sub' | null}] del mismo RUT, anteriores al cargo. Devuelve la clase o null.
export function rachaCargo(previos, monto) {
  const u = [...(previos || [])].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).slice(0, 3)
  if (u.length < 3 || u.some(x => !x.clas) || new Set(u.map(x => x.clas)).size !== 1) return null
  const prom = u.reduce((s, x) => s + Math.abs(Number(x.monto) || 0), 0) / 3, M = Math.abs(Number(monto) || 0)
  return prom > 0 && M >= prom * 0.7 && M <= prom * 1.3 ? u[0].clas : null
}
// Contadora: la transferencia se reparte con el correo «VALORES MM-AAAA» (items {item, categoria, monto}) solo si calza al
// peso con UNA partida o con la suma de TODAS. Al PPM se le restan las retenciones de boletas de honorarios del mes (van en
// el costo de cada boleta y se concilian como 'tercero'). Devuelve [{tipo, categoria, subcategoria, monto, concepto}] o null.
export function repartoContadora(monto, valores, retenciones) {
  const M = Math.round(Math.abs(Number(monto) || 0)), its = (valores?.items || []).filter(i => Number(i.monto) > 0)
  if (!M || !its.length) return null
  const [y, m] = String(valores.mes || '').split('-'), per = `${m}-${y}`
  const ret = (retenciones || []).reduce((s, r) => s + (Number(r.monto) || 0), 0)
  const partes = i => {
    const v = Math.round(Number(i.monto))
    if (/ppm/i.test(i.item)) {
      const det = (retenciones || []).map(r => `${r.nombre} N°${r.folio} $${Math.round(r.monto).toLocaleString('es-CL')}`).join(', ')
      return [{ tipo: 'gasto', categoria: i.categoria || 'Impuestos y patentes', subcategoria: 'PPM', monto: v - ret, concepto: `IVA/PPM ${per}${ret ? ` (retenciones BHE de ${det} van en el costo de su boleta)` : ''}` },
        ...(ret ? [{ tipo: 'tercero', monto: ret, concepto: 'Retenciones de boletas de honorarios' }] : [])]
    }
    if (/cotiza/i.test(i.item)) return [{ tipo: 'gasto', categoria: i.categoria || 'Leyes sociales', subcategoria: 'Cotizaciones', monto: v, concepto: `Cotizaciones sueldos ${per}` }]
    if (/contador/i.test(i.item)) return [{ tipo: 'gasto', categoria: i.categoria || 'Remuneraciones', subcategoria: 'Contadora', monto: v, concepto: `Honorario contadora ${per}` }]
    return null
  }
  const uno = its.filter(i => Math.round(Number(i.monto)) === M)
  const sel = uno.length === 1 ? uno : (its.reduce((s, i) => s + Math.round(Number(i.monto)), 0) === M ? its : null)
  if (!sel) return null
  const out = sel.map(partes); if (out.some(x => !x) || out.flat().some(p => p.monto < 0)) return null
  // PPM igual a las retenciones: no queda gasto de PPM (solo la parte «tercero»); nunca un gasto ni una conciliación en $0.
  return out.flat().filter(p => p.monto > 0)
}

// Abonos del banco «por identificar» (sin cliente y pendientes): no cuentan los que ya tienen categoría (reembolso, intereses…),
// los anteriores a la app (histórico importado) ni las transferencias de una persona del estudio (socios, equipo, sus sociedades).
export function abonosPorIdentificar(movs = [], { rutsPropios = new Set(), appDesde = '2026-06-06' } = {}) {
  const nr = r => String(r || '').replace(/[^0-9kK]/g, '').toUpperCase()
  return (movs || []).filter(m => m && m.tipo === 'abono' && !m.cliente_id && (Number(m.monto) || 0) > 0 && (m.estado || 'pendiente') === 'pendiente'
    && !m.categoria && String(m.fecha || '') >= appDesde && !(m.rut_contraparte && rutsPropios.has(nr(m.rut_contraparte))))
}
