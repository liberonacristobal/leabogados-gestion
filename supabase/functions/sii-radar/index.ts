// sii-radar — auto-ingesta del SII (Radar Tributario, Stage 7 Fase B · auto).
//
// Qué hace: descarga los ÍNDICES oficiales del SII, le pide a la IA que extraiga los
// documentos REALES que aparecen (número/fecha/título/url) y los clasifique por ÁREA del
// estudio, y los guarda en `sii_novedades` (la misma tabla que usa el alta manual del Radar).
//
// NO NEGOCIABLE (materia legal): solo documentos REALES leídos de la fuente oficial;
// SIEMPRE con su cita (número/fecha/URL); la IA es INSUMO, el abogado valida en la app
// (compuerta humana en el Radar). Nunca inventar circulares/oficios/fallos.
//
// Por qué edge function: la API key vive como secreto de Supabase, nunca en el front.
//
// ⚠️ ITERACIÓN NECESARIA (por eso va "en paralelo" al alta manual, para comparar fiabilidad):
//   - Las URLs de FUENTES y AREAS deben confirmarse/ajustarse a la estructura real de sii.cl
//     y a tus etiquetas reales de `sales.area`.
//   - Si una página del SII es JS-rendered, el fetch puede venir casi vacío → habrá que
//     apuntar al índice estático correcto o usar un render externo. Revisar `errores` y
//     `inserted` en la respuesta.
//
// Deploy:
//   supabase functions deploy sii-radar
//   (secretos ya presentes: ANTHROPIC_API_KEY; SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los
//    inyecta Supabase). Invocar manual (POST) o por cron semanal.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Áreas del estudio — DEBEN coincidir con los valores reales de `sales.area` (para que el
// cruce con clientes funcione en el Radar). Ajustar a tus etiquetas.
const AREAS = ["Tributario", "IVA", "Reorganizaciones", "Donaciones", "Sucesorio", "Retail", "Family office"];

// Fuentes oficiales (índices). CONFIRMAR las URLs reales por año en https://www.sii.cl/normativa_legislacion/
const FUENTES = [
  { tipo: "circular",       url: "https://www.sii.cl/normativa_legislacion/circulares/2026/indcir2026.htm" },
  { tipo: "resolucion",     url: "https://www.sii.cl/normativa_legislacion/resoluciones/2026/indresol2026.htm" },
  { tipo: "jurisprudencia", url: "https://www.sii.cl/pagina/jurisprudencia/adminis/2026/indice2026.htm" },
];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// Pasa el índice (texto plano) a la IA para extraer SOLO documentos reales + clasificar por área.
async function clasificar(html: string, tipo: string) {
  const limpio = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 14000);
  const prompt =
    `Eres asistente tributario de un estudio de abogados chileno. Del siguiente ÍNDICE del SII (tipo: ${tipo}) ` +
    `extrae SOLO los documentos REALES que aparezcan, como un JSON array, sin inventar NADA. ` +
    `Cada item: {"numero":"","fecha":"YYYY-MM-DD o ''","titulo":"","resumen":"1 frase factual","areas":[]}. ` +
    `Para "areas" usa SOLO un subconjunto EXACTO de esta lista: ${AREAS.join(" | ")} ` +
    `(las áreas del estudio a las que afecta; [] si ninguna). Devuelve SOLO el JSON, sin markdown ni texto extra.\n\nÍNDICE:\n${limpio}`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-opus-4-8", max_tokens: 3000, messages: [{ role: "user", content: prompt }] }),
  });
  const j = await r.json();
  const txt = (j?.content?.[0]?.text || "").replace(/```json|```/g, "").trim();
  try { const arr = JSON.parse(txt); return Array.isArray(arr) ? arr : []; } catch { return []; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!ANTHROPIC_API_KEY || !SUPABASE_URL || !SERVICE_KEY)
    return json({ error: "Faltan secretos (ANTHROPIC_API_KEY / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" }, 500);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  let inserted = 0;
  const errores: string[] = [];

  for (const f of FUENTES) {
    try {
      const res = await fetch(f.url, { headers: { "User-Agent": "Mozilla/5.0 (radar-leabogados)" } });
      if (!res.ok) { errores.push(`${f.url} -> HTTP ${res.status}`); continue; }
      const html = await res.text();
      const docs = await clasificar(html, f.tipo);
      for (const d of docs) {
        if (!d?.titulo) continue;
        const numero = String(d.numero || "").trim();
        if (numero) {
          const { data: ex } = await sb.from("sii_novedades").select("id").eq("tipo", f.tipo).eq("numero", numero).limit(1);
          if (ex && ex.length) continue; // dedupe por tipo+número
        }
        const areas = Array.isArray(d.areas) ? d.areas.filter((a: string) => AREAS.includes(a)) : [];
        const fecha = (d.fecha && /^\d{4}-\d{2}-\d{2}$/.test(d.fecha)) ? d.fecha : null;
        const { error } = await sb.from("sii_novedades").insert({
          tipo: f.tipo,
          numero: numero || null,
          fecha,
          titulo: String(d.titulo).slice(0, 400),
          url: String(d.url || f.url),
          resumen: d.resumen ? String(d.resumen).slice(0, 600) : null,
          areas,
          prioridad: "media",
          vigente: true,
        });
        if (!error) inserted++;
      }
    } catch (e) {
      errores.push(`${f.url} -> ${(e as Error).message}`);
    }
  }

  return json({ ok: true, inserted, errores });
});
