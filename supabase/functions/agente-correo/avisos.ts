// Avisos de transferencias de los bancos: BICE, Banco de Chile y Scotiabank con su formato; el resto (Santander, BCI, Itaú,
// BancoEstado…) con una lectura general que exige monto, fecha y una cuenta DE LA OFICINA escrita en el aviso.
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

// Fecha «23/10/26 12:41:18» o «23/10/2026 12:41» (año de 2 o 4 dígitos) → ISO de Chile.
function fechaDMY(t: string): string | null {
  const m = t.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})(?:,? (?:a las )?(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null; const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return isoChile(y, +m[2], +m[1], m[4] ? +m[4] : 12, m[5] ? +m[5] : 0, m[6] ? +m[6] : 0);
}
const BANCO_DE: [RegExp, string][] = [[/santander/, "Santander"], [/bci|tbanc/, "BCI"], [/itau/, "Itaú"], [/bancoestado/, "BancoEstado"], [/scotiabank/, "Scotiabank"],
  [/security/, "Security"], [/falabella/, "Falabella"], [/ripley/, "Ripley"], [/consorcio/, "Consorcio"], [/internacional/, "Internacional"], [/btgpactual/, "BTG Pactual"], [/hsbc/, "HSBC"], [/coopeuch/, "Coopeuch"]];

// `propias` = cuentas de la oficina (de la cartola). La lectura general solo acepta un aviso que nombra una de ellas.
export function leerAviso(de: string, asunto: string, cuerpo: string, propias?: Set<string | null>): Aviso | null {
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
  // Scotiabank · «Aviso de Transferencia de fondos recibida» (el cliente transfiere a una cuenta de la oficina).
  if (/scotiabank\.cl/.test(dom) && /Transferencia de fondos recibida/i.test(t)) {
    const m = t.match(/nuestro\(a\) cliente (.+?), con fecha (\d{1,2}\/\d{1,2}\/\d{2,4} \d{1,2}:\d{2}(?::\d{2})?) ha efectuado una transferencia.*?Monto \$ ?([\d.]+).*?Cuenta: ?(\d[\d-]*)/i);
    if (!m) return null;
    // El RUT que trae el aviso es el de la oficina (destinatario), no el del que transfiere: no se toma.
    const msj = t.match(/Mensaje: ?(.*?) ?Ante cualquier duda/i);
    return { banco: "Scotiabank", tipo: "abono", monto: montoNum(m[3]), cuenta: cuentaNorm(m[4]), fecha_hora: fechaDMY(m[2]), n_operacion: null,
      contraparte_nombre: limpio(m[1]), contraparte_rut: null, contraparte_banco: "Scotiabank", contraparte_cuenta: null, mensaje: limpio(msj?.[1]) };
  }
  // Otros bancos · lectura general, SOLO transferencias recibidas (la oficina no transfiere desde ellos). Exige: el monto con $,
  // la fecha y una cuenta de la oficina escrita en el aviso; si falta cualquiera, no es un aviso (queda para una persona).
  // El calce con la cartola sigue siendo exacto (cuenta, monto y fecha), así que una lectura dudosa nunca concilia sola.
  if (propias && propias.size && !/(bice|bancochile|bancoedwards)\.cl/.test(dom) && !/cartola/i.test(asunto) && /transferencia|traspaso|abono/i.test(`${asunto} ${t.slice(0, 400)}`) && !/(transferiste|has transferido|realizaste una transferencia|cargo en tu cuenta)/i.test(t)) {
    const mm = t.match(/monto(?: transferido| de la transferencia| de la operaci[oó]n| operaci[oó]n| total)?:? ?\$ ?([\d.]+)/i) || t.match(/\$ ?(\d{1,3}(?:\.\d{3})+)/);
    const nums = [...t.matchAll(/\b(\d[\d-]{5,})\b/g)].map((x) => cuentaNorm(x[1])).filter((x) => x && propias.has(x));
    const fecha = fechaEn(t) || fechaDMY(t);
    if (!mm || !nums.length || !fecha) return null;
    const banco = (BANCO_DE.find(([r]) => r.test(dom)) || [null, "Otro banco"])[1];
    // Nombre de quien transfiere: hasta la siguiente etiqueta del aviso; si no queda un nombre limpio (letras, 3–80), va vacío.
    const nom0 = t.match(/(?:nuestro\(a\) cliente|el cliente|ordenante|nombre del (?:ordenante|originador|remitente)|origen|enviada por|desde la cuenta de)\s*:?\s*(.+?)(?:,| RUT| Rut| con fecha| ha | Banco| Monto| Cuenta| Fecha| N[°º]|$)/i);
    const nom = nom0 && /^[A-Za-zÁÉÍÓÚÑáéíóúñ&.'\- ]{3,80}$/.test(nom0[1].trim()) ? nom0 : null;
    const op = t.match(/(?:N[°º]\s*(?:de\s*)?(?:operaci[oó]n|comprobante|transacci[oó]n)|c[oó]digo de (?:operaci[oó]n|transacci[oó]n)|Operaci[oó]n N[°º])\s*:?\s*([A-Z0-9-]{4,})/i);
    const msj = t.match(/(?:mensaje|comentario|glosa|descripci[oó]n)\s*:?\s*(.{1,120}?)(?: Fecha| Ante | Saludos| Atentamente| Monto|$)/i);
    return { banco, tipo: "abono", monto: montoNum(mm[1]), cuenta: nums[0], fecha_hora: fecha, n_operacion: op?.[1] || null,
      // contraparte_rut null: el aviso suele traer el RUT de la oficina, no el del que transfiere.
      contraparte_nombre: limpio(nom?.[1]), contraparte_rut: null, contraparte_banco: banco, contraparte_cuenta: null, mensaje: limpio(msj?.[1]) };
  }
  return null;
}

type Mov = { id: string; cuenta: string; fecha: string; tipo: string; monto: number; n_operacion: string | null; descripcion?: string | null };
// Entre varios movimientos del mismo monto, el que corresponde al aviso: (1) el único cuyo n° de operación BICE aparece dentro del
// código del otro banco (Banco de Chile lo incluye: «INT_EMP…6140361240» ↔ op 1403612), o (2) el único cuya hora de la glosa
// («a las 07:07») coincide con la del aviso (±2 min). Si ninguna pista da uno solo, null: lo decide una persona.
// Nunca el orden del n° de operación: en BICE no sigue la hora (20-10-2026: 1403612 fue a las 07:07 y 1403672 a las 07:04).
export function pistaMov(a: { n_operacion?: string | null; fecha_hora?: string | null }, cand: Mov[]): Mov | null {
  const cod = String(a.n_operacion || "").replace(/\D/g, "");
  if (cod) { const m = cand.filter((x) => x.n_operacion && String(x.n_operacion).length >= 6 && cod.includes(String(x.n_operacion))); if (m.length === 1) return m[0]; }
  if (a.fecha_hora) {
    const hm = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(a.fecha_hora));
    const min = (s: string) => { const [h, mi] = s.split(":").map(Number); return h * 60 + mi; };
    const m = cand.filter((x) => { const g = String(x.descripcion || "").match(/a las (\d{1,2}):(\d{2})/i); return !!g && Math.abs(min(`${g[1]}:${g[2]}`) - min(hm)) <= 2; });
    if (m.length === 1) return m[0];
  }
  return null;
}
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
  if (cand.length > 1) { const p = pistaMov(a, cand); return p ? { estado: "calzado" as const, mov: p, cand } : { estado: "ambiguo" as const, mov: null, cand }; }
  return { estado: "por_calzar" as const, mov: null, cand: [] as Mov[] };
}
