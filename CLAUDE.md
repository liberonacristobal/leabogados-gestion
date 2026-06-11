# Reglas del proyecto leabogados-gestion

App de gestión legal para Liberona Escala Abogados. Estas reglas son permanentes y guían toda decisión.

## Arquitectura

- Archivo único: `src/App.jsx` (~5200 líneas). React + Vite. Supabase (proyecto `kibuwhtpoxrnfowfdolu`, RLS off). Deploy en Vercel.
- Paleta corporativa OBLIGATORIA (objeto `C`): accent/AZUL1 `#003C50`, muted/AZUL2 `#537281`, AZUL3 `#99ABB4`, AZUL4 `#E4E8EB`, text/GRAFITO `#3D3D3D`, verde `#1D9E75`, rojo `#E24B4A`. NUNCA azules genéricos ni colores fuera de esta paleta.
- Roles: admin (Cristóbal cl@, Erasmo ee@) ven todo; limited (Martín mc@, Martina mp@, Rodrigo rd@) ven solo Tareas, Gastos y Caja Chica.

## Reglas de oro (build y deploy)

- ANTES de publicar SIEMPRE corre `npm run build` y verifica `✓ built in`. Si falla, arregla antes de publicar. El build roto silencioso ya causó problemas graves.
- Publicar: `git add -A && git commit -m "mensaje" && git push`
- NUNCA romper el layout mobile. La app se usa principalmente en iPhone.
- Tablas Supabase nuevas: `ALTER TABLE x DISABLE ROW LEVEL SECURITY; GRANT ALL ON TABLE x TO anon, authenticated, service_role; NOTIFY pgrst, 'reload schema';` para evitar 403.

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

## Flujo de trabajo

- Cambios estructurales o grandes: mostrarme el plan antes de tocar código.
- Cambios pequeños y acotados: hacerlos directo y avisar.
- Mantener un `CHANGELOG.md` en la raíz: agregar una línea con fecha y resumen por cada cambio publicado.
- Comentar en el código SOLO la lógica compleja o no obvia. No comentar lo trivial.
