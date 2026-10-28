// Registro de los correos que salen de la oficina (28-10-2026): cada envío exitoso deja una fila en correos_enviados (para quién y con
// qué asunto). Sirve para medir cuántos correos llegan y cuáles llevan a una acción (correos-resumen). Registrar nunca frena el envío.
import { SMTPClient as SMTPBase } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// deno-lint-ignore no-explicit-any
const lista = (v: any): string[] => (Array.isArray(v) ? v : String(v || "").split(/[,;]/)).map((x: unknown) => String(x).trim().toLowerCase()).filter(Boolean);

export class SMTPClient extends SMTPBase {
  // deno-lint-ignore no-explicit-any
  async send(msg: any) {
    await super.send(msg);
    try {
      const para = [...new Set([...lista(msg?.to), ...lista(msg?.cc)])].join(",");
      if (SB_URL && SB_KEY) {
        fetch(`${SB_URL}/rest/v1/correos_enviados`, { method: "POST", headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify({ para: para.slice(0, 400), asunto: String(msg?.subject || "").slice(0, 200) }) }).catch(() => {});
      }
    } catch (_) { /* el registro no frena el envío */ }
  }
}
