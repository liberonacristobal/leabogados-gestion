// aviso-fondos — correo diario (19:00) al abogado a cargo cuando un cliente suyo tiene gastos sin fondos.
// Dos disparadores por cliente con saldo < 0 (fondos − gastos, misma regla que la app: sin no_descuenta_saldo ni apertura):
//   · carga       — ese día se cargó un gasto al cliente.
//   · seguimiento — pasaron 15 días desde el último aviso, sin solicitud de fondos (fund_requests) ni depósito.
// Contador "aviso N°": avisos desde el último fondo del cliente (tabla avisos_fondos; si no hay historial, se siembra con los
// días con gastos desde ese fondo). Vuelve a cero cuando entra un fondo. Desde el aviso N° 4 va con copia al otro socio.
// Se salta: oficina, clientes terminados, pausados ("Ya lo hablé", learnings aviso_fondos_pausa) y con solicitud < 15 días.
//
// Auth: cron con body.secret === CRON_SECRET, o JWT @leabogados.cl. Interruptor learnings config `aviso_fondos` ('on' para
// enviar en cron; por defecto apagado). body.dryRun devuelve el html sin enviar; body.testTo envía solo ahí y no guarda
// historial; body.fecha (YYYY-MM-DD) simula el día de carga.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { selectAll } from "../_shared/paginar.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const APP = "https://gestion.leabogados.cl";

const SOCIOS: Record<string, string> = { "Cristóbal": "cl@leabogados.cl", "Erasmo": "ee@leabogados.cl" };
const OTRO: Record<string, string> = { "Cristóbal": "Erasmo", "Erasmo": "Cristóbal" };
const CC_DESDE = 4;          // después del tercer aviso, copia al otro socio
const SEGUIMIENTO_DIAS = 15;

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fm = (n: number) => "$" + Math.round(n || 0).toLocaleString("es-CL");
const dmy = (iso?: string | null) => iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : "sin fecha";
const localDate = (ts?: string | null) => ts ? new Date(ts).toLocaleDateString("en-CA", { timeZone: "America/Santiago" }) : "";
const diasEntre = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const N = (v: unknown) => Number(v) || 0;

// Etiqueta corta y legible para una fila de gasto (sin "…": se corta en palabra).
function etiqueta(e: Record<string, unknown>) {
  let t = String(e.concept || e.description || e.category || "Gasto").replace(/\s+/g, " ").trim();
  t = t.replace(/^Gastos notariales\s*—\s*/i, "");
  if (t.includes(" — ")) t = t.split(" — ")[0];
  if (t === t.toUpperCase()) t = t.charAt(0) + t.slice(1).toLowerCase();
  if (t.length > 24) { t = t.slice(0, 24); t = t.slice(0, t.lastIndexOf(" ") > 10 ? t.lastIndexOf(" ") : 24); }
  const ot = /\d/.test(String(e.ot_number || "")) ? ` · OT ${e.ot_number}` : "";
  return esc(t) + ot;
}
// Quién cargó el gasto: created_by guarda el nombre (equipo) o el correo (socios); sin autor + OT = vino del estado de la notaría.
const NOMBRE_DE: Record<string, string> = { "cl@leabogados.cl": "Cristóbal", "ee@leabogados.cl": "Erasmo", "mc@leabogados.cl": "Martín", "mp@leabogados.cl": "Martina", "rd@leabogados.cl": "Rodrigo" };
const quienCargo = (e: Record<string, unknown>) => { const by = String(e.created_by || "").trim(); if (by) return NOMBRE_DE[by.toLowerCase()] || by; return /\d/.test(String(e.ot_number || "")) ? "la notaría" : ""; };
const unir = (xs: string[]) => xs.length <= 1 ? (xs[0] || "") : xs.slice(0, -1).join(", ") + " y " + xs[xs.length - 1];
const esNotaPend = (e: Record<string, unknown>) => e.category === "Notaria" && /\d/.test(String(e.ot_number || "")) && !e.notaria_render_id && !e.notaria_liquidado_at;

async function enviar(to: string, cc: string | undefined, subject: string, html: string) {
  const r = await fetch(`${SB_URL}/functions/v1/notify-task`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + SB_KEY },
    body: JSON.stringify({ mail: { to, cc, subject, html } }),
  });
  if (!r.ok) throw new Error("notify-task " + r.status + ": " + (await r.text()).slice(0, 200));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = await req.json(); } catch { /* cron sin body */ }

  const sb = createClient(SB_URL, SB_KEY);
  const esCron = !!CRON_SECRET && body.secret === CRON_SECRET;
  if (!esCron) {
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await sb.auth.getUser(jwt);
    if (!String(u?.user?.email || "").toLowerCase().endsWith("@leabogados.cl")) return json({ error: "No autorizado" }, 403);
  }
  const dryRun = !!body.dryRun;
  const testTo = typeof body.testTo === "string" ? body.testTo : null;

  try {
    if (esCron && !dryRun && !testTo) {
      const { data: cfg } = await sb.from("learnings").select("value,updated_at").eq("kind", "config").eq("key", "aviso_fondos").order("updated_at", { ascending: false }).limit(1);
      if (String(cfg?.[0]?.value || "off").toLowerCase() !== "on") return json({ ok: true, skipped: "apagado" });
    }
    // deno-lint-ignore no-explicit-any
    const pageAll = async (q: () => any) => { const r = await selectAll(q); if (r.error) throw new Error(r.error.message); return r.data; };
    const hoy: string = /^\d{4}-\d{2}-\d{2}$/.test(String(body.fecha || "")) ? body.fecha : new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });

    const clients = await pageAll(() => sb.from("clients").select("id,name,status,is_internal,abogado_responsable").order("id"));
    const sales = await pageAll(() => sb.from("sales").select("client_id,responsible,created_at").order("id"));
    const exps = await pageAll(() => sb.from("expenses").select("id,client_id,type,amount,date,created_at,created_by,category,concept,description,ot_number,no_descuenta_saldo,apertura_id,deleted_at,notaria_render_id,notaria_liquidado_at").not("client_id", "is", null).is("deleted_at", null).is("apertura_id", null).order("id"));
    const frs = await pageAll(() => sb.from("fund_requests").select("client_id,enviada_at,monto").order("id"));
    const hist = await pageAll(() => sb.from("avisos_fondos").select("client_id,fecha,tipo,n").order("id"));
    const { data: pausas } = await sb.from("learnings").select("key,value,updated_at").eq("kind", "aviso_fondos_pausa");

    // deno-lint-ignore no-explicit-any
    const respDe: Record<string, string> = {};
    for (const s of [...sales].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))) if (s.responsible && s.client_id && !respDe[s.client_id]) respDe[s.client_id] = s.responsible;
    // deno-lint-ignore no-explicit-any
    const porCli: Record<string, any[]> = {};
    for (const e of exps) (porCli[e.client_id] ||= []).push(e);

    // deno-lint-ignore no-explicit-any
    const items: any[] = [];
    // deno-lint-ignore no-explicit-any
    const negPorAbg: Record<string, { n: number; total: number }> = {};
    for (const c of clients) {
      if (c.is_internal || /liberona\s+escala/i.test(c.name || "") || c.status === "Terminado") continue;
      const es = porCli[c.id] || [];
      const fondos = es.filter((e) => e.type === "fondo" && !e.no_descuenta_saldo);
      const gastos = es.filter((e) => e.type !== "fondo" && !e.no_descuenta_saldo);
      const fondosT = fondos.reduce((a, e) => a + N(e.amount), 0);
      const saldo = fondosT - gastos.reduce((a, e) => a + N(e.amount), 0);
      if (saldo > -1) continue;
      const abg = c.abogado_responsable || respDe[c.id] || null;
      const dest = abg && SOCIOS[abg] ? abg : "Cristóbal";   // clientes de abogados no socios o sin abogado → Cristóbal
      (negPorAbg[dest] ||= { n: 0, total: 0 }); negPorAbg[dest].n++; negPorAbg[dest].total += -saldo;

      // Pausa / solicitud reciente
      const pz = (pausas || []).filter((p) => String(p.key) === String(c.id)).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0];
      if (pz && String(pz.value || "") >= hoy) continue;
      const lastFondo = fondos.map((e) => String(e.date || "")).filter(Boolean).sort().pop() || "";
      const fr = frs.filter((r) => String(r.client_id) === String(c.id)).map((r) => localDate(r.enviada_at)).filter(Boolean).sort().pop() || "";
      const frVigente = fr && fr > lastFondo ? fr : "";
      if (frVigente && diasEntre(frVigente, hoy) < SEGUIMIENTO_DIAS) continue;

      // Gastos sin fondos (FIFO: los fondos cubren primero lo más antiguo)
      const ord = [...gastos].sort((a, b) => String(a.date || "0000").localeCompare(String(b.date || "0000")) || String(a.created_at).localeCompare(String(b.created_at)));
      let acum = 0; const sinF: { e: Record<string, unknown>; sf: number }[] = [];
      for (const e of ord) { acum += N(e.amount); const sf = Math.min(N(e.amount), acum - fondosT); if (sf > 0 && N(e.amount) > 0) sinF.push({ e, sf }); }
      const desde = sinF.map((x) => String(x.e.date || "")).filter(Boolean).sort()[0] || "";

      // Disparador y contador
      const cargaHoy = gastos.filter((e) => localDate(e.created_at) === hoy && N(e.amount) > 0);
      const h = hist.filter((r) => String(r.client_id) === String(c.id) && String(r.fecha) > lastFondo && String(r.fecha) < hoy);
      const seed = [...new Set(gastos.map((e) => String(e.date || "")).filter((d) => d && d > lastFondo && d < hoy))].sort();
      const previos = h.length || seed.length;
      const ultimoAviso = h.length ? h.map((r) => String(r.fecha)).sort().pop()! : (seed.pop() || "");
      let tipo = "";
      if (cargaHoy.length) tipo = "carga";
      else if (!ultimoAviso || diasEntre(ultimoAviso, hoy) >= SEGUIMIENTO_DIAS) tipo = "seguimiento";
      if (!tipo) continue;

      // OT de notaría que no se pueden pagar por falta de fondos (misma regla que "Seleccionar con fondos")
      const pend = gastos.filter(esNotaPend).filter((e) => N(e.amount) > 1).sort((a, b) => String(a.date || "9999").localeCompare(String(b.date || "9999")) || String(a.ot_number).localeCompare(String(b.ot_number)));
      const disp = Math.max(0, fondosT - gastos.filter((e) => !esNotaPend(e)).reduce((a, e) => a + N(e.amount), 0));
      let used = 0; const otSin = pend.filter((e) => { if (used + N(e.amount) <= disp) { used += N(e.amount); return false; } return true; });

      items.push({ c, abg, dest, deuda: -saldo, sinF, desde, dias: desde ? diasEntre(desde, hoy) : null, lastFondo, ultFondoMonto: fondos.filter((e) => String(e.date || "") === lastFondo).reduce((a, e) => a + N(e.amount), 0), fr: frVigente, tipo, n: previos + 1, ultimoAviso, cargaHoy, otSin });
    }

    // ── Correo por socio
    const RED = "#C0392B", NAVY = "#003C50", MUT = "#537281", TXT = "#3D3D3D", LINE = "#E4E8EB", SOFT = "#F5F7F9";
    const chip = (d: number | null) => { if (d == null) return ""; const [bg, fg] = d > 90 ? ["#F7C1C1", "#791F1F"] : d > 60 ? ["#FAECE7", "#B5433F"] : d > 30 ? ["#FAEEDA", "#854F0B"] : ["#E1F5EE", "#0F6E56"]; return `<span style="display:inline-block;background:${bg};color:${fg};font-size:12px;font-weight:700;border-radius:20px;padding:3px 10px;white-space:nowrap;">${d} días</span>`; };
    const fila = (izq: string, der: string, rojo = false) => `<tr><td style="padding:3px 0;font-size:12.5px;white-space:nowrap;color:${rojo ? RED : MUT};${rojo ? "font-weight:700;" : ""}">${izq}</td><td style="padding:3px 0 3px 10px;font-size:12.5px;color:${rojo ? RED : TXT};text-align:right;white-space:nowrap;">${der}</td></tr>`;
    const quienes = (es: Record<string, unknown>[]) => unir([...new Set(es.map(quienCargo).filter(Boolean))]);
    // deno-lint-ignore no-explicit-any
    const bloque = (it: any) => {
      const solicitud = it.fr ? `${dmy(it.fr)} · sin depósito` : "No enviada";
      const facts = fila("Aviso", `N° ${it.n}`, it.n >= CC_DESDE) + fila("Solicitud de fondos", solicitud, true)
        + fila("Último fondo", it.lastFondo ? `${fm(it.ultFondoMonto)} · ${dmy(it.lastFondo)}` : "Nunca")
        + (it.tipo === "seguimiento" && it.ultimoAviso ? fila("Último aviso", dmy(it.ultimoAviso)) : "")
        + (it.otSin.length ? fila("OT Lascar sin pagar", `${it.otSin.length} · ${fm(it.otSin.reduce((a: number, e: Record<string, unknown>) => a + N(e.amount), 0))}`, true) : "")
        + (it.abg && it.abg !== it.dest ? fila("Responsable", esc(it.abg)) : "");
      const hoyBox = it.cargaHoy.length ? `<div style="background:${SOFT};border-radius:8px;padding:8px 10px;margin-top:10px;"><div style="font-size:10.5px;letter-spacing:.5px;text-transform:uppercase;color:${MUT};font-weight:700;margin-bottom:3px;">Cargado hoy · ${dmy(hoy)}</div><table style="width:100%;border-collapse:collapse;">${it.cargaHoy.map((e: Record<string, unknown>) => `<tr><td style="padding:2px 0;font-size:12.5px;color:${TXT};white-space:nowrap;">${etiqueta(e)}</td><td style="padding:2px 0 2px 10px;font-size:12.5px;color:${TXT};text-align:right;white-space:nowrap;">${fm(N(e.amount))}</td></tr>`).join("")}</table>${quienes(it.cargaHoy) ? `<div style="font-size:11.5px;color:${MUT};margin-top:4px;">Cargó: ${esc(quienes(it.cargaHoy))}</div>` : ""}</div>` : "";
      const cc = it.n >= CC_DESDE ? `<div style="font-size:12px;color:${RED};text-align:center;margin-top:10px;">Copia a ${OTRO[it.dest]}: más de ${CC_DESDE - 1} avisos</div>` : "";
      return `<div style="border:1px solid ${LINE};border-radius:10px;padding:14px 16px;margin-bottom:14px;">
        <table style="width:100%;border-collapse:collapse;"><tr><td style="font-size:17px;font-weight:700;color:${NAVY};">${esc(it.c.name)}</td><td style="font-size:20px;font-weight:800;color:${RED};text-align:right;white-space:nowrap;">${fm(it.deuda)}</td></tr></table>
        ${it.desde ? `<table style="width:100%;border-collapse:collapse;margin-top:6px;"><tr><td style="font-size:13px;font-weight:700;color:${RED};white-space:nowrap;">Sin fondos desde ${dmy(it.desde)}</td><td style="text-align:right;">${chip(it.dias)}</td></tr></table>` : ""}
        <table style="width:100%;border-collapse:collapse;margin-top:10px;">${facts}</table>
        ${hoyBox}
        <a href="${APP}/?pedirfondos=${it.c.id}&monto=${Math.round(it.deuda)}" style="display:block;text-align:center;background:${NAVY};color:#fff;text-decoration:none;font-weight:700;border-radius:9px;padding:12px 14px;margin-top:14px;font-size:14px;">Pedir fondos a ${esc(it.c.name)}</a>
        <div style="text-align:center;margin-top:10px;font-size:12.5px;"><a href="${APP}/?cliente=${it.c.id}" style="color:${NAVY};">Ver ficha</a> &nbsp;&nbsp; <a href="${APP}/?pausafondos=${it.c.id}" style="color:${NAVY};">Conversado con el cliente</a></div>
        ${cc}
      </div>`;
    };

    const out: unknown[] = [];
    const destinos = [...new Set(items.map((i) => i.dest))].filter((d) => !Array.isArray(body.solo) || body.solo.includes(d));
    // Dos correos posibles por socio y día, nunca mezclados:
    //   · carga       — solo los clientes a los que se les cargó gasto hoy (uno solo, o juntos si son varios).
    //   · seguimiento — los que cumplen 15 días sin solicitud ni depósito, aunque hoy no se les haya cargado nada.
    for (const dest of destinos) {
      const delSocio = items.filter((i) => i.dest === dest).sort((a, b) => b.deuda - a.deuda);
      const neg = negPorAbg[dest] || { n: 0, total: 0 };
      for (const tipo of ["carga", "seguimiento"]) {
        const lista = delSocio.filter((i) => i.tipo === tipo);
        if (!lista.length) continue;
        const esSeg = tipo === "seguimiento";
        const top = [...lista].sort((a, b) => b.n - a.n)[0];
        const conCC = lista.some((i) => i.n >= CC_DESDE);
        const total = lista.reduce((a, i) => a + i.deuda, 0);
        // el asunto sale en ASCII (notify-task quita · y °)
        const subject = lista.length === 1
          ? `${esSeg ? "Seguimiento - " : ""}Aviso ${top.n} - ${top.c.name}: ${fm(top.deuda)} sin fondos`
          : `${esSeg ? "Seguimiento - " : ""}${lista.length} clientes sin fondos: ${fm(total)}`;
        const nG = lista.reduce((a, i) => a + i.cargaHoy.length, 0);
        const uno = lista.length === 1;
        const autores = [...new Set(lista.flatMap((i) => i.cargaHoy.map(quienCargo)).filter(Boolean))].sort((x, y) => (x === "la notaría" ? 1 : 0) - (y === "la notaría" ? 1 : 0));
        const quien = unir(autores), variosQ = autores.length > 1;
        const intro = esSeg
          ? (uno ? `<b>${esc(top.c.name)}</b> lleva 15 días o más sin fondos y sin solicitud de fondos.`
                 : `Estos <b>${lista.length} clientes</b> llevan 15 días o más sin fondos y sin solicitud de fondos.`)
          : (uno ? `Hoy ${quien ? `${esc(quien)} ${variosQ ? "cargaron" : "cargó"}` : (nG === 1 ? "se cargó" : "se cargaron")} ${nG === 1 ? "un gasto nuevo" : `${nG} gastos nuevos`} a <b>${esc(top.c.name)}</b>, sin fondos para cubrirlo${nG === 1 ? "" : "s"}.`
                 : `Hoy ${quien ? `${esc(quien)} ${variosQ ? "cargaron" : "cargó"}` : "se cargaron"} gastos nuevos a <b>${lista.length} clientes tuyos</b>, sin fondos para cubrirlos.`);
        // Seguimientos: una fila por cliente (el nombre abre la solicitud de fondos ya armada).
        const cuerpo = esSeg
          ? `<table style="width:100%;border-collapse:collapse;margin-bottom:14px;">${lista.map((i) => `<tr><td style="padding:7px 0;border-top:1px solid ${LINE};"><a href="${APP}/?pedirfondos=${i.c.id}&monto=${Math.round(i.deuda)}" style="font-size:13.5px;font-weight:700;color:${NAVY};text-decoration:none;">${esc(i.c.name)}</a><div style="font-size:11.5px;white-space:nowrap;color:${i.n >= CC_DESDE ? RED : MUT};">Aviso N° ${i.n}${i.dias != null ? ` · ${i.dias} días` : ""}${i.otSin.length ? ` · ${i.otSin.length} OT` : ""}</div></td><td style="padding:7px 0 7px 10px;border-top:1px solid ${LINE};text-align:right;white-space:nowrap;vertical-align:top;font-size:14px;font-weight:800;color:${RED};">${fm(i.deuda)}</td></tr>`).join("")}</table>`
          : lista.map(bloque).join("");
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family:Aptos,Calibri,Arial,Helvetica,sans-serif;background:#EEF1F3;margin:0;padding:16px;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid ${LINE};">
  <div style="background:${NAVY};padding:26px 24px;text-align:center;"><img src="${APP}/le-logo-blanco.png" alt="Liberona Escala Abogados" height="30" style="height:30px;display:inline-block;border:0;"/></div>
  <div style="padding:18px 20px 6px;color:${TXT};font-size:14px;line-height:1.45;">
    <p style="margin:0 0 10px;">Hola ${esc(dest)},</p>
    <p style="margin:0 0 14px;">${intro}</p>
    <table style="width:100%;border-collapse:collapse;background:#FBEDEC;border-radius:10px;margin-bottom:16px;"><tr>
      <td style="padding:12px 0 12px 14px;width:1%;white-space:nowrap;font-size:30px;font-weight:800;color:${RED};line-height:1;">N° ${top.n}</td>
      <td style="padding:12px 14px;font-size:13px;"><b style="color:${RED};">${esSeg ? "Seguimiento de 15 días" : "Aviso sobre " + esc(top.c.name)}</b><br/><span style="font-size:11.5px;color:${MUT};">${esSeg ? esc(top.c.name) + " · sin solicitud ni depósito" : top.fr ? "Solicitud sin depósito" : "Sin solicitud de fondos"}</span></td>
    </tr></table>
    ${cuerpo}
    <table style="width:100%;border-collapse:collapse;background:${SOFT};border-radius:10px;margin:4px 0 14px;"><tr><td style="padding:12px 14px;font-size:13px;">Tus clientes sin fondos</td><td style="padding:12px 14px;font-size:13px;font-weight:700;text-align:right;white-space:nowrap;">${neg.n} · ${fm(neg.total)}</td></tr></table>
  </div>
  <div style="border-top:1px solid ${LINE};padding:12px 22px 14px;font-size:11px;color:${MUT};">Liberona Escala Abogados</div>
</div></body></html>`;

        const to = testTo || SOCIOS[dest];
        const cc = testTo ? undefined : (conCC ? SOCIOS[OTRO[dest]] : undefined);
        const resumen = { dest, tipo, to, cc: conCC ? SOCIOS[OTRO[dest]] : null, subject, clientes: lista.map((i) => ({ cliente: i.c.name, n: i.n, deuda: Math.round(i.deuda), dias: i.dias, otSin: i.otSin.length })) };
        if (dryRun) { out.push({ ...resumen, html }); continue; }
        await enviar(to, cc, (testTo ? "[PRUEBA] " : "") + subject, html);
        out.push(resumen);
        if (!testTo) {
          const rows = lista.map((i) => ({ client_id: i.c.id, fecha: hoy, tipo: i.tipo, n: i.n, deuda: Math.round(i.deuda), enviado_a: to, cc: cc || null }));
          await sb.from("avisos_fondos").upsert(rows, { onConflict: "client_id,fecha" });
        }
      }
    }
    return json({ ok: true, hoy, dryRun, testTo, enviados: out.length, out });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
