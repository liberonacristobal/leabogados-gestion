// Edge Function: alerta-cartola
// Cron diario: detecta días hábiles (no feriados) SIN cartola cargada y avisa a los socios por correo.
// Fuente de verdad de "llegó cartola de un día" = cartola_cargas (procesar-cartola la escribe en cada ingesta);
// también considera la última fecha con movimientos. Un día cubierto por cartola_cargas NO se marca como hueco
// (incluye los días marcados "sin movimientos" desde la app).
// El correo sale del buzón GMAIL_USER (= contacto@leabogados.cl) y lo firma la oficina.
// SEGURIDAD: interruptor de envío en la base (learnings config alerta_cartola = 'on'). Sin 'on' = dry-run (no envía).
// Auth: secreto compartido (ALERTA_CARTOLA_SECRET / CRON_SECRET, el mismo 'lea-cron-…' de los otros cron). verify_jwt=false.

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { holaEquipo } from "../_shared/correoEquipo.js";
import { enviarPush } from "../_shared/push.ts";
import { cargarEquipo } from "../_shared/equipo.js";

const ESTUDIO = "Liberona Escala Abogados";
let SOCIOS: string[] = [];
const GMAIL_USER = Deno.env.get("GMAIL_USER") || "";           // = contacto@leabogados.cl
const GMAIL_PASS = Deno.env.get("GMAIL_PASS") || "";
const CRON_SECRET = Deno.env.get("ALERTA_CARTOLA_SECRET") || Deno.env.get("CRON_SECRET") || "";
const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
// Interruptor de envío en la base (learnings config alerta_cartola = 'on'/'off'), como cobranza-auto. Default OFF.
// Se apaga/enciende con un UPDATE, sin redeploy. Sin la fila (o 'off') = dry-run (calcula pero no envía).

const toAscii = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[–—]/g, "-").replace(/[^\x20-\x7E]/g, "");
const qpSafe = (h: string) => String(h || "").replace(/[ \t]+$/gm, "");
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const dmy = (x: string) => x.split("-").reverse().join("-");
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const hoy = () => { const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Santiago" })); d.setHours(0, 0, 0, 0); return d; };
const MMM = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const lindo = (s: string) => { const p = s.split("-"); const d = new Date(s + "T12:00"); return `${DIAS[d.getDay()]} ${+p[2]} ${MMM[+p[1] - 1]}`; };

// deno-lint-ignore no-explicit-any
async function sb(path: string): Promise<any[]> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
  // Una lectura que falla NO es «sin datos»: con la cobertura vacía saldrían ~20 días como faltantes y se darían por avisados.
  if (!r.ok) throw new Error(`${path.split("?")[0]}: ${r.status}`);
  return await r.json();
}

// ── CUADRE: cada archivo trae el total de movimientos, cargos y abonos y los saldos del período (desde el día 1 del mes). Si lo
// cargado en Banco no calza con el archivo, o el saldo inicial no es el cierre del mes anterior, se perdió o sobra un movimiento
// (corrección del 28-10-2026, pedida por el usuario tras un movimiento perdido en un cambio de mes).
const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
// deno-lint-ignore no-explicit-any
async function cuadre(): Promise<{ hallazgos: string[]; claves: string[] }> {
  const desde = new Date(); desde.setDate(desde.getDate() - 75);
  const cargas = await sb(`cartola_cargas?select=cuenta,fecha_desde,fecha_hasta,movimientos_n,total_cargos,total_abonos,saldo_inicial,saldo_final&rol_cuenta=eq.honorarios&saldo_final=not.is.null&fecha_hasta=gte.${iso(desde)}&order=fecha_hasta.desc`);
  const porMes = new Map<string, any>();
  for (const c of cargas) { const k = `${c.cuenta}|${String(c.fecha_desde).slice(0, 7)}`; if (!porMes.has(k)) porMes.set(k, c); }
  const hallazgos: string[] = [], claves: string[] = [];
  for (const c of porMes.values()) {
    const movs = await sb(`cartola_movimientos?select=tipo,monto&cuenta=eq.${encodeURIComponent(c.cuenta)}&fecha=gte.${c.fecha_desde}&fecha=lte.${c.fecha_hasta}&limit=5000`);
    const cargos = movs.filter((m: any) => m.tipo === "cargo").reduce((a: number, m: any) => a + Number(m.monto || 0), 0);
    const abonos = movs.filter((m: any) => m.tipo === "abono").reduce((a: number, m: any) => a + Number(m.monto || 0), 0);
    const dC = Number(c.total_cargos) - cargos, dA = Number(c.total_abonos) - abonos, dN = Number(c.movimientos_n) - movs.length;
    const per = `${dmy(String(c.fecha_desde).slice(0, 10))} al ${dmy(String(c.fecha_hasta).slice(0, 10))}`;
    if (Math.abs(dC) >= 1 || Math.abs(dA) >= 1 || dN !== 0) {
      hallazgos.push(`Del ${per}: la cartola trae ${c.movimientos_n} movimientos (cargos ${clp(Number(c.total_cargos))}, abonos ${clp(Number(c.total_abonos))}) y en Banco hay ${movs.length} (cargos ${clp(cargos)}, abonos ${clp(abonos)}). ${dN > 0 ? `Faltan ${dN} movimiento${dN !== 1 ? "s" : ""}` : dN < 0 ? `Sobran ${-dN} movimiento${dN !== -1 ? "s" : ""}` : "Cambian los montos"}: ${dC !== 0 ? `cargos ${dC > 0 ? "faltan" : "sobran"} ${clp(Math.abs(dC))}` : ""}${dC !== 0 && dA !== 0 ? "; " : ""}${dA !== 0 ? `abonos ${dA > 0 ? "faltan" : "sobran"} ${clp(Math.abs(dA))}` : ""}.`);
      claves.push(`${c.cuenta}|${c.fecha_desde}|${c.fecha_hasta}|${dN}|${dC}|${dA}`);
    }
    const calc = Number(c.saldo_inicial) + Number(c.total_abonos) - Number(c.total_cargos);
    if (Math.abs(calc - Number(c.saldo_final)) >= 1) { hallazgos.push(`Del ${per}: el saldo final de la cartola (${clp(Number(c.saldo_final))}) no es el saldo inicial más abonos menos cargos (${clp(calc)}).`); claves.push(`${c.cuenta}|${c.fecha_desde}|${c.fecha_hasta}|saldo`); }
  }
  // Continuidad entre meses: el saldo inicial de un mes es el saldo final del último archivo del mes anterior.
  const meses = [...porMes.values()].sort((a: any, b: any) => String(a.fecha_desde).localeCompare(String(b.fecha_desde)));
  for (let i = 1; i < meses.length; i++) {
    const a = meses[i - 1], b = meses[i];
    if (a.cuenta === b.cuenta && Math.abs(Number(b.saldo_inicial) - Number(a.saldo_final)) >= 1) {
      hallazgos.push(`Cambio de mes: el saldo inicial de ${dmy(String(b.fecha_desde).slice(0, 10))} (${clp(Number(b.saldo_inicial))}) no es el saldo final de la cartola anterior (${clp(Number(a.saldo_final))}): falta un movimiento entre ${dmy(String(a.fecha_hasta).slice(0, 10))} y ${dmy(String(b.fecha_desde).slice(0, 10))}.`);
      claves.push(`${a.cuenta}|continuidad|${b.fecha_desde}`);
    }
  }
  return { hallazgos, claves };
}

// ── AVISOS QUE ESPERAN LA CARTOLA DE GASTOS (28-10-2026): la cuenta de gastos no trae archivo diario, se carga a mano. Un aviso del banco
// de esa cuenta que lleva 3 días o más sin movimiento donde calzar (no lo muestra la cartola) quiere decir que la cartola está atrasada:
// sin ella, los fondos de los clientes no se concilian. Se avisa una vez por conjunto de avisos.
// deno-lint-ignore no-explicit-any
async function avisosEsperan(): Promise<{ lista: any[]; ultima: string | null }> {
  const movG = await sb("cartola_movimientos?select=cuenta,fecha&rol_cuenta=eq.gastos&order=fecha.desc&limit=1");
  if (!movG.length) return { lista: [], ultima: null };
  const cuentaG = String(movG[0].cuenta).replace(/\D/g, "").replace(/^0+/, "");
  const limite = new Date(Date.now() - 3 * 86400000).toISOString();
  const piso = new Date(Date.now() - 40 * 86400000).toISOString();
  const av = await sb(`avisos_banco?select=id,monto,tipo,cuenta,fecha_hora,contraparte_nombre,mensaje&estado=eq.por_calzar&fecha_hora=lte.${limite}&fecha_hora=gte.${piso}&order=fecha_hora.asc`);
  return { lista: av.filter((a: any) => String(a.cuenta || "").replace(/\D/g, "").replace(/^0+/, "") === cuentaG), ultima: String(movG[0].fecha).slice(0, 10) };
}

Deno.serve(async (req) => {
  { const eq = await cargarEquipo(SB_URL, SB_KEY); SOCIOS = eq.socios.map((m: { email: string }) => m.email); }   // equipo del estudio (miembros)
  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = await req.json(); } catch { /* sin body */ }
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const esCron = !!CRON_SECRET && (body.secret === CRON_SECRET || bearer === CRON_SECRET);
  if (!esCron) return json({ error: "No autorizado" }, 403);

  // Solo avisa SALTOS REALES: un día hábil de la cuenta con envío diario (honorarios) que ninguna carga cubre — ni la diaria
  // de ese día, ni una diaria posterior (son acumuladas desde el día 1 del mes), ni una carga manual o «sin movimientos».
  // No avisa atrasos de la cuenta de gastos: llega solo a mano, por diseño, y eso no es un salto (usuario 21-10-2026).
  // Cada salto se avisa UNA vez (learnings config alerta_cartola_avisados = días ya avisados); la tarjeta de Conciliación
  // lo sigue mostrando hasta que se cargue.
  const [fer, cargas, cfgAv] = await Promise.all([
    sb("feriados?select=fecha"),
    sb("cartola_cargas?select=fecha_desde,fecha_hasta,rol_cuenta&or=(rol_cuenta.is.null,rol_cuenta.eq.honorarios)"),
    sb("learnings?select=id,value&kind=eq.config&key=eq.alerta_cartola_avisados"),
  ]);
  const feriados = new Set((fer || []).map((f) => String(f.fecha).slice(0, 10)));
  // 31-dic = feriado bancario: BICE no envía cartola ese día aunque no esté en la tabla de feriados.
  const esHabil = (d: Date) => { const w = d.getDay(); if (w === 0 || w === 6) return false; const s = iso(d); return !feriados.has(s) && !s.endsWith("-12-31"); };
  const today = hoy();
  const cov = new Set<string>(); let lastCov: string | null = null;
  for (const r of cargas || []) {
    let d = new Date(String(r.fecha_desde) + "T00:00:00"); const h = new Date(String(r.fecha_hasta) + "T00:00:00"); let g = 0;
    while (d <= h && g++ < 400) { cov.add(iso(d)); d.setDate(d.getDate() + 1); }
    const fh = String(r.fecha_hasta).slice(0, 10); if (!lastCov || fh > lastCov) lastCov = fh;
  }
  // La cartola de un día hábil llega la mañana del día hábil SIGUIENTE (la del viernes llega el lunes): un día recién falta
  // cuando ya pasó su día hábil siguiente o es hoy (el aviso corre en la tarde).
  const sigHabil = (d0: Date) => { const d = new Date(d0); let g = 0; do { d.setDate(d.getDate() + 1); } while (!esHabil(d) && g++ < 15); return d; };
  const gap: string[] = [];
  { const d = new Date(today); d.setDate(d.getDate() - 30); let guard = 0;
    while (d < today && guard++ < 40) { const s = iso(d); if (esHabil(d) && !cov.has(s) && sigHabil(d) <= today) gap.push(s); d.setDate(d.getDate() + 1); } }
  // Solo en simulación: días de ejemplo para revisar el correo sin esperar un salto real (nunca se envía con esto).
  if (body.dryRun && Array.isArray(body.diasPrueba)) { gap.length = 0; gap.push(...body.diasPrueba.map(String)); if (body.ultimaPrueba) lastCov = String(body.ultimaPrueba); }
  let avisados: string[] = []; try { avisados = JSON.parse(String(cfgAv?.[0]?.value || "[]")); } catch { avisados = []; }
  const nuevos = gap.filter((s) => !avisados.includes(s));
  // Cuadre de lo cargado contra el archivo: aviso aparte, una vez por hallazgo.
  let cuadreRes: { hallazgos: string[]; enviado: boolean } = { hallazgos: [], enviado: false };
  try {
    const cu = await cuadre();
    const cfgC = await sb("learnings?select=id,value&kind=eq.config&key=eq.alerta_cartola_cuadre");
    let yaC: string[] = []; try { yaC = JSON.parse(String(cfgC?.[0]?.value || "[]")); } catch { yaC = []; }
    const nuevosC = cu.claves.filter((k) => !yaC.includes(k));
    cuadreRes = { hallazgos: cu.hallazgos, enviado: false };
    const onC = String((await sb("learnings?select=value&kind=eq.config&key=eq.alerta_cartola"))?.[0]?.value || "off").trim().toLowerCase() === "on";
    if (nuevosC.length && onC && !body.dryRun) {
      const hdrC = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" };
      const lis = cu.hallazgos.map((h) => `<div style="font-size:13.5px;color:#3D3D3D;line-height:1.6;padding:9px 0;border-top:1px solid #EAEEF0;">${h}</div>`).join("");
      const htmlC = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#ECEFF1;margin:0;padding:22px 12px;"><div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;"><div style="background:#003C50;padding:20px 28px;text-align:center;"><img src="https://gestion.leabogados.cl/le-logo-blanco.png" alt="${ESTUDIO}" height="28" width="184" style="height:28px;width:184px;display:inline-block;border:0;"/></div><div style="padding:26px 26px 22px;"><div style="font-size:18px;color:#1F2A30;font-weight:700;margin-bottom:14px;">La cartola no cuadra con Banco</div><div style="font-size:13.5px;color:#3D3D3D;line-height:1.6;margin-bottom:10px;">Cada cartola trae el total de movimientos, cargos y abonos. Lo cargado en Banco no calza con ese total: falta o sobra algún movimiento.</div>${lis}<div style="font-size:13.5px;color:#3D3D3D;line-height:1.6;padding:12px 0 0;border-top:1px solid #EAEEF0;">Para corregirlo, vuelvan a cargar la cartola con «Cargar cartola»: los movimientos que faltan se agregan sin duplicar los que ya están.</div><div style="margin-top:18px;"><a href="https://gestion.leabogados.cl/?ir=cobros" style="display:block;background:#003C50;color:#fff;text-decoration:none;padding:11px;border-radius:9px;font-size:12.5px;font-weight:700;text-align:center;">Ir a Banco &rarr;</a></div></div></div></body></html>`;
      const clientC = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: GMAIL_USER, password: GMAIL_PASS } } });
      await clientC.send({ from: `${ESTUDIO} <${GMAIL_USER}>`, to: [...SOCIOS], subject: "La cartola no cuadra con Banco", content: "Ver el contenido en formato HTML.", html: qpSafe(htmlC) });
      await clientC.close();
      await enviarPush(SB_URL, SB_KEY, [...SOCIOS], { titulo: "La cartola no cuadra con Banco", cuerpo: cu.hallazgos[0].slice(0, 150), url: "/?ir=cobros", etiqueta: "cartola-cuadre" }, "sistema").catch(() => null);
      const valC = JSON.stringify([...new Set([...yaC, ...cu.claves])].slice(-60));
      if (cfgC?.[0]?.id) await fetch(`${SB_URL}/rest/v1/learnings?id=eq.${cfgC[0].id}`, { method: "PATCH", headers: hdrC, body: JSON.stringify({ value: valC }) });
      else await fetch(`${SB_URL}/rest/v1/learnings`, { method: "POST", headers: hdrC, body: JSON.stringify({ kind: "config", key: "alerta_cartola_cuadre", value: valC, estudio_id: "lea" }) });
      cuadreRes.enviado = true;
    }
  } catch (e) { cuadreRes = { hallazgos: [`No se pudo cuadrar: ${String((e as Error).message || e)}`], enviado: false }; }
  // Avisos del banco de la cuenta de gastos que esperan su cartola: aviso aparte, una vez por conjunto.
  let esperanRes: { n: number; enviado: boolean } = { n: 0, enviado: false };
  try {
    const ev = await avisosEsperan();
    esperanRes.n = ev.lista.length;
    const cfgE = await sb("learnings?select=id,value&kind=eq.config&key=eq.alerta_cartola_avisos_esperan");
    let yaE: string[] = []; try { yaE = JSON.parse(String(cfgE?.[0]?.value || "[]")); } catch { yaE = []; }
    const nuevosE = ev.lista.filter((a: { id: string }) => !yaE.includes(a.id));
    const onE = String((await sb("learnings?select=value&kind=eq.config&key=eq.alerta_cartola"))?.[0]?.value || "off").trim().toLowerCase() === "on";
    if (nuevosE.length && onE && !body.dryRun) {
      const filasE = ev.lista.slice(0, 8).map((a: any) => `<div style="font-size:13.5px;color:#3D3D3D;line-height:1.5;padding:9px 0;border-top:1px solid #EAEEF0;"><b>${clp(Number(a.monto))}</b> · ${String(a.tipo) === "cargo" ? "cargo" : "abono"} · ${dmy(String(a.fecha_hora).slice(0, 10))}${a.contraparte_nombre ? ` · ${String(a.contraparte_nombre).replace(/[<>&]/g, "")}` : ""}</div>`).join("");
      const htmlE = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#ECEFF1;margin:0;padding:22px 12px;"><div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;"><div style="background:#003C50;padding:20px 28px;text-align:center;"><img src="https://gestion.leabogados.cl/le-logo-blanco.png" alt="${ESTUDIO}" height="28" width="184" style="height:28px;width:184px;display:inline-block;border:0;"/></div><div style="padding:26px 26px 22px;"><div style="font-size:18px;color:#1F2A30;font-weight:700;margin-bottom:14px;">La cartola de gastos está atrasada</div><div style="font-size:13.5px;color:#3D3D3D;line-height:1.6;margin-bottom:10px;">${ev.lista.length === 1 ? "Un aviso del banco lleva" : `${ev.lista.length} avisos del banco llevan`} 3 días o más sin movimiento donde calzar. La última cartola de la cuenta de gastos cargada llega hasta el ${ev.ultima ? dmy(ev.ultima) : "—"}. Mientras falte, los fondos de los clientes no se concilian.</div>${filasE}<div style="font-size:13.5px;color:#3D3D3D;line-height:1.6;padding:12px 0 0;border-top:1px solid #EAEEF0;">Descarguen la cartola de la cuenta de gastos desde el portal del banco y cárguenla en Banco con «Cargar cartola»: los avisos se unen solos a sus movimientos.</div><div style="margin-top:18px;"><a href="https://gestion.leabogados.cl/?ir=cobros" style="display:block;background:#003C50;color:#fff;text-decoration:none;padding:11px;border-radius:9px;font-size:12.5px;font-weight:700;text-align:center;">Ir a Banco &rarr;</a></div></div></div></body></html>`;
      const clientE = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: GMAIL_USER, password: GMAIL_PASS } } });
      await clientE.send({ from: `${ESTUDIO} <${GMAIL_USER}>`, to: [...SOCIOS], subject: "La cartola de gastos esta atrasada", content: "Ver el contenido en formato HTML.", html: qpSafe(htmlE) });
      await clientE.close();
      await enviarPush(SB_URL, SB_KEY, [...SOCIOS], { titulo: "La cartola de gastos está atrasada", cuerpo: `${ev.lista.length} aviso${ev.lista.length !== 1 ? "s" : ""} del banco sin calzar · última cartola ${ev.ultima ? dmy(ev.ultima) : "—"}`, url: "/?ir=cobros", etiqueta: "cartola-gastos" }, "sistema").catch(() => null);
      const hdrE = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" };
      const valE = JSON.stringify([...new Set([...yaE, ...ev.lista.map((a: { id: string }) => a.id)])].slice(-80));
      if (cfgE?.[0]?.id) await fetch(`${SB_URL}/rest/v1/learnings?id=eq.${cfgE[0].id}`, { method: "PATCH", headers: hdrE, body: JSON.stringify({ value: valE }) });
      else await fetch(`${SB_URL}/rest/v1/learnings`, { method: "POST", headers: hdrE, body: JSON.stringify({ kind: "config", key: "alerta_cartola_avisos_esperan", value: valE, estudio_id: "lea" }) });
      esperanRes.enviado = true;
    }
  } catch (e) { esperanRes = { n: -1, enviado: false }; }
  if (!nuevos.length && !body.dryRun) return json({ ok: true, gap: gap.length, nuevos: 0, ultima: lastCov, cuadre: cuadreRes, esperan: esperanRes });

  // Interruptor de envío (base): learnings config alerta_cartola = 'on'
  const cfg = await sb("learnings?select=value&kind=eq.config&key=eq.alerta_cartola");
  const ON = String(cfg?.[0]?.value || "off").trim().toLowerCase() === "on";

  // Correo con el molde de los avisos internos: qué pasó, qué significa y cómo resolverlo (usuario 24-10-2026).
  const DIA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const dmy = (x: string) => x.split("-").reverse().join("-");
  const conDia = (x: string) => `${DIA[new Date(x + "T12:00").getDay()]} ${dmy(x)}`;
  const uno = gap.length === 1;
  // El asunto dice hasta qué día llega la última cartola cargada (el dato que no se discute); los días que faltan van en el cuerpo.
  // Cada cartola se nombra por el día en que LLEGA (la que trae los movimientos del viernes llega el lunes), no por el día de sus
  // movimientos: así se dice «falta la del lunes», que es el archivo que no llegó (corrección del 28-10-2026).
  const llegadas = gap.map((x) => iso(sigHabil(new Date(x + "T12:00:00"))));
  const corto = (x: string) => { const [, m, d] = x.split("-"); return `${DIA[new Date(x + "T12:00").getDay()]} ${+d}-${m}`; };
  const asunto = uno ? `Cartola BICE pendiente del ${conDia(llegadas[0])}` : `Cartolas BICE pendientes: ${llegadas.map(corto).join(" y ")}`;
  const listaDias = llegadas.map((x) => `del ${conDia(x)}`).reduce((a, x, i, arr) => i === 0 ? x : i === arr.length - 1 ? `${a} y ${x}` : `${a}, ${x}`, "");
  const miembros = await sb("miembros?select=email,nombre").catch(() => []);
  const NV = "#003C50", HAIR = "#EAEEF0", INK = "#1F2A30", TXT = "#3D3D3D", MUT = "#66787F", FAINT = "#9DAEB4", AMB = "#9A6410", AMBBG = "#FAF0DA";
  const P = (t: string, mb = 12) => `<div style="font-size:13.5px;color:${TXT};line-height:1.6;margin:0 0 ${mb}px;">${t}</div>`;
  const sec = (t: string, mt = 0) => `<div style="border-bottom:1px solid ${HAIR};padding-bottom:7px;margin:${mt}px 0 6px;"><span style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${NV};">${t}</span></div>`;
  const bt = (i: number) => i ? `border-top:1px solid ${HAIR};` : "";
  const filas = gap.map((x, i) => `<tr><td style="padding:9px 0;${bt(i)}"><div style="font-size:13.5px;font-weight:700;color:${INK};">${conDia(llegadas[i]).replace(/^./, (c) => c.toUpperCase())}</div><div style="font-size:12px;color:${MUT};">trae los movimientos hasta el ${conDia(x)}</div></td><td align="right" style="padding:9px 0 9px 12px;white-space:nowrap;${bt(i)}"><span style="font-size:11px;font-weight:700;color:${AMB};background:${AMBBG};border-radius:9px;padding:2px 9px;">sin cartola</span></td></tr>`).join("")
    + (lastCov ? `<tr><td style="padding:9px 0;${bt(1)}"><div style="font-size:13.5px;color:${MUT};">Cartola cargada hasta</div></td><td align="right" style="padding:9px 0 9px 12px;white-space:nowrap;${bt(1)}font-size:13.5px;font-weight:700;color:${INK};">${dmy(lastCov)}</td></tr>` : "");
  const paso = (n: number, t: string) => `<tr><td valign="top" style="padding:5px 10px 5px 0;width:18px;"><span style="display:inline-block;width:18px;height:18px;border-radius:9px;background:#E6F1FB;color:${NV};font-size:11px;font-weight:800;text-align:center;line-height:18px;">${n}</span></td><td style="padding:5px 0;font-size:13px;color:${TXT};line-height:1.55;">${t}</td></tr>`;
  const pasos = paso(1, "Si la cartola llegó por otra vía, cárguenla en Banco con <b>«Cargar cartola»</b>.")
    + paso(2, "Si el BICE no la envió, se descarga desde el portal del banco (cartola de cuenta corriente) y se carga igual.")
    + paso(3, `Si ${uno ? "ese día" : "esos días"} la cuenta no tuvo movimientos, marquen <b>«Sin movimientos»</b> en Banco y el aviso se cierra.`);
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#ECEFF1;margin:0;padding:22px 12px;">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 26px rgba(0,44,64,.09);">
<div style="background:#003C50;padding:20px 28px;text-align:center;"><img src="https://gestion.leabogados.cl/le-logo-blanco.png" alt="${ESTUDIO}" height="28" width="184" style="height:28px;width:184px;display:inline-block;border:0;"/></div>
<div style="padding:26px 26px 22px;">
<div style="font-size:18px;color:${INK};font-weight:700;letter-spacing:-.2px;margin-bottom:14px;">${uno ? "Cartola pendiente" : "Cartolas pendientes"}</div>
${P(`${holaEquipo(SOCIOS, miembros)}.`)}
${P(`La última cartola cargada de la cuenta de honorarios del BICE llega hasta el ${lastCov ? conDia(lastCov) : "—"}. ${uno ? "Falta la cartola" : "Faltan las cartolas"} ${listaDias}.`)}
${P(`Mientras no se ${uno ? "cargue" : "carguen"}, los abonos y cargos de ${uno ? "ese día" : "esos días"} no aparecen en Banco: los pagos de clientes quedan sin conciliar y el saldo de la cuenta no está al día.`, 18)}
${sec("BICE · Cuenta honorarios")}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${filas}</table>
${sec("Cómo resolverlo", 22)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${pasos}</table>
<div style="margin-top:18px;"><a href="https://gestion.leabogados.cl/?ir=cobros" style="display:block;background:${NV};color:#fff;text-decoration:none;padding:11px;border-radius:9px;font-size:12.5px;font-weight:700;text-align:center;">Ir a Banco &rarr;</a></div>
</div>
<div style="padding:16px 26px;border-top:1px solid ${HAIR};text-align:center;"><div style="font-size:11px;color:${FAINT};">gestion.leabogados.cl &middot; ${ESTUDIO}</div></div>
</div></body></html>`;

  if (!ON || body.dryRun) return json({ ok: true, gap: gap.length, dias: gap, nuevos: nuevos.length, ultima: lastCov, enviado: false, cuadre: cuadreRes, esperan: esperanRes, motivo: body.dryRun ? "dry-run pedido" : "interruptor apagado (learnings config alerta_cartola != on) — dry-run", ...(body.dryRun ? { subject: asunto, html } : {}) });

  try {
    const client = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: GMAIL_USER, password: GMAIL_PASS } } });
    await client.send({ from: `${ESTUDIO} <${GMAIL_USER}>`, to: [...SOCIOS], subject: toAscii(asunto), content: "Ver el contenido en formato HTML.", html: qpSafe(html) });
    await client.close();
    await enviarPush(SB_URL, SB_KEY, [...SOCIOS], { titulo: uno ? "Falta la cartola del banco" : `Faltan ${gap.length} cartolas del banco`, cuerpo: uno ? `Cartola BICE del ${dmy(llegadas[0])} sin cargar` : `Cartolas sin cargar: ${llegadas.slice(0, 4).map(dmy).join(", ")}${llegadas.length > 4 ? "…" : ""}`, url: "/?ir=cobros", etiqueta: "cartola" }, "sistema").catch(() => null);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
  // Recordar los días avisados (solo los que siguen en la ventana) para no repetir el correo por el mismo salto.
  const val = JSON.stringify([...new Set([...avisados.filter((s) => gap.includes(s)), ...gap])].sort());
  const hdr = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" };
  const g = cfgAv?.[0]?.id ? await fetch(`${SB_URL}/rest/v1/learnings?id=eq.${cfgAv[0].id}`, { method: "PATCH", headers: hdr, body: JSON.stringify({ value: val }) })
    : await fetch(`${SB_URL}/rest/v1/learnings`, { method: "POST", headers: hdr, body: JSON.stringify({ kind: "config", key: "alerta_cartola_avisados", value: val, estudio_id: "lea" }) });
  // Correo enviado pero sin guardar los días: queda como error para que la vigilancia lo vea (si no, se reenviaría cada día).
  if (!g.ok) return json({ ok: false, enviado: true, error: `Aviso enviado, pero no se guardaron los días avisados (${g.status})`, dias: gap }, 500);
  return json({ ok: true, gap: gap.length, dias: gap, nuevos: nuevos.length, ultima: lastCov, enviado: true });
});
