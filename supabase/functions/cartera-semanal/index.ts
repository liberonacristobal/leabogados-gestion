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
  const push=(fecha:any,tipo:string,texto:string,monto:number=0)=>{ if(!fecha) return; const iso=String(fecha).slice(0,10); if(iso.length<10) return; evs.push({iso,tipo,texto,monto}); };
  (d.billing||[]).filter((b:any)=>!b.deleted_at && b.billing_type!=="reembolso" && mine(b)).forEach((b:any)=>{
    if(b.paid_at && b.status==="Pagado") push(b.paid_at, "pago", "Pago recibido", Number(b.amount)||0);
    else if(facturaEmitida(b)) push(b.issued_at||b.due, "factura", `Factura emitida${b.invoice_no?` N° ${b.invoice_no}`:""}`);
  });
  (d.tasks||[]).forEach((t:any)=>{ const linked=(String(t.project_id||"")===String(p.id)) || (!t.project_id && linkCli(t.client_id)); if(!linked) return;
    if(t.completed_at) push(t.completed_at,"tarea","Tarea terminada"); else push(t.created_at,"tarea","Tarea nueva"); });
  (d.anticipos||[]).forEach((a:any)=>{ if(linkCli(a.client_id)) push(a.fecha, "anticipo", "Anticipo recibido", Number(a.monto)||0); });
  (d.expenses||[]).forEach((e:any)=>{ if(linkCli(e.client_id)) push(e.rendered_at||e.date||e.created_at,"gasto","Movimiento de gastos"); });
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
    // value: "off"=apagado · "on"=todo el equipo · lista de iniciales ("CL" o "CL,EE")=solo a esas personas.
    let scope = "on";
    if (esCron && !testTo) {
      const { data: cfg } = await sb.from("learnings").select("value").eq("kind","config").eq("key","cartera_semanal").maybeSingle();
      const val = (cfg?.value || "off").trim();
      if (val === "off") return new Response(JSON.stringify({ ok:true, skipped:"apagado" }), { headers:{ "Content-Type":"application/json" } });
      scope = val;
    }
    const soloInis: string[] | null = (scope && scope !== "on") ? scope.toUpperCase().split(/[,\s]+/).filter(Boolean) : null;

    // ── Datos. El cron arranca en frío y a veces alguna consulta en paralelo falla en silencio
    // (data null) → reintentar hasta que las 6 vengan completas, para no enviar un correo con cifras vacías.
    const fetchAll = async () => {
      let last:any = null;
      for (let att=0; att<4; att++){
        const res = await Promise.all([
          sb.from("proyectos_cartera").select("*").eq("activo",true),
          sb.from("clients").select("id,name"),
          sb.from("billing").select("id,client_id,sale_id,status,billing_type,invoice_no,issued_at,paid_at,due,amount,deleted_at"),
          sb.from("tasks").select("id,client_id,project_id,title,status,due,created_at,completed_at,who,assignees"),
          sb.from("anticipos").select("client_id,monto,fecha,estado"),
          sb.from("expenses").select("client_id,date,rendered_at,created_at"),
        ]);
        const fallo = res.find((r:any)=> r.error || r.data===null);   // data:[] (vacío legítimo) NO cuenta como fallo
        if (!fallo) return res;
        last = fallo.error;
        await new Promise(r=>setTimeout(r, 300*(att+1)));
      }
      throw new Error("No se pudieron cargar los datos: "+(last?.message||"consulta vacía"));
    };
    const [{ data: proyectos }, { data: clients }, { data: billing }, { data: tasks }, { data: anticipos }, { data: expenses }] = await fetchAll();
    const d = { billing:billing||[], tasks:(tasks||[]).filter((t:any)=>t.status!=="Terminado"), tasksAll:tasks||[], anticipos:anticipos||[], expenses:expenses||[] };
    const cname = (id:any)=> (clients||[]).find((c:any)=>String(c.id)===String(id))?.name || "";

    const hoyCL = new Date().toLocaleDateString("en-CA",{ timeZone:"America/Santiago" });
    const t0 = Date.parse(hoyCL);
    const diasDe = (iso:string)=> iso ? Math.round((t0 - Date.parse(String(iso).slice(0,10))) / 86400000) : null;   // + = pasado
    const faltanDe = (iso:string)=> iso ? Math.round((Date.parse(String(iso).slice(0,10)) - t0) / 86400000) : null;   // + = futuro
    const fDia = (iso:string)=>{ try { return new Date(String(iso).slice(0,10)+"T00:00:00").toLocaleDateString("es-CL",{ day:"numeric", month:"short" }); } catch { return String(iso); } };

    // Rango de la semana en curso (lunes a domingo) para el saludo.
    const _hoy = new Date(hoyCL+"T00:00:00Z");
    const _dow = (_hoy.getUTCDay()+6)%7;                             // 0 = lunes
    const _lun = new Date(_hoy); _lun.setUTCDate(_hoy.getUTCDate()-_dow);
    const _dom = new Date(_lun); _dom.setUTCDate(_lun.getUTCDate()+6);
    const _mLun = _lun.toLocaleDateString("es-CL",{ month:"long", timeZone:"UTC" });
    const _mDom = _dom.toLocaleDateString("es-CL",{ month:"long", timeZone:"UTC" });
    const rango = _mLun===_mDom
      ? `Semana del ${_lun.getUTCDate()} al ${_dom.getUTCDate()} de ${_mDom}`
      : `Semana del ${_lun.getUTCDate()} de ${_mLun} al ${_dom.getUTCDate()} de ${_mDom}`;

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
        const ult = evs[0] || null;                       // cualquier actividad (para "detenido")
        const dd = ult ? diasDe(ult.iso) : null;
        const mov = evs.find((e:any)=> e.tipo==="pago" || e.tipo==="factura" || e.tipo==="anticipo");   // "Se movió" = solo plata/facturas (las tareas van en Tus tareas)
        const dmov = mov ? diasDe(mov.iso) : null;
        if (mov && dmov!=null && dmov<=7) movio.push({ p, ult:mov, dd:dmov });
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

    // ── Diseño v6 (paleta C, maquetado a prueba de Gmail con tablas) ──
    const HAIR="#EAEEF0", INK="#1F2A30", MUT="#66787F", FAINT="#9DAEB4", NV="#003C50";
    const GRN="#147D5C", RED="#C0403E", AMB="#9A6410", GRNBG="#E8F4EE", REDBG="#FBECEB", AMBBG="#FAF0DA";
    const bt=(first:boolean)=> first?"":`border-top:1px solid ${HAIR};`;
    // Encabezado de sección: tick de color + label en mayúscula + subrayado fino.
    const sec = (label:string,color:string)=> `<div style="border-bottom:1px solid ${HAIR};padding-bottom:7px;margin:0 0 10px;"><span style="display:inline-block;width:3px;height:11px;background:${color};border-radius:2px;vertical-align:middle;margin-right:8px;"></span><span style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${color};vertical-align:middle;">${label}</span></div>`;
    const tbl = (rows:string)=> `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>`;
    const gap = (h:number)=> `<div style="height:${h}px;line-height:${h}px;font-size:1px;">&nbsp;</div>`;
    const mas = (n:number)=> n>0 ? `<div style="font-size:12px;color:${FAINT};margin-top:11px;">y ${n} tarea${n!==1?"s":""} más adelante</div>` : "";
    // Fila de tarea: título + cliente/fecha, con pastilla de urgencia a la derecha.
    const trTarea = (title:string, cliLine:string, pill:string, pillBg:string, pillCol:string, first:boolean)=>
      `<tr><td valign="top" style="padding:10px 0;${bt(first)}"><div style="font-size:14.5px;font-weight:600;color:${INK};line-height:1.4;">${esc(title||"Tarea")}</div><div style="font-size:12px;color:${MUT};margin-top:3px;">${cliLine}</div></td>`+
      `<td valign="top" align="right" style="padding:10px 0 10px 10px;${bt(first)}white-space:nowrap;"><span style="display:inline-block;font-size:10.5px;font-weight:700;color:${pillCol};background:${pillBg};border-radius:7px;padding:4px 10px;">${esc(pill)}</span></td></tr>`;
    // Fila de movimiento: punto verde + nombre/subtítulo, monto grande a la derecha.
    const trMov = (name:string, sub:string, monto:number, first:boolean)=>
      `<tr><td valign="middle" style="padding:12px 0;${bt(first)}"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${GRN};vertical-align:middle;margin-right:11px;"></span><span style="display:inline-block;vertical-align:middle;"><span style="display:block;font-size:14px;font-weight:600;color:${INK};">${esc(name||"Cliente")}</span><span style="display:block;font-size:11.5px;color:${MUT};margin-top:2px;">${esc(sub)}</span></span></td>`+
      `<td valign="middle" align="right" style="padding:12px 0;${bt(first)}white-space:nowrap;">${monto>0?`<span style="font-size:15px;font-weight:800;color:${GRN};">${esc(fmt(monto))}</span>`:""}</td></tr>`;
    const cliDate = (cli:string, verbo:string, iso:string)=> `${cli?esc(cli)+" · ":""}${verbo} ${fDia(iso)}`;
    const pillVenc = (f:number)=> f===-1?"ayer":`hace ${-f} días`;
    const pillProx = (f:number)=> f===0?"hoy":f===1?"mañana":`en ${f} días`;

    // Bloque "Tus tareas": adaptativo — si hay vencidas, secciones Vencidas + Esta semana; si no, una sola Tus tareas.
    const tareasHtml = (dg:any) => {
      const rowsVenc = (arr:any[])=> arr.map((x:any,i:number)=> trTarea(x.t.title, cliDate(cname(x.t.client_id),"venció el",x.t.due), pillVenc(x.f), REDBG, RED, i===0)).join("");
      const rowsSem  = (arr:any[])=> arr.map((x:any,i:number)=> trTarea(x.t.title, cliDate(cname(x.t.client_id),"vence el",x.t.due), pillProx(x.f), AMBBG, AMB, i===0)).join("");
      if (dg.vencidas.length) {
        let h = sec("Vencidas",RED) + tbl(rowsVenc(dg.vencidas));
        if (dg.semana.length) h += gap(22) + sec("Esta semana",AMB) + tbl(rowsSem(dg.semana));
        return h + mas(dg.futuras.length) + gap(26);
      }
      if (dg.semana.length) return sec("Tus tareas",NV) + tbl(rowsSem(dg.semana)) + mas(dg.futuras.length) + gap(26);
      if (dg.nTareas) return sec("Tus tareas",NV) + `<div style="font-size:12.5px;color:${MUT};">${dg.nTareas} tarea${dg.nTareas!==1?"s":""} en curso, ninguna vence esta semana.</div>` + gap(26);
      return "";
    };

    // "Para revisar": los proyectos detenidos como una sola línea (no un muro de nombres).
    const revisarHtml = (dg:any) => dg.detenidos.length
      ? sec("Para revisar",AMB) + `<div style="background:#F5F7F8;border-left:3px solid ${AMB};border-radius:0 10px 10px 0;padding:13px 15px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="font-size:13px;color:${INK};line-height:1.4;"><b style="color:${AMB};font-weight:700;">${dg.detenidos.length} proyecto${dg.detenidos.length!==1?"s":""}</b> sin mover hace más de 3 semanas</td><td align="right" valign="top" style="white-space:nowrap;padding-left:10px;"><a href="https://gestion.leabogados.cl" style="font-size:12px;font-weight:700;color:${NV};text-decoration:none;">Abrir &rarr;</a></td></tr></table></div>` + gap(26)
      : "";

    const armarHtml = (ini:string, dg:any, nSem:number, equipoBloque:string) => {
      const nombre = FIRST[ini] || "equipo";
      const resumen = nSem===0
        ? `No tienes tareas con vencimiento esta semana.`
        : `Tienes <b style="color:${INK};font-weight:700;">${nSem} tarea${nSem!==1?"s":""}</b> esta semana · ${dg.nVencen? `<span style="color:${RED};font-weight:700;">${dg.nVencen} vencida${dg.nVencen!==1?"s":""}</span>` : `<span style="color:${GRN};font-weight:700;">ninguna vencida</span>`}.`;
      const movHtml = dg.movio.length
        ? sec("Movimientos",GRN) + tbl(dg.movio.slice(0,5).map((r:any,i:number)=> trMov(cname(r.p.cliente_id), `${r.ult.texto} · ${fDia(r.ult.iso)}`, r.ult.monto, i===0)).join("")) + (dg.movio.length>5?`<div style="font-size:12px;color:${FAINT};margin-top:11px;">y ${dg.movio.length-5} más</div>`:"") + gap(26)
        : "";
      const tHtml = tareasHtml(dg);
      const rHtml = revisarHtml(dg);
      const sinNada = !tHtml && !movHtml && !equipoBloque && !rHtml;
      return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#ECEFF1;margin:0;padding:22px 12px;">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 26px rgba(0,44,64,.09);">
  <div style="background:#003C50;padding:20px 28px;text-align:center;"><img src="https://gestion.leabogados.cl/le-logo-blanco.png" alt="Liberona Escala Abogados" height="28" width="184" style="height:28px;width:184px;display:inline-block;border:0;"/></div>
  <div style="padding:26px;">
    <div style="font-size:18px;color:${INK};font-weight:700;letter-spacing:-.2px;">Hola, ${esc(nombre)}</div>
    <div style="font-size:12.5px;color:${MUT};margin-top:6px;margin-bottom:24px;line-height:1.55;"><span style="text-transform:uppercase;letter-spacing:.6px;font-size:10.5px;color:${FAINT};font-weight:600;">${esc(rango)}</span><br>${resumen}</div>
    ${tHtml}
    ${movHtml}
    ${equipoBloque}
    ${rHtml}
    ${sinNada ? `<div style="font-size:13px;color:${FAINT};margin-bottom:16px;">Sin novedades esta semana.</div>` : ""}
    <div style="margin-top:2px;"><a href="https://gestion.leabogados.cl" style="display:inline-block;background:#003C50;color:#fff;text-decoration:none;padding:8px 15px;border-radius:8px;font-size:11.5px;font-weight:700;letter-spacing:.2px;">Abrir mis proyectos &rarr;</a></div>
  </div>
  <div style="padding:18px 26px;border-top:1px solid ${HAIR};text-align:center;"><div style="font-size:11px;color:${FAINT};">gestion.leabogados.cl &middot; Liberona Escala Abogados</div></div>
</div></body></html>`;
    };

    // "Tu equipo" (solo para admin/Cristóbal): qué delegó y cómo va, por persona con tareas — sin "N proyectos".
    const equipoAdmin = () => {
      let filas = ""; let first = true;
      for (const i of Object.keys(FIRST)) {
        if (i==="CL") continue;
        const dgi = digestDe(i);
        if (!dgi.nTareas) continue;   // solo quien tiene tareas
        const vlist = dgi.vencidas.slice(0,2).map((x:any)=>`· ${esc(x.t.title||"Tarea")}${cname(x.t.client_id)?` — ${esc(cname(x.t.client_id))}`:""}`).join("<br>");
        const pill = dgi.nVencen ? `<span style="display:inline-block;font-size:10.5px;font-weight:700;color:${RED};background:${REDBG};border-radius:7px;padding:3px 9px;margin-left:6px;vertical-align:middle;">${dgi.nVencen} vencida${dgi.nVencen!==1?"s":""}</span>` : "";
        filas += `<tr><td style="padding:12px 0;${bt(first)}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="font-size:15px;font-weight:700;color:${INK};">${FIRST[i]}${pill}</td><td align="right" style="font-size:12px;color:${MUT};white-space:nowrap;">${dgi.nTareas} tarea${dgi.nTareas!==1?"s":""}</td></tr></table>${vlist?`<div style="font-size:12px;color:${RED};margin-top:6px;line-height:1.6;">${vlist}</div>`:""}</td></tr>`;
        first = false;
      }
      if(!filas) return "";
      return sec("Tu equipo",MUT) + tbl(filas) + gap(26);
    };

    const sent:any[] = [];
    const dryRun = !!body.dryRun;

    let destinos: string[] = testTo ? [ INI_DE_EMAIL[testTo] || "CL" ] : Object.keys(FIRST).filter(i=> (porResp[i]||[]).length || tareasDe(FIRST[i]).length);
    if (soloInis) destinos = destinos.filter(i => soloInis.includes(i));   // alcance por persona (interruptor = lista de iniciales)
    for (const ini of destinos) {
      const to = testTo || EMAIL[ini];
      if (!to) continue;
      const dg = digestDe(ini);
      const nSem = dg.vencidas.length + dg.semana.length;
      const equipoBloque = (ini==="CL") ? equipoAdmin() : "";   // las tareas del equipo solo a Cristóbal
      const html = armarHtml(ini, dg, nSem, equipoBloque);
      const subject = dg.nVencen
        ? `Tus proyectos · ${dg.nVencen} vencida${dg.nVencen!==1?"s":""} esta semana`
        : nSem ? `Tus proyectos · ${nSem} tarea${nSem!==1?"s":""} esta semana`
        : `Tus proyectos de la semana`;
      if (!dryRun) await sendMail(to, subject, html);
      sent.push({ ini, to, nProy:dg.nProy, nTareas:dg.nTareas, vencidas:dg.nVencen, movio:dg.movio.length, detenidos:dg.detenidos.length, ...(dryRun?{subject,html}:{}) });
    }

    return new Response(JSON.stringify({ ok:true, modo: testTo?"prueba":"cron", dryRun, sent, count:sent.length }), { headers:{ "Content-Type":"application/json", "Access-Control-Allow-Origin":"*" } });
  } catch (err) {
    return new Response(JSON.stringify({ error:(err as Error).message }), { status:500, headers:{ "Content-Type":"application/json", "Access-Control-Allow-Origin":"*" } });
  }
});
