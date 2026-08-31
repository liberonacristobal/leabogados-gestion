// notaria-semanal — digest semanal por abogado responsable de la notaría por cobrar.
// COBRABLE NETO PRIMERO: lidera con lo que el cliente realmente debe (saldo negativo, tras
// aplicar su fondo/anticipo). Las OT cubiertas por fondo van como "por rendir" (backlog),
// no como cobro. No sobredimensiona. Espeja fgCliente (saldo=fondos-gastos) y gastosPorRendir.
//
// Excluye el cliente interno "oficina". Fechas de OT en bloque día-grande.
//
// Auth/disparo (calco cartera-semanal): cron con secreto (respeta interruptor learnings config
// 'notaria_semanal'); body.testTo=correo → prueba a uno; JWT @leabogados.cl → prueba a sí mismo;
// body.dryRun=true → arma y devuelve, no envía.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GMAIL_USER = Deno.env.get("GMAIL_USER") || "";
const GMAIL_PASS = Deno.env.get("GMAIL_PASS") || "";
const CRON_SECRET = Deno.env.get("NOTARIA_SEMANAL_SECRET") || Deno.env.get("CRON_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const OFICINA_ID = "055df2ad-fa4f-4293-9dc3-d7ab9a200774";   // cliente interno "Liberona Escala Abogados"

const EMAIL_DE: Record<string,string> = { "Cristóbal":"cl@leabogados.cl", "Erasmo":"ee@leabogados.cl", "Martín":"mc@leabogados.cl", "Martina":"mp@leabogados.cl", "Rodrigo":"rd@leabogados.cl" };
const norm = (s:string) => String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().trim();
const NOMBRE_DE_EMAIL: Record<string,string> = Object.fromEntries(Object.entries(EMAIL_DE).map(([n,e])=>[e,n]));

const toAscii = (s:string) => String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[–—]/g,"-").replace(/[^\x20-\x7E]/g,"");
const qpSafe = (h:string) => String(h||"").replace(/[ \t]+$/gm,"");
const esc = (s:string) => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const fmt = (n:number) => new Intl.NumberFormat("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0}).format(Math.round(n||0));

async function sendMail(to:string, subject:string, html:string){
  const client = new SMTPClient({ connection:{ hostname:"smtp.gmail.com", port:465, tls:true, auth:{ username:GMAIL_USER, password:GMAIL_PASS } } });
  try { await client.send({ from:`Liberona Escala Abogados - Notaría <${GMAIL_USER}>`, to, subject:toAscii(subject), content:"Ver el contenido en formato HTML.", html:qpSafe(html) }); }
  finally { await client.close(); }
}

const MES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, content-type" } });
  try {
    const body = await req.json().catch(()=>({}));
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    let testTo: string | null = null;
    const esCron = !!CRON_SECRET && body.secret === CRON_SECRET;
    if (esCron) { if (body.testTo) testTo = String(body.testTo).toLowerCase().trim(); }
    else {
      const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      const { data: u } = await sb.auth.getUser(jwt);
      const email = (u?.user?.email || "").toLowerCase();
      if (!email.endsWith("@leabogados.cl")) return new Response(JSON.stringify({ error:"No autorizado" }), { status:403, headers:{ "Content-Type":"application/json" } });
      testTo = email;
    }
    const dryRun = !!body.dryRun;

    let scope = "on";
    if (esCron && !testTo && !dryRun) {
      const { data: cfg } = await sb.from("learnings").select("value").eq("kind","config").eq("key","notaria_semanal").maybeSingle();
      const val = (cfg?.value || "off").trim();
      if (val === "off") return new Response(JSON.stringify({ ok:true, skipped:"apagado" }), { headers:{ "Content-Type":"application/json" } });
      scope = val;
    }
    const soloResp: string[] | null = (scope && scope !== "on") ? scope.split(/[,;]+/).map(s=>norm(s)).filter(Boolean) : null;

    // Todos los gastos vivos (para saldo por cliente) + clientes.
    const fetchAll = async () => {
      let last:any = null;
      for (let att=0; att<4; att++){
        const res = await Promise.all([
          sb.from("expenses").select("id,client_id,type,amount,no_descuenta_saldo,notaria_liquidado_at,client_rendered_at,rendered_at,ot_number,category,subcategory,materia,date").is("deleted_at",null),
          sb.from("clients").select("id,name,abogado_responsable"),
        ]);
        const fallo = res.find((r:any)=> r.error || r.data===null);
        if (!fallo) return res;
        last = fallo.error; await new Promise(r=>setTimeout(r, 300*(att+1)));
      }
      throw new Error("No se pudieron cargar los datos: "+(last?.message||"consulta vacía"));
    };
    const [{ data: exps }, { data: clients }] = await fetchAll();
    const cli = new Map((clients||[]).map((c:any)=>[String(c.id), c]));

    const hoyCL = new Date().toLocaleDateString("en-CA",{ timeZone:"America/Santiago" });
    const t0 = Date.parse(hoyCL);
    const diasDe = (iso:string)=> iso ? Math.round((t0 - Date.parse(String(iso).slice(0,10))) / 86400000) : 0;
    const fDia = (iso:string)=>{ const d=new Date(String(iso).slice(0,10)+"T00:00:00"); return `${d.getUTCDate()} ${MES[d.getUTCMonth()]}`; };
    const mesAno = new Date(hoyCL+"T00:00:00Z").toLocaleDateString("es-CL",{ month:"long", year:"numeric", timeZone:"UTC" });

    // Saldo por cliente (fgCliente): saldo = fondos - gastos que descuentan.
    const bal: Record<string,{fondos:number,gastos:number}> = {};
    for (const e of (exps||[])) {
      const id = String(e.client_id||""); if (!id) continue;
      const b = bal[id] || (bal[id]={fondos:0,gastos:0});
      if (e.type==="fondo") b.fondos += Number(e.amount)||0;
      else if (e.no_descuenta_saldo !== true) b.gastos += Number(e.amount)||0;
    }
    const saldoDe = (id:string)=> { const b=bal[id]; return b ? b.fondos-b.gastos : 0; };

    // OT de notaría por rendir (gate: liquidada a notaría +30d, sin rendir al cliente, no histórico).
    const notaByClient: Record<string, any[]> = {};
    for (const e of (exps||[])) {
      if (e.type!=="gasto" || !e.notaria_liquidado_at || e.client_rendered_at || e.rendered_at || e.no_descuenta_saldo===true) continue;
      if (diasDe(e.notaria_liquidado_at) < 30) continue;
      const id = String(e.client_id||""); if (!id || id===OFICINA_ID) continue;
      (notaByClient[id]=notaByClient[id]||[]).push(e);
    }

    // Armar filas por cliente con su clasificación.
    type Row = { id:string, name:string, resp:string|null, ots:any[], notaTotal:number, saldo:number, netDebt:number, cobrable:number };
    const rows: Row[] = [];
    for (const [id, ots] of Object.entries(notaByClient)) {
      const c = cli.get(id); if (!c) continue;
      const notaTotal = ots.reduce((s:number,e:any)=>s+(Number(e.amount)||0),0);
      const saldo = saldoDe(id);
      const netDebt = Math.max(0, -saldo);
      const cobrable = Math.min(notaTotal, netDebt);   // cobro de notaría atribuible al cliente
      rows.push({ id, name:c.name||"(sin nombre)", resp:(c.abogado_responsable||"").trim()||null, ots, notaTotal, saldo, netDebt, cobrable });
    }

    // ── Diseño (paleta C, email-safe) ──
    const HAIR="#EAEEF0", INK="#1F2A30", MUT="#66787F", FAINT="#9DAEB4", NV="#003C50";
    const GRN="#147D5C", GRNBG="#E7F5EE", RED="#C0403E", REDBG="#FBECEB", AMB="#9A6410", AMBBG="#FAF0DA", SOFT="#F5F7F8";
    const gap=(h:number)=>`<div style="height:${h}px;line-height:${h}px;font-size:1px;">&nbsp;</div>`;
    const sec=(label:string,color:string)=>`<div style="border-bottom:1px solid ${HAIR};padding-bottom:7px;margin:0 0 12px;"><span style="display:inline-block;width:3px;height:11px;background:${color};border-radius:2px;vertical-align:middle;margin-right:8px;"></span><span style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${color};vertical-align:middle;">${label}</span></div>`;
    const agingCol=(d:number)=> d>=90?RED:d>=60?AMB:MUT;

    // Fila de OT con bloque de fecha día-grande a la izquierda.
    const filaOT=(e:any,first:boolean)=>{
      const d=diasDe(e.notaria_liquidado_at); const col=agingCol(d);
      const dd = e.date ? new Date(String(e.date).slice(0,10)+"T00:00:00") : null;
      const dnum = dd? `${dd.getUTCDate()}` : "s/f"; const dmes = dd? `${MES[dd.getUTCMonth()]} ${dd.getUTCFullYear()}` : "";
      const ident = e.ot_number ? `OT ${esc(e.ot_number)}` : "OT sin número";
      const identCol = e.ot_number ? INK : MUT;
      const cat = (e.category && String(e.category).toLowerCase()!=="notaria") ? `<span style="display:inline-block;font-size:9px;font-weight:700;color:${MUT};background:${SOFT};border:1px solid ${HAIR};border-radius:4px;padding:1px 5px;margin-left:6px;vertical-align:middle;">${esc(e.category)}</span>` : "";
      const bt = first?"":`border-top:1px solid ${HAIR};`;
      return `<tr>
        <td valign="top" width="50" style="padding:10px 0;${bt}"><div style="font-size:18px;font-weight:800;color:${INK};line-height:1;">${dnum}</div><div style="font-size:9.5px;color:${FAINT};text-transform:uppercase;letter-spacing:.4px;margin-top:2px;">${dmes}</div></td>
        <td valign="top" style="padding:10px 0 10px 12px;${bt}"><div style="font-size:13.5px;font-weight:600;color:${identCol};line-height:1.3;">${ident}${cat}</div><div style="font-size:11px;color:${MUT};margin-top:3px;">Pagada ${fDia(e.notaria_liquidado_at)} · <span style="color:${col};font-weight:600;">${d} días</span></div></td>
        <td valign="top" align="right" style="padding:10px 0 10px 8px;${bt}white-space:nowrap;"><span style="font-size:13.5px;font-weight:700;color:${INK};">${esc(fmt(Number(e.amount)||0))}</span></td>
      </tr>`;
    };

    // Tarjeta de cliente que DEBE.
    const cardDebtor=(r:Row)=>{
      const ots=[...r.ots].sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
      const filas=ots.map((e,i)=>filaOT(e,i===0)).join("");
      const cubre = r.notaTotal - r.cobrable;
      const nota = cubre>0
        ? `${r.ots.length} OT de notaría · ${fmt(r.notaTotal)} <span style="color:${FAINT};">(fondo cubre ${fmt(cubre)})</span>`
        : `${r.ots.length} OT de notaría · ${fmt(r.notaTotal)}`;
      return `<div style="margin-bottom:20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font-size:15.5px;font-weight:800;color:${INK};letter-spacing:-.1px;">${esc(r.name)}</td>
          <td align="right" style="white-space:nowrap;"><span style="display:inline-block;font-size:11px;font-weight:800;color:${RED};background:${REDBG};border-radius:999px;padding:3px 11px;">debe ${esc(fmt(r.netDebt))}</span></td>
        </tr></table>
        <div style="font-size:11.5px;color:${MUT};margin:5px 0 2px;">${nota}</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${filas}</table>
      </div>`;
    };

    // Fila compacta de cliente CUBIERTO (por rendir, no urgente).
    const rowCovered=(r:Row,first:boolean)=>{
      const bt=first?"":`border-top:1px solid ${HAIR};`;
      return `<tr>
        <td style="padding:10px 0;${bt}font-size:13.5px;font-weight:600;color:${INK};">${esc(r.name)}<div style="font-size:11px;color:${FAINT};font-weight:400;margin-top:1px;">${r.ots.length} OT · fondo a favor ${fmt(r.saldo)}</div></td>
        <td align="right" style="padding:10px 0;${bt}white-space:nowrap;"><span style="font-size:13.5px;font-weight:700;color:${MUT};">${esc(fmt(r.notaTotal))}</span><div style="font-size:9.5px;color:${GRN};font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-top:2px;">cubierto</div></td>
      </tr>`;
    };

    const armarHtml=(nombre:string, mine:Row[])=>{
      const deben = mine.filter(r=>r.saldo<0).sort((a,b)=>b.cobrable-a.cobrable);
      const cubiertos = mine.filter(r=>r.saldo>=0).sort((a,b)=>b.notaTotal-a.notaTotal);
      const totalCobrable = deben.reduce((s,r)=>s+r.cobrable,0);
      const totalRendir = cubiertos.reduce((s,r)=>s+r.notaTotal,0);
      const nOtRendir = cubiertos.reduce((s,r)=>s+r.ots.length,0);

      const heroSub = deben.length
        ? `Tienes <b style="color:${RED};">${fmt(totalCobrable)}</b> por cobrar de ${deben.length} cliente${deben.length!==1?"s":""} con saldo en contra.`
        : `No tienes clientes con saldo en contra por notaría. Todo está cubierto por fondos.`;
      const bloqueDeben = deben.length ? sec("Por cobrar",RED)+deben.map(cardDebtor).join("")+gap(6) : "";
      const bloqueCub = cubiertos.length
        ? sec("Por rendir · cubierto por fondo",GRN)
          +`<div style="font-size:11.5px;color:${MUT};margin:-4px 0 10px;">${nOtRendir} OT sin rendir por ${fmt(totalRendir)}. El cliente tiene fondo de sobra: no es cobro, solo falta formalizarlas para descontar del fondo.</div>`
          +`<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${cubiertos.map((r,i)=>rowCovered(r,i===0)).join("")}</table>`+gap(8)
        : "";
      const sinNada = !deben.length && !cubiertos.length;

      return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#ECEFF1;margin:0;padding:22px 12px;">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 26px rgba(0,44,64,.09);">
  <div style="background:${NV};padding:20px 28px;text-align:center;"><img src="https://gestion.leabogados.cl/le-logo-blanco.png" alt="Liberona Escala Abogados" height="28" style="height:28px;display:inline-block;border:0;"/></div>
  <div style="padding:26px 26px 8px;">
    <div style="font-size:19px;color:${INK};font-weight:800;letter-spacing:-.3px;">Hola, ${esc(nombre)}</div>
    <div style="margin-top:14px;background:${deben.length?REDBG:GRNBG};border-radius:12px;padding:16px 18px;">
      <div style="font-size:10.5px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;color:${deben.length?RED:GRN};">Notaría por cobrar · ${esc(mesAno)}</div>
      <div style="font-size:30px;font-weight:800;letter-spacing:-1px;color:${deben.length?RED:GRN};margin-top:4px;line-height:1;">${esc(fmt(totalCobrable))}</div>
      <div style="font-size:12px;color:${MUT};margin-top:8px;line-height:1.5;">${heroSub}</div>
    </div>
    ${gap(22)}
    ${bloqueDeben}
    ${bloqueCub}
    ${sinNada?`<div style="font-size:13px;color:${FAINT};padding:8px 0;">Sin OT de notaría pendientes esta semana.</div>`:""}
    <div style="margin:6px 0 20px;text-align:center;"><a href="https://gestion.leabogados.cl" style="display:inline-block;background:${NV};color:#fff;text-decoration:none;padding:11px 22px;border-radius:9px;font-size:12.5px;font-weight:700;">Ir a rendir / cobrar &rarr;</a></div>
  </div>
  <div style="padding:16px 26px;border-top:1px solid ${HAIR};text-align:center;"><div style="font-size:11px;color:${FAINT};">gestion.leabogados.cl · Liberona Escala Abogados</div></div>
</div></body></html>`;
    };

    const sent:any[] = [];
    const enviar = async (to:string, nombre:string, mine:Row[]) => {
      const deben = mine.filter(r=>r.saldo<0);
      if (!mine.length) return;
      const totalCobrable = deben.reduce((s,r)=>s+r.cobrable,0);
      const subject = deben.length ? `Notaría · ${fmt(totalCobrable)} por cobrar (${deben.length} cliente${deben.length!==1?"s":""})`
                                   : `Notaría · sin cobros pendientes (todo cubierto)`;
      const html = armarHtml(nombre, mine);
      if (!dryRun) await sendMail(to, subject, html);
      sent.push({ to, nombre, clientes:mine.length, deben:deben.length, cobrable:totalCobrable, ...(dryRun?{subject,html}:{}) });
    };

    if (testTo) {
      const nombre = NOMBRE_DE_EMAIL[testTo] || "equipo";
      await enviar(testTo, nombre, rows.filter(r=>r.resp===nombre));
    } else {
      const porResp: Record<string, Row[]> = {};
      for (const r of rows) { if (!r.resp) continue; (porResp[r.resp]=porResp[r.resp]||[]).push(r); }
      for (const [resp, mine] of Object.entries(porResp)) {
        const to = EMAIL_DE[resp]; if (!to) continue;
        if (soloResp && !soloResp.includes(norm(resp)) && !soloResp.includes(norm(to))) continue;
        await enviar(to, resp, mine);
      }
    }

    return new Response(JSON.stringify({ ok:true, modo: testTo?"prueba":"cron", dryRun, sent, count:sent.length }), { headers:{ "Content-Type":"application/json", "Access-Control-Allow-Origin":"*" } });
  } catch (err) {
    return new Response(JSON.stringify({ error:(err as Error).message }), { status:500, headers:{ "Content-Type":"application/json", "Access-Control-Allow-Origin":"*" } });
  }
});
