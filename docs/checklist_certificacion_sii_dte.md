# Checklist — Certificación como emisor electrónico (DTE propio) ante el SII

Para emitir facturas electrónicas **desde la app (software propio, directo al SII)**, el estudio debe primero **certificarse** ante el SII. Esto es un trámite **regulatorio** con su propio plazo — no depende del desarrollo. Este checklist separa lo que hace **el estudio/contador** (su clave SII + certificado) de lo que hace **la app/Cristóbal-dev** (el motor).

> Estado a 2026-06-27: tienen **certificado digital** ✓. Falta **CAF** y **toda la certificación**. Nunca han emitido electrónicamente.

---

## Parte A — La hace el estudio / contador (en sii.cl, con clave SII y certificado)

1. **Verificar certificado digital vigente** del estudio (la firma electrónica). ✓ (ya lo tienen)
2. **Postular como facturador electrónico propio**:
   - sii.cl → *Servicios online* → *Factura electrónica* → *Sistema de facturación propio y de mercado* → *Inscripción / Postulación*.
   - Declarar emisión con **software propio** y elegir los **tipos de DTE a certificar**.
3. **Definir los DTE a emitir/certificar** (confirmar con el contador):
   - **34** Factura exenta electrónica (es lo que el estudio emite hoy según la muestra).
   - **33** Factura afecta (si corresponde IVA en sus servicios — confirmar).
   - **61** Nota de crédito electrónica (para anular/corregir) — el SII suele exigirla.
   - **56** Nota de débito (si aplica).
   - **52** Guía de despacho (probablemente NO aplica a un estudio jurídico).
4. **Descargar el SET DE PRUEBAS** que asigna el SII (casos específicos con sus montos/glosas).
5. **Solicitar CAF de CERTIFICACIÓN** (folios del ambiente de pruebas/Maullín) para cada DTE del set.
   - sii.cl → *Factura electrónica* → *Solicitud de timbraje (CAF)* → ambiente certificación.
6. **Entregar a la app (como secretos, nunca por correo/chat en texto plano):**
   - El **.pfx + su contraseña** (ya configurado para `sii-sync`; sirve igual para emitir).
   - Los **archivos CAF** descargados (XML).
   - Datos del **Emisor**: RUT, Razón social, Giro, **Acteco**, Dirección/Comuna de origen, sucursal SII (ej. "Santiago Oriente").
7. **Tras aprobar la certificación:** solicitar **CAF de PRODUCCIÓN** y avisar para el *flip* a producción.

## Parte B — La hace la app (el motor `sii-emitir`, lo construyo yo)

- Generar y **firmar** cada DTE del set de pruebas (Documento + TED + XMLDSig).
- Armar el **EnvioDTE** y **enviarlo al ambiente de certificación**; obtener TrackID y estado.
- Generar la **muestra impresa** (PDF con timbre PDF417) de cada documento.
- Generar los **Libros electrónicos** que el set exija (Libro de Ventas / Compras).
- Manejar el **intercambio** (acuse de recibo + respuesta) si el set lo pide.

---

## Secuencia (quién depende de quién)

1. (A) Postular + elegir DTE → 2. (A) Descargar set de pruebas + CAF de certificación → 3. (A) Cargar cert + CAF + datos emisor como secretos → 4. (B) Motor genera/firma/envía el set + PDF + libros → 5. (A/B) Corregir hasta que el SII apruebe → 6. **SII autoriza** → 7. (A) CAF de producción → 8. (B) flip a producción → **emiten desde la app**.

**El reloj lo corre la Parte A (postulación + certificación del SII).** Conviene iniciarla cuanto antes; el motor (Parte B) se construye en paralelo y queda esperando los CAF.
