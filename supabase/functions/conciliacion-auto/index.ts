// Edge Function: conciliacion-auto
// Concilia sola, sin intervención, los abonos del banco cuyo destino es INEQUÍVOCO, con las MISMAS reglas que la app
// (../_shared/conciliacionReglas.js): una factura de monto exacto, una combinación única de facturas (o cuotas idénticas,
// las más antiguas), o un fondo ya registrado del mismo monto (si hay varios, el que nombra el mensaje del aviso del banco).
// Solo abonos identificados a un cliente, pendientes y sin nada conciliado. Lo dudoso (factura y fondo a la vez, posible
// devolución de un pago, montos que no calzan) queda para una persona. Todo queda en la bitácora y se deshace desde Banco.
// La llaman procesar-cartola (al llegar la cartola) y agente-correo (al unir un aviso del banco); también a mano.
// FONDOS POR REGISTRAR: el abono sin destino (o el aviso del banco que aún no llega en la cartola) con señal de fondo
// (pareceFondo: solicitud de fondos por ese monto, o mensaje que nombra el trabajo o habla de fondos) queda como propuesta en
// agente_bandeja (tipo fondo_por_registrar) para Gastos › Revisar; una persona lo registra. Solicitudes de fondos con 7 días
// sin depósito → tarea a quien la envió (una vez).
// PAGOS DE COMISIONES: un cargo al RUT de un proveedor que calza exacto y único con lo que falta transferirle de una comisión
// por pagar (calcesPagoComision, la misma regla que «Conciliación sola» de Proveedores) la deja pagada y concilia el cargo.
// CARGOS RECURRENTES: racha (rachaCargo: 3 cargos previos al mismo RUT con la misma clase de oficina y monto ±30%) → costo de
// oficina igual; contadora (repartoContadora con el correo VALORES del mes anterior, al peso; PPM menos retenciones BHE del
// mes). Nunca socios, equipo, proveedores ni clientes. body.backtestCargos = compara la regla con lo ya clasificado.
// SALDO A FAVOR CARGADO A MANO: el abono que calza exacto y único (±10 días) con un anticipo del cliente sin respaldo del banco
// (elegirAnticipo) se enlaza a ese anticipo en vez de dejarlo para crear otro (el doble de Gabriela). Si además calza con una
// factura o un fondo, lo ve una persona.
// TARJETA ↔ UBER: el pago de la tarjeta se une con los viajes de Uber Business ya registrados como gasto (lo demás, por rubro).
// NOTARÍA ↔ BANCO: el cargo a un RUT de notaría ya conocido por el monto exacto y único de una liquidación (liqParaCargo, la misma
// regla de Banco) se enlaza y sus OT quedan pagadas con la fecha del cargo. Sin RUT conocido o con monto distinto, lo ve una persona.
// COMPRAS DEL SII ↔ PAGOS: la factura de compra con un solo cargo del mismo RUT y monto al peso en su ventana (calcesCompraPago)
// queda con su pago (sii_compras_docs.movimiento_id). Es trazabilidad: no cambia la conciliación del cargo.
// Modos (body): dryRun = calcula sin escribir · backtest = recorre lo ya conciliado y compara qué habría hecho.
// Interruptor: learnings config conciliacion_auto = 'on' (sin 'on' = solo dry-run). Auth: CRON_SECRET. verify_jwt=false.

import { normRut, folioN, elegirFactura, elegirCombo, elegirFondo, elegirAnticipo, delMes, pareceFondo, rachaCargo, repartoContadora } from "../_shared/conciliacionReglas.js";
import { pagarT, reajusteBHEPago, estadoComision, calcesPagoComision } from "../_shared/comisionesReglas.js";
import { nombreGenerico } from "../_shared/contrapartes.js";
import { liqParaCargo } from "../_shared/notariaReglas.js";
import { calcesCompraPago } from "../_shared/comprasReglas.js";

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
  // Orden estable entre páginas (sin «order», Postgres no garantiza que las páginas no se pisen). miembros no tiene id.
  const p2 = /[?&]order=/.test(path) || /^(miembros|rpc\/)/.test(path) ? path : `${path}${path.includes("?") ? "&" : "?"}order=id.asc`;
  const out: any[] = []; for (let i = 0; i < 50; i++) { const r = await fetch(`${SB_URL}/rest/v1/${p2}`, { headers: { ...H, Range: `${i * 1000}-${i * 1000 + 999}` } }); if (!r.ok) throw new Error(`${path.split("?")[0]}: ${r.status}`); const p = await r.json(); out.push(...p); if (p.length < 1000) break; } return out;
}
const enLista = (ids: string[]) => `(${ids.map((x) => `"${x}"`).join(",")})`;

Deno.serve(async (req) => {
  // deno-lint-ignore no-explicit-any
  let body: any = {}; try { body = await req.json(); } catch { /* sin body */ }
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!CRON_SECRET || (body.secret !== CRON_SECRET && bearer !== CRON_SECRET)) return json({ error: "No autorizado" }, 403);
  let lockTomado = false;
  try {
    const backtest = !!body.backtest;
    const cfg = await rest("learnings?select=value&kind=eq.config&key=eq.conciliacion_auto");
    const ON = String(cfg?.[0]?.value || "off").trim().toLowerCase() === "on";
    const dryRun = backtest || !!body.backtestCargos || !!body.backtestNinguno || !!body.dryRun || !ON;
    // Una sola corrida que escribe a la vez (la llaman la cartola, el agente de correo y el cron): si otra está en curso, esta no
    // hace nada (las dos tomarían el mismo depósito). El candado vence a los 5 minutos por si una corrida murió sin soltarlo.
    if (!dryRun) {
      await rest(`procesos_lock?nombre=eq.conciliacion-auto&tomado_at=lt.${new Date(Date.now() - 5 * 60000).toISOString()}`, { method: "DELETE" });
      const tomo = await rest("procesos_lock?on_conflict=nombre", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify({ nombre: "conciliacion-auto" }) });
      if (!tomo?.length) return json({ ok: true, ocupado: true, motivo: "Otra corrida en curso" });
      lockTomado = true;
    }
    const dias = Math.min(400, Number(body.dias) || (backtest ? 150 : 60));
    const desde = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);

    // Nombre real del pagador por RUT: si el banco trae un nombre genérico de su servicio de pagos («NOMINA MISMO DIA PROVEEDORES»)
    // o ninguno, se toma el de la razón social, el cliente, el proveedor, la factura de compra del SII u otro movimiento del mismo RUT.
    const nombres = { completados: [] as unknown[], error: null as string | null };
    try {
      const sinNombre = (await todas(`cartola_movimientos?select=id,rut_contraparte,nombre_contraparte&rut_contraparte=not.is.null&fecha=gte.${desde}`)).filter((m) => normRut(m.rut_contraparte) && nombreGenerico(m.nombre_contraparte));
      if (sinNombre.length) {
        const [en, cl, pv, sc, otros] = await Promise.all([todas("client_entities?select=rut,name"), todas("clients?select=rut,name"), todas("proveedores?select=rut,nombre"), todas("sii_compras_docs?select=emisor_rut,emisor_name"), todas(`cartola_movimientos?select=rut_contraparte,nombre_contraparte&rut_contraparte=in.(${[...new Set(sinNombre.map((m) => `"${m.rut_contraparte}"`))].join(",")})`)]);
        const fuente: Record<string, string> = {};
        const add = (r: string, n: string) => { const k = normRut(r); if (k && n && !nombreGenerico(n) && !fuente[k]) fuente[k] = String(n).trim(); };
        en.forEach((x) => add(x.rut, x.name)); cl.forEach((x) => add(x.rut, x.name)); pv.forEach((x) => add(x.rut, x.nombre)); sc.forEach((x) => add(x.emisor_rut, x.emisor_name)); otros.forEach((x) => add(x.rut_contraparte, x.nombre_contraparte));
        for (const m of sinNombre) { const n = fuente[normRut(m.rut_contraparte)]; if (!n) continue;
          nombres.completados.push({ mov: m.id, rut: m.rut_contraparte, antes: m.nombre_contraparte, nombre: n });
          if (!dryRun) await rest(`cartola_movimientos?id=eq.${m.id}`, { method: "PATCH", body: JSON.stringify({ nombre_contraparte: n }) }); }
        if (!dryRun && nombres.completados.length) await rest("activity_log", { method: "POST", body: JSON.stringify({ user_email: "agente", action: "banco.nombre_por_rut", table_name: "cartola_movimientos", estudio_id: "lea", detail: { title: `${nombres.completados.length} movimiento${nombres.completados.length !== 1 ? "s" : ""} con el nombre real del pagador (por RUT)`, cambios: nombres.completados } }) }).catch(() => null);
      }
    } catch (e) { nombres.error = String((e as Error).message || e); }
    const [pool, clients, ents, concAll] = await Promise.all([
      // El pool se pide por páginas (PostgREST corta en 1.000 filas): con más facturas abiertas, una «única» podría no serlo.
      (async () => { const out: any[] = []; for (let i = 0; i < 20; i++) { const r = await fetch(`${SB_URL}/rest/v1/rpc/conciliacion_pool_facturas?order=id.asc`, { method: "POST", headers: { ...H, Range: `${i * 1000}-${i * 1000 + 999}` }, body: "{}" }); if (!r.ok) throw new Error(`conciliacion_pool_facturas: ${r.status}`); const p = await r.json(); out.push(...p); if (p.length < 1000) break; } return out; })(),
      todas("clients?select=id,name,rut"),
      todas("client_entities?select=client_id,rut"),
      todas("conciliacion?select=movimiento_id,tipo_destino,factura_id,gasto_id,anticipo_id,monto_aplicado,created_at"),
    ]);
    const movs = await todas(`cartola_movimientos?select=id,cuenta,fecha,monto,monto_conciliado,cliente_id,rut_contraparte,nombre_contraparte,descripcion,detalle_aviso,categoria,rol_cuenta,n_operacion,estado,es_interno&tipo=eq.abono&es_interno=eq.false&fecha=gte.${desde}&order=fecha.asc`);
    const cargos = await todas(`cartola_movimientos?select=id,fecha,monto,rut_contraparte,estado&tipo=eq.cargo&estado=eq.pendiente&fecha=gte.${new Date(Date.now() - (dias + 120) * 86400000).toISOString().slice(0, 10)}`);
    // Simulación (solo dryRun): estos movimientos como si estuvieran pendientes y sin estos fondos (p. ej. rehacer un día pasado).
    const sim = dryRun && body.simular ? { movs: new Set<string>(body.simular.movs || []), sinFondos: new Set<string>(body.simular.sinFondos || []), sinAvisoMov: !!body.simular.antesDeCartola } : null;
    if (sim) movs.forEach((m) => { if (sim.movs.has(m.id)) { m.estado = "pendiente"; m.monto_conciliado = 0; } });
    const cids = [...new Set(movs.map((m) => m.cliente_id).filter(Boolean))];
    const fondosAll = cids.length ? await todas(`expenses?select=id,client_id,amount,date,concept,project,created_at&type=eq.fondo&deleted_at=is.null&apertura_id=is.null&amount=gt.0&client_id=in.${enLista(cids)}`) : [];
    if (sim) for (let i = fondosAll.length - 1; i >= 0; i--) if (sim.sinFondos.has(fondosAll[i].id)) fondosAll.splice(i, 1);
    const anticiposAll = cids.length ? await todas(`anticipos?select=id,client_id,monto,fecha,nota,estado,created_at&monto=gt.0&client_id=in.${enLista(cids)}`) : [];
    const nombre: Record<string, string> = Object.fromEntries(clients.map((c) => [c.id, c.name]));
    const rutsCli: Record<string, Set<string>> = {};
    const addR = (cid: string, r: string) => { const n = normRut(r); if (!n || !cid) return; (rutsCli[cid] = rutsCli[cid] || new Set()).add(n); };
    clients.forEach((c) => addR(c.id, c.rut)); ents.forEach((e) => addR(e.client_id, e.rut));
    const rutsFac = (b: { receptor_rut: string; client_id: string }) => { const s = new Set<string>(); const n = normRut(b.receptor_rut); if (n) s.add(n); (rutsCli[b.client_id] || new Set()).forEach((r) => s.add(r)); return s; };
    if (sim) for (let i = concAll.length - 1; i >= 0; i--) if (sim.movs.has(concAll[i].movimiento_id)) concAll.splice(i, 1);
    const concPorMov: Record<string, typeof concAll> = {}; concAll.forEach((c) => { (concPorMov[c.movimiento_id] = concPorMov[c.movimiento_id] || []).push(c); });

    // Estado del pool en un instante: aplicado (filas de conciliación hasta ese momento) y fondos ya ligados.
    // En el backtest el «antes» sigue el orden del banco (depósitos anteriores a este), como trabajará el agente al llegar cada cartola.
    const hist = backtest ? movs : (cids.length ? await todas(`cartola_movimientos?select=id,fecha,monto,cliente_id,rut_contraparte&tipo=eq.abono&cliente_id=in.${enLista(cids)}&fecha=gte.${new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10)}`) : []);
    const fechaMov: Record<string, string> = Object.fromEntries([...hist, ...movs].map((m) => [m.id, `${m.fecha}|${m.id}`]));
    let corte: string | null = null;
    // Lo aplicado y los fondos ligados ANTES de un corte del banco (fecha|id). Sin corte = todo lo que hay hoy.
    const estadoAntes = (k: string | null) => {
      const apl: Record<string, number> = {}, ligados = new Set<string>();
      concAll.forEach((c) => { if (k) { const fm = fechaMov[c.movimiento_id]; if (fm && !(fm < k)) return; } if (c.tipo_destino === "factura" && c.factura_id) apl[c.factura_id] = (apl[c.factura_id] || 0) + Number(c.monto_aplicado || 0); if (c.tipo_destino === "fondo" && c.gasto_id) ligados.add(c.gasto_id); if (c.tipo_destino === "anticipo" && c.anticipo_id) ligados.add(c.anticipo_id); });
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
      const an = elegirAnticipo(mov, anticiposAll.filter((x) => x.client_id === mov.cliente_id && !ligados.has(x.id) && !used.has(x.id) && (!T || String(x.created_at) < T)));
      const devol = cargos.some((c) => pr && normRut(c.rut_contraparte) === pr && Number(c.monto) <= Number(mov.monto) && String(c.fecha) <= String(fecha));
      if (devol) return { tipo: "duda", motivo: "Puede ser la devolución de un pago nuestro" };
      if ((f || cb) && fo) return { tipo: "duda", motivo: "Calza con una factura y con un fondo" };
      if (an && (f || cb || fo)) return { tipo: "duda", motivo: "Calza con un saldo a favor cargado a mano y con otro destino" };
      if (f) return { tipo: "factura", facturas: [f], motivo: `Factura N° ${folioN(f.invoice_no)}` };
      if (cb) return { tipo: "factura", facturas: cb, motivo: `Facturas N° ${cb.map((b: { invoice_no: string }) => folioN(b.invoice_no)).join(", ")}` };
      if (fo) return { tipo: "fondo", fondo: fo, motivo: `Fondo «${fo.concept || "Provisión de fondos"}»` };
      if (an) return { tipo: "anticipo", anticipo: an, motivo: `Saldo a favor del ${dmy(an.fecha)} cargado a mano` };
      return { tipo: "ninguno" };
    };
    // deno-lint-ignore no-explicit-any
    const elegible = (m: any) => m.cliente_id && !m.es_interno && (!m.categoria || m.categoria === "Cliente");

    if (body.backtestNinguno) {
      // Abonos ya conciliados donde la regla no habría encontrado destino: ¿en qué terminaron? (calibra «fondos por registrar»).
      // deno-lint-ignore no-explicit-any
      const filas: any[] = [];
      for (const m of movs.filter(elegible)) {
        const cs = (concPorMov[m.id] || []); if (!cs.length) continue;
        const T = cs.map((c) => String(c.created_at)).sort()[0]; corte = `${m.fecha}|${m.id}`;
        const d = decidir(m, T, new Set()); if (d.tipo !== "ninguno") continue;
        filas.push({ fecha: m.fecha, monto: m.monto, cli: nombre[m.cliente_id], rol: m.rol_cuenta, real: [...new Set(cs.map((c) => c.tipo_destino))].join("+"), texto: [m.descripcion, m.detalle_aviso].filter(Boolean).join(" | ").slice(0, 90) });
      }
      return json({ ok: true, n: filas.length, filas });
    }
    if (backtest) {
      // Abonos ya conciliados a factura o fondo: ¿qué habría hecho la regla en ese momento, con lo que existía entonces?
      const res = { igual: 0, distinto: 0, se_abstiene: 0, duda: 0 }; const distintos: unknown[] = [];
      for (const m of movs.filter(elegible)) {
        const cs = (concPorMov[m.id] || []).filter((c) => ["factura", "fondo", "anticipo"].includes(c.tipo_destino)); if (!cs.length) continue;
        if ((concPorMov[m.id] || []).some((c) => !["factura", "fondo", "anticipo"].includes(c.tipo_destino))) continue;   // mezcla con otros destinos: no aplica
        const T = cs.map((c) => String(c.created_at)).sort()[0];
        corte = `${m.fecha}|${m.id}`;
        const d = decidir(m, T, new Set());
        const real = cs.map((c) => c.factura_id || c.gasto_id || c.anticipo_id).sort().join(",");
        if (d.tipo === "ninguno") { res.se_abstiene++; continue; }
        if (d.tipo === "duda") { res.duda++; continue; }
        // deno-lint-ignore no-explicit-any
        const prop = (d.tipo === "fondo" ? [d.fondo.id] : d.tipo === "anticipo" ? [d.anticipo.id] : (d.facturas as any[]).map((b) => b.id)).sort().join(",");
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
      const sel = d.tipo === "fondo" ? [d.fondo.id] : d.tipo === "anticipo" ? [d.anticipo.id] : (d.facturas as { id: string }[]).map((b) => b.id); sel.forEach((x) => used.add(x));
      hechos.push({ mov: m.id, fecha: m.fecha, monto: m.monto, cliente: nombre[m.cliente_id], destino: d.motivo });
      if (dryRun) continue;
      const nuevas: string[] = [];
      // Para deshacer si un paso falla a medias: estado previo de cada factura tocada y comisiones que pasaron a «por pagar».
      const prevBill: { id: string; antes: unknown }[] = [], flipT: string[] = []; let movTocado = false;
      try {
        let movApl = 0; const now = new Date().toISOString();
        if (d.tipo === "fondo") {
          const ins = await rest("conciliacion", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ movimiento_id: m.id, tipo_destino: "fondo", gasto_id: d.fondo.id, monto_aplicado: m.monto, origen: "auto" }) });
          nuevas.push(ins[0].id); movApl = Number(m.monto);
        } else if (d.tipo === "anticipo") {
          const ins = await rest("conciliacion", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ movimiento_id: m.id, tipo_destino: "anticipo", anticipo_id: d.anticipo.id, monto_aplicado: m.monto, origen: "auto" }) });
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
            const antes = (await rest(`billing?id=eq.${b.id}&select=status,paid,paid_at,payment_date,payment_method,payment_ref,paid_amount,reconciled_at,updated_at`))?.[0];
            await rest(`billing?id=eq.${b.id}`, { method: "PATCH", body: JSON.stringify(patch) }); prevBill.push({ id: b.id, antes });
            if (marco) { const ts = await rest(`terceros_pagos?select=id&billing_id=eq.${b.id}&estado=eq.pendiente`); await tercerosFlip(b.id); flipT.push(...(ts || []).map((t: { id: string }) => t.id)); }
            movApl += aplicado;
          }
        }
        const estado = Number(m.monto) - movApl <= 0 ? "conciliado" : "parcial";
        await rest(`cartola_movimientos?id=eq.${m.id}`, { method: "PATCH", body: JSON.stringify({ estado, monto_conciliado: movApl }) }); movTocado = true;
        // Bitácora y bandeja: no deshacen la conciliación si fallan (best-effort).
        await rest("activity_log", { method: "POST", body: JSON.stringify({ user_email: "agente", action: "banco.conciliado_auto", table_name: "conciliacion", record_id: nuevas[0], estudio_id: "lea",
          detail: { title: `Conciliado automáticamente: ${nombre[m.cliente_id] || m.nombre_contraparte || ""} ${fmt(m.monto)} del ${dmy(m.fecha)} → ${d.motivo}`, mov: m.id, conciliacion: nuevas, regla: d.motivo, aviso: m.detalle_aviso || null } }) }).catch(() => null);
        const av = await rest(`avisos_banco?select=gmail_id&movimiento_id=eq.${m.id}`).catch(() => []);
        for (const a of av || []) await rest(`agente_bandeja?gmail_id=eq.${encodeURIComponent(a.gmail_id)}`, { method: "PATCH", body: JSON.stringify({ estado: "registrado", motivo: `Conciliado automáticamente con ${d.tipo === "fondo" || d.tipo === "anticipo" ? "el " + d.motivo.charAt(0).toLowerCase() + d.motivo.slice(1) : "la " + d.motivo}`, propuesta: { movimiento_id: m.id } }) }).catch(() => null);
      } catch (e) {
        for (const id of nuevas) { try { await rest(`conciliacion?id=eq.${id}`, { method: "DELETE" }); } catch { /* best-effort */ } }
        for (const p of prevBill) { try { if (p.antes) await rest(`billing?id=eq.${p.id}`, { method: "PATCH", body: JSON.stringify(p.antes) }); } catch { /* best-effort */ } }
        if (flipT.length) { try { await rest(`terceros_pagos?id=in.${enLista(flipT)}`, { method: "PATCH", body: JSON.stringify({ estado: "pendiente" }) }); } catch { /* best-effort */ } }
        if (movTocado) { try { await rest(`cartola_movimientos?id=eq.${m.id}`, { method: "PATCH", body: JSON.stringify({ estado: "pendiente", monto_conciliado: 0 }) }); } catch { /* best-effort */ } }
        hechos.pop(); dudas.push({ mov: m.id, motivo: "Error al conciliar: " + String((e as Error).message || e) });
      }
    }
    // ── Fondos por registrar ──
    const fpr = { propuestos: [] as unknown[], unidos: 0, cerrados: 0, tareas: [] as unknown[] };
    try {
      const diaCL = (ts: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date(ts));
      const cuentaN = (c: string) => String(c || "").replace(/\D/g, "").replace(/^0+/, "");
      const rolPorCuenta: Record<string, string> = {}; movs.forEach((m) => { if (m.cuenta && m.rol_cuenta) rolPorCuenta[cuentaN(m.cuenta)] = m.rol_cuenta; });
      const hace = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
      const [sols, avisos0, filasF] = await Promise.all([
        todas(`fund_requests?select=id,client_id,monto,asunto,enviada_at,enviada_por&recibido_at=is.null&enviada_at=gte.${hace(60)}`),
        todas(`avisos_banco?select=gmail_id,tipo,monto,cuenta,fecha_hora,contraparte_nombre,contraparte_rut,mensaje,banco,movimiento_id,estado&tipo=eq.abono&created_at=gte.${hace(12)}`),
        todas(`agente_bandeja?select=id,gmail_id,estado,propuesta,cliente_id&tipo=eq.fondo_por_registrar&created_at=gte.${hace(90)}`),
      ]);
      const avisos = sim ? avisos0.map((a) => sim.movs.has(a.movimiento_id) && sim.sinAvisoMov ? { ...a, movimiento_id: null, estado: "por_calzar" } : a) : avisos0;
      if (sim?.sinAvisoMov) for (let i = pend.length - 1; i >= 0; i--) if (sim.movs.has(pend[i].id)) pend.splice(i, 1);
      // Filas ya propuestas: un aviso o un movimiento se propone UNA vez (si se descartó, no vuelve).
      const yaMov = new Set<string>(), yaAviso = new Set<string>();
      filasF.forEach((r) => { if (r.propuesta?.movimiento_id) yaMov.add(r.propuesta.movimiento_id); if (r.propuesta?.aviso_gmail) yaAviso.add(r.propuesta.aviso_gmail); });
      avisos.forEach((a) => { if (a.movimiento_id && yaAviso.has(a.gmail_id)) yaMov.add(a.movimiento_id); });
      // Cliente de un aviso: RUT conocido, o el nombre exacto (normalizado) de la ficha o de una de sus razones sociales.
      const nn = (x: string) => String(x || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\b(spa|ltda|limitada|s ?a|eirl)\b/g, "").replace(/\s+/g, " ").trim();
      const porRut: Record<string, string> = {}; Object.entries(rutsCli).forEach(([cid, rs]) => rs.forEach((r) => { porRut[r] = porRut[r] && porRut[r] !== cid ? "*" : cid; }));
      const porNom: Record<string, string> = {}; const addN = (cid: string, n: string) => { const k = nn(n); if (k.length >= 6) porNom[k] = porNom[k] && porNom[k] !== cid ? "*" : cid; };
      clients.forEach((c) => addN(c.id, c.name)); (await todas("client_entities?select=client_id,name")).forEach((e) => addN(e.client_id, e.name));
      const cliAviso = (a: { contraparte_rut: string; contraparte_nombre: string }) => { const r = porRut[normRut(a.contraparte_rut)]; if (r && r !== "*") return r; const n = porNom[nn(a.contraparte_nombre)]; return n && n !== "*" ? n : null; };
      const cands: { mov: any; texto: string; aviso?: any }[] = [];
      // Propuesta abierta desde un aviso que aún no se une a su movimiento (la cartola llegó antes que el aviso se calzara): el mismo
      // depósito no se propone dos veces (mismo cliente y monto, ±2 días).
      const delAviso = (m: any) => filasF.some((r) => r.estado === "pendiente" && r.propuesta?.aviso_gmail && !r.propuesta?.movimiento_id && r.cliente_id === m.cliente_id && Math.round(Number(r.propuesta?.monto)) === Math.round(Number(m.monto)) && Math.abs(new Date(String(r.propuesta?.fecha)).getTime() - new Date(String(m.fecha)).getTime()) <= 2 * 86400000);
      for (const m of pend) { if (used.has(m.id) || yaMov.has(m.id) || hechos.some((h: any) => h.mov === m.id) || delAviso(m)) continue; if (decidir(m, null, used).tipo !== "ninguno") continue;
        const av = avisos.find((a) => a.movimiento_id === m.id); cands.push({ mov: m, texto: [m.detalle_aviso, av?.mensaje].filter(Boolean).join(" "), aviso: av }); }
      for (const a of avisos) { if (a.movimiento_id || a.estado === "calzado" || yaAviso.has(a.gmail_id) || !a.fecha_hora) continue;
        const cid = cliAviso(a); if (!cid) continue;
        const mv = { id: null, fecha: diaCL(a.fecha_hora), monto: Math.round(Number(a.monto)), cliente_id: cid, rut_contraparte: a.contraparte_rut, nombre_contraparte: a.contraparte_nombre, descripcion: "", detalle_aviso: a.mensaje, rol_cuenta: rolPorCuenta[cuentaN(a.cuenta)] || "honorarios" };
        if (!fondosAll.some((x) => x.client_id === cid) && !cids.includes(cid)) { const fx = await todas(`expenses?select=id,client_id,amount,date,concept,project,created_at&type=eq.fondo&deleted_at=is.null&apertura_id=is.null&amount=gt.0&client_id=eq.${cid}`); fondosAll.push(...fx); }
        if (decidir(mv, null, used).tipo !== "ninguno") continue;
        cands.push({ mov: mv, texto: a.mensaje || "", aviso: a }); }
      // Trabajos del cliente: títulos de sus ventas (primero: el fondo queda ligado a la venta) y proyectos ya usados en sus gastos.
      const cidsC = [...new Set(cands.map((c) => c.mov.cliente_id))];
      const proyectos: Record<string, string[]> = {};
      if (cidsC.length) {
        const [ex, sa] = await Promise.all([todas(`expenses?select=client_id,project&deleted_at=is.null&project=not.is.null&client_id=in.${enLista(cidsC)}`), todas(`sales?select=client_id,title&deleted_at=is.null&client_id=in.${enLista(cidsC)}`)]);
        [...sa.map((x) => [x.client_id, x.title]), ...ex.map((x) => [x.client_id, x.project])].forEach(([c, p]) => { if (p) (proyectos[c] = proyectos[c] || []).push(p); });
      }
      // Solicitud ya atendida = existe un fondo del cliente por ese monto (±2%) desde 3 días antes de enviarla.
      const cidsS = [...new Set(sols.map((x) => x.client_id).filter(Boolean))];
      const fondosS = cidsS.length ? await todas(`expenses?select=id,client_id,amount,date&type=eq.fondo&deleted_at=is.null&amount=gt.0&client_id=in.${enLista(cidsS)}`) : [];
      const fondoDe = (s: any) => { const d0 = new Date(new Date(s.enviada_at).getTime() - 3 * 86400000).toISOString().slice(0, 10);
        return fondosS.filter((x) => x.client_id === s.client_id && Math.abs(Number(x.amount) - Number(s.monto)) <= Number(s.monto) * 0.02 && String(x.date) >= d0).sort((a, b) => String(a.date).localeCompare(String(b.date)))[0] || null; };
      const atendida = (s: any) => !!fondoDe(s);
      // Solicitud con su fondo ya en la app (registrado por cualquier vía, también a mano) → queda «recibida» con la fecha del fondo.
      // Un fondo atiende a una sola solicitud (la más antigua que calza).
      const fondoUsado = new Set<string>();
      for (const sq of [...sols].sort((a, b) => String(a.enviada_at).localeCompare(String(b.enviada_at)))) {
        const f = fondosS.filter((x) => !fondoUsado.has(x.id) && x.client_id === sq.client_id && Math.abs(Number(x.amount) - Number(sq.monto)) <= Number(sq.monto) * 0.02 && String(x.date) >= new Date(new Date(sq.enviada_at).getTime() - 3 * 86400000).toISOString().slice(0, 10)).sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
        if (!f) continue; fondoUsado.add(f.id); (fpr as any).recibidas = [...((fpr as any).recibidas || []), { cliente: nombre[sq.client_id], monto: sq.monto, fondo: f.date }];
        if (!dryRun) await rest(`fund_requests?id=eq.${sq.id}&recibido_at=is.null`, { method: "PATCH", body: JSON.stringify({ estado: "recibida", recibido_at: `${String(f.date).slice(0, 10)}T12:00:00Z` }) });
      }
      const solUsada = new Set<string>();
      for (const c of cands) {
        const m = c.mov, ss = sols.filter((s) => s.client_id === m.cliente_id && !solUsada.has(s.id) && !atendida(s));
        const p = pareceFondo(m, c.texto, ss, proyectos[m.cliente_id] || []); if (!p) continue;
        if (p.solicitud) solUsada.add(p.solicitud);
        const de = c.aviso?.contraparte_nombre || m.nombre_contraparte || "";
        const fila = { gmail_id: `fondo:${c.aviso?.gmail_id || "mov:" + m.id}`, recibido_at: c.aviso?.fecha_hora || `${m.fecha}T12:00:00Z`, de, de_nombre: de, asunto: "Fondo por registrar", tipo: "fondo_por_registrar", cliente_id: m.cliente_id, estado: "pendiente",
          motivo: p.fuente === "solicitud" ? "Calza con una solicitud de fondos" : "El mensaje de la transferencia indica un fondo",
          propuesta: { accion: "registrar_fondo", titulo: "Registrar el fondo", monto: m.monto, fecha: m.fecha, proyecto: p.proyecto, concepto: p.concepto, solicitud_id: p.solicitud, fuente: p.fuente, movimiento_id: m.id || c.aviso?.movimiento_id || null, aviso_gmail: c.aviso?.gmail_id || null },
          evidencia: [{ texto: `Transferencia de ${de || "el cliente"}${c.texto ? ` · «${c.texto.trim()}»` : ""}`, monto: m.monto, fuente: c.aviso?.banco || "cartola" }] };
        fpr.propuestos.push({ cliente: nombre[m.cliente_id], monto: m.monto, fecha: m.fecha, proyecto: p.proyecto, fuente: p.fuente, desde: c.aviso && !m.id ? "aviso" : "cartola" });
        if (!dryRun) await rest("agente_bandeja?on_conflict=gmail_id", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates" }, body: JSON.stringify(fila) });
      }
      // Propuestas abiertas: el aviso ya llegó en la cartola → se une su movimiento; el movimiento ya se concilió en Banco → se cierra.
      for (const r of filasF.filter((x) => x.estado === "pendiente")) {
        const p = r.propuesta || {}; let mid = p.movimiento_id;
        if (!mid && p.aviso_gmail) { const a = avisos.find((x) => x.gmail_id === p.aviso_gmail); if (a?.movimiento_id) { mid = a.movimiento_id; fpr.unidos++; if (!dryRun) await rest(`agente_bandeja?id=eq.${r.id}`, { method: "PATCH", body: JSON.stringify({ propuesta: { ...p, movimiento_id: mid } }) }); } }
        const mv = mid ? movs.find((x) => x.id === mid) : null;
        if (mv && (mv.estado !== "pendiente" || (concPorMov[mid] || []).length || hechos.some((h: any) => h.mov === mid))) { fpr.cerrados++; if (!dryRun) await rest(`agente_bandeja?id=eq.${r.id}`, { method: "PATCH", body: JSON.stringify({ estado: "registrado", motivo: "El depósito ya está conciliado en Banco", resuelto_at: new Date().toISOString() }) }); }
      }
      // Solicitudes de fondos con 7 días o más sin fondo recibido: tarea a quien la envió, una sola vez por solicitud.
      const viejas = sols.filter((s) => s.enviada_at <= hace(7) && s.enviada_at >= hace(30) && !atendida(s) && !solUsada.has(s.id));
      if (viejas.length) {
        const ya = new Set((await todas(`activity_log?select=record_id&action=eq.fondos.solicitud_sin_deposito&created_at=gte.${hace(60)}`)).map((x) => x.record_id));
        for (const s of viejas.filter((x) => !ya.has(x.id))) {
          const title = `Fondos solicitados sin depósito: ${nombre[s.client_id] || "cliente"} ${fmt(s.monto)}`, who = s.enviada_por || "Martina";
          fpr.tareas.push({ cliente: nombre[s.client_id], monto: s.monto, enviada: dmy(s.enviada_at), a: who });
          if (dryRun) continue;
          await rest("tasks", { method: "POST", body: JSON.stringify({ title, who, assignees: [who], client_id: s.client_id, status: "Activo", note: `Solicitud del ${dmy(s.enviada_at)} · ${s.asunto || "Solicitud de fondos"}`, assigned_by: "Oficina" }) });
          await rest("activity_log", { method: "POST", body: JSON.stringify({ user_email: "agente", action: "fondos.solicitud_sin_deposito", table_name: "fund_requests", record_id: s.id, estudio_id: "lea", detail: { title, cliente: nombre[s.client_id], a: who } }) });
        }
      }
    } catch (e) { (fpr as any).error = String((e as Error).message || e); }
    // ── Pagos de comisiones ──
    const com = { pagadas: [] as unknown[], error: null as string | null };
    try {
      const provs = (await todas("proveedores?select=id,rut,nombre")).filter((p) => normRut(p.rut));
      const ruts = new Set(provs.map((p) => normRut(p.rut)));
      const cg = (await todas(`cartola_movimientos?select=id,fecha,monto,monto_conciliado,rut_contraparte,categoria,estado,n_operacion&tipo=eq.cargo&estado=eq.pendiente&fecha=gte.${desde}`))
        .filter((m) => ruts.has(normRut(m.rut_contraparte)) && !(Number(m.monto_conciliado) > 0) && !(concPorMov[m.id] || []).length && (!m.categoria || ["Proveedor", "Comisiones", "Equipo"].includes(m.categoria)));
      if (cg.length) {
        const [ts, aps] = await Promise.all([
          todas(`terceros_pagos?select=id,proveedor_id,billing_id,monto,liquido,retencion,estado,bhe_id,movimiento_id,referencia&proveedor_id=in.${enLista(provs.map((p) => p.id))}`),
          todas("learnings?select=key,value&kind=eq.pago_prov_aporte"),
        ]);
        const ligados = new Set(ts.map((t) => t.movimiento_id).filter(Boolean));
        const aporte: Record<string, number> = {}, conAporte = new Set<string>();
        aps.forEach((l) => { conAporte.add(l.key); try { (JSON.parse(l.value).asig || []).forEach((a: { t: string; monto: number }) => { aporte[a.t] = (aporte[a.t] || 0) + (Number(a.monto) || 0); }); } catch { /* valor ilegible */ } });
        const bids = [...new Set(ts.map((t) => t.billing_id).filter(Boolean))];
        const bs = bids.length ? await todas(`billing?select=id,status,deleted_at&id=in.${enLista(bids)}`) : [];
        const bId: Record<string, any> = Object.fromEntries(bs.map((b) => [b.id, b]));
        for (const p of provs) {
          const libres = cg.filter((m) => normRut(m.rut_contraparte) === normRut(p.rut) && !ligados.has(m.id) && !conAporte.has(m.id));
          if (!libres.length) continue;
          const porPagar = ts.filter((t) => t.proveedor_id === p.id && !(t.billing_id && (!bId[t.billing_id] || bId[t.billing_id].status === "Anulada" || bId[t.billing_id].deleted_at)) && estadoComision(t, bId[t.billing_id]) === "por_pagar")
            .map((t) => ({ ...t, saldo: Math.max(0, pagarT(t) - (aporte[t.id] || 0)) })).filter((t) => t.saldo > 0);
          for (const { mov: m, t } of calcesPagoComision(porPagar, libres)) {
            const monto = Math.abs(Number(m.monto) || 0), fecha = String(m.fecha).slice(0, 10);
            com.pagadas.push({ proveedor: p.nombre, fecha, monto, comision: t.id });
            if (dryRun) continue;
            // Por comisión: si un paso falla se deshace lo hecho y se sigue con las demás.
            let ins: any = null, tTocada = false;
            try {
              ins = await rest("conciliacion", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ movimiento_id: m.id, tipo_destino: "tercero", monto_aplicado: monto, origen: "auto" }) });
              const patch = { estado: "pagado", pagado_at: fecha, movimiento_id: m.id, referencia: `Pagada: ${dmy(fecha).slice(0, 5)} ${fmt(monto)}`, ...(reajusteBHEPago(t, fecha) || {}) };
              await rest(`terceros_pagos?id=eq.${t.id}`, { method: "PATCH", body: JSON.stringify(patch) }); tTocada = true;
              await rest(`cartola_movimientos?id=eq.${m.id}`, { method: "PATCH", body: JSON.stringify({ categoria: m.categoria || "Proveedor", monto_conciliado: monto, estado: "conciliado" }) });
            } catch (e) {
              if (ins?.[0]?.id) await rest(`conciliacion?id=eq.${ins[0].id}`, { method: "DELETE" }).catch(() => null);
              if (tTocada) await rest(`terceros_pagos?id=eq.${t.id}`, { method: "PATCH", body: JSON.stringify({ estado: t.estado, pagado_at: null, movimiento_id: null, referencia: t.referencia ?? null, monto: t.monto, retencion: t.retencion }) }).catch(() => null);
              com.pagadas.pop(); com.error = String((e as Error).message || e); continue;
            }
            await rest("activity_log", { method: "POST", body: JSON.stringify({ user_email: "agente", action: `proveedores.${p.id}.enlace`, table_name: "cartola_movimientos", record_id: m.id, estudio_id: "lea", detail: { title: `Pago del ${dmy(fecha).slice(0, 5)} ↔ 1 pagada (conciliación automática)`, monto, conciliacion: ins?.[0]?.id, comision: t.id } }) }).catch(() => null);
            await rest("activity_log", { method: "POST", body: JSON.stringify({ user_email: "agente", action: "banco.conciliado_auto", table_name: "conciliacion", record_id: ins?.[0]?.id, estudio_id: "lea", detail: { title: `Conciliado automáticamente: pago a ${p.nombre} ${fmt(monto)} del ${dmy(fecha)} → comisión por pagar`, mov: m.id } }) }).catch(() => null);
          }
        }
      }
    } catch (e) { com.error = String((e as Error).message || e); }
    // ── Cargos recurrentes y contadora ──
    const car = { racha: [] as unknown[], contadora: [] as unknown[], backtest: null as unknown, error: null as string | null };
    try {
      const [mbr, provR, intern, cfgC, vals] = await Promise.all([
        todas("miembros?select=rut,paga_con_boleta&rut=not.is.null"), todas("proveedores?select=id,rut,nombre"), todas("clients?select=id&is_internal=eq.true"),
        todas("learnings?select=value&kind=eq.config&key=eq.contadora_rut"), todas("learnings?select=key,value&kind=eq.valores_contadora"),
      ]);
      const interno = intern[0]?.id, rutCont = normRut(cfgC[0]?.value || "");
      const excl = new Set<string>([...mbr.map((x) => normRut(x.rut)), ...provR.map((x) => normRut(x.rut)), ...Object.keys(porRutCli())].filter(Boolean));
      function porRutCli() { const o: Record<string, 1> = {}; Object.values(rutsCli).forEach((rs) => rs.forEach((r) => { o[r] = 1; })); return o; }
      const valores: Record<string, any> = {}; vals.forEach((l) => { try { valores[l.key] = JSON.parse(l.value); } catch { /* ilegible */ } });
      const hace400 = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
      const todosC = (await todas(`cartola_movimientos?select=id,fecha,monto,monto_conciliado,rut_contraparte,estado,es_interno,descripcion&tipo=eq.cargo&rut_contraparte=not.is.null&fecha=gte.${hace400}`)).filter((m) => !m.es_interno);
      const concC = concAll.filter((c) => todosC.some((m) => m.id === c.movimiento_id));
      const gids = [...new Set(concC.map((c) => c.gasto_id).filter(Boolean))];
      const gastos: Record<string, any> = {}; for (let i = 0; i < gids.length; i += 150) (await todas(`expenses?select=id,client_id,category,subcategory,concept,amount&id=in.${enLista(gids.slice(i, i + 150))}`)).forEach((g) => { gastos[g.id] = g; });
      const cPor: Record<string, any[]> = {}; concC.forEach((c) => { (cPor[c.movimiento_id] = cPor[c.movimiento_id] || []).push(c); });
      const clasDe = (id: string) => { const cs = cPor[id] || []; if (cs.length !== 1 || cs[0].tipo_destino !== "gasto") return null; const g = gastos[cs[0].gasto_id]; return g && g.client_id === interno ? `${g.category}›${g.subcategory || ""}` : null; };
      const previosDe = (m: any) => todosC.filter((x) => normRut(x.rut_contraparte) === normRut(m.rut_contraparte) && x.id !== m.id && `${x.fecha}|${x.id}` < `${m.fecha}|${m.id}` && (cPor[x.id] || []).length).map((x) => ({ fecha: x.fecha, monto: x.monto, clas: clasDe(x.id) }));
      const boletas = await todas("boletas_honorarios?select=id,folio,fecha,retencion,emisor_nombre,emisor_rut,proveedor_id");
      // Retención que se descuenta del PPM = la de boletas cuyo costo ya está en bruto (ligadas a una comisión). La de quien recibe su
      // sueldo por boleta (miembros.paga_con_boleta) es parte del costo del PPM. Cualquier otra boleta del mes sin ligar → el PPM lo ve una persona.
      const ligadasBHE = new Set((await todas("terceros_pagos?select=bhe_id&bhe_id=not.is.null")).map((t) => t.bhe_id));
      const sueldoBoleta = new Set(mbr.filter((x) => x.paga_con_boleta).map((x) => normRut(x.rut)));
      const provNom: Record<string, string> = Object.fromEntries(provR.map((p) => [p.id, String(p.nombre || "").split(" ")[0]]));
      const bandBol = await todas("agente_bandeja?select=evidencia,estado&tipo=eq.boleta_honorarios&estado=eq.pendiente");
      const mesAnt = (f: string) => { const [y, mo] = f.slice(0, 7).split("-").map(Number); const d = new Date(Date.UTC(y, mo - 2, 1)); return d.toISOString().slice(0, 7); };
      const repartoDe = (m: any) => {
        const P = mesAnt(String(m.fecha)), v = valores[P]; if (!v) return null;
        const delMesB = boletas.filter((b) => String(b.fecha).slice(0, 7) === P && Number(b.retencion) > 0 && !sueldoBoleta.has(normRut(b.emisor_rut)));
        const sinLigar = delMesB.some((b) => !ligadasBHE.has(b.id));
        const rets = delMesB.filter((b) => ligadasBHE.has(b.id)).map((b) => ({ nombre: provNom[b.proveedor_id] || String(b.emisor_nombre || "").split(" ")[0], folio: b.folio, monto: Number(b.retencion) }));
        const r = repartoContadora(m.monto, v, rets); if (!r) return null;
        // Boleta del mes aún sin registrar (en la Bandeja): su retención no se conoce → el PPM queda para una persona.
        const [yy, mm] = P.split("-"); const pend = bandBol.some((b) => (b.evidencia || []).some((e: { texto?: string }) => new RegExp(`\\d{2}-${mm}-${yy}`).test(String(e.texto || ""))));
        if ((pend || sinLigar) && r.some((p: any) => p.subcategoria === "PPM")) return null;
        return r;
      };
      if (body.backtestCargos) {
        const res = { racha: { igual: 0, distinto: 0, se_abstiene: 0 }, contadora: { igual: 0, distinto: 0, se_abstiene: 0 } }, distintos: unknown[] = [];
        for (const m of todosC.filter((x) => x.estado === "conciliado" && x.fecha >= desde)) {
          const r = normRut(m.rut_contraparte);
          if (r === rutCont) {
            const p = repartoDe(m); if (!p) { res.contadora.se_abstiene++; continue; }
            const real = (cPor[m.id] || []).map((c) => c.tipo_destino === "gasto" ? `${gastos[c.gasto_id]?.subcategory}:${Math.round(c.monto_aplicado)}` : `tercero:${Math.round(c.monto_aplicado)}`).sort().join(",");
            const prop = p.map((x: any) => x.tipo === "gasto" ? `${x.subcategoria}:${x.monto}` : `tercero:${x.monto}`).sort().join(",");
            if (real === prop) res.contadora.igual++; else { res.contadora.distinto++; distintos.push({ fecha: m.fecha, monto: m.monto, real, prop }); }
            continue;
          }
          if (excl.has(r)) continue;
          const k = rachaCargo(previosDe(m), m.monto); if (!k) { res.racha.se_abstiene++; continue; }
          if (k === clasDe(m.id)) res.racha.igual++; else { res.racha.distinto++; distintos.push({ fecha: m.fecha, monto: m.monto, rut: r, real: clasDe(m.id), prop: k }); }
        }
        car.backtest = { ...res, distintos };
      } else if (interno) {
        const pendC = todosC.filter((m) => m.estado === "pendiente" && m.fecha >= desde && !(Number(m.monto_conciliado) > 0) && !(cPor[m.id] || []).length && !concAll.some((c) => c.movimiento_id === m.id));
        for (const m of pendC) {
          const r = normRut(m.rut_contraparte), M = Math.abs(Number(m.monto) || 0), fecha = String(m.fecha).slice(0, 10);
          let partes: any[] | null = null, regla = "";
          if (rutCont && r === rutCont) {
            partes = repartoDe(m); regla = "correo VALORES de la contadora";
            // Nunca dos veces: si ya hay un costo con el mismo concepto del período, queda para una persona.
            // (el PPM con retenciones lleva un paréntesis después del período: se busca por prefijo, no igualdad)
            if (partes) { const ors = partes.filter((p) => p.tipo === "gasto").map((p) => `concept.like.${p.concepto.split(" (")[0]}*`).join(","); const ya = await todas(`expenses?select=id&client_id=eq.${interno}&deleted_at=is.null&or=(${encodeURIComponent(ors)})`); if (ya.length) partes = null; }
            if (partes) car.contadora.push({ fecha, monto: M, partes: partes.map((p) => `${p.subcategoria || p.tipo} ${fmt(p.monto)}`) });
          } else if (!excl.has(r)) {
            const k = rachaCargo(previosDe(m), m.monto);
            if (k) { const [cat, sub] = k.split("›"); partes = [{ tipo: "gasto", categoria: cat, subcategoria: sub || null, monto: M, concepto: String(m.descripcion || "Costo de oficina").slice(0, 200) }]; regla = `racha: los 3 cargos anteriores a este RUT fueron ${cat}${sub ? " › " + sub : ""}`; car.racha.push({ fecha, monto: M, clase: k }); }
          }
          if (!partes || dryRun) continue;
          const nuevas: string[] = [], gNuevos: string[] = [];
          try {
            for (const p of partes) {
              let gid = null;
              if (p.tipo === "gasto") { const g = await rest("expenses", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ client_id: interno, type: "gasto", amount: p.monto, date: fecha, concept: p.concepto, category: p.categoria, subcategory: p.subcategoria, created_by: "agente", paid_by_client: false }) }); gid = g[0].id; gNuevos.push(gid); }
              const c = await rest("conciliacion", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ movimiento_id: m.id, tipo_destino: p.tipo, gasto_id: gid, monto_aplicado: p.monto, origen: "auto" }) }); nuevas.push(c[0].id);
            }
            await rest(`cartola_movimientos?id=eq.${m.id}`, { method: "PATCH", body: JSON.stringify({ estado: "conciliado", monto_conciliado: M, categoria: "Gastos Oficina" }) });
            await rest("activity_log", { method: "POST", body: JSON.stringify({ user_email: "agente", action: "banco.conciliado_auto", table_name: "conciliacion", record_id: nuevas[0], estudio_id: "lea", detail: { title: `Clasificado automáticamente: cargo ${fmt(M)} del ${dmy(fecha)} → ${partes.filter((p) => p.tipo === "gasto").map((p) => `${p.categoria}${p.subcategoria ? " › " + p.subcategoria : ""}`).join(" + ")}`, mov: m.id, regla, conciliacion: nuevas, gastos: gNuevos } }) }).catch(() => null);
          } catch (e) {
            for (const id of nuevas) { try { await rest(`conciliacion?id=eq.${id}`, { method: "DELETE" }); } catch { /* */ } }
            for (const id of gNuevos) { try { await rest(`expenses?id=eq.${id}`, { method: "DELETE" }); } catch { /* */ } }
            car.error = String((e as Error).message || e);
          }
        }
      }
    } catch (e) { car.error = String((e as Error).message || e); }
    // ── Pago de la tarjeta de la oficina ↔ viajes de Uber Business ya registrados ──
    // Cada viaje ya es un gasto (lo crea el agente al llegar el recibo). El pago de la tarjeta se une con esos viajes (los más antiguos
    // sin unir, hasta 70 días antes, sin pasarse del monto) y lo demás del pago queda para repartir por rubro; así el Uber no se suma dos veces.
    const tc = { unidos: [] as unknown[], error: null as string | null };
    try {
      const pagosTC = (await todas(`cartola_movimientos?select=id,fecha,monto,monto_conciliado,descripcion,estado,categoria&tipo=eq.cargo&estado=eq.pendiente&fecha=gte.${desde}`))
        .filter((m) => /pago\s+(de\s+)?tarjeta/i.test(m.descripcion || "") && !(Number(m.monto_conciliado) > 0) && !(concPorMov[m.id] || []).length);
      if (pagosTC.length) {
        const viajes = await todas(`expenses?select=id,date,amount&created_by=eq.Uber%20Business&category=eq.Movilización&deleted_at=is.null&order=date.asc`);
        const unidos = new Set(concAll.filter((c) => c.gasto_id).map((c) => c.gasto_id));
        for (const m of pagosTC.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))) {
          const M = Math.abs(Number(m.monto) || 0), d0 = new Date(new Date(m.fecha).getTime() - 70 * 86400000).toISOString().slice(0, 10);
          // Todos los viajes sin unir de la ventana, o ninguno: un pago chico de la tarjeta (p. ej. $3.676) no se queda con viajes de
          // otro estado de cuenta; si el pago no alcanza a cubrirlos todos, lo reparte una persona.
          const sel = viajes.filter((v) => !unidos.has(v.id) && String(v.date) <= String(m.fecha) && String(v.date) >= d0);
          const sum = sel.reduce((t, v) => t + Number(v.amount), 0);
          if (!sel.length || sum > M) continue;
          sel.forEach((v) => unidos.add(v.id));
          tc.unidos.push({ fecha: m.fecha, pago: M, viajes: sel.length, uber: sum, falta: M - sum });
          if (dryRun) continue;
          const nuevas: string[] = [];
          try {
            for (const v of sel) { const c = await rest("conciliacion", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ movimiento_id: m.id, tipo_destino: "gasto", gasto_id: v.id, monto_aplicado: Number(v.amount), origen: "auto" }) }); nuevas.push(c[0].id); }
            await rest(`cartola_movimientos?id=eq.${m.id}`, { method: "PATCH", body: JSON.stringify({ estado: M - sum <= 0 ? "conciliado" : "parcial", monto_conciliado: sum, categoria: "Gastos Oficina" }) });
          } catch (e) { for (const id of nuevas) await rest(`conciliacion?id=eq.${id}`, { method: "DELETE" }).catch(() => null); tc.unidos.pop(); tc.error = String((e as Error).message || e); continue; }
          await rest("activity_log", { method: "POST", body: JSON.stringify({ user_email: "agente", action: "banco.conciliado_auto", table_name: "conciliacion", record_id: nuevas[0], estudio_id: "lea", detail: { title: `Pago de la tarjeta ${fmt(M)} del ${dmy(m.fecha)}: ${sel.length} viaje${sel.length !== 1 ? "s" : ""} de Uber Business (${fmt(sum)}) ya registrados; falta repartir ${fmt(M - sum)} por rubro (sin volver a sumar Uber)`, mov: m.id, conciliacion: nuevas } }) }).catch(() => null);
        }
      }
    } catch (e) { tc.error = String((e as Error).message || e); }
    // ── Pago a la notaría ↔ su liquidación ──
    const nota = { enlazadas: [] as unknown[], por_confirmar: 0, error: null as string | null };
    try {
      const [liqs, rn] = await Promise.all([
        todas("rendiciones?select=id,created_at,total,movimiento_id,estado_envio,sent_at&tipo=eq.notaria&anulada_at=is.null"),
        todas("learnings?select=key&kind=eq.notaria_rut"),
      ]);
      const rutsNota = new Set(rn.map((x) => x.key));
      const cgN = (await todas(`cartola_movimientos?select=id,tipo,fecha,monto,monto_conciliado,rut_contraparte,estado,es_interno,categoria&tipo=eq.cargo&estado=eq.pendiente&fecha=gte.${desde}&order=fecha.asc`))
        .filter((m) => !m.es_interno && !(concPorMov[m.id] || []).length && (!m.categoria || m.categoria === "Notaría"));
      for (const m of cgN) {
        const r = liqParaCargo(m, liqs, rutsNota);
        if (!r) continue;
        if (!r.auto) { nota.por_confirmar++; continue; }
        const liq = r.liq, monto = Math.abs(Number(m.monto) || 0), fecha = String(m.fecha).slice(0, 10), pagadoAt = `${fecha}T12:00:00Z`;
        nota.enlazadas.push({ fecha, monto, liquidacion: liq.id });
        liq.movimiento_id = m.id;
        if (dryRun) continue;
        // Si un paso falla se deshace lo hecho: la liquidación queda sin pago y el cargo pendiente.
        let pasos = 0;
        try {
          const tom = await rest(`rendiciones?id=eq.${liq.id}&movimiento_id=is.null`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ movimiento_id: m.id }) });
          if (!tom?.length) throw new Error("La liquidación ya tenía un pago enlazado");
          pasos = 1;
          await rest(`cartola_movimientos?id=eq.${m.id}&estado=eq.pendiente`, { method: "PATCH", body: JSON.stringify({ estado: "conciliado", monto_conciliado: monto, categoria: "Notaría" }) }); pasos = 2;
          await rest(`expenses?notaria_render_id=eq.${liq.id}&notaria_liquidado_at=is.null`, { method: "PATCH", body: JSON.stringify({ notaria_liquidado_at: pagadoAt }) });
        } catch (e) {
          if (pasos >= 2) await rest(`cartola_movimientos?id=eq.${m.id}`, { method: "PATCH", body: JSON.stringify({ estado: "pendiente", monto_conciliado: 0, categoria: m.categoria ?? null }) }).catch(() => null);
          if (pasos >= 1) await rest(`rendiciones?id=eq.${liq.id}`, { method: "PATCH", body: JSON.stringify({ movimiento_id: null }) }).catch(() => null);
          nota.enlazadas.pop(); nota.error = String((e as Error).message || e); continue;
        }
        await rest("activity_log", { method: "POST", body: JSON.stringify({ user_email: "agente", action: "banco.notaria_enlazada", table_name: "rendiciones", record_id: liq.id, estudio_id: "lea", detail: { title: `Pago a la notaría ${fmt(monto)} del ${dmy(fecha)} ↔ liquidación del ${dmy(liq.created_at)} (conciliación automática)`, movimiento: m.id, fecha, pagado: monto, liquidacion: liq.total } }) }).catch(() => null);
      }
    } catch (e) { nota.error = String((e as Error).message || e); }
    // ── Facturas de compra del SII ↔ pagos del banco ──
    const compras = { enlazadas: [] as unknown[], error: null as string | null };
    try {
      const [docs, cgC] = await Promise.all([
        todas("sii_compras_docs?select=id,folio,tipo_dte,fecha_emision,emisor_rut,emisor_name,monto,movimiento_id,proveedor_id"),
        todas("cartola_movimientos?select=id,tipo,fecha,monto,rut_contraparte,estado,es_interno&tipo=eq.cargo&rut_contraparte=not.is.null"),
      ]);
      for (const { d, m } of calcesCompraPago(docs, cgC)) {
        const monto = Math.abs(Number(d.monto) || 0);
        compras.enlazadas.push({ folio: d.folio, emisor: d.emisor_name, emision: d.fecha_emision, pago: m.fecha, monto });
        if (dryRun) continue;
        try {
          const ok = await rest(`sii_compras_docs?id=eq.${d.id}&movimiento_id=is.null`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ movimiento_id: m.id }) });
          if (!ok?.length) { compras.enlazadas.pop(); continue; }
        } catch (e) { compras.enlazadas.pop(); compras.error = String((e as Error).message || e); continue; }
        await rest("activity_log", { method: "POST", body: JSON.stringify({ user_email: "agente", action: d.proveedor_id ? `proveedores.${d.proveedor_id}.factura` : "compras.pago_enlazado", table_name: "sii_compras_docs", record_id: d.id, estudio_id: "lea", detail: { title: `Factura de compra N° ${d.folio} de ${d.emisor_name || "proveedor"} ↔ pago del ${dmy(m.fecha)} (conciliación automática)`, monto, movimiento: m.id } }) }).catch(() => null);
      }
    } catch (e) { compras.error = String((e as Error).message || e); }
    return json({ ok: true, enviado: !dryRun, dryRun, conciliados: hechos.length, hechos, dudas, fondos_por_registrar: fpr, pagos_comisiones: com, cargos_recurrentes: car, tarjeta_uber: tc, notaria: nota, compras_sii: compras, nombres_por_rut: nombres });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  } finally {
    if (lockTomado) { try { await rest("procesos_lock?nombre=eq.conciliacion-auto", { method: "DELETE" }); } catch { /* vence solo a los 5 min */ } }
  }
});
