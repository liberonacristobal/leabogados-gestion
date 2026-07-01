# Conciliación diaria automática — cartola BICE por correo

Automatiza lo que hoy haces a mano (subir el Excel de la cartola al módulo Conciliación).
Flujo: **BICE envía la cartola por correo → Google Apps Script la detecta → Edge Function `procesar-cartola` la parsea e inserta en `cartola_movimientos` → la conciliación (facturas/fondos) ya la ve.**

Reusa TODO lo existente: el parser `parseCartola` (mismo motor que la carga manual), la tabla `cartola_movimientos`, el dedupe por `hash`, y la resolución RUT→cliente. No hay tabla nueva.

---

## Pieza A — Base de datos (nada que crear)

La tabla `cartola_movimientos` ya existe con `hash` (índice único, la carga manual usa `onConflict:'hash'`) y las columnas que escribimos (`cuenta, rol_cuenta, fecha, tipo, rut_contraparte, nombre_contraparte, monto, n_operacion, descripcion, es_interno, cliente_id, estado, monto_conciliado`). **No hay SQL que correr.**

## Pieza B — Edge Function `procesar-cartola` (ya está en el repo)

`supabase/functions/procesar-cartola/` — `index.ts` + `cartola.ts` (copia del parser). Registrada en `config.toml` con `verify_jwt=false`.

**Antes de desplegar, define el secreto compartido** (inventa un token largo, p. ej. con `openssl rand -hex 24`; NO lo pegues en el chat):

```bash
supabase secrets set CARTOLA_SECRET='<token-largo-secreto>' --project-ref kibuwhtpoxrnfowfdolu
```

Desplegar:

```bash
supabase functions deploy procesar-cartola --project-ref kibuwhtpoxrnfowfdolu
```

Probar (con un Excel real de cartola en base64):

```bash
B64=$(base64 -i cartola.xlsx | tr -d '\n')
curl -s -X POST 'https://kibuwhtpoxrnfowfdolu.supabase.co/functions/v1/procesar-cartola' \
  -H "Authorization: Bearer <token-largo-secreto>" \
  -H 'Content-Type: application/json' \
  -d "{\"file\":\"$B64\",\"filename\":\"cartola.xlsx\"}"
# → {"ok":true,"cuenta":"01-40383-4","total":N,"inserted":N,"duplicados":0,...}
# Reejecutar el mismo archivo → inserted:0, duplicados:N (idempotente por hash).
```

## Pieza C — Google Apps Script (en la cuenta que recibe la cartola)

En [script.google.com](https://script.google.com) con la cuenta de correo que **recibe** la cartola de BICE
(según tu regla del proyecto: `contacto@leabogados.cl` o `cl@leabogados.cl` — **nunca** el Gmail privado).
Nuevo proyecto → pega esto → completa los 4 valores de `CONFIG`:

```javascript
const CONFIG = {
  FUNCTION_URL: 'https://kibuwhtpoxrnfowfdolu.supabase.co/functions/v1/procesar-cartola',
  SECRET: 'PEGAR_EL_MISMO_CARTOLA_SECRET',          // el mismo valor que en Supabase
  // Ajustar a los datos REALES del correo de la cartola (remitente + asunto):
  QUERY: 'from:(bice.cl) subject:(cartola) has:attachment newer_than:2d -label:cartola-procesada',
  LABEL: 'cartola-procesada',
};

function procesarCartolas() {
  const label = GmailApp.getUserLabelByName(CONFIG.LABEL) || GmailApp.createLabel(CONFIG.LABEL);
  const threads = GmailApp.search(CONFIG.QUERY, 0, 20);
  for (const thread of threads) {
    let algo = false;
    for (const msg of thread.getMessages()) {
      for (const att of msg.getAttachments()) {
        const name = att.getName() || '';
        if (!/\.xlsx?$/i.test(name) || name.indexOf('~$') === 0) continue;
        const b64 = Utilities.base64Encode(att.getBytes());
        const res = UrlFetchApp.fetch(CONFIG.FUNCTION_URL, {
          method: 'post',
          contentType: 'application/json',
          headers: { Authorization: 'Bearer ' + CONFIG.SECRET },
          payload: JSON.stringify({ file: b64, filename: name }),
          muteHttpExceptions: true,
        });
        Logger.log(name + ' → ' + res.getResponseCode() + ' ' + res.getContentText());
        if (res.getResponseCode() === 200) algo = true;
      }
    }
    if (algo) { thread.addLabel(label); thread.markRead(); }
  }
}

// Correr UNA vez para agendar la ejecución automática (días hábiles, ~8:00).
function crearTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY'].forEach(d =>
    ScriptApp.newTrigger('procesarCartolas').timeBased()
      .onWeekDay(ScriptApp.WeekDay[d]).atHour(8).create());
}
```

Pasos:
1. Pega el código, completa `CONFIG` (URL, SECRET, y el `QUERY` con el remitente/asunto reales).
2. Ejecuta `procesarCartolas` una vez → autoriza permisos de Gmail → revisa el Log (debe insertar movimientos).
3. Ejecuta `crearTrigger` una vez → queda corriendo solo los días hábiles a las 8:00.

## Pieza D — GitHub

La Edge Function ya queda versionada en el repo al hacer commit. El Apps Script vive en la cuenta de Google
(se puede respaldar con `clasp` más adelante si quieres, no es necesario para operar).

---

## Detalles de diseño

- **Idempotente**: dedupe por `hash` (mismo movimiento no se inserta dos veces aunque llegue el correo repetido o se solape con una carga manual). Reprocesar es seguro.
- **No pisa trabajo**: solo inserta movimientos genuinamente nuevos; nunca toca el `estado`/`cliente_id`/conciliación de los ya cargados.
- **Aprende igual que la carga manual**: resuelve `cliente_id` por RUT con las 4 fuentes (alias `cliente_alias` > `client_entities` > `clients` > `billing`). Los que solo se pueden emparejar por nombre quedan `cliente_id=null` y se identifican en la app (el emparejamiento fuzzy por nombre no se corre sin supervisión).
- **Seguridad**: `verify_jwt=false` + secreto compartido `CARTOLA_SECRET` en el header (el Apps Script no tiene sesión de usuario). El secreto vive en Supabase y en el Apps Script, nunca en el repo ni en el front.

## Pendiente de confirmar (2 datos)

1. **Banco**: toda la infra actual (parser, tabla, doc `como_leer_la_cartola.md`) es de **BICE**. Confirmar que la cartola diaria es de BICE (si fuera BCI, el formato del Excel es otro y hay que ajustar el parser con una muestra).
2. **Correo de la cartola**: remitente y asunto reales del correo diario, para afinar el `QUERY` del Apps Script.
