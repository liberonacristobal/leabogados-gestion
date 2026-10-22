// Edge Function: notaria-documentos
// Documentos que envía la notaría (escrituras, extractos, finiquitos, cartas certificadas, poderes…): los lee en la casilla
// conectada (drive_auth, la misma de bhe-correo) SOLO con remitente de la notaría, lleva el listado (documentos_notaria) y guarda
// cada archivo en Clientes/<Cliente>/Notaría con un nombre ordenado.
// Cliente: el correo automático de la notaría trae tipo de documento, repertorio, fecha y código de validación
// (_shared/notariaDocsReglas.js); se cruza con la OT de la liquidación de la MISMA fecha y tipo (única) → cliente, gasto y OT.
// Sin esa estructura, por el nombre del cliente en el asunto (único). Lo que no se identifica queda «Por clasificar»; lo que
// espera su OT (la liquidación llega después) se reintenta cada corrida. Nunca borra ni mueve correos.
// Interruptor: learnings config notaria_documentos = 'on' (sin 'on' = solo calcula). body.desde = 'AAAA-MM-DD' (carga histórica).
// «Por clasificar» → una persona elige el cliente en Notaría › Documentos (estado 'asignado') y la app llama esta función,
// que guarda el archivo en su carpeta. Auth: CRON_SECRET o sesión de un usuario del dominio de la oficina. verify_jwt=false.

import { decodeBase64Url } from "jsr:@std/encoding@1/base64url";
import { leerCorreoNotaria, otParaDocumento, nombreArchivoNotaria } from "../_shared/notariaDocsReglas.js";

const CLIENT_ID = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") || "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") || "";
const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const HS = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const norm = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const DOCS = /\.(pdf|docx?|odt)$/i;
const CARPETA = "Notaría";

// deno-lint-ignore no-explicit-any
async function rest(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { ...HS, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${path.split("?")[0]}: ${r.status} ${await r.text()}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
// deno-lint-ignore no-explicit-any
async function todas(path: string): Promise<any[]> {
  // deno-lint-ignore no-explicit-any
  const out: any[] = [];
  for (let i = 0; i < 50; i++) {
    const r = await fetch(`${SB_URL}/rest/v1/${path}${path.includes("?") ? "&" : "?"}order=id.asc`, { headers: { ...HS, Range: `${i * 1000}-${i * 1000 + 999}` } });
    if (!r.ok) throw new Error(`${path.split("?")[0]}: ${r.status}`);
    const p = await r.json(); out.push(...p); if (p.length < 1000) break;
  }
  return out;
}
let _tok = "", _exp = 0;
async function token(): Promise<string> {
  if (_tok && _exp > Date.now() + 60000) return _tok;
  const d0 = await rest("drive_auth?id=eq.1&select=refresh_token"); const rt = d0?.[0]?.refresh_token;
  if (!rt) throw new Error("No hay conexión de Google guardada (drive_auth).");
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: rt, grant_type: "refresh_token" }) });
  const d = await r.json(); if (!r.ok) throw new Error(d.error_description || d.error || "No se pudo renovar el token de Google");
  _tok = d.access_token; _exp = Date.now() + (d.expires_in || 3600) * 1000; return _tok;
}
// Google limita las consultas por segundo: ante 429/5xx se reintenta con espera (un correo no leído no se da por inexistente).
async function g(url: string, init: RequestInit = {}) {
  for (let i = 0; ; i++) {
    const t = await token(); const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${t}`, ...(init.headers || {}) } });
    if ((r.status === 429 || r.status >= 500) && i < 4) { await new Promise((ok) => setTimeout(ok, 800 * (i + 1))); continue; }
    return r;
  }
}
// Decodificación nativa: un adjunto de varios MB no agota la memoria ni el tiempo de la función.
const b64url = (s: string) => decodeBase64Url(s.replace(/=+$/, ""));
const texto = (s: string) => new TextDecoder().decode(b64url(s));

// Subcarpeta «Notaría» del cliente (la crea si falta) y archivo por nombre (si ya está, no se sube otro).
const cacheCarpeta: Record<string, string> = {};
async function carpetaNotaria(clienteFolder: string): Promise<string> {
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
async function subir(folder: string, nombre: string, mime: string, bytes: Uint8Array): Promise<{ id: string; reusado: boolean }> {
  const q = encodeURIComponent(`'${folder}' in parents and name = '${nombre.replace(/'/g, "\\'")}' and trashed = false`);
  const r0 = await g(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`); const d0 = await r0.json();
  if (d0.files?.[0]?.id) return { id: d0.files[0].id, reusado: true };
  const b = "leanot" + Date.now();
  const cab = new TextEncoder().encode(`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: nombre, parents: [folder] })}\r\n--${b}\r\nContent-Type: ${mime}\r\n\r\n`);
  const pie = new TextEncoder().encode(`\r\n--${b}--`);
  const cuerpo = new Uint8Array(cab.length + bytes.length + pie.length); cuerpo.set(cab, 0); cuerpo.set(bytes, cab.length); cuerpo.set(pie, cab.length + bytes.length);
  const r = await g("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id", { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${b}` }, body: cuerpo });
  const d = await r.json(); if (!r.ok) throw new Error(`Drive: ${d?.error?.message || r.status}`);
  return { id: d.id, reusado: false };
}

Deno.serve(async (req) => {
  // deno-lint-ignore no-explicit-any
  let body: any = {}; try { body = await req.json(); } catch { /* sin body */ }
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!CRON_SECRET) return json({ error: "No autorizado" }, 403);
  if (body.secret !== CRON_SECRET && bearer !== CRON_SECRET) {
    // Usuario de la app: token de sesión válido y correo del dominio de la casilla del agente.
    const u = bearer ? await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${bearer}` } }).then((r) => r.ok ? r.json() : null).catch(() => null) : null;
    const cas = await rest("learnings?kind=eq.config&key=eq.agente_casilla&select=value").catch(() => []);
    const dom = String(cas?.[0]?.value || "").split("@")[1];
    if (!u?.email || !dom || !String(u.email).toLowerCase().endsWith("@" + dom.toLowerCase())) return json({ error: "No autorizado" }, 403);
  }
  try {
    const cfg = await rest("learnings?kind=eq.config&key=in.(notaria_documentos,notaria_pedir_liquidacion)&select=key,value");
    const ON = String(cfg.find((c: { key: string }) => c.key === "notaria_documentos")?.value || "").toLowerCase() === "on";
    const dryRun = !!body.dryRun || !ON;
    // Remitentes de la notaría: los correos configurados para el pedido de liquidación y su dominio (no los de casillas públicas).
    let correos: string[] = []; try { correos = JSON.parse(cfg.find((c: { key: string }) => c.key === "notaria_pedir_liquidacion")?.value || "{}").notaria || []; } catch { /* sin config */ }
    const libres = /@(gmail|hotmail|outlook|yahoo)\./i;
    const remitentes = [...new Set(correos.flatMap((c) => libres.test(c) ? [c] : [c, c.split("@")[1]]).filter(Boolean))];
    if (!remitentes.length) return json({ ok: false, error: "Sin correos de la notaría configurados (learnings config notaria_pedir_liquidacion.notaria)" });
    const desde = /^\d{4}-\d{2}-\d{2}$/.test(String(body.desde || "")) ? body.desde : new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

    const [ots, clients, ents, previos] = await Promise.all([
      todas("expenses?select=id,client_id,date,concept,materia,ot_number,deleted_at&ot_number=not.is.null&deleted_at=is.null"),
      todas("clients?select=id,name,drive_folder_id,is_internal"),
      todas("client_entities?select=id,client_id,name"),
      todas("documentos_notaria?select=id,gmail_id,archivo_nombre,codigo_validacion,estado,tipo_documento,repertorio,fecha_documento,asunto,mime,cliente_id"),
    ]);
    const cli: Record<string, { name: string; drive_folder_id: string | null }> = Object.fromEntries(clients.map((c) => [c.id, c]));
    const yaCod = new Set(previos.map((p) => p.codigo_validacion).filter(Boolean));
    const yaArch = new Set(previos.map((p) => `${p.gmail_id}|${p.archivo_nombre}`));
    // Nombres ya usados por cliente: dos documentos distintos con el mismo tipo, fecha y repertorio (dos declaraciones juradas) no se pisan.
    const usados = new Set<string>(); (await todas("documentos_notaria?select=id,cliente_id,drive_nombre&drive_nombre=not.is.null")).forEach((p) => usados.add(`${p.cliente_id}|${p.drive_nombre}`));
    const nombreLibre = (cid: string, n: string) => { let x = n, i = 2; while (usados.has(`${cid}|${x}`)) x = n.replace(/(\.[a-z0-9]+)$/i, ` (${i++})$1`); usados.add(`${cid}|${x}`); return x; };
    // Nombres de cliente y de sus razones sociales para el asunto («INMOBILIARIA SANTA GRACIA SpA»); solo nombres largos.
    const nombres = [...clients.filter((c) => !c.is_internal).map((c) => ({ n: norm(c.name), id: c.id })), ...ents.map((e) => ({ n: norm(e.name), id: e.client_id }))].filter((x) => x.n.length >= 8);
    const clienteEnTexto = (t: string) => { const a = norm(t); const ids = [...new Set(nombres.filter((x) => a.includes(x.n)).map((x) => x.id))]; return ids.length === 1 ? ids[0] : null; };

    const q = encodeURIComponent(`from:(${remitentes.join(" OR ")}) has:attachment (filename:pdf OR filename:docx OR filename:doc) after:${desde.replace(/-/g, "/")}`);
    // deno-lint-ignore no-explicit-any
    const ids: any[] = []; let page = "";
    for (let i = 0; i < 20; i++) { const r = await g(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=100${page ? `&pageToken=${page}` : ""}`); const d = await r.json(); if (!r.ok) throw new Error(`Gmail: ${d?.error?.message || r.status}`); ids.push(...(d.messages || [])); page = d.nextPageToken; if (!page) break; }
    // Lo nuevo más lo que esperaba su OT (se vuelve a leer el correo para tomar el archivo).
    // Más de 45 días sin su OT: pasa a «Por clasificar» (la ve una persona).
    const limite = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
    if (!dryRun) await rest(`documentos_notaria?estado=eq.pendiente_ot&fecha_documento=lt.${limite}`, { method: "PATCH", body: JSON.stringify({ estado: "por_clasificar", motivo: "Sin OT del mismo tipo y fecha en las liquidaciones", updated_at: new Date().toISOString() }) });
    previos.forEach((p) => { if (p.estado === "pendiente_ot" && String(p.fecha_documento || "") < limite) p.estado = "por_clasificar"; });
    const pendientes = previos.filter((p) => p.estado === "pendiente_ot");
    // Correos ya registrados no se vuelven a leer (salvo los que esperan su OT); tope por corrida por la cuota de Gmail.
    const registrados = new Set(previos.filter((p) => p.estado !== "pendiente_ot" && p.estado !== "asignado").map((p) => p.gmail_id));
    const asignados = previos.filter((p) => p.estado === "asignado").map((p) => p.gmail_id);
    const MAX = Math.min(200, Number(body.max) || (ON && !body.dryRun ? 12 : 50));
    // Los que esperan su OT se revisan con lo ya guardado (tipo y fecha); el correo se vuelve a leer solo si ya apareció la OT.
    const conOt = pendientes.filter((p) => otParaDocumento({ tipo: p.tipo_documento, fecha: String(p.fecha_documento || "").slice(0, 10) }, ots)).map((p) => p.gmail_id);
    const todosPorLeer = [...new Set([...asignados, ...ids.map((m) => m.id).filter((x) => !registrados.has(x) && !pendientes.some((p) => p.gmail_id === x)), ...conOt])];
    const porLeer = todosPorLeer.slice(0, MAX);

    const res = { leidos: 0, no_leidos: 0, cuota_agotada: false, guardados: [] as unknown[], pendiente_ot: [] as unknown[], por_clasificar: [] as unknown[], errores: [] as unknown[] };
    for (const mid of porLeer) {
      const rm = await g(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${mid}?format=full`); const dm = await rm.json(); if (!rm.ok) { res.no_leidos++; if (rm.status === 403 && /quota|rate/i.test(dm?.error?.message || "")) { res.cuota_agotada = true; break; } if (res.errores.length < 3) res.errores.push({ gmail: mid, error: `Gmail ${rm.status}: ${dm?.error?.message || ""}` }); continue; }
      res.leidos++;
      const hdr = (n: string) => (dm.payload?.headers || []).find((h: { name: string }) => h.name.toLowerCase() === n)?.value || "";
      // deno-lint-ignore no-explicit-any
      const partes: any[] = []; let plano = "";
      // deno-lint-ignore no-explicit-any
      const walk = (p: any) => { if (!p) return; if (p.mimeType === "text/plain" && p.body?.data && !p.filename) plano += texto(p.body.data) + "\n"; if (p.filename && p.body?.attachmentId && DOCS.test(p.filename)) partes.push(p); (p.parts || []).forEach(walk); };
      walk(dm.payload);
      if (!partes.length) continue;
      const asunto = hdr("subject"), de = hdr("from"), recibido = new Date(Number(dm.internalDate)).toISOString();
      const est = leerCorreoNotaria(plano);
      for (const p of partes) {
        const previo = previos.find((x) => x.gmail_id === mid && x.archivo_nombre === p.filename);
        if (previo && previo.estado !== "pendiente_ot" && previo.estado !== "asignado") continue;
        if (!previo && yaArch.has(`${mid}|${p.filename}`)) continue;
        // El mismo documento reenviado en otro correo (misma clave de validación): queda anotado para no volver a leer ese correo.
        if (!previo && est?.codigo && yaCod.has(est.codigo)) {
          yaArch.add(`${mid}|${p.filename}`);
          if (!dryRun) await rest("documentos_notaria?on_conflict=estudio_id,gmail_id,archivo_nombre", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates" }, body: JSON.stringify({ estudio_id: "lea", gmail_id: mid, thread_id: dm.threadId, recibido_at: recibido, remitente: de, asunto, archivo_nombre: p.filename, codigo_validacion: est.codigo, estado: "duplicado", motivo: "Mismo documento ya registrado (misma clave de validación)" }) });
          continue;
        }
        const ot = est ? otParaDocumento(est, ots) : null;
        // Sin el texto automático de la notaría (borradores, matrices, comprobantes): el cliente por el asunto o por las partes en el nombre del archivo.
        const manual = previo?.estado === "asignado" ? previo.cliente_id : null;
        const cid = manual || ot?.client_id || (!est ? (clienteEnTexto(asunto) || clienteEnTexto(p.filename.replace(/[._-]+/g, " "))) : null);
        const carpeta = cid ? cli[cid]?.drive_folder_id : null;
        // La OT llega con la liquidación (días 15 y 30): se espera hasta 45 días desde la fecha del documento.
        const espera = est && !ot && (Date.now() - new Date(est.fecha + "T12:00").getTime()) < 45 * 86400000;
        const estado = cid && carpeta ? "guardado" : espera ? "pendiente_ot" : "por_clasificar";
        const motivo = estado === "pendiente_ot" ? "Sin OT de la misma fecha y tipo en las liquidaciones (se reintenta)" : estado === "por_clasificar" ? (cid ? "El cliente no tiene carpeta en Drive" : est ? "Sin OT del mismo tipo y fecha en las liquidaciones" : "No se identificó el cliente") : null;
        const fila: Record<string, unknown> = {
          estudio_id: "lea", gmail_id: mid, thread_id: dm.threadId, message_id: hdr("message-id") || null, recibido_at: recibido, remitente: de, asunto,
          tipo_documento: est?.tipo || null, repertorio: est?.repertorio || null, fecha_documento: est?.fecha || null, codigo_validacion: est?.codigo || null,
          archivo_nombre: p.filename, mime: p.mimeType || null, tamano: p.body?.size || null, cliente_id: cid, expense_id: ot?.id || null, ot_number: ot?.ot_number || null,
          metodo: manual ? "manual" : ot ? "ot_tipo_fecha" : cid ? "asunto_archivo" : null, estado, motivo, updated_at: new Date().toISOString(),
        };
        const resumen = { asunto, archivo: p.filename, tipo: est?.tipo || null, fecha: est?.fecha || null, cliente: cid ? cli[cid]?.name : null, ot: ot?.ot_number || null };
        // Un PDF de logo o firma (imagen pegada como archivo) no es un documento.
        if ((p.body?.size || 0) < 15000 && /^image\d*\.|logo|firma/i.test(p.filename)) continue;
        if (estado === "guardado" && !dryRun) {
          try {
            const ra = await g(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${mid}/attachments/${p.body.attachmentId}`); const da = await ra.json();
            if (!ra.ok || !da.data) throw new Error("No se pudo descargar el adjunto");
            const ext = (p.filename.match(/\.([a-z0-9]+)$/i) || [])[1] || "pdf";
            const nombre = nombreLibre(cid as string, est ? nombreArchivoNotaria(est, ext.toLowerCase()) : p.filename);
            const up = await subir(await carpetaNotaria(carpeta as string), nombre, p.mimeType || "application/pdf", b64url(da.data));
            Object.assign(fila, { drive_file_id: up.id, drive_url: `https://drive.google.com/file/d/${up.id}/view`, drive_nombre: nombre });
          } catch (e) { Object.assign(fila, { estado: "error", motivo: String((e as Error).message || e) }); res.errores.push({ ...resumen, error: fila.motivo }); }
        }
        (fila.estado === "guardado" ? res.guardados : fila.estado === "pendiente_ot" ? res.pendiente_ot : fila.estado === "por_clasificar" ? res.por_clasificar : []).push(resumen);
        if (est?.codigo) yaCod.add(est.codigo); yaArch.add(`${mid}|${p.filename}`);
        if (dryRun) continue;
        if (previo) await rest(`documentos_notaria?id=eq.${previo.id}`, { method: "PATCH", body: JSON.stringify(fila) });
        else await rest("documentos_notaria?on_conflict=estudio_id,gmail_id,archivo_nombre", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(fila) });
      }
    }
    if (!dryRun && res.guardados.length) await rest("activity_log", { method: "POST", body: JSON.stringify({ user_email: "agente", action: "notaria.documentos_guardados", table_name: "documentos_notaria", estudio_id: "lea", detail: { title: `${res.guardados.length} documento${res.guardados.length !== 1 ? "s" : ""} de la notaría guardado${res.guardados.length !== 1 ? "s" : ""} en la carpeta del cliente`, documentos: res.guardados } }) }).catch(() => null);
    return json({ ok: true, dryRun, desde, remitentes, ...res, quedan: Math.max(0, todosPorLeer.length - res.leidos), n: { leidos: res.leidos, no_leidos: res.no_leidos, guardados: res.guardados.length, pendiente_ot: res.pendiente_ot.length, por_clasificar: res.por_clasificar.length, errores: res.errores.length } });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
