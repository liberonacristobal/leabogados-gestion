// titulos-cortos — motor que mantiene CORTOS los títulos de las ventas/proyectos (sales.title).
//
// Qué hace: busca ventas cuyo título sea largo (> UMBRAL caracteres) y que NO hayan sido
// procesadas antes (no tienen learning titulo_original), le pide a la IA en UN solo llamado un
// nombre CORTO y general (2-5 palabras) para cada una, guarda el título original (reversible) y
// actualiza sales.title. Procesa cada título largo UNA vez → no pelea con ediciones manuales.
//
// Seguridad: reversible (el original queda en learnings.titulo_original, key=sale_id). Solo
// acorta párrafos largos (umbral 70); los nombres de proyecto cortos no se tocan. IA = insumo;
// el cambio es de texto descriptivo (no cifras) y deshacible.
//
// Deploy:  supabase functions deploy titulos-cortos
// Cron:    diario, POST { "secret": CRON_SECRET }. Manual (usuario @leabogados.cl) = dryRun salvo { "apply": true }.
// Secretos: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY ya presentes; CRON_SECRET (o TITULOS_SECRET).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("TITULOS_SECRET") || Deno.env.get("CRON_SECRET") || "";

const UMBRAL = 70;    // solo se acortan títulos con más de 70 caracteres (párrafos); los nombres cortos no se tocan
const MAX = 25;       // tope por corrida (acota costo IA)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
async function acortarIA(items: { id: string; title: string }[]): Promise<Record<string, string>> {
  const lista = items.map((it, i) => `${i + 1}. [${it.id}] ${it.title}`).join("\n");
  const prompt =
    `Eres asistente de un estudio de abogados chileno. Para cada ENCARGO de la lista, devuelve un nombre CORTO y general ` +
    `del asunto, de 2 a 5 palabras, como lo llamaría el estudio internamente (ej. "Reorganización societaria", "Juicio laboral", ` +
    `"Recuperación de IVA exportador", "Planificación patrimonial"). NO una descripción larga ni una frase; conserva el español de Chile ` +
    `y el sentido del encargo. Devuelve SOLO un JSON array, sin markdown: [{"id":"<id>","titulo":"<nombre corto>"}].\n\nENCARGOS:\n${lista}`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-opus-4-8", max_tokens: 1500, messages: [{ role: "user", content: prompt }] }),
  });
  const j = await r.json();
  const txt = (j?.content?.[0]?.text || "").replace(/```json|```/g, "").trim();
  const out: Record<string, string> = {};
  try {
    const arr = JSON.parse(txt);
    if (Array.isArray(arr)) for (const x of arr) { const t = String(x?.titulo || "").trim(); if (x?.id && t && t.length <= 60) out[String(x.id)] = t; }
  } catch { /* si la IA no devolvió JSON válido, no se cambia nada */ }
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!ANTHROPIC_API_KEY || !SUPABASE_URL || !SERVICE_KEY)
    return json({ error: "Faltan secretos (ANTHROPIC_API_KEY / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" }, 500);

  const body = await req.json().catch(() => ({}));
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const esCron = !!CRON_SECRET && body.secret === CRON_SECRET;
  let dry = !esCron && !body.apply;   // cron aplica; usuario = simulación salvo { apply:true }
  if (!esCron) {
    const auth = req.headers.get("authorization") || "";
    const { data: { user } } = await sb.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
    if (!String(user?.email || "").toLowerCase().endsWith("@leabogados.cl"))
      return json({ error: "No autorizado" }, 403);
  }
  if (body.dryRun) dry = true;

  // Ventas con título largo que aún NO fueron procesadas (sin learning titulo_original).
  const { data: yaProc } = await sb.from("learnings").select("key").eq("kind", "titulo_original");
  const procesadas = new Set((yaProc || []).map((r: Record<string, string>) => String(r.key)));
  const { data: sales } = await sb.from("sales").select("id,title").is("deleted_at", null);
  const largas = (sales || [])
    .filter((s: Record<string, string>) => s.title && s.title.length > UMBRAL && !procesadas.has(String(s.id)))
    .slice(0, MAX);

  if (!largas.length) return json({ ok: true, modo: dry ? "simulacion" : "aplicado", revisadas: (sales || []).length, por_acortar: 0, cambios: [] });

  const cortos = await acortarIA(largas.map((s: Record<string, string>) => ({ id: String(s.id), title: String(s.title) })));

  const cambios: { id: string; antes: string; despues: string }[] = [];
  for (const s of largas) {
    const nuevo = cortos[String(s.id)];
    if (!nuevo || nuevo === s.title) continue;
    cambios.push({ id: String(s.id), antes: String(s.title), despues: nuevo });
    if (dry) continue;
    // Guarda el original (reversible) solo si no existe, y actualiza el título.
    try {
      const { data: ex } = await sb.from("learnings").select("id").eq("kind", "titulo_original").eq("key", String(s.id)).limit(1);
      if (!(ex && ex.length)) await sb.from("learnings").insert({ kind: "titulo_original", key: String(s.id), value: String(s.title) });
      await sb.from("sales").update({ title: nuevo, updated_at: new Date().toISOString() }).eq("id", s.id);
    } catch (e) { /* no frena el lote */ console.error("titulos-cortos", String((e as Error).message)); }
  }

  return json({ ok: true, modo: dry ? "simulacion" : "aplicado", revisadas: (sales || []).length, por_acortar: largas.length, cambios });
});
