import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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

async function sendEmail(to: string, subject: string, html: string) {
  const boundary = "----=_Part_" + Math.random().toString(36).slice(2);
  const message = [
    `From: Gestión LE <${GMAIL_USER}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    ``,
    html,
    `--${boundary}--`,
  ].join("\r\n");

  const credentials = btoa(`\0${GMAIL_USER}\0${GMAIL_PASS}`);
  
  // Usar Gmail API via SMTP sobre HTTPS (Nodemailer-style via fetch a smtp2go o similar no disponible en Deno)
  // Usamos el endpoint de Gmail API REST
  const response = await fetch("https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "message/rfc822",
    },
    body: message,
  });

  return response;
}

async function sendViaSMTP(to: string, subject: string, html: string) {
  // Usar Resend como relay SMTP (más confiable en Deno/Edge)
  // Fallback: llamar a un relay SMTP externo
  const encoder = new TextEncoder();
  
  // Construcción del email en formato RFC 2822
  const emailContent = [
    `From: Gestión LE <${GMAIL_USER}>`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: quoted-printable`,
    ``,
    html,
  ].join("\r\n");

  // Enviar via Gmail SMTP usando Deno TCP
  const conn = await Deno.connectTls({
    hostname: "smtp.gmail.com",
    port: 465,
  });

  const reader = conn.readable.getReader();
  const writer = conn.writable.getWriter();

  const readLine = async (): Promise<string> => {
    let result = "";
    while (true) {
      const { value } = await reader.read();
      if (!value) break;
      result += new TextDecoder().decode(value);
      if (result.endsWith("\r\n")) break;
    }
    return result.trim();
  };

  const writeLine = async (line: string) => {
    await writer.write(encoder.encode(line + "\r\n"));
  };

  await readLine(); // greeting
  await writeLine(`EHLO leabogados.cl`);
  
  let resp = "";
  while (!resp.includes("250 ")) {
    resp = await readLine();
  }

  await writeLine(`AUTH PLAIN ${btoa(`\0${GMAIL_USER}\0${GMAIL_PASS}`)}`);
  await readLine(); // 235

  await writeLine(`MAIL FROM:<${GMAIL_USER}>`);
  await readLine();

  await writeLine(`RCPT TO:<${to}>`);
  await readLine();

  await writeLine(`DATA`);
  await readLine();

  await writeLine(emailContent + "\r\n.");
  await readLine();

  await writeLine(`QUIT`);
  
  reader.cancel();
  writer.close();
  conn.close();
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
    const { task, assignedBy } = await req.json();
    
    if (!task || !task.who) {
      return new Response(JSON.stringify({ error: "Falta task.who" }), { status: 400 });
    }

    const toEmail = EMAILS[task.who];
    if (!toEmail) {
      return new Response(JSON.stringify({ skipped: true, reason: `No hay email para ${task.who}` }), { status: 200 });
    }

    const clienteName = task.client_name || "";
    const project = task.project || "";
    const due = task.due ? new Date(task.due + "T00:00:00").toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" }) : "";
    const by = assignedBy || "el estudio";

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: 'Helvetica Neue', Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 20px;">
  <div style="max-width: 480px; margin: 0 auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
    <div style="background: #003C50; padding: 24px 28px;">
      <div style="color: #fff; font-size: 13px; letter-spacing: 1px; text-transform: uppercase; opacity: 0.7; margin-bottom: 4px;">Liberona Escala Abogados</div>
      <div style="color: #fff; font-size: 20px; font-weight: 600;">Nueva tarea asignada</div>
    </div>
    <div style="padding: 28px;">
      <div style="font-size: 18px; font-weight: 600; color: #1a1a1a; margin-bottom: 16px;">${task.title}</div>
      <table style="width: 100%; border-collapse: collapse;">
        ${clienteName ? `<tr><td style="padding: 8px 0; color: #666; font-size: 13px; width: 100px;">Cliente</td><td style="padding: 8px 0; font-size: 13px; color: #1a1a1a; font-weight: 500;">${clienteName}</td></tr>` : ""}
        ${project ? `<tr><td style="padding: 8px 0; color: #666; font-size: 13px;">Proyecto</td><td style="padding: 8px 0; font-size: 13px; color: #1a1a1a; font-weight: 500;">${project}</td></tr>` : ""}
        ${due ? `<tr><td style="padding: 8px 0; color: #666; font-size: 13px;">Vence</td><td style="padding: 8px 0; font-size: 13px; color: #C2382B; font-weight: 600;">${due}</td></tr>` : ""}
        ${task.note ? `<tr><td style="padding: 8px 0; color: #666; font-size: 13px;">Nota</td><td style="padding: 8px 0; font-size: 13px; color: #1a1a1a; font-style: italic;">${task.note}</td></tr>` : ""}
        <tr><td style="padding: 8px 0; color: #666; font-size: 13px;">Asignada por</td><td style="padding: 8px 0; font-size: 13px; color: #1a1a1a;">${by}</td></tr>
      </table>
      <div style="margin-top: 24px;">
        <a href="https://gestion.leabogados.cl" style="display: inline-block; background: #003C50; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 13px; font-weight: 600;">Ver en la app →</a>
      </div>
    </div>
    <div style="padding: 16px 28px; background: #f9f9f9; border-top: 1px solid #eee;">
      <div style="font-size: 11px; color: #999;">gestion.leabogados.cl · Liberona Escala Abogados</div>
    </div>
  </div>
</body>
</html>`;

    await sendViaSMTP(toEmail, `Nueva tarea: ${task.title}`, html);

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
