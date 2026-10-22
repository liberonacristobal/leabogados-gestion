// Edge Function: contactos-perfil
// Perfil de contactos de clientes desde la casilla conectada (drive_auth), para distinguir quién decide de quién apoya en lo
// contable. Nunca guarda el texto de un correo: devuelve solo lo necesario para clasificar.
//  · action 'firmas' { emails[] }: por cada dirección, cuántos correos escribió y en cuántos va en «Para» o en copia; de sus 3
//    correos más recientes, SOLO las líneas de la firma (bloque final del texto propio, antes de lo citado) que nombran un
//    cargo o la empresa, los asuntos y los nombres de los adjuntos.
//  · action 'buscar' { consultas: [{ client_id, q }] }: participantes (nombre y dirección) de los hilos que responden a la
//    consulta, solo por encabezados, para encontrar personas de clientes que no están en la otra casilla.
// Auth: CRON_SECRET. verify_jwt=false.

const CLIENT_ID = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") || "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") || "";
const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const ANTHROPIC = Deno.env.get("ANTHROPIC_API_KEY") || "";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

let _tok = "", _exp = 0;
async function token(): Promise<string> {
  if (_tok && _exp > Date.now() + 60000) return _tok;
  const r0 = await fetch(`${SB_URL}/rest/v1/drive_auth?id=eq.1&select=refresh_token,email`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
  const rt = (await r0.json())?.[0]?.refresh_token; if (!rt) throw new Error("Sin conexión de Google (drive_auth)");
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: rt, grant_type: "refresh_token" }) });
  const d = await r.json(); if (!r.ok) throw new Error(d.error_description || d.error || "Token");
  _tok = d.access_token; _exp = Date.now() + (d.expires_in || 3600) * 1000; return _tok;
}
async function gm(path: string) {
  for (let i = 0; ; i++) {
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { headers: { Authorization: `Bearer ${await token()}` } });
    if ((r.status === 429 || r.status >= 500 || r.status === 403) && i < 3) { await new Promise((ok) => setTimeout(ok, 1500 * (i + 1))); continue; }
    return r.ok ? r.json() : null;
  }
}
const txt = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));
const CARGO = /\b(gerente|gerencia|director|directora|socio|socia|presidente|presidenta|fundador|fundadora|ceo|cfo|coo|cto|due[ñn]o|propietari|contador|contadora|contabilidad|contable|administraci[oó]n|administrador|administradora|finanzas|financier[oa]|tesorer[oa]|asistente|secretari[oa]|jefe|jefa|encargad[oa]|analista|ejecutiv[oa]|abogad[oa]|counsel|coordinador|coordinadora|subgerente|controller|auditor|auditora|operaciones|recursos humanos|rrhh|partner|manager|head)\b/i;
const ORG = /\b(spa|s\.\s?a\.?|ltda\.?|limitada|abogados|consultores|asesor[ií]as|contadores|inversiones|holding|group|grupo)\b/i;
const CORTE = /^\s*(>|De:|From:|Enviado:|Sent:|-----\s*Original|El .{0,160}escribi[oó]:|On .{0,160}wrote:|_{6,})/mi;
const nrm = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
// Una línea de firma válida: corta, con palabras (nunca algo sin espacios con números o símbolos, que puede ser una clave),
// sin teléfonos, correos, enlaces ni direcciones, y que nombre un cargo o una empresa.
const lineaOk = (l: string) => l.length >= 3 && l.length <= 60 && l.split(/\s+/).length <= 8 && /\s/.test(l.trim()) === true && !/\d{4,}|@|https?:|www\.|[$#%&*=]|^\+|av\.|avenida|calle|piso\b|of\.|oficina \d/i.test(l) && !/[.,:;]$/.test(l) && (CARGO.test(l) || ORG.test(l));
function firma(texto: string, nombre: string): string[] {
  const t = String(texto || "").replace(/\r/g, ""); const c = t.search(CORTE);
  const cola = (c >= 0 ? t.slice(0, c) : t).split("\n").map((l) => l.replace(/[|•·*]+/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean).slice(-16);
  // Se ubica el nombre de quien escribe al final del correo y se toman las líneas que siguen (cargo, empresa).
  const ps = nrm(nombre).split(/\s+/).filter((w) => w.length >= 3);
  let i = -1; for (let k = cola.length - 1; k >= 0; k--) { const l = nrm(cola[k]); if (ps.length && ps.filter((w) => l.includes(w)).length >= Math.min(2, ps.length) && cola[k].length <= 60) { i = k; break; } }
  const zona = i >= 0 ? cola.slice(i + 1, i + 4) : [];
  const hall = zona.filter(lineaOk);
  if (hall.length) return [...new Set(hall)].slice(0, 3);
  // Sin el nombre a la vista (firma con otro formato): el cargo en las últimas 8 líneas, solo si nombra un cargo.
  return [...new Set(cola.slice(-8).filter((l) => lineaOk(l) && CARGO.test(l)))].slice(0, 2);
}
// body.ia: la IA lee solo las últimas líneas del texto propio de cada correo y devuelve el cargo y la empresa de la firma.
// El texto no se guarda ni se devuelve; solo { cargo, empresa }.
async function cargoIA(nombre: string, colas: string[]): Promise<{ cargo: string | null; empresa: string | null } | null> {
  if (!ANTHROPIC || !colas.length) return null;
  const prompt = `Estas son las últimas líneas de correos escritos por ${nombre || "una persona"}. Extrae SOLO de su firma el cargo y la empresa por la que firma. Si no hay firma con cargo, usa null. No incluyas teléfonos, direcciones, correos, claves ni ningún otro dato. Responde SOLO JSON: {"cargo": string|null, "empresa": string|null}.\n\n${colas.map((c, i) => `--- Correo ${i + 1} ---\n${c}`).join("\n")}`;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": ANTHROPIC, "anthropic-version": "2023-06-01", "Content-Type": "application/json" }, body: JSON.stringify({ model: "claude-opus-4-8", max_tokens: 120, messages: [{ role: "user", content: prompt }] }) });
    const j = await r.json(); const t = (j?.content?.[0]?.text || "").replace(/```json|```/g, "").trim();
    const o = JSON.parse(t); const ok = (x: unknown) => typeof x === "string" && x.length <= 80 && /\s|[a-z]{3,}/i.test(x) && !/\d{4,}|@|https?:|[$#%&*=]/.test(x) ? x.trim() : null;
    return { cargo: ok(o.cargo), empresa: ok(o.empresa) };
  } catch { return null; }
}
function partes(p: any, out: any[] = []): any[] { if (!p) return out; out.push(p); (p.parts || []).forEach((x: any) => partes(x, out)); return out; }
const cab = (m: any, n: string) => (m.payload?.headers || []).find((h: any) => h.name.toLowerCase() === n)?.value || "";

Deno.serve(async (req) => {
  let body: any = {}; try { body = await req.json(); } catch { /* sin body */ }
  if (!CRON_SECRET || body.secret !== CRON_SECRET) return json({ error: "No autorizado" }, 403);
  try {
    if (body.action === "firmas") {
      const out: any[] = [];
      for (const e of (body.emails || []).slice(0, 40)) {
        const em = String(e).trim().toLowerCase(); if (!em.includes("@")) continue;
        const [de, para, cc] = await Promise.all([gm(`messages?maxResults=100&q=${encodeURIComponent(`from:${em} newer_than:24m`)}`), gm(`messages?maxResults=100&q=${encodeURIComponent(`to:${em} newer_than:24m`)}`), gm(`messages?maxResults=100&q=${encodeURIComponent(`cc:${em} newer_than:24m`)}`)]);
        const lineas: string[] = [], asuntos: string[] = [], adjuntos: string[] = [], colas: string[] = []; let nombre = "";
        for (const it of (de?.messages || []).slice(0, 3)) {
          const m = await gm(`messages/${it.id}?format=full`); if (!m) continue;
          const fromH = cab(m, "from"); const dn = fromH.replace(/<[^>]+>/, "").replace(/["']/g, "").trim(); if (dn && !dn.includes("@") && dn.length > nombre.length) nombre = dn;
          const ps = partes(m.payload); const plano = ps.find((p) => p.mimeType === "text/plain" && p.body?.data && !p.filename);
          const html = ps.find((p) => p.mimeType === "text/html" && p.body?.data && !p.filename);
          const t = plano ? txt(plano.body.data) : html ? txt(html.body.data).replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li)>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ") : "";
          firma(t, dn || em.split("@")[0].replace(/[._]/g, " ")).forEach((l) => lineas.push(l));
          if (body.ia) { const c0 = t.replace(/\r/g, "").search(CORTE); const propio = (c0 >= 0 ? t.slice(0, c0) : t).split("\n").map((l) => l.trim()).filter(Boolean); colas.push(propio.slice(-18).join("\n").slice(0, 1500)); }
          const s = cab(m, "subject"); if (s) asuntos.push(s.slice(0, 90));
          ps.filter((p) => p.filename).forEach((p) => adjuntos.push(p.filename));
        }
        const ia = body.ia ? await cargoIA(nombre, colas) : null;
        out.push({ email: em, nombre, ia, enviados: (de?.messages || []).length, en_para: (para?.messages || []).length, en_copia: (cc?.messages || []).length, firma: [...new Set(lineas)].slice(0, 4), asuntos: [...new Set(asuntos)], adjuntos: [...new Set(adjuntos)].slice(0, 8) });
      }
      return json({ ok: true, n: out.length, perfiles: out });
    }
    // Arma las consultas desde la base: nombre del cliente y sus razones sociales (sin «SpA», «Ltda.»…), un lote por llamada.
    if (body.action === "buscar_clientes") {
      const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };
      const cl = await (await fetch(`${SB_URL}/rest/v1/clients?select=id,name,abogado_responsable,is_internal,is_colaborador&order=name.asc`, { headers: H })).json();
      const en = await (await fetch(`${SB_URL}/rest/v1/client_entities?select=client_id,name`, { headers: H })).json();
      const lim = (x: string) => x.replace(/\b(spa|s\.?\s?a\.?|ltda\.?|limitada|eirl)\b\.?/gi, "").replace(/["()]/g, "").replace(/\s+/g, " ").trim();
      const sel = cl.filter((c: any) => !c.is_internal && !c.is_colaborador && c.name !== "Clientes ocasionales" && (!body.abogado || c.abogado_responsable === body.abogado));
      const lote = sel.slice(Number(body.desde || 0), Number(body.desde || 0) + Number(body.n || 8));
      body.consultas = lote.map((c: any) => { const ts = [c.name, ...en.filter((e: any) => e.client_id === c.id).map((e: any) => e.name)].map(lim).filter((t: string) => t.length >= 6);
        return { client_id: c.id, cliente: c.name, q: `(${[...new Set(ts)].map((t) => `"${t}"`).join(" OR ")}) newer_than:24m -category:promotions -category:social` }; });
      body.total = sel.length; body.action = "buscar";
    }
    if (body.action === "buscar") {
      const out: any[] = [];
      for (const c of (body.consultas || []).slice(0, 25)) {
        const l = await gm(`threads?maxResults=40&q=${encodeURIComponent(c.q)}`); const vistos: Record<string, any> = {};
        for (const th of (l?.threads || []).slice(0, 40)) {
          const t = await gm(`threads/${th.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date`); if (!t) continue;
          for (const m of t.messages || []) for (const h of ["from", "to", "cc"]) for (const a of String(cab(m, h)).split(",")) {
            const em = (a.match(/<([^>]+)>/)?.[1] || a).trim().toLowerCase(); if (!em.includes("@")) continue;
            const nm = a.replace(/<[^>]+>/, "").replace(/["']/g, "").trim();
            const v = vistos[em] || (vistos[em] = { email: em, nombre: "", hilos: new Set(), de: 0, asunto: cab(m, "subject").slice(0, 90), ultimo: "" });
            if (nm && nm.length > v.nombre.length && !nm.includes("@")) v.nombre = nm; v.hilos.add(th.id); if (h === "from") v.de++;
            const f = new Date(Number(m.internalDate)).toISOString().slice(0, 10); if (f > v.ultimo) v.ultimo = f;
          }
        }
        out.push({ client_id: c.client_id, cliente: c.cliente || null, participantes: Object.values(vistos).map((v: any) => ({ ...v, hilos: v.hilos.size })) });
      }
      return json({ ok: true, total: body.total ?? null, resultados: out });
    }
    return json({ error: "Acción desconocida" }, 400);
  } catch (e) { return json({ error: String((e as Error).message || e) }, 500); }
});
