# Reglas del proyecto leabogados-gestion

App de gestión legal para Liberona Escala Abogados. Estas reglas son permanentes y guían toda decisión.

## REGLA DE ORO: verificar antes de afirmar — nada de memoria, nada sin prueba

Nace de errores reales (2026-10-01 y 2026-10-25): «21 series sin cuotas» era el default `nCuotas=3`; «$54M sin enviar» eran 26 de 38 ya pagadas; «15 cuotas, $16,1M» eran 7 por $10,0M con la regla completa; se propuso reclamar una factura que un correo explicaba. Antes de afirmar cómo funciona algo, proponer una solución o entregar un número, hallazgo, duplicado o diagnóstico:
1. **Del código y los datos, nunca de memoria.** La memoria y los resúmenes son pistas. Buscar primero si ya existe (App.jsx, esquema, edge functions) y reusar. Doble mejora: a lo que plantea el usuario y al código existente, citando `archivo:línea` o tabla.
2. **La cifra la calcula la app.** Todo número sobre un concepto de la app (radar, por cobrar, vencido, saldo, rendir, notaría, trabajos detenidos) sale de la misma función (helper de `_shared` o dryRun del servidor). Sin función: «estimación propia, sin la regla de la app», nunca un hallazgo.
3. **Filas, no cuentas; ciclo, no foto.** Un conteo, flag, vista o resumen es una hipótesis: abrir las filas reales y mirar su ciclo completo (¿pagada, emitida, enviada fuera de la app, anulada, cubierta por anticipo, dentro de la vida de la app: billing desde 2026-06-06, XML desde 2026-06-09?). Un solo flag casi nunca dice la verdad.
4. **Defecto no es lo mismo que esperable:** valor por defecto (`nCuotas=3`), diferencia estructural legítima (dos tramos de 50 %; devengado contra caja; emitido contra cobrado), artefacto histórico previo a la app. Si el radar los produce, se arregla el radar.
5. **Cuestionar el propio análisis como si fuera de otro:** enumerar hipótesis alternativas y descartarlas con datos; revisar que la consulta cubra TODOS los caminos (otras tablas, otros `tipo_destino`, `prepaid_anticipo_id`, `reconciled_at`, `payment_method`: buscar respaldo solo en `conciliacion.tipo_destino='factura'` dio 21 falsos «$23M»). Si el usuario dice «puede que estés analizando mal», re-levantar todo desde cero.
6. **Contexto del negocio antes de proponer una acción** sobre un cliente o tercero (reclamar, cobrar, cerrar): buscar acuerdos en correos (contacto@ y la casilla del socio), learnings, bitácora y notas.
7. **Un análisis con hallazgos lo verifica un revisor aparte** que recibe los datos y la pregunta, no mi conclusión. Se entrega solo lo que sobrevive, separado en «confirmado (con su fuente)» y «por verificar».
8. **Cada falso positivo deja su prueba** en `tests/` (anonimizada) y se corrige en la regla, no en la vista. Cada afirmación lleva su fuente; sin fuente es «por verificar». Tono calibrado: nada de alarma de $ o fraude sin agotar las explicaciones benignas. Ante la duda, verificar o callar.

Mnemotecnia: **filas, no cuentas · ciclo, no foto · esperable, no defecto · prueba, no corazonada.**

## REGLA DE ORO: vendible por diseño (mirada de producto)

Construimos para **muchos estudios, no para el nuestro**: cada decisión (dato, texto, color, integración, tabla, flujo) se toma como si mañana la usara otro estudio, en otro país. La herramienta de hoy es el **primer cliente** del producto, no el producto; el norte es un SaaS vendible en Chile y LatAm ([[roadmap-vision-estrategica]]).
- **El producto es FirmDesk; Liberona Escala Abogados es el tenant #1.** Dos marcas siempre separadas: **FirmDesk** (login, «con tecnología FirmDesk», identidad índigo propia) y **el estudio** (header de trabajo, correos, PDF, portal del cliente; identidad configurable). Todo lo identitario del estudio (nombre, logos, remitentes, dominio, paleta `C`) se lee del objeto **`BRAND`**, nunca de literales; los usos sueltos se migran gradualmente sin cambiar lo que ve LEA.
- **La pregunta de diseño:** «¿esto obliga a hardcodear algo NUESTRO (un correo `@leabogados.cl`, un color de persona, una regla del SII, el nombre del estudio)?». Si sí, está mal diseñada: buscar la forma parametrizable; al tocar código cableado, dejarlo un paso más cerca de configurable.
- **Multi-tenant:** hoy RLS = `@leabogados.cl`; el destino es `estudio_id` + RLS por estudio. Toda tabla o feature nueva debe poder convivir con eso («¿de qué estudio es esta fila?»).
- **Lo «Chile» (SII, UF, RUT, IVA, factura electrónica) es un módulo país** que se enchufa, no el core.
- **Pragmatismo:** es una mirada, no un freno: entre dos soluciones equivalentes, la que escala a más estudios, y sin deuda nueva de cableado.

## REGLA DE ORO: simplificar los procesos — siempre, en el código y en la memoria

Pedida por el usuario el 2026-11-06. En cada tarea, además de lo pedido, buscar qué del proceso se puede **simplificar, unir o eliminar** y proponerlo (o hacerlo, si es chico y seguro) con su evidencia. Vale para el código, los avisos y correos, los procesos automáticos, el flujo de trabajo de desarrollo y esta misma memoria.
- **Un solo camino por cosa:** dos reglas, helpers, estados o procesos que hacen lo mismo se unen en uno (ejemplo del 2026-11-06: el doble conteo cuota ↔ tramo usaba 8 % y el cuadre de la venta 3 %; quedó un solo criterio).
- **Menos pasos, menos clics, menos avisos:** si un paso lo puede deducir la app, se elimina; si dos avisos dicen lo mismo, queda uno; no se agrega un correo nuevo si cabe en uno que ya sale.
- **Borrar es simplificar:** código muerto, vistas sin uso, procesos que nadie lee, memorias repetidas u obsoletas se proponen para borrar, con la prueba de que no se usan.
- **La memoria y estas reglas también:** si una regla de CLAUDE.md o una memoria repite o contradice a otra, se une o se corrige; el índice se mantiene corto.
- Cada hallazgo se afirma con su fuente (conteo, archivo:línea, consulta), nunca de memoria. Refuerza «menos es más», «reusar siempre, nunca duplicar» y «la menor cantidad de partidas».

## REGLA DE ORO: la menor cantidad de partidas — lo más minimalista posible

Nace del 2026-11-06: la clasificación de «Por facturar» salió con 11 partidas y el usuario pidió simplificarla, porque con muchas categorías y subcategorías «luego es muy difícil saber cómo calificar las cosas». Vale para toda clasificación, estado, categoría, etiqueta, pestaña o paso que se agregue a la app, a una regla de `_shared`, a un detector o a un render.
- **Pocas partidas, y se justifican una por una:** solo existe una partida nueva si lleva a una **acción distinta** del usuario. Si dos partidas piden lo mismo, son una. Antes de agregar una, intentar resolverlo con una etiqueta de la fila (un motivo en texto) o con un dato que ya existe.
- **El motivo es etiqueta, no categoría:** «cubierta por factura», «pausada», «mensual» se muestran en la fila; no abren otra partida ni otro estado.
- **Reutilizar lo que ya existe** (decisiones guardadas, estados, detectores, listas) en vez de crear una clase paralela.
- **Las partidas suman el total** y deben poder explicarse en una línea cada una. Si una clasificación pasa de ~4 partidas visibles, replantearla antes de construirla.
- **Nombres breves y entendibles, de su vocabulario** (el del usuario o el contable, financiero o legal): «Vencidas», «Por vencer», «Por confirmar», «Excluidas», «Dar de baja», «Prorrogar», «Exceso», «Saldo»; nunca jerga propia ni palabras que haya que explicar («Fuera», «Sobra», «vigente con nueva fecha»). Cada etiqueta debe existir como término contable, financiero o legal, o ser de uso corriente del estudio. Si el nombre necesita una frase para entenderse, es el nombre equivocado.
- Refuerza «menos es más» y «reusar siempre, nunca duplicar».

## REGLA DE ORO: modal solo para confirmaciones — todo lo demás es página

Nada de ventanas flotantes para trabajar (2026-11-04: se convirtieron ~50 modales a página). Un `Modal` solo se usa para una **pregunta breve que bloquea una acción** y donde no hay nada que mirar al lado: avisos y confirmaciones del sistema (`DialogHost`: `appAlert`/`appConfirm`), «Dar de baja factura» (un motivo), «Deshacer importación», elegir el mes de la tanda (`MesTandaModal`) y el panel de Counsel AI (excepción pedida por el usuario: no se toca).
- **Todo lo que tenga más de 2–3 campos, listas, previsualizaciones o se use para trabajar es PÁGINA con «← origen»:** si se abre por navegación, tipo `flujo` en `PAGE_OF` de `App.jsx` (`FlujoPagina`); si se abre desde un estado dentro de una vista, `PaginaSobre` (compartido.jsx). Nunca `position:'fixed'` + fondo oscuro a mano.
- **Excepción pedida por el usuario (2026-11-04): los avisos al entrar son ventana al centro** (`NovedadesAviso` y `AvisoPdfSii`, con «Ver todas»/«Ver facturas» y «Entendido»), no banda arriba. Salen uno tras otro (novedades primero); en demo, el del SII solo con `?pdffallos=1`.
- Al convertir, revisar que el contenido no lea `modal.data` (en página es `pagina.data`) y verificar en 1280 y 375 px.

## REGLA DE ORO: doble formato — todo nace en móvil Y escritorio

La app tiene **dos presentaciones** (móvil full-screen y escritorio a todo el ancho), elegidas por el hook `useIsDesktop()` (breakpoint único 1024px). **Todo desarrollo nuevo —vista, feature, cambio visible— debe ser útil y funcional en AMBOS formatos**, nunca en uno solo. Ver [[arquitectura-desktop-movil]] (playbook completo, moldes, extracción a `useXModel`).

- **Una sola fuente, dos vistas:** datos/lógica/estado compartidos (un helper único, o un hook `useXModel` en las vistas pesadas); la presentación se ramifica `isDesktop ? <Desktop/> : <Movil/>`. NUNCA duplicar la lógica ni la cifra entre formatos.
- **El móvil es el piso, nunca se rompe:** el escritorio es una **rama nueva** del render; el móvil (<1024px) debe quedar **idéntico** salvo que el cambio sea explícitamente para móvil. Todo lo desktop va detrás de `isDesktop`, de `:hover`, o de `@media(min-width:1024px)` — el móvil no debe "enterarse".
- **El escritorio aprovecha el ancho:** elige el molde por tipo de vista (maestro-detalle→2-panel; dashboard→multicolumna CSS; lista→tabla ordenable; feed/form→columna centrada). No dejar una columna de teléfono estirada ni centrada angosta en el monitor.
- **Legibilidad por formato:** el escritorio se lee de más lejos que el teléfono — respeta mínimos legibles en cada uno (no reusar a ciegas tamaños de fuente pensados para la mano).
- **Checklist para dar por terminado CUALQUIER cambio visible:** (1) `npm run build` verde; (2) runtime sin errores en la vista Y sus sub-vistas; (3) verificado a **1280px** (desktop) y **375px** (móvil), con el móvil idéntico o mejor. Sin los 3, no está listo.
- **La pregunta de diseño (hazla siempre):** "¿esto se ve y funciona bien en móvil Y en escritorio?". Si solo pensaste en uno, está a medias.

## Arquitectura

- Archivo único: `src/App.jsx` (~8.900 líneas al 29-10-2026; las pantallas grandes viven en `src/vistas/` y se cargan aparte con `lazyVista`, lo compartido en `src/lib/base.jsx` y `src/lib/compartido.jsx`; mover más con `python3 scripts/mover-a-modulo.py vistas/X.jsx X --vista`; `src/lib/compartido.jsx` se parte con `python3 scripts/dividir-compartido.py <modulo> <Nombres…>`, que mueve el grupo sin ciclos y reescribe las importaciones; ya salieron `rendiciones.jsx`, `fichaCliente.jsx` y `porSocio.jsx`). React + Vite. Supabase (proyecto `kibuwhtpoxrnfowfdolu`, **RLS ON** desde 2026-06-19: política `team_all` permite solo a usuarios autenticados con email `@leabogados.cl`; las edge functions usan `service_role` y saltan RLS). Deploy en Vercel.
- Paleta corporativa OBLIGATORIA (objeto `C`): accent/AZUL1 `#003C50`, muted/AZUL2 `#537281`, AZUL3 `#99ABB4`, AZUL4 `#E4E8EB`, text/GRAFITO `#3D3D3D`, verde `#1D9E75`, rojo `#E24B4A`. Tokens de estado/conciliación también en `C`: greenText, soon/soonBg/soonText, overdueBg/overdueText, greenBg, azulInfo/azulBg, tealBg/tealText, ambarBg/coralText, grisText. SIEMPRE usar el token de `C`, nunca el hex suelto (excepto strings HTML de correo/PDF y atributos SVG, que van literales). NUNCA azules genéricos ni colores fuera de esta paleta. Hay muchos hex de la paleta escritos a mano (deuda histórica): al tocar una vista, **migrar gradualmente** sus hex sueltos al token de `C` (no en barrido masivo, por el riesgo visual a ciegas). Los grises de fondo muy usados que aún no son token (`#F5F7F9`, `#FAFBFC`, `#F1EFE8`) deben **agregarse a `C`** como tokens y reemplazarse al pasar.
- Roles: admin (Cristóbal cl@, Erasmo ee@) ven todo; limited (Martín mc@, Martina mp@, Rodrigo rd@) ven solo Tareas, Gastos y Caja Chica.

## Reglas de oro (build y deploy)

- ANTES de publicar SIEMPRE corre `npm run build` y verifica `✓ built in`. Si falla, arregla antes de publicar. El build roto silencioso ya causó problemas graves.
- **`npm run verificar`** (lo corre solo el pre-push de `.githooks`; **no repite lo ya verificado**: si el código es idéntico al de la última verificación en verde no corre nada, y el recorrido de la demo, lo lento, solo corre si cambió la app; `-- --forzar` lo corre todo; ver `scripts/verificar.mjs`): build + `npm run tipos` (revisión de tipos: `src/lib/cifras.js` estricto y todas las reglas de `supabase/functions/_shared/*.js` con chequeo de nulos y de tipos de operaciones) + `npm test` (reglas de `_shared` y cifras, `tests/*.test.mjs`) + `npm run lint` (variable sin declarar) + `npm run smoke` (recorre la demo en Chrome sin ventana, escritorio y celular, y además la app SIN demo con sesión simulada y Supabase respondido con los datos de la demo —«carga real simulada»—; falla si una vista muestra el blindaje de error o «No se pudieron cargar»). Toda pestaña o página nueva sin datos propios se agrega a `TABS`/`MODALES` de `scripts/smoke-demo.mjs`; toda regla nueva de `_shared`, con su prueba. Lectura de tablas que pueden pasar de 1.000 filas: SIEMPRE `selectAll`/`todasRest` de `_shared/paginar.js` con orden estable, nunca un `select` suelto. Saltar solo en emergencia: `SIN_VERIFICAR=1 git push`.
- Publicar: `git add -A && git commit -m "mensaje" && git push`
- NUNCA romper el layout mobile. La app se usa principalmente en iPhone.
- Tablas Supabase nuevas (estándar RLS ON): `GRANT ALL ON TABLE x TO authenticated, service_role; REVOKE ALL ON TABLE x FROM anon; ALTER TABLE x ENABLE ROW LEVEL SECURITY; CREATE POLICY team_all ON x FOR ALL TO authenticated USING ((auth.jwt() ->> 'email') LIKE '%@leabogados.cl') WITH CHECK ((auth.jwt() ->> 'email') LIKE '%@leabogados.cl'); NOTIFY pgrst, 'reload schema';`. NO volver a `DISABLE ROW LEVEL SECURITY` ni dar GRANT a `anon` (era el agujero que se cerró el 2026-06-19). El `REVOKE ... FROM anon` es OBLIGATORIO: la consola de Supabase crea las tablas como `supabase_admin`, cuyo default ACL le da a `anon` todos los permisos — RLS lo tapa, pero el grant queda (barrido 2026-09-15 revocó anon en las 25 tablas que lo tenían). Edge functions leen como `service_role`: si una función devuelve 0 filas de una tabla, revisar que tenga `GRANT SELECT ... TO service_role` (a `sales` le faltaba).

## Filosofía central: la herramienta APRENDE y nunca repite trabajo

Principio rector más importante. La app debe ser muy autónoma y construir memoria con el uso:

- Toda acción manual (asignar razón social a un cliente, vincular un RUT, asignar factura huérfana, corregir un match) se guarda PERMANENTEMENTE. Si se asignó una vez, sirve para siempre — nunca volver a preguntar lo mismo.
- Evitar a toda costa que el usuario repita pasos ya completados. Cada decisión se convierte en conocimiento que la app reutiliza sola.
- La app anticipa: autocompleta, sugiere, recuerda. Si ya tiene el dato, lo usa; solo pregunta ante ambigüedad real que no puede resolver.
- Al diseñar cualquier feature preguntarse: "¿esto obliga a repetir algo que la app ya podría saber?". Si sí, está mal diseñada.

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

- Práctica e intuitiva: usarla debe ser un alivio. **Menos es más**: la solución simple, flujos cortos (el menor número de clics); si una feature se vuelve una carga, replantearla. Español de Chile con «tú»; nunca voseo.
- **Correos:** nunca «Junto con saludar». Abrir con «Espero que estés muy bien.» (una persona) o «Espero que estén muy bien.» (más de una / «Estimados»). Excepción: correos internos al equipo (avisos, recordatorios, resúmenes): «Hola X» (`holaEquipo`, `_shared/correoEquipo.js`) y directo lo que se informa.
- **Listas y UX:** toda lista larga se agrupa por la entidad natural (cliente/razón social, abogado, fecha) con la entidad de protagonista, nunca un muro plano con el dato clave truncado. Buscador en toda lista de más de ~10 ítems, agrupación colapsable, el dato que identifica primero y legible, targets táctiles cómodos en iPhone.
- **La app aprende de la navegación de cada usuario** (recientes, frecuentes, accesos directos) para que llegar a un dato cueste el mínimo de clics; se guarda en learnings/usage_events y se refleja en la UI (paleta de comandos, cross-links).
- **Todo clickeable:** cada dato lleva a su contexto natural; ninguno es callejón sin salida. El nombre del cliente abre su ficha en TODA vista (`handleOpenClientFicha`); factura → su venta; movimiento conciliado → su factura; tarea → su cliente; anticipo → las cuotas que cubre; KPI → la lista que lo compone. Preferir la fila entera tappable; los saltos secundarios dentro de una fila con onClick van con `stopPropagation`.
- **Ir y volver al lugar exacto:** la pila `navStack` + `navTo(dest)`/`goBack()` es la columna vertebral. Todo salto a una vista que NO está en la barra (Banco, Cartera, Cobranza, Repricing, Inteligencia, Presupuesto Oficina; Tareas y Caja chica en admin) usa `navTo({tab, foco})`, NUNCA `setTab` crudo (deja la pila vacía y «Volver» cae en Inicio). `navTo` apila `{tab,fichaId,scroll}` y resuelve el foco exacto (`conc`→movimiento, `cartera`→proyecto, `billingIntent`→checklist/cierre/cotejo, `fichaId`→cliente). Toda vista fuera de la barra lleva «← {origen}» (`goBack` + `TAB_LABELS[origen]`), y un cross-link «ver X» lleva al ítem exacto, no al hub.
- **Anti pantalla-negra:** `npm run build` verde NO garantiza que la app monte (crashes 2026-06 `navOrigin`, 2026-09 `billingIntent`): el `useState` de una variable usada en el render o en un dep array de useCallback/useMemo/useEffect va declarado ANTES del hook (TDZ), y una variable usada sin su `useState` es un ReferenceError. Tras tocar estado, hooks o props de una vista, verificar en runtime la vista y sus subvistas en demo (`?demo=1`).

## Rigor matemático en cálculos, métricas y reportes

La app maneja dinero, UF, gastos, saldos y proyecciones. Cero tolerancia a errores de cifra:

- Single source of truth para cada cálculo: una venta, un saldo, un total se calcula en UN solo helper reutilizable, nunca duplicar la fórmula (si se duplica, divergen). Ejemplo: `ventaUF()` y `ventaCLP()` son la única fuente para totales.
- Nunca re-implementar una fórmula inline (p. ej. `.reduce` sumando montos) que duplique un helper existente: usar el helper único (`ventaUF`/`ventaCLP`/`saldoCliente`/`fgCliente`/`saldoBill`). Todo saldo/deuda/por-cobrar del cliente **excluye solo** los gastos `no_descuenta_saldo` (histórico ya saldado fuera de la app); TODOS los demás gastos cuentan, notaría incluida, la pague quien la pague (modelo confirmado por el usuario 2026-09-01, `fgCliente`). `paid_by_client` **NO** se excluye del saldo del cliente: significa «no salió de la caja chica de quien lo cargó» (en notaría es el valor por defecto: la OT se paga por liquidación desde la oficina) y solo se excluye en los cálculos de **caja chica** (saldo, por liquidar, gastado del miembro). Al detectar una suma inline de montos, evaluar reemplazarla por el helper.
- Redondeo: redondear solo al mostrar, no al calcular, para no acumular error. Pesos sin decimales; UF con sus decimales.
- Casos borde siempre: división por cero, null/undefined, arrays vacíos, fechas inválidas. Nunca arrojar NaN, Infinity ni romper la vista.
- Conversiones UF↔CLP con el valor UF de la fecha correcta, no congelado. Al integrar mindicador.cl, convertir con el valor del día.
- Verificar que subtotales sumen el total general antes de mostrar agregados.
- Cifras auditables: el usuario debe poder entender de dónde sale cada número.

## REGLA DE ORO: coherencia de datos entre vistas (una cifra, una fuente, un dueño)

Prioridad #1 del usuario: **la misma cifra se ve igual entre por donde se entre** (Inicio, Oficina, Facturación, Por socio, Inteligencia, ficha, correos, exportaciones). Reforzada 2026-10-19 al alinear Por socio e Inteligencia.

- **Un solo cálculo por concepto, en un helper de módulo.** Ninguna vista re-arma una cifra que ya existe: la lee del helper (`ventaCLP`/`metricasAnio`, `montoFactura`/`saldoBill`, `fgCliente`, `flujoCajaProyectado`/`proyeccionCobranza`, `resultadoMes`, `saldoComisiones`, y el cálculo por socio). Si dos vistas muestran "lo mismo", es la misma función.
- **Un solo dueño por partida (atribución por socio única).** Toda vista que reparte por socio/abogado usa la MISMA regla: decisión guardada (`learnings` `socio_factura`) → subarriendo = «Sin socio»/Oficina (no es de nadie) → `venta.responsible` → `cliente.abogado_responsable`; lo que no es de un socio va a «Sin socio». Comisiones que nos paga BDA = del socio dueño del cliente subyacente. Nunca otra regla en otra vista.
- **Mismo plano, misma cifra.** Facturado = DTE emitidos con folio (las cuotas sin folio no cuentan aunque tengan `issued_at`); caja = `conciliacion.monto_aplicado` por fecha del depósito (como Inicio), nunca `paid_at` de la factura; reembolsos de gastos (facturas tipo reembolso y fondos ligados a una factura) se restan, no son ingreso; la parte del externo se resta; comisiones pagadas = `terceros` sin `comision_pct`. UF siempre del día de cada movimiento.
- **Las partes suman el total, siempre.** Socios + Sin socio = Oficina; meses = año; filas de una cascada = su neto (redondeo con `redondearPartes`). Si una vista muestra un total, debe poder abrirse en partidas reales que lo sumen al peso.
- **Diferencias estructurales se rotulan, no se esconden.** Si dos cifras miden planos distintos (devengado vs caja, emitido vs cobrado), cada una dice su plano en una línea; no se presentan como "la misma" ni como error.
- **Al cambiar una cifra o una regla:** buscar TODAS las vistas, correos y exports que la muestran y dejarlas en el mismo helper en el mismo commit; verificar con datos reales que coinciden (consulta o arnés con las funciones de la app).

## REGLA DE ORO: lenguaje — revisar las reglas antes de escribir

Todo lo acordado sobre lenguaje es regla de oro. Antes de escribir **cualquier** texto (etiqueta, título, botón, aviso, correo, asunto, render, propuesta), pasar por este checklist; nunca inventar lenguaje:
1. **Vocabulario existente:** buscar en `App.jsx` y en las memorias de lenguaje el término que la app ya usa, y reusarlo. Lista de acciones = **«Pendientes»**.
2. **Registro formal de oficina de abogados:** sustantivos y estados financieros o legales («Pago a la notaría por transferir», «Fondos por solicitar», «Borrador preparado», «Pendiente de emisión»). Se mantiene el «tú» de Chile, sin tono de chat.
3. **No inventar términos, jerga ni pasos;** si un término no existe, proponerlo sobrio y validarlo.
4. **Sin relleno:** una línea, sin frases explicativas ni disclaimers.
5. **Correos: solo lo que se informa.** Saludo + una línea por tema + la cifra + el botón. Nada de instrucciones de uso de la app («Abre la ficha… al tocar un gasto…», «En tu caja chica puedes…»: para eso está el botón), ni explicar por qué importa («así el vencido baja», «mantiene la caja cuadrada»), ni cierres de relleno («Cada tema tiene su propia acción abajo», «Todo en orden», «Nada se corrigió automáticamente», «Este aviso se repite…»), ni nombres de personas escritos en el texto. **Excepción — avisos de un problema** (falta una cartola, falla un proceso): sí explican en pocas líneas qué pasó, qué significa y cómo resolverlo, con los nombres reales de los botones de la app (usuario 24-10: el aviso de cartolas «tosco/robótico»); sin frases sobre cómo funciona la app por dentro («llega cada mañana y la app la carga sola»). Revisado en los 24 correos el 24-10-2026 (antes/después: artifact CWYRcXn83uKdjGm4TScpAi).

Prohibido: «Lo que te toca», «Esto es lo tuyo», «un toque»/«al toque», «Cuándo te debería llegar», «atrasada» (→ vencida), «listas para cobrar» (→ por pagar), «asume/adelanta la oficina» (→ a cargo de la oficina / adelanto de la oficina), «tanda», asuntos con gancho («Tu semana en 2 minutos»), preguntas o exclamaciones como título, «listo», «ojo», «Un empujón», «Vas al día»/«Vas en el X%» (→ «Avance X%»), «Hoy toca…» (→ «Corresponde…»), «adelantando plata» (→ adelanto de la oficina), «Ya lo hablé» (→ «Conversado con el cliente»), «de sobra», «revísenlos entre los dos», «toma un minuto/segundos».

## REGLA DE ORO: todo correo confirma si salió o no

Nadie debe quedar con la duda de si un correo se envió. Toda acción que envía un correo cierra con **una** confirmación:
- **Salió:** qué se envió, a quién y desde qué cuenta (tu cuenta / cuenta de la oficina). Texto único: `txtEnviado(via,{que,g,para})`.
- **No salió:** «El correo NO se envió» + qué hacer: cerrar sesión en la app, volver a entrar con la cuenta del dominio (`BRAND.emailDominio`) y reintentar (`TXT_REINGRESO`, `avisoNoEnviado`). Si hay un error técnico distinto del acceso expirado, se muestra el detalle.
- **En lote:** la cuenta de salida se decide **una vez** (`modoEnvioLote`) y al final un resumen: cuántos salieron, cuántos no y qué hacer (`txtResumenEnvio`). Nunca un aviso por correo ni «enviado» sin contar.
- **Cómo:** todo envío pasa por `enviarComoUsuario`, que ya avisa «NO se envió» en envíos individuales; el llamador solo muestra el éxito (o pasa `sinAviso` si informa el resultado con su propio texto). Nunca decir «enviado» antes de que el envío termine ni si `via` es null.

## REGLA DE ORO: sin franjas de color a la izquierda ("no parecer IA")

Nunca usar líneas o franjas de color a la izquierda para marcar estado: ni `borderLeft` de color, ni `boxShadow: inset Npx 0 0`, ni divs-franja verticales. Aplica a la app Y a todo render, mockup o propuesta. El estado se lee por el color de la cifra o del texto, un punto tenue o el chip del canon. Las etiquetas/títulos de sección y de KPI van en `C.accent` (visibles por jerarquía), no en gris claro.

## REGLA DE ORO: formato de fechas (uno solo en toda la app)

Auditoría visual 2026-10-15. Aplica a la app, renders, correos, PDF, exportaciones y a cualquier respuesta con fechas:
- **Fecha en texto = dd-mm-aaaa** (`15-10-2026`) con `fmtFechaDMY(iso)`; desde un timestamp, `fmtFechaDMY(isoLocal(ts))`. Nunca `toLocaleDateString('es-CL',{day,month:'short'})` ("15 sept"), nunca "15/10/26" ni fechas sin año.
- **Fecha grande** (filas de lista) = `diaGrande(iso)`: día grande + "mmm aa" chico. Nunca un bloque de fecha hecho a mano.
- **Meses**: abreviado en minúscula de 3 letras con `MES_C`/`mesCorto` ("sep", nunca "sept" ni "SEP"); título de período con `mesTitulo` ("Septiembre 2026"). Encabezados con día de la semana y prosa de documentos ("15 de octubre de 2026") son la única excepción.
- Antes de dar por terminado un cambio con fechas, revisar que todas salgan de estos helpers (sin `toLocaleDateString` nuevo).

## REGLA DE ORO: todo render se muestra completo y verificado

Ningún render (propuesta, antes/después, mockup) se le muestra al usuario si no pasa este checklist. Nace del 2026-10-15: se mostraron tarjetas deformes, textos cortados y alertas con otra forma, en un pedazo suelto de la vista.
1. **La vista COMPLETA, en contexto:** header, filtros, tarjetas, alertas y lista, en escritorio (1280) y celular (375). Nunca un pedazo suelto, porque lo que se ve bien aislado se desordena en la vista.
2. **Hermanos = misma forma y tamaño:** los elementos del mismo nivel usan el mismo componente (no tarjeta al lado de píldora), y la grilla calza (filas completas, sin huecos ni piezas sueltas).
3. **Solo el dato:** etiqueta + cifra. Texto debajo solo si es indispensable. Todo texto cabe en 1 línea, sin cortarse con «…».
4. **Formatos:** $M con 1 decimal en tarjetas y resúmenes, fechas dd-mm-aaaa, cifras a la derecha.
5. **Reusar los componentes de la app** (tarjeta KPI canónica, fila de lista, PageHeader), sin inventar formas nuevas.
6. **Mirar antes de mostrar:** abrir el render, revisar la captura a 1280 y a 375 contra los puntos 1–5 y corregir lo que falle antes de enviarlo.

## Reglas de detalle (leerlas antes de tocar esas áreas; copia en `docs/reglas-detalle.md`)

- [[reglas-dominio-finanzas]]: **nunca duplicar entidades** (clientes, razones sociales, proveedores: dedup robusto, fuzzy match y fusión conservando datos); **caja chica ↔ transferencia** (conciliación 1:1 por persona, monto y ±3 días, sin registrar dos veces); **retiros de socios equitativos por período** (página Socios).
- [[reglas-detalle-vistas-y-correos]]: **lo que sale al cliente toma sus números de la app, no de texto tipeado** (cuota, folio, monto y período; lo aprendido guarda marcas, nunca el número literal); **canon de la foto** de KPIs (un protagonista, partes anidadas, todo clickeable); patrón **«Pulir»**; **economía de espacio** en formularios.

## Flujo de trabajo

- **Autonomía autorizada (2026-07-01):** avanza el backlog sin pedir permiso. Construye, verifica en demo (build verde + `?demo=1` sin crash), commitea+push y avisa; toma decisiones de diseño razonables y muéstralas en la respuesta MIENTRAS construyes (ya NO hace falta esperar OK del plan, ni siquiera para features grandes). Crea el SQL de las tablas nuevas para que el usuario lo corra; despliega edge functions cuando haga falta.
- **Igual PAUSA y avisa (por seguridad, no por permiso):** (a) cambios de CIFRAS/fórmulas que no puedas verificar sin datos reales de producción → muestra el análisis, no ejecutes a ciegas (cero tolerancia a errores de cifra); (b) cosas de alto riesgo que solo se prueban en prod (cerrar el relay de notify-task, envíos de correo) → constrúyelas pero avisa que hay que probarlas antes de confiar; (c) acciones destructivas/irreversibles sobre datos reales, credenciales/OAuth/secretos, trámites externos (SII), y enviar correos/mensajes en su nombre → confirmar siempre.
- Mantener un `CHANGELOG.md` en la raíz: agregar una línea con fecha y resumen por cada cambio publicado.
- Comentar en el código SOLO la lógica compleja o no obvia. No comentar lo trivial.
