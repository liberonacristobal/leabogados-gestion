import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Cobranza autónoma (Fase 3). DOBLE COMPUERTA: solo clientes LIBERADOS (learnings fd_auto:cobranza:<cid>)
// Y con el interruptor global encendido (learnings config cobranza_auto). Default OFF. Usuario = simulación (no envía).
const ESTUDIO = "Liberona Escala Abogados";
const CUENTA = { razon:"Liberona Escala Abogados Limitada", rut:"77.700.387-9", banco:"Banco BICE", cuenta:"1403834", email:"contacto@leabogados.cl" };
const GAP = 7; // días mínimos entre recordatorios de una misma factura

const GMAIL_USER = Deno.env.get("GMAIL_USER") || "";
const GMAIL_PASS = Deno.env.get("GMAIL_PASS") || "";
const CRON_SECRET = Deno.env.get("COBRANZA_AUTO_SECRET") || Deno.env.get("CRON_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const toAscii = (s:string) => String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[–—]/g,"-").replace(/[^\x20-\x7E]/g,"");
const qpSafe = (h:string) => String(h||"").replace(/[ \t]+$/gm,"");
const fmtN = (n:number) => "$"+Math.round(n||0).toLocaleString("es-CL");
const dmy = (d:string) => { const p=String(d||"").slice(0,10).split("-"); return p.length===3?`${p[2]}-${p[1]}-${p[0]}`:String(d||""); };
const dteMontoTotal = (xml:string) => { if(!xml) return null; const m=String(xml).match(/<MntTotal>\s*(\d+(?:\.\d+)?)\s*<\/MntTotal>/); return m?Math.round(+m[1]):null; };
const hoyISO = () => new Date(new Date().toLocaleString("en-US",{timeZone:"America/Santiago"})).toISOString().slice(0,10);
const diasEntre = (a:string,b:string) => Math.round((new Date(a+"T00:00").getTime()-new Date(String(b).slice(0,10)+"T00:00").getTime())/86400000);

async function sendMail(to:string, subject:string, html:string){
  const client = new SMTPClient({ connection:{ hostname:"smtp.gmail.com", port:465, tls:true, auth:{ username:GMAIL_USER, password:GMAIL_PASS } } });
  try { await client.send({ from:`${ESTUDIO} <${GMAIL_USER}>`, to, subject:toAscii(subject), content:"Ver el contenido en formato HTML.", html:qpSafe(html) }); }
  finally { await client.close(); }
}

function armarCorreo(items:any[], nivel:string){
  const total = items.reduce((a,x)=>a+x.saldo,0);
  const filas = items.map(x=>`<tr><td style="padding:6px 8px;border-bottom:1px solid #eee">${x.folio}</td><td style="padding:6px 8px;border-bottom:1px solid #eee">${x.venc?dmy(x.venc):"—"}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">${fmtN(x.saldo)}</td></tr>`).join("");
  const apertura = nivel==="final"
    ? `Reiteramos que las siguientes facturas se encuentran vencidas y aun sin pago. Les solicitamos regularizarlas con urgencia.`
    : `Nos dirigimos a ustedes para hacer presente que las siguientes facturas se encuentran pendientes y vencidas. Les agradeceremos regularizar el pago a la brevedad.`;
  const cta = `<div style="margin:14px 0;padding:12px 16px;background:#F7F9FA;border:1px solid #E4E8EB;border-radius:8px;font-size:13px;line-height:1.7"><div style="color:#537281;font-weight:600;margin-bottom:3px">Datos para el pago (transferencia)</div><div>${CUENTA.razon}</div><div><span style="color:#537281">RUT:</span> <b>${CUENTA.rut}</b></div><div><span style="color:#537281">${CUENTA.banco} · Cuenta corriente:</span> <b>${CUENTA.cuenta}</b></div><div><span style="color:#537281">Confirmacion a:</span> ${CUENTA.email}</div></div>`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e4e8eb;border-radius:12px;overflow:hidden"><div style="background:#003C50;padding:18px;text-align:center"><img src="https://gestion.leabogados.cl/le-logo-blanco.png" alt="${ESTUDIO}" height="26" style="height:26px"/></div><div style="padding:22px;color:#1a1a1a;font-size:14px;line-height:1.6">Estimados,<br><br>${apertura}<table style="width:100%;border-collapse:collapse;margin:14px 0;font-size:13px"><thead><tr style="color:#537281;text-transform:uppercase;font-size:10px"><th style="text-align:left;padding:6px 8px;border-bottom:1px solid #E4E8EB">Factura</th><th style="text-align:left;padding:6px 8px;border-bottom:1px solid #E4E8EB">Vencimiento</th><th style="text-align:right;padding:6px 8px;border-bottom:1px solid #E4E8EB">Monto</th></tr></thead><tbody>${filas}</tbody></table><div style="text-align:right;font-weight:700;font-size:14px;margin-bottom:6px">Total: ${fmtN(total)}</div>${cta}Si ya realizo el pago, por favor omita este mensaje. Quedamos atentos a su confirmacion.<br><br>Saludos cordiales,<br><b>${ESTUDIO}</b></div><div style="padding:14px 22px;border-top:1px solid #eee;font-size:11px;color:#999">gestion.leabogados.cl</div></div>`;
  const subject = `${nivel==="final"?"Pago vencido":"Recordatorio de cobro"} - ${ESTUDIO}`;
  return { subject, html, total };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, content-type" } });
  try {
    const body = await req.json().catch(()=>({}));
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const esCron = !!CRON_SECRET && body.secret === CRON_SECRET;
    // Usuario @leabogados.cl → SIEMPRE simulación (no envía a clientes). Solo el cron con secreto envía de verdad.
    let dry = !esCron || !!body.dryRun;
    if (!esCron) {
      const auth = req.headers.get("authorization") || "";
      const { data:{ user } } = await sb.auth.getUser(auth.replace(/^Bearer\s+/i,""));
      if (!String(user?.email||"").toLowerCase().endsWith("@leabogados.cl"))
        return new Response(JSON.stringify({ error:"No autorizado" }), { status:403, headers:{ "Content-Type":"application/json" } });
      dry = true;
    }
    // Interruptor global (solo afecta la corrida real por cron).
    if (esCron && !dry) {
      const { data: cfg } = await sb.from("learnings").select("value").eq("kind","config").eq("key","cobranza_auto").maybeSingle();
      if ((cfg?.value || "off").trim() === "off") return new Response(JSON.stringify({ ok:true, skipped:"apagado" }), { headers:{ "Content-Type":"application/json" } });
    }

    const [{ data: bills }, { data: clientes }, { data: learn }, { data: concil }] = await Promise.all([
      sb.from("billing").select("id,client_id,invoice_no,status,due,amount,paid_amount,dte_xml,billing_type,deleted_at"),
      sb.from("clients").select("id,name,email,status"),
      sb.from("learnings").select("kind,key,value").in("kind",["fd_auto","factura_recordado"]),
      sb.from("conciliacion").select("factura_id,monto_aplicado,tipo_destino"),
    ]);
    const liberados = new Set<string>(); const recMap:Record<string,string> = {};
    (learn||[]).forEach((r:any)=>{ if(r.kind==="fd_auto" && String(r.key).startsWith("cobranza:")) liberados.add(String(r.key).slice(9)); else if(r.kind==="factura_recordado") recMap[r.key]=r.value; });
    const respaldo:Record<string,number> = {};
    (concil||[]).forEach((c:any)=>{ if(c.tipo_destino==="factura" && c.factura_id) respaldo[c.factura_id]=(respaldo[c.factura_id]||0)+(Number(c.monto_aplicado)||0); });
    const cliDe = (id:any)=> (clientes||[]).find((c:any)=>String(c.id)===String(id));
    const hoy = hoyISO();

    // Agrupar por cliente liberado las facturas vencidas con recordatorio pendiente.
    const grupos:Record<string,any> = {};
    (bills||[]).forEach((b:any)=>{
      const cid = String(b.client_id||"");
      if(!liberados.has(cid)) return;
      if(!b.invoice_no || ["Programada","Anulada","Pagado"].includes(b.status) || b.billing_type==="reembolso" || b.deleted_at) return;
      const monto = (b.dte_xml?dteMontoTotal(b.dte_xml):null) ?? (b.amount||0);
      const saldo = Math.max(0, monto - Math.max(Number(b.paid_amount)||0, respaldo[b.id]||0));
      if(saldo<=0 || !b.due) return;
      const diasVenc = diasEntre(hoy, b.due); if(diasVenc<=0) return;   // solo vencidas
      const last = recMap[String(b.id)]; if(last && diasEntre(hoy,last)<GAP) return;   // piso de días
      (grupos[cid] = grupos[cid] || { cid, items:[], nivel:"firme" });
      grupos[cid].items.push({ id:b.id, folio:b.invoice_no?`Factura N°${b.invoice_no}`:"la factura", venc:b.due, saldo, diasVenc });
      if(diasVenc>30) grupos[cid].nivel = "final";
    });

    const plan:any[] = []; const enviados:any[] = [];
    for(const g of Object.values(grupos) as any[]){
      const cl = cliDe(g.cid); const to = String(cl?.email||"").trim();
      const { subject, html, total } = armarCorreo(g.items, g.nivel);
      const dest = body.testTo ? String(body.testTo) : to;
      plan.push({ cliente: cl?.name||"—", to: dest||"(sin correo)", nivel:g.nivel, facturas:g.items.length, total });
      if(dry || !dest || !/@/.test(dest)) continue;
      try{
        await sendMail(dest, subject, html);
        const at = new Date().toISOString();
        for(const it of g.items){ try{ await sb.from("learnings").upsert({kind:"factura_recordado",key:String(it.id),value:at},{onConflict:"kind,key"}); }catch(_){} }
        enviados.push({ cliente: cl?.name, to:dest, facturas:g.items.length, total });
      }catch(e){ enviados.push({ cliente: cl?.name, to:dest, error:String((e as Error).message) }); }
    }
    return new Response(JSON.stringify({ ok:true, modo: dry?"simulacion":"envio", clientes_liberados: liberados.size, plan, enviados }), { headers:{ "Content-Type":"application/json", "Access-Control-Allow-Origin":"*" } });
  } catch (err) {
    return new Response(JSON.stringify({ error:(err as Error).message }), { status:500, headers:{ "Content-Type":"application/json", "Access-Control-Allow-Origin":"*" } });
  }
});
