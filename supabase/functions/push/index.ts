// Edge Function: push — notificaciones al teléfono (Web Push).
//   · action 'clave'     → la clave pública VAPID con que el teléfono se suscribe (sesión del dominio).
//   · action 'probar'    → notificación de prueba a los dispositivos de quien llama (sesión del dominio).
//   · action 'cola'      → (cron 8:00) envía lo que llegó de noche, agrupado por persona (push_cola).
//   · action 'normativa' → (cron, tras cada ronda de normativa) oficios, circulares y resoluciones nuevos del SII (sii_novedades
//                          sin push_at, con fecha de los últimos 7 días: una carga histórica no dispara avisos) a learnings config
//                          push_normativa_a (sin valor: los socios).
// Los demás avisos los envían las funciones que ya avisan por correo (notify-task, conciliacion-auto, causas-tablas…) con
// _shared/push.ts. Auth: sesión de una persona del dominio de la oficina, o CRON_SECRET en body.secret (cola, normativa).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enviarPush, clavePublicaPush, type TipoPush } from "../_shared/push.ts";

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const DOMINIO = "@leabogados.cl";
const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const rest = async (path: string, init: RequestInit = {}) => { const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } }); if (!r.ok) throw new Error(`${path.split("?")[0]}: ${r.status}`); const t = await r.text(); return t ? JSON.parse(t) : null; };
const TIPO_DOC: Record<string, [string, string]> = { oficio: ["Oficio", "Oficios"], circular: ["Circular", "Circulares"], resolucion: ["Resolución", "Resoluciones"] };

async function cola(dryRun: boolean) {
  // Se reservan los pendientes ANTES de enviar (marca enviado_at solo donde sigue vacío): si dos corridas coinciden, cada aviso
  // lo toma una sola y nunca sale repetido. En prueba solo se leen.
  const pend: { id: string; email: string; tipo: TipoPush; titulo: string; cuerpo: string; url: string }[] = dryRun
    ? await rest("push_cola?select=id,email,tipo,titulo,cuerpo,url&enviado_at=is.null&order=created_at.asc")
    : await rest("push_cola?enviado_at=is.null&select=id,email,tipo,titulo,cuerpo,url,created_at", { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ enviado_at: new Date().toISOString() }) });
  pend.sort((a, b) => String((a as { created_at?: string }).created_at || "").localeCompare(String((b as { created_at?: string }).created_at || "")));
  const porPersona: Record<string, typeof pend> = {};
  pend.forEach((p) => (porPersona[p.email] = porPersona[p.email] || []).push(p));
  const out: unknown[] = [];
  for (const [email, ps] of Object.entries(porPersona)) {
    // Uno solo: sale tal cual. Varios del mismo tipo o de tipos distintos: un aviso con el total y los títulos.
    const aviso = ps.length === 1 ? { titulo: ps[0].titulo, cuerpo: ps[0].cuerpo, url: ps[0].url }
      : { titulo: `${ps.length} avisos de la noche`, cuerpo: [...new Set(ps.map((p) => p.titulo))].slice(0, 4).join(" · "), url: ps.every((p) => p.url === ps[0].url) ? ps[0].url : "/" };
    const tipo = ps.every((p) => p.tipo === ps[0].tipo) ? ps[0].tipo : "sistema";
    out.push({ email, n: ps.length, aviso });
    if (dryRun) continue;
    await enviarPush(SB_URL, SERVICE_KEY, [email], { ...aviso, etiqueta: "noche" }, tipo, { sinCola: true });
  }
  return { personas: out.length, avisos: pend.length, detalle: out };
}

async function normativa(dryRun: boolean) {
  const desde = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const docs: { id: string; tipo: string; numero: string; fecha: string; titulo: string }[] = await rest(`sii_novedades?select=id,tipo,numero,fecha,titulo&push_at=is.null&fecha=gte.${desde}&order=fecha.asc`);
  // Lo que no cumple la ventana de fecha se marca igual: nunca se avisa una carga histórica.
  const viejos: { id: string }[] = await rest(`sii_novedades?select=id&push_at=is.null&fecha=lt.${desde}`);
  if (!dryRun && viejos.length) await rest(`sii_novedades?id=in.(${viejos.map((v) => v.id).join(",")})`, { method: "PATCH", body: JSON.stringify({ push_at: new Date().toISOString() }) });
  if (!docs.length) return { nuevos: 0, historicos_marcados: viejos.length };
  const cfg = await rest("learnings?select=value&kind=eq.config&key=eq.push_normativa_a");
  let a = String(cfg?.[0]?.value || "").split(/[,;\s]+/).filter((x) => x.includes("@"));
  if (!a.length) a = (await rest("miembros?select=email&rol=eq.admin")).map((m: { email: string }) => m.email);
  const et = (d: { tipo: string; numero: string }) => `${(TIPO_DOC[d.tipo] || [d.tipo])[0]} N° ${d.numero}`;
  const aviso = docs.length === 1
    ? { titulo: `${(TIPO_DOC[docs[0].tipo] || ["Documento"])[0]} nuevo del SII`, cuerpo: `N° ${docs[0].numero} · ${docs[0].titulo}`, url: "/?ir=radar" }
    : { titulo: `${docs.length} documentos nuevos del SII`, cuerpo: Object.entries(docs.reduce((m: Record<string, string[]>, d) => { (m[d.tipo] = m[d.tipo] || []).push(d.numero); return m; }, {}))
        .map(([t, ns]) => `${(TIPO_DOC[t] || [t, t])[ns.length > 1 ? 1 : 0]} N° ${ns.join(", ")}`).join(" · "), url: "/?ir=radar" };
  if (dryRun) return { nuevos: docs.length, a, aviso, docs: docs.map(et) };
  const r = await enviarPush(SB_URL, SERVICE_KEY, a, { ...aviso, etiqueta: "normativa" }, "normativa");
  await rest(`sii_novedades?id=in.(${docs.map((d) => d.id).join(",")})`, { method: "PATCH", body: JSON.stringify({ push_at: new Date().toISOString() }) });
  return { nuevos: docs.length, a, ...r };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const esCron = !!CRON_SECRET && body.secret === CRON_SECRET;
    if (esCron && body.action === "cola") return json({ ok: true, ...(await cola(!!body.dryRun)) });
    if (esCron && body.action === "normativa") return json({ ok: true, ...(await normativa(!!body.dryRun)) });
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const sb = createClient(SB_URL, SERVICE_KEY);
    const { data: { user } } = await sb.auth.getUser(token);
    const email = (user?.email || "").toLowerCase();
    if (!email.endsWith(DOMINIO)) return json({ error: "No autorizado" }, 403);
    if (body.action === "clave") {
      const clave = clavePublicaPush();
      return clave ? json({ clave }) : json({ error: "Las notificaciones aún no están configuradas en el servidor." }, 503);
    }
    if (body.action === "probar") {
      const r = await enviarPush(SB_URL, SERVICE_KEY, [email], { titulo: "Notificaciones activadas", cuerpo: "Desde ahora los avisos de la app llegan a este dispositivo.", url: "/?ir=tareas", etiqueta: "prueba" }, "prueba", { sinCola: true });
      return json({ ok: true, ...r });
    }
    return json({ error: "Acción desconocida" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
