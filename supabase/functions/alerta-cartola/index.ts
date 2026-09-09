// Edge Function: alerta-cartola
// Cron diario: detecta días hábiles (no feriados) SIN cartola cargada y avisa a los socios por correo.
// Fuente de verdad de "llegó cartola de un día" = cartola_cargas (procesar-cartola la escribe en cada ingesta);
// también considera la última fecha con movimientos. Un día cubierto por cartola_cargas NO se marca como hueco
// (incluye los días marcados "sin movimientos" desde la app).
// El correo sale del buzón GMAIL_USER (= contacto@leabogados.cl) y lo firma la oficina.
// SEGURIDAD: el envío está apagado por defecto. Solo envía si el secreto ALERTA_CARTOLA_ON = "on"; si no, dry-run.
// Auth: secreto compartido (ALERTA_CARTOLA_SECRET / CRON_SECRET). verify_jwt=false (llamada máquina-a-máquina).

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const ESTUDIO = "Liberona Escala Abogados";
const SOCIOS = ["cl@leabogados.cl", "ee@leabogados.cl"];
const GMAIL_USER = Deno.env.get("GMAIL_USER") || "";           // = contacto@leabogados.cl
const GMAIL_PASS = Deno.env.get("GMAIL_PASS") || "";
const CRON_SECRET = Deno.env.get("ALERTA_CARTOLA_SECRET") || Deno.env.get("CRON_SECRET") || "";
const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ON = (Deno.env.get("ALERTA_CARTOLA_ON") || "").toLowerCase() === "on";   // interruptor de envío (default OFF)

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
  return r.ok ? await r.json() : [];
}

Deno.serve(async (req) => {
  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = await req.json(); } catch { /* sin body */ }
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const esCron = !!CRON_SECRET && (body.secret === CRON_SECRET || bearer === CRON_SECRET);
  if (!esCron) return json({ error: "No autorizado" }, 403);

  // Feriados + coberturas + última fecha con datos
  const [fer, cargasAll, ultMov] = await Promise.all([
    sb("feriados?select=fecha"),
    sb("cartola_cargas?select=fecha_desde,fecha_hasta"),
    sb("cartola_movimientos?select=fecha&order=fecha.desc&limit=1"),
  ]);
  const feriados = new Set((fer || []).map((f) => String(f.fecha).slice(0, 10)));
  const cov = new Set<string>();
  let maxCarga: string | null = null;
  for (const r of cargasAll || []) {
    let d = new Date(String(r.fecha_desde) + "T00:00:00"); const h = new Date(String(r.fecha_hasta) + "T00:00:00"); let g = 0;
    while (d <= h && g++ < 400) { cov.add(iso(d)); d.setDate(d.getDate() + 1); }
    const fh = String(r.fecha_hasta).slice(0, 10); if (!maxCarga || fh > maxCarga) maxCarga = fh;
  }
  const maxMov = ultMov?.[0]?.fecha ? String(ultMov[0].fecha).slice(0, 10) : null;
  const lastCov = [maxCarga, maxMov].filter(Boolean).sort().pop() || null;
  if (!lastCov) return json({ ok: true, gap: 0, motivo: "sin datos de cartola" });

  const esHabil = (d: Date) => { const w = d.getDay(); if (w === 0 || w === 6) return false; return !feriados.has(iso(d)); };
  const today = hoy();
  const gap: string[] = [];
  const d = new Date(lastCov + "T00:00:00"); d.setDate(d.getDate() + 1); let guard = 0;
  while (d < today && guard++ < 60) { const s = iso(d); if (esHabil(d) && !cov.has(s)) gap.push(s); d.setDate(d.getDate() + 1); }
  if (!gap.length) return json({ ok: true, gap: 0, ultima: lastCov });

  const asunto = gap.length === 1 ? `Falta la cartola BICE del ${lindo(gap[0])}` : `${gap.length} días sin cartola BICE`;
  const lista = gap.map(lindo).join(", ");
  const html = `<div style="font-family:-apple-system,Arial,sans-serif;max-width:520px;color:#3D3D3D;font-size:14px;line-height:1.55">
    <p>Hola:</p>
    <p>El banco no reportó cartola de <b>${gap.length}</b> día hábil${gap.length !== 1 ? "es" : ""} que ya pasó${gap.length !== 1 ? "ron" : ""}:</p>
    <ul style="margin:8px 0 12px;padding-left:18px">
      <li><b>Falta${gap.length !== 1 ? "n" : ""}:</b> ${lista}</li>
      <li><b>Última cargada:</b> ${lindo(lastCov)}</li>
    </ul>
    <p>Mientras falte, los pagos de esos días quedan <b>sin conciliar</b>. Carga la cartola en la app o pídela a BICE.</p>
    <p style="color:#99ABB4;font-size:12px;margin-top:20px">Liberona Escala Abogados &middot; aviso automático de cartolas</p>
  </div>`;

  if (!ON) return json({ ok: true, gap: gap.length, dias: gap, ultima: lastCov, enviado: false, motivo: "ALERTA_CARTOLA_ON != on (dry-run, no se envió)" });

  try {
    const client = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: GMAIL_USER, password: GMAIL_PASS } } });
    await client.send({ from: `${ESTUDIO} <${GMAIL_USER}>`, to: SOCIOS.join(", "), subject: toAscii(asunto), content: "Ver el contenido en formato HTML.", html: qpSafe(html) });
    await client.close();
    return json({ ok: true, gap: gap.length, dias: gap, ultima: lastCov, enviado: true });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
