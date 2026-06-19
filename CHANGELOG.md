# Changelog

## 2026-06-19 — Fase 3 · alineación incremental: mini-KPI de ficha
- Cifra de las mini-KPI densas de la ficha (Por cobrar / Saldo fondos / A favor) de 15px (fuera de escala) a 13px (en escala, tier denso). No se sube a 17 para no desbordar montos grandes en iPhone.

## 2026-06-19 — Fase 3 · Tanda 4 (paleta → objeto C)
- Canonizados 6 colores que estaban fuera de C: azulInfo (#185FA5), azulBg (unifica #E6F1FB y #E6EEF1 en uno), tealBg/tealText, ambarBg/coralText, grisText.
- Reemplazados cientos de hex literales por su token de C (C.accent/C.muted/C.done/etc.) en valores de estilo JSX y ternarios — mismo valor, fuente única. Patrón anclado en : / ? para no tocar atributos SVG ni strings HTML de correo/PDF (esos quedan literales a propósito).
- Único cambio visual: ~111 usos de #E6EEF1 pasan al celeste unificado #E6F1FB (imperceptible).

## 2026-06-19 — Fase 3 · Tanda 3 (cifras de fila + etiqueta KPI)
- Cifras de fila (montos) unificadas a 13/600 en las líneas que renderizan dinero (fmt/fmtN/fmtM/fmtShort/fmtCLP/fmtUF). Antes mezclaban 12/700 y 13/700.
- Etiqueta KPI (helper kpiLbl) 10→9 (canon). Pendiente: barrido de los 105 labels de sección 10px (riesgo de densidad mobile, requiere confirmación).

## 2026-06-19 — Fase 3 · Tanda 3 (fracciones + títulos de modal)
- Colapsadas 46 tamaños de fuente fraccionarios (8.5/9.5→9, 10.5/11.5→11, 12.5/13.5→13). Sin sistema de medios-puntos.
- Títulos de modal unificados a 16/600: 5 que estaban a 15 (Dar de baja factura, Emitir por el bloque, Cubrir cuotas, Deshacer importación, Liquidar a notaría) y Registrar gastos (16/700→600). Nombres de proveedor intactos.

## 2026-06-19 — Fase 3 · Tanda 3 inicio (escala tipográfica: cifras KPI)
- Escala única aprobada: tamaños 9·11·13·16·17·20, pesos 400/600. Cifra KPI = 17/600 (canon del dashboard).
- Unificadas a 17/600 las cifras KPI divergentes: caja chica (helper kpiVal, era 15/700), tabs de facturación Pendiente/Vencido (16/700) y Pendiente a notaría (16/700). Mismo color y valor. Las mini-KPI densas de la ficha quedan para una sub-tanda aparte.

## 2026-06-19 — Fase 3 · Tanda 2 (cierre: dedup fechas + barrido parseInt/UF)
- Dedup: 5 helpers de fecha locales (fmtDMY/dmy) ahora delegan al global fmtFechaDMY. Salida idéntica.
- Dinero: 6 formateadores locales con parseInt (n/fmtCLP0/fmt0) → global fmt. Enteros idénticos; decimales redondean (antes truncaban); negativos con signo -$ correcto.
- UF: las UF sueltas pasan a fmtUF (prefijo "UF X", el canon); celdas de Excel intactas.

## 2026-06-19 — Fase 3 · Tanda 2 (formatos de fecha y dinero)
- Fechas de timestamp (created_at/sent_at): nuevo helper fmtFechaTS = fecha LOCAL en DD-MM-AAAA, aplicado en 6 sitios. Evita el bug de zona horaria de cortar el ISO en UTC (corría el día en registros nocturnos) y unifica el formato.
- Dinero: consolidados 3 helpers locales divergentes (fmtN/fmt/fmtM) al formateador global fmt (Intl). Positivos idénticos; negativos corrigen el signo 569Xl1.234 → -.234. Sin cambio de valor ni de color.

## 2026-06-19 — Fase 3 · Tanda 1 (microtexto + regla RS)
- Regla nueva: razón social en MAYÚSCULAS, sin bold. Helper único renombrado titleCaseRS→rsDisplay (uppercase); dato crudo intacto, PDF/export legales sin tocar.
- F° → Factura N° en los 2 sitios de UI restantes; separador RS·RUT unificado a punto medio.

## 2026-06-19 — Auditoría Fase 2: UF de respaldo centralizada (rank 6)
- El valor UF de respaldo (40000 CLP) estaba hardcodeado en 9 conversiones UF↔CLP dispersas; si cambiaba, había que tocar 9 lugares y arriesgar divergencia de cifras. Ahora hay una constante única `UF_FALLBACK`. Mismo valor, sin cambio de comportamiento.

## 2026-06-19 — Auditoría Fase 2: fixes autónomos (rendimiento + higiene)
- Rendimiento Conciliación (rank 1, el único con impacto real en runtime): `facturasCliente`/`clientePorMonto` re-escaneaban TODO `billing` por cada movimiento dentro de memos que corren con hasta 8.000 movimientos → O(movs×facturas), congelaba el iPhone al entrar o filtrar. Ahora se indexan las facturas con saldo una vez (`facturasConSaldo` + `facturasPorCliente`, memoizados) y el lookup por cliente es O(1). Misma lógica de filtrado, sin cambio de comportamiento.
- Higiene de repo: quitados del control de versiones los 55 backups `src/App.jsx.bak_*` (22 MB) que ensuciaban toda búsqueda de código; agregado `*.bak*` a `.gitignore`. El historial de git conserva las versiones.
- Doc: corregido el conteo de líneas en CLAUDE.md (~5200 → ~16.250).

## 2026-06-19 — Seguridad: API key de Anthropic fuera del front (edge function claude-proxy)
- Auditoría (crítico): la API key de Claude viajaba en el bundle público de Vercel (`import.meta.env.VITE_ANTHROPIC_API_KEY` + `x-api-key` + `anthropic-dangerous-direct-browser-access`) en ~10 llamadas directas a `api.anthropic.com`. Cualquiera con la URL podía extraerla y gastar con cargo a la cuenta.
- Fix: nueva edge function `claude-proxy` (verify_jwt=true, valida que el email del JWT sea del equipo) que guarda `ANTHROPIC_API_KEY` como secreto de Supabase y reenvía a Anthropic. El front llama a esa función vía un único helper `claudeCall()`; nunca toca la key ni api.anthropic.com. Modelos en allowlist, max_tokens acotado.
- Requiere (acción manual): rotar la key actual en la consola de Anthropic, fijar el secreto `ANTHROPIC_API_KEY`, deploy de `claude-proxy`, y quitar `VITE_ANTHROPIC_API_KEY` de las env vars de Vercel.

## 2026-06-19 — Correo servidor: encabezados ASCII (MIME ya no se rompe)
- Auditoría: los correos del fallback de servidor (denomailer) llegaban como texto crudo, sin adjuntos. Causa: denomailer arma mal el "encoded-word" RFC 2047 del Asunto/From con tildes (token con espacios, sin plegar) → rompe el bloque de encabezados y el cliente muestra todo el MIME literal. Fix: encabezados (Asunto + nombre remitente) solo en ASCII; el cuerpo conserva las tildes. Requiere deploy de `notify-task`.

## 2026-06-19 — Notaría · Excel con formato + "Permitir adelanto" condicional
- El Excel de liquidación (descarga y adjunto al correo de la notaría) ahora va formateado: título navy, encabezados, bordes, filas zebra y montos en CLP. Usa `xlsx-js-style`. El correo a la notaría adjunta el Excel como detalle (con PDF de respaldo si el Excel fallara).
- "Permitir adelanto" en los pendientes de notaría solo se muestra cuando el cliente NO cubre con su saldo (o si ya está activado, para poder apagarlo). Si cubre, no aparece.

## 2026-06-18 — Notaría · liquidar (guardar) → enviar con comprobante
- "Liquidar" ahora solo GUARDA la liquidación como **Por enviar** (sin correo). Se mantienen los chequeos de fondos/adelanto. El modal ya no pide correo.
- Nuevo paso **Enviar a notaría** (bottom sheet) desde el registro: muestra el **total a transferir**, deja **adjuntar el comprobante de transferencia** del banco (imagen/PDF, sube a Drive) y el correo de la notaría. Al enviar, el correo lleva **2 adjuntos** (detalle PDF + comprobante) y marca la liquidación **Enviada ✓** (guarda `comprobante_url`, con enlace "Ver comprobante").
- Registro con 3 estados minimalistas: **Por enviar** (ámbar, con botón Enviar destacado) · **Enviada ✓** (verde) · **Pagado histórico** (gris). Compat con filas viejas (sin `estado_envio`: con `sent_at`→enviada, si no→pagado).
- Multi-adjunto: `sendGmailWithPdf` y la edge `notify-task` aceptan varios adjuntos (compat con el envío de un PDF). **Requiere `supabase functions deploy notify-task`.**
- Texto del correo actualizado (asunto e intro mencionan el comprobante; total rotulado "Total transferido").
- SQL (corrido por el usuario): `rendiciones.estado_envio text`, `rendiciones.comprobante_url text`.

## 2026-06-18 — Correo de notaría · MIME corregido (cuerpo + PDF)
- Cliente (`sendGmailWithPdf`, envío desde el Gmail del admin): el base64 del HTML, el texto y el PDF iban en una sola línea; al reenviar por SMTP esas líneas (>998) se truncaban → cuerpo y adjunto corruptos. Ahora cada bloque base64 se corta en líneas de 76 (RFC 2045). El subject queda como encoded-word sin cortar (header).
- Servidor (edge function `notify-task`, fallback para usuarios sin gmail.send): `denomailer` re-codificaba el adjunto recibido en base64 → PDF corrupto. Ahora se decodifica a bytes y se envía como binario (codifica una sola vez). Requiere `supabase functions deploy notify-task`.

## 2026-06-18 — Modal de gastos · rediseño compacto (canon)
- Layout alineado a "Editar cliente": Categoría (desplegable) · Monto · Fecha en una sola fila. Fecha ahora es un botón-calendario con formato breve ("15 jun"; muestra el año solo si no es el actual) → libera ancho. Descripción a doble alto (textarea). Proyecto a fila completa. Cliente · Razón social en pareja.
- Slot condicional bajo la fila 1: OT cuando la categoría es Notaría, Subcategoría cuando es Otro.
- Fecha obligatoria: se precarga con hoy y Guardar queda deshabilitado sin monto ni fecha.
- "Gasto personal" y "Adjuntar" pasan a una barra al pie. Al marcar gasto personal se atenúan Cliente/Razón social (el gasto no se le carga a nadie).

## 2026-06-18 — Facturas: nomenclatura unificada "Factura N° XX"
- Toda mención a una factura en la app dice "Factura N° XX" (antes "F°XX" / "F°Factura XX"). El folio se limpia con `folioN` para no duplicar la palabra "Factura". Aplica a tareas/cobro, conciliación bancaria (sugeridas, combos, conciliadas) y estado de cuenta.

## 2026-06-18 — Conciliación · Fase 3.D · cargo por cuenta de un cliente
- En un cargo (oficina paga a Notaría/CBR/proveedor) por un asunto de un cliente: acción "Por cuenta de un cliente…" → elige cliente + razón social → crea un gasto (expenses type='gasto') que DESCUENTA el fondo del cliente, enlazado a la conciliación (tipo_destino='gasto', gasto_id) y reversible. Aprende glosa→cliente (chip "sugerido" la próxima vez). Deshacer borra el gasto creado. Movimientos del Estado de cuenta lo rotula "Gasto por cuenta del cliente". No requiere SQL.

## 2026-06-18 — Estado de cuenta · navegación bidireccional
- Desde el detalle de una factura: "ver venta ↗" salta a la ficha de la venta/proyecto (modal Sale). Desde el detalle de un gasto/fondo con venta enlazada: ídem.
- Desde el pago "verificado en banco" de una factura: "ver movimiento ↗" cambia al tab Conciliación, limpia filtros, abre y resalta ese movimiento (con scroll). Estado `concFocus` en App + prop `focusMovId`/`onFocusConsumed` en ConciliacionView (espera a que carguen los movs antes de enfocar).

## 2026-06-17 — Conciliación · sugerir "factura + gastos" (reembolso junto a honorarios)
- Cuando un abono excede una factura y el exceso coincide con los gastos pendientes de reembolso del cliente (ledger fondos−gastos, descontando lo ya reembolsado por conciliación), ofrece "F°X + $Y gastos": aplica el saldo a la factura (la marca pagada) y registra el exceso como reembolso de gastos (fila conciliacion tipo_destino='gasto'). Solo sugiere si el cliente realmente debe gastos ≈ el exceso (no en cualquier abono grande). Reversible. Primer pedazo de Fase 3; el marcado fino del ledger de gastos vendrá después.

## 2026-06-17 — Conciliación · match combinación + auditoría (3 revisores) y fixes
- Match de combinación: 1 transferencia que paga 2 facturas se ofrece como botón "Paga 2: F°A + F°B" (elige el mejor par dentro de ±$2.000); todo reversible.
- Auditoría con 3 revisores (lógica/estado, cifras, integridad). Corregido: deshacer con acumulador local (varias filas sobre la misma factura ya no descuentan mal); bloqueo de deshacer si el saldo a favor ya se consumió (evita doble conteo); atomicidad (si una conciliación/saldo-a-favor falla a mitad, se borra la fila/anticipo huérfano); facturas con monto ≤0 fuera del pool; chequeo de `.error` en propagación de aprendizaje; sugerencia por nombre endurecida (stoplist de nombres de pila comunes + token distintivo, menos falsos); deps de memos completadas.

## 2026-06-17 — Conciliación · sugerir cliente por nombre (cruce con facturas emitidas)
- Para abonos sin RUT registrado, cruza el nombre del banco contra nombres de clientes y razones sociales del receptor de facturas emitidas; si apunta a un cliente único, ofrece un chip "¿Cliente?" que al confirmar asocia y aprende el RUT (compuerta humana, nunca automático). Cubre ~52 de los 143 sin identificar. Auditoría de cruces: por RUT da 0 (el resolver ya los toma), por monto solo es poco confiable (coincidencias de montos redondos), por nombre es el confiable.

## 2026-06-17 — Conciliación Fase 2 · descalces + fondos en cuenta Gastos
- Filtro **Descalces**: abonos no conciliados que no calzan (sin cliente asociado, o con cliente pero sin factura) — la cola de excepciones a revisar tras conciliar el histórico. "Por conciliar" ahora solo lista las que tienen factura candidata.
- **AUTO ya no toca la cuenta de Gastos**: un abono ahí casi siempre es fondo (provisión), no honorario → revisión manual. El link de clasificar en esa cuenta sugiere "¿fondo de gastos?".
- Nueva categoría de abono **Fondo** (provisión para gastos): identifica los fondos y los excluye del calce de honorarios (el cruce contra el ledger de gastos llega en Fase 3). Resumen muestra N abonos en cuenta Gastos (fondos).

## 2026-06-17 — Conciliación Fase 2 · pool ampliado (enlazar facturas ya pagadas)
- El pool de calce ahora incluye facturas Pendiente **+ Pagada-sin-conciliar**. La mayoría de los pagos reales son de facturas ya marcadas Pagado (131 de 230 abonos): esas solo se **enlazan** (dejan la evidencia bancaria + reconciled_at='conciliacion-link', sin cambiar estado/monto). Sube el calce automático de 9 a ~88.
- Deshacer un enlace a factura ya pagada solo quita el enlace (no la des-paga). Etiquetas "ya pagada" en chips y mes de emisión en el selector para distinguir facturas recurrentes del mismo monto.

## 2026-06-17 — Conciliación bancaria · Fase 2 (motor de conciliación)
- Motor que concilia abonos de cliente contra facturas Pendiente. **Conciliar automático**: calza solo cuando hay UNA factura del cliente dentro de ±$2.000 del monto; marca la factura Pagado (paid_at/payment_method='Transferencia'/payment_ref=n° operación, vía helper único `persistPagoFactura` para no divergir de cómo la app ya marca Pagado), crea fila en `conciliacion` y deja el movimiento conciliado.
- **Bandeja por confirmar** (lo ambiguo): botones de factura candidata, "otra factura" (todas las pendientes del cliente), reparto parcial (un abono cubre varias / queda resto), y **Saldo a favor** (crea anticipo `disponible`, reutiliza Anticipos). Solo abonos de honorarios; Comisión/Subarriendo/Otro quedan fuera del cruce.
- **Todo reversible**: "deshacer" revierte la factura a Pendiente, borra la conciliación y el anticipo, y deja el movimiento pendiente.
- Filtros Todos / Por conciliar / Conciliadas + resumen N conciliadas y monto por conciliar.
- Importador endurecido: al recargar cartolas solo inserta los movimientos nuevos (no pisa estado/cliente_id/categoría de los ya cargados) → recargar nunca deshace una conciliación. Ignora temporales de Excel `~$`.

## 2026-06-17 — Conciliación: contraste de cuentas + robustez
- Borde de cuenta con más contraste: Gastos pasa de café oscuro #854F0B a ámbar vivo #EF9F27 (Honorarios sigue navy #003C50); a 3px se distinguen al instante. Aplica al borde de cada movimiento y al panel "Cartolas cargadas".
- Robustez de escritura: `setCategoria`, `identificar`, `guardarRut` y el upsert de importación ahora revisan el `error` de Supabase y avisan/abortan en vez de fallar en silencio (la UI ya no muestra "éxito" si el write no persistió).
- Quitado el filtro redundante "Abonos en cuenta Gastos" (chocaba con el nuevo filtro por cuenta corriente y dejaba la lista vacía).

## 2026-06-17 — Conciliación bancaria · Fase 1 (importación + identificación)
- Nuevo módulo (read-only). Parser BICE en `src/cartola.js` (cuentas honorarios/gastos, RUT/nombre desde glosa, año desde glosa/período, traspasos internos = es_interno, dedup por hash). `ConciliacionView` en App.jsx, entrada en el menú ☰ "Conciliación bancaria" (admin), pantalla completa.
- Carga multi-archivo .xlsx (upsert por hash, re-subir no duplica), resuelve cliente por alias → razón social → cliente → receptor de factura; KPIs (abonos/cargos/internos/sin identificar), reporte por archivo con verificación vs Total del banco (✓ si diferencia 0), subvistas Abonos/Cargos, filtro "abonos en cuenta Gastos", crear alias. NO concilia (Fase 2). SQL corrido a mano. Prompt en docs/.

## 2026-06-17 — Gastos: landing como resumen (lista de clientes oculta por defecto)
- El landing de Gastos parte como resumen (tarjetas de saldo + cobranza por responsable + personales); la lista de clientes ya NO se muestra por defecto. Aparece al tocar un saldo, un responsable, "Todos", "Archivados", o al buscar. Mensaje guía cuando está oculta. saldoFilter por defecto pasa a 'todos'.

## 2026-06-17 — Cobranza por responsable (mini-tarjetas) en Gastos
- Debajo de los saldos globales, mini-tarjetas por abogado responsable con la **deuda por cobrar** de cada uno = suma de los saldos negativos de SUS clientes (NO se compensa con los clientes que están a favor). Ordenadas por mayor deuda. Tocar una filtra las tarjetas globales y la lista a ese responsable; el saldo (negativo/a favor) decide qué muestran las mini (por cobrar vs a favor). "Todos" limpia.

## 2026-06-17 — Tarjeta "Personales · debes a la oficina" en Gastos
- Nueva tarjeta en el landing de Gastos con los gastos personales (personal_de): limited ve solo el suyo ("Tus gastos personales · debes a la oficina $X"), admin ve a todos por persona. Se despliega al tocar; cada gasto abre su ficha. Los gastos personales se excluyen del bucket "Sin cliente" (ya tienen dueño).

## 2026-06-17 — Carga masiva: "¿De quién es?" en el preview
- En el preview de la carga, las filas sin cliente externo (sin cliente u oficina) muestran "¿De quién es?" con chips de los 5 miembros: marcar una la deja como personal de ese miembro (sale del cliente) en el momento de cargar, sin triagear después. "Quitar" revierte.

## 2026-06-17 — Asignar responsable desde la vista de Gastos del cliente
- En el detalle de Gastos de un cliente (donde se ven los ocasionales, ocultos de la lista formal), el encabezado trae el chip "Asignar responsable ▾" / "Responsable: X ▾" para asignar/cambiar el abogado que gestiona el cobro (usa handleUpdateClientFields). Antes solo estaba en la ficha de la pestaña Clientes, inaccesible para ocasionales.

## 2026-06-17 — Crear ocasional ya con responsable (carga masiva)
- En el preview, "+ Ocasional" despliega los abogados (o "Sin responsable"): al elegir, crea el cliente ocasional ya con ese `abogado_responsable` y le asigna el gasto, sin tener que entrar a la ficha después. handleCreateOccasional ahora acepta responsable.

## 2026-06-17 — Clientes ocasionales: crear al vuelo (paso 2)
- "+ Ocasional" en el preview de carga masiva (filas sin cliente, usa el nombre de la columna Cliente) y en "Sin cliente" (huérfanos, pide el nombre). Crea un cliente liviano `is_occasional=true` y le asigna el gasto. `handleCreateOccasional` reusa el cliente si ya existe con ese nombre.

## 2026-06-17 — Clientes ocasionales: base (paso 1)
- Cada ocasional será su propio cliente liviano (no un cajón compartido). Paso 1: columna `is_occasional` en clients (SQL aparte), chip "ocasional" en la ficha y en la lista de Gastos, y se ocultan de la lista formal de Clientes (viven en Gastos/cobranza con su saldo y responsable). Pendiente: "crear como ocasional" en carga masiva/huérfanos + migrar el cajón actual.

## 2026-06-17 — Asignar responsable desde la ficha del cliente
- En el encabezado de la ficha, el chip de responsable es tocable: si no hay, dice "Asignar responsable ▾"; al tocarlo aparecen los 5 abogados para asignar (o "Quitar"). Sirve para que los clientes ocasionales (bucket "General") se asignen a un abogado que gestione el cobro.

## 2026-06-17 — Triage de oficina colapsado (menos recargado)
- En el gasto de oficina, el triage ahora es un solo pill "Oficina ▾" por defecto; al tocarlo aparecen los 5 miembros para reasignarlo (o "es de la oficina" para cerrar). Antes mostraba siempre los 5 chips + hint, lo que recargaba la tarjeta.

## 2026-06-17 — Gastos de oficina: triage a miembro o a la oficina
- Los gastos bajo «Liberona Escala» (oficina) muestran "¿De quién es?" con chips de los 5 miembros: tocar uno lo manda a `personal_de` (sale del folder de la oficina y queda como "Personal · [nombre]"); dejarlo así = gasto de la oficina. Pill "Personal · [nombre]" en la tarjeta.
- El modal de Editar gasto trae un selector "Personal de un miembro" (chips): al asignar, el gasto sale del cliente y queda personal.

## 2026-06-17 — Carga masiva: dedupe por OT + aviso de duplicado manual
- **Dedupe por OT**: como la OT es única por trámite, una fila cuya OT ya existe (gasto no borrado) se omite al importar aunque cambien monto o texto. El preview lo marca ("OT ya cargada") y el resumen cuenta cuántas se omitieron.
- **Aviso de duplicado manual**: el preview avisa cuando una fila se parece a un gasto cargado a mano del mismo cliente (glosa similar) aunque difiera el monto — el caso CAVOR. No bloquea: lo revisas tú antes de importar.

## 2026-06-17 — Carga masiva desde Notaría: modal solo-notaría
- El botón Carga masiva de Notaría ahora abre un modal enfocado ("Carga masiva · Notaría"): sin toggle Gastos/Fondos, sin plantilla genérica, solo el modelo de notaría, dropzone grande e importaciones recientes plegadas tras un link. Si no hay columna Categoría, las filas caen como Notaría por defecto. El modal general (con toggle/plantilla) sigue disponible si se invoca sin el flag notaría.

## 2026-06-17 — OT de notaría visible en tarjeta y edición
- La OT (`ot_number`) se guardaba pero no se mostraba en la tarjeta del gasto ni en el modal de Editar. Ahora aparece como pill azul `OT-XXXX` en las tarjetas (lista de Gastos y ficha del cliente) y como campo editable "OT (notaría)" en el modal de Editar (cuando la categoría es Notaría). El flujo a la rendición/liquidación ya la usaba.

## 2026-06-17 — Fix: glosa IA se cortaba en cargas grandes
- Al pasar TODAS las filas por la IA, los lotes de 50 con `max_tokens:4000` truncaban la respuesta JSON → el lote completo se descartaba y la glosa quedaba en crudo. Ahora lotes de 20 + `max_tokens:8000`, y si una respuesta llega cortada se recuperan los objetos completos en vez de perder el lote.

## 2026-06-17 — Carga masiva Notaría: glosa IA en todas + gastos personales
- **Glosa uniforme**: la carga masiva ahora pasa TODAS las filas por la IA para componer/limpiar la glosa (Concepto + Subconcepto, tildes, mayúsculas, abreviaturas legales), no solo las que no calzaron por cliente. El match de cliente se aplica solo a las filas aún sin asignar.
- **Gasto personal de un miembro**: en la columna Cliente, "Personal · Martín" (o ":") enruta el gasto a `personal_de` (no a un cliente), con `paid_by_client=false`; cae directo como "Personal · [persona]" sin marcado manual. Documentado en la plantilla modelo.

## 2026-06-17 — Auditoría: fixes de código + uniformidad de razón social
- **Saldo del cliente con fuente única**: la ficha ahora calcula fondos/gastos/saldo con `fgCliente` (mismo criterio que la lista de Gastos y el Dashboard); antes usaba un filtro distinto que podía divergir.
- **Razón social en Title Case al mostrar** (`titleCaseRS`): la RS del SII deja de gritar en MAYÚSCULAS en la app (ficha, listas, ventas, facturación, conciliación, Gastos); respeta SpA/Ltda/S.A. y conectores. El dato crudo del SII NO se toca.
- **Uniformidad de paleta**: el nombre del cliente siempre en grafito (no azul); la RS subtítulo en AZUL2 (`C.muted`), peso 400 (se quitaron colores hardcodeados off-paleta).
- **Gastos landing**: mensaje de vacío correcto en vista Archivados; el acceso "Sin cliente" se muestra siempre.
- **Anti-duplicado de facturas**: al ingresar PDFs, el chequeo de folio existente normaliza "318" / "Factura 318" (evita la duplicación que generó 21 facturas dobles).

## 2026-06-17 — Gastos: Historial de rendiciones como ícono en el encabezado
- El "Historial de rendiciones" dejó de ser un bloque colapsable al pie de la lista. Ahora es un **ícono (reloj) en el encabezado**; al tocarlo abre el historial como panel (con ← para volver), dejando el landing 100% enfocado en encontrar clientes. Mismos filtros (cliente/desde/hasta) y acciones de cada rendición.

## 2026-06-17 — Gastos: landing con tarjetas-filtro y lista densa (encontrar cliente rápido)
- La lista de la pestaña Gastos deja de ser un scroll plano de tarjetas grandes. Arriba van dos **tarjetas-filtro divididas** — **Saldo negativo** (monto | nº clientes) y **Saldo a favor** —; tocas una y la lista filtra (la activa con borde de color), **default Saldo negativo**. "Todos" (a la derecha del buscador) limpia el filtro.
- **Filas densas** (iniciales + nombre + razón social + saldo), orden alfabético.
- **Buscador difuso**: encuentra por nombre, RUT o razón social (antes solo nombre); al buscar se ignora el filtro de tarjeta para no esconder coincidencias.
- "Sin cliente" y "Archivados" como accesos compactos al pie; "Gastos notariales" se mantiene como pill en el encabezado. El detalle por cliente y el flujo de rendición no cambian.

## 2026-06-17 — Ficha del cliente: todo clickeable (mobile y desktop)
- El tab Resumen dejó de ser plano: cada cobro pendiente abre la factura, cada gasto/fondo abre su registro, cada tarea abre la tarea, y cada razón social va al tab Contacto. Los KPIs (Vendido/Por cobrar/Cobrado) saltan a Financiero.
- **Ventas agrupadas por estado**: dos grupos en acordeón colapsado — "Activas" y "Terminadas" (cada uno con conteo y UF total), ordenados de la más antigua a la más nueva. Tocar una venta la despliega y muestra sus facturas (pagadas y pendientes), cada una clickeable para abrirla; enlace "Editar venta" dentro. Resuelve que una venta Terminada lleve a sus facturas, no al formulario de edición. Monto en UF o CLP según la venta.
- **Cobros pendientes en acordeón por razón social**: colapsado por defecto (se ve RS + conteo + monto), se despliega al tocar.
- **Razones sociales facturadas** también en acordeón colapsado (con conteo); cada RS lleva al tab Contacto.
- Affordance visual: chevron `›` que rota al expandir, fondo tenue + chevron más oscuro al hover/tocar, cursor pointer, alto de toque cómodo en iPhone. Gastos/Fondos y Tareas quedan en secciones separadas. Reusa los modales existentes (sale/billing/task/expenseEdit), sin tocar lógica de datos.
- **Vista limited** (Martín/Martina/Rodrigo) emparejada en lo que les corresponde: gastos/fondos y tareas ahora clickeables (abren su registro) y razones sociales en acordeón. Aplica a todos los clientes (es un componente único por rol).

## 2026-06-16 — Cuotas: no se crean programadas por cobros ya pagados
- Al guardar/editar una venta con cobro por cuotas, ya no se genera una factura Programada por un monto que ya está cubierto por facturas pagadas de esa misma venta (la programada es para un cobro futuro; si ya hay pagada, ese cobro ya ocurrió). Evita programadas fantasma que inflaban el "por cobrar" (caso ventas de regularización ya cobradas).

## 2026-06-16 — Ventas en pesos: se congela la UF del día (cifras 100% históricas)
- Al crear una venta/propuesta en pesos (CLP), ahora se guarda la UF del día (`uf_value`), igual que en las ventas en UF. Antes quedaba en null y su equivalente en UF fluctuaba con la UF de hoy.
- `ventaUF` usa esa UF histórica para las ventas en pesos (la UF de hoy queda solo como respaldo). Resultado: el monto en UF de toda venta queda congelado a su fecha y no se actualiza nunca → cero fluctuación, cero descalce Ventas↔Dashboard.

## 2026-06-16 — Dashboard: el "vendido" en UF ahora cuadra con Ventas
- En modo UF, el Dashboard mostraba el total en pesos reconvertido con la UF de hoy (7.554), mientras Ventas suma los UF nominales (7.615) — los ~61 UF de diferencia eran puro arrastre de conversión.
- Ahora el bruto/neto/vendido del Dashboard en modo UF usa los **UF nominales** (suma directa de los montos en UF, misma fuente que Ventas y que la meta). Las dos vistas cuadran. En modo CLP no cambia nada.

## 2026-06-16 — Rendiciones: editar en sitio (sin anular)
- Botón "Editar" en cada rendición (historial de Gastos y ficha del cliente): reabre el modal con sus gastos pre-marcados.
- Puedes agregar/quitar gastos, cambiar dirigido a / proyecto / subproyecto / OT / razón social y guardar — actualiza la MISMA rendición (mismo número y fecha), no la anula ni crea otra.
- Si cambias el total y hay un cobro de reembolso vinculado, se ajusta su monto solo. Si no cambias nada, queda idéntica.
- Los gastos que ya están en la rendición siempre se muestran (el filtro de proyecto/fecha solo acota los candidatos a agregar).

## 2026-06-16 — Ventas: lista agrupada en tiles (Abogado / Área), adiós al scroll infinito
- La lista plana de ~44 ventas pasa a **tiles agrupadas** (2 por fila) con **subtotal UF + conteo** por grupo. De un vistazo ves todos los grupos sin scroll; tocas una tile y abajo aparecen sus ventas.
- **Agrupar por** alternable: `[Abogado | Área]`. Cada tile lleva el color de la persona; "Sin abogado" se resalta con etiqueta "asignar".
- La **búsqueda** muestra resultados planos (sin agrupar) para ir directo.
- Las filas siguen siendo tappables → ficha de la venta. Respeta los filtros de estado/año.

## 2026-06-16 — Ventas: encabezado "Vendido del año" que cuadra con el Dashboard
- Nuevo encabezado: **Vendido {año}** (grande, UF) a la izquierda = Activas + Terminadas, el mismo universo que usa el Dashboard (antes el total mostraba solo el filtro de estado, por defecto Activas → descalce con el Dashboard).
- Al costado derecho, desglose en chips tintados: **Activas** (verde) y **Terminadas** (gris), con su monto y conteo — así el total es auditable (Total = Activas + Terminadas).
- Cifras en **UF por defecto**; tocar la tarjeta alterna todo a **CLP** y de vuelta.
- Refleja el **año seleccionado** (independiente del filtro de estado de la lista de abajo).

## 2026-06-16 — Rendiciones: anular deja rastro + reembolso consistente + historial clickeable
- "Reabrir" pasa a ser "Anular": la rendición ya NO se borra — queda registrada como **Anulada** (con quién y cuándo) y su **PDF se congela** para auditoría. Los gastos vuelven a estar disponibles para rendir.
- La anulación ahora se refleja en **todas las áreas**, incluido el **cobro de reembolso** (pasa a Anulada). Antes, al anular gasto por gasto, el reembolso quedaba huérfano cobrable — corregido en todas las vías.
- Historial de rendiciones en la **ficha del cliente** ahora es **clickeable**: tocar abre el PDF; pill "Anulada" atenuada; "Ver PDF" explícito; sin "Enviar" en las anuladas.
- Las anuladas no cuentan para el correlativo de la siguiente rendición.

## 2026-06-16 — Rendir fondos: el filtro de proyecto ya no esconde gastos
- El proyecto se auto-selecciona solo cuando hay gastos con ese tag; si los gastos no traen proyecto, queda en "Todos" (antes caía en el título de una venta y ocultaba todos los gastos disponibles → "no hay gastos para rendir" falso).
- Cuando un filtro (proyecto o fechas) deja la lista vacía pero sí hay gastos pendientes, se muestra el aviso y un botón "Ver todos los proyectos" para limpiarlo de un toque.

## 2026-06-15 — Facturación: header limpio (una sola barra)
- Se redujo el header de 3 filas de pills a una sola barra: ← (volver al resumen), toggle Por cliente / Todas, año en dropdown, buscar (ícono) y menú ⋯ con Resumen / Proveedores / Anticipos / Sin año. Las 4 KPI cards quedan como filtro de estado. Mucho menos ruido visual.


## 2026-06-15 — Facturación: vistas de estado coherentes (todo al acordeón Por cliente)
- Las KPI cards (Por cobrar/Programado/Vencido/Cobrado) y las tabs de estado del Resumen ya no abren la lista vieja agrupada por cliente: llevan al MISMO acordeón Por cliente filtrado por ese estado. Se quitó la franja redundante dentro de Por cliente (las KPI cards de arriba ya la cubren). El botón ↓ Programadas se mantiene cuando se ve el estado Programadas.


## 2026-06-15 — Conciliación: panel programada vs emitida + marca reemplazada (Etapa 5)
- El caso programada ↔ emitida ahora se muestra como panel de columnas paralelas (Programada / Emitida Factura N°) con UF de cada una, la diferencia explicada (solo por la UF del día) y el razonamiento. Botones Aprobar · reemplazar y No es match.
- Al aprobar, la programada se MARCA como reemplazada por la emitida (replaced_by_id) y se retira de las vistas, en vez de un borrado ciego; reversible. Nunca al revés.


## 2026-06-15 — Ficha → Financiero: tira de 4 KPIs + capa de RS (Etapa 4)
- La Ficha financiera del cliente muestra arriba la tira de 4 KPIs (Por cobrar / Vencido / Programado año / Cobrado año), scrolleable, coherente con el landing.
- Clientes con 2+ razones sociales: la jerarquía pasa a Año → RS → Proyecto (los proyectos se agrupan por su razón social; los sin RS van a Sin razón social). Con 1 RS la capa es transparente.


## 2026-06-15 — Facturación: vista Todas por estado (Etapa 3)
- La vista Todas ahora agrupa las facturas por estado (Vencidas → Emitidas → Programadas → Pagadas → Anuladas) con subtotal+conteo por grupo (colapsables, Pagadas/Anuladas cerradas), no por cliente. Cada fila: cliente + RS, Factura N°/concepto, monto (UF del día en programadas), estado, y Pagar / ⚠ Conciliar; tocar abre el detalle. Filtros multi-select de estado + Limpiar, año global y buscador.


## 2026-06-15 — Facturación Por cliente: capa de RS + subtotales por grupo (Etapa 2)
- Cada grupo de estado (Vencidas/Emitidas/Programadas/Pagadas/Anuladas) muestra subtotal + conteo en su encabezado, y es colapsable; Pagadas y Anuladas vienen colapsadas por defecto.
- Clientes con 2+ razones sociales: se agrupan por RS (con su subtotal pendiente), y dentro de cada RS van los grupos por estado; facturas sin RS van a Sin razón social. Con 1 RS la capa es transparente. La fila del cliente muestra la RS/RUT (o N razones sociales).


## 2026-06-15 — Facturación: año global sincronizado
- El filtro de año es único y persistente en toda Facturación (resumen + interiores comparten el mismo año, guardado en localStorage). La Ficha → Financiero lo lee al entrar y lo escribe al cambiarlo, así el año se mantiene al ir y volver entre Facturación y la Ficha del cliente.


## 2026-06-15 — Facturación → Ficha del cliente en un clic
- En la vista Por cliente, cada cliente tiene Ficha → que abre directamente su Ficha → Financiero (cambia de pestaña y entra al cliente en Financiero). Detalle de proyectos/8-12 vive en la Ficha; Facturación enlaza ahí.


## 2026-06-15 — Resumen Facturación: año en Cobradas/Programadas, volver, Anticipos/Proveedores, sin Checklist
- Cobradas y Programadas ahora se distinguen por año (toggle Total / 2026 / 2025…); Por cobrar y Vencidas siguen siendo el total pendiente actual, con nota aclaratoria.
- Botón Volver al resumen visible al entrar a cualquier estado.
- Anticipos y Proveedores como botones prominentes en el Resumen. Checklist eliminado de la vista.


## 2026-06-15 — Facturación Por cliente: pill ⚠ Conciliar (Etapa 4)
- En la vista Por cliente, las facturas programadas con posible emitida equivalente (mismo cliente, monto ±15%, mes ±1) muestran pill ⚠ Conciliar; el encabezado del cliente muestra ⚠ N conciliar. Al tocar, abre el asistente de conciliación de ese cliente (cruce por prioridad + razonamiento + compuerta humana). Cierra el rediseño de la pestaña Facturación.


## 2026-06-15 — Facturación Por cliente: filtros por estado + franja accionable (Etapa 3)
- Vista Por cliente: franja Por cobrar / Vencido (tocar filtra), chips multi-select por estado (Programadas/Emitidas/Vencidas/Pagadas/Anuladas) que reducen lo que se muestra en el acordeón, y botón Limpiar. Los clientes sin facturas del estado filtrado se ocultan.


## 2026-06-15 — Facturación: UF en vivo en programadas + confirmación al emitir (Etapa 2)
- Las facturas programadas en UF muestran su equivalente en CLP recalculado al valor UF del día (solo display, no toca la DB; la UF pactada no cambia). La fila muestra X UF y el CLP al día.
- Al emitir una programada (Ya emitida / Confirmar emitida), confirmación explícita con el monto en UF y su equivalente en CLP al día antes de generar la Factura N°.


## 2026-06-15 — Facturación: vista Por cliente (acordeón) [Etapa 1]
- Nueva vista Por cliente: una fila por cliente (colapsada) con mini-resumen de estados (N prog/emit/venc/pag), monto pendiente y próxima a emitir. Al expandir, las facturas se agrupan por estado en orden Vencidas → Emitidas pendientes → Programadas → Pagadas → Anuladas, ordenadas dentro de cada grupo. Vencida DERIVADA automáticamente (emitida pendiente con vencimiento o emisión+30 días pasado). Pagar rápido en fila. Accesible desde el chip Por cliente y el botón del Resumen. Factura N° nunca abreviado.


## 2026-06-15 — Facturación global: landing Resumen + aging + FAB (Etapa A)
- La pestaña Facturación abre por defecto en un Resumen: 2 KPIs (Por cobrar / Vencido), tabla de aging (Por vencer / 1–30 / 31–60 / 61–90 / 90+), accesos por estado (Por cobrar, Vencidas, Cobradas, Programadas) y enlaces a Anticipos/Proveedores/Checklist/Sin año. Chip Resumen para volver. Botón flotante (FAB) para nueva factura. Toda la lógica existente (anticipos, terceros, SII, export, pago) intacta.


## 2026-06-15 — Conciliación: toggle Histórico/Mes + pago parcial
- Conciliación: toggle Histórico / Mes corriente (mes filtra emitidas por emisión y programadas por vencimiento del mes en curso).
- Pago parcial: el botón Pagar pregunta el monto recibido; si es menor al saldo queda como abono (paid_amount) y la factura sigue pendiente, mostrando abonado  en la fila. Requiere la columna billing.paid_amount.


## 2026-06-15 — Cockpit Parte 2b: Recordar cobro + barra de progreso
- Botón Recordar en facturas pendientes/vencidas: envía un correo de recordatorio al cliente (desde la cuenta de oficina) con el detalle de la Factura N°, monto y vencimiento (con confirmación). Si el cliente no tiene correo, avisa.
- Barra de progreso en el encabezado de cada proyecto (cobrado/facturado).


## 2026-06-15 — Asignar factura: solo a ventas del mismo año de emisión
- El + Asignar a proyecto del cockpit solo ofrece ventas del MISMO año de emisión de la factura (no se cruzan años); si no hay venta de ese año, lo avisa. La sugerencia ✦ también respeta el año.


## 2026-06-15 — Conciliación v2: cruce por prioridad + razonamiento
- En Sin proyecto, la IA ya no cruza solo por glosa: prioriza modalidad y N° de cuotas de la venta › monto vs cuota esperada › glosa, y muestra el RAZONAMIENTO explícito (Porque: …). El sugerir con Opus también recibe modalidad/cuotas/total de cada venta. Descuadre programada↔real muestra Factura N° de la real.


## 2026-06-15 — Cockpit: Facturación histórica solo ≤2025 + Pagar rápido
- El contenedor Facturación AAAA (emitidas sin proyecto) ahora SOLO existe para 2025 hacia atrás. En 2026+ toda factura debe tener venta/propuesta: si no la tiene, cae en Facturas sin proyecto asignado para forzar la asignación.
- Botón Pagar en la fila de facturas pendientes/vencidas (marca pagada con fecha de hoy, con confirmación), sin entrar a editar.


## 2026-06-15 — Cockpit v2: Año → Proyecto → Factura (Parte 1)
- La pestaña Financiero del cliente se reorganizó en jerarquía: franja Por cobrar/Vencido arriba, tabs por AÑO, y dentro cada PROYECTO (=venta) como acordeón con resumen (Facturado/Cobrado/Pendiente + cuotas cobradas), auto-expandiendo los que tienen vencido. Las facturas se ordenan por estado (pendientes/vencidas, programadas, pagadas). Contenedor virtual Facturación AAAA para emitidas del año sin proyecto, y sección Facturas sin proyecto asignado con + Asignar a proyecto (sugerencia ✦). Folios siempre Factura N° XX. Tocar una factura abre el editor.


## 2026-06-15 — Conciliación: al deduplicar, conserva la Factura N° real
- Al resolver duplicados de emitidas, SIEMPRE se conserva la que tiene número (Factura N° XX = la factura real), nunca al azar; la tarjeta muestra explícitamente cuál conserva y cuáles elimina.


## 2026-06-15 — Abogado en lista Clientes (admin) + fusión Freddy Bravo
- Lista de Clientes (admin): el abogado responsable ahora va como pill en la LÍNEA DEL NOMBRE, justificado a la derecha (antes estaba en la línea financiera).
- Cliente duplicado Freddy Bravo (creado por error, sin registros) archivado; Bravo Silva conserva toda la información.


## 2026-06-15 — Conciliación unificada (global + por cliente) con IA
- Una sola interfaz Conciliar: desde el menú admin (todos los clientes) y desde el cockpit de cada cliente. Absorbe la conciliación vieja (Pagadas sin folio que son copia de una real → dar de baja / no es duplicado, respeta lo aprendido) y suma: duplicados exactos, sin proyecto por serie y programada↔real. En sin-proyecto, si no hay match claro, botón Sugerir con IA (Opus) propone la venta. Todo con compuerta humana y deshacer.


## 2026-06-15 — Asistente de conciliación de facturas (Fase 2, por cliente)
- Botón Conciliar en el cockpit del cliente: (1) DUPLICADOS exactos (mismo monto+vencimiento o mismo folio repetido salvo prefijo Factura) → conservar 1 y eliminar resto (con deshacer, normaliza folio); (2) SIN PROYECTO agrupadas por SERIE con venta sugerida (✦) → asignar la serie completa; (3) PROGRAMADA↔REAL por venta+mes+tolerancia → reemplazar (borra la programada). Nada se borra/asigna solo. Convive con la Conciliación global existente (fantasmas Pagado sin folio).


## 2026-06-15 — Cobro: asignar serie completa (no dejar hermanas huérfanas)
- Al asignar una factura a un proyecto (venta), si hay otras de la MISMA serie sin proyecto (ej. cuota 1/3 → 2/3 y 3/3, o las mensuales), la ventana ofrece asignarlas todas de una. Serie = mismo cliente + misma glosa base (sin el N/M, mes ni año). Con deshacer.


## 2026-06-15 — Cobro: campo Proyecto (venta) + sugerencia
- La ventana Editar/Nuevo cobro ahora tiene campo **Proyecto (venta)**: asocia la factura a una venta del cliente (sale_id) para conciliar programadas ↔ pagadas. Sugiere la venta por coincidencia de glosa (✦) y aprende glosa→venta para autocompletar a futuro.


## 2026-06-15 — Facturas: cockpit en la ficha del cliente (Fase 1)
- La pestaña Financiero del cliente ahora es el lugar único para gestionar TODAS sus facturas: KPIs tappables (Por cobrar/Cobrado/Programado/Facturado que filtran), buscador (folio, concepto, mes, monto), y filtros combinables por proyecto (= venta), estado y año. Lista única; cada factura se toca y abre el editor (editar, marcar pagada, anular, eliminar) — los cambios se reflejan en toda la app. La Facturación global se mantiene para SII/carga masiva. (Fase 2: asistente de vinculación en lote con IA y detector de duplicados.)


## 2026-06-15 — Correo: auto-envío desde el servidor si falta permiso
- Rendiciones, liquidaciones de caja chica y de notaría: ahora intentan enviarse desde el **correo del propio usuario** y, si no tiene el permiso de Gmail, se **envían igual automáticamente desde la cuenta de oficina** (servidor SMTP) con el PDF adjunto. Nunca quedan sin enviarse. Solo si el servidor también falla se descarga el PDF para adjuntar a mano. La edge function notify-task ahora acepta envío genérico con adjunto.


## 2026-06-15 — Agendar tarea: siempre funciona (fallback a link)
- El botón **Agregar a Google Calendar** ahora cae a un **link pre-armado de Calendar** (sin permisos) cuando la Calendar API no está autorizada → funciona para todos al instante. Si el permiso está activo, sigue agregando en 1 clic silencioso.


## 2026-06-15 — Editar gasto: reasignar a otro cliente
- Al **tocar un gasto** se abre el editor (ya existía). Ahora incluye campo **Cliente** por búsqueda: cambiarlo **mueve el gasto a otro cliente** y reajusta la razón social. La RS ya era editable. Avisa si el gasto está en una rendición/liquidación (reabrir primero).


## 2026-06-15 — Rendición Notaría, correo Martina, Reabrir, vista clientes limited
- **Rendición al cliente** ahora incluye gastos **sin razón social** (ej. notaría sin RS) aunque elijas una RS específica: ya no quedan fuera. La limitación de Notaría es solo de caja chica.
- **Correo de rendición**: si tu sesión de Google no tiene el permiso de enviar (scope `gmail.send`), ahora **avisa claramente** que cierres sesión y vuelvas a entrar para activarlo (caso Martina). El flujo de envío es idéntico para limited y admin.
- **Reabrir** rendición y liquidación de caja chica: el botón "Anular" pasó a llamarse **Reabrir** con mensaje claro (los gastos vuelven a pendientes para editar/rehacer o dejar anulada). Acceso rápido para todos.
- **Vista de clientes (limited)** rediseñada como la de admin **sin datos financieros**: nombre │ archivar, tipo · RUT, razón social, pill de tareas pendientes y pill del abogado responsable; filtros por estado y búsqueda.

## 2026-06-15 — Notaría: marcar pagado, anulados, acción sobre el cliente
- La acción de notaría ya no usa barra inferior: al seleccionar, se despliega un bloque **sobre el primer cliente** con **Liquidar a notaría** (paga+correo) y **Marcar pagado** (históricos ya pagados, sin correo). Historial distingue "Enviada a notaría" vs "Pagado histórico".
- Gastos de **$1** (anulados, solo orden) salen de pendientes y van a un grupo **"Anulados"** con **Eliminar** (a papelera).
- El botón **archivar** de la lista de Gastos ahora va junto al nombre del cliente, separado por "|".

## 2026-06-15 — Entrada notaría + archivar en Gastos
- En la barra de buscar clientes de Gastos hay una pill **"Gastos notariales"** (ámbar) que **despliega dos pills**: Carga masiva y Liquidar notaría (con el conteo de pendientes). Reemplaza los botones sueltos del header.
- **Botón archivar** en cada cliente de la lista de Gastos (mismo ícono que Clientes): lo marca **Terminado** y sale de la lista; un toggle **"Archivados (N)"** los vuelve a mostrar. Acorta el scroll de clientes antiguos.

## 2026-06-15 — Liquidación de notaría
- Nueva sección **"Notaría"** dentro de Gastos (la preparan los limited, visible para admin): pendientes de pagar a la notaría **agrupados por cliente con su fondo disponible** (Con fondos / Sin fondos · adelantarías) — filtro **"Solo con fondos del cliente"** por defecto + **advertencia** al incluir clientes sin fondos (no operar con plata de la oficina). Gastos **personales** (Cristóbal/Erasmo/Martín/Martina/Rodrigo, `personal_de`) en grupo propio sin chequeo de fondos. **"Liquidar a notaría"** → correo con **OT · concepto · monto** + PDF (Gmail, correo configurable). Marca `notaria_render_id` (ledger independiente). Historial con **deshacer**. (Requiere `expenses.notaria_render_id`, `notaria_liquidado_at`, `personal_de`.)

## 2026-06-15 — Modelo Excel de notaría + OT en rendiciones
- Nuevo botón **"Descargar modelo de notaría (.xlsx)"** en carga masiva: plantilla enfocada en notaría (Concepto · Subconcepto · OT, categoría Notaria precargada, ejemplos con OT-XXXX).
- Al **rendir o liquidar**, la rendición guarda las **OT incluidas** (`rendiciones.ot_numbers`) y se muestran en su detalle (más el OT por gasto) — para cruzar con la notaría qué OT se están pagando. (Requiere columna `rendiciones.ot_numbers`.)

## 2026-06-15 — Notaría: Subconcepto y OT en carga masiva
- La carga masiva acepta **Subconcepto** (detalle que distingue gastos con igual concepto) y **OT** (N° de orden notarial, OT-XXXX). Ambos entran al **dedup** → ya no se marcan como duplicados gastos con el mismo concepto pero distinto subconcepto/OT. La **IA** usa subconcepto/OT/notas para **asignar el cliente** y **compone la glosa** (Concepto + Subconcepto). El **OT se guarda** y aparece en el **detalle de la rendición** al cliente. Plantilla actualizada. (Requiere columnas `expenses.subconcept` y `expenses.ot_number`.)

## 2026-06-15 — Color único por persona
- Cada integrante tiene un **color fijo** usado igual en toda la app (pills y avatares): Cristóbal azul profundo, Erasmo azul, Martín verde, Martina rosa, Rodrigo ámbar. Fuente única (`PERSON_CHIP`); se unificaron los dos mapas que antes no coincidían.

## 2026-06-15 — Abogado responsable visible
- El **abogado responsable** del cliente (`abogado_responsable`) ahora se muestra como **pill** (paleta por persona) en la **lista de clientes** (admin y limited, a la derecha de la línea), en la **ficha del cliente** y en el **preview de carga masiva** (junto al cliente asignado). Ayuda al limited a saber a quién preguntar por una carga.
- Carga masiva: **resumen de abogados** arriba del preview (con conteo por abogado); **tocar un nombre filtra** las filas de ese responsable. El botón de terminar cliente pasó a **ícono de archivar** (restaurar si terminado).

## 2026-06-15 — Asignar razón social por gasto
- La razón social ahora se asigna **dentro de cada gasto** (vista interior del cliente), no en bloque: **pills** de RS si el cliente tiene ≤3 razones sociales, **selector ▾** si tiene más. El gasto ya asignado muestra "RS · [nombre]" con opción **cambiar**. Todo con deshacer. Se quitó el botón en bloque "Asignar razón social (N)" del listado (asignaba todos a la vez).

## 2026-06-15 — Caja chica (admin) + paleta
- El panel "Gestión caja chica" del Dashboard ahora **deriva las personas de `petty_cash`** (incluye a Rodrigo y a quien tenga fondos, no una lista fija); se oculta si nadie tiene caja activa.
- Se reemplazó el **violeta de Martina** (`#534AB7`, fuera de paleta) por un slate corporativo en toda la app (chips de persona y avatares).

## 2026-06-15 — Tarjeta de Tareas en 3 columnas
- Rediseño de la tarjeta de foco: **subtarjeta "vencen esta semana/vencidas"** (con tinte por urgencia) y debajo las personas a quienes asigné; **pills Activas/Que asigné/Terminadas al medio**; **subtarjeta "sugeridas desde Gmail"** a la derecha; divisorias verticales. Todo sigue siendo tappable a su sección.

## 2026-06-15 — Pills del hero de Tareas navegan
- Cada pill del hero ahora es tappable y lleva a su sección (abre y hace scroll): titular y "Activas" → Activas; "Que asigné" y las personas de "Asigné a" → Tareas que asigné; "Terminadas" → Terminadas.

## 2026-06-15 — Hero de Tareas sin redundancia
- Quité el tablero de 4 tiles del hero de Tareas porque repetía el titular y los chips (Vencidas/Esta semana/Activas/Terminadas ya estaban arriba). Queda solo el hero narrativo (titular + chips + "Asigné a" + panel Gmail).

## 2026-06-15 — Hero de Tareas: sugeridas desde Gmail
- El hero de Tareas (admin) muestra las **tareas sugeridas desde Gmail** en un **panel verde a la derecha** de la tarjeta (ocupa menos alto); al tocar se **despliega** la lista a lo ancho y cada una **abre el borrador de tarea** prellenado (o se descarta). El escaneo de no leídos corre 1 vez por sesión (cacheado) reutilizando el mismo motor del scanner "Tareas +Gmail".

## 2026-06-15 — Tareas desde Gmail (IA)
- Nuevo en el menú (admin): **"Tareas +Gmail"** — lee tus correos **no leídos** (asunto + vista previa, nunca el cuerpo completo), la IA detecta acciones/compromisos pendientes y propone **tareas** con cliente y plazo sugeridos. Compuerta humana: **Crear tarea / Editar / Descartar**; lo descartado se aprende y no se vuelve a proponer.

## 2026-06-15 — Velocímetro Bruto/Neto + aviso de caja chica al limited
- El velocímetro "Cómo va el año" ahora tiene un **toggle Bruto / Neto** que destaca claramente cuál se está mostrando (antes solo una etiqueta gris).
- En Tareas, a quien tiene caja chica activa se le muestra un **aviso** cuando lleva **≥10 días sin cargar gastos** y/o cuando su **fondo está bajo (< $50.000)** — "conviene liquidar pronto", con acceso directo a Caja chica.

## 2026-06-15 — Tareas: panel KPI + agregar a calendario
- **Hero de Tareas** arriba de "Mis tareas" (admin y limited): titular de foco (vencidas en rojo / vencen esta semana) + **tablero de 4 KPIs** tocables (Vencidas, Esta semana, Activas, Terminadas del mes) + chips (Activas / Que asigné / Terminadas) y mini-fila **"Asigné a"** por persona. Respeta los filtros de cliente/proyecto.
- **Ícono de calendario** en cada tarjeta de tarea (junto al visto verde): crea el **evento de vencimiento en tu Google Calendar** vía Calendar API (evento de día completo). Requiere activar el scope `calendar.events` en Google + reentrar.

## 2026-06-15 — Liquidación de caja chica = rendición
- Al liquidar y enviar, la liquidación ahora sale por **correo con el PDF adjunto** (vía Gmail API, cuerpo HTML branded con logo + detalle por cliente), igual que la rendición al cliente; destinatario por defecto los admin (editable). Si no hay permiso de Gmail, cae al `mailto` + PDF imprimible.
- **Pill "Liquidado"** en cada gasto del cliente que ya fue a una liquidación de caja chica; al tocarla se abre el detalle de esa liquidación (gastos, cliente, total).

## 2026-06-15 — Tareas: aviso al asignador + correo robusto
- Cuando alguien **delega** o **marca como terminada** una tarea que le asignaste, ahora **te llega un correo** (mismo diseño que el de nueva tarea, con asunto "Tarea delegada" / "Tarea terminada"). Solo se avisa a quien la asignó y si fue otra persona quien actuó.
- Envío de `notify-task` migrado a **denomailer** (SMTP robusto) — antes fallaba en silencio. Botones del correo ahora son **pills más pequeños** y el **logo va centrado**.

## 2026-06-15 — Gmail → contactos: corrección de matching
- **Bug grave corregido:** el escáner asociaba todos los correos `@gmail.com` (y otros proveedores) a un mismo cliente. Ahora los dominios genéricos (gmail/hotmail/outlook/yahoo/icloud/live…) **nunca** asocian por dominio, ni en el mapa de contactos existentes, ni en lo aprendido, ni en la IA (más estricta: ante duda, sin asignar). Se borran las reglas de dominio genérico mal aprendidas al abrir el modal.
- Nuevo botón **"Cambiar"** en los contactos ya asociados a un cliente: permite reasignar a otro cliente o moverlo a "Por asignar" (antes solo Agregar/Descartar).

## 2026-06-15 — Correo de nueva tarea: nuevo diseño
- Rediseño del email de `notify-task`: **logo de la firma** en el header (URL pública `/le-logo-blanco.png`), saludo "Hola {nombre}," + subtítulo "{asignador} te acaba de asignar una tarea", **bloque de tarea** (título, nota citada si existe, Cliente, Proyecto, Vence con **pill roja si vence en ≤2 días**), botones **"Ver en la app"** y **"Agregar recordatorio"** (Google Calendar pre-armado). Asunto dinámico "Nueva tarea | {cliente} | {título}". CSS inline, ancho 560px, Arial. (Íconos de fila omitidos: Gmail elimina SVG inline y no se usan emojis; se pueden añadir como PNG hosteados si se requieren.)

## 2026-06-15 — Caja chica: carga masiva no la afecta
- **Corrección:** la carga masiva ya no asigna los gastos importados a la caja chica de quien importa (`created_by` queda en null; el importador se registra en `bulk_imports`). La pertenencia a caja chica es derivada de `created_by` (+ `!paid_by_client`); no se tocó la regla de carga manual ni la rendición al cliente.
- **Pill de clasificación** en cada gasto importado (Gastos): el admin lo asigna a la **caja chica de una persona** o lo marca **pagado con fondos del cliente** (con deshacer). Badge sutil **"Carga masiva"** para distinguir de los manuales.

## 2026-06-15 — Ingresos del año por año de venta
- Nueva tarjeta en el **Dashboard** (tras Cash flow): **"Cobrado [año] · por año de venta"** — separa lo cobrado este año según el año de la venta de origen (2026 / 2025 / 2024 y anteriores), con barra y desglose. Lo que no tiene año cae en **"Sin año asignado"** (ámbar, tappable → Facturación).
- Nueva cola **"Sin año"** en Facturación: facturas pagadas sin año de venta resuelto; **Asociar venta** (enlaza `sale_id`, el año deriva de `sales.year`) o **elegir el año** directo. **Aprende cliente→año** (sugerencia ✦) y no vuelve a preguntar. Requiere columna `billing.sale_year`.

## 2026-06-15 — Caja chica: asistente IA de liquidación
- Botón **"Asistente IA"** en PENDIENTES. Revisa tus gastos sin liquidar y los separa en **Listos** (sin problemas) y **A revisar**. Detección **determinista** (sin cliente, sin categoría, posible duplicado por mismo monto+fecha+glosa parecida). La **IA solo sugiere** cliente/categoría faltantes; cada sugerencia que aceptas se guarda (glosa→cliente, glosa→categoría) y no vuelve a preguntar (✦ = aprendido). "Seleccionar listos" deja la selección hecha para liquidar. Nada se liquida solo.

## 2026-06-15 — Rendición: comprobantes de respaldo en el PDF
- El PDF de rendición ahora marca cada gasto que tiene **comprobante de respaldo** (chip "✓ respaldo") y al pie indica "N de M con comprobante de respaldo (disponibles a solicitud)". Se lee de `expense_attachments`. Aplica en el modal de rendición, en "Ver PDF" del correo y en el historial.

## 2026-06-15 — Contactos: principal/secundario + Red profesional
- Ficha de cliente: **estrella** por contacto para marcar **principal** (toggle, principales arriba; badge "Principal").
- Nuevo en el menú (admin): **Red profesional** — base de contactos de red (no clientes) con nombre, email, país, **categoría libre** (las armas tú; los chips de filtro se generan solos por uso), web, LinkedIn, descripción y "conocido en" (origen). Buscador + filtro por país + chips por categoría, agrupada por país. Paleta corporativa.
- Escáner Gmail: 3ª acción **"→ Red"** por contacto (lo guarda en Red profesional con la web inferida del dominio; país/categoría se completan en la vista).

# Changelog

## 2026-06-15 — Dashboard: panel "Qué atender hoy" (IA)
- Nuevo bloque bajo "Cómo va el año": junta lo urgente de todas las áreas y lo prioriza por severidad — facturas vencidas, tareas vencidas, por cobrar de la semana, caja chica sin liquidar, clientes sin fondos, rendiciones por hacer, propuestas tardías. Cada fila es tappable y navega a su sección. Incluye **headline determinista** + botón **"Resumen IA"** (Opus redacta el foco del día sobre cifras ya calculadas). Estado "Todo al día" cuando no hay pendientes.

# Changelog

## 2026-06-15 — Dashboard: KPI unico "Cómo va el año" (velocímetro + desglose)
- Se fusionaron los dos bloques (Revenue target + Resultado del año) en UNO solo. Izquierda: **velocímetro de meta** con degradé azul (claro→oscuro según avance) + Vendido / Meta + faltan + N° ventas. Derecha: **Desglose financiero** con pills **Neto / Facturado / Cobrado** (barra proporcional a lo vendido) + alerta fija **"por cobrar · aging"**. Conserva selector de año, UF/CLP, "Ventas del año" y "Años anteriores". Tocables navegan a Ventas/Facturación.

# Changelog

## 2026-06-15 — IA: revisar Gmail → contactos de clientes
- Nuevo en el menú (admin): **"Revisar Gmail (contactos)"**. Lee el Gmail corporativo (scope `gmail.readonly`), extrae los participantes externos de los últimos 12 meses, los **asocia a clientes** (dominio conocido → directo; ambiguos → IA Opus que infiere cliente y cargo) y propone agregarlos a la ficha. **Compuerta humana**: Agregar / Descartar / reasignar cliente. Revisiones **parciales** ("Revisar nuevos" desde la última). Privacidad: a la IA solo van encabezados (De/Para/CC/Asunto), nunca el cuerpo. Descartados se recuerdan en `learnings` (sin re-proponer); la ficha ya tenía los campos de contacto (nombre/cargo/email/teléfono).

## 2026-06-15 — Rendición: el proyecto viene de la venta/propuesta
- El selector de Proyecto de la rendición ahora ofrece los **proyectos de las ventas/propuestas del cliente** (venta = proyecto), no solo los escritos en gastos. Se combinan con los de gastos (con su conteo) y se sugiere el correcto. Un gasto pertenece al proyecto si tiene esa glosa **o** está vinculado a la venta (sale_id).

## 2026-06-15 — Encabezados: nombre cliente + razón social | rut (dropdown si varias)
- Formato en los encabezados: **nombre del cliente** arriba y **razón social | rut** debajo. Si el cliente tiene **más de una razón social**, en Conciliar facturas se despliega un **selector** para escoger. Aplicado en Conciliación, Facturación, ficha de cliente, lista de clientes y Ventas (RS según el entity_id de la venta). Tareas/Caja chica mantienen el nombre.
- Conciliación: el **RUT y la razón social también pesan en el match** (misma RS / mismo RUT / mismo receptor suma certeza; nueva fila comparable "razón social"). Folio limpio (evita "Factura Factura 261").

## 2026-06-15 — Conciliar facturas: tarjetas filtran + no cierra al tocar fuera
- Las tarjetas del resumen (Analizadas / Con match / A revisar / Conciliadas) ahora son **tappeables**: filtran la lista a esa categoría (resaltadas al activar). Encabezado más compacto (texto en 1 línea, tarjetas más densas).
- El modal **ya no se cierra al tocar fuera** (autosafe): no se pierde lo avanzado.

## 2026-06-15 — Conciliar facturas: resumen de totales + contexto por cliente
- **Resumen arriba** con totales: Analizadas · Con match · A revisar · Conciliadas · Aprendidas (legítimas marcadas).
- **Aprende del proceso**: cada baja confirmada deja un registro auditable (`learnings` kind `conciliacion_dup`); las marcadas legítimas siguen sin re-mostrarse.
- **"Otras cuotas del cliente"**: el contexto ahora muestra todas las cuotas del mismo cliente (no solo de la venta), marcando las de igual monto — para detectar duplicados en otras ventas o futuras.

## 2026-06-15 — Conciliar facturas: rediseño comparable
- Cada cuota sospechosa (Pagado sin folio) se muestra como **comparación lado a lado** Fantasma ↔ Factura real, con tabla campo-a-campo (glosa, monto, fecha pago, proyecto), **punto de coincidencia** por fila (verde/ámbar) y **veredicto de certeza** (% + "Muy probable / Probable / Posible / Poco probable").
- **Glosas con diff**: se resaltan en negrita azul las palabras en común entre ambas; **delta de monto** cuando son casi iguales (ej. +$15).
- **Elegir otra factura**: desplegable con las facturas reales del cliente ordenadas por score para cambiar la candidata.
- **Otras cuotas de la venta**: desplegable que muestra las demás cuotas del proyecto (pagadas o programadas futuras), marcando las de igual monto.
- **Ya resueltas**: lista plegable de lo dado de baja / marcado legítimo en la sesión, con **deshacer** (restaura de Papelera o quita el aprendizaje).

## 2026-06-15 — Proyecto = venta en todos lados, buscador en Ventas, propuesta editable
- **Buscador en Ventas**: pill de búsqueda al lado de "Nueva venta / Nueva propuesta" que filtra por título de venta o nombre de cliente (ignora el filtro de estado mientras buscas).
- **Propuestas/Borradores editables**: una venta en estado Propuesta o Borrador ahora se edita con el formulario completo (honorarios, costos, forma de cobro incl. cuotas mensuales/cuota distinta, notas), no solo "condiciones registradas". Al guardar se regeneran sus cuotas programadas (todas sin emitir → reemplazo seguro).
- **Gasto: razón social + proyecto editables**: al editar un gasto se puede asignar/cambiar la razón social y el **proyecto** (sugiere las ventas del cliente). Con una sola RS, se asigna sola por defecto.
- **Venta = proyecto (aprende)**: al guardar un gasto cuyo proyecto coincide con el título de una venta del cliente, se vincula automáticamente a esa venta (sale_id). La app aprende la estructura proyecto↔venta para reportes y rendiciones.

## 2026-06-15 — Cobro: cuota distinta (switch) + editar cuotas guardadas + correo HTML
- **Cuota distinta**: en "Cuotas mensuales" un switch "Una cuota distinta" permite fijar el monto recurrente (ej. 55 UF) y una cuota distinta inicial o final (ej. 60 UF); la app deriva el N° de cuotas para cuadrar el total exacto y muestra el desglose ("9 cuotas · 1 de UF 60 + 8 de UF 55"). Antes había que cargarlas una a una en Personalizada.
- **Editar cuotas guardadas**: en una venta guardada, "Condiciones registradas → Cuotas programadas" lista las cuotas pendientes con fecha y monto editables; se ajusta una sola fecha/monto sin rehacer la forma de cobro. No toca las emitidas/pagadas.
- **Correo de rendición con diseño HTML** (barra de marca, datos de cuenta en caja) en lugar de texto plano; envío automático con PDF adjunto vía Gmail API (scope gmail.send activado).

## 2026-06-15 — Rendicion: se asocia a razon social y proyecto/subproyecto
- La rendicion ahora se asocia a una **razon social** (si el cliente tiene 1, queda fija; si tiene varias, el emisor la elige y los gastos se acotan a esa RS) y a un **proyecto** (filtra los gastos de la RS) + **subproyecto** opcional. Se guardan en la rendicion (entity_id/project/subproject).
- **Proyecto sugerido por IA-lite**: el modal sugiere el proyecto con mas gastos pendientes (boton "Sugerido: X"); el selector muestra el conteo de gastos por proyecto.
- El proyecto/subproyecto aparecen en el **PDF** (barra bajo el encabezado), en el **correo** (cuerpo determinista y prompt de la IA) y en el adjunto.

## 2026-06-15 — Rendicion: IA mejora las descripciones de los gastos
- Nuevo boton "Mejorar descripciones con IA" en el modal de rendicion: Opus profesionaliza las descripciones de los gastos seleccionados (expande abreviaciones legales EP/CV/CBR..., corrige tildes y ortografia) y las guarda. El cliente ve descripciones claras en el PDF.

## 2026-06-15 — Rendicion: correlativo al enviar + correo redactado con IA
- El **correlativo se graba al CONFIRMAR el envio** (no al generar). Al generar se muestra el N° tentativo ("Sera la N° X, se confirma al enviar"); las rendiciones no enviadas no consumen numero. El contexto del modal cuenta solo las ENVIADAS.
- **Correo con IA**: nuevo boton "Redactar con IA" en el modal de envio. La IA redacta el correo (saludo por genero, tono, segun saldo) pero las CIFRAS y los DATOS DE CUENTA van fijos (se le pasan y se le prohibe cambiarlos). El mensaje es editable; fallback a la version determinista. Resumen del PDF en un desplegable.

## 2026-06-15 — Rendiciones: correlativo por cliente + continuidad (transparencia)
- Cada rendicion al cliente lleva ahora un **correlativo por cliente** (N°1, N°2... guardado, sobrevive a anulaciones). Aparece en el asunto del correo, el encabezado del PDF y el historial.
- **Continuidad**: el modal de rendicion muestra antes de generar el N° que tendra, cuantas rendiciones anteriores hay y el saldo actual del fondo. El correo menciona el N°. El recuadro "Resumen del fondo" del PDF sigue mostrando las rendiciones previas del mismo fondo.

## 2026-06-15 — PDF de rendicion rediseniado (Ejecutiva A)
- El PDF de rendicion ahora lleva arriba las 3 cifras clave: Fondos recibidos, Gastos del periodo y Saldo (destacado, verde a favor / rojo pendiente), luego el detalle con badges de categoria. Aplicado al "Ver PDF" (HTML rico), al adjunto del correo (jsPDF) y al "Ver PDF" del correo. El recuadro ledger "Resumen del fondo" solo aparece si hay rendiciones previas (evita duplicar el saldo).

## 2026-06-15 — Rendicion al cliente: correo breve + logica de saldo (el PDF es el detalle)
- El correo de rendicion ahora es BREVE: apunta al PDF adjunto (donde esta el detalle) en vez de listar todo. Cierre segun saldo del fondo: si falta fondos, pide transferir a la cuenta de Liberona Escala (BICE 138392-2); si hay saldo a favor y el trabajo termino, pide los datos de cuenta del cliente para devolverlo; si hay saldo a favor y siguen proyectos, indica que queda disponible para los proximos trabajos. Trato: "Estimado [nombre]" a personas.
- Se quito el informe verboso con IA (estado de cuenta): el diferenciador es la rendicion con su diseno en PDF + el correo breve.

## 2026-06-15 — Estado de cuenta del cliente con IA (transparencia)
- En la ficha del cliente, nuevo boton "Estado": muestra fondos, gastos por concepto, saldo y facturas por pagar (cifras deterministas, auditables) y un boton "Generar con IA" que redacta un estado de cuenta claro y transparente (Opus) para compartir con el cliente. Distinto del reporte interno: este es por cliente, en lenguaje simple. Cada generacion se registra (usage_events).

## 2026-06-15 — Conciliación de facturas (v1): motor + barrido de auditoría + aprendizaje
- Nuevo "Conciliar facturas" (menú admin): detecta cuotas marcadas Pagado SIN N° de factura (suelen duplicar una factura real, tipo BM Soluciones). Agrupa por cliente, sugiere la factura real que calza (cruce por venta/glosa), y deja darlas de baja (a Papelera, reversible) o marcarlas legitimas.
- Capa de conocimiento: cada decision se guarda (learnings) y cada accion se registra (usage_events). "No es duplicado" enseña a la app a no re-mostrarla.
- Helpers del motor: normalizacion + similitud de texto (glosa-proyecto), base para el cruce con tolerancia y el juez IA que vienen en los siguientes incrementos.

## 2026-06-14 — Datos: BM Soluciones, quitar doble conteo (6 cuotas fantasma)
- Se eliminaron (a Papelera) las 6 cuotas mensuales Ene-Jun 2026 marcadas pagadas SIN factura: duplicaban con la factura real 239 (Asesoria Legal Permanente Enero-Junio, 8.343.676) que cubre ese periodo. Se dejaron la 239 y las cuotas Programadas Jul-Dic.

## 2026-06-14 — Tareas: pill de responsable con color por persona
- En las tarjetas de tareas, la pill del responsable ahora tiene **color distinto por persona** (Martin verde, Martina morado, Rodrigo ambar, Erasmo azul, Cristobal azul corporativo). Si hay varios responsables, cada uno con su pill.

## 2026-06-14 — Resultado del año: los 4 indicadores en una grilla ordenada
- Facturado, Cobrado, Costo oficina y Tasa de cobro quedan en una misma grilla 2x2, en orden logico por columnas: izquierda Facturado entonces Costo (facturado menos costo = neto), derecha Cobrado entonces Tasa. Todos con su color; Facturado/Cobrado/Costo tocables.

## 2026-06-14 — Resultado del año: Vendido y Neto firma grandes al mismo nivel
- Arriba, las dos cifras protagonistas en grande y al mismo nivel: **Vendido** (izq) y **Neto firma** (der). Luego la barra, y **Facturado / Cobrado** como cifras de soporte con su porcentaje. Costo oficina y Tasa de cobro al pie (tocables).

## 2026-06-14 — Resultado del año: costo dentro del Facturado (ubicación lógica)
- El **Costo oficina** ya no se marca al extremo derecho de la barra (zona de lo no facturado), sino **dentro del Facturado, en su borde derecho** — porque el costo (terceros) sale de lo facturado, no de lo vendido aún sin facturar. Lo verde de Facturado = Neto firma. Globito aclara "de lo facturado".

## 2026-06-14 — Resultado del año: globito al tocar un tramo de la barra
- Al tocar Facturado / Cobrado / Costo oficina en la barra aparece un **globito** sobre el tramo con su monto y % (Facturado % de lo vendido, Cobrado % del facturado).

## 2026-06-14 — Resultado del año: Vendido como encabezado + costo tocable + filas claras
- **Vendido** ahora es el encabezado con su total a la derecha (la barra entera = lo vendido), para que se distinga.
- **Todos los tramos tocables**, incluido **Costo oficina** (abre el detalle de terceros por factura).
- Datos en **filas con swatch + etiqueta + monto** (Facturado/Cobrado/Costo), para no tener que adivinar el color. Cierra con Neto firma + Tasa.

## 2026-06-14 — Resultado del año: Alt 3 (neto destacado) + barra fina interactiva
- Datos: chips de color en una fila y **Neto firma destacado** abajo con Tasa como píldora (Alt 3).
- **Barra más fina** (13px) e **interactiva**: tocar el tramo Facturado o Cobrado abre su detalle; separadores blancos entre tramos; el tramo activo se resalta.

## 2026-06-14 — Resultado del año: datos en grilla de mini-stats (Alt 2)
- Bajo la barra, los datos pasan a una **grilla 2×2** de tarjetitas con borde de color (Vendido / Facturado / Cobrado / Costo oficina); Facturado y Cobrado tocables. Neto firma y Tasa cobro en una línea al pie.

## 2026-06-14 — Resultado del año: datos en lista alineada bajo la barra
- Bajo la barra, los datos pasan a una **lista alineada**: punto de color + etiqueta a la izquierda y monto a la derecha (Facturado con % de lo vendido, Cobrado con % del facturado, Costo oficina en rojo). Cierra con Neto firma destacado. Facturado y Cobrado siguen tocables.

## 2026-06-14 — Resultado del año: una sola barra con los valores marcados
- Reemplazo a **una sola barra** = Vendido (track); sobre ella se marcan Facturado y Cobrado (desde la izquierda) y Costo oficina (desde la derecha), cada uno en su color. Leyenda con los montos color a color debajo; Facturado y Cobrado tocables. Neto firma · Tasa cobro al pie.

## 2026-06-14 — Resultado del año: las 4 etapas resumidas en una fila
- Las etapas (Vendido · Facturado · Cobrado · Costo oficina) ahora van en **una sola fila**, cada una con su monto y mini-barra (% de lo vendido). Costo oficina = terceros, en rojo. Debajo, en línea: Neto firma · Tasa cobro.

## 2026-06-14 — Resultado del año en una línea + costo oficina marcado
- La tarjeta pasó de funnel vertical (3 líneas) a **una sola línea**: Vendido › Facturado › Cobrado (Facturado y Cobrado siguen tocables).
- Al pie: Tasa cobro · **Costo oficina** (terceros/proveedores, marcado en rojo) · Neto firma.

## 2026-06-14 — Modo demo (?demo=1)
- Nuevo **modo demo**: abrir la app con `?demo=1` salta el login y carga un set de **datos ficticios** (clientes, ventas, facturas, gastos, tareas, caja chica) para mostrar la app sin información real.
- **Seguridad**: en demo el cliente de Supabase queda inerte — ninguna lectura ni escritura toca la base real.

## 2026-06-14 — Tareas fuera del Dashboard + acceso desde el encabezado
- Se quitó la lista de tareas del Dashboard (lo descongestiona).
- Nuevo botón **"Tareas" (ícono ojo)** en el encabezado de Inicio (admin) que abre la vista de tareas por persona — la misma que ven los usuarios limited.

## 2026-06-14 — Dashboard: espacio Cash flow/Aging + título de Aging afuera
- Se separó la tarjeta de Aging de la de Cash flow (faltaba el espacio superior, quedaban pegadas).
- El título "Aging de cartera" salió de la tarjeta (va arriba como las demás secciones); dentro queda el total con el subtítulo "Por cobrar".

## 2026-06-14 — Resultado del año: tarjeta rediseñada (funnel vertical)
- La tarjeta pasó de 3 columnas apretadas con flechas a un **funnel vertical**: cada métrica (Vendido / Facturado / Cobrado) en su fila con monto y una barra que muestra el embudo como % de lo vendido. Tasa cobro y Neto firma quedan como cierre. Mejor distribución y legibilidad en móvil; Facturado y Cobrado siguen tocables.

## 2026-06-14 — Resultado del año: sin mezcla de años + sigue el selector
- **Cobrado deja de mezclar años**: ahora "Cobrado" del funnel es lo pagado de las facturas EMITIDAS en ese año (antes el cálculo sumaba con un OR los cobros de facturas de años anteriores, inflando la cifra). El funnel queda coherente: Vendido ≥ Facturado ≥ Cobrado, todo del mismo año, y Tasa cobro = Cobrado/Facturado.
- **Sigue el selector de año**: el bloque ahora responde al año elegido en Revenue target (2026/2025/2024…), no queda fijo en el año actual.
- **Se quitó "Programado" del funnel**: es plata futura (proyección), no un resultado del año; vive en Cash flow.

## 2026-06-14 — Dashboard: reorganización en 3 capas + funnel sin datos repetidos
- **Nuevo bloque "Resultado del año"**: funnel Vendido → Facturado → Cobrado (Facturado/Cobrado/Programado tocables con su detalle) + Tasa cobro y Neto firma. Consolida lo que antes estaba disperso.
- **De-duplicación**: se eliminaron los bloques "Cobranza" y "Facturación" (Cobrado aparecía dos veces; Por cobrar/Vencido ya viven en Aging; Proveedores en Cuentas por pagar).
- **Revenue target**: se quitó "Bruto" (idéntico a Vendido) y el "Neto" se rotuló "Neto venta" para no confundirlo con el "Neto firma" del funnel.
- **3 capas**: Estrategia (meta + funnel + ventas) → Cobranza y caja (cash flow + aging) → Operación (sin fondos, tareas, proveedores, caja chica).

## 2026-06-14 — Dashboard interactivo (Parte C): cash flow rediseñado
- **Cash flow histórico + proyección**: el gráfico ahora muestra meses pasados (cobrado real, línea gris) y futuros (proyección, línea azul) con la marca "Hoy" entre ambos, para ver tendencia.
- **Meses tocables**: tocar un mes despliega las facturas/cuotas que lo componen (cliente · concepto · monto · estado).
- **Etiquetas claras**: los KPIs ahora dicen su horizonte (Total 6M, Emitido por cobrar, Programado 6M) con una nota que explica que es proyección desde hoy — se acaba la confusión con el "Programado" anual de Cobranza.

## 2026-06-14 — Dashboard interactivo (Parte B): caja chica y cuentas por pagar
- **Gestión caja chica**: las tarjetas por persona ahora son tocables; despliegan la lista de gastos sin liquidar (fecha · concepto · cliente · monto) con acceso directo a liquidar.
- **Cuentas por pagar a proveedores**: cada cuenta se puede tocar para ver su origen (venta · cliente · monto) y una explicación clara del estado — incluido qué significa \"espera cobro\".

## 2026-06-14 — Dashboard: Cobranza con detalle inline + años con ventas
- **Cobranza**: tocar Por cobrar / Vencido / Cobrado / Programado ya no manda a otra pestaña; despliega inline las facturas que componen el número (cliente · concepto · monto · días/fecha) con total y acceso a Facturación.
- **Años anteriores (Revenue target)**: la lista ahora incluye cualquier año con ventas registradas, no solo los que tienen meta cargada.

## 2026-06-14 — Dashboard interactivo (Parte A): Revenue target, Ingreso recurrente, Sin fondos
- **Revenue target**: nuevo desplegable "Ventas {año}" que lista las ventas que componen el Vendido (cliente · proyecto · monto) y reconcilia con el total.
- **Ingreso recurrente**: al tocar se despliegan las asesorías permanentes (cliente · proyecto · monto/mes) que suman el ingreso recurrente.
- **Clientes sin fondos**: se agregó la flecha de "tocar para ver" (el detalle por cliente ya existía pero no se notaba que era desplegable).

## 2026-06-14 — Tipografía: escala consistente (tamaños huérfanos ajustados)
- Los 7 tamaños de fuente "huérfanos" (8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 15.5) se ajustaron al rung estándar más cercano (9/10/11/12/13/15), eliminando la deriva de medios puntos. Cambio de 0,5–1 px, sin mover layouts. (Migración de colores literales a la paleta C: descartada por ahora — paleta congelada.)

## 2026-06-14 — Pulido menor: signo de saldo, fechas de correo, restaurar y limpieza
- **Signo −**: el saldo del modal de rendición (Saldo actual y Saldo tras rendición) muestra el signo negativo cuando corresponde.
- **Correo de liquidación**: las fechas del detalle van en formato `14-06-2026` (antes ISO crudo).
- **Restaurar gasto**: si su rendición ya no existe, vuelve como PENDIENTE en vez de quedar con un vínculo muerto que lo mostraba "rendido"; cubre rendición de cliente y de caja chica.
- **Limpieza**: eliminado el código muerto `handleTogglePagado`.

## 2026-06-14 — Cifras: liquidación caja chica + reporte coherentes con el período
- **Liquidación parcial sin descuadre**: si al liquidar caja chica algún gasto no se marca, la rendición se ajusta al total y N° de gastos REALMENTE marcados (antes quedaba con el total inflado); si no se marca ninguno, se cancela.
- **Período de la liquidación = mes de los gastos**, no el mes de hoy (igual criterio que la rendición al cliente; muestra rango si cruza meses).
- **Reporte — meta**: en modo mes la barra de avance compara contra la **meta mensual** (UF anual ÷ 12) y se reetiqueta; antes un mes siempre marcaba ~8% contra la meta anual completa.
- **Reporte — Gastos y Fondos**: ahora respeta el período elegido (híbrido): fondos y gastos del mes + saldo acumulado a la fecha; solo lista clientes con movimiento en el período.
- **Reporte — años**: el selector ya no duplica el año (se normalizó número vs string).

## 2026-06-14 — Rendiciones: total se reajusta al editar un gasto ya rendido
- **Editar el monto** de un gasto ya rendido/liquidado ahora reajusta el total de su rendición (antes quedaba con el monto viejo → descuadre entre el total guardado y la suma del detalle).

## 2026-06-14 — Rendiciones: saldo único auditable + anular reembolso al anular rendición
- **Saldo del fondo, una sola fuente**: `rendicionSaldo()` = fondos recibidos − gastos ya rendidos (acotado a la razón social). El modal, el PDF y el correo al cliente muestran ahora **la misma cifra** (antes divergían: el PDF ignoraba rendiciones anteriores y el correo restaba gastos aún no rendidos).
- **PDF — recuadro "Resumen del fondo"**: ledger auditable al pie (Fondos recibidos − cada rendición anterior − esta rendición = Saldo disponible), para que el cliente entienda de dónde sale el saldo.
- **Anular rendición anula su reembolso**: al anular una rendición se anula también el cobro de reembolso asociado (queda Anulada, reversible) y se avisa el monto — antes quedaba huérfano y seguía cobrable en cartera.

## 2026-06-14 — Integridad: guards doble-submit + cuentas por pagar coherentes + deshacer anticipo
- **Doble envío bloqueado**: Pagar factura y Guardar asignaciones (Drive/PDF) quedan deshabilitados mientras guardan, evitando duplicados por doble toque.
- **Cuentas por pagar**: las cuentas a proveedores de una factura **anulada** ya no se cuentan como deuda (Dashboard y "Mis Proveedores").
- **Anticipos**: el botón **Deshacer** ahora también revierte un anticipo consumido directo contra una factura (vuelve a disponible y la factura a Pendiente si nada más la cubre).

## 2026-06-14 (noche) — Backlog: datos, chips y consistencia visual
- **BM Soluciones**: marcadas como pagadas las 6 cuotas adelantadas (ene–jun 2026); jul–dic quedan programadas.
- **Chips** también en los botones dentro de las fichas de cliente (+ Fondo / + Gasto / + Tarea / Rendir).
- **Tints unificados**: variantes sueltas de ámbar/rojo/verde colapsadas al tint canónico (se preservó el esquema del banner "Recuperar borrador"); tokens `soonBg/overdueBg/greenBg` en la paleta.
- **Modales**: título en color corporativo (accent) y botón de cerrar más grande (44px) para el dedo.

## 2026-06-14 — Importar facturas: revisión con IA (Opus 4.8)
- En **Importar facturas (Excel)**, nuevo botón **"Revisar con IA (Opus 4.8)"**: antes de cargar, Opus audita el lote y muestra resumen, alertas (huérfanas, notas de crédito, montos negativos, RUT mal formateados, conceptos raros), lista de clientes a crear y una recomendación. Solo audita, no modifica datos.

## 2026-06-14 — Dashboard: aging con detalle, KPI sin fondos rediseñado, espaciado
- **Aging de cartera**: ahora tocas cualquier tramo (Al día / 31-60 / +60 días) y se despliega el detalle de las facturas que componen ese número (cliente, concepto, días vencida, monto).
- **Clientes sin fondos**: rediseñado a tarjeta dividida — a la izquierda el total y cuántos requieren fondos; a la derecha la lista ordenada por gravedad con un punto rojo según severidad. Al tocar un cliente se abre su detalle abajo.
- **Espaciado**: corregido el hueco doble entre el bloque de meta y Cobranza; tarjetas KPI unificadas (mismo gap/radio/padding en Cobranza, Cash Flow y Facturación); quitado el banner verde "Listo para transferir" (duplicaba el KPI Por pagar).

## 2026-06-14 — Assessment de guardar/cargar: 3 bugs de datos
- **Delegar tareas** fallaba siempre (intentaba escribir un campo inexistente). Ahora delega bien.
- **Caja chica** sumaba por error las rendiciones al cliente en "Mis liquidaciones" → el total liquidado quedaba inflado. Corregido (ahora cuenta solo liquidaciones de caja chica).
- **Restaurar un gasto** desde la Papelera no devolvía su monto a la rendición de la que venía → el total de esa rendición quedaba descontado para siempre. Ahora lo repone.
- Robustez: si falla recargar las razones sociales, ya no se vacía el catálogo en memoria; marcar "enviada" una rendición y guardar un contacto ahora avisan si la base falla.

## 2026-06-14 — Importar clientes (Drive y propuesta) no guardaba
- **Importar clientes desde Drive**: no guardaba ninguno porque escribía en una columna inexistente (`area`). Ahora marca bien el estado (Activo/Terminado) y la fecha de término del año de la carpeta.
- **Crear cliente al importar una propuesta**: fallaba si traía razón social (la escribía en `clients`, donde esa columna no existe). Ahora el cliente se crea y la razón social se guarda como entidad del cliente.

## 2026-06-13 — Auditoría 2: integridad de datos, cifras y robustez
- **Anticipos**: si aplicas anticipos por más que la factura, el excedente ya no se pierde — vuelve como anticipo disponible.
- **Carga de datos**: si una tabla falla al cargar (red/permiso), ahora avisa en vez de mostrar todo en cero (evita recargar y duplicar).
- **Cambios de estado** (marcar pagado, asignar cliente, borrar en lote): si la base falla, la pantalla ya no miente diciendo que se guardó.
- **Cuotas**: la última cuota absorbe el residuo de redondeo → la suma de cuotas calza exacto con el honorario.
- **"Facturado"**: una sola definición (`esFacturada`) en Dashboard, ficha de cliente y ficha de venta — antes el mismo cliente mostraba cifras distintas según la pantalla. El "% meta" del Dashboard ahora usa neto (igual que el historial).
- **Restaurar venta**: solo revive las cuotas que estaban vivas al borrarla (ya no resucita cuotas que habías borrado aparte).
- **Anular rendición**: si no se pueden liberar los gastos, no borra la rendición (evita gastos huérfanos).
- **Importar facturas (Excel)**: al asignar un cliente a mano aprende el RUT (próximas importaciones lo reconocen solas) y lo aplica a las demás filas con el mismo RUT.
- **Deshacer** en "Asignar razón social" y "Asignar cliente a gasto".
- Importadores y reporte: ya no se cierran al tocar fuera. Reconciliación de programadas: reversible (Papelera) y no actúa si hay empate ambiguo. Match de PDF y autocomplete de razones sociales: ya no se rompen con RUT/nombre vacío.
- **Paleta**: grises fuera de paleta reemplazados por tokens; colores de categoría completos en todas las vistas.

## 2026-06-13 — Diagnóstico: aprende, deshacer y paleta
- **Gasto huérfano que aprende (de verdad)**: al asignar cliente a un gasto sin cliente, se aplica a todos los gastos sin cliente con la misma descripción. Antes leía el campo `notas` (casi siempre vacío) → nunca disparaba; ahora usa `concept`.
- **Eliminar sin fricción + Deshacer**: eliminar venta, cobro o gasto ya no pregunta con un confirm redundante — se hace al toque y aparece un **toast "Deshacer"** que restaura de inmediato (siguen yendo a Papelera igual). Se conserva la confirmación solo en el caso de riesgo (gasto ya rendido al cliente, que descuadra).
- **Paleta**: el verde de cifras `#0F6E56` se oficializó como token `C.greenText` (era un hex suelto repetido 24 veces).

## 2026-06-13 — Dashboard: KPIs y Tareas
- **Espacios uniformes entre KPIs** (bloque Facturación pasa a `gap:8`, igual que Cobranza y meta) y título "Cobranza" en el grid accionable.
- **Rediseño de Tareas**: cada persona muestra de un vistazo si tiene tareas **vencidas** (pill roja) o **prontas** ≤7 días (pill ámbar) sin expandir, con contador y jerarquía más limpia (avatar 28px, nombre en grafito, fila resaltada al abrir).

## 2026-06-13 — Importar facturas antiguas (Excel) + gasto que aprende
- Nuevo **Importar facturas (Excel)** en Facturación (botón "↑ Excel"): lee el archivo, detecta columnas (Cliente/RUT, N° factura, Monto, Fecha emisión, **Fecha pago**), hace match de cliente, y muestra un **preview con pre-confirmación** (estado por fila: Pagada/Pendiente/Error/Ya existe; asignar cliente, omitir) antes de guardar. Las que traen fecha de pago entran como Pagadas con su `paid_at`. Detecta duplicados por N° factura.
- **Gasto huérfano que aprende**: al asignar un cliente a un gasto sin cliente, se aplica también a los otros gastos sin cliente con la misma descripción (no repetir el trabajo).

## 2026-06-13 — Soft-delete + Papelera
- Eliminar **venta, cobro o gasto** ya no borra: marca `deleted_at` y va a la **Papelera** (menú ≡). Desde ahí se puede **Restaurar** o **Eliminar definitivo**. Restaurar una venta también restaura sus cuotas.
- Los loaders excluyen lo eliminado, así desaparece de todas las vistas. Requiere columnas `deleted_at` en sales/billing/expenses.

## 2026-06-13 — Facturación: KPIs compactos y tappables = navegación
- Los 4 KPIs (Por cobrar / Programado / Vencido / Cobrado) ahora son **más chicos y tappables**: al tocar uno entras a su detalle (reemplazan las tabs Emitidas/Programadas/Pagadas). El activo queda resaltado con su color.
- Tabs secundarias (Todas, Proveedores, Checklist, Anticipos) quedan en una fila de píldoras debajo.
- Por defecto queda **"Por cobrar"** a la vista. Cifras en formato corto ($33,5M) para que entren las 4 columnas.

## 2026-06-13 — Proveedores inline (formato clientes) + pills de año en Facturación
- **Proveedores** ya no abre un modal: se despliega **inline a pantalla completa con el mismo formato que clientes** (lista → ficha → editar), desde el chip en Clientes. La X vuelve a Clientes.
- **Facturación**: el selector de año se reemplazó por **pills** (Todos · 2025 · 2026 · 2027…) para selección rápida; el mes queda en su selector. KPIs siguen el año elegido.

## 2026-06-13 — Proveedores como chip en filtros + ajustes ficha cliente
- "Proveedores" se movió del header a un **chip discreto en la fila de filtros** de Clientes (a la derecha).
- Editar cliente: header canónico; el listado plano de razones sociales sin asignar se reemplazó por búsqueda+asignar en el input; Editar en Limited abre directo como admin (sin paso "Confirmar cambios").

## 2026-06-13 — Ficha proveedor: honorarios = su parte, "Le debes" solo lo cobrado
- **Honorarios involucrados** ahora suma **lo que cobra el proveedor (su parte)** en sus ventas, no el total de las ventas.
- **Le debes** cuenta solo lo que ya está **Por pagar** (la factura del cliente ya se cobró). Lo que está **Pendiente** (cliente aún no paga) se muestra aparte y no se considera deuda. Aplica también al listado de proveedores.

## 2026-06-13 — Reparto proveedor: aviso si falta elegir + footer responsive
- Al guardar una venta, si quedó una fila de reparto con monto pero **sin proveedor elegido**, ahora avisa en vez de descartarla en silencio (era la causa de que "no se guardara" el proveedor: la fila se agregaba pero no se completaba el desplegable).
- Footer del modal de venta **responsive en móvil**: botón principal (Guardar) full-width abajo; Cancelar/Eliminar/Borrador en una fila arriba.

## 2026-06-13 — Ficha de proveedor: ventas en que participa
- La ficha del proveedor ahora tiene dos bloques con indicadores propios:
  - **Ventas**: nº de ventas en que participa + **honorarios involucrados** (total de esas ventas, en UF). Lista de tarjetas: proyecto, cliente, mes/año, **su parte** (suma de sus cuentas, UF si la venta es UF), total de la venta y % que representa. Tocar una tarjeta abre la venta.
  - **Pagos**: Le debes / Pagado + el detalle de cuentas (con deshacer pago).

## 2026-06-13 — Proveedor visible en Condiciones registradas + botón
- En "Costos de proveedores" (venta guardada) ahora se muestra el **nombre del proveedor** asignado al lado del monto (o "N proveedores"); si no hay, aparece el botón **+ Agregar proveedor** en la misma línea (sin desplegar).
- El "+ Agregar proveedor" pasó a ser un **botón** (antes era texto).

## 2026-06-13 — Reversibilidad: reactivar factura anulada + deshacer pago a proveedor
- **Factura anulada**: ahora tiene botón **"Reactivar"** (vuelve a Pendiente y borra el registro de baja). El aviso al anular dejó de decir "no se puede deshacer".
- **Pago a proveedor ya transferido**: en el panel Proveedores, cada pago marcado tiene **"Deshacer"** (vuelve a "Por pagar" y borra fecha, referencia y documento).

## 2026-06-13 — Deshacer pago de una factura
- Si marcas una factura como pagada por error, ahora tiene un botón **"Deshacer pago"**: vuelve a Pendiente, borra la fecha de pago y revierte las cuentas por pagar a proveedores que se habían liberado (las que aún no transferiste vuelven a "Pendiente"). Pide confirmación.

## 2026-06-13 — Reparto: switch "Cambiar", Condiciones sin textos extra, doc en historial
- Cada proveedor del reparto muestra **"Cambiar"** junto al switch (cambiar condiciones = monto y forma).
- En **Condiciones registradas**, al expandir Costos de proveedores se muestra el reparto sin el encabezado "¿A quién le pagas?" ni el texto "Comisión de tu honorario": queda solo "+ Agregar proveedor" y las filas.
- El **N° de documento del proveedor y su fecha** ahora se ven en el historial de pagos del proveedor (panel Proveedores).

## 2026-06-13 — UF sin decimales forzados, proveedor por contacto, doc fiscal al pagar
- **UF**: ya no se muestran decimales forzados (UF 100 = "UF 100"); los decimales aparecen solo cuando existen (ej. conversión CLP→UF), máximo 2.
- **Proveedores**: el nombre visible es el **contacto (la persona)**; la razón social pasa a subtítulo.
- **Pago a proveedor**: el modal Pagar (individual y en bloque) pide **N° de documento del proveedor y su fecha** (factura/boleta que respalda el pago). Requiere columnas `factura_numero` (text) y `factura_fecha` (date) en `terceros_pagos`.
- **Anticipos**: el filtro Anticipos ya no muestra el listado de facturas por cliente debajo (era redundante); solo el panel de anticipos.
- **Proveedores** se movió de Facturación a la pestaña **Clientes** (botón arriba a la derecha); Facturación queda más liviana.

## 2026-06-13 — Honorarios y Costos en una línea (Opción C)
- En nueva venta/propuesta, **Honorarios y Costos de proveedores** quedan en dos columnas en la misma fila, con el **toggle UF/CLP compartido** subido al header de la sección (ya no duplicado). Costos conserva su toggle UF/% inline. El valor UF del día queda compacto bajo Honorarios.
- Se eliminó el **switch on/off** de costos: si dejas Costos vacío = sin costo; el bloque "¿A quién le pagas?" aparece solo cuando hay monto. Modal más corto.

## 2026-06-13 — Reparto proveedores en venta: por defecto + switch editar; header y densidad
- Al **agregar proveedor** toma por defecto el costo de proveedores aún no repartido (todo el costo si es el primero), en las mismas cuotas del cobro. Cada proveedor trae un **switch "editar"**: apagado muestra solo el monto por defecto; encendido despliega los campos para cambiar monto y forma (% / UF / $).
- Se eliminó el **mensaje amarillo** de reconciliación; si no cuadra, solo una línea gris discreta "Repartido X de Y".
- Header del modal de venta/propuesta alineado al patrón canónico de "Nueva tarea" (título azul + separador `|` + cliente en gris).
- "Razón social a facturar" sin RS: el aviso se resumió a un paréntesis junto al label "(se asocia al emitir la 1ª factura)".

## 2026-06-13 — Editar cobro: proveedor del monto de terceros + notas/archivos en una línea
- En "Editar cobro", al poner un monto **De terceros (CLP)** se despliega **¿A quién le pagas?** para asignar el proveedor. Viene prepoblado si la venta/propuesta ya tenía el costo y el proveedor; se puede cambiar aquí (ej: costo que surgió después). Al guardar, crea/actualiza/elimina la cuenta por pagar anclada a ese cobro (Por pagar si ya está cobrado). Si ya le pagaste, queda bloqueado (deshacer el pago en Cuentas por pagar).
- **Notas y el ícono de adjuntar** ahora en la misma línea; se eliminó el título "Archivos" duplicado. El ícono muestra un contador y la lista de archivos cae debajo.

## 2026-06-13 — Pagar varias cuotas juntas a un proveedor
- El reparto a proveedores se reparte SIEMPRE en las mismas cuotas del cobro (de cada factura cobrada, la parte que le corresponde al proveedor queda "Por pagar"). La decisión de pagarle al tiro o juntar varias cuotas es del momento de pagar, no de la venta.
- En "Cuentas por pagar" del dashboard, cuando un proveedor tiene ≥2 cuotas por pagar aparece **Pagar las N · $total**: registra todas en una sola transferencia (misma fecha y referencia). También se puede pagar cada cuota por separado.
- Widget "Cuentas por pagar a proveedores" del dashboard ahora **abierto por defecto**.
- Editar venta: el nombre del cliente sube al título (sin botón "Cambiar"). Texto del reparto reducido.

## 2026-06-13 — Tanda C: tintes a la paleta + tap targets
- Botones de cerrar (×) de los formularios con área de toque de 40px.
- Consolidación de tintes casi-idénticos a la paleta oficial (sin cambio de layout): verde `#E4F1EA`→`#E1F5EE`; rojo `#FBE9E7`→`#FCEBEB`; azules/grises `#E3EEF3`→`#E6EEF1`, `#F7F8F9`/`#F0F4F6`/`#EFF3F5`→`#F5F7F9`. ~80 usos alineados.

## 2026-06-13 — Sobrante de anticipo
- Al cubrir cuotas, si el anticipo es mayor que la suma de las cuotas cubiertas, el **saldo queda como un anticipo disponible** ("Saldo de anticipo") — no se pierde y se puede aplicar después (a otra cuota o como abono). El panel no deja cubrir por más que el anticipo. El saldo parcial de una cuota que el anticipo no alcanza se maneja dejando ese saldo disponible y aplicándolo como abono al emitir esa factura.

## 2026-06-13 — Una factura por el bloque anticipado — etapa 4
- Para un anticipo que ya cubre cuotas, botón **"Emitir una factura"** (en Anticipos y en la ficha de la venta): crea **una sola factura** por el total del bloque, marcada Pagada (pagada con el anticipo), con N° y fecha. Las cuotas siguen como referencia (Anticipada), sin emitirse por separado. O puedes dejarlo sin factura. Cierra el flujo anticipos↔cuotas (etapas 1-4).

## 2026-06-13 — Anticipos↔cuotas desde la ficha de la venta — etapa 3
- En la ficha de una venta/propuesta, nueva sección **"Anticipos y cuotas"**: muestra cuántas cuotas están anticipadas vs programadas y los anticipos del proyecto, con la misma acción **"Aplicar a cuotas"** (sugiere por monto + ajustas) y **"Deshacer"**. Así reflejas "anticipo recibido + resto en cuotas" desde la venta, no solo desde Anticipos.

## 2026-06-13 — Anticipos que cubren cuotas (sin doble conteo) — etapa 1
- Un anticipo ahora puede **cubrir cuotas programadas**: desde Facturación → Anticipos, en un anticipo disponible, "Aplicar a cuotas programadas" abre un panel que **sugiere las cuotas por monto** (desde la primera) y permite **ajustarlas a mano**. Las cuotas cubiertas pasan a estado **Anticipada**: salen de la proyección de flujo de caja y de "por facturar" (su plata ya entró como anticipo → sin doble conteo, sin facturas fantasma). El anticipo queda "En cuotas". Reversible con "Deshacer cobertura". (Próximo: reflejarlo desde la ficha de la venta + emitir una sola factura por el bloque.) Requirió SQL: `billing.prepaid_anticipo_id`.

## 2026-06-13 — Anticipo/Fondo: buscar cliente + autosafe carga masiva
- **Anticipo y Fondo**: el cliente ahora se elige **buscando** (escribes el nombre → resultados), no con un menú desplegable (regla permanente: buscar, no seleccionar).
- **Anticipo**: se quitaron los montos sugeridos (siempre eran distintos) → formulario más breve.
- **Carga masiva**: el modal ya no se cierra al tocar fuera (autosafe) — no se pierde la previsualización por un toque accidental.

## 2026-06-13 — Cliente en el encabezado en todos los formularios
- En **Anticipo, Fondo, Editar gasto** (y ya Editar cobro y Nueva tarea) el cliente se muestra en el **encabezado/título** y no se repite como campo en el cuerpo — más corto y consistente. Ninguno lleva "Cambiar". En Fondo se conserva el "Saldo actual" como una línea; en Editar gasto el cliente va en el título del modal.

## 2026-06-13 — Facturación: kebab directo a editar + Anular dentro de Editar
- El botón **⋯** de cada factura ahora **abre Editar directamente** (se eliminó el submenú que se veía mal). La tarjeta entera también abre editar.
- **Anular** y **Eliminar** viven ahora **solo dentro de Editar cobro** (Anular abre el flujo de baja con motivo/observaciones ahí mismo).
- Se quitó el botón **"Cambiar"** del cliente en el encabezado (en todos los formularios, según preferencia): el cliente va en el título, sin acción de cambio.

## 2026-06-13 — Editar cobro: cliente en el encabezado
- **Editar cobro** adopta el formato de Nueva tarea: el cliente va en el **encabezado** ("Editar cobro | Cliente" + Cambiar) en vez de ocupar una fila del cuerpo. Más corto y consistente.

## 2026-06-13 — Densidad: formularios más compactos
- Se apretó el espaciado de los formularios sin esconder campos: **Editar cobro** (gap entre campos 14→10, etiquetas más juntas) y, vía los componentes compartidos `Fld`/`Lbl`, también **Nueva venta/propuesta, Cliente, Gastos y Fondo** (margen entre campos 14→10, etiqueta 5→3). Las vistas largas quedan notoriamente más cortas.

## 2026-06-13 — Densidad: menos texto/instrucciones (criterio permanente)
- Se adopta como criterio permanente **ahorrar espacio y minimizar texto/instrucciones visibles** en toda la app. Primeros recortes: se quitaron hints redundantes (ej. "Podrás agregar más razones sociales…"), se acortó la instrucción de Carga masiva ("Sube un Excel — la app reconoce las columnas solas") y se simplificó el rótulo de razón social.

## 2026-06-13 — Editar cobro más corto + adjuntar solo ícono
- **Editar cobro**: el campo Notas pasó a una **sola línea** (antes era un recuadro alto) → la vista queda más corta.
- **Adjuntar archivo** (en toda la app): ahora es **solo el ícono** (sin el texto "Adjuntar archivo" ni la línea "Máx. 15 MB"); el detalle queda en el tooltip. Ahorra espacio en todos los formularios.

## 2026-06-13 — Tanda D (UX) parte 2: tarjeta de factura → editar
- En Facturación, **tocar la tarjeta de una factura abre Editar** (antes había que ir al menú ⋯). Los controles internos (checkbox, Registrar pago/Ya emitida, asignar cliente, ⋯) siguen funcionando aparte (no abren editar). El menú ⋯ mantiene Editar/Anular.

## 2026-06-13 — Tanda C (diseño) parte 1: alineación de paleta
- Se alinearon a la paleta corporativa los colores fuera de norma más repetidos (cambios casi imperceptibles, solo más coherentes): texto `#1a1a1a` → grafito `#3D3D3D` (47 líneas), fondo de inputs `#F7F7F7` → `#F5F7F9` (68), bordes `#E8E8E8` → `#E4E8EB` (19). (Pendiente etapa 2: extraer componentes únicos Btn/Input/Lbl/Chip, mapa CATS único, normalizar tintes y escala tipográfica.)

## 2026-06-13 — Tanda D (UX) parte 1
- **Cliente + razón social en un paso**: al crear un cliente nuevo ya puedes ingresar su razón social (nombre + RUT) en el mismo formulario; se crea junto con el cliente (antes había que guardar y reabrir). Podrás agregar más razones sociales después.
- **Área de toque del botón cerrar (×)** de los modales agrandada a 40×40 en iPhone (antes era un glifo sin caja).

## 2026-06-13 — Drive solo logo + "Terceros" → "Proveedores"
- Los 4 botones de importar desde Drive ahora muestran **solo el logo** (se quitó el texto "Drive"; ícono a 16px).
- En toda la interfaz visible, **"Terceros" pasó a "Proveedores"**: KPI del Dashboard, switch y fila "Costos de proveedores" en venta, tag y filtro "Proveedores" en Facturación, conciliación "El pago incluyó lo de proveedores", avisos de reconciliación y mensajes vacíos. (Los nombres internos de tabla/variables/componentes se mantienen.)

## 2026-06-13 — Auditoría Tanda A: fixes de cifras
- **Export de Ventas (ReportBuilder)**: ahora usa `ventaUF` (anualiza recurrentes ×12 y convierte ventas en CLP→UF) y la meta `META_UF` real (antes sumaba `amount_uf` crudo y meta 9.800 hardcodeada) → el reporte cuadra con el Dashboard. Filas y totales coherentes.
- **Tasa de cobro**: numerador y denominador en el mismo universo (facturado del año) + tope 100% (antes podía pasar de 100% contando pagos de años previos).
- **% meta histórico**: la barra de avance y el texto ahora usan ambos el **neto** (antes la barra iba en bruto y el texto en neto → no coincidían).
- **Anticipos parciales**: aplicar anticipos que NO cubren el total ya **no marca la factura pagada**; registra el abono y avisa cuánto queda pendiente.
- **`saldoCliente()` central**: la fórmula "fondos − gastos" se unificó en un helper con guarda `||0` y se blindaron todos los acumuladores/sumas de montos (antes ~8 copias, varias sin `||0` → riesgo de NaN y de no reconciliar entre vistas).

## 2026-06-13 — Costo de proveedores: % / UF / CLP + reparto por cuotas
- Reparto a colaboradores (en venta/propuesta) rediseñado: cada fila ahora elige **% · UF · $** (por defecto la unidad de la venta), y el costo se **reparte en las mismas cuotas que el cobro** (si te pagan en 5, al proveedor en 5). %/UF se calculan como **fracción de cada cuota real** → cuando la UF sube, lo que le debes sube junto con tu factura (cero descuadre). UF→CLP con la UF de la fecha de emisión de cada factura. La reconciliación y los montos se muestran en la unidad de la venta. Nota suave (no error) solo cuando hay costo en pesos fijos sobre una venta en UF. Aplica a ventas nuevas y ya cargadas. Requirió SQL: `terceros_pagos.tipo_costo`, `valor`.

## 2026-06-13 — Carga masiva de gastos con IA (PP-19)
- Carga masiva · memoria que aprende + auto-asignar iguales: al asignar un cliente a una fila, todas las filas con el mismo nombre se asignan al tiro, y la asignación se **guarda permanente** (tabla `import_aliases`, nombre-crudo → cliente). En la próxima carga, ese mismo nombre cae directo en "Auto" (badge **Aprendido**), sin volver a preguntar. La app aprende y no repite trabajo.
- Carga masiva · deshacer importación + historial (commit 5): tras importar, botón **Deshacer importación** (con modal de confirmación) que elimina los gastos de ese lote y lo marca anulado. En la pantalla de subida aparece **"Importaciones recientes"** (últimas 10) con quién, cuándo y N gastos, y un **Deshacer** mientras los gastos existan (o "Anulada el …" si ya se revirtió). Cierra el principio de que toda carga se pueda revertir si se cargó mal.
- Carga masiva · importación flexible (commit 4): la carga ahora inserta **en lote** (tandas de 100) vía un handler central que registra el lote en `bulk_imports` y marca cada gasto con `bulk_import_id` (para deshacer). **Dedupe contra la base** (mismo cliente + monto + fecha + concepto → se omite, no se duplica). Persiste **notas** y **proyecto**. "Importar todo" sube también las filas sin cliente (client_id null) y sin monto ($0). Panel de resumen post-importación con chips (importados · sin cliente · sin fecha · duplicados omitidos). Nuevo bucket **"Sin cliente · por asignar"** en Gastos: lista los gastos huérfanos y permite asignarles cliente después (resuelve que no quedaran invisibles). Requirió SQL: `notas`, `bulk_import_id`, `client_id`/`date` nullable.
- Carga masiva · UI preview inteligente (commit 3): la vista previa ahora muestra KPIs (Auto/Sugeridos/Revisar/Manual) y cada fila con su estado y color — **Auto** (verde, badge Auto/Interno), **Sugerido** (ámbar, N%, botón Confirmar + Cambiar + razón IA), **Revisar** (rojo suave, dropdown con los 3 mejores candidatos), **Manual** (gris, buscador por nombre/RUT/razón social), **Error** (sin monto, borde rojo, se importa como $0). La corrección de concepto de la IA se ve inline (original tachado → corregido en verde). Botones: **Confirmar sugeridos (N)** acepta todas las sugerencias de una vez, **Importar listos (N)** sube las resueltas, **Importar todo (N)** sube todas (sin cliente quedan sin asignar, sin monto como $0). `AsignarClienteInline` ahora acepta label/placeholder y busca también por RUT y razón social.
- Carga masiva · motor de matching con IA (commit 2): tras leer el Excel, cada fila se resuelve por niveles — RUT exacto (cliente o razón social) → nombre/razón social exacto → **fuzzy** (Levenshtein normalizado contra nombre, razón social y razones sociales de `client_entities`, sin sufijos legales/tildes, con bonus por contención y palabras clave) → **Claude Opus en lotes de 50** para los nombres sin resolver (también detecta gastos internos de la firma y **corrige los conceptos**: ortografía, capitalización y abreviaciones legales chilenas EP/CV/CCV/GP/D.O.). Fuzzy ≥90 e IA ≥85 se auto-asignan; 70/65-89 quedan como sugerencia; 50-69 con candidatos; el resto manual. Indicador "Analizando con IA · lote N/M" en vivo. Sin la API key (dev local) usa solo fuzzy. (La UI completa de sugerencias/candidatos llega en el commit 3.)
- Carga masiva · parser flexible (commit 1): detección de encabezado en las primeras 5 filas (tolera filas de título arriba) y reconocimiento de columnas por alias amplio en cualquier orden (Cliente/Nombre/RUT/Razón Social, Fecha, Concepto/Actividad/Descripción + Detalle Proveedor → concepto compuesto, Categoría/Tipo/Proveedor, Monto/Importe/Valor, Notas, Proyecto). Fechas tolerantes: Date nativo, serial de Excel, `dd.mm.yy(yy)`, `dd-mm-yyyy`, `dd/mm/yyyy`, `yyyy-mm-dd`. Montos con separadores de miles y `$`. Sinónimos de categoría (Conservador→CBR, D.O.→Diario Oficial, etc.) manteniendo **Registro Civil** como categoría propia. Filas vacías se ignoran; sin encabezado reconocible se asume orden estándar. (El persistir Notas/Proyecto y la importación sin cliente vienen en commits siguientes.)

## 2026-06-13
- Dashboard · widget "Cuentas por pagar a colaboradores" + modal Pagar (commit 5, cierra el ciclo de terceros): sección colapsable con banner verde de acción ("Listo para transferir: $X a N colaboradores" cuando hay plata en *por pagar*), 3 KPIs (Por pagar / Pendiente / Pagado del año) y lista agrupada por colaborador — avatar, razón social/RUT, total que le debes y cada cuenta (cliente · proyecto, factura origen con "cobrada/vence", monto, estado). *Por pagar* → botón **Pagar**; *pendiente* → "espera cobro". El **modal Pagar** muestra el monto, el origen (cliente · proyecto · F°), los **datos de transferencia con botón Copiar**, adjuntar/ver la **factura del colaborador** (Drive, tabla `terceros_attachments`) y **fecha + referencia** para marcar pagado. Se agregaron columnas `drive_file_id` y `uploaded_by` a `terceros_attachments`. Ciclo completo: pendiente → por pagar → pagado, visible también en la ficha del proveedor.
- Facturación · tag Terceros + filtro + conciliación al pagar (commit 4): tag **Terceros** (sin monto, azul corporativo) en toda factura con cuentas por pagar ancladas; nuevo filtro **Terceros** en las pills (la fila ahora hace scroll horizontal para no romper el iPhone con 7 pills). Al registrar el pago de una factura ancla con terceros pendientes, el modal Confirmar pago pregunta con un check (activo por defecto) **"El pago incluyó lo de terceros"** (nombres + total): al confirmar, esas cuentas pasan de **pendiente** a **por pagar**. Si la factura no tiene terceros, el modal queda idéntico.
- Ventas/propuestas · reparto del costo de terceros a colaboradores (commit 3): al activar el switch **Costos de terceros** se despliega **"¿A quién le pagas?"** — filas con colaborador (del catálogo de Proveedores), monto en CLP y cuota ancla (la factura cuyo pago libera el fee; por defecto la 1ª, editable si hay 2+). Aviso ámbar/verde de reconciliación con el costo total. Cada fila crea una **cuenta por pagar** (`terceros_pagos`) anclada a venta + cuota + colaborador, estado inicial **pendiente**. NO toca `monto_terceros` (es comisión de tu honorario, sin doble conteo). Funciona en venta nueva (ancla por índice → factura real al guardar) y existente (en Condiciones → "Costos de terceros"). Quitar una fila borra la cuenta salvo que ya esté pagada.

## 2026-06-12
- Proveedores · catálogo + ficha (costos de terceros, commit 2): nuevo botón **Proveedores** en el encabezado de Facturación que abre el catálogo de colaboradores (Rodrigo Díaz, Andrés Mery, etc.). Lista buscable (nombre, razón social, RUT) con el saldo que les debes; **ficha** con título = razón social o nombre, subtítulo "Contacto:" + RUT, KPIs **Le debes / Pagado**, datos de pago para transferir e historial de pagos/cobros (por ahora vacío; se llena al asignar terceros en una venta). Alta/edición con un solo campo obligatorio (Nombre). Todo se guarda permanente y se reutiliza.
- Facturación · rediseño de filas (cuentas por pagar, commit 1): cada factura se reordenó — concepto y monto arriba (el concepto se trunca, el monto deja de correrse), "Factura N° 359 · Fecha: 01-06-2026" debajo, y en la última línea un **semáforo** (días desde emisión, color verde/ámbar/rojo según vencimiento) + badges. Las acciones se simplificaron: botón **"Registrar pago"** (abre el modal; revertir se hace desde Editar) y un menú **⋯** que recoge **Editar / Anular** (saca la acción destructiva del camino). Se arregló el campo de fecha del modal Confirmar pago (quedaba descuadrado en iOS).

- Registrar fondo recibido · rediseño moderno (mismo lenguaje que Nuevo anticipo): título "Registrar fondo | Cliente", cliente con avatar + saldo actual, **Proyecto obligatorio** (de las ventas/propuestas del cliente, guarda `project`+`sale_id`), fila **Razón social · Monto · Fecha** (RS obligatoria salvo que el cliente no tenga ninguna), montos rápidos en pills y descripción amplia. Botón azul "Guardar fondo".
- Facturación · excluir reembolsos de gastos: toda la vista de Facturación (lista, KPIs Por cobrar/Programado/Vencido/Cobrado, conteos), el aging de cartera y la proyección/cobranza del Dashboard ahora excluyen los registros `billing_type='reembolso'` (no se borran ni se ocultan en la ficha del cliente ni en el modal Editar cobro). Además se quitaron los conteos entre paréntesis de las pestañas (Emitidas / Programadas / Pagadas).
- Confirmar pago · rediseño: el modal de confirmar pago se rehízo (centrado, responsive) — label "CONFIRMAR PAGO", monto grande + concepto · folio, ícono check verde, campo "FECHA DE PAGO" (sin el texto "Fecha en que se recibió el pago") y botones Cancelar / Confirmar pago.
- Anticipos · aplicar en Editar cobro (PP-15 commit 3): al editar una factura cuyo cliente tiene anticipos disponibles, aparece un bloque verde (después de Cliente) que lista los anticipos con checkbox; al seleccionar se actualiza en vivo "Aplicar: $X". El botón **Marcar como pagado** marca los anticipos elegidos como **consumidos** (con `billing_id` apuntando a la factura) y deja la **factura en Pagado** automáticamente; el bloque desaparece al no quedar disponibles.
- Anticipos · sección en ficha cliente (PP-15 commit 2): en la pestaña Financiero del cliente se agregó la sección **Anticipos** — card destacada con total disponible (verde 24px) + "N pagos pendientes de facturar" + botón **+ Registrar** (abre el modal con el cliente preseleccionado), y el **Detalle** con ícono (reloj = disponible, check = consumido), monto, fecha/proyecto/nota, badge y folio si está consumido.
- Anticipos · tab en Facturación (PP-15 commit 1): nueva tabla `anticipos` (cliente, monto, fecha, nota, proyecto, sale_id, entity_id, estado disponible/consumido, billing_id). Nueva pestaña **Anticipos** en Facturación con KPIs **Disponible** (verde, en N clientes) / **Consumido** (gris, histórico), filtros Disponibles/Consumidos/Todos, botón **+ Anticipo** y lista **agrupada por cliente** (header con total disponible por cliente + badges Disponible/Consumido y folio si está consumido). Modal **Nuevo anticipo** moderno: Cliente, **Proyecto** (obligatorio, de las ventas/propuestas del cliente), Razón social · Monto · Fecha en una línea, montos rápidos en pills y nota amplia.
- Editar cobro · rediseño (PP-14): el modal de cobro se rehízo con el patrón de campos estándar (label `flabel` #99ABB4 mayúscula, inputs 36px, radios 8px), header propio con X (28px) y footer con Eliminar / Cancelar / Guardar separado por borde. Tipo de cobro pasa a **segmented control** (Honorarios / Reembolso gastos). El select de **Estado** se reduce a Pendiente / Pagado / Anulado (conservando el valor actual si la factura tiene otro estado). El botón "Adjuntar archivo" ahora usa un **ícono SVG de subir** (sin emoji), cambio que aplica a todos los adjuntos.

- Caja Chica · tarjetas KPI al formato oficial de Facturación: fondo con tinte de color según el dato (Saldo a favor verde `#E4F1EA`, Saldo negativo rojo `#FBE9E7`, Sin liquidar teal `#E3EEF3`, Liquidado gris `#E4E8EB`), label en mayúscula muted y cifra en bold del color, con borde — igual que las tarjetas de Facturación (Por cobrar/Programado/Vencido/Cobrado). Estilo compartido entre ambas tabs y responsivo en mobile.
- Header usuarios limited (PP-13): se eliminó el header duplicado del landing de Tareas (saludo/fecha/Imprimir/+Tarea que repetía el header global). Queda solo el header global compartido (mismo formato que admin, sin logo). El menú hamburguesa de los limited ahora incluye **Imprimir** (en la pestaña Tareas, imprime las tareas del usuario) además de **Cerrar sesión**. Se agregó un **FAB "+ Tarea"** flotante (círculo azul abajo a la derecha) que abre el modal de nueva tarea; solo se muestra a usuarios limited reales (`actualRole==='limited'`) en la pestaña Tareas.
- Caja Chica · rediseño (PP-12 commit 3 — tab CAJA): KPIs **SALDO** (verde si ≥0, rojo "Te debemos" si negativo) y **LIQUIDADO** (histórico). Sección **Cajas entregadas** con monto + "Entregado por X · fecha", badge **Activa** (la más reciente) / **Cerrada**, total recibido y botón **+ Nueva Caja**. Sección **Liquidaciones** por período (expandible: detalle + PDF + Correo + Anular) con total liquidado. Nuevo modal **Nueva caja chica** moderno (monto + montos rápidos, "Entregado por" en pills con avatar, fecha rápida, nota). Requiere `ALTER TABLE petty_cash ADD COLUMN delivered_by text` (correr en Supabase). El SALDO sigue el cálculo único `saldoCajaChica` (fondos − todos los gastos).
- Caja Chica · rediseño (PP-12 commit 1 — tabs + pendientes): dos tabs con segmented control **PENDIENTES** / **CAJA** (reemplazan Liquidar/Historial/Mi caja). La tab PENDIENTES ahora filtra automáticamente por `created_by` del usuario, muestra arriba dos chips (**Saldo caja** — verde si ≥0, rojo si negativo — y **Sin liquidar**), pills de categoría (Todos/Notaria/CBR/DO/R. Civil/Otro, con DO y R. Civil abreviados), y filas compactas con checkbox + monto + badge de categoría. Barra inferior con total seleccionado y botón "Liquidar". La selección es estable aunque se cambie el filtro de categoría. (La tab CAJA se rediseña en el commit 3; por ahora reúne la caja y las liquidaciones existentes.)
- Nueva tarea · más compacta en mobile + se quitó "Cambiar cliente": el modal usa clases `qt-head`/`qt-body`/`fld` con una media query (≤560px) que reduce paddings del header/cuerpo y el espacio entre campos, ocupando menos alto en iPhone (en desktop queda igual). Se eliminó el enlace "Cambiar cliente" (el cliente ya está en el título; si te equivocas, cancelas y reabres).
- Nueva tarea · paso de cliente (cuando no viene preseleccionado): en vez de solo un buscador vacío, ahora muestra **tarjetas de clientes recientes** (avatar con iniciales + nº de tareas activas, ordenados por última tarea creada). El buscador sigue arriba y filtra esas tarjetas en vivo; si no hay recientes, invita a buscar. Mientras no se elige cliente, el botón "Enviar tarea" se oculta (solo queda Cancelar) y aparece al tocar una tarjeta. Menos escritura, menos clics.
- Nueva tarea · rediseño (parte 2 — delegar): cuando el responsable de una tarea la abre, aparece un switch **Delegar** abajo; al activarlo elige a quién la traspasa (uno o varios) y un **nuevo plazo**, y el botón pasa a "Delegar". El que delega **sigue siendo el responsable** (no cambia `who`/`assignees`): solo se registra `delegated_to`/`delegated_by`/`delegated_due`/`delegated_at` y se avisa por correo a los delegados. **Regla dura:** el nuevo plazo no puede exceder el original + 3 días (el campo lo limita y el botón se bloquea si se pasa). A quien asignó (y en las tarjetas/preview) le aparece "X la delegó a Y · vence Z", y a los delegados la tarea les aparece en su lista. El responsable que recibe puede **editar su tarea normalmente** (descripción, plazo, etc.) y además tiene el switch Delegar abajo; el botón cambia a "Delegar" solo cuando lo activa. El tope de +3 días se calcula sobre el plazo original asignado (no sobre ediciones propias).
- Nueva tarea · rediseño (parte 1 — crear): el modal abre con `Nueva tarea | Cliente` en el título (sin tarjeta "Cambiar"; el buscador de cliente solo aparece si no viene preseleccionado). Nuevos campos dinámicos: **Razón social** (desplegable con la principal por defecto; solo aparece si el cliente tiene 2+ RS, si tiene una se asume) al costado de **Proyecto**; **Subproyecto** como chips de los existentes + "Nuevo", visible solo con 2+ RS. Proyecto es **obligatorio** y subproyecto obligatorio cuando hay 2+ RS. Descripción de la tarea debajo. **Responsables múltiples** como pills con iniciales (multi-selección) y **Plazo** con pills rápidos (Hoy / Mañana / En 7 días / Otra fecha). Botón "Enviar tarea". Se guardan `entity_id` y `assignees`; `who` queda como responsable principal. Todas las vistas que decidían "es mía" (Mis tareas, calendario, impresión, dashboard por persona) ahora consideran a todos los responsables. La delegación (traspasar una tarea recibida) llega en la parte 2.
- Editar cliente · rediseño (parte 2): nueva sección **Contactos** colapsable dentro de la ficha (cerrada por defecto, muestra el conteo). Lista las personas de contacto del cliente con avatar de iniciales y permite agregar/editar/eliminar manualmente (nombre, cargo, email, teléfono — tabla `contacts`). Cada contacto trae un botón **Exportar** que descarga un `.vcf` (vCard); con 2+ contactos aparece "Exportar todos" en un solo archivo. En iPhone, abrir el `.vcf` ofrece "Agregar a Contactos" — es la única vía para llevarlos a la libreta, ya que Safari iOS no permite importar desde la libreta hacia la web.
- Editar cliente · rediseño (parte 1): la ficha abre con una cabecera de identidad (avatar con la inicial, nombre destacado en azul corporativo y chips de Estado / iniciales del responsable / Interno). La sección "Tareas" se eliminó de la ficha y se reemplazó por **Razones sociales**: bajo las RS ya vinculadas, ahora se listan todas las razones sociales **sin cliente asignado** con un botón "+ Asignar" que las vincula a este cliente al instante (y las quita de la lista de huérfanas). Los usuarios limited pueden editar la ficha igual que admin. Pendiente parte 2: contactos colapsables + exportar contacto (.vcf).
- SII · RCV operativo + ingreso de huérfanas: corregida la consulta del Registro de Ventas (era `getDetalleCompraVenta` → 404). El facadeService del SII exige token en DOS cookies (`TOKEN` y `CSESSIONID`, mismo valor) y `codTipoDoc` por tipo específico (con `0` da error `cdvc17.05.04`); ahora `rcv.ts` consulta DTE 33 y 34 en paralelo (`codRespuesta` 99 = sin documentos, no error). Validado contra producción (mayo 2026: 28 facturas, junio: 20). En el modal SII, cada factura del SII "sin registro" trae un botón **Ingresar** que la crea en `billing` (Pendiente, con folio/monto/fecha del SII): resuelve el cliente por RUT/nombre como la carga de PDFs, reconcilia la Programada equivalente y **aprende el vínculo RUT→cliente** (no vuelve a preguntar); si no reconoce al cliente, la deja sin asignar para hacerlo en Facturación. La sincronización sigue siendo solo lectura; el ingreso es explícito por botón.
- Integración SII FASE 1 (lectura RCV + conciliación): Edge Function `sii-sync` (Deno) con danza de autenticación completa (semilla → firma XMLDSIG RSA-SHA1 con node-forge y C14N por construcción → token, cache 55 min, reintentos backoff 1s/4s/16s, timeout 30s, renovación si expira a mitad de operación); consulta del Registro de Ventas (www4 facadeService, DTE 33/34) y match contra `billing`: Programada → Pendiente solo con match único (RUT en cascada receptor_rut→entidad→cliente, monto ±1%, due del mes), ambiguas y sin-match se reportan sin tocar nada; jamás crea ni borra cobros. Solo admins (JWT verificado). Frontend: botón "SII" en Facturación + modal con selector de mes, "Probar conexión" (test-auth) y resultados por sección en paleta corporativa. Requiere: ALTER TABLE (sii_synced_at, sii_tipo_dte), secretos SII_* y deploy de la función. FASE 2 (emisión DTE) queda preparada con TODOs, no implementada.

## 2026-06-11
- Rendición al cliente vía Gmail API (preparado, sin activar): generación de PDF de la rendición con jsPDF (`rendicionPdfBase64`) y envío con el PDF ADJUNTO usando la API de Gmail (`sendGmailWithPdf`); texto del correo reescrito en tono de firma de abogados, con datos de transferencia al pie. Mientras no esté habilitado el scope `gmail.send`, el botón cae al fallback de Gmail compose (con el nuevo texto, sin adjunto) — no se tocó el login. PARA ACTIVAR EL ADJUNTO: (1) habilitar `gmail.send` en el OAuth consent screen de Google Cloud Console; (2) agregar el scope al login en `supabase.js` (`scopes: '…/drive …/gmail.send'`); (3) cada usuario reconecta Google una vez.
- Dashboard · KPIs unificados: sistema de tarjeta consistente en todos los bloques — acento de color lateral por celda (P4) + switch global UF/CLP en el encabezado del dashboard (cambia Meta, Facturación, Cash Flow y bloque mensual a la vez) + cifras CLP abreviadas (`$216,2M`). Helpers globales `fmtShort` (CLP abreviado) y `fmtUFk` (UF sin decimales). El gráfico "Ventas por mes" conserva su propio toggle UF/CLP.
- Robustez (backlog de auditoría): (1) import de facturas PDF/Drive ahora refresca el listado al terminar (`onImported` hace refetch de billing) — ya no hay que recargar. (2) Errores visibles en guardados de dinero: la rendición de cliente inserta la rendición ANTES de marcar los gastos (evita gastos huérfanos si falla) y avisa si algún gasto no se marcó; el cambio de tarifa/formato chequea el `delete` de cuotas antes de crear las nuevas (evita cobros duplicados) y avisa en el recálculo. (3) `reconcileProgramada` acota el match a ±45 días de la emisión para no borrar una cuota programada lejana de otra venta del mismo cliente con igual monto. (Drive→BD e import de clientes ya manejaban el error.)
- Ficha de cliente simplificada: en Contacto/Identificación "Razón social" → "Nombre cliente"; se eliminan Tipo de entidad, Nombre de fantasía, Giro y toda la sección "Datos de contacto" (quedaba en blanco). En Financiero se eliminan "Razones sociales asociadas" (duplicaba a Contacto) y "Datos de facturación" — las razones sociales quedan solo en Contacto. Campos guardables de Financiero reducidos a abogado responsable y notas internas.
- Dashboard · Meta rediseñada (grid 2×2): la meta UF/pesos sale de la etiqueta y pasa a una celda destacada (borde y fondo azul accent) en la posición superior izquierda; Costo arriba a la derecha, Bruto y Neto abajo — se llena el espacio en blanco que dejaba el grid de 2 columnas con 3 celdas. Etiqueta queda solo "Meta {año}". Tasa de cobro (Facturación) centrada.
- Dashboard · Facturación rediseñada: título con espacio arriba (ya no pegado a la caja anterior); las tres métricas (Facturado, Cobrado, Tasa de cobro) en una sola fila como tarjetas iguales — la Tasa de cobro deja de ser texto suelto y pasa a celda con el % en grande y color semántico. Montos en formato corto ($52,4M) para que las tres quepan holgadas en iPhone; el monto exacto queda en el `title` (hover). Terceros/Neto firma se mantienen en una segunda fila cuando aplican.
- Dashboard: secciones de lista contenidas en tarjeta (se elimina el "flotando"). "Tareas del estudio" pasa de cards de tarea sueltas sobre el fondo a una tarjeta contenedora con las tareas como filas (barra de urgencia a la izquierda + separador fino), incluida la sección Terminadas. "Cobranza" (clientes morosos) y "Costos de oficina del mes" (gastos) ahora viven dentro de su tarjeta. Borde gris de tarea terminada #ccc → #99ABB4 (paleta).
- Dashboard admin uniformado (sistema único de sección): cada sección = etiqueta fuera + tarjeta blanca envolvente (`#fff`/borde `#E4E8EB`/radio 12) + celdas KPI con fondo neutro único `#F5F7F9`, con el color solo en el número. El bloque mensual ("junio 2026") y Facturación dejan de tener los KPIs flotando y pasan a tarjeta; el título mensual va de 13px/accent a etiqueta 11px/muted/mayúsculas; celdas de Meta, Cobranza y bloque mensual unifican fondo a `#F5F7F9` (se retira el arcoíris #FFF8E1/#E6F1FB/#EEF3E3/#E4F1EA/#F0F4F8/#F7F2EC en el dashboard); montos de Facturación a 15px. Ventas por mes y Cash Flow ya cumplían el molde.
- Criterio de títulos de sección (KPI dashboard): unificación — el título de sección va SIEMPRE fuera del recuadro, como etiqueta (11px/600/`C.muted`/mayúsculas/letterSpacing .5); el recuadro envuelve solo el contenido. Se sacó el título de "Meta" y "Cash Flow Forecast" de sus tarjetas (la fecha de proyección y la meta UF/CLP pasan a la etiqueta; el selector 3M/6M/12M va ahora en la fila de la etiqueta). Títulos de la ficha de cliente (Gastos y Fondos, Rendiciones realizadas, Tareas) unificados al mismo estilo. Niveles 1 (título de pantalla, 20px DM Sans) y 3 (subbloques colapsables) sin cambios.

## 2026-06-11
- Paleta corporativa (estado Programado): el KPI de facturación deja el púrpura #5B4B8A/#EEEAF3 y pasa a #537281 sobre #E4E8EB, consistente con el resto de la app (que ya pintaba "Programado" en azul-gris). Se preservan a propósito los tintes categóricos (áreas legales, tipos de documento), que son multicolor por diseño.
- Paleta corporativa (ámbar de aviso): se oficializa `C.soon` #C77F18 como único color cálido permitido. Consolidación de los tonos cálidos sueltos hacia él: #854F0B, #8B5C2A, #C2761F, #C06A00, #E8A640 → #C77F18 (textos/acentos de Propuesta/Prospecto/Borrador/próximo a vencer/costo terceros). Gris "terminado" #A8A8A8 → #99ABB4 (AZUL3). Se preservan #E8CC6A/#FFFBF0 (esquema propio del banner "Recuperar borrador") y #F2E9DE (color categórico de áreas legales, no de estado).
- Paleta corporativa (núcleo): objeto `C` alineado al CLAUDE.md — `muted` #8A8A8A→#537281, `overdue`/`urgent` #C2382B→#E24B4A, `normal` #2E7D55→#1D9E75, `border` #E4E4E4→#E4E8EB. Además unificación de hex sueltos que duplicaban esos roles en toda la app (incl. plantillas PDF) y dos colores 1:1 fuera de paleta: #A32D2D→#E24B4A (saldo negativo) y #56616B→#537281 (texto de badges). Pendiente: estados cálidos (ámbar/marrón/naranja de Propuesta/Prospecto/Borrador/próximo a vencer/costo terceros) — la paleta oficial no tiene ámbar, requiere decisión de color de aviso.

## 2026-06-11
- 5 mejoras dashboard/propuestas: (1) "Subir archivo" + "Drive" en header de Nueva propuesta — Drive muestra archivos PDF/Word/Google Docs modificados en últimos 15 días, selección descarga y pasa a extractFromFile. (2) Matching IA por tokens: ≥2 palabras en común = match; si múltiples candidatos muestra lista para elegir; si ninguno: buscar cliente manual o crear Prospecto; "Nombre de Fantasía" reemplazado por "Razón Social". (3) Gestión Caja Chica en dashboard admin muestra solo usuarios limited (Martín, Martina, Rodrigo). (4) Terminadas en DashboardTasks: acordeón maestro que colapsa todo (incluso nombres); sección renombrada "Gestión Caja Chica". (5) CashflowProjection movida a después de VentasPorMes, siempre visible, sección "CASH FLOW FORECAST" con subtítulo dinámico "Proyección al [día] [DD] de [mes] de [YYYY]".

## 2026-06-11
- Tanda 3: (GAPS 5) Adjuntos en facturas — tabla `billing_attachments` creada en Supabase; BillingForm carga y muestra el componente Attachments al editar un cobro existente; estado `billingAttachments` cargado en boot junto a los demás adjuntos. (GAPS 1) Cruce reembolso↔rendición — al completar una rendición de cliente se ofrece crear automáticamente un cobro de tipo "Reembolso gastos" en Facturación con monto, cliente y notas del período; aplica desde ExpensesView y ClientsView.

## 2026-06-11
- Pipeline de Propuestas: header con dos pills "Nueva venta" (ghost) y "Nueva propuesta" (accent); selector de estado ampliado (Activo, Propuesta, Borrador, Rechazada, Terminado, Pausado); cuando el filtro es "Propuesta" se muestran 6 KPIs en grilla 3×2 (Pipeline UF, Pendientes, Conversión, Descuento prom., Rechazadas, Valor rechazado); tarjetas de propuesta con días pendiente, borde naranja si >14 días y botones pill "Rechazar" (rojo suave) y "Activar" (verde suave); "Activar" abre SaleForm con datos pre-llenados y botón "Activar propuesta" en verde que guarda proposal_amount_uf/clp + activated_at + status=Activo; "Rechazar" actualiza status=Rechazada sin abrir modal; Propuesta y Rechazada excluidas de todos los KPIs y totales (dashboard, gráfico, ficha cliente, reporte).

## 2026-06-11
- SaleForm "Cargar desde propuesta" [2-4/4]: zona de arrastre PDF/Word (máx 10 MB) con spinner "Leyendo propuesta con IA...", extracción de texto (pdfjs para PDF, mammoth para docx), llamada a Claude API (`claude-sonnet-4-20250514`) para extraer JSON con cliente, proyecto, área, honorario, forma de cobro y notas; modal de asociación de cliente (CASO A: cliente encontrado por nombre/RUT con opción de asociar o crear nuevo; CASO B: crear nuevo pre-rellenado); pre-llenado automático del formulario con badge "IA" (#E4E8EB/#537281) en los campos llenados por IA.

## 2026-06-11
- Rediseño SaleForm: (1) NUEVA VENTA ahora muestra headers de sección uppercase — "Contexto", "Estado y período", "Honorarios", "Costos de terceros", "Forma de cobro" — para orientar rápido al usuario; (2) campo Honorarios unificado en una sola fila: input ancho para 8 dígitos + selector UF/CLP (ancho justo para "CLP") + valor UF del día inline auto-rellenado desde `useUF()`; (3) VENTA GUARDADA reemplaza los campos de honorarios/costos/cobro/notas por bloque "CONDICIONES REGISTRADAS" con 4 filas colapsadas que muestran los valores actuales — la fila Notas es expandible con click para editar directo; el panel "Modificar cobro" permanece para cambios con historial.

## 2026-06-11
- Fix "modificar tarifa/propuesta" (recálculo de programadas): antes `handleSaveTariff` le ponía el honorario completo a TODAS las facturas programadas, ignorando la forma de pago — solo era correcto para "mensual recurrente"; en cuotas iguales inflaba el total ×N, en porcentaje ignoraba los %, en personalizada perdía los montos. Además, en ventas UF sin Valor UF el recálculo se saltaba (no en CLP). Ahora se ESCALA cada cuota programada por la razón (nuevo honorario / honorario anterior): respeta la distribución de cuotas / % / personalizada / mensual, y queda igual en UF y CLP (la razón no tiene unidades, ya no requiere Valor UF). El honorario anterior se toma de la última tarifa registrada o, si no hay, del monto base de la venta; si no se puede determinar, avisa y no toca las programadas.

## 2026-06-11
- Documento de rendición al cliente, rediseño + unificación (cierra bug #6 "PDF triplicado"): se creó una fuente única `rendicionDocHtml` que ahora usan tanto el "Ver PDF" del historial (`rendicionPdfHtml`) como el envío desde RendicionModal (`generatePDFContent`); antes eran dos copias casi idénticas que podían divergir. Cambios de diseño aprobados: (1) logo "Liberona Escala Abogados" en blanco sobre el header azul (`#003C50`) en vez del wordmark de texto; (2) tipografía uniformada (de 7 tamaños a una escala 9/10/11px + nombre del cliente 14px; KPIs 16→13px); (3) el título del mensaje de cobro "Saldo pendiente — transferir a Liberona Escala" pasa de azul 13px a grafito `#3D3D3D` 11px, igual que el resto de la caja. El logo se importa desde `src/le-logo-blanco.png` y se incrusta como data URI (`assetsInlineLimit` subido en vite.config) para que imprima/exporte sin depender de la red. Cálculos de montos/saldo sin cambios.

## 2026-06-10
- Proyección flujo de caja: los puntos del gráfico ahora son interactivos. Al pasar por encima (desktop) o tocar (mobile) un punto se muestra un tooltip con el monto total de ese mes; el punto se agranda y el mes queda resaltado. Área de toque ampliada para mobile.

## 2026-06-10
- Deuda técnica (#4): se eliminó el azul `#185FA5` (fuera de paleta) y se reemplazó por el azul corporativo `#003C50` en todos sus usos: badge "Notaría" (texto sobre fondo #E6F1FB), checkboxes seleccionados (borde/fondo) en caja chica y ficha de cliente, color del usuario Cristóbal y botón de adjunto. Solo cambia el tono de azul; layout y contraste se mantienen.

## 2026-06-10
- Deuda técnica (#5): unificación de los formateadores de dinero. Antes había ~9 definiciones locales repetidas del mismo formato CLP (`'$'+Math.abs(n).toLocaleString('es-CL')`) más redefiniciones locales de Intl currency y UF. Ahora hay una sola fuente: `fmt` (Intl currency con signo), `fmtN` (monto CLP absoluto sin signo, el llamador agrega el +/-) y `fmtUF`, todas globales; los antiguos `fmtCLP`, `money`, `fmtUFN` y la redefinición de `fmtN`/Intl en el PDF del Dashboard quedaron como alias de esas fuentes. Cambio sin efecto visible: los textos mostrados son idénticos (el PDF del Dashboard conserva su Intl con signo vía alias a `fmt`). Se mantiene aparte solo el `fmtN` de `UFStamp` porque redondea el valor UF (necesidad legítima distinta).

## 2026-06-10
- Dashboard, "Proyección flujo de caja" (P3): rediseño del componente `CashflowProjection`. Header con título + toggles 3M/6M/12M; fila de totales en 3 celdas (Total / Emitido azul #003C50 / Programado); gráfico de línea del total mensual con área de relleno en gradiente #003C50 semitransparente, puntos coloreados (emitido #003C50 / programado #99ABB4) y línea punteada vertical marcando "Hoy"; tabla Mes/Estado/Monto con badges (Vencido #FCEBEB/#A32D2D, Emitido #E4E8EB/#003C50, Programado gris) dentro de un acordeón "Detalle" colapsado por defecto. El toggle actualiza gráfico y tabla. Se quitó el gráfico de barras anterior y el mensaje rojo de vencidos (los vencidos siguen visibles como badge en el Detalle). Mismos cálculos de emitido/programado/vencido que la versión previa. Paleta corporativa, sin emojis, layout mobile-safe.

## 2026-06-10
- Dashboard, "Por facturar este mes" (P7): se reemplazó el acordeón (mes → cliente → razón social) por 3 KPIs en una fila, con título dinámico del mes ("JUNIO 2026"). Emitidas (#F5F7F9, N de facturas + monto CLP), Por facturar (#FFF8E1, N en ámbar #B8860B + monto CLP) y Total mes (#E6F1FB, total en UF azul corporativo #003C50 + N de facturas). Labels #99ABB4. La contabilidad usa la MISMA fórmula que el checklist de Facturación (single source of truth): universo = facturas con vencimiento (due) en el mes; emitida = status != Programada; "por facturar" = Programada; Emitidas + Por facturar = Total. Las pagadas quedan fuera del universo, igual que en el checklist. Sin botón ni lista de clientes. Layout mobile-safe (grid minmax(0,1fr), sin wrap).

## 2026-06-10
- Archivo automático de tareas (PASO 2): pill "Archivadas (N)" al final de la fila de filtros de la vista Tareas (borde punteado #99ABB4 inactiva, sólida #003C50 activa). Al activarla se muestran solo las tareas archivadas (con opacidad reducida y sin borde de urgencia, vía `done`), ocultando Activas/Asignadas/Terminadas; al desactivarla vuelve la vista normal. La pill solo aparece si hay archivadas (o si está activa).

## 2026-06-10
- Archivo automático de tareas (PASO 1): nueva columna `tasks.completed_at` (SQL aparte). Al marcar una tarea como Terminada se sella `completed_at`; al reabrirla se limpia (en `handleSaveTask` y en el toggle de la vista de tareas de cliente). Constante `DAYS_TO_ARCHIVE = 15` y helper `isTaskArchived`: una tarea Terminada hace más de 15 días (o sin `completed_at`, las históricas) se considera archivada. La sección "Terminadas" de la vista Tareas ahora muestra solo las terminadas recientes (no archivadas). No se borra nada.

## 2026-06-10
- Caja chica, Historial: botón "Anular" por liquidación (antes la liquidación del usuario era irreversible). Con confirmación, revierte los gastos de esa liquidación (`rendered_at`/`render_id`/`rendered_by` a null) devolviéndolos a la pestaña Liquidar como pendientes, y borra la fila en `rendiciones` (hard delete, mismo criterio que el anular de rendiciones de cliente ya existente). No afecta el saldo (`saldoCajaChica` resta todos los gastos por igual): solo deshace la agrupación. Actualiza el estado local sin recargar.

## 2026-06-10
- Categoría Notaría = pago cliente automático: al guardar un gasto con categoría Notaría se setea `paid_by_client=true` siempre, en el formulario manual (GastosForm) y en la carga masiva por Excel (CargaMasivaModal). Así Notaría se rinde al cliente pero nunca descuenta la caja chica del usuario (`saldoCajaChica` ya excluía `paid_by_client`). En el formulario, al elegir Notaría el switch "Pago Cliente" se enciende y se bloquea con un hint explicativo. Se agregó soporte `disabled` al componente `Switch` (retrocompatible).

## 2026-06-10
- Ficha de cliente, KPI "Vendido UF": ahora usa el helper único `ventaUF()` (recurrentes ×12 + ventas en CLP convertidas a UF con el valor del día), igual que el Dashboard y la vista Ventas. Antes hacía una suma cruda de `amount_uf` que no anualizaba los recurrentes ni contaba las ventas en CLP, por lo que el "Vendido" de la ficha quedaba por debajo de lo que el Dashboard contaba para ese cliente. Se sumó `useUF()` a `ClientFicha`. Nota: el par Dashboard↔vista Ventas ya estaba unificado; el PDF del Dashboard (sección Ventas) NO se tocó porque está filtrado por período y ahí el ×12 sería incorrecto.

## 2026-06-10
- Fix timezone en `fmtD` (CajaChicaView, lista de liquidados): parseaba `e.date` (`YYYY-MM-DD`) con `new Date(iso)`, que se interpreta como medianoche UTC y en Chile (UTC-4) mostraba el día anterior. Ahora usa `new Date(iso+'T12:00')`, igual que `fmtDate` y `fmtFecha`. El resto de los displays de fecha ya estaban correctos (timestamps completos, `new Date()` actual o `T12:00`/`T00:00:00`).

## 2026-06-10
- Dashboard, Top de áreas (`byArea`): se corrige la cifra por área para que use el helper único `ventaUF()` (`ufDeVenta`) en vez de `amount_uf` crudo. Antes ignoraba el ×12 de las ventas recurrentes y las ventas en CLP, por lo que las áreas se mostraban hasta ~12x más bajas y no cuadraban con el total vendido del Dashboard. Ahora los subtotales por área reconcilian con `vendidoBrutoUF`. Sin cambios de UI.

## 2026-06-10
- Rediseño del modal "Registrar gastos" (GastosForm), igual desde la ficha de cliente y desde "+ Gastos" global:
  - Flujo: desde la ficha entra directo al formulario; desde el botón global muestra primero el buscador de cliente y luego el mismo formulario. Wrapper de modal propio (sin el header del Modal compartido).
  - Header de 2 líneas: nombre del cliente en gris (#99ABB4, 11px, uppercase) + cierre a la derecha; "Registrar gastos" en #003C50 16px bold. Sin pill del cliente.
  - Razón social: pre-poblada con la primera RS, dropdown propio con chevron integrado sobre #f5f7f9, sin label ni RUT; la RS elegida queda marcada.
  - Proyecto: label "PROYECTO", pre-poblado con el más reciente, dropdown con proyectos existentes + "+ Nuevo proyecto..." (verde) o texto libre si no hay.
  - Filas en 2 líneas: Tipo + Fecha + "Pago Cliente" (switch) + eliminar (papelera discreta, sin x); Descripción (ancho completo) + Monto.
  - Switch "Pago Cliente" (`expenses.paid_by_client`): el gasto se rinde al cliente pero NO descuenta la caja chica del usuario; `saldoCajaChica` excluye los gastos con `paid_by_client=true`.

## 2026-06-10
- Rediseño del flujo de rendición a clientes y de Gastos y Fondos (4 cambios):
  - Lista Gastos y Fondos: bajo cada cliente, sus razones sociales con saldo individual (verde >0 / rojo <=0); el total grande sigue siendo la suma. Helper `rsBalances`.
  - Detalle cliente con 1 RS: razón social + RUT una sola vez en el header (fuera de las filas); KPIs en rectángulos redondeados con labels grises (#99ABB4) y reglas de color (Fondos verde/amarillo/rojo, Gastos rojo, Saldo verde/rojo); cada gasto con ícono de adjunto (subida gris o clip azul con contador) que abre el uploader (Attachments); barra inferior "Total a rendir" + "Rendir al cliente" (#1D9E75), o "Sin gastos por rendir".
  - Detalle cliente con 2+ RS: header solo con el nombre; KPIs totales; acordeón por RS con checkbox (incluir en la rendición) + chevron + nombre/RUT/saldo; al expandir, los movimientos de esa RS; barra inferior con la(s) RS seleccionada(s) y su monto; "Rendir al cliente" abre el modal con esas RS.
  - RendicionModal: header con la razón social + RUT seleccionada; KPIs redondeados (Fondos verde/amarillo/rojo, Ya rendido neutro #F5F7F9/#537281, Saldo verde/rojo, labels grises); gastos y fondos filtrados por la RS seleccionada; campo "Dirigido a" (antes "Atención") precargado del valor guardado con hint "Guardado de rendición anterior", que se persiste en `contacts` al registrar para reutilizarlo. El documento usa la RS seleccionada y muestra "Dirigido a:".

## 2026-06-10
- Carga masiva: corrección de categorías y asignación de razón social.
  - El dropdown de Categoría de la plantilla y el selector de la vista previa usan solo las categorías válidas del sistema (Notaria, CBR, Diario Oficial, Otro); las filas con categorías fuera de la lista se normalizan a "Otro" (sin acentos/case). Filas de ejemplo de la plantilla corregidas.
  - Asignación de razón social en la carga: si el cliente tiene una sola razón social se asigna automáticamente (`entity_id`); si tiene más de una, la fila queda "por revisar" (amarillo) con un selector en la vista previa para elegirla antes de cargar. `guardar` envía el `entity_id`. `CargaMasivaModal` recibe `clientEntities`.
  - Hoja Instrucciones: notas sobre asignación de razón social (1 → automática, varias → elegir en preview) y que no se pueden crear categorías nuevas desde el Excel.

## 2026-06-10
- Checklist de facturación del mes (Facturación, admin): nuevo tab "Checklist" con sección "Facturar en [Mes] [Año]". Filtros en una fila (selector mes/año + Todos/Pendientes/Emitidos) y 3 KPIs en vivo (Por facturar #854F0B / Ya emitidas #0F6E56 / Total mes en UF). Lista tipo checklist de las facturas con vencimiento en el mes (programadas + emitidas): checkbox a la izquierda que marca/desmarca como emitida, nombre del cliente, concepto + vencimiento y monto a la derecha; los items emitidos quedan tachados y con opacidad reducida. Footer con "X de Y emitidas" y botón "Descargar Excel" (Cliente / Concepto / Monto / Estado / Vencimiento). Marcar emite la programada (status Pendiente + fecha de emisión) y desmarcar la vuelve a Programada, actualizando los KPIs en tiempo real. Las pagadas se excluyen del checklist (para no perder el pago al desmarcar). Sin emojis (checkbox dibujado en CSS).

## 2026-06-10
- Carga masiva de gastos/fondos (CargaMasivaModal) reforzada en 3 partes:
  - Plantilla Excel modelo descargable (ExcelJS por CDN): hojas Gastos / Fondos / Instrucciones, con encabezado en negrita + fondo gris, ejemplos, Fecha dd-mm-yyyy, Monto sin decimales, validación desplegable de Categoría y comentarios en RUT/Monto.
  - Parser robusto: lee la hoja según el tipo elegido (Gastos/Fondos); ya no descarta filas en silencio (monto vacío/negativo/0 quedan como error visible, el negativo ya no se vuelve positivo); detecta duplicados (RUT+fecha+monto+concepto) con aviso; al cargar solo sube las filas listas y muestra las que fallan al insertar con su motivo.
  - Vista previa por estado: filas Lista (blanco), Revisar (amarillo #FFF8EC con selector de cliente) y Error (rojo #FCEBEB con motivo); Concepto y Categoría editables inline; contador "X listas · Y por revisar · Z errores"; botón "Cargar X filas listas" que sube solo las que tienen cliente y sin errores.

## 2026-06-10
- Rediseño del documento de rendición de gastos (RendicionModal, `generatePDFContent`): formato carta (máx. 816px), encabezado #003C50 con wordmark de texto "LIBERONA ESCALA / ABOGADOS" (no existe logo png) a la izquierda y razón social del cliente (blanco) + RUT (#99ABB4) a la derecha; barra gris #E4E8EB con Período · Emisión · N° gastos (separados por línea vertical) y "Atención: [contacto]" a la derecha; tabla Fecha/Concepto/Categoría/Monto con badges (Notaría #E6F1FB/#185FA5, Transporte #E1F5EE/#0F6E56, resto gris) y fila Total con borde superior 1.5px #003C50; sección "Fondos recibidos"; caja resumen oscura #003C50 con Fondos/Gastos/Saldo. Caja de saldo condicional: si gastamos más que lo recibido (cliente debe reponer) → caja #FCEBEB/#F7C1C1 "transferir a Liberona Escala" con datos bancarios; si hay saldo a favor del cliente → caja #E4E8EB con texto de devolución a administracion@leabogados.cl; si saldo 0 → sin caja. Pie con dirección/leabogados.cl y "Rendición de gastos · Período". @media print: oculta botones, color-adjust exact, page-break-inside avoid en la caja de saldo y corte natural entre filas.
- Campo "Atención" en el modal: precargado con el primer contacto de la tabla `contacts`; si el cliente no tiene contactos, input editable que al confirmar (blur/Enter) crea un contacto nuevo para ese `client_id`. Se quitó el mailto automático que navegaba fuera de la app al generar (el envío por correo sigue disponible en el flujo de rendiciones existente). Sin emojis.

## 2026-06-10
- Limpieza global de emojis: se reemplazaron todos los emojis pictográficos y dingbats decorativos de la app por texto descriptivo corto o se eliminaron (📎→"Adjunto", ✓ Rendido→"Rendido", ✎→"Editar", 🗑→"Eliminar", 👥→"Usuarios", 📅→"Agendar", 📄/📋 eliminados, ✉ eliminado de botones, ⚠ → texto o "(!)", logs de import con ✓/✗/⚠/⏭/✅/❌ → "Error:"/"Aviso:"/"Omitido:"/sin símbolo). Se conserva la tipografía funcional que no es emoji: flechas (←→↑↓↔), chevrons/expanders (▾▸▶), íconos del BottomNav y los ticks internos de checkboxes. Sin cambios de lógica ni estilos.
- Seguridad: los usuarios limited ya no pueden acceder a la vista admin. Se separó el rol real inmutable (`actualRole`, de user_roles) de la vista actual (`userRole`); los botones "Vista Team"/"← Vista Admin" solo se renderizan para admin real, y un guard de navegación redirige a Tareas si una sesión limited queda en un tab admin (dashboard/ventas/facturación).

## 2026-06-10
- Fix saldo caja chica: `saldoCajaChica` vuelve a restar TODOS los gastos del usuario (no solo los no liquidados). El cambio del PASO 4 que excluía los liquidados hacía subir el saldo artificialmente al liquidar (los fondos seguían sumando completos mientras los gastos liquidados salían de la resta). Ahora liquidar es neutro para el saldo: queda en $0 si fondos=gastos, o en el remanente si hubo diferencia, y solo sube cuando se ingresa un fondo nuevo. El historial "Gastos liquidados" y la marca individual `rendered_at` se mantienen; lo que cambia es solo el cálculo del saldo disponible.

## 2026-06-10
- Liquidación de caja chica con confirmación previa (reutiliza `expenses.rendered_at` como marca individual de liquidado, sin columna nueva):
  - **Popup de confirmación** antes de ejecutar: encabezado "Resumen de liquidación — [usuario] · [período]", tabla detallada (Fecha / Concepto · Cliente · Categoría / Monto) con total al pie, sección de envío (campo "Enviar a" pre-rellenado con el email del usuario logueado + "CC" opcional), y botones "✉ Enviar y liquidar" / "Solo liquidar" / "Cancelar". Antes el botón ejecutaba directo sin confirmar y el correo iba hardcodeado a ee@/cl@.
  - **Confirmación post-liquidación**: "✓ Liquidación registrada — N gastos liquidados por $XXX" (+ "✉ Correo preparado…" si se envió), auto-cierre 7s.
  - **Saldo y KPIs** de caja chica ahora consideran solo gastos sin liquidar (helper único `saldoCajaChica` excluye `rendered_at`); al liquidar, el gasto deja de descontar del saldo disponible.
  - **Historial "Gastos liquidados"** colapsado en la pestaña Liquidar, con la fecha en que cada gasto fue liquidado.
  - Fix: `handleLiquidar` ahora actualiza el estado local de `expenses` (antes los liquidados seguían en la lista de pendientes hasta recargar). App pasa `currentUserEmail` y `setExpenses` a `CajaChicaView`.

## 2026-06-10
- Ficha de cliente rediseñada en tabs (admin y limited), PASO 2 (Documentos queda para una segunda etapa):
  - **Resumen**: el contenido operativo actual de cada ficha (admin: KPIs/ventas/cobros/gastos+fondos/rendiciones/tareas; limited: fondos/gastos/saldo/rendiciones/tareas) queda bajo este tab. Barra de tabs compartida `FichaTabs` con bloqueo por rol (limited ve Financiero/Documentos con candado).
  - **Contacto** (componente reutilizable `ContactoTab`, admin y limited): Identificación (razón social, RUT, tipo de entidad, nombre de fantasía, giro) + Datos de contacto (email, teléfono, dirección, comuna, sitio web) con edición inline (botón "Guardar cambios" solo si hay cambios) sobre nuevas columnas de `clients`; Personas de contacto con CRUD sobre la tabla `contacts` (avatar de iniciales, nombre, cargo, email, teléfono). La sugerencia inteligente desde facturas PDF queda para PASO 3.
  - **Financiero** (`FinancieroTab`, solo admin; limited ve candado): 3 KPIs (facturado/cobrado/por cobrar), historial de facturación por año (emitidas, concepto/monto/estado), razones sociales asociadas, datos de facturación (condición de pago, moneda, banco, N° cuenta) y relación con el estudio (cliente desde, tipo de servicio, abogado responsable, notas internas) con edición inline.
  - App: handler `handleUpdateClientFields(id,patch)` para UPDATE parcial de `clients` desde la ficha sin abrir el modal.

## 2026-06-10
- Modal de nueva tarea (admin y limited): se muestra directamente la sección de Archivos (igual que al editar), reemplazando el aviso "Podrás adjuntar...". Al adjuntar el primer archivo en una tarea nueva, la tarea se crea silenciosamente en Supabase (sin cerrar el modal ni avisar) para obtener su id y habilitar el uploader; "Guardar" hace UPDATE de ese borrador (o INSERT normal si no se adjuntó nada) y notifica como tarea nueva; cancelar/cerrar elimina el borrador para no dejar huérfanos. `Attachments` acepta `ensureEntityId` para crear el id de forma diferida.

## 2026-06-10
- Vista Clientes limited: agregados los recuadros de filtro Activos / Terminados / Todos (mismo estilo y posición que admin), vía componente compartido `ClientStatusTabs` (extraído del markup inline de ClientsView, sin duplicar). La tarjeta limited se mantiene sin info financiera de admin (no muestra ventas activas, por cobrar ni fondos del admin); conserva solo nombre, tipo y su saldo operativo de fondos.

## 2026-06-10
- Cliente interno (gastos de oficina): checkbox "Cliente interno" en ClientForm (`clients.is_internal`). El cliente interno se excluye del contador de clientes y de "Fondos negativos" del Dashboard; las cifras de negocio ya lo excluyen solas (no tiene ventas/facturas). Sigue visible en la lista (chip "Interno") y disponible para imputar gastos y rendir.
- Subcategoría libre cuando la categoría de gasto es "Otro": campo con autocomplete (subcategorías ya usadas) en GastosForm y ExpenseEditForm, guardado en `expenses.subcategory` y mostrado en la lista de gastos.
- Bloque "Costos de oficina del mes" en el Dashboard admin: acordeón con total del mes, detalle por gasto y filtro de período (mes), leyendo los gastos del cliente interno.

## 2026-06-10
- Modal de tarea (QuickTaskForm, único en Inicio/Clientes/Tareas) simplificado: se quitaron de la UI las secciones Subtareas, Comentarios y Links. Queda Cliente, Tarea, Proyecto, Subproyecto, Responsable, Plazo, Archivos. Los datos en task_comments/task_links/subtasks NO se borran (solo se ocultó la UI; `subtasks` sale del payload y el upsert preserva la columna). En tarea nueva se avisa que se podrá adjuntar tras guardar.
- Inicio (admin): click en una tarea abre la vista previa de solo lectura (mismo TaskPreview que limited) con Editar / Marcar terminada / Cerrar; ✓/✎ siguen como atajos directos (stopPropagation). Nuevo modal `taskPreview` a nivel App.

## 2026-06-10
- Módulo de adjuntos a Google Drive: subir archivos reales en Tareas (QuickTaskForm, sección "Archivos") y en Gastos (ExpenseEditForm), guardados en la carpeta compartida "Respaldo Gastos APP" → subcarpetas "Tareas"/"Gastos" (find-or-create, cacheadas). Scope OAuth ampliado a `drive` (lectura+escritura, superset de readonly) con `prompt:consent` → los usuarios re-autorizan Drive una vez. Upload resumable (hasta 15 MB con aviso si se excede), link "Abrir en Drive", eliminar = papelera de Drive. Manejo de token vencido (401) → fuerza reconexión, sin fallo silencioso. Chip "📎 N" en la fila del gasto. Metadata en tablas `task_attachments`/`expense_attachments`.

## 2026-06-10
- Rediseño tab "Emitidas / Por cobrar" (Facturación, admin): dos acordeones maestros cerrados por defecto. Bloque 1 "PENDIENTE PAGO" envuelve los acordeones por cliente (total y N° de `filtered`, single source). Bloque 2 "POR FACTURAR · [mes]" lista las programadas que vencen el mes en curso con check por fila (todas marcadas por defecto, solo para elegir qué va al Excel) y botón "Descargar Excel" (Cliente, Razón social, RUT receptor, Concepto/glosa, Monto neto, Monto UF, Fecha vencimiento, N° cuota) reutilizando el patrón XLSX existente.
- La carga de factura (PDF/Drive) ahora reconcilia la programada equivalente: si hay exactamente una del mismo cliente, mismo monto y vencimiento ≤ emisión, se elimina automáticamente (Bloque 2 se vacía solo). Botón "Ya emitida" por fila como respaldo manual para huérfanas, con asignación/confirmación de razón social.

## 2026-06-10
- Favicon + PWA: enlazados favicon (.ico + 16/32 png), apple-touch-icon 180 y `manifest.webmanifest` (íconos 192/512, theme/colores corporativos) en index.html — corrige el 404 de favicon y el ícono genérico al "Agregar a pantalla de inicio" en iPhone.
- GastosForm: campo "Proyecto (opcional)" con autocomplete de los proyectos del cliente seleccionado (tareas + ventas, igual que tareas); se guarda en `expenses.project` (nueva columna) y se muestra como chip en la lista de gastos.
- Rendición al cliente desde Gastos para limited: la rendición ahora se atribuye al usuario logueado (antes `user_name:'admin'` hardcodeado); `ExpensesView` pasa `currentUserName` a `RendicionModal`.
- Ficha de cliente (vista limited): nueva sección "Rendiciones realizadas" en solo lectura, con fecha/período/total y detalle de gastos expandible (sin Anular).

## 2026-06-10
- UF en vivo unificada (#15): helper único `fetchUF()` + hook `useUF()` con caché diario en localStorage; reemplaza los 3 fetch duplicados (Dashboard, SalesView, reporte) — la API de mindicador.cl se toca máx. 1 vez al día. Fallback seguro: si la API falla usa el último valor cacheado (aunque sea de días previos) en vez de 40000 silencioso. Señal visible `UFStamp` junto a las cifras que dependen de UF (Dashboard tarjeta Meta, SalesView totales): gris "UF al DD/MM · $valor" si es de hoy, naranja con ⚠ "no actualizada" / "UF no disponible" si no. El `uf_value` manual por venta se mantiene para montos históricos.

## 2026-06-10
- Títulos de bloque de Tareas (limited) ahora con el mismo estilo que los títulos de sección del Dashboard admin (11/600/muted, uppercase, letterSpacing .5) para consistencia visual entre vistas.
- Ajustes Tareas (limited): filtros con orden invertido (cliente primero, proyecto después); el selector de proyectos depende del cliente buscado (deshabilitado "Selecciona un cliente" si no hay; solo proyectos de ese cliente; "Sin proyectos" si no tiene) y se resetea al cambiar el cliente; títulos de bloque "Próximas semanas" (sin "dos") y "Resumen financiero" (antes "Mi caja chica").
- Rediseño jerárquico de la pestaña Tareas (limited): saludo sin la línea de contador redundante; sección "Mis tareas" con filtros a la derecha y dos/tres subsecciones colapsables (Activas abierta, Tareas que asigné, Terminadas cerrada) eliminando los subtítulos de urgencia repetidos; títulos de bloque unificados (15/700/#3D3D3D) y subtítulos unificados (12/600); bloques con espaciado parejo (~24px) sin hueco muerto antes del calendario. KPIs de caja chica con título de bloque y color escalonado: "Saldo disponible" verde >$50.000 / naranja $0–$50.000 / rojo negativo; "Por liquidar" naranja, rojo si los gastos sin liquidar (excl. Notaría) superan 10.

## 2026-06-09
- Tareas (limited): filtros (proyecto + cliente) movidos a la misma línea del subtítulo "Mis tareas · N" (título izquierda, filtros derecha, space-between); reducido el espacio en blanco excesivo entre "Terminadas" y "Próximas dos semanas" (bottom padding 100px→8px).
- Pestaña Tareas (limited): encabezado con saludo personalizado "¡Hola, [nombre]!" + fecha es-CL y contador (activas/atrasadas/hoy/próximas); filtros compactos alineados a 20px; click en una tarjeta abre vista previa de solo lectura (`TaskPreview`: contexto, responsable/asignó, plazo+estado, subtareas con progreso, comentarios y archivos si existen) con botones Editar / Marcar terminada / Cerrar; tarjetas KPI de caja chica con borde izquierdo de color + fondo tintado (verde/rojo según saldo, naranja para gastos por liquidar).
- Fix crash (pantalla negra) al abrir el modal de tarea: `QuickTaskForm` usaba `React.useEffect` pero `App.jsx` nunca importa `React` (solo hooks nombrados) y el JSX runtime automático no lo inyecta → `ReferenceError: React is not defined` desmontaba el árbol. Cambiado a `useEffect`. Afectaba crear/editar tarea desde cualquier punto (calendario, tarjetas, botón "+ Tarea"); latente desde el commit de subtareas/comentarios.
- Fix calendario "Próximas dos semanas" (Tareas): click en un día abre Nueva tarea con la fecha precargada en plazo; click en una tarjeta abre esa tarea para editar (stopPropagation). `onAddTask` ahora type-guardea la fecha (string) y `QuickTaskForm` acepta `preDue`, evitando el crash por pasar un MouseEvent como dato.
- Panel "Gestión · Gastos y Caja Chica" en el Dashboard (solo admin), debajo de la Proyección de flujo de caja: tabla compacta con una fila por usuario con caja chica (derivado de `petty_cash`). Columnas: Saldo caja (helper `saldoCajaChica`), Sin liquidar ("$monto / N°", ⚠ si >10 gastos excluyendo Notaría), Últ. gasto (⚠ si >7 días sin ingresar gasto).
- KPIs de caja chica en la pestaña Tareas (vista limited): tarjetas "Mi caja chica" (saldo real = entregado − gastos del usuario) y "Gastos por liquidar" (monto + cantidad), más lista "Últimos gastos ingresados" (3 últimos del usuario). Nueva columna `expenses.created_by` con atribución automática del usuario que ingresa el gasto. Saldo de caja chica unificado en un helper único (`saldoCajaChica`) usado por Tareas y por la pestaña Caja Chica.
