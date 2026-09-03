// Aviso semanal (viernes) al ABOGADO A CARGO: clientes con horas facturables acumuladas SIN facturar
// por sobre su umbral (config, default 10 h) → conviene facturarlas. Espejo de horas-recordatorio
// (SMTP Gmail + cron con secreto + interruptor). Fase A de "ventas por hora" — solo lee horas, no toca cifras.
//
// Umbral: config learnings kind='config' key='umbral_horas_facturar' (global, default 10) y override por
// cliente key='umbral_horas_cli_<clientId>'. Interruptor: key='aviso_horas_facturar' (off | on | "CL,MC").
// Horas "por facturar" = billable !== false && sin report_id (aún no agrupadas en un reporte/factura).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const ESTUDIO = "Liberona Escala Abogados";
const APP_URL = "https://gestion.leabogados.cl";
const GMAIL_USER = Deno.env.get("GMAIL_USER") || "";
const GMAIL_PASS = Deno.env.get("GMAIL_PASS") || "";
const CRON_SECRET = Deno.env.get("HORAS_FACTURAR_SECRET") || Deno.env.get("CRON_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const NOMBRE: Record<string,string> = { CL:"Cristóbal", EE:"Erasmo", MC:"Martín", MP:"Martina", RD:"Rodrigo" };
const EMAIL:  Record<string,string> = { CL:"cl@leabogados.cl", EE:"ee@leabogados.cl", MC:"mc@leabogados.cl", MP:"mp@leabogados.cl", RD:"rd@leabogados.cl" };
const INI_DE_EMAIL: Record<string,string> = { "cl@leabogados.cl":"CL","ee@leabogados.cl":"EE","mc@leabogados.cl":"MC","mp@leabogados.cl":"MP","rd@leabogados.cl":"RD" };
const norm = (s:string) => String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().trim();
const EMAIL_BY_NAME: Record<string,string> = {}; Object.keys(NOMBRE).forEach(ini=>{ EMAIL_BY_NAME[norm(NOMBRE[ini])] = EMAIL[ini]; });

const toAscii = (s:string) => String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[–—]/g,"-").replace(/[^\x20-\x7E]/g,"");
const qpSafe = (h:string) => String(h||"").replace(/[ \t]+$/gm,"");
const fh = (n:number) => (Math.round((Number(n)||0)*10)/10).toLocaleString("es-CL",{minimumFractionDigits:1,maximumFractionDigits:1})+" h";
const fuf = (n:number) => "UF " + (Math.round((Number(n)||0)*10)/10).toLocaleString("es-CL",{minimumFractionDigits:1,maximumFractionDigits:1});

async function sendMail(to:string, subject:string, html:string){
  const client = new SMTPClient({ connection:{ hostname:"smtp.gmail.com", port:465, tls:true, auth:{ username:GMAIL_USER, password:GMAIL_PASS } } });
  try { await client.send({ from:`${ESTUDIO} - Horas <${GMAIL_USER}>`, to, subject:toAscii(subject), content:"Ver el contenido en formato HTML.", html:qpSafe(html) }); }
  finally { try { await client.close(); } catch(_){} }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, content-type" } });
  try {
    const body = await req.json().catch(()=>({}));
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    // Autorización: (a) cron con secreto → corrida completa (o prueba dirigida con testTo); (b) usuario @leabogados.cl → solo a él.
    let testTo: string | null = null;
    const esCron = !!CRON_SECRET && body.secret === CRON_SECRET;
    if (esCron) {
      if (body.testTo) testTo = String(body.testTo).toLowerCase().trim();
    } else {
      const auth = req.headers.get("authorization") || "";
      const token = auth.replace(/^Bearer\s+/i,"");
      const { data:{ user } } = await sb.auth.getUser(token);
      const email = (user?.email || "").toLowerCase();
      if (!email.endsWith("@leabogados.cl")) return new Response(JSON.stringify({ error:"No autorizado" }), { status:403, headers:{ "Content-Type":"application/json" } });
      testTo = email;
    }

    // Interruptor (solo corrida real cron sin testTo): off=apagado · on=todos · lista de iniciales.
    let scope = "on";
    if (esCron && !testTo) {
      const { data: cfg } = await sb.from("learnings").select("value").eq("kind","config").eq("key","aviso_horas_facturar").maybeSingle();
      const val = (cfg?.value || "off").trim();
      if (val === "off") return new Response(JSON.stringify({ ok:true, skipped:"apagado" }), { headers:{ "Content-Type":"application/json" } });
      scope = val;
    }
    const soloInis: string[] | null = (scope && scope !== "on") ? scope.toUpperCase().split(/[,\s]+/).filter(Boolean) : null;

    // Config: tarifa (UF/h) + umbral global + overrides por cliente.
    const { data: cfgAll } = await sb.from("learnings").select("key,value").eq("kind","config");
    const cfg: Record<string,string> = {}; (cfgAll||[]).forEach((r:any)=>{ cfg[r.key]=r.value; });
    const tarifa = parseFloat(cfg["tarifa_hora_permanente_uf"]||"") || 3;
    const umbralGlobal = parseFloat(cfg["umbral_horas_facturar"]||"") || 10;
    const umbralDe = (cid:string) => { const v = parseFloat(cfg["umbral_horas_cli_"+cid]||""); return v>0 ? v : umbralGlobal; };

    // Horas por facturar = facturables, sin report_id (aún no facturadas).
    const { data: horas } = await sb.from("horas").select("client_id,horas,billable,report_id,fecha,glosa").is("report_id", null);
    const porCli: Record<string,{h:number,n:number,ult:string}> = {};
    (horas||[]).forEach((h:any)=>{ if(h.billable===false||!h.client_id) return; const k=String(h.client_id);
      const g = porCli[k] || (porCli[k]={h:0,n:0,ult:""}); g.h += Number(h.horas)||0; g.n++; if((h.fecha||"")>g.ult) g.ult=h.fecha||""; });

    // Clientes + abogado a cargo (abogado_responsable → responsable de la venta más reciente).
    const { data: clients } = await sb.from("clients").select("id,name,abogado_responsable");
    const { data: sales } = await sb.from("sales").select("client_id,responsible,created_at").order("created_at",{ascending:false});
    const nameDe: Record<string,string> = {}; const respDe: Record<string,string> = {};
    (clients||[]).forEach((c:any)=>{ nameDe[String(c.id)]=c.name||"Cliente"; if(c.abogado_responsable) respDe[String(c.id)]=c.abogado_responsable; });
    (sales||[]).forEach((s:any)=>{ const k=String(s.client_id); if(s.responsible && s.client_id && !respDe[k]) respDe[k]=s.responsible; });

    // Clientes por sobre su umbral, agrupados por abogado (por inicial).
    const porAbg: Record<string, any[]> = {};
    Object.entries(porCli).forEach(([cid,g])=>{ const um=umbralDe(cid); if(g.h < um) return;
      const resp = respDe[cid]; const to = resp ? EMAIL_BY_NAME[norm(resp)] : null; if(!to) return;   // sin abogado con correo → no se avisa (queda para admins, futuro)
      const ini = INI_DE_EMAIL[to]; if(!ini) return;
      (porAbg[ini]=porAbg[ini]||[]).push({ cid, name:nameDe[cid]||"Cliente", h:g.h, n:g.n, um, valor:g.h*tarifa, ult:g.ult });
    });

    const NAVY="#003C50", MUT="#537281", BORDER="#E4E8EB", VERDE="#0F6E56", PANEL="#FAFBFC";
    const armarHtml = (nombre:string, cli:any[]) => {
      const totH = cli.reduce((a,c)=>a+c.h,0), totUF = cli.reduce((a,c)=>a+c.valor,0);
      const filas = cli.sort((a,b)=>b.valor-a.valor).map(c=>`
        <div style="border:1px solid ${BORDER};border-radius:9px;padding:10px 12px;margin-bottom:9px">
          <div style="display:flex;justify-content:space-between;align-items:baseline"><b style="color:${NAVY};font-size:13.5px">${c.name}</b><b style="color:${VERDE};font-size:13.5px">${fh(c.h)} · ${fuf(c.valor)}</b></div>
          <div style="font-size:10.5px;color:${MUT};margin-top:2px">umbral ${fh(c.um)} · ${c.n} registro${c.n!==1?'s':''}${c.ult?` · última carga ${c.ult}`:''}</div>
        </div>`).join("");
      return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#F5F7F9;font-family:'DM Sans',Arial,sans-serif;color:#3D3D3D">
<div style="max-width:560px;margin:0 auto;padding:22px 16px">
  <div style="background:#fff;border:1px solid ${BORDER};border-radius:14px;overflow:hidden">
    <div style="background:${NAVY};color:#fff;padding:16px 20px"><div style="font-size:15px;font-weight:700">${ESTUDIO}</div><div style="font-size:11px;opacity:.85">Horas por facturar · viernes</div></div>
    <div style="padding:20px">
      <div style="font-size:14px;font-weight:600;color:${NAVY};margin-bottom:6px">Hola ${nombre},</div>
      <div style="font-size:13px;line-height:1.55;margin-bottom:16px">Tienes horas cargadas que ya superan el umbral y conviene <b>facturarlas al cliente</b>:</div>
      ${filas}
      <div style="background:${NAVY};color:#fff;border-radius:9px;padding:11px 14px;display:flex;justify-content:space-between;align-items:center;margin:4px 0 16px">
        <span style="font-size:12px;color:#85B7EB">Total por facturar</span><span style="font-size:17px;font-weight:800">${fh(totH)} · ${fuf(totUF)}</span>
      </div>
      <a href="${APP_URL}" style="display:inline-block;background:${NAVY};color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:11px 20px;border-radius:9px">Ver en la app</a>
      <div style="font-size:11px;color:${MUT};margin-top:16px;line-height:1.5">Entra a cada cliente para revisar el detalle de las horas y facturarlas. Valor calculado a ${fuf(tarifa)}/h.</div>
    </div>
  </div>
  <div style="text-align:center;font-size:10px;color:#99ABB4;margin-top:14px">${ESTUDIO}</div>
</div></body></html>`;
    };

    const dryRun = !!body.dryRun;
    const sent:any[] = [];
    let inis = Object.keys(porAbg);
    if (testTo) { const ini = INI_DE_EMAIL[testTo]; inis = ini && porAbg[ini] ? [ini] : []; }
    if (soloInis) inis = inis.filter(i => soloInis.includes(i));
    for (const ini of inis) {
      const cli = porAbg[ini]; if(!cli || !cli.length) continue;
      const to = testTo || EMAIL[ini]; if(!to) continue;
      const nombre = NOMBRE[ini] || ini;
      const totH = cli.reduce((a:number,c:any)=>a+c.h,0);
      const subject = `Horas por facturar — ${cli.length} cliente${cli.length!==1?'s':''} (${fh(totH)})`;
      const html = armarHtml(nombre, cli);
      if (!dryRun) await sendMail(to, subject, html);
      sent.push({ ini, to, clientes:cli.length, horas:totH, ...(dryRun?{subject,html}:{}) });
    }

    return new Response(JSON.stringify({ ok:true, modo: testTo?"prueba":"cron", dryRun, tarifa, umbralGlobal, sent, count:sent.length }), { headers:{ "Content-Type":"application/json", "Access-Control-Allow-Origin":"*" } });
  } catch (err) {
    return new Response(JSON.stringify({ error:(err as Error).message }), { status:500, headers:{ "Content-Type":"application/json", "Access-Control-Allow-Origin":"*" } });
  }
});
