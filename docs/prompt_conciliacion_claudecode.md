# Nuevo módulo: CONCILIACIÓN BANCARIA (FirmDesk / Gestión)

> **Pegar en Claude Code.** Módulo/proyecto nuevo dentro de la app existente
> (React + Vite + Supabase, proyecto `kibuwhtpoxrnfowfdolu`).
> **Trabaja por fases. Preséntame el plan antes de implementar cada fase y espera mi OK.**
> Respeta `CLAUDE.md` (paleta corporativa, convenciones, estilo). Cambios modulares,
> sin reescribir lo existente. SQL siempre lo corro yo a mano en el SQL Editor.

---

## 1. Objetivo del módulo

Conciliar los estados de cuenta (cartolas) del banco contra los datos que ya viven en la
app (clientes, RUT, razones sociales, facturas, gastos), para identificar de las
**transferencias entrantes de clientes** dos cosas:

1. **Pagos de honorarios / facturas** (exactos, parciales, o varias transferencias que suman una factura).
2. **Abonos de fondos para gastos** (el cliente abona un monto, normalmente mayor que la factura, que luego se consume con gastos).

Voy a cargar **todas las cartolas de 2025 y 2026**, de **dos cuentas corrientes**
(~48 archivos .xlsx, BICE). El módulo tiene que ser idempotente y robusto a ese volumen.

---

## 2. Entidad y cuentas (dato base)

Ambas cuentas son de la **misma sociedad**:

- **Razón social:** Liberona Escala Abogados Limitada
- **RUT (propio):** `77.700.387-9`
- **Banco:** BICE
- **Cuenta HONORARIOS:** `01-40383-4` (aparece también como `140383-4` / `01403834`)
- **Cuenta GASTOS:** `01-38392-2` (aparece también como `138392-2`)

Config sugerida (las cuentas pueden venir escritas con o sin el prefijo "01" y con o sin
guiones; normaliza a solo dígitos y empata por el número distintivo):

```js
const RUT_PROPIO = '77.700.387-9'; // normalizar quitando puntos/guion y comparar
const CUENTAS = [
  { rol: 'honorarios', num: '40383', codigo: '403', etiqueta: '01-40383-4' },
  { rol: 'gastos',     num: '38392', codigo: '138', etiqueta: '01-38392-2' },
];
// rolDeCuenta(raw): digits = raw.replace(/\D/g,''); return CUENTAS.find(c => digits.includes(c.num))
```

---

## 3. Semántica de los traspasos entre cuentas propias (CRÍTICO)

Pasa seguido que un cliente paga **honorarios en la cuenta de GASTOS** (la equivocada).
Para mantener saldos ordenados, la firma hace una **transferencia entre sus propias
cuentas BICE** (gastos -> honorarios). Por lo tanto:

- El **pago real del cliente** es el **abono original con el RUT del cliente**, y puede
  caer en **cualquiera** de las dos cuentas. Ese es el evento conciliable contra facturas.
- El **traspaso interno** (cuentas propias) es solo movimiento de saldo entre las cuentas
  de la firma. **Nunca se concilia contra facturas y NUNCA se cuenta como pago**, porque
  es la misma plata que ya entró como abono del cliente en la otra cuenta. Contarlo sería
  **duplicar**.

Reglas que se derivan:

- Marcar `es_interno = true` cuando: la glosa contiene "cuentas propias" **o** el
  `rut_contraparte` es el RUT propio `77.700.387-9` (esto último cubre auto-transferencias
  que el banco escribe como "Transf. a terceros ... Liberona Escala Abogados Limitada,
  Rut 77.700.387-9").
- Los movimientos `es_interno` se importan y sirven para cuadrar el **saldo bancario**,
  pero quedan con `estado = 'interno'` y **se excluyen** del motor de conciliación.
- Los **candidatos a conciliación son los abonos de clientes de AMBAS cuentas**
  (no solo la de honorarios), justamente porque los honorarios a veces entran en la de
  gastos. La cuenta donde cayó es metadato, no un filtro.
- Útil para mí: marcar/poder filtrar los **abonos de clientes que cayeron en la cuenta de
  GASTOS** (son los que normalmente gatillan el traspaso interno).

---

## 4. Principio de diseño de la conciliación

La clasificación **no se puede automatizar solo por monto**: un mismo cliente paga
facturas exactas, paga en cuotas, y abona fondos "inflados". Por eso:

- Conciliación **por saldo, no por igualdad de montos**. Cada factura tiene **saldo
  pendiente**; cada abono se *aplica* contra una o más facturas reduciendo saldo.
- **Solo se auto-aplica lo inequívoco.** El resto va a una bandeja de confirmación.

Niveles de confianza:

- **AUTO** -> existe exactamente UNA factura por cobrar del cliente cuyo saldo es idéntico
  al abono y no hay otro candidato. Se cierra sola (`origen='auto'`).
- **CONFIRMAR** -> todo el resto: parcial, acumulado (varios abonos que suman), monto mayor
  a la factura (probable fondo), varios candidatos, o cliente identificado solo por nombre
  y no por RUT. Va a la bandeja con la sugerencia rankeada; yo apruebo.

---

## 5. Modelo de datos

Tres tablas nuevas. **Corre este SQL a mano en Supabase ANTES de codificar.**
`cliente_id` / `factura_id` / `gasto_id` quedan como uuid sin FK dura para no romper al
pegar; confírmame los nombres reales de mis tablas y luego agregamos FK si conviene.

```sql
-- 1) Movimientos importados desde la cartola
create table if not exists cartola_movimientos (
  id                  uuid primary key default gen_random_uuid(),
  cuenta              text not null,            -- '01-40383-4' / '01-38392-2'
  rol_cuenta          text,                     -- 'honorarios' | 'gastos'
  fecha               date not null,
  tipo                text not null,            -- 'abono' | 'cargo'
  rut_contraparte     text,
  nombre_contraparte  text,                     -- nombre tal como lo da el banco
  monto               bigint not null,          -- CLP entero
  n_operacion         text,
  descripcion         text,                     -- glosa original completa
  es_interno          boolean default false,    -- traspaso entre cuentas propias / RUT propio
  cliente_id          uuid,
  estado              text default 'pendiente', -- pendiente|parcial|conciliado|interno|ignorado
  monto_conciliado    bigint default 0,
  hash                text not null unique,     -- dedup idempotente
  created_at          timestamptz default now()
);
create index if not exists idx_cartola_rut     on cartola_movimientos (rut_contraparte);
create index if not exists idx_cartola_cliente on cartola_movimientos (cliente_id);
create index if not exists idx_cartola_estado  on cartola_movimientos (estado);
create index if not exists idx_cartola_fecha   on cartola_movimientos (fecha);

-- 2) Alias de pagador (RUT que paga -> cliente)
create table if not exists cliente_alias (
  id              uuid primary key default gen_random_uuid(),
  rut_pagador     text not null unique,
  nombre_pagador  text,
  cliente_id      uuid not null,
  created_at      timestamptz default now()
);

-- 3) Conciliación: liga un movimiento a factura / gasto / fondo
create table if not exists conciliacion (
  id              uuid primary key default gen_random_uuid(),
  movimiento_id   uuid not null references cartola_movimientos(id) on delete cascade,
  tipo_destino    text not null,                -- 'factura' | 'gasto' | 'fondo'
  factura_id      uuid,
  gasto_id        uuid,
  monto_aplicado  bigint not null,
  origen          text not null default 'manual', -- 'auto' | 'manual'
  created_at      timestamptz default now()
);
create index if not exists idx_conc_mov     on conciliacion (movimiento_id);
create index if not exists idx_conc_factura on conciliacion (factura_id);
create index if not exists idx_conc_gasto   on conciliacion (gasto_id);

-- Protocolo estándar del proyecto
alter table cartola_movimientos disable row level security;
alter table cliente_alias       disable row level security;
alter table conciliacion        disable row level security;
grant all on cartola_movimientos to anon, authenticated, service_role;
grant all on cliente_alias       to anon, authenticated, service_role;
grant all on conciliacion        to anon, authenticated, service_role;
notify pgrst, 'reload schema';
```

---

## 6. Parseo de la cartola (.xlsx) — lógica validada

Parsear **en el cliente con SheetJS (xlsx)**, que ya se usa en el proyecto.

- Localizar hoja y fila de encabezados buscando una fila que contenga "Descripción" y
  "Abonos" (no asumir posiciones fijas). Mapear columnas por nombre: Fecha, Documento,
  Descripción, Cargos, Abonos.
- Fecha trae "DD-MM"; cuando viene "-" = **misma fecha que la fila anterior** (forward-fill).
- **Año:** sácalo de la fecha completa dentro de la glosa (`dd/mm/yyyy` o `dd-mm-yyyy`); si
  la fila no la trae, infiérelo del período del encabezado ("Desde"/"Hasta"). Debe
  funcionar para **2025 y 2026** y para cartolas que crucen fin de año.
- Del encabezado leer: cliente, **cuenta** (deriva `rol_cuenta` con `CUENTAS`), período,
  saldo inicial/final. Del bloque "Resumen del Período": **Total Cargos** y **Total
  Abonos** (para verificación).
- Detener la lectura en la primera fila con Descripción vacía. Saltar la fila "Saldo Inicial".
- Tipo = 'abono' si Abonos>0, 'cargo' si Cargos>0. Montos CLP enteros.

Extracción de RUT/nombre desde la glosa (regex ya probado):

```js
const RUT = String.raw`(\d{1,3}(?:\.\d{3})*-[\dkK])`;

// ABONO recibido de un tercero:
//   "Abono por transferencia de NOMBRE Rut RUT desde BANCO el FECHA"
const reAbono  = new RegExp(`Abono por transferencia de (.+?)\\s*Rut\\s*${RUT}`, 'i');

// CARGO / transferencia a un tercero:
//   "Transf. a terceros ... a cuenta NNN BANCO, NOMBRE, Rut RUT, el FECHA"
const reTransf = new RegExp(`a cuenta \\S+ [^,]+,\\s*(.+?),\\s*Rut\\s*${RUT}`, 'i');
```

Traspasos entre cuentas propias y/o RUT propio -> `es_interno=true`, `rut=null`, etiqueta
en `nombre_contraparte` según rol de la cuenta contraparte (detectada en la glosa
"...desde cuenta N01-38392-2 hacia cuenta N 01-40383-4..."):

```js
// abono interno -> "Traspaso interno abono cliente cta. {codigo}"
// cargo interno -> "Traspaso interno cargo cta. {codigo}"  // texto a confirmar conmigo
// codigo: '138' para 01-38392-2 (gastos), '403' para 01-40383-4 (honorarios)
```

**Dedup idempotente:** `hash` estable por movimiento de
`cuenta | fecha | tipo | monto | rut | n_operacion | descripcion`. Upsert por `hash`.
Como las dos patas de un traspaso interno viven en cuentas distintas (cargo en gastos,
abono en honorarios), NO se deduplican entre sí — son dos movimientos legítimos.

**Robustez (casos reales a soportar):**
- RUT con dígito verificador `K` (mayúscula o minúscula).
- Nombres **truncados en origen** por el banco (p. ej. "...LIMITA", "...LIMIT",
  "Tecnologia Y Seguridad Sbs Latam S"): se guardan tal cual, no inventar.
- Filas de tarjeta/SII sin RUT ni tercero -> `rut=null`, `nombre=null`, quedan como cargos
  sin contraparte (no entran a conciliación).
- Cartolas con períodos **traslapados** entre archivos -> el dedup por hash lo absorbe.
- "alas"/"a las", espacios irregulares y dobles espacios en la glosa.

---

## 7. Motor de conciliación

Candidatos = **abonos de clientes de ambas cuentas** (excluye `es_interno`). Para cada
abono con cliente resuelto, facturas por cobrar del cliente con saldo > 0:

- **Calce exacto único** (saldo == monto, un solo candidato) -> AUTO: aplica total,
  factura a Pagada, movimiento a 'conciliado', `conciliacion.origen='auto'`.
- **Parcial** (monto < saldo) -> CONFIRMAR: aplica parcial, arrastra saldo.
- **Acumulado** (este abono + abonos previos pendientes del mismo cliente suman una
  factura) -> CONFIRMAR: sugiere completar la factura con esos abonos.
- **Mayor a toda factura** (monto > max saldo) o sin factura que calce -> CONFIRMAR:
  sugiere **fondo de gastos**; o "paga factura X + resto Y a fondo" si calza parcialmente.
- **Sin cliente** (RUT no mapeado) -> bandeja "sin identificar" + acción de crear alias
  (RUT pagador -> cliente), que re-identifica ese y futuros movimientos.

Un movimiento puede ligarse a varios destinos; una factura puede recibir varios
movimientos (`conciliacion` con `monto_aplicado`).

---

## 8. Roadmap por fases (implementar de a una, plan-first)

- **Fase 1 — Importación + identificación.** Subida **multi-archivo** (.xlsx) para cargar
  2025 y 2026 de una vez; parseo; dedup; `es_interno`; `rol_cuenta`; resolver cliente por
  RUT/alias. UI: secciones Abonos y Cargos; abonos con cliente identificado o "sin
  identificar" + crear alias; marca de abonos de cliente caídos en cuenta de GASTOS;
  verificación por cartola (suma vs Total del banco, OK si diferencia 0). **No concilia.**
- **Fase 2 — Motor de conciliación.** Auto-aplica calces exactos; bandeja de confirmación
  para parciales/acumulados/fondos; arrastre de saldos. Pool de abonos de ambas cuentas.
- **Fase 3 — Fondos de gastos.** Fondo por rendir por cliente; ligar abonos-fondo y
  descontar gastos; saldo de fondo.
- **Fase 4 — Cierre y reportes.** Conciliación por período y por cuenta, exportable.

**Empieza por la Fase 1.** Antes de codificar: lee el esquema y repórtame los nombres y
columnas reales de **clientes** (PK, razón social, RUT), **facturas** (PK, cliente, monto,
estado, saldo) y **gastos**. Luego preséntame el plan de archivos/ruta.

---

## 9. Prueba (cuando la Fase 1 esté lista)

- Subiré **una cartola real de BICE en .xlsx** (igual a la que ya tengo de la cuenta
  01-40383-4). Después subiré el lote completo 2025–2026 con la carga multi-archivo.
- Criterio de éxito: la verificación por cartola debe dar diferencia **0** entre la suma de
  abonos importados y "Total Abonos" del banco, e igual para cargos. Eso confirma que se
  parseó todo sin perder ni duplicar.
- Reporta en pantalla, por archivo y global: abonos, cargos, internos detectados, y abonos
  de cliente "sin identificar" para mapear alias. Verifica que re-subir un archivo ya
  cargado **no** crea duplicados (dedup por hash).
