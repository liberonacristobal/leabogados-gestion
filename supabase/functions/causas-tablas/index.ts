// Edge Function: causas-tablas
// Revisa cada día si las causas del estudio (tabla causas) quedaron EN TABLA en su Corte, con la búsqueda pública oficial del
// Poder Judicial (pjud.cl › Programación de Salas › Búsqueda por causa): Cortes de Apelaciones por Corte + libro + rol + año,
// Corte Suprema por rol + año. Sin captcha y sin clave: es la misma consulta que hace la página. La Oficina Judicial Virtual
// (Clave Única, captcha) NO se usa.
// Cada revisión queda en la bitácora causas_seguimiento (resultado, tabla, aviso). Fecha de vista nueva (hoy o futura, distinta
// de la ya avisada) → correo desde la casilla de la oficina «Hola <abogado>,» al abogado responsable, con copia al equipo
// (learnings config causas_avisar_a), y plazo en el calendario (plazos tipo 'tabla'). Horario: viernes 18:00, 19:30 y 21:00,
// sábado y domingo 10:00, lunes 06:00 (Chile). La del viernes 21:00 (body.resumen) envía SIEMPRE un resumen a cada abogado con
// todas sus causas y su estado. «Sin tabla» solo si pjud.cl lo confirma («Registro(s) no encontrado(s)» o la tabla del libro sin
// la causa); cualquier otra respuesta es «No se pudo revisar» y se avisa a learnings config causas_avisar_fallas (pedido del
// usuario 23-10: solo Cristóbal y Martina), sin copia al equipo. El día de la vista agrega el estado
// de la tabla diaria (En tabla / Suspendida / Vista). Interruptor learnings config causas_tablas = 'on' (sin 'on' = revisa y
// guarda pero no envía). body.causa_id / body.client_id = revisar solo esas (botón «Revisar ahora» de la ficha); body.dryRun.
// Auth: CRON_SECRET o sesión de un usuario del dominio de la oficina. verify_jwt=false.

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const GMAIL_USER = Deno.env.get("GMAIL_USER") || "";
const GMAIL_PASS = Deno.env.get("GMAIL_PASS") || "";
const PJUD = "https://www.pjud.cl";
const SUPREMA = "6050000";
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const toAscii = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[–—]/g, "-").replace(/[^\x20-\x7E]/g, "");
const dmy = (iso: string) => String(iso || "").slice(0, 10).split("-").reverse().join("-");
const hoyCL = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const pausa = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
// Mismo horario que los crons causas-tablas-* (procesos_catalogo), en hora de Chile: para «Reintento» y «Próxima revisión».
const HORARIO = [[5, "18:00"], [5, "19:30"], [5, "21:00"], [6, "10:00"], [0, "10:00"], [1, "06:00"]] as [number, string][];
const ahoraCL = () => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  const fecha = `${p.year}-${p.month}-${p.day}`; return { fecha, hora: `${p.hour}:${p.minute}`, dia: new Date(fecha + "T12:00").getDay() }; };
// Próxima revisión programada después de ahora (hasta 7 días): {fecha, hora, texto}.
const proximaRevision = () => { const a = ahoraCL();
  for (let i = 0; i < 8; i++) { const f = new Date(new Date(a.fecha + "T12:00").getTime() + i * 864e5), d = f.getDay(), iso = f.toISOString().slice(0, 10);
    const h = HORARIO.filter(([x, hh]) => x === d && (i > 0 || hh > a.hora)).map((x) => x[1]).sort()[0];
    if (h) return { fecha: iso, hora: h, texto: i === 0 ? `hoy a las ${h}` : `${DIAS[d]} ${dmy(iso)}, ${h}` }; }
  return null; };
const revisionesDeHoy = () => { const a = ahoraCL(); const hs = HORARIO.filter(([d, h]) => d === a.dia && h <= a.hora).map((x) => x[1]);
  return hs.length > 1 ? `${hs.slice(0, -1).join(", ")} y ${hs[hs.length - 1]}` : hs[0] || ""; };
const CAJA = (inner: string) => `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,Helvetica,sans-serif;background:#f0f2f4;margin:0;padding:20px"><div style="max-width:620px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #e4e8eb;padding:22px">${inner}</div></body></html>`;
const P = (t: string) => `<p style="font-size:14px;color:#3D3D3D;margin:0 0 12px">${t}</p>`;
const PIE = (t: string) => `<p style="font-size:12px;color:#537281;margin:16px 0 0">${t}</p>`;
async function enviar(to: string[], cc: string[], subject: string, text: string, html: string) {
  const client = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: GMAIL_USER, password: GMAIL_PASS } } });
  try { await client.send({ from: `Oficina <${GMAIL_USER}>`, to, ...(cc.length ? { cc } : {}), subject: toAscii(subject), content: toAscii(text), html }); } finally { await client.close().catch(() => null); }
}
// Lista de nombres para el saludo: «Cristóbal», «Cristóbal y Martina».
const saludo = (ns: string[]) => ns.length > 1 ? `${ns.slice(0, -1).join(", ")} y ${ns[ns.length - 1]}` : ns[0] || "equipo";

// deno-lint-ignore no-explicit-any
async function rest(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${path.split("?")[0]}: ${r.status} ${await r.text()}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}

// Filas de una tabla HTML de la respuesta (celdas en texto plano).
function filas(html: string): string[][] {
  const s = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  return [...s.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((m) => [...m[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) =>
    c[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#0?39;/g, "'").replace(/\s+/g, " ").trim()));
}
// Programación de la causa: [{sala, numero, fecha, ingreso, caratula}] solo de ESTE rol-año (la búsqueda puede traer otros).
// deno-lint-ignore no-explicit-any
async function programacion(c: any): Promise<any[]> {
  let r: Response;
  if (c.instancia === "suprema" || c.corte_codigo === SUPREMA) {
    const f = new FormData(); f.append("valAno", String(c.anio)); f.append("codCorte", SUPREMA); f.append("rol", String(c.rol));
    r = await fetch(`${PJUD}/ajax/Courts/searchForRolYear/`, { method: "POST", body: f, headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(60000) }).catch(fallaRed);
  } else {
    // El número de rol se repite en CADA libro (15-2025 Civil, 15-2025 Protección…): sin libro la búsqueda trae causas ajenas.
    if (!c.libro_codigo || c.libro_codigo === "0") throw new Error("Falta el libro de la causa (Civil, Protección, Tributario y Aduanero…)");
    const b = new URLSearchParams({ codigo_tribunal: c.corte_codigo, rol: String(c.rol), filAno: String(c.anio), filBook: c.libro_codigo });
    r = await fetch(`${PJUD}/ajax/Courts/getBookRegister`, { method: "POST", body: b, headers: { "User-Agent": "Mozilla/5.0", "Content-Type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(60000) }).catch(fallaRed);
  }
  if (!r.ok) throw new Error(`pjud.cl respondió con error ${r.status}`);
  const t = await r.text().catch(() => { throw new Error("pjud.cl cortó la respuesta"); });
  // Sin tabla CONFIRMADO: pjud.cl dice «Registro(s) no encontrado(s)».
  if (/registro\(s\) no encontrado|no encontrado/i.test(t)) return [];
  const ff = filas(t); const cab = (ff[0] || []).map((x) => x.toLowerCase());
  const col = (n: string) => cab.findIndex((x) => x.includes(n));
  // Cualquier otra respuesta debe traer la tabla con sus columnas; si no, NO se da por «Sin tabla».
  if (!ff.length || col("fecha") < 0 || (col("sala") < 0 && col("ingreso") < 0 && col("causa") < 0)) throw new Error("pjud.cl respondió sin la tabla esperada (página distinta o en mantención)");
  const iS = col("sala"), iN = cab.findIndex((x) => x === "n°" || x === "n" || x.startsWith("n°")), iC = col("causa"), iI = col("ingreso"), iF = col("fecha");
  const rolTxt = `${Number(c.rol)}-${c.anio}`;
  const nl = (x: string) => String(x || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const libro = nl(c.libro_nombre || "");
  return ff.slice(1).map((x) => {
    const fecha = (x[iF] || x.find((v) => /\d{2}\/\d{2}\/\d{4}/.test(v)) || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
    return { sala: x[iS] || "", numero: x[iN] || "", caratula: x[iC] || "", ingreso: x[iI] || x.find((v) => /\d+-\d{4}/.test(v)) || "", fecha: fecha ? `${fecha[3]}-${fecha[2]}-${fecha[1]}` : null };
  }).filter((x) => x.fecha && new RegExp(`(^|\\D)${rolTxt}(\\D|$)`).test(x.ingreso) && (!libro || nl(x.ingreso).includes(libro)));
}
const fallaRed = (e: Error): never => { throw new Error(e?.name === "TimeoutError" ? "pjud.cl no respondió en 60 segundos" : `no se pudo conectar con pjud.cl (${e?.message || e})`); };
// Estado del día en la tabla diaria de la sala (Cortes de Apelaciones): «En Tabla», «Suspendida», «Vista/ Resolviendo»…
async function estadoDelDia(corte: string, sala: string, rolTxt: string): Promise<string | null> {
  const fs = new FormData(); fs.append("codTribunal", corte);
  const rs = await fetch(`${PJUD}/ajax/Courts/getTypeTablesBycourt/`, { method: "POST", body: fs, headers: { "User-Agent": "Mozilla/5.0" } }).then((r) => r.json()).catch(() => null);
  const s = (rs?.data?.typesTable || []).find((x: { value: string }) => x.value.toLowerCase().replace(/\s*\(virtual\)/, "").startsWith(sala.toLowerCase().replace(/\s*sala$/, "").trim()));
  if (!s) return null;
  const fd = new FormData(); fd.append("codTypeTable", s.id); fd.append("codCorte", corte);
  const t = await fetch(`${PJUD}/ajax/Courts/getDataTypeTableDaily/`, { method: "POST", body: fd, headers: { "User-Agent": "Mozilla/5.0" } }).then((r) => r.text()).catch(() => "");
  const fila = filas(t).find((x) => x.some((v) => v.replace(/^0+/, "") === rolTxt));
  return fila ? fila[fila.length - 1] || null : null;
}

Deno.serve(async (req) => {
  // deno-lint-ignore no-explicit-any
  let body: any = {}; try { body = await req.json(); } catch { /* sin body */ }
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!CRON_SECRET) return json({ error: "No autorizado" }, 403);
  let quien = "agente";
  if (body.secret !== CRON_SECRET && bearer !== CRON_SECRET) {
    const u = bearer ? await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${bearer}` } }).then((r) => r.ok ? r.json() : null).catch(() => null) : null;
    const cas = await rest("learnings?kind=eq.config&key=eq.agente_casilla&select=value").catch(() => []);
    const dom = String(cas?.[0]?.value || "").split("@")[1];
    if (!u?.email || !dom || !String(u.email).toLowerCase().endsWith("@" + dom.toLowerCase())) return json({ error: "No autorizado" }, 403);
    quien = u.email;
  }
  try {
    const cfg = await rest("learnings?kind=eq.config&key=in.(causas_tablas,causas_avisar_a,causas_avisar_fallas,agente_casilla)&select=key,value");
    const ON = String(cfg.find((c: { key: string }) => c.key === "causas_tablas")?.value || "").toLowerCase() === "on";
    const dom = String(cfg.find((c: { key: string }) => c.key === "agente_casilla")?.value || "").split("@")[1] || "";
    const equipo = String(cfg.find((c: { key: string }) => c.key === "causas_avisar_a")?.value || "").split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter((e) => e && dom && e.endsWith("@" + dom));
    const fallasA = String(cfg.find((c: { key: string }) => c.key === "causas_avisar_fallas")?.value || "").split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter((e) => e && dom && e.endsWith("@" + dom));
    const dryRun = !!body.dryRun, resumen = !!body.resumen && quien === "agente";
    let filtro = "estado=eq.activa";
    if (body.causa_id) filtro += `&id=eq.${encodeURIComponent(body.causa_id)}`;
    else if (body.client_id) filtro += `&client_id=eq.${encodeURIComponent(body.client_id)}`;
    const [causas, miembros, clientes] = await Promise.all([
      rest(`causas?select=*&${filtro}&order=created_at.asc`),
      rest("miembros?select=email,nombre,rol"),
      rest("clients?select=id,name,abogado_responsable"),
    ]);
    const nomCli: Record<string, string> = Object.fromEntries(clientes.map((c: { id: string; name: string }) => [c.id, c.name]));
    const duenoCli: Record<string, string> = Object.fromEntries(clientes.map((c: { id: string; abogado_responsable: string }) => [c.id, c.abogado_responsable || ""]));
    // Correo del abogado por su nombre (miembros trae alias): la dirección más corta del dominio de la oficina.
    const correoDe = (n: string) => { const k = String(n || "").trim().toLowerCase(); if (!k) return null;
      const ms = miembros.filter((m: { email: string; nombre: string }) => String(m.nombre || "").toLowerCase().split(/\s+/)[0] === k.split(/\s+/)[0] && String(m.email || "").toLowerCase().endsWith("@" + dom));
      return ms.map((m: { email: string }) => m.email.toLowerCase()).sort((a: string, b: string) => a.length - b.length)[0] || null; };
    // Equipo en copia (decisión del usuario 23-10): el abogado dueño del cliente y los miembros que no son socios (rol ≠ admin),
    // una dirección por persona; más los que se agreguen en learnings config causas_avisar_a.
    const noSocios = [...new Set(miembros.filter((m: { rol: string }) => m.rol !== "admin").map((m: { nombre: string }) => correoDe(m.nombre)).filter(Boolean))] as string[];
    const hoy = hoyCL();
    const res = { revisadas: 0, en_tabla: [] as unknown[], avisos: [] as unknown[], errores: [] as unknown[], falla: null as unknown, resumenes: [] as unknown[] };
    // Estado de cada causa en esta corrida (para el resumen y el aviso de fallas) + fila de su seguimiento (para anotar el envío).
    // deno-lint-ignore no-explicit-any
    const estado: any[] = [];
    const segPost = async (row: Record<string, unknown>) => dryRun ? null : (await rest("causas_seguimiento", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) }).catch(() => null))?.[0] || null;
    const segNota = async (seg: { id: string; resultado: string } | null, nota: string) => { if (!seg?.id) return; seg.resultado = `${seg.resultado} · ${nota}`;
      await rest(`causas_seguimiento?id=eq.${seg.id}`, { method: "PATCH", body: JSON.stringify({ resultado: seg.resultado }) }).catch(() => null); };
    for (const c of causas) {
      try {
        const prog = await programacion(c); res.revisadas++;
        const prox = prog.filter((p) => p.fecha >= hoy).sort((a, b) => a.fecha.localeCompare(b.fecha))[0] || null;
        let ultima = prox || prog.sort((a, b) => b.fecha.localeCompare(a.fecha))[0] || null;
        if (ultima && ultima.fecha === hoy && c.instancia !== "suprema") ultima = { ...ultima, estado_dia: await estadoDelDia(c.corte_codigo, ultima.sala, `${Number(c.rol)}-${c.anio}`).catch(() => null) };
        const patch: Record<string, unknown> = { ultima_revision_at: new Date().toISOString(), updated_at: new Date().toISOString(), ultima_error: null, ultima_error_at: null };
        if (ultima) patch.ultima_tabla = { ...ultima, fuente: "pjud.cl Programación de Salas", revisado_at: new Date().toISOString() };
        const nueva = prox && prox.fecha !== String(c.avisado_fecha || "").slice(0, 10);
        if (prox) res.en_tabla.push({ causa: `${c.rol}-${c.anio}`, corte: c.corte_nombre, ...prox, nueva });
        if (nueva && !dryRun) {
          const aAbog = correoDe(c.abogado);
          const aDueno = correoDe(duenoCli[c.client_id]);
          const para = (aAbog ? [aAbog] : aDueno ? [aDueno] : equipo.slice(0, 1)) as string[];
          const cc = [...new Set([correoDe(duenoCli[c.client_id]), ...noSocios, ...equipo].filter((e) => e && !para.includes(e as string)))] as string[];
          const nombreA = String(c.abogado || "").trim().split(/\s+/)[0] || "equipo";
          const titulo = `${c.caratula || nomCli[c.client_id] || "Causa"} · Rol ${c.rol}-${c.anio}`;
          let enviado = false, motivo = "";
          if (ON && para.length) {
            try {
              const linea = `${c.corte_nombre}${prox.sala ? `, ${prox.sala}` : ""}${prox.numero ? `, N° ${prox.numero} de la tabla` : ""}, para el ${dmy(prox.fecha)}`;
              const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,Helvetica,sans-serif;background:#f0f2f4;margin:0;padding:20px"><div style="max-width:620px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #e4e8eb;padding:22px"><p style="font-size:14px;color:#3D3D3D;margin:0 0 12px">Hola ${esc(aAbog ? nombreA : (String(duenoCli[c.client_id] || "").split(/\s+/)[0] || "equipo"))},</p><p style="font-size:14px;color:#3D3D3D;margin:0 0 14px">La siguiente causa fue puesta en tabla:</p><table style="width:100%;border-collapse:collapse;font-size:13px;color:#3D3D3D">${[["Causa", esc(c.caratula || prox.caratula || "")], ["Cliente", esc(nomCli[c.client_id] || "")], ["Rol", `${esc(c.rol)}-${c.anio}${c.libro_nombre ? ` · ${esc(c.libro_nombre)}` : ""}`], ["Corte", esc(c.corte_nombre)], ["Sala", esc(prox.sala || "")], ["N° en la tabla", esc(prox.numero || "")], ["Fecha de la vista", dmy(prox.fecha)], ["Abogado", esc(c.abogado || "")]].filter((x) => x[1]).map(([k, v]) => `<tr><td style="padding:7px 10px;border-top:1px solid #E4E8EB;color:#537281;white-space:nowrap">${k}</td><td style="padding:7px 10px;border-top:1px solid #E4E8EB;font-weight:600">${v}</td></tr>`).join("")}</table><p style="font-size:12px;color:#537281;margin:16px 0 0">Fuente: Programación de Salas, pjud.cl, revisada el ${dmy(hoy)}. La vista quedó también en el calendario de plazos de la app.</p></div></body></html>`;
              const client = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: GMAIL_USER, password: GMAIL_PASS } } });
              await client.send({ from: `Oficina <${GMAIL_USER}>`, to: para, ...(cc.length ? { cc } : {}), subject: toAscii(`Causa en tabla: Rol ${c.rol}-${c.anio} - ${c.corte_nombre} - ${dmy(prox.fecha)}`), content: toAscii(`${titulo}: ${linea}`), html });
              await client.close(); enviado = true;
            } catch (e) { motivo = String((e as Error).message || e); }
          } else motivo = !ON ? "aviso apagado (causas_tablas)" : "sin destinatarios";
          // El plazo y la marca quedan aunque el correo no salga: la app lo muestra y el aviso se puede reenviar.
          await rest("plazos", { method: "POST", body: JSON.stringify({ client_id: c.client_id, titulo: `Vista en tabla · Rol ${c.rol}-${c.anio}`, descripcion: `${c.corte_nombre}${prox.sala ? ` · ${prox.sala}` : ""}${prox.numero ? ` · N° ${prox.numero}` : ""}${c.caratula ? ` · ${c.caratula}` : ""}`, tipo: "tabla", fecha: prox.fecha, estado: "pendiente", fuente: "causas-tablas", estudio_id: c.estudio_id }) }).catch(() => null);
          patch.avisado_fecha = prox.fecha;
          await rest("activity_log", { method: "POST", body: JSON.stringify({ user_email: quien, action: enviado ? "causas.en_tabla_avisada" : "causas.en_tabla_sin_aviso", table_name: "causas", record_id: c.id, estudio_id: c.estudio_id, detail: { title: `${enviado ? "Aviso enviado" : "En tabla, aviso NO enviado"}: Rol ${c.rol}-${c.anio} · ${c.corte_nombre} · ${dmy(prox.fecha)}`, para, motivo: motivo || null, tabla: prox } }) }).catch(() => null);
          res.avisos.push({ causa: `${c.rol}-${c.anio}`, fecha: prox.fecha, enviado, para, cc, motivo: motivo || null });
          patch._aviso = { enviado, para, cc, motivo: motivo || null };
        }
        // Bitácora de la revisión (también cuando no hay tabla): es el seguimiento que se ve detrás del botón en la causa.
        const av = patch._aviso as Record<string, unknown> | undefined; delete patch._aviso;
        const seg = await segPost({ causa_id: c.id, estudio_id: c.estudio_id, origen: quien === "agente" ? "agente" : "manual", por: quien === "agente" ? null : quien,
          en_tabla: !!prox, tabla: prox || null, aviso: av || null,
          resultado: prox ? `En tabla: ${c.corte_nombre}${prox.sala ? `, ${prox.sala}` : ""}${prox.numero ? `, N° ${prox.numero}` : ""}, ${dmy(prox.fecha)}${ultima?.estado_dia ? ` (${ultima.estado_dia})` : ""}${av ? (av.enviado ? " · aviso enviado" : ` · aviso NO enviado: ${av.motivo}`) : " · ya avisada"}` : `Sin tabla${ultima ? ` (última vez en tabla: ${dmy(ultima.fecha)})` : ""}` });
        if (!dryRun) await rest(`causas?id=eq.${c.id}`, { method: "PATCH", body: JSON.stringify(patch) });
        estado.push({ c, k: prox ? "tabla" : "sin", prox, seg });
      } catch (e) {
        const motivo = String((e as Error).message || e);
        res.errores.push({ causa: `${c.rol}-${c.anio}`, error: motivo });
        // La causa muestra «No se pudo revisar» en la app hasta la próxima revisión correcta.
        if (!dryRun) await rest(`causas?id=eq.${c.id}`, { method: "PATCH", body: JSON.stringify({ ultima_error: motivo, ultima_error_at: new Date().toISOString() }) }).catch(() => null);
        // No se pudo ver la causa: queda en su seguimiento como «No se pudo revisar» (nunca como «Sin tabla»).
        const seg = await segPost({ causa_id: c.id, estudio_id: c.estudio_id, origen: quien === "agente" ? "agente" : "manual", por: quien === "agente" ? null : quien, en_tabla: false, tabla: null, aviso: null, resultado: `No se pudo revisar: ${motivo}` });
        if (!dryRun) await rest("activity_log", { method: "POST", body: JSON.stringify({ user_email: quien, action: "causas.no_revisada", table_name: "causas", record_id: c.id, estudio_id: c.estudio_id, detail: { title: `No se pudo revisar la tabla: Rol ${c.rol}-${c.anio} · ${c.corte_nombre} · ${motivo}` } }) }).catch(() => null);
        estado.push({ c, k: "error", motivo, seg });
      }
      await pausa(400);   // una consulta a la vez: es el sitio público del Poder Judicial
    }
    const prox = proximaRevision(), revHoy = revisionesDeHoy();
    const lineaCausa = (c: { rol: string; anio: number; libro_nombre?: string; caratula?: string; origen?: string }) => ({ nombre: esc(String(c.origen || "").split(" · ")[0] || c.caratula || `Rol ${c.rol}-${c.anio}`), car: esc(c.caratula || ""), rol: `${esc(c.rol)}-${c.anio}`, libro: esc(c.libro_nombre || "") });
    // Aviso de falla (solo las corridas programadas; «Revisar ahora» ya muestra el error en la app): a causas_avisar_fallas, sin copia.
    const fallidas = estado.filter((x) => x.k === "error");
    if (fallidas.length && quien === "agente" && !dryRun) {
      let ok = false, motivo = "";
      if (!ON) motivo = "aviso apagado (causas_tablas)"; else if (!fallasA.length) motivo = "sin destinatarios (causas_avisar_fallas)";
      else try {
        const nombres = fallasA.map((e) => String(miembros.find((m: { email: string }) => String(m.email).toLowerCase() === e)?.nombre || e.split("@")[0]).split(/\s+/)[0]);
        const filasH = fallidas.map((x) => { const l = lineaCausa(x.c); return `<tr><td style="padding:8px;border-top:1px solid #E4E8EB"><b>${l.nombre}</b><div style="font-size:11.5px;color:#537281">${l.car}</div><div style="font-size:11.5px;color:#537281">Rol ${l.rol}${l.libro ? ` · ${l.libro}` : ""} · ${esc(x.c.corte_nombre)} · ${esc(nomCli[x.c.client_id] || "")}</div></td><td style="padding:8px;border-top:1px solid #E4E8EB;color:#A32D2D;font-weight:600">${esc(x.motivo)}</td></tr>`; }).join("");
        await enviar(fallasA, [], `No se pudo revisar la tabla - ${fallidas.length === 1 ? `Rol ${fallidas[0].c.rol}-${fallidas[0].c.anio}` : `${fallidas.length} causas`} - ${DIAS[ahoraCL().dia]} ${dmy(hoy)} ${ahoraCL().hora}`,
          `No se pudo revisar si ${fallidas.length === 1 ? "la causa está" : "las causas están"} en tabla.`,
          CAJA(`${P(`Hola ${esc(saludo(nombres))},`)}${P(`<b style="color:#A32D2D">No se pudo revisar</b> si ${fallidas.length === 1 ? "la siguiente causa está" : `las siguientes ${fallidas.length} causas están`} en tabla:`)}<table style="width:100%;border-collapse:collapse;font-size:13px;color:#3D3D3D"><tr><th style="font-size:11px;text-transform:uppercase;color:#537281;text-align:left;padding:6px 8px">Causa</th><th style="font-size:11px;text-transform:uppercase;color:#537281;text-align:left;padding:6px 8px">Motivo</th></tr>${filasH}</table>${PIE(`${prox ? `Reintento: ${prox.texto}. ` : ""}Mientras no se revise, el estado de ${fallidas.length === 1 ? "esta causa" : "estas causas"} no se da por «Sin tabla». Fuente: Programación de Salas, pjud.cl.`)}`));
        ok = true;
      } catch (e) { motivo = String((e as Error).message || e); }
      for (const x of fallidas) await segNota(x.seg, ok ? "aviso de falla enviado" : `aviso de falla NO enviado: ${motivo}`);
      res.falla = { enviado: ok, para: fallasA, motivo: motivo || null };
    }
    // Resumen del viernes 21:00: SIEMPRE, un correo por abogado con todas sus causas activas (en tabla, sin tabla, no revisadas).
    if (resumen && !dryRun) {
      const grupos = new Map<string, typeof estado>();
      for (const x of estado) { const a = correoDe(x.c.abogado) || correoDe(duenoCli[x.c.client_id]) || equipo[0] || ""; if (!grupos.has(a)) grupos.set(a, []); grupos.get(a)!.push(x); }
      for (const [para, xs] of grupos) {
        let ok = false, motivo = "";
        const cc = [...new Set([...xs.map((x) => correoDe(duenoCli[x.c.client_id])), ...noSocios, ...equipo].filter((e) => e && e !== para))] as string[];
        const nT = xs.filter((x) => x.k === "tabla").length, nE = xs.filter((x) => x.k === "error").length, n = xs.length;
        const nombreA = String(miembros.find((m: { email: string }) => String(m.email).toLowerCase() === para)?.nombre || xs[0].c.abogado || "equipo").split(/\s+/)[0];
        const tus = n === 1 ? "tu causa" : `tus ${n} causas`;
        const frase = nT || nE ? [nT ? `<b>${nT} de ${tus} ${nT === 1 ? "está" : "están"} en tabla</b>` : "", n - nT - nE ? `${n - nT - nE} sin tabla` : "", nE ? `<b style="color:#A32D2D">${nE} que no se ${nE === 1 ? "pudo" : "pudieron"} revisar</b>` : ""].filter(Boolean).join(", ").replace(/, ([^,]*)$/, " y $1") : `ninguna de ${tus} está en tabla`;
        const asunto = `Revisión de causas en tabla - ${DIAS[ahoraCL().dia]} ${dmy(hoy)} - ${nE ? `${nE} sin revisar` : nT ? `${nT} en tabla` : "sin tabla"}`;
        if (!ON) motivo = "aviso apagado (causas_tablas)"; else if (!para) motivo = "sin destinatario";
        else try {
          const filasH = xs.map((x) => { const l = lineaCausa(x.c), bg = x.k === "tabla" ? "#FFF8E1" : x.k === "error" ? "#FCEBEB" : "";
            const est = x.k === "tabla" ? `<b style="color:#854F0B">En tabla</b><div style="font-size:11.5px;color:#537281">${esc([x.prox.sala, x.prox.numero ? `N° ${x.prox.numero}` : ""].filter(Boolean).join(" · "))}</div><div style="font-size:11.5px;color:#537281">vista ${dmy(x.prox.fecha)}</div>`
              : x.k === "error" ? `<b style="color:#A32D2D">No se pudo revisar</b><div style="font-size:11.5px;color:#537281">${esc(x.motivo)}</div>${prox ? `<div style="font-size:11.5px;color:#537281">se reintenta ${esc(prox.texto)}</div>` : ""}` : `<b style="color:#537281">Sin tabla</b>`;
            return `<tr${bg ? ` style="background:${bg}"` : ""}><td style="padding:8px;border-top:1px solid #E4E8EB;vertical-align:top"><b>${l.nombre}</b><div style="font-size:11.5px;color:#537281">${l.car}</div><div style="font-size:11.5px;color:#537281">Rol ${l.rol}${l.libro ? ` · ${l.libro}` : ""} · ${esc(x.c.corte_nombre)}</div></td><td style="padding:8px;border-top:1px solid #E4E8EB;text-align:right;vertical-align:top;white-space:nowrap">${est}</td></tr>`; }).join("");
          const clientesTxt = [...new Set(xs.map((x) => nomCli[x.c.client_id]).filter(Boolean))].join(", ");
          await enviar([para], cc, asunto, `Revision de causas en tabla: ${frase.replace(/<[^>]+>/g, "")}.`,
            CAJA(`${P(`Hola ${esc(nombreA)},`)}${P(`Revisión de las ${ahoraCL().hora} en la Programación de Salas del Poder Judicial: ${frase}.`)}<table style="width:100%;border-collapse:collapse;font-size:13px;color:#3D3D3D"><tr><th style="font-size:11px;text-transform:uppercase;color:#537281;text-align:left;padding:6px 8px">Causa</th><th style="font-size:11px;text-transform:uppercase;color:#537281;text-align:right;padding:6px 8px">Estado</th></tr>${filasH}</table>${PIE(`${clientesTxt ? `Cliente${clientesTxt.includes(",") ? "s" : ""}: ${esc(clientesTxt)}.<br>` : ""}${revHoy ? `Revisiones de hoy: ${revHoy}. ` : ""}${prox ? `Próxima revisión: ${esc(prox.texto)}.` : ""}<br>Fuente: Programación de Salas, pjud.cl.${nT ? " La vista quedó también en el calendario de plazos de la app." : ""}`)}`));
          ok = true;
        } catch (e) { motivo = String((e as Error).message || e); }
        for (const x of xs) await segNota(x.seg, ok ? "resumen enviado" : `resumen NO enviado: ${motivo}`);
        await rest("activity_log", { method: "POST", body: JSON.stringify({ user_email: quien, action: ok ? "causas.resumen_enviado" : "causas.resumen_no_enviado", table_name: "causas", record_id: null, estudio_id: xs[0].c.estudio_id, detail: { title: `${ok ? "Resumen de causas enviado" : "Resumen de causas NO enviado"} a ${para || "—"} · ${n} causa${n === 1 ? "" : "s"}`, cc, motivo: motivo || null } }) }).catch(() => null);
        res.resumenes.push({ para, cc, causas: n, enviado: ok, motivo: motivo || null });
        // Si el resumen no sale, también es una falla: se avisa a causas_avisar_fallas.
        if (!ok && ON && fallasA.length) await enviar(fallasA, [], `El resumen de causas en tabla NO se envio - ${dmy(hoy)}`, `El resumen para ${para} no se envio: ${motivo}`, CAJA(`${P("Hola,")}${P(`El resumen de las causas en tabla para <b>${esc(para || "—")}</b> <b style="color:#A32D2D">NO se envió</b>.`)}${PIE(`Motivo: ${esc(motivo)}`)}`)).catch(() => null);
      }
    }
    return json({ ok: true, dryRun, aviso: ON, ...res });
  } catch (e) {
    // La revisión completa no corrió: se avisa a causas_avisar_fallas (además queda «Con falla» en Procesos y se reintenta).
    const motivo = String((e as Error).message || e);
    if (quien === "agente" && !body.dryRun) {
      const fa = await rest("learnings?kind=eq.config&key=eq.causas_avisar_fallas&select=value").then((r) => String(r?.[0]?.value || "").split(/[,;\s]+/).filter(Boolean)).catch(() => [] as string[]);
      // Una vez cada 12 h: Procesos reintenta las corridas fallidas y no debe llegar un correo por intento.
      const desde = new Date(Date.now() - 12 * 3600e3).toISOString();
      const ya = await rest(`activity_log?action=eq.causas.revision_fallida&created_at=gte.${desde}&select=id&limit=1`).catch(() => []);
      await rest("activity_log", { method: "POST", body: JSON.stringify({ user_email: "agente", action: "causas.revision_fallida", table_name: "causas", record_id: null, estudio_id: "lea", detail: { title: `La revisión de causas en tabla no se pudo hacer: ${motivo}` } }) }).catch(() => null);
      if (fa.length && !ya?.length) await enviar(fa, [], `La revision de causas en tabla NO se pudo hacer - ${dmy(hoyCL())}`, `La revision de causas en tabla no se pudo hacer: ${motivo}`,
        CAJA(`${P("Hola,")}${P(`La revisión de las causas en tabla de las ${ahoraCL().hora} <b style="color:#A32D2D">NO se pudo hacer</b>.`)}${PIE(`Motivo: ${esc(motivo)}.${proximaRevision() ? ` Próxima revisión: ${esc(proximaRevision()!.texto)}.` : ""}`)}`)).catch(() => null);
    }
    return json({ error: motivo }, 500);
  }
});
