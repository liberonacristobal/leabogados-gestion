// Agente de administración — envía los correos nuevos de esta casilla a la app (Oficina › Bandeja del agente).
// Lee el correo y, solo para los correos de la programación de salas que la app ya leyó, los etiqueta «salas-leida» y los marca leídos
// (permiso gmail.modify; el script no envía, borra ni mueve nada). Sin claves: se identifica con la firma de Google de esta cuenta.
const CONFIG = {
  FUNCTION_URL: 'https://kibuwhtpoxrnfowfdolu.supabase.co/functions/v1/agente-correo',
  QUERY: 'in:inbox newer_than:2d',
  MAX_ADJUNTO: 10 * 1024 * 1024,   // adjuntos de más de 10 MB se informan sin contenido
  PRUEBA: false,                   // true = la app clasifica y responde, pero no guarda nada
  ETIQUETA_SALAS: 'salas-leida',   // etiqueta de los correos de la programación de salas ya leídos por la app
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
      payload: JSON.stringify({ idToken: ScriptApp.getIdentityToken(), dryRun: CONFIG.PRUEBA, messages: lote.slice(i, i + 10) }),
    });
    Logger.log(res.getResponseCode() + ' ' + res.getContentText().slice(0, CONFIG.PRUEBA ? 8000 : 400));
    if (res.getResponseCode() !== 200) return;   // no avanza la marca: la próxima corrida reintenta
  }
  if (!CONFIG.PRUEBA) props.setProperty('ultimo_ok', String(inicio));
  Logger.log(lote.length + ' correos revisados');
  if (!CONFIG.PRUEBA) { try { marcarSalasLeidas(); } catch (e) { Logger.log('Salas: ' + e); } }   // un fallo aquí no frena la revisión
}

// Programación de salas del Poder Judicial: la app lee el Excel unos minutos después de que el correo llega a su bandeja y deja
// registrado el correo; en la pasada siguiente se le pregunta cuáles ya leyó y solo esos se etiquetan «salas-leida» y se marcan leídos.
// Se puede ejecutar a mano (también sirve para dar la autorización la primera vez).
function marcarSalasLeidas() {
  const res = UrlFetchApp.fetch(CONFIG.FUNCTION_URL, { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ idToken: ScriptApp.getIdentityToken(), salas_leidas: true }) });
  if (res.getResponseCode() !== 200) { Logger.log('Salas: ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200)); return; }
  const leidos = JSON.parse(res.getContentText()).leidos || [];
  if (!leidos.length) { Logger.log('Salas: la app aún no ha leído ninguno'); return; }
  const props = PropertiesService.getScriptProperties();
  let etq = props.getProperty('etiqueta_salas');
  if (!etq) {
    const ya = (gmail_('labels').labels || []).find(l => l.name === CONFIG.ETIQUETA_SALAS);
    etq = ya ? ya.id : JSON.parse(UrlFetchApp.fetch(API + 'labels', { method: 'post', contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      payload: JSON.stringify({ name: CONFIG.ETIQUETA_SALAS, labelListVisibility: 'labelShow', messageListVisibility: 'show' }) }).getContentText()).id;
    props.setProperty('etiqueta_salas', etq);
  }
  const lista = gmail_('messages?maxResults=100&q=' + encodeURIComponent('from:no-responder@pjud.cl newer_than:14d -label:' + CONFIG.ETIQUETA_SALAS)).messages || [];
  let n = 0;
  for (const it of lista) {
    if (leidos.indexOf(it.id) < 0) continue;   // solo los que la app confirmó como leídos
    const r = UrlFetchApp.fetch(API + 'messages/' + it.id + '/modify', { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, payload: JSON.stringify({ addLabelIds: [etq], removeLabelIds: ['UNREAD'] }) });
    if (r.getResponseCode() === 200) n++; else Logger.log('Salas: no se pudo marcar ' + it.id + ' (' + r.getResponseCode() + ')');
  }
  Logger.log(n + ' correos de salas marcados como leídos');
}

// Correr UNA vez: deja el script revisando la casilla cada hora.
function crearTrigger() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'revisarCorreos').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('revisarCorreos').timeBased().everyHours(1).create();
}
