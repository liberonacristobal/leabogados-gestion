# Agente de administración — casilla de la oficina

El agente lee los correos que llegan a la casilla de la oficina, los cruza con la app y deja cada uno en
**Oficina › Bandeja del agente**. No mueve plata, no emite y no escribe a nadie: propone y una persona confirma.

| Pieza | Dónde |
|---|---|
| Tabla `agente_bandeja` (RLS `team_all`) | Supabase |
| Edge function `agente-correo` (`verify_jwt=false`, secreto `CARTOLA_SECRET`) | `supabase/functions/agente-correo` |
| Página Bandeja del agente | `src/App.jsx` › `BandejaView` |
| Script que envía los correos | Google Apps Script en la casilla de la oficina (abajo) |

## Instalar el script (una sola vez)

En [script.google.com](https://script.google.com), con la sesión de la **casilla de la oficina** (la misma que recibe la
cartola), Nuevo proyecto → pegar el código → completar `SECRET` con el mismo valor que usa el script de la cartola.

```javascript
const CONFIG = {
  FUNCTION_URL: 'https://kibuwhtpoxrnfowfdolu.supabase.co/functions/v1/agente-correo',
  SECRET: 'PEGAR_EL_MISMO_CARTOLA_SECRET',
  QUERY: 'in:inbox newer_than:2d',
  MAX_ADJUNTO: 10 * 1024 * 1024,   // adjuntos de más de 10 MB se informan sin contenido
};

// Envía al agente los correos recibidos desde la última corrida correcta. El agente descarta los que ya vio
// (por id de Gmail), así que repetir un correo nunca lo registra dos veces.
function revisarCorreos() {
  const props = PropertiesService.getScriptProperties();
  const desde = Number(props.getProperty('ultimo_ok') || 0) - 60 * 60 * 1000;   // 1 hora de traslape
  const inicio = Date.now();
  const yo = Session.getActiveUser().getEmail().toLowerCase();
  const lote = [];
  for (const th of GmailApp.search(CONFIG.QUERY, 0, 50)) {
    for (const m of th.getMessages()) {
      if (m.getDate().getTime() < desde) continue;
      if (String(m.getFrom()).toLowerCase().indexOf(yo) >= 0) continue;   // enviados desde esta misma casilla
      lote.push({
        id: m.getId(), threadId: th.getId(), date: m.getDate().toISOString(),
        from: m.getFrom(), to: m.getTo(), cc: m.getCc(), subject: m.getSubject(),
        body: m.getPlainBody().slice(0, 20000),
        attachments: m.getAttachments().slice(0, 6).map(a => ({
          name: a.getName(), mime: a.getContentType(),
          b64: a.getSize() <= CONFIG.MAX_ADJUNTO ? Utilities.base64Encode(a.getBytes()) : null,
        })),
      });
    }
  }
  for (let i = 0; i < lote.length; i += 10) {
    const res = UrlFetchApp.fetch(CONFIG.FUNCTION_URL, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + CONFIG.SECRET },
      payload: JSON.stringify({ messages: lote.slice(i, i + 10) }),
    });
    Logger.log(res.getResponseCode() + ' ' + res.getContentText().slice(0, 300));
    if (res.getResponseCode() !== 200) return;   // no avanza la marca: la próxima corrida reintenta
  }
  props.setProperty('ultimo_ok', String(inicio));
}

// Correr UNA vez: deja el script revisando la casilla cada 15 minutos.
function crearTrigger() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'revisarCorreos').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('revisarCorreos').timeBased().everyMinutes(15).create();
}
```

Pasos:
1. Ejecutar `revisarCorreos` una vez → autorizar Gmail → el registro de ejecución debe mostrar `200 {"ok":true,...}`.
2. Ejecutar `crearTrigger` una vez → queda corriendo cada 15 minutos.
3. Abrir la app en Oficina › Bandeja del agente.

## Probar sin guardar

```sql
select net.http_post(url:='https://kibuwhtpoxrnfowfdolu.supabase.co/functions/v1/agente-correo',
  body:='{"secret":"<CRON_SECRET>","dryRun":true,"messages":[{"id":"prueba-1","date":"2026-10-20T10:00:00Z","from":"Nombre <a@b.cl>","subject":"…","body":"…","attachments":[]}]}'::jsonb);
-- luego: select content from net._http_response where id = <id devuelto>;
```

## Reglas del agente

- La IA solo clasifica y resume. Montos y fechas salen del PDF adjunto, de nuestra solicitud citada bajo la respuesta y de la
  cartola, con calce exacto.
- Nunca registra dos veces: cada correo una vez (`gmail_id` único); una solicitud de fondos ya existe si coincide cliente,
  monto y asunto; un depósito ya conciliado deja el correo en «Ya registrados».
- Un correo que pide transferir a otra cuenta, o que trae una cuenta distinta de la conocida, va a «Sospechosos».
- «En espera» (comprobante sin depósito en la cartola): cada corrida lo vuelve a cruzar con la cartola nueva.
- La página cierra sola lo resuelto por otra vía: depósito conciliado en Banco, liquidación cargada en Notaría.
