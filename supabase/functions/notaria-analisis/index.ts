// Edge Function: notaria-analisis
// Agente de análisis de la notaría: cada lunes, un correo INTERNO a los socios (learnings config notaria_analisis_avisar_a) en el
// formato de «Tu semana» (26-10-2026): una tarjeta por tema con la cifra, una línea y su botón — deuda con la notaría, OT que
// esperan fondos del cliente, pago de la última liquidación y montos por confirmar. Lo de quien liquida la notaría (por liquidar,
// montos por confirmar, documentos por clasificar) va en su «Tu semana». Solo analiza: no registra, no paga ni escribe a la
// notaría. Las cifras salen de las reglas únicas analisisNotaria y notariaPorLiquidar (../_shared/notariaReglas.js).
// Interruptor learnings config notaria_analisis = 'on'. Auth: CRON_SECRET. body.dryRun = devuelve el HTML sin enviar.

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { todasRest } from "../_shared/paginar.js";
import { analisisNotaria, notariaPorLiquidar } from "../_shared/notariaReglas.js";
import { holaEquipo } from "../_shared/correoEquipo.js";

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const GMAIL_USER = Deno.env.get("GMAIL_USER") || "";
const GMAIL_PASS = Deno.env.get("GMAIL_PASS") || "";
const APP = "https://gestion.leabogados.cl";
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const fm = (n: number) => "$" + Math.round(n || 0).toLocaleString("es-CL");
const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const toAscii = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[–—]/g, "-").replace(/[^\x20-\x7E]/g, "");
const dmy = (d: string) => { const m = String(d || "").slice(0, 10).match(/^(\d{4})-(\d\d)-(\d\d)$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : ""; };

// deno-lint-ignore no-explicit-any
// deno-lint-ignore no-explicit-any
const todas = (path: string): Promise<any[]> => todasRest(SB_URL, H, path);

Deno.serve(async (req) => {
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* cron */ }
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!CRON_SECRET || (body.secret !== CRON_SECRET && bearer !== CRON_SECRET)) return json({ error: "No autorizado" }, 403);
  try {
    const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
    const [expenses, rendiciones, clients, docs, cfg, miembros, cobertura] = await Promise.all([
      todas("expenses?select=id,client_id,type,category,ot_number,amount,date,concept,materia,notaria_render_id,notaria_liquidado_at,rendered_at,no_descuenta_saldo,apertura_id,deleted_at&deleted_at=is.null"),
      todas("rendiciones?select=id,tipo,created_at,anulada_at,movimiento_id,total,sent_at"),
      todas("clients?select=id,name,is_internal"),
      todas("documentos_notaria?select=id,estado&estado=in.(por_clasificar,pendiente_ot)"),
      todas("learnings?select=id,key,value&kind=eq.config&key=in.(notaria_analisis,notaria_analisis_avisar_a)"),
      todas("miembros?select=email,nombre&order=email.asc"),
      fetch(`${SB_URL}/rest/v1/rpc/cartola_cobertura`, { method: "POST", headers: H, body: "{}" }).then((r) => r.json()).catch(() => []),
    ]);
    // deno-lint-ignore no-explicit-any
    const cli = (id: unknown) => (clients || []).find((c: any) => String(c.id) === String(id));
    // deno-lint-ignore no-explicit-any
    const esOficina = (cid: unknown) => { const c: any = cli(cid); return !!c && !!c.is_internal; };
    const a = analisisNotaria({ expenses, rendiciones, hoy, esOficina });
    const cfgV = (k: string) => String((cfg || []).find((c: { key: string }) => c.key === k)?.value || "");
    const para = cfgV("notaria_analisis_avisar_a").split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    const nl = notariaPorLiquidar(expenses, { esOficina });
    // Hasta qué día llega la cartola de la cuenta de gastos (desde donde se paga a la notaría): sin cartola, el pago no se puede ver.
    // deno-lint-ignore no-explicit-any
    const cobG = (Array.isArray(cobertura) ? cobertura : []).filter((x: any) => x.rol === "gastos").map((x: any) => String(x.hasta || "").slice(0, 10)).sort().pop() || null;

    // ── Formato A de «Tu semana»: tarjetas en doble columna (cifra, una línea, botón). El detalle está en la app.
    const NV = "#003C50", HAIR = "#E4E8EB", INK = "#3D3D3D", MUT = "#537281", FAINT = "#99ABB4", AMB = "#854F0B", RED = "#A32D2D", GRN = "#0F6E56", SOFTBG = "#F5F7F9";
    const tile = (tit: string, cifra: string, linea: string, accion: string, ir: string, col = INK) => `<td valign="top" width="50%" style="padding:5px;"><div style="background:${SOFTBG};border-radius:12px;padding:12px 13px;">` +
      `<div style="font-size:10.5px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:${NV};">${esc(tit)}</div>` +
      `<div style="font-size:20px;font-weight:800;color:${col};margin-top:4px;">${cifra}</div>` +
      `<div style="font-size:11.5px;color:${MUT};margin-top:1px;">${linea}</div>` +
      `<div style="margin-top:7px;"><a href="${APP}/?ir=${ir}" style="font-size:12px;font-weight:700;color:${NV};text-decoration:none;">${esc(accion)} &rarr;</a></div></div></td>`;
    const suma = (xs: { amount: number }[]) => xs.reduce((s: number, e: { amount: number }) => s + (Number(e.amount) || 0), 0);
    const t: string[] = [];
    const porLiq = nl.pagables.length + nl.sinCliente.length;   // misma cifra que la tarjeta «Notaría» de «Tu semana» de quien liquida
    t.push(tile("Por pagar", fm(a.total), `${a.pend.length} OT${porLiq ? ` · ${porLiq} por liquidar` : ""}`, "Ver la deuda", "notaria"));
    if (a.sinFondo60.length) t.push(tile("Esperan fondos", fm(suma(a.sinFondo60)), `${a.sinFondo60.length} OT con más de 60 días`, "Pedir fondos", "rendir", RED));
    const liq = a.ultimaLiq;
    if (liq) {
      const f = String(liq.created_at || "").slice(0, 10);
      const [lin, col] = liq.movimiento_id ? [`${dmy(f)} · pagada`, GRN]
        : (!cobG || cobG < f) ? [`${dmy(f)} · falta la cartola`, AMB]
        : [`${dmy(f)} · <b style="color:${RED};">sin pago en la cartola</b>`, RED];
      t.push(tile("Última liquidación", fm(liq.total), lin, "Abrir Banco", "cobros", col === GRN ? INK : col));
    }
    if (a.fuera.length) t.push(tile("Por confirmar", fm(a.fuera.reduce((s: number, x: { e: { amount: number } }) => s + (Number(x.e.amount) || 0), 0)), `${a.fuera.length} OT sobre 3 veces lo habitual`, "Revisar OT", "notaria", AMB));
    const filasT: string[] = []; for (let i = 0; i < t.length; i += 2) filasT.push(`<tr>${t[i]}${t[i + 1] || '<td width="50%"></td>'}</tr>`);
    const lunes = (() => { const d = new Date(hoy + "T12:00:00"); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); })();
    const asunto = `Notaría · semana del ${dmy(lunes)}`;
    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;background:#ECEFF1;padding:22px 10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 26px rgba(0,44,64,.09);">
  <div style="background:${NV};padding:20px 28px;text-align:center;"><img src="${APP}/le-logo-blanco.png" alt="Liberona Escala Abogados" height="28" width="184" style="height:28px;width:184px;display:inline-block;border:0;"/></div>
  <div style="padding:24px 17px 18px;">
    <div style="padding:0 5px;"><div style="font-size:18px;color:${INK};font-weight:700;">${esc(holaEquipo(para, miembros))}</div>
    <div style="font-size:12.5px;color:${MUT};margin:4px 0 16px;">Notaría · semana del ${dmy(lunes)}</div></div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${filasT.join("")}</table>
  </div>
  <div style="padding:14px 26px;border-top:1px solid ${HAIR};text-align:center;"><div style="font-size:11px;color:${FAINT};">gestion.leabogados.cl · Liberona Escala Abogados</div></div>
</div></body></html>`;
    void docs;   // documentos por clasificar: van en «Tu semana» de quien liquida la notaría
    const res = { ok: true, ot: a.pend.length, total: a.total, pagables: nl.pagables.length, esperan60: a.sinFondo60.length, por_confirmar: a.fuera.length, cartola_gastos: cobG, demora: a.demora };
    if (body.dryRun) return json({ ...res, dryRun: true, subject: asunto, para, html });
    if (cfgV("notaria_analisis").trim().toLowerCase() !== "on") return json({ ...res, enviado: false, motivo: "interruptor apagado (learnings config notaria_analisis != on)" });
    const to = body.testTo ? [String(body.testTo)] : para;
    if (!to.length) return json({ ...res, enviado: false, motivo: "sin destinatarios" });
    const client = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: GMAIL_USER, password: GMAIL_PASS } } });
    await client.send({ from: `Liberona Escala Abogados <${GMAIL_USER}>`, to, subject: toAscii(asunto), content: toAscii(`Notaria: ${a.pend.length} OT por pagar, ${fm(a.total)}.`), html: html.replace(/[ \t]+$/gm, "") });
    await client.close();
    return json({ ...res, enviado: true, to });
  } catch (e) { return json({ error: String((e as Error).message || e) }, 500); }
});
