# Reglas del proyecto leabogados-gestion

App de gestión legal para Liberona Escala Abogados. Estas reglas son permanentes y guían toda decisión.

## REGLA DE ORO: nunca de memoria — estudiar el código ANTES de proponer

Antes de afirmar cómo funciona algo, de proponer una solución, o de construir cualquier cosa, **revisa el código real y los datos** — NUNCA respondas de memoria ni supongas. La memoria y los resúmenes son pistas, no la verdad; el código y la base de datos son la única fuente.

- **Verifica primero que no exista ya.** Antes de crear una tabla, categoría, helper, vista, panel o flujo, **busca en la app si ya está contemplado** (grep en `src/App.jsx`, esquema en Supabase, edge functions). Reusar SIEMPRE; **nunca duplicar** ni generar cosas similares a lo que ya existe. El usuario no quiere más features paralelas que hagan lo mismo.
- **Estudia antes de opinar.** Ante cualquier planteamiento, primero recorre el código/datos relevantes; recién entonces propón. Si no lo estudiaste, dilo y estúdialo — no improvises una respuesta.
- **Propón doble mejora.** Frente a lo que plantea el usuario, entrega (a) mejoras a su planteamiento y (b) mejoras al código existente, apoyadas en lo que efectivamente encontraste en el código. Cita `archivo:línea` / tabla real.
- **Cifras y flujos, siempre desde la fuente** (refuerza "Rigor matemático" y "cuestionar el propio análisis"): un número o un comportamiento se afirma tras verlo en el código/consulta, no de memoria.

## REGLA DE ORO: vendible por diseño (mirada de producto)

Construimos para **muchos estudios, no para el nuestro**. Cada decisión —dato, texto, color, integración, tabla, flujo— se toma como si mañana la usara **otro estudio, en otro país**. La herramienta interna de hoy no es el producto: es su **primer cliente**; se sirve impecable, pero se construye para el segundo. El norte es transformarla en un SaaS vendible en Chile y LatAm (ver artifacts "De estudio a producto" y "FirmDesk", y [[roadmap-vision-estrategica]]).

**El producto se llama FirmDesk** (software de gestión para estudios). **Liberona Escala Abogados es el tenant #1**, no "la app". Separar SIEMPRE dos marcas: **FirmDesk** (el producto: login, "con tecnología FirmDesk", cuenta/cobro futuro — identidad índigo propia) vs **el estudio** (header de trabajo, correos, PDF/reportes, portal del cliente — identidad configurable). **Patrón BRAND (Fase 1, en marcha):** todo lo identitario del estudio (nombre, logos `le-logo*.png`, remitentes, dominio, tema=paleta `C`) se lee de un objeto **`BRAND`**, NUNCA de literales. Migrar gradualmente los ~15 usos de logo y las ~63 menciones "Liberona Escala" a `BRAND.*` (sin cambiar lo que ve LEA). El dominio/RLS `leabogados.cl` (multi-tenant, `estudio_id`) es Fase 3.

- **La pregunta de diseño (hazla siempre):** "¿esto obliga a hardcodear algo NUESTRO —un correo `@leabogados.cl`, un color de persona, una regla del SII, el nombre del estudio—?" Si la respuesta es sí, está mal diseñada; busca la forma parametrizable.
- **Nada cableado a Liberona Escala:** nombre, logo, paleta, firmas, roles, áreas, correos y equipo son (o van camino a ser) **datos configurables por estudio**, no constantes en el código. Al tocar código con estas constantes cableadas, prefiere dejarlo un paso más cerca de configurable (no romper lo actual, pero no agravar la deuda).
- **Aislamiento por estudio (multi-tenant) es el norte de datos:** hoy RLS = `@leabogados.cl` (monoinquilino); el destino es `estudio_id` + RLS por estudio. Toda tabla/feature nueva debe poder convivir con eso (pensar "¿de qué estudio es esta fila?").
- **Lo "Chile" es un módulo país:** SII, UF, RUT, IVA, factura electrónica y formatos son de Chile; trátalos como algo que se enchufa, no como el core. Idea a futuro: moneda/impuestos/idioma (es/pt/en) parametrizables.
- **Pragmatismo:** esto NO frena el avance ni obliga a construir el multi-tenant hoy. Es una **mirada**: entre dos soluciones equivalentes, elige la que escala a más estudios; y no agregues deuda nueva de cableado. Esta regla convive con "menos es más" y con la autonomía autorizada.

## Arquitectura

- Archivo único: `src/App.jsx` (~16.250 líneas). React + Vite. Supabase (proyecto `kibuwhtpoxrnfowfdolu`, **RLS ON** desde 2026-06-19: política `team_all` permite solo a usuarios autenticados con email `@leabogados.cl`; las edge functions usan `service_role` y saltan RLS). Deploy en Vercel.
- Paleta corporativa OBLIGATORIA (objeto `C`): accent/AZUL1 `#003C50`, muted/AZUL2 `#537281`, AZUL3 `#99ABB4`, AZUL4 `#E4E8EB`, text/GRAFITO `#3D3D3D`, verde `#1D9E75`, rojo `#E24B4A`. Tokens de estado/conciliación también en `C`: greenText, soon/soonBg/soonText, overdueBg/overdueText, greenBg, azulInfo/azulBg, tealBg/tealText, ambarBg/coralText, grisText. SIEMPRE usar el token de `C`, nunca el hex suelto (excepto strings HTML de correo/PDF y atributos SVG, que van literales). NUNCA azules genéricos ni colores fuera de esta paleta. Hay muchos hex de la paleta escritos a mano (deuda histórica): al tocar una vista, **migrar gradualmente** sus hex sueltos al token de `C` (no en barrido masivo, por el riesgo visual a ciegas). Los grises de fondo muy usados que aún no son token (`#F5F7F9`, `#FAFBFC`, `#F1EFE8`) deben **agregarse a `C`** como tokens y reemplazarse al pasar.
- Roles: admin (Cristóbal cl@, Erasmo ee@) ven todo; limited (Martín mc@, Martina mp@, Rodrigo rd@) ven solo Tareas, Gastos y Caja Chica.

## Reglas de oro (build y deploy)

- ANTES de publicar SIEMPRE corre `npm run build` y verifica `✓ built in`. Si falla, arregla antes de publicar. El build roto silencioso ya causó problemas graves.
- Publicar: `git add -A && git commit -m "mensaje" && git push`
- NUNCA romper el layout mobile. La app se usa principalmente en iPhone.
- Tablas Supabase nuevas (estándar RLS ON): `GRANT ALL ON TABLE x TO authenticated, service_role; ALTER TABLE x ENABLE ROW LEVEL SECURITY; CREATE POLICY team_all ON x FOR ALL TO authenticated USING ((auth.jwt() ->> 'email') LIKE '%@leabogados.cl') WITH CHECK ((auth.jwt() ->> 'email') LIKE '%@leabogados.cl'); NOTIFY pgrst, 'reload schema';`. NO volver a `DISABLE ROW LEVEL SECURITY` ni dar GRANT a `anon` (era el agujero que se cerró el 2026-06-19).

## Filosofía central: la herramienta APRENDE y nunca repite trabajo

Principio rector más importante. La app debe ser muy autónoma y construir memoria con el uso:

- Toda acción manual (asignar razón social a un cliente, vincular un RUT, asignar factura huérfana, corregir un match) se guarda PERMANENTEMENTE. Si se asignó una vez, sirve para siempre — nunca volver a preguntar lo mismo.
- Evitar a toda costa que el usuario repita pasos ya completados. Cada decisión se convierte en conocimiento que la app reutiliza sola.
- La app anticipa: autocompleta, sugiere, recuerda. Si ya tiene el dato, lo usa; solo pregunta ante ambigüedad real que no puede resolver.
- Al diseñar cualquier feature preguntarse: "¿esto obliga a repetir algo que la app ya podría saber?". Si sí, está mal diseñada.

### REGLA: nunca duplicar entidades (clientes, RS, proveedores)

La app **nunca** debe crear una entidad duplicada. Aplica al importar de Drive, al crear a mano, y a cualquier alta automática:

- **Dedup robusto** (no `.toLowerCase().trim()` a secas): normalizar SIEMPRE con el criterio único = minúsculas + sin acentos (NFD) + **colapsar espacios** (`\s+→" "`) + trim. Un solo helper para front y edge functions (el `norm` del edge `clientes-drive-sync` es la referencia).
- **Fuzzy match antes de crear**: si el nombre se parece mucho a una entidad existente (typos, letras cambiadas — ej. "Migdley" vs "Midgley"), **NO crear**. Proponer "¿es el mismo que X?" (compuerta humana) y, al vincular, **aprender el alias** (`learnings` kind `cliente_folder`: key = nombre normalizado del folder → value = client_id) para no volver a preguntar ni recrear. El sync/edge function DEBE consultar ese alias antes de insertar.
- **Fusionar conservando datos**: al unir dos fichas, el **sobreviviente es SIEMPRE el que tiene información** en la app (facturas, ventas, gastos, tareas, anticipos, RS). Se le **reasignan TODOS** los registros del otro (todas las FKs `client_id`/`cliente_id`) y su nombre queda como alias, y recién ahí se elimina el vacío. Auditar/permitir deshacer.
- Es una aplicación directa de "la herramienta APRENDE": cada vinculación/fusión es conocimiento que evita el trabajo repetido de limpiar duplicados.

## REGLA DE ORO: el valor COMPOUNDING — más datos, más valor

Complemento directo de "la herramienta APRENDE". Mientras APRENDE cubre *no repetir trabajo*, esta regla cubre *devolver cada vez más*. La app acumula datos con el uso (ventas, cobros, horas, gastos, conciliación, tareas, correos); **cada dato nuevo debe convertirse en más valor para el dueño**, no quedarse guardado. El norte: un estudio de abogados **liviano y efectivo**, que con la misma gente rinde más porque el software le da la foto que antes no tenía.

- **Más datos → más métricas.** Cuando una feature junta suficiente historia para calcular algo útil (una tendencia, un margen, una proyección, un ranking, una alerta), **entrégalo** — no esperes a que lo pidan. Pregúntate siempre: "con lo que la app YA tiene, ¿qué métrica/insight puedo mostrar que hoy no muestro?".
- **Tiempo real por defecto.** Los números se calculan en vivo desde la fuente (helpers únicos), nunca congelados ni cargados a mano. Si algo cambió (un cobro entró, una hora se cargó), la foto lo refleja al instante.
- **Todo descargable/compartible.** Toda métrica, reporte o lista relevante debe poder **exportarse** (PNG/PDF/Excel/CSV según sirva) para llevar a una reunión, al contador o al cliente. Lo que no se puede sacar de la app, no sirve para decidir afuera.
- **Anticipar, no solo reportar.** El valor máximo no es mostrar el pasado sino **avisar antes**: proyección de fin de año, cliente que se enfría, cobro que se va a vencer, margen que cae, carga que se desbalancea. Convertir el dato en acción.
- **Del dato crudo al insight accionable.** No basta con listar; agrupar, rankear, comparar contra meta, marcar el estado. El dueño debe entender "qué hacer" de un vistazo (canon de la foto).
- **Auditable y de fuente única** (ver "Rigor matemático"): cada métrica nueva sale de su helper único y el usuario puede rastrear de dónde sale cada cifra. Confianza por diseño.
- Al construir CUALQUIER feature, cerrar con: "¿qué métrica, exportación o alerta puedo sumar ahora que tengo estos datos, para que el estudio sea más liviano y efectivo?".

## REGLA DE ORO: la app se AUTO-ACTUALIZA (mejora desde lo aprendido)

La app no es estática: es capaz de **mejorarse a sí misma** en base a todo lo que aprende. Cada patrón detectado (una decisión que el usuario repite, un descuadre que aparece seguido, una glosa que siempre mapea igual, un flujo que cuesta) es material para que la app **proponga e implemente su próxima mejora**. El conocimiento acumulado (`learnings`, `usage_events`, correcciones, auditorías) es el insumo de la siguiente versión, no solo un registro.

- **De learning a feature.** Cuando la app ya aprendió algo lo suficiente (misma corrección N veces, misma sugerencia aceptada siempre), dar el paso: automatizar ese paso, subir la confianza, o proponer la mejora al usuario. El patrón "compuerta humana → aprende → se libera" ([[firmdesk-back-office-autonomo]]) es el molde.
- **La app se auto-diagnostica.** Detecta sus propios descuadres, falsos positivos y deuda (paneles de Salud de datos / Revisión), y con eso **propone** qué arreglar — no espera a que el humano lo cace.
- **La próxima versión sale del conocimiento** ([[plan-nueva-version]]): al planificar mejoras, mirar primero lo que la app YA sabe (datos, learnings, uso real de cada usuario) y derivar de ahí las features, en vez de inventar desde cero.
- **Con compuerta y auditable.** Auto-mejorar NO es actuar a ciegas: propone, muestra el porqué (los datos que lo respaldan), y deja al humano aprobar lo sensible (cifras, correos, SII, destructivo) — coherente con "Autonomía autorizada" y la pausa de seguridad. Toda auto-mejora es reversible.
- **Mide su propio impacto.** Cuando implementa una mejora, la app puede medir si funcionó (menos pasos manuales, menos descuadres, más cobrado a tiempo) y seguir ajustando. Ciclo cerrado: aprende → propone → implementa → mide → aprende.

## Experiencia de uso: que no dé miedo ni sea carga

- Práctica e intuitiva ante todo. Usarla debe ser un alivio, no una complejidad.
- MENOS ES MÁS: preferir siempre la solución simple. No agregar pasos, campos ni pantallas innecesarias.
- Si una feature se vuelve compleja o una carga, replantearla o simplificarla.
- Flujos cortos: el menor número de clics para cualquier acción.
- Español de Chile con forma "tú" en toda la interfaz. Nunca voseo.
- **Navegación lógica y user-friendly**: prioriza una estructura de navegación clara. Toda lista larga de ítems debe agruparse por la entidad natural (cliente/razón social, abogado, fecha) con la entidad de protagonista (visible, grande), nunca un muro plano de folios/OT con el dato clave truncado. Si el usuario no puede distinguir un ítem de otro de un vistazo, está mal diseñada.
- **UX impecable**: claro, accesible, responsivo y visualmente intuitivo. Buscador en toda lista de >~10 ítems; agrupación colapsable; el dato que identifica (nombre de cliente) siempre primero y legible; targets táctiles cómodos en iPhone.
- **Aprender del comportamiento de cada usuario (navegación)**: la app observa qué navega, abre, busca y usa CADA usuario, y lo usa para anticipar y facilitar — recientes, frecuentes, sugerencias, accesos directos a lo que más toca. Objetivo: que llegar a un dato/vista cueste el mínimo de clics. Es la contraparte de navegación de la filosofía "la herramienta APRENDE" (que cubre los datos). Guardar el uso (p. ej. learnings/usage_events) y reflejarlo en la UI (la paleta de comandos prioriza lo reciente/frecuente de ese usuario; los cross-links saltan a donde el usuario suele ir).
- **Todo clickeable / cross-linking (nada rígido)**: cada dato visible es tocable y lleva a su CONTEXTO natural; ningún dato es callejón sin salida. En particular: el **nombre del cliente abre su ficha en TODA vista** (Gastos, Tareas, Ventas, Conciliación, Facturación, Inteligencia, Dashboard); una **factura → su venta/proyecto**; un **movimiento conciliado → su factura**; una **tarea → su cliente**; un **anticipo → las cuotas que cubre**; un **KPI → la lista que lo compone**. Se debe poder "pasar de un dato a otro tocando". Preferir la fila/tarjeta entera tappable; los saltos secundarios (ej. "Ficha →" o el nombre dentro de una fila que ya tiene onClick) van con `stopPropagation` para no chocar con el toque principal. Handler único `handleOpenClientFicha` → abre Ficha → Financiero.

## Rigor matemático en cálculos, métricas y reportes

La app maneja dinero, UF, gastos, saldos y proyecciones. Cero tolerancia a errores de cifra:

- Single source of truth para cada cálculo: una venta, un saldo, un total se calcula en UN solo helper reutilizable, nunca duplicar la fórmula (si se duplica, divergen). Ejemplo: `ventaUF()` y `ventaCLP()` son la única fuente para totales.
- Nunca re-implementar una fórmula inline (p. ej. `.reduce` sumando montos) que duplique un helper existente: usar el helper único (`ventaUF`/`ventaCLP`/`saldoCliente`/`fgCliente`/`saldoBill`). Todo saldo/deuda/por-cobrar/reembolso **excluye** los gastos `no_descuenta_saldo` (histórico) y `paid_by_client` (bug reintroducido varias veces por sumar inline). Al detectar una suma inline de montos, evaluar reemplazarla por el helper.
- Redondeo: redondear solo al mostrar, no al calcular, para no acumular error. Pesos sin decimales; UF con sus decimales.
- Casos borde siempre: división por cero, null/undefined, arrays vacíos, fechas inválidas. Nunca arrojar NaN, Infinity ni romper la vista.
- Conversiones UF↔CLP con el valor UF de la fecha correcta, no congelado. Al integrar mindicador.cl, convertir con el valor del día.
- Verificar que subtotales sumen el total general antes de mostrar agregados.
- Cifras auditables: el usuario debe poder entender de dónde sale cada número.

## REGLA DE ORO: cuestionar siempre el propio análisis

Antes de entregar cualquier análisis, diagnóstico, causa-raíz o afirmación sobre cifras, **cuestiónalo como si fuera de otro** y busca activamente por qué podría estar mal. No entregues la primera lectura como si fuera la verdad.

- **Enumera hipótesis alternativas, no una sola.** Ante un descuadre o un dato raro, plantea varias causas posibles y descártalas con datos, en vez de casarte con la primera explicación (que suele ser la más alarmista o la más simple).
- **Revisa tus supuestos de consulta.** El error típico: preguntar en el plano equivocado. Ejemplo real: buscar respaldo bancario solo en `conciliacion.tipo_destino='factura'` dio 21 falsos "sin respaldo / $23M"; la plata estaba conciliada a nivel **abono/anticipo**. Antes de concluir, pregúntate: "¿mi consulta cubre TODOS los caminos por los que este dato puede existir?" (otras tablas, otros `tipo_destino`, columnas como `prepaid_anticipo_id`/`reconciled_at`/`payment_method`).
- **Distingue "diferencia estructural" de "error".** Dos números que miden cosas distintas (planos, ejes, fechas) NO tienen por qué calzar; eso no es un bug ni fraude. No presentes una diferencia esperada como una fuga.
- **Calibra el tono al evidencia.** Nada de "riesgo/fraude/$23M" sin haber agotado las explicaciones benignas. La conclusión alarmista es la que más hay que auditar antes de decirla.
- **Escucha la corrección del usuario como señal.** Si el usuario dice "puede que estés analizando mal", asume que probablemente lo estás; re-levanta TODO el dato desde cero, no defiendas la lectura anterior.
- Esto refuerza (no reemplaza) "Cifras auditables" y la pausa de seguridad en cambios de cifras: primero dudar, verificar y recién ahí afirmar.

## Economía de espacio en formularios

- Formularios y paneles deben ser densos pero legibles. Eliminar padding decorativo, márgenes inflados y secciones que obligan a scroll innecesario.
- Antes de agregar un campo nuevo, preguntar si cabe en una línea existente (label inline, toggle + input en fila).
- Toda decisión de layout debe pasar por la pregunta: ¿esto requiere scroll en iPhone que podría evitarse?

## Patrón "Pulir" (rediseño de vistas y modales)

Disparador: "pulir/pule/pulí <vista>" → correr estas reglas sobre esa vista. Retoque guiado de usabilidad (no rehacer ni tocar la lógica salvo bug); proponer en render, recomendar una opción y construir tras OK.

- **Economía de espacio** (regla del proyecto): labels dentro del cuadro, campos en una línea, nada de padding/secciones que obliguen a scroll en iPhone.
- **Menos es más / campos condicionales**: lo opcional (subproyecto, fechas) se colapsa y solo aparece si hace falta — no contaminar.
- **Co-locación**: "Dirigido a" junto a Proyecto, y el correo elegido viaja al paso siguiente (no repetir trabajo: lo eliges una vez).
- **La herramienta aprende / sugiere**: "Dirigido a" propone los contactos de la ficha en vez de escribir.
- **Consistencia visual**: header igual al de Editar Cliente (un solo patrón de encabezado).
- **Rigor en las cifras**: cuestionar de dónde sale cada dato (el período) y arreglar la fórmula si está mal.

En una frase: compactar sin perder función — títulos dentro del cuadro, lo opcional colapsado, campos co-locados, sugerencias en vez de tipeo, header unificado, y los datos derivados de la fuente correcta.

## Canon de la foto (landings y resúmenes de KPIs)

Regla universal para CUALQUIER vista-resumen de números — "la foto" — de un landing/dashboard/ficha (Facturación, Ventas, Gastos, Dashboard). Antes de armar o tocar una, correr este checklist:

1. **Jerarquía, no paralelo**: una cifra que es PARTE de otra (Vencido ⊂ Por cobrar) va ANIDADA bajo su total, NUNCA como tarjeta hermana. Cero cifras duplicadas (no repetir el hero como tile).
2. **Un protagonista**: un solo bloque grande es la foto (ej. Por cobrar, con vencido/al-día dentro); lo accesorio (Cobrado, Por facturar, Anticipos, Proveedores) baja a segundo nivel. No 4 tiles del mismo peso compitiendo.
3. **Una sola fuente por cifra**: cada número sale de su helper único; los subtotales SUMAN el total; nada calculado dos veces inline (ver "Rigor matemático").
4. **Canon color + icono por estado**: cada estado con su color e icono del canon (`estadoCobro`/`ESTADO_COBRO`).
5. **Menos es más, sin disclaimers**: nada de párrafos explicativos al pie; si una cifra depende de un filtro (año), se rotula corto (1 línea). La confianza va por diseño, no por nota.
6. **Filtro claro**: de un vistazo se entiende qué depende del filtro (año → Cobrado/Por facturar) y qué es saldo vivo (Por cobrar/Vencido).
7. **Todo clickeable**: cada KPI abre su lista (Por cobrar → sus facturas, Vencido → vencidas).
8. **Alertas de acción, no KPI de plata**: lo que requiere acción ("Ya facturadas — vincular") es una alerta, no una tarjeta de monto.
9. **Mobile iPhone**: sin romper layout, targets cómodos, pills estrechas, sin emojis, paleta `C`.

En una frase: **un protagonista con sus partes anidadas, cero cifras repetidas, de fuente única, todo clickeable y sin párrafos.** Aplicado: landing Facturación "Etapas del cobro", Ventas, Gastos, Dashboard.

## Flujo de trabajo

- **Autonomía autorizada (2026-07-01):** avanza el backlog sin pedir permiso. Construye, verifica en demo (build verde + `?demo=1` sin crash), commitea+push y avisa; toma decisiones de diseño razonables y muéstralas en la respuesta MIENTRAS construyes (ya NO hace falta esperar OK del plan, ni siquiera para features grandes). Crea el SQL de las tablas nuevas para que el usuario lo corra; despliega edge functions cuando haga falta.
- **Igual PAUSA y avisa (por seguridad, no por permiso):** (a) cambios de CIFRAS/fórmulas que no puedas verificar sin datos reales de producción → muestra el análisis, no ejecutes a ciegas (cero tolerancia a errores de cifra); (b) cosas de alto riesgo que solo se prueban en prod (cerrar el relay de notify-task, envíos de correo) → constrúyelas pero avisa que hay que probarlas antes de confiar; (c) acciones destructivas/irreversibles sobre datos reales, credenciales/OAuth/secretos, trámites externos (SII), y enviar correos/mensajes en su nombre → confirmar siempre.
- Mantener un `CHANGELOG.md` en la raíz: agregar una línea con fecha y resumen por cada cambio publicado.
- Comentar en el código SOLO la lógica compleja o no obvia. No comentar lo trivial.
