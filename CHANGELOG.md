# Changelog

## 2026-06-09
- KPIs de caja chica en la pestaña Tareas (vista limited): tarjetas "Mi caja chica" (saldo real = entregado − gastos del usuario) y "Gastos por liquidar" (monto + cantidad), más lista "Últimos gastos ingresados" (3 últimos del usuario). Nueva columna `expenses.created_by` con atribución automática del usuario que ingresa el gasto. Saldo de caja chica unificado en un helper único (`saldoCajaChica`) usado por Tareas y por la pestaña Caja Chica.
