import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Correo semanal "Tu semana" para el equipo limitado (Martín, Martina, Rodrigo).
// Sobre lo que ELLOS ven/manejan: (1) Gastos sin rendir al cliente; (2) Caja chica por liquidar; (3) Tus tareas;
// (4) sólo Martina: Notaría (OT sin liquidar + correos a notaría sin cerrar). Nada de conciliación (eso es admin).
// (5) Quien es RESPONSABLE de clientes (sus ventas o abogado del cliente, hoy Martín): por cobrar de sus clientes (facturas emitidas con saldo,
//     misma regla que «Por cobrar a mis clientes»), fondos por pedir / gastos por rendir (fgCliente) y sus comisiones (estadoComision). Botones → app.

const GMAIL_USER = Deno.env.get("GMAIL_USER") || "";
const GMAIL_PASS = Deno.env.get("GMAIL_PASS") || "";
const CRON_SECRET = Deno.env.get("TU_SEMANA_SECRET") || Deno.env.get("CRON_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const EMAIL: Record<string,string> = { "Cristóbal":"cl@leabogados.cl", "Erasmo":"ee@leabogados.cl", "Martín":"mc@leabogados.cl", "Martina":"mp@leabogados.cl", "Rodrigo":"rd@leabogados.cl" };
const NAME_OF_EMAIL: Record<string,string> = Object.fromEntries(Object.entries(EMAIL).map(([n,e])=>[e,n]));
const LIMITADOS = ["Martín","Martina","Rodrigo"];
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
      if (!email.endsWith("@leabogados.cl")) return new Response(JSON.stringify({ error:"No autorizado" }), { status:403, headers:{ "Content-Type":"application/json" } });
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

    // PostgREST corta en 1.000 filas: los gastos se traen por páginas (ya son más de 1.000).
    const pageAll = async (q:()=>any) => { const out:any[]=[]; for (let from=0; ; from+=1000){ const r=await q().range(from, from+999); if (r.error) return { data:null, error:r.error }; out.push(...(r.data||[])); if (!r.data || r.data.length<1000) break } return { data:out, error:null } };
    const fetchAll = async () => {
      let last:any = null;
      for (let att=0; att<4; att++){
        const res = await Promise.all([
          sb.from("clients").select("id,name,abogado_responsable,is_internal"),
          pageAll(()=>sb.from("expenses").select("id,client_id,type,amount,concept,category,created_by,no_descuenta_saldo,client_rendered_at,rendered_at,paid_by_client,notaria_render_id,notaria_liquidado_at,ot_number,date,deleted_at,apertura_id").is("deleted_at",null).order("id")),
          sb.from("petty_cash").select("user_name,amount"),
          sb.from("tasks").select("id,client_id,title,status,due,who,assignees,delegated_to,completed_at"),
          sb.from("rendiciones").select("user_name,tipo,estado_envio,sent_at,created_at"),
          sb.from("sales").select("id,client_id,responsible,status,deleted_at"),
          pageAll(()=>sb.from("billing").select("id,client_id,sale_id,invoice_no,status,amount,paid_amount,issued_at,due,billing_type,deleted_at").is("deleted_at",null).order("id")),
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

    const taskAssignees = (t:any)=> (t.assignees && t.assignees.length) ? t.assignees : (t.who ? [t.who] : []);
    const enMiLista = (t:any, name:string)=> taskAssignees(t).includes(name) || ((t.delegated_to)||[]).includes(name);

    // Datos por persona
    const datosDe = (persona:string) => {
      // (1) Caja chica (sólo Martín/Martina).
      let caja:any = null;
      if (CAJA_USERS.includes(persona)) {
        const entregado = (petty||[]).filter((p:any)=> p.user_name===persona).reduce((s:number,p:any)=> s+(Number(p.amount)||0), 0);
        const gastado = expenses.filter((e:any)=> e.type==="gasto" && e.created_by===persona && !e.paid_by_client).reduce((s:number,e:any)=> s+(Number(e.amount)||0), 0);
        const porLiquidar = expenses.filter((e:any)=> e.type==="gasto" && !e.rendered_at && !e.paid_by_client && e.created_by===persona && e.category!=="Notaria");
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
        const otPend = expenses.filter((e:any)=> e.type!=="fondo" && e.category==="Notaria" && /\d/.test(String(e.ot_number||"")) && !e.notaria_render_id && !e.notaria_liquidado_at && (Number(e.amount)||0)>1);
        const correosSinCerrar = (rendiciones||[]).filter((r:any)=> r.tipo==="notaria" && (r.estado_envio==="por_enviar" || !r.sent_at));
        if (otPend.length || correosSinCerrar.length) notaria = { nOt:otPend.length, montoOt:otPend.reduce((s:number,e:any)=> s+(Number(e.amount)||0), 0), nCorreos:correosSinCerrar.length };
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
        const fondos = [...misCli].map(cid=>{
          const ex = expenses.filter((e:any)=> String(e.client_id)===cid && !e.apertura_id);
          const fo = ex.filter((e:any)=> e.type==="fondo").reduce((s:number,e:any)=> s+(Number(e.amount)||0), 0);
          const ga = ex.filter((e:any)=> e.type!=="fondo" && !e.no_descuenta_saldo).reduce((s:number,e:any)=> s+(Number(e.amount)||0), 0);
          const pr = ex.filter((e:any)=> e.type==="gasto" && !e.no_descuenta_saldo && !e.client_rendered_at && e.category!=="Apertura");
          return { cid, saldo: fo-ga, nPR: pr.length, montoPR: pr.reduce((s:number,e:any)=> s+(Number(e.amount)||0), 0) };
        }).filter((x:any)=> x.saldo<0 || x.nPR>0).sort((a:any,b:any)=> a.saldo-b.saldo);
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
      return { caja, vencidas, semana, notaria, cartera };
    };

    // ── Diseño ──
    // Colores EXACTOS de la paleta C (tokens): accent, text/GRAFITO, muted/AZUL2, done/AZUL3, AZUL4; tealText/tealBg; soonText/soonBg; overdueText/overdueBg.
    const HAIR="#E4E8EB", INK="#3D3D3D", MUT="#537281", FAINT="#99ABB4", NV="#003C50";
    const TEAL="#155E6B", TEALBG="#DFF1F2", AMB="#854F0B", AMBBG="#FFF8E1", RED="#A32D2D", REDBG="#FCEBEB";
    const sec = (n:string,label:string,color:string)=> `<div style="border-bottom:1px solid ${HAIR};padding-bottom:7px;margin:0 0 10px;"><span style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${color};vertical-align:middle;">${n} · ${label}</span></div>`;
    const cta = (txt:string,color:string,ir:string)=> `<div style="margin-top:12px;"><a href="https://gestion.leabogados.cl/?ir=${ir}" style="display:block;background:${color};color:#fff;text-decoration:none;padding:11px;border-radius:9px;font-size:12.5px;font-weight:700;text-align:center;">${txt} &rarr;</a></div>`;

    const cajaHtml = (d:any) => {
      if (!d.caja || (d.caja.nLiq===0)) return "";
      const c = d.caja;
      return `<div style="padding:16px 26px 4px;">${sec("1","Caja chica por liquidar",TEAL)}`+
        `<div style="font-size:12.5px;color:${MUT};margin:0 0 14px;line-height:1.6;">Tienes gastos de caja chica <b style="color:${INK};">sin liquidar</b>. Liquídalos para <b style="color:${INK};">reponer el fondo</b> y que la caja no se descuadre.</div>`+
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${TEALBG};border-radius:12px;"><tr><td style="padding:14px 16px;"><div style="font-size:12.5px;color:${TEAL};font-weight:700;">${c.nLiq} gasto${c.nLiq!==1?"s":""} sin liquidar</div><div style="font-size:11px;color:${MUT};margin-top:3px;">Saldo en tu caja chica: <b style="color:${INK};">${fmt(c.saldo)}</b></div></td><td align="right" style="padding:14px 16px;white-space:nowrap;"><span style="font-size:16px;font-weight:800;color:${TEAL};">${fmt(c.montoLiq)}</span></td></tr></table>`+
        cta("Liquidar caja chica",TEAL,"cajachica")+`</div>`;
    };

    const tareasHtml = (d:any) => {
      if (!d.vencidas.length && !d.semana.length) return "";
      const pill = (txt:string,bg:string,col:string)=> `<span style="display:inline-block;font-size:10.5px;font-weight:700;color:${col};background:${bg};border-radius:7px;padding:3px 9px;white-space:nowrap;">${esc(txt)}</span>`;
      const tr = (x:any, venc:boolean)=> `<tr><td style="padding:10px 0;border-top:1px solid ${HAIR};"><div style="font-size:13.5px;font-weight:600;color:${INK};line-height:1.4;">${esc(x.t.title||"Tarea")}</div><div style="font-size:11px;color:${MUT};margin-top:2px;">${x.t.client_id?esc(cname(x.t.client_id))+" · ":""}${x.t.due?(venc?"venció":"vence")+" "+fDia(x.t.due):"sin fecha"}</div></td><td align="right" valign="top" style="padding:10px 0 10px 10px;border-top:1px solid ${HAIR};white-space:nowrap;">${venc?pill(x.d===-1?"ayer":`hace ${-x.d} d`,REDBG,RED):pill(x.d===0?"hoy":x.d===1?"mañana":`en ${x.d} d`,AMBBG,AMB)}</td></tr>`;
      const rows = [...d.vencidas.map((x:any)=>tr(x,true)), ...d.semana.map((x:any)=>tr(x,false))].join("");
      const nV=d.vencidas.length, nS=d.semana.length;
      return `<div style="padding:24px 26px 4px;">${sec("2","Tus tareas de la semana",AMB)}`+
        `<div style="font-size:12.5px;color:${MUT};margin:0 0 6px;line-height:1.6;">${nV?`<b style="color:${RED};">${nV} vencida${nV!==1?"s":""}</b>`:""}${nV&&nS?" · ":""}${nS?`${nS} esta semana`:""}.</div>`+
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>`+
        cta("Ver mis tareas",AMB,"tareas")+`</div>`;
    };

    const notariaHtml = (d:any) => {
      if (!d.notaria) return "";
      const n = d.notaria;
      const partes:string[] = [];
      if (n.nOt) partes.push(`<b style="color:${INK};">${n.nOt} OT sin liquidar</b> (${fmt(n.montoOt)})`);
      if (n.nCorreos) partes.push(`<b style="color:${INK};">${n.nCorreos} correo${n.nCorreos!==1?"s":""} a notaría sin cerrar</b>`);
      return `<div style="padding:24px 26px 4px;">${sec("3","Notaría",NV)}`+
        `<div style="font-size:12.5px;color:${MUT};margin:0 0 12px;line-height:1.6;">${partes.join(" · ")}. Liquida las OT a la notaría y cierra los correos pendientes para dejar el ciclo al día.</div>`+
        cta("Ver notaría",NV,"gastos")+`</div>`;
    };

    const filaHtml = (titulo:string, sub:string, monto:string, col:string)=> `<tr><td style="padding:9px 0;border-top:1px solid ${HAIR};"><div style="font-size:13.5px;font-weight:600;color:${INK};line-height:1.4;">${esc(titulo)}</div><div style="font-size:11px;color:${MUT};margin-top:2px;">${sub}</div></td><td align="right" valign="top" style="padding:9px 0 9px 10px;border-top:1px solid ${HAIR};white-space:nowrap;font-size:13.5px;font-weight:800;color:${col};">${monto}</td></tr>`;
    const tabla = (rows:string)=> `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>`;
    const dosBtn = (a:string,b:string,color:string,ir:string)=> `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;"><tr><td width="50%" style="padding-right:4px;"><a href="https://gestion.leabogados.cl/?ir=${ir}" style="display:block;background:${color};color:#fff;text-decoration:none;padding:11px;border-radius:9px;font-size:12.5px;font-weight:700;text-align:center;">${a} &rarr;</a></td><td width="50%" style="padding-left:4px;"><a href="https://gestion.leabogados.cl/?ir=${ir}" style="display:block;background:${color};color:#fff;text-decoration:none;padding:11px;border-radius:9px;font-size:12.5px;font-weight:700;text-align:center;">${b} &rarr;</a></td></tr></table>`;
    const cobrarHtml = (d:any, n:string) => {
      const c=d.cartera; if (!c || !c.bills.length) return "";
      const venc = c.bills.filter((x:any)=> x.vence < hoyCL);
      const rows = c.bills.slice(0,6).map((x:any)=> filaHtml(cname(x.b.client_id), `Factura N° ${esc(String(x.b.invoice_no).replace(/^factura\s*/i,""))} · ${x.vence<hoyCL?`<b style="color:${RED};">vencida desde el ${fDia(x.vence)}</b>`:`vence el ${fDia(x.vence)}`}`, fmt(x.saldo), x.vence<hoyCL?RED:INK)).join("");
      return `<div style="padding:24px 26px 4px;">${sec(n,"Tus clientes: por cobrar",RED)}`+
        `<div style="font-size:12.5px;color:${MUT};margin:0 0 6px;line-height:1.6;">${c.bills.length} factura${c.bills.length!==1?"s":""} por cobrar${venc.length?` · <b style="color:${RED};">${venc.length} vencida${venc.length!==1?"s":""}</b>`:""}.</div>`+
        tabla(rows)+cta("Recordar cobro",RED,"porcobrar")+`</div>`;
    };
    const fondosHtml = (d:any, n:string) => {
      const c=d.cartera; if (!c || !c.fondos.length) return "";
      const rows = c.fondos.slice(0,6).map((x:any)=> filaHtml(cname(x.cid), x.nPR?`${x.nPR} gasto${x.nPR!==1?"s":""} sin rendir · ${fmt(x.montoPR)}`:"sin gastos por rendir", x.saldo<0?"−"+fmt(-x.saldo):fmt(x.saldo), x.saldo<0?RED:INK)).join("");
      return `<div style="padding:24px 26px 4px;">${sec(n,"Fondos por pedir y gastos por rendir",AMB)}`+
        `<div style="font-size:12.5px;color:${MUT};margin:0 0 6px;line-height:1.6;">Rinde a tus clientes y pídeles fondos cuando el saldo quede en contra.</div>`+
        tabla(rows)+dosBtn("Rendir","Pedir fondos",AMB,"porcobrar")+`</div>`;
    };
    const comisionesHtml = (d:any, n:string) => {
      const k=d.cartera?.com; if (!k || (!k.nListas && !k.nSujeto)) return "";
      const txt = k.nListas
        ? `<b style="color:${INK};">${k.nListas} comisi${k.nListas===1?"ón lista":"ones listas"} para cobrar</b> · líquido ${fmt(k.liqListas)}. Carga tu boleta y avisa a la oficina desde la app.`
        : `Nada listo para cobrar todavía. Sujeto a cobro: <b style="color:${INK};">${fmt(k.montoSujeto)}</b> en ${k.nSujeto} cuota${k.nSujeto!==1?"s":""}.`;
      return `<div style="padding:24px 26px 4px;">${sec(n,"Tus comisiones",TEAL)}<div style="font-size:12.5px;color:${MUT};margin:0;line-height:1.6;">${txt}</div>${k.nListas?cta("Cargar mi boleta",TEAL,"comisiones"):""}</div>`;
    };

    const armar = (nombre:string, d:any) => {
      // La rendición al cliente no es tarea del equipo limitado (ellos aportan la información); no se muestra esa sección.
      // Numeración en orden de aparición (cada sección se oculta si no tiene datos).
      let k=0; const num=(html:string)=> html ? html.replace(/>\d+ · /, `>${++k} · `) : "";
      const cH=num(cajaHtml(d)), pH=num(cobrarHtml(d,"0")), fH=num(fondosHtml(d,"0")), mH=num(comisionesHtml(d,"0")), tH=num(tareasHtml(d)), nH=num(notariaHtml(d));
      const algo = cH||pH||fH||mH||tH||nH;
      return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;background:#ECEFF1;padding:22px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 26px rgba(0,44,64,.09);">
  <div style="background:${NV};padding:20px 28px;text-align:center;"><img src="https://gestion.leabogados.cl/le-logo-blanco.png" alt="Liberona Escala Abogados" height="28" width="184" style="height:28px;width:184px;display:inline-block;border:0;"/></div>
  <div style="padding:26px 26px 10px;">
    <div style="font-size:19px;color:${INK};font-weight:800;letter-spacing:-.3px;">Hola, ${esc(nombre)}</div>
    <div style="font-size:12.5px;color:${MUT};margin-top:6px;line-height:1.55;"><span style="text-transform:uppercase;letter-spacing:.7px;font-size:10px;color:${FAINT};font-weight:700;">Tu semana · ${esc(rango)}</span><br>Esto es lo tuyo por cerrar esta semana. Cada tema tiene su acción abajo.</div>
  </div>
  ${cH}${pH}${fH}${mH}${tH}${nH}
  ${!algo?`<div style="padding:8px 26px 20px;font-size:13px;color:${FAINT};">Nada pendiente esta semana. Todo al día.</div>`:`<div style="height:8px;"></div>`}
  <div style="padding:16px 26px;border-top:1px solid ${HAIR};text-align:center;"><div style="font-size:11px;color:${FAINT};">gestion.leabogados.cl · Liberona Escala Abogados</div></div>
</div></body></html>`;
    };

    const dryRun = !!body.dryRun;
    const sent:any[] = [];
    let nombres = testTo ? [ NAME_OF_EMAIL[testTo] || "Martín" ] : [...LIMITADOS];
    if (soloNombres) nombres = nombres.filter(n=> soloNombres.includes(n));

    for (const nombre of nombres) {
      // enviarA (solo por cron con secreto): redirige el DESTINO a otra bandeja para previsualizar el correo de esta persona.
      const to = (esCron && body.enviarA) ? String(body.enviarA).toLowerCase().trim() : (testTo || EMAIL[nombre]);
      if (!to) continue;
      const d = datosDe(nombre);
      const nC=(d.caja&&d.caja.nLiq)||0, nT=d.vencidas.length+d.semana.length, nN=d.notaria?(d.notaria.nOt+d.notaria.nCorreos):0;
      const nK=d.cartera?(d.cartera.bills.length+d.cartera.fondos.length+((d.cartera.com&&d.cartera.com.nListas)||0)):0;
      if (!testTo && !nC && !nT && !nN && !nK) continue;
      const html = armar(nombre, d);
      // Asunto que invita a mirar, no castigador (sin recuento de "vencidas").
      const subject = "Tu semana en 2 minutos";
      if (!dryRun) await sendMail(to, subject, html);
      sent.push({ nombre, to, caja:nC, tareas:nT, notaria:nN, cartera:nK, ...(dryRun?{subject,html}:{}) });
    }

    return new Response(JSON.stringify({ ok:true, modo: testTo?"prueba":"cron", dryRun, sent, count:sent.length }), { headers:{ "Content-Type":"application/json", "Access-Control-Allow-Origin":"*" } });
  } catch (err) {
    return new Response(JSON.stringify({ error:(err as Error).message }), { status:500, headers:{ "Content-Type":"application/json", "Access-Control-Allow-Origin":"*" } });
  }
});
