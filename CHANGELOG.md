# Changelog

## 2026-06-09
- Fix calendario "Próximas dos semanas" (Tareas): click en un día abre Nueva tarea con la fecha precargada en plazo; click en una tarjeta abre esa tarea para editar (stopPropagation). `onAddTask` ahora type-guardea la fecha (string) y `QuickTaskForm` acepta `preDue`, evitando el crash por pasar un MouseEvent como dato.
- Panel "Gestión · Gastos y Caja Chica" en el Dashboard (solo admin), debajo de la Proyección de flujo de caja: tabla compacta con una fila por usuario con caja chica (derivado de `petty_cash`). Columnas: Saldo caja (helper `saldoCajaChica`), Sin liquidar ("$monto / N°", ⚠ si >10 gastos excluyendo Notaría), Últ. gasto (⚠ si >7 días sin ingresar gasto).
- KPIs de caja chica en la pestaña Tareas (vista limited): tarjetas "Mi caja chica" (saldo real = entregado − gastos del usuario) y "Gastos por liquidar" (monto + cantidad), más lista "Últimos gastos ingresados" (3 últimos del usuario). Nueva columna `expenses.created_by` con atribución automática del usuario que ingresa el gasto. Saldo de caja chica unificado en un helper único (`saldoCajaChica`) usado por Tareas y por la pestaña Caja Chica.
