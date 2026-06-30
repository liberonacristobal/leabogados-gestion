// drive — acceso PERMANENTE a Drive vía REFRESH TOKEN (sin llave de cuenta de servicio).
//
// Lee el refresh_token guardado en la tabla `drive_auth` (lo dejó la app al "Conectar Drive
// permanente") y lo cambia por un access_token fresco usando el OAuth client de la app
// (GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET). El token se cachea en memoria ~1h.
// No depende de que nadie esté logueado: se renueva solo.
//
// Seguridad: verify_jwt=true (config.toml) + gate por email @leabogados.cl (igual que claude-proxy).
//
// Contrato: POST { action:'search'|'download', q?, fileId?, mimeType?, pageSize? }
//   search   -> { files:[{id,name,mimeType,modifiedTime}] }
//   download -> { base64, mime }   (un Google Doc se exporta a .docx; el resto va tal cual)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CLIENT_ID = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") || "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") || "";
const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const TEAM = [
  "cl@leabogados.cl", "ee@leabogados.cl", "mc@leabogados.cl",
  "mp@leabogados.cl", "rd@leabogados.cl", "rodrigo@leabogados.cl",
];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

function emailDelJwt(req: Request): string | null {
  try {
    const t = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const p = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return p?.email || null;
  } catch { return null; }
}

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
  if (!rt) throw new Error("No hay conexión de Drive guardada. Conéctalo desde la app (menú → Conectar Drive permanente).");
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  if (!CLIENT_ID || !CLIENT_SECRET) return json({ error: "Falta configurar GOOGLE_OAUTH_CLIENT_ID/SECRET en el servidor" }, 500);

  const email = emailDelJwt(req);
  if (!email || !TEAM.includes(email)) {
    console.log(`[drive] acceso denegado (email: ${email || "sin email"})`);
    return json({ error: "No autorizado" }, 403);
  }

  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }

  try {
    const token = await getToken();
    const H = { Authorization: "Bearer " + token };

    if (body.action === "search") {
      const q = String(body.q || "");
      if (!q) return json({ error: "Falta q" }, 400);
      const pageSize = Math.min(Number(body.pageSize) || 50, 100);
      const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}` +
        `&fields=files(id,name,mimeType,modifiedTime)&orderBy=modifiedTime+desc&pageSize=${pageSize}` +
        `&supportsAllDrives=true&includeItemsFromAllDrives=true`;
      const r = await fetch(url, { headers: H });
      const d = await r.json();
      if (!r.ok) return json({ error: d?.error?.message || `Drive ${r.status}` }, r.status);
      return json({ files: d.files || [] });
    }

    if (body.action === "download") {
      const fileId = String(body.fileId || "");
      if (!fileId) return json({ error: "Falta fileId" }, 400);
      const isGDoc = String(body.mimeType || "") === "application/vnd.google-apps.document";
      const url = isGDoc
        ? `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/vnd.openxmlformats-officedocument.wordprocessingml.document`
        : `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;
      const r = await fetch(url, { headers: H });
      if (!r.ok) return json({ error: `Drive ${r.status}` }, r.status);
      const buf = new Uint8Array(await r.arrayBuffer());
      let bin = ""; const CH = 8192;
      for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode(...buf.subarray(i, i + CH));
      const mime = isGDoc
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : (r.headers.get("content-type") || "application/octet-stream");
      return json({ base64: btoa(bin), mime });
    }

    return json({ error: "Acción no soportada" }, 400);
  } catch (err) {
    return json({ error: (err as Error).message }, 502);
  }
});
