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
    const { data: billsRaw, error: billsErr } = await sb.from("billing").select("id,sale_id,amount,paid_amount,status,invoice_no,due,dte_estado,dte_track_id,dte_emitido_at,email_sent_at,deleted_at,client_id,concept").limit(6000);
    if (billsErr) return json({ error: "No se pudo leer billing: " + billsErr.message }, 500);
    const { data: movs } = await sb.from("cartola_movimientos").select("id,fecha,monto,tipo,cliente_id,estado,n_operacion").eq("tipo", "abono").is("cliente_id", null).limit(4000);
    // Radar "cuotas vencidas sin facturar": programadas de meses cerrados de ventas Activo, no silenciadas. Mismo criterio que el filter 'sinemitir' de la app.
    const { data: salesRaw } = await sb.from("sales").select("id,status").limit(6000);
    const { data: noEmitirRaw } = await sb.from("learnings").select("key").eq("kind", "cuota_no_emitir");
    // Cobranza a CAJA (plano abono/conciliación, igual que ingresosPorAnioVenta en la app — NO billing.paid_at): conciliación a factura/anticipo × abonos no internos, por fecha del depósito. + meta del año (annual_targets).
    const { data: concRaw } = await sb.from("conciliacion").select("movimiento_id,monto_aplicado,tipo_destino").in("tipo_destino", ["factura", "anticipo"]).limit(20000);
    const { data: abRaw } = await sb.from("cartola_movimientos").select("id,fecha,es_interno").eq("tipo", "abono").limit(20000);
    const { data: tgtRaw } = await sb.from("annual_targets").select("year,collection_target");

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

    // ── RADAR: cuotas vencidas sin facturar (firm-wide). Programadas de MESES CERRADOS (due < 1º del mes actual, >= vida de la app 2026-06-06) de ventas Activo, no silenciadas (learnings cuota_no_emitir). CANDIDATAS por revisar — el titular es el conteo, nunca "$ perdidos".
    const APP_START = "2026-06-06";
    const firstOfMonth = todayCL.slice(0, 7) + "-01";
    // deno-lint-ignore no-explicit-any
    const saleById: Record<string, any> = {}; (salesRaw || []).forEach((s: any) => { saleById[String(s.id)] = s; });
    const noEmitir = new Set((noEmitirRaw || []).map((r: Record<string, unknown>) => String(r.key)));
    // deno-lint-ignore no-explicit-any
    const sinEmitirN = vivos.filter((b: any) => b.status === "Programada" && b.sale_id && saleById[String(b.sale_id)]?.status === "Activo" && String(b.due || "") >= APP_START && String(b.due || "") < firstOfMonth && !noEmitir.has(String(b.id))).length;

    // ── COBRANZA a caja del año + semana (plano abono/conciliación) y META (annual_targets).
    const year = todayCL.slice(0, 4);
    // deno-lint-ignore no-explicit-any
    const abById: Record<string, any> = {}; (abRaw || []).forEach((m: any) => { if (m.es_interno !== true) abById[String(m.id)] = m; });
    let cobradoAno = 0, cobradoSemana = 0;
    // deno-lint-ignore no-explicit-any
    (concRaw || []).forEach((c: any) => { const m = abById[String(c.movimiento_id)]; if (!m) return; const f = String(m.fecha || "").slice(0, 10); if (!f) return; const mto = Number(c.monto_aplicado) || 0; if (f.slice(0, 4) === year) cobradoAno += mto; if (f >= hace7) cobradoSemana += mto; });
    // deno-lint-ignore no-explicit-any
    const metaCobranza = Number((tgtRaw || []).find((t: any) => String(t.year) === year)?.collection_target) || 0;
    const cobPct = metaCobranza > 0 ? Math.min(100, Math.round(cobradoAno / metaCobranza * 100)) : 0;

    // ── Cobros que VENCEN esta semana (próximos 7 días): emitidas Pendiente/Vencido con due en [hoy, hoy+7].
    const in7 = new Date(t0 + 7 * 86400000).toISOString().slice(0, 10);
    const venceSemArr = porCobrarB.filter((b: Record<string, unknown>) => String(b.due || "") >= todayCL && String(b.due || "") <= in7);
    const venceSemN = venceSemArr.length;
    const venceSem = venceSemArr.reduce((s: number, b: Record<string, unknown>) => s + saldo(b), 0);

    // ── 3) CLIENTES: abonos por identificar (sin cliente, pendientes)
    // deno-lint-ignore no-explicit-any
    const abonosSinCli = (movs || []).filter((m: any) => (m.monto || 0) > 0 && (m.estado || "pendiente") === "pendiente")
      .sort((a: Record<string, unknown>, b: Record<string, unknown>) => String(b.fecha || "").localeCompare(String(a.fecha || "")));

    // ── HTML helpers (marca LIBERONA ESCALA)
    const A = "#003C50", MUT = "#537281", DONE = "#99ABB4", RED = "#B5433F", AMB = "#9A6B12", GRN = "#177A5A";
    const fmtFecha = (d: string) => { try { return new Date(String(d).slice(0, 10) + "T00:00:00").toLocaleDateString("es-CL", { day: "numeric", month: "short" }); } catch { return String(d); } };
    // Íconos SVG line (sobrios). En Mail de iPhone/Apple Mail se ven; en clientes que bloquean SVG, la fila queda igual (solo sin ícono).
    const svgIco = (stroke: string, paths: string) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;">${paths}</svg>`;
    const ICO_TAREAS = `<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>`;
    const ICO_PROY = `<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>`;
    const ICO_CLI = `<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/>`;
    const ICO_FACT = `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h4"/>`;
    // Header de sección en TABLA (email-safe, sin flex): círculo tinte + ícono + título + conteo.
    const sec = (circleBg: string, icoSvg: string, titulo: string, chip: string, chipCol: string, inner: string) =>
      `<div style="padding:15px 0 6px;border-top:1px solid #F5F7F9;">
        <table style="width:100%;border-collapse:collapse;"><tr>
          <td style="width:30px;vertical-align:middle;"><span style="display:inline-block;width:30px;height:30px;border-radius:8px;background:${circleBg};text-align:center;line-height:34px;">${icoSvg}</span></td>
          <td style="padding-left:10px;font-size:12.5px;font-weight:800;color:${A};vertical-align:middle;">${titulo}</td>
          <td style="text-align:right;font-size:11px;font-weight:700;color:${chipCol};vertical-align:middle;white-space:nowrap;">${chip}</td>
        </tr></table>
        <div style="margin-top:6px;">${inner}</div>
      </div>`;
    const rowT = (nm: string, rt: string, rtCol: string) =>
      `<table style="width:100%;border-collapse:collapse;"><tr>
        <td style="padding:5px 0;font-size:12.5px;color:#3D3D3D;">${nm}</td>
        <td style="padding:5px 0 5px 8px;font-size:11px;color:${rtCol};text-align:right;white-space:nowrap;vertical-align:top;">${rt}</td>
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
          return rowT(`${esc(t.title || "")}${cli ? ` — <b style="color:${A}">${esc(cli)}</b>` : ""}`, when, isV ? RED : AMB);
        }).join("");
        bloques.push(sec(venc.length ? "#FBEBEA" : "#EAF2FB", svgIco(venc.length ? RED : A, ICO_TAREAS), "Tus tareas", `${venc.length} vencidas &middot; ${pronto.length} por vencer`, venc.length ? RED : MUT, filas + cta("Ver mis tareas")));
      }

      // 2) Proyectos (emitidas esta semana)
      if (emitidasSemanaArr.length) {
        // deno-lint-ignore no-explicit-any
        const filas = emitidasSemanaArr.slice(0, 4).map((b: any) => rowT(`<b style="color:${A}">${esc(cname(b.client_id) || "Cliente")}</b> — factura N&deg; ${esc(String(b.invoice_no))}`, fmShort(b.amount || 0), MUT)).join("");
        bloques.push(sec("#EAF2FB", svgIco(A, ICO_PROY), "Tus proyectos", `${emitidasSemanaArr.length} emitida${emitidasSemanaArr.length !== 1 ? "s" : ""} esta semana`, MUT, filas + cta("Ver proyectos")));
      }

      // 3) Clientes (abonos por identificar)
      if (abonosSinCli.length) {
        // deno-lint-ignore no-explicit-any
        const filas = abonosSinCli.slice(0, 3).map((m: any) => rowT(`Abono <b>${fm(m.monto || 0)}</b> sin identificar — revisa de quién es`, fmtFecha(m.fecha), MUT)).join("");
        bloques.push(sec("#EAF2FB", svgIco(A, ICO_CLI), "Tus clientes", `${abonosSinCli.length} cobro${abonosSinCli.length !== 1 ? "s" : ""} por identificar`, MUT, filas + cta("Revisar cobros")));
      }

      // 4) Facturación (firm-wide)
      {
        const kp = (v: string, k: string, col: string) => `<td style="padding:0 4px;"><div style="background:#F5F7F9;border-radius:9px;padding:9px 6px;text-align:center;"><div style="font-size:15px;font-weight:800;color:${col};">${v}</div><div style="font-size:9px;color:${MUT};text-transform:uppercase;letter-spacing:.3px;">${k}</div></div></td>`;
        // Hero: cobranza a caja del año vs meta (lo que un dueño quiere ver el lunes). Solo si hay meta cargada.
        const hero = metaCobranza > 0 ? `<div style="background:#F5F7F9;border-radius:11px;padding:12px 13px;margin-bottom:9px;">
            <div style="font-size:9.5px;font-weight:700;color:${MUT};text-transform:uppercase;letter-spacing:.3px;">Cobranza del a&ntilde;o &middot; meta ${fmShort(metaCobranza)}</div>
            <div style="font-size:20px;font-weight:800;color:${A};margin-top:3px;">${fmShort(cobradoAno)} <span style="font-size:12px;font-weight:700;color:${MUT};">/ ${fmShort(metaCobranza)} &middot; ${cobPct}%</span></div>
            <table style="width:100%;border-collapse:collapse;margin-top:9px;"><tr><td style="height:8px;border-radius:5px;background:#E4E8EB;padding:0;"><div style="height:8px;width:${cobPct}%;background:${GRN};border-radius:5px;font-size:0;line-height:0;">&nbsp;</div></td></tr></table>
            <div style="font-size:10.5px;color:${MUT};margin-top:5px;">${cobPct >= 100 ? `Meta anual <b style="color:${GRN};">cumplida</b>` : `Vas en el <b style="color:${GRN};">${cobPct}%</b> &middot; faltan ${fmShort(Math.max(0, metaCobranza - cobradoAno))}`}</div>
          </div>` : "";
        const kpis = `<table style="width:100%;border-collapse:separate;border-spacing:0;"><tr>${kp(fmShort(cobradoSemana), "Cobrado semana", GRN)}${kp(fmShort(porCobrar), "Por cobrar", RED)}${kp(fmShort(vencido), "Vencido", vencido > 0 ? RED : A)}</tr></table>`;
        const lineaVence = venceSemN > 0 ? `<div style="font-size:11px;color:${AMB};margin-top:8px;"><b>Vence esta semana:</b> ${venceSemN} factura${venceSemN !== 1 ? "s" : ""} &middot; ${fmShort(venceSem)} &middot; <a href="https://gestion.leabogados.cl/?ir=cobranza" style="color:${A};font-weight:700;text-decoration:none;">cobrar &rsaquo;</a></div>` : "";
        const lineaEnviar = porEnviar > 0 ? `<div style="font-size:11px;color:${AMB};margin-top:4px;">${porEnviar} factura${porEnviar !== 1 ? "s" : ""} por enviar por correo</div>` : "";
        // Dato menor: cuotas vencidas sin facturar, 1 línea con link al radar. Solo si hay.
        const lineaRadar = sinEmitirN > 0 ? `<div style="font-size:11px;color:${MUT};margin-top:4px;">${sinEmitirN} cuota${sinEmitirN !== 1 ? "s" : ""} vencida${sinEmitirN !== 1 ? "s" : ""} sin facturar &middot; <a href="https://gestion.leabogados.cl/?ir=sinemitir" style="color:${A};font-weight:700;text-decoration:none;">revisar &rsaquo;</a></div>` : "";
        bloques.push(sec("#EAF2FB", svgIco(A, ICO_FACT), "Facturación", "esta semana", MUT, hero + kpis + lineaVence + lineaEnviar + lineaRadar + cta("Ir a Facturación")));
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

      if (dryRun) { sent.push({ to: adm.email, vencidas: venc.length, porVencer: pronto.length, emitidasSemana, cobradoAno, cobPct, cobradoSemana, venceSem, venceSemN, sinEmitir: sinEmitirN, abonosSinCli: abonosSinCli.length, bloques: bloques.length, html }); continue; }
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
