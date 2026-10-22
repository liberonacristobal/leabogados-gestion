// Edge Function: tareas-evidencia
// Cada mañana revisa las tareas activas: si lo que pide la tarea ya quedó hecho en los registros (solicitud de fondos enviada o
// fondos recibidos, factura emitida, liquidación de notaría preparada, rendición enviada), deja la prueba en tasks.evidencia
// (_shared/tareasReglas.js). Nunca cierra una tarea: en Tareas aparece «Cumplida según los registros» y el responsable confirma
// o marca «No corresponde» (evidencia.descartada, que no se vuelve a proponer). Si la prueba desaparece (factura anulada), se quita.
// body.dryRun = calcula sin escribir. Auth: CRON_SECRET. verify_jwt=false.

import { evidenciaTarea } from "../_shared/tareasReglas.js";

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const enLista = (ids: string[]) => `(${ids.map((x) => `"${x}"`).join(",")})`;

// deno-lint-ignore no-explicit-any
async function rest(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${path.split("?")[0]}: ${r.status} ${await r.text()}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
// deno-lint-ignore no-explicit-any
async function todas(path: string): Promise<any[]> {
  // deno-lint-ignore no-explicit-any
  const out: any[] = [];
  for (let i = 0; i < 50; i++) {
    const r = await fetch(`${SB_URL}/rest/v1/${path}${path.includes("?") ? "&" : "?"}order=id.asc`, { headers: { ...H, Range: `${i * 1000}-${i * 1000 + 999}` } });
    if (!r.ok) throw new Error(`${path.split("?")[0]}: ${r.status}`);
    const p = await r.json(); out.push(...p); if (p.length < 1000) break;
  }
  return out;
}

Deno.serve(async (req) => {
  // deno-lint-ignore no-explicit-any
  let body: any = {}; try { body = await req.json(); } catch { /* sin body */ }
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!CRON_SECRET || (body.secret !== CRON_SECRET && bearer !== CRON_SECRET)) return json({ error: "No autorizado" }, 403);
  const dryRun = !!body.dryRun;
  try {
    const tareas = await todas("tasks?select=id,title,client_id,sale_id,status,created_at,evidencia&status=neq.Terminado");
    if (!tareas.length) return json({ ok: true, revisadas: 0 });
    const cids = [...new Set(tareas.map((t) => t.client_id).filter(Boolean))];
    const desde = tareas.map((t) => String(t.created_at).slice(0, 10)).sort()[0];
    const [fundRequests, fondos, billing, rendiciones] = await Promise.all([
      cids.length ? todas(`fund_requests?select=id,client_id,monto,enviada_at&client_id=in.${enLista(cids)}&enviada_at=gte.${desde}`) : [],
      cids.length ? todas(`expenses?select=id,client_id,type,amount,date,deleted_at&type=eq.fondo&client_id=in.${enLista(cids)}&date=gte.${desde}`) : [],
      cids.length ? todas(`billing?select=id,client_id,sale_id,invoice_no,status,deleted_at,billing_type,issued_at,amount&client_id=in.${enLista(cids)}&issued_at=gte.${desde}`) : [],
      todas(`rendiciones?select=id,client_id,tipo,total,created_at,sent_at,anulada_at&created_at=gte.${desde}`),
    ]);
    const propuestas: unknown[] = [], quitadas: unknown[] = [];
    for (const t of tareas) {
      if (t.evidencia?.descartada) continue;
      const ev = evidenciaTarea(t, { fundRequests, fondos, billing, rendiciones });
      const antes = t.evidencia || null;
      if (ev && antes && antes.tabla === ev.tabla && String(antes.id) === String(ev.id)) continue;
      if (!ev && !antes) continue;
      if (ev) propuestas.push({ tarea: t.title, evidencia: ev.texto }); else quitadas.push({ tarea: t.title });
      if (dryRun) continue;
      await rest(`tasks?id=eq.${t.id}`, { method: "PATCH", body: JSON.stringify({ evidencia: ev ? { ...ev, detectado_at: new Date().toISOString() } : null }) });
      if (ev) await rest("activity_log", { method: "POST", body: JSON.stringify({ user_email: "agente", action: "tareas.evidencia", table_name: "tasks", record_id: t.id, estudio_id: "lea", detail: { title: `«${t.title}»: ${ev.texto} (por confirmar)`, regla: ev.regla, ref: { tabla: ev.tabla, id: ev.id } } }) }).catch(() => null);
    }
    return json({ ok: true, dryRun, revisadas: tareas.length, propuestas, quitadas });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
