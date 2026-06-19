// claude-proxy — único puente entre la app y la API de Claude.
//
// Motivo: la API key de Anthropic NO debe vivir en el bundle del front (es público
// en Vercel). Acá vive como secreto de Supabase (ANTHROPIC_API_KEY) y nunca sale.
//
// Seguridad: verify_jwt=true en config.toml (la plataforma valida la firma del JWT)
// + este handler exige que el email del JWT sea del equipo (@leabogados.cl en la
// lista). El anon key no trae email, por lo que queda rechazado.
//
// Contrato: POST { model?, max_tokens?, system?, messages:[{role,content}] }
//  -> responde el JSON de Anthropic tal cual (el front lee data.content[0].text).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";

// Equipo autorizado (mismos emails que loadUserRole/WHO_MAP en la app).
const TEAM = [
  "cl@leabogados.cl",
  "ee@leabogados.cl",
  "mc@leabogados.cl",
  "mp@leabogados.cl",
  "rd@leabogados.cl",
  "rodrigo@leabogados.cl",
];

// Solo modelos que la app usa hoy; cualquier otro cae al default seguro.
const ALLOWED_MODELS = ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function emailDelJwt(req: Request): string | null {
  try {
    const tok = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const payload = JSON.parse(atob(tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload?.email || null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  if (!ANTHROPIC_API_KEY) return json({ error: "Falta configurar ANTHROPIC_API_KEY en el servidor" }, 500);

  const email = emailDelJwt(req);
  if (!email || !TEAM.includes(email)) {
    console.log(`[claude-proxy] acceso denegado (email: ${email || "sin email"})`);
    return json({ error: "No autorizado" }, 403);
  }

  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }

  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages || !messages.length) return json({ error: "Faltan messages" }, 400);

  const model = ALLOWED_MODELS.includes(body.model) ? body.model : "claude-opus-4-8";
  const max_tokens = Math.min(Math.max(Number(body.max_tokens) || 1024, 1), 8000);

  // deno-lint-ignore no-explicit-any
  const payload: any = { model, max_tokens, messages };
  if (typeof body.system === "string" && body.system) payload.system = body.system;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    if (!r.ok) {
      console.log(`[claude-proxy] Anthropic ${r.status} para ${email}`);
      return json({ error: data?.error?.message || `Anthropic ${r.status}` }, r.status);
    }
    return json(data);
  } catch (err) {
    return json({ error: (err as Error).message }, 502);
  }
});
