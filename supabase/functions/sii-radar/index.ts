// sii-radar — auto-ingesta del SII (Radar Tributario).
//
// Qué hace: lee los ÍNDICES oficiales del SII (circulares y resoluciones del año) y guarda en `sii_novedades` (la misma tabla
// del alta manual del Radar) cada documento que todavía no está. El número, la fecha, el título y el PDF se leen TAL CUAL del
// índice (cada documento es un <h5> con el enlace al PDF «Resolución Exenta SII N° 144 del 23 de Octubre del 2026» y un <p> con
// la materia): nada de eso lo escribe la IA. La IA solo agrega, para lo nuevo, un resumen de una frase y las áreas del estudio a
// las que afecta, elegidas de las áreas REALES de las ventas (sales.area), que es con lo que el Radar cruza a los clientes.
//
// NO NEGOCIABLE (materia legal): solo documentos reales de la fuente oficial, siempre con su número, fecha y PDF; el abogado
// valida en la app (compuerta humana en el Radar).
//
// Año: el del día (en enero también el anterior); body.anios = [2025] para cargar otro. La numeración se reinicia cada año:
// el duplicado se mide por tipo + número + año. Las filas antiguas que apuntaban al índice reciben el enlace a su PDF.
// Cron: días hábiles (procesos_catalogo sii-radar). Auth: CRON_SECRET o sesión de un usuario del dominio de la oficina.

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
const SII = "https://www.sii.cl/normativa_legislacion";
const FUENTES = (anio: number) => [
  { tipo: "circular", url: `${SII}/circulares/${anio}/indcir${anio}.htm` },
  { tipo: "resolucion", url: `${SII}/resoluciones/${anio}/res_ind${anio}.htm` },
];
const MESES: Record<string, string> = { enero: "01", febrero: "02", marzo: "03", abril: "04", mayo: "05", junio: "06", julio: "07", agosto: "08", septiembre: "09", setiembre: "09", octubre: "10", noviembre: "11", diciembre: "12" };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const ent = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
  .replace(/&deg;/g, "°").replace(/&ordm;/g, "º").replace(/&ldquo;|&rdquo;|&laquo;|&raquo;/g, '"').replace(/&lsquo;|&rsquo;/g, "'").replace(/&ndash;|&mdash;/g, "-")
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/&([a-z])(acute|tilde|uml);/gi, (_, l, k) => ({ acute: { a: "á", e: "é", i: "í", o: "ó", u: "ú", A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú" }, tilde: { n: "ñ", N: "Ñ" }, uml: { u: "ü", U: "Ü" } } as Record<string, Record<string, string>>)[k.toLowerCase()]?.[l] || l)
  .replace(/\s+/g, " ").trim();

// deno-lint-ignore no-explicit-any
async function rest(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${path.split("?")[0]}: ${r.status} ${await r.text()}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}

// Documentos del índice: [{numero, fecha, titulo, url}] leídos de cada <h5><a href=PDF>… N° X del D de Mes del AAAA</a></h5><p>materia</p>.
function leerIndice(html: string, base: string) {
  const out: { numero: string; fecha: string | null; titulo: string; url: string }[] = [];
  for (const m of html.matchAll(/<h5[^>]*>\s*<a\s+href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>\s*<\/h5>\s*<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    const cab = ent(m[2]); const n = cab.match(/N\s*[°º]\s*(\d+)/i); if (!n) continue;
    const f = cab.match(/(\d{1,2})\s+de\s+([a-záéíóú]+)\s+(?:del?\s+)?(\d{4})/i);
    const mes = f ? MESES[f[2].toLowerCase()] : null;
    out.push({ numero: String(Number(n[1])), fecha: f && mes ? `${f[3]}-${mes}-${f[1].padStart(2, "0")}` : null, titulo: ent(m[3]) || cab, url: new URL(m[1], base).toString() });
  }
  return out;
}

// Resumen de una frase + áreas, para un lote de documentos nuevos. Si la IA falla, se guardan igual (sin resumen ni áreas).
async function clasificar(docs: { titulo: string }[], tipo: string, areas: string[]) {
  if (!ANTHROPIC_API_KEY || !docs.length) return [];
  const prompt = `Eres asistente tributario de un estudio de abogados chileno. Para cada documento del SII (tipo: ${tipo}) de la lista, ` +
    `devuelve SOLO un JSON array con un objeto por documento, en el mismo orden: {"i":<índice>,"resumen":"1 frase factual basada solo en el título","areas":[]}. ` +
    `Para "areas" usa SOLO un subconjunto EXACTO de: ${areas.join(" | ")} ([] si ninguna). Sin markdown ni texto extra.\n\n` +
    docs.map((d, i) => `${i}. ${d.titulo}`).join("\n");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-opus-4-8", max_tokens: 4000, messages: [{ role: "user", content: prompt }] }),
  });
  const j = await r.json().catch(() => null);
  const txt = String(j?.content?.[0]?.text || "").replace(/```json|```/g, "").trim();
  try { const arr = JSON.parse(txt.slice(txt.indexOf("["), txt.lastIndexOf("]") + 1)); return Array.isArray(arr) ? arr : []; } catch { return []; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  // deno-lint-ignore no-explicit-any
  let body: any = {}; try { body = await req.json(); } catch { /* sin body */ }
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!CRON_SECRET || !SB_URL || !SB_KEY) return json({ error: "Faltan secretos" }, 500);
  let quien = "agente";
  if (body.secret !== CRON_SECRET && bearer !== CRON_SECRET) {
    const u = bearer ? await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${bearer}` } }).then((r) => r.ok ? r.json() : null).catch(() => null) : null;
    const cas = await rest("learnings?kind=eq.config&key=eq.agente_casilla&select=value").catch(() => []);
    const dom = String(cas?.[0]?.value || "").split("@")[1];
    if (!u?.email || !dom || !String(u.email).toLowerCase().endsWith("@" + dom.toLowerCase())) return json({ error: "No autorizado" }, 403);
    quien = u.email;
  }
  try {
    const hoy = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10), y = Number(hoy.slice(0, 4));
    const anios: number[] = Array.isArray(body.anios) && body.anios.length ? body.anios.map(Number).filter((a: number) => a >= 2000 && a <= y) : (hoy.slice(5, 7) === "01" ? [y - 1, y] : [y]);
    // Áreas reales del estudio: las de sus ventas activas o terminadas (con eso cruza el Radar).
    const ventas = await rest("sales?select=area&deleted_at=is.null&status=in.(Activo,Terminado)&area=not.is.null&limit=5000");
    const areas = [...new Set(ventas.map((s: { area: string }) => String(s.area).trim()).filter(Boolean))].sort() as string[];
    let inserted = 0, enlaces = 0; const errores: string[] = []; const nuevos: string[] = [];
    for (const anio of anios) for (const f of FUENTES(anio)) {
      try {
        const res = await fetch(f.url, { headers: { "User-Agent": "Mozilla/5.0 (radar)" } });
        if (!res.ok) { errores.push(`${f.url} -> HTTP ${res.status}`); continue; }
        const docs = leerIndice(await res.text(), f.url);
        if (!docs.length) { errores.push(`${f.url} -> sin documentos (¿cambió el formato del índice?)`); continue; }
        const ya = await rest(`sii_novedades?tipo=eq.${f.tipo}&fecha=gte.${anio}-01-01&fecha=lte.${anio}-12-31&select=id,numero,url`);
        const porNum = new Map(ya.map((x: { numero: string }) => [String(Number(x.numero)), x]));
        // Filas guardadas antes con el enlace al índice: reciben el de su PDF.
        for (const d of docs) { const x = porNum.get(d.numero) as { id: string; url: string } | undefined; if (x && !/\.pdf$/i.test(x.url || "")) { await rest(`sii_novedades?id=eq.${x.id}`, { method: "PATCH", body: JSON.stringify({ url: d.url }) }); enlaces++; } }
        // El índice a veces repite un número (Resolución N° 143/2026 aparece dos veces, mismo PDF): cuenta la primera aparición.
        const vistos = new Set<string>();
        const faltan = docs.filter((d) => !porNum.has(d.numero) && d.fecha && !vistos.has(d.numero) && vistos.add(d.numero));
        for (let i = 0; i < faltan.length; i += 40) {
          const lote = faltan.slice(i, i + 40), cls = await clasificar(lote, f.tipo, areas);
          const filas = lote.map((d, k) => { const c = cls.find((x: { i: number }) => Number(x.i) === k) || {};
            return { tipo: f.tipo, numero: d.numero, fecha: d.fecha, titulo: d.titulo.slice(0, 400), url: d.url, resumen: c.resumen ? String(c.resumen).slice(0, 600) : null,
              areas: Array.isArray(c.areas) ? c.areas.filter((a: string) => areas.includes(a)) : [], prioridad: "media", vigente: true }; });
          await rest("sii_novedades", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(filas) });
          inserted += filas.length; nuevos.push(...filas.map((x) => `${x.tipo === "circular" ? "Circular" : "Resolución"} N° ${x.numero}/${anio}`));
        }
      } catch (e) { errores.push(`${f.url} -> ${(e as Error).message}`); }
    }
    if (inserted) await rest("activity_log", { method: "POST", body: JSON.stringify({ user_email: quien, action: "sii.radar_novedades", table_name: "sii_novedades", estudio_id: "lea", detail: { title: `Radar del SII: ${inserted} documento${inserted !== 1 ? "s" : ""} nuevo${inserted !== 1 ? "s" : ""}`, documentos: nuevos.slice(0, 60) } }) }).catch(() => null);
    return json({ ok: true, anios, areas, inserted, enlaces, errores });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
