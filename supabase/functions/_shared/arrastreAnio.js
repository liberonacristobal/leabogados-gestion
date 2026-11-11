// «Arrastre 2026»: lo que el año base deja facturado para el año siguiente. Funciones puras, fuente única del paso Arrastre del Presupuesto y de todo lo que dependa de él.
// Regla: arrastre = cuotas de PROYECTOS vigentes del año (clasificarPorFacturar, partida vigente) + asesorías permanentes × 12, más las líneas que el usuario agregue.
// Se EXCLUYEN de las cuotas el subarriendo (no es ingreso: rebaja el arriendo) y las cuotas de ventas recurrentes (ya van en las asesorías × 12): sumarlas doble inflaría el arrastre
// (con los datos de nov-2026, la suma ingenua da $277,3M y la correcta $253.137.501). Los clientes con una factura morosa se señalan, no se descuentan.
// Dos pasos, una sola ruta: `lineasArrastre` arma las líneas de la app (una por venta) y `aplicarAjustesArrastre` les aplica los ajustes guardados en el borrador (st.arrastre) y entrega
// total, por cliente, por mes y morosos. Los ajustes viven en el estado del presupuesto: no tocan ventas, facturas ni cuotas reales.

/** @typedef {{ k:string, motivo:string|null, id:string, b:any, monto:number }} FilaPF */
/** @typedef {{ id:string, tipo:'cuota'|'asesoria', cid:string, venta:string, concepto:string, n:number, monto:number, porMes:number[], mensual:number, meses:number, moneda:'UF'|'CLP', uf:number, porMesUF:number[] }} LineaBase  monto/porMes/mensual = pesos nominales (UF del día de la venta); si la venta es en UF, `uf` = total en UF de 2027 y `porMesUF` su reparto por mes */
/** @typedef {{ monto?:number, mensual?:number, meses?:number, quitado?:boolean, nota?:string }} Ajuste */
/** @typedef {{ id:string, nombre:string, mensual:number, desde:number, meses:number, nota?:string, quitado?:boolean }} Extra */
/** @typedef {{ ajustes:Record<string,Ajuste>, extras:Extra[] }} EstadoArrastre */
/** @typedef {LineaBase & { origen:'app'|'agregada', nombre:string|null, moroso:boolean, quitado:boolean, ajustado:boolean, nota:string, enUF:boolean, base:{ monto:number, mensual:number, meses:number } }} LineaArrastre  enUF = la línea está valorizada en UF a la UF proyectada de cada mes (una venta en UF sin ajuste en pesos) */

const VIGENTE = ['vencida', 'porVencer']
const _mes = (/** @type {any} */ b) => Number(String((b && b.due) || '').slice(5, 7)) || 0
const _n = (/** @type {any} */ x) => { const v = Number(x); return Number.isFinite(v) ? v : 0 }
const _meses = (/** @type {any} */ x) => Math.min(12, Math.max(0, Math.round(_n(x))))

/** Estado vacío de los ajustes del arrastre. @returns {EstadoArrastre} */
export const arrastreVacio = () => ({ ajustes: {}, extras: [] })

/** Lleva el bloque guardado a su forma actual (borradores anteriores no lo traen). @param {any} a @returns {EstadoArrastre} */
export function normalizarArrastre(a) {
  const aj = a && typeof a === 'object' && a.ajustes && typeof a.ajustes === 'object' ? a.ajustes : {}
  /** @type {Record<string,Ajuste>} */ const ajustes = {}
  for (const k of Object.keys(aj)) { const x = aj[k] || {}; const o = /** @type {Ajuste} */ ({}); if (x.monto != null) o.monto = _n(x.monto); if (x.mensual != null) o.mensual = _n(x.mensual); if (x.meses != null) o.meses = _meses(x.meses); if (x.quitado) o.quitado = true; if (String(x.nota || '').trim()) o.nota = String(x.nota).trim(); if (Object.keys(o).length) ajustes[k] = o }
  const extras = (a && Array.isArray(a.extras) ? a.extras : []).map((/** @type {any} */ e) => ({ id: String(e.id), nombre: String(e.nombre || 'Línea agregada'), mensual: _n(e.mensual), desde: Math.min(12, Math.max(1, Math.round(_n(e.desde) || 1))), meses: _meses(e.meses == null ? 12 : e.meses), ...(String(e.nota || '').trim() ? { nota: String(e.nota).trim() } : {}), ...(e.quitado ? { quitado: true } : {}) }))
  return { ajustes, extras }
}

/**
 * Líneas de la app: una por venta. Cuotas = proyectos vigentes del año (subarriendo y cuotas de asesorías excluidos); asesorías = ventas mensuales activas (anual = mensual × 12).
 * Las ventas en UF (`ventasUF[idVenta] = uf_value`) llevan además su valor en UF: la cuota en UF es el monto en pesos ÷ la UF con que se programó; la asesoría trae `mensualUF`. `ufMes` (UF proyectada de cada mes del año) se guarda en el resultado
 * y `aplicarAjustesArrastre` la usa para valorizar esas líneas a la UF de cada mes; sin ella todo queda en pesos nominales.
 * @param {{ filas:FilaPF[], asesorias:{cid:any, anual:number, id?:any, concepto?:string, mensualUF?:number|null}[], ventas?:Record<string,string>, ventasUF?:Record<string,number>, ufMes?:number[]|null }} o
 * @returns {{ lineas:LineaBase[], subarriendo:number, ufMes:number[]|null }}
 */
export function lineasArrastre({ filas, asesorias, ventas, ventasUF, ufMes }) {
  /** @type {Map<string,LineaBase>} */ const cuotas = new Map()
  let subarriendo = 0
  for (const f of filas || []) {
    if (!VIGENTE.includes(f.k)) continue
    if (f.b && f.b.billing_type === 'subarriendo') { subarriendo += f.monto; continue }
    if (f.motivo === 'recurrente') continue
    const cid = String(f.b && f.b.client_id != null ? f.b.client_id : ''), venta = String((f.b && f.b.sale_id) || ''), id = 'pf:' + (venta || 'c' + cid)
    let l = cuotas.get(id)
    if (!l) { l = { id, tipo: 'cuota', cid, venta, concepto: (ventas && ventas[venta]) || String((f.b && f.b.concept) || '') || 'Sin proyecto', n: 0, monto: 0, porMes: Array.from({ length: 12 }, () => 0), mensual: 0, meses: 0, moneda: 'CLP', uf: 0, porMesUF: Array.from({ length: 12 }, () => 0) }; cuotas.set(id, l) }
    l.n++; l.monto += f.monto
    const m = _mes(f.b); if (m >= 1 && m <= 12) l.porMes[m - 1] += f.monto
    const ufv = _n(ventasUF && ventasUF[venta])
    if (ufv > 0) { l.moneda = 'UF'; const u = f.monto / ufv; l.uf += u; if (m >= 1 && m <= 12) l.porMesUF[m - 1] += u }
  }
  /** @type {LineaBase[]} */ const ases = []
  ;(asesorias || []).forEach((a, i) => {
    const v = _n(a.anual); if (v <= 0) return
    const venta = String(a.id != null ? a.id : ''), id = 'as:' + (venta || 'i' + i)
    const mu = _n(a.mensualUF) > 0 ? _n(a.mensualUF) : 0
    ases.push({ id, tipo: 'asesoria', cid: String(a.cid == null ? '' : a.cid), venta, concepto: a.concepto || (ventas && ventas[venta]) || 'Sin proyecto', n: 12, monto: v, porMes: Array.from({ length: 12 }, () => v / 12), mensual: v / 12, meses: 12, moneda: mu > 0 ? 'UF' : 'CLP', uf: mu * 12, porMesUF: Array.from({ length: 12 }, () => mu) })
  })
  return { lineas: [...cuotas.values(), ...ases], subarriendo, ufMes: Array.isArray(ufMes) && ufMes.length === 12 && ufMes.every((x) => _n(x) > 0) ? ufMes.map(Number) : null }
}

/** Meses de 2027 (índice 0 a 11) con su monto: una asesoría o línea agregada rige `meses` meses desde `desde` (1 a 12) y se corta en diciembre. @param {number} mensual @param {number} desde @param {number} meses */
const _serie = (mensual, desde, meses) => Array.from({ length: 12 }, (_, i) => (i + 1 >= desde && i + 1 < desde + meses ? mensual : 0))

/**
 * Aplica los ajustes a las líneas de la app y suma. Una línea quitada vale 0; una cuota con monto ajustado reparte el nuevo monto en los mismos meses de sus cuotas; una asesoría ajustada
 * rige `meses` meses desde enero. Las líneas agregadas suman en `agregadas`. Cada total sale de las mismas líneas (por cliente, por mes y morosos): sin doble conteo.
 * Las líneas de ventas en UF se valorizan a la UF proyectada de cada mes (`base.ufMes`); un ajuste de monto o de monto mensual (siempre en pesos) las deja en pesos, y un ajuste de meses solo recorta los meses.
 * @param {{ lineas:LineaBase[], subarriendo?:number, ufMes?:number[]|null }} base @param {any} [arr] bloque st.arrastre @param {Set<string>|string[]} [morosos]
 * @returns {{ total:number, proyectos:number, asesorias:number, agregadas:number, subarriendo:number, lineas:LineaArrastre[], nAjustadas:number, nAgregadas:number, nQuitadas:number, porCliente:{cid:string, nombre:string|null, proyectos:number, asesorias:number, agregadas:number, total:number, moroso:boolean}[], porMes:number[], morosos:{n:number, monto:number, pct:number, cids:string[]} }}
 */
export function aplicarAjustesArrastre(base, arr, morosos) {
  const st = normalizarArrastre(arr), mor = new Set([...(morosos || [])].map(String))
  /** @type {Record<string,{cid:string, nombre:string|null, proyectos:number, asesorias:number, agregadas:number}>} */ const cli = {}
  const get = (/** @type {string} */ cid, /** @type {string|null} */ nombre = null) => cli[cid] || (cli[cid] = { cid, nombre, proyectos: 0, asesorias: 0, agregadas: 0 })
  const porMes = Array.from({ length: 12 }, () => 0)
  let proyectos = 0, ases = 0, agregadas = 0, nAjustadas = 0, nQuitadas = 0
  /** @type {LineaArrastre[]} */ const lineas = []
  const ufM = base && base.ufMes && base.ufMes.length === 12 ? base.ufMes : null
  for (const b of (base && base.lineas) || []) {
    const a = st.ajustes[b.id] || {}, quitado = !!a.quitado, enUFbase = !!ufM && b.moneda === 'UF'
    // Valor de la app: en UF a la UF proyectada de cada mes (o nominal si la venta es en pesos / no hay UF proyectada).
    const vpm = enUFbase ? b.porMesUF.map((u, i) => u * ufM[i]) : b.porMes, vmonto = enUFbase ? vpm.reduce((x, y) => x + y, 0) : b.monto, vmensual = b.tipo === 'asesoria' ? (enUFbase ? vmonto / Math.max(1, b.meses) : b.mensual) : 0
    let monto = vmonto, mensual = vmensual, meses = b.meses, pm = vpm, enUF = enUFbase
    if (b.tipo === 'cuota') {
      if (a.monto != null) { enUF = false; monto = Math.max(0, a.monto); const w = vmonto > 0 ? vpm : vpm.map(() => 1), s0 = w.reduce((x, y) => x + y, 0); pm = s0 > 0 ? w.map((x) => (x / s0) * monto) : vpm }
    } else {
      const aMens = a.mensual != null
      if (aMens) { enUF = false; mensual = Math.max(0, Number(a.mensual)) }
      if (a.meses != null) meses = _meses(a.meses)
      if (aMens || !enUFbase) { monto = mensual * meses; pm = _serie(mensual, 1, meses) } else { pm = vpm.map((x, i) => (i < meses ? x : 0)); monto = pm.reduce((x, y) => x + y, 0) }
    }
    const ajustado = (a.monto != null && Math.abs(a.monto - vmonto) >= 1) || (a.mensual != null && Math.abs(a.mensual - vmensual) >= 1) || (a.meses != null && a.meses !== b.meses)
    if (quitado) nQuitadas++; else if (ajustado) nAjustadas++
    const vale = quitado ? 0 : monto
    if (!quitado) { pm.forEach((v, i) => { porMes[i] += v }); if (b.tipo === 'cuota') proyectos += monto; else ases += monto; const c = get(b.cid); if (b.tipo === 'cuota') c.proyectos += monto; else c.asesorias += monto }
    lineas.push({ ...b, origen: 'app', nombre: null, monto: vale, mensual, meses, porMes: quitado ? pm.map(() => 0) : pm, moroso: mor.has(b.cid), quitado, ajustado: ajustado && !quitado, enUF, nota: a.nota || '', base: { monto: vmonto, mensual: vmensual, meses: b.meses } })
  }
  for (const e of st.extras) {
    const mes = Math.min(e.meses, 13 - e.desde), pm = _serie(e.mensual, e.desde, mes), monto = e.mensual * mes, quitado = !!e.quitado, cid = 'x:' + e.id
    if (!quitado) { pm.forEach((v, i) => { porMes[i] += v }); agregadas += monto; get(cid, e.nombre).agregadas += monto }
    lineas.push({ id: 'x:' + e.id, tipo: 'asesoria', origen: 'agregada', moneda: 'CLP', uf: 0, porMesUF: Array(12).fill(0), enUF: false, nombre: e.nombre, cid, venta: '', concepto: e.nombre, n: mes, monto: quitado ? 0 : monto, porMes: quitado ? pm.map(() => 0) : pm, mensual: e.mensual, meses: mes, moroso: false, quitado, ajustado: false, nota: e.nota || '', base: { monto: 0, mensual: 0, meses: 0 } })
  }
  const porCliente = Object.values(cli).map((c) => ({ ...c, total: c.proyectos + c.asesorias + c.agregadas, moroso: mor.has(c.cid) })).filter((c) => c.total > 0).sort((a, b) => b.total - a.total)
  const total = proyectos + ases + agregadas, monMor = porCliente.filter((c) => c.moroso).reduce((a, c) => a + c.total, 0)
  return { total, proyectos, asesorias: ases, agregadas, subarriendo: (base && base.subarriendo) || 0, lineas, nAjustadas, nAgregadas: st.extras.filter((e) => !e.quitado).length, nQuitadas, porCliente, porMes, morosos: { n: porCliente.filter((c) => c.moroso).length, monto: monMor, pct: total > 0 ? (monMor / total) * 100 : 0, cids: porCliente.filter((c) => c.moroso).map((c) => c.cid) } }
}

/**
 * Atajo de las dos funciones: líneas de la app + ajustes. Sin ajustes da la cifra de la app.
 * @param {{ filas:FilaPF[], asesorias:{cid:any, anual:number, id?:any, concepto?:string, mensualUF?:number|null}[], morosos?:Set<string>|string[], ventas?:Record<string,string>, arrastre?:any, ventasUF?:Record<string,number>, ufMes?:number[]|null }} o
 */
export function arrastreAnio({ filas, asesorias, morosos, ventas, arrastre, ventasUF, ufMes }) {
  return aplicarAjustesArrastre(lineasArrastre({ filas, asesorias, ventas, ventasUF, ufMes }), arrastre, morosos)
}

/**
 * Guarda un cambio de una línea de la app: lo que coincide con el valor de la app se descarta (la línea vuelve a ser la de la app). `patch` con `null` borra ese campo. Devuelve un bloque nuevo.
 * @param {any} arr @param {LineaBase} linea @param {Partial<Record<keyof Ajuste, any>>} patch @returns {EstadoArrastre}
 */
export function ajustarLinea(arr, linea, patch) {
  const st = normalizarArrastre(arr), a = /** @type {Record<string,any>} */ ({ ...(st.ajustes[linea.id] || {}) })
  for (const k of Object.keys(patch)) { const v = /** @type {any} */ (patch)[k]; if (v == null || v === false || v === '') delete a[k]; else a[k] = v }
  if (a.monto != null && Math.abs(a.monto - linea.monto) < 1) delete a.monto
  if (a.mensual != null && Math.abs(a.mensual - linea.mensual) < 1) delete a.mensual
  if (a.meses != null && a.meses === linea.meses) delete a.meses
  const ajustes = { ...st.ajustes }; if (Object.keys(a).length) ajustes[linea.id] = a; else delete ajustes[linea.id]
  return normalizarArrastre({ ajustes, extras: st.extras })
}

/** Vuelve una línea (o todas) al valor de la app: conserva solo la nota de la línea si ya la tenía y no toca las líneas agregadas. @param {any} arr @param {string|null} [id] @returns {EstadoArrastre} */
export function restaurarArrastre(arr, id = null) {
  const st = normalizarArrastre(arr)
  if (id == null) return { ajustes: {}, extras: st.extras }
  const ajustes = { ...st.ajustes }; delete ajustes[id]
  return { ajustes, extras: st.extras }
}

/** Agrega una línea manual (contrato que aún no está en la app): monto mensual, mes de inicio (1 a 12) y meses. @param {any} arr @param {{ nombre:string, mensual:number, desde:number, meses:number, nota?:string }} e @param {string} id @returns {EstadoArrastre} */
export function agregarExtra(arr, e, id) {
  const st = normalizarArrastre(arr)
  return normalizarArrastre({ ajustes: st.ajustes, extras: [...st.extras, { id, ...e }] })
}

/** Cambia o quita (con `null`) una línea agregada. @param {any} arr @param {string} id @param {Partial<Extra>|null} patch @returns {EstadoArrastre} */
export function editarExtra(arr, id, patch) {
  const st = normalizarArrastre(arr)
  return normalizarArrastre({ ajustes: st.ajustes, extras: patch == null ? st.extras.filter((e) => e.id !== id) : st.extras.map((e) => (e.id === id ? { ...e, ...patch } : e)) })
}

/** Cuántas líneas del arrastre cambió el usuario (ajustadas, quitadas y agregadas): el número que muestra Comparar versiones. @param {any} arr */
export function lineasTocadas(arr) { const st = normalizarArrastre(arr); return Object.keys(st.ajustes).length + st.extras.length }

/** Cuotas de proyectos vigentes cuyo vencimiento cae entre dos fechas (aaaa-mm-dd, ambas incluidas): las de nov-dic del año base, que son de ese año y no del siguiente. @param {FilaPF[]} filas @param {string} desde @param {string} hasta */
export function cuotasEntre(filas, desde, hasta) {
  return (filas || []).filter((f) => VIGENTE.includes(f.k) && !(f.b && f.b.billing_type === 'subarriendo') && f.motivo !== 'recurrente' && String((f.b && f.b.due) || '').slice(0, 10) >= desde && String((f.b && f.b.due) || '').slice(0, 10) <= hasta).reduce((a, f) => a + f.monto, 0)
}
