import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Correo semanal "Tu semana" para el equipo limitado (Martín, Martina, Rodrigo).
// Sobre lo que ELLOS ven/manejan: (1) Gastos sin rendir al cliente; (2) Caja chica por liquidar; (3) Tus tareas;
// (4) sólo Martina: Notaría (OT sin liquidar + correos a notaría sin cerrar). Nada de conciliación/cobros (eso es admin).

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

const toAscii = (s:string) => String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[–—]/g,"-").replace(/[^\x20-\x7E]/g,"");
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

    const fetchAll = async () => {
      let last:any = null;
      for (let att=0; att<4; att++){
        const res = await Promise.all([
          sb.from("clients").select("id,name"),
          sb.from("expenses").select("id,client_id,type,amount,concept,category,created_by,no_descuenta_saldo,client_rendered_at,rendered_at,paid_by_client,notaria_render_id,notaria_liquidado_at,ot_number,date,deleted_at"),
          sb.from("petty_cash").select("user_name,amount"),
          sb.from("tasks").select("id,client_id,title,status,due,who,assignees,delegated_to,completed_at"),
          sb.from("rendiciones").select("user_name,tipo,estado_envio,sent_at,created_at"),
        ]);
        const fallo = res.find((r:any)=> r.error || r.data===null);
        if (!fallo) return res;
        last = fallo.error;
        await new Promise(r=>setTimeout(r, 300*(att+1)));
      }
      throw new Error("No se pudieron cargar los datos: "+(last?.message||"consulta vacía"));
    };
    const [{ data: clients }, { data: expensesRaw }, { data: petty }, { data: tasks }, { data: rendiciones }] = await fetchAll();
    const expenses = (expensesRaw||[]).filter((e:any)=> !e.deleted_at);
    const cname = (id:any)=> (clients||[]).find((c:any)=>String(c.id)===String(id))?.name || "Cliente";

    const hoyCL = new Date().toLocaleDateString("en-CA",{ timeZone:"America/Santiago" });
    const t0 = Date.parse(hoyCL);
    const diasDe = (iso:string)=> iso ? Math.round((t0 - Date.parse(String(iso).slice(0,10))) / 86400000) : null;   // + = pasado
    const daysLeft = (iso:string)=> iso ? Math.round((Date.parse(String(iso).slice(0,10)) - t0) / 86400000) : null;  // + = futuro
    const fDia = (iso:string)=>{ try { return new Date(String(iso).slice(0,10)+"T00:00:00").toLocaleDateString("es-CL",{ day:"numeric", month:"short" }); } catch { return String(iso); } };

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
      // (1) Gastos sin rendir al cliente (por persona), agrupados por cliente.
      const sinRendir = expenses.filter((e:any)=> e.type==="gasto" && !e.no_descuenta_saldo && !e.client_rendered_at && e.created_by===persona && e.client_id && String(e.client_id)!==OFICINA_ID);
      const porCli: Record<string, any> = {};
      sinRendir.forEach((e:any)=>{ const k=String(e.client_id); if(!porCli[k]) porCli[k]={cli:cname(e.client_id), monto:0, n:0, oldest:e.date||""}; porCli[k].monto+=(Number(e.amount)||0); porCli[k].n++; if((e.date||"")&&(!porCli[k].oldest||e.date<porCli[k].oldest)) porCli[k].oldest=e.date; });
      const gastos = Object.values(porCli).map((g:any)=>({ ...g, dias:diasDe(g.oldest) })).sort((a:any,b:any)=> b.monto-a.monto);
      const gastosTot = gastos.reduce((s:number,g:any)=> s+g.monto, 0);

      // (2) Caja chica (sólo Martín/Martina).
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
        const otPend = expenses.filter((e:any)=> e.category==="Notaria" && !e.notaria_render_id && !e.notaria_liquidado_at && (Number(e.amount)||0)>1 && !e.no_descuenta_saldo);
        const correosSinCerrar = (rendiciones||[]).filter((r:any)=> r.tipo==="notaria" && (r.estado_envio==="por_enviar" || !r.sent_at));
        if (otPend.length || correosSinCerrar.length) notaria = { nOt:otPend.length, montoOt:otPend.reduce((s:number,e:any)=> s+(Number(e.amount)||0), 0), nCorreos:correosSinCerrar.length };
      }
      return { gastos, gastosTot, caja, vencidas, semana, notaria };
    };

    // ── Diseño ──
    const HAIR="#EAEEF0", INK="#1F2A30", MUT="#66787F", FAINT="#9DAEB4", NV="#003C50";
    const GRN="#147D5C", GRNBG="#E7F5EE", TEAL="#0E7C86", TEALBG="#E2F1F2", AMB="#9A6410", AMBBG="#FAF0DA", RED="#C0403E", REDBG="#FBECEB";
    const sec = (n:string,label:string,color:string)=> `<div style="border-bottom:1px solid ${HAIR};padding-bottom:7px;margin:0 0 10px;"><span style="display:inline-block;width:3px;height:11px;background:${color};border-radius:2px;vertical-align:middle;margin-right:8px;"></span><span style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${color};vertical-align:middle;">${n} · ${label}</span></div>`;
    const cta = (txt:string,color:string,ir:string)=> `<div style="margin-top:12px;"><a href="https://gestion.leabogados.cl/?ir=${ir}" style="display:block;background:${color};color:#fff;text-decoration:none;padding:11px;border-radius:9px;font-size:12.5px;font-weight:700;text-align:center;">${txt} &rarr;</a></div>`;
    const row2 = (izq:string, sub:string, der:string, first:boolean, derColor:string)=> `<tr><td style="padding:11px 0;${first?"":`border-top:1px solid ${HAIR};`}"><div style="font-size:14px;font-weight:700;color:${INK};">${esc(izq)}</div>${sub?`<div style="font-size:11px;color:${MUT};margin-top:3px;line-height:1.4;">${sub}</div>`:""}</td><td align="right" valign="top" style="padding:11px 0;${first?"":`border-top:1px solid ${HAIR};`}white-space:nowrap;"><span style="font-size:14px;font-weight:800;color:${derColor};">${esc(der)}</span></td></tr>`;

    const gastosHtml = (d:any) => {
      if (!d.gastos.length) return "";
      const rows = d.gastos.slice(0,6).map((g:any,i:number)=> row2(g.cli, `${g.n} gasto${g.n!==1?"s":""}${g.dias!=null&&g.dias>0?` · el más antiguo hace ${g.dias} días`:""}`, fmt(g.monto), i===0, GRN)).join("");
      const mas = d.gastos.length>6 ? `<div style="font-size:11px;color:${FAINT};margin-top:9px;">y ${d.gastos.length-6} cliente(s) más.</div>` : "";
      return `<div style="padding:16px 26px 4px;">${sec("1","Gastos sin rendir",GRN)}`+
        `<div style="font-size:12.5px;color:${MUT};margin:0 0 14px;line-height:1.6;">Estos son gastos que <b style="color:${INK};">pusiste tú por un cliente</b> y que <b style="color:${INK};">todavía no se le han rendido</b>. Mientras no se rindan, la oficina no se los cobra al cliente. Ríndelos para recuperar esa plata.</div>`+
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>${mas}`+
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${GRNBG};border-radius:12px;margin-top:13px;"><tr><td style="padding:13px 16px;font-size:12.5px;color:${GRN};font-weight:600;">${d.gastos.length} cliente${d.gastos.length!==1?"s":""} por rendir</td><td align="right" style="padding:13px 16px;white-space:nowrap;"><span style="font-size:10.5px;color:${MUT};text-transform:uppercase;letter-spacing:.6px;">Sin rendir</span> <span style="font-size:16px;font-weight:800;color:${GRN};margin-left:6px;">${fmt(d.gastosTot)}</span></td></tr></table>`+
        cta("Rendir a cliente",GRN,"gastos")+`</div>`;
    };

    const cajaHtml = (d:any) => {
      if (!d.caja || (d.caja.nLiq===0)) return "";
      const c = d.caja;
      return `<div style="padding:24px 26px 4px;">${sec("2","Caja chica por liquidar",TEAL)}`+
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
      return `<div style="padding:24px 26px 4px;">${sec("3","Tus tareas de la semana",AMB)}`+
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
      return `<div style="padding:24px 26px 4px;">${sec("4","Notaría",NV)}`+
        `<div style="font-size:12.5px;color:${MUT};margin:0 0 12px;line-height:1.6;">${partes.join(" · ")}. Liquida las OT a la notaría y cierra los correos pendientes para dejar el ciclo al día.</div>`+
        cta("Ver notaría",NV,"gastos")+`</div>`;
    };

    const armar = (nombre:string, d:any) => {
      const gH=gastosHtml(d), cH=cajaHtml(d), tH=tareasHtml(d), nH=notariaHtml(d);
      const algo = gH||cH||tH||nH;
      return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;background:#ECEFF1;padding:22px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 26px rgba(0,44,64,.09);">
  <div style="background:${NV};padding:20px 28px;text-align:center;"><img src="https://gestion.leabogados.cl/le-logo-blanco.png" alt="Liberona Escala Abogados" height="28" width="184" style="height:28px;width:184px;display:inline-block;border:0;"/></div>
  <div style="padding:26px 26px 10px;">
    <div style="font-size:19px;color:${INK};font-weight:800;letter-spacing:-.3px;">Hola, ${esc(nombre)}</div>
    <div style="font-size:12.5px;color:${MUT};margin-top:6px;line-height:1.55;"><span style="text-transform:uppercase;letter-spacing:.7px;font-size:10px;color:${FAINT};font-weight:700;">Tu semana · ${esc(rango)}</span><br>Esto es lo tuyo por cerrar esta semana. Cada tema tiene su acción abajo.</div>
  </div>
  ${gH}${cH}${tH}${nH}
  ${!algo?`<div style="padding:8px 26px 20px;font-size:13px;color:${FAINT};">Nada pendiente esta semana. Todo al día.</div>`:`<div style="height:8px;"></div>`}
  <div style="padding:16px 26px;border-top:1px solid ${HAIR};text-align:center;"><div style="font-size:11px;color:${FAINT};">gestion.leabogados.cl · Liberona Escala Abogados</div></div>
</div></body></html>`;
    };

    const dryRun = !!body.dryRun;
    const sent:any[] = [];
    let nombres = testTo ? [ NAME_OF_EMAIL[testTo] || "Martín" ] : [...LIMITADOS];
    if (soloNombres) nombres = nombres.filter(n=> soloNombres.includes(n));

    for (const nombre of nombres) {
      const to = testTo || EMAIL[nombre];
      if (!to) continue;
      const d = datosDe(nombre);
      const nG=d.gastos.length, nC=(d.caja&&d.caja.nLiq)||0, nT=d.vencidas.length+d.semana.length, nN=d.notaria?(d.notaria.nOt+d.notaria.nCorreos):0;
      if (!testTo && !nG && !nC && !nT && !nN) continue;
      const html = armar(nombre, d);
      const partes:string[] = [];
      if (nG) partes.push(`${nG} por rendir`);
      if (nC) partes.push(`caja chica`);
      if (d.vencidas.length) partes.push(`${d.vencidas.length} tarea${d.vencidas.length!==1?"s":""} vencida${d.vencidas.length!==1?"s":""}`);
      const subject = partes.length ? `Tu semana · ${partes.slice(0,2).join(" · ")}` : `Tu semana`;
      if (!dryRun) await sendMail(to, subject, html);
      sent.push({ nombre, to, gastos:nG, caja:nC, tareas:nT, notaria:nN, ...(dryRun?{subject,html}:{}) });
    }

    return new Response(JSON.stringify({ ok:true, modo: testTo?"prueba":"cron", dryRun, sent, count:sent.length }), { headers:{ "Content-Type":"application/json", "Access-Control-Allow-Origin":"*" } });
  } catch (err) {
    return new Response(JSON.stringify({ error:(err as Error).message }), { status:500, headers:{ "Content-Type":"application/json", "Access-Control-Allow-Origin":"*" } });
  }
});
