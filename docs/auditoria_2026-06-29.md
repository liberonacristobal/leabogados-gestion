# Auditoría integral — leabogados-gestion · 2026-06-29

Tres auditorías paralelas sobre el código real (números · seguridad/loopholes · navegación/UX/modernidad)
+ ideas de integración. **La app está muy pulida**: cliente→ficha en casi todas las vistas, 41 empty states,
mobile sano, cero emojis, idempotencia de DTE correcta, manejo de secretos limpio, reversibilidad de los
flujos grandes OK. Lo de abajo es lo que **falta** o **está mal**, priorizado.

---

## TIER 1 — Arreglar pronto (ALTA · confirmado · riesgo real)

1. **GRANTs a `service_role` no verificables (clase del bug de `tasks`).** Edge functions que leen/escriben con
   service_role y cuyo GRANT NO está documentado en el repo: **`dte_folios`, `billing`, `clients`,
   `client_entities`, `sii_novedades`** (+ `EXECUTE` de `siguiente_folio`). Si alguna se creó sin el GRANT
   (como pasó con `tasks`), falla con `permission denied` **silencioso**. **Crítico para emisión DTE**: si
   `sii-sync emitir` no puede reservar/persistir el folio, **se quema un folio sin guardarlo** → problema con
   el SII. → *Acción: correr el SQL de verificación (abajo) y aplicar el GRANT a las que falten.* **[TÚ, SQL]**

2. **Montos negativos se aceptan** (corrompen todas las cifras):
   - Honorario en SaleForm — `App.jsx:18969` (`parseFloat(f.amount_uf)||null`, guard solo client/title).
   - Gasto — `App.jsx:11312` (`parseInt(f.amount)||0`, guard `!f.amount` no atrapa negativos). **Confirmado.**
   - Caja chica — `App.jsx:1198` (early-return atrapa NaN, no negativos).
   → *Fix: exigir `>0` en el guard + `Math.max(0,…)` al persistir.* **[YO]**

3. **Aging/Dashboard mezclan monto bruto con saldo neto** (`b.amount` vs `saldoBill`):
   - `computeAgingCartera` — DSO (`:2239`) y monto por cliente (`:2248`) usan `b.amount`; el total usa
     `saldoBill`. Con facturas pagadas en parte: **DSO y "Mayor exposición" inflados** y **concentración Top-1
     puede pasar de 100%**. **Confirmado.**
   - Dashboard "Atención hoy" — vencidas/por-cobrar-7d suman `b.amount` (`:2431/2435/2437`) en vez de saldo.
   → *Fix: `b.amount` → `saldoBill(b)` en esos puntos.* **[YO]**

4. **`notify-task` abierto** — `verify_jwt=false` + cero validación de payload (`config.toml:4`; handler `:94`).
   Cualquiera con la URL puede POSTear `{mail:{to,subject,html}}` y **enviar correo desde tu Gmail de oficina**
   (spam/phishing con tu dominio). **Confirmado.** → *Fix: exigir un header/secreto en el path `mail` (o validar
   el JWT del equipo).* **[YO + deploy]**

5. **Dashboard: nombres de cliente son callejón sin salida** — `Dashboard` no recibe `onOpenClientFicha`; en el
   sheet de tareas (`:~398`) y en proveedores (`:~605`) el nombre es texto plano. Único lugar que viola "todo
   clickeable". → *Fix: pasar y cablear `onOpenClientFicha` con `stopPropagation` (patrón de TasksOnlyView).* **[YO]**

## TIER 2 — Importante (MEDIA)

6. **`conciliacion` con GRANT a `anon`** — `docs/prompt_conciliacion_claudecode.md:158` lo otorga a anon. Contra
   la regla de oro. → *`REVOKE ALL ON conciliacion FROM anon;` (verificar primero).* **[TÚ, SQL]**
7. **`handleDeleteBilling` (`:19914`) y `handleDeleteBillingBulk` (`:19973`) no liberan anticipos ni revierten
   conciliación** (a diferencia de `anular`). Deja plata atada a una factura oculta + movimientos de cartola
   "conciliados" contra una factura ida. El bulk además **no tiene undo toast**. → *Espejar la limpieza de
   `anular`.* **[YO]**
8. **Código muerto**: `TasksByPerson` (~70 líneas, `:1699-1768`) nunca se renderiza → borrar. **[YO]**
9. **CajaChicaView** no enlaza cliente→ficha (`:958`). **[YO]**
10. **Deuda de paleta**: ~221 `#F5F7F9` + 37 `#F1EFE8` + 14 `#FAFBFC` a mano, teniendo ya `C.bgSoft`/`bgWarm`/
    `bgPanel`. Reemplazo 1:1 seguro, gradual al tocar cada vista. **[YO, gradual]**
11. **Accesibilidad baja**: ~18 `aria-label` para 20k líneas; botones de ícono (cerrar/editar/borrar/expandir)
    sin etiqueta; SVGs sin `role="img"`. **[YO, gradual]**
12. **`.env` trackeado en git** (solo trae la anon key pública, no es fuga; higiene) → agregar a `.gitignore`. **[YO]**

## TIER 3 — Bajo / deuda estructural

13. **Monolito de 20.384 líneas** en un archivo (ConciliacionView 1.660, ExpensesView 1.646, CommandPalette
    1.625…). Extracción incremental a `src/components/` (ya existe la carpeta), empezando por formularios. **[YO, gradual]**
14. **Hard-deletes sin papelera**: `contacts`, `petty_cash`, `user_roles`, `red_profesional` (re-creables, con
    confirm). Candidatos a soft-delete para honrar "todo reversible". **[YO]**
15. **Sin virtualización** en listas grandes (mitigado por agrupación colapsable + memoización). Solo actuar si
    aparece jank en iPhone. **[monitorear]**
16. **Errores de carga por modal** (`appAlert`) en vez de inline en el panel de drop. **[YO]**
17. **BIView `ufRef` (`:3206`)** no antepone `ufHoy` (usa una UF congelada arbitraria; caso de borde). **[YO]**

---

## SQL para ti (verificación de GRANTs)

Correr en Supabase → SQL Editor. Muestra qué roles tienen permiso en las tablas sensibles:

```sql
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('dte_folios','billing','clients','client_entities','sii_novedades','tasks','conciliacion')
  and grantee in ('service_role','anon')
order by table_name, grantee;
```

- Si **falta `service_role`** en alguna de las 5 primeras → `GRANT ALL ON TABLE <tabla> TO authenticated, service_role; NOTIFY pgrst,'reload schema';`
- Si **`anon` aparece en `conciliacion`** → `REVOKE ALL ON conciliacion FROM anon;`

---

## Ideas de integración / negocio (resumen)

Detalle en la conversación; lo grande, por impacto:
1. **Banco BICE automático** (auto-conciliación vía API tipo Fintoc/Floid) — mata pega administrativa recurrente.
2. **Capa de asuntos/expedientes + plazos** (el punto ciego legal: la app es ERP financiero, no gestiona el
   trabajo jurídico — asuntos, documentos, hitos, calendario de plazos enganchado a Google Calendar).
3. **Brief diario proactivo + cobranza automática (dunning)** — la app empuja; cobras antes.
4. **Rentabilidad por cliente/área/abogado + cash-flow a 90 días** — BI con lo que ya tienes (falta el margen).
5. **IA en más flujos** (redacción legal, lectura de contratos→plazos), **portal del cliente** (read-only),
   **time tracking** liviano.

---

## Lo verificado y CORRECTO (para confianza)
Secretos (cert/CAF/keys solo en `Deno.env`/`dte_folios`, nada commiteado), idempotencia + folio atómico de DTE
(`FOR UPDATE SKIP LOCKED`), separación cron-secret vs emisión en `sii-sync`, reversibilidad de anular factura /
rendiciones / undo de conciliación, cuotas/redondeo, cash-flow y proyección al 31-dic, listas agrupadas +
buscadores + empty states, mobile/safe-area, memoización densa.
