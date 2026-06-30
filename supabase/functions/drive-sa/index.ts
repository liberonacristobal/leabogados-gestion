// drive-sa — acceso PERMANENTE a Drive vía CUENTA DE SERVICIO (no depende del login de nadie).
//
// La app usa esto para revisar los documentos de los clientes en sus carpetas de Drive.
// La cuenta de servicio (secreto GOOGLE_SA_KEY) ve SOLO las carpetas que se le compartan
// en Drive, y con scope de SOLO LECTURA. Nunca expira para el usuario: el servidor firma
// un JWT con la llave de la SA y obtiene un token fresco cuando hace falta.
//
// Seguridad: verify_jwt=true (config.toml) + gate por email @leabogados.cl (igual que claude-proxy).
//
// Contrato: POST { action:'search'|'download', q?, fileId?, mimeType?, pageSize? }
//   search   -> { files:[{id,name,mimeType,modifiedTime}] }
//   download -> { base64, mime }   (un Google Doc se exporta a .docx; el resto va tal cual)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const SA_RAW = Deno.env.get("GOOGLE_SA_KEY") || "";
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

const b64url = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlStr = (s: string) =>
  btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Token de la cuenta de servicio, cacheado en memoria (~1h).
let _tok = ""; let _exp = 0;
async function getToken(): Promise<string> {
  if (_tok && _exp > Date.now() + 60000) return _tok;
  const sa = JSON.parse(SA_RAW);
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64urlStr(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600, iat: now,
  }));
  const unsigned = `${header}.${claims}`;
  const pem = String(sa.private_key || "").replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8", der.buffer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, new TextEncoder().encode(unsigned)));
  const jwt = `${unsigned}.${b64url(sig)}`;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${jwt}`,
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error_description || d.error || "No se pudo autenticar la cuenta de servicio");
  _tok = d.access_token; _exp = Date.now() + (d.expires_in || 3600) * 1000;
  return _tok;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  if (!SA_RAW) return json({ error: "Falta configurar GOOGLE_SA_KEY en el servidor" }, 500);

  const email = emailDelJwt(req);
  if (!email || !TEAM.includes(email)) {
    console.log(`[drive-sa] acceso denegado (email: ${email || "sin email"})`);
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
