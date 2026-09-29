// resumen-lunes — UN solo correo semanal a los admins (Cristóbal, Erasmo), marca LIBERONA ESCALA ABOGADOS.
// Reemplaza los 3 correos sueltos del lunes (proyectos, facturación, clientes) por uno consolidado con 4 secciones:
//   1) Tus tareas       — vencidas / por vencer (misma lógica que task-reminders).
//   2) Tus proyectos     — facturas emitidas esta semana (movimientos).
//   3) Tus clientes      — abonos por identificar (sin cliente, pendientes).
//   4) Facturación       — emitidas semana / por cobrar / vencido (misma lógica que sii-sync resumen-semanal).
// Una sección sin datos NO aparece (correo corto). task-reminders sigue mié/vie por separado.
//
// Auth: verify_jwt=false. Cron con secreto (body.secret === CRON_SECRET). body.dryRun no envía (devuelve el html);
// body.testTo envía solo a esa dirección (prueba). Envía vía notify-task con la service key (igual que sii-sync).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("RESUMEN_LUNES_SECRET") || Deno.env.get("CRON_SECRET") || "";

const ADMINS = [
  { name: "Cristóbal", alt: ["Cristobal"], email: "cl@leabogados.cl" },
  { name: "Erasmo", alt: [], email: "ee@leabogados.cl" },
];

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const esc = (s: string) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fm = (n: number) => "$" + Math.round(n || 0).toLocaleString("es-CL");
// Corto para KPIs: $61,3M / $605k
const fmShort = (n: number) => { const a = Math.abs(n || 0); if (a >= 1e6) return "$" + (n / 1e6).toFixed(1).replace(".", ",") + "M"; if (a >= 1e4) return "$" + Math.round(n / 1e3) + "k"; return fm(n); };

// deno-lint-ignore no-explicit-any
async function enviar(to: string, subject: string, html: string) {
  await fetch(`${SB_URL}/functions/v1/notify-task`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + SB_KEY },
    body: JSON.stringify({ mail: { to, subject, html } }),
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* cron sin body */ }

  // Autorización: (a) cron con secreto → corrida completa; (b) usuario @leabogados.cl con JWT → corrida manual (prueba/dryRun).
  const sbAuth = createClient(SB_URL, SB_KEY);
  const esCron = !!CRON_SECRET && body.secret === CRON_SECRET;
  if (!esCron) {
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await sbAuth.auth.getUser(jwt);
    const email = (u?.user?.email || "").toLowerCase();
    if (!email.endsWith("@leabogados.cl")) return json({ error: "No autorizado" }, 403);
  }

  try {
    const sb = createClient(SB_URL, SB_KEY);
    const todayCL = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" }); // YYYY-MM-DD
    const t0 = Date.parse(todayCL);
    const hace7 = new Date(t0 - 7 * 86400000).toISOString().slice(0, 10);

    // ── Datos
    const { data: tasksRaw } = await sb.from("tasks").select("id,title,due,status,client_id,assignees,delegated_to,who");
    const { data: clients } = await sb.from("clients").select("id,name");
    const { data: billsRaw, error: billsErr } = await sb.from("billing").select("amount,paid_amount,status,invoice_no,due,dte_estado,dte_track_id,dte_emitido_at,email_sent_at,deleted_at,client_id,concept").limit(6000);
    if (billsErr) return json({ error: "No se pudo leer billing: " + billsErr.message }, 500);
    const { data: movs } = await sb.from("cartola_movimientos").select("id,fecha,monto,tipo,cliente_id,estado,n_operacion").eq("tipo", "abono").is("cliente_id", null).limit(4000);

    // deno-lint-ignore no-explicit-any
    const cname = (id: unknown) => (clients || []).find((c: any) => String(c.id) === String(id))?.name || "";

    // ── 1) TAREAS por admin (misma lógica que task-reminders)
    const tasks = (tasksRaw || []).filter((t: Record<string, unknown>) => t.status !== "Terminado" && t.due);
    const dueDaysOf = (due: string) => Math.round((Date.parse(String(due).slice(0, 10)) - t0) / 86400000);
    // deno-lint-ignore no-explicit-any
    const respOf = (t: any): string[] => (Array.isArray(t.delegated_to) && t.delegated_to.length) ? t.delegated_to : (Array.isArray(t.assignees) && t.assignees.length ? t.assignees : (t.who ? [t.who] : []));

    // ── 4) FACTURACIÓN (firm-wide, misma lógica que sii-sync resumen-semanal)
    // deno-lint-ignore no-explicit-any
    const vivos = (billsRaw || []).filter((b: any) => !b.deleted_at);
    // deno-lint-ignore no-explicit-any
    const saldo = (b: any) => ["Pagado", "Anulada", "Anulado"].includes(b.status) ? 0 : Math.max(0, (b.amount || 0) - (b.paid_amount || 0));
    // deno-lint-ignore no-explicit-any
    const porCobrarB = vivos.filter((b: any) => b.invoice_no && ["Pendiente", "Vencido"].includes(b.status));
    const emitidasSemanaArr = vivos.filter((b: Record<string, unknown>) => String(b.dte_emitido_at || "").slice(0, 10) >= hace7 && b.invoice_no);
    const emitidasSemana = emitidasSemanaArr.length;
    const porCobrar = porCobrarB.reduce((s: number, b: Record<string, unknown>) => s + saldo(b), 0);
    const vencido = porCobrarB.filter((b: Record<string, unknown>) => String(b.due || "") && String(b.due || "") < todayCL).reduce((s: number, b: Record<string, unknown>) => s + saldo(b), 0);
    const porEnviar = vivos.filter((b: Record<string, unknown>) => b.dte_track_id && !b.email_sent_at && ["Pendiente", "Vencido"].includes(b.status as string)).length;

    // ── 3) CLIENTES: abonos por identificar (sin cliente, pendientes)
    // deno-lint-ignore no-explicit-any
    const abonosSinCli = (movs || []).filter((m: any) => (m.monto || 0) > 0 && (m.estado || "pendiente") === "pendiente")
      .sort((a: Record<string, unknown>, b: Record<string, unknown>) => String(b.fecha || "").localeCompare(String(a.fecha || "")));

    // ── HTML helpers (marca LIBERONA ESCALA)
    const A = "#003C50", MUT = "#537281", DONE = "#99ABB4", RED = "#B5433F", AMB = "#9A6B12", GRN = "#177A5A";
    const fmtFecha = (d: string) => { try { return new Date(String(d).slice(0, 10) + "T00:00:00").toLocaleDateString("es-CL", { day: "numeric", month: "short" }); } catch { return String(d); } };
    const sec = (icoBg: string, ico: string, titulo: string, chip: string, chipCol: string, inner: string) =>
      `<div style="padding:16px 0 4px;border-top:1px solid #F5F7F9;">
        <div style="display:flex;align-items:center;margin-bottom:10px;">
          <span style="display:inline-block;width:24px;height:24px;border-radius:7px;background:${icoBg};text-align:center;line-height:24px;vertical-align:middle;">${ico}</span>
          <span style="font-size:13px;font-weight:800;color:${A};margin-left:9px;">${titulo}</span>
          <span style="margin-left:auto;font-size:11px;font-weight:700;color:${chipCol};">${chip}</span>
        </div>${inner}
      </div>`;
    const rowT = (dot: string, nm: string, rt: string, rtCol: string) =>
      `<table style="width:100%;border-collapse:collapse;"><tr>
        <td style="width:12px;padding:6px 0;vertical-align:top;"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${dot};"></span></td>
        <td style="padding:6px 4px;font-size:12.5px;color:#3D3D3D;">${nm}</td>
        <td style="padding:6px 0;font-size:11px;color:${rtCol};text-align:right;white-space:nowrap;">${rt}</td>
      </tr></table>`;
    const cta = (txt: string) => `<a href="https://gestion.leabogados.cl" style="display:inline-block;font-size:11px;font-weight:700;color:${A};text-decoration:none;margin-top:6px;">${txt} &rsaquo;</a>`;

    const dryRun = !!body.dryRun;
    const testTo = typeof body.testTo === "string" ? body.testTo : null;
    const sent: unknown[] = [];

    for (const adm of ADMINS) {
      const nombres = [adm.name, ...adm.alt];
      // Tareas del admin
      const mine = tasks.filter((t: Record<string, unknown>) => respOf(t).some((p) => nombres.includes(p)));
      // deno-lint-ignore no-explicit-any
      const withDD = mine.map((t: any) => ({ ...t, dd: dueDaysOf(t.due) }));
      const venc = withDD.filter((t: Record<string, number>) => (t.dd as number) < 0).sort((a: Record<string, number>, b: Record<string, number>) => (a.dd as number) - (b.dd as number));
      const pronto = withDD.filter((t: Record<string, number>) => (t.dd as number) >= 0 && (t.dd as number) <= 3).sort((a: Record<string, number>, b: Record<string, number>) => (a.dd as number) - (b.dd as number));

      const bloques: string[] = [];

      // 1) Tareas
      if (venc.length || pronto.length) {
        // deno-lint-ignore no-explicit-any
        const filas = [...venc, ...pronto].slice(0, 4).map((t: any) => {
          const cli = cname(t.client_id);
          const isV = t.dd < 0;
          const when = isV ? (t.dd === -1 ? "venció ayer" : `venció hace ${Math.abs(t.dd)}d`) : (t.dd === 0 ? "vence hoy" : t.dd === 1 ? "vence mañana" : `vence en ${t.dd}d`);
          return rowT(isV ? "#E24B4A" : "#E0C56A", `${esc(t.title || "")}${cli ? ` — <b style="color:${A}">${esc(cli)}</b>` : ""}`, when, isV ? RED : AMB);
        }).join("");
        bloques.push(sec("#FBEBEA", "&#10003;", "Tus tareas", `${venc.length} vencidas &middot; ${pronto.length} por vencer`, RED, filas + cta("Ver mis tareas")));
      }

      // 2) Proyectos (emitidas esta semana)
      if (emitidasSemanaArr.length) {
        // deno-lint-ignore no-explicit-any
        const filas = emitidasSemanaArr.slice(0, 4).map((b: any) => rowT("#2E6C8A", `<b style="color:${A}">${esc(cname(b.client_id) || "Cliente")}</b> — factura N&deg; ${esc(String(b.invoice_no))}`, fmShort(b.amount || 0), MUT)).join("");
        bloques.push(sec("#E9F1F5", "&#128202;", "Tus proyectos", `${emitidasSemanaArr.length} emitida${emitidasSemanaArr.length !== 1 ? "s" : ""} esta semana`, "#2E6C8A", filas + cta("Ver proyectos")));
      }

      // 3) Clientes (abonos por identificar)
      if (abonosSinCli.length) {
        // deno-lint-ignore no-explicit-any
        const filas = abonosSinCli.slice(0, 3).map((m: any) => rowT("#E0C56A", `Abono <b>${fm(m.monto || 0)}</b> sin identificar — revisa de quién es`, fmtFecha(m.fecha), MUT)).join("");
        bloques.push(sec("#FBF1DB", "&#128100;", "Tus clientes", `${abonosSinCli.length} cobro${abonosSinCli.length !== 1 ? "s" : ""} por identificar`, AMB, filas + cta("Revisar cobros")));
      }

      // 4) Facturación (firm-wide)
      {
        const kp = (v: string, k: string, col: string) => `<td style="padding:0 4px;"><div style="background:#F5F7F9;border-radius:9px;padding:9px 6px;text-align:center;"><div style="font-size:15px;font-weight:800;color:${col};">${v}</div><div style="font-size:9px;color:${MUT};text-transform:uppercase;letter-spacing:.3px;">${k}</div></div></td>`;
        const tabla = `<table style="width:100%;border-collapse:separate;border-spacing:0;"><tr>${kp(String(emitidasSemana), "Emitidas", A)}${kp(fmShort(porCobrar), "Por cobrar", RED)}${kp(fmShort(vencido), "Vencido", vencido > 0 ? RED : A)}</tr></table>${porEnviar > 0 ? `<div style="font-size:11px;color:${AMB};margin-top:8px;">${porEnviar} factura${porEnviar !== 1 ? "s" : ""} por enviar por correo</div>` : ""}`;
        bloques.push(sec("#E6F4EC", "&#128196;", "Facturación", "esta semana", MUT, tabla + cta("Ir a Facturación")));
      }

      if (!bloques.length) { sent.push({ to: adm.email, skipped: "sin contenido" }); continue; }

      const subject = "Tu semana · Liberona Escala Abogados";
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family:Arial,Helvetica,sans-serif;background:#EEF1F3;margin:0;padding:20px;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #E4E8EB;">
  <div style="background:#003C50;padding:20px 24px;text-align:center;"><img src="https://gestion.leabogados.cl/le-logo-blanco.png" alt="Liberona Escala Abogados" height="26" style="height:26px;display:inline-block;border:0;"/></div>
  <div style="padding:8px 22px 18px;">
    <div style="padding:14px 0 2px;font-size:13px;color:#537281;">Hola <b style="color:#003C50;">${esc(adm.name)}</b>, tu resumen de la semana en un vistazo.</div>
    ${bloques.join("")}
  </div>
  <div style="background:#F5F7F9;padding:14px 24px;text-align:center;font-size:10px;color:#537281;line-height:1.6;"><b style="color:#003C50;">Liberona Escala Abogados</b> &middot; gestion.leabogados.cl<br/>Resumen semanal autom&aacute;tico &middot; cada lunes</div>
</div></body></html>`;

      if (dryRun) { sent.push({ to: adm.email, vencidas: venc.length, porVencer: pronto.length, emitidasSemana, abonosSinCli: abonosSinCli.length, bloques: bloques.length, html }); continue; }
      const dest = testTo || adm.email;
      await enviar(dest, subject, html);
      sent.push({ to: dest, vencidas: venc.length, porVencer: pronto.length, emitidasSemana, abonosSinCli: abonosSinCli.length });
      if (testTo) break; // en prueba, uno solo
    }

    return json({ ok: true, dryRun, testTo, sent, count: sent.length });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
