// bhe-correo — registra SOLAS las boletas de honorarios que llegan por correo (p. ej. "bhe_19889733-43.pdf"
// adjunta al cobro de comisiones). Lee el PDF del SII (pdfjs), guarda la boleta (boletas_honorarios + PDF en el bucket
// privado `documentos`) y, si su líquido calza EXACTO y ÚNICO con comisiones ya cobradas al cliente de ese proveedor,
// se las asigna (costo = bruto; retención y líquido repartidos). Lo que no calza queda sin asignar para revisar.
// Nunca toca el banco ni marca pagos.
//
// Auth: verify_jwt=false. Cron con secreto (body.secret === CRON_SECRET) o usuario @leabogados.cl con JWT.
// Gmail con el refresh token permanente de drive_auth (igual que valores-contadora).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as pdfjs from "npm:pdfjs-dist@4.10.38/legacy/build/pdf.mjs";

const CLIENT_ID = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") || "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") || "";
const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("VALORES_CONTADORA_SECRET") || Deno.env.get("CRON_SECRET") || "";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

async function getRefreshToken(): Promise<string | null> {
  const r = await fetch(`${SB_URL}/rest/v1/drive_auth?id=eq.1&select=refresh_token`, { headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY } });
  if (!r.ok) return null;
  const d = await r.json();
  return (Array.isArray(d) && d[0]?.refresh_token) || null;
}
let _tok = ""; let _exp = 0;
async function getToken(): Promise<string> {
  if (_tok && _exp > Date.now() + 60000) return _tok;
  const rt = await getRefreshToken();
  if (!rt) throw new Error("No hay conexión de Drive/Gmail guardada (menú → Conectar Drive permanente).");
  const body = new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: rt, grant_type: "refresh_token" });
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error_description || d.error || "No se pudo renovar el token de Google");
  _tok = d.access_token; _exp = Date.now() + (d.expires_in || 3600) * 1000;
  return _tok;
}

const nRut = (r: string) => String(r || "").replace(/[^0-9kK]/g, "").toUpperCase();
const fmtRut = (r: string) => { const c = nRut(r); return c.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "-" + c.slice(-1); };
const num = (s: string) => parseInt(String(s || "").replace(/[^\d]/g, ""), 10) || 0;
const b64urlBytes = (s: string) => { const b = atob(s.replace(/-/g, "+").replace(/_/g, "/")); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
const MESES: Record<string, string> = { enero: "01", febrero: "02", marzo: "03", abril: "04", mayo: "05", junio: "06", julio: "07", agosto: "08", septiembre: "09", setiembre: "09", octubre: "10", noviembre: "11", diciembre: "12" };

// Texto de la boleta (el PDF del SII viene cifrado sin clave de usuario: pdfjs lo abre).
async function textoPdf(bytes: Uint8Array): Promise<string> {
  const doc = await pdfjs.getDocument({ data: bytes, useWorkerFetch: false, isEvalSupported: false, disableFontFace: true }).promise;
  const p = await doc.getPage(1); const tc = await p.getTextContent();
  // deno-lint-ignore no-explicit-any
  return tc.items.map((i: any) => i.str || "").filter((s: string) => s.trim()).join(" | ");
}
// Campos de una boleta de honorarios electrónica del SII.
export function parseBHE(t: string) {
  if (!/BOLETA DE HONORARIOS/i.test(t)) return null;
  const folio = num((t.match(/N\s*°\s*(\d+)/) || [])[1] || "");
  const ruts = [...t.matchAll(/R(?:UT|ut):?\s*\|?\s*([\d.]+\s*[−\-–]\s*[\dkK])/g)].map(m => fmtRut(m[1]));
  const emisor_rut = ruts[0] || "", receptor_rut = ruts[1] || "";
  const emisor_nombre = (t.split(" | ")[0] || "").trim();
  let fecha = "";
  const fe = t.match(/Emisi[oó]n:\s*(\d{2})\/(\d{2})\/(\d{4})/); if (fe) fecha = `${fe[3]}-${fe[2]}-${fe[1]}`;
  if (!fecha) { const f2 = t.match(/(\d{1,2}) de (\w+) de (\d{4})/i); if (f2) fecha = `${f2[3]}-${MESES[f2[2].toLowerCase()] || "01"}-${f2[1].padStart(2, "0")}`; }
  const bruto = num((t.match(/Total Honorarios:?\s*\$?:?\s*\|\s*([\d.]+)/i) || [])[1] || "");
  const tasaM = t.match(/([\d.,]+)\s*%\s*Impto\.?\s*Retenido:?\s*\|\s*([\d.]+)/i);
  const tasa = tasaM ? parseFloat(tasaM[1].replace(",", ".")) / 100 : null;
  const retencion = tasaM ? num(tasaM[2]) : 0;
  const liquido = num((t.match(/\|\s*Total:\s*\|\s*([\d.]+)/i) || [])[1] || "") || (bruto - retencion);
  const glosa = ((t.match(/Por atenci[oó]n profesional:\s*\|\s*([^|]+)/i) || [])[1] || "").trim();
  if (!folio || !emisor_rut || !bruto || !fecha || bruto - retencion !== liquido) return null;
  return { folio, emisor_rut, receptor_rut, emisor_nombre, fecha, bruto, retencion, liquido, tasa, glosa };
}

// deno-lint-ignore no-explicit-any
async function asignar(sb: any, provId: string, bhe: any) {
  // Comisiones sin boleta ya cobradas al cliente (o pagadas): el líquido de la boleta debe calzar con 1–3 de ellas, y de UNA sola forma.
  const { data: ts } = await sb.from("terceros_pagos").select("id,monto,liquido,retencion,estado,billing_id,bhe_id").eq("proveedor_id", provId).is("bhe_id", null);
  // deno-lint-ignore no-explicit-any
  const bids = [...new Set((ts || []).map((t: any) => t.billing_id).filter(Boolean))];
  const { data: bs } = bids.length ? await sb.from("billing").select("id,status").in("id", bids) : { data: [] };
  const st: Record<string, string> = {}; (bs || []).forEach((b: { id: string; status: string }) => { st[b.id] = b.status; });
  // deno-lint-ignore no-explicit-any
  const cand = (ts || []).filter((t: any) => t.liquido != null && (t.estado === "pagado" || t.estado === "por_pagar" || ["Pagado", "Anticipada"].includes(st[t.billing_id])));
  // deno-lint-ignore no-explicit-any
  const L = (t: any) => Number(t.liquido) || 0, ok = (s: number) => Math.abs(s - bhe.liquido) <= 2;
  // deno-lint-ignore no-explicit-any
  const hits: any[][] = [];
  for (let i = 0; i < cand.length; i++) {
    if (ok(L(cand[i]))) hits.push([cand[i]]);
    for (let j = i + 1; j < cand.length; j++) {
      if (ok(L(cand[i]) + L(cand[j]))) hits.push([cand[i], cand[j]]);
      for (let k = j + 1; k < cand.length; k++) if (ok(L(cand[i]) + L(cand[j]) + L(cand[k]))) hits.push([cand[i], cand[j], cand[k]]);
    }
  }
  if (hits.length !== 1) return 0;
  const sel = hits[0], tot = sel.reduce((s, t) => s + L(t), 0);
  let accB = 0, accR = 0;
  for (const [i, t] of sel.entries()) {
    const last = i === sel.length - 1, sh = tot > 0 ? L(t) / tot : 1 / sel.length;
    const b2 = last ? bhe.bruto - accB : Math.round(bhe.bruto * sh), r2 = last ? bhe.retencion - accR : Math.round(bhe.retencion * sh); accB += b2; accR += r2;
    await sb.from("terceros_pagos").update({ bhe_id: bhe.id, monto: b2, retencion: r2, liquido: b2 - r2, factura_numero: String(bhe.folio), factura_fecha: bhe.fecha }).eq("id", t.id);
  }
  return sel.length;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  // deno-lint-ignore no-explicit-any
  let body: any = {}; try { body = await req.json(); } catch { /* cron */ }
  const sb = createClient(SB_URL, SB_KEY);
  const esCron = !!CRON_SECRET && body.secret === CRON_SECRET;
  if (!esCron) {
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await sb.auth.getUser(jwt);
    if (!(u?.user?.email || "").toLowerCase().endsWith("@leabogados.cl")) return json({ error: "No autorizado" }, 403);
  }
  try {
    const dias = Math.min(400, Number(body.dias) || 45), dryRun = !!body.dryRun;
    // El estudio es el dueño de la conexión Gmail (drive_auth); su RUT es el receptor esperado de la boleta.
    const { data: da0 } = await sb.from("drive_auth").select("estudio_id").eq("id", 1).limit(1);
    const estudioId = da0?.[0]?.estudio_id || "";
    const { data: est } = await sb.from("estudios").select("rut").eq("id", estudioId).limit(1);
    const rutEstudio = nRut(est?.[0]?.rut || "");
    if (!rutEstudio) throw new Error("El estudio no tiene RUT configurado");
    const { data: provs } = await sb.from("proveedores").select("id,rut,nombre").eq("documento", "boleta").eq("estudio_id", estudioId);
    // deno-lint-ignore no-explicit-any
    const provDe: Record<string, any> = {}; (provs || []).forEach((p: any) => { if (p.rut) provDe[nRut(p.rut)] = p; });
    const token = await getToken();
    const H = { Authorization: "Bearer " + token };
    // Boletas adjuntas: las que manda el emisor (bhe_<rut>-<folio>.pdf) y la copia que el SII envía al receptor.
    const q = encodeURIComponent(`has:attachment (filename:bhe OR filename:boleta OR filename:honorarios OR subject:"Boleta de Honorarios") newer_than:${dias}d`);
    // deno-lint-ignore no-explicit-any
    const ds: any = { messages: [] }; let pageToken = "";
    for (let pg = 0; pg < 5; pg++) {
      const rs = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=100${pageToken ? `&pageToken=${pageToken}` : ""}`, { headers: H });
      const d1 = await rs.json(); if (!rs.ok) throw new Error(d1?.error?.message || "Error al buscar en Gmail");
      ds.messages.push(...(d1.messages || [])); pageToken = d1.nextPageToken || ""; if (!pageToken) break;
    }
    // deno-lint-ignore no-explicit-any
    const out: any[] = []; const vistos = new Set<string>();
    for (const m of (ds.messages || [])) {
      const rm = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`, { headers: H });
      const dm = await rm.json(); if (!rm.ok) continue;
      // deno-lint-ignore no-explicit-any
      const partes: any[] = []; const walk = (p: any) => { if (!p) return; if (p.filename && /\.pdf$/i.test(p.filename) && p.body?.attachmentId) partes.push(p); (p.parts || []).forEach(walk); }; walk(dm.payload);
      for (const p of partes) {
        // Solo PDFs que parecen boleta del SII (bhe_<rut>-<folio>.pdf) o de un emisor de boleta conocido.
        const fn = String(p.filename || ""); const rutFn = nRut((fn.match(/(\d{7,8})[-_]/) || [])[1] || "");
        if (!/bhe|boleta|honorario/i.test(fn) && !Object.keys(provDe).some(r => r.slice(0, -1) === rutFn)) continue;
        const ra = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}/attachments/${p.body.attachmentId}`, { headers: H });
        const da = await ra.json(); if (!ra.ok || !da.data) continue;
        const bytes = b64urlBytes(da.data);
        // deno-lint-ignore no-explicit-any
        let bhe: any = null; try { bhe = parseBHE(await textoPdf(bytes)); } catch (e) { out.push({ archivo: fn, error: "No se pudo leer: " + String((e as Error)?.message || e) }); continue; }
        if (!bhe) continue;
        const k = `${nRut(bhe.emisor_rut)}-${bhe.folio}`; if (vistos.has(k)) continue; vistos.add(k);
        if (nRut(bhe.receptor_rut) !== rutEstudio) continue;           // boleta emitida a otro, no al estudio
        const prov = provDe[nRut(bhe.emisor_rut)]; if (!prov) continue;  // solo proveedores que emiten boleta
        const { data: ya } = await sb.from("boletas_honorarios").select("id").eq("emisor_rut", bhe.emisor_rut).eq("folio", bhe.folio).limit(1);
        if (ya && ya.length) { if (dryRun) out.push({ folio: bhe.folio, proveedor: prov.nombre, yaRegistrada: true }); continue; }
        const rn = nRut(bhe.emisor_rut).slice(0, -1), path = `bhe/${rn}/BHE_${rn}_N${String(bhe.folio).padStart(4, "0")}.pdf`;
        if (dryRun) { out.push({ ...bhe, proveedor: prov.nombre, path, dryRun: true }); continue; }
        const up = await fetch(`${SB_URL}/storage/v1/object/documentos/${path}`, { method: "POST", headers: { Authorization: `Bearer ${SB_KEY}`, apikey: SB_KEY, "Content-Type": "application/pdf", "x-upsert": "true" }, body: bytes });
        const { data: ins, error } = await sb.from("boletas_honorarios").insert({ proveedor_id: prov.id, emisor_rut: bhe.emisor_rut, emisor_nombre: bhe.emisor_nombre, folio: bhe.folio, fecha: bhe.fecha, bruto: bhe.bruto, retencion: bhe.retencion, liquido: bhe.liquido, tasa: bhe.tasa, glosa: bhe.glosa, storage_path: up.ok ? path : null, created_by: "correo" }).select().single();
        if (error) { out.push({ folio: bhe.folio, error: error.message }); continue; }
        const n = await asignar(sb, prov.id, { ...ins, folio: bhe.folio, fecha: bhe.fecha, bruto: bhe.bruto, retencion: bhe.retencion, liquido: bhe.liquido });
        await sb.from("activity_log").insert({ user_email: "bhe-correo", action: "boletas.leida_correo", table_name: "boletas_honorarios", record_id: ins.id, detail: JSON.stringify({ folio: bhe.folio, name: prov.nombre, monto: bhe.bruto, title: n ? `asignada a ${n} comisi${n === 1 ? "ón" : "ones"}` : "sin asignar" }) });
        out.push({ folio: bhe.folio, proveedor: prov.nombre, bruto: bhe.bruto, liquido: bhe.liquido, asignadas: n });
      }
    }
    return json({ ok: true, revisados: (ds.messages || []).length, nuevas: out });
  } catch (e) { return json({ error: String((e as Error)?.message || e) }, 500); }
});
