// Edge Function: indicadores
// Indicadores oficiales del día (módulo Chile) guardados en la tabla indicadores: UF, UTM, IPC (variación mensual %) y dólar
// observado. Fuente oficial: API de la CMF (secreto CMF_API_KEY, el mismo de dolar-observado); respaldo y control: mindicador.cl.
// Cada corrida trae el año completo de la CMF (la UF se publica por adelantado hasta el día 9 del mes siguiente) y lo compara con
// mindicador: si no calzan, la fila queda con diferencia = true y un aviso en activity_log. Si la CMF no responde, se guarda el
// valor de mindicador con fuente 'mindicador' (se reemplaza cuando vuelve la CMF).
// Banco Central (API BDE, secretos BCCH_USER / BCCH_PASS): body.buscarBCCh = "texto" busca series por título (SearchSeries) para
// elegir los códigos con prueba; con learnings config bcch_series = {"uf":"<seriesId>",…} se suma como tercera fuente de control.
// body.anios = [2025, 2026] para cargar años anteriores (por defecto el año en curso; en enero también el anterior).
// Auth: CRON_SECRET o sesión de un usuario del dominio de la oficina. verify_jwt=false.

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const CMF_KEY = Deno.env.get("CMF_API_KEY") || "";
const BCCH_USER = Deno.env.get("BCCH_USER") || "";
const BCCH_PASS = Deno.env.get("BCCH_PASS") || "";
const BCCH = "https://si3.bcentral.cl/SieteRestWS/SieteRestWS.ashx";
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const hoyCL = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);

// Recurso de la CMF y clave de la lista en su respuesta; tolerancia para decir que dos fuentes «no calzan».
const IND: Record<string, { cmf: string; lista: string; tol: number }> = {
  uf: { cmf: "uf", lista: "UFs", tol: 0.011 },
  utm: { cmf: "utm", lista: "UTMs", tol: 0.5 },
  ipc: { cmf: "ipc", lista: "IPCs", tol: 0.001 },
  dolar: { cmf: "dolar", lista: "Dolares", tol: 0.011 },
};

// deno-lint-ignore no-explicit-any
async function rest(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${path.split("?")[0]}: ${r.status} ${await r.text()}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
// «41.205,16» → 41205.16 (coma decimal y punto de miles, como publica la CMF).
const numCMF = (v: unknown) => Number(String(v ?? "").replace(/\./g, "").replace(",", "."));

async function deCMF(cod: string, anio: number): Promise<Record<string, number>> {
  if (!CMF_KEY) throw new Error("Falta CMF_API_KEY");
  const i = IND[cod];
  const r = await fetch(`https://api.cmfchile.cl/api-sbifv3/recursos_api/${i.cmf}/${anio}?apikey=${encodeURIComponent(CMF_KEY)}&formato=json`, { signal: AbortSignal.timeout(20000) });
  if (r.status === 404) return {};
  if (!r.ok) throw new Error(`CMF ${cod} ${anio}: ${r.status}`);
  const d = await r.json(); const out: Record<string, number> = {};
  for (const f of d?.[i.lista] || []) { const v = numCMF(f.Valor); const fe = String(f.Fecha || "").slice(0, 10); if (/^\d{4}-\d{2}-\d{2}$/.test(fe) && Number.isFinite(v)) out[fe] = v; }
  return out;
}
async function deMindicador(cod: string, anio: number): Promise<Record<string, number>> {
  const r = await fetch(`https://mindicador.cl/api/${cod}/${anio}`, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`mindicador ${cod} ${anio}: ${r.status}`);
  const d = await r.json(); const out: Record<string, number> = {};
  // mindicador fecha a las 03:00 UTC (medianoche de Chile): la fecha local es la parte AAAA-MM-DD.
  for (const s of d?.serie || []) { const fe = String(s.fecha || "").slice(0, 10); if (fe && Number.isFinite(Number(s.valor))) out[fe] = Number(s.valor); }
  return out;
}

// Banco Central: valores de una serie en el año (fechas dd-mm-aaaa en la respuesta; «NaN» = día sin dato).
async function deBCCh(serie: string, anio: number): Promise<Record<string, number>> {
  const q = new URLSearchParams({ user: BCCH_USER, pass: BCCH_PASS, function: "GetSeries", timeseries: serie, firstdate: `${anio}-01-01`, lastdate: `${anio}-12-31` });
  const r = await fetch(`${BCCH}?${q}`, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`Banco Central ${serie}: ${r.status}`);
  const d = await r.json(); if (d?.Codigo !== 0) throw new Error(`Banco Central ${serie}: ${d?.Descripcion || d?.Codigo}`);
  const out: Record<string, number> = {};
  for (const o of d?.Series?.Obs || []) { const [dd, mm, yy] = String(o.indexDateString || "").split("-"); const v = Number(o.value); if (yy && Number.isFinite(v)) out[`${yy}-${mm}-${dd}`] = v; }
  return out;
}

Deno.serve(async (req) => {
  // deno-lint-ignore no-explicit-any
  let body: any = {}; try { body = await req.json(); } catch { /* sin body */ }
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!CRON_SECRET) return json({ error: "No autorizado" }, 403);
  if (body.secret !== CRON_SECRET && bearer !== CRON_SECRET) {
    const u = bearer ? await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${bearer}` } }).then((r) => r.ok ? r.json() : null).catch(() => null) : null;
    const cas = await rest("learnings?kind=eq.config&key=eq.agente_casilla&select=value").catch(() => []);
    const dom = String(cas?.[0]?.value || "").split("@")[1];
    if (!u?.email || !dom || !String(u.email).toLowerCase().endsWith("@" + dom.toLowerCase())) return json({ error: "No autorizado" }, 403);
  }
  try {
    if (body.buscarBCCh) {
      if (!BCCH_USER || !BCCH_PASS) return json({ error: "Faltan los secretos BCCH_USER y BCCH_PASS" }, 501);
      const txt = String(body.buscarBCCh).toLowerCase(), out: unknown[] = [];
      for (const frequency of ["DAILY", "MONTHLY"]) {
        const r = await fetch(`${BCCH}?${new URLSearchParams({ user: BCCH_USER, pass: BCCH_PASS, function: "SearchSeries", frequency })}`, { signal: AbortSignal.timeout(30000) });
        const d = await r.json().catch(() => null);
        if (d?.Codigo !== 0) return json({ error: `Banco Central: ${d?.Descripcion || r.status}` }, 502);
        (d.SeriesInfos || []).filter((x: { spanishTitle?: string }) => String(x.spanishTitle || "").toLowerCase().includes(txt))
          .forEach((x: { seriesId: string; spanishTitle: string; frequencyCode: string; firstObservation: string; lastObservation: string }) => out.push({ seriesId: x.seriesId, titulo: x.spanishTitle, frecuencia: x.frequencyCode, desde: x.firstObservation, hasta: x.lastObservation }));
      }
      return json({ ok: true, series: out.slice(0, 60) });
    }
    const cfgB = await rest("learnings?kind=eq.config&key=eq.bcch_series&select=value").catch(() => []);
    let seriesB: Record<string, string> = {}; try { seriesB = JSON.parse(cfgB?.[0]?.value || "{}"); } catch { /* sin series */ }
    const hoy = hoyCL(), y = Number(hoy.slice(0, 4));
    const anios: number[] = Array.isArray(body.anios) && body.anios.length ? body.anios.map(Number).filter((a: number) => a >= 2000 && a <= y + 1) : (hoy.slice(5, 7) === "01" ? [y - 1, y] : [y]);
    const res: Record<string, unknown> = {}; const diferencias: unknown[] = []; const errores: string[] = [];
    // Todas las fuentes en paralelo (mindicador puede tardar decenas de segundos por año): la corrida cabe en el tope del cron.
    const err = (e: Error) => { errores.push(String(e.message || e)); return null; };
    const lotes = await Promise.all(Object.keys(IND).flatMap((cod) => anios.map(async (anio) => {
      const usaB = !!(BCCH_USER && BCCH_PASS && seriesB[cod]);
      const [cmf, mi, bc] = await Promise.all([deCMF(cod, anio).catch(err), deMindicador(cod, anio).catch(err), usaB ? deBCCh(seriesB[cod], anio).catch(err) : Promise.resolve(null)]);
      return { cod, anio, cmf, mi, bc };
    })));
    for (const { cod, anio, cmf, mi, bc } of lotes) {
      if (!cmf && !mi && !bc) continue;
      // Diferencias ya avisadas: no se repite el aviso.
      const previas = await rest(`indicadores?codigo=eq.${cod}&fecha=gte.${anio}-01-01&fecha=lte.${anio}-12-31&diferencia=eq.true&select=fecha`);
      const yaAvisadas = new Set(previas.map((p: { fecha: string }) => p.fecha));
      const fechas = [...new Set([...Object.keys(cmf || {}), ...Object.keys(bc || {}), ...Object.keys(mi || {})])].sort();
      const filas = fechas.map((fe) => {
        const vc = cmf?.[fe], vb = bc?.[fe], vm = mi?.[fe];
        // Oficial: CMF; si no, Banco Central; si no, mindicador. Diferencia = alguna fuente se aparta de la oficial.
        const valor = vc ?? vb ?? vm, fuente = vc != null ? "cmf" : vb != null ? "bcch" : "mindicador";
        const dif = [vb, vm].some((x) => x != null && Math.abs((x as number) - (valor as number)) > IND[cod].tol);
        if (dif && !yaAvisadas.has(fe)) diferencias.push({ codigo: cod, fecha: fe, cmf: vc ?? null, banco_central: vb ?? null, mindicador: vm ?? null });
        return { codigo: cod, fecha: fe, valor, fuente, valor_respaldo: vm ?? vb ?? null, diferencia: dif, updated_at: new Date().toISOString() };
      });
      for (let i = 0; i < filas.length; i += 400) await rest("indicadores?on_conflict=codigo,fecha", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(filas.slice(i, i + 400)) });
      res[`${cod}_${anio}`] = { filas: filas.length, cmf: cmf ? Object.keys(cmf).length : 0, banco_central: bc ? Object.keys(bc).length : 0, mindicador: mi ? Object.keys(mi).length : 0 };
    }
    if (diferencias.length) await rest("activity_log", { method: "POST", body: JSON.stringify({ user_email: "agente", action: "indicadores.diferencia", table_name: "indicadores", estudio_id: "lea", detail: { title: `${diferencias.length} indicador${diferencias.length !== 1 ? "es" : ""} no calza${diferencias.length !== 1 ? "n" : ""} entre la CMF y mindicador`, diferencias: diferencias.slice(0, 50) } }) }).catch(() => null);
    return json({ ok: true, anios, ...res, diferencias: diferencias.length, errores });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
