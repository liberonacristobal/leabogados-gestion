// notaria-semanal — digest semanal por abogado responsable de las OT de notaría
// PAGADAS a la notaría pero AÚN NO cobradas (rendidas) al cliente, con +30 días.
// Es "la app APRENDE + valor compounding": convierte el dato acumulado (gastos de notaría
// liquidados) en una acción concreta para cada socio ("cobra estas OT a tu cliente").
//
// Correos MIXTO: a cada responsable su lista filtrada por abogado_responsable; las OT sin
// responsable asignado van a los dos socios (Cristóbal + Erasmo) como aviso de asignación.
//
// Auth / disparo (calco de cartera-semanal):
//   (a) cron con secreto  → corrida real a todo el equipo (respeta el interruptor learnings config 'notaria_semanal').
//       body.testTo="cl@leabogados.cl" → prueba dirigida a un solo correo.
//   (b) usuario @leabogados.cl con JWT → prueba, se manda solo a quien lo pide.
//   body.dryRun=true → arma los correos y los devuelve, NO envía.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GMAIL_USER = Deno.env.get("GMAIL_USER") || "";
const GMAIL_PASS = Deno.env.get("GMAIL_PASS") || "";
const CRON_SECRET = Deno.env.get("NOTARIA_SEMANAL_SECRET") || Deno.env.get("CRON_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// abogado_responsable guarda el NOMBRE (no iniciales). Mapa nombre → correo.
const EMAIL_DE: Record<string,string> = { "Cristóbal":"cl@leabogados.cl", "Erasmo":"ee@leabogados.cl", "Martín":"mc@leabogados.cl", "Martina":"mp@leabogados.cl", "Rodrigo":"rd@leabogados.cl" };
const SOCIOS = ["Cristóbal","Erasmo"];
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, content-type" } });
  try {
    const body = await req.json().catch(()=>({}));
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    // ── Autorización
    let testTo: string | null = null;
    const esCron = !!CRON_SECRET && body.secret === CRON_SECRET;
    if (esCron) {
      if (body.testTo) testTo = String(body.testTo).toLowerCase().trim();
    } else {
      const auth = req.headers.get("authorization") || "";
      const jwt = auth.replace(/^Bearer\s+/i, "");
      const { data: u } = await sb.auth.getUser(jwt);
      const email = (u?.user?.email || "").toLowerCase();
      if (!email.endsWith("@leabogados.cl")) return new Response(JSON.stringify({ error:"No autorizado" }), { status:403, headers:{ "Content-Type":"application/json" } });
      testTo = email;
    }

    const dryRun = !!body.dryRun;

    // Interruptor (solo corrida real por cron; una prueba dirigida o un dryRun siempre pasan).
    // value: "off"=apagado · "on"=todo el equipo · lista de nombres/correos = solo esas personas.
    let scope = "on";
    if (esCron && !testTo && !dryRun) {
      const { data: cfg } = await sb.from("learnings").select("value").eq("kind","config").eq("key","notaria_semanal").maybeSingle();
      const val = (cfg?.value || "off").trim();
      if (val === "off") return new Response(JSON.stringify({ ok:true, skipped:"apagado" }), { headers:{ "Content-Type":"application/json" } });
      scope = val;
    }
    const soloResp: string[] | null = (scope && scope !== "on") ? scope.split(/[,;]+/).map(s=>norm(s)).filter(Boolean) : null;

    // ── Datos: gastos de notaría PAGADOS (a la notaría) y SIN rendir al cliente, +30 días.
    const fetchAll = async () => {
      let last:any = null;
      for (let att=0; att<4; att++){
        const res = await Promise.all([
          sb.from("expenses").select("id,client_id,amount,category,subcategory,ot_number,requirente,materia,notas,date,notaria_liquidado_at,no_descuenta_saldo")
            .not("notaria_liquidado_at","is",null).is("client_rendered_at",null).is("rendered_at",null).is("deleted_at",null),
          sb.from("clients").select("id,name,abogado_responsable"),
        ]);
        const fallo = res.find((r:any)=> r.error || r.data===null);
        if (!fallo) return res;
        last = fallo.error;
        await new Promise(r=>setTimeout(r, 300*(att+1)));
      }
      throw new Error("No se pudieron cargar los datos: "+(last?.message||"consulta vacía"));
    };
    const [{ data: gastos }, { data: clients }] = await fetchAll();
    const cli = new Map((clients||[]).map((c:any)=>[String(c.id), c]));

    const hoyCL = new Date().toLocaleDateString("en-CA",{ timeZone:"America/Santiago" });
    const t0 = Date.parse(hoyCL);
    const diasDe = (iso:string)=> iso ? Math.round((t0 - Date.parse(String(iso).slice(0,10))) / 86400000) : 0;
    const fDia = (iso:string)=>{ try { return new Date(String(iso).slice(0,10)+"T00:00:00").toLocaleDateString("es-CL",{ day:"numeric", month:"short" }); } catch { return String(iso); } };

    const _hoy = new Date(hoyCL+"T00:00:00Z");
    const mesAno = _hoy.toLocaleDateString("es-CL",{ month:"long", year:"numeric", timeZone:"UTC" });

    // Por rendir al cliente = mirror de gastosPorRendir (App.jsx:12514): no histórico y sin
    // rendir al cliente. Gate de notaría = notaria_liquidado_at (ya pagado a la notaría) +30 días.
    // OJO: NO se filtra paid_by_client — en notaría es default true (caja chica), no "cliente ya pagó".
    const filas = (gastos||[]).map((g:any)=>{
      const c = cli.get(String(g.client_id)) || null;
      return { g, c, resp: (c?.abogado_responsable||"").trim() || null, dias: diasDe(g.notaria_liquidado_at), monto: Number(g.amount)||0 };
    }).filter((f:any)=> f.dias >= 30 && f.g.no_descuenta_saldo !== true);

    // Agrupar por responsable → por cliente.
    const porResp: Record<string, any[]> = {};
    const SIN = "__SIN__";
    for (const f of filas) { const k = f.resp || SIN; (porResp[k]=porResp[k]||[]).push(f); }

    // ── Chrome del correo (calco visual de cartera-semanal) ──
    const HAIR="#EAEEF0", INK="#1F2A30", MUT="#66787F", FAINT="#9DAEB4", NV="#003C50";
    const RED="#C0403E", AMB="#9A6410", REDBG="#FBECEB", AMBBG="#FAF0DA";
    const bt=(first:boolean)=> first?"":`border-top:1px solid ${HAIR};`;
    const sec = (label:string,color:string)=> `<div style="border-bottom:1px solid ${HAIR};padding-bottom:7px;margin:0 0 10px;"><span style="display:inline-block;width:3px;height:11px;background:${color};border-radius:2px;vertical-align:middle;margin-right:8px;"></span><span style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${color};vertical-align:middle;">${label}</span></div>`;
    const tbl = (rows:string)=> `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>`;
    const gap = (h:number)=> `<div style="height:${h}px;line-height:${h}px;font-size:1px;">&nbsp;</div>`;
    // Tramo de antigüedad por color: verde→ámbar→rojo (a más días, más urgente el cobro).
    const pillDias = (d:number)=>{ const c = d>=90?RED:d>=60?AMB:MUT; const b = d>=90?REDBG:d>=60?AMBBG:"#F1F4F5"; return `<span style="display:inline-block;font-size:10.5px;font-weight:700;color:${c};background:${b};border-radius:7px;padding:3px 9px;">${d} días</span>`; };

    // Bloque de un cliente: nombre protagonista + sus OT (materia · fecha de pago · antigüedad) y monto al final.
    const bloqueCliente = (nombre:string, items:any[], first:boolean) => {
      const total = items.reduce((s:number,x:any)=>s+x.monto,0);
      const antiguo = Math.max(...items.map((x:any)=>x.dias));
      const lineas = items.sort((a:any,b:any)=>b.dias-a.dias).map((x:any)=>{
        const ot = x.g.ot_number ? `OT ${esc(x.g.ot_number)}` : "";
        const det = [x.g.materia, x.g.subcategory, x.g.requirente].map((s:any)=>String(s||"").trim()).filter(Boolean)[0] || x.g.category || "";
        const sub = [ot, det?esc(det):"", `pagada ${fDia(x.g.notaria_liquidado_at)}`].filter(Boolean).join(" · ");
        return `<tr><td valign="top" style="padding:7px 0;"><div style="font-size:12.5px;color:${MUT};line-height:1.4;">${sub}</div></td><td valign="top" align="right" style="padding:7px 0 7px 10px;white-space:nowrap;"><span style="font-size:13px;font-weight:700;color:${INK};">${esc(fmt(x.monto))}</span></td></tr>`;
      }).join("");
      return `<tr><td style="padding:14px 0;${bt(first)}">`
        + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>`
        + `<td style="font-size:15px;font-weight:700;color:${INK};">${esc(nombre||"Sin cliente")}</td>`
        + `<td align="right" style="white-space:nowrap;padding-left:10px;">${pillDias(antiguo)}</td></tr></table>`
        + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px;">${lineas}`
        + `<tr><td style="padding-top:6px;border-top:1px solid ${HAIR};font-size:11px;color:${FAINT};text-transform:uppercase;letter-spacing:.6px;">${items.length} OT por cobrar</td>`
        + `<td align="right" style="padding-top:6px;border-top:1px solid ${HAIR};white-space:nowrap;"><span style="font-size:14.5px;font-weight:800;color:${NV};">${esc(fmt(total))}</span></td></tr></table>`
        + `</td></tr>`;
    };

    const armarHtml = (nombre:string, items:any[], esAvisoSin:boolean) => {
      // Agrupar por cliente, ordenar clientes por su OT más antigua (más urgente arriba).
      const porCli: Record<string, any[]> = {};
      for (const x of items) { const k = x.c ? String(x.c.id) : "sin"; (porCli[k]=porCli[k]||[]).push(x); }
      const grupos = Object.values(porCli).sort((a:any,b:any)=> Math.max(...b.map((y:any)=>y.dias)) - Math.max(...a.map((y:any)=>y.dias)));
      const total = items.reduce((s:number,x:any)=>s+x.monto,0);
      const nOt = items.length, nCli = grupos.length;
      const bloques = grupos.map((g:any,i:number)=> bloqueCliente(g[0].c ? g[0].c.name : "Sin cliente asignado", g, i===0)).join("");
      const intro = esAvisoSin
        ? `Hay <b style="color:${RED};font-weight:700;">${nOt} OT</b> de notaría pagadas sin cliente asignado. Asígnalas para poder cobrarlas.`
        : `Tienes <b style="color:${INK};font-weight:700;">${nOt} OT</b> de notaría pagadas y sin cobrar a tus clientes, por un total de <b style="color:${NV};font-weight:700;">${esc(fmt(total))}</b>.`;
      return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#ECEFF1;margin:0;padding:22px 12px;">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 26px rgba(0,44,64,.09);">
  <div style="background:#003C50;padding:20px 28px;text-align:center;"><img src="https://gestion.leabogados.cl/le-logo-blanco.png" alt="Liberona Escala Abogados" height="28" width="184" style="height:28px;width:184px;display:inline-block;border:0;"/></div>
  <div style="padding:26px;">
    <div style="font-size:18px;color:${INK};font-weight:700;letter-spacing:-.2px;">Hola, ${esc(nombre)}</div>
    <div style="font-size:12.5px;color:${MUT};margin-top:6px;margin-bottom:24px;line-height:1.55;"><span style="text-transform:uppercase;letter-spacing:.6px;font-size:10.5px;color:${FAINT};font-weight:600;">Gastos de notaría por cobrar · ${esc(mesAno)}</span><br>${intro}</div>
    ${sec(esAvisoSin?"Sin cliente asignado":"Por cliente",esAvisoSin?RED:NV)}
    ${tbl(bloques)}
    ${gap(20)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F7F8;border-radius:12px;"><tr><td style="padding:14px 16px;font-size:12.5px;color:${MUT};">${nCli} cliente${nCli!==1?"s":""} · ${nOt} OT</td><td align="right" style="padding:14px 16px;white-space:nowrap;"><span style="font-size:11px;color:${FAINT};text-transform:uppercase;letter-spacing:.6px;">Total</span> <span style="font-size:16px;font-weight:800;color:${NV};margin-left:6px;">${esc(fmt(total))}</span></td></tr></table>
    ${gap(22)}
    <div style="margin-top:2px;"><a href="https://gestion.leabogados.cl" style="display:inline-block;background:#003C50;color:#fff;text-decoration:none;padding:9px 16px;border-radius:8px;font-size:11.5px;font-weight:700;letter-spacing:.2px;">Rendir estos gastos &rarr;</a></div>
  </div>
  <div style="padding:18px 26px;border-top:1px solid ${HAIR};text-align:center;"><div style="font-size:11px;color:${FAINT};">gestion.leabogados.cl &middot; Liberona Escala Abogados</div></div>
</div></body></html>`;
    };

    const sent:any[] = [];

    // Destinos: cada responsable con items; el grupo SIN responsable va a los dos socios.
    const enviar = async (to:string, nombre:string, items:any[], esAvisoSin:boolean) => {
      if (!items.length) return;
      const total = items.reduce((s:number,x:any)=>s+x.monto,0);
      const subject = esAvisoSin
        ? `Notaría · ${items.length} OT sin cliente asignado`
        : `Notaría · ${items.length} OT por cobrar (${fmt(total)})`;
      const html = armarHtml(nombre, items, esAvisoSin);
      if (!dryRun) await sendMail(to, subject, html);
      sent.push({ to, nombre, nOt:items.length, total, avisoSin:esAvisoSin, ...(dryRun?{subject,html}:{}) });
    };

    if (testTo) {
      // Prueba dirigida: al que la pide, con SU lista (o vacía → igual manda un resumen de su nombre).
      const nombre = NOMBRE_DE_EMAIL[testTo] || "equipo";
      const items = porResp[nombre] || [];
      await enviar(testTo, nombre, items, false);
    } else {
      for (const [resp, items] of Object.entries(porResp)) {
        if (resp === SIN) {
          for (const s of SOCIOS) { if (!soloResp || soloResp.includes(norm(s))) await enviar(EMAIL_DE[s], s, items, true); }
          continue;
        }
        const to = EMAIL_DE[resp];
        if (!to) continue;
        if (soloResp && !soloResp.includes(norm(resp)) && !soloResp.includes(norm(to))) continue;
        await enviar(to, resp, items, false);
      }
    }

    return new Response(JSON.stringify({ ok:true, modo: testTo?"prueba":"cron", dryRun, sent, count:sent.length }), { headers:{ "Content-Type":"application/json", "Access-Control-Allow-Origin":"*" } });
  } catch (err) {
    return new Response(JSON.stringify({ error:(err as Error).message }), { status:500, headers:{ "Content-Type":"application/json", "Access-Control-Allow-Origin":"*" } });
  }
});
