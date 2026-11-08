# Reglas de detalle (versión del repositorio, sin nombres de clientes ni de socios)

CLAUDE.md las nombra y las lee antes de tocar el área correspondiente. Las versiones completas y con ejemplos reales viven en la memoria local del equipo de desarrollo; esta es la copia anonimizada para que no dependan de un equipo.

## Dominio: entidades, caja chica y retiros de socios (leer antes de tocar clientes y razones sociales, Banco › Revisión de caja chica o la página Socios)

**Nunca duplicar entidades (clientes, razones sociales, proveedores).** Aplica al importar de Drive, al crear a mano y a toda alta automática.
- Dedup robusto: normalizar siempre con un criterio único (minúsculas, sin acentos, espacios colapsados, trim). Un solo helper para el front y las edge functions.
- Fuzzy match antes de crear: si el nombre se parece mucho a uno existente (letras cambiadas), no se crea; se propone «¿es el mismo que X?» y al vincular se aprende el alias (`learnings` kind `cliente_folder`) para no volver a preguntar ni recrear. El sync consulta el alias antes de insertar.
- Fusionar conservando datos: sobrevive la ficha que tiene información; se le reasignan todos los registros del otro (todas las `client_id`/`cliente_id`), su nombre queda como alias y recién entonces se elimina la vacía. Auditable y reversible.

**Caja chica ↔ transferencia.** Toda transferencia de la oficina a un miembro para gastos queda trazada 1:1 contra su carga de caja chica: misma persona, mismo monto, dentro de ±3 días. La app concilia sola cuando el calce es único y exacto; lo ambiguo va a compuerta, nunca a ciegas sobre plata. Nunca se registra dos veces (`petty_cash.movimiento_id`, índice único). El sueldo no es caja chica y se excluye solo. Los usuarios `limited` ven solo su propia caja chica.

**Retiros de socios equitativos por período (página Socios).** Los retiros deben igualarse entre socios por período, aunque se paguen en días y transferencias distintos.
- Un retiro = las transferencias de un socio dentro de una ventana de ≤3 días consecutivos (`clusterSocio`, `GAP=3`), no un movimiento ni «todo el mes».
- El socio se lee de `expenses.subcategory` (la clasificación manual), no de la glosa.
- Una diferencia significa que faltó retirar (no se compensa entre socios); la paridad se evalúa por ronda y el chip del header muestra el estado del año.
- Si un retiro queda sin socio, la app propone el que cuadra la paridad; al confirmar se escribe `subcategory` (aprende).
- Sueldos y bonos de socios se muestran aparte; el equivalente mensual = (retiros + sueldo) ÷ meses completos transcurridos.

## Correos y documentos al cliente: los números salen de la app, no de texto tipeado

- Cuota, folio, monto y período de un correo o documento al cliente salen de la app (`facturaGlosaPartes` toma la cuota del concepto «Cuota N/M»; la glosa del DTE solo si el concepto no la trae). Lo aprendido de un correo editado guarda marcas (`{folios}`, `{total}`, `{periodo}`, `{cuota}`, `{folio}`), nunca el número literal.
- Un dato tipeado a mano que contradice a la app se detecta en su origen (`cuotaNeDte`), no al enviar.
- Una cuota numerada no se salta: se marca como saltada si ya se emitió una de número mayor de su venta.
- El correo de varias facturas lista cada trabajo leído de la glosa de su factura, nunca omite uno ni dice un total sin él. El saludo se decide por el «Para».
- Todo envío de factura registra quién lo hizo (`sent_by`, `sent_to`, bitácora `facturacion.correo_enviado`).

## Canon de la foto (resúmenes de KPIs)

1. Jerarquía, no paralelo: una cifra que es parte de otra va anidada bajo su total, nunca como tarjeta hermana.
2. Un protagonista; lo accesorio baja a segundo nivel.
3. Una sola fuente por cifra; los subtotales suman el total.
4. Color e ícono por estado del canon (`ESTADO_COBRO`).
5. Sin párrafos explicativos al pie; si una cifra depende de un filtro, se rotula en una línea.
6. Filtro claro: se distingue lo que depende del año de lo que es saldo vivo.
7. Todo clickeable: cada KPI abre su lista.
8. Lo que requiere acción es una alerta, no una tarjeta de monto.
9. Móvil intacto: sin romper el layout, targets cómodos, paleta `C`.

## Patrón «Pulir» y formularios

- Pulir es un retoque guiado de usabilidad (no rehacer ni tocar la lógica salvo un bug): se propone en un render, se recomienda una opción y se construye tras el visto bueno.
- Economía de espacio: etiquetas dentro del cuadro, campos en una línea, lo opcional colapsado, sin padding decorativo. Antes de agregar un campo, preguntar si cabe en una línea existente y si obliga a scroll en iPhone.
- Co-locación y sugerencias en vez de tipeo; un solo patrón de encabezado.
