// Edge Function: comisiones-documentos
// Agente «Comisiones por pagar» (parte documentos): cada noche deja en la Bandeja del agente (agente_bandeja, tipo
// boleta_honorarios) lo que hay que pedir o definir a los colaboradores, con la regla única documentosPorPedir
// (../_shared/comisionesReglas.js): comisión ya pagada por el banco sin boleta ni factura. Una fila por colaborador y conjunto
// de comisiones (gmail_id estable «doc:<tipo>:<proveedor>:<comisiones>»: nunca se duplica). Si la boleta o la factura llega,
// la fila pendiente se cierra sola. Nada se envía desde aquí: el pedido sale desde la Bandeja, con tu aprobación.
// Auth: CRON_SECRET. verify_jwt=false. body.dryRun = calcula sin escribir.

import { documentosPorPedir, tasaBHE } from "../_shared/comisionesReglas.js";

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const fmt = (n: number) => "$" + Math.round(n || 0).toLocaleString("es-CL");
const dmy = (d: string) => { const m = String(d || "").slice(0, 10).match(/^(\d{4})-(\d\d)-(\d\d)$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : ""; };

// deno-lint-ignore no-explicit-any
async function rest(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${path.split("?")[0]}: ${r.status} ${await r.text()}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}

Deno.serve(async (req) => {
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* cron */ }
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!CRON_SECRET || (body.secret !== CRON_SECRET && bearer !== CRON_SECRET)) return json({ error: "No autorizado" }, 403);
  const dry = !!body.dryRun;
  try {
    const [terceros, proveedores, abiertas, mails, sinDoc] = await Promise.all([
      rest("terceros_pagos?select=id,proveedor,rut,monto,liquido,retencion,estado,pagado_at,movimiento_id,bhe_id,factura_numero,comision_pct,billing_id,sale_id,proveedor_id&estado=eq.pagado&comision_pct=is.null&limit=5000"),
      rest("proveedores?select=id,razon_social,nombre,rut,documento&limit=2000"),
      rest("agente_bandeja?select=id,gmail_id,estado,propuesta&tipo=eq.boleta_honorarios&gmail_id=like.doc:*&limit=1000"),
      rest("learnings?select=key,value&kind=eq.proveedor_email"),
      rest("learnings?select=key&kind=eq.proveedor_sin_documento"),
    ]);
    const items = documentosPorPedir({ terceros, proveedores, sinDocumento: new Set((sinDoc || []).map((r: { key: string }) => String(r.key))) });
    const bIds = [...new Set(items.map((x) => x.t.billing_id).filter(Boolean))], sIds = [...new Set(items.map((x) => x.t.sale_id).filter(Boolean))];
    const [bills, sales, concs] = await Promise.all([
      bIds.length ? rest(`billing?select=id,invoice_no,paid_at&id=in.(${bIds.join(",")})`) : [],
      sIds.length ? rest(`sales?select=id,title,client_id&id=in.(${sIds.join(",")})`) : [],
      bIds.length ? rest(`conciliacion?select=factura_id,movimiento_id&tipo_destino=eq.factura&factura_id=in.(${bIds.join(",")})`) : [],
    ]);
    const movIds = [...new Set((concs || []).map((c: { movimiento_id: string }) => c.movimiento_id).filter(Boolean))];
    const movs = movIds.length ? await rest(`cartola_movimientos?select=id,fecha&id=in.(${movIds.join(",")})`) : [];
    const fMov: Record<string, string> = {}; (movs || []).forEach((m: { id: string; fecha: string }) => { fMov[m.id] = m.fecha; });
    // Pago del cliente = fecha del depósito conciliado a la factura (caja), no paid_at.
    const pagoCli = (bid: string) => (concs || []).filter((c: { factura_id: string }) => String(c.factura_id) === String(bid)).map((c: { movimiento_id: string }) => fMov[c.movimiento_id]).filter(Boolean).sort()[0] || null;
    const mailDe: Record<string, string> = {}; (mails || []).forEach((m: { key: string; value: string }) => { mailDe[m.key] = m.value; });
    // Agrupa por colaborador y tipo.
    // deno-lint-ignore no-explicit-any
    const grupos: Record<string, any> = {};
    for (const x of items) { const k = `${x.tipo}:${x.t.proveedor_id}`; (grupos[k] = grupos[k] || { tipo: x.tipo, p: x.p, xs: [] }).xs.push(x); }
    const filas = Object.values(grupos).map((g) => {
      // deno-lint-ignore no-explicit-any
      const lineas = g.xs.map((x: any) => { const b = (bills || []).find((y: { id: string }) => String(y.id) === String(x.t.billing_id)); const s = (sales || []).find((y: { id: string }) => String(y.id) === String(x.t.sale_id));
        return { tercero_id: x.t.id, trabajo: s?.title || null, factura: b?.invoice_no ? String(b.invoice_no).replace(/\D/g, "") : null, pago_cliente: x.t.billing_id ? pagoCli(x.t.billing_id) : null, pagado_at: x.t.pagado_at, bruto: x.bruto ?? (Number(x.t.monto) || 0), retencion: x.retencion ?? null, liquido: x.liquido ?? (Number(x.t.monto) || 0) }; });
      const ids = lineas.map((l: { tercero_id: string }) => l.tercero_id).sort();
      const nombre = g.p?.razon_social || g.p?.nombre || g.xs[0].t.proveedor || "Colaborador";
      const tot = (k: string) => lineas.reduce((a: number, l: Record<string, number>) => a + (Number(l[k]) || 0), 0);
      const pedir = g.tipo === "pedir_boleta";
      return {
        gmail_id: `doc:${g.tipo}:${g.p?.id || "x"}:${ids.map((i: string) => i.slice(0, 8)).join("-")}`,
        recibido_at: new Date().toISOString(), de: (g.p?.rut || g.xs[0].t.rut) ? `RUT ${g.p?.rut || g.xs[0].t.rut}` : nombre, de_nombre: nombre, tipo: "boleta_honorarios", estado: "pendiente",
        asunto: pedir ? `Boleta de honorarios por pedir · ${nombre}` : `Documento por definir · ${nombre}`,
        motivo: pedir ? `${lineas.length === 1 ? "Comisión pagada" : `${lineas.length} comisiones pagadas`} sin boleta` : "Comisión pagada sin boleta ni factura · ¿boleta o factura?",
        propuesta: { accion: pedir ? "pedir_boleta" : "definir_documento", titulo: pedir ? "Pedir la boleta de honorarios" : "Definir el documento de la comisión", proveedor_id: g.p?.id || null, nombre, rut: g.p?.rut || g.xs[0].t.rut || null, para: (g.p?.id && mailDe[g.p.id]) || null, lineas, tasa: pedir ? tasaBHE(lineas[0].pagado_at) : null },
        evidencia: pedir
          ? [...lineas.map((l: Record<string, unknown>) => ({ texto: `Transferido el ${dmy(String(l.pagado_at))}${l.factura ? ` · Factura N° ${l.factura}` : ""}`, monto: l.liquido })), { texto: "Retención", monto: tot("retencion") }, { texto: "Bruto de la boleta", monto: tot("bruto") }]
          : lineas.map((l: Record<string, unknown>) => ({ texto: `Transferido el ${dmy(String(l.pagado_at))}${l.factura ? ` · Factura N° ${l.factura}` : ""}`, monto: l.liquido })),
      };
    });
    const vigentes = new Set(filas.map((f) => f.gmail_id));
    // deno-lint-ignore no-explicit-any
    const cerrar = (abiertas || []).filter((a: any) => a.estado === "pendiente" && !vigentes.has(a.gmail_id));
    const ya = new Set((abiertas || []).map((a: { gmail_id: string }) => a.gmail_id));
    const nuevas = filas.filter((f) => !ya.has(f.gmail_id));
    if (!dry) {
      if (nuevas.length) await rest("agente_bandeja", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(nuevas.map((f) => ({ ...f, estudio_id: "lea" }))) });
      for (const a of cerrar) await rest(`agente_bandeja?id=eq.${a.id}&estado=eq.pendiente`, { method: "PATCH", body: JSON.stringify({ estado: "resuelto", motivo: "El documento llegó o la comisión cambió", resuelto_por: "agente", resuelto_at: new Date().toISOString() }) });
    }
    return json({ ok: true, dryRun: dry, por_pedir: filas.filter((f) => f.propuesta.accion === "pedir_boleta").length, por_definir: filas.filter((f) => f.propuesta.accion === "definir_documento").length, nuevas: nuevas.length, cerradas: cerrar.length, detalle: filas.map((f) => ({ asunto: f.asunto, total: f.propuesta.lineas.reduce((a: number, l: { liquido: number }) => a + l.liquido, 0) })) });
  } catch (e) { return json({ error: String((e as Error).message || e) }, 500); }
});
