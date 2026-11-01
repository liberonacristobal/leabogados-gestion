// Registra en ia_uso cada llamada a Claude (tokens, modelo, procedencia y si falló). Nunca rompe la función que lo llama.
// Uso: tras recibir la respuesta, `await registrarUsoIA({ funcion: "titulos-cortos", modelo, data, status: r.status })`.
import { filaUso } from "./usoIA.js";
import { ESTUDIO_ID } from "./equipo.js";

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// deno-lint-ignore no-explicit-any
export async function registrarUsoIA(p: { funcion: string; modelo?: string; data: any; status?: number; origen?: string; usuario?: string | null; maxTokens?: number }) {
  try {
    if (!SB_URL || !SB_KEY) return;
    const envio = fetch(`${SB_URL}/rest/v1/ia_uso`, {
      method: "POST",
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(filaUso({ ...p, estudioId: ESTUDIO_ID })),
      signal: AbortSignal.timeout(5000),
    }).then((r) => r.body?.cancel()).catch(() => {});
    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as any).EdgeRuntime;
    if (rt?.waitUntil) rt.waitUntil(envio); else await envio;
  } catch { /* el registro es accesorio */ }
}
