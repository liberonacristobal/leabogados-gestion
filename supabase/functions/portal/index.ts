import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const DEBUG_SECRET = Deno.env.get("CRON_SECRET") || "";

const CORS = { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, content-type, apikey" };
const NOMBRE: Record<string,string> = { CL:"Cristóbal Liberona", EE:"Erasmo Escala", MC:"Martín", MP:"Martina", RD:"Rodrigo" };
const ETAPAS = ["Diagnóstico","Análisis","Borrador","Revisión del cliente","Ejecución","Cierre"];
const facturaEmitida = (b:any) => !!b.invoice_no && b.status!=="Programada" && b.status!=="Anulada" && b.billing_type!=="reembolso";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json().catch(()=>({}));
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    // ── Autorización: (a) usuario autenticado por correo (magic-link) → sus clientes; (b) debug con secreto + client_id (pruebas).
    let clientIds: string[] = [];
    if (DEBUG_SECRET && body.secret === DEBUG_SECRET && body.client_id) {
      clientIds = [String(body.client_id)];
    } else {
      const jwt = (req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
      const { data: u } = await sb.auth.getUser(jwt);
      const email = (u?.user?.email || "").toLowerCase().trim();
      if (!email) return new Response(JSON.stringify({ error:"No autorizado" }), { status:401, headers:{ ...CORS, "Content-Type":"application/json" } });
      // El correo del cliente mapea a su(s) ficha(s), solo si el portal está activado.
      const { data: cs } = await sb.from("clients").select("id,email,portal_activo").eq("portal_activo", true);
      clientIds = (cs||[]).filter((c:any)=> (c.email||"").toLowerCase().trim() === email).map((c:any)=> String(c.id));
      if (!clientIds.length) return new Response(JSON.stringify({ error:"sin_acceso" }), { status:403, headers:{ ...CORS, "Content-Type":"application/json" } });
    }

    // ── Datos (solo de esos clientes). Chequear error de cada consulta: si una falla (p. ej. permission
    // denied de service_role), devolver 500 en vez de mostrarle al cliente un portal vacío como si no tuviera nada.
    const rC = await sb.from("clients").select("id,name,portal_activo").in("id", clientIds);
    const rP = await sb.from("proyectos_cartera").select("*").in("cliente_id", clientIds).eq("activo", true);
    const rB = await sb.from("billing").select("id,client_id,invoice_no,status,billing_type,concept,amount,issued_at,paid_at,due,deleted_at").in("client_id", clientIds);
    const dbErr = rC.error || rP.error || rB.error;
    if (dbErr) return new Response(JSON.stringify({ error:"db", detail:dbErr.message }), { status:500, headers:{ ...CORS, "Content-Type":"application/json" } });
    const clients = rC.data, proyectos = rP.data, billing = rB.data;

    const out = (clients||[]).map((c:any) => {
      const asuntos = (proyectos||[]).filter((p:any)=> String(p.cliente_id)===String(c.id) && !p.pausado).map((p:any)=>({
        nombre: p.nombre_proyecto || "Asunto",
        etapa: ETAPAS[p.etapa_idx||0] || "En curso",
        avance: Math.round(((p.etapa_idx||0)/5)*100),
        proximo: p.plazo_label || null,
        vence: p.plazo || null,
      }));
      const facturas = (billing||[]).filter((b:any)=> String(b.client_id)===String(c.id) && !b.deleted_at && facturaEmitida(b))
        .sort((a:any,b:any)=> String(b.issued_at||"").localeCompare(String(a.issued_at||"")))
        .map((b:any)=>({
          folio: b.invoice_no, concepto: b.concept || "Honorarios", monto: b.amount||0,
          pagada: !!b.paid_at && b.status==="Pagado", vence: b.due || b.issued_at || null,
          estado: (b.paid_at && b.status==="Pagado") ? "Pagada" : (b.status==="Vencido" ? "Vencida" : "Pendiente"),
        }));
      const saldo = facturas.filter((f:any)=> !f.pagada).reduce((a:number,f:any)=> a + (f.monto||0), 0);
      return { cliente:{ id:c.id, name:c.name }, asuntos, facturas, saldo };
    });

    return new Response(JSON.stringify({ ok:true, clientes: out }), { headers:{ ...CORS, "Content-Type":"application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error:(err as Error).message }), { status:500, headers:{ ...CORS, "Content-Type":"application/json" } });
  }
});
