// vigilancia-procesos — revisa que cada proceso automático haya corrido y terminado bien.
// Fuente: procesos_estado() sobre procesos_corridas (registro permanente: lanzar_proceso anota cada corrida y
// recoger_corridas guarda la respuesta real de la función antes de que pg_net la borre).
// Si un proceso falló, no respondió o no corrió dentro de su plazo, avisa a los socios (miembros rol admin) desde
// GMAIL_USER (contacto@), UNA vez por falla (learnings kind 'vigilancia_aviso', key = jobname, value = corrida avisada).
// Interruptor: learnings config 'vigilancia_procesos' = 'on' para enviar (por defecto apagado = solo calcula).
// Auth: CRON_SECRET en body.secret, o JWT @leabogados.cl. body.dryRun = no envía ni marca avisos.
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const GMAIL_USER = Deno.env.get("GMAIL_USER") || "";
const GMAIL_PASS = Deno.env.get("GMAIL_PASS") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
const toAscii = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[–—]/g, "-").replace(/[^\x20-\x7E]/g, "");
const esc = (s: string) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Fecha y hora de Chile en dd-mm-aaaa hh:mm (formato único de la app).
const fechaCL = (iso: string | null) => {
  if (!iso) return "sin registro";
  const p = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)?.value || "";
  return `${g("day")}-${g("month")}-${g("year")} ${g("hour")}:${g("minute")}`;
};
// deno-lint-ignore no-explicit-any
async function rest(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${path.split("?")[0]} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" } });
  // deno-lint-ignore no-explicit-any
  let body: any = {}; try { body = await req.json(); } catch { /* sin body */ }
  const esCron = !!CRON_SECRET && body.secret === CRON_SECRET;
  if (!esCron) {
    const tok = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const u = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${tok}` } }).then((r) => r.ok ? r.json() : null).catch(() => null);
    if (!u?.email || !String(u.email).toLowerCase().endsWith("@leabogados.cl")) return json({ error: "No autorizado" }, 403);
  }
  const dryRun = !!body.dryRun;
  try {
    // deno-lint-ignore no-explicit-any
    const procs: any[] = await rest("rpc/procesos_estado", { method: "POST", body: "{}" });
    const problemas = (procs || []).filter((p) => p.active && (p.atrasado || p.estado === "error" || p.estado === "sin_respuesta")).map((p) => ({
      jobname: p.jobname, nombre: p.nombre, cada: p.cada, ultima: p.ultima, ultima_ok: p.ultima_ok,
      motivo: p.atrasado ? `No corrió dentro de su plazo (${p.cada}).` : p.estado === "sin_respuesta" ? "La función no respondió." : "Terminó con error.",
      detalle: p.atrasado ? "" : String(p.respuesta || "").slice(0, 300),
      // Llave de la falla: una falla se avisa una sola vez; si se repite en otra corrida, es una falla nueva.
      llave: p.atrasado ? `atraso:${p.ultima || "nunca"}` : `${p.estado}:${p.ultima}`,
    }));
    // deno-lint-ignore no-explicit-any
    const avisados: any[] = await rest("learnings?kind=eq.vigilancia_aviso&select=key,value");
    const yaAvisado = new Map((avisados || []).map((a) => [a.key, a.value]));
    const nuevos = problemas.filter((p) => yaAvisado.get(p.jobname) !== p.llave);
    const resumen = { ok: true, revisados: (procs || []).length, problemas: problemas.length, nuevos: nuevos.length, dryRun };
    if (!nuevos.length) return json({ ...resumen, enviado: false, motivo: problemas.length ? "fallas ya avisadas" : "todo en orden" });

    // deno-lint-ignore no-explicit-any
    const cfg: any[] = await rest("learnings?kind=eq.config&key=eq.vigilancia_procesos&select=value&limit=1");
    const encendido = String(cfg?.[0]?.value || "").toLowerCase() === "on";
    // deno-lint-ignore no-explicit-any
    const socios: any[] = await rest("miembros?rol=eq.admin&select=email,rut,nombre");
    // Solo correos del dominio de la cuenta que envía (no otros estudios ni correos personales) y uno por persona:
    // los alias (cl@ y cristobal.liberona@) son la misma casilla y duplicaban el aviso.
    const dom = String(GMAIL_USER || "").toLowerCase().split("@")[1] || "";
    const porPersona = new Map<string, string>();
    for (const s of socios || []) {
      const e = String(s.email || "").trim().toLowerCase();
      if (!e || !dom || !e.endsWith("@" + dom)) continue;
      const k = String(s.rut || s.nombre || e).replace(/[^0-9kK]/g, "") || e;
      const prev = porPersona.get(k);
      if (!prev || e.length < prev.length) porPersona.set(k, e);
    }
    const para = [...porPersona.values()];
    if (dryRun || !encendido || !para.length) return json({ ...resumen, enviado: false, motivo: dryRun ? "prueba" : !encendido ? "apagado" : "sin destinatarios", nuevosDet: nuevos });

    const filas = nuevos.map((p) => `<tr><td style="padding:8px 10px;border-top:1px solid #E4E8EB;font-size:13px;color:#003C50;font-weight:bold">${esc(p.nombre)}</td><td style="padding:8px 10px;border-top:1px solid #E4E8EB;font-size:13px;color:#3D3D3D">${esc(p.motivo)}${p.detalle ? `<div style="font-size:11px;color:#537281;margin-top:3px">${esc(p.detalle)}</div>` : ""}</td><td style="padding:8px 10px;border-top:1px solid #E4E8EB;font-size:12px;color:#537281;white-space:nowrap;text-align:right">Última: ${esc(fechaCL(p.ultima))}<br>Última correcta: ${esc(fechaCL(p.ultima_ok))}</td></tr>`).join("");
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,Helvetica,sans-serif;background:#f0f2f4;margin:0;padding:20px"><div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #e4e8eb;padding:20px"><p style="font-size:14px;color:#3D3D3D;margin:0 0 12px">Espero que estén muy bien.</p><p style="font-size:14px;color:#3D3D3D;margin:0 0 14px">${nuevos.length === 1 ? "Un proceso automático de la app requiere revisión:" : `${nuevos.length} procesos automáticos de la app requieren revisión:`}</p><table style="width:100%;border-collapse:collapse">${filas}</table><p style="font-size:12px;color:#537281;margin:16px 0 0">El detalle completo está en la app, en Oficina › Procesos automáticos.</p></div></body></html>`;
    const asunto = nuevos.length === 1 ? `Proceso automático con falla: ${nuevos[0].nombre}` : `${nuevos.length} procesos automáticos con falla`;
    const client = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: GMAIL_USER, password: GMAIL_PASS } } });
    await client.send({ from: `Oficina <${GMAIL_USER}>`, to: para, subject: toAscii(asunto), content: nuevos.map((p) => `${p.nombre}: ${p.motivo}`).join("\n"), html: html.replace(/[ \t]+$/gm, "") });
    await client.close();
    // Recién enviado el aviso, se marca cada falla como avisada (una fila por proceso: update o insert).
    for (const p of nuevos) {
      const enc = encodeURIComponent(p.jobname);
      if (yaAvisado.has(p.jobname)) await rest(`learnings?kind=eq.vigilancia_aviso&key=eq.${enc}`, { method: "PATCH", body: JSON.stringify({ value: p.llave }) });
      else await rest("learnings", { method: "POST", body: JSON.stringify({ kind: "vigilancia_aviso", key: p.jobname, value: p.llave }) });
    }
    await rest("activity_log", { method: "POST", body: JSON.stringify({ user_email: "vigilancia-procesos", action: "procesos.falla_avisada", table_name: "procesos_corridas", detail: JSON.stringify({ title: asunto, para, procesos: nuevos.map((p) => p.jobname) }) }) }).catch(() => null);
    return json({ ...resumen, enviado: true, para, procesos: nuevos.map((p) => p.jobname) });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
