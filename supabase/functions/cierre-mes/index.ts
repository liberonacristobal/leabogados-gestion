// Edge Function: cierre-mes
// Día 6 de cada mes: un solo correo a los socios con lo que falta para CERRAR el mes anterior, con enlace a cada cosa.
// Reemplaza el aviso «Cuotas sin facturar» del día 6 (misma regla de cuotas olvidadas: solo trabajos que ya facturan).
// Secciones (cada una con la misma definición que ya usa la app o los correos existentes):
//   1. Cuotas sin facturar: programadas que quedaron atrás de una cuota posterior ya emitida (cuotasOlvidadas / aviso del día 6).
//   2. Facturas del mes por cobrar: emitidas en el mes con saldo (montoFactura − máx(paid_amount, conciliado en banco)), como Cierre de mes.
//   3. Banco por conciliar: abonos y cargos del mes en estado «pendiente» (Banco › Conciliación).
//   4. Gastos del mes por rendir a clientes: gastos del mes cerrado aún sin rendir (regla de «Tu semana», acotada al mes: lo anterior
//      a la app es historia importada y no se arrastra al cierre).
//   5. Notaría: OT pendientes de liquidar y liquidaciones preparadas sin enviar (misma regla que «Tu semana» / Deuda de la app).
// Destinatarios: learnings config cierre_mes_avisar_a; si no hay, los socios (miembros admin, una dirección por persona).
// Interruptor learnings config aviso_cuotas = 'on' (el mismo del aviso anterior). body.per = 'AAAA-MM'; body.dryRun = devuelve el HTML
// sin enviar; body.testTo = enviar solo a esa dirección. Auth: CRON_SECRET. verify_jwt=false.

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { montoFactura } from "../_shared/saludDatos.js";
import { holaEquipo } from "../_shared/correoEquipo.js";

const ESTUDIO = "Liberona Escala Abogados";
const APP = "https://gestion.leabogados.cl";
const GMAIL_USER = Deno.env.get("GMAIL_USER") || "";
const GMAIL_PASS = Deno.env.get("GMAIL_PASS") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const mesNom = (per: string) => `${MESES[Number(per.slice(5, 7)) - 1]} ${per.slice(0, 4)}`;
const ymMas = (ym: string, n: number) => { const d = new Date(`${ym}-01T12:00:00`); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 7); };

const toAscii = (s: string) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[–—]/g, "-").replace(/[^\x20-\x7E]/g, "");
const qpSafe = (h: string) => String(h || "").replace(/[ \t]+$/gm, "");
const esc = (s: string) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const fmtCLP = (n: number) => "$" + Math.round(Number(n) || 0).toLocaleString("es-CL");
const nr = (r: string) => String(r || "").replace(/[.\s-]/g, "").toUpperCase();
const fmtRut = (r: string) => { const c = nr(r); if (c.length < 2) return String(r || ""); const dv = c.slice(-1); let num = c.slice(0, -1), out = ""; while (num.length > 3) { out = "." + num.slice(-3) + out; num = num.slice(0, -3); } return num + out + "-" + dv; };

const cuotaN = (c: string) => { const m = String(c || "").match(/(\d+)\s*(?:\/|-|de)\s*(\d+)/); return m ? { n: +m[1], tot: +m[2] } : null; };
const _MES: Record<string, number> = { enero: 1, ene: 1, febrero: 2, feb: 2, marzo: 3, mar: 3, abril: 4, abr: 4, mayo: 5, may: 5, junio: 6, jun: 6, julio: 7, jul: 7, agosto: 8, ago: 8, septiembre: 9, sept: 9, sep: 9, octubre: 10, oct: 10, noviembre: 11, nov: 11, diciembre: 12, dic: 12 };
function concPeriodo(c: string): string | null {
  const s = String(c || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
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
  if (!CRON_SECRET || (body.secret !== CRON_SECRET && bearer !== CRON_SECRET)) return json({ error: "No autorizado" }, 403);

  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());
  const per = /^\d{4}-\d{2}$/.test(String(body.per || "")) ? String(body.per) : ymMas(hoy.slice(0, 7), -1);
  const desde = `${per}-01`, hasta = `${ymMas(per, 1)}-01`;

  const [bills, sales, clients, ents, conc, movs, gastos, rends, cfg, miembros] = await Promise.all([
    sbAll("billing?select=id,sale_id,client_id,invoice_no,status,due,issued_at,concept,amount,paid_amount,billing_type,deleted_at,receptor_rut,entity_id&deleted_at=is.null"),
    sbAll("sales?select=id,title"), sbAll("clients?select=id,name,is_internal"), sbAll("client_entities?select=id,client_id,name,rut"),
    sbAll("conciliacion?select=factura_id,monto_aplicado&tipo_destino=eq.factura"),
    sbAll(`cartola_movimientos?select=id,tipo,monto,estado,es_interno,fecha&fecha=gte.${desde}&fecha=lt.${hasta}`),
    sbAll("expenses?select=id,client_id,type,amount,category,no_descuenta_saldo,client_rendered_at,notaria_render_id,notaria_liquidado_at,ot_number,date&deleted_at=is.null"),
    sbAll("rendiciones?select=tipo,estado_envio,anulada_at"),
    sbAll("learnings?select=key,value&kind=eq.config&key=in.(aviso_cuotas,cierre_mes_avisar_a,agente_casilla)"),
    sbAll("miembros?select=email,nombre,rol"),
  ]);
  const saleById = new Map(sales.map((s) => [String(s.id), s]));
  const cliById = new Map(clients.map((c) => [String(c.id), c]));
  const entById = new Map(ents.map((e) => [String(e.id), e]));
  // deno-lint-ignore no-explicit-any
  const entOf = (b: any) => {
    if (b.entity_id) { const e = entById.get(String(b.entity_id)); if (e) return e; }
    const rn = nr(b.receptor_rut); if (rn) { const e = ents.find((x) => String(x.client_id) === String(b.client_id) && nr(x.rut) === rn); if (e) return e; }
    return null;
  };

  // 1) Cuotas sin facturar — misma regla que el aviso anterior del día 6 (cuotasOlvidadas).
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Santiago" }));
  const nmNow = now.getFullYear() * 12 + (now.getMonth() + 1);
  const atrasoMeses = (due: string) => { const p = String(due || "").slice(0, 7).split("-"); if (p.length < 2 || !p[0] || !p[1]) return 0; return Math.max(0, nmNow - ((+p[0]) * 12 + (+p[1]))); };
  // deno-lint-ignore no-explicit-any
  const bySale = new Map<string, any[]>();
  for (const b of bills) { if (!b.sale_id || b.billing_type !== "honorarios") continue; const k = String(b.sale_id); let a = bySale.get(k); if (!a) { a = []; bySale.set(k, a); } a.push(b); }
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
      olv.push({ clientId: String(b.client_id || ""), cli: (c && c.name) || "-", venta: (s && s.title) || "-", rs: (e && e.name) || "", rut: (e && e.rut) || b.receptor_rut || "",
        cuota: x ? `Cuota ${x.n}/${x.tot}` : (b.concept || "cuota"), monto: Number(b.amount) || 0, venc: dmy(b.due), atraso: atrasoMeses(b.due) });
    }
  }
  const olvMonto = olv.reduce((a, o) => a + o.monto, 0);

  // 2) Facturas emitidas en el mes y su saldo (como Cierre de mes: montoFactura − máx(paid_amount, conciliado en banco)).
  const respaldo = new Map<string, number>();
  for (const c of conc) if (c.factura_id) respaldo.set(String(c.factura_id), (respaldo.get(String(c.factura_id)) || 0) + (Number(c.monto_aplicado) || 0));
  // El XML solo de las facturas emitidas en el mes (montoFactura = autoridad del DTE; la consulta general no lo trae por peso).
  const xmls = new Map((await sbAll(`billing?select=id,dte_xml&deleted_at=is.null&invoice_no=not.is.null&issued_at=gte.${desde}&issued_at=lt.${hasta}`)).map((x) => [String(x.id), x.dte_xml]));
  const emitMes = bills.filter((b) => b.invoice_no && b.status !== "Anulada" && b.billing_type !== "reembolso" && String(b.issued_at || "").slice(0, 7) === per).map((b) => ({ ...b, dte_xml: xmls.get(String(b.id)) || null }));
  // deno-lint-ignore no-explicit-any
  const saldo = (b: any) => ["Pagado", "Anulada"].includes(b.status) ? 0 : Math.max(0, montoFactura(b) - Math.max(Number(b.paid_amount) || 0, respaldo.get(String(b.id)) || 0));
  const porCobrar = emitMes.filter((b) => saldo(b) > 0);
  const facturadoMes = emitMes.reduce((a, b) => a + montoFactura(b), 0), porCobrarMonto = porCobrar.reduce((a, b) => a + saldo(b), 0);
  // 3) Banco del mes por conciliar.
  const pend = movs.filter((m) => (m.estado || "pendiente") === "pendiente" && !m.es_interno);
  const abPend = pend.filter((m) => m.tipo === "abono"), caPend = pend.filter((m) => m.tipo !== "abono");
  // 4) Gastos DEL MES por rendir a clientes (regla de «Tu semana» acotada al mes), sin el cliente interno de la oficina.
  const internos = new Set(clients.filter((c) => c.is_internal).map((c) => String(c.id)));
  const porRendir = gastos.filter((e) => e.type === "gasto" && !e.no_descuenta_saldo && !e.client_rendered_at && e.category !== "Apertura" && e.client_id && !internos.has(String(e.client_id)) && String(e.date || "") >= desde && String(e.date || "") < hasta);
  const prMonto = porRendir.reduce((a, e) => a + (Number(e.amount) || 0), 0), prCli = new Set(porRendir.map((e) => String(e.client_id))).size;
  // 5) Notaría (Deuda de la app): OT pendientes de liquidar + liquidaciones preparadas sin enviar.
  const otPend = gastos.filter((e) => e.type !== "fondo" && e.category === "Notaria" && /\d/.test(String(e.ot_number || "")) && !e.notaria_render_id && !e.notaria_liquidado_at && (Number(e.amount) || 0) > 1);
  const otMonto = otPend.reduce((a, e) => a + (Number(e.amount) || 0), 0);
  const liqSinEnviar = rends.filter((r) => r.tipo === "notaria" && !r.anulada_at && r.estado_envio === "por_enviar").length;

  const items = [
    { k: "Cuotas sin facturar", n: olv.length, d: olv.length ? `${olv.length} cuota${olv.length !== 1 ? "s" : ""} de trabajos que ya facturan` : "al día", v: olv.length ? fmtCLP(olvMonto) : "", ir: "sinemitir", btn: "Ver el radar" },
    { k: `Facturas de ${MESES[Number(per.slice(5, 7)) - 1]} por cobrar`, n: porCobrar.length, d: emitMes.length ? `${porCobrar.length} de ${emitMes.length} emitidas · facturado ${fmtCLP(facturadoMes)}` : "sin facturas emitidas en el mes", v: porCobrar.length ? fmtCLP(porCobrarMonto) : "", ir: "cierre", btn: "Ver el cierre" },
    { k: "Banco por conciliar", n: pend.length, d: pend.length ? `${abPend.length} abono${abPend.length !== 1 ? "s" : ""} y ${caPend.length} cargo${caPend.length !== 1 ? "s" : ""} del mes` : "al día", v: pend.length ? fmtCLP(pend.reduce((a, m) => a + Math.abs(Number(m.monto) || 0), 0)) : "", ir: "cobros", btn: "Ver el banco" },
    { k: `Gastos de ${MESES[Number(per.slice(5, 7)) - 1]} por rendir`, n: porRendir.length, d: porRendir.length ? `${porRendir.length} gasto${porRendir.length !== 1 ? "s" : ""} de ${prCli} cliente${prCli !== 1 ? "s" : ""}` : "al día", v: porRendir.length ? fmtCLP(prMonto) : "", ir: "gastos", btn: "Ver gastos" },
    { k: "Notaría", n: otPend.length + liqSinEnviar, d: otPend.length || liqSinEnviar ? [otPend.length ? `${otPend.length} OT por liquidar` : "", liqSinEnviar ? `${liqSinEnviar} liquidaci${liqSinEnviar !== 1 ? "ones" : "ón"} por enviar` : ""].filter(Boolean).join(" · ") : "al día", v: otPend.length ? fmtCLP(otMonto) : "", ir: "notaria", btn: "Ver notaría" },
  ];
  const nPend = items.filter((i) => i.n > 0).length;
  const cfgV = (k: string) => String(cfg.find((c) => c.key === k)?.value || "");
  const ON = cfgV("aviso_cuotas").trim().toLowerCase() === "on";
  const dom = cfgV("agente_casilla").split("@")[1] || "leabogados.cl";
  const porPersona = new Map<string, string>();
  for (const m of miembros.filter((m) => m.rol === "admin" && String(m.email || "").toLowerCase().endsWith("@" + dom))) {
    const k = String(m.nombre || "").trim().split(/\s+/)[0].toLowerCase(), em = String(m.email).toLowerCase(), ac = porPersona.get(k);
    if (!ac || em.length < ac.length) porPersona.set(k, em);
  }
  const destino = cfgV("cierre_mes_avisar_a") ? cfgV("cierre_mes_avisar_a").split(/[,;\s]+/).filter((x) => x.endsWith("@" + dom)) : [...porPersona.values()];

  // ── Shell estándar de la app (cartera-semanal / aviso del día 6).
  const NV = "#003C50", HAIR = "#EAEEF0", INK = "#1F2A30", MUT = "#66787F", FAINT = "#9DAEB4", RED = "#C0403E", AMB = "#9A6410", GRN = "#1D7A5A", REDBG = "#FBECEB", AMBBG = "#FAF0DA";
  const sec = (label: string, color: string) => `<div style="border-bottom:1px solid ${HAIR};padding-bottom:7px;margin:0 0 8px;"><span style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${color};">${esc(label)}</span></div>`;
  const gap = (h: number) => `<div style="height:${h}px;line-height:${h}px;font-size:1px;">&nbsp;</div>`;
  const filaItem = (i: typeof items[number], k: number) => `<tr><td valign="top" style="padding:10px 0;${k ? `border-top:1px solid ${HAIR};` : ""}"><div style="font-size:13.5px;font-weight:700;color:${INK};">${esc(i.k)}</div><div style="font-size:12px;color:${i.n ? MUT : GRN};margin-top:2px;">${esc(i.d)}${i.n ? ` &middot; <a href="${APP}/?ir=${i.ir}" style="color:${NV};font-weight:700;text-decoration:none;">${i.btn} &rarr;</a>` : ""}</div></td><td valign="top" align="right" style="padding:10px 0 10px 12px;white-space:nowrap;font-size:13.5px;font-weight:700;color:${i.n ? INK : GRN};${k ? `border-top:1px solid ${HAIR};` : ""}">${i.n ? i.v || String(i.n) : "&#10003;"}</td></tr>`;
  // deno-lint-ignore no-explicit-any
  const byCli: Record<string, any[]> = {};
  for (const o of olv) (byCli[o.cli] = byCli[o.cli] || []).push(o);
  const detalle = Object.entries(byCli).map(([cli, its]) => {
    const cid = its[0]?.clientId || "";
    const rows = its.slice().sort((a, b) => b.atraso - a.atraso).map((o, i) => {
      const col = o.atraso >= 2 ? RED : AMB, bg = o.atraso >= 2 ? REDBG : AMBBG, bt = i === 0 ? "" : `border-top:1px solid ${HAIR};`;
      const rsLine = [esc(o.venta), o.rs ? `<span style="color:${NV};font-weight:600;">${esc(o.rs)}</span>` : "", o.rut ? esc(fmtRut(o.rut)) : ""].filter(Boolean).join(" &middot; ");
      return `<tr><td valign="top" style="padding:9px 0;${bt}"><div style="font-size:13px;font-weight:700;color:${INK};">${esc(o.cuota)}${o.venc ? ` <span style="font-weight:400;color:${col};">&middot; venció ${o.venc}</span>` : ""}</div><div style="font-size:12px;color:${MUT};margin-top:2px;">${rsLine}</div></td><td valign="top" align="right" style="padding:9px 0 9px 12px;white-space:nowrap;${bt}"><span style="font-size:13px;font-weight:700;color:${INK};">${fmtCLP(o.monto)}</span><div style="margin-top:3px;"><span style="font-size:10.5px;font-weight:700;color:${col};background:${bg};border-radius:9px;padding:1px 7px;">${o.atraso} mes${o.atraso !== 1 ? "es" : ""}</span></div></td></tr>`;
    }).join("");
    const link = cid ? `<a href="${APP}/?cliente=${cid}" style="display:inline-block;margin-top:6px;font-size:12px;font-weight:700;color:${NV};text-decoration:none;">Ver ${esc(cli)} &rarr;</a>` : "";
    return `<div style="font-size:12.5px;font-weight:700;color:${NV};margin:0 0 2px;">${esc(cli)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>${link}${gap(16)}`;
  }).join("");
  const asunto = nPend ? `Cierre de ${mesNom(per)}: ${nPend} ${nPend === 1 ? "tema pendiente" : "temas pendientes"}` : `Cierre de ${mesNom(per)}: al día`;
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#ECEFF1;margin:0;padding:22px 12px;">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 26px rgba(0,44,64,.09);">
  <div style="background:#003C50;padding:20px 28px;text-align:center;"><img src="${APP}/le-logo-blanco.png" alt="${ESTUDIO}" height="28" width="184" style="height:28px;width:184px;display:inline-block;border:0;"/></div>
  <div style="padding:26px 26px 20px;">
    <div style="font-size:18px;color:${INK};font-weight:700;letter-spacing:-.2px;">Cierre de ${esc(mesNom(per))}</div>
    <div style="font-size:12.5px;color:${MUT};margin-top:6px;margin-bottom:18px;line-height:1.55;">${esc(holaEquipo(destino, miembros))}. ${nPend ? `Esto es lo que falta para cerrar ${esc(mesNom(per))}:` : `${esc(mesNom(per))} está al día.`}</div>
    ${sec("Por cerrar", NV)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${items.map(filaItem).join("")}</table>
    ${olv.length ? gap(22) + sec("Cuotas sin facturar", AMB) + detalle : ""}
  </div>
  <div style="padding:16px 26px;border-top:1px solid ${HAIR};text-align:center;"><div style="font-size:11px;color:${FAINT};">gestion.leabogados.cl &middot; ${ESTUDIO}</div></div>
</div></body></html>`;

  const res = { ok: true, per, pendientes: nPend, items: items.map(({ k, n, d, v }) => ({ k, n, d, v })), cuotas: olv.length };
  if (body.dryRun) return json({ ...res, dryRun: true, subject: asunto, html, para: destino });
  if (!ON) return json({ ...res, enviado: false, motivo: "interruptor apagado (learnings config aviso_cuotas != on)" });
  const to = body.testTo ? [String(body.testTo)] : destino;
  if (!to.length) return json({ ...res, enviado: false, motivo: "sin destinatarios" });
  try {
    const client = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: GMAIL_USER, password: GMAIL_PASS } } });
    await client.send({ from: `${ESTUDIO} <${GMAIL_USER}>`, to, subject: toAscii(asunto), content: `Cierre de ${mesNom(per)}: ${items.map((i) => `${i.k}: ${i.d}${i.v ? ` (${i.v})` : ""}`).join(" | ")}`, html: qpSafe(html) });
    await client.close();
    await fetch(`${SB_URL}/rest/v1/activity_log`, { method: "POST", headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ user_email: "agente", action: "cierre_mes.enviado", table_name: "billing", record_id: null, estudio_id: "lea", detail: { title: `Correo de cierre de ${mesNom(per)} enviado`, para: to, pendientes: nPend } }) }).catch(() => null);
    return json({ ...res, enviado: true, to });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
