// notaria-sin-cliente-alerta — recordatorio diario de OT de notaría cargadas SIN CLIENTE ("por identificar").
// Si una OT lleva 3+ días sin resolver, avisa a Martina + admins, y se REPITE cada día hasta que se resuelva.
// La OT es la fuente de la verdad: al asignarle cliente, se carga a quien la paga y sale de la alarma.
//
// Auth/disparo (calco notaria-semanal): cron con secreto (respeta interruptor learnings config
// 'notaria_alerta_sincliente' — ON por defecto, se apaga poniéndolo en 'off'); body.testTo=correo → prueba a uno;
// JWT @leabogados.cl → prueba a sí mismo; body.dryRun=true → arma y devuelve, no envía.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GMAIL_USER = Deno.env.get("GMAIL_USER") || "";
const GMAIL_PASS = Deno.env.get("GMAIL_PASS") || "";
const CRON_SECRET = Deno.env.get("NOTARIA_ALERTA_SECRET") || Deno.env.get("CRON_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Destinatarios: Martina (quien carga) + admins.
const DEST = ["mp@leabogados.cl", "cl@leabogados.cl", "ee@leabogados.cl"];
const DIAS_ALARMA = 3;

const toAscii = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[–—]/g, "-").replace(/[^\x20-\x7E]/g, "");
const qpSafe = (h: string) => String(h || "").replace(/[ \t]+$/gm, "");
const esc = (s: string) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = (n: number) => new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(Math.round(n || 0));
const diasDe = (iso: string) => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : 0;

async function sendMail(to: string[], subject: string, html: string) {
  const client = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: GMAIL_USER, password: GMAIL_PASS } } });
  try { await client.send({ from: `Liberona Escala Abogados - Notaría <${GMAIL_USER}>`, to, subject: toAscii(subject), content: "Ver el contenido en formato HTML.", html: qpSafe(html) }); }
  finally { await client.close(); }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" } });
  try {
    const body = await req.json().catch(() => ({}));
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    let testTo: string | null = null;
    const esCron = !!CRON_SECRET && body.secret === CRON_SECRET;
    if (esCron) { if (body.testTo) testTo = String(body.testTo).toLowerCase().trim(); }
    else {
      const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      const { data: u } = await sb.auth.getUser(jwt);
      const email = (u?.user?.email || "").toLowerCase();
      if (!email.endsWith("@leabogados.cl")) return new Response(JSON.stringify({ error: "No autorizado" }), { status: 403, headers: { "Content-Type": "application/json" } });
      testTo = email;
    }
    const dryRun = !!body.dryRun;

    // Interruptor: ON por defecto (solo se apaga con 'off'). Solo aplica al cron real (no a pruebas/dryRun).
    if (esCron && !testTo && !dryRun) {
      const { data: cfg } = await sb.from("learnings").select("value").eq("kind", "config").eq("key", "notaria_alerta_sincliente").maybeSingle();
      if (String(cfg?.value || "on").trim() === "off")
        return new Response(JSON.stringify({ ok: true, skipped: "apagado" }), { headers: { "Content-Type": "application/json" } });
    }

    // OT de notaría cargadas sin cliente ni miembro (por identificar), no liquidadas ni rendidas, con 3+ días.
    const { data: exp } = await sb.from("expenses")
      .select("id,ot_number,concept,amount,created_at,client_id,personal_de,category,deleted_at,notaria_render_id,notaria_liquidado_at,rendered_at,client_rendered_at,type")
      .eq("category", "Notaria").is("client_id", null).is("personal_de", null).is("deleted_at", null);
    const pend = (exp || []).filter((e: any) =>
      e.type !== "fondo" && !e.notaria_render_id && !e.notaria_liquidado_at && !e.rendered_at && !e.client_rendered_at &&
      (Number(e.amount) || 0) > 1 && diasDe(e.created_at) >= DIAS_ALARMA)
      .sort((a: any, b: any) => diasDe(b.created_at) - diasDe(a.created_at));

    if (!pend.length)
      return new Response(JSON.stringify({ ok: true, modo: testTo ? "prueba" : "cron", n: 0, note: "sin OT por identificar de 3+ días" }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });

    const total = pend.reduce((a: number, e: any) => a + (Number(e.amount) || 0), 0);
    const filas = pend.map((e: any) => `<tr><td style="padding:6px 0;font-size:11px;color:#185FA5;font-weight:600;white-space:nowrap">${esc(e.ot_number || "s/OT")}</td><td style="padding:6px 8px;font-size:12px;color:#3D3D3D">${esc((e.concept || "—").slice(0, 60))}</td><td style="padding:6px 0;font-size:11px;color:#A32D2D;font-weight:600;white-space:nowrap;text-align:center">${diasDe(e.created_at)} d</td><td style="padding:6px 0;font-size:12px;text-align:right;font-weight:600;white-space:nowrap">${fmt(e.amount)}</td></tr>`).join("");
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,Helvetica,sans-serif;background:#f0f2f4;margin:0;padding:20px"><div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e4e8eb"><div style="background:#003C50;padding:18px 26px"><div style="color:#fff;font-size:15px;font-weight:700">Notaría · OT por identificar</div><div style="color:#99ABB4;font-size:12px;margin-top:2px">${pend.length} OT sin cliente llevan 3+ días sin resolver</div></div><div style="padding:24px 26px"><div style="font-size:13px;color:#666;margin:0 0 14px">Estas OT de notaría se cargaron <b>sin cliente</b>: no se le están cobrando a nadie. Hay que asignarles cliente (o marcarlas como internas / no nuestras) para cerrarlas. Este aviso se repite cada día hasta resolverlas.</div><table style="width:100%;border-collapse:collapse"><tr style="border-bottom:1px solid #E4E8EB"><td style="font-size:10px;color:#99ABB4;text-transform:uppercase;padding:4px 0">OT</td><td style="font-size:10px;color:#99ABB4;text-transform:uppercase;padding:4px 8px">Detalle</td><td style="font-size:10px;color:#99ABB4;text-transform:uppercase;padding:4px 0;text-align:center">Días</td><td style="font-size:10px;color:#99ABB4;text-transform:uppercase;padding:4px 0;text-align:right">Monto</td></tr>${filas}<tr style="border-top:1.5px solid #537281"><td colspan="3" style="padding:7px 0;font-size:12px;font-weight:bold">Total sin identificar</td><td style="padding:7px 0;font-size:12px;font-weight:bold;text-align:right">${fmt(total)}</td></tr></table><div style="font-size:12px;color:#666;margin:18px 0 0">Resuélvelas en la app: <b>Gastos › Notaría › Deuda › Sin cliente</b>.</div></div><div style="padding:14px 26px;border-top:1px solid #eee;font-size:11px;color:#999">gestion.leabogados.cl · aviso automático</div></div></body></html>`;
    const subject = `Notaría: ${pend.length} OT por identificar (3+ días)`;

    const to = testTo ? [testTo] : DEST;
    if (!dryRun) await sendMail(to, subject, html);
    return new Response(JSON.stringify({ ok: true, modo: testTo ? "prueba" : "cron", dryRun, enviado_a: to, n: pend.length, total }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as any).message }), { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  }
});
