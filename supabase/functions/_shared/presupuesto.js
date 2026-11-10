// presupuesto.js — reglas del PRESUPUESTO ANUAL (año siguiente): modelo por escenario, migración del estado guardado, diferencia entre versiones,
// días de cobro y meses atípicos. Funciones puras (sin lectura ni escritura de la base): las usan la vista Presupuesto y, más adelante, los avisos del
// seguimiento. Con prueba en tests/presupuesto.test.mjs.
//
// Plano: CAJA (el régimen Pro Pyme tributa lo percibido menos lo pagado). Sociedad de profesionales exenta de IVA: lo facturado es el neto.

/** @typedef {{ g:number, alza:number, terc:number, dias:number }} Supuestos  g = crecimiento real de ventas (% en UF); alza = alza de costos (%); terc = comisiones (% de lo cobrado); dias = días de cobro */
/** @typedef {{ id:number|string, n:string, m:number, meses:number, t:string, alza:number|null, g?:string, desde?:string|null, mPrev?:number|null }} PartidaCosto  m = monto por mes (el vigente al inicio del año del presupuesto); meses = meses del año; alza propia (null = la del escenario; puede ser negativa); g = grupo de una partida por persona (Remuneraciones, Leyes sociales); desde/mPrev = vigencia de un reajuste (el monto m rige desde `desde`; antes regía mPrev) */
/** Parte de cada socio en las metas de la oficina: partes iguales entre los socios (con dos socios, 50 % cada uno). «Sin socio» no tiene meta.
 * @param {{ nombre:string }[]} socios @param {string} nombre */
export const parteMeta = (socios, nombre) => { const n = (socios || []).filter((s) => s.nombre !== 'Sin socio').length; return n && nombre !== 'Sin socio' ? 1 / n : 0 }

/**
 * Tasa de primera categoría del régimen Pro Pyme general (14 D N°3) por año COMERCIAL. Circular SII N° 53 de 2025 (Ley 21.755): 12,5 % en 2025, 2026 y 2027 y 15 % en 2028,
 * siempre que la cotización del empleador (Ley 21.735) sea la del año (la circular la da por cumplida hasta 2028); desde 2029 la tasa permanente es 25 %.
 * @param {number|null|undefined} anio
 */
export const tasaIDPCLegal = (anio) => { const a = num(anio, 2027); return a <= 2027 ? 12.5 : a === 2028 ? 15 : 25 }

/**
 * Tasa legal del PPM de un contribuyente 14 D N°3 (% de los ingresos brutos del giro). Normal: 0,25 % (ingresos del año anterior hasta 50.000 UF) o 0,5 % (más de 50.000 UF);
 * con la rebaja transitoria (ingresos de agosto de 2025 a diciembre de 2027) queda en 0,125 % o 0,25 %. Sin rebaja desde 2028 (Circular SII N° 53 de 2025, § 2.2 y 2.3).
 * @param {number|null|undefined} anio @param {number|null|undefined} ufAnterior ingresos brutos del año anterior en UF
 */
export const tasaPPMLegal = (anio, ufAnterior) => { const grande = num(ufAnterior) > 50_000; return num(anio, 2027) <= 2027 ? (grande ? 0.25 : 0.125) : (grande ? 0.5 : 0.25) }

/** @typedef {{ v:number, esc:string, moneda:string, reajusteUF:number, tasaIDPC:number, ppmAnual:number, reserva:number, reservaIni:number, metas:{ancla:string, valor:number|null, ratio:number|null}, p:Record<string,Supuestos>, costos:PartidaCosto[], hecho:number[], notas:Record<string,string>, basadaEn:string|null }} EstadoPresupuesto */
/** @typedef {{ baseCLP:number[], baseUF:number[], ufDic:number }} BasePresupuesto  base de 12 meses (enero a diciembre del año del presupuesto) en pesos y UF, y UF de cierre del año anterior */

// La clave interna `meta` se mantiene para no romper los estados y versiones guardados; solo el rótulo es «Optimista» (la palabra «meta» queda para lo que el usuario fija).
export const ESCENARIOS = /** @type {[string,string][]} */ ([['prudente', 'Prudente'], ['base', 'Base'], ['meta', 'Optimista']])

/** Los seis componentes de la cadena Vendido → Facturado → Cobrado → Presupuesto de costos → Margen → Retiros, con el nombre único de toda la app. */
export const COMPONENTES = /** @type {[string,string][]} */ ([['ventas', 'Vendido'], ['fact', 'Facturado'], ['caja', 'Cobrado'], ['costos', 'Presupuesto de costos'], ['margen', 'Margen'], ['retiros', 'Retiros']])
/** Componentes en los que se puede escribir la meta (el presupuesto de costos se arma en el paso Costos). */
export const ANCLAS = ['retiros', 'margen', 'caja', 'fact', 'ventas']
export const nombreComponente = (/** @type {string} */ k) => (COMPONENTES.find((x) => x[0] === k) || [k, k])[1]
/** Reserva de caja mínima que ya está en caja al comenzar el año: base que no se toca (parámetro del estado, no editable en pantalla; por confirmar contra el saldo del Banco). */
export const RESERVA_MINIMA = 30_000_000
/** Regla de la reserva recomendada: meses de costos de oficina a los que llegar, repartidos por trimestre. Recomendación de criterio, editable aquí; no es un cálculo oficial. */
export const REGLA_RESERVA = { meses: 3, trimestres: 4 }

/** Supuestos de partida de cada escenario: criterio inicial editable, no un cálculo (el crecimiento) o el dato real del año anterior (terceros, días de cobro). */
export const PALANCAS_INICIALES = /** @type {Record<string,Supuestos>} */ ({
  prudente: { g: 0, alza: 6, terc: 24.4, dias: 35 },
  base: { g: 10, alza: 4.5, terc: 24.4, dias: 24 },
  meta: { g: 25, alza: 4.5, terc: 24.4, dias: 24 },
})

const sum = (/** @type {number[]} */ a) => a.reduce((x, y) => x + (Number(y) || 0), 0)
const num = (/** @type {any} */ x, d = 0) => { const n = Number(x); return Number.isFinite(n) ? n : d }

/**
 * Estado inicial editable. `terc` y `dias` (reales del año anterior) reemplazan el valor de partida de los escenarios Base y Meta; el Prudente supone cobro más lento.
 * `anio` (año comercial del presupuesto) define la tasa legal de primera categoría de partida. El PPM parte de lo que se paga hoy (`ppmMes` × 12): supuesto conservador, la tasa legal (tasaPPMLegal) es menor y queda por confirmar con la contadora.
 * @param {{ costos?:PartidaCosto[], terc?:number|null, dias?:number|null, tasa?:number, ppmMes?:number, anio?:number, reajusteUF?:number, reserva?:number, reservaIni?:number }} [o]
 * @returns {EstadoPresupuesto}
 */
export function estadoInicial(o = {}) {
  const p = /** @type {Record<string,Supuestos>} */ (JSON.parse(JSON.stringify(PALANCAS_INICIALES)))
  if (o.terc != null && Number.isFinite(Number(o.terc))) for (const k of Object.keys(p)) p[k].terc = Math.round(Number(o.terc) * 10) / 10
  if (o.dias != null && Number.isFinite(Number(o.dias)) && Number(o.dias) > 0) { p.base.dias = Math.round(Number(o.dias)); p.meta.dias = Math.round(Number(o.dias)); p.prudente.dias = Math.max(p.prudente.dias, Math.round(Number(o.dias)) + 10) }
  return {
    v: 4, esc: 'base', moneda: 'clp', reajusteUF: num(o.reajusteUF, 3.5), tasaIDPC: num(o.tasa, tasaIDPCLegal(o.anio)), ppmAnual: Math.round(num(o.ppmMes) * 12), reserva: num(o.reserva, 15),
    reservaIni: num(o.reservaIni, RESERVA_MINIMA), metas: { ancla: 'retiros', valor: null, ratio: null },
    p, costos: (o.costos || []).map((c) => ({ ...c })), hecho: [], notas: {}, basadaEn: null,
  }
}

/** UF proyectada del mes `mesIdx` (0 = enero) con reajuste anual compuesto mensual sobre la UF de cierre del año anterior. @param {number} ufDic @param {number} reajustePct @param {number} mesIdx */
export function proyectarUF(ufDic, reajustePct, mesIdx) {
  return ufDic * Math.pow(1 + num(reajustePct) / 100, (mesIdx + 1) / 12)
}

/** Presupuesto de costos del año: partidas × meses × (1 + alza propia o la del escenario). @param {EstadoPresupuesto} st @param {number} alza */
export function costosPresupuesto(st, alza) {
  return sum(st.costos.map((c) => num(c.m) * num(c.meses) * (1 + (c.alza == null ? alza : num(c.alza)) / 100)))
}

/** UF de cada mes, facturado base a crecimiento 0 (F0), peso de diciembre en ese facturado y facturado base de diciembre: lo que comparten todos los cálculos. @param {BasePresupuesto} base @param {EstadoPresupuesto} st */
function contexto(base, st) {
  const uf27 = Array.from({ length: 12 }, (_, i) => proyectarUF(base.ufDic, st.reajusteUF, i))
  const F0 = sum(base.baseUF.map((x, i) => num(x) * uf27[i]))
  return { uf27, F0, pesoDic: F0 > 0 ? (num(base.baseUF[11]) * uf27[11]) / F0 : 0, b11: num(base.baseCLP[11]) }
}

/**
 * Cascada de UN escenario (o de una meta): cada mes parte del mismo mes de la base (en UF, para que la UF no distorsione), se multiplica por (1 + crecimiento real)
 * y se convierte a pesos con la UF proyectada de ese mes. Caja = facturado menos el aumento de lo por cobrar al cierre (días de cobro sobre la variación de diciembre).
 * Única fuente de la cascada: el modelo por escenario, las metas y su inversa la usan.
 * @param {BasePresupuesto} base @param {EstadoPresupuesto} st @param {Supuestos} p @param {number[]} uf27
 */
export function calculoEscenario(base, st, p, uf27) {
  const ingUF = base.baseUF.map((x) => num(x) * (1 + p.g / 100))
  const ing = ingUF.map((x, i) => x * uf27[i])
  const fact = sum(ing)
  const dCob = (p.dias / 30) * (ing[11] - num(base.baseCLP[11]))
  const caja = fact - dCob
  const costos = costosPresupuesto(st, p.alza)
  const terc = (caja * p.terc) / 100
  const antes = caja - terc - costos
  const idpc = Math.max(0, antes) * (st.tasaIDPC / 100)
  const post = antes - idpc
  const retiros = Math.max(0, post) * (1 - st.reserva / 100)
  const reserva = Math.max(0, post) * (st.reserva / 100)
  const ppm = num(st.ppmAnual)   // PPM del año: lo que se paga hoy por mes × 12 (conservador)
  const reservaCierre = num(st.reservaIni) + reserva
  return { p, ing, ingUF, fact, factUF: sum(ingUF), dCob, caja, costos, terc, base: antes, idpc, ppm, saldo: idpc - ppm, post, retiros, reserva, reservaCierre, mesesReserva: costos > 0 ? reservaCierre / (costos / 12) : null, egr: costos + terc + idpc }
}

/**
 * Modelo del presupuesto por escenario.
 * @param {BasePresupuesto} base @param {EstadoPresupuesto} st
 */
export function modeloPresupuesto(base, st) {
  const { uf27 } = contexto(base, st)
  const ufMed = sum(uf27) / 12
  const esc = /** @type {Record<string, any>} */ ({})
  for (const [k] of ESCENARIOS) esc[k] = calculoEscenario(base, st, st.p[k], uf27)
  return { uf27, ufMed, esc }
}

// ── Metas: la misma cascada en los dos sentidos ──
// Retiros ← Margen ← Cobrado ← Facturado ← Vendido, con el presupuesto de costos restando entre Cobrado y Margen. Todo es lineal en el crecimiento real de ventas (g):
// escribir la meta de cualquier componente despeja el g que la produce y vuelve a calcular el resto con la cascada de arriba. Los supuestos de las metas son los del
// escenario Base (comisiones, días de cobro, alza de costos) y los generales (impuesto, reserva); la relación facturado/vendido es una estimación propia (el real, aún sin ciclo completo).

/** Supuestos con que se calculan las metas: los del escenario Base. @param {EstadoPresupuesto} st */
export const supuestosMetas = (st) => ({ ...st.p.base })

/** Vendido a partir de lo facturado, con la relación facturado/vendido (%). @param {number} fact @param {number|null|undefined} ratio */
export const ventasDeFact = (fact, ratio) => (num(ratio) > 0 ? fact / (num(ratio) / 100) : null)

/**
 * Cascada completa para un crecimiento real `g` (%) con los supuestos de las metas, más Vendido (estimación propia).
 * @param {BasePresupuesto} base @param {EstadoPresupuesto} st @param {number} g @param {number|null} ratio facturado ÷ vendido, en %
 */
export function cadenaMeta(base, st, g, ratio) {
  const { uf27 } = contexto(base, st)
  const e = calculoEscenario(base, st, { ...supuestosMetas(st), g }, uf27)
  return { ...e, g, margen: e.base, ventas: ventasDeFact(e.fact, ratio) }
}

/** Valor de un componente en una cascada (escenario o meta). @param {Record<string,any>} e @param {string} comp @param {number|null|undefined} [ratio] */
export function valorComponente(e, comp, ratio) {
  switch (comp) {
    case 'ventas': return e.ventas != null ? e.ventas : ventasDeFact(e.fact, ratio)
    case 'fact': return e.fact
    case 'caja': return e.caja
    case 'costos': return e.costos
    case 'margen': return e.margen != null ? e.margen : e.base
    case 'retiros': return e.retiros
    default: return null
  }
}

/**
 * Inversa: la cascada que produce la meta `valor` del componente `componente` (ventas | fact | caja | margen | retiros).
 * Devuelve { ok:false, motivo } si no hay solución: meta ≤ 0 (con retiros o margen ≤ 0 no hay un crecimiento único), base vacía, componente que no se fija aquí,
 * relación facturado/vendido ausente, supuestos sin solución (comisiones, impuesto o reserva ≥ 100 %, días de cobro que anulan la caja) o un facturado negativo.
 * @param {BasePresupuesto} base @param {EstadoPresupuesto} st @param {{ componente:string, valor:number, ratio:number|null }} o
 */
export function metasDesdeComponente(base, st, o) {
  const v = Number(o.valor)
  if (!ANCLAS.includes(o.componente)) return { ok: false, motivo: 'componente' }
  if (!(v > 0)) return { ok: false, motivo: 'valor' }
  const { F0, pesoDic, b11 } = contexto(base, st)
  if (!(F0 > 0)) return { ok: false, motivo: 'base' }
  const p = supuestosMetas(st), a = p.dias / 30, den = 1 - a * pesoDic
  let fact
  if (o.componente === 'ventas') { if (!(num(o.ratio) > 0)) return { ok: false, motivo: 'ratio' }; fact = (v * num(o.ratio)) / 100 }
  else if (o.componente === 'fact') fact = v
  else {
    let caja
    if (o.componente === 'caja') caja = v
    else {
      if (!(p.terc < 100) || !(st.tasaIDPC < 100) || !(st.reserva < 100)) return { ok: false, motivo: 'supuestos' }
      const antes = o.componente === 'margen' ? v : v / (1 - st.reserva / 100) / (1 - st.tasaIDPC / 100)
      caja = (antes + costosPresupuesto(st, p.alza)) / (1 - p.terc / 100)
    }
    if (!(den > 1e-9)) return { ok: false, motivo: 'supuestos' }
    fact = (caja - a * b11) / den
  }
  if (!(fact > 0)) return { ok: false, motivo: 'negativo' }
  const g = (fact / F0 - 1) * 100
  return { ok: true, ...cadenaMeta(base, st, g, o.ratio) }
}

/**
 * Cuánto da cada escenario del componente de la meta, contra la meta: diferencia (escenario − meta) y si la cubre.
 * @param {ReturnType<typeof modeloPresupuesto>} modelo @param {string} comp @param {number} valor @param {number|null} ratio
 */
export function escenariosContraMeta(modelo, comp, valor, ratio) {
  return ESCENARIOS.map(([k, n]) => { const v = valorComponente(modelo.esc[k], comp, ratio); return { k, n, valor: v, dif: v == null ? null : v - valor, cubre: v != null && v >= valor - 1 } })
}

/** El primer escenario (Prudente, Base, Optimista) que cubre la meta, o null si ninguno. @param {ReturnType<typeof escenariosContraMeta>} lista */
export const nivelDeMeta = (lista) => (lista.find((x) => x.cubre) || { k: null }).k

/** ¿Una variación es a favor? Más presupuesto de costos es en contra; en los demás componentes, más es a favor. @param {string} comp @param {boolean} sube */
export const afavor = (comp, sube) => (comp === 'costos' ? !sube : sube)

// ── Referencia 2026: real a la fecha + lo que resta del año ──
/** Meses del año ya transcurridos a una fecha, con el mes en curso proporcional a sus días: al 09-11 son 10,3. @param {string} hoyISO */
export function mesesTranscurridos(hoyISO) {
  const m = Number(hoyISO.slice(5, 7)), d = Number(hoyISO.slice(8, 10)), dias = new Date(Date.UTC(Number(hoyISO.slice(0, 4)), m, 0)).getUTCDate()
  return m - 1 + Math.min(Math.max(d, 0), dias) / dias
}

/**
 * Cierre estimado de un componente: lo real a la fecha más el promedio mensual de los últimos meses cerrados por los meses que faltan (regla simple y rotulada, estimación propia).
 * @param {{ aFecha:number, ultimos:number[], hoyISO:string }} o
 */
export function cierreEstimado(o) {
  const t = mesesTranscurridos(o.hoyISO), faltan = Math.max(0, 12 - t)
  const v = (o.ultimos || []).map(Number).filter(Number.isFinite)
  const promedio = v.length ? sum(v) / v.length : null
  const resto = promedio == null ? 0 : promedio * faltan
  return { aFecha: num(o.aFecha), resto, cierre: num(o.aFecha) + resto, promedio, faltan, transcurridos: t }
}

/**
 * Referencia 2026 de los seis componentes: real a la fecha, resto estimado y cierre. Vendido, Facturado y Cobrado proyectan el resto con el promedio de los últimos meses cerrados;
 * el Presupuesto de costos suma lo real de los meses cerrados al presupuesto de los que faltan (como Presupuesto vs real); el Margen es del plano de caja (cobrado − comisiones − costos,
 * el mismo del modelo); los Retiros no se proyectan: son una decisión de los socios y irregulares, y el cierre es lo retirado a la fecha.
 * @param {{ hoyISO:string, aFecha:{ ventas:number, fact:number, caja:number, retiros:number }, ultimos:{ ventas:number[], fact:number[], caja:number[] }, costos:{ real:number, pptoResto:number }, terc:number|null }} o
 */
export function referencia2026(o) {
  const proy = (/** @type {'ventas'|'fact'|'caja'} */ k) => cierreEstimado({ aFecha: o.aFecha[k], ultimos: o.ultimos[k], hoyISO: o.hoyISO })
  const ventas = proy('ventas'), fact = proy('fact'), caja = proy('caja')
  const costos = { aFecha: num(o.costos.real), resto: num(o.costos.pptoResto), cierre: num(o.costos.real) + num(o.costos.pptoResto), promedio: null, faltan: Math.max(0, 12 - mesesTranscurridos(o.hoyISO)), transcurridos: mesesTranscurridos(o.hoyISO) }
  const t = num(o.terc)
  const margen = { ...caja, aFecha: caja.aFecha * (1 - t / 100) - costos.aFecha, cierre: caja.cierre * (1 - t / 100) - costos.cierre, resto: 0, promedio: null }
  margen.resto = margen.cierre - margen.aFecha
  const retiros = { aFecha: num(o.aFecha.retiros), resto: 0, cierre: num(o.aFecha.retiros), promedio: null, faltan: caja.faltan, transcurridos: caja.transcurridos }
  return { ventas, fact, caja, costos, margen, retiros }
}

// ── Reserva de caja ──
/**
 * Reserva recomendada: llegar a `meses` de costos de oficina con un aumento gradual por trimestre, sin tope sobre los retiros. Regla simple de criterio (REGLA_RESERVA), no un cálculo oficial.
 * @param {{ costosAnio:number, reservaIni:number, reservaAnio:number, post:number, meses?:number, trimestres?:number }} o
 */
export function reservaRecomendada(o) {
  const meses = o.meses ?? REGLA_RESERVA.meses, tr = o.trimestres ?? REGLA_RESERVA.trimestres
  const costosMes = num(o.costosAnio) / 12, ini = num(o.reservaIni), objetivo = meses * costosMes
  const brecha = Math.max(0, objetivo - ini), porTrimestre = brecha / tr
  const reservaCierre = ini + num(o.reservaAnio), falta = Math.max(0, objetivo - reservaCierre)
  return {
    meses, costosMes, objetivo, brecha, porTrimestre, niveles: Array.from({ length: tr }, (_, i) => ini + porTrimestre * (i + 1)),
    reservaCierre, mesesCierre: costosMes > 0 ? reservaCierre / costosMes : null, mesesIni: costosMes > 0 ? ini / costosMes : null,
    cubre: reservaCierre >= objetivo - 1, falta, pctNecesario: num(o.post) > 0 ? (brecha / num(o.post)) * 100 : null,
  }
}

// ── Costos: monto 2027 y aumento enlazados en los dos sentidos; sueldos por persona ──
/** Alza que se aplica a una partida: la propia (puede ser negativa) o la del escenario. @param {PartidaCosto} c @param {number} alzaEsc */
export const alzaEfectiva = (c, alzaEsc) => (c.alza == null ? alzaEsc : num(c.alza))
/** Monto de la partida en el año del presupuesto. @param {PartidaCosto} c @param {number} alzaEsc */
export const monto27 = (c, alzaEsc) => num(c.m) * num(c.meses) * (1 + alzaEfectiva(c, alzaEsc) / 100)
/**
 * Cambios que deja escribir el monto 2027 de una partida: el aumento sale del monto contra lo vigente por los meses. Una partida nueva sin monto base lo toma como monto mensual × meses.
 * @param {PartidaCosto} c @param {number} monto
 */
export function fijarMonto27(c, monto) {
  const m = Math.max(0, num(monto)), base = num(c.m) * num(c.meses)
  if (base > 0) return { alza: (m / base - 1) * 100 }
  const meses = num(c.meses) > 0 ? num(c.meses) : 12
  return { m: m / meses, meses, alza: 0 }
}
/** El aumento propio de una partida (negativo para rebajas; nunca bajo −100 %). @param {number} pct */
export const fijarAlza = (pct) => ({ alza: Math.max(-100, num(pct)) })
/**
 * Lo que costó la partida en el año anterior respetando su vigencia: si el monto vigente rige desde un mes de ese año, los meses anteriores van al monto previo.
 * @param {PartidaCosto} c @param {number} anioBase
 */
export function costoAnualBase(c, anioBase) {
  const m = num(c.m) * 12
  if (!c.desde || c.mPrev == null) return m
  const y = Number(String(c.desde).slice(0, 4)), mes = Number(String(c.desde).slice(5, 7))
  if (y < anioBase) return m
  if (y > anioBase) return num(c.mPrev) * 12
  return num(c.mPrev) * (mes - 1) + num(c.m) * (12 - (mes - 1))
}
/** Reajuste reciente de una partida (desde un mes del año base en adelante), para no reajustarla dos veces por error. @param {PartidaCosto} c @param {number} anioBase */
export function reajusteVigente(c, anioBase) {
  if (!c.desde || !(num(c.mPrev) > 0) || Number(String(c.desde).slice(0, 4)) < anioBase) return null
  return { desde: String(c.desde).slice(0, 10), previo: num(c.mPrev), pct: (num(c.m) / num(c.mPrev) - 1) * 100 }
}
/**
 * Reemplaza las partidas agrupadas por categoría de un borrador antiguo (p. ej. «Remuneraciones» en una sola) por las de cada persona, repartiendo el monto que tenía el borrador
 * en proporción a lo vigente de cada una (el total no cambia) y conservando su aumento propio, meses y tipo.
 * @param {PartidaCosto[]} actuales @param {PartidaCosto[]} vigentes
 */
export function desglosarCostos(actuales, vigentes) {
  const grupos = new Set(vigentes.filter((c) => c.g).map((c) => c.g))
  /** @type {PartidaCosto[]} */
  const out = []
  for (const c of actuales) {
    const hijos = c.g || !grupos.has(c.n) ? [] : vigentes.filter((v) => v.g === c.n)
    if (!hijos.length) { out.push(c); continue }
    const suma = sum(hijos.map((h) => num(h.m))), k = suma > 0 ? num(c.m) / suma : 1
    for (const h of hijos) out.push({ ...h, m: Math.round(num(h.m) * k), meses: c.meses, t: c.t, alza: c.alza, id: h.id })
  }
  return out
}

/** Una partida es de una persona si su nombre la contiene (sin tildes ni mayúsculas). @param {string} item @param {string} nombre */
export function esDePersona(item, nombre) {
  const n = (/** @type {string} */ s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  const a = n(item), b = n(nombre)
  return !!a && !!b && (a === b || a.includes(b))
}

/**
 * Sueldos y retiros de los socios: el mismo dinero ya presente en el presupuesto, visto por socio (no se suma a los costos ni cambia Margen ni Retiros).
 * Sueldo 2027 = las partidas de Remuneraciones de la persona con su aumento; sus leyes sociales son costo de la oficina y se informan aparte. Retiros en partes iguales (parteMeta).
 * @param {{ socios:string[], costos:PartidaCosto[], alza:number, retiros:number, real:{ sueldos:Record<string,number>, retiros:Record<string,number> } }} o
 */
export function sueldosYRetiros(o) {
  const filas = o.socios.map((nombre) => {
    const mias = (/** @type {string} */ g) => o.costos.filter((c) => c.g === g && esDePersona(c.n, nombre))
    const sueldo27 = sum(mias('Remuneraciones').map((c) => monto27(c, o.alza))), leyes27 = sum(mias('Leyes sociales').map((c) => monto27(c, o.alza)))
    const sueldo26 = num(o.real.sueldos[nombre]), ret26 = num(o.real.retiros[nombre]), ret27 = o.retiros * parteMeta(o.socios.map((n) => ({ nombre: n })), nombre)
    return { nombre, sueldo26, ret26, tot26: sueldo26 + ret26, sueldo27, ret27, tot27: sueldo27 + ret27, leyes27 }
  })
  const t = (/** @type {keyof typeof filas[0]} */ k) => sum(filas.map((f) => Number(f[k])))
  return { filas, total: { sueldo26: t('sueldo26'), ret26: t('ret26'), tot26: t('tot26'), sueldo27: t('sueldo27'), ret27: t('ret27'), tot27: t('tot27'), leyes27: t('leyes27') } }
}

// ── Moneda: pesos ↔ UF (selector Pesos / UF / Ambos del Presupuesto) ──
/** Pesos → UF con la UF dada. null si falta una UF válida o el monto no es un número (nunca NaN ni Infinity). @param {any} clp @param {any} uf */
export function aUF(clp, uf) {
  const c = Number(clp), u = Number(uf)
  return clp != null && Number.isFinite(c) && Number.isFinite(u) && u > 0 ? c / u : null
}
/** UF → pesos con la UF dada (inversa de aUF). @param {any} ufMonto @param {any} uf */
export function aPesos(ufMonto, uf) {
  const m = Number(ufMonto), u = Number(uf)
  return ufMonto != null && Number.isFinite(m) && Number.isFinite(u) && u > 0 ? m * u : null
}
/** Media de las UF válidas (> 0); null si no hay ninguna. @param {any[]} valores */
export function ufMedia(valores) {
  const v = (valores || []).map(Number).filter((x) => Number.isFinite(x) && x > 0)
  return v.length ? sum(v) / v.length : null
}
/**
 * Suma movimientos fechados en pesos y en UF, cada uno con la UF de su día; los que no tienen UF válida se convierten con `respaldo` (y se cuentan en `sinUF`).
 * @param {{ monto:number, fecha:string }[]} movs @param {(fecha:string)=>number|null|undefined} ufDeFecha @param {number|null} [respaldo]
 */
export function sumaConUF(movs, ufDeFecha, respaldo = null) {
  let clp = 0, uf = 0, sinUF = 0
  for (const m of movs || []) {
    const c = num(m.monto); clp += c
    let u = Number(ufDeFecha(m.fecha)); if (!(u > 0)) { u = Number(respaldo); sinUF++ }
    if (u > 0) uf += c / u
  }
  return { clp, uf, sinUF }
}

/** Resumen por escenario que se guarda con cada versión (y sus facturados mensuales, congelados: la base se mueve cada mes). @param {ReturnType<typeof modeloPresupuesto>} m */
export function resumenModelo(m) {
  const o = /** @type {Record<string, any>} */ ({})
  for (const [k] of ESCENARIOS) {
    const e = m.esc[k]
    o[k] = { fact: e.fact, caja: e.caja, costos: e.costos, terc: e.terc, base: e.base, idpc: e.idpc, post: e.post, retiros: e.retiros, mensual: e.ing, mensualUF: e.ingUF }
  }
  return o
}

/** Etapas del primer diseño (8) → etapas de la segunda versión (5). */
export const ETAPA_ANTIGUA = /** @type {Record<number,number>} */ ({ 0: 0, 1: 1, 2: 3, 3: 3, 4: 2, 5: 3, 6: 3, 7: 4 })

/**
 * Lleva un estado guardado a la versión actual: etapas de 8 → 5 (v2), tasa legal de primera categoría (v3) y la etapa nueva «Metas 2027» en el lugar 4 (v4: las marcas «revisada» y las
 * notas de las etapas desde la 4.ª en adelante se desplazan una posición; se agregan las metas y la reserva mínima). Idempotente.
 * @param {any} st
 */
export function migrarEstado(st, anio = /** @type {number|undefined} */ (undefined), ppmAnualRef = 0) {
  const c = JSON.parse(JSON.stringify(st || {}))
  if (c.v !== 2 && c.v !== 3 && c.v !== 4) {
    const h = new Set(), n = /** @type {Record<string,string>} */ ({})
    ;(c.hecho || []).forEach((/** @type {number} */ i) => { if (ETAPA_ANTIGUA[i] != null) h.add(ETAPA_ANTIGUA[i]) })
    Object.keys(c.notas || {}).sort().forEach((k) => { const t = ETAPA_ANTIGUA[/** @type {any} */ (k)]; if (t == null || !c.notas[k]) return; n[t] = n[t] ? n[t] + ' · ' + c.notas[k] : c.notas[k] })
    c.hecho = [...h]; c.notas = n; c.v = 2
  }
  if (c.v === 2) {
    // v3: la tasa de primera categoría de partida (15 %) pasa a la legal del año comercial (circular SII 53/2025).
    if (anio != null && num(c.tasaIDPC, 15) === 15) c.tasaIDPC = tasaIDPCLegal(anio)
    c.v = 3
  }
  if (c.v === 3) {
    // v4: entra «Metas 2027» como 4.ª etapa; Escenarios y Seguimiento pasan a la 5.ª y 6.ª.
    c.hecho = (c.hecho || []).map((/** @type {number} */ i) => (i >= 3 ? i + 1 : i))
    const n = /** @type {Record<string,string>} */ ({})
    Object.keys(c.notas || {}).forEach((k) => { n[Number(k) >= 3 ? String(Number(k) + 1) : k] = c.notas[k] })
    c.notas = n
    if (c.metas == null) c.metas = { ancla: 'retiros', valor: null, ratio: null }
    if (c.reservaIni == null) c.reservaIni = RESERVA_MINIMA
    c.v = 4
  }
  // El PPM vuelve a ser un monto anual (el pagado hoy); un borrador que alcanzó a guardarse con tasa lo recupera del PPM vigente.
  if (c.ppmAnual == null) c.ppmAnual = Math.round(num(ppmAnualRef))
  delete c.ppmTasa
  return c
}

/**
 * Supuestos que cambian entre dos estados, en texto para el usuario.
 * @param {EstadoPresupuesto} a @param {EstadoPresupuesto} b @param {{ mm:(n:number)=>string, pc:(n:number)=>string }} f
 * @returns {string[]}
 */
export function diferenciaSupuestos(a, b, f) {
  /** @type {string[]} */
  const o = []
  const t = (/** @type {string} */ n, /** @type {any} */ x, /** @type {any} */ y) => { if (x !== y) o.push(`${n}: ${x} → ${y}`) }
  t('Reajuste de la UF', f.pc(a.reajusteUF), f.pc(b.reajusteUF)); t('Tasa de primera categoría', f.pc(a.tasaIDPC), f.pc(b.tasaIDPC)); t('PPM del año', f.mm(a.ppmAnual), f.mm(b.ppmAnual)); t('Reserva de caja', f.pc(a.reserva), f.pc(b.reserva))
  const L = /** @type {Record<string,string>} */ ({ g: 'Crecimiento', alza: 'Alza de costos', terc: 'Comisiones', dias: 'Días de cobro' })
  for (const [k, nom] of ESCENARIOS) for (const campo of Object.keys(L)) t(nom + ' · ' + L[campo], a.p[k][/** @type {keyof Supuestos} */ (campo)], b.p[k][/** @type {keyof Supuestos} */ (campo)])
  const ma = new Map(a.costos.map((c) => [c.id, c])), mb = new Map(b.costos.map((c) => [c.id, c]))
  for (const c of b.costos) {
    const x = ma.get(c.id)
    if (!x) { o.push(`Partida nueva: ${c.n} (${f.mm(c.m)} al mes, ${c.meses} meses)`); continue }
    if (x.n !== c.n) o.push(`Partida «${x.n}» renombrada a «${c.n}»`)
    if (x.m !== c.m) o.push(`${c.n}: ${f.mm(x.m)} → ${f.mm(c.m)} por mes`)
    if (x.meses !== c.meses) o.push(`${c.n}: ${x.meses} → ${c.meses} meses`)
    if (x.alza !== c.alza) o.push(`${c.n}: alza ${x.alza == null ? 'del escenario' : f.pc(x.alza)} → ${c.alza == null ? 'del escenario' : f.pc(c.alza)}`)
    if (x.t !== c.t) o.push(`${c.n}: ${x.t} → ${c.t}`)
  }
  for (const c of a.costos) if (!mb.has(c.id)) o.push(`Partida quitada: ${c.n}`)
  return o
}

/** Meses cerrados más recientes (YYYY-MM), del más antiguo al más reciente: el mes en curso NO cuenta. @param {string} hoyISO @param {number} [n] */
export function ultimosCerrados(hoyISO, n = 12) {
  const y = Number(hoyISO.slice(0, 4)), m = Number(hoyISO.slice(5, 7))
  /** @type {string[]} */
  const out = []
  for (let i = n; i >= 1; i--) { const t = y * 12 + (m - 1) - i; out.push(`${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`) }
  return out
}

/**
 * Base mensual de enero a diciembre del año del presupuesto: cada mes toma el mismo mes calendario del último año cerrado. Un mes sin dato queda en 0 (no se inventa).
 * @param {{ ym:string, clp:number, uf:number }[]} cierres @param {number} ufDic
 * @returns {BasePresupuesto}
 */
export function baseMensual(cierres, ufDic) {
  const baseCLP = Array.from({ length: 12 }, () => 0), baseUF = Array.from({ length: 12 }, () => 0)
  for (const c of cierres) { const i = Number(c.ym.slice(5, 7)) - 1; if (i >= 0 && i < 12) { baseCLP[i] = num(c.clp); baseUF[i] = num(c.uf) } }
  return { baseCLP, baseUF, ufDic }
}

/** Índices de los meses que se salen de lo normal: más de 1,5 veces o menos de la mitad de la mediana. @param {(number|null)[]} montos */
export function mesesAtipicos(montos) {
  const v = montos.filter((x) => x != null && Number.isFinite(Number(x))).map(Number).sort((a, b) => a - b)
  if (v.length < 3) return /** @type {number[]} */ ([])
  const h = v.length >> 1, med = v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2
  return montos.map((x, i) => (x != null && (Number(x) > med * 1.5 || Number(x) < med * 0.5) ? i : -1)).filter((i) => i >= 0)
}

/**
 * Días de cobro de las facturas pagadas emitidas en el año (de la emisión al pago). Sin reembolsos ni notas de crédito.
 * @param {{ status?:string, issued_at?:string|null, paid_at?:string|null, billing_type?:string|null, deleted_at?:string|null }[]} billing @param {number} anio
 */
export function diasDeCobro(billing, anio) {
  const d = (/** @type {any} */ x) => Date.parse(String(x || '').slice(0, 10) + 'T00:00:00Z')
  const v = (billing || [])
    .filter((b) => b && !b.deleted_at && b.status === 'Pagado' && b.issued_at && b.paid_at && String(b.issued_at).slice(0, 4) === String(anio) && !['reembolso', 'nota_credito'].includes(String(b.billing_type || '')))
    .map((b) => Math.round((d(b.paid_at) - d(b.issued_at)) / 86400000)).filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b)
  if (!v.length) return { n: 0, promedio: null, mediana: null }
  const h = v.length >> 1
  return { n: v.length, promedio: Math.round(sum(v) / v.length), mediana: v.length % 2 ? v[h] : Math.round((v[h - 1] + v[h]) / 2) }
}

/** Concentración: parte de lo facturado que suman los `k` primeros clientes. @param {number[]} montosOrdenados de mayor a menor @param {number} total @param {number} [k] */
export function concentracion(montosOrdenados, total, k = 5) {
  return total > 0 ? sum(montosOrdenados.slice(0, k)) / total : 0
}
