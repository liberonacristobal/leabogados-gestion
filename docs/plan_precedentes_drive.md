# Pieza "Precedentes" — la app trae tus memos/propuestas/informes del Drive como base para redactar

La redacción IA deja de partir de un formato genérico embebido: busca en TU Drive el documento real más parecido (un memo, una propuesta, un informe pasado), tú eliges cuál, y la IA redacta a partir de ese precedente. Norte: contratar menos gente reutilizando el trabajo que el estudio ya hizo.

## Hallazgo: ya está ~80% construido

El frontend YA tiene todo lo difícil:
- **OAuth Google con lectura de Drive ya concedido** (`driveToken()`). Hoy la app lo usa para (a) importar propuestas desde la carpeta *Propuestas* y (b) subir/bajar comprobantes de notaría. O sea: **no hay que montar edge function, ni service account, ni pedir un nuevo consentimiento.**
- **Búsqueda en Drive ya implementada** — `driveGet(token, 'https://www.googleapis.com/drive/v3/files?q=...')` (App.jsx:4017): busca dentro de una carpeta por query.
- **Lectura de contenido ya implementada** — `extractFromFile` (App.jsx:4059): export de gdoc→docx + `mammoth`, y PDF→texto con `pdfjsLib`; más `driveDownloadB64` (13869) y las URLs export/`alt=media` (4346).
- **La IA** — `claudeCall`, ya enchufada.

La pieza es, por tanto, **cableado de frontend** reusando estos helpers + el asistente `AsistenteRedaccion`.

## Flujo

1. En el asistente, para Propuesta / Memo / Informe / Presentación, botón **"Buscar precedentes en mi Drive"**.
2. La app busca en la carpeta-precedente del tipo, por palabras clave del tema y/o nombre del cliente:
   `'<folderId>' in parents and trashed=false and (fullText contains '<kw>' or title contains '<cliente>') and (mimeType=pdf/docx/gdoc)` — mismo patrón que App.jsx:4017.
3. Muestra los resultados (título + fecha). **Tú eliges 1–2** (compuerta humana — nunca elige solo).
4. La app lee el contenido del elegido (export/download → texto, vía la lógica de `extractFromFile`) y lo pasa a la IA como bloque **"PRECEDENTE DEL ESTUDIO — sigue su estructura, tono y cláusulas; adapta los datos al caso actual"**.
5. La IA redacta partiendo de tu documento real, no de un formato genérico.
6. **Aprende** (filosofía del proyecto): recuerda qué precedente elegiste para ese tipo/cliente/área → la próxima vez lo ofrece primero.

Se suma a las fuentes que ya cruza: formato del estudio + radar SII (BI) + ficha del cliente (base de datos). El precedente es la cuarta fuente.

## Carpetas-precedente (ya ubicadas en tu Drive)

| Tipo | Carpeta | Folder ID |
|---|---|---|
| Propuesta | Propuestas | `1MQg9_q0l20mjB-LftuYQywTE4T81Kxf3` (ya usada por el código) |
| Memo | Memo | `1le4boJMW43HsTL0tHHnBsRwjzOc7leH0` |
| Informe | Informe / Informes | `1gZy27xu9s5hVIWlrDYjI276BCVhm2oV3` / `1ETnlJmL324pgaTc6OFlFeKzYGmrCJ3mj` |
| Presentación | Formatos y presentaciones | `1EHLBt7bqVFvTXk6KHsrHuzR7Ic7bClG0` |

> Decisión tuya: confirmar cuáles son las canónicas. Hay varias carpetas "Propuestas"/"Propuesta" porque también existen subcarpetas por cliente; conviene fijar UNA carpeta-biblioteca por tipo (o una carpeta madre "Precedentes" que las agrupe).

## Tamaño / tokens

Un precedente completo puede ser largo. v1: cap del texto (~6–8k caracteres) y 1–2 docs máximo. Si hiciera falta, fase posterior: una pre-llamada que condense la estructura del precedente antes de redactar.

## Privacidad

Los precedentes son documentos **propios del estudio**, ya accesibles en tu Drive. Van a la IA por el mismo canal que las features actuales (`claude-proxy` → API de Anthropic, que por términos comerciales no entrena con esos datos). La compuerta humana (tú eliges el precedente) y el acotar la búsqueda a las carpetas-precedente (no a todo el Drive) limitan la exposición. Aun así, es bueno tenerlo consciente: estás enviando el texto de documentos pasados a la IA.

## Fases

- **Fase 1 (chica, casi solo cableado):** buscar → elegir → leer → alimentar el prompt, reusando `driveToken`/`driveGet`/`extractFromFile` en `AsistenteRedaccion`. Resultado: el asistente parte de tu precedente real.
- **Fase 2 (aprende + índice):** recordar elecciones por tipo/cliente (tabla `precedentes_usados` o learnings) y una tabla-índice liviana (cache `{fileId,title,tipo,modifiedTime}` refrescada) para un selector instantáneo y filtrable sin pegarle a Drive cada vez.
- **Fase 3 (semántica / RAG, futuro):** embeddings (pgvector en Supabase) sobre el corpus de precedentes → búsqueda por significado ("la cláusula de no competencia que usamos") en vez de palabras clave. Más infra; solo si la búsqueda por keyword se queda corta.

## Lo único que necesito de ti  ([TÚ])

- Confirmar las carpetas-precedente canónicas por tipo (te propongo las de la tabla). Nada más: sin nuevo OAuth, sin GCP, sin service account.

## Riesgo / a verificar

- Asumo que el scope OAuth ya concedido permite leer archivos creados por humanos (no solo los que creó la app). El import de propuestas existente (carpeta *Propuestas*) ya lo hace, así que debería andar — a confirmar que la búsqueda devuelve resultados en producción con tu sesión.
