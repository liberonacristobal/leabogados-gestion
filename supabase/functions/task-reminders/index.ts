import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cargarEquipo } from "../_shared/equipo.js";
import { enviarPush, horaChile } from "../_shared/push.ts";

const CRON_SECRET = Deno.env.get("TASK_REMINDERS_SECRET") || Deno.env.get("CRON_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

let correoDe: (nombre: string) => string = () => "";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" } });
  { const eq = await cargarEquipo(SUPABASE_URL, SERVICE_KEY); correoDe = eq.correoDe; }   // equipo del estudio (miembros)
  try {
    const body = await req.json().catch(() => ({}));
    if (!CRON_SECRET || body.secret !== CRON_SECRET) {
      return new Response(JSON.stringify({ error: "No autorizado" }), { status: 403, headers: { "Content-Type": "application/json" } });
    }
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    // Activa = status != 'Terminado'. OJO: el status NULL en SQL no pasa un .neq (NULL != x da NULL), así que filtramos en JS.
    const { data: tasksRaw, error: tasksErr } = await sb.from("tasks").select("*");
    if (tasksErr) return new Response(JSON.stringify({ error: "No se pudo leer tasks: " + tasksErr.message }), { status: 500, headers: { "Content-Type": "application/json" } });
    const tasks = (tasksRaw || []).filter((t: any) => t.status !== "Terminado");
    const { data: clients, error: clientsErr } = await sb.from("clients").select("id,name");
    if (clientsErr) return new Response(JSON.stringify({ error: "No se pudo leer clients: " + clientsErr.message }), { status: 500, headers: { "Content-Type": "application/json" } });
    const cname = (id: string) => (clients || []).find((c: any) => String(c.id) === String(id))?.name || "";

    // Hoy en Chile (date-only). dueDays = días desde hoy hasta el vencimiento.
    const todayCL = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" }); // YYYY-MM-DD
    const t0 = Date.parse(todayCL);
    const dueDaysOf = (due: string) => Math.round((Date.parse(String(due).slice(0, 10)) - t0) / 86400000);

    // Ventana "pronto" = 3 días (cubre el hueco más largo entre recordatorios: viernes→lunes).
    const byPerson: Record<string, any[]> = {};
    for (const t of (tasks || [])) {
      if (!t.due) continue;
      const dd = dueDaysOf(t.due);
      const bucket = dd < 0 ? "vencida" : (dd <= 3 ? "pronto" : null);
      if (!bucket) continue;
      // Responsable: delegated_to si está delegada; si no, assignees; si no (tareas antiguas), who.
      const resp: string[] = (Array.isArray(t.delegated_to) && t.delegated_to.length) ? t.delegated_to : (Array.isArray(t.assignees) && t.assignees.length ? t.assignees : (t.who ? [t.who] : []));
      for (const p of resp) { if (!p) continue; (byPerson[p] = byPerson[p] || []).push({ ...t, bucket, dd }); }
    }

    // Desde el 26-10-2026 no hay correo de tareas (decisión del usuario: un solo correo recurrente, el del lunes, que ya las trae).
    // Queda un aviso al teléfono a las 08:00 de Chile con las tareas que vencen HOY de cada persona.
    if (!body.dryRun && !body.forzar && horaChile() !== 8) return new Response(JSON.stringify({ ok: true, skipped: `hora Chile ${horaChile()}` }), { headers: { "Content-Type": "application/json" } });
    const dryRun = !!body.dryRun;
    const sent: any[] = [];
    for (const [name, items] of Object.entries(byPerson)) {
      const to = correoDe(name);
      if (!to) continue;
      const hoy = items.filter((i) => i.dd === 0);
      if (!hoy.length) continue;
      const aviso = hoy.length === 1
        ? { titulo: "Vence hoy", cuerpo: `${hoy[0].title || "Tarea"}${cname(hoy[0].client_id) ? " · " + cname(hoy[0].client_id) : ""}`, url: "/?ir=tareas", etiqueta: "tareas-hoy" }
        : { titulo: `${hoy.length} tareas vencen hoy`, cuerpo: hoy.slice(0, 3).map((t) => t.title || "Tarea").join(" · "), url: "/?ir=tareas", etiqueta: "tareas-hoy" };
      if (!dryRun) await enviarPush(SUPABASE_URL, SERVICE_KEY, [to], aviso, "tareas");
      sent.push({ name, to, venceHoy: hoy.length, aviso });
    }
    return new Response(JSON.stringify({ ok: true, dryRun, sent, count: sent.length, activas: (tasks || []).length, conVencimiento: (tasks || []).filter((t: any) => t.due).length, tareasError: tasksErr?.message || null }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  }
});
