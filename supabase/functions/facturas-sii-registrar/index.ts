// Edge Function: facturas-sii-registrar
// Registra SOLAS las facturas emitidas en el SII que aún no están en la app (sii_cargas_docs 'sin_registrar', las deja el
// cuadre diario del RCV), con las MISMAS reglas que «Cargadas sin registrar» de la app (../_shared/facturacionReglas.js):
//   · el folio ya existe en Facturación → se une a esa factura;
//   · el RUT da el cliente y hay UNA cuota que calza (o varias de la misma serie: la más antigua) → la cuota pasa a factura;
//   · sin cuota que calce y con UNA sola venta activa (que no es subarriendo) → se crea la factura en esa venta;
//   · sin venta clara (varias ventas activas, o ninguna) → se crea AL CLIENTE, sin venta, y la Bandeja propone «Asignar la venta»
//     (con las cuotas que reemplazaría, si 2–3 de una venta suman su monto; esas quedan fuera de la proyección mientras tanto).
// Lo que la app resuelve con reglas extra (comisión por facturar, cuota anticipada, cuota que habría que retirar) y lo ambiguo
// (RUT sin cliente, cuotas de ventas distintas) queda en la Bandeja del agente → «Abrir en Facturación». Bitácora de todo.
// Body: {secret, dryRun?}. Auth: CRON_SECRET. verify_jwt=false. Lo llama el cron diario (después del cuadre del RCV).
import { candidatasProgramadas, decidirRegistroSII, ultimoDiaHabilMesEmision, serieYaFacturadaEnMes } from "../_shared/facturacionReglas.js";

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const dmy = (iso: string) => { const [y, m, d] = String(iso).slice(0, 10).split("-"); return `${d}-${m}-${y}`; };
const fmt = (n: number) => "$" + Math.round(n || 0).toLocaleString("es-CL");
const nRut = (r: string) => String(r || "").toUpperCase().replace(/[^0-9K]/g, "");
const folioN = (no: string) => String(no || "").replace(/^factura\s*/i, "").trim();
// deno-lint-ignore no-explicit-any
async function rest(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${path.split("?")[0]}: ${r.status} ${await r.text()}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
// deno-lint-ignore no-explicit-any
async function todas(path: string): Promise<any[]> {
  // deno-lint-ignore no-explicit-any
  const out: any[] = []; for (let i = 0; i < 50; i++) { const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: { ...H, Range: `${i * 1000}-${i * 1000 + 999}` } }); if (!r.ok) throw new Error(`${path.split("?")[0]}: ${r.status}`); const p = await r.json(); out.push(...p); if (p.length < 1000) break; } return out;
}
// Cuotas que una factura sin venta cubre PROVISORIAMENTE: learnings cuota_no_emitir con value «cubierta:<factura>» (la misma
// marca que excluye una cuota de la proyección de caja y del radar de cuotas sin facturar). Se liberan al aceptar/rechazar/cerrar.
async function liberarCuotas(cuotas: string[] | undefined, billingId: string) {
  for (const id of cuotas || []) await rest(`learnings?kind=eq.cuota_no_emitir&key=eq.${id}&value=eq.${encodeURIComponent(`cubierta:${billingId}`)}`, { method: "DELETE" }).catch(() => null);
}
// Feriados de Chile (mismas fuentes que la app); sin respuesta, solo fines de semana.
async function feriados(anios: number[]) {
  const s = new Set<string>();
  for (const y of anios) for (const url of [`https://api.boostr.cl/feriados/${y}.json`, `https://apis.digital.gob.cl/fl/feriados/${y}`]) {
    try { const r = await fetch(url); if (!r.ok) continue; const j = await r.json(); const arr = Array.isArray(j) ? j : (j.data || j.feriados || []); if (!Array.isArray(arr) || !arr.length) continue; arr.forEach((f: { fecha?: string; date?: string } | string) => { const v = typeof f === "string" ? f : (f.fecha || f.date); if (v) s.add(String(v).slice(0, 10)); }); break; } catch { /* siguiente fuente */ }
  }
  return (dt: Date) => { const w = dt.getDay(); if (w === 0 || w === 6) return false; return !s.has(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`); };
}

Deno.serve(async (req) => {
  // deno-lint-ignore no-explicit-any
  let body: any = {}; try { body = await req.json(); } catch { /* sin body */ }
  if (!CRON_SECRET || body.secret !== CRON_SECRET) return json({ error: "No autorizado" }, 403);
  const dryRun = !!body.dryRun;
  try {
    const docs = (await todas("sii_cargas_docs?select=id,folio,tipo_dte,fecha_emision,receptor_rut,receptor_name,monto,glosa,client_id,estado,billing_id&billing_id=is.null&estado=in.(sin_registrar,)")).filter((d) => [33, 34].includes(Number(d.tipo_dte)));
    const out = { registradas: [] as unknown[], a_bandeja: [] as unknown[], cerradas: 0 };
    const [clients, ents, sales, abiertas] = await Promise.all([
      todas("clients?select=id,name,rut"), todas("client_entities?select=id,client_id,rut,name"),
      todas("sales?select=id,client_id,title,status,area,cobro_config,deleted_at&deleted_at=is.null&status=eq.Activo"),
      todas("agente_bandeja?select=id,gmail_id,estado&tipo=eq.factura_sin_registrar&estado=eq.pendiente"),
    ]);
    // Propuestas abiertas cuya factura ya se registró (en la app o aquí) → se cierran solas.
    const pendFolios = new Set(docs.map((d) => `sii:${d.folio}-${d.tipo_dte}`));
    for (const r of abiertas) if (!pendFolios.has(r.gmail_id)) {
      const [, folio, tipo] = String(r.gmail_id).match(/^sii:(.+)-(\d+)$/) || [];
      const doc = folio ? (await rest(`sii_cargas_docs?select=billing_id,estado&folio=eq.${encodeURIComponent(folio)}&tipo_dte=eq.${tipo}&limit=1`))?.[0] : null;
      out.cerradas++; if (!dryRun) await rest(`agente_bandeja?id=eq.${r.id}`, { method: "PATCH", body: JSON.stringify({ estado: doc?.billing_id ? "registrado" : "resuelto", motivo: doc?.billing_id ? "Factura registrada en Facturación" : "Ya no está por registrar", resuelto_at: new Date().toISOString() }) });
    }
    // «Asignar la venta» (facturas registradas sin venta): se cierra sola cuando la factura ya tiene venta, o ya no existe/está anulada.
    // Al cerrar se liberan las cuotas marcadas como cubiertas provisoriamente por esa factura (vuelven a la proyección y al radar).
    const sinVenta = await todas("agente_bandeja?select=id,propuesta&tipo=eq.factura_sin_venta&estado=eq.pendiente");
    for (const r of sinVenta) {
      const bid = r.propuesta?.billing_id; if (!bid) continue;
      const f = (await rest(`billing?select=id,sale_id,deleted_at,status&id=eq.${bid}`))?.[0];
      const conVenta = f && !f.deleted_at && f.status !== "Anulada" && f.sale_id;
      if (f && !f.deleted_at && f.status !== "Anulada" && !f.sale_id) continue;
      out.cerradas++; if (dryRun) continue;
      await liberarCuotas(r.propuesta?.cuotas, bid);
      await rest(`agente_bandeja?id=eq.${r.id}`, { method: "PATCH", body: JSON.stringify({ estado: conVenta ? "registrado" : "resuelto", motivo: conVenta ? "Venta asignada en Facturación" : "La factura ya no está vigente", resuelto_at: new Date().toISOString() }) });
    }
    if (!docs.length) return json({ ok: true, dryRun, ...out });
    const esHabil = await feriados([...new Set(docs.map((d) => Number(String(d.fecha_emision).slice(0, 4))).concat(docs.map((d) => Number(String(d.fecha_emision).slice(0, 4)) + 1)))]);
    const esSub = (s: { cobro_config?: { subarriendo?: boolean }; area?: string }) => s?.cobro_config?.subarriendo === true || (s?.area || "") === "Subarriendo";
    const cliDe = (rut: string) => { const k = nRut(rut); if (!k) return null; const e = ents.find((x) => nRut(x.rut) === k); if (e) return { cid: e.client_id, ent: e.id }; const c = clients.find((x) => nRut(x.rut) === k); return c ? { cid: c.id, ent: null } : null; };
    // RUT con el formato de la app (78.457.999-9): el SII lo trae sin puntos y el UNIQUE de client_entities compara el texto tal cual.
    const rutApp = (r: string) => { const c = nRut(r); return c.length < 2 ? r : c.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "-" + c.slice(-1); };
    const usadas = new Set<string>();
    const bandeja = async (d: any, motivo: string, cid: string | null) => {
      out.a_bandeja.push({ folio: d.folio, monto: d.monto, motivo });
      if (dryRun) return;
      await rest("agente_bandeja?on_conflict=gmail_id", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates" }, body: JSON.stringify({ gmail_id: `sii:${d.folio}-${d.tipo_dte}`, recibido_at: `${String(d.fecha_emision).slice(0, 10)}T12:00:00Z`, de: d.receptor_name || "", de_nombre: d.receptor_name || "", asunto: `Factura N° ${d.folio} emitida en el SII`, tipo: "factura_sin_registrar", cliente_id: cid, estado: "pendiente", motivo, propuesta: { accion: "registrar_factura", titulo: `Registrar la factura N° ${d.folio}`, folio: d.folio }, evidencia: [{ texto: `Factura N° ${d.folio} del ${dmy(d.fecha_emision)} · ${d.receptor_name || ""}`, monto: Number(d.monto), fuente: "SII" }] }) });
    };
    for (const d of docs) { try {
      const monto = Math.round(Number(d.monto) || 0), fecha = String(d.fecha_emision).slice(0, 10), now = new Date().toISOString();
      const conFolio = (await rest(`billing?select=id,invoice_no,receptor_rut&invoice_no=in.(${encodeURIComponent(`"${d.folio}","Factura ${d.folio}"`)})&deleted_at=is.null`) || []).filter((b: { invoice_no: string }) => folioN(b.invoice_no) === String(d.folio));
      const ya = conFolio.filter((b: { receptor_rut: string }) => !b.receptor_rut || !d.receptor_rut || nRut(b.receptor_rut) === nRut(d.receptor_rut));
      if (!ya.length && conFolio.length) { await bandeja(d, "El folio ya está en Facturación con otro RUT", null); continue; }
      if (ya.length) { out.registradas.push({ folio: d.folio, como: "ya estaba en Facturación" }); if (!dryRun) await rest(`sii_cargas_docs?id=eq.${d.id}`, { method: "PATCH", body: JSON.stringify({ estado: "registrada", billing_id: ya[0].id, updated_at: now }) }); continue; }
      // El RUT manda (y da la razón social); si el documento ya traía un cliente distinto del que da el RUT, lo decide una persona.
      const porRut = cliDe(d.receptor_rut);
      if (d.client_id && porRut && porRut.cid !== d.client_id) { await bandeja(d, "El RUT es de otro cliente que el asignado al documento", d.client_id); continue; }
      const cli = porRut || (d.client_id ? { cid: d.client_id, ent: null } : null);
      if (!cli) { await bandeja(d, "El RUT del receptor no está en la app", null); continue; }
      const billingCli = await todas(`billing?select=id,client_id,sale_id,concept,amount,status,due,issued_at,invoice_no,billing_type,deleted_at,prepaid_anticipo_id,paid_at&client_id=eq.${cli.cid}&deleted_at=is.null&invoice_no=is.null`);
      const facturadasCli = await todas(`billing?select=id,sale_id,invoice_no,issued_at,status,deleted_at&client_id=eq.${cli.cid}&deleted_at=is.null&invoice_no=not.is.null`);
      const cands = candidatasProgramadas(billingCli, cli.cid, monto, fecha, d.glosa || "").filter((c: { id: string }) => !usadas.has(c.id));
      const activas = sales.filter((s) => s.client_id === cli.cid && !esSub(s));
      const dec = decidirRegistroSII(cands, activas);
      const due = ultimoDiaHabilMesEmision(fecha, esHabil);
      const nombre = clients.find((c) => c.id === cli.cid)?.name || d.receptor_name;
      // Crea la factura en Facturación (con su venta, o sin venta) y deja la bitácora. Devuelve su id (null en dryRun).
      const crearFactura = async (saleId: string | null): Promise<string | null> => {
        let ent = cli.ent;
        if (!ent && d.receptor_rut && !dryRun) { const ne = await rest("client_entities", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ client_id: cli.cid, rut: rutApp(d.receptor_rut), name: d.receptor_name || null }) }).catch(() => null); ent = ne?.[0]?.id || null; }
        const venta = saleId ? sales.find((s) => s.id === saleId) : null;
        out.registradas.push({ folio: d.folio, cliente: nombre, monto, como: venta ? `nueva en la venta «${venta.title}»` : "nueva, sin venta", due });
        if (dryRun) return null;
        const ins = await rest("billing", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ client_id: cli.cid, entity_id: ent, concept: d.glosa || "Honorarios", receptor_name: d.receptor_name || null, receptor_rut: d.receptor_rut || null, amount: monto, status: "Pendiente", invoice_no: String(d.folio), issued_at: fecha, due, billing_type: "honorarios", sii_tipo_dte: Number(d.tipo_dte), sii_synced_at: now, ...(saleId ? { sale_id: saleId } : {}) }) });
        await rest(`sii_cargas_docs?id=eq.${d.id}`, { method: "PATCH", body: JSON.stringify({ estado: "registrada", billing_id: ins[0].id, updated_at: now }) });
        await rest("activity_log", { method: "POST", body: JSON.stringify({ user_email: "agente", action: "facturacion.registrada_auto", table_name: "billing", record_id: ins[0].id, estudio_id: "lea", detail: JSON.stringify({ title: `Factura N° ${d.folio} registrada sola: ${nombre} ${fmt(monto)}${venta ? ` · ${venta.title}` : " · sin venta"}`, folio: d.folio }) }) });
        return ins[0].id;
      };
      if (dec.tipo === "manual") { await bandeja(d, dec.motivo, cli.cid); continue; }
      if (dec.tipo === "prog") {
        const p = dec.prog;
        // Comisión por facturar y cuota anticipada tienen reglas propias en la app (monto del depósito, fecha del anticipo).
        const mismoMes = serieYaFacturadaEnMes(facturadasCli, p.sale_id, fecha, d.folio);
        if (mismoMes) { await bandeja(d, `Su venta ya tiene la factura N° ${String(mismoMes.invoice_no).replace(/^factura\s*/i, "")} emitida este mes: puede ser un mes atrasado o adelantado`, cli.cid); continue; }
        if (p.billing_type === "comision" || p.status === "Anticipada") { await bandeja(d, p.billing_type === "comision" ? "Calza con una comisión por facturar" : "Calza con una cuota ya pagada por adelantado", cli.cid); continue; }
        usadas.add(p.id);
        out.registradas.push({ folio: d.folio, cliente: nombre, monto, como: `cuota «${p.concept}»`, due });
        if (dryRun) continue;
        await rest(`billing?id=eq.${p.id}`, { method: "PATCH", body: JSON.stringify({ invoice_no: String(d.folio), status: "Pendiente", issued_at: fecha, due, sii_tipo_dte: Number(d.tipo_dte), sii_synced_at: now, updated_at: now, amount: monto }) });
        await rest(`sii_cargas_docs?id=eq.${d.id}`, { method: "PATCH", body: JSON.stringify({ estado: "registrada", billing_id: p.id, updated_at: now }) });
        await rest("activity_log", { method: "POST", body: JSON.stringify({ user_email: "agente", action: "facturacion.registrada_auto", table_name: "billing", record_id: p.id, estudio_id: "lea", detail: JSON.stringify({ title: `Factura N° ${d.folio} registrada sola: ${nombre} ${fmt(monto)} → cuota «${p.concept}»`, folio: d.folio, antes: { status: p.status, due: p.due, amount: p.amount, concept: p.concept } }) }) });
        continue;
      }
      // Nueva sin venta clara (el cliente tiene varias ventas activas, o ninguna): se registra AL CLIENTE, sin venta (entra a Por
      // cobrar, cobranza, conciliación y trae su XML), y una persona asigna la venta desde la Bandeja. Si 2–3 cuotas programadas
      // de una misma venta suman el monto (±1%), se proponen para reemplazar con un clic y, mientras tanto, quedan fuera de la
      // proyección de caja y del radar (cubiertas provisoriamente) para no contar dos veces la misma plata.
      if (!dec.saleId) {
        const progs = billingCli.filter((b: { status: string; billing_type: string }) => b.status === "Programada" && b.billing_type !== "reembolso");
        let pista: { sv: { id: string; title: string }; ids: string[]; n: number; sum: number } | null = null;
        for (const sv of activas) { const xs = progs.filter((b: { sale_id: string; id: string }) => b.sale_id === sv.id && !usadas.has(b.id)).sort((a: { due: string }, b: { due: string }) => String(a.due || "").localeCompare(String(b.due || "")));
          for (const n of [2, 3]) { const sum = xs.slice(0, n).reduce((t: number, b: { amount: number }) => t + (Number(b.amount) || 0), 0); if (xs.length >= n && monto > 0 && Math.abs(sum - monto) / monto <= 0.01) { pista = { sv, ids: xs.slice(0, n).map((b: { id: string }) => b.id), n, sum }; break; } }
          if (pista) break; }
        const bid = await crearFactura(null);
        if (pista) pista.ids.forEach((id) => usadas.add(id));
        const dif = pista ? Math.abs(Math.round(pista.sum) - monto) : 0;
        const motivo = pista ? (dif ? `Diferencia ${fmt(dif)}` : "Mismo monto") : activas.length ? `${activas.length} ventas activas: elegir la venta` : "El cliente no tiene ventas activas";
        out.a_bandeja.push({ folio: d.folio, monto: d.monto, motivo: pista ? `Registrada sin venta · reemplaza ${pista.n} cuotas de «${pista.sv.title}» · ${motivo}` : `Registrada sin venta · ${motivo}` });
        if (dryRun || !bid) continue;
        if (pista) for (const id of pista.ids) await rest("learnings", { method: "POST", body: JSON.stringify({ kind: "cuota_no_emitir", key: id, value: `cubierta:${bid}`, meta: { folio: d.folio, origen: "facturas-sii-registrar" }, created_by: "agente", estudio_id: "lea" }) });
        await rest("agente_bandeja?on_conflict=gmail_id", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates" }, body: JSON.stringify({ gmail_id: `venta:${d.folio}-${d.tipo_dte}`, recibido_at: `${fecha}T12:00:00Z`, de: d.receptor_name || "", de_nombre: d.receptor_name || "", asunto: `Factura N° ${d.folio} registrada sin venta`, tipo: "factura_sin_venta", cliente_id: cli.cid, estado: "pendiente", motivo,
          propuesta: pista ? { accion: "asignar_venta", titulo: `Asignar a «${pista.sv.title}»`, folio: d.folio, billing_id: bid, sale_id: pista.sv.id, venta: pista.sv.title, cuotas: pista.ids } : { accion: "asignar_venta", titulo: `Asignar la venta de la factura N° ${d.folio}`, folio: d.folio, billing_id: bid },
          evidencia: [{ texto: `Factura N° ${d.folio} del ${dmy(fecha)}`, monto, fuente: "SII" }, ...(pista ? [{ texto: `${pista.n} cuotas programadas`, monto: Math.round(pista.sum), fuente: "App" }] : [])] }) });
        // La propuesta anterior («Registrar la factura») queda cerrada: ya está registrada.
        await rest(`agente_bandeja?gmail_id=eq.${encodeURIComponent(`sii:${d.folio}-${d.tipo_dte}`)}&estado=eq.pendiente`, { method: "PATCH", body: JSON.stringify({ estado: "registrado", motivo: "Registrada al cliente, sin venta", resuelto_at: now }) });
        continue;
      }
      // Nueva: si al asociarla a su venta habría que retirar una cuota programada de esa venta, lo hace la app (mueve sus comisiones).
      if (dec.saleId && billingCli.some((b: { status: string; sale_id: string; amount: number }) => b.status === "Programada" && b.sale_id === dec.saleId && monto > 0 && Math.abs((Number(b.amount) || 0) - monto) / monto <= 0.06)) { await bandeja(d, "Reemplaza una cuota de su venta (hay que retirarla)", cli.cid); continue; }
      await crearFactura(dec.saleId);
    } catch (e) { (out as any).errores = [...((out as any).errores || []), { folio: d.folio, error: String((e as Error).message || e) }]; } }   // un documento con error no corta la corrida
    return json({ ok: true, dryRun, ...out });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
