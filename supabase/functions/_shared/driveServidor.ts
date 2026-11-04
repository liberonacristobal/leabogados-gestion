// Drive desde el servidor con la conexión permanente de la oficina (drive_auth fila 1), igual que la función `drive`.
// Lo usa el guardado automático del PDF oficial de cada factura (sii-sync, acción 'pdf-oficial').
const CLIENT_ID = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") || "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") || "";
const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const API = "https://www.googleapis.com/drive/v3";
const q = (s: string) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

let _tok = "", _exp = 0;
export async function tokenDrive(): Promise<string> {
  if (_tok && _exp > Date.now() + 60000) return _tok;
  const r0 = await fetch(`${SB_URL}/rest/v1/drive_auth?id=eq.1&select=refresh_token`, { headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY } });
  const d0 = r0.ok ? await r0.json() : [];
  const rt = (Array.isArray(d0) && d0[0]?.refresh_token) || null;
  if (!rt) throw new Error("No hay conexión de Drive de la oficina guardada.");
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: rt, grant_type: "refresh_token" }) });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error_description || d.error || "No se pudo renovar el token de Drive");
  _tok = d.access_token; _exp = Date.now() + (d.expires_in || 3600) * 1000;
  return _tok;
}

const h = (t: string) => ({ Authorization: "Bearer " + t });

/** Carpeta hija con ese nombre bajo `padre`; la crea si no existe (no duplica). */
export async function carpetaHija(t: string, padre: string, nombre: string): Promise<string> {
  const qq = `'${q(padre)}' in parents and name='${q(nombre)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const r = await fetch(`${API}/files?q=${encodeURIComponent(qq)}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`, { headers: h(t) });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.error?.message || `Drive ${r.status}`);
  if (d.files?.length) return d.files[0].id;
  const c = await fetch(`${API}/files?supportsAllDrives=true&fields=id`, { method: "POST", headers: { ...h(t), "Content-Type": "application/json" }, body: JSON.stringify({ name: nombre, mimeType: "application/vnd.google-apps.folder", parents: [padre] }) });
  const cd = await c.json();
  if (!c.ok) throw new Error(cd?.error?.message || `Drive ${c.status}`);
  return cd.id;
}

/** Archivos de la carpeta con ese nombre exacto. */
export async function archivosPorNombre(t: string, carpeta: string, nombre: string): Promise<{ id: string; webViewLink?: string }[]> {
  const qq = `'${q(carpeta)}' in parents and name='${q(nombre)}' and trashed=false`;
  const r = await fetch(`${API}/files?q=${encodeURIComponent(qq)}&fields=files(id,webViewLink)&supportsAllDrives=true&includeItemsFromAllDrives=true`, { headers: h(t) });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.error?.message || `Drive ${r.status}`);
  return d.files || [];
}

export async function bajarArchivo(t: string, id: string): Promise<Uint8Array | null> {
  const r = await fetch(`${API}/files/${id}?alt=media&supportsAllDrives=true`, { headers: h(t) });
  return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
}

export async function subirPdf(t: string, carpeta: string, nombre: string, bytes: Uint8Array): Promise<{ id: string; webViewLink: string | null }> {
  const b = "lea" + Date.now() + Math.floor(Math.random() * 1e9);
  const enc = new TextEncoder();
  const ini = enc.encode(`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: nombre, parents: [carpeta] })}\r\n--${b}\r\nContent-Type: application/pdf\r\n\r\n`);
  const fin = enc.encode(`\r\n--${b}--`);
  const body = new Uint8Array(ini.length + bytes.length + fin.length);
  body.set(ini, 0); body.set(bytes, ini.length); body.set(fin, ini.length + bytes.length);
  const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink", { method: "POST", headers: { ...h(t), "Content-Type": `multipart/related; boundary=${b}` }, body });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.error?.message || `Drive ${r.status}`);
  return { id: d.id, webViewLink: d.webViewLink || null };
}
