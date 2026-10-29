// Qué eventos debe tener el calendario compartido del estudio en Google Calendar. Función pura: recibe los datos ya leídos de la base y
// devuelve la lista de eventos de día completo; la sincronización compara esa lista con lo que hay en Google y crea, actualiza o quita.
import { CAL_CL, CONTRIB_CUOTAS, ymMas, finDeMes, crearCalendario, djFecha } from './calendarioReglas.js'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const mesNom = ym => { const [Y, M] = String(ym).split('-'); return `${MESES[+M - 1] || ''} ${Y}` }
const dmy = d => { const p = String(d || '').slice(0, 10).split('-'); return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : '' }
const MIN_ANTES = { tributario: 3 * 1440 - 540, otro: 1440 - 540 }   // aviso a las 09:00: 3 días antes (tributario) o el día anterior
const COLOR = { tributario: '9', causa: '3', plazo: '5', contribuciones: '5', diario_oficial: '10' }
const URL_APP = 'https://gestion.leabogados.cl/'

export function armarEventos({ hoy, feriados = new Set(), obl = [], dj = [], cumplidas = [], causas = [], plazos = [], props = [], clientes = [], docs = [], horizonteDias = 240 }) {
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

  // Contribuciones: una cuota por fecha, con los clientes que tienen roles.
  const porCli = new Map(); (props || []).forEach(p => { const g = porCli.get(String(p.client_id)) || { n: 0, deuda: 0 }; g.n++; g.deuda += Number(p.deuda_contribuciones) || 0; porCli.set(String(p.client_id), g) })
  if (porCli.size) [Y, Y + 1].forEach(a => CONTRIB_CUOTAS.forEach(([mm, n]) => { const f = cal.habilDesde(`${a}-${mm}-30`)
    const lista = [...porCli.entries()].sort((x, y) => y[1].n - x[1].n).slice(0, 15).map(([id, g]) => `${nombre(id) || 'Cliente'} · ${g.n} rol${g.n === 1 ? '' : 'es'}${g.deuda > 0 ? ' · con deuda' : ''}`)
    push({ clave: `contrib-${f}`, tipo: 'contribuciones', fecha: f, titulo: `Contribuciones · ${n} cuota`, descripcion: `${(props || []).length} roles de ${porCli.size} clientes.\n${lista.join('\n')}`, enlace: URL_APP }) }))

  // Diario Oficial: fecha límite de publicación de cada extracto pendiente.
  ;(docs || []).filter(d => ['pendiente', 'plazo_vencido'].includes(d.do_estado) && d.do_publicacion && d.do_publicacion.vence).forEach(d => { const f = String(d.do_publicacion.vence).slice(0, 10)
    push({ clave: `do-${d.id}`, tipo: 'diario_oficial', fecha: f, titulo: `Publicación del extracto${nombre(d.cliente_id) ? ' · ' + nombre(d.cliente_id) : ''}`, descripcion: 'Fecha límite para publicar el extracto en el Diario Oficial.', enlace: URL_APP }) })

  return ev.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.clave.localeCompare(b.clave))
}
