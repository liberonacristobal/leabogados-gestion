// Agente de administración — envía los correos nuevos de esta casilla a la app (Oficina › Bandeja del agente).
// Permiso de solo lectura del correo. Sin claves: se identifica con la firma de Google de esta cuenta.
const CONFIG = {
  FUNCTION_URL: 'https://kibuwhtpoxrnfowfdolu.supabase.co/functions/v1/agente-correo',
  QUERY: 'in:inbox newer_than:2d',
  MAX_ADJUNTO: 10 * 1024 * 1024,   // adjuntos de más de 10 MB se informan sin contenido
  PRUEBA: false,                   // true = la app clasifica y responde, pero no guarda nada
};
const API = 'https://gmail.googleapis.com/gmail/v1/users/me/';

function gmail_(path) {
  const r = UrlFetchApp.fetch(API + path, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('Gmail ' + r.getResponseCode() + ' ' + r.getContentText().slice(0, 200));
  return JSON.parse(r.getContentText());
}
function texto_(b64) { return Utilities.newBlob(Utilities.base64DecodeWebSafe(b64)).getDataAsString('UTF-8'); }
function partes_(p, out) { if (p.parts) p.parts.forEach(x => partes_(x, out)); else out.push(p); return out; }
function cab_(m, n) { const h = (m.payload.headers || []).find(x => x.name.toLowerCase() === n); return h ? h.value : ''; }

// Envía los correos recibidos desde la última corrida correcta (1 hora de traslape). La app descarta los que ya vio,
// así que repetir un correo nunca lo registra dos veces.
function revisarCorreos() {
  const props = PropertiesService.getScriptProperties();
  const desde = Number(props.getProperty('ultimo_ok') || 0) - 60 * 60 * 1000;
  const inicio = Date.now();
  const yo = Session.getActiveUser().getEmail().toLowerCase();
  const lista = gmail_('messages?maxResults=100&q=' + encodeURIComponent(CONFIG.QUERY)).messages || [];
  const lote = [];
  for (const it of lista) {
    const m = gmail_('messages/' + it.id + '?format=full');
    if (Number(m.internalDate) < desde) continue;
    const from = cab_(m, 'from');
    if (from.toLowerCase().indexOf(yo) >= 0) continue;   // enviados desde esta misma casilla
    const ps = partes_(m.payload, []);
    const plano = ps.find(p => p.mimeType === 'text/plain' && p.body && p.body.data);
    const html = ps.find(p => p.mimeType === 'text/html' && p.body && p.body.data);
    const body = plano ? texto_(plano.body.data)
      : html ? texto_(html.body.data).replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&') : '';
    const adjuntos = ps.filter(p => p.filename).slice(0, 6).map(p => {
      let b64 = null;
      if ((p.body.size || 0) <= CONFIG.MAX_ADJUNTO) {
        const d = p.body.data || (p.body.attachmentId ? gmail_('messages/' + it.id + '/attachments/' + p.body.attachmentId).data : null);
        if (d) b64 = Utilities.base64Encode(Utilities.base64DecodeWebSafe(d));
      }
      return { name: p.filename, mime: p.mimeType, b64: b64 };
    });
    lote.push({ id: m.id, threadId: m.threadId, date: new Date(Number(m.internalDate)).toISOString(), from: from, to: cab_(m, 'to'), cc: cab_(m, 'cc'), subject: cab_(m, 'subject'), body: body.slice(0, 20000), attachments: adjuntos });
  }
  for (let i = 0; i < lote.length; i += 10) {
    const res = UrlFetchApp.fetch(CONFIG.FUNCTION_URL, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'X-Google-Identity': ScriptApp.getIdentityToken() },
      payload: JSON.stringify({ dryRun: CONFIG.PRUEBA, messages: lote.slice(i, i + 10) }),
    });
    Logger.log(res.getResponseCode() + ' ' + res.getContentText().slice(0, CONFIG.PRUEBA ? 8000 : 400));
    if (res.getResponseCode() !== 200) return;   // no avanza la marca: la próxima corrida reintenta
  }
  if (!CONFIG.PRUEBA) props.setProperty('ultimo_ok', String(inicio));
  Logger.log(lote.length + ' correos revisados');
}

// Correr UNA vez: deja el script revisando la casilla cada 15 minutos.
function crearTrigger() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'revisarCorreos').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('revisarCorreos').timeBased().everyMinutes(15).create();
}
