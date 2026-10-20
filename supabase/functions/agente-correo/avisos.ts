// Avisos de transferencias de los bancos (BICE y Banco de Chile por ahora; se agregan formatos sin tocar el resto).
// Lee del correo lo que la cartola no trae o trae oculto: contraparte (nombre, RUT, banco, cuenta) y el mensaje de la
// transferencia. Solo datos del texto del banco, sin IA. El calce con la cartola es exacto (ver calzarAviso).

export type Aviso = {
  banco: string; tipo: "abono" | "cargo"; monto: number; cuenta: string | null; fecha_hora: string | null; n_operacion: string | null;
  contraparte_nombre: string | null; contraparte_rut: string | null; contraparte_banco: string | null; contraparte_cuenta: string | null; mensaje: string | null;
};

const ENT: Record<string, string> = { aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", ntilde: "ñ", Ntilde: "Ñ", deg: "°", ordm: "º", iquest: "¿", iexcl: "¡", nbsp: " ", amp: "&", quot: '"', lt: "<", gt: ">", uuml: "ü" };
export const textoPlano = (s: string) => String(s || "")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&([a-zA-Z]+);/g, (m, n) => ENT[n] ?? m)
  .replace(/\s+/g, " ").trim();

// Cuenta como dígitos sin ceros a la izquierda (01-40383-4, 1403834 y 000000000001403834 son la misma).
export const cuentaNorm = (s: string | null | undefined) => String(s || "").replace(/\D/g, "").replace(/^0+/, "") || null;
const montoNum = (s: string) => Number(String(s).replace(/[^\d]/g, "")) || 0;
const limpio = (s: string | undefined | null) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t || null; };
const MES: Record<string, number> = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12, jan: 1, apr: 4, aug: 8, dec: 12 };
// Fecha y hora de Chile → ISO (con el desfase de Santiago de ese día).
function isoChile(y: number, m: number, d: number, hh = 12, mi = 0, ss = 0) {
  const guess = Date.UTC(y, m - 1, d, hh, mi, ss);
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Santiago", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(guess));
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  const enChile = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second"));
  return new Date(guess + (guess - enChile)).toISOString();
}
function fechaEn(t: string): string | null {
  let m = t.match(/(\d{1,2}) ([A-Za-zé]{3})\.? (\d{4}),? -? ?(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) { const mes = MES[m[2].toLowerCase().slice(0, 3)]; if (mes) return isoChile(+m[3], mes, +m[1], +m[4], +m[5], +(m[6] || 0)); }
  m = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2})/);
  if (m) return isoChile(+m[3], +m[2], +m[1], +m[4], +m[5]);
  return null;
}

export function leerAviso(de: string, asunto: string, cuerpo: string): Aviso | null {
  const t = textoPlano(cuerpo), dom = String(de || "").toLowerCase();
  // BICE · transferencia enviada desde una cuenta de la oficina.
  if (/bice\.cl/.test(dom) && /Se ha realizado la siguiente transferencia/i.test(t)) {
    const m = t.match(/Monto: \$ ?([\d.]+) Desde tu cuenta N° ?(\d+) Transferiste a: (.+?) RUT ([\d.]+-[\dkK]) (Banco .+?|.+?) (Cuenta (?:Corriente|Vista|de Ahorro|RUT)[^N]*N° ?[\d-]+)/i);
    if (!m) return null;
    const op = t.match(/Operaci[oó]n N° ?(\d+)/i), det = t.match(/Detalle: (.*?) Banco BICE\. Detalles que importan/i);
    return { banco: "BICE", tipo: "cargo", monto: montoNum(m[1]), cuenta: cuentaNorm(m[2]), fecha_hora: fechaEn(t), n_operacion: op?.[1] || null,
      contraparte_nombre: limpio(m[3]), contraparte_rut: m[4].toUpperCase(), contraparte_banco: limpio(m[5]), contraparte_cuenta: cuentaNorm(m[6].replace(/.*N°/, "")), mensaje: limpio(det?.[1]) };
  }
  // BICE · transferencia recibida en una cuenta de la oficina (desde otro cliente BICE).
  if (/bice\.cl/.test(dom) && /ha instruido realizar una transferencia a su cuenta/i.test(t)) {
    const m = t.match(/Monto: \$ ?([\d.]+) Tu cuenta: .*?N° ?(\d+)/i);
    if (!m) return null;
    const env = t.match(/Enviada por: (.+?) RUT: ?([\d.]+-[\dkK])/i), det = t.match(/Detalle: ?(.*?) ?(?:Enviada por:|\d{1,2} [a-z]{3}\.? \d{4})/i);
    const op = t.match(/Operaci[oó]n N° ?(\d+)/i);
    return { banco: "BICE", tipo: "abono", monto: montoNum(m[1]), cuenta: cuentaNorm(m[2]), fecha_hora: fechaEn(t), n_operacion: op?.[1] || null,
      contraparte_nombre: limpio(env?.[1]), contraparte_rut: env?.[2]?.toUpperCase() || null, contraparte_banco: "BICE", contraparte_cuenta: null, mensaje: limpio(det?.[1]) };
  }
  // BICE · «Recibiste una transferencia» (formato de personas).
  if (/bice\.cl/.test(dom) && /Recibiste una transferencia por/i.test(t)) {
    const m = t.match(/Monto \$ ?([\d.]+) Cuenta de origen Nombre (.+?) Banco (.+?) Cuenta de destino .*?N[uú]mero de cuenta (\d+)/i);
    if (!m) return null;
    const msj = t.match(/Mensaje (.*?) Operaci[oó]n/i), op = t.match(/N[uú]mero de operaci[oó]n (\d+)/i);
    return { banco: "BICE", tipo: "abono", monto: montoNum(m[1]), cuenta: cuentaNorm(m[4]), fecha_hora: fechaEn(t), n_operacion: op?.[1] || null,
      contraparte_nombre: limpio(m[2]), contraparte_rut: null, contraparte_banco: limpio(m[3].replace(/^Banco /i, "")), contraparte_cuenta: null, mensaje: limpio(msj?.[1]) };
  }
  // Banco de Chile · comprobante que manda el banco del cliente (la oficina es la cuenta de abono).
  if (/bancochile\.cl/.test(dom) && /Comprobante de Transferencia/i.test(t)) {
    const m = t.match(/que (.+?) ha instruido la siguiente transferencia: .*?Cuenta de abono (\d+) .*?Cuenta de cargo (\d+) Monto Operaci[oó]n \$ ?([\d.]+)/i);
    if (!m) return null;
    const msj = t.match(/Mensaje (.*?) Fecha y hora/i), op = t.match(/ID de la operaci[oó]n: ?(\S+)/i);
    return { banco: "Banco de Chile", tipo: "abono", monto: montoNum(m[4]), cuenta: cuentaNorm(m[2]), fecha_hora: fechaEn(t), n_operacion: op?.[1] || null,
      contraparte_nombre: limpio(m[1]), contraparte_rut: null, contraparte_banco: "Banco de Chile", contraparte_cuenta: cuentaNorm(m[3]), mensaje: limpio(msj?.[1]) || limpio(asunto) };
  }
  return null;
}

type Mov = { id: string; cuenta: string; fecha: string; tipo: string; monto: number; n_operacion: string | null };
// Calce exacto: misma cuenta propia, mismo tipo y monto, fecha de la cartola entre el día del aviso y 3 días después
// (lo hecho de noche entra al día hábil siguiente). Si la cartola trae número de operación, debe ser el comienzo del
// del aviso (BICE lo corta a 7 dígitos). Uno solo → calzado; varios → ambiguo (lo decide una persona); ninguno → espera.
export function calzarAviso(a: Aviso & { fecha_hora: string | null }, movs: Mov[], tomados: Set<string>) {
  if (!a.cuenta || !a.fecha_hora) return { estado: "por_calzar" as const, mov: null, cand: [] as Mov[] };
  const dia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date(a.fecha_hora)), t0 = Date.parse(dia + "T00:00:00Z");
  const base = movs.filter((m) => !tomados.has(m.id) && cuentaNorm(m.cuenta) === a.cuenta && m.tipo === a.tipo && Math.round(Number(m.monto)) === Math.round(Number(a.monto))
    && Date.parse(m.fecha + "T00:00:00Z") >= t0 - 86400000 && Date.parse(m.fecha + "T00:00:00Z") <= t0 + 3 * 86400000);
  // Mismo banco (BICE↔cartola BICE): un número de operación distinto es otra transferencia y se descarta. Entre bancos
  // (comprobante del Banco de Chile) los números no se comparan.
  const mismoBanco = a.banco === "BICE" && !!a.n_operacion;
  const cand = mismoBanco ? base.filter((m) => !m.n_operacion || a.n_operacion!.startsWith(String(m.n_operacion))) : base;
  if (cand.length === 1) return { estado: "calzado" as const, mov: cand[0], cand };
  if (cand.length > 1) return { estado: "ambiguo" as const, mov: null, cand };
  return { estado: "por_calzar" as const, mov: null, cand: [] as Mov[] };
}
