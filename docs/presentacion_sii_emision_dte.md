# Presentación al SII — Autorización para emitir factura electrónica (DTE)
### Liberona Escala Abogados · preparado 2026-06-29

Documento de preparación del trámite ante el SII para pasar de **leer** el SII (lo que la app ya hace) a
**emitir** documentos tributarios electrónicos. No reemplaza a tu contador/a — varios pasos son actos
formales del estudio; este doc te deja todo ordenado para ejecutarlos sin perderte.

---

## 0. La decisión que define todo (confirmar antes de seguir)

Para emitir factura electrónica en Chile hay **tres vías**. Cambian por completo el esfuerzo y qué se
"presenta" al SII:

| Vía | Qué es | Certificación del software | Costo | Integración con NUESTRA app |
|---|---|---|---|---|
| **A. Sistema gratuito del SII** | Emites en el portal del SII a mano | No aplica (es del SII) | $0 | Nula (no emite desde la app) |
| **B. Proveedor de mercado** (Nubox, Bsale, LibreDTE SaaS…) | Te suscribes a un emisor ya certificado y la app llama su API | La hace el proveedor | Mensual / por documento | Media (vía API del proveedor) |
| **C. Software propio certificado** | NUESTRA app emite directo al SII | **La hacemos nosotros** (set de pruebas SII) | Solo certificado digital + CAF | **Total** (emite desde la app) |

**"La presentación al SII para la autorización para facturar"** es, en rigor, la **vía C**: certificar
nuestro propio sistema. Es la que da integración total (emites desde la misma app que ya gestiona todo) y
sin costo por documento, pero implica un proyecto técnico + el proceso de certificación del SII.

**Mi recomendación**: si el norte es que la app sea el ERP del estudio, **vía C** vale la pena (control
total, sin dependencias). Si lo urgente es **emitir ya**, la **vía B** te pone a facturar en días y después
migramos a C. Este documento prepara la **vía C completa**; si eliges B, te armo la variante (es un subconjunto).

---

## 1. Requisitos previos del estudio (aplican a B y C)

Antes de cualquier cosa, el SII exige que la empresa cumpla:
- **Inicio de actividades vigente** (Liberona Escala Abogados como contribuyente).
- **Contribuyente de Primera Categoría** (Art. 20 Ley de la Renta) — una sociedad de servicios jurídicos lo es.
- **Sin situaciones pendientes con el SII** — ni la empresa, ni el representante legal, ni los usuarios que se autoricen.
- Definir **quién** será el representante legal que firma el trámite y qué personas serán **usuarios autorizados**.

> Dato tributario clave a confirmar con tu contador: desde 2023 los **servicios** están afectos a IVA (19%).
> Una sociedad de abogados normalmente emite **factura afecta (DTE 33)** con IVA, no boleta de honorarios
> (esa es de personas naturales). Esto define qué DTE certificamos (ver §4).

---

## 2. Paso 1 — Certificado digital (firma electrónica)

Es el "carnet digital" que firma cada documento. Se compra a una entidad acreditada por el SII:
**E-Sign, E-Certchile (Cámara de Comercio) o Acepta**.
- Tipo: certificado **para persona** (el representante legal) o **para empresa**, según lo que pida el proveedor; lo usual es a nombre del representante legal con el RUT del estudio asociado.
- Formato: archivo **`.pfx`** (con contraseña). Es el que cargaremos —como **secreto** en Supabase, nunca en el repo— para que la edge function firme los DTE.
- Costo y vigencia: tiene costo anual (referencial, confirmar con el proveedor) y vigencia 1–3 años.
- **Qué necesito de ti**: una vez emitido, el `.pfx` + su contraseña (me los pasas por un canal seguro, no por chat).

## 3. Paso 2 — Inscripción y ambiente de certificación

1. Con el certificado digital, entras a **sii.cl → Factura Electrónica → Sistema de facturación propio o de mercado**.
2. Creas el **usuario** y postulas a la certificación. El SII te habilita en su **ambiente de certificación
   (Maullín — `maullin.sii.cl`)**, que es un clon de producción donde se prueba todo sin efectos reales.
3. El SII **asigna un set de pruebas** específico a tu RUT.

> El SII elimina del ambiente de certificación a quien no registra actividad por 6 meses; conviene no
> empezar hasta tener el motor de emisión listo para correr el set de corrido.

## 4. Paso 3 — Certificación del software propio (el corazón)

Son **6 etapas**, todas en el ambiente Maullín. En cada una nuestra app debe **generar XML de DTE válidos,
firmados y timbrados**, y entregarlos al SII:

1. **Set de pruebas básico** — generar los DTE que vamos a emitir, con casos exactos que el SII define
   (montos, exentos, descuentos, varias líneas). Para un estudio jurídico, el set típico:
   - **DTE 33** — Factura electrónica afecta (IVA 19%).
   - **DTE 34** — Factura electrónica exenta (si emites servicios exentos).
   - **DTE 61** — Nota de crédito (anulaciones/correcciones).
   - **DTE 56** — Nota de débito (recargos).
   - *(No aplican guía de despacho 52 ni boletas 39/41: no hay bienes físicos.)*
2. **Set de simulación** — operar como un emisor real durante un período simulado.
3. **Set de intercambio de información** — recibir DTE de terceros y responder con los **acuses de recibo**
   y el **intercambio** (XML de respuesta) que exige el SII.
4. **Muestra de impresión** — enviar el **PDF/representación impresa** con el **timbre electrónico (PDF417)**.
   Acá reusamos `factura_dte_pdf_generator.js` que ya existe.
5. **Declaración de cumplimiento** — declarar formalmente que, además de pasar las pruebas, tienes los
   procedimientos y condiciones que el SII exige (respaldo, contingencia, etc.).
6. **Registro como emisor electrónico** — el SII te **autoriza** a emitir en producción.

## 5. Paso 4 — Folios CAF y producción

- Autorizado el emisor, solicitas los **CAF (Código de Autorización de Folios)** en sii.cl: rangos de folios
  por **cada tipo de DTE** (un CAF para 33, otro para 34, etc.). El CAF es un XML que la app usa para timbrar.
- Se cargan en la app (como dato/secreto) y el motor consume folios correlativos al emitir.
- Listo: emisión real en producción (`palena.sii.cl`).

---

## 6. Qué tiene la app hoy vs qué falta construir (vía C)

**Ya está:**
- `factura_dte_pdf_generator.js` — generador de PDF del DTE con timbre (sirve para la muestra de impresión).
- `sii-sync` — lectura del RCV, match con `billing`, manejo de folios. Toda la base de datos de facturación.

**Falta el motor de emisión** (una o más edge functions nuevas, con `service_role` + secretos):
1. **Armado del XML DTE** (estructura `Documento` por tipo, según el esquema oficial del SII).
2. **Timbre electrónico (TED)** — firmar el TED con el **CAF** y el correlativo de folio.
3. **Firma electrónica del DTE** con el certificado **`.pfx`** (XML-DSig).
4. **Sobre `EnvioDTE`** — empaquetar y **enviar al SII** (endpoint de recepción), con reintentos/idempotencia.
5. **Recepción del estado** — consultar el **track ID** y guardar la respuesta (aceptado/reparo/rechazo).
6. **Enganche en Facturación** — botón **"Emitir al SII"** en una programada/factura → reemplaza el folio
   placeholder por el folio real, estado pasa a *emitida*, y dispara el PDF + (opcional) el correo al cliente.
7. **Set de pruebas como modo** — un flag para correr Maullín (certificación) vs Palena (producción).

> Nota técnica: para acelerar, el motor puede apoyarse en una librería DTE probada (p. ej. **LibreDTE**
> open-source) DENTRO de nuestra edge function. Ojo: aunque uses la librería, la **certificación sigue siendo
> nuestra** (software propio) — la librería ayuda a pasar el set, no lo reemplaza.

---

## 7. Checklist de lo que necesito de ti para arrancar

**Decisiones:**
- [ ] **Vía**: ¿C (software propio, esta presentación) o B (proveedor, más rápido)?
- [ ] **DTE a emitir**: confirmar 33 (afecta) + 61 (nota de crédito). ¿También 34 (exenta)? ¿56 (débito)?

**Datos del estudio:**
- [ ] RUT de Liberona Escala Abogados + nombre/RUT del **representante legal**.
- [ ] Confirmar con el contador: inicio de actividades vigente, primera categoría, sin situaciones pendientes.
- [ ] Personas que serán **usuarios autorizados** en el SII.

**Credenciales (cuando las tengas):**
- [ ] **Certificado digital `.pfx`** + contraseña (E-Sign / E-Certchile / Acepta). Canal seguro, no chat.
- [ ] (Después de certificar) **CAF** por tipo de DTE.

---

## 8. Cronograma estimado (vía C)

| Hito | Responsable | Tiempo aprox. |
|---|---|---|
| Comprar certificado digital | Tú / contador | 1–3 días |
| Confirmar requisitos empresa | Contador | 1–2 días |
| Construir el motor de emisión (XML+TED+firma+envío) | Yo (la app) | el grueso del trabajo |
| Postular + correr set de pruebas en Maullín | Yo + tú (firma) | 1–3 semanas (iterando con el SII) |
| Declaración de cumplimiento + registro | Tú (representante legal) | días |
| Solicitar CAF + primera emisión real | Tú + la app | 1 día |

El trámite **ante el SII es gratuito**; el costo real es el **certificado digital** y el tiempo de
desarrollo + certificación.

---

## 9. Recomendación de arranque

1. **Confirmas la vía** (C o B) y los **tipos de DTE**.
2. En paralelo: **compras el certificado digital** (es el cuello de botella externo) y tu contador **valida
   los requisitos de empresa**.
3. Yo arranco el **motor de emisión** contra el ambiente de certificación (Maullín), empezando por el DTE 33.
4. Cuando el motor pasa el set, tú haces la **declaración de cumplimiento** y el **registro**; pedimos CAF;
   emitimos la primera factura real.

> Fuentes oficiales: SII — Etapas para ser facturador electrónico, Proceso de certificación (software propio/
> de mercado), Instrucciones para la construcción del set de pruebas, e Instructivo técnico de factura
> electrónica (sii.cl/factura_electronica). Confirmar montos y vigencias con el proveedor de certificado y el contador.
