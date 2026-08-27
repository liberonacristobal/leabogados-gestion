import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GMAIL_USER = Deno.env.get("GMAIL_USER") || "";
const GMAIL_PASS = Deno.env.get("GMAIL_PASS") || "";
const CRON_SECRET = Deno.env.get("CARTERA_SEMANAL_SECRET") || Deno.env.get("CRON_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const NOMBRE: Record<string,string> = { CL:"Cristóbal", EE:"Erasmo", MC:"Martín", MP:"Martina", RD:"Rodrigo" };
const EMAIL:  Record<string,string> = { CL:"cl@leabogados.cl", EE:"ee@leabogados.cl", MC:"mc@leabogados.cl", MP:"mp@leabogados.cl", RD:"rd@leabogados.cl" };
const INI_DE_EMAIL: Record<string,string> = { "cl@leabogados.cl":"CL","ee@leabogados.cl":"EE","mc@leabogados.cl":"MC","mp@leabogados.cl":"MP","rd@leabogados.cl":"RD" };

// Encabezados solo ASCII (denomailer rompe tildes en el subject). Quitar =20 de fin de línea.
const toAscii = (s:string) => String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[–—]/g,"-").replace(/[^\x20-\x7E]/g,"");
const qpSafe = (h:string) => String(h||"").replace(/[ \t]+$/gm,"");
const esc = (s:string) => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const fmt = (n:number) => new Intl.NumberFormat("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0}).format(n||0);

async function sendMail(to:string, subject:string, html:string){
  const client = new SMTPClient({ connection:{ hostname:"smtp.gmail.com", port:465, tls:true, auth:{ username:GMAIL_USER, password:GMAIL_PASS } } });
  try { await client.send({ from:`Liberona Escala Abogados - Proyectos <${GMAIL_USER}>`, to, subject:toAscii(subject), content:"Ver el contenido en formato HTML.", html:qpSafe(html) }); }
  finally { await client.close(); }
}

const facturaEmitida = (b:any) => !!b.invoice_no && b.status!=="Programada" && b.status!=="Anulada" && b.billing_type!=="reembolso";

// Motor de movimiento (espejo del de la app): eventos reales del cliente/proyecto, más reciente primero.
function eventosDe(p:any, d:any){
  const cid = String(p.cliente_id||""); const sid = p.sale_id?String(p.sale_id):null;
  const linkCli = (x:any)=> cid && String(x)===cid;
  const mine = (x:any)=> linkCli(x.client_id) || (sid && String(x.sale_id)===sid);
  const evs:any[] = [];
  const push=(fecha:any,texto:string)=>{ if(!fecha) return; const iso=String(fecha).slice(0,10); if(iso.length<10) return; evs.push({iso,texto}); };
  (d.billing||[]).filter((b:any)=>!b.deleted_at && b.billing_type!=="reembolso" && mine(b)).forEach((b:any)=>{
    if(b.paid_at && b.status==="Pagado") push(b.paid_at, `Pago recibido${b.amount?` · ${fmt(b.amount)}`:""}`);
    else if(facturaEmitida(b)) push(b.issued_at||b.due, `Factura emitida${b.invoice_no?` N° ${b.invoice_no}`:""}`);
  });
  (d.tasks||[]).forEach((t:any)=>{ const linked=(String(t.project_id||"")===String(p.id)) || (!t.project_id && linkCli(t.client_id)); if(!linked) return;
    if(t.completed_at) push(t.completed_at,"Tarea terminada"); else push(t.created_at,"Tarea nueva"); });
  (d.anticipos||[]).forEach((a:any)=>{ if(linkCli(a.client_id)) push(a.fecha, `Anticipo recibido${a.monto?` · ${fmt(a.monto)}`:""}`); });
  (d.expenses||[]).forEach((e:any)=>{ if(linkCli(e.client_id)) push(e.rendered_at||e.date||e.created_at,"Movimiento de gastos"); });
  evs.sort((a,b)=>b.iso.localeCompare(a.iso));
  return evs;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, content-type" } });
  try {
    const body = await req.json().catch(()=>({}));
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    // ── Autorización: (a) cron con secreto → corrida completa (o prueba dirigida si trae testTo); (b) usuario @leabogados.cl → solo a él.
    let testTo: string | null = null;
    const esCron = !!CRON_SECRET && body.secret === CRON_SECRET;
    if (esCron) {
      if (body.testTo) testTo = String(body.testTo).toLowerCase().trim();   // prueba dirigida a un solo correo
    } else {
      const auth = req.headers.get("authorization") || "";
      const jwt = auth.replace(/^Bearer\s+/i, "");
      const { data: u } = await sb.auth.getUser(jwt);
      const email = (u?.user?.email || "").toLowerCase();
      if (!email.endsWith("@leabogados.cl")) return new Response(JSON.stringify({ error:"No autorizado" }), { status:403, headers:{ "Content-Type":"application/json" } });
      testTo = email;   // prueba: se manda solo a quien lo pide
    }

    // Interruptor (solo aplica a la corrida real por cron; una prueba dirigida siempre manda).
    if (esCron && !testTo) {
      const { data: cfg } = await sb.from("learnings").select("value").eq("kind","config").eq("key","cartera_semanal").maybeSingle();
      if ((cfg?.value || "off") !== "on") return new Response(JSON.stringify({ ok:true, skipped:"apagado" }), { headers:{ "Content-Type":"application/json" } });
    }

    // ── Datos
    const [{ data: proyectos }, { data: clients }, { data: billing }, { data: tasks }, { data: anticipos }, { data: expenses }] = await Promise.all([
      sb.from("proyectos_cartera").select("*").eq("activo",true),
      sb.from("clients").select("id,name"),
      sb.from("billing").select("id,client_id,sale_id,status,billing_type,invoice_no,issued_at,paid_at,due,amount,deleted_at"),
      sb.from("tasks").select("id,client_id,project_id,title,status,due,created_at,completed_at,who,assignees"),
      sb.from("anticipos").select("client_id,monto,fecha,estado"),
      sb.from("expenses").select("client_id,date,rendered_at,created_at"),
    ]);
    const d = { billing:billing||[], tasks:(tasks||[]).filter((t:any)=>t.status!=="Terminado"), tasksAll:tasks||[], anticipos:anticipos||[], expenses:expenses||[] };
    const cname = (id:any)=> (clients||[]).find((c:any)=>String(c.id)===String(id))?.name || "";

    const hoyCL = new Date().toLocaleDateString("en-CA",{ timeZone:"America/Santiago" });
    const t0 = Date.parse(hoyCL);
    const diasDe = (iso:string)=> iso ? Math.round((t0 - Date.parse(String(iso).slice(0,10))) / 86400000) : null;   // + = pasado
    const faltanDe = (iso:string)=> iso ? Math.round((Date.parse(String(iso).slice(0,10)) - t0) / 86400000) : null;   // + = futuro
    const fDia = (iso:string)=>{ try { return new Date(String(iso).slice(0,10)+"T00:00:00").toLocaleDateString("es-CL",{ day:"numeric", month:"short" }); } catch { return String(iso); } };

    // ── Por responsable
    const activos = (proyectos||[]).filter((p:any)=> !p.pausado);
    const porResp: Record<string, any[]> = {};
    for (const p of activos) { const r = p.responsable || "—"; (porResp[r] = porResp[r] || []).push(p); }

    const FIRST: Record<string,string> = { CL:"Cristóbal", EE:"Erasmo", MC:"Martín", MP:"Martina", RD:"Rodrigo" };
    const tareasDe = (nombre:string) => d.tasks.filter((t:any)=> t.who===nombre || (Array.isArray(t.assignees)&&t.assignees.includes(nombre)));

    const digestDe = (ini:string) => {
      const nombre = FIRST[ini] || "";
      const mis = (porResp[ini] || []);
      const movio:any[] = [], detenidos:any[] = [];
      for (const p of mis) {
        const evs = eventosDe(p, d);
        const ult = evs[0] || null;
        const dd = ult ? diasDe(ult.iso) : null;
        if (ult && dd!=null && dd<=7) movio.push({ p, ult, dd });
        else if (!ult || (dd!=null && dd>=21)) detenidos.push({ p, dd });
      }
      movio.sort((a,b)=>a.dd-b.dd);
      // Tareas por QUIÉN las tiene (who / assignees), no por proyecto (las tareas no traen project_id).
      const tks = tareasDe(nombre).map((t:any)=>({ t, f: t.due ? faltanDe(t.due) : null }));
      const vencidas = tks.filter((x:any)=> x.f!=null && x.f<0).sort((a:any,b:any)=>a.f-b.f);
      const semana   = tks.filter((x:any)=> x.f!=null && x.f>=0 && x.f<=7).sort((a:any,b:any)=>a.f-b.f);
      const futuras  = tks.filter((x:any)=> x.f==null || x.f>7);
      return { mis, movio, detenidos, tks, vencidas, semana, futuras, nProy: mis.length, nTareas: tks.length, nVencen: vencidas.length };
    };

    const rowSig = (r:any)=> `<tr><td style="padding:8px 0;border-top:1px solid #eee;"><div style="font-size:13px;color:#1a1a1a;font-weight:600;">${esc(cname(r.p.cliente_id))||"Cliente"}</div><div style="font-size:11px;color:#888;">${esc(r.ult.texto)} · ${fDia(r.ult.iso)}</div></td></tr>`;
    const rowTarea = (x:any, col:string, cuando:string)=>{ const cli=cname(x.t.client_id); return `<tr><td style="padding:8px 0;border-top:1px solid #eee;"><div style="font-size:13px;color:#1a1a1a;font-weight:600;">${esc(x.t.title||"Tarea")}</div><div style="font-size:11px;color:#888;">${cli?esc(cli)+" · ":""}<span style="color:${col};font-weight:600;">${cuando}</span></div></td></tr>`; };
    const vencTxt = (f:number)=> f===-1?"venció ayer":`venció hace ${-f} días`;
    const proxTxt = (f:number)=> f===0?"vence hoy":f===1?"vence mañana":`vence en ${f} días`;
    const secTitle = (txt:string,color:string)=>`<div style="font-size:10px;font-weight:bold;color:${color};text-transform:uppercase;letter-spacing:.5px;margin:0 0 3px;">${txt}</div>`;

    const armarHtml = (ini:string, dg:any, equipoBloque:string) => {
      const nombre = FIRST[ini] || "equipo";
      const tusTareas = (dg.vencidas.length||dg.semana.length)
        ? `${secTitle("Tus tareas","#003C50")}<table style="width:100%;border-collapse:collapse;">${dg.vencidas.map((x:any)=>rowTarea(x,"#A32D2D",vencTxt(x.f))).join("")}${dg.semana.map((x:any)=>rowTarea(x,"#854F0B",proxTxt(x.f))).join("")}</table>${dg.futuras.length?`<div style="font-size:11px;color:#888;margin:6px 0 0;">y ${dg.futuras.length} tarea${dg.futuras.length!==1?"s":""} más adelante.</div>`:""}<div style="height:18px;"></div>`
        : (dg.nTareas? `${secTitle("Tus tareas","#003C50")}<div style="font-size:12.5px;color:#666;margin-bottom:18px;">${dg.nTareas} tarea${dg.nTareas!==1?"s":""} en curso, ninguna vence esta semana.</div>` : "");
      return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family:Arial,Helvetica,sans-serif;background:#f0f2f4;margin:0;padding:20px;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e4e8eb;">
  <div style="background:#003C50;padding:20px 28px;text-align:center;"><img src="https://gestion.leabogados.cl/le-logo-blanco.png" alt="Liberona Escala Abogados" height="28" width="184" style="height:28px;width:184px;display:inline-block;border:0;"/></div>
  <div style="padding:28px;">
    <div style="font-size:16px;color:#1a1a1a;font-weight:700;margin:0 0 4px;">Tus proyectos de la semana</div>
    <div style="font-size:13px;color:#666;margin:0 0 20px;">Hola ${esc(nombre)} — ${dg.nProy} proyecto${dg.nProy!==1?"s":""} activo${dg.nProy!==1?"s":""} · ${dg.nTareas} tarea${dg.nTareas!==1?"s":""} abierta${dg.nTareas!==1?"s":""}${dg.nVencen?` · <span style="color:#A32D2D;font-weight:600;">${dg.nVencen} vencida${dg.nVencen!==1?"s":""}</span>`:""}.</div>
    ${tusTareas}
    ${dg.movio.length ? `${secTitle("Se movió","#0F6E56")}<table style="width:100%;border-collapse:collapse;margin-bottom:18px;">${dg.movio.map(rowSig).join("")}</table>` : ""}
    ${dg.detenidos.length ? `${secTitle("Detenidos — conviene revisar","#A32D2D")}<div style="font-size:12.5px;color:#444;margin-bottom:18px;">${dg.detenidos.slice(0,8).map((r:any)=>esc(cname(r.p.cliente_id))||"Cliente").join(", ")}${dg.detenidos.length>8?` y ${dg.detenidos.length-8} más`:""}</div>` : ""}
    ${(!dg.nTareas && !dg.movio.length && !dg.detenidos.length) ? `<div style="font-size:13px;color:#888;margin-bottom:12px;">Sin novedades esta semana.</div>` : ""}
    ${equipoBloque}
    <div style="margin-top:14px;"><a href="https://gestion.leabogados.cl" style="display:inline-block;background:#003C50;color:#fff;text-decoration:none;padding:9px 18px;border-radius:18px;font-size:12px;font-weight:bold;">Abrir mis proyectos &rarr;</a></div>
  </div>
  <div style="padding:16px 28px;border-top:1px solid #eee;"><div style="font-size:11px;color:#999;">gestion.leabogados.cl &middot; Liberona Escala Abogados</div></div>
</div></body></html>`;
    };

    // Tareas del equipo (solo para admin/Cristóbal): qué encargó y cómo va, por persona, con las vencidas.
    const equipoAdmin = () => {
      let filas = "";
      for (const i of Object.keys(FIRST)) {
        if (i==="CL") continue;
        const dgi = digestDe(i);
        if (!dgi.nTareas && !dgi.nProy) continue;
        const vlist = dgi.vencidas.slice(0,3).map((x:any)=>`<div style="font-size:11px;color:#A32D2D;margin-top:2px;">· ${esc(x.t.title||"Tarea")}${cname(x.t.client_id)?` — ${esc(cname(x.t.client_id))}`:""}</div>`).join("");
        filas += `<tr><td style="padding:9px 0;border-top:1px solid #eee;"><div style="font-size:13px;font-weight:600;color:#1a1a1a;">${FIRST[i]}</div><div style="font-size:11px;color:#555;">${dgi.nProy} proyecto${dgi.nProy!==1?"s":""} · ${dgi.nTareas} tarea${dgi.nTareas!==1?"s":""}${dgi.nVencen?` · <span style="color:#A32D2D;font-weight:600;">${dgi.nVencen} vencida${dgi.nVencen!==1?"s":""}</span>`:""}</div>${vlist}</td></tr>`;
      }
      if(!filas) return "";
      return `${secTitle("Tareas del equipo","#537281")}<table style="width:100%;border-collapse:collapse;margin-bottom:6px;">${filas}</table>`;
    };

    const sent:any[] = [];
    const dryRun = !!body.dryRun;

    const destinos: string[] = testTo ? [ INI_DE_EMAIL[testTo] || "CL" ] : Object.keys(FIRST).filter(i=> (porResp[i]||[]).length || tareasDe(FIRST[i]).length);
    for (const ini of destinos) {
      const to = testTo || EMAIL[ini];
      if (!to) continue;
      const dg = digestDe(ini);
      const equipoBloque = (ini==="CL") ? equipoAdmin() : "";   // las tareas del equipo solo a Cristóbal
      const html = armarHtml(ini, dg, equipoBloque);
      const subject = `Tus proyectos de la semana · ${dg.nTareas} tarea${dg.nTareas!==1?"s":""}, ${dg.nVencen} vencida${dg.nVencen!==1?"s":""}`;
      if (!dryRun) await sendMail(to, subject, html);
      sent.push({ ini, to, nProy:dg.nProy, nTareas:dg.nTareas, vencidas:dg.nVencen, movio:dg.movio.length, detenidos:dg.detenidos.length });
    }

    return new Response(JSON.stringify({ ok:true, modo: testTo?"prueba":"cron", dryRun, sent, count:sent.length }), { headers:{ "Content-Type":"application/json", "Access-Control-Allow-Origin":"*" } });
  } catch (err) {
    return new Response(JSON.stringify({ error:(err as Error).message }), { status:500, headers:{ "Content-Type":"application/json", "Access-Control-Allow-Origin":"*" } });
  }
});
