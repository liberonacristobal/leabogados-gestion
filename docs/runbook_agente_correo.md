# Agente de administración — casilla de la oficina

El agente lee los correos que llegan a la casilla de la oficina, los cruza con la app y deja cada uno en
**Oficina › Bandeja del agente**. No mueve plata, no emite y no escribe a nadie: propone y una persona confirma.

| Pieza | Dónde |
|---|---|
| Tabla `agente_bandeja` (RLS `team_all`) | Supabase |
| Edge function `agente-correo` (`verify_jwt=false`; firma de Google de la casilla) | `supabase/functions/agente-correo` |
| Página Bandeja del agente | `src/App.jsx` › `BandejaView` |
| Script que envía los correos | Google Apps Script en la casilla de la oficina (abajo) |

## Instalar el script (una sola vez)

El script lee el correo y, solo para los correos de la programación de salas que la app ya leyó, los etiqueta `salas-leida` y los marca leídos (permiso `gmail.modify`; no envía, borra ni mueve nada). **No usa claves**: se identifica con la firma de Google de la
casilla, y la función solo acepta la casilla configurada en `learnings` config `agente_casilla` (hoy contacto@).
Código: [Codigo.gs](agente-correo-script/Codigo.gs) y [appsscript.json](agente-correo-script/appsscript.json).

1. En [script.google.com](https://script.google.com) con la sesión de la casilla de la oficina → **Nuevo proyecto**; nombre «Agente de administración».
2. Configuración del proyecto (engranaje) → marcar **«Mostrar el archivo de manifiesto appsscript.json en el editor»**.
3. Editor → `appsscript.json`: reemplazar todo por el contenido de `appsscript.json`. `Código.gs`: reemplazar todo por `Codigo.gs`. Guardar.
4. Elegir la función `revisarCorreos` → **Ejecutar** → Google pide autorización (permiso de leer y modificar el correo, para la etiqueta y la marca de leído) → Permitir.
   El registro debe mostrar `200 {"ok":true,...}` y «N correos revisados».
5. Elegir `crearTrigger` → **Ejecutar** una vez. Queda revisando cada hora.
6. Para una primera vuelta sin guardar nada: `PRUEBA: true`, ejecutar, revisar el registro, volver a `false`.

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
- «En espera» (comprobante sin depósito en la cartola): el proceso `agente-segunda-revision` (lunes a viernes 09:00 y 19:00, después de la cartola diaria de las 08:00 y de las cargas manuales de la tarde) lo vuelve a cruzar con la cartola; queda en Oficina › Procesos automáticos.
- La página cierra sola lo resuelto por otra vía: depósito conciliado en Banco, liquidación cargada en Notaría.

## Marca «salas-leida» (31-10-2026)

La app lee el Excel de la Programación de Salas del Poder Judicial (`causas-tablas`, modo `salas_correo`, cada hora a los :50) y deja
registrado el correo (`learnings` kind `salas_correo`). En su pasada siguiente, `revisarCorreos` llama a `marcarSalasLeidas`, que le pregunta
a `agente-correo` (`salas_leidas`) cuáles ya leyó y solo esos los etiqueta `salas-leida` y los marca leídos. Un correo que la app no pudo leer
queda sin leer y sin etiqueta.

**Actualizar el script ya instalado:** reemplazar `appsscript.json` y `Código.gs` por los de esta carpeta → ejecutar `marcarSalasLeidas` una vez → Permitir
(el permiso cambió de solo lectura a `gmail.modify`). **Hasta dar esa autorización, la revisión horaria falla**: hacerlo de inmediato tras pegar el código.
Los correos no se pierden (la próxima pasada correcta recoge todo lo pendiente). Registro esperado: `N correos de salas marcados como leídos`.
