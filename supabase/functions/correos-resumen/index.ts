// correos-resumen — el primer día de cada mes, a Cristóbal: cuántos correos salieron de la oficina en los últimos 30 días, de qué tipo,
// y cuántas veces se abrió la app desde un correo o aviso (activity_log 'correo.clic'). Es la medición de que la limpieza de correos
// funciona: lo que llega mucho y no se abre sobra. Interruptor learnings config correos_resumen ('off' lo apaga). body.dryRun no envía.
import { SMTPClient } from "../_shared/envios.ts";

const GMAIL_USER = Deno.env.get("GMAIL_USER") || "";
const GMAIL_PASS = Deno.env.get("GMAIL_PASS") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const esc = (s: string) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// deno-lint-ignore no-explicit-any
async function pag(path: string): Promise<any[]> { const out: any[] = []; for (let i = 0; i < 20; i++) { const r = await fetch(`${SB_URL}/rest/v1/${path}&limit=1000&offset=${i * 1000}`, { headers: H }); if (!r.ok) throw new Error(`${path.split("?")[0]}: ${r.status}`); const x = await r.json(); out.push(...x); if (x.length < 1000) break; } return out; }

// Tipo de correo por su asunto (los asuntos salen sin tildes).
const TIPOS: [string, RegExp][] = [
  ["Tu semana", /resumen semanal de pendientes/i], ["Fondos por pedir", /sin fondos|seguimiento/i], ["Tareas", /tarea/i],
  ["Causas", /tabla|resolucion en la causa|causa/i], ["Cartola", /cartola/i], ["Revisión de datos", /revision de datos/i],
  ["Cierre de mes", /cierre de/i], ["F29", /f29/i], ["Vigilancia normativa", /se dictaron|se dictó|se publico|servicio:|ley 21|monitor|vigilancia|diario oficial/i],
  ["Procesos automáticos", /proceso/i], ["Caja chica", /caja chica|liquidacion/i], ["Notaría", /solicitud|notaria/i],
];
const tipoDe = (a: string) => (TIPOS.find(([, re]) => re.test(a)) || ["Otros"])[0];
const DESTINOS: Record<string, string> = { tareas: "Tareas", causas: "Causas", cajachica: "Caja chica", notaria: "Notaría", rendir: "Fondos por pedir", cobros: "Banco", porcobrar: "Por cobrar", cobranza: "Cobranza", sinemitir: "Cuotas sin facturar", sinfacturar: "Trabajos sin facturar", radar: "Normativa", cajasequipo: "Cajas del equipo", notariasincliente: "OT sin cliente", compras: "Compras", gastos: "Gastos", comisiones: "Comisiones", revision: "Revisión de datos", procesos: "Procesos", cierre: "Cierre de mes", pedirfondos: "Solicitar fondos", cerrartrabajo: "Cerrar trabajo", sigueactivo: "Sigue activo", cliente: "Ficha del cliente", liquidacion: "Liquidación" };

Deno.serve(async (req) => {
  // deno-lint-ignore no-explicit-any
  let body: any = {}; try { body = await req.json(); } catch { /* cron */ }
  if (!CRON_SECRET || body.secret !== CRON_SECRET) return json({ error: "No autorizado" }, 403);
  try {
    if (!body.dryRun) { const cfg = await fetch(`${SB_URL}/rest/v1/learnings?select=value&kind=eq.config&key=eq.correos_resumen&limit=1`, { headers: H }).then((r) => r.json()); if (String(cfg?.[0]?.value || "on").toLowerCase() === "off") return json({ ok: true, skipped: "apagado" }); }
    const desde = new Date(Date.now() - 30 * 86400000).toISOString();
    const env = await pag(`correos_enviados?select=para,asunto&enviado_at=gte.${desde}&order=enviado_at.asc`);
    const clics = await pag(`activity_log?select=detail&action=eq.correo.clic&created_at=gte.${desde}&order=created_at.asc`);
    const porTipo = new Map<string, number>(); const personas = new Map<string, Set<string>>();
    for (const e of env) { const t = tipoDe(String(e.asunto || "")); porTipo.set(t, (porTipo.get(t) || 0) + 1); String(e.para || "").split(",").forEach((p) => { if (!personas.has(t)) personas.set(t, new Set()); if (p) personas.get(t)!.add(p.split("@")[0]); }); }
    const porDest = new Map<string, number>();
    for (const c of clics) { let d = ""; try { d = String(JSON.parse(String(c.detail || "{}")).destino || ""); } catch { /* sin detalle */ } if (d) { const k = DESTINOS[d] || d; porDest.set(k, (porDest.get(k) || 0) + 1); } }
    const filasT = [...porTipo.entries()].sort((a, b) => b[1] - a[1]);
    const filasD = [...porDest.entries()].sort((a, b) => b[1] - a[1]);
    const total = env.length, semanas = 30 / 7;
    const fila = (a: string, b: string, c = "") => `<tr><td style="padding:8px 0;border-top:1px solid #EAEEF0;font-size:13.5px;color:#1F2A30;">${esc(a)}${c ? `<div style="font-size:12px;color:#66787F;">${esc(c)}</div>` : ""}</td><td align="right" style="padding:8px 0;border-top:1px solid #EAEEF0;font-size:13.5px;font-weight:700;color:#1F2A30;white-space:nowrap;">${esc(b)}</td></tr>`;
    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#ECEFF1;margin:0;padding:22px 12px;"><div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;"><div style="background:#003C50;padding:20px 28px;text-align:center;"><img src="https://gestion.leabogados.cl/le-logo-blanco.png" alt="Liberona Escala Abogados" height="28" width="184" style="height:28px;width:184px;display:inline-block;border:0;"/></div><div style="padding:26px;">
<div style="font-size:18px;color:#1F2A30;font-weight:700;margin-bottom:6px;">Hola Cristóbal</div>
<div style="font-size:13.5px;color:#3D3D3D;line-height:1.6;margin-bottom:16px;">En los últimos 30 días salieron <b>${total} correos</b> de la oficina (unos ${Math.round(total / semanas)} por semana) y se abrió la app ${clics.length} ${clics.length === 1 ? "vez" : "veces"} desde un correo o aviso.</div>
<div style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#003C50;margin-bottom:4px;">Correos enviados</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${filasT.map(([t, n]) => fila(t, String(n), `${personas.get(t)?.size || 0} destinatario${(personas.get(t)?.size || 0) === 1 ? "" : "s"}`)).join("") || fila("Sin envíos registrados", "0")}</table>
<div style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#003C50;margin:20px 0 4px;">Aperturas desde un correo o aviso</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${filasD.map(([t, n]) => fila(t, String(n))).join("") || fila("Sin aperturas registradas", "0")}</table>
</div><div style="padding:14px 26px;border-top:1px solid #EAEEF0;text-align:center;font-size:11px;color:#9DAEB4;">gestion.leabogados.cl · Liberona Escala Abogados</div></div></body></html>`;
    const res = { total, por_tipo: filasT, aperturas: filasD, clics: clics.length };
    if (body.dryRun) return json({ ok: true, dryRun: true, ...res, html });
    const to = String(body.testTo || "cl@leabogados.cl").toLowerCase();
    const c = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: GMAIL_USER, password: GMAIL_PASS } } });
    try { await c.send({ from: `Liberona Escala Abogados <${GMAIL_USER}>`, to: [to], subject: "Correos y avisos de los ultimos 30 dias", content: "Ver el contenido en formato HTML.", html: html.replace(/[ \t]+$/gm, "") }); } finally { await c.close(); }
    return json({ ok: true, enviado_a: to, ...res });
  } catch (e) { return json({ error: String((e as Error).message || e) }, 500); }
});
