import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Barrido diario (Revisión de caja chica · Fase 2c): enlaza las cargas de caja chica de Martín/Martina SIN enlace
// con la transferencia del banco que calza (mismo RUT vía EQUIPO_RUT, monto EXACTO, ±3 días). Solo auto-enlaza el
// calce ÚNICO + EXACTO + en-ventana; lo ambiguo (fuera de ±3d o varios candidatos) queda para la compuerta in-app.
// Gate: corre de verdad solo si learnings config 'caja_chica_auto' = 'on'. Reversible con desmarcarInterno / desde la app.
const CRON_SECRET = Deno.env.get("CAJA_CHICA_SWEEP_SECRET") || Deno.env.get("CRON_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const EQUIPO_RUT: Record<string, string> = { "198897337": "Martín", "211389281": "Martina" };
const normRut = (s: string) => String(s || "").toUpperCase().replace(/[^0-9K]/g, "");
const nrm = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();   // robusto a tildes: "Martín"==="Martin"
const dayISO = (d: string) => String(d || "").slice(0, 10);
const diasEntre = (a: string, b: string) =>
  Math.round(Math.abs(new Date(dayISO(a) + "T00:00").getTime() - new Date(dayISO(b) + "T00:00").getTime()) / 86400000);

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
      if (!String(user?.email || "").toLowerCase().endsWith("@leabogados.cl"))
        return new Response(JSON.stringify({ error: "No autorizado" }), { status: 403, headers: { "Content-Type": "application/json" } });
      dry = true;
    }
    if (esCron && !dry) {
      const { data: cfg } = await sb.from("learnings").select("value").eq("kind", "config").eq("key", "caja_chica_auto").maybeSingle();
      if ((cfg?.value || "off").trim() !== "on")
        return new Response(JSON.stringify({ ok: true, skipped: "apagado" }), { headers: { "Content-Type": "application/json" } });
    }

    const [{ data: petty }, { data: movs }, { data: concil }] = await Promise.all([
      sb.from("petty_cash").select("id,user_name,amount,delivered_at,movimiento_id,notes"),
      sb.from("cartola_movimientos").select("id,tipo,monto,monto_conciliado,fecha,rut_contraparte,es_interno,categoria,estado").eq("tipo", "cargo"),
      sb.from("conciliacion").select("movimiento_id"),
    ]);
    const conciliados = new Set((concil || []).map((c: any) => String(c.movimiento_id)).filter(Boolean));
    const personas = new Set(Object.values(EQUIPO_RUT).map(nrm));
    const pcLibres = (petty || []).filter((p: any) =>
      !p.movimiento_id && (p.amount || 0) > 0 && personas.has(nrm(p.user_name)) && !String(p.notes || "").includes("mov:") && p.delivered_at);
    const cargos = (movs || []).filter((m: any) =>
      !m.es_interno && m.categoria !== "Caja chica" && !["conciliado", "parcial", "interno"].includes(String(m.estado || "")) &&
      !conciliados.has(String(m.id)) && EQUIPO_RUT[normRut(m.rut_contraparte)]);

    const usados = new Set<string>();
    const enlazadas: any[] = [];
    const ambiguas: any[] = [];
    const pcOrden = [...pcLibres].sort((a: any, b: any) => String(b.delivered_at).localeCompare(String(a.delivered_at)));
    for (const p of pcOrden) {
      const persona = p.user_name;
      const exactos = cargos.filter((m: any) =>
        !usados.has(String(m.id)) && nrm(EQUIPO_RUT[normRut(m.rut_contraparte)]) === nrm(persona) && Math.round(m.monto || 0) === Math.round(p.amount || 0));
      const enVent = exactos.filter((m: any) => diasEntre(m.fecha, p.delivered_at) <= 3);
      if (enVent.length === 1) {
        const c = enVent[0]; usados.add(String(c.id));
        enlazadas.push({ persona, monto: p.amount, carga: dayISO(p.delivered_at), transferencia: dayISO(c.fecha), pettyId: p.id, movId: c.id, notesPrev: p.notes || "" });
      } else if (exactos.length) {
        ambiguas.push({ persona, monto: p.amount, motivo: enVent.length > 1 ? "varias transferencias del mismo monto en ±3d" : "transferencia fuera de ±3d", n: exactos.length });
      }
    }

    if (!dry) {
      for (const e of enlazadas) {
        const movAplic = Math.round(e.monto);
        const nota = `${e.notesPrev} · mov:${e.movId}`.trim();
        try {
          await sb.from("petty_cash").update({ notes: nota, movimiento_id: e.movId }).eq("id", e.pettyId);
          await sb.from("cartola_movimientos").update({ estado: "conciliado", monto_conciliado: movAplic, categoria: "Caja chica" }).eq("id", e.movId);
          e.ok = true;
        } catch (err) { e.error = String((err as any).message); }
        delete e.notesPrev;
      }
    }
    return new Response(JSON.stringify({ ok: true, modo: dry ? "simulacion" : "barrido", nEnlazadas: enlazadas.length, nAmbiguas: ambiguas.length, enlazadas, ambiguas }),
      { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as any).message }), { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  }
});
