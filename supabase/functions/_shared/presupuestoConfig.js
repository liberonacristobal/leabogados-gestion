// presupuestoConfig.js — configuración del PRESUPUESTO por estudio (vendible por diseño). Lo que antes estaba cableado a «Liberona / Chile / Pro Pyme» vive aquí, con los
// valores del tenant actual como defecto. `configPresupuesto(override)` mezcla lo que traiga el estudio (hoy `BRAND.presupuesto`, si existe) sobre el defecto; las reglas de
// presupuesto.js reciben el resultado como `cfg` (opcional: sin él usan CONFIG_DEFECTO y reproducen exactamente las cifras de siempre; prueba en tests/presupuestoConfig.test.mjs).
//
// Qué es configurable: lista de componentes de las metas (clave, nombre, tono, ícono, orden), escenarios de partida y sus palancas, reserva en cuenta corriente y regla de reserva, reparto
// de las metas entre socios, reglas tributarias por régimen y año (tasa de primera categoría y PPM legal), categorías de costo fijas y por persona, y la moneda reajustable (módulo país).
// Los textos del régimen (PPM, F29, abril, IVA) salen de `tributario.textos` y la lista de socios de `socios.lista` (por defecto, los administradores de la app). Lo guardado por el estudio vive en la tabla
// `presupuesto_config` (solo diferencias; supabase/migrations). Sigue cableada la fuente de la UF (mindicador.cl, en compartido.jsx).

/** @typedef {{ k:string, n:string, tono:string, ic:string, ancla:boolean }} ComponenteCfg  tono = clave del tono de tarjeta (a, y, g, t, r, w); ic = ícono; ancla = se puede escribir su meta */
/** @typedef {{ g:number, alza:number, terc:number, dias:number }} PalancasCfg */
/** @typedef {{ k:string, n:string, t:number, p:PalancasCfg }} EscenarioCfg  t = índice de tono del escenario */

export const CONFIG_DEFECTO = /** @type {any} */ ({
  pais: 'CL',
  /**
   * Cotización adicional del empleador (Ley 21.735, reforma de pensiones): calendario del aporte TOTAL del empleador sobre la remuneración imponible (con tope imponible): 1 % desde ago-2025, 3,5 % desde ago-2026,
   * 4,25 % desde ago-2027, 5 % desde ago-2028 (con incrementos posteriores a definir). Fuentes: KPMG, ChileAtiende y la tabla de la circular SII 53/2025. Estimación: se confirma con la contadora.
   */
  previsional: { empleador: [{ desde: '2025-08', pct: 1 }, { desde: '2026-08', pct: 3.5 }, { desde: '2027-08', pct: 4.25 }, { desde: '2028-08', pct: 5 }] },
  /** Primer año con presupuesto en la app: desde ese año el Seguimiento se mide contra la versión oficial (o el borrador); antes, contra las metas del año. */
  primerAnio: 2027,
  /** Los seis componentes de la cadena Vendido → Facturado → Cobrado → Presupuesto de costos → Margen → Retiros, con el nombre único de toda la app. */
  componentes: [
    { k: 'ventas', n: 'Vendido', tono: 'a', ic: 'ventas', ancla: true },
    { k: 'fact', n: 'Facturado', tono: 'y', ic: 'fact', ancla: true },
    { k: 'caja', n: 'Cobrado', tono: 'g', ic: 'wal', ancla: true },
    { k: 'costos', n: 'Presupuesto de costos', tono: 't', ic: 'egr', ancla: false },
    { k: 'margen', n: 'Margen', tono: 'w', ic: 'tax', ancla: true },
    { k: 'retiros', n: 'Retiros', tono: 'r', ic: 'ing', ancla: true },
  ],
  /** Componente cuya meta se escribe al partir. */
  anclaInicial: 'retiros',
  /** Escenarios de partida y sus palancas: criterio inicial editable (crecimiento) o dato real del año anterior (comisiones, días de cobro, que reemplazan al de partida). La clave `meta` se mantiene por compatibilidad con lo guardado. */
  escenarios: [
    { k: 'prudente', n: 'Prudente', t: 0, p: { g: 0, alza: 6, terc: 24.4, dias: 35 } },
    { k: 'base', n: 'Base', t: 1, p: { g: 10, alza: 4.5, terc: 24.4, dias: 24 } },
    { k: 'meta', n: 'Optimista', t: 2, p: { g: 25, alza: 4.5, terc: 24.4, dias: 24 } },
  ],
  /** Escenario cuyos supuestos usan las metas (si no existe, el primero de la lista). */
  escenarioMetas: 'base',
  maxEscenarios: 5,
  /** Reserva de caja: en cuenta corriente al comenzar el año (no se toca), % del resultado después de impuesto que se agrega a la reserva (0 por defecto: solo aumenta si el usuario lo fija o adopta la recomendada), y la regla recomendada (meses de costos a los que llegar, repartidos por trimestre). */
  reserva: { minima: 30_000_000, porcentaje: 0, meses: 3, trimestres: 4 },
  /** Reparto de las metas entre socios: 'iguales' o un mapa { nombre: fracción }. «Sin socio» no tiene meta. */
  socios: { reparto: 'iguales', lista: null },   // lista = nombres de los socios del estudio; null = los administradores de la app (ADMIN_NAMES)
  /** Categorías de costo: cuáles son fijas (el resto es discrecional), cuáles van por persona (una partida por fila) y cuáles son el sueldo y las leyes sociales de un socio. */
  costos: {
    fijas: ['Remuneraciones', 'Leyes sociales', 'Arriendo y espacio', 'Arriendo y GGCC', 'Contadora'],
    porPersona: ['Remuneraciones', 'Leyes sociales'],
    grupoSueldos: 'Remuneraciones',
    grupoLeyes: 'Leyes sociales',
  },
  /** Módulo país: moneda reajustable (UF en Chile), su reajuste anual de partida y los nombres del selector. */
  moneda: { simbolo: '$', unidad: 'UF', reajusteAnual: 3.5, nombres: { clp: 'Pesos', uf: 'UF', ambos: 'Pesos y UF' } },
  /**
   * Reglas tributarias por régimen y año COMERCIAL. Chile, Pro Pyme general (14 D N°3): Circular SII N° 53 de 2025 (Ley 21.755): primera categoría 12,5 % hasta 2027, 15 % en 2028 y 25 % desde 2029 (cuando la cotización del empleador es la del año).
   * PPM sobre ingresos brutos: tasa normal 0,25 % (ingresos del año anterior hasta `umbralUF`) o 0,5 % (más); con la rebaja transitoria hasta 2027 queda en 0,125 % o 0,25 %.
   * Un tramo sin `hasta` es el último (rige desde el año siguiente al `hasta` del anterior).
   */
  tributario: {
    regimen: 'Pro Pyme',
    etiqueta: 'Pro Pyme · circular SII 53/2025',
    anioPorDefecto: 2027,
    idpc: [{ hasta: 2027, tasa: 12.5 }, { hasta: 2028, tasa: 15 }, { tasa: 25 }],
    // Textos del régimen que salen en pantalla (módulo país: otro estudio u otro país los cambia aquí, sin tocar las vistas).
    textos: { pagoMensual: 'PPM', formulario: 'F29', mesAnual: 'abril', impuestoIndirecto: 'IVA', retenciones: 'boletas de honorarios' },
    ppm: { umbralUF: 50_000, tramos: [{ hasta: 2027, chica: 0.125, grande: 0.25 }, { chica: 0.25, grande: 0.5 }] },
  },
})

/** ¿Objeto simple (no arreglo)? @param {any} x */
const esObj = (x) => x != null && typeof x === 'object' && !Array.isArray(x)

/**
 * Mezcla en profundidad: los objetos se mezclan clave a clave; los arreglos y los valores simples del `over` reemplazan al defecto. No modifica ninguno de los dos.
 * @param {any} base @param {any} over
 * @returns {any}
 */
export function mezclarConfig(base, over) {
  if (!esObj(over)) return over === undefined ? JSON.parse(JSON.stringify(base)) : JSON.parse(JSON.stringify(over))
  const out = /** @type {Record<string,any>} */ ({})
  const claves = new Set([...Object.keys(esObj(base) ? base : {}), ...Object.keys(over)])
  for (const k of claves) {
    const b = esObj(base) ? base[k] : undefined, o = over[k]
    out[k] = o === undefined ? JSON.parse(JSON.stringify(b ?? null)) : esObj(b) && esObj(o) ? mezclarConfig(b, o) : JSON.parse(JSON.stringify(o))
  }
  return out
}

/** Configuración del presupuesto de un estudio: el defecto con lo que el estudio cambie. @param {any} [over] */
export const configPresupuesto = (over) => mezclarConfig(CONFIG_DEFECTO, over || {})

/**
 * Tramo de una tabla por año comercial: el primero cuyo `hasta` alcanza el año; el que no tiene `hasta` es el último.
 * @param {any[]} tramos @param {number} anio
 * @returns {any}
 */
export function tramoDelAnio(tramos, anio) {
  const t = (tramos || []).find((/** @type {any} */ x) => x.hasta == null || anio <= x.hasta)
  return t || (tramos || [])[(tramos || []).length - 1] || null
}

/**
 * Solo lo que difiere del defecto: es lo que se guarda en `presupuesto_config` (el estudio hereda el resto del código). Los objetos se comparan clave a clave; los arreglos y valores simples, enteros.
 * @param {any} cfg configuración completa @param {any} [base]
 * @returns {any}
 */
export function diferenciaConfig(cfg, base = CONFIG_DEFECTO) {
  /** @type {Record<string,any>} */ const out = {}
  for (const k of Object.keys(cfg || {})) {
    const a = cfg[k], b = base ? base[k] : undefined
    if (esObj(a) && esObj(b)) { const d = diferenciaConfig(a, b); if (Object.keys(d).length) out[k] = d }
    else if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = JSON.parse(JSON.stringify(a))
  }
  return out
}

/**
 * Valida una configuración (completa o solo las diferencias) antes de guardarla: números en rango, claves de componentes intactas, escenarios entre 1 y el máximo, reparto de socios que suma 100 %, tramos de impuesto
 * ordenados y con un último tramo sin `hasta`. Devuelve los errores por ruta; nunca modifica la entrada.
 * @param {any} over @returns {{ ok:boolean, errores:{ ruta:string, msg:string }[] }}
 */
export function validarConfig(over) {
  /** @type {{ ruta:string, msg:string }[]} */ const e = []
  const mal = (/** @type {string} */ ruta, /** @type {string} */ msg) => e.push({ ruta, msg })
  const rango = (/** @type {string} */ ruta, /** @type {any} */ v, /** @type {number} */ min, /** @type {number} */ max) => { if (v === undefined) return; const n = Number(v); if (v === null || v === '' || !Number.isFinite(n) || n < min || n > max) mal(ruta, `debe ser un número entre ${min} y ${max}`) }
  const texto = (/** @type {string} */ ruta, /** @type {any} */ v, /** @type {number} */ max) => { if (v === undefined) return; if (typeof v !== 'string' || !v.trim() || v.length > max) mal(ruta, `debe ser un texto de 1 a ${max} caracteres`) }
  const o = over || {}
  if (!esObj(o)) return { ok: false, errores: [{ ruta: '', msg: 'la configuración debe ser un objeto' }] }
  const cfg = mezclarConfig(CONFIG_DEFECTO, o)
  if (o.componentes !== undefined) {
    if (!Array.isArray(o.componentes)) mal('componentes', 'debe ser una lista')
    else {
      const claves = CONFIG_DEFECTO.componentes.map((/** @type {any} */ c) => c.k), vistas = new Set()
      o.componentes.forEach((/** @type {any} */ c, /** @type {number} */ i) => { texto(`componentes.${i}.n`, c && c.n, 40); if (!c || !claves.includes(c.k)) mal(`componentes.${i}.k`, 'componente desconocido'); else if (vistas.has(c.k)) mal(`componentes.${i}.k`, 'componente repetido'); else vistas.add(c.k) })
      if (vistas.size !== claves.length) mal('componentes', 'deben estar los seis componentes')
    }
  }
  if (o.escenarios !== undefined) {
    if (!Array.isArray(o.escenarios) || !o.escenarios.length) mal('escenarios', 'debe haber al menos un escenario')
    else {
      if (o.escenarios.length > cfg.maxEscenarios) mal('escenarios', `máximo ${cfg.maxEscenarios} escenarios`)
      const ks = new Set()
      o.escenarios.forEach((/** @type {any} */ s, /** @type {number} */ i) => { texto(`escenarios.${i}.n`, s && s.n, 30); if (!s || !s.k || ks.has(s.k)) mal(`escenarios.${i}.k`, 'clave vacía o repetida'); else ks.add(s.k); const p = (s && s.p) || {}
        rango(`escenarios.${i}.p.g`, p.g, -100, 500); rango(`escenarios.${i}.p.alza`, p.alza, 0, 100); rango(`escenarios.${i}.p.terc`, p.terc, 0, 100); rango(`escenarios.${i}.p.dias`, p.dias, 0, 365) })
    }
  }
  if (o.reserva) { rango('reserva.minima', o.reserva.minima, 0, 1e12); rango('reserva.porcentaje', o.reserva.porcentaje, 0, 100); rango('reserva.meses', o.reserva.meses, 0, 36); rango('reserva.trimestres', o.reserva.trimestres, 1, 12) }
  const rep = o.socios && o.socios.reparto
  if (rep !== undefined && rep !== 'iguales') {
    if (!esObj(rep)) mal('socios.reparto', 'debe ser «iguales» o una parte por socio')
    else { const v = Object.values(rep).map(Number); if (v.some((x) => !Number.isFinite(x) || x < 0 || x > 1)) mal('socios.reparto', 'cada parte debe estar entre 0 y 100 %'); else if (Math.abs(v.reduce((a, x) => a + x, 0) - 1) > 0.001) mal('socios.reparto', 'las partes deben sumar 100 %') }
  }
  const t = o.tributario
  if (t) {
    texto('tributario.regimen', t.regimen, 40); texto('tributario.etiqueta', t.etiqueta, 80)
    const tramos = (/** @type {string} */ r, /** @type {any} */ arr, /** @type {(x:any,i:number)=>void} */ campos) => { if (arr === undefined) return
      if (!Array.isArray(arr) || !arr.length) { mal(r, 'debe tener al menos un tramo'); return }
      arr.forEach((/** @type {any} */ x, /** @type {number} */ i) => { const ult = i === arr.length - 1; if (ult && x.hasta != null) mal(`${r}.${i}.hasta`, 'el último tramo no lleva año'); if (!ult) { if (!Number.isInteger(Number(x.hasta)) || Number(x.hasta) < 2000 || Number(x.hasta) > 2100) mal(`${r}.${i}.hasta`, 'año entre 2000 y 2100'); else if (i > 0 && Number(x.hasta) <= Number(arr[i - 1].hasta)) mal(`${r}.${i}.hasta`, 'los años deben ir en orden ascendente') } campos(x, i) }) }
    tramos('tributario.idpc', t.idpc, (x, i) => rango(`tributario.idpc.${i}.tasa`, x.tasa, 0, 100))
    if (t.ppm) { rango('tributario.ppm.umbralUF', t.ppm.umbralUF, 0, 1e9); tramos('tributario.ppm.tramos', t.ppm.tramos, (x, i) => { rango(`tributario.ppm.tramos.${i}.chica`, x.chica, 0, 100); rango(`tributario.ppm.tramos.${i}.grande`, x.grande, 0, 100) }) }
    if (t.textos) for (const k of Object.keys(t.textos)) texto(`tributario.textos.${k}`, t.textos[k], 40)
  }
  const m = o.moneda
  if (m) { texto('moneda.simbolo', m.simbolo, 4); texto('moneda.unidad', m.unidad, 8); rango('moneda.reajusteAnual', m.reajusteAnual, -10, 100); if (m.nombres) for (const k of Object.keys(m.nombres)) texto(`moneda.nombres.${k}`, m.nombres[k], 20) }
  if (o.socios && o.socios.lista != null && (!Array.isArray(o.socios.lista) || o.socios.lista.some((/** @type {any} */ x) => typeof x !== 'string' || !x.trim() || x.length > 40))) mal('socios.lista', 'debe ser una lista de nombres')
  if (o.previsional && o.previsional.empleador !== undefined) {
    const l = o.previsional.empleador
    if (!Array.isArray(l)) mal('previsional.empleador', 'debe ser una lista de tramos')
    else l.forEach((x, i) => { if (!x || !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(x.desde))) mal(`previsional.empleador.${i}.desde`, 'mes en formato AAAA-MM'); else if (i > 0 && l[i - 1] && String(x.desde) <= String(l[i - 1].desde)) mal(`previsional.empleador.${i}.desde`, 'los meses deben ir en orden ascendente'); rango(`previsional.empleador.${i}.pct`, x && x.pct, 0, 30) })
  }
  if (o.costos) { for (const k of ['fijas', 'porPersona']) if (o.costos[k] !== undefined && (!Array.isArray(o.costos[k]) || o.costos[k].some((/** @type {any} */ x) => typeof x !== 'string' || !x.trim()))) mal(`costos.${k}`, 'debe ser una lista de nombres') }
  return { ok: e.length === 0, errores: e }
}
