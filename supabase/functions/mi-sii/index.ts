// Edge Function: mi-sii
// Entra a Mi SII con la clave tributaria de una persona (secretos SII_RUT_ACCESO y SII_CLAVE_TRIBUTARIA) y lee, SOLO LEE.
// Reglas: nunca rectifica ni envía nada; no guarda datos personales de Mi SII; la clave no se escribe en logs, respuestas ni tablas.
// Auth: CRON_SECRET en el cuerpo (como las demás tareas programadas). verify_jwt=false.
//
// POST {secret, action:'test-login'}  -> intenta entrar UNA vez y responde solo {ok, etapa}; no trae datos.
//   Freno: no reintenta antes de 30 minutos (varios intentos fallidos pueden bloquear la clave).
const SB_URL = Deno.env.get('SUPABASE_URL') || ''
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const CRON_SECRET = Deno.env.get('CRON_SECRET') || ''
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

async function rest(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) } })
  const t = await r.text(); return t ? JSON.parse(t) : null
}

// Jarra de cookies mínima: se guarda nombre=valor de cada Set-Cookie y se reenvía en las peticiones siguientes.
class Jarra {
  c = new Map<string, string>()
  guardar(res: Response) { for (const sc of (res.headers as any).getSetCookie?.() || []) { const [kv] = sc.split(';'); const i = kv.indexOf('='); if (i > 0) this.c.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()) } }
  get header() { return [...this.c.entries()].map(([k, v]) => `${k}=${v}`).join('; ') }
}
async function ir(url: string, jarra: Jarra, init: RequestInit = {}, saltos = 6): Promise<Response> {
  let u = url, i = { ...init }
  for (let n = 0; n <= saltos; n++) {
    const res = await fetch(u, { ...i, redirect: 'manual', headers: { 'User-Agent': UA, 'Accept-Language': 'es-CL,es;q=0.9', Cookie: jarra.header, ...((i.headers as any) || {}) } })
    jarra.guardar(res)
    const loc = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && loc) { u = new URL(loc, u).toString(); i = { method: 'GET' }; continue }
    return res
  }
  throw new Error('Demasiados redireccionamientos')
}

async function login(): Promise<{ ok: boolean; etapa: string }> {
  const rutAcc = (Deno.env.get('SII_RUT_ACCESO') || '').replace(/[^0-9kK]/g, '').toUpperCase(), clave = Deno.env.get('SII_CLAVE_TRIBUTARIA') || ''
  if (rutAcc.length < 2 || !clave) return { ok: false, etapa: 'faltan_secretos' }
  const cuerpo = rutAcc.slice(0, -1), dv = rutAcc.slice(-1)
  const jarra = new Jarra()
  const pagina = await ir('https://zeusr.sii.cl/AUT2000/InicioAutenticacion/IngresoRutClave.html?https://misii.sii.cl/cgi_misii/siihome.cgi', jarra)
  if (!pagina.ok) return { ok: false, etapa: `pagina_de_ingreso_${pagina.status}` }
  const form = new URLSearchParams({ rutcntr: `${cuerpo}-${dv}`, clave, rut: cuerpo, dv, referencia: 'https://misii.sii.cl/cgi_misii/siihome.cgi', '411': '' })
  const res = await ir('https://zeusr.sii.cl/cgi_AUT2000/CAutInicio.cgi', jarra, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://zeusr.sii.cl/AUT2000/InicioAutenticacion/IngresoRutClave.html' }, body: form.toString() })
  const html = (await res.text()).slice(0, 200000)
  if (/captcha|recaptcha|no soy un robot/i.test(html)) return { ok: false, etapa: 'pide_captcha' }
  if (/IngresoRutClave|Rut o clave incorrecta|clave.*incorrect|Datos de ingreso inválidos|bloquead/i.test(html) && !jarra.c.has('TOKEN')) return { ok: false, etapa: /bloquead/i.test(html) ? 'cuenta_bloqueada' : 'rechazo_de_credenciales' }
  const home = await ir('https://misii.sii.cl/cgi_misii/siihome.cgi', jarra)
  const hh = (await home.text()).slice(0, 200000)
  if (home.ok && !/IngresoRutClave/i.test(hh) && (jarra.c.has('TOKEN') || /Mi SII|cerrar sesi[oó]n/i.test(hh))) return { ok: true, etapa: 'ingreso_correcto' }
  return { ok: false, etapa: 'sin_sesion' }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
  let b: any = {}; try { b = await req.json() } catch { return json({ error: 'JSON inválido' }, 400) }
  if (!CRON_SECRET || b.secret !== CRON_SECRET) return json({ error: 'No autorizado' }, 403)
  if (b.action !== 'test-login') return json({ error: 'Acción desconocida' }, 400)
  const previo = await rest("learnings?select=value&kind=eq.mi_sii_intento&key=eq.ultimo&limit=1").catch(() => null)
  const ult = Array.isArray(previo) && previo[0]?.value ? Date.parse(previo[0].value) : 0
  if (ult && Date.now() - ult < 30 * 60 * 1000) return json({ ok: false, etapa: 'espera_30_min', ultimo_intento: new Date(ult).toISOString() })
  await rest('learnings?kind=eq.mi_sii_intento&key=eq.ultimo', { method: 'DELETE' }).catch(() => null)
  await rest('learnings', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ kind: 'mi_sii_intento', key: 'ultimo', value: new Date().toISOString() }) }).catch(() => null)
  try { return json(await login()) } catch (e) { return json({ ok: false, etapa: 'error_de_red', detalle: String((e as Error).message || e).slice(0, 160) }) }
})
