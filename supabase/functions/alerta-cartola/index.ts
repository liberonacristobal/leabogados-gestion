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
  return r.ok ? await r.json() : [];
}

Deno.serve(async (req) => {
  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = await req.json(); } catch { /* sin body */ }
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const esCron = !!CRON_SECRET && (body.secret === CRON_SECRET || bearer === CRON_SECRET);
  if (!esCron) return json({ error: "No autorizado" }, 403);

  // Feriados + coberturas POR CUENTA + última fecha con movimientos de cada cuenta.
  // Antes era una sola cobertura global y solo miraba los días POSTERIORES a la última carga: no veía (a) un día que faltó en
  // medio (29-09-2026: se perdió un cargo de $60.000) ni (b) que la cuenta de gastos dejó de llegar (solo entra a mano).
  const CTAS = [{ rol: "honorarios", et: "01-40383-4", diaria: true }, { rol: "gastos", et: "01-38392-2", diaria: false }];
  const [fer, cargasAll, ...ultMovs] = await Promise.all([
    sb("feriados?select=fecha"),
    sb("cartola_cargas?select=fecha_desde,fecha_hasta,rol_cuenta,origen"),
    ...CTAS.map((c) => sb(`cartola_movimientos?select=fecha&rol_cuenta=eq.${c.rol}&order=fecha.desc&limit=1`)),
  ]);
  const feriados = new Set((fer || []).map((f) => String(f.fecha).slice(0, 10)));
  const esHabil = (d: Date) => { const w = d.getDay(); if (w === 0 || w === 6) return false; return !feriados.has(iso(d)); };
  const today = hoy();
  const gap: string[] = [];          // días hábiles sin cartola de la cuenta con envío diario (honorarios), últimos 30 días
  const atrasos: string[] = [];      // cuentas sin cartola hace más de 5 días hábiles
  let lastCov: string | null = null;
  CTAS.forEach((c, k) => {
    const cov = new Set<string>(); let maxCarga: string | null = null;
    // Cargas sin cuenta ('sin movimientos' marcados en la app) cubren ambas cuentas.
    for (const r of (cargasAll || []).filter((r) => !r.rol_cuenta || r.rol_cuenta === c.rol)) {
      let d = new Date(String(r.fecha_desde) + "T00:00:00"); const h = new Date(String(r.fecha_hasta) + "T00:00:00"); let g = 0;
      while (d <= h && g++ < 400) { cov.add(iso(d)); d.setDate(d.getDate() + 1); }
      if (r.rol_cuenta === c.rol) { const fh = String(r.fecha_hasta).slice(0, 10); if (!maxCarga || fh > maxCarga) maxCarga = fh; }
    }
    const maxMov = ultMovs[k]?.[0]?.fecha ? String(ultMovs[k][0].fecha).slice(0, 10) : null;
    const ult = [maxCarga, maxMov].filter(Boolean).sort().pop() || null;
    if (c.diaria) {
      lastCov = ult;
      const d = new Date(today); d.setDate(d.getDate() - 30); let guard = 0;
      while (d < today && guard++ < 40) { const s = iso(d); if (esHabil(d) && !cov.has(s)) gap.push(s); d.setDate(d.getDate() + 1); }
    }
    if (ult) { let n = 0; const d = new Date(ult + "T00:00:00"); d.setDate(d.getDate() + 1); let guard = 0; while (d < today && guard++ < 90) { if (esHabil(d)) n++; d.setDate(d.getDate() + 1); } if (n > 5) atrasos.push(`Cuenta ${c.rol} ${c.et}: sin cartola desde el ${lindo(ult)} (${n} días hábiles)`); }
  });
  if (!gap.length && !atrasos.length) return json({ ok: true, gap: 0, ultima: lastCov });

  // Interruptor de envío (base): learnings config alerta_cartola = 'on'
  const cfg = await sb("learnings?select=value&kind=eq.config&key=eq.alerta_cartola");
  const ON = String(cfg?.[0]?.value || "off").trim().toLowerCase() === "on";

  const asunto = gap.length === 1 ? `Falta la cartola BICE del ${lindo(gap[0])}` : gap.length ? `${gap.length} días sin cartola BICE` : `Cartola BICE atrasada`;
  const lista = gap.map(lindo).join(", ");
  const html = `<div style="font-family:-apple-system,Arial,sans-serif;max-width:520px;color:#3D3D3D;font-size:14px;line-height:1.55">
    <p>Hola:</p>
    <ul style="margin:8px 0 12px;padding-left:18px">
      ${gap.length ? `<li><b>Cuenta honorarios, falta${gap.length !== 1 ? "n" : ""}:</b> ${lista}</li>` : ""}
      ${atrasos.map((a) => `<li>${a}</li>`).join("")}
      ${lastCov ? `<li><b>Última cargada (honorarios):</b> ${lindo(lastCov)}</li>` : ""}
    </ul>
    <p>Mientras falte, los pagos de esos días quedan <b>sin conciliar</b>. Carga la cartola en la app o pídela a BICE.</p>
    <p style="color:#99ABB4;font-size:12px;margin-top:20px">Liberona Escala Abogados &middot; aviso automático de cartolas</p>
  </div>`;

  if (!ON) return json({ ok: true, gap: gap.length, dias: gap, atrasos, ultima: lastCov, enviado: false, motivo: "interruptor apagado (learnings config alerta_cartola != on) — dry-run" });

  try {
    const client = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: GMAIL_USER, password: GMAIL_PASS } } });
    await client.send({ from: `${ESTUDIO} <${GMAIL_USER}>`, to: SOCIOS.join(", "), subject: toAscii(asunto), content: "Ver el contenido en formato HTML.", html: qpSafe(html) });
    await client.close();
    return json({ ok: true, gap: gap.length, dias: gap, ultima: lastCov, enviado: true });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
