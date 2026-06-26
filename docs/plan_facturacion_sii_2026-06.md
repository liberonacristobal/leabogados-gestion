# Plan de trabajo — Facturación + SII (levantamiento 2026-06-26)

## 1. Levantamiento — qué tenemos hoy

### SII
- **`sii-sync` (edge function) — Fase 1 LECTURA · ACTIVA.** Lee el Registro de Ventas/Compras (RCV) del SII, matchea con `billing`, ingresa facturas huérfanas y corrige folios. Modal "Sincronización con el SII" (~App.jsx:5038).
- **`sii-radar` (edge function) — Radar tributario · ACTIVA.** Novedades del SII cruzadas con clientes por área; alimenta el "Plan del Año" (interno BI + outlook SII) en el Dashboard/Inteligencia.
- **Emisión electrónica (DTE) — ✗ PENDIENTE (lo grande).** Hoy NO se emiten facturas al SII desde la app. Existe el doc `factura_dte_pdf_generator.js` (generador de PDF DTE con timbre), pero falta el motor completo.

### Facturación (módulo billing)
- **Hecho hoy (26-jun):** cuotas/recurrentes vencen el día 1 + plazo 30 días + flip a Vencido; tarjeta "Por cobrar" clickeable; chip "⚠ N conciliar" alineado al criterio del modal.
- **Asistente "Conciliar facturas" · funciona:** duplicados, sin proyecto (por serie), programadas ya emitidas (match por cuota N/M o período + tolerancia).
- **Acciones por factura:** anular ✓ · descargar PDF (scraping MIPYME, **bloqueado** por captura de red) · **enviar por correo: pendiente**.
- **Rediseño global** (tabs por estado, 2 KPIs, aging semáforo, registrar pago, FAB): render aprobado, **NO construido** (BillingView es grande; no romper SII/anticipos/terceros).
- Anticipos y terceros (cuentas por pagar): construido.

### Conciliación bancaria (engine, spec `prompt_fase2_completo.md`)
- Motor endurecido: invariantes INV-1..13, casos TC-01..25, RPC atómico, división N partes, reversibilidad, idempotencia.
- **Hecho hoy:** matching exacto mejorado (desempate saldo-safe, ventana +90), aprende por nombre, sugerencias en lote (modal), flip Vencido.
- **Gate a "Fase 3" abierto:** falta RPC atómico, verificación formal de invariantes + TC, y cuadre global confirmado con cartola real.

## 2. Plan de trabajo (priorizado)

### FOCO A — SII emisión electrónica (DTE) · el salto estratégico
Cierra el ciclo (hoy lees, no emites). Pasos:
1. **Decisión de arquitectura (bloqueante):** ¿emisión **directa al SII** (certificado + CAF propios) o vía **proveedor DTE** (LibreDTE / Facturación.cl / similar)? El proveedor es mucho más rápido de integrar.
2. **Credenciales:** certificado digital del estudio + CAF (folios autorizados) por tipo de DTE.
3. **Alcance:** qué DTE emitimos (33 factura afecta, 34 exenta, ¿39 boleta?).
4. **Motor de emisión** en una edge function: arma DTE → firma → envía al SII → recibe TED/timbre + folio → genera PDF (reusar `factura_dte_pdf_generator.js`).
5. **Enganche en Facturación:** botón "Emitir al SII" en una programada/factura → reemplaza el folio placeholder por el folio real emitido; estado pasa a emitida.

### FOCO B — Cerrar el módulo Facturación (pulido, rápido)
- **Enviar factura por correo** (4C) — reusar el motor de correo de la rendición (logo/firma/Gmail).
- **Descargar PDF** — una vez tengamos emisión DTE, usar el PDF propio (resuelve el bloqueo del scraping MIPYME).
- Rediseño global (opcional) si vale la pena el esfuerzo.

### FOCO C — Cerrar conciliación bancaria (gate Fase 3, robustez de plata)
- RPC atómico `aplicar_conciliacion` / `deshacer_conciliacion` (re-verifica saldo en la transacción).
- Verificar INV-1..13 con SQL + correr TC-01..25.
- Cuadre global (INV-13) con cartola real.

## 3. Recomendación para arrancar mañana
Como el pedido es "facturación y SII", el **norte es FOCO A (emisión DTE)**. Pero arranca con la **decisión de arquitectura** (directo vs proveedor) y las **credenciales/CAF** — sin eso no se puede emitir. En paralelo, cerrar lo **rápido del FOCO B** (correo) que no depende del SII. El FOCO C queda para después.

**Decisiones a confirmar con el usuario antes de construir:**
1. Emisión: ¿directa al SII o vía proveedor DTE? (recomendado: proveedor, por velocidad/seguridad).
2. ¿Tienen certificado digital + CAF, o hay que gestionarlos?
3. Tipos de DTE a emitir (33/34/39).
