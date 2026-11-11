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

// Cascada del Vendido del año: Bruto − Comisiones de venta = NETO, con una sola cifra de neto en Inicio, Panel de socios, imágenes y Presupuesto.
// El neto (el plano de la meta) se redondea solo, sin ajuste; la comisión absorbe el resto, así que bruto − comisión = neto se lee exacto. m = metricasAnio(); paso = 1 (UF) o 1e5 (pesos en $M).
/** @param {{bruto:number,costo:number,neto:number,brutoUF:number,costoUF:number,netoUF:number}} m @param {boolean} enUF @returns {{bruto:number,costo:number,neto:number}} */
export function cascadaVendido(m, enUF){
  const paso=enUF?1:1e5, [neto,costo]=redondearPartes(enUF?[m.netoUF,m.costoUF]:[m.neto,m.costo],paso,[0])
  return { neto, costo, bruto:neto+costo }
}

// Cifras por socio de un período — FUENTE ÚNICA de la ventana «Por socio» y del Panel de socios. Mismas fórmulas de siempre, extraídas de PorSocioVista
// sin cambios: P = partidasPorSocio, V = vendidoPorSocio, ym = 'AAAA-MM' (el mes elegido; el año corre de enero a ese mes).
// card6(socio|null, 'mes'|'ytd') = [Vendido, Facturado, Cobrado propio, Comisiones pagadas, Comisiones percibidas, Ingreso real, Subarriendo].
/** @param {{P: any[], V: any[], ym: string}} a */
export function kpisPorSocio({P,V,ym}){
  const y=Number(ym.slice(0,4))
  /** @type {(d:any,p:string)=>boolean} */ const inPer=(d,p)=>{ const s=String(d||'').slice(0,7); return p==='mes'?s===ym:(s>=`${y}-01`&&s<=ym) }
  /** @type {(s:string,k:any,soc:any,p:string)=>number} */ const sumP=(s,k,soc,p)=>P.reduce((a,r)=>a+((r.s===s&&(k==null||(Array.isArray(k)?k.includes(r.k):r.k===k))&&(!soc||r.soc===soc)&&inPer(r.d,p))?r.m:0),0)
  // Vendido NETO (V[].m = bruto − comisión de cada venta): cada socio redondeado al peso con redondearPartes, así Socios + Sin socio = Oficina (soc nulo) exacto.
  /** @type {Record<string,{o:Record<string,number>,tot:number}>} */ const vCache={}
  /** @type {(p:string)=>{o:Record<string,number>,tot:number}} */ const vPer=p=>{ if(vCache[p]) return vCache[p]
    const its=V.filter(x=>p==='mes'?x.ym===ym:x.ym<=ym), socs=[...new Set(its.map(x=>x.soc))], r=redondearPartes(socs.map(s=>its.reduce((a,x)=>a+(x.soc===s?x.m:0),0)),1,[]), o=/** @type {Record<string,number>} */ ({})
    socs.forEach((s,i)=>{ o[s]=r[i] }); return (vCache[p]={ o, tot:r.reduce((a,x)=>a+x,0) }) }
  /** @type {(soc:any,p:string)=>number} */ const vend=(soc,p)=>{ const v=vPer(p); return soc?(v.o[soc]||0):v.tot }
  const KF=['emit','cext','reemb','nc'], KC=['fac','ant','reemb'], KI=[...KC,'com','perc']
  /** @type {(soc:any,p:string)=>number[]} */ const card6=(soc,p)=>{ const fac=sumP('f',KF,soc,p), cp=sumP('c',KC,soc,p), com=-sumP('c','com',soc,p), pe=sumP('c','perc',soc,p); return [vend(soc,p),fac,cp,com,pe,cp-com+pe,sumP('c','sub',soc,p)] }
  // Ingreso EMITIDO (plano facturado): facturado (KF) − comisiones de lo facturado. El subarriendo no entra (va aparte, 'sub').
  /** @type {(soc:any,p:string)=>{f:number,c:number,i:number}} */ const emitido=(soc,p)=>{ const f=sumP('f',KF,soc,p), c=-sumP('f','com',soc,p); return {f,c,i:f-c} }
  /** facturas emitidas del período (una por factura; la que se devuelve entera como reembolso no cuenta) */
  /** @type {(soc:any,p:string)=>number} */ const nEmitidas=(soc,p)=>{ const rea=new Set(P.filter(r=>r.s==='f'&&r.k==='reemb'&&r.bid).map(r=>String(r.bid)+'|'+Math.round(-r.m)))
    return new Set(P.filter(r=>r.s==='f'&&(r.k==='emit'||r.k==='cext')&&r.bid&&r.m>0&&(!soc||r.soc===soc)&&inPer(r.d,p)&&!rea.has(String(r.bid)+'|'+Math.round(r.m))).map(r=>String(r.bid))).size }
  /** ingreso emitido por mes (enero → ym) y por socio: [{ym, v:{socio:monto}}] */
  /** @type {(socs:string[])=>{ym:string,v:Record<string,number>}[]} */ const emitidoMeses=(socs)=>{ const out=[]; for(let m=1;m<=Number(ym.slice(5,7));m++){ const k=`${y}-${String(m).padStart(2,'0')}`, /** @type {Record<string,number>} */ v={}
    socs.forEach(soc=>{ v[soc]=P.reduce((a,r)=>a+((r.s==='f'&&(KF.includes(r.k)||r.k==='com')&&r.soc===soc&&String(r.d||'').slice(0,7)===k)?r.m:0),0) }); out.push({ym:k,v}) } return out }
  return {inPer,sumP,vend,KF,KC,KI,card6,emitido,nEmitidas,emitidoMeses}
}

// Resumen Por socio: cifras en $M de 1 decimal que CUADRAN (las partes suman el total redondeado) y participación % que suma 100.
/** @param {Array<number|null|undefined>} partes pesos @returns {number[]} pesos redondeados a 0,1 M, sumando el total redondeado */
export function partesM(partes){ return redondearPartes(partes,1e5) }
/** Participación de cada parte en el total de las partes positivas, con 1 decimal y suma exacta 100 (si no hay nada positivo, ceros). @param {Array<number|null|undefined>} partes @returns {number[]} */
export function partesPct(partes){ const v=partes.map(x=>Math.max(0,Number(x)||0)), t=v.reduce((a,x)=>a+x,0); return t>0?redondearPartes(v.map(x=>x/t*100),0.1).map(x=>Math.round(x*10)/10):v.map(()=>0) }
/** Participación entera (suma 100) para mostrar «66 %». @param {Array<number|null|undefined>} partes @returns {number[]} */
export function partesPctEnt(partes){ const v=partes.map(x=>Math.max(0,Number(x)||0)), t=v.reduce((a,x)=>a+x,0); return t>0?redondearPartes(v.map(x=>x/t*100),1):v.map(()=>0) }

/** Reparto del cierre estimado: real a la fecha + resto = cierre, los tres redondeados a `paso` (1e5 = $M de 1 decimal) y cuadrando: el real se redondea normal y el ajuste cae en el resto. @param {number} aFecha @param {number} resto @param {number} [paso] */
export function repartoCierre(aFecha, resto, paso=1e5){ const [a,r]=redondearPartes([aFecha,resto],paso,[0]); return {aFecha:a,resto:r,cierre:a+r} }
