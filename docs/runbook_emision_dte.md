# Runbook — Puesta en marcha de la emisión DTE (certificación → producción)

Secuencia **mecánica** para cuando el SII apruebe la postulación. El motor ya está construido; esto es solo cargar credenciales, probar y certificar. Ver también `checklist_certificacion_sii_dte.md` (la parte administrativa) y `plan_facturacion_sii_2026-06.md`.

---

## 0. Pre-requisitos (de la Parte A del checklist)
- [ ] Postulación como facturador propio enviada en sii.cl.
- [ ] **CAF de certificación** descargados (XML `<AUTORIZACION>`) por cada tipo de DTE a certificar. El mínimo obligatorio del SII es factura, nota de crédito **y nota de débito**: 34 exenta, 61 y 56 (33 si emiten afectas).
- [ ] La postulación la hace el **representante legal** con certificado digital (inicio de actividades vigente, primera categoría).
- [ ] Datos del **Emisor**: RUT, Razón social, Giro, Acteco, Dirección y Comuna de origen.

## 1. Cargar credenciales (secretos de Supabase)
La firma usa el `.pfx` que **ya está** (`SII_CERT_B64`, `SII_CERT_PASSWORD`). Faltan estos (Project → Settings → Edge Functions → Secrets, o `supabase secrets set`):

```
SII_AMBIENTE_EMISION=certificacion # ambiente SOLO de emisión (DTE, libro, estado). SII_AMBIENTE sigue en produccion: es el de lectura (RCV, XML, observados)
SII_RUT_EMPRESA=77700387-9         # RUT del estudio (emisor)
SII_RUT_ENVIA=11111111-1           # RUT de la persona que envía (el dueño del certificado)
SII_EMISOR_RS=LIBERONA ESCALA ABOGADOS ...
SII_EMISOR_GIRO=Servicios jurídicos / asesorías profesionales
SII_EMISOR_ACTECO=691000           # código de actividad económica
SII_EMISOR_DIR=Av. Pdte. Kennedy 7900, of. 905   # la registrada en Mi SII (24-10-2026)
SII_EMISOR_COMUNA=Vitacura
SII_RESOL_FCH=2014-08-22           # en certificación
SII_RESOL_NRO=0                    # en certificación
```

## 2. Cargar el/los CAF en `dte_folios`
Por cada CAF (XML completo entre comillas simples; escapar comillas internas si las hubiera):

```sql
INSERT INTO dte_folios (tipo_dte, ambiente, folio_desde, folio_hasta, folio_actual, caf_xml)
VALUES (34, 'cert', 1, 50, 1, '<AUTORIZACION>…CAF completo…</AUTORIZACION>');
```
(`folio_desde`/`hasta` = el rango `<RNG>` del CAF; `folio_actual` = `folio_desde`.)

## 2b. Función de folio atómico (correr una vez en SQL)
La emisión reserva el folio con esta función (evita folios duplicados ante emisiones simultáneas):
```sql
CREATE OR REPLACE FUNCTION siguiente_folio(p_tipo int, p_ambiente text)
RETURNS TABLE(folio int, caf_xml text)
LANGUAGE sql AS $$
  UPDATE dte_folios
  SET folio_actual = folio_actual + 1
  WHERE id = (
    SELECT id FROM dte_folios
    WHERE tipo_dte = p_tipo AND ambiente = p_ambiente AND folio_actual <= folio_hasta
    ORDER BY folio_desde LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING folio_actual - 1, caf_xml;
$$;
GRANT EXECUTE ON FUNCTION siguiente_folio(int, text) TO service_role;
```

## 2c. Log de auditoría de emisión (correr una vez en SQL)
Registra cada emisión (folio, estado, errores, folios perdidos). Lo lee el módulo (Historial de emisión).
```sql
CREATE TABLE dte_log (
  id uuid primary key default gen_random_uuid(),
  billing_id uuid, tipo_dte int, folio int, track_id text,
  estado text, error text, ambiente text, created_by text,
  created_at timestamptz default now()
);
GRANT ALL ON TABLE dte_log TO authenticated, service_role;
ALTER TABLE dte_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_all ON dte_log FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'email') LIKE '%@leabogados.cl')
  WITH CHECK ((auth.jwt() ->> 'email') LIKE '%@leabogados.cl');
NOTIFY pgrst, 'reload schema';
```

## 2d. Reportes automáticos (cron)
**Secreto del cron**: setear el secreto `CRON_SECRET` (un string aleatorio) en los secretos de la edge function. El cron lo pasa para autenticarse sin un usuario. (Ya seteado + función desplegada.) El secreto SOLO autoriza las acciones de reporte (`verificar-estados`/`resumen-semanal`), nunca emitir/anular.
**OJO `verify_jwt=true`**: el gateway exige JWT, por eso el cron manda la **anon key pública** en `Authorization` (además del `cronSecret` en el body, que es la auth real).

**Auto-verificación del estado del DTE** (diaria): re-consulta los DTE "enviado", marca aceptada/rechazada y avisa por correo a los admins si hay rechazadas. Requiere extensiones `pg_cron` + `pg_net` (Database → Extensions). También se puede agendar desde el panel Cron Jobs de Supabase.
```sql
select cron.schedule('verificar-estados-dte', '0 12 * * *', $$
  select net.http_post(
    url := 'https://kibuwhtpoxrnfowfdolu.supabase.co/functions/v1/sii-sync',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer ANON_KEY_PUBLICA"}'::jsonb,
    body := '{"action":"verificar-estados","cronSecret":"EL_MISMO_CRON_SECRET"}'::jsonb
  );
$$);
```
(También hay un botón **"Verificar estados"** en el módulo SII para correrlo a mano.)

**Resumen semanal de facturación** (lunes): correo a los admins con emitidas de la semana, por cobrar, vencido, por enviar y DTE rechazadas.
```sql
select cron.schedule('resumen-semanal-facturacion', '0 12 * * 1', $$
  select net.http_post(
    url := 'https://kibuwhtpoxrnfowfdolu.supabase.co/functions/v1/sii-sync',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer ANON_KEY_PUBLICA"}'::jsonb,
    body := '{"action":"resumen-semanal","cronSecret":"EL_MISMO_CRON_SECRET"}'::jsonb
  );
$$);
```
(También hay un botón **"Enviar resumen"** en el módulo SII para probarlo.)

## 3. Desplegar
```
supabase functions deploy sii-sync
```

## 4. Validar la autenticación
`POST` a `…/functions/v1/sii-sync` con `{ "action": "test-auth" }` → debe responder `ok:true` con un token. (Ya validado para lectura; confirma que el ambiente quedó en certificación.)

## 5. Probar la emisión — vista previa (no envía nada)
Desde la app: abrir una factura → **Emitir al SII** hace `dryRun` y muestra folio/total; o `POST {action:'emitir', tipoDte:34, receptor:{…}, items:[…], dryRun:true}` para inspeccionar el `envioXml`.

## 5b. Validar contra los esquemas vigentes del SII

Antes del set de pruebas (y cada vez que el SII publique un formato nuevo): `zsh scripts/dte-validar/validar.sh`. Arma una factura exenta 34, una nota de crédito 61, el sobre EnvioDTE y el Libro de Ventas con el código real del motor y los valida con `xmllint` contra los XSD oficiales. Las cuatro líneas deben decir `validates`. Validado el 24-10-2026 con el formato 2.5 (06-02-2026).

## 5c. Verificar las firmas

`zsh scripts/dte-validar/firma.sh` arma con el código real un EnvioDTE (34 + 61), el Libro de Ventas y las tres respuestas del intercambio, firmados con una llave de prueba y con texto acentuado en ISO-8859-1, y verifica cada firma con una implementación independiente (lxml C14N + cryptography) y contra los esquemas. Las ocho líneas deben decir `digest OK · firma OK` y los cinco archivos `validates`. Verificado el 24-10-2026.

Reglas que la prueba fijó: el sobre y el libro **no declaran `xmlns:xsi`** (con él, la C14N inclusiva del elemento firmado lo hereda y el digest no calza); el archivo se envía en **ISO-8859-1**; las firmas XMLDSig digieren la C14N (UTF-8) y el timbre firma el DD en ISO-8859-1.

## 6. Set de pruebas (lo que el SII asigna tras postular)
- Cargar los casos del set (cada uno = un DTE con sus datos exactos).
- Emitir el set en UN sobre: `POST {action:'emitir-set', facturas:[ {tipoDte,receptor,items,…}, … ]}` → un `EnvioDTE` con todos los DTE → TrackID.
  - **Factura exenta (34):** `{tipoDte:34, receptor:{rut,rs,giro?,dir?,comuna?}, items:[{nombre,monto}]}`.
  - **Nota de Crédito (61) que anula una factura:** `{tipoDte:61, exenta:true, receptor:{…mismo de la factura…}, items:[{nombre,monto}], referencias:[{tpoDocRef:34, folioRef:<folio de la factura>, fchRef:'YYYY-MM-DD', codRef:1, razonRef:'Anula factura'}]}`. (`codRef`: 1=anula · 2=corrige texto · 3=corrige monto. `exenta:true` cuando la NC es de una exenta.) Requiere un CAF de tipo 61 cargado en `dte_folios`.
- Generar la **muestra impresa** (PDF con timbre) de cada caso (botón PDF / `facturaDtePdfBase64`).
- Generar y enviar el **Libro de Ventas**: `POST {action:'libro-ventas', periodo:'YYYY-MM', detalle:[…]}`.
- Consultar estado de cada envío.

## 6b. Intercambio de información
En Facturación › Facturación electrónica › **Intercambio**: subir el EnvioDTE que entrega el SII. La app descarga tres XML firmados (acuse de recibo, aprobación comercial y recibo Ley 19.983) que se suben en el portal de certificación (`action:'intercambio'` en sii-sync, `intercambio.ts`).

## 6c. Muestras impresas
PDF por documento (una página, texto vectorial, < 500 KB): timbre PDF417 de 2×4,5 a 4×9 cm, «Timbre Electrónico SII», «Res. N de AAAA» (se lee de la Carátula del sobre) y «Verifique documento: www.sii.cl». Las facturas llevan además su **copia cedible** (acuse de recibo Ley 19.983 y leyenda CEDIBLE: `facturaDtePdfBase64(doc,{cedible:true})`).

## 7. Enviar al SII y esperar autorización
Subir el set + muestras impresas + libros por el portal de certificación del SII. El SII revisa y **autoriza** como emisor electrónico.

## 8. Flip a producción
Al autorizar:
- [ ] Solicitar **CAF de producción** y cargarlos en `dte_folios` con `ambiente='prod'`.
- [ ] Cambiar secretos: `SII_AMBIENTE_EMISION=produccion`, `SII_RESOL_FCH`/`SII_RESOL_NRO` reales (de la resolución de autorización).
- [ ] `supabase functions deploy sii-sync`.
- [ ] Emitir la primera factura real desde la app (con su `dryRun` de seguridad).

---

## Puntos que se afinan recién acá (no testeables antes)
- **Firma XMLDSig**: si el SII la rechaza, `auth.ts` deja la "PLAN B" (microservicio xml-crypto). El digest/canonicalización del `<Documento>` se confirma con texto acentuado real.
- **Encoding**: resuelto el 24-10-2026 (ISO-8859-1, ver 5c). Falta solo confirmarlo con la respuesta real del SII en el set de pruebas.
- **Montos**: hoy se asume **34 exenta** (monto = exento). Para **33 afecta**, confirmar si el monto de `billing` es neto o con IVA antes de emitir afectas.
- **Folios**: atómicos con `siguiente_folio()` (2b).
- **En certificación nada toca Facturación**: «Emitir» con una factura real envía la prueba al SII pero no escribe folio ni estado en la factura.
