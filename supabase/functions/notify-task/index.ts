import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const GMAIL_USER = Deno.env.get("GMAIL_USER") || "";
const GMAIL_PASS = Deno.env.get("GMAIL_PASS") || "";

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
async function sendViaSMTP(to: string, subject: string, html: string) {
  const client = new SMTPClient({
    connection: {
      hostname: "smtp.gmail.com",
      port: 465,
      tls: true,
      auth: { username: GMAIL_USER, password: GMAIL_PASS },
    },
  });
  try {
    await client.send({
      from: `Gestión LE <${GMAIL_USER}>`,
      to,
      subject,
      html,
    });
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
async function sendMail(
  { to, cc, subject, html, text, pdfBase64, pdfName, attachments }:
  { to: string; cc?: string; subject: string; html?: string; text?: string; pdfBase64?: string; pdfName?: string; attachments?: MailAttachment[] },
) {
  const client = new SMTPClient({
    connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: GMAIL_USER, password: GMAIL_PASS } },
  });
  try {
    const msg: Record<string, unknown> = { from: `Gestion LE <${GMAIL_USER}>`, to, subject: toAscii(subject) };
    if (cc) msg.cc = cc;
    if (html) msg.html = html;
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
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    const payload = await req.json();

    // ── Envío genérico (rendiciones / liquidaciones) con adjunto PDF, desde la cuenta de oficina ──
    if (payload && payload.mail) {
      const { to, cc, subject, html, text, pdfBase64, pdfName, attachments } = payload.mail;
      if (!to || !subject) {
        return new Response(JSON.stringify({ error: "Falta to o subject" }), {
          status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }
      await sendMail({ to, cc, subject, html, text, pdfBase64, pdfName, attachments });
      return new Response(JSON.stringify({ ok: true, sent_to: to, via: "servidor" }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
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
    if (!recipientName) {
      return new Response(JSON.stringify({ skipped: true, reason: "Sin destinatario" }), { status: 200 });
    }
    const toEmail = EMAILS[recipientName];
    if (!toEmail) {
      return new Response(JSON.stringify({ skipped: true, reason: `No hay email para ${recipientName}` }), { status: 200 });
    }

    const clienteName = task.client_name || "";
    const project = task.project || "";
    const titulo = task.title || "";
    const nota = task.note || task.descripcion || task.comentario || "";
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

    await sendViaSMTP(toEmail, subject, html);

    return new Response(JSON.stringify({ ok: true, sent_to: toEmail }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
});
