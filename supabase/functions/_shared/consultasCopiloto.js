// Consultas que Counsel AI puede pedir antes de responder una pregunta con cifras. La IA no calcula ni inventa un monto: elige una
// consulta, la app la resuelve con sus funciones únicas (saldos de facturas, fondos − gastos, tareas) y la IA solo redacta con ese
// resultado. Funciones puras: reciben los datos y las funciones de la app (para que las pruebas usen las mismas reglas).

const nz = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
const clp = n => '$' + new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(Number(n) || 0))
const dmy = d => { const p = String(d || '').slice(0, 10).split('-'); return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : '' }

export const HERRAMIENTAS = [
  { name: 'deuda_cliente', description: 'Cuánto debe un cliente: facturas por cobrar y gastos por cubrir (fondos − gastos). Úsala para «cuánto debe X», «cómo está X», «saldo de X».', input_schema: { type: 'object', properties: { cliente: { type: 'string', description: 'Nombre del cliente, como lo escribió la persona' } }, required: ['cliente'] } },
  { name: 'por_cobrar', description: 'Total por cobrar y vencido de todo el estudio, con los clientes que más deben. Úsala para «quién me debe plata», «cuánto está vencido». Con `cliente` limita a uno.', input_schema: { type: 'object', properties: { cliente: { type: 'string' }, top: { type: 'integer', description: 'Cuántos clientes listar (5 por defecto)' } } } },
  { name: 'facturas_cliente', description: 'Últimas facturas de un cliente con su estado y saldo.', input_schema: { type: 'object', properties: { cliente: { type: 'string' } }, required: ['cliente'] } },
  { name: 'tareas_vencidas', description: 'Tareas abiertas con plazo vencido, agrupadas por responsable.', input_schema: { type: 'object', properties: {} } },
]

export function crearConsultas({ clients = [], billing = [], expenses = [], tasks = [], hoy, fgCliente, gastosPorRendirCli, saldoBill, esVencidaB, porCobrarBills, folioN = x => String(x || '') }) {
  const dia = String(hoy || new Date().toISOString()).slice(0, 10)
  const reales = clients.filter(c => c && !c.is_internal)

  const buscarCliente = txt => {
    const q = nz(txt); if (!q) return { error: 'Falta el nombre del cliente.' }
    let r = reales.filter(c => nz(c.name) === q)
    if (!r.length) r = reales.filter(c => nz(c.name).includes(q))
    if (!r.length) { const ts = q.split(' ').filter(t => t.length > 2); if (ts.length) r = reales.filter(c => ts.every(t => nz(c.name).includes(t))) }
    if (!r.length) return { error: `No encontré un cliente llamado «${txt}».` }
    if (r.length > 1) return { error: `Hay ${r.length} clientes que calzan con «${txt}»: ${r.slice(0, 5).map(c => c.name).join(', ')}. Pide que precise cuál.` }
    return { cliente: r[0] }
  }
  const factsDe = c => billing.filter(b => b && !b.deleted_at && String(b.client_id) === String(c.id))
  const pendientes = bills => bills.filter(b => b.invoice_no && ['Pendiente', 'Vencido'].includes(b.status) && !['reembolso', 'nota_credito'].includes(b.billing_type) && saldoBill(b) > 0)

  const deudaCliente = ({ cliente }) => {
    const f = buscarCliente(cliente); if (f.error) return { error: f.error }
    const c = f.cliente, bills = factsDe(c)
    const porCobrar = porCobrarBills(bills), pend = pendientes(bills), emitidas = bills.filter(b => b.invoice_no && b.status !== 'Anulada' && !['reembolso', 'nota_credito'].includes(b.billing_type))
    const fg = fgCliente(expenses, c.id), porCubrir = Math.max(0, -fg.saldo), aFavor = Math.max(0, fg.saldo)
    const sr = gastosPorRendirCli(expenses, c.id), sinRendir = sr.reduce((a, e) => a + (Number(e.amount) || 0), 0)
    const total = porCobrar + porCubrir
    const destino = { tipo: 'cliente', id: c.id }
    const lineas = [
      { n: 'Facturas por cobrar', sub: `${pend.length} pendiente${pend.length === 1 ? '' : 's'} de ${emitidas.length} emitida${emitidas.length === 1 ? '' : 's'}`, valor: clp(porCobrar), destino },
      { n: 'Gastos del cliente', sub: `fondos ${clp(fg.fondos)} − gastos ${clp(fg.gastos)}`, valor: aFavor > 0 ? `${clp(aFavor)} a favor` : clp(porCubrir), destino },
    ]
    if (sinRendir > 0) lineas.push({ n: 'De ellos, sin rendir', sub: `${sr.length} gasto${sr.length === 1 ? '' : 's'}`, valor: clp(sinRendir), destino })
    return {
      resumen: { cliente: c.name, deuda_total: clp(total), facturas_por_cobrar: clp(porCobrar), facturas_pendientes: pend.length, facturas_vencidas: pend.filter(esVencidaB).length, gastos_por_cubrir: clp(porCubrir), saldo_a_favor_en_gastos: clp(aFavor), gastos_sin_rendir: clp(sinRendir), al: dmy(dia) },
      tarjeta: { titulo: 'Desglose', lineas, total: { n: porCubrir > 0 || porCobrar > 0 ? 'Total por cubrir' : 'Sin deuda', valor: clp(total) }, fuente: `Fuente: saldo de las facturas emitidas y fondos − gastos del cliente, al ${dmy(dia)}. Toca una línea para ver el detalle.` },
    }
  }

  const porCobrar = ({ cliente, top }) => {
    if (cliente) return deudaCliente({ cliente })
    const n = Math.min(Math.max(parseInt(top, 10) || 5, 1), 10)
    const grupos = new Map()
    billing.filter(b => b && !b.deleted_at).forEach(b => { const k = b.client_id || '__sin'; (grupos.get(k) || grupos.set(k, []).get(k)).push(b) })
    const filas = [...grupos.entries()].map(([k, bs]) => ({ k, bs, monto: porCobrarBills(bs), venc: pendientes(bs).filter(esVencidaB).reduce((a, b) => a + saldoBill(b), 0), n: pendientes(bs).length })).filter(x => x.monto > 0).sort((a, b) => b.monto - a.monto)
    const total = filas.reduce((a, x) => a + x.monto, 0), vencido = filas.reduce((a, x) => a + x.venc, 0)
    const nombre = k => k === '__sin' ? 'Sin cliente asignado' : (clients.find(c => String(c.id) === String(k))?.name || 'Cliente')
    return {
      resumen: { por_cobrar_total: clp(total), vencido: clp(vencido), clientes_con_saldo: filas.length, mayores: filas.slice(0, n).map(x => ({ cliente: nombre(x.k), por_cobrar: clp(x.monto), vencido: clp(x.venc), facturas: x.n })), al: dmy(dia) },
      tarjeta: { titulo: 'Por cobrar', lineas: filas.slice(0, n).map(x => ({ n: nombre(x.k), sub: `${x.n} factura${x.n === 1 ? '' : 's'}${x.venc > 0 ? ` · ${clp(x.venc)} vencido` : ''}`, valor: clp(x.monto), destino: x.k === '__sin' ? { tab: 'billing' } : { tipo: 'cliente', id: x.k } })), total: { n: 'Total por cobrar', valor: clp(total) }, fuente: `Fuente: saldo de las facturas emitidas con folio, al ${dmy(dia)}.` },
    }
  }

  const facturasCliente = ({ cliente }) => {
    const f = buscarCliente(cliente); if (f.error) return { error: f.error }
    const c = f.cliente
    const bs = factsDe(c).filter(b => b.invoice_no && b.status !== 'Anulada').sort((a, b) => String(b.issued_at || '').localeCompare(String(a.issued_at || ''))).slice(0, 10)
    if (!bs.length) return { resumen: { cliente: c.name, facturas: [] }, tarjeta: null }
    return {
      resumen: { cliente: c.name, facturas: bs.map(b => ({ folio: folioN(b.invoice_no), estado: b.status, emitida: dmy(b.issued_at), saldo: clp(saldoBill(b)) })) },
      tarjeta: { titulo: 'Facturas', lineas: bs.map(b => ({ n: `Factura N° ${folioN(b.invoice_no)}`, sub: `${b.status}${b.issued_at ? ` · emitida ${dmy(b.issued_at)}` : ''}`, valor: saldoBill(b) > 0 ? clp(saldoBill(b)) : 'Pagada', destino: { tipo: 'cliente', id: c.id } })), total: null, fuente: 'Fuente: facturas emitidas del cliente (las 10 más recientes).' },
    }
  }

  const tareasVencidas = () => {
    const venc = tasks.filter(t => t && t.status !== 'Terminado' && !t.archived && t.due && String(t.due).slice(0, 10) < dia)
    const por = new Map()
    venc.forEach(t => { const quien = (Array.isArray(t.assignees) && t.assignees.length ? t.assignees : [t.who || 'Sin responsable']); quien.forEach(q => por.set(q, (por.get(q) || 0) + 1)) })
    const filas = [...por.entries()].sort((a, b) => b[1] - a[1])
    return {
      resumen: { tareas_vencidas: venc.length, por_responsable: filas.map(([q, n]) => ({ responsable: q, tareas: n })), al: dmy(dia) },
      tarjeta: venc.length ? { titulo: 'Tareas vencidas', lineas: filas.map(([q, n]) => ({ n: q, sub: '', valor: String(n), destino: { tab: 'tasks' } })), total: { n: 'Total', valor: String(venc.length) }, fuente: `Fuente: tareas abiertas con plazo anterior al ${dmy(dia)}.` } : null,
    }
  }

  const tabla = { deuda_cliente: deudaCliente, por_cobrar: porCobrar, facturas_cliente: facturasCliente, tareas_vencidas: tareasVencidas }
  return (nombre, input) => { const f = tabla[nombre]; if (!f) return { error: 'Esa consulta no existe.' }; try { return f(input || {}) } catch (e) { return { error: 'No se pudo calcular: ' + (e?.message || 'error') } } }
}

// Bucle de la conversación: la IA pide consultas, la app las resuelve, hasta que redacta la respuesta (máximo `maxVueltas`).
export async function resolverConIA({ llamar, sistema, mensajes, herramientas = HERRAMIENTAS, ejecutar, maxVueltas = 4 }) {
  const msgs = [...mensajes], tarjetas = []
  for (let v = 0; v < maxVueltas; v++) {
    const data = await llamar({ system: sistema, messages: msgs, tools: herramientas })
    const contenido = Array.isArray(data?.content) ? data.content : []
    const usos = contenido.filter(b => b.type === 'tool_use')
    if (!usos.length || data.stop_reason !== 'tool_use') return { texto: contenido.filter(b => b.type === 'text').map(b => b.text).join('\n').trim(), tarjetas }
    msgs.push({ role: 'assistant', content: contenido })
    const resultados = usos.map(u => { const r = ejecutar(u.name, u.input || {}); if (r.tarjeta) tarjetas.push(r.tarjeta); return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(r.error ? { error: r.error } : r.resumen) } })
    msgs.push({ role: 'user', content: resultados })
  }
  return { texto: '', tarjetas, agotado: true }
}
