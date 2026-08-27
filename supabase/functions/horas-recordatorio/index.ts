import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Recordatorio de viernes para cargar horas. Espejo de cartera-semanal (SMTP Gmail + cron con secreto + interruptor).
// El estudio (nombre/remitente) va en una sola const → Fase 1 BRAND: parametrizable a futuro, hoy = tenant #1 (LEA).
const ESTUDIO = "Liberona Escala Abogados";
const APP_URL = "https://gestion.leabogados.cl";

const GMAIL_USER = Deno.env.get("GMAIL_USER") || "";
const GMAIL_PASS = Deno.env.get("GMAIL_PASS") || "";
const CRON_SECRET = Deno.env.get("HORAS_RECORDATORIO_SECRET") || Deno.env.get("CRON_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const NOMBRE: Record<string,string> = { CL:"Cristóbal", EE:"Erasmo", MC:"Martín", MP:"Martina", RD:"Rodrigo" };
const EMAIL:  Record<string,string> = { CL:"cl@leabogados.cl", EE:"ee@leabogados.cl", MC:"mc@leabogados.cl", MP:"mp@leabogados.cl", RD:"rd@leabogados.cl" };
const INI_DE_EMAIL: Record<string,string> = { "cl@leabogados.cl":"CL","ee@leabogados.cl":"EE","mc@leabogados.cl":"MC","mp@leabogados.cl":"MP","rd@leabogados.cl":"RD" };

// Encabezados solo ASCII (denomailer rompe tildes en el subject).
const toAscii = (s:string) => String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[–—]/g,"-").replace(/[^\x20-\x7E]/g,"");
const qpSafe = (h:string) => String(h||"").replace(/[ \t]+$/gm,"");
const fh = (n:number) => (Math.round((Number(n)||0)*10)/10).toLocaleString("es-CL",{minimumFractionDigits:1,maximumFractionDigits:1})+" h";

async function sendMail(to:string, subject:string, html:string){
  const client = new SMTPClient({ connection:{ hostname:"smtp.gmail.com", port:465, tls:true, auth:{ username:GMAIL_USER, password:GMAIL_PASS } } });
  try { await client.send({ from:`${ESTUDIO} - Horas <${GMAIL_USER}>`, to, subject:toAscii(subject), content:"Ver el contenido en formato HTML.", html:qpSafe(html) }); }
  finally { await client.close(); }
}

// Lunes–viernes de la semana en curso (hora de Chile).
function semanaChile(){
  const hoy = new Date(new Date().toLocaleString("en-US",{timeZone:"America/Santiago"}));
  const dow = (hoy.getDay()+6)%7;                        // 0=lun … 6=dom
  const lun = new Date(hoy); lun.setDate(hoy.getDate()-dow);
  const dias:string[] = [];
  for (let i=0;i<5;i++){ const d=new Date(lun); d.setDate(lun.getDate()+i); dias.push(d.toISOString().slice(0,10)); }
  return { lunISO: dias[0], dias, dow };
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

    // Interruptor (solo corrida real): "off"=apagado · "on"=equipo · lista de iniciales = solo esas personas.
    let scope = "on";
    if (esCron && !testTo) {
      const { data: cfg } = await sb.from("learnings").select("value").eq("kind","config").eq("key","recordatorio_horas").maybeSingle();
      const val = (cfg?.value || "off").trim();
      if (val === "off") return new Response(JSON.stringify({ ok:true, skipped:"apagado" }), { headers:{ "Content-Type":"application/json" } });
      scope = val;
    }
    const soloInis: string[] | null = (scope && scope !== "on") ? scope.toUpperCase().split(/[,\s]+/).filter(Boolean) : null;

    const { lunISO, dias } = semanaChile();
    const { data: horas } = await sb.from("horas").select("user_name,fecha,horas").gte("fecha", lunISO);
    const { data: metasRaw } = await sb.from("learnings").select("key,value").eq("kind","meta_horas");
    const metaDe: Record<string,number> = {}; (metasRaw||[]).forEach((r:any)=>{ metaDe[r.key]=Number(r.value)||0; });

    const DOW = ["lun","mar","mié","jue","vie"];
    const totalDe = (nombre:string) => (horas||[]).filter((h:any)=>h.user_name===nombre).reduce((a:number,h:any)=>a+(Number(h.horas)||0),0);
    const porDia = (nombre:string) => dias.map((iso)=> (horas||[]).filter((h:any)=>h.user_name===nombre&&h.fecha===iso).reduce((a:number,h:any)=>a+(Number(h.horas)||0),0));

    const NAVY="#003C50", MUT="#537281", BORDER="#E4E8EB", VERDE="#0F6E56", AMBAR="#854F0B";
    const armarHtml = (nombre:string) => {
      const tot = totalDe(nombre), meta = metaDe[nombre]||0, dd = porDia(nombre);
      const pct = meta>0 ? Math.round(tot/meta*100) : 0;
      const alDia = meta>0 ? pct>=70 : tot>0;
      const cel = dd.map((v,i)=>`<td style="text-align:center;padding:6px 2px;border:1px solid ${BORDER};background:${v>0?'#F5F7F9':'#fff'}"><div style="font-size:9px;color:${MUT};text-transform:uppercase">${DOW[i]}</div><div style="font-size:13px;font-weight:700;color:${v>0?NAVY:'#99ABB4'}">${v>0?fh(v).replace(' h',''):'·'}</div></td>`).join("");
      const msg = tot<=0
        ? `Aún no registras horas esta semana. Tómate un minuto para cargarlas antes del fin de semana — así el lunes está todo al día.`
        : alDia
          ? `Llevas <b>${fh(tot)}</b> esta semana. Revisa que no falte cargar nada de hoy antes de cerrar.`
          : `Llevas <b>${fh(tot)}</b> esta semana${meta>0?` (meta ${fh(meta)})`:''}. Revisa que no falte cargar nada antes del fin de semana.`;
      return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#F5F7F9;font-family:'DM Sans',Arial,sans-serif;color:#3D3D3D">
<div style="max-width:520px;margin:0 auto;padding:22px 16px">
  <div style="background:#fff;border:1px solid ${BORDER};border-radius:14px;overflow:hidden">
    <div style="background:${NAVY};color:#fff;padding:16px 20px"><div style="font-size:15px;font-weight:700">${ESTUDIO}</div><div style="font-size:11px;opacity:.85">Recordatorio de horas · viernes</div></div>
    <div style="padding:20px">
      <div style="font-size:14px;font-weight:600;color:${NAVY};margin-bottom:10px">Hola ${nombre},</div>
      <div style="font-size:13px;line-height:1.55;color:#3D3D3D;margin-bottom:16px">${msg}</div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:18px"><tr>${cel}</tr></table>
      <a href="${APP_URL}" style="display:inline-block;background:${NAVY};color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:11px 20px;border-radius:9px">Cargar mis horas</a>
      <div style="font-size:11px;color:${MUT};margin-top:16px;line-height:1.5">${alDia?`<span style="color:${VERDE};font-weight:600">Vas al día.</span> `:`<span style="color:${AMBAR};font-weight:600">Un empujón.</span> `}Cargar toma segundos: la app te propone las tareas y reuniones del día para que solo confirmes.</div>
    </div>
  </div>
  <div style="text-align:center;font-size:10px;color:#99ABB4;margin-top:14px">${ESTUDIO}</div>
</div></body></html>`;
    };

    const dryRun = !!body.dryRun;
    const sent:any[] = [];
    let destinos: string[] = testTo ? [ INI_DE_EMAIL[testTo] || "CL" ] : Object.keys(NOMBRE);
    if (soloInis) destinos = destinos.filter(i => soloInis.includes(i));
    for (const ini of destinos) {
      const to = testTo || EMAIL[ini];
      if (!to) continue;
      const nombre = NOMBRE[ini];
      const tot = totalDe(nombre);
      const subject = tot<=0 ? "Recuerda cargar tus horas de la semana" : `Tus horas de la semana · ${fh(tot)}`;
      const html = armarHtml(nombre);
      if (!dryRun) await sendMail(to, subject, html);
      sent.push({ ini, to, total:tot, ...(dryRun?{subject,html}:{}) });
    }

    return new Response(JSON.stringify({ ok:true, modo: testTo?"prueba":"cron", dryRun, semana:lunISO, sent, count:sent.length }), { headers:{ "Content-Type":"application/json", "Access-Control-Allow-Origin":"*" } });
  } catch (err) {
    return new Response(JSON.stringify({ error:(err as Error).message }), { status:500, headers:{ "Content-Type":"application/json", "Access-Control-Allow-Origin":"*" } });
  }
});
