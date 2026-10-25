// Edge Function: diario-oficial
// 1) Índice: lee la sección «Empresas y Cooperativas» de la edición electrónica del Diario Oficial (pública, sin clave ni captcha)
//    de los últimos días y la guarda en diario_oficial_empresas (una fila por publicación: fecha, razón social, RUT, categoría,
//    CVE, PDF). Es dato público y común a todos los estudios.
// 2) Extractos: para cada extracto o protocolización de extracto que mandó la notaría (documentos_notaria, razones sociales y
//    escritura leídas con IA en lectura) busca la publicación de la sociedad del acto desde 60 días antes del documento hasta 120
//    después. Prueba: el extracto publicado (su PDF, leído una vez con IA y guardado en detalle) cita el MISMO repertorio de la
//    escritura; sin repertorio, la misma fecha de escritura. do_estado = publicado (fecha, CVE, PDF, criterio) / pendiente /
//    plazo_vencido (más de 60 días desde la escritura sin publicación: art. 426 C. de Comercio, Ley 18.046 art. 5 y Ley 3.918;
//    el mismo plazo rige para las modificaciones).
// body.desde / body.hasta (aaaa-mm-dd) = recargar ese rango del índice (máx. 40 días por llamada); body.dias (por defecto 4);
// body.soloCruce = no leer el índice, solo cruzar; body.lecturas = tope de PDF leídos con IA (15).
// Auth: CRON_SECRET o sesión de un usuario del dominio de la oficina. verify_jwt=false.

import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { enviarPush, emailsDeNombres } from "../_shared/push.ts";

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const ANTHROPIC = Deno.env.get("ANTHROPIC_API_KEY") || "";
const DO = "https://www.diariooficial.interior.gob.cl/edicionelectronica/";
const PLAZO_DIAS = 60;
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const hoyCL = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const masDias = (iso: string, n: number) => new Date(Date.parse(iso + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const dmy = (iso: string) => iso.split("-").reverse().join("-");
const pausa = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const ent = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/&([a-z]+);/gi, (m, n) => ({ ntilde: "ñ", Ntilde: "Ñ", aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", uuml: "ü", Uuml: "Ü" } as Record<string, string>)[n] || m);

// Razón social comparable: minúsculas, sin acentos ni puntuación, abreviaturas societarias unificadas.
export function normRS(s: string): string {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9& ]/g, " ").replace(/\s+/g, " ").trim()
    .replace(/\bltda\b/g, "limitada").replace(/\bcia\b/g, "compania").replace(/\bs a\b/g, "sa").replace(/\beirl\b/g, "e i r l");
}

// deno-lint-ignore no-explicit-any
async function rest(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${path.split("?")[0]}: ${r.status} ${await r.text()}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
const get = (u: string) => fetch(u, { headers: { "User-Agent": "Mozilla/5.0" } }).then((r) => r.ok ? r.text() : "").catch(() => "");

// Publicaciones de un día. Sin sección de empresas ese día (domingo, festivo, edición sin empresas) → [].
async function edicion(iso: string) {
  const ds = dmy(iso);
  const idx = await get(`${DO}index.php?date=${ds}`);
  // La portada no siempre enlaza la sección de empresas aunque exista: basta el número de la edición del día (sin la «-B»).
  const m = idx.match(new RegExp(`date=(${ds})&(?:amp;)?edition=(\\d+)(?![\\d-])`));
  if (!m) return [];
  const s = await get(`${DO}empresas_cooperativas.php?date=${ds}&edition=${m[2]}`);
  const out: Record<string, string | null>[] = []; let cat: string | null = null, sub: string | null = null;
  for (const r of s.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const row = r[1]; const txt = ent(row.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    const pdf = row.match(/href="([^"]+\.pdf)"/);
    if (pdf) {
      const cve = txt.match(/CVE-(\d+)/); const nombre = txt.split("Ver PDF")[0].trim();
      // Modificaciones y disoluciones traen el RUT pegado al nombre («GESGROUP INVERSIONES LIMITADA 77.704.691-8*»).
      const rut = nombre.match(/(\d{1,2}\.?\d{3}\.?\d{3}-[\dkK])\*?\s*$/);
      const sinRut = rut ? nombre.slice(0, rut.index).trim() : nombre;
      if (cve && nombre) out.push({ fecha: iso, edicion: m[2], nombre, nombre_norm: normRS(sinRut), rut: rut ? rut[1].replace(/\./g, "").toUpperCase() : null, categoria: cat, subtipo: sub, cve: cve[1], url: pdf[1] });
    } else if (txt && txt === txt.toUpperCase() && txt.length < 60) cat = txt;
    else if (txt) sub = txt;
  }
  return out;
}

// Fecha desde la que corre el plazo: la de la escritura citada en el resumen («escritura del 17-06-2026»), si no la del documento.
// deno-lint-ignore no-explicit-any
function fechaBase(d: any): string | null {
  const m = String(d.lectura?.resumen || "").match(/escritura (?:p[uú]blica )?(?:de fecha |del |de )(\d{2})[-/](\d{2})[-/](\d{4})/i);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return d.lectura?.fecha || d.fecha_documento || (d.recibido_at ? String(d.recibido_at).slice(0, 10) : null);
}
// Tipo de acto del extracto → categoría del Diario Oficial (CONSTITUCIÓN / MODIFICACIÓN / DISOLUCIÓN…), para elegir la publicación
// correcta cuando la misma sociedad tiene varias en la ventana.
const actoDe = (d: { lectura?: { acto?: string; resumen?: string }; tipo_documento?: string }) => {
  const t = normRS(`${d.lectura?.acto || ""} ${d.tipo_documento || ""}`);
  // La sociedad que nace de una división o fusión se publica como CONSTITUCIÓN; la que se divide o absorbe, como MODIFICACIÓN.
  return /disolu/.test(t) ? "disolu" : /constituc/.test(t) ? "constituc" : /divisi|fusi|modific|aumento|disminuc|retiro|ingreso/.test(t) ? "modific" : "";
};

const soloDigitos = (x: unknown) => String(x ?? "").split("/")[0].replace(/\D/g, "");
// Repertorio de la escritura extractada: el que leyó la IA; en un extracto, su propio repertorio; en una protocolización, el que
// cite el resumen («Rep. 31263/2026»). El repertorio de la protocolización NO sirve (es otro número).
// deno-lint-ignore no-explicit-any
function repEscritura(d: any): string {
  const ia = soloDigitos(d.lectura?.escritura?.repertorio); if (ia) return ia;
  if (!/protocoliz/i.test(`${d.tipo_documento || ""} ${d.lectura?.acto || ""}`)) return soloDigitos(d.lectura?.repertorio || d.repertorio);
  const m = String(d.lectura?.resumen || "").match(/Rep(?:ertorio)?\.?\s*(?:N[°ºo]\.?\s*)?([\d.]+)\/\d{4}/i);
  return m ? soloDigitos(m[1]) : "";
}
// Texto del extracto publicado (PDF del Diario Oficial) leído con IA: acto, fecha y repertorio de la escritura, sociedades.
async function leerPublicacion(url: string) {
  const pdf = await fetch(url.replace(/^http:/, "https:"), { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!pdf.ok) throw new Error(`PDF ${pdf.status}`);
  const bytes = new Uint8Array(await pdf.arrayBuffer());
  const prompt = `Es un extracto publicado en el Diario Oficial de Chile. Devuelve SOLO un JSON:
{"acto":"constitución / modificación / división / fusión / disolución / otro","fecha_escritura":"AAAA-MM-DD o null","repertorio":"número de repertorio de la escritura o null","notaria":"notario o null","sociedades":["razón social de cada sociedad que el extracto constituye, modifica, divide, fusiona o disuelve"]}
Copia las razones sociales tal como aparecen. Si no se lee algo, usa null. No inventes.`;
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": ANTHROPIC, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-opus-4-8", max_tokens: 600, messages: [{ role: "user", content: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: encodeBase64(bytes) } }, { type: "text", text: prompt }] }] }) });
  const d = await r.json(); if (!r.ok) throw new Error(`IA: ${d?.error?.message || r.status}`);
  const t = (d.content || []).map((c: { text?: string }) => c.text || "").join(""); const m = t.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("IA: sin JSON"); return JSON.parse(m[0]);
}

Deno.serve(async (req) => {
  // deno-lint-ignore no-explicit-any
  let body: any = {}; try { body = await req.json(); } catch { /* sin body */ }
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!CRON_SECRET) return json({ error: "No autorizado" }, 403);
  if (body.secret !== CRON_SECRET && bearer !== CRON_SECRET) {
    const u = bearer ? await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${bearer}` } }).then((r) => r.ok ? r.json() : null).catch(() => null) : null;
    const cas = await rest("learnings?kind=eq.config&key=eq.agente_casilla&select=value").catch(() => []);
    const dom = String(cas?.[0]?.value || "").split("@")[1];
    if (!u?.email || !dom || !String(u.email).toLowerCase().endsWith("@" + dom.toLowerCase())) return json({ error: "No autorizado" }, 403);
  }
  try {
    const hoy = hoyCL();
    // 1) Índice del Diario Oficial
    let leidos = 0, dias = 0;
    if (!body.soloCruce) {
      const hasta = body.hasta || hoy;
      let desde = body.desde || masDias(hasta, -(Math.max(1, Math.min(10, Number(body.dias) || 4)) - 1));
      if (Date.parse(hasta) - Date.parse(desde) > 40 * 864e5) desde = masDias(hasta, -40);
      for (let d = desde; d <= hasta; d = masDias(d, 1)) {
        if (new Date(d + "T12:00:00Z").getUTCDay() === 0) continue;
        const rows = await edicion(d); dias++;
        for (let i = 0; i < rows.length; i += 200) {
          await rest("diario_oficial_empresas?on_conflict=cve", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(rows.slice(i, i + 200)) });
        }
        leidos += rows.length; await pausa(300);
      }
    }
    // 2) Cruce con los extractos de la notaría. Se revisan los sin publicación y los que calzaron solo por cercanía de fechas.
    const docs = await rest("documentos_notaria?and=(or(tipo_documento.ilike.*extracto*,archivo_nombre.ilike.*extracto*),or(do_estado.is.null,do_estado.neq.publicado,do_publicacion->>criterio.eq.cercania))&lectura=not.is.null&select=id,estudio_id,cliente_id,tipo_documento,repertorio,fecha_documento,recibido_at,lectura,do_estado&limit=500");
    const res = { publicados: 0, pendientes: 0, vencidos: 0, sinRazonSocial: 0, lecturas: 0 };
    let cupoIA = Math.min(40, Number(body.lecturas) || 15);
    for (const d of docs) {
      const socs = [...new Set((d.lectura?.sociedades || []).map((s: { razon_social?: string }) => normRS(s?.razon_social || "")).filter((x: string) => x.length > 3))] as string[];
      const base = fechaBase(d);
      if (!socs.length || !base) {
        res.sinRazonSocial++;
        await rest(`documentos_notaria?id=eq.${d.id}`, { method: "PATCH", body: JSON.stringify({ do_estado: "no_aplica", do_revisado_at: new Date().toISOString() }) });
        continue;
      }
      // Solo cuenta la publicación de la sociedad DEL ACTO: la que el resumen nombra primero («constitución de INVERSIONES ESCO
      // LIMITADA, nacida de la división de GESGROUP…»). Las demás son socios o la sociedad de origen.
      const resumen = normRS(d.lectura?.resumen || "");
      const pos = (s: string) => { const i = resumen.indexOf(s); return i < 0 ? 1e9 : i; };
      const sujeto = [...socs].sort((a, b) => pos(a) - pos(b))[0];
      const repDoc = repEscritura(d);
      // La protocolización del extracto suele hacerse DESPUÉS de inscribir y publicar: la publicación puede ser anterior al documento.
      const desde = masDias(base, -60), hasta = masDias(base, 120);
      const lista = encodeURIComponent(socs.map((s) => `"${s}"`).join(","));
      const cand = await rest(`diario_oficial_empresas?nombre_norm=in.(${lista})&fecha=gte.${desde}&fecha=lte.${hasta}&select=fecha,nombre,nombre_norm,rut,categoria,subtipo,cve,url,detalle&order=fecha.asc&limit=40`);
      // Cada candidata se lee una vez (texto del extracto publicado: repertorio y fecha de la escritura, sociedades) y queda guardada.
      for (const p of cand) {
        if (p.detalle || cupoIA <= 0 || !ANTHROPIC) continue;
        try { p.detalle = await leerPublicacion(p.url); cupoIA--; res.lecturas++; }
        catch (e) { p.detalle = { error: String((e as Error).message || e) }; if (/rate|overloaded|429|529/i.test(p.detalle.error)) { cupoIA = 0; continue; } }
        await rest(`diario_oficial_empresas?cve=eq.${p.cve}`, { method: "PATCH", body: JSON.stringify({ detalle: p.detalle }) });
      }
      const cubre = (p: { nombre_norm: string; detalle?: { sociedades?: string[] } }) => p.nombre_norm === sujeto || (p.detalle?.sociedades || []).some((x) => normRS(x) === sujeto);
      const leida = (p: { detalle?: { repertorio?: string; error?: string } }) => !!p.detalle && !p.detalle.error;
      const deSujeto = cand.filter(cubre);
      const acto = actoDe(d);
      const pesa = (p: { categoria: string; fecha: string }) =>
        (acto && normRS(p.categoria || "").includes(acto) ? 0 : 1e6) + Math.abs(Date.parse(p.fecha) - Date.parse(base)) / 864e5;
      const mejor = (xs: typeof cand) => [...xs].sort((a, b) => pesa(a) - pesa(b))[0];
      // Prueba: el extracto publicado cita el MISMO repertorio de la escritura. Sin repertorio, la misma fecha de escritura. Solo si
      // la publicación no se pudo leer se elige por tipo de acto y cercanía (criterio «cercania», se vuelve a revisar).
      const fEsc = d.lectura?.escritura?.fecha || null;
      const porRep = repDoc ? deSujeto.filter((p) => soloDigitos(p.detalle?.repertorio) === repDoc) : [];
      const porFecha = !repDoc && fEsc ? deSujeto.filter((p) => p.detalle?.fecha_escritura === fEsc) : [];
      // Sin dato = no se pudo leer la publicación o no trae el repertorio: no la descarta.
      const sinLeer = deSujeto.filter((p) => !leida(p) || (repDoc && !soloDigitos(p.detalle?.repertorio)));
      let pub = null, criterio = null;
      // La misma escritura puede publicarse más de una vez (complemento o corrección): cuenta la primera; las otras quedan anotadas.
      // Una división publica con el mismo repertorio a la que se divide y a cada sociedad nueva: primero la publicación A NOMBRE de la
      // sociedad del acto, luego la del tipo de acto, luego la más antigua.
      const orden = (p: { nombre_norm: string; categoria: string; fecha: string }) =>
        `${p.nombre_norm === sujeto ? 0 : 1}${acto && normRS(p.categoria || "").includes(acto) ? 0 : 1}${p.fecha}`;
      let otras: typeof cand = [];
      if (porRep.length) {
        pub = [...porRep].sort((a, b) => orden(a).localeCompare(orden(b)))[0]; criterio = "repertorio";
        otras = porRep.filter((p) => p !== pub && p.nombre_norm === pub.nombre_norm);
      }
      else if (porFecha.length) { pub = mejor(porFecha); criterio = "fecha_escritura"; }
      else if (!repDoc && !fEsc && deSujeto.length) { pub = mejor(deSujeto); criterio = deSujeto.every(leida) ? "sociedad" : "cercania"; }
      else if (sinLeer.length) { pub = mejor(sinLeer); criterio = "cercania"; }
      // Fecha de la escritura leída en la publicación: solo si es plausible (hasta 6 meses antes del documento; el extracto también
      // cita la constitución original de la sociedad, años antes).
      const fPub = pub?.detalle?.fecha_escritura && pub.detalle.fecha_escritura <= base && pub.detalle.fecha_escritura >= masDias(base, -180) ? pub.detalle.fecha_escritura : null;
      const vence = masDias(fEsc || fPub || base, PLAZO_DIAS);
      const estado = pub ? "publicado" : hoy > vence ? "plazo_vencido" : "pendiente";
      res[estado === "publicado" ? "publicados" : estado === "pendiente" ? "pendientes" : "vencidos"]++;
      const pubData = pub ? { fecha: pub.fecha, nombre: pub.nombre, rut: pub.rut, categoria: pub.categoria, subtipo: pub.subtipo, cve: pub.cve, url: pub.url, criterio, repertorio: pub.detalle?.repertorio || null, fecha_escritura: pub.detalle?.fecha_escritura || null, base, vence,
          otras: otras.map((p) => ({ fecha: p.fecha, cve: p.cve, url: p.url })) }
        : { base, vence, sociedad: sujeto, repertorio: repDoc || null };
      const antes = d.do_estado;
      await rest(`documentos_notaria?id=eq.${d.id}`, { method: "PATCH", body: JSON.stringify({ do_estado: estado, do_publicacion: pubData, do_revisado_at: new Date().toISOString() }) });
      if (pub && antes !== "publicado" && d.cliente_id) {
        const cl = (await rest(`clients?id=eq.${d.cliente_id}&select=name,abogado_responsable`).catch(() => []))?.[0];
        const a = await emailsDeNombres(SB_URL, SB_KEY, [cl?.abogado_responsable]);
        if (a.length) await enviarPush(SB_URL, SB_KEY, a, { titulo: "Publicado en el Diario Oficial", cuerpo: `${pub.nombre || cl?.name || "Extracto"} · ${String(pub.fecha || "").slice(0, 10).split("-").reverse().join("-")}`, url: `/?cliente=${d.cliente_id}`, etiqueta: `do-${d.id}` }, "clientes").catch(() => null);
      }
      if (pub && antes !== "publicado") await rest("activity_log", { method: "POST", body: JSON.stringify({ user_email: "agente", action: "notaria.diario_oficial_publicado", table_name: "documentos_notaria", record_id: d.id, estudio_id: d.estudio_id, detail: { title: `Publicado en el Diario Oficial: ${pub.nombre} · ${dmy(pub.fecha)} · CVE ${pub.cve}`, url: pub.url, criterio } }) }).catch(() => null);
    }
    return json({ ok: true, dias, leidos, revisados: docs.length, ...res });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
