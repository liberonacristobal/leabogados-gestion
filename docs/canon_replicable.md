# Canon replicable — apps Liberona Escala Abogados

Rulebook auto-contenido para construir **otra app de Liberona Escala Abogados idéntica en formato, forma de pensar, guardar y analizar información**. Copia este archivo al nuevo repo (idealmente como base de su `CLAUDE.md`) y constrúyelo contra él. Todo lo de acá es replicable tal cual, salvo IDs concretos (proyecto Supabase, dominio) que se cambian por los del nuevo proyecto.

---

## 0. Cómo usar este documento
- Es la **fuente única** del canon. Toda vista nueva se mide contra esto antes de construir.
- Cuando una regla evoluciona, se actualiza **acá** (un solo lugar) y se propaga.
- Orden mental: **filosofía → datos → cifras → diseño → navegación → IA → seguridad → flujo**.

---

## 1. Filosofía central (el "por qué", manda sobre todo)

**Norte estratégico:** automatizar la carga administrativa para **crecer sin contratar**, tener **control total de los números**, y hacer **inteligencia de negocio** con los datos propios. Cada feature se justifica contra ese norte.

**1.1 La herramienta APRENDE y nunca repite trabajo** — principio rector #1.
- Toda acción manual (asignar razón social, vincular un RUT, corregir un match, elegir un destinatario) se guarda **permanentemente** y se reutiliza para siempre. Si se decidió una vez, nunca se vuelve a preguntar.
- La app **anticipa**: autocompleta, sugiere, recuerda. Solo pregunta ante ambigüedad real que no puede resolver.
- Al diseñar cualquier feature preguntarse: *"¿esto obliga a repetir algo que la app ya podría saber?"*. Si sí, está mal diseñada.
- Contraparte de navegación: la app **aprende del comportamiento de cada usuario** (qué navega, abre, busca) y lo usa para anticipar — recientes, frecuentes, accesos directos.

**1.2 Menos es más / que no dé miedo ni sea carga.**
- Práctica e intuitiva ante todo; usarla debe ser un alivio, no una complejidad.
- Preferir siempre la solución simple. No agregar pasos, campos ni pantallas innecesarias.
- Flujos cortos: el menor número de clics para cualquier acción.
- Si una feature se vuelve compleja o una carga, replantearla o simplificarla.

**1.3 Rigor matemático absoluto.** Cero tolerancia a errores de cifra (ver §3). El usuario debe poder entender de dónde sale cada número (cifras auditables).

**1.4 UX impecable + todo clickeable.** Claro, accesible, responsivo, intuitivo. Ningún dato es callejón sin salida: cada dato visible es tocable y lleva a su contexto natural (ver §5–6).

**1.5 Todo reversible.** Toda acción que cambia estado se puede deshacer en la UI (soft-delete + "Deshacer", nunca borrado duro por defecto).

---

## 2. Arquitectura y stack

- **Front:** React + Vite, **archivo único** `src/App.jsx` (patrón deliberado: un solo monolito con todos los componentes y helpers). Deploy en **Vercel** (`vercel --prod --yes`; push a `main` auto-despliega).
- **Backend:** **Supabase** (Postgres + Auth + Edge Functions Deno). El front habla con Supabase vía el SDK con la **anon key** (pública); las escrituras sensibles y los secretos viven en **edge functions** con `service_role` (saltan RLS).
- **Auth:** Google OAuth restringido al dominio del estudio; `provider_token` para Drive/Gmail/Calendar por-usuario.
- **Modo demo:** `?demo=1` entra sin login con datos ficticios (`src/demoData.js`) y un Supabase **inerte** (no toca la base real). Toda mutación debe tener rama `if(DEMO){ ...state local... ; return }`. Es la red de seguridad para verificar sin datos reales.
- **Roles:** `admin` (ve todo) y `limited` (ve un subconjunto). `actualRole` = rol REAL inmutable de la DB (fuente de verdad para permisos); `userRole` = vista actual (un admin puede previsualizar 'limited'). **Los permisos SIEMPRE contra `actualRole`.**

### 2.1 Regla de oro del build
ANTES de publicar SIEMPRE `npm run build` y verificar `✓ built in`. Si falla, arreglar antes de publicar. **Un build roto silencioso ya causó problemas graves.** Publicar: `git add -A && git commit -m "..." && git push`.

### 2.2 Anti-crash de archivo único (CRÍTICO)
Un helper definido **dentro** de un componente NO está en scope de otro componente → usarlo cruzado da `ReferenceError` → **pantalla negra que el build NO caza y demo NO siempre dispara**. Antes de reusar un helper, verificar que sea **module-level** (sin indentación, fuera de toda función). Blindar siempre accesos tipo `x.name.localeCompare(...)` / `x.name.toLowerCase()` con `(x.name||'')` — asumir que un campo "siempre" tiene valor es la causa típica de crash con datos reales.

---

## 3. Modelo de datos y almacenamiento (la "forma de guardar")

### 3.1 RLS ON — estándar para TODA tabla nueva
Nunca `DISABLE ROW LEVEL SECURITY`, nunca `GRANT` a `anon`. Plantilla exacta:
```sql
GRANT ALL ON TABLE x TO authenticated, service_role;
ALTER TABLE x ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_all ON x FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'email') LIKE '%@DOMINIO.cl')
  WITH CHECK ((auth.jwt() ->> 'email') LIKE '%@DOMINIO.cl');
NOTIFY pgrst, 'reload schema';
```
La CLI local puede `secrets set` / `functions deploy` / `functions list`, pero **NO** correr SQL (sin DB pass) → las tablas/columnas nuevas las corre el usuario en el **SQL Editor**. Al crear una feature con tabla nueva: **entregar el `.sql` listo** y avisar que hay que correrlo.

### 3.2 Capa de aprendizaje (primera clase — el núcleo de la filosofía)
Dos helpers module-level, una tabla genérica `learnings` y (opcional) `usage_events`:
```js
const learnPut = (kind,key,value,meta) => { try{ supabase.from('learnings').insert({kind,key:String(key),value:value!=null?String(value):null,meta:meta||{}}).then(()=>{},()=>{}) }catch(e){} }
const logEvent = (area,action,detail,user) => { try{ supabase.from('usage_events').insert({area,action,detail:detail||{},user_name:user||null}).then(()=>{},()=>{}) }catch(e){} }
```
- **Patrón ✦ (escribo→reuso):** al tomar una decisión manual → `learnPut(kind,key,value)`; la próxima vez, leer ese `kind` y **prellenar/sugerir** (glosa→cliente, glosa→categoría, RUT→cliente, dominio→cliente, cliente→destinatario de correo, cliente→responsable/área, etc.). **Toda decisión que se escribe se debe leer** — romper esa simetría es un bug.
- **Alias dedicado** para identidades (ej. RUT/nombre pagador → cliente) en su propia tabla, con **compuerta de confirmación** antes de aprender.
- **Centro de aprendizaje** ("Lo que aprendí"): pantalla que lista todo lo aprendido, **visible y borrable** (Olvidar). Es el corazón, no un extra.
- `usage_events` **debe leerse** para alimentar recientes/frecuentes/atajos por usuario (si solo se escribe, la mitad de la filosofía queda muerta).

### 3.3 Single source of truth por cifra
Cada cálculo (una venta, un saldo, un total) vive en **UN** helper reutilizable (`ventaUF`/`ventaCLP`/`saldoCliente`/`fgCliente`/`saldoBill`...). **Nunca** re-implementar la fórmula inline (un `.reduce` que duplica un helper): si se duplica, divergen. Al detectar una suma inline de montos, evaluar reemplazarla por el helper.

### 3.4 Exclusiones canónicas de saldo
Todo saldo/deuda/por-cobrar/reembolso **excluye** los gastos marcados `no_descuenta_saldo` (histórico) y `paid_by_client` (los pagó el cliente directo). Es un bug recurrente sumarlos inline. El **cliente interno** (la propia oficina, `is_internal`) queda **fuera de toda fórmula global**.

### 3.5 Convenciones de nombres de datos
- Nombre humano del cliente en `clients.name` (grafito). Razones sociales en tabla aparte (`client_entities`: name = RS, rut). En todo encabezado de cliente mostrar la RS (helper único `rsLabel`), nunca un folio/OT truncado como protagonista.
- Verificar el esquema real antes de armar payloads (no todas las tablas tienen `updated_at`, `area`, etc.).

---

## 4. Rigor en cifras, métricas y reportes

- **Single source** (§3.3) + **exclusiones** (§3.4) siempre.
- **Redondear solo al MOSTRAR, nunca al calcular** (no acumular error). Pesos sin decimales; UF con sus decimales.
- **Casos borde siempre:** división por cero, null/undefined, arrays vacíos, fechas inválidas. Nunca arrojar NaN/Infinity ni romper la vista.
- **Conversión UF↔CLP** con el valor UF de la **fecha correcta**, no congelado (integrar mindicador.cl; convertir con el valor del día).
- **Verificar que subtotales sumen el total** antes de mostrar agregados.
- **Formato de cifra = OVERVIEW vs DETALLE** (no "foto vs lista"):
  - *Overview / landing* (escaneas muchas entidades, importan tendencias) → **`fmtShort`** (`$65M`). Consistente dentro de la foto: las partes anidadas usan el MISMO formato que el protagonista.
  - *Detalle de UNA entidad* (ficha, un cargo, un costo) y **listas/filas** → **`fmt` completo** (`$28.530.000`, no `$29M`). Ahí la exactitud de ESE dato importa.
- **Pausa de seguridad:** cambios de cifras/fórmulas que no puedas verificar sin datos reales de producción → mostrar el análisis/fórmula, NO ejecutar a ciegas.

---

## 5. Design system

### 5.1 Paleta (objeto `C`) — OBLIGATORIA, tal cual
```js
const C = {
  bg:'#F5F5F5', surface:'#FFFFFF', card:'#FFFFFF', border:'#E4E8EB', text:'#3D3D3D', muted:'#537281',
  accent:'#003C50', overdue:'#E24B4A', urgent:'#E24B4A', soon:'#C77F18', normal:'#1D9E75', done:'#99ABB4',
  greenText:'#0F6E56', toggleOff:'#CBD5DB',
  soonBg:'#FFF8E1', soonText:'#854F0B', overdueBg:'#FCEBEB', overdueText:'#A32D2D', greenBg:'#E1F5EE',
  azulInfo:'#185FA5', azulBg:'#E6F1FB', tealBg:'#DFF1F2', tealText:'#155E6B', ambarBg:'#FAEEDA', coralText:'#993C1D', grisText:'#5F5E5A',
  bgSoft:'#F5F7F9', bgPanel:'#FAFBFC', bgWarm:'#F1EFE8',
  onNavyLabel:'#85B7EB', onNavyBtn:'#0E5066', onNavyLine:'#1C5468', onNavyGreen:'#9BD9BE', onNavyRed:'#F0A3A3',
}
```
- Corporativos: accent/AZUL1 `#003C50`, muted/AZUL2 `#537281`, AZUL3 `#99ABB4`, AZUL4 `#E4E8EB`, text/GRAFITO `#3D3D3D`, verde `#1D9E75`, rojo `#E24B4A`.
- **Regla:** SIEMPRE el token de `C`, **nunca el hex suelto** — excepto strings HTML de correo/PDF y atributos SVG (van literales). Nada de azules genéricos ni colores fuera de esta paleta. Deuda histórica de hex a mano → migrar **gradualmente** al tocar cada vista (no barrido a ciegas, por el riesgo visual). Un gris de fondo nuevo repetido → agregarlo a `C` como token.
- Sub-paleta **sobre navy** (`onNavy*`) para heroes con fondo `accent`.

### 5.2 Estado / semáforo (canon color + ícono)
Cada estado con su color **e ícono** de un mapa único (ej. `ESTADO_COBRO`: Vencido rojo · Por cobrar navy · Por facturar gris · Ya facturada ámbar · Cobrado verde · Anticipada azul). Nunca un color de estado suelto.

### 5.3 Persona (color fijo, fuente única `PERSON_CHIP`)
Color por persona, **nunca hardcodear**: Cristóbal navy · Erasmo azul · Martín verde · Martina rosa · Rodrigo ámbar. Chip de persona con sus iniciales + su color.

### 5.4 Componentes / primitivos (fuente única)
- Inputs/selects **alto 36**; `chipBtn`; radios tipo card; **tabular-nums** global (cifras alineadas).
- **Pills/chips estrechos** (~`3px 11px`), nunca anchos.
- **KPI card** canónica: gap 8, radio 10, pad 10×12, `borderLeft 3px`, label 9px, cifra 17px.
- **Header de modal** = un solo patrón (el de "Nueva tarea"): título dentro del cuadro + separador de cliente.
- **Fecha destacada** (`bigDate`): día grande (16px bold) + "mes año" (9px), ancho fijo 40, en toda lista con fecha; con control nuevo↔antiguo (default nuevo primero).
- **Copyable**: primitivo copia-al-tocar (+ "copiado ✓") para RUT/email/folio/monto.
- **Diálogos:** nunca `alert`/`confirm`/`prompt` nativos → usar `appAlert`/`appConfirm`/`appPrompt` (versiones con la paleta).
- **Sin bottom-sheet** (panel que sube desde abajo deforma el iPhone) → modal centrado o acordeón.
- **Sin emojis** en toda la app (regla global). Al tocar un componente que los tenga, quitarlos.
- **Sin frases disclaimer/tagline** en la UI: la confianza va por diseño, no por notas al pie.

### 5.5 Economía de espacio (formularios densos pero legibles)
- Labels dentro del cuadro; campos en una línea (label inline, toggle+input en fila); lo opcional colapsado y solo si hace falta.
- Antes de agregar un campo: ¿cabe en una línea existente? Toda decisión de layout pasa por: **¿esto requiere scroll en iPhone que podría evitarse?**

### 5.6 Mobile iPhone primero (regla dura)
La app se usa principalmente en iPhone. **Nunca romper el layout mobile.** Targets táctiles cómodos, pills estrechas, `flexWrap` en headers.

---

## 6. Canon de la foto (toda vista-resumen de cifras)
Antes de armar/tocar cualquier landing, dashboard o ficha, correr este checklist:
1. **Jerarquía, no paralelo:** una cifra que es PARTE de otra (Vencido ⊂ Por cobrar) va **ANIDADA** bajo su total, nunca como tarjeta hermana. **Cero cifras duplicadas.**
2. **Un protagonista:** un solo bloque grande es la foto; lo accesorio baja a segundo nivel. No 4 tiles del mismo peso compitiendo.
3. **Una sola fuente por cifra** (§3.3): subtotales suman el total; nada calculado dos veces inline.
4. **Color + ícono por estado** del canon (§5.2).
5. **Menos es más, sin disclaimers** (§5.4).
6. **Filtro claro:** de un vistazo se entiende qué depende del filtro (año) y qué es saldo vivo.
7. **Todo clickeable:** cada KPI abre su lista.
8. **Alertas de acción ≠ KPI de plata:** lo que requiere acción es una alerta, no una tarjeta de monto.
9. **Mobile iPhone** (§5.6).

En una frase: **un protagonista con sus partes anidadas, cero cifras repetidas, de fuente única, todo clickeable y sin párrafos.**

---

## 7. Navegación (lógica y user-friendly)

- **Toda lista larga (>~10)** se agrupa por la **entidad natural** (cliente/RS, abogado, **año › mes** colapsable), con el protagonista **visible y grande** — nunca un muro plano de folios/OT con el dato clave truncado. Si el usuario no distingue un ítem de otro de un vistazo, está mal diseñada. Con filtro activo, expandir todo.
- **Buscador** en toda lista >~10; agrupación colapsable; índice A-Z donde aplique.
- **Todo clickeable / cross-linking:** el **nombre del cliente abre su ficha en TODA vista**; factura→su venta; movimiento conciliado→su factura; tarea→su cliente; KPI→su lista; anticipo→las cuotas que cubre. **Fila/tarjeta entera tappable**; los saltos secundarios (un nombre dentro de una fila con onClick) van con `stopPropagation`. Handler único `handleOpenClientFicha` → abre Ficha → Financiero.
- **Paleta de comandos** (⌘K/lupa): busca y va a cualquier vista/entidad + acciones; prioriza lo **reciente/frecuente de ESE usuario** (aprende de `usage_events`).
- **Volver al lugar exacto:** un `navStack` restaura pestaña + scroll al volver; `usePersistedState` restaura drills y acordeones:
```js
function usePersistedState(key, def){ const [v,setV]=useState(()=> key in _uiStore ? _uiStore[key] : (typeof def==='function'?def():def)); const set=useCallback(nv=>setV(prev=>{ const val=typeof nv==='function'?nv(prev):nv; _uiStore[key]=val; return val }),[key]); return [v,set] }
```
- Al cambiar el criterio de orden/persistencia de una lista, **bumpear la key** (`x_sort`→`x_sort2`) para estrenar el nuevo default.

---

## 8. Wording e interacción
- **Español de Chile, forma "tú"** en toda la interfaz. Nunca voseo.
- **Coherencia de términos:** reusar lo que ya dice la app; un término = un significado (ej. "Conciliar" solo para el módulo de banco).
- **Trato en reportes/correos:** personas → "Estimado [nombre]" (sin señor/apellido); empresas → "Estimados".
- **Densidad de texto:** minimizar texto visible (1 línea, juntar campos); sin párrafos explicativos.

---

## 9. IA (capa de inteligencia + compuerta humana)

- **Único puente a Claude:** la API key NO vive en el front (sería pública en el bundle) → vive como **secreto en una edge function `claude-proxy`** que valida el JWT del equipo. Helper único:
```js
async function claudeCall(body){
  const {data:{session}} = await supabase.auth.getSession()
  if(!session) throw new Error('Sesión expirada. Vuelve a entrar.')
  const resp = await fetch('https://PROJECT.supabase.co/functions/v1/claude-proxy',{
    method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token,'apikey':supabase.supabaseKey}, body:JSON.stringify(body)
  })
  const data = await resp.json().catch(()=>({}))
  if(!resp.ok) throw new Error(data.error||('Error '+resp.status))
  return data   // el llamador lee data.content[0].text
}
```
- **Compuerta humana SIEMPRE:** la IA **propone**, el humano **confirma**. Nada se ejecuta/guarda/liquida solo. Toda salida de IA se muestra editable con checkbox antes de aplicar.
- **La IA calcula sobre cifras ya calculadas por código** (determinista), nunca inventa números: el código arma el brief de datos reales, la IA solo narra/prioriza, blindada a no fabricar cifras.
- **Capa de conocimiento auto-generada:** lo que la IA extrae (contactos, plazos, alcance de un proyecto) se persiste y se reutiliza (con la compuerta), alimentando §1.1.
- **Drive/Gmail/Calendar:** lectura client-side con el token del usuario o vía edge function con refresh token permanente (cuenta de servicio); documentos del cliente legibles por la IA.

---

## 10. Seguridad (reglas duras)

- **Correos SIEMPRE salen del correo del usuario** (su Gmail vía `gmail.send`); nunca automático desde otra cuenta. Si el usuario no tiene permiso, se **pregunta antes** de usar el relay de oficina y se indica cómo dejarlo saliendo del suyo. Solo dominio del estudio (`@DOMINIO.cl`), **nunca** un Gmail privado.
- **RLS ON + `team_all`** en toda tabla (§3.1); nunca `anon`.
- **Secretos** (API keys, refresh tokens, credenciales) solo en edge functions, nunca en el front.
- **Acciones destructivas/irreversibles sobre datos reales, credenciales/OAuth, trámites externos, envío de correos/mensajes en nombre del usuario → confirmar siempre.**
- Relays de correo (edge functions con `verify_jwt=false`) son un agujero: cerrar con verificación de JWT del equipo o `CRON_SECRET` acotado.

### 10.1 Correos (edge function)
- Todo encabezado (From/asunto) va **solo ASCII** (`toAscii`: quita tildes, guiones largos → `-`); el cuerpo HTML conserva tildes. denomailer rompe el encoded-word RFC 2047 con tildes → correo crudo.
- Adjuntos base64 → decodificar a bytes y pasar como binario (`encoding:"binary"`), no re-codificar.
- Firma por usuario (logo/nombre/cargo/tel), editable.

---

## 11. Flujo de trabajo (proceso)

- **Autonomía autorizada:** avanzar el backlog sin pedir permiso. Construir, verificar en demo (`?demo=1` sin crash + build verde), commit+push y avisar; tomar decisiones de diseño razonables y mostrarlas **mientras** se construye. Crear el SQL de tablas nuevas para que el usuario lo corra; desplegar edge functions cuando haga falta.
- **PAUSAR y avisar** (por seguridad, no por permiso): (a) cambios de cifras/fórmulas no verificables sin datos reales → mostrar análisis, no ejecutar a ciegas; (b) alto riesgo que solo se prueba en prod (relays, envíos de correo) → construir pero avisar que hay que probar; (c) destructivo/irreversible, credenciales/OAuth, trámites externos, correos en su nombre → confirmar.
- **Mostrar render antes/después** de cambios visibles (matizado por la autonomía: mostrar mientras se construye).
- **CHANGELOG.md** en la raíz: una línea con fecha + resumen por cada cambio publicado.
- **Comentar en el código SOLO lo complejo/no obvio.** No comentar lo trivial.
- **Verificar en demo lo observable** (preview): el build verde y el demo OK NO garantizan ausencia de crashes por scope/datos reales — recorrer la vista.
- **Memoria persistente** del proyecto: guardar decisiones, features hechas, reglas y pendientes como archivos-memoria (un hecho por archivo) con índice; nunca re-preguntar lo ya decidido.

### 11.1 Patrón "Pulir" (rediseño de una vista)
Disparador: *"pulir <vista>"* → correr sobre esa vista: economía de espacio, campos condicionales (lo opcional colapsado), co-locación (elige una vez, viaja al paso siguiente), la app sugiere en vez de tipear, consistencia visual (un solo header), rigor en las cifras (cuestionar de dónde sale cada dato). En una frase: **compactar sin perder función**.

---

## 12. Reglas duras — resumen (no romper nunca)
1. Mobile iPhone primero; no romper el layout mobile.
2. Paleta `C` obligatoria; nunca hex suelto (salvo HTML correo/PDF y SVG).
3. Single source of truth por cifra; excluir `no_descuenta_saldo` + `paid_by_client`; oficina (`is_internal`) fuera de fórmulas globales.
4. Redondear solo al mostrar; UF con decimales, pesos sin.
5. Reversibilidad en toda acción de estado.
6. RLS ON + `team_all`; nunca `anon`; secretos solo en edge functions.
7. Correos solo desde el correo del usuario, dominio del estudio; preguntar antes de usar la oficina.
8. La IA propone, el humano confirma; la IA no inventa cifras.
9. Español de Chile "tú"; sin emojis; sin disclaimers; wording coherente.
10. `npm run build` verde antes de publicar; verificar en demo lo observable.
11. La app **aprende** y **nunca hace repetir** trabajo; toda decisión se guarda y se reutiliza.
12. Helpers reusados entre componentes = **module-level**; blindar accesos a campos que podrían ser null.

---

*Este canon es la base para reconstruir/crear cualquier app del estudio. Mantenerlo como fuente única y actualizarlo acá cuando una regla evolucione.*
