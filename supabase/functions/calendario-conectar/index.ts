// Edge Function: calendario-conectar
// Guarda el permiso de Google en drive_auth: destino «calendario» (default) = fila 2, la cuenta del calendario del estudio (contacto@);
// destino «drive» = fila 1, la conexión permanente de Drive y Gmail de quien la autoriza. La tabla solo admite escritura del servidor
// (política drive_auth_solo_servicio), así que la app no puede escribirla directo: llama aquí con su sesión.
// Solo acepta a quien entra con una cuenta del dominio del estudio (el de la casilla del agente, learnings config/agente_casilla).
// PROTECCIÓN (2026-11-04): la fila 1 sirve a las funciones que leen el correo y Drive de la oficina (boletas, notaría, contadora…): un permiso
// de otra persona la dejaría leyendo OTRO buzón. Por eso solo la reemplaza (a) su mismo dueño, al renovar su permiso, o (b) alguien que pidió el
// cambio a propósito (body.explicito, desde «Conectar Drive» del menú). Cualquier otro intento se rechaza y queda en la bitácora. Todo cambio de
// dueño queda en la bitácora, en learnings config drive_auth_duenos (lo que gmail-lectura vigila cada día) y avisa al teléfono de los socios.
// Body: { refresh_token, destino?, explicito? }. verify_jwt=true.
const SB_URL = Deno.env.get('SUPABASE_URL') || '', SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Content-Type': 'application/json' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: CORS })
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const u = bearer ? await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${bearer}` } }).then((r) => r.ok ? r.json() : null).catch(() => null) : null
  const cas = await fetch(`${SB_URL}/rest/v1/learnings?kind=eq.config&key=eq.agente_casilla&select=value`, { headers: H }).then((r) => r.json()).catch(() => [])
  const dom = String(cas?.[0]?.value || '').split('@')[1]
  const email = String(u?.email || '').toLowerCase()
  if (!email || !dom || !email.endsWith('@' + dom.toLowerCase())) return json({ error: 'No autorizado' }, 403)
  const body = await req.json().catch(() => ({}))
  const rt = String(body.refresh_token || '')
  if (rt.length < 20) return json({ error: 'Falta el permiso de Google' }, 400)
  const id = body.destino === 'drive' ? 1 : 2
  const act = (await fetch(`${SB_URL}/rest/v1/drive_auth?id=eq.${id}&select=email`, { headers: H }).then((r) => r.json()).catch(() => []))?.[0]
  const duenoAct = String(act?.email || '').toLowerCase()
  const cambia = !!duenoAct && duenoAct !== email
  const bitacora = (action: string, detail: Record<string, unknown>) => fetch(`${SB_URL}/rest/v1/activity_log`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ user_email: email, action, table_name: 'drive_auth', detail: JSON.stringify(detail), estudio_id: 'lea' }) }).catch(() => null)
  if (id === 1 && cambia && !body.explicito) {
    await bitacora('drive.conexion_bloqueada', { fila: 1, dueno: duenoAct, intento: email })
    return json({ ok: false, protegida: true, dueno: duenoAct })   // la app lo dice en pantalla: no queda en silencio
  }
  const r = await fetch(`${SB_URL}/rest/v1/drive_auth?on_conflict=id`, {
    method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ id: body.destino === 'drive' ? 1 : 2, refresh_token: rt, email, updated_at: new Date().toISOString() }),
  })
  if (!r.ok) return json({ error: 'No se pudo guardar: ' + (await r.text()).slice(0, 160) }, 500)
  // Registro de dueños: lo que gmail-lectura compara cada día con la tabla (si no coinciden, alguien escribió la fila por otra vía).
  try {
    const cfg = (await fetch(`${SB_URL}/rest/v1/learnings?kind=eq.config&key=eq.drive_auth_duenos&select=id,value`, { headers: H }).then((x) => x.json()).catch(() => []))?.[0]
    let reg: Record<string, string> = {}; try { reg = JSON.parse(String(cfg?.value || '{}')) } catch { reg = {} }
    reg[String(id)] = email
    const val = JSON.stringify(reg)
    if (cfg?.id) await fetch(`${SB_URL}/rest/v1/learnings?id=eq.${cfg.id}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ value: val }) })
    else await fetch(`${SB_URL}/rest/v1/learnings`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ kind: 'config', key: 'drive_auth_duenos', value: val, estudio_id: 'lea' }) })
  } catch { /* el registro es una red de seguridad: si falla, la vigilancia diaria lo nota */ }
  if (cambia) await bitacora('drive.conexion_cambiada', { fila: id, de: duenoAct, a: email })
  return json({ ok: true, email, cambio: cambia ? { de: duenoAct, a: email } : null })
})
