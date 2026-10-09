-- 2026-10-08 · Al reemplazar una cuota programada por su factura emitida (billing.replaced_by_id), sus comisiones de proveedores
-- pasan a la factura real. Vale para todo camino (app, barrido, SQL). Aplicada en prod (migración billing_reemplazo_mueve_comisiones).
CREATE OR REPLACE FUNCTION fn_billing_reemplazo_mueve_comisiones() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.replaced_by_id IS NOT NULL AND NEW.replaced_by_id IS DISTINCT FROM OLD.replaced_by_id THEN
    UPDATE terceros_pagos SET billing_id = NEW.replaced_by_id WHERE billing_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_billing_reemplazo_mueve_comisiones ON billing;
CREATE TRIGGER trg_billing_reemplazo_mueve_comisiones AFTER UPDATE OF replaced_by_id ON billing
  FOR EACH ROW EXECUTE FUNCTION fn_billing_reemplazo_mueve_comisiones();
