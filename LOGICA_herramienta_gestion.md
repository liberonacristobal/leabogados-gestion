# LOGICA_herramienta_gestion.md
Documentación técnica y funcional de la app de gestión interna de Liberona Escala Abogados.
Última actualización: junio 2026.

---

## STACK Y DEPLOY

- **Frontend:** React + Vite, archivo único `src/App.jsx` (~5200 líneas)
- **Backend:** Supabase (proyecto `kibuwhtpoxrnfowfdolu`, Run without RLS)
- **Deploy:** Vercel (`project-q85ri.vercel.app`), rama `main`
- **Push:** función shell `publicar "mensaje"` → git add + commit + push
- **Recarga:** Cmd+Shift+R o ventana incógnito para limpiar caché

---

## USUARIOS Y ROLES

### Roles en `user_roles`
| Email | Nombre | Rol |
|---|---|---|
| cristobal.liberona@ / cl@ | Cristóbal | admin |
| erasmo.escala@ / ee@ | Erasmo | admin |
| mc@leabogados.cl | Martín | limited |
| mp@leabogados.cl | Martina | limited |
| rd@leabogados.cl | Rodrigo | limited |

### Lógica de roles
- **admin:** acceso completo a todas las pestañas
- **limited:** Tareas, Gastos, Caja chica, Clientes (sin info financiera)
- **Vista Team:** botón en el header para que admin previsualice la vista limited sin cambiar la DB

---

## PESTAÑAS DE NAVEGACIÓN

### Admin (TABS_ADMIN)
1. **Inicio (dashboard)** — métricas, tareas del estudio, proyección de caja
2. **Ventas** — listado con totales anualizados (×12 para recurrentes)
3. **Facturación** — cobros, estados, importación desde Drive/PDF
4. **Gastos** — fondos y gastos por cliente, rendiciones
5. **Clientes** — ficha completa con info financiera

### Limited (TABS_LIMITED)
1. **Tareas** — mis tareas + tareas que asigné, secciones por urgencia, terminadas colapsadas
2. **Gastos** — igual que admin pero sin acceso a info financiera de ventas
3. **Caja chica** — liquidar gastos, historial, mi caja
4. **Clientes** — versión limitada sin info financiera

---

## TABLAS SUPABASE

### `clients`
- id, name, rut, type, status (Activo/Terminado), created_at, updated_at
- Cliente especial: **Liberona Escala Abogados** (gastos internos de oficina)

### `client_entities`
- id, client_id, name, rut — razones sociales facturadas por cliente

### `sales`
- id, client_id, entity_id, title, area (Corporativo/Tributario/Laboral/Otro), moneda (UF/CLP), amount_uf, amount_clp, cost_uf, uf_value, year, month, status (Activo/Terminado/Pausado), cobro_type (cuotas/mensual/porcentaje/personalizada), responsible, notes, created_at
- **area nunca puede ser NULL** — default 'Corporativo'

### `billing`
- id, client_id, sale_id, entity_id, concept, amount, monto_terceros, status (Pendiente/Pagado/Vencido/Programado), invoice_no, issued_at, due, paid_at, billing_type (honorarios/reembolso), notes

### `expenses`
- id, client_id, sale_id, entity_id, type (gasto/fondo), amount, concept, category (Notaria/CBR/Diario Oficial/Otro), date, rendered_at, render_id, rendered_by — para liquidación caja chica interna
- **client_rendered_at, client_render_id** — para rendición al cliente (independiente de caja chica)

### `tasks`
- id, client_id, sale_id, title, who, due, status (Activo/Terminado/Pausado/Completado), note, created_at, project, subproject, assigned_by

### `user_roles`
- id, email, name, role (admin/limited)

### `petty_cash`
- id, user_name, amount, delivered_at, rendered_at, render_id, notes, created_at
- RLS deshabilitado, permisos GRANT ALL a anon/authenticated/service_role

### `rendiciones`
- id, user_name, client_id, periodo, total, n_gastos, n_clientes, petty_cash_id, tipo (cajachica/cliente), created_at
- RLS deshabilitado, permisos GRANT ALL a anon/authenticated/service_role

---

## CÁLCULO DE VENTAS (fuente única de verdad)

```js
// Funciones de módulo — únicas fuentes del cálculo
const esRecurrente = s => s.cobro_type==='mensual' && s.status==='Activo'
const ventaUF = (s, ufRef) => { factor = esRecurrente ? 12 : 1; ... }
const ventaCLP = (s, ufRef) => { factor = esRecurrente ? 12 : 1; ... }
```

- Dashboard y SalesView usan las mismas funciones → totales siempre coinciden
- UF del día: fetch a `mindicador.cl/api/uf` en ambos componentes

---

## MÓDULO DE TAREAS

### Estados válidos
`Activo`, `Terminado`, `Pausado`, `Completado` (este último legado, ya no se usa)

### DashboardTasks (admin)
- Agrupa tareas **Activas** por persona (colapsadas por defecto)
- Título "ACTIVAS" sobre las activas
- Sección "TERMINADAS" al final, agrupada por persona en acordeón colapsado
- Botones: ✓ verde (26×26, border #1D9E75, bg #E1F5EE) + ✎ neutro (26×26)
- Badge: "Vence DD/MM" con colores urgencia
- Metadata: Cliente · Proy. · Sub. siempre visibles, Inicio DD/MM/AAAA

### TasksOnlyView (limited + admin pestaña Tareas)
- "Mis tareas" + "Tareas que asigné", agrupadas por urgencia
- Terminadas: filtradas a las propias (who===me o assigned_by===me), acordeón colapsado
- Mismo diseño de cards que DashboardTasks

---

## MÓDULO DE GASTOS Y FONDOS

### ExpensesView
- Lista clientes con saldo, al click muestra movimientos del cliente
- Header: `+ Carga masiva`, `☰ Rendiciones`, `+ Fondo`, `+ Gastos`
- Botones `+ Fondo` y `+ Gastos` son **contextuales**: si hay cliente seleccionado, abren sin buscador

### Rendición al cliente (RendicionModal)
- Flujo: seleccionar gastos con checkboxes → preview saldo → PDF + Registrar
- Al registrar: marca gastos con `client_rendered_at`, inserta en `rendiciones` con tipo='cliente', abre mailto pre-compuesto
- Gastos rendidos muestran chip "✓ Rendido" verde en la ficha y en ExpensesView
- Historial en ficha del cliente + panel global en ExpensesView (filtros cliente/mes)
- Anular rendición: revierte `client_rendered_at` y borra de `rendiciones`
- **Independiente** de liquidación de caja chica — dos flujos separados

### Saldos en RendicionModal
- **Saldo actual** = fondos - gastos YA rendidos (no todos los gastos)
- **Saldo tras rendición** = saldo actual - total seleccionado
- Si negativo: "nos deben"

---

## MÓDULO CAJA CHICA (limited)

### CajaChicaView — 3 tabs
1. **Liquidar**: gastos pendientes (rendered_at=NULL) con checkboxes, filtros Período/Cliente/Tipo
   - Barra flotante con total + botones PDF y Liquidar
   - Liquidar: marca `rendered_at` en expenses, inserta en `rendiciones` con tipo='cajachica'
2. **Historial**: liquidaciones del usuario actual
3. **Mi caja**: saldo disponible, registrar entregas de caja chica

---

## MÓDULO CLIENTES (limited)

### ClientsViewLimited
- Lista todos los clientes con saldo fondos (verde/rojo)
- Ficha: razones sociales, gastos/fondos/saldo, tareas — **sin** vendido/por cobrar/cobrado
- Botones `+ Fondo` y `+ Gasto` directos desde ficha
- Editar: modal de confirmación antes de guardar
- Crear: buscador de similares en tiempo real + advertencia naranja + confirmación roja

---

## FLUJO DE SCRIPTS PYTHON

- Todos los scripts usan anclas verificadas que abortan si no calzan
- Backup automático antes de modificar: `App.jsx.bak_*`
- Caracteres especiales en heredocs → usar archivos .py descargables
- Workflow: `python3 ~/Downloads/script.py` → verificar output → `publicar "msg"` → Cmd+Shift+R (o incógnito)

---

## CONVENCIONES DE DISEÑO

### Paleta corporativa
| Variable | Hex | Uso |
|---|---|---|
| C.accent / AZUL 1 | #003C50 | Títulos, botones primarios |
| C.muted / AZUL 2 | #537281 | Texto secundario |
| AZUL 3 | #99ABB4 | Bordes, separadores |
| AZUL 4 | #E4E8EB | Fondos de cards |
| C.text / GRAFITO | #3D3D3D | Texto principal |
| C.normal | #1D9E75 | Verde positivo |
| C.overdue | #E24B4A | Rojo negativo/urgente |

### Botones de acción en tareas
- **Terminada**: 26×26px, border 1px #1D9E75, bg #E1F5EE, color #0F6E56, ícono ✓
- **Editar**: 26×26px, border 0.5px C.border, bg transparent, color C.muted, ícono ✎

### Componentes de navegación
- `BottomNav`: fijo en la parte inferior, diferente según rol
- Headers de sección: font-size 11, fontWeight 600, color C.muted, textTransform uppercase, letterSpacing 0.5
- Cards: borderRadius 10, border 1px C.border, bg C.card, padding 12px 14px

---

## EDGE FUNCTION

- `notify-task`: envía correo al asignado cuando se crea/modifica una tarea
- Incluye nombre del asignador (vía `user.name` de `user_roles`)
- Botón de Google Calendar en el correo (evento 9:00-9:15)
- Deploy: `supabase functions deploy notify-task` (NO con `publicar`)

---

## PENDIENTES CONOCIDOS

1. Botón mailto en liquidación de caja chica (limited)
2. Rendición desde pestaña Gastos para limited
3. Limpieza de archivos `.bak_*` del repositorio
4. Proyectos sugeridos en GastosForm (autocompletar por cliente)
