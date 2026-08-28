// clientes-drive-sync — mantiene el padrón de clientes en sincronía con las carpetas de Drive.
//
// Qué hace (por cron cada 1–2h, o manual desde la app):
//   • AGREGA (automático): cada carpeta nueva bajo CLIENTES_ROOT que no corresponde a ningún
//     cliente → crea el cliente (status 'Activo') y guarda el vínculo carpeta↔cliente en client_drive.
//   • SACAR (con compuerta): cuando una carpeta YA VINCULADA a un cliente 'Activo' deja de estar
//     bajo CLIENTES_ROOT (se movió a Terminados o fuera) → NO lo termina solo; encola una "baja
//     pendiente" en clientes_drive_sync para que un humano la confirme con un toque en la app.
//
// La detección de movimientos es por folder_id (identidad), no por nombre → a prueba de renombres.
//
// Auth: verify_jwt=false. (a) cron con secreto (body.secret === CLIENTES_DRIVE_SECRET) → corrida
// completa, pero SOLO si el interruptor learnings config/clientes_drive_sync = 'on'. (b) usuario
// @leabogados.cl con JWT → corre siempre (para la corrida manual/supervisada y prueba).
//
// Token de Drive: refresh_token permanente en la tabla drive_auth (mismo mecanismo que la fn `drive`).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CLIENT_ID = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") || "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") || "";
const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("CLIENTES_DRIVE_SECRET") || Deno.env.get("CRON_SECRET") || "";
// Carpetas raíz en Drive (tenant LEA). Parametrizables por env para otro estudio (regla vendible-por-diseño).
const CLIENTES_ROOT = Deno.env.get("DRIVE_CLIENTES_ROOT") || "19JsFeh9icekmXMKyubkbLxfXVujmc3eh";
const CLIENTES_TERMINADOS_ROOT = Deno.env.get("DRIVE_CLIENTES_TERMINADOS_ROOT") || "1_wi0td0ib9QlBLjUvDkr6QzdLn1sPwGX";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

async function getRefreshToken(): Promise<string | null> {
  const r = await fetch(`${SB_URL}/rest/v1/drive_auth?id=eq.1&select=refresh_token`, {
    headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY },
  });
  if (!r.ok) return null;
  const d = await r.json();
  return (Array.isArray(d) && d[0]?.refresh_token) || null;
}

let _tok = ""; let _exp = 0;
async function getToken(): Promise<string> {
  if (_tok && _exp > Date.now() + 60000) return _tok;
  const rt = await getRefreshToken();
  if (!rt) throw new Error("No hay conexión de Drive guardada (menú → Conectar Drive permanente).");
  const body = new URLSearchParams({
    client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: rt, grant_type: "refresh_token",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error_description || d.error || "No se pudo renovar el token de Drive");
  _tok = d.access_token; _exp = Date.now() + (d.expires_in || 3600) * 1000;
  return _tok;
}

const norm = (s: string) => String(s || "").toLowerCase().trim();
// Carpetas que NO son un cliente (plantillas/secciones del Drive). Mantener alineado con el importador de la app.
const esTemplate = (name: string) => !name || name.startsWith("1. CLIENTES");

// deno-lint-ignore no-explicit-any
async function listFolders(token: string, parentId: string): Promise<any[]> {
  const out: any[] = []; let pageToken = "";
  do {
    const url = `https://www.googleapis.com/drive/v3/files?q='${parentId}'+in+parents+and+mimeType='application/vnd.google-apps.folder'+and+trashed=false` +
      `&fields=nextPageToken,files(id,name)&pageSize=1000&orderBy=name` + (pageToken ? `&pageToken=${pageToken}` : "");
    const r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message || "Error listando carpetas en Drive");
    (d.files || []).forEach((f: any) => out.push(f));
    pageToken = d.nextPageToken || "";
  } while (pageToken);
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  if (!CLIENT_ID || !CLIENT_SECRET) return json({ error: "Falta GOOGLE_OAUTH_CLIENT_ID/SECRET en el servidor" }, 500);

  const sb = createClient(SB_URL, SB_KEY);
  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = await req.json(); } catch { /* cron puede venir sin body */ }

  // ── Autorización
  const esCron = !!CRON_SECRET && body.secret === CRON_SECRET;
  if (!esCron) {
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await sb.auth.getUser(jwt);
    const email = (u?.user?.email || "").toLowerCase();
    if (!email.endsWith("@leabogados.cl")) return json({ error: "No autorizado" }, 403);
  }
  // Interruptor: solo aplica a la corrida por cron. La corrida manual (usuario) siempre corre.
  if (esCron) {
    const { data: cfg } = await sb.from("learnings").select("value").eq("kind", "config").eq("key", "clientes_drive_sync").maybeSingle();
    if ((cfg?.value || "off").trim() !== "on") return json({ ok: true, skipped: "apagado" });
  }

  try {
    const token = await getToken();

    // Carpetas activas (hijas directas de CLIENTES_ROOT) y terminadas (nietas: raíz → año → cliente)
    const activos = (await listFolders(token, CLIENTES_ROOT)).filter((f) => !esTemplate(f.name));
    const years = await listFolders(token, CLIENTES_TERMINADOS_ROOT);
    const terminados: any[] = [];
    for (const y of years) { (await listFolders(token, y.id)).forEach((c) => terminados.push(c)); }
    const activoIds = new Set(activos.map((f) => f.id));
    const terminadoIds = new Set(terminados.map((f) => f.id));

    const { data: clients } = await sb.from("clients").select("id,name,status");
    const { data: links } = await sb.from("client_drive").select("client_id,folder_id,folder_name");
    const linkByFolder = new Map<string, any>();
    const linkByClient = new Map<string, any>();
    (links || []).forEach((l) => { linkByFolder.set(l.folder_id, l); linkByClient.set(String(l.client_id), l); });
    const clientByName = new Map<string, any>();
    (clients || []).forEach((c) => { if (!clientByName.has(norm(c.name))) clientByName.set(norm(c.name), c); });

    // ── 1) AGREGAR (auto) + backfill de vínculos
    const added: string[] = [];
    for (const f of activos) {
      if (linkByFolder.has(f.id)) continue;                 // carpeta ya vinculada → nada
      const existing = clientByName.get(norm(f.name));
      if (existing) {                                        // existe por nombre pero sin vínculo → backfill
        await sb.from("client_drive").upsert(
          { client_id: String(existing.id), folder_id: f.id, folder_name: f.name, updated_at: new Date().toISOString() },
          { onConflict: "client_id" });
        linkByFolder.set(f.id, { client_id: existing.id, folder_id: f.id });
        linkByClient.set(String(existing.id), { client_id: existing.id, folder_id: f.id, folder_name: f.name });
        continue;
      }
      const { data: nc, error } = await sb.from("clients").insert({ name: f.name, status: "Activo" }).select("id,name").single();
      if (!error && nc) {
        await sb.from("client_drive").upsert(
          { client_id: String(nc.id), folder_id: f.id, folder_name: f.name, updated_at: new Date().toISOString() },
          { onConflict: "client_id" });
        added.push(f.name);
      }
    }

    // ── 2) SACAR (compuerta): cliente Activo con carpeta vinculada que ya no está en activos → baja pendiente
    let pendingNew = 0;
    for (const c of (clients || [])) {
      if (c.status !== "Activo") continue;
      const link = linkByClient.get(String(c.id));
      if (!link || !link.folder_id) continue;               // sin vínculo confiable → no arriesgar (evita falsos positivos)
      if (activoIds.has(link.folder_id)) continue;          // sigue bajo activos → ok
      const motivo = terminadoIds.has(link.folder_id) ? "movido_terminados" : "movido_fuera";
      const { data: ex } = await sb.from("clientes_drive_sync")
        .select("id").eq("client_id", c.id).eq("folder_id", link.folder_id).limit(1);
      if (ex && ex.length) continue;                        // ya registrada (pendiente/aplicada/descartada) → no repetir
      await sb.from("clientes_drive_sync").insert({
        client_id: c.id, folder_id: link.folder_id, folder_name: link.folder_name || c.name, motivo, status: "pendiente",
      });
      pendingNew++;
    }

    const summary = { at: new Date().toISOString(), added, addedN: added.length, pendingNew, activos: activos.length };
    await sb.from("learnings").upsert(
      { kind: "config", key: "clientes_drive_sync_last", value: JSON.stringify(summary) },
      { onConflict: "kind,key" });
    return json({ ok: true, ...summary });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
