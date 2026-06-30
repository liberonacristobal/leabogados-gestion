# Cuenta de servicio de Drive — paso a paso (acceso permanente)

Objetivo: que la **app** quede conectada a Drive de forma permanente (sin "Reconectar Drive"), con acceso de **solo lectura** a las carpetas de clientes que tú le compartas. No depende del login de nadie.

Tiempo: ~15 min. Todo lo haces tú; la llave **nunca** pasa por el chat ni por el repositorio.

---

## 1. Proyecto en Google Cloud
- Entra a https://console.cloud.google.com → elige un proyecto o crea uno (ej. "Liberona Escala").

## 2. Habilitar la Google Drive API
- Menú → "APIs y servicios" → "Biblioteca" → busca **Google Drive API** → **Habilitar**.

## 3. Crear la cuenta de servicio
- Menú → "IAM y administración" → "Cuentas de servicio" → **Crear cuenta de servicio**.
- Nombre: `leabogados-drive` (o el que quieras). **No** le asignes roles (el acceso se da compartiendo carpetas, no con roles del proyecto). → **Listo**.

## 4. Crear la llave JSON
- Entra a la cuenta recién creada → pestaña **Claves** → **Agregar clave → Crear clave nueva → JSON** → se descarga un archivo `.json`.
- **Guárdalo en un lugar seguro. NO lo subas a Drive, ni al repo, ni lo pegues en ningún chat.** Es una credencial.

## 5. Copiar el correo de la cuenta de servicio
- En la cuenta de servicio verás un correo tipo `leabogados-drive@tu-proyecto.iam.gserviceaccount.com`. Cópialo.

## 6. Compartirle las carpetas en Drive
- En Google Drive, sobre la **carpeta madre de Clientes** (la que contiene las carpetas de cada cliente) → **Compartir** → pega el correo de la cuenta de servicio → rol **Lector** → Enviar.
- (Si tus clientes están en varias carpetas madre, compártele cada una. Heredan los subniveles automáticamente.)

## 7. Guardar la llave como secreto de Supabase
Por **CLI** (recomendado):
```bash
supabase secrets set GOOGLE_SA_KEY="$(cat /ruta/a/tu-archivo.json)"
```
O por el **Dashboard**: Supabase → Project → Edge Functions → Secrets → New secret → nombre `GOOGLE_SA_KEY` → valor = el **contenido completo** del archivo JSON (todo, incluyendo las llaves `{ }`). Guardar.

## 8. Desplegar la función
La función ya está en el repo (`supabase/functions/drive-sa`) y registrada en `config.toml`. Desplégala:
```bash
supabase functions deploy drive-sa
```

## 9. Avisarme
Cuando esté el secreto + el deploy listos, me avisas y conecto la app:
- **Pieza 2** — vincular la carpeta de Drive de cada cliente (auto-detecta por nombre + tú confirmas; queda guardado).
- **Pieza 3** — sección **"Documentos"** en la ficha de cada cliente: lista y abre/lee sus archivos del Drive, y la IA los usa como contexto al redactar.

---

### Notas
- **Scope:** solo lectura (`drive.readonly`). La cuenta de servicio solo ve lo que le compartas; no toca el resto de tu Drive.
- **Permanencia:** el servidor renueva el token solo; no hay que reconectar nunca.
- **Seguridad:** la función exige sesión de un correo `@leabogados.cl` (igual que el resto). La llave vive solo como secreto de Supabase.
- Si más adelante quieres que la app **guarde** documentos en Drive (no solo leer), se amplía el scope a `drive` y se comparte como Editor — un cambio chico.
