// fusionar-clientes — une dos fichas de cliente en una, sin perder nada.
// Reasigna TODAS las FKs (client_id / cliente_id) del PERDEDOR al SOBREVIVIENTE, mueve sus RS,
// aprende el alias del nombre del perdedor (learnings kind 'cliente_folder' → no se recrea) y borra el perdedor.
//
// Body: { survivor_id, loser_id, dryRun? }
//   dryRun → devuelve el conteo por tabla que se MOVERÍA (no escribe nada).
//   execute → mueve, aprende alias, borra el perdedor, devuelve el resumen de lo movido.
// Auth: usuario @leabogados.cl con JWT (misma política que clientes-drive-sync).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const norm = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

// Tablas que apuntan al cliente. Se reasignan del perdedor al sobreviviente.
const FK_CLIENT_ID = ["anticipos", "billing", "contacts", "expenses", "horas", "plazos", "provisions", "rendiciones", "reportes_horas", "retainers", "sales", "sii_cargas_docs", "tasks", "client_entities", "client_drive", "matters", "import_aliases", "client_perfil", "perfil_cliente"];
const FK_CLIENTE_ID = ["cartola_movimientos", "proyectos_cartera", "expedientes_reorg", "perfil_maestro", "cliente_alias", "casos_carga_personal", "casos_convenios", "casos_donaciones", "casos_propuestas", "casos_reforma"];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const sb = createClient(SB_URL, SB_KEY);
  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = await req.json(); } catch { /* */ }

  // Auth: JWT de usuario @leabogados.cl
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await sb.auth.getUser(jwt);
  const email = (u?.user?.email || "").toLowerCase();
  if (!email.endsWith("@leabogados.cl")) return json({ error: "No autorizado" }, 403);

  const survivor = String(body.survivor_id || "");
  const loser = String(body.loser_id || "");
  if (!survivor || !loser) return json({ error: "Faltan survivor_id / loser_id" }, 400);
  if (survivor === loser) return json({ error: "El sobreviviente y el perdedor no pueden ser el mismo" }, 400);

  // Confirmar que ambos existen; capturar el nombre del perdedor (para el alias).
  const { data: cls } = await sb.from("clients").select("id,name").in("id", [survivor, loser]);
  const surv = (cls || []).find((c) => c.id === survivor);
  const los = (cls || []).find((c) => c.id === loser);
  if (!surv) return json({ error: "No existe el cliente sobreviviente" }, 404);
  if (!los) return json({ error: "No existe el cliente a fusionar" }, 404);

  const all = FK_CLIENT_ID.map((t) => ({ t, col: "client_id" })).concat(FK_CLIENTE_ID.map((t) => ({ t, col: "cliente_id" })));

  // DRY-RUN: contar lo que se movería, sin escribir.
  if (body.dryRun) {
    const moved: Record<string, number> = {};
    for (const { t, col } of all) {
      try {
        const { count } = await sb.from(t).select("*", { count: "exact", head: true }).eq(col, loser);
        if (count && count > 0) moved[t] = count;
      } catch { /* tabla/columna inexistente → ignorar */ }
    }
    return json({ ok: true, dryRun: true, survivor: surv.name, loser: los.name, moveria: moved });
  }

  // EXECUTE
  const moved: Record<string, number> = {};
  const errors: string[] = [];
  for (const { t, col } of all) {
    try {
      const { count } = await sb.from(t).select("*", { count: "exact", head: true }).eq(col, loser);
      if (!count) continue;
      const { error } = await sb.from(t).update({ [col]: survivor }).eq(col, loser);
      if (error) errors.push(`${t}: ${error.message}`);
      else moved[t] = count;
    } catch (e) { errors.push(`${t}: ${String((e as Error)?.message || e)}`); }
  }

  // Aprender alias: el nombre del perdedor → el sobreviviente (evita que Drive lo recree).
  try {
    const k = norm(los.name);
    const { data: ex } = await sb.from("learnings").select("id").eq("kind", "cliente_folder").eq("key", k).limit(1);
    if (ex && ex.length) await sb.from("learnings").update({ value: survivor }).eq("id", ex[0].id);
    else await sb.from("learnings").insert({ kind: "cliente_folder", key: k, value: survivor });
  } catch (e) { errors.push(`alias: ${String((e as Error)?.message || e)}`); }

  // Borrar el perdedor (ya sin datos colgados).
  const { error: delErr } = await sb.from("clients").delete().eq("id", loser);
  if (delErr) return json({ error: `No se pudo eliminar la ficha perdedora: ${delErr.message}. Se movieron los datos igual.`, moved, errors }, 500);

  return json({ ok: true, survivor: surv.name, loser: los.name, moved, errors });
});
