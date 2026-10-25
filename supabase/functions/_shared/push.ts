// push.ts — notificaciones al teléfono (Web Push). Fuente única para las funciones del servidor que avisan a una persona.
// Llegan a los dispositivos donde la persona las activó (tabla push_suscripciones, desde la página Notificaciones de la app).
// En el iPhone requieren la app agregada a la pantalla de inicio. Solo avisos internos del equipo: nunca a clientes.
// Claves VAPID en los secretos del proyecto (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT). Sin claves no envía ni falla.
//
// Cada aviso tiene un TIPO (TIPOS_PUSH): cada dispositivo puede apagar los que no quiere (push_suscripciones.tipos_off).
// Horario de silencio 21:00–8:00 (hora de Chile): lo que llega de noche queda en push_cola y sale junto a las 8:00
// (función push, action 'cola'). Las causas en tabla no esperan: son del mismo día.
import webpush from "npm:web-push@3.6.7";
import { ESTUDIO_ID } from "./equipo.js";

export interface AvisoPush { titulo: string; cuerpo: string; url?: string; etiqueta?: string }
export type TipoPush = "tareas" | "causas" | "fondos" | "notaria" | "clientes" | "pagos" | "normativa" | "sistema" | "prueba";
const SIN_SILENCIO: TipoPush[] = ["causas"];

let listo: boolean | null = null;
function configurar(): boolean {
  if (listo !== null) return listo;
  const pub = Deno.env.get("VAPID_PUBLIC_KEY") || "", priv = Deno.env.get("VAPID_PRIVATE_KEY") || "";
  const sub = Deno.env.get("VAPID_SUBJECT") || "mailto:contacto@leabogados.cl";
  listo = !!(pub && priv);
  if (listo) webpush.setVapidDetails(sub, pub, priv);
  return listo;
}

export const horaChile = (d = new Date()) => Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Santiago", hour: "numeric", hourCycle: "h23" }).format(d));
export const enSilencio = (d = new Date()) => { const h = horaChile(d); return h >= 21 || h < 8; };

const _norm = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

// Correos de las personas del equipo por su nombre (clients.abogado_responsable, sales.responsible): tabla miembros, solo de este
// estudio (otra fila con el mismo nombre de pila en otro estudio no recibe el aviso); incluye sus alias, porque la suscripción
// queda con el correo con que la persona entró.
export async function emailsDeNombres(sbUrl: string, serviceKey: string, nombres: (string | null | undefined)[]): Promise<string[]> {
  const ns = [...new Set(nombres.map((n) => _norm(n || "")).filter(Boolean))];
  if (!ns.length) return [];
  try {
    const r = await fetch(`${sbUrl}/rest/v1/miembros?select=nombre,email&estudio_id=eq.${encodeURIComponent(ESTUDIO_ID)}`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
    const ms: { nombre: string; email: string }[] = r.ok ? await r.json() : [];
    return ms.filter((m) => m.email && ns.some((n) => _norm(m.nombre) === n || _norm(m.nombre).split(" ")[0] === n)).map((m) => m.email);
  } catch (_) { return []; }
}

// Envía el aviso a todos los dispositivos activos de esos correos que no apagaron este tipo. De noche lo deja en la cola.
// Un dispositivo que el servicio da por inexistente (404/410) queda inactivo. Nunca lanza error: avisar no frena el proceso.
export async function enviarPush(sbUrl: string, serviceKey: string, emails: string[], aviso: AvisoPush, tipo: TipoPush, opts: { sinCola?: boolean } = {}): Promise<{ enviados: number; fallidos: number; enCola?: number; sinClaves?: boolean }> {
  const lista = [...new Set((emails || []).map((e) => String(e || "").trim().toLowerCase()).filter((e) => e.includes("@")))];
  if (!lista.length) return { enviados: 0, fallidos: 0 };
  if (!configurar()) return { enviados: 0, fallidos: 0, sinClaves: true };
  const H = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  if (!opts.sinCola && enSilencio() && !SIN_SILENCIO.includes(tipo)) {
    try {
      await fetch(`${sbUrl}/rest/v1/push_cola`, { method: "POST", headers: H, body: JSON.stringify(lista.map((email) => ({ email, tipo, titulo: aviso.titulo, cuerpo: aviso.cuerpo, url: aviso.url || "/" }))) });
      return { enviados: 0, fallidos: 0, enCola: lista.length };
    } catch (_) { return { enviados: 0, fallidos: 0 }; }
  }
  let subs: { id: string; endpoint: string; p256dh: string; auth: string; tipos_off: string[] }[] = [];
  try {
    const filtro = lista.map((e) => `"${e.replace(/"/g, "")}"`).join(",");
    const r = await fetch(`${sbUrl}/rest/v1/push_suscripciones?select=id,endpoint,p256dh,auth,email,tipos_off&activo=is.true&email=in.(${encodeURIComponent(filtro)})`, { headers: H });
    if (r.ok) subs = (await r.json()).filter((s: { tipos_off?: string[] }) => !(s.tipos_off || []).includes(tipo));
  } catch (_) { return { enviados: 0, fallidos: 0 }; }
  const carga = JSON.stringify({ titulo: aviso.titulo, cuerpo: aviso.cuerpo, url: aviso.url || "/", etiqueta: aviso.etiqueta || undefined });
  let enviados = 0, fallidos = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, carga, { TTL: 12 * 3600, urgency: tipo === "causas" ? "high" : "normal" });
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
