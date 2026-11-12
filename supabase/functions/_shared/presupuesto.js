// presupuesto.js — reglas del PRESUPUESTO ANUAL (año siguiente): modelo por escenario, migración del estado guardado, diferencia entre versiones,
// días de cobro y meses atípicos. Funciones puras (sin lectura ni escritura de la base): las usan la vista Presupuesto y, más adelante, los avisos del
// seguimiento. Con prueba en tests/presupuesto.test.mjs.
//
// Plano: CAJA (el régimen Pro Pyme tributa lo percibido menos lo pagado). Sociedad de profesionales exenta de IVA: lo facturado es el neto.

/** @typedef {{ g:number, alza:number, terc:number, dias:number }} Supuestos  g = crecimiento real de ventas (% en UF); alza = alza de costos (%); terc = comisiones (% de lo cobrado); dias = días de cobro */
/** @typedef {{ id:number|string, n:string, m:number, meses:number, t:string, alza:number|null, g?:string, desde?:string|null, mPrev?:number|null, sinBase?:boolean, auto?:boolean }} PartidaCosto  m = monto por mes (el vigente al inicio del año del presupuesto); meses = meses del año; alza propia (null = la del escenario; puede ser negativa); g = grupo de una partida por persona (Remuneraciones, Leyes sociales); desde/mPrev = vigencia de un reajuste (el monto m rige desde `desde`; antes regía mPrev) */
import { brutoDeLiquido, mismaPersona } from './impuestosMensuales.js'
import { CONFIG_DEFECTO, tramoDelAnio } from './presupuestoConfig.js'
import { normalizarArrastre, arrastreVacio, lineasTocadas } from './arrastreAnio.js'

/** Configuración por estudio (presupuestoConfig.js): toda regla que depende del estudio o del país la recibe como `cfg` opcional; sin ella usa el defecto del tenant actual. */
/** @typedef {typeof CONFIG_DEFECTO} CfgPresupuesto */

/**
 * Parte de cada socio en las metas de la oficina: por defecto partes iguales entre los socios (con dos socios, 50 % cada uno); `cfg.socios.reparto` puede traer un mapa { nombre: fracción }. «Sin socio» no tiene meta.
 * @param {{ nombre:string }[]} socios @param {string} nombre @param {CfgPresupuesto} [cfg]
 */
export const parteMeta = (socios, nombre, cfg = CONFIG_DEFECTO) => {
  if (nombre === 'Sin socio') return 0
  const rep = cfg.socios && cfg.socios.reparto
  if (rep && typeof rep === 'object') return Number(rep[nombre]) || 0
  const n = (socios || []).filter((s) => s.nombre !== 'Sin socio').length
  return n ? 1 / n : 0
}

/**
 * Parte «media» por socio (sin nombre): 1 ÷ n de los socios que no son «Sin socio»; con `cfg.socios.reparto`, el promedio de las partes configuradas. Reemplaza el `/ 2` cableado.
 * @param {{ nombre:string }[]} socios @param {CfgPresupuesto} [cfg]
 */
export const partePorSocio = (socios, cfg = CONFIG_DEFECTO) => {
  const rep = cfg.socios && cfg.socios.reparto, n = (socios || []).filter((s) => s.nombre !== 'Sin socio').length
  if (rep && typeof rep === 'object') { const v = Object.values(rep).map(Number).filter((x) => x > 0); return v.length ? v.reduce((a, x) => a + x, 0) / v.length : 0 }
  return n ? 1 / n : 0
}

/**
 * Tasa de primera categoría por año COMERCIAL según el régimen configurado (por defecto Pro Pyme general 14 D N°3: Circular SII N° 53 de 2025, Ley 21.755: 12,5 % hasta 2027, 15 % en 2028 y 25 % desde 2029,
 * siempre que la cotización del empleador (Ley 21.735) sea la del año).
 * @param {number|null|undefined} anio @param {CfgPresupuesto} [cfg]
 */
export const tasaIDPCLegal = (anio, cfg = CONFIG_DEFECTO) => num((tramoDelAnio(cfg.tributario.idpc, num(anio, cfg.tributario.anioPorDefecto)) || { tasa: 0 }).tasa)

/**
 * Tasa legal del PPM de un contribuyente 14 D N°3 (% de los ingresos brutos del giro). Normal: 0,25 % (ingresos del año anterior hasta el umbral, 50.000 UF) o 0,5 % (más);
 * con la rebaja transitoria (ingresos de agosto de 2025 a diciembre de 2027) queda en 0,125 % o 0,25 %. Sin rebaja desde 2028 (Circular SII N° 53 de 2025, § 2.2 y 2.3).
 * @param {number|null|undefined} anio @param {number|null|undefined} ufAnterior ingresos brutos del año anterior en UF @param {CfgPresupuesto} [cfg]
 */
export const tasaPPMLegal = (anio, ufAnterior, cfg = CONFIG_DEFECTO) => {
  const grande = num(ufAnterior) > cfg.tributario.ppm.umbralUF, t = tramoDelAnio(cfg.tributario.ppm.tramos, num(anio, cfg.tributario.anioPorDefecto))
  return t ? num(grande ? t.grande : t.chica) : 0
}

/** @typedef {{ k:string, n:string, t:number }} EscenarioEstado  clave interna (estable), nombre que ve el usuario y tono (índice) */
/** @typedef {{ modo:Record<string,string>, manual:Record<string,number[]> }} Distribucion  modo por componente: 'iguales' (defecto), 'estacional' o 'manual'; manual = pesos de los 12 meses */
/** @typedef {{ v:number, esc:string, escs:EscenarioEstado[], moneda:string, reajusteUF:number, tasaIDPC:number, ppmAnual:number, reserva:number, reservaIni:number, metas:{ancla:string, valor:number|null, ratio:number|null, cv?:number|null, rec?:number, modo?:string, pct?:number|null}, dist:Distribucion, p:Record<string,Supuestos>, costos:PartidaCosto[], hecho:number[], notas:Record<string,string>, basadaEn:string|null, arrastre?:{ ajustes:Record<string,any>, extras:any[] } }} EstadoPresupuesto */
/** @typedef {{ ppmAnual:number, partidas:any[], boletaSet?:string[], tasa?:number, grupo?:string }} ImpuestosMigracion  (las partidas de quien emite boleta traen `boleta:true` y `tasa`: el bruto se calcula con el líquido del estado)  PPM puro del año y las partidas de costos que cambian (bruto de quien emite boleta, impuesto único) para pasar un estado a la versión 7 */
/** @typedef {{ baseCLP:number[], baseUF:number[], ufDic:number }} BasePresupuesto  base de 12 meses (enero a diciembre del año del presupuesto) en pesos y UF, y UF de cierre del año anterior */

// ── Escenarios: una LISTA editable en el estado (`st.escs`: clave, nombre y tono; `st.p[clave]`: sus palancas). Hasta `maxEscenarios`; mínimo uno. ──
// La clave interna `meta` se mantiene para no romper los estados y versiones guardados; solo el rótulo es «Optimista» (la palabra «meta» queda para lo que el usuario fija).
/** Escenarios de partida [clave, nombre] (los del defecto de presupuestoConfig.js). */
export const ESCENARIOS = /** @type {[string,string][]} */ (CONFIG_DEFECTO.escenarios.map((/** @type {any} */ e) => [e.k, e.n]))
export const MAX_ESCENARIOS = /** @type {number} */ (CONFIG_DEFECTO.maxEscenarios)
/** Lista de escenarios del estado como pares [clave, nombre]; un estado sin lista (anterior a v5) usa los de partida. @param {any} st @returns {[string,string][]} */
export const escenariosDe = (st) => (Array.isArray(st && st.escs) && st.escs.length ? st.escs.map((/** @type {EscenarioEstado} */ e) => /** @type {[string,string]} */ ([e.k, e.n])) : ESCENARIOS)
/** Nombre de un escenario del estado (la clave si no existe). @param {any} st @param {string} k */
export const nombreEscenario = (st, k) => (escenariosDe(st).find((x) => x[0] === k) || [k, k])[1]
/** Escenario de referencia de las metas: el configurado (Base) si existe; si no, el primero. @param {any} st @param {CfgPresupuesto} [cfg] */
export const escenarioMetas = (st, cfg = CONFIG_DEFECTO) => { const l = escenariosDe(st); return (l.find((x) => x[0] === cfg.escenarioMetas) || l[0])[0] }

/** Los seis componentes de la cadena Vendido → Facturado → Cobrado → Presupuesto de costos → Margen → Retiros, con el nombre único de toda la app (de la configuración). @param {CfgPresupuesto} [cfg] */
export const componentesDe = (cfg = CONFIG_DEFECTO) => /** @type {[string,string][]} */ (cfg.componentes.map((/** @type {any} */ c) => [c.k, c.n]))
export const COMPONENTES = componentesDe()
/** Nombre corto del componente para las tarjetas del módulo Presupuesto (el largo, `n`, es el de la app y sirve de respaldo). @param {string} k @param {CfgPresupuesto} [cfg] */
export const nombreCorto = (k, cfg = CONFIG_DEFECTO) => { const c = cfg.componentes.find((/** @type {any} */ x) => x.k === k); return c ? (c.corto || c.n) : k }
/** Como `componentesDe`, con el nombre corto. @param {CfgPresupuesto} [cfg] */
export const componentesCortosDe = (cfg = CONFIG_DEFECTO) => /** @type {[string,string][]} */ (cfg.componentes.map((/** @type {any} */ c) => [c.k, c.corto || c.n]))
/** Componentes en los que se puede escribir la meta (el presupuesto de costos se arma en el paso Costos). @param {CfgPresupuesto} [cfg] */
export const anclasDe = (cfg = CONFIG_DEFECTO) => /** @type {string[]} */ (cfg.componentes.filter((/** @type {any} */ c) => c.ancla).map((/** @type {any} */ c) => c.k))
export const ANCLAS = anclasDe()
export const nombreComponente = (/** @type {string} */ k, /** @type {CfgPresupuesto} */ cfg = CONFIG_DEFECTO) => (componentesDe(cfg).find((x) => x[0] === k) || [k, k])[1]
/** Reserva en cuenta corriente al comenzar el año: base fija que no se toca (parámetro del estado, no editable en pantalla). */
export const RESERVA_MINIMA = /** @type {number} */ (CONFIG_DEFECTO.reserva.minima)
/** Regla de la reserva recomendada: meses de costos de oficina a los que llegar, repartidos por trimestre. Recomendación de criterio, editable en la configuración; no es un cálculo oficial. */
export const REGLA_RESERVA = { meses: /** @type {number} */ (CONFIG_DEFECTO.reserva.meses), trimestres: /** @type {number} */ (CONFIG_DEFECTO.reserva.trimestres) }

/** Supuestos de partida de cada escenario: criterio inicial editable (el crecimiento) o el dato real del año anterior (terceros, días de cobro). */
export const PALANCAS_INICIALES = /** @type {Record<string,Supuestos>} */ (Object.fromEntries(CONFIG_DEFECTO.escenarios.map((/** @type {any} */ e) => [e.k, { ...e.p }])))

const sum = (/** @type {number[]} */ a) => a.reduce((x, y) => x + (Number(y) || 0), 0)
const num = (/** @type {any} */ x, d = 0) => { const n = Number(x); return Number.isFinite(n) ? n : d }

/**
 * Estado inicial editable. `terc` y `dias` (reales del año anterior) reemplazan el valor de partida de los escenarios (el primero cuya clave es `prudente` supone cobro más lento: +10 días sobre el real).
 * `anio` (año comercial del presupuesto) define la tasa legal de primera categoría de partida. El PPM parte de lo que se paga hoy (`ppmMes` × 12): supuesto conservador, la tasa legal (tasaPPMLegal) es menor y queda por confirmar con la contadora.
 * @param {{ costos?:PartidaCosto[], terc?:number|null, dias?:number|null, tasa?:number, ppmMes?:number, anio?:number, reajusteUF?:number, reserva?:number, reservaIni?:number, cfg?:CfgPresupuesto }} [o]
 * @returns {EstadoPresupuesto}
 */
export function estadoInicial(o = {}) {
  const cfg = o.cfg || CONFIG_DEFECTO
  const p = /** @type {Record<string,Supuestos>} */ (Object.fromEntries(cfg.escenarios.map((/** @type {any} */ e) => [e.k, { ...e.p }])))
  if (o.terc != null && Number.isFinite(Number(o.terc))) for (const k of Object.keys(p)) p[k].terc = Math.round(Number(o.terc) * 10) / 10
  if (o.dias != null && Number.isFinite(Number(o.dias)) && Number(o.dias) > 0) {
    const d = Math.round(Number(o.dias))
    for (const k of Object.keys(p)) p[k].dias = k === 'prudente' ? Math.max(p[k].dias, d + 10) : d
  }
  const primero = cfg.escenarios.find((/** @type {any} */ e) => e.k === cfg.escenarioMetas) || cfg.escenarios[0]
  return {
    v: 7, esc: primero.k, escs: cfg.escenarios.map((/** @type {any} */ e) => ({ k: e.k, n: e.n, t: e.t })), moneda: 'clp', reajusteUF: num(o.reajusteUF, cfg.moneda.reajusteAnual), tasaIDPC: num(o.tasa, tasaIDPCLegal(o.anio, cfg)), ppmAnual: Math.round(num(o.ppmMes) * 12), reserva: num(o.reserva, cfg.reserva.porcentaje),
    reservaIni: num(o.reservaIni, cfg.reserva.minima), metas: { ancla: cfg.anclaInicial, valor: null, ratio: null }, dist: distribucionInicial(),
    p, costos: (o.costos || []).map((c) => ({ ...c })), hecho: [], notas: {}, basadaEn: null, arrastre: arrastreVacio(),
  }
}

/** Distribución mensual de partida: todos los componentes en partes iguales. @returns {Distribucion} */
export const distribucionInicial = () => ({ modo: {}, manual: {} })

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
  const lista = escenariosDe(st)
  for (const [k] of lista) esc[k] = calculoEscenario(base, st, st.p[k], uf27)
  return { uf27, ufMed, esc, lista }
}

// ── Metas: la misma cascada en los dos sentidos ──
// Retiros ← Margen ← Cobrado ← Facturado ← Vendido, con el presupuesto de costos restando entre Cobrado y Margen. Todo es lineal en el crecimiento real de ventas (g):
// escribir la meta de cualquier componente despeja el g que la produce y vuelve a calcular el resto con la cascada de arriba. Los supuestos de las metas son los del
// escenario Base (comisiones, días de cobro, alza de costos) y los generales (impuesto, reserva); la relación facturado/vendido es una estimación propia (el real, aún sin ciclo completo).

/** Supuestos con que se calculan las metas: los del escenario de referencia (Base). @param {EstadoPresupuesto} st @param {CfgPresupuesto} [cfg] */
export const supuestosMetas = (st, cfg = CONFIG_DEFECTO) => ({ ...st.p[escenarioMetas(st, cfg)] })

// ── Vendido: bruto ↔ neto ──
// La meta de ventas se mide NETA de comisiones a terceros (como la meta de Inicio, metricasAnio().neto = bruto − comisionesVenta). Dos relaciones, cada una sobre su plano:
//  · facturado/vendido (ratio, %): se aplica al vendido BRUTO (lo que se factura es el honorario completo; las comisiones se pagan aparte).
//  · comisión sobre ventas (cv, % del bruto): costo a terceros / bruto observado en el año en curso (d.comisVentaPct, editable en Supuestos).
// Cadena: facturado → bruto = facturado ÷ ratio → neto = bruto × (1 − cv). La inversa de una meta neta: bruto = neto ÷ (1 − cv) → facturado = bruto × ratio. Estimación propia.
/** Vendido NETO a partir del bruto y la comisión sobre ventas (%). @param {number} bruto @param {number|null|undefined} cv */
export const netoDeBruto = (bruto, cv) => bruto * (1 - num(cv) / 100)
/** Vendido BRUTO a partir del neto (inversa de netoDeBruto); null si la comisión no tiene solución (≥ 100 %). @param {number} neto @param {number|null|undefined} cv */
export const brutoDeNeto = (neto, cv) => (num(cv) < 100 ? neto / (1 - num(cv) / 100) : null)
/** Vendido BRUTO a partir de lo facturado, con la relación facturado/vendido (%). @param {number} fact @param {number|null|undefined} ratio */
export const ventasBrutoDeFact = (fact, ratio) => (num(ratio) > 0 ? fact / (num(ratio) / 100) : null)
/** Vendido NETO a partir de lo facturado, con la relación facturado/vendido (%) y la comisión sobre ventas (%; 0 si no se indica). @param {number} fact @param {number|null|undefined} ratio @param {number|null|undefined} [cv] */
export const ventasDeFact = (fact, ratio, cv = 0) => { const b = ventasBrutoDeFact(fact, ratio); return b == null ? null : netoDeBruto(b, cv) }

/**
 * Cascada completa para un crecimiento real `g` (%) con los supuestos de las metas, más Vendido (estimación propia).
 * `ventas` es el vendido NETO (meta de ventas); `ventasBruto` y `comisVentas` lo abren.
 * @param {BasePresupuesto} base @param {EstadoPresupuesto} st @param {number} g @param {number|null} ratio facturado ÷ vendido bruto, en % @param {number} [cv] comisión sobre ventas, % del bruto
 */
export function cadenaMeta(base, st, g, ratio, cv = 0) {
  const { uf27 } = contexto(base, st)
  const e = calculoEscenario(base, st, { ...supuestosMetas(st), g }, uf27)
  const ventasBruto = ventasBrutoDeFact(e.fact, ratio), ventas = ventasBruto == null ? null : netoDeBruto(ventasBruto, cv)
  return { ...e, g, margen: e.base, ventas, ventasBruto, comisVentas: ventasBruto == null || ventas == null ? null : ventasBruto - ventas }
}

/** Valor de un componente en una cascada (escenario o meta). Vendido es el NETO. @param {Record<string,any>} e @param {string} comp @param {number|null|undefined} [ratio] @param {number|null|undefined} [cv] */
export function valorComponente(e, comp, ratio, cv = 0) {
  switch (comp) {
    case 'ventas': return e.ventas != null ? e.ventas : ventasDeFact(e.fact, ratio, cv)
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
 * La meta de ventas es NETA: `o.cv` (comisión sobre ventas, % del bruto) la lleva al bruto antes de aplicar la relación facturado/vendido.
 * @param {BasePresupuesto} base @param {EstadoPresupuesto} st @param {{ componente:string, valor:number, ratio:number|null, cv?:number|null }} o @param {CfgPresupuesto} [cfg]
 */
export function metasDesdeComponente(base, st, o, cfg = CONFIG_DEFECTO) {
  const v = Number(o.valor), cv = num(o.cv)
  if (!anclasDe(cfg).includes(o.componente)) return { ok: false, motivo: 'componente' }
  if (!(v > 0)) return { ok: false, motivo: 'valor' }
  const { F0, pesoDic, b11 } = contexto(base, st)
  if (!(F0 > 0)) return { ok: false, motivo: 'base' }
  const p = supuestosMetas(st, cfg), a = p.dias / 30, den = 1 - a * pesoDic
  let fact
  if (o.componente === 'ventas') {
    if (!(num(o.ratio) > 0)) return { ok: false, motivo: 'ratio' }
    const bruto = brutoDeNeto(v, cv); if (bruto == null) return { ok: false, motivo: 'supuestos' }
    fact = (bruto * num(o.ratio)) / 100
  }
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
  return { ok: true, ...cadenaMeta(base, st, g, o.ratio, cv) }
}

/**
 * Cuánto da cada escenario del componente de la meta, contra la meta: diferencia (escenario − meta) y si la cubre. Sigue la lista de escenarios del modelo, en su orden.
 * @param {ReturnType<typeof modeloPresupuesto>} modelo @param {string} comp @param {number} valor @param {number|null} ratio @param {number|null} [cv]
 */
export function escenariosContraMeta(modelo, comp, valor, ratio, cv = 0) {
  return modelo.lista.map(([k, n]) => { const v = valorComponente(modelo.esc[k], comp, ratio, cv); return { k, n, valor: v, dif: v == null ? null : v - valor, cubre: v != null && v >= valor - 1 } })
}

/** El primer escenario de la lista (en su orden: de menor a mayor ambición) que cubre la meta, o null si ninguno. @param {ReturnType<typeof escenariosContraMeta>} lista */
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
 * @param {{ costosAnio:number, reservaIni:number, reservaAnio:number, post:number, meses?:number, trimestres?:number, cfg?:CfgPresupuesto }} o
 */
export function reservaRecomendada(o) {
  const cfg = o.cfg || CONFIG_DEFECTO
  const meses = o.meses ?? cfg.reserva.meses, tr = o.trimestres ?? cfg.reserva.trimestres
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
  if (c.sinBase || c.id === 'cot-empleador') return 0   // estimación sin monto vigente hoy (p. ej. cotización del empleador, Ley 21.735): no cuenta en el año base
  const m = num(c.m) * 12
  if (!c.desde || c.mPrev == null) return m
  const y = Number(String(c.desde).slice(0, 4)), mes = Number(String(c.desde).slice(5, 7))
  if (y < anioBase) return m
  if (y > anioBase) return num(c.mPrev) * 12
  return num(c.mPrev) * (mes - 1) + num(c.m) * (12 - (mes - 1))
}
/** Lo vigente hoy de una partida por año (monto mensual × 12); una estimación sin base (`sinBase`) no tiene monto vigente. @param {PartidaCosto} c */
export const costoVigente = (c) => (c.sinBase || c.id === 'cot-empleador' ? 0 : num(c.m) * 12)
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
 * @param {{ socios:string[], costos:PartidaCosto[], alza:number, retiros:number, real:{ sueldos:Record<string,number>, retiros:Record<string,number> }, cfg?:CfgPresupuesto }} o
 */
export function sueldosYRetiros(o) {
  const cfg = o.cfg || CONFIG_DEFECTO
  const filas = o.socios.map((nombre) => {
    const mias = (/** @type {string} */ g) => o.costos.filter((c) => c.g === g && esDePersona(c.n, nombre))
    const sueldo27 = sum(mias(cfg.costos.grupoSueldos).map((c) => monto27(c, o.alza))), leyes27 = sum(mias(cfg.costos.grupoLeyes).map((c) => monto27(c, o.alza)))
    const sueldo26 = num(o.real.sueldos[nombre]), ret26 = num(o.real.retiros[nombre]), ret27 = o.retiros * parteMeta(o.socios.map((n) => ({ nombre: n })), nombre, cfg)
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

// ── Seguimiento: presupuesto contra real, mes a mes ──
/** Meses cerrados del año `anio` a la fecha `hoyISO`: el mes en curso no cuenta. @param {string} hoyISO @param {number} anio */
export function mesesCerradosAnio(hoyISO, anio) {
  const y = Number(hoyISO.slice(0, 4)), m = Number(hoyISO.slice(5, 7))
  return anio < y ? 12 : anio > y ? 0 : Math.max(0, Math.min(12, m - 1))
}
/** Reparte un total anual en 12 meses con una estacionalidad (pesos de cada mes); sin pesos válidos, en partes iguales. Las partes suman el total. @param {number} total @param {number[]|null} [pesos] */
export function distribuirMensual(total, pesos = null) {
  const t = num(total), w = (pesos || []).map((x) => Math.max(0, num(x))), sw = sum(w)
  return Array.from({ length: 12 }, (_, i) => (w.length === 12 && sw > 0 ? (t * w[i]) / sw : t / 12))
}

// ── Distribución mensual del presupuesto ──
// Regla decidida (análisis del Registro de Ventas SII, enero a octubre de 2025 y 2026): el facturado mensual no tiene una estacionalidad estable entre un año y otro (pocas facturas grandes mueven los meses),
// así que el presupuesto mensual se reparte por defecto en PARTES IGUALES. Por componente se puede elegir «Estacionalidad» (promedio suavizado de los años observados) o «Manual» (pesos por mes). Estimación propia.
export const MODOS_DIST = /** @type {[string,string][]} */ ([['iguales', 'Partes iguales'], ['estacional', 'Estacionalidad'], ['manual', 'Manual']])
/** Componentes que se distribuyen por mes; el Margen sale de los otros (cobrado − comisiones − costos). */
export const COMPONENTES_DIST = ['ventas', 'fact', 'caja', 'costos', 'retiros']

/**
 * Pesos de estacionalidad: de cada año observado (12 meses, null donde no hay dato o el mes no está cerrado) se toma el peso de cada mes contra el promedio de ese año
 * (así un año más grande no pesa más), se promedian los años y se suaviza con el promedio móvil de tres meses (en los bordes, con los vecinos que existen).
 * Devuelve null si no hay ningún año con datos (el llamador usa partes iguales).
 * @param {(number|null)[][]} anios
 * @returns {number[]|null}
 */
export function pesosEstacionalidad(anios) {
  /** @type {number[][]} */
  const rel = []
  for (const a of anios || []) {
    const v = (a || []).map((x) => (x == null || !Number.isFinite(Number(x)) ? null : Number(x)))
    const ok = v.filter((x) => x != null), prom = ok.length ? sum(/** @type {number[]} */ (ok)) / ok.length : 0
    if (ok.length >= 3 && prom > 0) rel.push(Array.from({ length: 12 }, (_, i) => (v[i] == null ? NaN : /** @type {number} */ (v[i]) / prom)))
  }
  if (!rel.length) return null
  const crudo = Array.from({ length: 12 }, (_, i) => { const x = rel.map((r) => r[i]).filter((y) => Number.isFinite(y)); return x.length ? sum(x) / x.length : NaN })
  const lleno = crudo.map((x) => (Number.isFinite(x) ? x : (() => { const y = crudo.filter((z) => Number.isFinite(z)); return sum(y) / y.length })()))
  return lleno.map((_, i) => { const v = [lleno[i - 1], lleno[i], lleno[i + 1]].filter((z) => z != null); return sum(v) / v.length })
}

/**
 * Pesos de los 12 meses de un componente según su modo de distribución, o null para partes iguales (modo «iguales», sin pesos válidos o sin estacionalidad disponible).
 * @param {Distribucion|null|undefined} dist @param {string} comp @param {number[]|null} [pesosEst] pesos de estacionalidad (pesosEstacionalidad)
 */
export function pesosDe(dist, comp, pesosEst = null) {
  const modo = (dist && dist.modo && dist.modo[comp]) || 'iguales'
  const w = modo === 'estacional' ? pesosEst : modo === 'manual' ? (dist && dist.manual && dist.manual[comp]) || null : null
  return w && w.length === 12 && sum(w.map((x) => Math.max(0, num(x)))) > 0 ? w.map((x) => Math.max(0, num(x))) : null
}

/** Reparte el total anual de un componente en 12 meses con su distribución elegida. Las partes suman el total. @param {number} total @param {Distribucion|null|undefined} dist @param {string} comp @param {number[]|null} [pesosEst] */
export const repartoMensual = (total, dist, comp, pesosEst = null) => distribuirMensual(total, pesosDe(dist, comp, pesosEst))

/** Resumen en una línea de la distribución elegida. @param {Distribucion|null|undefined} dist @param {(c:string)=>string} nombre */
export function resumenDistribucion(dist, nombre) {
  const otros = COMPONENTES_DIST.filter((c) => ((dist && dist.modo && dist.modo[c]) || 'iguales') !== 'iguales')
  if (!otros.length) return 'partes iguales'
  const t = /** @type {Record<string,string>} */ ({ estacional: 'estacionalidad', manual: 'manual' })
  return otros.map((c) => `${nombre(c).toLowerCase()} ${t[/** @type {string} */ (dist && dist.modo[c])]}`).join(' · ')
}
/**
 * Presupuesto contra real mes a mes de un componente. Un mes cuenta para la desviación solo si está cerrado y tiene real; el cierre proyectado es el real de esos meses más el presupuesto de los demás.
 * Sin presupuesto (null) en ningún mes no hay desviación ni cierre.
 * `curso` (por defecto sí) = el mes que sigue al último cerrado está en curso; en un año futuro no hay mes en curso.
 * @param {{ pres:(number|null)[], real:(number|null)[], cerrados:number, curso?:boolean }} o
 */
export function seguimientoMensual(o) {
  const curso = o.curso !== false
  const hayP = o.pres.some((x) => x != null)
  let presAcum = 0, realAcum = 0, resto = 0
  const meses = Array.from({ length: 12 }, (_, i) => {
    const p = o.pres[i] ?? null, r = i < o.cerrados ? o.real[i] ?? null : null, cuenta = r != null
    if (cuenta) { realAcum += r; presAcum += num(p) } else resto += num(p)
    return { i, pres: p, real: r, des: cuenta && p != null ? r - p : null, estado: i < o.cerrados ? 'cerrado' : curso && i === o.cerrados ? 'curso' : 'venir' }
  })
  const des = hayP ? realAcum - presAcum : null
  return { meses, presAcum: hayP ? presAcum : null, realAcum, des, desPct: hayP && presAcum && des != null ? (des / presAcum) * 100 : null, cierre: hayP ? realAcum + resto : null }
}

// ── Escenarios editables: crear (duplicando uno), renombrar, eliminar y reordenar. Funciones puras: devuelven un estado nuevo y no tocan el recibido. ──
/** Largo máximo del nombre de un escenario (cabe en la tarjeta y en la columna de las tablas). */
export const MAX_NOMBRE_ESCENARIO = 24
/** Nombre de escenario limpio: sin espacios sobrantes y de largo acotado; vacío si no quedó nada. @param {any} n */
export const nombreEscenarioLimpio = (n) => String(n == null ? '' : n).replace(/\s+/g, ' ').trim().slice(0, MAX_NOMBRE_ESCENARIO)
/** Primer índice de tono que ningún escenario usa (los tonos rotan: con más escenarios que tonos, se repiten). @param {EscenarioEstado[]} escs @param {number} nTonos */
const tonoLibre = (escs, nTonos) => { for (let t = 0; t < nTonos; t++) if (!escs.some((e) => e.t === t)) return t; return escs.length % nTonos }
/** Cantidad de tonos de escenario disponibles (la paleta de la interfaz usa la misma cantidad). */
export const N_TONOS_ESC = 5

/**
 * Agrega un escenario copiando las palancas de `deK` (su nombre con «copia»); queda al final y pasa a ser el elegido. Con el máximo de escenarios, devuelve el estado sin cambios.
 * @param {EstadoPresupuesto} st @param {string} deK @param {CfgPresupuesto} [cfg]
 */
export function duplicarEscenario(st, deK, cfg = CONFIG_DEFECTO) {
  const c = /** @type {EstadoPresupuesto} */ (JSON.parse(JSON.stringify(st))), lista = c.escs || []
  const origen = lista.find((e) => e.k === deK)
  if (!origen || lista.length >= cfg.maxEscenarios) return c
  let n = 1; while (lista.some((e) => e.k === 'e' + n)) n++
  const k = 'e' + n
  let nombre = nombreEscenarioLimpio(origen.n + ' (copia)')
  for (let i = 2; lista.some((e) => e.n === nombre); i++) nombre = nombreEscenarioLimpio(origen.n.slice(0, MAX_NOMBRE_ESCENARIO - 5) + ' (copia ' + i + ')')
  lista.push({ k, n: nombre, t: tonoLibre(lista, N_TONOS_ESC) })
  c.escs = lista; c.p[k] = { ...c.p[deK] }; c.esc = k
  return c
}

/** Cambia el nombre de un escenario (no se acepta vacío). @param {EstadoPresupuesto} st @param {string} k @param {string} nombre */
export function renombrarEscenario(st, k, nombre) {
  const c = /** @type {EstadoPresupuesto} */ (JSON.parse(JSON.stringify(st))), n = nombreEscenarioLimpio(nombre), e = (c.escs || []).find((x) => x.k === k)
  if (e && n) e.n = n
  return c
}

/** Elimina un escenario; queda al menos uno. Si era el elegido, pasa al siguiente (o al anterior si era el último). @param {EstadoPresupuesto} st @param {string} k */
export function eliminarEscenario(st, k) {
  const c = /** @type {EstadoPresupuesto} */ (JSON.parse(JSON.stringify(st))), lista = c.escs || [], i = lista.findIndex((e) => e.k === k)
  if (i < 0 || lista.length <= 1) return c
  lista.splice(i, 1); delete c.p[k]; c.escs = lista
  if (c.esc === k) c.esc = lista[Math.min(i, lista.length - 1)].k
  return c
}

/** Mueve un escenario una posición (-1 antes, +1 después). @param {EstadoPresupuesto} st @param {string} k @param {number} dir */
export function moverEscenario(st, k, dir) {
  const c = /** @type {EstadoPresupuesto} */ (JSON.parse(JSON.stringify(st))), lista = c.escs || [], i = lista.findIndex((e) => e.k === k), j = i + (dir < 0 ? -1 : 1)
  if (i < 0 || j < 0 || j >= lista.length) return c
  const [e] = lista.splice(i, 1); lista.splice(j, 0, e); c.escs = lista
  return c
}

/** Resumen por escenario que se guarda con cada versión (y sus facturados mensuales, congelados: la base se mueve cada mes). @param {ReturnType<typeof modeloPresupuesto>} m */
export function resumenModelo(m) {
  const o = /** @type {Record<string, any>} */ ({})
  for (const [k] of m.lista) {
    const e = m.esc[k]
    o[k] = { fact: e.fact, caja: e.caja, costos: e.costos, terc: e.terc, base: e.base, idpc: e.idpc, post: e.post, retiros: e.retiros, mensual: e.ing, mensualUF: e.ingUF }
  }
  return o
}

/** Etapas del primer diseño (8) → etapas de la segunda versión (5). */
export const ETAPA_ANTIGUA = /** @type {Record<number,number>} */ ({ 0: 0, 1: 1, 2: 3, 3: 3, 4: 2, 5: 3, 6: 3, 7: 4 })

/**
 * Lleva un estado guardado a la versión actual: etapas de 8 → 5 (v2), tasa legal de primera categoría (v3) y la etapa nueva «Metas 2027» en el lugar 4 (v4: las marcas «revisada» y las
 * notas de las etapas desde la 4.ª en adelante se desplazan una posición; se agregan las metas y la reserva en cuenta corriente) y los ajustes del Arrastre (v6). Idempotente.
 * @param {any} st
 */
export function migrarEstado(st, anio = /** @type {number|undefined} */ (undefined), ppmAnualRef = 0, cfg = CONFIG_DEFECTO, imp = /** @type {ImpuestosMigracion|null} */ (null), sellar = true) {
  const c = JSON.parse(JSON.stringify(st || {}))
  if (c.v !== 2 && c.v !== 3 && c.v !== 4 && c.v !== 5 && c.v !== 6 && c.v !== 7) {
    const h = new Set(), n = /** @type {Record<string,string>} */ ({})
    ;(c.hecho || []).forEach((/** @type {number} */ i) => { if (ETAPA_ANTIGUA[i] != null) h.add(ETAPA_ANTIGUA[i]) })
    Object.keys(c.notas || {}).sort().forEach((k) => { const t = ETAPA_ANTIGUA[/** @type {any} */ (k)]; if (t == null || !c.notas[k]) return; n[t] = n[t] ? n[t] + ' · ' + c.notas[k] : c.notas[k] })
    c.hecho = [...h]; c.notas = n; c.v = 2
  }
  if (c.v === 2) {
    // v3: la tasa de primera categoría de partida (15 %) pasa a la legal del año comercial (circular SII 53/2025).
    if (anio != null && num(c.tasaIDPC, 15) === 15) c.tasaIDPC = tasaIDPCLegal(anio, cfg)
    c.v = 3
  }
  if (c.v === 3) {
    // v4: entra «Metas 2027» como 4.ª etapa; Escenarios y Seguimiento pasan a la 5.ª y 6.ª.
    c.hecho = (c.hecho || []).map((/** @type {number} */ i) => (i >= 3 ? i + 1 : i))
    const n = /** @type {Record<string,string>} */ ({})
    Object.keys(c.notas || {}).forEach((k) => { n[Number(k) >= 3 ? String(Number(k) + 1) : k] = c.notas[k] })
    c.notas = n
    if (c.metas == null) c.metas = { ancla: 'retiros', valor: null, ratio: null }
    if (c.reservaIni == null) c.reservaIni = cfg.reserva.minima
    c.v = 4
  }
  if (c.v === 4) {
    // v5: los tres escenarios fijos pasan a una lista editable (`escs`), con el mismo orden, nombres y claves (`meta` sigue siendo «Optimista»); se agrega la distribución mensual (partes iguales).
    if (!Array.isArray(c.escs) || !c.escs.length) {
      const claves = Object.keys(c.p || {})
      c.escs = cfg.escenarios.filter((/** @type {any} */ e) => claves.length === 0 || claves.includes(e.k)).map((/** @type {any} */ e) => ({ k: e.k, n: e.n, t: e.t }))
      for (const k of claves) if (!c.escs.some((/** @type {EscenarioEstado} */ e) => e.k === k)) c.escs.push({ k, n: k, t: c.escs.length })
    }
    if (!c.escs.some((/** @type {EscenarioEstado} */ e) => e.k === c.esc)) c.esc = c.escs[0].k
    c.p = c.p || {}
    for (const e of c.escs) if (!c.p[e.k]) c.p[e.k] = { ...((cfg.escenarios.find((/** @type {any} */ x) => x.k === e.k) || cfg.escenarios[0]).p) }
    if (c.dist == null) c.dist = distribucionInicial()
    c.v = 5
  }
  if (c.v === 5) {
    // v6: el paso Arrastre guarda los ajustes del usuario sobre sus líneas (cuotas por venta y asesorías) y las líneas que agregó a mano.
    c.arrastre = normalizarArrastre(c.arrastre)
    c.v = 6
  }
  if (c.v === 6) {
    // v7: «Impuestos mensuales» desglosados. El PPM del año pasa a ser el PPM puro (promedio de los F29 declarados; antes mezclaba retención e impuesto único) y las partidas de costos suman el bruto de quien emite boleta y el impuesto único de trabajadores.
    // Solo se corrige con datos (`imp`); sin ellos (versiones guardadas, que son fotos) el estado queda tal cual.
    c.arrastre = normalizarArrastre(c.arrastre)
    if (imp && sellar) {   // sin sellar (fuentes incompletas) el estado queda idéntico: lo que se escribe como v6 se corrige entero en la próxima carga buena
      if (num(imp.ppmAnual) > 0) c.ppmAnual = Math.round(num(imp.ppmAnual))
      c.costos = Array.isArray(c.costos) ? c.costos : []
      // Quien emite boleta: se busca en las partidas del ESTADO (no en los datos) y su bruto sale del líquido que el usuario dejó.
      if (num(imp.tasa) > 0 && imp.grupo) c.costos = c.costos.map((/** @type {any} */ x) => (x && x.g === imp.grupo && !x.boleta && (imp.boletaSet || []).some((/** @type {string} */ nom) => mismaPersona(nom, x.n)) ? { ...x, boleta: true, liq: num(x.m), m: brutoDeLiquido(num(x.m), num(imp.tasa)) } : x))
      for (const p of imp.partidas || []) {
        const i = c.costos.findIndex((/** @type {any} */ x) => x && x.id === p.id)
        if (i < 0) { c.costos.push({ ...p }); continue }
        // Quien emite boleta: el bruto sale del líquido que trae el ESTADO (el que el usuario dejó), no del de los datos.
        if (p.boleta) c.costos[i] = { ...c.costos[i], boleta: true, liq: num(c.costos[i].m), m: num(p.tasa) > 0 ? brutoDeLiquido(num(c.costos[i].m), num(p.tasa)) : num(p.m) }
        else c.costos[i] = { ...c.costos[i], ...p }
      }
    }
    if (sellar) c.v = 7
  }
  if (c.v === 7 || (!sellar && c.v === 6)) c.arrastre = normalizarArrastre(c.arrastre)
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
  t('Reajuste de la UF', f.pc(a.reajusteUF), f.pc(b.reajusteUF)); t('Tasa de primera categoría', f.pc(a.tasaIDPC), f.pc(b.tasaIDPC)); t('PPM del año', f.mm(a.ppmAnual), f.mm(b.ppmAnual)); t('Aumento de reserva', f.pc(a.reserva), f.pc(b.reserva))
  const L = /** @type {Record<string,string>} */ ({ g: 'Crecimiento', alza: 'Alza de costos', terc: 'Comisiones', dias: 'Días de cobro' })
  const la = escenariosDe(a), lb = escenariosDe(b)
  for (const [k, nom] of lb) {
    const antes = la.find((x) => x[0] === k)
    if (!antes) { o.push(`Escenario nuevo: ${nom}`); continue }
    if (antes[1] !== nom) o.push(`Escenario «${antes[1]}» renombrado a «${nom}»`)
    for (const campo of Object.keys(L)) t(nom + ' · ' + L[campo], (a.p[k] || {})[/** @type {keyof Supuestos} */ (campo)], (b.p[k] || {})[/** @type {keyof Supuestos} */ (campo)])
  }
  for (const [k, nom] of la) if (!lb.some((x) => x[0] === k)) o.push(`Escenario quitado: ${nom}`)
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

/**
 * Diferencias entre dos estados del presupuesto en forma estructurada {grupo, etiqueta, antes, despues}: Supuestos, Arrastre, Costos, Metas y Notas (con las metas y las notas de los pasos).
 * `diferenciaSupuestos` (texto) queda sobre las mismas comparaciones; esta es la que alimenta la página «Comparar versiones». Solo devuelve lo que cambió.
 * @param {EstadoPresupuesto} a @param {EstadoPresupuesto} b @param {{ mm:(n:number)=>string, pc:(n:number)=>string, nombreComp?:(k:string)=>string, paso?:(i:number)=>string, totalArrastre?:(e:EstadoPresupuesto)=>number }} f
 * @returns {{ grupo:string, etiqueta:string, antes:string, despues:string }[]}
 */
export function diferenciaEstructurada(a, b, f) {
  /** @type {{ grupo:string, etiqueta:string, antes:string, despues:string }[]} */
  const o = []
  const t = (/** @type {string} */ g, /** @type {string} */ n, /** @type {any} */ x, /** @type {any} */ y) => { if (x !== y) o.push({ grupo: g, etiqueta: n, antes: String(x), despues: String(y) }) }
  t('Supuestos', 'Reajuste de la UF', f.pc(a.reajusteUF), f.pc(b.reajusteUF)); t('Supuestos', 'Tasa de primera categoría', f.pc(a.tasaIDPC), f.pc(b.tasaIDPC)); t('Supuestos', 'PPM del año', f.mm(a.ppmAnual), f.mm(b.ppmAnual)); t('Supuestos', 'Aumento de reserva', f.pc(a.reserva), f.pc(b.reserva)); t('Supuestos', 'Reserva en cuenta corriente', f.mm(a.reservaIni), f.mm(b.reservaIni))
  const L = /** @type {Record<string,string>} */ ({ g: 'Crecimiento', alza: 'Alza de costos', terc: 'Comisiones', dias: 'Días de cobro' })
  const la = escenariosDe(a), lb = escenariosDe(b)
  for (const [k, nom] of lb) {
    const antes = la.find((x) => x[0] === k)
    if (!antes) { o.push({ grupo: 'Supuestos', etiqueta: 'Escenario', antes: '—', despues: nom }); continue }
    if (antes[1] !== nom) o.push({ grupo: 'Supuestos', etiqueta: 'Escenario renombrado', antes: antes[1], despues: nom })
    for (const campo of Object.keys(L)) { const x = (a.p[k] || {})[/** @type {keyof Supuestos} */ (campo)], y = (b.p[k] || {})[/** @type {keyof Supuestos} */ (campo)]; if (x !== y) o.push({ grupo: 'Supuestos', etiqueta: nom + ' · ' + L[campo], antes: campo === 'dias' ? `${x} d` : f.pc(x), despues: campo === 'dias' ? `${y} d` : f.pc(y) }) }
  }
  for (const [k, nom] of la) if (!lb.some((x) => x[0] === k)) o.push({ grupo: 'Supuestos', etiqueta: 'Escenario', antes: nom, despues: '—' })
  // Arrastre: cuántas líneas cambió el usuario (ajustadas, quitadas o agregadas) y, si se entrega `totalArrastre`, el total que resulta de cada estado sobre las líneas de hoy.
  const la2 = lineasTocadas(a.arrastre), lb2 = lineasTocadas(b.arrastre)
  if (la2 !== lb2) o.push({ grupo: 'Arrastre', etiqueta: 'Líneas ajustadas', antes: String(la2), despues: String(lb2) })
  if (f.totalArrastre) { const ta = f.totalArrastre(a), tb = f.totalArrastre(b); if (Math.abs(ta - tb) >= 1) o.push({ grupo: 'Arrastre', etiqueta: 'Total del arrastre', antes: f.mm(ta), despues: f.mm(tb) }) }
  const ma = new Map(a.costos.map((c) => [c.id, c])), mb = new Map(b.costos.map((c) => [c.id, c]))
  for (const c of b.costos) {
    const x = ma.get(c.id)
    if (!x) { o.push({ grupo: 'Costos', etiqueta: 'Partida', antes: '—', despues: `${c.n} · ${f.mm(c.m)} por mes, ${c.meses} meses` }); continue }
    if (x.n !== c.n) o.push({ grupo: 'Costos', etiqueta: 'Partida renombrada', antes: x.n, despues: c.n })
    if (x.m !== c.m) o.push({ grupo: 'Costos', etiqueta: `${c.n} · por mes`, antes: f.mm(x.m), despues: f.mm(c.m) })
    if (x.meses !== c.meses) o.push({ grupo: 'Costos', etiqueta: `${c.n} · meses`, antes: String(x.meses), despues: String(c.meses) })
    if (x.alza !== c.alza) o.push({ grupo: 'Costos', etiqueta: `${c.n} · alza`, antes: x.alza == null ? 'del escenario' : f.pc(x.alza), despues: c.alza == null ? 'del escenario' : f.pc(c.alza) })
  }
  for (const c of a.costos) if (!mb.has(c.id)) o.push({ grupo: 'Costos', etiqueta: 'Partida', antes: c.n, despues: '—' })
  const nc = f.nombreComp || ((/** @type {string} */ k) => k), ma2 = a.metas || { ancla: null, valor: null }, mb2 = b.metas || { ancla: null, valor: null }
  if (ma2.ancla !== mb2.ancla) o.push({ grupo: 'Metas', etiqueta: 'Meta escrita en', antes: ma2.ancla ? nc(ma2.ancla) : '—', despues: mb2.ancla ? nc(mb2.ancla) : '—' })
  if ((ma2.valor ?? null) !== (mb2.valor ?? null)) o.push({ grupo: 'Metas', etiqueta: `Valor de la meta${mb2.ancla ? ' · ' + nc(mb2.ancla) : ''}`, antes: ma2.valor == null ? '—' : f.mm(ma2.valor), despues: mb2.valor == null ? '—' : f.mm(mb2.valor) })
  if ((ma2.rec || 0) !== (mb2.rec || 0)) o.push({ grupo: 'Metas', etiqueta: 'Recuperación de cartera', antes: f.mm(ma2.rec || 0), despues: f.mm(mb2.rec || 0) })
  const na = a.notas || {}, nb = b.notas || {}, paso = f.paso || ((/** @type {number} */ i) => `Paso ${i + 1}`)
  for (const i of [...new Set([...Object.keys(na), ...Object.keys(nb)])].sort()) { const x = String(na[i] || '').trim(), y = String(nb[i] || '').trim(); if (x !== y) o.push({ grupo: 'Notas', etiqueta: paso(Number(i)), antes: x || '—', despues: y || '—' }) }
  return o
}

/**
 * Contra qué se mide el Seguimiento de un año: con versión OFICIAL del presupuesto de ese año, contra ella (cubre los seis componentes); sin oficial, los años desde `primerAnio` (el primer año con presupuesto en la app, 2027)
 * se miden contra el borrador y el año en curso anterior a eso (2026), contra las metas de ventas y cobranza y el presupuesto de costos del año. @param {{ actual:boolean, hayOficial:boolean, anio?:number, primerAnio?:number }} o @returns {'oficial'|'metas'|'borrador'}
 */
export const referenciaSeguimiento = ({ actual, hayOficial, anio, primerAnio = 2027 }) => (hayOficial ? 'oficial' : actual && !(Number(anio) >= primerAnio) ? 'metas' : 'borrador')

/**
 * Cotización adicional del empleador (Ley 21.735) que el presupuesto del año suma sobre lo que ya incluye la base de remuneraciones: por cada mes del año,
 * (tasa vigente ese mes − tasa vigente en el mes de la base) × remuneración imponible mensual del equipo; solo cuenta lo que SUBE (nunca resta). Estimación propia.
 * @param {{ anio:number, imponibleMensual:number, baseYM:string, calendario:{desde:string,pct:number}[] }} o
 * @returns {{ total:number, tasaBase:number, meses:{ ym:string, tasa:number, extra:number }[] }}
 */
/**
 * Retiros + sueldos por socio (página Retiros): total de cada socio = sus retiros + sus sueldos, y Oficina = suma de los socios; todo en enteros, así las partes suman al peso.
 * @param {{ socios:string[], retiros:Record<string,number>, sueldos:Record<string,number> }} o
 * @returns {{ filas:{socio:string, retiros:number, sueldos:number, total:number}[], oficina:{retiros:number, sueldos:number, total:number} }}
 */
export function totalesSocios({ socios, retiros, sueldos }) {
  const filas = (socios || []).map((s) => { const r = Math.round(num((retiros || {})[s])), w = Math.round(num((sueldos || {})[s])); return { socio: s, retiros: r, sueldos: w, total: r + w } })
  const oficina = filas.reduce((a, f) => ({ retiros: a.retiros + f.retiros, sueldos: a.sueldos + f.sueldos, total: a.total + f.total }), { retiros: 0, sueldos: 0, total: 0 })
  return { filas, oficina }
}
/** Partida automática del subarriendo: negativa (rebaja el arriendo; lo que paga el subarrendatario incluye otros costos prorrateados). La identifica el id 'subarriendo-oficina'. */
export const ID_SUBARRIENDO = 'subarriendo-oficina'
export const NOMBRE_SUBARRIENDO = 'Subarriendo y gastos recuperados'
/** Partida del subarriendo a partir de lo anual en CLP de las ventas de subarriendo activas (monto mensual × 12, sin alza propia); null si no hay. @param {number} anual @returns {PartidaCosto|null} */
export function partidaSubarriendo(anual) { const a = Math.round(num(anual)); return a > 0 ? { id: ID_SUBARRIENDO, n: NOMBRE_SUBARRIENDO, m: -Math.round(a / 12), meses: 12, t: 'fijo', alza: 0, auto: true } : null }
/** Costos brutos (partidas positivas), subarriendo (negativas) y netos de un presupuesto de costos 2027 con el alza del escenario. @param {PartidaCosto[]} costos @param {number} alza */
export function costosBrutosNetos(costos, alza) {
  const v = (/** @type {PartidaCosto} */ c) => num(c.m) * num(c.meses) * (1 + (c.alza == null ? alza : num(c.alza)) / 100)
  const brutos = (costos || []).filter((c) => num(c.m) >= 0).reduce((a, c) => a + v(c), 0), sub = (costos || []).filter((c) => num(c.m) < 0).reduce((a, c) => a + v(c), 0)
  return { brutos, subarriendo: sub, netos: brutos + sub }
}
/** Nombre de la partida automática del alza de cotización del empleador (Ley 21.735); la identifica el id 'cot-empleador'. */
export const NOMBRE_COT_EMPLEADOR = 'Alza de cotización del empleador (estimación)'
/** Borradores guardados con el rótulo antiguo («Cotización empleador (estimación)»): se muestra el nuevo; un nombre escrito a mano no se toca. @param {PartidaCosto[]} costos */
export function migrarRotuloCotEmpleador(costos) {
  return (costos || []).map((c) => (c && c.id === 'cot-empleador' && c.n === 'Cotización empleador (estimación)' ? { ...c, n: NOMBRE_COT_EMPLEADOR } : c))
}
export function cotizacionEmpleador({ anio, imponibleMensual, baseYM, calendario }) {
  const cal = [...(calendario || [])].sort((a, b) => String(a.desde).localeCompare(String(b.desde)))
  const tasaEn = (/** @type {string} */ ym) => { let t = 0; for (const x of cal) if (String(x.desde) <= ym) t = Number(x.pct) || 0; return t }
  const imp = Math.max(0, Number(imponibleMensual) || 0), tasaBase = tasaEn(String(baseYM || ''))
  const meses = Array.from({ length: 12 }, (_, i) => { const ym = `${anio}-${String(i + 1).padStart(2, '0')}`, tasa = tasaEn(ym); return { ym, tasa, extra: Math.max(0, tasa - tasaBase) / 100 * imp } })
  return { total: meses.reduce((a, m) => a + m.extra, 0), tasaBase, meses }
}
