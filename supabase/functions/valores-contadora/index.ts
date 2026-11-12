// valores-contadora — lee el correo mensual "VALORES MM-AAAA" que manda la contadora (Claudia Saez,
// clsvsaez6@hotmail.com) y guarda los montos a pagar para auto-clasificar los cargos del banco.
// Líneas típicas: "Cotizaciones Sueldos $ 2.120.704.-" (previsional) · "Iva $ 605.701.-" (ella lo llama
// IVA pero es PPM) · "Contadora $ 50.000.-" (su honorario).
// Guarda en learnings kind='valores_contadora' key=<AAAA-MM> value=JSON {cotizaciones, ppm, contadora, subject, at, desglose}.
// `ppm` sigue siendo el monto rotulado «Iva» (el F29 completo: lo leen otros lectores); `desglose` lo separa en PPM, retención de honorarios e impuesto único con la regla única de _shared/impuestosMensuales.js.
//
// Auth: verify_jwt=false. Cron con secreto (body.secret === CRON_SECRET) o usuario @leabogados.cl con JWT.
// Lee Gmail con el refresh token PERMANENTE de drive_auth (scope gmail.readonly, igual que la fn `drive`).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { esDelDominio } from "../_shared/estudio.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { impuestosMensuales, pagosConBoleta, idOficina } from "../_shared/impuestosMensuales.js";
import { selectAll } from "../_shared/paginar.js";

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

// «Iva» del correo = F29 completo. Lo separa en PPM, retención de honorarios e impuesto único con los datos de la base (solo lectura). Si algo falla devuelve null y todo sigue como antes.
// deno-lint-ignore no-explicit-any
async function desglosarF29(sb: any, mes: string, informado: number | null) {
  try {
    const [y, m] = mes.split("-").map(Number);
    const sig = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    const desde = `${y - 2}-01-01`;
    const [docs, bol, f29, liq, gas, ter, mie, cli] = await Promise.all([
      selectAll(() => sb.from("sii_cargas_docs").select("tipo_dte,monto,fecha_emision").gte("fecha_emision", `${mes}-01`).lt("fecha_emision", sig).order("id")),
      selectAll(() => sb.from("boletas_honorarios").select("id,folio,fecha,emisor_nombre,emisor_rut,bruto,retencion,liquido,tasa,estado,movimiento_id,proveedor_id").gte("fecha", desde).order("id")),
      sb.from("f29_declarados").select("periodo,ppm,base_ppm,tasa_ppm,impuesto_unico,retencion_bhe,total"),
      sb.from("remuneraciones_tributables").select("periodo,persona,impuesto_unico").eq("periodo", mes),
      selectAll(() => sb.from("expenses").select("client_id,type,category,subcategory,date,amount,deleted_at").eq("category", "Sueldos").gte("date", desde).order("id")),
      selectAll(() => sb.from("terceros_pagos").select("estado,proveedor,proveedor_id,pagado_at,liquido,monto,retencion,bhe_id").not("liquido", "is", null).gte("pagado_at", desde).order("id")),
      sb.from("miembros").select("nombre").eq("paga_con_boleta", true),
      sb.from("clients").select("id,name,is_internal"),
    ]);
    for (const r of [docs, bol, f29, liq, gas, ter, mie, cli]) if (r.error) throw new Error(r.error.message);
    const norm = (t: string) => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    // deno-lint-ignore no-explicit-any
    const boletaSet = new Set((mie.data || []).map((x: any) => norm(x.nombre)));
    const declarados: Record<string, unknown> = {};
    // deno-lint-ignore no-explicit-any
    (f29.data || []).forEach((r: any) => { declarados[r.periodo] = r; });
    const pagos = pagosConBoleta({ expenses: gas.data || [], ofiId: idOficina(cli.data || []), boletaSet, terceros: ter.data || [] });
    const r = impuestosMensuales({ per: mes, docs: docs.data || [], boletas: bol.data || [], pagos, liquidaciones: liq.data || [], declarados, informado });
    return {
      ppm: r.ppm.monto, retencion: r.retencion.monto, impuesto_unico: r.unico.monto, total: r.total, total_correo: informado, dif: r.dif,
      estado: r.informado == null ? "sin total del correo" : r.cuadra ? "cuadra" : "por verificar", boletas_por_cargar: r.retencion.nFalta,
      fuentes: { ppm: r.ppm.fuente, retencion: r.retencion.fuente, impuesto_unico: r.unico.fuente },
    };
  } catch (_e) { return null; }
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
    if (!esDelDominio(email)) return json({ error: "No autorizado" }, 403);
  }

  try {
    const token = await getToken();
    const dryRun = !!body.dryRun;
    // Correos VALORES de la contadora de los últimos 13 meses: completa todo mes abierto de la planilla (los cerrados no se tocan).
    const q = encodeURIComponent(`from:${CONTADORA_FROM} subject:VALORES newer_than:13m`);
    const rs = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=15`, { headers: { Authorization: "Bearer " + token } });
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
      const desglose = ppm ? await desglosarF29(sb, mes, ppm) : null;
      const valor = { mes, subject, cotizaciones, ppm, contadora, items, desglose, leido_at: new Date().toISOString() };
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
        // La planilla guarda el pago total al SII (el «Iva» del correo, como siempre: lo leen el flujo de caja y el cierre); el desglose en PPM, retención e impuesto único se deriva al leer y queda en learnings.
        if (ppm) patch.ppm = ppm;
        if (contadora) patch.contadora = contadora;
        if (cotizaciones && ppm) patch.estimado = false;   // datos reales → deja de ser estimado
        if (Object.keys(patch).length > 1) {
          // La tabla no tiene columna id: la clave es (estudio_id, anio, mes). Antes se pedía "id" → error silencioso y la planilla nunca se actualizaba.
          const { data: ex, error: exErr } = await sb.from("oficina_costos_mensual").select("anio,cerrado,nota").eq("estudio_id", "lea").eq("anio", yy).eq("mes", mm).limit(1);
          if (exErr) throw new Error("planilla: " + exErr.message);
          // Un mes ya cerrado no se toca (sus cifras quedaron fijas al cerrar).
          if (ex && ex.length && ex[0].cerrado) { guardados.push({ ...valor, planilla: "cerrado" }); continue; }
          // Solo se crea fila para meses del año en curso: un mes antiguo sin planilla quedaría con costos parciales (sin sueldos ni arriendo).
          if (!(ex && ex.length) && yy !== new Date().getFullYear()) { guardados.push({ ...valor, planilla: "sin planilla" }); continue; }
          // La nota «estimados» deja de ser cierta con los valores reales (en septiembre quedó desactualizada).
          if (cotizaciones && ppm && ex && ex.length && /estimad/i.test(String(ex[0].nota || ""))) patch.nota = "Valores de la contadora (correo VALORES)";
          const r = (ex && ex.length)
            ? await sb.from("oficina_costos_mensual").update(patch).eq("estudio_id", "lea").eq("anio", yy).eq("mes", mm)
            : await sb.from("oficina_costos_mensual").insert({ estudio_id: "lea", anio: yy, mes: mm, ...patch });
          if (r.error) throw new Error("planilla: " + r.error.message);
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
