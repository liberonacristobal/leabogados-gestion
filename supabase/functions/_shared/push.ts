// push.ts — notificaciones al teléfono (Web Push). Fuente única para las funciones del servidor que avisan a una persona.
// Llegan a los dispositivos donde la persona las activó (tabla push_suscripciones, desde la página Notificaciones de la app).
// En el iPhone requieren la app agregada a la pantalla de inicio. Solo avisos internos del equipo: nunca a clientes.
// Claves VAPID en los secretos del proyecto (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT). Sin claves no envía ni falla.
import webpush from "npm:web-push@3.6.7";

export interface AvisoPush { titulo: string; cuerpo: string; url?: string; etiqueta?: string }

let listo: boolean | null = null;
function configurar(): boolean {
  if (listo !== null) return listo;
  const pub = Deno.env.get("VAPID_PUBLIC_KEY") || "", priv = Deno.env.get("VAPID_PRIVATE_KEY") || "";
  const sub = Deno.env.get("VAPID_SUBJECT") || "mailto:contacto@leabogados.cl";
  listo = !!(pub && priv);
  if (listo) webpush.setVapidDetails(sub, pub, priv);
  return listo;
}

// Envía el aviso a todos los dispositivos activos de esos correos. Un dispositivo que el servicio da por inexistente
// (404/410: la persona desinstaló la app o revocó el permiso) queda inactivo. Nunca lanza error: avisar no debe frenar
// el proceso que lo llama (el correo sigue siendo el respaldo).
export async function enviarPush(sbUrl: string, serviceKey: string, emails: string[], aviso: AvisoPush): Promise<{ enviados: number; fallidos: number; sinClaves?: boolean }> {
  const lista = [...new Set((emails || []).map((e) => String(e || "").trim().toLowerCase()).filter((e) => e.includes("@")))];
  if (!lista.length) return { enviados: 0, fallidos: 0 };
  if (!configurar()) return { enviados: 0, fallidos: 0, sinClaves: true };
  const H = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  let subs: { id: string; endpoint: string; p256dh: string; auth: string }[] = [];
  try {
    const filtro = lista.map((e) => `"${e.replace(/"/g, "")}"`).join(",");
    const r = await fetch(`${sbUrl}/rest/v1/push_suscripciones?select=id,endpoint,p256dh,auth,email&activo=is.true&email=in.(${encodeURIComponent(filtro)})`, { headers: H });
    if (r.ok) subs = await r.json();
  } catch (_) { return { enviados: 0, fallidos: 0 }; }
  const carga = JSON.stringify({ titulo: aviso.titulo, cuerpo: aviso.cuerpo, url: aviso.url || "/", etiqueta: aviso.etiqueta || undefined });
  let enviados = 0, fallidos = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, carga, { TTL: 12 * 3600, urgency: "normal" });
      enviados++;
      fetch(`${sbUrl}/rest/v1/push_suscripciones?id=eq.${s.id}`, { method: "PATCH", headers: H, body: JSON.stringify({ ultimo_envio_at: new Date().toISOString() }) }).catch(() => {});
    } catch (e) {
      fallidos++;
      const code = (e as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) await fetch(`${sbUrl}/rest/v1/push_suscripciones?id=eq.${s.id}`, { method: "PATCH", headers: H, body: JSON.stringify({ activo: false }) }).catch(() => {});
    }
  }));
  return { enviados, fallidos };
}

export const clavePublicaPush = () => Deno.env.get("VAPID_PUBLIC_KEY") || "";
