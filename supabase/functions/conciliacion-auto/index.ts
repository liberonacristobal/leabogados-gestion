// Edge Function: conciliacion-auto
// Concilia sola, sin intervención, los abonos del banco cuyo destino es INEQUÍVOCO, con las MISMAS reglas que la app
// (../_shared/conciliacionReglas.js): una factura de monto exacto, una combinación única de facturas (o cuotas idénticas,
// las más antiguas), o un fondo ya registrado del mismo monto (si hay varios, el que nombra el mensaje del aviso del banco).
// Solo abonos identificados a un cliente, pendientes y sin nada conciliado. Lo dudoso (factura y fondo a la vez, posible
// devolución de un pago, montos que no calzan) queda para una persona. Todo queda en la bitácora y se deshace desde Banco.
// La llaman procesar-cartola (al llegar la cartola) y agente-correo (al unir un aviso del banco); también a mano.
// Modos (body): dryRun = calcula sin escribir · backtest = recorre lo ya conciliado y compara qué habría hecho.
// Interruptor: learnings config conciliacion_auto = 'on' (sin 'on' = solo dry-run). Auth: CRON_SECRET. verify_jwt=false.

import { normRut, folioN, elegirFactura, elegirCombo, elegirFondo, delMes } from "../_shared/conciliacionReglas.js";

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
const dmy = (iso: string) => { const [y, m, d] = String(iso).slice(0, 10).split("-"); return `${d}-${m}-${y}`; };
const fmt = (n: number) => "$" + Math.round(n || 0).toLocaleString("es-CL");

// deno-lint-ignore no-explicit-any
async function rest(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${path.split("?")[0]}: ${r.status} ${await r.text()}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
// Lecturas paginadas (PostgREST corta en 1.000 filas).
// deno-lint-ignore no-explicit-any
async function todas(path: string): Promise<any[]> {
  // deno-lint-ignore no-explicit-any
  const out: any[] = []; for (let i = 0; i < 50; i++) { const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: { ...H, Range: `${i * 1000}-${i * 1000 + 999}` } }); if (!r.ok) throw new Error(`${path.split("?")[0]}: ${r.status}`); const p = await r.json(); out.push(...p); if (p.length < 1000) break; } return out;
}
const enLista = (ids: string[]) => `(${ids.map((x) => `"${x}"`).join(",")})`;

Deno.serve(async (req) => {
  // deno-lint-ignore no-explicit-any
  let body: any = {}; try { body = await req.json(); } catch { /* sin body */ }
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!CRON_SECRET || (body.secret !== CRON_SECRET && bearer !== CRON_SECRET)) return json({ error: "No autorizado" }, 403);
  try {
    const backtest = !!body.backtest;
    const cfg = await rest("learnings?select=value&kind=eq.config&key=eq.conciliacion_auto");
    const ON = String(cfg?.[0]?.value || "off").trim().toLowerCase() === "on";
    const dryRun = backtest || !!body.dryRun || !ON;
    const dias = Math.min(400, Number(body.dias) || (backtest ? 150 : 60));
    const desde = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);

    const [pool, clients, ents, concAll] = await Promise.all([
      rest("rpc/conciliacion_pool_facturas", { method: "POST", body: "{}" }),
      todas("clients?select=id,name,rut"),
      todas("client_entities?select=client_id,rut"),
      todas("conciliacion?select=movimiento_id,tipo_destino,factura_id,gasto_id,monto_aplicado,created_at"),
    ]);
    const movs = await todas(`cartola_movimientos?select=id,fecha,monto,monto_conciliado,cliente_id,rut_contraparte,nombre_contraparte,descripcion,detalle_aviso,categoria,rol_cuenta,n_operacion,estado,es_interno&tipo=eq.abono&es_interno=eq.false&fecha=gte.${desde}&order=fecha.asc`);
    const cargos = await todas(`cartola_movimientos?select=id,fecha,monto,rut_contraparte,estado&tipo=eq.cargo&estado=eq.pendiente&fecha=gte.${new Date(Date.now() - (dias + 120) * 86400000).toISOString().slice(0, 10)}`);
    const cids = [...new Set(movs.map((m) => m.cliente_id).filter(Boolean))];
    const fondosAll = cids.length ? await todas(`expenses?select=id,client_id,amount,date,concept,project,created_at&type=eq.fondo&deleted_at=is.null&apertura_id=is.null&amount=gt.0&client_id=in.${enLista(cids)}`) : [];
    const nombre: Record<string, string> = Object.fromEntries(clients.map((c) => [c.id, c.name]));
    const rutsCli: Record<string, Set<string>> = {};
    const addR = (cid: string, r: string) => { const n = normRut(r); if (!n || !cid) return; (rutsCli[cid] = rutsCli[cid] || new Set()).add(n); };
    clients.forEach((c) => addR(c.id, c.rut)); ents.forEach((e) => addR(e.client_id, e.rut));
    const rutsFac = (b: { receptor_rut: string; client_id: string }) => { const s = new Set<string>(); const n = normRut(b.receptor_rut); if (n) s.add(n); (rutsCli[b.client_id] || new Set()).forEach((r) => s.add(r)); return s; };
    const concPorMov: Record<string, typeof concAll> = {}; concAll.forEach((c) => { (concPorMov[c.movimiento_id] = concPorMov[c.movimiento_id] || []).push(c); });

    // Estado del pool en un instante: aplicado (filas de conciliación hasta ese momento) y fondos ya ligados.
    // En el backtest el «antes» sigue el orden del banco (depósitos anteriores a este), como trabajará el agente al llegar cada cartola.
    const hist = backtest ? movs : (cids.length ? await todas(`cartola_movimientos?select=id,fecha,monto,cliente_id,rut_contraparte&tipo=eq.abono&cliente_id=in.${enLista(cids)}&fecha=gte.${new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10)}`) : []);
    const fechaMov: Record<string, string> = Object.fromEntries([...hist, ...movs].map((m) => [m.id, `${m.fecha}|${m.id}`]));
    let corte: string | null = null;
    // Lo aplicado y los fondos ligados ANTES de un corte del banco (fecha|id). Sin corte = todo lo que hay hoy.
    const estadoAntes = (k: string | null) => {
      const apl: Record<string, number> = {}, ligados = new Set<string>();
      concAll.forEach((c) => { if (k) { const fm = fechaMov[c.movimiento_id]; if (fm && !(fm < k)) return; } if (c.tipo_destino === "factura" && c.factura_id) apl[c.factura_id] = (apl[c.factura_id] || 0) + Number(c.monto_aplicado || 0); if (c.tipo_destino === "fondo" && c.gasto_id) ligados.add(c.gasto_id); });
      return { apl, ligados };
    };
    const estadoEn = (T: string | null) => estadoAntes(T ? corte : null);
    // Costumbre del cliente ante facturas idénticas abiertas: en sus pagos anteriores (antes del corte), ¿pagó la más antigua
    // ('fifo') o la del mes ('mes')? Solo si lo hizo al menos 2 veces y siempre igual; si no, null (lo decide una persona).
    const habitoCache: Record<string, string | null> = {};
    const habito = (cid: string, k: string | null) => {
      const ck = `${cid}|${k}`; if (ck in habitoCache) return habitoCache[ck];
      let fifo = 0, mes = 0;
      for (const h of hist.filter((x) => x.cliente_id === cid && (!k || `${x.fecha}|${x.id}` < k))) {
        const cs = (concPorMov[h.id] || []); if (cs.length !== 1 || cs[0].tipo_destino !== "factura") continue;
        // deno-lint-ignore no-explicit-any
        const F = pool.find((b: any) => b.id === cs[0].factura_id); if (!F) continue;
        const { apl } = estadoAntes(`${h.fecha}|${h.id}`);
        // deno-lint-ignore no-explicit-any
        const S = pool.filter((b: any) => b.client_id === cid && Number(b.monto_dte) === Number(F.monto_dte) && String(b.created_at) < String(cs[0].created_at) && Number(b.monto_dte) - (apl[b.id] || 0) > 0 && (Number(b.aplicado) > 0 || b.status !== "Pagado") && String(b.issued_at || "") <= String(h.fecha))
          .sort((a: { issued_at: string }, b: { issued_at: string }) => String(a.issued_at || "").localeCompare(String(b.issued_at || "")));
        if (S.length < 2) continue;
        const m = delMes(h, S);
        if (F.id === S[0].id && F.id !== m.id) fifo++; else if (F.id === m.id && F.id !== S[0].id) mes++;
      }
      return (habitoCache[ck] = fifo >= 2 && !mes ? "fifo" : mes >= 2 && !fifo ? "mes" : null);
    };
    // deno-lint-ignore no-explicit-any
    const decidir = (mov: any, T: string | null, used: Set<string>) => {
      const { apl, ligados } = estadoEn(T);
      const fecha = mov.fecha;
      // deno-lint-ignore no-explicit-any
      const abierta = (b: any) => { if (T && !(String(b.created_at) < T)) return false; const a = apl[b.id] || 0; const saldo = Number(b.monto_dte) - a;
        if (saldo <= 0 || used.has(b.id)) return false;
        if (T) return Number(b.aplicado) > 0 || b.status !== "Pagado";   // en la historia: abierta si luego la pagó el banco o sigue impaga
        return ["Pendiente", "Vencido"].includes(b.status) || (b.status === "Pagado" && a > 0); };
      const pr = normRut(mov.rut_contraparte), rc = new Set(rutsCli[mov.cliente_id] || []); if (pr) rc.add(pr);
      // deno-lint-ignore no-explicit-any
      const delCliente = pool.filter((b: any) => b.client_id === mov.cliente_id && abierta(b));
      // deno-lint-ignore no-explicit-any
      const porRut = pool.filter((b: any) => b.client_id !== mov.cliente_id && abierta(b) && [...rutsFac(b)].some((r) => rc.has(r)));
      // deno-lint-ignore no-explicit-any
      const aPool = (xs: any[]) => xs.map((b) => ({ b, saldo: Math.round(Number(b.monto_dte) - (apl[b.id] || 0)) }));
      const texto = [mov.descripcion, mov.detalle_aviso].filter(Boolean).join(" ");
      const honorarios = mov.rol_cuenta !== "gastos";
      const pf = aPool([...delCliente, ...porRut]);
      let f = honorarios ? elegirFactura(mov, pf, texto, { estricto: true }) : null;
      let sinCostumbre = false;
      if (honorarios && !f && elegirFactura(mov, pf, texto)) { f = elegirFactura(mov, pf, texto, { estricto: true, habito: habito(mov.cliente_id, T ? corte : null) }); sinCostumbre = !f; }
      if (sinCostumbre) return { tipo: "duda", motivo: "Varias facturas iguales y el cliente no tiene costumbre clara (la del mes o la más antigua)" };
      const cb = honorarios && !f ? elegirCombo(mov, aPool(delCliente)) : null;
      const fondos = fondosAll.filter((x) => x.client_id === mov.cliente_id && !ligados.has(x.id) && !used.has(x.id) && (!T || String(x.created_at) < T));
      const fo = elegirFondo(mov, fondos, texto);
      const devol = cargos.some((c) => pr && normRut(c.rut_contraparte) === pr && Number(c.monto) <= Number(mov.monto) && String(c.fecha) <= String(fecha));
      if (devol) return { tipo: "duda", motivo: "Puede ser la devolución de un pago nuestro" };
      if ((f || cb) && fo) return { tipo: "duda", motivo: "Calza con una factura y con un fondo" };
      if (f) return { tipo: "factura", facturas: [f], motivo: `Factura N° ${folioN(f.invoice_no)}` };
      if (cb) return { tipo: "factura", facturas: cb, motivo: `Facturas N° ${cb.map((b: { invoice_no: string }) => folioN(b.invoice_no)).join(", ")}` };
      if (fo) return { tipo: "fondo", fondo: fo, motivo: `Fondo «${fo.concept || "Provisión de fondos"}»` };
      return { tipo: "ninguno" };
    };
    // deno-lint-ignore no-explicit-any
    const elegible = (m: any) => m.cliente_id && !m.es_interno && (!m.categoria || m.categoria === "Cliente");

    if (backtest) {
      // Abonos ya conciliados a factura o fondo: ¿qué habría hecho la regla en ese momento, con lo que existía entonces?
      const res = { igual: 0, distinto: 0, se_abstiene: 0, duda: 0 }; const distintos: unknown[] = [];
      for (const m of movs.filter(elegible)) {
        const cs = (concPorMov[m.id] || []).filter((c) => ["factura", "fondo"].includes(c.tipo_destino)); if (!cs.length) continue;
        if ((concPorMov[m.id] || []).some((c) => !["factura", "fondo"].includes(c.tipo_destino))) continue;   // mezcla con otros destinos: no aplica
        const T = cs.map((c) => String(c.created_at)).sort()[0];
        corte = `${m.fecha}|${m.id}`;
        const d = decidir(m, T, new Set());
        const real = cs.map((c) => c.factura_id || c.gasto_id).sort().join(",");
        if (d.tipo === "ninguno") { res.se_abstiene++; continue; }
        if (d.tipo === "duda") { res.duda++; continue; }
        // deno-lint-ignore no-explicit-any
        const prop = (d.tipo === "fondo" ? [d.fondo.id] : (d.facturas as any[]).map((b) => b.id)).sort().join(",");
        if (prop === real) res.igual++;
        else { res.distinto++; distintos.push({ fecha: m.fecha, monto: m.monto, cliente: nombre[m.cliente_id], regla: d.motivo, real: cs.map((c) => `${c.tipo_destino}:${c.factura_id ? folioN(pool.find((b: { id: string }) => b.id === c.factura_id)?.invoice_no) : c.gasto_id}`).join(" + ") }); }
      }
      return json({ ok: true, backtest: true, dias, ...res, distintos });
    }

    // Pendientes: abonos identificados, sin nada conciliado.
    const pend = movs.filter((m) => elegible(m) && m.estado === "pendiente" && !(Number(m.monto_conciliado) > 0) && !(concPorMov[m.id] || []).length);
    const used = new Set<string>(); const hechos: unknown[] = [], dudas: unknown[] = [];
    const tercerosFlip = async (bid: string) => { await rest(`terceros_pagos?billing_id=eq.${bid}&estado=eq.pendiente`, { method: "PATCH", body: JSON.stringify({ estado: "por_pagar" }) }); };
    for (const m of pend) {
      const d = decidir(m, null, used);
      if (d.tipo === "ninguno") continue;
      if (d.tipo === "duda") { dudas.push({ mov: m.id, fecha: m.fecha, monto: m.monto, cliente: nombre[m.cliente_id], motivo: d.motivo }); continue; }
      const sel = d.tipo === "fondo" ? [d.fondo.id] : (d.facturas as { id: string }[]).map((b) => b.id); sel.forEach((x) => used.add(x));
      hechos.push({ mov: m.id, fecha: m.fecha, monto: m.monto, cliente: nombre[m.cliente_id], destino: d.motivo });
      if (dryRun) continue;
      const nuevas: string[] = [];
      try {
        let movApl = 0; const now = new Date().toISOString();
        if (d.tipo === "fondo") {
          const ins = await rest("conciliacion", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ movimiento_id: m.id, tipo_destino: "fondo", gasto_id: d.fondo.id, monto_aplicado: m.monto, origen: "auto" }) });
          nuevas.push(ins[0].id); movApl = Number(m.monto);
        } else {
          // Igual que reconciliar/reconciliarCombo de la app: aplica el saldo, marca la factura pagada si queda cubierta.
          for (const b of d.facturas as { id: string; status: string; amount: number; paid_amount: number; monto_dte: number; aplicado: number }[]) {
            const saldo = Math.max(0, Number(b.monto_dte) - Number(b.aplicado || 0));
            const aplicado = Math.min(Number(m.monto) - movApl, saldo); if (aplicado <= 0) continue;
            const manualExtra = Math.max(0, Number(b.paid_amount || 0) - Number(b.aplicado || 0));
            const aplTot = Number(b.aplicado || 0) + aplicado + manualExtra;
            const marco = b.status !== "Pagado" && aplTot >= Number(b.amount || 0);
            const ins = await rest("conciliacion", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ movimiento_id: m.id, tipo_destino: "factura", factura_id: b.id, monto_aplicado: aplicado, origen: "auto", marco_pago: marco }) });
            nuevas.push(ins[0].id);
            const patch = b.status === "Pagado" ? { reconciled_at: now, updated_at: now }
              : marco ? { status: "Pagado", paid: true, paid_at: m.fecha, payment_date: m.fecha, payment_method: "Transferencia", payment_ref: m.n_operacion || null, paid_amount: Number(b.amount || 0), reconciled_at: now, updated_at: now }
              : { paid_amount: aplTot, payment_method: "Transferencia", payment_ref: m.n_operacion || null, reconciled_at: now, updated_at: now };
            await rest(`billing?id=eq.${b.id}`, { method: "PATCH", body: JSON.stringify(patch) });
            if (marco) await tercerosFlip(b.id);
            movApl += aplicado;
          }
        }
        const estado = Number(m.monto) - movApl <= 0 ? "conciliado" : "parcial";
        await rest(`cartola_movimientos?id=eq.${m.id}`, { method: "PATCH", body: JSON.stringify({ estado, monto_conciliado: movApl }) });
        await rest("activity_log", { method: "POST", body: JSON.stringify({ user_email: "agente", action: "banco.conciliado_auto", table_name: "conciliacion", record_id: nuevas[0], estudio_id: "lea",
          detail: { title: `Conciliado automáticamente: ${nombre[m.cliente_id] || m.nombre_contraparte || ""} ${fmt(m.monto)} del ${dmy(m.fecha)} → ${d.motivo}`, mov: m.id, conciliacion: nuevas, regla: d.motivo, aviso: m.detalle_aviso || null } }) });
        const av = await rest(`avisos_banco?select=gmail_id&movimiento_id=eq.${m.id}`);
        for (const a of av || []) await rest(`agente_bandeja?gmail_id=eq.${encodeURIComponent(a.gmail_id)}`, { method: "PATCH", body: JSON.stringify({ estado: "registrado", motivo: `Conciliado automáticamente con ${d.tipo === "fondo" ? "el " + d.motivo.charAt(0).toLowerCase() + d.motivo.slice(1) : "la " + d.motivo}`, propuesta: { movimiento_id: m.id } }) });
      } catch (e) {
        for (const id of nuevas) { try { await rest(`conciliacion?id=eq.${id}`, { method: "DELETE" }); } catch { /* best-effort */ } }
        hechos.pop(); dudas.push({ mov: m.id, motivo: "Error al conciliar: " + String((e as Error).message || e) });
      }
    }
    return json({ ok: true, enviado: !dryRun, dryRun, conciliados: hechos.length, hechos, dudas });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
