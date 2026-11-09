// Reglas de la Bandeja del agente: cómo se agrupan los correos. Funciones puras (las usa la vista y la prueba).
// Una fila de agente_bandeja trae: id, tipo, estado, asunto, de, de_nombre, recibido_at, motivo, propuesta{accion,…}.

/** Asunto sin los prefijos de respuesta o reenvío («Re:», «RV:», «Fwd:»…). */
export const asuntoBase = s => String(s || '').replace(/^((re|rv|fw|fwd)\s*:\s*)+/i, '').trim()

const ts = r => { const t = new Date(r && r.recibido_at).getTime(); return Number.isFinite(t) ? t : 0 }

/**
 * Junta los correos repetidos: clave = tipo + asunto base + remitente. Un mismo aviso que llega varias veces es UN grupo.
 * @param {any[]} rows
 * @returns {{clave:string, tipo:string, asunto:string, de:string, de_nombre:string, n:number, ultimo:string|null, rows:any[]}[]}
 *   ordenados por el último correo (el más reciente primero); las filas de cada grupo también, de la más reciente a la más antigua.
 */
export function agruparBandeja(rows) {
  /** @type {Map<string, any[]>} */
  const m = new Map()
  for (const r of rows || []) {
    if (!r) continue
    const clave = [r.tipo || '', asuntoBase(r.asunto).toLowerCase(), String(r.de || '').toLowerCase()].join('|')
    if (!m.has(clave)) m.set(clave, [])
    m.get(clave)?.push(r)
  }
  return [...m.entries()].map(([clave, L]) => {
    const rs = [...L].sort((a, b) => ts(b) - ts(a)), r0 = rs[0]
    return { clave, tipo: r0.tipo || '', asunto: asuntoBase(r0.asunto), de: String(r0.de || ''), de_nombre: r0.de_nombre || '', n: rs.length, ultimo: r0.recibido_at || null, rows: rs }
  }).sort((a, b) => ts({ recibido_at: b.ultimo }) - ts({ recibido_at: a.ultimo }))
}

/** Aviso del agente cuando el remitente no calza con ningún cliente (agente-correo). */
export const MOTIVO_SIN_CLIENTE = 'Remitente sin cliente en la app'

/** Etiqueta de la acción pendiente (una partida por acción distinta del usuario). `orden` fija el orden de las tarjetas. */
export function grupoAccionBandeja(r) {
  const a = (r && r.propuesta && r.propuesta.accion) || ''
  const G = {
    registrar_fondo: ['Fondos por registrar', 1], asignar_venta: ['Facturas sin venta', 2], registrar_factura: ['Facturas sin venta', 2],
    adjuntar_respaldo: ['Respaldos de gastos', 3], pedir_boleta: ['Boletas de honorarios', 4], definir_documento: ['Boletas de honorarios', 4],
    conciliar: ['Depósitos por conciliar', 5], registrar_solicitud: ['Solicitudes de fondos', 6], cargar_notaria: ['Liquidaciones de notaría', 7],
    crear_tarea: ['Pedidos de clientes', 8], guardar_cuenta: ['Cuentas por guardar', 9],
  }
  const g = G[a] || ['Por revisar', 10]
  return { t: g[0], orden: g[1] }
}

/**
 * Categoría de una fila ya registrada o sin acción (título de su tarjeta de grupo).
 * `porRemitente` = el aviso es «Remitente sin cliente»: cada remitente + asunto es su propio grupo (se asocia a un cliente).
 * @param {any} r
 * @returns {{t:string, orden:number, porRemitente?:boolean}}
 */
export function categoriaBandeja(r) {
  const p = (r && r.propuesta) || {}, mot = String((r && r.motivo) || ''), a = p.accion || ''
  if (r && r.estado === 'descartado') return { t: 'Descartados', orden: 20 }
  if (r && ['registrado', 'espera', 'resuelto'].includes(r.estado)) {
    if (/conciliado/i.test(mot)) return { t: 'Depósitos ya conciliados', orden: 1 }
    if (a === 'registrar_fondo' || /^fondo/i.test(mot)) return { t: 'Fondos registrados', orden: 2 }
    if (a === 'asignar_venta' || /^factura/i.test(mot)) return { t: 'Facturas asignadas a una venta', orden: 3 }
    if (a === 'registrar_solicitud' || /^solicitud/i.test(mot)) return { t: 'Solicitudes de fondos registradas', orden: 4 }
    if (a === 'adjuntar_respaldo' || /^respaldo/i.test(mot)) return { t: 'Respaldos adjuntados', orden: 5 }
    if (a === 'pedir_boleta' || /^pedido/i.test(mot)) return { t: 'Pedidos de boleta enviados', orden: 6 }
    if (a === 'crear_tarea' || /^tarea/i.test(mot)) return { t: 'Tareas creadas', orden: 7 }
    if (a === 'guardar_cuenta' || /^cuenta/i.test(mot)) return { t: 'Cuentas guardadas', orden: 8 }
    return { t: 'Otros registrados', orden: 9 }
  }
  if (mot === MOTIVO_SIN_CLIENTE) return { t: '', orden: 10, porRemitente: true }
  if (r && (r.tipo === 'spam' || /publicidad/i.test(mot))) return { t: 'Publicidad y notificaciones', orden: 11 }
  return { t: 'Informativos', orden: 12 }
}

/**
 * Tarjetas de grupo de «Ya registrados» / «Sin acción».
 * @param {any[]} rows
 * @returns {{clave:string, t:string, sub:string|null, solo:boolean, n:number, rows:any[], ultimo:string|null, de:string}[]}
 */
export function gruposBandeja(rows) {
  /** @type {Map<string, {clave:string, t:string, orden:number, sub:string|null, solo:boolean, rows:any[], de:string}>} */
  const m = new Map()
  const sin = []
  for (const r of rows || []) {
    const c = categoriaBandeja(r)
    if (c.porRemitente) { sin.push(r); continue }
    if (!m.has(c.t)) m.set(c.t, { clave: c.t, t: c.t, orden: c.orden, sub: null, solo: false, rows: [], de: '' })
    m.get(c.t)?.rows.push(r)
  }
  for (const g of agruparBandeja(sin)) m.set('rem|' + g.clave, { clave: 'rem|' + g.clave, t: g.de_nombre || g.de, orden: 10, sub: g.asunto ? `${g.asunto} · ${MOTIVO_SIN_CLIENTE}` : MOTIVO_SIN_CLIENTE, solo: true, rows: g.rows, de: g.de })
  return [...m.values()].sort((a, b) => a.orden - b.orden || b.rows.length - a.rows.length).map(g => {
    const rs = [...g.rows].sort((a, b) => ts(b) - ts(a))
    return { clave: g.clave, t: g.t, sub: g.sub, solo: g.solo, n: rs.length, rows: rs, ultimo: rs[0] ? rs[0].recibido_at || null : null, de: g.de }
  })
}
