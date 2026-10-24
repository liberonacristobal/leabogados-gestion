// Edge Function: notaria-analisis
// Agente de análisis de la notaría: cada lunes, un correo INTERNO (a learnings config notaria_analisis_avisar_a) con el estado de
// las OT por pagar, lo que se sale de lo habitual y lo que la historia enseña. Solo analiza: no registra, no paga ni escribe a la
// notaría. Las cifras salen de la regla única analisisNotaria (../_shared/notariaReglas.js), la misma de Gastos › Notaría.
// Interruptor learnings config notaria_analisis = 'on'. Auth: CRON_SECRET. body.dryRun = devuelve el HTML sin enviar.

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { analisisNotaria } from "../_shared/notariaReglas.js";
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
async function todas(path: string): Promise<any[]> {
  const p2 = /[?&]order=/.test(path) ? path : `${path}${path.includes("?") ? "&" : "?"}order=id.asc`;
  // deno-lint-ignore no-explicit-any
  const out: any[] = [];
  for (let i = 0; i < 60; i++) {
    const r = await fetch(`${SB_URL}/rest/v1/${p2}`, { headers: { ...H, Range: `${i * 1000}-${i * 1000 + 999}` } });
    if (!r.ok) throw new Error(`${path.split("?")[0]}: ${r.status}`);
    const p = await r.json(); out.push(...p); if (p.length < 1000) break;
  }
  return out;
}

Deno.serve(async (req) => {
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* cron */ }
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!CRON_SECRET || (body.secret !== CRON_SECRET && bearer !== CRON_SECRET)) return json({ error: "No autorizado" }, 403);
  try {
    const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
    const [expenses, rendiciones, clients, docs, cfg, miembros, ultMov] = await Promise.all([
      todas("expenses?select=id,client_id,type,category,ot_number,amount,date,concept,materia,notaria_render_id,notaria_liquidado_at,rendered_at,no_descuenta_saldo,apertura_id,deleted_at&deleted_at=is.null"),
      todas("rendiciones?select=id,tipo,created_at,anulada_at,movimiento_id,total,sent_at"),
      todas("clients?select=id,name,is_internal"),
      todas("documentos_notaria?select=id,estado&estado=in.(por_clasificar,pendiente_ot)"),
      todas("learnings?select=id,key,value&kind=eq.config&key=in.(notaria_analisis,notaria_analisis_avisar_a)"),
      todas("miembros?select=email,nombre&order=email.asc"),
      fetch(`${SB_URL}/rest/v1/cartola_movimientos?select=fecha&order=fecha.desc&limit=1`, { headers: H }).then((r) => r.json()),
    ]);
    // deno-lint-ignore no-explicit-any
    const cli = (id: unknown) => (clients || []).find((c: any) => String(c.id) === String(id));
    // deno-lint-ignore no-explicit-any
    const esOficina = (cid: unknown) => { const c: any = cli(cid); return !!c && !!c.is_internal; };
    const a = analisisNotaria({ expenses, rendiciones, hoy, esOficina });
    // deno-lint-ignore no-explicit-any
    const nom = (id: unknown) => (cli(id) as any)?.name || "Sin cliente";
    const cfgV = (k: string) => String((cfg || []).find((c: { key: string }) => c.key === k)?.value || "");
    const para = cfgV("notaria_analisis_avisar_a").split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    const cartolaHasta = ultMov?.[0]?.fecha || null;
    const nPorClas = (docs || []).filter((d: { estado: string }) => d.estado === "por_clasificar").length, nPendOt = (docs || []).filter((d: { estado: string }) => d.estado === "pendiente_ot").length;

    // ── Molde del correo de marca (cierre-mes).
    const NV = "#003C50", HAIR = "#EAEEF0", INK = "#1F2A30", MUT = "#66787F", FAINT = "#9DAEB4", AMB = "#9A6410";
    const sec = (t: string, col = NV) => `<div style="border-bottom:1px solid ${HAIR};padding-bottom:7px;margin:0 0 8px;"><span style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${col};">${t}</span></div>`;
    const gap = `<div style="height:22px;line-height:22px;font-size:1px;">&nbsp;</div>`;
    const filas = (rows: [string, string, string, string?][]) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows.map(([t, s, m, col], i) => { const bt = i ? `border-top:1px solid ${HAIR};` : ""; return `<tr><td valign="top" style="padding:10px 0;${bt}"><div style="font-size:13.5px;font-weight:700;color:${INK};">${t}</div>${s ? `<div style="font-size:12px;color:${MUT};margin-top:2px;">${s}</div>` : ""}</td><td valign="top" align="right" style="padding:10px 0 10px 12px;white-space:nowrap;font-size:13.5px;font-weight:700;color:${col || INK};${bt}">${m}</td></tr>`; }).join("")}</table>`;
    const link = (t: string, q: string) => `<a href="${APP}/${q}" style="color:${NV};font-weight:700;text-decoration:none;">${t} &rarr;</a>`;

    const liq = a.ultimaLiq;
    const nOtLiq = liq ? expenses.filter((e: { notaria_render_id: string }) => String(e.notaria_render_id) === String(liq.id)).length : 0;
    const estado: [string, string, string, string?][] = [
      ["OT por pagar a la notaría", `${a.pend.length} OT de ${a.nClientes} clientes &middot; ${link("Ver notaría", "?ir=notaria")}`, fm(a.total)],
      ["Fondo de clientes para esas OT", `${a.clientes.filter((c: { disp: number; oficina: boolean }) => !c.oficina && c.disp > 0).length} clientes con fondo disponible`, fm(a.cubre)],
    ];
    if (liq) estado.push([`Liquidación del ${dmy(liq.created_at)}`, `${nOtLiq} OT &middot; ${liq.sent_at ? "enviada" : "sin enviar"} &middot; ${liq.movimiento_id ? "pagada" : `sin pago en la cartola${cartolaHasta ? ` al ${dmy(cartolaHasta)}` : ""}`}`, fm(liq.total), liq.movimiento_id ? INK : AMB]);

    const conf: [string, string, string, string?][] = [];
    if (a.largas.length) { const l0 = a.largas[0]; conf.push([`${a.largas.length} OT con más de ${a.demora.max} días por pagar`, `más que la liquidación más lenta desde que existe la app &middot; la más antigua, OT ${esc(String(l0.ot_number))} del ${dmy(l0.date)}`, fm(a.largas.reduce((s: number, e: { amount: number }) => s + (Number(e.amount) || 0), 0))]); }
    a.sinFondo.slice(0, 4).forEach((c: { cid: string; ots: unknown[]; ot: number; fondo: number }) => conf.push([`${esc(nom(c.cid))} &middot; ${c.ots.length} OT sin fondo disponible`, c.fondo > 0 ? "fondo depositado ya usado" : "nunca ha depositado fondos", fm(c.ot)]));
    if (a.sinFondo.length > 4) conf.push([`${a.sinFondo.length - 4} clientes más sin fondo disponible`, "", fm(a.sinFondo.slice(4).reduce((s: number, c: { ot: number }) => s + c.ot, 0))]);
    // deno-lint-ignore no-explicit-any
    a.fuera.forEach((x: any) => conf.push([`OT ${esc(String(x.e.ot_number))} &middot; ${esc(x.tipo.toLowerCase())}`, `${esc(nom(x.e.client_id))} &middot; lo habitual es ${fm(x.med)} &middot; confirmar con la OT`, fm(x.e.amount)]));
    if (nPorClas || nPendOt) conf.push([`${nPorClas} documentos de la notaría por clasificar`, nPendOt ? `${nPendOt} esperan su OT` : "", ""]);

    const reglas: [string, string, string, string?][] = [
      ["1. Cliente de la OT por el RUT de la sociedad", "nunca por el RUT de un abogado del estudio", ""],
      ["2. Liquidación preparada los días 15 y 30", "con las OT que cubre el fondo del cliente &middot; la revisa y la envía Martina", ""],
      ["3. Solicitud de fondos a los 60 días sin fondo", `hoy: ${a.sinFondo60.length} OT por ${fm(a.sinFondo60.reduce((s: number, e: { amount: number }) => s + (Number(e.amount) || 0), 0))}`, ""],
      ["4. OT por confirmar antes de liquidar", "monto mayor a 3 veces lo habitual del acto", ""],
      ["5. Aviso de liquidación sin pago a los 10 días", "el enlace del pago a su liquidación ya existe", ""],
    ];
    const tops = a.actos.filter((x: { tipo: string; n: number }) => x.tipo !== "Otro" && x.n >= 15).slice(0, 4);
    const aprend: [string, string, string, string?][] = [
      ["Demora de pago de una OT", `mediana desde que existe la app &middot; la mitad entre ${a.demora.p25} y ${a.demora.p75} días &middot; ${a.demora.n} OT`, `${a.demora.mediana} días`],
      // deno-lint-ignore no-explicit-any
      ...tops.map((x: any) => [esc(x.tipo), `${x.n} OT &middot; entre ${fm(x.min)} y ${fm(x.max)}`, fm(x.mediana)] as [string, string, string]),
    ];
    const lunes = (() => { const d = new Date(hoy + "T12:00:00"); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); })();
    const asunto = `Análisis de la notaría · semana del ${dmy(lunes)}`;
    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#ECEFF1;margin:0;padding:22px 12px;">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 26px rgba(0,44,64,.09);">
  <div style="background:#003C50;padding:20px 28px;text-align:center;"><img src="${APP}/le-logo-blanco.png" alt="Liberona Escala Abogados" height="28" width="184" style="height:28px;width:184px;display:inline-block;border:0;"/></div>
  <div style="padding:26px 26px 20px;">
    <div style="font-size:18px;color:${INK};font-weight:700;letter-spacing:-.2px;">Notaría: semana del ${dmy(lunes)}</div>
    <div style="font-size:12.5px;color:${MUT};margin-top:6px;margin-bottom:18px;line-height:1.55;">${esc(holaEquipo(para, miembros))}. Este es el análisis de la notaría de esta semana:</div>
    ${sec("Estado")}${filas(estado)}
    ${conf.length ? gap + sec("Por confirmar", AMB) + filas(conf) : ""}
    ${gap}${sec("Reglas propuestas")}${filas(reglas)}
    ${gap}${sec("Lo que la app aprendió")}${filas(aprend)}
  </div>
  <div style="padding:16px 26px;border-top:1px solid ${HAIR};text-align:center;"><div style="font-size:11px;color:${FAINT};">gestion.leabogados.cl &middot; Liberona Escala Abogados</div></div>
</div></body></html>`;
    const res = { ok: true, ot: a.pend.length, total: a.total, cubre: a.cubre, por_confirmar: conf.length, demora: a.demora };
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
