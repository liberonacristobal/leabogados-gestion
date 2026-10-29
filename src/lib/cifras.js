// Cálculos de cifras puros (sin React ni base): fuente única de venta en UF/CLP, costo de terceros y redondeo que cuadra.
/**
 * @typedef {Object} Venta
 * @property {string} [moneda] 'UF' | 'CLP'
 * @property {string} [cobro_type] 'mensual' | 'unico' | …
 * @property {string} [status]
 * @property {string} [area]
 * @property {any} [amount_uf]
 * @property {any} [amount_clp]
 * @property {any} [uf_value] UF congelada de la venta
 * @property {any} [cost_uf]
 * @property {any} [cost_clp]
 * @property {{subarriendo?: boolean}} [cobro_config]
 */

// Se prueban en tests/cifras.test.mjs y se revisan con `npm run tipos`. compartido.jsx los reexporta, así que nadie cambia sus importaciones.

// Recurrentes mensuales ACTIVAS se proyectan x12. No-recurrentes tal cual.
// Lo usan Dashboard y SalesView para que los totales NUNCA difieran.
/** @param {Venta|null|undefined} s */
export const esRecurrente = s => s?.cobro_type==='mensual' && s?.status==='Activo'

// Subarrendamiento (ingreso por arriendo, NO honorarios): se factura y programa como una venta,
// pero NO cuenta en "Vendido del año" ni en las metas de venta. Se excluye en todos los agregados de Vendido/áreas.
// Vive en Colaboradores (ficha del colaborador), no en Ventas ni en Clientes.
// Marcador: cobro_config.subarriendo === true (el area de sales es un enum acotado; no se toca).
/** @param {Venta|null|undefined} s */
export const esSubarriendo = s => s?.cobro_config?.subarriendo===true || (s?.area||'')==='Subarriendo'

/** @param {Venta} s @param {number} ufRef UF de respaldo @returns {number} */
export const ventaUF = (s, ufRef) => {
  const factor = esRecurrente(s) ? 12 : 1
  if(s.moneda==='CLP'){ const clp=(parseFloat(s.amount_clp)||0); const uref=(s.uf_value>0?s.uf_value:ufRef); return uref ? (clp*factor)/uref : 0 }   // UF histórica de la venta (congelada); ufRef es solo respaldo
  return (parseFloat(s.amount_uf)||0)*factor
}

/** @param {Venta} s @param {number} ufRef @returns {number} */
export const ventaCLP = (s, ufRef) => {
  const factor = esRecurrente(s) ? 12 : 1
  if(s.moneda==='CLP') return (parseFloat(s.amount_clp)||0)*factor
  const clp = s.amount_clp || (s.amount_uf&&s.uf_value>0?Math.round(s.amount_uf*s.uf_value):Math.round((parseFloat(s.amount_uf)||0)*ufRef))
  return (clp||0)*factor
}

// Costo de terceros (reparto) de una venta en UF, anualizado si es recurrente. Fuente única del costo → margen de contribución = ventaUF − costoVentaUF.
/** @param {Venta|null|undefined} s @param {number} ufRef @returns {number} */
export const costoVentaUF = (s, ufRef) => { const u=(parseFloat(s?.uf_value)>0?parseFloat(s?.uf_value):ufRef)   // costo pactado en pesos → UF de la venta (congelada), no la de hoy
  return ((parseFloat(s?.cost_uf)||0)*(esRecurrente(s)?12:1)) + (s?.moneda==='CLP'&&s?.cost_clp&&u>0 ? (parseFloat(s.cost_clp)||0)/u*(esRecurrente(s)?12:1) : 0) }

// Redondeo que CUADRA: redondea las partes de modo que sumen el total redondeado (resto mayor). Para mostrar cascadas
// (Facturado + Subarriendo + … = Ingresos) sin que la suma visible falle por 1. paso = unidad de redondeo (1 UF, 0,1 M…).
// fijos = índices que se redondean normal (la cifra que también se ve en otra tarjeta, p. ej. Facturado o Margen): el ajuste cae en las demás.
/** @param {Array<number|null|undefined>} partes @param {number} [paso] @param {number[]} [fijos] @returns {number[]} */
export function redondearPartes(partes, paso=1, fijos=[]){
  const v=partes.map(x=>(Number(x)||0)/paso), tot=Math.round(v.reduce((a,x)=>a+x,0))
  const fx=new Set(fijos.filter(i=>v.some((_,j)=>j!==i&&!fijos.includes(j)&&v[j]!==0)))   // si no hay a quién cargarle el ajuste, nadie queda fijo
  const out=v.map((x,i)=>fx.has(i)?Math.round(x):Math.floor(x)); let falta=tot-out.reduce((a,x)=>a+x,0)
  const ord=v.map((x,i)=>[x-Math.floor(x),i]).filter(([,i])=>!fx.has(i)&&v[i]!==0).sort((a,b)=>b[0]-a[0])
  for(let k=0;falta!==0&&ord.length;k=(k+1)%ord.length){ const i=ord[k][1]; if(falta>0){ out[i]++; falta-- } else { out[i]--; falta++ } }
  return out.map(x=>x*paso)
}

