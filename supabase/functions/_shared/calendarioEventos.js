// Qué eventos debe tener el calendario compartido del estudio en Google Calendar. Función pura: recibe los datos ya leídos de la base y
// devuelve la lista de eventos de día completo; la sincronización compara esa lista con lo que hay en Google y crea, actualiza o quita.
import { CAL_CL, ymMas, finDeMes, crearCalendario, djFecha } from './calendarioReglas.js'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const mesNom = ym => { const [Y, M] = String(ym).split('-'); return `${MESES[+M - 1] || ''} ${Y}` }
const dmy = d => { const p = String(d || '').slice(0, 10).split('-'); return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : '' }
const MIN_ANTES = { tributario: 3 * 1440 - 540, otro: 1440 - 540 }   // aviso a las 09:00: 3 días antes (tributario) o el día anterior
const COLOR = { tributario: '9', causa: '3', plazo: '5', remate: '11', diario_oficial: '10' }
const URL_APP = 'https://gestion.leabogados.cl/'
const normTxt = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9& ]/g, ' ').replace(/\s+/g, ' ').trim()
const fechaChile = ts => new Date(ts).toLocaleDateString('en-CA', { timeZone: 'America/Santiago' })

export function armarEventos({ hoy, feriados = new Set(), obl = [], dj = [], cumplidas = [], causas = [], plazos = [], props = [], remates = [], clientes = [], docs = [], horizonteDias = 240 }) {
  const cal = crearCalendario(feriados)
  const lim = new Date(new Date(hoy + 'T12:00').getTime() + horizonteDias * 864e5).toISOString().slice(0, 10)
  const nombre = id => clientes.find(c => String(c.id) === String(id))?.name || ''
  const ev = []
  const push = (e) => { if (e.fecha >= hoy && e.fecha <= lim) ev.push({ ...e, color: COLOR[e.tipo], minutosAntes: e.tipo === 'tributario' ? MIN_ANTES.tributario : MIN_ANTES.otro }) }
  const tiene = new Set((obl || []).filter(o => o.activo !== false && !o.client_id).map(o => o.tipo))
  const hechas = new Set((cumplidas || []).filter(c => !c.client_id).map(c => c.clave))
  const Y = +hoy.slice(0, 4), ym = hoy.slice(0, 7)

  // Tributario del estudio: mismas fechas que el Calendario tributario de la app.
  ;[['F29', 'F29'], ['COT', 'Cotizaciones']].forEach(([tipo, nom]) => { if (!tiene.has(tipo)) return
    for (let i = -1; i <= 8; i++) { const per = ymMas(ym, i), fecha = cal.venceCalTrib(tipo, per)
      push({ clave: `${tipo}-${per}`, tipo: 'tributario', fecha, titulo: `${nom} · ${mesNom(per)}`, descripcion: `Vencimiento del pago del período ${mesNom(per)}.\nLa app muestra el monto: informado por la contadora o estimado del mes cerrado.`, enlace: URL_APP + '?ir=calendario' }) } })
  const djs = new Map()
  ;(obl || []).filter(o => o.activo !== false && !o.client_id && o.tipo === 'DJ').forEach(o => { ;[Y, Y + 1].forEach(a => { const r = djFecha(o, (dj || []).filter(x => +x.anio_tributario === a)); if (!r || hechas.has(`DJ-${o.formulario}-${a}`)) return
    const fecha = cal.habilDesde(r.fecha); const g = djs.get(fecha) || { forms: [], at: a }; g.forms.push(o.formulario); djs.set(fecha, g) }) })
  djs.forEach((g, fecha) => push({ clave: `DJ-${fecha}`, tipo: 'tributario', fecha, titulo: `Declaraciones juradas ${[...new Set(g.forms)].join(' · ')}`, descripcion: `Año tributario ${g.at}. Se marca presentada en el Calendario tributario.`, enlace: URL_APP + '?ir=calendario' }))
  if (tiene.has('F22')) [Y, Y + 1].forEach(a => { if (hechas.has(`F22-${a}`)) return; push({ clave: `F22-${a}`, tipo: 'tributario', fecha: cal.habilDesde(`${a}-${String(CAL_CL.F22.mes).padStart(2, '0')}-${CAL_CL.F22.dia}`), titulo: `F22 · Renta AT ${a}`, descripcion: 'Declaración anual de renta.', enlace: URL_APP + '?ir=calendario' }) })
  if (tiene.has('PATENTE')) [Y, Y + 1].forEach(a => CAL_CL.PATENTE.meses.forEach(m => { const f = finDeMes(`${a}-${String(m).padStart(2, '0')}`); push({ clave: `PAT-${f}`, tipo: 'tributario', fecha: f, titulo: 'Patente municipal', descripcion: 'Fecha según la municipalidad.', enlace: URL_APP + '?ir=calendario' }) }))

  // Causas en tabla (lectura diaria de pjud.cl).
  ;(causas || []).filter(c => c.estado === 'activa' && c.ultima_tabla && c.ultima_tabla.fecha).forEach(c => { const f = String(c.ultima_tabla.fecha).slice(0, 10)
    push({ clave: `causa-${c.id}-${f}`, tipo: 'causa', fecha: f, titulo: `Vista en tabla · Rol ${c.rol}-${c.anio}`,
      descripcion: [String(c.corte_nombre || ''), c.libro_nombre || '', c.ultima_tabla.sala ? `Sala: ${c.ultima_tabla.sala}` : '', c.ultima_tabla.numero ? `N° en la tabla: ${c.ultima_tabla.numero}` : '', `Causa: ${String(c.caratula || '').trim()}`, nombre(c.client_id) ? `Cliente: ${nombre(c.client_id)}` : '', c.abogado ? `Abogado: ${c.abogado}` : ''].filter(Boolean).join('\n'), enlace: URL_APP + '?ir=causas' }) })

  // Plazos de clientes (contratos y documentos confirmados).
  ;(plazos || []).filter(p => p.estado !== 'cumplido' && p.tipo !== 'tabla' && p.fecha).forEach(p => { const f = String(p.fecha).slice(0, 10)
    push({ clave: `plazo-${p.id}`, tipo: 'plazo', fecha: f, titulo: `${p.titulo || 'Plazo'}${nombre(p.client_id) ? ' · ' + nombre(p.client_id) : ''}`, descripcion: [p.descripcion || '', nombre(p.client_id) ? `Cliente: ${nombre(p.client_id)}` : ''].filter(Boolean).join('\n'), enlace: URL_APP }) })

  // Remates de la TGR de propiedades de los clientes: solo los que calzan por rol (comuna + manzana + predio) con la tabla propiedades;
  // la nómina de la TGR es nacional y el dueño por nombre no basta para meterlo al calendario.
  const claveRol = (comuna, mz, pr) => `${normTxt(comuna)}|${Number(mz)}|${Number(pr)}`
  const dePropiedad = new Map()
  ;(props || []).forEach(p => { const [mz, pr] = String(p.rol || '').split('-'); if (mz && pr && p.comuna) dePropiedad.set(claveRol(p.comuna, mz, pr), p) })
  ;(remates || []).filter(r => r.fecha_remate).forEach(r => { const a = String(r.rol_formato || '').split('-'); if (a.length < 3) return
    const p = dePropiedad.get(claveRol(a.slice(0, -2).join('-'), a[a.length - 2], a[a.length - 1])); if (!p) return
    const f = fechaChile(r.fecha_remate); const cli = nombre(p.client_id)
    push({ clave: `remate-${r.sk}`, tipo: 'remate', fecha: f, titulo: `Remate TGR · rol ${r.rol_formato}${cli ? ' · ' + cli : ''}`,
      descripcion: [`Propiedad de un cliente en remate por cobranza de la TGR.`, cli ? `Cliente: ${cli}` : '', r.dueno ? `Dueño según la TGR: ${r.dueno}` : '', r.juzgado ? `${r.juzgado}${r.rol_judicial ? ' · ' + r.rol_judicial : ''}` : '', r.tasacion ? `Tasación: $${Math.round(Number(r.tasacion)).toLocaleString('es-CL')}` : ''].filter(Boolean).join('\n'), enlace: URL_APP + (p.client_id ? `?cliente=${p.client_id}` : '') }) })

  // Diario Oficial: fecha límite de publicación de cada extracto pendiente.
  ;(docs || []).filter(d => ['pendiente', 'plazo_vencido'].includes(d.do_estado) && d.do_publicacion && d.do_publicacion.vence).forEach(d => { const f = String(d.do_publicacion.vence).slice(0, 10)
    push({ clave: `do-${d.id}`, tipo: 'diario_oficial', fecha: f, titulo: `Publicación del extracto${nombre(d.cliente_id) ? ' · ' + nombre(d.cliente_id) : ''}`, descripcion: 'Fecha límite para publicar el extracto en el Diario Oficial.', enlace: URL_APP }) })

  return ev.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.clave.localeCompare(b.clave))
}

// Dos calendarios de Google, cada uno con su público: lo tributario del estudio lo ven solo los socios; lo que es de clientes (causas en
// tabla, plazos, remates de la TGR, publicaciones del Diario Oficial), todo el equipo.
export const CALENDARIOS = [
  { clave: 'estudio', nombre: 'LEA · Estudio', tipos: ['tributario'], publico: 'socios', descripcion: 'Obligaciones tributarias del estudio. Lo mantiene la app automáticamente.' },
  { clave: 'clientes', nombre: 'LEA · Clientes', tipos: ['causa', 'plazo', 'remate', 'diario_oficial'], publico: 'equipo', descripcion: 'Causas en tabla, plazos, remates y publicaciones de los clientes. Lo mantiene la app automáticamente.' },
]
export const eventosDeCalendario = (eventos, cal) => (eventos || []).filter(e => cal.tipos.includes(e.tipo))

// Correos que ven un calendario: solo miembros del mismo dominio que la cuenta dueña (otro estudio o un correo personal nunca entran);
// 'socios' = los marcados socio, 'equipo' = todos; `excluir` = correos que el estudio pidió dejar fuera. Sin repetidos.
export function destinatariosCalendario(miembros, dominio, publico, excluir = []) {
  const fuera = new Set((excluir || []).map(x => String(x).toLowerCase().trim()))
  const dom = String(dominio || '').toLowerCase().replace(/^@/, '')
  if (!dom) return []
  const out = new Set()
  for (const m of miembros || []) {
    const e = String(m?.email || '').toLowerCase().trim()
    if (!e.endsWith('@' + dom) || fuera.has(e)) continue
    if (publico === 'socios' && !m.es_socio) continue
    out.add(e)
  }
  return [...out]
}
