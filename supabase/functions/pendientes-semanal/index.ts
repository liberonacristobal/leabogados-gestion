import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Correo semanal "Pendientes de tus clientes" por abogado responsable.
// ALCANCE (definido con el usuario): SOLO lo pendiente del cliente del abogado —
//   (1) Cobros ya recibidos, sin registrar: depósitos en la cuenta de la oficina, con cliente asignado, sin conciliar a su factura.
//   (2) Documentos duplicados por limpiar: folios repetidos + anticipos a mano que calzan con el banco (subconjunto SEGURO; el módulo Duplicados es la fuente completa).
// Nada de compras del SII, costos de oficina ni otras métricas.

const GMAIL_USER = Deno.env.get("GMAIL_USER") || "";
const GMAIL_PASS = Deno.env.get("GMAIL_PASS") || "";
const CRON_SECRET = Deno.env.get("PENDIENTES_SEMANAL_SECRET") || Deno.env.get("CRON_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const EMAIL: Record<string,string> = { "Cristóbal":"cl@leabogados.cl", "Erasmo":"ee@leabogados.cl", "Martín":"mc@leabogados.cl", "Martina":"mp@leabogados.cl", "Rodrigo":"rd@leabogados.cl" };
const NAME_OF_EMAIL: Record<string,string> = Object.fromEntries(Object.entries(EMAIL).map(([n,e])=>[e,n]));

const toAscii = (s:string) => String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[–—]/g,"-").replace(/[^\x20-\x7E]/g,"");
const qpSafe = (h:string) => String(h||"").replace(/[ \t]+$/gm,"");
const esc = (s:string) => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const fmt = (n:number) => new Intl.NumberFormat("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0}).format(Math.round(n||0));
const folioDig = (s:any) => { const f=String(s||"").replace(/^factura\s*/i,"").trim(); return /\d/.test(f)?f.replace(/\D/g,""):null; };

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

    // ── Autorización: (a) cron con secreto → corrida completa (o prueba dirigida con testTo); (b) usuario @leabogados.cl → solo a él.
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

    // Interruptor (solo la corrida real por cron). value: "off" | "on" | lista de nombres ("Cristóbal,Erasmo").
    let scope = "on";
    if (esCron && !testTo) {
      const { data: cfg } = await sb.from("learnings").select("value").eq("kind","config").eq("key","pendientes_semanal").maybeSingle();
      const val = (cfg?.value || "off").trim();
      if (val === "off") return new Response(JSON.stringify({ ok:true, skipped:"apagado" }), { headers:{ "Content-Type":"application/json" } });
      scope = val;
    }
    const soloNombres: string[] | null = (scope && scope !== "on") ? scope.split(/[,;]+/).map(s=>s.trim()).filter(Boolean) : null;

    // ── Datos (con reintento para no mandar cifras vacías si una consulta arranca en frío) ──
    const fetchAll = async () => {
      let last:any = null;
      for (let att=0; att<4; att++){
        const res = await Promise.all([
          sb.from("clients").select("id,name,abogado_responsable"),
          sb.from("billing").select("id,client_id,sale_id,invoice_no,status,amount,due,issued_at,paid_at,deleted_at,billing_type,receptor_name,sii_synced_at,sii_tipo_dte,dte_track_id"),
          sb.from("cartola_movimientos").select("id,fecha,monto,monto_conciliado,n_operacion,nombre_contraparte,cliente_id,tipo,estado,es_interno").eq("tipo","abono").in("estado",["pendiente","parcial"]),
          sb.from("anticipos").select("id,client_id,monto,fecha,nota"),
          sb.from("conciliacion").select("anticipo_id,tipo_destino"),
        ]);
        const fallo = res.find((r:any)=> r.error || r.data===null);
        if (!fallo) return res;
        last = fallo.error;
        await new Promise(r=>setTimeout(r, 300*(att+1)));
      }
      throw new Error("No se pudieron cargar los datos: "+(last?.message||"consulta vacía"));
    };
    const [{ data: clients }, { data: billing }, { data: movs }, { data: anticipos }, { data: conc }] = await fetchAll();

    const cli = (id:any)=> (clients||[]).find((c:any)=>String(c.id)===String(id));
    const cname = (id:any)=> cli(id)?.name || "Cliente";
    const respDeCliente = (cid:any)=> cli(cid)?.abogado_responsable || null;
    const ADMINS = ["Cristóbal","Erasmo"];   // lo sin responsable se informa a ambos admins

    const hoyCL = new Date().toLocaleDateString("en-CA",{ timeZone:"America/Santiago" });
    const t0 = Date.parse(hoyCL);
    const diasVenc = (iso:string)=> iso ? Math.round((t0 - Date.parse(String(iso).slice(0,10))) / 86400000) : null; // + = vencida
    const fDia = (iso:string)=>{ try { return new Date(String(iso).slice(0,10)+"T00:00:00").toLocaleDateString("es-CL",{ day:"numeric", month:"short" }); } catch { return String(iso); } };

    // Rango de la semana en curso (lunes a domingo) para el saludo.
    const _hoy = new Date(hoyCL+"T00:00:00Z");
    const _dow = (_hoy.getUTCDay()+6)%7;
    const _lun = new Date(_hoy); _lun.setUTCDate(_hoy.getUTCDate()-_dow);
    const _dom = new Date(_lun); _dom.setUTCDate(_lun.getUTCDate()+6);
    const _mLun = _lun.toLocaleDateString("es-CL",{ month:"long", timeZone:"UTC" });
    const _mDom = _dom.toLocaleDateString("es-CL",{ month:"long", timeZone:"UTC" });
    const rango = _mLun===_mDom
      ? `Semana del ${_lun.getUTCDate()} al ${_dom.getUTCDate()} de ${_mDom}`
      : `Semana del ${_lun.getUTCDate()} de ${_mLun} al ${_dom.getUTCDate()} de ${_mDom}`;

    // ── (1) Cobros ya recibidos, sin registrar ──
    // Abono con cliente asignado, sin conciliar (saldo>0). Contexto: facturas del cliente por cobrar (emitidas, no pagadas).
    const emitidasVivas = (billing||[]).filter((b:any)=> !b.deleted_at && b.invoice_no && /\d/.test(String(b.invoice_no)) && b.status!=="Anulada" && b.status!=="Pagado" && (b.billing_type||"")!=="reembolso");
    const cobrosDe: Record<string, any[]> = {};
    const sinRespCobros: any[] = [];   // abonos sin cliente, o con cliente sin abogado_responsable → van a ambos admins
    (movs||[]).forEach((m:any)=>{
      if (m.es_interno) return;
      const saldo = (Number(m.monto)||0) - (Number(m.monto_conciliado)||0);
      if (saldo <= 0) return;
      const resp = m.cliente_id ? respDeCliente(m.cliente_id) : null;
      if (!resp) { sinRespCobros.push({ fecha:m.fecha, saldo, op:m.n_operacion, quien: m.cliente_id?cname(m.cliente_id):(m.nombre_contraparte||""), conNombre: !!(m.cliente_id||m.nombre_contraparte) }); return; }
      // Contexto: facturas por cobrar del cliente + la que mejor calza por monto.
      const abiertas = emitidasVivas.filter((b:any)=> String(b.client_id)===String(m.cliente_id));
      const porCobrar = abiertas.reduce((s:number,b:any)=> s+(Number(b.amount)||0), 0);
      const vencidas = abiertas.filter((b:any)=> { const d=diasVenc(b.due); return d!=null && d>0; });
      let calza:any = null;
      for (const b of abiertas){ const a=Number(b.amount)||0; if(a && Math.abs(a-saldo)/Math.max(a,saldo) <= 0.02){ calza=b; break; } }
      (cobrosDe[resp]=cobrosDe[resp]||[]).push({ mov:m, saldo, cli:cname(m.cliente_id), porCobrar, nVenc:vencidas.length, calza, dvCalza: calza?diasVenc(calza.due):null });
    });
    Object.values(cobrosDe).forEach(arr=> arr.sort((a,b)=> b.saldo-a.saldo));
    sinRespCobros.sort((a,b)=> b.saldo-a.saldo);

    // ── (2) Documentos duplicados (subconjunto SEGURO: folios repetidos + anticipos a mano que calzan con el banco) ──
    const actB = (billing||[]).filter((b:any)=> !b.deleted_at && b.status!=="Anulada" && (b.billing_type||"")!=="reembolso");
    // Folios repetidos: mismo cliente + mismo folio (dígitos) en >1 factura → (n-1) por retirar.
    const folioGroups: Record<string, any[]> = {};
    actB.forEach((b:any)=>{ const f=folioDig(b.invoice_no); if(!f) return; const k=`${b.client_id}|${f}`; (folioGroups[k]=folioGroups[k]||[]).push(b); });
    const dupFolioDe: Record<string, any[]> = {};
    const sinRespDup: any[] = [];
    Object.values(folioGroups).forEach((g:any[])=>{
      if (g.length<2) return;
      const cid = g[0].client_id;
      const keep = [...g].sort((a,b)=> ((a.sii_synced_at?0:1)-(b.sii_synced_at?0:1)) || ((b.status==="Pagado"?1:0)-(a.status==="Pagado"?1:0)))[0];
      const drops = g.filter((x:any)=> x.id!==keep.id);
      const rec = { cli:cname(cid), folio:folioDig(keep.invoice_no), n:drops.length, monto:drops.reduce((s:number,d:any)=>s+(Number(d.amount)||0),0), tipo:"folio" };
      const resp = respDeCliente(cid);
      if (!resp) { sinRespDup.push(rec); return; }
      (dupFolioDe[resp]=dupFolioDe[resp]||[]).push(rec);
    });

    // Anticipos a mano que calzan con el banco (antDup, espejo del módulo).
    const bankAnt = new Set((conc||[]).filter((c:any)=> c.tipo_destino==="anticipo" && c.anticipo_id).map((c:any)=>String(c.anticipo_id)));
    const banksByCli: Record<string, any[]> = {};
    (anticipos||[]).filter((a:any)=> bankAnt.has(String(a.id))).forEach((a:any)=>{ const k=String(a.client_id); (banksByCli[k]=banksByCli[k]||[]).push(a); });
    const dupAntDe: Record<string, any[]> = {};
    (anticipos||[]).forEach((a:any)=>{
      if (bankAnt.has(String(a.id))) return;
      if (/·revisado/.test(a.nota||"")) return;
      const m = Number(a.monto)||0; if (m<=0) return;
      const bk = banksByCli[String(a.client_id)]||[]; if (!bk.length) return;
      const suma = bk.reduce((s:number,b:any)=> s+(Number(b.monto)||0), 0);
      if (Math.abs(suma-m)<=1 || bk.some((b:any)=> Math.abs((Number(b.monto)||0)-m)<=1)) {
        const rec = { cli:cname(a.client_id), monto:m, tipo:"anticipo", n:1 };
        const resp = respDeCliente(a.client_id);
        if (!resp) { sinRespDup.push(rec); return; }
        (dupAntDe[resp]=dupAntDe[resp]||[]).push({ cli:cname(a.client_id), monto:m });
      }
    });

    // ── Diseño (paleta C, a prueba de Gmail con tablas) ──
    const HAIR="#EAEEF0", INK="#1F2A30", MUT="#66787F", FAINT="#9DAEB4", NV="#003C50";
    const GRN="#147D5C", GRNBG="#E7F5EE", AMB="#9A6410", AMBBG="#FAF0DA";
    const sec = (n:string,label:string,color:string)=> `<div style="border-bottom:1px solid ${HAIR};padding-bottom:7px;margin:0 0 10px;"><span style="display:inline-block;width:3px;height:11px;background:${color};border-radius:2px;vertical-align:middle;margin-right:8px;"></span><span style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${color};vertical-align:middle;">${n} · ${label}</span></div>`;
    const cta = (txt:string,color:string)=> `<div style="margin-top:12px;"><a href="https://gestion.leabogados.cl" style="display:block;background:${color};color:#fff;text-decoration:none;padding:11px;border-radius:9px;font-size:12.5px;font-weight:700;text-align:center;">${txt} &rarr;</a></div>`;

    const cobrosHtml = (arr:any[]) => {
      if (!arr.length) return "";
      const rows = arr.map((x:any,i:number)=>{
        const first = i===0;
        const contexto = x.calza
          ? `Calza con la factura N°${esc(folioDig(x.calza.invoice_no)||"")} (${fmt(Number(x.calza.amount)||0)})${x.dvCalza!=null&&x.dvCalza>0?`, vencida hace ${x.dvCalza} días`:""}`
          : `${esc(x.cli)} tiene ${fmt(x.porCobrar)} en facturas por cobrar${x.nVenc?` · ${x.nVenc} vencida${x.nVenc!==1?"s":""}`:""}`;
        return `<tr><td style="padding:11px 0;${first?"":`border-top:1px solid ${HAIR};`}"><div style="font-size:14px;font-weight:700;color:${INK};">${esc(x.cli)}</div><div style="font-size:11px;color:${MUT};margin-top:3px;line-height:1.4;">Depósito del <b>${esc(fDia(x.mov.fecha))}</b> por ${fmt(x.saldo)}${x.mov.n_operacion?` · Op. ${esc(String(x.mov.n_operacion))}`:""}<br>${contexto}</div></td>`+
          `<td align="right" valign="top" style="padding:11px 0;${first?"":`border-top:1px solid ${HAIR};`}white-space:nowrap;"><span style="font-size:15px;font-weight:800;color:${GRN};">${fmt(x.saldo)}</span></td></tr>`;
      }).join("");
      const total = arr.reduce((s:number,x:any)=> s+x.saldo, 0);
      return `<div style="padding:16px 26px 4px;">${sec("1","Cobros ya recibidos, sin registrar",GRN)}`+
        `<div style="font-size:12.5px;color:${MUT};margin:0 0 14px;line-height:1.6;">Estos clientes <b style="color:${INK};">ya te pagaron</b> —hay un depósito en la cuenta corriente de la oficina— pero el pago <b style="color:${INK};">no está vinculado a su factura</b>, así que la factura sigue apareciendo como vencida. Revisa que el depósito corresponda y <b style="color:${INK};">concílialo</b>: la factura pasa a pagada y el vencido de tu cartera baja.</div>`+
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>`+
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${GRNBG};border-radius:12px;margin-top:13px;"><tr><td style="padding:13px 16px;font-size:12.5px;color:${GRN};font-weight:600;">${arr.length} cliente${arr.length!==1?"s":""} con pagos esperando</td><td align="right" style="padding:13px 16px;white-space:nowrap;"><span style="font-size:10.5px;color:${MUT};text-transform:uppercase;letter-spacing:.6px;">Por conciliar</span> <span style="font-size:16px;font-weight:800;color:${GRN};margin-left:6px;">${fmt(total)}</span></td></tr></table>`+
        cta("Conciliar estos cobros",GRN)+`</div>`;
    };

    const dupHtml = (folios:any[], ants:any[]) => {
      const total = folios.reduce((s:number,x:any)=> s+x.n, 0) + ants.length;
      if (!total) return "";
      const rowsF = folios.map((x:any,i:number)=> `<tr><td style="padding:11px 0;${i===0?"":`border-top:1px solid ${HAIR};`}"><div style="font-size:13.5px;font-weight:700;color:${INK};">${esc(x.cli)}</div><div style="font-size:11px;color:${MUT};margin-top:2px;">${x.n} folio${x.n!==1?"s":""} repetido${x.n!==1?"s":""}${x.folio?` · N° ${esc(x.folio)}`:""}</div></td><td align="right" valign="top" style="padding:11px 0;${i===0?"":`border-top:1px solid ${HAIR};`}white-space:nowrap;"><span style="font-size:11px;font-weight:700;color:${AMB};background:${AMBBG};border-radius:999px;padding:3px 11px;">${x.n} por revisar</span></td></tr>`).join("");
      const rowsA = ants.map((x:any,i:number)=> `<tr><td style="padding:11px 0;border-top:1px solid ${HAIR};"><div style="font-size:13.5px;font-weight:700;color:${INK};">${esc(x.cli)}</div><div style="font-size:11px;color:${MUT};margin-top:2px;">1 anticipo a mano que ya entró por el banco (${fmt(x.monto)})</div></td><td align="right" valign="top" style="padding:11px 0;border-top:1px solid ${HAIR};white-space:nowrap;"><span style="font-size:11px;font-weight:700;color:${AMB};background:${AMBBG};border-radius:999px;padding:3px 11px;">1 por revisar</span></td></tr>`).join("");
      const nCli = new Set([...folios.map((x:any)=>x.cli), ...ants.map((x:any)=>x.cli)]).size;
      return `<div style="padding:24px 26px 4px;">${sec("2","Documentos duplicados por limpiar",AMB)}`+
        `<div style="font-size:12.5px;color:${MUT};margin:0 0 14px;line-height:1.6;">Algunos de tus clientes tienen la <b style="color:${INK};">misma factura o anticipo cargado dos veces</b> (un folio repetido, o un pago a mano que también entró por el banco). Eso <b style="color:${INK};">infla su saldo y descuadra las cifras</b>. La app ya detectó cuál es el documento real y cuál la copia — tú solo <b style="color:${INK};">confirmas y retiras la copia</b> (reversible).</div>`+
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rowsF}${rowsA}</table>`+
        `<div style="font-size:11.5px;color:${FAINT};margin-top:10px;">${total} documento${total!==1?"s":""} duplicado${total!==1?"s":""} en ${nCli} de tus clientes.</div>`+
        cta("Limpiar estos duplicados",AMB)+`</div>`;
    };

    // Sección 3 (solo admins): depósitos y duplicados sin cliente/abogado, para que Cristóbal y Erasmo los tomen entre los dos.
    const AZBG = "#EAF0F3";
    const sinRespHtml = (cobros:any[], dups:any[]) => {
      const totCob = cobros.reduce((s:number,x:any)=> s+x.saldo, 0);
      const nItems = cobros.length + dups.reduce((s:number,x:any)=> s+(x.n||1), 0);
      if (!nItems) return "";
      const top = cobros.slice(0, 8);
      const rows = top.map((x:any,i:number)=> `<tr><td style="padding:11px 0;${i===0?"":`border-top:1px solid ${HAIR};`}"><div style="font-size:13.5px;font-weight:700;color:${INK};">${esc(x.quien || "Sin nombre en la cartola")}</div><div style="font-size:11px;color:${MUT};margin-top:3px;line-height:1.4;">Depósito del <b>${esc(fDia(x.fecha))}</b>${x.op?` · Op. ${esc(String(x.op))}`:""}${x.conNombre?"<br>Trae nombre — vincúlalo a su ficha":"<br>Identifícalo y asígnalo a un cliente"}</div></td><td align="right" valign="top" style="padding:11px 0;${i===0?"":`border-top:1px solid ${HAIR};`}white-space:nowrap;"><span style="font-size:15px;font-weight:800;color:${NV};">${fmt(x.saldo)}</span></td></tr>`).join("");
      const dupLine = dups.length ? `<div style="font-size:11.5px;color:${MUT};margin-top:10px;">Además, ${dups.reduce((s:number,x:any)=>s+(x.n||1),0)} documento(s) duplicado(s) de clientes sin abogado asignado.</div>` : "";
      const masCob = cobros.length>top.length ? `<div style="font-size:11.5px;color:${FAINT};margin-top:9px;">y ${cobros.length-top.length} depósito(s) más sin identificar.</div>` : "";
      return `<div style="padding:24px 26px 4px;">${sec("3","Sin responsable asignado",NV)}`+
        `<div style="background:${AZBG};border-radius:10px;padding:10px 13px;margin:0 0 13px;font-size:11.5px;color:${NV};line-height:1.5;">Estos depósitos <b>no tienen cliente ni abogado</b> asociado, así que no caen en la cartera de nadie. Aparecen en el correo de <b>Cristóbal y Erasmo</b> — <b>revísenlos entre los dos</b>: identifiquen de quién es cada uno y asígnenlo a su cliente para que deje de quedar suelto.</div>`+
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>`+
        masCob + dupLine +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${AZBG};border-radius:12px;margin-top:13px;"><tr><td style="padding:13px 16px;font-size:12.5px;color:${NV};font-weight:600;">${cobros.length} depósito${cobros.length!==1?"s":""} sin identificar <span style="color:${MUT};font-weight:400;">· entre los dos</span></td><td align="right" style="padding:13px 16px;white-space:nowrap;"><span style="font-size:10.5px;color:${MUT};text-transform:uppercase;letter-spacing:.6px;">Por asignar</span> <span style="font-size:16px;font-weight:800;color:${NV};margin-left:6px;">${fmt(totCob)}</span></td></tr></table>`+
        cta("Identificar y asignar",NV)+`</div>`;
    };

    const armar = (nombre:string, cobros:any[], folios:any[], ants:any[], srCobros:any[]=[], srDup:any[]=[]) => {
      const nCob = cobros.length, nDup = folios.reduce((s:number,x:any)=>s+x.n,0)+ants.length;
      const nSr = srCobros.length + srDup.reduce((s:number,x:any)=>s+(x.n||1),0);
      const resumen = (nCob||nDup||nSr)
        ? `${nCob?`<b style="color:${GRN};font-weight:700;">${nCob} cobro${nCob!==1?"s":""} por registrar</b>`:""}${nCob&&(nDup||nSr)?" · ":""}${nDup?`<b style="color:${AMB};font-weight:700;">${nDup} duplicado${nDup!==1?"s":""} por limpiar</b>`:""}${nDup&&nSr?" · ":""}${nSr?`<b style="color:${NV};font-weight:700;">${srCobros.length} depósito${srCobros.length!==1?"s":""} sin identificar</b>`:""}. Cada tema tiene su propia acción abajo.`
        : `Nada pendiente de tus clientes esta semana.`;
      const cH = cobrosHtml(cobros), dH = dupHtml(folios, ants), sH = sinRespHtml(srCobros, srDup);
      return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;background:#ECEFF1;padding:22px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 26px rgba(0,44,64,.09);">
  <div style="background:${NV};padding:20px 28px;text-align:center;"><img src="https://gestion.leabogados.cl/le-logo-blanco.png" alt="Liberona Escala Abogados" height="28" width="184" style="height:28px;width:184px;display:inline-block;border:0;"/></div>
  <div style="padding:26px 26px 10px;">
    <div style="font-size:19px;color:${INK};font-weight:800;letter-spacing:-.3px;">Hola, ${esc(nombre)}</div>
    <div style="font-size:12.5px;color:${MUT};margin-top:6px;line-height:1.55;"><span style="text-transform:uppercase;letter-spacing:.7px;font-size:10px;color:${FAINT};font-weight:700;">Pendientes de tus clientes · ${esc(rango)}</span><br>${resumen}</div>
  </div>
  ${cH}
  ${dH}
  ${sH}
  ${(!cH&&!dH&&!sH)?`<div style="padding:8px 26px 20px;font-size:13px;color:${FAINT};">Sin cobros por registrar ni duplicados por limpiar. Todo en orden.</div>`:`<div style="height:8px;"></div>`}
  <div style="padding:16px 26px;border-top:1px solid ${HAIR};text-align:center;"><div style="font-size:11px;color:${FAINT};">gestion.leabogados.cl · Liberona Escala Abogados</div></div>
</div></body></html>`;
    };

    const dryRun = !!body.dryRun;
    const sent:any[] = [];
    const haySinResp = sinRespCobros.length + sinRespDup.length > 0;
    // Destinatarios: quien tenga algo pendiente propio; y los admins también si hay algo sin responsable.
    let nombres = testTo ? [ NAME_OF_EMAIL[testTo] || "Cristóbal" ]
                         : Object.keys(EMAIL).filter(n=> (cobrosDe[n]||[]).length || (dupFolioDe[n]||[]).length || (dupAntDe[n]||[]).length || (haySinResp && ADMINS.includes(n)));
    if (soloNombres) nombres = nombres.filter(n=> soloNombres.includes(n));

    for (const nombre of nombres) {
      const to = testTo || EMAIL[nombre];
      if (!to) continue;
      const esAdmin = ADMINS.includes(nombre);
      const cobros = cobrosDe[nombre]||[], folios = dupFolioDe[nombre]||[], ants = dupAntDe[nombre]||[];
      const srCob = esAdmin ? sinRespCobros : [], srDup = esAdmin ? sinRespDup : [];
      const nCob = cobros.length, nDup = folios.reduce((s:number,x:any)=>s+x.n,0)+ants.length;
      const nSr = srCob.length + srDup.reduce((s:number,x:any)=>s+(x.n||1),0);
      if (!testTo && !nCob && !nDup && !nSr) continue;   // en cron real no mandar correos vacíos
      const html = armar(nombre, cobros, folios, ants, srCob, srDup);
      const partes:string[] = [];
      if (nCob) partes.push(`${nCob} cobro${nCob!==1?"s":""}`);
      if (nDup) partes.push(`${nDup} duplicado${nDup!==1?"s":""}`);
      if (srCob.length) partes.push(`${srCob.length} sin identificar`);
      const subject = partes.length ? `Pendientes · ${partes.join(" · ")}` : `Pendientes de tus clientes`;
      if (!dryRun) await sendMail(to, subject, html);
      sent.push({ nombre, to, cobros:nCob, duplicados:nDup, sinResp:nSr, ...(dryRun?{subject,html}:{}) });
    }

    return new Response(JSON.stringify({ ok:true, modo: testTo?"prueba":"cron", dryRun, sent, count:sent.length }), { headers:{ "Content-Type":"application/json", "Access-Control-Allow-Origin":"*" } });
  } catch (err) {
    return new Response(JSON.stringify({ error:(err as Error).message }), { status:500, headers:{ "Content-Type":"application/json", "Access-Control-Allow-Origin":"*" } });
  }
});
