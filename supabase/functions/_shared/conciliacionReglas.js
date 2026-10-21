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
  if (fs.length < 2 || fs.length > 45) return null
  const elegir = sets => { if (!sets.length) return null; const k = s => s.map(x => x.saldo).sort((a, b) => a - b).join(','); const k0 = k(sets[0]); if (!sets.every(s => k(s) === k0)) return null
    const fe = s => s.map(x => x.b.issued_at || '').sort().join('|'); return [...sets].sort((a, b) => fe(a).localeCompare(fe(b)))[0].map(x => x.b) }
  const pares = []; for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) if (fs[i].saldo + fs[j].saldo === M) pares.push([fs[i], fs[j]])
  if (pares.length) return elegir(pares)
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
