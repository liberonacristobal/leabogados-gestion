// Edge Function: aviso-cuotas-sin-facturar
// Cron día 6 de cada mes (facturamos entre el 1 y el 5): detecta cuotas PROGRAMADAS que quedaron sin facturar
// porque se emitió una cuota POSTERIOR del mismo trabajo (el caso VKH: "cobré la 2ª sin la 1ª"), o una glosa de
// mes posterior ya se emitió (Eugenia: saltaron julio). Avisa a los socios (cl@, ee@) para no olvidar facturar.
// Fuente: billing (honorarios) agrupado por venta. Misma lógica que cuotasOlvidadas() del front (App.jsx) — señal
// por nº de cuota (Cuota N/M) o por PERÍODO de la glosa (concPeriodoOf), NUNCA por fecha de vencimiento (evita
// falsos positivos de numeraciones enredadas: Alejandro "Cobro 8", Javier "Cobro 1").
// SEGURIDAD: interruptor de envío en la base (learnings config aviso_cuotas = 'on'). Sin 'on' = dry-run (no envía).
// Auth: secreto compartido (CRON_SECRET / ALERTA_CARTOLA_SECRET). verify_jwt=false.

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const ESTUDIO = "Liberona Escala Abogados";
const SOCIOS = ["cl@leabogados.cl", "ee@leabogados.cl"];
const GMAIL_USER = Deno.env.get("GMAIL_USER") || "";           // = contacto@leabogados.cl
const GMAIL_PASS = Deno.env.get("GMAIL_PASS") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || Deno.env.get("ALERTA_CARTOLA_SECRET") || "";
const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const toAscii = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[–—]/g, "-").replace(/[^\x20-\x7E]/g, "");
const qpSafe = (h: string) => String(h || "").replace(/[ \t]+$/gm, "");
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const fmtCLP = (n: number) => "$" + Math.round(Number(n) || 0).toLocaleString("es-CL");

// ── Espejo de los helpers del front ──
const cuotaN = (c: string) => { const m = String(c || "").match(/(\d+)\s*(?:\/|-|de)\s*(\d+)/); return m ? { n: +m[1], tot: +m[2] } : null; };
const _MES: Record<string, number> = { enero: 1, ene: 1, febrero: 2, feb: 2, marzo: 3, mar: 3, abril: 4, abr: 4, mayo: 5, may: 5, junio: 6, jun: 6, julio: 7, jul: 7, agosto: 8, ago: 8, septiembre: 9, sept: 9, sep: 9, octubre: 10, oct: 10, noviembre: 11, nov: 11, diciembre: 12, dic: 12 };
function concPeriodo(c: string): string | null {
  const s = String(c || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  let m = s.match(/\b(20\d{2})[-/](0?[1-9]|1[0-2])\b/); if (m) return `${m[1]}-${String(+m[2]).padStart(2, "0")}`;
  m = s.match(/\b(0?[1-9]|1[0-2])[-/](20\d{2})\b/); if (m) return `${m[2]}-${String(+m[1]).padStart(2, "0")}`;
  const ym = s.match(/\b(20\d{2})\b/);
  for (const k of Object.keys(_MES)) {
    const mm = s.match(new RegExp("\\b" + k + "\\b\\.?\\s*(20\\d{2}|\\d{2})?"));
    if (mm) { let y = mm[1] || (ym && ym[1]); if (!y) continue; if (String(y).length === 2) y = "20" + y; return `${y}-${String(_MES[k]).padStart(2, "0")}`; }
  }
  return null;
}

// deno-lint-ignore no-explicit-any
async function sbAll(path: string): Promise<any[]> {
  const out: any[] = []; let from = 0;
  while (true) {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Range-Unit": "items", Range: `${from}-${from + 999}` } });
    if (!r.ok) break;
    const chunk = await r.json();
    if (!Array.isArray(chunk)) break;
    out.push(...chunk);
    if (chunk.length < 1000) break;
    from += 1000; if (from > 60000) break;
  }
  return out;
}

Deno.serve(async (req) => {
  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = await req.json(); } catch { /* sin body */ }
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const esCron = !!CRON_SECRET && (body.secret === CRON_SECRET || bearer === CRON_SECRET);
  if (!esCron) return json({ error: "No autorizado" }, 403);

  const bills = await sbAll("billing?select=id,sale_id,client_id,invoice_no,status,due,issued_at,concept,amount,billing_type,deleted_at&deleted_at=is.null&billing_type=eq.honorarios");
  const sales = await sbAll("sales?select=id,title");
  const clients = await sbAll("clients?select=id,name");
  const saleById = new Map(sales.map((s) => [String(s.id), s]));
  const cliById = new Map(clients.map((c) => [String(c.id), c]));

  // agrupar billing por venta
  // deno-lint-ignore no-explicit-any
  const bySale = new Map<string, any[]>();
  for (const b of bills) { if (!b.sale_id) continue; const k = String(b.sale_id); let a = bySale.get(k); if (!a) { a = []; bySale.set(k, a); } a.push(b); }

  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Santiago" }));
  const nmNow = now.getFullYear() * 12 + (now.getMonth() + 1);
  const atrasoMeses = (due: string) => { const p = String(due || "").slice(0, 7).split("-"); if (p.length < 2 || !p[0] || !p[1]) return 0; return Math.max(0, nmNow - ((+p[0]) * 12 + (+p[1]))); };

  const olv: { cli: string; venta: string; cuota: string; monto: number; atraso: number }[] = [];
  for (const [sid, arr] of bySale) {
    const active = arr.filter((b) => b.status !== "Anulada" && b.billing_type !== "reembolso");
    const emit = active.filter((b) => b.invoice_no);
    if (!emit.length) continue;
    const emitNs = emit.map((b) => { const x = cuotaN(b.concept); return x ? x.n : null; }).filter((n) => n != null) as number[];
    const maxN = emitNs.length ? Math.max(...emitNs) : -1;
    const emitPers = emit.map((b) => concPeriodo(b.concept)).filter(Boolean) as string[];
    const maxPer = emitPers.length ? emitPers.slice().sort().slice(-1)[0] : "";
    for (const b of active) {
      if (b.invoice_no || b.status !== "Programada") continue;
      const x = cuotaN(b.concept); const n = x ? x.n : null;
      let hit = false;
      if (n != null && maxN >= 0) hit = n < maxN;                       // Cuota N/M: una cuota posterior ya emitida
      else { const p = concPeriodo(b.concept); hit = !!(p && maxPer && p < maxPer); }  // por glosa: mes posterior ya emitido
      if (!hit) continue;
      const s = saleById.get(sid); const c = cliById.get(String(b.client_id));
      olv.push({ cli: (c && c.name) || "—", venta: (s && s.title) || "—", cuota: x ? `Cuota ${x.n}/${x.tot}` : (b.concept || "cuota"), monto: Number(b.amount) || 0, atraso: atrasoMeses(b.due) });
    }
  }

  if (!olv.length) return json({ ok: true, olvidadas: 0 });

  // deno-lint-ignore no-explicit-any
  const byCli: Record<string, any[]> = {};
  for (const o of olv) { (byCli[o.cli] = byCli[o.cli] || []).push(o); }
  const total = olv.reduce((a, o) => a + o.monto, 0);
  const nCli = Object.keys(byCli).length;

  const cfg = await sbAll("learnings?select=value&kind=eq.config&key=eq.aviso_cuotas");
  const ON = String((cfg[0] && cfg[0].value) || "off").trim().toLowerCase() === "on";

  const asunto = olv.length === 1 ? "1 cuota quedo sin facturar" : `${olv.length} cuotas quedaron sin facturar`;

  // ── Shell de correo ESTÁNDAR de la app (mismo maquetado que cartera-semanal: tarjeta + header navy + logo remoto + footer). ──
  const NV = "#003C50", HAIR = "#EAEEF0", INK = "#1F2A30", MUT = "#66787F", FAINT = "#9DAEB4", RED = "#C0403E", AMB = "#9A6410", REDBG = "#FBECEB", AMBBG = "#FAF0DA";
  const sec = (label: string, color: string) => `<div style="border-bottom:1px solid ${HAIR};padding-bottom:7px;margin:0 0 10px;"><span style="display:inline-block;width:3px;height:11px;background:${color};border-radius:2px;vertical-align:middle;margin-right:8px;"></span><span style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${color};vertical-align:middle;">${toAscii(label)}</span></div>`;
  const gap = (h: number) => `<div style="height:${h}px;line-height:${h}px;font-size:1px;">&nbsp;</div>`;
  const secciones = Object.entries(byCli).map(([cli, items]) => {
    const rows = items.slice().sort((a, b) => b.atraso - a.atraso).map((o, i) => {
      const col = o.atraso >= 2 ? RED : AMB, bg = o.atraso >= 2 ? REDBG : AMBBG, bt = i === 0 ? "" : `border-top:1px solid ${HAIR};`;
      return `<tr><td valign="top" style="padding:10px 0;${bt}"><div style="font-size:14.5px;font-weight:600;color:${INK};line-height:1.4;">${toAscii(o.cuota)}</div><div style="font-size:12px;color:${MUT};margin-top:3px;">${toAscii(o.venta)} &middot; ${fmtCLP(o.monto)}</div></td><td valign="top" align="right" style="padding:10px 0 10px 10px;${bt}white-space:nowrap;"><span style="display:inline-block;font-size:10.5px;font-weight:700;color:${col};background:${bg};border-radius:7px;padding:4px 10px;">${o.atraso} mes${o.atraso !== 1 ? "es" : ""}</span></td></tr>`;
    }).join("");
    return sec(cli, NV) + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>` + gap(22);
  }).join("");
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#ECEFF1;margin:0;padding:22px 12px;">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 26px rgba(0,44,64,.09);">
  <div style="background:#003C50;padding:20px 28px;text-align:center;"><img src="https://gestion.leabogados.cl/le-logo-blanco.png" alt="Liberona Escala Abogados" height="28" width="184" style="height:28px;width:184px;display:inline-block;border:0;"/></div>
  <div style="padding:26px;">
    <div style="font-size:18px;color:${INK};font-weight:700;letter-spacing:-.2px;">Cuotas sin facturar</div>
    <div style="font-size:12.5px;color:${MUT};margin-top:6px;margin-bottom:24px;line-height:1.55;">Se emitio una cuota posterior del mismo trabajo y estas quedaron atras. <b style="color:${INK};font-weight:700;">${olv.length} cuota${olv.length !== 1 ? "s" : ""}</b> en ${nCli} cliente${nCli !== 1 ? "s" : ""} &middot; <b style="color:${INK};font-weight:700;">${fmtCLP(total)}</b>.</div>
    ${secciones}
    <div style="margin-top:2px;"><a href="https://gestion.leabogados.cl" style="display:inline-block;background:#003C50;color:#fff;text-decoration:none;padding:8px 15px;border-radius:8px;font-size:11.5px;font-weight:700;letter-spacing:.2px;">Abrir facturacion &rarr;</a></div>
  </div>
  <div style="padding:18px 26px;border-top:1px solid ${HAIR};text-align:center;"><div style="font-size:11px;color:${FAINT};">gestion.leabogados.cl &middot; Liberona Escala Abogados</div></div>
</div></body></html>`;

  if (body.dryRun) return json({ ok: true, olvidadas: olv.length, clientes: nCli, monto: total, dryRun: true, subject: asunto, html });
  if (!ON) return json({ ok: true, olvidadas: olv.length, clientes: nCli, monto: total, enviado: false, motivo: "interruptor apagado (learnings config aviso_cuotas != on) - dry-run", detalle: olv });

  const to = body.testTo ? String(body.testTo) : SOCIOS.join(", ");
  try {
    const client = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: GMAIL_USER, password: GMAIL_PASS } } });
    await client.send({ from: `${ESTUDIO} <${GMAIL_USER}>`, to, subject: toAscii(asunto), content: "Ver el contenido en formato HTML.", html: qpSafe(html) });
    await client.close();
    return json({ ok: true, olvidadas: olv.length, clientes: nCli, monto: total, enviado: true, to });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
