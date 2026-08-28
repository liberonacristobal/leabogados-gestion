// clientes-drive-sync — mantiene el padrón de clientes en sincronía con las carpetas de Drive.
//
// Qué hace (por cron cada 2h, o manual/al abrir la app):
//   • AGREGA (automático): carpeta nueva bajo CLIENTES_ROOT cuyo nombre no corresponde a ningún
//     cliente → crea el cliente (status 'Activo').
//   • SACAR (con compuerta): cliente 'Activo' cuyo nombre aparece como carpeta en la raíz de
//     TERMINADOS y ya NO en activos → encola una "baja pendiente" en clientes_drive_sync para que
//     un humano la confirme con un toque. NO cambia el status por su cuenta.
//
// Coincidencia por NOMBRE (normalizado). NO usa la tabla client_drive: esa guarda la carpeta que el
// usuario vincula para "Documentos del cliente" (puede ser otra carpeta) → usarla daba falsos positivos.
// Se descartó el caso "no está en activos" (movido_fuera) por lo mismo: solo se propone baja cuando la
// carpeta aparece EXPLÍCITAMENTE en Terminados.
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

// Normaliza para comparar nombres: minúsculas, SIN acentos, sin espacios dobles → evita duplicados
// del tipo "Martínez" vs "Martinez" o "Cabañas " con espacio final.
const norm = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
// Carpetas que NO son un cliente (plantillas/secciones del Drive). Mantener alineado con el importador de la app.
const esTemplate = (name: string) => !name || name.toLowerCase().startsWith("1. clientes");

// Escribe una fila singleton en learnings SIN depender de un índice único (la tabla admite (kind,key)
// duplicados a propósito, así que upsert onConflict:'kind,key' falla). Update si existe, insert si no.
// deno-lint-ignore no-explicit-any
async function setConfig(sb: any, key: string, value: string) {
  const { data } = await sb.from("learnings").select("id").eq("kind", "config").eq("key", key).limit(1);
  if (data && data.length) await sb.from("learnings").update({ value }).eq("id", data[0].id);
  else await sb.from("learnings").insert({ kind: "config", key, value });
}

// deno-lint-ignore no-explicit-any
async function listFolders(token: string, parentId: string): Promise<any[]> {
  const out: any[] = []; let pageToken = "";
  do {
    const url = `https://www.googleapis.com/drive/v3/files?q='${parentId}'+in+parents+and+mimeType='application/vnd.google-apps.folder'+and+trashed=false` +
      `&fields=nextPageToken,files(id,name)&pageSize=1000&orderBy=name&supportsAllDrives=true&includeItemsFromAllDrives=true` +
      (pageToken ? `&pageToken=${pageToken}` : "");
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
  // Interruptor: solo aplica a la corrida por cron. La corrida manual (usuario) y el dry-run siempre corren.
  if (esCron && !body.dryRun) {
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
    const activosByName = new Set(activos.map((f) => norm(f.name)));
    const terminadosByName = new Map<string, any>();   // norm(name) -> carpeta en Terminados (para el folder_id de referencia)
    for (const f of terminados) { if (!terminadosByName.has(norm(f.name))) terminadosByName.set(norm(f.name), f); }

    const { data: clients } = await sb.from("clients").select("id,name,status");
    const clientByName = new Map<string, any>();
    (clients || []).forEach((c) => { if (!clientByName.has(norm(c.name))) clientByName.set(norm(c.name), c); });

    // Candidatos (para dry-run y para aplicar). AGREGAR = carpeta activa sin cliente por nombre.
    const wouldAdd = activos.filter((f) => !clientByName.has(norm(f.name))).map((f) => f.name);
    // SACAR = cliente Activo cuyo nombre está en Terminados y ya no en activos.
    const wouldRemove: string[] = [];
    for (const c of (clients || [])) {
      if (c.status !== "Activo") continue;
      const nm = norm(c.name);
      if (!activosByName.has(nm) && terminadosByName.has(nm)) wouldRemove.push(c.name);
    }
    if (body.dryRun) {
      return json({ ok: true, dryRun: true, activos: activos.length, terminados: terminados.length,
        wouldAddN: wouldAdd.length, wouldAdd: wouldAdd.slice(0, 60),
        wouldRemoveN: wouldRemove.length, wouldRemove: wouldRemove.slice(0, 60) });
    }

    // ── 1) AGREGAR (auto): NO tocamos client_drive (esa tabla es de "Documentos del cliente").
    const added: string[] = [];
    for (const f of activos) {
      if (clientByName.has(norm(f.name))) continue;
      const { data: nc, error } = await sb.from("clients").insert({ name: f.name, status: "Activo" }).select("id,name").single();
      if (!error && nc) { added.push(f.name); clientByName.set(norm(f.name), nc); }
    }

    // ── 2) SACAR (compuerta, SOLO señal confiable: aparece en TERMINADOS y no en activos).
    let pendingNew = 0;
    for (const c of (clients || [])) {
      if (c.status !== "Activo") continue;
      const nm = norm(c.name);
      if (activosByName.has(nm)) continue;
      const tf = terminadosByName.get(nm);
      if (!tf) continue;
      const { data: ex } = await sb.from("clientes_drive_sync").select("id").eq("client_id", c.id).eq("folder_id", tf.id).limit(1);
      if (ex && ex.length) continue;
      await sb.from("clientes_drive_sync").insert({
        client_id: c.id, folder_id: tf.id, folder_name: c.name, motivo: "movido_terminados", status: "pendiente",
      });
      pendingNew++;
    }

    const summary = { at: new Date().toISOString(), added, addedN: added.length, pendingNew, activos: activos.length };
    await setConfig(sb, "clientes_drive_sync_last", JSON.stringify(summary));
    return json({ ok: true, ...summary });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
