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
// Auth: CRON_SECRET o sesión de un usuario del dominio de la oficina. verify_jwt=false.

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

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
async function monFetch(url: string, jar: Map<string, string>, body?: Record<string, string>, intento = 0): Promise<string> {
  const r = await fetch(url, { method: body ? "POST" : "GET", body: body ? new URLSearchParams(body) : undefined, signal: AbortSignal.timeout(30000),
    headers: { "User-Agent": UA, ...(jar.size ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}), ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) } }).catch(fallaRed);
  for (const c of r.headers.getSetCookie?.() || []) { const kv = c.split(";")[0], i = kv.indexOf("="); if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); }
  // El sitio rechaza a ratos consultas muy seguidas (403): se espera y se reintenta una vez.
  if ((r.status === 403 || r.status >= 500) && intento < 1) { await r.body?.cancel(); await pausa(3000); return monFetch(url, jar, body, intento + 1); }
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
  if (!o.dryRun) await rest("activity_log", { method: "POST", body: JSON.stringify({ user_email: o.quien, action: enviado ? `causas.${tipo}_avisada` : `causas.${tipo}_sin_aviso`, table_name: "causas", record_id: c.id, estudio_id: c.estudio_id, detail: { title: `${enviado ? "Aviso enviado" : "Aviso NO enviado"}: ${asunto}`, para, cc, motivo: motivo || null } }) }).catch(() => null);
  return { enviado, para, cc, motivo: motivo || null };
}

// ─── Computador de la oficina (scripts/pjud-local) ───
// Consulta desde un computador de la oficina, donde pjud.cl responde sin captcha, solo las causas del estudio: Programación de
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
  if (body.local === "pedido")
    return json({ ok: true, hoy, causas: k.todas.map((c: Record<string, unknown>) => ({ id: c.id, rol: c.rol, anio: c.anio, instancia: c.instancia, corte_codigo: c.corte_codigo, corte_nombre: c.corte_nombre, libro_codigo: c.libro_codigo, libro_nombre: c.libro_nombre, caratula: c.caratula })) });
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
  // Captcha o error general en el computador: aviso a causas_avisar_fallas, como máximo uno al día.
  if ((body.captcha || body.error) && !dryRun && k.ON && k.fallasA.length) {
    const ya = await rest(`activity_log?action=eq.causas.local_falla&created_at=gte.${encodeURIComponent(desde)}&select=id&limit=1`).catch(() => []);
    if (!ya?.length) {
      const motivo = body.captcha ? "pjud.cl pidió una verificación anti-robots (captcha); la consulta se detuvo sin responderla" : String(body.error);
      let ok = false; try { await enviar(k.fallasA, [], `La consulta de causas desde el computador de la oficina se detuvo - ${dmy(hoy)}`, motivo, CAJA(`${P("Hola,")}${P(`La consulta de las causas en pjud.cl desde el computador de la oficina <b style="color:#A32D2D">se detuvo</b>.`)}${PIE(`Motivo: ${esc(motivo)}. Mientras tanto, el día de la vista sigue funcionando el Monitor de Salas.`)}`)); ok = true; } catch { /* queda en la bitácora */ }
      await rest("activity_log", { method: "POST", body: JSON.stringify({ user_email: quien, action: "causas.local_falla", table_name: "causas", record_id: null, estudio_id: "lea", detail: { title: `Consulta desde el computador de la oficina detenida: ${motivo}`, aviso_enviado: ok } }) }).catch(() => null);
    }
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

    // Revisiones ya anotadas hoy (para no repetir «Sin tabla hoy» en el seguimiento cada hora).
    const desde = new Date(`${hoy}T00:00:00-03:00`).toISOString();
    const segHoy = new Set(((await rest(`causas_seguimiento?revisado_at=gte.${encodeURIComponent(desde)}&select=causa_id`).catch(() => [])) || []).map((s: { causa_id: string }) => s.causa_id));
    const segPost = async (row: Record<string, unknown>) => { if (!dryRun) await rest("causas_seguimiento", { method: "POST", body: JSON.stringify(row) }).catch(() => null); };
    const fallidas: { c: Record<string, string>; motivo: string }[] = [];
    const origen = quien === "agente" ? "agente" : "manual", por = quien === "agente" ? null : quien;
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
    // Aviso de falla: solo corridas programadas, a causas_avisar_fallas, sin copia y como máximo uno al día.
    if (fallidas.length && quien === "agente" && !dryRun && ON && fallasA.length) {
      const ya = await rest(`activity_log?action=eq.causas.falla_avisada&created_at=gte.${encodeURIComponent(desde)}&select=id&limit=1`).catch(() => []);
      if (!ya?.length) {
        let ok = false, motivo = "";
        try {
          const nombres = fallasA.map((e) => String(miembros.find((m: { email: string }) => String(m.email).toLowerCase() === e)?.nombre || e.split("@")[0]).split(/\s+/)[0]);
          const filasH = fallidas.map((x) => `<tr><td style="padding:8px;border-top:1px solid #E4E8EB"><b>${esc(String(x.c.origen || "").split(" · ")[0] || x.c.caratula || `Rol ${x.c.rol}-${x.c.anio}`)}</b><div style="font-size:11.5px;color:#537281">Rol ${esc(x.c.rol)}-${x.c.anio} · ${esc(x.c.corte_nombre)} · ${esc(nomCli[x.c.client_id] || "")}</div></td><td style="padding:8px;border-top:1px solid #E4E8EB;color:#A32D2D;font-weight:600">${esc(x.motivo)}</td></tr>`).join("");
          await enviar(fallasA, [], `No se pudo revisar la tabla de hoy - ${fallidas.length === 1 ? `Rol ${fallidas[0].c.rol}-${fallidas[0].c.anio}` : `${fallidas.length} causas`} - ${dmy(hoy)}`,
            `No se pudo revisar si ${fallidas.length === 1 ? "la causa está" : "las causas están"} en la tabla de hoy.`,
            CAJA(`${P(`Hola ${esc(saludo(nombres))},`)}${P(`<b style="color:#A32D2D">No se pudo revisar</b> si ${fallidas.length === 1 ? "la siguiente causa está" : `las siguientes ${fallidas.length} causas están`} en la tabla de hoy:`)}<table style="width:100%;border-collapse:collapse;font-size:13px;color:#3D3D3D">${filasH}</table>${PIE(`Se reintenta en la próxima revisión (${HORARIO_TXT}); este aviso se envía una vez al día. Fuente: Monitor de Salas, pjud.cl.`)}`));
          ok = true;
        } catch (e) { motivo = String((e as Error).message || e); }
        await rest("activity_log", { method: "POST", body: JSON.stringify({ user_email: "agente", action: "causas.falla_avisada", table_name: "causas", record_id: null, estudio_id: fallidas[0].c.estudio_id, detail: { title: `${ok ? "Aviso de falla enviado" : "Aviso de falla NO enviado"}: ${fallidas.length} causa(s) sin revisar`, para: fallasA, motivo: motivo || null } }) }).catch(() => null);
        res.falla = { enviado: ok, para: fallasA, motivo: motivo || null };
      }
    }
    return json({ ok: true, dryRun, aviso: ON, ...res });
  } catch (e) {
    // La revisión completa no corrió: queda «Con falla» en Procesos (que reintenta) y en la bitácora.
    const motivo = String((e as Error).message || e);
    if (quien === "agente" && !body.dryRun) await rest("activity_log", { method: "POST", body: JSON.stringify({ user_email: "agente", action: "causas.revision_fallida", table_name: "causas", record_id: null, estudio_id: "lea", detail: { title: `La revisión de causas en tabla no se pudo hacer: ${motivo}` } }) }).catch(() => null);
    return json({ error: motivo }, 500);
  }
});
