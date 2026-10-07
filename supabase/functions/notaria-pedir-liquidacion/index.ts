import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

// notaria-pedir-liquidacion — recordatorio para pedir a la notaría su liquidación (días 10 y 20 de cada mes).
// Si el día cae sábado, domingo o feriado (tabla `feriados`), sale el DÍA HÁBIL SIGUIENTE. Corre por cron cada día hábil;
// solo envía el día que corresponde y una sola vez por fecha (dedupe en la bitácora activity_log).
// "Desde" = día siguiente a la OT de notaría más reciente ya cargada (expenses Notaria con OT) → no se piden OT repetidas.
// Config (learnings kind 'config', key 'notaria_pedir_liquidacion'): JSON {"dias":[10,20],"to":"…","cc":["…"]} o 'off'.
// Auth: cron con secreto. JWT @dominio = simulación. body.dryRun=true arma sin enviar; body.testTo=correo prueba a uno;
// body.fecha='YYYY-MM-DD' simula el día (para probar el corrimiento a día hábil).
const GMAIL_USER = Deno.env.get("GMAIL_USER") || "";
const GMAIL_PASS = Deno.env.get("GMAIL_PASS") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || Deno.env.get("ALERTA_CARTOLA_SECRET") || Deno.env.get("CAJA_CHICA_SWEEP_SECRET") || "";
const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const APP_URL = Deno.env.get("APP_URL") || "https://gestion.leabogados.cl";

const toAscii = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[–—]/g, "-").replace(/[^\x20-\x7E]/g, "");
const qpSafe = (h: string) => String(h || "").replace(/[ \t]+$/gm, "");
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dmy = (s: string) => { const p = String(s || "").slice(0, 10).split("-"); return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : "—"; };
const esc = (s: string) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const hoySantiago = () => { const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Santiago" })); d.setHours(0, 0, 0, 0); return d; };

// deno-lint-ignore no-explicit-any
async function sb(path: string): Promise<any[]> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
  return r.ok ? await r.json() : [];
}
async function sbInsert(table: string, row: unknown) {
  await fetch(`${SB_URL}/rest/v1/${table}`, { method: "POST", headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(row) });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" } });
  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = await req.json(); } catch { /* sin body */ }
  const esCron = !!CRON_SECRET && body.secret === CRON_SECRET;
  let dry = !esCron || !!body.dryRun;
  if (!esCron) {
    const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const u = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${bearer}` } }).then((r) => r.ok ? r.json() : null).catch(() => null);
    if (!u?.email) return json({ error: "No autorizado" }, 403);
    dry = true;
  }
  const testTo = typeof body.testTo === "string" && body.testTo.includes("@") ? body.testTo : null;
  if (testTo) dry = false;   // una prueba explícita a un correo sí se envía (solo a ese correo)

  // Config del estudio
  const [cfgRow, est] = await Promise.all([sb("learnings?select=value&kind=eq.config&key=eq.notaria_pedir_liquidacion&limit=1"), sb("estudios?select=nombre&limit=1")]);
  const raw = String(cfgRow?.[0]?.value || "").trim();
  if (raw.toLowerCase() === "off" && !testTo) return json({ ok: true, skipped: "apagado" });
  // deno-lint-ignore no-explicit-any
  let cfg: any = {}; try { cfg = raw ? JSON.parse(raw) : {}; } catch { cfg = {}; }
  const dias: number[] = Array.isArray(cfg.dias) && cfg.dias.length ? cfg.dias.map(Number).filter((n: number) => n >= 1 && n <= 28) : [10, 20];
  const to: string = String(cfg.to || "");
  const cc: string[] = Array.isArray(cfg.cc) ? cfg.cc.filter((x: string) => String(x).includes("@")) : [];
  const nombreEstudio = est?.[0]?.nombre || "Liberona Escala Abogados";
  if (!to.includes("@") && !testTo) return json({ ok: false, error: "Falta el destinatario en la config (learnings config notaria_pedir_liquidacion.to)" });

  // ¿Hoy toca? Para cada día configurado, el día efectivo = ese día o el hábil siguiente (sin fin de semana ni feriado).
  const fer = await sb("feriados?select=fecha");
  const feriados = new Set((fer || []).map((f) => String(f.fecha).slice(0, 10)));
  const esHabil = (d: Date) => { const w = d.getDay(); return w !== 0 && w !== 6 && !feriados.has(iso(d)); };
  const today = body.fecha && /^\d{4}-\d{2}-\d{2}$/.test(body.fecha) ? new Date(body.fecha + "T00:00:00") : hoySantiago();
  let slot: string | null = null;
  for (const dia of dias) {
    const d = new Date(today.getFullYear(), today.getMonth(), dia); let g = 0;
    while (!esHabil(d) && g++ < 10) d.setDate(d.getDate() + 1);
    if (iso(d) === iso(today)) { slot = iso(new Date(today.getFullYear(), today.getMonth(), dia)); break; }
  }
  if (!slot && !testTo) return json({ ok: true, enviado: false, motivo: `hoy (${iso(today)}) no corresponde`, dias });

  // Dedupe: una sola vez por fecha programada
  if (slot && !testTo) {
    const ya = await sb(`activity_log?select=id&action=eq.notaria.recordatorio_liquidacion&detail=like.*${slot}*&limit=1`);
    if (ya?.length) return json({ ok: true, enviado: false, motivo: `ya enviado (${slot})` });
  }

  // Datos: última liquidación de notaría cargada + OT más reciente cargada
  const [cargas, ultOt, quienRow] = await Promise.all([
    sb("bulk_imports?select=created_at,created_by,row_count,filename,resumen&undone_at=is.null&order=created_at.desc&limit=40"),
    sb("expenses?select=date&category=eq.Notaria&ot_number=not.is.null&deleted_at=is.null&order=date.desc&limit=1"),
    to ? sb(`miembros?select=nombre&email=eq.${encodeURIComponent(to)}&limit=1`) : Promise.resolve([]),
  ]);
  // deno-lint-ignore no-explicit-any
  const ultCarga = (cargas || []).find((c: any) => c?.resumen?.notaria === true || /notar/i.test(String(c?.filename || "")));
  const ultOtFecha = ultOt?.[0]?.date ? String(ultOt[0].date).slice(0, 10) : null;
  const desde = ultOtFecha ? (() => { const d = new Date(ultOtFecha + "T00:00:00"); d.setDate(d.getDate() + 1); return iso(d); })() : null;
  const diasSin = ultCarga ? Math.max(0, Math.round((today.getTime() - new Date(String(ultCarga.created_at).slice(0, 10) + "T00:00:00").getTime()) / 86400000)) : null;
  const nombreTo = String(quienRow?.[0]?.nombre || "").split(" ")[0] || "";
  const nCarga = ultCarga ? (ultCarga.resumen?.cargadas ?? ultCarga.row_count ?? null) : null;

  const fila = (l: string, v: string, col = "#3D3D3D") => `<tr><td style="padding:8px 0;border-top:1px solid #E4E8EB">${l}</td><td style="padding:8px 0;border-top:1px solid #E4E8EB;text-align:right;white-space:nowrap;color:${col}">${v}</td></tr>`;
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,Helvetica,sans-serif;background:#f0f2f4;margin:0;padding:20px"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e4e8eb">
<div style="background:#003C50;padding:20px 28px;text-align:center"><img src="${APP_URL}/le-logo-blanco.png" alt="${esc(nombreEstudio)}" height="28" width="184" style="height:28px;width:184px;display:inline-block;border:0"/></div>
<div style="padding:24px 28px">
<div style="font-size:16px;color:#1a1a1a;margin:0 0 6px">Hola${nombreTo ? " " + esc(nombreTo) : ""},</div>
<div style="font-size:14px;color:#666;margin:0 0 16px;line-height:1.5">Hoy toca pedir a la notaría la liquidación de las OT del período.</div>
<div style="background:#E6F1FB;border-radius:10px;padding:14px 16px;margin-bottom:14px"><div style="font-size:10px;font-weight:bold;color:#185FA5;text-transform:uppercase;letter-spacing:.5px">Pide la liquidación</div><div style="font-size:18px;font-weight:bold;color:#003C50;margin-top:3px">${desde ? `desde el ${dmy(desde)} hasta hoy` : "hasta hoy"}</div>${desde ? `<div style="font-size:12px;color:#537281;margin-top:2px">el día siguiente a la última OT que ya está cargada</div>` : ""}</div>
<table style="width:100%;border-collapse:collapse;font-size:13px;color:#3D3D3D">
${ultCarga ? fila("Última liquidación cargada", `<b>${dmy(ultCarga.created_at)}</b>${nCarga != null ? ` · ${nCarga} OT` : ""}`) : fila("Última liquidación cargada", "—")}
${fila("OT cargadas hasta", `<b>${ultOtFecha ? dmy(ultOtFecha) : "—"}</b>`)}
${diasSin != null ? fila("Sin cargar liquidación hace", `<b>${diasSin} día${diasSin !== 1 ? "s" : ""}</b>`, diasSin > 15 ? "#A32D2D" : "#3D3D3D") : ""}
</table>
<div style="font-size:13px;color:#666;margin:16px 0 0;line-height:1.5">Cuando llegue el Excel, cárgalo en <b style="color:#3D3D3D">Gastos › Cargar › Excel de notaría</b>.</div>
<div style="margin-top:18px"><a href="${APP_URL}" style="display:inline-block;background:#003C50;color:#fff;text-decoration:none;padding:9px 18px;border-radius:18px;font-size:12px;font-weight:bold">Cargar la liquidación en la app &rarr;</a></div>
</div>
<div style="padding:14px 28px;border-top:1px solid #eee;font-size:11px;color:#999">${cc.length ? "Con copia a " + esc(cc.join(", ")) + " · " : ""}aviso automático los días ${dias.join(" y ")} · ${esc(nombreEstudio)}</div>
</div></body></html>`;
  const asunto = `Pide la liquidacion de notaria${desde ? " · desde el " + dmy(desde) : ""}`;
  const destTo = testTo ? [testTo] : [to];
  const destCc = testTo ? [] : cc;
  const res = { slot, para: destTo, cc: destCc, desde, ultCarga: ultCarga ? { fecha: String(ultCarga.created_at).slice(0, 10), ot: nCarga, por: ultCarga.created_by } : null, ultOtFecha, diasSin, asunto };
  if (dry) return json({ ok: true, modo: "simulacion", ...res, html });

  try {
    const client = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: GMAIL_USER, password: GMAIL_PASS } } });
    await client.send({ from: `${toAscii(nombreEstudio)} - Notaria <${GMAIL_USER}>`, to: destTo.join(", "), ...(destCc.length ? { cc: destCc.join(", ") } : {}), subject: toAscii(asunto), content: "Ver el contenido en formato HTML.", html: qpSafe(html) });
    await client.close();
  } catch (e) { return json({ ok: false, error: "SMTP: " + String((e as Error).message || e) }, 500); }
  // Bitácora (y dedupe): qué se pidió, a quién, para qué fecha programada
  await sbInsert("activity_log", { user_email: null, action: testTo ? "notaria.recordatorio_liquidacion_prueba" : "notaria.recordatorio_liquidacion", table_name: "expenses", record_id: null, detail: JSON.stringify({ slot, title: desde ? `Pedir desde el ${dmy(desde)}` : "Pedir liquidación", name: nombreTo || to, to: destTo, cc: destCc }) });
  return json({ ok: true, enviado: true, ...res });
});
