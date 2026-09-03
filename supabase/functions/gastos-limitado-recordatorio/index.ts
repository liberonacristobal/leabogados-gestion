// Recordatorio semanal (lunes) a los usuarios LIMITADOS que no cargan gastos hace +N días (default 7).
// Adopción: el valor de la app depende de que el equipo cargue. Espejo de horas-recordatorio
// (SMTP Gmail + cron con secreto + interruptor). Solo lee; no toca cifras.
//
// created_by de expenses viene inconsistente (a veces nombre "Martín", a veces email "mc@...", a veces null),
// así que por cada usuario se matchea por NOMBRE **o** EMAIL y se toma el max(created_at).
// Umbral: config learnings key='dias_gastos_limitado' (default 7). Interruptor: key='aviso_gastos_limitado'
// (off | on | "MC,MP" lista de iniciales). Default off → no envía nada.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const ESTUDIO = "Liberona Escala Abogados";
const APP_URL = "https://gestion.leabogados.cl";
const GMAIL_USER = Deno.env.get("GMAIL_USER") || "";
const GMAIL_PASS = Deno.env.get("GMAIL_PASS") || "";
const CRON_SECRET = Deno.env.get("GASTOS_LIMITADO_SECRET") || Deno.env.get("CRON_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const LIMITADOS = [
  { ini:"MC", nombre:"Martín",  email:"mc@leabogados.cl" },
  { ini:"MP", nombre:"Martina", email:"mp@leabogados.cl" },
  { ini:"RD", nombre:"Rodrigo", email:"rd@leabogados.cl" },
];

const toAscii = (s:string) => String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[–—]/g,"-").replace(/[^\x20-\x7E]/g,"");
const qpSafe = (h:string) => String(h||"").replace(/[ \t]+$/gm,"");
const diasDesde = (iso:string|null) => iso ? Math.floor((Date.now()-new Date(iso).getTime())/86400000) : null;
const fechaCL = (iso:string|null) => { if(!iso) return "nunca"; try{ return new Date(iso).toLocaleDateString("es-CL",{day:"2-digit",month:"long"}); }catch(_){ return String(iso).slice(0,10); } };

async function sendMail(to:string, subject:string, html:string){
  const client = new SMTPClient({ connection:{ hostname:"smtp.gmail.com", port:465, tls:true, auth:{ username:GMAIL_USER, password:GMAIL_PASS } } });
  try { await client.send({ from:`${ESTUDIO} <${GMAIL_USER}>`, to, subject:toAscii(subject), content:"Ver el contenido en formato HTML.", html:qpSafe(html) }); }
  finally { try { await client.close(); } catch(_){} }
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
      const { data:{ user } } = await sb.auth.getUser(auth.replace(/^Bearer\s+/i,""));
      const email = (user?.email || "").toLowerCase();
      if (!email.endsWith("@leabogados.cl")) return new Response(JSON.stringify({ error:"No autorizado" }), { status:403, headers:{ "Content-Type":"application/json" } });
      testTo = email;
    }

    let scope = "on";
    if (esCron && !testTo) {
      const { data: cfg } = await sb.from("learnings").select("value").eq("kind","config").eq("key","aviso_gastos_limitado").maybeSingle();
      const val = (cfg?.value || "off").trim();
      if (val === "off") return new Response(JSON.stringify({ ok:true, skipped:"apagado" }), { headers:{ "Content-Type":"application/json" } });
      scope = val;
    }
    const soloInis: string[] | null = (scope && scope !== "on") ? scope.toUpperCase().split(/[,\s]+/).filter(Boolean) : null;

    const { data: cfgDias } = await sb.from("learnings").select("value").eq("kind","config").eq("key","dias_gastos_limitado").maybeSingle();
    const umbral = parseInt(cfgDias?.value||"") > 0 ? parseInt(cfgDias!.value) : 7;

    // Última carga de cada limitado: max(created_at) matcheando por nombre O email.
    const lagging:any[] = [];
    for (const u of LIMITADOS) {
      const { data } = await sb.from("expenses").select("created_at").in("created_by",[u.nombre,u.email]).order("created_at",{ascending:false}).limit(1);
      const ult = data && data.length ? data[0].created_at : null;
      const d = diasDesde(ult);
      if (d===null || d>=umbral) lagging.push({ ...u, ult, dias:d });
    }

    const NAVY="#003C50", MUT="#537281", BORDER="#E4E8EB";
    const armarHtml = (u:any) => {
      const linea = u.dias===null
        ? `Todavía no registras ningún gasto en la app.`
        : `Tu última carga de gastos fue el <b>${fechaCL(u.ult)}</b> — hace <b>${u.dias} días</b>.`;
      return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#F5F7F9;font-family:Arial,Helvetica,sans-serif;color:#3D3D3D">
<div style="max-width:520px;margin:0 auto;padding:22px 16px">
  <div style="background:#fff;border:1px solid ${BORDER};border-radius:14px;overflow:hidden">
    <div style="background:${NAVY};color:#fff;padding:16px 20px"><div style="font-size:15px;font-weight:700">${ESTUDIO}</div><div style="font-size:11px;opacity:.85">Recordatorio de gastos</div></div>
    <div style="padding:20px">
      <div style="font-size:14px;font-weight:600;color:${NAVY};margin-bottom:8px">Hola ${u.nombre},</div>
      <div style="font-size:13px;line-height:1.6;margin-bottom:16px">${linea}<br>Cargar tus gastos al día mantiene tus rendiciones y la caja chica cuadradas — y toma un minuto.</div>
      <a href="${APP_URL}" style="display:inline-block;background:${NAVY};color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:11px 22px;border-radius:9px">Cargar gastos ahora</a>
      <div style="font-size:11px;color:${MUT};margin-top:16px;line-height:1.5">Si ya no cargas gastos, avísale a Cristóbal para dejar de recibir este recordatorio.</div>
    </div>
  </div>
  <div style="text-align:center;font-size:10px;color:#99ABB4;margin-top:14px">${ESTUDIO}</div>
</div></body></html>`;
    };

    const dryRun = !!body.dryRun;
    const sent:any[] = [];
    let objetivo = lagging;
    if (testTo) { const u = LIMITADOS.find(x=>x.email===testTo); objetivo = u ? [{ ...u, ...(lagging.find(l=>l.ini===u.ini)||{ult:null,dias:null}) }] : []; }
    if (soloInis) objetivo = objetivo.filter(u=>soloInis.includes(u.ini));
    for (const u of objetivo) {
      const to = testTo || u.email; if(!to) continue;
      const subject = u.dias===null ? `Aún no registras gastos en la app` : `Hace ${u.dias} días que no cargas gastos`;
      const html = armarHtml(u);
      if (!dryRun) await sendMail(to, subject, html);
      sent.push({ ini:u.ini, to, dias:u.dias, ...(dryRun?{subject,html}:{}) });
    }

    return new Response(JSON.stringify({ ok:true, modo: testTo?"prueba":"cron", dryRun, umbral, lagging:lagging.map(l=>({ini:l.ini,dias:l.dias})), sent, count:sent.length }), { headers:{ "Content-Type":"application/json", "Access-Control-Allow-Origin":"*" } });
  } catch (err) {
    return new Response(JSON.stringify({ error:(err as Error).message }), { status:500, headers:{ "Content-Type":"application/json", "Access-Control-Allow-Origin":"*" } });
  }
});
