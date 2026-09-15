// Edge Function: aviso-cuotas-sin-facturar
// Cron día 6 de cada mes (facturamos entre el 1 y el 5): cuotas PROGRAMADAS que quedaron sin facturar porque se
// emitió una cuota POSTERIOR del mismo trabajo (Cuota N/M) o una glosa de mes posterior (concPeriodoOf). Avisa a
// los socios (cl@, ee@). Misma lógica que cuotasOlvidadas() del front. Cada fila trae proyecto + razón social + RUT
// (a quién facturar) + vencimiento, y un deep-link ?cliente=<id> que abre la ficha en Ventas (cotejo).
// Formato: shell estándar de la app (cartera-semanal). Interruptor learnings config aviso_cuotas='on' (default
// OFF=dry-run). Auth CRON_SECRET. Body opcional: {dryRun:true} devuelve el HTML sin enviar; {testTo:"x@.."} prueba.

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const ESTUDIO = "Liberona Escala Abogados";
const SOCIOS = ["cl@leabogados.cl", "ee@leabogados.cl"];
const APP = "https://gestion.leabogados.cl";
const GMAIL_USER = Deno.env.get("GMAIL_USER") || "";
const GMAIL_PASS = Deno.env.get("GMAIL_PASS") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || Deno.env.get("ALERTA_CARTOLA_SECRET") || "";
const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const toAscii = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[–—]/g, "-").replace(/[^\x20-\x7E]/g, "");
const qpSafe = (h: string) => String(h || "").replace(/[ \t]+$/gm, "");
const esc = (s: string) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const fmtCLP = (n: number) => "$" + Math.round(Number(n) || 0).toLocaleString("es-CL");
const nr = (r: string) => String(r || "").replace(/[.\s-]/g, "").toUpperCase();
const fmtRut = (r: string) => { const c = nr(r); if (c.length < 2) return String(r || ""); const dv = c.slice(-1); let num = c.slice(0, -1), out = ""; while (num.length > 3) { out = "." + num.slice(-3) + out; num = num.slice(0, -3); } return num + out + "-" + dv; };

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
const dmy = (iso: string) => { const p = String(iso || "").slice(0, 10).split("-"); return (p.length === 3) ? `${p[2]}-${p[1]}-${p[0]}` : ""; };

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

  const bills = await sbAll("billing?select=id,sale_id,client_id,invoice_no,status,due,issued_at,concept,amount,billing_type,deleted_at,receptor_rut,entity_id&deleted_at=is.null&billing_type=eq.honorarios");
  const sales = await sbAll("sales?select=id,title");
  const clients = await sbAll("clients?select=id,name");
  const ents = await sbAll("client_entities?select=id,client_id,name,rut");
  const saleById = new Map(sales.map((s) => [String(s.id), s]));
  const cliById = new Map(clients.map((c) => [String(c.id), c]));
  const entById = new Map(ents.map((e) => [String(e.id), e]));
  // deno-lint-ignore no-explicit-any
  const entOf = (b: any) => {
    if (b.entity_id) { const e = entById.get(String(b.entity_id)); if (e) return e; }
    const rn = nr(b.receptor_rut); if (rn) { const e = ents.find((x) => String(x.client_id) === String(b.client_id) && nr(x.rut) === rn); if (e) return e; }
    return null;
  };

  // deno-lint-ignore no-explicit-any
  const bySale = new Map<string, any[]>();
  for (const b of bills) { if (!b.sale_id) continue; const k = String(b.sale_id); let a = bySale.get(k); if (!a) { a = []; bySale.set(k, a); } a.push(b); }

  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Santiago" }));
  const nmNow = now.getFullYear() * 12 + (now.getMonth() + 1);
  const atrasoMeses = (due: string) => { const p = String(due || "").slice(0, 7).split("-"); if (p.length < 2 || !p[0] || !p[1]) return 0; return Math.max(0, nmNow - ((+p[0]) * 12 + (+p[1]))); };

  // deno-lint-ignore no-explicit-any
  const olv: any[] = [];
  for (const arr of bySale.values()) {
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
      if (n != null && maxN >= 0) hit = n < maxN;
      else { const p = concPeriodo(b.concept); hit = !!(p && maxPer && p < maxPer); }
      if (!hit) continue;
      const s = saleById.get(String(b.sale_id)); const c = cliById.get(String(b.client_id)); const e = entOf(b);
      olv.push({
        clientId: String(b.client_id || ""), cli: (c && c.name) || "-", venta: (s && s.title) || "-",
        rs: (e && e.name) || "", rut: (e && e.rut) || b.receptor_rut || "",
        cuota: x ? `Cuota ${x.n}/${x.tot}` : (b.concept || "cuota"), monto: Number(b.amount) || 0,
        venc: dmy(b.due), atraso: atrasoMeses(b.due),
      });
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

  // ── Shell estándar de la app (cartera-semanal) · formato B: tabla compacta con RS+RUT + deep-link por cliente ──
  const NV = "#003C50", HAIR = "#EAEEF0", INK = "#1F2A30", MUT = "#66787F", FAINT = "#9DAEB4", RED = "#C0403E", AMB = "#9A6410", REDBG = "#FBECEB", AMBBG = "#FAF0DA";
  const sec = (label: string, color: string) => `<div style="border-bottom:1px solid ${HAIR};padding-bottom:7px;margin:0 0 8px;"><span style="display:inline-block;width:3px;height:11px;background:${color};border-radius:2px;vertical-align:middle;margin-right:8px;"></span><span style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${color};vertical-align:middle;">${esc(label)}</span></div>`;
  const gap = (h: number) => `<div style="height:${h}px;line-height:${h}px;font-size:1px;">&nbsp;</div>`;
  const secciones = Object.entries(byCli).map(([cli, items]) => {
    const cid = items[0]?.clientId || "";
    const rows = items.slice().sort((a, b) => b.atraso - a.atraso).map((o, i) => {
      const col = o.atraso >= 2 ? RED : AMB, bg = o.atraso >= 2 ? REDBG : AMBBG, bt = i === 0 ? "" : `border-top:1px solid ${HAIR};`;
      const rsLine = [esc(o.venta), o.rs ? `<span style="color:${NV};font-weight:600;">${esc(o.rs)}</span>` : "", o.rut ? esc(fmtRut(o.rut)) : ""].filter(Boolean).join(" &middot; ");
      return `<tr><td valign="top" style="padding:9px 0;${bt}"><div style="font-size:13.5px;font-weight:700;color:${INK};">${esc(o.cuota)}${o.venc ? ` <span style="font-weight:400;color:${col};">&middot; venció ${o.venc}</span>` : ""}</div><div style="font-size:11.5px;color:${MUT};margin-top:3px;line-height:1.5;">${rsLine}</div></td><td valign="top" align="right" style="padding:9px 0 9px 10px;${bt}white-space:nowrap;"><div style="font-size:14px;font-weight:800;color:${INK};font-variant-numeric:tabular-nums;">${fmtCLP(o.monto)}</div><span style="display:inline-block;margin-top:5px;font-size:10.5px;font-weight:700;color:${col};background:${bg};border-radius:7px;padding:3px 9px;">${o.atraso} mes${o.atraso !== 1 ? "es" : ""}</span></td></tr>`;
    }).join("");
    const link = cid ? `<a href="${APP}/?cliente=${cid}" style="display:inline-block;margin-top:8px;font-size:12px;font-weight:700;color:${NV};text-decoration:none;">Ver ${esc(cli)} &rarr;</a>` : "";
    return sec(cli, NV) + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>` + link + gap(20);
  }).join("");

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#ECEFF1;margin:0;padding:22px 12px;">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 26px rgba(0,44,64,.09);">
  <div style="background:#003C50;padding:20px 28px;text-align:center;"><img src="${APP}/le-logo-blanco.png" alt="Liberona Escala Abogados" height="28" width="184" style="height:28px;width:184px;display:inline-block;border:0;"/></div>
  <div style="padding:26px 26px 20px;">
    <div style="font-size:18px;color:${INK};font-weight:700;letter-spacing:-.2px;">Cuotas sin facturar</div>
    <div style="font-size:12.5px;color:${MUT};margin-top:6px;margin-bottom:22px;line-height:1.55;">Se emitió una cuota posterior del mismo trabajo y estas quedaron atrás. <b style="color:${INK};font-weight:700;">${olv.length} cuota${olv.length !== 1 ? "s" : ""}</b> en ${nCli} cliente${nCli !== 1 ? "s" : ""} &middot; <b style="color:${INK};font-weight:700;">${fmtCLP(total)}</b>.</div>
    ${secciones}
  </div>
  <div style="padding:16px 26px;border-top:1px solid ${HAIR};text-align:center;"><div style="font-size:11px;color:${FAINT};">gestion.leabogados.cl &middot; Liberona Escala Abogados</div></div>
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
