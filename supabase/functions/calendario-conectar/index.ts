// Edge Function: calendario-conectar
// Guarda el permiso de Google en drive_auth: destino «calendario» (default) = fila 2, la cuenta del calendario del estudio (contacto@);
// destino «drive» = fila 1, la conexión permanente de Drive y Gmail de quien la autoriza. La tabla solo admite escritura del servidor
// (política drive_auth_solo_servicio), así que la app no puede escribirla directo: llama aquí con su sesión.
// Solo acepta a quien entra con una cuenta del dominio del estudio (el de la casilla del agente, learnings config/agente_casilla).
// Body: { refresh_token, destino? }. verify_jwt=true.
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
  const r = await fetch(`${SB_URL}/rest/v1/drive_auth?on_conflict=id`, {
    method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ id: body.destino === 'drive' ? 1 : 2, refresh_token: rt, email, updated_at: new Date().toISOString() }),
  })
  if (!r.ok) return json({ error: 'No se pudo guardar: ' + (await r.text()).slice(0, 160) }, 500)
  return json({ ok: true, email })
})
