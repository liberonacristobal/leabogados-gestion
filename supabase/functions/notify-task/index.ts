import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const GMAIL_USER = Deno.env.get("GMAIL_USER") || "";
const GMAIL_PASS = Deno.env.get("GMAIL_PASS") || "";
const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// ─────────────────────────────────────────────────────────────────────────────
// QUIÉN PUEDE USAR ESTA FUNCIÓN.
//
// ESTABA ABIERTA A INTERNET. Sin `verify_jwt`, sin secreto y con CORS a `*`:
// un POST con {mail:{to,subject,html,attachments}} enviaba correo arbitrario,
// con adjuntos, DESDE LA CUENTA DEL ESTUDIO. La base no la protegía porque la
// función usa sus propias credenciales de Gmail.
//
// PONER verify_jwt = true NO LA CIERRA. La clave anónima del proyecto es un JWT
// válido firmado por el proyecto y viaja en el paquete que descarga el
// navegador: cualquiera que la lea sigue pasando. Por eso la comprobación va
// acá adentro y la clave anónima se rechaza explícitamente.
//
// Dos llamadores legítimos, y ninguno más:
//   · una persona del estudio, con su sesión iniciada;
//   · el servidor, con la clave de servicio, que nunca sale del servidor.
// ─────────────────────────────────────────────────────────────────────────────
const DOMINIO = "@leabogados.cl";

async function autorizar(req: Request): Promise<{ ok: true; quien: string } | { ok: false; motivo: string }> {
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!bearer) return { ok: false, motivo: "Falta el encabezado Authorization" };

  // Llamada de servidor a servidor.
  if (SERVICE_KEY && bearer === SERVICE_KEY) return { ok: true, quien: "servidor" };

  // La clave anónima está en el paquete del navegador: no identifica a nadie.
  if (ANON_KEY && bearer === ANON_KEY) {
    return { ok: false, motivo: "La clave anónima no autoriza: hace falta la sesión de una persona del estudio" };
  }

  // Sesión de una persona: se resuelve contra Auth y se exige el dominio.
  if (!SB_URL || !ANON_KEY) return { ok: false, motivo: "La función no está configurada para verificar sesiones" };
  let correo = "";
  try {
    const r = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${bearer}` },
    });
    if (!r.ok) return { ok: false, motivo: "Sesión inválida o expirada" };
    correo = String((await r.json())?.email || "").toLowerCase();
  } catch {
    return { ok: false, motivo: "No se pudo verificar la sesión" };
  }
  if (!correo.endsWith(DOMINIO)) return { ok: false, motivo: "La cuenta no es del estudio" };
  return { ok: true, quien: correo };
}

// El origen tampoco es cualquiera. No protege contra un llamador que no sea un
// navegador —para eso está `autorizar`— pero evita que una página cualquiera
// use esta función desde el navegador de alguien del estudio.
const ORIGENES = [
  "https://gestion.leabogados.cl",
  "https://taxiq.leabogados.cl",
  "http://localhost:5173",
  "http://localhost:3000",
];
const cors = (req: Request) => {
  const o = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": ORIGENES.includes(o) ? o : ORIGENES[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
};

const EMAILS: Record<string, string> = {
  "Martín": "mc@leabogados.cl",
  "Martin": "mc@leabogados.cl",
  "Martina": "mp@leabogados.cl",
  "Rodrigo": "rodrigo@leabogados.cl",
  "Erasmo": "ee@leabogados.cl",
  "Cristóbal": "cl@leabogados.cl",
  "Cristobal": "cl@leabogados.cl",
};

// Envío por SMTP robusto (denomailer) — reemplaza la implementación a mano que fallaba con "Bad resource ID".
async function sendViaSMTP(to: string, subject: string, html: string, fromName = "Liberona Escala Abogados", replyTo?: string) {
  const client = new SMTPClient({
    connection: {
      hostname: "smtp.gmail.com",
      port: 465,
      tls: true,
      auth: { username: GMAIL_USER, password: GMAIL_PASS },
    },
  });
  try {
    // From y Asunto SOLO ASCII (denomailer rompe el encoded-word RFC 2047 con tildes → correo crudo "con crush"). El cuerpo HTML conserva las tildes.
    const msg: Record<string, unknown> = { from: `${toAscii(fromName)} <${GMAIL_USER}>`, to, subject: toAscii(subject), html: qpSafe(html) };
    if (replyTo) msg.replyTo = replyTo;
    await client.send(msg);
  } finally {
    await client.close();
  }
}

// Envío genérico desde la cuenta de oficina, con adjunto PDF opcional y cc.
// Lo usa el fallback de rendiciones/liquidaciones cuando el usuario no tiene permiso gmail.send.
type MailAttachment = { base64: string; name?: string; mime?: string };
// denomailer arma mal los "encoded-word" RFC 2047 para encabezados con tildes (asunto/From): genera un token
// con espacios y sin plegar → rompe el bloque de encabezados y el correo entero llega como texto crudo.
// Solución: encabezados SOLO en ASCII (tildes fuera, guiones largos → "-"). El cuerpo conserva las tildes.
const toAscii = (s: string) =>
  String(s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E]/g, "");
// Quoted-printable codifica los espacios al final de línea como "=20"; si el cliente no los decodifica, se ven crudos en el correo.
// Los quitamos del HTML (por línea) antes de enviar. Cierra el bug de los "=20" sueltos en el cuerpo.
const qpSafe = (h: string) => String(h || "").replace(/[ \t]+$/gm, "");
async function sendMail(
  { to, cc, subject, html, text, pdfBase64, pdfName, attachments, fromName, replyTo }:
  { to: string; cc?: string; subject: string; html?: string; text?: string; pdfBase64?: string; pdfName?: string; attachments?: MailAttachment[]; fromName?: string; replyTo?: string },
) {
  const client = new SMTPClient({
    connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: GMAIL_USER, password: GMAIL_PASS } },
  });
  try {
    const msg: Record<string, unknown> = { from: `${toAscii(fromName || "Liberona Escala Abogados")} <${GMAIL_USER}>`, to, subject: toAscii(subject) };
    if (cc) msg.cc = cc;
    if (replyTo) msg.replyTo = replyTo;
    if (html) msg.html = qpSafe(html);
    msg.content = text || (html ? "Ver el contenido en formato HTML." : subject);
    // Lista unificada de adjuntos. Compat: pdfBase64/pdfName = un adjunto PDF.
    const atts: MailAttachment[] = (attachments && attachments.length)
      ? attachments
      : (pdfBase64 ? [{ base64: pdfBase64, name: pdfName || "documento.pdf", mime: "application/pdf" }] : []);
    if (atts.length) {
      // denomailer vuelve a codificar si recibe el adjunto ya en base64 (encoding:"base64") → archivo corrupto.
      // Lo decodificamos a bytes y lo pasamos como binario: denomailer codifica una sola vez, MIME correcto.
      msg.attachments = atts.map((a) => {
        const clean = String(a.base64).replace(/[\r\n\s]/g, "");
        const bytes = Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
        return { filename: a.name || "documento", content: bytes, encoding: "binary", contentType: a.mime || "application/octet-stream" };
      });
    }
    await client.send(msg);
  } finally {
    await client.close();
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });

  const permiso = await autorizar(req);
  if (!permiso.ok) {
    return new Response(JSON.stringify({ error: permiso.motivo }), {
      status: 403,
      headers: { "Content-Type": "application/json", ...cors(req) },
    });
  }

  try {
    const payload = await req.json();

    // ── Envío genérico (rendiciones / liquidaciones) con adjunto PDF, desde la cuenta de oficina ──
    if (payload && payload.mail) {
      const { to, cc, subject, html, text, pdfBase64, pdfName, attachments } = payload.mail;
      if (!to || !subject) {
        return new Response(JSON.stringify({ error: "Falta to o subject" }), {
          status: 400, headers: { "Content-Type": "application/json", ...cors(req) },
        });
      }
      await sendMail({ to, cc, subject, html, text, pdfBase64, pdfName, attachments });
      return new Response(JSON.stringify({ ok: true, sent_to: to, via: "servidor" }), {
        headers: { "Content-Type": "application/json", ...cors(req) },
      });
    }

    const { task, assignedBy, kind, notifyName } = payload;
    if (!task) {
      return new Response(JSON.stringify({ error: "Falta task" }), { status: 400 });
    }

    const tipo = kind || "nueva";
    const by = assignedBy || "el estudio";
    // Destinatario y mensaje según el tipo de aviso:
    //  nueva     → al asignado (task.who): "{asignador} te asignó una tarea".
    //  delegada  → al que asignó (assigned_by): "{responsable} delegó a {X} una tarea que asignaste".
    //  terminada → al que asignó (assigned_by): "{responsable} marcó como terminada una tarea que asignaste".
    let recipientName = task.who, subjectPrefix = "Nueva tarea", subtitle = `${by} te acaba de asignar una tarea.`;
    if (tipo === "delegada") {
      recipientName = notifyName || task.assigned_by;
      const delTo = Array.isArray(task.delegated_to) ? task.delegated_to.join(", ") : (task.delegated_to || "");
      subjectPrefix = "Tarea delegada";
      subtitle = `${task.delegated_by || task.who || by} delegó a ${delTo || "otra persona"} una tarea que asignaste.`;
    } else if (tipo === "terminada") {
      recipientName = notifyName || task.assigned_by;
      subjectPrefix = "Tarea terminada";
      subtitle = `${task.who || "El responsable"} marcó como terminada una tarea que asignaste.`;
    }
    const esCierreConReporte = tipo === "terminada" && !!task.completion_note;
    if (!recipientName && !esCierreConReporte) {
      return new Response(JSON.stringify({ skipped: true, reason: "Sin destinatario" }), { status: 200 });
    }
    const ADMINS = ["cl@leabogados.cl", "ee@leabogados.cl"];
    // Remitente (para excluirlo del CC): en terminada = quien cerró (task.who).
    const fromEmailEarly = EMAILS[tipo === "delegada" ? (task.delegated_by || by) : tipo === "terminada" ? (task.who || by) : by] || "";
    let toEmail = EMAILS[recipientName] || "";
    let ccEmail = "";
    if (esCierreConReporte) {
      // Reporte de cierre de un limited: SIEMPRE avisa a los admins (aunque el que asignó falte o sea el mismo que cerró).
      if (!toEmail) toEmail = ADMINS[0];
      ccEmail = ADMINS.filter((e) => e !== toEmail && e !== fromEmailEarly).join(", ");
    }
    if (!toEmail) {
      return new Response(JSON.stringify({ skipped: true, reason: `No hay email para ${recipientName}` }), { status: 200 });
    }

    const clienteName = task.client_name || "";
    const project = task.project || "";
    const titulo = task.title || "";
    const nota = String(task.note || task.descripcion || task.comentario || "").trim();
    // Reporte de cierre (solo tareas terminadas): detalle de la gestión + estado + adjuntos.
    const gestion = tipo === "terminada" ? String(task.completion_note || "").trim() : "";
    const estadoCierre = tipo === "terminada" ? String(task.completion_status || "") : "";
    const attachments: MailAttachment[] = Array.isArray(payload.attachments) ? payload.attachments : [];
    const attCount = attachments.length;
    // Motivo de la delegación (obligatorio): viaja al delegado y a quien asignó.
    const motivoDeleg = String(task.delegated_note || "").trim();
    const due = task.due ? new Date(task.due + "T00:00:00").toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" }) : "";
    // Urgencia del vencimiento: ≤ 2 días desde hoy → pill roja; si no, pill neutra.
    let dueUrgent = false;
    if (task.due) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const dueDate = new Date(task.due + "T00:00:00");
      dueUrgent = Math.round((dueDate.getTime() - today.getTime()) / 86400000) <= 2;
    }
    // "Agregar recordatorio": evento de Google Calendar pre-armado (un .ics adjunto es complejo en este envío).
    let calUrl = "https://gestion.leabogados.cl";
    if (task.due) {
      const d = String(task.due).replace(/-/g, "");
      const text = encodeURIComponent("Tarea: " + titulo);
      const details = encodeURIComponent((clienteName ? "Cliente: " + clienteName + "\n" : "") + "Asignada por " + by);
      calUrl = "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + text + "&dates=" + d + "T090000/" + d + "T091500&details=" + details + "&ctz=America/Santiago";
    }
    // HTML escaping para datos dinámicos (evita romper el markup con < > & en glosas/títulos).
    const esc = (s: string) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const tituloTrunc = titulo.length > 50 ? titulo.slice(0, 50) + "..." : titulo;
    const subject = clienteName ? `${subjectPrefix} | ${clienteName} | ${tituloTrunc}` : `${subjectPrefix} | ${tituloTrunc}`;
    const rowLabel = "color:#888888; font-size:12px; padding:6px 0; width:80px; vertical-align:top;";
    const rowVal = "font-size:13px; color:#1a1a1a; font-weight:500; padding:6px 0; vertical-align:top;";

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: Arial, Helvetica, sans-serif; background:#f0f2f4; margin:0; padding:20px;">
  <div style="max-width:560px; margin:0 auto; background:#ffffff; border-radius:12px; overflow:hidden; border:1px solid #e4e8eb;">
    <div style="background:#003C50; padding:20px 28px; text-align:center;">
      <img src="https://gestion.leabogados.cl/le-logo-blanco.png" alt="Liberona Escala Abogados" height="28" width="184" style="height:28px; width:184px; display:inline-block; border:0;" />
    </div>
    <div style="padding:28px;">
      <div style="font-size:16px; color:#1a1a1a; margin:0 0 6px;">Hola ${esc(recipientName)},</div>
      <div style="font-size:14px; color:#666666; margin:0 0 20px;">${esc(subtitle)}</div>

      <div style="background:#f5f5f5; border-radius:8px; padding:16px;">
        <div style="font-size:15px; font-weight:bold; color:#1a1a1a; margin-bottom:${nota ? "12px" : "10px"};">${esc(titulo)}</div>
        ${nota ? `<div style="border-left:2px solid #cccccc; padding:2px 0 2px 12px; margin:0 0 12px; color:#777777; font-style:italic; font-size:13px;">"${esc(nota)}"</div>` : ""}
        <table style="width:100%; border-collapse:collapse;">
          ${clienteName ? `<tr><td style="${rowLabel}">Cliente</td><td style="${rowVal}">${esc(clienteName)}</td></tr>` : ""}
          ${project ? `<tr><td style="${rowLabel}">Proyecto</td><td style="${rowVal}">${esc(project)}</td></tr>` : ""}
          ${due ? `<tr><td style="${rowLabel}">Vence</td><td style="padding:6px 0;"><span style="display:inline-block; padding:3px 10px; border-radius:12px; font-size:12px; font-weight:bold; background:${dueUrgent ? "#FCEBEB" : "#eeeeee"}; color:${dueUrgent ? "#A32D2D" : "#555555"};">${due}</span></td></tr>` : ""}
        </table>
      </div>
      ${motivoDeleg ? `<div style="background:#FDF6E7; border-left:3px solid #E0A93B; border-radius:8px; padding:12px 14px; margin:16px 0 0;">
        <div style="font-size:11px; font-weight:bold; color:#854F0B; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px;">Motivo de la delegación</div>
        <div style="font-size:13px; color:#1a1a1a; line-height:1.55; white-space:pre-wrap;">${esc(motivoDeleg)}</div>
      </div>` : ""}
      ${gestion ? `<div style="background:#E1F5EE; border-left:3px solid #1D9E75; border-radius:8px; padding:12px 14px; margin:16px 0 0;">
        <div style="font-size:11px; font-weight:bold; color:#0F6E56; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px;">Gestión realizada${estadoCierre ? ` <span style="display:inline-block; background:${/complet/i.test(estadoCierre) ? "#1D9E75" : "#E0A93B"}; color:#ffffff; border-radius:20px; padding:1px 8px; font-size:9px; letter-spacing:0.3px; vertical-align:1px;">${esc(estadoCierre)}</span>` : ""}</div>
        <div style="font-size:13px; color:#1a1a1a; line-height:1.55; white-space:pre-wrap;">${esc(gestion)}</div>
        ${attCount ? `<div style="font-size:12px; color:#0F6E56; margin-top:8px;">${attCount} documento${attCount > 1 ? "s" : ""} adjunto${attCount > 1 ? "s" : ""}</div>` : ""}
      </div>` : ""}

      <div style="margin-top:22px;">
        <a href="https://gestion.leabogados.cl" style="display:inline-block; background:#003C50; color:#ffffff; text-decoration:none; padding:8px 16px; border-radius:18px; font-size:12px; font-weight:bold;">Ver en la app &rarr;</a>
        <a href="${calUrl}" style="display:inline-block; background:#ffffff; color:#555555; text-decoration:none; padding:7px 14px; border-radius:18px; font-size:11px; font-weight:bold; border:1px solid #cccccc; margin-left:8px;">Agregar recordatorio</a>
      </div>
    </div>
    <div style="padding:16px 28px; border-top:1px solid #eeeeee;">
      <div style="font-size:11px; color:#999999;">gestion.leabogados.cl &middot; Liberona Escala Abogados</div>
    </div>
  </div>
</body>
</html>`;

    // Remitente híbrido: la persona que disparó el aviso (más personal, se puede responder) + la marca;
    // "Liberona Escala Abogados" a secas si es del sistema. Reply-To a esa persona cuando la conocemos.
    let fromPerson = by;
    if (tipo === "delegada") fromPerson = task.delegated_by || by;
    else if (tipo === "terminada") fromPerson = task.who || by;
    const fromEmail = EMAILS[fromPerson];
    const fromName = fromEmail ? `${fromPerson} - Liberona Escala Abogados` : "Liberona Escala Abogados";
    // "terminada" puede traer adjuntos (reporte de cierre) → sendMail (soporta adjuntos + from/replyTo).
    // El resto (nueva/delegada) sigue por sendViaSMTP, sin cambios.
    if (tipo === "terminada") {
      await sendMail({ to: toEmail, cc: ccEmail || undefined, subject, html, fromName, replyTo: fromEmail, attachments });
    } else {
      await sendViaSMTP(toEmail, subject, html, fromName, fromEmail);
    }

    return new Response(JSON.stringify({ ok: true, sent_to: toEmail }), {
      headers: { "Content-Type": "application/json", ...cors(req) },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...cors(req) },
    });
  }
});
