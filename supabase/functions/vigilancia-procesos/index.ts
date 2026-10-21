// vigilancia-procesos — revisa que cada proceso automático haya corrido y terminado bien.
// Fuente: procesos_estado() sobre procesos_corridas (registro permanente: lanzar_proceso anota cada corrida y
// recoger_corridas guarda la respuesta real de la función antes de que pg_net la borre).
// Corre cada hora. Si un proceso falló, no respondió o no corrió en su plazo: lo REINTENTA (solo los marcados reintentable en
// procesos_catalogo: los que no mandan correos a personas) y cuenta el intento. Recién después de 6 intentos fallidos seguidos
// avisa UNA vez, solo a learnings config 'vigilancia_avisar_a' (hoy Cristóbal). Estado por proceso: learnings 'vigilancia_reintento'.
// Interruptor del correo: learnings config 'vigilancia_procesos' = 'on'.
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
  const MAX = 6;   // reintentos antes de avisar
  try {
    // deno-lint-ignore no-explicit-any
    const procs: any[] = await rest("rpc/procesos_estado", { method: "POST", body: "{}" });
    const enFalla = (procs || []).filter((p) => p.active && p.jobname !== "vigilancia-procesos-diario" && (p.atrasado || p.estado === "error" || p.estado === "sin_respuesta"));
    // deno-lint-ignore no-explicit-any
    const guardados: any[] = await rest("learnings?kind=eq.vigilancia_reintento&select=key,value");
    // deno-lint-ignore no-explicit-any
    const prev = new Map<string, any>((guardados || []).map((g) => { try { return [g.key, JSON.parse(g.value)]; } catch { return [g.key, null]; } }));
    const guardar = async (job: string, st: unknown) => {
      if (dryRun) return;
      const enc = encodeURIComponent(job), value = JSON.stringify(st);
      if (prev.has(job)) await rest(`learnings?kind=eq.vigilancia_reintento&key=eq.${enc}`, { method: "PATCH", body: JSON.stringify({ value, updated_at: new Date().toISOString() }) });
      else await rest("learnings", { method: "POST", body: JSON.stringify({ kind: "vigilancia_reintento", key: job, value }) });
    };
    const ahora = new Date().toISOString();
    // deno-lint-ignore no-explicit-any
    const detalle: any[] = [], avisar: any[] = [];
    for (const p of enFalla) {
      const st = prev.get(p.jobname) || { n: 0, desde: ahora, avisado: false };
      st.n = (st.n || 0) + 1;   // cada revisión horaria en falla cuenta un intento
      st.motivo = p.atrasado ? `No corrió dentro de su plazo (${p.cada}).` : p.estado === "sin_respuesta" ? "La función no respondió." : "Terminó con error.";
      st.detalle = p.atrasado ? "" : String(p.respuesta || "").slice(0, 300);
      let reintento: string | null = null;
      if (p.reintentable && st.n <= MAX && !dryRun) {
        try { reintento = await rest("rpc/reintentar_proceso", { method: "POST", body: JSON.stringify({ p_job: p.jobname }) }); } catch (e) { reintento = "error: " + String((e as Error).message || e).slice(0, 120); }
      }
      if (st.n > MAX && !st.avisado) avisar.push({ ...p, st });
      // Bitácora resumida: una línea al detectar la falla (no una por reintento); otra al resolverse o al avisar.
      if (st.n === 1 && !dryRun) await rest("activity_log", { method: "POST", body: JSON.stringify({ user_email: "vigilancia-procesos", action: "procesos.falla_detectada", table_name: "procesos_corridas", detail: JSON.stringify({ title: `${p.nombre}: ${st.motivo}`, name: p.reintentable ? "se reintenta cada hora" : "no se reintenta solo (envía correos)" }) }) }).catch(() => null);
      await guardar(p.jobname, st);
      detalle.push({ job: p.jobname, intento: st.n, reintentable: !!p.reintentable, reintento });
    }
    // Lo que ya no está en falla se resolvió: se borra su estado (y queda en la bitácora si había costado más de un intento).
    const resueltos = [...prev.keys()].filter((k) => !enFalla.some((p) => p.jobname === k));
    for (const k of resueltos) {
      if (dryRun) continue;
      const st = prev.get(k);
      await rest(`learnings?kind=eq.vigilancia_reintento&key=eq.${encodeURIComponent(k)}`, { method: "DELETE" });
      const nom = (procs || []).find((x) => x.jobname === k)?.nombre || k;
      if (st) await rest("activity_log", { method: "POST", body: JSON.stringify({ user_email: "vigilancia-procesos", action: "procesos.resuelto", table_name: "procesos_corridas", detail: JSON.stringify({ title: `${nom}: resuelto${st.n > 1 ? ` tras ${st.n} intentos` : ""}`, name: st.avisado && !st.revisado ? "se había avisado" : null }) }) }).catch(() => null);
    }
    const resumen = { ok: true, revisados: (procs || []).length, en_falla: enFalla.length, resueltos: resueltos.length, por_avisar: avisar.length, dryRun, detalle };
    if (!avisar.length) return json({ ...resumen, enviado: false });

    // deno-lint-ignore no-explicit-any
    const cfg: any[] = await rest("learnings?kind=eq.config&key=in.(vigilancia_procesos,vigilancia_avisar_a)&select=key,value");
    const encendido = String((cfg || []).find((c) => c.key === "vigilancia_procesos")?.value || "").toLowerCase() === "on";
    // Destinatarios configurables (hoy solo Cristóbal); solo correos del dominio de la cuenta que envía.
    const dom = String(GMAIL_USER || "").toLowerCase().split("@")[1] || "";
    const para = String((cfg || []).find((c) => c.key === "vigilancia_avisar_a")?.value || "").split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter((e) => e && dom && e.endsWith("@" + dom));
    if (dryRun || !encendido || !para.length) return json({ ...resumen, enviado: false, motivo: dryRun ? "prueba" : !encendido ? "apagado" : "sin destinatarios" });

    const filas = avisar.map((p) => `<tr><td style="padding:8px 10px;border-top:1px solid #E4E8EB;font-size:13px;color:#003C50;font-weight:bold">${esc(p.nombre)}</td><td style="padding:8px 10px;border-top:1px solid #E4E8EB;font-size:13px;color:#3D3D3D">${esc(p.st.motivo)}${p.st.detalle ? `<div style="font-size:11px;color:#537281;margin-top:3px">${esc(p.st.detalle)}</div>` : ""}<div style="font-size:11px;color:#537281;margin-top:3px">${p.reintentable ? `${MAX} reintentos sin resultado` : "No se reintenta solo (envía correos)"} · en falla desde ${esc(fechaCL(p.st.desde))}</div></td><td style="padding:8px 10px;border-top:1px solid #E4E8EB;font-size:12px;color:#537281;white-space:nowrap;text-align:right">Última: ${esc(fechaCL(p.ultima))}<br>Última correcta: ${esc(fechaCL(p.ultima_ok))}</td></tr>`).join("");
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,Helvetica,sans-serif;background:#f0f2f4;margin:0;padding:20px"><div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #e4e8eb;padding:20px"><p style="font-size:14px;color:#3D3D3D;margin:0 0 12px">${para.length > 1 ? "Espero que estén muy bien." : "Espero que estés muy bien."}</p><p style="font-size:14px;color:#3D3D3D;margin:0 0 14px">${avisar.length === 1 ? "Un proceso automático de la app sigue con falla después de 6 horas:" : `${avisar.length} procesos automáticos de la app siguen con falla después de 6 horas:`}</p><table style="width:100%;border-collapse:collapse">${filas}</table><p style="font-size:12px;color:#537281;margin:16px 0 0">El detalle completo está en la app, en Oficina › Procesos automáticos.</p></div></body></html>`;
    const asunto = avisar.length === 1 ? `Proceso automatico con falla: ${avisar[0].nombre}` : `${avisar.length} procesos automaticos con falla`;
    const client = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: GMAIL_USER, password: GMAIL_PASS } } });
    await client.send({ from: `Oficina <${GMAIL_USER}>`, to: para, subject: toAscii(asunto), content: avisar.map((p) => `${p.nombre}: ${p.st.motivo}`).join("\n"), html: html.replace(/[ \t]+$/gm, "") });
    await client.close();
    // Ya avisado: si guardar falla, no se responde error (el aviso ya salió); se reintenta guardar en la próxima revisión.
    for (const p of avisar) { p.st.avisado = true; prev.set(p.jobname, p.st); try { await guardar(p.jobname, p.st); } catch (e) { (resumen as any).error_guardar = String((e as Error).message || e); } }
    await rest("activity_log", { method: "POST", body: JSON.stringify({ user_email: "vigilancia-procesos", action: "procesos.falla_avisada", table_name: "procesos_corridas", detail: JSON.stringify({ title: asunto, para, procesos: avisar.map((p) => p.jobname) }) }) }).catch(() => null);
    return json({ ...resumen, enviado: true, para, procesos: avisar.map((p) => p.jobname) });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
