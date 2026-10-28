import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { esDelDominio } from "../_shared/estudio.ts";
import { selectAll } from "../_shared/paginar.js";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cargarEquipo } from "../_shared/equipo.js";
import { notariaPorLiquidar, analisisNotaria } from "../_shared/notariaReglas.js";
import { fgCliente, gastosPorRendirCli } from "../_shared/gastosReglas.js";
import { cuotasSinEmitir, trabajosSinFacturar } from "../_shared/ventasReglas.js";
import { abonosPorIdentificar } from "../_shared/conciliacionReglas.js";

// Correo semanal "Tu semana": el ÚNICO correo recurrente de la semana para cada persona (decisión del 26-10-2026), lunes 08:30.
// Socios: además de lo suyo, notaría, cuotas sin emitir, compras por pagar, abonos por identificar y trabajos sin movimiento
// (reemplaza al resumen del lunes, al análisis de la notaría y a los pendientes del primer lunes, que suma como tarjetas).
// Sobre lo que ELLOS ven/manejan: (1) Gastos sin rendir al cliente; (2) Caja chica por liquidar; (3) Tus tareas;
// (4) sólo Martina: Notaría (OT sin liquidar + correos a notaría sin cerrar). Nada de conciliación (eso es admin).
// (5) Quien es RESPONSABLE de clientes (sus ventas o abogado del cliente, hoy Martín): por cobrar de sus clientes (facturas emitidas con saldo,
//     misma regla que «Por cobrar a mis clientes»), fondos por pedir / gastos por rendir (fgCliente) y sus comisiones (estadoComision). Botones → app.

const GMAIL_USER = Deno.env.get("GMAIL_USER") || "";
const GMAIL_PASS = Deno.env.get("GMAIL_PASS") || "";
const CRON_SECRET = Deno.env.get("TU_SEMANA_SECRET") || Deno.env.get("CRON_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

let EMAIL: Record<string,string> = {};
let NAME_OF_EMAIL: Record<string,string> = {};
let LIMITADOS: string[] = [];
let SOCIOS: string[] = [];
const CAJA_USERS = ["Martín","Martina"];   // quienes manejan caja chica
const NOTARIA_USER = "Martina";
const OFICINA_ID = "055df2ad-fa4f-4293-9dc3-d7ab9a200774";

const toAscii = (s:string) => String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[–—]/g,"-").replace(/[^\x20-\x7E]/g,"");
const qpSafe = (h:string) => String(h||"").replace(/[ \t]+$/gm,"");
const esc = (s:string) => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const fmt = (n:number) => new Intl.NumberFormat("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0}).format(Math.round(n||0));

async function sendMail(to:string, subject:string, html:string){
  const client = new SMTPClient({ connection:{ hostname:"smtp.gmail.com", port:465, tls:true, auth:{ username:GMAIL_USER, password:GMAIL_PASS } } });
  try { await client.send({ from:`Liberona Escala Abogados <${GMAIL_USER}>`, to, subject:toAscii(subject), content:"Ver el contenido en formato HTML.", html:qpSafe(html) }); }
  finally { await client.close(); }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, content-type" } });
  { const eq = await cargarEquipo(SUPABASE_URL, SERVICE_KEY); EMAIL = eq.porNombre; NAME_OF_EMAIL = eq.nombreDe; LIMITADOS = eq.limitados.map((m: { nombre: string }) => m.nombre); SOCIOS = eq.socios.map((m: { nombre: string }) => m.nombre); }   // equipo del estudio (miembros)
  try {
    const body = await req.json().catch(()=>({}));
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    let testTo: string | null = null;
    const esCron = !!CRON_SECRET && body.secret === CRON_SECRET;
    if (esCron) {
      if (body.testTo) testTo = String(body.testTo).toLowerCase().trim();
    } else {
      const auth = req.headers.get("authorization") || "";
      const { data: u } = await sb.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
      const email = (u?.user?.email || "").toLowerCase();
      if (!esDelDominio(email)) return new Response(JSON.stringify({ error:"No autorizado" }), { status:403, headers:{ "Content-Type":"application/json" } });
      testTo = email;
    }

    let scope = "on";
    if (esCron && !testTo) {
      const { data: cfg } = await sb.from("learnings").select("value").eq("kind","config").eq("key","tu_semana").maybeSingle();
      const val = (cfg?.value || "off").trim();
      if (val === "off") return new Response(JSON.stringify({ ok:true, skipped:"apagado" }), { headers:{ "Content-Type":"application/json" } });
      scope = val;
    }
    const soloNombres: string[] | null = (scope && scope !== "on") ? scope.split(/[,;]+/).map(s=>s.trim()).filter(Boolean) : null;
    // El cron corre a las 11:30 y 12:30 UTC: sale solo la corrida de las 08:30 de Chile (verano e invierno).
    if (esCron && !testTo && !body.dryRun && !body.forzar) {
      const hCL = Number(new Intl.DateTimeFormat("en-US", { timeZone:"America/Santiago", hour:"numeric", hourCycle:"h23" }).format(new Date()));
      if (hCL !== 8) return new Response(JSON.stringify({ ok:true, skipped:`hora Chile ${hCL}` }), { headers:{ "Content-Type":"application/json" } });
    }

    // PostgREST corta en 1.000 filas: los gastos se traen por páginas (ya son más de 1.000).
    const fetchAll = async () => {
      let last:any = null;
      for (let att=0; att<4; att++){
        const res = await Promise.all([
          sb.from("clients").select("id,name,abogado_responsable,is_internal"),
          selectAll(()=>sb.from("expenses").select("id,client_id,type,amount,concept,materia,category,created_by,no_descuenta_saldo,client_rendered_at,rendered_at,paid_by_client,notaria_render_id,notaria_liquidado_at,ot_number,date,deleted_at,apertura_id").is("deleted_at",null).order("id")),
          sb.from("petty_cash").select("user_name,amount"),
          sb.from("tasks").select("id,client_id,title,status,due,who,assignees,delegated_to,completed_at"),
          sb.from("rendiciones").select("user_name,tipo,estado_envio,sent_at,created_at,anulada_at"),
          sb.from("sales").select("id,client_id,responsible,status,deleted_at"),
          selectAll(()=>sb.from("billing").select("id,client_id,sale_id,invoice_no,status,amount,paid_amount,issued_at,due,billing_type,deleted_at,created_at,concept").is("deleted_at",null).order("id")),
          sb.from("terceros_pagos").select("id,proveedor_id,billing_id,estado,monto,liquido,factura_numero"),
          sb.from("proveedores").select("id,rut"),
          sb.from("miembros").select("nombre,rut"),
        ]);
        const fallo = res.find((r:any)=> r.error || r.data===null);
        if (!fallo) return res;
        last = fallo.error;
        await new Promise(r=>setTimeout(r, 300*(att+1)));
      }
      throw new Error("No se pudieron cargar los datos: "+(last?.message||"consulta vacía"));
    };
    const [{ data: clients }, { data: expensesRaw }, { data: petty }, { data: tasks }, { data: rendiciones }, { data: sales }, { data: billing }, { data: terceros }, { data: proveedores }, { data: miembros }] = await fetchAll();
    const { data: docsNotaria } = await sb.from("documentos_notaria").select("estado").in("estado", ["por_clasificar", "pendiente_ot"]);
    // Monto de la factura = total del DTE (como montoFactura) y lo abonado = máx(paid_amount, conciliación) (como saldoBill). Solo se leen los XML de las por cobrar.
    const cobrables = (billing||[]).filter((b:any)=> b.invoice_no && ["Pendiente","Vencido"].includes(b.status) && !["reembolso","nota_credito"].includes(b.billing_type));
    const xmlTot: Record<string,number> = {}, aplic: Record<string,number> = {};
    if (cobrables.length) {
      const ids = cobrables.map((b:any)=>b.id);
      for (let i=0; i<ids.length; i+=200) {
        const part = ids.slice(i,i+200);
        const [{ data: xs }, { data: cs }] = await Promise.all([ sb.from("billing").select("id,dte_xml").in("id",part), sb.from("conciliacion").select("factura_id,monto_aplicado").in("factura_id",part) ]);
        (xs||[]).forEach((x:any)=>{ const m=String(x.dte_xml||"").match(/<MntTotal>(\d+)<\/MntTotal>/); if (m) xmlTot[x.id]=Number(m[1]); });
        (cs||[]).forEach((c:any)=>{ aplic[c.factura_id]=(aplic[c.factura_id]||0)+(Number(c.monto_aplicado)||0); });
      }
    }
    const saldoBill = (b:any)=> Math.max(0, (xmlTot[b.id] ?? (Number(b.amount)||0)) - Math.max(Number(b.paid_amount)||0, aplic[b.id]||0));
    const venceBill = (b:any)=>{ if (b.issued_at){ const x=new Date(String(b.issued_at).slice(0,10)+"T00:00:00Z"); x.setUTCDate(x.getUTCDate()+30); return x.toISOString().slice(0,10) } return String(b.due||"").slice(0,10) };
    const nRut = (r:any)=> String(r||"").replace(/[^0-9kK]/g,"").toLowerCase();
    const nTxt = (x:any)=> String(x||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
    const expenses = (expensesRaw||[]).filter((e:any)=> !e.deleted_at);
    const cname = (id:any)=> (clients||[]).find((c:any)=>String(c.id)===String(id))?.name || "Cliente";
    const internos = new Set((clients||[]).filter((c:any)=>c.is_internal).map((c:any)=>String(c.id)));
    const esOficina = (cid:any)=> internos.has(String(cid));

    const hoyCL = new Date().toLocaleDateString("en-CA",{ timeZone:"America/Santiago" });
    const t0 = Date.parse(hoyCL);
    const diasDe = (iso:string)=> iso ? Math.round((t0 - Date.parse(String(iso).slice(0,10))) / 86400000) : null;   // + = pasado
    const daysLeft = (iso:string)=> iso ? Math.round((Date.parse(String(iso).slice(0,10)) - t0) / 86400000) : null;  // + = futuro
    const fDia = (iso:string)=>{ const m = String(iso || "").slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : String(iso || ""); };   // dd-mm-aaaa (fmtFechaDMY)

    const _hoy = new Date(hoyCL+"T00:00:00Z");
    const _dow = (_hoy.getUTCDay()+6)%7;
    const _lun = new Date(_hoy); _lun.setUTCDate(_hoy.getUTCDate()-_dow);
    const _dom = new Date(_lun); _dom.setUTCDate(_lun.getUTCDate()+6);
    const _mLun = _lun.toLocaleDateString("es-CL",{ month:"long", timeZone:"UTC" });
    const _mDom = _dom.toLocaleDateString("es-CL",{ month:"long", timeZone:"UTC" });
    const rango = _mLun===_mDom
      ? `Semana del ${_lun.getUTCDate()} al ${_dom.getUTCDate()} de ${_mDom}`
      : `Semana del ${_lun.getUTCDate()} de ${_mLun} al ${_dom.getUTCDate()} de ${_mDom}`;

    // ── Datos de la oficina para los socios (mismas reglas únicas que el resumen del lunes, el análisis de la notaría y los
    // pendientes del primer lunes, que este correo reemplaza). Solo se cargan si hay un socio entre los destinatarios.
    const primerLunes = Number(hoyCL.slice(8,10)) <= 7;
    const cargarOficina = async () => {
      const lunesISO = _lun.toISOString().slice(0,10), lunesPrev = new Date(_lun.getTime()-7*864e5).toISOString().slice(0,10);
      const [vs, ufs, ne, dec, det, actOk, conc, abs, movs, rutsEq, estRut, conXml, sinProyRaw] = await Promise.all([
        selectAll(()=>sb.from("sales").select("id,client_id,title,status,deleted_at,moneda,amount_uf,amount_clp,cobro_type,cobro_config,area,responsible").order("id")),
        selectAll(()=>sb.from("indicadores").select("fecha,valor").eq("codigo","uf").order("fecha")),
        sb.from("learnings").select("key").eq("kind","cuota_no_emitir"),
        sb.from("learnings").select("key").eq("kind","trabajo_sin_facturar"),
        sb.from("auditoria_hallazgos").select("detector,monto,prueba").in("detector",["trabajo_terminado","trabajo_detenido_saldo"]).is("resuelto_at",null),
        sb.from("learnings").select("key").eq("kind","trabajo_activo_ok"),
        selectAll(()=>sb.from("conciliacion").select("movimiento_id,monto_aplicado,tipo_destino").in("tipo_destino",["factura","anticipo"]).order("id")),
        selectAll(()=>sb.from("cartola_movimientos").select("id,fecha,es_interno").eq("tipo","abono").gte("fecha",lunesPrev).order("id")),
        selectAll(()=>sb.from("cartola_movimientos").select("id,fecha,monto,tipo,cliente_id,estado,categoria,rut_contraparte").eq("tipo","abono").is("cliente_id",null).order("id")),
        sb.from("miembros").select("rut"), sb.from("estudios").select("rut").limit(1),
        selectAll(()=>sb.from("billing").select("id,dte_xml").not("sale_id","is",null).not("invoice_no","is",null).not("dte_xml","is",null).order("id")),
        primerLunes ? selectAll(()=>sb.from("expenses").select("id,client_id,amount").eq("type","gasto").is("sale_id",null).is("deleted_at",null).is("apertura_id",null).eq("no_descuenta_saldo",false).not("client_id","is",null).gte("date","2026-06-01").order("id")) : Promise.resolve({ data: [] }),
      ]);
      const falla = [vs, ufs, conc, abs, movs, conXml, sinProyRaw].find((r:any)=> r.error);
      if (falla) throw new Error("No se pudieron cargar los datos de la oficina: "+((falla as any).error?.message||""));
      const sales2 = vs.data||[];
      const uf: Record<string,number> = {}; (ufs.data||[]).forEach((r:any)=>{ uf[String(r.fecha).slice(0,10)] = Number(r.valor)||0; });
      const ufK = Object.keys(uf).filter(k=>k<=hoyCL).sort(); const ufHoy = ufK.length ? uf[ufK[ufK.length-1]] : 0;
      // El monto de una factura emitida es el del DTE (montoFactura lee MntTotal): se pasa solo esa etiqueta del XML.
      const mnt: Record<string,string> = {}; (conXml.data||[]).forEach((r:any)=>{ const m=String(r.dte_xml||"").match(/<MntTotal>\s*(\d+(?:\.\d+)?)\s*<\/MntTotal>/); if (m) mnt[String(r.id)]=`<MntTotal>${m[1]}</MntTotal>`; });
      const billingV = (billing||[]).map((b:any)=> mnt[String(b.id)] ? { ...b, dte_xml: mnt[String(b.id)] } : b);
      const noEmitir = new Set((ne.data||[]).map((r:any)=>String(r.key)));
      const sinEmitir = cuotasSinEmitir({ billing: billingV, sales: sales2, uf, noEmitir, hasta: hoyCL.slice(0,7)+"-01" });
      const sinFact = primerLunes ? trabajosSinFacturar({ sales: sales2, billing: billingV, uf, ufHoy, hoy: hoyCL, noEmitir, decididos: new Set((dec.data||[]).map((r:any)=>String(r.key))) }) : [];
      // Cobrado la semana pasada (lunes a domingo) a caja: conciliación a factura o anticipo por fecha del depósito, sin internos (como Inicio).
      const abId: Record<string,string> = {}; (abs.data||[]).forEach((m:any)=>{ if (m.es_interno!==true) abId[String(m.id)] = String(m.fecha||"").slice(0,10) });
      const cobradoSemana = (conc.data||[]).reduce((a:number,c:any)=>{ const f=abId[String(c.movimiento_id)]; return (f && f>=lunesPrev && f<lunesISO) ? a+(Number(c.monto_aplicado)||0) : a }, 0);
      const porCobrarOf = cobrables.reduce((a:number,b:any)=> a+saldoBill(b), 0);
      const rutsPropios = new Set(([...(rutsEq.data||[]).map((r:any)=>r.rut), estRut.data?.[0]?.rut].filter(Boolean) as string[]).map((r:string)=> String(r).replace(/[^0-9kK]/g,"").toUpperCase()));
      const abonos = abonosPorIdentificar(movs.data||[], { rutsPropios });
      // Notaría: deuda total con la notaría (regla única analisisNotaria, la misma de la página Notaría).
      const an = analisisNotaria({ expenses, rendiciones: [], hoy: hoyCL, esOficina });
      const nlOf = notariaPorLiquidar(expenses, { esOficina });
      // Trabajos sin movimiento: lo que dejó el auditor nocturno, sin los marcados «Sigue activo».
      const activoOk = new Set((actOk.data||[]).map((r:any)=> String(r.key)));
      const ventaPorId = new Map(sales2.map((v:any)=> [String(v.id), v]));
      const detenidos = (det.data||[]).map((h:any)=> ({ h, v: ventaPorId.get(String(h.prueba?.venta||"")) })).filter((x:any)=> x.v && x.v.status==="Activo" && !activoOk.has(String(x.v.id)));
      const abgVenta = (v:any)=> v.responsible || (clients||[]).find((c:any)=> String(c.id)===String(v.client_id))?.abogado_responsable || "";
      // Gastos sin trabajo (primer lunes): por abogado del cliente; sin abogado, a ambos socios. Oficina fuera.
      const sinProy = (sinProyRaw.data||[]).filter((e:any)=> !esOficina(e.client_id));
      return { sinEmitir, sinFact, cobradoSemana, porCobrarOf, abonos, an, nSinCliente: nlOf.sinCliente.length, montoSinCliente: nlOf.montoSinCliente, detenidos, abgVenta, sinProy };
    };
    const quienesBase = testTo ? [ NAME_OF_EMAIL[testTo] || "Martín" ] : [...SOCIOS, ...LIMITADOS];
    const of = quienesBase.some((n:string)=> SOCIOS.includes(n)) ? await cargarOficina() : null;
    // Lo que no es de un socio va al primero (igual que el resumen del lunes); lo sin abogado, a ambos.
    const deSocio = (abg:string, persona:string, aAmbos=false)=> { const a=nTxt(abg); if (a) return a===nTxt(persona) || (!SOCIOS.some(n=>nTxt(n)===a) && (aAmbos || persona===SOCIOS[0])); return aAmbos || persona===SOCIOS[0]; };
    const datosSocio = (persona:string)=> {
      if (!of || !SOCIOS.includes(persona)) return null;
      const abgCli = (cid:any)=> (clients||[]).find((c:any)=> String(c.id)===String(cid))?.abogado_responsable || "";
      const detenidos = of.detenidos.filter((x:any)=> deSocio(of.abgVenta(x.v), persona));
      const sinProy = of.sinProy.filter((e:any)=> deSocio(abgCli(e.client_id), persona, true));
      const sinFact = of.sinFact.filter((x:any)=> deSocio(x.s.responsible || abgCli(x.s.client_id), persona, true));
      return { detenidos, nSinProy: sinProy.length, montoSinProy: sinProy.reduce((a:number,e:any)=> a+(Number(e.amount)||0), 0), sinFact };
    };

    const taskAssignees = (t:any)=> (t.assignees && t.assignees.length) ? t.assignees : (t.who ? [t.who] : []);
    const enMiLista = (t:any, name:string)=> taskAssignees(t).includes(name) || ((t.delegated_to)||[]).includes(name);

    // Datos por persona
    const datosDe = (persona:string) => {
      // (1) Caja chica (sólo Martín/Martina).
      let caja:any = null;
      if (CAJA_USERS.includes(persona)) {
        const entregado = (petty||[]).filter((p:any)=> p.user_name===persona).reduce((s:number,p:any)=> s+(Number(p.amount)||0), 0);
        const gastado = expenses.filter((e:any)=> e.type==="gasto" && e.created_by===persona && !e.paid_by_client).reduce((s:number,e:any)=> s+(Number(e.amount)||0), 0);
        // Misma regla que la app (gastosPorLiquidarCaja): lo que pagó con su caja y no ha liquidado, notaría incluida si la pagó con su caja.
        const porLiquidar = expenses.filter((e:any)=> e.type==="gasto" && !e.rendered_at && !e.paid_by_client && e.created_by===persona);
        caja = { saldo: entregado-gastado, nLiq: porLiquidar.length, montoLiq: porLiquidar.reduce((s:number,e:any)=> s+(Number(e.amount)||0), 0) };
      }

      // (3) Tareas de la semana.
      const mias = (tasks||[]).filter((t:any)=> t.status!=="Terminado" && enMiLista(t, persona));
      const vencidas = mias.filter((t:any)=>{ const d=daysLeft(t.due); return d!=null && d<0; }).map((t:any)=>({ t, d:daysLeft(t.due) })).sort((a:any,b:any)=> a.d-b.d);
      const semana = mias.filter((t:any)=>{ const d=daysLeft(t.due); return d!=null && d>=0 && d<=7; }).map((t:any)=>({ t, d:daysLeft(t.due) })).sort((a:any,b:any)=> a.d-b.d);

      // (4) Notaría (sólo Martina).
      let notaria:any = null;
      if (persona===NOTARIA_USER) {
        // Martina maneja la notaría: ve TODAS las OT pendientes de liquidar a la notaría (no solo las que cargó ella).
        // Misma definición que la Deuda de la app (notariaPend): incluye las castigadas (no_descuenta_saldo), que igual se le deben a la notaría.
        // Solo lo que puede liquidar: OT con fondos del cliente (o de la oficina) y OT sin cliente. Las que esperan fondos van
        // al aviso de fondos del abogado (regla única notariaPorLiquidar).
        const nl = notariaPorLiquidar(expenses, { esOficina: (cid:string)=> internos.has(String(cid)) });
        // Liquidaciones a la notaría preparadas y aún sin enviar (no cuentan las anuladas ni las marcadas pagadas sin correo).
        const correosSinCerrar = (rendiciones||[]).filter((r:any)=> r.tipo==="notaria" && !r.anulada_at && r.estado_envio==="por_enviar"   /* filas antiguas sin estado = pagadas (misma regla que notaEstado en la app) */);
        // Montos por confirmar con la OT (más de 3 veces lo habitual del acto, regla analisisNotaria) y documentos de la notaría por clasificar.
        const fuera = analisisNotaria({ expenses, rendiciones: [], hoy: hoyCL, esOficina: (cid:string)=> internos.has(String(cid)) }).fuera;
        const nDocs = (docsNotaria||[]).filter((d:any)=> d.estado==="por_clasificar").length, nDocsOt = (docsNotaria||[]).filter((d:any)=> d.estado==="pendiente_ot").length;
        if (nl.pagables.length || nl.sinCliente.length || correosSinCerrar.length || fuera.length || nDocs || nDocsOt) notaria = { nFuera:fuera.length, montoFuera:fuera.reduce((a:number,x:any)=>a+(Number(x.e.amount)||0),0), nDocs, nDocsOt, nOt:nl.pagables.length, montoOt:nl.montoPagables, nSinCli:nl.sinCliente.length, montoSinCli:nl.montoSinCliente, nEsperan:nl.esperan.length, nCorreos:correosSinCerrar.length };
      }
      // (5) Responsable de clientes: sus clientes = los de sus ventas (o abogado del cliente si la venta no tiene responsable).
      let cartera:any = null;
      const yo = nTxt(persona);
      const abo: Record<string,string> = {}; (clients||[]).forEach((c:any)=>{ abo[String(c.id)] = nTxt(c.abogado_responsable) });
      const misVentas = (sales||[]).filter((v:any)=> !v.deleted_at && nTxt(v.responsible || abo[String(v.client_id)]) === yo);
      const misCli = new Set<string>([...misVentas.map((v:any)=>String(v.client_id)), ...(clients||[]).filter((c:any)=>abo[String(c.id)]===yo).map((c:any)=>String(c.id))]);
      (clients||[]).forEach((c:any)=>{ if (c.is_internal) misCli.delete(String(c.id)) });
      if (misCli.size) {
        const bills = cobrables.filter((b:any)=> misCli.has(String(b.client_id)) && saldoBill(b)>0).map((b:any)=>({ b, saldo:saldoBill(b), vence:venceBill(b) })).sort((a:any,b:any)=> a.vence.localeCompare(b.vence));
        // Fondos por pedir: clientes con saldo en contra de $1.000 o más (reglas únicas fgCliente / gastosPorRendirCli de
        // _shared/gastosReglas.js, las de Rendir a clientes). Un cliente con saldo a favor no es un pendiente.
        const fondos = [...misCli].map(cid=>{
          const pr = gastosPorRendirCli(expenses, cid);
          const cidKey = (expenses.find((e:any)=> String(e.client_id)===cid)||{}).client_id ?? cid;
          return { cid, saldo: fgCliente(expenses, cidKey).saldo, nPR: pr.length, montoPR: pr.reduce((s:number,e:any)=> s+(Number(e.amount)||0), 0) };
        }).filter((x:any)=> x.saldo<=-1000).sort((a:any,b:any)=> a.saldo-b.saldo);
        // Comisiones: su ficha de proveedor por el RUT del miembro (miembros.rut = proveedores.rut). Misma regla que estadoComision.
        const mRut = nRut((miembros||[]).find((m:any)=> nTxt(m.nombre)===yo)?.rut);
        const prov = mRut ? (proveedores||[]).find((p:any)=> nRut(p.rut)===mRut) : null;
        let com:any = null;
        if (prov) {
          const byId: Record<string,any> = {}; (billing||[]).forEach((b:any)=>{ byId[b.id]=b });
          const ts = (terceros||[]).filter((t:any)=> String(t.proveedor_id)===String(prov.id)).filter((t:any)=>{ if (!t.billing_id) return true; const b=byId[t.billing_id]; return !!b && b.status!=="Anulada" });
          const est = (t:any)=>{ const b=t.billing_id?byId[t.billing_id]:null; return t.estado==="pagado" ? "pagada" : (t.estado==="por_pagar" || b?.status==="Pagado" || b?.status==="Anticipada") ? "por_pagar" : "por_devengar" };
          const listas = ts.filter((t:any)=> est(t)==="por_pagar" && !t.factura_numero);
          const sujeto = ts.filter((t:any)=> est(t)==="por_devengar");
          com = { nListas: listas.length, liqListas: listas.reduce((s:number,t:any)=> s+(Number(t.liquido ?? t.monto)||0), 0), nSujeto: sujeto.length, montoSujeto: sujeto.reduce((s:number,t:any)=> s+(Number(t.monto)||0), 0) };
        }
        if (bills.length || fondos.length || (com && (com.nListas || com.nSujeto))) cartera = { bills, fondos, com };
      }
      return { caja, vencidas, semana, notaria, cartera, socio: datosSocio(persona) };
    };

    // ── Diseño ──
    // Colores EXACTOS de la paleta C (tokens): accent, text/GRAFITO, muted/AZUL2, done/AZUL3, AZUL4; tealText/tealBg; soonText/soonBg; overdueText/overdueBg.
    const HAIR="#E4E8EB", INK="#3D3D3D", MUT="#537281", FAINT="#99ABB4", NV="#003C50";
    const TEAL="#155E6B", TEALBG="#DFF1F2", AMB="#854F0B", AMBBG="#FFF8E1", RED="#A32D2D", REDBG="#FCEBEB";
    // Formato A (aprobado 25-10-2026): solo resumen en doble columna, una tarjeta por tema con cifra, una línea y su botón.
    // El detalle está en la app; el correo nunca crece a una lista larga.
    const dm = (d:Date)=> `${String(d.getUTCDate()).padStart(2,"0")}-${String(d.getUTCMonth()+1).padStart(2,"0")}`;
    const rangoCorto = `Semana del ${dm(_lun)} al ${dm(_dom)}-${_dom.getUTCFullYear()}`;
    const SOFTBG="#F5F7F9";
    const tile = (tit:string, cifra:string, linea:string, accion:string, ir:string, col=INK)=> `<td valign="top" width="50%" style="padding:5px;"><div style="background:${SOFTBG};border-radius:12px;padding:12px 13px;">`+
      `<div style="font-size:10.5px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:${NV};">${esc(tit)}</div>`+
      `<div style="font-size:20px;font-weight:800;color:${col};margin-top:4px;">${cifra}</div>`+
      `<div style="font-size:11.5px;color:${MUT};margin-top:1px;">${linea}</div>`+
      `<div style="margin-top:7px;"><a href="https://gestion.leabogados.cl/?ir=${ir}" style="font-size:12px;font-weight:700;color:${NV};text-decoration:none;">${esc(accion)} &rarr;</a></div></div></td>`;
    const tarjetas = (d:any)=> {
      const t:string[] = [];
      const nV=d.vencidas.length, nS=d.semana.length;
      if ((nV||nS) && !d.socio) { const fechas=[...new Set(d.semana.map((x:any)=>String(x.t.due||"").slice(0,10)))] as string[];
        t.push(tile("Tareas", String(nV+nS), nV ? `<b style="color:${RED};">${nV} vencida${nV!==1?"s":""}</b>${nS?` · ${nS} esta semana`:""}` : (fechas.length===1 ? `vence${nS!==1?"n":""} el ${fDia(fechas[0])}` : "esta semana"), "Ver tareas", "tareas", nV?RED:INK)); }
      if (d.caja && d.caja.nLiq) t.push(tile("Caja chica", fmt(d.caja.montoLiq), `${d.caja.nLiq} gasto${d.caja.nLiq!==1?"s":""} por liquidar`, "Liquidar", "cajachica"));
      const c=d.cartera;
      if (c && c.bills.length) { const venc=c.bills.filter((x:any)=> x.vence < hoyCL).length;
        t.push(tile("Por cobrar", fmt(c.bills.reduce((a:number,x:any)=>a+x.saldo,0)), venc ? `<b style="color:${RED};">${venc} vencida${venc!==1?"s":""}</b> de ${c.bills.length}` : `${c.bills.length} factura${c.bills.length!==1?"s":""} por vencer`, "Ver cobranza", d.socio?"cobranza":"porcobrar", venc?RED:INK)); }
      if (c && c.com && c.com.nListas) t.push(tile("Comisiones", fmt(c.com.liqListas), `${c.com.nListas} por pagar`, "Registrar boleta", "comisiones"));
      if (d.socio && of) { const a=of.an;
        if (a.pend.length) t.push(tile("Notaría", fmt(a.total), `${a.pend.length} OT por pagar`, "Ver la deuda", "notaria"));
        if (of.sinEmitir.length) t.push(tile("Cuotas sin facturar", String(of.sinEmitir.length), "vencidas", "Revisar", "sinemitir"));
        if (of.abonos.length) t.push(tile("Abonos por identificar", fmt(of.abonos.reduce((s:number,m:any)=> s+(Number(m.monto)||0), 0)), `${of.abonos.length} abono${of.abonos.length!==1?"s":""} sin cliente`, "Identificar", "cobros"));
        if (d.socio.nSinProy) t.push(tile("Gastos sin trabajo", String(d.socio.nSinProy), fmt(d.socio.montoSinProy), "Asignar", "gastos"));
        if (d.socio.sinFact.length) t.push(tile("Trabajos sin facturar", String(d.socio.sinFact.length), "sin factura emitida", "Revisar", "sinfacturar")); }
      if (d.notaria) { const n=d.notaria, nOt=n.nOt;
        if (nOt || n.nCorreos) t.push(tile("Notaría", nOt?`${nOt} OT`:`${n.nCorreos}`, nOt?`${fmt(n.montoOt)} por liquidar`:`correo${n.nCorreos!==1?"s":""} sin cerrar`, "Ver la deuda", "notaria"));
        if (n.nSinCli) t.push(tile("OT sin cliente", String(n.nSinCli), fmt(n.montoSinCli||0), "Asignar cliente", "notariasincliente", AMB));
        if (n.nDocs || n.nDocsOt) t.push(tile("Documentos", String(n.nDocs || n.nDocsOt), n.nDocs ? `por clasificar${n.nDocsOt ? ` · ${n.nDocsOt} esperan su OT` : ""}` : "esperan su OT", "Clasificar", "notaria")); }
      if (!t.length) return "";
      const filas:string[] = []; for (let i=0;i<t.length;i+=2) filas.push(`<tr>${t[i]}${t[i+1]||'<td width="50%"></td>'}</tr>`);
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${filas.join("")}</table>`;
    };

    const btn = (txt:string, href:string)=> `<a href="${href}" style="display:inline-block;font-size:11.5px;font-weight:700;color:${NV};border:1px solid ${HAIR};border-radius:20px;padding:3px 10px;margin:4px 4px 0 0;text-decoration:none;background:#fff;">${esc(txt)}</a>`;
    const listaDetenidos = (d:any)=> {
      if (!d.socio || !d.socio.detenidos.length) return "";
      const APP = "https://gestion.leabogados.cl";
      const filas = d.socio.detenidos.sort((a:any,b:any)=> String(a.h.prueba?.ult||"").localeCompare(String(b.h.prueba?.ult||""))).map((x:any)=> {
        const saldo = x.h.detector==="trabajo_detenido_saldo";
        const der = saldo ? `<td valign="top" style="text-align:right;white-space:nowrap;font-size:13px;font-weight:700;color:${INK};padding-left:8px;">${fmt(Number(x.h.monto)||0)}</td>` : "";
        const botones = saldo ? btn("Ver en Cobranza", `${APP}/?ir=cobranza`) : btn("Cerrar", `${APP}/?cerrartrabajo=${x.v.id}`)+btn("Sigue activo", `${APP}/?sigueactivo=${x.v.id}`);
        return `<tr><td style="padding:9px 5px;border-top:1px solid ${HAIR};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td valign="top"><div style="font-size:13px;font-weight:700;color:${INK};">${esc(cname(x.v.client_id))} — ${esc(x.v.title||"Trabajo")}</div><div style="font-size:11.5px;color:${MUT};margin-top:1px;">sin movimiento desde ${fDia(x.h.prueba?.ult||"")}${saldo?" · con saldo por cobrar":""}</div><div>${botones}</div></td>${der}</tr></table></td></tr>`;
      }).join("");
      return oculta(`Trabajos sin movimiento · ${d.socio.detenidos.length}`, `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${filas}</table>`);
    };
    // Lista oculta: se abre al tocar el título (Apple Mail e iPhone); donde el correo no lo soporta, queda abierta.
    const oculta = (titulo:string, cuerpo:string)=> `<details style="margin:10px 5px 0;"><summary style="cursor:pointer;background:${SOFTBG};border-radius:12px;padding:12px 13px;font-size:10.5px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:${NV};">${titulo} &#9662;</summary>${cuerpo}</details>`;
    const listaFondos = (d:any)=> {
      const f = d.cartera?.fondos||[]; if (!f.length) return "";
      const APP = "https://gestion.leabogados.cl";
      const top = f.slice(0,5).map((x:any,i:number)=> `<tr><td style="padding:9px 5px;${i?`border-top:1px solid ${HAIR};`:""}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td valign="top"><div style="font-size:13px;font-weight:700;color:${INK};">${esc(cname(x.cid))}</div><div>${btn("Solicitar fondos", `${APP}/?pedirfondos=${x.cid}&monto=${Math.round(-x.saldo)}`)}</div></td><td valign="top" style="text-align:right;white-space:nowrap;font-size:13px;font-weight:700;color:${RED};padding-left:8px;">${fmt(-x.saldo)}</td></tr></table></td></tr>`).join("");
      const mas = f.length>5 ? `<tr><td style="padding:9px 5px;border-top:1px solid ${HAIR};font-size:12px;color:${MUT};">y ${f.length-5} cliente${f.length-5!==1?"s":""} más · <a href="${APP}/?ir=${d.socio?"rendir":"porcobrar"}" style="color:${NV};font-weight:700;text-decoration:none;">Ver todos &rarr;</a></td></tr>` : "";
      return oculta(`Fondos por pedir · ${fmt(f.reduce((a:number,x:any)=>a-x.saldo,0))} · ${f.length} cliente${f.length!==1?"s":""}`, `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${top}${mas}</table>`);
    };
    const armar = (nombre:string, d:any) => {
      const grid = tarjetas(d) + listaFondos(d) + listaDetenidos(d);
      const pulso = (d.socio && of) ? `<div style="font-size:12.5px;color:${INK};margin:-8px 0 14px;">Oficina · cobrado la semana pasada <b>${fmt(of.cobradoSemana)}</b> · por cobrar <b>${fmt(of.porCobrarOf)}</b></div>` : "";
      return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;background:#ECEFF1;padding:22px 10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 26px rgba(0,44,64,.09);">
  <div style="background:${NV};padding:20px 28px;text-align:center;"><img src="https://gestion.leabogados.cl/le-logo-blanco.png" alt="Liberona Escala Abogados" height="28" width="184" style="height:28px;width:184px;display:inline-block;border:0;"/></div>
  <div style="padding:24px 17px 18px;">
    <div style="padding:0 5px;"><div style="font-size:18px;color:${INK};font-weight:700;">Hola ${esc(nombre)}</div>
    <div style="font-size:12.5px;color:${MUT};margin:4px 0 16px;">Pendientes · ${esc(rangoCorto)}</div>${pulso}</div>
    ${grid || `<div style="padding:0 5px;font-size:13px;color:${FAINT};">Sin pendientes esta semana.</div>`}
  </div>
  <div style="padding:14px 26px;border-top:1px solid ${HAIR};text-align:center;"><div style="font-size:11px;color:${FAINT};">gestion.leabogados.cl · Liberona Escala Abogados</div></div>
</div></body></html>`;
    };

    const dryRun = !!body.dryRun;
    const sent:any[] = [];
    let nombres = [...quienesBase];
    // Quien no recibe el correo (learnings config tu_semana_excluir, nombres separados por coma): decisión del 28-10-2026.
    const { data: exc } = await sb.from("learnings").select("value").eq("kind","config").eq("key","tu_semana_excluir").maybeSingle();
    const excluidos = String(exc?.value||"").split(/[,;]+/).map(x=>nTxt(x)).filter(Boolean);
    nombres = nombres.filter(n=> !excluidos.includes(nTxt(n)));
    if (soloNombres) nombres = nombres.filter(n=> soloNombres.includes(n));

    for (const nombre of nombres) {
      // enviarA (solo por cron con secreto): redirige el DESTINO a otra bandeja para previsualizar el correo de esta persona.
      const to = (esCron && body.enviarA) ? String(body.enviarA).toLowerCase().trim() : (testTo || EMAIL[nombre]);
      if (!to) continue;
      const d = datosDe(nombre);
      const nC=(d.caja&&d.caja.nLiq)||0, nT=d.vencidas.length+d.semana.length, nN=d.notaria?(d.notaria.nOt+(d.notaria.nSinCli||0)+d.notaria.nCorreos+(d.notaria.nDocs||0)):0;
      const nK=d.cartera?(d.cartera.bills.length+d.cartera.fondos.length+((d.cartera.com&&d.cartera.com.nListas)||0)):0;
      const nS=d.socio?1:0;
      if (!testTo && !nC && !nT && !nN && !nK && !nS) continue;
      const html = armar(nombre, d);
      // Asunto descriptivo y sobrio (regla de lenguaje: sin ganchos ni tono de chat).
      const subject = "Resumen semanal de pendientes";
      if (!dryRun) await sendMail(to, subject, html);
      sent.push({ nombre, to, caja:nC, tareas:nT, notaria:nN, cartera:nK, ...(d.socio?{ detenidos:d.socio.detenidos.length, sinProyecto:d.socio.nSinProy, sinFacturar:d.socio.sinFact.length }:{}), ...(dryRun?{subject,html}:{}) });
    }

    return new Response(JSON.stringify({ ok:true, modo: testTo?"prueba":"cron", dryRun, sent, count:sent.length }), { headers:{ "Content-Type":"application/json", "Access-Control-Allow-Origin":"*" } });
  } catch (err) {
    return new Response(JSON.stringify({ error:(err as Error).message }), { status:500, headers:{ "Content-Type":"application/json", "Access-Control-Allow-Origin":"*" } });
  }
});
