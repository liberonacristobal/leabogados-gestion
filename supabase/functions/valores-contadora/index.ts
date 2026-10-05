// valores-contadora — lee el correo mensual "VALORES MM-AAAA" que manda la contadora (Claudia Saez,
// clsvsaez6@hotmail.com) y guarda los montos a pagar para auto-clasificar los cargos del banco.
// Líneas típicas: "Cotizaciones Sueldos $ 2.120.704.-" (previsional) · "Iva $ 605.701.-" (ella lo llama
// IVA pero es PPM) · "Contadora $ 50.000.-" (su honorario).
// Guarda en learnings kind='valores_contadora' key=<AAAA-MM> value=JSON {cotizaciones, ppm, contadora, subject, at}.
//
// Auth: verify_jwt=false. Cron con secreto (body.secret === CRON_SECRET) o usuario @leabogados.cl con JWT.
// Lee Gmail con el refresh token PERMANENTE de drive_auth (scope gmail.readonly, igual que la fn `drive`).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CLIENT_ID = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") || "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") || "";
const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("VALORES_CONTADORA_SECRET") || Deno.env.get("CRON_SECRET") || "";
const CONTADORA_FROM = "clsvsaez6@hotmail.com";

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

// base64url → texto
function b64urlDecode(s: string): string {
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  } catch { return ""; }
}
// deno-lint-ignore no-explicit-any
function extraerTexto(payload: any): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) return b64urlDecode(payload.body.data);
  if (payload.parts) { for (const p of payload.parts) { const t = extraerTexto(p); if (t) return t; } }
  // fallback: cualquier body con data (incl. html), luego se limpia
  if (payload.body?.data) return b64urlDecode(payload.body.data).replace(/<[^>]+>/g, " ");
  return "";
}
// "$ 2.120.704.-" → 2120704
function montoDe(texto: string, etiqueta: RegExp): number | null {
  const m = texto.match(etiqueta);
  if (!m) return null;
  const n = parseInt(String(m[1]).replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
// AAAA-MM desde el asunto "VALORES 08-2026" (o del internalDate como fallback)
function mesDe(subject: string, internalDate?: string): string {
  const m = subject.match(/(\d{2})[-/](\d{4})/);
  if (m) return `${m[2]}-${m[1]}`;
  const d = internalDate ? new Date(Number(internalDate)) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// learnings admite (kind,key) duplicados → update-or-insert (nunca upsert onConflict).
// deno-lint-ignore no-explicit-any
async function setLearning(sb: any, kind: string, key: string, value: string) {
  const { data } = await sb.from("learnings").select("id").eq("kind", kind).eq("key", key).limit(1);
  if (data && data.length) await sb.from("learnings").update({ value }).eq("id", data[0].id);
  else await sb.from("learnings").insert({ kind, key, value });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  if (!CLIENT_ID || !CLIENT_SECRET) return json({ error: "Falta GOOGLE_OAUTH_CLIENT_ID/SECRET en el servidor" }, 500);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* cron sin body */ }
  const sb = createClient(SB_URL, SB_KEY);
  const esCron = !!CRON_SECRET && body.secret === CRON_SECRET;
  if (!esCron) {
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await sb.auth.getUser(jwt);
    const email = (u?.user?.email || "").toLowerCase();
    if (!email.endsWith("@leabogados.cl")) return json({ error: "No autorizado" }, 403);
  }

  try {
    const token = await getToken();
    const dryRun = !!body.dryRun;
    // Buscar los últimos correos de la contadora con asunto VALORES (2 meses de ventana).
    const q = encodeURIComponent(`from:${CONTADORA_FROM} subject:VALORES newer_than:2m`);
    const rs = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=5`, { headers: { Authorization: "Bearer " + token } });
    const ds = await rs.json();
    if (!rs.ok) throw new Error(ds?.error?.message || "Error al buscar en Gmail");
    const ids: string[] = (ds.messages || []).map((m: Record<string, string>) => m.id);
    if (!ids.length) return json({ ok: true, encontrados: 0, msg: "No hay correo VALORES reciente de la contadora." });

    const guardados: unknown[] = [];
    for (const id of ids) {
      const rm = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, { headers: { Authorization: "Bearer " + token } });
      const dm = await rm.json();
      if (!rm.ok) continue;
      const headers: Record<string, string> = {};
      (dm.payload?.headers || []).forEach((h: Record<string, string>) => { headers[h.name.toLowerCase()] = h.value; });
      const subject = headers["subject"] || "";
      if (!/valores/i.test(subject)) continue;
      const texto = (extraerTexto(dm.payload) || dm.snippet || "").replace(/\s+/g, " ");
      // Parseo de líneas (tolerante a variantes de mayúsculas/espacios).
      const cotizaciones = montoDe(texto, /cotizaciones[^$]{0,40}\$\s*([\d.]+)/i);
      const ppm = montoDe(texto, /\biva\b[^$]{0,40}\$\s*([\d.]+)/i);   // ella lo llama "IVA" pero es PPM
      const contadora = montoDe(texto, /contadora[^$]{0,40}\$\s*([\d.]+)/i);
      const mes = mesDe(subject, dm.internalDate);
      // items en el MISMO formato que consume el front (costosClaudia): categorías mapeadas del cruce.
      // Cotizaciones→Leyes sociales · IVA(que es PPM)→Impuestos y patentes · Contadora→Remuneraciones.
      const items: Array<Record<string, unknown>> = [];
      if (cotizaciones) items.push({ item: "Cotizaciones Sueldos", categoria: "Leyes sociales", monto: cotizaciones, vence: null });
      if (ppm) items.push({ item: "PPM", categoria: "Impuestos y patentes", monto: ppm, vence: null });
      if (contadora) items.push({ item: "Contadora", categoria: "Remuneraciones", monto: contadora, vence: null });
      const valor = { mes, subject, cotizaciones, ppm, contadora, items, leido_at: new Date().toISOString() };
      if (!dryRun) await setLearning(sb, "valores_contadora", mes, JSON.stringify(valor));
      // ① Escribe la planilla real (oficina_costos_mensual) del mes con los valores de Claudia.
      // Solo toca cotizaciones/ppm/contadora (no pisa sueldos/arriendo/etc). Si llegan los reales
      // (cotiz+ppm), quita 'estimado' → el mes se cierra solo (cron oficina-cierre-auto). estudio_id='lea'
      // (Claudia es la contadora de LEA; config por estudio = deuda vendible).
      const pm = mes.match(/^(\d{4})-(\d{2})$/);
      let planilla = false;
      if (!dryRun && pm) {
        const yy = Number(pm[1]), mm = Number(pm[2]);
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (cotizaciones) patch.cotizaciones = cotizaciones;
        if (ppm) patch.ppm = ppm;
        if (contadora) patch.contadora = contadora;
        if (cotizaciones && ppm) patch.estimado = false;   // datos reales → deja de ser estimado
        if (Object.keys(patch).length > 1) {
          const { data: ex } = await sb.from("oficina_costos_mensual").select("id").eq("estudio_id", "lea").eq("anio", yy).eq("mes", mm).limit(1);
          if (ex && ex.length) await sb.from("oficina_costos_mensual").update(patch).eq("id", ex[0].id);
          else await sb.from("oficina_costos_mensual").insert({ estudio_id: "lea", anio: yy, mes: mm, ...patch });
          planilla = true;
        }
      }
      guardados.push({ ...valor, planilla });
    }
    return json({ ok: true, encontrados: ids.length, guardados, dryRun });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
