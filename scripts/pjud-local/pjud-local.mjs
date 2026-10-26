// pjud-local — consulta en pjud.cl, desde un computador de la oficina, SOLO las causas del estudio (uso particular, causa por
// causa) y entrega el resultado a la app (edge causas-tablas, modo local):
//   1. Programación de Salas por causa: la tabla con su fecha y sala (aviso con anticipación).
//   2. Estado Diario del tribunal de cada causa (hoy y el día hábil anterior): resoluciones dictadas en ellas.
//   3. Monitor de Salas (salas.pjud.cl) de las Cortes con causas: la tabla del día, la causa que se está viendo y el turno. Desde
//      el 26-10-2026 el Monitor también rechaza a los servidores (403); el análisis y los avisos siguen en la app (misma regla).
// Desde los servidores de la nube pjud.cl responde con una verificación anti-robots (captcha); desde este computador responde
// como a cualquier persona. Si algún día pide captcha, el programa se detiene y lo informa: nunca lo responde ni lo salta.
// Configuración privada (fuera del repositorio): ~/.config/leabogados/pjud-local.json = { "url": "<edge causas-tablas>", "token": "<clave propia>" }.
// Uso: node pjud-local.mjs [--prueba] [--seguir]   (--prueba: la app recibe el resultado pero no guarda ni envía avisos;
//      --seguir: solo el Monitor de las salas donde hoy hay una causa nuestra en tabla; si no hay ninguna, no consulta nada)
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const CFG = JSON.parse(readFileSync(`${homedir()}/.config/leabogados/pjud-local.json`, "utf8"));
const PRUEBA = process.argv.includes("--prueba"), SEGUIR = process.argv.includes("--seguir");
const PJUD = "https://www.pjud.cl", SUPREMA = "6050000";
const UA = "Mozilla/5.0 (consulta de causas propias)";
const pausa = (ms) => new Promise((ok) => setTimeout(ok, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);
const nl = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const esCaptcha = (t) => /human visitor|what code is in the image|enable javascript to view the page/i.test(t);
class Captcha extends Error {}

async function pjud(path, form, xhr = false) {
  const r = await fetch(PJUD + path, { method: "POST", body: new URLSearchParams(form), signal: AbortSignal.timeout(60000),
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", ...(xhr ? { "X-Requested-With": "XMLHttpRequest" } : {}) } });
  const t = await r.text();
  if (esCaptcha(t)) throw new Captcha("captcha");
  if (!r.ok) throw new Error(`pjud.cl respondió con error ${r.status}`);
  return t;
}
const filas = (html) => [...html.replace(/<script[\s\S]*?<\/script>/gi, "").matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((m) => [...m[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) =>
  c[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#0?39;/g, "'").replace(/\s+/g, " ").trim()));

// Programación de Salas de UNA causa (misma lectura que usaba la app): [{sala, numero, caratula, ingreso, fecha}].
async function programacion(c) {
  const sup = c.instancia === "suprema" || c.corte_codigo === SUPREMA;
  if (!sup && (!c.libro_codigo || c.libro_codigo === "0")) throw new Error("falta el libro de la causa");
  const t = sup ? await pjud("/ajax/Courts/searchForRolYear/", { valAno: String(c.anio), codCorte: SUPREMA, rol: String(c.rol) })
    : await pjud("/ajax/Courts/getBookRegister", { codigo_tribunal: c.corte_codigo, rol: String(c.rol), filAno: String(c.anio), filBook: c.libro_codigo });
  if (/registro\(s\) no encontrado|no encontrado/i.test(t)) return [];
  const ff = filas(t), cab = (ff[0] || []).map((x) => x.toLowerCase()), col = (n) => cab.findIndex((x) => x.includes(n));
  if (!ff.length || col("fecha") < 0 || (col("sala") < 0 && col("ingreso") < 0 && col("causa") < 0)) throw new Error("pjud.cl respondió sin la tabla esperada");
  const iS = col("sala"), iN = cab.findIndex((x) => x === "n°" || x === "n" || x.startsWith("n°")), iC = col("causa"), iI = col("ingreso"), iF = col("fecha");
  const rolTxt = `${Number(c.rol)}-${c.anio}`, libro = nl(c.libro_nombre);
  return ff.slice(1).map((x) => {
    const f = (x[iF] || x.find((v) => /\d{2}\/\d{2}\/\d{4}/.test(v)) || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
    return { sala: x[iS] || "", numero: x[iN] || "", caratula: x[iC] || "", ingreso: x[iI] || x.find((v) => /\d+-\d{4}/.test(v)) || "", fecha: f ? `${f[3]}-${f[2]}-${f[1]}` : null };
  }).filter((x) => x.fecha && new RegExp(`(^|\\D)${rolTxt}(\\D|$)`).test(x.ingreso) && (sup || !libro || nl(x.ingreso).includes(libro)));
}

// Estado Diario de un tribunal en una fecha (dd-mm-aaaa): [{ingreso, partes, providencias, doc, reservada}].
async function estadoDiario(trib, fechaDMY) {
  const t = await pjud("/ajax/Courts/getDailyStatements", { draw: "1", start: "0", length: "1000", "search[value]": "", cod_tribunal: trib.cod, tipo_juzgado: trib.tipo, nombre_tribunal: trib.nombre, date: fechaDMY }, true);
  if (/no se ha encontrado informaci[oó]n de estados diarios/i.test(t)) return [];   // día sin estado diario (fin de semana, feriado)
  if (!/data-table-estado-diario|<table/i.test(t)) throw new Error("pjud.cl respondió sin el estado diario esperado");
  return [...t.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((m) => {
    const td = [...m[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((x) => x[1]);
    if (td.length < 4) return null;
    const txt = (h) => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    const href = (td[4] || "").match(/href="([^"]+)"/)?.[1] || "";
    const doc = href ? new URL(href.replace("/ajax/../", "/"), PJUD).href : "";
    return { ingreso: txt(td[1]), partes: txt(td[2]), providencias: Number(txt(td[3])) || 1, doc, reservada: /reservada/i.test(td[4] || "") };
  }).filter(Boolean);
}
// La causa en una fila del estado diario: mismo rol-año y (abreviatura del libro coincide o una palabra de la carátula en común).
function esLaCausa(c, f) {
  const rolTxt = `${Number(c.rol)}-${c.anio}`;
  if (!new RegExp(`(^|\\D)${rolTxt}(\\D|$)`).test(f.ingreso)) return false;
  if (c.instancia === "suprema" || c.corte_codigo === SUPREMA) return true;
  const abr = nl((f.ingreso.match(/\(([A-Za-z]+)\)/) || [])[1]), lib = nl(c.libro_nombre).replace(/[^a-z ]/g, "").split(" ").find((w) => w.length > 3) || "";
  const pal = new Set(nl(c.caratula).replace(/[^a-z ]/g, " ").split(" ").filter((w) => w.length >= 5));
  return (abr && lib && abr.slice(0, 2) === lib.slice(0, 2)) || nl(f.partes).replace(/[^a-z ]/g, " ").split(" ").some((w) => pal.has(w));
}

// ─── Monitor de Salas: el mismo flujo de la página (entrar a la sala crea la sesión), igual que lo hacía el servidor ───
const MON = "https://salas.pjud.cl/monitor", MON_SUP = "https://salas.pjud.cl/monitorSup";
const limpio = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
// El sitio rechaza (403) las consultas seguidas: con 2 segundos entre cada una no rechaza ninguna (medido el 26-10-2026, 33
// consultas de las 3 salas de La Serena; sin pausa, rechazó 10 de 16).
async function monFetch(url, jar, body, intento = 0) {
  await pausa(2000);
  const r = await fetch(url, { method: body ? "POST" : "GET", body: body ? new URLSearchParams(body) : undefined, signal: AbortSignal.timeout(30000),
    headers: { "User-Agent": UA, ...(jar.size ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}), ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) } })
    .catch((e) => { throw new Error(e?.name === "TimeoutError" ? "salas.pjud.cl no respondió en 30 segundos" : `no se pudo conectar con salas.pjud.cl (${e?.message || e})`); });
  for (const c of r.headers.getSetCookie?.() || []) { const kv = c.split(";")[0], i = kv.indexOf("="); if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); }
  if ((r.status === 403 || r.status >= 500) && intento < 1) { await r.body?.cancel(); await pausa(8000); return monFetch(url, jar, body, intento + 1); }
  if (!r.ok) throw new Error(`salas.pjud.cl respondió con error ${r.status}`);
  const t = await r.text();
  if (esCaptcha(t)) throw new Captcha("captcha");
  return t;
}
const parseJ = (t, que) => { const i = t.search(/[[{"]/); try { return JSON.parse(i > 0 ? t.slice(i) : t); } catch { throw new Error(`salas.pjud.cl respondió algo inesperado al leer ${que}`); } };
const filasTabla = (ct) => (Array.isArray(ct?.detalle) ? ct.detalle : []).map((x) => ({ orden: Number(x.orden), rol: limpio(x.crr_causa), materia: limpio(x.gls_causa), caratulado: limpio(x.caratulado), estado: limpio(x.estado), alegato: limpio(x.alegato) }));
const ministrosDe = (min) => (Array.isArray(min) ? min : Array.isArray(min?.datos) ? min.datos : []).map((m) => `${limpio(m.glosa_cargo)}: ${limpio(m.nombre)}`.replace(/^: /, "")).filter(Boolean);
async function leerSala(jar, corteValor, num, nombre) {
  const idx = await monFetch(`${MON}/index.php`, jar, { cod_corte: corteValor, num_sala: num });
  const salaEnc = idx.match(/id="num_sala" value="([^"]+)"/)?.[1];
  if (!salaEnc) throw new Error(`salas.pjud.cl no abrió la ${nombre}`);
  const post = async (f, extra = {}) => parseJ(await monFetch(`${MON}/controlador/${f}.php`, jar, { corte: corteValor, sala: salaEnc, ...extra }), f);
  const lt = await post("listaTablas"), tablas = [];
  for (const d of Array.isArray(lt?.datos) ? lt.datos : []) tablas.push({ glosa: limpio(d.tabla), filas: filasTabla(await post("cargaTablas", { tabla: String(d.tip_tabla) })) });
  const v = await post("listaCausaViendo").catch(() => null), inf = await post("listaInformacionSala").catch(() => null);
  const vid = await post("listaVideollamada").catch(() => null), min = await post("listaMinistro").catch(() => null);
  return { num, nombre, tablas, viendo: v?.causa_viendo ? limpio(v.causa_viendo) : null, hasta: inf?.info_numorden ? limpio(inf.info_numorden) : null,
    horario: inf?.hr_desde && inf?.hr_hasta ? `${limpio(inf.hr_desde)} a ${limpio(inf.hr_hasta)}` : null,
    video: vid?.videollamada && /^https?:/.test(String(vid.videollamada)) ? String(vid.videollamada) : null, ministros: ministrosDe(min) };
}
async function leerSalaSuprema(jar, num, nombre) {
  const post = async (f, extra = {}) => parseJ(await monFetch(`${MON_SUP}/controlador/${f}.php`, jar, { sala: num, ...extra }), f);
  const lt = await post("listaTablas"), tablas = [];
  for (const d of Array.isArray(lt?.datos) ? lt.datos : []) tablas.push({ glosa: limpio(d.tabla), filas: filasTabla(await post("cargaTablasSuprema", { tabla: String(d.tip_tabla) })) });
  const activa = tablas.flatMap((t) => t.filas).find((f) => /alegando|relatando/i.test(f.estado));
  const vid = await post("listaVideollamadaN", { competencia: "-1" }).catch(() => null), min = await post("listaMinistro", { competencia: "-1" }).catch(() => null);
  return { num, nombre, tablas, viendo: activa ? activa.rol : null, hasta: null, horario: null, video: vid?.videollamada && /^https?:/.test(String(vid.videollamada)) ? String(vid.videollamada) : null, ministros: ministrosDe(min) };
}
const salaSup = (x) => { const [a, b] = limpio(x).split(/\s*,\s*/); return b ? `${a} Sala (${b.charAt(0)}${b.slice(1).toLowerCase()})` : limpio(x); };
// Las salas de cada Corte con causas (seguir: solo las salas donde hoy hay una causa nuestra). Una sala a la vez, con pausa.
async function monitor(causas) {
  const out = [], corteDe = (c) => c.instancia === "suprema" || c.corte_codigo === SUPREMA ? "Corte Suprema" : c.corte_nombre;
  let cortes = null;
  for (const corte of [...new Set(causas.map(corteDe))]) {
    const salasHoy = new Set(causas.filter((c) => corteDe(c) === corte).map((c) => String(c.ultima_tabla?.sala_num || "")));
    try {
      const salas = [], jar = new Map();
      if (corte === "Corte Suprema") {
        let lista = parseJ(await monFetch(`${MON_SUP}/controlador/listaSalaPorSuprema.php`, new Map(), {}), "las salas de la Corte Suprema").filter((s) => String(s.numero) !== "0");
        if (SEGUIR) lista = lista.filter((s) => salasHoy.has(String(s.numero)));
        for (const s of lista) { await pausa(1500); salas.push(await leerSalaSuprema(jar, String(s.numero), salaSup(s.sala)).catch((e) => { if (e instanceof Captcha) throw e; return { num: String(s.numero), error: String(e.message || e) }; })); }
      } else {
        if (!cortes) { const t = await monFetch(`${MON}/monitor.php`, new Map()); cortes = [...t.matchAll(/<option value="([^"]+)"[^>]*>([^<]+)/g)].filter((m) => m[1] !== "0").map((m) => ({ valor: m[1], nombre: limpio(m[2]) })); }
        const op = cortes.find((o) => nl(o.nombre) === nl(corte));
        if (!op) throw new Error(`la ${corte} no aparece en el Monitor de Salas`);
        let lista = parseJ(await monFetch(`${MON}/controlador/listaSalaPorCorte.php`, new Map(), { corte: op.valor }), "las salas");
        if (!Array.isArray(lista) || !lista.length) throw new Error(`salas.pjud.cl no entregó las salas de la ${corte}`);
        if (SEGUIR) lista = lista.filter((s) => salasHoy.has(String(s.numero)));
        await monFetch(`${MON}/monitor.php`, jar);
        for (const s of lista) { await pausa(1500); salas.push(await leerSala(jar, op.valor, String(s.numero), limpio(s.sala)).catch((e) => { if (e instanceof Captcha) throw e; return { num: String(s.numero), error: String(e.message || e) }; })); }
      }
      out.push({ corte, salas });
    } catch (e) { if (e instanceof Captcha) throw e; out.push({ corte, error: String(e.message || e) }); }
  }
  return out;
}

const app = async (body) => {
  const r = await fetch(CFG.url, { method: "POST", headers: { "Content-Type": "application/json", "x-pjud-local": CFG.token }, body: JSON.stringify({ ...body, dryRun: PRUEBA }), signal: AbortSignal.timeout(120000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`la app respondió ${r.status}: ${j.error || ""}`);
  return j;
};
const dmyDe = (iso) => iso.split("-").reverse().join("-");
const habilAnterior = (iso) => { const d = new Date(`${iso}T12:00:00`); do d.setDate(d.getDate() - 1); while ([0, 6].includes(d.getDay())); return d.toISOString().slice(0, 10); };

const resultado = { local: "resultado", seguir: SEGUIR, programacion: [], estados: [], captcha: false };
try {
  const { causas = [], hoy } = await app({ local: "pedido", seguir: SEGUIR });
  log(`${causas.length} causas ${SEGUIR ? "en tabla hoy" : "activas"}`);
  if (SEGUIR && !causas.length) process.exit(0);   // nada que seguir: no se consulta pjud.cl
  for (const c of SEGUIR ? [] : causas) {
    try { resultado.programacion.push({ causa_id: c.id, filas: await programacion(c) }); }
    catch (e) { if (e instanceof Captcha) throw e; resultado.programacion.push({ causa_id: c.id, error: String(e.message || e) }); }
    await pausa(1500);
  }
  // Un estado diario por tribunal y fecha (hoy y el día hábil anterior), solo de los tribunales con causas nuestras.
  const tribs = new Map();
  for (const c of causas) {
    const sup = c.instancia === "suprema" || c.corte_codigo === SUPREMA;
    const trib = sup ? { cod: SUPREMA, tipo: "1", nombre: "Corte Suprema De Justicia" } : { cod: c.corte_codigo, tipo: "2", nombre: String(c.corte_nombre || "").replace(/\b(de|la|las|los)\b/gi, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()) };
    if (!trib.cod) continue;
    if (!tribs.has(trib.cod)) tribs.set(trib.cod, { trib, causas: [] });
    tribs.get(trib.cod).causas.push(c);
  }
  for (const { trib, causas: cs } of SEGUIR ? [] : tribs.values()) for (const f of [habilAnterior(hoy), hoy]) {
    try {
      const fs = await estadoDiario(trib, dmyDe(f));
      for (const c of cs) for (const x of fs.filter((x) => esLaCausa(c, x))) resultado.estados.push({ causa_id: c.id, fecha: f, ...x });
    } catch (e) { if (e instanceof Captcha) throw e; log(`estado diario ${trib.nombre} ${f}: ${e.message || e}`); }
    await pausa(1500);
  }
  if (causas.length) resultado.monitor = await monitor(causas);
} catch (e) {
  if (e instanceof Captcha) { resultado.captcha = true; log("pjud.cl pidió captcha: la consulta se detiene"); }
  else { resultado.error = String(e.message || e); log("error:", resultado.error); }
}
try {
  const r = await app(resultado);
  log(`listo: ${r.programacion ?? 0} programaciones, monitor ${r.monitor ? `${r.monitor.revisadas} revisadas, ${r.monitor.errores.length} con error` : "no leído"}, ${(r.en_tabla || []).length} en tabla, ${(r.resoluciones || []).length} resoluciones nuevas, ${(r.avisos || []).length} avisos${PRUEBA ? " (prueba)" : ""}`);
  for (const x of r.monitor?.errores || []) log(`monitor ${x.causa}: ${x.error}`);
} catch (e) { log("no se pudo entregar el resultado a la app:", e.message || e); process.exitCode = 1; }
