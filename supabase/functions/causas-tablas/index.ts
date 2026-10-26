// Edge Function: causas-tablas
// Revisa si las causas del estudio (tabla causas) están en la tabla del día de su Corte de Apelaciones o de la Corte Suprema, leyendo el Monitor de
// Salas público del Poder Judicial (salas.pjud.cl): por sala, las tablas del día (N° de orden, rol, materia, carátula, estado), la
// causa que se está viendo, «a verse hasta el N°», horario, integración y videoconferencia. Sin captcha ni clave: es el mismo
// flujo de la página (entrar a la sala crea la sesión). www.pjud.cl (Programación de Salas, Estados Diarios) responde con captcha
// a los servidores (verificado 24-10-2026): no se usa ni se intenta saltar. Solo se consultan las Cortes con causas activas.
// Dos modos (crons de días hábiles): detección (cada hora, todas las salas de esas Cortes) y body.seguir (cada 15 minutos, solo
// las salas donde hoy hay una causa nuestra). Aviso por correo desde la casilla de la oficina «Hola <abogado>,» al abogado
// responsable con copia al dueño del cliente, a los no socios y a learnings config causas_avisar_a: (1) la causa está en la tabla
// de hoy; (2) se acerca su turno (se está viendo hasta 2 números antes). Cada cambio queda en causas_seguimiento. Una causa que
// no aparece queda «Sin tabla hoy» (el Monitor solo muestra el día). Si el Monitor no se puede leer: «No se pudo revisar» y un
// correo al día como máximo a learnings config causas_avisar_fallas. Interruptor learnings config causas_tablas = 'on' (sin 'on'
// revisa y guarda pero no envía). body.causa_id / body.client_id = solo esas («Revisar ahora»); body.dryRun = no guarda ni envía.
// Desde el 26-10-2026 la revisión principal la hace el computador de la oficina (scripts/pjud-local, modo local: Programación de
// Salas con días de anticipación + body.monitor con las salas leídas); aquí se aplica la misma regla (procesarMonitor). El 403
// del Monitor era el ritmo de consultas (con 2 s entre cada una no rechaza). body.vigilar (cron 07:15, días hábiles): si el
// computador no revisó, el servidor revisa el Monitor del día como respaldo; el aviso de falla sale solo si una causa no se
// pudo revisar por ninguna fuente, y si el computador lleva más de un día hábil sin revisar se avisa aparte.
// Auth: CRON_SECRET o sesión de un usuario del dominio de la oficina. verify_jwt=false.

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { enviarPush } from "../_shared/push.ts";

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const GMAIL_USER = Deno.env.get("GMAIL_USER") || "";
const GMAIL_PASS = Deno.env.get("GMAIL_PASS") || "";
const MON = "https://salas.pjud.cl/monitor", MON_SUP = "https://salas.pjud.cl/monitorSup";
const SUPREMA = "6050000";
const UA = "Mozilla/5.0";
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const sinTildes = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
const toAscii = (s: string) => sinTildes(s).replace(/[–—]/g, "-").replace(/[^\x20-\x7E]/g, "");
const nl = (s: string) => sinTildes(s).toLowerCase().replace(/\s+/g, " ").trim();
const dmy = (iso: string) => String(iso || "").slice(0, 10).split("-").reverse().join("-");
const pausa = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const ahoraCL = () => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` }; };
const HORARIO_TXT = "días hábiles de 08:00 a 15:45";
const CAJA = (inner: string) => `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,Helvetica,sans-serif;background:#f0f2f4;margin:0;padding:20px"><div style="max-width:620px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #e4e8eb;padding:22px">${inner}</div></body></html>`;
const P = (t: string) => `<p style="font-size:14px;color:#3D3D3D;margin:0 0 12px">${t}</p>`;
const PIE = (t: string) => `<p style="font-size:12px;color:#537281;margin:16px 0 0">${t}</p>`;
const FILAS = (xs: [string, string][]) => `<table style="width:100%;border-collapse:collapse;font-size:13px;color:#3D3D3D">${xs.filter((x) => x[1]).map(([k, v]) => `<tr><td style="padding:7px 10px;border-top:1px solid #E4E8EB;color:#537281;white-space:nowrap;vertical-align:top">${k}</td><td style="padding:7px 10px;border-top:1px solid #E4E8EB;font-weight:600">${v}</td></tr>`).join("")}</table>`;
async function enviar(to: string[], cc: string[], subject: string, text: string, html: string) {
  const client = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: GMAIL_USER, password: GMAIL_PASS } } });
  try { await client.send({ from: `Oficina <${GMAIL_USER}>`, to, ...(cc.length ? { cc } : {}), subject: toAscii(subject), content: toAscii(text), html }); } finally { await client.close().catch(() => null); }
}
// Lista de nombres para el saludo: «Cristóbal», «Cristóbal y Martina».
const saludo = (ns: string[]) => ns.length > 1 ? `${ns.slice(0, -1).join(", ")} y ${ns[ns.length - 1]}` : ns[0] || "equipo";

// deno-lint-ignore no-explicit-any
async function rest(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${path.split("?")[0]}: ${r.status} ${await r.text()}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}

// ─── Monitor de Salas (salas.pjud.cl) ───
const fallaRed = (e: Error): never => { throw new Error(e?.name === "TimeoutError" ? "salas.pjud.cl no respondió en 30 segundos" : `no se pudo conectar con salas.pjud.cl (${e?.message || e})`); };
// GET/POST con las cookies de la sesión (Map) que el sitio entrega, igual que un navegador.
// El sitio rechaza (403) las consultas seguidas: con 2 segundos entre cada una no rechaza ninguna (medido el 26-10-2026, 33
// consultas de las 3 salas de La Serena; sin pausa, rechazó 10 de 16).
async function monFetch(url: string, jar: Map<string, string>, body?: Record<string, string>, intento = 0): Promise<string> {
  await pausa(2000);
  const r = await fetch(url, { method: body ? "POST" : "GET", body: body ? new URLSearchParams(body) : undefined, signal: AbortSignal.timeout(30000),
    headers: { "User-Agent": UA, ...(jar.size ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}), ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) } }).catch(fallaRed);
  for (const c of r.headers.getSetCookie?.() || []) { const kv = c.split(";")[0], i = kv.indexOf("="); if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); }
  // El sitio rechaza a ratos consultas muy seguidas (403): se espera y se reintenta una vez.
  if ((r.status === 403 || r.status >= 500) && intento < 1) { await r.body?.cancel(); await pausa(8000); return monFetch(url, jar, body, intento + 1); }
  if (!r.ok) throw new Error(`salas.pjud.cl respondió con error ${r.status}`);
  return await r.text().catch(() => { throw new Error("salas.pjud.cl cortó la respuesta"); });
}
// Los controladores anteponen avisos de PHP al JSON; si no hay JSON es una respuesta inesperada (nunca se toma como «sin tabla»).
// deno-lint-ignore no-explicit-any
const parseJ = (t: string, que: string): any => { const i = t.search(/[[{"]/); try { return JSON.parse(i > 0 ? t.slice(i) : t); } catch { throw new Error(`salas.pjud.cl respondió algo inesperado al leer ${que}${/no permitido/i.test(t) ? " (sesión no aceptada)" : ""}`); } };
const limpio = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();

let _cortes: { nombre: string; valor: string }[] | null = null;
async function cortesMonitor() {
  if (_cortes) return _cortes;
  const t = await monFetch(`${MON}/monitor.php`, new Map());
  _cortes = [...t.matchAll(/<option value="([^"]+)"[^>]*>([^<]+)/g)].filter((m) => m[1] !== "0").map((m) => ({ valor: m[1], nombre: limpio(m[2]) }));
  if (!_cortes.length) throw new Error("salas.pjud.cl no mostró la lista de Cortes");
  return _cortes;
}
type Fila = { orden: number; rol: string; materia: string; caratulado: string; estado: string; alegato: string };
type Sala = { num: string; nombre: string; tablas: { glosa: string; filas: Fila[] }[]; viendo: string | null; hasta: string | null; horario: string | null; video: string | null; ministros: string[] };
// Una sala: entrar (la sesión de la Corte queda en la sala elegida) y leer sus tablas del día y el resto de la información.
async function leerSala(jar: Map<string, string>, corteValor: string, num: string, nombre: string): Promise<Sala> {
  const idx = await monFetch(`${MON}/index.php`, jar, { cod_corte: corteValor, num_sala: num });
  const salaEnc = idx.match(/id="num_sala" value="([^"]+)"/)?.[1];
  if (!salaEnc) throw new Error(`salas.pjud.cl no abrió la ${nombre}`);
  const post = async (f: string, extra: Record<string, string> = {}) => parseJ(await monFetch(`${MON}/controlador/${f}.php`, jar, { corte: corteValor, sala: salaEnc, ...extra }), f);
  const lt = await post("listaTablas");
  const tablas: Sala["tablas"] = [];
  for (const d of Array.isArray(lt?.datos) ? lt.datos : []) {
    const ct = await post("cargaTablas", { tabla: String(d.tip_tabla) });
    tablas.push({ glosa: limpio(d.tabla), filas: (Array.isArray(ct?.detalle) ? ct.detalle : []).map((x: Record<string, unknown>) => ({ orden: Number(x.orden), rol: limpio(x.crr_causa), materia: limpio(x.gls_causa), caratulado: limpio(x.caratulado), estado: limpio(x.estado), alegato: limpio(x.alegato) })) });
  }
  const v = await post("listaCausaViendo").catch(() => null), inf = await post("listaInformacionSala").catch(() => null);
  const vid = await post("listaVideollamada").catch(() => null), min = await post("listaMinistro").catch(() => null);
  const ms = (Array.isArray(min) ? min : Array.isArray(min?.datos) ? min.datos : []).map((m: Record<string, unknown>) => `${limpio(m.glosa_cargo)}: ${limpio(m.nombre)}`.replace(/^: /, "")).filter(Boolean);
  return { num, nombre, tablas, viendo: v?.causa_viendo ? limpio(v.causa_viendo) : null, hasta: inf?.info_numorden ? limpio(inf.info_numorden) : null,
    horario: inf?.hr_desde && inf?.hr_hasta ? `${limpio(inf.hr_desde)} a ${limpio(inf.hr_hasta)}` : null,
    video: vid?.videollamada && /^https?:/.test(String(vid.videollamada)) ? String(vid.videollamada) : null, ministros: ms };
}
// Corte Suprema (monitorSup): la sala va por su número (1 Civil, 2 Penal, 3 Constitucional, 4 Mixta), sin sesión. No informa
// la causa en curso: se toma la fila cuyo estado dice «Alegando» o «Relatando»; no informa horario ni «a verse hasta».
async function leerSalaSuprema(jar: Map<string, string>, num: string, nombre: string): Promise<Sala> {
  const post = async (f: string, extra: Record<string, string> = {}) => parseJ(await monFetch(`${MON_SUP}/controlador/${f}.php`, jar, { sala: num, ...extra }), f);
  const lt = await post("listaTablas");
  const tablas: Sala["tablas"] = [];
  for (const d of Array.isArray(lt?.datos) ? lt.datos : []) {
    const ct = await post("cargaTablasSuprema", { tabla: String(d.tip_tabla) });
    tablas.push({ glosa: limpio(d.tabla), filas: (Array.isArray(ct?.detalle) ? ct.detalle : []).map((x: Record<string, unknown>) => ({ orden: Number(x.orden), rol: limpio(x.crr_causa), materia: limpio(x.gls_causa), caratulado: limpio(x.caratulado), estado: limpio(x.estado), alegato: limpio(x.alegato) })) });
  }
  const activa = tablas.flatMap((t) => t.filas).find((f) => /alegando|relatando/i.test(f.estado));
  const vid = await post("listaVideollamadaN", { competencia: "-1" }).catch(() => null), min = await post("listaMinistro", { competencia: "-1" }).catch(() => null);
  const ms = (Array.isArray(min) ? min : Array.isArray(min?.datos) ? min.datos : []).map((m: Record<string, unknown>) => `${limpio(m.glosa_cargo)}: ${limpio(m.nombre)}`.replace(/^: /, "")).filter(Boolean);
  return { num, nombre, tablas, viendo: activa ? activa.rol : null, hasta: null, horario: null, video: vid?.videollamada && /^https?:/.test(String(vid.videollamada)) ? String(vid.videollamada) : null, ministros: ms };
}
// «Tercera, CONSTITUCIONAL» → «Tercera Sala (Constitucional)».
const salaSup = (x: string) => { const [a, b] = limpio(x).split(/\s*,\s*/); return b ? `${a} Sala (${b.charAt(0)}${b.slice(1).toLowerCase()})` : limpio(x); };
const esSuprema = (c: { instancia?: string; corte_codigo?: string }) => c.instancia === "suprema" || c.corte_codigo === SUPREMA;
// La causa en una sala: mismo rol-año y (misma materia que su libro o una palabra de la carátula en común). El rol se repite en
// cada libro de la Corte, por eso no basta el número. En la Corte Suprema el rol es único en el año: basta el rol.
// deno-lint-ignore no-explicit-any
function buscarEnSala(c: any, s: Sala) {
  const unico = esSuprema(c);
  const rolTxt = `${Number(c.rol)}-${c.anio}`;
  const lib = nl(c.libro_nombre || "").replace(/[^a-z ]/g, "").split(" ").find((w) => w.length > 3)?.slice(0, 6) || "";
  const pal = new Set(nl(c.caratula || "").replace(/[^a-z ]/g, " ").split(" ").filter((w) => w.length >= 5));
  for (const t of s.tablas) for (const f of t.filas) {
    if (f.rol.replace(/^0+/, "") !== rolTxt) continue;
    const libOk = !!lib && nl(f.materia).includes(lib);
    const carOk = nl(f.caratulado).replace(/[^a-z ]/g, " ").split(" ").some((w) => pal.has(w));
    if (unico || libOk || carOk || (!lib && !pal.size)) {
      const vf = s.viendo ? t.filas.find((x) => x.rol === s.viendo) : null;
      return { fila: f, tabla: t.glosa, viendo: vf ? vf.orden : null };
    }
  }
  return null;
}

// Configuración, causas y destinatarios de los avisos (una sola regla para el Monitor y para el computador de la oficina).
async function contexto(filtro: string) {
  const cfg = await rest("learnings?kind=eq.config&key=in.(causas_tablas,causas_avisar_a,causas_avisar_fallas,agente_casilla)&select=key,value");
  const ON = String(cfg.find((c: { key: string }) => c.key === "causas_tablas")?.value || "").toLowerCase() === "on";
  const dom = String(cfg.find((c: { key: string }) => c.key === "agente_casilla")?.value || "").split("@")[1] || "";
  const lista = (k: string) => String(cfg.find((c: { key: string }) => c.key === k)?.value || "").split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter((e) => e && dom && e.endsWith("@" + dom));
  const [todas, miembros, clientes] = await Promise.all([
    rest(`causas?select=*&${filtro}&order=created_at.asc`),
    rest("miembros?select=email,nombre,rol"),
    rest("clients?select=id,name,abogado_responsable"),
  ]);
  const nomCli: Record<string, string> = Object.fromEntries(clientes.map((c: { id: string; name: string }) => [c.id, c.name]));
  const duenoCli: Record<string, string> = Object.fromEntries(clientes.map((c: { id: string; abogado_responsable: string }) => [c.id, c.abogado_responsable || ""]));
  // Correo del abogado por su nombre (miembros trae alias): la dirección más corta del dominio de la oficina.
  const correoDe = (n: string) => { const k = String(n || "").trim().toLowerCase(); if (!k) return null;
    const ms = miembros.filter((m: { email: string; nombre: string }) => String(m.nombre || "").toLowerCase().split(/\s+/)[0] === k.split(/\s+/)[0] && String(m.email || "").toLowerCase().endsWith("@" + dom));
    return ms.map((m: { email: string }) => m.email.toLowerCase()).sort((a: string, b: string) => a.length - b.length)[0] || null; };
  // Equipo en copia (decisión del usuario 23-10): el abogado dueño del cliente y los miembros que no son socios, más causas_avisar_a.
  const noSocios = [...new Set(miembros.filter((m: { rol: string }) => m.rol !== "admin").map((m: { nombre: string }) => correoDe(m.nombre)).filter(Boolean))] as string[];
  const equipo = lista("causas_avisar_a");
  // Para: el abogado de la causa (o el dueño del cliente); copia: dueño del cliente, no socios y causas_avisar_a.
  // deno-lint-ignore no-explicit-any
  const destinos = (c: any) => {
    const aAbog = correoDe(c.abogado), aDueno = correoDe(duenoCli[c.client_id]);
    const para = (aAbog ? [aAbog] : aDueno ? [aDueno] : equipo.slice(0, 1)) as string[];
    const cc = [...new Set([aDueno, ...noSocios, ...equipo].filter((e) => e && !para.includes(e as string)))] as string[];
    return { para, cc, nombreA: aAbog ? String(c.abogado).trim().split(/\s+/)[0] : String(duenoCli[c.client_id] || "").split(/\s+/)[0] || "equipo" };
  };
  return { ON, fallasA: lista("causas_avisar_fallas"), todas, miembros, nomCli, destinos };
}
// Envía un aviso de una causa y lo deja en la bitácora (activity_log). Nunca dice «enviado» si no salió.
// deno-lint-ignore no-explicit-any
async function avisarCausa(o: { ON: boolean; dryRun: boolean; quien: string }, c: any, para: string[], cc: string[], tipo: string, asunto: string, texto: string, html: string) {
  let enviado = false, motivo = "";
  if (o.dryRun) motivo = "prueba (no se envía)";
  else if (!o.ON) motivo = "aviso apagado (causas_tablas)";
  else if (!para.length) motivo = "sin destinatarios";
  else try { await enviar(para, cc, asunto, texto, CAJA(html)); enviado = true; } catch (e) { motivo = String((e as Error).message || e); }
  // Al teléfono del abogado (si activó las notificaciones): la causa de hoy no espera el horario de silencio.
  if (!o.dryRun && o.ON && para.length) await enviarPush(SB_URL, SB_KEY, para, { titulo: tipo === "cerca" ? "Se acerca la vista" : "Causa en tabla hoy", cuerpo: texto, url: "/?ir=causas", etiqueta: `causa-${c.id}` }, "causas").catch(() => null);
  if (!o.dryRun) await rest("activity_log", { method: "POST", body: JSON.stringify({ user_email: o.quien, action: enviado ? `causas.${tipo}_avisada` : `causas.${tipo}_sin_aviso`, table_name: "causas", record_id: c.id, estudio_id: c.estudio_id, detail: { title: `${enviado ? "Aviso enviado" : "Aviso NO enviado"}: ${asunto}`, para, cc, motivo: motivo || null } }) }).catch(() => null);
  return { enviado, para, cc, motivo: motivo || null };
}

// ─── Computador de la oficina (scripts/pjud-local) ───
// Consulta desde un computador de la oficina, donde pjud.cl responde sin captcha, solo las causas del estudio: Programación de
// El Monitor de Salas leído (por el servidor o por el computador de la oficina) contra nuestras causas: avisos de «en tabla hoy»
// y de turno cercano, seguimiento y estado de cada causa. Devuelve las causas que no se pudieron revisar.
// deno-lint-ignore no-explicit-any
async function procesarMonitor(k: any, causas: any[], salasPorCorte: Map<string, any>, o: { dryRun: boolean; quien: string; hoy: string; hora: string }, res: any) {
  const { ON, nomCli, destinos } = k, { dryRun, quien, hoy, hora } = o;
  // deno-lint-ignore no-explicit-any
  const corteDe = (c: any) => esSuprema(c) ? "Corte Suprema" : c.corte_nombre;
  // Revisiones ya anotadas hoy (para no repetir «Sin tabla hoy» en el seguimiento cada hora).
  const desde = new Date(`${hoy}T00:00:00-03:00`).toISOString();
  const segHoy = new Set(((await rest(`causas_seguimiento?revisado_at=gte.${encodeURIComponent(desde)}&select=causa_id`).catch(() => [])) || []).map((s: { causa_id: string }) => s.causa_id));
  const segPost = async (row: Record<string, unknown>) => { if (!dryRun) await rest("causas_seguimiento", { method: "POST", body: JSON.stringify(row) }).catch(() => null); };
  const fallidas: { c: Record<string, string>; motivo: string }[] = [];
  const origen = quien.startsWith("agente") ? "agente" : "manual", por = quien.startsWith("agente") ? null : quien;
  const fuente = `Monitor de Salas, pjud.cl, revisado el ${dmy(hoy)} a las ${hora}`;

  for (const c of causas) {
    try {
      const sc = salasPorCorte.get(corteDe(c));
      if (!sc) throw new Error("sin Corte");
      if (sc instanceof Error) throw sc;
      let hit: { fila: Fila; tabla: string; viendo: number | null; sala: Sala } | null = null;
      const malas: string[] = [];
      for (const s of sc.salas.values()) {
        if (s instanceof Error) { malas.push(s.message); continue; }
        const h = buscarEnSala(c, s); if (h) { hit = { ...h, sala: s }; break; }
      }
      // Si alguna sala no se pudo leer y la causa no apareció en las demás, no se puede afirmar que no esté en tabla.
      if (!hit && malas.length) throw new Error(malas[0]);
      res.revisadas++;
      const ahora = new Date().toISOString();
      const patch: Record<string, unknown> = { ultima_revision_at: ahora, updated_at: ahora, ultima_error: null, ultima_error_at: null, ultima_fuente: "monitor" };
      const t0 = c.ultima_tabla?.fecha === hoy && c.ultima_tabla?.fuente === "monitor" ? c.ultima_tabla : null;
      if (!hit) {
        if (!t0 && !segHoy.has(c.id)) await segPost({ causa_id: c.id, estudio_id: c.estudio_id, origen, por, en_tabla: false, tabla: null, aviso: null, resultado: "Sin tabla hoy (Monitor de Salas)" });
        if (!dryRun) await rest(`causas?id=eq.${c.id}`, { method: "PATCH", body: JSON.stringify(patch) });
        continue;
      }
      const s = hit.sala, f = hit.fila;
      const prox = { sala: s.nombre, sala_num: s.num, numero: String(f.orden), fecha: hoy, tabla: hit.tabla, caratula: f.caratulado, ingreso: f.rol, materia: f.materia,
        estado_dia: f.estado, viendo: hit.viendo, hasta: s.hasta, horario: s.horario, video: s.video, ministros: s.ministros, fuente: "monitor", aviso_cerca: !!t0?.aviso_cerca, revisado_at: ahora };
      res.en_tabla.push({ causa: `${c.rol}-${c.anio}`, corte: c.corte_nombre, ...prox });
      const nueva = String(c.avisado_fecha || "").slice(0, 10) !== hoy;
      const cerca = !prox.aviso_cerca && prox.viendo != null && f.orden > prox.viendo && f.orden - prox.viendo <= 2 && /en tabla/i.test(f.estado);
      const { para, cc, nombreA } = destinos(c);
      const rolL = `${esc(c.rol)}-${c.anio}${c.libro_nombre ? ` · ${esc(c.libro_nombre)}` : ""}`;
      const avisar = async (tipo: string, asunto: string, texto: string, html: string) => {
        const a = await avisarCausa({ ON, dryRun, quien }, c, para, cc, tipo, asunto, texto, html);
        res.avisos.push({ tipo, causa: `${c.rol}-${c.anio}`, ...a });
        return a;
      };
      let av: unknown = null;
      if (nueva) {
        av = await avisar("en_tabla", `Causa en tabla hoy: Rol ${c.rol}-${c.anio} - ${c.corte_nombre} - ${s.nombre}, número ${f.orden} de la tabla`,
          `${c.caratula || nomCli[c.client_id] || "Causa"} · Rol ${c.rol}-${c.anio}: ${c.corte_nombre}, ${s.nombre}, N° ${f.orden} de la tabla de hoy (${f.estado}).`,
          `${P(`Hola ${esc(nombreA)},`)}${P("La siguiente causa está en la tabla de hoy:")}${FILAS([["Causa", esc(c.caratula || f.caratulado)], ["Cliente", esc(nomCli[c.client_id] || "")], ["Rol", rolL], ["Corte", esc(c.corte_nombre)], ["Sala", esc(s.nombre)], ["Tabla", esc(hit.tabla)], ["N° en la tabla", String(f.orden)], ["Estado", esc(f.estado)], ["Audiencia", s.horario ? `De ${esc(s.horario)} h` : ""], ["A verse", s.hasta ? `Hasta el N° ${esc(s.hasta)}` : ""], ["Se está viendo", prox.viendo ? `N° ${prox.viendo}` : ""], ["Integración", s.ministros.map(esc).join("<br>")], ["Videoconferencia", s.video ? `<a href="${esc(s.video)}" style="color:#003C50">Ingresar</a>` : ""], ["Abogado", esc(c.abogado || "")]])}${PIE(`Fuente: ${fuente}. La app sigue la sala y avisa cuando la causa esté próxima a verse. La vista quedó en el calendario de plazos de la app.`)}`);
        if (!dryRun) await rest("plazos", { method: "POST", body: JSON.stringify({ client_id: c.client_id, titulo: `Vista en tabla · Rol ${c.rol}-${c.anio}`, descripcion: `${c.corte_nombre} · ${s.nombre} · N° ${f.orden}${c.caratula ? ` · ${c.caratula}` : ""}`, tipo: "tabla", fecha: hoy, estado: "pendiente", fuente: "causas-tablas", estudio_id: c.estudio_id }) }).catch(() => null);
        patch.avisado_fecha = hoy;
      } else if (cerca) {
        av = await avisar("cerca", `Se acerca la vista: Rol ${c.rol}-${c.anio} - ${s.nombre} - se está viendo el número ${prox.viendo} (la causa es el número ${f.orden})`,
          `${c.corte_nombre}, ${s.nombre}: se está viendo el N° ${prox.viendo}; la causa Rol ${c.rol}-${c.anio} es la N° ${f.orden}.`,
          `${P(`Hola ${esc(nombreA)},`)}${P(`En la ${esc(s.nombre)} de la ${esc(c.corte_nombre)} se está viendo el <b>N° ${prox.viendo}</b> de la tabla. La causa <b>Rol ${rolL}</b> es la <b>N° ${f.orden}</b>.`)}${FILAS([["Causa", esc(c.caratula || f.caratulado)], ["Cliente", esc(nomCli[c.client_id] || "")], ["Videoconferencia", s.video ? `<a href="${esc(s.video)}" style="color:#003C50">Ingresar</a>` : ""]])}${PIE(`Fuente: ${fuente}.`)}`);
        prox.aviso_cerca = true;
      }
      patch.ultima_tabla = prox;
      if (nueva || av || f.estado !== t0?.estado_dia)
        await segPost({ causa_id: c.id, estudio_id: c.estudio_id, origen, por, en_tabla: true, tabla: prox, aviso: av,
          resultado: `En la tabla de hoy: ${s.nombre}, N° ${f.orden} (${f.estado})${prox.viendo ? ` · se está viendo el N° ${prox.viendo}` : ""}${av ? ((av as { enviado: boolean }).enviado ? (nueva ? " · aviso enviado" : " · aviso de turno próximo enviado") : ` · aviso NO enviado: ${(av as { motivo: string }).motivo}`) : ""}` });
      if (!dryRun) await rest(`causas?id=eq.${c.id}`, { method: "PATCH", body: JSON.stringify(patch) });
    } catch (e) {
      const motivo = String((e as Error).message || e);
      res.errores.push({ causa: `${c.rol}-${c.anio}`, error: motivo });
      if (!dryRun) await rest(`causas?id=eq.${c.id}`, { method: "PATCH", body: JSON.stringify({ ultima_error: motivo, ultima_error_at: new Date().toISOString() }) }).catch(() => null);
      if (!segHoy.has(c.id)) await segPost({ causa_id: c.id, estudio_id: c.estudio_id, origen, por, en_tabla: false, tabla: null, aviso: null, resultado: `No se pudo revisar: ${motivo}` });
      fallidas.push({ c, motivo });
    }
  }
  return fallidas;
}

// Motivo de una falla en palabras de la oficina (el detalle técnico queda en el seguimiento de la causa).
const motivoLegible = (m: string) => /captcha|anti-robots/i.test(m) ? "El sitio del Poder Judicial pidió una verificación anti-robots"
  : /error (403|5\d\d)/.test(m) ? "El sitio del Poder Judicial rechazó la consulta"
  : /no respondió|no se pudo conectar|cortó/i.test(m) ? "El sitio del Poder Judicial no respondió" : "El sitio del Poder Judicial respondió algo distinto de lo esperado";
// Horario de las revisiones del computador de la oficina (scripts/pjud-local/instalar.sh): la próxima, para el aviso.
const HORARIO = { habil: ["06:30", "08:45", "12:30", "18:00"], domingo: ["19:00"] };
const proximaRevision = (hoy: string, hora: string) => {
  const d = new Date(`${hoy}T12:00:00`), dia = d.getDay();
  const deHoy = dia >= 1 && dia <= 5 ? HORARIO.habil : dia === 0 ? HORARIO.domingo : [];
  const sig = deHoy.find((h) => h > hora); if (sig) return `hoy a las ${sig}`;
  return dia >= 1 && dia <= 4 ? `mañana a las ${HORARIO.habil[0]}` : dia === 5 || dia === 6 ? `el domingo a las ${HORARIO.domingo[0]}` : `mañana a las ${HORARIO.habil[0]}`;
};
// Aviso de falla (problema): qué pasó, qué significa y qué hacer. A causas_avisar_fallas, sin copia, como máximo uno al día.
// deno-lint-ignore no-explicit-any
async function avisarFallas(k: { fallasA: string[]; miembros: any[] }, fallidas: { c: Record<string, string>; motivo: string }[], hoy: string, hora: string) {
  const desde = new Date(`${hoy}T00:00:00-03:00`).toISOString();
  const ya = await rest(`activity_log?action=eq.causas.falla_avisada&created_at=gte.${encodeURIComponent(desde)}&select=id&limit=1`).catch(() => []);
  if (ya?.length) return { enviado: false, motivo: "ya se avisó hoy" };
  let ok = false, motivo = "";
  try {
    const nombres = k.fallasA.map((e) => String(k.miembros.find((m: { email: string }) => String(m.email).toLowerCase() === e)?.nombre || e.split("@")[0]).split(/\s+/)[0]);
    const filasH = fallidas.map((x) => `<tr><td style="padding:8px;border-top:1px solid #E4E8EB"><b>${esc(String(x.c.origen || "").split(" · ")[0] || x.c.caratula || `Rol ${x.c.rol}-${x.c.anio}`)}</b><div style="font-size:11.5px;color:#537281">Rol ${esc(x.c.rol)}-${x.c.anio} · ${esc(x.c.corte_nombre)}${x.c.abogado ? ` · ${esc(x.c.abogado)}` : ""}</div></td><td style="padding:8px;border-top:1px solid #E4E8EB;font-size:12px;color:#A32D2D;text-align:right">${esc(motivoLegible(x.motivo))}</td></tr>`).join("");
    const n = fallidas.length;
    await enviar(k.fallasA, [], `No se pudo revisar la tabla - ${n === 1 ? `Rol ${fallidas[0].c.rol}-${fallidas[0].c.anio}` : `${n} causas`} - ${dmy(hoy)}`,
      `La revisión de las ${hora} no pudo confirmar en el Poder Judicial si ${n === 1 ? "la causa está" : "las causas están"} en tabla. Próxima revisión: ${proximaRevision(hoy, hora)}.`,
      CAJA(`${P(`Hola ${esc(saludo(nombres))},`)}${P(`La revisión de las ${esc(hora)} <b style="color:#A32D2D">no pudo confirmar</b> en el Poder Judicial si ${n === 1 ? "la siguiente causa está" : `las siguientes ${n} causas están`} en tabla:`)}<table style="width:100%;border-collapse:collapse;font-size:13px;color:#3D3D3D;margin:0 0 14px">${filasH}</table>${P(`<b>Qué significa:</b> no está confirmado si ${n === 1 ? "tiene" : "alguna tiene"} vista próxima. La próxima revisión automática es ${esc(proximaRevision(hoy, hora))}.`)}${P(`<b>Qué hacer:</b> si la vista puede ser pronto, revisar en <a href="https://www.pjud.cl" style="color:#003C50">pjud.cl</a> › Programación de Salas (Corte, libro y rol).`)}`));
    ok = true;
  } catch (e) { motivo = String((e as Error).message || e); }
  await rest("activity_log", { method: "POST", body: JSON.stringify({ user_email: "agente", action: "causas.falla_avisada", table_name: "causas", record_id: null, estudio_id: fallidas[0]?.c.estudio_id || "lea", detail: { title: `${ok ? "Aviso de falla enviado" : "Aviso de falla NO enviado"}: ${fallidas.length} causa${fallidas.length !== 1 ? "s" : ""} sin revisar`, para: k.fallasA, motivo: motivo || null } }) }).catch(() => null);
  return { enviado: ok, para: k.fallasA, motivo: motivo || null };
}

// Salas por causa (la tabla con su fecha, con anticipación) y el Estado Diario de su tribunal (resoluciones del día). Pocas
// consultas al día; si pjud.cl le pide captcha, se detiene y lo informa (nunca lo resuelve). Se identifica con su propia clave
// (header x-pjud-local), cuya huella SHA-256 está en learnings config causas_local_token_sha256; la clave vive solo en ese equipo.
const sha256 = async (t: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, "0")).join("");
// deno-lint-ignore no-explicit-any
async function atenderLocal(body: any, token: string) {
  const h = await rest("learnings?kind=eq.config&key=eq.causas_local_token_sha256&select=value").catch(() => []);
  if (!token || !h?.[0]?.value || await sha256(token) !== String(h[0].value)) return json({ error: "No autorizado" }, 403);
  const quien = "agente-local", { fecha: hoy, hora } = ahoraCL();
  const k = await contexto("estado=eq.activa");
  // seguir: solo las causas que hoy están en una tabla del Monitor y aún no se ven (el computador no consulta si no hay ninguna).
  // deno-lint-ignore no-explicit-any
  if (body.local === "pedido" && body.seguir) k.todas = k.todas.filter((c: any) => c.ultima_tabla?.fecha === hoy && c.ultima_tabla?.fuente === "monitor" && /en tabla/i.test(c.ultima_tabla?.estado_dia || ""));
  if (body.local === "pedido")
    return json({ ok: true, hoy, causas: k.todas.map((c: Record<string, unknown>) => ({ id: c.id, rol: c.rol, anio: c.anio, instancia: c.instancia, corte_codigo: c.corte_codigo, corte_nombre: c.corte_nombre, libro_codigo: c.libro_codigo, libro_nombre: c.libro_nombre, caratula: c.caratula, ultima_tabla: (c.ultima_tabla as { fecha?: string } | null)?.fecha === hoy ? { sala_num: (c.ultima_tabla as { sala_num?: string }).sala_num || "" } : null })) });
  if (body.local !== "resultado") return json({ error: "Pedido desconocido" }, 400);
  const dryRun = !!body.dryRun;
  // deno-lint-ignore no-explicit-any
  const porId = new Map<string, any>(k.todas.map((c: { id: string }) => [c.id, c]));
  const desde = new Date(`${hoy}T00:00:00-03:00`).toISOString();
  const segHoy = new Set(((await rest(`causas_seguimiento?revisado_at=gte.${encodeURIComponent(desde)}&resultado=like.*Programación de Salas*&select=causa_id`).catch(() => [])) || []).map((x: { causa_id: string }) => x.causa_id));
  const segPost = async (row: Record<string, unknown>) => { if (!dryRun) await rest("causas_seguimiento", { method: "POST", body: JSON.stringify(row) }).catch(() => null); };
  const out = { programacion: 0, en_tabla: [] as unknown[], resoluciones: [] as unknown[], avisos: [] as unknown[], errores: [] as unknown[], captcha: !!body.captcha };
  const fuente = `consultada desde el computador de la oficina el ${dmy(hoy)} a las ${hora}`;
  for (const r of Array.isArray(body.programacion) ? body.programacion : []) {
    const c = porId.get(r.causa_id); if (!c) continue;
    const base = { causa_id: c.id, estudio_id: c.estudio_id, origen: "agente", por: null };
    if (r.error) { out.errores.push({ causa: `${c.rol}-${c.anio}`, error: r.error }); if (!segHoy.has(c.id)) await segPost({ ...base, en_tabla: false, tabla: null, aviso: null, resultado: `Programación de Salas: no se pudo consultar (${r.error})` }); continue; }
    out.programacion++;
    // deno-lint-ignore no-explicit-any
    const filas = (Array.isArray(r.filas) ? r.filas : []).filter((x: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(x.fecha || "")));
    // deno-lint-ignore no-explicit-any
    const prox = filas.filter((x: any) => x.fecha >= hoy).sort((a: any, b: any) => a.fecha.localeCompare(b.fecha))[0] || null;
    // Consulta correcta: la causa deja de estar «No se pudo revisar».
    const patch: Record<string, unknown> = { programacion_at: new Date().toISOString(), ultima_error: null, ultima_error_at: null };
    let av: unknown = null;
    if (prox) {
      out.en_tabla.push({ causa: `${c.rol}-${c.anio}`, ...prox });
      // El día de la vista manda el Monitor (estado en vivo); antes, la programación.
      if (!(c.ultima_tabla?.fuente === "monitor" && c.ultima_tabla?.fecha === hoy)) patch.ultima_tabla = { sala: prox.sala || "", numero: String(prox.numero || ""), fecha: prox.fecha, caratula: prox.caratula || "", ingreso: prox.ingreso || "", fuente: "programacion", revisado_at: new Date().toISOString() };
      if (prox.fecha !== String(c.avisado_fecha || "").slice(0, 10)) {
        const { para, cc, nombreA } = k.destinos(c);
        const asunto = `Causa en tabla: Rol ${c.rol}-${c.anio} - ${c.corte_nombre} - ${dmy(prox.fecha)}`;
        av = await avisarCausa({ ON: k.ON, dryRun, quien }, c, para, cc, "en_tabla", asunto,
          `${c.caratula || k.nomCli[c.client_id] || "Causa"} · Rol ${c.rol}-${c.anio}: ${c.corte_nombre}${prox.sala ? `, ${prox.sala}` : ""}${prox.numero ? `, N° ${prox.numero} de la tabla` : ""}, para el ${dmy(prox.fecha)}`,
          `${P(`Hola ${esc(nombreA)},`)}${P("La siguiente causa fue puesta en tabla:")}${FILAS([["Causa", esc(c.caratula || prox.caratula || "")], ["Cliente", esc(k.nomCli[c.client_id] || "")], ["Rol", `${esc(c.rol)}-${c.anio}${c.libro_nombre ? ` · ${esc(c.libro_nombre)}` : ""}`], ["Corte", esc(c.corte_nombre)], ["Sala", esc(prox.sala || "")], ["N° en la tabla", esc(prox.numero || "")], ["Fecha de la vista", dmy(prox.fecha)], ["Abogado", esc(c.abogado || "")]])}${PIE(`Fuente: Programación de Salas, pjud.cl, ${fuente}. La vista quedó en el calendario de plazos de la app; el día de la vista la app sigue la sala y avisa cuando la causa esté próxima a verse.`)}`);
        out.avisos.push({ tipo: "en_tabla", causa: `${c.rol}-${c.anio}`, ...(av as object) });
        if (!dryRun) await rest("plazos", { method: "POST", body: JSON.stringify({ client_id: c.client_id, titulo: `Vista en tabla · Rol ${c.rol}-${c.anio}`, descripcion: `${c.corte_nombre}${prox.sala ? ` · ${prox.sala}` : ""}${prox.numero ? ` · N° ${prox.numero}` : ""}${c.caratula ? ` · ${c.caratula}` : ""}`, tipo: "tabla", fecha: prox.fecha, estado: "pendiente", fuente: "causas-tablas", estudio_id: c.estudio_id }) }).catch(() => null);
        patch.avisado_fecha = prox.fecha;
      }
    }
    if (av || !segHoy.has(c.id)) await segPost({ ...base, en_tabla: !!prox, tabla: prox, aviso: av,
      resultado: prox ? `En tabla (Programación de Salas): ${prox.sala || "sala por informar"}${prox.numero ? `, N° ${prox.numero}` : ""}, ${dmy(prox.fecha)}${av ? ((av as { enviado: boolean }).enviado ? " · aviso enviado" : ` · aviso NO enviado: ${(av as { motivo: string }).motivo}`) : ""}` : "Sin tabla (Programación de Salas, confirmado)" });
    if (!dryRun) await rest(`causas?id=eq.${c.id}`, { method: "PATCH", body: JSON.stringify(patch) }).catch(() => null);
  }
  // Resoluciones del Estado Diario: una vez por causa y fecha (causas.estado_diario_fecha guarda la última avisada).
  // deno-lint-ignore no-explicit-any
  const est = (Array.isArray(body.estados) ? body.estados : []).filter((x: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(x.fecha || ""))).sort((a: any, b: any) => a.fecha.localeCompare(b.fecha));
  const ultimaFecha = new Map<string, string>();
  for (const r of est) {
    const c = porId.get(r.causa_id); if (!c) continue;
    const ya = ultimaFecha.get(c.id) ?? String(c.estado_diario_fecha || "");
    if (r.fecha <= ya) continue;
    ultimaFecha.set(c.id, r.fecha);
    out.resoluciones.push({ causa: `${c.rol}-${c.anio}`, fecha: r.fecha, providencias: r.providencias, reservada: !!r.reservada });
    const { para, cc, nombreA } = k.destinos(c);
    const n = Number(r.providencias) || 1;
    const doc = /^https:\/\/www\.pjud\.cl\//.test(String(r.doc || "")) ? String(r.doc) : "";
    const av = await avisarCausa({ ON: k.ON, dryRun, quien }, c, para, cc, "resolucion", `Resolución en la causa: Rol ${c.rol}-${c.anio} - ${c.corte_nombre} - ${dmy(r.fecha)}`,
      `${c.caratula || k.nomCli[c.client_id] || "Causa"} · Rol ${c.rol}-${c.anio}: ${n === 1 ? "1 resolución" : `${n} resoluciones`} en el estado diario del ${dmy(r.fecha)}.${doc ? ` ${doc}` : ""}`,
      `${P(`Hola ${esc(nombreA)},`)}${P(`La siguiente causa tiene ${n === 1 ? "una resolución" : `${n} resoluciones`} en el estado diario del <b>${dmy(r.fecha)}</b>:`)}${FILAS([["Causa", esc(c.caratula || r.partes || "")], ["Cliente", esc(k.nomCli[c.client_id] || "")], ["Rol", `${esc(c.rol)}-${c.anio}${c.libro_nombre ? ` · ${esc(c.libro_nombre)}` : ""}`], ["Tribunal", esc(c.corte_nombre)], ["Resolución", doc ? `<a href="${esc(doc)}" style="color:#003C50">Ver resolución</a>` : r.reservada ? "Causa reservada: sin documento público" : "Sin documento en el estado diario"], ["Abogado", esc(c.abogado || "")]])}${PIE(`Fuente: Estado Diario, pjud.cl, ${fuente}.`)}`);
    out.avisos.push({ tipo: "resolucion", causa: `${c.rol}-${c.anio}`, ...av });
    await segPost({ causa_id: c.id, estudio_id: c.estudio_id, origen: "agente", por: null, en_tabla: false, tabla: null, aviso: av, resultado: `Estado diario del ${dmy(r.fecha)}: ${n === 1 ? "1 resolución" : `${n} resoluciones`}${doc ? "" : r.reservada ? " (causa reservada)" : ""}${av.enviado ? " · aviso enviado" : ` · aviso NO enviado: ${av.motivo}`}` });
    if (!dryRun) await rest(`causas?id=eq.${c.id}`, { method: "PATCH", body: JSON.stringify({ estado_diario_fecha: r.fecha }) }).catch(() => null);
  }
  // Monitor de Salas leído por el computador: misma regla que el servidor (procesarMonitor).
  const monOk = new Set<string>(); let fallMon: { c: Record<string, string>; motivo: string }[] = [];
  if (Array.isArray(body.monitor)) {
    // deno-lint-ignore no-explicit-any
    const salasPorCorte = new Map<string, any>();
    // deno-lint-ignore no-explicit-any
    for (const x of body.monitor as any[]) salasPorCorte.set(String(x.corte), x.error ? new Error(String(x.error)) : { valor: "", salas: new Map((x.salas || []).map((sa: any) => [String(sa.num), sa.error ? new Error(String(sa.error)) : sa])) });
    // deno-lint-ignore no-explicit-any
    const causasMon = body.seguir ? k.todas.filter((c: any) => c.ultima_tabla?.fecha === hoy && c.ultima_tabla?.fuente === "monitor") : k.todas;
    // deno-lint-ignore no-explicit-any
    const resMon: any = { revisadas: 0, en_tabla: [], avisos: [], errores: [] };
    fallMon = await procesarMonitor(k, causasMon, salasPorCorte, { dryRun, quien, hoy, hora }, resMon);
    // deno-lint-ignore no-explicit-any
    for (const c of causasMon) if (!fallMon.some((f: any) => f.c.id === c.id)) monOk.add(c.id);
    Object.assign(out, { monitor: { revisadas: resMon.revisadas, en_tabla: resMon.en_tabla, errores: resMon.errores } }); out.avisos.push(...resMon.avisos);
  }
  // Falla = causas que no se pudieron revisar por NINGUNA de las dos fuentes (Programación de Salas y Monitor) en esta corrida.
  // deno-lint-ignore no-explicit-any
  const progOk = new Set<string>((Array.isArray(body.programacion) ? body.programacion : []).filter((r: any) => !r.error).map((r: any) => String(r.causa_id)));
  if (!body.seguir && !dryRun && k.ON && k.fallasA.length) {
    const motivoGen = body.captcha ? "pjud.cl pidió una verificación anti-robots (captcha)" : body.error ? String(body.error) : "";
    // deno-lint-ignore no-explicit-any
    const fallidas = k.todas.filter((c: any) => !progOk.has(c.id) && !monOk.has(c.id)).map((c: any) => ({ c, motivo: motivoGen || fallMon.find((f: any) => f.c.id === c.id)?.motivo
      // deno-lint-ignore no-explicit-any
      || (body.programacion || []).find((r: any) => r.causa_id === c.id)?.error || "sin respuesta" }));
    if (fallidas.length) Object.assign(out, { falla: await avisarFallas(k, fallidas, hoy, hora) });
  }
  return json({ ok: true, dryRun, aviso: k.ON, ...out });
}

Deno.serve(async (req) => {
  // deno-lint-ignore no-explicit-any
  let body: any = {}; try { body = await req.json(); } catch { /* sin body */ }
  const tokLocal = (req.headers.get("x-pjud-local") || "").trim();
  if (tokLocal || body.local) {
    try { return await atenderLocal(body, tokLocal); } catch (e) { return json({ error: String((e as Error).message || e) }, 500); }
  }
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!CRON_SECRET) return json({ error: "No autorizado" }, 403);
  let quien = "agente";
  if (body.secret !== CRON_SECRET && bearer !== CRON_SECRET) {
    const u = bearer ? await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${bearer}` } }).then((r) => r.ok ? r.json() : null).catch(() => null) : null;
    const cas = await rest("learnings?kind=eq.config&key=eq.agente_casilla&select=value").catch(() => []);
    const dom = String(cas?.[0]?.value || "").split("@")[1];
    if (!u?.email || !dom || !String(u.email).toLowerCase().endsWith("@" + dom.toLowerCase())) return json({ error: "No autorizado" }, 403);
    quien = u.email;
  }
  // Vigilancia (cron de días hábiles, 07:15): si el computador de la oficina no hizo la revisión de la mañana, se avisa una vez
  // al día a causas_avisar_fallas (un computador apagado o dormido no avisa por sí mismo).
  if (body.vigilar && quien === "agente") {
    try {
      const { fecha: hoy, hora } = ahoraCL(), dia = new Date(`${hoy}T12:00:00`).getDay();
      if (dia === 0 || dia === 6) return json({ ok: true, vigilar: "fin de semana" });
      // El cron corre 10:15 y 11:15 UTC: con horario de verano o de invierno, una de las dos cae a las 07:15 de Chile.
      if (hora < "07:10") return json({ ok: true, vigilar: "antes de las 07:10" });
      const k = await contexto("estado=eq.activa");
      if (!k.todas.length) return json({ ok: true, vigilar: "sin causas activas" });
      const desde = new Date(`${hoy}T00:00:00-03:00`).toISOString();
      // deno-lint-ignore no-explicit-any
      const corrio = k.todas.some((c: any) => String(c.programacion_at || "") >= desde);
      if (corrio) return json({ ok: true, vigilar: "la revisión de la mañana corrió" });
      // Respaldo: el servidor lee el Monitor de Salas del día (abajo, revisión normal). Solo si eso también falla sale el aviso
      // (avisarFallas). Si el computador lleva más de un día hábil sin revisar, además se avisa (pierde el aviso anticipado).
      // deno-lint-ignore no-explicit-any
      const ultima = k.todas.map((c: any) => String(c.programacion_at || "")).sort().pop() || "";
      const habilAnt = (() => { const d = new Date(`${hoy}T12:00:00`); do d.setDate(d.getDate() - 1); while ([0, 6].includes(d.getDay())); return d.toISOString().slice(0, 10); })();
      if ((!ultima || ultima.slice(0, 10) < habilAnt) && !body.dryRun && k.ON && k.fallasA.length) {
        const ya = await rest(`activity_log?action=eq.causas.local_no_corrio&created_at=gte.${encodeURIComponent(desde)}&select=id&limit=1`).catch(() => []);
        if (!ya?.length) {
          let ok = false, motivo = "";
          try {
            const nombres = k.fallasA.map((e) => String(k.miembros.find((m: { email: string }) => String(m.email).toLowerCase() === e)?.nombre || e.split("@")[0]).split(/\s+/)[0]);
            const desdeTxt = ultima ? `desde el ${dmy(ultima.slice(0, 10))}` : "desde su instalación";
            await enviar(k.fallasA, [], `El computador de la oficina no revisa las causas ${desdeTxt}`,
              `El computador de la oficina no ha hecho la revisión de causas ${desdeTxt}. Sin ella no hay aviso anticipado de tablas.`,
              CAJA(`${P(`Hola ${esc(saludo(nombres))},`)}${P(`El computador de la oficina <b style="color:#A32D2D">no ha hecho la revisión de causas ${desdeTxt}</b>.`)}${P("<b>Qué significa:</b> la tabla del día se sigue revisando desde la app, pero sin ese computador no hay aviso con días de anticipación (la Programación de Salas del Poder Judicial solo responde desde ahí).")}${P("<b>Qué hacer:</b> encender el computador o abrirlo; la revisión corre sola apenas despierta.")}`));
            ok = true;
          } catch (e) { motivo = String((e as Error).message || e); }
          await rest("activity_log", { method: "POST", body: JSON.stringify({ user_email: "agente", action: "causas.local_no_corrio", table_name: "causas", record_id: null, estudio_id: "lea", detail: { title: `Computador de la oficina sin revisar causas ${ultima ? `desde ${dmy(ultima.slice(0, 10))}` : ""} · aviso ${ok ? "enviado" : "NO enviado"}`, para: k.fallasA, motivo: motivo || null, hora } }) }).catch(() => null);
        }
      }
      body.respaldo = true;   // sigue a la revisión normal del Monitor desde el servidor
    } catch (e) { if (!body.respaldo) return json({ error: String((e as Error).message || e) }, 500); }
  }
  try {
    const dryRun = !!body.dryRun, seguir = !!body.seguir && quien === "agente";
    const { fecha: hoy, hora } = ahoraCL();
    let filtro = "estado=eq.activa";
    if (body.causa_id) filtro += `&id=eq.${encodeURIComponent(body.causa_id)}`;
    else if (body.client_id) filtro += `&client_id=eq.${encodeURIComponent(body.client_id)}`;
    const { ON, fallasA, todas, miembros, nomCli, destinos } = await contexto(filtro);
    // Seguimiento: solo las causas que hoy están en una tabla y aún no se ven (estado «En Tabla»).
    // deno-lint-ignore no-explicit-any
    const causas = seguir ? todas.filter((c: any) => c.ultima_tabla?.fecha === hoy && c.ultima_tabla?.fuente === "monitor" && /en tabla/i.test(c.ultima_tabla?.estado_dia || "")) : todas;
    const res = { modo: seguir ? "seguir" : "detectar", revisadas: 0, en_tabla: [] as unknown[], avisos: [] as unknown[], errores: [] as unknown[], falla: null as unknown, salas: [] as unknown[] };
    if (!causas.length) return json({ ok: true, dryRun, aviso: ON, ...res });

    // Salas a leer por Corte (detectar: todas; seguir: solo las de hoy). Una lectura por sala y corrida, una a la vez.
    const salasPorCorte = new Map<string, { valor: string; salas: Map<string, Sala | Error> } | Error>();
    // deno-lint-ignore no-explicit-any
    const corteDe = (c: any) => esSuprema(c) ? "Corte Suprema" : c.corte_nombre;
    for (const corte of [...new Set(causas.map(corteDe))] as string[]) {
      // deno-lint-ignore no-explicit-any
      const deLaCorte = causas.filter((c: any) => corteDe(c) === corte);
      const salasHoy = new Set(deLaCorte.map((c: { ultima_tabla: { sala_num: string } }) => String(c.ultima_tabla?.sala_num || "")));
      if (corte === "Corte Suprema") {
        try {
          let lista = (parseJ(await monFetch(`${MON_SUP}/controlador/listaSalaPorSuprema.php`, new Map(), {}), "las salas de la Corte Suprema") as { numero: string; sala: string }[]).filter((s) => String(s.numero) !== "0");
          if (!lista.length) throw new Error("salas.pjud.cl no entregó las salas de la Corte Suprema");
          if (seguir) lista = lista.filter((s) => salasHoy.has(String(s.numero)));
          const salas = new Map<string, Sala | Error>(), jar = new Map<string, string>();
          for (const s of lista) { await pausa(1500); salas.set(String(s.numero), await leerSalaSuprema(jar, String(s.numero), salaSup(s.sala)).catch((e) => e as Error)); }
          salasPorCorte.set(corte, { valor: "", salas });
        } catch (e) { salasPorCorte.set(corte, e as Error); }
        continue;
      }
      try {
        const op = (await cortesMonitor()).find((o) => nl(o.nombre) === nl(corte));
        if (!op) throw new Error(`la ${corte} no aparece en el Monitor de Salas`);
        let lista = parseJ(await monFetch(`${MON}/controlador/listaSalaPorCorte.php`, new Map(), { corte: op.valor }), "las salas") as { numero: string; sala: string }[];
        if (!Array.isArray(lista) || !lista.length) throw new Error(`salas.pjud.cl no entregó las salas de la ${corte}`);
        if (seguir) lista = lista.filter((s) => salasHoy.has(String(s.numero)));
        const salas = new Map<string, Sala | Error>(), jar = new Map<string, string>();
        await monFetch(`${MON}/monitor.php`, jar);
        for (const s of lista) {
          await pausa(1500);
          salas.set(String(s.numero), await leerSala(jar, op.valor, String(s.numero), limpio(s.sala)).catch((e) => e as Error));
        }
        salasPorCorte.set(corte, { valor: op.valor, salas });
      } catch (e) { salasPorCorte.set(corte, e as Error); }
    }
    for (const [corte, x] of salasPorCorte) if (!(x instanceof Error)) for (const s of x.salas.values()) res.salas.push(s instanceof Error ? { corte, error: s.message } : { corte, sala: s.nombre, tablas: s.tablas.map((t) => `${t.glosa} (${t.filas.length})`), viendo: s.viendo });

    const fallidas = await procesarMonitor({ ON, nomCli, destinos }, causas, salasPorCorte, { dryRun, quien, hoy, hora }, res);
    if (fallidas.length && quien === "agente" && !dryRun && ON && fallasA.length) res.falla = await avisarFallas({ fallasA, miembros }, fallidas, hoy, hora);
    return json({ ok: true, dryRun, aviso: ON, ...res });
  } catch (e) {
    // La revisión completa no corrió: queda «Con falla» en Procesos (que reintenta) y en la bitácora.
    const motivo = String((e as Error).message || e);
    if (quien === "agente" && !body.dryRun) await rest("activity_log", { method: "POST", body: JSON.stringify({ user_email: "agente", action: "causas.revision_fallida", table_name: "causas", record_id: null, estudio_id: "lea", detail: { title: `La revisión de causas en tabla no se pudo hacer: ${motivo}` } }) }).catch(() => null);
    return json({ error: motivo }, 500);
  }
});
