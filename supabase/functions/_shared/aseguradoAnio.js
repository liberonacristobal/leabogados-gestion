// «Lo que 2026 deja asegurado para 2027»: facturado asegurado del año siguiente. Función pura, fuente única del paso Arrastre del Presupuesto.
// Regla: asegurado = cuotas de PROYECTOS vigentes del año (clasificarPorFacturar, partida vigente) + asesorías permanentes × 12.
// Se EXCLUYEN de las cuotas el subarriendo (no es ingreso: rebaja el arriendo) y las cuotas de ventas recurrentes (ya van en las asesorías × 12): sumarlas doble inflaría el asegurado
// (con los datos de nov-2026, la suma ingenua da $277,3M y la correcta $253.137.501). Los clientes con una factura morosa se señalan, no se descuentan.

/** @typedef {{ k:string, motivo:string|null, id:string, b:any, monto:number }} FilaPF */

const VIGENTE = ['vencida', 'porVencer']
const _mes = (/** @type {any} */ b) => Number(String((b && b.due) || '').slice(5, 7)) || 0

/**
 * @param {{ filas:FilaPF[], asesorias:{cid:any, anual:number}[], morosos?:Set<string>|string[], anio?:string }} o
 * @returns {{ total:number, proyectos:number, asesorias:number, subarriendo:number, porCliente:{cid:string, proyectos:number, asesorias:number, total:number, moroso:boolean}[], porMes:number[], morosos:{n:number, monto:number, pct:number, cids:string[]} }}
 */
export function aseguradoAnio({ filas, asesorias, morosos }) {
  const mor = new Set([...(morosos || [])].map(String))
  /** @type {Record<string,{cid:string, proyectos:number, asesorias:number}>} */ const cli = {}
  const get = (/** @type {any} */ cid) => { const k = String(cid == null ? '' : cid); return cli[k] || (cli[k] = { cid: k, proyectos: 0, asesorias: 0 }) }
  const porMes = Array.from({ length: 12 }, () => 0)
  let proyectos = 0, subarriendo = 0
  for (const f of filas || []) {
    if (!VIGENTE.includes(f.k)) continue
    if (f.b && f.b.billing_type === 'subarriendo') { subarriendo += f.monto; continue }
    if (f.motivo === 'recurrente') continue
    proyectos += f.monto; get(f.b && f.b.client_id).proyectos += f.monto
    const m = _mes(f.b); if (m >= 1 && m <= 12) porMes[m - 1] += f.monto
  }
  let ases = 0
  for (const a of asesorias || []) { const v = Number(a.anual) || 0; if (v <= 0) continue; ases += v; get(a.cid).asesorias += v; for (let i = 0; i < 12; i++) porMes[i] += v / 12 }
  const porCliente = Object.values(cli).map((c) => ({ ...c, total: c.proyectos + c.asesorias, moroso: mor.has(c.cid) })).sort((a, b) => b.total - a.total)
  const total = proyectos + ases, monMor = porCliente.filter((c) => c.moroso).reduce((a, c) => a + c.total, 0)
  return { total, proyectos, asesorias: ases, subarriendo, porCliente, porMes, morosos: { n: porCliente.filter((c) => c.moroso).length, monto: monMor, pct: total > 0 ? (monMor / total) * 100 : 0, cids: porCliente.filter((c) => c.moroso).map((c) => c.cid) } }
}

/** Cuotas de proyectos vigentes cuyo vencimiento cae entre dos fechas (aaaa-mm-dd, ambas incluidas): las de nov-dic del año base, que son de ese año y no del siguiente. @param {FilaPF[]} filas @param {string} desde @param {string} hasta */
export function cuotasEntre(filas, desde, hasta) {
  return (filas || []).filter((f) => VIGENTE.includes(f.k) && !(f.b && f.b.billing_type === 'subarriendo') && f.motivo !== 'recurrente' && String((f.b && f.b.due) || '').slice(0, 10) >= desde && String((f.b && f.b.due) || '').slice(0, 10) <= hasta).reduce((a, f) => a + f.monto, 0)
}
