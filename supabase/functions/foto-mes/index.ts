// Edge Function: foto-mes
// El día 1 de cada mes guarda la «foto» de la cartera por cobrar, las comisiones por pagar y los gastos por cobrar a clientes
// (regla única _shared/fotoMes.js, las mismas cifras que muestran Inicio, Cobranza y el Panel de socios). Queda en learnings
// kind foto_mes, key = mes que cierra (AAAA-MM), con su fecha real de captura. El Informe del mes compara las dos últimas fotos.
// Una foto por mes: si ya existe no se reescribe (la cartera de otro día no es la del cierre), salvo body.forzar.
// body.per = 'AAAA-MM' (otro mes), body.forzar = reescribe, body.dryRun = no guarda. Auth: CRON_SECRET (body.secret o Bearer). verify_jwt=false.

import { construirFoto } from "../_shared/fotoMes.js";
import { todasRest } from "../_shared/paginar.js";

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const ymMas = (ym: string, n: number) => { const d = new Date(`${ym}-01T12:00:00`); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 7); };
const hoyCL = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());

// deno-lint-ignore no-explicit-any
async function rest(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${path.split("?")[0]}: ${r.status} ${await r.text()}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}

Deno.serve(async (req) => {
  // deno-lint-ignore no-explicit-any
  let body: any = {}; try { body = await req.json(); } catch { /* sin body */ }
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!CRON_SECRET || (body.secret !== CRON_SECRET && bearer !== CRON_SECRET)) return json({ error: "No autorizado" }, 403);
  try {
    const hoy = hoyCL(), dryRun = !!body.dryRun, forzar = !!body.forzar;
    const per = /^\d{4}-\d{2}$/.test(String(body.per || "")) ? String(body.per) : ymMas(hoy.slice(0, 7), -1);
    const ya = (await rest(`learnings?kind=eq.foto_mes&key=eq.${per}&select=value`).catch(() => []))?.[0];
    if (ya && !forzar) return json({ ok: true, omitido: `la foto de ${per} ya existe`, previa: JSON.parse(ya.value) });

    const [billing, conciliacion, anticipos, terceros, expenses, clients] = await Promise.all([
      todasRest(SB_URL, H, "billing?select=id,client_id,invoice_no,status,amount,paid_amount,dte_xml,issued_at,due,billing_type,deleted_at&deleted_at=is.null"),
      todasRest(SB_URL, H, "conciliacion?select=id,tipo_destino,factura_id,anticipo_id,monto_aplicado&tipo_destino=in.(factura,anticipo)"),
      todasRest(SB_URL, H, "anticipos?select=id,estado,billing_id,monto"),
      todasRest(SB_URL, H, "terceros_pagos?select=id,billing_id,proveedor_id,monto,estado"),
      todasRest(SB_URL, H, "expenses?select=id,client_id,type,amount,no_descuenta_saldo,apertura_id&deleted_at=is.null"),
      todasRest(SB_URL, H, "clients?select=id,is_internal"),
    ]);
    const foto = construirFoto({ per, capturada: hoy, billing, conciliacion, anticipos, terceros, expenses, clients });
    if (!dryRun) {
      await (ya ? rest(`learnings?kind=eq.foto_mes&key=eq.${per}`, { method: "PATCH", body: JSON.stringify({ value: JSON.stringify(foto) }) })
        : rest("learnings", { method: "POST", body: JSON.stringify({ kind: "foto_mes", key: per, value: JSON.stringify(foto) }) }));
    }
    return json({ ok: true, dryRun, foto, filas: { billing: billing.length, conciliacion: conciliacion.length, terceros: terceros.length, expenses: expenses.length, clients: clients.length } });
  } catch (err) {
    return json({ error: String((err as Error).message || err) }, 500);
  }
});
