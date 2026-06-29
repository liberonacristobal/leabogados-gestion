# Presentación al SII — Autorización para emitir factura electrónica (DTE)
### Liberona Escala Abogados · documento maestro (corregido 2026-06-29)

Cómo pasar de **leer** el SII (ya hecho) a **emitir** factura electrónica desde la app, directo al SII.
Este es el documento de cabecera; el detalle operativo vive en
[`checklist_certificacion_sii_dte.md`](checklist_certificacion_sii_dte.md) (el trámite) y
[`runbook_emision_dte.md`](runbook_emision_dte.md) (el motor).

---

## Estado real (lo importante)

- **Decisión tomada**: emisión **DIRECTO al SII**, con **software propio** (la app emite, sin proveedor).
- **Certificado digital**: ✓ ya lo tiene el estudio (`.pfx`, cargado como secreto para `sii-sync`).
- **Motor de emisión**: ✓ **construido** dentro de `supabase/functions/sii-sync/` — armado de XML (`dte.ts`),
  timbre TED + CAF (`caf.ts`), firma XMLDSig (`firma.ts`), envío + estado (`emision.ts`), libro de ventas
  (`libro.ts`), endpoints cert/prod (`config.ts`). UI: botón **"Emitir al SII"** con **vista previa dryRun**,
  PDF con timbre, anulación vía **Nota de crédito (61)**, panel "Emisión electrónica" en Facturación, y
  **reportes automáticos** (verificación de estados diaria + resumen semanal).
- **Qué se emite**: **siempre factura exenta — DTE 34** (decisión del estudio: nunca afecta/33) + **Nota de
  crédito 61** para anular/corregir.

**Lo único pendiente es el trámite regulatorio ante el SII** (postular + certificarse + CAF). El código no es
el cuello de botella; **el SII sí**. Eso es lo que "la presentación al SII" significa acá.

---

## Qué se presenta y se emite

| DTE | Nombre | Uso en el estudio |
|---|---|---|
| **34** | Factura exenta electrónica | Lo que el estudio factura (servicios jurídicos, exentos) |
| **61** | Nota de crédito electrónica | Anular/corregir una factura (el SII la exige) |

> No aplican: 33 (afecta/IVA — el estudio no emite afecta), 39/41 (boletas), 52 (guía de despacho, no hay bienes).
> Si en algún momento se decidiera emitir afecto, se agrega 33 al set; hoy queda fuera por decisión del estudio.

---

## Parte A — El trámite ante el SII (lo hace el estudio / contador en sii.cl)

**Esto corre el reloj. Conviene iniciarlo cuanto antes.** Pasos, en orden:

1. **Certificado digital vigente** — ✓ ya lo tienen.
2. **Postular como facturador electrónico propio**:
   sii.cl → *Servicios online* → *Factura electrónica* → *Sistema de facturación propio y de mercado* →
   *Inscripción / Postulación*. Declarar **software propio** y elegir los DTE a certificar: **34 y 61**.
3. **Descargar el SET DE PRUEBAS** que asigna el SII (casos con montos/glosas específicos).
4. **Solicitar CAF de CERTIFICACIÓN** (folios del ambiente de pruebas/Maullín) para el **34** y el **61**:
   sii.cl → *Factura electrónica* → *Solicitud de timbraje (CAF)* → ambiente certificación.
5. **Entregarme (como secretos, por canal seguro — nunca chat/correo en texto plano):**
   - Los **CAF** descargados (XML), para el 34 y el 61.
   - Datos del **Emisor**: RUT, razón social, **giro**, **Acteco**, dirección/comuna de origen, **sucursal SII**
     (ej. "Santiago Oriente"), y el **N° de resolución** de facturador electrónico que entregue el SII.
   - (El `.pfx` + contraseña ya están cargados; sirven igual para emitir.)
6. **Yo corro el set** en el ambiente de certificación y vamos **corrigiendo hasta que el SII apruebe**.
7. **El SII autoriza** al estudio como emisor electrónico.
8. **Solicitar CAF de PRODUCCIÓN** (34 y 61) y avisarme para el *flip* a producción.

## Parte B — El motor (ya está, lo corro yo)

Ya construido y a la espera de los CAF. Por cada DTE del set: arma el `Documento` → firma el **TED** con el
CAF → firma el **DTE** (XMLDSig) → empaqueta el **EnvioDTE** → lo **envía** al ambiente de certificación →
guarda **TrackID/estado** → genera el **PDF con timbre** → arma los **Libros** que el set pida. Todo con
**dryRun** primero (vista previa sin enviar). Secuencia mecánica completa en el runbook.

---

## Secuencia (quién depende de quién)

```
(A) Postular + elegir 34/61  →  (A) Set de pruebas + CAF certificación  →  (A) Entregar CAF + datos emisor
   →  (B) Motor corre el set (firma/envía/PDF/libro)  →  (A/B) Corregir hasta aprobar
   →  SII AUTORIZA  →  (A) CAF de producción  →  (B) flip a producción  →  emiten desde la app
```

El grueso del trabajo de desarrollo **ya está hecho**. El camino crítico ahora es **Parte A** (postulación +
certificación), que es trámite del SII con su propio plazo.

---

## Qué necesito de ti para arrancar YA

1. **Que postules** (tú o el contador) como facturador electrónico propio, eligiendo **34 y 61**. (Paso A2.)
2. **Datos del emisor** para configurar el motor: RUT, razón social, giro, **Acteco**, dirección/comuna de
   origen, **sucursal SII**.
3. Cuando el SII los entregue: el **set de pruebas** + los **CAF de certificación** (34 y 61) + el **N° de
   resolución**.

Con eso, corro el set en certificación y quedamos a un paso de la autorización.

> Fuentes: SII — *Etapas para ser facturador electrónico*, *Proceso de certificación (software propio/de
> mercado)*, *Set de pruebas*, *Instructivo técnico de factura electrónica* (sii.cl/factura_electronica).
> Montos/vigencias y la afectación a IVA, confirmar con el contador.

---

## Anexo — Postulación paso a paso (el Paso A2 en detalle)

**Antes de empezar, ten a mano:**
- El **certificado digital del representante legal**, instalado en el navegador (Chrome/Edge) o el `.pfx` + contraseña.
- Hazlo en un **computador** (no celular).
- Confirma con el contador (rápido): inicio de actividades vigente + primera categoría + sin situaciones pendientes con el SII. Si algo falla, el sistema te frena aquí.
- Ten claro qué vas a marcar: **software propio** + DTE **34 (factura exenta)** y **61 (nota de crédito)**.

**Pasos:**
1. Entra a **sii.cl** → **Iniciar sesión**, autenticándote con el **certificado digital** (no la clave tributaria simple; este trámite lo hace el **representante legal** con certificado). El navegador te pedirá elegir el certificado.
2. **Servicios online** → **Factura electrónica**.
3. Entra a **"Sistema de facturación propio y de mercado"** (la sección de quienes emiten con su propio software, NO el sistema gratuito del SII).
4. Abre el enlace de **inscripción / postulación** ("Inscríbase aquí"). Declara emisión con **software propio**.
5. **Marca los DTE a certificar**: **34 — Factura electrónica exenta** y **61 — Nota de crédito electrónica**. (No marcar 33/39/52.)
6. **Confirma** → quedas inscrito en el **Ambiente de Certificación y Prueba (Maullín)**.
7. En esa misma sección aparecen las **"Opciones para el postulante"**: **"Generación de set de pruebas"** (genera/descarga el set), y más adelante "Declarar avance", "Ver estado de postulación", "Intercambio de información", "Upload de muestras impresas", "Declarar cumplimiento de requisitos".
8. Solicita los **CAF de certificación** para el 34 y el 61: Factura electrónica → **"Solicitud de timbraje (CAF)"** → ambiente certificación → descarga los XML.

**Posibles trabas:** si pide "verificación de contribuyente de IVA", eso es para factura **afecta (33)**; como emites **exenta (34)** normalmente no aplica — confírmalo con el contador. El certificado debe estar **vigente** y ser el del **representante legal**.

**Cuando termines, pásame** (canal seguro): el **set de pruebas**, los **CAF de certificación (34 y 61)**, el **N° de resolución** y los **datos del emisor** (RUT, razón social, giro, Acteco, dirección/comuna de origen, sucursal SII).
