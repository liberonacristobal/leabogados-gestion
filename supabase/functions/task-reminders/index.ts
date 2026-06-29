import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GMAIL_USER = Deno.env.get("GMAIL_USER") || "";
const GMAIL_PASS = Deno.env.get("GMAIL_PASS") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const EMAILS: Record<string, string> = {
  "Martín": "mc@leabogados.cl", "Martin": "mc@leabogados.cl",
  "Martina": "mp@leabogados.cl",
  "Rodrigo": "rodrigo@leabogados.cl",
  "Erasmo": "ee@leabogados.cl",
  "Cristóbal": "cl@leabogados.cl", "Cristobal": "cl@leabogados.cl",
};

// Encabezados SOLO ASCII (denomailer rompe el encoded-word RFC 2047 con tildes → correo crudo). El cuerpo conserva tildes.
const toAscii = (s: string) =>
  String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E]/g, "");

async function sendMail(to: string, subject: string, html: string) {
  const client = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: GMAIL_USER, password: GMAIL_PASS } } });
  try {
    await client.send({ from: `Gestion LE <${GMAIL_USER}>`, to, subject: toAscii(subject), content: "Ver el contenido en formato HTML.", html });
  } finally { await client.close(); }
}

const esc = (s: string) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" } });
  try {
    const body = await req.json().catch(() => ({}));
    if (!CRON_SECRET || body.secret !== CRON_SECRET) {
      return new Response(JSON.stringify({ error: "No autorizado" }), { status: 403, headers: { "Content-Type": "application/json" } });
    }
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: tasks } = await sb.from("tasks").select("*").neq("status", "Terminado");
    const { data: clients } = await sb.from("clients").select("id,name");
    const cname = (id: string) => (clients || []).find((c: any) => String(c.id) === String(id))?.name || "";

    // Hoy en Chile (date-only). dueDays = días desde hoy hasta el vencimiento.
    const todayCL = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" }); // YYYY-MM-DD
    const t0 = Date.parse(todayCL);
    const dueDaysOf = (due: string) => Math.round((Date.parse(String(due).slice(0, 10)) - t0) / 86400000);
    const fmtDue = (due: string) => { try { return new Date(String(due).slice(0, 10) + "T00:00:00").toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" }); } catch { return String(due); } };

    // Ventana "pronto" = 3 días (cubre el hueco más largo entre recordatorios: viernes→lunes).
    const byPerson: Record<string, any[]> = {};
    for (const t of (tasks || [])) {
      if (!t.due) continue;
      const dd = dueDaysOf(t.due);
      const bucket = dd < 0 ? "vencida" : (dd <= 3 ? "pronto" : null);
      if (!bucket) continue;
      const resp: string[] = (Array.isArray(t.delegated_to) && t.delegated_to.length) ? t.delegated_to : (Array.isArray(t.assignees) ? t.assignees : []);
      for (const p of resp) { if (!p) continue; (byPerson[p] = byPerson[p] || []).push({ ...t, bucket, dd }); }
    }

    const dryRun = !!body.dryRun;
    const sent: any[] = [];
    for (const [name, items] of Object.entries(byPerson)) {
      const to = EMAILS[name];
      if (!to) continue;
      const venc = items.filter((i) => i.bucket === "vencida").sort((a, b) => a.dd - b.dd);
      const pronto = items.filter((i) => i.bucket === "pronto").sort((a, b) => a.dd - b.dd);
      const subject = `Tus tareas | ${venc.length} vencidas, ${pronto.length} por vencer`;
      if (dryRun) { sent.push({ name, to, vencidas: venc.length, porVencer: pronto.length }); continue; }
      const rowsHtml = (arr: any[], col: string, isVenc: boolean) => arr.map((t) => {
        const cli = cname(t.client_id);
        const when = isVenc ? (t.dd === -1 ? "venció ayer" : `venció hace ${Math.abs(t.dd)} días`) : (t.dd === 0 ? "vence hoy" : t.dd === 1 ? "vence mañana" : `vence ${fmtDue(t.due)}`);
        return `<tr><td style="padding:8px 0;border-top:1px solid #eee;"><div style="font-size:13px;color:#1a1a1a;font-weight:600;">${esc(t.title || "")}</div><div style="font-size:11px;color:#888;">${cli ? esc(cli) + " · " : ""}<span style="color:${col};font-weight:600;">${when}</span></div></td></tr>`;
      }).join("");
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family:Arial,Helvetica,sans-serif;background:#f0f2f4;margin:0;padding:20px;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e4e8eb;">
  <div style="background:#003C50;padding:20px 28px;text-align:center;"><img src="https://gestion.leabogados.cl/le-logo-blanco.png" alt="Liberona Escala Abogados" height="28" width="184" style="height:28px;width:184px;display:inline-block;border:0;"/></div>
  <div style="padding:28px;">
    <div style="font-size:16px;color:#1a1a1a;margin:0 0 6px;">Hola ${esc(name)},</div>
    <div style="font-size:14px;color:#666;margin:0 0 20px;">Tienes ${venc.length} tarea${venc.length !== 1 ? "s" : ""} vencida${venc.length !== 1 ? "s" : ""} y ${pronto.length} que vence${pronto.length !== 1 ? "n" : ""} pronto.</div>
    ${venc.length ? `<div style="font-size:10px;font-weight:bold;color:#A32D2D;text-transform:uppercase;letter-spacing:.5px;margin:0 0 2px;">Vencidas</div><table style="width:100%;border-collapse:collapse;margin-bottom:16px;">${rowsHtml(venc, "#A32D2D", true)}</table>` : ""}
    ${pronto.length ? `<div style="font-size:10px;font-weight:bold;color:#854F0B;text-transform:uppercase;letter-spacing:.5px;margin:0 0 2px;">Por vencer</div><table style="width:100%;border-collapse:collapse;">${rowsHtml(pronto, "#854F0B", false)}</table>` : ""}
    <div style="margin-top:22px;"><a href="https://gestion.leabogados.cl" style="display:inline-block;background:#003C50;color:#fff;text-decoration:none;padding:8px 16px;border-radius:18px;font-size:12px;font-weight:bold;">Ver mis tareas &rarr;</a></div>
  </div>
  <div style="padding:16px 28px;border-top:1px solid #eee;"><div style="font-size:11px;color:#999;">gestion.leabogados.cl &middot; Liberona Escala Abogados</div></div>
</div></body></html>`;
      await sendMail(to, subject, html);
      sent.push({ name, to, vencidas: venc.length, porVencer: pronto.length });
    }
    return new Response(JSON.stringify({ ok: true, dryRun, sent, count: sent.length }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  }
});
