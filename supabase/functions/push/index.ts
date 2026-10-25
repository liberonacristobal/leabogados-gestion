// Edge Function: push — notificaciones al teléfono (Web Push).
//   · action 'clave'  → la clave pública VAPID con que el teléfono se suscribe.
//   · action 'probar' → envía una notificación de prueba a los dispositivos de quien llama.
// Los avisos reales los envían las funciones que ya avisan por correo (notify-task, conciliacion-auto) con _shared/push.ts.
// Auth: sesión de una persona del dominio de la oficina (verify_jwt + correo del dominio).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enviarPush, clavePublicaPush } from "../_shared/push.ts";

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const DOMINIO = "@leabogados.cl";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const sb = createClient(SB_URL, SERVICE_KEY);
    const { data: { user } } = await sb.auth.getUser(token);
    const email = (user?.email || "").toLowerCase();
    if (!email.endsWith(DOMINIO)) return json({ error: "No autorizado" }, 403);
    const body = await req.json().catch(() => ({}));
    if (body.action === "clave") {
      const clave = clavePublicaPush();
      return clave ? json({ clave }) : json({ error: "Las notificaciones aún no están configuradas en el servidor." }, 503);
    }
    if (body.action === "probar") {
      const r = await enviarPush(SB_URL, SERVICE_KEY, [email], { titulo: "Notificaciones activadas", cuerpo: "Desde ahora los avisos de la app llegan a este dispositivo.", url: "/?ir=tareas", etiqueta: "prueba" });
      return json({ ok: true, ...r });
    }
    return json({ error: "Acción desconocida" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
