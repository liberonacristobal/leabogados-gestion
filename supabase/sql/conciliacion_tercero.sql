-- 2026-10-08 · Permite conciliar un cargo del banco con comisiones a proveedores (tipo_destino 'tercero').
-- Antes la restricción lo rechazaba y "Pagar comisiones" desde Banco fallaba. Aplicada en prod (migración conciliacion_permite_tercero).
ALTER TABLE conciliacion DROP CONSTRAINT chk_tipo_destino;
ALTER TABLE conciliacion ADD CONSTRAINT chk_tipo_destino CHECK (tipo_destino = ANY (ARRAY['factura','gasto','fondo','anticipo','ingreso','tercero']));
ALTER TABLE conciliacion DROP CONSTRAINT chk_destino_coherente;
ALTER TABLE conciliacion ADD CONSTRAINT chk_destino_coherente CHECK (((tipo_destino = 'factura') AND (factura_id IS NOT NULL)) OR ((tipo_destino = 'anticipo') AND (anticipo_id IS NOT NULL)) OR (tipo_destino = ANY (ARRAY['gasto','fondo','ingreso','tercero'])));
NOTIFY pgrst, 'reload schema';
