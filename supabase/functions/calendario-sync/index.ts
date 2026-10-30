// Edge Function: calendario-sync
// Mantiene dos calendarios compartidos en Google Calendar: «LEA · Estudio» (tributario, solo socios) y «LEA · Clientes» (causas en tabla,
// plazos de clientes, contribuciones y publicaciones del Diario Oficial, todo el equipo). Se reparte con _shared/calendarioEventos.js. Cada evento lleva una marca propia (lea=1): la función solo crea, actualiza
// o quita los que creó ella; nunca toca eventos puestos a mano. Lo que debe haber sale de _shared/calendarioEventos.js (función pura, con pruebas).
//
// Cuenta de Google: refresh token con permiso de Calendar guardado en drive_auth id=2 (lo deja el botón «Conectar calendario del estudio»).
// Sin esa conexión solo calcula el plan. Por defecto es una simulación: escribe en Google solo con {escribir:true}.
// Auth: CRON_SECRET en el cuerpo. verify_jwt=false.
//   POST {secret}                      -> simula: devuelve el plan (no escribe)
//   POST {secret, escribir:true}       -> sincroniza con Google Calendar
import { armarEventos, CALENDARIOS, eventosDeCalendario, destinatariosCalendario } from '../_shared/calendarioEventos.js'

const SB_URL = Deno.env.get('SUPABASE_URL') || '', SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '', CRON_SECRET = Deno.env.get('CRON_SECRET') || ''
const CLIENT_ID = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') || '', CLIENT_SECRET = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET') || ''
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })

// deno-lint-ignore no-explicit-any
async function rest(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) } })
  const t = await r.text(); if (!r.ok) throw new Error(`Supabase ${r.status}: ${t.slice(0, 200)}`); return t ? JSON.parse(t) : null
}
const hoyChile = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' })
const sha1 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('')
const idEvento = async (clave: string) => 'lea' + (await sha1(clave)).slice(0, 40)   // ids de Google: solo 0-9 y a-v; los hex lo cumplen
const diaSiguiente = (iso: string) => new Date(new Date(iso + 'T12:00').getTime() + 864e5).toISOString().slice(0, 10)

async function leerDatos() {
  const hoy = hoyChile()
  const [obl, dj, cumplidas, causas, plazos, props, clientes, docs, fer] = await Promise.all([
    rest('obligaciones_tributarias?select=tipo,formulario,detalle,activo,client_id&client_id=is.null'),
    rest('sii_dj_vencimientos?select=anio_tributario,formulario,fecha,detalle&fecha=gte.' + hoy),
    rest('obligaciones_cumplidas?select=clave,client_id&client_id=is.null'),
    rest('causas?select=id,estado,rol,anio,caratula,corte_nombre,libro_nombre,client_id,abogado,ultima_tabla&estado=eq.activa'),
    rest('plazos?select=id,client_id,titulo,descripcion,tipo,fecha,estado&estado=neq.cumplido'),
    rest('propiedades?select=client_id,rol,deuda_contribuciones&limit=3000'),
    rest('clients?select=id,name&limit=2000'),
    rest('documentos_notaria?select=id,cliente_id,do_estado,do_publicacion&do_estado=in.(pendiente,plazo_vencido)'),
    rest('feriados?select=fecha'),
  ])
  const feriados = new Set((fer || []).map((f: { fecha: string }) => String(f.fecha).slice(0, 10)))
  return armarEventos({ hoy, feriados, obl, dj, cumplidas, causas, plazos, props, clientes, docs })
}

async function tokenGoogle(): Promise<string | null> {
  const fila = await rest('drive_auth?id=eq.2&select=refresh_token')
  const rt = Array.isArray(fila) && fila[0]?.refresh_token; if (!rt) return null
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: rt, grant_type: 'refresh_token' }) })
  const d = await r.json(); if (!r.ok) throw new Error(d.error_description || d.error || 'No se pudo renovar el acceso a Google'); return d.access_token
}
// deno-lint-ignore no-explicit-any
async function g(token: string, path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`https://www.googleapis.com/calendar/v3/${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) } })
  if (r.status === 204) return null
  const t = await r.text(); const d = t ? JSON.parse(t) : null
  if (!r.ok) { const e: any = new Error(`Google ${r.status}: ${d?.error?.message || t.slice(0, 160)}`); e.status = r.status; throw e }
  return d
}

async function sincronizar(token: string, eventos: Awaited<ReturnType<typeof leerDatos>>, cal: typeof CALENDARIOS[number], miembros: { email: string; es_socio: boolean }[], dominio: string, excluir: string[]) {
  // El calendario se crea una vez y su id queda guardado (el del estudio conserva la clave «id»).
  const llave = cal.clave === 'estudio' ? 'id' : cal.clave
  const ya = await rest(`learnings?select=value&kind=eq.calendario_estudio&key=eq.${llave}&limit=1`)
  let calId = Array.isArray(ya) && ya[0]?.value
  if (!calId) {
    const c = await g(token, 'calendars', { method: 'POST', body: JSON.stringify({ summary: cal.nombre, timeZone: 'America/Santiago', description: cal.descripcion }) })
    calId = c.id; await rest('learnings', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ kind: 'calendario_estudio', key: llave, value: calId }) })
  }
  // Quién lo ve (solo lectura): miembros del mismo dominio, según el público del calendario.
  const acl: string[] = []
  for (const email of destinatariosCalendario(miembros, dominio, cal.publico, excluir)) {
    try { await g(token, `calendars/${encodeURIComponent(calId)}/acl`, { method: 'POST', body: JSON.stringify({ role: 'reader', scope: { type: 'user', value: email } }) }); acl.push(email) } catch (e) { if ((e as { status?: number }).status !== 409) throw e } }
  // Lo que ya hay (solo eventos con nuestra marca).
  const hoy = hoyChile(), hasta = eventos.length ? diaSiguiente(eventos[eventos.length - 1].fecha) : diaSiguiente(hoy)
  const existentes = new Map<string, { id: string; summary?: string; description?: string; start?: { date?: string }; colorId?: string }>()
  let pagina: string | undefined
  do {
    const q = new URLSearchParams({ privateExtendedProperty: 'lea=1', timeMin: new Date(hoy + 'T00:00:00-04:00').toISOString(), timeMax: new Date(hasta + 'T23:59:59-03:00').toISOString(), maxResults: '2500', singleEvents: 'true' }); if (pagina) q.set('pageToken', pagina)
    const l = await g(token, `calendars/${encodeURIComponent(calId)}/events?${q}`)
    for (const e of l.items || []) existentes.set(e.id, e); pagina = l.nextPageToken
  } while (pagina)
  const res = { creados: 0, actualizados: 0, sin_cambios: 0, quitados: 0 }, deseados = new Set<string>()
  for (const e of eventos) {
    const id = await idEvento(e.clave); deseados.add(id)
    const descripcion = `${e.descripcion}\n\nAbrir en la app: ${e.enlace}`
    const cuerpo = { id, summary: e.titulo, description: descripcion, start: { date: e.fecha }, end: { date: diaSiguiente(e.fecha) }, colorId: e.color, status: 'confirmed',
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: e.minutosAntes }] }, extendedProperties: { private: { lea: '1', clave: e.clave } } }
    const ex = existentes.get(id)
    if (ex) { if (ex.summary === e.titulo && ex.description === descripcion && ex.start?.date === e.fecha && ex.colorId === e.color) { res.sin_cambios++; continue }
      await g(token, `calendars/${encodeURIComponent(calId)}/events/${id}`, { method: 'PUT', body: JSON.stringify(cuerpo) }); res.actualizados++; continue }
    try { await g(token, `calendars/${encodeURIComponent(calId)}/events`, { method: 'POST', body: JSON.stringify(cuerpo) }); res.creados++ }
    catch (err) { if ((err as { status?: number }).status === 409) { await g(token, `calendars/${encodeURIComponent(calId)}/events/${id}`, { method: 'PUT', body: JSON.stringify(cuerpo) }); res.actualizados++ } else throw err }
  }
  for (const [id] of existentes) if (!deseados.has(id)) { await g(token, `calendars/${encodeURIComponent(calId)}/events/${id}`, { method: 'DELETE' }); res.quitados++ }
  return { calendario: cal.nombre, compartido_con: acl.length, ...res }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
  // deno-lint-ignore no-explicit-any
  let b: any = {}; try { b = await req.json() } catch { return json({ error: 'JSON inválido' }, 400) }
  if (!CRON_SECRET || b.secret !== CRON_SECRET) return json({ error: 'No autorizado' }, 403)
  try {
    const eventos = await leerDatos()
    const porTipo: Record<string, number> = {}; eventos.forEach((e: { tipo: string }) => { porTipo[e.tipo] = (porTipo[e.tipo] || 0) + 1 })
    const token = await tokenGoogle()
    const base = { ok: true, conectado: !!token, total: eventos.length, por_tipo: porTipo }
    const miembros = await rest('miembros?select=email,es_socio'), cuenta = await rest('drive_auth?id=eq.2&select=email')
    const dominio = String(cuenta?.[0]?.email || '').split('@')[1] || ''
    // Correos que el estudio pidió dejar fuera de los calendarios (learnings config/calendario_excluidos, separados por coma).
    const ex = await rest('learnings?select=value&kind=eq.config&key=eq.calendario_excluidos&limit=1')
    const excluir = String(Array.isArray(ex) && ex[0]?.value || '').split(',').map(x => x.trim()).filter(Boolean)
    const calendarios = CALENDARIOS.map(c => ({ ...c, eventos: eventosDeCalendario(eventos, c), ven: destinatariosCalendario(miembros, dominio, c.publico, excluir) }))
    if (b.escribir !== true || !token) return json({ ...base, simulacion: true, calendarios: calendarios.map(c => ({ calendario: c.nombre, lo_ven: c.ven, total: c.eventos.length, proximos: c.eventos.slice(0, b.max || 40).map((e: { fecha: string; titulo: string; tipo: string }) => `${e.fecha} · ${e.titulo} [${e.tipo}]`) })) })
    const hechos = []; for (const c of calendarios) hechos.push(await sincronizar(token, c.eventos, c, miembros, dominio, excluir))
    return json({ ...base, calendarios: hechos })
  } catch (e) { return json({ ok: false, error: String((e as Error).message || e).slice(0, 300) }, 500) }
})
