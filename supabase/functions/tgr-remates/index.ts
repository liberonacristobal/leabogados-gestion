// Edge Function: tgr-remates
// Nómina pública de propiedades en remate judicial por cobranza de la TGR (remates.tgr.cl › v1/getListaRematesActivos, la misma
// consulta que hace su página, sin clave ni captcha). Guarda cada remate en tgr_remates (rol, dueño, juzgado, rol judicial, fecha,
// tasación, avalúo), marca vigente = false lo que ya no aparece, y cruza el dueño con los clientes y sus razones sociales (nombre
// normalizado, exacto): un cliente nuevo en la nómina queda en activity_log (tgr.remate_cliente) con el remate.
// La deuda y el cupón de contribuciones por rol NO se consultan: esa búsqueda de la TGR exige reCAPTCHA.
// Auth: CRON_SECRET o sesión de un usuario del dominio de la oficina. verify_jwt=false.

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const hoyCL = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);

// Nombre comparable: minúsculas, sin acentos ni puntuación, abreviaturas societarias unificadas (mismo criterio que diario-oficial).
const norm = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9& ]/g, " ").replace(/\s+/g, " ").trim()
  .replace(/\bltda\b/g, "limitada").replace(/\bcia\b/g, "compania").replace(/\bs a\b/g, "sa");

// deno-lint-ignore no-explicit-any
async function rest(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${path.split("?")[0]}: ${r.status} ${await r.text()}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
// deno-lint-ignore no-explicit-any
async function todas(path: string): Promise<any[]> {
  const out = []; for (let i = 0; ; i += 1000) { const p = await rest(`${path}${path.includes("?") ? "&" : "?"}limit=1000&offset=${i}`); out.push(...p); if (p.length < 1000) return out; }
}

Deno.serve(async (req) => {
  // deno-lint-ignore no-explicit-any
  let body: any = {}; try { body = await req.json(); } catch { /* sin body */ }
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!CRON_SECRET) return json({ error: "No autorizado" }, 403);
  if (body.secret !== CRON_SECRET && bearer !== CRON_SECRET) {
    const u = bearer ? await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${bearer}` } }).then((r) => r.ok ? r.json() : null).catch(() => null) : null;
    const cas = await rest("learnings?kind=eq.config&key=eq.agente_casilla&select=value").catch(() => []);
    const dom = String(cas?.[0]?.value || "").split("@")[1];
    if (!u?.email || !dom || !String(u.email).toLowerCase().endsWith("@" + dom.toLowerCase())) return json({ error: "No autorizado" }, 403);
  }
  try {
    const hoy = hoyCL();
    const r = await fetch("https://remates.tgr.cl/v1/getListaRematesActivos", { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" }, signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error(`TGR ${r.status}`);
    const d = await r.json(); const lista = Array.isArray(d?.data) ? d.data : [];
    if (!lista.length) throw new Error("La TGR no devolvió remates (¿cambió la consulta?)");
    const filas = lista.filter((x: { SK?: string }) => x?.SK).map((x: Record<string, unknown>) => ({
      sk: String(x.SK), rol: x.rol ?? null, rol_formato: x.rolFormato ?? null, comuna: String(x.rolFormato || "").split("-").slice(0, -2).join("-") || null,
      direccion: x.direccionRol ?? null, dueno: x.nombreDuegno ?? null, dueno_norm: norm(String(x.nombreDuegno || "")), juzgado: x.nombreJuzgado ?? null,
      rol_judicial: x.nroExpJud && x.agnoExpjud ? `C-${x.nroExpJud}-${x.agnoExpjud}` : null, fecha_remate: x.fechaRemate ?? null,
      fecha_publicacion: String(x.fechaPrimeraPublicacion || "").slice(0, 10) || null, tasacion: x.tasacion ?? null, avaluo: x.avaluo ?? null,
      tipo_deuda: x.tipoDeuda ?? null, datos_subasta: x.datosSubasta ?? null, payload: x, ultima_vez: hoy, vigente: true,
    }));
    const previos = new Set((await todas("tgr_remates?select=sk")).map((x: { sk: string }) => x.sk));
    for (let i = 0; i < filas.length; i += 300) await rest("tgr_remates?on_conflict=sk", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(filas.slice(i, i + 300)) });
    // Lo que ya no está en la nómina: remate realizado, suspendido o retirado.
    await rest(`tgr_remates?vigente=eq.true&ultima_vez=lt.${hoy}`, { method: "PATCH", body: JSON.stringify({ vigente: false }) });
    // Cruce con los clientes: nombre de la ficha o de una razón social igual al dueño.
    const [clients, ents] = await Promise.all([todas("clients?select=id,name,estudio_id,is_internal"), todas("client_entities?select=client_id,name")]);
    const porNombre = new Map<string, { id: string; estudio_id: string }>();
    for (const c of clients) if (!c.is_internal && norm(c.name).length > 6) porNombre.set(norm(c.name), c);
    for (const e of ents) { const c = clients.find((x: { id: string }) => x.id === e.client_id); if (c && norm(e.name).length > 6) porNombre.set(norm(e.name), c); }
    const deClientes = filas.filter((f: { dueno_norm: string }) => porNombre.has(f.dueno_norm));
    const nuevos = deClientes.filter((f: { sk: string }) => !previos.has(f.sk));
    for (const f of nuevos) {
      const c = porNombre.get(f.dueno_norm)!;
      await rest("activity_log", { method: "POST", body: JSON.stringify({ user_email: "agente", action: "tgr.remate_cliente", table_name: "clients", record_id: c.id, estudio_id: c.estudio_id || "lea",
        detail: { title: `Propiedad en remate (TGR): ${f.dueno} · rol ${f.rol_formato} · ${f.juzgado} ${f.rol_judicial || ""} · remate ${String(f.fecha_remate || "").slice(0, 10).split("-").reverse().join("-")}`, remate: f.sk } }) }).catch(() => null);
    }
    return json({ ok: true, remates: filas.length, nuevos: filas.filter((f: { sk: string }) => !previos.has(f.sk)).length, de_clientes: deClientes.length, avisos: nuevos.length });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
