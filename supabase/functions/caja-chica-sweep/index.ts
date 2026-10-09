import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

// Barrido diario de caja chica (espejo de calceCajaChica en App.jsx — misma regla, mantener ambas iguales):
// 1) ENLAZA SOLO: caja registrada por un miembro ↔ transferencia a su RUT con el MISMO MONTO, hecha el MISMO DÍA de la caja o el
//    ANTERIOR (regla del usuario 2026-10-09). Si hay varias iguales se aparean en orden (son equivalentes). Excepción: si el monto es
//    igual a un sueldo/bono ya conciliado a esa persona, no se enlaza solo (queda "por confirmar" en la app).
// 2) AVISA AL MIEMBRO por correo (una vez por transferencia) de lo que le transfirieron y aún no registra como caja: registrar · ya la
//    registré · no es caja chica (todo se responde en la app). Excluye lo conciliado, lo marcado "no es caja" y los montos de su sueldo.
// Personas = `miembros` con RUT que no son socios (tenant-aware). Gate: learnings config 'caja_chica_auto' = 'on'. dryRun = simula.
const CRON_SECRET = Deno.env.get("CAJA_CHICA_SWEEP_SECRET") || Deno.env.get("CRON_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const GMAIL_USER = Deno.env.get("GMAIL_USER") || "";
const GMAIL_PASS = Deno.env.get("GMAIL_PASS") || "";
const APP_URL = Deno.env.get("APP_URL") || "https://gestion.leabogados.cl";
const EQUIPO_FALLBACK = [{ nombre: "Martín", rut: "19.889.733-7", email: "mc@leabogados.cl" }, { nombre: "Martina", rut: "21.138.928-1", email: "mp@leabogados.cl" }];

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
const normRut = (s: string) => String(s || "").toUpperCase().replace(/[^0-9K]/g, "");
const nrm = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const dia = (d: string) => String(d || "").slice(0, 10);
const dias = (a: string, b: string) => Math.round((new Date(dia(a) + "T00:00").getTime() - new Date(dia(b) + "T00:00").getTime()) / 86400000);   // a − b
// Glosa BICE: "... el 22-09-2026 a las 13:21:33" = fecha REAL de la transferencia (el movimiento puede contabilizarse al día siguiente).
const glosaFecha = (d: string) => { const f = String(d || "").match(/\bel (\d{2})-(\d{2})-(\d{4})/); return f ? `${f[3]}-${f[2]}-${f[1]}` : null; };
const fechas = (m: any) => [...new Set([dia(m.fecha), glosaFecha(m.descripcion)].filter(Boolean))] as string[];
const fechaReal = (m: any) => glosaFecha(m.descripcion) || dia(m.fecha);
const monto = (x: any) => Math.round(Math.abs(Number(x?.amount ?? x?.monto) || 0));
const clp = (n: number) => "$" + Math.round(Math.abs(n || 0)).toLocaleString("es-CL");
const fmtD = (d: string) => dia(d).split("-").reverse().join("-");
const toAscii = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[–—]/g, "-").replace(/[^\x20-\x7E]/g, "");
const qpSafe = (h: string) => String(h || "").replace(/[ \t]+$/gm, "");
const esc = (s: string) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" } });
  try {
    const body = await req.json().catch(() => ({}));
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const esCron = !!CRON_SECRET && body.secret === CRON_SECRET;
    let dry = !esCron || !!body.dryRun;
    if (!esCron) {
      const auth = req.headers.get("authorization") || "";
      const { data: { user } } = await sb.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
      if (!String(user?.email || "").toLowerCase().endsWith("@leabogados.cl")) return json({ error: "No autorizado" }, 403);
      dry = true;
    }
    if (esCron && !dry) {
      const { data: cfg } = await sb.from("learnings").select("value").eq("kind", "config").eq("key", "caja_chica_auto").maybeSingle();
      if ((cfg?.value || "off").trim() !== "on") return json({ ok: true, skipped: "apagado" });
    }
    const testTo = typeof body.testTo === "string" && body.testTo.includes("@") ? body.testTo : null;
    const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
    const desde = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);

    const [{ data: estudio }, { data: miembros }, { data: petty }, { data: movs }, { data: concil }, { data: noCaja }, { data: avisados }] = await Promise.all([
      sb.from("estudios").select("nombre,dominio").limit(1).maybeSingle(),
      sb.from("miembros").select("nombre,rut,email,es_socio"),
      sb.from("petty_cash").select("id,user_name,amount,delivered_at,movimiento_id,notes"),
      sb.from("cartola_movimientos").select("id,tipo,monto,monto_conciliado,fecha,rut_contraparte,es_interno,categoria,estado,descripcion").eq("tipo", "cargo").gte("fecha", desde),
      sb.from("conciliacion").select("movimiento_id"),
      sb.from("learnings").select("key").eq("kind", "cc_no_caja"),
      sb.from("learnings").select("key").eq("kind", "cc_aviso_transf"),
    ]);
    const nombreEstudio = estudio?.nombre || "Liberona Escala Abogados";
    const dominio = String(estudio?.dominio || "leabogados.cl").toLowerCase().replace(/^.*?@/, "").replace(/^gestion\./, "");
    // Equipo (no socios con RUT) desde miembros; un correo por persona (el del dominio del estudio, el más corto).
    const equipoM: Record<string, { nombre: string; rut: string; emails: string[] }> = {};
    for (const m of miembros || []) {
      if (m.es_socio || !normRut(m.rut) || !m.nombre) continue;
      const k = normRut(m.rut); const e = equipoM[k] || (equipoM[k] = { nombre: String(m.nombre).split(" ")[0], rut: m.rut, emails: [] });
      if (String(m.email || "").includes("@")) e.emails.push(String(m.email).toLowerCase());
    }
    const equipo = Object.keys(equipoM).length ? Object.values(equipoM) : EQUIPO_FALLBACK.map((x) => ({ nombre: x.nombre, rut: x.rut, emails: [x.email] }));
    const porRut: Record<string, any> = {}; equipo.forEach((e) => { porRut[normRut(e.rut)] = e; });
    const quien = (m: any) => porRut[normRut(m.rut_contraparte)];
    const conciliados = new Set((concil || []).map((c: any) => String(c.movimiento_id)).filter(Boolean));
    const ligados = new Set((petty || []).map((p: any) => p.movimiento_id).filter(Boolean).map(String));
    const sinCaja = new Set((noCaja || []).map((r: any) => String(r.key)));
    const yaAvisado = new Set((avisados || []).map((r: any) => String(r.key)));
    const sueldos: Record<string, Set<number>> = {};
    for (const m of movs || []) { const q = quien(m); if (q && conciliados.has(String(m.id))) (sueldos[nrm(q.nombre)] = sueldos[nrm(q.nombre)] || new Set()).add(monto(m)); }

    const nombres = new Set(equipo.map((e) => nrm(e.nombre)));
    const cajas = (petty || []).filter((p: any) => !p.movimiento_id && monto(p) > 0 && p.delivered_at && nombres.has(nrm(p.user_name)) && !String(p.notes || "").includes("mov:"))
      .sort((a: any, b: any) => dia(a.delivered_at).localeCompare(dia(b.delivered_at)));
    const cargos = (movs || []).filter((m: any) => !m.es_interno && quien(m) && !ligados.has(String(m.id)) && !conciliados.has(String(m.id)) && !sinCaja.has(String(m.id)) &&
      !["conciliado", "parcial", "interno"].includes(String(m.estado || ""))).sort((a: any, b: any) => dia(a.fecha).localeCompare(dia(b.fecha)));

    const usados = new Set<string>(); const enlazadas: any[] = [];
    for (const p of cajas) {
      const c = cargos.find((m: any) => !usados.has(String(m.id)) && nrm(quien(m).nombre) === nrm(p.user_name) && monto(m) === monto(p) && fechas(m).some((f) => [0, -1].includes(dias(f, p.delivered_at))));
      if (!c || sueldos[nrm(p.user_name)]?.has(monto(c))) continue;
      usados.add(String(c.id));
      enlazadas.push({ persona: p.user_name, monto: monto(p), caja: dia(p.delivered_at), transferencia: fechaReal(c), pettyId: p.id, movId: c.id, notesPrev: p.notes || "" });
    }
    // Avisos: transferencias de los últimos 30 días, con al menos 1 día (le damos el día para registrarla), sin caja, no sueldo, no avisadas.
    const avisos: Record<string, any[]> = {};
    for (const m of cargos) {
      if (usados.has(String(m.id)) || yaAvisado.has(String(m.id))) continue;
      const d = dias(hoy, fechaReal(m)); const q = quien(m);
      if (d < 1 || d > 30 || sueldos[nrm(q.nombre)]?.has(monto(m))) continue;
      (avisos[normRut(q.rut)] = avisos[normRut(q.rut)] || []).push(m);
    }

    const correos: any[] = [];
    if (!dry) {
      for (const e of enlazadas) {
        try {
          await sb.from("petty_cash").update({ notes: `${e.notesPrev} · mov:${e.movId}`.trim(), movimiento_id: e.movId }).eq("id", e.pettyId);
          await sb.from("cartola_movimientos").update({ estado: "conciliado", monto_conciliado: e.monto, categoria: "Caja chica" }).eq("id", e.movId);
          e.ok = true;
        } catch (err) { e.error = String((err as any).message); }
      }
      if (GMAIL_USER && GMAIL_PASS) {
        for (const [rk, lista] of Object.entries(avisos)) {
          const per = porRut[rk]; const doms = per.emails.filter((x: string) => x.endsWith("@" + dominio));
          const to = testTo || (doms.length ? doms : per.emails).sort((a: string, b: string) => a.length - b.length)[0];
          if (!to) continue;
          const filas = lista.map((m: any) => `<tr><td style="padding:9px 0;border-top:1px solid #E4E8EB;font-size:13px;color:#3D3D3D">Transferencia del ${fmtD(fechaReal(m))}</td><td style="padding:9px 0;border-top:1px solid #E4E8EB;text-align:right;font-size:14px;font-weight:bold;color:#003C50;white-space:nowrap">${clp(monto(m))}</td></tr>`).join("");
          const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,Helvetica,sans-serif;background:#f0f2f4;margin:0;padding:20px"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e4e8eb"><div style="background:#003C50;padding:20px 28px;text-align:center"><img src="${APP_URL}/le-logo-blanco.png" alt="${esc(nombreEstudio)}" height="28" width="184" style="height:28px;width:184px;display:inline-block;border:0"/></div><div style="padding:28px"><div style="font-size:16px;color:#1a1a1a;margin:0 0 6px">Hola ${esc(per.nombre)},</div><div style="font-size:14px;color:#666666;margin:0 0 14px">${lista.length === 1 ? "Te transfirieron este monto y no aparece" : "Te transfirieron estos montos y no aparecen"} como caja chica en la app.</div><table style="width:100%;border-collapse:collapse">${filas}</table><div style="font-size:13px;color:#666666;margin:16px 0 0;line-height:1.5">En tu caja chica de la app puedes: <b>registrarla</b> si es caja chica, <b>asociarla</b> a una caja que ya registraste, o marcar <b>no es caja chica</b>.</div><div style="margin-top:20px"><a href="${APP_URL}/?ir=cajachica" style="display:inline-block;background:#003C50;color:#fff;text-decoration:none;padding:9px 18px;border-radius:18px;font-size:12px;font-weight:bold">Ir a mi caja chica &rarr;</a></div></div><div style="padding:16px 28px;border-top:1px solid #eeeeee"><div style="font-size:11px;color:#999999">${esc(nombreEstudio)} &middot; aviso automático de caja chica</div></div></div></body></html>`;
          const asunto = lista.length === 1 ? `Caja chica: registra la transferencia del ${fmtD(fechaReal(lista[0]))} por ${clp(monto(lista[0]))}` : `Caja chica: ${lista.length} transferencias por registrar`;
          try {
            const client = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: GMAIL_USER, password: GMAIL_PASS } } });
            await client.send({ from: `${toAscii(nombreEstudio)} <${GMAIL_USER}>`, to, subject: toAscii(asunto), content: "Ver el contenido en formato HTML.", html: qpSafe(html) });
            await client.close();
            if (!testTo) for (const m of lista) await sb.from("learnings").insert({ kind: "cc_aviso_transf", key: String(m.id), value: hoy });
            correos.push({ to, n: lista.length });
          } catch (e) { correos.push({ to, error: String((e as Error).message || e) }); }
        }
      }
    }
    enlazadas.forEach((e) => delete e.notesPrev);
    const resumenAvisos = Object.entries(avisos).map(([rk, l]) => ({ persona: porRut[rk].nombre, transferencias: l.map((m: any) => ({ fecha: fechaReal(m), monto: monto(m) })) }));
    return json({ ok: true, modo: dry ? "simulacion" : "barrido", nEnlazadas: enlazadas.length, enlazadas, avisos: resumenAvisos, correos });
  } catch (err) {
    return json({ error: (err as any).message }, 500);
  }
});
