// liquidaciones-contadora — lee las liquidaciones de sueldo que manda la contadora ("LIQUIDACIONES LIBERONA MM-AAAA", un PDF por
// trabajador) desde el correo que la app ya lee (drive_auth) y guarda SOLO lo necesario para el F29 estimado en
// remuneraciones_tributables (solo administradores): imponible, cotizaciones, base tributable e impuesto único por persona y mes.
// Además carga la tabla oficial mensual del impuesto único del SII (sii_impuesto_unico).
// body.accion: 'leer' (liquidaciones de los últimos body.meses, por defecto 2) · 'tabla' (tabla del SII de body.anio) · 'muestra'
// (texto de un PDF, para revisar el formato). body.dryRun = no guarda.
// Auth: CRON_SECRET o usuario del dominio. verify_jwt=false.
import * as pdfjs from "npm:pdfjs-dist@4.10.38/legacy/build/pdf.mjs";
import { liquidacionesVigentes, cotizacionesProvisorias, mismaPersona, personaDelPago, presupuestoDesdeLiquidaciones } from "../_shared/liquidacionesReglas.js";

const CLIENT_ID = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") || "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") || "";
const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const CONTADORA = "clsvsaez6@hotmail.com";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

async function token(): Promise<string> {
  const r = await fetch(`${SB_URL}/rest/v1/drive_auth?id=eq.1&select=refresh_token`, { headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY } });
  const rt = (await r.json())?.[0]?.refresh_token; if (!rt) throw new Error("No hay conexión de Gmail guardada (drive_auth)");
  const t = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: rt, grant_type: "refresh_token" }) });
  const d = await t.json(); if (!t.ok) throw new Error(d.error_description || d.error || "No se pudo renovar el token de Google"); return d.access_token;
}
const b64urlBytes = (s: string) => { const b = atob(s.replace(/-/g, "+").replace(/_/g, "/")); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
async function textoPdf(bytes: Uint8Array): Promise<string> {
  const doc = await pdfjs.getDocument({ data: bytes, useWorkerFetch: false, isEvalSupported: false, disableFontFace: true }).promise;
  const out: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, 3); i++) { const p = await doc.getPage(i); const tc = await p.getTextContent(); out.push(tc.items.map((x: { str?: string }) => x.str || "").filter((s: string) => s.trim()).join(" | ")); }
  return out.join(" || ");
}

const MESES: Record<string, string> = { ENERO: "01", FEBRERO: "02", MARZO: "03", ABRIL: "04", MAYO: "05", JUNIO: "06", JULIO: "07", AGOSTO: "08", SEPTIEMBRE: "09", SETIEMBRE: "09", OCTUBRE: "10", NOVIEMBRE: "11", DICIEMBRE: "12" };
const num = (s: string | undefined) => { const n = parseInt(String(s || "").replace(/[^\d]/g, ""), 10); return Number.isFinite(n) ? n : null; };
const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
// Una liquidación (texto del PDF, ítems unidos por « | »): null si no lo es o si falta el imponible.
function leerLiquidacion(t: string) {
  const u = sinTildes(t).toUpperCase();
  if (!/LIQUIDACION DE REMUNERACIONES/.test(u)) return null;
  const mm = u.match(/MES : \| ([A-Z]+) DE (\d{4})/); if (!mm || !MESES[mm[1]]) return null;
  const persona = (t.match(/NOMBRE : \| ([^|]+?) \|/) || [])[1]?.trim();
  const imponible = num((u.match(/TOTAL IMPONIBLE \| ([\d.]+)/) || [])[1]);
  if (!persona || imponible == null) return null;
  const iu = u.match(/IMPUESTO UNICO \(BASE IMPONIBLE \$([\d.]+)\) \| ([\d.]+)/);
  const tributable = iu ? num(iu[1]) : null, impuesto_unico = iu ? num(iu[2]) : 0;
  return { periodo: `${mm[2]}-${MESES[mm[1]]}`, persona, imponible, tributable, cotizaciones: tributable != null ? imponible - tributable : null, impuesto_unico };
}
// Tabla mensual del SII: por cada «<Mes> <año>» los 8 tramos MENSUAL (desde, hasta, factor, cantidad a rebajar).
function leerTabla(html: string, anio: number) {
  const t = sinTildes(html.replace(/&([a-z])acute;/gi, "$1").replace(/&ntilde;/gi, "n")).replace(/<[^>]+>/g, " | ").replace(/\s+/g, " ");
  const filas: { periodo: string; tramo: number; desde: number; hasta: number | null; factor: number; rebaja: number }[] = [];
  const re = new RegExp(`(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE) ${anio}`, "gi");
  const cortes = [...t.matchAll(re)].map((m) => ({ mes: MESES[m[1].toUpperCase()], i: m.index || 0 }));
  const pesos = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));
  for (let k = 0; k < cortes.length; k++) {
    const trozo = t.slice(cortes[k].i, k + 1 < cortes.length ? cortes[k + 1].i : undefined);
    const men = trozo.split(/QUINCENAL/i)[0]; if (!/MENSUAL/i.test(men)) continue;
    const per = `${anio}-${cortes[k].mes}`; if (filas.some((f) => f.periodo === per)) continue;
    const ex = men.match(/-\.- \| \| \$ ([\d.,]+) \| \| Exento/i); if (!ex) continue;
    filas.push({ periodo: per, tramo: 1, desde: 0, hasta: pesos(ex[1]), factor: 0, rebaja: 0 });
    for (const m of men.matchAll(/\$ ([\d.,]+) \| \| (?:\$ ([\d.,]+)|Y MAS) \| \| ([\d,]+) \| \| \$ ([\d.,]+)/gi))
      filas.push({ periodo: per, tramo: filas.filter((f) => f.periodo === per).length + 1, desde: pesos(m[1]), hasta: m[2] ? pesos(m[2]) : null, factor: Number(m[3].replace(",", ".")), rebaja: pesos(m[4]) });
  }
  return filas;
}
async function sb(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${path.split("?")[0]}: ${r.status} ${await r.text()}`); return r;
}

Deno.serve(async (req) => {
  // deno-lint-ignore no-explicit-any
  let body: any = {}; try { body = await req.json(); } catch { /* sin body */ }
  if (!CRON_SECRET || body.secret !== CRON_SECRET) return json({ error: "No autorizado" }, 403);
  try {
    if (body.accion === "tabla") {
      const anio = Number(body.anio) || new Date().getFullYear();
      const r = await fetch(`https://www.sii.cl/valores_y_fechas/impuesto_2da_categoria/impuesto${anio}.htm`, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(30000) });
      const t = new TextDecoder("latin1").decode(new Uint8Array(await r.arrayBuffer()));
      if (!r.ok) throw new Error(`sii.cl respondió ${r.status}`);
      const filas = leerTabla(t, anio);
      if (!body.dryRun && filas.length) await sb("sii_impuesto_unico?on_conflict=periodo,tramo", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(filas.map((f) => ({ ...f, fuente: `sii.cl impuesto${anio}.htm` }))) });
      const meses = [...new Set(filas.map((f) => f.periodo))];
      return json({ ok: true, dryRun: !!body.dryRun, anio, meses, tramos_por_mes: meses.map((m) => filas.filter((f) => f.periodo === m).length), ejemplo: filas.filter((f) => f.periodo === meses[0]) });
    }

    if (body.accion === "leer") {
      const H = { Authorization: `Bearer ${await token()}` };
      const meses = Math.min(Math.max(Number(body.meses) || 2, 1), 24);
      const q = encodeURIComponent(`from:${CONTADORA} subject:LIQUIDACIONES has:attachment newer_than:${meses * 31 + 10}d`);
      const lista = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=100`, { headers: H }).then((r) => r.json());
      const filas: Record<string, unknown>[] = [], errores: string[] = [];
      for (const it of lista.messages || []) {
        const m = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${it.id}?format=full`, { headers: H }).then((r) => r.json());
        // deno-lint-ignore no-explicit-any
        const partes = (function walk(p: any, acc: any[] = []): any[] { if (p?.parts) p.parts.forEach((x: unknown) => walk(x, acc)); else if (p?.filename) acc.push(p); return acc; })(m.payload);
        for (const p of partes.filter((x) => /\.pdf$/i.test(x.filename))) {
          try {
            const a = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${it.id}/attachments/${p.body.attachmentId}`, { headers: H }).then((r) => r.json());
            const l = leerLiquidacion(await textoPdf(b64urlBytes(a.data)));
            if (l) filas.push({ ...l, estudio_id: "lea", fuente: `correo ${it.id} · ${p.filename}`, _t: Number(m.internalDate) || 0 }); else errores.push(`${p.filename}: no se reconoció como liquidación`);
          } catch (e) { errores.push(`${p.filename}: ${(e as Error).message || e}`); }
        }
      }
      // La versión más reciente de cada (período, persona) manda: la contadora a veces reenvía corregida (regla en _shared/liquidacionesReglas.js).
      const out = liquidacionesVigentes(filas);
      if (!body.dryRun && out.length) await sb("remuneraciones_tributables?on_conflict=estudio_id,periodo,persona", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(out) });
      // Mientras la contadora no manda los valores del mes («VALORES MM-AAAA», que valores-contadora carga solo), las cotizaciones del mes se proyectan
      // con sus liquidaciones. Solo si el mes sigue provisorio (estimado, no cerrado) y el anterior tiene valores reales; los valores reales las reemplazan.
      const provisorias: Record<string, unknown>[] = [];
      if (!body.dryRun) for (const per of [...new Set(out.map((f) => String(f.periodo)))]) {
        const [Y, M] = per.split("-").map(Number), pY = M === 1 ? Y - 1 : Y, pM = M === 1 ? 12 : M - 1, prevPer = `${pY}-${String(pM).padStart(2, "0")}`;
        const plan = await (await sb(`oficina_costos_mensual?estudio_id=eq.lea&anio=eq.${Y}&mes=eq.${M}&select=estimado,cerrado,nota`)).json();
        if (!plan[0] || plan[0].cerrado || !plan[0].estimado) continue;
        const prev = await (await sb(`oficina_costos_mensual?estudio_id=eq.lea&anio=eq.${pY}&mes=eq.${pM}&select=estimado,cotizaciones`)).json();
        if (!prev[0] || prev[0].estimado) continue;
        const liqPrev = await (await sb(`remuneraciones_tributables?estudio_id=eq.lea&periodo=eq.${prevPer}&select=imponible,cotizaciones`)).json();
        const liqMes = out.filter((f) => f.periodo === per) as { imponible: number; cotizaciones: number }[];
        if (liqMes.length !== liqPrev.length) continue;   // falta alguna liquidación del mes: la suma saldría corta
        const est = cotizacionesProvisorias({ mes: liqMes, previo: liqPrev, cotizPrevReal: Number(prev[0].cotizaciones) });
        if (!est) continue;
        const nota0 = String(plan[0].nota || ""), nota = /liquidaciones/i.test(nota0) ? nota0 : `${nota0 ? nota0 + " · " : ""}cotizaciones estimadas con las liquidaciones leídas del correo`;
        await sb(`oficina_costos_mensual?estudio_id=eq.lea&anio=eq.${Y}&mes=eq.${M}`, { method: "PATCH", body: JSON.stringify({ cotizaciones: est.cotizaciones, nota, updated_at: new Date().toISOString() }) });
        provisorias.push({ periodo: per, cotizaciones: est.cotizaciones, trabajador: est.trabajador, empleador: est.empleador });
      }
      // Con las liquidaciones del mes: (1) cada pago de sueldo del banco queda con su persona cuando el monto lo identifica sin duda (líquido exacto de una sola
      // liquidación, o sueldo presupuestado único con destino compatible); (2) el presupuesto de oficina por persona sigue a la última liquidación, con vigencia
      // desde ese mes. Cada cambio queda en learnings (sueldo_persona_reasignada / presupuesto_desde_liquidacion) para poder revisarlo.
      const reasignados: Record<string, unknown>[] = [], presupuesto: Record<string, unknown>[] = [];
      const guardar = async (kind: string, key: string, value: unknown) => {
        const ya = await (await sb(`learnings?kind=eq.${kind}&key=eq.${encodeURIComponent(key)}&select=id&limit=1`)).json();
        if (ya[0]) await sb(`learnings?id=eq.${ya[0].id}`, { method: "PATCH", body: JSON.stringify({ value: JSON.stringify(value) }) });
        else await sb("learnings", { method: "POST", body: JSON.stringify({ kind, key, value: JSON.stringify(value) }) });
      };
      if (!body.dryRun && out.length) {
        const ofi = (await (await sb("clients?or=(is_internal.eq.true,name.ilike.*liberona escala*)&select=id&limit=1")).json())[0];
        const filasPpto = ((await (await sb("costos_oficina?estudio_id=eq.lea&select=id,categoria,item,monto,monto_prev,desde,activo,es_ingreso")).json()) as { id: string; categoria: string; item: string; monto: number; monto_prev: number | null; desde: string | null; activo: boolean | null; es_ingreso: boolean }[]).filter((f) => f.activo !== false && !f.es_ingreso);
        const etiquetas = [...new Set(((await (await sb("expenses?category=in.(Sueldos,Bono)&deleted_at=is.null&select=subcategory&limit=2000")).json()) as { subcategory: string | null }[]).map((e) => String(e.subcategory || "").trim()).filter(Boolean))];
        const mesSig = (per: string) => { const [y, m] = per.split("-").map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; };
        for (const per of [[...new Set(out.map((f) => String(f.periodo)))].sort().pop() as string]) {   // solo el mes más reciente leído: lo anterior ya se revisó
          const liqMes = out.filter((f) => f.periodo === per) as { persona: string; imponible: number; cotizaciones: number; impuesto_unico: number }[];
          if (ofi) {   // pagos hechos entre el día 11 del mes y el 10 del siguiente corresponden a ese mes trabajado
            const pagos = (await (await sb(`expenses?client_id=eq.${ofi.id}&type=eq.gasto&category=eq.Sueldos&deleted_at=is.null&date=gte.${per}-11&date=lte.${mesSig(per)}-10&select=id,date,amount,subcategory,concept`)).json()) as { id: string; date: string; amount: number; subcategory: string | null; concept: string | null }[];
            for (const pago of pagos) {
              const persona = personaDelPago({ amount: Number(pago.amount), concept: pago.concept || "" }, liqMes, filasPpto.filter((f) => f.categoria === "Remuneraciones"));
              if (!persona) continue;
              const cand = etiquetas.filter((l) => mismaPersona(l, persona)); if (cand.length !== 1) continue;
              if (String(pago.subcategory || "").trim() === cand[0]) continue;
              await sb(`expenses?id=eq.${pago.id}`, { method: "PATCH", body: JSON.stringify({ subcategory: cand[0] }) });
              await guardar("sueldo_persona_reasignada", String(pago.id), { fecha: pago.date, monto: pago.amount, de: pago.subcategory, a: cand[0], periodo: per });
              reasignados.push({ fecha: pago.date, monto: pago.amount, de: pago.subcategory, a: cand[0] });
            }
          }
        }
        const ultimo = [...new Set(out.map((f) => String(f.periodo)))].sort().pop() as string;
        const [uY, uM] = ultimo.split("-").map(Number), pY = uM === 1 ? uY - 1 : uY, pM = uM === 1 ? 12 : uM - 1;
        const liqUlt = out.filter((f) => f.periodo === ultimo) as { persona: string; imponible: number; cotizaciones: number; impuesto_unico: number }[];
        const prevPlan = await (await sb(`oficina_costos_mensual?estudio_id=eq.lea&anio=eq.${pY}&mes=eq.${pM}&select=estimado,cotizaciones`)).json();
        const liqPrev = await (await sb(`remuneraciones_tributables?estudio_id=eq.lea&periodo=eq.${pY}-${String(pM).padStart(2, "0")}&select=imponible,cotizaciones`)).json();
        const tasa = prevPlan[0] && !prevPlan[0].estimado && liqPrev.length === liqUlt.length ? cotizacionesProvisorias({ mes: liqUlt, previo: liqPrev, cotizPrevReal: Number(prevPlan[0].cotizaciones) })?.tasaEmpleador ?? null : null;
        for (const u of presupuestoDesdeLiquidaciones({ periodo: ultimo, liquidaciones: liqUlt, tasaEmpleador: tasa, filas: filasPpto })) {
          await sb(`costos_oficina?id=eq.${u.id}`, { method: "PATCH", body: JSON.stringify({ monto: u.monto, monto_prev: u.monto_prev, desde: u.desde, updated_at: new Date().toISOString() }) });
          await guardar("presupuesto_desde_liquidacion", `${u.id}|${ultimo}`, { categoria: u.categoria, item: u.item, antes: u.antes, ahora: u.monto, desde: u.desde });
          presupuesto.push({ categoria: u.categoria, item: u.item, antes: u.antes, ahora: u.monto, desde: u.desde });
        }
      }
      const porMes: Record<string, { personas: number; impuesto_unico: number }> = {};
      for (const f of out) { const k = String(f.periodo); porMes[k] = porMes[k] || { personas: 0, impuesto_unico: 0 }; porMes[k].personas++; porMes[k].impuesto_unico += Number(f.impuesto_unico) || 0; }
      return json({ ok: true, dryRun: !!body.dryRun, correos: (lista.messages || []).length, liquidaciones: out.length, porMes, provisorias, reasignados, presupuesto, errores });
    }
    if (body.accion === "muestra") {
      const H = { Authorization: `Bearer ${await token()}` };
      const q = encodeURIComponent(`from:${CONTADORA} subject:LIQUIDACIONES has:attachment ${body.mes ? `subject:${body.mes}` : "newer_than:40d"}`);
      const lista = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=5`, { headers: H }).then((r) => r.json());
      const id = lista.messages?.[0]?.id; if (!id) return json({ ok: true, mensajes: 0 });
      const m = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, { headers: H }).then((r) => r.json());
      const asunto = (m.payload?.headers || []).find((h: { name: string }) => h.name.toLowerCase() === "subject")?.value;
      // deno-lint-ignore no-explicit-any
      const partes = (function walk(p: any, acc: any[] = []): any[] { if (p?.parts) p.parts.forEach((x: unknown) => walk(x, acc)); else if (p?.filename) acc.push(p); return acc; })(m.payload);
      const pdfs = [];
      for (const p of partes.filter((x) => /\.pdf$/i.test(x.filename)).slice(0, Number(body.max) || 1)) {
        const a = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/attachments/${p.body.attachmentId}`, { headers: H }).then((r) => r.json());
        pdfs.push({ archivo: p.filename, texto: (await textoPdf(b64urlBytes(a.data))).slice(0, 6000) });
      }
      return json({ ok: true, asunto, mensajes: lista.messages?.length || 0, pdfs });
    }
    return json({ error: "accion desconocida" }, 400);
  } catch (e) { return json({ error: String((e as Error).message || e) }, 500); }
});
