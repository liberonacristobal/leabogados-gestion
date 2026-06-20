# Reglas del proyecto leabogados-gestion

App de gestión legal para Liberona Escala Abogados. Estas reglas son permanentes y guían toda decisión.

## Arquitectura

- Archivo único: `src/App.jsx` (~16.250 líneas). React + Vite. Supabase (proyecto `kibuwhtpoxrnfowfdolu`, **RLS ON** desde 2026-06-19: política `team_all` permite solo a usuarios autenticados con email `@leabogados.cl`; las edge functions usan `service_role` y saltan RLS). Deploy en Vercel.
- Paleta corporativa OBLIGATORIA (objeto `C`): accent/AZUL1 `#003C50`, muted/AZUL2 `#537281`, AZUL3 `#99ABB4`, AZUL4 `#E4E8EB`, text/GRAFITO `#3D3D3D`, verde `#1D9E75`, rojo `#E24B4A`. Tokens de estado/conciliación también en `C`: greenText, soon/soonBg/soonText, overdueBg/overdueText, greenBg, azulInfo/azulBg, tealBg/tealText, ambarBg/coralText, grisText. SIEMPRE usar el token de `C`, nunca el hex suelto (excepto strings HTML de correo/PDF y atributos SVG, que van literales). NUNCA azules genéricos ni colores fuera de esta paleta.
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

## Experiencia de uso: que no dé miedo ni sea carga

- Práctica e intuitiva ante todo. Usarla debe ser un alivio, no una complejidad.
- MENOS ES MÁS: preferir siempre la solución simple. No agregar pasos, campos ni pantallas innecesarias.
- Si una feature se vuelve compleja o una carga, replantearla o simplificarla.
- Flujos cortos: el menor número de clics para cualquier acción.
- Español de Chile con forma "tú" en toda la interfaz. Nunca voseo.
- **Navegación lógica y user-friendly**: prioriza una estructura de navegación clara. Toda lista larga de ítems debe agruparse por la entidad natural (cliente/razón social, abogado, fecha) con la entidad de protagonista (visible, grande), nunca un muro plano de folios/OT con el dato clave truncado. Si el usuario no puede distinguir un ítem de otro de un vistazo, está mal diseñada.
- **UX impecable**: claro, accesible, responsivo y visualmente intuitivo. Buscador en toda lista de >~10 ítems; agrupación colapsable; el dato que identifica (nombre de cliente) siempre primero y legible; targets táctiles cómodos en iPhone.

## Rigor matemático en cálculos, métricas y reportes

La app maneja dinero, UF, gastos, saldos y proyecciones. Cero tolerancia a errores de cifra:

- Single source of truth para cada cálculo: una venta, un saldo, un total se calcula en UN solo helper reutilizable, nunca duplicar la fórmula (si se duplica, divergen). Ejemplo: `ventaUF()` y `ventaCLP()` son la única fuente para totales.
- Redondeo: redondear solo al mostrar, no al calcular, para no acumular error. Pesos sin decimales; UF con sus decimales.
- Casos borde siempre: división por cero, null/undefined, arrays vacíos, fechas inválidas. Nunca arrojar NaN, Infinity ni romper la vista.
- Conversiones UF↔CLP con el valor UF de la fecha correcta, no congelado. Al integrar mindicador.cl, convertir con el valor del día.
- Verificar que subtotales sumen el total general antes de mostrar agregados.
- Cifras auditables: el usuario debe poder entender de dónde sale cada número.

## Economía de espacio en formularios

- Formularios y paneles deben ser densos pero legibles. Eliminar padding decorativo, márgenes inflados y secciones que obligan a scroll innecesario.
- Antes de agregar un campo nuevo, preguntar si cabe en una línea existente (label inline, toggle + input en fila).
- Toda decisión de layout debe pasar por la pregunta: ¿esto requiere scroll en iPhone que podría evitarse?

## Patrón "Pulir" (rediseño de vistas y modales)

Disparador: cuando se pida "pulir/pule/pulí <vista>" (o mejorar una vista/modal), correr este checklist. Es un retoque guiado de usabilidad, no rehacer desde cero ni tocar la lógica de negocio (salvo bug). SIEMPRE proponer en render (antes/después), recomendar una opción y construir tras OK. Validado en +Gasto/+Fondo/Rendir y en el modal de Rendición.

- **Nada rígido**: todo elemento visible debe ser tocable y llevar a una acción. Una tarjeta/cifra que solo informa es un target desperdiciado → hacerla accionable.
- **Co-locación**: la acción vive donde está el dato que afecta ("+" de Fondos = agregar fondo; "Dirigido a" junto a Proyecto). Un dato elegido viaja al paso siguiente (no repetir: se elige una vez).
- **Menos chrome / campos condicionales**: eliminar lo redundante; lo opcional (subproyecto, filtros de fecha) se **colapsa** ("+ Subproyecto", "Filtrar por fecha ▾") y solo aparece si hace falta.
- **Labels dentro del cuadro** (FloatFld, como el modal de Gasto) para ahorrar alto; campos en una línea cuando se pueda.
- **Economía de texto**: símbolos/labels cortos ("Saldo" no "Saldo actual"; "+" no "Agregar fondo").
- **Targets táctiles cómodos en iPhone**: separar tamaño visual (~20px) del área de toque (~34px). Verificar a 375px con el caso difícil (nombre largo se trunca, botones se mantienen).
- **Estado visible**: los botones comunican estado, no son genéricos ("Rendir · N · $monto" vs "Rendir"; "✓ Al día").
- **Color semántico**: rojo solo para problema real (negativo/debe), verde para algo bueno, gris/neutro para el cero.
- **Consistencia visual**: un solo patrón de header (modales tipo `Acción | Cliente`, acento + nombre en gris, como Editar Cliente).
- **Sugerir, no tipear**: ofrecer contactos/datos de la ficha en vez de campos vacíos.
- **Rigor / fuente única**: cuestionar de dónde sale cada cifra; un contador/dato debe usar la MISMA fórmula que el detalle que abre, y derivarse de la fuente correcta (ej. el período = mes de los gastos, no "hoy").

## Flujo de trabajo

- Cambios estructurales o grandes: mostrarme el plan antes de tocar código.
- Cambios pequeños y acotados: hacerlos directo y avisar.
- Mantener un `CHANGELOG.md` en la raíz: agregar una línea con fecha y resumen por cada cambio publicado.
- Comentar en el código SOLO la lógica compleja o no obvia. No comentar lo trivial.
