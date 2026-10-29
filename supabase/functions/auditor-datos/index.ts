// Edge Function: auditor-datos
// Auditor nocturno: corre cada noche las revisiones de la página «Revisión de datos» con las MISMAS funciones que la app
// (../_shared/saludDatos.js) y guarda cada caso en auditoria_hallazgos con una clave estable: nuevo → abierto; sigue → actualiza
// ultima_vez; ya no aparece → resuelto (con la fecha). Nunca corrige nada: el socio resuelve desde la página.
// Avisa por correo SOLO los casos nuevos (una vez por caso) a learnings config 'vigilancia_avisar_a', si learnings config
// 'auditor_datos' = 'on'. Sin 'on' registra igual los casos pero no envía. body.dryRun = calcula sin escribir ni enviar.
// Quedan solo en la app las revisiones que dependen de la UF del día (cuotas fantasma, cuotas sin generar, saldo a favor que cubre
// cuotas) y el cruce de RUT por nombre del banco.
// body.backtestVentaGasto = recorre los gastos que ya tienen trabajo y compara qué habría sugerido la regla de venta del gasto
// (sin escribir nada). Auth: CRON_SECRET. verify_jwt=false.

import { SMTPClient } from "../_shared/envios.ts";
import { todasRest } from "../_shared/paginar.js";
import { sugerirVentaGasto, VENTA_REAL } from "../_shared/ventaGastoReglas.js";
import { hallazgos, DETECTOR_LBL } from "../_shared/saludDatos.js";
import { trabajosDetenidos } from "../_shared/ventasReglas.js";
import { holaEquipo } from "../_shared/correoEquipo.js";

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const GMAIL_USER = Deno.env.get("GMAIL_USER") || "";
const GMAIL_PASS = Deno.env.get("GMAIL_PASS") || "";
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const fmt = (n: number) => (n < 0 ? "-$" : "$") + Math.abs(Math.round(n || 0)).toLocaleString("es-CL");
const toAscii = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[–—]/g, "-").replace(/[^\x20-\x7E]/g, "");
const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// deno-lint-ignore no-explicit-any
async function rest(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${path.split("?")[0]}: ${r.status} ${await r.text()}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
// Lecturas paginadas con orden estable (PostgREST corta en 1.000 filas). Una lectura que falla corta la corrida: con una tabla
// vacía por error, todos los casos abiertos se darían por resueltos.
// deno-lint-ignore no-explicit-any
// deno-lint-ignore no-explicit-any
const todas = (path: string): Promise<any[]> => todasRest(SB_URL, H, path);

Deno.serve(async (req) => {
  // deno-lint-ignore no-explicit-any
  let body: any = {}; try { body = await req.json(); } catch { /* sin body */ }
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!CRON_SECRET || (body.secret !== CRON_SECRET && bearer !== CRON_SECRET)) return json({ error: "No autorizado" }, 403);
  const dryRun = !!body.dryRun;
  if (body.backtestVentaGasto) {
    try {
      const [ex, sa, bi, le, cl] = await Promise.all([
        todas("expenses?select=id,client_id,sale_id,date,entity_id,concept,type,category&deleted_at=is.null&order=id"),
        todas("sales?select=id,client_id,status,deleted_at,title,entity_id,created_at,activated_at,updated_at&order=id"),
        todas("billing?select=sale_id,entity_id,deleted_at&sale_id=not.is.null&order=id"),
        todas("learnings?select=key,value,meta&kind=eq.gasto_proyecto&order=id"),
        todas("clients?select=id,is_internal&order=id"),
      ]);
      const interno = new Set(cl.filter((c) => c.is_internal).map((c) => String(c.id)));
      const vPor: Record<string, unknown[]> = {}; sa.filter(VENTA_REAL).forEach((s) => { (vPor[String(s.client_id)] = vPor[String(s.client_id)] || []).push(s); });
      const conV = ex.filter((e) => e.sale_id && !interno.has(String(e.client_id)) && (vPor[String(e.client_id)] || []).some((s: any) => String(s.id) === String(e.sale_id)));
      // deno-lint-ignore no-explicit-any
      const res: any = { total: conV.length, dudosos: 0, antes: { acierta: 0, falla: 0, nada: 0 }, ahora: { acierta: 0, falla: 0, nada: 0 }, porRegla: {}, fallas: [] };
      for (const e of conV) {
        const vs = vPor[String(e.client_id)] as any[];
        if (vs.length < 2 || vs.filter((s) => s.status === "Activo").length === 1) continue;   // única / única activa: igual que antes
        res.dudosos++;
        const otros = ex.filter((h) => h.id !== e.id && String(h.client_id) === String(e.client_id));
        const a0 = sugerirVentaGasto(e, vs, {}), a1 = sugerirVentaGasto(e, vs, { aprendidos: body.sinAprendido ? [] : le, hermanos: otros, billing: bi });
        const k = (r: any) => !r.venta ? "nada" : String(r.venta.id) === String(e.sale_id) ? "acierta" : "falla";
        res.antes[k(a0)]++; res.ahora[k(a1)]++;
        const pr = res.porRegla[a1.regla] = res.porRegla[a1.regla] || { acierta: 0, falla: 0, nada: 0 }; pr[k(a1)]++;
        if (k(a1) === "falla" && res.fallas.length < 25) res.fallas.push({ id: e.id, regla: a1.regla, concepto: String(e.concept || "").slice(0, 60), fecha: e.date });
      }
      return json(res);
    } catch (e) { return json({ error: String((e as Error).message || e) }, 500); }
  }
  try {
    const [billing, sales, anticipos, conciliacion, terceros, movs, pettyLinks, clientEntities, coRows, saludRows, clients, provs, previos, compras, comprasVistas, comprasObs, comprasObsVistas, gastosAct, tareasAct, horasAct, activosOk, ufRows, permisos, ctNoRows, pagosCli, comprasTodas, terminadaOkRows] = await Promise.all([
      todas("billing?select=id,client_id,sale_id,invoice_no,status,deleted_at,billing_type,receptor_rut,receptor_name,concept,amount,paid_amount,dte_xml,issued_at,due"),
      todas("sales?select=id,client_id,status,deleted_at,amount_uf,amount_clp,uf_value,year,month,cobro_type,cobro_config,area,title,moneda,created_at"),
      todas("anticipos?select=id,client_id,sale_id,monto,nota,estado"),
      todas("conciliacion?select=id,movimiento_id,tipo_destino,monto_aplicado,anticipo_id,factura_id"),
      todas("terceros_pagos?select=id,movimiento_id,estado,pagado_at,monto,proveedor_id,rut,factura_numero"),
      todas("cartola_movimientos?select=id,fecha,monto,tipo,nombre_contraparte,descripcion,estado,monto_conciliado,es_interno"),
      todas("petty_cash?select=id,movimiento_id,amount&movimiento_id=not.is.null"),
      todas("client_entities?select=id,client_id,rut,name"),
      todas("learnings?select=id,key,value,hits,updated_at&kind=eq.costo_oficina"),
      todas("v_ventas_salud?select=*&order=id.asc"),
      todas("clients?select=id,name"),
      todas("proveedores?select=id,nombre"),
      todas("auditoria_hallazgos?select=id,clave,estado,avisado_at&estado=eq.abierto"),
      todas("sii_compras_docs?select=id,folio,tipo_dte,emisor_name,emisor_rut,proveedor_id,fecha_emision,monto,sii_estado,fecha_recepcion&sii_estado=eq.PENDIENTE"),
      todas("learnings?select=id,key&kind=eq.compra_sin_reclamo"),
      todas("sii_compras_docs?select=id,folio,tipo_dte,emisor_name,emisor_rut,periodo,observado_iva,observado_sii&observado_sii=is.true"),
      todas("learnings?select=id,key&kind=eq.compra_observada_vista"),
      todas("expenses?select=id,client_id,date,entity_id,sale_id,created_at,amount,concept&deleted_at=is.null&order=id"),
      todas("tasks?select=client_id,created_at,completed_at"),
      todas("horas?select=client_id,fecha"),
      todas("learnings?select=key,value&kind=eq.trabajo_activo_ok"),
      todas("indicadores?select=fecha,valor&codigo=eq.uf&order=fecha.asc"),
      todas("rpc/auditoria_permisos"),
      todas("learnings?select=key,value&kind=eq.data_health&key=like.cuotatramo:*"),
      todas("cartola_movimientos?select=cliente_id,fecha&tipo=eq.abono&cliente_id=not.is.null"),
      todas("sii_compras_docs?select=id,emisor_rut,fecha_emision,monto"),
      todas("learnings?select=key,value&kind=eq.terminada_gastos_ok"),   // permisos de la base fuera de la regla (tablas o funciones abiertas sin sesión)
    ]);
    const hoyCL = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
    const ufMap: Record<string, number> = Object.fromEntries(ufRows.map((r: { fecha: string; valor: number }) => [String(r.fecha).slice(0, 10), Number(r.valor) || 0]));
    const detenidos = trabajosDetenidos({ pagos: pagosCli.map((m: { cliente_id: string; fecha: string }) => ({ client_id: m.cliente_id, fecha: m.fecha })), sales, billing, uf: ufMap, expenses: gastosAct, tasks: tareasAct, horas: horasAct, hoy: hoyCL, decididos: Object.fromEntries(activosOk.map((r: { key: string; value: string }) => [String(r.key), String(r.value || '')])) });
    const nomCli: Record<string, string> = Object.fromEntries(clients.map((c) => [String(c.id), c.name]));
    const nomProv: Record<string, string> = Object.fromEntries(provs.map((p) => [String(p.id), p.nombre]));
    const cuotaTramoNo = new Set(ctNoRows.filter((r: { value: string }) => String(r.value) === "distintos").map((r: { key: string }) => String(r.key).replace(/^cuotatramo:/, "")));
    const casos = hallazgos({ gastos: gastosAct, terminadaOk: Object.fromEntries(terminadaOkRows.map((r: { key: string; value: string }) => [String(r.key), String(r.value || "")])), comprasTodas, cuotaTramoNo, permisos, compras, comprasVistas: new Set(comprasVistas.map((r: { key: string }) => String(r.key))), comprasObs, comprasObsVistas: new Set(comprasObsVistas.map((r: { key: string }) => String(r.key))), detenidos, hoy: new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" }), billing, sales, anticipos, conciliacion, terceros: terceros.map((t) => ({ ...t, proveedor: nomProv[String(t.proveedor_id)] || null })), movs, pettyLinks, clientEntities, coRows, saludRows, clientName: (id: string) => nomCli[String(id)] || "—" });
    const vistos = new Set(casos.map((c) => c.clave));
    const abiertos = new Map(previos.map((p) => [p.clave, p]));
    const nuevos = casos.filter((c) => !abiertos.has(c.clave));
    const resueltos = previos.filter((p) => !vistos.has(p.clave));
    const porDetector: Record<string, number> = {}; casos.forEach((c) => { porDetector[c.detector] = (porDetector[c.detector] || 0) + 1; });
    const ahora = new Date().toISOString();
    if (!dryRun) {
      // Un caso que vuelve a aparecer después de resuelto se reabre (misma clave) y cuenta como nuevo.
      for (let i = 0; i < casos.length; i += 200) {
        const lote = casos.slice(i, i + 200).map((c) => ({ estudio_id: "lea", detector: c.detector, clave: c.clave, titulo: c.titulo, monto: c.monto, prueba: c.prueba, estado: "abierto", ultima_vez: ahora, resuelto_at: null, ...(abiertos.has(c.clave) ? {} : { primera_vez: ahora, avisado_at: null }) }));
        const conPrimera = lote.filter((x) => "primera_vez" in x), sin = lote.filter((x) => !("primera_vez" in x));
        for (const grupo of [conPrimera, sin]) if (grupo.length) await rest("auditoria_hallazgos?on_conflict=estudio_id,clave", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(grupo) });
      }
      for (const p of resueltos) await rest(`auditoria_hallazgos?id=eq.${p.id}`, { method: "PATCH", body: JSON.stringify({ estado: "resuelto", resuelto_at: ahora }) });
      if (nuevos.length || resueltos.length) await rest("activity_log", { method: "POST", body: JSON.stringify({ user_email: "auditor-datos", action: "auditoria.revision_nocturna", table_name: "auditoria_hallazgos", estudio_id: "lea", detail: { title: `Revisión de datos: ${casos.length} por revisar · ${nuevos.length} nuevo${nuevos.length !== 1 ? "s" : ""} · ${resueltos.length} resuelto${resueltos.length !== 1 ? "s" : ""}`, nuevos: nuevos.map((c) => c.clave), resueltos: resueltos.map((p) => p.clave) } }) }).catch(() => null);
    }
    const resumen = { ok: true, dryRun, por_revisar: casos.length, nuevos: nuevos.length, resueltos: resueltos.length, por_detector: porDetector, detalle_nuevos: nuevos.map((c) => ({ detector: c.detector, titulo: c.titulo, monto: c.monto })) };

    // Aviso por correo: solo lo nuevo, una vez por caso.
    const porAvisar = dryRun ? [] : nuevos;
    if (!porAvisar.length) return json({ ...resumen, enviado: false });
    const cfg = await rest("learnings?kind=eq.config&key=in.(auditor_datos,vigilancia_avisar_a)&select=key,value");
    const encendido = String(cfg.find((c: { key: string }) => c.key === "auditor_datos")?.value || "").toLowerCase() === "on";
    const dom = String(GMAIL_USER || "").toLowerCase().split("@")[1] || "";
    const para = String(cfg.find((c: { key: string }) => c.key === "vigilancia_avisar_a")?.value || "").split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter((e) => e && dom && e.endsWith("@" + dom));
    if (!encendido || !para.length) return json({ ...resumen, enviado: false, motivo: !encendido ? "apagado" : "sin destinatarios" });
    // Agrupado por tipo de caso: encabezado con la cantidad y filas cortas (cliente · trabajo arriba, el dato abajo, monto solo si hay).
    const grupos = new Map<string, typeof porAvisar>();
    for (const c of porAvisar) { const k = c.detector; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k)!.push(c); }
    const filas = [...grupos.entries()].map(([det, cs]) => {
      const head = `<tr><td colspan="2" style="padding:16px 0 6px;font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#003C50">${esc(DETECTOR_LBL[det] || det)} &middot; ${cs.length}</td></tr>`;
      const rows = cs.slice(0, 8).map((c) => { const t = String(c.titulo || ""), dias = t.match(/hace (\d+) días/), partes = t.split(" · ");
        // Trabajos: «Cliente · Trabajo» y abajo los días; el resto, el título tal cual (la categoría ya va en el encabezado).
        const quien = dias && partes.length > 1 ? partes.slice(1).join(" · ") : t.replace(/^(Subarriendo de [^·]+?) pagado sin factura/, "$1").replace(/^Cuotas programadas que superan la venta · /, "").replace(/^Glosa con más de una categoría aprendida · /, "");
        const dato = dias ? `${dias[1]} días sin movimiento` : "";
        return `<tr><td style="padding:8px 0;border-top:1px solid #E4E8EB"><div style="font-size:13px;color:#3D3D3D;font-weight:600">${esc(quien)}</div>${dato ? `<div style="font-size:12px;color:#537281;margin-top:2px">${esc(dato)}</div>` : ""}</td><td style="padding:8px 0 8px 10px;border-top:1px solid #E4E8EB;font-size:13px;color:#003C50;font-weight:700;text-align:right;white-space:nowrap;vertical-align:top">${Number(c.monto) > 0 ? fmt(c.monto) : ""}</td></tr>`; }).join("");
      const mas = cs.length > 8 ? `<tr><td colspan="2" style="padding:6px 0;font-size:12px;color:#537281">y ${cs.length - 8} más</td></tr>` : "";
      return head + rows + mas;
    }).join("");
    const mm = await rest("miembros?select=email,nombre").catch(() => []);
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,Helvetica,sans-serif;background:#f0f2f4;margin:0;padding:20px"><div style="max-width:680px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #e4e8eb;padding:20px"><p style="font-size:14px;color:#3D3D3D;margin:0 0 12px">${esc(holaEquipo(para, mm))}:</p><p style="font-size:14px;color:#3D3D3D;margin:0 0 14px">La revisión de datos de anoche encontró ${porAvisar.length === 1 ? "un caso nuevo" : `${porAvisar.length} casos nuevos`} por revisar:</p><table style="width:100%;border-collapse:collapse">${filas}</table><p style="margin:18px 0 0"><a href="https://gestion.leabogados.cl/?ir=revision" style="display:inline-block;background:#003C50;color:#fff;font-size:13px;font-weight:700;text-decoration:none;border-radius:9px;padding:9px 16px">Abrir Revisión de datos</a></p></div></body></html>`;
    const asunto = porAvisar.length === 1 ? "Revision de datos: 1 caso nuevo" : `Revision de datos: ${porAvisar.length} casos nuevos`;
    const client = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: GMAIL_USER, password: GMAIL_PASS } } });
    await client.send({ from: `Oficina <${GMAIL_USER}>`, to: para, subject: asunto, content: porAvisar.map((c) => toAscii(c.titulo)).join("\n"), html: html.replace(/[ \t]+$/gm, "") });
    await client.close();
    // El aviso ya salió: si guardar la marca falla, se informa sin error (el caso no se vuelve a avisar porque ya no es nuevo).
    try { await rest(`auditoria_hallazgos?estudio_id=eq.lea&clave=in.(${porAvisar.map((c) => `"${c.clave.replace(/"/g, "")}"`).join(",")})`, { method: "PATCH", body: JSON.stringify({ avisado_at: ahora }) }); } catch (e) { (resumen as Record<string, unknown>).error_guardar = String((e as Error).message || e); }
    await rest("activity_log", { method: "POST", body: JSON.stringify({ user_email: "auditor-datos", action: "auditoria.aviso_enviado", table_name: "auditoria_hallazgos", estudio_id: "lea", detail: { title: asunto, para, casos: porAvisar.length } }) }).catch(() => null);
    return json({ ...resumen, enviado: true, para });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
