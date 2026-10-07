import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

// Aviso diario de caja chica (cron 13:10): por cada persona con caja, saldo = entregado (petty_cash) − gastado (expenses tipo gasto,
// sin paid_by_client) — la MISMA fórmula que saldoCajaChica en la app. Dos umbrales: 'negativo' (saldo < 0: puso plata de su bolsillo,
// la oficina le debe) y 'baja' (saldo ≤ estudios.caja_chica_umbral, default 50.000). Historial en caja_chica_alertas: una alerta
// ABIERTA por (persona, tipo); se cierra sola cuando el saldo se recupera (queda el registro). Correo a los admins (miembros rol admin)
// UNA sola vez por apertura, no cada día. dryRun / sin secret = simula (no escribe ni envía).
const CRON_SECRET = Deno.env.get("CAJA_CHICA_ALERTA_SECRET") || Deno.env.get("CRON_SECRET") || Deno.env.get("ALERTA_CARTOLA_SECRET") || Deno.env.get("CAJA_CHICA_SWEEP_SECRET") || "";
const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const GMAIL_USER = Deno.env.get("GMAIL_USER") || "";
const GMAIL_PASS = Deno.env.get("GMAIL_PASS") || "";
const APP_URL = Deno.env.get("APP_URL") || "https://gestion.leabogados.cl";

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
const toAscii = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[–—]/g, "-").replace(/[^\x20-\x7E]/g, "");
const qpSafe = (h: string) => String(h || "").replace(/[ \t]+$/gm, "");
const clp = (n: number) => "$" + Math.round(Math.abs(n || 0)).toLocaleString("es-CL");
const esc = (s: string) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" } });
  try {
    const body = await req.json().catch(() => ({}));
    const sb = createClient(SB_URL, SB_KEY);
    const esCron = !!CRON_SECRET && body.secret === CRON_SECRET;
    let dry = !esCron || !!body.dryRun;
    if (!esCron) {
      const auth = req.headers.get("authorization") || "";
      const { data: { user } } = await sb.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
      if (!user?.email) return json({ error: "No autorizado" }, 403);
      dry = true;
    }
    const testTo = typeof body.testTo === "string" && body.testTo.includes("@") ? body.testTo : null;

    const [{ data: estudio }, { data: petty }, { data: gastos }, { data: abiertas }, { data: admins }] = await Promise.all([
      sb.from("estudios").select("id,nombre,caja_chica_umbral,dominio").limit(1).maybeSingle(),
      sb.from("petty_cash").select("user_name,amount,delivered_at"),
      sb.from("expenses").select("created_by,amount,type,paid_by_client").eq("type", "gasto").is("deleted_at", null),
      sb.from("caja_chica_alertas").select("id,user_name,tipo,saldo").eq("estado", "abierta"),
      sb.from("miembros").select("email,rol,nombre").eq("rol", "admin"),
    ]);
    const umbral = Number(estudio?.caja_chica_umbral ?? 50000) || 50000;
    const nombreEstudio = estudio?.nombre || "Liberona Escala Abogados";
    const estudioId = estudio?.id || "lea";
    // Admins del estudio, UNA dirección por persona (miembros trae alias: cl@ y cristobal.liberona@ y un gmail): por nombre, la más corta del dominio del estudio.
    const dominio = String(estudio?.dominio || "leabogados.cl").toLowerCase().replace(/^.*?@/, "").replace(/^gestion\./, "");
    const porPersona: Record<string, string[]> = {};
    for (const a of admins || []) { const em = String(a.email || "").toLowerCase(); if (!em.includes("@")) continue; const k = String(a.nombre || em).split(" ")[0].toLowerCase(); (porPersona[k] = porPersona[k] || []).push(em); }
    const destinatarios = Object.values(porPersona).map((ems) => { const dom = ems.filter((e) => e.endsWith("@" + dominio)); return (dom.length ? dom : ems).sort((x, y) => x.length - y.length)[0]; });

    // Saldo por persona (fuente única = saldoCajaChica de la app)
    const entregado: Record<string, number> = {}; const gastado: Record<string, number> = {}; const ultimaCaja: Record<string, string> = {};
    for (const p of petty || []) { if (!p.user_name) continue; entregado[p.user_name] = (entregado[p.user_name] || 0) + (p.amount || 0); if (p.delivered_at && (!ultimaCaja[p.user_name] || p.delivered_at > ultimaCaja[p.user_name])) ultimaCaja[p.user_name] = p.delivered_at; }
    for (const g of gastos || []) { if (!g.created_by || g.paid_by_client) continue; gastado[g.created_by] = (gastado[g.created_by] || 0) + (g.amount || 0); }
    const personas = Object.keys(entregado);
    const estado = personas.map((persona) => { const saldo = (entregado[persona] || 0) - (gastado[persona] || 0); return { persona, saldo, tipo: saldo < 0 ? "negativo" : saldo <= umbral ? "baja" : null }; });

    const nuevas: any[] = []; const cerradas: any[] = []; const vigentes: any[] = [];
    for (const e of estado) {
      const abiertasP = (abiertas || []).filter((a: any) => a.user_name === e.persona);
      for (const a of abiertasP) if (a.tipo !== e.tipo) cerradas.push({ id: a.id, persona: e.persona, tipo: a.tipo, saldo_cierre: e.saldo });
      if (e.tipo) { if (abiertasP.some((a: any) => a.tipo === e.tipo)) vigentes.push(e); else nuevas.push(e); }
    }
    // Personas que ya no tienen caja registrada pero sí alerta abierta → cerrar
    for (const a of abiertas || []) if (!personas.includes(a.user_name)) cerradas.push({ id: a.id, persona: a.user_name, tipo: a.tipo, saldo_cierre: null });

    let enviado = false; let correoA: string[] = [];
    if (!dry) {
      const now = new Date().toISOString();
      for (const c of cerradas) await sb.from("caja_chica_alertas").update({ estado: "cerrada", cerrada_at: now, saldo_cierre: c.saldo_cierre }).eq("id", c.id);
      const inserted: any[] = [];
      for (const n of nuevas) {
        const { data } = await sb.from("caja_chica_alertas").insert({ estudio_id: estudioId, user_name: n.persona, tipo: n.tipo, saldo: Math.round(n.saldo), umbral, estado: "abierta" }).select().single();
        if (data) inserted.push(data);
      }
      if (nuevas.length && (destinatarios.length || testTo) && GMAIL_USER && GMAIL_PASS) {
        correoA = testTo ? [testTo] : destinatarios;
        const filas = nuevas.map((n) => {
          const neg = n.tipo === "negativo";
          return `<tr><td style="padding:10px 0;border-top:1px solid #E4E8EB;vertical-align:top"><div style="font-size:14px;font-weight:bold;color:#3D3D3D">${esc(n.persona)}</div><div style="font-size:12px;color:${neg ? "#A32D2D" : "#854F0B"};margin-top:2px">${neg ? `Caja chica en negativo — la oficina le debe ${clp(-n.saldo)}` : `Caja chica baja — quedan ${clp(n.saldo)} (aviso al bajar de ${clp(umbral)})`}</div><div style="font-size:11px;color:#99ABB4;margin-top:2px">Última caja ${ultimaCaja[n.persona] ? ultimaCaja[n.persona].split("-").reverse().join("-") : "—"} · entregado ${clp(entregado[n.persona] || 0)} · gastado ${clp(gastado[n.persona] || 0)}</div></td><td style="padding:10px 0;border-top:1px solid #E4E8EB;text-align:right;white-space:nowrap;font-size:15px;font-weight:bold;color:${neg ? "#A32D2D" : "#3D3D3D"}">${neg ? "-" : ""}${clp(n.saldo)}</td></tr>`;
        }).join("");
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,Helvetica,sans-serif;background:#f0f2f4;margin:0;padding:20px"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e4e8eb"><div style="background:#003C50;padding:20px 28px;text-align:center"><img src="${APP_URL}/le-logo-blanco.png" alt="${esc(nombreEstudio)}" height="28" width="184" style="height:28px;width:184px;display:inline-block;border:0"/></div><div style="padding:28px"><div style="font-size:16px;color:#1a1a1a;margin:0 0 6px">Hola,</div><div style="font-size:14px;color:#666666;margin:0 0 14px">${nuevas.length === 1 ? "Un miembro del equipo" : `${nuevas.length} miembros del equipo`} ${nuevas.length === 1 ? "necesita" : "necesitan"} caja chica.</div><table style="width:100%;border-collapse:collapse">${filas}</table><div style="margin-top:22px"><a href="${APP_URL}" style="display:inline-block;background:#003C50;color:#fff;text-decoration:none;padding:9px 18px;border-radius:18px;font-size:12px;font-weight:bold">Entregar caja en la app &rarr;</a></div></div><div style="padding:16px 28px;border-top:1px solid #eeeeee"><div style="font-size:11px;color:#999999">${esc(nombreEstudio)} &middot; aviso automático de caja chica</div></div></div></body></html>`;
        const asunto = nuevas.length === 1 ? `Caja chica ${nuevas[0].tipo === "negativo" ? "en negativo" : "baja"} · ${nuevas[0].persona} ${nuevas[0].tipo === "negativo" ? "-" : ""}${clp(nuevas[0].saldo)}` : `Caja chica: ${nuevas.length} avisos`;
        try {
          const client = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: GMAIL_USER, password: GMAIL_PASS } } });
          await client.send({ from: `${toAscii(nombreEstudio)} <${GMAIL_USER}>`, to: correoA.join(", "), subject: toAscii(asunto), content: "Ver el contenido en formato HTML.", html: qpSafe(html) });
          await client.close();
          enviado = true;
          for (const r of inserted) await sb.from("caja_chica_alertas").update({ correo_enviado_a: correoA, correo_enviado_at: now }).eq("id", r.id);
        } catch (e) { return json({ ok: false, error: "SMTP: " + String((e as Error).message || e), nuevas, cerradas }, 500); }
      }
    }
    return json({ ok: true, modo: dry ? "simulacion" : "barrido", umbral, destinatarios, estado, nuevas, vigentes, cerradas, enviado, correoA });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
