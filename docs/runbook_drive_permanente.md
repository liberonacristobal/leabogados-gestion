# Drive permanente — plan B (refresh token, sin llave)

Objetivo: que la app quede conectada a Drive de forma permanente, **sin llave de cuenta de servicio** y **sin tocar políticas de la organización**. Usa el mismo OAuth de Google que ya usas para iniciar sesión; el servidor renueva el acceso solo con un *refresh token*.

---

## 1. Correr el SQL
En Supabase → SQL Editor, pega y ejecuta `docs/sql_drive_auth.sql` (crea la tabla `drive_auth`).

## 2. Obtener el Client ID y el Client Secret de OAuth
Es el mismo cliente OAuth que tu app usa para "Iniciar sesión con Google".
- GCP Console → **APIs y servicios → Credenciales**.
- En "ID de clientes de OAuth 2.0", click en el que corresponde (el de la app / Supabase).
- Copia el **ID de cliente** y el **Secreto del cliente**.

## 3. Guardarlos como secretos de Supabase
Por CLI:
```bash
supabase secrets set GOOGLE_OAUTH_CLIENT_ID="EL_CLIENT_ID"
supabase secrets set GOOGLE_OAUTH_CLIENT_SECRET="EL_CLIENT_SECRET"
```
O por Dashboard → Edge Functions → Secrets → New secret (uno por cada uno). **No los pegues en el chat.**

> `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` ya existen como secretos por defecto; la función los usa para leer la tabla.

## 4. Desplegar la función
Ya está en el repo (`supabase/functions/drive`) y en `config.toml`:
```bash
supabase functions deploy drive
```

## 5. Conectar Drive (una vez)
- Entra a la app **con la cuenta que ve las carpetas de clientes** (la tuya de admin).
- Menú ☰ → **"Conectar Drive (permanente)"** → te lleva a Google, autorizas → vuelves.
- En ese momento la app captura el *refresh token* y lo guarda en `drive_auth`. Listo: desde ahí el servidor renueva el acceso solo, para siempre.

## 6. Avisarme
Cuando esté conectado, sigo con:
- **Pieza 2** — vincular la carpeta de Drive de cada cliente (auto-detecta por nombre + confirmas; aprende).
- **Pieza 3** — sección **"Documentos"** en la ficha de cada cliente (lista + abre/lee sus archivos, y la IA los usa como contexto).

---

### Notas
- **Permanencia:** el *refresh token* no expira por tiempo; el servidor pide un token fresco cuando hace falta. Solo se invalida si revocas el acceso de la app en tu cuenta de Google o cambias la contraseña — en ese caso, repites el paso 5.
- **Quién conecta:** debe ser una cuenta con acceso a las carpetas de clientes (admin). Si lo hace alguien con menos acceso, la app verá menos carpetas. Por eso "Conectar Drive (permanente)" solo aparece para admin.
- **Seguridad:** scope de Drive ya concedido en tu login; el secreto del cliente vive solo en Supabase; la función exige sesión `@leabogados.cl`.
