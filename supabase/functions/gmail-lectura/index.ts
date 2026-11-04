// Edge Function: gmail-lectura
// Lee los correos ENVIADOS de cada persona que conectó su Gmail (botón «Mi Gmail») y completa lo que la app no sabe de un envío:
// quién envió una factura, a quién y en qué fecha (facturas que figuran enviadas sin destinatario registrado). Solo lectura de
// Gmail: no envía, no borra, no mueve correos. Nunca guarda el texto de un correo: de cada uno toma encabezados, nombres de adjuntos
// y el comienzo del texto, y solo para calzarlo con una factura (_shared/facturaEnvioReglas.js, «coincide»: contacto del mismo cliente
// + folio). Las reglas puras están en _shared/gmailLectura.js (con pruebas).
//
// Permisos: el refresh token de cada persona vive en gmail_conexiones (solo el servidor lo lee; la app nunca lo ve).
// Horario (hora de Chile): todos los días a las 07:00 y, del 1 al 8 de cada mes, también 13:00 y 18:00. El cron corre a varias horas UTC
// (cambio de horario) y aquí se decide si toca (debeLeerAhora).
// AVISOS (no puede fallar en silencio): si Google rechaza el permiso de alguien, o pasan 2 veces el umbral sin lectura, llega un
// correo a la persona y otro a los socios, más un aviso al teléfono, y se repite cada día hasta que se reconecte. Interruptor de
// los correos en la base: learnings config gmail_lectura_avisos = 'on'; sin 'on' calcula pero no envía (dry-run).
//
// Acciones de la persona (JWT): guardar {refresh_token} · estado · desconectar · leer. De socios: estados.
// Cron: body.secret = CRON_SECRET (+ forzar:true para ignorar el horario, dryRun:true para no escribir ni avisar).
import { SMTPClient } from "../_shared/envios.ts";
import { holaEquipo } from "../_shared/correoEquipo.js";
import { enviarPush } from "../_shared/push.ts";
import { cargarEquipo } from "../_shared/equipo.js";
import { todasRest } from "../_shared/paginar.js";
import { emailsDe, enviosDetectados } from "../_shared/facturaEnvioReglas.js";
import { correoDeMensaje, debeLeerAhora, estadoConexion, planAtribucion } from "../_shared/gmailLectura.js";

const SB_URL = Deno.env.get("SUPABASE_URL") || "", SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const CLIENT_ID = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") || "", CLIENT_SECRET = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") || "";
const GMAIL_USER = Deno.env.get("GMAIL_USER") || "", GMAIL_PASS = Deno.env.get("GMAIL_PASS") || "";
const ESTUDIO = "Liberona Escala Abogados";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Content-Type": "application/json" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: CORS });
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
const toAscii = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[–—]/g, "-").replace(/[^\x20-\x7E]/g, "");
const qpSafe = (h: string) => String(h || "").replace(/[ \t]+$/gm, "");
const dmy = (iso: string) => { const d = new Date(iso); const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d); const g = (t: string) => p.find((x) => x.type === t)?.value || ""; return `${g("day")}-${g("month")}-${g("year")} a las ${g("hour")}:${g("minute")}`; };

interface Conexion { email: string; refresh_token?: string; estado: string; ultimo_ok: string | null; error: string | null; avisado_at: string | null }
// deno-lint-ignore no-explicit-any
type Fila = any;

async function sb(path: string, init: RequestInit = {}): Promise<Response> { return await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } }); }
async function sbJson(path: string): Promise<Fila[]> { const r = await sb(path); if (!r.ok) throw new Error(`${path.split("?")[0]}: ${r.status}`); return await r.json(); }
async function patchConexion(email: string, cambios: Record<string, unknown>) {
  const r = await sb(`gmail_conexiones?email=eq.${encodeURIComponent(email)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ ...cambios, updated_at: new Date().toISOString() }) });
  if (!r.ok) throw new Error(`No se pudo guardar el estado de ${email}: ${r.status}`);
}

// Quién llama: persona con sesión de la app (dominio del estudio, igual que calendario-conectar).
async function usuario(req: Request): Promise<string | null> {
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const u = bearer ? await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${bearer}` } }).then((r) => r.ok ? r.json() : null).catch(() => null) : null;
  const cas = await sbJson("learnings?kind=eq.config&key=eq.agente_casilla&select=value").catch(() => []);
  const dom = String(cas?.[0]?.value || "").split("@")[1];
  const email = String(u?.email || "").toLowerCase();
  return email && dom && email.endsWith("@" + dom.toLowerCase()) ? email : null;
}

class ErrorGoogle extends Error { permiso: boolean; constructor(msg: string, permiso: boolean) { super(msg); this.permiso = permiso; } }
async function accessToken(rt: string): Promise<string> {
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: rt, grant_type: "refresh_token" }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErrorGoogle(String(d.error_description || d.error || `token ${r.status}`), d.error === "invalid_grant" || d.error === "invalid_request" || d.error === "unauthorized_client");
  return d.access_token;
}

// Datos que se cargan una vez por corrida: facturas enviadas sin destinatario registrado y el mapa correo → cliente.
async function cargarDatos() {
  const h = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };
  const [facturas, ctc, cli, lrn, miembros] = await Promise.all([
    todasRest(SB_URL, h, "billing?select=id,invoice_no,client_id,issued_at,email_sent_at,sent_to&deleted_at=is.null&email_sent_at=not.is.null&sent_to=is.null&issued_at=not.is.null"),
    todasRest(SB_URL, h, "contacts?select=client_id,email&order=client_id.asc,email.asc"),
    todasRest(SB_URL, h, "clients?select=id,email"),
    todasRest(SB_URL, h, "learnings?select=key,value&kind=in.(factura_to,factura_cc,fondos_contacto)"),
    sbJson("miembros?select=email,nombre,rol"),
  ]);
  const mapa = new Map<string, Set<string>>();
  const agrega = (email: unknown, cid: unknown) => { const e = String(email || "").trim().toLowerCase(); if (!e.includes("@") || !cid) return; const s = mapa.get(e) || new Set<string>(); s.add(String(cid)); mapa.set(e, s); };
  (ctc as Fila[]).forEach((c) => agrega(c.email, c.client_id));
  (cli as Fila[]).forEach((c) => emailsDe(c.email).forEach((e: string) => agrega(e, c.id)));
  (lrn as Fila[]).forEach((l) => { if (/^[0-9a-f-]{36}$/i.test(String(l.key))) emailsDe(l.value).forEach((e: string) => agrega(e, l.key)); else agrega(l.key, l.value); });
  return { facturas: facturas as Fila[], mapa, miembros: miembros as Fila[] };
}

type Datos = Awaited<ReturnType<typeof cargarDatos>>;
interface Resultado { ok: boolean; revocada?: boolean; error?: string }

// Lee UN buzón. Deja su estado en gmail_conexiones: ultimo_ok solo si la lectura salió bien.
async function leerBuzon(c: Conexion, datos: Datos, dryRun = false): Promise<Resultado> {
  const ahora = new Date().toISOString();
  try {
    const at = await accessToken(String(c.refresh_token));
    const GH = { Authorization: "Bearer " + at };
    // 1) Verifica el acceso (permiso y token) con una llamada mínima: así «al día» significa que Google respondió, haya o no algo que completar.
    const pr = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: GH });
    if (pr.status === 401 || pr.status === 403) throw new ErrorGoogle(`Google rechazó el acceso al correo (${pr.status})`, true);
    if (!pr.ok) throw new Error(`Gmail respondió ${pr.status}`);
    const dom = c.email.split("@")[1] || "";
    const quien = String(datos.miembros.find((m) => String(m.email).toLowerCase() === c.email)?.nombre || c.email.split("@")[0]);
    // 2) Solo se leen correos si hay facturas «enviadas» sin prueba que completar.
    const cand = datos.facturas.filter((f) => !f.sent_to);
    let fallidos = 0, aplicados = 0;
    if (cand.length) {
      const q = encodeURIComponent("in:sent newer_than:60d (factura OR fact OR dte OR folio) -in:trash");
      const ids: string[] = []; let tok = "";
      for (let p = 0; p < 3; p++) {
        const lr = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=100${tok ? `&pageToken=${tok}` : ""}`, { headers: GH });
        if (!lr.ok) throw new Error(`Gmail (lista) respondió ${lr.status}`);
        const lj = await lr.json(); ids.push(...(lj.messages || []).map((m: Fila) => m.id)); tok = lj.nextPageToken || ""; if (!tok) break;
      }
      const correos: Fila[] = [];
      for (let i = 0; i < ids.length; i += 8) {
        await Promise.all(ids.slice(i, i + 8).map(async (id) => {
          try {
            const rr = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full&fields=id,internalDate,snippet,payload(headers,filename,mimeType,parts(filename,mimeType,parts(filename,mimeType,parts(filename,mimeType))))`, { headers: GH });
            if (!rr.ok) { fallidos++; return; }
            const cm = correoDeMensaje(await rr.json()); if (cm) correos.push(cm); else fallidos++;
          } catch { fallidos++; }
        }));
      }
      // Si no se pudo leer una parte importante, NO se da por buena la lectura (mejor «atrasada» que un «al día» falso).
      if (ids.length >= 5 && fallidos > ids.length * 0.3) throw new Error(`No se pudieron leer ${fallidos} de ${ids.length} correos`);
      const hall = enviosDetectados({ correos, facturas: cand.map((f) => ({ id: f.id, invoice_no: f.invoice_no, client_id: f.client_id, issued_at: f.issued_at })), mapa: datos.mapa, dominio: dom });
      const plan = planAtribucion({ facturas: cand, hallazgos: hall, correos, quien });
      for (const u of plan) {
        if (dryRun) { aplicados++; continue; }
        const r = await sb(`billing?id=eq.${u.id}&sent_to=is.null`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ email_sent_at: u.email_sent_at, sent_by: u.sent_by, sent_to: u.sent_to }) });
        if (!r.ok) { fallidos++; continue; }
        aplicados++;
        datos.facturas = datos.facturas.filter((f) => f.id !== u.id);   // ya tiene prueba: el siguiente buzón no la vuelve a tocar
        await sb("activity_log", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ user_email: c.email, action: "facturacion.remitente_detectado", table_name: "billing", record_id: u.id, detail: JSON.stringify({ por: u.sent_by, para: u.sent_to, correo: u.correo_id, fecha_marcada: u.fecha_marcada, fecha_real: u.fecha_real, fuente: "gmail-lectura" }), estudio_id: "lea" }) }).catch(() => null);
      }
    }
    if (!dryRun) await patchConexion(c.email, { estado: "activa", ultimo_ok: ahora, ultimo_intento: ahora, error: null });
    return { ok: true };
  } catch (e) {
    const permiso = e instanceof ErrorGoogle && e.permiso;
    const msg = String((e as Error).message || e).slice(0, 300);
    if (!dryRun) await patchConexion(c.email, permiso ? { estado: "revocada", ultimo_intento: ahora, error: msg } : { ultimo_intento: ahora, error: msg }).catch(() => null);
    return { ok: false, revocada: permiso, error: msg };
  }
}

// Avisos: a la persona y a los socios mientras su conexión esté en «reconectar» o «fallo». Se repite cada ~20 h hasta que se arregle.
async function avisar(dryRun: boolean) {
  const cons = await sbJson("gmail_conexiones?select=email,estado,ultimo_ok,error,avisado_at") as Conexion[];
  const ahora = new Date();
  const malas = cons.filter((c) => ["reconectar", "fallo"].includes(estadoConexion(c, ahora).k));
  const tocan = malas.filter((c) => !c.avisado_at || +ahora - +new Date(c.avisado_at) > 20 * 3600000);
  if (!tocan.length) return { malas: malas.length, avisados: 0, enviado: false };
  const on = String((await sbJson("learnings?select=value&kind=eq.config&key=eq.gmail_lectura_avisos").catch(() => []))?.[0]?.value || "off").trim().toLowerCase() === "on";
  if (!on || dryRun) return { malas: malas.length, avisados: 0, enviado: false, motivo: dryRun ? "dry-run pedido" : "interruptor apagado" };
  const eq = await cargarEquipo(SB_URL, SB_KEY);
  const socios: string[] = eq.socios.map((m: { email: string }) => m.email);
  const miembros = await sbJson("miembros?select=email,nombre");
  const cuando = (c: Conexion) => c.ultimo_ok ? `La última lectura buena fue el ${dmy(c.ultimo_ok)}.` : "Todavía no hubo una lectura buena.";
  const caja = (cuerpo: string, boton: string) => `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#ECEFF1;margin:0;padding:22px 12px;"><div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;"><div style="background:#003C50;padding:20px 28px;text-align:center;color:#fff;font-size:15px;font-weight:700;">${ESTUDIO}</div><div style="padding:26px;font-size:14px;color:#3D3D3D;line-height:1.6;">${cuerpo}<div style="margin-top:18px;"><a href="https://gestion.leabogados.cl/?ir=migmail" style="display:block;background:#003C50;color:#fff;text-decoration:none;padding:11px;border-radius:9px;font-size:13px;font-weight:700;text-align:center;">${boton}</a></div></div></div></body></html>`;
  const smtp = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: GMAIL_USER, password: GMAIL_PASS } } });
  try {
    for (const c of tocan) {
      const motivo = c.estado === "revocada" ? "Google rechazó el permiso" : "no se pudo leer el correo desde hace más de un día";
      const personal = `<p style="margin:0 0 12px;">${holaEquipo([c.email], miembros)}</p><p style="margin:0 0 12px;">Tu Gmail dejó de leerse en la app porque ${motivo}. ${cuando(c)} Mientras siga así, lo que envíes por correo no se registra solo.</p>`;
      await smtp.send({ from: `${ESTUDIO} <${GMAIL_USER}>`, to: [c.email], subject: "Tu Gmail se desconecto de la app", content: "Ver el contenido en formato HTML.", html: qpSafe(caja(personal, "Reconectar mi Gmail")) });
    }
    const dest = socios.filter((s) => !(tocan.length === 1 && s.toLowerCase() === tocan[0].email));
    if (dest.length) {
      const lista = tocan.map((c) => `<li style="margin:0 0 4px;">${c.email}: ${c.estado === "revocada" ? "Google rechazó el permiso" : "sin lectura buena desde hace más de un día"}.</li>`).join("");
      const cuerpo = `<p style="margin:0 0 12px;">${holaEquipo(dest, miembros)}</p><p style="margin:0 0 8px;">Falló la lectura del correo de ${tocan.length === 1 ? "1 buzón" : tocan.length + " buzones"}:</p><ul style="margin:0 0 12px;padding-left:18px;">${lista}</ul>`;
      await smtp.send({ from: `${ESTUDIO} <${GMAIL_USER}>`, to: dest, subject: toAscii(tocan.length === 1 ? `Gmail desconectado: ${tocan[0].email}` : `Gmail desconectado en ${tocan.length} buzones`), content: "Ver el contenido en formato HTML.", html: qpSafe(caja(cuerpo, "Ver conexiones")) });
    }
  } finally { await smtp.close().catch(() => null); }
  await enviarPush(SB_URL, SB_KEY, [...new Set([...tocan.map((c) => c.email), ...socios])], { titulo: "Falló la lectura del correo", cuerpo: `${tocan.length === 1 ? tocan[0].email : tocan.length + " buzones"}: hay que reconectar el Gmail.`, url: "/?ir=migmail", etiqueta: "gmail-lectura" }, "sistema").catch(() => null);
  for (const c of tocan) await patchConexion(c.email, { avisado_at: new Date().toISOString() }).catch(() => null);
  return { malas: malas.length, avisados: tocan.length, enviado: true };
}

// Vigilancia de la conexión de la OFICINA (drive_auth: fila 1 = el correo y Drive que leen boletas, notaría y contadora; fila 2 = calendario).
// Avisa a los socios, por correo y teléfono, cuando (a) el dueño de una fila no es el registrado (alguien la escribió por otra vía), (b) el
// dueño cambió a propósito en las últimas 24 h, o (c) Google rechaza el permiso de la fila. Se repite cada ~20 h hasta que se arregle.
async function vigilarOficina(dryRun: boolean) {
  const filas = await sbJson("drive_auth?select=id,email,refresh_token&order=id.asc") as Fila[];
  const regRow = (await sbJson("learnings?select=id,value&kind=eq.config&key=eq.drive_auth_duenos").catch(() => []))?.[0];
  let reg: Record<string, string> = {}; try { reg = JSON.parse(String(regRow?.value || "{}")); } catch { reg = {}; }
  const problemas: { clave: string; texto: string }[] = [];
  for (const f of filas) {
    const dueno = String(f.email || "").toLowerCase(), esperado = String(reg[String(f.id)] || "").toLowerCase();
    if (esperado && dueno !== esperado) problemas.push({ clave: `dueno-${f.id}`, texto: `La conexión ${f.id === 1 ? "del correo y Drive de la oficina" : "del calendario"} es de ${dueno} y debía ser de ${esperado}.` });
    try { await accessToken(String(f.refresh_token)); }
    catch (e) { if (e instanceof ErrorGoogle && e.permiso) problemas.push({ clave: `permiso-${f.id}`, texto: `Google rechazó el permiso de la conexión ${f.id === 1 ? "del correo y Drive de la oficina" : "del calendario"} (${dueno}).` }); }
  }
  const desde = new Date(Date.now() - 24 * 3600000).toISOString();
  const cambios = await sbJson(`activity_log?action=eq.drive.conexion_cambiada&created_at=gte.${desde}&select=detail,created_at`).catch(() => []);
  for (const c of cambios) { let d: Fila = {}; try { d = JSON.parse(String(c.detail || "{}")); } catch { d = {}; } problemas.push({ clave: `cambio-${String(c.created_at).slice(0, 13)}`, texto: `La conexión ${d.fila === 1 ? "del correo y Drive de la oficina" : "del calendario"} pasó de ${d.de} a ${d.a}.` }); }
  const blq = await sbJson(`activity_log?action=eq.drive.conexion_bloqueada&created_at=gte.${desde}&select=detail`).catch(() => []);
  if (blq.length) problemas.push({ clave: "bloqueos", texto: `Se rechazaron ${blq.length} intento(s) de reemplazar la conexión del correo de la oficina por otra cuenta (protección activa).` });
  if (!problemas.length) return { problemas: 0, enviado: false };
  const cfgAv = (await sbJson("learnings?select=id,value&kind=eq.config&key=eq.drive_auth_avisos").catch(() => []))?.[0];
  let av: Record<string, string> = {}; try { av = JSON.parse(String(cfgAv?.value || "{}")); } catch { av = {}; }
  const ahora = Date.now();
  const tocan = problemas.filter((p) => !av[p.clave] || ahora - +new Date(av[p.clave]) > 20 * 3600000);
  if (!tocan.length) return { problemas: problemas.length, enviado: false, motivo: "ya avisado" };
  const on = String((await sbJson("learnings?select=value&kind=eq.config&key=eq.gmail_lectura_avisos").catch(() => []))?.[0]?.value || "off").trim().toLowerCase() === "on";
  if (!on || dryRun) return { problemas: problemas.length, enviado: false, motivo: dryRun ? "dry-run pedido" : "interruptor apagado", detalle: tocan.map((p) => p.texto) };
  const eq = await cargarEquipo(SB_URL, SB_KEY);
  const socios: string[] = eq.socios.map((m: { email: string }) => m.email);
  const miembros = await sbJson("miembros?select=email,nombre");
  const lista = tocan.map((p) => `<li style="margin:0 0 4px;">${p.texto}</li>`).join("");
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#ECEFF1;margin:0;padding:22px 12px;"><div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;"><div style="background:#003C50;padding:20px 28px;text-align:center;color:#fff;font-size:15px;font-weight:700;">${ESTUDIO}</div><div style="padding:26px;font-size:14px;color:#3D3D3D;line-height:1.6;"><p style="margin:0 0 12px;">${holaEquipo(socios, miembros)}</p><p style="margin:0 0 8px;">Hay que revisar la conexión del correo de la oficina:</p><ul style="margin:0 0 12px;padding-left:18px;">${lista}</ul></div></div></body></html>`;
  const smtp = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: GMAIL_USER, password: GMAIL_PASS } } });
  try { await smtp.send({ from: `${ESTUDIO} <${GMAIL_USER}>`, to: socios, subject: "Revisar la conexion del correo de la oficina", content: "Ver el contenido en formato HTML.", html: qpSafe(html) }); } finally { await smtp.close().catch(() => null); }
  await enviarPush(SB_URL, SB_KEY, socios, { titulo: "Revisar la conexión del correo de la oficina", cuerpo: tocan[0].texto.slice(0, 140), etiqueta: "drive-auth" }, "sistema").catch(() => null);
  for (const p of tocan) av[p.clave] = new Date().toISOString();
  const val = JSON.stringify(av);
  if (cfgAv?.id) await sb(`learnings?id=eq.${cfgAv.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ value: val }) });
  else await sb("learnings", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ kind: "config", key: "drive_auth_avisos", value: val, estudio_id: "lea" }) });
  return { problemas: problemas.length, enviado: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const body = await req.json().catch(() => ({}));
  try {
    // ── Cron ──
    if (body.secret && CRON_SECRET && body.secret === CRON_SECRET) {
      if (!body.forzar && !debeLeerAhora(new Date())) return json({ ok: true, omitido: "fuera de horario" });
      const cons = await sbJson("gmail_conexiones?select=email,refresh_token,estado,ultimo_ok,error,avisado_at&estado=eq.activa") as Conexion[];
      const datos = await cargarDatos();
      const res: Record<string, string> = {};
      for (const c of cons) { const r = await leerBuzon(c, datos, !!body.dryRun); res[c.email] = r.ok ? "ok" : (r.revocada ? "revocada" : "error: " + r.error); }
      const av = await avisar(!!body.dryRun);
      const ofi = await vigilarOficina(!!body.dryRun).catch((e) => ({ error: String((e as Error).message || e) }));   // si la vigilancia falla, se ve en la respuesta de la corrida
      return json({ ok: true, buzones: cons.length, res, avisos: av, oficina: ofi }, (ofi as Fila).error ? 500 : 200);   // 500 = la vigilancia de la oficina falló: Procesos lo ve (no queda en silencio)
    }
    // ── Persona con sesión ──
    const email = await usuario(req);
    if (!email) return json({ error: "No autorizado" }, 403);
    const accion = String(body.accion || "estado");
    const fila = async () => (await sbJson(`gmail_conexiones?email=eq.${encodeURIComponent(email)}&select=email,refresh_token,estado,ultimo_ok,error,avisado_at`))[0] as Conexion | undefined;
    if (accion === "guardar") {
      const rt = String(body.refresh_token || "");
      if (rt.length < 20) return json({ error: "Falta el permiso de Google" }, 400);
      const r = await sb("gmail_conexiones?on_conflict=email", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ email, refresh_token: rt, estado: "activa", error: null, ultimo_ok: null, avisado_at: null, updated_at: new Date().toISOString() }) });
      if (!r.ok) return json({ error: "No se pudo guardar: " + (await r.text()).slice(0, 160) }, 500);
      const c = await fila(); const lec = c ? await leerBuzon(c, await cargarDatos()) : { ok: false, error: "sin fila" };   // primera lectura al conectar: si falla, se sabe en el momento
      const c2 = await fila();
      return json({ ok: true, lectura: lec.ok, error: lec.ok ? null : lec.error, estado: c2?.estado || null, ultimo_ok: c2?.ultimo_ok || null });
    }
    if (accion === "leer") {
      const c = await fila(); if (!c) return json({ error: "Tu Gmail no está conectado" }, 400);
      const lec = await leerBuzon(c, await cargarDatos()); const c2 = await fila();
      return json({ ok: true, lectura: lec.ok, error: lec.ok ? null : lec.error, estado: c2?.estado || null, ultimo_ok: c2?.ultimo_ok || null });
    }
    if (accion === "desconectar") {
      const c = await fila();
      if (c?.refresh_token) await fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(c.refresh_token), { method: "POST" }).catch(() => null);   // quita el permiso también en Google
      await sb(`gmail_conexiones?email=eq.${encodeURIComponent(email)}`, { method: "DELETE" });
      return json({ ok: true });
    }
    if (accion === "estado") { const c = await fila(); return json({ ok: true, estado: c?.estado || null, ultimo_ok: c?.ultimo_ok || null, error: c?.error || null }); }
    if (accion === "estados") {
      const rol = (await sbJson(`miembros?email=eq.${encodeURIComponent(email)}&select=rol`))[0]?.rol;
      if (rol !== "admin") return json({ error: "Solo socios" }, 403);
      const todas = await sbJson("gmail_conexiones?select=email,estado,ultimo_ok,error") as Conexion[];
      const miembros = await sbJson("miembros?select=email,nombre,rol");
      // Una fila por persona (una persona puede tener dos direcciones): la que tiene conexión, o si no la primera del dominio.
      const dominio = email.split("@")[1];
      const porNombre = new Map<string, Fila[]>();
      miembros.filter((m) => String(m.email).toLowerCase().endsWith("@" + dominio)).forEach((m) => { const k = String(m.nombre); porNombre.set(k, [...(porNombre.get(k) || []), m]); });
      const filas = [...porNombre.entries()].map(([nombre, ms]) => { const m = ms.find((x) => todas.some((c) => c.email === String(x.email).toLowerCase())) || ms[0]; const c = todas.find((x) => x.email === String(m.email).toLowerCase()); return { email: m.email, nombre, estado: c?.estado || null, ultimo_ok: c?.ultimo_ok || null }; });
      return json({ ok: true, filas });
    }
    return json({ error: "Acción desconocida" }, 400);
  } catch (e) { return json({ error: String((e as Error).message || e) }, 500); }
});
