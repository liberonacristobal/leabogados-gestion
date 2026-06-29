# Design system — leabogados-gestion (canon codificado)

Fase 1 del plan de la nueva versión (`docs/plan_nueva_version.md`): el canon, hoy disperso en CLAUDE.md + 40 memorias, destilado en **un solo lugar buildable**. Toda vista nueva o reconstruida se mide contra esto.

## Tokens (objeto `C`)
- Corporativos: accent/AZUL1 `#003C50`, muted/AZUL2 `#537281`, AZUL3 `#99ABB4`, AZUL4 `#E4E8EB`, text/GRAFITO `#3D3D3D`, verde `#1D9E75`, rojo `#E24B4A`.
- Estado/conciliación: greenText, soon/soonBg/soonText, overdue/overdueBg/overdueText, greenBg, azulInfo/azulBg, tealBg/tealText, ambarBg/coralText, grisText, bgSoft, bgWarm.
- **Regla**: SIEMPRE el token de `C`, nunca el hex suelto (excepto HTML de correo/PDF y atributos SVG). Deuda histórica de hex a mano → migrar gradualmente al tocar cada vista (no barrido a ciegas). Grises de fondo (`#F5F7F9`, `#FAFBFC`, `#F1EFE8`) → agregar a `C` como token al pasar.

## Formato de cifras (regla — corregida 2026-06-29)
La distinción NO es foto vs lista, es **OVERVIEW vs DETALLE** (error que cometí y corregí en el piloto: la ficha es detalle, no overview):
- **Overview / landing** (Dashboard, Facturación, Gastos, Ventas — escaneas MUCHAS entidades, importan tendencias) → `fmtShort` (`$65M`). Consistente dentro de la foto: las partes anidadas igualan al protagonista (esto fue el P0 de Facturación: el vencido anidado en `fmt` rompía la foto del landing).
- **Detalle de UNA entidad** (ficha de cliente, su saldo/cobros/fondos, un cargo, un costo de oficina) → `fmt` COMPLETO. Ahí la exactitud de ESE dato importa (Cobrado `$28.530.000`, no `$29M` que esconde $530k). Vale para el protagonista-hero y sus resúmenes de sección.
- **Listas / filas de detalle** → `fmt` completo.
- UF con sus decimales; pesos sin decimales. Redondear solo al mostrar, nunca al calcular.
- *Lección: una regla mal estatuida cascada en errores. Verificar el contexto real (¿overview o detalle?) antes de aplicar.*

## Canon de la foto (toda vista-resumen de cifras)
1. Jerarquía, no paralelo: una cifra que es PARTE de otra va ANIDADA, nunca tarjeta hermana. Cero cifras duplicadas.
2. Un protagonista; lo accesorio baja a segundo nivel.
3. Una sola fuente por cifra (helper único; subtotales suman el total; nada inline duplicado).
4. Color + ícono por estado del canon (`estadoCobro`/`ESTADO_COBRO`).
5. Menos es más, sin disclaimers/párrafos al pie.
6. Filtro claro (qué depende del año vs saldo vivo).
7. Todo clickeable → cada KPI abre su lista.
8. Alertas de acción ≠ KPI de plata.
9. Mobile iPhone (targets cómodos, pills estrechas, sin emojis, paleta C).

## Navegación
- Toda lista larga (>~10) se agrupa por la entidad natural (cliente/RS, abogado, **año › mes** colapsable) con el protagonista visible — nunca muro plano de folios/OT truncados. Patrón año›mes desplegable: conciliación, costos de oficina, "por recordar" (por cliente). Con filtro activo, expandir todo.
- Buscador en toda lista >~10; índice A-Z donde aplica (target ≥~20px).
- **Todo clickeable / cross-linking**: el nombre del cliente abre su ficha en TODA vista; factura→venta; movimiento conciliado→factura; tarea→cliente; KPI→su lista. Fila/tarjeta entera tappable; saltos secundarios con `stopPropagation`. Handler único `handleOpenClientFicha`.
- Fecha destacada: día grande + "mes año" (`bigDate`).

## Componentes (fuente única)
- Inp/Sel alto 36; `chipBtn`; radios card; tabular-nums global. Pills estrechas (~3px 11px). Header de modal = patrón "Nueva tarea". KPI card (gap 8, radio 10, pad 10×12, borderLeft 3px, label 9px, cifra 17px). Chip de persona con su color (`PERSON_CHIP`/`personChip`).
- Sin bottom-sheet (se deforma en iPhone): modal centrado o acordeón.

## Persona (color fijo)
Cristóbal navy · Erasmo azul · Martín verde · Martina rosa · Rodrigo ámbar. Fuente única `PERSON_CHIP`, nunca hardcodear.

## La herramienta APRENDE (capa de primera clase)
- Toda acción manual se guarda PERMANENTE y se reusa (`learnings` + alias). Patrón ✦: `learnPut(kind,key,value,meta)` al decidir → sugerencia 1-toque la próxima (glosa→cliente/categoría/costo-oficina, RUT→categoría, dominio→cliente, cliente→responsable/área/cobro).
- **Centro de aprendizaje** ("Lo que aprendí", menú ☰): visible y borrable (Olvidar). Es el núcleo.
- Anticipa: autocompleta, sugiere, recuerda; solo pregunta ante ambigüedad real.

## Reglas duras (no romper)
Mobile iPhone primero · single source of truth por cifra (excluir `no_descuenta_saldo` y `paid_by_client` de saldos) · la oficina (`is_internal`) fuera de toda fórmula global · reversibilidad en toda acción de estado · RLS ON (`team_all` @leabogados.cl) · español de Chile "tú" · sin emojis · `npm run build` verde antes de publicar · verificar en demo (`?demo=1`) lo observable.

## Cómo se usa
Checklist al crear/reconstruir una vista. Cuando una regla evoluciona, se actualiza acá (un solo lugar) y se propaga. Es la base de la reconstrucción vista-por-vista de la próxima versión.
