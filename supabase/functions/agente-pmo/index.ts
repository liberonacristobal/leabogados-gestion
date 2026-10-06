import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// AGENTE PMO (back-office). Barrido autonomo cross-cartera.
// (A) GASTO de TRAMITE (CBR/Conservador/Diario Oficial/Reg.Civil/Notaria) CONFIRMA un PASO planificado no hecho del proyecto del cliente.
// (B) OLA 3 #4 — modo seguro: DOCUMENTOS de Drive de toda la cartera (no solo al abrir) que confirman un paso. Deja pmo_sugerencias
//     'pendiente' con el hito_id → COMPUERTA en la app (NUNCA marca el paso solo). Apagado por defecto: corre solo si config pmo_cross_cartera='on'.
// HACIA ADELANTE: ventana 180d (gasto: date||created_at; doc: modifiedTime). Idempotente. NO envia correo.
const CRON_SECRET = Deno.env.get("AGENTE_PMO_SECRET") || Deno.env.get("CRON_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const G_CLIENT_ID = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") || "";
const G_CLIENT_SECRET = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") || "";
const TRAMITE = new Set(["CBR", "Conservador", "Diario Oficial", "Registro Civil", "Notaria"]);
const VENTANA_DIAS = 180;
const MAX_PROY_DRIVE = 120; // tope de proyectos a escanear en Drive por corrida (acota llamadas)
const STOP = new Set(["de","en","el","la","los","las","del","por","con","una","uno","ante","para","segun","sobre","entre","desde","hasta","este","esta","su","sus","al","y","e","o"]);
const nrm = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const sigTok = (s: string) => nrm(s).replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w));
function hitoDe(cat: string, concept: string): string | null {
  const c = nrm(concept);
  if (/copia|certificad|vigencia|fotocopia/.test(c)) return null;
  if (cat === "Notaria") {
    if (/constituc/.test(c)) return "Escritura de constitucion";
    if (/compraventa|compra venta/.test(c)) return "Escritura de compraventa";
    if (/modificaci/.test(c)) return "Escritura de modificacion";
    return null;
  }
  if (/publicac/.test(c)) return "Publicacion en Diario Oficial";
  if (/posesion efectiva/.test(c)) return "Posesion efectiva inscrita";
  if (/inscrip/.test(c)) return cat === "Diario Oficial" ? "Publicacion en Diario Oficial" : "Inscripcion en CBR";
  return null;
}
// Mismo criterio que el front (_docConfirma): >=2 tokens en comun y uno fuerte (>=6), o un hito de una sola palabra fuerte (>=5).
function docConfirma(fileName: string, hitoTitulo: string): boolean {
  const ht = sigTok(hitoTitulo); if (!ht.length) return false;
  const base = String(fileName).replace(/\.[a-z0-9]{2,5}$/i, "");
  const fn = new Set(sigTok(base));
  const overlap = ht.filter((w) => fn.has(w)); if (!overlap.length) return false;
  if (ht.length === 1) return overlap[0].length >= 5;
  return overlap.length >= 2 && overlap.some((w) => w.length >= 6);
}
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" };

// --- Drive (service account / refresh_token permanente en drive_auth, igual que la fn `drive`/`clientes-drive-sync`) ---
async function getRefreshToken(): Promise<string | null> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/drive_auth?id=eq.1&select=refresh_token`, {
    headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY },
  });
  if (!r.ok) return null;
  const d = await r.json();
  return (Array.isArray(d) && d[0]?.refresh_token) || null;
}
let _tok = ""; let _exp = 0;
async function getToken(): Promise<string> {
  if (_tok && _exp > Date.now() + 60000) return _tok;
  const rt = await getRefreshToken();
  if (!rt) throw new Error("sin_drive");
  const body = new URLSearchParams({ client_id: G_CLIENT_ID, client_secret: G_CLIENT_SECRET, refresh_token: rt, grant_type: "refresh_token" });
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error_description || d.error || "token_drive");
  _tok = d.access_token; _exp = Date.now() + (d.expires_in || 3600) * 1000;
  return _tok;
}
// deno-lint-ignore no-explicit-any
async function listChildren(token: string, parentId: string): Promise<any[]> {
  const url = `https://www.googleapis.com/drive/v3/files?q='${parentId}'+in+parents+and+trashed=false` +
    `&fields=files(id,name,mimeType,modifiedTime)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  const d = await r.json();
  if (!r.ok) return [];
  return d.files || [];
}
const isFolder = (f: any) => f.mimeType === "application/vnd.google-apps.folder";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const esCron = !!CRON_SECRET && body.secret === CRON_SECRET;
    let dry = !esCron || !!body.dryRun;
    if (!esCron) {
      const auth = req.headers.get("authorization") || "";
      const { data: { user } } = await sb.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
      if (!String(user?.email || "").toLowerCase().endsWith("@leabogados.cl"))
        return new Response(JSON.stringify({ error: "No autorizado" }), { status: 403, headers: { "Content-Type": "application/json", ...CORS } });
      dry = true;
    }
    const desde = new Date(Date.now() - VENTANA_DIAS * 86400000).toISOString().slice(0, 10);

    const [{ data: proys }, { data: exps }, { data: hitos }, { data: sugs }, { data: cli }, { data: cfg }, { data: ants }, { data: bills }] = await Promise.all([
      sb.from("proyectos_cartera").select("id,cliente_id,tipo,activo"),
      sb.from("expenses").select("id,client_id,category,concept,date,created_at,proyecto_id,deleted_at,type"),
      sb.from("proyecto_hitos").select("id,proyecto_id,titulo,hecho"),
      sb.from("pmo_sugerencias").select("origen,origen_id"),
      sb.from("clients").select("id,drive_folder_id"),
      sb.from("learnings").select("value").eq("kind", "config").eq("key", "pmo_cross_cartera").limit(1),
      sb.from("anticipos").select("id,client_id,fecha,nota,deleted_at"),
      sb.from("billing").select("id,client_id,sale_id,paid_at,status,invoice_no,deleted_at"),
    ]);
    const activos = (proys || []).filter((p: any) => p.activo !== false && (!p.tipo || p.tipo === "proyecto"));
    const porCli: Record<string, any[]> = {};
    for (const p of activos) { const k = String(p.cliente_id || ""); if (!k) continue; (porCli[k] = porCli[k] || []).push(p); }
    const pendByProy: Record<string, any[]> = {};
    for (const h of hitos || []) { if (h.hecho) continue; const k = String(h.proyecto_id); (pendByProy[k] = pendByProy[k] || []).push({ id: h.id, titulo: h.titulo, toks: new Set(sigTok(h.titulo)) }); }
    const yaSugGasto = new Set((sugs || []).filter((s: any) => s.origen === "gasto").map((s: any) => String(s.origen_id)));
    const yaSugDoc = new Set((sugs || []).filter((s: any) => s.origen === "documento").map((s: any) => String(s.origen_id)));

    // (A) GASTO (igual que v5)
    const nuevas: any[] = [];
    const usadosHito = new Set<string>();
    for (const e of exps || []) {
      if (e.type !== "gasto" || e.deleted_at || e.proyecto_id || !TRAMITE.has(e.category)) continue;
      const fe = String(e.date || e.created_at || "").slice(0, 10);
      if (!fe || fe < desde) continue;
      if (yaSugGasto.has(String(e.id))) continue;
      const titulo = hitoDe(e.category, e.concept); if (!titulo) continue;
      const cand = porCli[String(e.client_id || "")]; if (!cand || cand.length !== 1) continue;
      const proy = cand[0];
      const pend = pendByProy[String(proy.id)] || [];
      const tks = sigTok(titulo); if (!tks.length) continue;
      const h = pend.find((x: any) => !usadosHito.has(String(x.id)) && tks.every((w) => x.toks.has(w)));
      if (!h) continue;
      usadosHito.add(String(h.id)); yaSugGasto.add(String(e.id));
      nuevas.push({ proyecto_id: proy.id, origen: "gasto", origen_id: String(e.id), tipo: "hito", payload: { hito_id: h.id, hito: h.titulo, concepto: e.concept, fecha: fe }, estado: "pendiente" });
    }

    // (A2) COBRO — anticipo recibido confirma paso de provision/fondos; factura pagada confirma paso de pago/honorario. Idempotente, hacia adelante. (integracion #2)
    const yaSugFondo = new Set((sugs || []).filter((s: any) => s.origen === "fondo").map((s: any) => String(s.origen_id)));
    const reFondo = /provisi[oó]n|fondos|anticipo/;
    const rePago = /pago|honorario|cobro/;
    for (const a of ants || []) {
      if (a.deleted_at) continue;
      const fe = String(a.fecha || "").slice(0, 10); if (!fe || fe < desde) continue;
      const oid = "ant:" + a.id; if (yaSugFondo.has(oid)) continue;
      const cand = porCli[String(a.client_id || "")]; if (!cand || cand.length !== 1) continue;
      const pend = pendByProy[String(cand[0].id)] || [];
      const h = pend.find((x: any) => !usadosHito.has(String(x.id)) && reFondo.test(nrm(x.titulo)));
      if (!h) continue;
      usadosHito.add(String(h.id)); yaSugFondo.add(oid);
      nuevas.push({ proyecto_id: cand[0].id, origen: "fondo", origen_id: oid, tipo: "hito", payload: { hito_id: h.id, hito: h.titulo, detalle: "Anticipo recibido" + (a.nota ? " · " + a.nota : ""), fecha: fe }, estado: "pendiente" });
    }
    for (const b of bills || []) {
      if (b.deleted_at || !b.paid_at || b.status !== "Pagado") continue;
      const fe = String(b.paid_at).slice(0, 10); if (!fe || fe < desde) continue;
      const oid = "fac:" + b.id; if (yaSugFondo.has(oid)) continue;
      const cand = porCli[String(b.client_id || "")]; if (!cand || cand.length !== 1) continue;
      const pend = pendByProy[String(cand[0].id)] || [];
      const h = pend.find((x: any) => !usadosHito.has(String(x.id)) && rePago.test(nrm(x.titulo)));
      if (!h) continue;
      usadosHito.add(String(h.id)); yaSugFondo.add(oid);
      nuevas.push({ proyecto_id: cand[0].id, origen: "fondo", origen_id: oid, tipo: "hito", payload: { hito_id: h.id, hito: h.titulo, detalle: "Pago recibido" + (b.invoice_no ? " · factura N° " + b.invoice_no : ""), fecha: fe }, estado: "pendiente" });
    }

    // (B) OLA 3 #4 — DOCUMENTOS de Drive cross-cartera (modo seguro: solo si pmo_cross_cartera='on'; nunca marca, solo deja pendiente)
    // body.preview fuerza el escaneo en una simulacion (dry) para "Probar" desde la app ANTES de encenderlo de verdad.
    const crossOn = String((cfg && cfg[0] && cfg[0].value) || "").toLowerCase() === "on" || (dry && !!body.preview);
    let docNuevas = 0; let driveMsg = "off";
    if (crossOn) {
      const folderByCli: Record<string, string> = {};
      for (const c of cli || []) { if (c.drive_folder_id) folderByCli[String(c.id)] = String(c.drive_folder_id); }
      // proyectos elegibles: con plan pendiente + carpeta Drive del cliente
      const elegibles = activos.filter((p: any) => (pendByProy[String(p.id)] || []).length && folderByCli[String(p.cliente_id || "")]).slice(0, MAX_PROY_DRIVE);
      try {
        const token = await getToken();
        for (const proy of elegibles) {
          const pend = pendByProy[String(proy.id)] || [];
          const root = folderByCli[String(proy.cliente_id)];
          const top = await listChildren(token, root);
          let files = top.filter((f: any) => !isFolder(f));
          for (const sub of top.filter(isFolder).slice(0, 12)) { const kids = await listChildren(token, sub.id); files = files.concat(kids.filter((f: any) => !isFolder(f))); }
          const usados = new Set<string>();
          for (const f of files) {
            if (yaSugDoc.has(String(f.id))) continue;
            const fe = String(f.modifiedTime || "").slice(0, 10); if (fe && fe < desde) continue;
            const h = pend.find((x: any) => !usados.has(String(x.id)) && docConfirma(f.name, x.titulo));
            if (!h) continue;
            usados.add(String(h.id)); yaSugDoc.add(String(f.id));
            nuevas.push({ proyecto_id: proy.id, origen: "documento", origen_id: String(f.id), tipo: "hito", payload: { hito_id: h.id, hito: h.titulo, archivo: f.name, fecha: fe || null }, estado: "pendiente" });
            docNuevas++;
          }
        }
        driveMsg = `escaneados ${elegibles.length} proyectos`;
      } catch (e) { driveMsg = (e as any).message === "sin_drive" ? "sin conexion Drive" : ("error Drive: " + (e as any).message); }
    }

    if (!dry && nuevas.length) { for (let i = 0; i < nuevas.length; i += 200) await sb.from("pmo_sugerencias").insert(nuevas.slice(i, i + 200)); }
    const gastoN = nuevas.filter((n: any) => n.origen === "gasto").length, fondoN = nuevas.filter((n: any) => n.origen === "fondo").length;
    return new Response(JSON.stringify({ ok: true, modo: dry ? "simulacion" : "barrido", nuevas: nuevas.length, gasto: gastoN, fondo: fondoN, documento: docNuevas, cross_cartera: crossOn ? driveMsg : "off", muestra: nuevas.slice(0, 10) }), { headers: { "Content-Type": "application/json", ...CORS } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as any).message }), { status: 500, headers: { "Content-Type": "application/json", ...CORS } });
  }
});
