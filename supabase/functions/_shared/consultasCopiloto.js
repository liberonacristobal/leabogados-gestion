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
  { name: 'donde_esta', description: 'Dónde se hace algo en la app (pantalla y sección). Úsala para «dónde cargo…», «cómo hago…», «llévame a…». Solo devuelve pantallas que existen.', input_schema: { type: 'object', properties: { tema: { type: 'string', description: 'Lo que la persona quiere hacer o encontrar' } }, required: ['tema'] } },
  { name: 'ficha_cliente', description: 'Datos de un cliente: RUT, estado, responsable, contacto, razones sociales, contactos, ventas activas, proyectos y tareas abiertas.', input_schema: { type: 'object', properties: { cliente: { type: 'string' } }, required: ['cliente'] } },
  { name: 'ventas_cliente', description: 'Ventas y propuestas de un cliente con monto, lo facturado y lo que falta por facturar.', input_schema: { type: 'object', properties: { cliente: { type: 'string' } }, required: ['cliente'] } },
  { name: 'por_facturar', description: 'Lo que falta por facturar: cuotas programadas de meses cerrados sin emitir y trabajos activos con plan sin facturar.', input_schema: { type: 'object', properties: {} } },
  { name: 'trabajos_detenidos', description: 'Trabajos activos sin movimiento en 90 días: con saldo por cobrar o que parecen terminados.', input_schema: { type: 'object', properties: {} } },
]

// Dónde se hace cada cosa. Solo pantallas y secciones que existen en la app; `tab` lleva a la pantalla.
export const AYUDA = [
  { tema: 'Cargar la cartola del banco', claves: ['cartola', 'cargar cartola', 'subir cartola', 'extracto', 'movimientos del banco'], donde: 'Banco › Cargar cartola', tab: 'conciliacion' },
  { tema: 'Conciliar abonos y cargos', claves: ['conciliar', 'abono', 'cargo', 'pago de cliente', 'por resolver', 'banco'], donde: 'Banco › Por resolver', tab: 'conciliacion' },
  { tema: 'Rendir gastos a un cliente', claves: ['rendicion', 'rendiciones', 'rendir', 'rendir cliente'], donde: 'Gastos › Rendiciones', tab: 'expenses' },
  { tema: 'Gastos de notaría y OT', claves: ['notaria', 'ot', 'orden de trabajo', 'pago a la notaria'], donde: 'Gastos › Notaría', tab: 'expenses' },
  { tema: 'Fondos y saldos de gastos de clientes', claves: ['fondo', 'fondos', 'saldo de gastos', 'a favor', 'por cobrar de gastos'], donde: 'Gastos › Por cobrar / A favor', tab: 'expenses' },
  { tema: 'Cierre de mes', claves: ['cierre', 'cerrar mes', 'cierre de mes'], donde: 'Facturación › Cierre de mes', tab: 'billing' },
  { tema: 'Emitir una factura', claves: ['emitir', 'emision', 'emitir factura', 'factura nueva', 'sii'], donde: 'Facturación › Emisión SII', tab: 'billing' },
  { tema: 'Anticipos', claves: ['anticipo', 'anticipos'], donde: 'Facturación › Anticipos disponibles', tab: 'billing' },
  { tema: 'Cobranza de facturas vencidas', claves: ['cobranza', 'vencida', 'vencidas', 'recordatorio de cobro', 'cobrar'], donde: 'Cobranza', tab: 'cobranza' },
  { tema: 'Crear una propuesta o venta', claves: ['propuesta', 'nueva venta', 'venta nueva', 'cotizacion', 'honorarios'], donde: 'Ventas › Nueva propuesta', tab: 'sales' },
  { tema: 'Clientes, contactos, causas y proveedores', claves: ['cliente nuevo', 'nuevo cliente', 'contacto', 'contactos', 'causas', 'proveedores'], donde: 'Clientes (botones Causas, Contactos y Proveedores)', tab: 'clients' },
  { tema: 'Registrar horas', claves: ['horas', 'registrar horas', 'tiempo'], donde: 'Horas', tab: 'horas' },
  { tema: 'Tareas y pendientes', claves: ['tarea', 'tareas', 'pendiente', 'pendientes', 'agenda'], donde: 'Tareas', tab: 'tasks' },
  { tema: 'Caja chica', claves: ['caja chica', 'caja'], donde: 'Caja chica', tab: 'cajachica' },
  { tema: 'Costos y presupuesto de la oficina', claves: ['costos de oficina', 'presupuesto', 'oficina'], donde: 'Oficina', tab: 'presupuestoOficina' },
  { tema: 'Estado de resultados', claves: ['resultado', 'estado de resultados', 'utilidad'], donde: 'Estado de resultados', tab: 'estadoResultados' },
  { tema: 'Flujo de caja', claves: ['flujo de caja', 'flujo', 'proyeccion'], donde: 'Flujo de caja', tab: 'flujoCaja' },
  { tema: 'Calendario tributario y F29', claves: ['f29', 'impuestos', 'calendario tributario', 'vencimientos tributarios'], donde: 'Calendario tributario', tab: 'calendarioTrib' },
  { tema: 'Oportunidades, tendencias y socios', claves: ['oportunidades', 'tendencias', 'socios', 'inteligencia', 'servicios y precios'], donde: 'Inteligencia', tab: 'inteligencia' },
  { tema: 'Mis proyectos', claves: ['proyecto', 'proyectos', 'cartera'], donde: 'Mis proyectos', tab: 'cartera' },
]

export function crearConsultas({ clients = [], billing = [], expenses = [], tasks = [], sales = [], clientEntities = [], proyectos = [], uf = {}, hoy, fgCliente, gastosPorRendirCli, saldoBill, esVencidaB, porCobrarBills, coberturaVenta, folioN = x => String(x || ''), cargarContactos, calcCuotasSinEmitir, calcTrabajosSinFacturar, detenidos }) {
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

  const nombreCli = id => clients.find(c => String(c.id) === String(id))?.name || 'Cliente'
  const num = (n, d = 0) => new Intl.NumberFormat('es-CL', { maximumFractionDigits: d }).format(Number(n) || 0)
  const monto = (v, enUF) => enUF ? `UF ${num(v, 2)}` : clp(v)

  const dondeEsta = ({ tema }) => {
    const q = nz(tema); if (!q) return { error: 'Falta el tema.' }
    const puntaje = a => a.claves.reduce((p, c) => p + (q.includes(nz(c)) ? nz(c).length : 0), 0) + (nz(a.tema).split(' ').filter(w => w.length > 3 && q.includes(w)).length)
    const r = AYUDA.map(a => ({ a, p: puntaje(a) })).filter(x => x.p > 0).sort((x, y) => y.p - x.p).slice(0, 3)
    if (!r.length) return { resumen: { encontrado: false, nota: 'No hay una sección registrada para eso.' }, tarjeta: null }
    return { resumen: { opciones: r.map(x => ({ tema: x.a.tema, donde: x.a.donde })) }, tarjeta: { titulo: 'Dónde está', lineas: r.map(x => ({ n: x.a.tema, sub: x.a.donde, valor: '', destino: { tab: x.a.tab } })), total: null, fuente: 'Toca una línea para ir a esa pantalla.' } }
  }

  const fichaCliente = ({ cliente }) => {
    const f = buscarCliente(cliente); if (f.error) return Promise.resolve({ error: f.error })
    const c = f.cliente
    return Promise.resolve(cargarContactos ? cargarContactos(c.id) : []).catch(() => []).then(contactos => {
      const rs = clientEntities.filter(e => String(e.client_id) === String(c.id))
      const ventasAct = sales.filter(v => v && !v.deleted_at && String(v.client_id) === String(c.id) && v.status === 'Activo')
      const proys = proyectos.filter(p => p && String(p.cliente_id) === String(c.id) && p.activo !== false && !p.pausado)
      const tks = tasks.filter(t => t && String(t.client_id) === String(c.id) && t.status !== 'Terminado' && !t.archived)
      const destino = { tipo: 'cliente', id: c.id }
      const resumen = { cliente: c.name, rut: c.rut || null, estado: c.status || null, tipo: c.tipo_entidad || c.type || null, responsable: c.abogado_responsable || null, correo: c.email || null, telefono: c.telefono || c.phone || null, condicion_de_pago: c.condicion_pago || null,
        razones_sociales: rs.map(e => ({ nombre: e.name, rut: e.rut || null })), contactos: (contactos || []).map(x => ({ nombre: x.nombre, cargo: x.cargo || null, correo: x.email || null, telefono: x.telefono || null, principal: !!x.principal })),
        ventas_activas: ventasAct.length, proyectos_activos: proys.map(p => ({ nombre: p.nombre_proyecto, estado: p.estado || null, responsable: p.responsable || null })), tareas_abiertas: tks.length }
      const lineas = [
        { n: 'Responsable', sub: c.rut ? `RUT ${c.rut}` : '', valor: c.abogado_responsable || '—', destino },
        { n: 'Razones sociales', sub: rs.slice(0, 2).map(e => e.name).join(' · '), valor: String(rs.length), destino },
        { n: 'Contactos', sub: (contactos || []).slice(0, 2).map(x => x.nombre).join(' · '), valor: String((contactos || []).length), destino },
        { n: 'Ventas activas', sub: '', valor: String(ventasAct.length), destino },
        { n: 'Proyectos activos', sub: proys.slice(0, 2).map(p => p.nombre_proyecto).join(' · '), valor: String(proys.length), destino: { tab: 'cartera' } },
        { n: 'Tareas abiertas', sub: '', valor: String(tks.length), destino: { tab: 'tasks' } },
      ]
      return { resumen, tarjeta: { titulo: c.name, lineas, total: null, fuente: `Fuente: ficha del cliente, ventas, proyectos y tareas de la app, al ${dmy(dia)}. Toca una línea para ver el detalle.` } }
    })
  }

  const ventasCliente = ({ cliente }) => {
    const f = buscarCliente(cliente); if (f.error) return { error: f.error }
    const c = f.cliente
    const vs = sales.filter(v => v && !v.deleted_at && String(v.client_id) === String(c.id)).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 8)
    if (!vs.length) return { resumen: { cliente: c.name, ventas: [] }, tarjeta: null }
    const filas = vs.map(v => {
      const bs = billing.filter(b => b && !b.deleted_at && String(b.sale_id) === String(v.id))
      const cv = coberturaVenta ? coberturaVenta(v, bs, uf) : null
      const enUF = v.moneda === 'UF' || (!v.amount_clp && Number(v.amount_uf) > 0)
      const plan = cv ? cv.plan : (enUF ? Number(v.amount_uf) || 0 : Number(v.amount_clp) || 0)
      const fact = cv && cv.ok ? cv.usado : null
      return { v, enUF, plan, fact, falta: fact == null ? null : Math.max(0, plan - fact) }
    })
    return {
      resumen: { cliente: c.name, ventas: filas.map(x => ({ titulo: x.v.title, estado: x.v.status, monto_acordado: monto(x.plan, x.enUF), facturado: x.fact == null ? 'sin calcular' : monto(x.fact, x.enUF), por_facturar: x.falta == null ? 'sin calcular' : monto(x.falta, x.enUF) })), al: dmy(dia) },
      tarjeta: { titulo: 'Ventas', lineas: filas.map(x => ({ n: x.v.title || 'Venta', sub: `${x.v.status || ''}${x.fact == null ? '' : ` · facturado ${monto(x.fact, x.enUF)} · por facturar ${monto(x.falta, x.enUF)}`}`, valor: monto(x.plan, x.enUF), destino: { tipo: 'cliente', id: c.id } })), total: null, fuente: 'Fuente: monto acordado de cada venta y lo facturado con folio. Las ventas mensuales no tienen un plan fijo y no se calculan.' },
    }
  }

  const porFacturar = () => Promise.resolve().then(() => Promise.all([calcCuotasSinEmitir ? calcCuotasSinEmitir() : [], calcTrabajosSinFacturar ? calcTrabajosSinFacturar() : []])).then(([cuotas, trabajos]) => {
    const totCuotas = cuotas.reduce((a, b) => a + (Number(b.amount) || 0), 0), totTrab = trabajos.reduce((a, t) => a + (Number(t.monto) || 0), 0)
    const resumen = { cuotas_sin_emitir: cuotas.length, monto_cuotas_sin_emitir: clp(totCuotas), trabajos_sin_facturar: trabajos.length, monto_trabajos_sin_facturar: clp(totTrab),
      mayores_cuotas: cuotas.slice().sort((a, b) => (b.amount || 0) - (a.amount || 0)).slice(0, 5).map(b => ({ cliente: nombreCli(b.client_id), concepto: String(b.concept || '').slice(0, 60), monto: clp(b.amount), vence: dmy(b.due) })),
      mayores_trabajos: trabajos.slice(0, 5).map(t => ({ cliente: nombreCli(t.s.client_id), venta: t.s.title, monto: clp(t.monto), dias_desde_la_ultima_factura: t.dias })), al: dmy(dia) }
    const tarjetas = []
    if (cuotas.length) tarjetas.push({ titulo: 'Cuotas vencidas sin facturar', lineas: cuotas.slice().sort((a, b) => (b.amount || 0) - (a.amount || 0)).slice(0, 6).map(b => ({ n: nombreCli(b.client_id), sub: `${String(b.concept || '').slice(0, 42)} · vence ${dmy(b.due)}`, valor: clp(b.amount), destino: { tab: 'billing' } })), total: { n: `Total (${cuotas.length})`, valor: clp(totCuotas) }, fuente: 'Fuente: cuotas programadas de meses cerrados sin emitir (radar de Facturación).' })
    if (trabajos.length) tarjetas.push({ titulo: 'Trabajos sin facturar', lineas: trabajos.slice(0, 6).map(t => ({ n: nombreCli(t.s.client_id), sub: `${t.s.title || ''} · ${t.dias} días desde la última factura`, valor: clp(t.monto), destino: { tab: 'billing' } })), total: { n: `Total (${trabajos.length})`, valor: clp(totTrab) }, fuente: 'Fuente: trabajos activos con plan sin facturar (Facturación › Trabajos sin facturar).' })
    return { resumen, tarjeta: tarjetas.length ? tarjetas : null }
  })

  const trabajosDetenidos = () => {
    const l = (detenidos || []).slice().sort((a, b) => (b.dias || 0) - (a.dias || 0))
    return {
      resumen: { trabajos_detenidos: l.length, con_saldo: l.filter(x => x.tipo === 'con_saldo').length, parecen_terminados: l.filter(x => x.tipo === 'terminado').length, mayores: l.slice(0, 6).map(x => ({ cliente: nombreCli(x.s.client_id), venta: x.s.title, tipo: x.tipo === 'con_saldo' ? 'con saldo por cobrar' : 'parece terminado', dias: x.dias, por_cobrar: clp(x.porCobrar) })), al: dmy(dia) },
      tarjeta: l.length ? { titulo: 'Trabajos sin movimiento', lineas: l.slice(0, 8).map(x => ({ n: nombreCli(x.s.client_id), sub: `${x.s.title || ''} · ${x.dias} días · ${x.tipo === 'con_saldo' ? 'con saldo por cobrar' : 'parece terminado'}`, valor: x.porCobrar > 0 ? clp(x.porCobrar) : '', destino: { tipo: 'cliente', id: x.s.client_id } })), total: { n: 'Trabajos', valor: String(l.length) }, fuente: 'Fuente: trabajos activos sin factura, gasto, tarea ni horas en 90 días (Revisión de datos).' } : null,
    }
  }

  const tabla = { deuda_cliente: deudaCliente, por_cobrar: porCobrar, facturas_cliente: facturasCliente, tareas_vencidas: tareasVencidas, donde_esta: dondeEsta, ficha_cliente: fichaCliente, ventas_cliente: ventasCliente, por_facturar: porFacturar, trabajos_detenidos: trabajosDetenidos }
  return async (nombre, input) => { const f = tabla[nombre]; if (!f) return { error: 'Esa consulta no existe.' }; try { return await f(input || {}) } catch (e) { return { error: 'No se pudo calcular: ' + (e?.message || 'error') } } }
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
    const resultados = []
    for (const u of usos) { const r = await ejecutar(u.name, u.input || {}); if (r.tarjeta) (Array.isArray(r.tarjeta) ? r.tarjeta : [r.tarjeta]).forEach(t => tarjetas.push(t)); resultados.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(r.error ? { error: r.error } : r.resumen) }) }
    msgs.push({ role: 'user', content: resultados })
  }
  return { texto: '', tarjetas, agotado: true }
}
