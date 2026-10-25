// Edge Function: documentos-cliente
// PDF que mandan los clientes por correo → Clientes/<Cliente>/Documentos del cliente, con el listado en documentos_notaria
// (origen 'cliente'). Lo llama el script «Documentos de clientes» instalado en la casilla de cada persona de la oficina:
//  · action 'lista': devuelve los remitentes que la app reconoce como de un cliente (contactos y dominios aprendidos). El
//    script busca SOLO esos remitentes, así ningún correo personal sale de la casilla.
//  · action 'documentos': recibe los PDF de esos correos; el cliente sale del remitente (contacto de un solo cliente, o dominio
//    propio aprendido de un solo cliente). El mismo correo que llega a varias casillas se guarda una vez (Message-ID).
// Nunca guarda lo dudoso: queda «Por clasificar». Auth: body.idToken = firma de Google de la casilla (Apps Script), que debe ser
// de un miembro activo del dominio de la oficina; o body.secret = CRON_SECRET (pruebas). verify_jwt=false.

import { decodeBase64 } from "jsr:@std/encoding@1/base64";
import { todasRest } from "../_shared/paginar.js";
import { rsBonita } from "../_shared/notariaDocsReglas.js";

const CLIENT_ID = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") || "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") || "";
const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const HS = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const norm = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const CARPETA = "Documentos del cliente";
// Casillas públicas: su dominio nunca identifica a un cliente.
const PUBLICOS = /^(gmail|hotmail|outlook|yahoo|icloud|live|me|proton|protonmail|gmx|aol|msn)\./i;

// deno-lint-ignore no-explicit-any
async function rest(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { ...HS, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${path.split("?")[0]}: ${r.status} ${await r.text()}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
// deno-lint-ignore no-explicit-any
// deno-lint-ignore no-explicit-any
const todas = (path: string): Promise<any[]> => todasRest(SB_URL, HS, path);
let _tok = "", _exp = 0;
async function token(): Promise<string> {
  if (_tok && _exp > Date.now() + 60000) return _tok;
  const d0 = await rest("drive_auth?id=eq.1&select=refresh_token"); const rt = d0?.[0]?.refresh_token;
  if (!rt) throw new Error("No hay conexión de Google guardada (drive_auth).");
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: rt, grant_type: "refresh_token" }) });
  const d = await r.json(); if (!r.ok) throw new Error(d.error_description || d.error || "No se pudo renovar el token de Google");
  _tok = d.access_token; _exp = Date.now() + (d.expires_in || 3600) * 1000; return _tok;
}
async function g(url: string, init: RequestInit = {}) {
  for (let i = 0; ; i++) {
    const t = await token(); const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${t}`, ...(init.headers || {}) } });
    if ((r.status === 429 || r.status >= 500) && i < 3) { await new Promise((ok) => setTimeout(ok, 800 * (i + 1))); continue; }
    return r;
  }
}
const cacheCarpeta: Record<string, string> = {};
async function carpeta(clienteFolder: string): Promise<string> {
  if (cacheCarpeta[clienteFolder]) return cacheCarpeta[clienteFolder];
  const q = encodeURIComponent(`'${clienteFolder}' in parents and name = '${CARPETA}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
  const r = await g(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`); const d = await r.json();
  if (!r.ok) throw new Error(`Drive: ${d?.error?.message || r.status}`);
  let id = d.files?.[0]?.id;
  if (!id) {
    const c = await g("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: CARPETA, mimeType: "application/vnd.google-apps.folder", parents: [clienteFolder] }) });
    const dc = await c.json(); if (!c.ok) throw new Error(`Drive: ${dc?.error?.message || c.status}`); id = dc.id;
  }
  cacheCarpeta[clienteFolder] = id; return id;
}
async function subir(folder: string, nombre: string, bytes: Uint8Array): Promise<string> {
  const q = encodeURIComponent(`'${folder}' in parents and name = '${nombre.replace(/'/g, "\\'")}' and trashed = false`);
  const r0 = await g(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`); const d0 = await r0.json();
  if (d0.files?.[0]?.id) return d0.files[0].id;
  const b = "leacli" + Date.now();
  const cab = new TextEncoder().encode(`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: nombre, parents: [folder] })}\r\n--${b}\r\nContent-Type: application/pdf\r\n\r\n`);
  const pie = new TextEncoder().encode(`\r\n--${b}--`);
  const cuerpo = new Uint8Array(cab.length + bytes.length + pie.length); cuerpo.set(cab, 0); cuerpo.set(bytes, cab.length); cuerpo.set(pie, cab.length + bytes.length);
  const r = await g("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id", { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${b}` }, body: cuerpo });
  const d = await r.json(); if (!r.ok) throw new Error(`Drive: ${d?.error?.message || r.status}`);
  return d.id;
}
const correo = (h: string) => (String(h || "").match(/<([^>]+)>/)?.[1] || String(h || "")).trim().toLowerCase();
const dmy = (iso: string) => { const [y, m, d] = String(iso || "").slice(0, 10).split("-"); return y ? `${d}-${m}-${y}` : ""; };

Deno.serve(async (req) => {
  // deno-lint-ignore no-explicit-any
  let body: any = {}; try { body = await req.json(); } catch { /* sin body */ }
  try {
    const cfg = await rest("learnings?kind=eq.config&key=in.(agente_casilla,documentos_cliente)&select=key,value");
    const dom = String(cfg.find((c: { key: string }) => c.key === "agente_casilla")?.value || "").split("@")[1]?.toLowerCase() || "";
    const ON = String(cfg.find((c: { key: string }) => c.key === "documentos_cliente")?.value || "").toLowerCase() === "on";
    let casilla = "prueba";
    if (!(CRON_SECRET && body.secret === CRON_SECRET)) {
      const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(String(body.idToken || "").trim())}`);
      const j = r.ok ? await r.json() : {};
      const email = String(j.email || "").toLowerCase();
      if (!["accounts.google.com", "https://accounts.google.com"].includes(j.iss) || String(j.email_verified) !== "true" || !dom || !email.endsWith("@" + dom)) return json({ error: "No autorizado" }, 403);
      const mb = await rest(`miembros?select=email&email=eq.${encodeURIComponent(email)}`).catch(() => []);
      if (!mb?.length) return json({ error: "La casilla no es de un miembro de la oficina" }, 403);
      casilla = email;
    }
    const dryRun = !!body.dryRun || !ON;
    const [contactos, clients, ents, dominios] = await Promise.all([
      todas("contacts?select=id,client_id,email&email=not.is.null"),
      todas("clients?select=id,name,drive_folder_id,is_internal,is_colaborador,status"),
      todas("client_entities?select=id,client_id,name"),
      todas("learnings?select=id,key,value&kind=eq.dominio_cliente"),
    ]);
    const vivos = new Set(clients.filter((c) => !c.is_internal && !c.is_colaborador).map((c) => c.id));
    // Dirección → cliente (solo si es de UN cliente) y dominio propio → cliente (aprendido, o el de contactos de un solo cliente).
    const porCorreo: Record<string, Set<string>> = {}; contactos.forEach((c) => { const e = String(c.email || "").trim().toLowerCase(); if (e.includes("@") && vivos.has(c.client_id) && !e.endsWith("@" + dom)) (porCorreo[e] = porCorreo[e] || new Set()).add(c.client_id); });
    // Un dominio vale para todo el dominio SOLO si lleva el nombre del cliente o de su razón social (tarragona.cl ↔ Tarragona), o
    // si ese cliente tiene dos o más contactos en él. «uc.cl» de un solo contacto no hace de la universidad un cliente.
    const nombreCli = (cid: string) => [clients.find((c) => c.id === cid)?.name, ...ents.filter((e) => e.client_id === cid).map((e) => e.name)].map((x) => norm(x || "").replace(/[^a-z0-9]/g, ""));
    const enDom: Record<string, Record<string, number>> = {};
    Object.entries(porCorreo).forEach(([e, s]) => { const d = e.split("@")[1]; if (!d || PUBLICOS.test(d) || d === dom || s.size !== 1) return; const cid = [...s][0]; (enDom[d] = enDom[d] || {})[cid] = (enDom[d][cid] || 0) + 1; });
    dominios.forEach((l) => { const d = String(l.key || "").toLowerCase(); if (d && !PUBLICOS.test(d) && d !== dom && vivos.has(l.value)) { enDom[d] = enDom[d] || {}; enDom[d][l.value] = enDom[d][l.value] || 0; } });
    const porDom: Record<string, Set<string>> = {};
    Object.entries(enDom).forEach(([d, m]) => { const cids = Object.keys(m); if (cids.length !== 1) return; const cid = cids[0], core = d.split(".")[0].replace(/[^a-z0-9]/g, "");
      const lleva = core.length >= 4 && nombreCli(cid).some((n) => n.length >= 4 && (n.includes(core) || core.includes(n)));
      if (lleva || m[cid] >= 2) porDom[d] = new Set([cid]); });
    const clienteDe = (de: string) => { const e = correo(de); const s = porCorreo[e]; if (s?.size === 1) return { cid: [...s][0], por: "contacto" }; const d = porDom[e.split("@")[1] || ""]; if (d?.size === 1) return { cid: [...d][0], por: "dominio" }; return null; };

    if (body.action === "lista") {
      const emails = Object.entries(porCorreo).filter(([, s]) => s.size === 1).map(([e]) => e);
      const doms = Object.entries(porDom).filter(([, s]) => s.size === 1).map(([d]) => d);
      return json({ ok: true, emails, dominios: doms, dominioOficina: dom });
    }
    if (body.action !== "documentos") return json({ error: "Acción desconocida" }, 400);

    const cli: Record<string, { name: string; drive_folder_id: string | null }> = Object.fromEntries(clients.map((c) => [c.id, c]));
    const rsDe = (cid: string, texto: string) => { const a = norm(texto); const es = ents.filter((e) => e.client_id === cid); const hit = es.filter((e) => norm(e.name).length >= 8 && a.includes(norm(e.name))); if (hit.length === 1) return hit[0].name; return es.length === 1 ? es[0].name : cli[cid]?.name || ""; };
    const res = { guardados: [] as unknown[], por_clasificar: [] as unknown[], ya: 0, errores: [] as unknown[] };
    // deno-lint-ignore no-explicit-any
    for (const m of (body.messages || []) as any[]) {
      const clave = String(m.messageId || m.id || "").trim(); if (!clave) continue;
      if (correo(m.from).endsWith("@" + dom)) continue;   // correos de la oficina no son documentos del cliente
      const quien = clienteDe(m.from);
      for (const a of (m.adjuntos || []).filter((x: { name: string }) => /\.pdf$/i.test(x.name || ""))) {
        const ya = await rest(`documentos_notaria?select=id&estudio_id=eq.lea&gmail_id=eq.${encodeURIComponent(clave)}&archivo_nombre=eq.${encodeURIComponent(a.name)}&limit=1`);
        if (ya?.length) { res.ya++; continue; }
        const cid = quien?.cid || null, folder = cid ? cli[cid]?.drive_folder_id : null;
        const rs = cid ? rsDe(cid, `${m.subject || ""} ${a.name}`) : "";
        const base = String(a.name).replace(/\.pdf$/i, "");
        const nombre = `${rs && !norm(base).includes(norm(rs)) ? `${rsBonita(rs)} - ` : ""}${base}${m.date ? ` - ${dmy(m.date)}` : ""}.pdf`.replace(/[\\/:*?"<>|]/g, "-");
        const fila: Record<string, unknown> = { estudio_id: "lea", origen: "cliente", casilla, gmail_id: clave, thread_id: m.threadId || null, message_id: m.messageId || null, recibido_at: m.date || null, remitente: m.from || null, asunto: m.subject || null,
          archivo_nombre: a.name, mime: "application/pdf", tamano: a.size || null, cliente_id: cid, razon_social: rs || null, metodo: quien?.por || null,
          estado: cid && folder && a.b64 ? "guardado" : "por_clasificar", motivo: !cid ? "El remitente no es contacto de un solo cliente" : !folder ? "El cliente no tiene carpeta en Drive" : !a.b64 ? "El archivo supera 10 MB: guárdalo a mano" : null, updated_at: new Date().toISOString() };
        const resumen = { de: m.from, asunto: m.subject, archivo: a.name, cliente: cid ? cli[cid]?.name : null };
        if (fila.estado === "guardado" && !dryRun) {
          try { const id = await subir(await carpeta(folder as string), nombre, decodeBase64(a.b64)); Object.assign(fila, { drive_file_id: id, drive_url: `https://drive.google.com/file/d/${id}/view`, drive_nombre: nombre }); }
          catch (e) { Object.assign(fila, { estado: "error", motivo: String((e as Error).message || e) }); res.errores.push({ ...resumen, error: fila.motivo }); }
        }
        (fila.estado === "guardado" ? res.guardados : res.por_clasificar).push(resumen);
        if (!dryRun) await rest("documentos_notaria?on_conflict=estudio_id,gmail_id,archivo_nombre", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates" }, body: JSON.stringify(fila) });
      }
    }
    if (!dryRun && res.guardados.length) await rest("activity_log", { method: "POST", body: JSON.stringify({ user_email: "agente", action: "clientes.documentos_guardados", table_name: "documentos_notaria", estudio_id: "lea", detail: { title: `${res.guardados.length} documento${res.guardados.length !== 1 ? "s" : ""} de clientes guardado${res.guardados.length !== 1 ? "s" : ""} en su carpeta (casilla ${casilla})`, documentos: res.guardados } }) }).catch(() => null);
    return json({ ok: true, dryRun, casilla, ...res, n: { guardados: res.guardados.length, por_clasificar: res.por_clasificar.length, ya: res.ya, errores: res.errores.length } });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
