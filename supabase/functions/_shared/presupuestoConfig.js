// presupuestoConfig.js — configuración del PRESUPUESTO por estudio (vendible por diseño). Lo que antes estaba cableado a «Liberona / Chile / Pro Pyme» vive aquí, con los
// valores del tenant actual como defecto. `configPresupuesto(override)` mezcla lo que traiga el estudio (hoy `BRAND.presupuesto`, si existe) sobre el defecto; las reglas de
// presupuesto.js reciben el resultado como `cfg` (opcional: sin él usan CONFIG_DEFECTO y reproducen exactamente las cifras de siempre; prueba en tests/presupuestoConfig.test.mjs).
//
// Qué es configurable: lista de componentes de las metas (clave, nombre, tono, ícono, orden), escenarios de partida y sus palancas, reserva mínima y regla de reserva, reparto
// de las metas entre socios, reglas tributarias por régimen y año (tasa de primera categoría y PPM legal), categorías de costo fijas y por persona, y la moneda reajustable (módulo país).
// Qué sigue cableado (por falta de tabla de configuración; sin migraciones en esta ronda): los textos de ayuda del paso Escenarios › Impuesto (Pro Pyme, F29, abril, sin IVA),
// el nombre de los grupos de sueldos en algunos textos, la fuente de la UF (mindicador.cl, en compartido.jsx) y la lista de socios (ADMIN_NAMES de la app).

/** @typedef {{ k:string, n:string, tono:string, ic:string, ancla:boolean }} ComponenteCfg  tono = clave del tono de tarjeta (a, y, g, t, r, w); ic = ícono; ancla = se puede escribir su meta */
/** @typedef {{ g:number, alza:number, terc:number, dias:number }} PalancasCfg */
/** @typedef {{ k:string, n:string, t:number, p:PalancasCfg }} EscenarioCfg  t = índice de tono del escenario */

export const CONFIG_DEFECTO = /** @type {any} */ ({
  pais: 'CL',
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
  /** Reserva de caja: mínima ya en caja al comenzar el año (por confirmar contra el Banco), % del resultado después de impuesto que se reserva, y la regla recomendada (meses de costos a los que llegar, repartidos por trimestre). */
  reserva: { minima: 30_000_000, porcentaje: 15, meses: 3, trimestres: 4 },
  /** Reparto de las metas entre socios: 'iguales' o un mapa { nombre: fracción }. «Sin socio» no tiene meta. */
  socios: { reparto: 'iguales' },
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
