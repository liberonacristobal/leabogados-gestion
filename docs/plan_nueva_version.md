# Plan — la próxima versión de leabogados-gestion (2026-06-28)

Documento estratégico. Responde a la visión del usuario: *que la app aprenda lo suficiente para que yo (Claude) genere la próxima versión desde el conocimiento acumulado*. Aquí está de dónde saldría, qué la define, qué falta aprender, y cómo la construiría sin romper lo bueno.

## 1. De dónde sale: el sustrato de conocimiento
La próxima versión NO se inventa de cero. Se genera leyendo lo que ya acumulamos:
- **Memorias** (`memory/*.md`): las decisiones y el *por qué* de cada cosa (canon, reglas, criterios de negocio).
- **Docs** (`docs/`): auditorías y planes (UX, conciliación, facturación/SII, este plan).
- **CHANGELOG + código**: el historial y la capa de aprendizaje viva (`learnings`, alias, los ✦).
- **El canon**: la foto, navegación lógica, formato, color/persona, todo-clickeable, menos-es-más, reversibilidad.

La condición innegociable (lección de esta jornada): ese conocimiento solo sirve si es **correcto** — verificar contra el código, no contra la impresión. Conocimiento aparente heredaría errores.

## 2. Qué define la nueva versión (pilares)
1. **Capa de aprendizaje de primera clase.** Hoy el aprendizaje está repartido; en la nueva versión es el núcleo: TODO aprende, TODO es visible y editable desde el Centro de aprendizaje (ya creado). Cada acción manual alimenta una sugerencia ✦ futura.
2. **Proactividad.** La app empuja, no espera. "Qué atender hoy" deja de estar colapsado: abre el día con cobranza + plazos + conciliación pendiente consolidados.
3. **Canon codificado.** El canon de la foto / navegación / formato pasa de "regla que recordamos" a **design system explícito** (tokens en `C`, componentes únicos, una regla de formato por contexto). Se aplica parejo, no a mano.
4. **BI y proyección.** El módulo de Inteligencia de Negocios (iniciado) perfila clientes/servicios/precios y proyecta flujo.
5. **Emisión electrónica DTE.** Cerrar la facturación SII (hoy en certificación) — el gran pendiente operativo.

## 3. Más loops de aprendizaje a cerrar (lo que la app aún no aprende)
- **Editar** (no solo "Olvidar") en el Centro de aprendizaje + sumar los alias de tablas aparte (`cliente_alias`, `import_aliases`).
- **Formato de cobro por cliente**: si un cliente siempre paga en N cuotas / mensual, sugerirlo al crear la venta.
- **Área de la venta por cliente** (de sus ventas pasadas) — hoy solo aprendimos el responsable.
- **Subcategoría de gasto por glosa** (`gasto_subcategoria`) — extender el patrón ✦ que ya existe para categoría.
- **Conciliación recurrente**: aprender los tríos/combos que se repiten mes a mes (el motor ya los detecta; falta recordarlos).
- **Rendición sugerida**: cuando un cliente acumula N gastos sin rendir hace X días, proponer la rendición.
- **Contacto de envío por cliente** (factura_to/cc ya se aprende; consolidarlo y mostrarlo).
- **Duplicados aprendidos** (`conciliacion_dup` ya existe) visibles en el Centro de aprendizaje.

## 4. Cómo la generaría (el proceso, con compuerta humana)
1. **Leer el sustrato** completo (memorias + docs + CHANGELOG + código) y destilar el canon en un **design system explícito** (un solo lugar con tokens, componentes y reglas de formato).
2. **Reconstruir vista por vista** aplicando ese canon + la capa de aprendizaje *first-class* (cada vista que toca un dato, aprende y sugiere).
3. **Verificar contra el conocimiento**: cada cambio se contrasta con las reglas establecidas (no re-introducir bugs que ya cerramos: paid_by_client en saldos, oficina en fórmulas globales, formato mezclado, etc.).
4. **Iterar por fases con tu OK** (modo "revisar tanda antes"): nada se da por bueno sin validación; cada fase deja su commit y su línea de CHANGELOG.
5. **Demo-verificar** cada cambio observable (el preview `?demo=1` caza crashes que el build no).

## 5. Cómo NO romper lo bueno
- **Mobile iPhone** primero, siempre. **Single source of truth** por cifra (helpers únicos). **Reversibilidad** en toda acción de estado. **RLS ON** (estándar de seguridad). **Español de Chile, tú**. **Sin emojis**.
- Migrar el canon **gradualmente** al tocar cada vista (no barridos masivos a ciegas — la deuda de hex sueltos se paga vista por vista).

## En una frase
La próxima versión es **el canon codificado + la capa de aprendizaje hecha núcleo + proactividad**, generada leyendo el conocimiento que venimos acumulando — y la disciplina de verificar es lo que hace que ese acervo produzca una versión mejor, no una con errores heredados.
