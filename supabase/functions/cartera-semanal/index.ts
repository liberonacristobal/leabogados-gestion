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

    const digestDe = (ini:string) => {
      const mis = (porResp[ini] || []);
      const movio:any[] = [], plazos:any[] = [], detenidos:any[] = [];
      let nTareas = 0, nVencen = 0;
      for (const p of mis) {
        const evs = eventosDe(p, d);
        const ult = evs[0] || null;
        const dd = ult ? diasDe(ult.iso) : null;
        // tareas del proyecto
        const tks = d.tasks.filter((t:any)=> (String(t.project_id||"")===String(p.id)) || (!t.project_id && p.cliente_id && String(t.client_id||"")===String(p.cliente_id)));
        nTareas += tks.length;
        // próximo plazo (p.plazo + due de tareas)
        let prox: number | null = p.plazo ? faltanDe(p.plazo) : null;
        let proxLbl = p.plazo ? (p.plazo_label || cname(p.cliente_id)) : "";
        for (const t of tks) { if (t.due) { const f = faltanDe(t.due); if (f!=null && (prox==null || f<prox)) { prox=f; proxLbl=t.title||""; } } }
        if (prox!=null && prox>=0 && prox<=7) { nVencen++; plazos.push({ p, prox, proxLbl }); }
        if (ult && dd!=null && dd<=7) movio.push({ p, ult, dd });
        else if (!ult || (dd!=null && dd>=21)) detenidos.push({ p, dd });
      }
      movio.sort((a,b)=>a.dd-b.dd);
      plazos.sort((a,b)=>a.prox-b.prox);
      return { mis, movio, plazos, detenidos, nProy: mis.length, nTareas, nVencen };
    };

    const rowSig = (r:any)=> `<tr><td style="padding:8px 0;border-top:1px solid #eee;"><div style="font-size:13px;color:#1a1a1a;font-weight:600;">${esc(cname(r.p.cliente_id))||"Cliente"}</div><div style="font-size:11px;color:#888;">${esc(r.ult.texto)} · ${fDia(r.ult.iso)}</div></td></tr>`;
    const rowPlazo = (r:any)=> `<tr><td style="padding:8px 0;border-top:1px solid #eee;"><div style="font-size:13px;color:#1a1a1a;font-weight:600;">${esc(cname(r.p.cliente_id))||"Cliente"}</div><div style="font-size:11px;color:#854F0B;">${esc(r.proxLbl||"")} · ${r.prox===0?"hoy":r.prox===1?"mañana":`en ${r.prox} días`}</div></td></tr>`;

    const armarHtml = (ini:string, dg:any, equipoTabla:string) => {
      const nombre = NOMBRE[ini] || "equipo";
      return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family:Arial,Helvetica,sans-serif;background:#f0f2f4;margin:0;padding:20px;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e4e8eb;">
  <div style="background:#003C50;padding:20px 28px;text-align:center;"><img src="https://gestion.leabogados.cl/le-logo-blanco.png" alt="Liberona Escala Abogados" height="28" width="184" style="height:28px;width:184px;display:inline-block;border:0;"/></div>
  <div style="padding:28px;">
    <div style="font-size:16px;color:#1a1a1a;font-weight:700;margin:0 0 4px;">Tus proyectos de la semana</div>
    <div style="font-size:13px;color:#666;margin:0 0 20px;">Hola ${esc(nombre)} — ${dg.nProy} proyecto${dg.nProy!==1?"s":""} activo${dg.nProy!==1?"s":""} · ${dg.nTareas} tarea${dg.nTareas!==1?"s":""} abierta${dg.nTareas!==1?"s":""} · ${dg.nVencen} plazo${dg.nVencen!==1?"s":""} esta semana.</div>
    ${dg.movio.length ? `<div style="font-size:10px;font-weight:bold;color:#0F6E56;text-transform:uppercase;letter-spacing:.5px;margin:0 0 2px;">Se movió</div><table style="width:100%;border-collapse:collapse;margin-bottom:18px;">${dg.movio.map(rowSig).join("")}</table>` : ""}
    ${dg.plazos.length ? `<div style="font-size:10px;font-weight:bold;color:#854F0B;text-transform:uppercase;letter-spacing:.5px;margin:0 0 2px;">Plazos de la semana</div><table style="width:100%;border-collapse:collapse;margin-bottom:18px;">${dg.plazos.map(rowPlazo).join("")}</table>` : ""}
    ${dg.detenidos.length ? `<div style="font-size:10px;font-weight:bold;color:#A32D2D;text-transform:uppercase;letter-spacing:.5px;margin:0 0 6px;">Detenidos — conviene revisar</div><div style="font-size:12.5px;color:#444;margin-bottom:18px;">${dg.detenidos.slice(0,8).map((r:any)=>esc(cname(r.p.cliente_id))||"Cliente").join(", ")}${dg.detenidos.length>8?` y ${dg.detenidos.length-8} más`:""}</div>` : ""}
    ${(!dg.movio.length && !dg.plazos.length && !dg.detenidos.length) ? `<div style="font-size:13px;color:#888;margin-bottom:12px;">Sin novedades esta semana.</div>` : ""}
    ${equipoTabla}
    <div style="margin-top:14px;"><a href="https://gestion.leabogados.cl" style="display:inline-block;background:#003C50;color:#fff;text-decoration:none;padding:9px 18px;border-radius:18px;font-size:12px;font-weight:bold;">Abrir mis proyectos &rarr;</a></div>
  </div>
  <div style="padding:16px 28px;border-top:1px solid #eee;"><div style="font-size:11px;color:#999;">gestion.leabogados.cl &middot; Liberona Escala Abogados</div></div>
</div></body></html>`;
    };

    // Tabla resumen del equipo (solo para admin/Cristóbal).
    const tablaEquipo = () => {
      const filas = Object.keys(NOMBRE).filter(i=> (porResp[i]||[]).length).map(i=>{ const dg=digestDe(i); return `<tr><td style="padding:6px 0;font-size:12.5px;color:#1a1a1a;">${NOMBRE[i]}</td><td style="padding:6px 0;font-size:12.5px;color:#555;text-align:right;">${dg.nProy} proy · ${dg.nTareas} tareas · ${dg.nVencen} esta sem.</td></tr>`; }).join("");
      if(!filas) return "";
      return `<div style="font-size:10px;font-weight:bold;color:#537281;text-transform:uppercase;letter-spacing:.5px;margin:6px 0 2px;">Carga del equipo</div><table style="width:100%;border-collapse:collapse;margin-bottom:6px;">${filas}</table>`;
    };

    const sent:any[] = [];
    const dryRun = !!body.dryRun;

    const destinos: string[] = testTo ? [ INI_DE_EMAIL[testTo] || "CL" ] : Object.keys(NOMBRE).filter(i=> (porResp[i]||[]).length);
    for (const ini of destinos) {
      const to = testTo || EMAIL[ini];
      if (!to) continue;
      const dg = digestDe(ini);
      const equipoTabla = (ini==="CL") ? tablaEquipo() : "";   // el resumen de equipo solo a Cristóbal
      const html = armarHtml(ini, dg, equipoTabla);
      const subject = `Tus proyectos de la semana · ${dg.nProy} proyectos, ${dg.nVencen} plazos`;
      if (!dryRun) await sendMail(to, subject, html);
      sent.push({ ini, to, nProy:dg.nProy, movio:dg.movio.length, plazos:dg.plazos.length, detenidos:dg.detenidos.length });
    }

    return new Response(JSON.stringify({ ok:true, modo: testTo?"prueba":"cron", dryRun, sent, count:sent.length }), { headers:{ "Content-Type":"application/json", "Access-Control-Allow-Origin":"*" } });
  } catch (err) {
    return new Response(JSON.stringify({ error:(err as Error).message }), { status:500, headers:{ "Content-Type":"application/json", "Access-Control-Allow-Origin":"*" } });
  }
});
