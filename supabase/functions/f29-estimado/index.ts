// Edge Function: f29-estimado
// El primer día hábil de cada mes calcula el F29 estimado del mes recién CERRADO (regla única _shared/f29Reglas.js, la misma del
// calendario tributario de la app) y lo envía por correo a los socios desde la casilla de la oficina, para provisionar el pago:
// PPM (tasa declarada, f29_declarados; 2% en 2026, de lo facturado menos notas de crédito, Registro de Ventas del SII) + retención de las boletas de honorarios recibidas
// + impuesto único de trabajadores del mes anterior. Una vez por período (learnings kind f29_estimado, key AAAA-MM).
// Destinatarios: learnings config f29_avisar_a; si no hay, los miembros admin del dominio de la oficina.
// body.per = 'AAAA-MM' (otro período), body.forzar = no exige primer día hábil ni que no se haya enviado, body.dryRun = no envía
// ni guarda. Auth: CRON_SECRET o sesión de un usuario del dominio de la oficina. verify_jwt=false.

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { f29Estimado } from "../_shared/f29Reglas.js";
import { holaEquipo } from "../_shared/correoEquipo.js";

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const GMAIL_USER = Deno.env.get("GMAIL_USER") || "";
const GMAIL_PASS = Deno.env.get("GMAIL_PASS") || "";
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const toAscii = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7E]/g, "");
const fmt = (n: number) => "$" + Math.round(Number(n) || 0).toLocaleString("es-CL").replace(/,/g, ".");
const dmy = (iso: string) => String(iso || "").slice(0, 10).split("-").reverse().join("-");
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const mesNom = (per: string) => `${MESES[Number(per.slice(5, 7)) - 1]} ${per.slice(0, 4)}`;
const ymMas = (ym: string, n: number) => { const d = new Date(`${ym}-01T12:00:00`); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 7); };
const hoyCL = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());

// deno-lint-ignore no-explicit-any
async function rest(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${path.split("?")[0]}: ${r.status} ${await r.text()}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
// Feriados de Chile del año (mismas fuentes que la app); si no responden, solo fin de semana.
async function feriados(y: number): Promise<Set<string>> {
  const s = new Set<string>();
  for (const url of [`https://api.boostr.cl/feriados/${y}.json`, `https://apis.digital.gob.cl/fl/feriados/${y}`]) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(8000) }); if (!r.ok) continue; const j = await r.json(); const a = Array.isArray(j) ? j : (j.data || j.feriados || []);
      if (!Array.isArray(a) || !a.length) continue; a.forEach((f: unknown) => { const d = String(typeof f === "string" ? f : (f as { fecha?: string; date?: string }).fecha || (f as { date?: string }).date || "").slice(0, 10); if (/^\d{4}-\d{2}-\d{2}$/.test(d)) s.add(d); }); break; } catch { /* siguiente fuente */ }
  }
  return s;
}
const habilDesde = (iso: string, fer: Set<string>) => { const d = new Date(`${iso}T12:00:00`); for (let i = 0; i < 10; i++) { const x = d.toISOString().slice(0, 10); if (![0, 6].includes(d.getDay()) && !fer.has(x)) return x; d.setDate(d.getDate() + 1); } return d.toISOString().slice(0, 10); };

Deno.serve(async (req) => {
  // deno-lint-ignore no-explicit-any
  let body: any = {}; try { body = await req.json(); } catch { /* sin body */ }
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!CRON_SECRET) return json({ error: "No autorizado" }, 403);
  const cas = await rest("learnings?kind=eq.config&key=in.(agente_casilla,f29_avisar_a)&select=key,value").catch(() => []);
  const dom = String(cas.find((c: { key: string }) => c.key === "agente_casilla")?.value || "").split("@")[1] || "";
  let quien = "agente";
  if (body.secret !== CRON_SECRET && bearer !== CRON_SECRET) {
    const u = bearer ? await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${bearer}` } }).then((r) => r.ok ? r.json() : null).catch(() => null) : null;
    if (!u?.email || !dom || !String(u.email).toLowerCase().endsWith("@" + dom.toLowerCase())) return json({ error: "No autorizado" }, 403);
    quien = u.email;
  }
  try {
    const hoy = hoyCL(), dryRun = !!body.dryRun, forzar = !!body.forzar;
    const per = /^\d{4}-\d{2}$/.test(String(body.per || "")) ? String(body.per) : ymMas(hoy.slice(0, 7), -1);
    const fer = await feriados(Number(hoy.slice(0, 4)));
    const primerHabil = habilDesde(`${hoy.slice(0, 7)}-01`, fer);
    if (!forzar && !body.per && hoy !== primerHabil) return json({ ok: true, omitido: `hoy no es el primer día hábil del mes (${dmy(primerHabil)})` });
    const ya = (await rest(`learnings?kind=eq.f29_estimado&key=eq.${per}&select=value`).catch(() => []))?.[0];
    if (ya && !forzar) return json({ ok: true, omitido: `el F29 estimado de ${per} ya se envió`, previo: JSON.parse(ya.value) });

    const prev = ymMas(per, -1), desde = `${prev}-01`, hasta = `${ymMas(per, 1)}-01`;
    const [docs, boletas, vals, miembros, decl] = await Promise.all([
      rest(`sii_cargas_docs?select=tipo_dte,fecha_emision,monto&fecha_emision=gte.${desde}&fecha_emision=lt.${hasta}`),
      rest(`boletas_honorarios?select=fecha,retencion,estado&fecha=gte.${desde}&fecha=lt.${hasta}`),
      rest(`learnings?kind=eq.valores_contadora&key=in.(${prev},${per})&select=key,value`),
      rest("miembros?select=email,nombre,rol"),
      rest(`f29_declarados?select=periodo,tasa_ppm,impuesto_unico,total&periodo=lt.${per}&order=periodo.desc&limit=12`).catch(() => []),
    ]);
    const valores: Record<string, unknown> = {};
    for (const v of vals || []) { try { valores[v.key] = JSON.parse(v.value); } catch { /* fila mala */ } }
    const declarados: Record<string, unknown> = {};
    for (const d of decl || []) declarados[d.periodo] = d;
    const e = f29Estimado({ per, docs, boletas, valores, declarados });
    const vence = habilDesde(`${ymMas(per, 1)}-20`, await feriados(Number(ymMas(per, 1).slice(0, 4))));

    // Una dirección por socio (miembros trae alias: cl@ y cristobal.liberona@): la más corta del dominio de la oficina.
    const cfg = String(cas.find((c: { key: string }) => c.key === "f29_avisar_a")?.value || "");
    const porPersona = new Map<string, string>();
    for (const m of miembros.filter((m: { rol: string; email: string }) => m.rol === "admin" && String(m.email || "").toLowerCase().endsWith("@" + dom))) {
      const k = String(m.nombre || "").trim().split(/\s+/)[0].toLowerCase(), em = String(m.email).toLowerCase(), ac = porPersona.get(k);
      if (!ac || em.length < ac.length) porPersona.set(k, em);
    }
    const destino = (cfg ? cfg.split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter((x) => x && dom && x.endsWith("@" + dom)) : [...porPersona.values()]) as string[];

    const fila = (k: string, v: string, b = false) => `<tr><td style="padding:8px 10px;border-top:1px solid #E4E8EB;color:${b ? "#003C50" : "#3D3D3D"};${b ? "font-weight:700;" : ""}">${k}</td><td style="padding:8px 10px;border-top:1px solid #E4E8EB;text-align:right;white-space:nowrap;${b ? "font-weight:700;color:#003C50;" : ""}">${v}</td></tr>`;
    const filas = [
      fila(`PPM (${String(Math.round(e.tasa * 1000) / 10).replace(".", ",")}% de ${fmt(e.base)} facturados)`, fmt(e.ppm)),
      fila(`Retención de boletas de honorarios (${e.nBoletas} ${e.nBoletas === 1 ? "boleta" : "boletas"})`, fmt(e.ret)),
      fila("Impuesto único de trabajadores (mes anterior)", e.iu != null ? fmt(e.iu) : "sin dato"),
      fila("Total estimado", fmt(e.total), true),
    ].join("");
    const asunto = `F29 de ${mesNom(per)} estimado: ${fmt(e.total)}`;
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,Helvetica,sans-serif;background:#f0f2f4;margin:0;padding:20px"><div style="max-width:620px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #e4e8eb;padding:22px">`
      + `<p style="font-size:14px;color:#3D3D3D;margin:0 0 12px">${esc(holaEquipo(destino, miembros))}:</p>`
      + `<p style="font-size:14px;color:#3D3D3D;margin:0 0 14px">Estimación del F29 de ${esc(mesNom(per))}, con vencimiento el ${dmy(vence)}:</p>`
      + `<table style="width:100%;border-collapse:collapse;font-size:13px">${filas}</table>`
      + `<p style="font-size:12px;color:#537281;margin:16px 0 0">Fuente: Registro de Ventas del SII, boletas de honorarios registradas en la app y F29 de ${esc(mesNom(prev))}${e.iu == null ? " (sin los valores de la contadora de ese mes: el impuesto único no se pudo estimar)" : ""}.</p></div></body></html>`;
    const texto = `Estimacion del F29 de ${mesNom(per)} (vence ${dmy(vence)}): PPM ${fmt(e.ppm)} + retenciones ${fmt(e.ret)} + impuesto unico ${e.iu != null ? fmt(e.iu) : "sin dato"} = ${fmt(e.total)}.`;

    let enviado = false, motivo = "";
    if (dryRun) motivo = "prueba (no se envía)";
    else if (!destino.length) motivo = "sin destinatarios";
    else {
      const c = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: GMAIL_USER, password: GMAIL_PASS } } });
      try { await c.send({ from: `Oficina <${GMAIL_USER}>`, to: destino, subject: toAscii(asunto), content: toAscii(texto), html }); enviado = true; }
      catch (err) { motivo = String((err as Error).message || err); } finally { await c.close().catch(() => null); }
    }
    const resultado = { ...e, vence, para: destino, enviado, motivo: motivo || null, enviado_at: enviado ? new Date().toISOString() : null };
    if (!dryRun) {
      if (enviado) await (ya ? rest(`learnings?kind=eq.f29_estimado&key=eq.${per}`, { method: "PATCH", body: JSON.stringify({ value: JSON.stringify(resultado) }) })
        : rest("learnings", { method: "POST", body: JSON.stringify({ kind: "f29_estimado", key: per, value: JSON.stringify(resultado) }) })).catch(() => null);
      await rest("activity_log", { method: "POST", body: JSON.stringify({ user_email: quien, action: enviado ? "f29.estimado_enviado" : "f29.estimado_no_enviado", table_name: "learnings", record_id: null, estudio_id: "lea", detail: { title: `${enviado ? "F29 estimado enviado" : "F29 estimado NO enviado"}: ${mesNom(per)} ${fmt(e.total)}`, para: destino, motivo: motivo || null } }) }).catch(() => null);
    }
    return json({ ok: true, dryRun, asunto, ...resultado, ...(dryRun ? { html } : {}) });
  } catch (err) {
    return json({ error: String((err as Error).message || err) }, 500);
  }
});
