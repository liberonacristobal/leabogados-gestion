// Edge Function: gastos-trabajo-ia
// Revisión semanal con IA del trabajo (venta) de los gastos que la regla única no resuelve (sugerirVentaGasto de
// ../_shared/ventaGastoReglas.js: sin aprendido, sin única venta o única activa, sin otro gasto del mismo día con trabajo).
// Por cliente, la IA lee el gasto, las ventas posibles, los gastos del cliente ya asignados (±20 días), las tareas con proyecto,
// lo que la app leyó de los documentos de la notaría y del cliente, y el asunto y extracto de los correos que nombran la OT.
// Deja SOLO una propuesta (learnings gasto_venta_ia, key = id del gasto, value = id de la venta, meta = confianza y evidencia):
// la ficha la muestra preseleccionada y una persona la confirma con «Asignar». Nunca escribe en el gasto.
// Mismo universo que «Gastos sin proyecto» (pendientes-semanal): gastos desde 01-06-2026, con cliente que no es el interno.
// Modos (body): dryRun = no guarda · backtest = N gastos ya asignados que la regla no resolvía: esconde su trabajo y mide si la
// IA lo encuentra (excluir = ids que no cuentan) · max = tope de gastos por corrida (40). Interruptor learnings config gastos_trabajo_ia = 'on'
// (sin 'on' = solo dryRun). Auth: CRON_SECRET. verify_jwt=false.

import { todasRest } from "../_shared/paginar.js";
import { sugerirVentaGasto, VENTA_REAL } from "../_shared/ventaGastoReglas.js";

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const ANTHROPIC = Deno.env.get("ANTHROPIC_API_KEY") || "";
const CLIENT_ID = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") || "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") || "";
const DESDE = "2026-06-01";
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
// deno-lint-ignore no-explicit-any
const todas = (path: string): Promise<any[]> => todasRest(SB_URL, H, path);
const dmy = (iso: string) => { const [y, m, d] = String(iso || "").slice(0, 10).split("-"); return d ? `${d}-${m}-${y}` : ""; };
const dias = (a: string, b: string) => Math.abs((new Date(a + "T12:00:00").getTime() - new Date(b + "T12:00:00").getTime()) / 864e5);
const corto = (s: unknown, n = 140) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

// Casilla conectada (drive_auth): solo asunto y extracto de los correos, nunca el cuerpo completo.
let _tok = "", _exp = 0;
async function token(): Promise<string | null> {
  if (_tok && _exp > Date.now() + 60000) return _tok;
  try {
    const r0 = await fetch(`${SB_URL}/rest/v1/drive_auth?id=eq.1&select=refresh_token`, { headers: H });
    const rt = (await r0.json())?.[0]?.refresh_token; if (!rt || !CLIENT_ID) return null;
    const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: rt, grant_type: "refresh_token" }) });
    const d = await r.json(); if (!r.ok) return null;
    _tok = d.access_token; _exp = Date.now() + (d.expires_in || 3600) * 1000; return _tok;
  } catch { return null; }
}
async function correos(q: string, max = 3): Promise<string[]> {
  const t = await token(); if (!t) return [];
  try {
    const l = await (await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}&q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${t}` } })).json();
    const out: string[] = [];
    for (const m of (l?.messages || []).slice(0, max)) {
      const d = await (await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=Date`, { headers: { Authorization: `Bearer ${t}` } })).json();
      // deno-lint-ignore no-explicit-any
      const h = (n: string) => (d?.payload?.headers || []).find((x: any) => x.name === n)?.value || "";
      out.push(`${corto(h("Date"), 31)} · «${corto(h("Subject"), 90)}» · ${corto(d?.snippet, 160)}`);
    }
    return out;
  } catch { return []; }
}

// deno-lint-ignore no-explicit-any
async function ia(prompt: string): Promise<any[]> {
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": ANTHROPIC, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-opus-4-8", max_tokens: 2500, messages: [{ role: "user", content: prompt }] }) });
  const d = await r.json(); if (!r.ok) throw new Error(`IA: ${d?.error?.message || r.status}`);
  const t = (d.content || []).map((c: { text?: string }) => c.text || "").join(""); const m = t.match(/\[[\s\S]*\]/);
  return m ? JSON.parse(m[0]) : [];
}

Deno.serve(async (req) => {
  // deno-lint-ignore no-explicit-any
  let body: any = {}; try { body = await req.json(); } catch { /* sin body */ }
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!CRON_SECRET || (body.secret !== CRON_SECRET && bearer !== CRON_SECRET)) return json({ error: "No autorizado" }, 403);
  if (!ANTHROPIC) return json({ error: "Falta ANTHROPIC_API_KEY" }, 500);
  try {
    const cfg = await todas("learnings?select=value&kind=eq.config&key=eq.gastos_trabajo_ia&order=updated_at.desc");
    const backtest = Math.max(0, Math.min(40, Number(body.backtest) || 0));
    const dryRun = !!body.dryRun || !!backtest || String(cfg[0]?.value || "") !== "on";
    const max = Math.max(1, Math.min(80, Number(body.max) || 40));
    const [ex, sa, cl, ents, le, prev, tareas, docsN, docsL] = await Promise.all([
      todas("expenses?select=id,client_id,sale_id,date,entity_id,concept,amount,ot_number,project,category,type,deleted_at,apertura_id,no_descuenta_saldo,created_by&deleted_at=is.null&order=id"),
      todas("sales?select=id,client_id,status,deleted_at,title,area,created_at,activated_at,updated_at&deleted_at=is.null&order=id"),
      todas("clients?select=id,name,is_internal&order=id"),
      todas("client_entities?select=id,client_id,name&order=id"),
      todas("learnings?select=key,value,meta&kind=eq.gasto_proyecto&order=id"),
      todas("learnings?select=key&kind=eq.gasto_venta_ia&order=id"),
      todas(`tasks?select=client_id,title,project,created_at&created_at=gte.${DESDE}&order=id`),
      todas("documentos_notaria?select=expense_id,ot_number,cliente_id,razon_social,lectura,asunto&order=id"),
      todas(`documentos_lectura?select=client_id,titulo,fecha,comparecientes&fecha=gte.${DESDE}&order=id`),
    ]);
    const interno = new Set(cl.filter((c) => c.is_internal).map((c) => String(c.id)));
    const nomCli = Object.fromEntries(cl.map((c) => [String(c.id), c.name]));
    const nomRs = Object.fromEntries(ents.map((e) => [String(e.id), e.name]));
    const ventaDe = Object.fromEntries(sa.map((s) => [String(s.id), s]));
    const vPor: Record<string, any[]> = {}; sa.filter(VENTA_REAL).forEach((s) => { (vPor[String(s.client_id)] = vPor[String(s.client_id)] || []).push(s); });
    const yaIa = new Set(prev.map((r) => String(r.key)));
    const esCand = (e: any) => e.type === "gasto" && !e.apertura_id && !e.no_descuenta_saldo && e.client_id && !interno.has(String(e.client_id)) && String(e.date || "") >= DESDE;
    const resuelve = (e: any, vs: any[], aprendidos: any[]) => { const r = sugerirVentaGasto(e, vs, { aprendidos, hermanos: ex.filter((h) => h.id !== e.id && String(h.client_id) === String(e.client_id)) }); return ["aprendido", "unica", "activa", "mismo_dia"].includes(r.regla) ? r : null; };

    // Universo: sin trabajo (o, en backtest, con trabajo escondido) y que la regla no resuelve.
    let cand: any[];
    const excluir = new Set((body.excluir || []).map(String));   // backtest: gastos cuyo trabajo se decidió con ayuda de la IA (no medirla contra sí misma)
    if (backtest) cand = ex.filter((e) => esCand(e) && e.sale_id && !excluir.has(String(e.id)) && (vPor[String(e.client_id)] || []).some((s) => String(s.id) === String(e.sale_id)) && (vPor[String(e.client_id)] || []).length > 1 && !resuelve({ ...e, sale_id: null }, vPor[String(e.client_id)], []))
      .sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, backtest);
    else cand = ex.filter((e) => esCand(e) && !e.sale_id && (vPor[String(e.client_id)] || []).length > 1 && !yaIa.has(String(e.id)) && !resuelve(e, vPor[String(e.client_id)], le)).slice(0, max);

    const porCli: Record<string, any[]> = {}; cand.forEach((e) => { (porCli[String(e.client_id)] = porCli[String(e.client_id)] || []).push(e); });
    const propuestas: any[] = [], errores: string[] = [];
    for (const [cid, gs] of Object.entries(porCli)) {
      const vs = vPor[cid];
      const ocultos = new Set(gs.map((g) => g.id));
      const asignados = ex.filter((h) => String(h.client_id) === cid && h.sale_id && !ocultos.has(h.id) && ventaDe[String(h.sale_id)]);
      const lineas: string[] = [];
      for (const g of gs) {
        const f = String(g.date).slice(0, 10);
        const her = asignados.filter((h) => h.date && dias(String(h.date).slice(0, 10), f) <= 20).slice(0, 8).map((h) => `${dmy(h.date)} · ${corto(h.concept, 70)}${h.entity_id ? ` (${nomRs[String(h.entity_id)] || ""})` : ""} → ${ventaDe[String(h.sale_id)].title}`);
        const dn = docsN.filter((d) => (d.expense_id && d.expense_id === g.id) || (g.ot_number && String(d.ot_number) === String(g.ot_number))).slice(0, 2).map((d) => corto(d.lectura?.resumen || d.lectura?.acto || d.asunto, 200));
        const mails = g.ot_number ? await correos(`"${g.ot_number}"`) : [];
        lineas.push(`GASTO ${g.id}\n- ${dmy(g.date)} · $${Math.round(Number(g.amount) || 0).toLocaleString("es-CL")} · ${corto(g.concept, 160)}${g.ot_number ? ` · OT ${g.ot_number}` : ""}${g.entity_id ? ` · razón social: ${nomRs[String(g.entity_id)] || ""}` : ""}${g.project ? ` · proyecto escrito a mano: «${corto(g.project, 60)}»` : ""}${g.created_by ? ` · cargado por ${g.created_by}` : ""}`
          + (dn.length ? `\n- Documento de la notaría: ${dn.join(" | ")}` : "")
          + (her.length ? `\n- Gastos del cliente ya asignados (±20 días):\n  ${her.join("\n  ")}` : "")
          + (mails.length ? `\n- Correos que nombran la OT:\n  ${mails.join("\n  ")}` : ""));
      }
      const tcli = tareas.filter((t) => String(t.client_id) === cid && t.project).slice(-12).map((t) => `${dmy(String(t.created_at).slice(0, 10))} · ${corto(t.title, 70)} → ${corto(t.project, 50)}`);
      const dcli = docsL.filter((d) => String(d.client_id) === cid).slice(-10).map((d) => `${dmy(d.fecha)} · ${corto(d.titulo, 90)}${Array.isArray(d.comparecientes) && d.comparecientes.length ? ` · ${d.comparecientes.slice(0, 3).map((c: any) => c?.nombre).filter(Boolean).join(", ")}` : ""}`);
      const prompt = `Eres asistente de un estudio de abogados chileno. Para cada gasto del cliente «${nomCli[cid] || ""}», indica a qué trabajo (venta) corresponde, usando SOLO la evidencia entregada.

TRABAJOS POSIBLES DEL CLIENTE (id · título · estado · creado):
${vs.map((s) => `${s.id} · ${s.title} · ${s.status} · ${dmy(String(s.activated_at || s.created_at || "").slice(0, 10))}`).join("\n")}
${tcli.length ? `\nTAREAS DEL CLIENTE CON PROYECTO:\n${tcli.join("\n")}` : ""}${dcli.length ? `\n\nDOCUMENTOS DEL CLIENTE LEÍDOS POR LA APP:\n${dcli.join("\n")}` : ""}

${lineas.join("\n\n")}

Reglas: elige un id de la lista o null. «alta» solo si una evidencia concreta liga ESTE gasto con ese trabajo (mismo trámite o sociedad que gastos ya asignados a ese trabajo en fechas cercanas, un documento o un correo que lo nombra). «media» si calza con el patrón del cliente pero sin prueba específica. Si dos trabajos son igual de plausibles, null. Un trabajo Terminado solo si el gasto es de su período. La evidencia es UNA línea en español formal, con la fuente (fecha del gasto hermano, asunto del correo o documento); sin nombres de personas.
Responde SOLO un arreglo JSON: [{"id":"<id del gasto>","sale_id":"<id o null>","confianza":"alta|media|baja","evidencia":"..."}]`;
      try {
        const res = await ia(prompt);
        for (const g of gs) {
          const x = res.find((r: any) => String(r?.id) === String(g.id));
          const ok = x && x.sale_id && vs.some((s) => String(s.id) === String(x.sale_id)) && ["alta", "media"].includes(String(x.confianza));
          propuestas.push({ id: g.id, cliente: nomCli[cid], fecha: g.date, monto: g.amount, concepto: corto(g.concept, 80), real: backtest ? g.sale_id : undefined,
            sale_id: ok ? String(x.sale_id) : null, trabajo: ok ? ventaDe[String(x.sale_id)]?.title : null, confianza: x?.confianza || null, evidencia: corto(x?.evidencia, 220) });
        }
      } catch (e) { errores.push(`${nomCli[cid] || cid}: ${(e as Error).message}`); }
    }

    if (!dryRun) {
      const filas = propuestas.filter((p) => p.sale_id).map((p) => ({ kind: "gasto_venta_ia", key: String(p.id), value: p.sale_id, meta: { confianza: p.confianza, evidencia: p.evidencia, fecha: new Date().toISOString().slice(0, 10) } }));
      if (filas.length) await fetch(`${SB_URL}/rest/v1/learnings`, { method: "POST", headers: H, body: JSON.stringify(filas) });
      if (filas.length) await fetch(`${SB_URL}/rest/v1/activity_log`, { method: "POST", headers: H, body: JSON.stringify({ user_email: "agente", action: "gastos.trabajo_ia", table_name: "learnings", estudio_id: "lea", detail: { title: `${filas.length} gasto${filas.length !== 1 ? "s" : ""} con trabajo propuesto por la revisión con IA (por confirmar en la ficha)`, n: filas.length } }) }).catch(() => null);
    }
    const res: any = { ok: true, dryRun, revisados: cand.length, propuestos: propuestas.filter((p) => p.sale_id).length, errores, propuestas };
    if (backtest) {
      const conP = propuestas.filter((p) => p.sale_id);
      const k = (p: any) => String(p.sale_id) === String(p.real);
      res.backtest = { n: propuestas.length, propone: conP.length, acierta: conP.filter(k).length, falla: conP.filter((p) => !k(p)).length,
        alta: { n: conP.filter((p) => p.confianza === "alta").length, acierta: conP.filter((p) => p.confianza === "alta" && k(p)).length },
        media: { n: conP.filter((p) => p.confianza === "media").length, acierta: conP.filter((p) => p.confianza === "media" && k(p)).length } };
    }
    return json(res);
  } catch (e) { return json({ error: String((e as Error).message || e) }, 500); }
});
