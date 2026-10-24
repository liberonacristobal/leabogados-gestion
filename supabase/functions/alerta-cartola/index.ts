// Edge Function: alerta-cartola
// Cron diario: detecta días hábiles (no feriados) SIN cartola cargada y avisa a los socios por correo.
// Fuente de verdad de "llegó cartola de un día" = cartola_cargas (procesar-cartola la escribe en cada ingesta);
// también considera la última fecha con movimientos. Un día cubierto por cartola_cargas NO se marca como hueco
// (incluye los días marcados "sin movimientos" desde la app).
// El correo sale del buzón GMAIL_USER (= contacto@leabogados.cl) y lo firma la oficina.
// SEGURIDAD: interruptor de envío en la base (learnings config alerta_cartola = 'on'). Sin 'on' = dry-run (no envía).
// Auth: secreto compartido (ALERTA_CARTOLA_SECRET / CRON_SECRET, el mismo 'lea-cron-…' de los otros cron). verify_jwt=false.

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const ESTUDIO = "Liberona Escala Abogados";
const SOCIOS = ["cl@leabogados.cl", "ee@leabogados.cl"];
const GMAIL_USER = Deno.env.get("GMAIL_USER") || "";           // = contacto@leabogados.cl
const GMAIL_PASS = Deno.env.get("GMAIL_PASS") || "";
const CRON_SECRET = Deno.env.get("ALERTA_CARTOLA_SECRET") || Deno.env.get("CRON_SECRET") || "";
const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
// Interruptor de envío en la base (learnings config alerta_cartola = 'on'/'off'), como cobranza-auto. Default OFF.
// Se apaga/enciende con un UPDATE, sin redeploy. Sin la fila (o 'off') = dry-run (calcula pero no envía).

const toAscii = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[–—]/g, "-").replace(/[^\x20-\x7E]/g, "");
const qpSafe = (h: string) => String(h || "").replace(/[ \t]+$/gm, "");
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const hoy = () => { const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Santiago" })); d.setHours(0, 0, 0, 0); return d; };
const MMM = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const lindo = (s: string) => { const p = s.split("-"); const d = new Date(s + "T12:00"); return `${DIAS[d.getDay()]} ${+p[2]} ${MMM[+p[1] - 1]}`; };

// deno-lint-ignore no-explicit-any
async function sb(path: string): Promise<any[]> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
  // Una lectura que falla NO es «sin datos»: con la cobertura vacía saldrían ~20 días como faltantes y se darían por avisados.
  if (!r.ok) throw new Error(`${path.split("?")[0]}: ${r.status}`);
  return await r.json();
}

Deno.serve(async (req) => {
  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = await req.json(); } catch { /* sin body */ }
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const esCron = !!CRON_SECRET && (body.secret === CRON_SECRET || bearer === CRON_SECRET);
  if (!esCron) return json({ error: "No autorizado" }, 403);

  // Solo avisa SALTOS REALES: un día hábil de la cuenta con envío diario (honorarios) que ninguna carga cubre — ni la diaria
  // de ese día, ni una diaria posterior (son acumuladas desde el día 1 del mes), ni una carga manual o «sin movimientos».
  // No avisa atrasos de la cuenta de gastos: llega solo a mano, por diseño, y eso no es un salto (usuario 21-10-2026).
  // Cada salto se avisa UNA vez (learnings config alerta_cartola_avisados = días ya avisados); la tarjeta de Conciliación
  // lo sigue mostrando hasta que se cargue.
  const [fer, cargas, cfgAv] = await Promise.all([
    sb("feriados?select=fecha"),
    sb("cartola_cargas?select=fecha_desde,fecha_hasta,rol_cuenta&or=(rol_cuenta.is.null,rol_cuenta.eq.honorarios)"),
    sb("learnings?select=id,value&kind=eq.config&key=eq.alerta_cartola_avisados"),
  ]);
  const feriados = new Set((fer || []).map((f) => String(f.fecha).slice(0, 10)));
  // 31-dic = feriado bancario: BICE no envía cartola ese día aunque no esté en la tabla de feriados.
  const esHabil = (d: Date) => { const w = d.getDay(); if (w === 0 || w === 6) return false; const s = iso(d); return !feriados.has(s) && !s.endsWith("-12-31"); };
  const today = hoy();
  const cov = new Set<string>(); let lastCov: string | null = null;
  for (const r of cargas || []) {
    let d = new Date(String(r.fecha_desde) + "T00:00:00"); const h = new Date(String(r.fecha_hasta) + "T00:00:00"); let g = 0;
    while (d <= h && g++ < 400) { cov.add(iso(d)); d.setDate(d.getDate() + 1); }
    const fh = String(r.fecha_hasta).slice(0, 10); if (!lastCov || fh > lastCov) lastCov = fh;
  }
  // La cartola de un día hábil llega la mañana del día hábil SIGUIENTE (la del viernes llega el lunes): un día recién falta
  // cuando ya pasó su día hábil siguiente o es hoy (el aviso corre en la tarde).
  const sigHabil = (d0: Date) => { const d = new Date(d0); let g = 0; do { d.setDate(d.getDate() + 1); } while (!esHabil(d) && g++ < 15); return d; };
  const gap: string[] = [];
  { const d = new Date(today); d.setDate(d.getDate() - 30); let guard = 0;
    while (d < today && guard++ < 40) { const s = iso(d); if (esHabil(d) && !cov.has(s) && sigHabil(d) <= today) gap.push(s); d.setDate(d.getDate() + 1); } }
  let avisados: string[] = []; try { avisados = JSON.parse(String(cfgAv?.[0]?.value || "[]")); } catch { avisados = []; }
  const nuevos = gap.filter((s) => !avisados.includes(s));
  if (!nuevos.length && !body.dryRun) return json({ ok: true, gap: gap.length, nuevos: 0, ultima: lastCov });

  // Interruptor de envío (base): learnings config alerta_cartola = 'on'
  const cfg = await sb("learnings?select=value&kind=eq.config&key=eq.alerta_cartola");
  const ON = String(cfg?.[0]?.value || "off").trim().toLowerCase() === "on";

  const asunto = gap.length === 1 ? `Falta la cartola BICE del ${lindo(gap[0])}` : `${gap.length} días sin cartola BICE`;
  const lista = gap.map(lindo).join(", ");
  const html = `<div style="font-family:-apple-system,Arial,sans-serif;max-width:520px;color:#3D3D3D;font-size:14px;line-height:1.55">
    <p>Hola:</p>
    <ul style="margin:8px 0 12px;padding-left:18px">
      <li><b>Cuenta honorarios, falta${gap.length !== 1 ? "n" : ""}:</b> ${lista}</li>
      ${lastCov ? `<li><b>Movimientos cargados hasta (honorarios):</b> ${lindo(lastCov)}</li>` : ""}
    </ul>
    <p>Ninguna cartola posterior trae los movimientos de ${gap.length !== 1 ? "esos días" : "ese día"}: quedan <b>sin conciliar</b>. Carga la cartola en la app o pídela a BICE.</p>
    <p style="color:#99ABB4;font-size:12px;margin-top:20px">Liberona Escala Abogados &middot; aviso automático de cartolas</p>
  </div>`;

  if (!ON || body.dryRun) return json({ ok: true, gap: gap.length, dias: gap, nuevos: nuevos.length, ultima: lastCov, enviado: false, motivo: body.dryRun ? "dry-run pedido" : "interruptor apagado (learnings config alerta_cartola != on) — dry-run" });

  try {
    const client = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: GMAIL_USER, password: GMAIL_PASS } } });
    await client.send({ from: `${ESTUDIO} <${GMAIL_USER}>`, to: [...SOCIOS], subject: toAscii(asunto), content: "Ver el contenido en formato HTML.", html: qpSafe(html) });
    await client.close();
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
  // Recordar los días avisados (solo los que siguen en la ventana) para no repetir el correo por el mismo salto.
  const val = JSON.stringify([...new Set([...avisados.filter((s) => gap.includes(s)), ...gap])].sort());
  const hdr = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" };
  const g = cfgAv?.[0]?.id ? await fetch(`${SB_URL}/rest/v1/learnings?id=eq.${cfgAv[0].id}`, { method: "PATCH", headers: hdr, body: JSON.stringify({ value: val }) })
    : await fetch(`${SB_URL}/rest/v1/learnings`, { method: "POST", headers: hdr, body: JSON.stringify({ kind: "config", key: "alerta_cartola_avisados", value: val, estudio_id: "lea" }) });
  // Correo enviado pero sin guardar los días: queda como error para que la vigilancia lo vea (si no, se reenviaría cada día).
  if (!g.ok) return json({ ok: false, enviado: true, error: `Aviso enviado, pero no se guardaron los días avisados (${g.status})`, dias: gap }, 500);
  return json({ ok: true, gap: gap.length, dias: gap, nuevos: nuevos.length, ultima: lastCov, enviado: true });
});
