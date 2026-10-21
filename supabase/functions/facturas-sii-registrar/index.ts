// Edge Function: facturas-sii-registrar
// Registra SOLAS las facturas emitidas en el SII que aún no están en la app (sii_cargas_docs 'sin_registrar', las deja el
// cuadre diario del RCV), con las MISMAS reglas que «Cargadas sin registrar» de la app (../_shared/facturacionReglas.js):
//   · el folio ya existe en Facturación → se une a esa factura;
//   · el RUT da el cliente y hay UNA cuota que calza (o varias de la misma serie: la más antigua) → la cuota pasa a factura;
//   · sin cuota que calce y con UNA sola venta activa (que no es subarriendo) → se crea la factura en esa venta.
// Lo que la app resuelve con reglas extra (comisión por facturar, cuota anticipada, cuota que habría que retirar) y lo ambiguo
// (RUT sin cliente, cuotas de ventas distintas, sin venta clara) queda en la Bandeja del agente → «Abrir en Facturación». Bitácora de todo.
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
      // Nueva sin venta clara (el cliente tiene varias ventas activas, o ninguna): la app la crearía igual «sin venta», pero puede
      // cubrir cuotas ya programadas (p. ej. dos cuotas juntas) que quedarían por facturar → una persona elige. Pista: la combinación
      // de 2–3 cuotas de una misma venta que suman el monto (±1%).
      if (!dec.saleId) {
        const progs = billingCli.filter((b: { status: string; billing_type: string }) => b.status === "Programada" && b.billing_type !== "reembolso");
        let pista = "";
        for (const sv of activas) { const xs = progs.filter((b: { sale_id: string }) => b.sale_id === sv.id).sort((a: { due: string }, b: { due: string }) => String(a.due || "").localeCompare(String(b.due || "")));
          for (const n of [2, 3]) { const sum = xs.slice(0, n).reduce((t: number, b: { amount: number }) => t + (Number(b.amount) || 0), 0); if (xs.length >= n && monto > 0 && Math.abs(sum - monto) / monto <= 0.01) { pista = ` · puede cubrir ${n} cuotas de «${sv.title}» (${fmt(sum)})`; break; } }
          if (pista) break; }
        await bandeja(d, (activas.length ? `${activas.length} ventas activas: elegir la venta` : "El cliente no tiene ventas activas") + pista, cli.cid); continue;
      }
      // Nueva: si al asociarla a su venta habría que retirar una cuota programada de esa venta, lo hace la app (mueve sus comisiones).
      if (dec.saleId && billingCli.some((b: { status: string; sale_id: string; amount: number }) => b.status === "Programada" && b.sale_id === dec.saleId && monto > 0 && Math.abs((Number(b.amount) || 0) - monto) / monto <= 0.06)) { await bandeja(d, "Reemplaza una cuota de su venta (hay que retirarla)", cli.cid); continue; }
      let ent = cli.ent;
      if (!ent && d.receptor_rut && !dryRun) { const ne = await rest("client_entities", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ client_id: cli.cid, rut: rutApp(d.receptor_rut), name: d.receptor_name || null }) }).catch(() => null); ent = ne?.[0]?.id || null; }
      const venta = dec.saleId ? sales.find((s) => s.id === dec.saleId) : null;
      out.registradas.push({ folio: d.folio, cliente: nombre, monto, como: venta ? `nueva en la venta «${venta.title}»` : "nueva, sin venta", due });
      if (dryRun) continue;
      const ins = await rest("billing", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ client_id: cli.cid, entity_id: ent, concept: d.glosa || "Honorarios", receptor_name: d.receptor_name || null, receptor_rut: d.receptor_rut || null, amount: monto, status: "Pendiente", invoice_no: String(d.folio), issued_at: fecha, due, billing_type: "honorarios", sii_tipo_dte: Number(d.tipo_dte), sii_synced_at: now, ...(dec.saleId ? { sale_id: dec.saleId } : {}) }) });
      await rest(`sii_cargas_docs?id=eq.${d.id}`, { method: "PATCH", body: JSON.stringify({ estado: "registrada", billing_id: ins[0].id, updated_at: now }) });
      await rest("activity_log", { method: "POST", body: JSON.stringify({ user_email: "agente", action: "facturacion.registrada_auto", table_name: "billing", record_id: ins[0].id, estudio_id: "lea", detail: JSON.stringify({ title: `Factura N° ${d.folio} registrada sola: ${nombre} ${fmt(monto)}${venta ? ` · ${venta.title}` : " · sin venta"}`, folio: d.folio }) }) });
    } catch (e) { (out as any).errores = [...((out as any).errores || []), { folio: d.folio, error: String((e as Error).message || e) }]; } }   // un documento con error no corta la corrida
    return json({ ok: true, dryRun, ...out });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
