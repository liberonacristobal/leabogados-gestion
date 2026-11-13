// «Estado de comisiones» de un proveedor: documento imprimible tamaño carta, con tres secciones (pagadas por mes de pago, por pagar y sujetas a cobro).
// Recibe las comisiones ya clasificadas por la vista (estado y monto salen de los mismos helpers de la ficha); aquí solo se agrupa y se arma el HTML. Funciones puras.

/** @typedef {{estado:'pagada'|'por_pagar'|'por_devengar', cliente:string, concepto:string, fecha?:string|null, monto:number, detalle?:string}} ItemComision */

const MES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const n = (/** @type {any} */ x) => Number(x) || 0
const esc = (/** @type {any} */ s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
/** @param {number} x */
export const pesos = x => '$' + Math.round(n(x)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
/** @param {any} iso */
export const dmy = iso => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : '' }

/** Agrupa pagadas por mes de pago (más nuevo primero; dentro del mes, por fecha descendente); por pagar y sujetas, de la más antigua a la más nueva.
 *  @param {ItemComision[]} items */
export function armarEstadoComisiones(items) {
  const por = (/** @type {string} */ e) => items.filter(i => i.estado === e)
  const suma = (/** @type {ItemComision[]} */ a) => a.reduce((s, i) => s + n(i.monto), 0)
  const pag = por('pagada'), g = /** @type {Map<string, ItemComision[]>} */ (new Map())
  for (const i of pag) { const ym = String(i.fecha || '').slice(0, 7) || 'sin-fecha'; (g.get(ym) || g.set(ym, []).get(ym))?.push(i) }
  const meses = [...g.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([ym, filas]) => ({
    ym, total: suma(filas), filas: filas.slice().sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')) || a.cliente.localeCompare(b.cliente)) }))
  const orden = (/** @type {ItemComision[]} */ a) => a.slice().sort((x, y) => String(x.fecha || '9').localeCompare(String(y.fecha || '9')) || x.cliente.localeCompare(y.cliente))
  const porPagar = orden(por('por_pagar')), sujeto = orden(por('por_devengar'))
  const fechas = pag.map(i => String(i.fecha || '')).filter(Boolean).sort()
  return { meses, porPagar, sujeto, totales: { pagado: suma(pag), porPagar: suma(porPagar), sujeto: suma(sujeto) }, desde: fechas[0] || null, hasta: fechas[fechas.length - 1] || null }
}

/** Etiqueta de mes («Octubre 2026») desde AAAA-MM. @param {string} ym */
export const mesTitulo = ym => { const [a, m] = ym.split('-'); return MES[Number(m) - 1] ? `${MES[Number(m) - 1]} ${a}` : 'Sin fecha de pago' }

const IC = {
  ok: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/></svg>',
  clk: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  doc: '<svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 13h5M10 17h5"/></svg>' }

/** HTML carta del estado. @param {{proveedor:string, rut?:string, items:ItemComision[], emitido:string, marca:{nombre:string, logoUrl:string, direccion?:string}, auto?:boolean}} a */
export function estadoComisionesHtml({ proveedor, rut, items, emitido, marca, auto = true }) {
  const e = armarEstadoComisiones(items), T = e.totales
  const periodo = e.desde && e.hasta ? (e.desde.slice(0, 7) === e.hasta.slice(0, 7) ? mesTitulo(e.desde.slice(0, 7)) : `${mesTitulo(e.desde.slice(0, 7))} a ${mesTitulo(e.hasta.slice(0, 7))}`) : 'Sin pagos aún'
  const tarjeta = (/** @type {keyof IC} */ k, /** @type {string} */ t, /** @type {number} */ m) => `<div><i class="ic">${IC[k]}</i><span>${t}</span><b>${pesos(m)}</b></div>`
  const pagadas = e.meses.map(mes => mes.filas.map((r, i) => `<tr class="${i === 0 ? 'gs' : ''}">${i === 0 ? `<td class="mc" rowspan="${mes.filas.length}"><b>${esc(mesTitulo(mes.ym))}</b><br><span>${pesos(mes.total)}</span></td>` : ''}<td class="d">${dmy(r.fecha)}</td><td>${esc(r.cliente)}</td><td>${esc(r.concepto)}</td><td class="r">${pesos(r.monto)}</td></tr>`).join('')).join('')
  const simple = (/** @type {ItemComision[]} */ a) => a.map(r => `<tr><td>${esc(r.cliente)}</td><td>${esc(r.concepto)}</td><td>${esc(r.detalle || '')}</td><td class="r">${pesos(r.monto)}</td></tr>`).join('')
  const tabla2 = (/** @type {ItemComision[]} */ a) => `<table class="t2"><colgroup><col style="width:140px"><col><col style="width:190px"><col style="width:84px"></colgroup><tr class="th"><td>Cliente</td><td>Concepto</td><td>Estado</td><td class="r">Monto</td></tr>${simple(a)}</table>`
  const pie = `<footer>${esc(marca.nombre)}${marca.direccion ? ' · ' + esc(marca.direccion) : ''}</footer>`
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Estado de comisiones — ${esc(proveedor)}</title><style>
@page{size:letter;margin:.6in .7in .7in}*{box-sizing:border-box}body{margin:0;font:10.5pt "Aptos Light",Aptos,Calibri,"Segoe UI",Arial,sans-serif;color:#3D3D3D}
.lg{height:36px;display:block}header{display:flex;justify-content:space-between;align-items:center;padding-bottom:10px}.hr{text-align:right;display:flex;flex-direction:column;color:#537281;font-size:9pt}.hr b{font-size:11pt;color:#003C50;font-weight:600;text-transform:uppercase;letter-spacing:.06em}
.strip{display:flex;border-top:1.5px solid #003C50;border-bottom:1px solid #E4E8EB;margin-bottom:14px}.strip div{flex:1;padding:7px 0;color:#003C50;font-weight:600}.strip div:nth-child(2){flex:.6}.strip div:nth-child(3){flex:1.2}.strip span{display:block;font-size:8pt;font-weight:400;color:#537281;text-transform:uppercase;letter-spacing:.05em}
.cards{display:flex;gap:10px}.cards div{flex:1;border:1px solid #E4E8EB;border-radius:4px;padding:8px 10px;color:#537281;font-size:9pt}.cards b{display:block;font-size:14pt;color:#003C50;font-weight:600}
.ic{float:left;width:30px;height:30px;border-radius:50%;background:#E4E8EB;padding:5px;margin:2px 9px 0 0}.ic svg{width:100%;height:100%;fill:none;stroke:#003C50;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
h2{font-size:11pt;color:#003C50;margin:16px 0 4px;font-weight:600;display:flex;justify-content:space-between;break-after:avoid}h2 i{font-style:normal}
table{width:100%;border-collapse:collapse;table-layout:fixed}td{padding:3.5px 6px;vertical-align:top}tr{break-inside:avoid}.r{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.d{white-space:nowrap}
.th td{white-space:nowrap;color:#537281;font-size:8.5pt;text-transform:uppercase;letter-spacing:.04em;border-bottom:1.5px solid #99ABB4}.gs td{border-top:1px solid #99ABB4}.mc{color:#003C50;border-top:1px solid #99ABB4}.mc span{color:#537281;font-size:9pt}
.tot{display:flex;justify-content:space-between;margin-top:12px;padding-top:8px;border-top:1.5px solid #003C50;color:#003C50}
footer{margin-top:22px;padding-top:6px;border-top:1px solid #E4E8EB;font-size:8pt;color:#537281}
@media screen{body{max-width:8.5in;margin:0 auto;padding:.6in .7in}}</style></head><body>
<header><img class="lg" src="${esc(marca.logoUrl)}" alt="${esc(marca.nombre)}"><div class="hr"><b>Estado de comisiones</b><span>Emitido el ${esc(emitido)}</span></div></header>
<div class="strip"><div><span>Nombre</span>${esc(proveedor)}</div><div><span>RUT</span>${esc(rut || '—')}</div><div><span>Período</span>${esc(periodo)}</div></div>
<div class="cards">${tarjeta('ok', 'Pagado', T.pagado)}${tarjeta('clk', 'Por pagar', T.porPagar)}${tarjeta('doc', 'Sujeto a cobro', T.sujeto)}</div>
${e.meses.length ? `<h2>1. Comisiones pagadas <i>${pesos(T.pagado)}</i></h2><table class="t2"><colgroup><col style="width:120px"><col style="width:92px"><col style="width:110px"><col><col style="width:84px"></colgroup><tr class="th"><td>Mes</td><td>Fecha pago</td><td>Cliente</td><td>Concepto</td><td class="r">Monto</td></tr>${pagadas}</table>` : ''}
${e.porPagar.length ? `<h2>2. Por pagar <i>${pesos(T.porPagar)}</i></h2>${tabla2(e.porPagar)}` : ''}
${e.sujeto.length ? `<h2>3. Sujetas a cobro <i>${pesos(T.sujeto)}</i></h2>${tabla2(e.sujeto)}` : ''}
${e.porPagar.length || e.sujeto.length ? `<div class="tot">Total comprometido (2 + 3) <b>${pesos(T.porPagar + T.sujeto)}</b></div>` : ''}
${pie}${auto ? '<script>window.onload=()=>{window.print()}<\/script>' : ''}</body></html>`
}
